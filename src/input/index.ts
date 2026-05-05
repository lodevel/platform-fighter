/**
 * Input module.
 *
 * Public surface:
 *   • {@link LocalInputHandler} — keyboard player handler (P1 = WASD +
 *     adjacent keys, P2 = Arrows + Numpad). Maps held key state into
 *     the deterministic `CharacterInput` record (AC 203 Sub-AC 3).
 *   • {@link createPhaserKeyboardSource} — bridges a Phaser scene's
 *     keyboard plugin into the handler's hardware abstraction.
 *   • Default binding tables and the `KEY_CODE` constants used by the
 *     replay system, the M5 rebinding screen, and unit tests.
 *
 * Gamepad API (P3/P4) and the rebinding store land in later sub-ACs and
 * milestones (M2 / M5); the AI module (`src/ai`) plugs into the same
 * `CharacterInput` shape so AI players never need to round-trip
 * through a synthetic keyboard.
 */

export {
  LocalInputHandler,
  DEFAULT_P1_BINDINGS,
  DEFAULT_P2_BINDINGS,
  createPhaserKeyboardSource,
} from './LocalInputHandler';
export type {
  InputAction,
  KeyBindings,
  KeyboardPlayerIndex,
  KeyboardSource,
  LocalInputHandlerOptions,
} from './LocalInputHandler';

export { KEY_CODE } from './keyCodes';
export type { KeyCode } from './keyCodes';

// ---------------------------------------------------------------------------
// AC 10201 Sub-AC 1 — shared input-provider abstraction
//
// Slot-scoped read interface (`PlayerInputProvider.sample(frame)`) used by
// the match scene to read inputs from a uniform array of human + AI
// players, plus a thin adapter that wraps an existing `LocalInputHandler`
// in the same shape so keyboard and AI sources are interchangeable.
// ---------------------------------------------------------------------------

export {
  NEUTRAL_INPUT_SNAPSHOT,
  closeCharacterInput,
  createKeyboardInputProvider,
  createBothKeyboardInputProviders,
  createBindingsKeyboardInputProvider,
  createBothBindingsKeyboardInputProviders,
  createBindingsGamepadInputProvider,
  createBothBindingsGamepadInputProviders,
  GAMEPAD_ANY_PAD_SCAN_RANGE,
} from './InputProvider';
export type {
  PlayerInputProvider,
  PlayerSlotIndex,
  BindingsKeyboardInputProviderOptions,
  KeyboardBindingsProvider,
  BindingsGamepadInputProviderOptions,
  GamepadBindingsProvider,
} from './InputProvider';

// ---------------------------------------------------------------------------
// M5 input bindings store (AC 40002 Sub-AC 2)
// ---------------------------------------------------------------------------

export {
  InputBindingsStore,
  DEFAULT_PLAYER_BINDINGS,
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_GAMEPAD_P4_BINDINGS,
  DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  buildDefaultGamepadBindings,
  assertValidPlayerBindings,
  mergeBindingsWithDefaults,
} from './InputBindingsStore';
export type {
  InputBindingsStoreOptions,
  PartialPlayerBindings,
} from './InputBindingsStore';

// ---------------------------------------------------------------------------
// M5 device abstraction layer (AC 40003 Sub-AC 3)
//
// Normalises raw keyboard / gamepad state into per-action booleans via
// the binding schema. Stateless by design — every read recomputes from
// the live source state, so a rebinding committed to the store mid-match
// takes effect on the very next sample. See `DeviceInputDispatcher.ts`
// for the full design rationale.
// ---------------------------------------------------------------------------

export {
  DeviceInputDispatcher,
  createBrowserGamepadSource,
  NEUTRAL_ACTION_MAP,
} from './DeviceInputDispatcher';
export type {
  ActionHeldMap,
  DeviceInputDispatcherOptions,
  GamepadButtonState,
  GamepadSource,
  PlayerBindingsProvider,
} from './DeviceInputDispatcher';

// ---------------------------------------------------------------------------
// AC 5 Sub-AC 2 — InputBindingManager event service
//
// Higher-level service that translates raw keyboard / gamepad events
// (via the {@link DeviceInputDispatcher} polling layer) into per-player
// action events using the active binding profile from
// {@link InputBindingsStore}. Replaces the keyboard-only `LocalInputHandler`
// edge-detection footprint and the scattered `wasDown` / `isDown`
// checks that previously hardcoded keyCodes inside scenes. See the
// module header for the architecture diagram.
// ---------------------------------------------------------------------------

export { InputBindingManager } from './InputBindingManager';
export type {
  InputBindingManagerOptions,
  PlayerActionEvent,
  PlayerActionEventKind,
  PlayerActionListener,
  Unsubscribe,
} from './InputBindingManager';

// ---------------------------------------------------------------------------
// M5 binding configuration serialisation (AC 40004 Sub-AC 4)
//
// Versioned JSON envelope + strict / safe deserialisers used by the
// settings layer (`localStorage` round-trip), the rebinding UI's
// import / export buttons, and the replay payload that embeds the
// active binding table.
// ---------------------------------------------------------------------------

export {
  BINDINGS_SCHEMA_VERSION,
  serializePlayerBindings,
  serializeBindingsSnapshot,
  deserializePlayerBindings,
  deserializeBindingsSnapshot,
  safeDeserializePlayerBindings,
  safeDeserializeBindingsSnapshot,
  detectSerializedKind,
} from './InputBindingsSerializer';
export type {
  SerializedBindingsKind,
  SerializedPlayerBindings,
  SerializedBindingsSnapshot,
  DeserializeResult,
} from './InputBindingsSerializer';

// ---------------------------------------------------------------------------
// AC 40002 Sub-AC 2 — bindings localStorage persistence layer
//
// Wraps the canonical serializer in `localStorage` IO with:
//   • Namespaced keys (`platformfighter.bindings.v1.*`)
//   • Versioned schema gating (key version segment + envelope version)
//   • Result-style error handling for missing / corrupted / unavailable
//     storage and for `setItem` throws (quota / private mode)
//   • Defaults-fallback helper that always yields a usable bindings
//     record so the boot path never branches on storage state
// ---------------------------------------------------------------------------

export {
  STORAGE_APP_NAMESPACE,
  STORAGE_BINDINGS_DOMAIN,
  STORAGE_BINDINGS_VERSION_SEGMENT,
  ALL_BINDINGS_STORAGE_KEYS,
  snapshotStorageKey,
  playerStorageKey,
  saveBindingsSnapshot,
  loadBindingsSnapshot,
  loadBindingsSnapshotOrDefaults,
  savePlayerBindings,
  loadPlayerBindings,
  clearBindingsStorage,
  hasStoredBindingsSnapshot,
} from './BindingsStorage';
export type {
  StorageLike,
  StorageResult,
  StorageErrorCode,
  DetailedStorageResult,
} from './BindingsStorage';

// ---------------------------------------------------------------------------
// AC 40003 Sub-AC 3 — bindings schema migration system
//
// Version detection, one-step migration handlers between schema
// versions, and fallback-to-defaults integration on the load path. A
// v0 blob saved by an earlier build is upgraded to today's schema
// before the strict validator runs; out-of-window or genuinely-corrupt
// blobs surface as a typed error code so the boot path can branch on
// "user has older save we can't read" vs "the file is junk".
// ---------------------------------------------------------------------------

export {
  CURRENT_BINDINGS_SCHEMA_VERSION,
  MIN_MIGRATABLE_BINDINGS_VERSION,
  MIGRATABLE_BINDINGS_VERSIONS,
  BINDINGS_MIGRATIONS,
  BindingsVersionUnsupportedError,
  BindingsMigrationError,
  detectBindingsPayloadVersion,
  detectVersionOnParsedPayload,
  isCompatibleBindingsVersion,
  describeBindingsVersionStatus,
  migrateBindingsPayload,
  safeMigrateBindingsJson,
  safeMigrateParsedBindings,
  migrationAwareDeserializePlayerBindings,
  migrationAwareDeserializeBindingsSnapshot,
  loadBindingsWithMigrationOrDefaults,
} from './BindingsMigrations';
export type {
  BindingsVersionUnsupportedKind,
  BindingsMigration,
  BindingsVersionStatus,
  BindingsVersionDetection,
  SafeMigrationResult,
  MigrationAwareDeserializeResult,
} from './BindingsMigrations';

// ---------------------------------------------------------------------------
// AC 5 Sub-AC 4 — bindings persistence controller
//
// Glue that ties the in-memory `InputBindingsStore` to the
// `BindingsStorage` IO layer. Used by the boot path to hydrate the
// store from `localStorage` before any scene reads it, and by the
// rebinding UI to autosave after every committed capture / reset.
// ---------------------------------------------------------------------------

export {
  BindingsPersistenceController,
  createHydratedBindingsStore,
  snapshotMatchesDefaults,
} from './BindingsPersistenceController';
export type {
  BindingsPersistenceControllerOptions,
  BindingsPersistenceErrorListener,
  HydrateFallbackReason,
  HydrateResult,
} from './BindingsPersistenceController';

// ---------------------------------------------------------------------------
// AC 14 Sub-AC 1 — controller disconnect detection
//
// Subscribes to the browser's `gamepadconnected` / `gamepaddisconnected`
// events and translates each one into an event payload that names the
// player slot(s) whose bindings reference the affected pad index.
// Stateless w.r.t. gameplay; the disconnect→slot mapping is a pure
// function of the live `PlayerBindingsProvider` state.
// ---------------------------------------------------------------------------

export {
  ALL_PLAYER_SLOTS,
  GamepadConnectionMonitor,
  findSlotsBoundToGamepad,
  isPlayerBoundToGamepad,
  resolveDefaultGamepadEventTarget,
} from './GamepadConnectionMonitor';
export type {
  GamepadConnectEvent,
  GamepadConnectListener,
  GamepadConnectionMonitorOptions,
  GamepadDisconnectEvent,
  GamepadDisconnectListener,
  GamepadEventTargetLike,
} from './GamepadConnectionMonitor';

// ---------------------------------------------------------------------------
// AC 14 Sub-AC 4 — controller reconnection handler
//
// Bridges the gamepad-connection monitor and the bindings store: when a
// disconnected pad reappears at a different `gamepadIndex`, this handler
// rewrites the affected slots' gamepad bindings to the new index and
// nudges the disconnect-pause controller to release its pause via a
// synthetic connect for the original index. See module header for the
// full design rationale.
// ---------------------------------------------------------------------------

export {
  ControllerReconnectionHandler,
  remapSlotBindings,
} from './ControllerReconnectionHandler';
export type {
  ControllerReconnectionHandlerOptions,
  ControllerRebindEvent,
  ControllerRebindListener,
} from './ControllerReconnectionHandler';

// ---------------------------------------------------------------------------
// AC 40003 Sub-AC 3 — unified BindingsStore facade
//
// One front door over the data model + persistence layers exposing
// get / set / reset APIs for the four player profiles. Composes
// `InputBindingsStore` and `BindingsPersistenceController` and applies
// auto-persist on every write so the rebinding UI no longer has to
// remember to flush after each capture.
// ---------------------------------------------------------------------------

export { BindingsStore, createBindingsStore } from './BindingsStore';
export type { BindingsStoreOptions, WriteResult } from './BindingsStore';

// ---------------------------------------------------------------------------
// AC 40301 Sub-AC 1 — unified persistence lifecycle
//
// Single named lifecycle object that pairs the in-memory bindings store
// with hydrate-on-boot, auto-save-on-change, schema versioning, and
// migration fallback for legacy / invalid `localStorage` blobs. Wraps
// the existing IO + migration + controller stack into the AC-named
// vocabulary (`boot`, `setBinding`, `setAction`, `reset`, `clear`,
// `subscribe`, `getState`) the boot path and the rebinding UI consume.
// See `BindingsPersistenceLifecycle.ts` for the full design rationale.
// ---------------------------------------------------------------------------

export {
  BindingsPersistenceLifecycle,
  createBootedLifecycle,
} from './BindingsPersistenceLifecycle';
export type {
  BindingsLifecycleChangeEvent,
  BindingsLifecycleListener,
  BindingsLifecycleUnsubscribe,
  BindingsPersistenceLifecycleOptions,
  LifecycleChangeCause,
  LifecycleHydrateSource,
  LifecycleState,
  WriteResult as LifecycleWriteResult,
} from './BindingsPersistenceLifecycle';

// ---------------------------------------------------------------------------
// AC 5 Sub-AC 1 — canonical bindings data model + default profiles
//
// The dedicated, AC-named bindings vocabulary lives in
// `src/types/bindings.ts` (see that module's header for the design
// rationale and how it relates to the legacy `inputBindings.ts`). It
// covers the full action set called out by AC 5 Sub-AC 1
// (move{Left,Right,Up,Down} / jump / attack / special / shield / grab /
// dodge), ships default keyboard profiles for slots 1–2 and default
// gamepad profiles for slots 3–4, and includes the persistence-shape
// `PlayerProfile` envelope (deviceType + schemaVersion + action map).
//
// We re-export it through the central InputBindings module here so a
// single import path — `import { ... } from 'src/input'` — gives
// rebinding-UI / persistence / replay callers everything they need.
// ---------------------------------------------------------------------------

export {
  BINDING_ACTIONS,
  BINDINGS_SCHEMA_VERSION as CANONICAL_BINDINGS_SCHEMA_VERSION,
  DEFAULT_GAMEPAD_AXIS_THRESHOLD as CANONICAL_DEFAULT_GAMEPAD_AXIS_THRESHOLD,
  DEFAULT_KEYBOARD_P1_BINDINGS as CANONICAL_DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS as CANONICAL_DEFAULT_KEYBOARD_P2_BINDINGS,
  DEFAULT_GAMEPAD_P3_BINDINGS as CANONICAL_DEFAULT_GAMEPAD_P3_BINDINGS,
  DEFAULT_GAMEPAD_P4_BINDINGS as CANONICAL_DEFAULT_GAMEPAD_P4_BINDINGS,
  DEFAULT_PLAYER_BINDINGS as CANONICAL_DEFAULT_PLAYER_BINDINGS,
  DEFAULT_PLAYER_PROFILES,
  buildDefaultGamepadBindings as buildCanonicalDefaultGamepadBindings,
  fromPlayerProfile,
  getDefaultPlayerBinding,
  getDefaultPlayerProfile,
  toPlayerProfile,
} from '../types/bindings';
export type {
  ActionMap,
  BindingAction,
  BindingDeviceKind,
  BindingsSchemaVersion,
  GamepadBinding as CanonicalGamepadBinding,
  GamepadBindingSource as CanonicalGamepadBindingSource,
  InputBinding as CanonicalInputBinding,
  KeyboardBinding as CanonicalKeyboardBinding,
  PlayerBinding,
  PlayerBindingIndex,
  PlayerProfile,
} from '../types/bindings';

// ---------------------------------------------------------------------------
// AC 40101 Sub-AC 1 — versioned binding profile persistence schema
//
// Pure schema definitions for the 4-player binding profile payload
// the M5 settings layer persists to `localStorage`:
//
//   • {@link SCHEMA_VERSION}                — current persistence
//                                             schema version (pinned
//                                             to {@link BINDINGS_SCHEMA_VERSION}).
//   • {@link BindingProfilesPayload}        — 4-player payload envelope.
//   • {@link BINDING_PROFILES_STORAGE_KEY}  — full localStorage key.
//
// Types-and-constants only — the IO + migration logic lives next door
// in `BindingsStorage.ts` / `BindingsMigrations.ts`. Splitting the
// schema out keeps replay payloads, pure formatters, and type-only
// imports free of the IO module's `localStorage` resolution.
// ---------------------------------------------------------------------------

export {
  SCHEMA_VERSION,
  BINDING_PROFILES_PAYLOAD_KIND,
  BINDING_PROFILES_STORAGE_KEY,
} from './BindingProfilePersistence';
export type {
  BindingProfilesPayload,
  BindingProfilesPayloadKind,
  FourPlayerProfileMap,
  SchemaVersion,
} from './BindingProfilePersistence';

// ---------------------------------------------------------------------------
// AC 40101 Sub-AC 1 — unified InputService / action-resolver
//
// Per-frame read surface that queries the per-player BindingsStore via
// the DeviceInputDispatcher and exposes the unified action API the Seed
// describes word-for-word (move / jump / attack / special / shield /
// grab / dodge). Stateless by design — every call recomputes from the
// live device state, so a mid-match rebind takes effect on the very
// next read with no explicit reload step. See `InputService.ts` for the
// full design rationale.
// ---------------------------------------------------------------------------

export {
  InputService,
  UNIFIED_ACTION_NAMES,
  MOVE_NEUTRAL,
  DODGE_DIRECTIONAL_THRESHOLD,
  defaultDodgeResolver,
  neutralUnifiedActionState,
  LEGACY_LOGICAL_ACTIONS,
} from './InputService';
export type {
  DodgeResolver,
  DodgeResolverContext,
  InputServiceOptions,
  MoveVector,
  ServiceBindingsSource,
  UnifiedActionName,
  UnifiedActionState,
} from './InputService';

// ---------------------------------------------------------------------------
// AC 50002 Sub-AC 2 — AC-named default binding presets
//
// Re-exports the seed-literal default profile names from
// `defaultBindingProfiles.ts` so the rebinding UI's "Reset to Defaults"
// button, the lobby preview tiles, and tests can import them through
// the central `src/input` front door alongside the rest of the M5
// surface. The values alias the canonical M1-era defaults where the
// AC's slot policy applies (P1 / P2 keyboard, gamepad template); the
// P3 / P4 keyboard fallbacks are unique to this module.
// ---------------------------------------------------------------------------

export {
  buildGamepadDefaultsForPad,
  gamepadDefaults,
  keyboardDefaultsBySlot,
  keyboardDefaultsP1,
  keyboardDefaultsP2,
  keyboardDefaultsP3,
  keyboardDefaultsP4,
} from './defaultBindingProfiles';

// ---------------------------------------------------------------------------
// AC 50003 Sub-AC 3 — InputBindingProfileManager
//
// Single named service that owns the four-slot `PlayerProfile` table.
// Implements get / set bindings per player slot, action-to-input
// resolution, and per-slot initialisation with the appropriate
// device-type defaults (keyboard for P1/P2 by Seed slot policy, gamepad
// for P3/P4). Uses the canonical M5 vocabulary (`BindingAction`,
// `PlayerBinding`, `PlayerProfile`) and the AC 50002 default presets.
//
// Distinct from the `InputBindingManager` event service (AC 5 Sub-AC 2):
// this class owns the per-slot binding *data*; that one emits per-frame
// press / release / hold *events* via a `DeviceInputDispatcher`. The two
// classes have complementary, disjoint responsibilities. See
// `InputBindingProfileManager.ts` for the full design rationale.
// ---------------------------------------------------------------------------

export {
  ALL_BINDING_PROFILE_SLOTS,
  InputBindingProfileManager,
  canonicalDeviceTypeForSlot,
  conventionalPadIndexForSlot,
} from './InputBindingProfileManager';
export type { InputBindingProfileManagerOptions } from './InputBindingProfileManager';

// ---------------------------------------------------------------------------
// AC 50003 Sub-AC 3 — next-input capture mechanism
//
// Service-layer "press the next key/button" controller. Subscribes to a
// `RawInputSource`, converts the next eligible event into the matching
// `InputBinding`, and commits it through a write target (typically the
// `InputBindingProfileManager.setActionBindings` method). Phaser-free,
// scene-free, DOM-free — drives via raw events only.
//
// Complementary to the UI-layer capture flow in
// `src/ui/RebindingScreen.ts` (which owns text rendering and conflict
// detection); the controller here can be reused by the lobby's
// "press any button to join Player N" flow without dragging the
// rebinding screen along. See `NextInputCapture.ts` for the full
// design rationale.
// ---------------------------------------------------------------------------

export {
  NextInputCaptureController,
  createNextInputCaptureForProfileManager,
} from './NextInputCapture';
export type {
  NextInputCaptureCancelReason,
  NextInputCaptureControllerOptions,
  NextInputCaptureListener,
  NextInputCaptureMode,
  NextInputCaptureOptions,
  NextInputCaptureResult,
  NextInputCaptureSession,
  NextInputCaptureSourceLike,
  NextInputCaptureTarget,
} from './NextInputCapture';

// ---------------------------------------------------------------------------
// AC 50004 Sub-AC 4 — intra-player binding-conflict detector (canonical
// vocabulary)
//
// Pure detector module that pairs with the canonical `bindings.ts`
// vocabulary (`BindingAction`, `PlayerProfile`, `InputBinding`) to flag
// duplicate bindings within a single player's action set. Surfaces a
// frozen `IntraPlayerConflictReport` plus pre-formatted warning lines
// the rebinding UI / lobby ready-check / persistence loader can render
// verbatim. Also exposes a `checkProposedBindingForConflicts` /
// rejection helper for pre-commit "would this clash?" checks.
//
// Complementary to the legacy `src/ui/bindingConflicts.ts` detector
// (which speaks the older `inputBindings.ts` `LogicalAction` vocabulary
// owned by the existing RebindingScreen); the canonical-vocabulary
// detector lives here so it can be wired into the
// `InputBindingProfileManager` directly without dragging the UI layer
// along. See `BindingConflictDetector.ts` for the full design rationale.
// ---------------------------------------------------------------------------

export {
  ALLOWED_OVERLAP_PAIRS as INTRA_PLAYER_ALLOWED_OVERLAP_PAIRS,
  bindingIdentity as intraPlayerBindingIdentity,
  bindingsConflict as intraPlayerBindingsConflict,
  checkProposedBindingForConflicts,
  detectAllIntraPlayerConflicts,
  detectIntraPlayerConflicts,
  detectIntraPlayerConflictsForProposal,
  formatIntraPlayerConflictPrompt,
  formatIntraPlayerWarningLines,
  intraPlayerConflictTintHex,
  INTRA_PLAYER_CONFLICT_TINT,
  isAllowedOverlap as isIntraPlayerAllowedOverlap,
} from './BindingConflictDetector';
export type {
  IntraPlayerBindingConflict,
  IntraPlayerBindingLocation,
  IntraPlayerConflictCheckResult,
  IntraPlayerConflictReport,
  IntraPlayerConflictSeverity,
} from './BindingConflictDetector';

// ---------------------------------------------------------------------------
// AC 50201 Sub-AC 1 — per-player input controller / unified action-state API
//
// Single-slot adapter on top of {@link InputBindingManager} that
// exposes the Seed's canonical action vocabulary
// (`move{Left,Right,Up,Down}` / jump / attack / special / shield /
// grab / dodge) through `isActionDown` / `justPressed` / `justReleased`
// — the gameplay-side vocabulary every fighter / AI override / lobby
// confirm reads through. Queries the manager every frame, so a rebind
// committed mid-match is visible on the very next `update()`. There
// are zero references to `KEY_CODE` or any device-specific lookup in
// this module — all key/button mapping flows through the manager and
// its dispatcher. See `PlayerInputController.ts` for the full design
// rationale.
// ---------------------------------------------------------------------------

export {
  ACTION_NAMES as PLAYER_INPUT_ACTION_NAMES,
  PlayerInputController,
  buildCharacterInputFromController,
} from './PlayerInputController';
export type {
  PlayerInputControllerOptions,
  UnifiedActionName as PlayerInputActionName,
} from './PlayerInputController';

// ---------------------------------------------------------------------------
// AC 50203 Sub-AC 3 — runtime input pipeline (multi-player + live rebind)
//
// Single named object that ties together the dispatcher / manager /
// per-slot controllers for an arbitrary mix of human + AI players,
// configures each slot's bindings to point at its assigned physical
// device (keyboard cluster / gamepad index), and supports mid-session
// device reassignment + live rebinds without a scene reload. See
// `RuntimeInputPipeline.ts` for the full design rationale.
// ---------------------------------------------------------------------------

export {
  RuntimeInputPipeline,
  profileForAssignment,
  defaultRuntimeSlotConfigs,
} from './RuntimeInputPipeline';
export type {
  KeyboardCluster,
  RuntimeInputPipelineOptions,
  RuntimeSlotAssignment,
  RuntimeSlotConfig,
} from './RuntimeInputPipeline';

// ---------------------------------------------------------------------------
// AC 50101 Sub-AC 1 — raw input source / event-emitting bottom layer
//
// Captures keyboard and gamepad events from the browser / Phaser input
// system and emits normalised RawInputEvents (keydown, keyup, buttondown,
// buttonup, axischange) tagged with player-source attribution
// (`{ kind: 'keyboard' }` or `{ kind: 'gamepad'; index: N }`). Sits below
// the DeviceInputDispatcher / InputBindingManager polling + edge layers
// — those modules consume held state, this layer surfaces the raw
// transitions a rebinding-capture window or replay tagger needs without
// imposing a logical-action interpretation. See `RawInputSource.ts` for
// the full design rationale.
// ---------------------------------------------------------------------------

export {
  DEFAULT_AXIS_DEADZONE,
  DEFAULT_MAX_GAMEPAD_INDEX,
  KEYBOARD_DEVICE_SOURCE,
  RawInputSource,
  createBrowserKeyboardEventTarget,
  createPhaserKeyboardEventTarget,
  gamepadDeviceSource,
} from './RawInputSource';
export type {
  KeyboardEventLike,
  RawGamepadAxisChangeEvent,
  RawGamepadButtonDownEvent,
  RawGamepadButtonUpEvent,
  RawInputDeviceSource,
  RawInputEvent,
  RawInputEventKind,
  RawInputListener,
  RawInputSourceOptions,
  RawInputUnsubscribe,
  RawKeyDownEvent,
  RawKeyUpEvent,
  RawKeyboardEventTarget,
} from './RawInputSource';

// ---------------------------------------------------------------------------
// AC 50201 Sub-AC 1 — central InputResolver / ActionMap
//
// The single named "central" surface every gameplay consumer flows
// through to read action state for any of the four player slots. Wraps
// the existing {@link DeviceInputDispatcher} + binding-store stack and
// exposes the AC-named `getAction(playerIndex, actionName)` API over
// the canonical seed action vocabulary
// (`move{Left,Right,Up,Down}` / jump / attack / special / shield /
// grab / dodge). No call site of `InputResolver` ever references
// `KEY_CODE` or any device-specific lookup — the resolver is the
// single bridge from "binding profile + raw device state" to
// "per-player action state". See `InputResolver.ts` for the full
// design rationale.
// ---------------------------------------------------------------------------

export {
  ACTION_NAMES as RESOLVER_ACTION_NAMES,
  ALL_PLAYER_INDICES,
  InputResolver,
  NEUTRAL_ACTION_STATE,
  PlayerActionMap,
  buildCharacterInputFromResolver,
} from './InputResolver';
export type {
  ActionName as ResolverActionName,
  ActionState,
  InputResolverOptions,
  PlayerIndex as ResolverPlayerIndex,
} from './InputResolver';

// ---------------------------------------------------------------------------
// AC 50102 Sub-AC 2 — binding map resolver
//
// Event-driven translator that takes a player's active binding map plus
// a single {@link RawInputEvent} (from {@link RawInputSource}) and emits
// zero or more {@link SemanticActionEvent}s carrying the corresponding
// canonical action (jump / attack / special / shield / grab / dodge /
// move{Left,Right,Up,Down}) and a press / release / hold discriminator.
//
// Sits one layer above {@link RawInputSource} and one layer below the
// poll-driven {@link InputBindingManager}, supplying the per-event
// edge-detected stream the rebinding capture window, replay tagger,
// and chord-detection paths consume. See `BindingMapResolver.ts` for
// the full design rationale.
// ---------------------------------------------------------------------------

export { BindingMapResolver } from './BindingMapResolver';
export type {
  BindingMapResolverOptions,
  SemanticActionEvent,
  SemanticActionEventKind,
} from './BindingMapResolver';

// ---------------------------------------------------------------------------
// AC 50203 Sub-AC 3 — menu / HUD navigation adapter
//
// Phaser-free, pure read surface that wraps the central
// {@link InputResolver} and exposes the menu vocabulary
// (`navigateLeft / navigateRight / navigateUp / navigateDown / confirm /
// cancel`) with rising-edge semantics. Every menu / pause /
// character-select navigation read flows through this adapter so the
// mapping from "binding profile + raw device state" to "menu action"
// stays in one place — and so a rebind of `attack` → `K` automatically
// rebinds the menu's `confirm` to `K` too. See `MenuInputAdapter.ts`
// for the full design rationale.
// ---------------------------------------------------------------------------

export {
  MENU_ACTIONS,
  MENU_ACTION_TO_RESOLVER,
  MenuInputAdapter,
} from './MenuInputAdapter';
export type {
  MenuAction,
  MenuInputAdapterOptions,
} from './MenuInputAdapter';
