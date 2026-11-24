/**
 * 地形纸层（M3-WO3 v1.3 §3.13）：层号、层号场、反扭曲。纯函数，着色器 / 几何 / 布置 / 拾取共用。
 */
import type { RegionData } from './regionData';
import { gWarp, type WarpPhase } from './warp';
import { TERRAIN_ART_DEFAULTS } from './terrainArt';

/** 运行时参数：层厚（格，= terrain-art.json 的 levelStep）、开关。low 画质档或开关关 = v1.2 平面表现。 */
export const layerConfig = { step: TERRAIN_ART_DEFAULTS.levelStep, enabled: true };
/** 同种地形内部更高 / 更深台阶的内缩（格）。 */
export const LEVEL_INSET = 0.07;
/** 落点离层边界不足此距离的拒绝。 */
export const LEVEL_EDGE_GAP = 0.04;
export const MIN_LEVEL = -2, MAX_LEVEL = 3;

/** [边缘层, 每深入一格增量, 封顶]，按原版 0–15 号地面。未列出 = 0 层（含丘陵，用户定）。 */
export const LEVEL_RULES: Record<number, [number, number, number]> = {
  0: [1, 1, 3],          // 山岳
  7: [1, 0, 1],          // 石林
  12: [1, 0, 1],         // 洞穴
  10: [-1, 0, -1],       // 湖泊
  1: [-1, 0, -1],        // 峡谷
  13: [-0.5, 0, -0.5],   // 沼泽
};
/** 暗渊（地点 51 号）若作为地面使用时的规则。 */
export const ABYSS_RULE: [number, number, number] = [-1, -1, -2];

/** 格的地形身份：聚居格与周围地面不同种。 */
export function cellIds(r: RegionData): Int32Array {
  const ids = Int32Array.from(r.ground);
  for (const l of r.locations) ids[l.cell] = 100 + l.type;
  return ids;
}

/** 每格层号：到本地形区域边缘的格距多源 BFS（地图外按同种）。 */
export function cellLevels(r: RegionData, rules = LEVEL_RULES): Float32Array {
  const n = r.size, ids = cellIds(r), depth = new Int32Array(n * n).fill(-1), out = new Float32Array(n * n);
  const nb = (c: number) => {
    const x = c % n, z = (c / n) | 0, res: number[] = [];
    if (x > 0) res.push(c - 1); if (x < n - 1) res.push(c + 1); if (z > 0) res.push(c - n); if (z < n - 1) res.push(c + n);
    return res;
  };
  let frontier: number[] = [];
  for (let c = 0; c < n * n; c++) {
    if (!rules[ids[c]]) continue;
    if (nb(c).some((d) => ids[d] !== ids[c])) { depth[c] = 0; frontier.push(c); }
  }
  while (frontier.length) {
    const next: number[] = [];
    for (const c of frontier) for (const d of nb(c)) {
      if (depth[d] < 0 && ids[d] === ids[c]) { depth[d] = depth[c] + 1; next.push(d); }
    }
    frontier = next;
  }
  for (let c = 0; c < n * n; c++) {
    const rule = rules[ids[c]];
    if (!rule) continue;
    const [base, step, cap] = rule, lv = base + step * Math.max(0, depth[c]);
    out[c] = base > 0 ? Math.min(lv, cap) : Math.max(lv, cap);
  }
  return out;
}

export interface LevelGrid { n: number; ids: Int32Array; level: Float32Array }

export function makeLevelGrid(r: RegionData, enabled = layerConfig.enabled): LevelGrid {
  return { n: r.size, ids: cellIds(r), level: enabled ? cellLevels(r) : new Float32Array(r.size * r.size) };
}

/**
 * 扭曲坐标 (wx, wz)、所在格 (ci, cj) 处的层号：本格层号；离「同种但层号更接近 0 的邻格」的格边
 * 不足 LEVEL_INSET 时取邻格的。地图外的格视为 0 层、不同种。
 */
export function levelField(g: LevelGrid, wx: number, wz: number, ci: number, cj: number): number {
  const n = g.n, inside = (i: number, j: number) => i >= 0 && j >= 0 && i < n && j < n;
  if (!inside(ci, cj)) return 0;
  const id = g.ids[cj * n + ci];
  let out = g.level[cj * n + ci];
  const fu = wx - ci, fv = wz - cj;
  const probes: Array<[number, number, number]> = [[-1, 0, fu], [1, 0, 1 - fu], [0, -1, fv], [0, 1, 1 - fv]];
  for (const [di, dj, d] of probes) {
    const ni = ci + di, nj = cj + dj;
    if (!inside(ni, nj)) continue;
    const nl = g.level[nj * n + ni];
    if (g.ids[nj * n + ni] === id && Math.abs(nl) < Math.abs(out) && d < LEVEL_INSET) out = nl;
  }
  return out;
}

/** 世界 (x, z) 处的层号（扭到地区外的点按原格）。 */
export function levelAt(g: LevelGrid, x: number, z: number, p: WarpPhase): number {
  const [dx, dz] = gWarp(x, z, p);
  let wx = x + dx, wz = z + dz, ci = Math.floor(wx), cj = Math.floor(wz);
  if (ci < 0 || cj < 0 || ci >= g.n || cj >= g.n) { wx = x; wz = z; ci = Math.floor(x); cj = Math.floor(z); }
  return levelField(g, wx, wz, ci, cj);
}

/** 世界 (x, z) 处的地面高度（米）。 */
export function heightAt(g: LevelGrid, x: number, z: number, p: WarpPhase, step = layerConfig.step): number {
  return levelAt(g, x, z, p) * step;
}

/** 落点离层边界至少 LEVEL_EDGE_GAP：四个方向各探一次，层号都相同才收。 */
export function awayFromLevelEdge(g: LevelGrid, x: number, z: number, p: WarpPhase): boolean {
  const l = levelAt(g, x, z, p), e = LEVEL_EDGE_GAP;
  return levelAt(g, x + e, z, p) === l && levelAt(g, x - e, z, p) === l
    && levelAt(g, x, z + e, p) === l && levelAt(g, x, z - e, p) === l;
}

/** warp 的逆：求 (x, z) 使 (x, z) + gWarp(x, z) = (u, v)。偏导上界约 0.55 < 1，不动点迭代收敛。 */
export function unwarp(u: number, v: number, p: WarpPhase, iters = 20): [number, number] {
  let x = u, z = v;
  for (let i = 0; i < iters; i++) {
    const [dx, dz] = gWarp(x, z, p);
    x = u - dx; z = v - dz;
  }
  return [x, z];
}

/** tLevel 编码：r = (level + 2) × 2，取值 0–10。 */
export function encodeLevel(level: number): number { return Math.round((level - MIN_LEVEL) * 2); }
