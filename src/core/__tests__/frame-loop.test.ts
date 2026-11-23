import { describe, it, expect } from 'vitest';
import { initCombat, step, hashState, replay } from '../combat/CombatSim';
import { runHeadless } from '../combat/headless';
import { RESOURCE_MAX } from '../combat/resource';
import type { CombatAction } from '../combat/types';
import { config } from './fixtures';

function scripted(n: number): CombatAction | null {
  if (n === 30) return { type: 'setTargetDistance', actorId: 'a', delta: -0.5 };
  if (n === 200) return { type: 'switchWeapon', actorId: 'b', weaponId: 'spear' };
  if (n === 400) return { type: 'setTargetDistance', actorId: 'b', delta: 1 };
  return null;
}

function run(seed: bigint, frames: number): string[] {
  const s = initCombat(config(seed));
  const hashes: string[] = [];
  for (let i = 0; i < frames; i++) {
    const c = scripted(i);
    step(s, c ? [c] : []);
    hashes.push(hashState(s));
  }
  return hashes;
}

describe('帧循环', () => {
  it('同 (seed, commands) 逐帧 hash 一致', () => {
    expect(run(2024n, 1500)).toEqual(run(2024n, 1500));
  });
  it('不同 seed 结果不同', () => {
    expect(run(1n, 1500).at(-1)).not.toBe(run(2n, 1500).at(-1));
  });
  it('commandLog 回放可完全复现', () => {
    const s = initCombat(config(77n));
    for (let i = 0; i < 1200; i++) { const c = scripted(i); step(s, c ? [c] : []); }
    const r = replay(config(77n), s.commandLog, 1200);
    expect(hashState(r)).toBe(hashState(s));
  });
  it('无头模式：站在 5.0 自动普攻直到分出胜负', () => {
    const s = runHeadless(config(3n));
    expect(s.phase).toBe('ended');
    const loser = s.fighters.find(f => f.totalInner >= 50 || f.totalOuter >= 50);
    expect(loser).toBeDefined();
  });
  it('暂停时不推进帧，恢复后继续', () => {
    const s = initCombat(config());
    step(s, [{ type: 'pause' }]);
    step(s); step(s);
    expect(s.frame).toBe(0);
    step(s, [{ type: 'resume' }]);
    expect(s.frame).toBe(1);
  });
  it('施展：双满时可施展，期间不回复，结束后出手', () => {
    const s = initCombat(config(9n));
    const f = s.fighters[0];
    f.breath = RESOURCE_MAX; f.stance = RESOURCE_MAX;
    const ev = step(s, [{ type: 'castTechnique', actorId: f.id, skillId: 'test', castFrames: 10 }]);
    expect(ev.map(e => e.type)).toContain('techniqueCastStart');
    expect(f.castPhase).toBe('casting');
    const all: string[] = [];
    for (let i = 0; i < 200 && f.castPhase === 'casting'; i++) all.push(...step(s).map(e => e.type));
    expect(f.castPhase).toBe('none');
    expect(all).toContain('techniqueStage');
  });
  it('逃跑达到阈值结束战斗', () => {
    const s = initCombat(config(5n, { startDistance: 9 }));
    s.fighters.forEach(f => { f.targetDistance = 9; });
    step(s, [{ type: 'flee', actorId: 'a' }]);
    for (let i = 0; i < 400 && s.phase !== 'ended'; i++) step(s);
    expect(s.phase).toBe('ended');
  });
});
