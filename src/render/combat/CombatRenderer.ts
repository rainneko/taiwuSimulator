import { AmbientLight, DirectionalLight, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import type { CombatEvent, CombatState } from '../../core/combat';
import { DEFEAT_THRESHOLD } from '../../core/combat';
import { paperGlobals } from '../paper';
import { AnimationController } from './AnimationController';
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

/** 逻辑距离 1 单位对应的设计像素 */
const PX_PER_DIST = 150;

/** 角色原版朝向：skeleton 默认面朝右（玩家在左，不翻转；敌方水平镜像）。 */
const PLAYER_FLIP = false;

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
  timeScaler: TimeScaler | null = null;
  private skills: SkillAnimTable = {};
  private unmountHud: () => void;
  private ro: ResizeObserver;
  private camX = 0;

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
    const skins = this.opts.skins ?? ['doll', 'doll'];
    this.actors = [new SpineActor(data.skeletonData, skins[0]), new SpineActor(data.skeletonData, skins[1])];
    this.spineLayer.actors.push(...this.actors);
    this.timeScaler = new TimeScaler(this.actors);
  }

  setBackground(setIndex: number) { return this.background.load(setIndex); }

  /** 绑定一场战斗：按 fighters 顺序建两个动画控制器。 */
  bind(state: CombatState) {
    if (!this.actors) throw new Error('CombatRenderer.load() 未完成');
    const fb = {
      onHit: (target: SpineActor, sev: 1 | 2 | 3) => {
        target.flash(sev === 1 ? 2 : 3);
        this.timeScaler!.applyHitstop([0, 3, 5, 8][sev]);
        if (sev >= 2) this.shake.add(sev * 4, sev * 3, 8 + sev * 4);
      },
      onFinisher: () => this.timeScaler!.applySlowmo(12),
    };
    this.controllers = [
      new AnimationController(state.fighters[0].id, this.actors[0], this.skills, fb),
      new AnimationController(state.fighters[1].id, this.actors[1], this.skills, fb),
    ];
  }

  /** 是否处于顿帧（演示中可据此暂停逻辑步进） */
  get frozen(): boolean { return this.actors?.[0].animationState.timeScale === 0; }

  /** 每渲染帧调用：events 为本帧核心引擎产出的事件。 */
  renderFrame(state: CombatState, dt: number, events: readonly CombatEvent[] = []) {
    const [f1, f2] = state.fighters;
    if (this.controllers) {
      for (const c of this.controllers) {
        const self = c.actorId === f1.id ? f1 : f2;
        c.sync(self);
        for (const ev of events) c.handleEvent(ev, self);
      }
    }
    this.timeScaler?.tick();
    this.shake.update();

    // 镜头：两人中点（逻辑坐标）→ 视差偏移
    const mid = ((f1.position + f2.position) / 2) * PX_PER_DIST;
    const targetCam = Math.max(-300, Math.min(300, Number.isFinite(mid) ? mid : 0));
    this.camX += (targetCam - this.camX) * 0.1;
    this.background.update(this.camX);
    this.bgRenderer.render(this.bgScene, this.bgCamera);

    if (this.actors) {
      const spread = Math.max(1, state.distance) * PX_PER_DIST;
      const cx = DESIGN_W / 2;
      this.actors[0].setPosition(cx - spread / 2, GROUND_Y, PLAYER_FLIP);
      this.actors[1].setPosition(cx + spread / 2, GROUND_Y, !PLAYER_FLIP);
    }
    this.spineLayer.render(dt);

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
