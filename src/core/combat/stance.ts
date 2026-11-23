import type { PCG32 } from '../rng';
import type { CombatState, FighterState, StanceType } from './types';

export const DEFAULT_STANCE_SLOTS = 9;
export const WHEEL_SIZE = 6;

/**
 * 获得一个式；槽满时挤掉最早获得的。
 * 常规式只有当前武器轮盘包含时才能获得；万能式/杀式直接获得。
 */
export function gainStance(state: CombatState, f: FighterState, s: StanceType): boolean {
  if (s === 'none') return false;
  if (s !== 'wild' && s !== 'kill' && !f.wheelSlots.includes(s)) return false;
  f.stances.push(s);
  while (f.stances.length > f.stanceSlotCapacity) f.stances.shift();
  state.events.emit('stanceGained', { actorId: f.id, stance: s });
  return true;
}

/** 当前轮盘式（不推进） */
export function currentWheelStance(f: FighterState): StanceType {
  if (f.wheelSlots.length === 0) return 'none';
  return f.wheelSlots[f.wheelIndex % f.wheelSlots.length] ?? 'none';
}

/** 开战时 Fisher-Yates 打乱轮盘 */
export function shuffleWheel(rng: PCG32, f: FighterState): void {
  const order = f.wheelSlots;
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.randInt(i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  f.wheelIndex = 0;
}

/** StanceCost[] → 展开为需求列表 */
export function expandCost(cost: readonly { type: StanceType; count: number }[]): StanceType[] {
  const out: StanceType[] = [];
  for (const c of cost) for (let i = 0; i < c.count; i++) out.push(c.type);
  return out;
}

/** 轮盘：取当前格的式并推进指针 */
export function nextWheelStance(f: FighterState): StanceType {
  if (f.wheelSlots.length === 0) return 'none';
  const s = f.wheelSlots[f.wheelIndex % f.wheelSlots.length] ?? 'none';
  f.wheelIndex = (f.wheelIndex + 1) % f.wheelSlots.length;
  return s;
}

/** 武器是否支持某式 */
export function weaponSupports(f: FighterState, s: StanceType): boolean {
  return f.wheelSlots.includes(s);
}

/**
 * 判断已有式能否满足需求。'wild'(万能) 可替代任意非'kill'式。
 * 返回需要消耗的式下标（按优先使用精确匹配），不满足返回 null。
 */
export function matchStances(have: readonly StanceType[], need: readonly StanceType[]): number[] | null {
  const used = new Set<number>();
  const pending: StanceType[] = [];
  for (const n of need) {
    const idx = have.findIndex((h, i) => !used.has(i) && h === n);
    if (idx >= 0) used.add(idx); else pending.push(n);
  }
  for (const n of pending) {
    if (n === 'kill') return null;
    const idx = have.findIndex((h, i) => !used.has(i) && h === 'wild');
    if (idx < 0) return null;
    used.add(idx);
  }
  return [...used].sort((a, b) => a - b);
}

/** 消耗式，成功返回 true */
export function consumeStances(f: FighterState, need: readonly StanceType[]): boolean {
  const idxs = matchStances(f.stances, need);
  if (!idxs) return false;
  const drop = new Set(idxs);
  f.stances = f.stances.filter((_, i) => !drop.has(i));
  return true;
}
