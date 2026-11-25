"""M3-WO3 v1.4 候选的三项原型：河走格边 + 桥 / 汀步（--rivers）、格间过渡带（--ecotones）、山脉鞍部 + 山牌分档 + 山脊线（--ridges）。

只在 preview_grid.py 带对应开关时调用；不带开关时 preview_grid 的输出逐像素不变（执行主管 2026-11-24 的硬约束）。
规格来源：docs/proposals/region_waterways_ecotones_elevation_proposal.md + 执行主管同日的裁定（第一期不切几何、河只走
低侧或抬高区域外沿、异种边不加蛇曲、桥的朝向、过渡带按 6 类归并且并入 SHORE、鞍部只降不升、山牌按层分档不缩放现有牌）。
新素材（山麓丘、桥、汀步、睡莲、码头）此阶段全部用程序占位图，prompt 等用户选定方向后再写。
"""
from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageDraw

import artlib as al

pg = None          # preview_grid 模块；由 bind() 设置（preview_grid 作为 __main__ 运行时不能在这里 import 它，否则会有两份全局量）


def bind(module) -> None:
    global pg
    pg = module


def h32(*xs):
    return pg.h32(*xs)


def hf(*xs):
    return pg.hf(*xs)


# ── 共用 ────────────────────────────────────────────────────────────────────

def _smooth(a: np.ndarray, k: int) -> np.ndarray:
    if k <= 1 or len(a) < 3:
        return a.astype(np.float64).copy()
    pad = np.pad(a.astype(np.float64), (k // 2, k - 1 - k // 2), mode="edge")
    return np.convolve(pad, np.ones(k) / k, mode="valid")


def _placeholder(draw_fn, w: int, h: int) -> np.ndarray:
    im = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(im), w * 2, h * 2)
    return np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255.0


def _rgb(c, k=1.0):
    return tuple(int(255 * min(1.0, v * k)) for v in c) + (255,)


FOOT_KEYS = ("terrain.standee.mountain.foot.0", "terrain.standee.mountain.foot.1")
EXTRA_HEIGHT = {FOOT_KEYS[0]: 0.3, FOOT_KEYS[1]: 0.3, "bridge.arch": 0.16}
FLAT_SIZE = {"bridge.stones": 0.24, "ground.piece.lilypad": 0.16, "loc.prop.pier": 0.36}
NEW_KEYS = list(FOOT_KEYS) + ["bridge.arch", "bridge.plank", "bridge.stones", "ground.piece.lilypad", "loc.prop.pier"]


def ensure_assets(assets) -> None:
    """新素材的占位图（真实素材出图前）：山麓丘 ×2、石拱桥（立牌）；木板桥、汀步、睡莲、码头（平贴）。"""
    if FOOT_KEYS[0] in assets.standee:
        return
    hill = (0.60, 0.62, 0.50)
    mounds = ((0.3, 0.32, 0.8, 0.86), (0.68, 0.34, 0.62, 1.0), (0.5, 0.2, 0.95, 0.93))

    def foot(k):
        def f(d, W, H):
            for cx, rx, ry, col in mounds[k:] + mounds[:k]:
                d.ellipse([W * (cx - rx), H * (1 - ry), W * (cx + rx), H * (1 + ry)], fill=_rgb(hill, col))
        return f
    src = assets.standee.get("terrain.standee.mountain.0")
    for k, key in enumerate(FOOT_KEYS):
        if src is not None:                       # 有山牌图时：把它压扁成 2:1 的矮丘当占位（只为预览读得出层次，真图另出）
            im = Image.fromarray(al.to_u8(src), "RGBA")
            if k:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            arr = np.asarray(im.resize((512, 256), Image.LANCZOS), np.float32) / 255.0
            arr[..., :3] = arr[..., :3] * 0.9 + np.array([0.60, 0.62, 0.50], np.float32) * 0.1
            assets.standee[key] = arr
        else:
            assets.standee[key] = _placeholder(foot(k), 512, 256)

    def arch(d, W, H):
        stone = (0.72, 0.69, 0.62)
        d.rectangle([0, H * 0.18, W, H], fill=_rgb(stone))
        d.rectangle([0, 0, W, H * 0.2], fill=_rgb(stone, 0.86))
        d.ellipse([W * 0.2, H * 0.42, W * 0.8, H * 1.6], fill=(0, 0, 0, 0))
    assets.standee["bridge.arch"] = _placeholder(arch, 416, 160)

    def plank(d, W, H):
        wood = (0.62, 0.50, 0.36)
        d.rectangle([0, H * 0.3, W, H * 0.7], fill=_rgb(wood))
        for k in range(1, 9):
            d.line([W * k / 9, H * 0.3, W * k / 9, H * 0.7], fill=_rgb(wood, 0.75), width=max(1, W // 120))

    def stones(d, W, H):
        for k in range(4):
            cx = W * (0.14 + 0.24 * k)
            d.ellipse([cx - W * 0.09, H * 0.38, cx + W * 0.09, H * 0.62], fill=_rgb((0.66, 0.65, 0.62), 1 - 0.05 * (k % 2)))

    def lily(d, W, H):
        for cx, cy, r in ((0.35, 0.4, 0.22), (0.68, 0.62, 0.17), (0.3, 0.75, 0.12)):
            d.pieslice([W * (cx - r), H * (cy - r), W * (cx + r), H * (cy + r)], 20, 340, fill=_rgb((0.42, 0.58, 0.38)))

    def pier(d, W, H):
        wood = (0.60, 0.48, 0.34)
        d.rectangle([W * 0.08, H * 0.36, W * 0.92, H * 0.64], fill=_rgb(wood))
        for x in (0.3, 0.55, 0.8):
            d.rectangle([W * (x - 0.02), H * 0.3, W * (x + 0.02), H * 0.7], fill=_rgb(wood, 0.7))
    for key, fn in (("bridge.plank", plank), ("bridge.stones", stones), ("ground.piece.lilypad", lily), ("loc.prop.pier", pier)):
        assets.piece[key] = _placeholder(fn, 128, 128)
    assets.fake += NEW_KEYS


def composite_pieces(col: np.ndarray, pieces, assets, i: int, j: int, res: int) -> np.ndarray:
    """平贴件印到格 (i, j) 的瓦片上（与 preview_grid.cell_tile 里地面散件同一套仿射）。"""
    for key, px, pz, size, ang in pieces:
        if abs(px - (i + 0.5)) > 0.5 + size * 0.75 or abs(pz - (j + 0.5)) > 0.5 + size * 0.75:
            continue
        pc = assets.piece[key]
        ph, pw = pc.shape[:2]
        ca, sa = math.cos(ang), math.sin(ang)
        kx, ky = pw / size, ph / size
        coeffs = (kx * ca / res, kx * sa / res, kx * (ca * (i - px) + sa * (j - pz)) + pw / 2,
                  -ky * sa / res, ky * ca / res, ky * (-sa * (i - px) + ca * (j - pz)) + ph / 2)
        warped = Image.fromarray(al.to_u8(pc), "RGBA").transform((res, res), Image.AFFINE, coeffs, Image.BILINEAR)
        wa = np.asarray(warped, np.float32) / 255.0
        col = col * (1 - wa[..., 3:]) + wa[..., :3] * wa[..., 3:]
    return col


# ── A. 河：走格边，不占格 ────────────────────────────────────────────────────

RIVER_W0, RIVER_W1 = 0.06, 0.14     # 上游 → 下游的宽度（不超过道路 0.14）
CHAIKIN_R = 0.15                    # 切角半径上限：拐角两边各最多 0.15 被切圆
CLEAR_R, CLEAR_PAD = 0.18, 0.03     # 河中线到任何格心 ≥ CLEAR_R + w/2 + CLEAR_PAD（棋子与地名的空地）
MEANDER_A0, MEANDER_A1 = 0.04, 0.12  # 蛇曲振幅目标（上游 → 下游），逐采样点再按上面的不变量钳制
FOOT_GAP = 0.02                     # 贴山脚走时，河岸离侧壁脚的距离
RIM_W = 0.012                       # 两岸的纸芯白
AVOID_PAD = 0.03                    # 布置避开河道的外扩
STEP = 0.02                         # 中线采样间距


@dataclass
class River:
    grid: list                       # 角点序列 [(u, v)]（格坐标，扭曲空间）
    edges: set                       # 经过的格边 {frozenset((a, b))}
    pts: np.ndarray                  # 世界坐标中线 (M, 2)
    width: np.ndarray                # (M,)
    s: np.ndarray                    # 弧长 (M,)
    tan: np.ndarray = field(default=None)   # 世界坐标单位切向 (M, 2)
    base: np.ndarray = field(default=None)  # 扭曲空间里、加蛇曲之前的中线 (M, 2)（测试切角半径用）


def edge_cells(a, b):
    """格边 (a, b)（相邻两个角点）两侧的格。"""
    (u0, v0), (u1, v1) = a, b
    if v0 == v1:
        u = min(u0, u1)
        return (u, v0 - 1), (u, v0)
    v = min(v0, v1)
    return (u0 - 1, v), (u0, v)


def shared_edge(a, b):
    """相邻两格 a、b 之间的格边（角点对）。"""
    (i, j), (k, l) = a, b
    if k != i:
        x = max(i, k)
        return frozenset(((x, j), (x, j + 1)))
    z = max(j, l)
    return frozenset(((i, z), (i + 1, z)))


def _vcells(u, v):
    return ((u - 1, v - 1), (u, v - 1), (u - 1, v), (u, v))


def river_edge_ok(terrain: dict, levels: dict, a, b, water=("lake",)) -> bool:
    """河能不能走这条格边：两侧都在地区内、都不是水面，且不是「两侧都抬高」（两侧都 ≤ 0，或抬高区域的外沿）。"""
    c1, c2 = edge_cells(a, b)
    if c1 not in terrain or c2 not in terrain:
        return False
    if terrain[c1] in water or terrain[c2] in water:
        return False
    return not (levels.get(c1, 0.0) > 0 and levels.get(c2, 0.0) > 0)


def make_rivers(terrain: dict, levels: dict, road: list, seed: int, water=("lake",), raised=("mountain",),
                count: int | None = None) -> list[River]:
    """按种子生成河（原型里 15×15 地区 1–2 条、更小的 1 条；正式数据是 RegionDef.rivers，缺省才按种子生成）。"""
    if not terrain:
        return []
    I = [k[0] for k in terrain]
    J = [k[1] for k in terrain]
    ilo, ihi, jlo, jhi = min(I), max(I) + 1, min(J), max(J) + 1
    lev = lambda c: levels.get(c, 0.0)

    def on_edge(v):
        return v[0] in (ilo, ihi) or v[1] in (jlo, jhi)

    def touches(v, pred):
        return any(c in terrain and pred(c) for c in _vcells(*v))
    road_edges = {shared_edge(a, b) for a, b in zip(road[:-1], road[1:])}
    is_lake_v = lambda v: touches(v, lambda c: terrain[c] in water)

    def elev(v):
        cs = [lev(c) for c in _vcells(*v) if c in terrain]
        return sum(cs) / len(cs) if cs else 0.0
    verts = [(u, v) for u in range(ilo, ihi + 1) for v in range(jlo, jhi + 1)]
    sources = [v for v in verts if not on_edge(v) and not is_lake_v(v)
               and touches(v, lambda c: terrain[c] in raised and lev(c) > 0)
               and touches(v, lambda c: lev(c) <= 0 and terrain[c] not in water)]
    entering = not sources
    if entering:                                  # 没有山：河从地图外流进来
        sources = [v for v in verts if on_edge(v) and not is_lake_v(v)]
    n = count if count is not None else (1 + h32(seed, 600) % 2 if len(terrain) >= 150 else 1)
    rivers: list[River] = []
    banned: set = set()
    DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for r in range(n):
        order = sorted(sources, key=lambda v: h32(seed, v[0], v[1], 601 + r))
        found = None
        for src in order[:40]:
            if src in banned:
                continue
            dist = {(src, -1): 0.0}
            prev = {}
            heap = [(0.0, src, -1)]
            best_t = {}
            while heap:
                cst, v, d = heapq.heappop(heap)
                if cst > dist.get((v, d), 1e18):
                    continue
                if v != src and (is_lake_v(v) or on_edge(v)):
                    if v not in best_t or cst < best_t[v][0]:
                        best_t[v] = (cst, d)
                    continue                      # 目标点不再往外走
                for k, (du, dv) in enumerate(DIRS):
                    w = (v[0] + du, v[1] + dv)
                    if w in banned or not (ilo <= w[0] <= ihi and jlo <= w[1] <= jhi) or \
                            not river_edge_ok(terrain, levels, v, w, water):
                        continue
                    e = frozenset((v, w))
                    c = cst + 1.0 + 1.5 * max(0.0, elev(w) - elev(v)) + (0.45 if k == d else 0.0) + \
                        (0.8 if e in road_edges else 0.0)
                    if c < dist.get((w, k), 1e18):
                        dist[(w, k)] = c
                        prev[(w, k)] = (v, d)
                        heapq.heappush(heap, (c, w, k))

            def path_to(t, d):
                p = [t]
                st = (t, d)
                while st in prev:
                    st = prev[st]
                    p.append(st[0])
                return p[::-1]
            cands = []
            for t, (cst, d) in best_t.items():
                p = path_to(t, d)
                L = len(p) - 1
                lake = is_lake_v(t)
                far = abs(t[0] - src[0]) + abs(t[1] - src[1]) >= 6
                if (lake and 3 <= L <= 18) or (not lake and 5 <= L <= 18 and (not entering or far)):
                    cands.append((0 if lake else 1, -L, h32(seed, t[0], t[1], 602), p))
            if cands:
                found = min(cands)[3]
                break
        if not found:
            continue
        for v in found:
            for du in (-1, 0, 1):
                for dv in (-1, 0, 1):
                    banned.add((v[0] + du, v[1] + dv))
        rivers.append(_shape(found, terrain, levels, seed, r))
    return rivers


def chaikin(P: np.ndarray, radius: float = CHAIKIN_R) -> np.ndarray:
    """Chaikin 两次。radius = 拐角两边被切圆的总长度（两次合计 a + a(1 − 2a) = radius → 每次的比例 a），离拐角更远的点仍在折线上。"""
    r = (1 - math.sqrt(1 - 2 * radius)) / 2
    for _ in range(2):
        out = [P[0]]
        for a, b in zip(P[:-1], P[1:]):
            out += [a + (b - a) * r, a + (b - a) * (1 - r)]
        out.append(P[-1])
        P = np.array(out)
    return P


def resample(P: np.ndarray, step: float = STEP) -> tuple[np.ndarray, np.ndarray]:
    seg = np.hypot(*np.diff(P, axis=0).T)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    t = np.arange(0.0, s[-1] + 1e-9, step)
    if t[-1] < s[-1] - 1e-6:
        t = np.append(t, s[-1])
    return np.stack([np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])], -1), t


def centre_dist(P: np.ndarray) -> np.ndarray:
    """每个点到最近格心 (i+0.5, j+0.5) 的距离（世界坐标）。"""
    base = np.floor(P)
    best = np.full(len(P), np.inf)
    for a in (-1, 0, 1):
        for b in (-1, 0, 1):
            c = base + np.array([a + 0.5, b + 0.5])
            best = np.minimum(best, np.hypot(*(P - c).T))
    return best


def _shape(grid: list, terrain: dict, levels: dict, seed: int, idx: int) -> River:
    lev = lambda c: levels.get(c, 0.0)
    G = np.array(grid, np.float64)
    B, s = resample(chaikin(G))
    L = max(s[-1], 1e-6)
    T = np.gradient(B, axis=0)
    T /= np.hypot(*T.T)[:, None] + 1e-12
    N = np.stack([-T[:, 1], T[:, 0]], -1)
    w = RIVER_W0 + (RIVER_W1 - RIVER_W0) * (s / L) ** 0.8
    qa, qb = np.floor(B + N * 0.07).astype(int), np.floor(B - N * 0.07).astype(int)
    ta = [terrain.get((int(x), int(z))) for x, z in qa]
    tb = [terrain.get((int(x), int(z))) for x, z in qb]
    La = np.array([lev((int(x), int(z))) for x, z in qa])
    Lb = np.array([lev((int(x), int(z))) for x, z in qb])
    same = np.array([a is not None and a == b for a, b in zip(ta, tb)], np.float64)
    amp = (MEANDER_A0 + (MEANDER_A1 - MEANDER_A0) * s / L) * (_smooth(same, 15) > 0.999)   # 异种边（含两头过渡）振幅取 0
    amp = _smooth(amp, 9)
    foot = np.where((La > 0) & (Lb <= 0), -(w / 2 + FOOT_GAP), np.where((Lb > 0) & (La <= 0), w / 2 + FOOT_GAP, 0.0))
    foot = _smooth(foot, 9)
    lam = 0.6 + 0.4 * hf(seed, idx, 621)
    phi = 2 * math.pi * hf(seed, idx, 620)
    off = amp * np.sin(2 * math.pi * s / lam + phi) + foot
    thr = CLEAR_R + w / 2 + CLEAR_PAD
    f = np.ones_like(off)
    bad = np.zeros(len(off), bool)
    for _ in range(12):                          # 逐采样点钳制：振幅不写死，按「离格心」的不变量收
        Q = B + N * (off * f)[:, None]
        P = np.stack(pg.unwarp(Q[:, 0], Q[:, 1], seed), -1)
        bad = centre_dist(P) < thr
        if not bad.any():
            break
        f[bad] *= 0.6
        f = np.minimum(f, _smooth(f, 9))
    if bad.any():
        f[bad] = 0.0
        Q = B + N * (off * f)[:, None]
        P = np.stack(pg.unwarp(Q[:, 0], Q[:, 1], seed), -1)
    Tw = np.gradient(P, axis=0)
    Tw /= np.hypot(*Tw.T)[:, None] + 1e-12
    edges = {frozenset((tuple(a), tuple(b))) for a, b in zip(grid[:-1], grid[1:])}
    return River([tuple(v) for v in grid], edges, P, w, s, Tw, B)


def river_dist(rivers: list, x: float, z: float) -> float:
    """点到河岸的距离（< 0 = 在水里）。"""
    best = np.inf
    for r in rivers:
        d = np.hypot(r.pts[:, 0] - x, r.pts[:, 1] - z) - r.width / 2
        best = min(best, float(d.min()))
    return best


def river_clear(rivers: list, x: float, z: float, margin: float = AVOID_PAD) -> bool:
    return not rivers or river_dist(rivers, x, z) >= margin


def avoid_points(rivers: list, i: int, j: int) -> list[tuple[float, float, float]]:
    """格 (i, j) 附近的河中线采样点 (x, z, 半宽 + 外扩)，给房屋配方用（与避路同一套写法）。"""
    out = []
    for r in rivers:
        m = (r.pts[:, 0] > i - 0.3) & (r.pts[:, 0] < i + 1.3) & (r.pts[:, 1] > j - 0.3) & (r.pts[:, 1] < j + 1.3)
        for k in np.nonzero(m)[0][::2]:
            out.append((float(r.pts[k, 0]), float(r.pts[k, 1]), float(r.width[k] / 2 + AVOID_PAD)))
    return out


def make_crossings(rivers: list, road: list, loc_cells: dict, terrain: dict, seed: int, water=("lake",)) -> list[dict]:
    """道路跨河处放桥（木板桥 = 平贴件，任意方向；石拱桥 = 立牌，只在道路与屏幕水平夹角 ≤ 30° 且靠近城镇时），
    其余每隔 3–5 格放一组汀步（ford）。返回 crossings：{edge, kind: 'bridge' | 'ford', style, x, z, ang, river, k, width}。"""
    out: list[dict] = []
    towns = [c for c, k in loc_cells.items() if k in ("town", "city", "sectSeat")]
    for ri, r in enumerate(rivers):
        used_s = []
        done = set()
        for a, b in zip(road[:-1], road[1:]):
            e = shared_edge(a, b)
            if e not in r.edges or e in done:       # 道路折返时同一条边只放一座桥
                continue
            done.add(e)
            A = np.array([a[0] + 0.5, a[1] + 0.5])
            Bp = np.array([b[0] + 0.5, b[1] + 0.5])
            dvec = Bp - A
            t = np.clip(((r.pts - A) @ dvec) / (dvec @ dvec), 0, 1)
            k = int(np.argmin(np.hypot(*(r.pts - (A + t[:, None] * dvec)).T)))
            horizontal = a[1] == b[1]                # 道路沿 x：与屏幕水平夹角 0°
            near_town = any(max(abs(c[0] - p[0]), abs(c[1] - p[1])) <= 1 for c in towns for p in (a, b))
            style = "arch" if horizontal and near_town else "plank"
            out.append({"edge": e, "kind": "bridge", "style": style, "x": float(r.pts[k, 0]), "z": float(r.pts[k, 1]),
                        "ang": math.atan2(dvec[1], dvec[0]), "river": ri, "k": k, "width": float(r.width[k]),
                        "horizontal": horizontal})
            used_s.append(r.s[k])
        nxt = 3.0 + h32(seed, ri, 640) % 3
        for k in range(len(r.s)):
            if r.s[k] < nxt:
                continue
            if any(abs(r.s[k] - u) < 1.2 for u in used_s):
                continue
            x, z = r.pts[k]
            n = np.array([-r.tan[k, 1], r.tan[k, 0]])
            sides = [pg.owner(terrain, x + n[0] * s_ * 0.12, z + n[1] * s_ * 0.12, seed) for s_ in (1, -1)]
            if None in sides or any(t in water for t in sides):
                continue
            g = np.array(r.grid, np.float64)
            mids = (g[:-1] + g[1:]) / 2
            q = np.array([x, z]) + np.array(pg.warp(x, z, seed))
            m = int(np.argmin(np.hypot(*(mids - q).T)))
            out.append({"edge": frozenset((r.grid[m], r.grid[m + 1])), "kind": "ford", "style": "stones",
                        "x": float(x), "z": float(z), "ang": math.atan2(n[1], n[0]), "river": ri, "k": k,
                        "width": float(r.width[k]), "horizontal": False})
            used_s.append(r.s[k])
            nxt = r.s[k] + 3.0 + h32(seed, ri, k, 641) % 3
    return out


def crossing_items(crossings: list[dict]) -> tuple[list, list]:
    """crossings → (立牌参数, 平贴件)。木板桥、汀步是平贴件，石拱桥是立牌。"""
    cards, flats = [], []
    for c in crossings:
        if c["style"] == "arch":
            cards.append(("bridge.arch", c["x"], c["z"], EXTRA_HEIGHT["bridge.arch"]))
        elif c["style"] == "plank":
            flats.append(("bridge.plank", c["x"], c["z"], max(c["width"] + 0.18, 0.3), c["ang"]))
        else:
            flats.append(("bridge.stones", c["x"], c["z"], FLAT_SIZE["bridge.stones"], c["ang"]))
    return cards, flats


def river_field(rivers: list, X: np.ndarray, Z: np.ndarray, pad: float = 0.12):
    """瓦片像素（世界坐标 X、Z）到最近河中线的 (距离, 在哪一侧 ±1, 半宽, 该段法线 nx, nz)；远处距离 = inf。"""
    D = np.full(X.shape, np.inf)
    S = np.zeros(X.shape)
    HW = np.zeros(X.shape)
    NX = np.zeros(X.shape)
    NZ = np.zeros(X.shape)
    x0, x1, z0, z1 = X.min() - pad, X.max() + pad, Z.min() - pad, Z.max() + pad
    for r in rivers:
        P, W = r.pts[::2], r.width[::2]
        A, Bp = P[:-1], P[1:]
        m = ((np.maximum(A[:, 0], Bp[:, 0]) > x0) & (np.minimum(A[:, 0], Bp[:, 0]) < x1) &
             (np.maximum(A[:, 1], Bp[:, 1]) > z0) & (np.minimum(A[:, 1], Bp[:, 1]) < z1))
        for k in np.nonzero(m)[0]:
            ax, az = A[k]
            ex, ez = Bp[k] - A[k]
            L2 = ex * ex + ez * ez + 1e-12
            t = np.clip(((X - ax) * ex + (Z - az) * ez) / L2, 0, 1)
            px, pz = X - (ax + t * ex), Z - (az + t * ez)
            d = np.hypot(px, pz)
            better = d < D
            if not better.any():
                continue
            ln = math.sqrt(L2)
            D = np.where(better, d, D)
            S = np.where(better, np.sign(ex * pz - ez * px), S)
            HW = np.where(better, (W[k] + (W[k + 1] - W[k]) * t) / 2, HW)
            NX = np.where(better, -ez / ln, NX)
            NZ = np.where(better, ex / ln, NZ)
    return D, S, HW, NX, NZ


def paint_river(col, field_, water_tex, blocked, shadow_dir, res, shallow, rim):
    """河带：水面（用湖泊底纸）+ 岸边浅水 + 靠光一侧的岸投下的压暗 + 两岸纸芯白。blocked = 湖面 / 抬高处不画。"""
    D, S, HW, NX, NZ = field_
    aa = 1.0 / res
    water = 1 - pg.smoothstep(HW - aa, HW + aa, D)
    band = 1 - pg.smoothstep(HW + RIM_W - aa, HW + RIM_W + aa, D)
    rimk = np.clip(band - water, 0, 1)
    lx, lz = shadow_dir
    lit = np.clip(-S * (NX * lx + NZ * lz) / math.hypot(lx, lz), 0, 1)       # 岸在光来的一侧 → 影子落进河里
    sh = (1 - pg.smoothstep(0.0, 0.03, HW - D)) * (0.3 + 0.7 * lit)
    k = (1 - pg.smoothstep(0.0, 0.04, HW - D)) * 0.3
    c = water_tex * (1 - k[..., None]) + shallow * k[..., None]
    c = c * (1 - 0.35 * sh)[..., None]
    ok = (~blocked).astype(np.float32)
    a = (water * ok)[..., None]
    col = col * (1 - a) + c * a
    r_ = (rimk * ok * 0.9)[..., None]
    return col * (1 - r_) + rim * r_


def bank_cards(rivers, crossings, terrain, seed, shore, item_heights, has_real, bases, scene, water=("lake",)):
    """河岸的岸边件：SHORE 同一池子，密度减半（每 0.5 格弧长试一次、一半概率），点在河岸外 0.05–0.09。"""
    out = []
    if not shore:
        return out
    keys = has_real(shore["fillers"])
    for ri, r in enumerate(rivers):
        for k in range(0, len(r.s), 25):
            if hf(seed, ri, k, 650) < 0.5:
                continue
            if any(abs(r.s[k] - r.s[c["k"]]) < 0.2 for c in crossings if c["river"] == ri):
                continue
            side = 1 if hf(seed, ri, k, 651) < 0.5 else -1
            n = np.array([-r.tan[k, 1], r.tan[k, 0]]) * side
            off = r.width[k] / 2 + 0.05 + 0.04 * hf(seed, ri, k, 652)
            x, z = r.pts[k] + n * off
            t = pg.owner(terrain, x, z, seed)
            if t is None or t in water or t == "settlement" or not pg.level_ok(scene, x, z, seed):
                continue
            if not river_clear(rivers, x, z):
                continue
            cell = (math.floor(x), math.floor(z))
            taken = bases.setdefault(cell, [])
            if any((x - a) ** 2 + (z - b) ** 2 <= 0.11 ** 2 for a, b in taken):
                continue
            key = keys[h32(seed, ri, k, 653) % len(keys)]
            out.append((key, float(x), float(z), item_heights[key] * (0.8 + 0.3 * hf(seed, ri, k, 654))))
            taken.append((x, z))
    return out


# ── B. 过渡带：6 类 × 6 类的规则表，SHORE 并在里面 ──────────────────────────

CATEGORY = {"lake": "water", "woods": "wood", "jungle": "wood", "mulberry": "wood", "vale": "wood",
            "mountain": "stone", "stoneForest": "stone", "cave": "stone", "canyon": "stone", "abyss": "stone",
            "marsh": "wet", "farmland": "farm", "herbGarden": "farm",
            "plain": "open", "hill": "open", "waste": "open", "garden": "open", "settlement": "settle"}
FILLER_CAP = 8                      # 过渡带件计入每格填充小件的上限，不额外加
FOREST_EDGE, FOREST_EDGE_K = 0.2, 0.75


def eco_rules(shore: dict | None) -> dict:
    """(本侧类别, 对侧类别) → (候选件, 张数, 带内距离 min, max, 方式)。方式：card 立牌；low 只放在低的一侧（贴侧壁脚）；flat 平贴。"""
    R = {}
    if shore:
        for c in ("open", "wood", "farm", "stone", "wet"):
            R[(c, "water")] = (tuple(shore["fillers"]), tuple(shore["count"]), 0.03, float(shore["band"]), "card")
    for c in ("open", "wood", "farm", "stone", "wet"):
        R[("water", c)] = (("ground.piece.lilypad",), (0, 2), 0.03, 0.10, "flat")
    for c in ("open", "farm", "wet"):
        R[(c, "wood")] = (("filler.bush.0", "filler.bush.1", "filler.fern", "filler.stump"), (0, 2), 0.04, 0.2, "card")
    for c in ("open", "farm", "wood", "wet"):
        R[(c, "stone")] = (("filler.rock.0", "filler.rock.1", "filler.tuft.1"), (1, 2), pg.LEVEL_EDGE_GAP + 0.006, 0.1, "low")
    for c in ("open", "farm"):
        R[(c, "wet")] = (("filler.reeds", "filler.tuft.0"), (1, 2), 0.03, 0.2, "card")
    for c in ("open", "farm"):                    # 沼泽 × 湖仍走上面的岸边件规则（芦苇等），积水洼只朝陆地
        R[("wet", c)] = (("ground.piece.puddle",), (0, 1), 0.03, 0.15, "flat")
    R[("farm", "settle")] = (("loc.prop.fence",), (0, 1), 0.05, 0.1, "card")
    return R


def boundary_dist(terrain: dict, x: float, z: float, seed: int, pred) -> float:
    """点 (x, z) 到「对侧满足 pred 的格边」的距离（扭曲空间里量；没有这样的边 = inf）。"""
    dx, dz = pg.warp(x, z, seed)
    qx, qz = x + dx, z + dz
    i, j = math.floor(qx), math.floor(qz)
    fu, fv = qx - i, qz - j
    best = math.inf
    for (di, dj), d in (((-1, 0), fu), ((1, 0), 1 - fu), ((0, -1), fv), ((0, 1), 1 - fv)):
        t = terrain.get((i + di, j + dj))
        if t is not None and pred(t):
            best = min(best, d)
    return best


def ecotone_items(scene, terrain: dict, seed: int, item_heights: dict, has_real, bases: dict, filler_count: dict,
                  shore: dict | None, rivers: list, levels: dict, water=("lake",)):
    """沿每条异种格边、在本侧的带里撒过渡件。返回 (立牌参数列表, 地面平贴件, 压在路上的平贴件——码头)。"""
    rules = eco_rules(shore)
    cards, flats, overlay = [], [], []
    lev = lambda c: levels.get(c, 0.0)
    for (i, j), t in sorted(terrain.items()):
        c = CATEGORY.get(t, "open")
        if c == "settle":
            for di, dj in ((0, 1), (1, 0), (-1, 0), (0, -1)):          # 码头：只在紧邻水面的聚居格，一格一个
                if terrain.get((i + di, j + dj)) in water:
                    ex = i + (1.0 if di > 0 else 0.0 if di < 0 else 0.5)
                    ez = j + (1.0 if dj > 0 else 0.0 if dj < 0 else 0.5)
                    px, pz = pg.unwarp(np.array([ex]), np.array([ez]), seed)
                    overlay.append(("loc.prop.pier", float(px[0]), float(pz[0]), FLAT_SIZE["loc.prop.pier"],
                                    math.atan2(dj, di)))
                    break
            continue
        group_cnt: dict = {}
        for di, dj in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nt = terrain.get((i + di, j + dj))
            if nt is None:
                continue
            nc = CATEGORY.get(nt, "open")
            rule = rules.get((c, nc))
            if not rule or nc == c:
                continue
            cands, (lo, hi), dmin, dmax, mode = rule
            if mode == "low" and levels and not lev((i + di, j + dj)) > lev((i, j)):
                continue                          # 山脚散石只放在低的一侧
            n = lo + h32(seed, i, j, di, dj, 660) % (hi - lo + 1)
            n = min(n, hi - group_cnt.get((nc, mode), 0))   # 同一类对侧的几条边合起来不超过上限（岸边件同原规则）
            keys = has_real(list(cands)) if mode != "flat" else list(cands)
            placed = 0
            for tries in range(14 * max(n, 1)):
                if placed >= n:
                    break
                sa = 0.1 + 0.8 * hf(seed, i, j, di, dj, 661, tries)
                d = dmin + (dmax - dmin) * hf(seed, i, j, di, dj, 662, tries)
                if di:
                    qx, qz = i + (1 if di > 0 else 0) - di * d, j + sa
                else:
                    qx, qz = i + sa, j + (1 if dj > 0 else 0) - dj * d
                px, pz = pg.unwarp(np.array([qx]), np.array([qz]), seed)
                x, z = float(px[0]), float(pz[0])
                if pg.owner(terrain, x, z, seed) != t:
                    continue
                key = keys[h32(seed, i, j, di, dj, 663, tries) % len(keys)]
                if mode == "flat":
                    size = FLAT_SIZE.get(key, item_heights.get(key, 0.3) * 0.6)
                    if not river_clear(rivers, x, z, size * 0.35 + AVOID_PAD):
                        continue
                    flats.append((key, x, z, size, 2 * math.pi * hf(seed, i, j, di, dj, 664, tries)))
                    placed += 1
                    continue
                if not pg.level_ok(scene, x, z, seed) or not river_clear(rivers, x, z):
                    continue
                cell = (math.floor(x), math.floor(z))
                if filler_count.get(cell, 0) >= FILLER_CAP:
                    break
                taken = bases.setdefault(cell, [])
                if any((x - a) ** 2 + (z - b) ** 2 <= 0.11 ** 2 for a, b in taken):
                    continue
                cards.append((key, x, z, item_heights[key] * (0.85 + 0.3 * hf(seed, i, j, di, dj, 665, tries))))
                taken.append((x, z))
                filler_count[cell] = filler_count.get(cell, 0) + 1
                placed += 1
            group_cnt[(nc, mode)] = group_cnt.get((nc, mode), 0) + placed
    return cards, flats, overlay


# ── C. 山脉：鞍部（只降不升）、山牌分档、山脊线 ──────────────────────────────

SADDLE_P = 0.4
# v1.5：高档用连绵山体、主峰用主峰立牌（清单 role = massif / peak）；这两档一格只放 1 张
TIER_KEYS = {"mid": "terrain.standee.mountain.0", "tall": "terrain.standee.mountain.1",
             "high": "terrain.standee.mountain.2", "peak": "terrain.standee.mountain.peak"}
# 遮挡约束（执行主管 2026-11-25）：俯角 53° 下 1.5 格高的主峰挡住身后约 1.1 格地面 → 主峰只放在「正后方一格也是山岳」的格，
# 立在本格靠后 PEAK_BACK 处；连绵山体宽约 1.44 格 → 只放左右邻格都是山岳的内部格。放不下就降档：主峰 → 连绵山体 → 孤峰 mountain.1（tall）
PEAK_BACK = 0.2
RIDGE_SPREAD, RIDGE_PERP = 0.2, 0.08


@dataclass
class MountainPlan:
    levels: dict                     # 加了鞍部的层号
    tier: dict                       # 格 → 'low' | 'mid' | 'high' | 'peak'
    axis: dict                       # 格 → 山脉主轴 (ax, az)
    peaks: set                       # 每条山脉的主峰格（至多 1 个）
    peak_height: float | None = None   # None = 按清单的高


def mountain_plan(terrain: dict, levels: dict, seed: int, peak_height: float | None = None, kind: str = "mountain") -> MountainPlan:
    lv = dict(levels)
    tier, axis, peaks = {}, {}, set()
    seen = set()
    for c0 in sorted(terrain):
        if terrain[c0] != kind or c0 in seen:
            continue
        comp, stack = [], [c0]
        seen.add(c0)
        while stack:
            c = stack.pop()
            comp.append(c)
            for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = (c[0] + a, c[1] + b)
                if terrain.get(n) == kind and n not in seen:
                    seen.add(n)
                    stack.append(n)
        comp.sort()
        cs = set(comp)
        is_front = lambda c: (c[0], c[1] + 1) not in cs or (c[0], c[1] + 2) not in cs   # 靠镜头的两行
        ok_peak = [c for c in comp if (c[0], c[1] - 1) in cs and not is_front(c)]        # 正后方一格也是山岳
        main = max(ok_peak, key=lambda c: (lv.get(c, 1), h32(seed, c[0], c[1], 630))) if ok_peak else None
        if main is not None:
            peaks.add(main)
        for c in comp:                           # 鞍部：内部格按哈希降 1，降不到 1 以下；同种四邻层号差 ≤ 1；外沿恒为 +1
            L = lv.get(c, 1)
            if c == main or L < 2 or hf(seed, c[0], c[1], 631) >= SADDLE_P:
                continue
            new = L - 1
            nb = [lv.get((c[0] + a, c[1] + b), 1) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))
                  if terrain.get((c[0] + a, c[1] + b)) == kind]
            if all(abs(x - new) <= 1 for x in nb):
                lv[c] = new
        X = np.array([(c[0] + 0.5, c[1] + 0.5) for c in comp])
        ax = (1.0, 0.0)
        if len(comp) >= 3:
            w, V = np.linalg.eigh(np.cov(X.T))
            if w[1] >= 1.5 * max(w[0], 1e-9):
                v = V[:, 1]
                ax = (float(v[0]), float(v[1])) if v[0] >= 0 else (float(-v[0]), float(-v[1]))
        for c in comp:
            axis[c] = ax
            L = lv.get(c, 1)
            t_ = "low" if is_front(c) else "peak" if c == main else "high" if L >= 3 else "mid" if L >= 2 else "low"
            if t_ == "high" and not ((c[0] - 1, c[1]) in cs and (c[0] + 1, c[1]) in cs):
                t_ = "tall"                              # 连绵山体宽过一格：左右邻格都得是山岳，否则降成孤峰
            tier[c] = t_
    return MountainPlan(lv, tier, axis, peaks, peak_height)


def mountain_slots(plan: MountainPlan, i: int, j: int, n: int, seed: int) -> list[tuple[str, float, float, float | None]]:
    """格 (i, j) 的山牌：(artKey, 格内 ox, oz, 高 | None = 按清单高 × 缩放)。槽位在过格心、沿主轴的线上，
    垂直方向按哈希偏 ±0.08；主峰只放 1 张。"""
    t = plan.tier[(i, j)]
    ax, az = plan.axis[(i, j)]
    px_, pz_ = -az, ax
    if t in ("peak", "high"):
        n = 1
    ts = [0.0] if n <= 1 else [-RIDGE_SPREAD, RIDGE_SPREAD]
    out = []
    for k, tt in enumerate(ts):
        e = (hf(seed, i, j, 670 + k) - 0.5) * 2 * RIDGE_PERP
        ox, oz = ax * tt + px_ * e, az * tt + pz_ * e - (PEAK_BACK if t == "peak" else 0.05)
        if t == "low":
            key = FOOT_KEYS[(h32(seed, i, j, 671) + k) % 2]
            h = EXTRA_HEIGHT[key] * (0.92 + 0.16 * hf(seed, i, j, 672 + k))
        elif t == "peak":
            key, h = TIER_KEYS["peak"], plan.peak_height
        else:
            key, h = TIER_KEYS[t], None
        out.append((key, ox, oz, h))
    out.sort(key=lambda s: s[2])                 # 从后到前
    return out
