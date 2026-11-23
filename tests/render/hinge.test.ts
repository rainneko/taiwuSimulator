import { describe, expect, it } from 'vitest';
import { HINGE_FALL, HINGE_RISE, stepHinge, stepSpring } from '../../src/render/paper/hinge';

function run(target: number, p: typeof HINGE_RISE, start: number, dt: number) {
  const s = { theta: start, vel: 0 };
  let peak = start, min = start, restAt = -1;
  for (let i = 0; i < 5 / dt; i++) {
    const rest = stepHinge(s, target, p, dt);
    peak = Math.max(peak, s.theta); min = Math.min(min, s.theta);
    if (rest) { restAt = (i + 1) * dt; break; }
  }
  return { peak, min, restAt };
}

describe('hinge', () => {
  it('RISE 过冲 15–25%，1s 内静止', () => {
    const r = run(Math.PI / 2, HINGE_RISE, 0, 1 / 60);
    const over = (r.peak - Math.PI / 2) / (Math.PI / 2);
    expect(over).toBeGreaterThan(0.15);
    expect(over).toBeLessThan(0.25);
    expect(r.restAt).toBeGreaterThan(0);
    expect(r.restAt).toBeLessThanOrEqual(1.0);
  });
  it('FALL 无过冲、theta ≥ 0', () => {
    const r = run(0, HINGE_FALL, Math.PI / 2, 1 / 60);
    expect(r.min).toBeGreaterThanOrEqual(0);
    expect(r.peak).toBeLessThanOrEqual(Math.PI / 2);
    expect(r.restAt).toBeGreaterThan(0);
  });
  it('不同 dt 静止时刻相差 < 2 帧', () => {
    const ts = [1 / 30, 1 / 60, 1 / 144].map((dt) => run(Math.PI / 2, HINGE_RISE, 0, dt).restAt);
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      expect(Math.max(...ts) - Math.min(...ts)).toBeLessThan(2 * Math.max(dt, 1 / 60));
    }
  });
  it('stepSpring 在 dt=1s 下不发散', () => {
    const s = { x: 10, v: -50 };
    for (let i = 0; i < 20; i++) stepSpring(s, 0, 8, 1);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
    expect(Number.isFinite(s.v)).toBe(true);
  });
});
