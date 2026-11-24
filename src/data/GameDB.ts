import type { ArtRegistry, GuardSkillData, MovementArtData, TechniqueData } from '../core/combat/types';
import {
  TABLE_NAMES,
  type FactionDef, type GameDataBundle, type ItemDef, type ItemOfType, type ItemType,
  type NpcTemplate, type SkillDef, type SkillKey, type TableName, type TechniqueDef,
  type TechniqueKind, type TechniqueOfKind,
} from './types';

/**
 * 只读表：按 id 索引，保持数据文件中的顺序。
 * 条目在入表时被深冻结；类型上不加 readonly，以便直接作为 WeaponDef/TechniqueData 传给战斗引擎
 * （引擎创建 FighterState 时会复制武器，不会改写原条目）。
 */
export class Table<T extends { id: string }> {
  protected readonly map: ReadonlyMap<string, T>;
  protected readonly list: readonly T[];

  constructor(readonly name: string, rows: readonly T[]) {
    const m = new Map<string, T>();
    for (const r of rows) {
      if (!r || typeof r.id !== 'string' || r.id === '') throw new Error(`[GameDB] ${name}: 条目缺少字符串 id: ${JSON.stringify(r)}`);
      if (m.has(r.id)) throw new Error(`[GameDB] ${name}: 重复 id "${r.id}"`);
      m.set(r.id, deepFreeze(r));
    }
    this.map = m;
    this.list = Object.freeze([...m.values()]);
  }

  get size(): number { return this.list.length; }
  get(id: string): T | undefined { return this.map.get(id); }
  has(id: string): boolean { return this.map.has(id); }
  /** 取不到则抛错，用于引用必然存在的场合 */
  require(id: string): T {
    const v = this.map.get(id);
    if (!v) throw new Error(`[GameDB] ${this.name}: 未找到 id "${id}"`);
    return v;
  }
  all(): readonly T[] { return this.list; }
  filter(pred: (row: T) => boolean): T[] { return this.list.filter(pred); }
  find(pred: (row: T) => boolean): T | undefined { return this.list.find(pred); }
  [Symbol.iterator](): Iterator<T> { return this.list[Symbol.iterator](); }
}

export class ItemTable extends Table<ItemDef> {
  private readonly typeIndex = new Map<ItemType, ItemDef[]>();

  constructor(rows: readonly ItemDef[]) {
    super('items', rows);
    for (const r of this.list) {
      const arr = this.typeIndex.get(r.type) ?? [];
      arr.push(r);
      this.typeIndex.set(r.type, arr);
    }
  }

  byType<K extends ItemType>(type: K): readonly ItemOfType<K>[] {
    return (this.typeIndex.get(type) ?? []) as ItemOfType<K>[];
  }

  /** 按 id 取并校验类型，如 getAs('52201', 'weapon') → WeaponItemDef */
  getAs<K extends ItemType>(id: string, type: K): ItemOfType<K> | undefined {
    const v = this.get(id);
    return v?.type === type ? v as ItemOfType<K> : undefined;
  }
}

export class TechniqueTable extends Table<TechniqueDef> {
  constructor(rows: readonly TechniqueDef[], private readonly resolveFaction: (key: string) => FactionDef | undefined) {
    super('techniques', rows);
  }

  byKind<K extends TechniqueKind>(kind: K): TechniqueOfKind<K>[] {
    return this.list.filter(t => t.kind === kind) as TechniqueOfKind<K>[];
  }

  /** 按门派过滤：接受门派 id、全名（少林派）或简称（少林） */
  byFaction(key: string): TechniqueDef[] {
    const f = this.resolveFaction(key);
    return f ? this.list.filter(t => t.factionId === f.id) : [];
  }
}

export class FactionTable extends Table<FactionDef> {
  /** id → 全名 → 简称（全名去掉 派/门/宗/教/谷/坛/山庄 后缀） */
  resolve(key: string): FactionDef | undefined {
    return this.get(key)
      ?? this.find(f => f.name === key)
      ?? this.find(f => shortFactionName(f.name) === key);
  }
}

export class NpcTable extends Table<NpcTemplate> {
  byFaction(factionId: string): NpcTemplate[] { return this.list.filter(n => n.factionId === factionId); }
}

export class SkillTable extends Table<SkillDef> {
  override get(id: SkillKey | string): SkillDef | undefined { return super.get(id); }
}

export function shortFactionName(name: string): string {
  return name.replace(/(山庄|派|门|宗|教|谷|坛)$/, '');
}

export interface LoadOptions {
  /** 缺失的 JSON 文件视为空表（默认 true）；false 时缺文件直接报错 */
  allowMissing?: boolean;
  fetch?: typeof fetch;
}

/**
 * 游戏内容数据库。一个实例只能加载一次，加载后所有表与条目只读。
 *
 * 用法：
 *   await gameDB.loadFromJson('/content');   // public/content/*.json
 *   gameDB.items.byType('weapon')            // 可直接放进 FighterConfig.weapons
 *   gameDB.techniques.byFaction('少林')
 *   gameDB.artRegistry()                      // 直接作为 CombatConfig.arts
 */
export class GameDB {
  private _items?: ItemTable;
  private _techniques?: TechniqueTable;
  private _factions?: FactionTable;
  private _npcs?: NpcTable;
  private _skills?: SkillTable;
  private _artRegistry?: ArtRegistry;
  /** 加载时发现的非致命问题（悬空引用等） */
  private _warnings: string[] = [];

  static fromBundle(bundle: Partial<GameDataBundle>): GameDB {
    const db = new GameDB();
    db.loadFromBundle(bundle);
    return db;
  }

  get loaded(): boolean { return this._items !== undefined; }
  get warnings(): readonly string[] { return this._warnings; }

  get items(): ItemTable { return this.need(this._items); }
  get techniques(): TechniqueTable { return this.need(this._techniques); }
  get factions(): FactionTable { return this.need(this._factions); }
  get npcs(): NpcTable { return this.need(this._npcs); }
  get skills(): SkillTable { return this.need(this._skills); }

  /** 从 `${basePath}/<table>.json` 读取各表（每个文件是条目数组） */
  async loadFromJson(basePath = '/content', opts: LoadOptions = {}): Promise<void> {
    this.assertNotLoaded();
    const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const allowMissing = opts.allowMissing ?? true;
    const base = basePath.replace(/\/+$/, '');
    const entries = await Promise.all(TABLE_NAMES.map(async name => {
      const url = `${base}/${name}.json`;
      const res = await doFetch(url);
      if (!res.ok) {
        if (res.status === 404 && allowMissing) return [name, []] as const;
        throw new Error(`[GameDB] 加载 ${url} 失败：HTTP ${res.status}`);
      }
      const text = await res.text();
      let data: unknown;
      try { data = JSON.parse(text); } catch (e) {
        // Vite dev server 对不存在的文件会回退返回 index.html
        if (allowMissing && /^\s*</.test(text)) return [name, []] as const;
        throw new Error(`[GameDB] ${url} 不是合法 JSON：${(e as Error).message}`);
      }
      if (!Array.isArray(data)) throw new Error(`[GameDB] ${url} 顶层必须是数组`);
      return [name, data] as const;
    }));
    this.loadFromBundle(Object.fromEntries(entries) as Partial<GameDataBundle>);
  }

  /** 从内存数据包加载（stub、测试、打包进 bundle 的数据） */
  loadFromBundle(bundle: Partial<GameDataBundle>): void {
    this.assertNotLoaded();
    const factions = new FactionTable('factions', bundle.factions ?? []);
    const items = new ItemTable(bundle.items ?? []);
    const techniques = new TechniqueTable(bundle.techniques ?? [], k => factions.resolve(k));
    const npcs = new NpcTable('npcs', bundle.npcs ?? []);
    const skills = new SkillTable('skills', bundle.skills ?? []);
    this._warnings = validateRefs(items, techniques, factions, npcs);
    for (const w of this._warnings) console.warn(w);
    this._factions = factions;
    this._items = items;
    this._techniques = techniques;
    this._npcs = npcs;
    this._skills = skills;
  }

  /** 把功法表转成战斗引擎的 ArtRegistry（结果缓存、冻结） */
  artRegistry(): ArtRegistry {
    if (this._artRegistry) return this._artRegistry;
    const reg: ArtRegistry = { techniques: {}, guardSkills: {}, movementArts: {} };
    for (const t of this.techniques) {
      if (t.kind === 'destroy') reg.techniques[t.id] = t satisfies TechniqueData;
      else if (t.kind === 'guard') reg.guardSkills[t.id] = t satisfies GuardSkillData;
      else if (t.kind === 'movement') reg.movementArts[t.id] = t satisfies MovementArtData;
    }
    this._artRegistry = deepFreeze(reg);
    return this._artRegistry;
  }

  private need<T>(t: T | undefined): T {
    if (t === undefined) throw new Error('[GameDB] 数据尚未加载，先调用 loadFromJson() 或 loadFromBundle()');
    return t;
  }

  private assertNotLoaded(): void {
    if (this.loaded) throw new Error('[GameDB] 已加载，数据只读；如需另一份数据请新建 GameDB 实例');
  }
}

function validateRefs(items: ItemTable, techniques: TechniqueTable, factions: FactionTable, npcs: NpcTable): string[] {
  const w: string[] = [];
  for (const t of techniques) {
    if (t.factionId && !factions.has(t.factionId)) w.push(`[GameDB] 功法 ${t.id}(${t.name}) 引用了不存在的门派 ${t.factionId}`);
  }
  for (const f of factions) {
    for (const id of f.techniqueIds) if (!techniques.has(id)) w.push(`[GameDB] 门派 ${f.id}(${f.name}) 引用了不存在的功法 ${id}`);
  }
  for (const n of npcs) {
    if (n.factionId && !factions.has(n.factionId)) w.push(`[GameDB] NPC 模板 ${n.id} 引用了不存在的门派 ${n.factionId}`);
    for (const id of n.techniqueIds) if (!techniques.has(id)) w.push(`[GameDB] NPC 模板 ${n.id} 引用了不存在的功法 ${id}`);
    for (const id of n.equipment.weapons) {
      const it = items.get(id);
      if (!it) w.push(`[GameDB] NPC 模板 ${n.id} 引用了不存在的武器 ${id}`);
      else if (it.type !== 'weapon') w.push(`[GameDB] NPC 模板 ${n.id} 的武器槽引用了非武器物品 ${id}`);
    }
  }
  for (const b of items.byType('book')) {
    if (b.teaches.kind === 'technique' && !techniques.has(b.teaches.techniqueId)) w.push(`[GameDB] 书籍 ${b.id} 引用了不存在的功法 ${b.teaches.techniqueId}`);
  }
  return w;
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
