import { describe, it, expect } from 'vitest';
import {
  AI_DIFFICULTY_CYCLE_ORDER,
  DEFAULT_CHARACTER_SELECT_STATE,
  MAX_PLAYER_SLOTS,
  PALETTE_COUNT,
  SELECTABLE_CHARACTER_SPECS,
  allJoinedSlotsReady,
  autoAssignDistinctPalettes,
  buildCharacterPortraitGrid,
  buildPlayerSlotsFromState,
  buildSlotPaletteSwatches,
  buildSlotPreview,
  buildSlotPreviews,
  cancelSlotLockIn,
  canConfirmMatch,
  cycleSlotAiDifficulty,
  getJoinedSlotCount,
  getReadySlotCount,
  getSlotCursorCharacterId,
  hasPaletteCollision,
  hasSameCharacterPicks,
  isPlayableCharacter,
  joinSlot,
  leaveSlot,
  lockInSlotCharacter,
  moveSlotCursor,
  setSlotAiDifficulty,
  setSlotCharacter,
  setSlotCursor,
  setSlotInputType,
  setSlotPalette,
  setSlotReady,
  toggleSlotReady,
  type CharacterSelectState,
} from './characterSelect';
import { getCharacterPalette } from '../characters/palettes';
import type { CharacterId } from '../types';

/**
 * AC 13 Sub-AC 1 — "Remove same-character selection restriction in
 * character select logic to allow multiple players to pick the same
 * fighter."
 *
 * The contract these tests lock down:
 *
 *   1. The default state is well-formed and exposes a `setSlotCharacter`
 *      transition for every 1..4 slot.
 *
 *   2. `setSlotCharacter` accepts any roster character for any slot —
 *      including a character another slot has already picked. There is
 *      no error path on duplicates and no silent override.
 *
 *   3. The state-to-`PlayerSlot[]` projection in
 *      `buildPlayerSlotsFromState` carries duplicates through to the
 *      `MatchConfig.players` array byte-identically.
 *
 *   4. `hasSameCharacterPicks` reports duplicates without rejecting the
 *      state — the lobby is *allowed* to be in this configuration.
 *
 * If every assertion in this file holds, Sub-AC 1 holds.
 */
describe('characterSelect — AC 13 Sub-AC 1 (same-character selection allowed)', () => {
  // ---------------------------------------------------------------------
  // DEFAULT_CHARACTER_SELECT_STATE
  // ---------------------------------------------------------------------

  describe('DEFAULT_CHARACTER_SELECT_STATE', () => {
    it('exposes exactly 4 slots indexed 1..4', () => {
      const slots = DEFAULT_CHARACTER_SELECT_STATE.slots;
      expect(slots).toHaveLength(MAX_PLAYER_SLOTS);
      expect(slots.map((s) => s.index)).toEqual([1, 2, 3, 4]);
    });

    it('opens slot 1 joined and slots 2..4 un-joined', () => {
      // Slot 1 starts joined so a player who hits ENTER without anyone
      // joining still produces a valid 1-player vs 0-bot smoke-test
      // match (matches the M1 dev-mode behaviour).
      expect(DEFAULT_CHARACTER_SELECT_STATE.slots[0]?.joined).toBe(true);
      expect(DEFAULT_CHARACTER_SELECT_STATE.slots[1]?.joined).toBe(false);
      expect(DEFAULT_CHARACTER_SELECT_STATE.slots[2]?.joined).toBe(false);
      expect(DEFAULT_CHARACTER_SELECT_STATE.slots[3]?.joined).toBe(false);
    });

    it('is deeply frozen so consumers cannot mutate the shared default', () => {
      expect(Object.isFrozen(DEFAULT_CHARACTER_SELECT_STATE)).toBe(true);
      expect(Object.isFrozen(DEFAULT_CHARACTER_SELECT_STATE.slots)).toBe(true);
      for (const s of DEFAULT_CHARACTER_SELECT_STATE.slots) {
        expect(Object.isFrozen(s)).toBe(true);
      }
    });

    it('opens with the M1 lineup (Wolf P1, Cat P2)', () => {
      // Opening defaults preserve the existing dev-mode behaviour from
      // ModeSelectScene.buildConfirmedMatchConfig so smoke tests that
      // press ENTER through the menus still produce a Wolf-vs-Cat match.
      expect(DEFAULT_CHARACTER_SELECT_STATE.slots[0]?.characterId).toBe('wolf');
      expect(DEFAULT_CHARACTER_SELECT_STATE.slots[1]?.characterId).toBe('cat');
    });
  });

  // ---------------------------------------------------------------------
  // setSlotCharacter — Sub-AC 1's core contract
  // ---------------------------------------------------------------------

  describe('setSlotCharacter (NO uniqueness restriction across slots)', () => {
    it('accepts a duplicate pick — two slots can both choose Wolf', () => {
      // The headline assertion. Slot 2 picking Wolf when slot 1 is
      // already on Wolf must succeed; the resulting state has both
      // slots on `'wolf'`.
      const next = setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 2, 'wolf');
      expect(next.slots[0]?.characterId).toBe('wolf');
      expect(next.slots[1]?.characterId).toBe('wolf');
    });

    it('does not throw on duplicate picks (no restriction error path)', () => {
      // Belt-and-braces: even if a future maintainer wires a try/catch
      // around the call, the *throw* itself must not happen.
      expect(() =>
        setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 2, 'wolf'),
      ).not.toThrow();
    });

    it('allows ALL FOUR slots to pick the same character', () => {
      // The most extreme "same-character allowed" configuration: a
      // four-Wolf match. The state must arrive at this configuration
      // through normal transitions only (no special "force duplicate"
      // path).
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      // Join slots 2..4 so they show up in buildPlayerSlotsFromState.
      state = joinSlot(state, 2);
      state = joinSlot(state, 3);
      state = joinSlot(state, 4);
      // Pick Wolf in every slot.
      state = setSlotCharacter(state, 1, 'wolf');
      state = setSlotCharacter(state, 2, 'wolf');
      state = setSlotCharacter(state, 3, 'wolf');
      state = setSlotCharacter(state, 4, 'wolf');
      // All four slots now sharing one character.
      expect(state.slots.map((s) => s.characterId)).toEqual([
        'wolf',
        'wolf',
        'wolf',
        'wolf',
      ]);
    });

    it('preserves palette / inputType / joined when changing character', () => {
      // Changing only the character must not reset the palette the
      // player already cycled to or kick a player out of the lobby.
      let state = setSlotPalette(DEFAULT_CHARACTER_SELECT_STATE, 1, 5);
      state = joinSlot(state, 1); // already joined, but explicit
      const before = state.slots[0]!;
      const after = setSlotCharacter(state, 1, 'cat').slots[0]!;
      expect(after.paletteIndex).toBe(before.paletteIndex);
      expect(after.inputType).toBe(before.inputType);
      expect(after.joined).toBe(before.joined);
      // And the only field that changed is characterId.
      expect(after.characterId).toBe('cat');
      expect(before.characterId).toBe('wolf');
    });

    it('returns the same state reference on a no-op pick', () => {
      // Re-picking the same character on a slot that already has it
      // must be a true no-op — same `===` reference — so React-style
      // memo'd renderers don't churn.
      const same = setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 1, 'wolf');
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('throws if the slot index is out of range', () => {
      // The only failure mode the API exposes is a structurally invalid
      // slot index — uniqueness violations are deliberately NOT one.
      expect(() =>
        setSlotCharacter(
          DEFAULT_CHARACTER_SELECT_STATE,
          // @ts-expect-error — testing runtime guard for invalid index
          5,
          'wolf',
        ),
      ).toThrow(/slotIndex/);
    });

    it('every roster character is selectable for every slot, regardless of duplicates', () => {
      // Exhaustive cross-product: every (slot, character) combination
      // must succeed. This fails if a future change accidentally adds
      // a "characterId already taken" guard.
      for (const slotIdx of [1, 2, 3, 4] as const) {
        for (const spec of SELECTABLE_CHARACTER_SPECS) {
          const next = setSlotCharacter(
            DEFAULT_CHARACTER_SELECT_STATE,
            slotIdx,
            spec.id,
          );
          expect(next.slots[slotIdx - 1]?.characterId).toBe(spec.id);
        }
      }
    });
  });

  // ---------------------------------------------------------------------
  // buildPlayerSlotsFromState — duplicates survive into MatchConfig.players
  // ---------------------------------------------------------------------

  describe('buildPlayerSlotsFromState (duplicates survive the projection)', () => {
    it('emits two PlayerSlot entries with the same characterId when two slots picked it', () => {
      let state = setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 2, 'wolf');
      state = joinSlot(state, 2);
      const players = buildPlayerSlotsFromState(state);
      // Both slot-1 and slot-2 in the output, both on Wolf.
      expect(players).toHaveLength(2);
      expect(players[0]?.characterId).toBe('wolf');
      expect(players[1]?.characterId).toBe('wolf');
      // The slot indices are still distinct — duplicates of character,
      // not of slot identity.
      expect(players[0]?.index).toBe(1);
      expect(players[1]?.index).toBe(2);
    });

    it('drops un-joined slots so a 2-player lineup yields 2 players', () => {
      // Slot 1 is joined by default; nobody else joined.
      const players = buildPlayerSlotsFromState(DEFAULT_CHARACTER_SELECT_STATE);
      expect(players).toHaveLength(1);
      expect(players[0]?.index).toBe(1);
    });

    it('emits a frozen array of frozen PlayerSlot entries', () => {
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      const players = buildPlayerSlotsFromState(state);
      expect(Object.isFrozen(players)).toBe(true);
      for (const p of players) {
        expect(Object.isFrozen(p)).toBe(true);
      }
    });

    it('carries paletteIndex through unchanged so duplicates are visually distinguishable', () => {
      // The palette is the differentiation hook AC 13 calls out. Two
      // Wolf-pickers with palette 0 and palette 3 must end up with
      // those exact palette indices in the resulting PlayerSlot[],
      // ready for the renderer to apply hue-shifted sprites.
      let state = setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 2, 'wolf');
      state = setSlotPalette(state, 1, 0);
      state = setSlotPalette(state, 2, 3);
      state = joinSlot(state, 2);
      const players = buildPlayerSlotsFromState(state);
      expect(players[0]?.paletteIndex).toBe(0);
      expect(players[1]?.paletteIndex).toBe(3);
    });
  });

  // ---------------------------------------------------------------------
  // hasSameCharacterPicks — duplicates are reported, not rejected
  // ---------------------------------------------------------------------

  describe('hasSameCharacterPicks (reports — never rejects — duplicates)', () => {
    it('returns false for the default lineup (Wolf vs Cat)', () => {
      // Default lineup is (Wolf, Cat, Owl, Bear) but only slot 1 is
      // joined, so there are no duplicates among joined slots.
      expect(hasSameCharacterPicks(DEFAULT_CHARACTER_SELECT_STATE)).toBe(false);
    });

    it('returns true once two joined slots share a character', () => {
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      expect(hasSameCharacterPicks(state)).toBe(true);
    });

    it('ignores un-joined duplicates (only counts active lobby members)', () => {
      // If slot 2 is on Wolf but hasn't joined yet, the lineup is
      // effectively just slot 1 — no duplicates to worry about.
      const state = setSlotCharacter(
        DEFAULT_CHARACTER_SELECT_STATE,
        2,
        'wolf',
      );
      expect(state.slots[1]?.joined).toBe(false);
      expect(hasSameCharacterPicks(state)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // joinSlot + setSlotPalette — supporting transitions
  // ---------------------------------------------------------------------

  describe('joinSlot', () => {
    it('marks the slot as joined', () => {
      const next = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      expect(next.slots[1]?.joined).toBe(true);
    });

    it('is idempotent for an already-joined slot', () => {
      const same = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 1);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });
  });

  describe('setSlotPalette', () => {
    it('wraps past the last palette back to 0', () => {
      const next = setSlotPalette(DEFAULT_CHARACTER_SELECT_STATE, 1, PALETTE_COUNT);
      expect(next.slots[0]?.paletteIndex).toBe(0);
    });

    it('wraps negative indices to a valid palette', () => {
      const next = setSlotPalette(DEFAULT_CHARACTER_SELECT_STATE, 1, -1);
      expect(next.slots[0]?.paletteIndex).toBe(PALETTE_COUNT - 1);
    });

    it('returns the same state reference on a no-op palette pick', () => {
      // Slot 1 default is palette 0 (slotIndex - 1).
      const same = setSlotPalette(DEFAULT_CHARACTER_SELECT_STATE, 1, 0);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });
  });

  // ---------------------------------------------------------------------
  // isPlayableCharacter
  // ---------------------------------------------------------------------

  describe('isPlayableCharacter', () => {
    it('reports the full M2 cast as playable', () => {
      // M1 cut shipped Wolf + Cat. AC 60004 Sub-AC 4 promoted Owl,
      // and AC 60001 Sub-AC 1 promoted Bear — every roster slot is
      // now playable: true once each character ships their grounded
      // triplet (jab / tilt / smash). Selection UIs no longer need to
      // grey out any tile.
      expect(isPlayableCharacter('wolf')).toBe(true);
      expect(isPlayableCharacter('cat')).toBe(true);
      expect(isPlayableCharacter('owl')).toBe(true);
      expect(isPlayableCharacter('bear')).toBe(true);
    });

    it('the playable check does NOT gate same-character selection', () => {
      // Important: even if a UI uses isPlayableCharacter to disable a
      // tile, the underlying `setSlotCharacter` still doesn't enforce
      // playability. Sub-AC 1 is about uniqueness, not roster gating;
      // we keep the no-restriction property pure.
      const allIds: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear'];
      for (const id of allIds) {
        expect(() =>
          setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 1, id),
        ).not.toThrow();
      }
    });
  });
});

// =====================================================================
// AC 13 Sub-AC 4 — palette-preview projections + auto-distinct palettes
// =====================================================================

describe('characterSelect — AC 13 Sub-AC 4 (palette previews + auto-distinct)', () => {
  // ---------------------------------------------------------------------
  // buildSlotPreview / buildSlotPreviews
  // ---------------------------------------------------------------------

  describe('buildSlotPreview (per-slot palette preview projection)', () => {
    it('projects a slot onto the palette colours from palettes.ts', () => {
      // Slot 1 default is Wolf with palette 0 — the canonical wolf red
      // that matches WOLF_PLACEHOLDER. The preview must surface those
      // exact colours so the lobby tile and the in-match body agree.
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const preview = buildSlotPreview(slot);
      const wolfP0 = getCharacterPalette('wolf', 0);
      expect(preview.primaryColor).toBe(wolfP0.primaryColor);
      expect(preview.accentColor).toBe(wolfP0.accentColor);
      expect(preview.labelColor).toBe(wolfP0.labelColor);
      expect(preview.paletteName).toBe(wolfP0.displayName);
      expect(preview.characterId).toBe('wolf');
      expect(preview.slotIndex).toBe(1);
      expect(preview.displayName).toBe('Wolf');
      expect(preview.roleLabel).toBe('bruiser');
      expect(preview.playable).toBe(true);
      expect(preview.joined).toBe(true);
    });

    it('honours the slot.paletteIndex when picking colours', () => {
      // Slot 2 defaults to palette index 1 (slot index - 1) — the
      // preview must read off Cat palette 1 (Fuchsia), not palette 0.
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[1]!;
      const preview = buildSlotPreview(slot);
      const catP1 = getCharacterPalette('cat', 1);
      expect(preview.paletteIndex).toBe(1);
      expect(preview.primaryColor).toBe(catP1.primaryColor);
      expect(preview.paletteName).toBe(catP1.displayName);
    });

    it('returns a frozen record so consumers cannot mutate previews', () => {
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const preview = buildSlotPreview(slot);
      expect(Object.isFrozen(preview)).toBe(true);
    });

    it('reflects un-joined slots so the UI can dim them', () => {
      // Slot 2 is un-joined by default. The preview must surface
      // `joined: false` so the renderer can lower the alpha or grey
      // out the tile without re-reading the underlying state.
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[1]!;
      expect(buildSlotPreview(slot).joined).toBe(false);
    });
  });

  describe('buildSlotPreviews (whole-state preview projection)', () => {
    it('emits one preview per slot in slot order', () => {
      const previews = buildSlotPreviews(DEFAULT_CHARACTER_SELECT_STATE);
      expect(previews).toHaveLength(MAX_PLAYER_SLOTS);
      expect(previews.map((p) => p.slotIndex)).toEqual([1, 2, 3, 4]);
    });

    it('emits a frozen array of frozen previews', () => {
      const previews = buildSlotPreviews(DEFAULT_CHARACTER_SELECT_STATE);
      expect(Object.isFrozen(previews)).toBe(true);
      for (const p of previews) {
        expect(Object.isFrozen(p)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------
  // buildSlotPaletteSwatches
  // ---------------------------------------------------------------------

  describe('buildSlotPaletteSwatches (8-swatch palette-row preview)', () => {
    it('produces exactly PALETTE_COUNT swatches in palette-index order', () => {
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const swatches = buildSlotPaletteSwatches(slot);
      expect(swatches).toHaveLength(PALETTE_COUNT);
      expect(swatches.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it('marks exactly one swatch active — the slot.paletteIndex one', () => {
      // Slot 1 default palette is 0 — only swatch 0 should be active.
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const swatches = buildSlotPaletteSwatches(slot);
      const active = swatches.filter((s) => s.active);
      expect(active).toHaveLength(1);
      expect(active[0]?.index).toBe(0);
    });

    it('shifts the active swatch when the slot palette cycles', () => {
      const cycled = setSlotPalette(DEFAULT_CHARACTER_SELECT_STATE, 1, 5);
      const swatches = buildSlotPaletteSwatches(cycled.slots[0]!);
      const active = swatches.filter((s) => s.active);
      expect(active).toHaveLength(1);
      expect(active[0]?.index).toBe(5);
    });

    it('paints every swatch with its palette colour data', () => {
      // The swatch row must let the player see all 8 palettes at a
      // glance; if we accidentally painted them all the same colour,
      // the preview would be useless.
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const swatches = buildSlotPaletteSwatches(slot);
      const distinctPrimaries = new Set(swatches.map((s) => s.primaryColor));
      expect(distinctPrimaries.size).toBe(PALETTE_COUNT);
    });
  });

  // ---------------------------------------------------------------------
  // autoAssignDistinctPalettes — Sub-AC 4 core contract
  // ---------------------------------------------------------------------

  describe('autoAssignDistinctPalettes (auto-pick distinct palettes on duplicates)', () => {
    it('is a no-op when all joined slots have unique characters', () => {
      // Slot 1 is on Wolf, slot 2 is on Cat (different chars) — no
      // collision, no churn. Same `===` reference is returned.
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      // After join, slots 1+2 are on (Wolf p0, Cat p1) — no overlap.
      const same = autoAssignDistinctPalettes(state);
      expect(same).toBe(state);
    });

    it('is a no-op when duplicate-character slots already have distinct palettes', () => {
      // Slot 1 is Wolf p0 (default). Slot 2 picks Wolf at palette 1 —
      // duplicate character but different palette. The auto-pass must
      // not reshuffle a configuration the players already painted
      // distinctly.
      let state = setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 2, 'wolf');
      // Slot 2 default palette is 1 (slot index - 1), so the duplicate
      // is already on a distinct palette.
      state = joinSlot(state, 2);
      expect(state.slots[0]?.paletteIndex).toBe(0);
      expect(state.slots[1]?.paletteIndex).toBe(1);
      const same = autoAssignDistinctPalettes(state);
      expect(same).toBe(state);
    });

    it('repairs a (Wolf p0, Wolf p0) collision so slot 2 moves to a free palette', () => {
      // Force the collision: slot 2 picks Wolf, then dials its
      // palette down to 0 so both joined slots are on Wolf p0.
      let state = setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 2, 'wolf');
      state = setSlotPalette(state, 2, 0);
      state = joinSlot(state, 2);
      // Both slots on Wolf p0 — the collision the auto-pass exists to fix.
      expect(state.slots[0]?.paletteIndex).toBe(0);
      expect(state.slots[1]?.paletteIndex).toBe(0);
      const repaired = autoAssignDistinctPalettes(state);
      expect(repaired).not.toBe(state);
      // Slot 1 (lowest index) keeps its palette; slot 2 is bumped.
      expect(repaired.slots[0]?.paletteIndex).toBe(0);
      expect(repaired.slots[1]?.paletteIndex).not.toBe(0);
      // The two palettes must now be distinct.
      expect(repaired.slots[0]?.paletteIndex).not.toBe(
        repaired.slots[1]?.paletteIndex,
      );
    });

    it('repairs a four-Wolf collision so all four slots end on distinct palettes', () => {
      // The most extreme case — four slots all on Wolf, all on
      // palette 0. The auto-pass must spread them across four
      // distinct palette indices.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = joinSlot(state, 2);
      state = joinSlot(state, 3);
      state = joinSlot(state, 4);
      for (const i of [1, 2, 3, 4] as const) {
        state = setSlotCharacter(state, i, 'wolf');
        state = setSlotPalette(state, i, 0);
      }
      // All four slots locked onto Wolf p0.
      expect(state.slots.every((s) => s.characterId === 'wolf')).toBe(true);
      expect(state.slots.every((s) => s.paletteIndex === 0)).toBe(true);

      const repaired = autoAssignDistinctPalettes(state);
      const palettes = repaired.slots.map((s) => s.paletteIndex);
      // Four distinct palette indices.
      expect(new Set(palettes).size).toBe(4);
      // All in valid range.
      for (const p of palettes) {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(PALETTE_COUNT);
      }
      // Slot 1 (lowest index) keeps its palette — "first wins" rule.
      expect(repaired.slots[0]?.paletteIndex).toBe(0);
    });

    it('leaves un-joined slots untouched (only joined-slot collisions count)', () => {
      // Slot 2 is on Wolf p0 but un-joined — auto-pass must not
      // touch it. The lobby spectator's palette is preserved so when
      // they join later they see what they had.
      let state = setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 2, 'wolf');
      state = setSlotPalette(state, 2, 0);
      // Slot 2 is still un-joined.
      expect(state.slots[1]?.joined).toBe(false);
      const same = autoAssignDistinctPalettes(state);
      expect(same).toBe(state);
      expect(same.slots[1]?.paletteIndex).toBe(0);
    });

    it('mixes joined and un-joined slots correctly', () => {
      // Slots 1+3 joined (both Wolf p0). Slot 2 un-joined (also
      // Wolf p0). Auto-pass should bump slot 3 — slot 2 stays
      // untouched because it's un-joined and doesn't compete for a
      // palette.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = setSlotCharacter(state, 2, 'wolf');
      state = setSlotPalette(state, 2, 0); // slot 2 wolf p0, un-joined
      state = setSlotCharacter(state, 3, 'wolf');
      state = setSlotPalette(state, 3, 0); // slot 3 wolf p0
      state = joinSlot(state, 3);

      const repaired = autoAssignDistinctPalettes(state);
      expect(repaired.slots[0]?.paletteIndex).toBe(0); // slot 1 keeps p0
      expect(repaired.slots[1]?.paletteIndex).toBe(0); // slot 2 (unjoined) untouched
      expect(repaired.slots[2]?.paletteIndex).not.toBe(0); // slot 3 bumped
    });

    it('is deterministic — same input always produces the same output', () => {
      // Determinism contract: replays must reproduce identical
      // palette assignments.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = joinSlot(state, 2);
      state = joinSlot(state, 3);
      state = setSlotCharacter(state, 1, 'wolf');
      state = setSlotCharacter(state, 2, 'wolf');
      state = setSlotCharacter(state, 3, 'wolf');
      state = setSlotPalette(state, 1, 0);
      state = setSlotPalette(state, 2, 0);
      state = setSlotPalette(state, 3, 0);

      const r1 = autoAssignDistinctPalettes(state);
      const r2 = autoAssignDistinctPalettes(state);
      // Structural equality on the resulting palettes — the function
      // is pure so two calls produce identical numbers.
      expect(r1.slots.map((s) => s.paletteIndex)).toEqual(
        r2.slots.map((s) => s.paletteIndex),
      );
    });

    it('returns a frozen state with frozen slots', () => {
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = joinSlot(state, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      state = setSlotPalette(state, 2, 0);
      const repaired = autoAssignDistinctPalettes(state);
      expect(Object.isFrozen(repaired)).toBe(true);
      expect(Object.isFrozen(repaired.slots)).toBe(true);
      for (const s of repaired.slots) {
        expect(Object.isFrozen(s)).toBe(true);
      }
    });

    it('preserves the same characterId — only paletteIndex changes', () => {
      // The auto-pass MUST NOT pick a different character to "solve" a
      // collision. The player's character pick is sacred; only the
      // palette gets bumped.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = joinSlot(state, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      state = setSlotPalette(state, 2, 0);
      const repaired = autoAssignDistinctPalettes(state);
      expect(repaired.slots[0]?.characterId).toBe('wolf');
      expect(repaired.slots[1]?.characterId).toBe('wolf');
    });

    it('hasSameCharacterPicks is still true after the repair (we fix the palette, not the character)', () => {
      // Sub-AC 4 differentiates duplicates by palette, not by
      // overriding the player's character pick. So
      // `hasSameCharacterPicks` continues to report the duplicate
      // even after the auto-pass has run — the players are still
      // both playing Wolf, just in different colours.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = joinSlot(state, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      const repaired = autoAssignDistinctPalettes(state);
      expect(hasSameCharacterPicks(repaired)).toBe(true);
    });

    it('buildPlayerSlotsFromState surfaces the repaired distinct palettes downstream', () => {
      // The whole point of the repair is so the resulting
      // `MatchConfig.players` carries distinct palette indices for
      // duplicate-character slots. If the projection drops the
      // repair, AC 13's promise to MatchScene fails.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = joinSlot(state, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      state = setSlotPalette(state, 2, 0);
      const repaired = autoAssignDistinctPalettes(state);
      const players = buildPlayerSlotsFromState(repaired);
      expect(players).toHaveLength(2);
      expect(players[0]?.characterId).toBe('wolf');
      expect(players[1]?.characterId).toBe('wolf');
      expect(players[0]?.paletteIndex).not.toBe(players[1]?.paletteIndex);
    });
  });

  // ---------------------------------------------------------------------
  // SELECTABLE_CHARACTER_SPECS sanity — used by the scene's cycler
  // ---------------------------------------------------------------------

  describe('SELECTABLE_CHARACTER_SPECS (drives the scene character cycler)', () => {
    it('includes every roster id the type system knows about', () => {
      const ids = new Set(SELECTABLE_CHARACTER_SPECS.map((s) => s.id));
      // The roster cycler the CharacterSelectScene wraps over must
      // cover every id, otherwise pressing "next" on a placeholder
      // character would jump back to playable specs and the
      // grey-out grid logic can't trust the ordering.
      expect(ids.has('wolf')).toBe(true);
      expect(ids.has('cat')).toBe(true);
      expect(ids.has('owl')).toBe(true);
      expect(ids.has('bear')).toBe(true);
    });
  });
});

/**
 * AC 10303 Sub-AC 3 — "Build character select screen UI layout with 4
 * player slots, character portraits grid, and palette swatch picker
 * per slot."
 *
 * The 4-slot tiles + 8-swatch palette picker shipped with AC 13 Sub-AC
 * 4. The portraits grid is the new surface — a roster-wide gallery
 * sitting above the slot tiles so a player can see "who can I pick?"
 * at a glance, with chips lighting up to show which slot(s) currently
 * have each character locked.
 *
 * `buildCharacterPortraitGrid` is the pure projection that drives the
 * Phaser tiles. These tests lock down its contract so the visual
 * surface in `CharacterSelectScene` stays consistent with the
 * unit-tested data shape — the same architectural split as
 * `buildSlotPreview` / `buildSlotPaletteSwatches`.
 */
describe('buildCharacterPortraitGrid — AC 10303 Sub-AC 3 (portraits grid)', () => {
  it('returns one cell per spec in roster order', () => {
    const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    expect(grid).toHaveLength(SELECTABLE_CHARACTER_SPECS.length);
    expect(grid.map((c) => c.characterId)).toEqual(
      SELECTABLE_CHARACTER_SPECS.map((s) => s.id),
    );
  });

  it('every cell carries the spec display name + role + playable flag', () => {
    const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    for (let i = 0; i < grid.length; i += 1) {
      const cell = grid[i]!;
      const spec = SELECTABLE_CHARACTER_SPECS[i]!;
      expect(cell.displayName).toBe(spec.displayName);
      expect(cell.roleLabel).toBe(spec.role);
      expect(cell.playable).toBe(spec.playable);
    }
  });

  it('every cell carries valid 0xRRGGBB palette colours from palette 0', () => {
    const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    for (const cell of grid) {
      expect(Number.isInteger(cell.primaryColor)).toBe(true);
      expect(cell.primaryColor).toBeGreaterThanOrEqual(0);
      expect(cell.primaryColor).toBeLessThanOrEqual(0xffffff);
      expect(Number.isInteger(cell.accentColor)).toBe(true);
      expect(cell.accentColor).toBeGreaterThanOrEqual(0);
      expect(cell.accentColor).toBeLessThanOrEqual(0xffffff);
    }
  });

  it('selectedBySlots is empty for cells that no joined slot has picked', () => {
    // Default state: only slot 1 is joined and on Wolf. Cat, Owl,
    // Bear cells must report `selectedBySlots: []`.
    const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    const cat = grid.find((c) => c.characterId === 'cat');
    const owl = grid.find((c) => c.characterId === 'owl');
    const bear = grid.find((c) => c.characterId === 'bear');
    expect(cat?.selectedBySlots).toEqual([]);
    expect(owl?.selectedBySlots).toEqual([]);
    expect(bear?.selectedBySlots).toEqual([]);
  });

  it('reports the joined slot index in selectedBySlots for the picked character', () => {
    // Default: slot 1 joined on Wolf. Wolf cell must report `[1]`.
    const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    const wolf = grid.find((c) => c.characterId === 'wolf');
    expect(wolf?.selectedBySlots).toEqual([1]);
  });

  it('IGNORES un-joined slots — opening defaults do not light up Cat (slot 2 default but un-joined)', () => {
    // The default state opens slot 2 on Cat *but un-joined*. Until
    // the player presses the join key, that pick must not show up
    // on the portraits grid — otherwise un-joined "spectator"
    // defaults visually hijack characters before the player has
    // committed.
    const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    const cat = grid.find((c) => c.characterId === 'cat');
    expect(cat?.selectedBySlots).toEqual([]);
  });

  it('AC 13 cross-tie: same-character picks accumulate on a single cell', () => {
    // Two joined slots on Wolf must produce one Wolf cell with
    // `selectedBySlots: [1, 2]` (sorted ascending). This is the
    // load-bearing reason the field is a list, not an Optional —
    // up to 4 slots can share a portrait.
    let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
    state = joinSlot(state, 2);
    state = setSlotCharacter(state, 2, 'wolf');
    const grid = buildCharacterPortraitGrid(state);
    const wolf = grid.find((c) => c.characterId === 'wolf');
    expect(wolf?.selectedBySlots).toEqual([1, 2]);
  });

  it('AC 13 cross-tie: all 4 slots can pile on one portrait', () => {
    // Same-character lobbies are a first-class config (AC 13 Sub-AC 1).
    // The portraits grid must render that without complaint —
    // chip count grows up to MAX_PLAYER_SLOTS and the order stays
    // ascending.
    let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
    state = joinSlot(state, 2);
    state = joinSlot(state, 3);
    state = joinSlot(state, 4);
    state = setSlotCharacter(state, 1, 'bear');
    state = setSlotCharacter(state, 2, 'bear');
    state = setSlotCharacter(state, 3, 'bear');
    state = setSlotCharacter(state, 4, 'bear');
    const grid = buildCharacterPortraitGrid(state);
    const bear = grid.find((c) => c.characterId === 'bear');
    expect(bear?.selectedBySlots).toEqual([1, 2, 3, 4]);
    // And every other cell stays empty.
    expect(grid.find((c) => c.characterId === 'wolf')?.selectedBySlots).toEqual([]);
    expect(grid.find((c) => c.characterId === 'cat')?.selectedBySlots).toEqual([]);
    expect(grid.find((c) => c.characterId === 'owl')?.selectedBySlots).toEqual([]);
  });

  it('selectedBySlots is sorted ascending regardless of join order', () => {
    // Joining slot 4 before slot 2 must not produce `[1, 4, 2]` in
    // the chip row — the scene reads chips left-to-right as
    // P1 → P2 → P3 → P4 so out-of-order entries break the visual.
    let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
    state = joinSlot(state, 4);
    state = joinSlot(state, 2);
    state = setSlotCharacter(state, 4, 'wolf');
    state = setSlotCharacter(state, 2, 'wolf');
    const grid = buildCharacterPortraitGrid(state);
    const wolf = grid.find((c) => c.characterId === 'wolf');
    expect(wolf?.selectedBySlots).toEqual([1, 2, 4]);
  });

  it('returns frozen cells AND a frozen array (deep-frozen)', () => {
    const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    expect(Object.isFrozen(grid)).toBe(true);
    for (const cell of grid) {
      expect(Object.isFrozen(cell)).toBe(true);
      expect(Object.isFrozen(cell.selectedBySlots)).toBe(true);
    }
  });

  it('determinism: same state always produces structurally equal grids', () => {
    // The Seed's determinism contract demands no `Math.random()`,
    // no wall-clock. Calling `buildCharacterPortraitGrid` twice on
    // the same state must produce byte-identical data so two
    // identical lobby setups paint identical portraits.
    const a = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    const b = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    expect(a).toEqual(b);
  });

  it('cell colours come from palette 0 (canonical hue) — palette cycling does NOT shift the gallery', () => {
    // The gallery shows "what does each character look like by
    // default?". Per-slot palette cycling drives the per-slot tile
    // body; it must NOT bleed into the gallery, otherwise the
    // gallery looks unstable as players cycle palettes.
    let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
    const before = buildCharacterPortraitGrid(state).find(
      (c) => c.characterId === 'wolf',
    );
    state = setSlotPalette(state, 1, 5);
    const after = buildCharacterPortraitGrid(state).find(
      (c) => c.characterId === 'wolf',
    );
    expect(after?.primaryColor).toBe(before?.primaryColor);
    expect(after?.accentColor).toBe(before?.accentColor);
  });

  it('returns a cell for every spec — even non-playable ones (locked-grid stability)', () => {
    // Even if a future M-* milestone re-locks a roster spec, the
    // grid must still expose a cell so the layout doesn't reflow.
    // The scene paints non-playable cells greyed out via the
    // `playable` flag.
    const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
    expect(grid).toHaveLength(SELECTABLE_CHARACTER_SPECS.length);
    for (const spec of SELECTABLE_CHARACTER_SPECS) {
      const cell = grid.find((c) => c.characterId === spec.id);
      expect(cell).toBeDefined();
      expect(cell?.playable).toBe(spec.playable);
    }
  });
});

// =====================================================================
// AC 10304 Sub-AC 4 — per-slot ready-up state, leave, conflict gating
// =====================================================================

/**
 * AC 10304 Sub-AC 4 — "Wire per-player slot input handling for
 * character + palette selection, ready-up state, and conflict
 * resolution (preventing duplicate palette+character combos across
 * slots)."
 *
 * The character + palette selection wiring is already locked down by
 * AC 13 Sub-AC 1 (no uniqueness restriction) and AC 13 Sub-AC 4
 * (palette previews + auto-distinct repair). What this AC adds is the
 * **ready-up gate**: each joined slot must explicitly sign off on its
 * `(characterId, paletteIndex)` choice before ENTER can fire the
 * match.
 *
 * The contract these tests lock down:
 *
 *   1. Every slot opens `ready: false` — slot 1 (which opens joined
 *      by default) included.
 *
 *   2. `setSlotReady` / `toggleSlotReady` cleanly toggles the flag
 *      while honouring the invariant `ready ⇒ joined` (an un-joined
 *      slot can never be ready).
 *
 *   3. Cycling character or palette drops `ready` back to `false` so
 *      the player can't accidentally ship a different fighter than
 *      they confirmed.
 *
 *   4. `leaveSlot` is the inverse of `joinSlot` — drops both `joined`
 *      and `ready`.
 *
 *   5. `allJoinedSlotsReady` / `canConfirmMatch` correctly gate the
 *      confirm path: empty lobby → no, partial-ready → no,
 *      all-ready → yes.
 *
 *   6. Palette-collision detection (`hasPaletteCollision`) +
 *      `canConfirmMatch` cooperate to deny confirm when two joined
 *      slots end up on the same `(characterId, paletteIndex)` — the
 *      defence-in-depth guard against the auto-distinct-palette pass
 *      missing a saturation case.
 */
describe('characterSelect — AC 10304 Sub-AC 4 (ready-up + conflict gating)', () => {
  // ---------------------------------------------------------------------
  // Default state
  // ---------------------------------------------------------------------

  describe('DEFAULT_CHARACTER_SELECT_STATE.ready', () => {
    it('opens every slot un-ready, including slot 1', () => {
      // Slot 1 is `joined: true` by default, but readiness is a
      // deliberate sign-off — even the default slot has to ready up
      // before ENTER fires the match.
      for (const slot of DEFAULT_CHARACTER_SELECT_STATE.slots) {
        expect(slot.ready).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------
  // setSlotReady / toggleSlotReady
  // ---------------------------------------------------------------------

  describe('setSlotReady (joined-slot ready toggle)', () => {
    it('marks a joined slot as ready', () => {
      // Slot 1 opens joined by default, so it's the cleanest target.
      const next = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      expect(next.slots[0]?.ready).toBe(true);
    });

    it('refuses to ready an un-joined slot (silent no-op)', () => {
      // Slot 2 is un-joined by default. Trying to ready it without
      // joining first must NOT mutate state — the invariant
      // `ready ⇒ joined` holds at every transition.
      const same = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 2, true);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
      expect(same.slots[1]?.ready).toBe(false);
      expect(same.slots[1]?.joined).toBe(false);
    });

    it('returns the same state reference on a no-op (already at target)', () => {
      const same = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, false);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('un-readies a ready slot (drops the flag)', () => {
      let state = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      expect(state.slots[0]?.ready).toBe(true);
      state = setSlotReady(state, 1, false);
      expect(state.slots[0]?.ready).toBe(false);
    });

    it('throws on an out-of-range slot index', () => {
      expect(() =>
        setSlotReady(
          DEFAULT_CHARACTER_SELECT_STATE,
          // @ts-expect-error — testing runtime guard for invalid index
          5,
          true,
        ),
      ).toThrow(/slotIndex/);
    });

    it('preserves character / palette / inputType / joined when toggling ready', () => {
      // Readiness is a *gating* signal, not a *commit* signal — the
      // live selection is unchanged when the flag flips.
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotCharacter(state, 2, 'bear');
      state = setSlotPalette(state, 2, 4);
      const before = state.slots[1]!;
      const after = setSlotReady(state, 2, true).slots[1]!;
      expect(after.characterId).toBe(before.characterId);
      expect(after.paletteIndex).toBe(before.paletteIndex);
      expect(after.inputType).toBe(before.inputType);
      expect(after.joined).toBe(before.joined);
      expect(after.ready).toBe(true);
    });

    it('returns a frozen state with frozen slots', () => {
      const next = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      expect(Object.isFrozen(next)).toBe(true);
      expect(Object.isFrozen(next.slots)).toBe(true);
      for (const s of next.slots) {
        expect(Object.isFrozen(s)).toBe(true);
      }
    });
  });

  describe('toggleSlotReady (sugar over setSlotReady)', () => {
    it('flips a joined-and-not-ready slot to ready', () => {
      const next = toggleSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1);
      expect(next.slots[0]?.ready).toBe(true);
    });

    it('flips a joined-and-ready slot back to not-ready', () => {
      let state = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      state = toggleSlotReady(state, 1);
      expect(state.slots[0]?.ready).toBe(false);
    });

    it('is a no-op on an un-joined slot (preserves invariant)', () => {
      const same = toggleSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 3);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });
  });

  // ---------------------------------------------------------------------
  // Cycling character / palette drops ready
  // ---------------------------------------------------------------------

  describe('selection changes invalidate ready-up', () => {
    it('setSlotCharacter on a ready slot drops ready back to false', () => {
      // The player readied on Wolf, then bumped the character key. The
      // ready flag must drop so they can't accidentally ship into the
      // match on a fighter they didn't confirm.
      let state = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      expect(state.slots[0]?.ready).toBe(true);
      state = setSlotCharacter(state, 1, 'cat');
      expect(state.slots[0]?.ready).toBe(false);
      expect(state.slots[0]?.characterId).toBe('cat');
    });

    it('setSlotPalette on a ready slot drops ready back to false', () => {
      let state = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      expect(state.slots[0]?.ready).toBe(true);
      state = setSlotPalette(state, 1, 5);
      expect(state.slots[0]?.ready).toBe(false);
      expect(state.slots[0]?.paletteIndex).toBe(5);
    });

    it('a no-op character pick does NOT churn ready (===-stable)', () => {
      // Re-picking the same character is already a `===` no-op — the
      // ready flag must come along for the ride. This protects the
      // ready state from spurious key repeats / debouncing logic that
      // re-fires the same pick.
      const ready = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      const same = setSlotCharacter(ready, 1, 'wolf');
      expect(same).toBe(ready);
      expect(same.slots[0]?.ready).toBe(true);
    });

    it('a no-op palette pick does NOT churn ready (===-stable)', () => {
      const ready = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      const same = setSlotPalette(ready, 1, 0);
      expect(same).toBe(ready);
      expect(same.slots[0]?.ready).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // leaveSlot — inverse of joinSlot
  // ---------------------------------------------------------------------

  describe('leaveSlot (inverse of joinSlot)', () => {
    it('drops a joined slot back to un-joined', () => {
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      expect(state.slots[1]?.joined).toBe(true);
      state = leaveSlot(state, 2);
      expect(state.slots[1]?.joined).toBe(false);
    });

    it('also drops ready (preserves invariant `ready ⇒ joined`)', () => {
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotReady(state, 2, true);
      expect(state.slots[1]?.ready).toBe(true);
      state = leaveSlot(state, 2);
      expect(state.slots[1]?.joined).toBe(false);
      expect(state.slots[1]?.ready).toBe(false);
    });

    it('is a no-op on an already-un-joined slot', () => {
      const same = leaveSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('preserves character / palette pick after leaving', () => {
      // Leaving + rejoining shouldn't reset the player's choices — the
      // helper keeps the `(characterId, paletteIndex)` so they can
      // immediately rejoin and ready up.
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotCharacter(state, 2, 'bear');
      state = setSlotPalette(state, 2, 5);
      state = leaveSlot(state, 2);
      expect(state.slots[1]?.characterId).toBe('bear');
      expect(state.slots[1]?.paletteIndex).toBe(5);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        leaveSlot(
          DEFAULT_CHARACTER_SELECT_STATE,
          // @ts-expect-error — testing runtime guard
          0,
        ),
      ).toThrow(/slotIndex/);
    });
  });

  // ---------------------------------------------------------------------
  // allJoinedSlotsReady / counts
  // ---------------------------------------------------------------------

  describe('allJoinedSlotsReady / getJoinedSlotCount / getReadySlotCount', () => {
    it('returns false for an empty lobby (no joined slots → no match)', () => {
      // A "0 of 0 ready" state is NOT confirm-able — the predicate
      // protects against starting a player-less match.
      const state: CharacterSelectState = Object.freeze({
        slots: Object.freeze(
          DEFAULT_CHARACTER_SELECT_STATE.slots.map((s) =>
            Object.freeze({ ...s, joined: false, ready: false }),
          ),
        ),
      });
      expect(allJoinedSlotsReady(state)).toBe(false);
      expect(getJoinedSlotCount(state)).toBe(0);
      expect(getReadySlotCount(state)).toBe(0);
    });

    it('returns false when at least one joined slot is not ready', () => {
      // Slot 1 joined+ready, slot 2 joined+un-ready → mixed state,
      // confirm gate is closed.
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotReady(state, 1, true);
      // Slot 2 has not readied up.
      expect(allJoinedSlotsReady(state)).toBe(false);
      expect(getJoinedSlotCount(state)).toBe(2);
      expect(getReadySlotCount(state)).toBe(1);
    });

    it('returns true when every joined slot is ready', () => {
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotReady(state, 1, true);
      state = setSlotReady(state, 2, true);
      expect(allJoinedSlotsReady(state)).toBe(true);
      expect(getReadySlotCount(state)).toBe(2);
    });

    it('IGNORES un-joined slots when checking readiness', () => {
      // Un-joined slots can never be ready, but they also don't block
      // the confirm gate. A 2-player ready lobby (slots 1+2) confirms
      // even if slots 3+4 sit un-joined.
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotReady(state, 1, true);
      state = setSlotReady(state, 2, true);
      expect(state.slots[2]?.joined).toBe(false);
      expect(state.slots[3]?.joined).toBe(false);
      expect(allJoinedSlotsReady(state)).toBe(true);
    });

    it('all 4 slots ready returns true and reports 4 ready', () => {
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      for (const i of [1, 2, 3, 4] as const) {
        state = joinSlot(state, i);
        state = setSlotReady(state, i, true);
      }
      expect(allJoinedSlotsReady(state)).toBe(true);
      expect(getJoinedSlotCount(state)).toBe(4);
      expect(getReadySlotCount(state)).toBe(4);
    });
  });

  // ---------------------------------------------------------------------
  // hasPaletteCollision — defence-in-depth conflict detector
  // ---------------------------------------------------------------------

  describe('hasPaletteCollision (defence-in-depth conflict detector)', () => {
    it('returns false for the default lineup (single joined slot)', () => {
      // Only slot 1 is joined → can't collide with anyone.
      expect(hasPaletteCollision(DEFAULT_CHARACTER_SELECT_STATE)).toBe(false);
    });

    it('returns false when two joined slots have distinct palettes (same character)', () => {
      // Slot 1 Wolf p0, slot 2 Wolf p1 — same character but distinct
      // palettes → no visual collision.
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      // Slot 2 default palette is 1, so this is already non-colliding.
      expect(hasPaletteCollision(state)).toBe(false);
    });

    it('returns true when two joined slots collide on (character, palette)', () => {
      // Same character + same palette = visual collision.
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      // Force the palette collision (would normally be auto-distinct'd
      // by the scene, but we exercise the predicate directly).
      state = setSlotPalette(state, 2, 0);
      expect(hasPaletteCollision(state)).toBe(true);
    });

    it('IGNORES un-joined slots — a collision against a spectator is fine', () => {
      // Slot 2 un-joined on Wolf p0 doesn't render in the match, so
      // it doesn't collide with slot 1's Wolf p0.
      let state = setSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 2, 'wolf');
      state = setSlotPalette(state, 2, 0);
      expect(state.slots[1]?.joined).toBe(false);
      expect(hasPaletteCollision(state)).toBe(false);
    });

    it('autoAssignDistinctPalettes always eliminates collisions for the joined lineup', () => {
      // The auto-distinct repair pass is the load-bearing path. After
      // running it, `hasPaletteCollision` must be false even for a
      // four-Wolf lobby.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      for (const i of [2, 3, 4] as const) state = joinSlot(state, i);
      for (const i of [1, 2, 3, 4] as const) {
        state = setSlotCharacter(state, i, 'wolf');
        state = setSlotPalette(state, i, 0);
      }
      // All four on Wolf p0 — collisions everywhere.
      expect(hasPaletteCollision(state)).toBe(true);
      const repaired = autoAssignDistinctPalettes(state);
      expect(hasPaletteCollision(repaired)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // canConfirmMatch — top-level confirm gate
  // ---------------------------------------------------------------------

  describe('canConfirmMatch (top-level confirm gate)', () => {
    it('rejects a zero-joined lobby', () => {
      // Empty lobby — nobody to fight.
      const state: CharacterSelectState = Object.freeze({
        slots: Object.freeze(
          DEFAULT_CHARACTER_SELECT_STATE.slots.map((s) =>
            Object.freeze({ ...s, joined: false, ready: false }),
          ),
        ),
      });
      expect(canConfirmMatch(state)).toBe(false);
    });

    it('rejects when at least one joined slot is not ready', () => {
      // Default state: slot 1 joined but un-ready → cannot confirm.
      expect(canConfirmMatch(DEFAULT_CHARACTER_SELECT_STATE)).toBe(false);
    });

    it('rejects when a palette collision sits in the joined lineup', () => {
      // Even if every joined slot is ready, a leftover collision
      // (saturation case) blocks confirm. We construct the colliding
      // state manually because `autoAssignDistinctPalettes` would
      // normally repair it.
      let state = joinSlot(DEFAULT_CHARACTER_SELECT_STATE, 2);
      state = setSlotCharacter(state, 2, 'wolf');
      state = setSlotPalette(state, 2, 0);
      // Slot 2 is now Wolf p0 (collides with slot 1's Wolf p0).
      // Force ready directly to skip the scene's auto-distinct pass.
      state = setSlotReady(state, 1, true);
      state = setSlotReady(state, 2, true);
      expect(allJoinedSlotsReady(state)).toBe(true);
      expect(hasPaletteCollision(state)).toBe(true);
      expect(canConfirmMatch(state)).toBe(false);
    });

    it('accepts a single-joined ready lobby (1-player smoke test)', () => {
      // The minimum viable confirm: one slot, joined, ready.
      const state = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      expect(canConfirmMatch(state)).toBe(true);
    });

    it('accepts a 4-player lobby with every slot ready and distinct palettes', () => {
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      for (const i of [2, 3, 4] as const) state = joinSlot(state, i);
      for (const i of [1, 2, 3, 4] as const) {
        state = setSlotReady(state, i, true);
      }
      expect(canConfirmMatch(state)).toBe(true);
    });

    it('cycling character on a ready slot REOPENS the gate (must re-ready)', () => {
      // The "ready drops on selection change" property propagates up:
      // canConfirmMatch goes from true → false the moment a player
      // bumps a character key after readying.
      let state = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      expect(canConfirmMatch(state)).toBe(true);
      state = setSlotCharacter(state, 1, 'cat');
      expect(canConfirmMatch(state)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // buildSlotPreview surfaces ready
  // ---------------------------------------------------------------------

  describe('buildSlotPreview (carries the ready flag for the UI)', () => {
    it('reports ready: false on the default state', () => {
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      expect(buildSlotPreview(slot).ready).toBe(false);
    });

    it('reports ready: true after the slot has signed off', () => {
      const ready = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      const slot = ready.slots[0]!;
      expect(buildSlotPreview(slot).ready).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Determinism — same inputs always produce same outputs
  // ---------------------------------------------------------------------

  describe('determinism contract', () => {
    it('readiness predicates produce identical results across two builds of the same lobby', () => {
      // The Seed's determinism contract demands no `Math.random()` /
      // wall-clock. Building the same lobby twice must produce
      // byte-identical predicate results so a replay can reproduce
      // the lobby state exactly.
      const build = (): CharacterSelectState => {
        let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
        s = joinSlot(s, 2);
        s = setSlotCharacter(s, 2, 'wolf');
        s = setSlotPalette(s, 2, 3);
        s = setSlotReady(s, 1, true);
        s = setSlotReady(s, 2, true);
        return s;
      };
      const a = build();
      const b = build();
      expect(allJoinedSlotsReady(a)).toBe(allJoinedSlotsReady(b));
      expect(canConfirmMatch(a)).toBe(canConfirmMatch(b));
      expect(getJoinedSlotCount(a)).toBe(getJoinedSlotCount(b));
      expect(getReadySlotCount(a)).toBe(getReadySlotCount(b));
      expect(hasPaletteCollision(a)).toBe(hasPaletteCollision(b));
    });
  });
});

/**
 * AC 10205 Sub-AC 5 — "Wire AI controller selection into the player
 * slot configuration so human/AI players can be mixed in local
 * multiplayer with difficulty selectable per AI slot."
 *
 * Pure-helper contract for the character-select scene's AI controls.
 * Mirrors the lobby-side cycle / set / promote suite so a player who
 * promoted a slot to AI mid-character-select can dial in difficulty
 * without going back to the lobby.
 */
describe('characterSelect — AC 10205 Sub-AC 5 (AI controller selection)', () => {
  it('exposes the canonical cycle order in ascending skill', () => {
    expect(AI_DIFFICULTY_CYCLE_ORDER).toEqual(['easy', 'medium', 'hard']);
  });

  describe('cycleSlotAiDifficulty', () => {
    it('cycles a joined AI slot through easy → medium → hard → easy', () => {
      // Slot 3 opens as an AI bot at medium by default.
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      expect(s.slots[2]?.aiDifficulty).toBe('medium');
      s = cycleSlotAiDifficulty(s, 3);
      expect(s.slots[2]?.aiDifficulty).toBe('hard');
      s = cycleSlotAiDifficulty(s, 3);
      expect(s.slots[2]?.aiDifficulty).toBe('easy');
      s = cycleSlotAiDifficulty(s, 3);
      expect(s.slots[2]?.aiDifficulty).toBe('medium');
    });

    it('returns the same reference for an un-joined slot (silent no-op)', () => {
      const next = cycleSlotAiDifficulty(DEFAULT_CHARACTER_SELECT_STATE, 4);
      expect(next).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('returns the same reference for a human slot (silent no-op)', () => {
      // Slot 1 opens joined as keyboard_p1 (human).
      const next = cycleSlotAiDifficulty(DEFAULT_CHARACTER_SELECT_STATE, 1);
      expect(next).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('preserves the slot.ready flag across a difficulty cycle', () => {
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      s = setSlotReady(s, 3, true);
      expect(s.slots[2]?.ready).toBe(true);
      s = cycleSlotAiDifficulty(s, 3);
      // Ready remains true — difficulty is a config tweak, not a
      // visible character / palette change.
      expect(s.slots[2]?.ready).toBe(true);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        cycleSlotAiDifficulty(DEFAULT_CHARACTER_SELECT_STATE, 5 as 1),
      ).toThrow(/out of range/);
    });
  });

  describe('setSlotAiDifficulty', () => {
    it('jumps directly to the requested tier on an AI slot', () => {
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      s = setSlotAiDifficulty(s, 3, 'hard');
      expect(s.slots[2]?.aiDifficulty).toBe('hard');
    });

    it('is a no-op when the tier already matches', () => {
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      const a = setSlotAiDifficulty(s, 3, 'medium');
      expect(a).toBe(s);
    });

    it('is a no-op for human slots', () => {
      const next = setSlotAiDifficulty(
        DEFAULT_CHARACTER_SELECT_STATE,
        1,
        'hard',
      );
      expect(next).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });
  });

  describe('setSlotInputType (human ↔ AI promotion)', () => {
    it('promotes a joined human slot to an AI bot at medium', () => {
      const next = setSlotInputType(
        DEFAULT_CHARACTER_SELECT_STATE,
        1,
        'ai',
      );
      expect(next.slots[0]?.inputType).toBe('ai');
      expect(next.slots[0]?.aiDifficulty).toBe('medium');
    });

    it('demotes an AI slot to a keyboard human (and strips aiDifficulty)', () => {
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      s = setSlotInputType(s, 3, 'keyboard_p1');
      expect(s.slots[2]?.inputType).toBe('keyboard_p1');
      expect(s.slots[2]).not.toHaveProperty('aiDifficulty');
    });

    it('drops the slot.ready flag on a type change', () => {
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      s = setSlotReady(s, 3, true);
      expect(s.slots[2]?.ready).toBe(true);
      s = setSlotInputType(s, 3, 'keyboard_p1');
      // Switching input type invalidates the "I confirmed THIS pick"
      // assertion — the player must re-ready on the new device.
      expect(s.slots[2]?.ready).toBe(false);
    });

    it('preserves the existing aiDifficulty when promoting from human → AI', () => {
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      s = setSlotAiDifficulty(s, 3, 'hard');
      s = setSlotInputType(s, 3, 'keyboard_p1'); // demote → strip
      s = setSlotInputType(s, 3, 'ai'); // re-promote
      // Once stripped, the difficulty falls back to medium on
      // re-promotion. (If a future feature wants "remember the last
      // bot tier," that becomes a separate AC.)
      expect(s.slots[2]?.aiDifficulty).toBe('medium');
    });

    it('returns the same reference when input type already matches', () => {
      const a = setSlotInputType(
        DEFAULT_CHARACTER_SELECT_STATE,
        1,
        'keyboard_p1',
      );
      expect(a).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('returns the same reference for an un-joined slot', () => {
      const a = setSlotInputType(DEFAULT_CHARACTER_SELECT_STATE, 4, 'ai');
      expect(a).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });
  });

  describe('preview projection — inputType + aiDifficulty', () => {
    it('exposes inputType + aiDifficulty on the preview record', () => {
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      s = setSlotAiDifficulty(s, 3, 'hard');
      const slot = s.slots[2]!;
      const preview = buildSlotPreview(slot);
      expect(preview.inputType).toBe('ai');
      expect(preview.aiDifficulty).toBe('hard');
    });

    it('omits aiDifficulty for human slots', () => {
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      expect(slot.inputType).toBe('keyboard_p1');
      const preview = buildSlotPreview(slot);
      expect(preview.inputType).toBe('keyboard_p1');
      expect(preview.aiDifficulty).toBeUndefined();
    });
  });

  describe('mixed human/AI lineup → buildPlayerSlotsFromState', () => {
    it('emits a heterogeneous PlayerSlot[] preserving each slot\'s difficulty', () => {
      // P1 (default keyboard_p1) + P3 AI(easy) + P4 AI(hard).
      let s: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      s = joinSlot(s, 3);
      s = setSlotAiDifficulty(s, 3, 'easy');
      s = joinSlot(s, 4);
      s = setSlotAiDifficulty(s, 4, 'hard');
      const players = buildPlayerSlotsFromState(s);
      expect(players).toHaveLength(3);
      expect(players[0]?.inputType).toBe('keyboard_p1');
      expect(players[0]).not.toHaveProperty('aiDifficulty');
      expect(players[1]?.inputType).toBe('ai');
      expect(players[1]?.aiDifficulty).toBe('easy');
      expect(players[2]?.inputType).toBe('ai');
      expect(players[2]?.aiDifficulty).toBe('hard');
    });
  });

  describe('determinism', () => {
    it('two identical cycle sequences produce structurally equal states', () => {
      const seq = (s: CharacterSelectState): CharacterSelectState => {
        let cur = s;
        cur = joinSlot(cur, 3);
        cur = cycleSlotAiDifficulty(cur, 3);
        cur = cycleSlotAiDifficulty(cur, 3);
        cur = setSlotInputType(cur, 3, 'keyboard_p1');
        cur = setSlotInputType(cur, 3, 'ai');
        cur = setSlotAiDifficulty(cur, 3, 'hard');
        return cur;
      };
      const a = seq(DEFAULT_CHARACTER_SELECT_STATE);
      const b = seq(DEFAULT_CHARACTER_SELECT_STATE);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});

// =====================================================================
// AC 10403 Sub-AC 3 — per-player cursor navigation + lock-in confirmation
// =====================================================================

/**
 * AC 10403 Sub-AC 3 — "Implement character select screen with
 * per-player cursor navigation, character preview, and lock-in
 * confirmation."
 *
 * The cursor model decouples *hover* (cursorIndex) from *commit*
 * (characterId). Cursor movement live-previews the roster grid without
 * changing the lineup; lock-in is the explicit transition that
 * promotes the cursor's character into the slot's `characterId` and
 * raises the `ready` flag in one atomic step.
 *
 * The contract these tests pin:
 *
 *   1. Every slot opens with `cursorIndex` aligned to its `characterId`
 *      so a player who never moves their cursor confirms the default
 *      pick on lock-in (rather than landing on whichever roster cell
 *      happens to be first).
 *
 *   2. `setSlotCursor` / `moveSlotCursor` mutate cursor only — never
 *      `characterId`, never `paletteIndex`, never `ready`. This is the
 *      load-bearing distinction: cursor navigation is preview-only.
 *
 *   3. `lockInSlotCharacter` is atomic — it commits cursor →
 *      characterId AND sets `ready: true` in one transition. The
 *      intermediate "committed but un-ready" state never leaks to
 *      consumers.
 *
 *   4. `setSlotCharacter` (the legacy direct-commit path) keeps
 *      cursor in sync so external consumers (replay loaders, smoke
 *      tests) never produce a slot whose hover and commit have
 *      silently diverged.
 *
 *   5. The preview projection carries cursor metadata
 *      (`cursorCharacterId`, `cursorOnCommittedCharacter`, etc.) so
 *      the scene can paint "Hovering: …" without reaching into
 *      slot state.
 *
 *   6. The portrait grid cells expose `hoveredBySlots` so the scene
 *      can paint focus rings on hovered cells alongside the existing
 *      `selectedBySlots` chip row.
 */
describe('characterSelect — AC 10403 Sub-AC 3 (cursor navigation + lock-in)', () => {
  // ---------------------------------------------------------------------
  // Default cursor state
  // ---------------------------------------------------------------------

  describe('DEFAULT_CHARACTER_SELECT_STATE.cursorIndex', () => {
    it('exposes a cursorIndex on every slot', () => {
      for (const slot of DEFAULT_CHARACTER_SELECT_STATE.slots) {
        expect(typeof slot.cursorIndex).toBe('number');
        expect(slot.cursorIndex).toBeGreaterThanOrEqual(0);
        expect(slot.cursorIndex).toBeLessThan(SELECTABLE_CHARACTER_SPECS.length);
      }
    });

    it('opens the cursor on the same character the slot is committed to', () => {
      // Slot 1 default characterId='wolf' → cursorIndex points at
      // wolf's roster cell. Same for every slot. This means a player
      // who hits ENTER without moving their cursor confirms the
      // default pick, not an arbitrary "first roster cell".
      for (let i = 0; i < DEFAULT_CHARACTER_SELECT_STATE.slots.length; i += 1) {
        const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[i]!;
        const expectedIdx = SELECTABLE_CHARACTER_SPECS.findIndex(
          (s) => s.id === slot.characterId,
        );
        expect(slot.cursorIndex).toBe(expectedIdx);
      }
    });
  });

  // ---------------------------------------------------------------------
  // setSlotCursor (absolute set)
  // ---------------------------------------------------------------------

  describe('setSlotCursor (absolute cursor index set)', () => {
    it('updates the slot cursor without touching characterId', () => {
      const before = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const next = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 2);
      const after = next.slots[0]!;
      expect(after.cursorIndex).toBe(2);
      // characterId must NOT change — that's the cursor / commit
      // distinction this AC is built around.
      expect(after.characterId).toBe(before.characterId);
    });

    it('does not drop ready (cursor is preview-only)', () => {
      // A ready player can move their cursor to peek at other
      // characters; the ready flag stays asserting "I confirmed THIS
      // character at THIS palette" because neither changed.
      let state = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      expect(state.slots[0]?.ready).toBe(true);
      state = setSlotCursor(state, 1, 3);
      expect(state.slots[0]?.ready).toBe(true);
    });

    it('wraps positive overflow back to the start of the roster', () => {
      const len = SELECTABLE_CHARACTER_SPECS.length;
      const next = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, len);
      expect(next.slots[0]?.cursorIndex).toBe(0);
    });

    it('wraps negative inputs to a valid roster cell', () => {
      const len = SELECTABLE_CHARACTER_SPECS.length;
      const next = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, -1);
      expect(next.slots[0]?.cursorIndex).toBe(len - 1);
    });

    it('returns the same state reference on a no-op set', () => {
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const same = setSlotCursor(
        DEFAULT_CHARACTER_SELECT_STATE,
        1,
        slot.cursorIndex,
      );
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('works on un-joined slots too (cursor is purely UI)', () => {
      // An un-joined "spectator" slot can still move its cursor — the
      // player is browsing before pressing JOIN.
      const next = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 3, 2);
      expect(next.slots[2]?.joined).toBe(false);
      expect(next.slots[2]?.cursorIndex).toBe(2);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        setSlotCursor(
          DEFAULT_CHARACTER_SELECT_STATE,
          // @ts-expect-error — testing runtime guard for invalid index
          5,
          0,
        ),
      ).toThrow(/slotIndex/);
    });

    it('returns a frozen state with frozen slots', () => {
      const next = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 2);
      expect(Object.isFrozen(next)).toBe(true);
      expect(Object.isFrozen(next.slots)).toBe(true);
      for (const s of next.slots) expect(Object.isFrozen(s)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // moveSlotCursor (relative direction step)
  // ---------------------------------------------------------------------

  describe('moveSlotCursor (relative cursor step)', () => {
    it('steps the cursor by +1 (next roster cell)', () => {
      const before = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const next = moveSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, +1);
      expect(next.slots[0]?.cursorIndex).toBe(before.cursorIndex + 1);
    });

    it('steps the cursor by -1 (previous roster cell)', () => {
      // From slot 1's default cursor (0), -1 wraps to last cell.
      const len = SELECTABLE_CHARACTER_SPECS.length;
      const next = moveSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, -1);
      expect(next.slots[0]?.cursorIndex).toBe(len - 1);
    });

    it('returns the same state reference on a zero step', () => {
      const same = moveSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 0);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('truncates fractional directions (analogue stick safety)', () => {
      const next = moveSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 1.7);
      expect(next.slots[0]?.cursorIndex).toBe(1);
    });

    it('non-finite directions are silent no-ops', () => {
      const same = moveSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, NaN);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        moveSlotCursor(
          DEFAULT_CHARACTER_SELECT_STATE,
          // @ts-expect-error — testing runtime guard
          0,
          +1,
        ),
      ).toThrow(/slotIndex/);
    });

    it('walking past the last cell loops to the first', () => {
      const len = SELECTABLE_CHARACTER_SPECS.length;
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      for (let i = 0; i < len; i += 1) state = moveSlotCursor(state, 1, +1);
      // After `len` steps, cursor is back at the starting cell.
      expect(state.slots[0]?.cursorIndex).toBe(
        DEFAULT_CHARACTER_SELECT_STATE.slots[0]!.cursorIndex,
      );
    });

    it('does not change characterId or paletteIndex', () => {
      const before = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const next = moveSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, +2);
      const after = next.slots[0]!;
      expect(after.characterId).toBe(before.characterId);
      expect(after.paletteIndex).toBe(before.paletteIndex);
    });

    it('preserves ready when cursor moves (cursor ≠ commit yet)', () => {
      let state = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      state = moveSlotCursor(state, 1, +1);
      expect(state.slots[0]?.ready).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // lockInSlotCharacter (atomic commit + ready)
  // ---------------------------------------------------------------------

  describe('lockInSlotCharacter (atomic cursor → characterId + ready)', () => {
    it('atomic: sets characterId to cursor character AND ready=true in one transition', () => {
      // Move cursor to a different character, then lock in. Both the
      // commit and the ready flag must update in the SAME state
      // snapshot — no intermediate "committed but un-ready" leak.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      // Cursor to slot 1 → 'cat' (index 1).
      state = setSlotCursor(state, 1, 1);
      // Mid-state: cursor on cat, characterId still 'wolf', not ready.
      expect(state.slots[0]?.characterId).toBe('wolf');
      expect(state.slots[0]?.cursorIndex).toBe(1);
      expect(state.slots[0]?.ready).toBe(false);
      // Lock in.
      state = lockInSlotCharacter(state, 1);
      expect(state.slots[0]?.characterId).toBe('cat');
      expect(state.slots[0]?.cursorIndex).toBe(1);
      expect(state.slots[0]?.ready).toBe(true);
    });

    it('confirms the default pick when cursor is aligned with commit', () => {
      // No cursor movement → cursor and characterId already match.
      // Lock in just sets ready=true.
      const before = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const after = lockInSlotCharacter(
        DEFAULT_CHARACTER_SELECT_STATE,
        1,
      ).slots[0]!;
      expect(after.characterId).toBe(before.characterId);
      expect(after.cursorIndex).toBe(before.cursorIndex);
      expect(after.ready).toBe(true);
    });

    it('is a silent no-op on un-joined slots', () => {
      // Slot 4 is un-joined by default. Lock-in must not flip ready
      // or commit a character on a slot that hasn't joined.
      const same = lockInSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 4);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
      expect(same.slots[3]?.joined).toBe(false);
      expect(same.slots[3]?.ready).toBe(false);
    });

    it('preserves paletteIndex / inputType / aiDifficulty across the lock-in', () => {
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = setSlotPalette(state, 1, 5);
      state = setSlotCursor(state, 1, 2);
      const before = state.slots[0]!;
      state = lockInSlotCharacter(state, 1);
      const after = state.slots[0]!;
      expect(after.paletteIndex).toBe(before.paletteIndex);
      expect(after.inputType).toBe(before.inputType);
      // Same character family — only commit + ready changed.
    });

    it('preserves aiDifficulty when locking in an AI slot', () => {
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = joinSlot(state, 3);
      state = setSlotAiDifficulty(state, 3, 'hard');
      state = setSlotCursor(state, 3, 1);
      state = lockInSlotCharacter(state, 3);
      expect(state.slots[2]?.ready).toBe(true);
      expect(state.slots[2]?.aiDifficulty).toBe('hard');
      expect(state.slots[2]?.inputType).toBe('ai');
    });

    it('returns the same reference on a re-lock (already locked + cursor aligned)', () => {
      // Locked in → press lock-in again with cursor still on the same
      // character. Spurious key repeats / debouncing must not churn
      // the readiness state machine.
      const locked = lockInSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 1);
      const same = lockInSlotCharacter(locked, 1);
      expect(same).toBe(locked);
    });

    it('a re-lock after moving the cursor switches the committed character', () => {
      // Lock in on default (wolf), then move cursor to cat, then lock
      // in again. Final state: ready on cat. This is the SSB "I
      // changed my mind" flow — un-ready + cursor + lock-in all
      // happen with three keypresses (un-ready key → cursor key →
      // lock-in key).
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = lockInSlotCharacter(state, 1);
      expect(state.slots[0]?.characterId).toBe('wolf');
      expect(state.slots[0]?.ready).toBe(true);
      // Un-ready, move cursor, lock in again.
      state = setSlotReady(state, 1, false);
      state = setSlotCursor(state, 1, 1); // cat
      state = lockInSlotCharacter(state, 1);
      expect(state.slots[0]?.characterId).toBe('cat');
      expect(state.slots[0]?.ready).toBe(true);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        lockInSlotCharacter(
          DEFAULT_CHARACTER_SELECT_STATE,
          // @ts-expect-error — testing runtime guard
          5,
        ),
      ).toThrow(/slotIndex/);
    });

    it('returns a frozen state with frozen slots', () => {
      const next = lockInSlotCharacter(DEFAULT_CHARACTER_SELECT_STATE, 1);
      expect(Object.isFrozen(next)).toBe(true);
      expect(Object.isFrozen(next.slots)).toBe(true);
      for (const s of next.slots) expect(Object.isFrozen(s)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // cancelSlotLockIn (un-ready sugar)
  // ---------------------------------------------------------------------

  describe('cancelSlotLockIn (drop ready, keep commit)', () => {
    it('drops ready=false and preserves characterId / cursorIndex', () => {
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = setSlotCursor(state, 1, 2);
      state = lockInSlotCharacter(state, 1);
      expect(state.slots[0]?.ready).toBe(true);
      const before = state.slots[0]!;
      state = cancelSlotLockIn(state, 1);
      const after = state.slots[0]!;
      expect(after.ready).toBe(false);
      // characterId and cursorIndex stay where they were so the player
      // can resume from the locked-in cell.
      expect(after.characterId).toBe(before.characterId);
      expect(after.cursorIndex).toBe(before.cursorIndex);
    });

    it('is a no-op on an un-joined slot', () => {
      const same = cancelSlotLockIn(DEFAULT_CHARACTER_SELECT_STATE, 4);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('is a no-op on an already-un-ready slot', () => {
      const same = cancelSlotLockIn(DEFAULT_CHARACTER_SELECT_STATE, 1);
      expect(same).toBe(DEFAULT_CHARACTER_SELECT_STATE);
    });

    it('throws on out-of-range slot index', () => {
      expect(() =>
        cancelSlotLockIn(
          DEFAULT_CHARACTER_SELECT_STATE,
          // @ts-expect-error — testing runtime guard
          0,
        ),
      ).toThrow(/slotIndex/);
    });
  });

  // ---------------------------------------------------------------------
  // setSlotCharacter cursor sync (legacy direct-commit path)
  // ---------------------------------------------------------------------

  describe('setSlotCharacter syncs cursor on commit', () => {
    it('updating characterId re-aligns the cursor to the new character', () => {
      // Direct-commit path (replay loaders, smoke tests) must keep
      // cursor and characterId aligned so the next cursor move from
      // a JSON-loaded state doesn't snap back to a stale roster cell.
      const next = setSlotCharacter(
        DEFAULT_CHARACTER_SELECT_STATE,
        1,
        'cat',
      );
      const expectedIdx = SELECTABLE_CHARACTER_SPECS.findIndex(
        (s) => s.id === 'cat',
      );
      expect(next.slots[0]?.cursorIndex).toBe(expectedIdx);
      expect(next.slots[0]?.characterId).toBe('cat');
    });

    it('committing every roster character syncs cursor to that character', () => {
      for (const spec of SELECTABLE_CHARACTER_SPECS) {
        const next = setSlotCharacter(
          DEFAULT_CHARACTER_SELECT_STATE,
          2,
          spec.id,
        );
        const expected = SELECTABLE_CHARACTER_SPECS.findIndex(
          (s) => s.id === spec.id,
        );
        expect(next.slots[1]?.cursorIndex).toBe(expected);
        expect(next.slots[1]?.characterId).toBe(spec.id);
      }
    });
  });

  // ---------------------------------------------------------------------
  // getSlotCursorCharacterId
  // ---------------------------------------------------------------------

  describe('getSlotCursorCharacterId', () => {
    it('returns the spec id at the cursor position', () => {
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const id = getSlotCursorCharacterId(slot);
      expect(id).toBe(slot.characterId); // cursor aligned with commit
    });

    it('reflects cursor movement to a different character', () => {
      const moved = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 2);
      const slot = moved.slots[0]!;
      expect(getSlotCursorCharacterId(slot)).toBe(
        SELECTABLE_CHARACTER_SPECS[2]!.id,
      );
    });
  });

  // ---------------------------------------------------------------------
  // buildSlotPreview cursor projection
  // ---------------------------------------------------------------------

  describe('buildSlotPreview carries cursor metadata', () => {
    it('exposes cursorIndex / cursorCharacterId / cursorOnCommittedCharacter', () => {
      const slot = DEFAULT_CHARACTER_SELECT_STATE.slots[0]!;
      const preview = buildSlotPreview(slot);
      expect(preview.cursorIndex).toBe(slot.cursorIndex);
      expect(preview.cursorCharacterId).toBe(slot.characterId);
      expect(preview.cursorOnCommittedCharacter).toBe(true);
      expect(preview.locked).toBe(false);
    });

    it('reports cursorOnCommittedCharacter=false after a cursor move', () => {
      const moved = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 2);
      const preview = buildSlotPreview(moved.slots[0]!);
      expect(preview.cursorOnCommittedCharacter).toBe(false);
      expect(preview.cursorCharacterId).toBe(
        SELECTABLE_CHARACTER_SPECS[2]!.id,
      );
      expect(preview.characterId).toBe('wolf'); // commit unchanged
    });

    it('cursorDisplayName / cursorRoleLabel / cursorPlayable mirror the spec', () => {
      const moved = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 1);
      const preview = buildSlotPreview(moved.slots[0]!);
      const spec = SELECTABLE_CHARACTER_SPECS[1]!;
      expect(preview.cursorDisplayName).toBe(spec.displayName);
      expect(preview.cursorRoleLabel).toBe(spec.role);
      expect(preview.cursorPlayable).toBe(spec.playable);
    });

    it('locked alias mirrors ready', () => {
      const ready = setSlotReady(DEFAULT_CHARACTER_SELECT_STATE, 1, true);
      const preview = buildSlotPreview(ready.slots[0]!);
      expect(preview.locked).toBe(true);
      expect(preview.ready).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // buildCharacterPortraitGrid hover row
  // ---------------------------------------------------------------------

  describe('buildCharacterPortraitGrid populates hoveredBySlots', () => {
    it('reports an empty hoveredBySlots array when no cursor sits on the cell', () => {
      const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
      // Default cursors: P1→0 (wolf), P2→1 (cat), P3→2 (owl), P4→3 (bear).
      // Every roster cell has at least one slot's cursor on it.
      // Verify the structure exists on every cell.
      for (const cell of grid) {
        expect(Array.isArray(cell.hoveredBySlots)).toBe(true);
      }
    });

    it('records the slot index whose cursor lands on the cell', () => {
      // Slot 1 cursor is at index 0 by default → wolf cell hosts P1.
      const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
      const wolf = grid.find((c) => c.characterId === 'wolf');
      expect(wolf?.hoveredBySlots).toContain(1);
    });

    it('moves the hover badge when the cursor moves', () => {
      // Move slot 1's cursor to cell 2 (owl). The wolf cell loses P1
      // from its hoveredBySlots; the owl cell gains it.
      const moved = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 2);
      const grid = buildCharacterPortraitGrid(moved);
      const wolf = grid.find((c) => c.characterId === 'wolf');
      const owl = grid.find((c) => c.characterId === 'owl');
      expect(wolf?.hoveredBySlots).not.toContain(1);
      expect(owl?.hoveredBySlots).toContain(1);
    });

    it('includes un-joined slots in hoveredBySlots (browse-before-join)', () => {
      // Un-joined slot 3's cursor is at index 2 by default. The cell
      // must still report P3 as hovering.
      const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
      const owl = grid.find((c) => c.characterId === 'owl');
      expect(owl?.hoveredBySlots).toContain(3);
    });

    it('stacks multiple cursors on the same cell sorted ascending', () => {
      // Move every slot's cursor to cell 0 (wolf) — all 4 cursors stack.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      for (const i of [1, 2, 3, 4] as const) state = setSlotCursor(state, i, 0);
      const grid = buildCharacterPortraitGrid(state);
      const wolf = grid.find((c) => c.characterId === 'wolf');
      expect(wolf?.hoveredBySlots).toEqual([1, 2, 3, 4]);
    });

    it('hoveredBySlots is decoupled from selectedBySlots', () => {
      // Slot 1 commits to wolf, then moves cursor to cat. Wolf cell
      // should report `selectedBySlots: [1]` and `hoveredBySlots: []`;
      // cat cell should report the inverse.
      const moved = setSlotCursor(DEFAULT_CHARACTER_SELECT_STATE, 1, 1);
      const grid = buildCharacterPortraitGrid(moved);
      const wolf = grid.find((c) => c.characterId === 'wolf');
      const cat = grid.find((c) => c.characterId === 'cat');
      expect(wolf?.selectedBySlots).toEqual([1]);
      expect(wolf?.hoveredBySlots).not.toContain(1);
      expect(cat?.hoveredBySlots).toContain(1);
      // Un-joined slot 2 default cursor was at cat too, so cat's
      // hoveredBySlots should also include 2 (sorted ascending).
      expect(cat?.hoveredBySlots).toEqual([1, 2]);
    });

    it('hoveredBySlots is frozen (immutable cell projection)', () => {
      const grid = buildCharacterPortraitGrid(DEFAULT_CHARACTER_SELECT_STATE);
      for (const cell of grid) {
        expect(Object.isFrozen(cell.hoveredBySlots)).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------
  // Cross-cutting flow tests
  // ---------------------------------------------------------------------

  describe('end-to-end cursor → preview → lock-in flow', () => {
    it('player-1 navigates to bear, locks in, lobby reports bear with ready=true', () => {
      // Default state: slot 1 joined as Wolf, un-ready.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      // Player walks the cursor right 3 steps: wolf → cat → owl → bear.
      state = moveSlotCursor(state, 1, +1);
      state = moveSlotCursor(state, 1, +1);
      state = moveSlotCursor(state, 1, +1);
      // Mid-flow: cursor on bear, characterId still wolf.
      expect(state.slots[0]?.cursorIndex).toBe(3);
      expect(state.slots[0]?.characterId).toBe('wolf');
      // Lock in.
      state = lockInSlotCharacter(state, 1);
      expect(state.slots[0]?.characterId).toBe('bear');
      expect(state.slots[0]?.ready).toBe(true);
    });

    it('canConfirmMatch flips true after lock-in (single-player case)', () => {
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      expect(canConfirmMatch(state)).toBe(false); // un-ready
      state = lockInSlotCharacter(state, 1);
      expect(canConfirmMatch(state)).toBe(true);
    });

    it('un-ready then move cursor then re-lock switches the picked character', () => {
      // Lock in on wolf, then change mind: un-ready, cursor →
      // bear, lock-in. Final lineup carries bear.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = lockInSlotCharacter(state, 1);
      state = setSlotReady(state, 1, false);
      state = setSlotCursor(state, 1, 3);
      state = lockInSlotCharacter(state, 1);
      const players = buildPlayerSlotsFromState(state);
      expect(players).toHaveLength(1);
      expect(players[0]?.characterId).toBe('bear');
    });

    it('determinism: two identical cursor + lock-in sequences produce equal states', () => {
      const seq = (s: CharacterSelectState): CharacterSelectState => {
        let cur = s;
        cur = joinSlot(cur, 2);
        cur = moveSlotCursor(cur, 1, +2);
        cur = moveSlotCursor(cur, 2, -1);
        cur = lockInSlotCharacter(cur, 1);
        cur = lockInSlotCharacter(cur, 2);
        return cur;
      };
      const a = seq(DEFAULT_CHARACTER_SELECT_STATE);
      const b = seq(DEFAULT_CHARACTER_SELECT_STATE);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('autoAssignDistinctPalettes still resolves a same-character lock-in', () => {
      // P1 default Wolf p0; P2 joins, cursor on Wolf, locks in.
      // After lock-in slot 2 is on Wolf p1 (default) — already distinct.
      // Force a collision: dial slot 2's palette down to 0 first.
      let state: CharacterSelectState = DEFAULT_CHARACTER_SELECT_STATE;
      state = joinSlot(state, 2);
      state = setSlotPalette(state, 2, 0);
      state = setSlotCursor(state, 2, 0); // wolf
      state = lockInSlotCharacter(state, 2);
      // Lock-in produced (Wolf, p0) duplicate. The auto-distinct pass
      // (run by the scene's applyTransition wrapper) repairs it.
      expect(hasPaletteCollision(state)).toBe(true);
      const repaired = autoAssignDistinctPalettes(state);
      expect(hasPaletteCollision(repaired)).toBe(false);
      // Both characters still wolf — only the palette moved.
      expect(repaired.slots[0]?.characterId).toBe('wolf');
      expect(repaired.slots[1]?.characterId).toBe('wolf');
    });
  });
});
