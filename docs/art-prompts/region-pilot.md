# 地区场景试点 6 张：出图指引（给 GPT / Codex）

> 读者：在本仓库工作区里出图的 GPT / Codex。按顺序做完第 0–5 步，把结果写进第 5 步的报告。
> 规格与验收的出处：`docs/work-orders/M3-WO3-region-art-assets.md`（§1 尺寸、§2 出图规范与验收、§7 试点流程）。prompt 原文：`docs/art-prompts/region.md`。
> 所有路径都相对仓库根目录 `/Users/Rainy/PycharmProjects/taiwuSimulator/`。

## 第二轮（2026-11-24 试点评审后）：只重出 `terrain.ground.woods`

试点 6 张里 5 张通过，`terrain.standee.woods.0` 定为风格基准。只有林地底纸要重出：旧版画的是一个个圆树冠的俯视，近档重复感明显，又和林地树牌叠在一起显密。

1. 打开重新生成过的 `docs/art-prompts/region.md`，用「### 4. 底纸：林地【试点】」的新代码块（开头是新的底纸公共段：整幅是一张平铺的印刷纸面，什么都不立起来、没有阴影；内容改为林下地面：落叶、苔点、小蕨叶，**不画树冠**）。整块原样使用。
2. 参考图仍按第 0 步，另附 `assets/art-source/region/trial/terrain.ground.plain.png`，要求颜色比它深一号、更偏苔绿，纹样同样细碎、安静。
3. 存为 `assets/art-source/region/trial/terrain.ground.woods.png`（旧的另存为 `terrain.ground.woods.v3.png`）。
4. 直出接缝不过、重出三次仍不过时，不要再手工接合，改用工具（做法与你上一轮手工做的一样）：
   ```bash
   python3 tools/art/seam_blend.py --overlap 64 --out art/region/raw art/region/raw/terrain.ground.woods.png
   python3 tools/art/check_tile.py --preview art/region/review art/region/raw/terrain.ground.woods.png
   ```
   注意 `pilot.sh` 每次会从 `trial/` 重新复制原图到 `raw/`，所以接合后的图也要另存一份回 `trial/`（覆盖同名文件），再跑 `bash tools/art/pilot.sh`。
5. 在 `art/region/review/pilot-report.md` 末尾追加「第二轮」一节：出了几次、用哪一版、`pilot.sh` 输出、林地 3×3 平铺图与 `preview-near-s1-houses.png` 的目视结论。

## 要出的 6 张（第一轮，已完成）

| # | artKey（= 保存时的文件名） | prompt 在 `region.md` 的位置 | 画幅 | 背景 |
| --- | --- | --- | --- | --- |
| 1 | `terrain.standee.woods.0` | 「### 25. 立牌：林地 A【试点】」 | 1024×1024 | 透明，或纯品红 #FF00FF 平涂 |
| 2 | `terrain.standee.mountain.0` | 「### 31. 立牌：山岳 A【试点】」 | 1024×1024 | 同上 |
| 3 | `loc.village.0` | 「### 61. 村庄 1【试点】」 | 1024×1024 | 同上 |
| 4 | `terrain.ground.plain` | 「### 1. 底纸：原野【试点】」 | 1024×1024 | 不透明，四边无缝平铺 |
| 5 | `terrain.ground.woods` | 「### 4. 底纸：林地【试点】」 | 1024×1024 | 不透明，四边无缝平铺 |
| 6 | `region.road` | 「### 75. 道路纸带【试点】」 | 1024×256（横长） | 透明或纯品红，左右无缝平铺 |

每条 prompt 是 `region.md` 里那一节的代码块，**整块原样使用**，不要删减或改写措辞。

**画幅一律按上表出**。总监消息里的像素数（如林地立牌 496×620、山岳立牌 780×650、村庄 1000×750）是进游戏后按 1000 px / 米换算的显示尺寸，由工具链缩放得到，**不要按那个尺寸出图**。立牌在 1024² 画幅里按物体本来的比例画，四周留约 8% 空白即可；工具链会裁边、按物理高度缩放。

## 第 0 步：先看参考图，定下风格（每次新开对话都要做）

依次查看这几张图，再开始出第一张：

| 文件 | 看什么 |
| --- | --- |
| `assets/art-source/region/refs/papertrails-village.png` | **最重要的一张**。每棵树、每丛灌木、每栋房子都是一张模切下来的厚卡纸片，正面印着手绘插画（水粉 / 水彩笔触、叶片纹样、瓦片纹理、深色细轮廓线），剪影四周有一圈白色纸芯；纸片立在纸面上，影子由场景光投下 |
| `assets/art-source/region/refs/papertrails-hero.png` | 整体的微缩立体书感：大小纸片的疏密、地面是一整张印着小路和色块的纸 |
| `assets/art-source/region/refs/papertrails-village-night.png` | 同一套纸片在暖光下的样子：纸片画面本身不画光影，光是场景给的 |
| `art/region/review/preview-near-s1.png` | 本项目的尺度：近档一屏约 3 格横宽，一格里几棵半格高的树 + 一圈灌木石块（当前全是程序画的占位色块，只看尺度与构图，不看画风） |

三张 papertrails 截图来自 https://github.com/xikhar/papertrails （MIT 开源），**只学它的质感与做法**：纸片结构、插画笔触、纸芯白边、低饱和暖色。**不要照搬**它的具体物件、构图或配色方案；我们的配色是宣纸米白、赭石、土黄、苔绿、靛青与墨色，另有约两成淡墨点缀（prompt 里已写明）。

**不要使用**仓库里的这些目录作为参考，也不要打开、上传或模仿其中的图：`assets/main-menu/`、`assets/spine/`、`assets/world-map/`、`assets/map_terrain/`、`assets/paper-ui/`、`data/wiki/images/`。那些是其他用途的现成游戏图片或别的素材，本批素材全部按 prompt 从零画。

## 第 1 步：出图顺序与风格基准

1. 先出 **#1 `terrain.standee.woods.0`**。它就是**风格基准**：出完先按第 3 步的判据自查，不过关就重出（最多 3 次）。
2. 之后每一张都在**同一个对话**里出，并要求「纸厚、纸芯白边、插画笔触、低饱和配色、淡墨点缀的比例与 `terrain.standee.woods.0` 保持一致」。
3. 顺序：#1 → #2 → #3（立牌）→ #4 → #5（底纸）→ #6（道路）。

## 第 2 步：保存

- 每张存为 `assets/art-source/region/trial/<artKey>.png`，文件名严格等于上表的 artKey（例如 `assets/art-source/region/trial/terrain.standee.woods.0.png`）。
- 如果出图工具先把图存到 `generated_images/` 之类的目录，**复制**到上面的路径并改名（`generated_images/` 里的原文件不要删）。
- 重出时直接覆盖同名文件；想保留旧版本就另存为 `<artKey>.v1.png`（流水线只读不带后缀的那张）。
- 这两个目录都在 `.gitignore` 里，不要 `git add`、不要 commit。

## 第 3 步：每张图的自查判据（出完立刻看，不过关就重出）

全部：没有任何文字、字母、数字、印章、签名、水印、边框；没有人物和动物；不是照片质感，也不是 3D 渲染质感，而是印在卡纸上的手绘插画。

立牌（#1–#3）：
- 一个物体（或一组紧挨的物体）完整入画，四周留白；**最下缘是一条水平直线切边**，可以直接立在桌面上。
- **不画地面、草皮、底座、圆盘，不画落在地上的影子**，也没有物体下方的暗色晕（影子由游戏实时生成）。
- 剪影外缘不要额外描白边或黑边（白边由游戏生成）；内部纸层的切口可以露一线白色纸芯。
- 背景透明；做不到就用纯品红 #FF00FF 均匀平涂，主体里不能有品红、洋红、亮紫。**不要灰白棋盘格**冒充透明。
- 比例按物体本来的样子：林地立牌是一棵圆冠阔叶树（宽 : 高 ≈ 0.8），山岳立牌是一组山峰（宽 : 高 ≈ 1.2），村庄是几间房子的小聚落（宽 : 高 ≈ 1.33）。
- 缩到 64 像素高还能一眼认出是什么。

底纸（#4、#5）：
- 正上方垂直俯视，没有透视、地平线、天空；铺满整幅，**上下、左右四边无缝**。
- 没有视觉中心、没有单个突出的物体；元素大小相近、均匀散布。
- 整幅只有这一种地表：**不画岸线、小路、田埂、篱笆或任何边界**。
- 没有投影、暗角、从一边到另一边的明暗渐变；颜色比真实地表更浅、更灰。

道路（#6）：
- 一条土黄色窄纸带横贯整幅宽度，带宽约占画面高度的六成，**左右两端无缝**；带子上下之外是透明 / 品红背景。

## 第 4 步：跑流水线

6 张都存好后（缺的也可以先跑，缺图会用占位图补），在仓库根目录运行：

```bash
bash tools/art/pilot.sh
```

它依次做：复制到 `art/region/raw/` → 立牌和道路抠像裁边（`key_alpha.py`，输出 `art/region/work/`）→ 道路与底纸的平铺检查（`check_tile.py`，3×3 平铺图写到 `art/region/review/`）→ 三档预览（`preview_grid.py`）→ 近档 768² / 1024² 底纸对比图。

读输出：
- 「错误」：这张图不合格，按错误说明回第 1 步重出这一张（每张最多重出 3 次）。常见的有：底边不是直线、画了落影、背景不是纯色或有棋盘格、底纸四边接不上、底纸有明暗渐变。
- 「警告」：打开对应图目视确认；确认没问题就保留，并在报告里写一句。
- 目视检查 `art/region/review/` 下：两张底纸的 3×3 平铺图（找不到接缝和重复规律），以及 `preview-near-s1.png`、`preview-mid-s1.png`、`preview-far-s1.png`、`preview-near-s1-g1024.png`。

全部 6 张都没有「错误」为止。

## 第 5 步：写报告，交回

写 `art/region/review/pilot-report.md`，包括：
- 6 张各出了几次、最终用的是哪一版；
- `pilot.sh` 最后一次运行的完整输出（贴进代码块）；
- 每条「警告」的目视结论；
- 你觉得哪一张最接近参考截图的质感、哪一张最差、原因。

**不要**修改 `tools/`、`docs/`、`src/` 下的任何文件，不要 commit。prompt 有问题就在报告里写明哪一句、为什么，由地区场景美术专员改生成器（`tools/art/region_prompts.py`）后重新生成 `region.md`。
