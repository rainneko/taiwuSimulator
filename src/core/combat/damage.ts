import type { AnyPart, CombatState, DamageCalc, DamageSource, FighterState, HitChannel, StanceType, TechniqueData, Wound } from './types';
import type { CombatWeapon } from './weapon';
import { getCombatWeapon } from './weapon';
import { modSum, statOf } from './stats';
import { isBodyPart } from './hit';
import { resolveGuard } from './guard';
import { addFocusFrom } from './focus';
import { applyWound, checkEnd, createWound, defeatThreshold } from './wound';
import { triggerEffects } from './effect';
import { resolveReflect } from './reflect';
import { clamp } from './util';

export const CALC_LOG_MAX = 200;
export const MIN_REGULAR_DAMAGE = 10;

// ---------- (1) 内伤比例 ----------

/** 转化难度（千分比）：内功发挥 >0 且基础 <50% 或 ≤0 且基础 >50% 时提高 */
export function convDifficulty(base: number, neigongPlay: number): number {
  if (neigongPlay > 0 && base < 500) return 1000 + Math.floor((500 - base) * 1000 / 500);
  if (neigongPlay <= 0 && base > 500) return 1000 + Math.floor((base - 500) * 1000 / 500);
  return 1000;
}

export function calcInnerRatio(
  weapon: Pick<CombatWeapon, 'innerRatioBase' | 'neigongConv'>, neigongPlay: number, artInnerRatioBase?: number,
): { weaponRatio: number; artRatio?: number; finalRatio: number } {
  const base = weapon.innerRatioBase;
  const diff = convDifficulty(base, neigongPlay);
  // 武器内伤比例 = 基础 + 内功发挥 × 转化系数 / 转化难度
  const weaponRatio = clamp(base + Math.floor(neigongPlay * weapon.neigongConv / diff), 0, 1000);
  if (artInnerRatioBase === undefined) return { weaponRatio, finalRatio: weaponRatio };
  // 功法内功比例 = 功法基础 + 内功发挥 / 转化难度（千分比口径）
  const artRatio = clamp(artInnerRatioBase + Math.floor(neigongPlay * 1000 / diff), 0, 1000);
  return { weaponRatio, artRatio, finalRatio: Math.floor((weaponRatio + artRatio) / 2) };
}

// ---------- (2) 破甲倍率 ----------

export function calcArmorMult(armorBreak: number, toughness: number, changeMoveSuccess: boolean): { outer: number; inner: number } {
  if (changeMoveSuccess) return { outer: 1000, inner: 1000 };
  if (armorBreak === 0 && toughness === 0) return { outer: 1000, inner: 1000 };
  if (armorBreak <= toughness) return { outer: 500, inner: 750 };
  const ratio = Math.floor((armorBreak - toughness) * 1000 / armorBreak);
  return { outer: 500 + Math.floor(500 * ratio / 1000), inner: 750 + Math.floor(250 * ratio / 1000) };
}

// ---------- (3) 破体/破气倍率 ----------

/** 穿透系数：内伤比例 >80% 或 <20% → 0.4，否则 1 - |比例-50%| × 1.2；普攻减半 */
export function penetrationCoef(innerRatio: number, isNormalAttack: boolean): number {
  let coef = innerRatio > 800 || innerRatio < 200 ? 400 : 1000 - Math.floor(Math.abs(innerRatio - 500) * 1200 / 1000);
  if (isNormalAttack) coef = Math.floor(coef / 2);
  return coef;
}

/** 单项倍率（千分比）。atk ≤ def：1 + (atk-def)/def × 1.2；atk > def：1 + (atk-def)/def × 系数 */
export function calcPenetrationMult(
  atkValue: number, defValue: number, innerRatio: number, isNormalAttack: boolean, upperCap: number,
): number {
  if (atkValue <= defValue) {
    const raw = 1000 + Math.floor((atkValue - defValue) * 1200 / Math.max(1, defValue));
    return clamp(raw, 100, upperCap);
  }
  const coef = penetrationCoef(innerRatio, isNormalAttack);
  return clamp(1000 + Math.floor((atkValue - defValue) * coef / Math.max(1, defValue)), 100, upperCap);
}

// ---------- (4) 常规伤害 ----------

const m = (x: number) => x / 1000;

export function calcNormalAttackDamage(
  weaponBase: number, innerRatio: number, armorMult: { outer: number; inner: number },
  dealOuter: number, dealInner: number, penMult: { outer: number; inner: number }, power: number,
): { outer: number; inner: number } {
  const outer = Math.floor(weaponBase * m(1000 - innerRatio) * m(armorMult.outer) * m(dealOuter) * m(penMult.outer) * m(power));
  const inner = Math.floor(weaponBase * m(innerRatio) * m(armorMult.inner) * m(dealInner) * m(penMult.inner) * m(power));
  return { outer: Math.max(MIN_REGULAR_DAMAGE, outer), inner: Math.max(MIN_REGULAR_DAMAGE, inner) };
}

export function calcTechniqueDamage(
  weaponBase: number, artBase: number, innerRatio: number, armorMult: { outer: number; inner: number },
  dealOuter: number, dealInner: number, penMult: { outer: number; inner: number },
  artAdjust: number, hitRatio: number, hasProtectEffect: boolean,
): { outer: number; inner: number } {
  const protect = hasProtectEffect ? 500 : 1000;
  const base = artBase + weaponBase;
  const outer = Math.floor(base * m(1000 - innerRatio) * m(armorMult.outer) * m(dealOuter) * m(artAdjust) * m(protect) * m(penMult.outer) * m(hitRatio));
  const inner = Math.floor(base * m(innerRatio) * m(armorMult.inner) * m(dealInner) * m(artAdjust) * m(protect) * m(penMult.inner) * m(hitRatio));
  return { outer: Math.max(MIN_REGULAR_DAMAGE, outer), inner: Math.max(MIN_REGULAR_DAMAGE, inner) };
}

// ---------- (5) 通用伤害调整 ----------

/** 点穴每层 +10% 内伤，破绽每层 +10% 外伤；下限 20% */
export function calcGeneralAdjust(defender: FighterState, part: AnyPart): { outer: number; inner: number } {
  if (!isBodyPart(part)) return { outer: 1000, inner: 1000 };
  const w = defender.wounds[part];
  return { outer: Math.max(200, 1000 + w.weakness * 100), inner: Math.max(200, 1000 + w.acupoints * 100) };
}

// ---------- 全链路 ----------

export interface DamageChainOpts {
  source: DamageSource;
  stance?: StanceType;
  channel: HitChannel;
  part: AnyPart;
  grade: 1 | 2 | 3;
  /** 普攻威力（千分比） */
  power?: number;
  changeMoveSuccess?: boolean;
  art?: TechniqueData;
  tenths?: number;
}

function sideOf(state: CombatState, f: FighterState): 0 | 1 {
  return state.fighters[0] === f ? 0 : 1;
}

export function logCalc(state: CombatState, calc: DamageCalc): void {
  state.calcs.push(calc);
  if (state.calcs.length > CALC_LOG_MAX) state.calcs.splice(0, state.calcs.length - CALC_LOG_MAX);
  state.events.emit('damage', calc);
}

/** §5.9 完整伤害链 (1)-(6)，返回逐步记录 */
export function resolveDamageChain(state: CombatState, atk: FighterState, def: FighterState, o: DamageChainOpts): DamageCalc {
  const weapon = getCombatWeapon(atk);
  const defWeapon = getCombatWeapon(def);
  const steps: DamageCalc['steps'] = [];
  const isTech = !!o.art;
  const changeOk = !!o.changeMoveSuccess;

  // (1)
  const ir = calcInnerRatio(weapon, statOf(atk, 'neigongPlay'), o.art?.innerRatioBase);
  const innerRatio = ir.finalRatio;
  steps.push({ label: '内伤比例', value: innerRatio });

  // (2)
  const armorMult = calcArmorMult(
    statOf(atk, 'armorPenetration') + weapon.armorBreak,
    statOf(def, 'armorToughness') + defWeapon.toughness, changeOk,
  );
  steps.push({ label: '外伤破甲倍率', value: armorMult.outer }, { label: '内伤破甲倍率', value: armorMult.inner });

  // (3)
  const cap = (isTech ? 3000 : 2000) + modSum(atk, 'penetrationCap');
  const pAtk = { outer: statOf(atk, 'penetrateOuter') + weapon.penetrate.outer, inner: statOf(atk, 'penetrateInner') + weapon.penetrate.inner };
  const pDef = { outer: statOf(def, 'protection'), inner: statOf(def, 'qiControl') };
  const penMult = {
    outer: calcPenetrationMult(pAtk.outer, pDef.outer, innerRatio, !isTech, cap),
    inner: calcPenetrationMult(pAtk.inner, pDef.inner, innerRatio, !isTech, cap),
  };
  steps.push({ label: '破体倍率', value: penMult.outer }, { label: '破气倍率', value: penMult.inner });

  // (4)
  const dealOuter = Math.max(0, statOf(atk, 'dealOuter') * 10 + modSum(atk, 'dealOuterPermille'));
  const dealInner = Math.max(0, statOf(atk, 'dealInner') * 10 + modSum(atk, 'dealInnerPermille'));
  const power = o.power ?? 1000;
  const artAdjust = o.art?.artAdjust ?? 1000;
  const regular = o.art
    ? calcTechniqueDamage(weapon.baseDamage, o.art.damage, innerRatio, armorMult, dealOuter, dealInner, penMult,
      artAdjust, (o.tenths ?? 10) * 100, def.statMods.some(x => x.stat === 'protectLife'))
    : calcNormalAttackDamage(weapon.baseDamage, innerRatio, armorMult, dealOuter, dealInner, penMult, power);
  steps.push({ label: '常规外伤', value: regular.outer }, { label: '常规内伤', value: regular.inner });

  // (5) 守御
  const isSpirit = o.part === 'spirit';
  const isPoison = o.part === 'poison';
  const guardMaxBefore = Math.max(1, def.guardMax);
  const g = resolveGuard(state, def, regular.outer + regular.inner, state.distance, isSpirit, isPoison);
  let focusGained = 0;
  if (g.guardDamage > 0) {
    focusGained += addFocusFrom(def, state.battleType, Math.floor(Math.min(g.guardDamage, guardMaxBefore) * 100 / guardMaxBefore));
  }
  if (g.brokeNow) triggerEffects(state, sideOf(state, def), 'onGuardBroken', { part: o.part });
  steps.push({ label: '对守御伤害', value: g.guardDamage });

  const generalAdjust = calcGeneralAdjust(def, o.part);
  const directAdjust = 1000;
  const woundsCreated: Wound[] = [];
  let final = { outer: 0, inner: 0 };

  if (!g.absorbed) {
    // (6)
    final = {
      outer: Math.floor(regular.outer * generalAdjust.outer / 1000 * directAdjust / 1000),
      inner: Math.floor(regular.inner * generalAdjust.inner / 1000 * directAdjust / 1000),
    };
    const wound = createWound(o.part, final.outer, final.inner, o.grade);
    applyWound(state, def, wound);
    woundsCreated.push(wound);
    const t = defeatThreshold(state.battleType);
    const pct = Math.floor(Math.max(wound.outer, wound.inner) * 100 / t);
    focusGained += addFocusFrom(def, state.battleType, pct);
    const bucket = Math.floor(state.distance);
    def.memory.damageByDistance[bucket] = (def.memory.damageByDistance[bucket] ?? 0) + wound.outer + wound.inner;
    triggerEffects(state, sideOf(state, def), 'onWound', { part: o.part });
    if (o.source !== 'reflect' && o.source !== 'true') resolveReflect(state, def, atk, final, o.art ? 'technique' : 'attack');
    checkEnd(state);
  }
  steps.push({ label: '最终外伤', value: final.outer }, { label: '最终内伤', value: final.inner });

  const calc: DamageCalc = {
    attacker: atk.id, defender: def.id, source: o.source, artId: o.art?.id, stance: o.stance,
    part: o.part, channel: o.channel, grade: o.grade, changeMoveSuccess: changeOk,
    innerRatio, armorMult,
    penetration: { atk: pAtk, def: pDef, mult: penMult },
    weaponBase: weapon.baseDamage, artBase: o.art?.damage ?? 0,
    dealMult: { outer: dealOuter, inner: dealInner }, power, artAdjust, tenths: o.tenths,
    regular, guardDamage: g.guardDamage, absorbedByGuard: g.absorbed,
    generalAdjust, directAdjust, final, woundsCreated, focusGained, steps,
  };
  logCalc(state, calc);
  return calc;
}

/** 直接伤害（反震/真实伤害）：跳过 (1)-(5)，直接成伤口 */
export function applyDirectDamage(
  state: CombatState, target: FighterState, dmg: { outer: number; inner: number }, part: AnyPart = 'chest', grade: 1 | 2 | 3 = 1,
): Wound {
  const wound = createWound(part, dmg.outer, dmg.inner, grade);
  applyWound(state, target, wound);
  checkEnd(state);
  return wound;
}
