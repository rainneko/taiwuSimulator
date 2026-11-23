import type { CombatState, FighterState } from './types';
import { clamp, round1 } from './util';

export const DISTANCE_MIN = 2.0;
export const DISTANCE_MAX = 9.0;
export const DISTANCE_PRECISION = 0.1;
export const MOVE_PROGRESS_MAX = 15000;
export const MOVE_POINT_INTERVAL = 150;
export const MOVE_POINT_MAX = 3;
export const BODY_MOVE_POINT_MAX = 6;
export const BODY_MOVE_DECAY_INTERVAL = 100;

/** 调整目标距离（±0.1 / ±0.5），夹在 [2.0, 9.0] */
export function setTargetDistance(f: FighterState, delta: number): void {
  f.targetDistance = round1(clamp(f.targetDistance + delta, DISTANCE_MIN, DISTANCE_MAX));
}

/** 移动效率：有移动力 100%；无移动力时速度与距离各 50%（总效率 25%） */
export function getMoveEfficiency(f: FighterState): { speed: number; dist: number } {
  const hasPoints = f.movementPoints > 0 || f.bodyMovementPoints > 0;
  return hasPoints ? { speed: 1, dist: 1 } : { speed: 0.5, dist: 0.5 };
}

export function tickMovement(state: CombatState, f: FighterState): void {
  const targetDist = f.targetDistance;
  const currentDist = state.distance;
  if (Math.abs(targetDist - currentDist) < 0.001) return;

  const eff = getMoveEfficiency(f);
  const guardPenalty = f.guardSkillPhase === 'active' ? 0.5 : 1.0;
  const distPenalty = 1 - f.wounds.leftLeg.weakness * 0.05;
  const speedPenalty = 1 - f.wounds.rightLeg.acupoints * 0.05;

  const speed = f.moveSpeed * eff.speed * guardPenalty * speedPenalty;
  f.moveProgress += Math.floor(speed * 100);

  if (f.moveProgress >= MOVE_PROGRESS_MAX) {
    f.moveProgress -= MOVE_PROGRESS_MAX;

    const stepDist = Math.max(DISTANCE_PRECISION, round1(f.moveDistance * eff.dist * guardPenalty * distPenalty));
    const direction = targetDist > currentDist ? 1 : -1;
    const actual = Math.min(stepDist, Math.abs(targetDist - currentDist));
    const oldDist = state.distance;
    state.distance = round1(clamp(currentDist + direction * actual, DISTANCE_MIN, DISTANCE_MAX));

    if (f.bodyMovementPoints > 0) f.bodyMovementPoints--;
    else if (f.movementPoints > 0) f.movementPoints--;

    state.events.emit('moveStep', { actorId: f.id, from: oldDist, to: state.distance });
  }
}

/** 身法获得移动力（施展身法类功法时调用），上限 6 */
export function addBodyMovementPoints(f: FighterState, n: number): void {
  if (f.bodyMovementPoints === 0) f.bodyMovementDecay = 0;
  f.bodyMovementPoints = clamp(f.bodyMovementPoints + n, 0, BODY_MOVE_POINT_MAX);
}

export function tickMobility(f: FighterState): void {
  if (f.bodyMovementPoints > 0) {
    f.bodyMovementDecay++;
    if (f.bodyMovementDecay >= BODY_MOVE_DECAY_INTERVAL) {
      f.bodyMovementDecay -= BODY_MOVE_DECAY_INTERVAL;
      f.bodyMovementPoints = Math.max(0, f.bodyMovementPoints - 1);
    }
  } else {
    f.movementPointTimer++;
    if (f.movementPointTimer >= MOVE_POINT_INTERVAL) {
      f.movementPointTimer -= MOVE_POINT_INTERVAL;
      f.movementPoints = Math.min(MOVE_POINT_MAX, f.movementPoints + 1);
    }
  }
}
