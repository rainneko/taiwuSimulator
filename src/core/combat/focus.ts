import type { BattleType, FighterState } from './types';
import { FOCUS_MAX } from './resource';

/** 专注倍率（千分比）：死斗 ×1，恶战 ×1.33，切磋/接招 ×2 */
export const FOCUS_MULTIPLIER: Record<BattleType, number> = {
  deathmatch: 1000, fierce: 1330, spar: 2000, accept: 2000,
};

/**
 * 专注增加（§5.11）：
 * - 守御损失：每损失 1% 守御 +5
 * - 受伤：每受到「战败条件×1%」的内/外伤 +5，不足则 +1
 * value 为对应的「百分点数」。
 */
export function focusGain(battleType: BattleType, value: number): number {
  return Math.max(1, Math.floor(value * 5 * FOCUS_MULTIPLIER[battleType] / 1000));
}

export function addFocusFrom(f: FighterState, battleType: BattleType, value: number): number {
  const before = f.focus;
  f.focus = Math.min(FOCUS_MAX, f.focus + focusGain(battleType, value));
  return f.focus - before;
}
