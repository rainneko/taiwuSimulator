import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cardQuaternion, makeCardGeometry } from '../../src/render/paper/PaperCard';

const W = 0.8, H = 1.2;
const geo = makeCardGeometry({ width: W, height: H, uv: [0, 0, 1, 1] });
const verts = (theta: number) => {
  const q = cardQuaternion(0, theta);
  const p = geo.getAttribute('position');
  return Array.from({ length: 4 }, (_, i) => new Vector3().fromBufferAttribute(p, i).applyQuaternion(q));
};

describe('card geometry', () => {
  it('包围盒 y∈[0,h]、x 对称', () => {
    const bb = geo.boundingBox!;
    expect(bb.min.y).toBeCloseTo(0); expect(bb.max.y).toBeCloseTo(H);
    expect(bb.min.x).toBeCloseTo(-W / 2); expect(bb.max.x).toBeCloseTo(W / 2);
  });
  it('θ=π/2 立正：顶边在 y=h、z=0', () => {
    const v = verts(Math.PI / 2);
    expect(v[2].y).toBeCloseTo(H); expect(v[2].z).toBeCloseTo(0);
    expect(v[0].y).toBeCloseTo(0);
  });
  it('θ=0 平躺：顶边远离镜头（-Z），全在地面', () => {
    const v = verts(0);
    for (const p of v) expect(p.y).toBeCloseTo(0);
    expect(v[2].z).toBeCloseTo(-H); expect(v[0].z).toBeCloseTo(0);
    const n = new Vector3(0, 0, 1).applyQuaternion(cardQuaternion(0, 0));
    expect(n.y).toBeCloseTo(1);
  });
});
