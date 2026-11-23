/** 4 邻接 A*（纯函数）。格子编号 = y·n + x。 */
export function findPath(
  n: number, from: number, to: number, cost: (cell: number) => number,
): number[] | null {
  if (from === to) return [from];
  if (!isFinite(cost(to))) return null;
  const tx = to % n, ty = (to / n) | 0;
  const h = (c: number) => Math.abs((c % n) - tx) + Math.abs(((c / n) | 0) - ty);
  const g = new Float64Array(n * n).fill(Infinity);
  const prev = new Int32Array(n * n).fill(-1);
  const closed = new Uint8Array(n * n);
  // 二叉堆：[f, cell]
  const heap: Array<[number, number]> = [];
  const push = (f: number, c: number) => {
    heap.push([f, c]); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = (): number => {
    const top = heap[0][1], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  g[from] = 0; push(h(from), from);
  while (heap.length) {
    const c = pop();
    if (closed[c]) continue;
    if (c === to) break;
    closed[c] = 1;
    const x = c % n, y = (c / n) | 0;
    const nb = [x > 0 ? c - 1 : -1, x < n - 1 ? c + 1 : -1, y > 0 ? c - n : -1, y < n - 1 ? c + n : -1];
    for (const d of nb) {
      if (d < 0 || closed[d]) continue;
      const w = cost(d);
      if (!isFinite(w)) continue;
      const ng = g[c] + w;
      if (ng < g[d]) { g[d] = ng; prev[d] = c; push(ng + h(d), d); }
    }
  }
  if (!isFinite(g[to])) return null;
  const path: number[] = [];
  for (let c = to; c !== -1; c = prev[c]) path.push(c);
  return path.reverse();
}

export function pathCost(path: number[], cost: (cell: number) => number): number {
  let s = 0; for (let i = 1; i < path.length; i++) s += cost(path[i]); return s;
}
