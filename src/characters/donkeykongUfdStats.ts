/**
 * Donkey Kong — native Super Smash Bros. Ultimate movement statistics.
 *
 * Source: https://ultimateframedata.com/stats (checked 2026-09-25), the
 * "Donkey Kong" rows of each table. Values are Ultimate distance units per
 * frame (speeds), units (heights), frames (durations) or the raw weight.
 * `DONKEYKONG_MOVEMENT_PROFILE` converts them to world pixels at
 * {@link DONKEYKONG_REFERENCE_PIXELS_PER_UNIT}; nothing here is converted.
 *
 * Evidence record: docs/review/2026-09-25/donkeykong-character/README.md
 * (sources/ufd-stats.json holds the captured table rows).
 */
export const DONKEYKONG_UFD_STATS = Object.freeze({
  source: 'https://ultimateframedata.com/stats',
  checkedOn: '2026-09-25',
  // Walk Speed table.
  walkSpeed: 1.365,
  // Dash and Run Speed table.
  initialDashSpeed: 2.09,
  runSpeed: 1.873,
  dashFrames: 15,
  pivotDashFrames: 17,
  // Air Acceleration table (base + additional = max).
  airAccelerationBase: 0.01,
  airAccelerationAdditional: 0.05,
  airAccelerationMax: 0.06,
  // Air Speed table.
  airSpeed: 1.208,
  // Gravity and Fall Speed tables.
  gravity: 0.085,
  fallSpeed: 1.63,
  fastFallSpeed: 2.608,
  // Jump Height table.
  fullHopHeight: 34,
  shortHopHeight: 17.3,
  airJumpHeight: 35.5,
  // Jump Durations table (frames airborne).
  fullHopFrames: 53,
  shortHopFrames: 40,
  fastFallFullHopFrames: 37,
  fastFallShortHopFrames: 27,
  // Weight table.
  weight: 127,
  // Landing table: "DK 5 2" (hard / soft). SmashWiki attribute ellag = 5
  // ("Empty landing lag") agrees. Soft landing is the universal 2.
  hardLandingFrames: 5,
  softLandingFrames: 2,
  // Grab Range table (units).
  grabRange: 19.5,
});

/** Five world pixels per Ultimate distance unit — the project-wide contract. */
export const DONKEYKONG_REFERENCE_PIXELS_PER_UNIT = 5;
