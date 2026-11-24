# 地区场景运行时产物：路径与对接说明

> 2026-11-24 · 地区场景美术专员。读者：写加载器的 region-scene 会话、总监、执行主管。
> 产物由 `python3 tools/art/pack_region.py` 一条命令生成。**只打已通过验收的图**（名单 `tools/art/batches/accepted.txt`）。打包从原图存档重新抠像到 `art/region/pack/`，不读 `art/region/work/`，所以出图方跑批次时也能打。

## 1. 产物与路径

运行时 URL = `${import.meta.env.BASE_URL}` + 下表路径。开发服务器以仓库根为 root，所以 `content/` 下的文件直接可取。

| 文件 | 内容 |
| --- | --- |
| `content/region/terrain-art.json` | **渲染参数**（总监定的加载路径）。`content/base/art/region/terrain-art.json` 是同一份的拷贝：`RegionScene.preload` 现在读的是这个旧路径，加载器改完后可删 |
| `content/base/art/region/region-terrain.{webp,json}` | 地形立牌，4096×2048 |
| `content/base/art/region/region-detail.{webp,json}` | 填充小件 + 地面散件，2048×1024 |
| `content/base/art/region/region-houses.{webp,json}` | 单栋房屋 + 前景小件 `loc.prop.*`（v1.4 从 terrain 挪来），2048×1024 |
| `content/base/art/region/region-locations.{webp,json}` | 野外地点、奇遇标记与回退用的 `loc.village.0`，2048×1024（尺寸随内容变，专属地点进来再放大） |
| `content/base/art/region/ground/ground.json` + `00-plain.webp` … `17-settlement.webp` + `ground-strip.webp` | 底纸数组：18 层，每层 768²，可平铺。另有一张竖向长图（768 × 768·18），一次请求、一次解码就能建 `DataArrayTexture` |
| `content/base/art/art-manifest.json` | artKey → `{atlas, frame}` / `{array, layer}` 的总表 |

图集尺寸按工单 §3.8（locations 已缩到 2048×1024）；像素密度：立牌 768 px / 格（近档一格约 640px，不放大）。**装不下时明确报错、不留旧图集**，不自动缩小。

## 2. AtlasJson（M3-WO1 §2.6，`src/render/paper/PaperBatch.ts` 的 `AtlasJson` 原样）

```json
{ "image": "region-terrain.webp", "size": [4096, 2048], "feather": 3.0, "padding": 8,
  "frames": [ { "name": "terrain.standee.woods.0", "rect": [x, y, w, h], "size": [0.61, 0.62], "anchor": [0.5, 0.0] } ] }
```

- `name` = artKey，和 `regionArt.ts` 的 `FRAMES` 键一致。
- `rect` 是像素，原点在图集**左上**，y 向下（与占位图集的 canvas 坐标相同）。建 `Texture` 时 `flipY = false` 才能直接用；否则 v 要换成 `1 − (y + h) / H`。
- `size` 是**世界单位，1 = 一格宽**（与占位图集一致；`regionArt.ts` 注释里写的「米」就是格）。宽按成图的实际宽高比算，所以和 `FRAMES` 的写死值可以不同：**以图集 JSON 为准**。
- `anchor` 一律 `[0.5, 0]`（底边中点），地面散件是 `[0.5, 0.5]`。
- 颜色是直通 alpha，透明区做过颜色外扩（防 mipmap 渗色）；`feather` / `padding` 是图集分辨率下的像素。

## 3. 和占位图集的差异

| | 占位（`makePlaceholderAtlas`） | 真实 |
| --- | --- | --- |
| 张数 | 一张 canvas 装下全部帧 | 四张图集，按 artKey 前缀分：`terrain.standee.*` → terrain；`filler.*`、`ground.piece.*` → detail；`house.*` 与 `loc.prop.*` → houses；`loc.village.*`、`poi.*` → locations。准确的归属看 `art-manifest.json` 的 `atlas` 字段，不要靠前缀猜 |
| 结构 | `{ texture, json: AtlasJson }` | 同一个 `Atlas` 结构，每张图集一份 |
| `anchor` | 没有（默认 0.5） | 有 |
| `size` | `FRAMES` 写死 | 按成图实际宽高比 |
| 纹理 | `CanvasTexture`，sRGB | WebP，建纹理时设 `SRGBColorSpace`、mipmap、`flipY = false` |

`PaperBatch` 一个批次只绑一张图集，所以按图集分批（地形批、细节批、房屋批），这和 RegionScene 现有的 `terrainBatch` / `detailBatch` / `houseBatch` 一一对应。

## 4. 缺帧约定

- 图集里**只有已验收的帧**。还没出或没验收的 artKey 不在任何图集里（`art-manifest.json` 里也没有它）。
- 加载器**逐帧回落**：真实图集里找不到某个 artKey 时，用占位图集的同名帧，而不是整张图集回落。
- 占位帧与真实帧在不同的图集里，所以回落的帧走一个单独的占位批次（或者干脆把占位帧也画进一张小的回落图集）。这由 region-scene 定。
- 底纸数组现在 18 层齐全。以后若缺层，`ground.json` 的 `layers` 里没有那一层，加载器用占位纯色补（`build_ground_array --allow-missing` 的做法）。
- `terrain-art.json` 的小件池（`fillers`、`pieces`）与 `standees` **已经去掉了没有图的 artKey**，按它撒点不会抽到缺帧。

## 5. terrain-art.json

```json
{ "version": 1, "levelStep": 0.05, "layers": true, "houses": true,
  "terrains": { "mountain": { "layer": 6, "stack": 120, "density": [1, 2], "level": { "edge": 1, "step": 1, "cap": 3 },
                              "fillers": [...], "fillerCount": [3, 5], "pieces": [...], "pieceCount": [1, 2],
                              "standees": ["terrain.standee.mountain.0", "terrain.standee.mountain.1"], "water": false } },
  "houseTypes": { "cottage": ["house.cottage.0", "house.cottage.1", "house.cottage.2"], "hall": ["house.hall.0"] } }
```

- `levelStep`、`houses` 正是 `parseTerrainArt` 现在读的两个字段，其余字段是新增的，读不懂的忽略即可。
- `level` 为 `null` = 0 层（不抬不陷）。湖泊的 `shore` 是岸边件池。
- 字段来源：密度、小件池取清单底纸项；`stack`、`level` 取 `preview_grid.py` 的 `STACK`、`LEVEL_RULES`（与工单 §3.2.1、§3.13 同源）。

## 6. 重新打包

- 新一批验收后，把它的 artKey 加进 `tools/art/batches/accepted.txt`，再跑 `python3 tools/art/pack_region.py`（约 5 分钟）。
- 第四批（青绿重出的房屋等）验收后，还要在 `@sources` 行最前面加 `batch4`，新图才会盖过旧图。
- `content/` 下的产物是生成物：要不要进 git（约 6MB）由主管定。
