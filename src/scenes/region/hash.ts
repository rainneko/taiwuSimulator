/** 与 tools/art/preview_grid.py 的 h32 / hf 逐位相同的确定性整数哈希（布置、房屋、扭曲相位共用）。 */
export function h32(...xs: number[]): number {
  let v = 0x811c9dc5;
  for (const x of xs) {
    v = (v ^ (x >>> 0)) >>> 0;
    v = Math.imul(v, 0x01000193) >>> 0;
    v = (v ^ (v >>> 13)) >>> 0;
    v = Math.imul(v, 0x5bd1e995) >>> 0;
    v = (v ^ (v >>> 15)) >>> 0;
  }
  return v;
}

export function hf(...xs: number[]): number { return h32(...xs) / 4294967296; }
