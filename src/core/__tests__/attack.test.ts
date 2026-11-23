import { describe, it, expect } from 'vitest';
import { initCombat } from '../combat/CombatSim';
import { getAttackInterval, tickAttack, isInWeaponRange, WEAPON_SPEED_CLASS } from '../combat/attack';
import { config } from './fixtures';

describe('攻击进度', () => {
  it('普通速 + 重量3 + 100% 攻速 → 70 帧', () => {
    expect(getAttackInterval(WEAPON_SPEED_CLASS.normal, 3, 100, 0)).toBe(70);
  });
  it('右臂点穴降低出手速度', () => {
    expect(getAttackInterval(6000, 3, 100, 4)).toBeGreaterThan(70);
  });
  it('初始化时按武器算出间隔', () => {
    const s = initCombat(config());
    expect(s.fighters[0].attackInterval).toBe(70);
  });
  it('超出武器距离不累加（也不清零）', () => {
    const s = initCombat(config(42n, { startDistance: 8 }));
    const f = s.fighters[0];
    f.attackProgress = 10;
    expect(isInWeaponRange(f, s.distance)).toBe(false);
    tickAttack(s, f);
    expect(f.attackProgress).toBe(10);
    expect(f.attackPhase).toBe('outOfRange');
  });
  it('范围内满间隔即出手并加动画锁', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    for (let i = 0; i < 69; i++) tickAttack(s, f);
    expect(s.animLock).toBe(0);
    tickAttack(s, f);
    expect(f.attackProgress).toBe(0);
    expect(f.attackPhase).toBe('striking');
    expect(s.animLock).toBeGreaterThan(0);
    const types = s.events.drain().map(e => e.type);
    expect(types).toContain('attackStart');
  });
});
