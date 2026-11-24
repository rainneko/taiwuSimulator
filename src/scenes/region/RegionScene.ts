import {
  CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, LinearMipmapLinearFilter, MathUtils, PCFSoftShadowMap,
  Scene, SRGBColorSpace, Texture, TextureLoader, Vector3, type WebGLRenderer, type WebGLRenderTarget,
} from 'three';
import type { AssetCache } from '../../app/AssetCache';
import type { ScenePointerEvent } from '../../app/InputRouter';
import type { IScene, NdcRect } from '../../app/SceneManager';
import { ui, type Screen } from '../../app/store';
import { createPaperMaterial, makeCardGeometry, PaperBatch, PaperCard, type Atlas } from '../../render/paper';
import { HingeState } from '../../render/paper/hinge';
import { DETAIL_PER_CELL, dressRegion, LOCATION_SIZE, MAX_MAIN, type Placement } from './dressing';
import { makePlaceholderAtlas } from './placeholderArt';
import { Visibility } from './Visibility';
import { warpPhase, type WarpPhase } from './warp';
import { awayFromLevelEdge, heightAt, layerConfig, makeLevelGrid, type LevelGrid } from './levels';
import { buildLayerGeometry } from './TerrainLayers';
import { buildGroundAtlas } from './GroundAtlas';
import { GridGround, Hl } from './GridGround';
import { findPath, pathCost } from './pathfinding';
import { RegionCamera, Zoom } from './RegionCamera';
import { makeSampleRegion, regionCost, type RegionData, type RegionLocation } from './regionData';
import { locationKind, terrainName, terrainUrls } from './terrain';

export interface RegionEnterParams { regionId?: string; region?: RegionData }

export interface CellInfo {
  cell: number; x: number; y: number;
  terrain: string; cost: number;
  location: RegionLocation | null;
  path: number[] | null; pathCost: number;
}

const HOP_MS = 170, HOP_ARC = 0.22;
const STANDEE_ASPECT = 831 / 512;
/** 地面纸纹：远档 0.22 → 中档 0.28 → 近档 0.35。 */
const FIBRE_FAR = 0.22, FIBRE_MID = 0.28, FIBRE_NEAR = 0.35;
const DETAIL_FOLD_S = 0.3;

/** 地区格子地图。 */
export class RegionScene implements IScene {
  readonly id: Screen = 'region';
  readonly scene = new Scene();
  readonly rig = new RegionCamera();
  region: RegionData | null = null;
  ground: GridGround | null = null;
  /** 地点立牌（原版 16–51 号图）。 */
  standees: PaperCard[] = [];
  /** 地形主体立牌（WO3 挂点）。 */
  terrainBatch: PaperBatch | null = null;
  /** 填充小件 + 地面散件；远档折平隐藏。 */
  detailBatch: PaperBatch | null = null;
  vis: Visibility | null = null;
  private art: Atlas | null = null;
  private fillerHandles: number[] = [];
  private flatHandles: number[] = [];
  private detailShown = true;
  private detailHideAt = -1;
  token: PaperCard | null = null;

  /** 外部（HUD / dev 页）订阅：选中格变化、玩家移动。 */
  onSelect: ((info: CellInfo | null) => void) | null = null;
  onMoved: ((cell: number) => void) | null = null;
  /** 地区地图的移动规则可由 core 覆盖；默认按地形耗费。 */
  costFn: ((cell: number) => number) | null = null;

  private atlas: { texture: Texture; variants: number[] } | null = null;
  private standeeTex = new Map<number, Texture[]>();
  private root = new Group();
  private sun = new DirectionalLight(0xfff1dc, 2.4);
  private view = { w: 1, h: 1 };
  private hover = -1;
  private selected = -1;
  private playerCell = 0;
  private walk: { path: number[]; i: number; t: number; queued: number | null } | null = null;
  private tokenPos = new Vector3();
  private intro = 0;
  /** v1.3 纸层：层号网格与扭曲相位（flat 时层号全 0）。 */
  levels: LevelGrid | null = null;
  private phase: WarpPhase = [0, 0, 0, 0];
  private maxLevel = 0;
  private maxLevelAbs = 0;
  private loader = new TextureLoader();

  constructor() {
    this.scene.background = new Color(0xe6dcc6);
    this.scene.add(new HemisphereLight(0xfffaf0, 0x8a7a60, 1.3));
    this.sun.position.set(-6, 12, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.root);
  }

  // ── IScene ──
  async preload(_assets: AssetCache, signal: AbortSignal): Promise<void> {
    if (!this.atlas) this.atlas = await buildGroundAtlas(signal);
    this.art ??= makePlaceholderAtlas();   // 真实图集接入前的占位
  }

  enter(params: unknown, _from: Screen | null): void {
    const p = (params ?? {}) as RegionEnterParams;
    this.build(p.region ?? makeSampleRegion(15, hashStr(p.regionId ?? 'sample')));
  }

  exit(_to: Screen): void { this.walk = null; this.setHover(-1); }

  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    this.stepWalk(dt);
    if (this.token) this.token.position.copy(this.tokenPos);
    for (const s of this.standees) s.update(dt);
    this.token?.update(dt);
    this.rig.update(dt);
    this.vis?.update(dt);
    this.updateDetailLayer();
    this.terrainBatch?.update(dt);
    this.detailBatch?.update(dt);
    const c = this.rig.closeness();
    this.ground?.setFibre(c < 0.5 ? FIBRE_FAR + (FIBRE_MID - FIBRE_FAR) * c * 2 : FIBRE_MID + (FIBRE_NEAR - FIBRE_MID) * (c - 0.5) * 2);
    this.fitShadow();
    this.intro += dt;
    this.ground?.flush();
  }

  render(r: WebGLRenderer, target: WebGLRenderTarget | null): void {
    if (!r.shadowMap.enabled) { r.shadowMap.enabled = true; r.shadowMap.type = PCFSoftShadowMap; }
    // 场景在 SceneManager.resize 之后才创建时也要拿到正确宽高比
    const w = target ? target.width : r.domElement.width, h = target ? target.height : r.domElement.height;
    if (h > 0 && Math.abs(this.rig.camera.aspect - w / h) > 1e-3) this.resize(w / r.getPixelRatio(), h / r.getPixelRatio());
    r.setRenderTarget(target);
    r.render(this.scene, this.rig.camera);
    r.setRenderTarget(null);
  }

  resize(w: number, h: number): void { this.view = { w, h }; this.rig.resize(w, h); }

  isIdle(): boolean { return !this.walk && !this.standees.some((s) => s.moving) && !this.token?.moving; }

  /** 玩家令牌附近 3×3 格在屏幕上的外接矩形。 */
  getFocusRect(): NdcRect | null {
    if (!this.region) return null;
    const c = this.rig.camera, v = new Vector3(), n = this.region.size;
    let x0 = 1, y0 = 1, x1 = -1, y1 = -1;
    for (const [x, z] of [[0, 0], [n, 0], [0, n], [n, n]]) {
      v.set(x, 0, z).project(c);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, y0, x1, y1 };
  }

  /** dive 进入：先拉远到整图入画，再缓出到跟随构图。 */
  alignTo(_rect: NdcRect): void {
    if (!this.region) return;
    const n = this.region.size;
    this.rig.snap(new Vector3(n / 2, 0, n / 2), this.rig.distFor(Zoom.Far));
    this.rig.follow = this.tokenPos;
  }

  setDiveProgress(t: number, dir: 'dive' | 'rise'): void {
    if (dir === 'rise' && this.region) {
      // 返回大地图：镜头往上拉
      this.rig.dist = MathUtils.lerp(this.rig.distFor(this.rig.zoomLevel), this.rig.distFor(Zoom.Far) * 1.3, t);
    }
  }

  onPointer(e: ScenePointerEvent): void {
    switch (e.type) {
      case 'move': this.setHover(this.cellAt(e)); break;
      case 'leave': this.setHover(-1); break;
      case 'drag': if (e.delta) this.rig.pan(e.delta[0], e.delta[1], this.view.h); break;
      case 'wheel': if (e.delta) this.rig.setZoom(this.rig.zoomLevel + Math.sign(e.delta[1])); break;
      case 'pinch': if (e.delta) this.rig.setZoom(this.rig.zoomLevel + (e.delta[0] > 1.15 ? -1 : e.delta[0] < 0.87 ? 1 : 0)); break;
      case 'click': {
        const c = this.cellAt(e);
        if (c < 0) { this.select(-1); break; }
        if (c === this.selected && c !== this.playerCell) this.moveTo(c);
        else this.select(c);
        break;
      }
    }
  }

  onKey(e: KeyboardEvent): boolean {
    if (e.key === '=' || e.key === '+') { this.rig.setZoom(this.rig.zoomLevel - 1); return true; }
    if (e.key === '-') { this.rig.setZoom(this.rig.zoomLevel + 1); return true; }
    if (e.key === 'f' || e.key === ' ') { this.rig.follow = this.tokenPos; return true; }
    return false;
  }

  dispose(): void {
    this.clear();
    this.atlas?.texture.dispose();
    for (const arr of this.standeeTex.values()) for (const t of arr) t.dispose();
  }

  // ── 公共操作 ──
  cost = (cell: number): number => this.costFn ? this.costFn(cell) : this.region ? regionCost(this.region, cell) : 1;

  select(cell: number): void {
    const g = this.ground;
    if (!g) return;
    g.clearFlag(Hl.Selected); g.clearFlag(Hl.Path); g.clearFlag(Hl.PathIllegal);
    this.selected = cell;
    if (cell < 0) { this.onSelect?.(null); return; }
    g.setFlag(cell, Hl.Selected, true);
    const path = cell === this.playerCell ? null : findPath(this.region!.size, this.playerCell, cell, this.cost);
    if (path) for (const c of path.slice(1)) g.setFlag(c, Hl.Path, true);
    this.onSelect?.(this.info(cell, path));
  }

  /** 沿 A* 路径逐格跳过去；移动中再调用会在当前一跳结束后改道。 */
  moveTo(cell: number): boolean {
    if (!this.region) return false;
    if (this.walk) { this.walk.queued = cell; return true; }
    const path = findPath(this.region.size, this.playerCell, cell, this.cost);
    if (!path || path.length < 2) return false;
    this.walk = { path, i: 0, t: 0, queued: null };
    this.rig.follow = this.tokenPos;
    return true;
  }

  info(cell: number, path: number[] | null = null): CellInfo {
    const r = this.region!, n = r.size;
    const loc = r.locations.find((l) => l.cell === cell) ?? null;
    return {
      cell, x: cell % n, y: (cell / n) | 0,
      terrain: loc ? terrainName(loc.type) : terrainName(r.ground[cell]),
      cost: this.cost(cell), location: loc, path, pathCost: path ? pathCost(path, this.cost) : 0,
    };
  }

  get player(): number { return this.playerCell; }

  cellCenter(cell: number, out = new Vector3()): Vector3 {
    const n = this.region?.size ?? 1;
    return out.set((cell % n) + 0.5, 0, ((cell / n) | 0) + 0.5);
  }

  /** 世界 (x, z) 处的地面高度（棋子、立牌、道路、迷雾都按它抬高）。 */
  heightAt(x: number, z: number): number {
    return this.levels && this.maxLevelAbs > 0 ? heightAt(this.levels, x, z, this.phase, layerConfig.step) : 0;
  }

  // ── 内部 ──
  private build(r: RegionData): void {
    this.clear();
    this.region = r;
    const n = r.size;
    const g = this.ground = new GridGround(n);
    g.setAtlas(this.atlas?.texture ?? null);
    g.setTerrain(r.ground, r.variant, this.atlas?.variants ?? []);
    this.root.add(g.mesh);
    this.playerCell = r.playerCell;
    this.cellCenter(r.playerCell, this.tokenPos);
    const phase = this.phase = warpPhase(r.seed ?? 0);
    g.setWarpPhase(phase);
    // 地形纸层：low 画质 / 开关关 → 层号全 0、不建侧壁（= v1.2 平面）
    const layered = layerConfig.enabled && ui.quality.peek() !== 'low';
    const lv = this.levels = makeLevelGrid(r, layered);
    g.setLevels(lv.level);
    this.maxLevel = Math.max(0, ...lv.level);
    this.maxLevelAbs = Math.max(0, ...Array.from(lv.level, Math.abs));
    if (layered) g.setGeometry(buildLayerGeometry(lv, phase, layerConfig.step).geometry);
    this.tokenPos.y = this.heightAt(this.tokenPos.x, this.tokenPos.z);
    this.vis = new Visibility(n);
    this.vis.attach(g.mesh.material, 'ground');
    this.vis.setCenter(r.playerCell, true);
    this.rig.setRegionSize(n);
    this.rig.setZoom(Zoom.Near);                    // 进入地区默认近档
    this.rig.snap(this.tokenPos.clone());
    this.rig.follow = this.tokenPos;
    this.buildDressing(r, phase);

    // 地点立牌：从地面立起，由近及远
    for (const loc of r.locations) {
      const card = this.makeStandee(loc);
      const c = this.cellCenter(loc.cell);
      card.position.set(c.x, 0.001 + this.heightAt(c.x, c.z - 0.2), c.z - 0.2);
      this.vis.attach(card.material, 'loc');
      const d = Math.hypot(c.x - this.tokenPos.x, c.z - this.tokenPos.z);
      card.rise(0.25 + d * 0.06);
      this.standees.push(card);
      this.root.add(card);
    }
    // 玩家令牌
    this.token = new PaperCard(makeCardGeometry({ width: 0.22, height: 0.32, uv: [0, 0, 1, 1] }),
      createPaperMaterial({ map: tokenTexture() }));
    this.token.rise(0.1);
    this.root.add(this.token);
    this.intro = 0;
  }

  /** 三层布置：主体立牌（terrainBatch）+ 填充小件 / 地面散件（detailBatch）。 */
  private buildDressing(r: RegionData, phase: ReturnType<typeof warpPhase>): void {
    if (!this.art || !this.vis) return;
    const lv = this.levels;
    const accept = this.maxLevelAbs > 0 && lv ? (x: number, z: number) => awayFromLevelEdge(lv, x, z, phase) : undefined;
    const n = r.size, places = dressRegion(r, phase, accept);
    const tb = this.terrainBatch = new PaperBatch(this.art, { cards: MAX_MAIN * n * n + 64, frames: 40 });
    const db = this.detailBatch = new PaperBatch(this.art, { cards: DETAIL_PER_CELL * n * n, frames: 40 });
    this.vis.attach(tb.material, 'batch');
    this.vis.attach(db.material, 'batch');
    db.mesh.castShadow = true;
    const tint = new Color(), pos = new Vector3();
    const known = new Set(this.art.json.frames.map((f) => f.name));
    // 起立：由近及远
    const delayOf = (p: Placement) => 0.2 + Math.hypot(p.x - this.tokenPos.x, p.z - this.tokenPos.z) * 0.05;
    for (const p of places) {
      if (!known.has(p.artKey)) continue;
      pos.set(p.x, (p.layer === 'flat' ? 0.002 : 0.001) + this.heightAt(p.x, p.z), p.z);
      tint.setScalar(p.tint);
      if (p.layer === 'main') {
        const h = tb.add({ frame: p.artKey, position: pos, yaw: p.yaw, scale: p.scale, tint, startState: HingeState.FLAT });
        tb.rise(h, delayOf(p));
      } else if (p.layer === 'filler') {
        const h = db.add({ frame: p.artKey, position: pos, yaw: p.yaw, scale: p.scale, tint, startState: HingeState.FLAT });
        db.rise(h, delayOf(p) + 0.1);
        this.fillerHandles.push(h);
      } else {
        this.flatHandles.push(db.add({ frame: p.artKey, position: pos, yaw: p.yaw, scale: p.scale, tint, startState: HingeState.FLAT }));
      }
    }
    this.root.add(tb.mesh, db.mesh);
    this.detailShown = true; this.detailHideAt = -1;
  }

  /** 远档：填充小件折平（300ms）后整批隐藏；回到近 / 中档再立起。 */
  private updateDetailLayer(): void {
    const db = this.detailBatch;
    if (!db) return;
    const want = this.rig.zoomLevel !== Zoom.Far;
    if (want !== this.detailShown) {
      this.detailShown = want;
      if (want) { db.mesh.visible = true; this.detailHideAt = -1; for (const h of this.fillerHandles) db.rise(h, Math.random() * 0.1); }
      else { for (const h of this.fillerHandles) db.fall(h); this.detailHideAt = this.intro + DETAIL_FOLD_S; }
    }
    if (this.detailHideAt >= 0 && this.intro >= this.detailHideAt) { db.mesh.visible = false; this.detailHideAt = -1; }
  }

  /** 阴影相机跟随可视范围（WO3 §3.11 简化版）：外扩 2 格，按纹素对齐。 */
  private fitShadow(): void {
    const cells = this.rig.cellsFor(this.rig.zoomLevel);
    const half = cells * 0.5 + 2 + 1.2 + this.maxLevel * layerConfig.step;   // 外扩 2 格 + maxCasterHeight（含最高层）
    const sc = this.sun.shadow.camera, size = this.sun.shadow.mapSize.x;
    if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 0.5; sc.far = 60; sc.updateProjectionMatrix(); }
    const texel = (half * 2) / size, t = this.rig.target;
    const x = Math.round(t.x / texel) * texel, z = Math.round(t.z / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x - 6, 12, z + 4);
  }

  private makeStandee(loc: RegionLocation): PaperCard {
    const H = (LOCATION_SIZE[locationKind(loc.type)] ?? LOCATION_SIZE.village)[1];
    const geo = makeCardGeometry({ width: H / STANDEE_ASPECT, height: H, uv: [0, 0, 1, 1] });
    const urls = terrainUrls(loc.type);
    const mat = createPaperMaterial({ color: urls.length ? 0xffffff : kindColor(locationKind(loc.type)), cutout: true });
    const card = new PaperCard(geo, mat);
    card.name = `standee:${loc.name}`;
    if (!urls.length) return card;
    let arr = this.standeeTex.get(loc.type);
    if (!arr) this.standeeTex.set(loc.type, arr = []);
    const v = loc.cell % urls.length;
    // 原图高度不一：按实际宽高比拉伸
    let tex = arr[v];
    if (!tex) {
      tex = arr[v] = this.loader.load(urls[v], (t) => { t.userData.ready = true; for (const c of this.standees) if (c.material.map === t) fitCard(c, t); });
      tex.colorSpace = SRGBColorSpace; tex.minFilter = LinearMipmapLinearFilter; tex.anisotropy = 4;
    } else if (tex.userData.ready) fitCard(card, tex);
    mat.map = tex; mat.needsUpdate = true;
    return card;
  }

  private stepWalk(dt: number): void {
    const w = this.walk;
    if (!w || !this.region) return;
    w.t += dt * 1000 / HOP_MS;
    const a = this.cellCenter(w.path[w.i]), b = this.cellCenter(w.path[w.i + 1]);
    const t = Math.min(1, w.t);
    this.tokenPos.lerpVectors(a, b, t);
    const ha = this.heightAt(a.x, a.z), hb = this.heightAt(b.x, b.z);
    this.tokenPos.y = ha + (hb - ha) * t + Math.sin(t * Math.PI) * HOP_ARC;
    if (w.t < 1) return;
    // 落地一格
    w.i++; w.t = 0;
    this.playerCell = w.path[w.i];
    this.tokenPos.y = this.heightAt(this.tokenPos.x, this.tokenPos.z);
    this.ground?.setFlag(this.playerCell, Hl.Path, false);
    this.token?.nudge(-2.5);
    this.vis?.setCenter(this.playerCell);
    this.onMoved?.(this.playerCell);
    if (w.queued !== null) {
      const q = w.queued; this.walk = null;
      this.select(q); this.moveTo(q); return;
    }
    if (w.i >= w.path.length - 1) { this.walk = null; this.select(this.playerCell); }
  }

  private cellAt(e: ScenePointerEvent): number {
    if (!this.region) return -1;
    const p = this.rig.groundAt(e.ndc);
    if (!p) return -1;
    // 拾取高度修正：查交点层高 h，再与 y = h 求交（迭代两次）
    for (let k = 0; k < 2 && this.levels; k++) {
      const h = this.heightAt(p.x, p.z);
      if (!this.rig.groundAt(e.ndc, p, h)) return -1;
    }
    const n = this.region.size, x = Math.floor(p.x), y = Math.floor(p.z);
    return x < 0 || y < 0 || x >= n || y >= n ? -1 : y * n + x;
  }

  private setHover(c: number): void {
    if (c === this.hover || !this.ground) return;
    if (this.hover >= 0) this.ground.setFlag(this.hover, Hl.Hover, false);
    this.hover = c;
    if (c >= 0) this.ground.setFlag(c, Hl.Hover, true);
  }

  private clear(): void {
    for (const s of this.standees) { s.geometry.dispose(); s.material.dispose(); }
    this.standees = [];
    if (this.token) { this.token.geometry.dispose(); this.token.material.map?.dispose(); this.token.material.dispose(); this.token = null; }
    this.ground?.dispose(); this.ground = null;
    this.terrainBatch?.dispose(); this.terrainBatch = null;
    this.detailBatch?.dispose(); this.detailBatch = null;
    this.fillerHandles = []; this.flatHandles = [];
    this.vis?.dispose(); this.vis = null;
    this.root.clear();
    this.walk = null; this.hover = -1; this.selected = -1;
  }
}

function fitCard(card: PaperCard, t: Texture): void {
  const im = t.image as { width?: number; height?: number } | null;
  if (im?.width && im.height) card.scale.x = STANDEE_ASPECT / (im.height / im.width);   // 原图高度不一：保高调宽
}

function hashStr(s: string): number { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }

function kindColor(k: string): number {
  return ({ city: 0x9a4a3a, sect: 0x5a6a8a, village: 0x8a7a50, town: 0xa0804a, fort: 0x6a5a4a, taiwu: 0x7a3a5a, abyss: 0x2a2a3a } as Record<string, number>)[k] ?? 0x888888;
}

/** 占位令牌：朱色圆牌 + 小人剪影。 */
function tokenTexture(): Texture {
  const W = 128, H = 190, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.filter = 'blur(0.8px)';
  g.fillStyle = '#f4ecdc';
  g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 28); g.fill();
  g.fillStyle = '#a3352a';
  g.beginPath(); g.arc(W / 2, 52, 22, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(W / 2 - 34, H - 22); g.quadraticCurveTo(W / 2, 64, W / 2 + 34, H - 22); g.fill();
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}
