/**
 * 桩数据：少量手填条目，让其他模块在正式数据导入前即可使用 GameDB。
 *
 * 来源：
 * - 功法：data/wiki/text/旧__功法__*.md 的「武学效果」段，逐项照抄。
 *   换算：伤害 18.4% → damage 184（千分比）；气势消耗 架势a%※提气b% → gaugeTotal=(a+b)×10, breathShare=b/(a+b)×1000；
 *   命中 ◇ 数即 10 成分配；「无法闪避」记 0 成；innerRatioBase 暂取 破气/(破体+破气)×1000（待公式确认）。
 * - 武器：data/wiki/data_ns/Data_EA__Item__<id>.json.json 原始字段，字段含义为推测解码：
 *   501=重量×100、502/503=攻击范围×100、601=威力、603=破甲、801/802/803=力道/迅疾/精妙命中占比、
 *   102=耐久、904=价值、8=品级（1 最低，品阶=10−值）。轮盘 wheel 与速度档原版编码未解，沿用战斗模块示例值。
 * - 门派：wiki 门派页的立场与根基技艺；好感度系数原版未查到，暂填 1000。
 */
import { WEAPON_SPEED_CLASS } from '../core/combat/attack';
import type {
  AttackTechniqueDef, FactionDef, GameDataBundle, NpcTemplate, SkillDef, WeaponItemDef,
} from './types';

// ---------------- 武器 ----------------

export const STUB_WEAPONS: WeaponItemDef[] = [
  {
    id: '52201', originalId: 52201, name: '铁剑', type: 'weapon', subType: '长剑', grade: 9,
    weaponClass: 'sword', baseSpeed: WEAPON_SPEED_CLASS.normal, weight: 4,
    rangeMin: 3.0, rangeMax: 5.0, power: 500, armorBreak: 500,
    wheel: ['chop', 'stab', 'flick', 'chop', 'stab', 'wild'],
    hitRatio: { power: 90, speed: 90, skill: 110 },
    durability: 350, value: 100,
  },
  {
    id: '82401', originalId: 82401, name: '木剑', type: 'weapon', grade: 9,
    weaponClass: 'sword', baseSpeed: WEAPON_SPEED_CLASS.fast, weight: 2.8,
    rangeMin: 3.0, rangeMax: 5.5, power: 300, armorBreak: 300,
    wheel: ['stab', 'flick', 'stab', 'flick', 'chop', 'wild'],
    hitRatio: { power: 70, speed: 100, skill: 140 },
    durability: 350, value: 100,
  },
  {
    id: '52302', originalId: 52302, name: '折铁剑', type: 'weapon', subType: '重剑', grade: 8,
    weaponClass: 'sword', baseSpeed: WEAPON_SPEED_CLASS.slow, weight: 9.1,
    rangeMin: 3.0, rangeMax: 5.5, power: 600, armorBreak: 560,
    wheel: ['chop', 'crash', 'chop', 'crash', 'stab', 'wild'],
    hitRatio: { power: 160, speed: 70, skill: 50 },
    durability: 800, value: 400,
  },
  {
    id: '52901', originalId: 52901, name: '朴刀', type: 'weapon', subType: '重刀', grade: 9,
    weaponClass: 'blade', baseSpeed: WEAPON_SPEED_CLASS.slow, weight: 10,
    rangeMin: 3.5, rangeMax: 6.0, power: 700, armorBreak: 700,
    wheel: ['chop', 'crash', 'lift', 'chop', 'crash', 'lift'],
    hitRatio: { power: 160, speed: 65, skill: 50 },
    durability: 350, value: 100,
  },
  {
    id: '82802', originalId: 82802, name: '齐眉棍', type: 'weapon', subType: '木棍', grade: 8,
    weaponClass: 'polearm', baseSpeed: WEAPON_SPEED_CLASS.normal, weight: 2.7,
    rangeMin: 4.0, rangeMax: 6.5, power: 240, armorBreak: 440,
    wheel: ['sweep', 'crash', 'stab', 'sweep', 'crash', 'lift'],
    hitRatio: { power: 100, speed: 100, skill: 100 },
    durability: 800, value: 400,
  },
];

// ---------------- 功法（摧破） ----------------

export const STUB_TECHNIQUES: AttackTechniqueDef[] = [
  {
    id: '40101', originalId: 40101, name: '少林伏虎爪', kind: 'destroy', type: 'destroy',
    category: 'finger', grade: 9, element: 'vajra', factionId: 'shaolin', slots: 1, playCap: 130,
    stanceCost: [{ type: 'grab', count: 1 }],
    gaugeTotal: 1000, breathShare: 0, castTime: 90,
    hit: { speed: 2, skill: 4, power: 4 },
    damage: 168, innerRatioBase: 0, penetrate: { outer: 72, inner: 0 },
    range: { mode: 'weaponPlus', delta: 0.5 },
    partWeights: { chest: 30, waist: 5, head: 1, leftArm: 10, rightArm: 10, leftLeg: 25, rightLeg: 25 },
    equipBonus: { hitPower: 20, hitSkill: 20 },
    heartMethod: { normal: '施展少林伏虎爪的过程中，运用者受到的所有守御值损害都将变化为少林伏虎爪的额外伤害（每点守御值增加0.1%基础伤害）' },
  },
  {
    id: '30108', originalId: 30108, name: '降魔光明拳', kind: 'destroy', type: 'destroy',
    category: 'fist', grade: 2, element: 'vajra', factionId: 'shaolin', slots: 3, playCap: 190,
    stanceCost: [{ type: 'crash', count: 5 }],
    gaugeTotal: 1000, breathShare: 700, castTime: 165,
    hit: { speed: 0, skill: 5, power: 5 },
    damage: 550, innerRatioBase: 625, penetrate: { outer: 180, inner: 300 },
    range: { mode: 'weaponPlus', delta: 1.0 },
    partWeights: { chest: 60, waist: 10, head: 1 },
    equipBonus: { hitPower: 100, hitSkill: 350 },
    requirements: { 拳掌: 500, 膂力: 80, 体质: 100, 定力: 130, 佛学: 500 },
    heartMethod: {
      normal: '运用者的处世立场比敌人越仁善，降魔光明拳的攻击范围和威力就增加越多，最多增加300%；发挥十成威力时，使敌人的处世立场向仁善变化',
      reversed: '运用者的处世立场比敌人越叛逆，降魔光明拳的攻击范围和威力就增加越多，最多增加300%；发挥十成威力时，使敌人的处世立场向叛逆变化',
    },
  },
  {
    id: '30401', originalId: 30401, name: '武当长拳', kind: 'destroy', type: 'destroy',
    category: 'fist', grade: 9, element: 'yang', factionId: 'wudang', slots: 1, playCap: 130,
    stanceCost: [{ type: 'crash', count: 1 }],
    gaugeTotal: 1000, breathShare: 500, castTime: 105,
    hit: { speed: 3, skill: 4, power: 3 },
    damage: 184, innerRatioBase: 667, penetrate: { outer: 16, inner: 32 },
    range: { mode: 'weaponPlus', delta: 1.0 },
    partWeights: { chest: 25, waist: 20, head: 1, leftArm: 15, rightArm: 15, leftLeg: 10, rightLeg: 10 },
    equipBonus: { dodgeDeflect: 20, dodgeParry: 20 },
    requirements: { 拳掌: 80, 灵敏: 45, 根骨: 60, 定力: 45, 道法: 80 },
    heartMethod: { normal: '发挥十成威力后，提高运用者的内伤强度（造成内伤+20%）', reversed: '发挥十成威力后，降低敌人的内伤强度（造成内伤-20%）' },
  },
  {
    id: '70401', originalId: 70401, name: '武当丹剑', kind: 'destroy', type: 'destroy',
    category: 'sword', grade: 9, element: 'yang', factionId: 'wudang', slots: 1,
    stanceCost: [{ type: 'lift', count: 1 }],
    gaugeTotal: 1000, breathShare: 500, castTime: 85,
    hit: { speed: 3, skill: 5, power: 2 },
    damage: 184, innerRatioBase: 667, penetrate: { outer: 16, inner: 32 },
    range: { mode: 'weaponPlus', delta: 0.5 },
    partWeights: { waist: 15, head: 1, leftArm: 45, rightArm: 45, leftLeg: 10, rightLeg: 10 },
    equipBonus: { hitSkill: 40 },
  },
];

// ---------------- 门派 ----------------

export const STUB_FACTIONS: FactionDef[] = [
  {
    id: 'shaolin', name: '少林派', alignment: 'benevolent', coreSkill: 'buddhism',
    description: '少林派乃正派武林中的泰山北斗。菩提达摩祖师以禅入武，在少林寺面壁九年，创出“七十二绝技”。',
    techniqueIds: ['40101', '30108'], favorCoef: 1000,
    rules: ['严禁弟子婚配', '不向普通女性传授武学（女生男相除外）', '不收酒和荤食', '不向名誉过低之人传授武学'],
  },
  {
    id: 'wudang', name: '武当派', alignment: 'neutral', coreSkill: 'taoism',
    description: '与少林、峨眉共称武林三大名宗之一，最重内功修养，堪称天下内家功法第一。',
    techniqueIds: ['30401', '70401'], favorCoef: 1000,
    rules: ['不向名誉过低之人传授武学'],
  },
];

// ---------------- NPC 模板 ----------------

export const STUB_NPCS: NpcTemplate[] = [
  {
    id: 'shaolin_monk', name: '少林武僧', factionId: 'shaolin', rankRange: [7, 9], ageRange: [18, 45],
    attributes: { strength: [50, 80], constitution: [50, 80], focus: [40, 70] },
    techniqueIds: ['40101'], equipment: { weapons: ['82802'] },
    ai: { difficulty: 1, personality: { brave: 60, calm: 70 } },
  },
  {
    id: 'bandit', name: '山贼', rankRange: [9, 9], ageRange: [16, 50],
    attributes: { strength: [40, 70], constitution: [40, 60] },
    techniqueIds: [], equipment: { weapons: ['52901'] },
    ai: { difficulty: 0, personality: { brave: 70, calm: 30 } },
  },
];

// ---------------- 技艺（16 种，全量） ----------------

export const STUB_SKILLS: SkillDef[] = [
  { id: 'music', name: '音律', group: 'refined' },
  { id: 'chess', name: '弈棋', group: 'refined' },
  { id: 'poetry', name: '诗书', group: 'refined' },
  { id: 'painting', name: '绘画', group: 'refined' },
  { id: 'math', name: '术数', group: 'refined' },
  { id: 'appraisal', name: '品鉴', group: 'refined' },
  { id: 'forging', name: '锻造', group: 'craft' },
  { id: 'woodworking', name: '制木', group: 'craft' },
  { id: 'medicine', name: '医术', group: 'craft' },
  { id: 'toxicology', name: '毒术', group: 'craft' },
  { id: 'weaving', name: '织锦', group: 'craft' },
  { id: 'artisan', name: '巧匠', group: 'craft' },
  { id: 'taoism', name: '道法', group: 'misc' },
  { id: 'buddhism', name: '佛学', group: 'misc' },
  { id: 'cooking', name: '厨艺', group: 'misc' },
  { id: 'eclectic', name: '杂学', group: 'misc' },
];

export const STUB_BUNDLE: GameDataBundle = {
  items: STUB_WEAPONS,
  techniques: STUB_TECHNIQUES,
  factions: STUB_FACTIONS,
  npcs: STUB_NPCS,
  skills: STUB_SKILLS,
};
