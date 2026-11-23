/** 旅行动画时间表（纯函数）。工单 M3-WO2 §8.3。 */
export interface TravelPlan { hops: number; lineMs: number; hopMs: number; settleMs: number; totalMs: number }
export interface TravelFrame { lineProgress: number; hopIndex: number; hopU: number; curveT: number; cameraT: number; pulse: number }

export function planTravel(apCost: number): TravelPlan {
  const hops = Math.min(6, Math.max(2, Math.round(apCost / 10)));
  const lineMs = 260 + 40 * hops, hopMs = 230, settleMs = 260;
  return { hops, lineMs, hopMs, settleMs, totalMs: lineMs + hops * hopMs + settleMs };
}

const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function sampleTravel(plan: TravelPlan, tMs: number): TravelFrame {
  const t = Math.min(Math.max(0, tMs), plan.totalMs);
  const lineProgress = clamp01(t / plan.lineMs);
  const th = t - plan.lineMs, hopTotal = plan.hops * plan.hopMs;
  let hopIndex = 0, hopU = 0, curveT = 0;
  if (th >= hopTotal) { hopIndex = plan.hops - 1; hopU = 1; curveT = 1; }
  else if (th > 0) {
    hopIndex = Math.floor(th / plan.hopMs); hopU = (th - hopIndex * plan.hopMs) / plan.hopMs;
    // 跳内水平段 = 0.15–0.85，之外停在等分点
    const s = clamp01((hopU - 0.15) / 0.7);
    curveT = (hopIndex + s) / plan.hops;
  }
  const cameraT = easeInOut(clamp01(t / (plan.lineMs + hopTotal)));
  const ts = t - plan.lineMs - hopTotal;
  const pulse = ts > 0 ? Math.sin(Math.PI * clamp01(ts / plan.settleMs)) : 0;
  return { lineProgress, hopIndex, hopU, curveT, cameraT, pulse };
}
