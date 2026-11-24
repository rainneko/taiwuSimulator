"""青绿 A/B 对比图：ab.sh 出的 near/mid × a/b/c 六张拼成一张 compare-qinglv.jpg。
用法：python3 tools/art/ab_sheet.py <预览目录> <新图说明>"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONTS = ("/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/PingFang.ttc")


def font(size: int):
    for f in FONTS:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main(argv: list[str]) -> int:
    d, have = Path(argv[1]), argv[2] if len(argv) > 2 else ""
    cols = (("a", "现状"), ("b", "青绿：新图 + 其余载入时调色"), ("c", "青绿 + 赭色岩层侧壁"))
    rows = (("near", "近档"), ("mid", "中档"))
    W, H, cap, head, gap = 960, 540, 48, 104, 12
    F, Fs = font(30), font(22)
    img = Image.new("RGB", (3 * W + 4 * gap, head + 2 * (H + cap + gap) + gap), (236, 228, 212))
    dr = ImageDraw.Draw(img)
    dr.text((16, 12), "青绿 A/B：现状与「青绿山水做底色」并排", fill=(60, 50, 40), font=F)
    dr.text((16, 56), f"按新风格重出的图：{have.strip() or '无'}；其余图只是载入时调色（模拟运行时调色），内容未变",
            fill=(90, 80, 70), font=Fs)
    for r, (z, zl) in enumerate(rows):
        for c, (k, kl) in enumerate(cols):
            p = d / f"{z}-{k}.png"
            x, y = gap + c * (W + gap), head + r * (H + cap + gap)
            dr.text((x + 4, y + 8), f"{zl} · {kl}", fill=(60, 50, 40), font=F)
            if p.exists():
                img.paste(Image.open(p).convert("RGB").resize((W, H), Image.LANCZOS), (x, y + cap))
    out = d / "compare-qinglv.jpg"
    img.save(out, quality=88)
    print(f"已写入 {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
