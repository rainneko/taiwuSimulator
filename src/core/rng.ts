/** PCG32 可播种随机数。战斗回放只需 (seed, commands[]) 即可复现。 */
const MASK64 = 0xFFFFFFFFFFFFFFFFn;

export interface RngSnapshot { state: string; inc: string }

export class PCG32 {
  private state: bigint;
  private inc: bigint;

  constructor(seed: bigint, seq: bigint = 1n) {
    this.inc = ((seq << 1n) | 1n) & MASK64;
    this.state = 0n;
    this.next();
    this.state = (this.state + seed) & MASK64;
    this.next();
  }

  /** [0, 2^32) 无符号整数 */
  next(): number {
    const old = this.state;
    this.state = (old * 6364136223846793005n + this.inc) & MASK64;
    const xorShifted = Number((((old >> 18n) ^ old) >> 27n) & 0xFFFFFFFFn) >>> 0;
    const rot = Number(old >> 59n);
    return ((xorShifted >>> rot) | (xorShifted << ((-rot) & 31))) >>> 0;
  }

  /** [0, max) 整数，无模偏差 */
  randInt(max: number): number {
    if (!(max >= 1)) throw new RangeError(`randInt max must be >= 1, got ${max}`);
    const threshold = (0x100000000 - max) % max;
    let r: number;
    do { r = this.next(); } while (r < threshold);
    return r % max;
  }

  /** [min, max] 闭区间整数 */
  range(min: number, max: number): number { return min + this.randInt(max - min + 1); }

  /** [0, 1) 浮点 */
  random(): number { return this.next() / 0x100000000; }

  /** 百分比判定：chance 为 0-100 */
  chance(pct: number): boolean {
    if (pct <= 0) return false;
    if (pct >= 100) return true;
    return this.randInt(10000) < Math.floor(pct * 100);
  }

  /** 按整数权重抽一个索引 */
  weightedPick(weights: readonly number[]): number {
    const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (total <= 0) return this.randInt(weights.length);
    let r = this.randInt(total);
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  save(): RngSnapshot { return { state: this.state.toString(), inc: this.inc.toString() }; }

  static restore(s: RngSnapshot): PCG32 {
    const rng = Object.create(PCG32.prototype) as PCG32;
    rng.state = BigInt(s.state);
    rng.inc = BigInt(s.inc);
    return rng;
  }
}
