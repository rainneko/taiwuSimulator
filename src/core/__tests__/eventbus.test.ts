import { describe, it, expect } from 'vitest';
import { EventBus } from '../EventBus';

describe('EventBus', () => {
  it('emit 入队，drain 时派发并清空', () => {
    const bus = new EventBus<{ a: { n: number } }>();
    const got: number[] = [];
    const off = bus.on('a', e => got.push(e.n));
    bus.emit('a', { n: 1 });
    expect(got).toEqual([]);
    expect(bus.drain()).toHaveLength(1);
    expect(got).toEqual([1]);
    off();
    bus.emit('a', { n: 2 });
    bus.drain();
    expect(got).toEqual([1]);
    expect(bus.pending).toBe(0);
  });
});
