#!/usr/bin/env python3
"""拼图出图（2026-11-25 用户定）：同类小件由 GPT 画在一张 cols×rows 的拼图上，这里按格切成单张，交给原有流水线。

批次列表（tools/art/batches/<批次>.txt）里一行一张拼图：
    @sheet <拼图名> <列>x<行> <artKey>,<artKey>,…        # 按从左到右、从上到下的顺序；空格写 -
出图方把拼图存为 assets/art-source/region/<批次>/sheet.<拼图名>.png（透明底或纯品红底）。
切出的单张写到同目录的 sheet-cut/<artKey>.png；**同目录里另有 <artKey>.png 时以它为准**（某一件单独补出时用）。

每格的检查：
- 空格：该格里没有画东西（或者画到了别的格）→ 错误；写了 - 的格里却有东西 → 警告。
- 越格：物体碰到了格线（离格边不到 GAP 像素）→ 错误，可能和邻格粘连或被切掉一块。
- 比例：拼图要求按同一比例画，这里用「像素高 ÷ 清单里的高」和整张拼图的中位数比，偏差超过 SCALE_TOL → 警告。
切出的单张：物体居中放在正方形画布上，四周留约 8%，背景与拼图相同（透明或品红）；之后照常走 key_alpha。

用法：
    python3 tools/art/split_sheet.py --batch tools/art/batches/batch6.txt --src assets/art-source/region/batch6
    python3 tools/art/split_sheet.py --sheet a.png --grid 4x3 --keys filler.rock.0,filler.rock.1,… --out /tmp/cut
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

import artlib as al

GAP = 3            # 物体离格线的最小像素距离
MIN_FILL = 0.002   # 格内前景像素少于格面积的这个比例 = 空格
MARGIN = 0.08      # 切出单张的四周留白
SCALE_TOL = 0.30   # 同一拼图内比例偏差的容差


def parse_grid(s: str) -> tuple[int, int]:
    c, r = s.lower().split("x")
    return int(c), int(r)


def foreground(img: np.ndarray, name: str, rep: al.Report) -> tuple[np.ndarray, str] | None:
    bg = al.detect_background(img)
    if bg in ("checker", "opaque"):
        rep.error(name, "背景", "拼图背景既不是透明也不是纯品红 #FF00FF；请重新出图")
        return None
    if bg == "magenta":
        alpha, _ = al.key_magenta(img[..., :3])
        if img[..., 3].min() < 1.0:
            alpha = np.minimum(alpha, img[..., 3])
    else:
        alpha = img[..., 3]
    return alpha > 0.5, bg


def split(img: np.ndarray, cols: int, rows: int, keys: list[str], rep: al.Report, name: str,
          heights: dict[str, float] | None = None) -> dict[str, np.ndarray]:
    """返回 artKey → 单张 RGBA（float32）。有错误的格不返回。"""
    if len(keys) != cols * rows:
        rep.error(name, "格数", f"{cols}x{rows} 应有 {cols * rows} 格，列了 {len(keys)} 个（空格写 -）")
        return {}
    fg = foreground(img, name, rep)
    if fg is None:
        return {}
    mask, bg = fg
    H, W = mask.shape
    xs = [round(W * i / cols) for i in range(cols + 1)]
    ys = [round(H * j / rows) for j in range(rows + 1)]
    fill = np.array([1.0, 0.0, 1.0, 1.0], np.float32) if bg == "magenta" else np.zeros(4, np.float32)
    out, scale = {}, {}
    for j in range(rows):
        for i in range(cols):
            k = keys[j * cols + i]
            x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
            cell = mask[y0:y1, x0:x1]
            where = f"第 {j + 1} 行第 {i + 1} 格"
            if cell.sum() < MIN_FILL * cell.size:
                if k != "-":
                    rep.error(k, "空格", f"{where}里没有画东西（可能画错了格、或和邻格的画在了一起）")
                continue
            if k == "-":
                rep.warn(name, "多余", f"{where}标为空格，却画了东西；已忽略")
                continue
            edge = np.zeros_like(cell)
            edge[:GAP, :] = edge[-GAP:, :] = True
            edge[:, :GAP] = edge[:, -GAP:] = True
            if (cell & edge).any():
                sides = [s for s, m in (("上", cell[:GAP].any()), ("下", cell[-GAP:].any()),
                                        ("左", cell[:, :GAP].any()), ("右", cell[:, -GAP:].any())) if m]
                rep.error(k, "越格", f"{where}的物体碰到了{'、'.join(sides)}格线，可能和邻格粘连或被切掉；请重出这一张拼图，或单独补出这一件")
                continue
            yy, xx = np.nonzero(cell)
            by0, by1, bx0, bx1 = yy.min(), yy.max() + 1, xx.min(), xx.max() + 1
            h, w = by1 - by0, bx1 - bx0
            side = int(np.ceil(max(h, w) / (1 - 2 * MARGIN)))
            canvas = np.broadcast_to(fill, (side, side, 4)).copy()
            oy, ox = (side - h) // 2, (side - w) // 2
            canvas[oy:oy + h, ox:ox + w] = img[y0 + by0:y0 + by1, x0 + bx0:x0 + bx1]
            out[k] = canvas
            if heights and heights.get(k):
                scale[k] = h / heights[k]
    if len(scale) >= 3:
        med = float(np.median(list(scale.values())))
        for k, s in scale.items():
            if abs(s / med - 1) > SCALE_TOL:
                rep.warn(k, "比例", f"相对同一拼图里的其他件画得{'偏大' if s > med else '偏小'}约 {abs(s / med - 1):.0%}"
                                    "（拼图要求按同一比例画）；游戏里按清单的高缩放，影响的是细节密度，目视确认即可")
    return out


def read_sheets(batch: Path) -> list[tuple[str, int, int, list[str]]]:
    sheets = []
    for line in batch.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line.startswith("@sheet"):
            _, sid, grid, keys = line.split(None, 3)
            c, r = parse_grid(grid)
            sheets.append((sid, c, r, [k.strip() for k in keys.split(",")]))
    return sheets


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--batch", type=Path, help="批次列表；按其中的 @sheet 行切")
    ap.add_argument("--src", type=Path, help="配 --batch：批次原图目录（拼图在这里，切出的写到 sheet-cut/）")
    ap.add_argument("--sheet", type=Path, help="单张拼图")
    ap.add_argument("--grid", help="配 --sheet：列x行，如 4x3")
    ap.add_argument("--keys", help="配 --sheet：逗号分隔的 artKey，空格写 -")
    ap.add_argument("--out", type=Path, help="配 --sheet：输出目录")
    ap.add_argument("--list", type=Path, default=al.DEFAULT_LIST, help="素材清单（读高度做比例检查）")
    a = ap.parse_args(argv)
    heights = {it["artKey"]: it.get("height") for it in al.load_list(a.list)}
    rep = al.Report()
    if a.batch:
        jobs = [(al.find_image(a.src, f"sheet.{sid}"), f"sheet.{sid}", c, r, keys) for sid, c, r, keys in read_sheets(a.batch)]
        out_dir = a.src / "sheet-cut"
    elif a.sheet and a.grid and a.keys and a.out:
        c, r = parse_grid(a.grid)
        jobs = [(a.sheet if a.sheet.is_file() else None, a.sheet.name, c, r, a.keys.split(","))]
        out_dir = a.out
    else:
        ap.error("要么给 --batch 与 --src，要么给 --sheet、--grid、--keys、--out")
    for p, label, c, r, keys in jobs:
        if p is None:
            print(f"== {label}：还没出，跳过")
            continue
        print(f"== {p.name}（{c}×{r}）")
        cuts = split(al.load_rgba(p), c, r, keys, rep, p.name, heights)
        out_dir.mkdir(parents=True, exist_ok=True)
        for k, im in cuts.items():
            al.save_image(im, out_dir / f"{k}.png")
        print(f"   切出 {len(cuts)} 张 → {al.rel(out_dir)}")
    rep.print()
    return 1 if rep.errors else 0


if __name__ == "__main__":
    sys.exit(main())
