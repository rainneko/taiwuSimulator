"""pack_atlas / build_ground_array / prep_decor / build_manifest / region_prompts 的端到端测试（全部用合成图）。"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

import synth
import artlib as al
import build_ground_array
import build_manifest
import key_alpha
import pack_atlas
import prep_decor

TOOLS = Path(__file__).resolve().parents[1]


def standee_items(n: int, atlas: str = "test/atlas") -> list[dict]:
    return [{"artKey": f"t.standee.{i}", "kind": "standee", "atlas": atlas, "pxPerUnit": 200,
             "height": 0.5 + 0.1 * i, "aspect": 1.0, "anchor": [0.5, 0.0]} for i in range(n)]


class PackAtlasTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.items = standee_items(6)
        for i, it in enumerate(self.items):
            rep = al.Report()
            out = key_alpha.process(synth.house(256, wide_base=0.4 + 0.08 * i), it["artKey"], rep)
            al.save_image(out, self.d / "work" / f"{it['artKey']}.png")

    def tearDown(self):
        self.tmp.cleanup()

    def test_atlas_json_matches_wo1_schema(self):
        rep = al.Report()
        meta = pack_atlas.build_atlas(self.items, "test/atlas", self.d / "work", self.d / "art", rep,
                                      size=(512, 512), padding=6, feather=3.0)
        self.assertTrue(rep.ok, rep.items)
        data = json.loads((self.d / "art" / "test" / "atlas.json").read_text())
        self.assertEqual(data["image"], "atlas.webp")
        self.assertEqual(data["size"], [512, 512])
        self.assertGreaterEqual(data["feather"], 2)
        self.assertGreaterEqual(data["padding"], 4)
        self.assertEqual(len(data["frames"]), 6)
        img = al.load_rgba(self.d / "art" / "test" / "atlas.webp")
        rects = []
        for f in data["frames"]:
            x, y, w, h = f["rect"]
            self.assertTrue(0 <= x and 0 <= y and x + w <= 512 and y + h <= 512)
            it = next(i for i in self.items if i["artKey"] == f["name"])
            self.assertAlmostEqual(f["size"][1], it["height"])
            self.assertAlmostEqual(f["size"][0] / f["size"][1], w / h, places=3)
            self.assertEqual(f["anchor"], [0.5, 0.0])
            self.assertAlmostEqual(h, round(it["height"] * 200), delta=1)
            fa = img[y:y + h, x:x + w, 3]
            self.assertGreaterEqual(al.measure_feather(fa), 2.0)
            rects.append((x, y, w, h))
        # 帧间距 ≥ padding
        for i, a in enumerate(rects):
            for b in rects[i + 1:]:
                gx = max(b[0] - (a[0] + a[2]), a[0] - (b[0] + b[2]))
                gy = max(b[1] - (a[1] + a[3]), a[1] - (b[1] + b[3]))
                self.assertGreaterEqual(max(gx, gy), 6)
        # 帧外透明区的颜色已外扩（不是黑色），且 WebP 往返后仍在
        a = img[..., 3]
        ring = (a < 0.02) & al.dilate(al.dilate(a >= 0.5))
        self.assertGreater(float(img[ring, :3].max(-1).mean()), 0.2)
        self.assertIsNotNone(meta)

    def test_too_small_atlas_errors_then_auto_scale(self):
        rep = al.Report()
        self.assertIsNone(pack_atlas.build_atlas(self.items, "test/atlas", self.d / "work", self.d / "art", rep,
                                                 size=(160, 160)))
        self.assertTrue(rep.has("test/atlas", "装不下"))
        rep = al.Report()
        meta = pack_atlas.build_atlas(self.items, "test/atlas", self.d / "work", self.d / "art", rep,
                                      size=(256, 256), auto_scale=True)
        self.assertIsNotNone(meta, rep.items)
        self.assertTrue(rep.has("test/atlas", "缩放", "警告"))

    def test_missing_source(self):
        items = self.items + standee_items(1, "test/atlas")[:0] + [dict(self.items[0], artKey="t.missing")]
        rep = al.Report()
        self.assertIsNone(pack_atlas.build_atlas(items, "test/atlas", self.d / "work", self.d / "art", rep, size=(512, 512)))
        self.assertTrue(rep.has("t.missing", "缺图"))

    def test_skyline_no_overlap(self):
        rng = np.random.default_rng(3)
        sizes = [(f"r{i}", int(rng.integers(10, 120)), int(rng.integers(10, 120))) for i in range(60)]
        placed = pack_atlas.pack(sizes, 1024, 1024, 4)
        self.assertIsNotNone(placed)
        rects = [(placed[n][0], placed[n][1], w, h) for n, w, h in sizes]
        for i, a in enumerate(rects):
            self.assertLessEqual(a[0] + a[2], 1024)
            self.assertLessEqual(a[1] + a[3], 1024)
            for b in rects[i + 1:]:
                overlap = a[0] < b[0] + b[2] + 4 and b[0] < a[0] + a[2] + 4 and a[1] < b[1] + b[3] + 4 and b[1] < a[1] + a[3] + 4
                self.assertFalse(overlap, (a, b))


class GroundDecorManifestTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = Path(self.tmp.name)
        self.items = json.loads((TOOLS / "region-assets.json").read_text(encoding="utf-8"))["items"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_ground_array_order_and_tiling(self):
        raw = self.d / "raw"
        for it in self.items:
            if it["kind"] == "ground":
                synth.save(synth.periodic_noise(256, seed=it["layer"] + 10, colour=(0.5, 0.55, 0.5)), raw / f"{it['artKey']}.png")
        rep = al.Report()
        meta = build_ground_array.build(self.items, raw, self.d / "ground", rep, size=128, strip=True)
        self.assertTrue(rep.ok, [i for i in rep.items if i[0] != "信息"])
        self.assertEqual(meta["count"], 18)
        self.assertEqual([l["terrain"] for l in meta["layers"]][:3], ["plain", "lake", "farmland"])
        self.assertEqual(meta["layers"][17]["terrain"], "settlement")
        self.assertEqual(meta["terrainToLayer"]["village"], 17)
        self.assertEqual(meta["terrainToLayer"]["abyss"], 16)
        no_rot = {l["terrain"] for l in meta["layers"] if l["noRotate"]}
        self.assertEqual(no_rot, {"farmland", "mulberry"})
        self.assertTrue((self.d / "ground" / "00-plain.webp").exists())
        strip = al.load_rgba(self.d / "ground" / "ground-strip.webp")
        self.assertEqual(strip.shape[:2], (128 * 18, 128))

    def test_ground_rejects_non_tileable(self):
        raw = self.d / "raw"
        for it in self.items:
            if it["kind"] == "ground":
                gen = synth.nonperiodic_noise if it["terrain"] == "lake" else synth.periodic_noise
                synth.save(gen(256), raw / f"{it['artKey']}.png")
        rep = al.Report()
        self.assertIsNone(build_ground_array.build(self.items, raw, self.d / "ground", rep, size=128))
        self.assertTrue(rep.has("terrain.ground.lake", "左右平铺") or rep.has("terrain.ground.lake", "上下平铺"))
        rep = al.Report()
        self.assertIsNotNone(build_ground_array.build(self.items, raw, self.d / "ground", rep, size=128, heal=True))

    def test_decor_and_manifest(self):
        raw = self.d / "raw"
        synth.save(synth.road_strip(), raw / "region.road.png")
        synth.save(synth.road_strip(), raw / "region.frame.edge.png")
        synth.save(synth.edge_mask(), raw / "region.edge.png")
        fog = synth.periodic_noise(256, seed=9, colour=(0.5, 0.5, 0.5), amp=0.5)
        synth.save(fog, raw / "region.fog.png")
        synth.save(synth.house(256), raw / "region.frame.corner.png")
        art = self.d / "art"
        code = prep_decor.main(["--src", str(raw), "--out", str(art / "region" / "decor"), "--quiet"])
        self.assertEqual(code, 0)
        decor = json.loads((art / "region" / "decor" / "decor.json").read_text())["decor"]
        self.assertEqual(set(decor), {"region.road", "region.fog", "region.edge", "region.frame.edge", "region.frame.corner"})
        # 一个小图集 + 底纸 → manifest
        work = self.d / "work"
        rep = al.Report()
        al.save_image(key_alpha.process(synth.house(256), "x", rep), work / "terrain.standee.plain.0.png")
        items = [dict(it) for it in self.items if it["artKey"] == "terrain.standee.plain.0"]
        pack_atlas.build_atlas(items, "region/region-terrain", work, art, rep, size=(512, 512))
        self.assertTrue(rep.ok, rep.items)
        code = build_manifest.main(["--art-root", str(art)])
        self.assertEqual(code, 0)
        man = json.loads((art / "art-manifest.json").read_text())
        self.assertEqual(man["terrain.standee.plain.0"], {"atlas": "region/region-terrain", "frame": "terrain.standee.plain.0"})
        self.assertEqual(man["region.road"], {"texture": "region/decor/region.road"})
        self.assertEqual(build_manifest.main(["--art-root", str(art), "--strict"]), 1)   # 其余 73 项缺素材

    def test_edge_mask_structure_checked(self):
        raw = self.d / "raw"
        synth.save(1 - synth.edge_mask(), raw / "region.edge.png")       # 上下颠倒
        rep = al.Report()
        it = next(i for i in self.items if i["artKey"] == "region.edge")
        prep_decor.process(it, al.load_rgba(raw / "region.edge.png"), rep)
        self.assertTrue(rep.has("region.edge", "遮罩结构"))


class RegionPromptsTest(unittest.TestCase):
    def run_gen(self, *args):
        return subprocess.run([sys.executable, str(TOOLS / "region_prompts.py"), *args],
                              capture_output=True, text=True)

    def test_check_passes(self):
        r = self.run_gen("--check")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("126 条", r.stdout)

    def test_list_counts_match(self):
        items = json.loads((TOOLS / "region-assets.json").read_text(encoding="utf-8"))["items"]
        from collections import Counter
        c = Counter(it["section"] for it in items)
        self.assertEqual(dict(c), {"A": 18, "B": 34, "C": 11, "D": 5, "E": 10, "F": 5, "H": 19, "I": 10, "J": 13, "K": 1})
        for it in items:
            if it["kind"] == "standee" and it["section"] == "B":
                low = it["artKey"] == "terrain.standee.plain.1"   # 卵石 0.28（v1.4，region_prompts.LOW_STANDEES）
                self.assertTrue((0.25 if low else 0.45) <= it["height"] <= 0.65, it["artKey"])
        dens = {it["terrain"]: it["density"] for it in items if it["kind"] == "ground" and it["section"] == "A"
                and it["terrain"] != "settlement"}
        self.assertEqual(len(dens), 17)
        self.assertTrue(all(0 <= lo <= hi <= 7 for lo, hi in dens.values()))
        self.assertEqual(sum(1 for it in items if it.get("pilot")), 6)
        for it in items:
            if it["kind"] == "ground":
                pool = it["fillers"]
                self.assertTrue(set(pool["fillers"] + pool["pieces"]) <= {x["artKey"] for x in items})

    def test_slots(self):
        with tempfile.TemporaryDirectory() as d:
            ok = Path(d) / "ok.json"
            ok.write_text(json.dumps({"slots": [{
                "artKey": "loc.city.p01", "group": "p01", "archetype": "依坡而建的山城", "setting": "两条河交汇的河口",
                "color": "灰白墙、黛青瓦", "accent": "赭石", "feature": "一座横跨河面的多孔石桥"}]}), encoding="utf-8")
            out_md, out_list = Path(d) / "r.md", Path(d) / "l.json"
            r = self.run_gen("--slots", str(ok), "--out", str(out_md), "--list-out", str(out_list))
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("## G. 专属地点", out_md.read_text(encoding="utf-8"))
            items = json.loads(out_list.read_text(encoding="utf-8"))["items"]
            self.assertEqual(items[-1]["atlas"], "region/province/p01")
            bad = Path(d) / "bad.json"
            bad.write_text(json.dumps([{"artKey": "loc.city.default.9", "archetype": "城门上挂着写字的匾",
                                        "setting": "x", "color": "x", "accent": "x"}]), encoding="utf-8")
            r = self.run_gen("--slots", str(bad), "--check")
            self.assertEqual(r.returncode, 1)
            self.assertIn("缺字段", r.stderr)
            bad.write_text(json.dumps([{"artKey": "loc.city.default.9", "archetype": "城门上挂着写字的匾",
                                        "setting": "x", "color": "x", "accent": "x", "feature": "x"}]), encoding="utf-8")
            r = self.run_gen("--slots", str(bad), "--check")
            self.assertIn("artKey 须为", r.stderr)
            self.assertIn("易误导", r.stderr)


if __name__ == "__main__":
    unittest.main()
