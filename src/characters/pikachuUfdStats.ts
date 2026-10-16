/** Ultimate movement/defense reference, checked against the retained UFD captures.
 * Distance is native game units per 60 Hz frame; rendered geometry uses 5 px/unit.
 * Native calculator landing1/3 disagrees with UFD2/4. UFD is selected here;
 * this choice does not establish exact native landing clocks.
 */
export const PIKACHU_UFD_STATS = Object.freeze({
  source: 'https://ultimateframedata.com/stats',
  characterSource: 'https://ultimateframedata.com/pikachu',
  checkedOn: '2026-10-08',
  walkSpeed: 1.302, initialDashSpeed: 1.98, runSpeed: 2.039,
  dashFrames: 13, pivotDashFrames: 15,
  airAccelerationBase: 0.01, airAccelerationAdditional: 0.09,
  airAccelerationMax: 0.1, airSpeed: 0.957,
  gravity: 0.095, fallSpeed: 1.55, fastFallSpeed: 2.48,
  fullHopHeight: 35.5, shortHopHeight: 17.12, airJumpHeight: 35.5,
  fullHopFrames: 53, shortHopFrames: 38,
  fastFallFullHopFrames: 37, fastFallShortHopFrames: 26,
  weight: 79, softLandingFrames: 2, hardLandingFrames: 4,
});
export const PIKACHU_REFERENCE_PIXELS_PER_UNIT = 5;
