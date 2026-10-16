/**
 * Link's published Ultimate Frame Data movement values, in native game units.
 * Source: https://ultimateframedata.com/stats (checked 2026-09-23).
 * Keep measurements separate from the engine's pixel conversion and tuning.
 * This is a movement reference, not a complete model of Smash's physics.
 */
export const LINK_UFD_STATS = Object.freeze({
  source: 'https://ultimateframedata.com/stats',
  checkedOn: '2026-09-23',
  walkSpeed: 1.247,
  initialDashSpeed: 1.98,
  runSpeed: 1.534,
  dashFrames: 12,
  pivotDashFrames: 14,
  airAccelerationBase: 0.01,
  airAccelerationAdditional: 0.04,
  airAccelerationMax: 0.05,
  airSpeed: 0.924,
  gravity: 0.096,
  fallSpeed: 1.6,
  fastFallSpeed: 3.04,
  fullHopHeight: 27.8,
  shortHopHeight: 13.38,
  airJumpHeight: 29,
  fullHopFrames: 45,
  shortHopFrames: 33,
  fastFallFullHopFrames: 30,
  fastFallShortHopFrames: 22,
  weight: 104,
  hardLandingFrames: 5,
  softLandingFrames: 2,
});

/** Project world scale; UFD speeds use distance per 60 Hz simulation frame. */
export const LINK_REFERENCE_PIXELS_PER_UNIT = 5;
