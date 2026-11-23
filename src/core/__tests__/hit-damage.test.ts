import { describe, it, expect } from 'vitest';
import { initCombat } from '../combat/CombatSim';
import { hitChance, resolveAttackRound } from '../combat/hit';
import { splitInnerOuter, armorMultiplier, computeRawDamage, severityOf, applyHitDamage } from '../combat/damage';
import { BODY_PARTS } from '../combat/types';
import { checkEnd } from '../combat/wound';
import { config } from './fixtures';

describe('命中/化解', () => {
  it('命中=化解 → 50%，夹在 [5,95]', () => {
    const s = initCombat(config());
    const [a, b] = s.fighters;
    expect(hitChance(a, b, 'power')).toBe(50);
    a.stats.hitSpeed = 10000;
    expect(hitChance(a, b, 'speed')).toBe(95);
    a.stats.hitSkill = 0;
    expect(hitChance(a, b, 'skill')).toBe(5);
  });
  it('各路对应：力道↔卸力，迅疾↔闪避，精妙↔拆招', () => {
    const s = initCombat(config());
    const [a, b] = s.fighters;
    b.stats.dodgeDeflect = 300;
    expect(hitChance(a, b, 'power')).toBe(25);
    expect(hitChance(a, b, 'speed')).toBe(50);
  });
  it('必中时命中者获得式与专注', () => {
    const s = initCombat(config());
    const [a, b] = s.fighters;
    a.stats.hitPower = a.stats.hitSpeed = a.stats.hitSkill = 1e6;
    b.guard = 0;
    // 95% 封顶，多试几次至少命中一次
    let hits = 0;
    for (let i = 0; i < 10; i++) if (resolveAttackRound(s, a, 1)) hits++;
    expect(hits).toBeGreaterThan(0);
    expect(a.stances.length).toBe(Math.min(hits, 9));
    expect(a.focus).toBeGreaterThan(0);
  });
});

describe('伤害', () => {
  it('内外伤按比例拆分', () => {
    const s = initCombat(config());
    const a = s.fighters[0];
    a.stats.innerDamageRatio = 30;
    expect(splitInnerOuter(a, 1000)).toEqual({ inner: 300, outer: 700 });
    a.stats.dealInner = 200;
    expect(splitInnerOuter(a, 1000).inner).toBe(600);
  });
  it('破甲/坚韧倍率', () => {
    const s = initCombat(config());
    const [a, b] = s.fighters;
    expect(armorMultiplier(a, b)).toBe(1);
    b.stats.armorToughness = 50;
    expect(armorMultiplier(a, b)).toBe(0.5);
    b.stats.armorToughness = 500;
    expect(armorMultiplier(a, b)).toBe(0.1);
  });
  it('原始伤害 = 威力 × 命中/100 × 倍率', () => {
    const s = initCombat(config());
    const a = s.fighters[0];
    a.stats.hitPower = 150;
    expect(computeRawDamage(a, 'power', 2)).toBe(3000);
  });
  it('命中落到七部位之一并累计总伤', () => {
    const s = initCombat(config());
    const [a, b] = s.fighters;
    b.guard = 0;
    const r = applyHitDamage(s, a, b, 'power');
    expect(BODY_PARTS).toContain(r.part);
    expect(b.wounds[r.part].inner).toBe(5);
    expect(b.wounds[r.part].outer).toBe(5);
    expect(b.totalInner).toBe(5);
    expect(severityOf(10)).toBe(2);
  });
  it('伤势达到战斗类型阈值判负', () => {
    const s = initCombat(config(1n, { battleType: 'fierce' }));
    const b = s.fighters[1];
    b.totalOuter = 74; checkEnd(s);
    expect(s.phase).toBe('running');
    b.totalOuter = 75; checkEnd(s);
    expect(s.phase).toBe('ended');
  });
});
