import type { CombatConfig, FighterConfig, WeaponDef } from '../combat/types';
import { WEAPON_SPEED_CLASS } from '../combat/attack';

export const SWORD: WeaponDef = {
  id: 'sword', weaponClass: 'sword', baseSpeed: WEAPON_SPEED_CLASS.normal, weight: 3,
  rangeMin: 2.0, rangeMax: 6.0, power: 1000, wheel: ['chop', 'stab', 'flick', 'chop', 'stab', 'wild'],
};
export const SPEAR: WeaponDef = {
  id: 'spear', weaponClass: 'polearm', baseSpeed: WEAPON_SPEED_CLASS.slow, weight: 6,
  rangeMin: 4.0, rangeMax: 9.0, power: 1400, wheel: ['stab', 'sweep', 'lift', 'stab', 'sweep', 'lift'],
};

export function fighter(id: string, extra: Partial<FighterConfig> = {}): FighterConfig {
  return { id, name: id, weapons: [SWORD, SPEAR], ...extra };
}

export function config(seed = 42n, extra: Partial<CombatConfig> = {}): CombatConfig {
  return { seed, fighters: [fighter('a'), fighter('b')], ...extra };
}

/** AI 对战基准用配置：武器基伤 150、护体/御气/破体/破气 300，平均时长落在 40-120 秒 */
export function benchFighter(id: string, arts: string[] = []): FighterConfig {
  const stats = { protection: 300, qiControl: 300, penetrateOuter: 300, penetrateInner: 300 };
  return { id, name: id, weapons: [{ ...SWORD, power: 150 }, { ...SPEAR, power: 210 }], stats, arts };
}
