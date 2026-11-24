"""M3-WO3 v1.3 的测试：地形纸层（unwarp、层号、侧壁、射线求交、落点）、折纸房屋（摆放配方、面）、
房屋部件图集（build_house_kit）、重叠边接合（seam_blend）。"""
from __future__ import annotations

import math
import unittest

import numpy as np

import synth  # noqa: F401  （把 tools/art 放进 sys.path）
import artlib as al
import build_house_kit as bhk
import check_tile
import preview_grid as pg
import seam_blend

ITEMS = al.load_list(al.DEFAULT_LIST)


def scene_of(terrain: dict, layers: bool = True) -> pg.Scene:
    xs, zs = [k[0] for k in terrain], [k[1] for k in terrain]
    sc = pg.Scene(min(xs), min(zs), max(xs) - min(xs) + 1, max(zs) - min(zs) + 1, terrain, [], [], [])
    if layers:
        sc.levels = pg.cell_levels(terrain)
    return sc


def block(kind: str, cells, w: int = 9, h: int = 9, base: str = "plain") -> dict:
    t = {(i, j): base for i in range(-4, w - 4) for j in range(-4, h - 4)}
    for c in cells:
        t[c] = kind
    return t


class UnwarpTest(unittest.TestCase):
    def test_round_trip(self):
        rng = np.random.default_rng(7)
        u, v = rng.uniform(-8, 8, 1000), rng.uniform(-8, 8, 1000)
        for seed in (1, 5, 99):
            x, z = pg.unwarp(u, v, seed)
            dx, dz = pg.warp(x, z, seed)
            self.assertLess(np.abs(x + dx - u).max(), 1e-4)
            self.assertLess(np.abs(z + dz - v).max(), 1e-4)


class LevelTest(unittest.TestCase):
    def test_mountain_level_is_bfs_depth_capped(self):
        t = block("mountain", [(a, b) for a in range(-3, 4) for b in range(-3, 4)])
        lv = pg.cell_levels(t)
        self.assertEqual(lv[(-3, 0)], 1)           # 边缘
        self.assertEqual(lv[(-2, 0)], 2)           # 深 1
        self.assertEqual(lv[(-1, 0)], 3)           # 深 2
        self.assertEqual(lv[(0, 0)], 3)            # 深 3 → 封顶 3
        self.assertNotIn((-4, 0), lv)              # 原野不在表里 = 0 层

    def test_negative_levels_and_hill_flat(self):
        t = block("abyss", [(a, b) for a in range(-2, 3) for b in range(-2, 3)])
        t[(3, 3)] = "hill"
        t[(-4, -4)] = "lake"
        t[(4, -4)] = "marsh"
        lv = pg.cell_levels(t)
        self.assertEqual(lv[(-2, 0)], -1)
        self.assertEqual(lv[(0, 0)], -2)           # 深 1 起就到 −2 封底
        self.assertNotIn((3, 3), lv)               # 丘陵不抬层（用户 2026-11-24 定）
        self.assertEqual(lv[(-4, -4)], -1)
        self.assertEqual(lv[(4, -4)], -0.5)

    def test_map_edge_counts_as_same_terrain(self):
        t = {(i, j): "mountain" for i in range(3) for j in range(3)}
        self.assertTrue(all(v == 1 for v in pg.cell_levels(t).values()))   # 没有异种邻格 → 全是边缘层（深 0）

    def test_inset_step_inside_same_terrain(self):
        t = block("mountain", [(a, b) for a in range(-3, 4) for b in range(-3, 4)])
        sc = scene_of(t)
        seed = 1
        # 在扭曲坐标里取 (-2, 0) 这格（层 2）贴着西邻 (-3, 0)（层 1）的一条带：内缩带里取邻格的层号
        u = np.array([-2 + 0.03, -2 + 0.5])
        v = np.array([0.5, 0.5])
        x, z = pg.unwarp(u, v, seed)
        np.testing.assert_allclose(pg.level_xy(sc, x, z, seed), [1, 2])

    def test_flat_scene_has_no_levels_or_walls(self):
        sc = scene_of(block("mountain", [(0, 0), (1, 0)]), layers=False)
        self.assertEqual(pg.build_walls(sc, 1), [])
        self.assertTrue(pg.level_ok(sc, 0.5, 0.5, 1))


class WallTest(unittest.TestCase):
    def test_walls_only_where_levels_differ(self):
        t = block("mountain", [(0, 0), (1, 0)])
        t[(-3, -3)] = "woods"                      # 异种但同为 0 层 → 无侧壁
        sc = scene_of(t)
        walls = pg.build_walls(sc, 1)
        cells = {w.cell for w in walls}
        self.assertEqual(cells, {(0, 0), (1, 0)})
        # 每格 3 条朝外的边（两格之间那条同层、无壁），每边 8 段
        self.assertEqual(len(walls), 6 * 8)
        for w in walls:
            self.assertAlmostEqual(w.y0, 0.0)
            self.assertAlmostEqual(w.y1, pg.LEVEL_STEP)

    def test_walls_follow_warped_boundary_and_share_vertices(self):
        seed = 3
        sc = scene_of(block("lake", [(0, 0)]))
        walls = pg.build_walls(sc, seed)
        self.assertEqual(len(walls), 4 * 8)
        pts = np.array([w.p0 for w in walls] + [w.p1 for w in walls])
        dx, dz = pg.warp(pts[:, 0], pts[:, 1], seed)
        wx, wz = pts[:, 0] + dx, pts[:, 1] + dz
        # 反扭曲后的点再扭曲回去，正好落在 (0, 0) 这格的格线上
        on_edge = np.minimum.reduce([np.abs(wx - 0), np.abs(wx - 1), np.abs(wz - 0), np.abs(wz - 1)])
        self.assertLess(on_edge.max(), 1e-4)
        # 相邻两段首尾相接（同一条边上共用顶点）
        for k in range(len(walls) - 1):
            if k % 8 != 7:
                np.testing.assert_allclose(walls[k].p1, walls[k + 1].p0, atol=1e-12)
        # 下陷：侧壁从 −1 层到 0 层，法线朝湖心
        for w in walls:
            self.assertAlmostEqual(w.y0, -pg.LEVEL_STEP)
            self.assertAlmostEqual(w.y1, 0.0)
            mx, mz = (w.p0[0] + w.p1[0]) / 2, (w.p0[1] + w.p1[1]) / 2
            self.assertGreater(w.normal[0] * (0.5 - mx) + w.normal[1] * (0.5 - mz), 0)

    def test_sunken_cells_on_map_edge_get_walls(self):
        """v1.3.1 第 3 条：贴着地图外沿的下陷格也要补一道接到书页的纸边，不然湖面与书页之间露缝。"""
        t = {(i, j): "plain" for i in range(3) for j in range(3)}
        t[(0, 1)] = "lake"                          # 西边沿上的湖
        t[(2, 2)] = "mountain"                      # 东南角的山
        walls = pg.build_walls(scene_of(t), 1)
        lake_edge = [w for w in walls if w.cell == (0, 1) and w.p0[0] == 0 and w.p1[0] == 0]
        self.assertEqual(len(lake_edge), 8)
        for w in lake_edge:
            self.assertAlmostEqual(w.y0, -pg.LEVEL_STEP)
            self.assertAlmostEqual(w.y1, 0.0)
            self.assertEqual(w.normal, (1.0, 0.0))  # 朝坑内
        mount_edge = [w for w in walls if w.cell == (2, 2) and (w.p0[0] == 3 or w.p0[1] == 3) and w.p0[0] == w.p1[0] or
                      w.cell == (2, 2) and w.p0[1] == w.p1[1] == 3]
        self.assertEqual(len(mount_edge), 16)

    def test_deterministic(self):
        t = block("mountain", [(a, b) for a in range(-2, 3) for b in range(-2, 2)])
        a = pg.build_walls(scene_of(t), 4)
        b = pg.build_walls(scene_of(t), 4)
        self.assertEqual(a, b)


class CastTest(unittest.TestCase):
    def test_raised_cell_shows_wall_facing_camera(self):
        t = block("mountain", [(0, -1)])
        sc = scene_of(t)
        cam = pg.Camera(320, 180, 3.0)
        tiles = {k: np.full((16, 16, 3), 0.3 if v == "mountain" else 0.6, np.float32) for k, v in t.items()}
        rgb, depth = pg.cast_ground(sc, cam, tiles, 1, pg.light_vec((0.55, 0.4)), lambda i, j: False)
        # 朝镜头的那道侧壁在 (0.5, ·, 0) 的格线上：落在 y = 0 与 y = LEVEL_STEP 的投影之间，颜色是纸芯白
        x_mid, z_edge = 0.5, 0.0
        dx, dz = pg.warp(np.array([x_mid]), np.array([z_edge]), 1)
        x0, z0 = pg.unwarp(np.array([x_mid]), np.array([z_edge]), 1)
        lo = cam.project([(x0[0], 0.0, z0[0])])[0]
        hi = cam.project([(x0[0], pg.LEVEL_STEP, z0[0])])[0]
        py = int((lo[1] + hi[1]) / 2)
        px = int((lo[0] + hi[0]) / 2)
        self.assertGreater(rgb[py, px].min(), 0.64)              # 纸芯白（顶面 0.3、地面 0.6 都更暗）
        self.assertTrue(np.isfinite(depth).all())

    def test_picking_needs_height_correction(self):
        """工单 §3.13 易错点 b：抬高的格子按 y = 0 求交会选错，按层高再求一次才对。"""
        cam = pg.Camera(1920, 1080, 6.0)
        h = 3 * pg.LEVEL_STEP
        p = np.array([0.5, h, -1.5])
        sx, sy = cam.project([p])[0]
        gx, gz = cam.ground_at(sx, sy)                  # 天真的 y = 0 求交
        err = math.hypot(gx - p[0], gz - p[2])
        self.assertGreater(err, 0.08)                   # 0.15 高、53° 俯角 → 约 0.11 格的偏差
        o, d = cam.rays(np.array([sx]), np.array([sy]))
        t = (h - o[0, 1]) / d[0, 1]
        self.assertLess(abs(o[0, 2] + d[0, 2] * t - p[2]), 1e-6)

    def test_flat_render_still_works(self):
        img, _a, _c = pg.make_preview(ITEMS, cols=6, seed=2, size=(240, 135), ss=1, use_real=False, layers=False,
                                      terrains=["plain", "mountain"])
        self.assertEqual(img.size, (240, 135))


class SightTest(unittest.TestCase):
    def test_straight_by_default(self):
        self.assertEqual(pg.sight_mask(1, 0, 16, 1, 3, False), 0.0)
        self.assertEqual(pg.sight_mask(2, 0, 16, 1, 3, False), 1.0)
        self.assertEqual(pg.sight_mask(5, 5, 16, None, 3, True), 0.0)

    def test_warped_boundary_curves_and_feathers(self):
        # 视野右边界（世界 x = 2）两侧的格拼起来看：0.5 等值线随 z 左右摆动，过渡带有宽度
        m = np.concatenate([np.concatenate([pg.sight_mask(1, j, 64, 1, 3, True), pg.sight_mask(2, j, 64, 1, 3, True)], 1)
                            for j in (0,)], 0)
        self.assertLess(m[:, :8].max(), 0.02)            # 视野里面是原色
        self.assertGreater(m[:, -8:].min(), 0.98)        # 外面全灰
        self.assertTrue(((m > 0.05) & (m < 0.95)).any())  # 有羽化过渡
        x_half = [int(np.argmax(row > 0.5)) for row in m]
        self.assertGreater(max(x_half) - min(x_half), 4)  # 0.5 等值线不是一条竖直线（扭曲幅度 0.16 格 ≈ 10px）

    def test_level_step_override_restores(self):
        before = pg.LEVEL_STEP
        pg.make_preview(ITEMS, cols=6, seed=2, size=(160, 90), ss=1, use_real=False, terrains=["plain", "mountain"],
                        level_step=0.08)
        self.assertEqual(pg.LEVEL_STEP, before)


class PlacementTest(unittest.TestCase):
    def test_cards_stand_on_their_level_and_off_edges(self):
        img, assets, cam = pg.make_preview(ITEMS, cols=6, seed=2, size=(240, 135), ss=1, use_real=False,
                                           terrains=["plain", "mountain", "lake"], region=9)
        # make_preview 不返回 scene；单独重建一遍检查
        A = pg.load_assets(ITEMS, ["plain", "mountain", "lake"], al.WORK_DIR, al.RAW_DIR, False)
        sc = pg.build_scene(ITEMS, A, pg.Camera(240, 135, 6), ["plain", "mountain", "lake"], 2, region=9)
        self.assertTrue(sc.levels)
        raised = [c for c in sc.cards if c.y > 0]
        self.assertTrue(raised)
        for c in sc.cards:
            self.assertAlmostEqual(c.y, pg.level_at(sc, c.x, c.z, 2) * pg.LEVEL_STEP)


class HouseTest(unittest.TestCase):
    def setUp(self):
        self.types = dict(bhk.HOUSE_TYPES)

    def place(self, kind="village", seed=1, terrain=None, near_road=()):
        terrain = terrain or {(i, j): "settlement" if (i, j) == (0, 0) else "plain"
                              for i in range(-2, 3) for j in range(-2, 3)}
        return pg.place_houses(0, 0, kind, seed, terrain, self.types, set(), list(near_road))

    def test_recipe_counts_and_determinism(self):
        for seed in range(1, 8):
            a, b = self.place(seed=seed), self.place(seed=seed)
            self.assertEqual(a, b)
            self.assertLessEqual(len(a), 5)
            self.assertGreaterEqual(len(a), 2)

    def test_constraints(self):
        for kind in ("village", "town", "sectSeat"):
            for seed in range(1, 6):
                hs = self.place(kind, seed)
                if kind == "sectSeat":
                    self.assertEqual(hs[0].kind, "hall")
                for k, h in enumerate(hs):
                    poly = pg.house_corners(h, self.types)
                    self.assertLessEqual(abs(h.yaw), pg.HOUSE_FACING + 1e-9)          # 正立面朝镜头 ±60°
                    self.assertFalse(pg._point_in_poly(pg.clear_centre(0, 0, kind), poly, pg.clear_radius(kind)))   # 空地
                    for px, pz in poly:                                               # 四角都在本格
                        dx, dz = pg.warp(px, pz, seed)
                        self.assertEqual((math.floor(px + dx), math.floor(pz + dz)), (0, 0))
                    for o in hs[k + 1:]:                                              # 互不相交
                        self.assertFalse(pg._sat_overlap(poly, pg.house_corners(o, self.types)))
                    self.assertFalse(self.blocks_pawn(poly, pg.clear_centre(0, 0, kind)), (kind, seed, k))

    @staticmethod
    def blocks_pawn(poly, apex, r=0.45, half=math.radians(40)):
        """独立于实现的稠密检查：朝镜头（+z）±40°、半径 0.45 的扇形里的点有没有落进房子（v1.3.1 第 5 条）。"""
        ax, az = apex
        for rr in np.linspace(0.01, r, 30):
            for ang in np.linspace(-half, half, 31):
                if pg._point_in_poly((ax + rr * math.sin(ang), az + rr * math.cos(ang)), poly):
                    return True
        return False

    def test_village_fill_rate_shrinks_before_dropping(self):
        counts = [len(self.place("village", seed)) for seed in range(200)]
        self.assertGreaterEqual(sum(c >= 3 for c in counts) / 200, 0.95)
        # 先缩再减：有缩小过的村子（尺寸系数 < 0.92 的房子）
        scales = [h.scale for seed in range(200) for h in self.place("village", seed)]
        self.assertTrue(any(sc < 0.92 * 0.95 for sc in scales))

    def test_avoids_road(self):
        road = [(0.5 + 0.5 * t, 0.5) for t in np.linspace(0, 1, 8)]
        for seed in range(1, 6):
            for h in self.place(seed=seed, near_road=road):
                poly = pg.house_corners(h, self.types)
                self.assertFalse(any(pg._point_in_poly(p, poly, pg.ROAD_W / 2) for p in road))

    def test_faces_budget_and_normals(self):
        for kind in self.types:
            h = pg.House(kind, 0.5, 0.5, 0.3, 1.0, self.types[kind]["walls"][0], self.types[kind]["roofs"][0],
                         "hall" if kind == "hall" else "plaster.0", (0, 0))
            faces = pg.house_faces(h, self.types)
            self.assertLessEqual(len(faces) * 2, 120)                  # 每面两个三角形；预算 60–120
            dm = pg.house_dims(h, self.types)
            for f in faces:
                if f.get("frame") == "house.chimney":
                    continue                                       # 烟囱是另一个小盒子，法线相对它自己
                c = np.array(f["corners"])
                centre = c.mean(0)
                n = np.array(f["normal"])
                # 外法线：面中心沿法线走一点，离房屋中轴更远（屋面、台基顶面朝上）
                axis = np.array([0.0, centre[1], 0.0]) if abs(n[1]) < 0.5 else centre - [0, 1, 0]
                self.assertGreaterEqual(np.dot(centre - axis, n), -1e-9, (kind, f.get("frame")))
                self.assertLessEqual(c[:, 1].max(), dm["ridge"] + 0.06)
            roofs = [f for f in faces if f.get("frame", "").startswith("house.roof.")]
            self.assertEqual(len(roofs), 2)
            length = dm["w"] + 2 * pg.HOUSE_GABLE_OUT
            self.assertEqual(roofs[0]["rep"][0], math.ceil(length / 0.27 - 1e-6))

    def test_preview_with_houses(self):
        img, assets, _c = pg.make_preview(ITEMS, cols=3, seed=1, size=(320, 180), ss=1, use_real=False,
                                          houses=True, terrains=["plain"], region=5)
        self.assertIn("house.roof.tile", assets.house_faces)
        self.assertEqual(img.size, (320, 180))


class HouseKitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rep = al.Report()
        cls.atlas, cls.meta = bhk.build_kit(ITEMS, None, cls.rep, placeholders=True)

    def test_frames_inside_and_disjoint(self):
        aw, ah = self.meta["size"]
        self.assertEqual(self.rep.errors, [])
        self.assertEqual(len(self.meta["frames"]), 19)
        rects = [f["rect"] for f in self.meta["frames"]]
        p = self.meta["padding"] // 2
        for k, (x, y, w, h) in enumerate(rects):
            self.assertGreaterEqual(x - p, 0)
            self.assertGreaterEqual(y - p, 0)
            self.assertLessEqual(x + w + p, aw)
            self.assertLessEqual(y + h + p, ah)
            for (x2, y2, w2, h2) in rects[k + 1:]:
                self.assertTrue(x + w + p <= x2 - p or x2 + w2 + p <= x - p or y + h + p <= y2 - p or y2 + h2 + p <= y - p)

    def test_uv_half_texel_inset(self):
        aw, ah = self.meta["size"]
        for f in self.meta["frames"]:
            x, y, w, h = f["rect"]
            u0, v0, u1, v1 = f["uv"]
            self.assertAlmostEqual(u0, (x + 0.5) / aw, places=5)
            self.assertAlmostEqual(v1, (y + h - 0.5) / ah, places=5)
            self.assertLess(u0, u1)
            self.assertLess(v0, v1)

    def test_wrap_padding_repeats_opposite_edge(self):
        p = self.meta["padding"] // 2
        for f in self.meta["frames"]:
            x, y, w, h = f["rect"]
            a = self.atlas
            if "u" in f["wrap"]:
                np.testing.assert_allclose(a[y:y + h, x - p:x], a[y:y + h, x + w - p:x + w], atol=1e-6)
                np.testing.assert_allclose(a[y:y + h, x + w:x + w + p], a[y:y + h, x:x + p], atol=1e-6)
            else:
                np.testing.assert_allclose(a[y:y + h, x - 1], a[y:y + h, x], atol=1e-6)    # 不平铺：边缘外扩
            if f["wrap"] == "uv":
                np.testing.assert_allclose(a[y - p:y, x:x + w], a[y + h - p:y + h, x:x + w], atol=1e-6)

    def test_opaque_and_deterministic(self):
        self.assertTrue(self.meta["opaque"])
        atlas2, meta2 = bhk.build_kit(ITEMS, None, al.Report(), placeholders=True)
        np.testing.assert_array_equal(self.atlas, atlas2)
        self.assertEqual(self.meta, meta2)

    def test_house_types_carry_ridge(self):
        for k, t in self.meta["houseTypes"].items():
            self.assertAlmostEqual(t["ridge"], t["base"] + t["wallH"] + t["d"] / 2 * math.tan(math.radians(t["pitch"])),
                                   places=3)


class SeamBlendTest(unittest.TestCase):
    def test_makes_nonperiodic_tileable(self):
        img = synth.nonperiodic_noise(256)
        img = img + np.linspace(0, 0.3, 256, dtype=np.float32)[None, :, None]   # 左右明显接不上
        img = np.clip(img, 0, 1)
        r0 = check_tile.check(img, "raw", al.Report(), max_chroma=None)
        out = seam_blend.seam_blend(img, 32)
        r1 = check_tile.check(out, "blend", al.Report(), max_chroma=None)
        self.assertEqual(out.shape, img.shape)
        self.assertGreater(r0["x"]["ratio"], 2.0)
        self.assertLess(r1["x"]["ratio"], 1.6)
        self.assertLess(r1["y"]["ratio"], 1.6)

    def test_strip_premultiplied(self):
        road = synth.road_strip(512, 128, bg=(0, 0, 0, 0), periodic=False)
        out = seam_blend.seam_blend(road, 32, strip=True)
        self.assertEqual(out.shape, road.shape)
        self.assertTrue((out[..., 3] < 0.02).any())               # 透明区仍透明
        rep = al.Report()
        check_tile.check(out, "road", rep, strip=True, max_chroma=None)
        self.assertEqual(rep.errors, [])

    def test_bad_overlap(self):
        with self.assertRaises(ValueError):
            seam_blend.blend_axis(np.zeros((10, 10, 3)), 6, 1)


if __name__ == "__main__":
    unittest.main()
