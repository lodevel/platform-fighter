const MIN_REACTION_FRAMES = 30;
const MAX_REACTION_FRAMES = 80;
const MAX_MAGNIFICATION = 6;
const SPEED_UP_END_RATE = 0.7;

/**
 * Remaining displayed frames for an ordinary reaction-clock value.
 * During acceleration, r' = b + (r - b)q, where b = F(1 - .7) and
 * q = 1 - M/(F - b). After k accelerated steps, the remaining clock is
 * b + (r - b)q^k. Acceleration ends when its next decrement reaches one.
 * Evaluating that recurrence directly would make a full schedule quadratic.
 */
function remainingDisplayedFrames(remaining: number, faf: number, magnitude: number): number {
  const baseline = faf * (1 - SPEED_UP_END_RATE);
  const coefficient = magnitude / (faf - baseline);
  const excess = remaining - baseline;
  const threshold = 1 / coefficient;
  if (excess <= threshold) return remaining;

  const ratio = 1 - coefficient;
  const steps = Math.ceil(Math.log(threshold / excess) / Math.log(ratio));
  return steps + Math.ceil(baseline + excess * ratio ** steps);
}

/**
 * Ordinary trajectory integrations to run in each displayed launch step.
 *
 * `hitstunFrames` is H, before speed-up. The reference timing input is FAF
 * F = H + 1. Tick n=0 is the initial, unaccelerated release integration;
 * ticks n=1..H complete the locked trajectory. Equal elapsed-clock values
 * group those ticks, so the counts sum to H+1 and the result length is the
 * accelerated FAF. The next displayed step is actionable. The release tick
 * may share its displayed step with subsequent ticks; it is never omitted.
 *
 * `eligible` must be false for non-tumble or otherwise unsupported launches
 * (including fixed knockback). Those schedules contain only ones. This
 * helper never accelerates hitlag, other fighters, moves, items or the world.
 * Angles need no input: the reference angle-rate parameter is 100%, making
 * its angle adjustment an identity at every angle.
 *
 * Source: InitDamageSpeedUp, ReactionFrameMulSpeedUp, DamageSpeedUpFrames:
 * https://raw.githubusercontent.com/rubendal/SSBU-Calculator/refs/heads/gh-pages/js/formulas.js
 * FAF caller and displayed FAF/hitstun interpretation: global.js 658-663,
 * 784-789. This uses the timing map, not the visualizer's frame-zero sampling
 * adjustment in GetFrameWithSpeedUp (which merges its first plotted points).
 *
 * O(H) time and space; each eligible group contains one through six ticks.
 * The 10,000-frame input limit bounds allocations from imported move values.
 * Callers can retain ordinary timing for unsupported, longer custom launches.
 */
export function getReferenceDamageSpeedUpGroups(
  hitstunFrames: number,
  eligible: boolean,
): readonly number[] {
  if (!Number.isInteger(hitstunFrames) || hitstunFrames < 0 || hitstunFrames > 10000) {
    throw new RangeError('Reference hitstun must be an integer from 0 through 10000');
  }
  const faf = hitstunFrames + 1;
  const magnitude = 1 + (MAX_MAGNIFICATION - 1)
    * Math.min(1, Math.max(0, (faf - MIN_REACTION_FRAMES)
      / (MAX_REACTION_FRAMES - MIN_REACTION_FRAMES)));
  if (!eligible || magnitude === 1) return Object.freeze(Array<number>(faf).fill(1));

  const displayedFaf = remainingDisplayedFrames(faf, faf, magnitude);
  const groups = Array<number>(displayedFaf).fill(0);
  for (let tick = 0; tick < faf; tick++) {
    const displayedStep = displayedFaf - remainingDisplayedFrames(faf - tick, faf, magnitude);
    groups[displayedStep]! += 1;
  }
  return Object.freeze(groups);
}
