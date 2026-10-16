import type { TauntSet } from './tauntSchema';

/** All six native DK appeal motions have human FAF50→action age49.
 * Source resource extents79/69/59 provide80/70/60 drawing samples. Source
 * one-native-sample per project step is explicit presentation calibration;
 * continued taunt drawing never adds control commitment after49.
 * Evidence: mechanics/taunt-native-clip-extents.json and native motion-list.
 */
export const DONKEYKONG_TAUNTS: TauntSet = Object.freeze({
  up: Object.freeze({ cancelAfterFrames: 49, presentationFrames: 80 }),
  side: Object.freeze({ cancelAfterFrames: 49, presentationFrames: 70 }),
  down: Object.freeze({ cancelAfterFrames: 49, presentationFrames: 60 }),
});
