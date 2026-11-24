import type { FighterConfig, FighterStats, WeaponDef } from '../combat/types';
import { DEFAULT_STATS } from '../combat/fighter';
import { WEAPON_SPEED_CLASS } from '../combat/attack';
import {
  LIFE_SKILLS, MAIN_ATTRS,
  type CharacterData, type Gender, type GearDef, type LearnedTechnique, type LifeSkillType,
  type MainAttr, type MainAttrs, type NewGameCharParams, type TechniqueLookup, type WeaponSlot,
} from './types';

// === 常量（新游戏占位值：出生地区/特性数据接入后替换） ===

/** 新太吾六维基础值（原版受出生地区影响，见 旧/出生地区；暂取统一值） */
export const NEW_PLAYER_BASE_ATTR = 50;
/** 向导每分配 1 点对应的六维基础值增量 */
export const WIZARD_POINT_VALUE = 5;
export const DEFAULT_LIFESPAN = 80;
export const DEFAULT_INNER_BREATH = 100;
/** 主属性超过此值的部分 1:1 转化为对应命中。来源：旧/主要属性 */
export const ATTR_HIT_THRESHOLD = 50;

/** 空手：无武器时的缺省兵器 */
export const BARE_HANDS: WeaponDef = {
  id: 'bareHands', weaponClass: 'fist', baseSpeed: WEAPON_SPEED_CLASS.fast, weight: 0,
  rangeMin: 2.0, rangeMax: 3.0, power: 600, wheel: ['crash', 'flick', 'grab', 'crash', 'flick', 'grab'],
};

/** 内息紊乱分档对全属性发挥的影响（%）。来源：旧/内息 */
export function disorderPerf(disorder: number): number {
  if (disorder < 200) return 20;
  if (disorder < 400) return -20;
  if (disorder < 600) return -30;
  if (disorder < 800) return -50;
  return -80;
}

/** 年龄对各属性发挥的基础值（%）。TODO: 接 Data_EA__Age.tab（旧/年龄#属性发挥），暂恒为 100 */
export function ageBasePerf(_age: number, _attr: MainAttr): number {
  return 100;
}

const zeroAttrs = (): MainAttrs => ({ str: 0, con: 0, agi: 0, bone: 0, int: 0, res: 0 });

function addInto<K extends string>(dst: Record<K, number>, src: Partial<Record<K, number>> | undefined, scale = 1): void {
  if (!src) return;
  for (const k of Object.keys(src) as K[]) dst[k] = (dst[k] ?? 0) + (src[k] ?? 0) * scale;
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
};

let nextId = 1;

export interface DeriveOptions {
  /** 功法常驻加成查询；缺省则功法不提供加成 */
  techniques?: TechniqueLookup;
}

export interface DerivedAttrs {
  /** 有效六维 =（基础值 + 附加值）× 能力发挥 */
  attrs: MainAttrs;
  /** 能力发挥（%） */
  perf: MainAttrs;
  /** 装备最大负重 = 12 + 膂力×0.2 */
  equipLoadMax: number;
}

export class Character {
  constructor(public data: CharacterData) {}

  get id(): string { return this.data.id; }
  get name(): string { return this.data.surname + this.data.given; }
  get isPlayer(): boolean { return this.data.isPlayer; }

  /** 从新游戏向导参数（NewGameParams）创建玩家角色 */
  static createPlayer(params: NewGameCharParams | Record<string, unknown>, id = 'player'): Character {
    const p = params as NewGameCharParams;
    const age = clampInt(p.age, 1, 120, 16);
    const attrs: MainAttrs = { str: 0, con: 0, agi: 0, bone: 0, int: 0, res: 0 };
    for (const k of MAIN_ATTRS) attrs[k] = NEW_PLAYER_BASE_ATTR;
    const pts = (p.attrs ?? {}) as Record<string, unknown>;
    for (const k of ['str', 'agi', 'int', 'con'] as const) {
      attrs[k] += clampInt(pts[k], 0, 100, 0) * WIZARD_POINT_VALUE;
    }
    const lifespan = DEFAULT_LIFESPAN;
    const healthMax = Math.max(1, lifespan - age);
    const lifeSkills = Object.fromEntries(LIFE_SKILLS.map(s => [s, 0])) as Record<LifeSkillType, number>;
    return new Character({
      id,
      surname: typeof p.surname === 'string' && p.surname ? p.surname : '太吾',
      given: typeof p.given === 'string' ? p.given : '',
      gender: (p.gender === 'f' ? 'f' : 'm') as Gender,
      look: typeof p.look === 'string' ? p.look : 'a',
      isPlayer: true,
      age, lifespan, health: healthMax, healthMax,
      innerBreath: DEFAULT_INNER_BREATH,
      disorder: 0,
      attrs,
      techniques: [],
      equipment: { weaponMain: null, weaponSub: null, armor: null, accessory: null },
      lifeSkills,
      favor: {},
    });
  }

  /** 生成一个 NPC（测试/占位用） */
  static createNpc(partial: Partial<CharacterData> & { surname: string; given: string }): Character {
    const base = Character.createPlayer({ surname: partial.surname, given: partial.given }, partial.id ?? `npc${nextId++}`).data;
    return new Character({ ...base, ...partial, isPlayer: false });
  }

  // === 基础操作 ===

  equipWeapon(slot: WeaponSlot, weapon: WeaponDef | null): WeaponDef | null {
    const key = slot === 'main' ? 'weaponMain' : 'weaponSub';
    const prev = this.data.equipment[key];
    this.data.equipment[key] = weapon;
    return prev;
  }

  equipGear(slot: 'armor' | 'accessory', gear: GearDef | null): GearDef | null {
    const prev = this.data.equipment[slot];
    this.data.equipment[slot] = gear;
    return prev;
  }

  getTechnique(id: string): LearnedTechnique | undefined {
    return this.data.techniques.find(t => t.id === id);
  }

  /** 学会功法（修习度 0）；已学则返回 false */
  learnTechnique(id: string, practice = 0): boolean {
    if (this.getTechnique(id)) return false;
    this.data.techniques.push({ id, practice: clampInt(practice, 0, 100, 0) });
    return true;
  }

  /** 装入/卸下运功栏；未学会返回 false */
  setTechniqueEquipped(id: string, equipped: boolean): boolean {
    const t = this.getTechnique(id);
    if (!t) return false;
    t.equipped = equipped;
    return true;
  }

  /** 运功栏中的功法 */
  equippedTechniques(): LearnedTechnique[] {
    return this.data.techniques.filter(t => t.equipped);
  }

  forgetTechnique(id: string): boolean {
    const n = this.data.techniques.length;
    this.data.techniques = this.data.techniques.filter(t => t.id !== id);
    return this.data.techniques.length !== n;
  }

  /** 增加修习度，返回新值 */
  practiceTechnique(id: string, delta: number): number {
    const t = this.getTechnique(id);
    if (!t) throw new Error(`technique ${id} not learned`);
    t.practice = Math.min(100, Math.max(0, t.practice + delta));
    return t.practice;
  }

  setFavor(targetId: string, value: number): void {
    this.data.favor[targetId] = clampInt(value, 0, 60000, 0);
  }
  addFavor(targetId: string, delta: number): number {
    this.setFavor(targetId, (this.data.favor[targetId] ?? 0) + delta);
    return this.data.favor[targetId]!;
  }

  // === 属性派生 ===

  private gear(): GearDef[] {
    const e = this.data.equipment;
    return [e.armor, e.accessory].filter((g): g is GearDef => g !== null);
  }

  /** 主要属性 =（人物基础值 + 附加值）× 能力发挥。来源：旧/主要属性 */
  deriveAttrs(opts: DeriveOptions = {}): DerivedAttrs {
    const bonus = zeroAttrs();
    const perfBonus = zeroAttrs();
    for (const g of this.gear()) { addInto(bonus, g.attrs); addInto(perfBonus, g.attrPerf); }
    if (opts.techniques) {
      for (const t of this.equippedTechniques()) {
        const tb = opts.techniques(t.id);
        if (!tb) continue;
        const s = t.practice / 100;
        addInto(bonus, tb.attrs, s);
        addInto(perfBonus, tb.attrPerf, s);
      }
    }
    const dp = disorderPerf(this.data.disorder);
    const attrs = zeroAttrs();
    const perf = zeroAttrs();
    for (const k of MAIN_ATTRS) {
      perf[k] = Math.max(0, ageBasePerf(this.data.age, k) + perfBonus[k] + dp);
      attrs[k] = Math.floor((this.data.attrs[k] + bonus[k]) * perf[k] / 100);
    }
    return { attrs, perf, equipLoadMax: 12 + attrs.str * 0.2 };
  }

  /**
   * 战斗属性：缺省值 + 主属性转化 + 装备 + 功法。
   * - 膂力 > 50 每点 +1 力道；灵敏 → 迅疾；定力 → 精妙（来源：旧/主要属性。注意精妙对应定力，非悟性）
   * - 攻速基础 100%；武器重量对出手间隔的影响在战斗引擎 calcAttackInterval 中计算
   * - 武器自带命中/破体等由战斗引擎从 WeaponDef 读取，不叠入此处
   */
  deriveStats(opts: DeriveOptions = {}): FighterStats {
    const { attrs } = this.deriveAttrs(opts);
    const s: FighterStats = { ...DEFAULT_STATS };
    const over = (v: number) => Math.max(0, v - ATTR_HIT_THRESHOLD);
    s.hitPower += over(attrs.str);
    s.hitSpeed += over(attrs.agi);
    s.hitSkill += over(attrs.res);
    s.innerBreath = this.data.innerBreath;
    const flat = s as unknown as Record<string, number>;
    for (const g of this.gear()) addInto(flat, g.stats as Record<string, number> | undefined);
    if (opts.techniques) {
      for (const t of this.equippedTechniques()) {
        const tb = opts.techniques(t.id);
        if (tb?.stats) addInto(flat, tb.stats as Record<string, number>, t.practice / 100);
      }
    }
    for (const k of Object.keys(s) as (keyof FighterStats)[]) s[k] = Math.floor(s[k]);
    return s;
  }

  /** 装备中的武器（主、副），都没有则空手 */
  weapons(): WeaponDef[] {
    const e = this.data.equipment;
    const ws = [e.weaponMain, e.weaponSub].filter((w): w is WeaponDef => w !== null);
    return ws.length ? ws : [BARE_HANDS];
  }

  /** 转换为战斗引擎配置 */
  toFighterConfig(opts: DeriveOptions = {}): FighterConfig {
    return {
      id: this.data.id,
      name: this.name,
      stats: this.deriveStats(opts),
      weapons: this.weapons().map(w => ({ ...w, wheel: w.wheel.slice() })),
      arts: this.equippedTechniques().map(t => t.id),
    };
  }

  /** 深拷贝的存档数据 */
  toJSON(): CharacterData {
    return structuredClone(this.data);
  }
  static fromJSON(d: CharacterData): Character {
    return new Character(structuredClone(d));
  }
}
