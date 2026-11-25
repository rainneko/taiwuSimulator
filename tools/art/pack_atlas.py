#!/usr/bin/env python3
"""立牌打图集（M3-WO3 §6.4）：按清单把处理后的立牌缩到目标像素高，打成一张图集，
输出 WebP 和符合 M3-WO1 §2.6 `AtlasJson` 的 JSON。

每帧：在预乘空间缩放 → 按距离场重做边缘羽化（≥ --feather px，以图集分辨率为准）→ 以 --padding 间距排布 →
整张图集做边缘颜色外扩（padding 区与远处透明区都填上邻近的实色，防 mipmap 渗色）。
帧名 = artKey；size = [高 × 实际宽高比, 高]（格宽 = 1）；anchor 取清单（默认底边中点 [0.5, 0]）。

用法：
    python3 tools/art/pack_atlas.py --atlas region/region-terrain
    python3 tools/art/pack_atlas.py --atlas region/region-locations --auto-scale
    python3 tools/art/pack_atlas.py --atlas region/region-terrain --dry-run      # 不读图，用清单的标称宽高比估算能否装下
输出：<--out>/<atlas>.webp 与 <--out>/<atlas>.json（默认 --out = content/base/art）。
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

import artlib as al


# ── 天际线装箱 ──────────────────────────────────────────────────────────────

class Skyline:
    """天际线（skyline bottom-left）装箱，坐标原点左上，y 向下。"""

    def __init__(self, w: int, h: int) -> None:
        self.w, self.h = w, h
        self.segs: list[list[int]] = [[0, 0, w]]   # [x, y, 宽]

    def _fit(self, i: int, w: int, h: int) -> int | None:
        x = self.segs[i][0]
        if x + w > self.w:
            return None
        y, rem, j = 0, w, i
        while rem > 0:
            if j >= len(self.segs):
                return None
            y = max(y, self.segs[j][1])
            if y + h > self.h:
                return None
            rem -= self.segs[j][2]
            j += 1
        return y

    def insert(self, w: int, h: int) -> tuple[int, int] | None:
        best = None
        for i in range(len(self.segs)):
            y = self._fit(i, w, h)
            if y is not None and (best is None or (y + h, self.segs[i][0]) < (best[1] + h, best[0])):
                best = (self.segs[i][0], y, i)
        if best is None:
            return None
        x, y, i = best
        self.segs.insert(i, [x, y + h, w])
        j = i + 1
        while j < len(self.segs):
            s = self.segs[j]
            end = x + w
            if s[0] < end:
                cut = end - s[0]
                if s[2] <= cut:
                    self.segs.pop(j)
                    continue
                s[0] += cut
                s[2] -= cut
            break
        k = 0
        while k < len(self.segs) - 1:      # 合并同高相邻段
            if self.segs[k][1] == self.segs[k + 1][1]:
                self.segs[k][2] += self.segs.pop(k + 1)[2]
            else:
                k += 1
        return x, y


def pack(sizes: list[tuple[str, int, int]], aw: int, ah: int, padding: int) -> dict[str, tuple[int, int]] | None:
    """sizes: (名, 宽, 高)。按高度降序放入；每帧占 (宽+padding, 高+padding)，帧左上 = 放置点 + padding/2。"""
    sky = Skyline(aw, ah)
    out: dict[str, tuple[int, int]] = {}
    half = padding // 2
    for name, w, h in sorted(sizes, key=lambda s: (-s[2], -s[1], s[0])):
        pos = sky.insert(w + padding, h + padding)
        if pos is None:
            return None
        out[name] = (pos[0] + half, pos[1] + half)
    return out


# ── 主流程 ──────────────────────────────────────────────────────────────────

def parse_size(s: str) -> tuple[int, int]:
    if "x" in s:
        w, h = s.lower().split("x")
        return int(w), int(h)
    return int(s), int(s)


def build_atlas(items: list[dict], atlas_id: str, src: Path, out_root: Path, rep: al.Report, *,
                size: tuple[int, int] = (2048, 2048), padding: int = 8, feather: float = 3.0, scale: float = 1.0,
                auto_scale: bool = False, dry_run: bool = False, fmt: str = "webp", quality: int = 92) -> dict | None:
    mine = [it for it in items if it.get("atlas") == atlas_id and it.get("kind") in ("standee", "flat")]
    if not mine:
        rep.error(atlas_id, "清单", "清单里没有属于这个图集的立牌")
        return None
    aw, ah = size
    sources: dict[str, np.ndarray] = {}
    aspects: dict[str, float] = {}
    for it in mine:
        key = it["artKey"]
        if dry_run:
            aspects[key] = float(it.get("aspect", 1.0))
            continue
        p = al.find_image(src, key)
        if p is None:
            rep.error(key, "缺图", f"{al.rel(src)} 里没有处理过的图（先跑 key_alpha.py）")
            continue
        img = al.load_rgba(p)
        box = al.trim_box(img[..., 3])
        if box is None:
            rep.error(key, "空图", "没有不透明像素")
            continue
        x0, y0, x1, y1 = box
        img = img[y0:y1, x0:x1]
        sources[key] = img
        aspects[key] = img.shape[1] / img.shape[0]
        want = it.get("aspect")
        if want and abs(math.log(aspects[key] / want)) > math.log(1.3):
            rep.warn(key, "宽高比", f"实际 {aspects[key]:.2f}，清单标称 {want:.2f}；立起来的宽度按实际算")
    if not rep.ok:
        return None

    def target(it: dict, sc: float) -> tuple[int, int]:
        h = max(8, int(round(it["height"] * it.get("pxPerUnit", 320) * sc)))
        w = max(8, int(round(h * aspects[it["artKey"]])))
        return w, h

    placed = None
    sc = scale
    while True:
        sizes = [(it["artKey"], *target(it, sc)) for it in mine]
        too_big = [n for n, w, h in sizes if w + padding > aw or h + padding > ah]
        placed = None if too_big else pack(sizes, aw, ah, padding)
        if placed is not None or not auto_scale or sc < 0.3:
            break
        sc *= 0.95
    if placed is None:
        need = sum((w + padding) * (h + padding) for _n, w, h in sizes)
        rep.error(atlas_id, "装不下", f"{len(sizes)} 帧共需约 {need / (aw * ah):.0%} 的面积（装箱一般只能用到 80–90%）；"
                                   f"加 --auto-scale 自动缩小像素密度，或改用更大的 --size，或拆图集")
        return None
    if sc != scale:
        rep.warn(atlas_id, "缩放", f"为装进 {aw}×{ah}，像素密度整体乘了 {sc:.2f}")
    used = sum((w + padding) * (h + padding) for _n, w, h in sizes)
    rep.info(atlas_id, "装箱", f"{len(sizes)} 帧，占面积 {used / (aw * ah):.0%}，缩放系数 {sc:.2f}")

    frames = []
    canvas = np.zeros((ah, aw, 4), dtype=np.float32)
    by_key = {it["artKey"]: it for it in mine}
    for name, w, h in sizes:
        it = by_key[name]
        x, y = placed[name]
        if not dry_run:
            fr = al.resize_rgba(sources[name], w, h)
            fr[..., 3] = al.feather_alpha(fr[..., 3], feather)
            f_meas = al.measure_feather(fr[..., 3])
            if f_meas < al.MIN_FEATHER:
                rep.error(name, "羽化", f"缩放后边缘羽化只有 {f_meas:.1f}px（< {al.MIN_FEATHER}）")
            canvas[y:y + h, x:x + w] = fr
        hm = float(it["height"])
        frames.append({
            "name": name,
            "rect": [x, y, w, h],
            "size": [round(hm * w / h, 4), round(hm, 4)],
            "anchor": [float(v) for v in it.get("anchor", [0.5, 0.0])],
        })
    frames.sort(key=lambda f: f["name"])
    verify_layout(frames, aw, ah, padding, rep, atlas_id)

    out_img = out_root / f"{atlas_id}.{fmt}"
    meta = {"image": out_img.name, "size": [aw, ah], "feather": feather, "padding": padding, "frames": frames}
    if dry_run:
        return meta
    rgb = al.bleed(canvas[..., :3], canvas[..., 3], iterations=padding + 4)
    canvas[..., :3] = rgb
    al.save_image(canvas, out_img, quality=quality)
    al.write_json(out_root / f"{atlas_id}.json", meta)
    if fmt == "webp":
        check_roundtrip(canvas, out_img, frames, rep, atlas_id)
    return meta


def verify_layout(frames: list[dict], aw: int, ah: int, padding: int, rep: al.Report, atlas_id: str) -> None:
    for f in frames:
        x, y, w, h = f["rect"]
        if x < 0 or y < 0 or x + w > aw or y + h > ah:
            rep.error(atlas_id, "越界", f"帧 {f['name']} 超出图集")
    for i, a in enumerate(frames):
        ax, ay, aw_, ah_ = a["rect"]
        for b in frames[i + 1:]:
            bx, by, bw, bh = b["rect"]
            gap_x = max(bx - (ax + aw_), ax - (bx + bw))
            gap_y = max(by - (ay + ah_), ay - (by + bh))
            if max(gap_x, gap_y) < padding:
                rep.error(atlas_id, "帧间距", f"{a['name']} 与 {b['name']} 的间距 < {padding}px")


def check_roundtrip(canvas: np.ndarray, path: Path, frames: list[dict], rep: al.Report, atlas_id: str) -> None:
    """WebP 编码后透明区的颜色是否还在（exact 选项失效时外扩会被清成黑色）。"""
    back = al.load_rgba(path)
    # 统计所有帧矩形内「原本透明但做过颜色外扩」的像素，编码后颜色还在的比例（单点探针会落在外扩半径外的空白里误报）
    m = np.zeros(canvas.shape[:2], bool)
    for f in frames:
        x, y, w, h = f["rect"]
        m[y:y + h, x:x + w] = True
    sel = m & (canvas[..., 3] < 0.02) & (canvas[..., :3].max(-1) > 0.1)
    kept = (back[sel][:, :3].max(-1) > 0.02).mean() if sel.any() else 1.0
    if kept < 0.5:
        rep.error(atlas_id, "WebP 外扩丢失", "编码后透明区的颜色被清零（本机 Pillow / libwebp 不支持 exact）；请加 --format png")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--atlas", required=True, help="图集 id，如 region/region-terrain（与清单里的 atlas 字段一致）")
    ap.add_argument("--list", type=Path, default=al.DEFAULT_LIST, help="素材清单（默认 tools/art/region-assets.json）")
    ap.add_argument("--src", type=Path, default=al.WORK_DIR, help="处理过的立牌目录（默认 art/region/work）")
    ap.add_argument("--out", type=Path, default=al.ART_ROOT, help="输出根目录（默认 content/base/art）")
    ap.add_argument("--size", help="图集尺寸，如 2048 或 4096x2048（默认取清单里该图集的 atlasSize，没有则 2048）")
    ap.add_argument("--padding", type=int, default=8, help=f"帧间距像素（≥ {al.MIN_PADDING}，默认 8）")
    ap.add_argument("--feather", type=float, default=3.0, help=f"图集分辨率下的边缘羽化像素（≥ {al.MIN_FEATHER}，默认 3）")
    ap.add_argument("--scale", type=float, default=1.0, help="像素密度整体系数（默认 1）")
    ap.add_argument("--auto-scale", action="store_true", help="装不下时每次缩 5%% 直到装下")
    ap.add_argument("--dry-run", action="store_true", help="不读图、不写文件，用清单的标称宽高比估算装箱")
    ap.add_argument("--format", choices=("webp", "png"), default="webp", help="图集图片格式（默认 webp）")
    ap.add_argument("--quality", type=int, default=92, help="WebP 质量（默认 92；alpha 始终无损）")
    ap.add_argument("--quiet", action="store_true", help="不打印「信息」级条目")
    args = ap.parse_args(argv)

    if args.padding < al.MIN_PADDING or args.feather < al.MIN_FEATHER:
        print(f"--padding 须 ≥ {al.MIN_PADDING}，--feather 须 ≥ {al.MIN_FEATHER}", file=sys.stderr)
        return 2
    rep = al.Report()
    items = al.load_list(args.list)
    if args.size:
        size = parse_size(args.size)
    else:
        size = next((tuple(it["atlasSize"]) for it in items if it.get("atlas") == args.atlas and it.get("atlasSize")),
                    (2048, 2048))
    meta = build_atlas(items, args.atlas, args.src, args.out, rep, size=size,
                       padding=args.padding, feather=args.feather, scale=args.scale, auto_scale=args.auto_scale,
                       dry_run=args.dry_run, fmt=args.format, quality=args.quality)
    if meta and args.dry_run:
        aw, ah = meta["size"]
        print(json.dumps({"atlas": args.atlas, "size": meta["size"], "frames": len(meta["frames"]),
                          "vramMB": round(aw * ah * 4 * 1.33 / 2**20, 1)}, ensure_ascii=False))
    rep.print(quiet=args.quiet)
    return rep.exit_code()


if __name__ == "__main__":
    sys.exit(main())
