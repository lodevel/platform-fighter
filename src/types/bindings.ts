/**
 * Dedicated input-binding data model — AC 40001 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * The M5 input-rebinding milestone needs a single, device-agnostic
 * vocabulary that the rebinding UI, the persistent settings store,
 * the replay layer, and the runtime input dispatch can all share.
 * The keyboard-only types in `src/input/LocalInputHandler.ts`
 * (`InputAction`, `KeyBindings`) were sufficient for M1, where players
 * are limited to two keyboards, but cannot describe gamepad inputs or
 * multi-bind tables.
 *
 * This module is the *canonical, dedicated* home for the binding model
 * called out in AC 40001 Sub-AC 1:
 *
 *   • {@link KeyboardBinding}  — one keyboard key bound to one action.
 *   • {@link GamepadBinding}   — one gamepad button or half-axis bound
 *                                to one action.
 *   • {@link ActionMap}        — per-action lookup of physical inputs.
 *   • {@link PlayerBinding}    — one player slot's complete binding
 *                                profile (slot index + action map).
 *
 * It also publishes default bindings for all four player slots
 * ({@link DEFAULT_PLAYER_BINDINGS}) covering the action set required
 * by the Seed and the AC: **move (left/right/up/down) / jump / attack
 * / special / shield / grab / dodge**. Defaults match the established
 * keyboard-1 / keyboard-2 / gamepad-3 / gamepad-4 slot policy used by
 * the rest of the M5 wiring.
 *
 * Design constraints (from the project Seed)
 * ------------------------------------------
 *
 *   • Two keyboard players (P1 + P2 share one keyboard); P3 / P4 are
 *     filled by the Gamepad API or AI. The binding schema must
 *     therefore express both *device kinds* and *which physical device
 *     instance* a binding refers to (e.g. P3's pad vs. P4's pad).
 *   • Determinism: a binding table must serialise to plain JSON so the
 *     replay system can persist exactly the inputs that were active
 *     when a match was recorded — no class instances, no closures, no
 *     wall-clock-derived ids. All members are primitive or `readonly`
 *     containers of primitives.
 *   • Strict TypeScript (`noUncheckedIndexedAccess` + `strict`): every
 *     {@link BindingAction} key on an {@link ActionMap} is statically
 *     guaranteed present (the type uses `Record<BindingAction, …>`
 *     rather than `Partial<Record<…>>`) so callers don't have to
 *     defensive-check undefined for known actions.
 *
 * Relationship to `src/types/inputBindings.ts`
 * --------------------------------------------
 *
 * The legacy `inputBindings.ts` module ships with an overlapping but
 * differently-named set of types (`PlayerBindings`, `ActionBindings`,
 * `LogicalAction`) and a slightly different action set
 * (`'taunt'` instead of `'dodge'`). It is wired into M1's
 * `InputBindingsStore`, `DeviceInputDispatcher`, and the gamepad
 * monitor, so we keep it operational for back-compat.
 *
 * This `bindings.ts` module is the **canonical** binding vocabulary
 * going forward (the names called out by AC 40001 Sub-AC 1). It is
 * fully self-contained: no runtime imports from `inputBindings.ts`,
 * no shared mutable state. Future sub-ACs migrate the dispatcher and
 * the rebinding screen onto these names; until then the two coexist
 * cleanly because the on-the-wire JSON shapes are equivalent.
 *
 * No runtime gameplay behaviour ships here — this module is types +
 * frozen action list + frozen default tables only.
 */

// ---------------------------------------------------------------------------
// Action vocabulary
// ---------------------------------------------------------------------------

/**
 * Frozen, ordered list of every binding action the rebinding system
 * understands.
 *
 * The order is the canonical render order for the rebinding UI
 * (movement → jump → offensive → defensive) so screens can iterate
 * this constant without imposing their own sort.
 *
 * Why a `const` array instead of a TypeScript `enum`:
 *
 *   • The Seed forbids non-deterministic state in the gameplay path.
 *     A literal-typed `as const` array gives us both the runtime
 *     iteration the rebinding UI / validators need *and* the union
 *     type {@link BindingAction} derived from
 *     `(typeof BINDING_ACTIONS)[number]`. No reverse-lookup map, no
 *     auto-incrementing numeric ids that would couple the wire format
 *     to declaration order.
 *   • Replay payloads serialise the *string* identifier, not a number,
 *     so reordering or extending this array can never invalidate an
 *     older replay as long as the action names are preserved.
 *
 * Coverage matches the AC 40001 Sub-AC 1 requirement
 * "**move / jump / attack / special / shield / grab / dodge**". The
 * `move` category is decomposed into four directional actions
 * (`moveLeft`, `moveRight`, `moveUp`, `moveDown`) because:
 *
 *   • Keyboard inputs *must* bind one key per direction — there is no
 *     "move" key on a keyboard.
 *   • Gamepad analog-stick inputs are exposed as half-axes, one per
 *     direction, by the W3C standard mapping. Splitting `move` along
 *     the same axis means the keyboard and gamepad presets share a
 *     row in the rebinding UI.
 *
 * The `jump` action stays distinct from `moveUp` so a player can
 * separate "press up to jump" from "tap up" without the rebinding UI
 * having to encode both meanings in one slot — a long-standing
 * platform-fighter convention.
 */
export const BINDING_ACTIONS = Object.freeze([
  'moveLeft',
  'moveRight',
  'moveUp',
  'moveDown',
  'jump',
  'attack',
  'special',
  'shield',
  'grab',
  'dodge',
] as const);

/**
 * Discriminator for every action the rebinding store can map to a
 * physical input. String-literal union — never a numeric enum — so
 * JSON replays and saved settings are stable across milestones.
 */
export type BindingAction = (typeof BINDING_ACTIONS)[number];

/**
 * Device family backing a binding. The replay system uses this as the
 * `kind` discriminator on {@link InputBinding}; the rebinding UI uses
 * it to render different "press a key…" vs. "press a button…"
 * prompts.
 */
export type BindingDeviceKind = 'keyboard' | 'gamepad';

// ---------------------------------------------------------------------------
// Keyboard binding
// ---------------------------------------------------------------------------

/**
 * A single keyboard key bound to a {@link BindingAction}.
 *
 * `keyCode` mirrors the integer surfaced by `KeyboardEvent.keyCode`
 * (the legacy property). The legacy keyCode is preferred over
 * `KeyboardEvent.code` / `.key` because:
 *
 *   • It is layout-independent for the keys the default bindings care
 *     about (WASD, arrows, numpad), which is what the Seed targets;
 *   • It serialises as a small integer for replays / settings, with a
 *     well-known canonical value (W = 87) that is stable forever;
 *   • Phaser's keyboard plugin (used by the runtime sampler) speaks
 *     the same keyCode dialect, so no translation table is needed at
 *     the engine boundary.
 */
export interface KeyboardBinding {
  readonly kind: 'keyboard';

  /**
   * Legacy `KeyboardEvent.keyCode` integer. Must be a positive
   * integer; downstream validators reject `0`, `NaN`, and non-finite
   * values so a corrupted settings blob can't silently leave a player
   * unable to jump.
   */
  readonly keyCode: number;
}

// ---------------------------------------------------------------------------
// Gamepad binding
// ---------------------------------------------------------------------------

/**
 * Where on a gamepad the binding pulls its signal from. A binding is
 * either a single button press or a half-axis (one direction of a
 * stick / trigger).
 *
 * Half-axes are represented separately for `-1` (left/up) and `+1`
 * (right/down) so the rebinding UI can show "Left Stick → Left" and
 * "Left Stick → Right" as two distinct slots, exactly like the
 * conventional platform-fighter rebinder.
 */
export type GamepadBindingSource =
  | {
      readonly type: 'button';
      /** Index into `Gamepad.buttons[]`. Standard layout: 0=A, 1=B, 2=X, 3=Y, … */
      readonly buttonIndex: number;
    }
  | {
      readonly type: 'axis';
      /** Index into `Gamepad.axes[]`. Standard layout: 0/1 = left stick X/Y, 2/3 = right stick. */
      readonly axisIndex: number;
      /**
       * Direction of the half-axis this binding fires on. `-1` matches
       * negative axis values (stick pushed left or up), `+1` matches
       * positive (right or down). Held when
       * `axis * direction >= threshold`.
       */
      readonly direction: -1 | 1;
      /**
       * Magnitude (0–1) at which the axis counts as "pressed". The
       * Seed targets a recent laptop with consumer pads, where
       * dead-zone tuning matters for both responsiveness and replay
       * determinism. A per-binding threshold lets the rebinding screen
       * save the player's preferred sensitivity alongside the binding
       * itself.
       */
      readonly threshold: number;
    };

/**
 * A single gamepad input bound to a {@link BindingAction}.
 *
 * `gamepadIndex` follows the browser Gamepad API: it is the value of
 * `Gamepad.index` when the binding was created, identifying *which*
 * connected pad owns the binding. `null` means "any pad" — used for
 * menu confirmation / pause inputs that should work regardless of
 * which physical pad the player picked up. Gameplay bindings always
 * pin to a specific index so P3 and P4 cannot accidentally share a
 * stick.
 */
export interface GamepadBinding {
  readonly kind: 'gamepad';

  /**
   * `Gamepad.index` of the pad this binding belongs to, or `null` for
   * device-agnostic bindings. Indices are not guaranteed stable across
   * disconnect/reconnect cycles — reconciliation by `Gamepad.id` is
   * the rebinding store's job, not this type's.
   */
  readonly gamepadIndex: number | null;

  /** Button or half-axis source on the pad. */
  readonly source: GamepadBindingSource;
}

// ---------------------------------------------------------------------------
// Union + per-player container
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every binding the rebinding store
 * understands. Switch on `kind` — TypeScript narrows to the matching
 * device-specific shape ({@link KeyboardBinding} or
 * {@link GamepadBinding}).
 *
 * Future device families (e.g. dedicated arcade sticks exposing
 * custom HID descriptors) extend the union by adding a new `kind`
 * literal and a new struct, so existing call sites that exhaustively
 * switch will fail to compile until they handle the new case — the
 * standard exhaustiveness pattern under `strict` mode.
 */
export type InputBinding = KeyboardBinding | GamepadBinding;

/**
 * Player-slot index (1–4) matching the `PlayerSlot.index` ontology
 * field. Enumerated rather than `number` so the rebinding store
 * cannot accidentally key bindings under player 0 or 5.
 */
export type PlayerBindingIndex = 1 | 2 | 3 | 4;

/**
 * Per-action map of physical inputs. Each {@link BindingAction}
 * carries an *array* of {@link InputBinding}s — at runtime the
 * dispatcher OR-s them together so the player can hold either to fire
 * the action.
 *
 * Multi-bind slots support two cases the Seed calls out:
 *
 *   • Default keyboard tables that bind `moveUp` and `jump` to the
 *     same key (W) — each action gets one entry today, but the slot
 *     is plural so the M5 rebinding UI can let a player add a second
 *     binding (e.g. a gamepad shoulder button to Jump) without
 *     dropping the keyboard one.
 *   • Players who alternate between keyboard and pad mid-session:
 *     with a multi-bind slot, both work without re-running the rebind
 *     flow.
 *
 * Empty arrays are *legal* — a deliberately-cleared slot disables
 * that action for the player. The dispatcher treats the action as
 * released for every frame the array is empty.
 *
 * `Record<BindingAction, …>` (not `Partial<Record<…>>`) statically
 * guarantees every action has a slot, which is what `strict +
 * noUncheckedIndexedAccess` callers rely on.
 */
export type ActionMap = Readonly<Record<BindingAction, ReadonlyArray<InputBinding>>>;

/**
 * Complete binding profile for a single player slot.
 *
 * Carries the player index alongside the action map so the rebinding
 * store can pass {@link PlayerBinding} values around as self-contained
 * units (saving / restoring / migrating one slot at a time) without
 * needing an enclosing record keyed by index. The runtime input
 * dispatcher reads `bindings[action]` once per fixed step to build
 * the per-frame input record.
 */
export interface PlayerBinding {
  readonly playerIndex: PlayerBindingIndex;
  readonly bindings: ActionMap;
}

// ---------------------------------------------------------------------------
// Default keyboard / gamepad presets
// ---------------------------------------------------------------------------

/**
 * Legacy `KeyboardEvent.keyCode` integers used by the default
 * keyboard presets. Kept inline (rather than re-imported from
 * `src/input/keyCodes.ts`) so this types module has zero downward
 * dependencies — anything that wants the binding vocabulary can pull
 * it without dragging the input subsystem along.
 *
 * The values are the standardised legacy keyCodes (W=87, A=65, …);
 * they are stable forever and match Phaser's keyboard plugin codes
 * one-for-one.
 */
const KC = {
  // Letters
  A: 65,
  D: 68,
  F: 70,
  G: 71,
  H: 72,
  R: 82,
  S: 83,
  T: 84,
  W: 87,
  // Arrows
  ARROW_LEFT: 37,
  ARROW_UP: 38,
  ARROW_RIGHT: 39,
  ARROW_DOWN: 40,
  // Numpad cluster (default P2 attack/system buttons)
  NUMPAD_0: 96,
  NUMPAD_1: 97,
  NUMPAD_2: 98,
  NUMPAD_3: 99,
  NUMPAD_4: 100,
  NUMPAD_5: 101,
  // Modifiers
  SHIFT: 16,
} as const;

/**
 * Default axis dead-zone for the gamepad presets. The Seed targets
 * recent laptops with consumer pads (Xbox / DualShock layout); 0.5 is
 * the conventional "I meant to press it" threshold that survives
 * stick-drift on used hardware while still feeling responsive on a
 * fresh pad. Per-binding overrides live on
 * {@link GamepadBindingSource}.
 */
export const DEFAULT_GAMEPAD_AXIS_THRESHOLD = 0.5;

/** Helper: wrap a keyCode in a frozen single-element keyboard binding list. */
function kb(keyCode: number): ReadonlyArray<KeyboardBinding> {
  return Object.freeze([Object.freeze<KeyboardBinding>({ kind: 'keyboard', keyCode })]);
}

/** Helper: build a frozen single-element gamepad button binding list. */
function gpButton(gamepadIndex: number, buttonIndex: number): ReadonlyArray<GamepadBinding> {
  const source: GamepadBindingSource = Object.freeze({ type: 'button', buttonIndex });
  return Object.freeze([
    Object.freeze<GamepadBinding>({ kind: 'gamepad', gamepadIndex, source }),
  ]);
}

/** Helper: build a frozen single-element half-axis gamepad binding list. */
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
  return Object.freeze([
    Object.freeze<GamepadBinding>({ kind: 'gamepad', gamepadIndex, source }),
  ]);
}

/**
 * Default keyboard preset for Player 1 — WASD movement + F/G/H/T/R
 * cluster for offensive / defensive actions. Mirrors the M1 keyboard
 * handler's P1 layout so the experience the Seed signed off on
 * remains the out-of-the-box default after the M5 rebinding store
 * comes online.
 *
 * Layout rationale:
 *
 *   • W/A/S/D drives directional movement. `moveUp` and `jump` both
 *     bind to W so a player who hits W expects their character to
 *     jump (the canonical platformer convention).
 *   • F = attack, G = special — adjacent home-row keys, easy to roll
 *     between under the right index/middle finger.
 *   • H = shield, T = grab — second-row neighbours of the attack
 *     cluster, mirroring the Smash Bros "shield + grab combo" layout.
 *   • R = dodge — sits one row above the attack cluster so a panic
 *     dodge doesn't accidentally fire an attack.
 */
export const DEFAULT_KEYBOARD_P1_BINDINGS: ActionMap = Object.freeze({
  moveLeft: kb(KC.A),
  moveRight: kb(KC.D),
  moveUp: kb(KC.W),
  moveDown: kb(KC.S),
  jump: kb(KC.W),
  attack: kb(KC.F),
  special: kb(KC.G),
  shield: kb(KC.H),
  grab: kb(KC.T),
  dodge: kb(KC.R),
});

/**
 * Default keyboard preset for Player 2 — Arrow keys + Numpad cluster.
 *
 * Layout rationale:
 *
 *   • Arrows drive directional movement; Up doubles as `jump`,
 *     symmetric with P1's W → `moveUp` + `jump`.
 *   • Numpad 1–5 host the action cluster, sitting under the right
 *     hand when P2 is at the right side of a shared keyboard. The
 *     order (attack, special, shield, grab, dodge) follows the same
 *     priority as P1's F/G/H/T/R.
 */
export const DEFAULT_KEYBOARD_P2_BINDINGS: ActionMap = Object.freeze({
  moveLeft: kb(KC.ARROW_LEFT),
  moveRight: kb(KC.ARROW_RIGHT),
  moveUp: kb(KC.ARROW_UP),
  moveDown: kb(KC.ARROW_DOWN),
  jump: kb(KC.ARROW_UP),
  attack: kb(KC.NUMPAD_1),
  special: kb(KC.NUMPAD_2),
  shield: kb(KC.NUMPAD_3),
  grab: kb(KC.NUMPAD_4),
  dodge: kb(KC.NUMPAD_5),
});

/**
 * Build the standard-layout gamepad preset for a given pad index.
 *
 * Layout (Xbox-style; DualShock maps with the same indices on the
 * W3C Gamepad "standard" mapping):
 *
 *   • Left stick (axes 0/1) drives `moveLeft` / `moveRight` /
 *     `moveUp` / `moveDown` as half-axes with a 0.5 dead-zone.
 *     Diagonal stick reads from the dispatcher OR-ing the two
 *     half-axes are identical to "stick pushed up-right past 0.5",
 *     which is what a fighter player expects from analog input.
 *   • `jump` → button 0 (A on Xbox / Cross on DualShock) — the
 *     universal "confirm / primary action" button.
 *   • `attack` → button 2 (X / Square) — sits below the jump button
 *     so the right thumb can roll between them.
 *   • `special` → button 3 (Y / Triangle).
 *   • `grab` → button 4 (LB / L1) — uses a shoulder so the right
 *     thumb stays free for face-button attacks during a grab combo.
 *   • `shield` → button 5 (RB / R1) — symmetric with grab; classic
 *     "hold to shield, press to spot-dodge" platform-fighter feel.
 *   • `dodge` → button 6 (LT / L2) — second left shoulder/trigger
 *     keeps dodge separate from grab so a tense scramble doesn't
 *     accidentally drop the player out of shield.
 *
 * Pinning to a specific `gamepadIndex` means two pads cannot share
 * an action map. The rebinding store uses `0` for slot 3's default
 * and `1` for slot 4's default (the conventional first-pad,
 * second-pad assignment the browser hands out).
 */
export function buildDefaultGamepadBindings(gamepadIndex: number): ActionMap {
  return Object.freeze({
    moveLeft: gpAxis(gamepadIndex, 0, -1),
    moveRight: gpAxis(gamepadIndex, 0, +1),
    moveUp: gpAxis(gamepadIndex, 1, -1),
    moveDown: gpAxis(gamepadIndex, 1, +1),
    jump: gpButton(gamepadIndex, 0),
    attack: gpButton(gamepadIndex, 2),
    special: gpButton(gamepadIndex, 3),
    shield: gpButton(gamepadIndex, 5),
    grab: gpButton(gamepadIndex, 4),
    dodge: gpButton(gamepadIndex, 6),
  });
}

/** Default gamepad preset pinned to pad index 0 (slot 3 default). */
export const DEFAULT_GAMEPAD_P3_BINDINGS: ActionMap = buildDefaultGamepadBindings(0);

/** Default gamepad preset pinned to pad index 1 (slot 4 default). */
export const DEFAULT_GAMEPAD_P4_BINDINGS: ActionMap = buildDefaultGamepadBindings(1);

// ---------------------------------------------------------------------------
// Per-slot defaults
// ---------------------------------------------------------------------------

/**
 * Four-slot binding configuration — the canonical container that holds
 * one {@link PlayerBinding} per player slot (1–4).
 *
 * AC 40001 Sub-AC 1 calls this shape out by name ("BindingsConfig for
 * 4 slots") because it is the unit the rebinding UI saves to
 * `localStorage`, the replay payload embeds, and the runtime
 * dispatcher reads from on every fixed step. Naming it explicitly
 * (rather than letting every call site spell `Record<PlayerBindingIndex,
 * PlayerBinding>` inline) gives those subsystems one stable handle to
 * import and, more importantly, makes intent explicit at the function
 * boundary: a parameter typed `BindingsConfig` is unambiguously "the
 * full four-slot picture", whereas a parameter typed `PlayerBinding`
 * is one slot's profile.
 *
 * The structural type is identical to `Readonly<Record<PlayerBindingIndex,
 * PlayerBinding>>`, so existing call sites that already use the
 * inlined `Record` form (e.g. {@link DEFAULT_PLAYER_BINDINGS} prior to
 * this alias being introduced, the M5 serializer's snapshot map) are
 * fully assignable without churn — `BindingsConfig` is purely additive.
 *
 * Slot policy (matches the Seed's "max 2 keyboard players, gamepads
 * unlimited" rule and the M5 wiring):
 *
 *   • Slot 1: keyboard P1 layout (WASD + F/G/H/T/R).
 *   • Slot 2: keyboard P2 layout (Arrows + Numpad).
 *   • Slot 3: gamepad on pad index 0.
 *   • Slot 4: gamepad on pad index 1.
 *
 * The slot-policy guarantee is structural — every {@link PlayerBindingIndex}
 * key is statically required by the `Record<…>` shape, so a `strict +
 * noUncheckedIndexedAccess` consumer can index any slot without a
 * defensive `undefined` check. A loader that constructs a
 * `BindingsConfig` from JSON MUST validate the four required slots
 * before claiming the result is well-typed; the serializer in
 * `src/input/InputBindingsSerializer.ts` performs exactly this check.
 *
 * Determinism: `BindingsConfig` carries only primitives and `readonly`
 * containers of primitives, so two equal configs hash identically and
 * `JSON.stringify` produces byte-stable output suitable for replay
 * embedding.
 */
export type BindingsConfig = Readonly<Record<PlayerBindingIndex, PlayerBinding>>;

/**
 * Frozen mapping of slot → default {@link PlayerBinding}.
 *
 * Slot policy (matches the Seed's "max 2 keyboard players, gamepads
 * unlimited" rule and the M5 wiring):
 *
 *   • Slot 1: keyboard P1 layout (WASD + F/G/H/T/R).
 *   • Slot 2: keyboard P2 layout (Arrows + Numpad).
 *   • Slot 3: gamepad on pad index 0.
 *   • Slot 4: gamepad on pad index 1.
 *
 * Exposed publicly (not just via a getter on a store) so the
 * rebinding UI can render "Reset to Default → these bindings" as a
 * preview without having to instantiate any runtime state.
 *
 * The whole tree is recursively frozen, so identity-equality holds
 * across the entire codebase: a save-blob written at frame 0 and
 * compared to a fresh program's defaults at frame 100 000 will be
 * byte-for-byte identical, which the replay system relies on.
 */
export const DEFAULT_PLAYER_BINDINGS: BindingsConfig =
  Object.freeze({
    1: Object.freeze<PlayerBinding>({
      playerIndex: 1,
      bindings: DEFAULT_KEYBOARD_P1_BINDINGS,
    }),
    2: Object.freeze<PlayerBinding>({
      playerIndex: 2,
      bindings: DEFAULT_KEYBOARD_P2_BINDINGS,
    }),
    3: Object.freeze<PlayerBinding>({
      playerIndex: 3,
      bindings: DEFAULT_GAMEPAD_P3_BINDINGS,
    }),
    4: Object.freeze<PlayerBinding>({
      playerIndex: 4,
      bindings: DEFAULT_GAMEPAD_P4_BINDINGS,
    }),
  });

/**
 * Convenience accessor for a single slot's default
 * {@link PlayerBinding}. Mirrors the rebinding UI's "Reset to
 * Default" button — call this for the slot the player just hit
 * Reset on and pass the result to the rebinding store.
 */
export function getDefaultPlayerBinding(slot: PlayerBindingIndex): PlayerBinding {
  return DEFAULT_PLAYER_BINDINGS[slot];
}

// ---------------------------------------------------------------------------
// Schema versioning + PlayerProfile (AC 40001 Sub-AC 1 literal contract)
// ---------------------------------------------------------------------------

/**
 * Wire-format / persistence schema version for the binding data model
 * declared in this module.
 *
 * The schema version travels with every {@link PlayerProfile} so the
 * persistence layer (`localStorage`), the rebinding UI's import /
 * export buttons, and the replay payload that embeds the active
 * binding table can all answer the question "is this blob shape
 * something my build understands?" without reverse-engineering field
 * presence.
 *
 * Versioning policy (mirrors {@link CUSTOM_STAGE_SCHEMA_VERSION} in
 * `src/builder/customStageSerializer.ts`):
 *
 *   • Patch additions that older loaders can ignore (e.g. a new
 *     optional metadata field on the profile envelope) keep this
 *     constant pinned.
 *   • Additions to {@link InputBinding} (a new device kind, a new
 *     required field) bump the constant, because an older loader's
 *     validator would reject the new shape.
 *   • Removing or renaming a {@link BindingAction} bumps the constant
 *     and requires a migration entry — replays from before the rename
 *     are otherwise unrecoverable.
 *
 * Pinned to `1` for v1 of the platform fighter; the input-layer
 * migration registry in `src/input/BindingsMigrations.ts` keys its
 * migrations off this value via a sibling constant.
 *
 * NOTE: A second {@link BINDINGS_SCHEMA_VERSION} of equal value is
 * also exported from `src/input/InputBindingsSerializer.ts` for
 * historical reasons (the serializer landed before this types module
 * existed). Both are pinned to the same literal `1 as const` so they
 * are interchangeable at the type level. New code should prefer the
 * one in `src/types/bindings.ts` because the schema *is* the types
 * module, and the serializer's copy will be redirected to import this
 * one in a follow-up cleanup.
 */
export const BINDINGS_SCHEMA_VERSION = 1 as const;

/**
 * Type of the {@link BINDINGS_SCHEMA_VERSION} literal — used by the
 * persistence layer to spell `readonly schemaVersion: BindingsSchemaVersion`
 * on envelope shapes.
 */
export type BindingsSchemaVersion = typeof BINDINGS_SCHEMA_VERSION;

/**
 * Per-player binding *profile* — the literal shape called out by
 * AC 40001 Sub-AC 1: "PlayerProfile with deviceType, action→key/button
 * map, schema version".
 *
 * Distinct from {@link PlayerBinding} (the in-memory runtime record
 * the dispatcher reads each fixed step) in three ways:
 *
 *   1. **Carries `schemaVersion`**, so a profile loaded from disk can
 *      be range-checked before the dispatcher consumes it.
 *   2. **Carries `deviceType`**, the device-kind hint the rebinding UI
 *      uses to render the right "press a key…" vs. "press a button…"
 *      prompt when the profile is reset to defaults. The dispatcher
 *      itself never needs `deviceType` because it switches on each
 *      individual binding's `kind` — but the *profile* level hint is
 *      essential for the UI and for slot-policy enforcement (P1/P2
 *      keyboard, P3/P4 gamepad).
 *   3. **Authoring-time / persistence container**, not a runtime
 *      object. Profiles are what the rebinding UI saves to
 *      `localStorage`; the runtime store unwraps them to the lighter
 *      {@link PlayerBinding} record.
 *
 * Deterministic / strict-mode friendly: all members are primitive or
 * `readonly` containers of primitives, no class instances, no
 * closures.
 */
export interface PlayerProfile {
  /** Schema version this profile was authored against. */
  readonly schemaVersion: BindingsSchemaVersion;
  /** Slot index (1–4) the profile is bound to. */
  readonly playerIndex: PlayerBindingIndex;
  /**
   * Primary device family for this slot. The rebinding UI uses this
   * to render the correct rebind prompt UI; the slot-policy
   * enforcement (max 2 keyboards) uses it to refuse a third keyboard
   * profile. Profiles that mix keyboard *and* gamepad bindings (e.g.
   * a player who uses arrows on the keyboard but a shoulder button
   * for grab on a pad) MUST set `deviceType` to whichever family
   * owns the *movement* bindings — that's the family the slot-policy
   * counts.
   */
  readonly deviceType: BindingDeviceKind;
  /**
   * Action → physical-input map. Same shape as {@link ActionMap}; see
   * {@link PlayerBinding.bindings} for slot-by-slot semantics.
   */
  readonly bindings: ActionMap;
}

/** Helper: infer the canonical `deviceType` for a slot's defaults. */
function inferDefaultDeviceType(slot: PlayerBindingIndex): BindingDeviceKind {
  // Matches the Seed slot policy: P1/P2 keyboard, P3/P4 gamepad.
  return slot <= 2 ? 'keyboard' : 'gamepad';
}

/**
 * Build a {@link PlayerProfile} for a slot from its default
 * {@link PlayerBinding}, stamping the current
 * {@link BINDINGS_SCHEMA_VERSION} and the slot's canonical
 * {@link BindingDeviceKind}.
 *
 * Pure function — calling twice returns equivalent (frozen) records,
 * which keeps the replay determinism contract intact.
 */
function makeDefaultProfile(slot: PlayerBindingIndex): PlayerProfile {
  return Object.freeze<PlayerProfile>({
    schemaVersion: BINDINGS_SCHEMA_VERSION,
    playerIndex: slot,
    deviceType: inferDefaultDeviceType(slot),
    bindings: DEFAULT_PLAYER_BINDINGS[slot].bindings,
  });
}

/**
 * Frozen mapping of slot → default {@link PlayerProfile}.
 *
 * Same slot policy as {@link DEFAULT_PLAYER_BINDINGS} (P1/P2 keyboard,
 * P3/P4 gamepad), but each entry is wrapped in the wire-format
 * {@link PlayerProfile} envelope so the rebinding UI / persistence
 * layer / replay loader can treat "default" and "loaded from disk"
 * identically.
 */
export const DEFAULT_PLAYER_PROFILES: Readonly<Record<PlayerBindingIndex, PlayerProfile>> =
  Object.freeze({
    1: makeDefaultProfile(1),
    2: makeDefaultProfile(2),
    3: makeDefaultProfile(3),
    4: makeDefaultProfile(4),
  });

/**
 * Convenience accessor for a single slot's default
 * {@link PlayerProfile}. Mirrors {@link getDefaultPlayerBinding} but
 * returns the schema-version-stamped envelope.
 */
export function getDefaultPlayerProfile(slot: PlayerBindingIndex): PlayerProfile {
  return DEFAULT_PLAYER_PROFILES[slot];
}

/**
 * Lift a raw {@link PlayerBinding} (runtime shape) into a
 * {@link PlayerProfile} (persistence shape) by stamping the current
 * {@link BINDINGS_SCHEMA_VERSION} and an explicit
 * {@link BindingDeviceKind}.
 *
 * The rebinding UI calls this when the user clicks "Save" so the
 * blob it hands the persistence layer carries the schema version of
 * *this* build, not an inherited one from a stale on-disk profile.
 *
 * `deviceType` is taken as a parameter (not auto-inferred) because a
 * player can legitimately mix devices on one slot; the caller knows
 * the policy intent and we don't want this types module to embed a
 * decision rule. Pass the same value the slot was assigned at lobby
 * time.
 */
export function toPlayerProfile(
  binding: PlayerBinding,
  deviceType: BindingDeviceKind,
): PlayerProfile {
  return Object.freeze<PlayerProfile>({
    schemaVersion: BINDINGS_SCHEMA_VERSION,
    playerIndex: binding.playerIndex,
    deviceType,
    bindings: binding.bindings,
  });
}

/**
 * Drop the schema-version / device-type metadata from a
 * {@link PlayerProfile}, exposing the lighter {@link PlayerBinding}
 * the runtime dispatcher consumes.
 *
 * The persistence layer calls this after it has validated the
 * profile's `schemaVersion` is one this build understands — at that
 * point the runtime no longer needs the version stamp.
 */
export function fromPlayerProfile(profile: PlayerProfile): PlayerBinding {
  return Object.freeze<PlayerBinding>({
    playerIndex: profile.playerIndex,
    bindings: profile.bindings,
  });
}
