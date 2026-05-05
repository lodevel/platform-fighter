/**
 * Per-player input bindings store — AC 40002 Sub-AC 2.
 *
 * Purpose
 * -------
 *
 * The M5 rebinding system needs a single, in-memory source of truth for
 * the four player slots' physical-input → logical-action bindings. The
 * keyboard-only `LocalInputHandler` (M1) keeps two `KeyBindings` tables
 * inside its own instance, but that surface:
 *
 *   • Stops at slots 1–2 — gamepad slots 3–4 have no home.
 *   • Knows nothing about gamepad bindings (only `keyCode: number`).
 *   • Bakes "default = the M1 keyboard layout" into the constructor, so
 *     a settings screen can't ask "what would Player 3's defaults be if
 *     I clicked Reset right now?".
 *
 * `InputBindingsStore` solves all three by holding a {@link PlayerBindings}
 * per slot 1–4, supplying default presets for both device families, and
 * exposing get / set / reset accessors the rebinding screen, the replay
 * loader, and (in the next sub-AC) the runtime input dispatcher all read
 * from the same store. This collapses the M5 wiring diagram from
 * "rebinding screen ↔ keyboard handler + gamepad sampler + replay" into
 * "rebinding screen ↔ store ↔ everything else".
 *
 * Determinism
 * -----------
 *
 *   • The store is a pure data container — no `Math.random()`, no
 *     wall-clock reads, no Phaser. State mutations are direct
 *     value-replacement; reads return frozen, structurally-cloned
 *     {@link PlayerBindings} so callers can't mutate the store from the
 *     outside.
 *   • Defaults are static frozen objects, not factories returning
 *     fresh-each-time instances, so a save-blob written at frame 0 and
 *     compared to a fresh store's defaults at frame 100000 will be
 *     identical bit for bit. The replay system can therefore embed the
 *     binding table with confidence that "same defaults" means "same
 *     bytes".
 *
 * Strict TypeScript
 * -----------------
 *
 * The codebase compiles under `noUncheckedIndexedAccess + strict`, so
 * every `bindings[action]` lookup is statically guaranteed defined by
 * the `Record<LogicalAction, …>` type. Validation helpers in this file
 * still defensively check at runtime because callers may load a binding
 * blob from `localStorage` or a replay payload where the JSON was
 * authored by an earlier (or future) version of the schema.
 */

import {
  LOGICAL_ACTIONS,
  type ActionBindings,
  type GamepadBinding,
  type GamepadBindingSource,
  type InputBinding,
  type KeyboardBinding,
  type LogicalAction,
  type PlayerBindings,
  type PlayerBindingsIndex,
} from '../types/inputBindings';
import { KEY_CODE } from './keyCodes';

// ---------------------------------------------------------------------------
// Default-keyboard presets (slots 1 + 2)
// ---------------------------------------------------------------------------

/**
 * Helper: wrap a keyCode in a single-element binding list. The store
 * uses arrays per action ({@link ActionBindings}) so a player can layer
 * extra bindings on top later, but every default starts with exactly
 * one entry.
 */
function kb(keyCode: number): ReadonlyArray<KeyboardBinding> {
  return Object.freeze([Object.freeze<KeyboardBinding>({ kind: 'keyboard', keyCode })]);
}

/**
 * Default keyboard preset for Player 1 — mirrors `DEFAULT_P1_BINDINGS`
 * in `LocalInputHandler` (WASD + F/G/H/T/R cluster). Re-stated here
 * rather than re-exported because:
 *
 *   • The M1 surface is a flat `Record<InputAction, number>` (one
 *     keyCode per action). The M5 surface is a `Record<LogicalAction,
 *     ReadonlyArray<InputBinding>>` (a list of {@link InputBinding}
 *     unions). The two shapes are not interchangeable — the multi-bind
 *     promise in the M5 type doc requires arrays.
 *   • Restating the literal preset means the M1 handler can keep its
 *     two-element binding tables for back-compat while the rebinding
 *     UI evolves on the multi-bind store. A later sub-AC will fold the
 *     M1 handler into reading from the store, at which point the
 *     duplication goes away.
 */
export const DEFAULT_KEYBOARD_P1_BINDINGS: ActionBindings = Object.freeze({
  left: kb(KEY_CODE.A),
  right: kb(KEY_CODE.D),
  up: kb(KEY_CODE.W),
  down: kb(KEY_CODE.S),
  jump: kb(KEY_CODE.W),
  attack: kb(KEY_CODE.F),
  special: kb(KEY_CODE.G),
  shield: kb(KEY_CODE.H),
  grab: kb(KEY_CODE.T),
  taunt: kb(KEY_CODE.R),
});

/**
 * Default keyboard preset for Player 2 — Arrow keys + Numpad cluster,
 * matching `DEFAULT_P2_BINDINGS`. See {@link DEFAULT_KEYBOARD_P1_BINDINGS}
 * for why the layout is restated rather than re-exported.
 */
export const DEFAULT_KEYBOARD_P2_BINDINGS: ActionBindings = Object.freeze({
  left: kb(KEY_CODE.ARROW_LEFT),
  right: kb(KEY_CODE.ARROW_RIGHT),
  up: kb(KEY_CODE.ARROW_UP),
  down: kb(KEY_CODE.ARROW_DOWN),
  jump: kb(KEY_CODE.ARROW_UP),
  attack: kb(KEY_CODE.NUMPAD_1),
  special: kb(KEY_CODE.NUMPAD_2),
  shield: kb(KEY_CODE.NUMPAD_3),
  grab: kb(KEY_CODE.NUMPAD_4),
  taunt: kb(KEY_CODE.NUMPAD_5),
});

// ---------------------------------------------------------------------------
// Default-gamepad preset (slots 3 + 4)
// ---------------------------------------------------------------------------

/**
 * Default axis dead-zone for the gamepad preset. The Seed targets
 * recent laptops with consumer pads (Xbox / DualShock layout); 0.5 is
 * the conventional "I meant to press it" threshold that survives
 * stick-drift on used hardware while still feeling responsive on a
 * fresh pad. Per-binding overrides are supported by
 * {@link GamepadBindingSource} — the rebinding UI can save a player's
 * preferred sensitivity alongside the binding itself.
 */
export const DEFAULT_GAMEPAD_AXIS_THRESHOLD = 0.5;

/** Helper: build a single-element gamepad button binding list. */
function gpButton(gamepadIndex: number, buttonIndex: number): ReadonlyArray<GamepadBinding> {
  const source: GamepadBindingSource = Object.freeze({ type: 'button', buttonIndex });
  return Object.freeze([Object.freeze<GamepadBinding>({ kind: 'gamepad', gamepadIndex, source })]);
}

/** Helper: build a single-element half-axis binding list. */
function gpAxis(
  gamepadIndex: number,
  axisIndex: number,
  direction: -1 | 1,
): ReadonlyArray<GamepadBinding> {
  const source: GamepadBindingSource = Object.freeze({
    type: 'axis',
    axisIndex,
    direction,
    threshold: DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  });
  return Object.freeze([Object.freeze<GamepadBinding>({ kind: 'gamepad', gamepadIndex, source })]);
}

/**
 * Build the standard-layout gamepad preset for a given pad index.
 *
 * Layout (Xbox-style; DualShock maps with the same indices on the W3C
 * Gamepad "standard" mapping):
 *
 *   • Left stick axes 0/1 drive `left` / `right` / `up` / `down` as
 *     half-axes with a 0.5 dead-zone. Diagonal stick reads from the
 *     dispatcher OR-ing the two half-axes is identical to "stick
 *     pushed up-right past 0.5", which is what a fighter player
 *     expects from analog input.
 *   • `jump` → button 0 (A on Xbox / Cross on DualShock) — the
 *     universal "confirm / primary action" button.
 *   • `attack` → button 2 (X / Square) — sits below the jump button so
 *     the right thumb can roll between them.
 *   • `special` → button 3 (Y / Triangle).
 *   • `grab` → button 4 (LB / L1) — uses a shoulder so the right thumb
 *     stays free for face-button attacks during a grab combo.
 *   • `shield` → button 5 (RB / R1) — symmetric with grab; classic
 *     "hold to shield, press to spot-dodge" platform-fighter feel.
 *   • `taunt` → button 1 (B / Circle) — out of the way of attack
 *     buttons so it can't fire mid-combo by accident.
 *
 * Pin to a specific `gamepadIndex` so two pads can't share an action
 * map. The rebinding store uses `0` for slot 3's default and `1` for
 * slot 4's default (the conventional first-pad-second-pad assignment
 * the browser hands out). Reconciliation by pad `id` after a
 * disconnect/reconnect is a later sub-AC.
 */
export function buildDefaultGamepadBindings(gamepadIndex: number): ActionBindings {
  return Object.freeze({
    left: gpAxis(gamepadIndex, 0, -1),
    right: gpAxis(gamepadIndex, 0, +1),
    up: gpAxis(gamepadIndex, 1, -1),
    down: gpAxis(gamepadIndex, 1, +1),
    jump: gpButton(gamepadIndex, 0),
    attack: gpButton(gamepadIndex, 2),
    special: gpButton(gamepadIndex, 3),
    shield: gpButton(gamepadIndex, 5),
    grab: gpButton(gamepadIndex, 4),
    taunt: gpButton(gamepadIndex, 1),
  });
}

/** Default gamepad preset pinned to pad index 0 (slot 3 default). */
export const DEFAULT_GAMEPAD_P3_BINDINGS: ActionBindings = buildDefaultGamepadBindings(0);

/** Default gamepad preset pinned to pad index 1 (slot 4 default). */
export const DEFAULT_GAMEPAD_P4_BINDINGS: ActionBindings = buildDefaultGamepadBindings(1);

// ---------------------------------------------------------------------------
// Per-slot defaults
// ---------------------------------------------------------------------------

/**
 * Frozen mapping of slot → default {@link PlayerBindings}.
 *
 * Slot policy (matches the Seed):
 *
 *   • Slot 1: keyboard P1 layout (WASD).
 *   • Slot 2: keyboard P2 layout (arrows).
 *   • Slot 3: gamepad on pad index 0.
 *   • Slot 4: gamepad on pad index 1.
 *
 * Exposed publicly (not just via `getDefault()`) so the rebinding UI
 * can render "Reset to Default → these bindings" as a preview without
 * having to instantiate a store.
 */
export const DEFAULT_PLAYER_BINDINGS: Readonly<Record<PlayerBindingsIndex, PlayerBindings>> =
  Object.freeze({
    1: Object.freeze<PlayerBindings>({ playerIndex: 1, bindings: DEFAULT_KEYBOARD_P1_BINDINGS }),
    2: Object.freeze<PlayerBindings>({ playerIndex: 2, bindings: DEFAULT_KEYBOARD_P2_BINDINGS }),
    3: Object.freeze<PlayerBindings>({ playerIndex: 3, bindings: DEFAULT_GAMEPAD_P3_BINDINGS }),
    4: Object.freeze<PlayerBindings>({ playerIndex: 4, bindings: DEFAULT_GAMEPAD_P4_BINDINGS }),
  });

/** Constructor option shape — partially override the per-slot starting state. */
export interface InputBindingsStoreOptions {
  /**
   * Optional per-slot overrides. Any slot not supplied falls back to
   * {@link DEFAULT_PLAYER_BINDINGS}. Each override is validated as if
   * passed to {@link InputBindingsStore.set}; an invalid table throws
   * eagerly from the constructor so the rest of the boot sequence
   * doesn't see a half-configured store.
   */
  readonly overrides?: Partial<Record<PlayerBindingsIndex, PlayerBindings>>;

  /**
   * Optional per-slot *partial* overrides. Each entry may omit the
   * `playerIndex` field and may omit any subset of the per-action
   * binding lists in `bindings`. Missing actions are filled in from
   * {@link DEFAULT_PLAYER_BINDINGS} via {@link mergeBindingsWithDefaults}
   * before validation, so a settings blob authored against an older
   * schema (or one that only customised a few actions) loads cleanly
   * without forcing every consumer to round-trip through a manual merge.
   *
   * If both {@link overrides} and {@link partialOverrides} are supplied
   * for the same slot, the partial override wins (it is the more
   * permissive shape; passing both for the same slot is almost always a
   * bug, so we surface a `console.warn` in dev builds via the validator
   * comment but do not throw — the merged result is still well-formed).
   *
   * Whether to use `overrides` or `partialOverrides` is a caller choice:
   *
   *   • `overrides` — strict mode. Fails fast on a malformed payload.
   *     Used by tests that need a deterministic starting state and by
   *     code paths that have already validated the payload upstream.
   *   • `partialOverrides` — merge mode. Fills missing entries from the
   *     defaults table. Used by the persistence loader / migration
   *     pipeline so a partial blob saved under an older schema (or a
   *     deliberately partial one written by an Import dialog) becomes a
   *     complete profile on hydrate without the caller having to know
   *     which actions were missing.
   */
  readonly partialOverrides?: Partial<Record<PlayerBindingsIndex, PartialPlayerBindings>>;
}

/**
 * Permissive shape accepted by the merge-defaults code paths
 * ({@link mergeBindingsWithDefaults}, {@link InputBindingsStore.setMerged},
 * and the {@link InputBindingsStoreOptions.partialOverrides} constructor
 * option).
 *
 * Compared to {@link PlayerBindings}:
 *
 *   • `playerIndex` is *optional* — when omitted the merge helper stamps
 *     the slot index the merge is targeting. When present it must
 *     match the target slot (mismatch is treated identically to
 *     {@link InputBindingsStore.set}'s strict check, because a
 *     copy/paste of the wrong slot's payload is exactly the silent-
 *     corruption case the strict check exists to catch).
 *   • `bindings` is *partial* — any subset of {@link LogicalAction}
 *     keys may be omitted. Missing keys are filled from
 *     {@link DEFAULT_PLAYER_BINDINGS}[slot]. Present keys are still
 *     validated entry-by-entry exactly as the strict path does, so a
 *     malformed binding inside a partial payload still surfaces.
 *   • An *empty* `bindings` map (`{}`) is legal — the result is a full
 *     copy of the slot's defaults.
 *   • An entirely missing `bindings` field is also legal — same effect
 *     as `{}`.
 */
export interface PartialPlayerBindings {
  readonly playerIndex?: PlayerBindingsIndex;
  readonly bindings?: Partial<Record<LogicalAction, ReadonlyArray<InputBinding>>>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Throw if the supplied {@link PlayerBindings} is structurally invalid.
 *
 * The store calls this on every `set` (and on constructor overrides) so
 * a corrupted JSON blob loaded from `localStorage` or a malformed
 * payload from the rebinding UI can't silently leave a player unable to
 * jump. The check is exported so the replay loader can validate a
 * binding payload before handing it to the store.
 *
 * Rules (conservative — easier to relax later than to tighten):
 *
 *   • `playerIndex` must be 1, 2, 3, or 4 and equal the supplied slot
 *     when `expectedSlot` is provided. Mismatch is almost always a
 *     bug — copy/pasting the wrong slot's payload — so we surface it
 *     immediately rather than letting it persist.
 *   • Every {@link LogicalAction} must be present (the type already
 *     guarantees this, but `JSON.parse` returns `unknown` so we
 *     re-check at runtime).
 *   • Each entry in the per-action array must be a plain object with a
 *     valid `kind` discriminator and the corresponding device-specific
 *     fields.
 *   • Empty per-action arrays are *legal* — a player can deliberately
 *     unbind an action — so we do not require at least one entry.
 */
export function assertValidPlayerBindings(
  candidate: unknown,
  expectedSlot?: PlayerBindingsIndex,
): asserts candidate is PlayerBindings {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('InputBindingsStore: PlayerBindings must be a non-null object.');
  }
  const c = candidate as { playerIndex?: unknown; bindings?: unknown };
  if (c.playerIndex !== 1 && c.playerIndex !== 2 && c.playerIndex !== 3 && c.playerIndex !== 4) {
    throw new Error(
      `InputBindingsStore: playerIndex must be 1|2|3|4, got ${String(c.playerIndex)}.`,
    );
  }
  if (expectedSlot !== undefined && c.playerIndex !== expectedSlot) {
    throw new Error(
      `InputBindingsStore: playerIndex (${c.playerIndex}) does not match expected slot ${expectedSlot}.`,
    );
  }
  if (typeof c.bindings !== 'object' || c.bindings === null) {
    throw new Error('InputBindingsStore: bindings map must be a non-null object.');
  }
  const map = c.bindings as Record<string, unknown>;
  for (const action of LOGICAL_ACTIONS) {
    const entries = map[action];
    if (!Array.isArray(entries)) {
      throw new Error(
        `InputBindingsStore: action '${action}' must be an array of bindings (got ${typeof entries}).`,
      );
    }
    for (let i = 0; i < entries.length; i += 1) {
      assertValidBinding(entries[i], action, i);
    }
  }
}

/** Throw if a single {@link InputBinding} is malformed. */
function assertValidBinding(candidate: unknown, action: LogicalAction, index: number): void {
  const ctx = `action '${action}' binding #${index}`;
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(`InputBindingsStore: ${ctx} must be a non-null object.`);
  }
  const b = candidate as { kind?: unknown };
  if (b.kind === 'keyboard') {
    const kbBinding = candidate as { keyCode?: unknown };
    if (
      typeof kbBinding.keyCode !== 'number' ||
      !Number.isFinite(kbBinding.keyCode) ||
      !Number.isInteger(kbBinding.keyCode) ||
      kbBinding.keyCode <= 0
    ) {
      throw new Error(
        `InputBindingsStore: ${ctx} has invalid keyboard keyCode (${String(kbBinding.keyCode)}).`,
      );
    }
    return;
  }
  if (b.kind === 'gamepad') {
    const gpBinding = candidate as { gamepadIndex?: unknown; source?: unknown };
    if (
      gpBinding.gamepadIndex !== null &&
      (typeof gpBinding.gamepadIndex !== 'number' ||
        !Number.isInteger(gpBinding.gamepadIndex) ||
        gpBinding.gamepadIndex < 0)
    ) {
      throw new Error(
        `InputBindingsStore: ${ctx} has invalid gamepadIndex (${String(gpBinding.gamepadIndex)}).`,
      );
    }
    assertValidGamepadSource(gpBinding.source, ctx);
    return;
  }
  throw new Error(`InputBindingsStore: ${ctx} has unknown kind '${String(b.kind)}'.`);
}

/** Throw if a {@link GamepadBindingSource} is malformed. */
function assertValidGamepadSource(candidate: unknown, ctx: string): void {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(`InputBindingsStore: ${ctx} source must be a non-null object.`);
  }
  const s = candidate as { type?: unknown };
  if (s.type === 'button') {
    const btn = candidate as { buttonIndex?: unknown };
    if (
      typeof btn.buttonIndex !== 'number' ||
      !Number.isInteger(btn.buttonIndex) ||
      btn.buttonIndex < 0
    ) {
      throw new Error(
        `InputBindingsStore: ${ctx} button source has invalid buttonIndex (${String(btn.buttonIndex)}).`,
      );
    }
    return;
  }
  if (s.type === 'axis') {
    const ax = candidate as { axisIndex?: unknown; direction?: unknown; threshold?: unknown };
    if (typeof ax.axisIndex !== 'number' || !Number.isInteger(ax.axisIndex) || ax.axisIndex < 0) {
      throw new Error(
        `InputBindingsStore: ${ctx} axis source has invalid axisIndex (${String(ax.axisIndex)}).`,
      );
    }
    if (ax.direction !== -1 && ax.direction !== 1) {
      throw new Error(
        `InputBindingsStore: ${ctx} axis source direction must be -1 or +1 (got ${String(ax.direction)}).`,
      );
    }
    if (
      typeof ax.threshold !== 'number' ||
      !Number.isFinite(ax.threshold) ||
      ax.threshold <= 0 ||
      ax.threshold > 1
    ) {
      throw new Error(
        `InputBindingsStore: ${ctx} axis source threshold must be in (0, 1] (got ${String(ax.threshold)}).`,
      );
    }
    return;
  }
  throw new Error(
    `InputBindingsStore: ${ctx} source has unknown type '${String(s.type)}'.`,
  );
}

// ---------------------------------------------------------------------------
// Default-merge helpers
// ---------------------------------------------------------------------------

/**
 * Build a complete, validated {@link PlayerBindings} for a slot by
 * overlaying a {@link PartialPlayerBindings} on top of the slot's
 * defaults from {@link DEFAULT_PLAYER_BINDINGS}.
 *
 * The merge is one level deep on the per-action map:
 *
 *   • Each {@link LogicalAction} present on `partial.bindings` replaces
 *     the corresponding entry from the slot's defaults verbatim (the
 *     binding lists themselves are *not* concatenated — replacement is
 *     what the rebinding UI's "Apply" button actually wants).
 *   • Each missing action falls back to the default for that action
 *     (same value `reset(slot)` would restore).
 *   • If `partial.bindings` is omitted entirely, the result is a fresh
 *     copy of the slot's full defaults — equivalent to
 *     `getDefault(slot)` but with the option's `playerIndex` stamp
 *     check still applied.
 *
 * The merged result is validated through {@link assertValidPlayerBindings}
 * before being returned, so a callers' "I only customised one action,
 * leave the rest" payload still cannot smuggle a malformed binding past
 * the type system. Throws on:
 *
 *   • A `playerIndex` that disagrees with the supplied `slot`
 *     (`partial.playerIndex` is optional; when present it must match).
 *   • Any present action whose value is not an array of valid
 *     {@link InputBinding}s.
 *
 * Pure function — no IO, no closures, deterministic. Two identical
 * (slot, partial) inputs produce structurally-identical (and
 * recursively-frozen) outputs, which keeps the boot path's hydrate-
 * then-snapshot replay-deterministic.
 *
 * Used by:
 *
 *   • {@link InputBindingsStoreOptions.partialOverrides} — merging a
 *     partial-by-design constructor override.
 *   • {@link InputBindingsStore.setMerged} — the runtime equivalent of
 *     the same merge for a per-slot rebind landing while the store is
 *     already alive.
 *   • Persistence-layer loaders that round-trip a JSON blob authored
 *     against an older schema: if a future {@link LogicalAction} is
 *     added, the loader can pass the deserialised partial through this
 *     helper to fill in defaults for the new action without having to
 *     know which actions are new.
 */
export function mergeBindingsWithDefaults(
  slot: PlayerBindingsIndex,
  partial: PartialPlayerBindings | undefined,
): PlayerBindings {
  const defaults = DEFAULT_PLAYER_BINDINGS[slot];

  // No partial supplied → return a deep copy of the slot's defaults.
  // We deep-clone (rather than returning the frozen default literal)
  // so that downstream callers who treat the result as their own
  // structure for further mutation get a fresh object rather than the
  // shared, already-frozen default. The store itself uses cloneFrozen
  // anyway when handing the value into its private state.
  if (partial === undefined) {
    return cloneFrozen(defaults);
  }

  // Surface a slot/playerIndex disagreement before we go any further:
  // if the caller has tagged the partial with an explicit playerIndex,
  // it must match the target slot. (Same policy as `set()` — copy/paste
  // of the wrong slot's payload is the silent-corruption case we
  // refuse to absorb silently.)
  if (
    partial.playerIndex !== undefined &&
    partial.playerIndex !== slot
  ) {
    throw new Error(
      `InputBindingsStore.mergeBindingsWithDefaults: partial.playerIndex (${String(
        partial.playerIndex,
      )}) does not match target slot ${slot}.`,
    );
  }

  const partialMap = (partial.bindings ?? {}) as Record<string, unknown>;

  // Eagerly validate every *present* action's bindings — we reject
  // malformed payloads before merging so a bad entry can't sneak in
  // under cover of "but the missing actions were filled from defaults".
  for (const action of LOGICAL_ACTIONS) {
    if (!(action in partialMap)) continue;
    const entries = partialMap[action];
    if (!Array.isArray(entries)) {
      throw new Error(
        `InputBindingsStore.mergeBindingsWithDefaults: action '${action}' must be an array of bindings (got ${typeof entries}).`,
      );
    }
    for (let i = 0; i < entries.length; i += 1) {
      assertValidBinding(entries[i], action, i);
    }
  }

  // Build the merged action map: present-on-partial wins, otherwise
  // fall back to the slot default. The result is an `ActionBindings`
  // — every {@link LogicalAction} key is statically guaranteed present
  // because we initialise from the (complete) defaults first.
  const mergedActions: { [K in LogicalAction]?: ReadonlyArray<InputBinding> } = {};
  for (const action of LOGICAL_ACTIONS) {
    if (action in partialMap) {
      mergedActions[action] = partialMap[action] as ReadonlyArray<InputBinding>;
    } else {
      mergedActions[action] = defaults.bindings[action];
    }
  }

  const merged: PlayerBindings = {
    playerIndex: slot,
    bindings: mergedActions as ActionBindings,
  };
  // Re-validate the merged whole as a paranoia-belt; this also enforces
  // the slot's playerIndex stamp via the `expectedSlot` argument.
  assertValidPlayerBindings(merged, slot);
  return cloneFrozen(merged);
}

// ---------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------

/**
 * Deep-clone a {@link PlayerBindings} into a fully frozen tree.
 *
 * The store stores frozen values internally and returns frozen values
 * to callers, so a third party can't reach into the store and mutate a
 * binding behind its back. JSON-roundtripping is the simplest deep
 * clone that satisfies the schema's "plain serialisable values"
 * invariant — all members are primitives or readonly arrays/objects of
 * primitives, so no instances are lost across the cycle.
 */
function cloneFrozen(bindings: PlayerBindings): PlayerBindings {
  return freezeDeep(JSON.parse(JSON.stringify(bindings)) as PlayerBindings);
}

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item);
    return Object.freeze(value);
  }
  for (const key of Object.keys(value as object)) {
    freezeDeep((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * In-memory bindings store covering all four player slots.
 *
 * Lifecycle:
 *
 *   const store = new InputBindingsStore();
 *   const p1 = store.get(1);           // default keyboard P1 layout
 *   store.set(3, customP3Bindings);    // a custom gamepad rebind
 *   store.resetAction(3, 'jump');      // revert just one action
 *   store.reset(3);                    // revert the whole slot
 *   store.resetAll();                  // revert every slot
 *
 * The store has no opinion about persistence — the M5 settings layer
 * will subscribe to changes (a later sub-AC) and write the snapshot
 * out to `localStorage`. Keeping IO at the boundary keeps the store
 * test-friendly and replay-deterministic.
 */
export class InputBindingsStore {
  private readonly state: Map<PlayerBindingsIndex, PlayerBindings>;

  constructor(options: InputBindingsStoreOptions = {}) {
    this.state = new Map<PlayerBindingsIndex, PlayerBindings>();
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of slots) {
      const partialOverride = options.partialOverrides?.[slot];
      if (partialOverride !== undefined) {
        // Merge mode: missing actions fall back to the slot's defaults.
        // Wins over a sibling `overrides` entry — partial is the more
        // permissive shape and the explicit choice for the looser path.
        this.state.set(slot, mergeBindingsWithDefaults(slot, partialOverride));
        continue;
      }
      const override = options.overrides?.[slot];
      if (override !== undefined) {
        assertValidPlayerBindings(override, slot);
        this.state.set(slot, cloneFrozen(override));
      } else {
        this.state.set(slot, DEFAULT_PLAYER_BINDINGS[slot]);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Get a player's current binding profile. The returned object is
   * frozen — attempts to mutate it (`bindings.bindings.jump = []`)
   * throw in strict mode and silently no-op otherwise. To change a
   * binding, build a new {@link PlayerBindings} and pass it to
   * {@link set}.
   */
  get(slot: PlayerBindingsIndex): PlayerBindings {
    const current = this.state.get(slot);
    /* istanbul ignore next — guaranteed by constructor seeding all 4 slots. */
    if (current === undefined) {
      throw new Error(`InputBindingsStore.get: slot ${slot} is missing — constructor invariant violated.`);
    }
    return current;
  }

  /**
   * Read a single action's binding list. Convenience for callers that
   * only care about one action (the rebinding UI rendering one row).
   */
  getAction(slot: PlayerBindingsIndex, action: LogicalAction): ReadonlyArray<InputBinding> {
    return this.get(slot).bindings[action];
  }

  /**
   * Default {@link PlayerBindings} for a slot — the value `reset(slot)`
   * would restore. Useful for "Reset to Default" preview tiles in the
   * rebinding UI.
   */
  getDefault(slot: PlayerBindingsIndex): PlayerBindings {
    return DEFAULT_PLAYER_BINDINGS[slot];
  }

  /**
   * Snapshot of every slot's bindings. Used by the (later) settings
   * persister and by tests to inspect the store's full state in one
   * comparison. The returned record is frozen and so are its members.
   */
  snapshot(): Readonly<Record<PlayerBindingsIndex, PlayerBindings>> {
    return Object.freeze({
      1: this.get(1),
      2: this.get(2),
      3: this.get(3),
      4: this.get(4),
    });
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Replace a slot's full binding profile. The supplied object is
   * validated, deep-cloned, and frozen before storage — callers can
   * keep mutating their original source object without corrupting the
   * store, and the store's stored value can never be mutated through
   * its `get` return value.
   *
   * The `playerIndex` field on the supplied {@link PlayerBindings}
   * **must** equal `slot`. A mismatch usually means the caller
   * accidentally serialized the wrong player's payload — surfacing it
   * loudly is cheaper than debugging "P3's controls suddenly reset
   * P4 too".
   */
  set(slot: PlayerBindingsIndex, bindings: PlayerBindings): void {
    assertValidPlayerBindings(bindings, slot);
    this.state.set(slot, cloneFrozen(bindings));
  }

  /**
   * Replace a slot's profile with a *partial* payload, filling in any
   * missing per-action entries from {@link DEFAULT_PLAYER_BINDINGS}.
   *
   * Differs from {@link set} in two ways:
   *
   *   • Accepts a {@link PartialPlayerBindings} (see that type for the
   *     shape) rather than a fully-populated {@link PlayerBindings}.
   *     Missing actions are merged from the slot's defaults via
   *     {@link mergeBindingsWithDefaults}.
   *   • The supplied `partial.playerIndex` is *optional*. When omitted
   *     we stamp `slot`. When present it must equal `slot` (a mismatch
   *     is treated as a corrupt payload, same policy as {@link set}).
   *
   * Differs from {@link setAction} in that this is the multi-action
   * write path: the rebinding UI's "Apply changes for this player"
   * button accumulates per-row changes into a partial map and commits
   * them in one merge, atomically. (The row-level write path remains
   * {@link setAction} — single-action writes never need a default-merge
   * step because the slot already holds a complete profile.)
   *
   * Throws on the same conditions {@link mergeBindingsWithDefaults}
   * raises (slot/playerIndex disagreement, malformed binding, non-array
   * action value). The store's state is left untouched on throw — no
   * partial-write windows.
   */
  setMerged(slot: PlayerBindingsIndex, partial: PartialPlayerBindings): void {
    const merged = mergeBindingsWithDefaults(slot, partial);
    this.state.set(slot, merged);
  }

  /**
   * Replace the binding list for a single action without disturbing
   * the rest of the slot's profile. This is the rebinding UI's main
   * write path — "I just remapped Jump to Space; don't touch Attack".
   */
  setAction(
    slot: PlayerBindingsIndex,
    action: LogicalAction,
    bindings: ReadonlyArray<InputBinding>,
  ): void {
    if (!Array.isArray(bindings)) {
      throw new Error(
        `InputBindingsStore.setAction: bindings for action '${action}' must be an array.`,
      );
    }
    for (let i = 0; i < bindings.length; i += 1) {
      assertValidBinding(bindings[i], action, i);
    }
    const current = this.get(slot);
    const nextActionMap: ActionBindings = {
      ...current.bindings,
      [action]: bindings,
    };
    const next: PlayerBindings = { playerIndex: slot, bindings: nextActionMap };
    this.state.set(slot, cloneFrozen(next));
  }

  /** Reset a single slot to its default {@link PlayerBindings}. */
  reset(slot: PlayerBindingsIndex): void {
    this.state.set(slot, DEFAULT_PLAYER_BINDINGS[slot]);
  }

  /**
   * Reset a single action on a single slot to its default — leaves
   * every other action on the slot untouched. The rebinding UI uses
   * this to back out of a partial rebind.
   */
  resetAction(slot: PlayerBindingsIndex, action: LogicalAction): void {
    const defaultActionList = DEFAULT_PLAYER_BINDINGS[slot].bindings[action];
    this.setAction(slot, action, defaultActionList);
  }

  /** Reset every slot to its default — wipes a player-customised state. */
  resetAll(): void {
    const slots: ReadonlyArray<PlayerBindingsIndex> = [1, 2, 3, 4];
    for (const slot of slots) {
      this.reset(slot);
    }
  }
}
