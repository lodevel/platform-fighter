import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HAND_CURSOR_STATE,
  HOVERED_TARGET_NONE,
  SLOT_MODE_CYCLE_ORDER,
  buildPlayerSlotsFromHandCursor,
  cycleSlotMode,
  cycleSlotPalette,
  moveHand,
  nextFreePaletteIndex,
  selectAtCursor,
  setHandPosition,
  setHoveredTarget,
  setSlotAiDifficulty,
  setSlotInputType,
  setSlotMode,
  setSlotPalette,
  toCharacterSelectState,
  unselectSlot,
  type HandCursorBounds,
  type HandCursorState,
} from './handCursorState';
import {
  PALETTE_COUNT,
  MAX_PLAYER_SLOTS,
  SELECTABLE_CHARACTER_SPECS,
} from './characterSelect';

const BOUNDS: HandCursorBounds = Object.freeze({
  minX: 0,
  maxX: 100,
  minY: 0,
  maxY: 100,
});

function withSlotPicked(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  characterId: string,
  paletteIndex: number,
): HandCursorState {
  const portraitIndex = SELECTABLE_CHARACTER_SPECS.findIndex(
    (s) => s.id === characterId,
  );
  expect(portraitIndex).toBeGreaterThanOrEqual(0);
  let s = setHoveredTarget(state, slotIndex, {
    kind: 'portrait',
    portraitIndex,
  });
  s = setSlotPalette(s, slotIndex, paletteIndex);
  s = selectAtCursor(s, slotIndex);
  return s;
}

describe('DEFAULT_HAND_CURSOR_STATE', () => {
  it('opens with 4 empty slots in slot order', () => {
    expect(DEFAULT_HAND_CURSOR_STATE.slots.length).toBe(MAX_PLAYER_SLOTS);
    DEFAULT_HAND_CURSOR_STATE.slots.forEach((slot, i) => {
      expect(slot.index).toBe((i + 1) as 1 | 2 | 3 | 4);
      expect(slot.mode).toBe('empty');
      expect(slot.pickedCharacterId).toBeNull();
      expect(slot.hovered).toEqual({ kind: 'none' });
      expect(slot.cursor).toEqual({ x: 0, y: 0 });
    });
  });

  it('seeds distinct default palettes (0..3) per slot so a default lineup is visually distinct', () => {
    const palettes = DEFAULT_HAND_CURSOR_STATE.slots.map((s) => s.paletteIndex);
    expect(palettes).toEqual([0, 1, 2, 3]);
  });

  it('seeds slot-keyed default inputType (P1 keyboard, P2 keyboard, gamepad fallback)', () => {
    const inputs = DEFAULT_HAND_CURSOR_STATE.slots.map((s) => s.inputType);
    expect(inputs).toEqual(['keyboard_p1', 'keyboard_p2', 'gamepad', 'gamepad']);
  });

  it('is deeply frozen', () => {
    expect(Object.isFrozen(DEFAULT_HAND_CURSOR_STATE)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HAND_CURSOR_STATE.slots)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HAND_CURSOR_STATE.slots[0])).toBe(true);
  });
});

describe('moveHand / setHandPosition — cursor coords + clamp', () => {
  it('clamps movement past the upper bound', () => {
    const next = moveHand(DEFAULT_HAND_CURSOR_STATE, 1, 999, 999, BOUNDS);
    expect(next.slots[0]?.cursor).toEqual({ x: 100, y: 100 });
  });

  it('clamps movement past the lower bound', () => {
    const next = moveHand(DEFAULT_HAND_CURSOR_STATE, 1, -50, -50, BOUNDS);
    expect(next.slots[0]?.cursor).toEqual({ x: 0, y: 0 });
  });

  it('returns the same state ref when movement is a no-op (already at clamp edge)', () => {
    const start = setHandPosition(
      DEFAULT_HAND_CURSOR_STATE,
      1,
      { x: 100, y: 100 },
      BOUNDS,
    );
    const next = moveHand(start, 1, 50, 50, BOUNDS);
    expect(next).toBe(start);
  });

  it('only mutates the targeted slot', () => {
    const next = moveHand(DEFAULT_HAND_CURSOR_STATE, 2, 25, 25, BOUNDS);
    expect(next.slots[1]?.cursor).toEqual({ x: 25, y: 25 });
    expect(next.slots[0]).toBe(DEFAULT_HAND_CURSOR_STATE.slots[0]);
    expect(next.slots[2]).toBe(DEFAULT_HAND_CURSOR_STATE.slots[2]);
  });

  it('rejects out-of-range slot indices', () => {
    expect(() =>
      moveHand(DEFAULT_HAND_CURSOR_STATE, 5 as 1, 0, 0, BOUNDS),
    ).toThrow();
    expect(() =>
      moveHand(DEFAULT_HAND_CURSOR_STATE, 0 as unknown as 1, 0, 0, BOUNDS),
    ).toThrow();
  });

  it('treats NaN deltas as a no-op (cursor pinned to bounds.min)', () => {
    const start = setHandPosition(
      DEFAULT_HAND_CURSOR_STATE,
      1,
      { x: 50, y: 50 },
      BOUNDS,
    );
    const next = moveHand(start, 1, NaN, NaN, BOUNDS);
    // Non-finite deltas collapse to bounds.min via clamp() — defensive
    // contract; the scene's gamepad poll loop should never hand NaN in.
    expect(next.slots[0]?.cursor).toEqual({ x: 0, y: 0 });
  });

  it('produces a new frozen state object on actual movement', () => {
    const next = moveHand(DEFAULT_HAND_CURSOR_STATE, 1, 10, 10, BOUNDS);
    expect(next).not.toBe(DEFAULT_HAND_CURSOR_STATE);
    expect(Object.isFrozen(next)).toBe(true);
    expect(Object.isFrozen(next.slots[0])).toBe(true);
  });
});

describe('setHoveredTarget', () => {
  it('updates the hovered target for the targeted slot only', () => {
    const next = setHoveredTarget(DEFAULT_HAND_CURSOR_STATE, 1, {
      kind: 'portrait',
      portraitIndex: 2,
    });
    expect(next.slots[0]?.hovered).toEqual({ kind: 'portrait', portraitIndex: 2 });
    expect(next.slots[1]).toBe(DEFAULT_HAND_CURSOR_STATE.slots[1]);
  });

  it('returns the same state ref when the target is unchanged (deep-equal)', () => {
    const start = setHoveredTarget(DEFAULT_HAND_CURSOR_STATE, 1, {
      kind: 'portrait',
      portraitIndex: 2,
    });
    const same = setHoveredTarget(start, 1, {
      kind: 'portrait',
      portraitIndex: 2,
    });
    expect(same).toBe(start);
  });

  it('uses the frozen HOVERED_TARGET_NONE sentinel for the default state', () => {
    expect(DEFAULT_HAND_CURSOR_STATE.slots[0]?.hovered).toBe(HOVERED_TARGET_NONE);
  });
});

describe('selectAtCursor — light-attack dispatch', () => {
  it('is a no-op when the cursor is over nothing', () => {
    const next = selectAtCursor(DEFAULT_HAND_CURSOR_STATE, 1);
    expect(next).toBe(DEFAULT_HAND_CURSOR_STATE);
  });

  it('picks the hovered character and promotes empty → human', () => {
    const wolfIdx = SELECTABLE_CHARACTER_SPECS.findIndex((s) => s.id === 'wolf');
    const hovered = setHoveredTarget(DEFAULT_HAND_CURSOR_STATE, 1, {
      kind: 'portrait',
      portraitIndex: wolfIdx,
    });
    const picked = selectAtCursor(hovered, 1);
    expect(picked.slots[0]?.pickedCharacterId).toBe('wolf');
    expect(picked.slots[0]?.mode).toBe('human');
  });

  it('keeps an existing bot mode when picking a character (does NOT downgrade to human)', () => {
    const asBot = cycleSlotMode(
      cycleSlotMode(DEFAULT_HAND_CURSOR_STATE, 1),
      1,
    ); // empty → human → bot
    const wolfIdx = SELECTABLE_CHARACTER_SPECS.findIndex((s) => s.id === 'wolf');
    const hovered = setHoveredTarget(asBot, 1, {
      kind: 'portrait',
      portraitIndex: wolfIdx,
    });
    const picked = selectAtCursor(hovered, 1);
    expect(picked.slots[0]?.mode).toBe('bot');
    expect(picked.slots[0]?.pickedCharacterId).toBe('wolf');
  });

  it('routes a slot-tile-mode press to cycleSlotMode for the target slot', () => {
    const hovered = setHoveredTarget(DEFAULT_HAND_CURSOR_STATE, 1, {
      kind: 'slot-tile-mode',
      slotIndex: 2,
    });
    const next = selectAtCursor(hovered, 1);
    // Slot 2 was empty → cycles to human; slot 1 is unchanged in mode.
    expect(next.slots[1]?.mode).toBe('human');
    expect(next.slots[0]?.mode).toBe('empty');
  });

  it('routes a slot-tile-palette press to cycleSlotPalette for the target slot', () => {
    const hovered = setHoveredTarget(DEFAULT_HAND_CURSOR_STATE, 1, {
      kind: 'slot-tile-palette',
      slotIndex: 2,
    });
    const next = selectAtCursor(hovered, 1);
    // Slot 2 default palette = 1; cycles +1 → 2.
    expect(next.slots[1]?.paletteIndex).toBe(2);
  });

  it('rejects out-of-range portrait indices silently (state unchanged)', () => {
    const hovered = setHoveredTarget(DEFAULT_HAND_CURSOR_STATE, 1, {
      kind: 'portrait',
      portraitIndex: 999,
    });
    const next = selectAtCursor(hovered, 1);
    expect(next).toBe(hovered);
  });
});

describe('unselectSlot — special-attack REMOVE player', () => {
  it('resets the slot to Empty (clears pick + mode), per the symmetric add/remove model', () => {
    const picked = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 1, 'wolf', 3);
    const removed = unselectSlot(picked, 1);
    expect(removed.slots[0]?.pickedCharacterId).toBeNull();
    expect(removed.slots[0]?.mode).toBe('empty');
  });

  it('drops aiDifficulty when removing a bot slot', () => {
    let s = setSlotMode(DEFAULT_HAND_CURSOR_STATE, 1, 'bot');
    expect(s.slots[0]?.aiDifficulty).toBe('medium');
    s = unselectSlot(s, 1);
    expect(s.slots[0]?.mode).toBe('empty');
    expect(s.slots[0]?.aiDifficulty).toBeUndefined();
  });

  it('returns the same state ref when the slot is already empty', () => {
    const next = unselectSlot(DEFAULT_HAND_CURSOR_STATE, 1);
    expect(next).toBe(DEFAULT_HAND_CURSOR_STATE);
  });
});

describe('cycleSlotMode — Empty → Human → Bot → Empty', () => {
  it('rotates through SLOT_MODE_CYCLE_ORDER and wraps back to empty', () => {
    expect(SLOT_MODE_CYCLE_ORDER).toEqual(['empty', 'human', 'bot']);
    let s = DEFAULT_HAND_CURSOR_STATE;
    s = cycleSlotMode(s, 1);
    expect(s.slots[0]?.mode).toBe('human');
    s = cycleSlotMode(s, 1);
    expect(s.slots[0]?.mode).toBe('bot');
    s = cycleSlotMode(s, 1);
    expect(s.slots[0]?.mode).toBe('empty');
  });

  it('seeds aiDifficulty=medium when cycling into bot', () => {
    let s = cycleSlotMode(DEFAULT_HAND_CURSOR_STATE, 1); // human
    s = cycleSlotMode(s, 1); // bot
    expect(s.slots[0]?.aiDifficulty).toBe('medium');
  });

  it('drops aiDifficulty when cycling out of bot back to empty', () => {
    let s = cycleSlotMode(DEFAULT_HAND_CURSOR_STATE, 1); // human
    s = cycleSlotMode(s, 1); // bot
    s = cycleSlotMode(s, 1); // empty
    expect(s.slots[0]?.aiDifficulty).toBeUndefined();
    expect(s.slots[0]?.mode).toBe('empty');
  });

  it('clears pickedCharacterId on transition to empty (a non-participating slot keeps no stale pick)', () => {
    const picked = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 1, 'wolf', 0);
    expect(picked.slots[0]?.pickedCharacterId).toBe('wolf');
    // Picked slot is human → cycle twice (human → bot → empty)
    let s = cycleSlotMode(picked, 1); // bot
    s = cycleSlotMode(s, 1); // empty
    expect(s.slots[0]?.pickedCharacterId).toBeNull();
  });

  it('keeps the pick when transitioning human ↔ bot', () => {
    const picked = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 1, 'wolf', 0);
    const asBot = cycleSlotMode(picked, 1); // human → bot
    expect(asBot.slots[0]?.mode).toBe('bot');
    expect(asBot.slots[0]?.pickedCharacterId).toBe('wolf');
  });
});

describe('setSlotMode (direct setter, lobby-handoff path)', () => {
  it('is a no-op when the mode is unchanged (returns same state ref)', () => {
    const next = setSlotMode(DEFAULT_HAND_CURSOR_STATE, 1, 'empty');
    expect(next).toBe(DEFAULT_HAND_CURSOR_STATE);
  });

  it('drops aiDifficulty on a direct → human transition', () => {
    let s = setSlotMode(DEFAULT_HAND_CURSOR_STATE, 1, 'bot');
    expect(s.slots[0]?.aiDifficulty).toBe('medium');
    s = setSlotMode(s, 1, 'human');
    expect(s.slots[0]?.aiDifficulty).toBeUndefined();
  });
});

describe('cycleSlotPalette / setSlotPalette', () => {
  it('cycles palette by +1, wrapping past the end', () => {
    let s = setSlotPalette(DEFAULT_HAND_CURSOR_STATE, 1, PALETTE_COUNT - 1);
    s = cycleSlotPalette(s, 1, +1);
    expect(s.slots[0]?.paletteIndex).toBe(0);
  });

  it('cycles palette by -1, wrapping past zero', () => {
    let s = setSlotPalette(DEFAULT_HAND_CURSOR_STATE, 1, 0);
    s = cycleSlotPalette(s, 1, -1);
    expect(s.slots[0]?.paletteIndex).toBe(PALETTE_COUNT - 1);
  });

  it('setSlotPalette wraps a too-high explicit index', () => {
    const s = setSlotPalette(DEFAULT_HAND_CURSOR_STATE, 1, 17);
    expect(s.slots[0]?.paletteIndex).toBe(17 % PALETTE_COUNT);
  });

  it('setSlotPalette normalises a negative explicit index', () => {
    const s = setSlotPalette(DEFAULT_HAND_CURSOR_STATE, 1, -3);
    expect(s.slots[0]?.paletteIndex).toBe(PALETTE_COUNT - 3);
  });
});

describe('nextFreePaletteIndex — palette auto-differentiation (Phase 3)', () => {
  it('returns the preferred palette when no other slot has picked the same character', () => {
    expect(nextFreePaletteIndex(DEFAULT_HAND_CURSOR_STATE, 1, 'wolf', 4)).toBe(4);
  });

  it('shifts to the next free palette when another slot already locked the preferred one', () => {
    const slot2Wolf = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 2, 'wolf', 0);
    expect(nextFreePaletteIndex(slot2Wolf, 1, 'wolf', 0)).toBe(1);
  });

  it('walks forward modulo PALETTE_COUNT past taken palettes in sequence', () => {
    let s = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 2, 'wolf', 0);
    s = withSlotPicked(s, 3, 'wolf', 1);
    s = withSlotPicked(s, 4, 'wolf', 2);
    expect(nextFreePaletteIndex(s, 1, 'wolf', 0)).toBe(3);
  });

  it('ignores empty slots when computing taken palettes', () => {
    let s = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 2, 'wolf', 0);
    // Toggle slot 2 back to empty — its pick should no longer reserve palette 0.
    s = setSlotMode(s, 2, 'empty');
    expect(nextFreePaletteIndex(s, 1, 'wolf', 0)).toBe(0);
  });

  it('selectAtCursor auto-shifts palette when picking a character another slot already locked', () => {
    let s = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 2, 'wolf', 0);
    s = setSlotPalette(s, 1, 0); // ask for the same palette explicitly
    const wolfIdx = SELECTABLE_CHARACTER_SPECS.findIndex((s) => s.id === 'wolf');
    s = setHoveredTarget(s, 1, { kind: 'portrait', portraitIndex: wolfIdx });
    s = selectAtCursor(s, 1);
    // Slot 1's palette is auto-shifted off the colliding 0.
    expect(s.slots[0]?.pickedCharacterId).toBe('wolf');
    expect(s.slots[0]?.paletteIndex).not.toBe(0);
  });
});

describe('setSlotAiDifficulty / setSlotInputType', () => {
  it('only sets aiDifficulty on bot slots (silent no-op on human/empty)', () => {
    const human = cycleSlotMode(DEFAULT_HAND_CURSOR_STATE, 1); // human
    const noop = setSlotAiDifficulty(human, 1, 'hard');
    expect(noop.slots[0]?.aiDifficulty).toBeUndefined();
  });

  it('updates aiDifficulty on a bot slot', () => {
    let s = setSlotMode(DEFAULT_HAND_CURSOR_STATE, 1, 'bot');
    s = setSlotAiDifficulty(s, 1, 'hard');
    expect(s.slots[0]?.aiDifficulty).toBe('hard');
  });

  it('updates inputType in place', () => {
    const s = setSlotInputType(DEFAULT_HAND_CURSOR_STATE, 3, 'keyboard_p1');
    expect(s.slots[2]?.inputType).toBe('keyboard_p1');
  });
});

describe('toCharacterSelectState / buildPlayerSlotsFromHandCursor — legacy projection', () => {
  it('projects empty slots as joined: false', () => {
    const projected = toCharacterSelectState(DEFAULT_HAND_CURSOR_STATE);
    expect(projected.slots.every((s) => !s.joined)).toBe(true);
    expect(projected.slots.every((s) => !s.ready)).toBe(true);
  });

  it('projects a picked slot as joined + ready with the right characterId / paletteIndex', () => {
    const picked = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 1, 'cat', 5);
    const projected = toCharacterSelectState(picked);
    expect(projected.slots[0]?.joined).toBe(true);
    expect(projected.slots[0]?.ready).toBe(true);
    expect(projected.slots[0]?.characterId).toBe('cat');
    expect(projected.slots[0]?.paletteIndex).toBe(5);
  });

  it('projects bot slots as inputType=ai with their aiDifficulty preserved', () => {
    let s = setSlotMode(DEFAULT_HAND_CURSOR_STATE, 2, 'bot');
    s = setSlotAiDifficulty(s, 2, 'hard');
    s = withSlotPicked(s, 2, 'wolf', 0);
    const projected = toCharacterSelectState(s);
    expect(projected.slots[1]?.inputType).toBe('ai');
    expect(projected.slots[1]?.aiDifficulty).toBe('hard');
  });

  it('drops aiDifficulty from human slots in the projection', () => {
    const picked = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 1, 'wolf', 0);
    const projected = toCharacterSelectState(picked);
    expect(projected.slots[0]?.aiDifficulty).toBeUndefined();
  });

  it('buildPlayerSlotsFromHandCursor only emits slots with both mode!=empty AND a committed pick', () => {
    let s = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 1, 'wolf', 0);
    // Slot 2 is human but never picked — should NOT appear.
    s = setSlotMode(s, 2, 'human');
    const lineup = buildPlayerSlotsFromHandCursor(s);
    expect(lineup.length).toBe(1);
    expect(lineup[0]?.index).toBe(1);
    expect(lineup[0]?.characterId).toBe('wolf');
  });

  it('buildPlayerSlotsFromHandCursor preserves duplicate characters with distinct palettes', () => {
    let s = withSlotPicked(DEFAULT_HAND_CURSOR_STATE, 1, 'wolf', 0);
    s = withSlotPicked(s, 2, 'wolf', 0); // palette auto-shifts to 1
    const lineup = buildPlayerSlotsFromHandCursor(s);
    expect(lineup.length).toBe(2);
    expect(lineup[0]?.characterId).toBe('wolf');
    expect(lineup[1]?.characterId).toBe('wolf');
    expect(lineup[0]?.paletteIndex).not.toBe(lineup[1]?.paletteIndex);
  });

  it('cursorIndex on the projection mirrors the hovered portrait when present', () => {
    const catIdx = SELECTABLE_CHARACTER_SPECS.findIndex((s) => s.id === 'cat');
    const hovered = setHoveredTarget(DEFAULT_HAND_CURSOR_STATE, 1, {
      kind: 'portrait',
      portraitIndex: catIdx,
    });
    const projected = toCharacterSelectState(hovered);
    expect(projected.slots[0]?.cursorIndex).toBe(catIdx);
  });
});
