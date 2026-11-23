import {
  Color, DoubleSide, FrontSide, MeshLambertMaterial, ShaderChunk, Texture, Vector2, Vector3,
} from 'three';
import { getFibreTexture } from './fibre';

export interface PaperShader {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

export interface PaperMaterialOptions {
  map?: Texture | null;        // 图集贴图；无贴图 = 纯色卡纸
  color?: number | string;     // 纯色卡纸的颜色，或贴图的整体染色
  cutout?: boolean;            // 有 alpha 镂空（立牌）。默认：有 map 则 true
  doubleSided?: boolean;       // 立牌 true（默认），地面 / 挤出体 false
  fibre?: number;
  rim?: boolean;               // 模切白边，默认随 cutout
  vertexSide?: boolean;        // 读顶点属性 aSide（0 顶面 / 1 侧面），侧面压暗
  /** 内置注入全部完成后调用，供个别场景追加着色。须同时给 cacheKey。 */
  extend?: { cacheKey: string; apply: (shader: PaperShader) => void };
}

export interface PaperLocals {
  uPaperFibre: { value: number };
  uPaperRim: { value: Vector3 };
  uPaperFlash: { value: number };
  uPaperFade: { value: number };
}

/** 所有 PaperMaterial 共用的 uniform 对象：改一处，全场生效。 */
export const paperGlobals = {
  uPaperFibreTex: { value: null as Texture | null },
  uPaperFibreScale: { value: 1.6 },
  uPaperLight: { value: new Vector2(0.35, 0.55) },        // x = wrap, y = 透射量
  uPaperTransTint: { value: new Color('#ffe9c4') },
  uPaperRimColor: { value: new Color('#fbf7ee') },
  uPaperSideDarken: { value: 0.72 },
};

const LAMBERT_ANCHOR =
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;';

/** 找不到锚点就抛错：three 升级后片段变了，必须人来看，不能静默失效。 */
export function replaceOrThrow(src: string, anchor: string, to: string, what: string): string {
  if (!src.includes(anchor)) throw new Error(`[PaperMaterial] 着色器锚点失效：${what}`);
  return src.replace(anchor, to);
}

export function buildLambertPars(): string {
  return replaceOrThrow(
    ShaderChunk.lights_lambert_pars_fragment,
    LAMBERT_ANCHOR,
    /* glsl */ `
	float paperNL = dot( geometryNormal, directLight.direction );
	float paperWrap = saturate( ( paperNL + uPaperLight.x ) / ( 1.0 + uPaperLight.x ) );
	float paperBack = saturate( -paperNL ) * uPaperLight.y;
	vec3 irradiance = directLight.color * ( vec3( paperWrap ) + uPaperTransTint * paperBack );`,
    'lights_lambert_pars_fragment / dotNL',
  );
}

/** 把纸材质的注入应用到一个 shader 对象上（onBeforeCompile 的本体，单独导出便于测试）。 */
export function applyPaperPatches(shader: PaperShader, local: PaperLocals): void {
  Object.assign(shader.uniforms, paperGlobals, local);

  shader.vertexShader = replaceOrThrow(
    shader.vertexShader, '#include <common>', /* glsl */ `#include <common>
varying vec3 vPaperWorld;
#ifdef PAPER_VERTEX_SIDE
attribute float aSide;
varying float vPaperSide;
#endif`, 'vertex / common');
  shader.vertexShader = replaceOrThrow(
    shader.vertexShader, '#include <project_vertex>', /* glsl */ `#include <project_vertex>
vec4 paperWP = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
paperWP = batchingMatrix * paperWP;
#endif
#ifdef USE_INSTANCING
paperWP = instanceMatrix * paperWP;
#endif
vPaperWorld = ( modelMatrix * paperWP ).xyz;
#ifdef PAPER_VERTEX_SIDE
vPaperSide = aSide;
#endif`, 'vertex / project_vertex');

  shader.fragmentShader = replaceOrThrow(
    shader.fragmentShader, '#include <common>', /* glsl */ `#include <common>
uniform sampler2D uPaperFibreTex;
uniform float uPaperFibre, uPaperFibreScale, uPaperFlash, uPaperFade, uPaperSideDarken;
uniform vec2 uPaperLight;
uniform vec3 uPaperTransTint, uPaperRimColor, uPaperRim;
varying vec3 vPaperWorld;
#ifdef PAPER_VERTEX_SIDE
varying float vPaperSide;
#endif
float paperFibre( vec3 p ) {
	vec3 n = abs( normalize( cross( dFdx( p ), dFdy( p ) ) ) );
	n /= ( n.x + n.y + n.z );
	vec3 q = p * uPaperFibreScale;
	vec3 s = texture2D( uPaperFibreTex, q.zy ).rgb * n.x
	       + texture2D( uPaperFibreTex, q.xz ).rgb * n.y
	       + texture2D( uPaperFibreTex, q.xy ).rgb * n.z;
	return s.r * 0.45 + s.g * 0.35 + s.b * 0.2;
}
const float PAPER_BAYER[16] = float[16](
	0.0, 8.0, 2.0, 10.0,  12.0, 4.0, 14.0, 6.0,  3.0, 11.0, 1.0, 9.0,  15.0, 7.0, 13.0, 5.0 );
float paperDither( vec2 fc ) {
	ivec2 p = ivec2( mod( floor( fc ), 4.0 ) );
	return ( PAPER_BAYER[ p.x + p.y * 4 ] + 0.5 ) / 16.0;
}`, 'fragment / common');

  shader.fragmentShader = replaceOrThrow(
    shader.fragmentShader, '#include <lights_lambert_pars_fragment>', buildLambertPars(),
    'fragment / lights_lambert_pars_fragment');

  shader.fragmentShader = replaceOrThrow(
    shader.fragmentShader, '#include <alphatest_fragment>', /* glsl */ `
float paperRim = ( 1.0 - smoothstep( uPaperRim.x, uPaperRim.y, diffuseColor.a ) ) * uPaperRim.z;
diffuseColor.rgb = mix( diffuseColor.rgb, uPaperRimColor, paperRim * step( 0.001, diffuseColor.a ) );
#include <alphatest_fragment>
if ( uPaperFade > 0.0 && paperDither( gl_FragCoord.xy ) < uPaperFade ) discard;
float paperF = paperFibre( vPaperWorld );
diffuseColor.rgb *= 1.0 - uPaperFibre + uPaperFibre * 2.0 * paperF;
#ifdef PAPER_VERTEX_SIDE
diffuseColor.rgb *= mix( 1.0, uPaperSideDarken, vPaperSide );
#endif`, 'fragment / alphatest_fragment');

  shader.fragmentShader = replaceOrThrow(
    shader.fragmentShader, '#include <opaque_fragment>', /* glsl */ `
outgoingLight = mix( outgoingLight, vec3( 1.0 ), uPaperFlash );
#include <opaque_fragment>`, 'fragment / opaque_fragment');
}

export function createPaperMaterial(opts: PaperMaterialOptions = {}): MeshLambertMaterial {
  const cutout = opts.cutout ?? !!opts.map;
  const rim = opts.rim ?? cutout;
  const mat = new MeshLambertMaterial({
    map: opts.map ?? null,
    color: new Color(opts.color ?? 0xffffff),
    side: (opts.doubleSided ?? true) ? DoubleSide : FrontSide,
    alphaTest: cutout ? 0.5 : 0,
    transparent: false,
  });

  const local: PaperLocals = {
    uPaperFibre: { value: opts.fibre ?? 0.22 },
    uPaperRim: { value: new Vector3(0.5, 0.82, rim ? 0.85 : 0) },
    uPaperFlash: { value: 0 },
    uPaperFade: { value: 0 },
  };
  mat.userData.paper = local;
  paperGlobals.uPaperFibreTex.value ??= getFibreTexture();

  mat.defines = { ...(mat.defines ?? {}), ...(opts.vertexSide ? { PAPER_VERTEX_SIDE: '' } : {}) };
  mat.customProgramCacheKey = () =>
    `paper|${cutout ? 1 : 0}|${opts.vertexSide ? 1 : 0}|${opts.extend?.cacheKey ?? ''}`;

  mat.onBeforeCompile = (shader) => {
    applyPaperPatches(shader as unknown as PaperShader, local);
    opts.extend?.apply(shader as unknown as PaperShader);
  };
  return mat;
}
