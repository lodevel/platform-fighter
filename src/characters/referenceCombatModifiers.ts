import { computeRageMultiplier, scaleKnockbackSpec, type HitInfo } from './combat';
import { isFixedReferenceKnockback } from './referenceKnockback';

/** Apply one attack's cached stale snapshot before the victim accumulates damage.
 * Ordinary reference growth uses 30% of the stale penalty in computeKnockback;
 * scaling the whole launch by staleness would incorrectly reduce base KB too.
 * Legacy vector launches retain their explicit linear stale approximation.
 */
export function applyCombatModifiers(hit: HitInfo, attackerPercent: number, stale: number): HitInfo {
  const baseDamage = hit.baseDamage ?? hit.damage;
  const rage = computeRageMultiplier(attackerPercent);
  const scale = isFixedReferenceKnockback(hit.knockback.reference) ? 1
    : rage * (hit.knockback.reference ? 1 : stale);
  return { ...hit, baseDamage, staleMultiplier: stale, damage: baseDamage * stale * (hit.appliedDamageMultiplier ?? 1),
    knockback: scale === 1 ? hit.knockback : scaleKnockbackSpec(hit.knockback, scale) };
}
