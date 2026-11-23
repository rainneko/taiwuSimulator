import type { BodyPart, CombatState, FighterState, HitChannel, StanceType } from './types';
import { STANCE_CAN_CHANGE, STANCE_CHANNEL, STANCE_PART_WEIGHTS, getDodgeValue, getHitValue, hitCheck, pickBodyPart } from './hit';
import { autoChangeMovePart, checkChangeMove, resolveChangeMove } from './changeMove';
import { resolveDamageChain } from './damage';
import { currentWheelStance, gainStance } from './stance';
import { getCombatWeapon } from './weapon';
import { getOpponent } from './util';

/** 反击条件：护体绝技带反击 + 化解成功 + 非「音」式 + 通道匹配（反击通道为力道时匹配全部）+ 距离段内 */
export function checkCounterCondition(state: CombatState, defender: FighterState, attackChannel: HitChannel, stance: StanceType): boolean {
  if (defender.guardSkillPhase !== 'active' || !defender.guardSkillId) return false;
  const skill = state.arts.guardSkills[defender.guardSkillId];
  if (!skill?.counter) return false;
  if (stance === 'sound') return false;
  if (attackChannel !== skill.counter.channel && skill.counter.channel !== 'power') return false;
  const d10 = Math.round(state.distance * 10);
  return d10 >= skill.counter.range[0] && d10 <= skill.counter.range[1];
}

/** 反击：按「带威力的普攻」结算，可变招，不可追击；命中得 1 个式 */
export function resolveCounter(state: CombatState, def: FighterState): boolean {
  const atk = getOpponent(state, def);
  const skill = state.arts.guardSkills[def.guardSkillId!]!;
  const weapon = getCombatWeapon(def);
  const stance = currentWheelStance(def);
  const channel = STANCE_CHANNEL[stance];
  let part = pickBodyPart(state.rng, STANCE_PART_WEIGHTS[stance]);
  let cmOk = false;
  if (STANCE_CAN_CHANGE[stance]) {
    const r = checkChangeMove(state.rng, def.changeMeter, weapon.changeCoef, true);
    def.changeMeter = r.newMeter;
    if (r.triggered) {
      const cm = resolveChangeMove(state.rng, def.changeMovePref ?? autoChangeMovePart(state.rng, atk));
      if (cm.success) { part = cm.part as BodyPart; cmOk = true; }
    }
  }
  const hr = hitCheck(state.rng, getHitValue(def, channel), getDodgeValue(atk, channel), def.stats.luck, atk.stats.luck);
  state.counterTriggered = true;
  state.events.emit('counter', { actorId: def.id, targetId: atk.id });
  if (!hr.hit) return false;
  resolveDamageChain(state, def, atk, {
    source: 'counter', stance, channel, part, grade: hr.severity, power: skill.counter!.power, changeMoveSuccess: cmOk,
  });
  gainStance(state, def, stance);
  return true;
}
