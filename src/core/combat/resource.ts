import type { BattleType, CombatState, FighterState } from './types';

export const RESOURCE_MAX = 30000;
export const RESOURCE_RECOVERY_BASE = 100;
export const GUARD_CAP = 5000;
export const FOCUS_MAX = 1000;

/** 先回提气，满了再回架势（施展中/护体中不回复，由调用方判断） */
export function tickBreathStance(f: FighterState): void {
  const speed = getBreathStanceSpeed(f);
  if (f.breath < RESOURCE_MAX) {
    f.breath = Math.min(RESOURCE_MAX, f.breath + speed);
  } else if (f.stance < RESOURCE_MAX) {
    f.stance = Math.min(RESOURCE_MAX, f.stance + speed);
  }
}

export function getBreathStanceSpeed(f: FighterState): number {
  const focusBonus = 1 + Math.min(1, f.focus / FOCUS_MAX);
  const breathPenalty = 1 - f.wounds.chest.acupoints * 0.05;
  const stancePenalty = 1 - f.wounds.waist.acupoints * 0.05;
  const penalty = (breathPenalty + stancePenalty) / 2; // WO2 细化为分别作用
  return Math.floor(RESOURCE_RECOVERY_BASE * f.breathStanceSpeed * focusBonus * penalty);
}

/** 提气、架势双满 */
export function isDualFull(f: FighterState): boolean {
  return f.breath >= RESOURCE_MAX && f.stance >= RESOURCE_MAX;
}

/** 守御上限 = [(护体+御气)/2 + 30] × 守御效率%，上限 5000；开场 50% */
export function computeGuardMax(f: FighterState): number {
  const raw = Math.floor((f.stats.protection + f.stats.qiControl) / 2 + 30) * (f.stats.guardEfficiency / 100);
  return Math.min(GUARD_CAP, Math.floor(raw));
}

export function initGuard(f: FighterState): void {
  f.guardMax = computeGuardMax(f);
  f.guard = Math.floor(f.guardMax * 0.5);
}

/** 守御（白条）叠加，夹在 [0, guardMax] */
export function addGuard(f: FighterState, amount: number): void {
  f.guard = Math.max(0, Math.min(f.guardMax, f.guard + Math.floor(amount)));
}

/** 用守御吸收伤害，返回穿透守御后的剩余伤害；守御归零时 emit guardBroken */
export function absorbWithGuard(state: CombatState, f: FighterState, damage: number): number {
  if (f.guard <= 0 || damage <= 0) return damage;
  const absorbed = Math.min(f.guard, damage);
  f.guard -= absorbed;
  state.events.emit('resourceChange', { actorId: f.id, type: 'guard', value: f.guard });
  if (f.guard === 0) state.events.emit('guardBroken', { actorId: f.id });
  return damage - absorbed;
}

/** 专注倍率：死斗×1，恶战×1.33，其它×2 */
export function focusMultiplier(battleType: BattleType): number {
  return battleType === 'deathmatch' ? 1 : battleType === 'fierce' ? 1.33 : 2;
}

export function addFocus(f: FighterState, amount: number, battleType: BattleType): void {
  f.focus = Math.max(0, Math.min(FOCUS_MAX, f.focus + Math.floor(amount * focusMultiplier(battleType))));
}

export const FOCUS_TICK_INTERVAL = 60;

/** 每 60 帧在攻击范围内自然 +1 专注（占位规则，WO2 校准） */
export function tickFocus(state: CombatState, f: FighterState): void {
  if (state.frame % FOCUS_TICK_INTERVAL !== 0) return;
  if (f.attackPhase === 'outOfRange') return;
  addFocus(f, 1, state.battleType);
}
