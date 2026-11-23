import type { AIConfig, CombatConfig } from './types';
import { initCombat, step } from './CombatSim';

export interface BenchmarkResult {
  side0Wins: number;
  side1Wins: number;
  draws: number;
  avgFrames: number;
  avgSeconds: number;
  winRate: number;
}

/**
 * AI 对 AI 批量模拟（§5.13 验收）。base 不含 seed/ai；每场 seed = seedBase + i。
 * 逃跑视为逃跑方落败。超时记为平局。
 */
export function runBenchmark(
  base: Omit<CombatConfig, 'seed' | 'ai'>, ais: [AIConfig, AIConfig], runs: number, maxFrames = 60 * 300, seedBase = 1n,
): BenchmarkResult {
  let w0 = 0, w1 = 0, draws = 0, frames = 0;
  for (let i = 0; i < runs; i++) {
    const s = initCombat({ ...base, seed: seedBase + BigInt(i), ai: ais });
    let winner: string | null | undefined;
    let fled: string | undefined;
    while (s.phase !== 'ended' && s.frame < maxFrames) {
      for (const e of step(s)) {
        if (e.type === 'end') winner = e.payload.winnerId;
        if (e.type === 'flee') fled = e.payload.actorId;
      }
    }
    frames += s.frame;
    const [a, b] = s.fighters;
    if (fled) winner = fled === a.id ? b.id : a.id;
    if (winner === a.id) w0++; else if (winner === b.id) w1++; else draws++;
  }
  const avgFrames = frames / Math.max(1, runs);
  return { side0Wins: w0, side1Wins: w1, draws, avgFrames, avgSeconds: avgFrames / 60, winRate: w0 / Math.max(1, w0 + w1) };
}
