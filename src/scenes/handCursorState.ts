/**
 * Phaser-free state model for the hand-cursor character-select rewrite.
 *
 * Replaces the keyboard-driven per-slot navigation in `characterSelect.ts`
 * with a Smash-Bros-style cursor model: every slot owns a free-roaming
 * "hand" sprite that the player drives with their gamepad d-pad (or
 * mouse, for keyboard convenience). Light attack picks whatever the
 * cursor is over; special attack cancels the slot's pick.
 *
 * Layering note
 * -------------
 * This module is the *new* selection state. The Phaser scene (Phase 2)
 * owns the layout, runs the hit-test each frame, and feeds the result
 * back through {@link setHoveredTarget}. The reducer never sees layout
 * — it is unit-agnostic on cursor coords (scene supplies the clamp
 * bounds) and target-agnostic on what's under the cursor (scene supplies
 * the discriminated `HoveredTarget`). That keeps the whole module
 * vitest-friendly without mocking Phaser.
 *
 * The {@link toCharacterSelectState} adapter at the bottom maps this
 * state into the legacy `CharacterSelectState` so the existing
 * `buildPlayerSlotsFromState` → MatchScene pipeline keeps working
 * unchanged. The lobby-handoff and downstream replay contracts both
 * remain authoritative; this module only changes the *input* surface.
 *
 * Determinism contract
 * --------------------
 * Every transition is a deterministic pure function: no `Math.random()`,
 * no wall-clock reads, no Phaser globals. Two scenes that received the
 * same hand-cursor inputs in the same order produce byte-identical
 * `PlayerSlot[]` arrays.
 */

import type {
  AiDifficulty,
  CharacterId,
  InputType,
  PlayerSlot,
} from '../types';
import {
  MAX_PLAYER_SLOTS,
  PALETTE_COUNT,
  SELECTABLE_CHARACTER_SPECS,
  buildPlayerSlotsFromState,
} from './characterSelect';
import type { CharacterSelectState } from './characterSelect';

// ---------------------------------------------------------------------------
// Public type model
// ---------------------------------------------------------------------------

/**
 * Per-slot mode toggle. The Smash-Bros-style slot tile cycles
 * `empty → human → bot → empty`. Empty slots are excluded from the
 * resulting `PlayerSlot[]` lineup; human slots take their input from
 * `inputType`; bot slots run an AI driver at `aiDifficulty`.
 */
export type SlotMode = 'empty' | 'human' | 'bot';

/** Cycle order used by {@link cycleSlotMode}. */
export const SLOT_MODE_CYCLE_ORDER: ReadonlyArray<SlotMode> = Object.freeze([
  'empty',
  'human',
  'bot',
]);

/**
 * Discriminated union — what the scene's hit-test reports the cursor is
 * currently over. The scene calls {@link setHoveredTarget} every frame
 * (after running its own pixel-rect hit-test) so the reducer's
 * {@link selectAtCursor} dispatch can route the press to the right
 * action without ever knowing the layout.
 *
 *   • `none`              — cursor is in empty space.
 *   • `portrait`          — cursor is over a roster portrait cell.
 *   • `slot-tile-mode`    — cursor is over a slot tile's mode toggle
 *                           button (Empty/Human/Bot rotator).
 *   • `slot-tile-palette` — cursor is over a slot tile's palette swatch
 *                           strip (a particular palette index in the
 *                           strip is identified separately when the
 *                           scene calls `setSlotPalette` directly).
 */
export type HoveredTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'portrait'; readonly portraitIndex: number }
  | { readonly kind: 'slot-tile-mode'; readonly slotIndex: 1 | 2 | 3 | 4 }
  | {
      readonly kind: 'slot-tile-palette';
      readonly slotIndex: 1 | 2 | 3 | 4;
    };

/** Frozen "no hover" sentinel — re-used so equality is `===` cheap. */
export const HOVERED_TARGET_NONE: HoveredTarget = Object.freeze({
  kind: 'none' as const,
});

/**
 * Cursor position in scene-local coords. The reducer is unit-agnostic —
 * the scene picks pixels (or normalised 0..1, or whatever) and supplies
 * matching `bounds` to {@link moveHand}. Stored as a plain `{x, y}`
 * record so consumers can spread it into Phaser sprite positions
 * without a conversion pass.
 */
export interface HandCursorPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * Inclusive clamp bounds passed to {@link moveHand} so the cursor stays
 * inside the scene viewport. The scene typically derives these from the
 * Phaser camera viewport rect on resize.
 */
export interface HandCursorBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * One slot's worth of hand-cursor state. Pure data — every transition
 * produces a brand-new frozen object so consumers can compare snapshots
 * with `===` and skip re-rendering on a no-op.
 *
 *   • `index`              — slot number (1..4). Mirrors `PlayerSlot.index`.
 *   • `mode`               — empty / human / bot. Cycles via the slot
 *                            tile's mode button. Empty slots produce
 *                            no `PlayerSlot` in the final lineup.
 *   • `inputType`          — which device feeds this slot when it's
 *                            human. Carries through to MatchScene.
 *                            Defaults to a slot-index-keyed value
 *                            (`keyboard_p1`, `keyboard_p2`, then
 *                            `gamepad`) so a fresh slot already has a
 *                            sensible device suggestion when the
 *                            player toggles it to human.
 *   • `aiDifficulty`       — only set when `mode === 'bot'`. Default
 *                            `medium` so a fresh bot is immediately
 *                            playable.
 *   • `cursor`             — current hand position in scene-local
 *                            coords (see {@link HandCursorPosition}).
 *   • `hovered`            — what the scene's hit-test says the cursor
 *                            is over right now. Updated every frame by
 *                            the scene via {@link setHoveredTarget}.
 *   • `pickedCharacterId`  — null until {@link selectAtCursor} commits
 *                            a portrait pick. Cleared by
 *                            {@link unselectSlot}, by mode→empty
 *                            transitions, and by direct character
 *                            re-picks.
 *   • `paletteIndex`       — 0..7 palette swap index. Cycles via
 *                            {@link cycleSlotPalette}. Auto-shifted to
 *                            avoid collision when two slots share a
 *                            character (Phase 3 — {@link selectAtCursor}
 *                            consults {@link nextFreePaletteIndex}).
 */
export interface HandCursorSlotState {
  readonly index: 1 | 2 | 3 | 4;
  readonly mode: SlotMode;
  readonly inputType: InputType;
  readonly aiDifficulty?: AiDifficulty;
  readonly cursor: HandCursorPosition;
  readonly hovered: HoveredTarget;
  readonly pickedCharacterId: CharacterId | null;
  readonly paletteIndex: number;
}

/**
 * Top-level state — always exactly {@link MAX_PLAYER_SLOTS} entries in
 * slot order so consumers can index by `slotIndex - 1` without bounds
 * checks.
 */
export interface HandCursorState {
  readonly slots: ReadonlyArray<HandCursorSlotState>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const SLOT_INDICES = [1, 2, 3, 4] as const;

function defaultInputTypeForSlot(slotIndex: 1 | 2 | 3 | 4): InputType {
  if (slotIndex === 1) return 'keyboard_p1';
  if (slotIndex === 2) return 'keyboard_p2';
  // Slots 3..4 default to gamepad — when the lobby hands off it'll
  // already have a real device id; this is just the suggestion shown
  // before any device is detected.
  return 'gamepad';
}

/**
 * Initial state — all four slots are `empty` and parked at (0, 0).
 *
 * Why "all empty" rather than "slot 1 joined" (the legacy default):
 * the new model puts JOIN behind the per-slot tile toggle, so opening
 * with a slot pre-joined would skip the player's deliberate "I'm in"
 * gesture. The scene's lobby-handoff path overrides this default with
 * whatever devices the lobby actually saw.
 */
export const DEFAULT_HAND_CURSOR_STATE: HandCursorState = Object.freeze({
  slots: Object.freeze(
    SLOT_INDICES.map((index) =>
      Object.freeze({
        index,
        mode: 'empty' as const,
        inputType: defaultInputTypeForSlot(index),
        cursor: Object.freeze({ x: 0, y: 0 }),
        hovered: HOVERED_TARGET_NONE,
        pickedCharacterId: null,
        paletteIndex: (index - 1) % PALETTE_COUNT,
      } as HandCursorSlotState),
    ),
  ),
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertSlotIndex(slotIndex: number): asserts slotIndex is 1 | 2 | 3 | 4 {
  if (slotIndex < 1 || slotIndex > MAX_PLAYER_SLOTS || !Number.isInteger(slotIndex)) {
    throw new Error(
      `slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function wrapPalette(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const i = Math.trunc(raw);
  return ((i % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
}

function replaceSlot(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  update: (slot: HandCursorSlotState) => HandCursorSlotState,
): HandCursorState {
  const target = state.slots[slotIndex - 1];
  if (!target) {
    throw new Error(`slot ${slotIndex} not found`);
  }
  const nextSlot = update(target);
  if (nextSlot === target) return state;
  const nextSlots = state.slots.map((s, i) =>
    i === slotIndex - 1 ? nextSlot : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

// ---------------------------------------------------------------------------
// Cursor / hover transitions
// ---------------------------------------------------------------------------

/**
 * Set a slot's cursor to an absolute scene-local coordinate, clamped to
 * `bounds`. Used by the scene on mount to park each hand at its starting
 * position, and by the mouse-shared-cursor path that snaps a hand to
 * the OS pointer.
 */
export function setHandPosition(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  position: HandCursorPosition,
  bounds: HandCursorBounds,
): HandCursorState {
  assertSlotIndex(slotIndex);
  const x = clamp(position.x, bounds.minX, bounds.maxX);
  const y = clamp(position.y, bounds.minY, bounds.maxY);
  return replaceSlot(state, slotIndex, (slot) => {
    if (slot.cursor.x === x && slot.cursor.y === y) return slot;
    return Object.freeze({
      ...slot,
      cursor: Object.freeze({ x, y }),
    });
  });
}

/**
 * Add a delta to a slot's cursor and clamp to `bounds`. Called by the
 * gamepad poll loop each frame: `dx, dy` is `stickDelta * speed * dt`.
 *
 * Returns the same state reference if the resulting position is
 * unchanged (cursor was already on a clamp edge with delta pointing
 * out) so consumers can skip a re-render.
 */
export function moveHand(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  dx: number,
  dy: number,
  bounds: HandCursorBounds,
): HandCursorState {
  assertSlotIndex(slotIndex);
  return replaceSlot(state, slotIndex, (slot) => {
    const nextX = clamp(slot.cursor.x + dx, bounds.minX, bounds.maxX);
    const nextY = clamp(slot.cursor.y + dy, bounds.minY, bounds.maxY);
    if (nextX === slot.cursor.x && nextY === slot.cursor.y) return slot;
    return Object.freeze({
      ...slot,
      cursor: Object.freeze({ x: nextX, y: nextY }),
    });
  });
}

/**
 * Update a slot's `hovered` target. The scene calls this every frame
 * after running its own hit-test against the layout — the reducer never
 * sees the layout itself.
 *
 * Returns the same state reference if the target is unchanged.
 */
export function setHoveredTarget(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  target: HoveredTarget,
): HandCursorState {
  assertSlotIndex(slotIndex);
  return replaceSlot(state, slotIndex, (slot) => {
    if (hoveredTargetsEqual(slot.hovered, target)) return slot;
    return Object.freeze({ ...slot, hovered: target });
  });
}

function hoveredTargetsEqual(a: HoveredTarget, b: HoveredTarget): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'none':
      return true;
    case 'portrait':
      return a.portraitIndex === (b as typeof a).portraitIndex;
    case 'slot-tile-mode':
    case 'slot-tile-palette':
      return a.slotIndex === (b as typeof a).slotIndex;
  }
}

// ---------------------------------------------------------------------------
// Selection transitions (light-attack press dispatch)
// ---------------------------------------------------------------------------

/**
 * Light-attack press dispatch. Routes the press based on what the
 * acting slot's cursor is currently over:
 *
 *   • `none`              → no-op
 *   • `portrait`          → set the slot's `pickedCharacterId` to the
 *                           hovered character; if another joined slot
 *                           has already picked the same character on
 *                           the same palette, auto-shift this slot's
 *                           palette to the next free index. Slot mode
 *                           is also forced to `human` if currently
 *                           `empty` (so picking a character implicitly
 *                           joins the slot).
 *   • `slot-tile-mode`    → cycle the *target* slot's mode (Empty →
 *                           Human → Bot → Empty). Note: any hand can
 *                           click any slot's mode tile, mirroring how
 *                           a mouse click would behave.
 *   • `slot-tile-palette` → cycle the *target* slot's palette by +1.
 *
 * Same-state-ref no-ops apply: if dispatch produces no observable
 * change, the same state reference comes back.
 */
export function selectAtCursor(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
): HandCursorState {
  assertSlotIndex(slotIndex);
  const acting = state.slots[slotIndex - 1];
  if (!acting) return state;
  const target = acting.hovered;

  switch (target.kind) {
    case 'none':
      return state;

    case 'portrait': {
      const portraitIndex = target.portraitIndex;
      if (
        portraitIndex < 0 ||
        portraitIndex >= SELECTABLE_CHARACTER_SPECS.length
      ) {
        return state;
      }
      const spec = SELECTABLE_CHARACTER_SPECS[portraitIndex];
      if (!spec) return state;
      // Phase 3 — auto-shift palette to avoid collision with another
      // slot that already picked this character on the same palette.
      const collisionFree = nextFreePaletteIndex(
        state,
        slotIndex,
        spec.id,
        acting.paletteIndex,
      );
      return replaceSlot(state, slotIndex, (slot) => {
        // Picking a character on an empty slot implicitly promotes it
        // to human. Mirrors the lobby's "press start to join" gesture.
        const nextMode: SlotMode = slot.mode === 'empty' ? 'human' : slot.mode;
        if (
          slot.pickedCharacterId === spec.id &&
          slot.paletteIndex === collisionFree &&
          slot.mode === nextMode
        ) {
          return slot;
        }
        return Object.freeze({
          ...slot,
          mode: nextMode,
          pickedCharacterId: spec.id,
          paletteIndex: collisionFree,
        });
      });
    }

    case 'slot-tile-mode':
      return cycleSlotMode(state, target.slotIndex);

    case 'slot-tile-palette':
      return cycleSlotPalette(state, target.slotIndex, +1);
  }
}

/**
 * Special-attack press dispatch — REMOVE PLAYER. Resets the slot to
 * Empty mode, frees the picked character, and drops any AI difficulty.
 * Mirrors the symmetric model the user asked for: light attack ADDS
 * a player (picks → auto-promotes Empty → Human), special attack
 * REMOVES one (any mode → Empty).
 *
 * Returns the same state reference if the slot was already empty.
 */
export function unselectSlot(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
): HandCursorState {
  assertSlotIndex(slotIndex);
  return replaceSlot(state, slotIndex, (slot) => applyModeTransition(slot, 'empty'));
}

// ---------------------------------------------------------------------------
// Slot tile transitions (mouse OR hand clicks on the per-slot tile UI)
// ---------------------------------------------------------------------------

/**
 * Cycle a slot's mode through `empty → human → bot → empty`.
 *
 * Side-effects on transition:
 *   • `→ empty`: also clears `pickedCharacterId` and `aiDifficulty`.
 *     An empty slot doesn't participate in the match, so a stale pick
 *     would leak into the lineup if we kept it.
 *   • `→ bot`:   sets `aiDifficulty: 'medium'` if the slot didn't
 *     already have one, AND auto-picks a default character so the
 *     bot slot is immediately ready (no human input needed). The
 *     default is the slot-index-keyed roster pick (slot 1 → Wolf,
 *     slot 2 → Cat, etc.) and the palette is auto-shifted to avoid
 *     collision with any human slot already on the same character.
 *     Without this auto-pick the bot would stay un-ready and
 *     `canConfirmMatch` would block ENTER even though the player
 *     "completed" the lobby.
 *   • `→ human`: clears `aiDifficulty` (a human slot has no difficulty).
 *     Keeps any prior pick.
 */
export function cycleSlotMode(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
): HandCursorState {
  assertSlotIndex(slotIndex);
  const slot = state.slots[slotIndex - 1];
  if (!slot) return state;
  const currentIdx = SLOT_MODE_CYCLE_ORDER.indexOf(slot.mode);
  const nextMode =
    SLOT_MODE_CYCLE_ORDER[(currentIdx + 1) % SLOT_MODE_CYCLE_ORDER.length] ??
    'empty';
  return setSlotMode(state, slotIndex, nextMode);
}

/**
 * Set a slot's mode directly (e.g. lobby-handoff path). Same side-
 * effects as {@link cycleSlotMode}, including the join auto-pick.
 */
export function setSlotMode(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  mode: SlotMode,
): HandCursorState {
  assertSlotIndex(slotIndex);
  const next = replaceSlot(state, slotIndex, (slot) => applyModeTransition(slot, mode));
  // Join auto-pick — a slot transitioning into Human OR Bot mode picks
  // a default character so joining IS a valid pick (Smash-style: a
  // joined player always has a fighter; portrait clicks just change
  // it). Default is the slot-index-keyed roster pick (slot 1 → Wolf,
  // slot 2 → Cat, etc.); the palette is auto-shifted to avoid
  // collision with any other slot already on the same character.
  if (mode === 'bot' || mode === 'human') {
    return autoPickDefaultIfNeeded(next, slotIndex);
  }
  return next;
}

/**
 * If the slot participates (mode !== 'empty') but has no committed
 * pick yet, commit the slot-index-keyed default character with a
 * collision-free palette. No-op (same state ref) otherwise.
 *
 * This is what makes "join" and "valid pick" the same event — the
 * Smash-style contract that a joined slot is always match-ready.
 */
export function autoPickDefaultIfNeeded(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
): HandCursorState {
  assertSlotIndex(slotIndex);
  const slot = state.slots[slotIndex - 1];
  if (!slot || slot.mode === 'empty' || slot.pickedCharacterId !== null) {
    return state;
  }
  const defaultSpec =
    SELECTABLE_CHARACTER_SPECS[(slotIndex - 1) % SELECTABLE_CHARACTER_SPECS.length];
  if (!defaultSpec) return state;
  const palette = nextFreePaletteIndex(
    state,
    slotIndex,
    defaultSpec.id,
    slot.paletteIndex,
  );
  return replaceSlot(state, slotIndex, (s) =>
    Object.freeze({
      ...s,
      pickedCharacterId: defaultSpec.id,
      paletteIndex: palette,
    }),
  );
}

/**
 * Press-button-to-join — claim the first empty slot for a human player
 * on `inputType` (keyboard half or a specific gamepad). The slot joins
 * with its auto-picked default character so the join is immediately a
 * valid pick.
 *
 * Returns the new state plus the claimed slot index, or `null` when
 * every slot is taken (state unchanged). If `inputType` already drives
 * a non-empty slot, that slot's index is returned instead of claiming
 * a second one — pressing JOIN twice on the same device is idempotent.
 */
export function joinNextEmptySlot(
  state: HandCursorState,
  inputType: InputType,
): { readonly state: HandCursorState; readonly slotIndex: 1 | 2 | 3 | 4 | null } {
  // Keyboard halves are exclusive — pressing JOIN twice on the same
  // half re-targets the slot it already drives. Gamepads share the
  // 'gamepad' InputType (the scene tracks which physical pad drives
  // which slot), so every gamepad join claims a fresh slot.
  if (inputType === 'keyboard_p1' || inputType === 'keyboard_p2') {
    for (const slot of state.slots) {
      if (slot.mode === 'human' && slot.inputType === inputType) {
        return { state, slotIndex: slot.index };
      }
    }
  }
  for (const slot of state.slots) {
    if (slot.mode !== 'empty') continue;
    let next = setSlotInputType(state, slot.index, inputType);
    next = setSlotMode(next, slot.index, 'human');
    return { state: next, slotIndex: slot.index };
  }
  return { state, slotIndex: null };
}

/**
 * Host-side "+ CPU" — claim the first empty slot for a bot (medium
 * difficulty, auto-picked default character). Returns `null` slotIndex
 * when the lobby is full (state unchanged).
 */
export function addCpuToNextEmptySlot(
  state: HandCursorState,
): { readonly state: HandCursorState; readonly slotIndex: 1 | 2 | 3 | 4 | null } {
  for (const slot of state.slots) {
    if (slot.mode !== 'empty') continue;
    return { state: setSlotMode(state, slot.index, 'bot'), slotIndex: slot.index };
  }
  return { state, slotIndex: null };
}

/** Canonical difficulty cycle order for the CPU card's difficulty button. */
export const AI_DIFFICULTY_CYCLE: ReadonlyArray<AiDifficulty> = Object.freeze([
  'easy',
  'medium',
  'hard',
]);

/**
 * Cycle a bot slot's difficulty `easy → medium → hard → easy`. Silent
 * no-op on human / empty slots.
 */
export function cycleSlotAiDifficulty(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
): HandCursorState {
  assertSlotIndex(slotIndex);
  const slot = state.slots[slotIndex - 1];
  if (!slot || slot.mode !== 'bot') return state;
  const current = AI_DIFFICULTY_CYCLE.indexOf(slot.aiDifficulty ?? 'medium');
  const next = AI_DIFFICULTY_CYCLE[(current + 1) % AI_DIFFICULTY_CYCLE.length] ?? 'medium';
  return setSlotAiDifficulty(state, slotIndex, next);
}

/** Number of participating (non-empty) slots — the match-start gate. */
export function participatingSlotCount(state: HandCursorState): number {
  let n = 0;
  for (const slot of state.slots) {
    if (slot.mode !== 'empty') n += 1;
  }
  return n;
}

function applyModeTransition(
  slot: HandCursorSlotState,
  nextMode: SlotMode,
): HandCursorSlotState {
  if (slot.mode === nextMode) return slot;
  if (nextMode === 'empty') {
    // Empty slots carry no pick / no difficulty. Drop both so the
    // resulting `PlayerSlot[]` projection stays clean.
    const { aiDifficulty: _drop, ...stripped } = slot;
    void _drop;
    return Object.freeze({
      ...stripped,
      mode: nextMode,
      pickedCharacterId: null,
    });
  }
  if (nextMode === 'bot') {
    return Object.freeze({
      ...slot,
      mode: nextMode,
      aiDifficulty: slot.aiDifficulty ?? 'medium',
    });
  }
  // → human: drop aiDifficulty
  const { aiDifficulty: _drop, ...stripped } = slot;
  void _drop;
  return Object.freeze({ ...stripped, mode: nextMode });
}

/**
 * Cycle a slot's palette by `direction` (+1 / -1), wrapping mod
 * {@link PALETTE_COUNT}. Mouse clicks on the palette swatch strip and
 * hand light-attacks both route here.
 */
export function cycleSlotPalette(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  direction: number,
): HandCursorState {
  assertSlotIndex(slotIndex);
  return replaceSlot(state, slotIndex, (slot) => {
    const next = wrapPalette(slot.paletteIndex + Math.sign(direction || 1));
    if (next === slot.paletteIndex) return slot;
    return Object.freeze({ ...slot, paletteIndex: next });
  });
}

/** Set a slot's palette to an explicit index (mouse click on a swatch). */
export function setSlotPalette(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  paletteIndex: number,
): HandCursorState {
  assertSlotIndex(slotIndex);
  const wrapped = wrapPalette(paletteIndex);
  return replaceSlot(state, slotIndex, (slot) => {
    if (slot.paletteIndex === wrapped) return slot;
    return Object.freeze({ ...slot, paletteIndex: wrapped });
  });
}

/** Set a slot's bot difficulty (mouse click on the difficulty toggle). */
export function setSlotAiDifficulty(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  aiDifficulty: AiDifficulty,
): HandCursorState {
  assertSlotIndex(slotIndex);
  return replaceSlot(state, slotIndex, (slot) => {
    if (slot.mode !== 'bot') return slot;
    if (slot.aiDifficulty === aiDifficulty) return slot;
    return Object.freeze({ ...slot, aiDifficulty });
  });
}

/** Set a slot's input device (lobby-handoff path). */
export function setSlotInputType(
  state: HandCursorState,
  slotIndex: 1 | 2 | 3 | 4,
  inputType: InputType,
): HandCursorState {
  assertSlotIndex(slotIndex);
  return replaceSlot(state, slotIndex, (slot) => {
    if (slot.inputType === inputType) return slot;
    return Object.freeze({ ...slot, inputType });
  });
}

// ---------------------------------------------------------------------------
// Palette auto-differentiation (Phase 3 hook — used by selectAtCursor)
// ---------------------------------------------------------------------------

/**
 * Find the next palette index that no other *participating* slot has
 * already locked onto for the same character, starting from
 * `preferred` and walking forward modulo {@link PALETTE_COUNT}.
 *
 * If no other slot has picked `characterId`, returns `preferred`
 * unchanged (the player's prior palette choice is preserved).
 *
 * If every palette is taken (more than {@link PALETTE_COUNT} slots
 * picking the same character — impossible with a 4-slot lineup but
 * defended), returns `preferred` so the caller still gets a valid
 * index back.
 *
 * "Participating" = `mode !== 'empty'` AND `pickedCharacterId`
 * matches. An un-locked-in slot doesn't reserve a palette.
 *
 * Exposed so tests can lock down the behaviour directly without
 * routing through {@link selectAtCursor}, and so the scene can
 * pre-compute the swatch-strip's "taken" markers.
 */
export function nextFreePaletteIndex(
  state: HandCursorState,
  actingSlotIndex: 1 | 2 | 3 | 4,
  characterId: CharacterId,
  preferred: number,
): number {
  const taken = new Set<number>();
  for (const other of state.slots) {
    if (other.index === actingSlotIndex) continue;
    if (other.mode === 'empty') continue;
    if (other.pickedCharacterId !== characterId) continue;
    taken.add(wrapPalette(other.paletteIndex));
  }
  if (taken.size === 0) return wrapPalette(preferred);
  for (let step = 0; step < PALETTE_COUNT; step++) {
    const candidate = wrapPalette(preferred + step);
    if (!taken.has(candidate)) return candidate;
  }
  // Pathological — every palette taken. Caller still gets a valid index.
  return wrapPalette(preferred);
}

// ---------------------------------------------------------------------------
// Projection back to the legacy CharacterSelectState / PlayerSlot[] contract
// ---------------------------------------------------------------------------

/**
 * Adapter — project a {@link HandCursorState} into the legacy
 * {@link CharacterSelectState} shape so the existing
 * {@link buildPlayerSlotsFromState} pipeline (and any downstream tooling
 * that already consumes it) keeps working unchanged.
 *
 * Mapping:
 *   • slot.mode !== 'empty'             → `joined: true`
 *   • slot.pickedCharacterId !== null   → `ready: true`
 *   • slot.pickedCharacterId            → `characterId` (fall back to
 *                                         a slot-keyed default when
 *                                         null so the legacy invariant
 *                                         "every slot has a characterId"
 *                                         holds — but `ready: false`
 *                                         keeps the un-picked slot out
 *                                         of the actual match.)
 *   • slot.paletteIndex                 → `paletteIndex`
 *   • slot.inputType                    → `inputType`
 *   • slot.aiDifficulty                 → `aiDifficulty` (only when
 *                                         mode === 'bot')
 *   • cursor's hovered portrait         → `cursorIndex` (when present;
 *                                         else the picked character's
 *                                         roster index; else 0)
 *
 * Pure deterministic — same input always produces the same output. Safe
 * to call from scene render paths and tests alike.
 */
export function toCharacterSelectState(
  state: HandCursorState,
): CharacterSelectState {
  return Object.freeze({
    slots: Object.freeze(
      state.slots.map((slot) => {
        const joined = slot.mode !== 'empty';
        const ready = slot.pickedCharacterId !== null;
        const characterId =
          slot.pickedCharacterId ??
          SELECTABLE_CHARACTER_SPECS[(slot.index - 1) % SELECTABLE_CHARACTER_SPECS.length]
            ?.id ??
          'wolf';
        const cursorIndex =
          slot.hovered.kind === 'portrait'
            ? clamp(
                Math.trunc(slot.hovered.portraitIndex),
                0,
                SELECTABLE_CHARACTER_SPECS.length - 1,
              )
            : Math.max(
                0,
                SELECTABLE_CHARACTER_SPECS.findIndex((s) => s.id === characterId),
              );
        // Strip aiDifficulty unless this is actually a bot slot, so the
        // resulting CharacterSelectSlotState matches the legacy
        // "non-AI slots don't carry a phantom field" invariant.
        const aiDifficulty: AiDifficulty | undefined =
          slot.mode === 'bot' ? slot.aiDifficulty ?? 'medium' : undefined;
        // Map `mode` to a concrete `inputType`: bot slots always
        // project as `'ai'` regardless of their suggested device.
        const inputType: InputType =
          slot.mode === 'bot' ? 'ai' : slot.inputType;
        return Object.freeze({
          index: slot.index,
          characterId,
          paletteIndex: wrapPalette(slot.paletteIndex),
          inputType,
          ...(aiDifficulty !== undefined ? { aiDifficulty } : {}),
          joined,
          ready,
          cursorIndex,
        });
      }),
    ),
  });
}

/**
 * Convenience — build the final `PlayerSlot[]` lineup directly from a
 * {@link HandCursorState}. The MatchScene boundary already consumes
 * `PlayerSlot[]`, so this is the one-call adapter the new scene's
 * "start match" path uses.
 *
 * Only slots with `mode !== 'empty'` AND a committed
 * `pickedCharacterId` make it into the lineup — picking-in-progress
 * doesn't drag a player into the match.
 */
export function buildPlayerSlotsFromHandCursor(
  state: HandCursorState,
): ReadonlyArray<PlayerSlot> {
  // Reuse the legacy projection — but additionally gate on
  // `pickedCharacterId !== null`, since the legacy `joined` flag is
  // looser (joined-but-not-ready slots would slip through with their
  // default characterId).
  const projected = toCharacterSelectState(state);
  const readyOnly: CharacterSelectState = Object.freeze({
    slots: Object.freeze(
      projected.slots.map((s, i) => {
        const handSlot = state.slots[i];
        if (!handSlot || handSlot.pickedCharacterId === null) {
          return Object.freeze({ ...s, joined: false });
        }
        return s;
      }),
    ),
  });
  return buildPlayerSlotsFromState(readyOnly);
}
