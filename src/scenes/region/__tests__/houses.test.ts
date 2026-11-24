import { describe, expect, it } from 'vitest';
import { h32, hf } from '../hash';
import { HOUSE_CLEAR_R, HOUSE_DEPTH, inViewSector, placeHouses, type SettlementKind } from '../houseRecipes';
import { gWarp, warpPhase } from '../warp';
import fixture from './fixtures/houses-python.json';

describe('h32 / hf match preview_grid.py', () => {
  it('known values', () => {
    // python3 -c "import preview_grid as pg; print(pg.h32(1,2,3), pg.h32(0), pg.h32(4294967295,7), pg.h32(-1,5))"
    expect(h32(1, 2, 3)).toBe(3034531621);
    expect(h32(0)).toBe(2705155257);
    expect(h32(4294967295, 7)).toBe(541077003);
    expect(h32(-1, 5)).toBe(2200310807);
    expect(hf(5, 6)).toBeGreaterThanOrEqual(0);
    expect(hf(5, 6)).toBeLessThan(1);
  });
});

describe('placeHouses matches the Python reference', () => {
  for (const c of fixture.cases) {
    it(`${c.kind} seed ${c.seed} @(${c.i},${c.j})`, () => {
      const got = placeHouses(c.i, c.j, c.kind as SettlementKind, c.seed, { nearRoad: c.road as [number, number][] });
      expect(got.map((h) => h.artKey)).toEqual(c.houses.map((h) => h.key));
      got.forEach((h, k) => {
        const e = c.houses[k];
        expect(h.x).toBeCloseTo(e.x, 9); expect(h.z).toBeCloseTo(e.z, 9);
        expect(h.w).toBeCloseTo(e.w, 9); expect(h.h).toBeCloseTo(e.h, 9);
      });
    });
  }
});

describe('constraints', () => {
  const kinds: SettlementKind[] = ['village', 'fort', 'town', 'city', 'sectSeat'];
  it('clear area, own cell, no overlap, view sector, first house kind', () => {
    for (let s = 0; s < 60; s++) {
      const kind = kinds[s % 5], seed = 7 + s * 13, i = 4, j = 5, phase = warpPhase(seed);
      const hs = placeHouses(i, j, kind, seed);
      const apex: [number, number] = kind === 'sectSeat' ? [0, 0.24] : [0, 0];
      if (kind === 'fort' && hs.length) expect(hs[0].houseKind).toBe('tower');
      if (kind === 'sectSeat' && hs.length) {
        expect(hs[0].houseKind).toBe('hall');
        expect(Math.abs(hs[0].x)).toBeLessThanOrEqual(0.03 + 1e-9);
        expect(hs[0].z).toBeGreaterThanOrEqual(-0.3 - 1e-9); expect(hs[0].z).toBeLessThanOrEqual(-0.2 + 1e-9);
      }
      for (const h of hs) {
        const poly: [number, number][] = [[h.x - h.w / 2, h.z - HOUSE_DEPTH / 2], [h.x + h.w / 2, h.z - HOUSE_DEPTH / 2],
          [h.x + h.w / 2, h.z + HOUSE_DEPTH / 2], [h.x - h.w / 2, h.z + HOUSE_DEPTH / 2]];
        // 四角在本格（扭曲后）
        for (const [px, pz] of poly) {
          const wx = px + i + 0.5, wz = pz + j + 0.5, [dx, dz] = gWarp(wx, wz, phase);
          expect(Math.floor(wx + dx)).toBe(i); expect(Math.floor(wz + dz)).toBe(j);
        }
        // 空地：矩形离空地中心 > 半径
        const r = kind === 'sectSeat' ? 0.14 : HOUSE_CLEAR_R;
        const cx = Math.max(poly[0][0], Math.min(apex[0], poly[1][0])), cz = Math.max(poly[0][1], Math.min(apex[1], poly[2][1]));
        expect(Math.hypot(cx - apex[0], cz - apex[1])).toBeGreaterThan(r - 1e-9);
        expect(inViewSector(poly, apex)).toBe(false);
      }
    }
  });
});
