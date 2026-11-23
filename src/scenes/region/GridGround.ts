import {
  DataTexture, Mesh, MeshLambertMaterial, NearestFilter, PlaneGeometry, RGBAFormat, Texture, UnsignedByteType,
} from 'three';
import { createPaperMaterial, type PaperShader } from '../../render/paper';
import { GROUND_TYPES, MAX_VARIANTS } from './terrain';

/** tTerrain.B 的高亮标志位。 */
export const enum Hl { Hover = 1, Selected = 2, Path = 4, PathIllegal = 8, Danger = 16, Reachable = 32 }

/**
 * 格子地面：一张 N×N 的平面，格 (x, y) 占世界 [x, x+1]×[y, y+1]（XZ 平面）。
 * tTerrain（N×N RGBA8）：R = 地面类型，G = 图集行（变体），B = 高亮标志，A = 逐格明暗。
 */
export class GridGround {
  readonly mesh: Mesh<PlaneGeometry, MeshLambertMaterial>;
  readonly tTerrain: DataTexture;
  private data: Uint8Array;
  private dirty = false;
  private uniforms = {
    tTerrain: { value: null as unknown as Texture },
    tGroundAtlas: { value: null as Texture | null },
    uGridN: { value: 1 },
    uHasAtlas: { value: 0 },
  };

  constructor(readonly n: number) {
    this.data = new Uint8Array(n * n * 4);
    this.tTerrain = new DataTexture(this.data, n, n, RGBAFormat, UnsignedByteType);
    this.tTerrain.magFilter = this.tTerrain.minFilter = NearestFilter;
    this.tTerrain.needsUpdate = true;
    this.uniforms.tTerrain.value = this.tTerrain;
    this.uniforms.uGridN.value = n;

    const u = this.uniforms;
    const mat = createPaperMaterial({
      color: 0xffffff, doubleSided: false, cutout: false, fibre: 0.16,
      extend: { cacheKey: 'regionGround', apply: (s: PaperShader) => patchGround(s, u) },
    });
    const geo = new PlaneGeometry(n, n);
    geo.rotateX(-Math.PI / 2);
    geo.translate(n / 2, 0, n / 2);
    this.mesh = new Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'GridGround';
  }

  setAtlas(tex: Texture | null): void {
    this.uniforms.tGroundAtlas.value = tex;
    this.uniforms.uHasAtlas.value = tex ? 1 : 0;
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

  dispose(): void { this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tTerrain.dispose(); }
}

function patchGround(s: PaperShader, u: Record<string, { value: unknown }>): void {
  Object.assign(s.uniforms, u);
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGridUv;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGridUv = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', /* glsl */ `#include <common>
varying vec2 vGridUv;
uniform highp sampler2D tTerrain;
uniform sampler2D tGroundAtlas;
uniform float uGridN;
uniform float uHasAtlas;`)
    .replace('#include <alphatest_fragment>', /* glsl */ `{
	vec2 g = vGridUv;
	ivec2 cell = ivec2( clamp( floor( g ), vec2( 0.0 ), vec2( uGridN - 1.0 ) ) );
	vec2 f = fract( g );
	vec4 t = texelFetch( tTerrain, cell, 0 );
	float id = floor( t.r * 255.0 + 0.5 ), row = floor( t.g * 255.0 + 0.5 );
	int fl = int( t.b * 255.0 + 0.5 );
	vec2 atl = vec2( ${GROUND_TYPES}.0, ${MAX_VARIANTS}.0 );
	vec2 auv = ( vec2( id, row ) + clamp( f, 0.004, 0.996 ) ) / atl;
	vec3 base = uHasAtlas > 0.5
		? textureGrad( tGroundAtlas, auv, dFdx( g ) / atl, dFdy( g ) / atl ).rgb
		: vec3( 0.7, 0.68, 0.6 );
	base *= 0.95 + 0.1 * t.a;
	// 纸缝：远处不小于约 1px
	float seamW = max( 0.02, fwidth( g.x ) * 1.2 );
	float edge = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) );
	base = mix( vec3( 0.32, 0.27, 0.21 ), base, smoothstep( 0.0, seamW, edge ) );
	// 高亮
	float ring = 1.0 - smoothstep( 0.04, 0.09, edge );
	float dotC = 1.0 - smoothstep( 0.1, 0.14, length( f - 0.5 ) );
	if ( ( fl & 32 ) != 0 ) base = mix( base, vec3( 0.95, 0.9, 0.7 ), 0.12 );
	if ( ( fl & 16 ) != 0 ) base = mix( base, vec3( 0.75, 0.15, 0.1 ), 0.25 );
	if ( ( fl & 1 ) != 0 ) { base = mix( base, vec3( 1.0 ), 0.18 ); base = mix( base, vec3( 0.98, 0.95, 0.85 ), ring * 0.8 ); }
	if ( ( fl & 4 ) != 0 ) base = mix( base, vec3( 0.55, 0.12, 0.08 ), dotC * 0.85 );
	if ( ( fl & 8 ) != 0 ) base = mix( base, vec3( 0.35, 0.33, 0.3 ), dotC * 0.7 );
	if ( ( fl & 2 ) != 0 ) base = mix( base, vec3( 0.86, 0.62, 0.18 ), ring );
	diffuseColor.rgb *= base;
}
#include <alphatest_fragment>`);
}
