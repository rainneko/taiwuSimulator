import type { BodyPart, CombatState, DamageSource, FighterState } from './types';
import { STANCE_CAN_CHANGE, STANCE_CHANNEL, STANCE_PART_WEIGHTS, getDodgeValue, getHitValue, hitCheck, pickBodyPart } from './hit';
import { applyChangeMoveEffect, autoChangeMovePart, checkChangeMove, resolveChangeMove, CHANGE_MOVE_STANCE } from './changeMove';
import { COMBO_HITS, COMBO_POWER, checkChase, checkComboStrike } from './chase';
import { resolveDamageChain } from './damage';
import { currentWheelStance, gainStance } from './stance';
import { calcAttackInterval, getCombatWeapon } from './weapon';
import { statOf } from './stats';
import { triggerEffects } from './effect';
import { checkCounterCondition, resolveCounter } from './counter';
import { getOpponent } from './util';

export const WEAPON_SPEED_CLASS = { veryFast: 3000, fast: 4500, normal: 6000, slow: 7500, verySlow: 9000 } as const;
export const ATTACK_ANIM_LOCK = 30;
export const ANIM_LOCK_PER_EXTRA_HIT = 10;

/** 攻击间隔（帧） = ceil((基础速度 + 重量×100) / floor(30 + 60×攻速% × (1 - 右臂点穴×5%))) */
export function getAttackInterval(baseSpeed: number, weaponWeight: number, attackSpeedPct: number, acupointsRightArm: number): number {
  return calcAttackInterval(baseSpeed, weaponWeight, attackSpeedPct * (1 - acupointsRightArm * 0.05));
}

export function isInWeaponRange(f: FighterState, distance: number): boolean {
  return distance >= f.weaponRangeMin - 1e-9 && distance <= f.weaponRangeMax + 1e-9;
}

/** 攻速取有效属性（已含右臂点穴减益） */
export function recomputeAttackInterval(f: FighterState): void {
  const w = f.weapons.find(x => x.id === f.weaponId);
  if (!w) return;
  f.attackInterval = calcAttackInterval(w.baseSpeed, w.weight, f.statMods ? statOf(f, 'attackSpeed') : f.stats.attackSpeed);
}

/** 范围内累加攻击进度，满则出手；范围外暂停（不清零） */
export function tickAttack(state: CombatState, f: FighterState): void {
  if (!isInWeaponRange(f, state.distance)) {
    f.attackPhase = 'outOfRange';
    return;
  }
  recomputeAttackInterval(f);
  f.attackPhase = 'charging';
  f.attackProgress++;
  if (f.attackProgress >= f.attackInterval) {
    f.attackProgress = 0;
    f.attackPhase = 'striking';
    resolveAttackRound(state, f);
  }
}

export function calcAnimLockDuration(hits: number): number {
  return ATTACK_ANIM_LOCK + Math.max(0, hits - 1) * ANIM_LOCK_PER_EXTRA_HIT;
}

function sideOf(state: CombatState, f: FighterState): 0 | 1 {
  return state.fighters[0] === f ? 0 : 1;
}

export interface AttackRoundResult { hits: number; landed: number; combo: boolean; countered: boolean }

/**
 * 普攻回合（§5.6）：连环奇击判定 → 每击（变招 → 定部位 → 命中 → 伤害链）→ 追击 → 回合结束得式、推进轮盘。
 */
export function resolveAttackRound(state: CombatState, atk: FighterState): AttackRoundResult {
  const def = getOpponent(state, atk);
  const atkSide = sideOf(state, atk);
  const defSide = (1 - atkSide) as 0 | 1;
  const weapon = getCombatWeapon(atk);
  state.events.emit('attackStart', { actorId: atk.id, targetId: def.id, frame: state.frame });
  state.counterTriggered = false;

  const combo = checkComboStrike(state.rng, statOf(atk, 'innerBreath'), statOf(def, 'innerBreath'));
  const isCombo = combo.triggered;
  if (isCombo) state.events.emit('comboStrike', { actorId: atk.id });
  const maxHits = isCombo ? COMBO_HITS : 1 + 5; // 非连环：首击 + 最多 5 次追击
  const power = isCombo ? COMBO_POWER : 1000;

  const stance = currentWheelStance(atk);
  const channel = STANCE_CHANNEL[stance];
  let roundHit = false;
  let hits = 0, landed = 0, chaseCount = 0;

  while (hits < maxHits && state.phase !== 'ended') {
    const source: DamageSource = isCombo ? 'combo' : chaseCount > 0 ? 'chase' : 'attack';
    if (chaseCount > 0 && !isCombo) state.events.emit('chase', { actorId: atk.id, hitIndex: hits });

    // 变招
    let cm: { part: BodyPart; success: boolean } | undefined;
    if (STANCE_CAN_CHANGE[stance]) {
      const r = checkChangeMove(state.rng, atk.changeMeter, weapon.changeCoef, true);
      atk.changeMeter = r.newMeter;
      if (r.triggered) {
        const chosen = atk.changeMovePref ?? autoChangeMovePart(state.rng, def);
        cm = resolveChangeMove(state.rng, chosen);
        state.events.emit('changeMove', { actorId: atk.id, part: cm.part, success: cm.success });
      }
    }

    let dodged = false;
    if (cm && !cm.success) {
      // 变招失败 → 视为在原部位被化解
      dodged = true;
      state.events.emit('dodge', { actorId: atk.id, targetId: def.id, channel });
    } else {
      const part = cm?.success ? cm.part : pickBodyPart(state.rng, STANCE_PART_WEIGHTS[stance]);
      const hr = cm?.success
        ? { hit: true, severity: (getHitValue(atk, channel) >= getDodgeValue(def, channel) * 2 ? 2 : 1) as 1 | 2 }
        : hitCheck(state.rng, getHitValue(atk, channel), getDodgeValue(def, channel), atk.stats.luck, def.stats.luck);
      if (hr.hit) {
        if (cm?.success) {
          applyChangeMoveEffect(state.rng, cm.part, def);
          gainStance(state, atk, CHANGE_MOVE_STANCE[cm.part]);
          triggerEffects(state, atkSide, 'onChangeMoveSuccess', { part: cm.part });
        }
        const calc = resolveDamageChain(state, atk, def, {
          source, stance, channel, part, grade: hr.severity, power, changeMoveSuccess: !!cm?.success,
        });
        const dmg = calc.final.outer + calc.final.inner;
        if (part !== 'spirit' && part !== 'poison' && part !== 'whole') {
          state.events.emit('hit', { actorId: atk.id, targetId: def.id, part, severity: hr.severity, damage: dmg, channel });
        }
        triggerEffects(state, atkSide, 'onAttackHit', { part: part as BodyPart });
        roundHit = true;
        landed++;
      } else {
        dodged = true;
        state.events.emit('dodge', { actorId: atk.id, targetId: def.id, channel });
      }
    }
    hits++;

    if (dodged) {
      triggerEffects(state, atkSide, 'onAttackDodged', {});
      if (checkCounterCondition(state, def, channel, stance)) {
        resolveCounter(state, def);
        triggerEffects(state, defSide, 'onCounter', {});
        break; // 反击中断追击
      }
    }

    if (!isCombo) {
      if (!checkChase(state.rng, weapon.chaseCoef, chaseCount)) break;
      chaseCount++;
    }
  }

  if (roundHit && gainStance(state, atk, stance)) triggerEffects(state, atkSide, 'onStanceGained', {});
  atk.wheelIndex = atk.wheelSlots.length ? (atk.wheelIndex + 1) % atk.wheelSlots.length : 0;
  atk.attackProgress = 0;
  state.animLock = Math.max(state.animLock, calcAnimLockDuration(hits));
  return { hits, landed, combo: isCombo, countered: state.counterTriggered };
}
