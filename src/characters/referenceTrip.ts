/** Published Ultimate attack-trip rules; native PRNG and status kinetics are
 * separate from this deterministic engine's injected match stream. */
export function referenceTripProbability(input: {
  tripChance: number | undefined; grounded: boolean; alreadyTripped: boolean;
  verticalVelocity: number; referenceKnockback: number | undefined;
}): number {
  if (input.tripChance === undefined || !Number.isFinite(input.tripChance) ||
    input.tripChance < 0 || input.tripChance > 1 || !input.grounded || input.alreadyTripped ||
    input.verticalVelocity < -1e-9) return 0;
  const bonus = input.tripChance;
  // Published base chance applies above55 KB, or at any KB when a move has
  // an additive trip bonus. Angles that lift a target reject either chance.
  return bonus > 0 || (input.referenceKnockback ?? 0) > 55
    ? Math.min(1, bonus + 0.07) : 0;
}
