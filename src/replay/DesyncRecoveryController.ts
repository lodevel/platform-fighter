/**
 * Desync recovery controller — AC 30203 Sub-AC 3.
 *
 * What this module is
 * ===================
 *
 * The decision arm of the M4 hybrid replay desync pipeline. Sub-AC 1 lays
 * down the snapshot recorder. Sub-AC 2 ({@link PlaybackChecksumVerifier})
 * computes per-frame match/mismatch verdicts and pushes divergence
 * entries onto a log. *This* module sits one layer above the verifier
 * and answers the question every replay host eventually has to ask:
 *
 *     "A divergence fired at frame N. Now what?"
 *
 * The answer is policy-driven. A casual player wants playback to keep
 * running so they can see what happened — divergence becomes a console
 * banner, not a crash. A QA engineer running the determinism harness in
 * CI wants the first divergence to abort the run so the regression has
 * a stack trace. A speed-runner reviewing a recording wants playback to
 * stop the moment the simulation diverges from the recorded match
 * because every frame past that point is misleading. {@link DesyncRecoveryController}
 * exposes those three modes — `'continue'`, `'halt-on-first'`,
 * `'halt-on-threshold'` — as a single
 * {@link DesyncTolerancePolicy} discriminated union, and turns each
 * verifier verdict into a structured {@link DesyncRecoveryDecision}
 * that the playback host can act on without having to re-implement the
 * counting / threshold logic itself.
 *
 *     ┌────────────────────────┐    verifyFrame()      ┌─────────────────────────┐
 *     │  ReplayPlayback host   │ ─────────────────────▶│ PlaybackChecksum-       │
 *     │  (MatchScene replay /  │                       │ Verifier (Sub-AC 2)     │
 *     │   headless harness)    │ ◀─────VerificationRes-│                         │
 *     │                        │                       └─────────────────────────┘
 *     │                        │                                  │
 *     │       result           │                                  │
 *     │       ▼                │                                  │
 *     │ ┌────────────────────┐ │                                  │
 *     │ │ DesyncRecovery-    │ │      ingest(result)              │
 *     │ │ Controller         │◀┼──────────────────────────────────┘
 *     │ │ (this module)      │ │
 *     │ │                    │ │      DesyncRecoveryDecision
 *     │ │ • policy gate      │ │ ─────────▶  { action: 'halt' | 'continue', … }
 *     │ │ • report state     │ │
 *     │ │ • halt() callback  │ │      getReport()
 *     │ └────────────────────┘ │ ─────────▶  DesyncReport (verdict, frames, list)
 *     └────────────────────────┘
 *
 * The controller never calls the verifier itself — the playback host
 * calls `verifier.verifyFrame(frame, snapshot)` and pipes the result
 * into `controller.ingest(result)`. The host then decides what to do
 * with the returned decision (typically: `if (decision.action ===
 * 'halt') replayPlayback.stop()`). Decoupling the verifier from the
 * controller means a CI harness that wants to observe every divergence
 * but never halt can simply omit the controller entirely; conversely a
 * UI host can stand up the controller without subclassing the verifier.
 *
 * Why a separate module
 * ---------------------
 *
 *   • **Policy is an axis the verifier doesn't have.** The verifier is
 *     a pure pass-through plus a divergence log. Halting / counting /
 *     reporting are presentation-layer concerns the verifier shouldn't
 *     know about — keeping them here means the verifier never grows a
 *     `'mode'` constructor flag and never fires `onHalt` callbacks.
 *
 *   • **The replay-menu UI consumes a structured report**, not a raw
 *     divergence log. {@link DesyncReport} bundles the verdict, the
 *     halt frame, the divergence range, and a capped diff list into one
 *     frozen object the overlay can render in a single pass.
 *     `ui/desyncReportFormat.ts` (the sibling sub-module) consumes that
 *     report and produces UI strings; `ui/DesyncReportOverlay.ts`
 *     paints those strings into a Phaser overlay. The controller is the
 *     glue between the deterministic verifier and the presentation
 *     layer.
 *
 *   • **Testability.** Phaser-free; no DOM, no Matter, no wall-clock.
 *     The vitest suite under `DesyncRecoveryController.test.ts` exercises
 *     every policy and every verdict shape under plain Node.
 *
 * Determinism contract
 * --------------------
 *
 *   • Pure function of (policy, ingested results, manual halt calls).
 *     Two controllers fed the same sequence of {@link VerificationResult}s
 *     and the same policy produce byte-identical reports.
 *   • No `Math.random()`, no `Date.now()`, no global mutation. The
 *     report's frame fields are taken straight from the verifier's
 *     `frame` field; the controller never reads a clock.
 *   • The optional `onHalt` / `onDivergence` callbacks are the ONLY
 *     non-pure observable side effects. Callers wanting bit-equality
 *     across runs simply omit them.
 */

import type {
  DivergenceEntry,
  PlaybackChecksumVerifier,
  VerificationResult,
} from './PlaybackChecksumVerifier';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Tolerance policy — declares "when should the controller order the
 * playback host to halt?". A discriminated union (rather than three
 * separate boolean flags) so adding a new mode (e.g. "halt on the
 * first malformed-record but tolerate mismatches") doesn't widen
 * existing call sites.
 */
export type DesyncTolerancePolicy =
  | {
      /**
       * Never halt. Every divergence is logged + decision is `'continue'`.
       * The replay menu uses this so a casual playback session shows the
       * banner but keeps running.
       */
      readonly kind: 'continue';
    }
  | {
      /**
       * Halt the moment the first divergence fires (mismatch *or*
       * malformed-record). The CI determinism harness uses this — a
       * regression should fail fast with the offending frame in the
       * stack trace, not bury it in a divergence list.
       */
      readonly kind: 'halt-on-first';
    }
  | {
      /**
       * Halt once the cumulative divergence count crosses
       * `maxDivergences`. A casual player who wants playback to keep
       * going through one or two cosmetic blips but stop if the
       * simulation has *clearly* diverged uses e.g. `{ maxDivergences: 5 }`.
       *
       * Optionally, `maxConsecutivePins` halts when N divergences fire
       * back-to-back without an intervening match. This catches "the
       * simulation went off the rails" (every pin from frame N onward
       * misses) without halting on a single isolated blip.
       */
      readonly kind: 'halt-on-threshold';
      /** Maximum total divergences allowed before halting. ≥ 1. */
      readonly maxDivergences: number;
      /**
       * Optional secondary trigger: halt when this many divergences
       * fire back-to-back at consecutive recorded pins. Omit to disable.
       * ≥ 2 when set.
       */
      readonly maxConsecutivePins?: number;
    };

/**
 * Verdict the host's UI surfaces alongside the divergence list.
 *
 *   • `'pending'`    — no `finish()` / `halt()` has fired yet, so the
 *                      verdict is still in flight.
 *   • `'pass'`       — `finish()` was called and zero divergences
 *                      occurred. The replay matches the recording.
 *   • `'fail-continued'` — divergences occurred but policy was
 *                      `'continue'`, so playback ran to completion.
 *   • `'fail-halted'` — policy halted playback at a specific frame.
 */
export type DesyncReportVerdict =
  | 'pending'
  | 'pass'
  | 'fail-continued'
  | 'fail-halted';

/**
 * Lifecycle status — orthogonal to the verdict (a controller can be
 * `'monitoring'` while still in the `'pending'` verdict).
 */
export type DesyncReportStatus =
  | 'idle'        // construction / `reset()`; never ingested anything yet
  | 'monitoring'  // ingested at least one result, neither halted nor finished
  | 'halted'      // policy or manual `halt()` triggered a stop
  | 'completed';  // `finish()` was called (replay played to its end without a halt)

/**
 * Per-`ingest()` decision. The host inspects `action` and either keeps
 * playing or calls `replayPlayback.stop()`. `reason` is a human-
 * readable explanation suitable for the in-game banner and logging.
 */
export interface DesyncRecoveryDecision {
  /** Frame the verifier reported on. */
  readonly frame: number;
  /** The verdict outcome the verifier produced (passed through). */
  readonly outcome: VerificationResult['outcome'];
  /**
   * `'halt'` means policy says stop *now*. `'continue'` means keep
   * advancing the replay cursor.
   */
  readonly action: 'continue' | 'halt';
  /**
   * Short human-readable rationale. Surfaced verbatim by the
   * desync-report overlay's banner row, so callers shouldn't be tempted
   * to invent their own wording — the formatter relies on these strings
   * being stable.
   */
  readonly reason: string;
  /**
   * The divergence entry that triggered this decision, if any. `null`
   * for `'no-pin'` and `'match'` outcomes. Equal to
   * `verifier.getDivergenceLog()[verifier.getDivergenceLog().length - 1]`
   * by the controller invariant.
   */
  readonly divergence: DivergenceEntry | null;
}

/**
 * Capped-length diff summary entry. Captures just enough of a
 * divergence to render a side-by-side row in the overlay without
 * holding onto the full divergence log forever.
 */
export interface DesyncDiffSummaryEntry {
  readonly frame: number;
  readonly kind: 'mismatch' | 'malformed-record';
  /** Recorded checksum (null when malformed-record had no record). */
  readonly expected: string | null;
  /** Live checksum the verifier computed. */
  readonly actual: string;
  /** Recorded algorithm string, or null if the record didn't carry one. */
  readonly algorithm: string | null;
}

/**
 * Frozen snapshot of the controller's state at a point in time. The
 * desync-report overlay reads this once per render frame; the test
 * suite asserts against it directly.
 */
export interface DesyncReport {
  readonly verdict: DesyncReportVerdict;
  readonly status: DesyncReportStatus;
  /** Total `ingest()` calls — irrespective of outcome. */
  readonly framesObserved: number;
  /** First divergence frame observed, or null if none yet. */
  readonly firstDivergenceFrame: number | null;
  /** Most recent divergence frame, or null if none yet. */
  readonly lastDivergenceFrame: number | null;
  /** Total divergences (mismatch + malformed-record). */
  readonly divergenceCount: number;
  /** Subset of {@link divergenceCount} that were mismatches. */
  readonly mismatchCount: number;
  /** Subset of {@link divergenceCount} that were malformed records. */
  readonly malformedCount: number;
  /** Calls landed on a recorded pin and matched. */
  readonly matchCount: number;
  /** Calls landed on a frame with no recorded pin. */
  readonly noPinCount: number;
  /**
   * Total number of recorded pins the verifier was constructed with.
   * Surfaced on the report so the overlay can render
   * `pins: matchCount / recordCount` without holding a separate
   * verifier reference.
   */
  readonly recordCount: number;
  /**
   * Frame the controller decided to halt at, or null if no halt has
   * occurred. For policy-driven halts, the frame is the divergence's
   * frame; for manual `halt()`, it's the most recent ingested frame
   * (or null if no ingest has happened).
   */
  readonly haltedAtFrame: number | null;
  /**
   * Reason string accompanying the halt — same string fed to `onHalt`.
   * Null when the controller hasn't halted.
   */
  readonly haltReason: string | null;
  /** The active tolerance policy this controller is enforcing. */
  readonly tolerance: DesyncTolerancePolicy;
  /**
   * Capped-length list of the most recent divergences, in capture
   * order. Length ≤ {@link DesyncRecoveryControllerOptions.maxReportRows}.
   * Frozen — do not mutate.
   */
  readonly divergences: ReadonlyArray<DivergenceEntry>;
  /**
   * The same divergences reduced to their checksum diff for the
   * "diff summary" UI row — `expected vs actual`. Same cap as
   * {@link divergences}.
   */
  readonly diffSummary: ReadonlyArray<DesyncDiffSummaryEntry>;
}

/** Construction options. */
export interface DesyncRecoveryControllerOptions {
  /**
   * The verifier this controller observes. Required — without it the
   * controller has no source of truth for divergences. The controller
   * does *not* take ownership; the host still drives the verifier.
   */
  readonly verifier: PlaybackChecksumVerifier;
  /**
   * Tolerance policy. Defaults to `{ kind: 'continue' }` because the
   * primary consumer (the M4 replay menu) prefers "log everything,
   * surface the count" over "stop on first blip". CI harnesses pass
   * `{ kind: 'halt-on-first' }` explicitly.
   */
  readonly tolerance?: DesyncTolerancePolicy;
  /**
   * Max divergence rows the report keeps. Defaults to 32 — comfortable
   * for the overlay's scrollable list and small enough that a runaway
   * desync (every pin diverges) doesn't grow without bound. Older
   * entries are dropped from the report's `divergences` / `diffSummary`
   * arrays once the cap is hit, but the verifier's own log stays
   * authoritative.
   */
  readonly maxReportRows?: number;
  /**
   * Optional callback fired exactly once, the first time the controller
   * halts. Receives the report at the moment of halt. Useful for the
   * replay menu's "halted" banner and for headless tooling that wants
   * to assert the run aborted at a specific frame.
   */
  readonly onHalt?: (report: DesyncReport) => void;
  /**
   * Optional callback fired on every divergence — even ones the policy
   * decides to tolerate. The replay menu's running list uses this to
   * append a row in real time; tests use it as a probe.
   */
  readonly onDivergence?: (
    entry: DivergenceEntry,
    decision: DesyncRecoveryDecision,
  ) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default tolerance — "continue" — see policy docstring for rationale. */
const DEFAULT_TOLERANCE: DesyncTolerancePolicy = Object.freeze({
  kind: 'continue',
});

/** Default cap on `divergences` / `diffSummary` rows the report retains. */
const DEFAULT_MAX_REPORT_ROWS = 32;

/** Lower bound — we always keep at least the most recent divergence. */
const MIN_REPORT_ROWS = 1;

// ---------------------------------------------------------------------------
// Internal — policy validation
// ---------------------------------------------------------------------------

function validateTolerance(policy: DesyncTolerancePolicy): void {
  if (policy === null || typeof policy !== 'object') {
    throw new Error(
      `DesyncRecoveryController: tolerance must be a non-null object`,
    );
  }
  switch (policy.kind) {
    case 'continue':
    case 'halt-on-first':
      return;
    case 'halt-on-threshold': {
      if (
        !Number.isInteger(policy.maxDivergences) ||
        policy.maxDivergences < 1
      ) {
        throw new Error(
          `DesyncRecoveryController: tolerance.maxDivergences must be an ` +
            `integer ≥ 1, got ${String(policy.maxDivergences)}`,
        );
      }
      if (policy.maxConsecutivePins !== undefined) {
        if (
          !Number.isInteger(policy.maxConsecutivePins) ||
          policy.maxConsecutivePins < 2
        ) {
          throw new Error(
            `DesyncRecoveryController: tolerance.maxConsecutivePins must be ` +
              `an integer ≥ 2 when set, got ${String(policy.maxConsecutivePins)}`,
          );
        }
      }
      return;
    }
    default: {
      // Exhaustiveness — TypeScript should already have flagged this.
      const exhaustive: never = policy;
      throw new Error(
        `DesyncRecoveryController: unknown tolerance kind: ${String(
          (exhaustive as { kind?: string }).kind,
        )}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// DesyncRecoveryController
// ---------------------------------------------------------------------------

/**
 * Stateful controller that turns verifier verdicts into recovery
 * decisions and accumulates a report the UI overlay renders.
 *
 * Lifecycle:
 *
 *   const verifier = new PlaybackChecksumVerifier({ records });
 *   const controller = new DesyncRecoveryController({
 *     verifier,
 *     tolerance: { kind: 'halt-on-threshold', maxDivergences: 5 },
 *     onHalt: (report) => {
 *       overlay.update(report);
 *       overlay.setVisible(true);
 *       replayPlayback.stop();
 *     },
 *   });
 *
 *   while (!replayPlayback.isFinished() && !controller.isHalted()) {
 *     const inputs = replayPlayback.advance();
 *     // ... step the simulation, collect a snapshot ...
 *     const result = verifier.verifyFrame(snapshot.frame, snapshot);
 *     const decision = controller.ingest(result);
 *     if (decision.action === 'halt') {
 *       replayPlayback.stop();
 *       break;
 *     }
 *   }
 *   if (!controller.isHalted()) {
 *     controller.finish();
 *   }
 *
 *   const report = controller.getReport();
 *   overlay.update(report);
 */
export class DesyncRecoveryController {
  private readonly verifier: PlaybackChecksumVerifier;
  private tolerance: DesyncTolerancePolicy;
  private readonly maxReportRows: number;
  private readonly onHalt: ((report: DesyncReport) => void) | null;
  private readonly onDivergence:
    | ((entry: DivergenceEntry, decision: DesyncRecoveryDecision) => void)
    | null;

  /** Capped ring of recent divergences (newest at the end). */
  private readonly divergences: DivergenceEntry[] = [];
  /** Same window, reduced to its diff fields. */
  private readonly diffSummary: DesyncDiffSummaryEntry[] = [];

  private status: DesyncReportStatus = 'idle';
  private verdict: DesyncReportVerdict = 'pending';

  private framesObserved = 0;
  private mismatchCount = 0;
  private malformedCount = 0;
  private matchCount = 0;
  private noPinCount = 0;

  private firstDivergenceFrame: number | null = null;
  private lastDivergenceFrame: number | null = null;
  private lastIngestedFrame: number | null = null;

  /** Number of consecutive *recorded-pin* divergences (no `match` between them). */
  private consecutivePinDivergences = 0;

  private haltedAtFrame: number | null = null;
  private haltReason: string | null = null;
  private haltCallbackFired = false;

  constructor(options: DesyncRecoveryControllerOptions) {
    if (options === null || typeof options !== 'object') {
      throw new Error(
        `DesyncRecoveryController: options must be a non-null object`,
      );
    }
    if (options.verifier === undefined || options.verifier === null) {
      throw new Error(
        `DesyncRecoveryController: options.verifier is required`,
      );
    }
    this.verifier = options.verifier;

    const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
    validateTolerance(tolerance);
    this.tolerance = tolerance;

    const cap = options.maxReportRows ?? DEFAULT_MAX_REPORT_ROWS;
    if (!Number.isInteger(cap) || cap < MIN_REPORT_ROWS) {
      throw new Error(
        `DesyncRecoveryController: maxReportRows must be an integer ` +
          `≥ ${MIN_REPORT_ROWS}, got ${String(cap)}`,
      );
    }
    this.maxReportRows = cap;
    this.onHalt = options.onHalt ?? null;
    this.onDivergence = options.onDivergence ?? null;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Replace the active tolerance policy. The replay menu's "halt on
   * first divergence" toggle calls into this; existing report state
   * is preserved (so flipping the policy mid-playback can immediately
   * promote a known-divergence run from `'fail-continued'` to a halt
   * on the next divergence).
   */
  setTolerance(tolerance: DesyncTolerancePolicy): void {
    validateTolerance(tolerance);
    this.tolerance = tolerance;
  }

  getTolerance(): DesyncTolerancePolicy {
    return this.tolerance;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getVerifier(): PlaybackChecksumVerifier {
    return this.verifier;
  }

  getStatus(): DesyncReportStatus {
    return this.status;
  }

  getVerdict(): DesyncReportVerdict {
    return this.verdict;
  }

  isHalted(): boolean {
    return this.status === 'halted';
  }

  isFinished(): boolean {
    return this.status === 'completed' || this.status === 'halted';
  }

  hasDiverged(): boolean {
    return this.divergences.length > 0 || this.firstDivergenceFrame !== null;
  }

  /** Frozen snapshot suitable for the overlay or a `JSON.stringify`. */
  getReport(): DesyncReport {
    return Object.freeze({
      verdict: this.verdict,
      status: this.status,
      framesObserved: this.framesObserved,
      firstDivergenceFrame: this.firstDivergenceFrame,
      lastDivergenceFrame: this.lastDivergenceFrame,
      divergenceCount: this.mismatchCount + this.malformedCount,
      mismatchCount: this.mismatchCount,
      malformedCount: this.malformedCount,
      matchCount: this.matchCount,
      noPinCount: this.noPinCount,
      recordCount: this.verifier.getRecordCount(),
      haltedAtFrame: this.haltedAtFrame,
      haltReason: this.haltReason,
      tolerance: this.tolerance,
      divergences: Object.freeze(this.divergences.slice()),
      diffSummary: Object.freeze(this.diffSummary.slice()),
    });
  }

  // -------------------------------------------------------------------------
  // Mutation — ingest, finish, halt, reset
  // -------------------------------------------------------------------------

  /**
   * Process one verifier verdict. The host calls this once per fixed
   * step (or once per scrub-pin verification) and inspects the
   * returned decision's `action` to decide whether to keep playing.
   *
   *   • `'no-pin'` / `'match'`  → `'continue'`, no divergence recorded.
   *   • `'mismatch'` / `'malformed-record'` → policy runs; `'continue'`
   *     unless the policy says halt.
   *
   * Idempotent in the halted state — subsequent `ingest()` calls after
   * a halt return a `'halt'` decision without growing the divergence
   * list. The host should typically stop calling `ingest()` once it
   * sees `'halt'`, but a host that doesn't is still safe.
   */
  ingest(result: VerificationResult): DesyncRecoveryDecision {
    if (result === null || typeof result !== 'object') {
      throw new Error(
        `DesyncRecoveryController.ingest: result must be a non-null object`,
      );
    }
    if (!Number.isInteger(result.frame) || result.frame < 0) {
      throw new Error(
        `DesyncRecoveryController.ingest: result.frame must be a non-` +
          `negative integer, got ${String(result.frame)}`,
      );
    }

    // Once halted, stay halted — the controller never resumes without
    // an explicit `reset()`. Returning a stable `'halt'` decision here
    // means a host that forgets to break out of its loop still gets
    // a consistent answer.
    if (this.status === 'halted') {
      return Object.freeze({
        frame: result.frame,
        outcome: result.outcome,
        action: 'halt' as const,
        reason: this.haltReason ?? 'desync recovery already halted',
        divergence:
          this.divergences.length > 0
            ? this.divergences[this.divergences.length - 1]!
            : null,
      });
    }

    this.framesObserved += 1;
    this.lastIngestedFrame = result.frame;
    if (this.status === 'idle') {
      this.status = 'monitoring';
    }

    switch (result.outcome) {
      case 'no-pin':
        this.noPinCount += 1;
        // A no-pin frame doesn't reset the consecutive-pin counter —
        // consecutive divergence is measured across pinned frames only.
        return this.continueDecision(result, 'no recorded pin at this frame');

      case 'match':
        this.matchCount += 1;
        // A match resets the consecutive-pin run.
        this.consecutivePinDivergences = 0;
        return this.continueDecision(result, 'state checksum matched');

      case 'mismatch':
      case 'malformed-record':
        return this.recordDivergence(result);

      default: {
        const exhaustive: never = result.outcome;
        throw new Error(
          `DesyncRecoveryController.ingest: unknown outcome ${String(
            (exhaustive as { toString?: () => string }).toString?.() ??
              exhaustive,
          )}`,
        );
      }
    }
  }

  /**
   * Declare the replay played to its end without an external halt.
   * Locks the verdict and transitions to `'completed'`. Idempotent if
   * the controller is already halted (no state change).
   */
  finish(): void {
    if (this.status === 'halted' || this.status === 'completed') return;
    this.status = 'completed';
    this.verdict =
      this.divergences.length === 0 && this.firstDivergenceFrame === null
        ? 'pass'
        : 'fail-continued';
  }

  /**
   * Manual halt — used by the M4 menu's "stop replay" button. The
   * `reason` defaults to "manual halt"; tests pass an explicit string
   * when asserting the report's wording.
   */
  halt(reason: string = 'manual halt'): void {
    if (this.status === 'halted') return;
    this.status = 'halted';
    this.verdict = 'fail-halted';
    this.haltReason = reason;
    this.haltedAtFrame = this.lastIngestedFrame;
    this.fireHaltCallback();
  }

  /**
   * Reset to the post-construction state. The verifier is *not* reset —
   * the host must call `verifier.reset()` separately if it wants both
   * to start fresh. Re-using a controller across replay seek/scrub
   * cycles is the primary use case (the report's "since last seek"
   * window matches the verifier's reset behaviour).
   */
  reset(): void {
    this.divergences.length = 0;
    this.diffSummary.length = 0;
    this.status = 'idle';
    this.verdict = 'pending';
    this.framesObserved = 0;
    this.mismatchCount = 0;
    this.malformedCount = 0;
    this.matchCount = 0;
    this.noPinCount = 0;
    this.firstDivergenceFrame = null;
    this.lastDivergenceFrame = null;
    this.lastIngestedFrame = null;
    this.consecutivePinDivergences = 0;
    this.haltedAtFrame = null;
    this.haltReason = null;
    this.haltCallbackFired = false;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private continueDecision(
    result: VerificationResult,
    reason: string,
  ): DesyncRecoveryDecision {
    return Object.freeze({
      frame: result.frame,
      outcome: result.outcome,
      action: 'continue' as const,
      reason,
      divergence: null,
    });
  }

  private recordDivergence(
    result: VerificationResult,
  ): DesyncRecoveryDecision {
    if (result.outcome !== 'mismatch' && result.outcome !== 'malformed-record') {
      // Defensive — the switch in `ingest` already guards this.
      throw new Error(
        `DesyncRecoveryController: recordDivergence called with non-` +
          `divergence outcome ${result.outcome}`,
      );
    }

    // The verifier already pushed an entry onto its log; pull the most
    // recent entry, which by the verifier's monotonic-frame contract
    // matches `result.frame`. This couples controller and verifier in
    // one direction (controller reads verifier log) but keeps the
    // entry's `message` formatting authoritatively in the verifier.
    const log = this.verifier.getDivergenceLog();
    const entry = log[log.length - 1];
    if (entry === undefined || entry.frame !== result.frame) {
      throw new Error(
        `DesyncRecoveryController: invariant violated — verifier log does ` +
          `not have a divergence at frame ${result.frame}. Did the host ` +
          `feed a result the verifier didn't produce?`,
      );
    }

    if (result.outcome === 'mismatch') this.mismatchCount += 1;
    else this.malformedCount += 1;
    this.consecutivePinDivergences += 1;
    if (this.firstDivergenceFrame === null) {
      this.firstDivergenceFrame = result.frame;
    }
    this.lastDivergenceFrame = result.frame;
    this.appendDivergence(entry, result.actual ?? entry.actual);

    const haltReason = this.shouldHalt(result, entry);
    let decision: DesyncRecoveryDecision;
    if (haltReason !== null) {
      decision = Object.freeze({
        frame: result.frame,
        outcome: result.outcome,
        action: 'halt' as const,
        reason: haltReason,
        divergence: entry,
      });
    } else {
      decision = Object.freeze({
        frame: result.frame,
        outcome: result.outcome,
        action: 'continue' as const,
        reason: this.toleranceWaiverReason(entry),
        divergence: entry,
      });
    }

    if (this.onDivergence !== null) {
      try {
        this.onDivergence(entry, decision);
      } catch {
        // Swallow — a user-supplied callback that throws should not
        // crash the controller.
      }
    }

    if (decision.action === 'halt') {
      this.status = 'halted';
      this.verdict = 'fail-halted';
      this.haltReason = decision.reason;
      this.haltedAtFrame = result.frame;
      this.fireHaltCallback();
    }

    return decision;
  }

  /**
   * Append the entry to the capped windows. When the cap is exceeded
   * the *oldest* entry is shifted out — this preserves the most recent
   * divergence in the report (which is what the overlay wants to show
   * "just now"). The verifier's full log remains authoritative for any
   * caller that needs the complete history.
   */
  private appendDivergence(entry: DivergenceEntry, actual: string): void {
    this.divergences.push(entry);
    this.diffSummary.push({
      frame: entry.frame,
      kind: entry.kind,
      expected: entry.expected,
      actual,
      algorithm: entry.algorithm,
    });
    while (this.divergences.length > this.maxReportRows) {
      this.divergences.shift();
    }
    while (this.diffSummary.length > this.maxReportRows) {
      this.diffSummary.shift();
    }
  }

  /**
   * Decide whether the policy fires a halt for this divergence.
   * Returns the halt reason string when it does, or null to continue.
   */
  private shouldHalt(
    result: VerificationResult,
    entry: DivergenceEntry,
  ): string | null {
    const policy = this.tolerance;
    switch (policy.kind) {
      case 'continue':
        return null;
      case 'halt-on-first':
        return (
          `policy 'halt-on-first': ${entry.kind} at frame ${result.frame}`
        );
      case 'halt-on-threshold': {
        const totalDivergences = this.mismatchCount + this.malformedCount;
        if (totalDivergences >= policy.maxDivergences) {
          return (
            `policy 'halt-on-threshold': divergence count ${totalDivergences} ` +
            `reached limit ${policy.maxDivergences}`
          );
        }
        if (
          policy.maxConsecutivePins !== undefined &&
          this.consecutivePinDivergences >= policy.maxConsecutivePins
        ) {
          return (
            `policy 'halt-on-threshold': ${this.consecutivePinDivergences} ` +
            `consecutive divergent pins reached limit ${policy.maxConsecutivePins}`
          );
        }
        return null;
      }
      default: {
        const exhaustive: never = policy;
        throw new Error(
          `DesyncRecoveryController: unhandled policy kind: ${String(
            (exhaustive as { kind?: string }).kind,
          )}`,
        );
      }
    }
  }

  /**
   * Build the "policy is letting this through" reason for a divergence
   * the controller chose not to halt on. Used for the
   * `'fail-continued'` decision rows — the overlay shows this verbatim
   * so the player understands why playback didn't stop.
   */
  private toleranceWaiverReason(entry: DivergenceEntry): string {
    const policy = this.tolerance;
    if (policy.kind === 'continue') {
      return `tolerance 'continue' — divergence at frame ${entry.frame} ignored`;
    }
    if (policy.kind === 'halt-on-threshold') {
      const totalDivergences = this.mismatchCount + this.malformedCount;
      const remaining = Math.max(0, policy.maxDivergences - totalDivergences);
      return (
        `tolerance 'halt-on-threshold' — ${remaining} divergence(s) remaining ` +
        `before halt`
      );
    }
    // halt-on-first reaches recordDivergence only when shouldHalt has
    // already returned a halt reason, so this branch is unreachable in
    // practice — but TypeScript wants the exhaustive return.
    return `divergence tolerated`;
  }

  private fireHaltCallback(): void {
    if (this.haltCallbackFired) return;
    this.haltCallbackFired = true;
    if (this.onHalt === null) return;
    try {
      this.onHalt(this.getReport());
    } catch {
      // Same swallow rationale as `onDivergence`: a misbehaving user
      // callback should never take the controller down.
    }
  }
}
