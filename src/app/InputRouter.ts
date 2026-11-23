import { effect } from '@preact/signals';
import { Vector2 } from 'three';
import type { SceneManager } from './SceneManager';
import { closeTopmost, inputLocked } from './store';

export interface ScenePointerEvent {
  type: 'move' | 'down' | 'up' | 'click' | 'drag' | 'wheel' | 'leave' | 'pinch';
  ndc: Vector2;
  px: [number, number];
  button: number;
  pointerType: 'mouse' | 'touch' | 'pen';
  delta?: [number, number];
  mods: { shift: boolean; ctrl: boolean; alt: boolean };
  /** pickAt 合成事件携带的拖拽载荷。 */
  payload?: unknown;
}

const CLICK_PX = 6, CLICK_MS = 400;

/** 把 #scene 上的原生指针事件整理后转给当前场景。 */
export class InputRouter {
  private pointers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number; button: number; dragging: boolean }>();
  private pinchDist = 0;
  private wheelAcc = 0;
  private wheelRaf = 0;
  private lastEvent: PointerEvent | null = null;
  /** 最近一次输入的时间戳（省电判定）。 */
  lastInput = performance.now();
  private disposers: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement, private scenes: SceneManager) {
    const on = <K extends keyof HTMLElementEventMap>(t: EventTarget, k: K | string, f: (e: any) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(k, f, o); this.disposers.push(() => t.removeEventListener(k, f, o));
    };
    canvas.style.touchAction = 'none';
    on(canvas, 'pointerdown', (e: PointerEvent) => this.down(e));
    on(canvas, 'pointermove', (e: PointerEvent) => this.move(e));
    on(canvas, 'pointerup', (e: PointerEvent) => this.up(e));
    on(canvas, 'pointercancel', (e: PointerEvent) => this.up(e, true));
    on(canvas, 'pointerleave', (e: PointerEvent) => { if (!this.pointers.size) this.emit('leave', e); });
    on(canvas, 'wheel', (e: WheelEvent) => this.wheel(e), { passive: false });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(window, 'keydown', (e: KeyboardEvent) => this.key(e));
    // 转场锁：丢弃事件，并对进行中的拖拽补发 up
    this.disposers.push(effect(() => {
      if (inputLocked.value && this.pointers.size && this.lastEvent) {
        this.emit('up', this.lastEvent); this.pointers.clear();
      }
    }));
  }

  private toLocal(cx: number, cy: number): { px: [number, number]; ndc: Vector2 } {
    const r = this.canvas.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    return { px: [x, y], ndc: new Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1) };
  }

  private emit(type: ScenePointerEvent['type'], e: { clientX: number; clientY: number; button?: number; pointerType?: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey?: boolean },
    delta?: [number, number], payload?: unknown): void {
    this.lastInput = performance.now();
    if (inputLocked.peek() && type !== 'up') return;
    const { px, ndc } = this.toLocal(e.clientX, e.clientY);
    this.scenes.current?.onPointer({
      type, ndc, px, delta, payload,
      button: e.button ?? 0,
      pointerType: (e.pointerType as ScenePointerEvent['pointerType']) || 'mouse',
      mods: { shift: e.shiftKey, ctrl: e.ctrlKey || !!e.metaKey, alt: e.altKey },
    });
  }

  private down(e: PointerEvent): void {
    this.lastEvent = e;
    if (inputLocked.peek()) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), button: e.button, dragging: false });
    if (this.pointers.size === 2) this.pinchDist = this.twoDist();
    this.emit('down', e);
  }

  private twoDist(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private move(e: PointerEvent): void {
    this.lastEvent = e;
    const p = this.pointers.get(e.pointerId);
    if (!p) { this.emit('move', e); return; }
    if (inputLocked.peek()) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const mx0 = (a.x + b.x) / 2, my0 = (a.y + b.y) / 2;
      p.x = e.clientX; p.y = e.clientY;
      const d = this.twoDist();
      if (this.pinchDist > 0) this.emit('pinch', e, [d / this.pinchDist, 0]);
      this.pinchDist = d;
      this.emit('drag', e, [(a.x + b.x) / 2 - mx0, (a.y + b.y) / 2 - my0]);
      p.dragging = true;
      return;
    }
    p.x = e.clientX; p.y = e.clientY;
    if (!p.dragging && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) >= CLICK_PX) {
      p.dragging = true;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 已释放 */ }
    }
    this.emit(p.dragging ? 'drag' : 'move', e, p.dragging ? [dx, dy] : undefined);
  }

  private up(e: PointerEvent, cancelled = false): void {
    this.lastEvent = e;
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchDist = 0;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!p || inputLocked.peek()) return;
    this.emit('up', e);
    const isClick = !cancelled && !p.dragging && performance.now() - p.t0 < CLICK_MS
      && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < CLICK_PX;
    if (isClick) this.emit('click', e);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (inputLocked.peek()) return;
    const unit = e.deltaMode === 1 ? 1 : e.deltaMode === 2 ? 3 : e.deltaY / 100;
    const v = e.deltaMode === 0 ? unit : Math.sign(e.deltaY) * unit;
    // 触控板连续小增量：累加到一帧末再发，且只有累计满 1 格才发整数格
    this.wheelAcc += v;
    if (this.wheelRaf) return;
    const ev = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey };
    this.wheelRaf = requestAnimationFrame(() => {
      this.wheelRaf = 0;
      const steps = Math.trunc(this.wheelAcc);
      if (steps !== 0) { this.wheelAcc -= steps; this.emit('wheel', ev, [0, steps]); }
    });
  }

  private key(e: KeyboardEvent): void {
    this.lastInput = performance.now();
    if (e.key === 'Escape') { if (closeTopmost()) e.preventDefault(); return; }
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (inputLocked.peek()) return;
    if (this.scenes.current?.onKey?.(e)) e.preventDefault();
  }

  /** DragLayer 用：DOM 拖拽松手在场景上时合成一次 click。 */
  pickAt(clientX: number, clientY: number, payload?: unknown): void {
    this.emit('click', { clientX, clientY, button: 0, pointerType: 'mouse', shiftKey: false, ctrlKey: false, altKey: false }, undefined, payload);
  }

  dispose(): void { for (const d of this.disposers) d(); this.disposers = []; }
}
