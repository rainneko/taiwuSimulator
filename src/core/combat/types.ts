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
}

export interface CombatConfig {
  seed: bigint;
  battleType?: BattleType;
  startDistance?: number;
  fighters: [FighterConfig, FighterConfig];
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
