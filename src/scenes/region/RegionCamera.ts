import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

/** 俯视 53°、竖直 FOV 27°（WO3 v1.2，与城镇、大地图俯冲衔接）。 */
export const PITCH = 53 * Math.PI / 180;
export const FOV = 27;
/** 三档：近 3 格、中 6 格（注视点那一行的横向可见格数），远 = 整张地区。 */
export const NEAR_CELLS = 3, MID_CELLS = 6;
/** 远档横向格数 ≈ 1.53·N（15×15 约 23 格）。 */
export const FAR_FACTOR = 1.53;
const MID_DEADZONE = 1, MID_EDGE = 1.5;

export enum Zoom { Near = 0, Mid = 1, Far = 2 }

/** 横向可见 cells 格所需的镜头距离（单位：格 = 1m）。 */
export function distForCells(cells: number, aspect: number, fovDeg = FOV): number {
  const hfov = 2 * Math.atan(Math.tan(MathUtils.degToRad(fovDeg / 2)) * aspect);
  return (cells / 2) / Math.tan(hfov / 2);
}

export class RegionCamera {
  readonly camera = new PerspectiveCamera(FOV, 16 / 9, 0.1, 200);
  readonly target = new Vector3();
  private goal = new Vector3();
  zoomLevel: Zoom = Zoom.Near;
  dist = 3.5;
  follow: Vector3 | null = null;
  private n = 1;
  private ray = new Raycaster();
  private plane = new Plane(new Vector3(0, 1, 0), 0);

  setRegionSize(n: number): void { this.n = n; }

  resize(w: number, h: number): void { this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }

  cellsFor(level: Zoom): number {
    return level === Zoom.Near ? NEAR_CELLS : level === Zoom.Mid ? MID_CELLS : this.n * FAR_FACTOR;
  }
  distFor(level: Zoom): number {
    const d = distForCells(this.cellsFor(level), this.camera.aspect);
    if (level !== Zoom.Far) return d;
    // 远档还要纵向装下整张图（窄屏时由纵向决定）：地面纵深 ≈ 2·d·tan(vfov/2) / sin(俯角)
    const depth = this.n + 4;
    return Math.max(d, depth * Math.sin(PITCH) / (2 * Math.tan(MathUtils.degToRad(FOV / 2))));
  }

  snap(p: Vector3, dist?: number): void {
    this.goal.copy(p); this.target.copy(p); this.dist = dist ?? this.distFor(this.zoomLevel); this.apply();
  }

  setZoom(level: number): void { this.zoomLevel = MathUtils.clamp(Math.round(level), 0, 2) as Zoom; }

  /** 屏幕像素位移 → 地面平移。远档不平移。 */
  pan(dxPx: number, dyPx: number, viewH: number): void {
    if (this.zoomLevel === Zoom.Far) return;
    const worldPerPx = 2 * this.dist * Math.tan(MathUtils.degToRad(this.camera.fov / 2)) / viewH;
    this.follow = null;
    this.goal.x -= dxPx * worldPerPx;
    this.goal.z -= dyPx * worldPerPx / Math.sin(PITCH);
    this.clampGoal();
    this.target.copy(this.goal);
  }

  update(dt: number): void {
    const n = this.n;
    if (this.zoomLevel === Zoom.Far) this.goal.set(n / 2, 0, n / 2);
    else if (this.follow) {
      if (this.zoomLevel === Zoom.Near) this.goal.set(this.follow.x, 0, this.follow.z);   // 无死区：3×3 始终以棋子为中心
      else {
        const dx = this.follow.x - this.goal.x, dz = this.follow.z - this.goal.z;
        if (Math.abs(dx) > MID_DEADZONE) this.goal.x += dx - Math.sign(dx) * MID_DEADZONE;
        if (Math.abs(dz) > MID_DEADZONE) this.goal.z += dz - Math.sign(dz) * MID_DEADZONE;
      }
    }
    this.clampGoal();
    const k = 1 - Math.exp(-dt * 8);
    this.target.lerp(this.goal, k);
    this.dist += (this.distFor(this.zoomLevel) - this.dist) * (1 - Math.exp(-dt * 7));
    this.apply();
  }

  /** 0 = 远档距离，1 = 近档距离（供纸纹等插值）。 */
  closeness(): number {
    const near = this.distFor(Zoom.Near), far = this.distFor(Zoom.Far);
    return MathUtils.clamp((far - this.dist) / Math.max(1e-3, far - near), 0, 1);
  }

  /** NDC → 与 y = h 平面的交点。 */
  groundAt(ndc: Vector2, out = new Vector3(), h = 0): Vector3 | null {
    this.ray.setFromCamera(ndc, this.camera);
    this.plane.constant = -h;
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  /** 只有中档把注视点限制在地图边缘向内 1.5 格；近档允许看到地区外的书页空白。 */
  private clampGoal(): void {
    const n = this.n;
    if (this.zoomLevel === Zoom.Mid) {
      const lo = Math.min(MID_EDGE, n / 2), hi = Math.max(n - MID_EDGE, n / 2);
      this.goal.x = MathUtils.clamp(this.goal.x, lo, hi);
      this.goal.z = MathUtils.clamp(this.goal.z, lo, hi);
    } else {
      this.goal.x = MathUtils.clamp(this.goal.x, 0, n);
      this.goal.z = MathUtils.clamp(this.goal.z, 0, n);
    }
  }

  private apply(): void {
    const c = this.camera;
    c.position.set(this.target.x, this.dist * Math.sin(PITCH), this.target.z + this.dist * Math.cos(PITCH));
    c.lookAt(this.target);
  }
}
