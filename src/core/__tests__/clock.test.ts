import { describe, it, expect } from 'vitest';
import { Clock } from '../Clock';

describe('Clock', () => {
  it('1 秒后 frame = 60', () => {
    const c = new Clock();
    for (let i = 0; i < 60; i++) c.update(1 / 60);
    expect(c.frame).toBe(60);
  });
  it('大 dt 被截断为 0.1s，防螺旋', () => {
    const c = new Clock();
    expect(c.update(5)).toBe(6);
  });
  it('alpha 在 [0,1)', () => {
    const c = new Clock();
    c.update(1 / 120);
    expect(c.alpha).toBeCloseTo(0.5, 5);
    c.reset();
    expect(c.frame).toBe(0);
    expect(c.alpha).toBe(0);
  });
});
