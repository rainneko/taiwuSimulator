import { BODY_PARTS, type BodyPart, type FighterConfig, type FighterState, type FighterStats, type WeaponDef, type WoundState } from './types';
import { DEFAULT_STANCE_SLOTS } from './stance';
import { recomputeAttackInterval } from './attack';

export const DEFAULT_STATS: FighterStats = {
  attackSpeed: 100,
  hitPower: 100, hitSpeed: 100, hitSkill: 100,
  dodgeDeflect: 100, dodgeEvade: 100, dodgeParry: 100,
  protection: 100, qiControl: 100, guardEfficiency: 100,
  armorToughness: 0, armorPenetration: 0,
  innerDamageRatio: 50, dealInner: 100, dealOuter: 100,
  luck: 0, courage: 0, chaseCoef: 30, changeMoveCoef: 30,
  penetrateOuter: 100, penetrateInner: 100, neigongPlay: 0, innerBreath: 100,
  castSpeed: 100, weaponSwitch: 100,
};

export const DEFAULT_FLEE_FRAMES = 180;

function emptyWounds(): Record<BodyPart, WoundState> {
  const w = {} as Record<BodyPart, WoundState>;
  for (const p of BODY_PARTS) w[p] = { inner: 0, outer: 0, acupoints: 0, weakness: 0 };
  return w;
}

export function equipWeapon(f: FighterState, w: WeaponDef): void {
  f.weaponId = w.id;
  f.weaponClass = w.weaponClass;
  f.weaponRangeMin = w.rangeMin;
  f.weaponRangeMax = w.rangeMax;
  f.weaponPower = w.power;
  f.wheelSlots = w.wheel.slice(0, 6);
  f.wheelIndex = 0;
  f.attackProgress = 0;
  recomputeAttackInterval(f);
}

export function createFighterState(fc: FighterConfig, startDistance: number): FighterState {
  const w0 = fc.weapons[0];
  if (!w0) throw new Error(`fighter ${fc.id} has no weapon`);
  const f: FighterState = {
    id: fc.id, name: fc.name,
    position: 0,
    targetDistance: fc.targetDistance ?? startDistance,
    attackProgress: 0, attackInterval: 1, attackPhase: 'outOfRange',
    moveProgress: 0,
    moveSpeed: fc.moveSpeed ?? 100,
    moveDistance: fc.moveDistance ?? 0.5,
    movementPoints: 0, movementPointTimer: 0,
    bodyMovementPoints: 0, bodyMovementDecay: 0,
    breath: 0, stance: 0,
    breathStanceSpeed: fc.breathStanceSpeed ?? 1,
    stances: [],
    stanceSlotCapacity: fc.stanceSlotCapacity ?? DEFAULT_STANCE_SLOTS,
    wheelSlots: [], wheelIndex: 0,
    guard: 0, guardMax: 0,
    focus: 0,
    wounds: emptyWounds(),
    totalInner: 0, totalOuter: 0,
    castPhase: 'none', castSkillId: null, castProgress: 0, castTotal: 0,
    guardSkillPhase: 'off', guardSkillId: null, guardSkillRemain: 0,
    fleePhase: 'none', fleeProgress: 0,
    fleeThreshold: fc.fleeThreshold ?? DEFAULT_FLEE_FRAMES,
    weaponId: w0.id, weaponClass: w0.weaponClass,
    weaponRangeMin: w0.rangeMin, weaponRangeMax: w0.rangeMax, weaponPower: w0.power,
    weaponSwitchCooldown: 0,
    weapons: fc.weapons.slice(0, 3).map(w => ({ ...w, wheel: w.wheel.slice() })),
    stats: { ...DEFAULT_STATS, ...fc.stats },
    isFirst: false,
    changeMeter: 0, changeMovePref: null, guardBroken: false,
    specialWounds: { spirit: { inner: 0, outer: 0 }, poison: { inner: 0, outer: 0 }, whole: { inner: 0, outer: 0 } },
    woundLog: [],
    castKind: null, statMods: [],
    passiveEffects: (fc.effects ?? []).slice(),
    arts: (fc.arts ?? []).slice(),
    memory: { artResults: {}, damageByDistance: {} },
    poison: {},
    bodyMovementDecayInterval: 0,
  };
  equipWeapon(f, w0);
  return f;
}
