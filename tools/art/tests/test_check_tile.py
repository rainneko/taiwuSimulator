from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

import synth
import artlib as al
import check_tile


def run(img, **kw):
    rep = al.Report()
    res = check_tile.check(img, "t.png", rep, **kw)
    return res, rep


class CheckTileTest(unittest.TestCase):
    def test_periodic_passes(self):
        res, rep = run(synth.periodic_noise())
        self.assertTrue(rep.ok, rep.items)
        self.assertLess(res["x"]["ratio"], 1.3)
        self.assertLess(res["y"]["ratio"], 1.3)

    def test_nonperiodic_fails(self):
        res, rep = run(synth.nonperiodic_noise())
        self.assertFalse(rep.ok)
        self.assertGreater(max(res["x"]["ratio"], res["y"]["ratio"]), 2.0)

    def test_half_offset_seam_found(self):
        # 可平铺的图错位半幅后不再可平铺（接缝跑到边上）：反过来验证度量确实在看边缘
        img = synth.periodic_noise()
        shifted = np.roll(img, 128, axis=1)
        self.assertTrue(run(shifted)[1].ok)            # 错位整数周期仍可平铺
        broken = img.copy()
        broken[:, :20] += 0.15                          # 左边一条亮带 → 左右接不上
        self.assertTrue(run(np.clip(broken, 0, 1))[1].has("t.png", "左右平铺"))

    def test_strip_mode_only_x(self):
        img = synth.road_strip(bg=(0, 0, 0, 0))
        res, rep = run(img, strip=True, max_chroma=None)
        self.assertTrue(rep.ok, rep.items)
        self.assertNotIn("y", res)
        bad = synth.road_strip(bg=(0, 0, 0, 0), periodic=False)
        self.assertFalse(run(bad, strip=True, max_chroma=None)[1].ok)

    def test_chroma_warning(self):
        _res, rep = run(synth.periodic_noise(colour=(0.85, 0.3, 0.2)))
        self.assertTrue(rep.has("t.png", "彩度", "警告"))
        _res, rep = run(synth.periodic_noise(colour=(0.6, 0.6, 0.55)))
        self.assertFalse(rep.has("t.png", "彩度", "警告"))

    def test_gradient_warning(self):
        img = synth.periodic_noise()
        img = np.clip(img + np.linspace(-0.12, 0.12, img.shape[1])[None, :, None], 0, 1)
        _res, rep = run(img)
        self.assertTrue(rep.has("t.png", "明暗渐变", "警告"))

    def test_oklch_of_grey_is_neutral(self):
        L, C, _h = al.mean_oklch(np.full((4, 4, 3), 0.5, np.float32))
        self.assertLess(C, 1e-3)
        self.assertAlmostEqual(L, 0.5981, delta=0.01)

    def test_resize_tile_stays_tileable(self):
        img = synth.periodic_noise(256)
        small = al.resize_tile(img, 100, 100)
        self.assertTrue(run(small)[1].ok)

    def test_heal_fixes_seams(self):
        img = synth.nonperiodic_noise()
        self.assertFalse(run(img)[1].ok)
        self.assertTrue(run(al.heal_tile(img))[1].ok)

    def test_cli(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            good = synth.save(synth.periodic_noise(), d / "g.png")
            bad = synth.save(synth.nonperiodic_noise(), d / "b.png")
            self.assertEqual(check_tile.main([str(good), "--quiet", "--preview", str(d / "pv")]), 0)
            self.assertTrue((d / "pv" / "g.tile.png").exists())
            self.assertEqual(check_tile.main([str(good), str(bad), "--quiet"]), 1)


if __name__ == "__main__":
    unittest.main()
