import type { AIConfig, AIRuntime, CombatState, FighterState, TechniqueData } from './types';
import { getCombatWeapon, calcAttackInterval } from './weapon';
import { statOf } from './stats';
import { hitChancePermille } from './hit';
import { HIT_CHANNELS } from './types';
import { getDodgeValue, getHitValue } from './hit';
import { calcCastTime, canCastTechnique, resolveArtRange, startCast } from './technique';
import { canActivateGuardSkill } from './guardSkill';
import { canCastMovementArt } from './movement';
import { equipWeapon } from './fighter';
import { shuffleWheel } from './stance';
import { WEAPON_SWITCH_TOTAL } from './weapon';
import { MOVE_PROGRESS_MAX, DISTANCE_MAX, DISTANCE_MIN } from './distance';
import { defeatThreshold } from './wound';
import { RESOURCE_MAX } from './resource';
import { clamp, round1 } from './util';

// ================= 难度档（§5.13） =================

export interface AIDifficulty {
  thinkInterval: number;
  actions: ReadonlySet<string>;
  predictionSteps: number;
  noise: number; // 千分比
  statMults: { attackSpeed: number; moveSpeed: number; hit: number; penetrate: number; avoid: number; guard: number };
}

const FULL = { attackSpeed: 1000, moveSpeed: 1000, hit: 1000, penetrate: 1000, avoid: 1000, guard: 1000 };

export const AI_DIFFICULTIES: readonly AIDifficulty[] = [
  { thinkInterval: 30, actions: new Set(['setTargetDistance', 'switchWeapon']), predictionSteps: 0, noise: 200,
    statMults: { attackSpeed: 500, moveSpeed: 750, hit: 500, penetrate: 500, avoid: 500, guard: 500 } },
  { thinkInterval: 20, actions: new Set(['setTargetDistance', 'switchWeapon', 'cast', 'heal']), predictionSteps: 1, noise: 100, statMults: FULL },
  { thinkInterval: 10, actions: new Set(['setTargetDistance', 'switchWeapon', 'cast', 'heal', 'detox']), predictionSteps: 3, noise: 50, statMults: FULL },
  { thinkInterval: 6, actions: new Set(['setTargetDistance', 'switchWeapon', 'cast', 'heal', 'detox']), predictionSteps: 5, noise: 0, statMults: FULL },
];

export function createAIRuntime(cfg: AIConfig): AIRuntime {
  return { difficulty: cfg.difficulty, personality: cfg.personality ?? { brave: 50, calm: 50 } };
}

/** 开战时按难度档缩放属性 */
export function applyDifficultyStats(f: FighterState, difficulty: number): void {
  const m = AI_DIFFICULTIES[difficulty]!.statMults;
  const k = (v: number, mult: number) => Math.floor(v * mult / 1000);
  const s = f.stats;
  s.attackSpeed = k(s.attackSpeed, m.attackSpeed);
  f.moveSpeed = k(f.moveSpeed, m.moveSpeed);
  s.hitPower = k(s.hitPower, m.hit); s.hitSpeed = k(s.hitSpeed, m.hit); s.hitSkill = k(s.hitSkill, m.hit);
  s.penetrateOuter = k(s.penetrateOuter, m.penetrate); s.penetrateInner = k(s.penetrateInner, m.penetrate);
  s.dodgeDeflect = k(s.dodgeDeflect, m.avoid); s.dodgeEvade = k(s.dodgeEvade, m.avoid); s.dodgeParry = k(s.dodgeParry, m.avoid);
  s.protection = k(s.protection, m.guard); s.qiControl = k(s.qiControl, m.guard);
}

// ================= 估值工具 =================

function avgHitChance(me: FighterState, enemy: FighterState): number {
  let sum = 0;
  for (const ch of HIT_CHANNELS) sum += hitChancePermille(getHitValue(me, ch), getDodgeValue(enemy, ch), me.stats.luck, enemy.stats.luck);
  return sum / HIT_CHANNELS.length / 1000;
}

/** 在距离 d 用武器 w 的期望每帧伤害 */
function weaponDps(me: FighterState, enemy: FighterState, wIdx: number, d: number): number {
  const w = me.weapons[wIdx]!;
  if (d < w.rangeMin - 1e-9 || d > w.rangeMax + 1e-9) return 0;
  return w.power * avgHitChance(me, enemy) / calcAttackInterval(w.baseSpeed, w.weight, statOf(me, 'attackSpeed'));
}

function knownTechniques(s: CombatState, f: FighterState): TechniqueData[] {
  return f.arts.map(id => s.arts.techniques[id]).filter((x): x is TechniqueData => !!x);
}

export function estimateTechniqueValue(art: TechniqueData): number {
  return art.damage * 2;
}

function personalityK(ai: AIRuntime): number {
  return clamp(1 + (ai.personality.calm - ai.personality.brave) / 100, 0.2, 2);
}

function noisy(s: CombatState, v: number, noise: number): number {
  if (noise <= 0) return v;
  return v * (1000 + s.rng.range(-noise, noise)) / 1000;
}

/** 预测 frames 帧后的距离：对手朝其目标距离移动 */
export function predictDistance(s: CombatState, side: 0 | 1, frames: number): number {
  const enemy = s.fighters[1 - side]!;
  const diff = enemy.targetDistance - s.distance;
  if (Math.abs(diff) < 1e-6) return s.distance;
  const stepsPossible = Math.floor(frames * enemy.moveSpeed * 100 / MOVE_PROGRESS_MAX);
  const travel = Math.min(Math.abs(diff), stepsPossible * enemy.moveDistance);
  return round1(s.distance + Math.sign(diff) * travel);
}

// ================= 决策 =================

/** 距离决策：在 2.0-9.0（步长 0.5）上评估 E_self − k·E_enemy − 移动代价 */
export function decideTargetDistance(s: CombatState, side: 0 | 1): number {
  const me = s.fighters[side];
  const enemy = s.fighters[1 - side]!;
  const ai = s.ai[side]!;
  const diffCfg = AI_DIFFICULTIES[ai.difficulty]!;
  const k = personalityK(ai);
  const curW = me.weapons.findIndex(w => w.id === me.weaponId);
  const enemyW = enemy.weapons.findIndex(w => w.id === enemy.weaponId);
  const hasMobility = me.movementPoints > 0 || me.bodyMovementPoints > 0;
  let best = s.distance, bestScore = -Infinity;
  for (let d10 = 20; d10 <= 90; d10 += 5) {
    const d = d10 / 10;
    let eSelf = weaponDps(me, enemy, curW, d);
    for (const art of knownTechniques(s, me)) {
      const [lo, hi] = resolveArtRange(art, me);
      if (d >= lo && d <= hi) eSelf += estimateTechniqueValue(art) / (calcCastTime(art.castTime, statOf(me, 'castSpeed')) + 600);
    }
    const remembered = (me.memory.damageByDistance[Math.floor(d)] ?? 0) / Math.max(1, s.frame);
    const eEnemy = weaponDps(enemy, me, enemyW, d) + remembered;
    const score = noisy(s, eSelf - k * eEnemy, diffCfg.noise);
    const moveCost = Math.abs(d - s.distance) * (hasMobility ? 1 : 4) * 0.01;
    const adjusted = score - moveCost;
    if (adjusted > bestScore) { bestScore = adjusted; best = d; }
  }
  return best;
}

export function decideTechnique(s: CombatState, side: 0 | 1): string | null {
  const me = s.fighters[side];
  if (me.castPhase !== 'none') return null;
  let bestId: string | null = null, bestScore = 0;
  for (const art of knownTechniques(s, me)) {
    if (!canCastTechnique(me, art).ok) continue;
    const [lo, hi] = resolveArtRange(art, me);
    const frames = calcCastTime(art.castTime, statOf(me, 'castSpeed'));
    const pd = predictDistance(s, side, frames);
    const inRange = pd >= lo && pd <= hi && s.distance >= lo && s.distance <= hi ? 1 : 0.3;
    if (inRange < 0.5) continue;
    const score = estimateTechniqueValue(art) * inRange;
    if (score > bestScore) { bestScore = score; bestId = art.id; }
  }
  return bestId;
}

/** 防守反应：对方施展中且（专注≥500 或 记忆中该功法 ≥5 成）→ 走位 / 护体 / 身法 */
export function decideDefense(s: CombatState, side: 0 | 1): { kind: 'move'; to: number } | { kind: 'cast'; id: string } | null {
  const me = s.fighters[side];
  const enemy = s.fighters[1 - side]!;
  if (enemy.castPhase !== 'casting' || enemy.castKind !== 'technique' || !enemy.castSkillId) return null;
  const art = s.arts.techniques[enemy.castSkillId];
  if (!art) return null;
  const mem = me.memory.artResults[art.id];
  if (!(me.focus >= 500 || (mem && mem.bestTenths >= 5))) return null;
  const [lo, hi] = resolveArtRange(art, enemy);
  const remain = enemy.castTotal - enemy.castProgress;
  const framesPerStep = Math.ceil(MOVE_PROGRESS_MAX / Math.max(1, me.moveSpeed * 100 * (me.movementPoints + me.bodyMovementPoints > 0 ? 1 : 0.5)));
  const stepDist = me.moveDistance;
  const toLow = s.distance - (lo - 0.1), toHigh = (hi + 0.1) - s.distance;
  const canLow = lo - 0.1 >= DISTANCE_MIN, canHigh = hi + 0.1 <= DISTANCE_MAX;
  const need = Math.min(canLow ? toLow : Infinity, canHigh ? toHigh : Infinity);
  if (Number.isFinite(need) && Math.ceil(need / stepDist) * framesPerStep < remain) {
    const to = canHigh && toHigh <= (canLow ? toLow : Infinity) ? hi + 0.1 : lo - 0.1;
    return { kind: 'move', to: round1(clamp(to, DISTANCE_MIN, DISTANCE_MAX)) };
  }
  for (const id of me.arts) {
    const g = s.arts.guardSkills[id];
    if (g && canActivateGuardSkill(me, g)) return { kind: 'cast', id };
  }
  for (const id of me.arts) {
    const m = s.arts.movementArts[id];
    if (m && canCastMovementArt(me, m)) return { kind: 'cast', id };
  }
  return null;
}

/** 逃跑：非死斗、非最低难度，伤势 ≥ 战败条件 × (40% + 勇壮×0.2%) */
export function decideEscape(s: CombatState, side: 0 | 1): boolean {
  const me = s.fighters[side];
  const ai = s.ai[side]!;
  if (s.battleType === 'deathmatch' || ai.difficulty === 0) return false;
  const t = defeatThreshold(s.battleType);
  const pct = Math.max(me.totalOuter, me.totalInner) * 1000 / t;
  return pct >= 400 + ai.personality.brave * 2;
}

function decideWeapon(s: CombatState, side: 0 | 1, targetD: number): number {
  const me = s.fighters[side];
  const enemy = s.fighters[1 - side]!;
  const cur = me.weapons.findIndex(w => w.id === me.weaponId);
  let best = cur, bestV = weaponDps(me, enemy, cur, targetD) * 1.2;
  me.weapons.forEach((_, i) => {
    const v = weaponDps(me, enemy, i, targetD);
    if (v > bestV) { bestV = v; best = i; }
  });
  return best;
}

/** AI 主循环：每 thinkInterval 帧决策一次，直接作用于自身状态（不写 commandLog，回放时同样会重算） */
export function tickAI(s: CombatState): void {
  for (const side of [0, 1] as const) {
    const ai = s.ai[side];
    if (!ai || s.phase === 'ended') continue;
    const cfg = AI_DIFFICULTIES[ai.difficulty]!;
    if (s.frame % cfg.thinkInterval !== 0) continue;
    const me = s.fighters[side];
    if (me.fleePhase === 'fleeing') continue;

    if (decideEscape(s, side)) {
      me.fleePhase = 'fleeing'; me.fleeProgress = 0;
      me.targetDistance = DISTANCE_MAX;
      continue;
    }
    if (me.castPhase === 'casting') continue;

    if (cfg.actions.has('cast')) {
      const def = decideDefense(s, side);
      if (def?.kind === 'move') { me.targetDistance = def.to; continue; }
      if (def?.kind === 'cast' && startCast(s, me, def.id)) continue;
      const tech = decideTechnique(s, side);
      if (tech && startCast(s, me, tech)) continue;
    }

    const d = decideTargetDistance(s, side);
    me.targetDistance = clamp(d, DISTANCE_MIN, DISTANCE_MAX);

    if (cfg.actions.has('switchWeapon') && me.weaponSwitchCooldown === 0) {
      const wi = decideWeapon(s, side, d);
      const w = me.weapons[wi];
      if (w && w.id !== me.weaponId) {
        equipWeapon(me, w);
        shuffleWheel(s.rng, me);
        me.weaponSwitchCooldown = WEAPON_SWITCH_TOTAL;
        s.events.emit('weaponSwitch', { actorId: me.id, weaponId: w.id });
      }
    }
  }
}
