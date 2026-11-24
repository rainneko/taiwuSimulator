/**
 * 地形纸层几何（M3-WO3 v1.3 §3.13.2–3.13.3）：在格坐标（扭曲后空间）里建顶面与侧壁，
 * 再把每个顶点 unwarp 回世界坐标；整张地区一个 BufferGeometry、一次绘制。
 *
 * 每格按断点 BP 切成 6×6 子格：0.07 / 0.93 两条线让内缩台阶精确落在子格边上。
 * 子格层号 = levelField(子格中心)。相邻子格层号不同 → 生成一道侧壁，法线朝低的一侧
 * （抬起的朝外、下陷的朝坑内）；地图外视为 0 层，所以外沿凡非 0 层的格都补侧壁。
 * 地图外沿顶点不 unwarp（直边）。
 */
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { LEVEL_INSET, levelField, unwarp, type LevelGrid } from './levels';
import type { WarpPhase } from './warp';

const BP = [0, LEVEL_INSET, 0.3, 0.5, 0.7, 1 - LEVEL_INSET, 1];
const S = BP.length - 1;          // 每格子格数

export interface LayerGeometryStats { tops: number; walls: number }

export function buildLayerGeometry(g: LevelGrid, phase: WarpPhase, step: number): { geometry: BufferGeometry; stats: LayerGeometryStats } {
  const n = g.n, M = n * S;
  const lineAt = (k: number) => (k >= M ? n : Math.floor(k / S) + BP[k % S]);

  // 晶格点（M+1）²：unwarp 后的世界 xz；外沿不 unwarp
  const lx = new Float64Array((M + 1) * (M + 1)), lz = new Float64Array((M + 1) * (M + 1));
  for (let b = 0; b <= M; b++) for (let a = 0; a <= M; a++) {
    const u = lineAt(a), v = lineAt(b), i = b * (M + 1) + a;
    if (a === 0 || b === 0 || a === M || b === M) { lx[i] = u; lz[i] = v; }
    else { const [x, z] = unwarp(u, v, phase); lx[i] = x; lz[i] = z; }
  }

  // 子格层号
  const sub = new Float32Array(M * M);
  for (let b = 0; b < M; b++) for (let a = 0; a < M; a++) {
    const ci = Math.floor(a / S), cj = Math.floor(b / S);
    const cx = (lineAt(a) + lineAt(a + 1)) / 2, cz = (lineAt(b) + lineAt(b + 1)) / 2;
    sub[b * M + a] = levelField(g, cx, cz, ci, cj);
  }
  const subLevel = (a: number, b: number) => (a < 0 || b < 0 || a >= M || b >= M ? 0 : sub[b * M + a]);

  const pos: number[] = [], nor: number[] = [], wall: number[] = [];
  const P = (a: number, b: number): [number, number] => { const i = b * (M + 1) + a; return [lx[i], lz[i]]; };

  // 顶面：每个子格 2 个三角形，顶点不共享（层间是竖直断开的）
  let tops = 0;
  for (let b = 0; b < M; b++) for (let a = 0; a < M; a++) {
    const y = sub[b * M + a] * step;
    const p00 = P(a, b), p01 = P(a, b + 1), p11 = P(a + 1, b + 1), p10 = P(a + 1, b);
    // (x0,z0) → (x0,z1) → (x1,z1) 的叉积朝 +y
    for (const [x, z] of [p00, p01, p11, p00, p11, p10]) { pos.push(x, y, z); nor.push(0, 1, 0); wall.push(0, 0); }
    tops++;
  }

  // 侧壁：在两子格的公共边上，从高的一侧顶面落到低的一侧顶面
  let walls = 0;
  const addWall = (e0: [number, number], e1: [number, number], hi: number, lo: number, towardLow: [number, number]) => {
    const yh = hi * step, yl = lo * step;
    let nx = -(e1[1] - e0[1]), nz = e1[0] - e0[0];
    const len = Math.hypot(nx, nz) || 1; nx /= len; nz /= len;
    if (nx * towardLow[0] + nz * towardLow[1] < 0) { nx = -nx; nz = -nz; }
    // 四角：顶 e0、顶 e1、底 e1、底 e0；按法线选绕序
    const A = [e0[0], yh, e0[1]], B = [e1[0], yh, e1[1]], C = [e1[0], yl, e1[1]], D = [e0[0], yl, e0[1]];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
    const cx = uy * vz - uz * vy, cz = ux * vy - uy * vx;
    const quad = cx * nx + cz * nz > 0 ? [A, B, C, A, C, D] : [A, D, C, A, C, B];
    const order = cx * nx + cz * nz > 0 ? [1, 1, 0, 1, 0, 0] : [1, 0, 0, 1, 0, 1];
    quad.forEach((v, k) => { pos.push(v[0], v[1], v[2]); nor.push(nx, 0, nz); wall.push(1, order[k]); });
    walls++;
  };
  const center = (a: number, b: number): [number, number] => {
    const p = P(a, b), q = P(a + 1, b + 1); return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  };
  for (let b = -1; b < M; b++) for (let a = -1; a < M; a++) {
    // 竖边：子格 (a,b) 与 (a+1,b) 之间（公共线 x = a+1）
    if (b >= 0) {
      const l0 = subLevel(a, b), l1 = subLevel(a + 1, b);
      if (l0 !== l1 && a + 1 <= M) {
        const e0 = P(a + 1, b), e1 = P(a + 1, b + 1), mid: [number, number] = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2];
        const low = l0 < l1 ? a : a + 1;
        const lc = low >= 0 && low < M ? center(low, b) : [mid[0] + (low < 0 ? -1 : 1), mid[1]];
        addWall(e0, e1, Math.max(l0, l1), Math.min(l0, l1), [lc[0] - mid[0], lc[1] - mid[1]]);
      }
    }
    // 横边：子格 (a,b) 与 (a,b+1) 之间（公共线 z = b+1）
    if (a >= 0) {
      const l0 = subLevel(a, b), l1 = subLevel(a, b + 1);
      if (l0 !== l1 && b + 1 <= M) {
        const e0 = P(a, b + 1), e1 = P(a + 1, b + 1), mid: [number, number] = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2];
        const low = l0 < l1 ? b : b + 1;
        const lc = low >= 0 && low < M ? center(a, low) : [mid[0], mid[1] + (low < 0 ? -1 : 1)];
        addWall(e0, e1, Math.max(l0, l1), Math.min(l0, l1), [lc[0] - mid[0], lc[1] - mid[1]]);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geometry.setAttribute('aWall', new Float32BufferAttribute(wall, 2));    // x = 侧壁，y = 侧壁上沿（1）/ 下沿（0）
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, stats: { tops: tops * 2, walls: walls * 2 } };
}
