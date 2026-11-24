import {
  CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader,
  type Material, type Scene, type Texture,
} from 'three';
import { createPaperMaterial } from '../paper';

/** 设计分辨率（three 与 spine 两层共用的坐标系：像素，原点左下）。 */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;
/** 角色脚底所在高度（设计像素），也是镜头缩放的轴心高度。 */
export const GROUND_Y = 210;

export const BG_BASE = `${import.meta.env.BASE_URL}assets/spine/battle_backgrounds/battle_backgrounds/`;

/** 21 套战斗背景（原版 battleback_0..20）。 */
export const BG_SETS = [
  '山岭', '峡谷', '洞穴', '江河', '湖泊', '潭泽', '茅庐', '乡村', '镇集', '花海', '树林',
  '林野', '营寨', '庙宇', '古迹', '荒野', '废墟', '沙漠', '古墓', '绝壁', '深渊',
] as const;

/** 纸面地面色调：上沿偏亮，往下压暗；再混入一点本场景中景底边的颜色 */
const GROUND_PAPER_TOP = new Color('#e8dcc2');
const GROUND_PAPER_BOTTOM = new Color('#c9bc9a');
const GROUND_SCENE_MIX = 0.3;
/** 地面上沿（参差纸边）的高度 */
const GROUND_TOP = GROUND_Y + 200;
/** 地面往下一直铺到这里（镜头拉远时屏幕底部也要有地） */
const GROUND_BOTTOM = -520;
const GROUND_REPEAT = 3;

interface LayerCfg {
  key: 'b' | 'yuan' | 'zhong' | 'di' | 'qianL' | 'qianR';
  file: (dir: string) => string;
  /** 视差系数：0 不随镜头动，1 与角色/地面同步（平移与缩放都按这个系数） */
  parallax: number;
  /** 锚点：图底边放在 y；anchorX 0 = 左边对齐 x，0.5 居中，1 = 右边对齐 x */
  x: number; y: number; anchorX: number;
  scale: number;
  cutout: boolean;
  z: number;
}

const LAYERS: LayerCfg[] = [
  { key: 'b', file: (d) => `${d}/L0_b.png`, parallax: 0.02, x: DESIGN_W / 2, y: -110, anchorX: 0.5, scale: 1.05, cutout: false, z: -50 },
  { key: 'yuan', file: (d) => `${d}/L1_yuan.png`, parallax: 0.1, x: DESIGN_W / 2, y: 330, anchorX: 0.5, scale: 1.4, cutout: true, z: -40 },
  { key: 'zhong', file: (d) => `${d}/L2_zhong.png`, parallax: 0.3, x: DESIGN_W / 2, y: 290, anchorX: 0.5, scale: 1.3, cutout: true, z: -30 },
  { key: 'di', file: () => `_shared/di.png`, parallax: 1, x: DESIGN_W / 2, y: GROUND_BOTTOM, anchorX: 0.5, scale: 1, cutout: true, z: -20 },
  { key: 'qianL', file: (d) => `${d}/L3_qian_left.png`, parallax: 1, x: -60, y: -40, anchorX: 0, scale: 1, cutout: true, z: -10 },
  { key: 'qianR', file: (d) => `${d}/L3_qian_rhgit.png`, parallax: 1, x: DESIGN_W + 60, y: -40, anchorX: 1, scale: 1, cutout: true, z: -10 },
];

type Img = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

/** 中景图底边一带不透明像素的平均色（用来给地面染一点本场景的颜色） */
function bottomColor(img: Img): Color {
  const w = 64, h = 64;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  const px = ctx.getImageData(0, Math.floor(h * 0.88), w, h - Math.floor(h * 0.88)).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) continue;
    r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
  }
  return n ? new Color().setRGB(r / n / 255, g / n / 255, b / n / 255, SRGBColorSpace) : GROUND_PAPER_TOP.clone();
}

/** 共享地面图 di.png 是一条近白（#f2f2f2）的参差纸条，原版靠染色使用。这里乘一层纸色渐变。 */
function buildGroundTexture(di: Img, sceneColor: Color): CanvasTexture {
  const w = di.width, h = di.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(di as CanvasImageSource, 0, 0);
  const top = GROUND_PAPER_TOP.clone().lerp(sceneColor, GROUND_SCENE_MIX);
  const bottom = GROUND_PAPER_BOTTOM.clone().lerp(sceneColor, GROUND_SCENE_MIX * 0.7);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `#${top.getHexString(SRGBColorSpace)}`);
  grad.addColorStop(1, `#${bottom.getHexString(SRGBColorSpace)}`);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // multiply 会把透明处填上颜色，用原图 alpha 再裁一次，保留参差上沿
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(di as CanvasImageSource, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.repeat.x = GROUND_REPEAT;
  return tex;
}

/** 角色脚下的软影子（径向渐变贴图） */
function makeShadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.translate(64, 16);
  ctx.scale(1, 0.25);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 64);
  g.addColorStop(0, 'rgba(40,28,16,0.85)');
  g.addColorStop(0.6, 'rgba(40,28,16,0.45)');
  g.addColorStop(1, 'rgba(40,28,16,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-64, -64, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * 原版 5 层背景 + 共享地面条，PaperMaterial 纸纹。
 * 镜头平移 / 缩放按各层视差系数折算：远山几乎不动不缩，地面与角色完全同步。
 */
export class ParallaxBackground {
  readonly group = new Group();
  private layers: { mesh: Mesh; cfg: LayerCfg; baseX: number; baseY: number }[] = [];
  private shadows: Mesh[] = [];
  private loader = new TextureLoader();

  constructor(scene: Scene) {
    scene.add(this.group);
    const shadowTex = makeShadowTexture();
    for (let i = 0; i < 2; i++) {
      const m = new Mesh(
        new PlaneGeometry(240, 46),
        new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, depthTest: false }),
      );
      m.renderOrder = 10;
      m.position.z = -15;
      this.shadows.push(m);
      this.group.add(m);
    }
  }

  async load(setIndex: number): Promise<void> {
    const dir = `set_${String(setIndex).padStart(2, '0')}_${BG_SETS[setIndex]}`;
    const texes = await Promise.all(
      LAYERS.map((cfg) => this.loader.loadAsync(encodeURI(BG_BASE + cfg.file(dir))).catch(() => null)),
    );
    this.clear();
    const zhong = texes[LAYERS.findIndex((l) => l.key === 'zhong')];
    const sceneColor = zhong ? bottomColor(zhong.image as Img) : GROUND_PAPER_TOP.clone();

    LAYERS.forEach((cfg, i) => {
      let tex = texes[i] as Texture | null;
      if (!tex) return;
      tex.colorSpace = SRGBColorSpace;
      const img = tex.image as { width: number; height: number };
      let w = img.width * cfg.scale, h = img.height * cfg.scale;
      if (cfg.key === 'di') {
        const ground = buildGroundTexture(tex.image as Img, sceneColor);
        tex.dispose();
        tex = ground;
        w = img.width * GROUND_REPEAT;
        h = GROUND_TOP - GROUND_BOTTOM;
      }
      const mesh = new Mesh(
        new PlaneGeometry(w, h),
        createPaperMaterial({ map: tex, cutout: cfg.cutout, rim: false, doubleSided: false, fibre: cfg.key === 'di' ? 0.3 : 0.18 }),
      );
      const baseX = cfg.x + (0.5 - cfg.anchorX) * w;
      const baseY = cfg.y + h / 2;
      mesh.position.set(baseX, baseY, cfg.z);
      this.group.add(mesh);
      this.layers.push({ mesh, cfg, baseX, baseY });
    });
  }

  private clear() {
    for (const { mesh } of this.layers) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const m = mesh.material as Material & { map?: Texture | null };
      m.map?.dispose();
      m.dispose();
    }
    this.layers = [];
  }

  /**
   * camX：屏幕中心对应的世界 x；zoom：角色层缩放（>1 放大）。
   * 视差系数 p 的层：缩放 1 + (zoom - 1)·p，平移 (camX - 中心)·p，均以 (屏幕中心, GROUND_Y) 为轴心。
   */
  update(camX: number, zoom: number) {
    const cx = DESIGN_W / 2;
    for (const { mesh, cfg, baseX, baseY } of this.layers) {
      const p = cfg.parallax;
      const zl = 1 + (zoom - 1) * p;
      mesh.position.x = cx + (baseX - (camX - cx) * p - cx) * zl;
      mesh.position.y = GROUND_Y + (baseY - GROUND_Y) * zl;
      mesh.scale.setScalar(zl);
    }
  }

  /** 影子：worldX 为身体所在世界 x，height 为离地高度 */
  setShadow(i: number, camX: number, zoom: number, worldX: number, height: number) {
    const m = this.shadows[i];
    const lift = Math.min(1, Math.max(0, height) / 160);
    m.position.x = DESIGN_W / 2 + (worldX - camX) * zoom;
    m.position.y = GROUND_Y - 4 * zoom;
    m.scale.setScalar(zoom * (1 - 0.35 * lift));
    (m.material as MeshBasicMaterial).opacity = 0.55 * (1 - 0.6 * lift);
  }
}
