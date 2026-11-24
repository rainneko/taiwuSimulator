#!/usr/bin/env python3
"""房屋部件图集（M3-WO3 v1.3 §3.12「折纸房屋」）：把清单 J 类的各面贴图打成一张图集 + 一份 JSON。

房子的形体由渲染侧 HouseBuilder 按参数搭成纸盒，这里只负责贴图：
  frame    不透明整帧（正立面、侧墙、烟囱、殿阁立面、台基）：按清单 size 的宽高比拉满到帧尺寸，四周按边缘颜色外扩
  tile-u   左右可平铺（屋面、檐口）：缩放时左右回卷；外扩时左右用对边像素环绕、上下按边缘颜色
  tile-uv  四边可平铺（素墙）：四向回卷缩放、四向环绕外扩
图集帧不能用 RepeatWrapping，所以屋面在几何上按「一个重复 = 一个四边形」细分，每个四边形映射到完整一帧；
环绕外扩保证 mipmap 采样跨过帧边时取到的是对边的内容，不会出现接缝线。帧的 uv 内缩半个纹素。

输出（默认 content/base/art/region/）：
  region-houses.webp   图集
  region-houses.json   { image, size, padding, feather: 0, opaque: true, pxPerUnit, frames: [...], houseTypes: {...} }
    frames[i] = { name, rect: [x, y, w, h], size: [宽, 高]（格）, wrap: ""|"u"|"uv", uv: [u0, v0, u1, v1] }
    uv 以图片左上为原点、v 向下（three 的 flipY 纹理里取 1 − v）。
    houseTypes = 第一期的房屋原型参数（硬山两坡；工单 §3.12.2），HouseBuilder 与 preview_grid.py 共用。

用法：
    python3 tools/art/build_house_kit.py                     # 读 art/region/raw/house.*.png
    python3 tools/art/build_house_kit.py --placeholders      # 全部用程序画的占位贴图（渲染侧先验证形体用）
    python3 tools/art/build_house_kit.py --allow-missing     # 缺的部件用占位补上
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import artlib as al
from pack_atlas import pack

ATLAS_ID = "region/region-houses"
PADDING = 8                      # 帧间距；每帧四周外扩 PADDING / 2

# 第一期房屋原型（格 = 1 单位）：硬山两坡。w 面宽、d 进深、wallH 墙高、pitch 屋面坡度（度）、
# overhang 出檐（相对面宽的比例，0.08–0.12）、base 台基高（殿阁）。walls / roofs 是可选的贴图组合。
HOUSE_TYPES = {
    "cottage": {"w": 0.22, "d": 0.20, "wallH": 0.15, "pitch": 38, "overhang": 0.10, "base": 0.0,
                "walls": ["earth", "plaster"], "roofs": ["thatch", "shingle"], "chimney": False},
    "house": {"w": 0.27, "d": 0.24, "wallH": 0.18, "pitch": 35, "overhang": 0.10, "base": 0.0,
              "walls": ["plaster", "brick"], "roofs": ["tile", "shingle"], "chimney": True},
    "long": {"w": 0.34, "d": 0.22, "wallH": 0.17, "pitch": 35, "overhang": 0.09, "base": 0.0,
             "walls": ["plaster", "earth", "brick"], "roofs": ["tile", "thatch"], "chimney": False},
    "hall": {"w": 0.36, "d": 0.30, "wallH": 0.24, "pitch": 30, "overhang": 0.12, "base": 0.10,
             "walls": ["hall"], "roofs": ["tile"], "chimney": False},
}


def ridge_height(t: dict) -> float:
    """屋脊离地高度：台基 + 墙高 + 半进深 × tan(坡度)。"""
    return t["base"] + t["wallH"] + t["d"] / 2 * math.tan(math.radians(t["pitch"]))


def roof_slope(t: dict) -> float:
    """一面屋面从屋脊到檐口的斜长（含出檐）。"""
    return (t["d"] / 2 + t["overhang"] * t["w"] * 0.5) / math.cos(math.radians(t["pitch"]))


# ── 占位贴图 ────────────────────────────────────────────────────────────────

WALL_COLOUR = {"plaster": (0.92, 0.89, 0.82), "earth": (0.76, 0.62, 0.44), "brick": (0.56, 0.58, 0.60),
               "hall": (0.70, 0.22, 0.18)}
ROOF_COLOUR = {"tile": (0.36, 0.40, 0.44), "thatch": (0.78, 0.66, 0.40), "shingle": (0.42, 0.30, 0.22)}
WOOD = (0.38, 0.25, 0.16)
STONE = (0.62, 0.62, 0.60)


def _material(key: str) -> str:
    for m in WALL_COLOUR:
        if f".{m}" in key:
            return m
    return "hall" if ".hall." in key else "plaster"


def placeholder_face(key: str, mode: str, w: int, h: int) -> np.ndarray:
    """程序画的占位面：颜色按材质，门窗画成色块；可平铺的保证对边一致。返回 RGB float (h, w, 3)。"""
    W, H = w * 2, h * 2
    if ".roof." in key:
        base = ROOF_COLOUR[key.rsplit(".", 1)[1]]
        im = Image.new("RGB", (W, H), tuple(int(c * 255) for c in base))
        d = ImageDraw.Draw(im)
        n = 6                                         # 横向 6 垄，整数个周期 → 左右可平铺
        for k in range(n):
            x = k * W / n
            d.line([(x, 0), (x, H)], fill=tuple(int(c * 200) for c in base), width=max(2, W // 80))
        for k in range(1, 5):
            d.line([(0, k * H / 5), (W, k * H / 5)], fill=tuple(int(c * 225) for c in base), width=max(1, W // 160))
        d.rectangle([0, H * 0.92, W, H], fill=tuple(int(c * 170) for c in base))     # 檐口一侧
    elif ".wall." in key:
        base = WALL_COLOUR[_material(key)]
        im = Image.new("RGB", (W, H), tuple(int(c * 255) for c in base))
        d = ImageDraw.Draw(im)
        if "brick" in key:
            rows = 8
            for r in range(rows):
                y = r * H / rows
                d.line([(0, y), (W, y)], fill=tuple(int(c * 200) for c in base), width=max(1, W // 200))
                for k in range(4):
                    x = (k + 0.5 * (r % 2)) * W / 4
                    d.line([(x, y), (x, y + H / rows)], fill=tuple(int(c * 200) for c in base), width=max(1, W // 200))
        elif "earth" in key:
            for r in range(1, 6):
                d.line([(0, r * H / 6), (W, r * H / 6)], fill=tuple(int(c * 215) for c in base), width=max(1, W // 150))
    elif key.endswith("chimney"):
        im = Image.new("RGB", (W, H), tuple(int(c * 255) for c in WALL_COLOUR["brick"]))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 0, W, H * 0.12], fill=tuple(int(c * 190) for c in WALL_COLOUR["brick"]))
    elif key.endswith("hall.eave"):
        im = Image.new("RGB", (W, H), (60, 110, 100))
        d = ImageDraw.Draw(im)
        for k in range(4):                            # 4 组斗拱，整数个周期
            x = (k + 0.5) * W / 4
            d.rectangle([x - W / 20, H * 0.1, x + W / 20, H * 0.75], fill=(150, 70, 50))
        d.rectangle([0, H * 0.75, W, H], fill=(120, 60, 45))
    elif key.endswith("hall.base"):
        im = Image.new("RGB", (W, H), tuple(int(c * 255) for c in STONE))
        d = ImageDraw.Draw(im)
        for k in range(3):
            y0 = H * (0.25 + 0.25 * k)
            d.rectangle([W * (0.4 - 0.03 * k), y0, W * (0.6 + 0.03 * k), y0 + H * 0.25],
                        outline=(110, 110, 105), width=max(1, H // 40))
    else:                                             # 正立面、侧墙、殿阁立面
        m = _material(key)
        base = WALL_COLOUR[m] if m != "hall" else (0.84, 0.80, 0.72)
        im = Image.new("RGB", (W, H), tuple(int(c * 255) for c in base))
        d = ImageDraw.Draw(im)
        d.rectangle([0, H * 0.86, W, H], fill=tuple(int(c * 255) for c in STONE))              # 墙裙
        if m == "hall":
            for k in range(4):
                x = (0.08 + 0.28 * k) * W
                d.rectangle([x, 0, x + W * 0.05, H], fill=tuple(int(c * 255) for c in WALL_COLOUR["hall"]))
        if ".facade." in key and m != "hall":
            dx = 0.5 if key.endswith(".0") else 0.3
            d.rectangle([W * (dx - 0.1), H * 0.35, W * (dx + 0.1), H * 0.86], fill=tuple(int(c * 255) for c in WOOD))
        door = (0.5 if key.endswith(".0") else 0.3) if ".facade." in key and m != "hall" else None
        wins = [0.5] if ".side." in key else [x for x in (0.18, 0.5, 0.82) if door is None or abs(x - door) > 0.22]
        for cx in wins:
            d.rectangle([W * (cx - 0.07), H * 0.32, W * (cx + 0.07), H * 0.58], fill=(70, 60, 50))
        if m == "plaster":
            for x in (0.0, 1.0):
                d.rectangle([W * x - W * 0.025, 0, W * x + W * 0.025, H], fill=tuple(int(c * 255) for c in WOOD))
    arr = np.asarray(im.resize((w, h), Image.LANCZOS), np.float32) / 255.0
    return arr


# ── 处理与打包 ──────────────────────────────────────────────────────────────

def frame_px(it: dict, px: float) -> tuple[int, int]:
    w, h = it["size"]
    return max(8, int(round(w * px))), max(8, int(round(h * px)))


def process_face(img: np.ndarray, it: dict, w: int, h: int, rep: al.Report) -> np.ndarray:
    key, mode = it["artKey"], it["mode"]
    if img.shape[2] == 4 and float((img[..., 3] < 0.98).mean()) > 0.01:
        rep.error(key, "不透明", f"{(img[..., 3] < 0.98).mean():.0%} 的像素是透明的；房屋贴图应铺满整帧（工单 §3.12.3）")
    elif al.detect_background(img) == "magenta":
        rep.error(key, "不透明", "四周是品红底；房屋贴图应铺满整帧、不留背景")
    rgb = img[..., :3]
    src_aspect = rgb.shape[1] / rgb.shape[0]
    want = it["size"][0] / it["size"][1]
    if abs(src_aspect / want - 1) > 0.08:
        rep.warn(key, "宽高比", f"原图 {src_aspect:.2f}，清单 {want:.2f}，已拉伸到帧尺寸")
    axes = {"tile-u": "x", "tile-uv": "xy"}.get(mode, "")
    out = al.resize_tile(rgb, w, h, axes) if axes else np.asarray(
        Image.fromarray(al.to_u8(rgb), "RGB").resize((w, h), Image.LANCZOS), np.float32) / 255.0
    for ax in axes:
        st = al.seam_stats(out, "x" if ax == "x" else "y")
        if st["segment"] > 3.0:
            rep.error(key, "平铺", f"{'左右' if ax == 'x' else '上下'}接缝断层（段比值 {st['segment']:.1f} > 3）")
        elif st["segment"] > 2.0:
            rep.warn(key, "平铺", f"{'左右' if ax == 'x' else '上下'}接缝偏明显（段比值 {st['segment']:.1f}）")
    return out


def pad_frame(fr: np.ndarray, p: int, mode: str) -> np.ndarray:
    """帧四周外扩 p 像素：可平铺的方向用对边像素环绕，其余按边缘颜色。"""
    wx = mode in ("tile-u", "tile-uv")
    wy = mode == "tile-uv"
    fr = np.pad(fr, [(0, 0), (p, p), (0, 0)], mode="wrap" if wx else "edge")
    return np.pad(fr, [(p, p), (0, 0), (0, 0)], mode="wrap" if wy else "edge")


def build_kit(items: list[dict], src: Path | None, rep: al.Report, *, placeholders: bool = False,
              allow_missing: bool = False, size: tuple[int, int] | None = None) -> tuple[np.ndarray, dict] | None:
    parts = [it for it in items if it.get("kind") == "houseface"]
    if not parts:
        rep.error("清单", "房屋部件", "清单里没有 kind=houseface 的项（region_prompts.py 的 J 类）")
        return None
    aw, ah = size or tuple(parts[0].get("atlasSize", [2048, 1024]))
    px = float(parts[0].get("pxPerUnit", 768))
    sizes = [(it["artKey"], *frame_px(it, px)) for it in parts]
    placed = pack(sizes, aw, ah, PADDING)
    if placed is None:
        rep.error(ATLAS_ID, "装不下", f"{len(sizes)} 帧装不进 {aw}×{ah}；减小 pxPerUnit 或加大图集")
        return None
    canvas = np.zeros((ah, aw, 3), np.float32)
    frames, half, real = [], PADDING // 2, 0
    for it in parts:
        key, mode = it["artKey"], it["mode"]
        w, h = frame_px(it, px)
        x, y = placed[key]
        p = None if placeholders or src is None else al.find_image(src, key)
        if p is not None:
            fr = process_face(al.load_rgba(p), it, w, h, rep)
            real += 1
        else:
            if not (placeholders or allow_missing):
                rep.error(key, "缺图", f"{al.rel(src) if src else '—'} 里没有；加 --allow-missing 用占位补上")
            fr = placeholder_face(key, mode, w, h)
        canvas[y - half:y + h + half, x - half:x + w + half] = pad_frame(fr, half, mode)
        frames.append({"name": key, "rect": [x, y, w, h], "size": [float(v) for v in it["size"]],
                       "wrap": {"tile-u": "u", "tile-uv": "uv"}.get(mode, ""),
                       "uv": [round((x + 0.5) / aw, 6), round((y + 0.5) / ah, 6),
                              round((x + w - 0.5) / aw, 6), round((y + h - 0.5) / ah, 6)]})
    frames.sort(key=lambda f: f["name"])
    used = sum((w + PADDING) * (h + PADDING) for _n, w, h in sizes)
    rep.info(ATLAS_ID, "装箱", f"{len(frames)} 帧（真实 {real}、占位 {len(frames) - real}），占面积 {used / (aw * ah):.0%}")
    meta = {"image": Path(ATLAS_ID).name + ".webp", "size": [aw, ah], "padding": PADDING, "feather": 0, "opaque": True,
            "pxPerUnit": px, "frames": frames,
            "houseTypes": {k: {**v, "ridge": round(ridge_height(v), 4), "slope": round(roof_slope(v), 4)}
                           for k, v in HOUSE_TYPES.items()}}
    return canvas, meta


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", type=Path, default=al.DEFAULT_LIST, help="素材清单（默认 tools/art/region-assets.json）")
    ap.add_argument("--src", type=Path, default=al.RAW_DIR, help="原图目录（默认 art/region/raw；贴图不透明，不需要先抠像）")
    ap.add_argument("--out", type=Path, default=al.ART_ROOT, help="内容包 art 目录（默认 content/base/art）")
    ap.add_argument("--placeholders", action="store_true", help="全部用程序画的占位贴图")
    ap.add_argument("--allow-missing", action="store_true", help="缺的部件用占位贴图补上")
    ap.add_argument("--quality", type=int, default=92, help="WebP 质量（默认 92）")
    ap.add_argument("--quiet", action="store_true", help="不打印「信息」级条目")
    args = ap.parse_args(argv)

    rep = al.Report()
    res = build_kit(al.load_list(args.list), args.src, rep, placeholders=args.placeholders,
                    allow_missing=args.allow_missing)
    if res is not None and rep.ok:
        canvas, meta = res
        img = args.out / f"{ATLAS_ID}.webp"
        img.parent.mkdir(parents=True, exist_ok=True)
        al.save_image(canvas, img, quality=args.quality)
        al.write_json(args.out / f"{ATLAS_ID}.json", meta)
        rep.info(ATLAS_ID, "完成", f"已写入 {al.rel(img)} 与 {Path(ATLAS_ID).name}.json")
    rep.print(quiet=args.quiet)
    return rep.exit_code()


if __name__ == "__main__":
    sys.exit(main())
