import { describe, expect, it } from 'vitest';
import { makeFibreData } from '../../src/render/paper/fibre';

const SIZE = 256;
const data = makeFibreData(SIZE);
const at = (x: number, y: number, c: number) => data[(y * SIZE + x) * 4 + c] / 255;

describe('fibre', () => {
  it('同种子逐字节相同', () => {
    expect(Buffer.from(makeFibreData(SIZE)).equals(Buffer.from(data))).toBe(true);
  });
  it('三通道均值 0.5 ± 0.02', () => {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let i = 0; i < SIZE * SIZE; i++) s += data[i * 4 + c] / 255;
      expect(Math.abs(s / (SIZE * SIZE) - 0.5)).toBeLessThan(0.02);
    }
  });
  it('四向可平铺', () => {
    for (let c = 0; c < 3; c++) {
      let edge = 0, inner = 0;
      for (let i = 0; i < SIZE; i++) {
        edge += Math.abs(at(SIZE - 1, i, c) - at(0, i, c)) + Math.abs(at(i, SIZE - 1, c) - at(i, 0, c));
        inner += Math.abs(at(SIZE / 2 - 1, i, c) - at(SIZE / 2, i, c)) + Math.abs(at(i, SIZE / 2 - 1, c) - at(i, SIZE / 2, c));
      }
      expect(edge).toBeLessThanOrEqual(inner * 1.2 + 1e-6);
    }
  });
});
