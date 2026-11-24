import type { FighterStats, WeaponDef } from '../combat/types';
import { SKILL_KEYS } from '../../data/types';

/**
 * 角色数据模型（可直接 JSON 序列化进存档）。
 * 来源：旧/主要属性、docs/PLAN.md §3.1。
 * 武器直接存 WeaponDef（src/data 的 WeaponItemDef 即是）；衣甲/饰品与功法加成经 fromData.ts 从 GameDB 适配。
 */

// === 六维 ===

/** 膂力 体质 灵敏 根骨 悟性 定力 */
export const MAIN_ATTRS = ['str', 'con', 'agi', 'bone', 'int', 'res'] as const;
export type MainAttr = typeof MAIN_ATTRS[number];
export type MainAttrs = Record<MainAttr, number>;

// === 技艺 16 类 ===

/** 音律 弈棋 诗书 绘画 术数 品鉴 锻造 制木 医术 毒术 织锦 巧匠 道法 佛学 厨艺 杂学（与 src/data 的 SKILL_KEYS 同源） */
export const LIFE_SKILLS = SKILL_KEYS;
export type LifeSkillType = typeof LIFE_SKILLS[number];

// === 武学 ===

export interface LearnedTechnique {
  id: string;
  /** 修习度 0–100（%） */
  practice: number;
  /** 是否装入运功栏：只有运功中的功法提供运功效果、可在战斗中施展。占格上限待 Loadout 落地 */
  equipped?: boolean;
}

/**
 * 功法对角色的常驻加成（运功效果）。GameDB 的 TechniqueDef.equipBonus 经 techniqueLookupFromDB 转成此结构。
 * 加成按修习度线性折算（practice/100）。
 */
export interface TechniqueBonus {
  /** 六维附加值（固定值） */
  attrs?: Partial<MainAttrs>;
  /** 六维发挥加成（%，如 35 表示 +35%） */
  attrPerf?: Partial<MainAttrs>;
  /** 战斗属性固定加成 */
  stats?: Partial<FighterStats>;
}
export type TechniqueLookup = (id: string) => TechniqueBonus | undefined;

// === 装备 ===

export type WeaponSlot = 'main' | 'sub';

/** 衣甲/饰品的临时定义（等 src/data 的 ItemDef） */
export interface GearDef {
  id: string;
  name?: string;
  /** 1–9 品，9 最低 */
  grade?: number;
  weight?: number;
  /** 六维附加值（宝物加成） */
  attrs?: Partial<MainAttrs>;
  /** 六维发挥加成 %（防具随机词条） */
  attrPerf?: Partial<MainAttrs>;
  /** 战斗属性固定加成（护体/御气/化解等） */
  stats?: Partial<FighterStats>;
}

export interface Equipment {
  weaponMain: WeaponDef | null;
  weaponSub: WeaponDef | null;
  armor: GearDef | null;
  accessory: GearDef | null;
}

// === 角色 ===

export type Gender = 'm' | 'f';

export interface CharacterData {
  id: string;
  surname: string;
  given: string;
  gender: Gender;
  /** 外貌选项（向导 look 字段） */
  look: string;
  isPlayer: boolean;

  age: number;
  /** 寿命（岁）：超过即寿终 */
  lifespan: number;
  /** 健康：逢生日 −1，为 0 过月死亡。来源：旧/健康 */
  health: number;
  healthMax: number;
  /** 内息（连环奇击等判定），会随年龄下降。来源：旧/内息 */
  innerBreath: number;
  /** 内息紊乱 0–800，五档影响全属性发挥 */
  disorder: number;

  /** 六维人物基础值（不含装备/功法/特性） */
  attrs: MainAttrs;

  techniques: LearnedTechnique[];
  equipment: Equipment;
  lifeSkills: Record<LifeSkillType, number>;
  /** 好感：角色 id → 0–60000 */
  favor: Record<string, number>;
}

/** 新游戏向导参数（NewGameWizard 的 char 步骤字段；运行时是 Record<string, unknown>） */
export interface NewGameCharParams {
  surname?: string;
  given?: string;
  gender?: string;
  look?: string;
  age?: number;
  attrs?: Partial<Record<'str' | 'agi' | 'int' | 'con', number>>;
}
