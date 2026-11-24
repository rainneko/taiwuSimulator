/**
 * WO3 布置数据：由 tools/art/region-assets.json 生成（kind / section 过滤后原样搬运），勿手改；
 * 清单变了就按同样规则重新生成。
 * FRAMES：artKey → [宽, 高]（米；平放件为边长）。HOUSE_TYPES：houseKind → [artKey, 高, 宽高比][]（清单 J 段）。
 * FRAMES 在运行时由 setFrameSizes() 按 terrain-art.json / 真实图集的 frames 重建；读不到时就是这里的硬编码（FRAMES_DEFAULT）。
 */
export interface GroundArt { density: [number, number]; fillers: string[]; fillerCount: [number, number]; pieces: string[]; pieceCount: [number, number] }
export const GROUND_ART: Record<string, GroundArt> = {
  plain: {"density": [0, 2], "fillers": ["filler.tuft.0", "filler.tuft.1", "filler.flowers.0", "filler.flowers.1", "filler.bush.0", "filler.rock.0"], "fillerCount": [4, 7], "pieces": ["ground.piece.grass", "ground.piece.dirt", "ground.piece.pebbles"], "pieceCount": [1, 2]},
  lake: {"density": [0, 1], "fillers": ["filler.reeds", "filler.rock.0"], "fillerCount": [2, 4], "pieces": [], "pieceCount": [0, 0]},
  farmland: {"density": [0, 1], "fillers": ["filler.tuft.0", "filler.flowers.0"], "fillerCount": [1, 3], "pieces": ["ground.piece.dirt"], "pieceCount": [0, 1]},
  woods: {"density": [4, 6], "fillers": ["filler.bush.0", "filler.fern", "filler.mushrooms", "filler.stump", "filler.tuft.0", "filler.flowers.0"], "fillerCount": [4, 7], "pieces": ["ground.piece.leaves", "ground.piece.moss", "ground.piece.roots", "ground.piece.needles"], "pieceCount": [1, 3]},
  jungle: {"density": [5, 7], "fillers": ["filler.fern", "filler.bush.0", "filler.mushrooms", "filler.log", "filler.bamboo"], "fillerCount": [4, 7], "pieces": ["ground.piece.leaves", "ground.piece.moss", "ground.piece.roots"], "pieceCount": [2, 3]},
  garden: {"density": [2, 4], "fillers": ["filler.bush.0", "filler.bush.1", "filler.rock.1", "filler.flowers.0", "filler.bamboo"], "fillerCount": [3, 5], "pieces": ["ground.piece.pebbles", "ground.piece.petals"], "pieceCount": [1, 2]},
  mountain: {"density": [1, 2], "fillers": ["filler.rock.1", "filler.rock.0", "filler.tuft.1", "filler.thorn"], "fillerCount": [3, 5], "pieces": ["ground.piece.pebbles", "ground.piece.cracks"], "pieceCount": [1, 2]},
  cave: {"density": [1, 2], "fillers": ["filler.rock.1", "filler.mushrooms", "filler.deadwood"], "fillerCount": [2, 4], "pieces": ["ground.piece.pebbles", "ground.piece.puddle"], "pieceCount": [1, 2]},
  stoneForest: {"density": [2, 4], "fillers": ["filler.rock.1", "filler.rock.0", "filler.tuft.0"], "fillerCount": [2, 4], "pieces": ["ground.piece.pebbles"], "pieceCount": [1, 2]},
  hill: {"density": [2, 3], "fillers": ["filler.bush.0", "filler.tuft.0", "filler.tuft.1", "filler.flowers.1", "filler.rock.0"], "fillerCount": [4, 6], "pieces": ["ground.piece.grass", "ground.piece.dirt"], "pieceCount": [1, 2]},
  vale: {"density": [2, 4], "fillers": ["filler.flowers.0", "filler.flowers.1", "filler.bush.1", "filler.tuft.0"], "fillerCount": [5, 8], "pieces": ["ground.piece.petals", "ground.piece.grass"], "pieceCount": [2, 3]},
  mulberry: {"density": [3, 4], "fillers": ["filler.tuft.0", "filler.bush.0", "filler.flowers.0"], "fillerCount": [2, 4], "pieces": ["ground.piece.leaves", "ground.piece.dirt"], "pieceCount": [1, 2]},
  canyon: {"density": [1, 2], "fillers": ["filler.rock.1", "filler.deadwood", "filler.thorn"], "fillerCount": [2, 4], "pieces": ["ground.piece.cracks", "ground.piece.pebbles"], "pieceCount": [1, 2]},
  marsh: {"density": [1, 3], "fillers": ["filler.reeds", "filler.tuft.1", "filler.log", "filler.mushrooms"], "fillerCount": [4, 6], "pieces": ["ground.piece.puddle", "ground.piece.moss"], "pieceCount": [2, 3]},
  herbGarden: {"density": [1, 2], "fillers": ["filler.herbs", "filler.flowers.1", "filler.tuft.0"], "fillerCount": [3, 5], "pieces": ["ground.piece.dirt"], "pieceCount": [1, 1]},
  waste: {"density": [1, 2], "fillers": ["filler.deadwood", "filler.rock.0", "filler.rock.1", "filler.thorn", "filler.tuft.1"], "fillerCount": [3, 5], "pieces": ["ground.piece.cracks", "ground.piece.dirt", "ground.piece.pebbles"], "pieceCount": [1, 3]},
  abyss: {"density": [1, 2], "fillers": ["filler.rock.1", "filler.deadwood"], "fillerCount": [2, 3], "pieces": ["ground.piece.cracks"], "pieceCount": [1, 2]},
  settlement: {"density": [0, 0], "fillers": [], "fillerCount": [0, 0], "pieces": ["ground.piece.dirt", "ground.piece.pebbles"], "pieceCount": [1, 2]},
};
export const SHORE = {"fillers": ["filler.reeds", "filler.rock.0", "filler.tuft.1"], "count": [1, 3], "band": 0.12} as { fillers: string[]; count: [number, number]; band: number };
export const FRAMES_DEFAULT: Readonly<Record<string, readonly [number, number]>> = {
  "terrain.standee.plain.0": [0.405, 0.45],
  "terrain.standee.plain.1": [0.54, 0.45],
  "terrain.standee.lake.0": [0.33, 0.55],
  "terrain.standee.lake.1": [0.72, 0.45],
  "terrain.standee.farmland.0": [0.52, 0.52],
  "terrain.standee.farmland.1": [0.58, 0.58],
  "terrain.standee.woods.0": [0.496, 0.62],
  "terrain.standee.woods.1": [0.465, 0.62],
  "terrain.standee.jungle.0": [0.585, 0.65],
  "terrain.standee.jungle.1": [0.572, 0.52],
  "terrain.standee.garden.0": [0.493, 0.58],
  "terrain.standee.garden.1": [0.348, 0.58],
  "terrain.standee.mountain.0": [0.6, 0.5],
  "terrain.standee.mountain.1": [0.35, 0.5],
  "terrain.standee.cave.0": [0.605, 0.55],
  "terrain.standee.cave.1": [0.464, 0.58],
  "terrain.standee.stoneForest.0": [0.585, 0.65],
  "terrain.standee.stoneForest.1": [0.279, 0.62],
  "terrain.standee.hill.0": [0.728, 0.52],
  "terrain.standee.hill.1": [0.72, 0.48],
  "terrain.standee.vale.0": [0.589, 0.62],
  "terrain.standee.vale.1": [0.585, 0.45],
  "terrain.standee.mulberry.0": [0.52, 0.52],
  "terrain.standee.mulberry.1": [0.54, 0.45],
  "terrain.standee.canyon.0": [0.715, 0.55],
  "terrain.standee.canyon.1": [0.341, 0.62],
  "terrain.standee.marsh.0": [0.312, 0.52],
  "terrain.standee.marsh.1": [0.36, 0.45],
  "terrain.standee.herbGarden.0": [0.585, 0.45],
  "terrain.standee.herbGarden.1": [0.55, 0.55],
  "terrain.standee.waste.0": [0.558, 0.62],
  "terrain.standee.waste.1": [0.72, 0.45],
  "terrain.standee.abyss.0": [0.558, 0.62],
  "terrain.standee.abyss.1": [0.572, 0.52],
  "loc.city.default.0": [1.2995, 1.15],
  "loc.city.default.1": [1.2995, 1.15],
  "loc.sectSeat.default.0": [1.2996, 1.2],
  "loc.sectSeat.default.1": [1.2996, 1.2],
  "loc.town.0": [1.0503, 0.9],
  "loc.town.1": [1.0503, 0.9],
  "loc.fort.0": [1.0503, 0.9],
  "loc.fort.1": [1.0503, 0.9],
  "loc.village.0": [0.9997, 0.75],
  "loc.village.1": [0.9997, 0.75],
  "loc.village.2": [0.9997, 0.75],
  "poi.station": [0.65, 0.65],
  "poi.ruin": [0.65, 0.65],
  "poi.marker.cave": [0.65, 0.65],
  "poi.marker.stele": [0.65, 0.65],
  "poi.marker.pavilion": [0.65, 0.65],
  "loc.prop.wall": [0.552, 0.23],
  "loc.prop.lantern": [0.1305, 0.29],
  "loc.prop.poles": [0.231, 0.33],
  "loc.prop.tree": [0.297, 0.33],
  "loc.prop.fence": [0.48, 0.2],
  "loc.prop.steps": [0.36, 0.2],
  "filler.bush.0": [0.294, 0.21],
  "filler.bush.1": [0.3, 0.2],
  "filler.fern": [0.32, 0.2],
  "filler.tuft.0": [0.182, 0.14],
  "filler.tuft.1": [0.18, 0.2],
  "filler.reeds": [0.182, 0.26],
  "filler.flowers.0": [0.192, 0.12],
  "filler.flowers.1": [0.195, 0.13],
  "filler.rock.0": [0.192, 0.12],
  "filler.rock.1": [0.208, 0.16],
  "filler.mushrooms": [0.13, 0.1],
  "filler.stump": [0.182, 0.13],
  "filler.log": [0.312, 0.12],
  "filler.deadwood": [0.26, 0.2],
  "filler.thorn": [0.238, 0.17],
  "filler.bamboo": [0.174, 0.29],
  "filler.herbs": [0.182, 0.14],
  "ground.piece.dirt": [0.45, 0.45],
  "ground.piece.leaves": [0.38, 0.38],
  "ground.piece.moss": [0.38, 0.38],
  "ground.piece.pebbles": [0.34, 0.34],
  "ground.piece.petals": [0.38, 0.38],
  "ground.piece.puddle": [0.38, 0.38],
  "ground.piece.roots": [0.41, 0.41],
  "ground.piece.cracks": [0.45, 0.45],
  "ground.piece.needles": [0.34, 0.34],
  "ground.piece.grass": [0.45, 0.45],
  "house.cottage.0": [0.322, 0.28],
  "house.cottage.1": [0.308, 0.28],
  "house.cottage.2": [0.2835, 0.27],
  "house.tile.0": [0.396, 0.33],
  "house.tile.1": [0.391, 0.34],
  "house.long.0": [0.51, 0.3],
  "house.long.1": [0.5425, 0.31],
  "house.shop.0": [0.3825, 0.45],
  "house.tower.0": [0.3, 0.5],
  "house.hall.0": [0.715, 0.55],
};

/** 运行时帧尺寸表（dressing / 占位图集读它）。原地改写，引用它的模块不用重新取。 */
export const FRAMES: Record<string, [number, number]> = {};

type FrameSource = { name: string; size: [number, number] }[] | Record<string, [number, number]>;
const validSize = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length >= 2 && v.slice(0, 2).every((x) => typeof x === 'number' && x > 0 && Number.isFinite(x));

/**
 * 重建 FRAMES：先恢复硬编码，再按顺序叠上各来源（AtlasFrame[] 或 name → [宽, 高]）；坏条目跳过。
 * 返回被覆盖 / 新增的帧数。
 */
export function setFrameSizes(...sources: (FrameSource | null | undefined)[]): number {
  for (const k of Object.keys(FRAMES)) delete FRAMES[k];
  for (const [k, v] of Object.entries(FRAMES_DEFAULT)) FRAMES[k] = [v[0], v[1]];
  let n = 0;
  for (const src of sources) {
    if (!src) continue;
    const entries: [string, unknown][] = Array.isArray(src)
      ? src.filter((f) => f && typeof f.name === 'string').map((f) => [f.name, f.size])
      : Object.entries(src);
    for (const [name, size] of entries) if (validSize(size)) { FRAMES[name] = [size[0], size[1]]; n++; }
  }
  return n;
}
setFrameSizes();

export type HouseType = [artKey: string, height: number, aspect: number];
export const HOUSE_TYPES: Record<string, HouseType[]> = {
  cottage: [["house.cottage.0", 0.28, 1.15], ["house.cottage.1", 0.28, 1.1], ["house.cottage.2", 0.27, 1.05]],
  tile: [["house.tile.0", 0.33, 1.2], ["house.tile.1", 0.34, 1.15]],
  long: [["house.long.0", 0.3, 1.7], ["house.long.1", 0.31, 1.75]],
  shop: [["house.shop.0", 0.45, 0.85]],
  tower: [["house.tower.0", 0.5, 0.6]],
  hall: [["house.hall.0", 0.55, 1.3]],
};
