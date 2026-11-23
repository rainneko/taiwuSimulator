import type { StanceType, WeaponClass } from '../../core/combat';

/** 核心引擎的式 → 原版 AttackTyp_Date id（见 assets/spine/mappings/weapon_attachment_map.json attack_types）。 */
export const STANCE_ATTACK_TYPE: Record<StanceType, number> = {
  throw: 0, flick: 1, ward: 2, chop: 3, stab: 4, lift: 5, crash: 6, dot: 7, grab: 8,
  sound: 9, wrap: 10, curse: 11, trick: 12, medicine: 13, venom: 14, sweep: 16,
  wild: 6, kill: 3, none: 6,
};

/** 原版 attack_types 里每个 id 的 A_ 动画前缀（anim_base_primary）。 */
const ATTACK_ANIM_BASE: Record<number, string> = {
  0: 'A_000_0', 1: 'A_001_0', 2: 'A_002_0', 3: 'A_003_0', 4: 'A_004_0', 5: 'A_005_0', 6: 'A_006_0',
  7: 'A_007_0', 8: 'A_008_0', 9: 'A_009_0', 10: 'A_010_0', 11: 'A_011_0', 12: 'A_012_0',
  13: 'A_013_0', 14: 'A_013_0', 16: 'A_010_1',
};

/** `A_<式>_<变体>_<0..5>`：_0.._5 各含 1 个 hit 事件，_6 为长动画（不用）。 */
export function normalAttackAnim(stance: StanceType, variant: number): string {
  const base = ATTACK_ANIM_BASE[STANCE_ATTACK_TYPE[stance]] ?? 'A_006_0';
  return `${base}_${((variant % 6) + 6) % 6}`;
}

/** 受击程度 → H_ 动画（H_000..H_006，按程度挑两档随机）。 */
export function hitAnim(severity: 1 | 2 | 3, variant: number): string {
  const pool = severity === 1 ? [0, 1] : severity === 2 ? [2, 3] : [4, 5, 6];
  return `H_00${pool[variant % pool.length]}`;
}

export const IDLE_ANIM = 'C_000';

/** 武器类型 → 挂件（weapon_attachment_map.json by_subtype 的代表项）。 */
export const WEAPON_ATTACHMENTS: Record<WeaponClass, { R: string; L: string }> = {
  fist: { R: 'Null', L: 'Null' },
  sword: { R: 'W_08_0', L: 'Null' },
  blade: { R: 'W_09_0', L: 'Null' },
  polearm: { R: 'W_10_0', L: 'Null' },
  exotic: { R: 'W_07', L: 'W_07' },
  ranged: { R: 'W_01', L: 'Null' },
};

/** skill_animation_map.json 的 skills 表（只取用得到的字段）。 */
export type SkillAnimTable = Record<string, { skill_anim?: string | null; stance?: string | null }>;

export async function loadSkillAnimTable(url = '/assets/spine/mappings/skill_animation_map.json'): Promise<SkillAnimTable> {
  const r = await fetch(url);
  return ((await r.json()) as { skills: SkillAnimTable }).skills;
}
