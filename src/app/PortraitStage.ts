import {
  DirectionalLight, Group, HemisphereLight, MeshLambertMaterial, OrthographicCamera, Scene, Vector4, WebGLRenderer,
} from 'three';
import { createPaperMaterial, makeCardGeometry, PaperCard } from '../render/paper';
import type { AssetCache } from './AssetCache';
import { ui } from './store';

export interface PortraitSubject {
  bodyArtKey: string; overlayArtKeys: string[];
  pose?: string;
}

/** 占位色：按 artKey 哈希取一组纸色，内容包贴图到位前可分辨。 */
function keyColor(key: string): number {
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const pal = [0xc9a777, 0x9c6b4e, 0x6f8a7a, 0xb85c4a, 0x7a6a9a, 0xd8c39a, 0x5d7590];
  return pal[Math.abs(h) % pal.length];
}

class Puppet {
  readonly root = new Group();
  body: PaperCard;
  overlays: PaperCard[] = [];
  private mats: MeshLambertMaterial[] = [];
  private t = Math.random() * 10;
  constructor(public subject: PortraitSubject, private assets: AssetCache | null) {
    this.body = this.card(subject.bodyArtKey, 1.0, 2.0, 0.5);
    this.root.add(this.body);
    this.setOverlays(subject.overlayArtKeys);
    this.body.rise(0);
  }
  private card(key: string, w: number, h: number, ax: number): PaperCard {
    const tex = this.assets?.peekTexture(key) ?? null;
    const mat = createPaperMaterial(tex ? { map: tex } : { color: keyColor(key), cutout: false });
    this.mats.push(mat);
    return new PaperCard(makeCardGeometry({ width: w, height: h, uv: [0, 0, 1, 1], anchorX: ax }), mat);
  }
  setOverlays(keys: string[]): void {
    for (const o of this.overlays) { this.body.remove(o); o.geometry.dispose(); }
    this.overlays = keys.map((k, i) => {
      const c = this.card(k, 0.45, 0.45, 0.5);
      // 锚点：沿身体竖向分布，略微前置
      c.position.set((i % 2 ? 0.28 : -0.28), 0.5 + 0.45 * Math.floor(i / 2), 0.02 + 0.005 * i);
      c.hinge.theta = Math.PI / 2; c.update(0);
      this.body.add(c);
      return c;
    });
  }
  flip(): void { this.body.hinge.vel -= 6; this.body.nudge(0); }
  update(dt: number): void {
    this.t += dt;
    this.body.update(dt);
    // 待机摆动：±1.5°，周期 3.2s
    this.root.rotation.z = Math.sin(this.t * (2 * Math.PI / 3.2)) * (1.5 * Math.PI / 180);
  }
  dispose(): void {
    this.body.geometry.dispose(); for (const o of this.overlays) o.geometry.dispose();
    for (const m of this.mats) m.dispose();
  }
}

interface Slot { el: HTMLElement; puppet: Puppet; scene: Scene; visible: boolean; io: IntersectionObserver }

/** 面板里的纸偶立绘：同一 renderer 的 scissor 视口。同屏最多 2 个。 */
export class PortraitStage {
  private slots: Slot[] = [];
  private cam = new OrthographicCamera(-0.9, 0.9, 2.3, -0.1, -10, 10);
  private _vp = new Vector4();

  constructor(private assets: AssetCache | null = null) { this.cam.position.set(0, 0, 5); }

  mount(slot: HTMLElement, subject: PortraitSubject): () => void {
    if (this.slots.length >= 2) this.unmount(this.slots[0]);
    const scene = new Scene();
    scene.add(new HemisphereLight(0xfff6e6, 0x5a4a38, 1.1));
    const key = new DirectionalLight(0xffffff, 1.6); key.position.set(-2, 3, 4); scene.add(key);
    const puppet = new Puppet(subject, this.assets);
    scene.add(puppet.root);
    const s: Slot = { el: slot, puppet, scene, visible: true, io: null! };
    s.io = new IntersectionObserver((es) => { for (const e of es) s.visible = e.isIntersecting; });
    s.io.observe(slot);
    this.slots.push(s);
    return () => this.unmount(s);
  }

  /** 表单联动：更新主体（overlay 变了换挂件，pose 变了翻牌）。 */
  setSubject(slot: HTMLElement, subject: PortraitSubject): void {
    const s = this.slots.find((x) => x.el === slot); if (!s) return;
    const prev = s.puppet.subject;
    if (prev.overlayArtKeys.join('|') !== subject.overlayArtKeys.join('|')) s.puppet.setOverlays(subject.overlayArtKeys);
    if (prev.pose !== subject.pose || prev.bodyArtKey !== subject.bodyArtKey) s.puppet.flip();
    s.puppet.subject = subject;
  }

  private unmount(s: Slot): void {
    const i = this.slots.indexOf(s); if (i < 0) return;
    this.slots.splice(i, 1); s.io.disconnect(); s.puppet.dispose();
  }

  get active(): boolean { return this.slots.length > 0; }

  update(dt: number): void { for (const s of this.slots) s.puppet.update(dt); }

  render(r: WebGLRenderer): void {
    if (!this.slots.length) return;
    const cr = r.domElement.getBoundingClientRect();
    const modalOpen = ui.modalStack.peek().length > 0;
    const prevVp = r.getViewport(this._vp).clone(), prevAuto = r.autoClear;   // CSS 像素
    r.setRenderTarget(null);
    r.autoClear = false;
    for (const s of this.slots) {
      if (!s.visible || !s.el.isConnected) continue;
      if (modalOpen && !s.el.closest('#modals')) continue;   // 被遮罩盖住
      const b = s.el.getBoundingClientRect();                  // 含 CSS transform
      if (b.width < 2 || b.height < 2) continue;
      // three 的 setViewport / setScissor 接 CSS 像素，内部乘 pixelRatio；y 轴翻转
      const x = b.left - cr.left, y = cr.height - (b.bottom - cr.top), w = b.width, h = b.height;
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);
      r.setScissorTest(true);
      const aspect = w / h, halfH = 1.2;
      this.cam.left = -halfH * aspect; this.cam.right = halfH * aspect; this.cam.top = 2.3; this.cam.bottom = 2.3 - 2 * halfH;
      this.cam.updateProjectionMatrix();
      r.clearDepth();
      r.render(s.scene, this.cam);
    }
    r.setScissorTest(false);
    r.setViewport(prevVp);
    r.autoClear = prevAuto;
  }

  dispose(): void { for (const s of [...this.slots]) this.unmount(s); }
}
