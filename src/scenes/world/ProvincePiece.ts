import {
  Box3, BufferGeometry, CanvasTexture, ExtrudeGeometry, Float32BufferAttribute, Group, LinearMipmapLinearFilter, Mesh,
  MeshLambertMaterial, Shape, SRGBColorSpace, Texture, Vector3,
} from 'three';
import { createPaperMaterial, type PaperLocals } from '../../render/paper';
import { hexToOklab, pieceColor, type Lab } from './oklab';
import { insetPolygon, labelPoint, normalizeOutline, simplifyClosed, traceMask, type Pt } from './outline';
import { PieceSprings, type PieceState } from './pieceState';

export const T_TOP = 0.012, T_CORE = 0.022;
export const LAYER_PICK = 0, LAYER_DECOR = 1;
/** 贴原版深色底图时的染色增益（线性空间），让强调色在墨色上看得出。 */
export const TINT_GAIN = 1.25;

/** 地图坐标（像素，y 向下）→ 平面坐标（世界单位，y 向上 = 世界 −z）。 */
export interface MapXform { scale: number; ox: number; oy: number }
export function mapToPlane(t: MapXform, mx: number, my: number): Pt { return [(mx - t.ox) * t.scale, -(my - t.oy) * t.scale]; }

export interface PieceSource {
  /** 平面坐标下的轮廓（逆时针）。 */
  outline: Pt[];
  texture: Texture | null;
  /** 纹理图片在平面坐标下的范围 [x0, yTop, w, h]。 */
  imageRect: [number, number, number, number];
  /** 纹理由外部共享（整张底图），片释放时不销毁。 */
  sharedTexture?: boolean;
}

/** 读图片 alpha → 轮廓（平面坐标）+ 归一化后的纸面纹理。 */
export function pieceFromImage(img: HTMLImageElement | ImageBitmap, center: [number, number], t: MapXform, step = 3): PieceSource {
  const W = img.width, H = img.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img as CanvasImageSource, 0, 0);
  const data = g.getImageData(0, 0, W, H);
  const mw = Math.ceil(W / step), mh = Math.ceil(H / step);
  const mask = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const px = Math.min(W - 1, x * step + (step >> 1)), py = Math.min(H - 1, y * step + (step >> 1));
    mask[y * mw + x] = data.data[(py * W + px) * 4 + 3] > 110 ? 1 : 0;
  }
  let pts = traceMask(mask, mw, mh);
  pts = simplifyClosed(pts, 0.9);
  if (pts.length > 600) pts = simplifyClosed(pts, 2);
  const x0 = center[0] - W / 2, y0 = center[1] - H / 2;
  const outline = normalizeOutline(pts.map(([x, y]) => mapToPlane(t, x0 + x * step, y0 + y * step)));

  // 纸面：灰度压到 0.78–1.05 的窄区间，省色由材质染色决定，山与河的白线保留
  let sum = 0, n = 0;
  for (let i = 0; i < W * H; i++) if (data.data[i * 4 + 3] > 110) { sum += data.data[i * 4]; n++; }
  const mean = n ? sum / n : 128;
  for (let i = 0; i < W * H; i++) {
    const v = Math.min(255, Math.max(0, 0.86 * 255 + (data.data[i * 4] - mean) * 0.75));
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = v;
    data.data[i * 4 + 3] = 255;
  }
  g.putImageData(data, 0, 0);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace; tex.minFilter = LinearMipmapLinearFilter; tex.anisotropy = 4;
  const [ix, iy] = mapToPlane(t, x0, y0);
  return { outline, texture: tex, imageRect: [ix, iy, W * t.scale, H * t.scale] };
}

/** 挤出 + 平放 + aSide + 平面 UV。 */
export function buildSlab(outline: Pt[], depth: number, rect?: [number, number, number, number]): BufferGeometry {
  const shape = new Shape(outline.map(([x, y]) => ({ x, y }) as never));
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  const count = g.getAttribute('position').count;
  const side = new Float32Array(count);
  const sg = g.groups[1];
  if (sg) for (let i = sg.start; i < sg.start + sg.count; i++) side[i] = 1;
  g.setAttribute('aSide', new Float32BufferAttribute(side, 1));
  if (rect) {
    const pos = g.getAttribute('position'), uv = new Float32Array(count * 2);
    const [x0, yTop, w, h] = rect;
    for (let i = 0; i < count; i++) {
      uv[i * 2] = (pos.getX(i) - x0) / w;
      uv[i * 2 + 1] = 1 - (yTop - pos.getY(i)) / h;
    }
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
  g.rotateX(-Math.PI / 2);
  g.clearGroups();
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

let coreMat: MeshLambertMaterial | null = null;
export function getCoreMaterial(): MeshLambertMaterial {
  return (coreMat ??= createPaperMaterial({ color: '#f6efdf', doubleSided: false, cutout: false, vertexSide: true, fibre: 0.25 }));
}

/** 一片省域：面纸 + 纸芯 两层挤出，五个量各一个弹簧。工单 M3-WO2 §3。 */
export class ProvincePiece extends Group {
  readonly top: Mesh<BufferGeometry, MeshLambertMaterial>;
  readonly core: Mesh<BufferGeometry, MeshLambertMaterial>;
  readonly springs: PieceSprings;
  readonly label: Pt;
  readonly area: number;
  readonly outline: Pt[];
  private base: Lab; private baseFrom: Lab; private baseTo: Lab; private baseT = 1;
  private accent: Lab;
  private local: PaperLocals;
  private shake = 0;
  private sharedTexture = false;
  private dirty = true;
  /** 进场演出用：额外下沉。 */
  introOffset = 0;

  constructor(readonly pid: string, src: PieceSource, gap: number, layerHeight: number, baseColor: string, accentColor: string) {
    super();
    this.outline = src.outline;
    const topOutline = insetPolygon(src.outline, gap) ?? src.outline;
    const coreOutline = insetPolygon(src.outline, gap * 0.35) ?? src.outline;
    this.sharedTexture = !!src.sharedTexture;
    const mat = createPaperMaterial({ map: src.texture, cutout: false, doubleSided: false, vertexSide: true, fibre: 0.3, color: 0xffffff });
    this.local = mat.userData.paper as PaperLocals;
    this.top = new Mesh(buildSlab(topOutline, T_TOP, src.texture ? src.imageRect : undefined), mat);
    this.top.position.y = T_CORE;
    this.core = new Mesh(buildSlab(coreOutline, T_CORE), getCoreMaterial());
    this.core.layers.set(LAYER_DECOR);
    for (const m of [this.top, this.core]) { m.castShadow = m.receiveShadow = true; }
    this.top.userData.pieceId = pid;
    this.add(this.core, this.top);
    this.springs = new PieceSprings(layerHeight);
    this.label = labelPoint(src.outline);
    let a = 0; for (let i = 0; i < src.outline.length; i++) { const p = src.outline[i], q = src.outline[(i + 1) % src.outline.length]; a += p[0] * q[1] - q[0] * p[1]; }
    this.area = Math.abs(a) / 2;
    this.base = this.baseFrom = this.baseTo = hexToOklab(baseColor);
    this.accent = hexToOklab(accentColor);
    this.position.y = this.springs.lift.x;
  }

  get state(): PieceState { return this.springs.state; }
  setState(s: PieceState): void { if (this.springs.state !== s) { this.springs.state = s; this.dirty = true; } }
  setBase(hex: string, immediate = false): void {
    const to = hexToOklab(hex);
    if (to.every((v, i) => Math.abs(v - this.baseTo[i]) < 1e-6)) return;
    this.baseFrom = this.base; this.baseTo = to; this.baseT = immediate ? 1 : 0; this.dirty = true;
    if (immediate) this.base = to;
  }
  setAccent(hex: string): void { this.accent = hexToOklab(hex); this.dirty = true; }
  /** 锁定片被点：±0.01 抖动。 */
  jolt(): void { this.shake = 1; this.dirty = true; }
  markDirty(): void { this.dirty = true; }

  /** 顶面高度（世界 y）。 */
  get topY(): number { return this.position.y + T_CORE + T_TOP; }
  /** 当前 lift 是否在动（决定阴影是否重画）。 */
  get liftMoving(): boolean { return Math.abs(this.springs.lift.v) > 1e-3 || this.shake > 0; }

  update(dt: number, reduced: boolean): boolean {
    if (!this.dirty && this.springs.settled() && this.baseT >= 1 && this.shake <= 0 && this.introOffset === 0) return false;
    this.springs.step(dt, reduced);
    if (this.baseT < 1) {
      this.baseT = Math.min(1, this.baseT + dt / (reduced ? 0.08 : 0.3));
      const k = this.baseT;
      this.base = [0, 1, 2].map((i) => this.baseFrom[i] + (this.baseTo[i] - this.baseFrom[i]) * k) as Lab;
    }
    const s = this.springs;
    const [r, g, b] = pieceColor(this.base, this.accent, s.accent.x, s.dim.x, s.sat.x);
    this.top.material.color.setRGB(r, g, b, SRGBColorSpace).multiplyScalar(this.sharedTexture ? TINT_GAIN : 1);
    this.local.uPaperFlash.value = Math.max(0, (s.rim.x - 1) * 0.18);
    let x = 0;
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt / 0.3); x = Math.sin(this.shake * 40) * 0.01 * this.shake; }
    this.position.set(x, s.lift.x - this.introOffset, 0);
    const settled = s.settled() && this.baseT >= 1 && this.shake <= 0;
    this.dirty = !settled;
    return true;
  }

  worldBox(out = new Box3()): Box3 { return out.setFromObject(this.top); }
  labelWorld(out = new Vector3()): Vector3 { return out.set(this.label[0], this.topY + 0.01, -this.label[1]); }

  dispose(): void {
    this.top.geometry.dispose(); this.core.geometry.dispose();
    if (!this.sharedTexture) this.top.material.map?.dispose();
    this.top.material.dispose();
  }
}
