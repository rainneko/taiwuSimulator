# M3-WO2：大地图纸板渲染（省域纸雕图 + 格子地面基线）

> 工单版本 v1.2 · 2026-11-24 · 执行会话撰写
> v1.2 修订：并入 M3-WO3 v1.3.1 §4 的接口改动（地形纸层）——`GridGround.setLevels` 与 `tLevel`（§10.1）、`GridPicker.setHeightAt` 按层高修正拾取（§10.3）、棋子落点高度（§10.4）、`RegionScene.layers` 挂点与进入顺序、阴影投影体高度（§10.5）、一条拾取测试（§12）。纸层关着时（`low` 档或 `layers: false`）全部退回 v1.1 的平面行为。
> v1.1 修订：并入 M3-WO3 §4 的接口改动——`FollowRig` 三档（§9.2）、`GridGround` 的底纸数组接口（§10.1）、`RegionScene` 挂点与阴影（§10.5）、新增一条测试（§12）。地区格数按 15 / 10 写，数据驱动；总监同日确认 `RegionDef.size` 正式改为 15 / 10，每格移动消耗不变。
> 前置：M3-WO1（纸片工具箱、`SceneManager`、`InputRouter`、`LabelProjector`、`store`）。逻辑侧只需要 PLAN §3.6 的类型（`ProvinceDef`、`RegionDef`、`TerrainDef`、`RegionState`、`WorldState`）和一份夹具数据，不需要世界模拟完成。
> 预估：8–10 天（省域图 5 天，格子基线 3–4 天，联调 1 天）
> 验收：浏览器里一张多层卡纸叠出的地图——指针划过哪片哪片抬起，点哪片哪片变色并升到最高、其余压暗；右侧滑出信息卡；确认后一条虚线纸带铺过去、棋子沿线跳到目的地、镜头俯冲进入该地区的格子地图；在格子地图上点格子，棋子一格一格跳过去。全程用程序生成的占位轮廓与占位牌即可演示。
> 依据：`docs/UI_MAIN.md` §4.2、§5；`docs/PLAN.md` §3.6、§4.1、§4.2。
> 内容：本工单只定渲染与交互技术，**不含任何名称、文案、图像、轮廓数据**。省域的轮廓、配色、名称 key、装饰物摆位全部读内容包；内容包没有时用 §2.3 的程序生成夹具。

---

## 0. 范围

「大地图」在本工单里包含两层，它们通过 `dive / rise` 转场相连：

| 层 | 场景 | 本工单交付到 |
| --- | --- | --- |
| 省域纸雕图 | `WorldMapScene` | **完整**：省片五态、拾取、图层着色、标注、装饰与视差、驿路纸带、旅行动画、相机、`pickOnly` 模式、HUD |
| 地区格子图 | `RegionScene` | **基线**：格子地面、格子高亮与拾取、棋子逐格移动、跟随相机、路径预览。能从省域图俯冲进来、走几步、再拉起回去 |

**不做**（留给地区地图自己的工单，按总监 2026-11-23 的决定 2 在 M3 实现时另出）：格子上的地形立牌与翻书波纹、视野与探索、同格人物栏、采集、聚居点进入、奇遇标记、地区 HUD 的完整布局。本工单的格子基线把这些要用的底层件（`GridGround`、`CellHighlighter`、`GridPicker`、`TokenMover`、`FollowRig`）做完并留好挂点，城镇场景的 13×13 地基也复用它们。

---

## 1. 目录

```
src/render/
├─ map/
│  ├─ outline.ts            # 轮廓处理：绕向、内缩、标注点、邻接（纯函数）
│  ├─ oklab.ts              # 颜色空间换算与插值（纯函数）
│  ├─ ProvincePiece.ts      # 一片省域：几何 + 五态弹簧
│  ├─ MapDecor.ts           # 山 / 水 / 云等装饰牌与视差
│  ├─ TravelLine.ts         # 两点间的虚线纸带
│  ├─ travelTimeline.ts     # 旅行动画时间表（纯函数）
│  └─ fixture.ts            # 程序生成的占位省域
├─ grid/
│  ├─ GridGround.ts         # 一块平面 + 地形 / 高亮两张 DataTexture
│  ├─ CellHighlighter.ts
│  ├─ GridPicker.ts
│  └─ TokenMover.ts         # 棋子逐格跳跃
├─ actor/Token.ts           # 棋子：一张立牌 + 底座圆片
├─ camera/
│  ├─ MapPanRig.ts          # 拖拽平移 + 缩放（省域图、城镇）
│  └─ FollowRig.ts          # 跟随（格子图）
└─ scenes/
   ├─ WorldMapScene.ts
   └─ RegionScene.ts
src/ui/layers/hud/
├─ WorldMapHud.tsx          # ProvinceCard、LayerToggle、ZoomControls
└─ RegionHudLite.tsx        # 返回按钮 + 行动力读数（占位，后续工单替换）
src/core/world/path.ts      # 格子寻路（纯函数；core 已有则复用）
tests/render/map/  tests/render/grid/  tests/core/world/
```

---

## 2. 数据接口

### 2.1 场景读什么

`WorldMapScene` 不直接读 `core` 的状态，只读一个派生出来的视图模型（`computed`，放在 `ui/store.ts` 旁的 `ui/selectors/worldMap.ts`）：

```ts
export type LayerMode = 'faction' | 'goodwill' | 'routes';

export interface ProvinceView {
  id: string;
  nameKey: string;                      // strings 表的 key；场景不碰文字，只把它交给标注层
  baseColor: string;                    // 当前图层下、未选中时的底色（由 §5 的规则算好）
  accentColor: string;                  // 选中时变成的颜色 = ProvinceDef.accentColor
  locked: boolean;                      // 不可进入
  lockReasonKey?: string;
  isCurrent: boolean;                   // 玩家所在省
  regions: { id: string; nameKey: string; kind: 'capital' | 'sect' | 'rural';
             apCost: number | null;     // null = 尚不可达
             unlocked: boolean }[];
}
export interface WorldMapView {
  layer: LayerMode;
  provinces: ProvinceView[];
  routes: { a: string; b: string; open: boolean }[];   // 省与省之间的驿路
  ap: number;
}
```

几何侧的静态数据来自内容包，进场景时读一次：

```ts
// content/<pack>/world/provinces.json  → ProvinceDef[]（PLAN §3.6；本工单用到 id / outline / layerHeight / accentColor）
// content/<pack>/world/map-layout.json → MapLayout
export interface MapLayout {
  bounds: [minX: number, minY: number, maxX: number, maxY: number];   // 轮廓坐标系的范围
  backdrop: { color: string };                                         // 最底下那张大底纸
  inert?: { outline: [number, number][]; color: string }[];            // 不可进入的装饰片（恒为 locked 外观，不参与拾取）
  decor: { kind: 'ridge' | 'water' | 'cloud' | 'prop'; artKey: string;
           at: [number, number]; scale?: number; yaw?: number; parallax?: number }[];
  routeCurves?: Record<string, [number, number]>;   // 'a|b' → 贝塞尔控制点；缺省取两端中点上抬
  palette: { faction: Record<string, string>; goodwillRamp: [string, string]; idle: string; lockedTint: string };
}
```

命令（发给 `core`，本工单用桩实现并记录调用）：`TravelTo { regionId }`、`MoveTo { cell }`。事件（从 `core` 来，本工单用桩在命令后立刻回发）：`travelStarted { fromProvince, toProvince, toRegion, apCost }`、`movedStep { from, to, apLeft }`。

### 2.2 轮廓的规范（`outline.ts` 负责校验与规整）

- 坐标系：平面直角，x 向右、y 向上，单位任意；进场景时统一缩放到「地图宽 = 24 个世界单位」，y 映射到世界的 −z。
- 每条轮廓是一个简单多边形（不自交、无洞），首尾不重复，点数 40–600。绕向不限，加载时统一成逆时针。
- **相邻两省的公共边必须逐点相同**（由保拓扑的简化工具产出，例如 mapshaper 的拓扑简化）。满足这一条，§3.1 的内缩才会在两片之间留下一条等宽的纸缝；不满足会出现时宽时窄或重叠。加载时做一次检查：任意两片的多边形求交面积 > 总面积的 0.1% 就打警告并在调试叠层里标红。
- 岛屿等多块组成的省：`outline` 仍是主块；附属块放在可选字段 `extraOutlines`，与主块共享状态（一起抬、一起变色），拾取命中任一块都算该省。

```ts
export function normalizeOutline(pts: [number, number][]): [number, number][];   // 去重复点、统一绕向
export function signedArea(pts: [number, number][]): number;
export function insetPolygon(pts: [number, number][], d: number): [number, number][] | null;  // 自交则返回 null
export function labelPoint(pts: [number, number][], precision?: number): [number, number];    // 离边界最远的内点
export function centroid(pts: [number, number][]): [number, number];
export function buildAdjacency(all: { id: string; outline: [number, number][] }[], eps?: number): Map<string, string[]>;
```

- `insetPolygon`：逐顶点沿两邻边内法线的角平分线内移 `d / sin(半角)`（尖角处限幅到 `3d`）；结果若自交或面积符号翻转则返回 `null`，调用方退回不内缩。
- `labelPoint`：网格法求「到边界距离最大的内点」（先粗网格取前几名，再在其邻域细化两轮），细长或凹形的片用质心会落到外面，所以不用质心。
- `buildAdjacency`：两片的边界有累计长度 ≥ `eps × 8` 的部分彼此距离 < `eps` 即为相邻（`eps` 默认取地图宽的 0.3%）。结果用于键盘方向键选择与「不相邻的未通省」判定的显示。

### 2.3 占位夹具（`fixture.ts`）

内容包没有 `provinces.json` 时（以及所有测试里）用它：

```ts
export function makeFixtureProvinces(count = 15, seed = 7): { provinces: ProvinceDef[]; layout: MapLayout };
```

做法：在 `24 × 15` 的矩形里用泊松盘撒 `count` 个点 → 求 Voronoi 图并裁到一个带噪声边缘的大轮廓内 → 对所有边做同一份分形抖动（公共边只抖一次，保证逐点相同）→ 每格是一个省，`layerHeight` 按到中心的距离分 4 档，`accentColor` 在色相环上均匀取，`nameKey = 'fixture.province.N'`。再随机连出一棵生成树加 3 条边作为驿路。

这样在没有任何内容数据的情况下，交互、演出、性能都能完整验收；真实轮廓接入后只换数据。

---

## 3. 省片

### 3.1 几何（`ProvincePiece.ts`）

每片由三层几何叠成，都是 `ExtrudeGeometry`（`bevelEnabled: false`），建好后绕 X 转 −90° 平放：

```
        ┌──────────────────┐   面纸：内缩 gap 后的轮廓，厚 t_top = 0.012，材质色 = 该片当前颜色
      ┌─┴──────────────────┴─┐ 纸芯：内缩 gap×0.35 的轮廓，厚 t_core = 0.022，恒为纸芯白（略暖）
      └──────────────────────┘   → 从上往下看，面纸外沿露出一圈细白边 = 卡纸的模切切口
```

- `gap = 地图宽 × 0.0018`（两片之间的纸缝 = `2 × gap × 0.35`，能看到下面的底纸与影子）。
- 每片一个 `Group`，两个 Mesh：`top`（面纸，独立材质实例，因为每片颜色不同）+ `core`（纸芯，全图共享一个材质）。两者都 `castShadow = receiveShadow = true`。每片 2 次绘制，40 片以内共 ≤ 80 次，在预算内，不必为省这点绘制去合并几何。
- 两份几何都带顶点属性 `aSide`（0 = 顶面，1 = 侧面），供 `PaperMaterial` 的 `vertexSide` 把切口面压暗。`ExtrudeGeometry` 的 `groups[0]` 是两个端面、`groups[1]` 是侧面，按索引范围填这个属性即可。
- 基础高度：`y0 = layerHeight × 0.045`。不同档的片上下错开，高的把影子投在低的上面——这是「叠层卡纸」观感的来源，所以 key 光要低一些（仰角 ≈ 38°）让影子够长，见 §3.4。
- 底纸：`MapLayout.bounds` 外扩 15% 的一块大平面，`y = −0.01`，只收影子。
- `inert` 装饰片：同样的做法，颜色固定为 `lockedTint`，`layers` 设为不参与拾取的那一层。

材质：`createPaperMaterial({ doubleSided: false, cutout: false, vertexSide: true, color })`。纤维强度调到 0.3（大色块上纸纹更重要）。

三角形数：600 点的轮廓挤出约 2400 个三角形（顶 + 侧，两层），15–40 片合计 < 10 万，在预算内；`low` 档对轮廓做一次 Douglas–Peucker（容差 = `gap × 0.5`）再建几何。

### 3.2 五态与弹簧

```ts
export type PieceState = 'idle' | 'hover' | 'selected' | 'dimmed' | 'locked';

interface PieceTarget { lift: number; accent: number; dim: number; sat: number; rim: number }
export const PIECE_TARGETS: Record<PieceState, PieceTarget> = {
  //            抬升     变色量     亮度系数   饱和系数   白边亮度
  idle:     { lift: 0,     accent: 0, dim: 1.0,  sat: 1.0,  rim: 1.0 },
  hover:    { lift: 0.04,  accent: 0, dim: 1.04, sat: 1.0,  rim: 1.25 },
  selected: { lift: 0.08,  accent: 1, dim: 1.0,  sat: 1.0,  rim: 1.25 },   // 另外抬到「最高档之上」，见下
  dimmed:   { lift: 0,     accent: 0, dim: 0.8,  sat: 0.6,  rim: 0.9 },
  locked:   { lift: 0,     accent: 0, dim: 0.9,  sat: 0.0,  rim: 0.9 },
};
```

- `selected` 的目标高度 = `3 × 0.045 + 0.08`（最高档再加 0.08），与该片原本在哪一档无关——低处的片被选中时会明显「升上来」。
- 五个量各一个临界阻尼弹簧（WO1 的 `stepSpring`），`omega = 28`（约 140ms 到 90%、240ms 基本到位，对应 UI_MAIN 的「≈ 180ms」）。抬升可以再生动一点：`lift` 用 `omega = 22` 的欠阻尼版本（`zeta = 0.6`，轻微过冲一次）。
- 状态由 `WorldMapScene` 每次 `selection / hover / view` 变化时整体重算，不在片内部互相通知：

```ts
function stateOf(p: ProvinceView, sel: string | null, hov: string | null): PieceState {
  if (p.locked) return 'locked';
  if (sel === p.id) return 'selected';
  if (hov === p.id) return 'hover';
  return sel ? 'dimmed' : 'idle';
}
```

- 只有弹簧未静止的片才更新矩阵与材质色；全部静止时 `WorldMapScene.isIdle()` 返回真（配合 WO1 的省电逻辑）。
- 「连续快速划过多片时无残留高亮」：因为状态是每次从 `hover` 这一个值整体推导的，不存在某片没收到「离开」事件的情况；测试里用随机指针轨迹验证最终至多一片为 `hover`。

### 3.3 颜色：OKLab 插值（`oklab.ts`）

底色 → 强调色直接在 sRGB 里插值，中途会发灰发脏；在 OKLab 里插值能保持明度与彩度平滑。压暗与去饱和也在这个空间里做（对 L 与 ab 分别乘系数）。

```ts
export type Lab = [L: number, a: number, b: number];

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function srgbToOklab(r: number, g: number, b: number): Lab {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToSrgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(toSrgb( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
  ];
}

/** 片的最终颜色：底色 →(accent)→ 强调色，再乘亮度与饱和系数。 */
export function pieceColor(base: Lab, accent: Lab, t: number, dim: number, sat: number): [number, number, number] {
  const L = (base[0] + (accent[0] - base[0]) * t) * dim;
  const a = (base[1] + (accent[1] - base[1]) * t) * sat;
  const b = (base[2] + (accent[2] - base[2]) * t) * sat;
  return oklabToSrgb([L, a, b]);
}
```

每片在建片时把 `baseColor`、`accentColor` 预转成 `Lab` 缓存；图层切换时只重算 `base`。写入 three：`material.color.setRGB(r, g, b, SRGBColorSpace)`。

图层切换（底色整体换一套）本身也走弹簧：给每片一个 `baseFrom / baseTo / baseT`，300ms 过渡，避免整张图瞬间跳色。

### 3.4 灯光与阴影

`createLightRig('warmDay')` 的基础上改 key 光方向：从左上后方打来，仰角约 38°、方位角约 −35°（位置 `(-7, 6.5, -5)` 朝向地图中心）。这样每一档 0.045 的高差能投出约 0.06 宽的影子，选中片升到最高时影子有 0.25 宽并且半影明显变虚（PCSS 的效果在这里最显眼）。

`fitShadowCamera(rig, mapBounds)` 按地图包围盒收紧阴影相机。地图是静态的，只有片在抬升时阴影才变：`renderer.shadowMap.autoUpdate = false`，每帧若有任一片的 `lift` 弹簧未静止（或灯在动）才置 `shadowMap.needsUpdate = true`。静止时阴影贴图不重画。

---

## 4. 拾取与输入

### 4.1 拾取

片数 < 40，直接用 `Raycaster`：

- 只对各片的 `top` 网格求交；`core`、底纸、装饰、棋子都放在 `layers` 的第 1 层，`raycaster.layers.set(0)` 只看第 0 层。
- `move` 事件到来时才拾取（不是每帧）；相机在动（拖拽、缩放、弹簧未静止）而指针没动时，每 4 帧补一次，保证片从指针下滑走后高亮会更新。
- 命中结果写 `ui.hover`（相等则不写）；`leave` 时清空。指针悬在可点的片上时把画布的 `cursor` 设为 `pointer`。
- 拖拽过程中不更新 `hover`，松手后补一次。

### 4.2 点击语义

| 输入 | 行为 |
| --- | --- |
| 点未选中的片 | `ui.selection = { type: 'province', id }`；相机 `focusOn` 该片（平移使其居中偏左，给右侧信息卡让位；不改缩放） |
| 点已选中的片 | 不变（鼠标）；触屏上等同于展开信息卡 |
| 点 `locked` 的片 | 不选中；在指针处弹一条提示（`lockReasonKey`），该片做一次 ±0.01 的轻微抖动 |
| 点空白（底纸） | 清空 `selection` |
| `Esc` | 清空 `selection`（经 WO1 的 `closeTopmost`） |
| 方向键 | 在相邻片之间移动选择：取邻接表里「质心方向与按键方向夹角最小且 < 75°」的那一片；没有则不动 |
| `Enter` | 等同于信息卡的「前往」主按钮 |

触屏没有悬停：第一次点 = 选中（片直接从 `idle` 到 `selected`）。

### 4.3 `pickOnly` 模式

`enter({ mode: 'pickOnly', allow?: string[], onPick })`：供新建向导的第 ② 步复用同一个场景类。区别只有：不显示棋子、驿路与图层切换；`allow` 之外的片为 `locked`；选中后调用 `onPick(id)` 而不是打开信息卡；`Enter / 前往` 不触发旅行。场景实例与正式大地图分开（新建流程结束时随 `MenuScene` 一起释放）。

---

## 5. 图层着色

「图层」只决定未选中时各片的底色，选中变色的规则不受影响。底色在 `ui/selectors/worldMap.ts` 里算好，场景只管过渡。

| 图层 | 底色规则 | 附加表现 |
| --- | --- | --- |
| `faction` | `palette.faction[该省主导势力 id]`；无主导势力取 `palette.idle` | — |
| `goodwill` | 在 `goodwillRamp` 两端色之间按「该省三个地区恩义的平均值 ÷ 当前上限」在 OKLab 里插值 | 标注层在省名下加一行数值 |
| `routes` | 全部取 `palette.idle`，已有任一地区打通的省提亮 8% | 驿路纸带全部显示（其他图层下只显示与当前所在省 / 选中省相连的） |

配色对选中效果的要求（给内容包作者，校验脚本里实现）：各图层的底色保持低彩度（OKLCh 的 C ≤ 0.07），`accentColor` 的 C ≥ 0.12 且与底色的 ΔL ≥ 0.08——这样「点哪片哪片变色」的对比才足够。夹具数据按这个规则生成。

---

## 6. 省名标注

用 WO1 的 `LabelProjector`，场景只登记位置与优先级，文字由 `<LabelLayer>` 从 `strings[nameKey]` 取。

- 锚点：`labelPoint(outline)`，高度取该片当前顶面 `y`（片抬起时标注跟着走）。
- 优先级：选中 100、悬停 90、玩家所在 80、其余按片面积从大到小 10–60。拥挤时小片的名字先隐藏。
- 缩放联动：相机缩放量 `z ∈ [0, 1]`（0 最远）。省名在 `z < 0.75` 时显示，之后 120ms 淡出（拉得很近时让位给装饰与地区名）；选中片的名字始终显示。选中片的三个地区名在 `z > 0.5` 或该片被选中时显示，位置在片内沿主轴均匀排开（主轴 = 轮廓点的第一主成分方向）。
- 样式（`paper.css`）：省名是一枚小纸签——`.paper .paper-cut`，字距略宽，无边框；选中时纸签底色换成该省 `accentColor` 的浅色版（OKLab 的 L 提到 0.93）。`locked` 的省名降到 55% 不透明度。
- 标注本身 `pointer-events: none`；点击穿到画布由拾取处理，避免「点名字没反应」。

---

## 7. 装饰层与视差（`MapDecor.ts`）

`MapLayout.decor` 里的每一项是一张 `PaperCard`（数量 < 80，不必合批；超过则换 `PaperBatch`）：

| kind | 形态 | 行为 |
| --- | --- | --- |
| `ridge`（山脊） | 立牌，高 0.25–0.5，立在所属片的顶面上 | 跟随所属片的抬升；缩放量 `z > 0.35` 时淡入（用 `uPaperFade` 抖动溶解），拉远时隐藏以免拥挤 |
| `water`（水系） | 平贴在片顶面上方 0.002 的细长纸条（平躺的牌，`θ = 0`） | 不投影；颜色随所属片的压暗一起变 |
| `cloud`（云） | 悬在 `y = 0.9–1.3` 的平躺纸片，投影到地图上 | 沿固定方向以 0.02 单位 / 秒漂移，出界后从另一侧回来；视差系数 0.15–0.3；指针靠近（屏幕距离 < 120px）时溶解到 70% 透明，不挡操作 |
| `prop` | 任意小立牌 | 静态 |

「所属片」在加载时用点在多边形内测试确定一次。云的影子是这张图最能说明「这是悬空的纸」的细节，`high` 档保留，`medium` 以下关闭云的 `castShadow`。

视差：用 WO1 的 `ParallaxRig`，以相机平移量为输入，只作用于云层（地面上的东西有真实的透视，不需要假视差）。

进场演出（从别的场景 `rise` 回来时不播，首次进入与读档后播）：底纸先在，各片按 `layerHeight` 从低到高、同档内按到中心的距离，依次从 `y = −0.05` 升到位（间隔 25ms），然后山脊立牌波纹起立，最后云淡入。总长 ≤ 1.4s，可跳过。

---

## 8. 棋子、驿路与旅行动画

### 8.1 棋子（`actor/Token.ts`）

```ts
export class Token extends Group {
  constructor(artKey: string, heightM: number);     // 一张 PaperCard（立正、不倒）+ 底座圆片（薄圆柱，纸芯色）
  placeAt(p: Vector3): void;
  hopTo(p: Vector3, durMs: number, arc: number): Promise<void>;   // 抛物线 + 起跳压缩 / 落地压扁
  setFacing(sign: 1 | -1): void;                    // 朝左 / 朝右 = 牌的 x 缩放取负，带一次 120ms 的翻面
  update(dt: number): void;
}
```

一次跳跃的时间表（归一化 `u ∈ [0, 1]`）：

| 段 | u | 位置 | 形变（`scaleY`，`scaleX` 取其倒数的平方根） |
| --- | --- | --- | --- |
| 蓄力 | 0 → 0.15 | 不动 | 1 → 0.86 |
| 腾空 | 0.15 → 0.85 | 水平线性，垂直 `4·arc·s·(1−s)`（`s` 为段内进度） | 0.86 → 1.08 → 1.0 |
| 落地 | 0.85 → 1 | 到位 | 0.82 → 1（落地瞬间取 0.82，弹回），同时给牌的铰链一个向前的小冲量 |

省域图上的棋子立在玩家所在省的 `labelPoint` 旁（偏移 0.15 避开省名），高 0.35；格子图上高 0.9（格宽 1）。棋子用的图由 `artKey` 给，缺省为占位牌。

### 8.2 驿路纸带（`TravelLine.ts`）

两个省之间的一条虚线：沿二次贝塞尔曲线等距排布的小矩形纸片，用一个 `InstancedMesh`（全图所有驿路共用，容量 = 路数 × 每条最多 40 段）。

- 曲线端点：两省的 `labelPoint`，高度取各自片顶面 + 0.01；控制点取 `routeCurves` 或「中点沿垂直方向偏移弦长的 12%、高度 + 0.06」（略微拱起，从片的边缘上方越过去，有影子）。
- 每段 `0.09 × 0.03`，间隔 0.05，朝向沿曲线切线，平躺。
- 状态：`open`（已打通：纸芯白）/ `closed`（未通：不显示，`routes` 图层下以 40% 灰显示）/ `active`（本次旅行的路径：强调色，逐段出现）。
- `setProgress(routeId, t)`：只显示前 `t` 比例的段——旅行动画用它「铺」出路径。段的出现带一个从 0.6 到 1 的缩放弹跳（80ms）。

### 8.3 旅行动画（`travelTimeline.ts`，纯函数）

玩家在信息卡里确认前往后：`dispatch(TravelTo)` → 收到 `travelStarted` → 场景按下表演出 → 结束后 `sceneManager.goto('region', { regionId }, { style: 'dive' })`。演出期间输入锁定（场景自己置一个 `busy`，与转场的锁分开），任意键 / 点击可跳到末尾。

```ts
export interface TravelPlan {
  hops: number;              // = clamp(round(apCost / 10), 2, 6)：路越远跳的次数越多
  lineMs: number;            // 铺路 = 260 + 40 × hops
  hopMs: number;             // 每跳 = 230
  settleMs: number;          // 到达后目的片脉冲 = 260
  totalMs: number;
}
export function planTravel(apCost: number): TravelPlan;

export interface TravelFrame {
  lineProgress: number;      // 0–1：纸带铺到哪
  hopIndex: number; hopU: number;       // 第几跳、跳内进度
  curveT: number;            // 棋子在曲线上的参数（跳与跳之间停在等分点）
  cameraT: number;           // 相机从起点省到终点省的跟随进度（整体 easeInOut）
  pulse: number;             // 目的片的脉冲 0–1–0
}
export function sampleTravel(plan: TravelPlan, tMs: number): TravelFrame;
```

| 时间段 | 内容 |
| --- | --- |
| 0 → `lineMs` | 起点片与终点片保持各自状态，其余 `dimmed`；纸带从起点逐段铺到终点；相机开始向两省中点平移并略微拉远到两省同时入画 |
| 之后 `hops × hopMs` | 棋子沿曲线分 `hops` 次跳过去（每跳的弧高 0.12），朝向按行进方向翻面；相机跟随 |
| 之后 `settleMs` | 终点片做一次脉冲（`lift` 额外 +0.03 再回落，白边亮度 1.25 → 1.6 → 1.25）；顶栏的行动力读数在此刻跳变（DOM 侧听 `travelStarted` 的 `apCost` 做数字滚动） |
| 结束 | 纸带由 `active` 变回 `open`；接 `dive` 转场 |

同省内换地区（不跨省）：没有纸带与跳跃，只有终点片脉冲，随后直接 `dive`。

### 8.4 `dive / rise` 的对接

- `getFocusRect({ regionId })`：取该地区所属省片的包围盒八个角投影到 NDC 后的外接矩形。
- `setDiveProgress(t)`（WO1 §3.6 的前半程由旧场景自己推相机）：相机从当前位置向「该片在画面中占 80% 高」的位置插值（`easeInCubic`），同时除选中片外全部加速压暗到 `dim = 0.5`。
- `RegionScene.alignTo(rect)`：把格子地图的初始相机放在「整张格子图恰好落在 `rect` 内」的距离，然后在转场后半程缓出到正常跟随构图。两端的画面在交叉淡化时轮廓大体重合即可，不要求像素级对齐。
- `rise` 反过来：`RegionScene` 的相机拉远到整张格子图入画，`WorldMapScene.alignTo` 把相机放在「所属省片占 80% 高」处，再缓出到正常构图；回来时该省保持 `selected`。

---

## 9. 相机

### 9.1 MapPanRig（`camera/MapPanRig.ts`）

```ts
export interface MapPanRigOptions {
  fov: number; pitchDeg: number;                 // 省域图：20 / 75；城镇：27 / 53
  bounds: Box2;                                   // 注视点允许的范围（地图范围内缩一点）
  distRange: [near: number, far: number];        // 相机到注视点的距离范围
  zoomSteps?: number;                            // 给定则缩放吸附到档位（城镇 = 3）；省域图不给，连续缩放
}
export class MapPanRig {
  readonly camera: PerspectiveCamera;
  get zoom(): number;                             // 0（最远）– 1（最近），给标注与装饰的淡入淡出用
  onPointer(e: ScenePointerEvent): boolean;       // 返回是否消费了事件（拖拽 / 滚轮 / 双指）
  focusOn(target: Vector2, opts?: { screenOffset?: [number, number]; zoom?: number }): void;
  frame(box: Box3, fill: number): void;           // 使 box 在画面里占 fill 比例
  update(dt: number): void;
  isSettled(): boolean;
}
```

- 状态是「注视点 (x, z) + 距离」三个量，各一个临界阻尼弹簧（`omega = 14`）。俯角与朝向固定，不可旋转。
- 拖拽平移：把指针的屏幕位移换成地面位移——用按下时与当前的两条射线分别与 `y = 0` 平面求交，取差值，这样无论缩放多少，抓住的那一点始终跟着指针。
- 滚轮 / 双指缩放**以指针位置为锚**：缩放前后，指针下的地面点不动（先算出该点，改距离后再平移注视点补偿）。
- 越界：注视点超出 `bounds` 时给一个把它拉回来的弹簧力（松手后回弹），不硬截断。
- `focusOn` 的 `screenOffset`：信息卡占右侧约 20% 宽时，把选中片放在可视区域的中心而不是画布中心。
- 惯性：松手时保留拖拽末速度，按 `exp(−6t)` 衰减。

### 9.2 FollowRig（`camera/FollowRig.ts`）

格子图用：fov 27°、俯角 53°、朝向固定（与城镇、省域图 `dive / rise` 的落点一致，不另取视场角）。注视点追随棋子（`omega = 6`，有意比棋子慢半拍）。滚轮在 3 个距离档之间切换；档位按**画面横向能看到几格**定义，相机距离由格数算出，不写死：

```ts
// 水平视场 = 2·atan(tan(fov / 2)·aspect)；距离 = (横向格数 · cellSize / 2) / tan(水平视场 / 2)
export function distanceForCells(cellsAcross: number, cellSize: number, fovDeg: number, aspect: number): number;
```

| 档 | 横向格数 | 注视点 | 死区 | 边缘限制 |
| --- | --- | --- | --- | --- |
| 近（进入地区时的默认档） | 3 | 棋子所在格心 | 无（3×3 视野始终以棋子为中心） | 无，允许看到地区外的书页空白 |
| 中 | 6 | 追随棋子 | 1 格 | 地图边缘向内 1.5 格 |
| 远 | 整张地区装进画面 | 地区中心，不跟随 | — | — |

16:9 下近档约 3.5 个单位远。玩家拖拽时暂时脱离跟随（近档不允许拖拽），松手 1.5s 后或棋子再次移动时回归。窗口宽高比变化时重算距离。

---

## 10. 格子地面基线

### 10.1 GridGround（`grid/GridGround.ts`）

整张格子图的地面是**一块平面、一次绘制**，格子的差别全在片元着色器里按格坐标查两张小纹理得到：

| 纹理 | 尺寸 | 内容 | 更新时机 |
| --- | --- | --- | --- |
| `tTerrain` | N×N，`RGBA8`，`NearestFilter` | R = 地形编号，G = 该格的随机字节（由 `GridGround` 内部按 `hash(seed, index)` 写；按位拆用见 M3-WO3 §3.2.1），B = 标志位（已探索 / 废墟 / 有聚居点…），A = 资源余量 | 进场景时写一次；格子状态变化时改单个像素 |
| `tHighlight` | N×N，`RGBA8`，`NearestFilter` | R = 高亮种类编号，G = 强度，B = 路径序号（做流动效果），A 备用 | 由 `CellHighlighter` 写 |
| `tPalette` | 32×4，`RGBA8` | 第 0 行：各地形的底色；第 1 行：各高亮种类的颜色；第 2 行：各地形的底纸层号、叠放次序、是否禁止旋转；第 3 行：季节染色（第 2、3 行的编码见 M3-WO3 §3.2.1） | 进场景 / 换季时写 |

```ts
export class GridGround extends Mesh {
  constructor(size: number, opts: {
    cellSize?: number;
    palette: GridPalette;
    ground?: GroundArray;          // 底纸数组；缺省 = 纯色格（本工单的验收走这条路径）
    edgeMask?: Texture;            // 撕纸遮罩；缺省 = 直边
  });
  setTerrain(index: number, terrainId: number, flags: number, resource: number): void;
  setPalette(p: GridPalette): void;
  setSeed(seed: number): void;                                      // 逐格随机字节的种子（= 地区种子）
  setGround(g: GroundArray | null, edge?: Texture | null): void;    // 异步加载完成后接入；切换 GROUND_ARRAY 宏
  setTerrainParams(p: TerrainParams): void;                         // 写 tPalette 第 2 行
  setSeason(s: number): void;                                       // 写 tPalette 第 3 行
  setEdgeStyle(o: { seam?: number; tear?: number; shadowWidth?: number; shadowStrength?: number }): void;   // 画廊调参
  readonly highlight: CellHighlighter;
}
export interface GroundArray { texture: DataArrayTexture; terrainToLayer: Record<TerrainType, number>; noRotate: boolean[] }
```

本工单只实现**纯色路径**（下面这段着色）；带底纸数组的路径（`#ifdef GROUND_ARRAY`：逐格旋转 / 镜像、异种地形的弯曲交界、叠放次序的接触影）由 M3-WO3 §3.2–§3.3 给出并实现，纯色路径保留在 `#else` 分支。上面的新增方法在本工单里先留签名与空实现即可（`setSeed` 除外，它影响 G 通道，要实现）。

着色：用 WO1 `createPaperMaterial` 的 `extend` 钩子（`{ cacheKey: 'grid', apply }`），在内置注入完成后把下面这段插到 `#include <alphatest_fragment>` 之前，并在顶点着色器里带出 `vGridUv`：

```glsl
// vGridUv = 平面 uv × N；cell = floor(vGridUv)；f = fract(vGridUv)
vec4 t = texelFetch( tTerrain, ivec2( cell ), 0 );
vec3 base = texelFetch( tPalette, ivec2( int( t.r * 255.0 + 0.5 ), 0 ), 0 ).rgb;
base *= 0.96 + 0.08 * t.g;                                   // 逐格的轻微明暗差，像一张张单独裁的纸
// 纸缝：每格是一张内缩的小方纸，格与格之间露出下面的深色底
float edge = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) );
float seam = smoothstep( 0.0, 0.018, edge );                 // 0 = 缝，1 = 纸面
float lip  = smoothstep( 0.018, 0.05, edge );                // 缝边一圈略亮 = 切口
vec3 col = mix( uSeamColor, base * mix( 1.06, 1.0, lip ), seam );
// 未探索：压暗去色（标志位第 0 位）
// 高亮：见 §10.2
diffuseColor.rgb *= col;
```

- 缝宽随距离做屏幕空间修正（用 `fwidth(vGridUv)` 保证最远档缩放时缝不闪烁、不消失）。
- 平面 `receiveShadow`，不 `castShadow`。地面本身不抬升——「选中格抬起」用一张单独的小方纸 Mesh 盖在该格上方 0.03 处来表现（只有 1–2 张，带影子，效果比在着色器里假装要好）。
- **地形纸层（v1.2，M3-WO3 §3.13）**：新增 `setLevels(levels: Float32Array | null)`，把逐格层号写进一张与 `tTerrain` 同尺寸的 `tLevel`（N×N，R8，最近邻；编码 `r = (level + 2) × 2`），并置 `LAYERS` define——撕边与接触阴影只在两格层号相同的交界上画；`null` = 全 0 层（v1.1 行为）。纸层开着时顶面由 M3-WO3 的 `TerrainLayers` 几何承载，它直接复用本材质实例（同一组 uniform，高亮、视野灰化、季节自动跟着走）；这块平面保留但 `visible = false`，切换画质档只切可见性、不重建。上一条「选中格抬起」的小方纸相应放在该格层高 + 0.03 处。
- 15×15 = 225 格、13×13 = 169 格都是这一个平面，成本与格数无关。N 一律从数据读（`RegionDef.size`），代码里不出现写死的格数。

### 10.2 CellHighlighter（`grid/CellHighlighter.ts`）

```ts
export type HighlightKind = 'none' | 'hover' | 'selected' | 'path' | 'reachable' | 'legal' | 'illegal' | 'danger';
export class CellHighlighter {
  set(index: number, kind: HighlightKind, strength?: number): void;
  setMany(indices: Iterable<number>, kind: HighlightKind): void;
  setPath(indices: number[]): void;      // 依次写入路径序号，着色器据此做沿路径流动的亮点
  clear(kind?: HighlightKind): void;     // 只清某一类，或全清
  flush(): void;                         // 有改动才上传纹理
}
```

- 各类高亮的外观在着色器里按种类编号分支：`hover` = 整格提亮 8%；`selected` = 内描边一圈强调色；`path` = 格心一个小圆点 + 沿序号流动的亮度波；`reachable` / `legal` = 淡色铺底；`illegal` = 压暗 + 细斜纹；`danger` = 暖色铺底。颜色都从 `tPalette` 第 1 行取，换内容包不改代码。
- 多类叠加的优先级：`selected > hover > path > 其余`。实现上一格只存一个种类，由 `CellHighlighter` 在 CPU 侧按优先级决定写哪个（保留每格的各类标记位，`flush` 时归并）。
- 高亮切换不走弹簧（格子多、变化频繁），只在着色器里对 `hover` 做 60ms 的时间平滑就够。

### 10.3 GridPicker（`grid/GridPicker.ts`）

```ts
export class GridPicker {
  constructor(size: number, cellSize: number, origin: Vector3);
  /** 屏幕点 → 格子下标；落在地图外返回 -1。 */
  pick(ndc: Vector2, camera: Camera): number;
  /** 可选：登记高出地面的立牌包围盒，点到立牌上时返回它所在的格。 */
  registerTall(index: number, box: Box3): void;
  unregisterTall(index: number): void;
  cellCenter(index: number, out: Vector3): Vector3;
  /** v1.2：世界 xz → 该点地面高度（层号 × levelStep，地图外 = 0）；null = 平面。由 M3-WO3 的 TerrainLayers 提供。 */
  setHeightAt(fn: ((x: number, z: number) => number) | null): void;
}
```

- 基本拾取：射线与 `y = 0` 平面求交 → 减原点 → 除以格宽 → 取整。不对任何网格做 raycast。
- 高立牌修正：先对登记过的包围盒（只取与射线在屏幕上邻近的若干格，按格坐标范围筛）做射线-盒求交，命中最近的那个则返回其格；都没命中再走平面拾取。城镇的建筑、格子图上的高立牌用它；本工单只登记棋子所在格用于自测。
- **按层高修正（v1.2，M3-WO3 §3.13.6，纸层开着时必须做）**：设了 `heightAt` 时，平面拾取改为：与 `y = 0` 求交 → `h = heightAt(x, z)` → 与 `y = h` 再求交，`h` 变了就再迭代，至多 3 次。不修正的话，0.15 高、53° 俯角下会偏约 0.11 格，点抬高的格的近侧边会选到前面一格。`cellCenter` 返回的 y 同样取 `heightAt(格心)`。层号逻辑只在 `TerrainLayers` 里有一份，`GridPicker` 不复制。

### 10.4 TokenMover 与寻路

```ts
// src/core/world/path.ts —— 纯函数；core 已有等价实现则复用，不重复造
export function findPath(
  size: number, cost: (index: number) => number | null,   // null = 不可通行；数值 = 进入该格的行动力
  from: number, to: number, budget?: number,
): { cells: number[]; total: number } | null;             // A*，四向，启发 = 曼哈顿距离 × 最小格耗
export function reachable(size: number, cost: (i: number) => number | null, from: number, budget: number): Map<number, number>;
```

```ts
export class TokenMover {
  constructor(token: Token, picker: GridPicker);
  /** 按格子序列逐格跳；每跳 170ms、弧高 0.22；连续跳之间不停顿。返回的 Promise 在走完或被打断时结束。 */
  walk(cells: number[], onStep?: (index: number) => void): Promise<'done' | 'interrupted'>;
  interrupt(): void;       // 走完当前这一跳后停下
  readonly busy: boolean;
}
```

交互（`RegionScene` 基线）：

- 指针悬停某格：`hover` 高亮；若该格可达，显示从棋子到该格的路径（`setPath`）与总耗（标注层在目标格上方显示「−n」，行动力不够时路径只画到够得着的那一格、其后的格用 `illegal`）。
- 点击可达格：`dispatch(MoveTo { cell })`；每收到一个 `movedStep` 事件，`TokenMover` 走一格（逻辑是逐格结算的——中途可能触发事件而停下，所以表现也逐格跟，不一次性播完整条路径）。
- 移动中再点别处：`interrupt()`，走完当前一跳后按新目标重新寻路。
- 棋子每落一格：该格 `selected` 高亮移过来；行动力读数更新；`FollowRig` 跟上。
- 棋子落点高度（v1.2）：落在 `picker.cellCenter` 给的 y 上（纸层开着时 = 该格层高）；跨层的那一跳起点、终点高度不同，弧线在两者之间插值再叠加弧高，不瞬移。
- 格耗来自 `TerrainDef.moveCost`（无代步 +1 的规则由 `core` 算好后给到 `cost` 回调，渲染侧不重复实现规则）。

### 10.5 RegionScene 基线

- `enter({ regionId })`：从 `game.world` 取 `RegionState`，建 `GridGround`（N = `RegionDef.size`，现行取值 15 或 10），`setSeed(地区种子)`，把 `tiles[i].terrain` 写进 `tTerrain`；棋子放在玩家所在格；`FollowRig` 对准（近档）。
- 灯光 `warmDay`。本工单的基线里投影体只有棋子，阴影相机按格子图包围盒收紧即可。接入 M3-WO3 的立牌后（上百张牌投影），改用跟随可视范围的阴影相机 `fitShadowCameraToView`，并按条件更新阴影贴图而不是每帧更新——见 M3-WO3 §3.11。省域图（§3.4）地图小且静止，不改。
- HUD（`RegionHudLite`）：左上一个「返回大地图」按钮（→ `goto('worldMap', { focus: provinceId }, { style: 'rise' })`），顶栏行动力读数。其余留空。
- 留给 M3-WO3 的挂点：`RegionScene.batches: Map<string, PaperBatch>`（按图集 id：地形、地点、细节、房屋，外加按省加载的专属地点；地形立牌与翻书波纹）、`fog`、`roads`、`locations`、`dressing`、`layers: TerrainLayers | null`（v1.2，地形纸层）（本工单里都是 `null`）、`GridPicker.registerTall`、`CellHighlighter` 的 `danger / reachable` 种类、`tTerrain` 的标志位。
- 纸层接入后的进入顺序（v1.2，M3-WO3 §4）：建地面 → 算层号、建纸层、`ground.setLevels`、`picker.setHeightAt(layers.heightAt)` → 算布置（落点 y 取 `layers.heightAt`）→ 立牌与房屋 → 道路 → 迷雾（雾面抬到最高层之上）→ 标注（锚点 y 加所在格层高）。阴影相机的 `maxCasterHeight` = 1.2 + 3 × `levelStep`。单栋房屋（M3-WO3 §3.12）是普通立牌，由 `locations` 按配方摆，不另设挂点。
- `core` 需要给出视野半径（缺省 1，即棋子周围 3×3）与逐格「在视野内」，供 M3-WO3 §3.4 的视野外变灰；本工单只把该标志写进 `tTerrain.b` 的一位，不做表现。

---

## 11. HUD（DOM）

`<WorldMapHud>`，布局照 UI_MAIN §4.2。全部文字来自 `strings`，全部数据来自 `WorldMapView`。

| 组件 | 内容 | 行为 |
| --- | --- | --- |
| `<ProvinceCard>` | 省名、势力与立场徽记、恩义条、三个地区行（名称、类型图标、所需行动力或「未通」）、主按钮「前往」 | `ui.selection` 为省时从右侧滑入（220ms）；地区行悬停 → `ui.hover = { type: 'region', id }`（场景里对应的地区名标注加亮）；行动力不足的行灰显并在 `<ReasonList>` 里说明；点地区行选定目的地，主按钮确认 → `TravelTo` |
| `<LayerToggle>` | 三个图层的单选纸签 | 改 `ui` 里的 `mapLayer` signal；快捷键 `1 / 2 / 3` |
| `<ZoomControls>` | `−` / `+` / 回到所在地 | 调 `MapPanRig`（经场景暴露的 `zoomBy`、`focusCurrent`） |
| 顶栏 | 复用 WO1 的 `<TopBar>` 壳，填入日期、行动力、两项资源读数 | 行动力变化时数字滚动 |

窄屏（宽 < 900px）：`<ProvinceCard>` 改为底部抽屉，`focusOn` 的 `screenOffset` 相应改为向上偏。

---

## 12. 测试

| 文件 | 用例 |
| --- | --- |
| `tests/render/map/outline.test.ts` | `normalizeOutline` 后面积为正；正方形内缩 `d` 后边长减 `2d`；对一个会自交的细长凹多边形内缩返回 `null`；`labelPoint` 对 U 形多边形落在形内（质心在形外）；夹具 15 片的邻接表对称、连通、每片 ≥ 1 个邻居 |
| `tests/render/map/fixture.test.ts` | 同种子两次生成完全相同；任意两片的重叠面积为 0（公共边逐点相同）；全部通过 `ProvinceDef` 的 zod schema；配色满足 §5 的彩度与明度差约束 |
| `tests/render/map/oklab.test.ts` | 1000 个随机 sRGB 颜色往返误差 < 1e-4；白 / 黑 / 中灰的 `a、b` ≈ 0；`pieceColor(base, accent, 0.5, 1, 1)` 的 L 落在两端之间（不发暗）；`sat = 0` 时结果为灰（r = g = b，容差 1e-3） |
| `tests/render/map/piece-state.test.ts` | `stateOf` 真值表；随机生成 500 步的 `hover / selection` 序列逐步推进弹簧，任意时刻至多一片目标为 `hover`、至多一片为 `selected`；序列结束后 0.5s 所有弹簧静止且各量等于目标表中的值 |
| `tests/render/map/travel.test.ts` | `planTravel`：`apCost` = 10 / 30 / 60 / 200 → `hops` = 2 / 3 / 6 / 6；`sampleTravel` 在 `t = 0` 与 `t = totalMs` 的边界值；`curveT` 单调不减；`lineProgress` 先于第一跳到 1；`t > totalMs` 时停在末态 |
| `tests/render/map/pan-rig.test.ts` | 以指针为锚缩放：缩放前后该屏幕点对应的地面点位移 < 1e-3；拖拽：按下点对应的地面点在拖拽过程中始终位于指针下；越界松手后 0.6s 内回到 `bounds` 内 |
| `tests/render/camera/follow-rig.test.ts` | `distanceForCells(3, 1, 27, 16/9)` ≈ 3.51（容差 0.01）；把该距离下画面左右边缘投回地面，间距 = 3 格（容差 1e-3）；宽高比改为 4:3 后重算仍满足；近档注视点恒等于棋子格心（无死区），中档棋子在 1 格内移动时注视点不动 |
| `tests/render/grid/ground-shader.test.ts` | 不定义 `GROUND_ARRAY` 时，`extend.apply` 之后的片元源码不引用 `tGround`；`setSeed` 相同则 `tTerrain` 的 G 通道逐格相同、不同种子则不同（带底纸路径的锚点测试在 M3-WO3 §8.2） |
| `tests/render/grid/picker.test.ts` | 俯角 53° 相机下，把每个格心投影到屏幕再拾取，得回原下标（30×30 全测）；地图外返回 −1；登记了高包围盒时，点在盒的上半部分返回盒所在格而不是它后面的格；v1.2：`setHeightAt` 给一块 0.15 高的台面时，把台面上任意点（含近侧边内 0.05 格处）投影到屏幕再拾取得回该格，不设 `heightAt` 时同一点偏到前一格（证明修正是必需的）；`setHeightAt(null)` 后与平面拾取逐格一致 |
| `tests/render/grid/highlighter.test.ts` | 同一格先后设 `path`、`hover`、`selected`，归并结果为 `selected`；`clear('hover')` 后变回 `path`；无改动时 `flush` 不上传 |
| `tests/core/world/path.test.ts` | 均匀格耗下路径长度 = 曼哈顿距离；绕过不可通行格；高耗格与绕路的取舍正确；`budget` 不足返回 `null`；`reachable` 的结果与对每格单独 `findPath` 一致（10×10 随机图对拍） |
| `tests/render/grid/token-mover.test.ts` | 假时钟下 `walk` 5 格共 850ms；`interrupt` 后在当前一跳结束时返回 `'interrupted'`，位置恰在格心；`onStep` 按序触发 |

目视项见 §14。

---

## 13. 性能预算

基准同 WO1（集显笔记本，1080p，`high` 档）。

| 场景 | 预算 |
| --- | --- |
| 省域图静止 | 60fps；draw call ≤ 110（40 片 × 2 + 装饰 + 棋子 + 纸带）；三角形 ≤ 10 万；阴影贴图不重画；进入省电节流 |
| 省域图交互中 | 悬停到开始抬起 ≤ 1 帧；任意时刻同时在动的片 ≤ 3–4 片（选中 + 悬停 + 刚离开的）；帧时间 ≤ 10ms |
| 拾取 | 每次 ≤ 0.3ms（< 40 个网格的 raycast；必要时给每片建 `BoundsTree` 之类的加速结构，**先不做**，超预算再加） |
| 格子图 30×30 | 地面 1 个 draw call；`tHighlight` 上传每帧至多一次；路径预览（寻路 + 写纹理）每次悬停变化 ≤ 0.5ms |
| 首次进入省域图 | 建全部片的几何 ≤ 120ms（放在 `preload` 里，分帧做，每帧 ≤ 8ms） |
| 显存 | 省域图专属 ≤ 40MB（含 2048² 阴影贴图） |

---

## 14. 交付检查清单

**省域图**

- [ ] 用夹具数据（零内容包）可完整运行；换一份符合 schema 的 `provinces.json` 后不改代码即可显示
- [ ] 各片按高度档叠放，高片在低片上投下影子；片与片之间有等宽纸缝；片缘可见一圈纸芯白
- [ ] 悬停：片抬起、白边提亮、光标变手型；快速划过多片后没有残留的抬起或高亮
- [ ] 选中：片升到最高并过渡到强调色，其余片压暗去饱和；过渡中途颜色不发灰（对比关掉 OKLab 的版本截图）
- [ ] 选中片的影子比其他片明显更宽更虚（`high` 档）
- [ ] `locked` 片不响应悬停，点击只弹原因提示
- [ ] 三种图层可切换，底色平滑过渡；切换不影响选中片的颜色
- [ ] 省名标注跟随相机与片的抬升；拥挤时小片的名字先隐藏；拉近后省名淡出、山脊立牌淡入
- [ ] 云缓慢漂移并在地图上投下影子；指针靠近时溶解让位
- [ ] 拖拽平移时抓住的点跟手；滚轮缩放以指针为锚；越界回弹；有惯性
- [ ] 键盘：方向键在相邻片间移动选择，`Enter` 前往，`Esc` 取消
- [ ] 进场演出 ≤ 1.4s 且可跳过；`prefers-reduced-motion` 下无演出、状态切换改为 80ms 淡变

**旅行与转场**

- [ ] 确认前往后：纸带逐段铺出 → 棋子分段跳到终点（朝向正确、落地有压扁）→ 终点片脉冲 → 俯冲进入格子图
- [ ] 行动力读数在棋子到达时变化；路程越远跳的次数越多（2–6 次）
- [ ] 演出可跳过；跳过后状态与看完一致
- [ ] `dive`：选中片放大充满画面后切到格子图，两端轮廓大体重合，无黑帧
- [ ] `rise`：从格子图返回，回到省域图时该省仍为选中状态
- [ ] `pickOnly` 模式在新建向导第 ② 步可用：只能选省、无棋子与驿路、选中即回调

**格子基线**

- [ ] 30×30 与 20×20 两种尺寸的地面正确显示：每格一张小方纸、之间有纸缝、逐格有轻微明暗差；最远缩放下纸缝不闪烁
- [ ] 悬停格高亮；可达格显示路径与总耗；行动力不足时超出部分标为不可达
- [ ] 点击后棋子逐格跳跃，每格落地时选中高亮与行动力读数同步更新；移动中改目标能正确转向
- [ ] 相机跟随有死区、不越出地图边缘；手动拖拽后能自动回归
- [ ] 选中格上方有一张抬起的小方纸并带影子

**工程**

- [ ] §12 的测试全部通过
- [ ] §13 的预算逐项实测，数字写进交付说明
- [ ] 场景代码里没有写死的显示文字、颜色名、省份数量：片数、配色、名称 key、装饰摆位全部来自数据
- [ ] `WorldMapScene`、`RegionScene` 都实现了 `IScene` 的 `getFocusRect / alignTo / isIdle`
- [ ] 格子地面通过 `createPaperMaterial` 的 `extend` 钩子追加的着色有对应的锚点测试
