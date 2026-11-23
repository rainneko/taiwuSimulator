import type { CombatState, FighterState } from './types';

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 保留 0.1 精度，消除浮点噪声 */
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function getOpponent(state: CombatState, f: FighterState): FighterState {
  return state.fighters[0] === f ? state.fighters[1] : state.fighters[0];
}

export function findFighter(state: CombatState, id: string): FighterState | undefined {
  return state.fighters.find(f => f.id === id);
}
