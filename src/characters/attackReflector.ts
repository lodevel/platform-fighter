/**
 * The one read of "is this attack reflecting projectiles right now?", used by
 * every projectile path (MatchScene projectiles, Pikachu special entities).
 * Two producers: a reflector side special (its active phase) and a move's
 * {@link AttackReflectWindow} (e.g. the Home-Run Bat forward smash).
 */
import type { ActiveAttack, AttackMove } from './attacks';
import { isReflectorSideSpecial } from './sideSpecialSchema';

export interface ActiveReflector {
  readonly body: { readonly offsetX: number; readonly offsetY: number; readonly width: number; readonly height: number };
  readonly damageScale: number;
  readonly velocityScale: number;
  readonly swingOnReflect: boolean;
}

export function activeReflector(
  attack: { readonly move: AttackMove; readonly phase: ActiveAttack['phase']; readonly framesElapsed: number } | null,
): ActiveReflector | null {
  if (!attack) return null;
  const { move } = attack;
  if (isReflectorSideSpecial(move)) {
    return attack.phase === 'active' ? { body: move.reflector.reflectorBody, damageScale: move.reflector.reflectMultiplier,
      velocityScale: move.reflector.velocityScale, swingOnReflect: false } : null;
  }
  const w = move.reflectWindow;
  if (!w || attack.framesElapsed < w.startFrame || attack.framesElapsed >= w.endFrame) return null;
  return { body: w.body, damageScale: w.damageMultiplier, velocityScale: w.speedMultiplier, swingOnReflect: w.swingOnReflect === true };
}
