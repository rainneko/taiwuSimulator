import { DataTexture, LinearFilter, type Material, RGFormat, UnsignedByteType } from 'three';
import type { PaperShader } from '../../render/paper';

/** 视野半径缺省 1（切比雪夫距离 = 3×3）。 */
export const VIEW_RADIUS = 1;
const FADE_S = 0.3;

/**
 * tExplored（RG8，N×N，LinearFilter）：R = 已探索，G = 在视野内。
 * 地面、立牌、填充小件、地面散件都按世界 xz 查同一张；棋子不查。
 */
export class Visibility {
  readonly texture: DataTexture;
  private data: Uint8Array;
  private cur: Float32Array;
  private goal: Float32Array;
  private animating = false;
  readonly uniforms = { tExplored: { value: null as unknown as DataTexture }, uVisN: { value: 1 } };

  constructor(readonly n: number) {
    this.data = new Uint8Array(n * n * 2);
    this.cur = new Float32Array(n * n);
    this.goal = new Float32Array(n * n);
    this.texture = new DataTexture(this.data, n, n, RGFormat, UnsignedByteType);
    this.texture.magFilter = this.texture.minFilter = LinearFilter;
    this.texture.needsUpdate = true;
    this.uniforms.tExplored.value = this.texture;
    this.uniforms.uVisN.value = n;
  }

  /** 棋子到达新格：更新视野与已探索；instant 用于进场。 */
  setCenter(cell: number, instant = false, radius = VIEW_RADIUS): void {
    const n = this.n, cx = cell % n, cz = (cell / n) | 0;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const i = z * n + x, vis = Math.max(Math.abs(x - cx), Math.abs(z - cz)) <= radius ? 1 : 0;
      this.goal[i] = vis;
      if (vis) this.data[i * 2] = 255;
      if (instant) this.cur[i] = vis;
    }
    this.animating = true;
    this.write();
  }

  update(dt: number): void {
    if (!this.animating) return;
    const step = dt / FADE_S;
    let moving = false;
    for (let i = 0; i < this.cur.length; i++) {
      const d = this.goal[i] - this.cur[i];
      if (d === 0) continue;
      this.cur[i] = Math.abs(d) <= step ? this.goal[i] : this.cur[i] + Math.sign(d) * step;
      moving = true;
    }
    this.write();
    this.animating = moving;
  }

  private write(): void {
    for (let i = 0; i < this.cur.length; i++) this.data[i * 2 + 1] = Math.round(this.cur[i] * 255);
    this.texture.needsUpdate = true;
  }

  dispose(): void { this.texture.dispose(); }

  /** 给任意 PaperMaterial（含 PaperBatch 内部材质）追加视野灰化；在已有 onBeforeCompile 之后执行。 */
  attach(mat: Material, tag: string): void {
    const prev = mat.onBeforeCompile.bind(mat);
    const prevKey = mat.customProgramCacheKey.bind(mat);
    mat.onBeforeCompile = (s, r) => { prev(s, r); patchVisibility(s as unknown as PaperShader, this.uniforms); };
    mat.customProgramCacheKey = () => `${prevKey()}|vis:${tag}`;
    mat.needsUpdate = true;
  }
}

export const VIS_GLSL_DECL = /* glsl */ `
uniform sampler2D tExplored;
uniform float uVisN;
vec3 visGrey( vec3 col, vec2 xz ) {
	float vis = texture2D( tExplored, xz / uVisN ).g;
	vec3 grey = vec3( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) * 0.8 + 0.1 );
	return mix( grey, col, 0.15 + 0.85 * vis );
}`;

/** 顶点算世界 xz（兼容 BatchedMesh / InstancedMesh），片元在出光前灰化。 */
export function patchVisibility(s: PaperShader, u: Record<string, { value: unknown }>): void {
  Object.assign(s.uniforms, u);
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vVisXZ;')
    .replace('#include <project_vertex>', `#include <project_vertex>
{
	vec4 visW = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
	visW = batchingMatrix * visW;
	#endif
	#ifdef USE_INSTANCING
	visW = instanceMatrix * visW;
	#endif
	vVisXZ = ( modelMatrix * visW ).xz;
}`);
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec2 vVisXZ;${VIS_GLSL_DECL}`)
    .replace('#include <opaque_fragment>', 'outgoingLight = visGrey( outgoingLight, vVisXZ );\n#include <opaque_fragment>');
}
