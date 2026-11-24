import { describe, it, expect } from 'vitest';
import { Character, BARE_HANDS, disorderPerf } from '../character';
import { DEFAULT_SCHEMA, defaultsOf } from '../../app/ui/NewGameWizard';
import { runHeadless } from '../combat/headless';
import { DEFAULT_STATS } from '../combat/fighter';
import type { WeaponDef } from '../combat/types';

const SWORD: WeaponDef = {
  id: 'sword', weaponClass: 'sword', baseSpeed: 6000, weight: 3,
  rangeMin: 2.0, rangeMax: 6.0, power: 1000, wheel: ['chop', 'stab', 'flick', 'chop', 'stab', 'wild'],
};

describe('Character', () => {
  it('从向导缺省参数创建玩家并转为 FighterConfig', () => {
    const c = Character.createPlayer(defaultsOf(DEFAULT_SCHEMA.steps.char));
    expect(c.isPlayer).toBe(true);
    expect(c.name).toBe('太吾');
    const fc = c.toFighterConfig();
    expect(fc.weapons[0]!.id).toBe(BARE_HANDS.id);
    expect(fc.stats).toBeDefined();
  });

  it('主属性>50 转化命中：膂力→力道 灵敏→迅疾 定力→精妙', () => {
    const c = Character.createPlayer({ surname: '李', given: '四', age: 20, attrs: { str: 4, agi: 2, int: 3, con: 1 } });
    expect(c.data.attrs).toMatchObject({ str: 70, agi: 60, int: 65, con: 55, bone: 50, res: 50 });
    const { attrs } = c.deriveAttrs();
    // 内息顺畅 +20% 发挥
    expect(disorderPerf(0)).toBe(20);
    expect(attrs.str).toBe(84);
    const s = c.deriveStats();
    expect(s.hitPower).toBe(DEFAULT_STATS.hitPower + 34);
    expect(s.hitSpeed).toBe(DEFAULT_STATS.hitSpeed + 22);
    expect(s.hitSkill).toBe(DEFAULT_STATS.hitSkill + 10);
  });

  it('装备/功法加成与基础操作', () => {
    const c = Character.createPlayer({});
    c.equipWeapon('main', SWORD);
    c.equipGear('armor', { id: 'robe', stats: { protection: 50 }, attrs: { res: 10 } });
    expect(c.learnTechnique('t1')).toBe(true);
    expect(c.learnTechnique('t1')).toBe(false);
    c.practiceTechnique('t1', 50);
    const fc = c.toFighterConfig({ techniques: id => (id === 't1' ? { stats: { attackSpeed: 20 } } : undefined) });
    expect(fc.weapons.map(w => w.id)).toEqual(['sword']);
    expect(fc.arts).toEqual(['t1']);
    expect(fc.stats!.protection).toBe(DEFAULT_STATS.protection + 50);
    expect(fc.stats!.attackSpeed).toBe(DEFAULT_STATS.attackSpeed + 10);
    expect(c.addFavor('npc1', 70000)).toBe(60000);
    const back = Character.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    expect(back.toFighterConfig()).toEqual(c.toFighterConfig());
  });

  it('两名角色可跑完一场无头战斗', () => {
    const a = Character.createPlayer({ surname: '甲', attrs: { str: 5 } });
    a.equipWeapon('main', SWORD);
    const b = Character.createNpc({ surname: '乙', given: '' });
    const st = runHeadless({ seed: 7n, fighters: [a.toFighterConfig(), b.toFighterConfig()] });
    expect(st.frame).toBeGreaterThan(0);
  });
});
