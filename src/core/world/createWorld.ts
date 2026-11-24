import { createGameTime } from './WorldClock';
import type { PlayerLocation, ProvinceSeed, ProvinceState, RegionState, WorldData } from './types';

export interface CreateWorldOptions {
  /** 省份静态数据；可直接传 scenes/world/worldData.ts 的 PLACES。 */
  provinces: readonly ProvinceSeed[];
  /** 每省的地区本地 id；缺省为原版三类地区占位（capital / sect / rural → r0 r1 r2）。 */
  regionsPerProvince?: (p: ProvinceSeed) => string[];
  player: PlayerLocation;
  year?: number;
  month?: number;
  /** 初始锁定的省份 id。 */
  locked?: readonly string[];
  initialGoodwill?: number;
}

const defaultRegions = (p: ProvinceSeed) => [`${p.id}.r0`, `${p.id}.r1`, `${p.id}.r2`];

export function createRegionState(id: string, provinceId: string): RegionState {
  return { id, provinceId, npcs: {}, buildings: [], resources: {}, eventFlags: {}, visited: false };
}

export function createWorldData(opts: CreateWorldOptions): WorldData {
  const locked = new Set(opts.locked ?? []);
  const regionsOf = opts.regionsPerProvince ?? defaultRegions;
  const provinces: Record<string, ProvinceState> = {};
  const regions: Record<string, RegionState> = {};

  for (const p of opts.provinces) {
    const regionIds = regionsOf(p);
    provinces[p.id] = {
      id: p.id,
      goodwill: opts.initialGoodwill ?? 0,
      controllingFaction: p.faction,
      unlocked: !locked.has(p.id),
      regionIds,
      flags: {},
    };
    for (const rid of regionIds) regions[rid] = createRegionState(rid, p.id);
  }

  if (!provinces[opts.player.provinceId]) throw new Error(`unknown player province ${opts.player.provinceId}`);
  if (!regions[opts.player.regionId]) regions[opts.player.regionId] = createRegionState(opts.player.regionId, opts.player.provinceId);
  regions[opts.player.regionId].visited = true;

  return {
    time: createGameTime(opts.year, opts.month),
    provinces,
    regions,
    player: { ...opts.player },
  };
}
