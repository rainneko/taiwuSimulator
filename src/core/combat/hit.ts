import { HIT_CHANNELS, HIT_DODGE_MAP, type CombatState, type FighterState, type HitChannel } from './types';
import { applyHitDamage, severityOf } from './damage';
import { gainStance, nextWheelStance } from './stance';
import { addFocus } from './resource';
import { getOpponent } from './util';

export function getHitValue(f: FighterState, ch: HitChannel): number {
  return ch === 'power' ? f.stats.hitPower : ch === 'speed' ? f.stats.hitSpeed : f.stats.hitSkill;
}

export function getDodgeValue(f: FighterState, ch: HitChannel): number {
  const d = HIT_DODGE_MAP[ch];
  return d === 'deflect' ? f.stats.dodgeDeflect : d === 'evade' ? f.stats.dodgeEvade : f.stats.dodgeParry;
}

/**
 * 命中率% = 命中 / (命中 + 化解) × 100，再受破绽层数加成（每层 +5%），夹在 [5, 95]。
 * M1 占位公式，WO2 按 wiki 原版公式替换。
 */
export function hitChance(attacker: FighterState, defender: FighterState, ch: HitChannel, weaknessStacks = 0): number {
  const h = Math.max(0, getHitValue(attacker, ch));
  const d = Math.max(0, getDodgeValue(defender, ch));
  const base = h + d === 0 ? 50 : (h / (h + d)) * 100;
  return Math.max(5, Math.min(95, base + weaknessStacks * 5));
}

/** 按攻击方三路命中值加权选择本次的命中路数 */
export function pickChannel(state: CombatState, f: FighterState): HitChannel {
  const idx = state.rng.weightedPick(HIT_CHANNELS.map(c => Math.max(1, Math.floor(getHitValue(f, c)))));
  return HIT_CHANNELS[idx] ?? 'power';
}

export const FOCUS_ON_HIT = 5;
export const FOCUS_ON_DODGE = 5;

/** 一次出手：选路 → 命中判定 → 伤害/化解 → 获得式 & 专注 */
export function resolveAttackRound(state: CombatState, attacker: FighterState, powerMult: number): boolean {
  const defender = getOpponent(state, attacker);
  state.events.emit('attackStart', { actorId: attacker.id, targetId: defender.id, frame: state.frame });

  const ch = pickChannel(state, attacker);
  const pct = hitChance(attacker, defender, ch);
  if (!state.rng.chance(pct)) {
    state.events.emit('dodge', { actorId: attacker.id, targetId: defender.id, channel: ch });
    addFocus(defender, FOCUS_ON_DODGE, state.battleType);
    return false;
  }

  const r = applyHitDamage(state, attacker, defender, ch, powerMult);
  state.events.emit('hit', {
    actorId: attacker.id, targetId: defender.id, part: r.part,
    severity: severityOf(r.inner + r.outer), damage: r.damage, channel: ch,
  });
  gainStance(state, attacker, nextWheelStance(attacker));
  addFocus(attacker, FOCUS_ON_HIT, state.battleType);
  return true;
}
