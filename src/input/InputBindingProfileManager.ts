/**
 * Input binding profile manager — AC 50003 Sub-AC 3.
 *
 * Purpose
 * -------
 *
 * The M5 rebinding milestone needs a single, named service that owns the
 * four-slot {@link PlayerProfile} table for the *whole* application. The
 * earlier sub-ACs landed each layer of that picture as a standalone
 * piece:
 *
 *   • AC 50001 Sub-AC 1 — the canonical
 *     {@link BindingAction}/{@link PlayerBinding}/{@link PlayerProfile}
 *     vocabulary in `src/types/bindings.ts`.
 *   • AC 50002 Sub-AC 2 — the named default keyboard / gamepad presets
 *     ({@link keyboardDefaultsBySlot}, {@link gamepadDefaults},
 *     {@link buildGamepadDefaultsForPad}) in `defaultBindingProfiles.ts`.
 *
 * What was *missing* from those two pieces was the manager surface the
 * rebinding screen, the lobby, the runtime input dispatcher, and the
 * persistence loader all want to talk to in the same vocabulary:
 *
 *   • "Give me Player N's profile."
 *   • "Replace Player N's profile with this one (e.g. after a Capture
 *     was committed in the rebinding UI)."
 *   • "Resolve action A for Player N to a list of physical inputs the
 *     dispatcher can sample."
 *   • "Initialise Player N to its appropriate device-type defaults
 *     (keyboard for P1/P2 by Seed slot policy, gamepad for P3/P4)."
 *
 * `InputBindingProfileManager` is that named service. It composes the
 * canonical defaults from `defaultBindingProfiles.ts`, owns the live
 * per-slot {@link PlayerProfile} state (immutable values handed out
 * through deep-frozen copies), and exposes the get / set / resolve /
 * initialise verbs the AC asks for word-for-word.
 *
 * Why a separate class from {@link InputBindingManager} (the event
 * service in `InputBindingManager.ts`)
 * --------------------------------------------------------------------
 *
 * The two classes have *complementary but disjoint* responsibilities and
 * keeping them apart preserves the M5 layering diagram:
 *
 *   `InputBindingProfileManager`  — owns the per-slot binding *data*.
 *                                   Rebinding UI writes here. Persistence
 *                                   loader hydrates here. The dispatcher
 *                                   reads here. Knows nothing about
 *                                   per-frame events.
 *
 *   `InputBindingManager`         — emits per-player press / release /
 *                                   hold *events* per fixed step using a
 *                                   {@link DeviceInputDispatcher}. Knows
 *                                   nothing about how bindings are
 *                                   stored. Subscribers (menus, pause
 *                                   toggle, replay tagger) listen here.
 *
 * If a future cleanup wants to fold the two together, `InputBindingManager`
 * would gain an injected `InputBindingProfileManager` it reads from,
 * instead of the legacy `InputBindingsStore`. Until then, this module
 * gives the rebinding UI / lobby / dispatcher a stable named handle in
 * the canonical M5 vocabulary.
 *
 * Determinism
 * -----------
 *
 *   • Pure data container — no `Math.random()`, no wall-clock reads, no
 *     Phaser, no closures captured into stored values.
 *   • Defaults pulled from frozen module-level constants
 *     ({@link DEFAULT_PLAYER_PROFILES}, {@link keyboardDefaultsBySlot},
 *     {@link buildGamepadDefaultsForPad}) so two managers built with the
 *     same options hold structurally-identical state, satisfying the
 *     replay-determinism contract.
 *   • Mutators replace the stored value atomically — there is no
 *     "half-set" window between actions on a multi-action write.
 *   • Reads return deeply-frozen copies (or the underlying frozen
 *     constants) so a caller cannot mutate the manager's internal state
 *     by writing into a returned object.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. Every accessor is
 * keyed by {@link PlayerBindingIndex} (1|2|3|4) and {@link BindingAction}
 * so a mistyped slot or action surfaces at compile time, not runtime.
 */

import {
  BINDING_ACTIONS,
  BINDINGS_SCHEMA_VERSION,
  buildDefaultGamepadBindings,
  DEFAULT_PLAYER_PROFILES,
  type ActionMap,
  type BindingAction,
  type BindingDeviceKind,
  type GamepadBinding,
  type InputBinding,
  type KeyboardBinding,
  type PlayerBinding,
  type PlayerBindingIndex,
  type PlayerProfile,
} from '../types/bindings';
import { keyboardDefaultsBySlot } from './defaultBindingProfiles';
import {
  checkProposedBindingForConflicts,
  detectAllIntraPlayerConflicts,
  detectIntraPlayerConflicts,
  type IntraPlayerBindingConflict,
  type IntraPlayerConflictCheckResult,
  type IntraPlayerConflictReport,
} from './BindingConflictDetector';

// ---------------------------------------------------------------------------
// Slot enumeration
// ---------------------------------------------------------------------------

/** The four canonical player slots, in ascending order. */
export const ALL_BINDING_PROFILE_SLOTS: ReadonlyArray<PlayerBindingIndex> = Object.freeze([
  1, 2, 3, 4,
]);

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/**
 * Optional overrides for the manager's constructor.
 *
 * The defaults — applied to any slot the caller does not supply — match
 * the Seed slot policy:
 *
 *   • Slot 1, 2 → keyboard layout (P1 = WASD + F/G/H/T/R cluster, P2 =
 *     Arrows + Numpad cluster).
 *   • Slot 3, 4 → gamepad layout pinned to pad index 0 / 1 respectively.
 *
 * The two override fields are stacked in priority order so the most
 * common boot paths can pick the right shape:
 *
 *   1. `profiles` — explicit, fully-formed {@link PlayerProfile}s. Wins
 *      over `deviceTypes` for any slot supplied. Used by the persistence
 *      loader (which already deserialised a {@link PlayerProfile} from
 *      `localStorage`) and by tests that want a bit-exact starting
 *      state.
 *   2. `deviceTypes` — a per-slot {@link BindingDeviceKind} hint. The
 *      manager initialises the slot to the *default* layout for that
 *      device type. Used by the lobby when a player picks "Keyboard" for
 *      slot 3 mid-session and we want the matching default keyboard
 *      preset stamped without the lobby having to assemble a profile
 *      itself. When omitted, the canonical Seed slot policy applies
 *      (slots 1-2 = keyboard, slots 3-4 = gamepad).
 *
 * Callers may pass both options; for any slot present in *both* maps,
 * `profiles` wins (it is the more specific shape). Slots absent from both
 * maps fall back to {@link DEFAULT_PLAYER_PROFILES}.
 */
export interface InputBindingProfileManagerOptions {
  /**
   * Explicit per-slot {@link PlayerProfile} overrides. Each supplied
   * profile is validated and deep-frozen before storage; the manager
   * never holds a reference to the caller's input object so external
   * mutation cannot leak into the manager's state.
   */
  readonly profiles?: Partial<Record<PlayerBindingIndex, PlayerProfile>>;

  /**
   * Per-slot {@link BindingDeviceKind} hints. The manager seeds the slot
   * with the default profile for that device type — the canonical
   * keyboard layout from {@link keyboardDefaultsBySlot}, or the gamepad
   * layout pinned to the conventional pad index for the slot
   * ({@link buildDefaultGamepadBindings}(0) for any slot using gamepad
   * default; see {@link conventionalPadIndexForSlot}).
   */
  readonly deviceTypes?: Partial<Record<PlayerBindingIndex, BindingDeviceKind>>;
}

// ---------------------------------------------------------------------------
// Slot policy helpers
// ---------------------------------------------------------------------------

/**
 * Canonical device family for a slot under the Seed slot policy:
 *
 *   • Slots 1 and 2 → keyboard (the two-keyboard-players convention).
 *   • Slots 3 and 4 → gamepad (the unlimited-gamepads convention).
 *
 * Used as the implicit default whenever a slot is initialised without an
 * explicit `deviceTypes` hint and without an explicit `profiles` entry.
 *
 * Pure function — no IO, no closures.
 */
export function canonicalDeviceTypeForSlot(slot: PlayerBindingIndex): BindingDeviceKind {
  return slot <= 2 ? 'keyboard' : 'gamepad';
}

/**
 * Conventional `Gamepad.index` for a slot when initialised with a
 * gamepad default:
 *
 *   • Slot 3 → pad 0
 *   • Slot 4 → pad 1
 *   • Slots 1 and 2 → pad 0 (a fallback used only when a caller
 *     deliberately reassigns a keyboard slot to gamepad — almost always
 *     a re-pin happens immediately afterwards)
 *
 * Pure function — used internally by {@link makeDefaultProfileForDevice}
 * and exposed because the lobby's "Use this pad for slot 3" flow also
 * needs the canonical default index.
 */
export function conventionalPadIndexForSlot(slot: PlayerBindingIndex): number {
  return slot === 4 ? 1 : slot === 3 ? 0 : 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

/**
 * Deep-clone a {@link PlayerProfile} into a fully frozen tree. The
 * manager stores frozen values internally and returns frozen values to
 * callers, so mutating the returned profile cannot reach back into the
 * manager. JSON-roundtripping is the simplest deep clone that satisfies
 * the schema's "plain serialisable values" invariant.
 */
function clonePlayerProfile(profile: PlayerProfile): PlayerProfile {
  return freezeDeep(JSON.parse(JSON.stringify(profile)) as PlayerProfile);
}

/**
 * Validate the basic shape of a {@link PlayerProfile} before storing it
 * in the manager. Conservative checks only — the persistence layer's
 * own validator catches deeper issues (per-binding fields, schema
 * migrations); this guards against an obvious mismatch like
 * `playerIndex` not matching the destination slot.
 */
function assertProfileShape(
  profile: PlayerProfile,
  expectedSlot: PlayerBindingIndex,
): void {
  if (typeof profile !== 'object' || profile === null) {
    throw new Error(
      `InputBindingProfileManager: profile for slot ${expectedSlot} must be a non-null object.`,
    );
  }
  if (profile.playerIndex !== expectedSlot) {
    throw new Error(
      `InputBindingProfileManager: profile.playerIndex (${String(
        profile.playerIndex,
      )}) does not match destination slot ${expectedSlot}.`,
    );
  }
  if (profile.deviceType !== 'keyboard' && profile.deviceType !== 'gamepad') {
    throw new Error(
      `InputBindingProfileManager: profile.deviceType for slot ${expectedSlot} must be 'keyboard' or 'gamepad' (got ${String(
        profile.deviceType,
      )}).`,
    );
  }
  if (typeof profile.bindings !== 'object' || profile.bindings === null) {
    throw new Error(
      `InputBindingProfileManager: profile.bindings for slot ${expectedSlot} must be a non-null object.`,
    );
  }
  for (const action of BINDING_ACTIONS) {
    const entries = (profile.bindings as Record<string, unknown>)[action];
    if (!Array.isArray(entries)) {
      throw new Error(
        `InputBindingProfileManager: profile.bindings.${action} for slot ${expectedSlot} must be an array (got ${typeof entries}).`,
      );
    }
  }
}

/**
 * Build the canonical default {@link PlayerProfile} for a slot
 * initialised with the supplied {@link BindingDeviceKind}.
 *
 *   • `keyboard` → {@link keyboardDefaultsBySlot}[slot] is wrapped in a
 *     schema-stamped envelope with `deviceType: 'keyboard'`.
 *   • `gamepad`  → {@link buildDefaultGamepadBindings}(pad) is built for
 *     {@link conventionalPadIndexForSlot}(slot), then wrapped likewise
 *     with `deviceType: 'gamepad'`.
 *
 * Result is recursively frozen.
 */
function makeDefaultProfileForDevice(
  slot: PlayerBindingIndex,
  deviceType: BindingDeviceKind,
): PlayerProfile {
  // Fast path: when the requested device type already matches the
  // canonical Seed slot policy for this slot, return the pre-built frozen
  // entry from `DEFAULT_PLAYER_PROFILES` so identity-equality holds for
  // the common case (a manager booted with no overrides shares its
  // default profiles with every other default-booted manager).
  const canonical = canonicalDeviceTypeForSlot(slot);
  if (deviceType === canonical) {
    return DEFAULT_PLAYER_PROFILES[slot];
  }

  const bindings: ActionMap =
    deviceType === 'keyboard'
      ? keyboardDefaultsBySlot[slot]
      : buildDefaultGamepadBindings(conventionalPadIndexForSlot(slot));

  return Object.freeze<PlayerProfile>({
    schemaVersion: BINDINGS_SCHEMA_VERSION,
    playerIndex: slot,
    deviceType,
    bindings,
  });
}

/**
 * Helper: build a fully-frozen {@link PlayerProfile} from a runtime
 * {@link PlayerBinding}. Stamps the schema version and the supplied
 * device type. Used by {@link InputBindingProfileManager.setBinding}.
 */
function liftBindingToProfile(
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
 * Helper: drop the schema-version / device-type metadata from a
 * {@link PlayerProfile}, exposing the lighter {@link PlayerBinding} the
 * runtime dispatcher consumes. Used by
 * {@link InputBindingProfileManager.getBinding}.
 */
function lowerProfileToBinding(profile: PlayerProfile): PlayerBinding {
  return Object.freeze<PlayerBinding>({
    playerIndex: profile.playerIndex,
    bindings: profile.bindings,
  });
}

// ---------------------------------------------------------------------------
// InputBindingProfileManager
// ---------------------------------------------------------------------------

/**
 * Owner of the four-slot {@link PlayerProfile} table.
 *
 * Lifecycle:
 *
 *   const manager = new InputBindingProfileManager();
 *   const p1 = manager.getProfile(1);              // default keyboard P1 layout
 *   const inputs = manager.resolveAction(1, 'jump'); // [W keyboard binding]
 *   manager.setActionBindings(1, 'jump', [
 *     { kind: 'keyboard', keyCode: 32 },           // remap jump to SPACE
 *   ]);
 *   manager.initializeSlotWithDefaults(3, 'keyboard'); // hot-swap slot 3 to keyboard
 *   manager.resetSlot(2);                          // back to P2 defaults
 *
 * The class has no opinion about persistence — wire it up to
 * `BindingsStorage` / `BindingsPersistenceLifecycle` at the boundary.
 * Keeping IO at the boundary keeps this class test-friendly and replay-
 * deterministic (no Date.now / localStorage reads on the hot path).
 */
export class InputBindingProfileManager {
  /**
   * Per-slot {@link PlayerProfile} state. Values are recursively frozen,
   * so swapping a slot's value out atomically is enough to satisfy the
   * "no torn writes" contract — there is no in-place mutation path.
   */
  private readonly state: Map<PlayerBindingIndex, PlayerProfile>;

  constructor(options: InputBindingProfileManagerOptions = {}) {
    this.state = new Map<PlayerBindingIndex, PlayerProfile>();
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      const explicitProfile = options.profiles?.[slot];
      if (explicitProfile !== undefined) {
        // Strict mode: caller-supplied profile must be coherent. Validate
        // before storing so a corrupted blob loaded from `localStorage`
        // can't silently leave a player unable to jump.
        assertProfileShape(explicitProfile, slot);
        this.state.set(slot, clonePlayerProfile(explicitProfile));
        continue;
      }
      const deviceType = options.deviceTypes?.[slot] ?? canonicalDeviceTypeForSlot(slot);
      this.state.set(slot, makeDefaultProfileForDevice(slot, deviceType));
    }
  }

  // -------------------------------------------------------------------------
  // Get — bindings per player slot
  // -------------------------------------------------------------------------

  /**
   * Get a slot's complete {@link PlayerProfile} (the persistence shape:
   * carries `schemaVersion`, `deviceType`, and the action map).
   *
   * Returned object is recursively frozen — attempts to mutate it (e.g.
   * `profile.bindings.jump = []`) throw in strict mode. To change a
   * binding, call {@link setProfile} / {@link setBinding} /
   * {@link setActionBindings}.
   */
  getProfile(slot: PlayerBindingIndex): PlayerProfile {
    const current = this.state.get(slot);
    /* istanbul ignore next — guaranteed by constructor seeding all 4 slots. */
    if (current === undefined) {
      throw new Error(
        `InputBindingProfileManager.getProfile: slot ${slot} is missing — constructor invariant violated.`,
      );
    }
    return current;
  }

  /**
   * Get a slot's runtime {@link PlayerBinding} — the lighter shape the
   * dispatcher consumes (no `schemaVersion`, no `deviceType`).
   */
  getBinding(slot: PlayerBindingIndex): PlayerBinding {
    return lowerProfileToBinding(this.getProfile(slot));
  }

  /**
   * Get the {@link BindingDeviceKind} the slot was initialised with (or
   * most-recently re-initialised to via
   * {@link initializeSlotWithDefaults}).
   *
   * The lobby reads this to decide whether to display a keyboard or
   * gamepad rebinding screen for a given slot.
   */
  getDeviceType(slot: PlayerBindingIndex): BindingDeviceKind {
    return this.getProfile(slot).deviceType;
  }

  /**
   * Snapshot the whole four-slot state as a single readonly record.
   * Useful for serialisation / persistence and for unit tests that want
   * to assert on the entire manager state in one comparison.
   */
  snapshot(): Readonly<Record<PlayerBindingIndex, PlayerProfile>> {
    return Object.freeze({
      1: this.getProfile(1),
      2: this.getProfile(2),
      3: this.getProfile(3),
      4: this.getProfile(4),
    });
  }

  // -------------------------------------------------------------------------
  // Resolve — action-to-input lookup
  // -------------------------------------------------------------------------

  /**
   * Resolve a single action on a single slot to the list of physical
   * inputs currently bound to it. The dispatcher OR-s these together at
   * sample time — holding ANY of the returned bindings counts as the
   * action being held.
   *
   * Empty array means the action is deliberately unbound for the slot
   * (a player may have cleared `taunt`, for example). Callers should
   * treat the action as never held in that case.
   *
   * The returned list is the same frozen reference the manager stores
   * internally — safe to keep across frames as long as no mutator is
   * called for the same (slot, action) in between. Mutators replace the
   * stored value rather than mutating it in place, so an existing
   * reference snapshots the bindings at the moment it was returned.
   */
  resolveAction(
    slot: PlayerBindingIndex,
    action: BindingAction,
  ): ReadonlyArray<InputBinding> {
    return this.getProfile(slot).bindings[action];
  }

  /**
   * Resolve to the list of {@link KeyboardBinding}s only — handy for
   * the rebinding UI's "what key fires this action right now?" preview
   * when the slot is configured for keyboard input.
   *
   * Filters {@link resolveAction}; multi-bind slots that mix keyboard +
   * gamepad bindings return only the keyboard half.
   */
  resolveKeyboardBindings(
    slot: PlayerBindingIndex,
    action: BindingAction,
  ): ReadonlyArray<KeyboardBinding> {
    const all = this.resolveAction(slot, action);
    return Object.freeze(all.filter((b): b is KeyboardBinding => b.kind === 'keyboard'));
  }

  /**
   * Resolve to the list of {@link GamepadBinding}s only — symmetric with
   * {@link resolveKeyboardBindings} for the gamepad rebinding UI's
   * preview.
   */
  resolveGamepadBindings(
    slot: PlayerBindingIndex,
    action: BindingAction,
  ): ReadonlyArray<GamepadBinding> {
    const all = this.resolveAction(slot, action);
    return Object.freeze(all.filter((b): b is GamepadBinding => b.kind === 'gamepad'));
  }

  // -------------------------------------------------------------------------
  // Set — replace a slot's profile / binding / single action
  // -------------------------------------------------------------------------

  /**
   * Replace a slot's full {@link PlayerProfile}. The supplied object is
   * validated, deep-cloned, and frozen before storage — callers can
   * keep mutating their original source object without corrupting the
   * manager, and the manager's stored value can never be mutated through
   * its `getProfile` return value.
   *
   * The `playerIndex` field on the supplied profile MUST equal `slot`.
   * Mismatches almost always mean the caller accidentally serialised
   * the wrong player's payload — surfacing it loudly is cheaper than
   * debugging "P3's bindings reset P4 too".
   */
  setProfile(slot: PlayerBindingIndex, profile: PlayerProfile): void {
    assertProfileShape(profile, slot);
    this.state.set(slot, clonePlayerProfile(profile));
  }

  /**
   * Replace a slot's runtime {@link PlayerBinding}, preserving the
   * slot's existing {@link BindingDeviceKind}. Convenience for callers
   * who hold a {@link PlayerBinding} (the runtime shape) rather than a
   * full {@link PlayerProfile} — for example the replay loader, which
   * deliberately strips `deviceType` from its embedded payload.
   */
  setBinding(slot: PlayerBindingIndex, binding: PlayerBinding): void {
    if (binding.playerIndex !== slot) {
      throw new Error(
        `InputBindingProfileManager.setBinding: binding.playerIndex (${String(
          binding.playerIndex,
        )}) does not match destination slot ${slot}.`,
      );
    }
    const deviceType = this.getDeviceType(slot);
    this.setProfile(slot, liftBindingToProfile(binding, deviceType));
  }

  /**
   * Replace the binding list for a single action without disturbing
   * the rest of the slot's profile. This is the rebinding UI's main
   * write path — "I just remapped Jump to Space; don't touch Attack".
   *
   * Empty arrays are *legal* — they unbind the action for the slot.
   * The dispatcher treats an unbound action as never held.
   */
  setActionBindings(
    slot: PlayerBindingIndex,
    action: BindingAction,
    bindings: ReadonlyArray<InputBinding>,
  ): void {
    if (!Array.isArray(bindings)) {
      throw new Error(
        `InputBindingProfileManager.setActionBindings: bindings for action '${action}' must be an array.`,
      );
    }
    const current = this.getProfile(slot);
    const nextActions: ActionMap = Object.freeze({
      ...current.bindings,
      [action]: Object.freeze(Array.from(bindings)),
    });
    const next: PlayerProfile = Object.freeze<PlayerProfile>({
      schemaVersion: current.schemaVersion,
      playerIndex: current.playerIndex,
      deviceType: current.deviceType,
      bindings: nextActions,
    });
    // Re-validate as a paranoia belt — the merged whole must still be
    // shape-valid. `clonePlayerProfile` re-freezes recursively so any
    // entry the caller supplied as a non-frozen object becomes immutable
    // before storage.
    assertProfileShape(next, slot);
    this.state.set(slot, clonePlayerProfile(next));
  }

  // -------------------------------------------------------------------------
  // Conflict detection — AC 50004 Sub-AC 4
  //
  // The manager owns the per-slot binding state, so it is the natural
  // place for the rebinding UI / lobby ready-check / persistence loader
  // to ask "is the live state conflict-free?" or "would this proposed
  // write produce a duplicate?" without each caller having to assemble
  // the snapshot themselves. The detection logic itself lives in the
  // pure {@link BindingConflictDetector} module so it can be reused
  // independently of any manager instance.
  // -------------------------------------------------------------------------

  /**
   * Detect every intra-player duplicate-binding cluster currently
   * active in the manager (across all four slots).
   *
   * Returns a frozen {@link IntraPlayerConflictReport} that bundles the
   * raw conflict list with O(1) lookup helpers. Re-call this method
   * after any mutator ({@link setProfile}, {@link setBinding},
   * {@link setActionBindings}, {@link initializeSlotWithDefaults},
   * {@link resetSlot}, {@link resetAll}, {@link resetAction}) to read
   * the latest state — the report is a snapshot, not a live view.
   *
   * Used by:
   *
   *   • The lobby's "ready check" gate — if the report has any
   *     conflict, surface a "fix your bindings before continuing"
   *     prompt. Reading through the manager keeps the lobby decoupled
   *     from the conflict-detection module's exact API.
   *   • The settings screen's auto-save guard — refuse to write a
   *     conflicted profile to localStorage so a refresh can't silently
   *     restore a half-broken layout.
   *   • Tests — assert "after this rebind sequence, the state is
   *     clean" without poking the detector module.
   */
  detectIntraPlayerConflicts(): IntraPlayerConflictReport {
    return detectAllIntraPlayerConflicts(this.snapshot());
  }

  /**
   * Detect intra-player duplicate-binding clusters on a single slot.
   * Per-slot variant of {@link detectIntraPlayerConflicts} for callers
   * that only care about one player's profile (e.g. the rebinding
   * screen's per-panel tinting path).
   */
  detectIntraPlayerConflictsForSlot(
    slot: PlayerBindingIndex,
  ): ReadonlyArray<IntraPlayerBindingConflict> {
    return detectIntraPlayerConflicts(this.getProfile(slot));
  }

  /**
   * True iff *any* slot currently holds an intra-player duplicate-
   * binding cluster. Convenience wrapper over
   * {@link detectIntraPlayerConflicts} for the lobby's "is the binding
   * state clean?" check, which doesn't need the full report — just a
   * boolean.
   */
  hasIntraPlayerConflicts(): boolean {
    return this.detectIntraPlayerConflicts().hasConflicts;
  }

  /**
   * True iff the supplied slot currently holds an intra-player
   * duplicate-binding cluster. Per-slot variant of
   * {@link hasIntraPlayerConflicts} — the rebinding screen's per-panel
   * "should I show the warning chip on this player's panel?" check.
   */
  hasIntraPlayerConflictsForSlot(slot: PlayerBindingIndex): boolean {
    return this.detectIntraPlayerConflictsForSlot(slot).length > 0;
  }

  /**
   * Pre-flight check — would replacing the current binding list for
   * `(slot, action)` with `proposedBindings` produce an intra-player
   * conflict on the slot?
   *
   * Returns a discriminated {@link IntraPlayerConflictCheckResult}:
   *
   *   • `accepted: true` when the proposed write is safe (no new
   *     conflicts, or only allowed-overlap pairs like `moveUp`+`jump`).
   *   • `accepted: false` with the conflicts that would arise plus
   *     pre-formatted warning lines suitable for direct display in a
   *     rebinding UI confirm-cancel dialog.
   *
   * The manager is NOT mutated — call {@link setActionBindings} (or
   * {@link setActionBindingsChecked}) explicitly to commit. Surfacing
   * the check separately from the write is what lets the rebinding UI
   * show a "F is already on Shield — confirm or cancel?" prompt before
   * the player loses their previous binding.
   */
  checkActionBindingsProposal(
    slot: PlayerBindingIndex,
    action: BindingAction,
    proposedBindings: ReadonlyArray<InputBinding>,
  ): IntraPlayerConflictCheckResult {
    return checkProposedBindingForConflicts(
      this.getProfile(slot),
      action,
      proposedBindings,
    );
  }

  /**
   * Conflict-checked variant of {@link setActionBindings} — runs the
   * pre-flight check, and if any conflict is detected, refuses to
   * commit the write and returns the rejection result. When the
   * proposal is conflict-free the write commits and the method returns
   * `{ accepted: true }`.
   *
   * Sub-AC 4's "rejection in the UI" deliverable: a UI surface that
   * wants the strictest auto-reject behaviour (e.g. an "easy mode"
   * rebinding screen) wires its commit click through this method
   * instead of the bare {@link setActionBindings}; the warning lines on
   * the returned rejection are ready to render verbatim.
   *
   * Surfaces that prefer the looser "warn but allow" pattern (the
   * default rebinding screen) call {@link checkActionBindingsProposal}
   * for the warning copy and then call {@link setActionBindings}
   * unconditionally.
   */
  setActionBindingsChecked(
    slot: PlayerBindingIndex,
    action: BindingAction,
    bindings: ReadonlyArray<InputBinding>,
  ): IntraPlayerConflictCheckResult {
    const check = this.checkActionBindingsProposal(slot, action, bindings);
    if (check.accepted) {
      this.setActionBindings(slot, action, bindings);
    }
    return check;
  }

  // -------------------------------------------------------------------------
  // Initialise — seed slots with appropriate device-type defaults
  // -------------------------------------------------------------------------

  /**
   * Initialise (or re-initialise) a slot with the canonical default
   * {@link PlayerProfile} for the supplied {@link BindingDeviceKind}.
   *
   *   • `keyboard` → keyboard preset for the slot from
   *     {@link keyboardDefaultsBySlot}, with `deviceType: 'keyboard'`.
   *   • `gamepad`  → gamepad preset pinned to
   *     {@link conventionalPadIndexForSlot}(slot), with
   *     `deviceType: 'gamepad'`.
   *
   * Used by:
   *
   *   • The lobby when the player toggles slot N from "Empty" to
   *     "Keyboard" (or "Gamepad") — the manager seeds the slot with the
   *     right default profile so the rebinding UI can render preview
   *     rows immediately, before the player has captured any bindings.
   *   • The boot path when no persisted profile exists for a slot — call
   *     `initializeSlotWithDefaults(slot, canonicalDeviceTypeForSlot(slot))`
   *     to apply the Seed slot policy.
   *
   * Idempotent — calling twice with the same args is a no-op state-wise.
   */
  initializeSlotWithDefaults(
    slot: PlayerBindingIndex,
    deviceType: BindingDeviceKind = canonicalDeviceTypeForSlot(slot),
  ): void {
    this.state.set(slot, makeDefaultProfileForDevice(slot, deviceType));
  }

  /**
   * Reset a single slot to the canonical Seed-policy default profile —
   * shorthand for `initializeSlotWithDefaults(slot,
   * canonicalDeviceTypeForSlot(slot))`. Used by the rebinding UI's
   * "Reset to Defaults" button when the player wants to abandon all
   * customisation for that slot.
   */
  resetSlot(slot: PlayerBindingIndex): void {
    this.initializeSlotWithDefaults(slot, canonicalDeviceTypeForSlot(slot));
  }

  /**
   * Reset every slot to its canonical Seed-policy default — wipes
   * every per-slot customisation. Used by tests that need a clean
   * starting state and by the settings screen's "Restore all defaults"
   * button.
   */
  resetAll(): void {
    for (const slot of ALL_BINDING_PROFILE_SLOTS) {
      this.resetSlot(slot);
    }
  }

  /**
   * Reset a single action on a single slot to the slot's *current
   * device-type* default value. Leaves every other action on the slot
   * untouched. The rebinding UI uses this to back out of a partial
   * rebind without disturbing the player's other customisations.
   */
  resetAction(slot: PlayerBindingIndex, action: BindingAction): void {
    const deviceType = this.getDeviceType(slot);
    const defaultProfile = makeDefaultProfileForDevice(slot, deviceType);
    this.setActionBindings(slot, action, defaultProfile.bindings[action]);
  }

  // -------------------------------------------------------------------------
  // Diagnostic accessors
  // -------------------------------------------------------------------------

  /**
   * Slots currently configured for keyboard input. Used by the lobby's
   * slot-policy enforcer ("max 2 keyboard players") to count active
   * keyboard slots without iterating the snapshot manually.
   */
  keyboardSlots(): ReadonlyArray<PlayerBindingIndex> {
    return Object.freeze(
      ALL_BINDING_PROFILE_SLOTS.filter((slot) => this.getDeviceType(slot) === 'keyboard'),
    );
  }

  /**
   * Slots currently configured for gamepad input. Symmetric with
   * {@link keyboardSlots}.
   */
  gamepadSlots(): ReadonlyArray<PlayerBindingIndex> {
    return Object.freeze(
      ALL_BINDING_PROFILE_SLOTS.filter((slot) => this.getDeviceType(slot) === 'gamepad'),
    );
  }
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { DEFAULT_PLAYER_BINDINGS, DEFAULT_PLAYER_PROFILES } from '../types/bindings';
