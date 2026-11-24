# 地区场景第一批出图工单：五种地形的完整切片（35 张）

> 读者：在本仓库工作区里出图的 GPT / Codex。按第 0–5 步做，结果写进第 5 步的报告。
> 工单版本 v1.0 · 2026-11-24 · 执行主管撰写
> 规格与验收的出处：`docs/work-orders/M3-WO3-region-art-assets.md`（§1 尺寸、§2 出图规范与验收、§7.6 批量出图）。prompt 原文：`docs/art-prompts/region.md`。试点的做法与教训：`docs/art-prompts/region-pilot.md`、`art/region/review/pilot-report.md`。
> 所有路径都相对仓库根目录 `/Users/Rainy/PycharmProjects/taiwuSimulator/`。

## 这一批要达到什么

试点 6 张已经定下风格：**`terrain.standee.woods.0`（林地立牌）是风格基准**（用户 2026-11-24 确认），`terrain.ground.plain`（原野底纸）是底纸基准。

这一批把**原野、林地、山岳、湖泊、沼泽**五种地形和**聚居地基**需要的图全部出齐：底纸、主体立牌、立牌之间的填充小件、平贴在地上的散件。出完之后，预览里这五种地形不再有任何占位色块，用户可以第一次看到一张「全是真图」的地图，据此定密度、层次和整体观感。

其余 12 种地形、地点立牌、装饰纹理、房屋部件都**不在这一批**，不要顺手出。

## 要出的 35 张

每条 prompt 是 `region.md` 里 **`- artKey：` 那一行与表中 artKey 相同的那一节**的代码块。按 artKey 找，不要按标题前面的序号找（序号会随清单更新而变）。代码块**整块原样使用**，不删减、不改写；表里的「另外叮嘱」是出这张图时在 prompt 之外补充说的话。

画幅全部 **1024×1024**。

### 第 1 组　底纸（5 张，不透明，四边无缝平铺）

| # | artKey（= 文件名） | 是什么 | 另外叮嘱 |
| --- | --- | --- | --- |
| 1 | `terrain.ground.woods` | 林地的林下地面 | 就是试点第二轮要重出的那张。如果第二轮已经重出并通过，把成图复制到本批目录即可，不用再出。不画树冠、树干 |
| 2 | `terrain.ground.mountain` | 山岳的岩土地面 | 颜色取**偏暖的青灰**（带一点赭石、土褐的岩土色），要和湖泊的冷蓝、原野的草绿一眼分得开。不画山峰，不画立起来的石块 |
| 3 | `terrain.ground.lake` | 湖泊的水面 | 颜色取**偏冷的灰青蓝**。整幅只有水：不画岸、荷叶、船、石头。水纹细而淡 |
| 4 | `terrain.ground.marsh` | 沼泽的泥水地 | 水洼要小而多、均匀散布，不要画成一两个大池塘。不画立起来的草 |
| 5 | `terrain.ground.settlement` | 聚居地的铺地 | 石板大小相近、排成规则的方格（这张图在游戏里会被旋转 90°，方格转过去要还是方格） |

### 第 2 组　主体立牌（8 张，透明底或纯品红底）

| # | artKey | 是什么 | 另外叮嘱 |
| --- | --- | --- | --- |
| 6 | `terrain.standee.woods.1` | 两棵针叶树 | 和基准那棵圆冠阔叶树要一眼分得开：剪影是尖的、分层的 |
| 7 | `terrain.standee.mountain.1` | 一座缠着纸云的孤峰 | 和试点的三峰（`terrain.standee.mountain.0`）分得开：这张是单峰、竖长 |
| 8 | `terrain.standee.plain.0` | 一丛带草穗的野草 | — |
| 9 | `terrain.standee.plain.1` | 一块卵石和几朵野花 | — |
| 10 | `terrain.standee.lake.0` | 一丛芦苇 | — |
| 11 | `terrain.standee.lake.1` | 一只系在木桩上的空船 | 船上、岸边都没有人 |
| 12 | `terrain.standee.marsh.0` | 几根蒲草 | 和 #10 的芦苇分得开：蒲草顶上是深褐色的圆柱形穗 |
| 13 | `terrain.standee.marsh.1` | 一截长着蘑菇的朽木桩 | — |

### 第 3 组　填充小件（13 张，透明底或纯品红底）

这些是摆在主体立牌之间的小东西，进游戏后只有 0.10–0.26 格高（近档屏幕上约 65–165 像素），所以**造型要简单、块面要大**：两三层纸片、几笔纹样就够，细碎的小叶小刺缩小后只会变成噪点。

| # | artKey | 是什么 |
| --- | --- | --- |
| 14 | `filler.bush.0` | 圆灌木 |
| 15 | `filler.fern` | 蕨丛 |
| 16 | `filler.tuft.0` | 草簇 |
| 17 | `filler.tuft.1` | 草穗 |
| 18 | `filler.reeds` | 芦苇丛（比 #10 小、简单） |
| 19 | `filler.flowers.0` | 浅色野花 |
| 20 | `filler.flowers.1` | 深色野花 |
| 21 | `filler.rock.0` | 卵石 |
| 22 | `filler.rock.1` | 棱石 |
| 23 | `filler.mushrooms` | 蘑菇 |
| 24 | `filler.stump` | 树桩 |
| 25 | `filler.log` | 倒木 |
| 26 | `filler.thorn` | 荆棘 |

### 第 4 组　地面散件（9 张，透明底或纯品红底）

这些是**平贴在地上**的薄纸件，从正上方看，不立起来。

| # | artKey | 是什么 |
| --- | --- | --- |
| 27 | `ground.piece.grass` | 深草斑 |
| 28 | `ground.piece.dirt` | 泥土斑 |
| 29 | `ground.piece.pebbles` | 碎石 |
| 30 | `ground.piece.leaves` | 落叶 |
| 31 | `ground.piece.moss` | 苔藓 |
| 32 | `ground.piece.roots` | 盘根 |
| 33 | `ground.piece.needles` | 松针 |
| 34 | `ground.piece.cracks` | 龟裂 |
| 35 | `ground.piece.puddle` | 水洼 |

## 第 0 步：先看参考图（每次新开对话都要做）

依次查看，再开始出图：

| 文件 | 看什么 |
| --- | --- |
| `assets/art-source/region/refs/papertrails-village.png` | 质感的来源：每个物体是一张模切的厚卡纸片，正面印着手绘插画，剪影四周一圈白色纸芯 |
| `assets/art-source/region/refs/papertrails-hero.png` | 整体的微缩立体书感，地面是一整张印着色块的纸 |
| `assets/art-source/region/refs/papertrails-village-night.png` | 纸片画面本身不画光影，光是场景给的 |
| `assets/art-source/region/trial/terrain.standee.woods.0.png` | **本项目的风格基准**。之后每张立牌、小件的纸厚、纸芯白边、插画笔触、配色都向它看齐 |
| `assets/art-source/region/trial/terrain.ground.plain.png` | **本项目的底纸基准**。之后每张底纸的纹样细碎程度、安静程度、饱和度都向它看齐 |
| `art/region/review/preview-near-s1.png` | 尺度：近档一屏约 3 格横宽。看一格里立牌、小件各有多大 |

三张 papertrails 截图来自 https://github.com/xikhar/papertrails （MIT 开源），**只学质感与做法，不照搬**它的具体物件、构图或配色。我们的配色是宣纸米白、赭石、土黄、苔绿、靛青与墨色，另有约两成淡墨点缀（prompt 里已写明）。

**不要使用**仓库里的这些目录作为参考，也不要打开、上传或模仿其中的图：`assets/main-menu/`、`assets/spine/`、`assets/world-map/`、`assets/map_terrain/`、`assets/paper-ui/`、`data/wiki/images/`。本批素材全部按 prompt 从零画。基准图只能是上表里本项目自己出、已通过验收的那两张。

## 第 1 步：出图顺序

按组做，一组做完、过了第 4 步的检查，再做下一组。四组可以分几次做，不必一口气出完。

1. **第 1 组 底纸**。先出 #2 山岳和 #3 湖泊（用户正等着用它们判断地形高低层次的效果），再出其余三张。每张都附上底纸基准 `terrain.ground.plain.png`，要求「纹样的细碎程度、安静程度、饱和度与它一致，只换内容和主色」。
2. **第 2 组 主体立牌**。每张都附上风格基准 `terrain.standee.woods.0.png`，要求「纸厚、纸芯白边、插画笔触、低饱和配色、淡墨点缀的比例与它保持一致」。
3. **第 3 组 填充小件**。同样附风格基准。先出 #14 圆灌木，自查过关后把它也当作小件的参照，其余 12 张要求「繁简程度与圆灌木一致」。
4. **第 4 组 地面散件**。附底纸基准，并说明「这张纸件会平贴在这种地面上：颜色要和地面协调，但深浅要差开一号，贴上去看得出来」。

同一组尽量在**同一个对话**里连续出。对话太长或风格开始漂移时，新开对话，先重做第 0 步再继续。

## 第 2 步：保存

- 每张存为 `assets/art-source/region/batch1/<artKey>.png`，文件名严格等于表里的 artKey（例如 `assets/art-source/region/batch1/filler.bush.0.png`）。
- 出图工具如果先把图存到 `generated_images/` 之类的目录，**复制**过来并改名，原文件不要删。
- 重出时直接覆盖同名文件；想保留旧版本就另存为 `<artKey>.v1.png`、`<artKey>.v2.png`（流水线只读不带后缀的那张）。
- 这个目录在 `.gitignore` 里，不要 `git add`、不要 commit。

## 第 3 步：每张图的自查判据（出完立刻看，不过关就重出，每张最多重出 3 次）

**全部**：没有任何文字、字母、数字、印章、签名、水印、边框；没有人物和动物；不是照片质感，也不是 3D 渲染质感，而是印在卡纸上的手绘插画。

**底纸（第 1 组）**
- 正上方垂直俯视，没有透视、地平线、天空；铺满整幅，上下、左右四边无缝。
- **什么都不立起来**：不画站立的草丛、石块、树冠，没有投影。试点时原野底纸前两版就错在把草簇画成了站立件。
- 没有视觉中心，没有单个突出的物体；元素大小相近、均匀散布。
- 整幅只有这一种地表：不画岸线、小路、田埂或任何边界。
- 没有暗角，没有从一边到另一边的明暗渐变；颜色比真实地表更浅、更灰。
- 五张底纸加上原野，缩到 64 像素见方时两两分得开。

**主体立牌与填充小件（第 2、3 组）**
- 一个物体（或一组紧挨的物体）完整入画，四周留白约 8%；**最下缘是一条水平直线切边**。
- **不画地面、草皮、底座、圆盘，不画落在地上的影子**，物体下方也没有暗色晕。
- 剪影外缘不额外描白边或黑边；内部纸层的切口可以露一线白色纸芯。
- 背景透明；做不到就用纯品红 #FF00FF 均匀平涂，主体里不能有品红、洋红、亮紫。不要灰白棋盘格。
- 宽高比按 prompt 里写的来，不要竖向拉长或压扁。
- 主体立牌缩到 64 像素高、填充小件缩到 **48 像素高**，还能一眼认出是什么。

**地面散件（第 4 组）**
- 正上方垂直俯视，没有透视；是一片薄纸，不是立起来的物体。
- 轮廓不规则，像撕下或剪下来的；四周留白约 8%；**没有直的底边**（它不立着）。
- 不画落影，不画周围的地面。背景透明或纯品红，规则同上。

## 第 4 步：跑流水线

每组出完后，在仓库根目录运行：

```bash
bash tools/art/batch.sh batch1
```

它对 `assets/art-source/region/batch1/` 里已有的每一张：复制到 `art/region/raw/` → 底纸做平铺检查并出 3×3 平铺图，立牌和小件做抠像裁边并查底边与落影，地面散件做抠像裁边 → 最后出四张预览。还没出的图会跳过，预览里用占位色块补。四张预览共需约 5 分钟；只想快速检查刚出的图时用：

```bash
PREVIEW=0 bash tools/art/batch.sh batch1
```

读输出：

- 「错误」：这张图不合格，按说明回第 1 步重出这一张。脚本末尾会列出有错误的 artKey。
- 「警告」：打开对应的图目视确认，没问题就保留，并在报告里写一句。
- **底纸接缝过不了**：重出 3 次仍报接缝错误时，改用工具接合。先留一份原图，再接合，再重跑流水线：

  ```bash
  cp assets/art-source/region/batch1/terrain.ground.lake.png assets/art-source/region/batch1/terrain.ground.lake.orig.png
  ```

  ```bash
  python3 tools/art/seam_blend.py --overlap 64 --out assets/art-source/region/batch1 assets/art-source/region/batch1/terrain.ground.lake.png
  ```

  （把 `terrain.ground.lake` 换成实际的 artKey。）
- **立牌、小件重出 3 次仍有错误**：保留最好的一版，在报告里写明是哪条错误，继续做下一张，不要卡住。

目视检查 `art/region/review/batch1/` 下的图：

| 文件 | 看什么 |
| --- | --- |
| `<artKey>.tile.png` | 底纸的 3×3 平铺：找不到接缝，看不出重复的规律 |
| `near.png` | 近档：棋子周围 3×3 是彩色的。立牌、小件、散件的大小关系对不对，有没有哪张明显比别的更艳、更花、更粗 |
| `mid.png`、`mid-color.png` | 中档（后一张视野更大、彩色的格子更多）：五种地形两两分得开，山岳与湖泊尤其要分得开 |
| `far.png` | 远档：整张地区。底纸连成片后有没有明显的重复纹路 |

四组全部没有「错误」为止（脚本最后一行是「已有的图全部无错误」，并且没有「还没出」的条目）。

## 第 5 步：写报告，交回

写 `art/region/review/batch1/report.md`，包括：

- 35 张各出了几次、最终用的是哪一版；哪几张用了 `seam_blend.py`。
- `batch.sh` 最后一次运行的完整输出（贴进代码块）。
- 每条「警告」的目视结论；没能消掉的「错误」逐条说明。
- 四张预览的目视结论：哪种地形最像参考截图的质感、哪种最弱；哪几张小件在近档里太花或认不出。
- 哪条 prompt 有问题（哪一句、为什么），由项目这边改生成器后重新生成 `region.md`。

**不要**修改 `tools/`、`docs/`、`src/` 下的任何文件，不要 commit。
