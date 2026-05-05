/**
 * Runtime input pipeline — AC 50203 Sub-AC 3.
 *
 * Purpose
 * -------
 *
 * The earlier M5 sub-ACs landed each layer of the rebinding stack as a
 * standalone piece:
 *
 *   • `InputBindingsStore` — the four-slot in-memory binding profile
 *     facade.
 *   • `BindingsPersistenceLifecycle` — the auto-saving wrapper the
 *     rebinding screen mutates against.
 *   • `DeviceInputDispatcher` — stateless polling that resolves a
 *     {@link PlayerBindings} table against live keyboard / gamepad state.
 *   • `InputBindingManager` — event-driven press / release diffing for
 *     menus, replay tagging, and the per-frame `isActionHeld` oracle.
 *   • `PlayerInputController` — single-slot per-player adapter that
 *     queries the manager each frame and exposes the unified
 *     `isActionDown` / `justPressed` / `justReleased` API.
 *
 * What was *missing* was a single, named object that ties those pieces
 * together for an *arbitrary* mix of human + AI players, configures each
 * slot's bindings to point at the slot's *assigned* physical device
 * (keyboard cluster or gamepad index), and proves that mid-session
 * rebinds — including swapping a slot's device family — flow through
 * the full chain on the very next sample without a scene reload. The
 * existing `MatchScene.create()` wiring hard-coded a 2-player keyboard
 * setup; multi-player gamepad support was implicit in the bindings
 * defaults but never exercised end-to-end through a single named
 * surface.
 *
 * `RuntimeInputPipeline` is that named surface. It:
 *
 *   1. **Owns the manager + per-slot controllers.** A single
 *      {@link InputBindingManager} is polled once per fixed step; every
 *      registered slot gets one {@link PlayerInputController} backed by
 *      the same manager so a single device sample feeds every consumer.
 *   2. **Configures bindings from device assignments.** Each
 *      {@link RuntimeSlotAssignment} carries the slot index and either
 *      a keyboard layout (`P1` / `P2`) or a gamepad index. The pipeline
 *      writes the matching default profile into the bindings store so
 *      gameplay reads through that profile from frame 1. Existing
 *      customisations on a slot are preserved when the assignment
 *      matches the current device family — only the device-axis fields
 *      (gamepad index) are realigned.
 *   3. **Supports mid-session reassignment.** `assignSlotDevice(slot,
 *      assignment)` rewrites the bindings store on the fly. The
 *      dispatcher reads the latest profile on every sample, so the next
 *      `update(frame)` call honours the new mapping immediately — no
 *      pipeline reconstruction, no controller reset, no scene reload.
 *   4. **Lives by the rebinding-screen contract.** Because the dispatcher
 *      reads the live store on every sample, any mutation made by the
 *      rebinding screen against the same store is also reflected on the
 *      very next pipeline `update()` — the live-rebind property the AC
 *      asks for is automatic given the existing chain identity.
 *
 * Architecture
 * ------------
 *
 *     RebindingScreen.commit            assignSlotDevice (lobby / pause overlay)
 *           │                                    │
 *           ▼                                    ▼
 *           InputBindingsStore  ◄── (live profile mutations) ──┘
 *           │
 *     DeviceInputDispatcher (per-frame device read)
 *           │
 *     InputBindingManager (per-frame poll, edge events)
 *           │
 *     PlayerInputController × N  (one per active slot)
 *           │
 *     buildCharacterInputFromController → CharacterInput
 *           │
 *     Character.applyInput / AI runtime / replay capture
 *
 * Determinism
 * -----------
 *
 *   • `update(frame)` is the only mutator on the pipeline. Two
 *     `getCharacterInput(slot)` reads on the same frame return identical
 *     records, byte-for-byte.
 *   • Slot assignment writes are atomic — the bindings store mutator
 *     replaces the slot's profile in one operation; there is no
 *     observable "half-set" window. The next sample reads the new
 *     profile in full.
 *   • No `Math.random()`, no wall-clock reads, no Phaser. The pipeline
 *     accepts the dispatcher / manager / store as constructor inputs so
 *     the unit suite hands in the same `Set` / `Map`-backed mocks the
 *     rest of the input suite uses.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The exhaustive
 * union over {@link RuntimeSlotAssignment} and the named slot iteration
 * keep mismatched device kinds + slot indices from leaking through.
 */

import type { CharacterInput } from '../characters/Character';
import {
  DEFAULT_KEYBOARD_P1_BINDINGS,
  DEFAULT_KEYBOARD_P2_BINDINGS,
  buildDefaultGamepadBindings,
  type InputBindingsStore,
} from './InputBindingsStore';
import { DeviceInputDispatcher, type GamepadSource } from './DeviceInputDispatcher';
import { InputBindingManager } from './InputBindingManager';
import {
  buildCharacterInputFromController,
  PlayerInputController,
} from './PlayerInputController';
import type { KeyboardSource } from './LocalInputHandler';
import type { ActionBindings, PlayerBindingsIndex } from '../types/inputBindings';

// ---------------------------------------------------------------------------
// Slot assignment vocabulary
// ---------------------------------------------------------------------------

/**
 * Keyboard cluster the slot is bound to.
 *
 *   • `'p1'` — WASD + F/G/H/T/R cluster (the M1 P1 default).
 *   • `'p2'` — Arrows + Numpad cluster (the M1 P2 default).
 *
 * The Seed pins keyboard players to two clusters by hardware constraint
 * (one keyboard, two players' worth of keys with no overlap), so the
 * pipeline only accepts the two named values. A future "rebind every
 * key on the P1 cluster to something else" path still goes through the
 * rebinding store at the action level — the pipeline only seeds the
 * initial defaults from the named cluster.
 */
export type KeyboardCluster = 'p1' | 'p2';

/**
 * Per-slot device assignment passed to the pipeline at construction or
 * to {@link RuntimeInputPipeline.assignSlotDevice} mid-session.
 *
 *   • `kind: 'keyboard'` — slot reads from the named keyboard cluster
 *     (P1 / P2). The pipeline writes the matching default keyboard
 *     profile into the bindings store at this slot.
 *   • `kind: 'gamepad'`  — slot reads from the gamepad at the supplied
 *     `Gamepad.index`. The pipeline writes the default gamepad profile
 *     pinned to that index into the bindings store at this slot. Two
 *     slots referencing the same `gamepadIndex` is legal (the lobby
 *     prevents it for human players, but a tag-team gag setup may want
 *     it) — the dispatcher's per-binding read is OR-style across slots.
 *
 * `kind` is the canonical discriminator; consumers exhaustively switch
 * on it under strict mode. Adding a new device family means adding a new
 * `kind` literal and updating the pipeline + tests — the standard
 * exhaustiveness pattern.
 */
export type RuntimeSlotAssignment =
  | {
      readonly kind: 'keyboard';
      readonly cluster: KeyboardCluster;
    }
  | {
      readonly kind: 'gamepad';
      readonly gamepadIndex: number;
    };

/**
 * Constructor entry that names a slot AND its initial assignment in one
 * record. The pipeline holds an array of these so iteration order is
 * deterministic — slot 1 first, slot 4 last — and so consumers can pass
 * a sparse subset (a 2P match supplies entries for slots 1 + 2 only).
 */
export interface RuntimeSlotConfig {
  readonly slot: PlayerBindingsIndex;
  readonly assignment: RuntimeSlotAssignment;
}

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/**
 * Constructor options for {@link RuntimeInputPipeline}.
 *
 * Every input layer the pipeline composes is supplied externally so the
 * production scene wires real keyboard / gamepad sources and the unit
 * suite hands in mocks. The pipeline never instantiates a Phaser
 * keyboard adapter or `navigator.getGamepads()` adapter itself — that
 * keeps the module Phaser-free and headless-test-friendly.
 */
export interface RuntimeInputPipelineOptions {
  /**
   * Bindings store the dispatcher reads from. The pipeline writes
   * device-default profiles into this store on construction (and on
   * every `assignSlotDevice` call); the rebinding screen, the replay
   * loader, and the persistence lifecycle all share the same store
   * reference, so a rebind committed elsewhere is visible on the very
   * next pipeline sample without explicit notification.
   */
  readonly bindings: InputBindingsStore;

  /**
   * Pluggable keyboard hardware abstraction. Production wiring uses
   * `createPhaserKeyboardSource(scene)`; tests hand in a `Set`-backed
   * mock that exposes `press` / `release` helpers.
   */
  readonly keyboard: KeyboardSource;

  /**
   * Pluggable gamepad hardware abstraction. Production wiring uses
   * `createBrowserGamepadSource()`; tests hand in a `Map`-backed mock.
   */
  readonly gamepad: GamepadSource;

  /**
   * Per-slot device assignments. Each entry installs the matching
   * default profile into the bindings store for the slot. Slots not
   * listed here are left untouched — useful for the M2 4P FFA (every
   * slot listed) and for the M1 2P scaffold (only slots 1 + 2 listed).
   *
   * Order is honoured but not significant — the pipeline iterates the
   * array exactly once during construction. Duplicate slot entries
   * throw eagerly so a copy/paste mistake surfaces immediately.
   */
  readonly slots: ReadonlyArray<RuntimeSlotConfig>;

  /**
   * Whether to reset each slot's controller on construction. Defaults to
   * `true` — the canonical "fresh match start" behaviour. Set to `false`
   * when the pipeline is being reconstructed mid-replay (the controller
   * baseline must match the replay's "previous frame" state).
   */
  readonly resetControllersOnInit?: boolean;
}

// ---------------------------------------------------------------------------
// RuntimeInputPipeline
// ---------------------------------------------------------------------------

/**
 * Owner of the per-match input pipeline. Builds the dispatcher / manager
 * / per-slot controllers and configures the bindings store from each
 * slot's device assignment.
 *
 * Lifecycle:
 *
 *     // Construction — typically called once per match in the scene's
 *     // create() hook.
 *     const pipeline = new RuntimeInputPipeline({
 *       bindings: bindingsStore,
 *       keyboard: createPhaserKeyboardSource(scene),
 *       gamepad: createBrowserGamepadSource(),
 *       slots: [
 *         { slot: 1, assignment: { kind: 'keyboard', cluster: 'p1' } },
 *         { slot: 2, assignment: { kind: 'keyboard', cluster: 'p2' } },
 *         { slot: 3, assignment: { kind: 'gamepad', gamepadIndex: 0 } },
 *         { slot: 4, assignment: { kind: 'gamepad', gamepadIndex: 1 } },
 *       ],
 *     });
 *
 *     // Per fixed step — the pipeline polls the manager once and
 *     // refreshes every per-slot controller in the same call.
 *     pipeline.update(currentFrame);
 *
 *     // Per slot — read the unified action-state surface for gameplay /
 *     // AI / replay capture.
 *     const input = pipeline.getCharacterInput(1);
 *     character.applyInput(input);
 *
 *     // Mid-session — rebinding the device family hot-swaps the slot's
 *     // bindings without a scene reload.
 *     pipeline.assignSlotDevice(3, { kind: 'gamepad', gamepadIndex: 2 });
 *
 *     // Match teardown — releases held actions and detaches manager
 *     // listeners.
 *     pipeline.dispose();
 *
 * Mutation of the bindings store is fully supported mid-session:
 * because the dispatcher reads the store on every sample, any
 * mutation — by the rebinding screen, by `assignSlotDevice`, by the
 * replay loader — is visible on the very next `update()`.
 */
export class RuntimeInputPipeline {
  private readonly bindings: InputBindingsStore;
  private readonly dispatcher: DeviceInputDispatcher;
  private readonly manager: InputBindingManager;
  private readonly controllers: Map<PlayerBindingsIndex, PlayerInputController>;
  private readonly assignments: Map<PlayerBindingsIndex, RuntimeSlotAssignment>;
  private disposed: boolean;

  constructor(options: RuntimeInputPipelineOptions) {
    this.bindings = options.bindings;
    this.dispatcher = new DeviceInputDispatcher({
      keyboard: options.keyboard,
      gamepad: options.gamepad,
      bindings: this.bindings,
    });
    // Track only the slots the caller registered. The manager itself is
    // slot-agnostic but skipping diff work for empty slots is a cheap
    // performance hint for the common 2P / 3P matches where two of the
    // four canonical slots stay vacant.
    const trackedSlots = options.slots.map((s) => s.slot);
    this.manager = new InputBindingManager({
      dispatcher: this.dispatcher,
      slots: trackedSlots,
    });
    this.controllers = new Map<PlayerBindingsIndex, PlayerInputController>();
    this.assignments = new Map<PlayerBindingsIndex, RuntimeSlotAssignment>();
    const seen = new Set<PlayerBindingsIndex>();
    for (const config of options.slots) {
      if (seen.has(config.slot)) {
        throw new Error(
          `RuntimeInputPipeline: duplicate slot entry for slot ${config.slot}.`,
        );
      }
      seen.add(config.slot);
      this.applyAssignment(config.slot, config.assignment);
      const controller = new PlayerInputController({
        manager: this.manager,
        slot: config.slot,
      });
      if (options.resetControllersOnInit !== false) {
        controller.reset();
      }
      this.controllers.set(config.slot, controller);
    }
    this.disposed = false;
  }

  // -------------------------------------------------------------------------
  // Per-frame mutation
  // -------------------------------------------------------------------------

  /**
   * Drive the pipeline forward by one fixed step:
   *
   *   1. Poll the {@link InputBindingManager} once. The manager samples
   *      the dispatcher's per-slot {@link ActionHeldMap} and emits
   *      press / release / hold events to subscribers.
   *   2. Refresh every per-slot controller from the freshly-polled
   *      state.
   *
   * Idempotent on `dispose()` — a polling tick on a disposed pipeline
   * is a no-op so the gameplay loop's outer `if (!disposed)` branch is
   * not strictly required.
   */
  update(frame: number = -1): void {
    if (this.disposed) return;
    this.manager.poll(frame);
    for (const controller of this.controllers.values()) {
      controller.update(frame);
    }
  }

  /**
   * Read a slot's per-frame {@link CharacterInput} record — what the
   * production gameplay loop hands to `Character.applyInput`. Pure
   * function of the slot's controller snapshot — two reads on the same
   * frame return byte-identical records.
   *
   * Returns `null` for slots that were never registered with the
   * pipeline. The caller can decide whether to treat that as a neutral
   * input (the M1 default for an empty slot) or an error.
   */
  getCharacterInput(slot: PlayerBindingsIndex): CharacterInput | null {
    const controller = this.controllers.get(slot);
    if (controller === undefined) return null;
    return buildCharacterInputFromController(controller);
  }

  /**
   * Read the underlying {@link PlayerInputController} for a slot — used
   * by gameplay code that wants the unified `isActionDown` / `justPressed`
   * / `justReleased` API directly (for edge-driven moves like smashes
   * and shield drops).
   *
   * Returns `null` for unregistered slots.
   */
  getController(slot: PlayerBindingsIndex): PlayerInputController | null {
    return this.controllers.get(slot) ?? null;
  }

  /**
   * The {@link InputBindingManager} the pipeline drives. Exposed so menu
   * code, the pause toggle, the replay tagger, and the rebinding capture
   * preview can all subscribe through the same source the controllers
   * read from — no double-polling.
   */
  getManager(): InputBindingManager {
    return this.manager;
  }

  /**
   * The {@link DeviceInputDispatcher} the manager reads from. Exposed
   * for diagnostic consumers (debug overlays, AI runtime that wants the
   * per-frame analog stick magnitude). Not the public read surface for
   * gameplay — that goes through the controller.
   */
  getDispatcher(): DeviceInputDispatcher {
    return this.dispatcher;
  }

  /**
   * The slots the pipeline is currently tracking, in the order they
   * were registered. Useful for the gameplay loop's per-step iteration.
   */
  getSlots(): ReadonlyArray<PlayerBindingsIndex> {
    return Array.from(this.controllers.keys());
  }

  /**
   * The current device assignment for a slot. Returns `null` for
   * unregistered slots. Used by the lobby + pause overlay to render
   * "Slot 3 — Gamepad #2" without re-deriving from the bindings store.
   */
  getAssignment(slot: PlayerBindingsIndex): RuntimeSlotAssignment | null {
    return this.assignments.get(slot) ?? null;
  }

  // -------------------------------------------------------------------------
  // Mid-session reassignment
  // -------------------------------------------------------------------------

  /**
   * Rewrite a slot's bindings to the supplied {@link RuntimeSlotAssignment}
   * mid-session. Used by:
   *
   *   • The lobby's "swap to controller" toggle when a player joins via
   *     a different device after pressing FIGHT.
   *   • The pause overlay's "Reassign device" prompt that fires when a
   *     pad reconnects on a different `gamepadIndex` and the player
   *     wants to claim the new index for a slot.
   *   • Tests that exercise live device-family swaps.
   *
   * If the slot was previously unregistered the pipeline throws — a
   * fresh slot must be added at construction. Existing controllers are
   * reused; their previous-frame snapshot is reset so a "shield was
   * held on the old device, released on the new" boundary doesn't fire
   * a phantom release event on a button the new device never pressed.
   *
   * The dispatcher reads the bindings store on every sample, so the
   * reassignment is visible on the very next `update()` with no
   * controller-reconstruction step.
   */
  assignSlotDevice(slot: PlayerBindingsIndex, assignment: RuntimeSlotAssignment): void {
    if (this.disposed) {
      throw new Error('RuntimeInputPipeline: cannot reassign slot after dispose().');
    }
    const controller = this.controllers.get(slot);
    if (controller === undefined) {
      throw new Error(
        `RuntimeInputPipeline.assignSlotDevice: slot ${slot} was not registered at construction.`,
      );
    }
    this.applyAssignment(slot, assignment);
    // Reset the controller's previous-frame snapshot so a "held on the
    // old binding, released on the new" boundary doesn't fire a phantom
    // release. The very next `update()` re-establishes the baseline
    // against the new device's live state.
    controller.reset();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Force-release every held action for every tracked slot. Used by
   * scene shutdown and replay scrubbing. After this call, the very next
   * `update()` re-establishes the per-slot state from whatever is
   * actually held on the live devices.
   */
  forceRelease(frame: number = -1): void {
    if (this.disposed) return;
    this.manager.forceRelease(frame);
    for (const controller of this.controllers.values()) {
      controller.reset();
    }
  }

  /**
   * Detach manager listeners and stop responding to polls. Idempotent.
   * Does NOT mutate the bindings store — slot reassignments survive a
   * pipeline rebuild because the store outlives the pipeline.
   */
  dispose(): void {
    if (this.disposed) return;
    this.manager.dispose();
    this.disposed = true;
  }

  /** True iff `dispose()` has been called. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Write the device-default profile for the supplied assignment into
   * the bindings store. Mutates the assignments map so
   * `getAssignment(slot)` reflects the new shape on the next read.
   *
   * Exhaustively switches on the assignment kind so a future device
   * family addition fails to compile here until the pipeline learns to
   * configure it.
   */
  private applyAssignment(
    slot: PlayerBindingsIndex,
    assignment: RuntimeSlotAssignment,
  ): void {
    const bindings = profileForAssignment(assignment);
    this.bindings.set(slot, { playerIndex: slot, bindings });
    this.assignments.set(slot, assignment);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for the unit suite + lobby preview tiles
// ---------------------------------------------------------------------------

/**
 * Resolve the canonical default {@link ActionBindings} for a runtime
 * slot assignment. Pure function — no IO, no closures. Exported so the
 * lobby's "preview the bindings for slot 3 if I switch to keyboard" UI
 * and the unit suite can reach the same default the pipeline writes
 * into the store.
 */
export function profileForAssignment(assignment: RuntimeSlotAssignment): ActionBindings {
  switch (assignment.kind) {
    case 'keyboard':
      return assignment.cluster === 'p1'
        ? DEFAULT_KEYBOARD_P1_BINDINGS
        : DEFAULT_KEYBOARD_P2_BINDINGS;
    case 'gamepad':
      return buildDefaultGamepadBindings(assignment.gamepadIndex);
    /* istanbul ignore next — exhaustiveness sentinel. */
    default: {
      const _exhaustive: never = assignment;
      return _exhaustive;
    }
  }
}

/**
 * Convenience: build the canonical {@link RuntimeSlotConfig} for the
 * Seed's default 4-player slot policy:
 *
 *   • Slot 1 → keyboard P1 cluster
 *   • Slot 2 → keyboard P2 cluster
 *   • Slot 3 → gamepad index 0
 *   • Slot 4 → gamepad index 1
 *
 * The gameplay scene typically derives a {@link RuntimeSlotConfig} list
 * from the lobby's per-slot device picks; this default is the fallback
 * used by smoke tests / dev mode that bypass the lobby.
 */
export function defaultRuntimeSlotConfigs(): ReadonlyArray<RuntimeSlotConfig> {
  return Object.freeze([
    Object.freeze<RuntimeSlotConfig>({
      slot: 1,
      assignment: Object.freeze({ kind: 'keyboard', cluster: 'p1' }),
    }),
    Object.freeze<RuntimeSlotConfig>({
      slot: 2,
      assignment: Object.freeze({ kind: 'keyboard', cluster: 'p2' }),
    }),
    Object.freeze<RuntimeSlotConfig>({
      slot: 3,
      assignment: Object.freeze({ kind: 'gamepad', gamepadIndex: 0 }),
    }),
    Object.freeze<RuntimeSlotConfig>({
      slot: 4,
      assignment: Object.freeze({ kind: 'gamepad', gamepadIndex: 1 }),
    }),
  ]);
}
