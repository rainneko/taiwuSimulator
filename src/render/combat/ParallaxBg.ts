import { Group, Mesh, PlaneGeometry, SRGBColorSpace, TextureLoader, type Scene, type Texture } from 'three';
import { createPaperMaterial } from '../paper';

/** 设计分辨率（three 与 spine 两层共用的坐标系：像素，原点左下）。 */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;
/** 角色脚底所在高度（设计像素）。 */
export const GROUND_Y = 210;

export const BG_BASE = `${import.meta.env.BASE_URL}assets/spine/battle_backgrounds/battle_backgrounds/`;

/** 21 套战斗背景（原版 battleback_0..20）。 */
export const BG_SETS = [
  '山岭', '峡谷', '洞穴', '江河', '湖泊', '潭泽', '茅庐', '乡村', '镇集', '花海', '树林',
  '林野', '营寨', '庙宇', '古迹', '荒野', '废墟', '沙漠', '古墓', '绝壁', '深渊',
] as const;

interface LayerCfg {
  file: (dir: string) => string;
  /** 视差系数：0 不动，1 与地面同速 */
  parallax: number;
  /** 锚点：图底边中心放在 (x, y)；anchorX 0 = 左对齐, 0.5 居中, 1 = 右对齐 */
  x: number; y: number; anchorX: number;
  scale: number;
  cutout: boolean;
  z: number;
}

const LAYERS: LayerCfg[] = [
  { file: (d) => `${d}/L0_b.png`, parallax: 0.02, x: DESIGN_W / 2, y: -110, anchorX: 0.5, scale: 1, cutout: false, z: -50 },
  { file: (d) => `${d}/L1_yuan.png`, parallax: 0.1, x: DESIGN_W / 2, y: 330, anchorX: 0.5, scale: 1.25, cutout: true, z: -40 },
  { file: (d) => `${d}/L2_zhong.png`, parallax: 0.3, x: DESIGN_W / 2, y: 290, anchorX: 0.5, scale: 1.1, cutout: true, z: -30 },
  { file: () => `_shared/di.png`, parallax: 0.6, x: DESIGN_W / 2, y: 0, anchorX: 0.5, scale: 1, cutout: true, z: -20 },
  { file: (d) => `${d}/L3_qian_left.png`, parallax: 0.9, x: -40, y: 0, anchorX: 0, scale: 1, cutout: true, z: -10 },
  { file: (d) => `${d}/L3_qian_rhgit.png`, parallax: 0.9, x: DESIGN_W + 40, y: 0, anchorX: 1, scale: 1, cutout: true, z: -10 },
];

/** 原版 5 层背景 + 共享地面条，PaperMaterial 纸纹，各层按视差系数跟随镜头。 */
export class ParallaxBackground {
  readonly group = new Group();
  private layers: { mesh: Mesh; cfg: LayerCfg; baseX: number }[] = [];
  private loader = new TextureLoader();

  constructor(scene: Scene) {
    scene.add(this.group);
  }

  async load(setIndex: number): Promise<void> {
    const dir = `set_${String(setIndex).padStart(2, '0')}_${BG_SETS[setIndex]}`;
    const texes = await Promise.all(
      LAYERS.map((cfg) => this.loader.loadAsync(encodeURI(BG_BASE + cfg.file(dir))).catch(() => null)),
    );
    this.clear();
    LAYERS.forEach((cfg, i) => {
      const tex = texes[i] as Texture | null;
      if (!tex) return;
      tex.colorSpace = SRGBColorSpace;
      const img = tex.image as { width: number; height: number };
      const w = img.width * cfg.scale, h = img.height * cfg.scale;
      const mesh = new Mesh(
        new PlaneGeometry(w, h),
        createPaperMaterial({ map: tex, cutout: cfg.cutout, rim: false, doubleSided: false, fibre: 0.18 }),
      );
      const baseX = cfg.x + (0.5 - cfg.anchorX) * w;
      mesh.position.set(baseX, cfg.y + h / 2, cfg.z);
      this.group.add(mesh);
      this.layers.push({ mesh, cfg, baseX });
    });
  }

  private clear() {
    for (const { mesh } of this.layers) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const m = mesh.material as { map?: Texture | null; dispose(): void };
      m.map?.dispose();
      m.dispose();
    }
    this.layers = [];
  }

  /** cameraX：镜头相对场地中心的偏移（设计像素）。 */
  update(cameraX: number) {
    for (const { mesh, cfg, baseX } of this.layers) mesh.position.x = baseX - cameraX * cfg.parallax;
  }
}
