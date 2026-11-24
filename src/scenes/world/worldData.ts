import { signal } from '@preact/signals';
import { oklabToSrgb, rgbToHex, hexToOklab, mixLab } from './oklab';

/**
 * 省域静态数据 + 视图模型（工单 M3-WO2 §2.1）。
 * 原版资源（assets/world-map/world_map/）：底图 base/MiniMapBack.png（1820×1600），
 * 省片轮廓取 places/MapPlaceN.png 的 alpha，摆位与高亮色取 layout.json → prefabs.ui_PartWorldMap.place_highlights
 * （rect_px，左上原点、y 向下）。省片表面贴的是底图的对应区域，抬起时带着原画一起走。
 */
export interface PlaceDef {
  id: string;
  nameKey: string;
  image: string;              // 轮廓掩码 URL（MapPlaceN.png）
  center: [number, number];   // 掩码图中心在底图像素坐标中的位置
  layerHeight: number;        // 0–3
  accentColor: string;        // 原版高亮色
  faction: string;
}

export interface MapLayoutLite {
  size: [number, number];     // 底图像素尺寸
  baseImage: string;
  backdrop: string;
  clouds: { image: string; at: [number, number]; scale: number; parallax: number }[];
  palette: { faction: Record<string, string>; goodwillRamp: [string, string]; idle: string; lockedTint: string };
}

const WM = `${import.meta.env.BASE_URL}assets/world-map/world_map/`;
/** 线上替代素材（自产 / 生成图）：content/base/art/worldmap/，文件名与原版相同。 */
const CONTENT = `${import.meta.env.BASE_URL}content/base/art/worldmap/`;
/** dev 调试：URL 带 ?fallback 时跳过原版素材，看降级效果。 */
export const SKIP_ORIGINAL = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fallback');
/** 原版素材 URL → content/ 里对应的替代图 URL（云朵等不在表里的返回 null）。 */
export function contentFallback(url: string): string | null {
  return url.startsWith(WM) ? CONTENT + url.slice(WM.length).replace(/^base\//, '') : null;
}
const CLOUD = `${import.meta.env.BASE_URL}assets/map_terrain/map_terrain/worldmap_overlays/`;

/** [MapPlace 编号, 中心 x, 中心 y, 档高, 势力, 原版高亮色]——由 layout.json 的 place_highlights 生成。 */
const RAW: Array<[number, number, number, number, string, string]> = [
  [0, 1051.4, 432.3, 3, 'north', '#edb723'],  // 京畿
  [1, 466.9, 1052.5, 1, 'west', '#f798d3'],  // 巴蜀
  [2, 748.5, 1424.0, 0, 'south', '#4bffb5'],  // 广南
  [3, 755.4, 795.0, 2, 'center', '#d4b896'],  // 荆北（原版白色在纸面上看不出，改淡金）
  [4, 620.4, 415.4, 2, 'north', '#ffd4a9'],  // 山西
  [5, 1156.7, 1405.6, 1, 'south', '#ff7e09'],  // 广东
  [6, 1374.9, 404.8, 1, 'east', '#bbe3ff'],  // 山东
  [7, 940.1, 1137.6, 3, 'center', '#69a8ff'],  // 荆南
  [8, 1358.0, 1194.9, 2, 'east', '#ffeb54'],  // 福建
  [9, 1493.4, 163.3, 1, 'north', '#c7ff90'],  // 辽东
  [10, 307.0, 704.4, 0, 'west', '#dd8826'],  // 西域
  [11, 300.5, 1327.8, 2, 'south', '#ce5cff'],  // 云南
  [12, 1184.4, 890.0, 1, 'center', '#36ffff'],  // 淮南
  [13, 1486.6, 974.6, 0, 'east', '#ff5724'],  // 江南
  [14, 1408.5, 708.1, 2, 'east', '#ff4040'],  // 江北
];

export const PLACES: PlaceDef[] = RAW.map(([n, x, y, layer, faction, accent]) => ({
  id: `p${n}`,
  nameKey: `province.${n}`,
  image: `${WM}places/MapPlace${n}.png`,
  center: [x, y],
  layerHeight: layer,
  accentColor: accent,
  faction,
}));

export const MAP_LAYOUT: MapLayoutLite = {
  size: [1820, 1600],
  baseImage: `${WM}base/MiniMapBack.png`,
  backdrop: '#2b2722',
  clouds: [
    { image: `${CLOUD}MapCloud_0.png`, at: [500, 260], scale: 1.2, parallax: 0.2 },
    { image: `${CLOUD}MapCloud_1.png`, at: [1300, 950], scale: 1.0, parallax: 0.25 },
    { image: `${CLOUD}MapCloud_2.png`, at: [760, 1350], scale: 1.1, parallax: 0.18 },
    { image: `${CLOUD}MapCloud_3.png`, at: [1650, 520], scale: 1.0, parallax: 0.3 },
    { image: `${CLOUD}MapCloud_1.png`, at: [240, 1050], scale: 0.9, parallax: 0.22 },
  ],
  palette: {
    // 底图是深色水墨：底色是乘到原画上的淡色，接近白，保留原画
    faction: { west: '#f2ead8', north: '#e9eaf0', east: '#e6efe6', center: '#f3e8de', south: '#efe9e0' },
    goodwillRamp: ['#d8d6d2', '#f6eccb'],
    idle: '#eeeae2',
    lockedTint: '#9d9890',
  },
};

// ── 视图模型（§2.1）。core 接入前用桩数据 ──
export type LayerMode = 'faction' | 'goodwill' | 'routes';
export interface RegionView { id: string; nameKey: string; kind: 'capital' | 'sect' | 'rural'; apCost: number | null; unlocked: boolean }
export interface ProvinceView {
  id: string; nameKey: string; baseColor: string; accentColor: string;
  locked: boolean; lockReasonKey?: string; isCurrent: boolean; regions: RegionView[];
  goodwill: number;
}
export interface WorldMapView {
  layer: LayerMode;
  provinces: ProvinceView[];
  routes: { a: string; b: string; open: boolean }[];
  ap: number;
}

const KINDS: RegionView['kind'][] = ['capital', 'sect', 'rural'];

/** 由静态数据 + 状态推出视图（selectors/worldMap 的占位实现）。 */
export function computeView(layer: LayerMode, current: string, ap: number, routes: WorldMapView['routes']): WorldMapView {
  const pal = MAP_LAYOUT.palette;
  const openSet = new Set(routes.filter((r) => r.open).flatMap((r) => [r.a, r.b]));
  const provinces = PLACES.map((p, i): ProvinceView => {
    const goodwill = ((i * 37) % 100) / 100;
    let base = pal.faction[p.faction] ?? pal.idle;
    if (layer === 'goodwill') base = rgbToHex(oklabToSrgb(mixLab(hexToOklab(pal.goodwillRamp[0]), hexToOklab(pal.goodwillRamp[1]), goodwill)));
    if (layer === 'routes') {
      const c = hexToOklab(pal.idle);
      base = openSet.has(p.id) ? rgbToHex(oklabToSrgb([c[0] * 1.08, c[1], c[2]])) : pal.idle;
    }
    const locked = i === 11;   // 占位：一片锁定，演示 locked 态
    return {
      id: p.id, nameKey: p.nameKey, baseColor: base, accentColor: p.accentColor,
      locked, lockReasonKey: locked ? 'map.locked.reason' : undefined, isCurrent: p.id === current, goodwill,
      regions: KINDS.map((kind, k) => ({
        id: `${p.id}.r${k}`, nameKey: `region.${kind}`, kind,
        apCost: p.id === current ? 5 : 10 + ((i * 7 + k * 13) % 50), unlocked: k === 0 || (i + k) % 3 !== 0,
      })),
    };
  });
  return { layer, provinces, routes, ap };
}

/** 桩：一棵生成树 + 几条额外边（按中心距离的最近邻）。 */
export function stubRoutes(): WorldMapView['routes'] {
  const pts = PLACES.map((p) => p.center);
  const inTree = new Set([0]); const out: WorldMapView['routes'] = [];
  while (inTree.size < PLACES.length) {
    let best: [number, number, number] = [0, 0, Infinity];
    for (const a of inTree) for (let b = 0; b < PLACES.length; b++) {
      if (inTree.has(b)) continue;
      const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
      if (d < best[2]) best = [a, b, d];
    }
    inTree.add(best[1]); out.push({ a: PLACES[best[0]].id, b: PLACES[best[1]].id, open: true });
  }
  out.push({ a: 'p0', b: 'p6', open: true }, { a: 'p3', b: 'p12', open: false }, { a: 'p13', b: 'p8', open: true });
  return out;
}

/** 世界侧的全局状态（core 接入前的桩）。 */
export const worldUi = {
  layer: signal<LayerMode>('faction'),
  current: signal<string>('p3'),
  ap: signal<number>(120),
  /** 信息卡里选定的目的地。 */
  destRegion: signal<string | null>(null),
  busy: signal(false),
  toast: signal<{ key: string; px: [number, number]; t: number } | null>(null),
};

export function provinceOfRegion(regionId: string): string { return regionId.split('.')[0]; }
