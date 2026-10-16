import type { Character } from '../characters/Character';

export interface ChargeReadout { readonly progress: number; readonly label: string }

/** Presentation only: show actual held/stored charge, never an ordinary attack's startup. */
export function selectChargeReadout(character: Character): ChargeReadout | null {
  const shooting = character.getItemShootingState();
  const scope = character.getEquippedItem()?.definition.shooting;
  if (shooting && scope?.kind === 'scope') {
    if (shooting.phase === 'start') return { progress: 0, label: 'SCOPE · LOADING' };
    if (shooting.phase !== 'wait') return null;
    const progress = Math.min(1, shooting.charge / scope.chargeFrames);
    const lowAmmo = (character.getEquippedItem()?.getAmmo() ?? Infinity) < scope.stages.at(-1)!.cost;
    return { progress, label: `SCOPE · ${progress >= 1 ? 'FULL' : `${Math.floor(progress * 100)}%`}${lowAmmo ? ' · LOW AMMO' : ''}` };
  }
  const intrinsic=character.getIntrinsicChargeReadout();if(intrinsic)return intrinsic;
  const action = character.getAnimationActionState();
  const progress = character.getChargeProgress();
  if (progress === null) return null;
  if (!action.chargingMove) {
    // Banked charge persists at rest; a transient attack startup isn't a charge.
    return character.getActiveAttack() === null
      ? { progress, label: `STORED · ${progress >= 1 ? 'FULL' : `${Math.floor(progress * 100)}%`}` } : null;
  }
  const move = action.chargingMove;
  const name = move.pikachuSpecial?.kind === 'skullBash' ? 'SKULL BASH'
    : move.type === 'smash' ? 'SMASH' : character.id === 'donkeykong' ? 'PUNCH' : 'CHARGE';
  return { progress, label: `${name} · ${progress >= 1 ? 'FULL' : `${Math.floor(progress * 100)}%`}` };
}
