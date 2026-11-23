import type { GuardSkillData, MovementArtData, TechniqueData } from '../combat/types';

/** 测试用摧破功法（模拟七品剑法） */
export const TEST_SWORD_TECHNIQUE: TechniqueData = {
  id: 'test_sword_1', type: 'destroy', grade: 7,
  stanceCost: [{ type: 'chop', count: 2 }, { type: 'stab', count: 1 }],
  gaugeTotal: 1000, breathShare: 500, castTime: 180,
  hit: { power: 4, speed: 3, skill: 3 },
  damage: 150, innerRatioBase: 300,
  range: { mode: 'weaponPlus', delta: 0 },
  partWeights: { chest: 40, waist: 30, leftArm: 10, rightArm: 10, leftLeg: 5, rightLeg: 5 },
};

/** 测试用护体绝技（模拟七品） */
export const TEST_GUARD_SKILL: GuardSkillData = {
  id: 'test_guard_1', gaugeTotal: 600, breathShare: 500, castTime: 60, duration: 300,
  guardFlat: { outer: 50, inner: 30 }, guardPct: { outer: 200, inner: 150 },
  avoid: { absorb: 100, parry: 80, dodge: 60 },
  counter: { range: [20, 50], power: 2000, channel: 'power' },
  reflect: { outer: 300, inner: 200 },
};

/** 测试用身法 */
export const TEST_MOVEMENT_ART: MovementArtData = {
  id: 'test_move_1', castTime: 30, mobilityCost: 1, moveSpeed: 1500, moveStep: 1500,
  grant: { count: 3, decayFrames: 100 },
};

export const TEST_ARTS = {
  techniques: { [TEST_SWORD_TECHNIQUE.id]: TEST_SWORD_TECHNIQUE },
  guardSkills: { [TEST_GUARD_SKILL.id]: TEST_GUARD_SKILL },
  movementArts: { [TEST_MOVEMENT_ART.id]: TEST_MOVEMENT_ART },
};
export const TEST_ART_IDS = [TEST_SWORD_TECHNIQUE.id, TEST_GUARD_SKILL.id, TEST_MOVEMENT_ART.id];
