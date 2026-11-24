import { describe, it, expect } from 'vitest';
import { PLACES } from '../../scenes/world/worldData';
import { createWorldData, seasonOfMonth, TurnManager, WorldClock } from '../world';

const makeWorld = (month = 1) => createWorldData({
  provinces: PLACES, // PlaceDef 结构兼容 ProvinceSeed
  player: { provinceId: 'p3', regionId: 'p3.r0', cell: 0 },
  locked: ['p11'],
  month,
});

describe('world', () => {
  it('从 PLACES 建出 15 片省域与各自地区', () => {
    const w = makeWorld();
    expect(Object.keys(w.provinces)).toHaveLength(PLACES.length);
    expect(w.provinces.p11.unlocked).toBe(false);
    expect(w.regions['p3.r0'].visited).toBe(true);
    expect(w.provinces.p0.controllingFaction).toBe('north');
  });

  it('季节划分', () => {
    expect([1, 3, 4, 6, 7, 9, 10, 12].map(seasonOfMonth))
      .toEqual(['spring', 'spring', 'summer', 'summer', 'autumn', 'autumn', 'winter', 'winter']);
  });

  it('WorldClock 推进月份、跨年执行年度钩子', () => {
    const clock = new WorldClock(makeWorld(11));
    const years: number[] = [];
    let months = 0;
    clock.onYear((_, y) => years.push(y));
    clock.onMonth(() => months++);
    clock.advanceMonth();
    expect(clock.time).toMatchObject({ year: 1, month: 12 });
    clock.advanceMonth();
    expect(clock.time).toMatchObject({ year: 2, month: 1, totalMonths: 12 });
    expect(years).toEqual([1]);
    expect(months).toBe(2);
    const types = clock.bus.drain().map((e) => e.type);
    expect(types).toContain('season:changed');
    expect(types.indexOf('year:end')).toBeLessThan(types.lastIndexOf('month:start'));
  });

  it('TurnManager 执行一个行动回合', () => {
    const world = makeWorld();
    world.regions['p3.r0'].resources[0] = { herb: 7 };
    const tm = new TurnManager(new WorldClock(world), { actionPoints: 30 });

    expect(tm.executeAction({ kind: 'rest' })).toEqual({ ok: false, reason: 'wrong-phase' });
    tm.startTurn();
    expect(world.time.phase).toBe('action');

    expect(tm.executeAction({ kind: 'gather', resource: 'herb' })).toMatchObject({ ok: true, apSpent: 5, detail: { amount: 7 } });
    expect(tm.executeAction({ kind: 'build', templateId: 'hut', cell: 4 })).toMatchObject({ ok: true, apLeft: 15 });
    expect(tm.executeAction({ kind: 'move', to: { provinceId: 'p11', regionId: 'p11.r0', cell: 0 } }))
      .toEqual({ ok: false, reason: 'locked' });
    expect(tm.executeAction({ kind: 'move', to: { provinceId: 'p0', regionId: 'p0.r0', cell: 3 } })).toMatchObject({ ok: true, apLeft: 5 });
    expect(world.player.provinceId).toBe('p0');
    expect(tm.executeAction({ kind: 'cultivate' })).toEqual({ ok: false, reason: 'not-enough-ap' });

    tm.endTurn();
    expect(world.time).toMatchObject({ year: 1, month: 2, phase: 'advance' });
    expect(world.regions['p3.r0'].buildings[0].buildMonthsLeft).toBe(0);

    tm.startTurn();
    expect(tm.actionPoints).toBe(30);
  });
});
