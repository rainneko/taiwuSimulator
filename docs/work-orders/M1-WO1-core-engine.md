# M1-WO1：核心引擎与战斗状态机

> 工单版本 v1.0 · 2026-11-23
> 前置：无（首个工单）
> 预估：3-5 天
> 验收：无头模式下两个空壳角色能跑完一场战斗帧循环，距离/移动/攻击间隔/提气架势四条进度条正常运转

---

## 1. 工程骨架搭建

### 1.1 初始化项目

```bash
npm create vite@latest . -- --template vanilla-ts
npm i three @types/three
npm i -D vitest @vitest/coverage-v8 eslint typescript
```

### 1.2 目录结构

```
src/
├─ app/              # 入口、场景切换
│  └─ main.ts
├─ core/             # 纯逻辑层（本工单的主战场）
│  ├─ combat/
│  │  ├─ types.ts         # 所有战斗相关类型
│  │  ├─ CombatSim.ts     # 帧循环主函数
│  │  ├─ distance.ts      # 距离与移动
│  │  ├─ attack.ts        # 攻击进度与间隔
│  │  ├─ resource.ts      # 提气/架势/式/守御/专注/移动力
│  │  ├─ wound.ts         # 伤口与战败判定
│  │  └─ ai.ts            # AI（本工单只做骨架）
│  ├─ Clock.ts            # 固定步长时钟
│  ├─ rng.ts              # PCG32 可播种随机数
│  └─ EventBus.ts         # 类型安全事件总线
├─ data/             # 内容包加载（本工单只做 schema）
│  └─ schema/
│     └─ combat.ts        # zod schema
├─ render/           # three.js（本工单不涉及）
├─ ui/               # DOM 覆盖层（本工单不涉及）
└─ dev/              # 开发工具
   └─ headless.ts         # 无头运行器
tests/
└─ combat/
   ├─ clock.test.ts
   ├─ rng.test.ts
   ├─ distance.test.ts
   ├─ attack.test.ts
   ├─ resource.test.ts
   └─ frame-loop.test.ts
```

### 1.3 ESLint 分层规则

```js
// eslint.config.js 关键规则
// core/ 下禁止导入 three、DOM API、render/、ui/
{
  files: ['src/core/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: ['three', 'three/*', '../render/*', '../ui/*', '../../render/*', '../../ui/*'],
    }],
    'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage'],
  }
}
```

### 1.4 tsconfig 要点

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `paths`: `@core/*` → `src/core/*` 等

---

## 2. 基础设施

### 2.1 Clock（`src/core/Clock.ts`）

固定步长时钟，逻辑帧率 60fps，与渲染帧率解耦。

```ts
export class Clock {
  readonly fps = 60;
  readonly dt = 1 / 60;        // 秒
  private accumulator = 0;
  private _frame = 0;

  get frame(): number { return this._frame; }

  /** 外部每帧调用，传入 deltaTime（秒）。返回本次需要执行的逻辑步数 */
  update(realDt: number): number {
    this.accumulator += Math.min(realDt, 0.1); // 防螺旋
    let steps = 0;
    while (this.accumulator >= this.dt) {
      this.accumulator -= this.dt;
      this._frame++;
      steps++;
    }
    return steps;
  }

  /** 插值因子，渲染层用于在两个逻辑帧之间平滑 */
  get alpha(): number { return this.accumulator / this.dt; }

  reset(): void { this.accumulator = 0; this._frame = 0; }
}
```

### 2.2 RNG（`src/core/rng.ts`）

PCG32 可播种随机数生成器。战斗回放只需 `(seed, commands[])` 即可复现。

```ts
export class PCG32 {
  private state: bigint;
  private inc: bigint;

  constructor(seed: bigint, seq: bigint = 1n) {
    this.inc = (seq << 1n) | 1n;
    this.state = 0n;
    this.next();
    this.state += seed;
    this.next();
  }

  /** 返回 [0, 2^32) 的无符号整数 */
  next(): number {
    const old = this.state;
    this.state = (old * 6364136223846793005n + this.inc) & 0xFFFFFFFFFFFFFFFFn;
    const xorShifted = Number(((old >> 18n) ^ old) >> 27n) >>> 0;
    const rot = Number(old >> 59n);
    return ((xorShifted >>> rot) | (xorShifted << ((-rot) & 31))) >>> 0;
  }

  /** [0, max) 整数，无模偏差 */
  randInt(max: number): number {
    const threshold = (0x100000000 - max) % max;
    let r: number;
    do { r = this.next(); } while (r < threshold);
    return r % max;
  }

  /** [0, 1) 浮点数 */
  random(): number { return this.next() / 0x100000000; }

  /** 按权重数组抽一个索引 */
  weightedPick(weights: readonly number[]): number {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.randInt(total);
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  /** 保存/恢复游标（用于存档） */
  save(): { state: string; inc: string } {
    return { state: this.state.toString(), inc: this.inc.toString() };
  }
  static restore(s: { state: string; inc: string }): PCG32 {
    const rng = Object.create(PCG32.prototype);
    rng.state = BigInt(s.state);
    rng.inc = BigInt(s.inc);
    return rng;
  }
}
```

### 2.3 EventBus（`src/core/EventBus.ts`）

类型安全的事件总线，core 层产出事件，render/ui 订阅。

```ts
export type CombatEventMap = {
  attackStart:    { actorId: string; targetId: string; frame: number };
  hit:            { actorId: string; targetId: string; part: BodyPart; severity: 1|2|3; damage: number; channel: HitChannel };
  dodge:          { actorId: string; targetId: string; channel: HitChannel };
  changeMove:     { actorId: string; part: BodyPart; success: boolean };
  chase:          { actorId: string; hitIndex: number };
  techniqueCastStart: { actorId: string; skillId: string; totalFrames: number };
  techniqueStage: { actorId: string; skillId: string; stage: 1|2|3|4; hits: number };
  guardBroken:    { actorId: string };
  counter:        { actorId: string; targetId: string };
  wound:          { actorId: string; part: BodyPart; inner: number; outer: number };
  flee:           { actorId: string; success: boolean };
  end:            { winnerId: string | null; reason: string };
  moveStep:       { actorId: string; from: number; to: number };
  resourceChange: { actorId: string; type: 'breath'|'stance'|'guard'|'focus'; value: number };
  stanceGained:   { actorId: string; stance: StanceType };
};

export class EventBus<T extends Record<string, any>> {
  private listeners = new Map<keyof T, Set<(e: any) => void>>();
  private queue: { type: keyof T; payload: any }[] = [];

  on<K extends keyof T>(type: K, fn: (e: T[K]) => void): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
    return () => this.listeners.get(type)?.delete(fn);
  }

  emit<K extends keyof T>(type: K, payload: T[K]): void {
    this.queue.push({ type, payload });
  }

  drain(): { type: keyof T; payload: any }[] {
    const events = this.queue.slice();
    this.queue.length = 0;
    for (const { type, payload } of events) {
      this.listeners.get(type)?.forEach(fn => fn(payload));
    }
    return events;
  }
}
```

---

## 3. 战斗类型定义（`src/core/combat/types.ts`）

```ts
// === 枚举与常量 ===

export const BODY_PARTS = ['chest', 'waist', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
export type BodyPart = typeof BODY_PARTS[number];
export const SPECIAL_PARTS = ['spirit', 'poison', 'whole'] as const;
export type SpecialPart = typeof SPECIAL_PARTS[number];
export type AnyPart = BodyPart | SpecialPart;

export type HitChannel = 'power' | 'speed' | 'skill'; // 力道/迅疾/精妙
export type DodgeChannel = 'deflect' | 'evade' | 'parry'; // 卸力/闪避/拆招
export const HIT_DODGE_MAP: Record<HitChannel, DodgeChannel> = {
  power: 'deflect', speed: 'evade', skill: 'parry'
};

export type BattleType = 'spar' | 'accept' | 'fierce' | 'deathmatch';
// 切磋50% / 接招50% / 恶战75% / 死斗100%
export const DEFEAT_THRESHOLD: Record<BattleType, number> = {
  spar: 0.5, accept: 0.5, fierce: 0.75, deathmatch: 1.0
};

export type StanceType =
  | 'throw' | 'chop' | 'crash' | 'flick' | 'stab' | 'dot'
  | 'wrap' | 'trick' | 'ward' | 'lift' | 'grab' | 'sweep'
  | 'sound' | 'curse' | 'medicine' | 'venom'
  | 'wild' | 'kill' | 'none';
// 掷/劈/崩/弹/刺/点/缠/机/御/撩/拿/扫/音/咒/药/毒 + 万能/杀/无

export type WeaponClass = 'fist' | 'sword' | 'blade' | 'polearm' | 'exotic' | 'ranged';

export type FighterPhase = 'outOfRange' | 'charging' | 'striking';
export type CastPhase = 'none' | 'casting';
export type GuardPhase = 'off' | 'active';
export type FleePhase = 'none' | 'fleeing';

export type CombatPhase = 'prepare' | 'opening' | 'running' | 'paused' | 'choice' | 'animLock' | 'ended';

// === Fighter State ===

export interface WoundState {
  inner: number;  // 内伤 0-100 (%)
  outer: number;  // 外伤 0-100 (%)
  acupoints: number; // 点穴层数 0-10
  weakness: number;  // 破绽层数 0-10
}

export interface FighterState {
  id: string;
  name: string;

  // 位置
  position: number;         // 当前距离轴上的位置（相对）
  targetDistance: number;    // 玩家设定的目标距离

  // 攻击
  attackProgress: number;   // 0 ~ attackInterval
  attackInterval: number;   // 帧数（由武器速度+攻击速度算出）
  attackPhase: FighterPhase;

  // 移动
  moveProgress: number;     // 0 ~ 15000
  moveSpeed: number;        // 基础移动速度
  moveDistance: number;      // 每步移动距离
  movementPoints: number;   // 白移动力 0-3
  movementPointTimer: number; // 每 150 帧 +1
  bodyMovementPoints: number; // 身法移动力 0-6
  bodyMovementDecay: number;  // 每 100 帧 -1 计时器

  // 资源
  breath: number;           // 提气 0-30000
  stance: number;           // 架势 0-30000
  breathStanceSpeed: number; // 基础回复速度
  stances: StanceType[];    // 已获得的式
  stanceSlotCapacity: number; // 式槽容量（配置项，默认9）
  wheelSlots: StanceType[]; // 武器轮盘 6 格
  wheelIndex: number;       // 当前轮盘指针

  // 守御
  guard: number;            // 当前守御值
  guardMax: number;         // 最大守御值 (上限5000)

  // 专注
  focus: number;            // 0-1000

  // 伤口 (7 个部位)
  wounds: Record<BodyPart, WoundState>;
  totalInner: number;       // 总内伤 %
  totalOuter: number;       // 总外伤 %

  // 施展
  castPhase: CastPhase;
  castSkillId: string | null;
  castProgress: number;
  castTotal: number;

  // 护体
  guardSkillPhase: GuardPhase;
  guardSkillId: string | null;
  guardSkillRemain: number;

  // 逃跑
  fleePhase: FleePhase;
  fleeProgress: number;
  fleeThreshold: number;    // 需要的帧数

  // 武器
  weaponId: string;
  weaponClass: WeaponClass;
  weaponRangeMin: number;   // 武器最小距离
  weaponRangeMax: number;   // 武器最大距离
  weaponSwitchCooldown: number;

  // 属性（简化版，M1 用固定值）
  stats: FighterStats;

  // 先手标记
  isFirst: boolean;
}

export interface FighterStats {
  attackSpeed: number;      // 攻击速度 %
  hitPower: number;         // 力道命中
  hitSpeed: number;         // 迅疾命中
  hitSkill: number;         // 精妙命中
  dodgeDeflect: number;     // 卸力化解
  dodgeEvade: number;       // 闪避化解
  dodgeParry: number;       // 拆招化解
  protection: number;       // 护体
  qiControl: number;        // 御气
  guardEfficiency: number;  // 守御效率
  armorToughness: number;   // 坚韧
  armorPenetration: number; // 破甲
  innerDamageRatio: number; // 内伤比例
  dealInner: number;        // 造成内伤 %
  dealOuter: number;        // 造成外伤 %
  luck: number;             // 福缘
  courage: number;          // 勇壮
  chaseCoef: number;        // 追击系数
  changeMoveCoef: number;   // 变招系数
}

// === Combat State ===

export interface CombatState {
  phase: CombatPhase;
  battleType: BattleType;
  frame: number;
  animLock: number;
  choiceWindow: number;     // 变招选择倒计时

  fighters: [FighterState, FighterState]; // [0] = 玩家/先手, [1] = 对手
  distance: number;         // 当前距离 2.0-9.0

  seed: bigint;             // 初始种子
  rng: PCG32;
  events: EventBus<CombatEventMap>;
  commandLog: CombatAction[]; // 用于回放
}

// === Commands ===

export type CombatAction =
  | { type: 'setTargetDistance'; actorId: string; delta: number }   // ±0.1 或 ±0.5
  | { type: 'castTechnique'; actorId: string; skillId: string }
  | { type: 'activateGuardSkill'; actorId: string; skillId: string }
  | { type: 'switchWeapon'; actorId: string; weaponId: string }
  | { type: 'changeMove'; actorId: string; part: BodyPart }        // 变招选择
  | { type: 'pause' }
  | { type: 'resume' };
```

---

## 4. 帧循环（`src/core/combat/CombatSim.ts`）

实现 PLAN.md §5.3 的 `step()` 函数。每次调用推进一个逻辑帧。

```ts
export function step(state: CombatState, commands: CombatAction[]): CombatEvent[] {
  applyCommands(state, commands);

  if (state.phase === 'paused' || state.phase === 'ended') return drain(state);
  if (state.phase === 'choice') return tickChoiceWindow(state);
  if (state.animLock > 0) { state.animLock--; return drain(state); }

  state.frame++;

  // 先手方先结算
  const order = state.fighters[0].isFirst
    ? [state.fighters[0], state.fighters[1]]
    : [state.fighters[1], state.fighters[0]];

  for (const fighter of order) {
    tickMovement(state, fighter);       // §5.5
    tickFlee(state, fighter);
    tickWeaponSwitch(fighter);

    if (fighter.castPhase === 'casting') {
      tickCast(state, fighter);         // 施展进度 → resolveTechnique()
    } else {
      if (fighter.guardSkillPhase !== 'active') {
        tickBreathStance(fighter);      // §5.4 提气/架势回复
      }
      tickAttack(state, fighter);       // 攻击进度 → resolveAttackRound()
    }

    tickGuardSkill(fighter);
    tickMobility(fighter);              // 移动力计时器
    tickFocus(state, fighter);

    if (state.animLock > 0) break;      // 有人出手了，本帧其余人下帧再走
  }

  checkEnd(state);
  return drain(state);
}
```

**关键约束**：
- `step()` 必须是纯函数（除了修改传入的 state）
- 所有随机数必须通过 `state.rng`
- 不允许使用 `Math.random()` 或 `Date.now()`
- 同帧内遍历顺序固定（先手→后手）

---

## 5. 距离与移动（`src/core/combat/distance.ts`）

```ts
export const DISTANCE_MIN = 2.0;
export const DISTANCE_MAX = 9.0;
export const DISTANCE_PRECISION = 0.1;
export const MOVE_PROGRESS_MAX = 15000;
export const MOVE_POINT_INTERVAL = 150;  // 帧
export const MOVE_POINT_MAX = 3;
export const BODY_MOVE_POINT_MAX = 6;
export const BODY_MOVE_DECAY_INTERVAL = 100;

export function tickMovement(state: CombatState, f: FighterState): void {
  // 目标距离与当前距离一致 → 不移动
  const targetDist = f.targetDistance;
  const currentDist = state.distance;
  if (Math.abs(targetDist - currentDist) < 0.001) return;

  // 移动效率：有移动力时 100%，无移动力时 50%（速度和距离各打五折 = 25%）
  // 护体期间移速和距离减半
  const hasPoints = f.movementPoints > 0 || f.bodyMovementPoints > 0;
  const efficiencySpeed = hasPoints ? 1.0 : 0.5;
  const efficiencyDist = hasPoints ? 1.0 : 0.5;
  const guardPenalty = f.guardSkillPhase === 'active' ? 0.5 : 1.0;

  // 点穴影响
  const leftLegWound = f.wounds.leftLeg;
  const rightLegWound = f.wounds.rightLeg;
  const distPenalty = 1 - leftLegWound.weakness * 0.05;
  const speedPenalty = 1 - rightLegWound.acupoints * 0.05;

  const speed = f.moveSpeed * efficiencySpeed * guardPenalty * speedPenalty;
  f.moveProgress += Math.floor(speed * 100);

  if (f.moveProgress >= MOVE_PROGRESS_MAX) {
    f.moveProgress -= MOVE_PROGRESS_MAX;

    const stepDist = f.moveDistance * efficiencyDist * guardPenalty * distPenalty;
    const direction = targetDist > currentDist ? 1 : -1;
    const actual = Math.min(stepDist, Math.abs(targetDist - currentDist));

    const newDist = clamp(currentDist + direction * actual, DISTANCE_MIN, DISTANCE_MAX);
    const oldDist = state.distance;
    state.distance = Math.round(newDist * 10) / 10; // 保持 0.1 精度

    // 消耗移动力
    if (f.bodyMovementPoints > 0) f.bodyMovementPoints--;
    else if (f.movementPoints > 0) f.movementPoints--;

    state.events.emit('moveStep', { actorId: f.id, from: oldDist, to: state.distance });
  }
}

export function tickMobility(f: FighterState): void {
  // 白移动力：每 150 帧 +1，上限 3；有身法移动力时不涨
  if (f.bodyMovementPoints > 0) {
    f.bodyMovementDecay++;
    if (f.bodyMovementDecay >= BODY_MOVE_DECAY_INTERVAL) {
      f.bodyMovementDecay -= BODY_MOVE_DECAY_INTERVAL;
      f.bodyMovementPoints = Math.max(0, f.bodyMovementPoints - 1);
    }
  } else {
    f.movementPointTimer++;
    if (f.movementPointTimer >= MOVE_POINT_INTERVAL) {
      f.movementPointTimer -= MOVE_POINT_INTERVAL;
      f.movementPoints = Math.min(MOVE_POINT_MAX, f.movementPoints + 1);
    }
  }
}
```

---

## 6. 攻击进度（`src/core/combat/attack.ts`）

```ts
export const WEAPON_SPEED_CLASS = { veryFast: 3000, fast: 4500, normal: 6000, slow: 7500, verySlow: 9000 };

export function getAttackInterval(baseSpeed: number, weaponWeight: number, attackSpeedPct: number, acupointsRightArm: number): number {
  const baseInterval = baseSpeed + weaponWeight * 100;
  const speed = Math.floor(30 + 60 * (attackSpeedPct / 100) * (1 - acupointsRightArm * 0.05));
  return Math.ceil(baseInterval / Math.max(1, speed));
}

export function tickAttack(state: CombatState, f: FighterState): void {
  const d = state.distance;
  // 只有在武器距离范围内才攒攻击进度
  if (d >= f.weaponRangeMin && d <= f.weaponRangeMax) {
    f.attackPhase = 'charging';
    f.attackProgress++;
    if (f.attackProgress >= f.attackInterval) {
      f.attackProgress = 0;
      f.attackPhase = 'striking';
      // resolveAttackRound() 在 WO2 中实现，此处先 emit 一个占位事件
      state.animLock = 30; // 占位，WO2 会根据击数动态设置
      state.events.emit('attackStart', {
        actorId: f.id,
        targetId: getOpponent(state, f).id,
        frame: state.frame
      });
    }
  } else {
    f.attackPhase = 'outOfRange';
    // 注意：不清零进度（wiki 未说明清零，只是暂停累加）
  }
}
```

---

## 7. 提气/架势（`src/core/combat/resource.ts`）

```ts
export const RESOURCE_MAX = 30000;
export const RESOURCE_RECOVERY_BASE = 100;

export function tickBreathStance(f: FighterState): void {
  // 施展中、护体中不回复（调用方已判断）
  const speed = getBreathStanceSpeed(f);

  // 先回提气，满了再回架势
  if (f.breath < RESOURCE_MAX) {
    f.breath = Math.min(RESOURCE_MAX, f.breath + speed);
  } else if (f.stance < RESOURCE_MAX) {
    f.stance = Math.min(RESOURCE_MAX, f.stance + speed);
  }
}

export function getBreathStanceSpeed(f: FighterState): number {
  const base = RESOURCE_RECOVERY_BASE;
  // 专注加成：每 10 点 +1%，上限 +100%
  const focusBonus = 1 + Math.min(1, f.focus / 1000);
  // 点穴影响
  const breathPenalty = 1 - f.wounds.chest.acupoints * 0.05; // 胸背点穴
  const stancePenalty = 1 - f.wounds.waist.acupoints * 0.05; // 腰腹点穴
  // 简化：取平均（实际提气和架势各自有不同的点穴影响，WO2 细化）
  const penalty = (breathPenalty + stancePenalty) / 2;

  return Math.floor(base * f.breathStanceSpeed * focusBonus * penalty);
}

export function canCastTechnique(f: FighterState): boolean {
  return f.breath >= RESOURCE_MAX && f.stance >= RESOURCE_MAX;
}
```

---

## 8. 守御与专注骨架

```ts
// resource.ts 续

export function initGuard(f: FighterState): void {
  // 守御上限 = [(护体+御气)/2 + 30] × 守御效率，上限5000
  const raw = Math.floor((f.stats.protection + f.stats.qiControl) / 2 + 30) * (f.stats.guardEfficiency / 100);
  f.guardMax = Math.min(5000, Math.floor(raw));
  f.guard = Math.floor(f.guardMax * 0.5); // 开场 50%
}

export const FOCUS_MAX = 1000;

export function addFocus(f: FighterState, amount: number, battleType: BattleType): void {
  const multiplier = battleType === 'deathmatch' ? 1 : battleType === 'fierce' ? 1.33 : 2;
  f.focus = Math.min(FOCUS_MAX, f.focus + Math.floor(amount * multiplier));
}
```

---

## 9. 战败判定（`src/core/combat/wound.ts`）

```ts
export function checkEnd(state: CombatState): void {
  if (state.phase === 'ended') return;
  const threshold = DEFEAT_THRESHOLD[state.battleType];
  for (const f of state.fighters) {
    if (f.totalInner >= threshold * 100 || f.totalOuter >= threshold * 100) {
      state.phase = 'ended';
      const winner = state.fighters.find(x => x.id !== f.id)!;
      state.events.emit('end', { winnerId: winner.id, reason: 'defeat' });
      return;
    }
  }
}
```

---

## 10. 开场初始化

```ts
export function initCombat(config: CombatConfig): CombatState {
  const rng = new PCG32(config.seed);
  const events = new EventBus<CombatEventMap>();

  // 先后手：机略多者先手（M1 简化为随机）
  const firstIdx = rng.randInt(2);

  const fighters = config.fighters.map((fc, i) => {
    const f = createFighterState(fc, rng);
    f.isFirst = i === firstIdx;
    // 先手：移动力3，提气架势80%
    // 后手：移动力1，提气架势50%
    if (f.isFirst) {
      f.movementPoints = 3;
      f.breath = Math.floor(RESOURCE_MAX * 0.8);
      f.stance = Math.floor(RESOURCE_MAX * 0.8);
    } else {
      f.movementPoints = 1;
      f.breath = Math.floor(RESOURCE_MAX * 0.5);
      f.stance = Math.floor(RESOURCE_MAX * 0.5);
    }
    initGuard(f);
    return f;
  }) as [FighterState, FighterState];

  return {
    phase: 'running', // M1 跳过 prepare
    battleType: config.battleType ?? 'spar',
    frame: 0,
    animLock: 0,
    choiceWindow: 0,
    fighters,
    distance: config.startDistance ?? 5.0,
    seed: config.seed,
    rng,
    events,
    commandLog: [],
  };
}
```

---

## 11. 无头运行器（`src/dev/headless.ts`）

```ts
import { initCombat, step, CombatState } from '../core/combat';

export function runHeadless(config: CombatConfig, maxFrames = 60 * 120): CombatState {
  const state = initCombat(config);
  for (let i = 0; i < maxFrames && state.phase !== 'ended'; i++) {
    // M1 无 AI，双方纯自动普攻 + 站在原地
    const events = step(state, []);
  }
  return state;
}
```

---

## 12. 测试规格

| 测试文件 | 覆盖内容 | 断言要点 |
|---|---|---|
| `clock.test.ts` | Clock 累加器、步数计算、alpha 插值 | 1秒后 frame=60；不会螺旋死亡 |
| `rng.test.ts` | PCG32 确定性、randInt 分布、save/restore | 同种子两次结果完全一致；10万次 randInt(6) 每面 ≈ 16667±500 |
| `distance.test.ts` | 移动进度、步进、边界夹持、移动力消耗 | d 不会超出 [2.0, 9.0]；无移动力时效率 25% |
| `attack.test.ts` | 攻击间隔公式、距离范围判定 | 普通速+重量3+100%速度 → 70帧；超出武器距离不累加 |
| `resource.test.ts` | 提气→架势回复顺序、canCast 判定、守御初始化 | 先填满提气再填架势；双满才能施展；守御上限5000 |
| `frame-loop.test.ts` | 完整 step() 确定性 | 同(seed, commands) 跑两遍，逐帧 state hash 一致 |

---

## 13. 不做的事（WO2-WO4 负责）

- 命中/伤害计算（WO2）
- 普攻详细流程：式、变招、追击、连环（WO2）
- 摧破/护体绝技（WO3）
- AI（WO3）
- three.js 渲染（WO4）
- DOM HUD（WO4）
- 功法特效 DSL（WO3）

---

## 14. 交付检查清单

- [ ] `npm run build` 无错误
- [ ] `npm run lint` 无错误（特别是 core/ 的 no-restricted-imports）
- [ ] `npm run test` 全绿（≥ 20 个测试用例）
- [ ] 无头模式 `runHeadless()` 能跑完一场，两人站在距离 5.0 自动普攻直到分出胜负
- [ ] 同种子两次运行的 state hash 一致（确定性验证）
- [ ] 不使用 `Math.random()`、`Date.now()`、`window`、`document`
