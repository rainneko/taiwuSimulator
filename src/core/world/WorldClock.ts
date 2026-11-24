import { EventBus } from '../EventBus';
import type { GameTime, Season, TurnPhase, WorldData, WorldEvents } from './types';

export const MONTHS_PER_YEAR = 12;

/** 1–3 春、4–6 夏、7–9 秋、10–12 冬。 */
export function seasonOfMonth(month: number): Season {
  if (month < 1 || month > MONTHS_PER_YEAR) throw new RangeError(`month must be 1–12, got ${month}`);
  return (['spring', 'summer', 'autumn', 'winter'] as const)[Math.floor((month - 1) / 3)];
}

export function createGameTime(year = 1, month = 1): GameTime {
  return { year, month, phase: 'event', totalMonths: (year - 1) * MONTHS_PER_YEAR + (month - 1) };
}

/** 同步钩子：状态变更（老化、门派变动、建筑进度）在这里做，事件总线只负责通知（drain 时才派发）。 */
export type MonthlyHook = (world: WorldData, time: Readonly<GameTime>) => void;
export type YearlyHook = (world: WorldData, endedYear: number) => void;

/**
 * 时间推进。持有 WorldData 的引用并原地修改 world.time；
 * 月/年钩子按注册顺序同步执行，之后向总线 emit 对应事件（由上层 drain 派发给 UI）。
 */
export class WorldClock {
  private monthlyHooks: MonthlyHook[] = [];
  private yearlyHooks: YearlyHook[] = [];

  constructor(
    readonly world: WorldData,
    readonly bus: EventBus<WorldEvents> = new EventBus<WorldEvents>(),
  ) {}

  get time(): Readonly<GameTime> { return this.world.time; }

  getCurrentSeason(): Season { return seasonOfMonth(this.world.time.month); }

  /** 注册月度钩子（新月开始时执行）。返回注销函数。 */
  onMonth(fn: MonthlyHook): () => void { return addHook(this.monthlyHooks, fn); }

  /** 注册年度结算钩子（12 月结束、进入次年 1 月之前执行）：角色老化、门派变动等。 */
  onYear(fn: YearlyHook): () => void { return addHook(this.yearlyHooks, fn); }

  setPhase(to: TurnPhase): void {
    const from = this.world.time.phase;
    if (from === to) return;
    this.world.time.phase = to;
    this.bus.emit('phase:changed', { time: { ...this.world.time }, from, to });
  }

  /** 推进一个月：月末 → （跨年则年度结算）→ 新月开始，触发月度钩子与事件。 */
  advanceMonth(): void {
    const t = this.world.time;
    const prevSeason = this.getCurrentSeason();
    this.bus.emit('month:end', { time: { ...t } });

    if (t.month === MONTHS_PER_YEAR) {
      this.advanceYear();
      t.month = 1;
    } else {
      t.month += 1;
    }
    t.totalMonths += 1;

    const snap = { ...t };
    const season = this.getCurrentSeason();
    if (season !== prevSeason) this.bus.emit('season:changed', { time: snap, from: prevSeason, to: season });
    for (const fn of this.monthlyHooks.slice()) fn(this.world, snap);
    this.bus.emit('month:start', { time: snap });
  }

  /**
   * 年度结算：执行年度钩子并把年份 +1。由 advanceMonth 在 12 月末自动调用；
   * 不要在 advanceMonth 之外单独调用，否则会出现「年份变了月份没回 1」的状态。
   */
  advanceYear(): void {
    const ended = this.world.time.year;
    for (const fn of this.yearlyHooks.slice()) fn(this.world, ended);
    this.bus.emit('year:end', { year: ended });
    this.world.time.year = ended + 1;
    this.bus.emit('year:start', { time: { ...this.world.time, month: 1 } });
  }
}

function addHook<F>(list: F[], fn: F): () => void {
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
}
