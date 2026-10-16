import type { TauntSet } from './tauntSchema';

/** Pinned motion-list cancel50 is human FAF: zero-based action age49 permits
 * interruption. The selected resource endings77/70/74 use an explicit beta
 * one-native-step per simulation-step presentation through last index+1;
 * those endpoints add no control lock after cancel49.
 * Source: sources/state-runtime-clock-contract.json and taunt-runtime contract.
 */
export const PIKACHU_TAUNTS: TauntSet = Object.freeze({
  up: Object.freeze({ cancelAfterFrames: 49, presentationFrames: 78 }),
  side: Object.freeze({ cancelAfterFrames: 49, presentationFrames: 71 }),
  down: Object.freeze({ cancelAfterFrames: 49, presentationFrames: 75 }),
});
