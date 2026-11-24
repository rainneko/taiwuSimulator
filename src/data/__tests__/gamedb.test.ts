import { describe, expect, it, vi } from 'vitest';
import { runHeadless } from '../../core/combat/headless';
import type { WeaponDef } from '../../core/combat/types';
import { createStubDB, GameDB, STUB_BUNDLE } from '..';

describe('GameDB（桩数据）', () => {
  const db = createStubDB();

  it('按 id 取、按类型过滤', () => {
    expect(db.items.get('52201')?.name).toBe('铁剑');
    expect(db.items.byType('weapon')).toHaveLength(5);
    expect(db.items.byType('book')).toHaveLength(0);
    expect(db.items.getAs('52201', 'weapon')?.weaponClass).toBe('sword');
    expect(() => db.items.require('nope')).toThrow();
    expect(db.skills.size).toBe(16);
    expect(db.warnings).toEqual([]);
  });

  it('按门派过滤功法：id / 全名 / 简称', () => {
    const ids = (k: string) => db.techniques.byFaction(k).map(t => t.id).sort();
    expect(ids('少林')).toEqual(['30108', '40101']);
    expect(ids('少林派')).toEqual(['30108', '40101']);
    expect(ids('wudang')).toEqual(['30401', '70401']);
    expect(ids('峨眉')).toEqual([]);
    expect(db.techniques.byKind('destroy')).toHaveLength(4);
  });

  it('只读：条目冻结、不可二次加载', () => {
    const w = db.items.require('52201');
    expect(Object.isFrozen(w)).toBe(true);
    expect(() => { (w as { power: number }).power = 1; }).toThrow();
    expect(() => db.loadFromBundle(STUB_BUNDLE)).toThrow(/已加载/);
    expect(() => new GameDB().items).toThrow(/尚未加载/);
  });

  it('武器与功法可直接喂给战斗引擎', () => {
    const sword: WeaponDef = db.items.getAs('52201', 'weapon')!;
    const blade: WeaponDef = db.items.getAs('52901', 'weapon')!;
    const arts = db.artRegistry();
    expect(Object.keys(arts.techniques)).toHaveLength(4);
    const state = runHeadless({
      seed: 7n,
      fighters: [
        { id: 'a', name: '太吾', weapons: [sword], arts: db.techniques.byFaction('武当').map(t => t.id) },
        { id: 'b', name: '山贼', weapons: [blade] },
      ],
      arts,
      ai: [{ difficulty: 2 }, { difficulty: 2 }],
    });
    expect(state.frame).toBeGreaterThan(0);
  });
});

describe('GameDB.loadFromJson', () => {
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

  it('从 basePath 读各表，缺文件视为空表', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/content/items.json') return json(STUB_BUNDLE.items);
      if (url === '/content/factions.json') return json(STUB_BUNDLE.factions);
      if (url === '/content/techniques.json') return json(STUB_BUNDLE.techniques);
      return new Response('not found', { status: 404 });
    });
    const db = new GameDB();
    await db.loadFromJson('/content/', { fetch: fetchMock as unknown as typeof fetch });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(db.items.size).toBe(5);
    expect(db.techniques.byFaction('少林')).toHaveLength(2);
    expect(db.npcs.size).toBe(0);
  });

  it('allowMissing=false 时缺文件报错；重复 id 报错', async () => {
    const f404 = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(new GameDB().loadFromJson('/content', { fetch: f404, allowMissing: false })).rejects.toThrow(/404/);
    const w = STUB_BUNDLE.items[0]!;
    expect(() => GameDB.fromBundle({ items: [w, w] })).toThrow(/重复 id/);
  });
});
