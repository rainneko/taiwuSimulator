import type { CombatState, FighterState } from './types';

/** 守御距离系数（千分比）：≤3.0 → 100%，3.0-5.0 → 65%，>5.0 → 35% */
export function guardDistanceCoef(distance: number): number {
  const d10 = Math.round(distance * 10);
  return d10 > 50 ? 350 : d10 > 30 ? 650 : 1000;
}

/**
 * 守御结算（§5.9 步骤 5a）。心神/毒发无视守御；守御已破则直接透过。
 * 对守御伤害 = 伤势 × 距离系数。守御归零 → 尽破（护体/御气 -40%，见 stats.ts）。
 *
 * 注：工单黄金表把对守御伤害写成「×1000」，但同表又要求 3000 守御吃 100 伤势后「未破」，
 * 两者矛盾；这里采用与「未破」一致的口径（不乘 1000）。
 */
export function resolveGuard(
  state: CombatState, defender: FighterState, damage: number, distance: number, isSpirit = false, isPoison = false,
): { absorbed: boolean; guardDamage: number; brokeNow: boolean } {
  if (isSpirit || isPoison || defender.guardBroken) return { absorbed: false, guardDamage: 0, brokeNow: false };
  if (defender.guard <= 0) {
    defender.guard = 0;
    defender.guardBroken = true;
    state.events.emit('guardBroken', { actorId: defender.id });
    return { absorbed: false, guardDamage: 0, brokeNow: true };
  }
  const guardDamage = Math.floor(damage * guardDistanceCoef(distance) / 1000);
  defender.guard -= guardDamage;
  state.events.emit('resourceChange', { actorId: defender.id, type: 'guard', value: Math.max(0, defender.guard) });
  if (defender.guard <= 0) {
    defender.guard = 0;
    defender.guardBroken = true;
    state.events.emit('guardBroken', { actorId: defender.id });
    return { absorbed: false, guardDamage, brokeNow: true };
  }
  return { absorbed: true, guardDamage, brokeNow: false };
}
