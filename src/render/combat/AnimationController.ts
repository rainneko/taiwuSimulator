import type { spine } from '../spine-webgl-3.8';
import type { CombatEvent, FighterState } from '../../core/combat';
import type { SpineActor } from './SpineActor';
import { hitAnim, IDLE_ANIM, normalAttackAnim, WEAPON_ATTACHMENTS, type SkillAnimTable } from './animMapping';

export interface AnimFeedback {
  /** 受击：程度 1-3，由渲染层决定顿帧 / 白闪 / 震屏 */
  onHit?: (target: SpineActor, severity: 1 | 2 | 3) => void;
  /** 摧破终结（第 4 段）：慢放 */
  onFinisher?: () => void;
  /** Spine 动画自带的 act0-6 / hit 事件 */
  onSpineEvent?: (actor: SpineActor, name: string) => void;
}

/**
 * CombatEvent → Spine 动画。一个 controller 管一个角色；事件按 actorId 分发给对应 controller。
 */
export class AnimationController {
  private variant = 0;
  private weaponClass = '';

  constructor(
    readonly actorId: string,
    readonly actor: SpineActor,
    private skills: SkillAnimTable = {},
    private fb: AnimFeedback = {},
  ) {
    actor.playAnimation(IDLE_ANIM, true);
    actor.animationState.addListener({
      event: (_entry: spine.TrackEntry, ev: spine.Event) => fb.onSpineEvent?.(actor, ev.data.name),
      complete: (entry: spine.TrackEntry) => {
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

  handleEvent(ev: CombatEvent, self: FighterState) {
    const v = this.variant++;
    switch (ev.type) {
      case 'attackStart': {
        if (ev.payload.actorId !== this.actorId) return;
        const stance = self.wheelSlots[self.wheelIndex] ?? 'chop';
        this.actor.playAnimation(normalAttackAnim(stance, v)) ?? this.actor.playAnimation(normalAttackAnim('crash', v));
        return;
      }
      case 'techniqueCastStart': {
        if (ev.payload.actorId !== this.actorId) return;
        const s = this.skills[ev.payload.skillId];
        if (s?.skill_anim) this.actor.playAnimation(s.skill_anim);
        return;
      }
      case 'techniqueStage':
        if (ev.payload.actorId === this.actorId && ev.payload.stage === 4) this.fb.onFinisher?.();
        return;
      case 'hit': {
        if (ev.payload.targetId !== this.actorId) return;
        this.actor.playAnimation(hitAnim(ev.payload.severity, v));
        this.fb.onHit?.(this.actor, ev.payload.severity);
        return;
      }
      case 'end':
        if (ev.payload.winnerId && ev.payload.winnerId !== this.actorId) this.actor.playAnimation('H_006');
        return;
      default:
        return;
    }
  }
}
