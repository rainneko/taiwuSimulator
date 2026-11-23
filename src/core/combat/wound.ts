import { BODY_PARTS, DEFEAT_THRESHOLD, SPECIAL_PARTS, type AnyPart, type BattleType, type CombatState, type FighterState, type Wound } from './types';
import { isBodyPart } from './hit';
import { triggerEffects } from './effect';

/**
 * 伤势单位：千分比（1000 = 100%）。战败阈值：切磋/接招 500，恶战 750，死斗 1000。
 */
export const WOUND_BASE: Record<AnyPart, number> = {
  chest: 60, waist: 60, head: 100,
  leftArm: 40, rightArm: 40, leftLeg: 40, rightLeg: 40,
  spirit: 40, poison: 40, whole: 80,
};
export const PART_WOUND_CAP = 1000;

export function defeatThreshold(bt: BattleType): number {
  return Math.round(DEFEAT_THRESHOLD[bt] * 1000);
}

/** 伤口 = 伤害 × 程度 × 部位基础值 / 1000 */
export function createWound(part: AnyPart, outerDamage: number, innerDamage: number, grade: 1 | 2 | 3, frame = 0): Wound {
  const base = WOUND_BASE[part];
  return {
    part, grade, frame,
    outer: Math.floor(outerDamage * grade * base / 1000),
    inner: Math.floor(innerDamage * grade * base / 1000),
  };
}

export function recomputeTotals(f: FighterState): void {
  let inner = 0, outer = 0;
  for (const p of BODY_PARTS) { inner += f.wounds[p].inner; outer += f.wounds[p].outer; }
  for (const p of SPECIAL_PARTS) { inner += f.specialWounds[p].inner; outer += f.specialWounds[p].outer; }
  f.totalInner = Math.min(PART_WOUND_CAP, inner);
  f.totalOuter = Math.min(PART_WOUND_CAP, outer);
}

/** 直接把伤势加到部位上（不经伤口基础值换算） */
export function addWound(state: CombatState, f: FighterState, part: AnyPart, inner: number, outer: number): void {
  const w = isBodyPart(part) ? f.wounds[part] : f.specialWounds[part];
  w.inner = Math.min(PART_WOUND_CAP, w.inner + Math.floor(inner));
  w.outer = Math.min(PART_WOUND_CAP, w.outer + Math.floor(outer));
  recomputeTotals(f);
  if (isBodyPart(part)) state.events.emit('wound', { actorId: f.id, part, inner: w.inner, outer: w.outer });
}

/** 累计伤口并返回是否达到战败阈值 */
export function applyWound(state: CombatState, f: FighterState, wound: Wound): { defeated: boolean } {
  wound.frame = state.frame;
  f.woundLog.push(wound);
  addWound(state, f, wound.part, wound.inner, wound.outer);
  return { defeated: isDefeated(state, f) };
}

export function isDefeated(state: CombatState, f: FighterState): boolean {
  const t = defeatThreshold(state.battleType);
  return f.totalInner >= t || f.totalOuter >= t;
}

export function checkEnd(state: CombatState): void {
  if (state.phase === 'ended') return;
  for (let i = 0; i < 2; i++) {
    const f = state.fighters[i]!;
    if (isDefeated(state, f)) {
      triggerEffects(state, i as 0 | 1, 'onDefeat', {});
      state.phase = 'ended';
      const winner = state.fighters[1 - i]!;
      state.events.emit('end', { winnerId: winner.id, reason: 'defeat' });
      return;
    }
  }
}
