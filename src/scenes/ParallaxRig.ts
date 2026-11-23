import type { Object3D, Vector3 } from 'three';

/** 每层登记一个视差系数 k ∈ [0,1]：layer.x = base.x + camOffset.x × k。WO2 复用。 */
export class ParallaxRig {
  private layers: Array<{ obj: Object3D; baseX: number; k: number }> = [];
  add(obj: Object3D, k: number): void { this.layers.push({ obj, baseX: obj.position.x, k: Math.max(0, Math.min(1, k)) }); }
  update(camOffset: Pick<Vector3, 'x'>): void { for (const l of this.layers) l.obj.position.x = l.baseX + camOffset.x * l.k; }
  clear(): void { this.layers = []; }
}
