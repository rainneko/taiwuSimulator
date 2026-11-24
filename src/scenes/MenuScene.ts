import { effect } from '@preact/signals';
import {
  Color, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PointLight, Scene,
  Texture, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import { createPaperMaterial, HingeState, makeCardGeometry, PaperCard, stepSpring } from '../render/paper';
import type { AssetCache } from '../app/AssetCache';
import type { ScenePointerEvent } from '../app/InputRouter';
import type { IScene } from '../app/SceneManager';
import { ui, type Screen } from '../app/store';
import { t } from '../app/strings';
import { inkRidgeTexture, loadMenuTexture, splashCharTextures, splashSubtitleTexture, titleTexture } from './menuArt';
import { ParallaxRig } from './ParallaxRig';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NEWGAME_X = 9;
const HOVER_IDS = ['continue', 'new', 'load', 'settings', 'credits'];

// -- Splash --
const SPLASH_LOGO_DUR = 3.0;   // logo fade-in + hold (seconds)
const SPLASH_TITLE_DUR = 1.0;  // title fade-in after logo

// -- Scroll strips (sized to fill camera frustum at STRIP_Z) --
const STRIP_W = 16;
const STRIP_H = 9;
const SCROLL_SPEED = 0.25;
const STRIP_Z = -4;
const STRIP_Y = -2.5;
const STRIP_Y_OFF = 12;

// -- Scroll text poem panels --
const TEXT_W = 2.0;
const TEXT_H = 3.0;
const PULSE_COLOR_A = new Color(1, 1, 1);
const PULSE_COLOR_B = new Color(0.314, 0.275, 0.255);
const PULSE_PERIOD = 5;

// -- Edge wave borders (prominent, top & bottom) --
const EDGE_W = 20;
const EDGE_H = 2.5;
const EDGE_BOB_AMP = 0.1;
const EDGE_BOB_FREQ = 0.5;

// -- Title (top-center, large calligraphy) --
const TITLE_W = 5.5;
const TITLE_H = 2.4;

// -- Fallback procedural layers (when assets missing) --
const LAYERS = 5;
const LAYER_Z = [-14, -11, -8, -5, -2];
const LAYER_H = [7, 5.5, 4.2, 3, 2];
const LAYER_TONE = [
  'rgba(150,160,165,0.85)', 'rgba(120,130,130,0.9)', 'rgba(95,100,95,0.95)',
  'rgba(80,75,65,1)', 'rgba(60,52,42,1)',
];
const LAYER_K = [0.85, 0.65, 0.45, 0.25, 0.1];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ScrollStrip {
  group: Group;
  backMesh: Mesh;
  artMesh1: Mesh;
  artMesh2: Mesh;
  textPanels: Mesh[];
}

function makePlane(w: number, h: number, mat: MeshBasicMaterial | ReturnType<typeof createPaperMaterial>): Mesh {
  const g = new PlaneGeometry(w, h);
  const m = new Mesh(g, mat);
  return m;
}

/** Smooth linear yoyo t in [0,1] for period p. */
function yoyo(time: number, period: number, delay = 0): number {
  const t = ((time - delay) % period + period) % period;
  const half = period / 2;
  return t < half ? t / half : 1 - (t - half) / half;
}

// ---------------------------------------------------------------------------
// MenuScene
// ---------------------------------------------------------------------------

/** 主菜单 + 新建向导共用的纸景舞台。 */
export class MenuScene implements IScene {
  id: Screen = 'mainMenu';
  private scene = new Scene();
  private camera = new PerspectiveCamera(30, 1, 0.1, 200);

  // Asset textures (null = fallback to procedural)
  private hasOriginalAssets = false;

  // Splash phase
  private phase: 'splash' | 'menu' = 'splash';
  private splashGroup = new Group();
  private splashLogoMesh: Mesh | null = null;
  private splashTitleMesh: Mesh | null = null;
  private splashCharMeshes: Mesh[] = [];
  private splashSubMesh: Mesh | null = null;
  private splashTime = 0;

  // Menu phase — scroll strips
  private strips: ScrollStrip[] = [];
  private edgeTop: Mesh | null = null;
  private edgeBottom: Mesh | null = null;
  private titleCard: PaperCard | null = null;

  // Fallback: procedural layers
  private fallbackCards: PaperCard[] = [];

  // Shared
  private cards: PaperCard[] = [];
  private rig = new ParallaxRig();
  private key!: DirectionalLight;
  private hoverLights = new Map<string, { light: PointLight; v: { x: number; v: number } }>();
  private built = false;
  private time = 0;
  private pointer = { x: 0, y: 0 };
  private camX = { x: 0, v: 0 };
  private look = { x: 0, v: 0 };
  private yaw = { x: 0, v: 0 };
  private pitch = { x: 0, v: 0 };
  private mode: 'menu' | 'newGame' = 'menu';
  private introDone = false;
  private disposeEffect: (() => void) | null = null;
  private disposables: Array<{ dispose(): void }> = [];
  private hoverTarget: string | null = null;

  // Intro animation springs for scroll slide-in
  private stripSlideY = { x: STRIP_Y_OFF, v: 0 };
  private titleFade = { x: 0, v: 0 };

  // Loaded textures cache
  private loadedTex = new Map<string, Texture>();

  // ---------------------------------------------------------------------------
  // preload
  // ---------------------------------------------------------------------------

  async preload(_assets: AssetCache, signal: AbortSignal): Promise<void> {
    // Try loading original assets; if any critical ones fail, fall back
    const paths: Record<string, [string, 'repeat' | 'clamp']> = {
      scrollBack:    ['background/MianScrollBack.png', 'repeat'],
      scroll1_1:     ['background/MianScroll1_1.png', 'clamp'],
      scroll1_2:     ['background/MianScroll1_2.png', 'clamp'],
      scroll2_1:     ['background/MianScroll2_1.png', 'clamp'],
      scroll2_2:     ['background/MianScroll2_2.png', 'clamp'],
      edgeTop:       ['background/ScrollEdge1.png', 'repeat'],
      edgeBottom:    ['background/ScrollEdge2.png', 'repeat'],
      gameTitle:     ['logo/GameTitle.png', 'clamp'],
      logo:          ['logo/LOGO.png', 'clamp'],
    };
    // Poem panels
    for (let i = 0; i < 9; i++) {
      paths[`text${i}`] = [`background/ScrollText_${i}.png`, 'clamp'];
    }

    const entries = Object.entries(paths);
    const results = await Promise.all(
      entries.map(([, [p, w]]) => loadMenuTexture(p, w, signal)),
    );
    for (let i = 0; i < entries.length; i++) {
      const tex = results[i];
      if (tex) { this.loadedTex.set(entries[i][0], tex); this.disposables.push(tex); }
    }

    // Check critical: at minimum we need scrollBack and one scroll art pair
    this.hasOriginalAssets = !!(
      this.loadedTex.get('scrollBack') &&
      this.loadedTex.get('scroll1_1') &&
      this.loadedTex.get('scroll1_2')
    );
  }

  // ---------------------------------------------------------------------------
  // build
  // ---------------------------------------------------------------------------

  private build(): void {
    if (this.built) return;
    this.built = true;
    const s = this.scene;
    s.background = new Color(0x1a1510);
    s.fog = new Fog(0x1a1510, 16, 34);

    // -- Lights --
    const hemi = new HemisphereLight(0xfff5e2, 0x6b5a44, 0.9);
    s.add(hemi);
    this.key = new DirectionalLight(0xfff1dc, 2.0);
    this.key.position.set(-6, 9, 8);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 12; sc.bottom = -4; sc.near = 1; sc.far = 40;
    this.key.shadow.bias = -0.0005;
    this.key.shadow.radius = 4;
    s.add(this.key, this.key.target);

    // -- Ground --
    const ground = new Mesh(
      new PlaneGeometry(40, 14),
      createPaperMaterial({ doubleSided: false, color: 0x2a2318 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(NEWGAME_X / 2, 0, -5);
    ground.receiveShadow = true;
    s.add(ground);
    this.disposables.push(ground.geometry, ground.material);

    if (this.hasOriginalAssets) {
      this.buildOriginalMenu(s);
    } else {
      this.buildFallbackMenu(s);
    }

    this.buildSplash(s);

    // -- Hover lights --
    HOVER_IDS.forEach((id, i) => {
      const light = new PointLight(0xffc88a, 0, 5, 1.6);
      light.position.set(2.6, 2.6 - i * 0.45, 3);
      s.add(light);
      this.hoverLights.set(id, { light, v: { x: 0, v: 0 } });
    });

    // -- Plinth for newGame --
    const plinthMat = createPaperMaterial({ color: 0x2a2318, cutout: false });
    const plinth = new PaperCard(makeCardGeometry({ width: 2.4, height: 0.35, uv: [0, 0, 1, 1] }), plinthMat);
    plinth.position.set(NEWGAME_X - 1.8, 0, 1.2);
    plinth.rise(0);
    s.add(plinth);
    this.cards.push(plinth);
    this.disposables.push(plinth.geometry, plinthMat);
  }

  /** Build with original game assets: scroll strips, edges, title. */
  private buildOriginalMenu(s: Scene): void {
    const scrollBack = this.loadedTex.get('scrollBack')!;

    // Build 2 scroll strips
    for (let si = 0; si < 2; si++) {
      const group = new Group();
      group.position.set(si * STRIP_W, STRIP_Y_OFF, STRIP_Z);

      // Dark scroll background — full-width, using repeat wrap
      const backMat = new MeshBasicMaterial({ map: scrollBack, color: 0x888888 });
      const backMesh = makePlane(STRIP_W, STRIP_H, backMat);
      backMesh.position.set(0, STRIP_H / 2, 0);
      group.add(backMesh);
      this.disposables.push(backMesh.geometry, backMat);

      // Line art overlays (two halves, each covering half the strip width, stretched vertically to half)
      const artKey1 = si === 0 ? 'scroll1_1' : 'scroll2_1';
      const artKey2 = si === 0 ? 'scroll1_2' : 'scroll2_2';
      const artTex1 = this.loadedTex.get(artKey1);
      const artTex2 = this.loadedTex.get(artKey2);

      const halfW = STRIP_W / 2;
      const artH = STRIP_H * 0.6; // stretched to ~60% height (original 1300→650 by localScale.y=0.5)

      const artMat1 = new MeshBasicMaterial({
        map: artTex1 ?? null, transparent: true, opacity: 0.7, depthWrite: false,
      });
      const artMesh1 = makePlane(halfW, artH, artMat1);
      artMesh1.position.set(-halfW / 2, artH / 2 + 0.1, 0.01);
      group.add(artMesh1);
      this.disposables.push(artMesh1.geometry, artMat1);

      const artMat2 = new MeshBasicMaterial({
        map: artTex2 ?? null, transparent: true, opacity: 0.7, depthWrite: false,
      });
      const artMesh2 = makePlane(halfW, artH, artMat2);
      artMesh2.position.set(halfW / 2, artH / 2 + 0.1, 0.01);
      group.add(artMesh2);
      this.disposables.push(artMesh2.geometry, artMat2);

      // ScrollText poem panels — flat overlays on the scroll, semi-transparent, move with scroll
      const textPanels: Mesh[] = [];
      const textsPerStrip = si === 0 ? [0, 1, 2, 3] : [4, 5, 6, 7, 8];
      for (let ti = 0; ti < textsPerStrip.length; ti++) {
        const texIdx = textsPerStrip[ti];
        const textTex = this.loadedTex.get(`text${texIdx}`) ?? null;
        if (!textTex) continue;
        const mat = new MeshBasicMaterial({
          map: textTex, transparent: true, opacity: 0.45, depthWrite: false,
        });
        const panel = makePlane(TEXT_W, TEXT_H, mat);
        // Distribute across strip, vertically centered on the scroll art area
        const spacing = STRIP_W / (textsPerStrip.length + 1);
        panel.position.set(-STRIP_W / 2 + spacing * (ti + 1), STRIP_H * 0.42, 0.03);
        group.add(panel);
        textPanels.push(panel);
        this.disposables.push(panel.geometry, mat);
      }

      s.add(group);
      this.strips.push({ group, backMesh, artMesh1, artMesh2, textPanels });
    }

    // -- Edge wave borders --
    const edgeTopTex = this.loadedTex.get('edgeTop');
    const edgeBotTex = this.loadedTex.get('edgeBottom');

    if (edgeTopTex) {
      const mat = new MeshBasicMaterial({ map: edgeTopTex, transparent: true, depthWrite: false });
      this.edgeTop = makePlane(EDGE_W, EDGE_H, mat);
      this.edgeTop.position.set(0, 5.5, STRIP_Z + 2);
      s.add(this.edgeTop);
      this.disposables.push(this.edgeTop.geometry, mat);
    }
    if (edgeBotTex) {
      const mat = new MeshBasicMaterial({ map: edgeBotTex, transparent: true, depthWrite: false });
      this.edgeBottom = makePlane(EDGE_W, EDGE_H, mat);
      this.edgeBottom.position.set(0, -1.8, STRIP_Z + 2);
      s.add(this.edgeBottom);
      this.disposables.push(this.edgeBottom.geometry, mat);
    }

    // -- Game title calligraphy (top-center, in front of scroll strips) --
    const titleTex = this.loadedTex.get('gameTitle');
    if (titleTex) {
      const mat = createPaperMaterial({ map: titleTex, cutout: true, color: 0xffffff });
      this.titleCard = new PaperCard(
        makeCardGeometry({ width: TITLE_W, height: TITLE_H, uv: [0, 0, 1, 1] }),
        mat,
      );
      this.titleCard.position.set(0, 3.2, STRIP_Z + 1.5);
      s.add(this.titleCard);
      this.cards.push(this.titleCard);
      this.disposables.push(this.titleCard.geometry, mat);
    } else {
      this.buildFallbackTitle(s);
    }
  }

  /** Procedural fallback: ink-ridge silhouette layers (original behavior). */
  private buildFallbackMenu(s: Scene): void {
    // Warm the background for fallback mode
    s.background = new Color(0xe8dcc2);
    s.fog = new Fog(0xe8dcc2, 16, 34);

    for (let i = 0; i < LAYERS; i++) {
      const fb = inkRidgeTexture(i + 1, LAYER_TONE[i]);
      this.disposables.push(fb);
      const mat = createPaperMaterial({ map: fb, color: 0xffffff });
      const card = new PaperCard(
        makeCardGeometry({ width: 44, height: LAYER_H[i], uv: [0, 0, 1, 1] }),
        mat,
      );
      card.position.set(NEWGAME_X / 2, 0, LAYER_Z[i]);
      card.castShadow = true;
      s.add(card);
      this.fallbackCards.push(card);
      this.cards.push(card);
      this.rig.add(card, LAYER_K[i]);
      this.disposables.push(card.geometry, mat);
    }
    this.buildFallbackTitle(s);
  }

  private buildFallbackTitle(s: Scene): void {
    const fb = titleTexture(t('menu.title'));
    this.disposables.push(fb);
    const mat = createPaperMaterial({ map: fb, color: 0xffffff });
    this.titleCard = new PaperCard(
      makeCardGeometry({ width: 1.1, height: 3.3, uv: [0, 0, 1, 1] }),
      mat,
    );
    this.titleCard.position.set(-2.6, 0.02, 1.5);
    s.add(this.titleCard);
    this.cards.push(this.titleCard);
    this.disposables.push(this.titleCard.geometry, mat);
  }

  /** Build splash overlay (logo + title on black, or procedural calligraphy). */
  private buildSplash(s: Scene): void {
    const logoTex = this.loadedTex.get('logo');
    const titleTex = this.loadedTex.get('gameTitle');

    this.splashGroup.renderOrder = 100;
    s.add(this.splashGroup);

    if (logoTex || titleTex) {
      // Original asset splash
      if (logoTex) {
        const mat = new MeshBasicMaterial({ map: logoTex, transparent: true, opacity: 0, depthTest: false });
        this.splashLogoMesh = makePlane(2.5, 2.5, mat);
        this.splashLogoMesh.renderOrder = 101;
        this.splashLogoMesh.position.set(0, 2.2, 12.5);
        this.splashGroup.add(this.splashLogoMesh);
        this.disposables.push(this.splashLogoMesh.geometry, mat);
      }
      if (titleTex) {
        const aspect = 3348 / 1458;
        const h = 1.4;
        const w = h * aspect;
        const mat = new MeshBasicMaterial({ map: titleTex, transparent: true, opacity: 0, depthTest: false });
        this.splashTitleMesh = makePlane(w, h, mat);
        this.splashTitleMesh.renderOrder = 102;
        this.splashTitleMesh.position.set(0, 2.2, 12.4);
        this.splashGroup.add(this.splashTitleMesh);
        this.disposables.push(this.splashTitleMesh.geometry, mat);
      }
    } else {
      // Procedural calligraphy splash: 四字逐字淡入
      const charTexes = splashCharTextures('太吾绘卷');
      const charSize = 1.2;
      const gap = 0.15;
      const totalW = charSize * 4 + gap * 3;
      const startX = -totalW / 2 + charSize / 2;
      this.splashCharMeshes = charTexes.map((tex, i) => {
        const mat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, fog: false });
        const mesh = makePlane(charSize, charSize, mat);
        mesh.renderOrder = 101 + i;
        mesh.position.set(startX + i * (charSize + gap), 0.3, 0);
        this.splashGroup.add(mesh);
        this.disposables.push(mesh.geometry, mat, tex);
        return mesh;
      });
      // 副标题
      const subTex = splashSubtitleTexture();
      const subMat = new MeshBasicMaterial({ map: subTex, transparent: true, opacity: 0, depthTest: false, fog: false });
      this.splashSubMesh = makePlane(2.4, 0.45, subMat);
      this.splashSubMesh.renderOrder = 105;
      this.splashSubMesh.position.set(0, -0.7, 0);
      this.splashGroup.add(this.splashSubMesh);
      this.disposables.push(this.splashSubMesh.geometry, subMat, subTex);
    }
  }

  // ---------------------------------------------------------------------------
  // IScene lifecycle
  // ---------------------------------------------------------------------------

  enter(_params: unknown, _from: Screen | null): void {
    this.build();
    this.id = ui.screen.peek() === 'newGame' ? 'newGame' : 'mainMenu';
    ui.menuReady.value = false;
    this.introDone = false;
    this.time = 0;
    this.splashTime = 0;
    this.phase = (this.splashLogoMesh || this.splashTitleMesh || this.splashCharMeshes.length > 0) ? 'splash' : 'menu';

    // 开场期间隐藏菜单背景元素
    if (this.phase === 'splash') {
      for (const c of this.fallbackCards) c.visible = false;
      for (const s of this.strips) s.group.visible = false;
      if (this.edgeTop) this.edgeTop.visible = false;
      if (this.edgeBottom) this.edgeBottom.visible = false;
      if (this.titleCard) this.titleCard.visible = false;
    }

    const reduced = ui.reducedMotion.peek();

    if (this.hasOriginalAssets) {
      // Reset strip positions for slide-in
      this.stripSlideY.x = STRIP_Y_OFF;
      this.stripSlideY.v = 0;
      this.titleFade.x = 0;
      this.titleFade.v = 0;
      for (const strip of this.strips) {
        for (const p of strip.textPanels) {
          (p.material as MeshBasicMaterial).opacity = 0;
        }
      }
      if (this.titleCard) {
        this.titleCard.hinge.theta = 0;
        this.titleCard.hinge.vel = 0;
        this.titleCard.state = HingeState.FLAT;
        this.titleCard.rise(0.6);
      }
    } else {
      // Fallback: hinge cards rise
      this.fallbackCards.forEach((c, i) => {
        if (c.state === HingeState.LOCKED) return;
        c.hinge.theta = 0; c.hinge.vel = 0; c.state = HingeState.FLAT;
        c.rise(Math.min(i, LAYERS) * 0.12);
      });
      if (this.titleCard) {
        this.titleCard.hinge.theta = 0;
        this.titleCard.state = HingeState.FLAT;
        this.titleCard.rise(LAYERS * 0.12 + 0.15);
      }
    }

    if (reduced) this.skipIntro();

    this.disposeEffect?.();
    this.disposeEffect = effect(() => {
      const h = ui.hover.value;
      const on = h?.type === 'menu' ? h.id : null;
      this.hoverTarget = on;
    });
  }

  private skipIntro(): void {
    this.phase = 'menu';
    this.splashGroup.visible = false;

    if (this.hasOriginalAssets) {
      this.stripSlideY.x = STRIP_Y;
      this.stripSlideY.v = 0;
      for (const strip of this.strips) {
        strip.group.position.y = STRIP_Y;
        for (const p of strip.textPanels) {
          (p.material as MeshBasicMaterial).opacity = 0.45;
        }
      }
      if (this.titleCard) {
        this.titleCard.hinge.theta = Math.PI / 2; this.titleCard.hinge.vel = 0;
        this.titleCard.state = HingeState.LOCKED; this.titleCard.update(0);
      }
      this.titleFade.x = 1;
    } else {
      for (const c of [...this.fallbackCards, this.titleCard!]) {
        c.hinge.theta = Math.PI / 2; c.hinge.vel = 0; c.state = HingeState.LOCKED; c.update(0);
      }
    }
    this.finishIntro();
  }

  private finishIntro(): void {
    if (!this.introDone) { this.introDone = true; ui.menuReady.value = true; }
  }

  onRetarget(to: Screen): void {
    this.id = to;
    this.mode = to === 'newGame' ? 'newGame' : 'menu';
  }

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  update(dt: number): void {
    this.time += dt;
    const reduced = ui.reducedMotion.peek();

    // -- Splash phase --
    if (this.phase === 'splash') {
      this.splashTime += dt;
      this.camera.position.set(0, 0, 10);
      this.camera.lookAt(0, 0, 0);
      this.scene.background = new Color(0x1a1510);
      this.updateSplash();
      return;
    }

    // Transition out of splash
    if (this.splashGroup.visible) {
      this.splashGroup.visible = false;
      if (!this.hasOriginalAssets) this.scene.background = new Color(0xe8dcc2);
      for (const c of this.fallbackCards) c.visible = true;
      for (const s of this.strips) s.group.visible = true;
      if (this.edgeTop) this.edgeTop.visible = true;
      if (this.edgeBottom) this.edgeBottom.visible = true;
      if (this.titleCard) this.titleCard.visible = true;
    }

    let moving = false;

    if (this.hasOriginalAssets) {
      this.updateOriginalMenu(dt, reduced);
      // Fade in text panels during slide-in
      for (const strip of this.strips) {
        for (const p of strip.textPanels) {
          const mat = p.material as MeshBasicMaterial;
          if (mat.opacity < 0.45) mat.opacity = Math.min(0.45, mat.opacity + dt * 0.5);
        }
      }
    } else {
      for (const c of this.fallbackCards) { c.update(dt); moving ||= c.moving; }
    }

    this.titleCard?.update(dt);
    moving ||= !!this.titleCard?.moving;

    if (!this.introDone && !moving && this.titleCard && this.titleCard.state === HingeState.LOCKED) {
      // For original assets: also wait for strip slide-in
      if (this.hasOriginalAssets) {
        if (Math.abs(this.stripSlideY.x - STRIP_Y) < 0.05) this.finishIntro();
      } else {
        this.finishIntro();
      }
    }

    // -- Camera --
    stepSpring(this.camX, this.mode === 'newGame' ? NEWGAME_X : 0, 6, dt);
    const px = reduced ? 0 : this.pointer.x, py = reduced ? 0 : this.pointer.y;
    stepSpring(this.look, px * 0.25, 4, dt);
    stepSpring(this.yaw, -px * 2 * Math.PI / 180, 4, dt);
    stepSpring(this.pitch, py * 1 * Math.PI / 180, 4, dt);
    const cx = this.camX.x + this.look.x;
    this.camera.position.set(cx, 2.2, 13);
    this.camera.lookAt(cx, 1.8, 0);
    this.camera.rotateY(this.yaw.x);
    this.camera.rotateX(this.pitch.x);
    if (!reduced) this.rig.update({ x: this.look.x });

    // -- Key light sway --
    if (this.key) {
      const kx = -6 + Math.sin(this.time * 0.15) * 5 + this.camX.x;
      this.key.position.set(kx, 9, 8);
      this.key.target.position.set(this.camX.x, 0, -4);
    }

    // -- Hover lights --
    const lowQ = ui.quality.peek() === 'low';
    for (const [id, h] of this.hoverLights) {
      stepSpring(h.v, !lowQ && this.hoverTarget === id && this.mode === 'menu' ? 6 : 0, 10, dt);
      h.light.intensity = Math.max(0, h.v.x);
      h.light.position.x = this.camX.x + 2.6;
    }
  }

  /** Update splash fade sequence. */
  private updateSplash(): void {
    const t = this.splashTime;

    if (this.splashCharMeshes.length > 0) {
      // Procedural: 逐字淡入，每字 0.6s 间隔，各字 0.8s 淡入
      const CHAR_DELAY = 0.6;
      const CHAR_FADE = 0.8;
      for (let i = 0; i < this.splashCharMeshes.length; i++) {
        const mat = this.splashCharMeshes[i].material as MeshBasicMaterial;
        const start = 0.3 + i * CHAR_DELAY;
        if (t < start) mat.opacity = 0;
        else mat.opacity = Math.min(1, (t - start) / CHAR_FADE);
      }
      // 副标题：最后一字开始淡入后 0.5s 开始
      if (this.splashSubMesh) {
        const subStart = 0.3 + (this.splashCharMeshes.length - 1) * CHAR_DELAY + 0.5;
        const mat = this.splashSubMesh.material as MeshBasicMaterial;
        if (t < subStart) mat.opacity = 0;
        else mat.opacity = Math.min(0.7, (t - subStart) / 0.6 * 0.7);
      }
      // 全部展示完毕后 1.2s 过渡到菜单
      const allDone = 0.3 + (this.splashCharMeshes.length - 1) * CHAR_DELAY + CHAR_FADE;
      if (t >= allDone + 1.2) this.phase = 'menu';
      return;
    }

    // Original asset splash: logo → title
    if (this.splashLogoMesh) {
      const mat = this.splashLogoMesh.material as MeshBasicMaterial;
      if (t < 1.0) {
        mat.opacity = t;
      } else if (t < SPLASH_LOGO_DUR - 0.5) {
        mat.opacity = 1;
      } else if (t < SPLASH_LOGO_DUR) {
        mat.opacity = 1 - (t - (SPLASH_LOGO_DUR - 0.5)) * 2;
      } else {
        mat.opacity = 0;
      }
    }

    if (this.splashTitleMesh) {
      const mat = this.splashTitleMesh.material as MeshBasicMaterial;
      const tStart = SPLASH_LOGO_DUR;
      if (t < tStart) {
        mat.opacity = 0;
      } else if (t < tStart + SPLASH_TITLE_DUR) {
        mat.opacity = (t - tStart) / SPLASH_TITLE_DUR;
      } else {
        mat.opacity = 1;
      }
    }

    const totalSplash = SPLASH_LOGO_DUR + SPLASH_TITLE_DUR + 0.5;
    if (t >= totalSplash) {
      this.phase = 'menu';
    }
  }

  /** Update original-asset menu: scroll pan, color pulse, edge bob, strip slide-in. */
  private updateOriginalMenu(dt: number, reduced: boolean): void {
    // -- Strip slide-in from above --
    stepSpring(this.stripSlideY, STRIP_Y, 4, dt);
    for (const strip of this.strips) {
      strip.group.position.y = this.stripSlideY.x;
    }

    // -- Infinite horizontal scroll --
    if (!reduced) {
      for (const strip of this.strips) {
        strip.group.position.x -= SCROLL_SPEED * dt;
        // Wrap when fully off-screen left
        if (strip.group.position.x < -STRIP_W) {
          strip.group.position.x += STRIP_W * 2;
        }
      }
    }

    // -- Color pulse on poem text panels --
    for (const strip of this.strips) {
      for (let i = 0; i < strip.textPanels.length; i++) {
        const panel = strip.textPanels[i];
        const delay = i * 1.0; // stagger by 1s
        const t = yoyo(this.time, PULSE_PERIOD, delay);
        const mat = panel.material as MeshBasicMaterial;
        mat.color.copy(PULSE_COLOR_A).lerp(PULSE_COLOR_B, t);
      }
    }

    // -- Edge wave bobbing --
    if (this.edgeTop) {
      const baseY = 5.5;
      this.edgeTop.position.y = baseY + Math.sin(this.time * EDGE_BOB_FREQ * Math.PI * 2) * EDGE_BOB_AMP;
    }
    if (this.edgeBottom) {
      const baseY = -1.8;
      this.edgeBottom.position.y = baseY + Math.sin(this.time * EDGE_BOB_FREQ * Math.PI * 2 + Math.PI) * EDGE_BOB_AMP;
    }

    // -- Title fade (paper material fade uniform) --
    stepSpring(this.titleFade, 1, 2, dt);
    if (this.titleCard) {
      const paper = this.titleCard.material.userData.paper;
      if (paper) {
        paper.uPaperFade.value = Math.max(0, 1 - this.titleFade.x);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // isIdle / resize / render
  // ---------------------------------------------------------------------------

  isIdle(): boolean {
    if (this.phase === 'splash') return false;
    if (this.cards.some((c) => c.moving) || this.titleCard?.moving) return false;
    const target = this.mode === 'newGame' ? NEWGAME_X : 0;
    // Scroll pan is continuous ambient animation; don't block idle for it
    return Math.abs(this.camX.x - target) < 1e-3 && Math.abs(this.look.v) < 1e-3 && Math.abs(this.yaw.v) < 1e-4;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  render(r: WebGLRenderer, target: WebGLRenderTarget | null): void {
    if (!r.shadowMap.enabled) { r.shadowMap.enabled = true; r.shadowMap.type = PCFSoftShadowMap; }
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  onPointer(e: ScenePointerEvent): void {
    if (e.type === 'move' || e.type === 'drag') { this.pointer.x = e.ndc.x; this.pointer.y = e.ndc.y; }
    if (e.type === 'leave') { this.pointer.x = 0; this.pointer.y = 0; }
    if ((e.type === 'down' || e.type === 'click') && !this.introDone) this.skipIntro();
  }

  onKey(e: KeyboardEvent): boolean {
    if (!this.introDone) { this.skipIntro(); return true; }
    void e; return false;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  exit(_to: Screen): void {
    this.disposeEffect?.();
    this.disposeEffect = null;
    ui.menuReady.value = false;
  }

  dispose(): void {
    this.disposeEffect?.();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.cards = [];
    this.fallbackCards = [];
    this.strips = [];
    this.edgeTop = null;
    this.edgeBottom = null;
    this.titleCard = null;
    this.splashLogoMesh = null;
    this.splashTitleMesh = null;
    this.splashCharMeshes = [];
    this.splashSubMesh = null;
    this.loadedTex.clear();
    this.rig.clear();
    this.scene.clear();
    this.built = false;
  }
}
