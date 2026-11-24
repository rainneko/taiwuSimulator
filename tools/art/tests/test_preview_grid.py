"""preview_grid.py 的合成图测试：投影几何、确定性、真实素材被采用、落影方向。"""
from __future__ import annotations

import math
import tempfile
import unittest
from pathlib import Path

import numpy as np

import synth
import artlib as al
import preview_grid as pg

ITEMS = al.load_list(al.DEFAULT_LIST)
SMALL = dict(size=(320, 180), ss=1, settlements=2)


class CameraTest(unittest.TestCase):
    def test_target_at_centre_and_cols_span_width(self):
        cam = pg.Camera(1920, 1080, 15)
        np.testing.assert_allclose(cam.project([cam.t])[0], [960, 540], atol=1e-6)
        l, r = cam.project([cam.t - [7.5, 0, 0], cam.t + [7.5, 0, 0]])
        self.assertAlmostEqual(l[0], 0, delta=1e-6)
        self.assertAlmostEqual(r[0], 1920, delta=1e-6)

    def test_ground_at_inverts_project(self):
        for ortho in (False, True):
            cam = pg.Camera(800, 450, 12, ortho=ortho)
            for p in ((3.2, 0, -1.7), (-2.0, 0, 2.5)):
                sx, sy = cam.project([p])[0]
                gx, gz = cam.ground_at(sx, sy)
                self.assertAlmostEqual(gx, p[0], places=6)
                self.assertAlmostEqual(gz, p[2], places=6)

    def test_ortho_factors(self):
        cam = pg.Camera(1200, 600, 12, ortho=True)        # 100 px / 格
        o, dz, dy = cam.project([cam.t, cam.t + [0, 0, 1], cam.t + [0, 1, 0]])
        self.assertAlmostEqual(dz[1] - o[1], 100 * math.sin(pg.PITCH), places=6)     # 纵深 ×0.8
        self.assertAlmostEqual(o[1] - dy[1], 100 * math.cos(pg.PITCH), places=6)     # 立牌 ×0.6

    def test_perspective_far_rows_smaller(self):
        cam = pg.Camera(1920, 1080, 15)
        near = np.diff(cam.project([(0, 0, 3), (1, 0, 3)])[:, 0])[0]
        far = np.diff(cam.project([(0, 0, -3), (1, 0, -3)])[:, 0])[0]
        self.assertGreater(near, far * 1.1)


class RenderTest(unittest.TestCase):
    def test_placeholders_size_and_determinism(self):
        a, assets, _ = pg.make_preview(ITEMS, cols=12, seed=5, use_real=False, **SMALL)
        b, _, _ = pg.make_preview(ITEMS, cols=12, seed=5, use_real=False, **SMALL)
        c, _, _ = pg.make_preview(ITEMS, cols=12, seed=6, use_real=False, **SMALL)
        self.assertEqual(a.size, (320, 180))
        self.assertEqual(assets.real, [])
        np.testing.assert_array_equal(np.asarray(a), np.asarray(b))
        self.assertGreater(np.abs(np.asarray(a, float) - np.asarray(c, float)).mean(), 1.0)

    def test_cols_change_density(self):
        imgs = [np.asarray(pg.make_preview(ITEMS, cols=c, seed=2, use_real=False, **SMALL)[0], float)
                for c in (12, 20)]
        self.assertGreater(np.abs(imgs[0] - imgs[1]).mean(), 1.0)

    def test_real_assets_used(self):
        with tempfile.TemporaryDirectory() as d:
            src, raw = Path(d) / "work", Path(d) / "raw"
            src.mkdir(); raw.mkdir()
            red = synth.house(256, bg=(0, 0, 0, 0))
            red[..., :3] = np.where(red[..., 3:] > 0, [0.9, 0.1, 0.1], 0)
            for k in range(2):
                synth.save(red, src / f"terrain.standee.woods.{k}.png")
            blue = np.ones((128, 128, 3), np.float32) * [0.2, 0.3, 0.9]
            synth.save(blue, raw / "terrain.ground.plain.png")
            img, assets, _ = pg.make_preview(ITEMS, cols=12, seed=1, terrains=["plain", "woods"], src=src,
                                             ground_src=raw, **SMALL)
            self.assertIn("terrain.standee.woods.0", assets.real)
            self.assertIn("terrain.ground.plain", assets.real)
            self.assertIn("terrain.ground.woods", assets.fake)
            a = np.asarray(img, float) / 255
            self.assertGreater(((a[..., 0] > 0.6) & (a[..., 1] < 0.3)).sum(), 50)       # 红色立牌
            self.assertGreater(((a[..., 2] > 0.6) & (a[..., 0] < 0.4)).sum(), 500)      # 蓝色底纸

    def test_ground_px_limits_ground_detail(self):
        rng = np.random.default_rng(0)
        noise = rng.random((1024, 1024, 3)).astype(np.float32)          # 逐像素噪声：入库尺寸越小越平
        assets = pg.Assets(ground={"plain": noise})
        sharp = pg.GroundCache(assets).get("plain", 512)
        assets.ground_px = 256
        soft = pg.GroundCache(assets).get("plain", 512)
        self.assertEqual(sharp.shape, soft.shape)
        self.assertGreater(sharp.std(), soft.std() * 1.5)

    def test_shadow_falls_lower_right(self):
        assets = pg.Assets(ground={"plain": np.full((64, 64, 3), 0.7, np.float32)},
                           standee={"k": np.ones((300, 90, 4), np.float32)},
                           road=pg.placeholder_road(), edge=pg.placeholder_edge())
        items = [{"artKey": "k", "kind": "standee", "height": 1.0}]
        scene = pg.Scene(-3, -3, 7, 7, {(i, j): "plain" for i in range(-3, 4) for j in range(-3, 4)},
                         [pg.Card("k", 0.5, 0.5, 1.0)], [])
        cam = pg.Camera(600, 400, 4, ortho=True)
        img = np.asarray(pg.render(scene, cam, assets, items, 1, pg.SHADOWS["lowerRight"]), float)[..., :3]

        def lum(x, z):
            sx, sy = cam.project([(x, 0, z)])[0]
            return img[int(sy), int(sx)].mean()
        lit = lum(0.225, 0.3)          # 立牌左后方（光来的一侧）
        shaded = lum(0.775, 0.7)       # 右前方 = 屏幕右下
        self.assertLess(shaded, lit - 20)

    def test_sight_greys_outside_and_region_clips(self):
        img, _, cam = pg.make_preview(ITEMS, cols=9, seed=3, use_real=False, sight=1, region=5, pawn=False,
                                      terrains=["plain"], settlements=1, roads=False, size=(360, 202), ss=1)
        a = np.asarray(img, float) / 255

        def sat(x, z):
            sx, sy = cam.project([(x, 0, z)])[0]
            p = a[int(sy), int(sx)]
            return p.max() - p.min()
        self.assertGreater(sat(1.5, 0.95), 0.08)        # 视野内（相邻格）保持原色
        self.assertLess(sat(2.5, 0.95), 0.05)           # 视野外变灰
        sx, sy = cam.project([(3.6, 0, 0.5)])[0]       # 5×5 地区之外是书页空白
        np.testing.assert_allclose(a[int(sy), int(sx)], np.array(pg.PAGE_COLOR) / 255, atol=0.02)

    def test_boundaries_curve_and_shore_dressing(self):
        # 交界扭曲：位移有界；左湖右原野时，交界线不是一条直线（x = ±0.1 处在某些 z 上属于对面）
        xs, zs = np.meshgrid(np.linspace(-5, 5, 101), np.linspace(-5, 5, 101))
        dx, dz = pg.warp(xs, zs, 3)
        self.assertLessEqual(float(np.hypot(dx, dz).max()), pg.WARP_AMP * 1.42)
        half = {(i, j): ("lake" if i < 0 else "plain") for i in range(-4, 4) for j in range(-4, 4)}
        own = [(pg.owner(half, -0.1, z, 3), pg.owner(half, 0.1, z, 3)) for z in np.linspace(-3, 3, 61)]
        self.assertTrue(any(a == "plain" or b == "lake" for a, b in own))
        self.assertTrue(all(pg.owner(half, x, 0.3, 3) == ("lake" if x < 0 else "plain") for x in (-0.5, 0.5)))
        # 布置：填充小件都落在画成本格地形的地面上；水面上的只在岸边；陆地沿岸有岸边件
        cam = pg.Camera(640, 360, 7)
        assets = pg.load_assets(ITEMS, ["plain", "lake"], al.WORK_DIR, al.RAW_DIR, False)
        scene = pg.build_scene(ITEMS, assets, cam, ["plain", "lake"], 5, settlements=1, roads=False)
        band = next(it["shore"]["band"] for it in ITEMS if it.get("shore"))
        fillers = [c for c in scene.cards if c.key.startswith("filler.")]
        self.assertTrue(fillers)
        for c in fillers:
            t = scene.terrain[(math.floor(c.x), math.floor(c.z))]
            self.assertEqual(pg.owner(scene.terrain, c.x, c.z, 5), t)
            if t == "lake":
                self.assertTrue(any(pg.owner(scene.terrain, c.x + a * band, c.z + b * band, 5) != "lake"
                                    for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1), (.7, .7), (-.7, .7), (.7, -.7), (-.7, -.7))))
        shore = [c for c in fillers if scene.terrain[(math.floor(c.x), math.floor(c.z))] == "plain"
                 and c.key == "filler.reeds"]          # 原野的池里没有芦苇，有就是岸边件
        self.assertTrue(shore)

    def test_cli(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "p.png"
            rc = pg.main(["--cols", "20", "--seed", "3", "--size", "240x135", "--ss", "1", "--placeholders",
                          "--ortho", "--terrains", "plain,mountain,woods", "--out", str(out)])
            self.assertEqual(rc, 0)
            rc = pg.main(["--zoom", "near", "--sight", "1", "--region", "7", "--size", "240x135", "--ss", "1",
                          "--placeholders", "--ground-px", "1024", "--out", str(out)])
            self.assertEqual(rc, 0)
            self.assertTrue(out.exists())
            self.assertEqual(pg.main(["--terrains", "nowhere", "--out", str(out)]), 2)
            self.assertEqual(pg.main(["--zoom", "far", "--out", str(out)]), 2)       # far 需要 --region


if __name__ == "__main__":
    unittest.main()
