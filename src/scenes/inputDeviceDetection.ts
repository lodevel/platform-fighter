/**
 * Active input device detection — AC 50002 Sub-AC 2.
 *
 * Purpose
 * -------
 *
 * The Seed promises "active input device detection per player slot
 * (keyboard vs gamepad)" with the detected device type surfaced in
 * the UI. The existing {@link LobbySlotState.inputType} field already
 * records what device a slot *claimed* at join time
 * (`'keyboard_p1'` / `'keyboard_p2'` / `'gamepad'` / `'ai'`) — but
 * that is a static authoring choice. This module fills the missing
 * "is the configured device actually present right now?" question:
 *
 *   • For keyboard slots — the keyboard is always available in a
 *     desktop browser, so detection collapses to "yes, keyboard is
 *     active, on the WASD or ARROWS half".
 *   • For gamepad slots — the configured `gamepadIndex` must exist
 *     in `navigator.getGamepads()` AND report `connected: true`.
 *     A configured-but-disconnected slot is flagged so the lobby tile
 *     can paint "GAMEPAD MISSING" instead of pretending the pad is
 *     wired.
 *   • For AI slots — there's no hardware device, but we still emit a
 *     stable `'ai'` kind so downstream UI code can branch uniformly.
 *
 * Why a dedicated module
 * ----------------------
 *
 * Per the project's `code_architecture` evaluation principle, scene
 * files stay thin and UI-side. The runtime input plumbing
 * (`DeviceInputDispatcher`, `GamepadConnectionMonitor`,
 * `InputBindingManager`) lives under `src/input/` and is concerned
 * with *delivering* per-frame input. This module is concerned with
 * *describing* the current device topology to the UI — a different
 * read pattern (per-frame poll → tile re-paint) on the same
 * underlying browser surface (`navigator.getGamepads()`).
 *
 * Keeping it Phaser-free means:
 *
 *   • Vitest can exercise it without jsdom (Phaser globals would
 *     blow up under a Node worker).
 *   • A future "device test" diagnostic screen can reuse the same
 *     helpers without dragging the Lobby scene's render concerns in.
 *   • Replay / smoke-test tooling can inject a synthetic snapshot to
 *     paint "what the lobby tile would say" for a given controller
 *     topology.
 *
 * Determinism
 * -----------
 *
 * Every helper here is a pure function of its inputs — no
 * `Math.random()`, no wall-clock reads, no Phaser globals. Two
 * lobbies given the same `LobbyState` and `InputDeviceSnapshot`
 * produce byte-identical `DetectedDeviceState[]` outputs, which keeps
 * the lobby tile re-paint short-circuit (`prev === next`) effective
 * and matches the rest of the lobby helpers' purity contract.
 */

import type { LobbySlotState, LobbyState } from './lobby';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The detected device kind for a single player slot. Mirrors the
 * authoring-time `InputType` ladder but collapses the two keyboard
 * halves into a single `'keyboard'` value because the *kind* of
 * device is what the UI surfaces; the WASD-vs-ARROWS distinction
 * lives in the existing {@link formatLobbySlotLabel} status line.
 *
 *   • `'keyboard'` — slot is bound to a keyboard half AND the
 *     keyboard is reachable (always true under a desktop browser).
 *   • `'gamepad'`  — slot is bound to a gamepad AND the configured
 *     pad index is connected.
 *   • `'ai'`       — slot is an AI bot. No hardware device.
 *   • `'none'`     — slot is un-joined OR its configured gamepad has
 *                     disconnected. The UI distinguishes the two via
 *                     {@link DetectedDeviceState.connected} —
 *                     un-joined tiles render an empty chip; a joined
 *                     slot whose pad walked off renders the chip in
 *                     the warning colour with a "MISSING" label.
 */
export type DetectedInputDeviceKind = 'keyboard' | 'gamepad' | 'ai' | 'none';

/**
 * Per-frame snapshot of the runtime device topology. The lobby scene
 * fills this in from `navigator.getGamepads()` (via Phaser's gamepad
 * plugin) once per frame; tests build it from plain object literals.
 *
 *   • `connectedGamepadIndices` — every pad index the browser
 *     currently reports as `connected: true`. Order doesn't matter
 *     for detection; the helper does a presence check.
 *   • `keyboardAvailable`       — false only for headless tests that
 *     want to assert "what does the lobby paint when no keyboard is
 *     wired?" Defaults to `true` in `buildSnapshotFromGamepads`.
 */
export interface InputDeviceSnapshot {
  readonly connectedGamepadIndices: ReadonlyArray<number>;
  readonly keyboardAvailable: boolean;
}

/**
 * The detection result for one slot. Flat record so the scene's paint
 * pass can index by slot without further allocation.
 *
 *   • `slotIndex`     — 1..4. Mirrors {@link LobbySlotState.index}.
 *   • `kind`          — coarse device kind ({@link DetectedInputDeviceKind}).
 *   • `connected`     — true iff the slot's configured device is
 *                       reachable. Always true for keyboard / AI
 *                       slots when they're joined; for gamepad slots
 *                       it tracks the configured pad's presence.
 *   • `gamepadIndex`  — the detected pad index for `'gamepad'` slots,
 *                       null otherwise. Lets the UI render the pad's
 *                       index alongside the chip ("GAMEPAD #2") so
 *                       multi-pad lobbies stay legible.
 *   • `label`         — a short, UI-ready string. The {@link formatDetectedDeviceLabel}
 *                       contract:
 *                         - un-joined slot          → ""           (no chip)
 *                         - joined keyboard slot    → "KEYBOARD"
 *                         - joined gamepad, present → "GAMEPAD #N" (or "GAMEPAD" if no idx)
 *                         - joined gamepad, missing → "GAMEPAD MISSING"
 *                         - joined AI slot          → "AI"
 */
export interface DetectedDeviceState {
  readonly slotIndex: 1 | 2 | 3 | 4;
  readonly kind: DetectedInputDeviceKind;
  readonly connected: boolean;
  readonly gamepadIndex: number | null;
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Snapshot construction
// ---------------------------------------------------------------------------

/**
 * Minimal subset of the browser `Gamepad` interface needed to build a
 * snapshot. Mirrors the shape consumed by
 * {@link pollGamepadPressStartJoins}'s `PressStartGamepadSnapshot`
 * with the addition of an optional `connected` flag (browsers
 * sometimes report `connected: false` on a pad that's still in the
 * `gamepads` array immediately after disconnect).
 */
export interface DetectionGamepadSnapshot {
  readonly index: number;
  readonly connected?: boolean;
}

/**
 * Build an {@link InputDeviceSnapshot} from a `navigator.getGamepads()`
 * style array. Sparse / null / undefined entries are tolerated — the
 * browser pads array is documented as length-4 with null gaps for
 * disconnected slots. Pads whose `connected` flag is explicitly
 * `false` are excluded; pads with `connected === undefined` are
 * included (the flag is not always set on older Chrome builds — its
 * mere presence in the live array is the de-facto "connected" signal).
 *
 * `keyboardAvailable` defaults to `true` because every desktop
 * browser delivers `keydown` events; tests pass `false` only when
 * exercising the un-wired-keyboard branch.
 *
 * Pure function — no `Math.random()`, no wall-clock, no Phaser. Two
 * calls with the same input produce byte-identical snapshots.
 */
export function buildSnapshotFromGamepads(
  pads: ReadonlyArray<DetectionGamepadSnapshot | null | undefined>,
  keyboardAvailable: boolean = true,
): InputDeviceSnapshot {
  const connected: number[] = [];
  for (const pad of pads) {
    if (!pad) continue;
    if (!Number.isFinite(pad.index) || pad.index < 0) continue;
    // A pad whose `connected` flag is explicitly false is treated as
    // gone — matches the browser semantics for the brief window
    // between `gamepaddisconnected` firing and the index being
    // reclaimed by the next pad to plug in.
    if (pad.connected === false) continue;
    connected.push(Math.trunc(pad.index));
  }
  // Sort + dedupe so two snapshots with the same connected set
  // compare structurally even if the pads array was iterated in a
  // different order across frames.
  connected.sort((a, b) => a - b);
  const deduped: number[] = [];
  for (const idx of connected) {
    if (deduped[deduped.length - 1] !== idx) deduped.push(idx);
  }
  return Object.freeze({
    connectedGamepadIndices: Object.freeze(deduped),
    keyboardAvailable,
  });
}

// ---------------------------------------------------------------------------
// Per-slot detection
// ---------------------------------------------------------------------------

/**
 * Detect the active device for one slot. Pure function of the slot
 * record + the runtime snapshot.
 *
 * Detection rules:
 *
 *   1. Un-joined slot (`!slot.joined` or `inputType == null`) →
 *      `{ kind: 'none', connected: false, label: '' }`. The UI hides
 *      the chip entirely on un-joined tiles.
 *
 *   2. AI slot → `{ kind: 'ai', connected: true, label: 'AI' }`. AI
 *      slots are always "connected" in the sense the simulation can
 *      always drive them.
 *
 *   3. Keyboard slot (`'keyboard_p1'` / `'keyboard_p2'`) →
 *      `{ kind: 'keyboard', connected: snapshot.keyboardAvailable,
 *         label: snapshot.keyboardAvailable ? 'KEYBOARD' : 'KEYBOARD MISSING' }`.
 *      The half (WASD vs ARROWS) is intentionally omitted from the
 *      chip — the existing status label already paints the half so
 *      the chip stays compact.
 *
 *   4. Gamepad slot — look up `slot.gamepadIndex` in
 *      `snapshot.connectedGamepadIndices`:
 *        - present → `{ kind: 'gamepad', connected: true,
 *                       gamepadIndex: N, label: 'GAMEPAD #N' }`.
 *        - absent  → `{ kind: 'none', connected: false,
 *                       gamepadIndex: N, label: 'GAMEPAD MISSING' }`.
 *      The kind collapses to `'none'` on a missing pad so the UI
 *      paints the chip in its warning colour (the lobby tile reads
 *      `connected` to choose colour, but downstream consumers like
 *      the character-select scene branch on `kind`).
 *
 * Returns a fresh frozen record on every call. The returned label is
 * intentionally pre-computed (rather than left to a separate format
 * helper) because the chip is a single text node and re-formatting on
 * the scene side would just duplicate the switch statement.
 */
export function detectActiveInputDevice(
  slot: LobbySlotState,
  snapshot: InputDeviceSnapshot,
): DetectedDeviceState {
  // Rule 1 — un-joined slot.
  if (!slot.joined || slot.inputType === null) {
    return Object.freeze({
      slotIndex: slot.index,
      kind: 'none',
      connected: false,
      gamepadIndex: null,
      label: '',
    });
  }

  switch (slot.inputType) {
    case 'ai':
      return Object.freeze({
        slotIndex: slot.index,
        kind: 'ai',
        connected: true,
        gamepadIndex: null,
        label: 'AI',
      });

    case 'keyboard_p1':
    case 'keyboard_p2': {
      const connected = snapshot.keyboardAvailable;
      return Object.freeze({
        slotIndex: slot.index,
        kind: connected ? 'keyboard' : 'none',
        connected,
        gamepadIndex: null,
        label: connected ? 'KEYBOARD' : 'KEYBOARD MISSING',
      });
    }

    case 'gamepad': {
      const padIdx = typeof slot.gamepadIndex === 'number' ? slot.gamepadIndex : null;
      const present =
        padIdx !== null && snapshot.connectedGamepadIndices.includes(padIdx);
      if (present) {
        return Object.freeze({
          slotIndex: slot.index,
          kind: 'gamepad',
          connected: true,
          gamepadIndex: padIdx,
          label: `GAMEPAD #${padIdx}`,
        });
      }
      // Configured-but-missing gamepad. Surface the warning state so
      // the player can plug the pad back in (or the lobby's
      // disconnect-pause flow can pick it up).
      return Object.freeze({
        slotIndex: slot.index,
        kind: 'none',
        connected: false,
        gamepadIndex: padIdx,
        label: padIdx !== null ? `GAMEPAD #${padIdx} MISSING` : 'GAMEPAD MISSING',
      });
    }

    default: {
      // Exhaustiveness guard — TypeScript's union narrowing should
      // make this unreachable, but `noUncheckedIndexedAccess` +
      // strict mode want a fallback.
      const _exhaustive: never = slot.inputType;
      void _exhaustive;
      return Object.freeze({
        slotIndex: slot.index,
        kind: 'none',
        connected: false,
        gamepadIndex: null,
        label: '',
      });
    }
  }
}

/**
 * Detect the active device for every slot in a lobby state. Always
 * returns 4 entries in slot-index order so the lobby's tile array can
 * index by `slotIndex - 1` without bounds-checking. Frozen array of
 * frozen records — same contract as the rest of the lobby helpers.
 */
export function detectAllActiveInputDevices(
  state: LobbyState,
  snapshot: InputDeviceSnapshot,
): ReadonlyArray<DetectedDeviceState> {
  return Object.freeze(
    state.slots.map((slot) => detectActiveInputDevice(slot, snapshot)),
  );
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

/**
 * Format a {@link DetectedDeviceState} as a short, UI-ready string.
 * Equivalent to reading `state.label`, but exposed as a function so
 * callers that hold a {@link DetectedInputDeviceKind} alone (without
 * the full state record) can produce the same chip text.
 *
 * The `gamepadIndex` argument is only consulted when `kind` is
 * `'gamepad'`. Pass `null` for keyboard / AI / none slots.
 */
export function formatDetectedDeviceLabel(
  kind: DetectedInputDeviceKind,
  gamepadIndex: number | null = null,
): string {
  switch (kind) {
    case 'keyboard':
      return 'KEYBOARD';
    case 'gamepad':
      return typeof gamepadIndex === 'number'
        ? `GAMEPAD #${gamepadIndex}`
        : 'GAMEPAD';
    case 'ai':
      return 'AI';
    case 'none':
      return '';
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return '';
    }
  }
}

/**
 * Recommended UI tint for a {@link DetectedDeviceState}, expressed as
 * a `#rrggbb` string the Phaser scene can pass straight into
 * `Text.setColor`. Centralised so the lobby and any future UI surface
 * (character-select, pause overlay) paint the chip in the same palette:
 *
 *   • keyboard / connected gamepad / AI → light cyan-grey  (`'#a0d0e8'`)
 *     — the "all good" state: the device that the slot wants is here.
 *   • disconnected gamepad / un-joined → muted amber       (`'#d0a060'`)
 *     — the "warning" state: surfaces a missing-pad mismatch the
 *     player can fix by plugging in the pad.
 *
 * The `'none'` un-joined case never paints (`label === ''` so the
 * text node renders empty), but we still return the warning colour so
 * a caller that decides to paint a placeholder gets a consistent tint.
 */
export function getDetectedDeviceTint(state: DetectedDeviceState): string {
  if (state.connected) return '#a0d0e8';
  return '#d0a060';
}
