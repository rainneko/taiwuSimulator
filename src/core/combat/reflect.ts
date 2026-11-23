import type { CombatState, FighterState } from './types';
import { applyDirectDamage } from './damage';
import { hasMod } from './stats';

/**
 * 绝技反震：守方护体绝技带反震且守御已破 → 攻方受到 最终伤势 × 反震倍率。
 * 常规反震（特效 'normalReflect'）：普攻 60% / 功法 30% 的常规伤害。
 * 反震伤害本身不再触发反震。
 */
export function resolveReflect(
  state: CombatState, def: FighterState, atk: FighterState, finalDamage: { outer: number; inner: number },
  source: 'attack' | 'technique' = 'attack',
): void {
  let outer = 0, inner = 0;
  if (def.guardSkillPhase === 'active' && def.guardSkillId && def.guardBroken) {
    const skill = state.arts.guardSkills[def.guardSkillId];
    if (skill?.reflect) {
      outer += Math.floor(finalDamage.outer * skill.reflect.outer / 1000);
      inner += Math.floor(finalDamage.inner * skill.reflect.inner / 1000);
    }
  }
  if (hasMod(def, 'normalReflect')) {
    const ratio = source === 'attack' ? 600 : 300;
    outer += Math.floor(finalDamage.outer * ratio / 1000);
    inner += Math.floor(finalDamage.inner * ratio / 1000);
  }
  if (outer <= 0 && inner <= 0) return;
  applyDirectDamage(state, atk, { outer, inner });
  state.events.emit('reflect', { actorId: def.id, targetId: atk.id, outer, inner });
}
