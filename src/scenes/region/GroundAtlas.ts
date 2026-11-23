import { CanvasTexture, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { GROUND_TYPES, MAX_VARIANTS, terrainUrls } from './terrain';

/** 图集单元像素。 */
export const ATLAS_CELL = 128;

/**
 * 原版方块图是宽 512、高 700–831 不等的等距立方体：顶面是一个约 2:1 的菱形，半高 ≈ 130px。
 * 左右两角的 y 逐图测量（左右边缘第一个不透明像素），上角 = 两角 y − 半高。
 * 取其内缩 INSET 后的部分，避开边沿描线与伸出顶面的装饰。
 */
export const TOP_HALF_H = 130;
const INSET = 0.84;

const probe = document.createElement('canvas');
/** 测量左右两角的 y（像素）。 */
export function measureSideCornerY(img: HTMLImageElement): number {
  const W = img.naturalWidth, H = img.naturalHeight;
  probe.width = W; probe.height = H;
  const g = probe.getContext('2d', { willReadFrequently: true })!;
  g.clearRect(0, 0, W, H); g.drawImage(img, 0, 0);
  const col = (x: number) => {
    const d = g.getImageData(x, 0, 1, H).data;
    for (let y = 0; y < H; y++) if (d[y * 4 + 3] > 128) return y;
    return 200;
  };
  return (col(4) + col(W - 5)) / 2;
}

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

/** 把菱形顶面仿射展开到 [ox, ox+S]×[oy, oy+S] 的正方形。u 沿 T→R，v 沿 T→L。 */
export function drawTopFace(g: CanvasRenderingContext2D, img: HTMLImageElement, ox: number, oy: number, S: number): void {
  const W = img.naturalWidth, yc = measureSideCornerY(img);
  const tx = W / 2, ty = yc - TOP_HALF_H, rx = W, ry = yc, lx = 0, ly = yc;
  const cx = W / 2, cy = yc;                                    // 菱形中心
  const k = INSET;
  const Tx = cx + (tx - cx) * k, Ty = cy + (ty - cy) * k;
  const e1x = (rx - tx) * k, e1y = (ry - ty) * k, e2x = (lx - tx) * k, e2y = (ly - ty) * k;
  const det = e1x * e2y - e2x * e1y;
  const a = S * e2y / det, c = -S * e2x / det, b = -S * e1y / det, d = S * e1x / det;
  g.save();
  g.beginPath(); g.rect(ox, oy, S, S); g.clip();
  g.setTransform(a, b, c, d, ox - (a * Tx + c * Ty), oy - (b * Tx + d * Ty));
  g.drawImage(img, 0, 0);
  g.restore();
}

/** 地面图集：列 = 地形 0–15，行 = 变体 0–3。缺素材的格子填纯色。 */
export async function buildGroundAtlas(signal?: AbortSignal): Promise<{ texture: CanvasTexture; variants: number[] }> {
  const S = ATLAS_CELL;
  const cv = document.createElement('canvas');
  cv.width = S * GROUND_TYPES; cv.height = S * MAX_VARIANTS;
  const g = cv.getContext('2d')!;
  const variants: number[] = [];
  const fallback = ['#7d7a68', '#8a7356', '#93955f', '#a9b072', '#5f8a4c', '#b7a35c', '#7aa27a', '#8d8a80',
    '#7f9c58', '#8fa96a', '#5f86a2', '#3f6b3d', '#5e5650', '#6c7655', '#c7b3a0', '#a89a72'];
  await Promise.all(Array.from({ length: GROUND_TYPES }, async (_, t) => {
    const urls = terrainUrls(t).slice(0, MAX_VARIANTS);
    const imgs = (await Promise.all(urls.map(loadImage))).filter((i): i is HTMLImageElement => !!i);
    variants[t] = Math.max(1, imgs.length);
    for (let v = 0; v < MAX_VARIANTS; v++) {
      const img = imgs[v % Math.max(1, imgs.length)];
      if (img) drawTopFace(g, img, t * S, v * S, S);
      else { g.fillStyle = fallback[t]; g.fillRect(t * S, v * S, S, S); }
    }
  }));
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const texture = new CanvasTexture(cv);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.flipY = false;               // 行号自上而下，与着色器一致
  texture.anisotropy = 4;
  return { texture, variants };
}
