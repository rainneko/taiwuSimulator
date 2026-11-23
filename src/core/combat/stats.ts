import type { BodyPart, FighterState, FighterStats, HitChannel } from './types';

/**
 * 有效属性解析：基础属性 + StatMod 加成，再乘点穴/破绽/守御尽破减益。
 *
 * 点穴（§5.10，每层 -5%）：头颈施展速度 / 胸背提气速度 / 腰腹架势速度 / 左臂兵器切换 /
 *   右臂攻击速度 / 左腿移动距离 / 右腿移动速度
 * 破绽（每层 -5%）：头颈内息 / 胸背卸力 / 腰腹力道 / 左臂拆招 / 右臂精妙 / 左腿闪避 / 右腿迅疾
 */
export const SEAL_DEBUFF: Record<BodyPart, string> = {
  head: 'castSpeed', chest: 'breathSpeed', waist: 'postureSpeed', leftArm: 'weaponSwitch',
  rightArm: 'attackSpeed', leftLeg: 'moveDistance', rightLeg: 'moveSpeed',
};
export const FLAW_DEBUFF: Record<BodyPart, string> = {
  head: 'innerBreath', chest: 'dodgeDeflect', waist: 'hitPower', leftArm: 'dodgeParry',
  rightArm: 'hitSkill', leftLeg: 'dodgeEvade', rightLeg: 'hitSpeed',
};
export const DEBUFF_PER_LAYER = 50; // 千分比

/** 守御尽破后护体、御气 -40% */
export const GUARD_BREAK_DEBUFF = 400;

export function modSum(f: FighterState, stat: string): number {
  let v = 0;
  for (const m of f.statMods) if (m.stat === stat) v += m.value;
  return v;
}

export function hasMod(f: FighterState, stat: string): boolean {
  return f.statMods.some(m => m.stat === stat);
}

/** 点穴/破绽对某属性的倍率（千分比） */
export function debuffMult(f: FighterState, stat: string): number {
  let layers = 0;
  for (const p of Object.keys(SEAL_DEBUFF) as BodyPart[]) {
    if (SEAL_DEBUFF[p] === stat) layers += f.wounds[p].acupoints;
    if (FLAW_DEBUFF[p] === stat) layers += f.wounds[p].weakness;
  }
  return Math.max(0, 1000 - layers * DEBUFF_PER_LAYER);
}

/** 有效属性值（整数） */
export function statOf(f: FighterState, stat: keyof FighterStats | string): number {
  const base = (f.stats as unknown as Record<string, number>)[stat] ?? 0;
  let v = base + modSum(f, stat);
  // 护体绝技的百分比加成：xxx_pct（千分比）
  const pct = modSum(f, stat + '_pct');
  if (pct) v = Math.floor(v * (1000 + pct) / 1000);
  v = Math.floor(v * debuffMult(f, stat) / 1000);
  if (f.guardBroken && (stat === 'protection' || stat === 'qiControl')) {
    v = Math.floor(v * (1000 - GUARD_BREAK_DEBUFF) / 1000);
  }
  return v;
}

export const HIT_STAT: Record<HitChannel, keyof FighterStats> = {
  power: 'hitPower', speed: 'hitSpeed', skill: 'hitSkill',
};
export const AVOID_STAT: Record<HitChannel, keyof FighterStats> = {
  power: 'dodgeDeflect', speed: 'dodgeEvade', skill: 'dodgeParry',
};

export function pushMod(f: FighterState, stat: string, value: number, duration: number, source = 'effect'): void {
  if (duration <= 0 || value === 0 && stat !== 'bypassDualFull') return;
  f.statMods.push({ stat, value, remain: duration, source });
}

export function removeModsBySource(f: FighterState, source: string): void {
  f.statMods = f.statMods.filter(m => m.source !== source);
}

export function tickStatMods(f: FighterState): void {
  if (f.statMods.length === 0) return;
  for (const m of f.statMods) m.remain--;
  f.statMods = f.statMods.filter(m => m.remain > 0);
}
