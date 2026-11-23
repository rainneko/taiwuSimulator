import { describe, it, expect } from 'vitest';
import { initCombat } from '../combat/CombatSim';
import { RESOURCE_MAX, tickBreathStance, canCastTechnique, initGuard, addFocus, getBreathStanceSpeed, absorbWithGuard, FOCUS_MAX } from '../combat/resource';
import { config, fighter } from './fixtures';

describe('提气/架势', () => {
  it('先填满提气再填架势', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    f.breath = RESOURCE_MAX - 50; f.stance = 0;
    tickBreathStance(f);
    expect(f.breath).toBe(RESOURCE_MAX);
    expect(f.stance).toBe(0);
    tickBreathStance(f);
    expect(f.stance).toBe(getBreathStanceSpeed(f));
  });
  it('双满才能施展', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    f.breath = RESOURCE_MAX; f.stance = RESOURCE_MAX - 1;
    expect(canCastTechnique(f)).toBe(false);
    f.stance = RESOURCE_MAX;
    expect(canCastTechnique(f)).toBe(true);
  });
  it('专注加成最多 +100%，点穴降低回复', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    expect(getBreathStanceSpeed(f)).toBe(100);
    f.focus = FOCUS_MAX;
    expect(getBreathStanceSpeed(f)).toBe(200);
    f.focus = 0;
    f.wounds.chest.acupoints = 2; f.wounds.waist.acupoints = 2;
    expect(getBreathStanceSpeed(f)).toBe(90);
  });
  it('开场：先手 80%/移动力3，后手 50%/移动力1', () => {
    const s = initCombat(config());
    const first = s.fighters.find(f => f.isFirst)!;
    const second = s.fighters.find(f => !f.isFirst)!;
    expect(first.breath).toBe(24000); expect(first.movementPoints).toBe(3);
    expect(second.stance).toBe(15000); expect(second.movementPoints).toBe(1);
  });
});

describe('守御', () => {
  it('守御上限公式与 5000 封顶，开场 50%', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    expect(f.guardMax).toBe(130); // (100+100)/2+30
    expect(f.guard).toBe(65);
    f.stats.protection = 20000; f.stats.qiControl = 20000;
    initGuard(f);
    expect(f.guardMax).toBe(5000);
  });
  it('守御先吸收伤害，打空时触发 guardBroken', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    f.guard = 100;
    expect(absorbWithGuard(s, f, 60)).toBe(0);
    expect(f.guard).toBe(40);
    expect(absorbWithGuard(s, f, 100)).toBe(60);
    expect(s.events.drain().map(e => e.type)).toContain('guardBroken');
  });
});

describe('专注', () => {
  it('按战斗类型倍率增加并封顶 1000', () => {
    const s = initCombat(config(1n, { fighters: [fighter('a'), fighter('b')] }));
    const f = s.fighters[0];
    addFocus(f, 10, 'spar'); expect(f.focus).toBe(20);
    addFocus(f, 10, 'fierce'); expect(f.focus).toBe(33);
    addFocus(f, 10, 'deathmatch'); expect(f.focus).toBe(43);
    addFocus(f, 10000, 'spar'); expect(f.focus).toBe(FOCUS_MAX);
  });
});
