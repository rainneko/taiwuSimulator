#!/usr/bin/env python3
"""拼图出图的分组：给一串小件 artKey，排成若干张拼图，输出批次列表要用的 @sheet 行与每格「画多大」。

分组规则（2026-11-25）：
1. 立牌（正面看）和平放件（俯视）**不进同一张**——视角不同，混在一起角度会乱。
2. 每件在游戏里需要的像素 = 清单的高 × pxPerUnit（宽 = 高 × 宽高比）；格子装不下的（竹篱、矮墙这类很宽的）
   换用宽格版式，再装不下就不进拼图、单独出。
3. **同材质连在一起**：按石、草木、竹木的顺序、同材质内从高到矮依次填格，多数情况下一行就是一种材质。材质表见 FAMILY，未列的归「其他」。
4. **同一张按同一比例画**：比例 s = 让最占地方的那件刚好填满格子的可用区（四周各留 8%），但不低于游戏里的
   像素密度（否则缩到游戏里细节不够）。每件的目标 = 「约占格高的几成」，写进工单给出图方。

版式（GPT 的画幅只有 1024² / 1536×1024 / 1024×1536 三种）：
    grid43   1536×1024，4 列 3 行，格 384×341   —— 一般小件（9–12 件）
    grid42   1536×1024，4 列 2 行，格 384×512   —— 7–8 件（格子更高）
    grid32   1536×1024，3 列 2 行，格 512×512   —— 平放件、偏大的件；5–6 件
    grid22   1536×1024，2 列 2 行，格 768×512   —— 3–4 件
    grid21   1536×1024，2 列 1 行，格 768×1024  —— 1–2 件
    件数少时换格子更少的版式：空格多了，出图方容易往空格里补东西（执行主管 2026-11-25）
    wide24   1024×1536，2 列 4 行，格 512×384   —— 很宽的件（8 件）

用法：
    python3 tools/art/sheet_plan.py filler.rock.0 filler.rock.1 …      # 打印分组与 @sheet 行
    python3 tools/art/sheet_plan.py --section H,E,I                     # 清单里某几段全部小件
"""
from __future__ import annotations

import argparse
import math
import re
import sys
from dataclasses import dataclass, field

import artlib as al

USABLE = 1 - 2 * 0.08
LAYOUTS = {   # 名: (画幅宽, 画幅高, 列, 行)
    "grid43": (1536, 1024, 4, 3),
    "grid42": (1536, 1024, 4, 2),
    "grid32": (1536, 1024, 3, 2),
    "grid22": (1536, 1024, 2, 2),
    "grid21": (1536, 1024, 2, 1),
    "wide24": (1024, 1536, 2, 4),
}
FAMILY_ORDER = ("石", "草木", "竹木", "地面", "其他")
FAMILY = {   # artKey 去掉前缀后的名字 → 材质
    "rock.0": "石", "rock.1": "石", "rock.2": "石", "stele": "石", "lantern": "石", "steps": "石", "wall": "石",
    "pebbles": "石", "cracks": "石",
    "bush.0": "草木", "bush.1": "草木", "fern": "草木", "tuft.0": "草木", "tuft.1": "草木", "reeds": "草木",
    "flowers.0": "草木", "flowers.1": "草木", "mushrooms": "草木", "thorn": "草木", "herbs": "草木", "pine": "草木",
    "tree": "草木", "grass": "草木", "moss": "草木", "leaves": "草木", "petals": "草木", "needles": "草木",
    "bamboo": "竹木", "log": "竹木", "stump": "竹木", "deadwood": "竹木", "fence": "竹木", "rack": "竹木",
    "dummy": "竹木", "poles": "竹木", "banner": "竹木", "roots": "竹木",
    "dirt": "地面", "puddle": "地面",
}


@dataclass
class Item:
    key: str
    kind: str
    height: float
    aspect: float
    ppu: float

    @property
    def family(self) -> str:
        return FAMILY.get(self.key.split(".", 1)[1].replace("prop.", "").replace("piece.", ""), "其他")

    def need(self) -> tuple[float, float]:          # 游戏里需要的像素（宽, 高）
        h = self.height * self.ppu
        return h * self.aspect, h


@dataclass
class Sheet:
    name: str
    layout: str
    grid: list[Item | None] = field(default_factory=list)   # 按格子顺序，None = 空格（行内留空，保证一行一种材质）

    @property
    def items(self) -> list[Item]:
        return [it for it in self.grid if it is not None]

    @property
    def cell(self) -> tuple[float, float]:
        w, h, c, r = LAYOUTS[self.layout]
        return w / c, h / r

    def scale(self) -> float:
        """同一比例：每格单位（1 格 = 游戏里一格宽）对应的拼图像素。"""
        cw, ch = self.cell
        return min(min(ch * USABLE / it.height, cw * USABLE / (it.height * it.aspect)) for it in self.items)

    def frac(self, it: Item) -> float:               # 这一件约占格高的比例
        return self.scale() * it.height / self.cell[1]

    def keys(self) -> list[str]:
        _, _, c, r = LAYOUTS[self.layout]
        ks = [it.key if it else "-" for it in self.grid]
        return ks + ["-"] * (c * r - len(ks))

    def line(self) -> str:
        _, _, c, r = LAYOUTS[self.layout]
        return f"@sheet {self.name} {c}x{r} " + ",".join(self.keys())


def fits(it: Item, layout: str) -> bool:
    w, h, c, r = LAYOUTS[layout]
    nw, nh = it.need()
    return nw <= w / c * USABLE and nh <= h / r * USABLE


def split_points(its: list[Item], cap: int) -> list[list[Item]]:
    """张数取最少（⌈n/cap⌉）；在此前提下少把同一种材质切到两张里，其次各张件数尽量均匀。"""
    n, k = len(its), math.ceil(len(its) / cap)
    INF = float("inf")
    best = {(0, 0): (0.0, None)}            # (已覆盖件数, 已用张数) → (代价, 上一个切点)
    for used in range(k):
        for (i, u), (cost, _) in list(best.items()):
            if u != used:
                continue
            for j in range(i + 1, min(n, i + cap) + 1):
                cut = 1.0 if 0 < j < n and its[j - 1].family == its[j].family else 0.0
                c = cost + cut + 0.01 * (cap - (j - i)) ** 2
                if c < best.get((j, u + 1), (INF, None))[0]:
                    best[(j, u + 1)] = (c, i)
    out, j, u = [], n, k
    while u > 0:
        i = best[(j, u)][1]
        out.append(its[i:j])
        j, u = i, u - 1
    return out[::-1]


def plan(items: list[Item], prefix: str = "s") -> tuple[list[Sheet], list[Item]]:
    """返回（拼图列表, 装不进任何版式、需要单独出的件）。"""
    sheets, single = [], []
    for kind in ("standee", "flat"):
        group = [it for it in items if it.kind == kind]
        prefs = ("grid43", "grid32", "wide24") if kind == "standee" else ("grid32",)
        buckets: dict[str, list[Item]] = {}
        for it in group:
            lay = next((l for l in prefs if fits(it, l)), None)
            if lay is None:
                single.append(it)
            else:
                buckets.setdefault(lay, []).append(it)
        small = buckets.get("grid43", [])
        if 6 < len(small) <= 8:                                            # 7–8 件：4×2，不留一整行空格
            buckets["grid42"] = buckets.pop("grid43")
        elif 0 < len(small) <= 6 and all(fits(it, "grid32") for it in small):   # 不满半张：换 3×2，格子更大、细节更多
            buckets["grid32"] = buckets.get("grid32", []) + buckets.pop("grid43")
        g = buckets.get("grid32", [])                                      # 3×2 也只剩几件：再换更少格子的版式
        for lay, cap in (("grid21", 2), ("grid22", 4)):
            if 0 < len(g) <= cap and all(fits(it, lay) for it in g):
                buckets[lay] = buckets.pop("grid32")
                break
        for lay, its in buckets.items():
            _, _, c, r = LAYOUTS[lay]
            its.sort(key=lambda it: (FAMILY_ORDER.index(it.family), -it.height, it.key))
            # 按材质排好后从左到右、从上到下依次填：同材质连在一起（多数情况下一行一种），只在最后一张末尾留空；
            # 张数相同时尽量均分，免得最后一张只剩一两件
            for chunk in split_points(its, c * r):
                sheets.append(Sheet(f"{prefix}{len(sheets) + 1}", lay, list(chunk)))
    return sheets, single


def items_from(keys: list[str], manifest: list[dict]) -> list[Item]:
    by = {it["artKey"]: it for it in manifest}
    out = []
    for k in keys:
        it = by[k]
        out.append(Item(k, it["kind"], float(it["height"]), float(it["aspect"]), float(it["pxPerUnit"])))
    return out


SHEET_STANDEE = (
    "画面是一张拼图：{w}×{h} 的画幅平均分成 {c} 列 {r} 行、共 {n} 个等大的格子（每格约 {cw}×{ch} 像素），"
    "每格正中画一件，下面按「第几行第几格」逐一列出。**格线不要画出来**，格与格之间只有背景色。"
    "每件都是一张独立的立牌：完整的一整块剪影，正面平视、略带俯角（约 15°），按物体本来的比例画；"
    "最下缘是一条水平的直线切边，同一行各件的切边落在同一条水平线上（离格子下沿约一成）；"
    "每件四周离格线都至少留出格宽的 8%，**任何一件都不许碰到或越过格线**，也不许和邻格的件连在一起。"
    "**所有件按同一个比例画**：每件写了「约占格高几成」，照这个高度画，大小关系就是游戏里的大小关系。"
    "空着的格子什么都不画。不要画地面、底座、落影和物体下方的暗色晕，剪影外缘不要描白边或黑边。"
    "背景完全透明；做不到透明就用纯品红 #FF00FF 均匀平涂整张背景，各件里不要用品红、洋红或亮紫色；"
    "不要用灰白棋盘格表示透明。")
SHEET_FLAT = (
    "画面是一张拼图：{w}×{h} 的画幅平均分成 {c} 列 {r} 行、共 {n} 个等大的格子（每格约 {cw}×{ch} 像素），"
    "每格正中画一件，下面按「第几行第几格」逐一列出。**格线不要画出来**，格与格之间只有背景色。"
    "每件都是一片平贴在地面上的薄纸件：从正上方垂直俯视，没有透视，轮廓不规则、像从纸上撕下或剪下来的；"
    "每件四周离格线都至少留出格宽的 8%，**任何一件都不许碰到或越过格线**，也不许和邻格的件连在一起。"
    "**所有件按同一个比例画**：每件写了「约占格高几成」，照这个大小画。空着的格子什么都不画。"
    "不要画落影和周围的地面。背景完全透明；做不到透明就用纯品红 #FF00FF 均匀平涂整张背景，"
    "各件里不要用品红、洋红或亮紫色；不要用灰白棋盘格表示透明。")


def _blocks(region_md: str) -> dict[str, list[str]]:
    return {m.group(1): m.group(2).strip().split("\n\n")
            for m in re.finditer(r"- artKey：`([^`]+)`\n.*?```\n(.*?)```", region_md, re.S)}


def sheet_prompt(sh: Sheet, region_md: str) -> str:
    """一张拼图的完整 prompt：风格段（取自 region.md，与单张出图同一段）+ 拼图版式 + 逐格内容 + 合并的「避免」句。"""
    blocks = _blocks(region_md)
    w, h, c, r = LAYOUTS[sh.layout]
    cw, ch = sh.cell
    kind = sh.items[0].kind
    tmpl = SHEET_STANDEE if kind == "standee" else SHEET_FLAT
    style = blocks[sh.items[0].key][0]
    lines, avoid = [], []
    by = {it.key: it for it in sh.items}
    for n, k in enumerate(sh.keys()):
        where = f"第 {n // c + 1} 行第 {n % c + 1} 格"
        if k == "-":
            lines.append(f"- {where}：空着，什么都不画。")
            continue
        paras = blocks[k]
        content = next(p for p in paras if p.startswith("内容："))[3:].strip()
        frac = round(sh.frac(by[k]) * 10)
        lines.append(f"- {where}：{content}约占格高的 {frac} 成。")
        for p in paras:
            if p.startswith("避免："):
                for x in re.split("[、。]", p[3:]):
                    if x.strip() and x.strip() not in avoid:
                        avoid.append(x.strip())
    return "\n\n".join([style, tmpl.format(w=w, h=h, c=c, r=r, n=c * r, cw=round(cw), ch=round(ch)),
                        "各格内容：\n" + "\n".join(lines), "避免：" + "、".join(avoid) + "。"])


def describe(sh: Sheet) -> str:
    w, h, c, r = LAYOUTS[sh.layout]
    cw, ch = sh.cell
    lines = [f"拼图 {sh.name}：{w}×{h}，{c} 列 {r} 行（格 {cw:.0f}×{ch:.0f}），比例 {sh.scale():.0f} px/格（游戏里 768）"]
    ks = sh.keys()
    by = {it.key: it for it in sh.items}
    for j in range(r):
        row = []
        for i in range(c):
            k = ks[j * c + i]
            row.append(f"{k}（约 {sh.frac(by[k]):.0%} 格高）" if k != "-" else "（空）")
        lines.append(f"  第 {j + 1} 行：" + "、".join(row))
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("keys", nargs="*")
    ap.add_argument("--section", help="清单段落，逗号分隔（如 H,E,I）")
    ap.add_argument("--prefix", default="s", help="拼图名前缀（默认 s → s1, s2…）")
    ap.add_argument("--prompts", action="store_true", help="再打印每张拼图的完整 prompt")
    a = ap.parse_args(argv)
    manifest = al.load_list()
    keys = list(a.keys)
    if a.section:
        secs = set(a.section.split(","))
        keys += [it["artKey"] for it in manifest if it["section"] in secs and it["artKey"] not in keys]
    sheets, single = plan(items_from(keys, manifest), a.prefix)
    for sh in sheets:
        print(describe(sh))
    if single:
        print("单独出（格子装不下）：" + "、".join(it.key for it in single))
    print()
    for sh in sheets:
        print(sh.line())
    if a.prompts:
        md = (al.ROOT / "docs" / "art-prompts" / "region.md").read_text(encoding="utf-8")
        for sh in sheets:
            print(f"\n#### 拼图 {sh.name}\n\n```\n{sheet_prompt(sh, md)}\n```")
    return 0


if __name__ == "__main__":
    sys.exit(main())
