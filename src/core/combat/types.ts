import type { PCG32 } from '../rng';
import type { EventBus } from '../EventBus';

// === 枚举与常量 ===

export const BODY_PARTS = ['chest', 'waist', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
export type BodyPart = typeof BODY_PARTS[number];
export const SPECIAL_PARTS = ['spirit', 'poison', 'whole'] as const;
export type SpecialPart = typeof SPECIAL_PARTS[number];
export type AnyPart = BodyPart | SpecialPart;

/** 力道/迅疾/精妙 */
export type HitChannel = 'power' | 'speed' | 'skill';
export const HIT_CHANNELS: readonly HitChannel[] = ['power', 'speed', 'skill'];
/** 卸力/闪避/拆招 */
export type DodgeChannel = 'deflect' | 'evade' | 'parry';
export const HIT_DODGE_MAP: Record<HitChannel, DodgeChannel> = {
  power: 'deflect', speed: 'evade', skill: 'parry',
};

export type BattleType = 'spar' | 'accept' | 'fierce' | 'deathmatch';
/** 切磋50% / 接招50% / 恶战75% / 死斗100% */
export const DEFEAT_THRESHOLD: Record<BattleType, number> = {
  spar: 0.5, accept: 0.5, fierce: 0.75, deathmatch: 1.0,
};

/** 掷/劈/崩/弹/刺/点/缠/机/御/撩/拿/扫/音/咒/药/毒 + 万能/杀/无 */
export type StanceType =
  | 'throw' | 'chop' | 'crash' | 'flick' | 'stab' | 'dot'
  | 'wrap' | 'trick' | 'ward' | 'lift' | 'grab' | 'sweep'
  | 'sound' | 'curse' | 'medicine' | 'venom'
  | 'wild' | 'kill' | 'none';

export type WeaponClass = 'fist' | 'sword' | 'blade' | 'polearm' | 'exotic' | 'ranged';

export type FighterPhase = 'outOfRange' | 'charging' | 'striking';
export type CastPhase = 'none' | 'casting';
export type GuardPhase = 'off' | 'active';
export type FleePhase = 'none' | 'fleeing';
export type CombatPhase = 'prepare' | 'opening' | 'running' | 'paused' | 'choice' | 'animLock' | 'ended';

// === Fighter ===

export interface WoundState {
  inner: number;      // 内伤 0-100 (%)
  outer: number;      // 外伤 0-100 (%)
  acupoints: number;  // 点穴层数 0-10
  weakness: number;   // 破绽层数 0-10
}

export interface FighterStats {
  attackSpeed: number;
  hitPower: number;
  hitSpeed: number;
  hitSkill: number;
  dodgeDeflect: number;
  dodgeEvade: number;
  dodgeParry: number;
  protection: number;
  qiControl: number;
  guardEfficiency: number;
  armorToughness: number;
  armorPenetration: number;
  innerDamageRatio: number; // 0-100，伤害中内伤占比
  dealInner: number;        // 造成内伤 %
  dealOuter: number;        // 造成外伤 %
  luck: number;
  courage: number;
  chaseCoef: number;
  changeMoveCoef: number;
  /** 破体（攻方外伤穿透值） */
  penetrateOuter: number;
  /** 破气（攻方内伤穿透值） */
  penetrateInner: number;
  /** 内功发挥（正→偏内伤，负→偏外伤） */
  neigongPlay: number;
  /** 内息（连环奇击判定用） */
  innerBreath: number;
  /** 施展速度 % */
  castSpeed: number;
  /** 兵器切换效率 % */
  weaponSwitch: number;
}

export interface WeaponDef {
  id: string;
  weaponClass: WeaponClass;
  baseSpeed: number;        // WEAPON_SPEED_CLASS 中的值
  weight: number;
  rangeMin: number;
  rangeMax: number;
  power: number;            // 武器基础威力（伤害基数）
  /** 轮盘 6 格：该武器每次出手按顺序提供的式 */
  wheel: StanceType[];
  /** 基础内伤比例（千分比）；缺省取人物 innerDamageRatio×10 */
  innerRatioBase?: number;
  /** 内功发挥转化系数 */
  neigongConv?: number;
  /** 追击系数 5-60（≥125 必出 6 连） */
  chaseCoef?: number;
  /** 变招系数 */
  changeCoef?: number;
  /** 武器破甲 */
  armorBreak?: number;
  /** 武器坚韧 */
  toughness?: number;
  /** 武器附加命中 */
  hitBonus?: Partial<Record<HitChannel, number>>;
  /** 武器附加破体/破气 */
  penetrate?: { outer: number; inner: number };
}

// === WO2：伤口 / 伤害链记录 ===

export interface Wound {
  part: AnyPart;
  outer: number;   // 千分比
  inner: number;   // 千分比
  grade: 1 | 2 | 3;
  frame: number;
}

export type DamageSource = 'attack' | 'chase' | 'combo' | 'counter' | 'technique' | 'reflect' | 'true';

export interface DamageCalc {
  attacker: string;
  defender: string;
  source: DamageSource;
  artId?: string;
  stance?: StanceType;
  part: AnyPart;
  channel: HitChannel;
  grade: 1 | 2 | 3;
  changeMoveSuccess: boolean;
  innerRatio: number;
  armorMult: { outer: number; inner: number };
  penetration: { atk: { outer: number; inner: number }; def: { outer: number; inner: number }; mult: { outer: number; inner: number } };
  weaponBase: number;
  artBase: number;
  dealMult: { outer: number; inner: number };
  power: number;
  artAdjust: number;
  tenths?: number;
  regular: { outer: number; inner: number };
  guardDamage: number;
  absorbedByGuard: boolean;
  generalAdjust: { outer: number; inner: number };
  directAdjust: number;
  final: { outer: number; inner: number };
  woundsCreated: Wound[];
  focusGained: number;
  steps: { label: string; value: number }[];
}

// === WO3：功法数据 ===

export interface StanceCost { type: StanceType; count: number }

export interface TechniqueData {
  id: string;
  name?: string;
  type: 'destroy' | 'leg';
  grade: number;
  stanceCost: StanceCost[];
  /** 腿法：耗移动力 */
  mobilityCost?: number;
  gaugeTotal: number;   // 提气+架势总消耗（千分比，1000=各自全部按 breathShare 分配）
  breathShare: number;  // 提气占比（千分比）
  castTime: number;     // 最大施展时间
  hit: Record<HitChannel, number>; // 10 成分配
  damage: number;
  innerRatioBase: number;
  range: { mode: 'weaponPlus'; delta: number } | { mode: 'fixed'; min: number; max: number };
  partWeights: Partial<Record<BodyPart, number>>;
  /** 功法伤害调整（千分比，缺省 1000） */
  artAdjust?: number;
  effects?: EffectSpec[];
}

export interface GuardSkillData {
  id: string;
  name?: string;
  gaugeTotal: number;
  breathShare: number;
  castTime: number;
  duration: number;
  guardFlat: { outer: number; inner: number };
  guardPct: { outer: number; inner: number };
  avoid: { absorb: number; parry: number; dodge: number };
  counter?: { range: [number, number]; power: number; channel: HitChannel };
  reflect?: { outer: number; inner: number };
}

export interface MovementArtData {
  id: string;
  name?: string;
  castTime: number;
  mobilityCost: number;
  moveSpeed: number;  // 千分比倍率
  moveStep: number;   // 千分比倍率
  grant: { count: number; decayFrames: number };
}

export interface ArtRegistry {
  techniques: Record<string, TechniqueData>;
  guardSkills: Record<string, GuardSkillData>;
  movementArts: Record<string, MovementArtData>;
}

// === WO3：特效 DSL ===

export type EffectTrigger =
  | 'onAttackHit' | 'onAttackDodged' | 'onChangeMoveSuccess' | 'onTechniqueCast'
  | 'onTechniqueResolved' | 'onGuardBroken' | 'onCounter' | 'onWound'
  | 'everyNFrames' | 'onStanceGained' | 'onCombatStart' | 'onDefeat';

export type EffectCondition =
  | { type: 'distanceRange'; min: number; max: number }
  | { type: 'partHasSeal'; part: BodyPart }
  | { type: 'partHasFlaw'; part: BodyPart }
  | { type: 'tenthsGte'; value: number }
  | { type: 'stanceCountGte'; value: number }
  | { type: 'breathDisorder'; level: number }
  | { type: 'guardBroken' }
  | { type: 'healthBelow'; threshold: number };

export type EffectOp =
  | { type: 'modStat'; stat: string; value: number; duration: number }
  | { type: 'addSeal'; part: BodyPart | 'target'; layers: number }
  | { type: 'addFlaw'; part: BodyPart | 'target'; layers: number }
  | { type: 'grantStance'; stance: StanceType; count: number }
  | { type: 'removeStance'; target: 'self' | 'enemy'; count: number }
  | { type: 'modProgress'; bar: 'breath' | 'posture' | 'attack' | 'move'; delta: number }
  | { type: 'trueDamage'; part: BodyPart; amount: number }
  | { type: 'modMultCap'; stat: 'penetrationCap'; value: number; duration: number }
  | { type: 'bypassDualFull'; duration: number }
  | { type: 'modDealDamage'; outer: number; inner: number; duration: number }
  | { type: 'heal'; part: BodyPart; amount: number }
  | { type: 'addPoison'; poisonType: string; amount: number };

export interface EffectSpec {
  id: string;
  trigger: EffectTrigger;
  /** everyNFrames 的间隔 */
  interval?: number;
  when?: EffectCondition[];
  ops: EffectOp[];
}

export interface StatMod { stat: string; value: number; remain: number; source: string }

export interface CombatMemory {
  artResults: Record<string, { casts: number; bestTenths: number }>;
  /** 按距离桶（floor(d)）累计我受到的伤势 */
  damageByDistance: Record<number, number>;
}

// === WO3：AI ===

export interface AIConfig {
  difficulty: 0 | 1 | 2 | 3;
  personality?: { brave: number; calm: number };
}

export interface FighterState {
  id: string;
  name: string;

  position: number;
  targetDistance: number;

  attackProgress: number;
  attackInterval: number;
  attackPhase: FighterPhase;

  moveProgress: number;
  moveSpeed: number;
  moveDistance: number;
  movementPoints: number;
  movementPointTimer: number;
  bodyMovementPoints: number;
  bodyMovementDecay: number;

  breath: number;
  stance: number;
  breathStanceSpeed: number;
  stances: StanceType[];
  stanceSlotCapacity: number;
  wheelSlots: StanceType[];
  wheelIndex: number;

  guard: number;
  guardMax: number;

  focus: number;

  wounds: Record<BodyPart, WoundState>;
  totalInner: number;
  totalOuter: number;

  castPhase: CastPhase;
  castSkillId: string | null;
  castProgress: number;
  castTotal: number;

  guardSkillPhase: GuardPhase;
  guardSkillId: string | null;
  guardSkillRemain: number;

  fleePhase: FleePhase;
  fleeProgress: number;
  fleeThreshold: number;

  weaponId: string;
  weaponClass: WeaponClass;
  weaponRangeMin: number;
  weaponRangeMax: number;
  weaponPower: number;
  weaponSwitchCooldown: number;
  /** 可切换的武器（最多3把） */
  weapons: WeaponDef[];

  stats: FighterStats;
  isFirst: boolean;

  // --- WO2 ---
  /** 变招 PRD 累计值 */
  changeMeter: number;
  /** 玩家预设的变招部位（null = 自动） */
  changeMovePref: BodyPart | null;
  guardBroken: boolean;
  /** 心神/毒质/全身伤势 */
  specialWounds: Record<SpecialPart, { inner: number; outer: number }>;
  woundLog: Wound[];

  // --- WO3 ---
  castKind: 'technique' | 'guard' | 'movement' | null;
  statMods: StatMod[];
  /** 被动特效（来自装备/内功等） */
  passiveEffects: EffectSpec[];
  /** 已掌握的功法 id（摧破/护体/身法） */
  arts: string[];
  memory: CombatMemory;
  poison: Record<string, number>;
  /** 身法移动力衰减间隔 */
  bodyMovementDecayInterval: number;
}

// === Config ===

export interface FighterConfig {
  id: string;
  name: string;
  stats?: Partial<FighterStats>;
  weapons: WeaponDef[];      // 第一把为初始武器
  moveSpeed?: number;
  moveDistance?: number;
  breathStanceSpeed?: number;
  stanceSlotCapacity?: number;
  targetDistance?: number;
  fleeThreshold?: number;
  arts?: string[];
  effects?: EffectSpec[];
}

export interface CombatConfig {
  seed: bigint;
  battleType?: BattleType;
  startDistance?: number;
  fighters: [FighterConfig, FighterConfig];
  arts?: Partial<ArtRegistry>;
  ai?: [AIConfig | null, AIConfig | null];
}

// === Events ===

export type CombatEventMap = {
  attackStart: { actorId: string; targetId: string; frame: number };
  hit: { actorId: string; targetId: string; part: BodyPart; severity: 1 | 2 | 3; damage: number; channel: HitChannel };
  dodge: { actorId: string; targetId: string; channel: HitChannel };
  changeMove: { actorId: string; part: BodyPart; success: boolean };
  chase: { actorId: string; hitIndex: number };
  techniqueCastStart: { actorId: string; skillId: string; totalFrames: number };
  techniqueStage: { actorId: string; skillId: string; stage: 1 | 2 | 3 | 4; hits: number };
  guardBroken: { actorId: string };
  counter: { actorId: string; targetId: string };
  wound: { actorId: string; part: BodyPart; inner: number; outer: number };
  flee: { actorId: string; success: boolean };
  end: { winnerId: string | null; reason: string };
  moveStep: { actorId: string; from: number; to: number };
  resourceChange: { actorId: string; type: 'breath' | 'stance' | 'guard' | 'focus'; value: number };
  stanceGained: { actorId: string; stance: StanceType };
  weaponSwitch: { actorId: string; weaponId: string };
  damage: DamageCalc;
  techniqueResolved: { actorId: string; skillId: string; totalTenths: number };
  techniqueWhiff: { actorId: string; skillId: string };
  guardSkillStart: { actorId: string; skillId: string };
  movementArt: { actorId: string; skillId: string };
  comboStrike: { actorId: string };
  reflect: { actorId: string; targetId: string; outer: number; inner: number };
};

export type CombatEvent = { [K in keyof CombatEventMap]: { type: K; payload: CombatEventMap[K] } }[keyof CombatEventMap];

// === State ===

export interface CombatState {
  phase: CombatPhase;
  battleType: BattleType;
  frame: number;
  animLock: number;
  choiceWindow: number;
  fighters: [FighterState, FighterState];
  distance: number;
  seed: bigint;
  rng: PCG32;
  events: EventBus<CombatEventMap>;
  /** step() 调用次数（含暂停/动画锁帧），回放以此对齐 */
  stepCount: number;
  /** 记录 (step 序号, 指令)，用于回放 */
  commandLog: { step: number; action: CombatAction }[];
  // --- WO2/WO3 ---
  arts: ArtRegistry;
  ai: [AIRuntime | null, AIRuntime | null];
  /** 最近的伤害链记录（环形，最多 CALC_LOG_MAX 条） */
  calcs: DamageCalc[];
  /** 本次普攻回合中守方是否触发了反击 */
  counterTriggered: boolean;
}

export interface AIRuntime extends AIConfig {
  personality: { brave: number; calm: number };
}

// === Commands ===

export type CombatAction =
  | { type: 'setTargetDistance'; actorId: string; delta: number }
  | { type: 'castTechnique'; actorId: string; skillId: string; castFrames?: number }
  | { type: 'activateGuardSkill'; actorId: string; skillId: string; durationFrames?: number }
  | { type: 'switchWeapon'; actorId: string; weaponId: string }
  | { type: 'changeMove'; actorId: string; part: BodyPart }
  | { type: 'flee'; actorId: string }
  | { type: 'pause' }
  | { type: 'resume' };
