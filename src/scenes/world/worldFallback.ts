/**
 * 大地图素材降级（线上没有原版素材时用）：
 *  - 省片轮廓：以各省中心为种子，把底图矩形切成 Voronoi 拼块（公共边逐点相同，纸缝等宽）
 *  - 底图：canvas 画一张深色水墨占位（纸纹 + 山形笔触 + 东侧海浪 + 省界）
 * 纯函数部分（voronoiCells）无 DOM 依赖，可测。
 */
import type { Pt } from './outline';

/** 用半平面裁剪求每个种子的 Voronoi 单元（裁到 [0,W]×[0,H]），坐标与输入同系（像素，y 向下）。 */
export function voronoiCells(seeds: Pt[], W: number, H: number): Pt[][] {
  return seeds.map((s, i) => {
    let poly: Pt[] = [[0, 0], [W, 0], [W, H], [0, H]];
    seeds.forEach((o, j) => {
      if (i === j) return;
      // 保留离 s 比离 o 近的一侧：(p - m)·(o - s) <= 0
      const mx = (s[0] + o[0]) / 2, my = (s[1] + o[1]) / 2, nx = o[0] - s[0], ny = o[1] - s[1];
      const side = (p: Pt) => (p[0] - mx) * nx + (p[1] - my) * ny;
      const out: Pt[] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], da = side(a), db = side(b);
        if (da <= 0) out.push(a);
        if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
      }
      poly = out;
    });
    return poly;
  });
}

/** 占位底图：深色纸 + 纸纹 + 山形笔触 + 东侧海浪 + 省界线。 */
export function proceduralBase(W: number, H: number, cells: Pt[][], seed = 7): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  g.fillStyle = '#57514a'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2600; i++) {   // 纸纹斑驳
    g.fillStyle = `rgba(${rnd() < 0.5 ? '255,250,235' : '0,0,0'},${0.02 + rnd() * 0.04})`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 30, 1 + rnd() * 3);
  }
  // 东侧海浪：一排排小弧
  g.strokeStyle = 'rgba(225,220,205,0.35)'; g.lineWidth = 1.5;
  for (let y = 10; y < H; y += 14) for (let x = W * 0.86 + Math.sin(y / 90) * 40; x < W; x += 18) {
    g.beginPath(); g.arc(x, y, 7, Math.PI, 0); g.stroke();
  }
  // 山形笔触
  g.strokeStyle = 'rgba(240,236,224,0.75)'; g.lineWidth = 2;
  for (let i = 0; i < 70; i++) {
    const x = rnd() * W * 0.82, y = 40 + rnd() * (H - 80), w = 24 + rnd() * 30, h = 20 + rnd() * 26;
    g.beginPath(); g.moveTo(x - w / 2, y); g.quadraticCurveTo(x - w * 0.15, y - h * 1.2, x, y - h); g.quadraticCurveTo(x + w * 0.2, y - h * 1.1, x + w / 2, y); g.stroke();
  }
  // 省界
  g.strokeStyle = 'rgba(150,135,110,0.8)'; g.lineWidth = 6; g.lineJoin = 'round';
  for (const cell of cells) { g.beginPath(); cell.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); }
  return c;
}
