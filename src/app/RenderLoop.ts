import type { WebGLRenderer } from 'three';
import type { InputRouter } from './InputRouter';
import type { LabelProjector } from './LabelProjector';
import type { PortraitStage } from './PortraitStage';
import type { SceneManager } from './SceneManager';
import { ui } from './store';

const IDLE_AFTER_MS = 2000, IDLE_FRAME_MS = 100;

/** 主循环：update → render → portrait → labels。省电、后台暂停、上下文丢失处理。 */
export class RenderLoop {
  private raf = 0;
  private last = 0;
  private lastFrame = 0;
  private running = false;
  private lost = false;
  onContextRestored: (() => void) | null = null;

  constructor(
    private renderer: WebGLRenderer, private scenes: SceneManager, private portraits: PortraitStage,
    private labels: LabelProjector, private input: InputRouter,
  ) {
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? this.stop() : this.start()));
    const c = renderer.domElement;
    c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    c.addEventListener('webglcontextrestored', () => { this.lost = false; this.onContextRestored?.(); });
  }

  start(): void {
    if (this.running) return;
    this.running = true; this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  stop(): void { this.running = false; cancelAnimationFrame(this.raf); }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    if (this.lost) return;
    const idle = this.scenes.isIdle() && ui.transition.peek() === null && !this.portraits.active
      && now - this.input.lastInput > IDLE_AFTER_MS;
    if (idle && now - this.lastFrame < IDLE_FRAME_MS) return;
    this.lastFrame = now;
    const dt = Math.min((now - this.last) / 1000, 1 / 20);
    this.last = now;
    this.scenes.update(dt);
    this.portraits.update(dt);
    this.scenes.render(this.renderer);
    this.portraits.render(this.renderer);
    this.labels.flush();
  };
}
