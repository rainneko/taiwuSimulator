import type { SpineActor } from './SpineActor';

/** 顿帧 / 慢放：统一改所有角色的 animationState.timeScale。以渲染帧计数，不依赖 setTimeout。 */
export class TimeScaler {
  private hitstop = 0;
  private slow = 0;
  private slowScale = 0.25;

  constructor(private actors: SpineActor[]) {}

  applyHitstop(frames: number) { this.hitstop = Math.max(this.hitstop, frames); }
  applySlowmo(frames: number, scale = 0.25) { this.slow = Math.max(this.slow, frames); this.slowScale = scale; }

  /** 每渲染帧调用一次；返回当前 timeScale（也供逻辑步进节流用）。 */
  tick(): number {
    let ts = 1;
    if (this.hitstop > 0) { ts = 0; this.hitstop--; }
    else if (this.slow > 0) { ts = this.slowScale; this.slow--; }
    for (const a of this.actors) a.animationState.timeScale = ts;
    return ts;
  }
}

/** 屏幕震动：对包含两层 canvas + HUD 的容器整体施加 CSS transform。 */
export class ScreenShake {
  private queue: { dx: number; dy: number; frames: number; frame: number }[] = [];
  constructor(private el: HTMLElement) {}

  add(dx: number, dy: number, frames: number) { this.queue.push({ dx, dy, frames, frame: 0 }); }

  update() {
    let ox = 0, oy = 0;
    this.queue = this.queue.filter((s) => {
      const decay = 1 - s.frame / s.frames;
      ox += s.dx * decay * Math.sin(s.frame * 1.5);
      oy += s.dy * decay * Math.cos(s.frame * 1.7);
      s.frame++;
      return s.frame < s.frames;
    });
    this.el.style.transform = ox || oy ? `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)` : '';
  }
}
