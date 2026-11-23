# 规划书（PLAN）

> 版本 v0.1 · 2026-11-23 · 执行会话撰写
> 机制依据：本地 `data/wiki/text/旧__*.md`、`raw/wikitext/`、`data_ns/`（经典版 wiki 文本与数据）。wiki 原始文件不入库（.gitignore 已排除），提取后的名称、数值、文案进入内容包。
> 文中「来源：旧/xxx」均指该目录下对应页面。标注 **[待核实]** 的是 wiki 未写明、由本书推定的部分。

---

## 1. 项目概述

**目标。** 做一个运行在浏览器里的、免费的、仅供学习交流的武侠养成模拟：玩家经营一座村镇，培养人物、编排功法，在大地图各地区游历，与 NPC 结交或结怨，进入奇遇副本，并用一套「距离 + 攻击进度 + 式 + 提气架势」的半即时战斗解决冲突。

**定位。** 机制层（系统结构、公式、数值关系）以经典版为蓝本逐条对照 wiki 还原，战斗、功法、城镇三块优先；删繁就简，世界演化、剧情主线、促织等支线暂不做。内容层（名称、文案、人物、美术）全部走可替换的「内容包」架构，默认内容包直接使用经典版的原名称与文案作为开发内容；待取得原作方授权后决定是否保留或替换。

**技术栈与理由。**
- **three.js + Vite + TypeScript**：目标平台是 WebGL；papertrails（MIT）已证明「立起来的纸」风格在 three.js 上可行且代码可借鉴。Godot 的 HD-2D 模板无许可证，只取思路不取代码。
- **逻辑与渲染彻底分离**：战斗核心是纯 TS、确定性、可在 Node 里无头运行，便于对照 wiki 写单测和做 AI 对打调数值。
- **内容数据 JSON + zod 校验**：保证内容包可替换。
- **UI 用 DOM 覆盖层（Preact + signals）**：面板多、文字多，DOM 比在 WebGL 里画字省事。

---

## 2. 系统架构

### 2.1 三层分离

```
┌──────────────────────────── ui/（DOM 覆盖层：HUD、面板、对话）────────────────────────────┐
│                           只读 store 快照，只发 Command                                    │
├──────────────────────── render/（three.js：四类场景 + 纸片工具箱）───────────────────────┤
│                   只读逻辑状态 + 消费事件流（CombatEvent / WorldEvent）                   │
├──────────────── core/（纯逻辑：战斗、人物、功法、世界、城镇、奇遇、物品）────────────────┤
│        确定性；不 import three / DOM；输入 = Command，输出 = 新状态 + 事件               │
├──────────────────── data/（内容包加载、schema 校验、只读 ContentDB）─────────────────────┤
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

硬规则：

1. `core/` 不得依赖 `render/`、`ui/`、three.js、`window`。ESLint `no-restricted-imports` 强制。
2. 一切随机数走 `core/rng.ts`（可播种的 PCG32），存档里保存种子与游标，战斗可回放。
3. 逻辑以**帧**为单位（60 帧/秒），与渲染帧率解耦：`Clock` 用累加器做固定步长，渲染只做插值。
4. 逻辑→表现单向：`core` 产出事件，`render`/`ui` 订阅。表现层想影响逻辑只能发 `Command`。
5. 静态内容（功法表、物品表…）只读，运行期状态只存 id 引用，存档不含静态内容。

### 2.2 目录结构

```
taiwuSimulator/
├─ docs/PLAN.md
├─ data/wiki/                 # 本地机制参考（.gitignore 已排除正文）
├─ content/
│  ├─ _schema/                # 由 zod 导出的 JSON Schema，供外部工具/工单校验
│  └─ base/                   # 默认内容包（经典版占位）
│     ├─ manifest.json        # 包名、版本、依赖、字符串语言
│     ├─ martial-arts.json  sects.json  items.json  weapons.json
│     ├─ buildings.json  regions.json  tiles.json  npc-templates.json
│     ├─ adventures/*.json    # 奇遇/副本节点图
│     ├─ strings.zh.json      # 全部显示文本（名称、描述、对话）
│     └─ art/                 # 图集 + 图集描述
├─ tools/
│  └─ pipeline/               # M2：wiki 文本 → 机制表 → 校验 → 内容包骨架
├─ tests/                     # vitest：公式黄金用例、确定性、回放
└─ src/
   ├─ main.ts
   ├─ app/        Game.ts  SceneManager.ts  Clock.ts  SaveStore.ts  EventBus.ts  Commands.ts
   ├─ core/
   │  ├─ rng.ts  math.ts（floor01、clamp、百分比叠加工具）
   │  ├─ combat/
   │  │  ├─ CombatSim.ts        # 帧循环入口 step(state, commands) → events
   │  │  ├─ state.ts  actions.ts  events.ts
   │  │  ├─ timers.ts           # 攻击进度/移动进度/提气架势/施展/换兵器/逃跑
   │  │  ├─ distance.ts  movement.ts
   │  │  ├─ stance.ts           # 式：轮盘、获取、消耗
   │  │  ├─ hit.ts              # 命中/化解三通道、变招、追击、连环
   │  │  ├─ damage.ts           # 伤害结算流程全链路
   │  │  ├─ guard.ts            # 守御、护体绝技、反击、反震
   │  │  ├─ wounds.ts           # 伤口、点穴/破绽、战败条件
   │  │  ├─ focus.ts  memory.ts # 专注、战斗记忆
   │  │  ├─ effects/            # 功法特效解释器（见 §3.3、§5.12）
   │  │  ├─ team.ts             # 队友援手
   │  │  └─ ai/                 # 评估器 + 决策（§5.13）
   │  ├─ character/  attributes.ts  derive.ts  aptitude.ts  health.ts  relations.ts  aging.ts
   │  ├─ martial/    learn.ts  breakthrough.ts  loadout.ts  neili.ts  qi.ts
   │  ├─ world/      time.ts  region.ts  travel.ts  npcSim.ts
   │  ├─ town/       buildings.ts  production.ts  workers.ts
   │  ├─ adventure/  graph.ts  runner.ts
   │  └─ items/      inventory.ts  equipment.ts  durability.ts
   ├─ data/       schema/*.ts（zod）  ContentDB.ts  loader.ts  ids.ts  strings.ts
   ├─ render/
   │  ├─ paper/   PaperMaterial.ts  PaperCard.ts  PaperBatch.ts  hinge.ts  atlas.ts  shadows.ts
   │  ├─ scenes/  WorldMapScene.ts  RegionScene.ts  TownScene.ts  CombatScene.ts  AdventureScene.ts
   │  ├─ combat/  FighterView.ts  PoseTimeline.ts  Hitstop.ts  Fx.ts  CameraRig.ts
   │  └─ post/    dof.ts  vignette.ts
   ├─ ui/         store.ts  hud/  panels/  widgets/
   └─ dev/        FormulaInspector.ts  ReplayPlayer.ts  CombatSandbox.ts
```

### 2.3 核心模块列表

| 模块 | 职责 | 依赖 | 里程碑 |
| --- | --- | --- | --- |
| `app/Clock` | 固定步长 60Hz、暂停、倍速、hitstop 冻结 | — | M1 |
| `core/rng` | 可播种随机数、PRD 伪随机（变招用） | — | M1 |
| `core/combat/CombatSim` | 战斗帧循环、状态机 | data | M1 |
| `core/combat/damage` | 伤害结算全链路（§5.9） | — | M1 |
| `core/combat/effects` | 功法特效 DSL 解释器 | combat | M1 起步，M2 扩充 |
| `core/combat/ai` | 敌方与队友决策 | combat | M1 |
| `data/ContentDB` | 内容包加载、zod 校验、id 索引 | — | M1 最小版，M2 完整 |
| `tools/pipeline` | wiki 文本→机制表→内容包骨架 | — | M2 |
| `core/character`、`core/martial` | 属性派生、资质、修习/突破、运功栏、内力真气 | data | M2 |
| `core/items` | 背包、装备、耐久 | data | M2 |
| `core/world/time` | 月/季/年推进、行动力 | — | M3 |
| `core/town` | 建筑网格、产出、派工 | data | M3 |
| `render/paper/*` | 纸材质、卡片、批处理、铰链弹簧、阴影 | three | M1（材质+卡片），M3（批处理+铰链） |
| `render/scenes/*` | 四类场景 | paper | M1 战斗，M3 其余 |
| `core/world/npcSim`、`core/character/relations` | NPC 月度行为、关系网 | world | M4 |
| `core/adventure` | 奇遇节点图运行器 | combat | M4 |
| `app/SaveStore` | IndexedDB 存档、版本迁移 | — | M2 |
| `dev/*` | 公式检查器、回放、战斗沙盒 | all | M1 |

---

## 3. 数据模型设计

### 3.0 约定

- **静态定义**（`XxxDef`，来自内容包，只读）与**运行期状态**（`XxxState`，进存档）分开；状态只存 `id` 引用定义。
- **id**：`ma_0421`、`item_1203` 这类中性编号，一经发布不复用。**所有显示文本不在定义里**，用 `nameKey` / `descKey` 去 `strings.zh.json` 查。
- **数值类型**：百分比一律用「千分比整数」`Permille`（1 = 0.1%），进度条用整数，避免浮点误差；注释里写的是人读的百分数。
- **来源标注**：`// 来源：旧/xxx` 指 `data/wiki/text/旧__xxx.md`（部分页面的 Markdown 转换丢了章节，以 `raw/wikitext/` 为准）。
- 下文接口里出现但未展开的辅助类型（`Condition`、`Outcome`、`CheckFormula`、`EffectTrigger`、`EffectOp`、`ActiveEffect`、`MateState`、`BuildJob`、`YieldRule`、`NpcIntent`、`DifficultySettings` 等）形状简单，实现时在对应 `schema/*.ts` 里补全。
- **可叠加属性**统一用 `StatStack`，公式检查器能逐项展开：

```ts
type Id<T extends string> = string & { __brand: T };
type Permille = number;          // 1 = 0.1%
type Frames = number;            // 逻辑帧，60/秒

interface StatMod {
  sourceId: string;              // 来自哪个特性/装备/功法/效果
  flat?: number;                 // 加在基础值上
  pctAdd?: Permille;             // 同层相加的百分比
  mult?: Permille;               // 独立连乘
  flatAfter?: number;            // 连乘之后再加（如护体绝技固定值）
  expireFrame?: Frames;          // 战斗内临时效果
}
type StatStack = StatMod[];      // 求值：(Σflat) × (1+Σpct) × Πmult + ΣflatAfter
```

### 3.1 Character（人物）

```ts
/** 六项主要属性。来源：旧/主要属性 */
type MainAttr = 'strength' | 'constitution' | 'agility' | 'bone' | 'insight' | 'composure';
//               膂力         体质             灵敏        根骨     悟性        定力

/** 七元赋性，0–100。来源：旧/七元赋性 */
type Septet = 'delicate' | 'clever' | 'fluid' | 'brave' | 'resolute' | 'calm' | 'fortune';
//             细腻         聪颖       水性      勇壮      坚毅         冷静     福缘

/** 功法资质 14 类 / 技艺资质 16 类。来源：旧/主要属性、模块 Const/name */
type CombatSkillType =
  | 'neigong' | 'movement' | 'special'             // 内功 身法 绝技
  | 'fist' | 'finger' | 'leg' | 'hidden'           // 拳掌 指法 腿法 暗器
  | 'sword' | 'blade' | 'polearm' | 'exotic'       // 剑法 刀法 长兵 奇门
  | 'whip' | 'ranged' | 'music';                   // 软兵 御射 乐器
type LifeSkillType =
  | 'music' | 'chess' | 'poetry' | 'painting' | 'math' | 'appraisal'
  | 'forging' | 'woodwork' | 'medicine' | 'toxicology' | 'weaving' | 'jewelry'
  | 'taoism' | 'buddhism' | 'cooking' | 'eclectic';

/** 内力属性 6 种。来源：旧/内力属性 */
type NeiliType = 'mixed' | 'vajra' | 'violet' | 'yin' | 'yang' | 'returning';

/** 十个受伤部位。前 7 个可被护具保护、可变招、可点穴破绽。来源：旧/人体部位、旧/内外伤 */
type BodyPart = 'chest' | 'belly' | 'head' | 'armL' | 'armR' | 'legL' | 'legR'
              | 'mind' | 'toxin' | 'whole';

type GrowthType = 'balanced' | 'early' | 'late';   // 资质成长型：均衡/早熟/晚成。来源：旧/年龄

interface CharacterState {
  id: Id<'char'>;
  nameParts: { surnameKey: string; givenKey: string };   // 姓名库条目，见 §7.6
  gender: 'm' | 'f';
  appearanceSeed: number;                 // 程序化相貌/剪影配色的种子
  birthMonth: number;                     // 1–12；逢出生月年龄 +1。来源：旧/时节更替
  age: number;
  health: number; healthMax: number;      // 逢生日各 −1；为 0 则过月死亡。来源：旧/健康

  mainAttr: Record<MainAttr, number>;     // 基础值（不含装备/特性）
  septet: Record<Septet, number>;         // 0–100
  charm: number;                          // 0–900，9 档；40/60/80 岁起衰减。来源：旧/魅力、旧/年龄
  combatAptitude: Record<CombatSkillType, number>;  // 功法资质
  lifeAptitude: Record<LifeSkillType, number>;      // 技艺资质
  growth: GrowthType;                     // ≤14 岁资质 ×(年龄/14)
  traits: Id<'trait'>[];                  // 3–7 个普通特性，同系列互斥。来源：旧/人物特性

  stance: number;                         // 处世立场 0–1000：刚正0–124 仁善–374 中庸–624 叛逆–874 唯我–1000。来源：旧/处世立场
  fame: FameEntry[];                      // 名誉 = 各条目之和，−100~100。来源：旧/名誉
  mood: number;                           // 心情 0–100，7 档。来源：旧/心情
  corruption: number;                     // 入邪值：≥100 一档，≥200 二档（对应原机制的隐藏堕落度）

  faction: Id<'sect'> | null;             // 所属势力
  rank: number;                           // 身份品阶 9→1。决定可学功法品级、装备品级。来源：旧/人物一览

  // —— 武学 ——
  learned: LearnedArt[];                  // 已学功法及进度，见 §3.3
  loadout: Loadout;                       // 运功栏，见 §3.3
  neili: number;                          // 内力总量
  neiliType: NeiliType;
  qi: { destroy: number; agile: number; guard: number; wonder: number };
                                          // 真气四系 摧破/轻灵/护体/奇窍；战斗外各上限 100。来源：旧/真气
  purity: number;                         // 精纯；攻守双方精纯差影响破体破气。来源：旧/破体破气
  disorder: number;                       // 内息紊乱 0–800，五档影响全属性发挥。来源：旧/内息

  // —— 身体状况 ——
  woundCapOuter: number; woundCapInner: number;   // 外伤/内伤上限，初始各 200，最低 10。来源：旧/内外伤
  wounds: Wound[];                        // 伤口不会自然愈合。来源：旧/疗伤
  poison: Record<PoisonType, number>;     // 六毒当前量
  poisonResist: Record<PoisonType, number>; // 基础 100。来源：旧/毒素抵抗

  // —— 物品 ——
  equipment: EquipmentSlots;              // 见 §3.7
  inventory: ItemStack[];                 // 行囊；超重过月丢物。来源：旧/重量
  money: number;

  relations: Relation[];                  // 见 §3.2
  location: { regionId: Id<'region'>; x: number; y: number };
}

interface FameEntry { key: string; value: number; remainMonths: number; stackable: boolean }

interface Wound {
  part: BodyPart;
  kind: 'outer' | 'inner';
  grade: 1 | 2 | 3;                       // 轻伤/重伤/致命。来源：旧/重伤程度
  severity: Permille;                     // 伤病程度（伤势）
  fresh: boolean;                         // 本场战斗新伤可战斗内治疗，旧伤不可
}

type PoisonType = 'fierce' | 'red' | 'rot' | 'gloom' | 'cold' | 'illusion';
// 烈/赤/腐（外）、郁/寒/幻（内）；各有发作时机与衍生关系。来源：旧/毒素
```

**派生战斗属性**（`core/character/derive.ts`，不进存档，进战斗时算一次再由战斗内效果增减）：

```ts
interface CombatStats {
  hit:   { force: StatStack; swift: StatStack; subtle: StatStack; breath: StatStack };
         // 力道 迅疾 精妙 内息。来源：旧/命中与化解、旧/力道
  avoid: { absorb: StatStack; dodge: StatStack; parry: StatStack };
         // 卸力 闪避 拆招
  penetrateOuter: StatStack; penetrateInner: StatStack;   // 破体 / 破气。来源：旧/破体破气
  guardOuter: StatStack;     guardInner: StatStack;       // 护体 / 御气。来源：旧/护体御气
  dealOuter: StatStack;      dealInner: StatStack;        // 造成外伤 / 造成内伤（基础 100%）
  neigongPlay: StatStack;                                 // 内功发挥 → 内伤比例。来源：旧/内伤比例
  attackSpeed: StatStack; moveSpeed: StatStack; moveStep: StatStack;
  castSpeed: StatStack; breathSpeed: StatStack; postureSpeed: StatStack;
  weaponSwitch: StatStack; guardEfficiency: StatStack;    // 守御效率。来源：旧/守御效率
  healEfficiency: StatStack; detoxEfficiency: StatStack;
  equipLoadMax: number;                                   // 装备负重 = 12 + 膂力×0.2。来源：旧/负重
}
```
- 主属性 → 派生：膂力 > 50 每点 +1 力道，灵敏 → 迅疾、定力 → 精妙同理；其余映射 M2 按 旧/主要属性 逐条录入。
- 内息紊乱分档对「全属性发挥」的乘数、年龄对属性发挥的曲线（`data_ns/Data_EA__Age.tab`）在此统一乘入。

### 3.2 NPC

NPC 与玩家角色共用 `CharacterState`，另挂一份行为与社交数据：

```ts
interface NpcState {
  charId: Id<'char'>;
  templateId: Id<'npcTemplate'>;          // 生成模板：势力 × 身份品阶 → 属性/资质分布、功法池、装备池
  guard: number;                          // 戒心 0–400 = 200 + 身份阶×50 − 好感/200。来源：旧/戒心
  likes: ItemCategory[]; dislikes: ItemCategory[];  // 喜恶：赠礼 ×2 / ×0.5。来源：旧/赠礼
  intent?: NpcIntent;                     // 当月移动意图：寻仇/祭扫/拜师/赴会…
  combatMemory?: CombatMemory;            // 与玩家的历次战斗记忆，见 §3.8
  flags: { talkedThisMonth: boolean };    // 交谈每月 1 次
}

/** 关系。友好类每条使好感 +20%；敌对类单向。来源：旧/人物关系 */
type RelationKind =
  | 'friend' | 'sworn' | 'mentor' | 'benefactor' | 'adore' | 'lover' | 'spouse'
  | 'parent' | 'fosterParent' | 'sibling' | 'child'
  | 'enemy' | 'bloodFeud';                // 誓不两立（好感 −90%）/ 血海深仇（好感锁 0）
interface Relation {
  targetId: Id<'char'>;
  kinds: RelationKind[];
  favor: number;                          // 好感 0–60000，7 档（7500/15000/22500/37500/52500/60000）。来源：旧/人物好感
}

/** 互动定义：数据驱动，核心只管条件与结算 */
interface InteractionDef {
  id: Id<'interaction'>;
  nameKey: string;
  apCost: 1 | 3 | 5 | 10;                 // 行动力四档。来源：旧/行动力
  requires: Condition[];                  // 好感档、关系、双方状态、势力戒律（如某些势力禁婚）
  check?: CheckFormula;                   // 成功判定，如「身法资质+造诣 > 戒心 + 50×(10−物品品级)」
  onSuccess: Outcome[]; onFail: Outcome[];
}
```
- 好感增量 `= (100 + 魅力/9 + 名誉) × 类型系数(交谈1/切磋2/邀约4) × 立场系数(相同4/相反1/其余2)`。
- **月度行为**（`core/world/npcSim.ts`）按 旧/过月行为 的 13 步顺序实现为可开关的步骤管线：丢超重物 → 自疗 → 标记待修 → 意外 → 用药进食 → 治疗他人/下毒/读书 → 资源补给与采集 → 修理 → 抢夺或赠礼 → 修炼（修习 +25–50%）→ 结仇/化解 → 感情链 → 生成移动意图。M4 先做其中 6 步。
- 只有同格 NPC 才会互动；每地区人口上限（100–300）与超限后的减员事件保证总量稳定（来源：旧/天灾）。
- 生育与遗传：两次判定（双方生育力乘积 / 15000；按已有子女数递减），孕期 7–9 月；子女属性 = 父母均值 × 随机浮动（来源：旧/怀孕、旧/生育）。
- 已知矛盾：NPC 读书成功率两页写法不同（旧/过月行为 vs 旧/NPC），做成配置项。

### 3.3 MartialArt（功法）

机制依据：旧/功法、旧/摧破武学、旧/身法、旧/护体绝技、旧/内功、旧/修习、旧/突破、旧/研读、旧/心法等级；逐条数值在 `data_ns/Data_EA__GongFa__{id}.json`（756 条，键为数字，键→字段的映射由子代理对照 84 个渲染页反推，M2 第一周需复核）。

```ts
type ArtSlotKind = 'neigong' | 'destroy' | 'agile' | 'guard' | 'wonder';
// 运功位：内功 / 摧破 / 轻灵(身法) / 护体(主动绝技) / 奇窍(被动绝技)

interface MartialArtDef {
  id: Id<'art'>;
  nameKey: string; descKey: string;
  type: CombatSkillType;                  // 14 类
  slotKind: ArtSlotKind;
  grade: Grade;                           // 九品(9)→一品(1)
  sectId: Id<'sect'> | null;              // 每派 6 类功法、每类 4–9 门，全表约 740 门
  element: NeiliType;                     // 五行属性；混元不参与生克
  slotCost: 1 | 2 | 3;                    // 占格
  secret: boolean;                        // 不传之秘：只能由高阶身份传授

  // —— 修习参数：全部由品级决定（九→一）——
  aptitudeBase: number;                   // 基础资质需求 20,30,…,100
  aptitudePerPct: number;                 // 每 1% 修习追加 0.1,0.2,…,0.9
  expCost: number;                        // 历练 3/6/11/18/27/38/51/66/83
  readDifficulty: number;                 // 阅读难度 20/50/95/155/230/320/425/545/680
  playCap: Permille;                      // 发挥上限 130%(九~七) / 160%(六~四) / 190%(三~一)
  breakthrough: { part: BodyPart; start: string; end: string };   // 突破失败时受伤部位与棋盘起止
  requires: { key: MainAttr | CombatSkillType | LifeSkillType; value: number }[];   // 发挥需求

  loadoutEffects: StatMod[];              // 运功效果：装进运功栏即生效的被动加成
  effectForward?: Id<'effect'>;           // 心法正练特效
  effectReverse?: Id<'effect'>;           // 心法逆练特效

  attack?: {                              // 摧破类
    stanceCost: { type: StanceType; count: number }[];   // 式消耗；腿法为空，改耗移动力
    gaugeTotal: Permille;                 // 提气+架势总消耗：常规 100%，部分兵器流派 60%。来源：旧/功法消耗
    breathShare: Permille;                // 其中提气占比（其余为架势）
    castTime: Frames;                     // 最大施展时间。来源：旧/施展时间
    hit: { force: number; subtle: number; swift: number; breath?: number };   // −1 表示该通道无法被化解
    tenths: { swift: number; subtle: number; force: number };                 // 三通道成数，合计 10。来源：旧/重伤程度
    penetrate: { outer: number; inner: number };          // 破体 / 破气基础值
    damage: Permille;                     // 功法基伤（伤势%）
    innerRatioBase: Permille;             // 基础内功比例
    range: { mode: 'weaponPlus'; delta: number } | { mode: 'absolute'; min: number; max: number };   // 腿法用绝对距离
    partWeights: Partial<Record<BodyPart, number>>;
    sealAt?: number; flawAt?: number;     // 发挥到 N 成时施加点穴 / 破绽
    poison?: Partial<Record<PoisonType, number>>;
    durabilityCost?: number;              // 暗器、御射、符咒类耗武器耐久
    mobilityCost?: number;                // 腿法
  };
  movement?: {                            // 身法
    castTime: Frames;
    mobilityCost: number;                 // = 占格数
    moveSpeed: Permille; moveStep: Permille;
    grant: { count: number; decayFrames: number };        // 获得身法移动力 N 点，每 100 帧衰减 1
  };
  guard?: {                               // 护体绝技
    gaugeTotal: Permille; breathShare: Permille;          // 60% / 80% / 100%
    castTime: Frames; duration: Frames;
    guardFlat: { outer: number; inner: number };
    guardPct: { outer: Permille; inner: Permille };
    avoid: { absorb: number; parry: number; dodge: number };
    counter?: { range: [number, number]; power: Permille; channel: HitChannel };   // 反击威力 160%–600%。来源：旧/反击
    reflect?: { outer: Permille; inner: Permille };       // 反震倍率。来源：旧/反震
  };
  neigong?: {                             // 内功
    slots: { destroy: number; agile: number; guard: number; wonder: number; universal: number };
                                          // 提供的运功格；总量随品级增长（约 18→26）
    neiliPerPct: Partial<Record<NeiliType, number>>;      // 每 1% 修习提供的内力
  };
}

/** 特效 DSL，见 §5.12 */
interface EffectSpec {
  id: Id<'effect'>;
  descKey: string;                        // 描述由 DSL 自动生成初稿，再人工润色
  trigger: EffectTrigger;
  when?: Condition[];
  ops: EffectOp[];
  unsupported?: boolean;                  // 长尾特效：仅显示文字，不生效
}

/** 人物已学的一门功法 */
interface LearnedArt {
  artId: Id<'art'>;
  practice: number;                       // 修习程度 0–100；≥25 才能运起，100 时威力 +20%。来源：旧/修习程度
  gatesPassed: number;                    // 已突破的玄关数
  pages: ('none' | 'forward' | 'reverse' | 'neutral')[];   // 十篇心法；真传=正练，手抄=逆练
  refinements?: Id<'refine'>[];           // 精进（后期系统，M4 之后）
}

interface Loadout {
  mainNeigong: Id<'art'> | null;          // 主运内功，决定各类运功格数量
  slots: Record<ArtSlotKind, Id<'art'>[]>;// 每类按占格计数，不得超过可用格
}
```

**规则（`core/martial/`）**

| 规则 | 公式 | 来源 |
| --- | --- | --- |
| 发挥效率 | 对每条需求算 `(100 + floor((属性 − 需求) × 100 / 需求))%`，各项封顶于发挥上限后取平均，下限 20% | 旧/功法 |
| 修习 | 每次 1 行动力，+1%（20% 概率 +2%）；历练倍率 `[100 + (需求资质 − 人物资质)/3 − 建筑等级×5]%`，最低 25% | 旧/修习 |
| 玄关 | 九~七品 50%；六五品 30/70%；四三品 25/50/75%；二一品 20/40/60/80%。到玄关必须突破 | 旧/修习程度 |
| 突破 | 20 行动力，在六边形棋盘上从起点连到终点。步数：资质达标 20；过半 `15×资质/需求`；不足半 `10×资质/需求`（≥1）。单步成功率 `min(90, 30 + 品阶值×5 + 加成 + min(30, 悟性/10))% ± 15%` | 旧/突破 |
| 走火 | 超步后伤势 `= 步数² × 2.5%`，内息紊乱 `+ 步数² × 25 × 程度` | 旧/突破 |
| 研读 | 10 行动力；耐心 `30 + 坚毅 + Σ藏书建筑等级×5`；每章前 20 次免耐心；篇章状态决定进度增量/成功率（完好 50%/100%，残缺 5%/5% 等） | 旧/研读 |
| 心法 | 十篇即十级。每一正练等级发挥上限 +3%/+6%/+9%（按品级三档）；每一逆练等级发挥需求 −1/30。≥5 级时按正/逆多寡定特效方向 | 旧/心法等级 |
| 实战修习 | 战斗中使用有概率 `[(50 + 品级值×5) × (150 − 修习) / 100]%` 提升，不能过玄关 | 旧/实战修习 |
| 内力 | 非混元内功提供 `(10 − 品级) × 10 × 修习%` 的本属性内力；额外内力 = 本属性 − 克制它的属性（≥0） | 旧/内力 |
| 真气 | 第 m+1 点耗内力 `floor((m+1) + 0.01×(m+1)²)`；四系各 ≤ 100 | 旧/真气 |
| 内力属性状态 | 由各属性内力的比例判定（纯粹 / 相生 / 相克 / 均衡等），给全局威力 ±20–30% 并影响伤/毒上限 | 旧/内力属性 |

M1 只用到 `attack` / `guard` / `movement` 三块与发挥效率；修习、突破、研读放 M2，其中突破的棋盘小游戏先做「自动结算」版，棋盘交互排在 M4。

**待核实**：运功栏的总体结构（主运/辅运数量、万用格规则）wiki 没有说明页；混元内功的内力系数 wiki 与数据差一倍；数据里命中/伤害等原始值与页面显示值之间有 ×80（九至三品）/×100（二一品）的倍率，成因不明。三项都以 `data_ns` 原始值为准、做成可调常量。

### 3.4 Sect（门派 / 势力）

```ts
interface SectDef {
  id: Id<'sect'>;
  nameKey: string; descKey: string;
  alignment: 'righteous' | 'neutral' | 'evil';   // 正 / 中立 / 邪，各 5 个。来源：旧/门派
  stanceStd: number;                      // 立场标准值 0 / 250 / 500 / 750 / 1000；成员立场向它靠拢。来源：旧/处世立场
  element: NeiliType;                     // 门派主五行
  home: { provinceId: Id<'province'>; regionId: Id<'region'> };
  artTypes: CombatSkillType[];            // 本派 6 类功法（内功、身法、绝技 + 3–4 类摧破）
  arts: Id<'art'>[];                      // 40–56 门
  ranks: SectRank[];                      // 九阶身份
  join: {
    fameMin?: number; fameMax?: number;   // 正派需名誉 ≥ −24；邪派需 ≤ 24。来源：旧/请求学艺
    gender?: 'm' | 'f';                   // 个别势力有性别限制
    marriageBan?: 'all' | 'topRanks';     // 个别势力禁婚
  };
  support: SupportTier[];                 // 支持度 → 解锁品阶
  studyRule?: {                           // 门派特殊修习方式（支持度 30% 开启）
    kind: 'readCurve' | 'weaponQuality' | 'crossSkill' | 'none';
    params: Record<string, number>;       // 例：研读首章 −50% 之后每章 +15%；或首章 +100% 之后每章 −15%
  };
  entryNeigong: Id<'art'>;                // 入门内功：正练提高本派功法发挥上限，逆练提高本派功法威力
  artKey: string;                         // 门派驻地立牌、徽记
}

interface SectRank {
  tier: Grade;                            // 9（最低）→ 1（掌门）
  titleKey: string;
  maxArtGrade: Grade;                     // 该身份 NPC 可学的最高功法品级
  supportBase: Permille;                  // 该身份者的支持基础值：2/3/4/6/8/10/13/17/22%。来源：旧/门派支持
}

interface SupportTier {                   // 20%→九品，30%→八品 … 100%→一品
  threshold: Permille;
  worldProgressReq: 0 | 1 | 2 | 3 | 4 | 5 | 6;   // 50% 起每档需要世界进度 1–6
  unlockGrade: Grade;
}

interface SectStanding {                  // 玩家对某势力的运行期状态
  sectId: Id<'sect'>;
  permitted: boolean;                     // 已获学艺许可
  supporters: Id<'char'>[];               // 已表态支持的成员
  // 支持度 = Σ 成员 supportBase × (40 + 10 × 好感档) / 100
}
```
- 争取某成员支持的方式取决于对方立场：刚正 → 接招获胜；仁善 → 较艺获胜；中庸 → `(10 − 品级)³ × 100` 银钱；叛逆 → 好感达标；唯我 → 切磋获胜（来源：旧/门派支持）。这把战斗、技艺、经济、社交四条线都接到了功法获取上，是整个养成循环的枢纽，M4 必做。
- 请教功法：5 行动力，对方修习 ≥ 50%，自己须先把同派同类低一品的功法修到 50%（来源：旧/请教功法）。
- 默认内容包使用经典版的 15 个门派（正/中/邪各 5），直接沿用原名称、身份称谓、功法名与描述；数据从 wiki 提取。

### 3.5 Building（建筑与产业）

```ts
type ResourceType = 'food' | 'wood' | 'metal' | 'jade' | 'fabric' | 'herb';   // 六种建造资源。来源：旧/建筑/*、旧/资源

interface BuildingDef {
  id: Id<'building'>;
  nameKey: string; descKey: string;
  category: 'special' | 'study' | 'quality' | 'reduceReq' | 'trainCost' | 'breakCost'
          | 'gather' | 'produceItem' | 'prestige' | 'income' | 'recruit';
                                          // 功能类 / 经营类的细分。来源：旧/产业一览
  maxLevel: number;                       // 最大规模（常见 20）。来源：模板 Infobox建筑
  unique?: boolean;                       // 限建 1 座
  upkeep: { resource: ResourceType; perMonth: number };       // 维护成本
  buildWork: { manpower: number; months: number };            // 建造工时；每多投 1 人力 −1 月，最少 1，单项上限 20。来源：旧/人力
  levels: BuildingLevel[];                // 逐级表
  requires?: {
    blueprint?: Id<'item'>;               // 兴建耗图纸；扩建不耗。来源：旧/图纸
    adjacentNode?: ResourceNodeType[];    // 须邻接某类资源点
    prerequisite?: Id<'building'>[];
    lifeSkill?: { type: LifeSkillType; value: number };       // 技艺需求
  };
  operation?: {                           // 经营类建筑
    skill: LifeSkillType;                 // 经营者用哪项技艺
    cycleMonths: [min: number, max: number];                  // 收获周期（如 2.5–10）
    yields: YieldRule[];                  // 按评价 +2/+1/−1/−2 给出产出区间
  };
  effects?: EffectSpec[];                 // 被动效果：同伴上限、初见好感、仓储容量…
  artKey: string;                         // 立牌图集键，见 §7.3
}
interface BuildingLevel {
  level: number;
  cost: Partial<Record<ResourceType, number>>;   // 升级消耗
  skillReq?: number;                             // 该级技艺需求
  yieldScale?: number;
}

/** 资源点：有等级，每月按概率 +1 级或向正交邻格扩张。来源：旧/太吾村 */
type ResourceNodeType = 'water' | 'rock' | 'forest' | 'peak' | 'herbs' | 'swamp'
                      | 'flowers' | 'gems' | 'field' | 'herd' | RareNodeType;
interface ResourceNode { type: ResourceNodeType; level: number; growChance: Permille; spreadChance: Permille }

interface TownState {
  size: 13;                               // 13×13 = 169 格。来源：旧/太吾村
  level: number;                          // 村等级 ≤ 20；建筑数上限 = 11 + (等级−1)×3 + 额外
  cells: (TownCell | null)[];             // 长度 169
  manpower: { total: number; busy: number };
                                          // 上限 100 = 5 + 成年村民 + Σ(居所等级+1)…；为负每点每月扣 100 钱。来源：旧/人力
  stock: Record<ResourceType, number>;    // 上限 = 1400 + 1500×Σ仓库等级。来源：旧/资源
  jobs: BuildJob[];                       // 兴建/扩建/拆除/采集队列
}
type TownCell =
  | { kind: 'building'; defId: Id<'building'>; level: number; durability: number; workerId?: Id<'char'>; progress?: number }
  | { kind: 'node'; node: ResourceNode }
  | { kind: 'ruin' };
```
- 可建空地 = 距已有建筑正交 2 格或斜向 1 格以内。
- **数据情况**：建筑的渲染页只有 5 页带数值，但 `data_ns/Data_EA__HomePlace__*.json`（277 条）有原始数据，键为数字、映射待解（§8.2）。字段形状已定；解码前先用参数化曲线（成本随等级近似线性、收益区间随等级与评价档放大）占位，以那 5 页作锚点校验数量级。

### 3.6 Region / Province / Tile（世界与地图）

```ts
interface ProvinceDef {
  id: Id<'province'>;
  nameKey: string;
  outline: [number, number][];            // 大地图轮廓（简化后的多边形），见 §4.1
  layerHeight: 0 | 1 | 2 | 3;             // 纸雕叠层的基础高度档
  accentColor: string;                    // 选中时变成的颜色
  regions: [capital: Id<'region'>, sect: Id<'region'>, rural: Id<'region'>];
                                          // 每省 3 个地区：省会/门派/乡村；共 15 省 45 地区。来源：旧/省份
  travelCost: Record<string, number>;     // 到其他省的基础行动力 10–60（15×15 矩阵）。来源：旧/旅行
}

interface RegionDef {
  id: Id<'region'>;
  nameKey: string;
  kind: 'capital' | 'sect' | 'rural';
  size: 30 | 20;                          // 省会、门派 30×30；乡村 20×20。来源：旧/地区
  settlements: number;                    // 聚居点数：省会/门派 1 主 + 2；乡村 1
  popCap: number;                         // 人口上限 100–300。来源：旧/天灾
  sectId?: Id<'sect'>;
  generator: { seedSalt: number; terrainWeights: Record<TerrainType, number> };   // 其余地块每档随机生成
}

/** 地形：5 种资源 × 3 档 + 无资源 + 聚居。括号为移动耗行动力。来源：旧/地块 */
type TerrainType =
  | 'plain' | 'lake' | 'farmland'         // 食材：原野1 湖泊2 农田1
  | 'woods' | 'jungle' | 'garden'         // 木材：林地2 密林3 园林1
  | 'mountain' | 'cave' | 'stoneForest'   // 金石：山岳3 洞穴2 石林1
  | 'hill' | 'vale' | 'mulberry'          // 织物：丘陵2 桃源2 桑园1
  | 'canyon' | 'marsh' | 'herbGarden'     // 药材：峡谷2 沼泽3 药园1
  | 'waste' | 'abyss'                     // 荒野1；暗渊4（通过受伤）
  | 'city' | 'sectSeat' | 'town' | 'fort' | 'village';   // 聚居，均为 1

interface TerrainDef {
  type: TerrainType;
  moveCost: number;                       // 无代步再 +1
  resource?: ResourceType;
  healHerbCost: number;                   // 在此地块疗伤/驱毒耗药材 60–600
  artKeys: { ground: string; standees: string[] };
}

interface TileState {
  terrain: TerrainType;
  resourceLeft: Permille;                 // 当前资源余量；按季节恢复，见 §3.9
  explored: boolean;                      // 探索过永久可见
  settlementId?: Id<'settlement'>;
  hasStation?: boolean;                   // 驿站：每地区 1 个，打通后可旅行
  ruined?: boolean;
  adventureId?: Id<'adventureInst'>;
}

interface RegionState {
  id: Id<'region'>;
  tiles: TileState[];                     // size × size
  unlocked: boolean;                      // 驿路是否打通；新开地区耗威望，逐次 +50
  goodwill: Permille;                     // 地区恩义；上限随世界进度 40%→100%。来源：旧/恩义
}

interface WorldState {
  provinces: Record<string, { regions: RegionState[] }>;
  progress: 0 | 1 | 2 | 3 | 4 | 5 | 6;    // 世界进度：抬高势力支持、恩义、商会好感的上限与可招募身份
  difficulty: DifficultySettings;         // 战斗难度系数表、寿命、资源丰度…。来源：旧/世界细节
}
```
- 视野规则：地图边缘、聚居点及四邻、玩家四邻、特殊事件格可见。
- 世界进度在原机制里由主线据点推进；本项目把它抽象成 `progress`，由原创主线提供推进条件（M4 之后）。

### 3.7 Item / Equipment / Weapon（物品）

```ts
type Grade = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;   // 九品(9) → 一品(1)。来源：旧/品级
type ItemCategory = 'weapon' | 'armor' | 'accessory' | 'mount' | 'material' | 'medicine'
                  | 'poison' | 'food' | 'tea' | 'wine' | 'book' | 'blueprint' | 'tool' | 'misc';

interface ItemDef {
  id: Id<'item'>;
  nameKey: string; descKey: string;
  category: ItemCategory;
  subType: string;                        // 细类（剑/刀/针匣/冠饰/鞋…）。来源：模块 Const/name
  grade: Grade;
  baseValue: number;                      // 九品→一品 = n³×100（100…72900）；售价再乘种类/好感补正。来源：旧/价值
  giftValue: number;                      // 赠礼好感值；仅满耐久可送
  weight: number;                         // 影响负重与武器攻击间隔。来源：旧/重量
  durabilityBase: number;                 // 生成时在 [1+基础/2, 1+基础] 随机。来源：旧/耐久
  material?: 'hardWood' | 'softWood' | 'hardMetal' | 'softMetal' | 'hardJade' | 'softJade' | 'hardCloth' | 'softCloth';
  canRefine: boolean; canPoison: boolean; // 精制最多 10 次。来源：旧/精制
  useEffects?: EffectSpec[];              // 使用效果（药、食物、茶酒）
  equipEffects?: EffectSpec[];            // 装备效果
  artKey: string;
}

interface WeaponDef extends ItemDef {
  category: 'weapon';
  weaponFamily: CombatSkillType;          // 决定可配合哪类摧破
  baseDamage: number;                     // 武器基伤。来源：旧/伤害计算
  range: [min: number, max: number];      // 攻击距离段，2.0–9.0 内。来源：旧/攻击距离
  speedClass: 3000 | 4500 | 6000 | 7500 | 9000;   // 极快…极慢；再 + 重量×100。来源：旧/攻击间隔
  wheel: StanceType[];                    // 6 格式轮盘（集合固定，开战时洗牌）。来源：旧/招式
  hit: { force: number; swift: number; subtle: number };   // 三通道命中
  penetrate: { outer: number; inner: number };             // 破体/破气基础值
  armorBreak: number;                     // 破甲。来源：旧/破甲
  toughness: number;                      // 坚韧（武器也有）
  innerRatioBase: Permille;               // 基础内伤比例
  neigongConv: number;                    // 内功发挥转化系数。来源：旧/内伤比例
  chaseCoef: number;                      // 追击系数 5–60。来源：旧/追击
  changeCoef: number;                     // 变招系数（初始同追击，但独立）。来源：旧/变招
  artPlay: Permille;                      // 武器的功法发挥
  requires: Partial<Record<MainAttr, number>>;
                                          // 使用需求；发挥 = 各(属性/需求)均值，单项上限 (200−品级×10)%。来源：旧/武器
}

interface ArmorDef extends ItemDef {
  category: 'armor';
  slot: 'head' | 'body' | 'feet';         // 冠饰护头颈；护甲护双臂/胸背/腰腹；鞋护双腿。来源：旧/护具
  toughness: number;                      // 最多减 50% 外伤 / 25% 内伤；四肢处发挥 50%
  bladeBreak: number;                     // 破刃
  guard: { outer: number; inner: number };// 护体/御气
}

interface ItemStack {                     // 运行期物品实例
  uid: Id<'itemInst'>;
  defId: Id<'item'>;
  durability: number; durabilityMax: number;
  refine?: { count: number; mods: StatMod[] };
  engraving?: Id<'engraving'>;            // 篆刻（如破甲+50%/坚韧−50%）。来源：旧/装备篆刻
  poisonCoat?: Partial<Record<PoisonType, number>>;   // 淬毒
  bookPages?: boolean[];                  // 书：10 篇的残缺情况。来源：旧/书籍
}

interface EquipmentSlots {
  weapons: [ItemStack?, ItemStack?, ItemStack?];   // 战斗中可切换。来源：旧/切换兵器
  head?: ItemStack; body?: ItemStack; feet?: ItemStack;
  accessories: [ItemStack?, ItemStack?, ItemStack?]; // 宝物 3 栏
  clothing?: ItemStack;                   // 衣着：魅力 +20×(品级值−4)，无衣着魅力减半。来源：旧/魅力
  mount?: ItemStack;                      // 代步：免移动 +1 惩罚、加旅行速度
}
```
- 负重惩罚：未超重移速 −[20×重量/负重]%，超重 −[40×重量/负重]%，最多 −90%（来源：旧/负重）。
- **数据情况**：物品渲染页是空壳，但 `data_ns/Data_EA__Item__*.json`（4442 条）有原始数值，同样是数字键、映射待解（§8.2）。解码完成前，武器表用参数化生成：`baseDamage`、`range`、`speedClass`、`chaseCoef` 由「细类 × 品级」公式给出，再人工点调。

### 3.8 战斗数据：CombatState / CombatAction / DamageCalc

```ts
type StanceType =
  | 'throw' | 'flick' | 'steer' | 'chop' | 'stab' | 'lift' | 'burst' | 'tap'
  | 'grab' | 'sound' | 'bind' | 'curse' | 'device' | 'drug' | 'venom' | 'sweep'   // 16 常规式
  | 'none' | 'wild' | 'kill';                                                     // 无 / 万能 / 杀
type HitChannel = 'force' | 'swift' | 'subtle' | 'breath';
type BattleKind = 'duel' | 'spar' | 'brawl' | 'trial';   // 死斗100% / 切磋50% / 恶战75% / 接招50%（战败阈值）

interface CombatState {
  seed: number; rngCursor: number;
  kind: BattleKind;
  phase: 'prepare' | 'opening' | 'running' | 'paused' | 'choice' | 'ended';
  frame: Frames;                          // 逻辑帧；animLock 期间不自增
  animLock: Frames;                       // 出手动画剩余帧：全部计时器暂停。来源：旧/战斗
  distance: number;                       // 20–90（= 2.0–9.0，以 0.1 为 1）。来源：旧/敌我距离
  sides: [SideState, SideState];
  initiative: 0 | 1;                      // 先手方。来源：旧/机略
  choice?: ChangeMoveChoice;              // 变招窗口
  result?: { winner: 0 | 1 | null; reason: 'defeat' | 'flee' | 'special' };
  events: CombatEvent[];                  // 本帧待取走的事件
}

interface SideState {
  main: FighterState;
  mates: MateState[];                     // 最多 4 名队友。来源：旧/队伍
  tactics: { remain: number; strategy?: Id<'strategy'> };   // 机略与所选策略
  avgFortune: number;                     // 队伍平均福缘，进命中公式
}

interface FighterState {
  charId: Id<'char'>;
  stats: CombatStats;                     // §3.1，战斗内效果直接 push 到各 StatStack
  targetDistance: number;                 // 玩家/AI 设的目标距离
  moveProgress: number;                   // 0–15000。来源：旧/移动
  mobility: { white: number; skill: number; whiteTimer: Frames; skillTimer: Frames };   // 白≤3，身法≤6
  weaponIndex: 0 | 1 | 2;
  wheelOrder: StanceType[]; wheelPos: number;
  attackProgress: Frames; attackInterval: Frames;         // 来源：旧/攻击间隔
  changeMeter: number;                    // 变招值（PRD），触发后清 0。来源：旧/变招
  switchCooldown: number;                 // 0–60000
  breath: number; posture: number;        // 提气 / 架势，各 0–30000。来源：旧/提气架势
  stances: StanceType[];                  // 已持有的式
  guard: number; guardMax: number; guardBroken: boolean;  // 守御。来源：旧/守御
  focus: number;                          // 专注 0–1000。来源：旧/专注
  cast?: { artId: Id<'art'>; progress: Frames; total: Frames };
  guardSkill?: { artId: Id<'art'>; remain: Frames };      // 护体绝技持续中
  fleeProgress: Frames;
  wounds: Wound[];                        // 含带入的旧伤
  outerTotal: Permille; innerTotal: Permille;             // 累计，用于战败判定
  seals: Record<BodyPart, number>;        // 点穴层数 0–10
  flaws: Record<BodyPart, number>;        // 破绽层数 0–10。来源：旧/点穴与破绽
  poison: Record<PoisonType, number>;
  effects: ActiveEffect[];                // 持续效果实例
  memory: CombatMemory;
  healsLeft: number; detoxLeft: number;   // 战斗内疗伤/驱毒次数 = floor((资质+造诣)/60)，1–9
}

/** AI 用的战斗记忆。来源：旧/战斗记忆 */
interface CombatMemory {
  hitsTaken: number; hitsDodged: number;
  damageByDistance: number[];             // 按距离分桶的受伤统计
  artResults: Record<string, { casts: number; bestTenths: number }>;   // 某功法曾打出几成
}

/** 玩家与 AI 发出的指令（两者完全同构） */
type CombatAction =
  | { type: 'setTargetDistance'; side: 0 | 1; value: number }        // ±0.1 / ±0.5
  | { type: 'cast'; side: 0 | 1; artId: Id<'art'> }                  // 摧破/护体/身法
  | { type: 'switchWeapon'; side: 0 | 1; index: 0 | 1 | 2 }
  | { type: 'chooseChangeMove'; side: 0 | 1; part: BodyPart | null } // null = 不变招
  | { type: 'heal' | 'detox'; side: 0 | 1 }
  | { type: 'useItem'; side: 0 | 1; uid: Id<'itemInst'> }            // 仅 prepare 阶段
  | { type: 'pickStrategy'; side: 0 | 1; strategyId: Id<'strategy'> }
  | { type: 'pause' | 'resume' };

/** 一次伤害结算的全过程记录：既是计算的中间结构，也是公式检查器的数据源。来源：旧/伤害结算流程 */
interface DamageCalc {
  attacker: 0 | 1;
  source: 'attack' | 'chase' | 'combo' | 'counter' | 'technique' | 'reflect' | 'true';
  artId?: Id<'art'>; stance?: StanceType;
  part: BodyPart; channel: HitChannel;
  hitValue: number; avoidValue: number; hitChance: Permille; rolled: number; landed: boolean;
  changeMove?: { part: BodyPart; success: boolean };
  grade: 1 | 2 | 3;
  // —— 常规伤害 ——
  weaponBase: number; artBase: number;
  innerRatio: Permille;                   // 旧/内伤比例
  armorMult: { outer: Permille; inner: Permille };        // 旧/破甲
  penetration: {                          // 旧/破体破气
    atk: { outer: number; inner: number }; def: { outer: number; inner: number };
    coef: { outer: Permille; inner: Permille };
    mult: { outer: Permille; inner: Permille };
  };
  dealMult: { outer: Permille; inner: Permille };         // 造成外伤/内伤
  power: Permille;                        // 普攻威力 100/300/反击威力
  artAdjust: Permille;                    // 功法伤害调整
  tenths?: number;                        // 功法命中成数
  regular: { outer: Permille; inner: Permille };
  // —— 通用伤害 ——
  guardDamage: number; absorbedByGuard: boolean;          // 旧/守御
  generalAdjust: Permille;                // 旧/通用伤害调整（下限 20%）
  reflect?: { outer: Permille; inner: Permille };         // 旧/反震
  // —— 直接伤害 ——
  directAdjust: Permille;
  final: { outer: Permille; inner: Permille };
  woundsCreated: Wound[];
  focusGained: number;
  steps: { label: string; value: number; mods: StatMod[] }[];   // 每一步的展开，供检查器显示
}
```
`CombatEvent` 是表现层的唯一输入：`{ type, frame, duration, side, payload }`，类型见 §4.4 末尾。

### 3.9 Season / TimeSystem（时间）

```ts
interface TimeState {
  year: number;
  month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;   // 1 年 12 个月（原机制称「时节」）；只在过月时存档。来源：旧/时节
  ap: number; apMax: number;              // 行动力：按主角年龄 0–4:10 / 5–14:20 / 15–49:30 / 50–89:20 / 90+:10。来源：旧/行动力
}
type Season = 'spring' | 'summer' | 'autumn' | 'winter';

interface SeasonRule {                    // 来源：旧/时节更替
  months: number[];
  regen: ResourceType[];                  // 当月恢复哪些资源：春 食木药；夏 食木织；8–9月 食木织药；10月 金织；冬 金
  regenMax: Permille;                     // 按世界丰度 14% / 10% / 6% / 2%
  palette: string;                        // 渲染用季节色板，见 §4.3
}

/** 过月管线：按固定顺序跑一组步骤，每步可产出 WorldEvent 给 UI 汇总 */
type MonthStep =
  | 'aging' | 'healthSettle'              // 生日：年龄+1、健康与上限−1；伤/毒超限扣健康。来源：旧/健康
  | 'resourceRegen' | 'townNodes' | 'townJobs' | 'townProduce' | 'upkeep'
  | 'npcSim'                              // §3.2 的 13 步
  | 'relationsEvents'                     // 赴约、赠礼、暗害、指点…
  | 'adventureSpawn'                      // 奇遇生成；固定月份事件（如二月集市）
  | 'overweightDrop' | 'refreshAp' | 'autosave';
```
- AP 消耗：采集 1、修习 1/次、研读 10、突破 20、互动 1/3/5/10、奇遇 1–20、省内旅行 10、跨省 10–60。
- wiki 只列了过月事件的类别，没给严格顺序；上面的顺序是本项目的定稿，M3 实现后固定下来写进测试。

### 3.10 Adventure（奇遇 / 副本）

```ts
interface AdventureDef {
  id: Id<'adventure'>;
  nameKey: string;
  kind: 'combat' | 'nonCombat';
  difficulty: number;                     // 1–9
  cost: { ap: number; food?: number; item?: Id<'item'> };
  durationMonths: number;
  wheelSkills: (CombatSkillType | LifeSkillType)[];   // 转盘检定用的技艺/功法类型
  graph: AdvNode[];                       // 自左向右、不可回头，到 end 结束。来源：旧/奇遇
}
interface AdvNode {
  id: string;
  septet: Septet | 'end';                 // 分岔时自动走向队伍七元最高的一类（队伍七元 = 全员平均）
  next: string[];
  effect: AdvEffect;                      // 细腻 资源 / 聪颖 历练 / 水性 引子 / 勇壮 战斗或受伤 / 坚毅 疗伤内力 / 冷静 +1 筹画 / 福缘 吉凶
  check?: { base: 10 | 20 | 30 | 40 | 50 };   // 基准 = base × 难度；队伍资质 = 主角(资质+造诣) + 其余合计×25%
}
```
筹画：进入时 1 次，可把某项七元临时置满走一步。中途离开保留所得、不退消耗。
---

## 4. 渲染方案

### 4.0 共用：纸片工具箱（`src/render/paper/`）

四类场景共用一套「纸」的表现，技法取自 papertrails（MIT，可借鉴代码，保留版权声明）：

| 组件 | 做法 | 备注 |
| --- | --- | --- |
| `PaperMaterial` | `MeshLambertMaterial` + `onBeforeCompile` 注入：纸纤维噪声、wrap diffuse（背光面不死黑）、背光透射（灯在纸后时透亮）、模切白边（alpha 边缘向内 1–2px 提亮）、最多 6 个局部灯池 | 一个材质变体对应一张图集 |
| `PaperCard` | 一张带 alpha 的四边形，**朝向固定**（不是 billboard），底边为铰链轴 | 人物、建筑、树都是它 |
| `hinge.ts` | 临界阻尼弹簧驱动绕底边的翻起角；状态 `RISE / LOCKED / FALL` | 只取弹簧与状态机，不搬 papertrails 的 WFC 地块耦合部分 |
| `PaperBatch` | 每种材质一个 `BatchedMesh`，实例矩阵由铰链角更新 | 城镇、地区图用；战斗场景物件少，不需要 |
| `shadows.ts` | 方向光 + PCSS 软阴影补丁；低端机回退为贴地椭圆 blob 阴影 | 画质档位开关 |
| 相机 | `PerspectiveCamera`，fov ≈ 27°，俯角 ≈ 53°，临界阻尼跟随；轻微景深 | 战斗场景另设（§4.4） |
| 图集 | 每场景 1–2 张 2048² WebP（后续可转 KTX2）；`atlas.json` 给出每张卡片的 uv、锚点、物理尺寸 | 由 §7 工单产出 |

性能预算（集显笔记本 1080p 60fps）：draw call ≤ 150，三角形 ≤ 20 万，贴图显存 ≤ 256MB。基线 WebGL2。

风格取向：整体是「立体书 / 纸模剧场」，不是像素风；用户提到的像素感通过「低饱和平涂 + 清晰剪影 + 少量手绘纹理」保留。美术用 AI 生成纸片剪影风格素材，可直接参照经典版造型（§7）。

### 4.1 大地图（`WorldMapScene`）—— 点哪片哪片变色的纸雕地图

**目标效果**：一张由多层卡纸叠出来的地图，每个省域是一块独立的纸片；鼠标悬停时该片微微抬起，点击后变成该地区的主题色并升到最高层，周围各片略微压暗；再次确认后镜头俯冲进入地区地图。

**实现**
- 数据：`content/base/regions.json` 里每个 `Province` 带一条简化后的轮廓 `outline: [x,y][]`（300–600 点）。轮廓来自公有领域的行政区划矢量（如 Natural Earth），用 mapshaper 简化并做一点手绘化抖动，再按游戏需要合并成 15 个省域（每省含省会、门派、乡村 3 个地区，共 45 个，见 §3.6）；周边不可进入的区域做成压暗的装饰片。选中省域后弹出该省 3 个地区的小卡片供选择。
- 几何：`ShapeGeometry` → `ExtrudeGeometry`（厚度 0.02–0.05，无倒角），每片一个 Mesh（总数 < 40，不需要合批）。各片基础高度按「地势」错开 2–4 档，形成叠层。
- 材质：`PaperMaterial` 的纯色变体；侧面用更深的同色相，模拟卡纸切口。
- 交互：`Raycaster` 直接拾取（片数少，够用）。状态 `idle / hover / selected / dimmed / locked`，各状态的目标 `{height, color, saturation}` 用临界阻尼弹簧追，颜色在 OKLab 里插值避免发灰。
- 装饰层：山脉、河流、云是更小的立牌和纸条，放在最上层，随相机轻微视差；地名用 `troika-three-text` 或 DOM 标签。
- 镜头：近似正俯视（fov 20°，俯角 75°），可拖拽、滚轮缩放；选中后 0.6s 推近 → 交叉淡入 `RegionScene`。
- 移动端：点击 = hover + 弹出信息卡，再点「前往」确认。

### 4.2 地区地图（`RegionScene`）

**目标效果**：每个地区是一张格子地图，格子上立着山、林、水、村落、门派驻地等纸牌；人物棋子一格一格走，走到哪里哪里的纸牌「翻起来」。

**实现**
- 数据：`RegionState.tiles`，省会与门派地区 30×30、乡村地区 20×20，地形 22 种，见 §3.6。30×30 满图约 900 块底纸 + 1500–2500 张立牌，必须合批并做视锥剔除（只更新相机附近约 15×12 格的铰链）。
- 地面：每种地形一张底纸贴图，全图合成一个 `BatchedMesh`（或直接一张 `DataTexture` 驱动的地面 shader，M3 时二选一，先用前者）。
- 立牌：每格 0–3 张 `PaperCard`（地形装饰 + 地点建筑 + 标记），走 `PaperBatch`。未探索的格子立牌处于 `FALL`（平躺），进入视野时按到人物的距离延迟依次 `RISE`，形成翻书波纹。
- 人物棋子：一张立牌 + 底座圆片；移动时沿路径做小抛物线跳跃，落地压一下（squash）。
- 拾取：地面按格坐标直接算（射线与 y=0 平面求交 → 取整），不逐物体 raycast。
- 时间：每走一格消耗行动力（§3.9），HUD 显示本月剩余行动力；月末触发「过月」翻页转场。
- 相机：fov 27°、俯角 53°，跟随棋子，边缘留 2 格余量；景深焦点在棋子处。

### 4.3 城镇 / 产业视图（`TownScene`）

**目标效果**：一块 13×13 的纸板地基，上面是一栋栋纸模小屋；建造时小屋从地面翻起并「咔」地锁定，升级时多加一层屋顶或招牌。

**实现**
- 网格：13×13，每格 1 个建筑位（建筑占 1 格；资源点、废墟等天然地块也占格）。数据见 §3.5。
- 建筑立牌：每栋 2–4 张卡片（正立面、侧立面、屋顶、招牌），朝向固定、相互成 90° 插接，模拟纸模；等级越高卡片越多。全部走 `PaperBatch`，13×13 满铺约 500–700 张卡片，1 个 draw call / 图集。
- 动画：`建造中` = 铰链角 15° 半立 + 脚手架小牌；`完工` = `RISE → LOCKED` 并带一次过冲；`升级` = 新增卡片单独翻起；`拆除` = `FALL`。
- 工人：派驻了人的建筑门口立一张小人牌，产出时头顶冒资源图标纸片。
- 交互：格子拾取同 §4.2；选中格高亮（底纸换色 + 轻微抬起）；建筑详情、派工、建造菜单全在 DOM 面板里。
- 光照：一盏暖色方向光 + 可选夜间模式（窗户用背光透射点亮），季节切换时整体色调和地面贴图换一套（§3.9）。

### 4.4 战斗场景（`CombatScene`）

**舞台**：侧视的纸模剧场。3–5 层视差背景（远山、中景建筑、近景草石），左右各一名剪影人物站在一条横轴上；逻辑距离 2.0–9.0 线性映射到舞台横向 1.6–7.2 个单位，脚下一条刻度纸带显示当前距离与双方武器距离段。相机 fov 30°、近似平视略俯（俯角 8°），随双方中点平移，距离大时自动拉远。

**人物 = 叠层彩纸剪影 + 少量关键姿势，不做骨骼动画。** 每个角色体型一套姿势卡（图集里的独立图）：

| 姿势组 | 张数 | 用途 |
| --- | --- | --- |
| 待机 | 2（呼吸交替） | 默认 |
| 进 / 退 | 各 1 | 移动时切换 + 卡片整体平移 |
| 蓄势 | 1/武器族 | 普攻前摇、功法施展中（循环抖动） |
| 出手 | 2/武器族（收、放） | 普攻的两个强关键帧 |
| 功法终结 | 1/功法大类 | 摧破第四段 |
| 化解 ×3 | 各 1 | 卸力（架挡）、闪避（侧身）、拆招（拨开） |
| 受击 | 2（轻、重） | 命中反馈 |
| 护体 | 1 | 护体绝技持续中 |
| 倒地 | 1 | 战败 |

武器族暂定 6 个（拳掌指、剑、刀、长兵、软兵/奇门、远程），武器本身是单独的卡片挂在手部锚点上，换武器只换这张卡。全套约 22–26 张/体型，男女各 1–2 个体型起步。

**打击感时间表**（逻辑上一击是瞬时的，以下全在 `animLock` 内播放，单位帧）

| 阶段 | 普攻轻伤 | 普攻重伤 | 摧破每段 | 摧破终结（致命） |
| --- | --- | --- | --- | --- |
| 预备（蓄势卡，向后压缩 + 后移） | 4 | 5 | 3 | 8 |
| 出手（直接切到「放」卡，前冲位移；中间只插 1 帧拖影卡） | 2 | 2 | 2 | 2 |
| **顿帧 hitstop**（双方冻结，仅震屏与特效走） | 3 | 6 | 4 | 12 |
| 受击方反应（切受击卡 + 白闪 2 帧 + 击退位移 + 纸面褶皱） | 8 | 12 | 6 | 20 |
| 收招 | 8 | 10 | 4 | 14 |

- 中间帧不补画，靠卡片的程序化变形撑起来：沿运动方向的切变（skew）、挤压拉伸、绕底边铰链的前后摆。
- 受击方才是打击感的主体：白闪（材质 uniform）、击退后弹簧回位、顶点噪声做的「纸被打皱」、撕纸屑粒子；重伤加一道撕裂贴花，致命伤整张卡片裂成两半再合拢。
- 化解三通道各有专属反馈：卸力 = 火星纸屑 + 短顿帧 2；闪避 = 残影卡；拆招 = 兵器卡互相弹开。
- 追击：后续每击的预备帧数递减（4→3→2…），6 连击越打越快；连环奇击全程镜头微推。
- 相机：命中时沿打击方向位移震动（幅度按重伤程度 2/4/8px），摧破终结 0.25× 慢放 12 帧 + 轻微推近。
- 施展条：功法施展中在人物头顶用一条纸带逐渐卷起表示进度，对方 AI 与玩家都看得到——这是走位博弈的信息来源。

**特效**（`Fx.ts`）：全部是纸片粒子与贴花——弧形刀光卡、戳刺线、冲击环、纸屑、墨点式的内伤暗纹；按式的 16 种类型归并为 6 种轨迹模板 + 颜色区分。

**HUD（DOM）**：双方伤势人形图（7 部位内/外伤 + 点穴破绽层数）、守御条、提气/架势双环、式槽、轮盘、移动力点、专注条、功法栏（可施展高亮、距离不足标红）、距离刻度。键位沿用通用习惯：A/D 微调、Q/E 大步、空格暂停、数字键施展。

**与逻辑的接口**：`CombatScene` 只消费 `CombatEvent[]`（`attackStart / hit / dodge / changeMove / chase / techniqueCastStart / techniqueStage / guardBroken / counter / wound / flee / end`），每个事件带逻辑帧号与表现时长；`PoseTimeline` 把它们排成时间轴播放。
---

## 5. 战斗系统详细设计

本节是 M1 的施工图。所有公式先写原式、再写取整与边界；实现放在 `src/core/combat/`，每条公式在 `tests/combat/` 里有对应黄金用例（§5.14）。

### 5.1 总览

战斗是**一维距离轴上的半即时对决**。时间单位是帧（60 帧/秒），双方各自跑着几条并行的进度条：

| 进度条 | 满值 | 每帧增量 | 满了之后 | 来源 |
| --- | --- | --- | --- | --- |
| 攻击进度 | `攻击间隔`（帧） | 1（距离在武器范围内才涨） | 发起一轮普攻 | 旧/攻击间隔 |
| 移动进度 | 15000 | 移动速度 × 100 | 走一步 `移动距离` | 旧/移动 |
| 提气 → 架势 | 各 30000 | 100 × 速度系数（先提气后架势） | 可施展摧破/护体 | 旧/提气架势 |
| 施展进度 | 最大施展时间 ÷ 施展速度（帧） | 1 | 功法出手并结算 | 旧/施展时间 |
| 换兵器冷却 | 60000 | (550 − 重量×50) × 兵器切换 | 可再次切换 | 旧/切换兵器 |
| 白移动力 | 3 点 | 每 150 帧 +1 | — | 旧/移动 |
| 逃跑计时 | 600 − 移速×100（≥200）帧 | 1（仅在距离 9.0） | 逃跑成功 | 旧/逃跑 |

**核心循环**：普攻（自动）→ 命中则获得「式」→ 攒够式 + 提气架势双满 → 施展摧破 → 对方以化解、守御、护体绝技应对 → 伤口累积到战败条件。距离是贯穿全程的博弈轴：武器只在自己的距离段内攒攻击进度，摧破出手瞬间不在距离内就是 0 成。

**关键规则：普攻和功法动画期间，双方全部计时器暂停**（来源：旧/战斗）。这让表现层的 hitstop、慢镜头可以任意加长而不影响数值平衡——逻辑只认「帧」，动画锁期间逻辑帧不前进。

### 5.2 状态机

**战斗级（`CombatState.phase`）**

```
Prepare ──双方定策略、用物──▶ Opening ──先后手结算──▶ Running ◀──▶ Paused（玩家空格）
                                                        │  ▲
                              普攻/功法出手 ────────────▼  │ 动画播完
                                                     AnimLock
                                                        │
                              触发变招 ─────────────▶ ChoiceWindow ──选定/超时──▶ AnimLock
Running ──任一方达成战败条件 / 逃跑成功 / 战斗类型特殊条件──▶ Ended(result)
```

- `Prepare`：机略、策略、战前用物（旧/战前准备、旧/机略）。M1 只做「起始距离 3.0 / 8.0」与「先后手」两项，其余策略 M2 补。
- `Opening`：剩余机略多者先手。先手：移动力 3、提气架势 80%；后手：移动力 1、提气架势 50%。守御初值 = 上限 × 50%。
- `AnimLock`：`animLock` 帧数由本次出手的表现时长决定（数据里给，见 §4.4），期间 `frame` 不自增。
- `ChoiceWindow`：变招选择窗口，有持续时间，超时 = 不变招。AI 立即决定。

**人物级（并行子状态，互不阻塞除非标注）**

| 轨道 | 状态 | 说明 |
| --- | --- | --- |
| 攻击 | `outOfRange` / `charging` / `striking` | 换兵器时进度清零 |
| 移动 | `idle` / `moving` | 目标距离 ≠ 当前距离时 moving |
| 施展 | `none` / `casting(skillId, progress)` | casting 期间**禁止移动、普攻、其他施展**，不回提气架势 |
| 护体 | `off` / `active(skillId, remain)` | active 期间移速与移动距离减半、不回提气架势，但仍可施展 |
| 逃跑 | `none` / `fleeing(progress)` | 距离离开 9.0 即清零；距离到 2.0 则失败 |

### 5.3 帧循环

```ts
// src/core/combat/CombatSim.ts
export function step(s: CombatState, cmds: CombatAction[]): CombatEvent[] {
  applyCommands(s, cmds);                    // 改目标距离 / 施展 / 换兵器 / 变招选择 / 暂停
  if (s.phase === 'paused' || s.phase === 'ended') return drain(s);
  if (s.phase === 'choice') return tickChoiceWindow(s);
  if (s.animLock > 0) { s.animLock--; return drain(s); }   // 动画期间一切计时器暂停

  s.frame++;
  for (const f of initiativeOrder(s)) {      // 先手方先结算，同帧冲突由此定序
    tickEffects(s, f);                       // 持续效果、毒发、身法移动力每 100 帧衰减 1
    tickMobility(f);                         // 白移动力每 150 帧 +1（上限 3；有身法移动力时不涨）
    tickMovement(s, f);                      // §5.5
    tickFlee(s, f);
    tickWeaponSwitch(f);
    if (f.cast) tickCast(s, f);              // 进度满 → resolveTechnique() → 设 animLock
    else {
      if (!f.guardSkill) tickBreathStance(f);// §5.4
      tickAttack(s, f);                      // 进度满 → resolveAttackRound() → 设 animLock
    }
    tickGuardSkill(f);
    if (s.animLock > 0) break;               // 本帧已有人出手，其余人下一逻辑帧再走
  }
  tickTeam(s);                               // §5.11
  tickAI(s);                                 // §5.13：AI 只发 Command，下帧生效
  checkEnd(s);
  return drain(s);
}
```

要点：

- 一轮普攻（含追击、变招、反击）在逻辑上**同帧瞬时结算**，结果以带时间偏移的事件序列发给表现层，`animLock` = 序列总时长。这样回放只需要 `(seed, commands[])`。
- 所有除法结果按 wiki 标注取整（`ceil`/`floor`）；伤势链路每一步向下取整到 0.1%，最低 1%（来源：旧/伤害结算流程）。
- 确定性：同帧内人物遍历顺序固定，随机数调用顺序固定，禁止用 `Math.random`、`Date.now`。

### 5.4 资源

**提气 / 架势**（来源：旧/提气架势、旧/功法消耗）
- 两槽各 30000，每帧回复 `100 × 速度`，先满提气再回架势。
- `速度 = (基础 + 附加) × 特效 × 专注加成 × 点穴影响`；专注每 10 点 +1%（上限 +100%）；胸背点穴每层 −5% 提气速度，腰腹点穴每层 −5% 架势速度。
- 施展中、护体绝技持续中不回复。
- **两槽同时为满**才能施展摧破或护体绝技（个别功法特效可解除此限制）。
- `最终消耗 = 30000 × 消耗比例总和 × 功法伤害比例 × (提气或架势消耗属性 − 内功特效减免)`，消耗属性下限 10%。常规摧破提气+架势合计 100%，部分兵器流派 60%；护体 60/80/100%。
- 身法只耗移动力（= 占格数）；腿法耗提气架势 + 移动力、不耗式；暗器/御射/符咒额外耗武器耐久。

**式**（来源：旧/招式）
- 16 种常规式 + 3 种特殊（无 / 万能 / 杀）。每把武器有 6 格轮盘（武器类型决定式的集合，顺序随机）。
- 一轮攻击（含追击）只要有一下命中就得 1 个当前轮盘式，至多 1 个；每次变招成功另得所选部位对应的式；队友命中、反击命中也各得 1 个。
- 只有与当前武器轮盘匹配的式可用，其余置灰。头颈变招成功使对方随机丢 3 个式。
- 式槽容量 **[待核实]**，暂按 9 实现并做成配置项。

| 式 | 命中通道 | 部位权重 胸背/腰腹/头颈/左臂/右臂/左腿/右腿 | 可变招 |
| --- | --- | --- | --- |
| 掷 | 力道 | 65/25/1/5/5/5/5 | 是 |
| 劈 | 力道 | 70/15/1/10/10/5/5 | 是 |
| 崩 | 力道 | 55/35/1/5/5/5/5 | 是 |
| 弹 | 迅疾 | 45/35/1/10/10/10/10 | 是 |
| 刺 | 迅疾 | 40/30/1/20/20/10/10 | 是 |
| 点 | 迅疾 | 40/30/1/15/15/15/15 | 是 |
| 缠 | 迅疾 | 25/15/1/30/30/30/30 | 是 |
| 机 | 迅疾 | 50/30/1/10/10/10/10 | 是 |
| 御 | 精妙 | 30/20/1/30/30/20/20 | 是 |
| 撩 | 精妙 | 25/25/1/25/25/25/25 | 是 |
| 拿 | 精妙 | 25/20/1/35/35/20/20 | 是 |
| 扫 | 精妙 | 25/15/1/30/30/30/30 | 是 |
| 音 | 内息 | 固定心神 | 否 |
| 咒 | 精妙 | 固定心神 | 否 |
| 药 | 精妙 | 固定毒质 | 否 |
| 毒 | 迅疾 | 固定毒质 | 否 |

**移动力**：白移动力上限 3，每 150 帧 +1；身法给「身法移动力」（上限 6，每 100 帧衰减 1，存在期间白移动力不涨）。没有移动力时移动效率 50%（速度和距离各打五折，合计 25%）。

**守御**（来源：旧/守御）
- `最大守御 = [(护体 + 御气) / 2 + 30] × 守御效率`，上限 5000；开场为上限的 50%。
- `对守御伤害 = 伤势 × 距离系数 × 1000`；距离系数：d ≤ 3.0 → 1，3.0 < d ≤ 5.0 → 0.65，d > 5.0 → 0.35。在通用伤害调整**之前**计算。
- 守御未破时伤势被完全吸收（流程在此终止）；守御尽破后护体、御气各 −40%（护体绝技持续期间恢复）。毒发与心神性内伤无视守御。

**专注**（来源：旧/专注）
- 上限 1000。每损失 1% 守御 +5；每受到 `战败条件 × 1%` 的内/外伤 +5，不足则 +1。倍率：死斗 ×1，切磋/接招 ×2，恶战 ×1.33。
- 效果：每 10 点 +1% 提气架势速度；AI 在专注 ≥ 500 时切换到「灵活」行为档（§5.13）。

### 5.5 距离与移动

- 距离 `d ∈ [2.0, 9.0]`，精度 0.1。
- 玩家输入只改**目标距离**：±0.1（A/D）或 ±0.5（Q/E）。
- 每帧 `移动进度 += 移动速度 × 100 × 移动效率`；满 15000 则 `d` 向目标移动 `min(移动距离 × 移动效率, |目标 − d|)`，消耗 1 点移动力（有则消耗）。即一步耗时 `150 ÷ 移动速度` 帧。
- 护体绝技持续中移速与移动距离减半；左腿破绽每层 −5% 移动距离，右腿点穴每层 −5% 移动速度。
- 双方同时移动时各自独立结算，`d` 取两者位移的代数和后再夹到 [2.0, 9.0]。
- **逃跑**：`d = 9.0` 时计时，需 `max(200, 600 − 移速×100)` 帧；`d` 变为 2.0 则逃跑失败。敌方逃跑意愿与勇壮负相关。

### 5.6 普攻回合

```
tickAttack: 若 武器距离下限 ≤ d ≤ 上限 → 攻击进度++；进度 ≥ 攻击间隔 → resolveAttackRound()
```

**攻击间隔**（来源：旧/攻击间隔、旧/攻击速度）

```
基础攻击间隔 = {极快 3000 | 较快 4500 | 普通 6000 | 较慢 7500 | 极慢 9000} + 武器重量 × 100
攻击间隔(帧) = ceil( 基础攻击间隔 / floor(30 + 60 × 攻击速度) )
攻击速度     = 基础 × 难度系数 × 调整 × (1 − 右臂点穴层数 × 5%)
```
例：普通速、重量 3、攻击速度 100% → ceil(6300 / 90) = 70 帧。

**resolveAttackRound(attacker, defender)**

```
1. 连环奇击判定（仅回合首击；反击/追击不触发）：
     内息优势 = (我方内息 − 敌方内息 ≥ 100) ? min(250, 100 + 内息差/20) : 40
     触发率   = floor(内息优势 / 10) %          → 触发则本回合固定 6 击、普攻威力 300%
2. hitIndex = 0；循环：
   a. 取轮盘当前式 → 命中通道、部位权重
   b. 变招检查（式可变招时，PRD）：
        变招值 += 武器变招系数；r = randInt(0, 799)；r < 变招值 → 进入变招，变招值 = 0
   c. 定部位：未变招按权重抽；变招按所选部位（成功率见下表，基础值 ±20% 随机）
        变招成功 → 改打所选部位、无视护甲（破甲倍率按 1）、获得该部位上的式
        变招失败 → 视为在原部位被化解
   d. 命中判定：p = clamp( 0.5 × (命中 + 我方队伍平均福缘) / (化解 + 敌方队伍平均福缘), 5%, 100% )
   e. 命中 → 重伤程度 = (命中 ≥ 化解 × 2) ? 重伤(2) : 轻伤(1)；走 §5.9 伤害链；roundHit = true
      未中 → 若防守方护体绝技带反击、通道匹配、d 在反击范围内、且本式不是「音」→ 反击（§5.10），并中断追击
   f. 追击判定（连环奇击时跳过，直接打满 6 击）：
        n = 已追击次数；p = 追击系数 × (200 − 10n − 5n²) / 100 %；最多追击 5 次（共 6 击）
        追击系数 ≥ 125 时 6 连击必成。被化解不打断追击。
3. 回合结束：roundHit → 获得 1 个当前轮盘式；轮盘指针前进；攻击进度清零；
   animLock = 表现时长（按击数查表）。
```

**变招部位表**（来源：旧/变招）

| 部位 | 基础成功率 | 成功附带效果 |
| --- | --- | --- |
| 胸背 | 75% | 对方提气进度 −20% |
| 腰腹 | 75% | 对方架势进度 −20% |
| 头颈 | 25% | 对方随机丢失 3 个式 |
| 左臂 / 右臂 | 50% | 对方剩余攻击时间 ×1.5 |
| 左腿 / 右腿 | 50% | 对方移动进度 −20% |

自动变招（AI 与玩家托管）优先级：有破绽的部位 → 有点穴的部位 → 随机。

### 5.7 摧破（主动攻击功法）

**施展条件**：提气、架势双满；持有功法要求的式（种类与数量由功法数据给出，置灰的式不算）；非施展中。腿法以移动力代替式。

**施展时间**：`帧数 = 最大施展时间 ÷ 施展速度`，`施展速度 = 面板施展速度% − 头颈点穴层数 × 5%`。施展期间不能移动、普攻、取消；被打断不返还已消耗的式与提气架势。

**出手结算 resolveTechnique()**

```
0. 距离检查：d 不在功法距离段内（= 武器距离 ± x；腿法用自身绝对距离）→ 0 成，直接结束
1. 命中面板（每个通道分别算）：
     面板命中 = (功法基础命中 × 功法发挥度 × 功法威力 + 人物命中补正) × 对应命中发挥度
     实战命中 = 面板命中 × 武器的功法发挥
2. 四段判定。功法的 10 成按 迅疾/精妙/力道 分配（如 3/3/4）：
     第 1~3 段：依次用 迅疾、精妙、力道 的实战命中对敌方 闪避、拆招、卸力 做命中判定
                （概率式同 §5.6-d [待核实：wiki 只写「判断是否命中」]）
                命中则该段成数计入「发挥成数」，并在该段造成一处伤口：
                   段成数 1–4 → 轻伤(1)；5–9 → 重伤(2)；10 → 致命(3)
     第 4 段（终结）：发挥成数 = 已命中各段成数之和；重伤程度按总成数同表判定；
                功法命中比例 = 发挥成数 / 10
3. 每处伤口的伤势走 §5.9 功法分支；部位按功法的部位分布抽取
4. 触发「发挥 N 成后」类特效；敌方 AI 的战斗记忆记录本功法发挥成数
5. 扣提气架势与式；animLock = 功法表现时长
```
例（来源：旧/重伤程度）：力道 1 成、其余 9 成集中一项、全打四肢（伤口基础值 40）。漏掉力道那 1 成：`2 × (0.9 + 0.9) × 40 = 144`；全中：`(1×0.1 + 2×0.9 + 3×1) × 40 = 196`。所以成数集中的功法收益远高于均匀分布，这是内容设计时的重要杠杆。

### 5.8 命中与化解三通道

| 命中 | 化解 | 主属性联动 | 点穴/破绽每层 −5% |
| --- | --- | --- | --- |
| 力道 | 卸力 | 膂力 > 50 每点 +1 | 腰腹破绽 → 力道；胸背破绽 → 卸力 |
| 迅疾 | 闪避 | 灵敏（同理） | 右腿破绽 → 迅疾；左腿破绽 → 闪避 |
| 精妙 | 拆招 | 定力（同理） | 右臂破绽 → 精妙；左臂破绽 → 拆招 |
| 内息（仅「音」式） | — | 内息紊乱分档影响全属性发挥 | 头颈破绽 → 内息 |

```
化解 = [ (特性 + 丹药 + 装备 + 运功) × (基础% + 特性% + 食物% + 运功%)
         × (1 + 技艺加成 + 武器特效) × (1 + 护体绝技%) + 护体绝技固定值 ] × 破绽影响 + 队友化解
```
（来源：旧/命中与化解）命中侧结构对称。实现上用统一的 `StatStack { flat[], pctAdd[], mult[], flatAfter[] }`，每个来源带 `sourceId`，公式检查器可逐项展开。

内息紊乱对全属性发挥：0–199 +20%；200–399 −20%；400–599 −30%；600–799 −50%；800 −80%（来源：旧/内息）。

### 5.9 伤害公式（完整链路）

单位是**伤势（伤病程度，%）**。每一步结果向下取整到 0.1%，最低 1%。

**(1) 内伤比例**（来源：旧/内伤比例），夹到 [0, 100]

```
转化难度 = 内功发挥 > 0 且 基础 < 50 → 1 + (50 − 基础)/50
          内功发挥 ≤ 0 且 基础 > 50 → 1 + (基础 − 50)/50
          否则 1
武器内伤比例 = 武器基础内伤比例 + 人物内功发挥 × 武器内功发挥转化系数 / 转化难度
功法内功比例 = 功法基础内功比例 + 内功发挥 / 转化难度
普攻内伤比例 = 武器内伤比例
功法内伤比例 = (武器内伤比例 + 功法内功比例) / 2
```

**(2) 破甲倍率**（来源：旧/破甲；变招成功时两者都按 1）

```
外伤破甲倍率 = 破甲 ≤ 坚韧 ? 0.5  : 0.5  + 0.5  × (破甲 − 坚韧) / 破甲
内伤破甲倍率 = 破甲 ≤ 坚韧 ? 0.75 : 0.75 + 0.25 × (破甲 − 坚韧) / 破甲
破甲 = 坚韧 = 0 → 1
```

**(3) 破体 / 破气倍率**（来源：旧/破体破气）。破体对护体算外伤倍率，破气对御气算内伤倍率，式子相同：

```
武器破体破气 = (武器基础值 × 武器使用效率 + 人物基础值) × (人物强度 + 摧破真气百分比) + 摧破真气固定值
功法破体破气 = (功法基础值 × 功法威力 × 功法发挥效率 + 人物基础值) × (人物强度 + 摧破真气百分比) + 摧破真气固定值
               （NPC 再乘难度系数；随后按内伤比例偏离基础值的幅度在破体↔破气之间转化）

攻方值 = (100 + 武器破体破气 + 功法破体破气) × (攻方精纯 > 守方 ? 1 + 精纯差 × 0.5 : 1)   // 普攻无功法项
守方值 = (100 + 人物护体御气)                × (守方精纯 > 攻方 ? 1 + 精纯差 × 0.2 : 1)

穿透系数 = 攻方值 ≤ 守方值                           → 1.2
          攻方值 > 守方值 且 (内伤比例 > 0.8 或 < 0.2) → 0.4
          攻方值 > 守方值 且 0.2 ≤ 内伤比例 ≤ 0.8      → 1 − |内伤比例 − 0.5| × 1.2
          普攻且攻方值 > 守方值                        → 上述结果再 × 0.5

倍率 = 1 + (攻方值 − 守方值) / 守方值 × 穿透系数
       普攻、反震：夹到 [0.1, 2]；功法：夹到 [0.1, 3]（个别功法特效可改上限）
```

**(4) 常规伤害 → 通用伤害**

```
普攻：
  外伤 = 武器基伤 × (1 − 武器内伤比例) × 外伤破甲倍率 × 造成外伤 × 破体倍率 × 普攻威力
  内伤 = 武器基伤 ×      武器内伤比例  × 内伤破甲倍率 × 造成内伤 × 破气倍率 × 普攻威力
  普攻威力：常规 100%；连环奇击 300%；反击 = 护体绝技的反击威力（160%–600%）

功法（外伤支，内伤支把 (1−比例)→比例、破体→破气、造成外伤→造成内伤）：
  外伤 = [功法基伤 × (1 − 功法内伤比例) + 武器基伤 × (1 − 武器内伤比例)]
         × 外伤破甲倍率 × 造成外伤 × 功法伤害调整
         × (敌方护命类特效 ? 50% : 1)
         × 破体倍率 × 功法命中比例
  （旧/伤害计算 给的等价简式：(武器基伤 + 功法基伤) × 功法伤害调整 × (武器外伤比例 + 功法外伤比例)/2 × …
    两页写法在两比例不等时有出入，实现以 旧/伤害结算流程 为准，简式做交叉校验。[待核实]）
```
- `造成外伤 / 造成内伤 = 人物基础(一般 100%) + 特性 + 战斗效果 + 运功 + 装备`。
- `功法伤害调整`：加法叠加，如腿法鞋子加成 `+⌈10 + (坚韧 + 破刃)/0.75⌉%`、内功属性克制 ±30%。

**(5) 通用伤害阶段**

```
a. 结算守御：对守御伤害 = 伤势 × 距离系数 × 1000；守御未破 → 吸收，流程终止
b. × 通用伤害调整（内部加算、外部连乘，下限 20%）
     目标部位每层点穴 +10% 内伤、每层破绽 +10% 外伤；武器篆刻等另计
c. × 摧破心法伤害调整
d. 绝技反震（§5.10）
e. 转为直接伤害；按 §5.4 给受击方加专注
```

**(6) 直接伤害阶段**

```
a. × 直接伤害调整（连乘）
b. 改变该部位伤病程度（内伤、外伤分开累计）
c. 产生伤口：伤害值 = 伤势 × 重伤程度(1/2/3) × 伤口基础值
```
伤口基础值（轻伤）：胸背 60、腰腹 60、头颈 100、四肢 40、心神 40、毒质 40、全身 80。
`总伤害 = Σ 各伤口 伤势 × 重伤程度 × 伤口基础值`。

**真实伤害**（心法特效、毒发）跳过 (1)–(5)，直接进入 (6)。

**战败条件**：内伤或外伤累计达到上限的 100%（死斗）/ 75%（恶战）/ 50%（切磋、接招）。

### 5.10 防守反攻

**护体绝技**（来源：旧/护体绝技）：主动施展，提气架势双满；持续期间提供化解加成和/或护体御气，移速与移动距离减半，不回提气架势。

**反击**（来源：旧/反击）：防守方的护体绝技带反击、以指定通道化解了一次普攻、且 `d` 在反击范围内 → 立刻反击一次。反击按「带威力的普攻」结算（威力 160%–600%），无视武器距离与攻击进度，可变招，不可追击，并中断对方追击；命中得 1 个式。「音」式不会引发反击。

**反震**
- 绝技反震（来源：旧/反震）：需守御已破且在范围内。`反震通用伤害 = 最终伤势 × 反震倍率 × 倍率加成 × 额外破体破气倍率`，倍率 16%–80% 分内/外；反震伤害不可再被反震。
- 常规反震（两个特定特效）：反弹所受常规伤害的 60%（普攻）/ 30%（功法）。

**点穴与破绽**（来源：旧/点穴与破绽）：每部位各上限 10 层。点穴每层该部位受内伤 +10%，破绽每层受外伤 +10%，并附带 §5.8 表与下表的减益（每层 5%）。战前旧伤约每 20% 伤势带 1 层入场。

| 部位 | 点穴削弱 | 破绽削弱 |
| --- | --- | --- |
| 头颈 | 施展速度 | 内息 |
| 胸背 | 提气速度 | 卸力 |
| 腰腹 | 架势速度 | 力道 |
| 左臂 | 武器切换 | 拆招 |
| 右臂 | 攻击速度 | 精妙 |
| 左腿 | 移动距离 | 闪避 |
| 右腿 | 移动速度 | 迅疾 |

### 5.11 队友

最多 4 名队友（来源：旧/队伍）。M1 不做，M2 接入：

- **出手相助**：进度条 7500（有对应策略时 5000）。每帧以 `[20 + 勇壮(助攻) 或 坚毅(助守)]%` 的概率推进 `(好感/1000) × (20 + 20 × 剑或盾数) / 100`。助攻只在主将攻击进度处于 20%–80% 时出手。
- **协助摧破 / 协助防御**：进度 15000，速度 `好感/1000`；加成 = 队友对应属性之和 × 每点剑/盾 10%。
- 队友命中为自己得式（式的种类看队友的武器）。危险撤退阈值 `[50 + 坚毅]%`（上限 80%）。

### 5.12 功法特效解释器

功法「心法正练 / 逆练」特效千变万化，不能逐个写死。做成**触发器 + 条件 + 操作**的小型 DSL（数据结构见 §3.3 `EffectSpec`）：

- 触发器：`onAttackHit` `onAttackDodged` `onChangeMoveSuccess` `onTechniqueCast` `onTechniqueResolved(成数)` `onGuardBroken` `onCounter` `onWound` `everyNFrames` `onStanceGained` …
- 条件：距离段、部位有无点穴/破绽、成数 ≥ N、式数量比较、内息分档…
- 操作：改 `StatStack`（带持续帧数）、加点穴/破绽、给/夺式、改进度条、造成真实伤害、改倍率上限、解除双满限制…

M1 手写 12 个覆盖面最大的操作；M2 用 `tools/pipeline` 统计 wiki 特效描述里的句式频次，按频次补到覆盖 80% 以上，剩余的长尾特效在数据里标 `unsupported` 并在功法面板明示。

### 5.13 AI

wiki 没有专门的战斗 AI 页，只有零散事实：难度越高 AI 可用的行动越多（最低档不逃跑、不疗伤、不用护体绝技）；专注 ≥ 500 行为更灵活；AI 有战斗记忆；自动变招有固定优先级。以下是本项目自己的设计，以这些事实为约束。

**结构：效用评估 + 少量硬规则**，每 `thinkInterval` 帧（按难度 30 / 20 / 10 / 6）思考一次，输出与玩家相同的 `CombatAction`，不作弊、不读玩家输入。

```
感知（只读 CombatState 公开部分 + 自己的 CombatMemory）
  → 候选行动：设目标距离 d* / 施展某摧破 / 开护体 / 用身法 / 换兵器 / 逃跑 / 待机
  → 每个候选打分 U = Σ wᵢ × 特征ᵢ（权重由性格与难度给）
  → 选最高分；差距 < ε 时沿用上次决定（防抖）
```

**距离决策（最重要）**
- 为自己每把武器、每个可用摧破预计算「期望每帧伤势」随距离的曲线 `E_self(d)`；从记忆里的「在各距离挨了多少打」估 `E_enemy(d)`。
- `d* = argmax_d [E_self(d) − k × E_enemy(d)]`，`k` 由性格给：勇壮高则小（爱对攻），冷静高则大（爱风筝）。
- 没有移动力时移动代价乘 4（因为效率只有 25%），避免无谓抖动。

**摧破施展**：双满 + 式够 + 预测「施展完成时 `d` 仍在范围内」的概率 ≥ 阈值（用对方移速和当前目标趋势估）。优先打有点穴/破绽的部位分布、优先成数集中的功法。

**防守反应**（对应 wiki「战斗记忆」）：玩家开始施展摧破时，若 `专注 ≥ 500` **或** 记忆里该功法曾打出 ≥ 5 成 → 触发反应：
1. 能在对方施展完成前走出其距离段（`所需帧数 < 对方剩余施展帧数`）→ 走位；
2. 否则若双满且有护体绝技 → 开护体；
3. 否则若有可用身法 → 用身法。
专注 < 500 且无记忆时不反应——这正是原版「前期好打、越打越精」的手感来源。

**变招**：按「破绽 → 点穴 → 随机」；难度最高档改为期望收益最大（成功率 × 该部位伤口系数与附带效果的估值）。

**逃跑**：伤势达到战败条件的 `(40 + 勇壮权重)%` 且非死斗 → 目标距离设为 9.0；最低难度禁用。

**难度档**：`{ thinkInterval, 可用行动集合, 预测步数, 随机扰动 σ }`，另有 wiki 给出的属性系数表（最低档攻速 50%、移速 75%、命中/破体破气/化解/护体御气各 50%；标准档全 100%；更高档见 旧/世界细节，M2 录入）。

**验收**：无头模式下 AI 对 AI 各跑 1000 场，检查同装备镜像对局胜率 50% ± 3%，高难度对低难度胜率 > 80%，平均时长落在 40–120 秒。

### 5.14 验证方法

- **黄金用例**：从 wiki 的算例（如 §5.7 的 144/196、§5.6 的攻击间隔、旧/施展时间 的 220 ÷ 2.2 = 100 帧、追击系数 125 必出 6 连）整理成 `tests/combat/golden/*.json`，每条公式至少 3 例。
- **确定性**：同 `(seed, commands)` 跑两遍，逐帧比对状态哈希。
- **公式检查器**（`dev/FormulaInspector`）：点任意一次伤害，展开 §5.9 每一步的输入、输出、来源项。这是对照原作调数值的主要工具。
- **回放**：战斗结束可导出 `(seed, commands)`，用于复现 bug。
---

## 6. 开发路线图

工期按「一名主程会话 + 若干子会话并行」估算，单位是自然周；每个里程碑有可演示的验收物。

### M1 战斗原型（4 周）

**目标**：一场 1v1 能从开打到分胜负，数值对得上 wiki，打起来有手感。

| 周 | 交付 |
| --- | --- |
| 1 | 工程骨架（Vite + TS + vitest + ESLint 分层规则）；`Clock`、`rng`、`EventBus`；`CombatState` 与 §5.3 帧循环；距离/移动/攻击间隔/提气架势四条进度条；无头模式能跑 |
| 2 | 普攻回合全流程（式、命中三通道、变招、追击、连环）；§5.9 伤害链全链路；守御、伤口、战败条件；黄金用例 ≥ 40 条 |
| 3 | 摧破四段判定、护体绝技、反击、反震、点穴破绽、专注；特效解释器首批 12 个操作；AI v1（距离决策 + 施展 + 防守反应）；AI 对 AI 批量模拟 |
| 4 | `CombatScene`：`PaperMaterial`、`PaperCard`、姿势时间轴、hitstop、受击反馈、HUD；公式检查器；回放 |

**内容**：手写 1 个体型的灰模剪影（程序生成的色块卡即可）、6 把武器、12 门功法（摧破 6、护体 3、身法 3），直接使用经典版对应功法/武器名称，数值取自 wiki 对应条目。

**验收**：① 黄金用例全绿；② 同种子两次运行状态哈希一致；③ 镜像对局 AI 胜率 50% ± 3%；④ 找 3 个玩过同类游戏的人试玩，「走位躲大招」「攒式放招」两个核心体验能被自发说出来。

### M2 数据管线（3 周）

**目标**：内容不再手写；人物、功法、物品成体系。

- `tools/pipeline`：`extract`（从 `data/wiki/text` 和 `modules/` 解析表格与模板参数）→ `normalize`（落到 §3 的 schema，含数值、结构与经典版原名称）→ `validate`（zod + 交叉引用检查 + 数值范围报告）→ `pack`（合并字符串表与美术图集，输出内容包）。
- 机制表与显示文本分开：`martial-arts.json` 里只有 `id`、数值、特效 DSL；名称与描述在 `strings.zh.json`，从 wiki 数据提取经典版原文案。
- 补齐人物系统：主要属性、资质、七元赋性、派生战斗属性（`core/character/derive.ts`）；功法修习、突破、运功栏、内力与真气分配（`core/martial`）。
- 物品与装备：背包、装备位、耐久、品级；武器的式轮盘、距离段、追击/变招系数。
- 特效 DSL 覆盖率 ≥ 80%（按 wiki 特效句式频次统计）。
- 队友（§5.11）、战前准备全部策略、难度系数表。
- `SaveStore`（IndexedDB，带 schema 版本与迁移）。

**验收**：内容包校验零错误；随机生成 1000 个人物全部能进战斗且无 NaN；任选 20 门功法，面板数值与 wiki 对照表逐项一致。

**第一周的前置工作**（见 §8.2）：`data_ns/` 里的功法、物品、建筑、特性、奇遇原始数据都是数字键 JSON，键→字段的映射模块没有抓到。先用「渲染页 ↔ 原始值」比对把映射表（`tools/pipeline/keymap/*.json`）做出来并写回归测试；功法部分已有一份反推稿可作起点。

### M3 城镇 + 地图（4 周）

- `core/world/time`：月推进、季节、行动力；过月结算框架。
- `TownScene`：13×13 网格、建造/升级/拆除、派工、资源产出与仓储；`PaperBatch` + 铰链动画。
- `WorldMapScene`：纸雕省域地图，点选变色，进入地区。
- `RegionScene`：地格、探索翻起、移动耗行动力、采集、地点进入。
- 场景切换转场、全局存读档、新游戏流程（建人 → 出生地 → 村子）。

**验收**：从新游戏开始，能在村子里盖 5 种建筑、过 12 个月、去两个地区各打一场架再回来，全程 60fps、无存档损坏。

### M4 NPC + 奇遇（4 周）

- NPC 生成（模板 + 姓名库 + 资质分布）、门派归属与身份等级、月度行为模拟（修习、移动、结交、结仇、婚育、衰老死亡——每项先做最简版）。
- 人物关系与好感、互动菜单（交谈、请教、切磋、赠礼、结义等）、立场与处世影响可选项。
- 门派：拜师、贡献、功法传授门槛。
- 奇遇/副本：节点图运行器（事件、抉择、战斗、检定、奖励），先做 3 个模板（清剿、探秘、比武）。
- 新手引导、平衡性首轮调整、移动端适配评估。

**验收**：一局 10 年游戏时间内，世界 NPC 数量稳定不崩、关系网有可感知的变化；3 个奇遇模板可通关。

### 之后（不排期）

世界演化与大事件、更多地区美术变体（用户提到的另一种 2.5D 场景风格可作为个别地区的换皮内容包）、音频、本地化、内容包编辑器。

---

## 7. 素材工单

**总则**
- 美术风格为纸片剪影，可直接参考经典版画面作为造型指导；用 AI 生成时可描述经典版的视觉元素。参考图可用实拍的剪纸、立体书、皮影、纸模照片以及经典版截图。
- 统一风格锚点（每张工单都带这段）：`layered cut-paper diorama, matte cardstock texture, visible paper fibre, clean die-cut edges with thin white rim, flat colour blocks, soft top-left key light, no outlines, no gradients, no text, no watermark, transparent background`。
- 配色：全项目共用一张 24 色卡（主色朱砂、石青、藤黄、墨、月白 + 各自的明暗两阶），出图后统一做一次色彩量化到色卡。
- 交付格式：PNG，透明底，主体四周留 8px 余量；命名 `类别_编号_变体.png`；附一行 JSON 写明锚点（底边中点）与实际高度（米）。
- 验收：剪影在缩到 64px 高时仍可辨认；边缘无半透明脏边；同批次光向一致。
- 生成工具的许可证逐个核对（用户给的工具清单里有非商用条款的，本项目免费非商用可用，但要在 `CREDITS.md` 记录）。

### 7.1 角色剪影（战斗）

| 项 | 规格 |
| --- | --- |
| 数量 | 每体型 22–26 张姿势卡（清单见 §4.4）；M1 先做 1 体型，M2 扩到男女各 2 |
| 尺寸 | 单张 512×768，人物站立高度占 600px；所有姿势脚底中点对齐同一锚点 |
| 画法 | 3–4 层色纸叠出来的剪影：身体主色 1 层、衣摆/袖 1 层、发与配饰 1 层、可选高光 1 层；无五官、无描线 |
| 约束 | 武器不画在人物卡上（单独出）；手部位置在 JSON 里标锚点 |

提示词模板：
```
[风格锚点], full-body side-view martial artist silhouette built from 3 stacked paper layers,
pose: {POSE_DESC}, {BODY_TYPE}, flowing robe with wide sleeves, hair tied up,
faceless, strong readable silhouette, exaggerated line of action, feet on ground line,
empty hands (no weapon), colour: {MAIN_COLOR} body, {ACCENT_COLOR} sash
```
`POSE_DESC` 取值示例：`relaxed guard stance` / `deep wind-up, torso twisted back, weight on rear leg` / `full extension lunge, arm thrust forward, rear leg straight` / `recoiling from a heavy blow, spine arched back, one foot off ground` / `sidestep dodge, body leaning away`。

一致性做法：先出「待机」定稿，再以它为参考图做图生图出其余姿势；出手类姿势要求「预备」与「放」两张的轮廓差异尽量大（这是省帧还能有力度的关键）。

### 7.2 武器与战斗特效

- 武器卡：6 个武器族各 3–5 把，256×256，握持点标锚点。`[风格锚点], single {WEAPON} cut from metallic-finish cardstock, side view, horizontal`。
- 特效卡：弧形刀光 ×3、戳刺线 ×2、冲击环 ×2、纸屑图集（16 片）、撕裂贴花 ×3、内伤暗纹 ×2、残影遮罩。256×256 或 512×256，白色出图，运行时染色。`[风格锚点], {FX_SHAPE} made of torn white paper strips, motion smear, high contrast`。

### 7.3 建筑立牌（城镇）

| 项 | 规格 |
| --- | --- |
| 数量 | M3 首批 20 种建筑 × 2–3 个等级外观；每栋 2–4 张卡（正立面、侧立面、屋顶、招牌） |
| 尺寸 | 正立面 512×512（1 格 = 2m 宽）；侧立面 256×512 |
| 画法 | 正交立面（无透视），以便卡片成 90° 插接时不穿帮；窗洞镂空（alpha），夜间可透光 |

提示词模板：
```
[风格锚点], orthographic front elevation of a small {BUILDING_TYPE} in a traditional
East-Asian mountain village, papercraft model kit piece, {LEVEL_DESC},
cut-out windows and door (transparent), tiled roof as a separate layered strip,
symmetrical, fits a square footprint
```
`LEVEL_DESC`：`humble thatch and timber` / `whitewashed walls and grey tile` / `ornate eaves with hanging lanterns`。
另需：脚手架牌、废墟牌、空地/资源点地块（林、矿、田、水）各 2–3 变体、工人小人牌 4 种。

### 7.4 地图元素

- **大地图**：省域轮廓是矢量数据不是图片（§4.1）；需要的是纸张底纹 4 种（可平铺 1024²）、山脉立牌 6、河流纸条 4、云 5、指南针与边框饰件。`[风格锚点], small mountain range standee, three overlapping paper peaks, top-down-friendly, muted {HUE}`。
- **地区地图**：地形底纸 8–10 种（平原、丘陵、山、林、水、沼、荒漠、雪原…）可平铺 256²；地形立牌每种 3 变体；地点立牌（村、镇、城、关隘、门派驻地、洞窟、古迹）各 2；人物棋子 4。
- 季节变体：底纸与植被立牌出春夏秋冬四套色（优先用运行时调色实现，只有雪景单独出图）。

### 7.5 UI

- 面板底图（九宫格可拉伸的纸张/卷轴）3 种、按钮 3 态、分隔线、图标底板。
- 图标：属性 20、式 19、功法类别 14、物品类别 12、资源 8、状态 16。64×64，单色剪纸风，运行时染色。`[风格锚点], minimalist paper-cut icon of {SUBJECT}, single colour, centred, bold shape, 64px readable`。
- 伤势人形图：正面人体剪影分 7 个可单独着色的部位（矢量 SVG，手绘或由工单出图后描摹）。
- 字体：思源宋体 / 霞鹜文楷等开源字体，按字符子集化。

### 7.6 文案与命名（文字工单）

机制表的每个 id 都需要名称与描述，直接从 wiki 数据提取经典版原文案。

- 范围：功法名与特效描述、门派名与简介、物品名、建筑名、地区与地点名、NPC 姓名库。
- 来源：`tools/pipeline` 的 `extract` 阶段从 wiki 数据中提取；`data_ns/` 中的数字键映射完成后可批量导入。
- 对话与奇遇文本：经典版原文案作为占位；缺失的部分用 AI 生成补充，风格对齐经典版。

---

## 8. 风险与备选方案

### 8.1 内容与授权

- **现状**：项目免费、仅供个人学习交流，不上架、不发行。用户会联系原作方获取授权。
- **处理**：现阶段直接使用经典版的名称、文案、数值作为开发内容。wiki 数据用于提取机制公式和原始文本。`data/wiki/` 目录已在 `.gitignore` 中排除，不随仓库分发。
- **架构保障**：内容包可替换架构保留（§1），将来可根据授权情况决定保留或制作替换内容包。
- **对外名称**：暂用 taiwuSimulator。
- **备注**：若未取得授权且需公开发布，届时可制作替换内容包换皮；这是将来的事，不影响当前开发。

### 8.2 数据缺口

| 缺口 | 影响 | 处理 |
| --- | --- | --- |
| 物品、建筑、功法的渲染页多为模板空壳；原始数据在 `data_ns/`（撰写本书期间由另一会话补抓，现有 1.3 万余个文件：物品 4442、功法 757、功法特效 1513、建筑 277、特性 289、奇遇 114…），但都是**数字键 JSON，键→字段的映射模块未抓到** | M2 不能直接拿来用 | 用渲染页与原始值比对反推映射（功法已反推出约 60 个键，尚有十余个未解）；解不出的字段用参数化曲线自行设计 |
| 原始值与页面显示值之间存在 ×80 / ×100 的倍率（按品级分档），成因不明 | 伤害、命中的绝对量级可能整体偏移 | 统一以原始值建表，倍率做成全局常量；用 wiki 算例反推校验 |
| 运功栏结构、真气效果曲线、提气架势速度基础值等没有说明页 | 养成侧若干规则需自定 | 标 [待核实]，先按合理默认实现 |
| 无战斗 AI 页 | §5.13 是自行设计 | 以 AI 对打统计与试玩反馈调参 |
| 摧破分段命中概率式、式槽上限、两页功法伤害式的差异 | 已标 [待核实] | 做成配置项；找到依据后改一处即可 |
| 功法特效为自然语言描述 | DSL 覆盖不全 | 频次统计 + 长尾标 `unsupported` |
| 个别页面渲染失败（如真气效果图表） | 少量数值缺失 | 从 `raw/wikitext` 与 `modules/` 取原始数据 |
| wiki 数据的获取方式 | 站点有访问验证，数据是另一会话通过浏览器窗格抓到的，不是原先记录的「手动导出」路线；且抓取仍在进行（撰写期间目录有变化） | 本执行会话不参与抓取；是否继续、补抓哪些模块（如键映射模块）由用户决定 |

### 8.3 技术风险

| 风险 | 概率/影响 | 对策与备选 |
| --- | --- | --- |
| 剪影 + 少姿势的打击感不达标 | 中 / 高 | M1 第 4 周即验证；备选：给出手姿势加 1 张中间帧；再不行引入 2D 骨骼（Spine 类）仅用于主角体型 |
| AI 生成的姿势卡前后不一致（体型、服饰漂移） | 高 / 中 | 图生图 + 固定参考；剪影风格本身容错高；备选：人工描摹统一，或改为程序拼装的「纸偶」（头/躯干/四肢分片 + 关节铰链，papertrails 的旅人即此做法） |
| papertrails 的翻折系统与其地块生成强耦合，难以直接复用 | 高 / 低 | 只取材质注入、弹簧、相机参数，卡片与批处理自写（已按此设计） |
| `BatchedMesh` 在旧版 three 或个别驱动上的兼容问题 | 低 / 中 | 回退 `InstancedMesh`（每图集一个） |
| 逻辑/表现不同步（动画锁期间状态被改） | 中 / 中 | 一轮出手同帧结算 + 事件序列；`animLock` 期间只收 Command 不执行 |
| 浮点导致回放不一致 | 中 / 中 | 进度条全部用整数；伤势用千分比整数（0.1% = 1）；除法后立即取整 |
| 特效解释器膨胀成第二个战斗系统 | 中 / 高 | 操作数量设上限（40），超出的特效改设计而不是加操作 |
| 范围蔓延（四个里程碑约 15 周，已很满） | 高 / 高 | 每个里程碑只认验收清单；世界演化、主线等一律进「之后」 |
| 移动端性能与操作 | 中 / 中 | M4 才评估；PCSS 阴影与景深做画质档位 |
| 存档兼容 | 中 / 中 | 存档只存 id 与运行期状态；带版本号与迁移函数；内容包 id 一经发布不复用 |

### 8.4 备选技术路线

- **渲染**：若 three.js 路线在战斗表现上遇阻，战斗场景可单独换成 PixiJS（纯 2D）而不动 `core/`——这是三层分离的直接收益。
- **UI**：Preact 若显笨重，可退到无框架的模板字符串 + signals。
- **引擎整体更换（如 Godot 导出 Web）**：不建议。`core/` 是 TS，换引擎等于重写；且包体与加载时间明显变差。
