import type { PCG32 } from '../rng';
import type { AnyPart, BodyPart, FighterState, HitChannel, StanceType } from './types';
import { AVOID_STAT, HIT_STAT, statOf } from './stats';
import { getCombatWeapon } from './weapon';
import { clamp } from './util';

/**
 * 式 → 命中通道（§5.8）。力道=掷劈崩；迅疾=弹刺点缠机毒；精妙=御撩拿扫咒药。
 * 「音」走内息，原版无专门化解通道，按卸力（力道通道）处理。
 */
export const STANCE_CHANNEL: Record<StanceType, HitChannel> = {
  throw: 'power', chop: 'power', crash: 'power',
  flick: 'speed', stab: 'speed', dot: 'speed', wrap: 'speed', trick: 'speed', venom: 'speed',
  ward: 'skill', lift: 'skill', grab: 'skill', sweep: 'skill', curse: 'skill', medicine: 'skill',
  sound: 'power',
  none: 'power', wild: 'power', kill: 'power',
};

/** 音/咒/药/毒 不可变招 */
export const STANCE_CAN_CHANGE: Record<StanceType, boolean> = {
  throw: true, chop: true, crash: true, flick: true, stab: true, dot: true, wrap: true, trick: true,
  ward: true, lift: true, grab: true, sweep: true,
  sound: false, curse: false, medicine: false, venom: false,
  none: true, wild: true, kill: true,
};

type PartWeights = Partial<Record<AnyPart, number>>;

/** 式 → 部位权重表 */
export const STANCE_PART_WEIGHTS: Record<StanceType, PartWeights> = {
  throw: { chest: 65, waist: 25, head: 1, leftArm: 5, rightArm: 5, leftLeg: 5, rightLeg: 5 },
  chop: { chest: 70, waist: 15, head: 1, leftArm: 10, rightArm: 10, leftLeg: 5, rightLeg: 5 },
  crash: { chest: 55, waist: 35, head: 1, leftArm: 5, rightArm: 5, leftLeg: 5, rightLeg: 5 },
  flick: { chest: 45, waist: 35, head: 1, leftArm: 10, rightArm: 10, leftLeg: 10, rightLeg: 10 },
  stab: { chest: 40, waist: 30, head: 1, leftArm: 20, rightArm: 20, leftLeg: 10, rightLeg: 10 },
  dot: { chest: 40, waist: 30, head: 1, leftArm: 15, rightArm: 15, leftLeg: 15, rightLeg: 15 },
  wrap: { chest: 25, waist: 15, head: 1, leftArm: 30, rightArm: 30, leftLeg: 30, rightLeg: 30 },
  trick: { chest: 50, waist: 30, head: 1, leftArm: 10, rightArm: 10, leftLeg: 10, rightLeg: 10 },
  ward: { chest: 30, waist: 20, head: 1, leftArm: 30, rightArm: 30, leftLeg: 20, rightLeg: 20 },
  lift: { chest: 25, waist: 25, head: 1, leftArm: 25, rightArm: 25, leftLeg: 25, rightLeg: 25 },
  grab: { chest: 25, waist: 20, head: 1, leftArm: 35, rightArm: 35, leftLeg: 20, rightLeg: 20 },
  sweep: { chest: 25, waist: 15, head: 1, leftArm: 30, rightArm: 30, leftLeg: 30, rightLeg: 30 },
  sound: { spirit: 100 }, curse: { spirit: 100 },
  medicine: { poison: 100 }, venom: { poison: 100 },
  none: { chest: 100 }, wild: { chest: 100 }, kill: { chest: 100 },
};

export interface HitResult { hit: boolean; severity: 1 | 2; chance: number; roll: number }

/** 命中概率（千分比）= clamp(500 × (命中+攻方福缘)/(化解+守方福缘), 50, 1000) */
export function hitChancePermille(atkHit: number, defAvoid: number, atkFortune: number, defFortune: number): number {
  const atkTotal = atkHit + atkFortune;
  const defTotal = defAvoid + defFortune;
  return clamp(Math.floor(500 * atkTotal / Math.max(1, defTotal)), 50, 1000);
}

/** 命中判定：命中 ≥ 化解×2 → 重伤(2)，否则轻伤(1) */
export function hitCheck(
  rng: PCG32, atkHit: number, defAvoid: number, atkFortune: number, defFortune: number,
): HitResult {
  const chance = hitChancePermille(atkHit, defAvoid, atkFortune, defFortune);
  const roll = rng.randInt(1000);
  return { hit: roll < chance, severity: atkHit >= defAvoid * 2 ? 2 : 1, chance, roll };
}

export function getHitValue(f: FighterState, ch: HitChannel): number {
  return statOf(f, HIT_STAT[ch]) + getCombatWeapon(f).hit[ch];
}

export function getDodgeValue(f: FighterState, ch: HitChannel): number {
  return statOf(f, AVOID_STAT[ch]);
}

export function pickBodyPart(rng: PCG32, weights: PartWeights): AnyPart {
  const entries = Object.entries(weights) as [AnyPart, number][];
  const idx = rng.weightedPick(entries.map(e => e[1]));
  return entries[idx]?.[0] ?? 'chest';
}

export function isBodyPart(p: AnyPart): p is BodyPart {
  return p !== 'spirit' && p !== 'poison' && p !== 'whole';
}
