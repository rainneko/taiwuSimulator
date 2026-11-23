import { Color, DynamicDrawUsage, InstancedMesh, Object3D, PlaneGeometry, QuadraticBezierCurve3, Vector3 } from 'three';
import { createPaperMaterial } from '../../render/paper';
import { LAYER_DECOR } from './ProvincePiece';

export type RouteState = 'open' | 'closed' | 'active' | 'hidden';
const SEG_LEN = 0.09, SEG_W = 0.03, SEG_GAP = 0.05, MAX_SEG = 40;
const COL: Record<RouteState, Color> = {
  open: new Color('#f6efdf'), closed: new Color('#8d877c'), active: new Color('#b8432f'), hidden: new Color('#000'),
};

interface Route { id: string; curve: QuadraticBezierCurve3; offset: number; count: number; state: RouteState; progress: number; pop: number[] }

/** 所有驿路共用一个 InstancedMesh：沿二次贝塞尔等距排布的小纸条。工单 §8.2。 */
export class TravelLine {
  readonly mesh: InstancedMesh;
  private routes = new Map<string, Route>();
  private used = 0;
  private dummy = new Object3D();
  private dirty = true;

  constructor(capacityRoutes: number) {
    const geo = new PlaneGeometry(SEG_LEN, SEG_W).rotateX(-Math.PI / 2);
    const mat = createPaperMaterial({ color: 0xffffff, cutout: false, doubleSided: true, fibre: 0.2 });
    this.mesh = new InstancedMesh(geo, mat, capacityRoutes * MAX_SEG);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_DECOR);
    this.mesh.count = 0;
  }

  static curve(a: Vector3, b: Vector3, ctrl?: Vector3): QuadraticBezierCurve3 {
    let c = ctrl;
    if (!c) {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a); const len = d.length();
      const perp = new Vector3(-d.z, 0, d.x).normalize().multiplyScalar(len * 0.12);
      c = mid.add(perp); c.y = Math.max(a.y, b.y) + 0.06;
    }
    return new QuadraticBezierCurve3(a.clone(), c, b.clone());
  }

  add(id: string, curve: QuadraticBezierCurve3, state: RouteState): void {
    const n = Math.min(MAX_SEG, Math.max(2, Math.floor(curve.getLength() / (SEG_LEN + SEG_GAP))));
    this.routes.set(id, { id, curve, offset: this.used, count: n, state, progress: 1, pop: new Array(n).fill(1) });
    this.used += n; this.mesh.count = this.used; this.dirty = true;
  }

  has(id: string): boolean { return this.routes.has(id); }
  setState(id: string, s: RouteState): void { const r = this.routes.get(id); if (r && r.state !== s) { r.state = s; this.dirty = true; } }
  setProgress(id: string, t: number): void {
    const r = this.routes.get(id); if (!r) return;
    const prevShown = Math.floor(r.progress * r.count + 1e-6), shown = Math.floor(t * r.count + 1e-6);
    for (let i = prevShown; i < shown; i++) r.pop[i] = 0;
    for (let i = shown; i < r.count; i++) r.pop[i] = 1;
    r.progress = t; this.dirty = true;
  }

  update(dt: number): boolean {
    let animating = false;
    for (const r of this.routes.values()) for (let i = 0; i < r.count; i++) {
      if (r.pop[i] < 1) { r.pop[i] = Math.min(1, r.pop[i] + dt / 0.08); animating = true; this.dirty = true; }
    }
    if (!this.dirty) return false;
    this.dirty = false;
    const p = new Vector3(), tan = new Vector3();
    for (const r of this.routes.values()) {
      const shown = Math.floor(r.progress * r.count + 1e-6);
      for (let i = 0; i < r.count; i++) {
        const t = (i + 0.5) / r.count;
        r.curve.getPoint(t, p); r.curve.getTangent(t, tan);
        const vis = r.state !== 'hidden' && i < shown;
        const k = vis ? 0.6 + 0.4 * r.pop[i] : 0;
        this.dummy.position.copy(p);
        this.dummy.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
        this.dummy.scale.setScalar(Math.max(k, 1e-5));
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(r.offset + i, this.dummy.matrix);
        this.mesh.setColorAt(r.offset + i, COL[r.state]);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return animating;
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as { dispose(): void }).dispose(); }
}
