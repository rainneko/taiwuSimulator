#!/usr/bin/env python3
"""重叠边渐变接合（M3-WO3 §2.5 的补救步骤）：把直出接不上的底纸 / 长条做成可平铺。

做法（试点 2026-11-24 时 Codex 手工做过一遍，这里固化成工具，保证 18 张底纸做法一致）：
沿要平铺的轴，把图最后 overlap 像素与最前 overlap 像素按线性渐变混合，再裁掉末尾那 overlap 像素——
于是新的右边缘正好接回新的左边缘；最后缩放回原尺寸。有 alpha 的图按预乘 alpha 混合（透明区的颜色不渗进来）。
混合区里两份内容会叠出淡淡的重影，overlap 越大越柔和、重影越宽；底纸取 64（1024 宽的 1/16），道路取 32。

只在 check_tile 报错、且重出三次仍不过时用；原图不动，输出另存。

用法：
    python3 tools/art/seam_blend.py art/region/raw/terrain.ground.woods.png                 # 两轴各 64，覆盖写到 --out
    python3 tools/art/seam_blend.py --strip --overlap 32 art/region/raw/region.road.png     # 只接左右
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import artlib as al


def blend_axis(img: np.ndarray, overlap: int, axis: int) -> np.ndarray:
    """沿 axis（1 = 左右，0 = 上下）接合；返回的图在这一轴上短 overlap 像素，首尾无缝。"""
    n = img.shape[axis]
    if not 0 < overlap < n // 2:
        raise ValueError(f"overlap {overlap} 须在 1 到 {n // 2 - 1} 之间")
    a = np.moveaxis(img, axis, 0)
    w = ((np.arange(overlap) + 0.5) / overlap).reshape((-1,) + (1,) * (a.ndim - 1))
    head, tail = a[:overlap], a[n - overlap:]
    out = a[:n - overlap].copy()
    out[:overlap] = tail * (1 - w) + head * w        # 开头从「原图末尾」渐变到「原图开头」，于是接得上新的末尾
    return np.moveaxis(out, 0, axis)


def seam_blend(img: np.ndarray, overlap: int, strip: bool = False) -> np.ndarray:
    """img: (h, w, 3|4) float。返回同尺寸、可平铺的图。"""
    h, w = img.shape[:2]
    alpha = img.shape[2] == 4
    data = np.concatenate([img[..., :3] * img[..., 3:4], img[..., 3:4]], -1) if alpha else img.copy()
    data = blend_axis(data, overlap, 1)
    if not strip:
        data = blend_axis(data, overlap, 0)
    if alpha:
        a = data[..., 3:4]
        data = np.concatenate([np.where(a > 1e-6, data[..., :3] / np.maximum(a, 1e-6), 0), a], -1)
    # 缩放回原尺寸：按通道用 PIL 的 float 模式（不经 8 位量化）
    chans = [np.asarray(Image.fromarray(data[..., c].astype(np.float32), "F").resize((w, h), Image.BICUBIC))
             for c in range(data.shape[2])]
    return np.clip(np.stack(chans, -1), 0, 1).astype(np.float32)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", type=Path, help="图片文件")
    ap.add_argument("--overlap", type=int, default=64, help="重叠像素（默认 64；道路长条用 32）")
    ap.add_argument("--strip", action="store_true", help="横向长条：只接左右")
    ap.add_argument("--out", type=Path, help="输出目录（默认与输入同目录、文件名加 .blend）")
    args = ap.parse_args(argv)
    rep = al.Report()
    for p in args.inputs:
        img = al.load_rgba(p)
        if img[..., 3].min() >= 0.999:
            img = img[..., :3]
        try:
            out = seam_blend(img, args.overlap, args.strip)
        except ValueError as e:
            rep.error(al.rel(p), "参数", str(e))
            continue
        dst = (args.out / p.name) if args.out else p.with_name(p.stem + ".blend.png")
        dst.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(al.to_u8(out), "RGBA" if out.shape[2] == 4 else "RGB").save(dst)
        rep.info(al.rel(p), "接合", f"{'左右' if args.strip else '两轴'}各重叠 {args.overlap}px → {al.rel(dst)}")
    rep.print()
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
