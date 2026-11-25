"""拼图出图：split_sheet（切分与检查）与 sheet_plan（分组）。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import artlib as al  # noqa: E402
import key_alpha  # noqa: E402
import sheet_plan as sp  # noqa: E402
import split_sheet as ss  # noqa: E402

MAG = np.array([1.0, 0.0, 1.0, 1.0], np.float32)


def blob(h: int, w: int, colour=(0.3, 0.5, 0.4)) -> np.ndarray:
    """一个底边平切的不透明小件（上半部收窄成梯形，像一块石头）。"""
    a = np.zeros((h, w, 4), np.float32)
    for y in range(h):
        inset = int((h - 1 - y) / h * w * 0.3)
        a[y, inset:w - inset, :3] = colour
        a[y, inset:w - inset, 3] = 1.0
    return a


def sheet(cols: int, rows: int, cw: int, ch: int, items: dict[tuple[int, int], np.ndarray], bg=MAG) -> np.ndarray:
    img = np.broadcast_to(bg, (rows * ch, cols * cw, 4)).copy()
    for (i, j), it in items.items():
        h, w = it.shape[:2]
        y = j * ch + int(ch * 0.85) - h
        x = i * cw + (cw - w) // 2
        m = it[..., 3:] > 0.5
        img[y:y + h, x:x + w] = np.where(m, it, img[y:y + h, x:x + w])
    return img


class SplitTest(unittest.TestCase):
    def test_cuts_each_cell_and_cuts_pass_key_alpha(self):
        img = sheet(4, 3, 384, 341, {(i, j): blob(80 + 20 * i, 120) for i in range(4) for j in range(3)})
        keys = [f"k{n}" for n in range(12)]
        rep = al.Report()
        cuts = ss.split(img, 4, 3, keys, rep, "s1")
        self.assertTrue(rep.ok, rep.items)
        self.assertEqual(sorted(cuts), sorted(keys))
        c = cuts["k3"]                                   # 第 1 行第 4 格：高 140
        self.assertEqual(c.shape[0], c.shape[1])
        self.assertAlmostEqual(140 / c.shape[0], 1 - 2 * ss.MARGIN, delta=0.02)
        r2 = al.Report()
        out = key_alpha.process(c, "k3", r2)
        self.assertIsNotNone(out)
        self.assertTrue(r2.ok, r2.items)

    def test_transparent_background(self):
        img = sheet(2, 1, 300, 300, {(0, 0): blob(100, 100), (1, 0): blob(120, 90)}, bg=np.zeros(4, np.float32))
        rep = al.Report()
        cuts = ss.split(img, 2, 1, ["a", "b"], rep, "s")
        self.assertTrue(rep.ok, rep.items)
        self.assertEqual(cuts["a"][0, 0, 3], 0.0)

    def test_crossing_cell_line_is_error(self):
        img = sheet(2, 1, 300, 300, {(0, 0): blob(100, 100)})
        img[150:200, 280:320] = (0.3, 0.5, 0.4, 1.0)      # 横跨两格的一块
        rep = al.Report()
        cuts = ss.split(img, 2, 1, ["a", "-"], rep, "s")
        self.assertTrue(rep.has("a", "越格"))
        self.assertNotIn("a", cuts)

    def test_empty_cell_and_wrong_count(self):
        img = sheet(2, 1, 300, 300, {(0, 0): blob(100, 100)})
        rep = al.Report()
        ss.split(img, 2, 1, ["a", "b"], rep, "s")
        self.assertTrue(rep.has("b", "空格"))
        rep = al.Report()
        self.assertEqual(ss.split(img, 2, 1, ["a"], rep, "s"), {})
        self.assertTrue(rep.has("s", "格数"))

    def test_scale_warning(self):
        items = {(i, 0): blob(100, 80) for i in range(3)}
        items[(3, 0)] = blob(200, 80)                     # 清单里同高，却画成两倍
        img = sheet(4, 1, 300, 300, items)
        rep = al.Report()
        ss.split(img, 4, 1, ["a", "b", "c", "d"], rep, "s", {"a": 0.2, "b": 0.2, "c": 0.2, "d": 0.2})
        self.assertTrue(rep.has("d", "比例", "警告"))
        self.assertFalse(rep.has("a", "比例", "警告"))

    def test_read_sheets(self):
        p = Path(self._tmp()) / "b.txt"
        p.write_text("# x\n@preview --houses\n@sheet rocks 4x3 a,b,-,c  # 注释\nfoo\n", encoding="utf-8")
        self.assertEqual(ss.read_sheets(p), [("rocks", 4, 3, ["a", "b", "-", "c"])])

    def _tmp(self) -> str:
        import tempfile
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d)
        return d


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.manifest = al.load_list()

    def test_small_items_all_planned_kinds_never_mixed(self):
        keys = [it["artKey"] for it in self.manifest if it["section"] in ("H", "E", "I")]
        sheets, single = sp.plan(sp.items_from(keys, self.manifest))
        planned = [k for sh in sheets for k in sh.keys() if k != "-"]
        self.assertEqual(sorted(planned + [it.key for it in single]), sorted(keys))
        for sh in sheets:
            self.assertEqual(len({it.kind for it in sh.items}), 1, sh.name)
            _, _, c, r = sp.LAYOUTS[sh.layout]
            self.assertEqual(len(sh.keys()), c * r)

    def test_every_item_fits_and_keeps_game_density(self):
        keys = [it["artKey"] for it in self.manifest if it["section"] in ("H", "E", "I")]
        sheets, _ = sp.plan(sp.items_from(keys, self.manifest))
        for sh in sheets:
            cw, ch = sh.cell
            s = sh.scale()
            self.assertGreaterEqual(s, min(it.ppu for it in sh.items) * 0.99, sh.name)   # 不低于游戏里的像素密度
            for it in sh.items:
                self.assertLessEqual(s * it.height, ch * sp.USABLE + 1e-6)
                self.assertLessEqual(s * it.height * it.aspect, cw * sp.USABLE + 1e-6)

    def test_families_stay_together(self):
        """同材质连成一段：一张拼图里每种材质只出现成一段，不前后穿插。"""
        keys = [it["artKey"] for it in self.manifest if it["section"] in ("H", "E")]
        sheets, _ = sp.plan(sp.items_from(keys, self.manifest))
        for sh in sheets:
            fams = [it.family for it in sh.items]
            runs = [f for n, f in enumerate(fams) if n == 0 or fams[n - 1] != f]
            self.assertEqual(len(runs), len(set(runs)), (sh.name, fams))

    def test_wide_items_get_wide_cells(self):
        sheets, single = sp.plan(sp.items_from(["loc.prop.wall", "loc.prop.fence", "filler.rock.0"], self.manifest))
        lay = {k: sh.layout for sh in sheets for k in sh.keys() if k != "-"}
        self.assertNotEqual(lay["loc.prop.wall"], "grid43")
        self.assertEqual(single, [])

    def test_layout_by_count(self):
        """1–2 件 2×1、3–4 件 2×2、5–6 件 3×2、7–8 件 4×2、9 件以上 4×3。"""
        few = ["filler.rock.0", "filler.rock.1", "filler.stump"]
        eight = few + ["filler.log", "filler.thorn", "filler.tuft.0", "filler.flowers.0", "filler.mushrooms"]
        many = eight + ["filler.fern", "filler.tuft.1"]
        layouts = lambda ks: {sh.layout for sh in sp.plan(sp.items_from(ks, self.manifest))[0]}
        self.assertEqual(layouts(few), {"grid22"})
        self.assertEqual(layouts(few[:2]), {"grid21"})
        self.assertEqual(layouts(few + ["filler.log", "filler.thorn"]), {"grid32"})
        self.assertEqual(layouts(["ground.piece.leaves", "ground.piece.petals"]), {"grid21"})
        self.assertEqual(layouts(eight), {"grid42"})
        self.assertEqual(layouts(many), {"grid43"})


if __name__ == "__main__":
    unittest.main()
