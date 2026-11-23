/** 原版地形方块图（assets/map_terrain/map_terrain/worldmap/NN_名称/variant_XX.png）的索引与地形参数。 */

/** 每种地形用作底纸 / 立牌的变体上限（控制显存与打包体积）。 */
export const MAX_VARIANTS = 4;
/** 地面类地形 0–15；16–51 为聚居点 / 门派 / 城市。 */
export const GROUND_TYPES = 16;

export const TERRAIN_NAMES: readonly string[] = [
  '山岳', '峡谷', '丘陵', '原野', '林地', '农田', '园林', '石林', '桑园', '药园', '湖泊', '密林', '洞穴', '沼泽', '桃源', '荒野',
];

/** 逐格移动耗费；Infinity = 不可通行。 */
export const MOVE_COST: readonly number[] = [
  3, 2, 2, 1, 1, 1, 1, 2, 1, 1, Infinity, 2, 2, 3, 1, 1,
];

export type LocationKind = 'city' | 'sect' | 'village' | 'town' | 'fort' | 'taiwu' | 'abyss';

/** 地点类型编号 → 种类。 */
export function locationKind(type: number): LocationKind {
  if (type >= 16 && type <= 31) return 'sect';
  if (type >= 32 && type <= 46) return 'city';
  if (type === 47) return 'taiwu';
  if (type === 48) return 'village';
  if (type === 49) return 'town';
  if (type === 50) return 'fort';
  return 'abyss';
}

/** 地点所在格的底纸用哪种地面（原野）。 */
export const SETTLEMENT_GROUND = 3;

// Vite 在构建期收集全部变体 URL（只取前 MAX_VARIANTS 张）。
const files = import.meta.glob('/assets/map_terrain/map_terrain/worldmap/*/variant_0[0-3].png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

const byType = new Map<number, { name: string; urls: string[] }>();
for (const [path, url] of Object.entries(files)) {
  const m = /\/(\d+)_([^/]+)\/variant_(\d+)\.png$/.exec(path);
  if (!m) continue;
  const id = Number(m[1]);
  let e = byType.get(id);
  if (!e) byType.set(id, e = { name: m[2], urls: [] });
  e.urls[Number(m[3])] = url;
}
for (const e of byType.values()) e.urls = e.urls.filter(Boolean);

/** 某地形编号的变体 URL 列表（可能为空：零素材时走占位）。 */
export function terrainUrls(type: number): string[] { return byType.get(type)?.urls ?? []; }
export function terrainName(type: number): string { return byType.get(type)?.name ?? TERRAIN_NAMES[type] ?? `#${type}`; }

/** 原版 0–15 号 → WO3 的地形键。 */
export const TERRAIN_KEYS: readonly string[] = [
  'mountain', 'canyon', 'hill', 'plain', 'woods', 'farmland', 'garden', 'stoneForest',
  'mulberry', 'herbGarden', 'lake', 'jungle', 'cave', 'marsh', 'vale', 'waste',
];

/** 叠放次序（WO3 §3.2.1）：水最低、山最高。 */
export const STACK: readonly number[] = [120, 100, 90, 60, 80, 50, 60, 110, 50, 50, 20, 85, 100, 30, 60, 60];

/** 水面地形（WO3 v1.1：起步只有湖泊）。 */
export const WATER: readonly boolean[] = TERRAIN_KEYS.map((k) => k === 'lake');
