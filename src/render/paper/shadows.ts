/*
 * PCSS soft shadows — ported from papertrails (src/render/materials.js, patchShadowChunk).
 * https://github.com/xikhar/papertrails
 *
 * MIT License
 *
 * Copyright (c) 2026 Shikhar
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * Changes from the original: TypeScript, options instead of the global CONFIG, anchor misses throw
 * instead of falling back silently, BlobShadows (low tier) and the light-fitting helper added.
 */
import {
  BasicShadowMap, CircleGeometry, Color, DirectionalLight, DynamicDrawUsage, InstancedMesh, Material,
  MeshBasicMaterial, MultiplyBlending, Object3D, OrthographicCamera, ShaderChunk, WebGLRenderer,
} from 'three';

export interface PCSSOptions {
  /** 半影宽度 / 遮挡体到接收面的世界距离（papertrails 语义）。默认 0.3。 */
  lightSize?: number;
  blockerSamples?: number;   // 默认 12
  pcfSamples?: number;       // 默认 16
  /** 以下与 papertrails CONFIG.lights.shadow 同名同义 */
  near?: number; far?: number;
  bias?: number;             // 世界单位，沿光线方向
  sheetThickness?: number;
  searchRadius?: number;
  minPenumbraTexels?: number;
  maxPenumbra?: number;
  stockLeak?: number;        // 阴影里留的一点光
}

const DEFAULTS: Required<PCSSOptions> = {
  lightSize: 0.3, blockerSamples: 12, pcfSamples: 16,
  near: 1, far: 70, bias: 0.0045, sheetThickness: 0.07, searchRadius: 0.3,
  minPenumbraTexels: 2.4, maxPenumbra: 0.55, stockLeak: 0.05,
};

/** 三个锚点：VSM 分支起点、其后的 Basic `#else`、Basic 分支的 `#endif`。 */
export const PCSS_ANCHORS = ['#elif defined( SHADOWMAP_TYPE_VSM )', '\n\t#else', '\n\t#endif'] as const;

function buildPCSSCode(o: Required<PCSSOptions>): string {
  const f = (v: number) => Number(v).toFixed(6);
  const range = o.far - o.near;
  return /* glsl */ `	#else // SHADOWMAP_TYPE_BASIC (paper PCSS)

		#define PAPER_PCSS 1
		#define PAPER_BLOCKER_TAPS ${Math.round(o.blockerSamples)}
		#define PAPER_PCF_TAPS ${Math.round(o.pcfSamples)}

		float paperIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
		vec2 paperVogel( float i, float n, float phi ) {
			float r = sqrt( ( i + 0.5 ) / n );
			float t = i * 2.399963229728653 + phi;
			return vec2( cos( t ), sin( t ) ) * r;
		}

		// PCSS on the raw depth map: blocker search, receiver-plane depth bias, Vogel-disc PCF.
		vec2 paperPCSS( sampler2D shadowMap, vec2 shadowMapSize, float worldPerUv, float lightSize, vec4 shadowCoord ) {
			vec3 sc = shadowCoord.xyz / shadowCoord.w;
			vec3 dx = dFdx( sc );
			vec3 dy = dFdy( sc );
			if ( sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0 ) return vec2( 1.0 );
			const float range = ${f(range)};
			float det = dx.x * dy.y - dx.y * dy.x;
			vec2 grad = vec2( 0.0 );
			if ( abs( det ) > 1e-14 ) grad = vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;
			float slope = length( grad ) * range / worldPerUv;
			grad *= min( 1.0, 4.0 / max( slope, 1e-4 ) );
			float bias = ${f(o.bias)} / range;
			float thick = ${f(o.sheetThickness)} / range;
			float phi = paperIGN( gl_FragCoord.xy ) * 6.2831853;
			float rs = ${f(o.searchRadius)} / worldPerUv;
			float sumD = 0.0;
			float nB = 0.0;
			for ( int i = 0; i < PAPER_BLOCKER_TAPS; i ++ ) {
				vec2 o = paperVogel( float( i ), float( PAPER_BLOCKER_TAPS ), phi ) * rs;
				float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
				if ( d > bias ) { sumD += d; nB += 1.0; }
			}
			float penMin = ${f(o.minPenumbraTexels)} * worldPerUv / shadowMapSize.x;
			if ( nB < 0.5 ) {
				float rq = 0.5 * penMin / worldPerUv;
				vec2 l4 = vec2( 0.0 );
				for ( int i = 0; i < 4; i ++ ) {
					vec2 o = paperVogel( float( i ), 4.0, phi + 0.9 ) * rq;
					float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
					l4 += vec2( step( d, bias ), step( d, thick ) );
				}
				return l4 * 0.25;
			}
			float dAvg = sumD / nB * range;
			float pen = clamp( lightSize * dAvg, penMin, ${f(o.maxPenumbra)} );
			float rp = 0.5 * pen / worldPerUv;
			float lit = 0.0;
			float litT = 0.0;
			for ( int i = 0; i < PAPER_PCF_TAPS; i ++ ) {
				vec2 o = paperVogel( float( i ), float( PAPER_PCF_TAPS ), phi + 1.7 ) * rp;
				float d = sc.z + dot( grad, o ) - textureLod( shadowMap, sc.xy + o, 0.0 ).r;
				lit += step( d, bias );
				litT += step( d, thick );
			}
			return vec2( lit, litT ) / float( PAPER_PCF_TAPS );
		}

		// shadowRadius = world size of the shadow map, shadowBias = lightSize (see fitPCSSLight).
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float lit = paperPCSS( shadowMap, shadowMapSize, shadowRadius, shadowBias, shadowCoord ).x;
			return mix( 1.0, mix( ${f(o.stockLeak)}, 1.0, lit ), shadowIntensity );
		}
`;
}

let original: string | null = null;
let patchedOpts: Required<PCSSOptions> | null = null;

/** 在原始片段里定位 Basic 分支 [a, b)。找不到任一锚点即抛错。 */
export function locateBasicBranch(src: string): [number, number] {
  const v = src.indexOf(PCSS_ANCHORS[0]);
  if (v < 0) throw new Error('[shadows] 着色器锚点失效：shadowmap_pars_fragment / VSM 分支');
  const a0 = src.indexOf(PCSS_ANCHORS[1], v);
  if (a0 < 0) throw new Error('[shadows] 着色器锚点失效：shadowmap_pars_fragment / Basic #else');
  const a = a0 + 1;
  const b = src.indexOf(PCSS_ANCHORS[2], a);
  if (b < 0) throw new Error('[shadows] 着色器锚点失效：shadowmap_pars_fragment / Basic #endif');
  return [a, b];
}

/** 构造补丁后的片段（不改全局，便于测试）。 */
export function buildPCSSChunk(src: string, opts: PCSSOptions = {}): string {
  const [a, b] = locateBasicBranch(src);
  return src.slice(0, a) + buildPCSSCode({ ...DEFAULTS, ...opts }) + src.slice(b);
}

/** 幂等；必须在任何材质编译之前调用。把 renderer 的阴影类型设为 BasicShadowMap。 */
export function patchPCSS(renderer: WebGLRenderer | null, opts: PCSSOptions = {}): void {
  original ??= ShaderChunk.shadowmap_pars_fragment;
  const merged = { ...DEFAULTS, ...opts };
  if (!patchedOpts || JSON.stringify(patchedOpts) !== JSON.stringify(merged)) {
    ShaderChunk.shadowmap_pars_fragment = buildPCSSChunk(original, merged);
    patchedOpts = merged;
  }
  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = BasicShadowMap;
  }
}

export function isPCSSPatched(): boolean { return patchedOpts !== null; }

/** 换档时恢复原片段；传入场景根节点则把其下所有材质标 needsUpdate。 */
export function unpatchPCSS(root?: Object3D): void {
  if (original !== null) ShaderChunk.shadowmap_pars_fragment = original;
  patchedOpts = null;
  root?.traverse((o) => {
    const m = (o as { material?: Material | Material[] }).material;
    if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
    else if (m) m.needsUpdate = true;
  });
}

/**
 * 让方向光的阴影相机贴合场景（中心 = light.target），并按 PCSS 的约定写两个复用的 uniform：
 * shadow.radius = 阴影贴图覆盖的世界尺寸，shadow.bias = lightSize。
 */
export function fitPCSSLight(light: DirectionalLight, halfExtent: number, opts: { lightSize?: number; near?: number; far?: number; mapSize?: number } = {}): void {
  const cam = light.shadow.camera as OrthographicCamera;
  cam.left = -halfExtent; cam.right = halfExtent; cam.top = halfExtent; cam.bottom = -halfExtent;
  cam.near = opts.near ?? DEFAULTS.near; cam.far = opts.far ?? DEFAULTS.far;
  cam.updateProjectionMatrix();
  light.castShadow = true;
  if (opts.mapSize) light.shadow.mapSize.set(opts.mapSize, opts.mapSize);
  light.shadow.radius = 2 * halfExtent;
  light.shadow.bias = opts.lightSize ?? DEFAULTS.lightSize;
  light.shadow.normalBias = 0.0015;
}

/** low 档：一个 InstancedMesh，贴地椭圆，乘色混合。 */
export class BlobShadows {
  readonly mesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly col = new Color();

  constructor(capacity: number) {
    const geo = new CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    const mat = new MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, blending: MultiplyBlending, premultipliedAlpha: true,
    });
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) this.set(i, 0, 0, 0, 0, 0);
  }

  set(i: number, x: number, z: number, radiusX: number, radiusZ: number, strength: number): void {
    this.dummy.position.set(x, 0.002, z);
    this.dummy.scale.set(Math.max(radiusX, 1e-5), 1, Math.max(radiusZ, 1e-5));
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    const g = 1 - Math.max(0, Math.min(1, strength)) * 0.55;
    this.mesh.setColorAt(i, this.col.setRGB(g, g * 0.97, g * 0.93));
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as Material).dispose(); }
}
