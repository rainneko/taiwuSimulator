# M3-WO1：纸片渲染工具箱与主界面骨架

> 工单版本 v1.1 · 2026-11-23 · 执行会话撰写
> v1.1 修订（§2.6）：图集改用 `ImageBitmapLoader` 且不预乘；`art-manifest.json` 条目扩展为三种，`AssetCache` 增加 `resolveTexture` / `resolveArrayLayer`。
> 前置：M1-WO1 §1（Vite + TS + ESLint 分层的工程骨架）。不依赖战斗模块，可与 M1/M2 并行。
> 预估：8–10 天
> 验收：浏览器里能看到「纸模舞台」主菜单——各层纸片依次翻起、带软阴影、灯在纸后时透亮；点菜单项经 `fold` 翻页转场进入一个空的地点场景再翻回来；`/dev/paper.html` 画廊页能逐项演示材质、铰链、合批、阴影档位与四种转场。
> 依据：`docs/UI_MAIN.md` §1–§3、§4.1、§5；`docs/PLAN.md` §2、§4.0。
> 内容：本工单只定渲染技术与界面骨架，**不含任何名称、文案、图像**。显示文字一律是 `strings` 表的 key，图一律是 `artKey` → 图集帧，由内容包提供；内容包缺图时用程序生成的占位牌，所以本工单在零美术资源下可以完整验收。

---

## 0. 范围

**做**

| 块 | 产出 |
| --- | --- |
| 纸片工具箱 `src/render/paper/` | `PaperMaterial`、纤维纹理、`PaperCard` + 铰链弹簧、`PaperBatch`、软阴影与画质档位、灯光预设 |
| 资源 `src/render/assets/` | 图集格式、`AssetCache`（引用计数）、占位牌生成器 |
| 应用骨架 `src/app/` | 唯一 renderer 与主循环、`IScene` / `SceneManager`、`InputRouter`、`TransitionPass`（fold / dive / rise / tear） |
| 界面骨架 `src/ui/` | `store`（signals）、六层 DOM 结构、`LabelProjector`、`PortraitStage`、`ModalHost`、顶栏空壳 |
| 第一个场景 | `MenuScene` + 主菜单 DOM + 新建向导的三步框架 |
| 开发页 | `/dev/paper.html` 画廊，用于目视验收与调参 |

**不做**

- 大地图、格子地面、棋子移动 → M3-WO2。
- 城镇场景（`BuildingKit`、建造模式）、人物面板 / NPC / 门派面板的内容 → 各自的后续工单；本工单只把它们要挂的宿主（`PanelHost`、`PortraitStage`）立起来。
- 景深等后期 → M4 评估。
- 战斗场景。战斗由 M1-WO4 负责；本工单只在 §3.7 约定它如何接入 `SceneManager`。

### 0.1 与 M1-WO4 的衔接（总监 2026-11-23 已确认：共用 renderer）

WO4 用「three.js 画布 + spine 画布」双画布；本工单按 UI_MAIN §1.1 用单画布。两者这样拼：

- 全局只有一个 three.js `WebGLRenderer` 和它的 `<canvas id="scene">`。WO4 的 Layer 1（视差背景、地面、纸屑）作为 `CombatScene implements IScene` 画在这块画布上，不再自建 renderer。
- WO4 的 Layer 2 画布由 `CombatScene.enter()` 创建、`exit()` 销毁，插在 `#scene` 与 `#labels` 之间。它有自己的 WebGL 上下文，**转场抓不到它的画面**：所以进战斗时在转场结束后再淡入这块画布，出战斗时先淡出再开始转场。
- WO4 引用的 `src/render/PaperMaterial.ts`、`createPaperMaterial({ map })`、`patchPCSS(renderer)` 由本工单提供（§2.1、§2.5），路径与签名保持兼容；WO4 §6 提到的「完整实现见 v1.0 工单」已不在仓库里，以本工单 §2.1 为准。

已确认的分工：附属画布的生命周期完全归 `CombatScene`，`SceneManager` 不知道它的存在。若 M1 先于 M3 开工，WO4 的实现方需先完成本工单的 §2.1、§2.2、§2.5。

---

## 1. 依赖与目录

```bash
npm i preact @preact/signals
npm i -D @preact/preset-vite jsdom
```

`three` 请在 `package.json` 里**写死精确版本**（不带 `^`）。§2.1、§2.5 都要改写 three 的内置着色器片段，小版本之间片段内容会变；写死版本 + §6 的锚点测试是防线。

版本号：**`three@0.187.0`**（总监 2026-11-23 确认，与 papertrails 一致，§2.5 的 PCSS 可以原样移植）。`@types/three` 取对应的 0.187.x。M1-WO1 §1.1 的 `npm i three` 同步为这个版本。

```bash
npm i -E three@0.187.0
```

```
src/
├─ app/
│  ├─ main.ts               # 建 renderer、store、SceneManager，启动主循环
│  ├─ RenderLoop.ts
│  ├─ SceneManager.ts       # IScene、goto、缓存策略
│  ├─ InputRouter.ts
│  └─ quality.ts            # 画质档位与自动降档
├─ render/
│  ├─ PaperMaterial.ts      # 仅一行 re-export，兼容 WO4 的路径
│  ├─ paper/
│  │  ├─ PaperMaterial.ts
│  │  ├─ fibre.ts           # 纤维纹理生成（纯函数 + DataTexture 包装）
│  │  ├─ hinge.ts           # 铰链弹簧（纯函数，无 three 依赖）
│  │  ├─ PaperCard.ts
│  │  ├─ PaperBatch.ts
│  │  ├─ shadows.ts         # patchPCSS、blob 阴影
│  │  └─ lighting.ts        # 灯光预设
│  ├─ assets/
│  │  ├─ atlas.ts           # AtlasJson 的 zod schema 与类型
│  │  ├─ AssetCache.ts
│  │  └─ placeholder.ts     # 占位牌
│  ├─ post/TransitionPass.ts
│  ├─ overlay/LabelProjector.ts
│  ├─ stage/PortraitStage.ts
│  └─ scenes/MenuScene.ts
├─ ui/
│  ├─ store.ts
│  ├─ App.tsx               # 六层结构
│  ├─ layers/ (LabelLayer, Hud, PanelHost, ModalHost, TransitionCurtain, DragLayer, TooltipLayer)
│  ├─ screens/ (MainMenu.tsx, NewGameWizard.tsx)
│  ├─ widgets/ (PaperButton, Bar, PortraitSlot, ReasonList)
│  └─ styles/ (tokens.css, paper.css)
└─ dev/
   └─ paper-gallery.ts      # /dev/paper.html 的入口
tests/render/  tests/app/  tests/ui/
```

ESLint 分层补一条：`src/render/**` 不得导入 `src/ui/**` 的组件（只允许导入 `ui/store` 的类型与 signal）；`src/ui/**` 不得导入 `three`（`PortraitSlot` 通过 `PortraitStage` 的注册函数间接使用）。

---

## 2. 纸片工具箱

### 2.1 PaperMaterial（`src/render/paper/PaperMaterial.ts`）

`MeshLambertMaterial` + `onBeforeCompile`，注入四样东西：

| 效果 | 做法 | 控制量 |
| --- | --- | --- |
| 纸纤维 | 世界坐标三向投影采样一张可平铺的纤维纹理，乘到漫反射色上 | `uPaperFibre`（强度，默认 0.22）、`uPaperFibreScale`（每米重复数，默认 1.6） |
| 包裹漫反射 | `wrap = saturate((N·L + w) / (1 + w))`，背光面不死黑 | `uPaperLight.x`（w，默认 0.35） |
| 背光透射 | `N·L < 0` 时加一项 `saturate(-N·L) × 透射量 × 透射色`，灯在纸后时纸面透亮 | `uPaperLight.y`（默认 0.55）、`uPaperTransTint`（默认暖白 `#ffe9c4`） |
| 模切白边 | 贴图 alpha 在 `[alphaTest, alphaTest + 边宽]` 这一圈向纸芯色提亮 | `uPaperRim`（`vec3`：起、止、强度，默认 `0.5, 0.82, 0.85`）、`uPaperRimColor` |

另有两个逐材质的演出量：`uPaperFlash`（白闪 0–1）、`uPaperFade`（溶解式淡出 0–1，用蓝噪抖动丢弃像素，不走半透明混合，所以不需要排序）。

```ts
import {
  Color, DoubleSide, FrontSide, MeshLambertMaterial, ShaderChunk, Texture, Vector2, Vector3,
} from 'three';
import { getFibreTexture } from './fibre';

export interface PaperMaterialOptions {
  map?: Texture | null;        // 图集贴图；无贴图 = 纯色卡纸
  color?: number | string;     // 纯色卡纸的颜色，或贴图的整体染色
  cutout?: boolean;            // 有 alpha 镂空（立牌）。默认：有 map 则 true
  doubleSided?: boolean;       // 立牌 true（默认），地面 / 挤出体 false
  fibre?: number;
  rim?: boolean;               // 模切白边，默认随 cutout
  vertexSide?: boolean;        // 读顶点属性 aSide（0 顶面 / 1 侧面），侧面压暗——挤出的纸板用
  /** 内置注入全部完成后调用，供个别场景再追加着色（如 WO2 的格子地面）。须同时给 cacheKey。 */
  extend?: { cacheKey: string; apply: (shader: { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }) => void };
}

/** 所有 PaperMaterial 共用的 uniform 对象：改一处，全场生效（季节、昼夜、画质）。 */
export const paperGlobals = {
  uPaperFibreTex: { value: null as Texture | null },
  uPaperFibreScale: { value: 1.6 },
  uPaperLight: { value: new Vector2(0.35, 0.55) },        // x = wrap, y = 透射量
  uPaperTransTint: { value: new Color('#ffe9c4') },
  uPaperRimColor: { value: new Color('#fbf7ee') },
  uPaperSideDarken: { value: 0.72 },
};

const LAMBERT_ANCHOR =
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;';

/** 找不到锚点就抛错：three 升级后片段变了，必须人来看，不能静默失效。 */
function replaceOrThrow(src: string, anchor: string, to: string, what: string): string {
  if (!src.includes(anchor)) throw new Error(`[PaperMaterial] 着色器锚点失效：${what}`);
  return src.replace(anchor, to);
}

export function buildLambertPars(): string {
  return replaceOrThrow(
    ShaderChunk.lights_lambert_pars_fragment,
    LAMBERT_ANCHOR,
    /* glsl */ `
	float paperNL = dot( geometryNormal, directLight.direction );
	float paperWrap = saturate( ( paperNL + uPaperLight.x ) / ( 1.0 + uPaperLight.x ) );
	float paperBack = saturate( -paperNL ) * uPaperLight.y;
	vec3 irradiance = directLight.color * ( vec3( paperWrap ) + uPaperTransTint * paperBack );`,
    'lights_lambert_pars_fragment / dotNL',
  );
}

export function createPaperMaterial(opts: PaperMaterialOptions = {}): MeshLambertMaterial {
  const cutout = opts.cutout ?? !!opts.map;
  const rim = opts.rim ?? cutout;
  const mat = new MeshLambertMaterial({
    map: opts.map ?? null,
    color: new Color(opts.color ?? 0xffffff),
    side: (opts.doubleSided ?? true) ? DoubleSide : FrontSide,
    alphaTest: cutout ? 0.5 : 0,
    transparent: false,
  });

  const local = {
    uPaperFibre: { value: opts.fibre ?? 0.22 },
    uPaperRim: { value: new Vector3(0.5, 0.82, rim ? 0.85 : 0) },
    uPaperFlash: { value: 0 },
    uPaperFade: { value: 0 },
  };
  mat.userData.paper = local;                       // 外部通过它改演出量
  paperGlobals.uPaperFibreTex.value ??= getFibreTexture();

  mat.defines = { ...(mat.defines ?? {}), ...(opts.vertexSide ? { PAPER_VERTEX_SIDE: '' } : {}) };
  mat.customProgramCacheKey = () => `paper|${cutout ? 1 : 0}|${opts.vertexSide ? 1 : 0}|${opts.extend?.cacheKey ?? ''}`;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, paperGlobals, local);

    // ── 顶点：带出世界坐标（兼容 BatchedMesh / InstancedMesh）与侧面标记 ──
    shader.vertexShader = replaceOrThrow(
      shader.vertexShader, '#include <common>', /* glsl */ `#include <common>
varying vec3 vPaperWorld;
#ifdef PAPER_VERTEX_SIDE
attribute float aSide;
varying float vPaperSide;
#endif`, 'vertex / common');
    shader.vertexShader = replaceOrThrow(
      shader.vertexShader, '#include <project_vertex>', /* glsl */ `#include <project_vertex>
vec4 paperWP = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
paperWP = batchingMatrix * paperWP;
#endif
#ifdef USE_INSTANCING
paperWP = instanceMatrix * paperWP;
#endif
vPaperWorld = ( modelMatrix * paperWP ).xyz;
#ifdef PAPER_VERTEX_SIDE
vPaperSide = aSide;
#endif`, 'vertex / project_vertex');

    // ── 片元：声明 ──
    shader.fragmentShader = replaceOrThrow(
      shader.fragmentShader, '#include <common>', /* glsl */ `#include <common>
uniform sampler2D uPaperFibreTex;
uniform float uPaperFibre, uPaperFibreScale, uPaperFlash, uPaperFade, uPaperSideDarken;
uniform vec2 uPaperLight;
uniform vec3 uPaperTransTint, uPaperRimColor, uPaperRim;
varying vec3 vPaperWorld;
#ifdef PAPER_VERTEX_SIDE
varying float vPaperSide;
#endif
float paperFibre( vec3 p ) {
	// 用屏幕空间导数求面法线，决定三向投影的权重；不需要额外 varying
	vec3 n = abs( normalize( cross( dFdx( p ), dFdy( p ) ) ) );
	n /= ( n.x + n.y + n.z );
	vec3 q = p * uPaperFibreScale;
	vec3 s = texture2D( uPaperFibreTex, q.zy ).rgb * n.x
	       + texture2D( uPaperFibreTex, q.xz ).rgb * n.y
	       + texture2D( uPaperFibreTex, q.xy ).rgb * n.z;
	return s.r * 0.6 + s.g * 0.4;          // r = 细颗粒，g = 长纤维
}
const float PAPER_BAYER[16] = float[16](      // 4×4 有序抖动，够用且稳定
	0.0, 8.0, 2.0, 10.0,  12.0, 4.0, 14.0, 6.0,  3.0, 11.0, 1.0, 9.0,  15.0, 7.0, 13.0, 5.0 );
float paperDither( vec2 fc ) {
	ivec2 p = ivec2( mod( floor( fc ), 4.0 ) );
	return ( PAPER_BAYER[ p.x + p.y * 4 ] + 0.5 ) / 16.0;
}`, 'fragment / common');

    // ── 片元：光照模型 ──
    shader.fragmentShader = replaceOrThrow(
      shader.fragmentShader, '#include <lights_lambert_pars_fragment>', buildLambertPars(),
      'fragment / lights_lambert_pars_fragment');

    // ── 片元：白边在 alphaTest 丢弃之前算；纤维与侧面压暗乘到漫反射色 ──
    shader.fragmentShader = replaceOrThrow(
      shader.fragmentShader, '#include <alphatest_fragment>', /* glsl */ `
float paperRim = ( 1.0 - smoothstep( uPaperRim.x, uPaperRim.y, diffuseColor.a ) ) * uPaperRim.z;
diffuseColor.rgb = mix( diffuseColor.rgb, uPaperRimColor, paperRim );
#include <alphatest_fragment>
if ( uPaperFade > 0.0 && paperDither( gl_FragCoord.xy ) < uPaperFade ) discard;
float paperF = paperFibre( vPaperWorld );
diffuseColor.rgb *= 1.0 - uPaperFibre + uPaperFibre * 2.0 * paperF;
#ifdef PAPER_VERTEX_SIDE
diffuseColor.rgb *= mix( 1.0, uPaperSideDarken, vPaperSide );
#endif`, 'fragment / alphatest_fragment');

    // ── 片元：白闪加在最终颜色上（色调映射之前）──
    shader.fragmentShader = replaceOrThrow(
      shader.fragmentShader, '#include <opaque_fragment>', /* glsl */ `
outgoingLight = mix( outgoingLight, vec3( 1.0 ), uPaperFlash );
#include <opaque_fragment>`, 'fragment / opaque_fragment');

    opts.extend?.apply(shader);
  };
  return mat;
}
```

实现注意：

- 上面的锚点字符串按写工单时的 three 片段写成，**以写死的那个版本的源码为准逐条核对**（`node_modules/three/src/renderers/shaders/ShaderChunk/lights_lambert_pars_fragment.glsl.js` 等）。对不上就改锚点，不要改成「找不到就跳过」。
- 立牌用 `alphaTest` 镂空而不是半透明混合：不用排序、能写深度、能投影。代价是边缘要靠图集里的 alpha 羽化（§2.6）和 MSAA 来软化。
- 立牌投影：three 的阴影通道会自动把带 `map` + `alphaTest` 的材质换成带镂空的深度材质，`BatchedMesh` 也支持；实现后请在画廊页确认影子是剪影形状而不是矩形，这是容易出错的一处。
- 逐实例的染色用 `BatchedMesh.setColorAt`（three 内置的 `vColor` 路径，不需要我们注入）。
- `src/render/PaperMaterial.ts` 只写一行 `export * from './paper/PaperMaterial';`。

### 2.2 纤维纹理（`fibre.ts`）

程序生成，512×512，四向可平铺，固定种子（同一份纹理全局复用，不随存档变）。拆成纯函数与包装两层，纯函数可以在 Node 里测。

```ts
/** 返回 RGBA8：R = 细颗粒，G = 长纤维，B = 大尺度深浅斑，A = 255。 */
export function makeFibreData(size = 512, seed = 0x5eed): Uint8Array;
export function getFibreTexture(): DataTexture;   // 单例；RepeatWrapping、LinearMipmapLinear、NoColorSpace
```

生成步骤：

1. **R**：两个倍频的值噪声（格距 4px 与 11px），坐标取模保证平铺，归一到均值 0.5。
2. **G**：撒 `size × 1.4` 根纤维，每根是长 18–70px、宽 1px 的线段，方向在 `±25°` 内偏向水平（纸有纹向），亮度 ±0.35 随机正负；逐像素累加，越界取模回卷；最后做一次 3×3 模糊，归一到均值 0.5。
3. **B**：格距 96px 的值噪声，幅度 ±0.12，均值 0.5。

`paperFibre()` 的输出均值应为 0.5，这样 `diffuse *= 1 − k + 2k·f` 不改变整体亮度——测试里验证三个通道的均值都在 `0.5 ± 0.02`。

### 2.3 铰链弹簧与 PaperCard

**`hinge.ts`**（纯函数，无 three 依赖）

角度 `θ`：0 = 平躺在地上（面朝上，顶边指向远离镜头的一侧），`π/2` = 立正。

```ts
export const enum HingeState { FLAT = 0, RISE = 1, LOCKED = 2, FALL = 3 }

export interface HingeParams {
  omega: number;     // 固有频率 rad/s
  zeta: number;      // 阻尼比；< 1 有过冲
  restAngle: number; // 立正角，默认 π/2
}
export const HINGE_RISE: HingeParams = { omega: 16, zeta: 0.42, restAngle: Math.PI / 2 }; // 过冲约 20%，「咔」地锁定
export const HINGE_FALL: HingeParams = { omega: 12, zeta: 1.0, restAngle: 0 };
export const HINGE_HALF = 15 * Math.PI / 180;   // 「施工中」的半立角

/** 半隐式欧拉，内部按 ≤ 1/120 s 细分；返回是否已静止（可转 LOCKED / FLAT）。 */
export function stepHinge(
  s: { theta: number; vel: number }, target: number, p: HingeParams, dt: number,
): boolean {
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  const k = p.omega * p.omega, c = 2 * p.zeta * p.omega;
  for (let i = 0; i < n; i++) {
    s.vel += (-k * (s.theta - target) - c * s.vel) * h;
    s.theta += s.vel * h;
  }
  if (s.theta < 0) { s.theta = 0; s.vel = Math.abs(s.vel) * 0.25; }     // 不许穿到地面以下，轻弹一下
  const rest = Math.abs(s.theta - target) < 0.002 && Math.abs(s.vel) < 0.02;
  if (rest) { s.theta = target; s.vel = 0; }
  return rest;
}

/** 通用临界阻尼弹簧（闭式解，任意 dt 稳定）。相机、省片抬升、颜色过渡都用它。 */
export function stepSpring(
  s: { x: number; v: number }, target: number, omega: number, dt: number,
): void {
  const e = s.x - target, t = s.v + omega * e, ex = Math.exp(-omega * dt);
  s.x = target + (e + t * dt) * ex;
  s.v = (s.v - omega * t * dt) * ex;
}
```

**`PaperCard.ts`**——单张立牌（数量少、需要独立控制的东西用它：标题牌、棋子、菜单舞台的各层）

```ts
export interface CardSpec {
  width: number; height: number;          // 米
  uv: [u0: number, v0: number, u1: number, v1: number];
  anchorX?: number;                        // 铰链轴上的锚点，0–1，默认 0.5
}
/** 平面几何，原点在底边锚点：x ∈ [-w·ax, w·(1-ax)]，y ∈ [0, h]，法线 +Z。 */
export function makeCardGeometry(spec: CardSpec): BufferGeometry;

export class PaperCard extends Mesh<BufferGeometry, MeshLambertMaterial> {
  readonly hinge = { theta: 0, vel: 0 };
  state: HingeState = HingeState.FLAT;
  yaw = 0;                                 // 绕 Y 的固定朝向；不是 billboard，不跟相机转
  rise(delay = 0): void;                   // → RISE，到位后 LOCKED
  fall(delay = 0): void;                   // → FALL，到位后 FLAT
  setHalf(): void;                         // 目标角 = HINGE_HALF
  nudge(impulse: number): void;            // 给角速度一个冲量（选中时前倾再回正）
  update(dt: number): void;                // 走弹簧，写 rotation
}
```

姿态换算：`mesh.quaternion = quatY(yaw) × quatX(θ − π/2)`。`θ = 0` 时牌面朝上平躺，`castShadow` 关掉（贴地的牌不投影，省一次深度绘制且避免阴影瑕疵）；`θ > 0.05` 时打开。

### 2.4 PaperBatch（`PaperBatch.ts`）

几百张立牌共用一张图集时，合成一个 `BatchedMesh`：**每个图集帧注册为一份几何**（UV 烘在几何里），每张牌是一个实例。这是用 `BatchedMesh` 而不用 `InstancedMesh` 的原因——后者所有实例必须同一份几何。

```ts
export interface BatchCardInit {
  frame: string;                 // 图集帧名
  position: Vector3;             // 铰链轴锚点的世界坐标
  yaw?: number;
  scale?: number;
  startState?: HingeState;       // 默认 FLAT
  tint?: Color;
}
export type CardHandle = number;

export class PaperBatch {
  readonly mesh: BatchedMesh;
  constructor(atlas: Atlas, capacity: { cards: number; frames: number });
  add(init: BatchCardInit): CardHandle;
  remove(h: CardHandle): void;
  rise(h: CardHandle, delay?: number): void;
  fall(h: CardHandle, delay?: number): void;
  setHalf(h: CardHandle): void;
  nudge(h: CardHandle, impulse: number): void;
  setTint(h: CardHandle, c: Color): void;
  setFrame(h: CardHandle, frame: string): void;   // 换图（升级、换季）
  update(dt: number): void;                       // 只遍历「正在动」的牌
  dispose(): void;
}
```

实现要点：

- 状态用并行的 TypedArray（`theta`、`vel`、`target`、`delay`、`state`、`pos×3`、`yaw`、`scale`），不为每张牌建对象。
- 维护一个 `active` 索引集合（`RISE` / `FALL` / 有冲量的）。`update` 只走这个集合，算完铰链后 `setMatrixAt`；静止后移出集合。几百张牌全部锁定时 `update` 的开销应为零。
- `delay` 支持按距离错开起立，形成翻书波纹：调用方传 `delay = 距离 × 0.035s`。
- `mesh.sortObjects = false`（镂空材质不需要排序）；`perObjectFrustumCulled = true`。
- 容量按场景上限一次分配（`maxInstanceCount`、顶点数 = `frames × 4`、索引数 = `frames × 6`），不做动态扩容。
- `setFrame` = `setGeometryIdAt`（three 较新版本提供）；若写死的版本没有这个方法，退化为「删实例 + 加实例」。

### 2.5 阴影与画质档位（`shadows.ts`、`app/quality.ts`）

阴影是「立起来的纸」的主要视觉证据：接触处实、离得越远越虚。三档：

| 档位 | 阴影 | 阴影贴图 | MSAA | 转场 RT | 触发 |
| --- | --- | --- | --- | --- | --- |
| `high` | PCSS（遮挡体搜索 + 可变半影） | 2048² | 4× | 全分辨率 | 默认；独显 |
| `medium` | `PCFSoftShadowMap` 固定软边 | 1024² | 4× | 全分辨率 | 自动降档第一级 |
| `low` | 不开阴影贴图；每张立牌脚下一片椭圆 blob | — | 关 | 半分辨率 | 自动降档第二级、`?q=low` |

```ts
export function patchPCSS(renderer: WebGLRenderer, opts?: {
  lightSize?: number;        // 光源的视在尺寸，世界单位，默认 0.9；越大半影越宽
  blockerSamples?: number;   // 默认 12
  pcfSamples?: number;       // 默认 16
}): void;                    // 幂等；必须在任何材质编译之前调用
export function unpatchPCSS(): void;   // 换档时恢复原片段，并把所有材质标 needsUpdate
export class BlobShadows {   // low 档：一个 InstancedMesh，贴地椭圆，乘色混合
  constructor(capacity: number);
  set(i: number, x: number, z: number, radiusX: number, radiusZ: number, strength: number): void;
}
```

PCSS 的实现方式：

- 做法是改写 `ShaderChunk.shadowmap_pars_fragment`：注入泊松盘采样、遮挡体平均深度搜索、按 `(接收深度 − 遮挡深度) / 遮挡深度 × lightSize` 估半影宽度的 PCF，再把基础阴影类型的那条采样分支换成调用它。渲染器设 `shadowMap.type = BasicShadowMap`（与 WO4 §7 一致）。
- **请直接从 papertrails 的源码移植这一段**（MIT，文件头保留其版权声明），不要凭印象重写：这个片段随 three 版本变动较大，papertrails 那份是对着同一个 three 版本调通的。移植后同样走 `replaceOrThrow`，锚点失效要抛错。
- 方向光的阴影相机必须贴合场景范围（每个场景在 `enter` 里按自己的包围盒设 `shadow.camera` 的 left / right / top / bottom / far），否则 2048² 的精度不够用，半影估计也会失真。`shadow.bias = -0.0005`、`normalBias = 0.02` 起调。
- 如果移植遇阻，`high` 档先用 `PCFSoftShadowMap` + `shadow.radius = 4` 顶上并在交付说明里写明，不要卡住其余工作。

自动降档（`quality.ts`）：进入一个场景后的第 30–150 帧取帧时间中位数，> 20ms 降一档，降档后重新计；只降不升，用户可在设置里手动选。档位写进 `localStorage`（读写包 try/catch）。

### 2.6 灯光预设、图集与资源缓存

**灯光**（`lighting.ts`）：数值取 WO4 §7 的那一组作为 `warmDay`，保证战斗背景与世界场景的纸色一致。

```ts
export interface LightRig { key: DirectionalLight; fill: DirectionalLight; hemi: HemisphereLight; group: Group }
export function createLightRig(preset: 'warmDay' | 'coolNight' | 'menu'): LightRig;
export function fitShadowCamera(rig: LightRig, bounds: Box3): void;
```

| 预设 | key | fill | hemi | 用途 |
| --- | --- | --- | --- | --- |
| `warmDay` | `0xffd29c` × 2.5，位置 `(-5, 8, 3)` | `0x8899bb` × 0.6，`(3, 4, -2)` | `(0x9bb5d4, 0x8b7355)` × 0.5 | 地点场景默认 |
| `coolNight` | `0x9fb4e8` × 1.1，同位置 | `0x39406a` × 0.4 | `(0x2a3358, 0x1b1a22)` × 0.5 | 夜间；窗户靠透射量 `uPaperLight.y` 提到 0.9 点亮 |
| `menu` | `0xffc98a` × 2.2，位置沿 X 在 `[-6, 6]` 间 40s 往返 | 同 `warmDay` | 同 `warmDay` | 主菜单：影子缓慢移动 |

渲染器：`outputColorSpace = SRGBColorSpace`，`toneMapping = NoToneMapping`（平涂的纸色要与图集里的颜色一致，不让色调映射改色）。

**图集**（`atlas.ts`）

```ts
export interface AtlasFrame {
  name: string;
  rect: [x: number, y: number, w: number, h: number];   // 像素，左上角原点
  size: [w: number, h: number];                          // 立起来后的物理尺寸，米
  anchor?: [ax: number, ay: number];                     // 铰链锚点，默认 [0.5, 0]（底边中点）
}
export interface AtlasJson {
  image: string;                 // 相对路径，WebP
  size: [w: number, h: number];
  feather: number;               // 剪影边缘 alpha 羽化宽度，像素；要求 ≥ 2（白边与抗锯齿都靠它）
  padding: number;               // 帧间距，像素；要求 ≥ 4，且边缘颜色外扩（避免 mipmap 渗黑）
  frames: AtlasFrame[];
}
```

贴图是直通 alpha（非预乘）、`SRGBColorSpace`、开 mipmap、`anisotropy = 4`。**图片用 `ImageBitmapLoader` 读，并 `setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })`**——浏览器默认按预乘解码，透明像素的 RGB 会被清零，图集做的边缘颜色外扩就失效了，远处的牌会出黑边。

**`artKey` 解析**：内容包提供 `art-manifest.json`，条目有三种（v1.1，随 M3-WO3 §3.1 扩展）：

```ts
type ArtEntry =
  | { atlas: string; frame: string }      // 图集帧
  | { array: string; layer: number }      // 纹理数组的一层（地面底纸）
  | { texture: string };                  // 单张纹理（道路、迷雾、遮罩、边框）
```

场景代码只认 `artKey`。解析不到时返回占位并 `console.warn` 一次（同一个 key 只报一次）。

**占位牌**（`placeholder.ts`）：用 2D canvas 现画一张图集——每个缺失的 `artKey` 一帧：圆角矩形剪影，底色由 key 的哈希取色相（低饱和），中间印 key 的末段文字。开发期所有场景都靠它跑起来。

**`AssetCache`**

```ts
export class AssetCache {
  acquire(atlasId: string, signal?: AbortSignal): Promise<Atlas>;   // 引用计数 +1；并发请求合并
  release(atlasId: string): void;                                   // 计数归零后延迟 5s 再真正 dispose
  resolve(artKey: string): { atlas: Atlas; frame: AtlasFrame };     // 图集帧；含占位回退
  resolveTexture(artKey: string): Texture;                          // 单张纹理；缺失时回退 1×1 中性色
  resolveArrayLayer(artKey: string): { texture: DataArrayTexture; layer: number } | null;   // 数组层；缺失返回 null，由调用方走纯色路径
  stats(): { atlases: number; textureBytes: number };               // 设置页与预算检查用
}
```

延迟释放是为了「出去又马上回来」时不重复解码。`textureBytes` 按 `w × h × 4 × 1.33` 估算；超过 256MB 时按最久未用顺序强制释放计数为零的图集，并打警告。

---

## 3. 应用骨架

### 3.1 页面结构

```html
<div id="root">
  <canvas id="scene"></canvas>        <!-- z0  唯一的 three.js 画布 -->
  <div id="labels"></div>             <!-- z1  场景标注层，pointer-events: none -->
  <div id="hud"></div>                <!-- z2 -->
  <div id="panels"></div>             <!-- z3 -->
  <div id="modals"></div>             <!-- z4 -->
  <div id="curtain"></div>            <!-- z5  仅加载提示；幕本身画在 #scene 上 -->
</div>
```

`#hud`、`#panels` 的根节点 `pointer-events: none`，其中的控件各自 `pointer-events: auto`——空白处的指针事件自然落到 `#scene`，不需要手动转发。`#modals` 有遮罩时整层接事件。

样式变量（`tokens.css`）只定义结构性的量：纸色 / 墨色 / 强调色三组、阴影两级、圆角、间距阶梯、`--root-font: clamp(12px, 0.833vw, 18px)`。DOM 的「纸感」由 `paper.css` 提供三个工具类：`.paper`（底色 + 一张内嵌的小号纤维纹理背景）、`.paper-lift`（悬停时 `translateY(-2px)` + 阴影加深）、`.paper-cut`（1px 浅色内描边模拟模切）。纤维背景用 §2.2 的同一个生成函数出一张 128px 的图转成 `blob:` URL，保证 DOM 与场景的纸纹同源。

### 3.2 store（`src/ui/store.ts`）

类型定义照 UI_MAIN §2 原样落地，补上 signal 与少量规则：

```ts
import { signal, computed, batch } from '@preact/signals';

export const ui = {
  screen: signal<Screen>('boot'),
  transition: signal<{ from: Screen; to: Screen; progress: number } | null>(null),
  panel: signal<PanelId | null>(null),
  drawer: signal<PanelId | null>(null),
  modalStack: signal<ModalId[]>([]),
  selection: signal<Selection | null>(null),
  hover: signal<Selection | null>(null),
  quality: signal<'high' | 'medium' | 'low'>('high'),
  menuReady: signal(false),                                   // 主菜单进入演出播完，DOM 菜单列可以淡入
  dragPayload: signal<unknown>(null),                         // DragLayer 正在拖的东西；松手在场景上时由场景读取
  loading: signal<{ visible: boolean; ratio: number; retry: (() => void) | null }>({ visible: false, ratio: 0, retry: null }),
};

/** 游戏态镜像：由 Game 在每个逻辑步后整体替换引用。本工单只留接口与一个假数据源。 */
export const game = {
  time: signal<TimeState | null>(null),
  player: signal<CharacterState | null>(null),
  world: signal<WorldState | null>(null),
  town: signal<TownState | null>(null),
};

export const inputLocked = computed(() => ui.transition.value !== null);
export function closeTopmost(): boolean;   // Esc：模态 → 抽屉 → 主面板 → 取消选择，逐级关，返回是否关掉了东西
export function openPanel(p: PanelId): void;   // 同类面板替换；不同类则旧的进抽屉位（最多一层）
```

`Selection` 在 UI_MAIN §2 的四种（`province / region / cell / char`）之外补一种 `{ type: 'menu'; id: string }`，供主菜单的悬停联动使用。

规则：组件不直接写 `game.*`；`ui.screen` 只由 `SceneManager` 写；`ui.selection` / `ui.hover` 场景与组件都可以写，写入前比较相等（避免每帧触发重渲染）。

### 3.3 主循环（`RenderLoop.ts`）

```
每个 rAF：
  dt = min(now − last, 1/20)                 // 切后台回来不暴走
  sceneManager.update(dt)                     // 当前场景的弹簧、相机；转场进度
  sceneManager.render(renderer)               // 场景 →（转场中则走 TransitionPass）→ 屏幕
  portraitStage.render(renderer)              // 有可见占位时才画（scissor）
  labelProjector.flush()                      // 一次性写所有标注的 transform
```

- 画布尺寸跟随 `#root`（`ResizeObserver`），`setPixelRatio(min(devicePixelRatio, 2))`；`low` 档封顶 1。
- 省电：没有活动弹簧、没有转场、指针 2 秒未动、场景自报 `isIdle()` 时，降到每秒 10 帧；任何输入立即恢复。
- `document.visibilityState === 'hidden'` 时停循环。
- 监听 `webglcontextlost`（`preventDefault`）与 `webglcontextrestored`：恢复后 `AssetCache` 重建贴图，`SceneManager.reenter()` 对当前场景重跑 `preload → enter`。

### 3.4 IScene 与 SceneManager（`SceneManager.ts`）

接口照 UI_MAIN §3.1，补三个可选成员：

```ts
export interface IScene {
  readonly id: Screen;
  preload(assets: AssetCache, signal: AbortSignal): Promise<void>;
  enter(params: unknown, from: Screen | null): void;
  update(dt: number): void;
  render(r: WebGLRenderer, target: WebGLRenderTarget | null): void;
  onPointer(e: ScenePointerEvent): void;
  exit(to: Screen): void;
  dispose(): void;
  isIdle?(): boolean;                                        // 省电判定
  /** dive / rise 用：把 params 指向的那个物体在屏幕上的矩形给出来（NDC），没有就返回 null。 */
  getFocusRect?(params: unknown): { x0: number; y0: number; x1: number; y1: number } | null;
  /** dive / rise 用：摆好初始相机，使 rect 所示区域与上一场景的末帧大致重合。 */
  alignTo?(rect: { x0: number; y0: number; x1: number; y1: number }): void;
  /** dive / rise 的前半程：由旧场景自己推拉相机，t ∈ [0, 1]。 */
  setDiveProgress?(t: number, dir: 'dive' | 'rise', params: unknown): void;
  onKey?(e: KeyboardEvent): boolean;                          // 返回是否消费
}

export type TransitionStyle = 'fold' | 'dive' | 'rise' | 'tear';
export interface GotoOptions { style?: TransitionStyle; origin?: [number, number]; /* tear 的起点，NDC */ }
```

`goto` 的实现骨架（时序即 UI_MAIN §3.1 的七步）：

```ts
async goto(to: Screen, params?: unknown, opts: GotoOptions = {}): Promise<void> {
  if (this.busy) { this.pending = { to, params, opts }; return; }      // 转场中再来的请求：只保留最后一个
  this.busy = true;
  const from = this.current?.id ?? null;
  const style = this.pickStyle(from, to, opts.style);
  const next = this.getOrCreate(to);
  const abort = new AbortController();

  ui.transition.value = { from: from ?? 'boot', to, progress: 0 };     // ① 锁输入（inputLocked 派生）
  this.current?.render(this.renderer, this.rtA);                        // ② 旧场景定格到 rtA
  this.pass.begin(style, this.rtA, opts);

  const loaded = this.preloadWithTimeout(next, abort, 8000);            // ③ 并行：前半段 ‖ 预加载
  await this.playHalf(0, 0.5, style, Math.max(250, HALF_MS[style]));
  if (!(await settled(loaded))) ui.loading.value = { visible: true, ratio: 0, retry: null };   // ④ 没好就停在半程
  await loaded;                                                          //    超时 → 抛出，见下
  ui.loading.value = { visible: false, ratio: 1, retry: null };

  this.current?.exit(to);                                                // ⑤ 换场
  const rect = this.current?.getFocusRect?.(params) ?? null;
  next.enter(params, from);
  if ((style === 'dive' || style === 'rise') && rect) next.alignTo?.(rect);
  next.update(0);
  next.render(this.renderer, this.rtB);

  const prev = this.current; this.current = next;
  await this.playHalf(0.5, 1, style, HALF_MS[style]);                   // ⑥ 后半段：rtA → rtB
                                                                         //    后半段每帧 next.update + 重画 rtB，画面是活的
  batch(() => { ui.screen.value = to; ui.transition.value = null; });   // ⑦ 解锁
  this.applyCachePolicy(prev);
  this.busy = false;
  if (this.pending) { const p = this.pending; this.pending = null; void this.goto(p.to, p.params, p.opts); }
}
```

补充规则：

- `HALF_MS = { fold: 380, dive: 450, rise: 450, tear: 300 }`。
- `pickStyle`：未指定时按 UI_MAIN §3.2 的表取默认；`dive / rise` 两端有一端没实现 `getFocusRect / alignTo`，或 `getFocusRect` 返回 `null` → 退化为 `fold`。`prefers-reduced-motion` → 一律改为 200ms 交叉淡化。
- 预加载超时或失败：幕保持盖住，`ui.loading.retry` 给出重试函数（重新 `preload`）；用户也可以取消，取消则反向播放前半段回到旧场景（旧场景此时还没 `exit`）。**在 `next.enter` 之前失败都能无损退回**，这是把 `exit / enter` 放在预加载之后的原因。
- 缓存策略（`applyCachePolicy`）照 UI_MAIN §3.3：`worldMap` 常驻；`town`、`region` 各留最近 1 个；`mainMenu`、`newGame` 进游戏后立刻 `dispose`。
- `rtA / rtB`：尺寸 = 绘图缓冲区，`high / medium` 档 `samples: 4`，`low` 档半分辨率且不开 MSAA。只在转场期间占用，结束后 `dispose`（省显存，下次转场重建的代价可以忽略）。
- `prefetch(to, params)`：只跑 `preload`，不切换；供「选中 0.5s 后后台预取」使用。
- `retarget(to)`：两个 `Screen` 共用同一个场景实例时的轻量路径（主菜单 ⇄ 新建向导），不拍 RT、不播转场，只改 `ui.screen` 并通知场景换相机模式。
- `reenter()`：上下文恢复后对当前场景重跑 `preload → enter`（参数取上次 `goto` 记下的那份）。

### 3.5 InputRouter（`InputRouter.ts`）

监听挂在 `#scene` 上（DOM 控件在它上面，自然先接事件）。把原生指针事件整理成场景好用的形式：

```ts
export interface ScenePointerEvent {
  type: 'move' | 'down' | 'up' | 'click' | 'drag' | 'wheel' | 'leave' | 'pinch';
  ndc: Vector2;                    // [-1, 1]²，y 向上
  px: [number, number];            // 相对画布的 CSS 像素
  button: number;
  pointerType: 'mouse' | 'touch' | 'pen';
  delta?: [number, number];        // drag：与上一事件的像素差；wheel：[0, 归一化后的滚动量]；pinch：[缩放比, 0]
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
}
```

- `click` 的判定：按下到抬起位移 < 6px 且 < 400ms；否则是拖拽，不发 `click`。
- 拖拽开始时 `setPointerCapture`，指针划到面板上也不中断。
- 滚轮：`deltaMode` 归一化到「一格 = 1」；触控板的连续小增量累加，不逐个触发缩放档位。
- 双指：发 `pinch`（缩放比）与 `drag`（双指中点位移）。
- `inputLocked` 为真时丢弃一切事件，并对进行中的拖拽补发一个 `up`。
- 键盘：`Esc` → `closeTopmost()`；其余按键只在焦点不在表单控件内时转给当前场景的可选方法 `onKey`。
- `pickAt(clientX, clientY)`：给 `DragLayer` 用——DOM 拖拽松手在场景上方时，按这个坐标向当前场景发一次合成的 `click`（带 `mods` 之外的附加载荷由 store 的 `dragPayload` 传）。

### 3.6 TransitionPass（`post/TransitionPass.ts`）

一个类管四种样式。`begin(style, rtA, opts)` → 每帧 `render(renderer, rtB | null, progress)` → `end()`。`progress ∈ [0, 1]`，前半程 `rtB` 可以为 `null`。

| 样式 | 前半程（0 → 0.5） | 后半程（0.5 → 1） |
| --- | --- | --- |
| `fold` | 旧画面作为一页纸，右缘向内翘起到 8° 并停住（加载慢时就停在这） | 沿左侧竖轴向内折到 88°，同时带一点卷曲；露出后面的新画面，新画面起初被压暗 35% 并在折线旁有一道柔和投影，随进度消散 |
| `dive` | 由**旧场景自己**把相机推向选中物（`SceneManager` 在前半程继续调旧场景的 `update` 与一个 `setDiveProgress(t)`），pass 只是原样输出 | 6 帧交叉淡化到 `rtB`，随后新场景的相机从对齐位置缓出到正常构图 |
| `rise` | 旧场景相机略微拉起（同上，方向相反） | 同 `dive` |
| `tear` | 定格 | 噪声遮罩从 `origin` 向外撕开：`m = 距离(uv, origin) / 最远角距离 + (噪声 − 0.5) × 0.3`，`m < p′` 处显示 `rtB`；撕口处 0.02 宽的一圈纸芯白，外加 0.01 宽的暗边 |

`dive / rise / tear` 与交叉淡化共用一个全屏三角形 + 一个片元着色器：

```glsl
uniform sampler2D tA, tB, tNoise;
uniform float uP;          // 后半程内的归一化进度 0–1
uniform int uStyle;        // 0 = cross, 1 = tear
uniform vec2 uOrigin;      // uv 空间
uniform float uAspect, uFar;
uniform vec3 uCore;        // 纸芯色
varying vec2 vUv;
void main() {
  vec4 a = texture2D( tA, vUv ), b = texture2D( tB, vUv );
  if ( uStyle == 0 ) { gl_FragColor = mix( a, b, smoothstep( 0.0, 1.0, uP ) ); return; }
  vec2 d = ( vUv - uOrigin ) * vec2( uAspect, 1.0 );
  float n = texture2D( tNoise, vUv * vec2( uAspect, 1.0 ) * 1.7 ).g;
  float m = length( d ) / uFar + ( n - 0.5 ) * 0.3;
  float edge = uP * 1.35 - 0.15;                       // 让两端都能走完
  float core = smoothstep( edge - 0.02, edge, m ) * ( 1.0 - smoothstep( edge, edge + 0.004, m ) );
  float dark = smoothstep( edge, edge + 0.01, m ) * ( 1.0 - smoothstep( edge + 0.01, edge + 0.03, m ) );
  vec3 c = m < edge ? b.rgb : a.rgb * ( 1.0 - 0.25 * dark );
  gl_FragColor = vec4( mix( c, uCore, core ), 1.0 );
}
```

`tNoise` 直接用 §2.2 的纤维纹理，撕口的毛边与纸纹同源。

`fold` 是一个小的独立 3D 场景：

- 透视相机 fov 30°，距离 `d = (H/2) / tan(15°)`，使宽 `W = H × aspect` 的平面在进度 0 时恰好铺满视口。
- 新画面：全屏三角形，先画，不写深度。着色：`rtB × (1 − 0.35 × (1 − p′))`，再减去折线旁的投影 `0.3 × (1 − p′) × (1 − smoothstep(0, 0.12, (uv.x − 折线屏幕x)))`。
- 旧画面：`PlaneGeometry(W, H, 24, 1)`，几何平移使左缘在原点；顶点着色器里先按 `x/W` 做卷曲（绕竖轴的弯曲角 `= curl × (x/W)²`，`curl` 前半程 0 → 0.14，后半程保持），再整体绕左缘竖轴转 `φ`（前半程 0 → 8°，后半程 8° → 88°，`easeInOutCubic`），方向朝屏幕内。片元：`rtA × (0.55 + 0.45 × cos φ)`——越折越暗。关深度测试，后画。
- 朝内折而不是朝外翻：不会撞近裁剪面，背面也永远看不到，省去画纸背。

**尺寸变化**：转场中窗口缩放 → `rtA` 不重拍（拉伸显示），`rtB` 按新尺寸重建。

### 3.7 CombatScene 的接入约定

本工单不实现战斗场景，只约定接口，供 WO4 的实现方对接（前提见 §0.1）：

- `CombatScene.id = 'combat'`；`enter(params)` 的 `params = { encounterId, returnTo: Screen, origin: [x, y] }`。
- 进：`goto('combat', params, { style: 'tear', origin })`，转场结束（`ui.transition` 变回 `null`）后 `CombatScene` 自己把附属画布淡入（150ms）。
- 出：`CombatScene` 先淡出附属画布（150ms）并 `await`，再 `goto(returnTo, …, { style: 'tear' })`。
- 战斗期间 `#hud` 换成战斗 HUD（WO4 §8），`#panels` 清空，`ui.panel` 置空并在返回后恢复。

### 3.8 LabelProjector（`overlay/LabelProjector.ts`）

场景里需要文字的地方（地名、名牌、气泡）不画在 three.js 里，而是登记一个世界坐标，由它每帧投影成屏幕坐标写到 DOM。

```ts
export interface LabelSpec {
  id: string;
  world: Vector3;
  priority: number;            // 越大越优先；拥挤时低优先级的隐藏
  offsetPx?: [number, number];
  minZoom?: number; maxZoom?: number;   // 按相机缩放量淡入淡出
}
export class LabelProjector {
  readonly labels: Signal<ReadonlyArray<LabelSpec & { visible: boolean }>>;   // LabelLayer 据此渲染内容
  setCamera(cam: Camera, zoom: number): void;
  upsert(spec: LabelSpec): void;
  remove(id: string): void;
  clear(): void;
  bind(id: string, el: HTMLElement | null): void;     // LabelLayer 的 ref 回调
  flush(): void;                                       // 每帧一次：投影、去重叠、写 transform / opacity
}
```

- 内容（文字、图标）由 Preact 的 `<LabelLayer>` 按 `labels` 渲染，文字从 `strings` 表取；`LabelProjector` 只管位置与可见性，**每帧不触发 Preact 重渲染**——`flush` 直接改已绑定元素的 `style.transform = translate3d(x, y, 0)` 与 `style.opacity`。
- 去重叠：按 `priority` 降序贪心放置，与已放置的矩形（用元素的缓存宽高）相交则隐藏；隐藏 / 显示有 120ms 的淡变，且带 2px 的滞回避免边界闪烁。
- 相机背后或出屏的标注隐藏。上限 64 个，超出按优先级截断。

### 3.9 PortraitStage（`stage/PortraitStage.ts`）

照 UI_MAIN §3.4：面板里的纸偶立绘画在同一个 renderer 上，用 scissor 视口。

```ts
export class PortraitStage {
  /** DOM 占位元素注册进来；返回注销函数。同屏最多 2 个（主面板 + 抽屉）。 */
  mount(slot: HTMLElement, subject: PortraitSubject): () => void;
  update(dt: number): void;
  render(r: WebGLRenderer): void;
}
export interface PortraitSubject {
  bodyArtKey: string; overlayArtKeys: string[];   // 身体牌 + 挂件牌（武器、伤痕贴花…）
  pose?: string;                                   // 姿势牌名；切换时做一次翻牌
}
```

- 正交相机，一盏主光 + 半球光；纸偶是 1 张身体 `PaperCard` + 若干挂在锚点上的小牌，缓慢待机摆动（铰链角 ±1.5°，周期 3.2s）。
- 每帧读占位元素的 `getBoundingClientRect()`，换算到绘图缓冲区坐标（注意 `devicePixelRatio` 与 y 轴翻转），`setViewport / setScissor / setScissorTest(true)` 后 `clearDepth()` 再画，画完恢复。
- 占位元素不可见（`IntersectionObserver` 报告不相交、或被 `#modals` 的遮罩盖住）时跳过。
- 面板进出动画期间 rect 每帧在变，本来就是每帧读取，不需要额外处理；但面板用了 CSS `transform` 做滑入时，要确认读到的是变换后的矩形（`getBoundingClientRect` 是）。
- 本工单交付：`PortraitStage` 本体 + `<PortraitSlot>` 组件 + 画廊页里的一个演示面板。真正的人物面板在后续工单。

---

## 4. 第一个场景：主菜单

### 4.1 MenuScene（`scenes/MenuScene.ts`）

| 元素 | 实现 | artKey（内容包提供，缺则占位） |
| --- | --- | --- |
| 舞台地面 | 一块 `PlaneGeometry(40, 14)`，`createPaperMaterial({ doubleSided: false })`，`receiveShadow` | — （纯色卡纸） |
| 视差纸景 4–5 层 | 每层一张宽幅 `PaperCard`，z 从 −14 到 −2，高度递减；全部 `castShadow` | `menu.layer.0` … `menu.layer.4` |
| 标题牌 | 单独一张 `PaperCard`，位置在画面左侧 1/3，最后翻起 | `menu.title` |
| 氛围小牌 | 0–12 张小立牌（草、石之类），由内容包的 `menu.layout.json` 摆位 | `menu.prop.*` |
| 灯 | `createLightRig('menu')`；key 光沿 X 缓慢往返，所有影子跟着走 | — |
| 相机 | 透视 fov 30°，位置 `(0, 2.2, 13)`，看向 `(0, 1.8, 0)`；指针位置驱动 ±2° 的偏转与 ±0.25 的横移，临界阻尼（`omega = 4`） | — |

进入演出：各层按远 → 近依次 `rise(delay = i × 0.12)`，标题牌 `delay = 层数 × 0.12 + 0.15`；全部 `LOCKED` 后把 `ui` 里的 `menuReady` 置真，DOM 菜单列淡入。总时长 ≤ 1.6s；任意键或点击 → 所有牌直接置为立正。

`ParallaxRig`（`render/map/ParallaxRig.ts`，本工单先实现，WO2 复用）：每层登记一个视差系数 `k ∈ [0, 1]`，`update(camOffset)` 时 `layer.position.x = base.x + camOffset.x × k`。

新建流程：同一个 `MenuScene`，`setMode('newGame')` 让相机沿 X 平移 9 个单位到舞台另一侧（那一侧只有地面与一块留给 `PortraitStage` 的空台），1.0s，临界阻尼。`mainMenu ⇄ newGame` 两个 `Screen` 共用这一个场景实例，之间**不走** `SceneManager.goto` 的转场，只改 `ui.screen` 与相机模式（`SceneManager.retarget(to)`：同实例换屏的轻量路径）。

`prefers-reduced-motion`：不做翻起与视差，直接显示终态。

### 4.2 主菜单 DOM（`ui/screens/MainMenu.tsx`）

菜单项由一个配置数组生成，标签全部是 `strings` 的 key：

```ts
interface MenuItem { id: string; labelKey: string; visible?: () => boolean; onSelect: () => void }
const items: MenuItem[] = [
  { id: 'continue', labelKey: 'menu.continue', visible: hasAnySave, onSelect: continueLatest },
  { id: 'new',      labelKey: 'menu.new',      onSelect: () => sceneManager.retarget('newGame') },
  { id: 'load',     labelKey: 'menu.load',     onSelect: () => pushModal('saveLoad') },
  { id: 'settings', labelKey: 'menu.settings', onSelect: () => pushModal('settings') },
  { id: 'credits',  labelKey: 'menu.credits',  onSelect: () => pushModal('credits') },
];
```

- `<PaperButton>`：`.paper .paper-lift .paper-cut`；悬停 / 聚焦时把 `ui.hover` 置为 `{ type: 'menu', id }`，`MenuScene` 据此把对应位置的一盏小 `PointLight` 亮起（纯氛围；`low` 档不做）。
- 键盘：上下键移动焦点，`Enter` 触发；首次显示时焦点落在第一个可见项。
- 角落：版本号 + 内容包名（来自内容包 `manifest.json` 的 `name` / `version` 字段）、全屏、静音。
- 本工单需要的模态：`settings`（画质档位、动效开关、音量占位）、`saveLoad`（列表壳，读写接口留给存档工单）、`credits`（一个滚动文本区，内容从内容包的 `credits.md` 读——三方代码的许可声明放这里，含 papertrails 的 MIT 声明）。

### 4.3 新建向导框架（`ui/screens/NewGameWizard.tsx`）

三步，步骤条 + 上一步 / 下一步。本工单交付**框架与数据流**，各步的具体字段由内容包的 `newgame.schema.json` 驱动（字段 id、控件类型、取值范围、`labelKey`），界面不写死任何一项：

| 步 | 左侧 / 场景 | 右侧 DOM | 本工单交付到 |
| --- | --- | --- | --- |
| ① 人物 | `PortraitStage` 纸偶，随表单实时换 `overlayArtKeys` | 按 schema 生成的表单（文本、单选、滑条、点数分配四种控件） | 四种控件 + schema 解析 + 实时预览联动 |
| ② 出生地 | `WorldMapScene` 的 `pickOnly` 模式 | 选中项的说明卡 | 留挂载点；WO2 完成后接上，之前显示占位面板 |
| ③ 世界设定 | — | 按 schema 生成的下拉表单 | 同 ① |

完成后产出 `NewGameParams`（纯数据），`dispatch(StartNewGame(params))`，再 `goto(开局屏幕, …, { style: 'fold' })`。`core` 侧的 `StartNewGame` 不在本工单内，用一个打印参数的桩代替。

---

## 5. 开发画廊（`/dev/paper.html`）

Vite 多入口里加一页，不进正式构建。它是本工单的主要目视验收手段，也是后续调参的地方：

| 区 | 内容 | 看什么 |
| --- | --- | --- |
| 材质 | 一排卡片：纯色、贴图镂空、白边开 / 关、纤维强度滑条；一盏可拖动的灯 | 灯绕到纸后时纸面透亮；白边宽度；纤维不随物体移动而游走（世界空间） |
| 铰链 | 按钮：全部起立 / 全部倒下 / 波纹起立 / 半立；`omega`、`zeta` 滑条 | 过冲约 20%、锁定干脆；倒下不穿地 |
| 合批 | 600 张占位牌的 `PaperBatch`；显示 draw call、三角形数、`update` 耗时 | 1 个 draw call；全部锁定后 `update` ≈ 0ms |
| 阴影 | 档位切换；`lightSize` 滑条；一张离地 0–2 米可调的悬空牌 | PCSS：贴地处影子实、越高越虚；影子是剪影形不是矩形 |
| 转场 | 四个按钮，在两个不同底色的假场景之间切；一个「模拟慢加载 3s」开关 | `fold` 停在半程时不闪；`tear` 从点击处撕开 |
| 小舞台 | 一个可拖动、可滚动的假面板，内含 `<PortraitSlot>` | 拖动、滚动、缩放窗口时立绘始终对齐占位框 |

右上角常驻性能读数：FPS、帧时间中位数、draw call、三角形、`AssetCache.stats()`。

---

## 6. 测试

Vitest，全部不需要 WebGL（three 的数学、几何、`ShaderChunk` 字符串在 Node 里都可用）。

| 文件 | 用例 |
| --- | --- |
| `tests/render/hinge.test.ts` | `RISE` 参数下峰值过冲在 15%–25% 之间、1.0s 内静止；`FALL` 无过冲、`theta` 全程 ≥ 0；`dt` 取 1/30、1/60、1/144 时静止时刻相差 < 2 帧；`stepSpring` 在 `dt = 1s` 下不发散 |
| `tests/render/fibre.test.ts` | 同种子两次生成逐字节相同；三通道均值 `0.5 ± 0.02`；左右、上下边缘相邻像素差的均值不大于内部相邻像素差均值的 1.2 倍（可平铺） |
| `tests/render/shader-anchors.test.ts` | `buildLambertPars()` 不抛错；对一个假的 `shader` 对象（取 `ShaderLib.lambert` 的顶点 / 片元源码）跑 `onBeforeCompile` 不抛错，且结果里含 `paperFibre(`、`uPaperFlash`；PCSS 补丁对 `ShaderChunk.shadowmap_pars_fragment` 的每个锚点都命中。**这组测试在升级 three 时最先报警** |
| `tests/render/card-geometry.test.ts` | 锚点为 `[0.5, 0]` 时包围盒 `y ∈ [0, h]`、x 对称；`θ = π/2` 与 `θ = 0` 两个姿态下四个顶点的世界坐标符合 §2.3 的约定 |
| `tests/render/atlas.test.ts` | schema 拒绝 `feather < 2`、`padding < 4`、帧越界、重名；`resolve` 对未知 `artKey` 返回占位帧且只警告一次 |
| `tests/app/scene-manager.test.ts` | 用假 `IScene`（记录调用顺序）与假 `TransitionPass`：调用顺序为 `preload → exit(旧) → enter(新)`；转场中连发三次 `goto` 只执行最后一次；`preload` 超时后可重试、可取消且取消后旧场景未被 `exit`；`dive` 在缺 `getFocusRect` 时退化为 `fold`；`ui.screen` 只在结束时改一次 |
| `tests/app/input-router.test.ts`（jsdom） | 位移 5px / 300ms → 发 `click`；位移 8px → 只有 `drag`；`inputLocked` 时无事件且拖拽被补 `up`；滚轮三种 `deltaMode` 归一化结果一致 |
| `tests/ui/store.test.ts` | `closeTopmost` 的逐级顺序；`openPanel` 的替换 / 进抽屉规则；对 `selection` 写入相等值不触发订阅 |
| `tests/render/label-declutter.test.ts` | 两个重叠标注只显示高优先级的；滞回：在边界来回 1px 抖动不引起可见性翻转 |

目视项（在画廊页逐条确认，截图附在交付说明里）见 §8。

---

## 7. 性能预算

基准：集显笔记本，1920×1080，`high` 档。

| 项 | 预算 |
| --- | --- |
| 主菜单 | 60fps；draw call ≤ 30；首屏（到菜单可点）≤ 2.5s（占位资源下 ≤ 1s） |
| 转场 | 全程不掉到 50fps 以下；`rtA + rtB` 峰值显存 ≤ 70MB（1080p、4×MSAA） |
| `PaperBatch` 600 张 | 1 个 draw call（+1 个阴影通道）；波纹起立期间 `update` ≤ 0.6ms；静止后 ≤ 0.02ms |
| `LabelProjector` 64 个 | `flush` ≤ 0.3ms；不触发 Preact 重渲染 |
| `PortraitStage` | 每个 ≤ 0.4ms |
| JS 包体 | 本工单新增（不含 three）gzip ≤ 60KB |

---

## 8. 交付检查清单

**工具箱**

- [ ] `createPaperMaterial` 四种效果在画廊页逐项可见：纤维、包裹漫反射、背光透射、模切白边
- [ ] 纤维纹理固定在世界空间：物体移动时纹理不跟着滑
- [ ] `src/render/PaperMaterial.ts` 的 re-export 可用，WO4 的 `createPaperMaterial({ map })` 调用方式不需要改
- [ ] `PaperCard`：起立有约 20% 过冲后锁定；倒下无过冲、不穿地；平躺时不投影
- [ ] `PaperBatch`：600 张 1 个 draw call；波纹起立；全部锁定后 `update` 不再遍历
- [ ] 镂空立牌的影子是剪影形状（单张与合批都确认）
- [ ] 三档画质可切换；`high` 档影子近实远虚；`low` 档有 blob 阴影；自动降档只降不升
- [ ] three 版本已写死；着色器锚点测试通过
- [ ] 缺图时全部显示占位牌，控制台每个 key 只警告一次

**骨架**

- [ ] 页面只有一个 three.js 画布、一个 `WebGLRenderer`
- [ ] `SceneManager.goto` 的七步时序与 UI_MAIN §3.1 一致；转场期间输入被锁
- [ ] 四种转场样式在画廊页可演示；模拟慢加载时幕停在半程并显示进度，不闪、不黑屏
- [ ] 预加载超时出现重试；取消后回到旧场景且旧场景状态完好
- [ ] 转场中连续触发多次切换不出错，只落到最后一次
- [ ] `InputRouter`：点击与拖拽区分正确；拖拽划过面板不中断
- [ ] `Esc` 逐级关闭：模态 → 抽屉 → 面板 → 取消选择
- [ ] `LabelProjector`：标注跟随相机无抖动、重叠时按优先级隐藏、不引起 Preact 重渲染
- [ ] `PortraitStage`：面板拖动、滚动、窗口缩放时始终对齐占位框；占位不可见时不绘制
- [ ] WebGL 上下文丢失后能恢复到当前屏幕（用 `WEBGL_lose_context` 扩展手动触发验证）
- [ ] 窗口缩放、`devicePixelRatio` 变化（拖到另一块屏幕）后画面与标注都正确

**主菜单**

- [ ] 进入演出：各层由远及近翻起，标题牌最后；≤ 1.6s；任意键跳过
- [ ] key 光缓慢移动，影子随之移动
- [ ] 菜单可全键盘操作；按钮悬停有纸片抬起
- [ ] 主菜单 ⇄ 新建向导：相机横移，不经过全屏转场
- [ ] 新建向导：按 schema 生成表单，四种控件可用；人物步的表单变化实时反映到纸偶
- [ ] 主菜单 → 一个空的地点场景 → 返回：`fold` 往返正常，返回后菜单场景重新预加载并演出
- [ ] `prefers-reduced-motion` 下无翻起、无视差、转场为淡化
- [ ] 界面上没有任何写死的显示文字：全部来自 `strings`；`strings` 缺 key 时显示 `⟦key⟧` 便于发现

**工程**

- [ ] §6 的测试全部通过；`src/core/**` 未引入任何渲染依赖；`src/ui/**` 未直接导入 `three`
- [ ] §7 的预算逐项实测并把数字写进交付说明
- [ ] 交付说明里列出：PCSS 是否为 papertrails 移植版（及保留的版权声明位置）、与 WO4 的衔接是否按 §0.1 落地
