import { Character } from '../core/character';
import { WorldClock, TurnManager } from '../core/world';
import type { CharacterData } from '../core/character/types';
import type { WorldData } from '../core/world';
import { services } from './services';
import { game } from './store';

/** 单个存档槽的元数据（列表用）。 */
export interface SaveMeta {
  slotId: string;
  playerName: string;
  /** 游戏内时间描述，如 "第1年 3月" */
  worldTime: string;
  /** 保存时间 ISO 字符串 */
  date: string;
}

/** localStorage 中存档的完整结构。 */
interface SavePayload {
  meta: SaveMeta;
  player: CharacterData;
  world: WorldData;
}

const PREFIX = 'taiwu.save.';
const LATEST_KEY = 'taiwu.save.latest';
const MAX_SLOTS = 5;
/** 允许的槽 id：auto + slot1–slot5 */
const VALID_SLOTS = ['auto', ...Array.from({ length: MAX_SLOTS }, (_, i) => `slot${i + 1}`)];

function isValidSlot(id: string): boolean {
  return VALID_SLOTS.includes(id);
}

function formatWorldTime(world: WorldData): string {
  return `第${world.time.year}年 ${world.time.month}月`;
}

export class SaveManager {

  /** 保存当前游戏状态到指定槽位。 */
  save(slotId: string): boolean {
    if (!isValidSlot(slotId)) return false;
    const player = services.player;
    const world = services.world;
    if (!player || !world) return false;

    const payload: SavePayload = {
      meta: {
        slotId,
        playerName: player.name,
        worldTime: formatWorldTime(world),
        date: new Date().toISOString(),
      },
      player: player.toJSON(),
      world: structuredClone(world),
    };

    try {
      localStorage.setItem(PREFIX + slotId, JSON.stringify(payload));
      localStorage.setItem(LATEST_KEY, slotId);
    } catch {
      console.warn('[SaveManager] localStorage write failed');
      return false;
    }
    return true;
  }

  /** 从指定槽位加载存档，恢复 services 和 game signals。 */
  load(slotId: string): boolean {
    let raw: string | null;
    try {
      raw = localStorage.getItem(PREFIX + slotId);
    } catch {
      return false;
    }
    if (!raw) return false;

    let payload: SavePayload;
    try {
      payload = JSON.parse(raw) as SavePayload;
    } catch {
      console.warn('[SaveManager] corrupt save data in slot', slotId);
      return false;
    }

    const player = Character.fromJSON(payload.player);
    const world = payload.world;
    const clock = new WorldClock(world);
    const turns = new TurnManager(clock);

    Object.assign(services, { player, world, clock, turns });
    game.player.value = player.data;
    game.world.value = world as unknown as Record<string, unknown>;
    game.time.value = world.time as unknown as Record<string, unknown>;

    try {
      localStorage.setItem(LATEST_KEY, slotId);
    } catch { /* best-effort */ }

    this.installAutoSave();
    console.info('[SaveManager] loaded slot', slotId, player.name);
    return true;
  }

  /** 返回所有已存在的存档元数据，按保存时间降序。 */
  list(): SaveMeta[] {
    const metas: SaveMeta[] = [];
    for (const id of VALID_SLOTS) {
      try {
        const raw = localStorage.getItem(PREFIX + id);
        if (!raw) continue;
        const payload = JSON.parse(raw) as SavePayload;
        if (payload.meta) metas.push(payload.meta);
      } catch {
        continue;
      }
    }
    metas.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return metas;
  }

  /** 删除指定槽位的存档。 */
  delete(slotId: string): boolean {
    try {
      localStorage.removeItem(PREFIX + slotId);
      // 若删除的是 latest，尝试指向下一个最新的
      const latestId = localStorage.getItem(LATEST_KEY);
      if (latestId === slotId) {
        const remaining = this.list();
        if (remaining.length) {
          localStorage.setItem(LATEST_KEY, remaining[0].slotId);
        } else {
          localStorage.removeItem(LATEST_KEY);
        }
      }
    } catch {
      return false;
    }
    return true;
  }

  /** 是否存在任何存档。 */
  hasLatest(): boolean {
    try {
      const id = localStorage.getItem(LATEST_KEY);
      if (!id) return false;
      return !!localStorage.getItem(PREFIX + id);
    } catch {
      return false;
    }
  }

  /** 加载最近一次保存的存档。 */
  loadLatest(): boolean {
    try {
      const id = localStorage.getItem(LATEST_KEY);
      if (!id) return false;
      return this.load(id);
    } catch {
      return false;
    }
  }

  /** 自动存档（存入 auto 槽）。 */
  autoSave(): boolean {
    return this.save('auto');
  }

  /** 所有合法的用户槽 id（不含 auto）。 */
  get userSlots(): string[] {
    return VALID_SLOTS.filter((s) => s !== 'auto');
  }

  /** 所有合法槽 id（含 auto）。 */
  get allSlots(): string[] {
    return VALID_SLOTS.slice();
  }

  /** 注册自动存档：监听 turn:end 事件，每回合结束后自动保存到 auto 槽。返回注销函数。 */
  installAutoSave(): () => void {
    const clock = services.clock;
    if (!clock) return () => {};
    const off = clock.bus.on('turn:end', () => {
      this.autoSave();
    });
    return off;
  }
}
