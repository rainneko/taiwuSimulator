import type { CombatConfig, CombatState } from './types';
import { initCombat, step } from './CombatSim';

/** 无头运行：双方站桩自动普攻直到分胜负或超时（默认 2 分钟逻辑时间） */
export function runHeadless(config: CombatConfig, maxFrames = 60 * 120): CombatState {
  const state = initCombat(config);
  for (let i = 0; i < maxFrames && state.phase !== 'ended'; i++) step(state, []);
  return state;
}
