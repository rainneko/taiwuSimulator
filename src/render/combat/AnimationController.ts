import type { spine } from '../spine-webgl-3.8';
import type { FighterState, StanceType } from '../../core/combat';
import type { SpineActor } from './SpineActor';
import { hitAnim, IDLE_ANIM, normalAttackAnim, WEAPON_ATTACHMENTS, type SkillAnimTable } from './animMapping';

/** 出手动画切入的混合时长：比默认短，减少"滑过去"的观感 */
const ATTACK_MIX = 0.08;
/** 同一角色两次受击动画的最短间隔（秒）；更密的追击只白闪不重播 */
const HIT_REPLAY_GAP = 0.18;

/**
 * 一个角色的动画选择：出手 A_、招式 S_、受击 H_、待机 C_000。
 * 什么时候播由 CombatDirector 决定（它把核心事件对齐到动画时间轴上）。
 */
export class AnimationController {
  private variant = 0;
  private weaponClass = '';
  private sinceHit = Infinity;

  constructor(
    readonly actorId: string,
    readonly actor: SpineActor,
    private skills: SkillAnimTable = {},
  ) {
    actor.playAnimation(IDLE_ANIM, true);
    actor.animationState.addListener({
      complete: (entry: spine.TrackEntry) => {
        // 3.8 对正在混出的旧动画也会发 complete；只认当前动画，否则会把刚开始的出手顶回待机
        if (actor.animationState.getCurrent(entry.trackIndex) !== entry) return;
        if (!entry.loop && entry.next == null) actor.playAnimation(IDLE_ANIM, true);
      },
    } as never);
  }

  /** 每帧同步与状态相关的外观（武器挂件）。 */
  sync(f: FighterState) {
    if (f.weaponClass !== this.weaponClass) {
      this.weaponClass = f.weaponClass;
      const w = WEAPON_ATTACHMENTS[f.weaponClass];
      this.actor.setWeapon('Weapons_R', w.R);
      this.actor.setWeapon('Weapons_L', w.L);
    }
  }

  tick(dt: number) { this.sinceHit += dt; }

  /** 当前 track 0 动画名 */
  get current(): string {
    return this.actor.animationState.getCurrent(0)?.animation?.name ?? '';
  }

  /** 正在播出手/招式动作（受击时不打断它） */
  get busy(): boolean {
    const e = this.actor.animationState.getCurrent(0);
    if (!e || e.loop) return false;
    const n = e.animation.name;
    return (n.startsWith('A_') || n.startsWith('S_')) && e.trackTime < e.animationEnd;
  }

  /** 普攻：挑一个存在的 A_ 动画名（不播放） */
  pickAttack(stance: StanceType): string | null {
    const v = this.variant++;
    for (const name of [normalAttackAnim(stance, v), normalAttackAnim('crash', v)]) {
      if (this.actor.hasAnimation(name)) return name;
    }
    return null;
  }

  /** 播放出手动作 */
  playStrike(name: string) {
    const e = this.actor.playAnimation(name);
    if (e) e.mixDuration = ATTACK_MIX;
  }

  playSkill(skillId: string): string | null {
    const name = this.skills[skillId]?.skill_anim;
    if (!name) return null;
    const e = this.actor.playAnimation(name);
    if (e) e.mixDuration = ATTACK_MIX;
    return e ? name : null;
  }

  /** 受击：出手中或刚播过受击时不换动作，返回是否播了 H_ */
  playHit(severity: 1 | 2 | 3): boolean {
    if (this.busy || this.sinceHit < HIT_REPLAY_GAP) return false;
    this.sinceHit = 0;
    return !!this.actor.playAnimation(hitAnim(severity, this.variant++));
  }

  playDefeat() {
    this.actor.playAnimation('H_006');
  }
}
