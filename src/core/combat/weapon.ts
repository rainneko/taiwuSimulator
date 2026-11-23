import type { FighterState, HitChannel, StanceType, WeaponClass } from './types';
import { statOf } from './stats';

/** 武器在战斗中的完整属性（WeaponDef + 人物属性缺省值预计算） */
export interface CombatWeapon {
  defId: string;
  family: WeaponClass;
  baseDamage: number;
  range: [number, number];
  speedClass: number;
  weight: number;
  wheel: StanceType[];
  hit: Record<HitChannel, number>;
  penetrate: { outer: number; inner: number };
  armorBreak: number;
  toughness: number;
  innerRatioBase: number;
  neigongConv: number;
  chaseCoef: number;
  changeCoef: number;
}

export const DEFAULT_CHASE_COEF = 30;
export const DEFAULT_CHANGE_COEF = 30;
export const DEFAULT_NEIGONG_CONV = 10;

export function getCombatWeapon(f: FighterState): CombatWeapon {
  const w = f.weapons.find(x => x.id === f.weaponId) ?? f.weapons[0]!;
  return {
    defId: w.id,
    family: w.weaponClass,
    baseDamage: w.power,
    range: [w.rangeMin, w.rangeMax],
    speedClass: w.baseSpeed,
    weight: w.weight,
    wheel: w.wheel,
    hit: { power: w.hitBonus?.power ?? 0, speed: w.hitBonus?.speed ?? 0, skill: w.hitBonus?.skill ?? 0 },
    penetrate: w.penetrate ?? { outer: 0, inner: 0 },
    armorBreak: w.armorBreak ?? 0,
    toughness: w.toughness ?? 0,
    innerRatioBase: w.innerRatioBase ?? f.stats.innerDamageRatio * 10,
    neigongConv: w.neigongConv ?? DEFAULT_NEIGONG_CONV,
    chaseCoef: w.chaseCoef ?? DEFAULT_CHASE_COEF,
    changeCoef: w.changeCoef ?? DEFAULT_CHANGE_COEF,
  };
}

/** 攻击间隔(帧) = ceil((speedClass + 重量×100) / floor(30 + 60 × 攻速% / 100)) */
export function calcAttackInterval(speedClass: number, weight: number, attackSpeedPct: number): number {
  const base = speedClass + weight * 100;
  const divisor = Math.max(1, Math.floor(30 + 60 * attackSpeedPct / 100));
  return Math.ceil(base / divisor);
}

/** 武器切换冷却总量；每帧减 (550 - 重量×50) × 兵器切换效率% */
export const WEAPON_SWITCH_TOTAL = 30000;

export function weaponSwitchRate(f: FighterState): number {
  const w = getCombatWeapon(f);
  return Math.max(1, Math.floor((550 - w.weight * 50) * statOf(f, 'weaponSwitch') / 100));
}

export function tickWeaponSwitch(f: FighterState): void {
  if (f.weaponSwitchCooldown <= 0) return;
  f.weaponSwitchCooldown = Math.max(0, f.weaponSwitchCooldown - weaponSwitchRate(f));
}
