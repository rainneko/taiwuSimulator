import { describe, expect, it } from 'vitest';
import { findPath, pathCost } from '../pathfinding';

describe('findPath', () => {
  it('straight line on open grid', () => {
    const p = findPath(5, 0, 4, () => 1)!;
    expect(p).toEqual([0, 1, 2, 3, 4]);
  });
  it('routes around walls', () => {
    // 5×5，第 2 列除最底行外是墙
    const wall = new Set([2, 7, 12, 17]);
    const cost = (c: number) => (wall.has(c) ? Infinity : 1);
    const p = findPath(5, 0, 4, cost)!;
    expect(p[0]).toBe(0); expect(p[p.length - 1]).toBe(4);
    expect(p.some((c) => wall.has(c))).toBe(false);
    expect(p).toContain(22);
    expect(pathCost(p, cost)).toBe(p.length - 1);
  });
  it('prefers cheaper terrain', () => {
    // 3×3，中间一格很贵
    const cost = (c: number) => (c === 4 ? 10 : 1);
    const p = findPath(3, 3, 5, cost)!;
    expect(p).not.toContain(4);
  });
  it('returns null when unreachable', () => {
    expect(findPath(3, 0, 8, (c) => (c === 5 || c === 7 || c === 4 ? Infinity : 1))).toBeNull();
  });
});
