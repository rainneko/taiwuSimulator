/**
 * 地点立牌组（M3-WO3 §3.7 + v1.3.1 §3.12）：每个聚居格 = 单栋房屋立牌（按配方）+ 前景件；
 * 房子关着（houses: false / low 档 / 房屋图集缺失）时回退整张聚落立牌 + 前景件。纯函数，只出布置。
 * 坐标：世界格坐标（格 (i, j) 占 [i, i+1]×[j, j+1]）。
 */
import { h32, hf } from './hash';
import { placeHouses, settlementKindOf, type HousePlacement, type SettlementKind } from './houseRecipes';
import type { RegionData, RegionLocation } from './regionData';
import { locationKind } from './terrain';
import type { WarpPhase } from './warp';

/** 前景件候选池（同 preview_grid.LOC_POOL）。 */
export const LOC_POOL: Record<SettlementKind, string[]> = {
  city: ['wall', 'lantern', 'poles', 'steps'], sectSeat: ['poles', 'steps', 'lantern'],
  town: ['lantern', 'tree', 'fence'], fort: ['fence', 'poles'], village: ['fence', 'tree'],
};
const PROP_SLOTS: Array<[number, number]> = [[-0.38, 0.25], [0.36, 0.27]];

export interface PlacedHouse extends HousePlacement { wx: number; wz: number }
export interface PlacedProp { artKey: string; wx: number; wz: number }
export interface LocationGroup {
  loc: RegionLocation;
  mode: 'houses' | 'standee';
  houses: PlacedHouse[];
  props: PlacedProp[];
  /** 地名标注挂点（世界 xz + 离地高度）：最高一栋顶上 0.1；回退时由场景按整张立牌算。 */
  label: { x: number; z: number; top: number } | null;
}

export function planLocationGroups(r: RegionData, phase: WarpPhase, opts: {
  houses: boolean; accept?: (x: number, z: number) => boolean; nearRoad?: (cell: number) => Array<[number, number]>;
}): LocationGroup[] {
  const n = r.size, seed = r.seed ?? 0, accept = opts.accept ?? (() => true);
  return r.locations.map((loc) => {
    const i = loc.cell % n, j = (loc.cell / n) | 0, cx = i + 0.5, cz = j + 0.5;
    const sk = settlementKindOf(locationKind(loc.type));
    let houses: PlacedHouse[] = [];
    if (opts.houses && sk) {
      houses = placeHouses(i, j, sk, seed, { phase, nearRoad: opts.nearRoad?.(loc.cell) ?? [] })
        .map((h) => ({ ...h, wx: cx + h.x, wz: cz + h.z }))
        .filter((h) => accept(h.wx, h.wz));
    }
    const mode: LocationGroup['mode'] = houses.length ? 'houses' : 'standee';
    // 前景件 0–2 张：左右两槽，±0.04 抖动
    const props: PlacedProp[] = [];
    if (sk) {
      const pool = LOC_POOL[sk], count = h32(seed, i, j, 400) % 3;
      for (let k = 0; k < count; k++) {
        const [sx, sz] = PROP_SLOTS[k];
        const wx = cx + sx + (hf(seed, i, j, 401, k) - 0.5) * 0.08, wz = cz + sz + (hf(seed, i, j, 402, k) - 0.5) * 0.08;
        if (!accept(wx, wz)) continue;
        props.push({ artKey: `loc.prop.${pool[h32(seed, i, j, 403, k) % pool.length]}`, wx, wz });
      }
    }
    let label: LocationGroup['label'] = null;
    if (houses.length) {
      const top = houses.reduce((a, b) => (b.h > a.h ? b : a));
      label = { x: top.wx, z: top.wz, top: top.h + 0.1 };
    }
    return { loc, mode, houses, props, label };
  });
}
