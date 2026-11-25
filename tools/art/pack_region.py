#!/usr/bin/env python3
"""地区场景运行时产物（M3-WO3 §6.4–6.7）：只把**已通过验收**的图打成游戏能读的图集、底纸数组、清单与 terrain-art.json。

为什么不直接读 art/region/work/：出图方（Codex）跑批次流水线时会往 work/ 里写**未验收**的新图（例如第四批正在替换房屋），
所以这里从原图存档重新抠像到自己的暂存目录，与 work/ 互不干扰，什么时候跑都行。

验收名单：tools/art/batches/accepted.txt（一行一个 artKey；新一批验收后把它的 artKey 加进去再跑）。
名单里一行「@sources batch3 ab batch2 batch1 trial」给出读原图的目录与优先级（后验收的批次排前面，青绿重出的图盖过旧图）；
每个 artKey 取 assets/art-source/region/<目录>/<artKey>.png 里第一张找到的。**还没验收的批次目录不要写进 @sources**
（例如第四批在出图期间，batch4/ 里是未验收的新房屋）。

步骤：原图 → art/region/pack/raw/ → key_alpha（立牌 / 平放件）→ art/region/pack/work/
      → pack_atlas（region-terrain / region-detail / region-houses / region-locations，只含名单里的帧）
      → build_ground_array（18 层底纸）→ build_manifest → terrain-art.json
输出：content/base/art/region/…（运行时路径 `${BASE_URL}content/base/art/region/…`），对接说明见 docs/proposals/region_runtime_assets.md。

用法：
    python3 tools/art/pack_region.py              # 全部重打
    python3 tools/art/pack_region.py --skip-key   # 暂存目录已是最新时，跳过抠像只重打图集
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import artlib as al
import preview_grid as pg
import region_features as rf

ROOT = al.ROOT
TOOLS = ROOT / "tools" / "art"
SRC_ROOT = ROOT / "assets" / "art-source" / "region"
STAGE = ROOT / "art" / "region" / "pack"
OUT = al.ART_ROOT                                  # content/base/art
ACCEPTED = TOOLS / "batches" / "accepted.txt"
SEAM_FIX = ("terrain.ground.settlement",)   # 1024 时过关、缩到 768 后上下接缝 1.74 > 1.6
TERRAIN_ART_OUT = ROOT / "content" / "region" / "terrain-art.json"
ATLASES = ("region/region-terrain", "region/region-mountains", "region/region-detail", "region/region-houses", "region/region-locations")
TERRAIN_ART_VERSION = 1


def read_accepted() -> tuple[list[str], list[str]]:
    keys, dirs = [], []
    for line in ACCEPTED.read_text(encoding="utf-8").splitlines():
        k = line.split("#", 1)[0].strip()
        if k.startswith("@sources"):
            dirs = k.split()[1:]
        elif k:
            keys.append(k)
    return keys, dirs


def find_source(key: str, dirs: list[str]) -> Path | None:
    for d in dirs:
        for ext in ("png", "webp", "jpg", "jpeg"):
            p = SRC_ROOT / d / f"{key}.{ext}"
            if p.is_file():
                return p
        p = SRC_ROOT / d / "sheet-cut" / f"{key}.png"      # 拼图切出的（split_sheet.py）；同批单独补出的优先
        if p.is_file():
            return p
    return None


def run(args: list[str]) -> bool:
    r = subprocess.run([sys.executable, *args], cwd=ROOT)
    return r.returncode == 0


def mountain_tiers(items: dict[str, dict], keys: set[str]) -> dict:
    """山岳分档与遮挡约束（v1.5；参考实现 region_features.mountain_plan / mountain_slots）。key 为 null = 还没有图，按 fallback 放。
    靠镜头的 frontRows 行只放山脚；主峰每片山至多 1 座，只放正后方一格也是山岳的格、立在本格靠后 offsetZ 处；
    连绵山体只放左右邻格都是山岳的格；不满足约束就降到 fallback。"""
    have = lambda k: k if k in keys else None
    return {"frontRows": 2,
            "mid": {"key": have(rf.TIER_KEYS["mid"]), "minLevel": 2},
            "tall": {"key": have(rf.TIER_KEYS["tall"]), "minLevel": 3, "note": "连绵山体放不下时的降档"},
            "massif": {"key": have(rf.TIER_KEYS["high"]), "minLevel": 3, "requires": ["left", "right"], "perCell": 1,
                       "fallback": "tall"},
            "peak": {"key": have(rf.TIER_KEYS["peak"]), "perRange": 1, "requires": ["back"], "offsetZ": -rf.PEAK_BACK,
                     "perCell": 1, "fallback": "massif",
                     "occludesCellsBehind": 1.1, "note": "俯角 53° 下约挡住身后 1.1 格地面；棋子在其后方时需要淡出（渲染侧）"}}


def terrain_art(items: dict[str, dict], keys: set[str]) -> dict:
    """渲染参数：地形的叠放次序、层号规则、密度与小件池（只留名单里有图的小件）、岸边件；房屋种类表。"""
    terrains = {}
    for it in items.values():
        if it["kind"] != "ground":
            continue
        t = it["terrain"]
        pool = it.get("fillers", {})
        rule = pg.LEVEL_RULES.get(t)
        e = {"layer": it["layer"], "stack": pg.STACK[t], "density": it["density"],
             "level": {"edge": rule[0], "step": rule[1], "cap": rule[2]} if rule else None,
             "fillers": [k for k in pool.get("fillers", []) if k in keys], "fillerCount": pool.get("fillerCount", [0, 0]),
             "pieces": [k for k in pool.get("pieces", []) if k in keys], "pieceCount": pool.get("pieceCount", [0, 0]),
             # 普通立牌（每格按密度撒）；地标（每片相连地形 1 个）与山体分档（massif / peak）另列，v1.5
             "standees": sorted(k for k in keys if k.startswith(f"terrain.standee.{t}.") and not items[k].get("landmark")
                                and not items[k].get("role")),
             "landmarks": sorted(k for k in keys if k.startswith(f"terrain.standee.{t}.") and items[k].get("landmark")),
             "water": bool(it.get("water"))}
        if it.get("shore"):
            e["shore"] = {**it["shore"], "fillers": [k for k in it["shore"]["fillers"] if k in keys]}
        if t == "mountain":
            e["tiers"] = mountain_tiers(items, keys)
        terrains[t] = e
    houses: dict[str, list] = {}
    for it in items.values():
        if it.get("houseKind") and it["artKey"] in keys:
            houses.setdefault(it["houseKind"], []).append(it["artKey"])
    return {"version": TERRAIN_ART_VERSION, "generatedBy": "tools/art/pack_region.py",
            "levelStep": pg.LEVEL_STEP, "layers": True, "houses": bool(houses),
            "terrains": terrains, "houseTypes": houses}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-key", action="store_true", help="跳过抠像（暂存目录已是最新）")
    a = ap.parse_args(argv)

    manifest = json.loads(al.DEFAULT_LIST.read_text(encoding="utf-8"))
    items = {it["artKey"]: it for it in manifest["items"]}
    keys, dirs = read_accepted()
    if not dirs:
        print("错误：验收名单里没有 @sources 行")
        return 1
    bad = [k for k in keys if k not in items]
    if bad:
        print("错误：验收名单里有清单没有的 artKey：", " ".join(bad))
        return 1
    raw, work = STAGE / "raw", STAGE / "work"
    if not a.skip_key:
        for d in (raw, work):
            shutil.rmtree(d, ignore_errors=True)
            d.mkdir(parents=True)
    fail, have, used_src = [], [], {}
    for k in keys:
        it = items[k]
        if it["kind"] == "decor":
            continue                                       # 装饰与遮罩另行处理（还没有通过验收的）
        src = find_source(k, dirs)
        if src is None:
            fail.append(f"{k}（找不到原图）")
            continue
        used_src[k] = str(src.relative_to(ROOT))
        if not a.skip_key:
            p = raw / src.name
            shutil.copy2(src, p)
            if it["kind"] in ("standee", "flat"):
                args = [str(TOOLS / "key_alpha.py"), "--out", str(work), "--quiet", str(p)]
                if it["kind"] == "flat":
                    args.insert(1, "--flat")
                if not run(args):
                    fail.append(f"{k}（key_alpha 报错）")
                    continue
        have.append(k)
    keyset = set(have)
    # 只含名单里有图的项的清单：pack_atlas / build_manifest 只看这些帧，缺的帧不进图集（由加载器回落占位）
    sub = dict(manifest, items=[it for it in manifest["items"] if it["artKey"] in keyset])
    sub_path = STAGE / "pack-list.json"
    al.write_json(sub_path, sub)

    ok = True
    for atlas in ATLASES:
        if not any(it.get("atlas") == atlas for it in sub["items"]):
            print(f"== {atlas}：名单里没有帧，跳过")
            continue
        print(f"== 打图集 {atlas}")
        for ext in ("webp", "json"):                   # 先删旧产物：装不下时宁可没有这张图集，也不留一份过期的
            (OUT / f"{atlas}.{ext}").unlink(missing_ok=True)
        # 不加 --auto-scale：装不下时明确报错（「装不下」），不悄悄降像素密度；
        # 备用方案（执行主管 2026-11-24）：region-detail 装不下时把 filler.rock.2 的 atlas 改到 region-houses（清单 region_prompts.py 里改）
        if not run([str(TOOLS / "pack_atlas.py"), "--atlas", atlas, "--list", str(sub_path), "--src", str(work),
                    "--out", str(OUT), "--quiet"]):
            ok = False
            print(f"错误：{atlas} 没有打出来（见上方「装不下」等条目），加载器会对这张图集的帧全部回落占位")
    # 缩到入库尺寸后接缝过不了的底纸：只在暂存副本上做重叠接合（原图存档不动；工单 §2.5 的 seam_blend）
    for k in SEAM_FIX:
        p = raw / f"{k}.png"
        if k in keyset and p.is_file() and not a.skip_key:
            print(f"== 接合 {k}")
            ok &= run([str(TOOLS / "seam_blend.py"), "--overlap", "64", "--out", str(raw / "blend"), str(p)])
            shutil.move(str(raw / "blend" / p.name), p)
    grounds = [it for it in sub["items"] if it["kind"] == "ground"]
    print(f"== 底纸数组（{len(grounds)} 层）")
    ok &= run([str(TOOLS / "build_ground_array.py"), "--list", str(sub_path), "--src", str(raw), "--strip", "--quiet"]
              + ([] if len(grounds) == 18 else ["--allow-missing"]))
    print("== art-manifest.json")
    ok &= run([str(TOOLS / "build_manifest.py"), "--list", str(sub_path), "--art-root", str(OUT)])
    ta = terrain_art(items, keyset)
    al.write_json(OUT / "region" / "terrain-art.json", ta)
    al.write_json(TERRAIN_ART_OUT, ta)                  # 加载器读这一份（总监 2026-11-24 定）；上面那份是旧路径，RegionScene 现在还读它
    al.write_json(STAGE / "sources.json", used_src)
    print(f"已写入 {al.rel(TERRAIN_ART_OUT)}（另抄一份到 {al.rel(OUT / 'region' / 'terrain-art.json')}）")
    print(f"\n名单 {len(keys)} 项，打包 {len(have)} 项；原图出处见 {al.rel(STAGE / 'sources.json')}")
    if fail:
        print("未打包：", "；".join(fail))
    print("全部无错误" if ok and not fail else "有步骤报错，见上方")
    return 0 if ok and not fail else 1


if __name__ == "__main__":
    sys.exit(main())
