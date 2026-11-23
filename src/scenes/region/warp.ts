/**
 * 有机交界（WO3 v1.2 §3.2.3）：判定「这一点画成哪种地形」前先扭曲坐标，最大位移 0.16 格。
 * TS 与 GLSL 两份实现必须一致：着色器画交界，布置用 ownerAt 判定落点。
 */
import { mulberry32 } from './regionData';

export const WARP_AMP = 0.16;

export type WarpPhase = [number, number, number, number];

export function warpPhase(seed: number): WarpPhase {
  const r = mulberry32(seed ^ 0x9e3779b9);
  return [r() * 6.2832, r() * 6.2832, r() * 6.2832, r() * 6.2832];
}

export function gWarp(x: number, y: number, p: WarpPhase): [number, number] {
  return [
    WARP_AMP * (0.7 * Math.sin(2.6 * y + 0.8 * x + p[0]) + 0.3 * Math.sin(5.3 * y - 1.9 * x + p[1])),
    WARP_AMP * (0.7 * Math.sin(2.6 * x - 0.8 * y + p[2]) + 0.3 * Math.sin(5.3 * x + 1.9 * y + p[3])),
  ];
}

/** 世界 (x, z) 处画成哪一格的地形：返回格号（已 clamp 到地图内）。 */
export function ownerCellAt(x: number, z: number, n: number, p: WarpPhase): number {
  const [wx, wz] = gWarp(x, z, p);
  const cx = Math.min(n - 1, Math.max(0, Math.floor(x + wx)));
  const cz = Math.min(n - 1, Math.max(0, Math.floor(z + wz)));
  return cz * n + cx;
}

/** 着色器版；uniform vec4 uWarpPhase。 */
export const WARP_GLSL = /* glsl */ `
uniform vec4 uWarpPhase;
vec2 gWarp( vec2 g ) {
	vec4 p = uWarpPhase;
	return ${WARP_AMP.toFixed(2)} * vec2(
		0.7 * sin( 2.6 * g.y + 0.8 * g.x + p.x ) + 0.3 * sin( 5.3 * g.y - 1.9 * g.x + p.y ),
		0.7 * sin( 2.6 * g.x - 0.8 * g.y + p.z ) + 0.3 * sin( 5.3 * g.x + 1.9 * g.y + p.w ) );
}`;
