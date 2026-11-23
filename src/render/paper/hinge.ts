/** 铰链弹簧（纯函数，无 three 依赖）。θ：0 = 平躺（面朝上，顶边远离镜头），π/2 = 立正。 */
export const enum HingeState { FLAT = 0, RISE = 1, LOCKED = 2, FALL = 3 }

export interface HingeParams {
  omega: number;     // 固有频率 rad/s
  zeta: number;      // 阻尼比；< 1 有过冲
  restAngle: number; // 立正角
}
export const HINGE_RISE: HingeParams = { omega: 16, zeta: 0.42, restAngle: Math.PI / 2 }; // 过冲约 20%
export const HINGE_FALL: HingeParams = { omega: 12, zeta: 1.0, restAngle: 0 };
export const HINGE_HALF = 15 * Math.PI / 180;

/** 半隐式欧拉，内部按 ≤ 1/120 s 细分；返回是否已静止。 */
export function stepHinge(
  s: { theta: number; vel: number }, target: number, p: HingeParams, dt: number,
): boolean {
  const n = Math.max(1, Math.ceil(dt * 120)), h = dt / n;
  const k = p.omega * p.omega, c = 2 * p.zeta * p.omega;
  for (let i = 0; i < n; i++) {
    s.vel += (-k * (s.theta - target) - c * s.vel) * h;
    s.theta += s.vel * h;
    if (s.theta < 0) { s.theta = 0; s.vel = Math.abs(s.vel) * 0.25; } // 不穿地，轻弹
  }
  const rest = Math.abs(s.theta - target) < 0.002 && Math.abs(s.vel) < 0.02;
  if (rest) { s.theta = target; s.vel = 0; }
  return rest;
}

/** 临界阻尼弹簧（闭式解，任意 dt 稳定）。 */
export function stepSpring(
  s: { x: number; v: number }, target: number, omega: number, dt: number,
): void {
  const e = s.x - target, t = s.v + omega * e, ex = Math.exp(-omega * dt);
  s.x = target + (e + t * dt) * ex;
  s.v = (s.v - omega * t * dt) * ex;
}

/** 状态机一步：给定状态与目标角，推进并返回新状态（PaperCard / PaperBatch 共用）。 */
export function advanceHinge(
  s: { theta: number; vel: number }, state: HingeState, target: number, dt: number,
): HingeState {
  const p = state === HingeState.FALL ? HINGE_FALL : HINGE_RISE;
  const rest = stepHinge(s, target, p, dt);
  if (!rest) return state;
  if (state === HingeState.FALL) return HingeState.FLAT;
  if (state === HingeState.RISE) return target > 0 ? HingeState.LOCKED : HingeState.FLAT;
  return state;
}
