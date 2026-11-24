import { CanvasTexture, DataArrayTexture, LinearMipmapLinearFilter, NearestFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import { fetchBitmap, fetchJson } from './atlasLoader';
import { GROUND_TYPES, MAX_VARIANTS, TERRAIN_KEYS, terrainUrls } from './terrain';

/** 图集单元像素。 */
export const ATLAS_CELL = 128;

/**
 * 原版方块图是宽 512、高 700–831 不等的等距立方体：顶面是一个约 2:1 的菱形，半高 ≈ 130px。
 * 左右两角的 y 逐图测量（左右边缘第一个不透明像素），上角 = 两角 y − 半高。
 * 取其内缩 INSET 后的部分，避开边沿描线与伸出顶面的装饰。
 */
export const TOP_HALF_H = 130;
const INSET = 0.84;

const probe = document.createElement('canvas');
/** 测量左右两角的 y（像素）。 */
export function measureSideCornerY(img: HTMLImageElement): number {
  const W = img.naturalWidth, H = img.naturalHeight;
  probe.width = W; probe.height = H;
  const g = probe.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, W, H); g.drawImage(img, 0, 0);
  const col = (x: number) => {
    const d = g.getImageData(x, 0, 1, H).data;
    for (let y = 0; y < H; y++) if (d[y * 4 + 3] > 128) return y;
    return 200;
  };
  return (col(4) + col(W - 5)) / 2;
}

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

/** 把菱形顶面仿射展开到 [ox, ox+S]×[oy, oy+S] 的正方形。u 沿 T→R，v 沿 T→L。 */
export function drawTopFace(g: CanvasRenderingContext2D, img: HTMLImageElement, ox: number, oy: number, S: number): void {
  const W = img.naturalWidth, yc = measureSideCornerY(img);
  const tx = W / 2, ty = yc - TOP_HALF_H, rx = W, ry = yc, lx = 0, ly = yc;
  const cx = W / 2, cy = yc;                                    // 菱形中心
  const k = INSET;
  const Tx = cx + (tx - cx) * k, Ty = cy + (ty - cy) * k;
  const e1x = (rx - tx) * k, e1y = (ry - ty) * k, e2x = (lx - tx) * k, e2y = (ly - ty) * k;
  const det = e1x * e2y - e2x * e1y;
  const a = S * e2y / det, c = -S * e2x / det, b = -S * e1y / det, d = S * e1x / det;
  g.save();
  g.beginPath(); g.rect(ox, oy, S, S); g.clip();
  g.setTransform(a, b, c, d, ox - (a * Tx + c * Ty), oy - (b * Tx + d * Ty));
  g.drawImage(img, 0, 0);
  g.restore();
}

/** 缺素材时各地形（原版 0–15 号）的纯色。 */
export const GROUND_FALLBACK_COLORS: readonly string[] = ['#7d7a68', '#8a7356', '#93955f', '#a9b072', '#5f8a4c', '#b7a35c', '#7aa27a', '#8d8a80',
  '#7f9c58', '#8fa96a', '#5f86a2', '#3f6b3d', '#5e5650', '#6c7655', '#c7b3a0', '#a89a72'];

/** 纯色地面图集：与 buildGroundAtlas 同一布局（列 = 地形、行 = 变体），每格 1 个纯色像素，走同一段着色器。 */
export function buildSolidGroundAtlas(): { texture: CanvasTexture; variants: number[] } {
  const cv = document.createElement('canvas');
  cv.width = GROUND_TYPES; cv.height = MAX_VARIANTS;
  const g = cv.getContext('2d')!;
  for (let t = 0; t < GROUND_TYPES; t++) { g.fillStyle = GROUND_FALLBACK_COLORS[t]; g.fillRect(t, 0, 1, MAX_VARIANTS); }
  const texture = new CanvasTexture(cv);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  return { texture, variants: new Array(GROUND_TYPES).fill(1) };
}

/** 地面图集：列 = 地形 0–15，行 = 变体 0–3。缺素材的格子填纯色。 */
export async function buildGroundAtlas(signal?: AbortSignal): Promise<{ texture: CanvasTexture; variants: number[] }> {
  const S = ATLAS_CELL;
  const cv = document.createElement('canvas');
  cv.width = S * GROUND_TYPES; cv.height = S * MAX_VARIANTS;
  const g = cv.getContext('2d')!;
  const variants: number[] = [];
  const fallback = GROUND_FALLBACK_COLORS;
  await Promise.all(Array.from({ length: GROUND_TYPES }, async (_, t) => {
    const urls = terrainUrls(t).slice(0, MAX_VARIANTS);
    const imgs = (await Promise.all(urls.map(loadImage))).filter((i): i is HTMLImageElement => !!i);
    variants[t] = Math.max(1, imgs.length);
    for (let v = 0; v < MAX_VARIANTS; v++) {
      const img = imgs[v % Math.max(1, imgs.length)];
      if (img) drawTopFace(g, img, t * S, v * S, S);
      else { g.fillStyle = fallback[t]; g.fillRect(t * S, v * S, S, S); }
    }
  }));
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const texture = new CanvasTexture(cv);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.flipY = false;               // 行号自上而下，与着色器一致
  texture.anisotropy = 4;
  return { texture, variants };
}

// ── 自产底纸数组（WO3 §3.1 / §3.2，tools/art/build_ground_array.py 的输出）──

/** ground.json：18 层 = PLAN §3.6 的 17 种自然地形 + settlement；strip 为竖向长图（可缺，缺则逐层文件）。 */
export interface GroundJson {
  size: number;
  count: number;
  layers: { layer: number; terrain: string; artKey?: string; file: string; noRotate?: boolean }[];
  terrainToLayer: Record<string, number>;
  strip?: string;
}

export interface GroundArray {
  texture: DataArrayTexture;
  size: number;
  layers: number;
  /** 原版地面 0–15 号 → 数组层号；没有对应层时为 -1（该格走纯色）。 */
  layerOf: number[];
  /** 原版地面 0–15 号 → 是否禁止旋转（只做 0° / 180°）。 */
  noRotate: boolean[];
}

/** 每张底纸覆盖的格数（uGroundSpan）。 */
export const GROUND_SPAN = 2;

function parseGroundJson(v: unknown): GroundJson | null {
  const o = v as GroundJson;
  if (!o || typeof o !== 'object' || !(o.size > 0) || !Array.isArray(o.layers) || !o.layers.length) return null;
  if (!o.terrainToLayer || typeof o.terrainToLayer !== 'object') return null;
  return o;
}

/**
 * 读 <basePath>/ground/ground.json 与底纸（优先长图 strip，没有就逐层文件），建 DataArrayTexture(size, size, 层数)。
 * 读不到 / 格式不对 / 缺层 → null（调用方回落到纯色格或原版方块图）。
 */
export async function loadGroundArray(basePath: string, signal?: AbortSignal): Promise<GroundArray | null> {
  const dir = (basePath.endsWith('/') ? basePath : `${basePath}/`) + 'ground/';
  const meta = parseGroundJson(await fetchJson(`${dir}ground.json`, signal));
  if (!meta) { console.info(`[region-art] 底纸：${dir}ground.json 读不到，回落`); return null; }
  const S = meta.size, L = Math.max(meta.count | 0, ...meta.layers.map((l) => l.layer + 1));
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const data = new Uint8Array(S * S * 4 * L);
  const put = (img: CanvasImageSource, layer: number, sy = 0) => {
    g.clearRect(0, 0, S, S);
    g.drawImage(img, 0, sy, S, S, 0, 0, S, S);
    data.set(g.getImageData(0, 0, S, S).data, layer * S * S * 4);
  };
  let ok = false;
  let present: Set<number> | null = null;      // 逐层读时实际读到的层；长图 = 全有
  if (meta.strip) {
    const bmp = await fetchBitmap(dir + meta.strip, signal);
    if (bmp && bmp.width === S && bmp.height >= S * L) {
      for (let i = 0; i < L; i++) put(bmp, i, i * S);
      ok = true;
    } else if (bmp) console.warn(`[region-art] 底纸长图 ${bmp.width}×${bmp.height} 不是 ${S}×${S * L}，改读逐层文件`);
    bmp?.close();
  }
  if (!ok) {
    const bmps = await Promise.all(meta.layers.map((l) => fetchBitmap(dir + l.file, signal)));
    const missing = meta.layers.filter((_, i) => !bmps[i]).map((l) => l.file);
    if (missing.length === meta.layers.length) { console.warn('[region-art] 底纸逐层文件全部读不到，回落'); return null; }
    if (missing.length) console.warn(`[region-art] 底纸缺 ${missing.length} 层（这些地形走纯色）：${missing.join(', ')}`);
    meta.layers.forEach((l, i) => { const b = bmps[i]; if (b) { put(b, l.layer); b.close(); } });
    present = new Set(meta.layers.filter((_, i) => bmps[i]).map((l) => l.layer));
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const tex = new DataArrayTexture(data, S, S, L);
  tex.format = RGBAFormat; tex.type = UnsignedByteType;
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const has = (layer: number) => layer >= 0 && layer < L && (!present || present.has(layer));
  const layerOf = TERRAIN_KEYS.map((k) => { const l = meta.terrainToLayer[k]; return typeof l === 'number' && has(l) ? l : -1; });
  const noRotate = TERRAIN_KEYS.map((k) => !!meta.layers.find((l) => l.terrain === k)?.noRotate);
  console.info(`[region-art] 底纸数组：${L} 层 ${S}²，原版地形映射 ${layerOf.join(',')}`);
  return { texture: tex, size: S, layers: L, layerOf, noRotate };
}
