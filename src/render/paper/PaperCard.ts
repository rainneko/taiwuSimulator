import { BufferGeometry, Float32BufferAttribute, Mesh, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import { advanceHinge, HINGE_HALF, HINGE_RISE, HingeState } from './hinge';

export interface CardSpec {
  width: number; height: number;          // 米
  uv: [u0: number, v0: number, u1: number, v1: number];
  anchorX?: number;                        // 铰链轴上的锚点，0–1，默认 0.5
}

/** 平面几何，原点在底边锚点：x ∈ [-w·ax, w·(1-ax)]，y ∈ [0, h]，法线 +Z。 */
export function makeCardGeometry(spec: CardSpec): BufferGeometry {
  const ax = spec.anchorX ?? 0.5;
  const x0 = -spec.width * ax, x1 = spec.width * (1 - ax), h = spec.height;
  const [u0, v0, u1, v1] = spec.uv;
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([x0, 0, 0, x1, 0, 0, x1, h, 0, x0, h, 0], 3));
  g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const AX_X = new Vector3(1, 0, 0), AX_Y = new Vector3(0, 1, 0);
const _qy = new Quaternion(), _qx = new Quaternion();

/** 姿态换算：quatY(yaw) × quatX(θ − π/2)。 */
export function cardQuaternion(yaw: number, theta: number, out = new Quaternion()): Quaternion {
  _qy.setFromAxisAngle(AX_Y, yaw);
  _qx.setFromAxisAngle(AX_X, theta - Math.PI / 2);
  return out.multiplyQuaternions(_qy, _qx);
}

/** 单张立牌：数量少、需要独立控制的东西用它。 */
export class PaperCard extends Mesh<BufferGeometry, MeshLambertMaterial> {
  readonly hinge = { theta: 0, vel: 0 };
  state: HingeState = HingeState.FLAT;
  yaw = 0;
  private target = 0;
  private delay = 0;

  constructor(geometry: BufferGeometry, material: MeshLambertMaterial) {
    super(geometry, material);
    this.applyPose();
  }

  rise(delay = 0): void { this.target = HINGE_RISE.restAngle; this.delay = delay; this.state = HingeState.RISE; }
  fall(delay = 0): void { this.target = 0; this.delay = delay; this.state = HingeState.FALL; }
  setHalf(): void { this.target = HINGE_HALF; this.delay = 0; this.state = HingeState.RISE; }
  nudge(impulse: number): void {
    this.hinge.vel += impulse;
    if (this.state === HingeState.LOCKED || this.state === HingeState.FLAT) {
      this.state = this.target > 0 ? HingeState.RISE : HingeState.FALL;
    }
  }

  /** 是否在动（供外部判断是否需要继续 update）。 */
  get moving(): boolean { return this.state === HingeState.RISE || this.state === HingeState.FALL; }

  update(dt: number): void {
    if (this.moving) {
      if (this.delay > 0) {
        this.delay -= dt;
        if (this.delay > 0) { this.applyPose(); return; }
        dt = -this.delay; this.delay = 0;
      }
      this.state = advanceHinge(this.hinge, this.state, this.target, dt);
    }
    this.applyPose();
  }

  private applyPose(): void {
    cardQuaternion(this.yaw, this.hinge.theta, this.quaternion);
    this.castShadow = this.hinge.theta > 0.05;
  }
}
