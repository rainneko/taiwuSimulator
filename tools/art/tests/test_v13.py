"""M3-WO3 v1.3 / v1.3.1 的测试：地形纸层（unwarp、层号、侧壁、射线求交、落点）、
单栋房屋立牌的摆放配方（v1.3.1，取代 v1.3 的折纸房屋）、重叠边接合（seam_blend）。"""
from __future__ import annotations

import math
import unittest

import numpy as np

import synth  # noqa: F401  （把 tools/art 放进 sys.path）
import artlib as al
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
    """v1.3.1 单栋房屋立牌（工单 §3.12）：一栋一张立牌，按聚居配方摆进格里。"""
    def setUp(self):
        self.types = pg.house_types_from(ITEMS)

    def place(self, kind="village", seed=1, near_road=()):
        return pg.place_houses(0, 0, kind, seed, self.types, list(near_road))

    def test_types_from_list(self):
        self.assertEqual(set(self.types), {"cottage", "tile", "long", "shop", "tower", "hall"})
        for kind in pg.HOUSE_RECIPES.values():
            for hk in kind[1]:
                self.assertIn(hk, self.types)

    def test_recipe_counts_and_determinism(self):
        for kind, ((lo, hi), _c, _k) in pg.HOUSE_RECIPES.items():
            for seed in range(1, 8):
                a, b = self.place(kind, seed), self.place(kind, seed)
                self.assertEqual(a, b)
                self.assertLessEqual(len(a), hi)
                self.assertGreaterEqual(len(a), 2, (kind, seed))
                if kind in pg.HOUSE_FIRST:
                    self.assertEqual(a[0].kind, pg.HOUSE_FIRST[kind])

    def test_size_matches_asset(self):
        asp = {k: (h, a) for v in self.types.values() for k, h, a in v}
        for seed in range(1, 6):
            for h in self.place("town", seed):
                hh, a = asp[h.key]
                self.assertAlmostEqual(h.w / h.h, a, places=6)          # 宽 = 高 × 立牌宽高比
                self.assertLessEqual(h.h, hh * 1.08 + 1e-9)

    def test_constraints(self):
        for kind in pg.HOUSE_RECIPES:
            for seed in range(1, 6):
                hs = self.place(kind, seed)
                for k, h in enumerate(hs):
                    poly = pg.house_corners(h)
                    self.assertFalse(pg._point_in_poly(pg.clear_centre(0, 0, kind), poly, pg.clear_radius(kind)))   # 空地
                    for px, pz in poly:                                               # 四角都在本格
                        dx, dz = pg.warp(px, pz, seed)
                        self.assertEqual((math.floor(px + dx), math.floor(pz + dz)), (0, 0))
                    for o in hs[k + 1:]:                                              # 互不相交，前后错开时后面那栋露出一半
                        self.assertFalse(pg._sat_overlap(poly, pg.house_corners(o)))
                        self.assertFalse(pg._blocks(h, o))
                    self.assertFalse(self.blocks_pawn(poly, pg.clear_centre(0, 0, kind)), (kind, seed, k))

    def test_back_house_stays_visible(self):
        front = pg.House("a", "shop", 0.5, 0.6, 0.38, 0.45, (0, 0))     # 高的二层楼在前
        close = pg.House("b", "tile", 0.5, 0.42, 0.36, 0.3, (0, 0))      # 只后移 0.18：露出不到一半
        far = pg.House("c", "tile", 0.5, 0.3, 0.36, 0.3, (0, 0))         # 后移 0.3：露出一半以上
        side = pg.House("d", "tile", 0.82, 0.42, 0.36, 0.3, (0, 0))      # 横向只重叠一点
        self.assertTrue(pg._blocks(front, close))
        self.assertFalse(pg._blocks(front, far))
        self.assertFalse(pg._blocks(front, side))

    @staticmethod
    def blocks_pawn(poly, apex, r=0.45, half=math.radians(40)):
        """独立于实现的稠密检查：朝镜头（+z）±40°、半径 0.45 的扇形里的点有没有落进房子（v1.3.1 第 5 条）。"""
        ax, az = apex
        for rr in np.linspace(0.01, r, 30):
            for ang in np.linspace(-half, half, 31):
                if pg._point_in_poly((ax + rr * math.sin(ang), az + rr * math.cos(ang)), poly):
                    return True
        return False

    def test_fill_rate_shrinks_before_dropping(self):
        for kind in pg.HOUSE_RECIPES:
            lo = pg.HOUSE_RECIPES[kind][0][0]
            counts = [len(self.place(kind, seed)) for seed in range(200)]
            self.assertGreaterEqual(sum(c >= lo for c in counts) / 200, 0.8, kind)
        counts = [len(self.place("village", seed)) for seed in range(200)]
        self.assertGreaterEqual(sum(c >= 3 for c in counts) / 200, 0.95)
        # 先缩再减：有缩小过的村子（比例 < 0.92 的房子）
        hmax = {k: h for v in self.types.values() for k, h, _a in v}
        self.assertTrue(any(h.h < hmax[h.key] * 0.92 * 0.95 for seed in range(200) for h in self.place("village", seed)))

    def test_avoids_road(self):
        road = [(0.5 + 0.5 * t, 0.5) for t in np.linspace(0, 1, 8)]
        for seed in range(1, 6):
            for h in self.place(seed=seed, near_road=road):
                poly = pg.house_corners(h)
                self.assertFalse(any(pg._point_in_poly(p, poly, pg.ROAD_W / 2) for p in road))

    def test_preview_with_houses(self):
        img, assets, cam = pg.make_preview(ITEMS, cols=3, seed=1, size=(320, 180), ss=1, use_real=False,
                                           houses=True, terrains=["plain"], region=5)
        self.assertEqual(img.size, (320, 180))
        self.assertTrue(assets.house_types)
        A = pg.load_assets(ITEMS, ["plain"], al.WORK_DIR, al.RAW_DIR, False)
        A.house_types = pg.house_types_from(ITEMS)
        sc = pg.build_scene(ITEMS, A, pg.Camera(320, 180, 3), ["plain"], 1, region=5, houses=True)
        self.assertTrue(sc.houses)
        keys = {c.key for c in sc.cards}
        for h in sc.houses:                                               # 房子就是普通立牌，阴影、灰化、遮挡都走立牌那一套
            self.assertIn(h.key, keys)
            self.assertIn(h.key, A.standee)
        self.assertFalse(any(c.key.startswith("loc.") and c.key.split(".")[1] in pg.HOUSE_RECIPES for c in sc.cards))


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
