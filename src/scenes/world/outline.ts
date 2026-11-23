/** 轮廓处理（纯函数）：绕向、内缩、标注点、邻接、从 alpha 掩码描边。工单 M3-WO2 §2.2。 */
export type Pt = [number, number];

export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** 去重复点（含首尾相同）、去共线点、统一为逆时针。 */
export function normalizeOutline(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-9 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  if (signedArea(out) < 0) out.reverse();
  return out;
}

export function centroid(pts: Pt[]): Pt {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    const c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-12) return pts[0] ?? [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPolygon(p: Pt, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
  return x * x + y * y;
}
export function distToBoundary(p: Pt, pts: Pt[]): number {
  let m = Infinity;
  for (let i = 0, n = pts.length; i < n; i++) m = Math.min(m, segDist2(p, pts[i], pts[(i + 1) % n]));
  return Math.sqrt(m);
}

function segsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
export function selfIntersects(pts: Pt[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** 沿角平分线内移 d / sin(半角)，尖角限幅 3d；自交或面积翻转返回 null。输入须为逆时针。 */
export function insetPolygon(pts: Pt[], d: number): Pt[] | null {
  const n = pts.length;
  if (n < 3) return null;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    let ax = p1[0] - p0[0], ay = p1[1] - p0[1]; const la = Math.hypot(ax, ay) || 1; ax /= la; ay /= la;
    let bx = p2[0] - p1[0], by = p2[1] - p1[1]; const lb = Math.hypot(bx, by) || 1; bx /= lb; by /= lb;
    // 逆时针时内法线 = 左法线 (-y, x)
    const n1x = -ay, n1y = ax, n2x = -by, n2y = bx;
    let mx = n1x + n2x, my = n1y + n2y; const lm = Math.hypot(mx, my);
    if (lm < 1e-9) { mx = n1x; my = n1y; } else { mx /= lm; my /= lm; }
    const cosHalf = mx * n1x + my * n1y;              // = sin(半角)
    const k = Math.min(d / Math.max(cosHalf, 1e-6), 3 * d);
    out.push([p1[0] + mx * k, p1[1] + my * k]);
  }
  const a0 = signedArea(pts), a1 = signedArea(out);
  if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) < 1e-12 || selfIntersects(out)) return null;
  return out;
}

/** 网格法：离边界最远的内点（粗网格取前几名，邻域细化两轮）。 */
export function labelPoint(pts: Pt[], precision = 24): Pt {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const score = (p: Pt) => (pointInPolygon(p, pts) ? distToBoundary(p, pts) : -1);
  let cand: Array<{ p: Pt; s: number }> = [];
  let sx = (x1 - x0) / precision, sy = (y1 - y0) / precision;
  for (let i = 0; i <= precision; i++) for (let j = 0; j <= precision; j++) {
    const p: Pt = [x0 + i * sx, y0 + j * sy];
    cand.push({ p, s: score(p) });
  }
  cand.sort((a, b) => b.s - a.s);
  cand = cand.slice(0, 5);
  for (let round = 0; round < 2; round++) {
    const next: typeof cand = [];
    for (const c of cand) {
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        const p: Pt = [c.p[0] + (i * sx) / 3, c.p[1] + (j * sy) / 3];
        next.push({ p, s: score(p) });
      }
    }
    sx /= 3; sy /= 3;
    next.sort((a, b) => b.s - a.s);
    cand = next.slice(0, 5);
  }
  return cand[0].s > 0 ? cand[0].p : centroid(pts);
}

/** 两片边界上彼此距离 < eps 的累计长度 ≥ eps×8 即相邻。 */
export function buildAdjacency(all: { id: string; outline: Pt[] }[], eps?: number): Map<string, string[]> {
  let minX = Infinity, maxX = -Infinity;
  for (const a of all) for (const [x] of a.outline) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
  const e = eps ?? (maxX - minX) * 0.003;
  const res = new Map<string, string[]>(all.map((a) => [a.id, []]));
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const A = all[i].outline, B = all[j].outline;
    let len = 0;
    for (let k = 0; k < A.length; k++) {
      const p = A[k], q = A[(k + 1) % A.length];
      const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (distToBoundary(mid, B) < e) len += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    if (len >= e * 8) { res.get(all[i].id)!.push(all[j].id); res.get(all[j].id)!.push(all[i].id); }
  }
  return res;
}

/** Douglas–Peucker 闭合折线简化。 */
export function simplifyClosed(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 8) return pts;
  // 以最远两点切成两段分别简化
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const dp = (seg: Pt[]): Pt[] => {
    if (seg.length < 3) return seg;
    let idx = 0, md = -1;
    for (let i = 1; i < seg.length - 1; i++) { const d = segDist2(seg[i], seg[0], seg[seg.length - 1]); if (d > md) { md = d; idx = i; } }
    if (md <= tol * tol) return [seg[0], seg[seg.length - 1]];
    const l = dp(seg.slice(0, idx + 1)), r = dp(seg.slice(idx));
    return [...l.slice(0, -1), ...r];
  };
  const a = dp(pts.slice(0, far + 1)), b = dp([...pts.slice(far), pts[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/**
 * 从二值掩码描出最大连通块的外轮廓（Moore 邻域追踪），坐标为格点角（像素单位）。
 * mask[y*w + x] 非零 = 实心。y 向下。
 */
export function traceMask(mask: Uint8Array, w: number, h: number): Pt[] {
  // 最大连通块
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0, bestStart = -1, id = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    let size = 0; stack.push(i); label[i] = id;
    while (stack.length) {
      const k = stack.pop()!; size++;
      const x = k % w, y = (k / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (mask[nk] && label[nk] < 0) { label[nk] = id; stack.push(nk); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; bestStart = i; }
    id++;
  }
  if (best < 0) return [];
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === best;
  // 沿像素边走（方格边界追踪）：从起点像素的左上角出发，保持实心在右手边
  const sx = bestStart % w, sy = (bestStart / w) | 0;
  const pts: Pt[] = [];
  let x = sx, y = sy, dir = 0;   // 0 右 1 下 2 左 3 上（沿格点走）
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  // 在格点 (x,y) 处，四个邻像素：TL(x-1,y-1) TR(x,y-1) BL(x-1,y) BR(x,y)
  const limit = w * h * 4 + 8;
  for (let it = 0; it < limit; it++) {
    pts.push([x, y]);
    x += DX[dir]; y += DY[dir];
    if (x === sx && y === sy) break;
    // 选下一方向：右转优先 → 直行 → 左转（实心在右手边）
    const tl = solid(x - 1, y - 1), tr = solid(x, y - 1), bl = solid(x - 1, y), br = solid(x, y);
    const can = [
      br && !tr, // 右：右手（下方）实心
      bl && !br, // 下：右手（左侧）实心
      tl && !bl, // 左：右手（上方）实心
      tr && !tl, // 上：右手（右侧）实心
    ];
    const pick = [(dir + 1) % 4, dir, (dir + 3) % 4].find((d) => can[d]);
    dir = pick ?? (dir + 2) % 4;
  }
  // 去共线点
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}
