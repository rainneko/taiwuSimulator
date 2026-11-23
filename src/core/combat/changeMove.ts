import type { PCG32 } from '../rng';
import { BODY_PARTS, type BodyPart, type FighterState } from './types';
import { clamp } from './util';
import { RESOURCE_MAX } from './resource';

/** 变招 PRD：meter += 系数；roll∈[0,800) < meter 则触发并清零 */
export function checkChangeMove(
  rng: PCG32, changeMeter: number, changeCoef: number, stanceCanChange: boolean,
): { triggered: boolean; newMeter: number; roll: number } {
  if (!stanceCanChange) return { triggered: false, newMeter: changeMeter, roll: -1 };
  const newMeter = changeMeter + changeCoef;
  const roll = rng.randInt(800);
  if (roll < newMeter) return { triggered: true, newMeter: 0, roll };
  return { triggered: false, newMeter, roll };
}

/** 部位基础成功率（千分比） */
export const CHANGE_MOVE_BASE: Record<BodyPart, number> = {
  chest: 750, waist: 750, head: 250, leftArm: 500, rightArm: 500, leftLeg: 500, rightLeg: 500,
};

/** 变招部位 → 获得的式 */
export const CHANGE_MOVE_STANCE: Record<BodyPart, 'chop' | 'crash' | 'dot' | 'grab' | 'sweep'> = {
  chest: 'chop', waist: 'crash', head: 'dot', leftArm: 'grab', rightArm: 'grab', leftLeg: 'sweep', rightLeg: 'sweep',
};

/** 成功率 = 基础 ± 20% 随机浮动 */
export function resolveChangeMove(rng: PCG32, part: BodyPart): { success: boolean; part: BodyPart; rate: number } {
  const fluctuation = rng.range(-200, 200);
  const rate = clamp(CHANGE_MOVE_BASE[part] + fluctuation, 0, 1000);
  const roll = rng.randInt(1000);
  return { success: roll < rate, part, rate };
}

/** 变招成功的附带效果 */
export function applyChangeMoveEffect(rng: PCG32, part: BodyPart, d: FighterState): void {
  switch (part) {
    case 'chest': d.breath = clamp(Math.floor(d.breath * 0.8), 0, RESOURCE_MAX); break;
    case 'waist': d.stance = clamp(Math.floor(d.stance * 0.8), 0, RESOURCE_MAX); break;
    case 'head':
      for (let i = 0; i < 3 && d.stances.length > 0; i++) d.stances.splice(rng.randInt(d.stances.length), 1);
      break;
    case 'leftArm': case 'rightArm': {
      // 剩余攻击时间 ×1.5
      const remain = Math.max(0, d.attackInterval - d.attackProgress);
      d.attackProgress = Math.max(0, d.attackInterval - Math.floor(remain * 1.5));
      break;
    }
    case 'leftLeg': case 'rightLeg':
      d.moveProgress = Math.floor(d.moveProgress * 0.8);
      break;
  }
}

/** 自动变招部位：有破绽 → 有点穴 → 随机 */
export function autoChangeMovePart(rng: PCG32, enemy: FighterState): BodyPart {
  for (const p of BODY_PARTS) if (enemy.wounds[p].weakness > 0) return p;
  for (const p of BODY_PARTS) if (enemy.wounds[p].acupoints > 0) return p;
  return BODY_PARTS[rng.randInt(BODY_PARTS.length)]!;
}
