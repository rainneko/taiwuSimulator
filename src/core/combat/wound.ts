import { BODY_PARTS, DEFEAT_THRESHOLD, type BodyPart, type CombatState, type FighterState } from './types';

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 总伤势 = 七部位伤势之和，封顶 100%（M1 占位，WO2 按原版换算）
 */
export function recomputeTotals(f: FighterState): void {
  let inner = 0, outer = 0;
  for (const p of BODY_PARTS) { inner += f.wounds[p].inner; outer += f.wounds[p].outer; }
  f.totalInner = Math.min(100, round2(inner));
  f.totalOuter = Math.min(100, round2(outer));
}

export function addWound(state: CombatState, f: FighterState, part: BodyPart, innerPct: number, outerPct: number): void {
  const w = f.wounds[part];
  w.inner = Math.min(100, round2(w.inner + innerPct));
  w.outer = Math.min(100, round2(w.outer + outerPct));
  recomputeTotals(f);
  state.events.emit('wound', { actorId: f.id, part, inner: w.inner, outer: w.outer });
}

export function isDefeated(state: CombatState, f: FighterState): boolean {
  const t = DEFEAT_THRESHOLD[state.battleType] * 100;
  return f.totalInner >= t || f.totalOuter >= t;
}

export function checkEnd(state: CombatState): void {
  if (state.phase === 'ended') return;
  for (const f of state.fighters) {
    if (isDefeated(state, f)) {
      state.phase = 'ended';
      const winner = state.fighters.find(x => x.id !== f.id);
      state.events.emit('end', { winnerId: winner?.id ?? null, reason: 'defeat' });
      return;
    }
  }
}
