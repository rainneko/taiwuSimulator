#!/usr/bin/env python3
"""静态预览（M3-WO3 §6.2、§7）：不写任何 three.js 代码，就能看到素材摆进格子地图后的效果、比较屏幕密度。

拼出一块格子地面（同种地形连成整页、格线只是浅折痕；异种地形交界是弯曲的撕边并压一道接触阴影，水边有浅水带与岸边件），
立牌按物理高度竖直立起、按从后到前的顺序画，脚下有一片简单落影，聚居点之间有道路纸带。
输出一张 PNG（默认 1920×1080）。

投影：
  默认真透视——fov 27°、俯角 53°、朝向固定（与 M3-WO2 的 FollowRig 一致）；--cols 是注视点那一行横向可见的格数
  （默认 7.5；缩放三档 near 3 / mid 6 / far 整图见 --zoom 与工单 §1.2；试点出 near / mid / far 三张，工单 §7）。
  --ortho 改用正交近似：地面纵深 × sin53° ≈ 0.8、立牌高 × cos53° ≈ 0.6，没有近大远小；用于和透视版对照。
落影方向：--shadow lowerRight（默认）落向屏幕右下；--shadow warmDay 按 M3-WO1 warmDay 的 key 光 (-5, 8, 3) 计算（落向右后方）。

素材：立牌读 --src（key_alpha.py 处理过的 PNG，文件名 = artKey），底纸读 --ground-src（原图即可，自动缩放）；
道路优先读 --src 里处理过的，否则读 --ground-src 里的原图并当场抠像；缺的一律用程序画的占位图，所以零素材也能跑。
加 --placeholders 则完全不读真实素材。

用法：
    python3 tools/art/preview_grid.py
    for z in near mid far; do python3 tools/art/preview_grid.py --zoom $z --sight 1 --region 15 --terrains plain,mountain,woods; done   # 试点
    python3 tools/art/preview_grid.py --cols 9 --ortho --seed 3 --out art/region/review/p.png
    python3 tools/art/preview_grid.py --zoom near --sight 1 --region 15 --ground-px 1024   # 底纸 high 档，对比缺省的 768
"""
from __future__ import annotations

import argparse
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import artlib as al

PITCH = math.radians(53.0)
FOV = math.radians(27.0)
NATURAL = ("plain", "lake", "farmland", "woods", "jungle", "garden", "mountain", "cave", "stoneForest",
           "hill", "vale", "mulberry", "canyon", "marsh", "herbGarden", "waste", "abyss")
# 叠放次序（工单 §3.2.1）
STACK = {"abyss": 10, "lake": 20, "marsh": 30, "farmland": 50, "herbGarden": 50, "mulberry": 50, "plain": 60,
         "waste": 60, "garden": 60, "vale": 60, "settlement": 70, "woods": 80, "jungle": 85, "hill": 90,
         "canyon": 100, "cave": 100, "stoneForest": 110, "mountain": 120}
# 占位色（低饱和）
PALETTE = {"plain": (0.62, 0.68, 0.52), "lake": (0.55, 0.65, 0.70), "farmland": (0.72, 0.70, 0.50),
           "woods": (0.48, 0.60, 0.44), "jungle": (0.33, 0.45, 0.36), "garden": (0.58, 0.68, 0.60),
           "mountain": (0.58, 0.61, 0.64), "cave": (0.50, 0.47, 0.44), "stoneForest": (0.76, 0.76, 0.73),
           "hill": (0.66, 0.67, 0.53), "vale": (0.78, 0.70, 0.70), "mulberry": (0.55, 0.60, 0.42),
           "canyon": (0.68, 0.52, 0.45), "marsh": (0.50, 0.53, 0.44), "herbGarden": (0.58, 0.63, 0.55),
           "waste": (0.72, 0.68, 0.56), "abyss": (0.22, 0.22, 0.27), "settlement": (0.70, 0.66, 0.60)}
SHAPE = {"plain": "tuft", "lake": "tuft", "farmland": "tuft", "marsh": "tuft", "herbGarden": "tuft",
         "woods": "tree", "jungle": "tree", "garden": "tree", "vale": "tree", "mulberry": "tree", "hill": "tree",
         "mountain": "peak", "cave": "peak", "stoneForest": "peak", "canyon": "peak", "abyss": "peak", "waste": "peak"}
SEAM_COLOR = np.array([0.30, 0.27, 0.24], np.float32)
PAGE_COLOR = (236, 228, 212)        # 地区之外：书页的空白边
ZOOMS = {"near": 3.0, "mid": 6.0}
GROUND_PX = 768                     # 底纸入库边长的缺省（medium 档 / 开发期）；high 档 1024，试点时用 --ground-px 对比（工单 §7）   # near：棋子周围 3×3 占满画面（远、近两行略出框）；far = 整张地区缩略（--region N）


def grey(rgb: np.ndarray) -> np.ndarray:
    """视野外：去饱和并略压暗（工单 §3.4 的「已探索、不在视野」）。"""
    lum = rgb[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    g = (lum * 0.8 + 0.1)[..., None]
    return rgb[..., :3] * 0.15 + g * 0.85


def placeholder_pawn(h: int = 256) -> np.ndarray:
    w = int(h * 0.45)
    im = Image.new("RGBA", (w * 3, h * 3), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    W, H = w * 3, h * 3
    d.polygon([(W * 0.12, H), (W * 0.88, H), (W * 0.7, H * 0.38), (W * 0.3, H * 0.38)], fill=(150, 60, 52, 255))
    d.ellipse([W * 0.26, H * 0.04, W * 0.74, H * 0.4], fill=(232, 214, 190, 255))
    d.polygon([(W * 0.0, H * 0.16), (W * 1.0, H * 0.16), (W * 0.5, H * 0.0)], fill=(196, 170, 110, 255))   # 斗笠
    return np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255.0
RIM_COLOR = np.array([0.984, 0.969, 0.933], np.float32)
# v1.1「整页纸」：同种地形之间只有一道浅折痕（不留缝），异种交界是撕口——撕口里露出的是压暗的本色，不是深色底
SEAM, TEAR, SHADE_W, SHADE_K, SHADE_BACK = 0.008, 0.035, 0.06, 0.25, 0.4
CREASE_DARK, TEAR_DARK = 0.10, 0.15
ROAD_W, ROAD_PERIOD = 0.14, 0.56     # v1.1：路收窄到 0.14 格（近档约 90px），贴图 4:1
# v1.1「有机交界」（工单 §3.2.3）：查「这一点属于哪一格」时先把坐标扭一下，异种地形的交界就不再沿格线走，
# 而是弯弯曲曲的岸线 / 林缘；底纸仍按原坐标取，所以纹理本身不变形。两组正弦叠加，最大位移 WARP_AMP 格。
WARP_AMP = 0.16
WARP_WAVES = ((0.7, 2.6, 0.8), (0.3, 5.3, -1.9))      # (权重, 主方向角频率, 交叉项)
SHALLOW_W, SHALLOW_K = 0.10, 0.30                       # 水面一侧沿岸的浅水带：宽、提亮量
SHALLOW_COLOR = np.array([0.86, 0.90, 0.86], np.float32)
LOC_POOL = {"city": ("wall", "lantern", "poles", "steps"), "sectSeat": ("poles", "steps", "lantern"),
            "town": ("lantern", "tree", "fence"), "fort": ("fence", "poles"), "village": ("fence", "tree")}


def h32(*xs: int) -> int:
    """确定性的整数哈希（不依赖 Python 的 hash 随机化）。"""
    v = 0x811C9DC5
    for x in xs:
        v ^= (x & 0xFFFFFFFF)
        v = (v * 0x01000193) & 0xFFFFFFFF
        v ^= v >> 13
        v = (v * 0x5BD1E995) & 0xFFFFFFFF
        v ^= v >> 15
    return v


def hf(*xs: int) -> float:
    return h32(*xs) / 2**32


# ── 相机 ────────────────────────────────────────────────────────────────────

class Camera:
    """固定俯角 53°、朝 −z 看；cols = 注视点处横向可见格数。"""

    def __init__(self, w: int, h: int, cols: float, target=(0.5, 0.0, 0.5), ortho: bool = False) -> None:
        self.w, self.h, self.ortho = w, h, ortho
        self.t = np.array(target, np.float64)
        s, c = math.sin(PITCH), math.cos(PITCH)
        self.fwd = np.array([0.0, -s, -c])
        self.right = np.array([1.0, 0.0, 0.0])
        self.up = np.array([0.0, c, -s])
        self.tanh = math.tan(FOV / 2)
        self.aspect = w / h
        self.dist = cols / (2 * self.tanh * self.aspect)
        self.pos = self.t - self.fwd * self.dist
        self.s_ortho = w / cols

    def project(self, p) -> np.ndarray:
        p = np.atleast_2d(np.asarray(p, np.float64))
        if self.ortho:
            d = p - self.t
            return np.stack([self.w / 2 + d @ self.right * self.s_ortho, self.h / 2 - d @ self.up * self.s_ortho], -1)
        d = p - self.pos
        zc = d @ self.fwd
        x = (d @ self.right) / (zc * self.tanh * self.aspect)
        y = (d @ self.up) / (zc * self.tanh)
        return np.stack([(x + 1) / 2 * self.w, (1 - y) / 2 * self.h], -1)

    def ground_at(self, px: float, py: float) -> tuple[float, float]:
        """屏幕点 → y = 0 地面上的 (x, z)。"""
        nx, ny = px / self.w * 2 - 1, 1 - py / self.h * 2
        if self.ortho:
            o = self.t + self.right * (px - self.w / 2) / self.s_ortho + self.up * (self.h / 2 - py) / self.s_ortho
            d = self.fwd
        else:
            o = self.pos
            d = self.fwd + self.right * nx * self.tanh * self.aspect + self.up * ny * self.tanh
        t = -o[1] / d[1]
        g = o + d * t
        return float(g[0]), float(g[2])


def homography(src, dst) -> np.ndarray:
    """4 点对应求 3×3 单应矩阵 H，使 dst ~ H·src。"""
    a, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    hv = np.linalg.solve(np.array(a, np.float64), np.array(b, np.float64))
    return np.append(hv, 1.0).reshape(3, 3)


def warp_into(canvas: Image.Image, img: Image.Image, quad: np.ndarray) -> None:
    """把 img 的四角 (左上, 右上, 右下, 左下) 透视贴到画布上的 quad（像素坐标），按 alpha 合成。"""
    x0, y0 = np.floor(quad.min(0)).astype(int)
    x1, y1 = np.ceil(quad.max(0)).astype(int)
    cx0, cy0, cx1, cy1 = max(x0, 0), max(y0, 0), min(x1, canvas.width), min(y1, canvas.height)
    if cx1 <= cx0 or cy1 <= cy0:
        return
    w, h = img.size
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    H = homography(quad - [cx0, cy0], src)            # 输出 → 输入
    coeffs = tuple((H / H[2, 2]).reshape(-1)[:8])
    out = img.transform((cx1 - cx0, cy1 - cy0), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    canvas.alpha_composite(out, (cx0, cy0))


# ── 素材 ────────────────────────────────────────────────────────────────────

@dataclass
class Assets:
    ground: dict[str, np.ndarray] = field(default_factory=dict)     # 地形 → RGB float（正方形、可平铺）
    standee: dict[str, np.ndarray] = field(default_factory=dict)    # artKey → RGBA float（已裁边）
    piece: dict[str, np.ndarray] = field(default_factory=dict)      # 地面散件 artKey → RGBA float
    road: np.ndarray | None = None
    edge: np.ndarray | None = None                                  # 灰度，上白下黑
    real: list[str] = field(default_factory=list)
    fake: list[str] = field(default_factory=list)
    ground_px: int | None = None      # 底纸入库边长（一张覆盖 2×2 格）：模拟画质档，768 = medium / 开发期，1024 = high


def periodic_noise(size: int, seed: int, kmax: int = 9) -> np.ndarray:
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size] / size
    f = np.zeros((size, size))
    for _ in range(30):
        kx, ky = rng.integers(-kmax, kmax + 1, 2)
        f += np.sin(2 * np.pi * (kx * xx + ky * yy) + rng.uniform(0, 2 * np.pi)) / (1 + np.hypot(kx, ky))
    return ((f - f.mean()) / (np.abs(f).max() + 1e-6)).astype(np.float32)


def placeholder_ground(terrain: str, size: int = 256) -> np.ndarray:
    base = np.array(PALETTE.get(terrain, (0.6, 0.6, 0.6)), np.float32)
    n = periodic_noise(size, seed=h32(len(terrain), ord(terrain[0]), ord(terrain[-1])) % 10_000)
    img = base[None, None] * (1 + 0.10 * n[..., None])
    if terrain in ("farmland", "mulberry"):
        rows = (np.sin(np.arange(size) / size * 2 * np.pi * 8) > 0.3)[:, None, None]
        img = np.where(rows, img * 0.86, img)
    return np.clip(img, 0, 1)


def placeholder_standee(shape: str, colour, aspect: float, seed: int, h: int = 256) -> np.ndarray:
    """程序画的占位立牌：两种明度叠出前后两层，底边平直。"""
    w = max(16, int(h * aspect))
    ss = 3
    im = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    W, H = w * ss, h * ss
    c = np.array(colour)
    dark = tuple(int(v * 255) for v in np.clip(c * 0.78, 0, 1)) + (255,)
    lite = tuple(int(v * 255) for v in np.clip(c * 1.08, 0, 1)) + (255,)
    trunk = (110, 88, 66, 255)
    r = np.random.default_rng(seed)
    if shape == "tree":
        d.rectangle([W * 0.45, H * 0.55, W * 0.55, H], fill=trunk)
        for k, (cy, rad, col) in enumerate(((0.45, 0.42, dark), (0.36, 0.34, lite), (0.24, 0.22, dark))):
            rr = rad * min(W, H * 1.1)
            d.ellipse([W / 2 - rr * (1.1 + 0.1 * r.random()), H * cy - rr, W / 2 + rr, H * cy + rr * 0.9], fill=col)
    elif shape == "peak":
        d.polygon([(0, H), (W * 0.42, H * 0.12), (W * 0.8, H)], fill=dark)
        d.polygon([(W * 0.3, H), (W * 0.7, H * 0.3), (W, H)], fill=lite)
    elif shape == "tuft":
        for k in range(9):
            x = W * (0.15 + 0.7 * k / 8)
            top = H * (0.05 + 0.35 * r.random())
            d.polygon([(x - W * 0.05, H), (x + W * 0.05, H), (x + W * 0.08 * (r.random() - 0.5), top)],
                      fill=dark if k % 2 else lite)
    elif shape == "bush":
        for k in range(4):
            cx, rr = W * (0.22 + 0.56 * k / 3), H * (0.42 + 0.18 * r.random())
            d.ellipse([cx - rr * 0.9, H - rr * 1.6, cx + rr * 0.9, H + rr * 0.2], fill=dark if k % 2 else lite)
        d.rectangle([0, H * 0.94, W, H], fill=(0, 0, 0, 0))
    elif shape == "rock":
        d.ellipse([W * 0.02, H * 0.1, W * 0.7, H * 1.9], fill=dark)
        d.ellipse([W * 0.45, H * 0.4, W * 0.98, H * 1.6], fill=lite)
    else:  # house
        d.rectangle([W * 0.1, H * 0.48, W * 0.9, H], fill=lite)
        d.polygon([(0, H * 0.5), (W, H * 0.5), (W * 0.5, H * 0.08)], fill=dark)
        d.rectangle([W * 0.44, H * 0.7, W * 0.56, H], fill=trunk)
    im = im.resize((w, h), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255.0


FILLER_SHAPE = {"tuft": "tuft", "reeds": "tuft", "bamboo": "tuft", "rock": "rock", "stump": "rock", "log": "rock",
                "mushrooms": "rock"}
FILLER_COLOUR = {"bush": (0.50, 0.62, 0.44), "fern": (0.42, 0.58, 0.42), "tuft": (0.62, 0.70, 0.48),
                 "reeds": (0.74, 0.70, 0.52), "flowers": (0.86, 0.80, 0.70), "rock": (0.62, 0.62, 0.60),
                 "mushrooms": (0.72, 0.60, 0.48), "stump": (0.55, 0.45, 0.36), "log": (0.50, 0.42, 0.34),
                 "deadwood": (0.55, 0.50, 0.44), "thorn": (0.48, 0.52, 0.40), "bamboo": (0.56, 0.68, 0.44),
                 "herbs": (0.56, 0.64, 0.52)}
PIECE_COLOUR = {"dirt": (0.62, 0.55, 0.44), "leaves": (0.66, 0.55, 0.36), "moss": (0.40, 0.52, 0.36),
                "pebbles": (0.66, 0.66, 0.64), "petals": (0.90, 0.78, 0.80), "puddle": (0.56, 0.66, 0.70),
                "roots": (0.48, 0.38, 0.30), "cracks": (0.60, 0.54, 0.44), "needles": (0.52, 0.44, 0.32),
                "grass": (0.42, 0.54, 0.36)}


def placeholder_piece(kind: str, seed: int, size: int = 128) -> np.ndarray:
    """程序画的占位地面散件：不规则的一团，带一圈浅色纸边。"""
    rng = np.random.default_rng(seed)
    yy, xx = (np.mgrid[0:size, 0:size] + 0.5) / size - 0.5
    ang = np.arctan2(yy, xx)
    rad = 0.36 + sum(rng.uniform(0.01, 0.05) * np.sin(k * ang + rng.uniform(0, 6.28)) for k in range(2, 7))
    d = rad - np.hypot(xx, yy)
    a = np.clip(d * size / 1.5, 0, 1)
    c = np.array(PIECE_COLOUR.get(kind, (0.6, 0.6, 0.6)), np.float32)
    rgb = c * (1 + 0.12 * periodic_noise(size, seed % 997, kmax=6)[..., None])
    rgb = np.where((d < 0.02)[..., None], RIM_COLOR, rgb)
    return np.concatenate([np.clip(rgb, 0, 1), a[..., None]], -1).astype(np.float32)


def placeholder_road(w: int = 512, h: int = 128) -> np.ndarray:
    xx = np.arange(w) / w
    top = (0.2 + 0.03 * np.sin(2 * np.pi * 4 * xx)) * h
    bot = (0.8 + 0.03 * np.sin(2 * np.pi * 5 * xx + 1)) * h
    yy = np.arange(h)[:, None] + 0.5
    a = np.clip(yy + 0.5 - top[None], 0, 1) * np.clip(bot[None] - (yy - 0.5), 0, 1)
    rgb = np.ones((h, w, 3), np.float32) * np.array([0.74, 0.64, 0.46], np.float32)
    return np.concatenate([rgb, a[..., None].astype(np.float32)], -1)


def placeholder_edge(w: int = 512, h: int = 128) -> np.ndarray:
    xx = np.arange(w) / w
    line = (0.5 + 0.12 * np.sin(2 * np.pi * 3 * xx + 0.4) + 0.06 * np.sin(2 * np.pi * 11 * xx)) * h
    yy = np.arange(h)[:, None] + 0.5
    return np.clip(line[None] - (yy - 0.5), 0, 1).astype(np.float32)


def load_assets(items: list[dict], terrains: list[str], src: Path, ground_src: Path, use_real: bool) -> Assets:
    A = Assets()
    for t in terrains + ["settlement"]:
        key = f"terrain.ground.{t}"
        p = al.find_image(ground_src, key) if use_real else None
        if p:
            img = al.load_rgba(p)[..., :3]
            if img.shape[0] != img.shape[1]:
                n = min(img.shape[:2]); img = img[:n, :n]
            A.ground[t] = img
            A.real.append(key)
        else:
            A.ground[t] = placeholder_ground(t)
            A.fake.append(key)
    for it in items:
        if it.get("kind") == "flat":
            key = it["artKey"]
            p = al.find_image(src, key) if use_real else None
            if p:
                A.piece[key] = al.load_rgba(p); A.real.append(key)
            else:
                A.piece[key] = placeholder_piece(key.split(".")[-1], h32(len(key), sum(map(ord, key))))
                A.fake.append(key)
            continue
        if it.get("kind") != "standee" or it.get("section") == "G":
            continue
        key = it["artKey"]
        p = al.find_image(src, key) if use_real else None
        if p:
            img = al.load_rgba(p)
            box = al.trim_box(img[..., 3])
            if box:
                A.standee[key] = img[box[1]:box[3], box[0]:box[2]]
                A.real.append(key)
                continue
        if it.get("section") == "H":
            base = key.split(".")[1]
            shape, col = FILLER_SHAPE.get(base, "bush"), FILLER_COLOUR.get(base, (0.55, 0.62, 0.48))
        else:
            shape = SHAPE.get(it.get("terrain", ""), "house")
            col = PALETTE.get(it.get("terrain", ""), (0.74, 0.68, 0.60))
        A.standee[key] = placeholder_standee(shape, col, float(it.get("aspect", 1.0)), h32(len(key), sum(map(ord, key))))
        A.fake.append(key)
    road = None
    if use_real:
        p = al.find_image(src, "region.road")
        if p:
            road = al.load_rgba(p)
        else:
            p = al.find_image(ground_src, "region.road")
            if p:
                import key_alpha
                road = key_alpha.process(al.load_rgba(p), al.rel(p), al.Report(), strip=True)
    if road is not None:
        A.road = road; A.real.append("region.road")
    else:
        A.road = placeholder_road(); A.fake.append("region.road")
    p = al.find_image(ground_src, "region.edge") if use_real else None
    if p:
        g = al.luminance(al.load_rgba(p)[..., :3])
        lo, hi = np.percentile(g, 1), np.percentile(g, 99)
        A.edge = np.clip((g - lo) / max(hi - lo, 1e-3), 0, 1).astype(np.float32)
        A.real.append("region.edge")
    else:
        A.edge = placeholder_edge(); A.fake.append("region.edge")
    return A


# ── 场景 ────────────────────────────────────────────────────────────────────

@dataclass
class Card:
    key: str
    x: float
    z: float
    height: float
    order: int = 0           # 同 z 时的次序


def warp(x, z, seed: int):
    """交界扭曲：返回 (dx, dz)。与工单 §3.2.3 的 gWarp 同一公式；相位由地区种子定。"""
    ph = [2 * math.pi * hf(seed, 900 + k) for k in range(4)]
    (a0, k0, c0), (a1, k1, c1) = WARP_WAVES
    dx = WARP_AMP * (a0 * np.sin(k0 * z + c0 * x + ph[0]) + a1 * np.sin(k1 * z + c1 * x + ph[1]))
    dz = WARP_AMP * (a0 * np.sin(k0 * x - c0 * z + ph[2]) + a1 * np.sin(k1 * x - c1 * z + ph[3]))
    return dx, dz


def owner(terrain: dict, x: float, z: float, seed: int) -> str | None:
    """地面上一点 (x, z) 实际属于哪种地形（扭曲后的格；落到地区外则按原格）。"""
    dx, dz = warp(x, z, seed)
    t = terrain.get((math.floor(x + dx), math.floor(z + dz)))
    return t if t is not None else terrain.get((math.floor(x), math.floor(z)))


@dataclass
class Scene:
    x0: int
    z0: int
    nx: int
    nz: int
    terrain: dict[tuple[int, int], str]
    cards: list[Card]
    road: list[tuple[int, int]]         # 依次经过的格
    pieces: list[tuple[str, float, float, float, float]] = field(default_factory=list)   # (artKey, x, z, 边长, 转角)
    _bucket: dict | None = None
    _grid: tuple | None = None

    def grid(self) -> tuple[list[str], np.ndarray]:
        """地形编号网格（-1 = 地区外），供逐像素查邻格。"""
        if self._grid is None:
            names = sorted(set(self.terrain.values()))
            g = np.full((self.nx + 2, self.nz + 2), -1, np.int32)
            for (i, j), t in self.terrain.items():
                if 0 <= i - self.x0 + 1 < self.nx + 2 and 0 <= j - self.z0 + 1 < self.nz + 2:
                    g[i - self.x0 + 1, j - self.z0 + 1] = names.index(t)
            self._grid = (names, g)
        return self._grid

    def ids(self, ci: np.ndarray, cj: np.ndarray) -> np.ndarray:
        names, g = self.grid()
        a = np.clip(ci - self.x0 + 1, 0, self.nx + 1)
        b = np.clip(cj - self.z0 + 1, 0, self.nz + 1)
        return g[a, b]

    def bucket(self) -> dict[tuple[int, int], list[Card]]:
        """按所在格分桶的立牌（算落影时只看附近的）。"""
        if self._bucket is None:
            self._bucket = {}
            for c in self.cards:
                self._bucket.setdefault((math.floor(c.x), math.floor(c.z)), []).append(c)
        return self._bucket


# 格内槽位（x 向右、z 向镜头为正），按从后到前排列；与工单 §3.6 同一套
SLOTS = {
    0: [],
    1: [(0.0, -0.05)],
    2: [(-0.2, -0.15), (0.2, 0.2)],
    3: [(-0.24, -0.24), (0.22, -0.2), (0.02, 0.22)],
    4: [(-0.26, -0.26), (0.22, -0.24), (-0.22, 0.2), (0.26, 0.24)],
    5: [(-0.26, -0.28), (0.22, -0.26), (-0.02, -0.02), (-0.24, 0.24), (0.26, 0.22)],
    6: [(-0.3, -0.3), (0.02, -0.26), (0.3, -0.28), (-0.28, 0.18), (0.04, 0.24), (0.3, 0.16)],
    7: [(-0.3, -0.3), (0.02, -0.28), (0.3, -0.26), (-0.14, -0.02), (0.18, 0.0), (-0.3, 0.26), (0.28, 0.26)],
}

# 一格张数多时整体缩小，避免一格挤成一堵墙（工单 §3.6）
CROWD_SCALE = (1.0, 1.0, 1.0, 0.95, 0.92, 0.88, 0.85, 0.82)


def slot_layout(n: int) -> list[tuple[float, float]]:
    return list(SLOTS[min(max(n, 0), 7)])


def build_scene(items: list[dict], assets: Assets, cam: Camera, terrains: list[str], seed: int,
                settlements: int = 2, roads: bool = True, region: int | None = None) -> Scene:
    # 可见范围：屏幕四角落到地面，再外扩（远侧多留 2 行给高立牌）
    pts = [cam.ground_at(x, y) for x, y in ((0, 0), (cam.w, 0), (0, cam.h), (cam.w, cam.h))]
    xs, zs = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1 = math.floor(min(xs)) - 1, math.ceil(max(xs)) + 1
    z0, z1 = math.floor(min(zs)) - 3, math.ceil(max(zs)) + 1
    nx, nz = x1 - x0, z1 - z0

    # 地形：抖动网格上的种子点，最近者决定地形（成片）
    seeds = []
    for gx in range(x0 - 4, x1 + 4, 3):
        for gz in range(z0 - 4, z1 + 4, 3):
            seeds.append((gx + 3 * hf(seed, gx, gz, 1), gz + 3 * hf(seed, gx, gz, 2),
                          terrains[h32(seed, gx, gz, 3) % len(terrains)]))
    sp = np.array([(a, b) for a, b, _ in seeds])
    terrain: dict[tuple[int, int], str] = {}
    for i in range(x0, x1):
        for j in range(z0, z1):
            d = np.hypot(sp[:, 0] - (i + 0.5), sp[:, 1] - (j + 0.5))
            d += np.random.default_rng(h32(seed, i, j, 4)).random(len(d)) * 1.2     # 边界不规则些
            terrain[(i, j)] = seeds[int(np.argmin(d))][2]

    by_terrain: dict[str, list[dict]] = {}
    density = {it["terrain"]: tuple(it.get("density", (1, 2))) for it in items if it.get("kind") == "ground"}
    for it in items:
        if it.get("section") == "B":
            by_terrain.setdefault(it["terrain"], []).append(it)
    item_of = {it["artKey"]: it for it in items}

    # 聚居点：注视格放村庄，其余在 4–6 格外
    locs: list[tuple[int, int, str]] = [(0, 0, "village")]
    kinds = ["town", "city", "fort", "sectSeat"]
    for k in range(1, settlements):
        ang = 2 * math.pi * hf(seed, k, 7)
        r = 2.5 + 1.5 * hf(seed, k, 8)
        ci, cj = int(round(r * math.cos(ang))), int(round(r * math.sin(ang) * 0.6))
        ci = min(max(ci, x0 + 2), x1 - 3); cj = min(max(cj, z0 + 3), z1 - 2)
        locs.append((ci, cj, kinds[(k - 1) % len(kinds)]))
    loc_cells = {(i, j): kind for i, j, kind in locs}
    for (i, j) in loc_cells:
        terrain[(i, j)] = "settlement"
    if region:                                     # 只保留 N×N 的地区，注视格 (0, 0) 在中间
        lo_ = -(region // 2)
        terrain = {k: v for k, v in terrain.items() if lo_ <= k[0] < lo_ + region and lo_ <= k[1] < lo_ + region}
        loc_cells = {k: v for k, v in loc_cells.items() if k in terrain}
        locs = [l for l in locs if (l[0], l[1]) in terrain]

    def has_real(keys: list[str]) -> list[str]:
        real = [k for k in keys if k in assets.real]
        return real or keys

    cards: list[Card] = []
    for (i, j), kind in loc_cells.items():
        cands = [it["artKey"] for it in items if it.get("locKind") == kind]
        cands = has_real(cands)
        main = cands[h32(seed, i, j, 11) % len(cands)]
        cards.append(Card(main, i + 0.5, j + 0.5 - 0.2, item_of[main]["height"], 1))
        pool = [f"loc.prop.{p}" for p in LOC_POOL[kind]]
        pool = [k for k in pool if k in assets.real] or ([] if assets.real else pool)
        n = h32(seed, i, j, 12) % 3 if pool else 0
        for s, (ox, oz) in enumerate(((-0.38, 0.25), (0.36, 0.27))[:n]):
            pk = pool[h32(seed, i, j, 13 + s) % len(pool)]
            cards.append(Card(pk, i + 0.5 + ox, j + 0.5 + oz, item_of[pk]["height"], 2))

    for (i, j), t in terrain.items():
        if t == "settlement" or t not in by_terrain:
            continue
        near = [(a - i, b - j) for (a, b) in loc_cells if max(abs(i - a), abs(j - b)) == 1]   # 指向聚居点
        lo, hi = density.get(t, (1, 2))
        n = lo + h32(seed, i, j, 21) % (hi - lo + 1)
        slots = slot_layout(n)
        if near:                                   # 邻格让位：去掉朝向聚居点一侧的槽位
            di, dj = near[0]
            slots = [(ox, oz) for ox, oz in SLOTS[n] if ox * di + oz * dj <= 0.05] if n > 1 else []
            slots = slots[:max(1, n - 1)] or [(-di * 0.2, -0.05 - dj * 0.2)]
            n = len(slots)
        if n == 0:
            continue
        keys = has_real([it["artKey"] for it in by_terrain[t]])
        picks = [keys[(h32(seed, i, j, 22) + k) % len(keys)] for k in range(n)]
        picks.sort(key=lambda k: -item_of[k]["height"])            # 高的放后排（槽位按从后到前排好）
        for k, ((ox, oz), key) in enumerate(zip(slots, picks)):
            jx, jz = (hf(seed, i, j, 30 + k) - 0.5) * 0.12, (hf(seed, i, j, 40 + k) - 0.5) * 0.12
            sc = (0.92 + 0.16 * hf(seed, i, j, 50 + k)) * CROWD_SCALE[n]
            ox, oz = ox + jx, oz + jz
            for _ in range(3):                     # 交界弯进本格时，牌脚落在别的地形上 → 向格心收
                if owner(terrain, i + 0.5 + ox, j + 0.5 + oz, seed) == t:
                    break
                ox, oz = ox * 0.6, oz * 0.6
            cards.append(Card(key, i + 0.5 + ox, j + 0.5 + oz, item_of[key]["height"] * sc))

    # 第二、三层：填充小件（低矮立牌）与地面散件（平贴），按地形的池子撒（工单 §3.6）
    pools = {it["terrain"]: it.get("fillers") for it in items if it.get("kind") == "ground"}
    water = {it["terrain"] for it in items if it.get("kind") == "ground" and it.get("water")}
    shore = next((it["shore"] for it in items if it.get("kind") == "ground" and it.get("shore")), None)

    def near_water(x: float, z: float, band: float) -> bool:
        return any(owner(terrain, x + ax * band, z + az * band, seed) in water
                   for ax, az in ((1, 0), (-1, 0), (0, 1), (0, -1), (0.7, 0.7), (-0.7, 0.7), (0.7, -0.7), (-0.7, -0.7)))

    def near_land(x: float, z: float, band: float) -> bool:
        return any(owner(terrain, x + ax * band, z + az * band, seed) not in water
                   for ax, az in ((1, 0), (-1, 0), (0, 1), (0, -1), (0.7, 0.7), (-0.7, 0.7), (0.7, -0.7), (-0.7, -0.7)))
    bases: dict[tuple[int, int], list[tuple[float, float]]] = {}
    for c in cards:
        bases.setdefault((math.floor(c.x), math.floor(c.z)), []).append((c.x, c.z))
    pieces: list[tuple[str, float, float, float, float]] = []
    for (i, j), t in terrain.items():
        pool = pools.get(t)
        if not pool:
            continue
        taken = bases.setdefault((i, j), [])
        if pool["fillers"]:
            lo, hi = pool["fillerCount"]
            n = lo + h32(seed, i, j, 70) % (hi - lo + 1)
            keys = has_real(pool["fillers"])
            for k in range(n):
                for tries in range(24):
                    x = i + 0.5 + (hf(seed, i, j, 71, k, tries) - 0.5) * 0.86
                    z = j + 0.5 + (hf(seed, i, j, 72, k, tries) - 0.5) * 0.86
                    if owner(terrain, x, z, seed) != t:
                        continue
                    if t in water and not near_land(x, z, shore["band"] if shore else 0.12):
                        continue                   # 水面上的芦苇、石块只长在岸边浅水里，湖心是开阔水面
                    if all((x - a) ** 2 + (z - b) ** 2 > 0.13 ** 2 for a, b in taken):
                        key = keys[h32(seed, i, j, 73, k) % len(keys)]
                        sc = 0.85 + 0.3 * hf(seed, i, j, 74, k)
                        cards.append(Card(key, x, z, item_of[key]["height"] * sc, 0))
                        taken.append((x, z))
                        break
        if shore and t not in water and t != "settlement":
            # 岸边件：陆地一侧沿弯曲的岸线补几株芦苇、石块、草簇（工单 §3.6）
            lo, hi = shore["count"]
            n = lo + h32(seed, i, j, 90) % (hi - lo + 1)
            keys = has_real(shore["fillers"])
            placed = 0
            for tries in range(40):
                if placed >= n:
                    break
                x = i + 0.5 + (hf(seed, i, j, 91, tries) - 0.5) * 0.96
                z = j + 0.5 + (hf(seed, i, j, 92, tries) - 0.5) * 0.96
                if owner(terrain, x, z, seed) != t or not near_water(x, z, shore["band"]):
                    continue
                if all((x - a) ** 2 + (z - b) ** 2 > 0.11 ** 2 for a, b in taken):
                    key = keys[h32(seed, i, j, 93, tries) % len(keys)]
                    cards.append(Card(key, x, z, item_of[key]["height"] * (0.8 + 0.3 * hf(seed, i, j, 94, tries)), 0))
                    taken.append((x, z))
                    placed += 1
        if pool["pieces"]:
            lo, hi = pool["pieceCount"]
            n = lo + h32(seed, i, j, 80) % (hi - lo + 1)
            keys = has_real(pool["pieces"])
            for k in range(n):
                key = keys[h32(seed, i, j, 81, k) % len(keys)]
                size = item_of[key]["height"] * (0.8 + 0.4 * hf(seed, i, j, 82, k))
                m = 0.5 - size * 0.35
                pieces.append((key, i + 0.5 + (hf(seed, i, j, 83, k) - 0.5) * 2 * m,
                               j + 0.5 + (hf(seed, i, j, 84, k) - 0.5) * 2 * m, size, 2 * math.pi * hf(seed, i, j, 85, k)))

    road: list[tuple[int, int]] = []
    if roads and len(locs) > 1:
        sx = min(k[0] for k in terrain)
        path = [(sx, 0)]
        for (ai, aj, _), (bi, bj, _) in zip([(sx, 0, "")] + locs[:-1], locs):
            ci, cj = ai, aj
            while (ci, cj) != (bi, bj):
                if ci != bi and (cj == bj or hf(seed, ci, cj, 60) < 0.6):
                    ci += 1 if bi > ci else -1
                else:
                    cj += 1 if bj > cj else -1
                path.append((ci, cj))
        road = path
    return Scene(x0, z0, nx, nz, terrain, cards, road, pieces)


# ── 地面 ────────────────────────────────────────────────────────────────────

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


class GroundCache:
    def __init__(self, assets: Assets) -> None:
        self.assets = assets
        self.cache: dict[tuple[str, int], np.ndarray] = {}

    def get(self, terrain: str, res: int) -> np.ndarray:
        """该地形底纸缩到 2·res（一张覆盖 2×2 格）。"""
        k = (terrain, res)
        if k not in self.cache:
            img = self.assets.ground.get(terrain, placeholder_ground(terrain))
            gp = self.assets.ground_px
            if gp and img.shape[0] > gp:            # 先缩到入库尺寸，再按屏幕需要采样——近档的软硬与游戏里一致
                img = al.resize_tile(img, gp, gp)
            self.cache[k] = np.clip(al.resize_tile(img, 2 * res, 2 * res)[..., :3], 0, 1).astype(np.float32)
        return self.cache[k]


# 朝向码 → 2×2 矩阵（与工单 §3.2.3 的 gOrient 一致）：bit0 镜像，bit1–2 旋转
_ROT = [((1, 0), (0, 1)), ((0, -1), (1, 0)), ((-1, 0), (0, -1)), ((0, 1), (-1, 0))]


def sample_cell(scene: Scene, a: int, b: int, fu: np.ndarray, fv: np.ndarray, res: int, gc: GroundCache,
                no_rotate: set[str], seed: int) -> np.ndarray:
    """格 (a, b) 的底纸在格内坐标 (fu, fv) 处的颜色；坐标可以略出 [0, 1]——底纸可平铺，出界处与格内连续。"""
    t = scene.terrain[(a, b)]
    rnd = h32(seed, a, b, 99) & 0xFF
    src = gc.get(t, res)
    rot = (rnd >> 1) & 3
    if t in no_rotate:
        rot &= 2
    px, pz = fu - 0.5, fv - 0.5
    if rnd & 1:
        px = -px
    (m00, m01), (m10, m11) = _ROT[rot]
    u = m00 * px + m01 * pz + 0.5 + ((rnd >> 3) & 1)
    v = m10 * px + m11 * pz + 0.5 + ((rnd >> 4) & 1)
    n = 2 * res
    col = src[(np.floor(v * res).astype(int)) % n, (np.floor(u * res).astype(int)) % n]
    return col * (0.96 + 0.08 * (rnd >> 5) / 7)


def cell_tile(scene: Scene, i: int, j: int, res: int, gc: GroundCache, items_of: dict, assets: Assets,
              shadow_dir: tuple[float, float], no_rotate: set[str], seed: int, water: frozenset = frozenset()) -> np.ndarray:
    t = scene.terrain[(i, j)]
    names, _ = scene.grid()
    own = names.index(t)
    v, u = (np.mgrid[0:res, 0:res] + 0.5) / res          # u → +x，v → +z（近处）
    gx, gz = i + u, j + v

    # 交界扭曲：扭曲后的坐标决定「这一点属于哪一格」；扭到地区外的点按原格处理
    dx, dz = warp(gx, gz, seed)
    wx, wz = gx + dx, gz + dz
    ci, cj = np.floor(wx).astype(int), np.floor(wz).astype(int)
    wid = scene.ids(ci, cj)
    out = wid < 0
    wid = np.where(out, own, wid)
    ci, cj = np.where(out, i, ci), np.where(out, j, cj)
    wx, wz = np.where(out, gx, wx), np.where(out, gz, wz)

    # 底纸：与本格同种 → 用本格的窗口 / 朝向（同种地形之间仍是直的折痕）；异种 → 用扭进来的那一格的，出界续接
    oi, oj = np.where(wid == own, i, ci), np.where(wid == own, j, cj)
    col = np.empty((res, res, 3), np.float32)
    for a_, b_ in {(int(x), int(y)) for x, y in zip(oi.ravel(), oj.ravel())}:
        m = (oi == a_) & (oj == b_)
        col[m] = sample_cell(scene, a_, b_, gx[m] - a_, gz[m] - b_, res, gc, no_rotate, seed)

    # 地面散件（平贴，随机转角；印在底纸上、纸缝之下）
    for key, px, pz, size, ang in scene.pieces:
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

    # 撕边、接触阴影、浅水带：在扭曲坐标里算（交界是弯的）；同种地形的折痕：在原坐标里算（格线是直的）
    paper = np.ones((res, res), np.float32)      # 0 = 撕口（露出下层，颜色压暗）
    crease = np.ones((res, res), np.float32)     # 0 = 同种地形之间的折痕
    lip = np.zeros_like(paper)
    shade = np.zeros_like(paper)
    shallow = np.zeros_like(paper)
    edge = assets.edge
    eh, ew = edge.shape
    stack = np.array([STACK.get(n, 60) for n in names])
    is_water = np.array([n in water for n in names])
    fu, fv = wx - ci, wz - cj
    lx, lz = shadow_dir
    for k, (di, dj) in enumerate(((-1, 0), (1, 0), (0, -1), (0, 1))):
        d = (fu, 1 - fu, fv, 1 - fv)[k]
        along = wz if di else wx
        nid = scene.ids(ci + di, cj + dj)
        nid = np.where(nid < 0, wid, nid)
        diff = nid != wid
        if diff.any():
            phase = k * 0.37 + wid * 0.13
            uu = ((along * 2.5 + phase) % 1.0) * (ew - 1)
            vv = np.clip(d / (2 * TEAR), 0, 1)
            m = edge[((1 - vv) * (eh - 1)).astype(int), uu.astype(int)]
            paper = np.where(diff, np.minimum(paper, smoothstep(0.42, 0.58, m)), paper)
            lip = np.where(diff, np.maximum(lip, 1 - smoothstep(0.58, 0.80, m)), lip)
            # 光从哪边来，哪边的高邻投下的影子更实：邻格方向与光的水平来向同向则满强度
            w = 1.0 if -(di * lx + dj * lz) > 0 else SHADE_BACK
            hi = diff & (stack[nid] > stack[wid])
            shade = np.where(hi, np.maximum(shade, (1 - smoothstep(0, SHADE_W, d - TEAR)) * w), shade)
            sh = diff & is_water[wid] & ~is_water[nid]
            shallow = np.where(sh, np.maximum(shallow, 1 - smoothstep(TEAR, TEAR + SHALLOW_W, d)), shallow)
        # 折痕：原坐标的这一侧，邻格与本格同种、且这一点确实属于本格
        nt = scene.terrain.get((i + di, j + dj), t)
        if nt == t:
            dd = (u, 1 - u, v, 1 - v)[k]
            crease = np.where(wid == own, np.minimum(crease, smoothstep(0, SEAM, dd)), crease)
    col = col + (SHALLOW_COLOR - col) * (shallow * SHALLOW_K)[..., None]
    col = col * (1 - lip[..., None] * 0.55) + RIM_COLOR * lip[..., None] * 0.55
    col *= (1 - shade * SHADE_K)[..., None]

    # 道路（纸带横跨纸缝，画在缝之上）
    rgba = np.concatenate([col, np.ones((res, res, 1), np.float32)], -1)
    img = Image.fromarray(al.to_u8(rgba), "RGBA")
    if scene.road:
        draw_road(img, scene, i, j, res, assets)
    col = np.asarray(img, np.float32)[..., :3] / 255.0
    col = col * (1 - (1 - paper[..., None]) * TEAR_DARK) * (1 - (1 - crease[..., None]) * CREASE_DARK)
    # 道路盖在缝上：重新按道路 alpha 覆盖一次
    if scene.road:
        rimg = Image.new("RGBA", (res, res), (0, 0, 0, 0))
        draw_road(rimg, scene, i, j, res, assets)
        ra = np.asarray(rimg, np.float32) / 255.0
        col = col * (1 - ra[..., 3:]) + ra[..., :3] * ra[..., 3:]

    # 立牌落影
    sh = np.zeros((res, res), np.float32)
    near = [c for a in range(i - 2, i + 3) for b in range(j - 2, j + 3) for c in scene.bucket().get((a, b), ())]
    for c in near:
        if abs(c.x - (i + 0.5)) > 2.2 or abs(c.z - (j + 0.5)) > 2.2:
            continue
        a = assets.standee[c.key]
        H, W = a.shape[:2]
        h = c.height
        w = h * W / H
        if abs(lz) < 1e-3:
            continue
        # 牌上一点 (lx', ly) 落到地面 (x + lx' + ly·lx, z + ly·lz)；反解得仿射
        kx, ky = W / w, H / h
        coeffs = (kx / res, -kx * lx / lz / res, kx * (i - c.x + w / 2 - lx * (j - c.z) / lz),
                  0.0, -ky / lz / res, H - ky * (j - c.z) / lz)
        al_img = Image.fromarray(al.to_u8(a[..., 3]), "L")
        s = al_img.transform((res, res), Image.AFFINE, coeffs, Image.BILINEAR)
        sh = np.maximum(sh, np.asarray(s, np.float32) / 255.0)
    if sh.any():
        sh = np.asarray(Image.fromarray(al.to_u8(sh), "L").filter(ImageFilter.GaussianBlur(res * 0.02)),
                        np.float32) / 255.0
        col *= (1 - 0.38 * sh)[..., None]
    return col


def draw_road(img: Image.Image, scene: Scene, i: int, j: int, res: int, assets: Assets) -> None:
    road = assets.road
    rh, rw = road.shape[:2]
    strip = Image.fromarray(al.to_u8(np.tile(road, (1, 4, 1))), "RGBA")      # 4 个周期，够一段用
    seg_len = 0.0
    pts = scene.road
    for a, b in zip(pts[:-1], pts[1:]):
        ax, az = a[0] + 0.5, a[1] + 0.5
        bx, bz = b[0] + 0.5, b[1] + 0.5
        if min(ax, bx) - 0.6 > i + 1 or max(ax, bx) + 0.6 < i or min(az, bz) - 0.6 > j + 1 or max(az, bz) + 0.6 < j:
            seg_len += 1.0
            continue
        dx, dz = bx - ax, bz - az
        nx, nz = -dz, dx
        u0 = (seg_len % ROAD_PERIOD) / ROAD_PERIOD * rw
        ext = ROAD_W / 2                                                  # 两端各延伸半个路宽，拐角不留缺口
        # 瓦片像素 (p, q) → 世界 (i + p/res, j + q/res) → 沿路 s、横向 r → 纸带像素
        # s = (X−A)·d + ext，r = (X−A)·n + W/2；纸带 x = u0 + s / period · rw，y = r / W · rh
        sx_ = rw / ROAD_PERIOD
        sy_ = rh / ROAD_W
        coeffs = (dx * sx_ / res, dz * sx_ / res, u0 + sx_ * ((i - ax) * dx + (j - az) * dz + ext),
                  nx * sy_ / res, nz * sy_ / res, sy_ * ((i - ax) * nx + (j - az) * nz + ROAD_W / 2))
        seg = strip.transform((res, res), Image.AFFINE, coeffs, Image.BILINEAR)
        # 只保留这一段的长度范围
        q, p = (np.mgrid[0:res, 0:res] + 0.5) / res
        s = (i + p - ax) * dx + (j + q - az) * dz
        keep = ((s >= -ext) & (s <= 1 + ext)).astype(np.float32)
        arr = np.asarray(seg, np.float32)
        arr[..., 3] *= keep
        img.alpha_composite(Image.fromarray(arr.astype(np.uint8), "RGBA"))
        seg_len += 1.0


# ── 渲染 ────────────────────────────────────────────────────────────────────

def standee_image(a: np.ndarray) -> Image.Image:
    """加 WO1 的模切白边（alpha 在 0.5–0.82 的那一圈向纸芯色提亮），再转成预乘以便透视采样。"""
    rim = (1 - smoothstep(0.5, 0.82, a[..., 3])) * 0.85 * (a[..., 3] > 0.02)
    rgb = a[..., :3] * (1 - rim[..., None]) + RIM_COLOR * rim[..., None]
    return Image.fromarray(al.to_u8(np.concatenate([rgb, a[..., 3:]], -1)), "RGBA")


def render(scene: Scene, cam: Camera, assets: Assets, items: list[dict], seed: int,
           shadow_dir: tuple[float, float], sight: int | None = None) -> Image.Image:
    """sight：视野半径（切比雪夫距离，以注视格 (0, 0) 为中心）；视野外的格子与立牌画成灰的。"""
    canvas = Image.new("RGBA", (cam.w, cam.h), PAGE_COLOR + (255,))

    def outside(i: int, j: int) -> bool:
        return sight is not None and max(abs(i), abs(j)) > sight
    gc = GroundCache(assets)
    no_rotate = {it["terrain"] for it in items if it.get("kind") == "ground" and it.get("noRotate")}
    water = frozenset(it["terrain"] for it in items if it.get("kind") == "ground" and it.get("water"))
    items_of = {it["artKey"]: it for it in items}
    for j in range(scene.z0, scene.z0 + scene.nz):
        for i in range(scene.x0, scene.x0 + scene.nx):
            quad = cam.project([(i, 0, j), (i + 1, 0, j), (i + 1, 0, j + 1), (i, 0, j + 1)])
            if (i, j) not in scene.terrain:
                continue
            if quad[:, 0].max() < 0 or quad[:, 0].min() > cam.w or quad[:, 1].max() < 0 or quad[:, 1].min() > cam.h:
                continue
            side = float(max(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[3] - quad[0])))
            res = int(min(768, max(16, math.ceil(side * 1.25 / 16) * 16)))
            col = cell_tile(scene, i, j, res, gc, items_of, assets, shadow_dir, no_rotate, seed, water)
            if outside(i, j):
                col = grey(col)
            tile = Image.fromarray(al.to_u8(np.concatenate([col, np.ones((res, res, 1), np.float32)], -1)), "RGBA")
            warp_into(canvas, tile, quad)
    for c in sorted(scene.cards, key=lambda c: (c.z, c.order, c.x)):
        a = assets.standee[c.key]
        H, W = a.shape[:2]
        w = c.height * W / H
        quad = cam.project([(c.x - w / 2, c.height, c.z), (c.x + w / 2, c.height, c.z),
                            (c.x + w / 2, 0, c.z), (c.x - w / 2, 0, c.z)])
        img = standee_image(a)
        if outside(math.floor(c.x), math.floor(c.z)):
            arr = np.asarray(img, np.float32) / 255.0
            arr[..., :3] = grey(arr)
            img = Image.fromarray(al.to_u8(arr), "RGBA")
        warp_into(canvas, img, quad)
    return canvas


SHADOWS = {"lowerRight": (0.55, 0.40), "warmDay": (5 / 8, -3 / 8)}


def make_preview(items: list[dict], *, cols: float, seed: int, size=(1920, 1080), ortho: bool = False, ss: int = 2,
                 terrains: list[str] | None = None, settlements: int = 2, roads: bool = True,
                 src: Path = al.WORK_DIR, ground_src: Path = al.RAW_DIR, use_real: bool = True,
                 shadow: str = "lowerRight", sight: int | None = None, region: int | None = None,
                 pawn: bool = True, ground_px: int | None = GROUND_PX) -> tuple[Image.Image, Assets, Camera]:
    terrains = terrains or list(NATURAL)
    assets = load_assets(items, terrains, src, ground_src, use_real)
    assets.ground_px = ground_px
    W, H = size
    cam = Camera(W * ss, H * ss, cols, ortho=ortho)
    scene = build_scene(items, assets, cam, terrains, seed, settlements, roads, region)
    if pawn:                                       # 棋子（占位），站在注视格前半格，给尺度参照
        assets.standee["pawn"] = placeholder_pawn()
        scene.cards.append(Card("pawn", 0.5, 0.62, 0.3, 3))
    img = render(scene, cam, assets, items, seed, SHADOWS[shadow], sight)
    if ss > 1:
        img = img.resize((W, H), Image.LANCZOS)
    return img.convert("RGB"), assets, Camera(W, H, cols, ortho=ortho)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--zoom", choices=("near", "mid", "far"),
                    help="缩放档：near = 3 格横宽（棋子周围 3×3，配 --sight 1）、mid = 6、far = 整张地区缩略（需 --region）；给出时覆盖 --cols")
    ap.add_argument("--sight", type=int, help="视野半径（格，切比雪夫距离）：之外的格子与立牌画成灰的；默认不灰")
    ap.add_argument("--region", type=int, help="只画 N×N 的地区（棋子在中间），之外是书页空白；默认无边界")
    ap.add_argument("--no-pawn", action="store_true", help="不画占位棋子")
    ap.add_argument("--cols", type=float, default=7.5, help="注视行横向可见的格数（默认 7.5）；常用 --zoom 代替")
    ap.add_argument("--seed", type=int, default=1, help="地形与立牌随机分布的种子（默认 1）")
    ap.add_argument("--size", default="1920x1080", help="输出尺寸（默认 1920x1080）")
    ap.add_argument("--ortho", action="store_true", help="正交近似：纵深 ×0.8、立牌高 ×0.6，无近大远小")
    ap.add_argument("--ss", type=int, default=2, help="超采样倍数，抗锯齿用（默认 2）")
    ap.add_argument("--terrains", help="只用这些地形，逗号分隔（如 plain,mountain,woods）；默认 17 种全用")
    ap.add_argument("--settlements", type=int, default=2, help="聚居点个数（默认 2：注视格一个村庄 + 附近一个）")
    ap.add_argument("--no-road", action="store_true", help="不画道路")
    ap.add_argument("--shadow", choices=tuple(SHADOWS), default="lowerRight",
                    help="落影方向：lowerRight 屏幕右下（默认）；warmDay 按 WO1 key 光 (-5,8,3)")
    ap.add_argument("--ground-px", type=int, default=GROUND_PX,
                    help=f"底纸入库边长，一张覆盖 2×2 格（默认 {GROUND_PX} = medium 档；1024 = high 档；试点时两种对比）")
    ap.add_argument("--list", type=Path, default=al.DEFAULT_LIST, help="素材清单（默认 tools/art/region-assets.json）")
    ap.add_argument("--src", type=Path, default=al.WORK_DIR, help="处理过的立牌 / 道路目录（默认 art/region/work）")
    ap.add_argument("--ground-src", type=Path, default=al.RAW_DIR, help="底纸、撕纸遮罩等原图目录（默认 art/region/raw）")
    ap.add_argument("--placeholders", action="store_true", help="不读真实素材，全部用程序画的占位图")
    ap.add_argument("--out", type=Path, help="输出 PNG（默认 art/region/review/preview-c<cols>-s<seed>[-ortho].png）")
    args = ap.parse_args(argv)

    w, h = (int(v) for v in args.size.lower().split("x"))
    terrains = [t.strip() for t in args.terrains.split(",")] if args.terrains else None
    bad = [t for t in terrains or [] if t not in NATURAL]
    if bad:
        print(f"未知地形：{bad}；可选 {', '.join(NATURAL)}", file=sys.stderr)
        return 2
    if args.zoom == "far" and not args.region:
        print("--zoom far 需要 --region N（整张地区的格数）", file=sys.stderr)
        return 2
    if args.zoom:
        # far：整张 N×N 地区装进画面。53° 俯角下 16:9 画面的纵深约为横宽格数的 0.72，纵向先装满
        args.cols = ZOOMS.get(args.zoom) or round((args.region + 1.5) / 0.72 * 2) / 2
    img, assets, cam = make_preview(al.load_list(args.list), cols=args.cols, seed=args.seed, size=(w, h),
                                    ortho=args.ortho, ss=max(1, args.ss), terrains=terrains,
                                    settlements=args.settlements, roads=not args.no_road, src=args.src,
                                    ground_src=args.ground_src, use_real=not args.placeholders, shadow=args.shadow,
                                    sight=args.sight, region=args.region, pawn=not args.no_pawn,
                                    ground_px=args.ground_px)
    out = args.out or (al.ROOT / "art" / "region" / "review" /
                       f"preview-{args.zoom or 'c%g' % args.cols}-s{args.seed}{'-ortho' if args.ortho else ''}"
                       f"{'' if args.ground_px == GROUND_PX else '-g%d' % args.ground_px}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"已写入 {al.rel(out)}（{w}×{h}，{'正交' if args.ortho else '透视'}，注视行约 {w / args.cols:.0f}px / 格）")
    used = sorted(set(assets.real))
    print(f"真实素材 {len(used)} 张：{', '.join(used) if used else '无'}；其余用占位图")
    return 0


if __name__ == "__main__":
    sys.exit(main())
