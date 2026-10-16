/** Item catches and repeat-action rules, shared by every fighter (Ultimate items, phase 2).
 * SmashWiki Item (https://www.ssbwiki.com/Item) sets the action windows: "during the start of air
 * dodges, dash attacks, and aerial attacks, with a window of 5 frames for each ... In Ultimate, this is
 * further expanded to tilt attacks, though with a shorter window of 2 frames." Light items are caught
 * in midair with the grab button (`pickup.aerialPickup`); heavy items never in midair. The original
 * experimental research (DK record, pages 97/98) supplies the standing/walking/air single-step windows,
 * the seven-step aerial rethrow delay and the Z-drop separation lock; its aerial 4 loses to SmashWiki's 5.
 */
export type ItemCatchContext = 'standing' | 'walking' | 'dash-attack' | 'tilt' | 'air-stationary' | 'aerial' | 'air-dodge';
export const ITEM_CATCH_WINDOWS: Readonly<Record<ItemCatchContext, number>> = Object.freeze({
  standing: 1, walking: 1, 'dash-attack': 5, tilt: 2, 'air-stationary': 1, aerial: 5, 'air-dodge': 5,
});
export function canCatchItem(input: {
  readonly context: ItemCatchContext; readonly age: number; readonly airborne: boolean;
  readonly holdingItem: boolean; readonly holdable: boolean; readonly heavy?: boolean;
  readonly externallyBlocked?: boolean; readonly pickupRectanglesOverlap: boolean;
}): boolean {
  if (input.holdingItem || !input.holdable || input.externallyBlocked || !input.pickupRectanglesOverlap) return false;
  const airContext = input.context === 'air-stationary' || input.context === 'aerial' || input.context === 'air-dodge';
  if (airContext !== input.airborne || (input.airborne && input.heavy)) return false;
  return Number.isInteger(input.age) && input.age >= 0 && input.age < ITEM_CATCH_WINDOWS[input.context];
}

export interface ItemRepeatRules {
  readonly aerialRethrowRemaining: number;
  readonly zDropActionGapRemaining: number;
  /** Identity locks survive catching a different item; each dropped item must separate. */
  readonly unseparatedZDrops: readonly string[];
}
export const EMPTY_ITEM_REPEAT_RULES: ItemRepeatRules = Object.freeze({
  aerialRethrowRemaining: 0, zDropActionGapRemaining: 0, unseparatedZDrops: Object.freeze([]),
});
/** Call at the completed directional aerial throw's exit, not its release frame. */
export function noteAerialItemThrowEnd(state: ItemRepeatRules): ItemRepeatRules {
  return { ...state, aerialRethrowRemaining: 7 };
}
export function noteItemZDrop(state: ItemRepeatRules, itemId: string): ItemRepeatRules {
  return { ...state, zDropActionGapRemaining: 1,
    unseparatedZDrops: state.unseparatedZDrops.includes(itemId) ? state.unseparatedZDrops : [...state.unseparatedZDrops, itemId] };
}
/** Frozen clocks pause. A lock clears only after an actual sampled separation of the pickup
 * rectangles (explicit 2D adapter: the research does not retain the native re-catch predicate). */
export function tickItemRepeatRules(state: ItemRepeatRules, input: {
  readonly frozen?: boolean; readonly separatedItemIds?: readonly string[];
} = {}): ItemRepeatRules {
  if (input.frozen) return state;
  return { aerialRethrowRemaining: Math.max(0, state.aerialRethrowRemaining - 1),
    zDropActionGapRemaining: Math.max(0, state.zDropActionGapRemaining - 1),
    unseparatedZDrops: state.unseparatedZDrops.filter(id => !input.separatedItemIds?.includes(id)) };
}
export function canRepeatAerialItemThrow(state: ItemRepeatRules): boolean {
  return state.aerialRethrowRemaining === 0;
}
export function canActAfterItemZDrop(state: ItemRepeatRules): boolean {
  return state.zDropActionGapRemaining === 0;
}
export function canRecatchItem(state: ItemRepeatRules, itemId: string): boolean {
  return !state.unseparatedZDrops.includes(itemId);
}
