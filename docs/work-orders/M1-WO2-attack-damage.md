# M1-WO2：普攻回合与伤害链

> 工单版本 v1.0 · 2026-11-23
> 前置：WO1（核心引擎 — Clock, RNG, EventBus, CombatState, 帧循环, 距离/移动/攻击进度, 提气架势, 守御/专注骨架）
> 预估：5-7 天
> 验收：无头模式下两个带武器属性的 Fighter 能跑完整普攻回合（含追击、变招、连环奇击），伤害链每一步可检查，40+ 黄金测试全绿

---

## 1. 本工单范围

| 做 | 不做（属于其他工单） |
|---|---|
| 普攻回合完整流程（§5.6） | 摧破四段判定（WO3） |
| 式（获取、消耗、轮盘推进） | 护体绝技持续效果（WO3） |
| 命中判定三通道（§5.8） | 反击（WO3，依赖护体绝技数据） |
| 变招 PRD + 部位选择 + 附带效果 | 反震（WO3） |
| 追击判定 + 连环奇击 | 点穴/破绽的**施加**（WO3的功法特效） |
| 完整伤害链 §5.9 (1)-(6) | 功法特效解释器（WO3） |
| 守御结算（伤害链步骤 5a） | AI（WO3） |
| 专注增加（伤害链步骤 5e） | 渲染/HUD（WO4） |
| 伤口创建 + 战败判定 | 队友系统（M2） |
| 武器切换冷却 | — |
| DamageCalc 全链路记录 | — |
| 40+ 黄金测试 | — |

---

## 2. 目录结构（在 WO1 基础上新增）

```
src/core/combat/
├── attack.ts           # resolveAttackRound(), tickAttack()
├── hit.ts              # hitCheck(), 三通道命中判定
├── changeMove.ts       # 变招 PRD + 部位效果
├── chase.ts            # 追击判定 + 连环奇击
├── damage.ts           # 完整伤害链 §5.9
├── guard.ts            # 守御结算（WO1 骨架 → 本工单补齐结算逻辑）
├── focus.ts            # 专注增加（WO1 骨架 → 本工单补齐触发规则）
├── wound.ts            # 伤口创建、战败判定
├── weapon.ts           # 武器属性接口、切换冷却
├── stance.ts           # 式管理（轮盘、获取、消耗、匹配）
└── types.ts            # WO1 已有，本工单追加 DamageCalc 等类型

tests/combat/
├── attack.test.ts
├── hit.test.ts
├── changeMove.test.ts
├── chase.test.ts
├── damage.test.ts
├── guard.test.ts
├── wound.test.ts
├── stance.test.ts
└── golden/
    ├── attackInterval.json    # 攻击间隔算例
    ├── hitChance.json         # 命中概率算例
    ├── damageChain.json       # 完整伤害链算例
    ├── chase.json             # 追击概率算例
    └── comboStrike.json       # 连环奇击算例
```

---

## 3. 武器数据接口

WO1 已定义 `WeaponClass`，本工单需要完整武器战斗属性：

```ts
// src/core/combat/weapon.ts

/** 武器在战斗中的完整属性（从 WeaponDef 预计算） */
interface CombatWeapon {
  defId: string;
  family: WeaponClass;        // 'fist'|'sword'|'blade'|'polearm'|'flexible'|'ranged'
  baseDamage: number;         // 武器基伤
  range: [min: number, max: number]; // 攻击距离段，整数 20-90（= 2.0-9.0×10）
  speedClass: 3000|4500|6000|7500|9000; // 极快/较快/普通/较慢/极慢
  weight: number;             // 重量，影响攻击间隔和切换冷却
  wheel: StanceType[];        // 6格式轮盘（战斗开始时 RNG shuffle）
  hit: {
    force: number;            // 力道命中
    swift: number;            // 迅疾命中
    subtle: number;           // 精妙命中
  };
  penetrate: {
    outer: number;            // 破体基础值
    inner: number;            // 破气基础值
  };
  armorBreak: number;         // 破甲
  toughness: number;          // 坚韧
  innerRatioBase: number;     // 基础内伤比例（千分比）
  neigongConv: number;        // 内功发挥转化系数
  chaseCoef: number;          // 追击系数 5-60
  changeCoef: number;         // 变招系数
  artPlay: number;            // 武器的功法发挥（千分比）
}

/** 攻击间隔计算 */
export function calcAttackInterval(
  weapon: CombatWeapon,
  attackSpeed: number,       // 面板攻击速度%（已含右臂点穴减益）
): number {
  // 基础攻击间隔 = speedClass + weight × 100
  const base = weapon.speedClass + weapon.weight * 100;
  // 攻击间隔(帧) = ceil(base / floor(30 + 60 × attackSpeed / 100))
  const divisor = Math.floor(30 + 60 * attackSpeed / 100);
  return Math.ceil(base / divisor);
}

/** 武器切换冷却 tickdown */
export function tickWeaponSwitch(f: FighterState): void {
  if (f.switchCooldown <= 0) return;
  // 每帧减 (550 - weight×50) × 兵器切换效率
  const weapon = getCurrentWeapon(f);
  const rate = (550 - weapon.weight * 50) * f.stats.resolve('weaponSwitch') / 100;
  f.switchCooldown = Math.max(0, f.switchCooldown - rate);
}
```

---

## 4. 式管理（`src/core/combat/stance.ts`）

```ts
interface StanceState {
  wheelOrder: StanceType[];   // 6格，开战时 RNG shuffle
  wheelPos: number;           // 当前指向，0-5
  held: StanceType[];         // 已持有的式（可重复），上限 9（配置项 STANCE_CAP）
}

/** 开战初始化轮盘 */
export function initWheel(weapon: CombatWeapon, rng: PCG32): StanceState {
  const order = [...weapon.wheel];
  // Fisher-Yates shuffle
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.nextInt(0, i);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { wheelOrder: order, wheelPos: 0, held: [] };
}

/** 获得式：只有本武器轮盘包含的式才加入 held */
export function gainStance(state: StanceState, stance: StanceType): boolean {
  if (state.held.length >= STANCE_CAP) return false;
  // 万能式(wild)和杀式(kill)直接加入
  if (stance === 'wild' || stance === 'kill') {
    state.held.push(stance);
    return true;
  }
  // 常规式：只有轮盘包含的才加入
  if (state.wheelOrder.includes(stance)) {
    state.held.push(stance);
    return true;
  }
  return false;
}

/** 轮盘推进 */
export function advanceWheel(state: StanceState): StanceType {
  state.wheelPos = (state.wheelPos + 1) % state.wheelOrder.length;
  return state.wheelOrder[state.wheelPos];
}

/** 当前轮盘式 */
export function currentWheelStance(state: StanceState): StanceType {
  return state.wheelOrder[state.wheelPos];
}

/** 检查是否持有指定的式组合（消耗时调用） */
export function hasStances(held: StanceType[], required: { type: StanceType; count: number }[]): boolean {
  const pool = [...held];
  for (const req of required) {
    let found = 0;
    for (let i = pool.length - 1; i >= 0 && found < req.count; i--) {
      if (pool[i] === req.type || pool[i] === 'wild') {
        pool.splice(i, 1);
        found++;
      }
    }
    if (found < req.count) return false;
  }
  return true;
}

/** 消耗式 */
export function consumeStances(held: StanceType[], required: { type: StanceType; count: number }[]): StanceType[] {
  const pool = [...held];
  for (const req of required) {
    let remaining = req.count;
    // 先消耗精确匹配
    for (let i = pool.length - 1; i >= 0 && remaining > 0; i--) {
      if (pool[i] === req.type) { pool.splice(i, 1); remaining--; }
    }
    // 再消耗万能式
    for (let i = pool.length - 1; i >= 0 && remaining > 0; i--) {
      if (pool[i] === 'wild') { pool.splice(i, 1); remaining--; }
    }
  }
  return pool;
}
```

---

## 5. 命中判定（`src/core/combat/hit.ts`）

```ts
/** 式 → 命中通道映射 */
const STANCE_CHANNEL: Record<StanceType, HitChannel> = {
  throw: 'force', chop: 'force', burst: 'force',
  flick: 'swift', stab: 'swift', tap: 'swift', bind: 'swift', venom: 'swift',
  steer: 'subtle', lift: 'subtle', grab: 'subtle', sweep: 'subtle',
  sound: 'breath', curse: 'subtle', drug: 'subtle',
  device: 'swift', // 机
  none: 'force', wild: 'force', kill: 'force',
};

/** 式 → 部位权重表 */
const STANCE_PART_WEIGHTS: Record<StanceType, Record<BodyPart, number>> = {
  throw:  { chest: 65, waist: 25, head: 1, leftArm: 5, rightArm: 5, leftLeg: 5, rightLeg: 5 },
  chop:   { chest: 70, waist: 15, head: 1, leftArm: 10, rightArm: 10, leftLeg: 5, rightLeg: 5 },
  burst:  { chest: 55, waist: 35, head: 1, leftArm: 5, rightArm: 5, leftLeg: 5, rightLeg: 5 },
  flick:  { chest: 45, waist: 35, head: 1, leftArm: 10, rightArm: 10, leftLeg: 10, rightLeg: 10 },
  stab:   { chest: 40, waist: 30, head: 1, leftArm: 20, rightArm: 20, leftLeg: 10, rightLeg: 10 },
  tap:    { chest: 40, waist: 30, head: 1, leftArm: 15, rightArm: 15, leftLeg: 15, rightLeg: 15 },
  bind:   { chest: 25, waist: 15, head: 1, leftArm: 30, rightArm: 30, leftLeg: 30, rightLeg: 30 },
  device: { chest: 50, waist: 30, head: 1, leftArm: 10, rightArm: 10, leftLeg: 10, rightLeg: 10 },
  steer:  { chest: 30, waist: 20, head: 1, leftArm: 30, rightArm: 30, leftLeg: 20, rightLeg: 20 },
  lift:   { chest: 25, waist: 25, head: 1, leftArm: 25, rightArm: 25, leftLeg: 25, rightLeg: 25 },
  grab:   { chest: 25, waist: 20, head: 1, leftArm: 35, rightArm: 35, leftLeg: 20, rightLeg: 20 },
  sweep:  { chest: 25, waist: 15, head: 1, leftArm: 30, rightArm: 30, leftLeg: 30, rightLeg: 30 },
  // 音/咒 → 心神(spirit)；药/毒 → 毒质(poison)；这两类不走常规部位权重
  sound:  { spirit: 100 } as any,
  curse:  { spirit: 100 } as any,
  drug:   { poison: 100 } as any,
  venom:  { poison: 100 } as any,
  none: { chest: 100 } as any,
  wild: { chest: 100 } as any,
  kill: { chest: 100 } as any,
};

/** 命中判定
 * @returns hit: 是否命中, severity: 1=轻伤, 2=重伤
 */
export function hitCheck(
  rng: PCG32,
  channel: HitChannel,
  attackerHit: number,     // 攻方该通道命中值
  defenderAvoid: number,   // 守方对应化解值
  attackerFortune: number, // 攻方队伍平均福缘
  defenderFortune: number, // 守方队伍平均福缘
): { hit: boolean; severity: 1 | 2 } {
  // p = clamp(0.5 × (命中 + 攻方福缘) / (化解 + 守方福缘), 5%, 100%)
  const atkTotal = attackerHit + attackerFortune;
  const defTotal = defenderAvoid + defenderFortune;
  const p = clamp(Math.floor(500 * atkTotal / Math.max(1, defTotal)), 50, 1000); // 千分比

  const roll = rng.nextInt(0, 999);
  const hit = roll < p;

  // 重伤判定：命中 ≥ 化解 × 2 → 重伤(2)，否则轻伤(1)
  const severity: 1 | 2 = (attackerHit >= defenderAvoid * 2) ? 2 : 1;

  return { hit, severity };
}

/** 式 → 化解通道映射 */
const HIT_TO_AVOID: Record<HitChannel, 'deflect' | 'dodge' | 'parry'> = {
  force: 'deflect',  // 力道 → 卸力
  swift: 'dodge',    // 迅疾 → 闪避
  subtle: 'parry',   // 精妙 → 拆招
  breath: 'deflect', // 内息没有专门化解通道，按卸力处理
};

/** 按权重随机选择部位 */
export function pickBodyPart(rng: PCG32, weights: Record<string, number>): BodyPart {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng.nextInt(0, total - 1);
  for (const [part, w] of entries) {
    roll -= w;
    if (roll < 0) return part as BodyPart;
  }
  return entries[0][0] as BodyPart;
}
```

---

## 6. 变招（`src/core/combat/changeMove.ts`）

```ts
/** 变招 PRD（Pseudo-Random Distribution）判定 */
export function checkChangeMove(
  rng: PCG32,
  changeMeter: number,     // 当前变招值
  changeCoef: number,      // 武器变招系数
  stanceCanChange: boolean, // 该式是否可变招（音/咒/药/毒不可）
): { triggered: boolean; newMeter: number } {
  if (!stanceCanChange) return { triggered: false, newMeter: changeMeter };

  const newMeter = changeMeter + changeCoef;
  const roll = rng.nextInt(0, 799);
  if (roll < newMeter) {
    return { triggered: true, newMeter: 0 };
  }
  return { triggered: false, newMeter };
}

/** 变招部位表 */
const CHANGE_MOVE_TABLE: Record<BodyPart, {
  baseSuccessRate: number; // 基础成功率（千分比）
  effect: (s: CombatState, defender: FighterState) => void;
}> = {
  chest:    { baseSuccessRate: 750, effect: (_, d) => { d.breath = Math.floor(d.breath * 0.8); } },
  waist:    { baseSuccessRate: 750, effect: (_, d) => { d.posture = Math.floor(d.posture * 0.8); } },
  head:     { baseSuccessRate: 250, effect: (_, d) => {
    // 随机丢失 3 个式
    for (let i = 0; i < 3 && d.stances.held.length > 0; i++) {
      const idx = Math.floor(Math.random() * d.stances.held.length); // 注意：用 rng
      d.stances.held.splice(idx, 1);
    }
  }},
  leftArm:  { baseSuccessRate: 500, effect: (_, d) => {
    d.attackProgress = Math.floor(d.attackProgress * 1.5); // 剩余攻击时间 ×1.5
  }},
  rightArm: { baseSuccessRate: 500, effect: (_, d) => {
    d.attackProgress = Math.floor(d.attackProgress * 1.5);
  }},
  leftLeg:  { baseSuccessRate: 500, effect: (_, d) => {
    d.moveProgress = Math.floor(d.moveProgress * 0.8); // 移动进度 -20%
  }},
  rightLeg: { baseSuccessRate: 500, effect: (_, d) => {
    d.moveProgress = Math.floor(d.moveProgress * 0.8);
  }},
};

/** 执行变招 */
export function resolveChangeMove(
  rng: PCG32,
  chosenPart: BodyPart,
): { success: boolean; part: BodyPart } {
  const entry = CHANGE_MOVE_TABLE[chosenPart];
  // 成功率 = 基础 ± 20% 随机浮动
  const fluctuation = rng.nextInt(-200, 200); // 千分比
  const rate = clamp(entry.baseSuccessRate + fluctuation, 0, 1000);
  const roll = rng.nextInt(0, 999);

  return {
    success: roll < rate,
    part: chosenPart,
  };
}
```

**变招成功的战斗效果**：
- 命中部位改为所选部位
- 无视护甲（破甲倍率按 1 计算）
- 获得该部位对应的式
- 执行附带效果（见上表）

**变招失败**：视为在原部位被化解（不造成伤害）。

---

## 7. 追击与连环奇击（`src/core/combat/chase.ts`）

```ts
/** 连环奇击判定（仅回合首击） */
export function checkComboStrike(
  rng: PCG32,
  attackerBreath: number,  // 攻方内息
  defenderBreath: number,  // 守方内息
): { triggered: boolean; advantage: number } {
  // 内息优势
  const breathDiff = attackerBreath - defenderBreath;
  const advantage = breathDiff >= 100
    ? Math.min(250, 100 + Math.floor(breathDiff / 20))
    : 40;
  // 触发率 = floor(advantage / 10) %
  const rate = Math.floor(advantage / 10) * 10; // 千分比
  const roll = rng.nextInt(0, 999);
  return { triggered: roll < rate, advantage };
}

/** 追击判定 */
export function checkChase(
  rng: PCG32,
  chaseCoef: number,       // 武器追击系数
  chasesAlready: number,   // 已追击次数
): boolean {
  if (chasesAlready >= 5) return false; // 最多追击5次（共6击）
  if (chaseCoef >= 125) return true;    // 系数≥125时必出6连

  // p = chaseCoef × (200 - 10n - 5n²) / 100 %
  const n = chasesAlready;
  const factor = 200 - 10 * n - 5 * n * n;
  const p = Math.floor(chaseCoef * factor / 100) * 10; // 千分比
  const roll = rng.nextInt(0, 999);
  return roll < p;
}
```

---

## 8. 完整伤害链（`src/core/combat/damage.ts`）

这是本工单最核心、最复杂的部分。每一步都要记录到 `DamageCalc` 中。

```ts
/** DamageCalc 类型定义（追加到 types.ts） */
interface DamageCalc {
  attacker: 0 | 1;
  source: 'attack' | 'chase' | 'combo' | 'counter' | 'technique' | 'reflect' | 'true';
  artId?: string;
  stance?: StanceType;
  part: BodyPart;
  channel: HitChannel;

  // 命中
  hitValue: number;
  avoidValue: number;
  hitChance: number;        // 千分比
  rolled: number;
  landed: boolean;

  // 变招
  changeMove?: { part: BodyPart; success: boolean };

  // 重伤程度
  grade: 1 | 2 | 3;        // 普攻只有1/2，功法可到3

  // (1) 内伤比例
  innerRatio: number;       // 千分比

  // (2) 破甲倍率
  armorMult: { outer: number; inner: number }; // 千分比

  // (3) 破体破气倍率
  penetration: {
    atk: { outer: number; inner: number };
    def: { outer: number; inner: number };
    coef: { outer: number; inner: number };   // 穿透系数（千分比）
    mult: { outer: number; inner: number };   // 最终倍率（千分比）
  };

  // (4) 常规伤害
  weaponBase: number;
  artBase: number;          // 功法基伤（普攻为0）
  dealMult: { outer: number; inner: number };  // 造成外伤/造成内伤（千分比）
  power: number;            // 普攻威力（千分比）：100/300/反击威力
  artAdjust: number;        // 功法伤害调整（千分比）
  tenths?: number;          // 功法命中成数
  regular: { outer: number; inner: number };   // 千分比

  // (5) 通用伤害
  guardDamage: number;
  absorbedByGuard: boolean;
  generalAdjust: number;    // 千分比

  // (6) 直接伤害
  directAdjust: number;     // 千分比
  final: { outer: number; inner: number };     // 千分比

  // 产生的伤口
  woundsCreated: Wound[];
  focusGained: number;

  // 展开步骤（供公式检查器）
  steps: { label: string; value: number; mods: string[] }[];
}
```

### 8.1 步骤 (1)：内伤比例

```ts
export function calcInnerRatio(
  weapon: CombatWeapon,
  neigongPlay: number,     // 人物内功发挥 (正/负/0)
  artInnerRatioBase?: number, // 功法基础内功比例（普攻为 undefined）
): { weaponRatio: number; artRatio?: number; finalRatio: number } {
  const base = weapon.innerRatioBase; // 千分比

  // 转化难度
  let convDifficulty = 1000; // 千分比
  if (neigongPlay > 0 && base < 500) {
    convDifficulty = 1000 + Math.floor((500 - base) * 1000 / 500);
  } else if (neigongPlay <= 0 && base > 500) {
    convDifficulty = 1000 + Math.floor((base - 500) * 1000 / 500);
  }

  // 武器内伤比例 = base + 内功发挥 × 转化系数 / 转化难度
  const weaponRatio = clamp(
    base + Math.floor(neigongPlay * weapon.neigongConv * 1000 / convDifficulty),
    0, 1000
  );

  if (artInnerRatioBase === undefined) {
    return { weaponRatio, finalRatio: weaponRatio };
  }

  // 功法内功比例 = 功法基础 + 内功发挥 / 转化难度
  const artRatio = clamp(
    artInnerRatioBase + Math.floor(neigongPlay * 1000 / convDifficulty),
    0, 1000
  );

  // 功法内伤比例 = (武器 + 功法) / 2
  const finalRatio = Math.floor((weaponRatio + artRatio) / 2);
  return { weaponRatio, artRatio, finalRatio };
}
```

### 8.2 步骤 (2)：破甲倍率

```ts
export function calcArmorMult(
  armorBreak: number,      // 攻方破甲
  toughness: number,       // 守方坚韧
  changeMoveSuccess: boolean, // 变招成功时按 1 计算
): { outer: number; inner: number } {
  if (changeMoveSuccess) return { outer: 1000, inner: 1000 };
  if (armorBreak === 0 && toughness === 0) return { outer: 1000, inner: 1000 };

  if (armorBreak <= toughness) {
    return { outer: 500, inner: 750 };
  }
  const ratio = Math.floor((armorBreak - toughness) * 1000 / armorBreak);
  return {
    outer: 500 + Math.floor(500 * ratio / 1000),
    inner: 750 + Math.floor(250 * ratio / 1000),
  };
}
```

### 8.3 步骤 (3)：破体/破气倍率

```ts
export function calcPenetrationMult(
  atkValue: number,        // 攻方值（含武器+人物+功法）
  defValue: number,        // 守方值
  innerRatio: number,      // 千分比
  isNormalAttack: boolean,
  isTechnique: boolean,
): { outer: number; inner: number } {
  if (atkValue <= defValue) {
    // 倍率 = 1.2（表示被压制，这里不利于攻方但有基础保底）
    // 实际：1 + (atk - def) / def × 1.2，atk ≤ def 所以这是 ≤ 1.0
    const raw = 1000 + Math.floor((atkValue - defValue) * 1200 / Math.max(1, defValue));
    const clamped = Math.max(100, Math.min(raw, isTechnique ? 3000 : 2000));
    return { outer: clamped, inner: clamped };
  }

  // 攻方 > 守方
  let coef: number;
  if (innerRatio > 800 || innerRatio < 200) {
    coef = 400;
  } else {
    coef = 1000 - Math.floor(Math.abs(innerRatio - 500) * 1200 / 1000);
  }

  if (isNormalAttack) coef = Math.floor(coef / 2);

  const raw = 1000 + Math.floor((atkValue - defValue) * coef / Math.max(1, defValue));
  const upper = isTechnique ? 3000 : 2000;
  return {
    outer: clamp(raw, 100, upper),
    inner: clamp(raw, 100, upper),
  };
}
```

### 8.4 步骤 (4)：常规伤害

```ts
/** 普攻常规伤害 */
export function calcNormalAttackDamage(
  weapon: CombatWeapon,
  innerRatio: number,          // 千分比
  armorMult: { outer: number; inner: number },
  dealOuter: number,           // 造成外伤（千分比）
  dealInner: number,           // 造成内伤（千分比）
  penMult: { outer: number; inner: number },
  power: number,               // 普攻威力（千分比）：100%、300%(连环)、反击威力
): { outer: number; inner: number } {
  // 外伤 = 武器基伤 × (1 - 内伤比例) × 外伤破甲倍率 × 造成外伤 × 破体倍率 × 普攻威力
  const outer = Math.floor(
    weapon.baseDamage
    * (1000 - innerRatio) / 1000
    * armorMult.outer / 1000
    * dealOuter / 1000
    * penMult.outer / 1000
    * power / 1000
  );

  // 内伤 = 武器基伤 × 内伤比例 × 内伤破甲倍率 × 造成内伤 × 破气倍率 × 普攻威力
  const inner = Math.floor(
    weapon.baseDamage
    * innerRatio / 1000
    * armorMult.inner / 1000
    * dealInner / 1000
    * penMult.inner / 1000
    * power / 1000
  );

  return { outer: Math.max(10, outer), inner: Math.max(10, inner) };
}
```

### 8.5 步骤 (5)：通用伤害（守御 + 调整）

```ts
/** 守御结算 */
export function resolveGuard(
  defender: FighterState,
  damage: number,              // 伤势（千分比）
  distance: number,            // 当前距离（×10整数）
  isSpirit: boolean,           // 心神性内伤无视守御
  isPoison: boolean,           // 毒发无视守御
): { absorbed: boolean; guardDamage: number } {
  if (isSpirit || isPoison || defender.guardBroken) {
    return { absorbed: false, guardDamage: 0 };
  }

  // 距离系数
  let distCoef = 1000;
  if (distance > 50) distCoef = 350;
  else if (distance > 30) distCoef = 650;

  // 对守御伤害 = 伤势 × 距离系数 × 1000
  const guardDmg = Math.floor(damage * distCoef / 1000 * 1000);
  defender.guard -= guardDmg;

  if (defender.guard <= 0) {
    defender.guard = 0;
    defender.guardBroken = true;
    // 守御尽破后护体、御气各 -40%
    applyGuardBreakDebuff(defender);
    return { absorbed: false, guardDamage: guardDmg };
  }

  return { absorbed: true, guardDamage: guardDmg };
}

/** 通用伤害调整 */
export function calcGeneralAdjust(
  defender: FighterState,
  part: BodyPart,
  innerRatio: number,
): { outer: number; inner: number } {
  // 基础 1000（千分比）
  let outerAdj = 1000;
  let innerAdj = 1000;

  // 点穴每层 +10% 内伤
  const seals = defender.seals[part] ?? 0;
  innerAdj += seals * 100;

  // 破绽每层 +10% 外伤
  const flaws = defender.flaws[part] ?? 0;
  outerAdj += flaws * 100;

  // 下限 20%
  return {
    outer: Math.max(200, outerAdj),
    inner: Math.max(200, innerAdj),
  };
}
```

### 8.6 步骤 (6)：直接伤害 + 伤口

```ts
/** 伤口基础值表 */
const WOUND_BASE: Record<BodyPart, number> = {
  chest: 60, waist: 60, head: 100,
  leftArm: 40, rightArm: 40, leftLeg: 40, rightLeg: 40,
  spirit: 40, poison: 40, whole: 80,
};

/** 创建伤口 */
export function createWound(
  part: BodyPart,
  outerDamage: number,     // 千分比
  innerDamage: number,     // 千分比
  grade: 1 | 2 | 3,       // 轻/重/致命
): Wound {
  const base = WOUND_BASE[part];
  return {
    part,
    outer: Math.floor(outerDamage * grade * base / 1000),
    inner: Math.floor(innerDamage * grade * base / 1000),
    grade,
    frame: 0,              // 受伤帧（由调用方填）
  };
}

/** 累计伤势并检查战败 */
export function applyWound(
  fighter: FighterState,
  wound: Wound,
  battleKind: BattleKind,
): { defeated: boolean } {
  fighter.wounds.push(wound);
  fighter.outerTotal += wound.outer;
  fighter.innerTotal += wound.inner;

  // 战败阈值
  const threshold = DEFEAT_THRESHOLD[battleKind]; // { outer: 1000, inner: 1000 } 死斗; 750 恶战; 500 切磋/接招

  return {
    defeated: fighter.outerTotal >= threshold.outer || fighter.innerTotal >= threshold.inner,
  };
}

const DEFEAT_THRESHOLD: Record<BattleKind, { outer: number; inner: number }> = {
  duel: { outer: 1000, inner: 1000 },
  brawl: { outer: 750, inner: 750 },
  spar: { outer: 500, inner: 500 },
  trial: { outer: 500, inner: 500 },
};
```

---

## 9. 普攻回合主流程（`src/core/combat/attack.ts`）

```ts
export function resolveAttackRound(
  s: CombatState,
  attackerIdx: 0 | 1,
): void {
  const atk = s.sides[attackerIdx].main;
  const def = s.sides[1 - attackerIdx as 0 | 1].main;
  const weapon = getCurrentWeapon(atk);

  // 1. 连环奇击判定（仅回合首击）
  const combo = checkComboStrike(s.rng, atk.stats.breath, def.stats.breath);
  const isCombo = combo.triggered;
  const maxHits = isCombo ? 6 : 1;
  const power = isCombo ? 3000 : 1000; // 千分比

  let roundHit = false;
  let hitIndex = 0;
  let chaseCount = 0;

  while (hitIndex < maxHits) {
    const stance = currentWheelStance(atk.stanceState);
    const channel = STANCE_CHANNEL[stance];
    const canChange = STANCE_CAN_CHANGE[stance];

    // 2b. 变招检查
    let changeMoveResult: { part: BodyPart; success: boolean } | undefined;
    if (canChange) {
      const cm = checkChangeMove(s.rng, atk.changeMeter, weapon.changeCoef, true);
      atk.changeMeter = cm.newMeter;
      if (cm.triggered) {
        // 进入变招：phase → 'choice' 或 AI 立即决定
        const chosenPart = resolveChangeMoveChoice(s, attackerIdx);
        if (chosenPart !== null) {
          changeMoveResult = resolveChangeMove(s.rng, chosenPart);
        }
      }
    }

    // 2c. 定部位
    let targetPart: BodyPart;
    if (changeMoveResult?.success) {
      targetPart = changeMoveResult.part;
    } else if (changeMoveResult && !changeMoveResult.success) {
      // 变招失败 → 视为被化解，不造成伤害
      emitEvent(s, 'dodged', { side: attackerIdx, stance, part: changeMoveResult.part });
      hitIndex++;
      if (!isCombo && !checkChase(s.rng, weapon.chaseCoef, chaseCount)) break;
      chaseCount++;
      maxHits = Math.min(maxHits + 1, 6);
      continue;
    } else {
      targetPart = pickBodyPart(s.rng, STANCE_PART_WEIGHTS[stance]);
    }

    // 2d. 命中判定
    const atkHit = resolveHitValue(atk, channel, weapon);
    const defAvoid = resolveAvoidValue(def, channel);
    const result = hitCheck(
      s.rng, channel, atkHit, defAvoid,
      s.sides[attackerIdx].avgFortune,
      s.sides[1 - attackerIdx as 0 | 1].avgFortune,
    );

    if (result.hit) {
      // 2e. 走伤害链
      const calc = resolveDamageChain(s, attackerIdx, {
        source: isCombo ? 'combo' : (chaseCount > 0 ? 'chase' : 'attack'),
        weapon, stance, channel, targetPart,
        grade: result.severity,
        power,
        changeMoveSuccess: changeMoveResult?.success ?? false,
      });
      emitDamageEvents(s, calc);
      roundHit = true;
    } else {
      // 未中：检查反击（WO3实现，这里留 hook）
      emitEvent(s, 'dodged', { side: attackerIdx, stance, part: targetPart, channel });
      if (checkCounterCondition(def)) {
        // WO3: resolveCounter()
        break; // 反击中断追击
      }
    }

    hitIndex++;

    // 2f. 追击判定（连环奇击跳过，直接打满6击）
    if (!isCombo) {
      if (!checkChase(s.rng, weapon.chaseCoef, chaseCount)) break;
      chaseCount++;
    }
  }

  // 3. 回合结束
  if (roundHit) {
    gainStance(atk.stanceState, currentWheelStance(atk.stanceState));
  }
  advanceWheel(atk.stanceState);
  atk.attackProgress = 0;

  // 设置 animLock（帧数由击数决定，查表）
  s.animLock = calcAnimLockDuration(hitIndex, isCombo, result?.severity ?? 1);
}
```

---

## 10. 黄金测试规格（40+ 用例）

### 10.1 攻击间隔（5例）

| # | speedClass | weight | attackSpeed | 期望帧数 | 来源 |
|---|---|---|---|---|---|
| 1 | 6000(普通) | 3 | 100% | ceil(6300/90)=70 | §5.6例 |
| 2 | 3000(极快) | 1 | 100% | ceil(3100/90)=35 | — |
| 3 | 9000(极慢) | 5 | 100% | ceil(9500/90)=106 | — |
| 4 | 6000 | 3 | 50% | ceil(6300/60)=105 | 低速验证 |
| 5 | 6000 | 3 | 200% | ceil(6300/150)=42 | 高速验证 |

### 10.2 命中概率（6例）

| # | 命中 | 化解 | 攻方福缘 | 守方福缘 | 期望p | 重伤? |
|---|---|---|---|---|---|---|
| 1 | 100 | 100 | 0 | 0 | 50% | 否 |
| 2 | 200 | 100 | 0 | 0 | 100% | 是 |
| 3 | 10 | 200 | 0 | 0 | 5%(下限) | 否 |
| 4 | 100 | 100 | 50 | 0 | 75% | 否 |
| 5 | 100 | 100 | 0 | 50 | 33% | 否 |
| 6 | 150 | 100 | 0 | 0 | 75% | 否 |

### 10.3 变招（4例）

| # | changeMeter | changeCoef | roll | 期望触发 | 新meter |
|---|---|---|---|---|---|
| 1 | 0 | 30 | 25 | 是(30>25) | 0 |
| 2 | 0 | 30 | 35 | 否 | 30 |
| 3 | 400 | 30 | 420 | 是(430>420) | 0 |
| 4 | 790 | 30 | 50 | 是 | 0 |

### 10.4 追击概率（6例）

| # | chaseCoef | 已追击次 | 期望概率 | 备注 |
|---|---|---|---|---|
| 1 | 30 | 0 | 60% | 30×200/100 |
| 2 | 30 | 1 | 55.5% | 30×185/100 |
| 3 | 30 | 5 | — | 不可能(≥5禁止) |
| 4 | 125 | 0 | 100% | 必出6连 |
| 5 | 125 | 4 | 100% | 必出6连 |
| 6 | 5 | 0 | 10% | 低系数 |

### 10.5 连环奇击（4例）

| # | 攻内息 | 守内息 | 内息差 | 期望advantage | 触发率 |
|---|---|---|---|---|---|
| 1 | 300 | 100 | 200 | min(250,110)=110 | 11% |
| 2 | 100 | 300 | -200 | 40 | 4% |
| 3 | 400 | 100 | 300 | min(250,115)=115 | 11.5% |
| 4 | 100 | 100 | 0 | 40 | 4% |

### 10.6 内伤比例（4例）

| # | 武器基础 | 内功发挥 | 转化系数 | 期望武器比例 |
|---|---|---|---|---|
| 1 | 500 | 100 | 10 | 500+100×10/1000=501 |
| 2 | 200 | 100 | 10 | 转化难度1600, 200+100×10/1600=200.6→200 |
| 3 | 800 | -50 | 10 | 转化难度1600, 800+(-50)×10/1600=799.7→799 |
| 4 | 500 | 0 | 10 | 500(无变化) |

### 10.7 破甲倍率（3例）

| # | 破甲 | 坚韧 | 外倍率 | 内倍率 |
|---|---|---|---|---|
| 1 | 50 | 100 | 500 | 750 |
| 2 | 100 | 50 | 750 | 875 |
| 3 | 0 | 0 | 1000 | 1000 |

### 10.8 守御结算（4例）

| # | 守御 | 伤势 | 距离 | 期望结果 |
|---|---|---|---|---|
| 1 | 3000 | 100 | 2.0 | guardDmg=100000, 未破(3000>100) |
| 2 | 50 | 100 | 2.0 | 守御破, absorbed=false |
| 3 | 3000 | 100 | 6.0 | guardDmg=35000(×0.35) |
| 4 | 0 | 100 | 2.0 | guardBroken=true, absorbed=false |

### 10.9 伤口与战败（4例）

| # | 现有外伤 | 新外伤 | 战斗类型 | 期望战败? |
|---|---|---|---|---|
| 1 | 400 | 100 | duel | 否(500<1000) |
| 2 | 400 | 600 | duel | 是(1000≥1000) |
| 3 | 400 | 100 | spar | 是(500≥500) |
| 4 | 740 | 10 | brawl | 是(750≥750) |

### 10.10 完整伤害链端到端（5例）

每例覆盖从命中到伤口创建的全链路，验证中间每一步数值。用固定 seed 和预设属性。

---

## 11. 专注触发规则补齐

WO1 预留了 `focus` 字段，本工单补齐触发逻辑：

```ts
export function addFocus(
  fighter: FighterState,
  battleKind: BattleKind,
  source: 'guardLoss' | 'wound',
  value: number,
): void {
  // 守御损失：每损失 1% 守御 +5
  // 受伤：每受到 战败条件 × 1% 的内/外伤 +5，不足则 +1
  const multiplier = FOCUS_MULTIPLIER[battleKind];
  const gain = Math.max(1, Math.floor(value * 5 * multiplier / 1000));
  fighter.focus = Math.min(1000, fighter.focus + gain);
}

const FOCUS_MULTIPLIER: Record<BattleKind, number> = {
  duel: 1000,
  spar: 2000,
  trial: 2000,
  brawl: 1330,
};
```

---

## 12. 交付检查清单

- [ ] `resolveAttackRound()` 完整实现，含追击和连环奇击
- [ ] 式管理（轮盘初始化、获取、消耗、匹配）通过测试
- [ ] 三通道命中判定 `hitCheck()` 通过 6 个黄金测试
- [ ] 变招 PRD + 7 个部位效果全部实现
- [ ] 追击概率公式通过 6 个黄金测试，系数 ≥125 必出 6 连
- [ ] 完整伤害链 §5.9 步骤 (1)-(6) 全部实现
- [ ] `DamageCalc` 记录每一步中间值，可供公式检查器使用
- [ ] 守御结算（距离系数、破盾减益）正确
- [ ] 专注增加规则正确（守御损失 / 受伤两个触发源）
- [ ] 伤口创建使用正确的基础值表
- [ ] 战败判定按 BattleKind 使用不同阈值
- [ ] 武器切换冷却 tickdown 正确
- [ ] 40+ 黄金测试全绿
- [ ] 无头模式 1000 帧 step() 循环无崩溃
- [ ] 确定性验证：同 seed 两遍结果一致
