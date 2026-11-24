/**
 * terrain-art.json 顶层的可调参数（WO3 §3.13.1）。内容包可覆盖；缺省值只在这里出现一次。
 * 侧壁高度、立牌与房屋落点、拾取修正、迷雾高度、maxCasterHeight 全部按 levelStep 算。
 */
export interface TerrainArtParams {
  /** 一层厚（格）；0.05 与 0.08 的对比交用户定。 */
  levelStep: number;
  /** 聚居格用单栋房屋立牌（关 = 回退整张聚落立牌）。 */
  houses: boolean;
}

export const TERRAIN_ART_DEFAULTS: Readonly<TerrainArtParams> = { levelStep: 0.05, houses: true };

/** 合并内容包里的 terrain-art.json（缺字段 / 类型不对的走缺省）。 */
export function parseTerrainArt(json: unknown): TerrainArtParams {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const step = typeof o.levelStep === 'number' && o.levelStep >= 0 && o.levelStep <= 0.5 ? o.levelStep : TERRAIN_ART_DEFAULTS.levelStep;
  const houses = typeof o.houses === 'boolean' ? o.houses : TERRAIN_ART_DEFAULTS.houses;
  return { levelStep: step, houses };
}
