/**
 * 单栋房屋立牌的摆放配方（M3-WO3 v1.3.1 §3.12.3）。纯函数。
 * 逐行移植 tools/art/preview_grid.py 的 place_houses / _place_once / _blocks / in_view_sector，
 * 哈希（h32 / hf）与扭曲相位相同，同一组种子输出一致（测试比对 Python 生成的夹具）。
 *
 * 内部按世界格坐标（格 (i, j) 占 [i, i+1]×[j, j+1]）计算，与参考实现一致；
 * 输出换成 §3.12.3 的约定：以格心为原点，x 向右、z 向镜头为正，范围 ±0.5。
 */
import { h32, hf } from './hash';
import { HOUSE_TYPES, type HouseType } from './regionArt';
import { gWarp, warpPhase, type WarpPhase } from './warp';

export type SettlementKind = 'village' | 'fort' | 'town' | 'city' | 'sectSeat';

export const HOUSE_RECIPES: Record<SettlementKind, [[number, number], string[], number]> = {
  village: [[3, 4], ['cottage', 'cottage', 'tile', 'long'], 1.0],
  fort: [[3, 4], ['tower', 'long', 'cottage'], 1.0],
  town: [[4, 5], ['tile', 'shop', 'long', 'tile'], 0.9],
  city: [[4, 6], ['tile', 'shop', 'tile', 'long'], 0.85],
  sectSeat: [[3, 4], ['hall', 'tile', 'long'], 1.0],
};
const HOUSE_FIRST: Partial<Record<SettlementKind, string>> = { fort: 'tower', sectSeat: 'hall' };
export const HOUSE_CLEAR_R = 0.18;
export const HOUSE_DEPTH = 0.12;
export const HOUSE_SHOW = 0.5;
export const HOUSE_SHRINK = [1.0, 0.9, 0.8];
export const VIEW_SECTOR_R = 0.45, VIEW_SECTOR_HALF = 40 * Math.PI / 180;
export const ROAD_W = 0.14;
const PITCH = 53 * Math.PI / 180;
/** 每个聚居格至多几栋（PaperBatch 容量 = 7 × 聚居格数）。 */
export const MAX_HOUSES_PER_CELL = 7;

/** 世界格坐标下的一栋（内部用）。 */
interface H { key: string; kind: string; x: number; z: number; w: number; h: number }
/** 输出：格心原点。 */
export interface HousePlacement { artKey: string; houseKind: string; x: number; z: number; w: number; h: number }

type P2 = [number, number];

function corners(h: H): P2[] {
  const hw = h.w / 2, hd = HOUSE_DEPTH / 2;
  return [[h.x - hw, h.z - hd], [h.x + hw, h.z - hd], [h.x + hw, h.z + hd], [h.x - hw, h.z + hd]];
}

function satOverlap(a: P2[], b: P2[], margin = 0): boolean {
  for (const poly of [a, b]) {
    for (let k = 0; k < poly.length; k++) {
      const p0 = poly[k], p1 = poly[(k + 1) % poly.length];
      const ex = p1[0] - p0[0], ez = p1[1] - p0[1], len = Math.hypot(ex, ez) + 1e-12;
      const nx = -ez / len, nz = ex / len;
      let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
      for (const q of a) { const d = q[0] * nx + q[1] * nz; amin = Math.min(amin, d); amax = Math.max(amax, d); }
      for (const q of b) { const d = q[0] * nx + q[1] * nz; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d); }
      if (amax + margin < bmin || bmax + margin < amin) return false;
    }
  }
  return true;
}

/** 凸多边形内且离边至少 −margin（margin > 0 = 外扩）。 */
function pointInPoly(p: P2, poly: P2[], margin = 0): boolean {
  let area = 0;
  for (let q = 0; q < poly.length; q++) {
    const a = poly[q], b = poly[(q + 1) % poly.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const sgn = area > 0 ? 1 : -1;
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1];
    const cr = (ex * (p[1] - a[1]) - ez * (p[0] - a[0])) / (Math.hypot(ex, ez) + 1e-12);
    if (cr * sgn < -margin) return false;
  }
  return true;
}

const linspace = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (n === 1 ? 0 : i / (n - 1)));

/** 多边形是否与「以 apex 为顶点、朝镜头（+z）±half、半径 r」的扇形相交。 */
export function inViewSector(poly: P2[], apex: P2, r = VIEW_SECTOR_R, half = VIEW_SECTOR_HALF): boolean {
  const [ax, az] = apex;
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (Math.max(...zs) < az - 0.05
    || Math.hypot(clamp(ax, Math.min(...xs), Math.max(...xs)) - ax, clamp(az, Math.min(...zs), Math.max(...zs)) - az) > r) return false;
  const inside = (px: number, pz: number) => {
    const dx = px - ax, dz = pz - az, d = Math.hypot(dx, dz);
    return d <= r && (d < 1e-9 || Math.acos(Math.max(-1, Math.min(1, dz / d))) <= half);
  };
  for (let k = 0; k < poly.length; k++) {
    const p0 = poly[k], p1 = poly[(k + 1) % poly.length];
    for (const t of linspace(0, 1, 7)) if (inside(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)) return true;
  }
  for (const rr of linspace(0.05, r, 8)) for (const ang of linspace(-half, half, 9)) {
    if (pointInPoly([ax + rr * Math.sin(ang), az + rr * Math.cos(ang)], poly)) return true;
  }
  return false;
}

function clearCentre(i: number, j: number, kind: SettlementKind): P2 {
  return kind === 'sectSeat' ? [i + 0.5, j + 0.74] : [i + 0.5, j + 0.5];
}
const clearRadius = (kind: SettlementKind) => (kind === 'sectSeat' ? 0.14 : HOUSE_CLEAR_R);

function blocks(a: H, b: H): boolean {
  if (satOverlap(corners(a), corners(b), 0.02)) return true;
  const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  if (ox <= 0.3 * Math.min(a.w, b.w)) return false;
  const [front, back] = a.z > b.z ? [a, b] : [b, a];
  return (front.z - back.z) * Math.tan(PITCH) < front.h - HOUSE_SHOW * back.h;
}

function placeOnce(i: number, j: number, kind: SettlementKind, seed: number, phase: WarpPhase,
  types: Record<string, HouseType[]>, nearRoad: P2[], cands: string[], sizeK: number, n: number): H[] {
  const out: H[] = [];
  const cx = i + 0.5;
  const [qx, qz] = clearCentre(i, j, kind);
  const first = HOUSE_FIRST[kind];
  for (let tries = 0; tries < 360; tries++) {
    if (out.length >= n) break;
    const k = first && !out.length ? first : cands[h32(seed, i, j, 301, tries) % cands.length];
    const list = types[k];
    if (!list) continue;
    const [key, hh, asp] = list[h32(seed, i, j, 305, tries) % list.length];
    let sc = sizeK * (0.92 + 0.16 * hf(seed, i, j, 308, tries));
    let x = i + 0.12 + 0.76 * hf(seed, i, j, 302, tries);
    let z = j + 0.12 + 0.76 * hf(seed, i, j, 303, tries);
    if (k === 'hall' && !out.length) {              // 殿阁：靠后居中，前面是院子
      sc = sizeK * 0.9;
      x = cx + (hf(seed, i, j, 302, tries) - 0.5) * 0.06;
      z = j + 0.2 + 0.1 * hf(seed, i, j, 303, tries);
    } else if (z > qz && Math.abs(x - qx) < (z - qz) * Math.tan(VIEW_SECTOR_HALF) + 0.1) continue;
    const h: H = { key, kind: k, x, z, w: hh * asp * sc, h: hh * sc };
    const poly = corners(h);
    let ok = true;                                   // 四角都画在本格（扭曲后的归属格）
    for (const [px, pz] of poly) {
      const [dx, dz] = gWarp(px, pz, phase);
      if (Math.floor(px + dx) !== i || Math.floor(pz + dz) !== j) { ok = false; break; }
    }
    if (!ok) continue;
    if (pointInPoly([qx, qz], poly, clearRadius(kind))) continue;              // 空地
    if (inViewSector(poly, [qx, qz])) continue;                                // 朝镜头的扇形
    if (nearRoad.some((pt) => pointInPoly(pt, poly, ROAD_W / 2 + 0.02))) continue;   // 道路
    if (out.some((o) => blocks(h, o))) continue;
    out.push(h);
  }
  return out;
}

/**
 * 在聚居格 (i, j) 里按配方摆房子。放不满下限时整组依次缩到 0.9、0.8 倍重摆，取放得最多的一次；仍不够就少放。
 * nearRoad：附近道路中线上的采样点（世界格坐标）。
 */
export function placeHouses(i: number, j: number, kind: SettlementKind, seed: number,
  opts: { types?: Record<string, HouseType[]>; nearRoad?: P2[]; phase?: WarpPhase } = {}): HousePlacement[] {
  const types = opts.types ?? HOUSE_TYPES, nearRoad = opts.nearRoad ?? [], phase = opts.phase ?? warpPhase(seed);
  const [[lo, hi], cands, sizeK] = HOUSE_RECIPES[kind] ?? HOUSE_RECIPES.village;
  const n = lo + h32(seed, i, j, 300) % (hi - lo + 1);
  let best: H[] = [];
  for (const m of HOUSE_SHRINK) {
    const got = placeOnce(i, j, kind, seed, phase, types, nearRoad, cands, sizeK * m, n);
    if (got.length > best.length) best = got;
    if (best.length >= lo) break;
  }
  return best.map((h) => ({ artKey: h.key, houseKind: h.kind, x: h.x - (i + 0.5), z: h.z - (j + 0.5), w: h.w, h: h.h }));
}

/** 地点类型编号 → 配方类别（null = 不放房子：暗渊等）。 */
export function settlementKindOf(kind: string): SettlementKind | null {
  switch (kind) {
    case 'city': return 'city';
    case 'sect': return 'sectSeat';
    case 'town': return 'town';
    case 'fort': return 'fort';
    case 'village': case 'taiwu': return 'village';
    default: return null;
  }
}
