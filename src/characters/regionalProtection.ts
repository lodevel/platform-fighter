import type { AttackMove } from './attacks';
import type { Hurtbox } from './moveSchema';

/** Protect only declared anatomical regions. Unnamed/default body regions
 * stay vulnerable; armour and whole-fighter invincibility are separate. */
export function applyRegionalProtection(hurtboxes: readonly Hurtbox[], move: Pick<AttackMove, 'protectionWindows'> | null, elapsed: number): readonly Hurtbox[] {
  if (!move?.protectionWindows?.length) return hurtboxes;
  const regions = new Set(move.protectionWindows.filter(window => elapsed >= window.startFrame && elapsed < window.endFrame)
    .flatMap(window => [...window.regions]));
  if (!regions.size) return hurtboxes;
  return hurtboxes.map(hurtbox => regions.has('*') || hurtbox.region && regions.has(hurtbox.region)
    ? { ...hurtbox, intangible: true } : hurtbox);
}
