import { BatchedMesh, BufferGeometry, Color, Matrix4, MeshLambertMaterial, Quaternion, Texture, Vector3 } from 'three';
import { advanceHinge, HINGE_HALF, HINGE_RISE, HingeState } from './hinge';
import { cardQuaternion, makeCardGeometry } from './PaperCard';
import { createPaperMaterial } from './PaperMaterial';

/** §2.6 的图集格式（此处只取 PaperBatch 需要的部分；完整 schema 由 assets/atlas.ts 提供）。 */
export interface AtlasFrame {
  name: string;
  rect: [x: number, y: number, w: number, h: number];
  size: [w: number, h: number];
  anchor?: [ax: number, ay: number];
}
export interface AtlasJson {
  image: string;
  size: [w: number, h: number];
  feather: number;
  padding: number;
  frames: AtlasFrame[];
}
export interface Atlas { json: AtlasJson; texture: Texture }

export interface BatchCardInit {
  frame: string;
  position: Vector3;
  yaw?: number;
  scale?: number;
  startState?: HingeState;
  tint?: Color;
}
export type CardHandle = number;

/** 图集帧 → 卡片几何（UV 烘在几何里；v 轴按 flipY 翻转）。 */
export function frameGeometry(atlas: AtlasJson, f: AtlasFrame): BufferGeometry {
  const [W, H] = atlas.size;
  const [x, y, w, h] = f.rect;
  return makeCardGeometry({
    width: f.size[0], height: f.size[1], anchorX: f.anchor?.[0] ?? 0.5,
    uv: [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H],
  });
}

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3();
const WHITE = new Color(1, 1, 1);

export class PaperBatch {
  readonly mesh: BatchedMesh;
  readonly material: MeshLambertMaterial;
  private readonly geomIds = new Map<string, number>();
  private readonly atlas: Atlas;

  // 并行 TypedArray 状态，按 instanceId 索引
  private readonly theta: Float32Array;
  private readonly vel: Float32Array;
  private readonly target: Float32Array;
  private readonly delay: Float32Array;
  private readonly state: Uint8Array;
  private readonly pos: Float32Array;
  private readonly yaw: Float32Array;
  private readonly scale: Float32Array;
  private readonly alive: Uint8Array;
  /** 正在动的实例；update 只遍历它。 */
  readonly active = new Set<number>();
  private readonly hs = { theta: 0, vel: 0 };

  constructor(atlas: Atlas, capacity: { cards: number; frames: number }) {
    this.atlas = atlas;
    this.material = createPaperMaterial({ map: atlas.texture });
    this.mesh = new BatchedMesh(capacity.cards, capacity.frames * 4, capacity.frames * 6, this.material);
    this.mesh.sortObjects = false;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    const n = capacity.cards;
    this.theta = new Float32Array(n); this.vel = new Float32Array(n);
    this.target = new Float32Array(n); this.delay = new Float32Array(n);
    this.state = new Uint8Array(n); this.pos = new Float32Array(n * 3);
    this.yaw = new Float32Array(n); this.scale = new Float32Array(n); this.alive = new Uint8Array(n);
  }

  private geometryFor(frame: string): number {
    let id = this.geomIds.get(frame);
    if (id !== undefined) return id;
    const f = this.atlas.json.frames.find((x) => x.name === frame);
    if (!f) throw new Error(`[PaperBatch] 图集里没有帧：${frame}`);
    const g = frameGeometry(this.atlas.json, f);
    id = this.mesh.addGeometry(g);
    g.dispose();
    this.geomIds.set(frame, id);
    return id;
  }

  add(init: BatchCardInit): CardHandle {
    const h = this.mesh.addInstance(this.geometryFor(init.frame));
    this.alive[h] = 1;
    this.pos[h * 3] = init.position.x; this.pos[h * 3 + 1] = init.position.y; this.pos[h * 3 + 2] = init.position.z;
    this.yaw[h] = init.yaw ?? 0;
    this.scale[h] = init.scale ?? 1;
    this.vel[h] = 0; this.delay[h] = 0;
    const st = init.startState ?? HingeState.FLAT;
    const up = st === HingeState.LOCKED;
    this.theta[h] = up ? HINGE_RISE.restAngle : 0;
    this.target[h] = up ? HINGE_RISE.restAngle : 0;
    this.state[h] = up ? HingeState.LOCKED : HingeState.FLAT;
    this.mesh.setColorAt(h, init.tint ?? WHITE);
    this.writeMatrix(h);
    if (st === HingeState.RISE) this.rise(h);
    else if (st === HingeState.FALL) this.fall(h);
    return h;
  }

  remove(h: CardHandle): void {
    if (!this.alive[h]) return;
    this.alive[h] = 0;
    this.active.delete(h);
    this.mesh.deleteInstance(h);
  }

  private go(h: CardHandle, state: HingeState, target: number, delay: number): void {
    if (!this.alive[h]) return;
    this.state[h] = state; this.target[h] = target; this.delay[h] = delay;
    this.active.add(h);
  }
  rise(h: CardHandle, delay = 0): void { this.go(h, HingeState.RISE, HINGE_RISE.restAngle, delay); }
  fall(h: CardHandle, delay = 0): void { this.go(h, HingeState.FALL, 0, delay); }
  setHalf(h: CardHandle): void { this.go(h, HingeState.RISE, HINGE_HALF, 0); }
  nudge(h: CardHandle, impulse: number): void {
    if (!this.alive[h]) return;
    this.vel[h] += impulse;
    if (this.state[h] === HingeState.LOCKED || this.state[h] === HingeState.FLAT) {
      this.state[h] = this.target[h] > 0 ? HingeState.RISE : HingeState.FALL;
    }
    this.active.add(h);
  }
  setTint(h: CardHandle, c: Color): void { if (this.alive[h]) this.mesh.setColorAt(h, c); }
  setFrame(h: CardHandle, frame: string): void { if (this.alive[h]) this.mesh.setGeometryIdAt(h, this.geometryFor(frame)); }

  getState(h: CardHandle): HingeState { return this.state[h] as HingeState; }
  getTheta(h: CardHandle): number { return this.theta[h]; }

  update(dt: number): void {
    if (this.active.size === 0) return;
    for (const h of this.active) {
      let step = dt;
      if (this.delay[h] > 0) {
        this.delay[h] -= dt;
        if (this.delay[h] > 0) continue;
        step = -this.delay[h]; this.delay[h] = 0;
      }
      this.hs.theta = this.theta[h]; this.hs.vel = this.vel[h];
      const next = advanceHinge(this.hs, this.state[h] as HingeState, this.target[h], step);
      this.theta[h] = this.hs.theta; this.vel[h] = this.hs.vel; this.state[h] = next;
      this.writeMatrix(h);
      if (next === HingeState.LOCKED || next === HingeState.FLAT) this.active.delete(h);
    }
  }

  private writeMatrix(h: number): void {
    cardQuaternion(this.yaw[h], this.theta[h], _q);
    _p.set(this.pos[h * 3], this.pos[h * 3 + 1], this.pos[h * 3 + 2]);
    const s = this.scale[h];
    _m.compose(_p, _q, _s.set(s, s, s));
    this.mesh.setMatrixAt(h, _m);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
