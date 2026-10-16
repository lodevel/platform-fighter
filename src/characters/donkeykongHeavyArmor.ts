/**
 * DK SuperLift ordinary-reference armor classification adapter.
 *
 * Native carry callbacks compare calc_reaction_frame(reaction_max_) strictly
 * with battle_object.damage_level3 (32), excluding sleep and sleep_ex.
 * Original armor research independently lists DK lifting at 80KB. The KB*.4
 * proxy below is an explicit classification calibration, not a recovered
 * native reaction-frame function. Never supply playable/accelerated hitstun.
 *
 * Source and consumer limits:
 * docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/
 * heavy-armor-reaction-conversion-proposal.json
 */
export const DONKEYKONG_HEAVY_ARMOR_REACTION_THRESHOLD = 32;
export const DONKEYKONG_HEAVY_ARMOR_REFERENCE_PROXY_SCALE = 0.4;

/** Bounded source-proven attributes, eligible only with explicit false native
 * force-reaction metadata. Carry checks exclude the two sleep attributes;
 * ordinary electric/rush/bury packets and research rules are pinned separately. */
export const DONKEYKONG_HEAVY_ARMOR_SUPPORTED_ATTRIBUTES = Object.freeze([
  'collision_attr_normal', 'collision_attr_elec', 'collision_attr_rush', 'collision_attr_bury',
] as const);

export interface DonkeyKongReferenceCarryDamageInput {
  /** Held item plus actual source carry state, excluding pickup/throw actions. */
  readonly sourceCarryActive: boolean;
  /** Final modified reference KB, before status/launch/clock transformations.
   * Bury uses the published native weight100 query; do not pass ordinary DK126
   * KB simply because the selected attack has setWeight:false. */
  readonly referenceKnockback?: number;
  /** Original native attribute; absence is not silently interpreted as normal. */
  readonly nativeCollisionAttribute?: string;
  /** Native per-hit force-reaction metadata: true bypasses resistance, false
   * allows classification, omitted is unknown and must not silently become false. */
  readonly nativeForceReaction?: boolean;
}

export type DonkeyKongReferenceCarryDamageDecision =
  | { readonly kind: 'inactive' }
  | { readonly kind: 'unsupported'; readonly reason:
      'missing-reference-knockback' | 'invalid-reference-knockback' | 'unknown-native-attribute' | 'unknown-force-reaction' }
  | { readonly kind: 'resist'; readonly referenceReactionProxy: number }
  | { readonly kind: 'launch'; readonly referenceReactionProxy: number;
      readonly reason: 'threshold' | 'sleep' | 'forced-reaction' };

/** Pure preview only: caller owns damage, hitlag, confirmation and inventory.
 * Unsupported inputs retain the caller's ordinary authored damage path. */
export function classifyDonkeyKongReferenceCarryDamage(
  input: DonkeyKongReferenceCarryDamageInput,
): DonkeyKongReferenceCarryDamageDecision {
  if (!input.sourceCarryActive) return { kind: 'inactive' };
  const kb = input.referenceKnockback;
  if (kb === undefined) return { kind: 'unsupported', reason: 'missing-reference-knockback' };
  if (!Number.isFinite(kb) || kb < 0)
    return { kind: 'unsupported', reason: 'invalid-reference-knockback' };

  const attribute = input.nativeCollisionAttribute;
  const sleep = attribute === 'collision_attr_sleep' || attribute === 'collision_attr_sleep_ex';
  if (!sleep && !DONKEYKONG_HEAVY_ARMOR_SUPPORTED_ATTRIBUTES.some(known => known === attribute))
    return { kind: 'unsupported', reason: 'unknown-native-attribute' };

  const referenceReactionProxy = kb * DONKEYKONG_HEAVY_ARMOR_REFERENCE_PROXY_SCALE;
  if (sleep) return { kind: 'launch', referenceReactionProxy, reason: 'sleep' };
  if (input.nativeForceReaction === undefined)
    return { kind: 'unsupported', reason: 'unknown-force-reaction' };
  if (input.nativeForceReaction)
    return { kind: 'launch', referenceReactionProxy, reason: 'forced-reaction' };
  return referenceReactionProxy < DONKEYKONG_HEAVY_ARMOR_REACTION_THRESHOLD
    ? { kind: 'resist', referenceReactionProxy }
    : { kind: 'launch', referenceReactionProxy, reason: 'threshold' };
}
