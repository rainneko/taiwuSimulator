# M1-WO4：战斗场景渲染与 HUD

> 工单版本 v2.0 · 2026-11-23
> **v2.0 变更：角色渲染从"纸片剪影关键姿态"改为"spine-webgl 3.8 播放原版骨骼数据"**
> 前置：WO1（核心引擎）、WO2（普攻与伤害）、WO3（摧破与AI）
> 预估：5-7 天
> 验收：浏览器中看到完整的战斗画面，两个 Spine 骨骼小黑人能打出完整一场，HUD 显示所有资源和伤害信息

---

## 0. 原版 Spine 数据概况

来源：Steam 分支 `taiwu`（纪念版，2018 旧 EA）

| 项目 | 值 |
|---|---|
| Spine 版本 | **3.8.60** |
| 骨骼数 | 140 |
| 插槽数 | 27 |
| 皮肤 | default、doll（男）、female（女） |
| 动画总数 | **679** |
| A_ 前缀（普攻） | 112 |
| C_ 前缀（架势） | 168 |
| S_ 前缀（招式） | 392 |
| H_ 前缀（受击） | 7 |
| 事件标记 | act0–act6（出手时机）、hit（命中时机） |

**文件清单：**
- `skeleton.json`（6.7MB）— 骨骼 + 全部动画
- `skeleton.atlas` — 图集描述（size 标注 4096²，region 坐标均在 4096 空间内）
- `skeleton.png`（2048×2048）— 图集贴图（分辨率为 4096 的一半，清晰度减半但不影响 UV）
- `animations.json` — 每个动画的时长、关键帧、事件和换装信息
- `parts_index.json` — 部件在图集上的位置

**关于 atlas size 与贴图分辨率不匹配：**
atlas 的 `size: 4096,4096` **不要修改**。spine-ts 3.8 的 TextureAtlas 用 `region.x / page.width` 计算 UV，page.width 取自 atlas 的 size 行，与实际 png 像素无关。所有 region 坐标（最大 xy 达 3975）都是 4096 空间的值。
- 保持 atlas 原样 + 加载 2048² png → UV 正确，只是清晰度减半
- 若把 size 改为 2048 → UV 超过 1，部件全部错位（**严禁**）
- 附件尺寸来自 skeleton.json，orig 也是 4096 空间的值，不需要额外缩放

---

## 1. 经典版战斗界面布局（调研结果）

经典版战斗是**侧视 Spine 骨骼动画剧场**：

```
┌─────────────────────────────────────────────────────────────────┐
│                        ⏸ 暂停圆盘(顶部居中)                      │
│                                                                 │
│  ┌────────┐   内伤条 ■■■■□□□□□    内伤条 □□□□□□□■■   ┌────────┐ │
│  │ 玩家头像│   外伤条 ■■□□□□□□□    外伤条 □□□□□□□□■   │ 敌方头像│ │
│  │ 内力属性│   守御(白) ████░░░    守御(白) ░░░████   │ 内力属性│ │
│  │ 奇窍功法│   【益】【损】          【益】【损】       │ 奇窍功法│ │
│  └────────┘                                          └────────┘ │
│                                                                 │
│          ┌─轮盘─┐                        ┌─轮盘─┐              │
│   专注🌀  │劈崩掷│                        │刺点弹│  🌀专注       │
│          │拿御撩│                        │缠御撩│              │
│          └─────┘                        └─────┘              │
│                                                                 │
│  ~~~~~ 远山 ~~~~~~~~ 中景建筑 ~~~~~~~~ 近景草石 ~~~~~  (视差背景) │
│ ───────────────────── 地平线 ─────────────────────────────────── │
│                                                                 │
│       🧍‍♂️ ←玩家Spine    ·····5.0·····    敌方Spine→ 🧍          │
│      ⭕移动圈         (距离刻度纸带)            ⭕移动圈         │
│      ● ● ●(移动力)                           ● ●(移动力)       │
│                                                                 │
│  ┌─────────────────── 功法栏 ───────────────────┐               │
│  │ [摧破1✨] [摧破2] [摧破3] │ [护体1] [护体2] │               │
│  └───────────────────────────────────────────────┘               │
│                                                                 │
│  ┌── 提气/架势双环 ──┐              ┌── 提气/架势双环 ──┐       │
│  │  ◎(内圈=提气)     │              │  ◎(内圈=提气)     │       │
│  │  ◉(外圈=架势)     │              │  ◉(外圈=架势)     │       │
│  └───────────────────┘              └───────────────────┘       │
│  ┌── 伤势人形图 ─┐                  ┌── 伤势人形图 ─┐          │
│  │ 7部位内/外伤   │                  │ 7部位内/外伤   │          │
│  │ 点穴(紫)+破绽(红)│                │ 点穴(紫)+破绽(红)│         │
│  └───────────────┘                  └───────────────┘          │
│                                                                 │
│  ┌── 队友头像 ──────────────┐                                   │
│  │ [队友1 zzz圈] [队友2 zzz圈]│                                │
│  └────────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘

键位：A/D ±0.1距离 | Q/E ±0.5距离 | 空格 暂停 | 数字键 施展功法
```

**关键视觉要素：**
- 伤口严重度：轻伤1条杠、重伤2条杠、致命伤3条杠
- 致命伤时屏幕震动
- 提气(内圈)/架势(外圈) 是两个同心环
- 专注表现为角色旁的"小风扇"，越高转越快
- 命中通道颜色：力道=红(1)、迅疾=绿(7)
- 移动力颜色：白(正常)、绿(身法)、红(效率低)
- 增益/减益标记：【益】绿、【损】红，在血条下方

---

## 2. 渲染架构（双画布 + DOM 三层）

### 2.1 层级结构

战斗场景使用三层叠放，从底到顶：

```
┌────────────────────────────────────────────┐
│  Layer 3: DOM HUD (Preact)                 │  ← position: fixed, pointer-events
│    - 血条、轮盘、功法栏、伤势图等           │
├────────────────────────────────────────────┤
│  Layer 2: spine-webgl canvas               │  ← 透明背景, 渲染两个小黑人
│    - 两个 Spine skeleton (doll/female)      │
│    - 武器 attachment 切换                   │
│    - 受击特效 (bling/kickass)              │
├────────────────────────────────────────────┤
│  Layer 1: three.js canvas                  │  ← 视差背景 + 地面 + 纸片特效
│    - ParallaxBackground (3层)              │
│    - groundPlane (PaperMaterial)           │
│    - distanceTape                          │
│    - 纸屑粒子 (FX)                         │
└────────────────────────────────────────────┘
```

### 2.2 为什么双画布

- spine-webgl 3.8 有自己的 WebGL 渲染管线（`SceneRenderer`、`SkeletonRenderer`），不能直接注入 three.js 的渲染循环
- 角色层需要透明背景（`premultipliedAlpha: true`），叠在 three.js 背景之上
- three.js 仍然用于背景的 PaperMaterial 纸质感、PCSS 阴影、纸屑粒子
- DOM HUD 在最上层，不受画布影响

### 2.3 画布同步

```ts
// src/render/combat/CombatRenderer.ts

export class CombatRenderer {
  private bgCanvas: HTMLCanvasElement;     // three.js 背景
  private spineCanvas: HTMLCanvasElement;  // spine-webgl 角色
  private bgRenderer: WebGLRenderer;
  private spineContext: ManagedWebGLRenderingContext; // spine-ts 提供

  constructor(container: HTMLElement) {
    // 两个 canvas 绝对定位叠放
    this.bgCanvas = createCanvas(container, { zIndex: 0 });
    this.spineCanvas = createCanvas(container, {
      zIndex: 1,
      alpha: true,
      premultipliedAlpha: true,
    });

    this.bgRenderer = new WebGLRenderer({ canvas: this.bgCanvas, antialias: true });
    this.spineContext = new ManagedWebGLRenderingContext(this.spineCanvas);
  }

  resize(w: number, h: number) {
    this.bgCanvas.width = this.spineCanvas.width = w;
    this.bgCanvas.height = this.spineCanvas.height = h;
    this.bgRenderer.setSize(w, h, false);
  }

  renderFrame(state: CombatState, dt: number) {
    // 1. three.js 渲染背景层
    this.updateBackground(state);
    this.bgRenderer.render(this.bgScene, this.bgCamera);

    // 2. spine-webgl 渲染角色层
    this.updateSpineSkeletons(state, dt);
    this.renderSpine();

    // 3. DOM HUD 由 Preact 信号自动更新
  }
}
```

---

## 3. Spine 角色渲染（`src/render/combat/SpineActors.ts`）

### 3.1 加载 spine-ts 3.8

```ts
// 使用 spine-ts 3.8 分支的 spine-webgl 模块
// npm: 没有官方 3.8 npm 包，直接从 spine-runtimes 仓库 3.8 分支复制 spine-ts/spine-webgl/src/
// 或者用 ES module 包装

import {
  AssetManager,
  AtlasAttachmentLoader,
  SkeletonJson,
  SkeletonRenderer,
  AnimationState,
  AnimationStateData,
  Skeleton,
  ManagedWebGLRenderingContext,
  SceneRenderer,
  TextureAtlas,
} from './spine-webgl-3.8';
```

### 3.2 加载原版数据

```ts
export async function loadSpineData(
  context: ManagedWebGLRenderingContext
): Promise<SpineAssets> {
  const assetManager = new AssetManager(context, 'assets/spine/');

  // 加载 atlas（保持原样，不要修改 size 行）
  assetManager.loadTextureAtlas('skeleton.atlas');
  // 加载骨骼 JSON
  assetManager.loadText('skeleton.json');

  await assetManagerReady(assetManager);

  const atlas = assetManager.get('skeleton.atlas') as TextureAtlas;
  const atlasLoader = new AtlasAttachmentLoader(atlas);
  const skeletonJson = new SkeletonJson(atlasLoader);

  // 缩放：原版数据的坐标单位，需要根据画布大小调整
  skeletonJson.scale = 0.5; // 根据实际测试调整

  const skeletonData = skeletonJson.readSkeletonData(
    assetManager.get('skeleton.json')
  );

  return { skeletonData, atlas };
}
```

### 3.3 创建两个角色

```ts
export class SpineActor {
  skeleton: Skeleton;
  animationState: AnimationState;
  private stateData: AnimationStateData;

  constructor(skeletonData: SkeletonData, skin: 'doll' | 'female') {
    this.skeleton = new Skeleton(skeletonData);
    this.skeleton.setSkinByName(skin);
    this.skeleton.setSlotsToSetupPose();

    this.stateData = new AnimationStateData(skeletonData);
    this.stateData.defaultMix = 0.15; // 动画混合时长（秒），需从反编译代码校准

    this.animationState = new AnimationState(this.stateData);
  }

  /** 设置位置和朝向 */
  setPosition(x: number, y: number, flipX: boolean) {
    this.skeleton.x = x;
    this.skeleton.y = y;
    this.skeleton.scaleX = flipX ? -1 : 1;
  }

  /** 播放动画 */
  playAnimation(name: string, loop: boolean = false, track: number = 0) {
    this.animationState.setAnimation(track, name, loop);
  }

  /** 在当前动画后排队 */
  queueAnimation(name: string, loop: boolean, delay: number = 0, track: number = 0) {
    this.animationState.addAnimation(track, name, loop, delay);
  }

  /** 设置武器 attachment */
  setWeapon(weaponSlotName: string, attachmentName: string | null) {
    const slot = this.skeleton.findSlot(weaponSlotName);
    if (!slot) return;
    if (attachmentName === null) {
      slot.attachment = null;
    } else {
      slot.attachment = this.skeleton.getAttachmentByName(weaponSlotName, attachmentName);
    }
  }

  update(dt: number) {
    this.animationState.update(dt);
    this.animationState.apply(this.skeleton);
    this.skeleton.updateWorldTransform();
  }
}
```

### 3.4 渲染

```ts
export class SpineRenderer {
  private sceneRenderer: SceneRenderer;
  private player: SpineActor;
  private enemy: SpineActor;

  constructor(context: ManagedWebGLRenderingContext, skeletonData: SkeletonData) {
    this.sceneRenderer = new SceneRenderer(context.canvas, context);

    // 玩家在左（不翻转），敌方在右（水平镜像）
    this.player = new SpineActor(skeletonData, 'doll');
    this.enemy = new SpineActor(skeletonData, 'doll');
  }

  render(state: CombatState, dt: number) {
    const gl = this.sceneRenderer.context.gl;
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 更新位置（逻辑距离 → 画布像素坐标）
    const canvasW = gl.canvas.width;
    const canvasH = gl.canvas.height;
    const groundY = canvasH * 0.65; // 地平线在画布 65% 高度处

    const [f1, f2] = state.fighters;
    const midX = (f1.position + f2.position) / 2;
    const spread = Math.abs(f1.position - f2.position);

    // 距离映射：逻辑 2.0-9.0 → 像素展幅
    const pixelSpread = mapRange(spread, 2, 9, canvasW * 0.2, canvasW * 0.6);
    const centerX = canvasW / 2;

    this.player.setPosition(centerX - pixelSpread / 2, groundY, false);
    this.enemy.setPosition(centerX + pixelSpread / 2, groundY, true);

    // 更新动画
    this.player.update(dt);
    this.enemy.update(dt);

    // 渲染
    this.sceneRenderer.begin();
    this.sceneRenderer.drawSkeleton(this.player.skeleton, true);
    this.sceneRenderer.drawSkeleton(this.enemy.skeleton, true);
    this.sceneRenderer.end();
  }
}
```

---

## 4. 动画控制器（`src/render/combat/AnimationController.ts`）

### 4.1 CombatEvent → Spine 动画映射

```ts
// 消费核心引擎产出的 CombatEvent[]，驱动 Spine 动画

interface AnimMapping {
  // 普通攻击：用 A_ 前缀动画
  normalAttack: (stanceType: number, weaponType: string) => string;
  // 摧破功法：用 S_ 前缀动画
  technique: (techniqueId: number, stage: number) => string;
  // 架势切换：用 C_ 前缀动画
  stanceChange: (stanceType: number) => string;
  // 受击：用 H_ 前缀动画
  hit: (severity: number) => string;
  // 待机：idle
  idle: () => string;
}

export class AnimationController {
  private actor: SpineActor;
  private currentAnim: string = '';

  constructor(actor: SpineActor) {
    this.actor = actor;
    // 注册 Spine 事件监听
    actor.animationState.addListener({
      event: (entry, event) => {
        // act0-act6: 出手时机 → 触发攻击判定
        // hit: 命中时机 → 触发受击反馈
        this.onSpineEvent(event.data.name, event);
      },
      complete: (entry) => {
        // 动画播完 → 回到 idle
        if (!entry.loop) {
          this.actor.playAnimation('idle', true);
        }
      },
    });
  }

  /** 处理战斗事件 */
  handleEvent(event: CombatEvent) {
    switch (event.type) {
      case 'normalAttack':
        // 根据当前式（劈/崩/掷/...）和武器类型选择 A_ 动画
        const animName = this.resolveNormalAttackAnim(event);
        this.actor.playAnimation(animName, false);
        break;

      case 'techniqueStart':
        // 功法施展 → S_ 动画
        const techAnim = `S_${event.techniqueAnimId}`;
        this.actor.playAnimation(techAnim, false);
        break;

      case 'hit':
        // 受击 → H_ 动画 + 受击特效
        const hitAnim = this.resolveHitAnim(event.severity);
        this.actor.playAnimation(hitAnim, false);
        break;

      case 'dodge':
        // 化解没有专用动画前缀，用 idle 变体或不切换
        break;

      case 'move':
        // 移动 → 可能有移动动画（需确认数据中是否有 walk/run 动画）
        break;

      case 'stanceChange':
        // 式切换 → C_ 动画
        const stanceAnim = `C_${event.stanceAnimId}`;
        this.actor.playAnimation(stanceAnim, false);
        break;
    }
  }

  private resolveNormalAttackAnim(event: NormalAttackEvent): string {
    // A_001 ~ A_112，根据式类型和武器选择
    // 具体映射表需从 animations.json 和功法表交叉比对
    // M1 先用简单映射：式类型号 → A_{式类型号 * 7 + 变体}
    return `A_${String(event.stanceType * 7 + 1).padStart(3, '0')}`;
  }

  private resolveHitAnim(severity: number): string {
    // H_ 只有 7 个，按严重度选择
    // 需要从 animations.json 确认具体编号
    const hitAnims = ['H_001', 'H_002', 'H_003', 'H_004', 'H_005', 'H_006', 'H_007'];
    return hitAnims[Math.min(severity, hitAnims.length - 1)];
  }

  private onSpineEvent(name: string, event: any) {
    if (name.startsWith('act')) {
      // 出手事件 → 通知核心引擎进行命中判定
      this.onAttackTiming?.(parseInt(name.slice(3)));
    } else if (name === 'hit') {
      // 命中事件 → 触发受击方的受击反馈
      this.onHitTiming?.();
    }
  }

  onAttackTiming?: (stage: number) => void;
  onHitTiming?: () => void;
}
```

### 4.2 打击感时间表

原版 Spine 动画自带时序（通过 act/hit 事件标记），所以不再需要手动定义帧数表。
关键补充效果仍需实现：

| 效果 | 实现方式 |
|---|---|
| 顿帧 hitstop | hit 事件触发时暂停两个 skeleton 的 `animationState.timeScale = 0`，N 帧后恢复 |
| 屏幕震动 | 偏移两个 canvas 的 CSS transform |
| 慢放 | 摧破终结时 `timeScale = 0.25`，持续 12 帧后恢复 |
| 受击白闪 | 通过 spine-webgl 的 `skeleton.color` 设为白色 2 帧后恢复 |

```ts
// 顿帧实现
function applyHitstop(player: SpineActor, enemy: SpineActor, frames: number) {
  player.animationState.timeScale = 0;
  enemy.animationState.timeScale = 0;
  setTimeout(() => {
    player.animationState.timeScale = 1;
    enemy.animationState.timeScale = 1;
  }, frames * (1000 / 60));
}

// 受击白闪
function applyFlash(actor: SpineActor, frames: number) {
  const orig = { r: actor.skeleton.color.r, g: actor.skeleton.color.g, b: actor.skeleton.color.b };
  actor.skeleton.color.set(1, 1, 1, 1);
  setTimeout(() => {
    actor.skeleton.color.set(orig.r, orig.g, orig.b, 1);
  }, frames * (1000 / 60));
}
```

---

## 5. 视差背景（three.js 层，保留纸质感）

```ts
// src/render/combat/ParallaxBg.ts
// 3层纸片背景，各层以不同速度跟随相机

const LAYERS = [
  { name: 'far',   z: -20, parallax: 0.1, height: 8 },   // 远山
  { name: 'mid',   z: -10, parallax: 0.3, height: 5 },   // 中景建筑
  { name: 'near',  z: -2,  parallax: 0.7, height: 3 },   // 近景草石
];

export class ParallaxBackground {
  layers: Mesh[];

  constructor(scene: Scene, textures: Record<string, Texture>) {
    this.layers = LAYERS.map(cfg => {
      const geo = new PlaneGeometry(30, cfg.height);
      const mat = createPaperMaterial({ map: textures[cfg.name] });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(0, cfg.height / 2, cfg.z);
      mesh.receiveShadow = true;
      scene.add(mesh);
      return mesh;
    });
  }

  update(cameraX: number) {
    LAYERS.forEach((cfg, i) => {
      this.layers[i].position.x = cameraX * cfg.parallax;
    });
  }
}
```

---

## 6. 纸片材质（用于背景和地面，不用于角色）

从 papertrails 的 materials.js 提取核心技术。**仅用于背景层和地面**，角色由 spine-webgl 渲染。

```ts
// src/render/PaperMaterial.ts
// 完整实现见 v1.0 工单 §3，此处不重复
// 关键 uniforms: uPaperFibreTex, uPaperFibre, uPaperLight, uPaperTransTint
// 效果：纤维纹理(triplanar UV)、wrap diffuse、背光透射
```

纤维纹理生成器同 v1.0 工单 §3.2，程序生成 512×512 RGBA 纹理。

---

## 7. 光照与阴影（three.js 层）

```ts
// src/render/combat/Lighting.ts
// 仅作用于 three.js 背景层

export function setupCombatLighting(scene: Scene, renderer: WebGLRenderer) {
  const keyLight = new DirectionalLight(0xffd29c, 2.5);
  keyLight.position.set(-5, 8, 3);
  keyLight.castShadow = true;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = BasicShadowMap;
  keyLight.shadow.mapSize.set(2048, 2048);

  patchPCSS(renderer); // papertrails PCSS 补丁

  const fillLight = new DirectionalLight(0x8899bb, 0.6);
  fillLight.position.set(3, 4, -2);

  const hemiLight = new HemisphereLight(0x9bb5d4, 0x8b7355, 0.5);

  scene.add(keyLight, fillLight, hemiLight);
}
```

---

## 8. HUD（DOM 覆盖层，Preact + signals）

### 8.1 组件树

```
CombatHUD (position: fixed, 覆盖整个 canvas)
├─ PauseButton              # 顶部居中暂停圆盘
├─ FighterPanel × 2         # 左右各一
│  ├─ Portrait              # 头像 + 内力属性 + 奇窍功法
│  ├─ HealthBars            # 内伤条 + 外伤条 + 守御(白色叠加)
│  ├─ BuffDebuffBadges      # 【益】【损】标记
│  ├─ StanceWheel           # 轮盘(6格圆环)
│  ├─ BreathStanceRings     # 提气(内圈)/架势(外圈)同心环
│  ├─ FocusIndicator        # 专注风扇图标
│  └─ BodyMap               # 伤势人形图(7部位 + 点穴/破绽标记)
├─ DistanceDisplay          # 距离数字(底部居中)
├─ MoveProgressCircle × 2   # 移动进度圈(跟随角色脚下)
├─ MovementPips × 2         # 移动力彩色点(跟随角色)
├─ SkillPanel               # 功法栏(底部)
│  ├─ TechniqueSlot[]       # 摧破槽(红色高亮=可施展)
│  └─ GuardSkillSlot[]      # 护体槽(黄色高亮=可施展)
├─ CastProgressBar          # 施展进度条(头顶纸带)
├─ DamageNumbers            # 浮动伤害数字
└─ TeammatePortraits        # 队友头像 + zzz充能圈(M2)
```

### 8.2 关键组件实现要点

**HealthBars（血条）**：
- 内伤：红色条，从左往右填充
- 外伤：蓝色条，从左往右填充
- 守御：白色半透明条，叠在血条上方
- 战败阈值标线：竖线标记在 50%/75%/100%
- 伤口严重度：轻伤1条杠、重伤2条杠、致命伤3条杠

**BreathStanceRings（提气架势双环）**：
- SVG 实现：两个同心圆弧
- 内圈 = 提气(0-30000)，外圈 = 架势(0-30000)
- 顺时针填充，满了发光
- 两者同时满时脉冲高亮提示可施展

**StanceWheel（式轮盘）**：
- 6 格圆环，当前指针位置高亮
- 已获得的式在式槽中亮起
- 武器不支持的式灰显
- 式槽容量 9

**BodyMap（伤势人形图）**：
- 7 个可单独着色的部位
- 每个部位显示内伤(红)/外伤(蓝)程度
- 点穴(紫色圆点) 和 破绽(红色裂纹) 层数
- Hover 显示具体百分比和新伤比例

### 8.3 角色坐标 → 屏幕坐标

移动进度圈和移动力点需要跟随 Spine 角色位置：

```ts
function spineToScreen(
  spineX: number, spineY: number,
  canvas: HTMLCanvasElement
): { x: number; y: number } {
  // Spine 坐标直接是画布像素坐标（spine-webgl 的 SceneRenderer 使用正交投影）
  // 只需考虑 CSS 缩放
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  return {
    x: spineX * scaleX,
    y: (canvas.height - spineY) * scaleY, // Spine Y 轴向上，DOM Y 轴向下
  };
}
```

---

## 9. 特效系统（三种来源）

### 9.1 Spine 内置特效

- 原版数据中 `parts/effects/bling/0-4` 和 `parts/effects/kickass/0-5` 是 Spine attachment
- 通过切换 slot visibility 控制显隐
- 由动画事件自动触发

### 9.2 three.js 层纸屑粒子

纸屑飘散仍在 three.js 层实现（增加纸质感）：

```ts
class PaperDebrisSystem {
  // 受击时在 three.js 层生成 6-12 片小纸片
  // 随机旋转飘落，受重力影响
  // 材质用 PaperMaterial 变体
}
```

### 9.3 CSS 层特效

- 屏幕震动：两个 canvas + HUD 容器统一 CSS transform
- 闪光/暗角：CSS overlay div + opacity 动画
- 慢放提示：CSS 文字特效

---

## 10. 屏幕震动（统一控制两层 canvas）

```ts
// src/render/combat/ScreenShake.ts
export class ScreenShake {
  private container: HTMLElement; // 包含两个 canvas 和 HUD 的容器

  add(dx: number, dy: number, frames: number) {
    // 对容器统一应用 CSS transform
    // 这样两个 canvas 和 HUD 一起震动
    this.queue.push({ dx, dy, frames, frame: 0 });
  }

  update() {
    let ox = 0, oy = 0;
    this.queue = this.queue.filter(s => {
      const decay = 1 - s.frame / s.frames;
      ox += s.dx * decay * Math.sin(s.frame * 1.5);
      oy += s.dy * decay * Math.cos(s.frame * 1.7);
      s.frame++;
      return s.frame < s.frames;
    });
    this.container.style.transform = `translate(${ox}px, ${oy}px)`;
  }
}
```

---

## 11. 战斗回放

```ts
// 同 v1.0 不变
// 战斗结束后导出 (seed, commandLog)
// 重新 initCombat(seed) + 逐帧 step(state, commandLog[frame])
// 完全确定性 → 100% 复现
```

---

## 12. M1 资源需求

| 资源 | 来源 | 说明 |
|---|---|---|
| skeleton.json | Steam 拆包 | 6.7MB，原版骨骼+679动画 |
| skeleton.atlas | Steam 拆包 | 需修复 size 4096→2048 |
| skeleton.png | Steam 拆包 | 2048² 图集贴图 |
| spine-ts 3.8 源码 | github.com/EsotericSoftware/spine-runtimes 3.8 分支 | spine-webgl 模块 |
| 视差背景 | 自制或临时素材 | 远山/中景/近景，各 2048×512 |
| 地面纹理 | 程序生成 | 纤维纹理生成器变体 |
| 纸屑粒子 | 程序生成 | 小色块即可 |

**M1 允许视差背景使用临时素材（纯色渐变或简单水墨图）**。正式美术在 M2 替换。

**重要：Spine 数据文件不入 git，放在 `assets/spine/` 目录，通过 `.gitignore` 排除。**

---

## 13. 交付检查清单

- [ ] 浏览器打开后看到战斗场景：视差背景 + 地面 + 两个 Spine 小黑人
- [ ] Spine 骨骼正确加载：能看到男性(doll)和女性(female)皮肤
- [ ] 武器 attachment 正确切换（至少演示剑/刀/拳三种）
- [ ] idle 动画循环播放
- [ ] 角色能自动普攻，看到 A_ 攻击动画播放
- [ ] hit 事件触发时有顿帧(hitstop) + 屏幕震动
- [ ] 受击方播放 H_ 受击动画 + 白闪
- [ ] A/D/Q/E 能调整距离，角色间距跟随变化
- [ ] 空格暂停/继续
- [ ] HUD 正确显示：血条、守御、提气架势双环、式轮盘、距离数字
- [ ] 功法栏亮灭正确（双满+有式 = 可施展高亮）
- [ ] 伤势人形图正确着色
- [ ] 战斗结束有胜负提示
- [ ] 视差背景有 PaperMaterial 纸纹效果
- [ ] 两个 canvas 层叠正确，无撕裂或错位
- [ ] atlas 保持原样加载（不修改 size 行），画面无错位
- [ ] 回放功能：导出 + 重放结果一致
