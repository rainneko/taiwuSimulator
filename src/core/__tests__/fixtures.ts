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
