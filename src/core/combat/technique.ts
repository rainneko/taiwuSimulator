import type { BodyPart, CombatState, FighterState, HitChannel, TechniqueData } from './types';
import { getDodgeValue, getHitValue, hitCheck, pickBodyPart } from './hit';
import { resolveDamageChain } from './damage';
import { consumeStances, expandCost, matchStances } from './stance';
import { getCombatWeapon } from './weapon';
import { hasMod, statOf } from './stats';
import { triggerEffects } from './effect';
import { RESOURCE_MAX } from './resource';
import { activateGuardSkill, canActivateGuardSkill, gaugeCost } from './guardSkill';
import { canCastMovementArt, resolveMovementArt } from './movement';
import { getOpponent } from './util';

/** 摧破判定顺序：迅疾 → 精妙 → 力道，然后终结段 */
export const TECHNIQUE_CHANNEL_ORDER: readonly HitChannel[] = ['speed', 'skill', 'power'];
export const TECHNIQUE_ANIM_BASE = 30;
export const TECHNIQUE_ANIM_PER_STAGE = 15;

/** 施展时间（帧）= ceil(最大施展时间 × 100 / 施展速度%) */
export function calcCastTime(castTime: number, castSpeedPct: number): number {
  return Math.ceil(castTime * 100 / Math.max(1, castSpeedPct));
}

/** 成数 → 伤势程度：1-4 轻伤，5-9 重伤，10 致命 */
export function tenthsGrade(tenths: number): 1 | 2 | 3 {
  return tenths >= 10 ? 3 : tenths >= 5 ? 2 : 1;
}

export function resolveArtRange(art: TechniqueData, f: FighterState): [number, number] {
  if (art.range.mode === 'fixed') return [art.range.min, art.range.max];
  const [a, b] = getCombatWeapon(f).range;
  return [Math.round((a + art.range.delta) * 10) / 10, Math.round((b + art.range.delta) * 10) / 10];
}

export function canCastTechnique(f: FighterState, art: TechniqueData): { ok: boolean; reason?: string } {
  if (f.castPhase !== 'none') return { ok: false, reason: 'alreadyCasting' };
  if (!hasMod(f, 'bypassDualFull')) {
    if (f.breath < RESOURCE_MAX) return { ok: false, reason: 'breathNotFull' };
    if (f.stance < RESOURCE_MAX) return { ok: false, reason: 'postureNotFull' };
  }
  if (art.type === 'leg') {
    if (f.movementPoints + f.bodyMovementPoints < (art.mobilityCost ?? 0)) return { ok: false, reason: 'insufficientMobility' };
  } else if (!matchStances(f.stances, expandCost(art.stanceCost))) {
    return { ok: false, reason: 'insufficientStances' };
  }
  return { ok: true };
}

function consumeTechniqueResources(f: FighterState, art: TechniqueData): void {
  const c = gaugeCost(art.gaugeTotal, art.breathShare);
  f.breath = Math.max(0, f.breath - c.breath);
  f.stance = Math.max(0, f.stance - c.stance);
  if (art.type === 'leg') {
    let cost = art.mobilityCost ?? 0;
    const s = Math.min(cost, f.bodyMovementPoints);
    f.bodyMovementPoints -= s; cost -= s;
    f.movementPoints = Math.max(0, f.movementPoints - cost);
  } else {
    consumeStances(f, expandCost(art.stanceCost));
  }
}

/** 开始施展任意功法（摧破/护体/身法）。资源在起手时扣除（施展期间本就不回复）。 */
export function startCast(state: CombatState, f: FighterState, artId: string): boolean {
  const side = state.fighters[0] === f ? 0 : 1;
  const tech = state.arts.techniques[artId];
  const guard = state.arts.guardSkills[artId];
  const move = state.arts.movementArts[artId];
  let castTime: number;
  if (tech) {
    if (!canCastTechnique(f, tech).ok) return false;
    consumeTechniqueResources(f, tech);
    f.castKind = 'technique';
    castTime = tech.castTime;
  } else if (guard) {
    if (!canActivateGuardSkill(f, guard)) return false;
    const c = gaugeCost(guard.gaugeTotal, guard.breathShare);
    f.breath -= c.breath; f.stance -= c.stance;
    f.castKind = 'guard';
    castTime = guard.castTime;
  } else if (move) {
    if (!canCastMovementArt(f, move)) return false;
    f.castKind = 'movement';
    castTime = move.castTime;
  } else {
    return false;
  }
  f.castPhase = 'casting';
  f.castSkillId = artId;
  f.castProgress = 0;
  f.castTotal = Math.max(1, calcCastTime(castTime, statOf(f, 'castSpeed')));
  state.events.emit('techniqueCastStart', { actorId: f.id, skillId: artId, totalFrames: f.castTotal });
  if (tech) triggerEffects(state, side, 'onTechniqueCast', { extra: tech.effects });
  return true;
}

export function tickCast(state: CombatState, f: FighterState): void {
  if (f.castPhase !== 'casting') return;
  f.castProgress++;
  if (f.castProgress < f.castTotal) return;
  const id = f.castSkillId ?? '';
  const kind = f.castKind;
  f.castPhase = 'none'; f.castSkillId = null; f.castProgress = 0; f.castTotal = 0; f.castKind = null;
  if (kind === 'technique') resolveTechnique(state, f, state.arts.techniques[id]!);
  else if (kind === 'guard') activateGuardSkill(state, f, state.arts.guardSkills[id]!);
  else if (kind === 'movement') resolveMovementArt(state, f, state.arts.movementArts[id]!);
}

export interface StageResult { stage: number; channel: HitChannel; tenths: number; grade: 1 | 2 | 3; part: string }

/** 摧破出手结算（§5.7）：距离检查 → 三通道各一段 → 终结段 → 特效 → 记忆 */
export function resolveTechnique(state: CombatState, atk: FighterState, art: TechniqueData): { totalTenths: number; stages: StageResult[] } {
  const def = getOpponent(state, atk);
  const side = state.fighters[0] === atk ? 0 : 1;
  const [lo, hi] = resolveArtRange(art, atk);
  const stages: StageResult[] = [];
  let totalTenths = 0;

  if (state.distance < lo - 1e-9 || state.distance > hi + 1e-9) {
    state.events.emit('techniqueWhiff', { actorId: atk.id, skillId: art.id });
  } else {
    for (const ch of TECHNIQUE_CHANNEL_ORDER) {
      const tenths = art.hit[ch] ?? 0;
      if (tenths <= 0 || state.phase === 'ended') continue;
      const r = hitCheck(state.rng, getHitValue(atk, ch), getDodgeValue(def, ch), atk.stats.luck, def.stats.luck);
      const stageNo = stages.length + 1;
      if (!r.hit) {
        state.events.emit('dodge', { actorId: atk.id, targetId: def.id, channel: ch });
        continue;
      }
      totalTenths += tenths;
      const grade = tenthsGrade(tenths);
      const part = pickBodyPart(state.rng, art.partWeights);
      resolveDamageChain(state, atk, def, { source: 'technique', art, channel: ch, part, grade, tenths });
      stages.push({ stage: stageNo, channel: ch, tenths, grade, part });
      state.events.emit('techniqueStage', { actorId: atk.id, skillId: art.id, stage: Math.min(3, stageNo) as 1 | 2 | 3, hits: tenths });
    }
    if (totalTenths > 0 && state.phase !== 'ended') {
      const grade = tenthsGrade(totalTenths);
      const part = pickBodyPart(state.rng, art.partWeights);
      resolveDamageChain(state, atk, def, { source: 'technique', art, channel: 'power', part, grade, tenths: totalTenths });
      stages.push({ stage: 4, channel: 'power', tenths: totalTenths, grade, part });
      state.events.emit('techniqueStage', { actorId: atk.id, skillId: art.id, stage: 4, hits: totalTenths });
    }
    triggerEffects(state, side, 'onTechniqueResolved', {
      tenths: totalTenths, part: stages.at(-1)?.part as BodyPart | undefined, extra: art.effects,
    });
  }

  const mem = def.memory.artResults[art.id] ?? { casts: 0, bestTenths: 0 };
  mem.casts++;
  mem.bestTenths = Math.max(mem.bestTenths, totalTenths);
  def.memory.artResults[art.id] = mem;

  state.animLock = Math.max(state.animLock, TECHNIQUE_ANIM_BASE + stages.length * TECHNIQUE_ANIM_PER_STAGE);
  state.events.emit('techniqueResolved', { actorId: atk.id, skillId: art.id, totalTenths });
  return { totalTenths, stages };
}
