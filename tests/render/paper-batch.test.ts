import { Texture, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HingeState } from '../../src/render/paper/hinge';
import { PaperBatch, type Atlas } from '../../src/render/paper/PaperBatch';

const atlas: Atlas = {
  texture: new Texture(),
  json: {
    image: 'x.webp', size: [256, 256], feather: 2, padding: 4,
    frames: [
      { name: 'a', rect: [4, 4, 120, 120], size: [0.5, 0.5] },
      { name: 'b', rect: [132, 4, 120, 200], size: [0.4, 0.7] },
    ],
  },
};

describe('PaperBatch', () => {
  it('波纹起立后全部锁定，active 清空', () => {
    const b = new PaperBatch(atlas, { cards: 600, frames: 2 });
    const hs: number[] = [];
    for (let i = 0; i < 600; i++) hs.push(b.add({ frame: i % 2 ? 'a' : 'b', position: new Vector3(i % 30, 0, Math.floor(i / 30)) }));
    hs.forEach((h, i) => b.rise(h, (i % 30) * 0.035));
    expect(b.active.size).toBe(600);
    for (let t = 0; t < 3; t += 1 / 60) b.update(1 / 60);
    expect(b.active.size).toBe(0);
    expect(hs.every((h) => b.getState(h) === HingeState.LOCKED)).toBe(true);
    expect(b.getTheta(hs[0])).toBeCloseTo(Math.PI / 2);
  });
  it('setFrame / remove / fall', () => {
    const b = new PaperBatch(atlas, { cards: 4, frames: 2 });
    const h = b.add({ frame: 'a', position: new Vector3(), startState: HingeState.LOCKED });
    b.setFrame(h, 'b');
    b.fall(h);
    for (let t = 0; t < 2; t += 1 / 60) b.update(1 / 60);
    expect(b.getState(h)).toBe(HingeState.FLAT);
    b.remove(h);
    expect(b.active.size).toBe(0);
  });
});
