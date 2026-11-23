import { PCG32 } from '../rng';
import { EventBus } from '../EventBus';
import type { CombatAction, CombatConfig, CombatEvent, CombatEventMap, CombatState, FighterState } from './types';
import { createFighterState, equipWeapon } from './fighter';
import { RESOURCE_MAX, canCastTechnique, initGuard, tickBreathStance, tickFocus, tickGuardSkill } from './resource';
import { setTargetDistance, tickMobility, tickMovement } from './distance';
import { tickAttack, ATTACK_ANIM_LOCK } from './attack';
import { resolveAttackRound } from './hit';
import { checkEnd } from './wound';
import { findFighter } from './util';

export const DEFAULT_CAST_FRAMES = 60;
export const DEFAULT_GUARD_SKILL_FRAMES = 300;
export const WEAPON_SWITCH_COOLDOWN = 60;
export const TECHNIQUE_POWER_MULT = 2;

export function initCombat(config: CombatConfig): CombatState {
  const rng = new PCG32(config.seed);
  const events = new EventBus<CombatEventMap>();
  const startDistance = config.startDistance ?? 5.0;

  // 先后手：M1 简化为随机（原版：机略多者先手）
  const firstIdx = rng.randInt(2);

  const fighters = config.fighters.map((fc, i) => {
    const f = createFighterState(fc, startDistance);
    f.isFirst = i === firstIdx;
    // 先手：移动力3、提气架势80%；后手：移动力1、提气架势50%
    const pct = f.isFirst ? 0.8 : 0.5;
    f.movementPoints = f.isFirst ? 3 : 1;
    f.breath = Math.floor(RESOURCE_MAX * pct);
    f.stance = Math.floor(RESOURCE_MAX * pct);
    initGuard(f);
    return f;
  }) as [FighterState, FighterState];

  return {
    phase: 'running',
    battleType: config.battleType ?? 'spar',
    frame: 0, stepCount: 0, animLock: 0, choiceWindow: 0,
    fighters,
    distance: startDistance,
    seed: config.seed,
    rng, events,
    commandLog: [],
  };
}

function drain(state: CombatState): CombatEvent[] {
  return state.events.drain() as CombatEvent[];
}

export function applyCommand(state: CombatState, cmd: CombatAction): void {
  state.commandLog.push({ step: state.stepCount, action: cmd });
  if (cmd.type === 'pause') { if (state.phase === 'running') state.phase = 'paused'; return; }
  if (cmd.type === 'resume') { if (state.phase === 'paused') state.phase = 'running'; return; }
  if (state.phase === 'ended') return;
  const f = findFighter(state, cmd.actorId);
  if (!f) return;
  switch (cmd.type) {
    case 'setTargetDistance':
      setTargetDistance(f, cmd.delta);
      break;
    case 'castTechnique':
      if (f.castPhase === 'none' && canCastTechnique(f)) {
        f.castPhase = 'casting';
        f.castSkillId = cmd.skillId;
        f.castProgress = 0;
        f.castTotal = Math.max(1, cmd.castFrames ?? DEFAULT_CAST_FRAMES);
        f.breath = 0;
        f.stance = 0;
        state.events.emit('techniqueCastStart', { actorId: f.id, skillId: cmd.skillId, totalFrames: f.castTotal });
      }
      break;
    case 'activateGuardSkill':
      if (f.guardSkillPhase === 'off') {
        f.guardSkillPhase = 'active';
        f.guardSkillId = cmd.skillId;
        f.guardSkillRemain = Math.max(1, cmd.durationFrames ?? DEFAULT_GUARD_SKILL_FRAMES);
      }
      break;
    case 'switchWeapon': {
      const w = f.weapons.find(x => x.id === cmd.weaponId);
      if (w && f.weaponSwitchCooldown === 0 && w.id !== f.weaponId && f.castPhase === 'none') {
        equipWeapon(f, w);
        f.weaponSwitchCooldown = WEAPON_SWITCH_COOLDOWN;
        state.events.emit('weaponSwitch', { actorId: f.id, weaponId: w.id });
      }
      break;
    }
    case 'flee':
      if (f.fleePhase === 'none') { f.fleePhase = 'fleeing'; f.fleeProgress = 0; }
      break;
    case 'changeMove':
      // WO2：变招窗口内的部位选择
      if (state.phase === 'choice') {
        state.events.emit('changeMove', { actorId: f.id, part: cmd.part, success: true });
        state.phase = 'running';
        state.choiceWindow = 0;
      }
      break;
  }
}

function tickChoiceWindow(state: CombatState): void {
  state.choiceWindow--;
  if (state.choiceWindow <= 0) { state.choiceWindow = 0; state.phase = 'running'; }
}

function tickFlee(state: CombatState, f: FighterState): void {
  if (f.fleePhase !== 'fleeing') return;
  f.fleeProgress++;
  if (f.fleeProgress >= f.fleeThreshold) {
    f.fleePhase = 'none';
    state.events.emit('flee', { actorId: f.id, success: true });
    state.phase = 'ended';
    state.events.emit('end', { winnerId: null, reason: 'flee' });
  }
}

function tickWeaponSwitch(f: FighterState): void {
  if (f.weaponSwitchCooldown > 0) f.weaponSwitchCooldown--;
}

function tickCast(state: CombatState, f: FighterState): void {
  f.castProgress++;
  if (f.castProgress < f.castTotal) return;
  const skillId = f.castSkillId ?? '';
  f.castPhase = 'none';
  f.castSkillId = null;
  f.castProgress = 0;
  f.castTotal = 0;
  state.events.emit('techniqueStage', { actorId: f.id, skillId, stage: 4, hits: 1 });
  state.animLock = ATTACK_ANIM_LOCK;
  resolveAttackRound(state, f, TECHNIQUE_POWER_MULT);
}

/** 推进一个逻辑帧。只修改传入的 state；所有随机走 state.rng。 */
export function step(state: CombatState, commands: readonly CombatAction[] = []): CombatEvent[] {
  for (const c of commands) applyCommand(state, c);
  state.stepCount++;

  if (state.phase === 'paused' || state.phase === 'ended') return drain(state);
  if (state.phase === 'choice') { tickChoiceWindow(state); return drain(state); }
  if (state.animLock > 0) { state.animLock--; return drain(state); }

  state.frame++;

  const order = state.fighters[0].isFirst
    ? [state.fighters[0], state.fighters[1]]
    : [state.fighters[1], state.fighters[0]];

  for (const f of order) {
    tickMovement(state, f);
    tickFlee(state, f);
    if ((state.phase as string) === 'ended') break;
    tickWeaponSwitch(f);

    if (f.castPhase === 'casting') {
      tickCast(state, f);
    } else {
      if (f.guardSkillPhase !== 'active') tickBreathStance(f);
      tickAttack(state, f);
    }

    tickGuardSkill(f);
    tickMobility(f);
    tickFocus(state, f);

    if (state.animLock > 0) break;
  }

  checkEnd(state);
  return drain(state);
}

export const stepCombat = step;

/** 可序列化快照（不含事件总线），用于确定性校验与存档 */
export function serializeState(state: CombatState): string {
  return JSON.stringify({
    phase: state.phase, battleType: state.battleType, frame: state.frame,
    stepCount: state.stepCount, animLock: state.animLock, choiceWindow: state.choiceWindow,
    fighters: state.fighters, distance: state.distance,
    seed: state.seed.toString(), rng: state.rng.save(),
  });
}

/** FNV-1a 32 位哈希 */
export function hashState(state: CombatState): string {
  const s = serializeState(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 按 commandLog 从头重放 */
export function replay(config: CombatConfig, log: readonly { step: number; action: CombatAction }[], steps: number): CombatState {
  const state = initCombat(config);
  let i = 0;
  for (let n = 0; n < steps; n++) {
    const cmds: CombatAction[] = [];
    while (i < log.length && log[i]!.step === state.stepCount) cmds.push(log[i++]!.action);
    step(state, cmds);
  }
  return state;
}
