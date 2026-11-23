import { BODY_PARTS, type BodyPart, type CombatState, type FighterState, type HitChannel } from './types';
import { absorbWithGuard } from './resource';
import { addWound } from './wound';
import { clamp } from './util';

/** 七部位受击权重：胸背/腰腹/头颈/左臂/右臂/左腿/右腿（M1 占位，WO2 按 wiki 校准） */
export const PART_WEIGHTS: Record<BodyPart, number> = {
  chest: 20, waist: 20, head: 10, leftArm: 13, rightArm: 13, leftLeg: 12, rightLeg: 12,
};

export function pickBodyPart(state: CombatState): BodyPart {
  const idx = state.rng.weightedPick(BODY_PARTS.map(p => PART_WEIGHTS[p]));
  return BODY_PARTS[idx] ?? 'chest';
}

/** 破甲 vs 坚韧：倍率 = clamp((100 + 破甲 - 坚韧)/100, 0.1, 2) */
export function armorMultiplier(attacker: FighterState, defender: FighterState): number {
  return clamp((100 + attacker.stats.armorPenetration - defender.stats.armorToughness) / 100, 0.1, 2);
}

/** 原始伤害 = 武器威力 × 该路命中/100 × 威力倍率 */
export function computeRawDamage(attacker: FighterState, channel: HitChannel, powerMult = 1): number {
  const hit = channel === 'power' ? attacker.stats.hitPower : channel === 'speed' ? attacker.stats.hitSpeed : attacker.stats.hitSkill;
  return Math.floor(attacker.weaponPower * (hit / 100) * powerMult);
}

/** 拆分内外伤：内伤占 innerDamageRatio%，再分别乘造成内/外伤% */
export function splitInnerOuter(attacker: FighterState, damage: number): { inner: number; outer: number } {
  const ratio = clamp(attacker.stats.innerDamageRatio, 0, 100) / 100;
  const inner = Math.floor(damage * ratio * attacker.stats.dealInner / 100);
  const outer = Math.floor(damage * (1 - ratio) * attacker.stats.dealOuter / 100);
  return { inner, outer };
}

/** 伤害点数 → 部位伤势百分比（每 100 点 = 1%） */
export const DAMAGE_PER_PERCENT = 100;

export function severityOf(pct: number): 1 | 2 | 3 {
  return pct < 5 ? 1 : pct < 15 ? 2 : 3;
}

/** 完整结算一次命中：守御吸收 → 甲胄 → 内外伤 → 部位伤口 */
export function applyHitDamage(
  state: CombatState, attacker: FighterState, defender: FighterState, channel: HitChannel, powerMult = 1,
): { part: BodyPart; damage: number; inner: number; outer: number } {
  const raw = computeRawDamage(attacker, channel, powerMult);
  const afterArmor = Math.floor(raw * armorMultiplier(attacker, defender));
  const afterGuard = absorbWithGuard(state, defender, afterArmor);
  const { inner, outer } = splitInnerOuter(attacker, afterGuard);
  const part = pickBodyPart(state);
  const innerPct = inner / DAMAGE_PER_PERCENT;
  const outerPct = outer / DAMAGE_PER_PERCENT;
  addWound(state, defender, part, innerPct, outerPct);
  return { part, damage: afterGuard, inner: innerPct, outer: outerPct };
}
