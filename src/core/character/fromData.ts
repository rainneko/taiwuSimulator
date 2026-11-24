import type { AccessoryItemDef, ArmorItemDef, ItemDef } from '../../data/types';
import type { GameDB } from '../../data/GameDB';
import type { Character } from './Character';
import type { GearDef, TechniqueLookup } from './types';

/**
 * GameDB → 角色的适配层。core/character 只依赖 src/data 的类型，GameDB 实例由调用方传入。
 */

/** 运功效果查询：TechniqueDef.equipBonus → TechniqueBonus.stats */
export function techniqueLookupFromDB(db: GameDB): TechniqueLookup {
  return (id) => {
    const def = db.loaded ? db.techniques.get(id) : undefined;
    return def?.equipBonus ? { stats: def.equipBonus } : undefined;
  };
}

/**
 * 衣甲/饰品条目 → GearDef。
 * 护甲坚韧 → armorToughness。ArmorItemDef.guard（外/内伤防护千分比）尚无对应战斗属性，暂不计入。
 */
export function gearFromItem(item: ArmorItemDef | AccessoryItemDef): GearDef {
  const stats = { ...item.bonus };
  if (item.type === 'armor') stats.armorToughness = (stats.armorToughness ?? 0) + item.toughness;
  return { id: item.id, name: item.name, grade: item.grade, stats };
}

/**
 * 按物品类型装备：武器先填主手、再填副手（都满则替换主手）；身甲 → 衣甲槽；饰品 → 饰品槽。
 * 头/手/脚护具暂无槽位，返回 false。
 */
export function equipItem(c: Character, item: ItemDef): boolean {
  switch (item.type) {
    case 'weapon': {
      const e = c.data.equipment;
      c.equipWeapon(e.weaponMain && !e.weaponSub ? 'sub' : 'main', item);
      return true;
    }
    case 'armor':
      if (item.slot !== 'body') return false;
      c.equipGear('armor', gearFromItem(item));
      return true;
    case 'accessory':
      c.equipGear('accessory', gearFromItem(item));
      return true;
    default:
      return false;
  }
}
