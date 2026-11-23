import type { BodyPart, CombatState, EffectCondition, EffectOp, EffectSpec, EffectTrigger, FighterState } from './types';
import { addFlaw, addSeal } from './sealFlaw';
import { gainStance } from './stance';
import { pushMod } from './stats';
import { applyDirectDamage } from './damage';
import { recomputeTotals } from './wound';
import { RESOURCE_MAX } from './resource';
import { clamp } from './util';

/**
 * 功法特效解释器 v1（§5.12）：触发器 → 条件 → 操作 三层结构。
 * 来源：fighter.passiveEffects（常驻）+ ctx.extra（如当次施展功法自带的特效）。
 */
export type EffectContext = { part?: BodyPart | string; tenths?: number; extra?: readonly EffectSpec[] };

export function triggerEffects(state: CombatState, side: 0 | 1, trigger: EffectTrigger, ctx: EffectContext): void {
  const f = state.fighters[side];
  const specs = [...f.passiveEffects, ...(ctx.extra ?? [])];
  for (const spec of specs) {
    if (spec.trigger !== trigger) continue;
    if (trigger === 'everyNFrames' && state.frame % Math.max(1, spec.interval ?? 60) !== 0) continue;
    if (spec.when && !spec.when.every(c => evalCondition(c, state, side, ctx))) continue;
    for (const op of spec.ops) executeOp(state, side, op, ctx);
  }
}

/** 内息紊乱分档：M1 尚无内息紊乱系统，恒为 0 */
export function breathDisorderLevel(_f: FighterState): number { return 0; }

export function evalCondition(c: EffectCondition, s: CombatState, side: 0 | 1, ctx: EffectContext): boolean {
  const f = s.fighters[side];
  switch (c.type) {
    case 'distanceRange': return s.distance >= c.min && s.distance <= c.max;
    case 'partHasSeal': return s.fighters[1 - side]!.wounds[c.part].acupoints > 0;
    case 'partHasFlaw': return s.fighters[1 - side]!.wounds[c.part].weakness > 0;
    case 'tenthsGte': return (ctx.tenths ?? 0) >= c.value;
    case 'stanceCountGte': return f.stances.length >= c.value;
    case 'breathDisorder': return breathDisorderLevel(f) >= c.level;
    case 'guardBroken': return f.guardBroken;
    case 'healthBelow': return f.totalOuter >= c.threshold || f.totalInner >= c.threshold;
  }
}

function resolvePart(p: BodyPart | 'target', ctx: EffectContext): BodyPart | null {
  if (p !== 'target') return p;
  const t = ctx.part;
  return typeof t === 'string' && ['chest', 'waist', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'].includes(t) ? t as BodyPart : null;
}

export function executeOp(s: CombatState, side: 0 | 1, op: EffectOp, ctx: EffectContext): void {
  const f = s.fighters[side];
  const enemy = s.fighters[1 - side]!;
  switch (op.type) {
    case 'modStat': pushMod(f, op.stat, op.value, op.duration); break;
    case 'addSeal': { const p = resolvePart(op.part, ctx); if (p) addSeal(enemy, p, op.layers); break; }
    case 'addFlaw': { const p = resolvePart(op.part, ctx); if (p) addFlaw(enemy, p, op.layers); break; }
    case 'grantStance': for (let i = 0; i < op.count; i++) gainStance(s, f, op.stance); break;
    case 'removeStance': {
      const t = op.target === 'self' ? f : enemy;
      for (let i = 0; i < op.count && t.stances.length > 0; i++) t.stances.splice(s.rng.randInt(t.stances.length), 1);
      break;
    }
    case 'modProgress':
      switch (op.bar) {
        case 'breath': f.breath = clamp(f.breath + op.delta, 0, RESOURCE_MAX); break;
        case 'posture': f.stance = clamp(f.stance + op.delta, 0, RESOURCE_MAX); break;
        case 'attack': f.attackProgress = Math.max(0, f.attackProgress + op.delta); break;
        case 'move': f.moveProgress = Math.max(0, f.moveProgress + op.delta); break;
      }
      break;
    case 'trueDamage': applyDirectDamage(s, enemy, { outer: 0, inner: op.amount }, op.part); break;
    case 'modMultCap': pushMod(f, op.stat, op.value, op.duration); break;
    case 'bypassDualFull': pushMod(f, 'bypassDualFull', 1, op.duration); break;
    case 'modDealDamage':
      pushMod(f, 'dealOuterPermille', op.outer, op.duration);
      pushMod(f, 'dealInnerPermille', op.inner, op.duration);
      break;
    case 'heal': {
      const w = f.wounds[op.part];
      w.outer = Math.max(0, w.outer - op.amount);
      w.inner = Math.max(0, w.inner - op.amount);
      recomputeTotals(f);
      break;
    }
    case 'addPoison': enemy.poison[op.poisonType] = (enemy.poison[op.poisonType] ?? 0) + op.amount; break;
  }
}
