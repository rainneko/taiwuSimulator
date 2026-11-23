import { signal, type Signal } from '@preact/signals';
import { Camera, Vector3 } from 'three';

export interface LabelSpec {
  id: string;
  world: Vector3;
  priority: number;
  offsetPx?: [number, number];
  minZoom?: number; maxZoom?: number;
  /** 内容：strings key 或原文（LabelLayer 用）。 */
  textKey?: string;
}
type Entry = LabelSpec & { visible: boolean };
interface Bound { el: HTMLElement; w: number; h: number; opacity: number; shown: boolean }

const MAX = 64, FADE_MS = 120, HYST = 2;
const _v = new Vector3();

/** 三维坐标 → DOM 位置；每帧直接写 style，不触发 Preact 重渲染。 */
export class LabelProjector {
  readonly labels: Signal<ReadonlyArray<Entry>> = signal([]);
  private specs = new Map<string, LabelSpec>();
  private bound = new Map<string, Bound>();
  private cam: Camera | null = null;
  private zoom = 1;
  private dirty = false;
  private last = performance.now();

  constructor(private container: HTMLElement) {}

  setCamera(cam: Camera, zoom: number): void { this.cam = cam; this.zoom = zoom; }
  upsert(spec: LabelSpec): void { this.specs.set(spec.id, spec); this.dirty = true; }
  remove(id: string): void { if (this.specs.delete(id)) this.dirty = true; }
  clear(): void { if (this.specs.size) { this.specs.clear(); this.dirty = true; } }

  bind(id: string, el: HTMLElement | null): void {
    if (!el) { this.bound.delete(id); return; }
    el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0'; el.style.opacity = '0';
    el.style.willChange = 'transform, opacity';
    this.bound.set(id, { el, w: el.offsetWidth, h: el.offsetHeight, opacity: 0, shown: false });
  }
  /** 内容变了（文字长度变化）后重新量尺寸。 */
  measure(id: string): void { const b = this.bound.get(id); if (b) { b.w = b.el.offsetWidth; b.h = b.el.offsetHeight; } }

  flush(): void {
    const now = performance.now(), dt = now - this.last; this.last = now;
    if (this.dirty) {
      this.dirty = false;
      const list = [...this.specs.values()].sort((a, b) => b.priority - a.priority).slice(0, MAX);
      this.labels.value = list.map((s) => ({ ...s, visible: true }));
    }
    if (!this.cam) return;
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const placed: Array<[number, number, number, number]> = [];
    const step = Math.min(1, dt / FADE_MS);
    for (const s of this.labels.peek()) {
      const b = this.bound.get(s.id); if (!b) continue;
      _v.copy(s.world).project(this.cam);
      let want = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) <= 1.05 && Math.abs(_v.y) <= 1.05;
      let zf = 1;
      if (s.minZoom !== undefined) zf = Math.min(zf, Math.max(0, Math.min(1, (this.zoom - s.minZoom) * 4 + 1)));
      if (s.maxZoom !== undefined) zf = Math.min(zf, Math.max(0, Math.min(1, (s.maxZoom - this.zoom) * 4 + 1)));
      if (zf <= 0) want = false;
      const [ox, oy] = s.offsetPx ?? [0, 0];
      const x = (_v.x * 0.5 + 0.5) * W + ox - b.w / 2, y = (-_v.y * 0.5 + 0.5) * H + oy - b.h / 2;
      if (want) {
        const m = b.shown ? -HYST : HYST;   // 已显示的放宽，隐藏的收紧：滞回
        const r: [number, number, number, number] = [x - m, y - m, x + b.w + m, y + b.h + m];
        if (placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1])) want = false;
        else placed.push([x, y, x + b.w, y + b.h]);
      }
      b.shown = want;
      const target = want ? zf : 0;
      b.opacity += (target - b.opacity) * step;
      if (Math.abs(target - b.opacity) < 0.01) b.opacity = target;
      b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      b.el.style.opacity = b.opacity.toFixed(3);
      b.el.style.visibility = b.opacity > 0 ? 'visible' : 'hidden';
    }
  }
}
