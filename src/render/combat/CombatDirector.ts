import type { spine } from '../spine-webgl-3.8';
import type { CombatEvent, CombatState, StanceType, WeaponClass } from '../../core/combat';
import type { AnimationController } from './AnimationController';
import { FighterMotion } from './FighterMotion';
import { strikeTiming } from './strikeTiming';

/** 逻辑距离 1.0 对应的世界像素 */
export const PX_PER_DIST = 190;
/** 场地中心（世界 x） */
export const ARENA_CENTER = 960;

/** 命中时两人身体（腰骨）之间留的间隔，按兵器长短（世界像素） */
const CONTACT: Record<WeaponClass, number> = {
  fist: 120, sword: 190, blade: 180, polearm: 270, exotic: 150, ranged: 0,
};
/** 远程式不前冲 */
const RANGED_STANCES = new Set<StanceType>(['throw', 'flick', 'sound', 'curse', 'medicine', 'venom']);
/** 追击之间的间隔（动画秒） */
const CHASE_GAP = 0.12;
/** 命中后停留多久再回弹 */
const RETURN_DELAY = 0.12;
/** 前冲提前量：远距离时先冲一小段再起手，避免一帧掠过几百像素 */
const LEAD_PER_PX = 1 / 3000;
const LEAD_MAX = 0.2;
/** 两人中点偏离场地中心超过这个值就整体回中（背景层宽度有限） */
const RECENTER_SLACK = 220;
const RECENTER_RATE = 3;

export interface DirectorFeedback {
  /** 命中落在对方身上的那一刻：顿帧 / 白闪 / 震屏 */
  onImpact(target: 0 | 1, severity: 1 | 2 | 3): void;
  /** 摧破终结：慢放 */
  onFinisher(): void;
}

interface Reaction { kind: 'hit' | 'dodge'; target: 0 | 1; severity: 1 | 2 | 3 }

interface Strike {
  attacker: 0 | 1;
  t: number;
  /** 出手动画在第几秒起手（前冲提前量） */
  animAt: number;
  anim: string | null;
  started: boolean;
  /** 命中时刻（相对 strike 开始） */
  hitTime: number;
  dash: number;
  reactions: Reaction[];
  fired: number;
  returnAt: number;
  returned: boolean;
}

/**
 * 把核心引擎的事件编排成画面：
 * - moveStep → 只有移动者跳到新落脚点（不再两人一起瞬移）
 * - attackStart → 攻方播 A_ 并前冲，命中时刻正好贴到对方，之后回弹
 * - hit / dodge → 核心在出手同一帧就结算完了；这里把受方反应推迟到攻方动画的命中时刻，
 *   追击逐个间隔播放，避免受方在挨打前就先抽一下、或同一帧重播多次受击
 */
export class CombatDirector {
  readonly motions: [FighterMotion, FighterMotion];
  private strikes: Strike[] = [];
  /** 本帧回中平移量（渲染层把镜头同步平移，避免镜头滞后造成角色在屏幕上漂） */
  lastShift = 0;

  constructor(
    state: CombatState,
    private controllers: [AnimationController, AnimationController],
    private data: spine.SkeletonData,
    private fb: DirectorFeedback,
  ) {
    const gap = state.distance * PX_PER_DIST;
    this.motions = [new FighterMotion(1, ARENA_CENTER - gap / 2), new FighterMotion(-1, ARENA_CENTER + gap / 2)];
  }

  private idx(state: CombatState, id: string): 0 | 1 {
    return state.fighters[0].id === id ? 0 : 1;
  }

  /** 两人落脚点间距（世界像素） */
  get homeGap(): number { return this.motions[1].home - this.motions[0].home; }
  /** 两人落脚点中点 */
  get homeMid(): number { return (this.motions[0].home + this.motions[1].home) / 2; }
  /** 两人显示位置中点（镜头跟这个，不跟冲刺） */
  get viewMid(): number { return (this.motions[0].x + this.motions[1].x) / 2; }
  /** 两人显示间距（镜头推拉跟这个） */
  get viewGap(): number { return this.motions[1].x - this.motions[0].x; }

  handleEvents(state: CombatState, events: readonly CombatEvent[]) {
    // 同一批事件里，attackStart 之后同一攻方的 hit/dodge 归入这次出手
    const open: [Strike | null, Strike | null] = [null, null];
    for (const ev of events) {
      switch (ev.type) {
        case 'moveStep': {
          const i = this.idx(state, ev.payload.actorId);
          const dx = (ev.payload.to - ev.payload.from) * PX_PER_DIST;
          this.motions[i].moveHome(i === 0 ? -dx : dx);
          break;
        }
        case 'attackStart': {
          const i = this.idx(state, ev.payload.actorId);
          open[i] = this.startStrike(state, i);
          break;
        }
        case 'hit':
        case 'dodge': {
          const atk = this.idx(state, ev.payload.actorId);
          const r: Reaction = {
            kind: ev.type, target: (1 - atk) as 0 | 1,
            severity: ev.type === 'hit' ? ev.payload.severity : 1,
          };
          if (open[atk]) open[atk]!.reactions.push(r);
          else this.react(r);
          break;
        }
        case 'techniqueCastStart':
          this.controllers[this.idx(state, ev.payload.actorId)].playSkill(ev.payload.skillId);
          break;
        case 'techniqueStage':
          if (ev.payload.stage === 4) this.fb.onFinisher();
          break;
        case 'end':
          if (ev.payload.winnerId) this.controllers[(1 - this.idx(state, ev.payload.winnerId)) as 0 | 1].playDefeat();
          break;
        default:
          break;
      }
    }
    // 兜底：落脚点间距与逻辑距离对不上（漏了事件、初始化等）时用 shift 静默校正（不触发跳跃）
    const r = state.distance * PX_PER_DIST - this.homeGap;
    if (Math.abs(r) > 1) {
      this.motions[0].shift(-r / 2);
      this.motions[1].shift(r / 2);
    }
  }

  private startStrike(state: CombatState, i: 0 | 1): Strike {
    // 上一次出手还没收尾：立刻结清，取消它的回弹
    for (const s of this.strikes) if (s.attacker === i) this.finish(s);
    this.strikes = this.strikes.filter((s) => s.attacker !== i);

    const f = state.fighters[i];
    const stance = f.wheelSlots[f.wheelIndex] ?? 'chop';
    const anim = this.controllers[i].pickAttack(stance);
    const timing = anim ? strikeTiming(this.data, anim) : { hitTime: 0.3, duration: 0.5, waistAtHit: 0 };

    const gap = Math.abs(this.homeGap);
    const contact = CONTACT[f.weaponClass];
    let dash = 0, lead = 0;
    if (contact > 0 && !RANGED_STANCES.has(stance)) {
      dash = Math.max(0, Math.min(gap - 60, gap - contact - timing.waistAtHit));
      if (dash > 1) {
        lead = Math.min(LEAD_MAX, dash * LEAD_PER_PX);
        // 缓入缓出：命中前减速贴上去；远距离带一个小跳
        this.motions[i].dashTo(dash, lead + timing.hitTime * 0.75, 'inOut', Math.min(24, dash * 0.04));
      } else dash = 0;
    }
    const hitTime = lead + timing.hitTime;
    const s: Strike = {
      attacker: i, t: 0, animAt: lead, anim, started: false, hitTime, dash, reactions: [], fired: 0,
      returnAt: hitTime + RETURN_DELAY, returned: false,
    };
    if (lead === 0) this.startAnim(s);
    this.strikes.push(s);
    return s;
  }

  private startAnim(s: Strike) {
    s.started = true;
    if (s.anim) this.controllers[s.attacker].playStrike(s.anim);
  }

  private finish(s: Strike) {
    if (!s.started) this.startAnim(s);
    while (s.fired < s.reactions.length) this.react(s.reactions[s.fired++]);
    s.returned = true;
  }

  private react(r: Reaction) {
    if (r.kind === 'hit') {
      this.controllers[r.target].playHit(r.severity);
      this.fb.onImpact(r.target, r.severity);
    } else {
      // 闪避：受方晃身后撤再回来
      this.motions[r.target].swayBy(-36, 0.3);
    }
  }

  /** dt：真实秒；ts：当前动画 timeScale（顿帧时为 0） */
  update(dt: number, ts: number) {
    const adt = dt * ts;
    for (const c of this.controllers) c.tick(adt);
    for (const s of this.strikes) {
      s.t += adt;
      if (!s.started && s.t >= s.animAt) this.startAnim(s);
      while (s.fired < s.reactions.length && s.t >= s.hitTime + s.fired * CHASE_GAP) this.react(s.reactions[s.fired++]);
      if (!s.returned && s.t >= s.returnAt + Math.max(0, s.reactions.length - 1) * CHASE_GAP) {
        this.motions[s.attacker].dashTo(0, 0.22 + s.dash / 2200, 'inOut', 12 + s.dash * 0.02);
        s.returned = true;
      }
    }
    this.strikes = this.strikes.filter((s) => !s.returned || s.fired < s.reactions.length);
    for (const m of this.motions) m.update(adt);

    // 整体回中：镜头同步平移（lastShift），屏幕上只是背景跟着走，角色不会漂
    this.lastShift = 0;
    const off = this.homeMid - ARENA_CENTER;
    if (Math.abs(off) > RECENTER_SLACK) {
      const s = -(off - Math.sign(off) * RECENTER_SLACK) * Math.min(1, dt * RECENTER_RATE);
      for (const m of this.motions) m.shift(s);
      this.lastShift = s;
    }
  }
}
