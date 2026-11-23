import { CanvasTexture, CylinderGeometry, Group, Mesh, SRGBColorSpace, Texture, Vector3 } from 'three';
import { createPaperMaterial, HingeState, makeCardGeometry, PaperCard } from '../../render/paper';
import { getCoreMaterial, LAYER_DECOR } from './ProvincePiece';

let placeholder: Texture | null = null;
/** 占位牌：一枚墨色人形剪影（无文字）。 */
function placeholderTexture(): Texture {
  if (placeholder) return placeholder;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  g.filter = 'blur(1px)';
  g.fillStyle = '#3b2f28';
  g.beginPath(); g.arc(64, 52, 26, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(22, 250); g.quadraticCurveTo(30, 96, 64, 88); g.quadraticCurveTo(98, 96, 106, 250); g.fill();
  g.fillStyle = '#a2402f'; g.fillRect(30, 150, 68, 14);
  placeholder = new CanvasTexture(c); placeholder.colorSpace = SRGBColorSpace;
  return placeholder;
}

export interface HopJob { from: Vector3; to: Vector3; dur: number; arc: number; t: number; done: () => void }

/** 跳跃时间表：返回 [位置插值 s, 垂直偏移系数, scaleY]。工单 §8.1。 */
export function hopShape(u: number, arc: number): { s: number; y: number; sy: number } {
  if (u < 0.15) { const k = u / 0.15; return { s: 0, y: 0, sy: 1 - 0.14 * k }; }
  if (u < 0.85) {
    const s = (u - 0.15) / 0.7;
    const sy = s < 0.5 ? 0.86 + (1.08 - 0.86) * (s / 0.5) : 1.08 - 0.08 * ((s - 0.5) / 0.5);
    return { s, y: 4 * arc * s * (1 - s), sy };
  }
  const k = (u - 0.85) / 0.15;
  return { s: 1, y: 0, sy: 0.82 + 0.18 * k };
}

/** 棋子：一张立正的 PaperCard + 底座圆片。 */
export class Token extends Group {
  readonly card: PaperCard;
  readonly base: Mesh;
  private job: HopJob | null = null;
  private facing = 1;
  private flip = { x: 1 };

  constructor(map: Texture | null, readonly heightM: number) {
    super();
    const w = heightM * 0.5;
    const mat = createPaperMaterial({ map: map ?? placeholderTexture() });
    this.card = new PaperCard(makeCardGeometry({ width: w, height: heightM, uv: [0, 0, 1, 1] }), mat);
    this.card.rise(0);
    this.card.hinge.theta = Math.PI / 2; this.card.state = HingeState.LOCKED; this.card.update(0);
    this.card.castShadow = true;
    this.base = new Mesh(new CylinderGeometry(w * 0.55, w * 0.6, heightM * 0.04, 24), getCoreMaterial());
    this.base.position.y = heightM * 0.02; this.base.castShadow = this.base.receiveShadow = true;
    this.card.position.y = heightM * 0.04;
    this.card.layers.set(LAYER_DECOR); this.base.layers.set(LAYER_DECOR);
    this.add(this.base, this.card);
  }

  placeAt(p: Vector3): void {
    if (this.job) { const j = this.job; this.job = null; j.done(); }
    this.position.copy(p);
  }

  hopTo(p: Vector3, durMs: number, arc: number): Promise<void> {
    if (this.job) { const j = this.job; this.job = null; this.position.copy(j.to); j.done(); }
    const dx = p.x - this.position.x;
    if (Math.abs(dx) > 1e-4) this.setFacing(dx > 0 ? 1 : -1);
    return new Promise((done) => { this.job = { from: this.position.clone(), to: p.clone(), dur: durMs / 1000, arc, t: 0, done }; });
  }

  get hopping(): boolean { return this.job !== null; }

  setFacing(sign: 1 | -1): void { this.facing = sign; }

  update(dt: number): void {
    // 翻面 120ms
    const k = Math.min(1, dt / 0.12) * 2;
    this.flip.x += Math.sign(this.facing - this.flip.x) * Math.min(Math.abs(this.facing - this.flip.x), k);
    let sy = 1;
    const j = this.job;
    if (j) {
      j.t += dt;
      const u = Math.min(1, j.t / j.dur);
      const h = hopShape(u, j.arc);
      this.position.lerpVectors(j.from, j.to, h.s);
      this.position.y += h.y;
      sy = h.sy;
      if (u >= 1) { this.position.copy(j.to); this.job = null; this.card.nudge(-1.5); j.done(); sy = 1; }
    }
    this.card.scale.set(this.flip.x * (1 / Math.sqrt(sy)), sy, 1);
    this.card.update(dt);
  }

  dispose(): void { this.card.geometry.dispose(); this.card.material.dispose(); this.base.geometry.dispose(); }
}
