import type { PCG32 } from '../rng';

export const MAX_CHASES = 5;
export const COMBO_HITS = 6;
export const COMBO_POWER = 3000;

/** 连环奇击优势：内息差 ≥100 → min(250, 100 + 差/20)，否则 40；触发率 = 优势 ‰ */
export function comboAdvantage(attackerBreath: number, defenderBreath: number): number {
  const diff = attackerBreath - defenderBreath;
  return diff >= 100 ? Math.min(250, 100 + Math.floor(diff / 20)) : 40;
}

export function checkComboStrike(rng: PCG32, attackerBreath: number, defenderBreath: number): { triggered: boolean; advantage: number } {
  const advantage = comboAdvantage(attackerBreath, defenderBreath);
  return { triggered: rng.randInt(1000) < advantage, advantage };
}

/** 追击概率（千分比）= 系数 × (200 - 10n - 5n²) / 10；系数 ≥125 必出；n≥5 禁止 */
export function chaseChance(chaseCoef: number, chasesAlready: number): number {
  if (chasesAlready >= MAX_CHASES) return 0;
  if (chaseCoef >= 125) return 1000;
  const n = chasesAlready;
  return Math.max(0, Math.min(1000, Math.floor(chaseCoef * (200 - 10 * n - 5 * n * n) / 10)));
}

export function checkChase(rng: PCG32, chaseCoef: number, chasesAlready: number): boolean {
  const p = chaseChance(chaseCoef, chasesAlready);
  if (p <= 0) return false;
  if (p >= 1000) return true;
  return rng.randInt(1000) < p;
}
