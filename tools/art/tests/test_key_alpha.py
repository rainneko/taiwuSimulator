from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

import synth  # noqa: F401  （把 tools/art 放进 sys.path）
import artlib as al
import key_alpha


def run(img, **kw):
    rep = al.Report()
    out = key_alpha.process(img, "t.png", rep, **kw)
    return out, rep


class KeyAlphaTest(unittest.TestCase):
    def test_magenta_clean_house(self):
        out, rep = run(synth.house())
        self.assertTrue(rep.ok, rep.items)
        a = out[..., 3]
        # 四角透明
        for y, x in ((0, 0), (0, -1), (-1, 0), (-1, -1)):
            self.assertEqual(a[y, x], 0.0)
        # 主体颜色保住（墙身的土黄）
        h, w = a.shape
        wall = out[int(h * 0.75), int(w * 0.3), :3]
        np.testing.assert_allclose(wall, np.array([196, 170, 120]) / 255, atol=0.03)
        # 边缘没有品红溢色：半透明像素的 min(R,B) − G 不应明显为正
        edge = (a > 0.05) & (a < 0.95)
        self.assertTrue(edge.any())
        m = np.minimum(out[..., 0], out[..., 2]) - out[..., 1]
        self.assertLess(float(np.percentile(m[edge], 95)), 0.15)
        # 羽化 ≥ 2px
        self.assertGreaterEqual(al.measure_feather(a), 1.9)
        # 透明区颜色已外扩：紧贴剪影外侧的透明像素不是黑色
        ring = (a < 0.05) & al.dilate(al.dilate(a >= 0.5))
        self.assertTrue(ring.any())
        self.assertGreater(float(out[ring, :3].max(-1).mean()), 0.25)

    def test_trim_keeps_margin_and_bottom(self):
        out, rep = run(synth.house(), margin=4)
        a = out[..., 3]
        box = al.trim_box(a, 0.02)
        h, w = a.shape
        self.assertLessEqual(box[0], 6)
        self.assertGreaterEqual(box[2], w - 6)
        self.assertGreaterEqual(box[3], h - 6)
        self.assertGreater(key_alpha.bottom_contact(a), 0.4)

    def test_transparent_input(self):
        out, rep = run(synth.house(bg=(0, 0, 0, 0)))
        self.assertTrue(rep.ok, rep.items)
        self.assertGreater(out[..., 3].max(), 0.99)

    def test_checkerboard_rejected(self):
        out, rep = run(synth.checker())
        self.assertIsNone(out)
        self.assertTrue(rep.has("t.png", "背景"))

    def test_opaque_non_magenta_rejected(self):
        out, rep = run(synth.opaque_white_bg())
        self.assertIsNone(out)
        self.assertTrue(rep.has("t.png", "背景"))

    def test_drop_shadow_detected(self):
        for bg in ((255, 0, 255, 255), (0, 0, 0, 0)):
            _out, rep = run(synth.house(bg=bg, shadow=True))
            self.assertTrue(rep.has("t.png", "落影"), (bg, rep.items))

    def test_point_contact_flagged(self):
        _out, rep = run(synth.house(point_down=True))
        self.assertTrue(rep.has("t.png", "底边") or rep.has("t.png", "底边", "警告"), rep.items)

    def test_cut_subject_flagged(self):
        _out, rep = run(synth.house(cut_left=True))
        self.assertTrue(rep.has("t.png", "完整入画"), rep.items)

    def test_strip_keeps_full_width(self):
        img = synth.road_strip()
        out, rep = run(img, strip=True)
        self.assertTrue(rep.ok, rep.items)
        self.assertEqual(out.shape[1], img.shape[1])
        self.assertLess(out.shape[0], img.shape[0])

    def test_cli_writes_output_and_errors(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            good = synth.save(synth.house(), d / "raw" / "a.png")
            bad = synth.save(synth.checker(), d / "raw" / "b.png")
            code = key_alpha.main([str(good), str(bad), "--out", str(d / "work"), "--quiet"])
            self.assertEqual(code, 1)
            self.assertTrue((d / "work" / "a.png").exists())
            self.assertFalse((d / "work" / "b.png").exists())


class FeatherTest(unittest.TestCase):
    def test_feather_preserves_contour_and_width(self):
        a = np.zeros((64, 64), np.float32)
        a[16:48, 16:48] = 1.0
        f = al.feather_alpha(a, 3.0)
        self.assertAlmostEqual(al.measure_feather(f), 3.0, delta=0.5)
        # 0.5 等值线位置不变：面积基本不变
        self.assertAlmostEqual(float((f >= 0.5).sum()), float((a >= 0.5).sum()), delta=32 * 4)

    def test_thin_line_survives(self):
        a = np.zeros((32, 64), np.float32)
        a[15:17, 4:60] = 1.0          # 2px 宽的细线
        f = al.feather_alpha(a, 3.0)
        self.assertTrue((f[15:17, 10:54] >= 0.5).all())


if __name__ == "__main__":
    unittest.main()
