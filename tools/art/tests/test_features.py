"""M3-WO3 v1.4 候选原型（region_features.py，preview_grid 的 --rivers / --ecotones / --ridges）的测试。
河的不变量按执行主管 2026-11-24 的要求跑 200 个种子。"""
from __future__ import annotations

import math
import unittest

import numpy as np

import synth  # noqa: F401  （把 tools/art 放进 sys.path）
import artlib as al
import preview_grid as pg
import region_features as rf

rf.bind(pg)
ITEMS = al.load_list(al.DEFAULT_LIST)
TERRAINS = ["plain", "woods", "mountain", "lake", "marsh"]
SEEDS = range(1, 201)


def region_terrain(seed: int, n: int = 15, terrains=TERRAINS) -> tuple[dict, list, dict]:
    """与 build_scene 同一种做法（抖动网格上的种子点、最近者成片）生成 n×n 地区 + 两个聚居点 + 道路，但只算地区本身（快）。"""
    lo = -(n // 2)
    seeds = []
    for gx in range(lo - 4, lo + n + 4, 3):
        for gz in range(lo - 4, lo + n + 4, 3):
            seeds.append((gx + 3 * pg.hf(seed, gx, gz, 1), gz + 3 * pg.hf(seed, gx, gz, 2),
                          terrains[pg.h32(seed, gx, gz, 3) % len(terrains)]))
    sp = np.array([(a, b) for a, b, _ in seeds])
    terrain = {}
    for i in range(lo, lo + n):
        for j in range(lo, lo + n):
            d = np.hypot(sp[:, 0] - (i + 0.5), sp[:, 1] - (j + 0.5))
            d += np.random.default_rng(pg.h32(seed, i, j, 4)).random(len(d)) * 1.2
            terrain[(i, j)] = seeds[int(np.argmin(d))][2]
    ang = 2 * math.pi * pg.hf(seed, 1, 7)
    r = 2.5 + 1.5 * pg.hf(seed, 1, 8)
    other = (int(round(r * math.cos(ang))), int(round(r * math.sin(ang) * 0.6)))
    locs = {(0, 0): "village", other: "town"}
    for c in locs:
        terrain[c] = "settlement"
    path, (ci, cj) = [(lo, 0)], (lo, 0)
    for bi, bj in ((0, 0), other):
        while (ci, cj) != (bi, bj):
            if ci != bi and (cj == bj or pg.hf(seed, ci, cj, 60) < 0.6):
                ci += 1 if bi > ci else -1
            else:
                cj += 1 if bj > cj else -1
            path.append((ci, cj))
    return terrain, path, locs


_CACHE: dict = {}


def rivers_of(seed: int):
    if seed not in _CACHE:
        terrain, road, locs = region_terrain(seed)
        levels = pg.cell_levels(terrain)
        rivers = rf.make_rivers(terrain, levels, road, seed)
        _CACHE[seed] = (terrain, levels, road, locs, rivers)
    return _CACHE[seed]


def poly_dist(P: np.ndarray, G: np.ndarray) -> np.ndarray:
    """点集 P 到折线 G 的距离。"""
    best = np.full(len(P), np.inf)
    for a, b in zip(G[:-1], G[1:]):
        e = b - a
        t = np.clip(((P - a) @ e) / (e @ e), 0, 1)
        best = np.minimum(best, np.hypot(*(P - (a + t[:, None] * e)).T))
    return best


class RiverTest(unittest.TestCase):
    def test_invariants_200_seeds(self):
        total = 0
        for seed in SEEDS:
            terrain, levels, road, locs, rivers = rivers_of(seed)
            self.assertLessEqual(len(rivers), 2, seed)
            for r in rivers:
                total += 1
                # 只走允许的格边：两侧都 ≤ 0，或抬高区域的外沿；不碰湖面格
                for a, b in zip(r.grid[:-1], r.grid[1:]):
                    self.assertEqual(abs(a[0] - b[0]) + abs(a[1] - b[1]), 1)
                    self.assertTrue(rf.river_edge_ok(terrain, levels, a, b), (seed, a, b))
                # 中线离任何格心 ≥ 0.18 + w/2 + 0.03
                thr = rf.CLEAR_R + r.width / 2 + rf.CLEAR_PAD
                self.assertTrue((rf.centre_dist(r.pts) >= thr - 1e-6).all(), seed)
                # 宽 0.06 → ≤ 0.14
                self.assertGreaterEqual(r.width.min(), rf.RIVER_W0 - 1e-9)
                self.assertLessEqual(r.width.max(), rf.RIVER_W1 + 1e-9)
                self.assertTrue((np.diff(r.width) >= -1e-12).all())
                # 曲流 + 贴山脚的偏移（扭曲空间里量）有上限
                Q = r.pts + np.stack(pg.warp(r.pts[:, 0], r.pts[:, 1], seed), -1)
                off = np.hypot(*(Q - r.base).T)
                self.assertLessEqual(off.max(), rf.MEANDER_A1 + rf.RIVER_W1 / 2 + rf.FOOT_GAP + 1e-3, seed)
        self.assertGreater(total, 150)          # 大多数地区有河

    def test_chaikin_radius(self):
        for seed in list(SEEDS)[:60]:
            for r in rivers_of(seed)[4]:
                G = np.array(r.grid, np.float64)
                d = poly_dist(r.base, G)
                self.assertLessEqual(d.max(), rf.CHAIKIN_R, seed)
                # 离拐角超过切角半径的点就在折线上
                corners = np.array([G[k] for k in range(1, len(G) - 1)
                                    if tuple(G[k + 1] - G[k]) != tuple(G[k] - G[k - 1])]).reshape(-1, 2)
                if len(corners):
                    far = np.min(np.hypot(r.base[:, None, 0] - corners[None, :, 0],
                                          r.base[:, None, 1] - corners[None, :, 1]), 1) > rf.CHAIKIN_R + 1e-6
                    self.assertTrue((d[far] < 1e-6).all(), seed)

    def test_no_meander_on_unlike_edges(self):
        """异种边（两侧地形不同、且不贴山脚）上振幅为 0：前后各 15 个采样点都是异种边的点，偏移为 0。"""
        checked = 0
        for seed in list(SEEDS)[:80]:
            terrain, levels = rivers_of(seed)[:2]
            for r in rivers_of(seed)[4]:
                T = np.gradient(r.base, axis=0)
                T /= np.hypot(*T.T)[:, None] + 1e-12
                N = np.stack([-T[:, 1], T[:, 0]], -1)
                ca = [(int(x), int(z)) for x, z in np.floor(r.base + N * 0.07)]
                cb = [(int(x), int(z)) for x, z in np.floor(r.base - N * 0.07)]
                unlike = np.array([terrain.get(a) != terrain.get(b) and levels.get(a, 0) <= 0 and levels.get(b, 0) <= 0
                                   for a, b in zip(ca, cb)])
                Q = r.pts + np.stack(pg.warp(r.pts[:, 0], r.pts[:, 1], seed), -1)
                off = np.hypot(*(Q - r.base).T)
                for k in range(15, len(off) - 15):
                    if unlike[k - 15:k + 16].all():
                        self.assertLess(off[k], 2e-3, (seed, k))
                        checked += 1
        self.assertGreater(checked, 50)

    def test_deterministic(self):
        for seed in (3, 17, 101):
            terrain, levels, road, _, rivers = rivers_of(seed)
            again = rf.make_rivers(terrain, levels, road, seed)
            self.assertEqual(len(again), len(rivers))
            for a, b in zip(again, rivers):
                self.assertEqual(a.grid, b.grid)
                self.assertTrue(np.array_equal(a.pts, b.pts))

    def test_crossings(self):
        n_bridge = n_ford = 0
        for seed in SEEDS:
            terrain, levels, road, locs, rivers = rivers_of(seed)
            cr = rf.make_crossings(rivers, road, locs, terrain, seed)
            road_edges = {rf.shared_edge(a, b) for a, b in zip(road[:-1], road[1:])}
            for c in cr:
                self.assertIn(c["edge"], rivers[c["river"]].edges)
                if c["kind"] == "bridge":
                    n_bridge += 1
                    self.assertIn(c["edge"], road_edges)
                    self.assertIn(c["style"], ("arch", "plank"))
                    if c["style"] == "arch":          # 石拱桥只在道路与屏幕水平（沿 x）时
                        self.assertTrue(c["horizontal"])
                else:
                    n_ford += 1
                    self.assertEqual(c["style"], "stones")
            edges = [(c["river"], c["edge"]) for c in cr if c["kind"] == "bridge"]
            self.assertEqual(len(edges), len(set(edges)), seed)      # 道路折返也只放一座
            # 每条跨河的道路边都有桥
            for ri, r in enumerate(rivers):
                for e in road_edges & r.edges:
                    self.assertTrue(any(c["edge"] == e and c["kind"] == "bridge" for c in cr), seed)
        self.assertGreater(n_bridge, 0)
        self.assertGreater(n_ford, 0)

    def test_crossing_items(self):
        cr = [{"style": "arch", "x": 1.0, "z": 2.0, "width": 0.1, "ang": 0.0},
              {"style": "plank", "x": 1.0, "z": 2.0, "width": 0.1, "ang": 1.0},
              {"style": "stones", "x": 1.0, "z": 2.0, "width": 0.1, "ang": 0.5}]
        cards, flats = rf.crossing_items(cr)
        self.assertEqual([c[0] for c in cards], ["bridge.arch"])
        self.assertEqual([f[0] for f in flats], ["bridge.plank", "bridge.stones"])
        self.assertGreaterEqual(flats[0][3], 0.3)

    def test_river_clear(self):
        terrain, levels, road, locs, rivers = next(rivers_of(s) for s in SEEDS if rivers_of(s)[4])
        r = rivers[0]
        k = len(r.pts) // 2
        x, z = r.pts[k]
        self.assertFalse(rf.river_clear(rivers, x, z))
        n = np.array([-r.tan[k, 1], r.tan[k, 0]])
        x2, z2 = r.pts[k] + n * (r.width[k] / 2 + rf.AVOID_PAD + 0.02)
        self.assertLess(rf.river_dist(rivers, x, z), 0)
        self.assertGreater(rf.river_dist(rivers, x2, z2), 0)


class SceneFeaturesTest(unittest.TestCase):
    """接进 build_scene 之后：布置避开河道；过渡带不超过每格填充小件上限。"""

    @classmethod
    def setUpClass(cls):
        cls.A = pg.load_assets(ITEMS, TERRAINS, al.WORK_DIR, al.RAW_DIR, False)
        cls.scenes = {}
        for seed in (1, 5):
            cls.scenes[seed] = pg.build_scene(ITEMS, cls.A, pg.Camera(240, 135, 8), TERRAINS, seed, region=9,
                                              features=frozenset({"rivers", "ecotones", "ridges"}))

    def test_placement_avoids_river(self):
        for seed, sc in self.scenes.items():
            for c in sc.cards:
                if c.key.startswith(("terrain.", "filler.")):
                    self.assertGreaterEqual(rf.river_dist(sc.rivers, c.x, c.z), rf.AVOID_PAD - 1e-9, (seed, c.key))

    def test_filler_cap(self):
        for seed, sc in self.scenes.items():
            cnt: dict = {}
            for c in sc.cards:
                if c.key.startswith("filler."):
                    cell = (math.floor(c.x), math.floor(c.z))
                    cnt[cell] = cnt.get(cell, 0) + 1
            self.assertLessEqual(max(cnt.values()), rf.FILLER_CAP)

    def test_default_has_no_features(self):
        sc = pg.build_scene(ITEMS, self.A, pg.Camera(240, 135, 8), TERRAINS, 5, region=9)
        self.assertEqual((sc.rivers, sc.crossings, sc.overlay, sc.mountain), ([], [], [], None))


class EcotoneTest(unittest.TestCase):
    def setUp(self):
        self.heights = {k: v["height"] for k, v in ((it["artKey"], it) for it in ITEMS) if "height" in v}
        self.heights.update(rf.EXTRA_HEIGHT)
        self.shore = next(it["shore"] for it in ITEMS if it.get("kind") == "ground" and it.get("shore"))

    def run_eco(self, terrain, seed=3, fcount=None):
        sc = pg.Scene(-4, -4, 9, 9, terrain, [], [], [])
        sc.levels = pg.cell_levels(terrain)
        return sc, rf.ecotone_items(sc, terrain, seed, self.heights, lambda k: k, {}, dict(fcount or {}),
                                    self.shore, [], sc.levels)

    def test_mountain_foot_rocks_on_low_side(self):
        t = {(i, j): "plain" for i in range(-4, 5) for j in range(-4, 5)}
        for i in range(-2, 3):
            for j in range(-2, 3):
                t[(i, j)] = "mountain"
        for seed in range(1, 30):
            sc, (cards, flats, overlay) = self.run_eco(t, seed)
            self.assertTrue(cards)
            for key, x, z, h in cards:
                self.assertIn(key, ("filler.rock.0", "filler.rock.1", "filler.tuft.1"))
                self.assertEqual(pg.owner(t, x, z, seed), "plain")
                self.assertEqual(pg.level_at(sc, x, z, seed), 0)
                self.assertLessEqual(rf.boundary_dist(t, x, z, seed, lambda u: u == "mountain"), 0.1 + 1e-6)

    def test_nothing_in_settlement_cells_but_pier(self):
        t = {(i, j): "plain" for i in range(-4, 5) for j in range(-4, 5)}
        t[(0, 0)] = "settlement"
        for i in range(-4, 5):
            t[(i, 1)] = "lake"
        for j in range(-4, 5):
            t[(2, j)] = "woods"
        for seed in range(1, 30):
            sc, (cards, flats, overlay) = self.run_eco(t, seed)
            for key, x, z, h in cards:
                self.assertNotEqual(pg.owner(t, x, z, seed), "settlement")
            self.assertEqual([o[0] for o in overlay], ["loc.prop.pier"])
            px, pz = overlay[0][1:3]
            self.assertLess(abs(px - 0.5), 0.3)       # 码头在聚居格朝湖的那条边上
            for key, x, z, s, a in flats:
                self.assertIn(key, ("ground.piece.lilypad", "ground.piece.puddle"))

    def test_filler_cap_respected(self):
        t = {(i, j): "plain" for i in range(-4, 5) for j in range(-4, 5)}
        for i in range(-4, 5):
            t[(i, 0)] = "woods"
            t[(i, 2)] = "marsh"
        full = {c: rf.FILLER_CAP - 1 for c in t}
        for seed in range(1, 20):
            _, (cards, _, _) = self.run_eco(t, seed, full)
            cnt: dict = {}
            for key, x, z, h in cards:
                c = (math.floor(x), math.floor(z))
                cnt[c] = cnt.get(c, 0) + 1
            self.assertTrue(all(v <= 1 for v in cnt.values()), seed)

    def test_rules_cover_shore(self):
        R = rf.eco_rules(self.shore)
        for c in ("open", "wood", "farm", "stone", "wet"):
            self.assertEqual(R[(c, "water")][0], tuple(self.shore["fillers"]))
        self.assertEqual(R[("open", "stone")][4], "low")


def mountain_blobs(seed: int, n: int = 15) -> dict:
    rng = np.random.default_rng(seed)
    a = rng.random((n + 4, n + 4))
    for _ in range(3):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0) + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    thr = np.quantile(a, 0.55)
    lo = -(n // 2)
    return {(i, j): "mountain" if a[i - lo + 2, j - lo + 2] > thr else "plain"
            for i in range(lo, lo + n) for j in range(lo, lo + n)}


class RidgeTest(unittest.TestCase):
    def test_saddles_200_seeds(self):
        for seed in SEEDS:
            t = mountain_blobs(seed)
            old = pg.cell_levels(t)
            plan = rf.mountain_plan(t, old, seed)
            for c, L in plan.levels.items():
                if t[c] != "mountain":
                    continue
                self.assertLessEqual(L, old[c])               # 只降不升
                self.assertGreaterEqual(L, old[c] - 1)
                self.assertGreaterEqual(L, 1)
                self.assertLessEqual(L, 3)
                if old[c] == 1:
                    self.assertEqual(L, 1)                     # 外圈恒为 +1
                for a, b in ((1, 0), (0, 1)):
                    n = (c[0] + a, c[1] + b)
                    if t.get(n) == "mountain":
                        self.assertLessEqual(abs(plan.levels[n] - L), 1, (seed, c, n))

    def test_peaks_and_tiers(self):
        for seed in list(SEEDS)[:100]:
            t = mountain_blobs(seed)
            plan = rf.mountain_plan(t, pg.cell_levels(t), seed, peak_height=0.6)
            comps: dict = {}
            for c in plan.tier:                                # 按主轴 + 主峰分组近似连通块：主峰每块恰 1 个
                comps.setdefault(plan.axis[c], []).append(c)
            self.assertLessEqual(sum(1 for c in plan.tier if plan.tier[c] == "peak"), len(plan.peaks))
            for c, tier in plan.tier.items():
                if t.get((c[0], c[1] + 1)) != "mountain" or t.get((c[0], c[1] + 2)) != "mountain":
                    self.assertEqual(tier, "low", (seed, c))  # 靠镜头的两行只放矮档
                if tier == "peak":
                    self.assertIn(c, plan.peaks)
                    self.assertEqual(t.get((c[0], c[1] - 1)), "mountain", (seed, c))   # 正后方一格也是山岳（遮挡约束）
                if tier == "high":
                    self.assertEqual({t.get((c[0] - 1, c[1])), t.get((c[0] + 1, c[1]))}, {"mountain"}, (seed, c))  # 连绵山体只放内部格
                slots = rf.mountain_slots(plan, c[0], c[1], 2, seed)
                if tier == "peak":
                    self.assertEqual(len(slots), 1)
                    self.assertEqual(slots[0][3], 0.6)
                    self.assertEqual(slots[0][0], "terrain.standee.mountain.peak")
                    self.assertLess(slots[0][2], -0.1)          # 立在本格靠后
                elif tier == "high":                          # v1.5：连绵山体一格 1 张
                    self.assertEqual([s[0] for s in slots], ["terrain.standee.mountain.2"])
                elif tier == "tall":
                    self.assertTrue(all(s[0] == "terrain.standee.mountain.1" for s in slots))
                elif tier == "low":
                    self.assertTrue(all(s[0] in rf.FOOT_KEYS for s in slots))
                    self.assertTrue(all(0.27 <= s[3] <= 0.33 for s in slots))
                ax, az = plan.axis[c]
                for _, ox, oz, _ in slots:
                    perp = abs(-az * ox + ax * (oz + (rf.PEAK_BACK if tier == "peak" else 0.05)))
                    self.assertLessEqual(perp, rf.RIDGE_PERP + 1e-9)

    def test_one_peak_per_range(self):
        for seed in list(SEEDS)[:100]:
            t = mountain_blobs(seed)
            plan = rf.mountain_plan(t, pg.cell_levels(t), seed)
            seen, ncomp = set(), 0
            for c0 in t:
                if t[c0] != "mountain" or c0 in seen:
                    continue
                ncomp += 1
                stack, comp = [c0], {c0}
                seen.add(c0)
                while stack:
                    c = stack.pop()
                    for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        n = (c[0] + a, c[1] + b)
                        if t.get(n) == "mountain" and n not in seen:
                            seen.add(n); comp.add(n); stack.append(n)
                # 每片山至多 1 座主峰；有「正后方也是山岳、又不在靠镜头两行」的格时恰好 1 座（遮挡约束，v1.5）
                can = any((c[0], c[1] - 1) in comp and (c[0], c[1] + 1) in comp and (c[0], c[1] + 2) in comp for c in comp)
                self.assertEqual(len(comp & plan.peaks), 1 if can else 0, seed)
            self.assertLessEqual(len(plan.peaks), ncomp)


class QinglvGradeTest(unittest.TestCase):
    """青绿 A/B 的载入时调色与赭色岩层侧壁（--grade qinglv / --cliff-walls）。"""

    @staticmethod
    def hsv(c):
        import colorsys
        return colorsys.rgb_to_hsv(*[float(v) for v in c])

    def test_warm_desaturated_alpha_kept(self):
        a = np.array([[[0.85, 0.55, 0.25, 0.7]]], np.float32)       # 橙
        g = pg.grade_qinglv(a)
        self.assertEqual(g.shape, a.shape)
        self.assertAlmostEqual(float(g[0, 0, 3]), 0.7, places=6)
        self.assertLess(self.hsv(g[0, 0, :3])[1], self.hsv(a[0, 0, :3])[1] * 0.7)

    def test_green_pushed_towards_cyan(self):
        a = np.array([[[0.45, 0.65, 0.30]]], np.float32)             # 草绿
        h0, h1 = self.hsv(a[0, 0])[0] * 360, self.hsv(pg.grade_qinglv(a)[0, 0])[0] * 360
        self.assertGreater(h1, h0 + 10)

    def test_grey_almost_unchanged(self):
        a = np.full((1, 1, 3), 0.6, np.float32)
        self.assertLess(float(np.abs(pg.grade_qinglv(a) - a).max()), 0.03)

    def test_apply_grade_skip(self):
        A = pg.Assets()
        A.standee = {"x": np.full((2, 2, 4), 0.5, np.float32) * [1.6, 1.0, 0.5, 2.0]}
        A.standee["y"] = A.standee["x"].copy()
        A.ground = {"plain": np.full((2, 2, 3), [0.5, 0.7, 0.3], np.float32)}
        before = {k: v.copy() for k, v in A.standee.items()}
        pg.apply_grade(A, ("y", "terrain.ground.plain"))
        self.assertFalse(np.array_equal(A.standee["x"], before["x"]))
        self.assertTrue(np.array_equal(A.standee["y"], before["y"]))
        self.assertTrue(np.allclose(A.ground["plain"], [0.5, 0.7, 0.3]))

    def test_cliff_colour(self):
        hy = np.array([0.0, 0.02, 0.0495])
        c = pg.cliff_colour(hy, np.full(3, 0.05))
        self.assertTrue(np.allclose(c[2], pg.RIM_COLOR))            # 顶沿一线纸芯白
        self.assertFalse(np.allclose(c[0], c[1]))                    # 岩层条纹深浅交替
        self.assertTrue(all(cc[0] > cc[2] for cc in c[:2]))         # 赭色：红 > 蓝


if __name__ == "__main__":
    unittest.main()
