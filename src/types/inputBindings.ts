/**
 * Unified input binding schema — AC 40001 Sub-AC 1.
 *
 * Purpose
 * -------
 *
 * The M5 input-rebinding system needs a single, device-agnostic vocabulary
 * the rebinding UI, the persistent settings store, the replay layer, and
 * the runtime input dispatch can all share. The keyboard-only types in
 * `src/input/LocalInputHandler.ts` (`InputAction`, `KeyBindings`) were
 * sufficient for M1 where players are limited to two keyboards, but
 * cannot describe gamepad inputs or multi-bind tables. This module
 * supersedes them with a discriminated-union {@link InputBinding} that
 * covers both device families and a per-player binding container
 * ({@link PlayerBindings}) that the rebinding screen can mutate
 * piecewise without losing slots for the other players.
 *
 * Design constraints (from the project Seed)
 * ------------------------------------------
 *
 *   • Two keyboard players (P1 + P2 share one keyboard); P3 / P4 are
 *     filled by the Gamepad API or AI. The binding schema must therefore
 *     express both *device kinds* and *which physical device instance*
 *     a binding refers to (e.g. P3's pad vs. P4's pad).
 *   • Determinism: a binding table must serialise to plain JSON so the
 *     replay system can persist exactly the inputs that were active
 *     when a match was recorded — no class instances, no closures, no
 *     wall-clock-derived ids. All members are primitive or
 *     `readonly` containers of primitives.
 *   • Strict TypeScript (`noUncheckedIndexedAccess` + `strict`): every
 *     {@link LogicalAction} key on a {@link PlayerBindings.bindings}
 *     map is guaranteed present (the type uses `Record<LogicalAction,
 *     ...>` rather than `Partial<Record<...>>`) so callers don't have
 *     to defensive-check undefined for known actions. Validation
 *     helpers live alongside the runtime store in later sub-ACs.
 *
 * Compatibility with the existing `InputAction`
 * ---------------------------------------------
 *
 * {@link LogicalAction} is a *superset alias* of the keyboard-only
 * `InputAction` declared inside `LocalInputHandler.ts`. The string
 * literals are identical (`'left' | 'right' | ... | 'taunt'`) so the
 * keyboard handler can keep working unchanged while new code references
 * the canonical name. Once the migration completes, `InputAction` will
 * be re-exported as a deprecated alias from `src/input/index.ts`.
 *
 * No runtime behaviour ships with this file — it is types + frozen
 * action list only. The dispatcher, gamepad sampler and rebinding
 * store are separate sub-ACs.
 */

// ---------------------------------------------------------------------------
// Logical actions
// ---------------------------------------------------------------------------

/**
 * Frozen, ordered list of every logical gameplay action the rebinding
 * system understands. The order is the canonical render order for the
 * rebinding UI (movement first, attacks next, system last) so screens
 * can iterate this constant without imposing their own sort.
 *
 * Why a `const` array instead of a TypeScript `enum`:
 *
 *   • The Seed forbids non-deterministic state in the gameplay path.
 *     A literal-typed `as const` array gives us both the runtime
 *     iteration the rebinding UI / validators need *and* the union
 *     type {@link LogicalAction} derived from `(typeof LOGICAL_ACTIONS)
 *     [number]`. No reverse-lookup map, no auto-incrementing numeric
 *     ids that would couple the wire format to declaration order.
 *   • Replay payloads serialise the *string* identifier, not a number,
 *     so reordering or extending this array can never invalidate an
 *     older replay as long as the action names are preserved.
 *
 * Coverage matches the ~10-move kit defined in the Seed
 * (`character.moveset`): movement (left / right / up / down / jump),
 * offensive (attack, special, grab), defensive (shield), and social
 * (taunt). Up and jump remain distinct entries so a player can
 * separate "press up to jump" from "tap up" without the rebinding UI
 * having to encode both meanings in one slot.
 */
export const LOGICAL_ACTIONS = [
  'left',
  'right',
  'up',
  'down',
  'jump',
  'attack',
  'special',
  'shield',
  'grab',
  'taunt',
] as const;

/**
 * Discriminator for every gameplay action the rebinding store can map
 * to a physical input. String-literal union — never a numeric enum —
 * so JSON replays and saved settings are stable across milestones.
 */
export type LogicalAction = (typeof LOGICAL_ACTIONS)[number];

/**
 * Device family backing a binding. The replay system uses this as the
 * `kind` discriminator on {@link InputBinding}; the rebinding UI uses
 * it to render different "press a key…" vs. "press a button…" prompts.
 */
export type InputDeviceKind = 'keyboard' | 'gamepad';

// ---------------------------------------------------------------------------
// Keyboard binding
// ---------------------------------------------------------------------------

/**
 * A single keyboard key bound to a logical action.
 *
 * `keyCode` mirrors the integer surfaced by `KeyboardEvent.keyCode` and
 * the {@link KEY_CODE} table in `src/input/keyCodes.ts`. The legacy
 * keyCode is preferred over `KeyboardEvent.code` / `.key` because:
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
   * Legacy `KeyboardEvent.keyCode` integer. Must be a positive integer;
   * validators in later sub-ACs reject `0`, `NaN`, and non-finite values
   * so a corrupted settings blob can't silently leave a player unable to
   * jump.
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
 * "Left Stick → Right" as two distinct slots, exactly like Smash Bros.
 */
export type GamepadBindingSource =
  | {
      readonly type: 'button';
      /** Index into `Gamepad.buttons[]`. Standard layout: 0=A, 1=B, 2=X, 3=Y, etc. */
      readonly buttonIndex: number;
    }
  | {
      readonly type: 'axis';
      /** Index into `Gamepad.axes[]`. Standard layout: 0/1 = left stick X/Y, 2/3 = right stick. */
      readonly axisIndex: number;
      /**
       * Direction of the half-axis this binding fires on. `-1` matches
       * negative axis values (stick pushed left or up), `+1` matches
       * positive (right or down). Held when `axis * direction >= threshold`.
       */
      readonly direction: -1 | 1;
      /**
       * Magnitude (0–1) at which the axis counts as "pressed". The Seed
       * targets a recent laptop with consumer pads, where dead-zone tuning
       * matters for both responsiveness and replay determinism. A
       * per-binding threshold lets the rebinding screen save the player's
       * preferred sensitivity alongside the binding itself.
       */
      readonly threshold: number;
    };

/**
 * A single gamepad input bound to a logical action.
 *
 * `gamepadIndex` follows the browser Gamepad API: it is the value of
 * `Gamepad.index` when the binding was created, identifying *which*
 * connected pad owns the binding. `null` means "any pad" — used for
 * menu confirmation / pause inputs that should work regardless of which
 * physical pad the player picked up. Gameplay bindings always pin to a
 * specific index so P3 and P4 cannot accidentally share a stick.
 */
export interface GamepadBinding {
  readonly kind: 'gamepad';

  /**
   * `Gamepad.index` of the pad this binding belongs to, or `null` for
   * device-agnostic bindings. Indices are not guaranteed stable across
   * disconnect/reconnect cycles — the rebinding store reconciles this
   * via the pad's `id` string in a later sub-AC.
   */
  readonly gamepadIndex: number | null;

  /** Button or half-axis source on the pad. */
  readonly source: GamepadBindingSource;
}

// ---------------------------------------------------------------------------
// Union + per-player container
// ---------------------------------------------------------------------------

/**
 * Discriminated union of every binding the rebinding store understands.
 * Switch on `kind` — TypeScript narrows to the matching device-specific
 * shape (`KeyboardBinding` or `GamepadBinding`).
 *
 * Future device families (e.g. dedicated arcade sticks exposing custom
 * HID descriptors) extend the union by adding a new `kind` literal and
 * a new struct, so existing call sites that exhaustively switch will
 * fail to compile until they handle the new case — the standard
 * exhaustiveness pattern under `strict` mode.
 */
export type InputBinding = KeyboardBinding | GamepadBinding;

/**
 * Player-slot index (1–4) matching the `PlayerSlot.index` ontology field.
 * Enumerated rather than `number` so the rebinding store cannot
 * accidentally key bindings under player 0 or 5.
 */
export type PlayerBindingsIndex = 1 | 2 | 3 | 4;

/**
 * Per-action map of physical inputs. Each {@link LogicalAction} carries
 * an *array* of {@link InputBinding}s — at runtime the dispatcher OR-s
 * them together so the player can hold either to fire the action. This
 * supports two cases the Seed calls out:
 *
 *   • Default keyboard tables that bind both `up` and `jump` to W —
 *     each action gets one entry today, but the slot is plural so the
 *     M5 rebinding UI can let a player add a second binding (e.g. a
 *     gamepad shoulder button to Jump) without dropping the keyboard
 *     one.
 *   • Players who alternate between keyboard and pad mid-session: with
 *     a multi-bind slot, both work without re-running the rebind flow.
 *
 * Empty arrays are *legal* — a deliberately-cleared slot disables that
 * action for the player. The dispatcher treats the action as released
 * for every frame the array is empty.
 */
export type ActionBindings = Readonly<Record<LogicalAction, ReadonlyArray<InputBinding>>>;

/**
 * Complete binding profile for a single player slot.
 *
 * Carries the player index alongside the action map so the rebinding
 * store can pass `PlayerBindings` values around as self-contained units
 * (saving / restoring / migrating one slot at a time) without needing
 * an enclosing record keyed by index. The runtime input dispatcher
 * reads `bindings[action]` once per fixed step to build the per-frame
 * input record.
 */
export interface PlayerBindings {
  readonly playerIndex: PlayerBindingsIndex;
  readonly bindings: ActionBindings;
}
