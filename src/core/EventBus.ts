/** 类型安全事件总线：core 层 emit 入队，drain 时派发给订阅者并返回事件列表。 */
export interface QueuedEvent<T, K extends keyof T = keyof T> { type: K; payload: T[K] }

export class EventBus<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Set<(e: never) => void>>();
  private queue: QueuedEvent<T>[] = [];

  on<K extends keyof T>(type: K, fn: (e: T[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(fn as (e: never) => void);
    return () => { this.listeners.get(type)?.delete(fn as (e: never) => void); };
  }

  emit<K extends keyof T>(type: K, payload: T[K]): void {
    this.queue.push({ type, payload } as QueuedEvent<T>);
  }

  get pending(): number { return this.queue.length; }

  drain(): QueuedEvent<T>[] {
    const events = this.queue.slice();
    this.queue.length = 0;
    for (const ev of events) {
      this.listeners.get(ev.type)?.forEach(fn => (fn as (e: unknown) => void)(ev.payload));
    }
    return events;
  }
}
