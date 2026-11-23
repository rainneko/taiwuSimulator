import { effect } from '@preact/signals';
import {
  Color, DirectionalLight, Fog, HemisphereLight, Mesh, PCFSoftShadowMap, PerspectiveCamera,
  PlaneGeometry, PointLight, Scene, Texture, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { createPaperMaterial, HingeState, makeCardGeometry, PaperCard, stepSpring } from '../render/paper';
import type { AssetCache } from '../app/AssetCache';
import type { ScenePointerEvent } from '../app/InputRouter';
import type { IScene } from '../app/SceneManager';
import { ui, type Screen } from '../app/store';
import { t } from '../app/strings';
import { inkRidgeTexture, titleTexture } from './menuArt';
import { ParallaxRig } from './ParallaxRig';

interface PropLayout { key: string; x: number; z: number; w: number; h: number }
interface MenuLayout { props: PropLayout[] }

const LAYERS = 5;
const LAYER_Z = [-14, -11, -8, -5, -2];
const LAYER_H = [7, 5.5, 4.2, 3, 2];
const LAYER_TONE = ['rgba(150,160,165,0.85)', 'rgba(120,130,130,0.9)', 'rgba(95,100,95,0.95)', 'rgba(80,75,65,1)', 'rgba(60,52,42,1)'];
const LAYER_K = [0.85, 0.65, 0.45, 0.25, 0.1];
const NEWGAME_X = 9;
/** 菜单项 → 小灯位置（与 DOM 列大致对齐：右侧竖列）。 */
const HOVER_IDS = ['continue', 'new', 'load', 'settings', 'credits'];

const DEFAULT_PROPS: PropLayout[] = [
  { key: 'menu.prop.grass', x: -3.5, z: 0.5, w: 0.8, h: 0.6 },
  { key: 'menu.prop.stone', x: 2.6, z: 1.2, w: 0.9, h: 0.5 },
  { key: 'menu.prop.grass', x: 4.8, z: -0.4, w: 0.7, h: 0.5 },
  { key: 'menu.prop.tree', x: -6.5, z: -0.8, w: 1.4, h: 2.4 },
];

/** 主菜单 + 新建向导共用的纸景舞台。 */
export class MenuScene implements IScene {
  id: Screen = 'mainMenu';
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.1, 200);
  private cards: PaperCard[] = [];
  private title: PaperCard | null = null;
  private rig = new ParallaxRig();
  private key!: DirectionalLight;
  private hoverLights = new Map<string, { light: PointLight; v: { x: number; v: number } }>();
  private layout: MenuLayout | null = null;
  private tex = new Map<string, Texture | null>();
  private built = false;
  private time = 0;
  private pointer = { x: 0, y: 0 };
  private camX = { x: 0, v: 0 };   // 模式平移
  private look = { x: 0, v: 0 };   // 指针横移
  private yaw = { x: 0, v: 0 };
  private pitch = { x: 0, v: 0 };
  private mode: 'menu' | 'newGame' = 'menu';
  private introDone = false;
  private disposeEffect: (() => void) | null = null;
  private disposables: Array<{ dispose(): void }> = [];

  async preload(assets: AssetCache, signal: AbortSignal): Promise<void> {
    const keys = ['menu.title', ...Array.from({ length: LAYERS }, (_, i) => `menu.layer.${i}`)];
    this.layout = await assets.loadJson<MenuLayout>(`${import.meta.env.BASE_URL}content/menu.layout.json`, signal);
    for (const p of this.layout?.props ?? DEFAULT_PROPS) keys.push(p.key);
    await Promise.all(keys.map(async (k) => { this.tex.set(k, await assets.texture(k, signal)); }));
  }

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    s.background = new Color(0xe8dcc2);
    s.fog = new Fog(0xe8dcc2, 16, 34);
    // 灯：createLightRig('menu') 尚未存在，这里就地搭一套
    const hemi = new HemisphereLight(0xfff5e2, 0x6b5a44, 0.9); s.add(hemi);
    this.key = new DirectionalLight(0xfff1dc, 2.0);
    this.key.position.set(-6, 9, 8); this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera; sc.left = -22; sc.right = 22; sc.top = 12; sc.bottom = -4; sc.near = 1; sc.far = 40;
    this.key.shadow.bias = -0.0005; this.key.shadow.radius = 4;
    s.add(this.key, this.key.target);

    const ground = new Mesh(new PlaneGeometry(40, 14), createPaperMaterial({ doubleSided: false, color: 0xd9c9a6 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(NEWGAME_X / 2, 0, -5); ground.receiveShadow = true;
    s.add(ground); this.disposables.push(ground.geometry, ground.material);

    const mk = (key: string, w: number, h: number, fallback: () => Texture | null, color = 0xffffff): PaperCard => {
      let map = this.tex.get(key) ?? null;
      if (!map) { map = fallback(); if (map) this.disposables.push(map); }
      const mat = createPaperMaterial(map ? { map, color } : { color: 0x8d7a5c, cutout: false });
      const card = new PaperCard(makeCardGeometry({ width: w, height: h, uv: [0, 0, 1, 1] }), mat);
      this.disposables.push(card.geometry, mat);
      return card;
    };

    for (let i = 0; i < LAYERS; i++) {
      const card = mk(`menu.layer.${i}`, 44, LAYER_H[i], () => inkRidgeTexture(i + 1, LAYER_TONE[i]));
      card.position.set(NEWGAME_X / 2, 0, LAYER_Z[i]);
      card.castShadow = true;
      s.add(card); this.cards.push(card); this.rig.add(card, LAYER_K[i]);
    }
    for (const p of this.layout?.props ?? DEFAULT_PROPS) {
      const card = mk(p.key, p.w, p.h, () => null);
      card.position.set(p.x, 0, p.z); s.add(card); this.cards.push(card);
    }
    this.title = mk('menu.title', 1.1, 3.3, () => titleTexture(t('menu.title')));
    this.title.position.set(-2.6, 0.02, 1.5);
    s.add(this.title);

    // 新建向导一侧：给 PortraitStage 留的空台
    const plinth = mk('menu.plinth', 2.4, 0.35, () => null);
    plinth.position.set(NEWGAME_X - 1.8, 0, 1.2); plinth.rise(0); s.add(plinth); this.cards.push(plinth);

    HOVER_IDS.forEach((id, i) => {
      const light = new PointLight(0xffc88a, 0, 5, 1.6);
      light.position.set(2.6, 2.6 - i * 0.45, 3);
      s.add(light); this.hoverLights.set(id, { light, v: { x: 0, v: 0 } });
    });
  }

  enter(_params: unknown, _from: Screen | null): void {
    this.build();
    this.id = ui.screen.peek() === 'newGame' ? 'newGame' : 'mainMenu';
    ui.menuReady.value = false;
    this.introDone = false;
    const reduced = ui.reducedMotion.peek();
    this.cards.forEach((c, i) => {
      if (c.state === HingeState.LOCKED) return;
      c.hinge.theta = 0; c.hinge.vel = 0; c.state = HingeState.FLAT;
      c.rise(Math.min(i, LAYERS) * 0.12);
    });
    this.title!.hinge.theta = 0; this.title!.state = HingeState.FLAT;
    this.title!.rise(LAYERS * 0.12 + 0.15);
    if (reduced) this.skipIntro();
    this.disposeEffect?.();
    this.disposeEffect = effect(() => {
      const h = ui.hover.value;
      const on = h?.type === 'menu' ? h.id : null;
      this.hoverTarget = on;
    });
  }
  private hoverTarget: string | null = null;

  private skipIntro(): void {
    for (const c of [...this.cards, this.title!]) { c.hinge.theta = Math.PI / 2; c.hinge.vel = 0; c.state = HingeState.LOCKED; c.update(0); }
    this.finishIntro();
  }
  private finishIntro(): void { if (!this.introDone) { this.introDone = true; ui.menuReady.value = true; } }

  onRetarget(to: Screen): void { this.id = to; this.mode = to === 'newGame' ? 'newGame' : 'menu'; }

  update(dt: number): void {
    this.time += dt;
    const reduced = ui.reducedMotion.peek();
    let moving = false;
    for (const c of this.cards) { c.update(dt); moving ||= c.moving; }
    this.title?.update(dt);
    if (!this.introDone && !moving && this.title && this.title.state === HingeState.LOCKED) this.finishIntro();

    // 相机：模式平移（1.0s 临界阻尼 ≈ omega 6）+ 指针偏转（omega 4）
    stepSpring(this.camX, this.mode === 'newGame' ? NEWGAME_X : 0, 6, dt);
    const px = reduced ? 0 : this.pointer.x, py = reduced ? 0 : this.pointer.y;
    stepSpring(this.look, px * 0.25, 4, dt);
    stepSpring(this.yaw, -px * 2 * Math.PI / 180, 4, dt);
    stepSpring(this.pitch, py * 1 * Math.PI / 180, 4, dt);
    const cx = this.camX.x + this.look.x;
    this.camera.position.set(cx, 2.2, 13);
    this.camera.lookAt(cx, 1.8, 0);
    this.camera.rotateY(this.yaw.x); this.camera.rotateX(this.pitch.x);
    if (!reduced) this.rig.update({ x: this.look.x });

    // key 光沿 X 缓慢往返
    if (this.key) {
      const kx = -6 + Math.sin(this.time * 0.15) * 5 + this.camX.x;
      this.key.position.set(kx, 9, 8); this.key.target.position.set(this.camX.x, 0, -4);
    }
    const lowQ = ui.quality.peek() === 'low';
    for (const [id, h] of this.hoverLights) {
      stepSpring(h.v, !lowQ && this.hoverTarget === id && this.mode === 'menu' ? 6 : 0, 10, dt);
      h.light.intensity = Math.max(0, h.v.x);
      h.light.position.x = this.camX.x + 2.6;
    }
  }

  isIdle(): boolean {
    if (this.cards.some((c) => c.moving) || this.title?.moving) return false;
    const target = this.mode === 'newGame' ? NEWGAME_X : 0;
    // key 光一直在缓慢往返，属于可降帧的氛围动画
    return Math.abs(this.camX.x - target) < 1e-3 && Math.abs(this.look.v) < 1e-3 && Math.abs(this.yaw.v) < 1e-4;
  }

  resize(w: number, h: number): void { this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }

  render(r: WebGLRenderer, target: WebGLRenderTarget | null): void {
    if (!r.shadowMap.enabled) { r.shadowMap.enabled = true; r.shadowMap.type = PCFSoftShadowMap; }
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
  }

  onPointer(e: ScenePointerEvent): void {
    if (e.type === 'move' || e.type === 'drag') { this.pointer.x = e.ndc.x; this.pointer.y = e.ndc.y; }
    if (e.type === 'leave') { this.pointer.x = 0; this.pointer.y = 0; }
    if ((e.type === 'down' || e.type === 'click') && !this.introDone) this.skipIntro();
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.introDone) { this.skipIntro(); return true; }
    void e; return false;
  }

  exit(_to: Screen): void { this.disposeEffect?.(); this.disposeEffect = null; ui.menuReady.value = false; }

  dispose(): void {
    this.disposeEffect?.();
    for (const d of this.disposables) d.dispose();
    this.disposables = []; this.cards = []; this.rig.clear(); this.scene.clear(); this.built = false;
  }
}
