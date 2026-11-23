import { CanvasTexture, SRGBColorSpace, Texture } from 'three';

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
