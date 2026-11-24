import type { EventBus } from '../EventBus';
import { WorldClock } from './WorldClock';
import type {
  ActionRejectReason, ActionResult, ResourceKind, TurnAction, TurnActionKind, WorldData, WorldEvents,
} from './types';

/**
 * 行动点默认值。原版以「每月天数」作为行动资源；具体数值与各行动消耗待 src/data 落地后
 * 按原版数据表替换（TODO：核对原版每月可用天数与各行动耗时）。
 */
export const DEFAULT_ACTION_POINTS = 30;

export const DEFAULT_ACTION_COSTS: Record<Exclude<TurnActionKind, 'move'>, number> = {
  cultivate: 10,
  gather: 5,
  build: 10,
  socialize: 3,
  read: 10,
  alchemy: 10,
  rest: 0,
};

/** 移动消耗：同地区换格 1、同省换地区 5、跨省 10（与 worldData 桩的量级一致，待替换）。 */
export function defaultMoveCost(world: WorldData, to: Extract<TurnAction, { kind: 'move' }>['to']): number {
  const from = world.player;
  if (from.regionId === to.regionId) return from.cell === to.cell ? 0 : 1;
  return from.provinceId === to.provinceId ? 5 : 10;
}

export type ActionHandlerResult =
  | { ok: true; detail?: Record<string, unknown> }
  | { ok: false; reason: ActionRejectReason };

/** 行动处理器：已通过阶段/行动点检查后调用；返回 ok:false 则不扣行动点。 */
export type ActionHandler<K extends TurnActionKind = TurnActionKind> =
  (action: Extract<TurnAction, { kind: K }>, ctx: TurnContext) => ActionHandlerResult;

export interface TurnContext {
  world: WorldData;
  clock: WorldClock;
  bus: EventBus<WorldEvents>;
}

export type TurnHook = (ctx: TurnContext) => void;

export interface TurnManagerOptions {
  actionPoints?: number;
  costs?: Partial<typeof DEFAULT_ACTION_COSTS>;
  moveCost?: typeof defaultMoveCost;
  /** 新建筑的建造月数（缺省 1）。 */
  buildMonths?: (templateId: string) => number;
  /** 单次采集量上限（缺省 10）。 */
  gatherAmount?: (resource: ResourceKind) => number;
}

export type ExecuteResult = ActionResult | { ok: false; reason: ActionRejectReason };

/**
 * 回合流程：startTurn（event → action）→ executeAction × N → endTurn（resolve → advance → 推进一月）。
 * 各系统通过 onEvent / onResolve 注册钩子，通过 setHandler 接管具体行动（修炼、交际等待角色模块接入）。
 */
export class TurnManager {
  readonly clock: WorldClock;
  private ap = 0;
  private maxAp: number;
  private costs: typeof DEFAULT_ACTION_COSTS;
  private moveCost: typeof defaultMoveCost;
  private buildMonths: (templateId: string) => number;
  private gatherAmount: (resource: ResourceKind) => number;
  private actionsThisTurn: TurnAction[] = [];
  private eventHooks: TurnHook[] = [];
  private resolveHooks: TurnHook[] = [];
  private handlers = new Map<TurnActionKind, ActionHandler<never>>();
  private buildSeq = 0;
  private started = false;

  constructor(clock: WorldClock, opts: TurnManagerOptions = {}) {
    this.clock = clock;
    this.maxAp = opts.actionPoints ?? DEFAULT_ACTION_POINTS;
    this.costs = { ...DEFAULT_ACTION_COSTS, ...opts.costs };
    this.moveCost = opts.moveCost ?? defaultMoveCost;
    this.buildMonths = opts.buildMonths ?? (() => 1);
    this.gatherAmount = opts.gatherAmount ?? (() => 10);
    this.installDefaultHandlers();
  }

  get world(): WorldData { return this.clock.world; }
  get bus(): EventBus<WorldEvents> { return this.clock.bus; }
  get actionPoints(): number { return this.ap; }
  get maxActionPoints(): number { return this.maxAp; }
  get inProgress(): boolean { return this.started; }
  get actions(): readonly TurnAction[] { return this.actionsThisTurn; }

  private get ctx(): TurnContext { return { world: this.world, clock: this.clock, bus: this.bus }; }

  onEvent(fn: TurnHook): () => void { return addHook(this.eventHooks, fn); }
  onResolve(fn: TurnHook): () => void { return addHook(this.resolveHooks, fn); }

  setHandler<K extends TurnActionKind>(kind: K, fn: ActionHandler<K>): void {
    this.handlers.set(kind, fn as unknown as ActionHandler<never>);
  }

  costOf(action: TurnAction): number {
    return action.kind === 'move' ? this.moveCost(this.world, action.to) : this.costs[action.kind];
  }

  /** 开始新回合：事件阶段（执行事件钩子）→ 行动阶段，行动点回满。 */
  startTurn(): void {
    if (this.started) throw new Error('turn already started; call endTurn() first');
    this.started = true;
    this.actionsThisTurn = [];
    this.clock.setPhase('event');
    for (const fn of this.eventHooks.slice()) fn(this.ctx);
    this.ap = this.maxAp;
    this.clock.setPhase('action');
    this.bus.emit('turn:start', { time: { ...this.world.time }, actionPoints: this.ap });
  }

  executeAction(action: TurnAction): ExecuteResult {
    const reject = (reason: ActionRejectReason): ExecuteResult => {
      this.bus.emit('action:rejected', { time: { ...this.world.time }, action, reason });
      return { ok: false, reason };
    };
    if (!this.started || this.world.time.phase !== 'action') return reject('wrong-phase');
    const cost = this.costOf(action);
    if (cost > this.ap) return reject('not-enough-ap');

    const handler = this.handlers.get(action.kind) as ActionHandler | undefined;
    const r = handler ? handler(action as never, this.ctx) : { ok: true as const };
    if (!r.ok) return reject(r.reason);

    this.ap -= cost;
    this.actionsThisTurn.push(action);
    const result: ActionResult = { ok: true, apSpent: cost, apLeft: this.ap, detail: r.detail };
    this.bus.emit('action:executed', { time: { ...this.world.time }, action, result });
    return result;
  }

  /** 结束回合：结算阶段（建筑进度、结算钩子）→ 推进阶段 → 时间推进一月。 */
  endTurn(): void {
    if (!this.started) throw new Error('no turn in progress; call startTurn() first');
    this.clock.setPhase('resolve');
    for (const region of Object.values(this.world.regions)) {
      for (const b of region.buildings) if (b.buildMonthsLeft > 0) b.buildMonthsLeft -= 1;
    }
    for (const fn of this.resolveHooks.slice()) fn(this.ctx);
    this.bus.emit('turn:end', { time: { ...this.world.time }, actions: this.actionsThisTurn.slice() });
    this.clock.setPhase('advance');
    this.clock.advanceMonth();
    this.ap = 0;
    this.started = false;
  }

  /** 默认处理器：移动 / 采集 / 建造有最小可用实现；其余行动只扣行动点，待各系统 setHandler 接管。 */
  private installDefaultHandlers(): void {
    this.setHandler('move', (a, { world, bus }) => {
      const prov = world.provinces[a.to.provinceId];
      const region = world.regions[a.to.regionId];
      if (!prov || !region || region.provinceId !== prov.id) return { ok: false, reason: 'invalid-target' };
      if (!prov.unlocked) return { ok: false, reason: 'locked' };
      const from = { ...world.player };
      world.player = { ...a.to };
      region.visited = true;
      bus.emit('player:moved', { from, to: { ...a.to } });
      return { ok: true };
    });

    this.setHandler('gather', (a, { world }) => {
      const region = world.regions[world.player.regionId];
      if (!region) return { ok: false, reason: 'invalid-target' };
      const cell = a.cell ?? world.player.cell;
      const pool = region.resources[cell] ?? {};
      const stock = pool[a.resource] ?? 0;
      const got = Math.min(stock, this.gatherAmount(a.resource));
      if (got <= 0) return { ok: false, reason: 'invalid-target' };
      region.resources[cell] = { ...pool, [a.resource]: stock - got };
      return { ok: true, detail: { resource: a.resource, amount: got } };
    });

    this.setHandler('build', (a, { world }) => {
      const region = world.regions[world.player.regionId];
      if (!region) return { ok: false, reason: 'invalid-target' };
      if (region.buildings.some((b) => b.cell === a.cell)) return { ok: false, reason: 'invalid-target' };
      const id = `${region.id}.b${++this.buildSeq}`;
      region.buildings.push({ id, templateId: a.templateId, cell: a.cell, level: 1, buildMonthsLeft: this.buildMonths(a.templateId) });
      return { ok: true, detail: { buildingId: id } };
    });
  }
}

function addHook<F>(list: F[], fn: F): () => void {
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}
