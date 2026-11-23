import type { CombatState, FighterState } from './types';
import { resolveAttackRound } from './hit';

export const WEAPON_SPEED_CLASS = { veryFast: 3000, fast: 4500, normal: 6000, slow: 7500, verySlow: 9000 } as const;
export const ATTACK_ANIM_LOCK = 30;

/** 攻击间隔（帧） = ceil((基础速度 + 重量×100) / floor(30 + 60×攻速% × (1 - 右臂点穴×5%))) */
export function getAttackInterval(baseSpeed: number, weaponWeight: number, attackSpeedPct: number, acupointsRightArm: number): number {
  const baseInterval = baseSpeed + weaponWeight * 100;
  const speed = Math.floor(30 + 60 * (attackSpeedPct / 100) * (1 - acupointsRightArm * 0.05));
  return Math.ceil(baseInterval / Math.max(1, speed));
}

export function isInWeaponRange(f: FighterState, distance: number): boolean {
  return distance >= f.weaponRangeMin - 1e-9 && distance <= f.weaponRangeMax + 1e-9;
}

export function recomputeAttackInterval(f: FighterState): void {
  const w = f.weapons.find(x => x.id === f.weaponId);
  if (!w) return;
  f.attackInterval = getAttackInterval(w.baseSpeed, w.weight, f.stats.attackSpeed, f.wounds.rightArm.acupoints);
}

/** 范围内累加攻击进度，满则出手；范围外暂停（不清零） */
export function tickAttack(state: CombatState, f: FighterState): void {
  if (!isInWeaponRange(f, state.distance)) {
    f.attackPhase = 'outOfRange';
    return;
  }
  f.attackPhase = 'charging';
  f.attackProgress++;
  if (f.attackProgress >= f.attackInterval) {
    f.attackProgress = 0;
    f.attackPhase = 'striking';
    state.animLock = ATTACK_ANIM_LOCK;
    resolveAttackRound(state, f, 1);
  }
}
