import { Box2, Box3, MathUtils, PerspectiveCamera, Plane, Ray, Vector2, Vector3 } from 'three';
import type { ScenePointerEvent } from '../../app/InputRouter';
import { stepSpring } from '../../render/paper/hinge';

export interface MapPanRigOptions {
  fov: number; pitchDeg: number;
  bounds: Box2;                          // 注视点 (x, z) 允许的范围
  distRange: [near: number, far: number];
  zoomSteps?: number;                    // 给定则吸附到档位
}

const OMEGA = 14, INERTIA = 6, WHEEL_K = 0.12;
const GROUND = new Plane(new Vector3(0, 1, 0), 0);
const _ray = new Ray(), _v = new Vector3(), _v2 = new Vector3();

/** 拖拽平移 + 以指针为锚缩放；注视点 (x, z) + 距离三个临界阻尼弹簧。工单 M3-WO2 §9.1。 */
export class MapPanRig {
  readonly camera: PerspectiveCamera;
  private goal = { x: 0, z: 0, d: 10 };
  private sx = { x: 0, v: 0 }; private sz = { x: 0, v: 0 }; private sd = { x: 10, v: 0 };
  private dragging = false;
  private grab: Vector3 | null = null;
  private vel = new Vector2();           // 惯性（世界单位 / 秒）
  private lastDrag = 0;
  private step = 0;
  private dir = new Vector3();           // 注视点 → 相机 的单位向量
  /** 由外部覆盖的相机（dive 时）。 */
  override: ((cam: PerspectiveCamera) => void) | null = null;

  constructor(private opts: MapPanRigOptions) {
    this.camera = new PerspectiveCamera(opts.fov, 1, 0.1, 400);
    const p = MathUtils.degToRad(opts.pitchDeg);
    this.dir.set(0, Math.sin(p), Math.cos(p));
    const c = opts.bounds.getCenter(new Vector2());
    this.goal = { x: c.x, z: c.y, d: opts.distRange[1] };
    if (opts.zoomSteps) this.step = 0;
    this.snap();
  }

  setBounds(b: Box2): void { this.opts.bounds = b.clone(); }

  get zoom(): number {
    const [n, f] = this.opts.distRange;
    return MathUtils.clamp((f - this.sd.x) / (f - n), 0, 1);
  }
  get target(): Vector3 { return new Vector3(this.sx.x, 0, this.sz.x); }
  get goalTarget(): Vector3 { return new Vector3(this.goal.x, 0, this.goal.z); }
  get goalDist(): number { return this.goal.d; }

  snap(): void {
    this.sx.x = this.goal.x; this.sz.x = this.goal.z; this.sd.x = this.goal.d;
    this.sx.v = this.sz.v = this.sd.v = 0;
    this.apply();
  }

  set(x: number, z: number, d?: number, immediate = false): void {
    this.goal.x = x; this.goal.z = z; if (d !== undefined) this.goal.d = MathUtils.clamp(d, ...this.opts.distRange);
    this.vel.set(0, 0);
    if (immediate) this.snap();
  }

  /** 屏幕 ndc → 地面点（用给定的注视点与距离，便于以目标状态计算）。 */
  groundAt(ndc: Vector2, out = new Vector3(), state?: { x: number; z: number; d: number }): Vector3 | null {
    const cam = this.camera;
    if (state) { this.place(cam, state.x, state.z, state.d); cam.updateMatrixWorld(true); }
    _ray.origin.setFromMatrixPosition(cam.matrixWorld);
    _ray.direction.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(_ray.origin).normalize();
    const hit = _ray.intersectPlane(GROUND, out);
    if (state) this.apply();
    return hit;
  }

  private place(cam: PerspectiveCamera, x: number, z: number, d: number): void {
    cam.position.set(x + this.dir.x * d, this.dir.y * d, z + this.dir.z * d);
    cam.lookAt(x, 0, z);
    cam.updateMatrixWorld(true);
  }
  private apply(): void {
    this.place(this.camera, this.sx.x, this.sz.x, this.sd.x);
    this.override?.(this.camera);
  }

  resize(w: number, h: number): void { this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); this.apply(); }

  /** 返回是否消费了事件。 */
  onPointer(e: ScenePointerEvent): boolean {
    switch (e.type) {
      case 'down':
        this.vel.set(0, 0);
        this.grab = this.groundAt(e.ndc, new Vector3(), this.goal);
        return false;
      case 'drag': {
        if (!this.grab) this.grab = this.groundAt(e.ndc, new Vector3(), this.goal);
        if (!this.grab) return true;
        this.dragging = true;
        const now = this.groundAt(e.ndc, _v, this.goal);
        if (!now) return true;
        const dx = this.grab.x - now.x, dz = this.grab.z - now.z;
        this.goal.x += dx; this.goal.z += dz;
        // 跟手：直接带着弹簧走
        this.sx.x += dx; this.sz.x += dz;
        const t = performance.now(), dt = Math.max(1, t - this.lastDrag) / 1000;
        if (t - this.lastDrag < 100) this.vel.lerp(new Vector2(dx / dt, dz / dt), 0.5); else this.vel.set(dx / dt, dz / dt);
        this.lastDrag = t;
        return true;
      }
      case 'up': {
        const wasDragging = this.dragging;
        this.dragging = false; this.grab = null;
        if (performance.now() - this.lastDrag > 80) this.vel.set(0, 0);
        return wasDragging;
      }
      case 'wheel': this.zoomAt(e.ndc, (e.delta?.[1] ?? 0)); return true;
      case 'pinch': this.zoomAt(e.ndc, -Math.log(e.delta?.[0] ?? 1) / WHEEL_K / 1.2); return true;
      default: return false;
    }
  }

  get isDragging(): boolean { return this.dragging; }

  /** steps > 0 拉远，< 0 拉近；以 ndc 下的地面点为锚。 */
  zoomAt(ndc: Vector2, steps: number): void {
    const before = this.groundAt(ndc, _v2.set(0, 0, 0), this.goal);
    const [n, f] = this.opts.distRange;
    let d: number;
    if (this.opts.zoomSteps) {
      this.step = MathUtils.clamp(this.step + Math.sign(steps), 0, this.opts.zoomSteps - 1);
      d = f + (n - f) * (this.step / (this.opts.zoomSteps - 1));
    } else d = MathUtils.clamp(this.goal.d * Math.exp(steps * WHEEL_K), n, f);
    if (!before) { this.goal.d = d; return; }
    const k = d / this.goal.d;
    this.goal.x = before.x + (this.goal.x - before.x) * k;
    this.goal.z = before.z + (this.goal.z - before.z) * k;
    this.goal.d = d;
  }
  zoomBy(steps: number): void { this.zoomAt(new Vector2(0, 0), steps); }

  focusOn(target: Vector2, opts: { screenOffset?: [number, number]; zoom?: number } = {}): void {
    if (opts.zoom !== undefined) { const [n, f] = this.opts.distRange; this.goal.d = f + (n - f) * opts.zoom; }
    this.goal.x = target.x; this.goal.z = target.y;
    if (opts.screenOffset) {
      // 把 target 放到 ndc = -offset 处：算出该 ndc 处的地面点与中心地面点之差
      const c = this.groundAt(new Vector2(0, 0), new Vector3(), this.goal);
      const o = this.groundAt(new Vector2(-opts.screenOffset[0], -opts.screenOffset[1]), new Vector3(), this.goal);
      if (c && o) { this.goal.x += c.x - o.x; this.goal.z += c.z - o.z; }
    }
    this.vel.set(0, 0);
  }

  /** 使 box 在画面高度里占 fill。 */
  frame(box: Box3, fill: number): void {
    const c = box.getCenter(new Vector3()), s = box.getSize(new Vector3());
    const span = Math.max(s.z * this.dir.y + s.y * this.dir.z, s.x / this.camera.aspect);
    const d = span / fill / (2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2));
    this.goal.x = c.x; this.goal.z = c.z; this.goal.d = MathUtils.clamp(d, ...this.opts.distRange);
  }
  distForBox(box: Box3, fill: number): number {
    const s = box.getSize(new Vector3());
    const span = Math.max(s.z * this.dir.y + s.y * this.dir.z, s.x / this.camera.aspect);
    return span / fill / (2 * Math.tan(MathUtils.degToRad(this.camera.fov) / 2));
  }

  update(dt: number): void {
    if (!this.dragging) {
      if (this.vel.lengthSq() > 1e-6) {
        this.goal.x += this.vel.x * dt; this.goal.z += this.vel.y * dt;
        this.vel.multiplyScalar(Math.exp(-INERTIA * dt));
      } else this.vel.set(0, 0);
      // 越界：拉回（弹簧力）
      const b = this.opts.bounds;
      const cx = MathUtils.clamp(this.goal.x, b.min.x, b.max.x), cz = MathUtils.clamp(this.goal.z, b.min.y, b.max.y);
      if (cx !== this.goal.x || cz !== this.goal.z) {
        const k = 1 - Math.exp(-10 * dt);
        this.goal.x += (cx - this.goal.x) * k; this.goal.z += (cz - this.goal.z) * k;
        if (Math.abs(cx - this.goal.x) < 1e-4) this.goal.x = cx;
        if (Math.abs(cz - this.goal.z) < 1e-4) this.goal.z = cz;
        this.vel.multiplyScalar(0.5);
      }
    }
    stepSpring(this.sx, this.goal.x, OMEGA, dt);
    stepSpring(this.sz, this.goal.z, OMEGA, dt);
    stepSpring(this.sd, this.goal.d, OMEGA, dt);
    this.apply();
  }

  isSettled(): boolean {
    return !this.dragging && this.vel.lengthSq() < 1e-6
      && Math.abs(this.sx.x - this.goal.x) < 1e-4 && Math.abs(this.sz.x - this.goal.z) < 1e-4 && Math.abs(this.sd.x - this.goal.d) < 1e-4
      && Math.abs(this.sx.v) + Math.abs(this.sz.v) + Math.abs(this.sd.v) < 1e-3;
  }
}
