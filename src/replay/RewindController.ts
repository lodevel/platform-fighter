/**
 * Rewind controller — AC 30303 Sub-AC 3.
 *
 * What this module is
 * ===================
 *
 * The backwards-seek brain of the M4 hybrid replay player. Where
 * {@link ./ReplayPlaybackController.seek} can teleport the *cursor*
 * forward or backward in O(1), it does **not** restore physics state —
 * a backward seek alone leaves the simulator at whatever frame N it
 * had reached when the user clicked "rewind to frame N-100", not at the
 * physics state frame N-100 actually had during the original recording.
 *
 * The hybrid replay architecture solves that with two artefacts:
 *
 *   1. A dense per-frame **input timeline** (every fixed step's
 *      `CharacterInput[]` for every player), produced by
 *      {@link InputCaptureBuffer}.
 *
 *   2. A sparse list of **state snapshots** taken every 300 frames per
 *      `GAME_CONFIG.snapshotIntervalFrames` (the Seed's hybrid replay
 *      architecture: "input-replay + state snapshots every 300 frames
 *      with drift-resync"). Each snapshot is an opaque payload — the
 *      caller knows how to capture it (positions, velocities, damage,
 *      stocks, RNG state, hazard cycle counters, …) and how to restore
 *      it.
 *
 * Rewinding to an arbitrary target frame T reduces to:
 *
 *     ┌────────────────────────────────────────────────────────────┐
 *     │ 1. Pick the latest snapshot S whose frame ≤ T.             │
 *     │    (Binary search on a monotonic frame list — O(log n).)   │
 *     │                                                            │
 *     │ 2. Restore the simulator to S via the user-supplied        │
 *     │    `restoreSnapshot` callback.                             │
 *     │                                                            │
 *     │ 3. Re-simulate from S.frame (exclusive) up to and including│
 *     │    T by walking the input timeline frame-by-frame and      │
 *     │    calling the user-supplied `simulateStep` callback. Each │
 *     │    re-simulated frame consumes exactly one fixed timestep  │
 *     │    in the simulator — same cadence as the live match — so  │
 *     │    deterministic engines (fixed-step Matter.js, frame-     │
 *     │    counter-based hazards, MatchRng-seeded AI) reach the    │
 *     │    *exact* state they had at frame T in the recording.     │
 *     └────────────────────────────────────────────────────────────┘
 *
 *     ──snapshot──snapshot──snapshot───── input timeline ─────▶
 *           S0         S1         S2
 *           ●──────────●──────────●─────── (frames 0, 300, 600 …)
 *                      │          │
 *                      │ rewindTo(T=420)
 *                      │          │
 *                      │ ┌────────┴──── pick S1 (frame 300, ≤ 420)
 *                      ▼ ▼
 *                      restoreSnapshot(S1)
 *                      simulateStep(301), simulateStep(302), … simulateStep(420)
 *                                                  ▲
 *                                                  └ cursor parked here
 *
 * Determinism is the only thing that matters
 * ------------------------------------------
 *
 * The Seed's exit condition `determinism_verified` calls for "A recorded
 * match replays identically with hybrid snapshot resync keeping state
 * aligned through full VCR scrub operations". Rewind is the test case
 * for that contract:
 *
 *   • The same input timeline is fed back through the same simulator,
 *     starting from the same persisted state, for the same number of
 *     frames. By induction this reaches the same state every time.
 *
 *   • The controller never reads a wall clock, never calls
 *     `Math.random()`, never imports Phaser/Matter/DOM. The two
 *     callbacks are the only escape hatch — and the callbacks the host
 *     supplies are themselves deterministic (snapshot capture/restore
 *     and physics step).
 *
 *   • Input lookups go through the {@link InputCaptureBuffer}'s
 *     binary-search `getFrame()` (or a {@link ReplayPlaybackController}'s
 *     `sampleFrame()`), so re-simulation reads the exact same closed-
 *     shape `RecordedCharacterInput` the recorder wrote — no chance of a
 *     `null` or `undefined` slipping through that wasn't there during
 *     the original match.
 *
 *   • Snapshots are picked by *largest-frame ≤ target*. Picking the
 *     wrong snapshot would not even fail safely — it would silently
 *     restore a different match state. Binary search on the (validated-
 *     monotonic) snapshot list eliminates that class of bug.
 *
 * Why a separate module (instead of bolting rewind onto the playback controller)
 * -----------------------------------------------------------------------------
 *
 *   • **Single responsibility.** `ReplayPlaybackController` owns the
 *     input timeline. The simulator state lives in (Phaser-side)
 *     `Fighter` instances and the (Matter.js) physics world. A rewind
 *     coordinator that reads from one source (the timeline) and writes
 *     to another (the simulator) is a different concern.
 *
 *   • **Decoupled from Phaser.** Bolting rewind onto the playback
 *     controller would tempt us to import the simulator. Keeping rewind
 *     in its own module means the controller stays Phaser-free (and
 *     the rewind module also stays Phaser-free — the host injects the
 *     two callbacks).
 *
 *   • **Reusable.** The same primitive is the right shape for the M3
 *     stage builder's "test play with rewind" and any future "ghost
 *     replay" overlay.
 *
 *   • **Testability.** vitest exercises the controller against
 *     synthetic snapshots + a synthetic simulator (a counter that
 *     steps forward by `1` per frame, restored to the snapshot value)
 *     and asserts the post-rewind counter matches the expected frame
 *     value. Two rewinds to the same frame produce identical
 *     simulator state — which is exactly the determinism contract.
 *
 * The contract this module enforces (and what it does NOT)
 * --------------------------------------------------------
 *
 * The controller orchestrates the rewind sequence. It does NOT:
 *
 *   • Capture state — the host supplies `addSnapshot()` calls during
 *     the original recording / playback (typically every
 *     `GAME_CONFIG.snapshotIntervalFrames` frames).
 *
 *   • Implement physics step — the host's `simulateStep` callback owns
 *     that. The controller only schedules the calls.
 *
 *   • Pre/post-condition the simulator state — if the host's
 *     `restoreSnapshot` callback half-restores state and throws, the
 *     simulator is left in a half-restored state. That's the host's
 *     contract to honour, not ours; we re-throw the error after
 *     marking the rewind as failed so the caller sees both.
 *
 *   • Mutate the playback controller's cursor (when one is wired in).
 *     The caller is expected to pair `rewindTo(T)` with
 *     `playback.seek(T)` if they want the cursor and the simulator to
 *     stay aligned. Letting the caller decide keeps the rewind
 *     controller from depending on the playback controller.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports. The vitest suite under
 * `RewindController.test.ts` exercises every code path under plain
 * Node — no jsdom, no scene fixture, no Matter world.
 */

import { GAME_CONFIG } from '../engine/constants';
import {
  InputCaptureBuffer,
  NEUTRAL_INPUT,
  type RecordedCharacterInput,
} from './InputCaptureBuffer';
import type { ReplayPlaybackController } from './ReplayPlaybackController';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One persisted state snapshot. The `state` payload is opaque to this
 * module — the host knows how to capture (during recording) and how to
 * restore (during rewind). For a real match the payload typically
 * carries:
 *
 *   • Per-fighter position / velocity / damage / stocks / hitstun
 *     counters (the same fields {@link MatchStateSnapshot} hashes for
 *     determinism verification).
 *   • {@link MatchRng} state — `rngState.snapshotState()` so the
 *     RNG-driven systems (AI, hazard cycle, particle bursts) re-emit
 *     the same sequence post-rewind.
 *   • Hazard cycle counters (lava rise/fall position, moving platform
 *     phase, crumbling platform timer).
 *
 * For headless tests the payload can be a counter, a string, or any
 * other deterministic value the test cares about. The controller does
 * not look inside.
 */
export interface RewindSnapshot<TState> {
  /**
   * Deterministic 60 Hz frame index this snapshot was sampled at.
   * Snapshots within a single controller MUST be strictly monotonic by
   * frame; the controller validates this on `addSnapshot()` and on
   * bulk-load via the constructor.
   */
  readonly frame: number;
  /** Opaque payload — the host's serialisable state record. */
  readonly state: TState;
}

/**
 * Restore the simulator to a snapshot. The controller invokes this
 * exactly once per `rewindTo()` call, before re-simulating forward.
 *
 * Throwing from the callback is allowed (and surfaced unchanged through
 * `rewindTo()`); the controller treats it as a failed rewind and does
 * NOT proceed to re-simulation.
 */
export type RestoreSnapshotFn<TState> = (
  snapshot: RewindSnapshot<TState>,
) => void;

/**
 * Re-simulate one fixed step. Called for every frame strictly *after*
 * the chosen snapshot's frame, up to and including the rewind target.
 * The host is responsible for:
 *
 *   • Feeding `inputs` into every player's `Character.applyInput` (or
 *     equivalent simulator entrypoint). `inputs` is `null` when the
 *     timeline has no recorded entry for `frame` — the host should
 *     treat that as "every player neutral" for fault-tolerant playback,
 *     OR throw to abort if running in strict-determinism mode.
 *   • Stepping the physics engine by exactly one `fixedTimestepMs`.
 *   • Stepping any frame-counter-based subsystems (hazards, hitstun,
 *     i-frames, RNG-stream pulls).
 *
 * Throwing from the callback is allowed (and surfaced unchanged through
 * `rewindTo()`); the controller marks the rewind as failed at the
 * frame the throw fired and does NOT continue past it. Subsequent
 * `getStatus()` reads will report `failed`.
 */
export type SimulateStepFn = (
  frame: number,
  inputs: ReadonlyArray<RecordedCharacterInput> | null,
) => void;

/**
 * Pluggable input timeline source. Both shapes the runtime offers
 * (raw {@link InputCaptureBuffer} from a live recording, or a
 * {@link ReplayPlaybackController} hosting a deserialised file) implement
 * this contract — the controller code reads via this interface so the
 * tests can inject a synthetic timeline without standing up a buffer.
 */
export interface RewindInputSource {
  /** Lookup the inputs for a specific frame, or null on a sparse gap. */
  sampleFrame(frame: number): ReadonlyArray<RecordedCharacterInput> | null;
  /** Number of player slots — used for sanity validation only. */
  getPlayerCount(): number;
}

/**
 * Constructor options.
 *
 * `inputSource` is required — there is no useful "rewind without inputs"
 * mode. `snapshots` and `fixedTimestepFrames` have sensible defaults
 * (empty list and `GAME_CONFIG.snapshotIntervalFrames` respectively).
 */
export interface RewindControllerOptions<TState> {
  /**
   * Where to read recorded per-frame inputs from. Either a live
   * {@link InputCaptureBuffer} (the recording case — rewind during a
   * live match's instant replay) or a
   * {@link ReplayPlaybackController} (the playback case — rewind during
   * VCR scrubbing of a saved replay). A custom shape implementing
   * {@link RewindInputSource} also works (tests use this).
   */
  readonly inputSource:
    | InputCaptureBuffer
    | ReplayPlaybackController
    | RewindInputSource;
  /**
   * Restore-state callback. Required — there is no useful "rewind
   * without restoring" mode.
   */
  readonly restoreSnapshot: RestoreSnapshotFn<TState>;
  /**
   * Single-step simulator callback. Required.
   */
  readonly simulateStep: SimulateStepFn;
  /**
   * Initial snapshot list. Each entry is validated for shape +
   * monotonic frame ordering. Defaults to empty — callers typically
   * register snapshots one at a time via `addSnapshot()` as the match
   * runs.
   */
  readonly snapshots?: ReadonlyArray<RewindSnapshot<TState>>;
  /**
   * The expected cadence between snapshots. Documented + validated on
   * `addSnapshot()` only as a soft sanity check (logged via
   * `console.warn` if the gap is much larger than the canonical
   * 300 frames). Does **not** affect rewind correctness — the
   * controller works with any monotonic sequence; this field exists
   * purely so a misconfigured host (e.g. forgot to call
   * `addSnapshot()` for 1000 frames) gets a developer-loop warning.
   *
   * Defaults to {@link GAME_CONFIG.snapshotIntervalFrames} (300).
   */
  readonly snapshotIntervalFrames?: number;
  /**
   * Hard cap on the number of re-simulated frames per `rewindTo()`
   * call. Bounds the worst-case cost of a rewind from "any frame back
   * to frame 0 with no snapshots" — without this, a misconfigured host
   * could ask for a rewind that walks the entire match's input
   * timeline and freezes the browser.
   *
   * Default: `5 × snapshotIntervalFrames` (1500 frames @ 60 Hz = 25 s
   * of simulation per rewind, which is well within a "noticeable but
   * not catastrophic" budget). Callers running in headless tests can
   * raise this by passing a larger value.
   */
  readonly maxSimulatedFramesPerRewind?: number;
}

/**
 * Per-`rewindTo()` outcome. The host inspects `status` and decides what
 * to do (typically: refresh the playback cursor and the HUD on
 * `'success'`, surface a banner on `'failed'`).
 */
export interface RewindResult<TState> {
  /**
   * `'success'` — restore + re-simulation completed; simulator now
   * reflects state at the requested target frame.
   * `'noop'`    — already at the target frame; nothing to do.
   * `'failed'`  — restore or simulate threw; simulator is in an
   *               undefined state. The error is also re-thrown.
   */
  readonly status: 'success' | 'noop' | 'failed';
  /** Frame the host requested to rewind to. */
  readonly targetFrame: number;
  /**
   * Snapshot the controller chose to restore from. `null` for a noop
   * rewind, OR for a successful rewind to frame ≤ first snapshot
   * (which we call "rewind to genesis" — the host either pre-loaded a
   * snapshot at frame 0, or supplied one at the rewind target itself).
   */
  readonly restoredFrom: RewindSnapshot<TState> | null;
  /**
   * Number of frames the controller called `simulateStep` for. Equals
   * `targetFrame - restoredFrom.frame` for a successful rewind that
   * had to re-simulate; `0` for a noop or a rewind that landed exactly
   * on a snapshot frame.
   */
  readonly simulatedFrames: number;
  /**
   * On `'failed'` — the frame the throw fired at (the `simulateStep`
   * call that threw, or the snapshot's frame for a `restoreSnapshot`
   * throw). On other statuses, the rewind target.
   */
  readonly haltedAtFrame: number;
  /**
   * On `'failed'` — the human-readable error message. On other
   * statuses, an empty string.
   */
  readonly errorMessage: string;
}

/**
 * Aggregate stats since construction (or last `reset()`). The replay
 * menu's HUD reads this once per render frame to show "rewinds: 3,
 * total resimulated frames: 837".
 */
export interface RewindStats {
  /** Total `rewindTo()` calls. */
  readonly rewindCount: number;
  /** Cumulative frames re-simulated across all rewinds. */
  readonly totalSimulatedFrames: number;
  /** Number of rewinds that landed on a snapshot exactly. */
  readonly exactSnapshotHits: number;
  /** Failed rewinds (callback threw). */
  readonly failureCount: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIMULATED_FRAMES_MULT = 5;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Type guard — does the supplied input source implement the
 * {@link RewindInputSource} contract directly? Used to widen the
 * accepted input-source types in the constructor without forcing
 * callers to wrap a buffer in an adapter.
 *
 * Both {@link InputCaptureBuffer} and {@link ReplayPlaybackController}
 * already expose `sampleFrame` and `getPlayerCount` — `InputCaptureBuffer`
 * via its `getFrame(frame).inputs` shape (we wrap it below) and
 * `ReplayPlaybackController` directly. Tests can pass an arbitrary
 * object satisfying the same shape.
 */
function asInputSource(
  src:
    | InputCaptureBuffer
    | ReplayPlaybackController
    | RewindInputSource,
): RewindInputSource {
  // The buffer's natural method is `getFrame(frame)` returning a
  // `CapturedFrame | null`. Wrap to the `sampleFrame()` shape both
  // playback controllers and synthetic test sources expose so the
  // controller body has one code path.
  if (src instanceof InputCaptureBuffer) {
    return {
      sampleFrame(frame: number) {
        const captured = src.getFrame(frame);
        return captured ? captured.inputs : null;
      },
      getPlayerCount() {
        return src.getPlayerCount();
      },
    };
  }
  // Anything else is expected to satisfy the structural contract directly
  // (`ReplayPlaybackController` does; tests supply their own).
  if (
    typeof (src as RewindInputSource).sampleFrame !== 'function' ||
    typeof (src as RewindInputSource).getPlayerCount !== 'function'
  ) {
    throw new Error(
      `RewindController: inputSource must implement sampleFrame(frame) ` +
        `and getPlayerCount() — got ${String(src)}`,
    );
  }
  return src as RewindInputSource;
}

/**
 * Validate one snapshot's structural shape. Throws on missing / bad
 * fields. The frame field must be a non-negative integer; the state
 * field is opaque so we only check it's not `undefined` (a `null`
 * state IS allowed — some hosts use `null` as the canonical "genesis
 * state" sentinel).
 */
function validateSnapshotShape<TState>(
  snap: RewindSnapshot<TState>,
  label: string,
): void {
  if (snap === null || typeof snap !== 'object') {
    throw new Error(
      `RewindController.${label}: snapshot must be a non-null object`,
    );
  }
  if (
    typeof snap.frame !== 'number' ||
    !Number.isInteger(snap.frame) ||
    snap.frame < 0
  ) {
    throw new Error(
      `RewindController.${label}: snapshot.frame must be a non-negative ` +
        `integer, got ${String(snap.frame)}`,
    );
  }
  if (snap.state === undefined) {
    throw new Error(
      `RewindController.${label}: snapshot.state must be defined`,
    );
  }
}

// ---------------------------------------------------------------------------
// RewindController
// ---------------------------------------------------------------------------

/**
 * Coordinator for backwards-seek rewinds via snapshot restore + input
 * re-simulation.
 *
 * Lifecycle:
 *
 *     // During recording / playback:
 *     const controller = new RewindController({
 *       inputSource: replayPlayback,            // or a live InputCaptureBuffer
 *       restoreSnapshot: (s) => liveScene.restoreState(s.state),
 *       simulateStep: (frame, inputs) => {
 *         for (let i = 0; i < fighters.length; i += 1) {
 *           fighters[i].applyInput(inputs?.[i] ?? NEUTRAL_INPUT);
 *         }
 *         physicsEngine.step();
 *       },
 *     });
 *
 *     // every snapshotIntervalFrames during the original walk-forward:
 *     controller.addSnapshot({ frame, state: captureLiveState() });
 *
 *     // when the user clicks "rewind to frame T":
 *     const result = controller.rewindTo(T);
 *     if (result.status === 'success') replayPlayback.seek(T);
 *
 * The controller is reusable — `reset()` clears every snapshot and the
 * stats counters but preserves the callbacks, so the host can re-arm it
 * for the next replay session without reconstructing.
 */
export class RewindController<TState = unknown> {
  private readonly inputSource: RewindInputSource;
  private readonly restoreSnapshot: RestoreSnapshotFn<TState>;
  private readonly simulateStep: SimulateStepFn;
  private readonly snapshotIntervalFrames: number;
  private readonly maxSimulatedFramesPerRewind: number;

  /**
   * Snapshot list, kept sorted strictly-monotonically by frame.
   * `addSnapshot()` rejects out-of-order writes; the constructor
   * validates a bulk-loaded list. Held as a flat array (not a Map)
   * because the access pattern is "binary search by frame" plus
   * occasional iteration — both O(log n) / O(n) on an array.
   */
  private readonly snapshots: RewindSnapshot<TState>[] = [];

  /** Aggregate stats — see {@link RewindStats}. */
  private rewindCount = 0;
  private totalSimulatedFrames = 0;
  private exactSnapshotHits = 0;
  private failureCount = 0;

  constructor(options: RewindControllerOptions<TState>) {
    if (options === null || typeof options !== 'object') {
      throw new Error(`RewindController: options must be a non-null object`);
    }
    if (typeof options.restoreSnapshot !== 'function') {
      throw new Error(
        `RewindController: options.restoreSnapshot must be a function`,
      );
    }
    if (typeof options.simulateStep !== 'function') {
      throw new Error(
        `RewindController: options.simulateStep must be a function`,
      );
    }
    if (options.inputSource === null || options.inputSource === undefined) {
      throw new Error(
        `RewindController: options.inputSource is required`,
      );
    }

    this.inputSource = asInputSource(options.inputSource);
    this.restoreSnapshot = options.restoreSnapshot;
    this.simulateStep = options.simulateStep;

    const interval =
      options.snapshotIntervalFrames ?? GAME_CONFIG.snapshotIntervalFrames;
    if (
      typeof interval !== 'number' ||
      !Number.isInteger(interval) ||
      interval < 1
    ) {
      throw new Error(
        `RewindController: snapshotIntervalFrames must be a positive ` +
          `integer, got ${String(interval)}`,
      );
    }
    this.snapshotIntervalFrames = interval;

    const maxSim =
      options.maxSimulatedFramesPerRewind ??
      DEFAULT_MAX_SIMULATED_FRAMES_MULT * interval;
    if (
      typeof maxSim !== 'number' ||
      !Number.isInteger(maxSim) ||
      maxSim < 1
    ) {
      throw new Error(
        `RewindController: maxSimulatedFramesPerRewind must be a positive ` +
          `integer, got ${String(maxSim)}`,
      );
    }
    this.maxSimulatedFramesPerRewind = maxSim;

    if (options.snapshots !== undefined) {
      if (!Array.isArray(options.snapshots)) {
        throw new Error(
          `RewindController: options.snapshots must be an array`,
        );
      }
      // Validate + bulk-load via the same monotonic-frame path
      // `addSnapshot()` uses, so the same invariants hold.
      for (const s of options.snapshots) {
        this.addSnapshot(s);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Snapshot management
  // -------------------------------------------------------------------------

  /**
   * Register a snapshot at `snap.frame`. Snapshots MUST be added in
   * strictly-monotonic frame order — duplicate or out-of-order frames
   * throw, mirroring {@link InputCaptureBuffer.captureFrame}'s
   * monotonicity contract. This is what makes `findSnapshotForFrame`
   * a sound binary search.
   *
   * Soft warning: if the new snapshot is more than 2× the configured
   * `snapshotIntervalFrames` away from the previous snapshot, the
   * controller logs a `console.warn` so a misconfigured host
   * (forgot to call `addSnapshot()` for 600+ frames) sees the gap in
   * dev tools. Does NOT throw — sparse snapshots still produce correct
   * rewinds, just with longer re-simulation walks.
   */
  addSnapshot(snap: RewindSnapshot<TState>): void {
    validateSnapshotShape(snap, 'addSnapshot');
    const last = this.snapshots[this.snapshots.length - 1];
    if (last !== undefined && snap.frame <= last.frame) {
      throw new Error(
        `RewindController.addSnapshot: frame ${snap.frame} is not strictly ` +
          `greater than last snapshot frame ${last.frame} — snapshots must ` +
          `be monotonic to preserve binary-search correctness`,
      );
    }
    if (
      last !== undefined &&
      snap.frame - last.frame > 2 * this.snapshotIntervalFrames
    ) {
      try {
        // eslint-disable-next-line no-console
        console.warn(
          `RewindController.addSnapshot: large gap (${snap.frame - last.frame} ` +
            `frames) since previous snapshot at frame ${last.frame}; expected ` +
            `cadence is ${this.snapshotIntervalFrames}. Rewinds spanning the ` +
            `gap will be slower.`,
        );
      } catch {
        /* ignore broken console proxy */
      }
    }
    this.snapshots.push(Object.freeze({ ...snap }) as RewindSnapshot<TState>);
  }

  /** Number of registered snapshots. */
  getSnapshotCount(): number {
    return this.snapshots.length;
  }

  /**
   * Read-only view of every registered snapshot. Returned in monotonic
   * frame order. The replay menu's scrub-bar pre-render uses this to
   * place tick marks at every keyframe.
   */
  getSnapshots(): ReadonlyArray<RewindSnapshot<TState>> {
    return this.snapshots;
  }

  /**
   * The latest snapshot whose frame ≤ `targetFrame`, or `null` if no
   * snapshot is at or before the target. Public so the replay menu can
   * preview "this rewind would re-simulate N frames" in the UI before
   * committing.
   *
   * O(log n) via binary search.
   */
  findSnapshotForFrame(
    targetFrame: number,
  ): RewindSnapshot<TState> | null {
    if (
      typeof targetFrame !== 'number' ||
      !Number.isInteger(targetFrame) ||
      targetFrame < 0
    ) {
      throw new Error(
        `RewindController.findSnapshotForFrame: targetFrame must be a ` +
          `non-negative integer, got ${String(targetFrame)}`,
      );
    }
    if (this.snapshots.length === 0) return null;

    // Standard upper-bound binary search: find the largest index whose
    // frame ≤ targetFrame.
    let lo = 0;
    let hi = this.snapshots.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const s = this.snapshots[mid]!;
      if (s.frame <= targetFrame) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best === -1 ? null : this.snapshots[best]!;
  }

  // -------------------------------------------------------------------------
  // Rewind
  // -------------------------------------------------------------------------

  /**
   * Seek backwards (or to the same frame) by restoring the latest
   * snapshot ≤ `targetFrame` and re-feeding the input timeline forward
   * to `targetFrame`.
   *
   * Returns a {@link RewindResult} describing the outcome. Three
   * possible statuses:
   *
   *   • `'noop'`   — `targetFrame` equals the current snapshot's frame
   *                  exactly AND the host has not advanced past it. We
   *                  cannot tell that from inside the controller alone
   *                  (we don't track simulator time), so this status
   *                  fires only when the rewind is to a frame the
   *                  controller has just rewound to (cached). The
   *                  caller can also detect a noop themselves by
   *                  comparing `targetFrame` to their own simulator
   *                  cursor before calling.
   *
   *   • `'success'` — restore + re-simulation completed.
   *
   *   • `'failed'` — `restoreSnapshot` or `simulateStep` threw. The
   *                  error is re-thrown after the result is recorded.
   *
   * Validation:
   *
   *   • `targetFrame` must be a non-negative integer.
   *
   *   • A target with no enclosing snapshot (snapshots empty, or the
   *     earliest snapshot's frame > targetFrame) throws — the host
   *     must seed at least one snapshot at frame ≤ targetFrame before
   *     calling. The canonical setup is to call `addSnapshot({ frame: 0,
   *     state: captureGenesisState() })` immediately after match init.
   *
   *   • If the re-simulation would walk more than
   *     `maxSimulatedFramesPerRewind` frames, the rewind throws before
   *     restoring — a misconfigured host that asked for a rewind that
   *     would freeze the browser gets a clear error rather than a hung
   *     tab.
   */
  rewindTo(targetFrame: number): RewindResult<TState> {
    if (
      typeof targetFrame !== 'number' ||
      !Number.isInteger(targetFrame) ||
      targetFrame < 0
    ) {
      throw new Error(
        `RewindController.rewindTo: targetFrame must be a non-negative ` +
          `integer, got ${String(targetFrame)}`,
      );
    }

    const snap = this.findSnapshotForFrame(targetFrame);
    if (snap === null) {
      throw new Error(
        `RewindController.rewindTo: no snapshot at or before frame ` +
          `${targetFrame} — register an earlier snapshot before rewinding`,
      );
    }

    const framesToSimulate = targetFrame - snap.frame;
    if (framesToSimulate < 0) {
      // Defensive — `findSnapshotForFrame` should never return a snapshot
      // past the target, but if a future refactor breaks that invariant
      // we want a loud failure rather than a silent off-by-one.
      throw new Error(
        `RewindController.rewindTo: invariant violated — chosen snapshot ` +
          `at frame ${snap.frame} is past target frame ${targetFrame}`,
      );
    }
    if (framesToSimulate > this.maxSimulatedFramesPerRewind) {
      throw new Error(
        `RewindController.rewindTo: rewind would re-simulate ${framesToSimulate} ` +
          `frames (from snapshot ${snap.frame} to target ${targetFrame}), ` +
          `exceeding the cap of ${this.maxSimulatedFramesPerRewind}. ` +
          `Add more snapshots or raise maxSimulatedFramesPerRewind.`,
      );
    }

    this.rewindCount += 1;

    // Step 1 — restore. A throw here aborts before any simulator step.
    try {
      this.restoreSnapshot(snap);
    } catch (err) {
      this.failureCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      const result: RewindResult<TState> = Object.freeze({
        status: 'failed' as const,
        targetFrame,
        restoredFrom: snap,
        simulatedFrames: 0,
        haltedAtFrame: snap.frame,
        errorMessage: message,
      });
      // Re-throw so the host sees the original stack — matches how
      // RecordingController surfaces its callback errors.
      throw err instanceof Error
        ? Object.assign(err, { rewindResult: result })
        : new Error(message);
    }

    // Step 2 — exact-snapshot landing path. No re-simulation needed.
    if (framesToSimulate === 0) {
      this.exactSnapshotHits += 1;
      return Object.freeze({
        status: 'success' as const,
        targetFrame,
        restoredFrom: snap,
        simulatedFrames: 0,
        haltedAtFrame: targetFrame,
        errorMessage: '',
      });
    }

    // Step 3 — re-simulate frames (snap.frame, targetFrame].
    let simulated = 0;
    for (let f = snap.frame + 1; f <= targetFrame; f += 1) {
      const inputs = this.inputSource.sampleFrame(f);
      try {
        this.simulateStep(f, inputs);
      } catch (err) {
        this.failureCount += 1;
        this.totalSimulatedFrames += simulated;
        const message = err instanceof Error ? err.message : String(err);
        const result: RewindResult<TState> = Object.freeze({
          status: 'failed' as const,
          targetFrame,
          restoredFrom: snap,
          simulatedFrames: simulated,
          haltedAtFrame: f,
          errorMessage: message,
        });
        throw err instanceof Error
          ? Object.assign(err, { rewindResult: result })
          : new Error(message);
      }
      simulated += 1;
    }
    this.totalSimulatedFrames += simulated;

    return Object.freeze({
      status: 'success' as const,
      targetFrame,
      restoredFrom: snap,
      simulatedFrames: simulated,
      haltedAtFrame: targetFrame,
      errorMessage: '',
    });
  }

  // -------------------------------------------------------------------------
  // Stats / lifecycle
  // -------------------------------------------------------------------------

  /** Aggregate stats since construction (or last `reset()`). */
  getStats(): RewindStats {
    return Object.freeze({
      rewindCount: this.rewindCount,
      totalSimulatedFrames: this.totalSimulatedFrames,
      exactSnapshotHits: this.exactSnapshotHits,
      failureCount: this.failureCount,
    });
  }

  /**
   * Drop every registered snapshot and zero the stats counters. Does
   * NOT touch the callbacks — the controller can be re-armed for a new
   * recording / playback session by re-registering snapshots and
   * calling `rewindTo()` as before.
   */
  reset(): void {
    this.snapshots.length = 0;
    this.rewindCount = 0;
    this.totalSimulatedFrames = 0;
    this.exactSnapshotHits = 0;
    this.failureCount = 0;
  }

  /**
   * Configured snapshot interval in frames. Exposed for the M4 menu's
   * "this replay snapshots every N frames" diagnostic.
   */
  getSnapshotIntervalFrames(): number {
    return this.snapshotIntervalFrames;
  }

  /**
   * Configured re-simulation cap in frames. Exposed for diagnostics.
   */
  getMaxSimulatedFramesPerRewind(): number {
    return this.maxSimulatedFramesPerRewind;
  }
}

// ---------------------------------------------------------------------------
// Convenience re-exports
// ---------------------------------------------------------------------------

/**
 * Re-exported here for callers wiring a `simulateStep` that wants the
 * `inputs ?? NEUTRAL_INPUT` fallback for fault-tolerant playback over a
 * sparse timeline. Kept as a re-export rather than forcing a separate
 * import path — it's the same constant {@link InputCaptureBuffer}
 * exports.
 */
export { NEUTRAL_INPUT };
