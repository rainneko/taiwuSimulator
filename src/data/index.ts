import { GameDB } from './GameDB';
import { STUB_BUNDLE } from './stub-data';

export * from './types';
export { GameDB, Table, ItemTable, TechniqueTable, FactionTable, NpcTable, SkillTable, shortFactionName, type LoadOptions } from './GameDB';
export { STUB_BUNDLE, STUB_WEAPONS, STUB_TECHNIQUES, STUB_FACTIONS, STUB_NPCS, STUB_SKILLS } from './stub-data';

/** 全局单例：启动时调用一次 `gameDB.loadFromJson('/content')` 或 `gameDB.loadFromBundle(STUB_BUNDLE)` */
export const gameDB = new GameDB();

/** 新建一个装好桩数据的独立实例（测试/开发场景用，不影响单例） */
export function createStubDB(): GameDB {
  return GameDB.fromBundle(STUB_BUNDLE);
}
