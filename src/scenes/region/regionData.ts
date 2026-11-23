import { GROUND_TYPES, MOVE_COST, SETTLEMENT_GROUND } from './terrain';

export interface RegionLocation { cell: number; type: number; name: string }
export interface RegionData {
  id: string;
  name: string;
  provinceId?: string;
  size: number;                  // N（≤ 30）
  ground: Uint8Array;            // 每格地面类型 0–15
  variant: Uint8Array;           // 每格变体随机字节
  locations: RegionLocation[];
  playerCell: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function regionCost(r: RegionData, cell: number): number {
  return MOVE_COST[r.ground[cell]] ?? 1;
}

/** 程序生成的示例地区：值噪声分带出地形，再撒几个聚居点。 */
export function makeSampleRegion(size = 24, seed = 7): RegionData {
  const rnd = mulberry32(seed);
  const n = Math.min(30, size);
  // 粗网格值噪声 + 双线性
  const coarse = (step: number) => {
    const m = Math.ceil(n / step) + 2, v = Array.from({ length: m * m }, rnd);
    return (x: number, y: number) => {
      const fx = x / step, fy = y / step, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const s = (a: number, b: number) => v[b * m + a];
      const top = s(ix, iy) * (1 - tx) + s(ix + 1, iy) * tx, bot = s(ix, iy + 1) * (1 - tx) + s(ix + 1, iy + 1) * tx;
      return top * (1 - ty) + bot * ty;
    };
  };
  const height = coarse(6), moist = coarse(5), detail = coarse(2);
  const ground = new Uint8Array(n * n), variant = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const hgt = height(x, y) * 0.8 + detail(x, y) * 0.2, wet = moist(x, y);
    let t: number;
    if (hgt > 0.78) t = 0;                       // 山岳
    else if (hgt > 0.7) t = wet > 0.5 ? 7 : 1;   // 石林 / 峡谷
    else if (hgt > 0.6) t = 2;                   // 丘陵
    else if (hgt < 0.2) t = 10;                  // 湖泊
    else if (hgt < 0.26) t = 13;                 // 沼泽
    else if (wet > 0.68) t = 11;                 // 密林
    else if (wet > 0.55) t = 4;                  // 林地
    else if (wet < 0.25) t = 15;                 // 荒野
    else {
      const r = rnd();
      t = r < 0.55 ? 3 : r < 0.75 ? 5 : r < 0.83 ? 8 : r < 0.9 ? 9 : r < 0.95 ? 6 : r < 0.98 ? 12 : 14;
    }
    ground[y * n + x] = t % GROUND_TYPES;
    variant[y * n + x] = (rnd() * 256) | 0;
  }
  // 聚居点：挑可通行、彼此不太近的格子
  const wanted: Array<[number, string]> = [[33, '城'], [19, '门派'], [49, '市镇'], [50, '关寨'], [48, '村庄'], [48, '村庄'], [47, '太吾村']];
  const locations: RegionLocation[] = [];
  let guard = 0;
  while (locations.length < wanted.length && guard++ < 5000) {
    const c = (rnd() * n * n) | 0, x = c % n, y = (c / n) | 0;
    if (x < 1 || y < 1 || x > n - 2 || y > n - 2) continue;
    if (!isFinite(MOVE_COST[ground[c]])) continue;
    if (locations.some((l) => Math.abs(l.cell % n - x) + Math.abs(((l.cell / n) | 0) - y) < Math.max(4, n / 5))) continue;
    const [type, name] = wanted[locations.length];
    ground[c] = SETTLEMENT_GROUND;
    locations.push({ cell: c, type, name });
  }
  const home = locations.find((l) => l.type === 47) ?? locations[0];
  return { id: `sample-${seed}`, name: '示例地区', size: n, ground, variant, locations, playerCell: home?.cell ?? 0 };
}
