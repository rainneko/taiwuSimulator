# M1-WO3：摧破、护体绝技、特效解释器与 AI

> 工单版本 v1.0 · 2026-11-23
> 前置：WO1（核心引擎）、WO2（普攻与伤害链 — 式管理、命中判定、伤害公式已就绪）
> 预估：5-7 天
> 验收：无头模式 AI 对 AI 完整一场（含摧破、护体、反击），1000 场镜像胜率 50%±3%，高难度对低难度 >80%

---

## 1. 本工单范围

| 做 | 不做 |
|---|---|
| 摧破四段判定（§5.7） | 渲染/HUD（WO4） |
| 护体绝技持续效果（§5.10） | 队友系统（M2） |
| 反击结算（§5.10） | 修习/突破/研读（M2） |
| 反震（§5.10） | 实战修习（M2） |
| 点穴/破绽施加与减益（§5.10） | 功法数据从 wiki 提取（M2） |
| 功法特效解释器 v1（§5.12，12 个操作） | 长尾特效（M2+） |
| 身法功法（移动力赋予 + 移速加成） | — |
| AI v1（§5.13） | — |
| AI 对 AI 批量模拟（§5.13 验收） | — |

---

## 2. 目录结构（在 WO1+WO2 基础上新增）

```
src/core/combat/
├── technique.ts        # resolveTechnique(), tickCast()
├── guardSkill.ts       # 护体绝技施展与持续效果
├── counter.ts          # 反击结算
├── reflect.ts          # 反震结算
├── sealFlaw.ts         # 点穴/破绽施加、减益查表
├── movement.ts         # 身法功法（WO1 距离移动 → 本工单补身法移动力赋予）
├── effect.ts           # 功法特效解释器 DSL 引擎
├── effectOps.ts        # 12 个内置操作
├── ai.ts               # AI 主循环
├── aiDistance.ts        # 距离决策
├── aiTechnique.ts      # 施展决策
├── aiDefense.ts        # 防守反应
└── aiChangeMove.ts     # 自动变招优先级

tests/combat/
├── technique.test.ts
├── guardSkill.test.ts
├── counter.test.ts
├── sealFlaw.test.ts
├── effect.test.ts
├── ai.test.ts
└── golden/
    ├── technique.json     # 摧破四段算例
    ├── castTime.json      # 施展时间算例
    └── aiMirror.json      # AI镜像对局统计
```

---

## 3. 摧破四段判定（`src/core/combat/technique.ts`）

### 3.1 施展条件检查

```ts
export function canCastTechnique(
  fighter: FighterState,
  art: TechniqueData,
): { ok: boolean; reason?: string } {
  // 1. 提气、架势双满（特效可解除此限制，检查 effect flag）
  if (!fighter.effects.some(e => e.flag === 'bypassDualFull')) {
    if (fighter.breath < 30000) return { ok: false, reason: 'breathNotFull' };
    if (fighter.posture < 30000) return { ok: false, reason: 'postureNotFull' };
  }

  // 2. 持有所需的式
  if (art.type !== 'leg') { // 腿法不需要式，改耗移动力
    if (!hasStances(fighter.stanceState.held, art.stanceCost)) {
      return { ok: false, reason: 'insufficientStances' };
    }
  } else {
    if ((fighter.mobility.white + fighter.mobility.skill) < art.mobilityCost!) {
      return { ok: false, reason: 'insufficientMobility' };
    }
  }

  // 3. 非施展中
  if (fighter.cast) return { ok: false, reason: 'alreadyCasting' };

  return { ok: true };
}
```

### 3.2 施展时间

```ts
/** 施展时间（帧） */
export function calcCastTime(
  art: TechniqueData,
  castSpeed: number,       // 面板施展速度%（已含头颈点穴减益）
): number {
  // 帧数 = 最大施展时间 ÷ 施展速度
  return Math.ceil(art.castTime * 100 / Math.max(1, castSpeed));
}
```

**黄金测试**：施展时间 220、施展速度 220% → `ceil(220 × 100 / 220) = 100 帧`（来源：旧/施展时间）

### 3.3 施展 Tick

```ts
export function tickCast(s: CombatState, f: FighterState): void {
  if (!f.cast) return;
  f.cast.progress++;
  if (f.cast.progress >= f.cast.total) {
    resolveTechnique(s, f);
    f.cast = undefined;
  }
  // 施展期间：不能移动、普攻、其他施展；不回提气架势
}
```

### 3.4 出手结算

```ts
export function resolveTechnique(
  s: CombatState,
  attackerIdx: 0 | 1,
): void {
  const atk = s.sides[attackerIdx].main;
  const def = s.sides[1 - attackerIdx as 0 | 1].main;
  const art = getArtData(atk.cast!.artId);
  const weapon = getCurrentWeapon(atk);

  // 0. 距离检查
  const artRange = resolveArtRange(art, weapon);
  if (s.distance < artRange[0] || s.distance > artRange[1]) {
    // 0 成，直接结束
    emitEvent(s, 'techniqueWhiff', { side: attackerIdx, artId: art.id });
    consumeResources(atk, art);
    return;
  }

  // 1. 命中面板（每通道分别算）
  const hitByChannel = calcTechniqueHit(atk, art, weapon);

  // 2. 四段判定
  // 功法的 10 成按三通道分配，如 { swift: 3, subtle: 3, force: 4 }
  const channelOrder: HitChannel[] = ['swift', 'subtle', 'force'];
  const channelTenths = art.hit; // { swift: N, subtle: N, force: N }

  let totalTenths = 0;
  const stageResults: StageResult[] = [];

  // 第 1-3 段：依次用各通道的实战命中对守方化解做判定
  for (let stage = 0; stage < 3; stage++) {
    const ch = channelOrder[stage];
    const tenths = channelTenths[ch];
    if (tenths <= 0) continue;

    const atkHit = hitByChannel[ch];
    const defAvoid = resolveAvoidValue(def, ch);
    const result = hitCheck(s.rng, ch, atkHit, defAvoid,
      s.sides[attackerIdx].avgFortune,
      s.sides[1 - attackerIdx as 0 | 1].avgFortune,
    );

    if (result.hit) {
      totalTenths += tenths;
      // 段成数 1-4→轻伤, 5-9→重伤, 10→致命
      const grade: 1 | 2 | 3 = tenths >= 10 ? 3 : tenths >= 5 ? 2 : 1;
      const part = pickBodyPart(s.rng, art.partWeights);

      // 造成一处伤口（走功法伤害分支）
      const calc = resolveTechniqueDamage(s, attackerIdx, {
        art, weapon, channel: ch, part, grade,
        tenths: tenths,
        totalTenths: totalTenths,
      });
      stageResults.push({ stage, channel: ch, tenths, grade, part, calc });
    }
  }

  // 第 4 段（终结）
  if (totalTenths > 0) {
    const finalGrade: 1 | 2 | 3 = totalTenths >= 10 ? 3 : totalTenths >= 5 ? 2 : 1;
    const finalPart = pickBodyPart(s.rng, art.partWeights);
    const hitRatio = totalTenths * 100; // 千分比：发挥成数/10

    const calc = resolveTechniqueDamage(s, attackerIdx, {
      art, weapon, channel: 'force', // 终结段不再区分通道
      part: finalPart, grade: finalGrade,
      tenths: totalTenths,
      totalTenths: totalTenths,
      hitRatio,
    });
    stageResults.push({ stage: 3, channel: 'force', tenths: totalTenths, grade: finalGrade, part: finalPart, calc });
  }

  // 3. 触发特效
  triggerEffects(s, attackerIdx, 'onTechniqueResolved', { tenths: totalTenths, art });

  // 4. 记录到 AI 战斗记忆
  def.memory.artResults[art.id] = def.memory.artResults[art.id] ?? { casts: 0, bestTenths: 0 };
  def.memory.artResults[art.id].casts++;
  def.memory.artResults[art.id].bestTenths = Math.max(
    def.memory.artResults[art.id].bestTenths, totalTenths
  );

  // 5. 扣资源
  consumeResources(atk, art);

  // 6. animLock
  s.animLock = calcTechniqueAnimLock(stageResults);

  emitEvent(s, 'techniqueResolved', {
    side: attackerIdx, artId: art.id,
    totalTenths, stages: stageResults,
  });
}
```

### 3.5 功法伤害分支

与 WO2 的普攻伤害链共享步骤 (1)-(6)，区别在步骤 (4)：

```ts
/** 功法常规伤害（§5.9 步骤 4 功法分支） */
export function calcTechniqueDamage(
  weapon: CombatWeapon,
  art: TechniqueData,
  innerRatio: number,          // 千分比（功法内伤比例，取武器与功法的平均）
  armorMult: { outer: number; inner: number },
  dealOuter: number,           // 千分比
  dealInner: number,           // 千分比
  penMult: { outer: number; inner: number },
  artAdjust: number,           // 功法伤害调整（千分比）
  hitRatio: number,            // 功法命中比例（千分比）= 发挥成数/10
  hasProtectEffect: boolean,   // 敌方护命类特效 → 50%
): { outer: number; inner: number } {
  // 外伤 = [功法基伤×(1-功法内伤比例) + 武器基伤×(1-武器内伤比例)]
  //        × 外伤破甲 × 造成外伤 × 功法伤害调整 × (护命?50%:1) × 破体倍率 × 命中比例
  const artOuter = art.damage * (1000 - innerRatio) / 1000;
  const wpnOuter = weapon.baseDamage * (1000 - innerRatio) / 1000;
  const outer = Math.floor(
    (artOuter + wpnOuter)
    * armorMult.outer / 1000
    * dealOuter / 1000
    * artAdjust / 1000
    * (hasProtectEffect ? 500 : 1000) / 1000
    * penMult.outer / 1000
    * hitRatio / 1000
  );

  const artInner = art.damage * innerRatio / 1000;
  const wpnInner = weapon.baseDamage * innerRatio / 1000;
  const inner = Math.floor(
    (artInner + wpnInner)
    * armorMult.inner / 1000
    * dealInner / 1000
    * artAdjust / 1000
    * (hasProtectEffect ? 500 : 1000) / 1000
    * penMult.inner / 1000
    * hitRatio / 1000
  );

  return { outer: Math.max(10, outer), inner: Math.max(10, inner) };
}
```

---

## 4. 护体绝技（`src/core/combat/guardSkill.ts`）

```ts
interface GuardSkillData {
  id: string;
  gaugeTotal: number;         // 提气+架势总消耗比例（千分比）：600/800/1000
  breathShare: number;        // 其中提气占比（千分比）
  castTime: number;           // 施展时间（帧）
  duration: number;           // 持续时间（帧）
  guardFlat: { outer: number; inner: number };   // 护体/御气固定加成
  guardPct: { outer: number; inner: number };     // 护体/御气百分比加成
  avoid: { absorb: number; parry: number; dodge: number }; // 卸力/拆招/闪避加成
  counter?: CounterData;
  reflect?: ReflectData;
}

interface CounterData {
  range: [number, number];    // 反击距离段
  power: number;              // 反击威力（千分比）160%-600%
  channel: HitChannel;        // 反击匹配的化解通道
}

interface ReflectData {
  outer: number;              // 外伤反震倍率（千分比）
  inner: number;              // 内伤反震倍率（千分比）
}

/** 施展护体绝技 */
export function activateGuardSkill(
  fighter: FighterState,
  skill: GuardSkillData,
): void {
  // 扣提气架势
  const breathCost = Math.floor(30000 * skill.gaugeTotal / 1000 * skill.breathShare / 1000);
  const postureCost = Math.floor(30000 * skill.gaugeTotal / 1000 * (1000 - skill.breathShare) / 1000);
  fighter.breath -= breathCost;
  fighter.posture -= postureCost;

  // 应用持续效果
  fighter.guardSkill = { artId: skill.id, remain: skill.duration };

  // 推入 StatStack：化解加成
  pushEffect(fighter, 'avoid_absorb', skill.avoid.absorb, skill.duration);
  pushEffect(fighter, 'avoid_parry', skill.avoid.parry, skill.duration);
  pushEffect(fighter, 'avoid_dodge', skill.avoid.dodge, skill.duration);

  // 推入 StatStack：护体/御气
  pushEffect(fighter, 'guard_outer_flat', skill.guardFlat.outer, skill.duration);
  pushEffect(fighter, 'guard_outer_pct', skill.guardPct.outer, skill.duration);
  pushEffect(fighter, 'guard_inner_flat', skill.guardFlat.inner, skill.duration);
  pushEffect(fighter, 'guard_inner_pct', skill.guardPct.inner, skill.duration);
}

/** 护体绝技 Tick：持续中移速与移动距离减半，不回提气架势 */
export function tickGuardSkill(f: FighterState): void {
  if (!f.guardSkill) return;
  f.guardSkill.remain--;
  if (f.guardSkill.remain <= 0) {
    f.guardSkill = undefined;
    // 移除相关 StatStack 效果
    removeEffectsBySource(f, 'guardSkill');
  }
}
```

---

## 5. 反击（`src/core/combat/counter.ts`）

```ts
/** 检查反击条件 */
export function checkCounterCondition(
  defender: FighterState,
  attackChannel: HitChannel,
  dodged: boolean,
  stance: StanceType,
  distance: number,
): boolean {
  if (!defender.guardSkill) return false;
  const skill = getGuardSkillData(defender.guardSkill.artId);
  if (!skill.counter) return false;
  if (!dodged) return false;
  if (stance === 'sound') return false; // 「音」式不引发反击

  // 通道匹配
  if (attackChannel !== skill.counter.channel && skill.counter.channel !== 'force') return false;

  // 距离检查
  if (distance < skill.counter.range[0] || distance > skill.counter.range[1]) return false;

  return true;
}

/** 执行反击 */
export function resolveCounter(
  s: CombatState,
  defenderIdx: 0 | 1,
): void {
  const def = s.sides[defenderIdx].main;
  const atk = s.sides[1 - defenderIdx as 0 | 1].main;
  const skill = getGuardSkillData(def.guardSkill!.artId);
  const weapon = getCurrentWeapon(def);

  // 反击按「带威力的普攻」结算
  const stance = currentWheelStance(def.stanceState);
  const channel = STANCE_CHANNEL[stance];
  const part = pickBodyPart(s.rng, STANCE_PART_WEIGHTS[stance]);

  // 可变招（同普攻变招逻辑）
  let changeMoveResult: { part: BodyPart; success: boolean } | undefined;
  if (STANCE_CAN_CHANGE[stance]) {
    const cm = checkChangeMove(s.rng, def.changeMeter, weapon.changeCoef, true);
    def.changeMeter = cm.newMeter;
    if (cm.triggered) {
      const chosenPart = resolveAutoChangeMove(def);
      if (chosenPart) changeMoveResult = resolveChangeMove(s.rng, chosenPart);
    }
  }

  const targetPart = changeMoveResult?.success ? changeMoveResult.part : part;

  // 命中判定
  const hitResult = hitCheck(s.rng, channel,
    resolveHitValue(def, channel, weapon),
    resolveAvoidValue(atk, channel),
    s.sides[defenderIdx].avgFortune,
    s.sides[1 - defenderIdx as 0 | 1].avgFortune,
  );

  if (hitResult.hit) {
    // 伤害链，威力 = 护体绝技反击威力
    resolveDamageChain(s, defenderIdx, {
      source: 'counter',
      weapon, stance, channel, targetPart,
      grade: hitResult.severity,
      power: skill.counter!.power,
      changeMoveSuccess: changeMoveResult?.success ?? false,
    });

    // 命中得1个式
    gainStance(def.stanceState, currentWheelStance(def.stanceState));
  }

  // 反击不可追击
  // 中断对方追击（由 resolveAttackRound 检查 counterTriggered flag）
  s._counterTriggered = true;

  emitEvent(s, 'counter', { side: defenderIdx, hit: hitResult.hit });
}
```

---

## 6. 反震（`src/core/combat/reflect.ts`）

```ts
/** 绝技反震 */
export function resolveReflect(
  s: CombatState,
  defenderIdx: 0 | 1,
  finalDamage: { outer: number; inner: number },
): void {
  const def = s.sides[defenderIdx].main;
  if (!def.guardSkill) return;

  const skill = getGuardSkillData(def.guardSkill.artId);
  if (!skill.reflect) return;
  if (!def.guardBroken) return; // 需守御已破

  const atk = s.sides[1 - defenderIdx as 0 | 1].main;

  // 反震通用伤害 = 最终伤势 × 反震倍率
  // 反震倍率：外 16%-80%，内 16%-80%
  const reflectDmg = {
    outer: Math.floor(finalDamage.outer * skill.reflect.outer / 1000),
    inner: Math.floor(finalDamage.inner * skill.reflect.inner / 1000),
  };

  // 反震伤害不可再被反震（标记 source: 'reflect'）
  applyDirectDamage(s, 1 - defenderIdx as 0 | 1, reflectDmg, 'reflect');
}

/** 常规反震（特定特效） */
export function resolveNormalReflect(
  s: CombatState,
  defenderIdx: 0 | 1,
  regularDamage: { outer: number; inner: number },
  source: 'attack' | 'technique',
): void {
  // 反弹所受常规伤害的 60%(普攻) / 30%(功法)
  const ratio = source === 'attack' ? 600 : 300;
  const reflectDmg = {
    outer: Math.floor(regularDamage.outer * ratio / 1000),
    inner: Math.floor(regularDamage.inner * ratio / 1000),
  };
  applyDirectDamage(s, 1 - defenderIdx as 0 | 1, reflectDmg, 'reflect');
}
```

---

## 7. 点穴与破绽（`src/core/combat/sealFlaw.ts`）

```ts
const SEAL_DEBUFF: Record<BodyPart, { stat: string; perLayer: number }> = {
  head:     { stat: 'castSpeed',       perLayer: 50 },  // 施展速度 -5%/层
  chest:    { stat: 'breathSpeed',     perLayer: 50 },  // 提气速度 -5%/层
  waist:    { stat: 'postureSpeed',    perLayer: 50 },  // 架势速度 -5%/层
  leftArm:  { stat: 'weaponSwitch',    perLayer: 50 },  // 武器切换 -5%/层
  rightArm: { stat: 'attackSpeed',     perLayer: 50 },  // 攻击速度 -5%/层
  leftLeg:  { stat: 'moveDistance',    perLayer: 50 },  // 移动距离 -5%/层
  rightLeg: { stat: 'moveSpeed',       perLayer: 50 },  // 移动速度 -5%/层
};

const FLAW_DEBUFF: Record<BodyPart, { stat: string; perLayer: number }> = {
  head:     { stat: 'breathHit',       perLayer: 50 },  // 内息 -5%/层
  chest:    { stat: 'deflectAvoid',    perLayer: 50 },  // 卸力 -5%/层
  waist:    { stat: 'forceHit',        perLayer: 50 },  // 力道 -5%/层
  leftArm:  { stat: 'parryAvoid',      perLayer: 50 },  // 拆招 -5%/层
  rightArm: { stat: 'subtleHit',       perLayer: 50 },  // 精妙 -5%/层
  leftLeg:  { stat: 'dodgeAvoid',      perLayer: 50 },  // 闪避 -5%/层
  rightLeg: { stat: 'swiftHit',        perLayer: 50 },  // 迅疾 -5%/层
};

/** 施加点穴 */
export function addSeal(fighter: FighterState, part: BodyPart, layers: number): void {
  const current = fighter.seals[part] ?? 0;
  const newVal = Math.min(10, current + layers);
  const added = newVal - current;
  fighter.seals[part] = newVal;

  // 更新 StatStack 减益
  const debuff = SEAL_DEBUFF[part];
  if (debuff) {
    adjustStatMod(fighter, debuff.stat, -added * debuff.perLayer, 'seal_' + part);
  }
}

/** 施加破绽 */
export function addFlaw(fighter: FighterState, part: BodyPart, layers: number): void {
  const current = fighter.flaws[part] ?? 0;
  const newVal = Math.min(10, current + layers);
  const added = newVal - current;
  fighter.flaws[part] = newVal;

  const debuff = FLAW_DEBUFF[part];
  if (debuff) {
    adjustStatMod(fighter, debuff.stat, -added * debuff.perLayer, 'flaw_' + part);
  }
}

/** 战前旧伤带入点穴/破绽：约每 20% 伤势带 1 层 */
export function applyPreExistingWounds(fighter: FighterState, wounds: Wound[]): void {
  for (const w of wounds) {
    const severity = Math.floor((w.outer + w.inner) / 200); // 每 20% 伤势 1 层
    if (severity > 0 && w.part !== 'spirit' && w.part !== 'poison' && w.part !== 'whole') {
      // 内伤多 → 点穴；外伤多 → 破绽
      if (w.inner >= w.outer) {
        addSeal(fighter, w.part, Math.min(severity, 3));
      } else {
        addFlaw(fighter, w.part, Math.min(severity, 3));
      }
    }
  }
}
```

---

## 8. 功法特效解释器 v1（`src/core/combat/effect.ts`）

### 8.1 DSL 结构

```ts
interface EffectSpec {
  id: string;
  trigger: EffectTrigger;
  when?: Condition[];
  ops: EffectOp[];
}

type EffectTrigger =
  | 'onAttackHit'          // 普攻命中时
  | 'onAttackDodged'       // 普攻被化解时
  | 'onChangeMoveSuccess'  // 变招成功时
  | 'onTechniqueCast'      // 功法施展开始
  | 'onTechniqueResolved'  // 功法出手结算后（带成数）
  | 'onGuardBroken'        // 守御被击破时
  | 'onCounter'            // 反击时
  | 'onWound'              // 受伤时
  | 'everyNFrames'         // 每 N 帧
  | 'onStanceGained'       // 获得式时
  | 'onCombatStart'        // 战斗开始时
  | 'onDefeat';            // 战败时

type Condition =
  | { type: 'distanceRange'; min: number; max: number }
  | { type: 'partHasSeal'; part: BodyPart }
  | { type: 'partHasFlaw'; part: BodyPart }
  | { type: 'tenthsGte'; value: number }
  | { type: 'stanceCountGte'; value: number }
  | { type: 'breathDisorder'; level: number }  // 内息紊乱分档
  | { type: 'guardBroken' }
  | { type: 'healthBelow'; threshold: number };
```

### 8.2 M1 实现的 12 个操作

```ts
type EffectOp =
  | { type: 'modStat'; stat: string; value: number; duration: number }
  | { type: 'addSeal'; part: BodyPart | 'target'; layers: number }
  | { type: 'addFlaw'; part: BodyPart | 'target'; layers: number }
  | { type: 'grantStance'; stance: StanceType; count: number }
  | { type: 'removeStance'; target: 'self' | 'enemy'; count: number }
  | { type: 'modProgress'; bar: 'breath' | 'posture' | 'attack' | 'move'; delta: number }
  | { type: 'trueDamage'; part: BodyPart; amount: number }
  | { type: 'modMultCap'; stat: 'penetrationCap'; value: number; duration: number }
  | { type: 'bypassDualFull'; duration: number }
  | { type: 'modDealDamage'; outer: number; inner: number; duration: number }
  | { type: 'heal'; part: BodyPart; amount: number }
  | { type: 'addPoison'; poisonType: string; amount: number };
```

### 8.3 引擎

```ts
export function triggerEffects(
  s: CombatState,
  side: 0 | 1,
  trigger: EffectTrigger,
  context: Record<string, any>,
): void {
  const fighter = s.sides[side].main;
  const activeEffects = fighter.effects.filter(e => e.spec.trigger === trigger);

  for (const ae of activeEffects) {
    // 检查条件
    if (ae.spec.when && !ae.spec.when.every(c => evalCondition(c, s, side, context))) continue;

    // 执行操作
    for (const op of ae.spec.ops) {
      executeOp(s, side, op, context);
    }
  }
}

function evalCondition(c: Condition, s: CombatState, side: 0 | 1, ctx: Record<string, any>): boolean {
  const f = s.sides[side].main;
  switch (c.type) {
    case 'distanceRange': return s.distance >= c.min && s.distance <= c.max;
    case 'partHasSeal': return (f.seals[c.part] ?? 0) > 0;
    case 'partHasFlaw': return (f.flaws[c.part] ?? 0) > 0;
    case 'tenthsGte': return (ctx.tenths ?? 0) >= c.value;
    case 'stanceCountGte': return f.stanceState.held.length >= c.value;
    case 'breathDisorder': return getBreathDisorderLevel(f) >= c.level;
    case 'guardBroken': return f.guardBroken;
    case 'healthBelow': return f.outerTotal >= c.threshold || f.innerTotal >= c.threshold;
    default: return true;
  }
}

function executeOp(s: CombatState, side: 0 | 1, op: EffectOp, ctx: Record<string, any>): void {
  const f = s.sides[side].main;
  const enemy = s.sides[1 - side as 0 | 1].main;

  switch (op.type) {
    case 'modStat':
      pushEffect(f, op.stat, op.value, op.duration);
      break;
    case 'addSeal': {
      const part = op.part === 'target' ? (ctx.part as BodyPart) : op.part;
      addSeal(enemy, part, op.layers);
      break;
    }
    case 'addFlaw': {
      const part = op.part === 'target' ? (ctx.part as BodyPart) : op.part;
      addFlaw(enemy, part, op.layers);
      break;
    }
    case 'grantStance':
      for (let i = 0; i < op.count; i++) gainStance(f.stanceState, op.stance);
      break;
    case 'removeStance': {
      const target = op.target === 'self' ? f : enemy;
      for (let i = 0; i < op.count && target.stanceState.held.length > 0; i++) {
        const idx = s.rng.nextInt(0, target.stanceState.held.length - 1);
        target.stanceState.held.splice(idx, 1);
      }
      break;
    }
    case 'modProgress':
      switch (op.bar) {
        case 'breath': f.breath = clamp(f.breath + op.delta, 0, 30000); break;
        case 'posture': f.posture = clamp(f.posture + op.delta, 0, 30000); break;
        case 'attack': f.attackProgress = Math.max(0, f.attackProgress + op.delta); break;
        case 'move': f.moveProgress = Math.max(0, f.moveProgress + op.delta); break;
      }
      break;
    case 'trueDamage':
      applyDirectDamage(s, 1 - side as 0 | 1,
        { outer: 0, inner: op.amount }, 'true', op.part);
      break;
    case 'modMultCap':
      pushEffect(f, op.stat, op.value, op.duration);
      break;
    case 'bypassDualFull':
      pushEffect(f, 'bypassDualFull', 1, op.duration);
      break;
    case 'modDealDamage':
      pushEffect(f, 'dealOuter', op.outer, op.duration);
      pushEffect(f, 'dealInner', op.inner, op.duration);
      break;
    case 'heal': {
      // 减少该部位伤势
      const woundIdx = f.wounds.findIndex(w => w.part === op.part);
      if (woundIdx >= 0) {
        f.wounds[woundIdx].outer = Math.max(0, f.wounds[woundIdx].outer - op.amount);
        f.wounds[woundIdx].inner = Math.max(0, f.wounds[woundIdx].inner - op.amount);
      }
      break;
    }
    case 'addPoison':
      f.poison[op.poisonType] = (f.poison[op.poisonType] ?? 0) + op.amount;
      break;
  }
}
```

---

## 9. 身法功法（移动力赋予）

补充 WO1 的移动系统：

```ts
/** 身法功法出手 */
export function resolveMovementArt(
  s: CombatState,
  casterIdx: 0 | 1,
  art: MovementArtData,
): void {
  const f = s.sides[casterIdx].main;

  // 扣移动力 = 占格数
  const cost = art.mobilityCost;
  if (f.mobility.skill >= cost) {
    f.mobility.skill -= cost;
  } else {
    const remaining = cost - f.mobility.skill;
    f.mobility.skill = 0;
    f.mobility.white = Math.max(0, f.mobility.white - remaining);
  }

  // 赋予身法移动力
  f.mobility.skill += art.grant.count;
  f.mobility.skill = Math.min(6, f.mobility.skill);
  f.mobility.skillTimer = art.grant.decayFrames; // 每 N 帧衰减 1

  // 移速/移动距离加成推入 StatStack
  pushEffect(f, 'moveSpeed', art.moveSpeed, art.grant.decayFrames * art.grant.count);
  pushEffect(f, 'moveStep', art.moveStep, art.grant.decayFrames * art.grant.count);

  emitEvent(s, 'movementArt', { side: casterIdx, artId: art.id });
}
```

---

## 10. AI v1（`src/core/combat/ai.ts`）

### 10.1 主循环

```ts
export function tickAI(s: CombatState): void {
  for (const sideIdx of [0, 1] as const) {
    const side = s.sides[sideIdx];
    if (side.isPlayer) continue;

    const ai = side.ai!;
    if (s.frame % ai.thinkInterval !== 0) continue;

    const action = decideAction(s, sideIdx);
    if (action) {
      s.pendingActions.push(action);
    }
  }
}
```

### 10.2 距离决策

```ts
export function decideTargetDistance(
  s: CombatState,
  side: 0 | 1,
): number {
  const me = s.sides[side].main;
  const weapons = getEquippedWeapons(me);
  const memory = me.memory;

  // 为每个距离点（20-90，步长5）计算期望每帧伤势
  let bestD = s.distance;
  let bestScore = -Infinity;

  for (let d = 20; d <= 90; d += 5) {
    // E_self: 我在距离 d 能造成的期望伤势/帧
    let eSelf = 0;
    for (const w of weapons) {
      if (d >= w.range[0] && d <= w.range[1]) {
        eSelf += w.baseDamage / calcAttackInterval(w, me.stats.resolve('attackSpeed'));
      }
    }

    // 加上可用摧破在该距离的期望
    for (const art of getAvailableTechniques(me)) {
      const artRange = resolveArtRange(art, getCurrentWeapon(me));
      if (d >= artRange[0] && d <= artRange[1]) {
        eSelf += estimateTechniqueValue(art, me) / (calcCastTime(art, me.stats.resolve('castSpeed')) + 60);
      }
    }

    // E_enemy: 对方在距离 d 对我的威胁（从记忆估）
    const bucket = Math.floor(d / 10);
    const eEnemy = (memory.damageByDistance[bucket] ?? 0) / Math.max(1, s.frame);

    // 综合评分
    const k = getPersonalityK(me); // 勇壮高 → k 小（爱对攻），冷静高 → k 大（爱风筝）
    const score = eSelf - k * eEnemy;

    // 没有移动力时移动代价乘4
    const hasMobility = me.mobility.white > 0 || me.mobility.skill > 0;
    const moveCost = hasMobility ? Math.abs(d - s.distance) : Math.abs(d - s.distance) * 4;
    const adjustedScore = score - moveCost * 0.01;

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestD = d;
    }
  }

  return bestD;
}
```

### 10.3 施展决策

```ts
export function decideTechnique(
  s: CombatState,
  side: 0 | 1,
): CombatAction | null {
  const me = s.sides[side].main;
  if (me.cast) return null; // 已在施展中

  const techniques = getAvailableTechniques(me).filter(art => {
    const check = canCastTechnique(me, art);
    return check.ok;
  });

  if (techniques.length === 0) return null;

  // 选择评分最高的功法
  let bestArt: TechniqueData | null = null;
  let bestScore = 0;

  for (const art of techniques) {
    const artRange = resolveArtRange(art, getCurrentWeapon(me));

    // 预测施展完成时 d 是否仍在范围内
    const castFrames = calcCastTime(art, me.stats.resolve('castSpeed'));
    const enemy = s.sides[1 - side as 0 | 1].main;
    const predictedD = predictDistance(s, side, castFrames);
    const inRangeProb = (predictedD >= artRange[0] && predictedD <= artRange[1]) ? 1.0 : 0.3;

    if (inRangeProb < 0.5) continue; // 大概率打空就不施展

    // 评分：期望伤害 × 在范围概率
    const expectedDmg = art.damage * (art.partWeights ? 1 : 0.5);
    const score = expectedDmg * inRangeProb;

    if (score > bestScore) {
      bestScore = score;
      bestArt = art;
    }
  }

  if (bestArt) {
    return { type: 'cast', side, artId: bestArt.id };
  }
  return null;
}
```

### 10.4 防守反应

```ts
export function decideDefense(
  s: CombatState,
  side: 0 | 1,
): CombatAction | null {
  const me = s.sides[side].main;
  const enemy = s.sides[1 - side as 0 | 1].main;

  if (!enemy.cast) return null; // 对方没在施展

  const artId = enemy.cast.artId;
  const memory = me.memory.artResults[artId];

  // 专注 ≥ 500 或 记忆里该功法曾打出 ≥ 5 成 → 触发反应
  const shouldReact = me.focus >= 500 || (memory && memory.bestTenths >= 5);
  if (!shouldReact) return null;

  const enemyArt = getArtData(artId);
  const artRange = resolveArtRange(enemyArt, getCurrentWeapon(enemy));
  const remainCastFrames = enemy.cast.total - enemy.cast.progress;

  // 1. 能在对方施展完成前走出距离段？
  const escapeFrames = estimateEscapeFrames(s, side, artRange);
  if (escapeFrames < remainCastFrames) {
    // 走位
    const escapeD = s.distance < artRange[0] ? artRange[0] - 5 : artRange[1] + 5;
    return { type: 'setTargetDistance', side, value: clamp(escapeD, 20, 90) };
  }

  // 2. 双满且有护体绝技
  const guardSkills = getAvailableGuardSkills(me);
  if (guardSkills.length > 0 && me.breath >= 30000 && me.posture >= 30000) {
    return { type: 'cast', side, artId: guardSkills[0].id };
  }

  // 3. 有可用身法
  const moveArts = getAvailableMovementArts(me);
  if (moveArts.length > 0) {
    return { type: 'cast', side, artId: moveArts[0].id };
  }

  return null;
}
```

### 10.5 自动变招

```ts
export function autoChangeMovePriority(
  fighter: FighterState,
  enemy: FighterState,
): BodyPart | null {
  const bodyParts: BodyPart[] = ['chest', 'waist', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];

  // 优先级 1：有破绽的部位
  for (const part of bodyParts) {
    if ((enemy.flaws[part] ?? 0) > 0) return part;
  }

  // 优先级 2：有点穴的部位
  for (const part of bodyParts) {
    if ((enemy.seals[part] ?? 0) > 0) return part;
  }

  // 优先级 3：随机
  return bodyParts[Math.floor(Math.random() * bodyParts.length)]; // 注意实际用 rng
}
```

### 10.6 逃跑决策

```ts
export function decideEscape(
  s: CombatState,
  side: 0 | 1,
): boolean {
  const me = s.sides[side].main;
  const ai = s.sides[side].ai!;

  if (s.kind === 'duel') return false;         // 死斗不能逃
  if (ai.difficulty === 0) return false;        // 最低难度禁用逃跑

  // 伤势达到战败条件的 (40 + 勇壮权重)% 且非死斗
  const threshold = DEFEAT_THRESHOLD[s.kind];
  const outerPct = me.outerTotal * 1000 / threshold.outer;
  const innerPct = me.innerTotal * 1000 / threshold.inner;
  const damagePct = Math.max(outerPct, innerPct);

  const fleeThreshold = 400 + ai.personality.brave * 2; // 千分比
  return damagePct >= fleeThreshold;
}
```

### 10.7 难度档参数

```ts
interface AIDifficulty {
  thinkInterval: number;      // 思考间隔帧数
  actions: Set<string>;       // 可用行动集合
  predictionSteps: number;    // 预测步数
  noise: number;              // 随机扰动 σ
  statMults: {                // 属性系数
    attackSpeed: number;
    moveSpeed: number;
    hit: number;
    penetrate: number;
    avoid: number;
    guard: number;
  };
}

const AI_DIFFICULTIES: AIDifficulty[] = [
  { // 最低难度
    thinkInterval: 30,
    actions: new Set(['setTargetDistance', 'switchWeapon']),
    predictionSteps: 0,
    noise: 200,
    statMults: { attackSpeed: 500, moveSpeed: 750, hit: 500, penetrate: 500, avoid: 500, guard: 500 },
  },
  { // 普通
    thinkInterval: 20,
    actions: new Set(['setTargetDistance', 'switchWeapon', 'cast', 'heal']),
    predictionSteps: 1,
    noise: 100,
    statMults: { attackSpeed: 1000, moveSpeed: 1000, hit: 1000, penetrate: 1000, avoid: 1000, guard: 1000 },
  },
  { // 困难
    thinkInterval: 10,
    actions: new Set(['setTargetDistance', 'switchWeapon', 'cast', 'heal', 'detox']),
    predictionSteps: 3,
    noise: 50,
    statMults: { attackSpeed: 1000, moveSpeed: 1000, hit: 1000, penetrate: 1000, avoid: 1000, guard: 1000 },
  },
  { // 最高
    thinkInterval: 6,
    actions: new Set(['setTargetDistance', 'switchWeapon', 'cast', 'heal', 'detox']),
    predictionSteps: 5,
    noise: 0,
    statMults: { attackSpeed: 1000, moveSpeed: 1000, hit: 1000, penetrate: 1000, avoid: 1000, guard: 1000 },
  },
];
```

---

## 11. AI 对 AI 批量模拟

```ts
// tools/ai-benchmark.ts
// 验收脚本：无头模式 1000 场 AI vs AI

interface BenchmarkConfig {
  runs: number;
  maxFrames: number;         // 每场上限帧数（防死循环）
  configs: [AIDifficulty, AIDifficulty]; // 双方难度
  mirror: boolean;           // 是否镜像装备
}

interface BenchmarkResult {
  side0Wins: number;
  side1Wins: number;
  draws: number;             // 超时
  avgFrames: number;
  avgSeconds: number;
  winRate: number;           // side0 胜率
}

// 验收标准：
// 1. 同装备镜像对局胜率 50% ± 3%
// 2. 高难度对低难度胜率 > 80%
// 3. 平均时长 40-120 秒（2400-7200 帧）
// 4. 无崩溃、无死循环
```

---

## 12. M1 测试数据集

由于 M1 还没有从 wiki 提取功法数据，使用手写测试数据：

```ts
// tests/fixtures/testArts.ts

/** 测试用摧破功法（模拟七品剑法） */
export const TEST_SWORD_TECHNIQUE: TechniqueData = {
  id: 'test_sword_1',
  type: 'destroy',
  grade: 7,
  stanceCost: [{ type: 'chop', count: 2 }, { type: 'stab', count: 1 }],
  gaugeTotal: 1000,     // 100% 提气+架势
  breathShare: 500,     // 各 50%
  castTime: 180,        // 最大施展时间
  hit: { force: 4, swift: 3, subtle: 3 },  // 10 成分配
  damage: 150,          // 功法基伤
  innerRatioBase: 300,  // 30% 基础内功比例
  range: { mode: 'weaponPlus', delta: 0 },
  partWeights: { chest: 40, waist: 30, leftArm: 10, rightArm: 10, leftLeg: 5, rightLeg: 5 },
};

/** 测试用护体绝技（模拟七品） */
export const TEST_GUARD_SKILL: GuardSkillData = {
  id: 'test_guard_1',
  gaugeTotal: 600,      // 60%
  breathShare: 500,
  castTime: 60,
  duration: 300,        // 5 秒
  guardFlat: { outer: 50, inner: 30 },
  guardPct: { outer: 200, inner: 150 },
  avoid: { absorb: 100, parry: 80, dodge: 60 },
  counter: { range: [20, 50], power: 2000, channel: 'force' },
  reflect: { outer: 300, inner: 200 },
};

/** 测试用身法 */
export const TEST_MOVEMENT_ART: MovementArtData = {
  id: 'test_move_1',
  castTime: 30,
  mobilityCost: 1,
  moveSpeed: 1500,     // +50% 移速
  moveStep: 1500,      // +50% 移动距离
  grant: { count: 3, decayFrames: 100 },
};
```

---

## 13. 交付检查清单

- [ ] 摧破四段判定完整实现，施展时间黄金测试（220÷2.2=100帧）通过
- [ ] 距离检查：施展时不在距离段 → 0 成
- [ ] 功法伤害分支与 WO2 普攻伤害链共享 (1)-(6)，仅步骤 (4) 分叉
- [ ] 护体绝技施展、持续效果（移速减半、不回提气架势、化解加成）
- [ ] 反击条件判定（护体带反击 + 通道匹配 + 距离 + 非音式 + 化解成功）
- [ ] 反击中断追击
- [ ] 反震（绝技反震 + 常规反震），反震伤害不可再反震
- [ ] 点穴/破绽：施加、上限 10 层、7 个部位减益表全部实现
- [ ] 战前旧伤带入点穴/破绽
- [ ] 特效解释器 v1：12 个操作全部实现，触发器 + 条件 + 操作三层结构
- [ ] 身法功法：移动力赋予（上限 6）、衰减（每 100 帧 -1）
- [ ] AI 距离决策：效用评估 + 记忆
- [ ] AI 施展决策：双满 + 式够 + 预测距离
- [ ] AI 防守反应：专注 ≥500 或记忆 ≥5 成 → 走位/护体/身法
- [ ] AI 自动变招：破绽 → 点穴 → 随机
- [ ] AI 逃跑：伤势阈值 + 非死斗 + 非最低难度
- [ ] 4 个难度档参数配置
- [ ] 镜像对局 1000 场胜率 50%±3%
- [ ] 高难度对低难度 1000 场胜率 >80%
- [ ] 平均时长 40-120 秒
- [ ] 测试数据集（剑法/护体/身法各 1 个）可正常跑完整战斗
