#!/usr/bin/env python3
"""立牌抠像与清理（M3-WO3 §6.2）：品红底或已透明的原图 → 直通 alpha 的干净剪影。

步骤：判别背景 → 品红抠像并去溢色 → 去掉游离噪点 → 检查是否被画幅裁切、是否有半透明落影 →
裁掉四周空白（留 --margin 像素）→ 底边接触检查 → 按距离场羽化边缘（≥ 2px）→ 边缘颜色向透明区外扩。

用法：
    python3 tools/art/key_alpha.py art/region/raw/terrain.standee.plain.0.png
    python3 tools/art/key_alpha.py --list tools/art/region-assets.json          # 处理清单里所有立牌（读 art/region/raw）
    python3 tools/art/key_alpha.py --strip art/region/raw/region.road.png        # 长条：只裁上下，不查底边
输出写到 --out（默认 art/region/work/<同名>.png）。有错误的图不写出，退出码为 1。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

import artlib as al


def process(img: np.ndarray, name: str, rep: al.Report, *, mode: str = "auto", strip: bool = False,
            flat: bool = False, feather: float = 2.0, margin: int = 4, bleed_px: int = 8,
            min_contact: float = 0.10, expect_aspect: float | None = None) -> np.ndarray | None:
    """处理一张图；返回 RGBA（float32）或 None（有错误）。问题写进 rep。"""
    H, W = img.shape[:2]
    bg = al.detect_background(img) if mode == "auto" else mode
    if bg == "checker":
        rep.error(name, "背景", "背景是画出来的灰白棋盘格，不是真透明；请重新出图（透明底或纯品红 #FF00FF 底）")
        return None
    if bg == "opaque":
        rep.error(name, "背景", "背景既不透明也不是品红；请重新出图（透明底或纯品红 #FF00FF 底）")
        return None
    if bg == "magenta":
        alpha, rgb = al.key_magenta(img[..., :3])
        if img[..., 3].min() < 1.0:
            alpha = np.minimum(alpha, img[..., 3])
    else:
        alpha, rgb = img[..., 3].copy(), img[..., :3].copy()
        # 透明底的图偶尔也带一圈品红或灰黑溢色：对半透明像素做一次品红判别
        mag = (np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]) > 0.5
        alpha[mag & (alpha < 0.9)] = 0.0

    # 去掉游离噪点：开运算去 1–2px 的点，再丢掉很小的连通块
    solid = alpha > 0.05
    opened = al.dilate(al.erode(solid))
    alpha = np.where(opened, alpha, 0.0)
    small = alpha[::4, ::4] > 0.5
    if small.any():
        lab, sizes = al.label_components(small)
        main = max(sizes.values())
        tiny = [i for i, s in sizes.items() if s < main * 0.003]
        loose = [i for i, s in sizes.items() if main * 0.003 <= s < main and not strip]
        if tiny:
            kill = np.isin(lab, tiny)
            kill_full = np.repeat(np.repeat(kill, 4, 0), 4, 1)[:H, :W]
            alpha = np.where(kill_full, 0.0, alpha)
        if len(loose) > 0 and not flat:
            pct = sum(sizes[i] for i in loose) / main * 100
            rep.warn(name, "完整剪影", f"除主体外还有 {len(loose)} 块分离的部分（合计约主体的 {pct:.0f}%）；"
                                     "立牌应是一整块剪影，请目视确认不是背景残留")

    box = al.trim_box(alpha)
    if box is None:
        rep.error(name, "空图", "抠像后没有任何不透明像素（背景判别可能错了）")
        return None
    x0, y0, x1, y1 = box
    edge_tol = 2
    if not strip:
        cut = [s for s, hit in (("左", x0 <= edge_tol), ("右", x1 >= W - edge_tol), ("上", y0 <= edge_tol)) if hit]
        if flat and y1 >= H - edge_tol:
            cut.append("下")
        if cut:
            rep.error(name, "完整入画", f"主体贴着画幅的{'、'.join(cut)}边，可能被裁切；prompt 要求四周留约 8% 空白")
        if (y1 - y0) < 0.35 * H and (x1 - x0) < 0.35 * W:
            rep.warn(name, "主体太小", f"主体只占画幅 {(x1 - x0) / W:.0%} × {(y1 - y0) / H:.0%}，缩到图集尺寸后细节会不足")

    # 半透明落影：主体下部、离实色主体 2px 以外，有大片「半透明且很暗」的像素
    if not strip and not flat:
        shadow = shadow_pixels(img, bg)
        bh = y1 - y0
        band = np.zeros_like(shadow)
        band[y0 + int(bh * 0.7): min(y1 + int(bh * 0.1), H), :] = True
        n = int((shadow & band).sum())
        body = max(int((alpha[y0:y1, x0:x1] >= 0.5).sum()), 1)
        if n > body * 0.015:
            rep.error(name, "落影", f"主体下部有大片半透明的暗色像素（约主体面积的 {n / body:.1%}），"
                                  "疑似画了落在地上的影子或暗色晕；影子由游戏实时生成，请重新出图")

    if strip:
        x0, x1 = 0, W
    x0 = max(x0 - margin, 0) if not strip else 0
    y0 = max(y0 - margin, 0)
    x1 = min(x1 + margin, W) if not strip else W
    y1 = min(y1 + margin, H)
    rgb = rgb[y0:y1, x0:x1]
    alpha = alpha[y0:y1, x0:x1]

    if not strip and not flat:
        contact = bottom_contact(alpha)
        if contact < min_contact * 0.5:
            rep.error(name, "底边", f"贴着底边的部分只占剪影宽度的 {contact:.0%}；主体可能悬空、倾斜或只有一个尖角着地")
        elif contact < min_contact:
            rep.warn(name, "底边", f"贴着底边的部分只占剪影宽度的 {contact:.0%}（建议 ≥ {min_contact:.0%}），请目视确认能「立住」")
        if expect_aspect:
            ab = al.trim_box(alpha, 0.5)
            if ab:
                actual = (ab[2] - ab[0]) / max(ab[3] - ab[1], 1)
                if abs(np.log(actual / expect_aspect)) > np.log(1.3):
                    rep.warn(name, "宽高比", f"剪影宽高比 {actual:.2f}，清单期望 {expect_aspect:.2f}；"
                                          "打图集时以实际宽高比为准，立起来的宽度会随之变化")

    if al.measure_feather(alpha) < feather:
        alpha = al.feather_alpha(alpha, feather)
    rgb = al.bleed(rgb, alpha, iterations=bleed_px)
    if bg == "magenta":
        mag_left = ((np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]) > 0.55) & (alpha > 0.1)
        if mag_left.sum() > alpha.size * 0.001:
            rep.warn(name, "品红残留", f"剪影内还有 {mag_left.sum()} 个偏品红的像素；主体可能用了品红色，请目视确认")
    rep.info(name, "完成", f"{bg} 底，输出 {alpha.shape[1]}×{alpha.shape[0]}，边缘羽化 {al.measure_feather(alpha):.1f}px")
    return np.concatenate([rgb, alpha[..., None]], axis=-1)


def shadow_pixels(img: np.ndarray, bg: str) -> np.ndarray:
    """原图里像「半透明暗色」的像素：品红底上是变暗的品红（R≈B、G≈0、不够亮），透明底上是半透明且很暗。
    贴着实色主体 2px 以内的不算（那是正常的抗锯齿边缘）。"""
    rgb, a = img[..., :3], img[..., 3]
    if bg == "magenta":
        m = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
        hi = np.maximum(rgb[..., 0], rgb[..., 2])
        cand = (np.abs(rgb[..., 0] - rgb[..., 2]) < 0.15) & (rgb[..., 1] < 0.15) & (hi > 0.08) & (hi < 0.82)
        solid = m < 0.2
    else:
        cand = (a > 0.05) & (a < 0.85) & (al.luminance(rgb) < 0.3)
        solid = a >= 0.85
    near = al.dilate(al.dilate(solid))
    return cand & ~near


def bottom_contact(alpha: np.ndarray) -> float:
    """剪影最低处那一行附近（容差 max(2px, 1.5% 高)）的列数 / 剪影总宽。"""
    solid = alpha >= 0.5
    cols = np.nonzero(solid.any(0))[0]
    if len(cols) == 0:
        return 0.0
    h = solid.shape[0]
    lowest = np.where(solid.any(0), h - 1 - np.argmax(solid[::-1], axis=0), -1)
    yb = lowest.max()
    tol = max(2, int(round(0.015 * h)))
    return float((lowest >= yb - tol).sum() / (cols.max() - cols.min() + 1))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="*", type=Path, help="图片文件或目录")
    ap.add_argument("--list", type=Path, help="素材清单；给出时处理清单里所有 kind=standee 与 kind=flat（地面散件，按平放件处理）的项（在 --src 里按 artKey 找图）")
    ap.add_argument("--src", type=Path, default=al.RAW_DIR, help="配合 --list 的原图目录（默认 art/region/raw）")
    ap.add_argument("--out", type=Path, default=al.WORK_DIR, help="输出目录（默认 art/region/work）")
    ap.add_argument("--mode", choices=("auto", "magenta", "alpha"), default="auto", help="背景类型，默认自动判别")
    ap.add_argument("--strip", action="store_true", help="横向长条：不裁左右、不查底边与落影")
    ap.add_argument("--flat", action="store_true", help="平放件（如边框角）：不查底边与落影")
    ap.add_argument("--feather", type=float, default=2.0, help="边缘 alpha 羽化宽度（像素，≥ 2，默认 2）")
    ap.add_argument("--margin", type=int, default=4, help="裁边后四周保留的透明像素（默认 4）")
    ap.add_argument("--bleed", type=int, default=8, help="边缘颜色外扩圈数（默认 8）")
    ap.add_argument("--min-contact", type=float, default=0.10, help="底边接触宽度占比的建议下限（默认 0.10；低于一半即报错）")
    ap.add_argument("--quiet", action="store_true", help="不打印「信息」级条目")
    args = ap.parse_args(argv)

    if args.feather < al.MIN_FEATHER:
        print(f"--feather 不能小于 {al.MIN_FEATHER}", file=sys.stderr)
        return 2
    jobs: list[tuple[Path, str, float | None, bool]] = []
    rep = al.Report()
    if args.list:
        for it in al.load_list(args.list):
            if it.get("kind") not in ("standee", "flat"):
                continue
            p = al.find_image(args.src, it["artKey"])
            if p is None:
                rep.warn(it["artKey"], "缺图", f"{al.rel(args.src)} 里没有这张原图")
                continue
            jobs.append((p, it["artKey"], it.get("aspect") if it["kind"] == "standee" else None, it["kind"] == "flat"))
    for p in args.inputs:
        if p.is_dir():
            jobs += [(f, f.stem, None, args.flat) for f in sorted(p.iterdir()) if f.suffix.lower() in al.IMG_EXTS]
        elif p.exists():
            jobs.append((p, p.stem, None, args.flat))
        else:
            rep.error(str(p), "缺图", "文件不存在")
    if not jobs and not rep.items:
        ap.print_help()
        return 2

    for path, stem, aspect, flat in jobs:
        name = al.rel(path)
        try:
            img = al.load_rgba(path)
        except Exception as e:  # noqa: BLE001 — 读图失败的原因直接报给人看
            rep.error(name, "读取", str(e))
            continue
        out = process(img, name, rep, mode=args.mode, strip=args.strip, flat=flat, feather=args.feather,
                      margin=args.margin, bleed_px=args.bleed, min_contact=args.min_contact, expect_aspect=aspect)
        if out is not None and not any(i[0] == "错误" and i[1] == name for i in rep.items):
            al.save_image(out, args.out / f"{stem}.png")
    rep.print(quiet=args.quiet)
    return rep.exit_code()


if __name__ == "__main__":
    sys.exit(main())
