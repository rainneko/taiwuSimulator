import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace, Texture } from 'three';
import type { Atlas, AtlasFrame, AtlasJson } from '../../render/paper';
import { makePlaceholderAtlas } from './placeholderArt';
import { FRAMES, setFrameSizes } from './regionArt';

/**
 * 地区场景的四张立牌图集（WO3 §3.8）：真实图集由 tools/art/pack_atlas.py 打包，
 * 输出 <basePath>/<id>.json（AtlasJson）+ 同目录下 json.image 指向的图片。
 * 逐帧回落：图集整张读不到 → 全用占位帧；JSON 里缺某帧 → 只把缺的那几帧从占位图集补进来。
 */
export type RegionAtlasId = 'terrain' | 'detail' | 'houses' | 'locations';

/** real = 全部来自真实图集；mixed = 真实图集 + 补了占位帧；placeholder = 整张退化为占位。 */
export type AtlasSource = 'real' | 'mixed' | 'placeholder';

export interface RegionAtlas extends Atlas { source: AtlasSource; missing: string[] }
export type RegionAtlases = Record<RegionAtlasId, RegionAtlas>;

interface AtlasSpec { file: string; size: [number, number]; owns: (name: string) => boolean }

/** 每张图集装哪些帧（WO3 §1.1 的「图集」列）。 */
export const ATLAS_SPECS: Readonly<Record<RegionAtlasId, AtlasSpec>> = {
  terrain: { file: 'region-terrain', size: [4096, 2048], owns: (n) => n.startsWith('terrain.standee.') || n.startsWith('loc.prop.') },
  detail: { file: 'region-detail', size: [2048, 1024], owns: (n) => n.startsWith('filler.') || n.startsWith('ground.piece.') },
  houses: { file: 'region-houses', size: [2048, 1024], owns: (n) => n.startsWith('house.') },
  locations: { file: 'region-locations', size: [4096, 2048], owns: (n) => n.startsWith('poi.') || (n.startsWith('loc.') && !n.startsWith('loc.prop.')) },
};
const IDS = Object.keys(ATLAS_SPECS) as RegionAtlasId[];

export const DEFAULT_REGION_ART_BASE = `${import.meta.env.BASE_URL}content/base/art/region/`;
const TAG = '[region-art]';

const abortErr = () => new DOMException('aborted', 'AbortError');
const joinUrl = (base: string, file: string) => (base.endsWith('/') ? base : `${base}/`) + file;

export async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) return null;
    // Vite dev 服务器对不存在的路径回 index.html（200）：按内容类型 / 解析失败判缺
    const text = await r.text();
    return JSON.parse(text) as unknown;
  } catch (e) {
    if (signal?.aborted) throw abortErr();
    return null;
  }
}

/**
 * 读图片为 ImageBitmap：WO3 §3.1 要求不预乘、不做色彩空间转换（保住工具链做的边缘颜色外扩）。
 * 失败返回 null。flipY 交给调用方（ImageBitmap 不吃 UNPACK_FLIP_Y）。
 */
export async function fetchBitmap(url: string, signal?: AbortSignal, flipY = false): Promise<ImageBitmap | null> {
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob.type.startsWith('image/')) return null;
    return await createImageBitmap(blob, {
      premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: flipY ? 'flipY' : 'from-image',
    });
  } catch {
    if (signal?.aborted) throw abortErr();
    return null;
  }
}

function isFrame(f: unknown): f is AtlasFrame {
  const o = f as AtlasFrame;
  return !!o && typeof o.name === 'string' && Array.isArray(o.rect) && o.rect.length === 4 && Array.isArray(o.size) && o.size.length === 2;
}
function parseAtlasJson(v: unknown): AtlasJson | null {
  const o = v as AtlasJson;
  if (!o || typeof o !== 'object' || typeof o.image !== 'string' || !Array.isArray(o.size) || !Array.isArray(o.frames)) return null;
  return { image: o.image, size: [o.size[0], o.size[1]], feather: Number(o.feather) || 0, padding: Number(o.padding) || 0, frames: o.frames.filter(isFrame) };
}

function styleTex<T extends Texture>(t: T): T {
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

interface Loaded { json: AtlasJson; bitmap: ImageBitmap }

async function loadOne(base: string, id: RegionAtlasId, signal?: AbortSignal): Promise<Loaded | null> {
  const url = joinUrl(base, `${ATLAS_SPECS[id].file}.json`);
  const json = parseAtlasJson(await fetchJson(url, signal));
  if (!json) { console.info(`${TAG} ${id}: ${url} 读不到，整张用占位`); return null; }
  const bitmap = await fetchBitmap(joinUrl(base, json.image), signal, true);
  if (!bitmap) { console.warn(`${TAG} ${id}: 图片 ${json.image} 读不到，整张用占位`); return null; }
  const exp = ATLAS_SPECS[id].size;
  if (bitmap.width !== json.size[0] || bitmap.height !== json.size[1]) {
    console.warn(`${TAG} ${id}: 图片 ${bitmap.width}×${bitmap.height} 与 JSON size ${json.size.join('×')} 不符，按图片实际尺寸算 UV`);
    json.size = [bitmap.width, bitmap.height];
  } else if (json.size[0] !== exp[0] || json.size[1] !== exp[1]) {
    console.info(`${TAG} ${id}: 尺寸 ${json.size.join('×')}（规格 ${exp.join('×')}）`);
  }
  return { json, bitmap };
}

/** 占位图集里属于这张图集的帧（共用占位贴图）。 */
function placeholderPart(ph: Atlas, id: RegionAtlasId): RegionAtlas {
  const frames = ph.json.frames.filter((f) => ATLAS_SPECS[id].owns(f.name));
  return { json: { ...ph.json, frames }, texture: ph.texture, source: 'placeholder', missing: frames.map((f) => f.name) };
}

/** 真实图集 + 缺帧补丁：缺帧时把占位画布拼到真实图集下方，生成一张合并贴图。 */
function compose(id: RegionAtlasId, real: Loaded, ph: Atlas): RegionAtlas {
  const have = new Set(real.json.frames.map((f) => f.name));
  const want = Object.keys(FRAMES).filter(ATLAS_SPECS[id].owns);
  const missing = want.filter((n) => !have.has(n));
  if (!missing.length) {
    // ImageBitmap 不吃 UNPACK_FLIP_Y：解码时已翻转（loadOne 的 flipY），这里 flipY = false
    const tex = styleTex(new Texture(real.bitmap));
    tex.flipY = false;
    return { json: real.json, texture: tex, source: 'real', missing };
  }
  const phCanvas = ph.texture.image as HTMLCanvasElement;
  const [W, H] = real.json.size;
  const cv = document.createElement('canvas');
  cv.width = Math.max(W, phCanvas.width); cv.height = H + phCanvas.height;
  const g = cv.getContext('2d')!;
  g.save(); g.translate(0, H); g.scale(1, -1); g.drawImage(real.bitmap, 0, 0); g.restore();   // 解码时翻过，翻回来
  g.drawImage(phCanvas, 0, H);
  real.bitmap.close();
  const byName = new Map(ph.json.frames.map((f) => [f.name, f]));
  const patch: AtlasFrame[] = [];
  for (const n of missing) {
    const f = byName.get(n);
    if (f) patch.push({ ...f, rect: [f.rect[0], f.rect[1] + H, f.rect[2], f.rect[3]] });
  }
  console.warn(`${TAG} ${id}: 缺 ${missing.length} 帧，用占位补：${missing.join(', ')}`);
  return {
    json: { ...real.json, size: [cv.width, cv.height], frames: [...real.json.frames, ...patch] },
    texture: styleTex(new CanvasTexture(cv)), source: 'mixed', missing,
  };
}

/**
 * 读 terrain-art.json（可带 frames 覆盖帧尺寸）与四张图集，重建 FRAMES，逐帧回落到占位。
 * 永不因缺素材而失败；只有 signal 中止时抛 AbortError。
 */
export async function loadRegionAtlases(basePath = DEFAULT_REGION_ART_BASE, signal?: AbortSignal): Promise<RegionAtlases> {
  console.info(`${TAG} 加载地区图集：${basePath}`);
  const [params, ...loaded] = await Promise.all([
    fetchJson(joinUrl(basePath, 'terrain-art.json'), signal),
    ...IDS.map((id) => loadOne(basePath, id, signal)),
  ]);
  if (signal?.aborted) { for (const l of loaded) (l as Loaded | null)?.bitmap.close(); throw abortErr(); }
  const reals = loaded as (Loaded | null)[];
  // FRAMES：硬编码 ← terrain-art.json 的 frames ← 真实图集帧
  const artFrames = (params as { frames?: unknown } | null)?.frames;
  const n = setFrameSizes(
    Array.isArray(artFrames) || (artFrames && typeof artFrames === 'object') ? artFrames as Record<string, [number, number]> : null,
    ...reals.map((l) => l?.json.frames),
  );
  console.info(`${TAG} FRAMES：${Object.keys(FRAMES).length} 帧（${n ? `${n} 条来自 JSON` : '全部硬编码'}）`);
  const ph = makePlaceholderAtlas();          // 在 FRAMES 重建后画，尺寸与真实帧一致
  const out = {} as RegionAtlases;
  IDS.forEach((id, i) => { const l = reals[i]; out[id] = l ? compose(id, l, ph) : placeholderPart(ph, id); });
  console.info(`${TAG} 结果：${IDS.map((id) => `${id}=${out[id].source}(${out[id].json.frames.length})`).join(' ')}`);
  return out;
}

/** 全部占位（加载器本身出错时的兜底）。 */
export function placeholderAtlases(): RegionAtlases {
  const ph = makePlaceholderAtlas();
  return Object.fromEntries(IDS.map((id) => [id, placeholderPart(ph, id)])) as RegionAtlases;
}
