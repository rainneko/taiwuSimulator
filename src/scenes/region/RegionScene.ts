import {
  CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, LinearMipmapLinearFilter, MathUtils, PCFSoftShadowMap,
  Scene, SRGBColorSpace, Texture, TextureLoader, Vector3, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import type { AssetCache } from '../../app/AssetCache';
import type { ScenePointerEvent } from '../../app/InputRouter';
import type { IScene, NdcRect } from '../../app/SceneManager';
import type { Screen } from '../../app/store';
import { createPaperMaterial, makeCardGeometry, PaperCard } from '../../render/paper';
import { buildGroundAtlas } from './GroundAtlas';
import { GridGround, Hl } from './GridGround';
import { findPath, pathCost } from './pathfinding';
import { RegionCamera, ZOOM_DIST } from './RegionCamera';
import { makeSampleRegion, regionCost, type RegionData, type RegionLocation } from './regionData';
import { locationKind, terrainName, terrainUrls } from './terrain';

export interface RegionEnterParams { regionId?: string; region?: RegionData }

export interface CellInfo {
  cell: number; x: number; y: number;
  terrain: string; cost: number;
  location: RegionLocation | null;
  path: number[] | null; pathCost: number;
}

const HOP_MS = 170, HOP_ARC = 0.22;
const STANDEE_W = 1.0, STANDEE_ASPECT = 831 / 512;

/** 地区格子地图。 */
export class RegionScene implements IScene {
  readonly id: Screen = 'region';
  readonly scene = new Scene();
  readonly rig = new RegionCamera();
  region: RegionData | null = null;
  ground: GridGround | null = null;
  /** 地点立牌（WO3 之后可换成 PaperBatch）。 */
  standees: PaperCard[] = [];
  token: PaperCard | null = null;

  /** 外部（HUD / dev 页）订阅：选中格变化、玩家移动。 */
  onSelect: ((info: CellInfo | null) => void) | null = null;
  onMoved: ((cell: number) => void) | null = null;
  /** 地区地图的移动规则可由 core 覆盖；默认按地形耗费。 */
  costFn: ((cell: number) => number) | null = null;

  private atlas: { texture: Texture; variants: number[] } | null = null;
  private standeeTex = new Map<number, Texture[]>();
  private root = new Group();
  private sun = new DirectionalLight(0xfff1dc, 2.4);
  private view = { w: 1, h: 1 };
  private hover = -1;
  private selected = -1;
  private playerCell = 0;
  private walk: { path: number[]; i: number; t: number; queued: number | null } | null = null;
  private tokenPos = new Vector3();
  private intro = 0;
  private loader = new TextureLoader();

  constructor() {
    this.scene.background = new Color(0xe6dcc6);
    this.scene.add(new HemisphereLight(0xfffaf0, 0x8a7a60, 1.3));
    this.sun.position.set(-6, 12, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.root);
  }

  // ── IScene ──
  async preload(_assets: AssetCache, signal: AbortSignal): Promise<void> {
    if (!this.atlas) this.atlas = await buildGroundAtlas(signal);
  }

  enter(params: unknown, _from: Screen | null): void {
    const p = (params ?? {}) as RegionEnterParams;
    this.build(p.region ?? makeSampleRegion(24, hashStr(p.regionId ?? 'sample')));
  }

  exit(_to: Screen): void { this.walk = null; this.setHover(-1); }

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.stepWalk(dt);
    if (this.token) this.token.position.copy(this.tokenPos);
    for (const s of this.standees) s.update(dt);
    this.token?.update(dt);
    this.rig.update(dt);
    // 阴影相机跟着视野中心
    const t = this.rig.target;
    this.sun.target.position.copy(t);
    this.sun.position.set(t.x - 6, 12, t.z + 4);
    this.intro += dt;
    this.ground?.flush();
  }

  render(r: WebGLRenderer, target: WebGLRenderTarget | null): void {
    if (!r.shadowMap.enabled) { r.shadowMap.enabled = true; r.shadowMap.type = PCFSoftShadowMap; }
    r.setRenderTarget(target);
    r.render(this.scene, this.rig.camera);
    r.setRenderTarget(null);
  }

  resize(w: number, h: number): void { this.view = { w, h }; this.rig.resize(w, h); }

  isIdle(): boolean { return !this.walk && !this.standees.some((s) => s.moving) && !this.token?.moving; }

  /** 玩家令牌附近 3×3 格在屏幕上的外接矩形。 */
  getFocusRect(): NdcRect | null {
    if (!this.region) return null;
    const c = this.rig.camera, v = new Vector3(), n = this.region.size;
    let x0 = 1, y0 = 1, x1 = -1, y1 = -1;
    for (const [x, z] of [[0, 0], [n, 0], [0, n], [n, n]]) {
      v.set(x, 0, z).project(c);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, y0, x1, y1 };
  }

  /** dive 进入：先拉远到整图入画，再缓出到跟随构图。 */
  alignTo(_rect: NdcRect): void {
    if (!this.region) return;
    const n = this.region.size;
    this.rig.snap(new Vector3(n / 2, 0, n / 2), n * 1.6);
    this.rig.follow = this.tokenPos;
  }

  setDiveProgress(t: number, dir: 'dive' | 'rise'): void {
    if (dir === 'rise' && this.region) {
      // 返回大地图：镜头往上拉
      this.rig.dist = MathUtils.lerp(ZOOM_DIST[this.rig.zoomLevel], this.region.size * 1.6, t);
    }
  }

  onPointer(e: ScenePointerEvent): void {
    switch (e.type) {
      case 'move': this.setHover(this.cellAt(e)); break;
      case 'leave': this.setHover(-1); break;
      case 'drag': if (e.delta) this.rig.pan(e.delta[0], e.delta[1], this.view.h); break;
      case 'wheel': if (e.delta) this.rig.setZoom(this.rig.zoomLevel + Math.sign(e.delta[1])); break;
      case 'pinch': if (e.delta) this.rig.setZoom(this.rig.zoomLevel + (e.delta[0] > 1.15 ? -1 : e.delta[0] < 0.87 ? 1 : 0)); break;
      case 'click': {
        const c = this.cellAt(e);
        if (c < 0) { this.select(-1); break; }
        if (c === this.selected && c !== this.playerCell) this.moveTo(c);
        else this.select(c);
        break;
      }
    }
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === '=' || e.key === '+') { this.rig.setZoom(this.rig.zoomLevel - 1); return true; }
    if (e.key === '-') { this.rig.setZoom(this.rig.zoomLevel + 1); return true; }
    if (e.key === 'f' || e.key === ' ') { this.rig.follow = this.tokenPos; return true; }
    return false;
  }

  dispose(): void {
    this.clear();
    this.atlas?.texture.dispose();
    for (const arr of this.standeeTex.values()) for (const t of arr) t.dispose();
  }

  // ── 公共操作 ──
  cost = (cell: number): number => this.costFn ? this.costFn(cell) : this.region ? regionCost(this.region, cell) : 1;

  select(cell: number): void {
    const g = this.ground;
    if (!g) return;
    g.clearFlag(Hl.Selected); g.clearFlag(Hl.Path); g.clearFlag(Hl.PathIllegal);
    this.selected = cell;
    if (cell < 0) { this.onSelect?.(null); return; }
    g.setFlag(cell, Hl.Selected, true);
    const path = cell === this.playerCell ? null : findPath(this.region!.size, this.playerCell, cell, this.cost);
    if (path) for (const c of path.slice(1)) g.setFlag(c, Hl.Path, true);
    this.onSelect?.(this.info(cell, path));
  }

  /** 沿 A* 路径逐格跳过去；移动中再调用会在当前一跳结束后改道。 */
  moveTo(cell: number): boolean {
    if (!this.region) return false;
    if (this.walk) { this.walk.queued = cell; return true; }
    const path = findPath(this.region.size, this.playerCell, cell, this.cost);
    if (!path || path.length < 2) return false;
    this.walk = { path, i: 0, t: 0, queued: null };
    this.rig.follow = this.tokenPos;
    return true;
  }

  info(cell: number, path: number[] | null = null): CellInfo {
    const r = this.region!, n = r.size;
    const loc = r.locations.find((l) => l.cell === cell) ?? null;
    return {
      cell, x: cell % n, y: (cell / n) | 0,
      terrain: loc ? terrainName(loc.type) : terrainName(r.ground[cell]),
      cost: this.cost(cell), location: loc, path, pathCost: path ? pathCost(path, this.cost) : 0,
    };
  }

  get player(): number { return this.playerCell; }

  cellCenter(cell: number, out = new Vector3()): Vector3 {
    const n = this.region?.size ?? 1;
    return out.set((cell % n) + 0.5, 0, ((cell / n) | 0) + 0.5);
  }

  // ── 内部 ──
  private build(r: RegionData): void {
    this.clear();
    this.region = r;
    const n = r.size;
    const g = this.ground = new GridGround(n);
    g.setAtlas(this.atlas?.texture ?? null);
    g.setTerrain(r.ground, r.variant, this.atlas?.variants ?? []);
    this.root.add(g.mesh);
    this.playerCell = r.playerCell;
    this.cellCenter(r.playerCell, this.tokenPos);
    this.rig.setBounds(0, 0, n, n);
    this.rig.snap(this.tokenPos.clone(), ZOOM_DIST[this.rig.zoomLevel]);
    this.rig.follow = this.tokenPos;
    const half = n * 0.6;
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 0.5; sc.far = 60;
    sc.updateProjectionMatrix();

    // 地点立牌：从地面立起，由近及远
    for (const loc of r.locations) {
      const card = this.makeStandee(loc);
      const c = this.cellCenter(loc.cell);
      card.position.set(c.x, 0.001, c.z - 0.2);
      const d = Math.hypot(c.x - this.tokenPos.x, c.z - this.tokenPos.z);
      card.rise(0.25 + d * 0.06);
      this.standees.push(card);
      this.root.add(card);
    }
    // 玩家令牌
    this.token = new PaperCard(makeCardGeometry({ width: 0.42, height: 0.62, uv: [0, 0, 1, 1] }),
      createPaperMaterial({ map: tokenTexture() }));
    this.token.rise(0.1);
    this.root.add(this.token);
    this.intro = 0;
  }

  private makeStandee(loc: RegionLocation): PaperCard {
    const geo = makeCardGeometry({ width: STANDEE_W, height: STANDEE_W * STANDEE_ASPECT, uv: [0, 0, 1, 1] });
    const urls = terrainUrls(loc.type);
    const mat = createPaperMaterial({ color: urls.length ? 0xffffff : kindColor(locationKind(loc.type)), cutout: true });
    const card = new PaperCard(geo, mat);
    card.name = `standee:${loc.name}`;
    if (!urls.length) return card;
    let arr = this.standeeTex.get(loc.type);
    if (!arr) this.standeeTex.set(loc.type, arr = []);
    const v = loc.cell % urls.length;
    // 原图高度不一：按实际宽高比拉伸
    let tex = arr[v];
    if (!tex) {
      tex = arr[v] = this.loader.load(urls[v], (t) => { t.userData.ready = true; for (const c of this.standees) if (c.material.map === t) fitCard(c, t); });
      tex.colorSpace = SRGBColorSpace; tex.minFilter = LinearMipmapLinearFilter; tex.anisotropy = 4;
    } else if (tex.userData.ready) fitCard(card, tex);
    mat.map = tex; mat.needsUpdate = true;
    return card;
  }

  private stepWalk(dt: number): void {
    const w = this.walk;
    if (!w || !this.region) return;
    w.t += dt * 1000 / HOP_MS;
    const a = this.cellCenter(w.path[w.i]), b = this.cellCenter(w.path[w.i + 1]);
    const t = Math.min(1, w.t);
    this.tokenPos.lerpVectors(a, b, t);
    this.tokenPos.y = Math.sin(t * Math.PI) * HOP_ARC;
    if (w.t < 1) return;
    // 落地一格
    w.i++; w.t = 0;
    this.playerCell = w.path[w.i];
    this.tokenPos.y = 0;
    this.ground?.setFlag(this.playerCell, Hl.Path, false);
    this.token?.nudge(-2.5);
    this.onMoved?.(this.playerCell);
    if (w.queued !== null) {
      const q = w.queued; this.walk = null;
      this.select(q); this.moveTo(q); return;
    }
    if (w.i >= w.path.length - 1) { this.walk = null; this.select(this.playerCell); }
  }

  private cellAt(e: ScenePointerEvent): number {
    if (!this.region) return -1;
    const p = this.rig.groundAt(e.ndc);
    if (!p) return -1;
    const n = this.region.size, x = Math.floor(p.x), y = Math.floor(p.z);
    return x < 0 || y < 0 || x >= n || y >= n ? -1 : y * n + x;
  }

  private setHover(c: number): void {
    if (c === this.hover || !this.ground) return;
    if (this.hover >= 0) this.ground.setFlag(this.hover, Hl.Hover, false);
    this.hover = c;
    if (c >= 0) this.ground.setFlag(c, Hl.Hover, true);
  }

  private clear(): void {
    for (const s of this.standees) { s.geometry.dispose(); s.material.dispose(); }
    this.standees = [];
    if (this.token) { this.token.geometry.dispose(); this.token.material.map?.dispose(); this.token.material.dispose(); this.token = null; }
    this.ground?.dispose(); this.ground = null;
    this.root.clear();
    this.walk = null; this.hover = -1; this.selected = -1;
  }
}

function fitCard(card: PaperCard, t: Texture): void {
  const im = t.image as { width?: number; height?: number } | null;
  if (im?.width && im.height) card.scale.y = im.height / im.width / STANDEE_ASPECT;
}

function hashStr(s: string): number { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

function kindColor(k: string): number {
  return ({ city: 0x9a4a3a, sect: 0x5a6a8a, village: 0x8a7a50, town: 0xa0804a, fort: 0x6a5a4a, taiwu: 0x7a3a5a, abyss: 0x2a2a3a } as Record<string, number>)[k] ?? 0x888888;
}

/** 占位令牌：朱色圆牌 + 小人剪影。 */
function tokenTexture(): Texture {
  const W = 128, H = 190, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.filter = 'blur(0.8px)';
  g.fillStyle = '#f4ecdc';
  g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 28); g.fill();
  g.fillStyle = '#a3352a';
  g.beginPath(); g.arc(W / 2, 52, 22, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(W / 2 - 34, H - 22); g.quadraticCurveTo(W / 2, 64, W / 2 + 34, H - 22); g.fill();
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}
