import { describe, expect, it } from 'vitest';
import { cellLevels, heightAt, makeLevelGrid, unwarp } from '../levels';
import { RegionCamera } from '../RegionCamera';
import { makeSampleRegion, type RegionData } from '../regionData';
import { gWarp, warpPhase } from '../warp';
import { Vector2, Vector3 } from 'three';

function region(n: number, ground: number[]): RegionData {
  return { id: 't', name: 't', size: n, seed: 3, ground: Uint8Array.from(ground), variant: new Uint8Array(n * n), locations: [], playerCell: 0 };
}

describe('unwarp', () => {
  it('round-trips 1000 random points within 1e-4', () => {
    const p = warpPhase(11);
    for (let i = 0; i < 1000; i++) {
      const u = Math.random() * 15, v = Math.random() * 15;
      const [x, z] = unwarp(u, v, p);
      const [dx, dz] = gWarp(x, z, p);
      expect(Math.hypot(x + dx - u, z + dz - v)).toBeLessThan(1e-4);
    }
  });
});

describe('cellLevels', () => {
  it('mountain climbs +1 per cell inward and caps at +3; hill stays 0', () => {
    // 7×7 山岳，外圈一圈丘陵（2）
    const n = 9, g = new Array(n * n).fill(2);
    for (let z = 1; z < 8; z++) for (let x = 1; x < 8; x++) g[z * n + x] = 0;
    const lv = cellLevels(region(n, g));
    expect(lv[0]).toBe(0);
    expect(lv[1 * n + 1]).toBe(1);
    expect(lv[2 * n + 2]).toBe(2);
    expect(lv[4 * n + 4]).toBe(3);
  });
  it('lake / marsh sink', () => {
    const n = 3, g = [3, 3, 3, 3, 10, 3, 3, 13, 3];
    const lv = cellLevels(region(n, g));
    expect(lv[4]).toBe(-1);
    expect(lv[7]).toBe(-0.5);
  });
});

describe('picking height correction', () => {
  it('naive y=0 pick is off on raised ground; corrected pick matches', () => {
    const r = makeSampleRegion(15, 5);
    const lv = makeLevelGrid(r, true), p = warpPhase(r.seed!);
    const rig = new RegionCamera();
    rig.setRegionSize(15); rig.resize(1920, 1080);
    // 找最高的格
    let best = 0; lv.level.forEach((l, i) => { if (l > lv.level[best]) best = i; });
    const target = new Vector3((best % 15) + 0.5, 0, ((best / 15) | 0) + 0.5);
    target.y = heightAt(lv, target.x, target.z, p, 0.05);
    rig.snap(new Vector3(target.x, 0, target.z));
    rig.camera.updateMatrixWorld();
    const ndc = target.clone().project(rig.camera);
    const nv = new Vector2(ndc.x, ndc.y);
    const naive = rig.groundAt(nv)!;
    const hit = rig.groundAt(nv)!.clone();
    for (let k = 0; k < 2; k++) rig.groundAt(nv, hit, heightAt(lv, hit.x, hit.z, p, 0.05));
    if (target.y > 0.1) expect(Math.hypot(naive.x - target.x, naive.z - target.z)).toBeGreaterThan(0.08);
    expect(Math.hypot(hit.x - target.x, hit.z - target.z)).toBeLessThan(1e-6);
  });
});
