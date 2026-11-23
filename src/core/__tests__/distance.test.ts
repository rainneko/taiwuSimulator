import { describe, it, expect } from 'vitest';
import { initCombat } from '../combat/CombatSim';
import { tickMovement, tickMobility, setTargetDistance, addBodyMovementPoints, MOVE_PROGRESS_MAX, DISTANCE_MAX, DISTANCE_MIN } from '../combat/distance';
import { config } from './fixtures';

describe('距离与移动', () => {
  it('目标距离夹在 [2.0, 9.0]，保持 0.1 精度', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    setTargetDistance(f, 10);
    expect(f.targetDistance).toBe(DISTANCE_MAX);
    setTargetDistance(f, -100);
    expect(f.targetDistance).toBe(DISTANCE_MIN);
    setTargetDistance(f, 0.1); setTargetDistance(f, 0.1); setTargetDistance(f, 0.1);
    expect(f.targetDistance).toBe(2.3);
  });

  it('目标等于当前距离时不积累移动进度', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    tickMovement(s, f);
    expect(f.moveProgress).toBe(0);
  });

  it('有移动力：进度满一步移动 moveDistance 并消耗 1 点移动力', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    f.movementPoints = 3;
    f.targetDistance = 7;
    const framesPerStep = Math.ceil(MOVE_PROGRESS_MAX / (f.moveSpeed * 100));
    for (let i = 0; i < framesPerStep; i++) tickMovement(s, f);
    expect(s.distance).toBe(5.5);
    expect(f.movementPoints).toBe(2);
  });

  it('无移动力时效率 25%（速度 50% × 距离 50%）', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    f.movementPoints = 0; f.bodyMovementPoints = 0;
    f.targetDistance = 9;
    const fullFrames = Math.ceil(MOVE_PROGRESS_MAX / (f.moveSpeed * 100));
    for (let i = 0; i < fullFrames; i++) tickMovement(s, f);
    expect(s.distance).toBe(5); // 半速，尚未走出一步
    for (let i = 0; i < fullFrames; i++) tickMovement(s, f);
    expect(s.distance).toBeCloseTo(5.3, 5); // 0.5 × 0.5 = 0.25 → 0.1 精度四舍五入为 0.3
  });

  it('不越过目标距离、不越界', () => {
    const s = initCombat(config(42n, { startDistance: 8.8 }));
    const f = s.fighters[0];
    f.movementPoints = 3;
    f.targetDistance = 9.0;
    f.moveDistance = 2;
    for (let i = 0; i < 1000; i++) tickMovement(s, f);
    expect(s.distance).toBe(9.0);
  });

  it('白移动力每 150 帧 +1，上限 3', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    f.movementPoints = 0;
    for (let i = 0; i < 149; i++) tickMobility(f);
    expect(f.movementPoints).toBe(0);
    tickMobility(f);
    expect(f.movementPoints).toBe(1);
    for (let i = 0; i < 150 * 10; i++) tickMobility(f);
    expect(f.movementPoints).toBe(3);
  });

  it('身法移动力每 100 帧 -1，期间白移动力不增长；优先消耗身法移动力', () => {
    const s = initCombat(config());
    const f = s.fighters[0];
    f.movementPoints = 1;
    addBodyMovementPoints(f, 10);
    expect(f.bodyMovementPoints).toBe(6);
    for (let i = 0; i < 100; i++) tickMobility(f);
    expect(f.bodyMovementPoints).toBe(5);
    expect(f.movementPoints).toBe(1);
    f.targetDistance = 9;
    for (let i = 0; i < 2; i++) tickMovement(s, f);
    expect(f.bodyMovementPoints).toBe(4);
    expect(f.movementPoints).toBe(1);
  });
});
