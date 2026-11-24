#!/usr/bin/env python3
"""装饰与遮罩的后处理（M3-WO3 §6.6）：道路纸带、迷雾浓度图、撕纸遮罩、地图边框条与边框角。

它们要用 RepeatWrapping 平铺或单独采样，不进图集，各自输出一张纹理和一份 decor.json。按清单的 mode 处理：
  strip-rgba  横向长条（道路、边框条）：抠像，只裁上下，缩到入库尺寸（左右回卷），查左右平铺，外扩
  gray-tile   灰度浓度图（迷雾）：取明度，拉伸到 0–1，缩放（四向回卷），查四向平铺
  gray-strip  灰度长条遮罩（撕纸边）：取明度，拉伸，缩放（左右回卷），查左右平铺，并查「上白下黑」
  flat-rgba   平放件（边框角）：抠像、裁边、缩放、外扩

用法：
    python3 tools/art/prep_decor.py                      # 读 art/region/raw，写 content/base/art/region/decor/
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

import artlib as al
import check_tile
import key_alpha


def stretch(gray: np.ndarray) -> np.ndarray:
    lo, hi = np.percentile(gray, 1), np.percentile(gray, 99)
    if hi - lo < 0.05:
        return gray
    return np.clip((gray - lo) / (hi - lo), 0, 1)


def process(it: dict, img: np.ndarray, rep: al.Report) -> np.ndarray | None:
    key, mode = it["artKey"], it["mode"]
    w, h = it["out"]
    if mode == "strip-rgba":
        keyed = key_alpha.process(img, key, rep, strip=True)
        if keyed is None:
            return None
        out = al.resize_tile(keyed, w, h, axes="x")
        out[..., 3] = al.feather_alpha(out[..., 3], al.MIN_FEATHER)
        out[..., :3] = al.bleed(out[..., :3], out[..., 3], iterations=8)
        check_tile.check(out, key, rep, strip=True, max_chroma=None)
        return out
    if mode in ("gray-tile", "gray-strip"):
        rgb = img[..., :3]
        if (rgb.max(-1) - rgb.min(-1)).mean() > 0.08:
            rep.warn(key, "彩色", "这张应是灰度图，原图带明显颜色；已按明度转换")
        g = stretch(al.luminance(rgb).astype(np.float32))
        axes = "xy" if mode == "gray-tile" else "x"
        out = al.resize_tile(g, w, h, axes=axes)
        check_tile.check(out[..., None].repeat(3, -1), key, rep, strip=(mode == "gray-strip"), max_chroma=None,
                         max_gradient=1.0)
        if mode == "gray-strip":
            top, bottom = out[: h // 5].mean(), out[-h // 5:].mean()
            if top < 0.8 or bottom > 0.2:
                rep.error(key, "遮罩结构", f"应为上白下黑（上 1/5 均值 {top:.2f}，下 1/5 均值 {bottom:.2f}）")
        else:
            cover = (out > 0.5).mean()
            if not 0.3 <= cover <= 0.85:
                rep.warn(key, "云量", f"浓度 > 0.5 的面积占 {cover:.0%}（建议 30%–85%）")
        return out
    if mode == "flat-rgba":
        keyed = key_alpha.process(img, key, rep, flat=True)
        if keyed is None:
            return None
        kh, kw = keyed.shape[:2]
        s = min(w / kw, h / kh)
        nw, nh = max(1, round(kw * s)), max(1, round(kh * s))
        fr = al.resize_rgba(keyed, nw, nh)
        out = np.zeros((h, w, 4), dtype=np.float32)
        oy, ox = (h - nh) // 2, (w - nw) // 2
        out[oy:oy + nh, ox:ox + nw] = fr
        out[..., 3] = al.feather_alpha(out[..., 3], al.MIN_FEATHER)
        out[..., :3] = al.bleed(out[..., :3], out[..., 3], iterations=8)
        return out
    rep.error(key, "模式", f"未知的处理模式 {mode}")
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", type=Path, default=al.DEFAULT_LIST, help="素材清单（默认 tools/art/region-assets.json）")
    ap.add_argument("--src", type=Path, default=al.RAW_DIR, help="原图目录（默认 art/region/raw）")
    ap.add_argument("--out", type=Path, default=al.ART_ROOT / "region" / "decor", help="输出目录（默认 content/base/art/region/decor）")
    ap.add_argument("--quality", type=int, default=92, help="WebP 质量（默认 92）")
    ap.add_argument("--quiet", action="store_true", help="不打印「信息」级条目")
    args = ap.parse_args(argv)

    rep = al.Report()
    meta: dict[str, dict] = {}
    for it in al.load_list(args.list):
        if it.get("kind") != "decor":
            continue
        key = it["artKey"]
        p = al.find_image(args.src, key)
        if p is None:
            rep.error(key, "缺图", f"{al.rel(args.src)} 里没有这张图")
            continue
        out = process(it, al.load_rgba(p), rep)
        if out is None or any(i[0] == "错误" and i[1] == key for i in rep.items):
            continue
        name = f"{key}.webp"
        al.save_image(out, args.out / name, quality=args.quality)
        meta[key] = {"file": name, "size": list(it["out"]), "mode": it["mode"],
                     "channels": "L" if out.ndim == 2 else "RGBA"}
    if meta:
        al.write_json(args.out / "decor.json", {"decor": meta})
    rep.print(quiet=args.quiet)
    return rep.exit_code()


if __name__ == "__main__":
    sys.exit(main())
