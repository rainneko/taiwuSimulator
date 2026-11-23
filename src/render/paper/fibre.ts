import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType,
} from 'three';

/** mulberry32：小而稳定的种子随机数。 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 可平铺值噪声：格点数 = ceil(size / cell)，格点取模回卷；返回 [0,1)。 */
function valueNoise(size: number, cell: number, rand: () => number): Float32Array {
  const n = Math.max(1, Math.round(size / cell));
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const out = new Float32Array(size * size);
  const step = size / n;
  for (let y = 0; y < size; y++) {
    const gy = y / step, y0 = Math.floor(gy), fy = gy - y0;
    const sy = fy * fy * (3 - 2 * fy);
    const r0 = (y0 % n) * n, r1 = ((y0 + 1) % n) * n;
    for (let x = 0; x < size; x++) {
      const gx = x / step, x0 = Math.floor(gx), fx = gx - x0;
      const sx = fx * fx * (3 - 2 * fx);
      const c0 = x0 % n, c1 = (x0 + 1) % n;
      const a = grid[r0 + c0] + (grid[r0 + c1] - grid[r0 + c0]) * sx;
      const b = grid[r1 + c0] + (grid[r1 + c1] - grid[r1 + c0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

/** 把通道平移到均值 0、再按 amp 缩放到 0.5 附近。 */
function normalise(f: Float32Array, amp: number): Float32Array {
  let mean = 0, maxDev = 0;
  for (const v of f) mean += v;
  mean /= f.length;
  for (const v of f) maxDev = Math.max(maxDev, Math.abs(v - mean));
  const k = maxDev > 0 ? amp / maxDev : 0;
  for (let i = 0; i < f.length; i++) f[i] = 0.5 + (f[i] - mean) * k;
  return f;
}

/** 返回 RGBA8：R = 细颗粒，G = 长纤维，B = 大尺度深浅斑，A = 255。四向可平铺，种子固定则逐字节一致。 */
export function makeFibreData(size = 512, seed = 0x5eed): Uint8Array {
  const rand = rng(seed);
  const N = size * size;

  // R：4px 与 11px 两个倍频
  const r4 = valueNoise(size, 4, rand), r11 = valueNoise(size, 11, rand);
  const R = new Float32Array(N);
  for (let i = 0; i < N; i++) R[i] = r4[i] * 0.6 + r11[i] * 0.4;
  normalise(R, 0.4);

  // G：size×1.4 根纤维，偏水平 ±25°
  const acc = new Float32Array(N);
  const count = Math.round(size * 1.4);
  for (let f = 0; f < count; f++) {
    const len = 18 + rand() * 52;
    const ang = (rand() * 2 - 1) * (25 * Math.PI / 180);
    const amp = (rand() < 0.5 ? -1 : 1) * 0.35;
    const x0 = rand() * size, y0 = rand() * size;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let t = 0; t < len; t++) {
      const x = ((Math.round(x0 + dx * t) % size) + size) % size;
      const y = ((Math.round(y0 + dy * t) % size) + size) % size;
      acc[y * size + x] += amp;
    }
  }
  const G = new Float32Array(N);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let s = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      s += acc[((y + oy + size) % size) * size + ((x + ox + size) % size)];
    }
    G[y * size + x] = s / 9;
  }
  normalise(G, 0.45);

  // B：96px 值噪声，±0.12
  const B = normalise(valueNoise(size, 96, rand), 0.12);

  const out = new Uint8Array(N * 4);
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let i = 0; i < N; i++) {
    out[i * 4] = q(R[i]); out[i * 4 + 1] = q(G[i]); out[i * 4 + 2] = q(B[i]); out[i * 4 + 3] = 255;
  }
  return out;
}

let fibreTex: DataTexture | null = null;
/** 单例；RepeatWrapping、LinearMipmapLinear、NoColorSpace。 */
export function getFibreTexture(): DataTexture {
  if (fibreTex) return fibreTex;
  const size = 512;
  const t = new DataTexture(makeFibreData(size), size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  fibreTex = t;
  return t;
}
