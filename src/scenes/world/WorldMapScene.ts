import { computed, effect } from '@preact/signals';
import {
  AmbientLight, Box2, Box3, CanvasTexture, Color, DirectionalLight, Fog, HemisphereLight, Mesh, MeshLambertMaterial, PCFSoftShadowMap,
  PlaneGeometry, Raycaster, Scene, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import type { AssetCache } from '../../app/AssetCache';
import type { ScenePointerEvent } from '../../app/InputRouter';
import type { IScene, NdcRect } from '../../app/SceneManager';
import { services } from '../../app/services';
import { setHover, setSelection, ui, type Screen } from '../../app/store';
import { createPaperMaterial, fitPCSSLight, isPCSSPatched, type PaperLocals } from '../../render/paper';
import { MapPanRig } from './MapPanRig';
import { buildAdjacency, type Pt } from './outline';
import { stateOf } from './pieceState';
import { LAYER_DECOR, LAYER_PICK, mapToPlane, pieceFromImage, ProvincePiece, type MapXform } from './ProvincePiece';
import { Token } from './Token';
import { TravelLine } from './TravelLine';
import { planTravel, sampleTravel, type TravelPlan } from './travelTimeline';
import { computeView, MAP_LAYOUT, PLACES, provinceOfRegion, stubRoutes, worldUi, type WorldMapView } from './worldData';

export const MAP_WIDTH = 24;

export interface WorldMapParams { mode?: 'normal' | 'pickOnly'; allow?: string[]; onPick?: (id: string) => void; focus?: string }

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
    imageCache.set(url, p);
  }
  return p;
}

/** 场景对 HUD 暴露的操作。 */
export const worldMapApi = {
  zoomBy: (_s: number) => {},
  focusCurrent: () => {},
  travel: (_regionId: string) => {},
};

const routeId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const easeInCubic = (x: number) => x * x * x;

/** 省域纸雕图。工单 M3-WO2 §3–§9。 */
export class WorldMapScene implements IScene {
  readonly id: Screen = 'worldMap';
  readonly scene = new Scene();
  readonly rig: MapPanRig;
  private xf: MapXform;
  private pieces: ProvincePiece[] = [];
  private byId = new Map<string, ProvincePiece>();
  private adjacency = new Map<string, string[]>();
  private images = new Map<string, HTMLImageElement | null>();
  private key!: DirectionalLight;
  private token: Token | null = null;
  private routes: TravelLine | null = null;
  private clouds: Array<{ mesh: Mesh; local: PaperLocals; vx: number; base: Vector3 }> = [];
  private built = false;
  private raycaster = new Raycaster();
  private pointer: Vector2 | null = null;
  private pointerPx: [number, number] = [0, 0];
  private frameN = 0;
  private shadowDirty = true;
  private mode: 'normal' | 'pickOnly' = 'normal';
  private allow: Set<string> | null = null;
  private onPick: ((id: string) => void) | null = null;
  private disposers: Array<() => void> = [];
  private travel: null | { plan: TravelPlan; t: number; from: string; to: string; regionId: string; route: string | null; camFrom: Vector3; camTo: Vector3; dFrom: number; dTo: number } = null;
  private dive: null | { from: { x: number; z: number; d: number }; to: { x: number; z: number; d: number } } = null;
  private intro = -1;
  private time = 0;
  private needsRender = true;
  readonly view = computed<WorldMapView>(() => computeView(worldUi.layer.value, worldUi.current.value, worldUi.ap.value, this.routeData));
  private routeData = stubRoutes();
  /** 每片的世界 box（缓存给 focus rect 用）。 */
  private tmpBox = new Box3();
  private baseTex: Texture | null = null;
  private labelPos = new Map<string, Vector3>();
  private labelKey = new Map<string, string>();

  constructor() {
    const [W, H] = MAP_LAYOUT.size;
    this.xf = { scale: MAP_WIDTH / W, ox: W / 2, oy: H / 2 };
    const hz = (H * this.xf.scale) / 2;
    this.rig = new MapPanRig({
      fov: 20, pitchDeg: 75, distRange: [7, 62],
      bounds: new Box2(new Vector2(-MAP_WIDTH * 0.45, -hz * 0.9), new Vector2(MAP_WIDTH * 0.45, hz * 0.9)),
    });
    this.rig.camera.layers.enable(LAYER_DECOR);
    this.raycaster.layers.set(LAYER_PICK);
  }

  async preload(_assets: AssetCache, _signal: AbortSignal): Promise<void> {
    const urls = [MAP_LAYOUT.baseImage, ...PLACES.map((p) => p.image), ...MAP_LAYOUT.clouds.map((c) => c.image)];
    const imgs = await Promise.all(urls.map(loadImage));
    urls.forEach((u, i) => this.images.set(u, imgs[i]));
    this.build();
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    s.background = new Color(MAP_LAYOUT.backdrop);
    s.fog = new Fog(MAP_LAYOUT.backdrop, 70, 140);
    s.add(new HemisphereLight(0xfff6e6, 0x75644c, 1.1), new AmbientLight(0xffffff, 0.15));
    this.key = new DirectionalLight(0xfff0d8, 2.3);
    this.key.position.set(-7 * 2.2, 6.5 * 2.2, -5 * 2.2);
    this.key.target.position.set(0, 0, 0);
    s.add(this.key, this.key.target);
    const half = MAP_WIDTH * 0.62;
    if (isPCSSPatched()) fitPCSSLight(this.key, half, { mapSize: 2048, near: 1, far: 60, lightSize: 0.35 });
    else {
      this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048);
      const c = this.key.shadow.camera; c.left = c.bottom = -half; c.right = c.top = half; c.near = 1; c.far = 60; c.updateProjectionMatrix();
      this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 0.01;
    }

    // 底纸：外圈一张深色大纸 + 原版底图整张平铺（省片之间的纸缝里露出的也是原画）
    const [W, H] = MAP_LAYOUT.size;
    const mw = W * this.xf.scale, mh = H * this.xf.scale;
    const back = new Mesh(new PlaneGeometry(mw * 1.6, mh * 1.6).rotateX(-Math.PI / 2),
      createPaperMaterial({ color: MAP_LAYOUT.backdrop, cutout: false, doubleSided: false, fibre: 0.35 }));
    back.position.y = -0.02; back.receiveShadow = true; back.name = 'backdrop';
    s.add(back);
    const baseImg = this.images.get(MAP_LAYOUT.baseImage);
    let baseTex: Texture | null = null;
    if (baseImg) {
      baseTex = new CanvasTexture(baseImg as unknown as HTMLCanvasElement);
      baseTex.colorSpace = SRGBColorSpace; baseTex.anisotropy = 8;
      const sheet = new Mesh(new PlaneGeometry(mw, mh).rotateX(-Math.PI / 2),
        createPaperMaterial({ map: baseTex, cutout: false, doubleSided: false, fibre: 0.2, color: 0xffffff }));
      sheet.position.y = -0.01; sheet.receiveShadow = true; sheet.name = 'baseSheet'; sheet.layers.set(LAYER_DECOR);
      s.add(sheet);
      this.baseTex = baseTex;
    }
    const [bx0, byTop] = mapToPlane(this.xf, 0, 0);

    const gap = MAP_WIDTH * 0.0018;
    const view = this.view.peek();
    for (const p of PLACES) {
      const img = this.images.get(p.image);
      if (!img) continue;
      const src = pieceFromImage(img, p.center, this.xf);
      if (baseTex) { src.texture?.dispose(); src.texture = baseTex; src.imageRect = [bx0, byTop, mw, mh]; src.sharedTexture = true; }
      const pv = view.provinces.find((v) => v.id === p.id)!;
      const piece = new ProvincePiece(p.id, src, gap, p.layerHeight, pv.baseColor, pv.accentColor);
      s.add(piece);
      this.pieces.push(piece); this.byId.set(p.id, piece);
    }
    this.adjacency = buildAdjacency(this.pieces.map((p) => ({ id: p.pid, outline: p.outline })), MAP_WIDTH * 0.012);

    // 驿路
    this.routes = new TravelLine(this.routeData.length + 2);
    for (const r of this.routeData) this.addRoute(r.a, r.b, r.open ? 'open' : 'closed');
    s.add(this.routes.mesh);

    // 棋子
    this.token = new Token(null, 0.35);
    s.add(this.token);

    // 云：悬空的平躺纸片，投影到地图上
    for (const c of MAP_LAYOUT.clouds) {
      const img = this.images.get(c.image); if (!img) continue;
      const tex = new CanvasTexture(img as unknown as HTMLCanvasElement); tex.colorSpace = SRGBColorSpace;
      const w = img.width * this.xf.scale * 1.6 * c.scale, h = img.height * this.xf.scale * 1.6 * c.scale;
      const mat = createPaperMaterial({ map: tex as Texture, color: 0xffffff, doubleSided: true, rim: false });
      const mesh = new Mesh(new PlaneGeometry(w, h).rotateX(-Math.PI / 2), mat);
      const [x, y] = mapToPlane(this.xf, c.at[0], c.at[1]);
      mesh.position.set(x, 0.9 + (c.parallax - 0.15) * 2.6, -y);
      mesh.castShadow = ui.quality.peek() === 'high';
      mesh.layers.set(LAYER_DECOR);
      s.add(mesh);
      this.clouds.push({ mesh, local: mat.userData.paper as PaperLocals, vx: 0.02 * (0.7 + c.parallax), base: mesh.position.clone() });
    }
  }

  private addRoute(a: string, b: string, state: 'open' | 'closed'): void {
    const pa = this.byId.get(a), pb = this.byId.get(b);
    if (!pa || !pb || !this.routes) return;
    const A = pa.labelWorld(), B = pb.labelWorld();
    this.routes.add(routeId(a, b), TravelLine.curve(A, B), state);
  }

  // ── 生命周期 ──
  enter(params: unknown, from: Screen | null): void {
    this.build();
    const p = (params ?? {}) as WorldMapParams;
    this.mode = p.mode ?? 'normal';
    this.allow = p.allow ? new Set(p.allow) : null;
    this.onPick = p.onPick ?? null;
    this.travel = null; this.dive = null;
    worldUi.busy.value = false;
    for (const pc of this.pieces) pc.springs.dimOverride = null;
    if (this.token) this.token.visible = this.mode === 'normal';
    if (this.routes) this.routes.mesh.visible = this.mode === 'normal';
    this.placeToken();
    if (p.focus) setSelection({ type: 'province', id: p.focus });

    const fromRegion = from === 'region' || from === 'town';
    if (!fromRegion) {
      this.rig.set(0, 0, 52, true);
      if (!ui.reducedMotion.peek()) this.startIntro();
    }
    this.disposers.push(effect(() => {
      void ui.selection.value; void ui.hover.value; void this.view.value;
      this.refreshStates();
    }));
    this.disposers.push(effect(() => {
      const sel = ui.selection.value;
      if (sel?.type === 'province' && !this.travel && !this.dive) this.focusPiece(sel.id);
    }));
    worldMapApi.zoomBy = (s) => this.rig.zoomBy(s);
    worldMapApi.focusCurrent = () => { const pc = this.byId.get(worldUi.current.peek()); if (pc) this.rig.focusOn(new Vector2(pc.label[0], -pc.label[1])); };
    worldMapApi.travel = (rid) => this.startTravel(rid);
    this.registerLabels();
    this.needsRender = true;
  }

  private placeToken(): void {
    const pc = this.byId.get(worldUi.current.peek());
    if (pc && this.token) this.token.placeAt(new Vector3(pc.label[0] + 0.15, pc.topY, -pc.label[1] + 0.15));
  }

  private startIntro(): void {
    this.intro = 0;
    const order = [...this.pieces].sort((a, b) => a.springs.layerHeight - b.springs.layerHeight || Math.hypot(...a.label) - Math.hypot(...b.label));
    order.forEach((p, i) => { p.userData.introDelay = i * 0.025 * (15 / Math.max(15, order.length)); p.introOffset = 0.06; p.markDirty(); });
    for (const c of this.clouds) c.local.uPaperFade.value = 1;
  }
  private skipIntro(): void {
    if (this.intro < 0) return;
    this.intro = -1;
    for (const p of this.pieces) { p.introOffset = 0; p.markDirty(); }
    for (const c of this.clouds) c.local.uPaperFade.value = 0;
  }

  private isLocked(id: string, locked: boolean): boolean {
    return locked || (this.mode === 'pickOnly' && !!this.allow && !this.allow.has(id));
  }

  private refreshStates(): void {
    const sel = ui.selection.peek(), hov = ui.hover.peek();
    const selId = sel?.type === 'province' ? sel.id : null;
    const hovId = hov?.type === 'province' ? hov.id : null;
    const view = this.view.peek();
    for (const pv of view.provinces) {
      const pc = this.byId.get(pv.id); if (!pc) continue;
      const locked = this.isLocked(pv.id, pv.locked);
      let st = stateOf({ id: pv.id, locked }, selId, hovId);
      if (this.travel && (pv.id === this.travel.from || pv.id === this.travel.to)) st = pv.id === selId ? 'selected' : 'idle';
      pc.setState(st);
      pc.setBase(pv.baseColor);
      pc.setAccent(pv.accentColor);
    }
    // 驿路显示规则（§8.2）
    if (this.routes) {
      const cur = worldUi.current.peek();
      for (const r of view.routes) {
        const id = routeId(r.a, r.b);
        if (this.travel?.route === id) continue;
        const related = r.a === cur || r.b === cur || r.a === selId || r.b === selId;
        this.routes.setState(id, view.layer === 'routes' ? (r.open ? 'open' : 'closed') : r.open && related ? 'open' : 'hidden');
      }
    }
    this.registerLabels();
    this.needsRender = true;
  }

  private registerLabels(): void {
    const lp = services.labels; if (!lp) return;
    const sel = ui.selection.peek(), hov = ui.hover.peek();
    const areas = this.pieces.map((p) => p.area).sort((a, b) => b - a);
    const view = this.view.peek();
    for (const pv of view.provinces) {
      const pc = this.byId.get(pv.id); if (!pc) continue;
      const rank = areas.indexOf(pc.area) / Math.max(1, areas.length - 1);
      const isSel = sel?.type === 'province' && sel.id === pv.id;
      const prio = isSel ? 100 : hov?.type === 'province' && hov.id === pv.id ? 90 : pv.isCurrent ? 80 : 60 - rank * 50;
      const world = this.labelPos.get(pv.id) ?? pc.labelWorld();
      this.labelPos.set(pv.id, world);
      const key = `${prio}|${isSel}`;
      if (this.labelKey.get(pv.id) === key) continue;
      this.labelKey.set(pv.id, key);
      lp.upsert({ id: `prov:${pv.id}`, textKey: pv.nameKey, world, priority: prio, maxZoom: isSel ? undefined : 0.75 });
    }
  }

  private focusPiece(id: string): void {
    const pc = this.byId.get(id); if (!pc) return;
    const narrow = (services.labels ? innerWidth : 1200) < 900;
    this.rig.focusOn(new Vector2(pc.label[0], -pc.label[1]), { screenOffset: narrow ? [0, -0.3] : [0.2, 0] });
  }

  // ── 旅行（§8.3） ──
  startTravel(regionId: string): void {
    if (this.mode !== 'normal' || this.travel) return;
    const to = provinceOfRegion(regionId);
    const view = this.view.peek();
    const pv = view.provinces.find((p) => p.id === to);
    const region = pv?.regions.find((r) => r.id === regionId);
    if (!pv || !region || region.apCost === null || pv.locked) return;
    const from = worldUi.current.peek();
    // 桩：dispatch(TravelTo) → 立刻回发 travelStarted
    console.info('[core stub] TravelTo', { regionId }, '→ travelStarted', { fromProvince: from, toProvince: to, toRegion: regionId, apCost: region.apCost });
    const plan = from === to ? { hops: 0, lineMs: 0, hopMs: 0, settleMs: 260, totalMs: 260 } : planTravel(region.apCost);
    let route: string | null = null;
    if (from !== to && this.routes) {
      route = routeId(from, to);
      if (!this.routes.has(route)) this.addRoute(from, to, 'open');
      this.routes.setState(route, 'active'); this.routes.setProgress(route, 0);
    }
    const a = this.byId.get(from)!, b = this.byId.get(to)!;
    const A = new Vector3(a.label[0], 0, -a.label[1]), B = new Vector3(b.label[0], 0, -b.label[1]);
    const dTo = Math.max(this.rig.goalDist, Math.min(40, A.distanceTo(B) * 2.6 + 8));
    this.travel = { plan, t: 0, from, to, regionId, route, camFrom: this.rig.goalTarget, camTo: B, dFrom: this.rig.goalDist, dTo };
    worldUi.busy.value = true;
    setSelection({ type: 'province', id: to });
    this.refreshStates();
    this.travelAp = region.apCost;
    if (ui.reducedMotion.peek()) this.travel.t = plan.totalMs;
  }
  private travelAp = 0;
  private lastHop = -1;

  private updateTravel(dt: number): void {
    const tr = this.travel!; tr.t += dt * 1000;
    const f = sampleTravel(tr.plan, tr.t);
    if (tr.route && this.routes) this.routes.setProgress(tr.route, f.lineProgress);
    const curve = tr.route ? this.routeCurve(tr.from, tr.to) : null;
    if (curve && this.token && tr.plan.hops > 0 && tr.t > tr.plan.lineMs) {
      if (f.hopIndex !== this.lastHop && f.hopIndex < tr.plan.hops) {
        this.lastHop = f.hopIndex;
        const t = this.curveParam(tr, (f.hopIndex + 1) / tr.plan.hops);
        const q = curve.getPoint(t);
        void this.token.hopTo(q.add(new Vector3(0, 0.005, 0)), tr.plan.hopMs * 0.95, 0.12);
      }
    }
    // 相机
    const k = f.cameraT;
    this.rig.set(tr.camFrom.x + (tr.camTo.x - tr.camFrom.x) * k, tr.camFrom.z + (tr.camTo.z - tr.camFrom.z) * k,
      tr.dFrom + (tr.dTo - tr.dFrom) * Math.sin(Math.PI * Math.min(1, k)));
    const dest = this.byId.get(tr.to);
    if (dest) { dest.springs.extraLift = 0.03 * f.pulse; dest.springs.rim.x = Math.max(dest.springs.rim.x, 1.25 + 0.35 * f.pulse); dest.markDirty(); }
    if (tr.t >= tr.plan.totalMs) this.finishTravel();
  }
  private routeCurve(a: string, b: string) {
    const r = (this.routes as unknown as { routes: Map<string, { curve: import('three').QuadraticBezierCurve3 }> }).routes.get(routeId(a, b));
    return r?.curve ?? null;
  }
  /** routeId 按字典序排两端，曲线起点可能是终点省：按需反向。 */
  private curveParam(tr: { from: string; to: string }, t: number): number {
    const c = this.routeCurve(tr.from, tr.to)!;
    const a = this.byId.get(tr.from)!;
    const startNearFrom = c.v0.distanceTo(new Vector3(a.label[0], c.v0.y, -a.label[1])) < 1e-3;
    return startNearFrom ? t : 1 - t;
  }

  private finishTravel(): void {
    const tr = this.travel; if (!tr) return;
    this.travel = null; this.lastHop = -1;
    if (tr.route && this.routes) { this.routes.setProgress(tr.route, 1); this.routes.setState(tr.route, 'open'); }
    const dest = this.byId.get(tr.to); if (dest) dest.springs.extraLift = 0;
    worldUi.ap.value = Math.max(0, worldUi.ap.peek() - this.travelAp);
    worldUi.current.value = tr.to;
    this.placeToken();
    worldUi.busy.value = false;
    void services.scenes?.goto('region', { regionId: tr.regionId }, { style: 'dive' });
  }

  // ── IScene ──
  update(dt: number): void {
    this.time += dt;
    const reduced = ui.reducedMotion.peek();
    if (this.travel) this.updateTravel(dt);
    this.rig.update(dt);
    this.frameN++;
    if (this.pointer && !this.rig.isSettled() && !this.rig.isDragging && this.frameN % 4 === 0) this.pick();

    // 进场演出
    if (this.intro >= 0) {
      this.intro += dt;
      let all = true;
      for (const p of this.pieces) {
        const local = this.intro - (p.userData.introDelay as number);
        p.introOffset = local <= 0 ? 0.06 : Math.max(0, 0.06 * (1 - local / 0.3));
        if (p.introOffset > 0) all = false;
        p.markDirty();
      }
      const cloudT = Math.min(1, Math.max(0, (this.intro - 0.9) / 0.4));
      for (const c of this.clouds) c.local.uPaperFade.value = 1 - cloudT;
      if (all && cloudT >= 1) this.skipIntro();
    }

    let lifting = false;
    for (const p of this.pieces) { if (p.update(dt, reduced)) this.needsRender = true; lifting ||= p.liftMoving || p.introOffset > 0; }
    if (lifting) this.shadowDirty = true;
    if (this.routes?.update(dt)) this.shadowDirty = true;
    if (this.token) {
      // 棋子跟随所在片的抬升（不在旅行时）
      if (!this.travel && !this.token.hopping) { const pc = this.byId.get(worldUi.current.peek()); if (pc) this.token.position.y = pc.topY; }
      this.token.update(dt);
      if (this.token.hopping) this.shadowDirty = true;
    }

    // 云：漂移 + 视差 + 指针靠近溶解
    const tgt = this.rig.target;
    if (!reduced) for (const c of this.clouds) {
      c.base.x += c.vx * dt;
      if (c.base.x > MAP_WIDTH * 0.75) c.base.x = -MAP_WIDTH * 0.75;
      c.mesh.position.z = c.base.z;
    }
    for (const [i, c] of this.clouds.entries()) c.mesh.position.x = c.base.x + tgt.x * (MAP_LAYOUT.clouds[i]?.parallax ?? 0.2);
    if (this.intro < 0) for (const c of this.clouds) {
      let fade = 0;
      if (this.pointer) {
        const v = c.mesh.position.clone().project(this.rig.camera);
        const W = innerWidth, H = innerHeight;
        const dx = (v.x - this.pointer.x) * W / 2, dy = (v.y - this.pointer.y) * H / 2;
        if (Math.hypot(dx, dy) < 120) fade = 0.7;
      }
      c.local.uPaperFade.value += (fade - c.local.uPaperFade.value) * Math.min(1, dt * 8);
    }
    if (ui.quality.peek() !== 'high') for (const c of this.clouds) c.mesh.castShadow = false;
    this.shadowDirty ||= this.clouds.length > 0 && !reduced && ui.quality.peek() === 'high' && this.frameN % 3 === 0;

    // dive 前半程：其余片压暗
    services.labels?.setCamera(this.rig.camera, this.rig.zoom);
    this.updateLabelWorlds();
  }

  private updateLabelWorlds(): void {
    const lp = services.labels; if (!lp) return;
    // 片抬升时标注跟着走：原地改 world 向量（LabelProjector 每帧投影它），不重新登记
    for (const pc of this.pieces) { const v = this.labelPos.get(pc.pid); if (v) pc.labelWorld(v); }
  }

  render(r: WebGLRenderer, target: WebGLRenderTarget | null): void {
    r.getSize(this.sizeTmp);
    const aspect = this.sizeTmp.x / Math.max(1, this.sizeTmp.y);
    if (Math.abs(this.rig.camera.aspect - aspect) > 1e-3) this.rig.resize(this.sizeTmp.x, this.sizeTmp.y);
    if (!r.shadowMap.enabled) { r.shadowMap.enabled = true; r.shadowMap.type = isPCSSPatched() ? r.shadowMap.type : PCFSoftShadowMap; }
    r.shadowMap.autoUpdate = false;
    r.shadowMap.needsUpdate = this.shadowDirty || this.needsShadowOnce;
    this.shadowDirty = false; this.needsShadowOnce = false;
    r.setRenderTarget(target);
    r.render(this.scene, this.rig.camera);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = true;
    this.needsRender = false;
  }
  private needsShadowOnce = true;
  private sizeTmp = new Vector2();

  resize(w: number, h: number): void { this.rig.resize(w, h); this.needsShadowOnce = true; }

  isIdle(): boolean {
    return !this.travel && this.intro < 0 && this.rig.isSettled() && this.pieces.every((p) => !p.liftMoving)
      && !this.token?.hopping;   // 云的漂移属于可降帧的氛围动画
  }

  // ── 输入 ──
  private pick(): void {
    if (!this.pointer || this.travel || worldUi.busy.peek()) return;
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    const hit = this.raycaster.intersectObjects(this.pieces.map((p) => p.top), false)[0];
    const id = (hit?.object.userData.pieceId as string | undefined) ?? null;
    const pv = id ? this.view.peek().provinces.find((p) => p.id === id) : null;
    const lockedHit = pv ? this.isLocked(pv.id, pv.locked) : false;
    setHover(id && !lockedHit ? { type: 'province', id } : null);
    const canvas = services.input ? (document.getElementById('scene') as HTMLCanvasElement | null) : null;
    if (canvas) canvas.style.cursor = id && !lockedHit ? 'pointer' : 'default';
  }

  private pickId(ndc: Vector2): string | null {
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const hit = this.raycaster.intersectObjects(this.pieces.map((p) => p.top), false)[0];
    return (hit?.object.userData.pieceId as string | undefined) ?? null;
  }

  onPointer(e: ScenePointerEvent): void {
    if (this.intro >= 0 && (e.type === 'down' || e.type === 'click')) this.skipIntro();
    if (this.travel) { if (e.type === 'click') this.travel.t = this.travel.plan.totalMs; return; }
    const consumed = this.rig.onPointer(e);
    if (e.type === 'move' || e.type === 'drag') { this.pointer = e.ndc.clone(); this.pointerPx = e.px; }
    if (e.type === 'move') this.pick();
    if (e.type === 'up' && consumed) this.pick();
    if (e.type === 'leave') { this.pointer = null; setHover(null); }
    if (e.type !== 'click') return;
    const id = this.pickId(e.ndc);
    if (!id) { setSelection(null); return; }
    const pv = this.view.peek().provinces.find((p) => p.id === id)!;
    if (this.isLocked(id, pv.locked)) {
      this.byId.get(id)?.jolt();
      worldUi.toast.value = { key: pv.lockReasonKey ?? 'map.locked.reason', px: e.px, t: performance.now() };
      return;
    }
    setSelection({ type: 'province', id });
    if (this.mode === 'pickOnly') this.onPick?.(id);
  }

  onKey(e: KeyboardEvent): boolean {
    if (this.intro >= 0) { this.skipIntro(); return true; }
    if (this.travel) { this.travel.t = this.travel.plan.totalMs; return true; }
    if (this.mode === 'normal' && ['1', '2', '3'].includes(e.key)) {
      worldUi.layer.value = (['faction', 'goodwill', 'routes'] as const)[Number(e.key) - 1]; return true;
    }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const d = dirs[e.key];
    const sel = ui.selection.peek();
    if (d) {
      const curId = sel?.type === 'province' ? sel.id : worldUi.current.peek();
      const cur = this.byId.get(curId); if (!cur) return true;
      let best: string | null = null, bestAng = (75 * Math.PI) / 180;
      for (const nid of this.adjacency.get(curId) ?? []) {
        const n = this.byId.get(nid)!;
        const pv = this.view.peek().provinces.find((p) => p.id === nid);
        if (pv && this.isLocked(nid, pv.locked)) continue;
        const vx = n.label[0] - cur.label[0], vy = n.label[1] - cur.label[1];
        const ang = Math.acos(Math.max(-1, Math.min(1, (vx * d[0] + vy * d[1]) / (Math.hypot(vx, vy) || 1))));
        if (ang < bestAng) { bestAng = ang; best = nid; }
      }
      if (best) { setSelection({ type: 'province', id: best }); if (this.mode === 'pickOnly') this.onPick?.(best); }
      return true;
    }
    if (e.key === 'Enter' && this.mode === 'normal' && sel?.type === 'province') {
      const pv = this.view.peek().provinces.find((p) => p.id === sel.id);
      const rid = worldUi.destRegion.peek() ?? pv?.regions.find((r) => r.unlocked && r.apCost !== null)?.id;
      if (rid && provinceOfRegion(rid) === sel.id) this.startTravel(rid);
      return true;
    }
    return false;
  }

  // ── dive / rise（§8.4） ──
  getFocusRect(params: unknown): NdcRect | null {
    const rid = (params as { regionId?: string } | undefined)?.regionId;
    if (!rid) return null;
    const pc = this.byId.get(provinceOfRegion(rid)); if (!pc) return null;
    const b = pc.worldBox(this.tmpBox);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.rig.camera);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, y0, x1, y1 };
  }

  private fillState(id: string, fill: number): { x: number; z: number; d: number } {
    const pc = this.byId.get(id)!;
    const b = pc.worldBox(this.tmpBox), c = b.getCenter(new Vector3());
    return { x: c.x, z: c.z, d: this.rig.distForBox(b, fill) };
  }

  setDiveProgress(t: number, dir: 'dive' | 'rise', params: unknown): void {
    if (dir !== 'dive') return;
    const rid = (params as { regionId?: string } | undefined)?.regionId; if (!rid) return;
    const pid = provinceOfRegion(rid);
    if (!this.dive) {
      const g = this.rig.goalTarget;
      this.dive = { from: { x: g.x, z: g.z, d: this.rig.goalDist }, to: this.fillState(pid, 0.8) };
    }
    const k = easeInCubic(Math.min(1, t));
    const { from, to } = this.dive;
    this.rig.set(from.x + (to.x - from.x) * k, from.z + (to.z - from.z) * k, from.d + (to.d - from.d) * k, true);
    for (const p of this.pieces) { p.springs.dimOverride = p.pid === pid ? null : 1 - 0.5 * k; p.markDirty(); }
  }

  alignTo(_rect: NdcRect): void {
    const sel = ui.selection.peek();
    const pid = sel?.type === 'province' ? sel.id : worldUi.current.peek();
    if (!this.byId.has(pid)) return;
    const s = this.fillState(pid, 0.8);
    this.rig.set(s.x, s.z, s.d, true);
    this.focusPiece(pid);
    this.rig.set(this.rig.goalTarget.x, this.rig.goalTarget.z, 30);
    this.focusPiece(pid);
  }

  exit(_to: Screen): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    services.labels?.clear();
    this.labelKey.clear();
    setHover(null);
    this.dive = null;
    const canvas = document.getElementById('scene'); if (canvas) canvas.style.cursor = 'default';
  }

  dispose(): void {
    for (const p of this.pieces) p.dispose();
    this.baseTex?.dispose(); this.baseTex = null;
    this.routes?.dispose(); this.token?.dispose();
    for (const c of this.clouds) { c.mesh.geometry.dispose(); (c.mesh.material as MeshLambertMaterial).map?.dispose(); (c.mesh.material as MeshLambertMaterial).dispose(); }
    this.scene.clear(); this.pieces = []; this.byId.clear(); this.clouds = []; this.built = false;
  }
}
