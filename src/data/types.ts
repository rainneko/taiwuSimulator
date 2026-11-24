/**
 * 游戏内容数据表的 schema。
 *
 * 原则：战斗相关字段直接复用 `core/combat/types.ts` 的定义（交叉类型），
 * 不另起一套。加载后的武器条目本身就是 WeaponDef，攻击功法本身就是 TechniqueData，
 * 可直接塞进 FighterConfig.weapons / CombatConfig.arts。
 *
 * 品阶口径（物品与功法统一）：1 = 一品（最高）… 9 = 九品（最低），对应原版「下·九阶」等。
 * 注意原版 Item 表的品级字段是反向的（1 最低），导入时要换算：品阶 = 10 − 原值。
 */
import type {
  AIConfig, EffectSpec, FighterStats, GuardSkillData, HitChannel,
  MovementArtData, TechniqueData, WeaponDef,
} from '../core/combat/types';

/** 1（一品）… 9（九品） */
export type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 战斗属性加成（运功效果、装备加成等），键与 FighterStats 一致 */
export type StatBonus = Partial<Record<keyof FighterStats, number>>;

// ============================================================
// 技艺（16 种）
// ============================================================

export const SKILL_KEYS = [
  'music', 'chess', 'poetry', 'painting', 'math', 'appraisal',
  'forging', 'woodworking', 'medicine', 'toxicology', 'weaving', 'artisan',
  'taoism', 'buddhism', 'cooking', 'eclectic',
] as const;
/** 音律/弈棋/诗书/绘画/术数/品鉴/锻造/制木/医术/毒术/织锦/巧匠/道法/佛学/厨艺/杂学 */
export type SkillKey = typeof SKILL_KEYS[number];

/** 技艺大类：雅艺（琴棋书画数鉴）/ 工艺（锻木医毒织巧）/ 杂艺（道佛厨杂） */
export type SkillGroup = 'refined' | 'craft' | 'misc';

export interface SkillDef {
  id: SkillKey;
  name: string;
  group: SkillGroup;
  description?: string;
  /** 该技艺对应的书籍物品 id（技艺书一至九品） */
  bookIds?: string[];
}

// ============================================================
// 物品
// ============================================================

export type ItemType =
  | 'weapon' | 'armor' | 'accessory'
  | 'medicine' | 'poison' | 'book'
  | 'material' | 'food' | 'tea' | 'wine' | 'tool' | 'misc';

export interface ItemBase {
  id: string;
  name: string;
  type: ItemType;
  grade: Grade;
  /** 原版 Data:EA/Item 的数字 id */
  originalId?: number;
  description?: string;
  /** 价值（银钱） */
  value?: number;
  /** 最大耐久 */
  durability?: number;
  tags?: string[];
}

/**
 * 武器：ItemBase ∩ WeaponDef。条目本身即可作为 WeaponDef 使用。
 * `weight` 两边同义（重量，与 calcAttackInterval 的单位一致）。
 */
export interface WeaponItemDef extends ItemBase, WeaponDef {
  type: 'weapon';
  /** 原版细分类，如 长剑/重剑/重刀/木棍 */
  subType?: string;
  /** 原版的力道/迅疾/精妙命中占比（%），未接入战斗公式前仅作记录 */
  hitRatio?: Record<HitChannel, number>;
}

export type ArmorSlot = 'head' | 'body' | 'hands' | 'feet';

export interface ArmorItemDef extends ItemBase {
  type: 'armor';
  slot: ArmorSlot;
  /** 护甲坚韧 */
  toughness: number;
  /** 外伤/内伤防护（千分比） */
  guard: { outer: number; inner: number };
  bonus?: StatBonus;
}

export interface AccessoryItemDef extends ItemBase {
  type: 'accessory';
  bonus?: StatBonus;
  effects?: EffectSpec[];
}

export interface MedicineItemDef extends ItemBase {
  type: 'medicine';
  /** 疗伤量：外伤/内伤 */
  heal?: { outer: number; inner: number };
  /** 解毒：毒种 → 解除量 */
  cure?: Record<string, number>;
  bonus?: StatBonus;
  /** 加成持续（时节或帧，由使用方解释） */
  duration?: number;
}

export interface PoisonItemDef extends ItemBase {
  type: 'poison';
  /** 烈毒/郁毒/寒毒/赤毒/腐毒/幻毒 */
  poisonType: string;
  amount: number;
}

export type BookTeaches =
  | { kind: 'technique'; techniqueId: string }
  | { kind: 'skill'; skill: SkillKey };

export interface BookItemDef extends ItemBase {
  type: 'book';
  teaches: BookTeaches;
  /** 篇数（原版 5 篇：1 总纲 + 4 正逆练） */
  pages?: number;
}

export interface GenericItemDef extends ItemBase {
  type: 'material' | 'food' | 'tea' | 'wine' | 'tool' | 'misc';
  bonus?: StatBonus;
}

export type ItemDef =
  | WeaponItemDef | ArmorItemDef | AccessoryItemDef
  | MedicineItemDef | PoisonItemDef | BookItemDef | GenericItemDef;

/** 由 type 取对应条目类型：ItemOfType<'weapon'> = WeaponItemDef */
export type ItemOfType<T extends ItemType> = Extract<ItemDef, { type: T }>;

// ============================================================
// 武学 / 功法
// ============================================================

/** 原版 14 种功法类型 */
export type ArtCategory =
  | 'neigong'   // 内功
  | 'movement'  // 身法
  | 'ultimate'  // 绝技
  | 'fist'      // 拳掌
  | 'finger'    // 指法
  | 'leg'       // 腿法
  | 'hidden'    // 暗器
  | 'sword'     // 剑法
  | 'blade'     // 刀法
  | 'polearm'   // 长兵
  | 'exotic'    // 奇门
  | 'whip'      // 软兵
  | 'archery'   // 御射
  | 'instrument'; // 乐器

/** 纯阳/金刚/玄阴/紫霞/归元 + 混元 */
export type ArtElement = 'yang' | 'vajra' | 'yin' | 'purple' | 'return' | 'mixed';

/** 运行时分派用：摧破（含腿法）/ 护体绝技 / 身法 / 内功 */
export type TechniqueKind = 'destroy' | 'guard' | 'movement' | 'neigong';

export interface TechniqueBase {
  id: string;
  name: string;
  kind: TechniqueKind;
  category: ArtCategory;
  grade: number;
  element?: ArtElement;
  /** 所属门派 FactionDef.id；无门派（江湖/外道）则省略 */
  factionId?: string;
  originalId?: number;
  description?: string;
  /** 占格 */
  slots?: number;
  /** 发挥上限（%） */
  playCap?: number;
  /** 运功效果：装备即得的加成 */
  equipBonus?: StatBonus;
  /** 发挥需求：资质/属性/技艺名 → 需求值（键用原版中文名） */
  requirements?: Record<string, number>;
  /** 心法正练 / 逆练 文本（效果 DSL 落地前先存文本） */
  heartMethod?: { normal?: string; reversed?: string };
}

/** 摧破功法（含腿法）：本身即 TechniqueData */
export interface AttackTechniqueDef extends TechniqueBase, Omit<TechniqueData, 'name' | 'grade'> {
  kind: 'destroy';
  /** 穿透：破体/破气 */
  penetrate?: { outer: number; inner: number };
}

/** 护体绝技：本身即 GuardSkillData */
export interface GuardTechniqueDef extends TechniqueBase, Omit<GuardSkillData, 'name'> {
  kind: 'guard';
}

/** 身法：本身即 MovementArtData */
export interface MovementTechniqueDef extends TechniqueBase, Omit<MovementArtData, 'name'> {
  kind: 'movement';
}

/** 内功：只提供被动加成与特效 */
export interface NeigongTechniqueDef extends TechniqueBase {
  kind: 'neigong';
  /** 内力（真气）上限加成 */
  neili?: number;
  effects?: EffectSpec[];
}

export type TechniqueDef =
  | AttackTechniqueDef | GuardTechniqueDef | MovementTechniqueDef | NeigongTechniqueDef;

export type TechniqueOfKind<K extends TechniqueKind> = Extract<TechniqueDef, { kind: K }>;

// ============================================================
// 门派
// ============================================================

/** 处世立场：刚正/仁善/中庸/叛逆/唯我 */
export type Alignment = 'upright' | 'benevolent' | 'neutral' | 'rebel' | 'egoist';

export interface FactionDef {
  id: string;
  name: string;
  originalId?: number;
  description?: string;
  /** 所在地区 id（大地图省份） */
  regionId?: string;
  /** 主流立场 */
  alignment?: Alignment;
  /** 门派根基技艺（如少林→佛学、武当→道法） */
  coreSkill?: SkillKey;
  /** 可教功法 id（按品阶由低到高） */
  techniqueIds: string[];
  /** 好感度系数（千分比，1000 = 原值）：互动/赠礼对该派门人好感的倍率 */
  favorCoef: number;
  /** 门规与特殊限制（文本，规则系统落地前先存） */
  rules?: string[];
}

// ============================================================
// NPC 模板
// ============================================================

/** 六项主要属性：膂力/体质/灵敏/根骨/悟性/定力 */
export const MAIN_ATTRS = ['strength', 'constitution', 'agility', 'bone', 'intellect', 'focus'] as const;
export type MainAttr = typeof MAIN_ATTRS[number];

export type Range = [min: number, max: number];

export interface NpcTemplate {
  id: string;
  /** 称号/类型名，如 山贼、少林武僧 */
  name: string;
  factionId?: string;
  /** 身份品阶范围（1 最高 … 9 最低） */
  rankRange?: Range;
  ageRange?: Range;
  attributes: Partial<Record<MainAttr, Range>>;
  /** 直接覆盖的战斗属性（未建属性→战斗属性换算前的过渡） */
  combatStats?: Partial<FighterStats>;
  techniqueIds: string[];
  equipment: {
    /** 武器 item id，第一把为初始武器，最多 3 把 */
    weapons: string[];
    armor?: string[];
    items?: string[];
  };
  /** 战斗 AI */
  ai: AIConfig;
}

// ============================================================
// 数据包（JSON 文件与 stub 共用的形状）
// ============================================================

export interface GameDataBundle {
  items: ItemDef[];
  techniques: TechniqueDef[];
  factions: FactionDef[];
  npcs: NpcTemplate[];
  skills: SkillDef[];
}

export type TableName = keyof GameDataBundle;
export const TABLE_NAMES: readonly TableName[] = ['items', 'techniques', 'factions', 'npcs', 'skills'];
