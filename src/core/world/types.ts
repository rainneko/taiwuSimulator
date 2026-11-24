/**
 * 世界运行时状态（core 层）。静态数据（省片轮廓 PlaceDef、地形 RegionData）留在场景层，
 * 这里只存会随回合变化的状态，按 id 与静态数据关联：
 *   ProvinceState.id === PlaceDef.id（'p0'…'p14'）
 *   RegionState.id   === RegionData.id（约定 `${provinceId}.${localId}`，见 worldData.provinceOfRegion）
 * core 不 import scenes；需要省份静态信息时用下面的 ProvinceSeed 结构类型（PlaceDef 可直接传入）。
 */

// ── 时间 ──

/** 回合阶段：事件 → 行动 → 结算 → 推进。 */
export type TurnPhase = 'event' | 'action' | 'resolve' | 'advance';
export const TURN_PHASES: readonly TurnPhase[] = ['event', 'action', 'resolve', 'advance'];

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface GameTime {
  year: number;     // 从 1 起
  month: number;    // 1–12
  phase: TurnPhase;
  /** 自开局起经过的总月数（0 起），便于计算年龄、冷却等。 */
  totalMonths: number;
}

// ── 省份 ──

/** 创建省份状态所需的最少静态字段；scenes/world/worldData.ts 的 PlaceDef 结构上满足它。 */
export interface ProvinceSeed {
  id: string;
  nameKey: string;
  faction: string;
}

export interface ProvinceState {
  id: string;
  /** 太吾对该省的好感度（原版「地区恩义」类数值），0–100。 */
  goodwill: number;
  /** 控制该省的势力 id（初值取 PlaceDef.faction）。 */
  controllingFaction: string;
  unlocked: boolean;
  /** 该省下辖地区 id 列表。 */
  regionIds: string[];
  /** 自由标记（剧情、任务进度等）。 */
  flags: Record<string, number | boolean | string>;
}

// ── 地区 ──

export interface BuildingState {
  id: string;
  /** 建筑模板 id（待 src/data 落地后对接）。 */
  templateId: string;
  /** 所在格子索引（与 RegionData.ground 同一索引）。 */
  cell: number;
  level: number;
  /** 建造/升级剩余月数，0 = 已完成。 */
  buildMonthsLeft: number;
}

/** 地区资源池：原版六种可采集资源。 */
export type ResourceKind = 'food' | 'wood' | 'metal' | 'jade' | 'fabric' | 'herb';
export const RESOURCE_KINDS: readonly ResourceKind[] = ['food', 'wood', 'metal', 'jade', 'fabric', 'herb'];
export type ResourcePool = Record<ResourceKind, number>;

/** 地区运行时状态，与 RegionData（地形静态数据）互补。 */
export interface RegionState {
  id: string;
  provinceId: string;
  /** NPC（角色 id，待 src/core/character 对接）→ 所在格子。 */
  npcs: Record<string, number>;
  buildings: BuildingState[];
  /** 各格资源存量：cell → 资源池；缺省格视为 0。 */
  resources: Record<number, Partial<ResourcePool>>;
  /** 事件标记：key → 值；月度事件可读写。 */
  eventFlags: Record<string, number | boolean | string>;
  /** 是否已到访（地图迷雾等）。 */
  visited: boolean;
}

// ── 世界 ──

export interface PlayerLocation {
  provinceId: string;
  regionId: string;
  cell: number;
}

/** 替代 app/store.ts 的 WorldState 占位。 */
export interface WorldData {
  time: GameTime;
  provinces: Record<string, ProvinceState>;
  regions: Record<string, RegionState>;
  player: PlayerLocation;
}

// ── 事件 ──

/** 世界层事件总线负载表（EventBus<WorldEvents>）。 */
export interface WorldEvents extends Record<string, unknown> {
  'phase:changed': { time: GameTime; from: TurnPhase; to: TurnPhase };
  'month:start': { time: GameTime };
  'month:end': { time: GameTime };
  'season:changed': { time: GameTime; from: Season; to: Season };
  'year:end': { year: number };
  'year:start': { time: GameTime };
  'turn:start': { time: GameTime; actionPoints: number };
  'action:executed': { time: GameTime; action: TurnAction; result: ActionResult };
  'action:rejected': { time: GameTime; action: TurnAction; reason: ActionRejectReason };
  'turn:end': { time: GameTime; actions: TurnAction[] };
  'player:moved': { from: PlayerLocation; to: PlayerLocation };
}

// ── 行动 ──

export type TurnAction =
  | { kind: 'move'; to: PlayerLocation }
  | { kind: 'cultivate'; skillId?: string }
  | { kind: 'gather'; resource: ResourceKind; cell?: number }
  | { kind: 'build'; templateId: string; cell: number }
  | { kind: 'socialize'; targetId: string }
  | { kind: 'read'; bookId: string }
  | { kind: 'alchemy'; recipeId: string }
  | { kind: 'rest' };

export type TurnActionKind = TurnAction['kind'];

export interface ActionResult {
  ok: true;
  apSpent: number;
  apLeft: number;
  /** 行动产出（采集量、建筑 id 等），具体含义由 kind 决定。 */
  detail?: Record<string, unknown>;
}

export type ActionRejectReason =
  | 'wrong-phase'
  | 'not-enough-ap'
  | 'invalid-target'
  | 'locked';
