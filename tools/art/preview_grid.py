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
           "mountain": (0.62, 0.56, 0.48), "cave": (0.50, 0.47, 0.44), "stoneForest": (0.76, 0.76, 0.73),
           "hill": (0.66, 0.67, 0.53), "vale": (0.78, 0.70, 0.70), "mulberry": (0.55, 0.60, 0.42),
           "canyon": (0.68, 0.52, 0.45), "marsh": (0.50, 0.53, 0.44), "herbGarden": (0.58, 0.63, 0.55),
           "waste": (0.72, 0.68, 0.56), "abyss": (0.22, 0.22, 0.27), "settlement": (0.70, 0.66, 0.60)}
SHAPE = {"plain": "tuft", "lake": "tuft", "farmland": "tuft", "marsh": "tuft", "herbGarden": "tuft",
         "woods": "tree", "jungle": "tree", "garden": "tree", "vale": "tree", "mulberry": "tree", "hill": "tree",
         "mountain": "peak", "cave": "peak", "stoneForest": "peak", "canyon": "peak", "abyss": "peak", "waste": "peak"}
SEAM_COLOR = np.array([0.30, 0.27, 0.24], np.float32)
PAGE_COLOR = (236, 228, 212)        # 地区之外：书页的空白边
ZOOMS = {"near": 3.0, "mid": 6.0}
GROUND_PX = 768                     # 底纸入库边长的缺省（medium 档 / 开发期）；high 档 1024，试点时用 --ground-px 对比（工单 §7）


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

    def rays(self, px: np.ndarray, py: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """屏幕像素（数组）→ 射线起点 o、方向 d（未归一化；同一像素上的 t 可直接比较远近）。形状 (..., 3)。"""
        nx, ny = px / self.w * 2 - 1, 1 - py / self.h * 2
        if self.ortho:
            o = (self.t + self.right * ((px - self.w / 2) / self.s_ortho)[..., None]
                 + self.up * ((self.h / 2 - py) / self.s_ortho)[..., None])
            d = np.broadcast_to(self.fwd, o.shape)
        else:
            d = (self.fwd + self.right * (nx * self.tanh * self.aspect)[..., None]
                 + self.up * (ny * self.tanh)[..., None])
            o = np.broadcast_to(self.pos, d.shape)
        return o, d

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


def warp_into(canvas: Image.Image, img: Image.Image, quad: np.ndarray, occlude=None) -> None:
    """把 img 的四角 (左上, 右上, 右下, 左下) 透视贴到画布上的 quad（像素坐标），按 alpha 合成。
    occlude(x0, y0, x1, y1) → 该矩形内每像素的可见度 (0–1)，用来让地形纸层挡住立牌的脚。"""
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
    if occlude is not None:
        vis = occlude(cx0, cy0, cx1, cy1)
        if vis is not None:
            arr = np.asarray(out).copy()
            arr[..., 3] = (arr[..., 3] * vis).astype(np.uint8)
            out = Image.fromarray(arr, "RGBA")
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
    house_types: dict[str, list] = field(default_factory=dict)         # houseKind → [(artKey, 高, 宽高比)]（v1.3.1 单栋房屋立牌）
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
    y: float = 0.0           # 底边离地高度（v1.3 地形纸层：= 所在点的层号 × LEVEL_STEP）


@dataclass
class House:
    """一栋房屋立牌（v1.3.1，工单 §3.12）：画好的单栋房子，像别的立牌一样面朝镜头立着；w、h 已乘缩放。"""
    key: str
    kind: str                # houseKind
    x: float
    z: float
    w: float
    h: float
    cell: tuple[int, int]
    y: float = 0.0


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


# ── v1.3 地形纸层（工单 §3.13）──────────────────────────────────────────────
# 一层厚 LEVEL_STEP 格。紧贴别种地形的第一级台阶落在精确交界上（扭曲坐标里的格线）；同种地形内部再往上 / 往下的
# 台阶在本地形里向内缩 LEVEL_INSET（扭曲坐标里把格边平移）。层号按「到本地形区域边缘的格距」广度优先求出。
LEVEL_STEP, LEVEL_INSET = 0.05, 0.07
LEVEL_RULES = {          # 地形: (边缘层, 每深入一格的增量, 封顶)；不在表里的 = 0 层（含丘陵，用户 2026-11-24 定）
    "mountain": (1, 1, 3), "stoneForest": (1, 0, 1), "cave": (1, 0, 1),
    "lake": (-1, 0, -1), "canyon": (-1, 0, -1), "marsh": (-0.5, 0, -0.5), "abyss": (-1, -1, -2),
}
LEVEL_EDGE_GAP = 0.04    # 立牌落点离层边界的最小距离（免得骑在崖边上）


def unwarp(u, v, seed: int, iters: int = 30):
    """warp 的逆：求 (x, z) 使 (x, z) + warp(x, z) = (u, v)。偏导上界约 0.55 < 1，不动点迭代收敛。"""
    u, v = np.asarray(u, np.float64), np.asarray(v, np.float64)
    x, z = u.copy(), v.copy()
    for _ in range(iters):
        dx, dz = warp(x, z, seed)
        x, z = u - dx, v - dz
    return x, z


def cell_levels(terrain: dict[tuple[int, int], str], rules: dict = LEVEL_RULES) -> dict[tuple[int, int], float]:
    """每格的层号：边缘格 = 边缘层，往里每深入一格（四邻广度优先）加一次增量，封顶。地区外按同种处理（不算边缘）。"""
    depth: dict[tuple[int, int], int] = {}
    frontier = []
    for (i, j), t in terrain.items():
        if t in rules and any(terrain.get((i + a, j + b), t) != t for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            depth[(i, j)] = 0
            frontier.append((i, j))
    while frontier:
        nxt = []
        for i, j in frontier:
            for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                c = (i + a, j + b)
                if c in terrain and c not in depth and terrain[c] == terrain[(i, j)]:
                    depth[c] = depth[(i, j)] + 1
                    nxt.append(c)
        frontier = nxt
    out = {}
    for c, t in terrain.items():
        if t not in rules:
            continue
        base, step, cap = rules[t]
        lv = base + step * depth.get(c, 0)
        out[c] = min(lv, cap) if base > 0 else max(lv, cap)
    return out


def level_field(scene: "Scene", wx, wz, ci, cj) -> np.ndarray:
    """扭曲坐标 (wx, wz)（所在格 ci, cj）处的层号：本格层号；离「同种但层号更接近 0 的邻格」的格边不足 LEVEL_INSET 时取邻格的。"""
    L = scene.lv(ci, cj)
    ids = scene.ids(ci, cj)
    out = L.copy()
    fu, fv = wx - ci, wz - cj
    for (di, dj), d in (((-1, 0), fu), ((1, 0), 1 - fu), ((0, -1), fv), ((0, 1), 1 - fv)):
        nl = scene.lv(ci + di, cj + dj)
        nid = scene.ids(ci + di, cj + dj)
        inner = (nid == ids) & (nid >= 0) & (np.abs(nl) < np.abs(out)) & (d < LEVEL_INSET)
        out = np.where(inner, nl, out)
    return out


def level_xy(scene: "Scene", x, z, seed: int) -> np.ndarray:
    """世界坐标 (x, z)（数组）处的层号；扭到地区外的点按原格（与 cell_tile 的处理一致）。"""
    x, z = np.asarray(x, np.float64), np.asarray(z, np.float64)
    dx, dz = warp(x, z, seed)
    wx, wz = x + dx, z + dz
    ci, cj = np.floor(wx).astype(int), np.floor(wz).astype(int)
    out = scene.ids(ci, cj) < 0
    ci, cj = np.where(out, np.floor(x).astype(int), ci), np.where(out, np.floor(z).astype(int), cj)
    wx, wz = np.where(out, x, wx), np.where(out, z, wz)
    return level_field(scene, wx, wz, ci, cj)


def level_at(scene: "Scene", x: float, z: float, seed: int) -> float:
    """地面上一点的层号（地区外按原格）。"""
    return float(level_xy(scene, np.array([x]), np.array([z]), seed)[0])


def level_ok(scene: "Scene", x: float, z: float, seed: int, gap: float = LEVEL_EDGE_GAP) -> bool:
    """这一点离层边界至少 gap（四个方向的层号都与本点相同）。没有纸层时恒真。"""
    if not scene.levels:
        return True
    lv = level_at(scene, x, z, seed)
    return all(level_at(scene, x + a * gap, z + b * gap, seed) == lv for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))


@dataclass
class Wall:
    """层间的竖直纸边：一段线段（世界 xz）+ 低、高两个层高 + 朝向低侧的法线 + 用来灰化的格（高的那一格）。"""
    p0: tuple[float, float]
    p1: tuple[float, float]
    y0: float
    y1: float
    normal: tuple[float, float]
    cell: tuple[int, int]


def build_walls(scene: "Scene", seed: int, segs: int = 8) -> list[Wall]:
    """在扭曲坐标里沿格边（或内缩后的格边）取 segs 段，整体反扭曲到世界坐标；只在两侧层号不同的边上生成。"""
    walls: list[Wall] = []
    if not scene.levels:
        return walls
    lvl = lambda c: scene.levels.get(c, 0.0)
    for (i, j), t in scene.terrain.items():
        L = lvl((i, j))
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (i + di, j + dj)
            nt = scene.terrain.get(n)
            if nt is None:                         # 地区外沿：不反扭曲，直边；层号不为 0 的格都补一道接到书页（0 层）的纸边
                if L > 0:
                    walls += _edge_walls(i, j, di, dj, 0.0, 0.0, L, (di, dj), (i, j), None, segs)
                elif L < 0:                        # 下陷：纸边从湖面到书页，朝坑内（v1.3.1）
                    walls += _edge_walls(i, j, di, dj, 0.0, L, 0.0, (-di, -dj), (i, j), None, segs)
                continue
            Ln = lvl(n)
            if nt != t:
                if L > Ln:                         # 异种交界：从高的一侧生成一次，落在精确交界上
                    walls += _edge_walls(i, j, di, dj, 0.0, Ln, L, (di, dj), (i, j), seed, segs)
            elif abs(Ln) < abs(L):                 # 同种、本格层号离 0 更远：台阶在本格里内缩
                lo, hi = (Ln, L) if L > 0 else (L, Ln)
                normal = (di, dj) if L > 0 else (-di, -dj)
                walls += _edge_walls(i, j, di, dj, LEVEL_INSET, lo, hi, normal, (i, j), seed, segs)
    return walls


def _edge_walls(i, j, di, dj, inset, lo, hi, normal, cell, seed, segs) -> list[Wall]:
    t = np.linspace(0.0, 1.0, segs + 1)
    if di:
        u = np.full_like(t, i + (1 - inset if di > 0 else inset)); v = j + t
    else:
        u = i + t; v = np.full_like(t, j + (1 - inset if dj > 0 else inset))
    x, z = (u, v) if seed is None else unwarp(u, v, seed)
    return [Wall((float(x[k]), float(z[k])), (float(x[k + 1]), float(z[k + 1])), lo * LEVEL_STEP, hi * LEVEL_STEP,
                 (float(normal[0]), float(normal[1])), cell) for k in range(segs)]


# ── v1.3.1 单栋房屋立牌：摆放配方（工单 §3.12）──────────────────────────────
HOUSE_RECIPES = {        # 聚居类别: ((栋数 min, max), houseKind 候选, 尺寸系数)；要塞第一栋固定是瞭望楼、门派驻地第一栋固定是殿阁
    "village": ((3, 4), ("cottage", "cottage", "tile", "long"), 1.0),
    "fort": ((3, 4), ("tower", "long", "cottage"), 1.0),
    "town": ((4, 5), ("tile", "shop", "long", "tile"), 0.9),
    "city": ((4, 6), ("tile", "shop", "tile", "long"), 0.85),
    "sectSeat": ((3, 4), ("hall", "tile", "long"), 1.0),
}
HOUSE_FIRST = {"fort": "tower", "sectSeat": "hall"}
HOUSE_CLEAR_R = 0.18     # 格心留出的空地半径（棋子站位与地名标注）
HOUSE_DEPTH = 0.12       # 立牌的占地进深（格）：立牌是一张纸，但前后两栋要错开这么多才不像贴在一起
HOUSE_SHOW = 0.5         # 前后错开、横向重叠的两栋，后面那栋在屏幕上至少露出自身高度的这个比例


def house_types_from(items: list[dict]) -> dict[str, list]:
    """清单 J 段 → houseKind → [(artKey, 高, 宽高比)]。"""
    out: dict[str, list] = {}
    for it in items:
        if it.get("section") == "J" and it.get("houseKind"):
            out.setdefault(it["houseKind"], []).append((it["artKey"], float(it["height"]), float(it["aspect"])))
    return out


def house_corners(h: House) -> np.ndarray:
    """房屋立牌的占地矩形（宽 = 立牌宽，进深 HOUSE_DEPTH，立牌底边在矩形中线上），世界 xz，逆时针。"""
    hw, hd = h.w / 2, HOUSE_DEPTH / 2
    return np.array([(h.x - hw, h.z - hd), (h.x + hw, h.z - hd), (h.x + hw, h.z + hd), (h.x - hw, h.z + hd)])


def _sat_overlap(a: np.ndarray, b: np.ndarray, margin: float = 0.0) -> bool:
    for poly in (a, b):
        for k in range(len(poly)):
            e = poly[(k + 1) % len(poly)] - poly[k]
            n = np.array([-e[1], e[0]]) / (np.hypot(*e) + 1e-12)
            pa, pb = a @ n, b @ n
            if pa.max() + margin < pb.min() or pb.max() + margin < pa.min():
                return False
    return True


def _point_in_poly(p, poly: np.ndarray, margin: float = 0.0) -> bool:
    """凸多边形（逆时针或顺时针）内且离边至少 -margin（margin > 0 时把多边形外扩 margin）。"""
    sgn = None
    for k in range(len(poly)):
        a, b = poly[k], poly[(k + 1) % len(poly)]
        e = b - a
        cr = (e[0] * (p[1] - a[1]) - e[1] * (p[0] - a[0])) / (np.hypot(*e) + 1e-12)
        if sgn is None:
            sgn = 1 if cr >= 0 else -1
            # 用多边形面积的符号定方向
            area = sum(poly[q][0] * poly[(q + 1) % len(poly)][1] - poly[(q + 1) % len(poly)][0] * poly[q][1]
                       for q in range(len(poly)))
            sgn = 1 if area > 0 else -1
        if cr * sgn < -margin:
            return False
    return True


def clear_centre(i: int, j: int, kind: str) -> tuple[float, float]:
    """格心空地的中心：一般是格心；门派驻地是殿阁前的院子（殿阁靠后居中，院子在它前面）。"""
    return (i + 0.5, j + 0.74) if kind == "sectSeat" else (i + 0.5, j + 0.5)


def clear_radius(kind: str) -> float:
    return 0.14 if kind == "sectSeat" else HOUSE_CLEAR_R


VIEW_SECTOR_R, VIEW_SECTOR_HALF = 0.45, math.radians(40)   # v1.3.1：棋子朝镜头一侧的扇形内不放房子（只许前景小件）
HOUSE_SHRINK = (1.0, 0.9, 0.8)   # v1.3.1：放不满下限时整组依次缩小再试，仍不够才少放


def in_view_sector(poly: np.ndarray, apex: tuple[float, float], r: float = VIEW_SECTOR_R,
                   half: float = VIEW_SECTOR_HALF) -> bool:
    """多边形是否与「以 apex 为顶点、朝镜头（+z）±half、半径 r」的扇形相交。镜头朝 −z 看，+z 是离镜头近的一侧。"""
    ax, az = apex
    if poly[:, 1].max() < az - 0.05 or np.hypot(np.clip(ax, poly[:, 0].min(), poly[:, 0].max()) - ax,
                                                np.clip(az, poly[:, 1].min(), poly[:, 1].max()) - az) > r:
        return False                               # 包围盒都够不着扇形

    def inside(px, pz):
        dx, dz = px - ax, pz - az
        d = math.hypot(dx, dz)
        return d <= r and (d < 1e-9 or math.acos(max(-1.0, min(1.0, dz / d))) <= half)
    n = len(poly)
    for k in range(n):                             # 多边形边上的点落进扇形
        p0, p1 = poly[k], poly[(k + 1) % n]
        for t in np.linspace(0, 1, 7):
            if inside(*(p0 + (p1 - p0) * t)):
                return True
    for rr in np.linspace(0.05, r, 8):             # 扇形里的点落进多边形（多边形整个盖住扇形一部分）
        for ang in np.linspace(-half, half, 9):
            if _point_in_poly((ax + rr * math.sin(ang), az + rr * math.cos(ang)), poly):
                return True
    return False


def place_houses(i: int, j: int, kind: str, seed: int, types: dict, near_road: list) -> list[House]:
    """按配方在聚居格 (i, j) 里一栋一栋摆房屋立牌：空地、朝镜头的扇形、避开道路、四角都在本格、互不相交、前后错开。
    放不满下限时整组依次缩到 0.9、0.8 倍再试（HOUSE_SHRINK），仍不够才少放；取放得最多的那一次。"""
    (lo, hi), cands, size_k = HOUSE_RECIPES.get(kind, HOUSE_RECIPES["village"])
    n = lo + h32(seed, i, j, 300) % (hi - lo + 1)
    best: list[House] = []
    for m in HOUSE_SHRINK:
        got = _place_once(i, j, kind, seed, types, near_road, cands, size_k * m, n)
        if len(got) > len(best):
            best = got
        if len(best) >= lo:
            break
    return best


def _blocks(a: House, b: House) -> bool:
    """两栋立牌是否冲突：占地相交；或横向重叠超过较窄一栋的三成，而后面那栋在屏幕上露出不到自身高度的一半。
    俯角 PITCH 下，后移 dz 在屏幕上抬高 dz·sinP，高 h 的牌占 h·cosP：露出 = 后.h·cosP + dz·sinP − 前.h·cosP。"""
    if _sat_overlap(house_corners(a), house_corners(b), 0.02):
        return True
    ox = min(a.x + a.w / 2, b.x + b.w / 2) - max(a.x - a.w / 2, b.x - b.w / 2)
    if ox <= 0.3 * min(a.w, b.w):
        return False
    front, back = (a, b) if a.z > b.z else (b, a)
    return (front.z - back.z) * math.tan(PITCH) < front.h - HOUSE_SHOW * back.h


def _place_once(i, j, kind, seed, types, near_road, cands, size_k, n) -> list[House]:
    out: list[House] = []
    cx = i + 0.5
    qx, qz = clear_centre(i, j, kind)
    first = HOUSE_FIRST.get(kind)
    for tries in range(360):
        if len(out) >= n:
            break
        k = first if (first and not out) else cands[h32(seed, i, j, 301, tries) % len(cands)]
        if k not in types:
            continue
        key, hh, asp = types[k][h32(seed, i, j, 305, tries) % len(types[k])]
        sc = size_k * (0.92 + 0.16 * hf(seed, i, j, 308, tries))
        x = i + 0.12 + 0.76 * hf(seed, i, j, 302, tries)
        z = j + 0.12 + 0.76 * hf(seed, i, j, 303, tries)
        if k == "hall" and not out:                # 殿阁：靠后居中，前面是院子（clear_centre）
            sc = size_k * 0.9
            x, z = cx + (hf(seed, i, j, 302, tries) - 0.5) * 0.06, j + 0.2 + 0.1 * hf(seed, i, j, 303, tries)
        elif z > qz and abs(x - qx) < (z - qz) * math.tan(VIEW_SECTOR_HALF) + 0.1:
            continue                               # 中心落在扇形（外扩一点）里的不用试
        h = House(key, k, x, z, hh * asp * sc, hh * sc, (i, j))
        poly = house_corners(h)
        ok = True                                  # 四角都画在本格（按扭曲后的归属格）
        for px_, pz_ in poly:
            dx, dz = warp(px_, pz_, seed)
            if (math.floor(px_ + dx), math.floor(pz_ + dz)) != (i, j):
                ok = False
                break
        if not ok:
            continue
        if _point_in_poly((qx, qz), poly, clear_radius(kind)):     # 空地
            continue
        if in_view_sector(poly, (qx, qz)):                        # 朝镜头的扇形：房子会挡住站在空地上的棋子
            continue
        if any(_point_in_poly(pt, poly, ROAD_W / 2 + 0.02) for pt in near_road):   # 道路
            continue
        if any(_blocks(h, o) for o in out):
            continue
        out.append(h)
    return out


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
    levels: dict = field(default_factory=dict)        # (i, j) → 格的层号（v1.3 地形纸层；空 = 平面）
    houses: list = field(default_factory=list)        # House 列表（v1.3.1 单栋房屋立牌，也已作为 Card 放进 cards；空 = 用整体地点立牌）
    _lgrid: np.ndarray | None = None

    def lgrid(self) -> np.ndarray:
        """层号网格（地区外 = 0），索引方式同 grid()。"""
        if self._lgrid is None:
            g = np.zeros((self.nx + 2, self.nz + 2), np.float32)
            for (i, j), lv in self.levels.items():
                if 0 <= i - self.x0 + 1 < self.nx + 2 and 0 <= j - self.z0 + 1 < self.nz + 2:
                    g[i - self.x0 + 1, j - self.z0 + 1] = lv
            self._lgrid = g
        return self._lgrid

    def lv(self, ci: np.ndarray, cj: np.ndarray) -> np.ndarray:
        a = np.clip(ci - self.x0 + 1, 0, self.nx + 1)
        b = np.clip(cj - self.z0 + 1, 0, self.nz + 1)
        return self.lgrid()[a, b]

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
                settlements: int = 2, roads: bool = True, region: int | None = None, layers: bool = True,
                houses: bool = False) -> Scene:
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

    scene = Scene(x0, z0, nx, nz, terrain, [], [], [])
    if layers:
        scene.levels = cell_levels(terrain)

    # 道路先算（房屋要避开它）
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

    cards: list[Card] = []
    for (i, j), kind in loc_cells.items():
        cands = [it["artKey"] for it in items if it.get("locKind") == kind]
        cands = has_real(cands)
        main = cands[h32(seed, i, j, 11) % len(cands)]
        if houses and assets.house_types:
            near_road = []
            for a, b in zip(road[:-1], road[1:]):
                for (p_, q_) in ((a, b), (b, a)):
                    if p_ == (i, j):
                        for tt in np.linspace(0, 0.5, 8):
                            near_road.append((i + 0.5 + (q_[0] - i) * tt, j + 0.5 + (q_[1] - j) * tt))
            got = place_houses(i, j, kind, seed, assets.house_types, near_road)
            scene.houses += got
            cards += [Card(h.key, h.x, h.z, h.h, 1) for h in got]
        else:
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
            for _ in range(3):                     # 交界弯进本格时，牌脚落在别的地形上 → 向格心收；也不骑在层边上
                if owner(terrain, i + 0.5 + ox, j + 0.5 + oz, seed) == t and level_ok(scene, i + 0.5 + ox, j + 0.5 + oz, seed):
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
                    if owner(terrain, x, z, seed) != t or not level_ok(scene, x, z, seed):
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
                if owner(terrain, x, z, seed) != t or not near_water(x, z, shore["band"]) or not level_ok(scene, x, z, seed):
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

    if scene.levels:
        for c in cards:
            c.y = level_at(scene, c.x, c.z, seed) * LEVEL_STEP
        for h in scene.houses:
            h.y = level_at(scene, h.x, h.z, seed) * LEVEL_STEP     # 记录用；画的是 cards 里的同名 Card
    scene.cards, scene.road, scene.pieces = cards, road, pieces
    return scene


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
              shadow_dir: tuple[float, float], no_rotate: set[str], seed: int,
              water: frozenset = frozenset()) -> tuple[np.ndarray, np.ndarray]:
    """返回 (颜色 (res, res, 3), 层号 (res, res))；没有纸层时层号全 0。"""
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
        tear = diff & (scene.lv(ci + di, cj + dj) == scene.lv(ci, cj)) if scene.levels else diff   # 层号不同的交界由真实侧壁代替
        if diff.any():
            phase = k * 0.37 + wid * 0.13
            uu = ((along * 2.5 + phase) % 1.0) * (ew - 1)
            vv = np.clip(d / (2 * TEAR), 0, 1)
            m = edge[((1 - vv) * (eh - 1)).astype(int), uu.astype(int)]
            paper = np.where(tear, np.minimum(paper, smoothstep(0.42, 0.58, m)), paper)
            lip = np.where(tear, np.maximum(lip, 1 - smoothstep(0.58, 0.80, m)), lip)
            # 光从哪边来，哪边的高邻投下的影子更实：邻格方向与光的水平来向同向则满强度
            w = 1.0 if -(di * lx + dj * lz) > 0 else SHADE_BACK
            hi = tear & (stack[nid] > stack[wid])
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
    lev = level_field(scene, wx, wz, ci, cj) if scene.levels else np.zeros((res, res), np.float32)
    return col, lev


def _convex_hull(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts = sorted(set(pts))
    if len(pts) < 3:
        return pts
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p_ in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p_) <= 0:
            lower.pop()
        lower.append(p_)
    for p_ in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p_) <= 0:
            upper.pop()
        upper.append(p_)
    return lower[:-1] + upper[:-1]


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


def shade_wall(w: Wall, light: np.ndarray) -> np.ndarray:
    """侧壁颜色：纸芯色 × 朝光程度（WO1：竖直纸边露白色纸芯，背光一面暗一些）。"""
    nl = w.normal[0] * light[0] + w.normal[1] * light[2]
    return np.array(RIM_COLOR, np.float32) * (0.80 + 0.20 * max(0.0, nl))


def fill_quad(canvas: Image.Image, quad: np.ndarray, rgb, alpha: int = 255) -> None:
    ImageDraw.Draw(canvas).polygon([tuple(map(float, q)) for q in quad],
                                   fill=tuple(int(round(c * 255)) for c in rgb) + (alpha,))


def light_vec(shadow_dir: tuple[float, float]) -> np.ndarray:
    lx, lz = shadow_dir
    v = np.array([-lx, 1.0, -lz])
    return v / np.linalg.norm(v)


def _bilinear(img: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """img (h, w, c) 在归一化坐标 u, v ∈ [0, 1] 处双线性取样，边缘夹紧。"""
    h, w = img.shape[:2]
    x = np.clip(u * w - 0.5, 0, w - 1)
    y = np.clip(v * h - 0.5, 0, h - 1)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = np.minimum(x0 + 1, w - 1), np.minimum(y0 + 1, h - 1)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    return ((img[y0, x0] * (1 - fx) + img[y0, x1] * fx) * (1 - fy)
            + (img[y1, x0] * (1 - fx) + img[y1, x1] * fx) * fy)


def cast_ground(scene: Scene, cam: Camera, tiles: dict, seed: int, light: np.ndarray, outside,
                band: int = 256) -> tuple[np.ndarray, np.ndarray]:
    """逐像素射线求交：从最高的层面往下，第一个「该点层号 = 这一层」的层面就是看到的顶面；
    射线在两层面之间钻进了更高的地面 → 打在侧壁上（二分找准位置）。返回 (颜色 (h, w, 3), 深度 t (h, w))。

    这和 GPU 上真正建出纸层几何后的结果一致（侧壁竖直、顶面水平），不依赖绘制次序。"""
    H, W = cam.h, cam.w
    rgb = np.empty((H, W, 3), np.float32)
    depth = np.full((H, W), np.inf)
    lvls = sorted({0.0} | {float(v) for v in scene.levels.values()}, reverse=True)
    page = np.array(PAGE_COLOR, np.float32) / 255.0
    rim = np.array(RIM_COLOR, np.float32)
    names = list(tiles)
    tidx = {k: n for n, k in enumerate(names)}
    lev_of = lambda x, z: level_xy(scene, x, z, seed) if scene.levels else np.zeros(np.shape(x))
    for y0 in range(0, H, band):
        py, px = np.mgrid[y0:min(H, y0 + band), 0:W] + 0.5
        o, d = cam.rays(px, py)
        o, d = o.reshape(-1, 3), d.reshape(-1, 3)
        n = len(d)
        col = np.tile(page, (n, 1))
        tt = np.full(n, np.inf)
        todo = np.ones(n, bool)
        t_prev = np.zeros(n)
        for L in lvls:
            idx = np.nonzero(todo)[0]
            if not len(idx):
                break
            t = (L * LEVEL_STEP - o[idx, 1]) / d[idx, 1]
            x, z = o[idx, 0] + d[idx, 0] * t, o[idx, 2] + d[idx, 2] * t
            lv = lev_of(x, z)
            top = np.isclose(lv, L)
            wall = lv > L + 1e-6
            # 顶面：从所在格的瓦片取色；地区外 = 书页
            ti, tj = np.floor(x).astype(int), np.floor(z).astype(int)
            k = np.array([tidx.get((a_, b_), -1) for a_, b_ in zip(ti.tolist(), tj.tolist())]) if len(ti) else np.zeros(0, int)
            hit = top & ((k >= 0) | np.isclose(L, 0.0))
            for q in np.unique(k[hit & (k >= 0)]):
                m = hit & (k == q)
                i_, j_ = names[q]
                c = tiles[names[q]]
                col[idx[m]] = _bilinear(c, x[m] - i_, z[m] - j_)
            tt[idx[hit]] = t[hit]
            # 侧壁：在 (t_prev, t) 之间二分出射线进入高地的位置
            if wall.any():
                wi = idx[wall]
                lo, hi = t_prev[wi], t[wall]
                for _ in range(8):
                    mid = (lo + hi) / 2
                    mx, my, mz = (o[wi, 0] + d[wi, 0] * mid, o[wi, 1] + d[wi, 1] * mid, o[wi, 2] + d[wi, 2] * mid)
                    solid = lev_of(mx, mz) * LEVEL_STEP >= my - 1e-9
                    lo, hi = np.where(solid, lo, mid), np.where(solid, mid, hi)
                th = hi
                hx, hy, hz = o[wi, 0] + d[wi, 0] * th, o[wi, 1] + d[wi, 1] * th, o[wi, 2] + d[wi, 2] * th
                e = 0.012                                   # 由层号的差分求侧壁朝向（朝低的一侧）
                gx = lev_of(hx - e, hz) - lev_of(hx + e, hz)
                gz = lev_of(hx, hz - e) - lev_of(hx, hz + e)
                gn = np.hypot(gx, gz) + 1e-9
                nl = np.maximum(0.0, (gx * light[0] + gz * light[2]) / gn)
                ux, uz = gx / gn, gz / gn                   # 指向低侧的单位法线
                lo_lv = lev_of(hx + ux * e, hz + uz * e) * LEVEL_STEP
                hi_lv = lev_of(hx - ux * e, hz - uz * e) * LEVEL_STEP
                lower = hy < (lo_lv + hi_lv) / 2
                k_ = (0.80 + 0.20 * nl) * np.where(lower, 0.9, 1.0)
                c = rim[None, :] * k_[:, None]
                cell_i, cell_j = np.floor(hx - ux * e).astype(int), np.floor(hz - uz * e).astype(int)
                gr = np.array([outside(a_, b_) for a_, b_ in zip(cell_i.tolist(), cell_j.tolist())], bool)
                if gr.any():
                    c[gr] = grey(c[gr][None])[0]
                col[wi] = c
                tt[wi] = th
            t_prev[idx] = t
            todo[idx[hit | wall]] = False
        rgb[y0:y0 + band] = col.reshape(-1, W, 3)
        depth[y0:y0 + band] = tt.reshape(-1, W)
    return rgb, depth


SIGHT_FEATHER = 0.08    # v1.3.1 选项：视野边界走同一个扭曲时的羽化宽度（格）


def sight_mask(i: int, j: int, res: int, sight: int | None, seed: int, warped: bool) -> np.ndarray | float:
    """灰化程度（0 = 原色，1 = 全灰）。warped：视野方框的边也按 gWarp 弯曲并羽化，与地形交界同一种弯法。"""
    if sight is None:
        return 0.0
    if not warped:
        return float(max(abs(i), abs(j)) > sight)
    v, u = (np.mgrid[0:res, 0:res] + 0.5) / res
    gx, gz = i + u, j + v
    dx, dz = warp(gx, gz, seed)
    d = np.maximum(np.abs(gx + dx - 0.5), np.abs(gz + dz - 0.5)) - (sight + 0.5)
    return smoothstep(-SIGHT_FEATHER / 2, SIGHT_FEATHER / 2, d).astype(np.float32)


def render(scene: Scene, cam: Camera, assets: Assets, items: list[dict], seed: int,
           shadow_dir: tuple[float, float], sight: int | None = None, sight_warp: bool = False) -> Image.Image:
    """sight：视野半径（切比雪夫距离，以注视格 (0, 0) 为中心）；视野外的格子与立牌画成灰的。

    地面（含 v1.3 地形纸层的顶面与侧壁）逐像素射线求交，得到颜色与深度；立牌与房屋再按纵深从远到近画上去，
    立牌按深度检测被更近的纸层挡住的部分（崖后的树露不出脚）。"""
    def outside(i: int, j: int) -> bool:
        return sight is not None and max(abs(i), abs(j)) > sight

    def outside_at(x: float, z: float) -> bool:    # 立牌：按脚下那一点（视野走扭曲时按扭曲后的格）
        if sight_warp:
            dx, dz = warp(x, z, seed)
            x, z = x + dx, z + dz
        return outside(math.floor(x), math.floor(z))
    gc = GroundCache(assets)
    no_rotate = {it["terrain"] for it in items if it.get("kind") == "ground" and it.get("noRotate")}
    water = frozenset(it["terrain"] for it in items if it.get("kind") == "ground" and it.get("water"))
    items_of = {it["artKey"]: it for it in items}
    light = light_vec(shadow_dir)
    ytop = max([0.0] + [v * LEVEL_STEP for v in scene.levels.values()])
    ybot = min([0.0] + [v * LEVEL_STEP for v in scene.levels.values()])
    tiles: dict[tuple[int, int], np.ndarray] = {}
    for j in range(scene.z0, scene.z0 + scene.nz):
        for i in range(scene.x0, scene.x0 + scene.nx):
            if (i, j) not in scene.terrain:
                continue
            quad = cam.project([(i, 0, j), (i + 1, 0, j), (i + 1, 0, j + 1), (i, 0, j + 1)])
            ext = np.concatenate([quad, cam.project([(i, ytop, j), (i + 1, ytop, j), (i, ybot, j + 1), (i + 1, ybot, j + 1)])])
            if ext[:, 0].max() < 0 or ext[:, 0].min() > cam.w or ext[:, 1].max() < 0 or ext[:, 1].min() > cam.h:
                continue
            side = float(max(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[3] - quad[0])))
            res = int(min(768, max(16, math.ceil(side * 1.25 / 16) * 16)))
            col, _lev = cell_tile(scene, i, j, res, gc, items_of, assets, shadow_dir, no_rotate, seed, water)
            m = sight_mask(i, j, res, sight, seed, sight_warp)
            m = m[..., None] if isinstance(m, np.ndarray) else m
            tiles[(i, j)] = col * (1 - m) + grey(col) * m
    rgb, depth = cast_ground(scene, cam, tiles, seed, light, outside)
    canvas = Image.fromarray(al.to_u8(np.concatenate([rgb, np.ones(rgb.shape[:2] + (1,), np.float32)], -1)), "RGBA")

    draws: list[tuple[tuple, object]] = []
    for c in scene.cards:
        draws.append(((c.z, c.order, c.x), ("card", c)))
    draws.sort(key=lambda d: d[0])
    for _k, (kind, obj) in draws:
        if kind == "card":
            c = obj
            a = assets.standee[c.key]
            H, W = a.shape[:2]
            w_ = c.height * W / H
            quad = cam.project([(c.x - w_ / 2, c.y + c.height, c.z), (c.x + w_ / 2, c.y + c.height, c.z),
                                (c.x + w_ / 2, c.y, c.z), (c.x - w_ / 2, c.y, c.z)])
            img = standee_image(a)
            if outside_at(c.x, c.z):
                arr = np.asarray(img, np.float32) / 255.0
                arr[..., :3] = grey(arr)
                img = Image.fromarray(al.to_u8(arr), "RGBA")

            def occ(x0, y0, x1, y1, cz=c.z):
                if not scene.levels:
                    return None
                py_, px_ = np.mgrid[y0:y1, x0:x1] + 0.5
                o, d = cam.rays(px_, py_)
                tc = (cz - o[..., 2]) / d[..., 2]           # 射线打到立牌所在竖直面的 t
                return (tc <= depth[y0:y1, x0:x1] * (1 + 1e-4) + 1e-4).astype(np.float32)
            warp_into(canvas, img, quad, occ)
    return canvas


SHADOWS = {"lowerRight": (0.55, 0.40), "warmDay": (5 / 8, -3 / 8)}


def make_preview(items: list[dict], *, cols: float, seed: int, size=(1920, 1080), ortho: bool = False, ss: int = 2,
                 terrains: list[str] | None = None, settlements: int = 2, roads: bool = True,
                 src: Path = al.WORK_DIR, ground_src: Path = al.RAW_DIR, use_real: bool = True,
                 shadow: str = "lowerRight", sight: int | None = None, region: int | None = None,
                 pawn: bool = True, ground_px: int | None = GROUND_PX, layers: bool = True,
                 houses: bool = False, level_step: float | None = None,
                 sight_warp: bool = False) -> tuple[Image.Image, Assets, Camera]:
    global LEVEL_STEP
    saved = LEVEL_STEP
    if level_step is not None:                     # 对比用：临时改模块级的层厚（render 与布置都读它），画完复原
        LEVEL_STEP = level_step
    try:
        return _make_preview(items, cols, seed, size, ortho, ss, terrains, settlements, roads, src, ground_src,
                             use_real, shadow, sight, region, pawn, ground_px, layers, houses, sight_warp)
    finally:
        LEVEL_STEP = saved


def _make_preview(items, cols, seed, size, ortho, ss, terrains, settlements, roads, src, ground_src, use_real,
                  shadow, sight, region, pawn, ground_px, layers, houses, sight_warp):
    terrains = terrains or list(NATURAL)
    assets = load_assets(items, terrains, src, ground_src, use_real)
    assets.ground_px = ground_px
    if houses:
        assets.house_types = house_types_from(items)
    W, H = size
    cam = Camera(W * ss, H * ss, cols, ortho=ortho)
    scene = build_scene(items, assets, cam, terrains, seed, settlements, roads, region, layers, houses)
    if pawn:                                       # 棋子（占位），站在注视格前半格，给尺度参照
        assets.standee["pawn"] = placeholder_pawn()
        py = level_at(scene, 0.5, 0.62, seed) * LEVEL_STEP if scene.levels else 0.0
        scene.cards.append(Card("pawn", 0.5, 0.62, 0.3, 3, py))
    img = render(scene, cam, assets, items, seed, SHADOWS[shadow], sight, sight_warp)
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
    ap.add_argument("--flat", action="store_true", help="不抬地形纸层（v1.2 的平面地面，等于低画质档的回退）")
    ap.add_argument("--houses", action="store_true",
                    help="聚居格改用折纸房屋（v1.3；部件缺图时用占位）；默认仍画整张聚落立牌")
    ap.add_argument("--level-step", type=float, default=None,
                    help=f"地形纸层一层的厚度（格，默认 {LEVEL_STEP}）；对比用，正式值在 terrain-art.json 的 levelStep")
    ap.add_argument("--sight-warp", action="store_true",
                    help=f"视野边界也按交界的扭曲弯曲，并羽化 {SIGHT_FEATHER} 格（v1.3.1 备选，默认直边方框）")
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
                                    ground_px=args.ground_px, layers=not args.flat, houses=args.houses,
                                    level_step=args.level_step, sight_warp=args.sight_warp)
    out = args.out or (al.ROOT / "art" / "region" / "review" /
                       f"preview-{args.zoom or 'c%g' % args.cols}-s{args.seed}{'-ortho' if args.ortho else ''}"
                       f"{'' if args.ground_px == GROUND_PX else '-g%d' % args.ground_px}"
                       f"{'-flat' if args.flat else ''}{'-houses' if args.houses else ''}"
                       f"{'' if args.level_step is None else '-ls%g' % args.level_step}"
                       f"{'-sw' if args.sight_warp else ''}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out)
    print(f"已写入 {al.rel(out)}（{w}×{h}，{'正交' if args.ortho else '透视'}，注视行约 {w / args.cols:.0f}px / 格）")
    used = sorted(set(assets.real))
    print(f"真实素材 {len(used)} 张：{', '.join(used) if used else '无'}；其余用占位图")
    return 0


if __name__ == "__main__":
    sys.exit(main())
