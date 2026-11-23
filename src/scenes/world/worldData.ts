import { signal } from '@preact/signals';
import { chroma, lch, oklabToSrgb, rgbToHex, hexToOklab, mixLab } from './oklab';

/**
 * 省域静态数据 + 视图模型（工单 M3-WO2 §2.1）。
 * 内容包接入前的占位：原版 worldmap_overlays/MapPlaceN.png 作为省片的轮廓与纸面纹理，
 * 位置由 tools/map/solve_layout.py 按边缘拼合求出（原版没有导出摆位表），`center` 单位 = 原图像素，y 向下。
 * 接入真实 provinces.json / map-layout.json 后替换 PLACE_LAYOUT 即可，场景代码不改。
 */
export interface PlaceDef {
  id: string;
  nameKey: string;
  image: string;              // 纹理 URL（灰度纸面，乘以省色）
  center: [number, number];   // 图片中心在地图坐标（像素）中的位置
  layerHeight: number;        // 0–3
  accentColor: string;
  faction: string;
}

export interface MapLayoutLite {
  size: [number, number];     // 地图坐标范围（像素）
  backdrop: string;
  clouds: { image: string; at: [number, number]; scale: number; parallax: number }[];
  palette: { faction: Record<string, string>; goodwillRamp: [string, string]; idle: string; lockedTint: string };
}

const OVERLAY = '/assets/map_terrain/map_terrain/worldmap_overlays/';

/** [MapPlace 编号, 中心 x, 中心 y, 档高, 势力]。编号 i 对应原版地名表 id i+1。 */
const RAW: Array<[number, number, number, number, string]> = [
  [10, 308, 892, 1, 'west'],    // 秦州
  [9, 1742, 162, 2, 'north'],   // 辽阳
  [4, 890, 394, 2, 'north'],   // 太原
  [0, 1314, 414, 3, 'north'],   // 京城
  [6, 1634, 402, 1, 'east'],    // 青州
  [3, 1024, 766, 2, 'center'],  // 襄阳
  [12, 1438, 858, 1, 'center'], // 寿春
  [14, 1656, 692, 0, 'east'],   // 扬州
  [1, 728, 996, 1, 'west'],    // 成都
  [7, 1198, 1092, 3, 'center'], // 江陵
  [13, 1734, 940, 2, 'east'],  // 杭州
  [11, 862, 1628, 2, 'south'],  // 大理
  [2, 1000, 1358, 0, 'south'],  // 桂州
  [5, 1394, 1346, 1, 'south'],  // 广州
  [8, 1474, 1622, 3, 'east'],   // 福州
];

/** 色相环均匀取强调色：从 L=0.62 向两侧找最近的能在 sRGB 内保持 C ≥ 0.13 的明度（§5）。 */
function accentFor(h: number): string {
  for (let k = 0; k < 30; k++) {
    const L = 0.62 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.02;
    const hex = rgbToHex(oklabToSrgb(lch(L, 0.14, h)));
    const lab = hexToOklab(hex);
    if (chroma(lab) >= 0.13 && Math.abs(lab[0] - 0.76) >= 0.1) return hex;   // 与底色（L≈0.76）拉开 ΔL
  }
  return rgbToHex(oklabToSrgb(lch(0.5, 0.14, h)));
}

export const PLACES: PlaceDef[] = RAW.map(([n, x0, y0, layer, faction], i) => ({
  id: `p${n}`,
  nameKey: `province.${n}`,
  image: `${OVERLAY}MapPlace${n}.png`,
  center: [x0, y0],
  layerHeight: layer,
  accentColor: accentFor((i / RAW.length) * Math.PI * 2 + 0.4),
  faction,
}));

export const MAP_LAYOUT: MapLayoutLite = {
  size: [2100, 1900],
  backdrop: '#d9c9a6',
  clouds: [
    { image: `${OVERLAY}MapCloud_0.png`, at: [600, 300], scale: 1.2, parallax: 0.2 },
    { image: `${OVERLAY}MapCloud_1.png`, at: [1500, 1100], scale: 1.0, parallax: 0.25 },
    { image: `${OVERLAY}MapCloud_2.png`, at: [900, 1500], scale: 1.1, parallax: 0.18 },
    { image: `${OVERLAY}MapCloud_3.png`, at: [2000, 650], scale: 1.0, parallax: 0.3 },
    { image: `${OVERLAY}MapCloud_1.png`, at: [300, 1200], scale: 0.9, parallax: 0.22 },
  ],
  palette: {
    faction: { west: '#b9b29c', north: '#b8b6ab', east: '#b2b9a8', center: '#bfb4a0', south: '#b6ae9e' },
    goodwillRamp: ['#a9a49a', '#c9bc95'],
    idle: '#bab3a2',
    lockedTint: '#8f8a80',
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
