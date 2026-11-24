/**
 * 单个角色在场上的位移表现（纯渲染层，逻辑只认 state.distance）。
 *
 * - home：落脚点。核心每发一次 moveStep，只有移动的那个人的 home 变化。
 *   显示位置以限速缓动追 home，移动期间按固定节奏一跳一跳（与核心步进频率解耦：
 *   核心可能每几帧就走一步，逐步起跳会让人一直悬空）。
 * - dash：出手前冲 / 闪避后撤等短暂偏移，沿朝向计（正 = 朝对手），不影响 home 与镜头。
 *
 * 所有时间都按"动画时间"推进（顿帧时 timeScale = 0，跳跃和冲刺一起停住）。
 */

type Ease = 'out' | 'inOut';

interface DashTween { from: number; to: number; t: number; dur: number; ease: Ease; arc: number }

/** 落地压缩时长（秒） */
const LAND_TIME = 0.1;

/** 跳一次的时长与高度 */
const HOP_PERIOD = 0.26;
const HOP_HEIGHT = 22;
/** 追落脚点：比例增益与限速（世界像素/秒） */
const FOLLOW_GAIN = 9;
const FOLLOW_MAX_SPEED = 1600;
/** 离落脚点多远算"在移动" */
const MOVING_EPS = 3;

function ease(e: Ease, k: number): number {
  if (e === 'out') return 1 - (1 - k) ** 3;
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
}

export class FighterMotion {
  home: number;
  /** 当前显示的落脚 x（跳跃中介于两点之间） */
  x: number;
  /** 跳跃高度 */
  private hopY = 0;
  /** 冲刺偏移（沿朝向） */
  dash = 0;
  private dashY = 0;
  /** 当前这一跳的进度 0..1；null = 站定 */
  private hopPhase: number | null = null;
  private dashTw: DashTween | null = null;
  /** 闪避晃身：独立于冲刺的叠加偏移，互不覆盖 */
  private sway: { amp: number; t: number; dur: number } | null = null;
  private swayX = 0;
  private land = 0;

  constructor(readonly facing: 1 | -1, x0: number) {
    this.home = this.x = x0;
  }

  /** 世界 x（含冲刺偏移） */
  get worldX(): number { return this.x + (this.dash + this.swayX) * this.facing; }
  /** 离地高度 */
  get height(): number { return this.hopY + this.dashY; }
  /** 落地压缩（skeleton.scaleY） */
  get squashY(): number { return this.land > 0 ? 1 - 0.07 * Math.sin(Math.PI * (1 - this.land / LAND_TIME)) : 1; }
  /** 正在跳跃或冲刺 */
  get busy(): boolean { return this.hopPhase !== null || !!this.dashTw || !!this.sway || Math.abs(this.dash) > 0.5; }

  /** 落脚点移动 dx（显示位置随后跳着追过去） */
  moveHome(dx: number) {
    this.home += dx;
  }

  /** 整体平移（镜头回中时用，屏幕上看不出角色在动） */
  shift(dx: number) {
    this.home += dx;
    this.x += dx;
  }

  /** 冲刺偏移在 dur 秒内缓动到 to（沿朝向，正 = 朝对手）；arc > 0 时途中带一个小跳。 */
  dashTo(to: number, dur: number, e: Ease = 'out', arc = 0) {
    this.dashTw = { from: this.dash, to, t: 0, dur: Math.max(0.01, dur), ease: e, arc };
  }

  /** 闪避晃身：沿朝向偏移 amp（负 = 后仰）再回来 */
  swayBy(amp: number, dur: number) {
    this.sway = { amp, t: 0, dur };
  }

  update(dt: number) {
    // 追落脚点（限速），移动中一跳接一跳；停下时把当前这一跳跳完再落地
    const diff = this.home - this.x;
    const moving = Math.abs(diff) > MOVING_EPS;
    const step = Math.sign(diff) * Math.min(Math.abs(diff), Math.min(FOLLOW_MAX_SPEED, Math.abs(diff) * FOLLOW_GAIN) * dt);
    this.x += step;
    if (!moving && this.hopPhase === null && Math.abs(diff) < 0.5) this.x = this.home;
    if (moving && this.hopPhase === null) this.hopPhase = 0;
    if (this.hopPhase !== null) {
      this.hopPhase += dt / HOP_PERIOD;
      if (this.hopPhase >= 1) {
        this.land = LAND_TIME;
        this.hopPhase = moving ? this.hopPhase % 1 : null;
      }
      this.hopY = this.hopPhase === null ? 0 : HOP_HEIGHT * Math.sin(Math.PI * this.hopPhase);
    }
    const d = this.dashTw;
    if (d) {
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      const v = ease(d.ease, k);
      this.dash = d.from + (d.to - d.from) * v;
      this.dashY = d.arc * 4 * k * (1 - k);
      if (k >= 1) {
        this.dashTw = null;
        this.dashY = 0;
        this.dash = d.to;
      }
    }
    const s = this.sway;
    if (s) {
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      this.swayX = s.amp * Math.sin(Math.PI * k);
      if (k >= 1) { this.sway = null; this.swayX = 0; }
    }
    if (this.land > 0) this.land = Math.max(0, this.land - dt);
  }
}
