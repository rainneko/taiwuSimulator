/** OKLab 颜色换算与插值（纯函数）。工单 M3-WO2 §3.3。 */
export type Lab = [L: number, a: number, b: number];

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055);

export function srgbToOklab(r: number, g: number, b: number): Lab {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToSrgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  return [
    clamp(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
  ];
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function hexToOklab(hex: string): Lab { return srgbToOklab(...hexToRgb(hex)); }
export function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

export function mixLab(a: Lab, b: Lab, t: number): Lab {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 片的最终颜色：底色 →(accent)→ 强调色，再乘亮度与饱和系数。 */
export function pieceColor(base: Lab, accent: Lab, t: number, dim: number, sat: number): [number, number, number] {
  const L = (base[0] + (accent[0] - base[0]) * t) * dim;
  const a = (base[1] + (accent[1] - base[1]) * t) * sat;
  const b = (base[2] + (accent[2] - base[2]) * t) * sat;
  return oklabToSrgb([L, a, b]);
}

/** OKLCh 彩度。 */
export function chroma(c: Lab): number { return Math.hypot(c[1], c[2]); }
/** 由 L、C、色相（弧度）构造。 */
export function lch(L: number, C: number, h: number): Lab { return [L, C * Math.cos(h), C * Math.sin(h)]; }
