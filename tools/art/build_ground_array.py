#!/usr/bin/env python3
"""地形底纸纹理数组（M3-WO3 §6.5）：18 张底纸缩到清单的 layerSize（768²；high 档用 --size 1024，只出逐层文件、发版转 KTX2），按 TerrainType 的固定顺序输出编号文件与 ground.json。

层号顺序取清单里 kind=ground 项的 layer 字段（= PLAN §3.6 的 TerrainType 顺序，聚居 5 类共用最后一层）。
缩放时按回卷方式补边，缩完仍可平铺；缩完再跑一遍平铺检查与彩度检查。
另可输出一张竖向长图（512 × 512·层数），运行时一次请求、一次解码即可建 DataArrayTexture。

用法：
    python3 tools/art/build_ground_array.py                         # 读 art/region/raw，写 content/base/art/region/ground/
    python3 tools/art/build_ground_array.py --strip                 # 另出 ground-strip.webp
    python3 tools/art/build_ground_array.py --allow-missing         # 缺图的层用占位纯色补上（开发期）
    python3 tools/art/build_ground_array.py --heal                  # 平铺不过关时自动做错位混合修补（会有轻微重影，救急用）
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

import artlib as al
import check_tile

# PLAN §3.6 TerrainType：17 种自然地形 + 5 种聚居（共用 settlement 层）
NATURAL = ("plain", "lake", "farmland", "woods", "jungle", "garden", "mountain", "cave", "stoneForest",
           "hill", "vale", "mulberry", "canyon", "marsh", "herbGarden", "waste", "abyss")
SETTLEMENTS = ("city", "sectSeat", "town", "fort", "village")


def build(items: list[dict], src: Path, out_dir: Path, rep: al.Report, *, size: int = 512, strip: bool = False,
          allow_missing: bool = False, heal: bool = False, quality: int = 90) -> dict | None:
    grounds = sorted((it for it in items if it.get("kind") == "ground"), key=lambda it: it["layer"])
    layers = [it["layer"] for it in grounds]
    if layers != list(range(len(grounds))):
        rep.error("清单", "层号", f"底纸的 layer 应为 0..{len(grounds) - 1} 连续不重复，现为 {layers}")
        return None
    order = [it["terrain"] for it in grounds]
    if tuple(order[: len(NATURAL)]) != NATURAL or order[len(NATURAL):] != ["settlement"]:
        rep.error("清单", "层序", f"底纸层序应为 PLAN §3.6 的 17 种自然地形 + settlement，现为 {order}")
        return None

    out_layers = []
    stack = []
    for it in grounds:
        key = it["artKey"]
        p = al.find_image(src, key)
        if p is None:
            if not allow_missing:
                rep.error(key, "缺图", f"{al.rel(src)} 里没有这张底纸")
                continue
            rep.warn(key, "缺图", "用占位纯色补层")
            hue = (it["layer"] * 0.61803) % 1.0
            col = np.array([0.55 + 0.15 * np.cos(2 * np.pi * (hue + k / 3)) for k in range(3)], dtype=np.float32)
            img = np.ones((size, size, 3), dtype=np.float32) * col
        else:
            src_img = al.load_rgba(p)
            if src_img[..., 3].min() < 0.99:
                rep.warn(key, "透明", "底纸应不透明；透明部分按黑色处理")
            img = src_img[..., :3] * src_img[..., 3:4]
            h, w = img.shape[:2]
            if h != w:
                rep.error(key, "画幅", f"底纸应为正方形，实际 {w}×{h}")
                continue
            pre = al.Report()
            check_tile.check(img, key, pre, max_chroma=None)
            if not pre.ok and heal:
                img = al.heal_tile(img)
                rep.warn(key, "修补", "原图平铺不过关，已做错位混合修补；请目视确认重影可以接受，最好重新出图")
            img = al.resize_tile(img, size, size)
        check_tile.check(img, key, rep)
        name = f"{it['layer']:02d}-{it['terrain']}.webp"
        al.save_image(img, out_dir / name, quality=quality)
        stack.append(img)
        out_layers.append({"layer": it["layer"], "terrain": it["terrain"], "artKey": key, "file": name,
                           "noRotate": bool(it.get("noRotate", False))})
    if not rep.ok:
        return None

    terrain_to_layer = {t: i for i, t in enumerate(NATURAL)}
    terrain_to_layer.update({s: len(NATURAL) for s in SETTLEMENTS})
    meta = {"size": size, "count": len(out_layers), "layers": out_layers, "terrainToLayer": terrain_to_layer}
    if strip and size * len(stack) > 16383:
        rep.error("ground-strip", "WebP 尺寸上限", f"长图 {size}×{size * len(stack)} 超过 WebP 的 16383 像素上限；减小 --size 或不出长图")
    elif strip:
        al.save_image(np.concatenate(stack, axis=0), out_dir / "ground-strip.webp", quality=quality)
        meta["strip"] = "ground-strip.webp"
    al.write_json(out_dir / "ground.json", meta)
    mb = size * size * 4 * 1.33 * len(out_layers) / 2**20
    rep.info("ground", "完成", f"{len(out_layers)} 层 {size}²，显存约 {mb:.1f}MB（RGBA8 + mipmap）")
    return meta


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", type=Path, default=al.DEFAULT_LIST, help="素材清单（默认 tools/art/region-assets.json）")
    ap.add_argument("--src", type=Path, default=al.RAW_DIR, help="底纸原图目录（默认 art/region/raw）")
    ap.add_argument("--out", type=Path, default=al.ART_ROOT / "region" / "ground", help="输出目录（默认 content/base/art/region/ground）")
    ap.add_argument("--size", type=int, help="每层边长（默认取清单里的 layerSize，没有则 512）")
    ap.add_argument("--strip", action="store_true", help="另输出竖向长图 ground-strip.webp")
    ap.add_argument("--allow-missing", action="store_true", help="缺图的层用占位纯色补上")
    ap.add_argument("--heal", action="store_true", help="平铺不过关时做错位混合修补")
    ap.add_argument("--quality", type=int, default=90, help="WebP 质量（默认 90）")
    ap.add_argument("--quiet", action="store_true", help="不打印「信息」级条目")
    args = ap.parse_args(argv)

    rep = al.Report()
    items = al.load_list(args.list)
    size = args.size or next((it["layerSize"] for it in items if it.get("kind") == "ground" and it.get("layerSize")), 512)
    build(items, args.src, args.out, rep, size=size, strip=args.strip,
          allow_missing=args.allow_missing, heal=args.heal, quality=args.quality)
    rep.print(quiet=args.quiet)
    return rep.exit_code()


if __name__ == "__main__":
    sys.exit(main())
