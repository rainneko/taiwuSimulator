"""测试用的合成图：全部由程序画出，不依赖任何真实素材。"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))   # tools/art

SS = 4   # 超采样倍数，得到抗锯齿边缘


def _canvas(size: int, bg: tuple[int, int, int, int]) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGBA", (size * SS, size * SS), bg)
    return im, ImageDraw.Draw(im)


def _finish(im: Image.Image, size: int) -> np.ndarray:
    return np.asarray(im.resize((size, size), Image.LANCZOS), dtype=np.float32) / 255.0


def house(size: int = 256, bg=(255, 0, 255, 255), shadow: bool = False, point_down: bool = False,
          cut_left: bool = False, wide_base: float = 0.5) -> np.ndarray:
    """一张「立牌」：土黄墙身 + 灰蓝屋顶，底边平直，四周留白。

    shadow：在底部加一片半透明暗色椭圆（模拟画进图里的落影）
    point_down：把墙身换成倒三角（底边只有一个尖着地）
    cut_left：主体贴着左边（被画幅裁切）
    """
    im, d = _canvas(size, bg)
    s = SS * size
    cx = s // 2
    x0 = 0 if cut_left else int(s * (0.5 - wide_base / 2))
    x1 = int(s * (0.5 + wide_base / 2))
    top, mid, bot = int(s * 0.2), int(s * 0.45), int(s * 0.88)
    if point_down:
        d.polygon([(x0, mid), (x1, mid), (cx, bot)], fill=(196, 170, 120, 255))
    else:
        d.rectangle([x0, mid, x1, bot], fill=(196, 170, 120, 255))
        d.rectangle([cx - s * 0.05, int(s * 0.65), cx + s * 0.05, bot], fill=(90, 70, 50, 255))   # 门
    d.polygon([(x0 - s * 0.04, mid), (x1 + s * 0.04, mid), (cx, top)], fill=(110, 128, 150, 255))
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse([x0 - s * 0.12, bot - s * 0.04, x1 + s * 0.12, bot + s * 0.08], fill=(0, 0, 0, 120))
        if bg[3] == 255:
            base = Image.new("RGBA", im.size, bg)
            base.alpha_composite(sh)
            base.alpha_composite(_only_subject(im, bg))
            im = base
        else:
            sh.alpha_composite(im)
            im = sh
    return _finish(im, size)


def _only_subject(im: Image.Image, bg) -> Image.Image:
    a = np.asarray(im).copy()
    mask = np.all(a[..., :3] == np.array(bg[:3]), axis=-1)
    a[mask, 3] = 0
    return Image.fromarray(a, "RGBA")


def checker(size: int = 256) -> np.ndarray:
    """主体画在灰白棋盘格上（假透明）。"""
    a = np.zeros((size, size, 4), dtype=np.float32)
    yy, xx = np.mgrid[0:size, 0:size]
    a[..., :3] = np.where((((yy // 16) + (xx // 16)) % 2 == 0)[..., None], 1.0, 0.8)
    a[..., 3] = 1.0
    a[size // 3: size * 2 // 3, size // 3: size * 2 // 3, :3] = [0.6, 0.4, 0.3]
    return a


def opaque_white_bg(size: int = 256) -> np.ndarray:
    h = house(size, bg=(240, 236, 226, 255))
    return h


def periodic_noise(size: int = 256, seed: int = 1, kmax: int = 10, colour=(0.55, 0.6, 0.45), amp: float = 0.12) -> np.ndarray:
    """整数频率的正弦叠加：严格周期，四向可平铺；空间上平滑，像真实纹理。"""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size] / size
    f = np.zeros((size, size))
    for _ in range(40):
        kx, ky = rng.integers(-kmax, kmax + 1, 2)
        f += np.sin(2 * np.pi * (kx * xx + ky * yy) + rng.uniform(0, 2 * np.pi)) / (1 + np.hypot(kx, ky))
    f = (f - f.mean()) / (np.abs(f).max() + 1e-6)
    return np.clip(np.array(colour)[None, None] + amp * f[..., None], 0, 1).astype(np.float32)


def nonperiodic_noise(size: int = 256, seed: int = 2, colour=(0.55, 0.6, 0.45), amp: float = 0.12) -> np.ndarray:
    """非整数频率：同样平滑，但左右、上下两边对不上。"""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:size, 0:size] / size
    f = np.zeros((size, size))
    for _ in range(40):
        kx, ky = rng.uniform(-6.3, 6.3, 2)
        f += np.sin(2 * np.pi * (kx * xx + ky * yy) + rng.uniform(0, 2 * np.pi)) / (1 + np.hypot(kx, ky))
    f = (f - f.mean()) / (np.abs(f).max() + 1e-6)
    return np.clip(np.array(colour)[None, None] + amp * f[..., None], 0, 1).astype(np.float32)


def road_strip(w: int = 512, h: int = 128, bg=(255, 0, 255, 255), periodic: bool = True) -> np.ndarray:
    """横向长条：中间一条带子，上下边缘按正弦起伏（整数周期则左右可平铺）。"""
    a = np.zeros((h, w, 4), dtype=np.float32)
    a[..., :3] = np.array(bg[:3]) / 255
    a[..., 3] = bg[3] / 255
    xx = np.arange(w) / w
    k = 3 if periodic else 2.4
    top = (0.22 + 0.04 * np.sin(2 * np.pi * k * xx)) * h
    bot = (0.78 + 0.04 * np.sin(2 * np.pi * (k + (0 if periodic else 0.5)) * xx + 1.0)) * h
    yy = np.arange(h)[:, None] + 0.5
    cover = np.clip(yy + 0.5 - top[None], 0, 1) * np.clip(bot[None] - (yy - 0.5), 0, 1)   # 抗锯齿覆盖率
    gen = periodic_noise if periodic else nonperiodic_noise
    tex = gen(max(w, h), seed=5, colour=(0.72, 0.6, 0.4))[:h, :w]
    bgc = a[..., :3].copy()
    a[..., :3] = tex * cover[..., None] + bgc * (1 - cover[..., None]) if bg[3] == 255 else tex
    a[..., 3] = 1.0 if bg[3] == 255 else cover
    return a


def edge_mask(w: int = 512, h: int = 128) -> np.ndarray:
    xx = np.arange(w) / w
    line = (0.5 + 0.1 * np.sin(2 * np.pi * 5 * xx) + 0.05 * np.sin(2 * np.pi * 13 * xx)) * h
    yy = np.arange(h)[:, None] + 0.5
    g = np.clip(line[None] - (yy - 0.5), 0, 1).astype(np.float32)
    return np.repeat(g[..., None], 3, -1)


def save(arr: np.ndarray, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    u8 = np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8)
    mode = {3: "RGB", 4: "RGBA"}[arr.shape[2]]
    Image.fromarray(u8, mode).save(path)
    return path
