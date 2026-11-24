#!/usr/bin/env python3
"""平铺检查（M3-WO3 §6.3）：底纸、迷雾、道路条等需要无缝平铺的图。

度量：把图错位半幅拼接后，原来的边缘在中间相接；比较这条接缝两侧相邻像素的差与图内部相邻像素差的平均值。
可平铺的图比值接近 1；整条缝的比值 > --max-ratio 或任意一段 > --max-segment 即报错。
顺带输出平均色的 OKLCh；底纸彩度 C > --max-chroma 给警告（底纸要低饱和，季节染色叠在上面）。
另查明暗渐变与暗角（底纸要求无方向光，游戏会旋转它）。

用法：
    python3 tools/art/check_tile.py art/region/raw/terrain.ground.*.png
    python3 tools/art/check_tile.py --strip art/region/raw/region.road.png      # 只查左右拼接
    python3 tools/art/check_tile.py --preview /tmp/tiles art/region/raw/terrain.ground.lake.png   # 另存 3×3 平铺图与 64px 缩略图供目视
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

import artlib as al


def check(img: np.ndarray, name: str, rep: al.Report, *, strip: bool = False, max_ratio: float = 1.6,
          max_segment: float = 2.6, max_chroma: float | None = 0.10, max_gradient: float = 0.05) -> dict:
    """检查一张图，返回度量值；问题写进 rep。"""
    has_alpha = img.shape[2] == 4 and img[..., 3].min() < 0.99
    if has_alpha:
        a = img[..., 3:4]
        data = np.concatenate([img[..., :3] * a, a], axis=-1)     # 预乘后比较，透明区的颜色不算数
    else:
        data = img[..., :3]
    res: dict = {}
    for axis in (("x",) if strip else ("x", "y")):
        s = al.seam_stats(data, axis)
        res[axis] = s
        where = "左右" if axis == "x" else "上下"
        if s["ratio"] > max_ratio or s["segment"] > max_segment:
            rep.error(name, f"{where}平铺", f"接缝差 / 内部差 = {s['ratio']:.2f}（上限 {max_ratio}），"
                                         f"最差一段 {s['segment']:.2f}（上限 {max_segment}）；{where}两边拼起来会看到缝")
        else:
            rep.info(name, f"{where}平铺", f"接缝比 {s['ratio']:.2f}，最差一段 {s['segment']:.2f}")

    w = img[..., 3] if has_alpha else None
    L, C, h = al.mean_oklch(img[..., :3], w)
    res["oklch"] = (L, C, h)
    rep.info(name, "平均色", f"OKLCh L={L:.3f} C={C:.3f} h={h:.0f}°")
    if max_chroma is not None and C > max_chroma:
        rep.warn(name, "彩度", f"平均色彩度 C={C:.3f} > {max_chroma}；底纸应低饱和，季节色由运行时染色叠加")

    if not strip and not has_alpha:
        lab_L = al.srgb_to_oklab(img[..., :3])[..., 0]
        H, W = lab_L.shape
        lr = abs(lab_L[:, : W // 2].mean() - lab_L[:, W // 2:].mean())
        tb = abs(lab_L[: H // 2].mean() - lab_L[H // 2:].mean())
        ring = np.ones_like(lab_L, dtype=bool)
        ry, rx = H // 8, W // 8
        ring[ry:-ry, rx:-rx] = False
        vig = lab_L[~ring].mean() - lab_L[ring].mean()
        res["gradient"] = (lr, tb, vig)
        if max(lr, tb) > max_gradient:
            rep.warn(name, "明暗渐变", f"左右 / 上下两半的明度差 {lr:.3f} / {tb:.3f}（> {max_gradient}），疑似方向光或渐变；旋转使用时会穿帮")
        if vig > max_gradient:
            rep.warn(name, "暗角", f"中心比四周亮 {vig:.3f}，疑似暗角")
    return res


def preview(img: np.ndarray, out_dir: Path, stem: str, strip: bool) -> None:
    tiled = np.tile(img, (1, 3, 1) if strip else (3, 3, 1))
    al.save_image(tiled, out_dir / f"{stem}.tile.png")
    h = 64 if not strip else 16
    w = int(round(img.shape[1] * h / img.shape[0]))
    small = al.resize_tile(img, w, h, axes="x" if strip else "xy")
    al.save_image(small, out_dir / f"{stem}.small.png")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", type=Path, help="图片文件或目录")
    ap.add_argument("--strip", action="store_true", help="横向长条：只查左右拼接，不查上下、不查渐变")
    ap.add_argument("--max-ratio", type=float, default=1.6, help="整条接缝的比值上限（默认 1.6）")
    ap.add_argument("--max-segment", type=float, default=2.6, help="接缝分 8 段后任一段的比值上限（默认 2.6）")
    ap.add_argument("--max-chroma", type=float, default=0.10, help="平均色彩度上限，超过给警告（默认 0.10）")
    ap.add_argument("--no-chroma", action="store_true", help="不查彩度（道路、遮罩等）")
    ap.add_argument("--max-gradient", type=float, default=0.05, help="明暗渐变 / 暗角的明度差上限（默认 0.05）")
    ap.add_argument("--preview", type=Path, help="把 3×3 平铺图与 64px 缩略图写到这个目录，供目视")
    ap.add_argument("--quiet", action="store_true", help="不打印「信息」级条目")
    args = ap.parse_args(argv)

    files: list[Path] = []
    for p in args.inputs:
        files += sorted(f for f in p.iterdir() if f.suffix.lower() in al.IMG_EXTS) if p.is_dir() else [p]
    rep = al.Report()
    for f in files:
        name = al.rel(f)
        if not f.exists():
            rep.error(name, "缺图", "文件不存在")
            continue
        img = al.load_rgba(f)
        check(img, name, rep, strip=args.strip, max_ratio=args.max_ratio, max_segment=args.max_segment,
              max_chroma=None if args.no_chroma else args.max_chroma, max_gradient=args.max_gradient)
        if args.preview:
            preview(img, args.preview, f.stem, args.strip)
    rep.print(quiet=args.quiet)
    return rep.exit_code()


if __name__ == "__main__":
    sys.exit(main())
