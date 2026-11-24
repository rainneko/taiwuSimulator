"""美术后处理工具链的共用函数（M3-WO3 §6）。

读写、颜色换算（sRGB / OKLab / OKLCh）、品红抠像、形态学、按距离场羽化、边缘颜色外扩、
预乘缩放、平铺接缝度量、清单读取、统一的报错格式。只依赖 numpy 与 Pillow。

约定：图像在内存里一律是 float32、形状 (H, W, C)、取值 0–1、直通（非预乘）alpha。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LIST = ROOT / "tools" / "art" / "region-assets.json"
RAW_DIR = ROOT / "art" / "region" / "raw"
WORK_DIR = ROOT / "art" / "region" / "work"
ART_ROOT = ROOT / "content" / "base" / "art"
IMG_EXTS = (".png", ".webp", ".jpg", ".jpeg")

# 后处理的硬性下限（与 M3-WO1 §2.6 一致）
MIN_FEATHER = 2.0
MIN_PADDING = 4


# ── 报错 ────────────────────────────────────────────────────────────────────

class Report:
    """收集每张图的问题；错误令退出码为 1，警告只打印。"""

    def __init__(self) -> None:
        self.items: list[tuple[str, str, str, str]] = []   # (级别, 文件, 规则, 说明)

    def error(self, file: str, rule: str, msg: str) -> None:
        self.items.append(("错误", file, rule, msg))

    def warn(self, file: str, rule: str, msg: str) -> None:
        self.items.append(("警告", file, rule, msg))

    def info(self, file: str, rule: str, msg: str) -> None:
        self.items.append(("信息", file, rule, msg))

    @property
    def errors(self) -> list[tuple[str, str, str, str]]:
        return [i for i in self.items if i[0] == "错误"]

    @property
    def ok(self) -> bool:
        return not self.errors

    def has(self, file: str, rule: str, level: str = "错误") -> bool:
        return any(i[0] == level and i[1] == file and i[2] == rule for i in self.items)

    def print(self, stream=None, quiet: bool = False) -> None:
        stream = stream or sys.stderr
        for level, file, rule, msg in self.items:
            if quiet and level == "信息":
                continue
            print(f"[{level}] {file}：{rule}——{msg}", file=stream)
        n_e = len(self.errors)
        n_w = sum(1 for i in self.items if i[0] == "警告")
        print(f"共 {n_e} 个错误、{n_w} 个警告", file=stream)

    def exit_code(self) -> int:
        return 0 if self.ok else 1


def rel(p: Path | str) -> str:
    p = Path(p)
    try:
        return str(p.resolve().relative_to(ROOT))
    except ValueError:
        return str(p)


# ── 读写 ────────────────────────────────────────────────────────────────────

def load_rgba(path: Path | str) -> np.ndarray:
    with Image.open(path) as im:
        im.load()
        if im.mode in ("I;16", "I;16B", "I"):
            im = im.point(lambda v: v / 256).convert("L")
        return np.asarray(im.convert("RGBA"), dtype=np.float32) / 255.0


def to_u8(arr: np.ndarray) -> np.ndarray:
    return np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)


def save_image(arr: np.ndarray, path: Path | str, quality: int = 92) -> None:
    """按扩展名存 PNG 或 WebP。WebP 用有损 RGB + 无损 alpha，并保留透明像素的颜色（exact）。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if arr.ndim == 2:
        im = Image.fromarray(to_u8(arr), "L")
    elif arr.shape[2] == 3:
        im = Image.fromarray(to_u8(arr), "RGB")
    else:
        im = Image.fromarray(to_u8(arr), "RGBA")
    if path.suffix.lower() == ".webp":
        im.save(path, "WEBP", quality=quality, alpha_quality=100, exact=True, method=6)
    else:
        im.save(path, "PNG", optimize=False)


def find_image(directory: Path, stem: str) -> Path | None:
    for ext in IMG_EXTS:
        p = directory / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def load_list(path: Path | str = DEFAULT_LIST) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    items = data["items"] if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise ValueError(f"{path}：清单格式不对，应为 {{\"items\": [...]}}")
    return items


def write_json(path: Path | str, data: object) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


# ── 颜色 ────────────────────────────────────────────────────────────────────

def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, None)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def srgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    lin = srgb_to_linear(np.asarray(rgb, dtype=np.float64))
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return np.stack([
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ], axis=-1)


def mean_oklch(rgb: np.ndarray, weight: np.ndarray | None = None) -> tuple[float, float, float]:
    """在 OKLab 里求平均，再换成 (L, C, h°)。weight 一般传 alpha。"""
    lab = srgb_to_oklab(rgb).reshape(-1, 3)
    if weight is not None:
        w = weight.reshape(-1).astype(np.float64)
        if w.sum() <= 0:
            return 0.0, 0.0, 0.0
        m = (lab * w[:, None]).sum(0) / w.sum()
    else:
        m = lab.mean(0)
    c = float(np.hypot(m[1], m[2]))
    h = float(np.degrees(np.arctan2(m[2], m[1])) % 360)
    return float(m[0]), c, h


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


# ── 形态学（布尔掩膜）────────────────────────────────────────────────────────

_N4 = ((-1, 0), (1, 0), (0, -1), (0, 1))
_N8 = _N4 + ((-1, -1), (-1, 1), (1, -1), (1, 1))


def shift(a: np.ndarray, dy: int, dx: int, fill=0) -> np.ndarray:
    """把数组平移 (dy, dx)，空出来的位置填 fill（不回卷）。"""
    out = np.empty_like(a)
    out[...] = fill
    h, w = a.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = a[ys, xs]
    return out


def erode(mask: np.ndarray, cross: bool = False, border: bool = False) -> np.ndarray:
    """border：画面之外当作 True（不把贴着画面边缘的像素当成边界）还是 False。"""
    out = mask.copy()
    for dy, dx in (_N4 if cross else _N8):
        out &= shift(mask, dy, dx, border)
    return out


def dilate(mask: np.ndarray, cross: bool = False) -> np.ndarray:
    out = mask.copy()
    for dy, dx in (_N4 if cross else _N8):
        out |= shift(mask, dy, dx, False)
    return out


def label_components(mask: np.ndarray, max_iter: int = 4096) -> tuple[np.ndarray, dict[int, int]]:
    """4 邻接连通域标记（向量化的最大值传播）。返回 (标签图, {标签: 像素数})，背景为 0。"""
    h, w = mask.shape
    lab = np.where(mask, np.arange(1, h * w + 1, dtype=np.int64).reshape(h, w), 0)
    for _ in range(max_iter):
        prev = lab
        nb = lab.copy()
        for dy, dx in _N4:
            nb = np.maximum(nb, shift(lab, dy, dx, 0))
        lab = np.where(mask, nb, 0)
        if np.array_equal(lab, prev):
            break
    ids, counts = np.unique(lab[lab > 0], return_counts=True)
    return lab, {int(i): int(c) for i, c in zip(ids, counts)}


# ── 抠像 ────────────────────────────────────────────────────────────────────

MAGENTA = np.array([1.0, 0.0, 1.0], dtype=np.float32)


def border_ring(a: np.ndarray, width: int = 4) -> np.ndarray:
    return np.concatenate([a[:width].reshape(-1, *a.shape[2:]), a[-width:].reshape(-1, *a.shape[2:]),
                           a[:, :width].reshape(-1, *a.shape[2:]), a[:, -width:].reshape(-1, *a.shape[2:])])


def detect_background(img: np.ndarray) -> str:
    """'alpha'（已透明）/ 'magenta'（品红底）/ 'checker'（画出来的灰白棋盘格）/ 'opaque'（其他不透明底）。"""
    ring = border_ring(img)
    if (ring[:, 3] < 0.5).mean() >= 0.6:
        return "alpha"
    rgb = ring[:, :3]
    near_mag = (rgb[:, 0] > 0.8) & (rgb[:, 1] < 0.25) & (rgb[:, 2] > 0.8)
    if near_mag.mean() >= 0.6:
        return "magenta"
    chroma = rgb.max(1) - rgb.min(1)
    lum = luminance(rgb)
    if (chroma < 0.06).mean() > 0.9 and lum.mean() > 0.55:
        q = np.round(lum * 40).astype(int)
        vals, cnt = np.unique(q, return_counts=True)
        top = np.argsort(cnt)[::-1][:2]
        if len(top) == 2 and cnt[top].sum() / cnt.sum() > 0.8 and abs(vals[top[0]] - vals[top[1]]) >= 2:
            return "checker"
    return "opaque"


def key_magenta(rgb: np.ndarray, solid: float = 0.2, clear: float = 0.92) -> tuple[np.ndarray, np.ndarray]:
    """品红底 → (alpha, 去溢色后的 rgb)。

    品红度 m = min(R, B) − G：纯品红为 1，低饱和的主体接近 0 或为负。
    m < solid 的像素算实色主体，m > clear 的算背景；介于两者之间的边缘像素看成「最近的实色主体色 s」与品红 K
    的混合 c = a·s + (1−a)·K，用投影 a = (c−K)·(s−K) / |s−K|² 求 alpha，颜色直接取 s——品红溢色因此完全去掉。
    离实色主体太远（> 6px）的半透明像素退回到 a ≈ (1 − m) / (1 − solid) 的估计。
    """
    m = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    is_solid = m < solid
    is_bg = m > clear
    s_est = bleed(rgb, is_solid.astype(np.float32), known=0.5, iterations=6)
    reached = dilate(is_solid)
    for _ in range(5):
        reached = dilate(reached)
    d = s_est - MAGENTA
    num = ((rgb - MAGENTA) * d).sum(-1)
    den = (d * d).sum(-1) + 1e-6
    a_proj = np.clip(num / den, 0.0, 1.0)
    a_fall = np.clip((1.0 - m) / (1.0 - solid), 0.0, 1.0)
    a = np.where(is_solid, 1.0, np.where(is_bg, 0.0, np.where(reached, a_proj, a_fall)))
    a[a < 0.04] = 0.0
    out = np.where(is_solid[..., None], rgb, s_est)
    out = np.where(a[..., None] > 0, out, 0.0)
    return a.astype(np.float32), out.astype(np.float32)


# ── 羽化与外扩 ──────────────────────────────────────────────────────────────

def signed_distance_band(alpha: np.ndarray, radius: int) -> np.ndarray:
    """以 alpha = 0.5 为界的近似有符号距离（像素，内正外负），只在 ±radius 带内精确。

    交替使用十字与方形腐蚀，得到八边形距离（比棋盘距离更接近欧氏距离）；
    贴着边界的那一圈用原 alpha 做亚像素修正，保住源图抗锯齿里的位置信息。
    """
    inside = alpha >= 0.5
    d = np.zeros(alpha.shape, dtype=np.float32)
    for region, sign in ((inside, 1.0), (~inside, -1.0)):
        cur = region.copy()
        dist = np.full(alpha.shape, radius + 1, dtype=np.float32)
        for k in range(1, radius + 1):
            er = erode(cur, cross=(k % 2 == 1), border=True)
            dist[cur & ~er] = k
            cur = er
        d = np.where(region, sign * (dist - 0.5), d)
    edge_in = inside & ~erode(inside, cross=True, border=True)
    edge_out = ~inside & ~erode(~inside, cross=True, border=True)
    d = np.where(edge_in | edge_out, alpha - 0.5, d)
    return d


def feather_alpha(alpha: np.ndarray, width: float) -> np.ndarray:
    """把剪影边缘做成宽 width 像素的线性 alpha 斜坡，0.5 等值线位置不变（细线不会被吃掉）。"""
    radius = int(np.ceil(width / 2)) + 1
    d = signed_distance_band(alpha, radius)
    return np.clip(0.5 + d / width, 0.0, 1.0).astype(np.float32)


def measure_feather(alpha: np.ndarray) -> float:
    """估计剪影边缘 alpha 斜坡的平均宽度（像素）。

    宽 W 的线性斜坡满足 ∫a(1−a)dx = W/6，于是 W ≈ 6·Σa(1−a) / 边界长度（边界长度取 0.5 等值线内侧那一圈的像素数）。
    只有 1px 抗锯齿的硬边约为 1.5，feather_alpha(…, 2) 的结果约为 2.2。
    """
    inside = alpha >= 0.5
    boundary = (inside & ~erode(inside, cross=True, border=True)).sum()
    if boundary == 0:
        return 0.0
    return float(6.0 * (alpha * (1.0 - alpha)).sum() / boundary)


def bleed(rgb: np.ndarray, alpha: np.ndarray, known: float = 0.3, iterations: int = 16) -> np.ndarray:
    """边缘颜色外扩：把 alpha < known 的像素的颜色替换成相邻实色像素的平均，逐圈向外推 iterations 圈，
    剩下的远处透明区填实色像素的平均色。防止 mipmap 和线性过滤把透明区的黑色 / 品红渗进剪影边缘。"""
    out = rgb.copy()
    k = alpha >= known
    if not k.any():
        return out
    out[~k] = 0.0
    for _ in range(iterations):
        unknown = ~k
        if not unknown.any():
            break
        acc = np.zeros_like(out)
        cnt = np.zeros(alpha.shape, dtype=np.float32)
        weighted = out * k[..., None]
        for dy, dx in _N8:
            acc += shift(weighted, dy, dx, 0.0)
            cnt += shift(k, dy, dx, False)
        new = unknown & (cnt > 0)
        if not new.any():
            break
        out[new] = acc[new] / cnt[new][:, None]
        k = k | new
    if (~k).any():
        out[~k] = out[k].mean(0)
    return out


def trim_box(alpha: np.ndarray, thresh: float = 0.02) -> tuple[int, int, int, int] | None:
    """alpha > thresh 的包围盒 (x0, y0, x1, y1)，x1 / y1 不含。"""
    ys, xs = np.nonzero(alpha > thresh)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


# ── 缩放 ────────────────────────────────────────────────────────────────────

def _resize_channels(chs: Iterable[np.ndarray], w: int, h: int, box=None) -> list[np.ndarray]:
    out = []
    for c in chs:
        im = Image.fromarray(np.ascontiguousarray(c, dtype=np.float32), "F")
        out.append(np.asarray(im.resize((w, h), Image.LANCZOS, box=box), dtype=np.float32))
    return out


def resize_rgba(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """在预乘空间里缩放（否则透明区的颜色会渗进边缘），缩完再还原成直通 alpha。"""
    a = img[..., 3]
    chs = _resize_channels([img[..., 0] * a, img[..., 1] * a, img[..., 2] * a, a], w, h)
    na = np.clip(chs[3], 0.0, 1.0)
    safe = np.maximum(na, 1e-4)
    rgb = np.stack([np.clip(c / safe, 0.0, 1.0) for c in chs[:3]], axis=-1)
    rgb = np.where(na[..., None] > 1e-4, rgb, 0.0)
    return np.concatenate([rgb, na[..., None]], axis=-1).astype(np.float32)


def resize_tile(img: np.ndarray, w: int, h: int, axes: str = "xy") -> np.ndarray:
    """可平铺纹理的缩放：先按回卷方式在四周补边，让滤波核跨过边界取到对边的像素，再缩放，保证缩完仍可平铺。"""
    H, W = img.shape[:2]
    py = 16 if "y" in axes else 0
    px = 16 if "x" in axes else 0
    pad = [(py, py), (px, px)] + [(0, 0)] * (img.ndim - 2)
    p = np.pad(img, pad, mode="wrap") if (px or py) else img
    if "y" not in axes:
        p = np.pad(p, [(16, 16), (0, 0)] + [(0, 0)] * (img.ndim - 2), mode="edge")
        py = 16
    if "x" not in axes:
        p = np.pad(p, [(0, 0), (16, 16)] + [(0, 0)] * (img.ndim - 2), mode="edge")
        px = 16
    box = (px, py, px + W, py + H)
    if img.ndim == 2:
        return np.clip(_resize_channels([p], w, h, box)[0], 0, 1)
    if img.shape[2] == 4:
        a = p[..., 3]
        chs = _resize_channels([p[..., 0] * a, p[..., 1] * a, p[..., 2] * a, a], w, h, box)
        na = np.clip(chs[3], 0, 1)
        safe = np.maximum(na, 1e-4)
        rgb = np.stack([np.clip(c / safe, 0, 1) for c in chs[:3]], -1)
        return np.concatenate([rgb, na[..., None]], -1).astype(np.float32)
    chs = _resize_channels([p[..., i] for i in range(img.shape[2])], w, h, box)
    return np.clip(np.stack(chs, -1), 0, 1).astype(np.float32)


# ── 平铺度量 ────────────────────────────────────────────────────────────────

def seam_stats(img: np.ndarray, axis: str = "x", segments: int = 8, near: int = 8) -> dict[str, float]:
    """把图错位半幅拼接时，原来的边缘在中间相接；度量这条接缝两侧相邻像素的差，与图内部相邻像素差之比。

    axis='x' 查左右拼接（竖向接缝），'y' 查上下拼接。直接比较第一列与最后一列，等价于错位半幅后看中缝。
    参照值取「靠近两条边的 near 列内部的相邻差」（同一位置的局部细节量），并以全图平均相邻差的一半兜底，
    这样陡而连续的轮廓穿过接缝不会被误判，真正的断层仍然突出。
    返回 {'ratio': 整条缝的比值, 'segment': 分 segments 段后各段比值的最大值}。可平铺的图两者都接近 1。
    """
    a = img if axis == "x" else np.swapaxes(img, 0, 1)
    if a.ndim == 2:
        a = a[..., None]
    interior = np.abs(np.diff(a, axis=1)).sum(-1)             # (H, W-1)
    local = np.concatenate([interior[:, :near], interior[:, -near:]], axis=1).mean(1)   # (H,)
    seam = np.abs(a[:, 0] - a[:, -1]).sum(-1)                  # (H,)
    floor = max(0.5 * float(interior.mean()), 1e-4)
    ratio = float(seam.mean() / max(float(local.mean()), floor))
    seg_max = 0.0
    for idx in np.array_split(np.arange(a.shape[0]), segments):
        if len(idx) == 0:
            continue
        seg_max = max(seg_max, float(seam[idx].mean() / max(float(local[idx].mean()), floor)))
    return {"ratio": ratio, "segment": seg_max}


def heal_tile(img: np.ndarray, axes: str = "xy", band: float = 0.18) -> np.ndarray:
    """兜底修补：把图与错位半幅的自身按「边缘取错位版、中心取原图」混合，接缝被藏到中心。会有轻微重影，只作救急。"""
    H, W = img.shape[:2]
    rolled = np.roll(img, (H // 2 if "y" in axes else 0, W // 2 if "x" in axes else 0), axis=(0, 1))

    def ramp(n: int) -> np.ndarray:
        t = np.minimum(np.arange(n) + 0.5, n - np.arange(n) - 0.5) / (n * band)
        t = np.clip(t, 0, 1)
        return t * t * (3 - 2 * t)

    wx = ramp(W) if "x" in axes else np.ones(W)
    wy = ramp(H) if "y" in axes else np.ones(H)
    w = np.minimum(wy[:, None], wx[None, :]).astype(np.float32)
    if img.ndim == 3:
        w = w[..., None]
    return img * w + rolled * (1 - w)
