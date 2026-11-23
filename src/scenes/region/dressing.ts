/**
 * 一格的布置（WO3 v1.2 §3.6）：主体立牌 + 填充小件 + 地面散件 + 岸边件。纯函数。
 * 格 = 1m；格内坐标 x 向右、z 向镜头为正。
 */
import { mulberry32, type RegionData } from './regionData';
import { FRAMES, GROUND_ART, SHORE } from './regionArt';
import { locationKind, TERRAIN_KEYS, WATER } from './terrain';
import { ownerCellAt, warpPhase, type WarpPhase } from './warp';

export type PlacementLayer = 'main' | 'filler' | 'flat';
export interface Placement {
  cell: number; layer: PlacementLayer; artKey: string;
  x: number; z: number; scale: number; yaw: number; tint: number;
}

const SLOTS: Array<Array<[number, number]>> = [
  [],
  [[0, -0.05]],
  [[-0.2, -0.15], [0.2, 0.2]],
  [[-0.24, -0.24], [0.22, -0.2], [0.02, 0.22]],
  [[-0.26, -0.26], [0.22, -0.24], [-0.22, 0.2], [0.26, 0.24]],
  [[-0.26, -0.26], [0.22, -0.24], [-0.02, -0.02], [-0.22, 0.2], [0.26, 0.24]],
  [[-0.3, -0.3], [0.02, -0.26], [0.3, -0.28], [-0.28, 0.18], [0.04, 0.24], [0.3, 0.16]],
  [[-0.3, -0.3], [0.02, -0.26], [0.3, -0.28], [-0.14, -0.02], [0.18, 0], [-0.3, 0.26], [0.28, 0.26]],
];
const COUNT_SCALE = [1, 1, 1, 1, 0.95, 0.92, 0.88, 0.85];
export const MAX_MAIN = 7;
/** 细节批容量：每格至多 8 填充 + 3 散件。 */
export const DETAIL_PER_CELL = 11;

const ri = (r: () => number, [a, b]: [number, number]) => a + Math.floor(r() * (b - a + 1));

export function dressRegion(region: RegionData, phase: WarpPhase = warpPhase(region.seed ?? 0)): Placement[] {
  const n = region.size, out: Placement[] = [];
  const locAt = new Map(region.locations.map((l) => [l.cell, l]));
  const owner = (x: number, z: number) => ownerCellAt(x, z, n, phase);
  const terrainAt = (x: number, z: number) => region.ground[owner(x, z)];

  for (let cell = 0; cell < n * n; cell++) {
    const cx = cell % n, cz = (cell / n) | 0, x0 = cx + 0.5, z0 = cz + 0.5;
    const t = region.ground[cell], key = TERRAIN_KEYS[t];
    const r = mulberry32((region.seed ?? 0) * 7919 + cell * 104729);
    const loc = locAt.get(cell);
    const art = GROUND_ART[loc ? 'settlement' : key];
    if (!art) continue;
    const isWater = WATER[t];
    const ownsPoint = (x: number, z: number) => owner(x, z) === cell;

    // ── 主体立牌 ──
    const mains: Array<[number, number]> = [];
    if (!loc) {
      let count = ri(r, art.density);
      // 聚居点邻格让位
      let away: [number, number] | null = null;
      for (const l of region.locations) {
        const lx = l.cell % n, lz = (l.cell / n) | 0, dx = lx - cx, dz = lz - cz;
        const big = ['city', 'sect', 'taiwu'].includes(locationKind(l.type));
        const adj = big ? Math.max(Math.abs(dx), Math.abs(dz)) === 1 : Math.abs(dx) + Math.abs(dz) === 1;
        if (adj) { away = [dx, dz]; break; }
      }
      if (away && count > 0) count = Math.max(1, count - 1);
      count = Math.min(MAX_MAIN, count);
      let slots = SLOTS[count].slice();
      if (away) {
        const len = Math.hypot(away[0], away[1]);
        const keep = slots.filter(([sx, sz]) => (sx * away![0] + sz * away![1]) / len <= 0.05);
        slots = keep.length ? keep : [[-away[0] * 0.25 / len, -away[1] * 0.25 / len]];
        slots = slots.slice(0, count);
      }
      const variants = [0, 1].map((i) => `terrain.standee.${key}.${i}`).filter((k) => FRAMES[k]);
      // 高的牌占后排槽：先按高度排序帧，槽位按 z 从后到前
      const picks = slots.map((_, i) => variants[(i + ((r() * 2) | 0)) % variants.length])
        .sort((a, b) => FRAMES[b][1] - FRAMES[a][1]);
      slots.sort((a, b) => a[1] - b[1]);
      slots.forEach(([sx, sz], i) => {
        if (!picks[i]) return;
        let ox = sx + (r() - 0.5) * 0.12, oz = sz + (r() - 0.5) * 0.12;
        for (let k = 0; k < 3 && !ownsPoint(x0 + ox, z0 + oz); k++) { ox *= 0.6; oz *= 0.6; }
        if (!ownsPoint(x0 + ox, z0 + oz)) return;
        const scale = (0.92 + r() * 0.16) * COUNT_SCALE[slots.length];
        out.push({ cell, layer: 'main', artKey: picks[i], x: x0 + ox, z: z0 + oz, scale, yaw: 0, tint: 0.96 + r() * 0.08 });
        mains.push([x0 + ox, z0 + oz]);
      });
    }

    // ── 填充小件 ──
    if (!loc) {
      const placed = mains.slice();
      const want = Math.min(8, ri(r, art.fillerCount));
      const nearShore = (x: number, z: number) => {
        for (let a = 0; a < 8; a++) {
          const d = SHORE.band, ang = a * Math.PI / 4;
          if (!WATER[terrainAt(x + Math.cos(ang) * d, z + Math.sin(ang) * d)]) return true;
        }
        return false;
      };
      for (let i = 0, tries = 0; i < want && tries < 24 && art.fillers.length; tries++) {
        const x = x0 + (r() - 0.5) * 0.86, z = z0 + (r() - 0.5) * 0.86;
        if (!ownsPoint(x, z)) continue;
        if (isWater && !nearShore(x, z)) continue;
        if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.13)) continue;
        placed.push([x, z]); i++;
        out.push({ cell, layer: 'filler', artKey: art.fillers[(r() * art.fillers.length) | 0], x, z,
          scale: 0.85 + r() * 0.3, yaw: (r() - 0.5) * 2 * 12 * Math.PI / 180, tint: 0.96 + r() * 0.08 });
      }
      // 岸边件：与水相邻的陆地格
      if (!isWater) {
        const nb = [cell - 1, cell + 1, cell - n, cell + n].filter((c, k) =>
          c >= 0 && c < n * n && (k > 1 || ((c / n) | 0) === cz) && WATER[region.ground[c]]);
        if (nb.length) {
          const want2 = ri(r, SHORE.count), shore: Array<[number, number]> = [];
          for (let tries = 0; shore.length < want2 && tries < 40; tries++) {
            const x = x0 + (r() - 0.5) * 0.9, z = z0 + (r() - 0.5) * 0.9;
            if (!ownsPoint(x, z)) continue;
            let wet = false;
            for (let a = 0; a < 8 && !wet; a++) wet = WATER[terrainAt(x + Math.cos(a * 0.785) * SHORE.band, z + Math.sin(a * 0.785) * SHORE.band)];
            if (!wet || shore.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.11)) continue;
            shore.push([x, z]);
            out.push({ cell, layer: 'filler', artKey: SHORE.fillers[(r() * SHORE.fillers.length) | 0], x, z,
              scale: 0.85 + r() * 0.3, yaw: (r() - 0.5) * 0.42, tint: 1 });
          }
        }
      }
    }

    // ── 地面散件（水面不放） ──
    if (!isWater && art.pieces.length) {
      const want = ri(r, art.pieceCount);
      for (let i = 0; i < want; i++) {
        const k = art.pieces[(r() * art.pieces.length) | 0], side = FRAMES[k]?.[0] ?? 0.4;
        const s = 0.8 + r() * 0.4, m = Math.max(0, 0.5 - 0.35 * side * s);
        out.push({ cell, layer: 'flat', artKey: k, x: x0 + (r() - 0.5) * 2 * m, z: z0 + (r() - 0.5) * 2 * m,
          scale: s, yaw: r() * Math.PI * 2, tint: 1 });
      }
    }
  }
  return out;
}

/** 地点主牌的 artKey 与尺寸（宽×高，米）。 */
export const LOCATION_SIZE: Record<string, [number, number]> = {
  city: [1.3, 1.15], sect: [1.3, 1.2], taiwu: [1.3, 1.2], town: [1.05, 0.9], fort: [1.05, 0.9], village: [1.0, 0.75], abyss: [0.65, 0.65],
};
