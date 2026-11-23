import { batch } from '@preact/signals';
import { HalfFloatType, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import type { AssetCache } from './AssetCache';
import type { ScenePointerEvent } from './InputRouter';
import { ui, type Screen } from './store';
import { TransitionPass, type PassStyle, type TransitionStyle } from './TransitionPass';

export type { TransitionStyle };
export interface NdcRect { x0: number; y0: number; x1: number; y1: number }

export interface IScene {
  readonly id: Screen;
  preload(assets: AssetCache, signal: AbortSignal): Promise<void>;
  enter(params: unknown, from: Screen | null): void;
  update(dt: number): void;
  render(r: WebGLRenderer, target: WebGLRenderTarget | null): void;
  onPointer(e: ScenePointerEvent): void;
  exit(to: Screen): void;
  dispose(): void;
  resize?(w: number, h: number): void;
  isIdle?(): boolean;
  getFocusRect?(params: unknown): NdcRect | null;
  alignTo?(rect: NdcRect): void;
  setDiveProgress?(t: number, dir: 'dive' | 'rise', params: unknown): void;
  onKey?(e: KeyboardEvent): boolean;
  /** 同实例换屏（retarget）时通知场景。 */
  onRetarget?(to: Screen): void;
}

export interface GotoOptions { style?: TransitionStyle; origin?: [number, number] }

const HALF_MS: Record<PassStyle, number> = { fold: 380, dive: 450, rise: 450, tear: 300, cross: 100 };
const PRELOAD_TIMEOUT = 8000;

/** UI_MAIN §3.2 默认转场表（简化版）。 */
function defaultStyle(from: Screen | null, to: Screen): TransitionStyle {
  if (to === 'combat' || from === 'combat') return 'tear';
  const depth: Partial<Record<Screen, number>> = { worldMap: 0, region: 1, town: 2 };
  const a = from ? depth[from] : undefined, b = depth[to];
  if (a !== undefined && b !== undefined && a !== b) return b > a ? 'dive' : 'rise';
  return 'fold';
}

class TransitionCancelled extends Error {}

export class SceneManager {
  current: IScene | null = null;
  private factories = new Map<Screen, () => IScene>();
  private instances = new Map<Screen, IScene>();
  /** 共享实例：多个 Screen 指向同一个场景（mainMenu ⇄ newGame）。 */
  private aliases = new Map<Screen, Screen>();
  private busy = false;
  private pending: { to: Screen; params: unknown; opts: GotoOptions } | null = null;
  private lastParams = new Map<Screen, unknown>();
  private rtA: WebGLRenderTarget | null = null;
  private rtB: WebGLRenderTarget | null = null;
  private readonly pass = new TransitionPass();
  /** 转场中由 update/render 驱动的状态。 */
  private tx: null | {
    style: PassStyle; t0: number; p0: number; p1: number; ms: number; p: number; done: () => void;
    next: IScene | null; prev: IScene | null; params: unknown;
  } = null;
  private size = new Vector2();

  constructor(private renderer: WebGLRenderer, private assets: AssetCache) {}

  register(id: Screen, factory: () => IScene, alias?: Screen[]): void {
    this.factories.set(id, factory);
    for (const a of alias ?? []) this.aliases.set(a, id);
  }
  private key(s: Screen): Screen { return this.aliases.get(s) ?? s; }
  private getOrCreate(s: Screen): IScene {
    const k = this.key(s);
    let sc = this.instances.get(k);
    if (!sc) {
      const f = this.factories.get(k);
      if (!f) throw new Error(`SceneManager: no scene registered for '${s}'`);
      sc = f(); this.instances.set(k, sc);
    }
    return sc;
  }

  get transitioning(): boolean { return this.tx !== null; }

  private pickStyle(from: Screen | null, to: Screen, want: TransitionStyle | undefined, params: unknown, next: IScene): PassStyle {
    if (ui.reducedMotion.peek()) return 'cross';
    let s = want ?? defaultStyle(from, to);
    if (s === 'dive' || s === 'rise') {
      const cur = this.current;
      const ok = !!cur?.getFocusRect && !!cur.setDiveProgress && !!next.alignTo && cur.getFocusRect(params) !== null;
      if (!ok) s = 'fold';
    }
    if (!this.current) return 'cross';
    return s;
  }

  private ensureRTs(): void {
    this.renderer.getDrawingBufferSize(this.size);
    const low = ui.quality.peek() === 'low';
    const w = Math.max(1, low ? this.size.x >> 1 : this.size.x), h = Math.max(1, low ? this.size.y >> 1 : this.size.y);
    const mk = () => new WebGLRenderTarget(w, h, { samples: low ? 0 : 4, type: HalfFloatType });
    if (!this.rtA) this.rtA = mk();
    if (!this.rtB) this.rtB = mk();
  }
  private releaseRTs(): void { this.rtA?.dispose(); this.rtB?.dispose(); this.rtA = this.rtB = null; }

  private preloadWithTimeout(sc: IScene, abort: AbortController): Promise<void> {
    return new Promise((res, rej) => {
      const to = setTimeout(() => { abort.abort(); rej(new Error('preload timeout')); }, PRELOAD_TIMEOUT);
      sc.preload(this.assets, abort.signal).then(() => { clearTimeout(to); res(); }, (e) => { clearTimeout(to); rej(e); });
    });
  }

  private playHalf(p0: number, p1: number, style: PassStyle, ms: number, next: IScene | null, prev: IScene | null, params: unknown): Promise<void> {
    return new Promise((done) => { this.tx = { style, t0: performance.now(), p0, p1, ms, p: p0, done, next, prev, params }; });
  }

  async goto(to: Screen, params?: unknown, opts: GotoOptions = {}): Promise<void> {
    if (this.busy) { this.pending = { to, params, opts }; return; }
    this.busy = true;
    const from = this.current?.id ?? null;
    const prev = this.current;
    const next = this.getOrCreate(to);
    const style = this.pickStyle(ui.screen.peek() === 'boot' ? null : ui.screen.peek(), to, opts.style, params, next);
    this.lastParams.set(to, params);

    ui.transition.value = { from: ui.screen.peek(), to, progress: 0 };          // ① 锁输入
    this.ensureRTs();
    if (prev) prev.render(this.renderer, this.rtA);                              // ② 定格
    else { this.renderer.setRenderTarget(this.rtA); this.renderer.setClearColor(0x1d1813, 1); this.renderer.clear(); this.renderer.setRenderTarget(null); }
    this.pass.begin(style, this.rtA!, opts);

    try {
      // ③ 前半段 ‖ 预加载
      let loaded = this.preloadWithTimeout(next, new AbortController());
      let settled = false;
      loaded.then(() => { settled = true; }, () => { settled = true; });
      await this.playHalf(0, 0.5, style, Math.max(250, HALF_MS[style]), null, prev, params);
      if (!settled) ui.loading.value = { visible: true, ratio: 0, retry: null };     // ④ 停在半程
      for (;;) {
        try { await loaded; break; } catch {
          // 失败：幕保持盖住，给出重试 / 取消（旧场景尚未 exit，可无损退回）
          const choice = await new Promise<'retry' | 'cancel'>((res) => {
            ui.loading.value = { visible: true, ratio: 0, retry: () => res('retry'), cancel: () => res('cancel') };
          });
          if (choice === 'cancel') {
            ui.loading.value = { visible: false, ratio: 0, retry: null };
            await this.playHalf(0.5, 0, style, HALF_MS[style], null, prev, params);
            throw new TransitionCancelled();
          }
          ui.loading.value = { visible: true, ratio: 0, retry: null };
          loaded = this.preloadWithTimeout(next, new AbortController());
        }
      }
      ui.loading.value = { visible: false, ratio: 1, retry: null };

      if ((style === 'dive' || style === 'rise') && prev) { prev.render(this.renderer, this.rtA); this.pass.setA(this.rtA!); }
      // ⑤ 换场
      const rect = prev?.getFocusRect?.(params) ?? null;
      if (prev && prev !== next) prev.exit(to);
      next.enter(params, from);
      if ((style === 'dive' || style === 'rise') && rect) next.alignTo?.(rect);
      next.update(0);
      next.render(this.renderer, this.rtB);
      this.current = next;
      // ⑥ 后半段
      await this.playHalf(0.5, 1, style, HALF_MS[style], next, prev, params);
      // ⑦ 解锁
      batch(() => { ui.screen.value = to; ui.transition.value = null; });
      if (prev && prev !== next) this.applyCachePolicy(prev, to);
    } catch (e) {
      ui.transition.value = null;
      if (!(e instanceof TransitionCancelled)) { console.error(e); }
    } finally {
      this.tx = null;
      this.pass.end();
      this.releaseRTs();
      this.busy = false;
    }
    if (this.pending) { const p = this.pending; this.pending = null; void this.goto(p.to, p.params, p.opts); }
  }

  /** 同实例换屏：不拍 RT、不播转场。 */
  retarget(to: Screen): void {
    if (this.busy || !this.current) return;
    if (this.key(to) !== this.key(this.current.id)) { void this.goto(to); return; }
    ui.screen.value = to;
    this.current.onRetarget?.(to);
  }

  async prefetch(to: Screen, _params?: unknown): Promise<void> {
    try { await this.getOrCreate(to).preload(this.assets, new AbortController().signal); } catch { /* 预取失败无所谓 */ }
  }

  async reenter(): Promise<void> {
    const cur = this.current; if (!cur) return;
    await cur.preload(this.assets, new AbortController().signal);
    cur.enter(this.lastParams.get(ui.screen.peek()), ui.screen.peek());
  }

  private applyCachePolicy(prev: IScene, to: Screen): void {
    const k = this.key(prev.id);
    const inGame = to !== 'mainMenu' && to !== 'newGame';
    if (k === 'worldMap') return;                                       // 常驻
    if ((k === 'mainMenu' || k === 'newGame') && inGame) { prev.dispose(); this.instances.delete(k); return; }
    // town / region 各留最近 1 个：实例按 Screen 唯一，自然只有 1 个
  }

  resize(w: number, h: number): void {
    for (const sc of this.instances.values()) sc.resize?.(w, h);
    if (this.tx && this.rtB) { this.rtB.dispose(); this.rtB = null; this.ensureRTs(); }
  }

  isIdle(): boolean { return !this.tx && (this.current?.isIdle?.() ?? true); }

  update(dt: number): void {
    const tx = this.tx;
    if (tx) {
      const k = Math.min(1, (performance.now() - tx.t0) / tx.ms);
      tx.p = tx.p0 + (tx.p1 - tx.p0) * k;
      const t = ui.transition.peek();
      if (t) ui.transition.value = { ...t, progress: tx.p };
      if ((tx.style === 'dive' || tx.style === 'rise') && tx.p <= 0.5 && tx.prev) {
        tx.prev.setDiveProgress?.(tx.p * 2, tx.style, tx.params);
        tx.prev.update(dt);
      }
      if (tx.next) tx.next.update(dt);
      if (k >= 1) { this.tx = null; tx.done(); }
      return;
    }
    this.current?.update(dt);
  }

  render(r: WebGLRenderer): void {
    const tx = this.tx;
    if (!tx && !this.busy) { this.current?.render(r, null); return; }
    if (!tx) { this.pass.render(r, null, 0.5); return; }   // 等加载：停在半程
    if ((tx.style === 'dive' || tx.style === 'rise') && tx.p <= 0.5 && tx.prev) { tx.prev.render(r, null); return; }
    if (tx.next && this.rtB) tx.next.render(r, this.rtB);  // 后半程画面是活的
    this.pass.render(r, tx.next ? this.rtB : null, tx.p);
  }
}
