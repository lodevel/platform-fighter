import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ITEM_CATCH_WINDOWS, canCatchItem, EMPTY_ITEM_REPEAT_RULES, noteAerialItemThrowEnd,
  noteItemZDrop, tickItemRepeatRules, canRepeatAerialItemThrow,
  canActAfterItemZDrop, canRecatchItem } from './itemCatch';

describe('shared item catches and repeat locks', () => {
  it('pins the experimental catch window table; SmashWiki 5-frame aerial/dash/air-dodge and 2-frame tilt windows win', () => {
    const raw = JSON.parse(readFileSync('docs/review/2026-09-25/donkeykong-character/completion-2026-10-08/mechanics/sources/research-native-item-catch-web.json', 'utf8'));
    const capture = JSON.stringify(raw.capture);
    expect(capture).toContain('1F目のみ');
    expect(capture).toContain('1-4F');
    expect(capture).toContain('1-5F');
    expect(ITEM_CATCH_WINDOWS).toEqual({ standing: 1, walking: 1, 'dash-attack': 5, tilt: 2,
      'air-stationary': 1, aerial: 5, 'air-dodge': 5 });
  });
  it('enforces every startup boundary, situation and held/heavy/acquisition gate', () => {
    for (const [context, window] of Object.entries(ITEM_CATCH_WINDOWS)) {
      const input = { context: context as keyof typeof ITEM_CATCH_WINDOWS,
        airborne: ['air-stationary', 'aerial', 'air-dodge'].includes(context), holdingItem: false, holdable: true,
        pickupRectanglesOverlap: true, age: window - 1 };
      expect(canCatchItem(input), context).toBe(true);
      for (const age of [-1, window, .5, NaN]) expect(canCatchItem({ ...input, age }), context).toBe(false);
      expect(canCatchItem({ ...input, airborne: !input.airborne })).toBe(false);
      expect(canCatchItem({ ...input, holdingItem: true })).toBe(false);
      expect(canCatchItem({ ...input, holdable: false })).toBe(false);
      expect(canCatchItem({ ...input, externallyBlocked: true })).toBe(false);
      expect(canCatchItem({ ...input, pickupRectanglesOverlap: false })).toBe(false);
      if (input.airborne) expect(canCatchItem({ ...input, heavy: true })).toBe(false);
    }
  });
  it('starts the seven-step rethrow wait at completed action exit and freezes it', () => {
    let state = noteAerialItemThrowEnd(EMPTY_ITEM_REPEAT_RULES);
    expect(tickItemRepeatRules(state, { frozen: true })).toBe(state);
    for (let age = 0; age < 7; age++) {
      expect(canRepeatAerialItemThrow(state), `age${age}`).toBe(false);
      state = tickItemRepeatRules(state);
    }
    expect(canRepeatAerialItemThrow(state)).toBe(true);
  });
  it('keeps one-step Z-drop action gap independent of observed separation and item identity', () => {
    let state = noteItemZDrop(EMPTY_ITEM_REPEAT_RULES, 'bat');
    expect(canActAfterItemZDrop(state)).toBe(false);
    expect(canRecatchItem(state, 'bat')).toBe(false);
    expect(canRecatchItem(state, 'beamSword')).toBe(true);
    state = tickItemRepeatRules(state);
    expect(canActAfterItemZDrop(state)).toBe(true);
    for (let i = 0; i < 50; i++) state = tickItemRepeatRules(state);
    expect(canRecatchItem(state, 'bat')).toBe(false);
    state = noteItemZDrop(state, 'beamSword');
    state = tickItemRepeatRules(state, { separatedItemIds: ['bat'] });
    expect(canRecatchItem(state, 'bat')).toBe(true);
    expect(canRecatchItem(state, 'beamSword')).toBe(false);
    state = tickItemRepeatRules(state, { frozen: true, separatedItemIds: ['beamSword'] });
    expect(canRecatchItem(state, 'beamSword')).toBe(false);
  });
});
