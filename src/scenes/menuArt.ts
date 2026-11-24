import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three';

/** Vite dev 直接服务项目根目录，此路径在 dev 下可用；prod 构建不包含（原版资源不分发）。 */
export const MENU_ASSET_BASE = `${import.meta.env.BASE_URL}assets/main-menu/main_menu/`;

const _loader = new TextureLoader();

/**
 * 加载原版主菜单贴图。失败静默返回 null（由调用方降级到程序化纹理）。
 * @param relPath 相对于 MENU_ASSET_BASE 的子路径，如 `background/MianScrollBack.png`
 * @param wrapS   横向重复包裹（卷轴背景需要）
 */
export async function loadMenuTexture(
  relPath: string,
  wrapS: 'repeat' | 'clamp' = 'clamp',
  signal?: AbortSignal,
): Promise<Texture | null> {
  try {
    const tex = await _loader.loadAsync(MENU_ASSET_BASE + relPath);
    if (signal?.aborted) { tex.dispose(); return null; }
    tex.colorSpace = SRGBColorSpace;
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.wrapS = wrapS === 'repeat' ? RepeatWrapping : ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    return tex;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 程序化占位（原版资源不可用时的降级）
// ---------------------------------------------------------------------------

/** 内容包缺图时的程序化占位：水墨远山剪影（带 alpha，供 cutout）。 */
export function inkRidgeTexture(seed: number, tone: string, w = 1024, h = 256): Texture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const peaks: number[] = [];
  const n = 7 + Math.floor(rnd() * 5);
  for (let i = 0; i <= n; i++) peaks.push(0.25 + rnd() * 0.65);
  g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) {
    const f = (x / w) * n, i = Math.floor(f), t = f - i;
    const a = peaks[i], b = peaks[Math.min(n, i + 1)];
    const e = (1 - Math.cos(t * Math.PI)) / 2;
    const y = (a + (b - a) * e) + Math.sin(x * 0.05 + seed) * 0.015 + (rnd() - 0.5) * 0.01;
    g.lineTo(x, h - y * h);
  }
  g.lineTo(w, h); g.closePath();
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, tone); grad.addColorStop(1, 'rgba(60,50,40,0.85)');
  g.fillStyle = grad; g.fill();
  const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function titleTexture(text: string): Texture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 768;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3ead6'; g.fillRect(0, 0, 256, 768);
  g.strokeStyle = '#8a2b1f'; g.lineWidth = 10; g.strokeRect(18, 18, 220, 732);
  g.fillStyle = '#231a12';
  g.font = '600 150px "STKaiti","KaiTi","Songti SC",serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...text];
  chars.forEach((ch, i) => g.fillText(ch, 128, 110 + i * ((768 - 220) / Math.max(1, chars.length - 1))));
  const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** 程序化开场标题：宣纸底 + 水墨渲染「太吾绘卷」四字，返回 4 张独立的单字贴图。 */
export function splashCharTextures(text = '太吾绘卷'): Texture[] {
  const chars = [...text];
  return chars.map((ch) => {
    const size = 512;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const g = c.getContext('2d')!;
    // 宣纸底
    g.fillStyle = '#f8f2e4';
    g.fillRect(0, 0, size, size);
    // 纸纹噪点
    for (let i = 0; i < 800; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      g.fillStyle = `rgba(180,160,130,${Math.random() * 0.08})`;
      g.fillRect(x, y, Math.random() * 3 + 1, Math.random() * 3 + 1);
    }
    // 水墨晕染背景（极淡的圆形渐变）
    const wash = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.45);
    wash.addColorStop(0, 'rgba(60,50,40,0.03)');
    wash.addColorStop(0.7, 'rgba(60,50,40,0.01)');
    wash.addColorStop(1, 'rgba(60,50,40,0)');
    g.fillStyle = wash;
    g.fillRect(0, 0, size, size);
    // 主字
    g.fillStyle = '#1a1208';
    g.font = `900 ${size * 0.7}px "STKaiti","KaiTi","Songti SC","Noto Serif SC",serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(ch, size / 2, size / 2 + size * 0.02);
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  });
}

/** 程序化副标题贴图：「经典版 · 重制」。 */
export function splashSubtitleTexture(): Texture {
  const w = 512, h = 96;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a6b4a';
  g.font = '300 36px "Songti SC","Noto Serif SC","STSong",serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('经典版 · 重制', w / 2, h / 2);
  const tex = new CanvasTexture(c); tex.colorSpace = SRGBColorSpace;
  return tex;
}
