import { describe, it, expect } from 'vitest';
import type { PCG32 } from '../rng';
import { initCombat, step, hashState } from '../combat/CombatSim';
import { calcAttackInterval, weaponSwitchRate, WEAPON_SWITCH_TOTAL, tickWeaponSwitch } from '../combat/weapon';
import { hitChancePermille, hitCheck } from '../combat/hit';
import { checkChangeMove, applyChangeMoveEffect, autoChangeMovePart } from '../combat/changeMove';
import { chaseChance, checkChase, comboAdvantage } from '../combat/chase';
import {
  calcInnerRatio, calcArmorMult, calcPenetrationMult, calcNormalAttackDamage, calcGeneralAdjust, resolveDamageChain,
} from '../combat/damage';
import { resolveGuard } from '../combat/guard';
import { createWound, applyWound, WOUND_BASE, defeatThreshold } from '../combat/wound';
import { focusGain, addFocusFrom } from '../combat/focus';
import { resolveAttackRound } from '../combat/attack';
import { statOf } from '../combat/stats';
import { runHeadless } from '../combat/headless';
import { config } from './fixtures';

/** 按脚本返回的伪 RNG（只实现用到的方法） */
function scriptedRng(values: number[]): PCG32 {
  let i = 0;
  const next = () => values[i++ % values.length]!;
  return { randInt: (_: number) => next(), range: (_a: number, _b: number) => next(), weightedPick: () => next() } as unknown as PCG32;
}

describe('10.1 攻击间隔', () => {
  it.each([
    [6000, 3, 100, 70], [3000, 1, 100, 35], [9000, 5, 100, 106], [6000, 3, 50, 105], [6000, 3, 200, 42],
  ])('speed=%i weight=%i atk=%i%% → %i 帧', (sc, w, as, exp) => {
    expect(calcAttackInterval(sc, w, as)).toBe(exp);
  });
});

describe('10.2 命中概率', () => {
  it.each([
    [100, 100, 0, 0, 500, 1], [200, 100, 0, 0, 1000, 2], [10, 200, 0, 0, 50, 1],
    [100, 100, 50, 0, 750, 1], [100, 100, 0, 50, 333, 1], [150, 100, 0, 0, 750, 1],
  ])('命中%i 化解%i 福缘%i/%i → %i‰ 程度%i', (h, a, fa, fd, p, sev) => {
    expect(hitChancePermille(h, a, fa, fd)).toBe(p);
    expect(hitCheck(scriptedRng([0]), h, a, fa, fd).severity).toBe(sev);
  });
  it('roll < p 命中', () => {
    expect(hitCheck(scriptedRng([499]), 100, 100, 0, 0).hit).toBe(true);
    expect(hitCheck(scriptedRng([500]), 100, 100, 0, 0).hit).toBe(false);
  });
});

describe('10.3 变招 PRD', () => {
  it.each([
    [0, 30, 25, true, 0], [0, 30, 35, false, 30], [400, 30, 420, true, 0], [790, 30, 50, true, 0],
  ])('meter=%i coef=%i roll=%i → %s, meter=%i', (m, c, roll, trig, nm) => {
    const r = checkChangeMove(scriptedRng([roll]), m, c, true);
    expect(r.triggered).toBe(trig);
    expect(r.newMeter).toBe(nm);
  });
  it('音/咒/药/毒不可变招', () => {
    expect(checkChangeMove(scriptedRng([0]), 790, 30, false).triggered).toBe(false);
  });
  it('部位附带效果', () => {
    const s = initCombat(config());
    const d = s.fighters[1];
    d.breath = 10000; d.stance = 10000; d.stances = ['chop', 'stab', 'wild', 'chop'];
    applyChangeMoveEffect(s.rng, 'chest', d); expect(d.breath).toBe(8000);
    applyChangeMoveEffect(s.rng, 'waist', d); expect(d.stance).toBe(8000);
    applyChangeMoveEffect(s.rng, 'head', d); expect(d.stances).toHaveLength(1);
    d.attackInterval = 70; d.attackProgress = 50;
    applyChangeMoveEffect(s.rng, 'rightArm', d); expect(d.attackProgress).toBe(40); // 剩余 20 → 30
    d.moveProgress = 1000;
    applyChangeMoveEffect(s.rng, 'leftLeg', d); expect(d.moveProgress).toBe(800);
  });
  it('自动变招：破绽优先，其次点穴', () => {
    const s = initCombat(config());
    const e = s.fighters[1];
    e.wounds.leftLeg.acupoints = 1;
    expect(autoChangeMovePart(s.rng, e)).toBe('leftLeg');
    e.wounds.rightArm.weakness = 1;
    expect(autoChangeMovePart(s.rng, e)).toBe('rightArm');
  });
});

describe('10.4 追击', () => {
  it.each([[30, 0, 600], [30, 1, 555], [30, 5, 0], [125, 0, 1000], [125, 4, 1000], [5, 0, 100]])(
    'coef=%i n=%i → %i‰', (c, n, p) => { expect(chaseChance(c, n)).toBe(p); });
  it('≥5 次绝不追击，≥125 必追', () => {
    expect(checkChase(scriptedRng([0]), 999, 5)).toBe(false);
    expect(checkChase(scriptedRng([999]), 125, 4)).toBe(true);
  });
});

describe('10.5 连环奇击', () => {
  it.each([[300, 100, 110], [100, 300, 40], [400, 100, 115], [100, 100, 40]])(
    '内息 %i vs %i → 优势 %i', (a, d, adv) => { expect(comboAdvantage(a, d)).toBe(adv); });
});

describe('10.6 内伤比例', () => {
  it.each([[500, 100, 10, 501], [200, 100, 10, 200], [800, -50, 10, 799], [500, 0, 10, 500]])(
    '基础%i 发挥%i 系数%i → %i', (b, np, conv, exp) => {
      expect(calcInnerRatio({ innerRatioBase: b, neigongConv: conv }, np).weaponRatio).toBe(exp);
    });
  it('功法内伤比例 = (武器 + 功法)/2', () => {
    const r = calcInnerRatio({ innerRatioBase: 500, neigongConv: 10 }, 0, 300);
    expect(r.finalRatio).toBe(400);
  });
});

describe('10.7 破甲倍率', () => {
  it.each([[50, 100, 500, 750], [100, 50, 750, 875], [0, 0, 1000, 1000]])(
    '破甲%i 坚韧%i → %i/%i', (ab, t, o, i) => { expect(calcArmorMult(ab, t, false)).toEqual({ outer: o, inner: i }); });
  it('变招成功无视护甲', () => { expect(calcArmorMult(0, 100, true)).toEqual({ outer: 1000, inner: 1000 }); });
});

describe('破体/破气倍率', () => {
  it('攻 ≤ 守：1 + (atk-def)/def × 1.2，下限 0.1', () => {
    expect(calcPenetrationMult(100, 100, 500, true, 2000)).toBe(1000);
    expect(calcPenetrationMult(50, 100, 500, true, 2000)).toBe(400);
    expect(calcPenetrationMult(0, 100, 500, true, 2000)).toBe(100);
  });
  it('攻 > 守：系数按内伤比例；普攻减半；上限 2/3 倍', () => {
    expect(calcPenetrationMult(200, 100, 500, false, 3000)).toBe(2000);
    expect(calcPenetrationMult(200, 100, 500, true, 2000)).toBe(1500);
    expect(calcPenetrationMult(200, 100, 900, false, 3000)).toBe(1400);
    expect(calcPenetrationMult(1000, 100, 500, true, 2000)).toBe(2000);
  });
});

describe('常规伤害 / 通用调整', () => {
  it('普攻常规伤害', () => {
    const r = calcNormalAttackDamage(1000, 300, { outer: 1000, inner: 1000 }, 1000, 1000, { outer: 1000, inner: 1000 }, 1000);
    expect(r).toEqual({ outer: 700, inner: 300 });
    const c = calcNormalAttackDamage(1000, 300, { outer: 1000, inner: 1000 }, 1000, 1000, { outer: 1000, inner: 1000 }, 3000);
    expect(c).toEqual({ outer: 2100, inner: 900 });
    expect(calcNormalAttackDamage(1, 500, { outer: 500, inner: 750 }, 1000, 1000, { outer: 100, inner: 100 }, 1000)).toEqual({ outer: 10, inner: 10 });
  });
  it('点穴 +10% 内伤/层，破绽 +10% 外伤/层', () => {
    const s = initCombat(config());
    const d = s.fighters[1];
    d.wounds.chest.acupoints = 3; d.wounds.chest.weakness = 2;
    expect(calcGeneralAdjust(d, 'chest')).toEqual({ outer: 1200, inner: 1300 });
    expect(calcGeneralAdjust(d, 'spirit')).toEqual({ outer: 1000, inner: 1000 });
  });
});

describe('10.8 守御结算', () => {
  function setup(guard: number, distance: number) {
    const s = initCombat(config());
    s.distance = distance;
    const d = s.fighters[1];
    d.guardMax = 5000; d.guard = guard;
    return { s, d };
  }
  it('3000 守御 / 100 伤势 / 2.0 → 扣 100，未破', () => {
    const { s, d } = setup(3000, 2.0);
    const r = resolveGuard(s, d, 100, s.distance);
    expect(r).toMatchObject({ absorbed: true, guardDamage: 100 });
    expect(d.guard).toBe(2900);
  });
  it('50 守御 / 100 伤势 → 尽破', () => {
    const { s, d } = setup(50, 2.0);
    expect(resolveGuard(s, d, 100, s.distance).absorbed).toBe(false);
    expect(d.guardBroken).toBe(true);
  });
  it('距离 6.0 → 35%', () => {
    const { s, d } = setup(3000, 6.0);
    expect(resolveGuard(s, d, 100, s.distance).guardDamage).toBe(35);
  });
  it('0 守御 → 尽破，不吸收；尽破后护体/御气 -40%', () => {
    const { s, d } = setup(0, 2.0);
    expect(resolveGuard(s, d, 100, s.distance).absorbed).toBe(false);
    expect(d.guardBroken).toBe(true);
    expect(statOf(d, 'protection')).toBe(60);
  });
  it('心神/毒发无视守御', () => {
    const { s, d } = setup(3000, 2.0);
    expect(resolveGuard(s, d, 100, s.distance, true).guardDamage).toBe(0);
  });
});

describe('10.9 伤口与战败', () => {
  it('伤口基础值表', () => {
    expect(createWound('head', 500, 200, 2)).toMatchObject({ outer: 100, inner: 40 });
    expect(createWound('chest', 500, 500, 1)).toMatchObject({ outer: 30, inner: 30 });
    expect(WOUND_BASE.leftArm).toBe(40);
  });
  it.each([
    [400, 100, 'deathmatch', false], [400, 600, 'deathmatch', true], [400, 100, 'spar', true], [740, 10, 'fierce', true],
  ] as const)('外伤 %i + %i（%s）→ 战败 %s', (cur, add, bt, exp) => {
    const s = initCombat(config(1n, { battleType: bt }));
    const f = s.fighters[0];
    f.wounds.chest.outer = cur; f.totalOuter = cur;
    const r = applyWound(s, f, { part: 'waist', outer: add, inner: 0, grade: 1, frame: 0 });
    expect(r.defeated).toBe(exp);
  });
  it('阈值：切磋/接招 500，恶战 750，死斗 1000', () => {
    expect([defeatThreshold('spar'), defeatThreshold('accept'), defeatThreshold('fierce'), defeatThreshold('deathmatch')]).toEqual([500, 500, 750, 1000]);
  });
});

describe('专注增加', () => {
  it('每 1% 守御损失 / 战败条件 1% 伤势 +5（按战斗类型倍率），不足 +1', () => {
    expect(focusGain('deathmatch', 1)).toBe(5);
    expect(focusGain('spar', 1)).toBe(10);
    expect(focusGain('fierce', 3)).toBe(19);
    expect(focusGain('deathmatch', 0)).toBe(1);
    const s = initCombat(config());
    const f = s.fighters[0];
    f.focus = 995;
    expect(addFocusFrom(f, 'spar', 10)).toBe(5);
  });
});

describe('武器切换冷却', () => {
  it('每帧减 (550 - 重量×50) × 切换效率%', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    expect(weaponSwitchRate(f)).toBe(400);
    f.weaponSwitchCooldown = WEAPON_SWITCH_TOTAL;
    tickWeaponSwitch(f);
    expect(f.weaponSwitchCooldown).toBe(WEAPON_SWITCH_TOTAL - 400);
    f.wounds.leftArm.acupoints = 2; // 左臂点穴 -10%
    expect(weaponSwitchRate(f)).toBe(360);
  });
});

describe('10.10 伤害链端到端', () => {
  function duel(seed = 7n) {
    const s = initCombat(config(seed, { battleType: 'deathmatch' }));
    const [a, b] = s.fighters;
    b.guard = 0; b.guardBroken = true;
    return { s, a, b };
  }
  it('默认属性：50% 内伤 / 无甲 / 破体=护体 → 外内各 500 → 胸背伤口 30', () => {
    const { s, a, b } = duel();
    const c = resolveDamageChain(s, a, b, { source: 'attack', channel: 'power', part: 'chest', grade: 1 });
    expect(c.innerRatio).toBe(500);
    expect(c.armorMult).toEqual({ outer: 1000, inner: 1000 });
    // 已尽破 → 护体/御气 ×0.6 → 破体倍率 1 + 40/60 × 0.5 = 1333
    expect(c.penetration.mult).toEqual({ outer: 1333, inner: 1333 });
    expect(c.regular).toEqual({ outer: 666, inner: 666 });
    expect(c.final).toEqual({ outer: 666, inner: 666 });
    expect(c.woundsCreated[0]).toMatchObject({ part: 'chest', outer: 39, inner: 39 });
    expect(b.totalOuter).toBe(39);
    expect(c.focusGained).toBeGreaterThan(0);
  });
  it('重伤 + 点穴破绽放大', () => {
    const { s, a, b } = duel();
    b.guardBroken = true;
    b.wounds.head.acupoints = 5; b.wounds.head.weakness = 5;
    const c = resolveDamageChain(s, a, b, { source: 'attack', channel: 'power', part: 'head', grade: 2 });
    expect(c.generalAdjust).toEqual({ outer: 1500, inner: 1500 });
    expect(c.final.outer).toBe(Math.floor(c.regular.outer * 1.5));
    expect(c.woundsCreated[0]!.outer).toBe(Math.floor(c.final.outer * 2 * 100 / 1000));
  });
  it('守御足够时被吸收，不产生伤口', () => {
    const { s, a, b } = duel();
    b.guardMax = 5000; b.guard = 5000; b.guardBroken = false;
    const c = resolveDamageChain(s, a, b, { source: 'attack', channel: 'power', part: 'chest', grade: 1 });
    expect(c.absorbedByGuard).toBe(true);
    expect(c.woundsCreated).toHaveLength(0);
    expect(b.guard).toBe(5000 - c.guardDamage);
  });
  it('破甲/坚韧 + 造成外伤加成', () => {
    const { s, a, b } = duel();
    b.stats.armorToughness = 50; a.stats.armorPenetration = 100; a.stats.dealOuter = 200;
    const c = resolveDamageChain(s, a, b, { source: 'attack', channel: 'power', part: 'chest', grade: 1 });
    expect(c.armorMult).toEqual({ outer: 750, inner: 875 });
    expect(c.dealMult.outer).toBe(2000);
    expect(c.regular.outer).toBe(Math.floor(1000 * 0.5 * 0.75 * 2 * 1.333 * 1));
  });
  it('心神部位：无视守御', () => {
    const { s, a, b } = duel();
    b.guardMax = 5000; b.guard = 5000; b.guardBroken = false;
    const c = resolveDamageChain(s, a, b, { source: 'attack', channel: 'power', part: 'spirit', grade: 1 });
    expect(c.absorbedByGuard).toBe(false);
    expect(b.specialWounds.spirit.outer).toBeGreaterThan(0);
    expect(c.steps.length).toBeGreaterThan(5);
  });
});

describe('普攻回合', () => {
  it('回合：命中则获得当前轮盘式，轮盘推进，记录 DamageCalc', () => {
    for (let seed = 1n; seed < 20n; seed++) {
      const s = initCombat(config(seed));
      const [a, b] = s.fighters;
      a.stats.hitPower = a.stats.hitSpeed = a.stats.hitSkill = 10000; b.guard = 0;
      const before = a.wheelIndex;
      const r = resolveAttackRound(s, a);
      expect(a.wheelIndex).toBe((before + 1) % 6);
      expect(r.hits).toBeGreaterThanOrEqual(1);
      expect(r.hits).toBeLessThanOrEqual(6);
      expect(s.calcs.length).toBeGreaterThan(0);
    }
  });
  it('系数 ≥125 必出 6 连', () => {
    const s = initCombat(config(3n));
    const [a] = s.fighters;
    a.weapons.forEach(w => { w.chaseCoef = 125; w.changeCoef = 0; });
    s.fighters[1].stats.innerBreath = 10000; // 压制连环奇击
    expect(resolveAttackRound(s, a).hits).toBe(6);
  });
  it('无头 1000 帧 step 无崩溃，同 seed 结果一致', () => {
    const run = () => { const s = initCombat(config(11n, { battleType: 'deathmatch' })); for (let i = 0; i < 1000; i++) step(s); return hashState(s); };
    expect(run()).toBe(run());
  });
  it('无头模式能分出胜负', () => {
    for (const seed of [1n, 2n, 3n, 4n]) expect(runHeadless(config(seed)).phase).toBe('ended');
  });
});
