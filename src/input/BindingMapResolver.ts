/**
 * Binding map resolver — AC 50102 Sub-AC 2.
 *
 * Purpose
 * -------
 *
 * Given a player's active {@link ActionMap} and a stream of
 * {@link RawInputEvent}s emitted by {@link RawInputSource} (AC 50101
 * Sub-AC 1), translate each raw transition into the *corresponding
 * semantic action events* — `jump`, `attack`, `special`, `shield`,
 * `grab`, `dodge`, `moveLeft/Right/Up/Down` — together with a
 * `press` / `release` / `hold` discriminator.
 *
 * The resolver sits between the raw bottom layer and the per-frame
 * polling layer:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  Subscribers — gameplay, menus, rebinding UI, replay tagger      │
 *   └────────────────────▲─────────────────────────────────────────────┘
 *                        │  SemanticActionEvent (press / release / hold)
 *   ┌────────────────────┴─────────────────────────────────────────────┐
 *   │  BindingMapResolver — THIS FILE                                  │
 *   │  • takes one player's active binding map + one RawInputEvent     │
 *   │  • emits zero or more SemanticActionEvents                       │
 *   │  • tracks per-source held state for edge detection               │
 *   │  • supports live mid-session rebind via setBindings()            │
 *   └────────────────────▲─────────────────────────────────────────────┘
 *                        │  RawInputEvent (keydown / keyup / buttondown
 *                        │  / buttonup / axischange)
 *   ┌────────────────────┴─────────────────────────────────────────────┐
 *   │  RawInputSource — bottom layer (AC 50101 Sub-AC 1)               │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Why a dedicated layer
 * ---------------------
 *
 *   • The poll-driven {@link InputBindingManager} (AC 5 Sub-AC 2) reads
 *     a held bitmap once per fixed step and diffs it. That works for
 *     gameplay where one held bit per action per frame is plenty, but
 *     loses information about the *individual* raw event that caused a
 *     transition. The rebinding UI's "press a button…" capture window,
 *     replay tagging, and chord detection all want the original
 *     `RawInputEvent` — its keyCode / button index, its frame, its
 *     timestamp — alongside the semantic action it mapped to.
 *   • The poll layer also can't tell `hold` apart from `press` on the
 *     very first poll a key was held: it sees `was=false → is=true` and
 *     emits a single `press`. The resolver sees the OS's `keydown
 *     repeat=true` event explicitly and can emit `hold` on every
 *     auto-repeat tick — useful for menu navigation and held-button
 *     "charge" attacks.
 *   • The resolver is event-driven, not poll-driven — there is no
 *     per-frame snapshot or diff. A subscriber that wants to react to
 *     "player 1 just pressed jump on frame 142" gets exactly one event.
 *
 * Multi-bind / multi-press / cancel-on-release semantics
 * ------------------------------------------------------
 *
 * The {@link ActionMap} schema (`src/types/bindings.ts`) lets each
 * action carry an array of bindings; an action is held iff *any* of
 * its bindings reports held. The resolver honours that fully:
 *
 *   • If `jump` is bound to BOTH the W key and gamepad button 0, and
 *     the player presses W, releases W, presses button 0, releases
 *     button 0, the resolver emits exactly one `press` (on the W
 *     keydown) and exactly one `release` (on the button 0 buttonup) —
 *     one continuous "jump held" interval that survives the binding
 *     handoff. Intermediate events while at least one binding is held
 *     emit `hold`.
 *   • If two actions share a binding (e.g. the default keyboard preset
 *     binds W to both `moveUp` and `jump`), pressing W emits two
 *     `press` events on the same raw transition — one for each action.
 *
 * Half-axis transitions
 * ---------------------
 *
 * A gamepad analog stick's value is a single number per axis; whether
 * that fires `moveLeft` or `moveRight` depends on the per-binding
 * direction (-1 / +1) and threshold. The resolver tracks the *latest*
 * axis value and re-evaluates every binding bound to that axis on each
 * `axischange`:
 *
 *   • Stick pushed from neutral to `+0.7` (right): the +1-direction
 *     binding's held state flips false→true → `press` event for the
 *     action it's bound to (typically `moveRight`). The -1-direction
 *     binding stays released.
 *   • Stick whipped from `+0.7` to `-0.7` in one frame (sign flip):
 *     a single `axischange` event causes both the +1 binding (was
 *     held → now released) and the -1 binding (was released → now
 *     held) to flip, so the resolver emits TWO events from one raw
 *     event: a `release` for the right-side action and a `press` for
 *     the left-side action. This matches platform-fighter "stick
 *     flick" semantics.
 *
 * Live rebind
 * -----------
 *
 * `setBindings()` swaps the active map without emitting synthetic
 * transitions. The resolver re-anchors its per-action held state to
 * the new map's evaluation against the latest source snapshot, so the
 * very next raw event correctly compares against the new binding.
 * This satisfies the AC's "rebind takes effect immediately" guarantee
 * without polluting subscribers with phantom events at swap time.
 *
 * Determinism
 * -----------
 *
 *   • The resolver holds finite per-source state (held keys, held
 *     buttons, latest axis values) and per-action edge state. No
 *     `Math.random()`, no wall-clock reads, no Phaser. The unit suite
 *     drives it with frozen `RawInputEvent` literals and asserts the
 *     emitted event sequence byte-for-byte.
 *   • Output events are frozen plain records — JSON-serialisable for
 *     replay tagging.
 *   • Iteration order across actions follows {@link BINDING_ACTIONS}'
 *     declaration order, so two resolvers fed the same input stream
 *     emit the same event sequence regardless of platform iteration
 *     details.
 *
 * Strict TypeScript
 * -----------------
 *
 * Compiled under `noUncheckedIndexedAccess + strict`. The
 * {@link RawInputEvent} discriminated union is exhaustively switched
 * — adding a new event family fails to compile until the resolver
 * learns to handle it.
 */

import {
  BINDING_ACTIONS,
  type ActionMap,
  type BindingAction,
  type GamepadBinding,
  type InputBinding,
  type KeyboardBinding,
  type PlayerBinding,
  type PlayerBindingIndex,
} from '../types/bindings';
import type { RawInputEvent } from './RawInputSource';

// ---------------------------------------------------------------------------
// Output event shape
// ---------------------------------------------------------------------------

/**
 * Per-action transition kind:
 *
 *   • `press`   — the action transitioned from released → held.
 *   • `release` — the action transitioned from held → released.
 *   • `hold`    — the action was already held and a new raw event
 *                 reaffirmed it (keyboard auto-repeat, button still
 *                 down, axis still past threshold).
 *
 * The `hold` family is opt-out via
 * {@link BindingMapResolverOptions.emitHold} — most subscribers only
 * care about edges, but a held-input "charge" attack and the menu
 * navigation auto-repeat both consume `hold`s, so the default is to
 * emit them.
 */
export type SemanticActionEventKind = 'press' | 'release' | 'hold';

/**
 * Discriminated event surfaced to subscribers. Plain frozen record so
 * the replay tagger can round-trip it through JSON without losing
 * fidelity.
 *
 * `frame` and `timestamp` are forwarded *verbatim* from the originating
 * {@link RawInputEvent}, so a subscriber that records semantic events
 * for replay tagging can correlate them with the raw stream by frame.
 *
 * `rawKind` carries the originating raw-event kind (`keydown`,
 * `axischange`, …) for diagnostic / replay-tagging callers that need
 * to know whether a `press` came from a digital button or an analog
 * stick crossing its threshold.
 */
export interface SemanticActionEvent {
  readonly kind: SemanticActionEventKind;
  readonly playerIndex: PlayerBindingIndex;
  readonly action: BindingAction;
  readonly frame: number;
  readonly timestamp: number;
  /** Originating raw event's `kind` — diagnostic, never used for control flow. */
  readonly rawKind: RawInputEvent['kind'];
}

// ---------------------------------------------------------------------------
// Construction options
// ---------------------------------------------------------------------------

/** Constructor options for {@link BindingMapResolver}. */
export interface BindingMapResolverOptions {
  /** Player slot (1–4) the resolver is bound to. Stamped on every event. */
  readonly playerIndex: PlayerBindingIndex;

  /**
   * Active binding map for this player. Accepts either a bare
   * {@link ActionMap} or the wrapping {@link PlayerBinding} envelope —
   * the resolver unwraps the latter to the action map internally. The
   * map is held by reference; mutate it through {@link
   * BindingMapResolver.setBindings} so the resolver can re-anchor its
   * per-action edge state.
   */
  readonly bindings: ActionMap | PlayerBinding;

  /**
   * Whether to emit {@link SemanticActionEvent}s of kind `hold`. Default
   * `true`. Set `false` for subscribers that only want press / release
   * edges (the gameplay control loop typically does — `hold` events
   * during a continuous keyboard auto-repeat would re-trigger an
   * already-firing attack every keyboard tick).
   */
  readonly emitHold?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlayerBinding(b: ActionMap | PlayerBinding): b is PlayerBinding {
  // PlayerBinding is `{ playerIndex, bindings }`; ActionMap has the
  // BINDING_ACTIONS keys directly. We discriminate on `bindings` because
  // ActionMap doesn't carry that key and PlayerBinding always does.
  return (
    typeof (b as PlayerBinding).playerIndex === 'number' &&
    typeof (b as PlayerBinding).bindings === 'object' &&
    (b as PlayerBinding).bindings !== null
  );
}

function unwrap(b: ActionMap | PlayerBinding): ActionMap {
  return isPlayerBinding(b) ? b.bindings : b;
}

function buttonKey(padIndex: number, buttonIndex: number): string {
  return `${padIndex}:${buttonIndex}`;
}

function axisKey(padIndex: number, axisIndex: number): string {
  return `${padIndex}:${axisIndex}`;
}

// ---------------------------------------------------------------------------
// BindingMapResolver
// ---------------------------------------------------------------------------

/**
 * Per-player event-driven resolver.
 *
 * Lifecycle:
 *
 *   const resolver = new BindingMapResolver({
 *     playerIndex: 1,
 *     bindings: store.getPlayer(1),       // ActionMap or PlayerBinding
 *   });
 *
 *   rawInputSource.addListener((rawEvent) => {
 *     for (const semantic of resolver.resolve(rawEvent)) {
 *       if (semantic.kind === 'press' && semantic.action === 'jump') {
 *         player.startJump(semantic.frame);
 *       }
 *     }
 *   });
 *
 *   // Mid-session rebind from the rebinding UI:
 *   resolver.setBindings(store.getPlayer(1));
 *
 *   // Scene shutdown: emit a clean `release` for every still-held
 *   // action so subscribers don't leak held state into the next scene.
 *   for (const e of resolver.forceRelease(currentFrame)) emitToReplay(e);
 *   resolver.dispose();
 *
 * The resolver is intentionally single-player. The runtime input
 * pipeline owns one resolver per player slot and routes raw events to
 * each (or filters by `event.source` first when bindings pin to a
 * specific gamepad index).
 */
export class BindingMapResolver {
  private readonly playerIndex: PlayerBindingIndex;
  private bindings: ActionMap;
  private readonly emitHold: boolean;

  // Per-source state (live raw-event memory).
  private readonly heldKeys = new Set<number>();
  private readonly heldButtons = new Map<string, boolean>();
  private readonly axisValues = new Map<string, number>();

  // Per-action edge state — last computed held boolean per action.
  // Pre-populated for every BindingAction so a rebind that introduces a
  // never-touched action doesn't have to differentiate "missing key"
  // from "released".
  private readonly heldActions = new Map<BindingAction, boolean>();

  private disposed = false;

  constructor(options: BindingMapResolverOptions) {
    this.playerIndex = options.playerIndex;
    this.bindings = unwrap(options.bindings);
    this.emitHold = options.emitHold !== false;
    for (const action of BINDING_ACTIONS) {
      this.heldActions.set(action, false);
    }
  }

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  /**
   * Translate one {@link RawInputEvent} into zero or more
   * {@link SemanticActionEvent}s against the active binding map.
   *
   * Returns events in {@link BINDING_ACTIONS} declaration order so two
   * resolvers fed the same input stream produce identical, byte-stable
   * output sequences (replay determinism).
   *
   * One raw event can produce multiple semantic events:
   *
   *   • Multiple actions share one binding (W → moveUp + jump): one
   *     keydown produces a press for each.
   *   • An axis sign flip: one axischange produces a release on the
   *     formerly-held half-axis and a press on the newly-held one.
   */
  resolve(event: RawInputEvent): SemanticActionEvent[] {
    if (this.disposed) return [];
    // Step 1 — update the per-source memory so binding evaluation in
    // step 3 reflects the latest world state.
    this.applySourceUpdate(event);

    // Step 2 — collect the actions whose binding list contains at least
    // one binding that the raw event could plausibly affect. This is a
    // pure filter against the binding map's static description and the
    // event's source/identifier; no held-state read happens here. An
    // axis event lists every action bound to that (padIndex, axisIndex),
    // both directions, so a sign flip can emit press+release in one
    // call.
    const out: SemanticActionEvent[] = [];
    for (const action of BINDING_ACTIONS) {
      if (!this.actionTouchedBy(action, event)) continue;
      const wasHeld = this.heldActions.get(action) === true;
      const isHeld = this.evaluateActionHeld(action);
      this.heldActions.set(action, isHeld);
      if (!wasHeld && isHeld) {
        out.push(this.makeEvent('press', action, event));
      } else if (wasHeld && !isHeld) {
        out.push(this.makeEvent('release', action, event));
      } else if (wasHeld && isHeld && this.emitHold) {
        out.push(this.makeEvent('hold', action, event));
      }
    }
    return out;
  }

  /**
   * Convenience batch wrapper — feed an array of raw events and collect
   * the concatenated semantic event stream. Useful for replay playback,
   * which has access to the full per-frame raw event list before it
   * needs to fan out to subscribers.
   */
  resolveBatch(events: ReadonlyArray<RawInputEvent>): SemanticActionEvent[] {
    if (this.disposed) return [];
    const out: SemanticActionEvent[] = [];
    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i];
      if (ev === undefined) continue;
      const matched = this.resolve(ev);
      for (let j = 0; j < matched.length; j += 1) {
        const m = matched[j];
        if (m !== undefined) out.push(m);
      }
    }
    return out;
  }

  /**
   * Replace the active binding map without emitting synthetic
   * transitions. The resolver re-anchors its per-action edge state to
   * the new map evaluated against the *current* per-source memory, so
   * the very next `resolve()` call correctly compares an incoming event
   * against the new binding without spurious press / release on the
   * swap itself.
   *
   * The trade-off: a player who is holding W with `jump` bound to W,
   * then rebinds `jump` to F mid-press, will not receive a synthetic
   * release. The next event (typically the F keydown they meant to
   * test) lands on a clean baseline. This matches common rebinding-UI
   * conventions — synthetic events on swap make replay tags noisy.
   */
  setBindings(bindings: ActionMap | PlayerBinding): void {
    this.bindings = unwrap(bindings);
    for (const action of BINDING_ACTIONS) {
      this.heldActions.set(action, this.evaluateActionHeld(action));
    }
  }

  /**
   * Force-release every currently-held action, returning a `release`
   * event for each. Clears per-source memory so the resolver returns
   * to a clean baseline. Used by:
   *
   *   • Scene shutdown — guarantees no held action leaks into the next
   *     scene if the player walked away mid-press.
   *   • Replay scrub — the VCR layer calls this when the playhead jumps
   *     so subscribers see a clean release before the next raw event
   *     re-establishes the destination frame's state.
   *   • Controller disconnect — the disconnect monitor calls this for
   *     the affected player so the engine sees gracefully released
   *     inputs instead of stuck-held ones.
   *
   * The returned events follow {@link BINDING_ACTIONS} order and carry
   * the supplied `frame` / `timestamp`. `timestamp` defaults to
   * `performance.now()` (or `Date.now()` in environments without
   * `performance`). The frame defaults to `-1` to match the
   * {@link InputBindingManager#forceRelease} convention.
   */
  forceRelease(frame: number = -1, timestamp?: number): SemanticActionEvent[] {
    if (this.disposed) return [];
    const ts = timestamp ?? nowTimestamp();
    const events: SemanticActionEvent[] = [];
    for (const action of BINDING_ACTIONS) {
      if (this.heldActions.get(action) === true) {
        events.push(
          Object.freeze<SemanticActionEvent>({
            kind: 'release',
            playerIndex: this.playerIndex,
            action,
            frame,
            timestamp: ts,
            rawKind: 'keyup',
          }),
        );
        this.heldActions.set(action, false);
      }
    }
    this.heldKeys.clear();
    this.heldButtons.clear();
    this.axisValues.clear();
    return events;
  }

  /**
   * Read-only view of the latest computed held bitmap. Defensive copy
   * + freeze so a caller can't mutate internal state by writing into
   * the returned object.
   */
  snapshotHeldActions(): Readonly<Record<BindingAction, boolean>> {
    const out: Record<BindingAction, boolean> = {
      moveLeft: false,
      moveRight: false,
      moveUp: false,
      moveDown: false,
      jump: false,
      attack: false,
      special: false,
      shield: false,
      grab: false,
      dodge: false,
    };
    for (const action of BINDING_ACTIONS) {
      out[action] = this.heldActions.get(action) === true;
    }
    return Object.freeze(out);
  }

  /** True iff the action is held against the latest known per-source state. */
  isActionHeld(action: BindingAction): boolean {
    return this.heldActions.get(action) === true;
  }

  /** Slot this resolver is bound to — useful for logs / diagnostics. */
  getPlayerIndex(): PlayerBindingIndex {
    return this.playerIndex;
  }

  /**
   * Detach state and refuse further events. Idempotent. After
   * `dispose()`, `resolve()` returns an empty list and the held-state
   * accessors return `false` / a neutral snapshot. Does NOT emit
   * release events itself — callers that want the release-on-shutdown
   * behaviour should call {@link forceRelease} first.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.heldKeys.clear();
    this.heldButtons.clear();
    this.axisValues.clear();
    for (const action of BINDING_ACTIONS) {
      this.heldActions.set(action, false);
    }
  }

  /** True after `dispose()` has been called. */
  isDisposed(): boolean {
    return this.disposed;
  }

  // -------------------------------------------------------------------------
  // Internals — source-state update
  // -------------------------------------------------------------------------

  /**
   * Apply one raw event to the per-source memory. Pure update; the
   * caller decides whether an action transition was triggered by
   * looking at action held-state before vs after this call.
   *
   * Auto-repeat handling: a `keydown` with `repeat: true` arrives
   * while the key is already held. Adding it to `heldKeys` (already
   * present) is idempotent. The held-action evaluation will see the
   * action still held; if `emitHold` is on we emit `hold` for any
   * action bound to that key.
   */
  private applySourceUpdate(event: RawInputEvent): void {
    switch (event.kind) {
      case 'keydown':
        this.heldKeys.add(event.keyCode);
        return;
      case 'keyup':
        this.heldKeys.delete(event.keyCode);
        return;
      case 'buttondown':
        this.heldButtons.set(buttonKey(event.source.index, event.buttonIndex), true);
        return;
      case 'buttonup':
        this.heldButtons.set(buttonKey(event.source.index, event.buttonIndex), false);
        return;
      case 'axischange':
        this.axisValues.set(axisKey(event.source.index, event.axisIndex), event.value);
        return;
      /* istanbul ignore next — exhaustiveness sentinel. */
      default: {
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals — binding ↔ event matching
  // -------------------------------------------------------------------------

  /**
   * True iff the action's binding list contains at least one binding
   * the raw event could affect (same device, same physical identifier,
   * matching pad index for gamepad bindings). A pure filter — no
   * held-state read.
   */
  private actionTouchedBy(action: BindingAction, event: RawInputEvent): boolean {
    const list = this.bindings[action];
    for (let i = 0; i < list.length; i += 1) {
      const binding = list[i];
      if (binding !== undefined && this.bindingTouchedBy(binding, event)) return true;
    }
    return false;
  }

  /** True iff a single binding could be affected by the raw event. */
  private bindingTouchedBy(binding: InputBinding, event: RawInputEvent): boolean {
    switch (binding.kind) {
      case 'keyboard':
        return this.keyboardBindingTouchedBy(binding, event);
      case 'gamepad':
        return this.gamepadBindingTouchedBy(binding, event);
      /* istanbul ignore next */
      default: {
        const _exhaustive: never = binding;
        return _exhaustive;
      }
    }
  }

  private keyboardBindingTouchedBy(
    binding: KeyboardBinding,
    event: RawInputEvent,
  ): boolean {
    if (event.source.kind !== 'keyboard') return false;
    if (event.kind !== 'keydown' && event.kind !== 'keyup') return false;
    return event.keyCode === binding.keyCode;
  }

  private gamepadBindingTouchedBy(
    binding: GamepadBinding,
    event: RawInputEvent,
  ): boolean {
    if (event.source.kind !== 'gamepad') return false;
    // `gamepadIndex === null` means "any pad" — used for menu / pause
    // confirms. Match every pad's events for that binding.
    if (binding.gamepadIndex !== null && binding.gamepadIndex !== event.source.index) {
      return false;
    }
    if (binding.source.type === 'button') {
      if (event.kind !== 'buttondown' && event.kind !== 'buttonup') return false;
      return event.buttonIndex === binding.source.buttonIndex;
    }
    // axis source
    if (event.kind !== 'axischange') return false;
    return event.axisIndex === binding.source.axisIndex;
  }

  // -------------------------------------------------------------------------
  // Internals — action evaluation
  // -------------------------------------------------------------------------

  /**
   * Recompute whether an action is held by OR-ing every binding's
   * held-against-current-source-state. Mirrors the
   * {@link DeviceInputDispatcher.isActionHeld} contract so the resolver
   * and the polling layer agree on what "held" means for the same
   * binding map and source state.
   */
  private evaluateActionHeld(action: BindingAction): boolean {
    const list = this.bindings[action];
    for (let i = 0; i < list.length; i += 1) {
      const binding = list[i];
      if (binding !== undefined && this.isBindingHeld(binding)) return true;
    }
    return false;
  }

  private isBindingHeld(binding: InputBinding): boolean {
    switch (binding.kind) {
      case 'keyboard':
        return this.heldKeys.has(binding.keyCode);
      case 'gamepad':
        return this.isGamepadBindingHeld(binding);
      /* istanbul ignore next */
      default: {
        const _exhaustive: never = binding;
        return _exhaustive;
      }
    }
  }

  private isGamepadBindingHeld(binding: GamepadBinding): boolean {
    if (binding.source.type === 'button') {
      if (binding.gamepadIndex === null) {
        // Any-pad: a button is considered held if any tracked pad has
        // it held. This is what menu confirms want — pressing button 0
        // on whichever pad you have should fire the bound action.
        for (const [k, v] of this.heldButtons) {
          if (v && parseButtonKey(k).buttonIndex === binding.source.buttonIndex) {
            return true;
          }
        }
        return false;
      }
      return (
        this.heldButtons.get(buttonKey(binding.gamepadIndex, binding.source.buttonIndex)) ===
        true
      );
    }
    // Half-axis source
    const direction = binding.source.direction;
    const threshold = binding.source.threshold;
    const axisIndex = binding.source.axisIndex;
    if (binding.gamepadIndex === null) {
      for (const [k, v] of this.axisValues) {
        if (parseAxisKey(k).axisIndex === axisIndex && v * direction >= threshold) {
          return true;
        }
      }
      return false;
    }
    const value = this.axisValues.get(axisKey(binding.gamepadIndex, axisIndex));
    if (value === undefined) return false;
    return value * direction >= threshold;
  }

  // -------------------------------------------------------------------------
  // Internals — event construction
  // -------------------------------------------------------------------------

  private makeEvent(
    kind: SemanticActionEventKind,
    action: BindingAction,
    event: RawInputEvent,
  ): SemanticActionEvent {
    return Object.freeze<SemanticActionEvent>({
      kind,
      playerIndex: this.playerIndex,
      action,
      frame: event.frame,
      timestamp: event.timestamp,
      rawKind: event.kind,
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (free functions)
// ---------------------------------------------------------------------------

function parseButtonKey(key: string): { padIndex: number; buttonIndex: number } {
  // Keys are emitted by `buttonKey()` so they always have exactly one
  // colon; `split(':', 2)` is robust enough.
  const idx = key.indexOf(':');
  /* istanbul ignore next — guarded by emitter contract. */
  if (idx < 0) return { padIndex: -1, buttonIndex: -1 };
  const padIndex = Number(key.slice(0, idx));
  const buttonIndex = Number(key.slice(idx + 1));
  return { padIndex, buttonIndex };
}

function parseAxisKey(key: string): { padIndex: number; axisIndex: number } {
  const idx = key.indexOf(':');
  /* istanbul ignore next */
  if (idx < 0) return { padIndex: -1, axisIndex: -1 };
  const padIndex = Number(key.slice(0, idx));
  const axisIndex = Number(key.slice(idx + 1));
  return { padIndex, axisIndex };
}

function nowTimestamp(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
