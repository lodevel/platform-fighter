/**
 * Phaser-free helpers for the pre-match Character Select screen.
 *
 * AC 13 — "Same-character selection allowed with palette swap
 * differentiation."
 *
 * This module owns the *selection state* for a 1..4 player lineup as
 * the lobby fills:
 *
 *   • Each `playerSlot` (per the project ontology) records its chosen
 *     `characterId`, `paletteIndex`, `inputType`, and (for AI bots)
 *     `aiDifficulty`.
 *   • Players can pick **any** character at any time — including a
 *     character another slot has already chosen. This module enforces
 *     **no uniqueness restriction** on `characterId` across slots; that
 *     is the explicit Sub-AC 1 contract of AC 13. The palette-swap
 *     differentiation that makes two same-character picks visually
 *     distinct lives in companion sub-ACs (palette cycling + auto-
 *     differentiation) and is a separate transition on this same state.
 *
 * Why a dedicated module
 * ----------------------
 *
 * Per the project's `code_architecture` evaluation principle, scene
 * files stay thin (lifecycle wiring + draw calls only). All the
 * selection transitions — "what character is slot 2 picking?", "is
 * picking Wolf for slot 3 allowed?", "build the final `PlayerSlot[]`
 * so MatchScene can start" — live in this Phaser-free helper, which:
 *
 *   • Unit-tests under plain Node (Phaser pulls in browser globals
 *     at module-eval time and can't be loaded by a vitest worker).
 *   • Reuses cleanly from headless replay tooling, smoke-test
 *     harnesses, and a future stage-builder preview without dragging
 *     Phaser into those code paths.
 *   • Mirrors the existing `modeSelect.ts` ↔ `ModeSelectScene.ts`
 *     split so future maintainers find one consistent pattern.
 *
 * Determinism contract
 * --------------------
 *
 * Every transition is a deterministic pure function — no
 * `Math.random()`, no wall-clock reads, no Phaser globals. Selection
 * snapshots round-trip through replay JSON byte-identically; two
 * lobbies that picked the same characters / palettes produce
 * byte-equal `PlayerSlot[]` arrays.
 *
 * Sub-AC 1 (this slice)
 * ---------------------
 *
 *   "Remove same-character selection restriction in character select
 *    logic to allow multiple players to pick the same fighter."
 *
 * Realised here as: `setSlotCharacter` accepts any playable
 * `CharacterId` for any slot regardless of what other slots already
 * picked. There is intentionally **no** "is this character available?"
 * predicate, no "lock out" set, and no error path on duplicates — the
 * whole API surface treats duplicates as a first-class supported
 * configuration.
 *
 * Subsequent sub-ACs (palette differentiation, AI difficulty pick,
 * Press-Start-to-Join lobby gating) layer on top of the same state
 * shape; they will extend this module rather than rewrite it.
 */

import type {
  AiDifficulty,
  CharacterId,
  InputType,
  PlayerSlot,
} from '../types';
import {
  CHARACTER_SPECS_IN_ROSTER_ORDER,
  PLAYABLE_CHARACTER_SPECS,
  getCharacterSpec,
} from '../characters/roster';
import {
  getCharacterPalette,
  getCharacterPalettes,
  type CharacterPalette,
} from '../characters/palettes';
import type { LobbyHandoffPayload } from './lobby';

// ---------------------------------------------------------------------------
// Public option ladders
// ---------------------------------------------------------------------------

/**
 * Number of palette swaps every character ships with (Seed constraint:
 * "8 manual palette swaps per character via hue-shift batch script").
 * Exposed so the cycling logic and the menu's palette-swatch grid both
 * read the same upper bound.
 */
export const PALETTE_COUNT = 8;

/**
 * Maximum local players in a single match (Seed: "local multiplayer
 * for up to 4 players"). Mirrored from `PlayerSlot.index` (1..4).
 */
export const MAX_PLAYER_SLOTS = 4;

/**
 * Ordered list of every selectable character in the roster — same
 * order the future char-select grid renders left-to-right, top-to-
 * bottom. Re-exported so the cycling logic and the grid renderer read
 * one source.
 *
 * IMPORTANT: This list contains *every* roster entry, including
 * `playable: false` placeholders (Owl, Bear during M1). Selection UIs
 * grey out non-playable specs but still expose them as cells so the
 * grid layout stays stable across the M1→M2 reveal.
 */
export const SELECTABLE_CHARACTER_SPECS = CHARACTER_SPECS_IN_ROSTER_ORDER;

// ---------------------------------------------------------------------------
// Selection state model
// ---------------------------------------------------------------------------

/**
 * One slot's worth of the live character-select selection. Pure data —
 * every transition produces a brand-new object so consumers can compare
 * snapshots with `===`.
 *
 *   • `index`         — slot number (1..4). Mirrors `PlayerSlot.index`.
 *   • `characterId`   — currently highlighted character. Defaults to
 *                       Wolf for slot 1, Cat for slot 2, etc., so a
 *                       player who confirms without changing anything
 *                       gets a sensible matchup (the M1 dev-mode
 *                       lineup).
 *   • `paletteIndex`  — 0..7 index into the character's palette
 *                       lineup. Defaults to the slot index minus one
 *                       so slots 1..4 pick four distinct palettes by
 *                       default. This is also the palette-swap
 *                       differentiation hook AC 13 calls out — but the
 *                       current Sub-AC 1 only needs to *allow*
 *                       duplicates; differentiation is a follow-up.
 *   • `inputType`     — keyboard_p1 / keyboard_p2 / gamepad / ai.
 *                       Determines what feeds inputs at match time.
 *   • `aiDifficulty`  — only set when `inputType === 'ai'`. Optional
 *                       on the slot so non-AI slots don't carry a
 *                       phantom field through the replay JSON.
 *   • `joined`        — false until the player has Pressed Start to
 *                       Join (Seed M2 lobby contract). The lobby UI
 *                       greys out un-joined slots; `buildPlayerSlots`
 *                       drops un-joined slots from the resulting
 *                       lineup.
 *   • `ready`         — AC 10304 Sub-AC 4 — false until the player has
 *                       confirmed their `(characterId, paletteIndex)`
 *                       choice. ENTER is gated on every joined slot
 *                       reporting `ready: true` so a player can't be
 *                       dragged into a match before they've locked in
 *                       their fighter. Always false when `joined` is
 *                       false (un-joined spectators can't be "ready"
 *                       for nothing).
 */
export interface CharacterSelectSlotState {
  readonly index: 1 | 2 | 3 | 4;
  readonly characterId: CharacterId;
  readonly paletteIndex: number;
  readonly inputType: InputType;
  readonly aiDifficulty?: AiDifficulty;
  readonly joined: boolean;
  readonly ready: boolean;
  /**
   * AC 10403 Sub-AC 3 — per-player cursor index over
   * {@link SELECTABLE_CHARACTER_SPECS}. Decoupled from `characterId` so
   * the player can navigate the roster grid (live-previewing each
   * character) WITHOUT committing the pick. Lock-in confirmation
   * ({@link lockInSlotCharacter}) is the explicit transition that
   * promotes `cursorIndex` → `characterId` and snaps `ready: true`.
   *
   * Always in `[0, SELECTABLE_CHARACTER_SPECS.length)`. Defaults to the
   * roster index of the slot's `characterId` so a fresh slot opens with
   * its cursor and committed character pointing at the same fighter.
   *
   * Why a separate field rather than re-deriving from `characterId`:
   * the cursor must be able to *hover* a different character than the
   * one that's currently committed. A pure derivation would force every
   * cursor move to also commit, which collapses the lock-in flow back
   * into the M1 "cycle keys directly mutate the lineup" model and
   * removes the load-bearing preview-vs-commit distinction the AC asks
   * for.
   */
  readonly cursorIndex: number;
}

/**
 * The full character-select screen state — one entry per possible
 * slot, in slot order. Always 4 entries long so consumers can index by
 * slot number minus one without bounds-checking.
 */
export interface CharacterSelectState {
  readonly slots: ReadonlyArray<CharacterSelectSlotState>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Default `characterId` for a fresh slot. Keyed on slot index so slots
 * 1..4 open on Wolf / Cat / Owl / Bear by default. If the roster ever
 * shrinks below 4 specs, the fallback wraps modulo the roster length.
 *
 * Why this and not "always Wolf for everyone": the M1 dev-mode default
 * lineup is `[Wolf, Cat]`, so opening slot 1 on Wolf and slot 2 on Cat
 * preserves the existing behaviour for tests and quick playtests that
 * previously hardcoded those characters in `ModeSelectScene`.
 */
function defaultCharacterIdForSlot(slotIndex: 1 | 2 | 3 | 4): CharacterId {
  // Static roster has 4 entries; this lookup is always defined, but we
  // guard against an ever-shrinking roster to keep the helper safe under
  // `noUncheckedIndexedAccess`.
  const idx = (slotIndex - 1) % SELECTABLE_CHARACTER_SPECS.length;
  return SELECTABLE_CHARACTER_SPECS[idx]?.id ?? 'wolf';
}

/**
 * Default `paletteIndex` for a fresh slot. Equal to `slotIndex - 1`
 * so slots 1..4 default to palettes 0..3 — four distinct hues even
 * before any palette cycling. Wraps modulo `PALETTE_COUNT` so a
 * misconfigured slot index never produces an out-of-range palette.
 */
function defaultPaletteIndexForSlot(slotIndex: 1 | 2 | 3 | 4): number {
  return (slotIndex - 1) % PALETTE_COUNT;
}

/**
 * Default `inputType` for a fresh slot. Slot 1 → keyboard P1, slot 2 →
 * keyboard P2 (the Seed's "max 2 keyboard players" constraint), slots
 * 3..4 → AI bot until the lobby connects a gamepad.
 */
function defaultInputTypeForSlot(slotIndex: 1 | 2 | 3 | 4): InputType {
  if (slotIndex === 1) return 'keyboard_p1';
  if (slotIndex === 2) return 'keyboard_p2';
  return 'ai';
}

/**
 * AC 10403 Sub-AC 3 — resolve a `characterId` to its index in the
 * roster grid ({@link SELECTABLE_CHARACTER_SPECS}). Used by the cursor
 * defaults so a fresh slot opens with its cursor pointing at the same
 * character its `characterId` field carries.
 *
 * Returns 0 (the first roster cell) if the id isn't found — defends a
 * corrupt JSON-loaded selection from crashing the lobby.
 */
function rosterIndexForCharacterId(id: CharacterId): number {
  const idx = SELECTABLE_CHARACTER_SPECS.findIndex((s) => s.id === id);
  return idx >= 0 ? idx : 0;
}

/**
 * AC 10403 Sub-AC 3 — wrap a cursor index into the valid roster range
 * `[0, SELECTABLE_CHARACTER_SPECS.length)`. Mirrors {@link wrapPaletteIndex}
 * so the wrap behaviour stays consistent across "cursor steps right
 * past the end" and "negative cursor wraps to the last cell."
 *
 * Negative or non-finite inputs normalise to 0 rather than throwing so
 * a malformed JSON-loaded selection doesn't take down the lobby.
 */
function wrapCursorIndex(raw: number): number {
  const len = SELECTABLE_CHARACTER_SPECS.length;
  if (len <= 0) return 0;
  if (!Number.isFinite(raw)) return 0;
  const i = Math.trunc(raw);
  return ((i % len) + len) % len;
}

/**
 * Initial state opened by the character-select scene on first entry.
 * Slot 1 is `joined` by default so the menu always has at least one
 * active slot — pressing ENTER without anyone joining still produces
 * a valid match. Slots 2..4 require Press-Start-to-Join.
 */
export const DEFAULT_CHARACTER_SELECT_STATE: CharacterSelectState = Object.freeze(
  {
    slots: Object.freeze(
      ([1, 2, 3, 4] as const).map((index) => {
        const inputType = defaultInputTypeForSlot(index);
        const characterId = defaultCharacterIdForSlot(index);
        const slot: CharacterSelectSlotState = Object.freeze({
          index,
          characterId,
          paletteIndex: defaultPaletteIndexForSlot(index),
          inputType,
          ...(inputType === 'ai' ? { aiDifficulty: 'medium' as const } : {}),
          joined: index === 1,
          // AC 10304 Sub-AC 4 — slots open un-ready. Even slot 1 (which
          // opens joined so the lobby always has at least one active
          // body) starts un-ready so the player has to deliberately
          // confirm their pick before ENTER fires the match. This
          // prevents a stale "I just walked into the menu" pick from
          // cascading into a match the player didn't intend.
          ready: false,
          // AC 10403 Sub-AC 3 — the cursor opens on the same character
          // the slot is currently committed to, so a player who hits
          // ENTER without moving their cursor confirms the default
          // pick rather than landing on whichever cell happens to be
          // first in the roster.
          cursorIndex: rosterIndexForCharacterId(characterId),
        });
        return slot;
      }),
    ),
  },
);

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Set `slot[slotIndex].characterId` to `nextCharacterId`.
 *
 * Sub-AC 1 of AC 13: this transition has **no uniqueness check**. If
 * another slot has already chosen `nextCharacterId`, the call still
 * succeeds — both slots end up with the same `characterId`. The match
 * runtime, replay system, and damage HUD all already key on the
 * `(slotIndex)` rather than `(characterId)` and consume duplicates
 * without complaint; the palette-swap differentiation that makes the
 * two fighters visually distinct lives in `setSlotPalette` (and a
 * future auto-differentiate step), not here.
 *
 * Returns the same state reference if the slot is already on
 * `nextCharacterId` (so consumers can compare snapshots with `===` and
 * skip re-rendering on a no-op).
 *
 * Throws if `slotIndex` is out of range (1..4) — every other failure
 * mode is suppressed because this module's contract is "duplicates are
 * fine."
 */
export function setSlotCharacter(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
  nextCharacterId: CharacterId,
): CharacterSelectState {
  // `getCharacterSpec` throws on an unknown id at the type level, so a
  // typed call site can't pass garbage. We still call it to assert the
  // id resolves to a real spec at runtime — defends against a JSON
  // payload from a future stage / replay file with a stale id.
  getCharacterSpec(nextCharacterId);

  const slots = state.slots;
  const targetIdx = slotIndex - 1;
  const target = slots[targetIdx];
  if (!target) {
    throw new Error(
      `setSlotCharacter: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  if (target.characterId === nextCharacterId) return state;

  // Build a fresh slots array with the updated slot. We preserve every
  // other field (paletteIndex, inputType, joined, …) so changing the
  // chosen character doesn't reset palette cycling or kick a player
  // out of the lobby.
  //
  // AC 10304 Sub-AC 4 — changing characters drops `ready: true` back
  // to `false`. The ready flag asserts "I've confirmed THIS pick"; a
  // post-ready character switch invalidates the assertion so the
  // player has to deliberately re-ready on the new choice. Without
  // this drop, a ready player could accidentally bump character keys
  // and ship into the match on a different fighter than they confirmed.
  //
  // AC 10403 Sub-AC 3 — also sync `cursorIndex` to the new character's
  // roster cell. The cursor is the player's hover position; a direct
  // `setSlotCharacter` (e.g. from a JSON replay header) is logically a
  // "lock-in to this fighter," so the cursor must follow the commit
  // or the next cursor move would jump back to wherever the cursor
  // had been hovering before. Keeping cursor and characterId in lock
  // step on this path means consumers that reach the helper directly
  // (replays, smoke tests) never produce a slot whose hover and
  // commit have silently diverged.
  const nextCursorIndex = rosterIndexForCharacterId(nextCharacterId);
  const nextSlots = slots.map((s, i) =>
    i === targetIdx
      ? Object.freeze({
          ...s,
          characterId: nextCharacterId,
          cursorIndex: nextCursorIndex,
          ready: false,
        })
      : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * Set `slot[slotIndex].paletteIndex` to `nextPaletteIndex`. Wraps
 * modulo `PALETTE_COUNT` so a caller that increments past the last
 * palette lands back on 0 (and a decrement past 0 lands on the last).
 *
 * The palette is the differentiation hook AC 13 references. With this
 * transition + the no-uniqueness `setSlotCharacter` above, two players
 * can both pick Wolf and immediately be visually distinguished by
 * palette swap — exactly the Seed's stated behaviour.
 */
export function setSlotPalette(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
  nextPaletteIndex: number,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `setSlotPalette: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  const wrapped = wrapPaletteIndex(nextPaletteIndex);
  if (target.paletteIndex === wrapped) return state;
  // AC 10304 Sub-AC 4 — palette cycling also drops `ready` so a player
  // who confirmed on palette 0 and then bumped a palette key has to
  // re-confirm before the match starts. Same justification as the
  // character-cycle reset: ready asserts "I confirmed THIS pick", and
  // the pick changed.
  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx
      ? Object.freeze({ ...s, paletteIndex: wrapped, ready: false })
      : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * Mark a slot as having Pressed Start to Join. Idempotent — a second
 * call on an already-joined slot returns the same state reference.
 *
 * Joining never transitions the slot into "ready"; the lobby contract
 * (AC 10304 Sub-AC 4) is a two-step "join → confirm pick → ready up"
 * flow. Slot 1 opens `joined: true` by default so the lobby always
 * has one active body, but it still starts `ready: false` so even the
 * default slot has to deliberately ready up before ENTER fires.
 */
export function joinSlot(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `joinSlot: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  if (target.joined) return state;
  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx ? Object.freeze({ ...s, joined: true }) : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * Inverse of {@link joinSlot} — mark a slot as having left the lobby.
 * AC 10304 Sub-AC 4 wires this onto a "leave" key so a player who
 * joined by mistake can back out without rebooting the menu. Leaving
 * also drops `ready` because un-joined slots can't be ready (the
 * invariant `ready ⇒ joined` holds at every transition).
 *
 * Idempotent — calling this on an already-un-joined slot returns the
 * same state reference. Throws on an out-of-range slot index.
 */
export function leaveSlot(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `leaveSlot: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  if (!target.joined && !target.ready) return state;
  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx ? Object.freeze({ ...s, joined: false, ready: false }) : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * AC 10304 Sub-AC 4 — set the ready flag on a slot. Pure transition;
 * the scene handler decides which key fires this and at what point in
 * the join → confirm → ready flow.
 *
 * Invariants enforced here:
 *
 *   • An un-joined slot CANNOT be marked ready. Calling
 *     `setSlotReady(state, i, true)` on an un-joined slot returns the
 *     same state reference (silent no-op rather than throw — the lobby
 *     UI just won't paint the "ready" label, which is the right UX).
 *
 *   • Marking an already-ready slot ready is a no-op. Same `===`
 *     reference returned so consumers can compare cheaply.
 *
 *   • Marking an already-un-ready slot un-ready is a no-op too.
 *
 *   • The slot's character / palette / inputType / joined fields are
 *     untouched — only `ready` changes. This is what makes the ready
 *     flag a *gating* signal rather than a *commit* signal: the live
 *     selection still drives previews, just gated on whether the
 *     player has signed off.
 *
 * Throws on out-of-range slot index — same failure shape as the other
 * transitions so callers can rely on a uniform error contract.
 */
export function setSlotReady(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
  nextReady: boolean,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `setSlotReady: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  // Invariant: ready ⇒ joined. An un-joined slot can never be ready.
  if (nextReady && !target.joined) return state;
  if (target.ready === nextReady) return state;
  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx ? Object.freeze({ ...s, ready: nextReady }) : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * AC 10304 Sub-AC 4 — toggle the ready flag on a slot. Sugar over
 * {@link setSlotReady} for the scene handler that wires the join key
 * as a press-to-toggle: un-ready → ready and ready → un-ready.
 */
export function toggleSlotReady(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `toggleSlotReady: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  return setSlotReady(state, slotIndex, !target.ready);
}

// ---------------------------------------------------------------------------
// AC 10205 Sub-AC 5 — per-AI-slot difficulty selection
// ---------------------------------------------------------------------------

/**
 * Canonical cycle order for AI difficulty selection in the character
 * select scene. Mirrors `lobby.AI_DIFFICULTY_CYCLE_ORDER` so a player
 * who learned the cycle order in the lobby keeps the same mental
 * model after the hand-off.
 */
export const AI_DIFFICULTY_CYCLE_ORDER: ReadonlyArray<AiDifficulty> =
  Object.freeze(['easy', 'medium', 'hard']);

/**
 * AC 10205 Sub-AC 5 — cycle a joined AI slot's difficulty through the
 * three tiers (`easy → medium → hard → easy`). The cycle is the
 * character-select-side complement to `lobby.cycleSlotAiDifficulty`
 * so a player who promoted a slot from human to AI mid-character-
 * select can dial in the difficulty without going back to the lobby.
 *
 * Contract:
 *
 *   • The slot must already be joined AND have `inputType === 'ai'`.
 *     Calling on a human slot or an un-joined slot is a silent no-op.
 *
 *   • Cycling difficulty does NOT drop `ready`. The player has
 *     committed to the *fighter* by readying up; the difficulty is a
 *     bot-config tweak that doesn't change the visible character /
 *     palette pick. Keeping `ready: true` through a difficulty cycle
 *     means a four-AI lobby can ready up, then dial in difficulty
 *     without un-readying.
 *
 *   • Throws on out-of-range slot index, matching the failure shape
 *     of the other transitions.
 *
 * Determinism: pure function — no `Math.random()`, no wall-clock.
 */
export function cycleSlotAiDifficulty(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `cycleSlotAiDifficulty: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  if (!target.joined || target.inputType !== 'ai') return state;

  const currentIdx = AI_DIFFICULTY_CYCLE_ORDER.indexOf(
    target.aiDifficulty ?? 'medium',
  );
  const baseIdx = currentIdx >= 0 ? currentIdx : -1;
  const nextIdx = (baseIdx + 1) % AI_DIFFICULTY_CYCLE_ORDER.length;
  const nextDifficulty = AI_DIFFICULTY_CYCLE_ORDER[nextIdx];
  if (!nextDifficulty || nextDifficulty === target.aiDifficulty) return state;

  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx
      ? Object.freeze({ ...s, aiDifficulty: nextDifficulty })
      : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * AC 10205 Sub-AC 5 — explicit setter complement to
 * {@link cycleSlotAiDifficulty}. Mirrors `lobby.setSlotAiDifficulty`.
 */
export function setSlotAiDifficulty(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
  nextDifficulty: AiDifficulty,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `setSlotAiDifficulty: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  if (!target.joined || target.inputType !== 'ai') return state;
  if (target.aiDifficulty === nextDifficulty) return state;
  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx
      ? Object.freeze({ ...s, aiDifficulty: nextDifficulty })
      : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * AC 10205 Sub-AC 5 — promote a human slot to an AI bot (or convert
 * an AI bot back to a human slot). The character-select scene's
 * "swap to AI" key is wired to this so a player can fill an empty
 * slot with an AI opponent without re-traversing the lobby flow.
 *
 *   • If `nextInputType === 'ai'`, the slot's `aiDifficulty` is
 *     populated (carrying through any existing value, falling back
 *     to `medium` if none is set).
 *
 *   • If `nextInputType` is a human kind, the `aiDifficulty` field
 *     is stripped so the slot doesn't carry a phantom difficulty
 *     into the replay header.
 *
 *   • Slot must already be joined — calling on an un-joined slot is
 *     a silent no-op. Switching input type drops `ready` because the
 *     "I confirmed THIS pick" assertion no longer applies (a slot
 *     that was a human is now a bot — the player should re-confirm).
 *
 *   • No exclusivity rule is enforced here: the lobby is the
 *     canonical surface for keyboard-half / gamepad-index conflicts.
 *     Character select trusts that the lobby already resolved any
 *     duplicates.
 *
 * Throws on out-of-range slot index.
 */
export function setSlotInputType(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
  nextInputType: InputType,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `setSlotInputType: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  if (!target.joined) return state;
  if (target.inputType === nextInputType) return state;

  const aiDifficulty: AiDifficulty | undefined =
    nextInputType === 'ai' ? target.aiDifficulty ?? 'medium' : undefined;

  // Strip the existing aiDifficulty before re-applying so the slot
  // doesn't carry a phantom field when promoted from AI to human.
  const { aiDifficulty: _strip, ...stripped } = target;
  void _strip;

  const nextSlot: CharacterSelectSlotState = Object.freeze({
    ...stripped,
    inputType: nextInputType,
    ready: false,
    ...(aiDifficulty !== undefined ? { aiDifficulty } : {}),
  });

  const nextSlots = state.slots.map((s, i) => (i === targetIdx ? nextSlot : s));
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

// ---------------------------------------------------------------------------
// AC 10403 Sub-AC 3 — per-player cursor navigation + lock-in confirmation
// ---------------------------------------------------------------------------

/**
 * AC 10403 Sub-AC 3 — set a slot's cursor to an absolute roster index.
 *
 * The cursor is the player's *hover* over the roster grid — distinct
 * from `characterId` (the *committed* pick). Cursor movement live-
 * previews each character without committing the pick; lock-in is the
 * separate {@link lockInSlotCharacter} transition.
 *
 * Behaviour:
 *
 *   • Always succeeds (no joined / un-joined gate). An un-joined slot
 *     can preview the roster too — cursor movement is purely a UI
 *     navigation operation. If the player joins later, their cursor is
 *     where they left it, so they can lock in immediately.
 *
 *   • The index wraps modulo the roster length so a caller that walks
 *     past the end lands back on cell 0 (and a decrement past 0 lands
 *     on the last cell). Negative / non-finite indices normalise to 0.
 *
 *   • Does NOT change `characterId`. The committed pick stays where it
 *     was; only the cursor moves. This is the load-bearing distinction
 *     the AC asks for — preview and commit are separate operations.
 *
 *   • Does NOT drop `ready`. A ready player can move their cursor
 *     around to look at other characters; the ready flag asserts they
 *     have confirmed THIS character at THIS palette, which is still
 *     true regardless of where the cursor is hovering. Lock-in on a
 *     different cursor cell is what un-readies (because it commits a
 *     new character).
 *
 *   • No-op detection: if the slot's cursor is already at the wrapped
 *     target, returns the same state reference so consumers can
 *     compare with `===` and skip re-rendering.
 *
 * Throws on out-of-range slot index — same failure shape as the other
 * transitions.
 */
export function setSlotCursor(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
  nextCursorIndex: number,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `setSlotCursor: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  const wrapped = wrapCursorIndex(nextCursorIndex);
  if (target.cursorIndex === wrapped) return state;
  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx ? Object.freeze({ ...s, cursorIndex: wrapped }) : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * AC 10403 Sub-AC 3 — move a slot's cursor by a relative direction
 * (`+1` for next cell, `-1` for previous, etc.). Sugar over
 * {@link setSlotCursor} that accepts a relative delta.
 *
 *   • `direction` is truncated via `Math.trunc` so a fractional input
 *     (e.g. from a gamepad analogue stick) collapses to an integer
 *     step. A direction of `0` is a silent no-op (same `===` reference
 *     returned).
 *
 *   • Wrap-around behaviour matches {@link setSlotCursor} — past the
 *     last cell loops back to 0; past 0 loops to the last cell.
 *
 *   • An un-joined slot can still move its cursor — see
 *     {@link setSlotCursor} for the rationale.
 *
 *   • Like {@link setSlotCursor}, this transition does not touch
 *     `characterId` / `paletteIndex` / `ready` — only the cursor.
 *
 * Throws on out-of-range slot index.
 */
export function moveSlotCursor(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
  direction: number,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `moveSlotCursor: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  const step = Number.isFinite(direction) ? Math.trunc(direction) : 0;
  if (step === 0) return state;
  return setSlotCursor(state, slotIndex, target.cursorIndex + step);
}

/**
 * AC 10403 Sub-AC 3 — atomic "lock-in confirmation": commit the slot's
 * cursor character to `characterId` AND mark `ready: true` in one
 * transition.
 *
 * This is the headline transition the AC calls out — the explicit
 * action that promotes a hover into a committed pick. Splitting commit
 * from ready-up across two steps (e.g. `setSlotCharacter` then
 * `setSlotReady`) would leak the un-ready intermediate state to
 * consumers; the atomic helper guarantees observers always see a
 * locked-in slot in one paint frame.
 *
 * Behaviour:
 *
 *   • Slot must be joined. Calling on an un-joined slot is a silent
 *     no-op (returns same state reference). The lobby's `joined` gate
 *     stays the canonical surface for "is this slot active?".
 *
 *   • `characterId` is set to `SELECTABLE_CHARACTER_SPECS[cursorIndex].id`.
 *     If the cursor is already on `characterId`, this is just the
 *     "I confirm the default / current pick" path — the slot becomes
 *     ready without changing the visible character.
 *
 *   • `ready` is set to `true` in the SAME transition, regardless of
 *     whether the character actually changed. Lock-in is the player's
 *     explicit "yes, this is my pick" sign-off.
 *
 *   • `paletteIndex` / `inputType` / `aiDifficulty` are preserved. The
 *     palette in particular is the differentiation hook AC 13 calls
 *     out, so a player who cycled through palettes before locking in
 *     keeps the colour they picked.
 *
 *   • If the cursor and committed character are already aligned AND
 *     the slot is already ready, returns the same state reference so
 *     spurious key repeats / debouncing don't churn the readiness
 *     state machine.
 *
 *   • Auto-distinct-palette repair is NOT run inside this transition;
 *     the scene's `applyTransition` wrapper runs it on every
 *     transition so a lock-in that produces a `(character, palette)`
 *     collision is repaired before the next paint. Keeping the repair
 *     pass at the scene boundary means the helper stays a pure data
 *     transition (testable under plain Node).
 *
 * Throws on out-of-range slot index.
 */
export function lockInSlotCharacter(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `lockInSlotCharacter: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  if (!target.joined) return state;

  const cursorWrapped = wrapCursorIndex(target.cursorIndex);
  const cursorSpec =
    SELECTABLE_CHARACTER_SPECS[cursorWrapped] ?? SELECTABLE_CHARACTER_SPECS[0];
  if (!cursorSpec) {
    // Saturation guard — empty roster is impossible at runtime but
    // defended so a future feature flag that gates the entire roster
    // off doesn't crash the lobby.
    return state;
  }
  const cursorCharacterId = cursorSpec.id;

  // Fast path: already locked in on the same character.
  if (target.characterId === cursorCharacterId && target.ready) {
    return state;
  }

  const nextSlots = state.slots.map((s, i) =>
    i === targetIdx
      ? Object.freeze({
          ...s,
          characterId: cursorCharacterId,
          cursorIndex: cursorWrapped,
          ready: true,
        })
      : s,
  );
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

/**
 * AC 10403 Sub-AC 3 — cancel a previous lock-in. Sugar over
 * {@link toggleSlotReady} for symmetry with {@link lockInSlotCharacter}.
 * Drops `ready` back to `false` so the player can move the cursor and
 * pick a different character. Does NOT revert `characterId` to a prior
 * value — once committed, the character stays committed until the next
 * lock-in. The cursor stays where it was so the player can resume
 * hovering from the locked cell rather than snapping back to the
 * default.
 *
 *   • No-op on un-joined slots (returns same state reference).
 *   • No-op on already-un-ready slots (the only side-effect would be
 *     toggling `ready` from false to false, which is a no-op).
 *
 * Throws on out-of-range slot index.
 */
export function cancelSlotLockIn(
  state: CharacterSelectState,
  slotIndex: 1 | 2 | 3 | 4,
): CharacterSelectState {
  const targetIdx = slotIndex - 1;
  const target = state.slots[targetIdx];
  if (!target) {
    throw new Error(
      `cancelSlotLockIn: slotIndex ${slotIndex} is out of range (1..${MAX_PLAYER_SLOTS})`,
    );
  }
  if (!target.joined) return state;
  if (!target.ready) return state;
  return setSlotReady(state, slotIndex, false);
}

/**
 * AC 10403 Sub-AC 3 — resolve a slot's cursor to the character spec it
 * is currently hovering. Helper used by the preview projection +
 * portrait-grid hover paint so consumers don't need to duplicate the
 * `wrapCursorIndex` / roster lookup boilerplate.
 *
 * Returns the spec at `wrapCursorIndex(slot.cursorIndex)`, falling back
 * to the first roster spec if the index is somehow out of range
 * (impossible at runtime since `wrapCursorIndex` clamps, but defended).
 */
export function getSlotCursorCharacterId(
  slot: CharacterSelectSlotState,
): CharacterId {
  const wrapped = wrapCursorIndex(slot.cursorIndex);
  const spec =
    SELECTABLE_CHARACTER_SPECS[wrapped] ?? SELECTABLE_CHARACTER_SPECS[0];
  return spec?.id ?? slot.characterId;
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

/**
 * Project the live character-select state onto a `PlayerSlot[]` for
 * `MatchConfig.players`. Only **joined** slots are included — slots
 * that never Pressed Start are dropped so a 2-player match doesn't
 * spawn ghosts in slots 3 and 4.
 *
 * Sub-AC 1 of AC 13 is observable here too: if two joined slots share a
 * `characterId`, the resulting array contains two `PlayerSlot` entries
 * with that same `characterId` — no de-dup, no "first wins" override.
 *
 * The returned array is frozen and each entry is frozen, mirroring the
 * shape `MatchConfig.players` consumers expect.
 */
export function buildPlayerSlotsFromState(
  state: CharacterSelectState,
): ReadonlyArray<PlayerSlot> {
  const out: PlayerSlot[] = [];
  for (const slot of state.slots) {
    if (!slot.joined) continue;
    out.push(
      Object.freeze({
        index: slot.index,
        characterId: slot.characterId,
        paletteIndex: slot.paletteIndex,
        inputType: slot.inputType,
        ...(slot.aiDifficulty !== undefined
          ? { aiDifficulty: slot.aiDifficulty }
          : {}),
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * Convenience predicate — `true` iff the lineup contains two or more
 * joined slots picking the same character. Exposed so the future
 * palette auto-differentiation step (a separate sub-AC of AC 13) can
 * detect "needs to pick distinct palettes" without re-implementing the
 * scan, and so tests can assert that this module *allows* the state
 * (rather than rejecting it).
 */
export function hasSameCharacterPicks(state: CharacterSelectState): boolean {
  const seen = new Set<CharacterId>();
  for (const slot of state.slots) {
    if (!slot.joined) continue;
    if (seen.has(slot.characterId)) return true;
    seen.add(slot.characterId);
  }
  return false;
}

/**
 * Convenience predicate — `true` iff the candidate spec is one of the
 * roster's `playable: true` entries. Selection UIs use this to grey out
 * placeholder specs (Owl/Bear during M1) without hard-coding a list.
 *
 * Note: even *non-playable* specs do not trigger any uniqueness
 * restriction. Two players are free to both pick a placeholder if the
 * scene exposes one; the no-restriction rule is unconditional.
 */
export function isPlayableCharacter(id: CharacterId): boolean {
  return PLAYABLE_CHARACTER_SPECS.some((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// AC 10304 Sub-AC 4 — readiness + conflict predicates
// ---------------------------------------------------------------------------

/**
 * `true` iff every joined slot is also `ready: true`. Empty / no-joined
 * lobbies return `false` because there's no-one to fight; the scene's
 * confirm path uses this together with `getJoinedSlotCount` to decide
 * whether ENTER actually starts the match.
 *
 * Pure scan over `state.slots` — no branching on un-joined slots, no
 * Phaser globals, deterministic.
 */
export function allJoinedSlotsReady(state: CharacterSelectState): boolean {
  let anyJoined = false;
  for (const slot of state.slots) {
    if (!slot.joined) continue;
    anyJoined = true;
    if (!slot.ready) return false;
  }
  return anyJoined;
}

/**
 * Number of slots whose `joined === true`. Helper so callers don't
 * keep re-scanning for the count. Used by the confirm-path gating
 * (need ≥ 1 joined slot to start a match) and by the lobby header to
 * report "2 of 4 joined".
 */
export function getJoinedSlotCount(state: CharacterSelectState): number {
  let n = 0;
  for (const slot of state.slots) {
    if (slot.joined) n += 1;
  }
  return n;
}

/**
 * Number of joined slots that are also ready. Mirror of
 * {@link getJoinedSlotCount} for the readiness axis so the lobby
 * header can paint "1 of 2 ready" without two scans.
 */
export function getReadySlotCount(state: CharacterSelectState): number {
  let n = 0;
  for (const slot of state.slots) {
    if (slot.joined && slot.ready) n += 1;
  }
  return n;
}

/**
 * AC 10304 Sub-AC 4 — `true` iff two or more joined slots end up on
 * the same `(characterId, paletteIndex)` pair. The seam that the
 * scene's auto-distinct-palette repair pass (`autoAssignDistinctPalettes`)
 * fixes for the common case (≤ 4 slots, ≤ 8 palettes). This predicate
 * exists to *detect* the leftover impossible-to-resolve case (which
 * cannot occur at MAX_PLAYER_SLOTS=4 + PALETTE_COUNT=8 but is checked
 * defensively) and to assert in tests that the repair pass actually
 * eliminates collisions.
 *
 * Un-joined slots are ignored — un-joined picks don't render in the
 * match so they can't visually collide with anyone.
 */
export function hasPaletteCollision(state: CharacterSelectState): boolean {
  const seen = new Set<string>();
  for (const slot of state.slots) {
    if (!slot.joined) continue;
    const key = `${slot.characterId}#${slot.paletteIndex}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

/**
 * AC 10304 Sub-AC 4 — top-level "is the lobby ready to confirm?"
 * predicate. `true` iff:
 *
 *   • At least one slot is joined (no zero-player matches).
 *   • Every joined slot is ready (no dragging an un-confirmed player
 *     into the fight).
 *   • There is no `(characterId, paletteIndex)` collision among the
 *     joined slots (defence-in-depth — the auto-distinct-palette pass
 *     normally clears these, but a saturation case shouldn't slip
 *     through into the match).
 *
 * The scene's ENTER handler short-circuits on `!canConfirmMatch(state)`
 * so a premature press is a no-op rather than a partial start.
 */
export function canConfirmMatch(state: CharacterSelectState): boolean {
  if (getJoinedSlotCount(state) === 0) return false;
  if (!allJoinedSlotsReady(state)) return false;
  if (hasPaletteCollision(state)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Wrap a palette index into [0, PALETTE_COUNT). Mirrors the behaviour
 * of `wrapIndex` in `modeSelect.ts` but specialised to the palette
 * ladder so the cycling logic keeps a single source of truth.
 *
 * Negative or non-finite inputs are normalised to 0 rather than
 * throwing so a malformed JSON-loaded selection doesn't take down the
 * lobby.
 */
function wrapPaletteIndex(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const i = Math.trunc(raw);
  return ((i % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT;
}

// ---------------------------------------------------------------------------
// Sub-AC 4 — palette previews + auto-distinct-palette assignment
// ---------------------------------------------------------------------------

/**
 * One slot's worth of "what colours should the lobby preview tile
 * paint right now?" data. Pure projection of
 * `(slot.characterId, slot.paletteIndex)` onto the palette ladder in
 * `palettes.ts` so the Phaser `CharacterSelectScene` can paint preview
 * swatches without knowing about the palette table directly.
 *
 * Mirrors the shape of `PaletteSwap` from
 * `characters/PaletteSwapRenderer.ts` but lives on the *lobby* side so
 * the dependency arrow stays pointed at the data layer (`palettes.ts`)
 * and never reaches into the renderer module.
 *
 *   • `slotIndex`     — 1..4 — origin slot, mirrors `PlayerSlot.index`.
 *   • `characterId`   — chosen character.
 *   • `paletteIndex`  — resolved palette index (0..7), already wrapped.
 *   • `displayName`   — character display name (e.g. "Wolf"), copied
 *                       from the roster spec — saves callers an extra
 *                       lookup for the preview tile heading.
 *   • `roleLabel`     — character archetype label (e.g. "bruiser").
 *   • `playable`      — true if the character is playable; false for
 *                       placeholder M1 specs (Owl/Bear).
 *   • `paletteName`   — palette display name ("Crimson", "Mint", …).
 *   • `primaryColor`  — body fill colour (0xRRGGBB).
 *   • `accentColor`   — outline / facing-arrow colour (0xRRGGBB).
 *   • `labelColor`    — HUD label / banner-tint colour (0xRRGGBB).
 *   • `joined`        — mirrored from the slot — preview tile fades
 *                       un-joined slots so the lobby reads at a glance.
 */
export interface CharacterSelectSlotPreview {
  readonly slotIndex: 1 | 2 | 3 | 4;
  readonly characterId: CharacterId;
  readonly paletteIndex: number;
  readonly displayName: string;
  readonly roleLabel: string;
  readonly playable: boolean;
  readonly paletteName: string;
  readonly primaryColor: number;
  readonly accentColor: number;
  readonly labelColor: number;
  readonly joined: boolean;
  /**
   * AC 10304 Sub-AC 4 — true iff the slot has signed off on its
   * current `(characterId, paletteIndex)` pick. Mirrored onto the
   * preview so the lobby tile can paint a "READY" banner / colour
   * change without re-reading the underlying state.
   */
  readonly ready: boolean;
  /**
   * AC 10205 Sub-AC 5 — what kind of player feeds inputs into this
   * slot. Mirrored onto the preview so the tile can paint the input-
   * device label ("HUMAN P1", "AI BOT (HARD)", etc.) without
   * re-reading the underlying state.
   */
  readonly inputType: InputType;
  /**
   * AC 10205 Sub-AC 5 — for AI slots, the selected difficulty tier.
   * Mirrored onto the preview so the tile can paint "AI (HARD)"
   * without doing the AI-vs-human branch in the rendering layer.
   * `undefined` for human slots so consumers can detect "is this
   * slot an AI?" by truthy-check on this field.
   */
  readonly aiDifficulty: AiDifficulty | undefined;
  /**
   * AC 10403 Sub-AC 3 — current cursor index over
   * {@link SELECTABLE_CHARACTER_SPECS}. Mirrored from the slot state
   * so the scene can paint a cursor frame on the portrait grid + the
   * "hovering: Wolf" badge on the slot tile without re-reading the
   * underlying state.
   */
  readonly cursorIndex: number;
  /**
   * AC 10403 Sub-AC 3 — the character id the cursor is currently
   * hovering on. Equals `characterId` when cursor and commit are in
   * sync (the common case post lock-in or fresh open); diverges from
   * `characterId` when the player has moved their cursor away from
   * their committed pick to preview another fighter.
   */
  readonly cursorCharacterId: CharacterId;
  /**
   * AC 10403 Sub-AC 3 — display name of the hovered character, copied
   * off the spec so the scene's "Hovering: …" label doesn't have to
   * re-resolve the spec.
   */
  readonly cursorDisplayName: string;
  /**
   * AC 10403 Sub-AC 3 — role label of the hovered character. Same
   * rationale as `cursorDisplayName`.
   */
  readonly cursorRoleLabel: string;
  /**
   * AC 10403 Sub-AC 3 — whether the hovered character ships a full
   * playable kit. Lets the scene paint a "(locked)" badge over a
   * non-playable hover so the player isn't surprised when lock-in is
   * still allowed — the underlying transition doesn't gate on this.
   */
  readonly cursorPlayable: boolean;
  /**
   * AC 10403 Sub-AC 3 — true iff the cursor is hovering the same
   * character the slot has committed to. The scene uses this to pick
   * between two paint paths: cursor-and-commit aligned → single
   * preview body, cursor-on-different-cell → two-up preview ("you have
   * X locked in, hovering Y").
   */
  readonly cursorOnCommittedCharacter: boolean;
  /**
   * AC 10403 Sub-AC 3 — alias for `ready`. Mirrors the AC's "lock-in
   * confirmation" terminology so call sites in the scene that paint
   * the lock-in state read like the AC text.
   */
  readonly locked: boolean;
}

/**
 * One swatch in a palette-strip preview — the small ladder of 8 colour
 * chips a character-select tile shows under the active fighter so the
 * player can see every available palette at a glance, with the active
 * one highlighted.
 *
 * Pure data so the Phaser scene can iterate the array and paint a row
 * of tiny rectangles without re-deriving anything per chip.
 */
export interface CharacterSelectPaletteSwatch {
  readonly index: number;
  readonly displayName: string;
  readonly primaryColor: number;
  readonly accentColor: number;
  /** True if this swatch matches the slot's current `paletteIndex`. */
  readonly active: boolean;
}

/**
 * Build a `CharacterSelectSlotPreview` from one slot. Pure function of
 * the slot's `(characterId, paletteIndex, joined)` plus the static
 * roster + palette tables. Same inputs always produce the same record
 * so the Phaser scene can compare snapshots with `paletteSwapEqual`-
 * style structural equality and skip re-paints.
 */
export function buildSlotPreview(
  slot: CharacterSelectSlotState,
): CharacterSelectSlotPreview {
  const spec = getCharacterSpec(slot.characterId);
  const palette = getCharacterPalette(slot.characterId, slot.paletteIndex);
  // AC 10403 Sub-AC 3 — also resolve the cursor's character so the
  // preview can carry both "what is committed" (spec) and "what is
  // hovered" (cursorSpec) on a single record. The two coincide on the
  // common cursor-aligned-with-commit path; only when the player has
  // navigated the cursor away does the projection split.
  const cursorWrapped = wrapCursorIndex(slot.cursorIndex);
  const cursorSpec =
    SELECTABLE_CHARACTER_SPECS[cursorWrapped] ?? SELECTABLE_CHARACTER_SPECS[0] ?? spec;
  return Object.freeze({
    slotIndex: slot.index,
    characterId: slot.characterId,
    paletteIndex: palette.index,
    displayName: spec.displayName,
    roleLabel: spec.role,
    playable: spec.playable,
    paletteName: palette.displayName,
    primaryColor: palette.primaryColor,
    accentColor: palette.accentColor,
    labelColor: palette.labelColor,
    joined: slot.joined,
    ready: slot.ready,
    inputType: slot.inputType,
    aiDifficulty:
      slot.inputType === 'ai' ? slot.aiDifficulty ?? 'medium' : undefined,
    cursorIndex: cursorWrapped,
    cursorCharacterId: cursorSpec.id,
    cursorDisplayName: cursorSpec.displayName,
    cursorRoleLabel: cursorSpec.role,
    cursorPlayable: cursorSpec.playable,
    cursorOnCommittedCharacter: cursorSpec.id === slot.characterId,
    locked: slot.ready,
  });
}

/**
 * Build the full 8-swatch ladder for a slot — one entry per palette,
 * with `active: true` on whichever entry matches the slot's current
 * `paletteIndex`. Used by the character-select tile to paint the row
 * of palette chips beneath the active fighter preview.
 *
 * Length is always {@link PALETTE_COUNT}; entries appear in palette-
 * index order (0 → 7) so a Phaser `Container` can iterate without
 * sorting. Out-of-range / negative `paletteIndex` on the slot wraps
 * via `getCharacterPalette`, so a malformed slot still produces a
 * valid swatch row with one entry marked active.
 */
export function buildSlotPaletteSwatches(
  slot: CharacterSelectSlotState,
): ReadonlyArray<CharacterSelectPaletteSwatch> {
  const ladder = getCharacterPalettes(slot.characterId);
  const activeIndex = wrapPaletteIndex(slot.paletteIndex);
  return Object.freeze(
    ladder.map((p: CharacterPalette) =>
      Object.freeze({
        index: p.index,
        displayName: p.displayName,
        primaryColor: p.primaryColor,
        accentColor: p.accentColor,
        active: p.index === activeIndex,
      }),
    ),
  );
}

/**
 * Project the full character-select state onto an array of slot
 * previews — one per slot (always {@link MAX_PLAYER_SLOTS} entries),
 * in slot order. Useful for the Phaser scene's per-frame re-paint and
 * for tests that want to assert the whole preview surface in one
 * snapshot.
 */
export function buildSlotPreviews(
  state: CharacterSelectState,
): ReadonlyArray<CharacterSelectSlotPreview> {
  return Object.freeze(state.slots.map((s) => buildSlotPreview(s)));
}

/**
 * Sub-AC 4 of AC 13 — auto-assign distinct palettes when two or more
 * **joined** slots have picked the same character.
 *
 * The contract:
 *
 *   • Pure deterministic transition. Same input state always produces
 *     the same output state — no `Math.random()`, no wall-clock.
 *
 *   • Only operates on **joined** slots. An un-joined slot's palette is
 *     left untouched so opening the lobby and seeing a placeholder
 *     never reshuffles palettes the active players have dialled in.
 *
 *   • For each character that two or more joined slots picked, the
 *     algorithm walks the slots in index order (slot 1 → 2 → 3 → 4) and
 *     assigns the first un-claimed palette index from the character's
 *     ladder. The lowest-numbered slot keeps its current palette; later
 *     slots are bumped to the next free palette index, wrapping around
 *     the 8-palette ladder if necessary.
 *
 *   • Slots whose character is unique among joined slots keep their
 *     palette unchanged (no churn for the common "everyone picks a
 *     different fighter" case).
 *
 *   • If two slots already happen to be on distinct palettes for the
 *     same character, this function is a no-op for them — only
 *     *colliding* `(characterId, paletteIndex)` pairs are repaired.
 *
 *   • Returns the same state reference on a no-op (so consumers can
 *     compare with `===` and skip re-rendering).
 *
 * Why "lowest-slot wins": stable, deterministic, and matches the
 * intuition "the first player to pick a character keeps their colour;
 * the duplicate has to move." Two players locking the same fighter at
 * the same instant resolves predictably without surfacing a
 * "duplicate detected!" modal — the lobby just quietly assigns
 * different colours and the players see the change as feedback.
 *
 * Why we don't shuffle randomly: the Seed's determinism contract
 * forbids `Math.random()` in any gameplay-touching path; the lobby
 * state feeds into `MatchConfig.players` which in turn feeds the
 * replay header, so a non-deterministic palette pick would break
 * replay reproducibility on the very next match.
 *
 * Saturation case: if more than {@link PALETTE_COUNT} (8) slots
 * collide on the same character — currently impossible since
 * {@link MAX_PLAYER_SLOTS} is 4 — the algorithm wraps and reuses
 * palettes; the 9th slot would land on whichever palette the 1st
 * slot is using. The current 4-slot cap means the 8-palette ladder
 * always has 4 spare colours per character; the wrap branch is
 * defensive only.
 */
export function autoAssignDistinctPalettes(
  state: CharacterSelectState,
): CharacterSelectState {
  // Track which palette index each character already has claimed.
  // Walking slots in ascending index order ensures the lowest-numbered
  // slot wins on a collision.
  const claimed = new Map<CharacterId, Set<number>>();
  let mutated = false;
  const nextSlots: CharacterSelectSlotState[] = [];

  for (const slot of state.slots) {
    if (!slot.joined) {
      // Un-joined slots are spectators — their palette doesn't appear
      // in the live `PlayerSlot[]` so they can't visually collide with
      // anyone. Leave them alone so a player who joins later sees the
      // colours they had selected before.
      nextSlots.push(slot);
      continue;
    }

    const charClaimed = claimed.get(slot.characterId) ?? new Set<number>();
    const wantedPalette = wrapPaletteIndex(slot.paletteIndex);

    if (!charClaimed.has(wantedPalette)) {
      // No collision — the slot keeps the palette it had.
      charClaimed.add(wantedPalette);
      claimed.set(slot.characterId, charClaimed);
      nextSlots.push(slot);
      continue;
    }

    // Collision: walk the palette ladder and pick the first un-
    // claimed index. Start one past the wanted palette so the search
    // prefers nearby colours over reaching back to palette 0.
    let resolved = wantedPalette;
    for (let step = 1; step <= PALETTE_COUNT; step += 1) {
      const candidate = (wantedPalette + step) % PALETTE_COUNT;
      if (!charClaimed.has(candidate)) {
        resolved = candidate;
        break;
      }
    }
    // Saturation guard: if every palette is claimed (impossible at
    // MAX_PLAYER_SLOTS=4 but defended for future expansion), fall
    // back to the wanted palette — a duplicated colour beats a
    // crashed lobby.
    if (resolved === wantedPalette && charClaimed.has(resolved)) {
      // No-op: every palette claimed; keep the wanted palette and
      // accept the visual collision.
      charClaimed.add(resolved);
      claimed.set(slot.characterId, charClaimed);
      nextSlots.push(slot);
      continue;
    }

    charClaimed.add(resolved);
    claimed.set(slot.characterId, charClaimed);
    mutated = true;
    nextSlots.push(Object.freeze({ ...slot, paletteIndex: resolved }));
  }

  if (!mutated) return state;
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}

// ---------------------------------------------------------------------------
// AC 10303 Sub-AC 3 — character portraits grid
// ---------------------------------------------------------------------------

/**
 * One cell in the character-portraits grid the lobby paints between the
 * title bar and the per-slot tiles. Pure projection of one
 * `CharacterSpec` onto the data the Phaser scene needs to render a
 * portrait tile (placeholder rectangle, name, role, list of slots that
 * have it picked).
 *
 * AC 10303 Sub-AC 3: "Build character select screen UI layout with 4
 * player slots, character portraits grid, and palette swatch picker per
 * slot." The 4 player slots + palette swatch picker were already shipped
 * in AC 13 Sub-AC 4. The portraits grid is the missing visual surface —
 * a centralised gallery of every roster character that lets the player
 * see "who can I pick?" at a glance and shows which slots have already
 * locked onto each character (via colour-coded chips).
 *
 * Why a separate cell type instead of reusing `CharacterSelectSlotPreview`:
 * the slot preview is keyed on a specific `(characterId, paletteIndex)`
 * combination — what *one* slot looks like right now. The portrait grid
 * cell is keyed on a `characterId` alone — what *every* slot would look
 * like if it picked this character on palette 0. The two views overlap
 * (both read from the roster + palette table) but diverge in one place:
 * the grid cell reports which slots currently have this character so the
 * UI can highlight cells with multiple pickers (AC 13's same-character
 * support remains observable through this surface too).
 *
 *   • `characterId`         — id of the character this cell represents.
 *   • `displayName`         — character display name (e.g. "Wolf").
 *   • `roleLabel`           — character archetype label (e.g. "bruiser").
 *   • `playable`            — true if the character ships a full kit.
 *                             False entries are still rendered (so the
 *                             grid layout stays stable across the
 *                             M1→M2 reveal) but the scene paints them
 *                             greyed out.
 *   • `primaryColor`        — body fill colour for the portrait tile,
 *                             read from palette 0 (the canonical hue).
 *   • `accentColor`         — outline / accent colour for the portrait
 *                             tile, read from palette 0.
 *   • `selectedBySlots`     — sorted ascending list of 1..4 slot indices
 *                             whose `joined` is true *and* whose
 *                             `characterId` matches this cell. Empty
 *                             when no joined slot has this character
 *                             selected. The scene paints a chip per
 *                             slot index here so the player sees at a
 *                             glance "P1 + P3 are both on Wolf".
 */
export interface CharacterPortraitGridCell {
  readonly characterId: CharacterId;
  readonly displayName: string;
  readonly roleLabel: string;
  readonly playable: boolean;
  readonly primaryColor: number;
  readonly accentColor: number;
  readonly selectedBySlots: ReadonlyArray<1 | 2 | 3 | 4>;
  /**
   * AC 10403 Sub-AC 3 — sorted ascending list of 1..4 slot indices
   * whose cursor is currently *hovering* this cell. Distinct from
   * `selectedBySlots` (the slot has committed to this character) — a
   * slot can hover one cell while having a different cell committed,
   * which is exactly the cursor / lock-in distinction this AC adds.
   *
   * Includes both joined and un-joined slots: an un-joined "spectator"
   * slot can still hover the grid (the player is browsing before
   * pressing JOIN), and the scene paints the hover frame whether or
   * not the slot has joined. Selection chips below the portrait still
   * gate on `joined` via `selectedBySlots`.
   *
   * Empty when no slot's cursor is on this cell. Sorted ascending so
   * the scene paints hover frames left-to-right as P1 → P4 regardless
   * of internal scan order.
   */
  readonly hoveredBySlots: ReadonlyArray<1 | 2 | 3 | 4>;
}

/**
 * The full character-portraits grid projection — one
 * {@link CharacterPortraitGridCell} per spec in
 * {@link SELECTABLE_CHARACTER_SPECS}, in roster order. Pure function of
 * the live `CharacterSelectState`; the only state the cells reflect is
 * which joined slots currently have each character picked.
 *
 * The returned array is frozen and each entry is frozen, so the Phaser
 * scene can iterate without bounds checking and React-style memoised
 * renderers can compare with `===` to skip re-paints.
 *
 * Why driven from `state` rather than exposing a static `CHARACTER_PORTRAITS`
 * constant: the `selectedBySlots` field is the tie-back to the live
 * lobby — without it the grid would be a static decorative panel, not
 * a feedback surface that confirms "yes, your pick was registered."
 * Same-character support (AC 13 Sub-AC 1) is the load-bearing reason
 * `selectedBySlots` is a list rather than a single optional slot index —
 * up to 4 joined slots can share a portrait cell.
 *
 * Determinism: same `state` always produces the same cell array byte-
 * identically. No `Math.random()`, no wall-clock; the cell colours come
 * from the frozen palette ladder and the slot-pick projection is a pure
 * scan over `state.slots`.
 */
export function buildCharacterPortraitGrid(
  state: CharacterSelectState,
): ReadonlyArray<CharacterPortraitGridCell> {
  // Build one cell per spec in roster order. We use the canonical
  // palette (index 0) for every cell's body colour so the grid reads
  // as "what does each character look like?" rather than "what does
  // each character on its currently-selected palette look like?".
  // Per-slot palette previews already live on the slot tiles below.
  return Object.freeze(
    SELECTABLE_CHARACTER_SPECS.map((spec, specIdx) => {
      const canonicalPalette = getCharacterPalette(spec.id, 0);
      const selectedBySlots: (1 | 2 | 3 | 4)[] = [];
      // AC 10403 Sub-AC 3 — also collect cursor hover positions in the
      // same scan so we don't re-walk the slots twice. A slot with its
      // cursor on this cell shows up in `hoveredBySlots`, regardless of
      // whether it has joined or whether it has committed to this
      // character. The selection chip row stays gated on
      // `joined && characterId === spec.id`.
      const hoveredBySlots: (1 | 2 | 3 | 4)[] = [];
      for (const slot of state.slots) {
        if (slot.joined && slot.characterId === spec.id) {
          selectedBySlots.push(slot.index);
        }
        if (wrapCursorIndex(slot.cursorIndex) === specIdx) {
          hoveredBySlots.push(slot.index);
        }
      }
      // Sort ascending so the chip / hover rows paint P1 → P4
      // left-to-right regardless of the order we encountered the slots.
      selectedBySlots.sort((a, b) => a - b);
      hoveredBySlots.sort((a, b) => a - b);
      return Object.freeze({
        characterId: spec.id,
        displayName: spec.displayName,
        roleLabel: spec.role,
        playable: spec.playable,
        primaryColor: canonicalPalette.primaryColor,
        accentColor: canonicalPalette.accentColor,
        selectedBySlots: Object.freeze(selectedBySlots),
        hoveredBySlots: Object.freeze(hoveredBySlots),
      });
    }),
  );
}

// ---------------------------------------------------------------------------
// AC 2 Sub-AC 5 — lobby hand-off hydration
// ---------------------------------------------------------------------------

/**
 * Pre-populate a `CharacterSelectState`'s `joined` / `inputType` /
 * `aiDifficulty` slot fields from a `LobbyHandoffPayload`. Returns a
 * fresh state so the existing "every transition produces a new
 * snapshot" contract is preserved.
 *
 * The character + palette defaults already baked into `state` are
 * preserved — only the join-related fields change. Slots not present
 * in the hand-off payload are reset to un-joined / un-ready so a
 * lobby that produced "P1 + P3 only" doesn't carry P2's default
 * `joined: true` from `DEFAULT_CHARACTER_SELECT_STATE`.
 *
 * Pure deterministic function — no `Math.random()`, no wall-clock,
 * same input always produces the same output. Safe to call from
 * scene `init()` paths and tests alike.
 */
export function applyLobbyHandoffToCharacterSelect(
  state: CharacterSelectState,
  handoff: LobbyHandoffPayload,
): CharacterSelectState {
  const joinedByIndex = new Map<1 | 2 | 3 | 4, LobbyHandoffPayload['slots'][number]>();
  for (const slot of handoff.slots) {
    if (slot.joined) joinedByIndex.set(slot.index, slot);
  }

  const nextSlots = state.slots.map((s) => {
    const lobbySlot = joinedByIndex.get(s.index);
    if (!lobbySlot) {
      // Lobby never claimed this slot → reset to un-joined regardless
      // of the default state. This makes the lobby the canonical
      // gate: a hand-off that produced "P1 + P3 only" runs as a
      // 2-player match, not 3 (with P2 carrying its default join).
      if (!s.joined && !s.ready) return s;
      return Object.freeze({ ...s, joined: false, ready: false });
    }
    const inputType: InputType = lobbySlot.inputType ?? s.inputType;
    const aiDifficulty: AiDifficulty | undefined =
      inputType === 'ai'
        ? lobbySlot.aiDifficulty ?? s.aiDifficulty ?? 'medium'
        : undefined;
    // Strip the old `aiDifficulty` first so a slot that used to be
    // an AI bot but is now claimed by a human keyboard / gamepad
    // doesn't carry a phantom difficulty field.
    const { aiDifficulty: _strip, ...stripped } = s;
    void _strip;
    return Object.freeze({
      ...stripped,
      joined: true,
      ready: false,
      inputType,
      ...(aiDifficulty !== undefined ? { aiDifficulty } : {}),
    });
  });
  return Object.freeze({ slots: Object.freeze(nextSlots) });
}
