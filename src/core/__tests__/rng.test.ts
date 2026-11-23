import { describe, it, expect } from 'vitest';
import { PCG32 } from '../rng';

describe('PCG32', () => {
  it('同种子序列一致，不同种子不同', () => {
    const a = new PCG32(123n), b = new PCG32(123n), c = new PCG32(124n);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(2 ** 32); }
  });
  it('randInt(6) 10 万次分布均匀', () => {
    const r = new PCG32(7n);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 100000; i++) counts[r.randInt(6)]!++;
    for (const c of counts) expect(Math.abs(c - 16667)).toBeLessThan(500);
  });
  it('random() ∈ [0,1)', () => {
    const r = new PCG32(1n);
    for (let i = 0; i < 1000; i++) { const v = r.random(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
  it('save/restore 续接同一序列', () => {
    const r = new PCG32(99n);
    r.next(); r.next();
    const snap = r.save();
    const expected = [r.next(), r.next(), r.next()];
    const r2 = PCG32.restore(snap);
    expect([r2.next(), r2.next(), r2.next()]).toEqual(expected);
  });
  it('weightedPick 尊重权重，0 权重永不选中', () => {
    const r = new PCG32(5n);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) counts[r.weightedPick([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.7);
    expect(counts[2]! / counts[0]!).toBeLessThan(3.3);
  });
  it('chance 边界', () => {
    const r = new PCG32(5n);
    expect(r.chance(0)).toBe(false);
    expect(r.chance(100)).toBe(true);
  });
});
