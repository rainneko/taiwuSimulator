import { describe, it, expect } from 'vitest';
import { initCombat, step } from '../combat/CombatSim';
import type { CombatConfig, EffectSpec } from '../combat/types';
import { RESOURCE_MAX } from '../combat/resource';
import { calcCastTime, canCastTechnique, resolveTechnique, startCast, tenthsGrade, resolveArtRange } from '../combat/technique';
import { calcTechniqueDamage } from '../combat/damage';
import { gaugeCost } from '../combat/guardSkill';
import { checkCounterCondition } from '../combat/counter';
import { resolveAttackRound } from '../combat/attack';
import { addSeal, addFlaw, applyPreExistingWounds } from '../combat/sealFlaw';
import { statOf } from '../combat/stats';
import { triggerEffects } from '../combat/effect';
import { decideEscape, decideTargetDistance, decideTechnique, decideDefense, AI_DIFFICULTIES } from '../combat/ai';
import { runBenchmark } from '../combat/benchmark';
import { benchFighter, config, fighter } from './fixtures';
import { TEST_ARTS, TEST_ART_IDS, TEST_GUARD_SKILL, TEST_MOVEMENT_ART, TEST_SWORD_TECHNIQUE } from './testArts';

function cfg(seed = 1n, extra: Partial<CombatConfig> = {}): CombatConfig {
  return { ...config(seed), arts: TEST_ARTS, fighters: [fighter('a', { arts: TEST_ART_IDS }), fighter('b', { arts: TEST_ART_IDS })], ...extra };
}
/** 推进 n 个逻辑帧（跳过动画锁） */
function frames(s: ReturnType<typeof initCombat>, n: number) {
  const end = s.frame + n;
  while (s.frame < end && s.phase !== 'ended') step(s);
}
function ready(f: { breath: number; stance: number; stances: string[] }) {
  f.breath = RESOURCE_MAX; f.stance = RESOURCE_MAX; f.stances = ['chop', 'chop', 'stab'];
}

describe('摧破：施展条件与时间', () => {
  it('施展时间 220 / 施展速度 220% → 100 帧', () => {
    expect(calcCastTime(220, 220)).toBe(100);
    expect(calcCastTime(180, 100)).toBe(180);
  });
  it('双满 + 持式才可施展；施展中不可再施展', () => {
    const s = initCombat(cfg());
    const f = s.fighters[0];
    expect(canCastTechnique(f, TEST_SWORD_TECHNIQUE)).toMatchObject({ ok: false });
    ready(f as never);
    f.stances = ['chop', 'stab'];
    expect(canCastTechnique(f, TEST_SWORD_TECHNIQUE).reason).toBe('insufficientStances');
    f.stances = ['chop', 'wild', 'stab'];
    expect(canCastTechnique(f, TEST_SWORD_TECHNIQUE).ok).toBe(true);
    expect(startCast(s, f, TEST_SWORD_TECHNIQUE.id)).toBe(true);
    expect(f.stances).toEqual([]);
    expect(f.breath).toBe(15000);
    expect(canCastTechnique(f, TEST_SWORD_TECHNIQUE).reason).toBe('alreadyCasting');
  });
  it('bypassDualFull 特效解除双满限制', () => {
    const s = initCombat(cfg());
    const f = s.fighters[0];
    f.breath = 0; f.stance = 0; f.stances = ['chop', 'chop', 'stab'];
    triggerEffects(s, 0, 'onCombatStart', { extra: [{ id: 'x', trigger: 'onCombatStart', ops: [{ type: 'bypassDualFull', duration: 60 }] }] });
    expect(canCastTechnique(f, TEST_SWORD_TECHNIQUE).ok).toBe(true);
  });
  it('成数 → 程度：1-4 轻 / 5-9 重 / 10 致命', () => {
    expect([tenthsGrade(3), tenthsGrade(5), tenthsGrade(9), tenthsGrade(10)]).toEqual([1, 2, 2, 3]);
  });
});

describe('摧破：四段判定', () => {
  it('必中时三段 + 终结，共 10 成', () => {
    const s = initCombat(cfg(3n, { battleType: 'deathmatch' }));
    const [a, b] = s.fighters;
    a.stats.hitPower = a.stats.hitSpeed = a.stats.hitSkill = 100000;
    b.guard = 0;
    const r = resolveTechnique(s, a, TEST_SWORD_TECHNIQUE);
    expect(r.totalTenths).toBe(10);
    expect(r.stages.map(x => x.channel)).toEqual(['speed', 'skill', 'power', 'power']);
    expect(r.stages.at(-1)!.grade).toBe(3);
    expect(b.memory.artResults[TEST_SWORD_TECHNIQUE.id]).toEqual({ casts: 1, bestTenths: 10 });
    expect(s.calcs.filter(c => c.source === 'technique')).toHaveLength(4);
  });
  it('出手时不在距离段 → 0 成', () => {
    const s = initCombat(cfg(3n, { startDistance: 8 }));
    const [a, b] = s.fighters;
    expect(resolveArtRange(TEST_SWORD_TECHNIQUE, a)).toEqual([2, 6]);
    const r = resolveTechnique(s, a, TEST_SWORD_TECHNIQUE);
    expect(r.totalTenths).toBe(0);
    expect(b.totalOuter + b.totalInner).toBe(0);
  });
  it('功法伤害分支：(功法基伤 + 武器基伤) × 比例 × 调整 × 命中比例；护命 50%', () => {
    const one = { outer: 1000, inner: 1000 };
    expect(calcTechniqueDamage(1000, 150, 400, one, 1000, 1000, one, 1000, 1000, false)).toEqual({ outer: 690, inner: 460 });
    expect(calcTechniqueDamage(1000, 150, 400, one, 1000, 1000, one, 1000, 500, true)).toEqual({ outer: 172, inner: 115 });
  });
  it('step 中施展完成后出手并结算', () => {
    const s = initCombat(cfg(9n));
    const f = s.fighters[0];
    ready(f as never);
    s.fighters[1].weaponRangeMin = s.fighters[1].weaponRangeMax = 1;
    step(s, [{ type: 'castTechnique', actorId: 'a', skillId: TEST_SWORD_TECHNIQUE.id }]);
    const types: string[] = [];
    for (let i = 0; i < 400 && f.castPhase === 'casting'; i++) types.push(...step(s).map(e => e.type));
    expect(types).toContain('techniqueResolved');
  });
});

describe('护体绝技 / 反击 / 反震', () => {
  it('消耗 60% 提气架势各半；持续期间化解与护体提升，结束后移除', () => {
    expect(gaugeCost(600, 500)).toEqual({ breath: 9000, stance: 9000 });
    const s = initCombat(cfg());
    const f = s.fighters[0];
    f.breath = RESOURCE_MAX; f.stance = RESOURCE_MAX;
    const before = statOf(f, 'protection');
    expect(startCast(s, f, TEST_GUARD_SKILL.id)).toBe(true);
    s.fighters[1].weaponRangeMin = s.fighters[1].weaponRangeMax = 1;
    frames(s, 70);
    expect(f.guardSkillPhase).toBe('active');
    expect(statOf(f, 'protection')).toBe(Math.floor((before + 50) * 1.2));
    expect(statOf(f, 'dodgeDeflect')).toBe(200);
    frames(s, 300);
    expect(f.guardSkillPhase).toBe('off');
    expect(statOf(f, 'protection')).toBe(before);
  });
  it('反击条件：护体带反击 + 非音 + 距离段内', () => {
    const s = initCombat(cfg());
    const d = s.fighters[1];
    expect(checkCounterCondition(s, d, 'power', 'chop')).toBe(false);
    d.guardSkillPhase = 'active'; d.guardSkillId = TEST_GUARD_SKILL.id;
    expect(checkCounterCondition(s, d, 'speed', 'stab')).toBe(true);
    expect(checkCounterCondition(s, d, 'power', 'sound')).toBe(false);
    s.distance = 6;
    expect(checkCounterCondition(s, d, 'power', 'chop')).toBe(false);
  });
  it('化解后反击并中断追击', () => {
    const s = initCombat(cfg(4n));
    const [a, d] = s.fighters;
    a.stats.hitPower = a.stats.hitSpeed = a.stats.hitSkill = 1;
    a.weapons.forEach(w => { w.chaseCoef = 125; });
    d.guardSkillPhase = 'active'; d.guardSkillId = TEST_GUARD_SKILL.id; d.guardSkillRemain = 100;
    const r = resolveAttackRound(s, a);
    expect(r.countered).toBe(true);
    expect(r.hits).toBe(1);
  });
  it('守御已破 + 护体反震 → 攻方受伤', () => {
    const s = initCombat(cfg(4n, { battleType: 'deathmatch' }));
    const [a, d] = s.fighters;
    a.stats.hitPower = a.stats.hitSpeed = a.stats.hitSkill = 100000;
    d.guard = 0; d.guardBroken = true;
    d.guardSkillPhase = 'active'; d.guardSkillId = TEST_GUARD_SKILL.id; d.guardSkillRemain = 100;
    resolveAttackRound(s, a);
    expect(a.totalOuter).toBeGreaterThan(0);
  });
});

describe('点穴 / 破绽', () => {
  it('上限 10 层；减益每层 5%', () => {
    const s = initCombat(cfg());
    const f = s.fighters[0];
    expect(addSeal(f, 'rightArm', 12)).toBe(10);
    expect(statOf(f, 'attackSpeed')).toBe(50);
    addFlaw(f, 'waist', 4);
    expect(statOf(f, 'hitPower')).toBe(80);
    addSeal(f, 'head', 2);
    expect(statOf(f, 'castSpeed')).toBe(90);
  });
  it('战前旧伤：每 20% 1 层，内多点穴、外多破绽', () => {
    const s = initCombat(cfg());
    const f = s.fighters[0];
    applyPreExistingWounds(f, [
      { part: 'chest', outer: 100, inner: 350, grade: 1, frame: 0 },
      { part: 'leftLeg', outer: 900, inner: 0, grade: 1, frame: 0 },
      { part: 'spirit', outer: 900, inner: 0, grade: 1, frame: 0 },
    ]);
    expect(f.wounds.chest.acupoints).toBe(2);
    expect(f.wounds.leftLeg.weakness).toBe(3);
  });
});

describe('特效解释器 12 个操作', () => {
  it('触发器 + 条件 + 操作', () => {
    const s = initCombat(cfg(2n, { battleType: 'deathmatch' }));
    const [a, b] = s.fighters;
    a.wounds.chest.outer = 300;
    b.stances = ['chop', 'stab'];
    const fx: EffectSpec[] = [{
      id: 'all', trigger: 'onTechniqueResolved', when: [{ type: 'tenthsGte', value: 5 }, { type: 'distanceRange', min: 2, max: 9 }],
      ops: [
        { type: 'modStat', stat: 'hitPower', value: 50, duration: 10 },
        { type: 'addSeal', part: 'target', layers: 2 },
        { type: 'addFlaw', part: 'head', layers: 1 },
        { type: 'grantStance', stance: 'wild', count: 2 },
        { type: 'removeStance', target: 'enemy', count: 1 },
        { type: 'modProgress', bar: 'breath', delta: 5000 },
        { type: 'trueDamage', part: 'waist', amount: 100 },
        { type: 'modMultCap', stat: 'penetrationCap', value: 500, duration: 10 },
        { type: 'bypassDualFull', duration: 10 },
        { type: 'modDealDamage', outer: 100, inner: 0, duration: 10 },
        { type: 'heal', part: 'chest', amount: 100 },
        { type: 'addPoison', poisonType: 'fire', amount: 30 },
      ],
    }];
    a.breath = 0;
    triggerEffects(s, 0, 'onTechniqueResolved', { tenths: 4, part: 'leftArm', extra: fx });
    expect(statOf(a, 'hitPower')).toBe(100); // 条件不满足
    triggerEffects(s, 0, 'onTechniqueResolved', { tenths: 6, part: 'leftArm', extra: fx });
    expect(statOf(a, 'hitPower')).toBe(150);
    expect(b.wounds.leftArm.acupoints).toBe(2);
    expect(b.wounds.head.weakness).toBe(1);
    expect(a.stances).toEqual(['wild', 'wild']);
    expect(b.stances).toHaveLength(1);
    expect(a.breath).toBe(5000);
    expect(b.wounds.waist.inner).toBe(6);
    expect(a.statMods.some(m => m.stat === 'penetrationCap')).toBe(true);
    expect(a.statMods.some(m => m.stat === 'bypassDualFull')).toBe(true);
    expect(a.statMods.some(m => m.stat === 'dealOuterPermille')).toBe(true);
    expect(a.wounds.chest.outer).toBe(200);
    expect(b.poison.fire).toBe(30);
  });
  it('StatMod 到期移除；everyNFrames 周期触发', () => {
    const s = initCombat(cfg(2n, {
      fighters: [fighter('a', { effects: [{ id: 'tick', trigger: 'everyNFrames', interval: 10, ops: [{ type: 'modProgress', bar: 'move', delta: 1 }] }] }), fighter('b')],
    }));
    const a = s.fighters[0];
    a.statMods.push({ stat: 'hitPower', value: 10, remain: 3, source: 't' });
    for (let i = 0; i < 30; i++) step(s);
    expect(a.statMods.some(m => m.source === 't')).toBe(false);
  });
});

describe('身法', () => {
  it('耗移动力，赋予身法移动力（上限 6）与移速加成，每 decayFrames 衰减 1', () => {
    const s = initCombat(cfg());
    const f = s.fighters[0];
    f.movementPoints = 1;
    s.fighters[1].weaponRangeMin = s.fighters[1].weaponRangeMax = 1;
    expect(startCast(s, f, TEST_MOVEMENT_ART.id)).toBe(true);
    frames(s, 30);
    expect(f.bodyMovementPoints).toBe(3);
    expect(f.statMods.some(m => m.stat === 'moveSpeedPermille' && m.value === 500)).toBe(true);
    frames(s, 100);
    expect(f.bodyMovementPoints).toBe(2);
  });
});

describe('AI', () => {
  it('4 档难度参数', () => {
    expect(AI_DIFFICULTIES.map(d => d.thinkInterval)).toEqual([30, 20, 10, 6]);
    expect(AI_DIFFICULTIES[0]!.actions.has('cast')).toBe(false);
  });
  it('距离决策落在武器距离段内', () => {
    const s = initCombat(cfg(1n, { ai: [{ difficulty: 3 }, { difficulty: 3 }] }));
    const d = decideTargetDistance(s, 0);
    expect(d).toBeGreaterThanOrEqual(2);
    expect(d).toBeLessThanOrEqual(6);
  });
  it('施展决策：双满 + 式够 + 预测在距离段内', () => {
    const s = initCombat(cfg(1n, { ai: [{ difficulty: 3 }, { difficulty: 3 }] }));
    const f = s.fighters[0];
    expect(decideTechnique(s, 0)).toBeNull();
    ready(f as never);
    expect(decideTechnique(s, 0)).toBe(TEST_SWORD_TECHNIQUE.id);
  });
  it('防守反应：专注 ≥500 时对施展中的对手走位或开护体', () => {
    const s = initCombat(cfg(1n, { ai: [{ difficulty: 3 }, { difficulty: 3 }] }));
    const [me, enemy] = s.fighters;
    ready(enemy as never);
    startCast(s, enemy, TEST_SWORD_TECHNIQUE.id);
    expect(decideDefense(s, 0)).toBeNull();
    me.focus = 600;
    expect(decideDefense(s, 0)).not.toBeNull();
  });
  it('逃跑：死斗/最低难度禁用；伤势达阈值触发', () => {
    const s = initCombat(cfg(1n, { ai: [{ difficulty: 2 }, { difficulty: 0 }] }));
    s.fighters[0].totalOuter = 400; s.fighters[1].totalOuter = 400;
    expect(decideEscape(s, 0)).toBe(true); // 400/500 = 80% ≥ 40% + 50×0.2%
    expect(decideEscape(s, 1)).toBe(false);
    s.battleType = 'deathmatch';
    expect(decideEscape(s, 0)).toBe(false);
  });
  it('AI 对 AI 完整一场，确定性可复现', () => {
    const run = () => {
      const s = initCombat(cfg(21n, { ai: [{ difficulty: 3 }, { difficulty: 2 }] }));
      for (let i = 0; i < 20000 && s.phase !== 'ended'; i++) step(s);
      return [s.phase, s.frame, s.fighters[0].totalOuter, s.fighters[1].totalOuter];
    };
    const r = run();
    expect(r[0]).toBe('ended');
    expect(run()).toEqual(r);
  });
});

describe('AI 对 AI 批量模拟', () => {
  const base = { battleType: 'spar' as const, arts: TEST_ARTS, fighters: [benchFighter('a', TEST_ART_IDS), benchFighter('b', TEST_ART_IDS)] as [ReturnType<typeof benchFighter>, ReturnType<typeof benchFighter>] };
  const runs = process.env.BENCH ? 1000 : 200;
  it(`镜像对局 ${runs} 场：胜率接近 50%，平均 40-120 秒`, () => {
    const r = runBenchmark(base, [{ difficulty: 3 }, { difficulty: 3 }], runs);
    const tol = process.env.BENCH ? 0.03 : 0.08;
    expect(Math.abs(r.winRate - 0.5)).toBeLessThanOrEqual(tol);
    expect(r.avgSeconds).toBeGreaterThanOrEqual(40);
    expect(r.avgSeconds).toBeLessThanOrEqual(120);
  }, 120000);
  it(`最高难度对最低难度 ${runs / 2} 场：胜率 > 80%`, () => {
    const r = runBenchmark(base, [{ difficulty: 3 }, { difficulty: 0 }], runs / 2);
    expect(r.winRate).toBeGreaterThan(0.8);
  }, 120000);
});
