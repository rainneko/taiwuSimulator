import { describe, it, expect } from 'vitest';
import { initCombat, step } from '../combat/CombatSim';
import { gainStance, nextWheelStance, matchStances, consumeStances, weaponSupports } from '../combat/stance';
import { config } from './fixtures';

describe('式系统', () => {
  it('轮盘按顺序循环提供式', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    const seq = Array.from({ length: 7 }, () => nextWheelStance(f));
    expect(seq).toEqual(['chop', 'stab', 'flick', 'chop', 'stab', 'wild', 'chop']);
  });
  it('9 式槽满后挤掉最早的', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    for (let i = 0; i < 9; i++) gainStance(s, f, 'chop');
    gainStance(s, f, 'stab');
    expect(f.stances).toHaveLength(9);
    expect(f.stances[8]).toBe('stab');
  });
  it('万能式可替代普通式但不能替代杀式', () => {
    expect(matchStances(['wild', 'chop'], ['chop', 'stab'])).toEqual([0, 1]);
    expect(matchStances(['wild'], ['kill'])).toBeNull();
    expect(matchStances(['chop'], ['chop', 'chop'])).toBeNull();
  });
  it('消耗式', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    f.stances = ['chop', 'stab', 'wild'];
    expect(consumeStances(f, ['stab', 'flick'])).toBe(true);
    expect(f.stances).toEqual(['chop']);
    expect(consumeStances(f, ['stab'])).toBe(false);
  });
  it('切换武器更换轮盘', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    expect(weaponSupports(f, 'sweep')).toBe(false);
    step(s, [{ type: 'switchWeapon', actorId: f.id, weaponId: 'spear' }]);
    expect(f.weaponId).toBe('spear');
    expect(weaponSupports(f, 'sweep')).toBe(true);
    expect(f.weaponSwitchCooldown).toBeGreaterThan(0);
  });
});
