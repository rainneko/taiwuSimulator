import { ShaderChunk, ShaderLib, UniformsUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { buildLambertPars, createPaperMaterial } from '../../src/render/paper/PaperMaterial';
import { buildPCSSChunk, locateBasicBranch } from '../../src/render/paper/shadows';

describe('shader anchors (three@0.187.0)', () => {
  it('buildLambertPars 不抛错', () => {
    expect(buildLambertPars()).toContain('paperWrap');
  });
  it('onBeforeCompile 对 lambert 源码不抛错', () => {
    const mat = createPaperMaterial();
    const shader = {
      uniforms: UniformsUtils.clone(ShaderLib.lambert.uniforms),
      vertexShader: ShaderLib.lambert.vertexShader,
      fragmentShader: ShaderLib.lambert.fragmentShader,
    };
    // @ts-expect-error 假 shader 对象只含需要的字段
    mat.onBeforeCompile(shader, null);
    expect(shader.fragmentShader).toContain('paperFibre(');
    expect(shader.fragmentShader).toContain('uPaperFlash');
    expect(shader.vertexShader).toContain('vPaperWorld');
    expect(shader.uniforms).toHaveProperty('uPaperFibreTex');
  });
  it('PCSS 锚点全部命中', () => {
    const [a, b] = locateBasicBranch(ShaderChunk.shadowmap_pars_fragment);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    const out = buildPCSSChunk(ShaderChunk.shadowmap_pars_fragment);
    expect(out).toContain('paperPCSS(');
    expect(out.match(/float getShadow\(/g)?.length).toBe(
      ShaderChunk.shadowmap_pars_fragment.match(/float getShadow\(/g)?.length,
    );
  });
});
