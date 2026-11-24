#!/usr/bin/env python3
"""汇总 art-manifest.json（M3-WO3 §6.7）：artKey → 图集帧 / 纹理数组层 / 单张纹理。

扫描 --art-root 下的：
  图集 JSON（含 frames 的 *.json）     → { "atlas": "<图集 id>", "frame": "<帧名>" }      （M3-WO1 §2.6）
  ground.json（含 layers）              → { "array": "<数组 id>", "layer": n }              （本工单 §3.1 提议的扩展）
  decor.json（含 decor）                → { "texture": "<纹理 id>" }                         （本工单 §3.1 提议的扩展）
id = 相对 art-root 的路径去掉扩展名，如 region/region-terrain、region/ground/ground、region/decor/region.road。

报告：清单里有而素材缺的项（--strict 时为错误，否则警告）；素材里有而清单没有的项（警告）；同一 artKey 出现在多处（错误）。

用法：
    python3 tools/art/build_manifest.py                                 # 写 content/base/art/art-manifest.json
    python3 tools/art/build_manifest.py --strict --list a.json --list b.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import artlib as al


def scan(art_root: Path, rep: al.Report) -> dict[str, dict]:
    found: dict[str, dict] = {}
    where: dict[str, str] = {}

    def put(key: str, entry: dict, src: str) -> None:
        if key in found:
            rep.error(key, "重复", f"同时出现在 {where[key]} 与 {src}")
            return
        found[key] = entry
        where[key] = src

    for p in sorted(art_root.rglob("*.json")):
        if p.name == "art-manifest.json":
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            rep.warn(al.rel(p), "读取", f"不是合法 JSON，跳过：{e}")
            continue
        if not isinstance(data, dict):
            continue
        rid = p.relative_to(art_root).with_suffix("").as_posix()
        if "frames" in data:
            bad = [k for k in ("image", "size", "feather", "padding") if k not in data]
            if bad:
                rep.error(al.rel(p), "图集格式", f"缺字段 {bad}（M3-WO1 §2.6 AtlasJson）")
                continue
            # 不透明图集（房屋部件，v1.3）没有 alpha 边，不需要羽化
            if (not data.get("opaque") and data["feather"] < al.MIN_FEATHER) or data["padding"] < al.MIN_PADDING:
                rep.error(al.rel(p), "图集格式", f"feather={data['feather']}、padding={data['padding']} 低于下限 2 / 4")
            for f in data["frames"]:
                put(f["name"], {"atlas": rid, "frame": f["name"]}, al.rel(p))
        elif "layers" in data:
            for layer in data["layers"]:
                put(layer["artKey"], {"array": rid, "layer": layer["layer"]}, al.rel(p))
        elif "decor" in data:
            base = p.parent.relative_to(art_root).as_posix()
            for key, d in data["decor"].items():
                put(key, {"texture": f"{base}/{Path(d['file']).stem}"}, al.rel(p))
    return found


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", type=Path, action="append", help="素材清单，可给多次（默认 tools/art/region-assets.json）")
    ap.add_argument("--art-root", type=Path, default=al.ART_ROOT, help="内容包的 art 目录（默认 content/base/art）")
    ap.add_argument("--out", type=Path, help="输出路径（默认 <art-root>/art-manifest.json）")
    ap.add_argument("--strict", action="store_true", help="清单里有而素材缺的项算错误（发版前用）")
    args = ap.parse_args(argv)

    rep = al.Report()
    found = scan(args.art_root, rep)
    wanted: list[str] = []
    for lp in args.list or [al.DEFAULT_LIST]:
        wanted += [it["artKey"] for it in al.load_list(lp)]
    missing = [k for k in wanted if k not in found]
    extra = sorted(set(found) - set(wanted))
    for k in missing:
        (rep.error if args.strict else rep.warn)(k, "缺素材", "清单里有，但图集 / 纹理数组 / 装饰纹理里都没有")
    for k in extra:
        rep.warn(k, "清单外", "素材里有，但清单里没有（改名后的旧帧？）")
    out = args.out or args.art_root / "art-manifest.json"
    manifest = {k: found[k] for k in sorted(found)}
    if rep.ok:
        al.write_json(out, manifest)
    print(f"清单 {len(wanted)} 项：已有 {len(wanted) - len(missing)}，缺 {len(missing)}；"
          f"{'已写入 ' + al.rel(out) if rep.ok else '有错误，未写入'}")
    rep.print()
    return rep.exit_code()


if __name__ == "__main__":
    sys.exit(main())
