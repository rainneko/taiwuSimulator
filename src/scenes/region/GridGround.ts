import {
  BufferGeometry, DataTexture, Mesh, Vector4, MeshLambertMaterial, NearestFilter, PlaneGeometry, RedFormat, RGBAFormat, Texture,
  UnsignedByteType, Float32BufferAttribute,
} from 'three';
import { createPaperMaterial, type PaperShader } from '../../render/paper';
import { GROUND_TYPES, MAX_VARIANTS, STACK, WATER } from './terrain';
import { WARP_GLSL, type WarpPhase } from './warp';
import { encodeLevel } from './levels';

/** tTerrain.B 的高亮标志位。 */
export const enum Hl { Hover = 1, Selected = 2, Path = 4, PathIllegal = 8, Danger = 16, Reachable = 32 }

/**
 * 格子地面：一张 N×N 的平面，格 (x, y) 占世界 [x, x+1]×[y, y+1]（XZ 平面）。
 * tTerrain（N×N RGBA8）：R = 地面类型，G = 图集行（变体），B = 高亮标志，A = 逐格明暗。
 */
export class GridGround {
  readonly mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
  readonly tTerrain: DataTexture;
  /** 格的层号（N×N R8，最近邻）：r = (level + 2) × 2。 */
  readonly tLevel: DataTexture;
  private levelData: Uint8Array;
  private data: Uint8Array;
  private dirty = false;
  private uniforms = {
    tTerrain: { value: null as unknown as Texture },
    tGroundAtlas: { value: null as Texture | null },
    uGridN: { value: 1 },
    uHasAtlas: { value: 0 },
    tGroundArray: { value: null as Texture | null },
    uHasArray: { value: 0 },
    uGroundSpan: { value: 2 },
    uLayerOf: { value: new Array<number>(GROUND_TYPES).fill(-1) },
    uNoRot: { value: new Array<number>(GROUND_TYPES).fill(0) },
    uWarpPhase: { value: new Vector4() },
    uStack: { value: STACK.map((v) => v / 255) },
    uWater: { value: WATER.map((w) => (w ? 1 : 0)) },
    tLevel: { value: null as unknown as Texture },
  };

  constructor(readonly n: number) {
    this.data = new Uint8Array(n * n * 4);
    this.tTerrain = new DataTexture(this.data, n, n, RGBAFormat, UnsignedByteType);
    this.tTerrain.magFilter = this.tTerrain.minFilter = NearestFilter;
    this.tTerrain.needsUpdate = true;
    this.uniforms.tTerrain.value = this.tTerrain;
    this.uniforms.uGridN.value = n;
    this.levelData = new Uint8Array(n * n).fill(encodeLevel(0));
    this.tLevel = new DataTexture(this.levelData, n, n, RedFormat, UnsignedByteType);
    this.tLevel.magFilter = this.tLevel.minFilter = NearestFilter;
    this.tLevel.needsUpdate = true;
    this.uniforms.tLevel.value = this.tLevel;

    const u = this.uniforms;
    const mat = createPaperMaterial({
      color: 0xffffff, doubleSided: false, cutout: false, fibre: 0.16,
      extend: { cacheKey: 'regionGround', apply: (s: PaperShader) => patchGround(s, u) },
    });
    const geo: BufferGeometry = new PlaneGeometry(n, n);
    geo.rotateX(-Math.PI / 2);
    geo.translate(n / 2, 0, n / 2);
    geo.setAttribute('aWall', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    this.mesh = new Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.name = 'GridGround';
  }

  /** 换成纸层几何（TerrainLayers.buildLayerGeometry）。 */
  setGeometry(geo: BufferGeometry): void { this.mesh.geometry.dispose(); this.mesh.geometry = geo; }

  /** 写每格层号（flat 时全 0）。 */
  setLevels(level: ArrayLike<number>): void {
    for (let i = 0; i < this.n * this.n; i++) this.levelData[i] = encodeLevel(level[i]);
    this.tLevel.needsUpdate = true;
  }

  setWarpPhase(p: WarpPhase): void { this.uniforms.uWarpPhase.value.set(p[0], p[1], p[2], p[3]); }

  /** 地面纸纹随相机距离：远档 0.22、中档 0.28、近档 0.35。 */
  setFibre(v: number): void {
    const paper = this.mesh.material.userData.paper as { uPaperFibre: { value: number } } | undefined;
    if (paper) paper.uPaperFibre.value = v;
  }

  /** 方块图 / 纯色图集（16 列 × 4 行）；底纸数组缺层的地形也按它取。 */
  setAtlas(tex: Texture | null): void {
    this.uniforms.tGroundAtlas.value = tex;
    this.uniforms.uHasAtlas.value = tex ? 1 : 0;
  }

  /**
   * 自产底纸数组（WO3 §3.2）：layerOf[t] = 原版地面 t 的层号（-1 = 无，走图集）；每张底纸覆盖 span×span 格，
   * 一格取其中一个窗口并做 8 种朝向之一（noRotate 只做镜像 + 0° / 180°）。传 null 关掉。
   */
  setGroundArray(tex: Texture | null, layerOf: number[] = [], noRotate: boolean[] = [], span = 2): void {
    const u = this.uniforms;
    u.tGroundArray.value = tex;
    u.uHasArray.value = tex ? 1 : 0;
    u.uGroundSpan.value = span;
    for (let t = 0; t < GROUND_TYPES; t++) { u.uLayerOf.value[t] = layerOf[t] ?? -1; u.uNoRot.value[t] = noRotate[t] ? 1 : 0; }
  }

  /** 写地面：ground[i] 类型、variantByte[i] 随机字节；variants[t] = 该类型实际变体数。 */
  setTerrain(ground: ArrayLike<number>, variantByte: ArrayLike<number>, variants: number[]): void {
    for (let i = 0; i < this.n * this.n; i++) {
      const t = ground[i] % GROUND_TYPES, r = variantByte[i];
      this.data[i * 4] = t;
      this.data[i * 4 + 1] = r % Math.min(MAX_VARIANTS, variants[t] || 1);
      this.data[i * 4 + 2] = 0;
      this.data[i * 4 + 3] = (r * 37) & 255;
    }
    this.tTerrain.needsUpdate = true;
  }

  setFlag(cell: number, flag: Hl, on: boolean): void {
    const k = cell * 4 + 2, v = on ? this.data[k] | flag : this.data[k] & ~flag;
    if (v !== this.data[k]) { this.data[k] = v; this.dirty = true; }
  }
  clearFlag(flag: Hl): void {
    for (let i = 2; i < this.data.length; i += 4) if (this.data[i] & flag) { this.data[i] &= ~flag; this.dirty = true; }
  }
  /** 每帧末调用一次：有改动才上传。 */
  flush(): void { if (this.dirty) { this.tTerrain.needsUpdate = true; this.dirty = false; } }

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tTerrain.dispose(); this.tLevel.dispose(); }
}

function patchGround(s: PaperShader, u: Record<string, { value: unknown }>): void {
  Object.assign(s.uniforms, u);
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGridUv;\nattribute vec2 aWall;\nvarying vec2 vWall;\nvarying vec3 vWallN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGridUv = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;\nvWall = aWall;\nvWallN = normal;');
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', /* glsl */ `#include <common>
varying vec2 vGridUv;
uniform highp sampler2D tTerrain;
uniform sampler2D tGroundAtlas;
uniform float uGridN;
uniform float uHasAtlas;
uniform mediump sampler2DArray tGroundArray;
uniform float uHasArray;
uniform float uGroundSpan;
uniform float uLayerOf[ ${GROUND_TYPES} ];
uniform float uNoRot[ ${GROUND_TYPES} ];
uniform float uStack[ ${GROUND_TYPES} ];
uniform float uWater[ ${GROUND_TYPES} ];
uniform highp sampler2D tLevel;
varying vec2 vWall;
varying vec3 vWallN;
float gLevel( ivec2 c ) { return texelFetch( tLevel, clamp( c, ivec2( 0 ), ivec2( int( uGridN ) - 1 ) ), 0 ).r; }
${WARP_GLSL}
vec4 gCell( ivec2 c ) { return texelFetch( tTerrain, clamp( c, ivec2( 0 ), ivec2( int( uGridN ) - 1 ) ), 0 ); }
int gId( vec4 t ) { return int( t.r * 255.0 + 0.5 ); }
// 朝向码 → 2×2 矩阵：bit0 镜像，bit1–2 旋转；noRotate 时只取 0° / 180°（WO3 §3.2.3）
mat2 gOrient( int code, bool noRotate ) {
	int r = ( code >> 1 ) & 3;
	if ( noRotate ) r &= 2;
	mat2 m = r == 0 ? mat2( 1.0, 0.0, 0.0, 1.0 ) : r == 1 ? mat2( 0.0, 1.0, -1.0, 0.0 )
	       : r == 2 ? mat2( -1.0, 0.0, 0.0, -1.0 ) : mat2( 0.0, -1.0, 1.0, 0.0 );
	if ( ( code & 1 ) != 0 ) m = m * mat2( -1.0, 0.0, 0.0, 1.0 );
	return m;
}`)
    .replace('#include <alphatest_fragment>', /* glsl */ `if ( vWall.x > 0.5 ) {
	// 侧壁：纸芯白，朝光程度 0.80 + 0.20·max(0, n·L)，下半截再压暗一成
	float ndl = max( 0.0, dot( normalize( vWallN ), normalize( vec3( -6.0, 12.0, 4.0 ) ) ) );
	diffuseColor.rgb *= vec3( 0.96, 0.94, 0.89 ) * ( 0.80 + 0.20 * ndl ) * mix( 0.9, 1.0, step( 0.5, vWall.y ) );
} else {
	vec2 g = vGridUv;
	// ── 这一点画成哪一格：扭曲坐标（交界弯曲）；底纸按原坐标取，不变形 ──
	vec2 gw = g + gWarp( g );
	ivec2 cell = clamp( ivec2( floor( gw ) ), ivec2( 0 ), ivec2( int( uGridN ) - 1 ) );
	vec2 fw = gw - vec2( cell );
	vec4 t = gCell( cell );
	int id = gId( t );
	float row = floor( t.g * 255.0 + 0.5 );
	int fl = int( t.b * 255.0 + 0.5 );
	vec2 atl = vec2( ${GROUND_TYPES}.0, ${MAX_VARIANTS}.0 );
	vec2 auv = ( vec2( float( id ), row ) + clamp( fract( g ), 0.004, 0.996 ) ) / atl;
	vec3 base = uHasAtlas > 0.5
		? textureGrad( tGroundAtlas, auv, dFdx( g ) / atl, dFdy( g ) / atl ).rgb
		: vec3( 0.7, 0.68, 0.6 );
	float layer = uLayerOf[ id ];
	if ( uHasArray > 0.5 && layer >= 0.0 ) {
		// 底纸窗口 + 朝向：按「原坐标 − 所属格」取（扭进来的异种格也按原坐标，底纸不变形）；随机码取 tTerrain.a
		int rnd = int( t.a * 255.0 + 0.5 );
		mat2 R = gOrient( rnd, uNoRot[ id ] > 0.5 );
		vec2 win = mod( vec2( float( ( rnd >> 3 ) & 1 ), float( ( rnd >> 4 ) & 1 ) ), uGroundSpan );
		vec2 uv = ( R * ( g - vec2( cell ) - 0.5 ) + 0.5 + win ) / uGroundSpan;
		base = textureGrad( tGroundArray, vec3( uv, layer ), R * dFdx( g ) / uGroundSpan, R * dFdy( g ) / uGroundSpan ).rgb;
	}
	base *= 0.95 + 0.1 * t.a;
	float stack = uStack[ id ];
	bool water = uWater[ id ] > 0.5;

	// ── 异种交界（扭曲坐标）：撕边 + 纸芯白 + 高侧接触阴影；水面沿岸浅水带 ──
	const ivec2 NB[4] = ivec2[4]( ivec2( -1, 0 ), ivec2( 1, 0 ), ivec2( 0, -1 ), ivec2( 0, 1 ) );
	float dist[4] = float[4]( fw.x, 1.0 - fw.x, fw.y, 1.0 - fw.y );
	float along[4] = float[4]( gw.y, gw.y, gw.x, gw.x );
	float tear = 1.0, lip = 0.0, shade = 0.0, shore = 0.0;
	for ( int k = 0; k < 4; k++ ) {
		ivec2 nc = cell + NB[ k ];
		if ( nc.x < 0 || nc.y < 0 || nc.x >= int( uGridN ) || nc.y >= int( uGridN ) ) continue;
		int nid = gId( gCell( nc ) );
		if ( nid == id ) continue;
		float d = dist[ k ];
		if ( water && uWater[ nid ] < 0.5 ) shore = max( shore, 1.0 - smoothstep( 0.0, 0.10, d ) );
		// 有层差的交界由真实侧壁代替：只有两格 tLevel 相同才画撕边与接触阴影
		if ( abs( gLevel( nc ) - gLevel( cell ) ) > 0.001 ) continue;
		float wob = 0.012 * sin( along[ k ] * 23.0 + float( k * 7 + id ) ) + 0.008 * sin( along[ k ] * 57.0 + float( id ) * 1.3 );
		float e = d - 0.035 - wob;
		tear = min( tear, smoothstep( -0.006, 0.004, e ) );
		lip = max( lip, 1.0 - smoothstep( 0.0, 0.018, e ) );
		if ( uStack[ nid ] > stack ) {
			float dir = ( k == 0 || k == 3 ) ? 1.0 : 0.4;
			shade = max( shade, ( 1.0 - smoothstep( 0.0, 0.06, e ) ) * dir );
		}
	}
	vec3 col = mix( base, vec3( 0.86, 0.90, 0.86 ), shore * 0.30 );
	col = mix( col, vec3( 0.97, 0.95, 0.9 ), lip * step( 0.5, tear ) * 0.55 );
	col *= 1.0 - shade * 0.25;
	col *= mix( 0.85, 1.0, tear );                       // 撕口：压暗的本色

	// ── 同种折痕（原坐标，直线）：宽 0.008、压暗 0.10 ──
	vec2 fo = fract( g );
	float eo = min( min( fo.x, 1.0 - fo.x ), min( fo.y, 1.0 - fo.y ) );
	float creaseW = max( 0.008, fwidth( g.x ) * 0.8 );
	col *= 1.0 - 0.10 * ( 1.0 - smoothstep( 0.0, creaseW, eo ) );

	// ── 高亮（原坐标的方格：寻路 / 选中按格）──
	ivec2 hc = clamp( ivec2( floor( g ) ), ivec2( 0 ), ivec2( int( uGridN ) - 1 ) );
	int hf = int( gCell( hc ).b * 255.0 + 0.5 );
	float ring = 1.0 - smoothstep( 0.03, 0.06, eo );
	float dotC = 1.0 - smoothstep( 0.07, 0.1, length( fo - 0.5 ) );
	if ( ( hf & 32 ) != 0 ) col = mix( col, vec3( 0.95, 0.9, 0.7 ), 0.12 );
	if ( ( hf & 16 ) != 0 ) col = mix( col, vec3( 0.75, 0.15, 0.1 ), 0.25 );
	if ( ( hf & 1 ) != 0 ) { col = mix( col, vec3( 1.0 ), 0.14 ); col = mix( col, vec3( 0.98, 0.95, 0.85 ), ring * 0.8 ); }
	if ( ( hf & 4 ) != 0 ) col = mix( col, vec3( 0.55, 0.12, 0.08 ), dotC * 0.85 );
	if ( ( hf & 8 ) != 0 ) col = mix( col, vec3( 0.35, 0.33, 0.3 ), dotC * 0.7 );
	if ( ( hf & 2 ) != 0 ) col = mix( col, vec3( 0.86, 0.62, 0.18 ), ring );
	diffuseColor.rgb *= col;
}
#include <alphatest_fragment>`);
}
