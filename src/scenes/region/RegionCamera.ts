import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

/** 俯视 53°、拖拽平移、三档缩放、跟随目标。 */
export const PITCH = 53 * Math.PI / 180;
export const ZOOM_DIST = [8, 14, 24] as const;

export class RegionCamera {
  readonly camera = new PerspectiveCamera(35, 1, 0.1, 200);
  readonly target = new Vector3();
  private goal = new Vector3();
  zoomLevel = 1;
  dist: number = ZOOM_DIST[1];
  follow: Vector3 | null = null;
  private bounds = { x0: 0, z0: 0, x1: 1, z1: 1 };
  private ray = new Raycaster();
  private plane = new Plane(new Vector3(0, 1, 0), 0);

  setBounds(x0: number, z0: number, x1: number, z1: number): void { this.bounds = { x0, z0, x1, z1 }; }

  resize(w: number, h: number): void { this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }

  /** 瞬间对准（进场 / 转场）。 */
  snap(p: Vector3, dist?: number): void {
    this.goal.copy(p); this.target.copy(p); if (dist !== undefined) this.dist = dist; this.apply();
  }

  setZoom(level: number): void { this.zoomLevel = MathUtils.clamp(level, 0, ZOOM_DIST.length - 1); }

  /** 屏幕像素位移 → 地面平移（按当前距离换算）。 */
  pan(dxPx: number, dyPx: number, viewH: number): void {
    const worldPerPx = 2 * this.dist * Math.tan(MathUtils.degToRad(this.camera.fov / 2)) / viewH;
    this.follow = null;
    this.goal.x -= dxPx * worldPerPx;
    this.goal.z -= dyPx * worldPerPx / Math.sin(PITCH);
    this.clampGoal();
    this.target.copy(this.goal);
  }

  update(dt: number): void {
    if (this.follow) { this.goal.set(this.follow.x, 0, this.follow.z); this.clampGoal(); }
    const k = 1 - Math.exp(-dt * 8);
    this.target.lerp(this.goal, k);
    this.dist += (ZOOM_DIST[this.zoomLevel] - this.dist) * (1 - Math.exp(-dt * 7));
    this.apply();
  }

  /** NDC → 地面交点（无交点返回 null）。 */
  groundAt(ndc: Vector2, out = new Vector3()): Vector3 | null {
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  private clampGoal(): void {
    const b = this.bounds;
    this.goal.x = MathUtils.clamp(this.goal.x, b.x0, b.x1);
    this.goal.z = MathUtils.clamp(this.goal.z, b.z0, b.z1);
  }

  private apply(): void {
    const c = this.camera;
    c.position.set(this.target.x, this.target.y + this.dist * Math.sin(PITCH), this.target.z + this.dist * Math.cos(PITCH));
    c.lookAt(this.target);
  }
}
