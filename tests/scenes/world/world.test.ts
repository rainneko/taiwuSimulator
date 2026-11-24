import { Box2, Vector2 } from 'three';
import { describe, expect, it } from 'vitest';
import { MapPanRig } from '../../../src/scenes/world/MapPanRig';
import { chroma, hexToOklab, oklabToSrgb, pieceColor, srgbToOklab } from '../../../src/scenes/world/oklab';
import {
  buildAdjacency, centroid, insetPolygon, labelPoint, normalizeOutline, pointInPolygon, signedArea, traceMask, type Pt,
} from '../../../src/scenes/world/outline';
import { PIECE_TARGETS, PieceSprings, liftTarget, stateOf, type PieceState } from '../../../src/scenes/world/pieceState';
import { planTravel, sampleTravel } from '../../../src/scenes/world/travelTimeline';
import { hopShape } from '../../../src/scenes/world/Token';
import { MAP_LAYOUT, PLACES, computeView, stubRoutes } from '../../../src/scenes/world/worldData';

const rnd = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();

describe('oklab', () => {
  it('round-trips random sRGB < 1e-4', () => {
    for (let i = 0; i < 1000; i++) {
      const c: [number, number, number] = [rnd(), rnd(), rnd()];
      const back = oklabToSrgb(srgbToOklab(...c));
      for (let k = 0; k < 3; k++) expect(Math.abs(back[k] - c[k])).toBeLessThan(1e-4);
    }
  });
  it('greys have a≈b≈0', () => {
    for (const g of [0, 0.5, 1]) { const [, a, b] = srgbToOklab(g, g, g); expect(Math.abs(a)).toBeLessThan(1e-4); expect(Math.abs(b)).toBeLessThan(1e-4); }
  });
  it('mid mix L lies between ends; sat=0 is grey', () => {
    const A = hexToOklab('#b9b29c'), B = hexToOklab('#2f7fc1');
    const mid = srgbToOklab(...pieceColor(A, B, 0.5, 1, 1));
    expect(mid[0]).toBeGreaterThanOrEqual(Math.min(A[0], B[0]) - 1e-3);
    expect(mid[0]).toBeLessThanOrEqual(Math.max(A[0], B[0]) + 1e-3);
    const [r, g, b] = pieceColor(A, B, 0.7, 1, 0);
    expect(Math.abs(r - g)).toBeLessThan(1e-3); expect(Math.abs(g - b)).toBeLessThan(1e-3);
  });
  it('layer base colours stay low-chroma (original highlight colours are used as accents)', () => {
    for (const c of Object.values(MAP_LAYOUT.palette.faction)) expect(chroma(hexToOklab(c))).toBeLessThanOrEqual(0.07);
    expect(PLACES.length).toBe(15);
    for (const p of PLACES) expect(p.accentColor).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('outline', () => {
  const sq: Pt[] = [[0, 0], [0, 4], [4, 4], [4, 0]];   // 顺时针
  it('normalize → positive area, CCW', () => {
    const n = normalizeOutline([...sq, [0, 0]]);
    expect(n.length).toBe(4); expect(signedArea(n)).toBeGreaterThan(0);
  });
  it('inset square shrinks side by 2d', () => {
    const r = insetPolygon(normalizeOutline(sq), 0.5)!;
    const xs = r.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3, 6);
  });
  it('inset of thin concave shape returns null', () => {
    const thin = normalizeOutline([[0, 0], [10, 0], [10, 0.3], [5.2, 0.3], [5, 3], [4.8, 0.3], [0, 0.3]]);
    expect(insetPolygon(thin, 0.4)).toBeNull();
  });
  it('labelPoint lands inside a U shape whose centroid is outside', () => {
    const U = normalizeOutline([[0, 0], [6, 0], [6, 6], [4, 6], [4, 1], [2, 1], [2, 6], [0, 6]]);
    expect(pointInPolygon(centroid(U), U)).toBe(false);
    expect(pointInPolygon(labelPoint(U), U)).toBe(true);
  });
  it('traceMask outlines the largest blob', () => {
    const w = 10, h = 8, m = new Uint8Array(w * h);
    for (let y = 2; y < 6; y++) for (let x = 1; x < 7; x++) m[y * w + x] = 1;
    m[9] = 1;   // 孤立像素
    const o = normalizeOutline(traceMask(m, w, h));
    expect(Math.abs(signedArea(o))).toBeCloseTo(24, 6);
    expect(o.length).toBe(4);
  });
  it('adjacency is symmetric', () => {
    const a = { id: 'a', outline: normalizeOutline([[0, 0], [2, 0], [2, 2], [0, 2]]) };
    const b = { id: 'b', outline: normalizeOutline([[2, 0], [4, 0], [4, 2], [2, 2]]) };
    const c = { id: 'c', outline: normalizeOutline([[10, 10], [11, 10], [11, 11], [10, 11]]) };
    const adj = buildAdjacency([a, b, c], 0.05);
    expect(adj.get('a')).toEqual(['b']); expect(adj.get('b')).toEqual(['a']); expect(adj.get('c')).toEqual([]);
  });
});

describe('piece state', () => {
  it('stateOf truth table', () => {
    expect(stateOf({ id: 'a', locked: true }, 'a', 'a')).toBe('locked');
    expect(stateOf({ id: 'a', locked: false }, 'a', 'a')).toBe('selected');
    expect(stateOf({ id: 'a', locked: false }, null, 'a')).toBe('hover');
    expect(stateOf({ id: 'a', locked: false }, 'b', 'a')).toBe('hover');
    expect(stateOf({ id: 'a', locked: false }, 'b', null)).toBe('dimmed');
    expect(stateOf({ id: 'a', locked: false }, null, null)).toBe('idle');
  });
  it('random hover/selection: ≤1 hover, ≤1 selected, settles to targets', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const springs = ids.map((_, i) => new PieceSprings(i % 4));
    let sel: string | null = null, hov: string | null = null;
    for (let step = 0; step < 500; step++) {
      if (rnd() < 0.5) hov = rnd() < 0.2 ? null : ids[Math.floor(rnd() * ids.length)];
      if (rnd() < 0.1) sel = rnd() < 0.3 ? null : ids[Math.floor(rnd() * ids.length)];
      const st = ids.map((id) => stateOf({ id, locked: false }, sel, hov));
      expect(st.filter((s) => s === 'hover').length).toBeLessThanOrEqual(1);
      expect(st.filter((s) => s === 'selected').length).toBeLessThanOrEqual(1);
      springs.forEach((s, i) => { s.state = st[i]; s.step(1 / 60); });
    }
    for (let k = 0; k < 30; k++) springs.forEach((s) => s.step(1 / 60));
    springs.forEach((s) => {
      const t = PIECE_TARGETS[s.state as PieceState];
      expect(s.settled()).toBe(true);
      expect(s.lift.x).toBeCloseTo(liftTarget(s.state, s.layerHeight), 2);
      expect(s.dim.x).toBeCloseTo(t.dim, 2); expect(s.accent.x).toBeCloseTo(t.accent, 2);
    });
  });
});

describe('travel timeline', () => {
  it('hops by apCost', () => {
    expect([10, 30, 60, 200].map((c) => planTravel(c).hops)).toEqual([2, 3, 6, 6]);
  });
  it('boundaries, monotonic curveT, line before hops, clamps past end', () => {
    const p = planTravel(40);
    const f0 = sampleTravel(p, 0);
    expect(f0.lineProgress).toBe(0); expect(f0.curveT).toBe(0);
    let prev = 0;
    for (let t = 0; t <= p.totalMs; t += 5) {
      const f = sampleTravel(p, t);
      expect(f.curveT).toBeGreaterThanOrEqual(prev - 1e-12); prev = f.curveT;
      if (f.curveT > 0) expect(f.lineProgress).toBe(1);
    }
    const end = sampleTravel(p, p.totalMs), past = sampleTravel(p, p.totalMs + 999);
    expect(end.curveT).toBe(1); expect(past).toEqual(end);
  });
  it('hop shape: squash then land', () => {
    expect(hopShape(0.15, 0.2).sy).toBeCloseTo(0.86, 6);
    expect(hopShape(0.5, 0.2).y).toBeCloseTo(0.2, 6);
    expect(hopShape(0.86, 0.2).sy).toBeLessThan(0.85);
  });
});

describe('MapPanRig', () => {
  const mk = () => {
    const rig = new MapPanRig({ fov: 20, pitchDeg: 75, distRange: [7, 62], bounds: new Box2(new Vector2(-10, -6), new Vector2(10, 6)) });
    rig.resize(1600, 900); rig.set(1, -2, 30, true);
    return rig;
  };
  const ev = (type: string, x: number, y: number, delta?: [number, number]) =>
    ({ type, ndc: new Vector2(x, y), px: [0, 0], button: 0, pointerType: 'mouse', delta, mods: { shift: false, ctrl: false, alt: false } }) as never;

  it('wheel zoom keeps the ground point under the pointer', () => {
    const rig = mk(), ndc = new Vector2(0.4, -0.3);
    const before = rig.groundAt(ndc)!.clone();
    rig.zoomAt(ndc, -3);
    for (let i = 0; i < 240; i++) rig.update(1 / 60);
    const after = rig.groundAt(ndc)!;
    expect(after.distanceTo(before)).toBeLessThan(1e-3);
  });
  it('drag keeps the grabbed point under the pointer', () => {
    const rig = mk();
    const grab = rig.groundAt(new Vector2(0, 0))!.clone();
    rig.onPointer(ev('down', 0, 0));
    for (let k = 1; k <= 10; k++) {
      const p = new Vector2(k * 0.03, -k * 0.02);
      rig.onPointer(ev('drag', p.x, p.y));
      const g = rig.groundAt(p, undefined, { x: rig.goalTarget.x, z: rig.goalTarget.z, d: rig.goalDist })!;
      expect(g.distanceTo(grab)).toBeLessThan(1e-3);
    }
  });
  it('out of bounds springs back within 0.6s', () => {
    const rig = mk();
    rig.set(30, 20, 30);
    for (let i = 0; i < 36; i++) rig.update(1 / 60);
    const t = rig.goalTarget;
    expect(t.x).toBeLessThanOrEqual(10 + 0.05); expect(t.z).toBeLessThanOrEqual(6 + 0.05);
  });
});

describe('world view (stub)', () => {
  it('derives one view per place; routes form a connected tree', () => {
    const routes = stubRoutes();
    const v = computeView('goodwill', 'p3', 100, routes);
    expect(v.provinces.length).toBe(PLACES.length);
    const seen = new Set(['p10']); let grew = true;
    while (grew) { grew = false; for (const r of routes) if (r.open && (seen.has(r.a) !== seen.has(r.b))) { seen.add(r.a); seen.add(r.b); grew = true; } }
    expect(seen.size).toBe(PLACES.length);
  });
});

describe('fallback voronoi', () => {
  it('cells tile the map rect: areas sum to W×H, each cell contains its seed', async () => {
    const { voronoiCells } = await import('../../../src/scenes/world/worldFallback');
    const seeds = PLACES.map((p) => p.center);
    const cells = voronoiCells(seeds, 1820, 1600);
    const total = cells.reduce((a, c) => a + Math.abs(signedArea(c)), 0);
    expect(total).toBeCloseTo(1820 * 1600, 0);
    cells.forEach((c, i) => expect(pointInPolygon(seeds[i], c)).toBe(true));
  });
});
