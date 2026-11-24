import { AmbientLight, DirectionalLight, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { CombatEvent, CombatState } from '../../core/combat';
import { DEFEAT_THRESHOLD } from '../../core/combat';
import { paperGlobals } from '../paper';
import type { spine } from '../spine-webgl-3.8';
import { AnimationController } from './AnimationController';
import { CombatDirector, PX_PER_DIST } from './CombatDirector';
import { loadSkillAnimTable, type SkillAnimTable } from './animMapping';
import { ScreenShake, TimeScaler } from './HitFeel';
import { hudState, mountHud } from './hud/Hud';
import { DESIGN_H, DESIGN_W, GROUND_Y, ParallaxBackground } from './ParallaxBg';
import { SpineActor, type SpineSkin } from './SpineActor';
import { loadSpineData } from './spineAssets';
import { SpineLayer } from './SpineLayer';

export interface CombatRendererOptions {
  bgSet?: number;
  skins?: [SpineSkin, SpineSkin];
  /** 骨骼缩放（原版数据单位 → 设计像素） */
  skeletonScale?: number;
  onPauseToggle?: () => void;
}

/**
 * 镜头缩放随距离：近身 2.0 时人最大，拉到 9.0 时缩到约 0.6。
 * 用落脚点间距（跳跃补间中的值）而不是逻辑距离，镜头与跳跃同步。
 */
const ZOOM_NEAR = 1.08;
const ZOOM_FAR = 0.62;
function zoomForGap(gapPx: number): number {
  const k = Math.min(1, Math.max(0, (gapPx / PX_PER_DIST - 2) / 7));
  return ZOOM_NEAR + (ZOOM_FAR - ZOOM_NEAR) * k;
}

function makeCanvas(parent: HTMLElement, z: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: String(z), display: 'block' });
  parent.appendChild(c);
  return c;
}

/**
 * 双画布 + DOM 三层：three.js 背景（底）/ spine-webgl 角色（中）/ Preact HUD（顶）。
 * 三层放进同一个 16:9 的 stage，屏幕震动对 stage 整体施加。
 */
export class CombatRenderer {
  readonly stage: HTMLDivElement;
  readonly bgCanvas: HTMLCanvasElement;
  readonly spineCanvas: HTMLCanvasElement;
  readonly bgRenderer: WebGLRenderer;
  readonly bgScene = new Scene();
  readonly bgCamera = new OrthographicCamera(0, DESIGN_W, DESIGN_H, 0, -100, 100);
  readonly background: ParallaxBackground;
  readonly spineLayer: SpineLayer;
  readonly shake: ScreenShake;
  actors: [SpineActor, SpineActor] | null = null;
  controllers: [AnimationController, AnimationController] | null = null;
  director: CombatDirector | null = null;
  timeScaler: TimeScaler | null = null;
  private skills: SkillAnimTable = {};
  private unmountHud: () => void;
  private ro: ResizeObserver;
  private skeletonData: spine.SkeletonData | null = null;
  /** 屏幕中心对应的世界 x */
  private camX = DESIGN_W / 2;
  private zoom = 1;
  private viewReady = false;

  constructor(private container: HTMLElement, private opts: CombatRendererOptions = {}) {
    this.stage = document.createElement('div');
    Object.assign(this.stage.style, { position: 'absolute', overflow: 'hidden', background: '#1d1912' });
    container.appendChild(this.stage);
    this.bgCanvas = makeCanvas(this.stage, 0);
    this.spineCanvas = makeCanvas(this.stage, 1);
    this.spineCanvas.style.pointerEvents = 'none';

    this.bgRenderer = new WebGLRenderer({ canvas: this.bgCanvas, antialias: true });
    this.bgScene.add(new AmbientLight(0xffffff, 2.2));
    const sun = new DirectionalLight(0xfff1dc, 0.9);
    sun.position.set(-0.4, 0.6, 1);
    this.bgScene.add(sun);
    // 纤维噪声按世界坐标采样；这里 1 单位 = 1 设计像素，缩小频率
    paperGlobals.uPaperFibreScale.value = 0.012;

    this.background = new ParallaxBackground(this.bgScene);
    this.spineLayer = new SpineLayer(this.spineCanvas);
    this.shake = new ScreenShake(this.stage);
    this.unmountHud = mountHud(this.stage, () => this.opts.onPauseToggle?.());

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(container);
    this.layout();
  }

  async load(): Promise<void> {
    const [data, skills] = await Promise.all([
      loadSpineData(this.spineLayer.context, this.opts.skeletonScale ?? 0.32),
      loadSkillAnimTable().catch(() => ({}) as SkillAnimTable),
      this.background.load(this.opts.bgSet ?? 0),
    ]);
    this.skills = skills;
    this.skeletonData = data.skeletonData;
    const skins = this.opts.skins ?? ['doll', 'doll'];
    this.actors = [new SpineActor(data.skeletonData, skins[0]), new SpineActor(data.skeletonData, skins[1])];
    this.spineLayer.actors.push(...this.actors);
    this.timeScaler = new TimeScaler(this.actors);
  }

  setBackground(setIndex: number) { return this.background.load(setIndex); }

  /** 绑定一场战斗：按 fighters 顺序建两个动画控制器。 */
  bind(state: CombatState) {
    if (!this.actors) throw new Error('CombatRenderer.load() 未完成');
    for (const a of this.actors) { a.animationState.clearListeners(); a.animationState.clearTracks(); }
    this.controllers = [
      new AnimationController(state.fighters[0].id, this.actors[0], this.skills),
      new AnimationController(state.fighters[1].id, this.actors[1], this.skills),
    ];
    this.director = new CombatDirector(state, this.controllers, this.skeletonData!, {
      onImpact: (target, sev) => {
        this.actors![target].flash(sev === 1 ? 2 : 3);
        this.timeScaler!.applyHitstop([0, 3, 5, 8][sev]);
        if (sev >= 2) this.shake.add(sev * 4, sev * 3, 8 + sev * 4);
      },
      onFinisher: () => this.timeScaler!.applySlowmo(12),
    });
    this.viewReady = false;
    hudState.value = { ...hudState.value, ended: null };
  }

  /** 是否处于顿帧（演示中可据此暂停逻辑步进） */
  get frozen(): boolean { return this.actors?.[0].animationState.timeScale === 0; }

  /** 每渲染帧调用：events 为本帧核心引擎产出的事件。 */
  renderFrame(state: CombatState, dt: number, events: readonly CombatEvent[] = []) {
    const [f1, f2] = state.fighters;
    const d = this.director;
    if (this.controllers && d) {
      this.controllers[0].sync(f1);
      this.controllers[1].sync(f2);
      d.handleEvents(state, events);
    }
    const ts = this.timeScaler?.tick() ?? 1;
    this.shake.update();
    d?.update(dt, ts);

    // 镜头：跟两人落脚点中点平移，按间距推拉
    if (d) {
      const targetCam = d.viewMid;
      const targetZoom = zoomForGap(Math.abs(d.viewGap));
      if (!this.viewReady) { this.camX = targetCam; this.zoom = targetZoom; this.viewReady = true; }
      this.camX += d.lastShift + (targetCam - this.camX) * Math.min(1, dt * 4);
      this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 2.5);
    }

    if (this.actors && d) {
      for (let i = 0; i < 2; i++) {
        const m = d.motions[i];
        this.actors[i].setPosition(m.worldX, GROUND_Y + m.height, m.facing < 0, m.squashY);
      }
    }
    this.spineLayer.setView(this.camX, this.zoom);
    this.spineLayer.update(dt);

    this.background.update(this.camX, this.zoom);
    if (this.actors && d) {
      for (let i = 0; i < 2; i++) this.background.setShadow(i, this.camX, this.zoom, this.actors[i].bodyX, d.motions[i].height);
    }
    this.bgRenderer.render(this.bgScene, this.bgCamera);
    this.spineLayer.draw();

    const thr = Math.round(DEFEAT_THRESHOLD[state.battleType] * 1000);
    const hf = (f: typeof f1) => ({
      name: f.name,
      inner: f.totalInner / thr,
      outer: f.totalOuter / thr,
      guard: f.guardMax > 0 ? f.guard / f.guardMax : 0,
    });
    const end = events.find((e) => e.type === 'end');
    const prev = hudState.value;
    hudState.value = {
      fighters: [hf(f1), hf(f2)],
      distance: state.distance,
      paused: state.phase === 'paused',
      ended: end && end.type === 'end'
        ? (end.payload.winnerId ? `${state.fighters.find((f) => f.id === end.payload.winnerId)?.name ?? ''} 胜` : '平局')
        : prev.ended,
    };
  }

  /** 让 16:9 stage 适配容器（letterbox），两张画布按设备像素比设置分辨率。 */
  private layout() {
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    const s = Math.min(cw / DESIGN_W, ch / DESIGN_H);
    const w = Math.round(DESIGN_W * s), hgt = Math.round(DESIGN_H * s);
    Object.assign(this.stage.style, {
      width: `${w}px`, height: `${hgt}px`, left: `${(cw - w) / 2}px`, top: `${(ch - hgt) / 2}px`,
      fontSize: `${Math.max(10, 14 * s * 1.4)}px`,
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(w * dpr), ph = Math.round(hgt * dpr);
    this.bgRenderer.setPixelRatio(1);
    this.bgRenderer.setSize(pw, ph, false);
    this.spineLayer.resize(pw, ph);
  }

  dispose() {
    this.ro.disconnect();
    this.unmountHud();
    this.bgRenderer.dispose();
    this.stage.remove();
  }
}
