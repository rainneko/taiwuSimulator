import type { CombatState, FighterState, MovementArtData } from './types';
import { addBodyMovementPoints } from './distance';
import { pushMod } from './stats';

export function canCastMovementArt(f: FighterState, art: MovementArtData): boolean {
  return f.castPhase === 'none' && f.movementPoints + f.bodyMovementPoints >= art.mobilityCost;
}

/** 身法出手：先扣身法移动力再扣白色移动力；赋予身法移动力（上限 6）与移速/移距加成 */
export function resolveMovementArt(state: CombatState, f: FighterState, art: MovementArtData): void {
  let cost = art.mobilityCost;
  const fromSkill = Math.min(f.bodyMovementPoints, cost);
  f.bodyMovementPoints -= fromSkill;
  cost -= fromSkill;
  f.movementPoints = Math.max(0, f.movementPoints - cost);

  addBodyMovementPoints(f, art.grant.count);
  f.bodyMovementDecayInterval = art.grant.decayFrames;
  const dur = art.grant.decayFrames * art.grant.count;
  pushMod(f, 'moveSpeedPermille', art.moveSpeed - 1000, dur, 'movementArt');
  pushMod(f, 'moveStepPermille', art.moveStep - 1000, dur, 'movementArt');
  state.events.emit('movementArt', { actorId: f.id, skillId: art.id });
}
