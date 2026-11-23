import type { CombatState, FighterState, GuardSkillData } from './types';
import { pushMod, removeModsBySource } from './stats';
import { addGuard } from './resource';

export const GAUGE_FULL = 30000;

/** 提气/架势消耗：30000 × 总比例 × 提气占比 / 架势占比 */
export function gaugeCost(gaugeTotal: number, breathShare: number): { breath: number; stance: number } {
  return {
    breath: Math.floor(GAUGE_FULL * gaugeTotal / 1000 * breathShare / 1000),
    stance: Math.floor(GAUGE_FULL * gaugeTotal / 1000 * (1000 - breathShare) / 1000),
  };
}

export function canActivateGuardSkill(f: FighterState, skill: GuardSkillData): boolean {
  if (f.castPhase !== 'none' || f.guardSkillPhase === 'active') return false;
  const c = gaugeCost(skill.gaugeTotal, skill.breathShare);
  return f.breath >= c.breath && f.stance >= c.stance;
}

/** 施展完成：进入持续，化解/护体/御气加成推入 StatStack（source='guardSkill'） */
export function activateGuardSkill(state: CombatState, f: FighterState, skill: GuardSkillData): void {
  f.guardSkillPhase = 'active';
  f.guardSkillId = skill.id;
  f.guardSkillRemain = skill.duration;
  const d = skill.duration + 1;
  pushMod(f, 'dodgeDeflect', skill.avoid.absorb, d, 'guardSkill');
  pushMod(f, 'dodgeParry', skill.avoid.parry, d, 'guardSkill');
  pushMod(f, 'dodgeEvade', skill.avoid.dodge, d, 'guardSkill');
  pushMod(f, 'protection', skill.guardFlat.outer, d, 'guardSkill');
  pushMod(f, 'protection_pct', skill.guardPct.outer, d, 'guardSkill');
  pushMod(f, 'qiControl', skill.guardFlat.inner, d, 'guardSkill');
  pushMod(f, 'qiControl_pct', skill.guardPct.inner, d, 'guardSkill');
  state.events.emit('guardSkillStart', { actorId: f.id, skillId: skill.id });
}

/** 护体持续：守御每帧回复 guardMax/300（回满后解除尽破）；结束时移除加成 */
export function tickGuardSkill(f: FighterState): void {
  if (f.guardSkillPhase !== 'active') return;
  addGuard(f, Math.max(1, Math.floor(f.guardMax / 300)));
  if (f.guardBroken && f.guard >= f.guardMax) f.guardBroken = false;
  f.guardSkillRemain--;
  if (f.guardSkillRemain <= 0) {
    f.guardSkillPhase = 'off';
    f.guardSkillId = null;
    f.guardSkillRemain = 0;
    removeModsBySource(f, 'guardSkill');
  }
}
