/** 省片五态与弹簧（纯函数 / 无 three 依赖）。工单 M3-WO2 §3.2。 */
import { stepSpring } from '../../render/paper/hinge';

export type PieceState = 'idle' | 'hover' | 'selected' | 'dimmed' | 'locked';
export interface PieceTarget { lift: number; accent: number; dim: number; sat: number; rim: number }

export const LAYER_STEP = 0.045;
export const SELECTED_LIFT = 3 * LAYER_STEP + 0.08;

export const PIECE_TARGETS: Record<PieceState, PieceTarget> = {
  idle:     { lift: 0,    accent: 0, dim: 1.0,  sat: 1.0, rim: 1.0 },
  hover:    { lift: 0.04, accent: 0, dim: 1.04, sat: 1.0, rim: 1.25 },
  selected: { lift: 0.08, accent: 1, dim: 1.0,  sat: 1.0, rim: 1.25 },
  dimmed:   { lift: 0,    accent: 0, dim: 0.9,  sat: 0.75, rim: 0.95 },   // 底图本身偏暗，压暗调轻
  locked:   { lift: 0,    accent: 0, dim: 0.9,  sat: 0.0, rim: 0.9 },
};

export interface PieceViewLike { id: string; locked: boolean }

export function stateOf(p: PieceViewLike, sel: string | null, hov: string | null): PieceState {
  if (p.locked) return 'locked';
  if (sel === p.id) return 'selected';
  if (hov === p.id) return 'hover';
  return sel ? 'dimmed' : 'idle';
}

/** 绝对抬升目标（相对地面）：基础档高 + 状态抬升；选中统一升到最高档之上。 */
export function liftTarget(state: PieceState, layerHeight: number): number {
  if (state === 'selected') return SELECTED_LIFT;
  return layerHeight * LAYER_STEP + PIECE_TARGETS[state].lift;
}

const OMEGA = 28, LIFT_OMEGA = 22, LIFT_ZETA = 0.6;

/** 欠阻尼弹簧（半隐式欧拉，按 1/240s 细分）。 */
export function stepDamped(s: { x: number; v: number }, target: number, omega: number, zeta: number, dt: number): void {
  const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-omega * omega * (s.x - target) - 2 * zeta * omega * s.v) * h;
    s.x += s.v * h;
  }
}

export class PieceSprings {
  lift = { x: 0, v: 0 };
  accent = { x: 0, v: 0 };
  dim = { x: 1, v: 0 };
  sat = { x: 1, v: 0 };
  rim = { x: 1, v: 0 };
  state: PieceState = 'idle';
  /** 额外抬升（脉冲、抖动、进场演出）。 */
  extraLift = 0;
  /** 压暗下限覆盖（dive 期间 0.5）。 */
  dimOverride: number | null = null;

  constructor(public layerHeight: number) { this.lift.x = liftTarget('idle', layerHeight); }

  snap(): void {
    const t = PIECE_TARGETS[this.state];
    this.lift.x = liftTarget(this.state, this.layerHeight); this.lift.v = 0;
    this.accent.x = t.accent; this.dim.x = t.dim; this.sat.x = t.sat; this.rim.x = t.rim;
    this.accent.v = this.dim.v = this.sat.v = this.rim.v = 0;
  }

  step(dt: number, reduced = false): void {
    const t = PIECE_TARGETS[this.state];
    const om = reduced ? 40 : OMEGA;
    const lt = liftTarget(this.state, this.layerHeight) + this.extraLift;
    if (reduced) stepSpring(this.lift, lt, om, dt); else stepDamped(this.lift, lt, LIFT_OMEGA, LIFT_ZETA, dt);
    stepSpring(this.accent, t.accent, om, dt);
    stepSpring(this.dim, this.dimOverride ?? t.dim, om, dt);
    stepSpring(this.sat, t.sat, om, dt);
    stepSpring(this.rim, t.rim, om, dt);
  }

  /** 全部到位（静止）。 */
  settled(): boolean {
    const t = PIECE_TARGETS[this.state];
    const near = (s: { x: number; v: number }, g: number) => Math.abs(s.x - g) < 1e-3 && Math.abs(s.v) < 1e-2;
    return near(this.lift, liftTarget(this.state, this.layerHeight) + this.extraLift) && near(this.accent, t.accent)
      && near(this.dim, this.dimOverride ?? t.dim) && near(this.sat, t.sat) && near(this.rim, t.rim);
  }
}
