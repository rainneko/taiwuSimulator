import type { BodyPart, FighterState, Wound } from './types';
import { isBodyPart } from './hit';

export const SEAL_FLAW_CAP = 10;

/** 点穴（减益见 stats.ts SEAL_DEBUFF，每层 -5%；受该部位内伤 +10%/层） */
export function addSeal(f: FighterState, part: BodyPart, layers: number): number {
  const w = f.wounds[part];
  const before = w.acupoints;
  w.acupoints = Math.max(0, Math.min(SEAL_FLAW_CAP, before + layers));
  return w.acupoints - before;
}

/** 破绽（减益见 stats.ts FLAW_DEBUFF，每层 -5%；受该部位外伤 +10%/层） */
export function addFlaw(f: FighterState, part: BodyPart, layers: number): number {
  const w = f.wounds[part];
  const before = w.weakness;
  w.weakness = Math.max(0, Math.min(SEAL_FLAW_CAP, before + layers));
  return w.weakness - before;
}

/** 战前旧伤：每 20% 伤势带 1 层（最多 3）；内伤多 → 点穴，外伤多 → 破绽 */
export function applyPreExistingWounds(f: FighterState, wounds: readonly Wound[]): void {
  for (const w of wounds) {
    if (!isBodyPart(w.part)) continue;
    const layers = Math.min(3, Math.floor((w.outer + w.inner) / 200));
    if (layers <= 0) continue;
    if (w.inner >= w.outer) addSeal(f, w.part, layers); else addFlaw(f, w.part, layers);
  }
}
