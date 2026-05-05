/**
 * Playback checksum verifier — AC 30202 Sub-AC 2.
 *
 * What this module is
 * ===================
 *
 * The runtime arm of the M4 hybrid replay system's desync-detection
 * pipeline. Recording lays down a state checksum at every snapshot
 * pin; *playback* (this module) re-computes the live state checksum at
 * those same frames and compares them against the recorded values.
 *
 * On a mismatch the verifier records a frame-level divergence entry,
 * fires a logger callback (default `console.warn`), and continues
 * advancing — desync is a *diagnostic*, not a fatal error, because the
 * M4 replay menu wants to surface "this replay desyncs at frame N"
 * alongside the file's other metadata so a player can decide whether
 * to keep the file. Halting on first mismatch would hide subsequent
 * divergence points which are useful for triage.
 *
 * Where it sits in the replay architecture
 * ----------------------------------------
 *
 *   • `RecordingController` (live match) every 300 frames calls into a
 *     state-snapshot builder (Sub-AC 1) and pushes a
 *     {@link StateChecksumRecord} onto a list it later persists with
 *     the replay.
 *
 *   • `ReplayPlaybackController` (this module's caller) loads the
 *     replay, then constructs a {@link PlaybackChecksumVerifier} with
 *     the persisted records. Every fixed step the playback host calls
 *     `verifier.verifyFrame(frame, snapshot)` and feeds the verifier's
 *     return value into its desync handling.
 *
 *   • The M4 replay menu reads `verifier.getDivergenceLog()` after a
 *     scrub or a full playback and surfaces the entries to the user
 *     ("Replay diverged at frame 1500: P2 position changed from
 *     (320, 480) to (319.998, 480)").
 *
 * Why a separate module (instead of a method on ReplayPlaybackController)
 * ---------------------------------------------------------------------
 *
 *   • **Separation of concerns.** ReplayPlaybackController is about
 *     *input* feeding (the input timeline). State checksum verification
 *     is a parallel concern that runs alongside the input feed. The
 *     two share the cursor frame number but nothing else; mixing them
 *     would couple unrelated responsibilities.
 *
 *   • **Reusability.** The verifier is also useful in headless contexts:
 *     a CI determinism harness can re-simulate every saved replay in
 *     batch and assert no divergences without involving a playback
 *     controller.
 *
 *   • **Testability.** Phaser-free. The vitest suite under
 *     `PlaybackChecksumVerifier.test.ts` runs under plain Node.
 *
 * Determinism contract
 * --------------------
 *
 * Verification is a pure function of the recorded records and the
 * supplied per-frame snapshot:
 *
 *   • The verifier never reads a wall clock, never calls
 *     `Math.random()`, never holds a closure over external state.
 *   • The divergence log entries are in capture order — strictly
 *     monotonic by frame.
 *   • Repeated verification of the same snapshot at the same frame
 *     produces the same result.
 *   • The default logger is `console.warn`. Tests inject a recording
 *     logger to capture every emission. The logger callback is the
 *     ONLY non-pure observable side effect; everything else is
 *     internal state on the verifier instance.
 *
 * Phaser-free
 * -----------
 *
 * No Phaser, Matter, or DOM imports.
 */

import { ReplayIntegrityError, isWellFormedChecksum } from './replayChecksum';
import {
  STATE_CHECKSUM_ALGORITHM,
  computeStateChecksum,
  serializeStateForChecksum,
  type MatchStateSnapshot,
  type StateChecksumRecord,
} from './stateChecksum';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Outcome of a single `verifyFrame()` call.
 *
 *   • `'no-pin'` — the frame has no recorded checksum, so the verifier
 *     was a pure pass-through. No divergence is logged.
 *   • `'match'` — a recorded checksum exists for this frame and the
 *     live snapshot's checksum matches it. The verifier records the
 *     match in its stats counter and returns.
 *   • `'mismatch'` — a recorded checksum exists for this frame and the
 *     live snapshot's checksum *differs*. A divergence entry is added
 *     to the log, the logger callback fires, and the result carries
 *     both checksums for the caller to display.
 *   • `'malformed-record'` — the recorded checksum at this frame is
 *     structurally invalid (wrong shape, wrong algorithm). Logged as a
 *     divergence with a distinguishing `kind` so the M4 menu can show
 *     "the *file* is corrupt at this pin" rather than "the simulation
 *     diverged".
 */
export type VerificationOutcome =
  | 'no-pin'
  | 'match'
  | 'mismatch'
  | 'malformed-record';

/**
 * Frozen status returned by every `verifyFrame()` call. The caller (the
 * M4 replay menu, a headless harness) can read the result without
 * having to remember the verifier's internal state.
 */
export interface VerificationResult {
  /** Outcome category — one of the four cases above. */
  readonly outcome: VerificationOutcome;
  /** Frame the verifier was queried at. */
  readonly frame: number;
  /**
   * The recorded checksum, if a pin existed at this frame. Null for
   * the `'no-pin'` outcome and for `'malformed-record'` when the
   * record wasn't a well-formed string.
   */
  readonly expected: string | null;
  /**
   * The freshly-computed checksum from the live snapshot. Always
   * present except for `'no-pin'` (where the verifier didn't bother
   * computing it).
   */
  readonly actual: string | null;
  /**
   * Algorithm string carried by the recorded record, if a pin existed.
   * Null for `'no-pin'`.
   */
  readonly algorithm: string | null;
}

/**
 * One frame-level divergence entry. The verifier accumulates these in
 * capture order — `getDivergenceLog()` returns the array in monotonic
 * frame order. The M4 menu surfaces them in a list view.
 */
export interface DivergenceEntry {
  /** Frame the divergence was detected at. */
  readonly frame: number;
  /**
   * `'mismatch'` — the recorded and live checksums disagreed.
   * `'malformed-record'` — the recorded record itself was structurally
   * invalid (corrupted file, wrong algorithm, non-hex string).
   */
  readonly kind: 'mismatch' | 'malformed-record';
  /** Recorded checksum — null when the record was malformed. */
  readonly expected: string | null;
  /** Computed checksum — always present (we never log without computing). */
  readonly actual: string;
  /**
   * Algorithm string from the recorded record. `null` when the record
   * was missing the field entirely.
   */
  readonly algorithm: string | null;
  /**
   * Optional human-readable message attached to the entry. Always
   * populated by the verifier with a one-line summary; the M4 menu
   * uses it as the row label.
   */
  readonly message: string;
}

/**
 * Aggregate stats the M4 menu shows alongside the divergence log.
 */
export interface VerifierStats {
  /** Total number of `verifyFrame()` calls so far (across any outcome). */
  readonly callCount: number;
  /** Calls that landed on a recorded pin and matched the live snapshot. */
  readonly matchCount: number;
  /** Calls that landed on a recorded pin and disagreed. */
  readonly mismatchCount: number;
  /** Calls that landed on a record but the record itself was malformed. */
  readonly malformedCount: number;
  /** Calls that landed on a frame with no pin — pure pass-throughs. */
  readonly noPinCount: number;
  /** Total number of records loaded into the verifier. */
  readonly recordCount: number;
  /** True iff at least one mismatch / malformed entry has fired. */
  readonly hasDiverged: boolean;
}

/**
 * Logger callback signature. The verifier calls this exactly once per
 * divergence — never on `'no-pin'` / `'match'`. The default
 * implementation is `console.warn`; tests inject a recording logger
 * to capture every emission.
 *
 * The arguments mirror the divergence entry plus a pre-formatted
 * message string so a logger that just prints can do so without
 * having to format anything itself.
 */
export type DivergenceLogger = (entry: DivergenceEntry) => void;

/** Constructor options. */
export interface PlaybackChecksumVerifierOptions {
  /**
   * The recorded `(frame, checksum)` pins to verify against. Must be
   * monotonically ordered by frame; the constructor throws on
   * out-of-order or duplicate frames so a hand-edited file with
   * shuffled pins is rejected up-front rather than producing
   * unpredictable verification results frame-by-frame.
   *
   * Optional — a verifier with no records is still useful for
   * headless tooling that wants to *record* checksums during a
   * replay without comparing against any.
   */
  readonly records?: ReadonlyArray<StateChecksumRecord>;
  /**
   * Custom logger callback. Fires once per divergence (mismatch or
   * malformed-record). Defaults to `console.warn` formatting; pass a
   * no-op `() => {}` to suppress logging entirely (the divergence log
   * is still populated). Tests pass a recording logger to assert the
   * exact emissions.
   */
  readonly logger?: DivergenceLogger;
  /**
   * When `true`, the second `mismatch` (or `malformed-record`)
   * outcome turns into a thrown {@link ReplayIntegrityError}. Default
   * `false` because the M4 replay menu's UX is "log everything,
   * surface the count" — but a CI determinism harness running through
   * `vitest` flips this to `true` so a regression fails the build
   * loudly.
   */
  readonly stopOnDivergence?: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Format a divergence entry as a single-line console-friendly message.
 * Exposed so the M4 menu's "diagnose desync" view can call the same
 * formatter for its row labels — keeps the wording consistent between
 * console output and the in-game UI.
 *
 * The signature accepts the message-less form (`Omit<...,'message'>`)
 * so the verifier's internal `recordDivergence` path can produce the
 * message *during* entry construction without a self-referential
 * detour through a placeholder. Callers with a full `DivergenceEntry`
 * pass-through fine — TypeScript widens it structurally.
 */
export function formatDivergenceMessage(
  entry: Omit<DivergenceEntry, 'message'>,
): string {
  if (entry.kind === 'malformed-record') {
    return (
      `Replay state checksum: malformed record at frame ${entry.frame} ` +
      `(algorithm=${entry.algorithm ?? 'null'}, expected=${entry.expected ?? 'null'})`
    );
  }
  return (
    `Replay state checksum: mismatch at frame ${entry.frame} ` +
    `(expected ${entry.expected}, computed ${entry.actual}, algorithm=${entry.algorithm ?? 'null'})`
  );
}

/**
 * Default logger — emits a `console.warn` with the formatted message
 * the {@link formatDivergenceMessage} helper produces. Picked because:
 *
 *   • `console.warn` is visible in browser dev tools and Node's
 *     stderr without changing the host's logging config.
 *   • A divergence is always a "you should look at this" event, never
 *     a debug-only ping; warn-level matches that severity.
 *   • The same message string flows into the in-game M4 menu, so the
 *     console emission and the menu row read identically.
 */
const DEFAULT_LOGGER: DivergenceLogger = (entry) => {
  // Wrap in a try so a console proxy with a broken `warn` doesn't take
  // down the verifier — the divergence log is still populated.
  try {
    // eslint-disable-next-line no-console
    console.warn(entry.message);
  } catch {
    /* swallow */
  }
};

// ---------------------------------------------------------------------------
// PlaybackChecksumVerifier
// ---------------------------------------------------------------------------

/**
 * Stateful per-playback-session verifier. One instance per loaded
 * replay; `reset()` returns it to its post-construction state so the
 * same verifier can be reused across rewind/seek/replay-loop without
 * reconstructing.
 *
 * Lifecycle:
 *
 *   const verifier = new PlaybackChecksumVerifier({ records });
 *   while (playback.isPlaying()) {
 *     const inputs = playback.advance();
 *     // ... step the simulation, then collect a snapshot of the state ...
 *     const snapshot: MatchStateSnapshot = collectMatchSnapshot(physicsEngine.getFrame());
 *     verifier.verifyFrame(snapshot.frame, snapshot);
 *   }
 *   if (verifier.hasDiverged()) {
 *     for (const entry of verifier.getDivergenceLog()) {
 *       console.warn('desync at frame', entry.frame);
 *     }
 *   }
 */
export class PlaybackChecksumVerifier {
  /**
   * Frame → record map. We use an object keyed by frame number (rather
   * than a `Map<number, …>` or a sorted array) for two reasons:
   *
   *   1. Lookups are O(1) — the per-step verifier hot path can't pay
   *      a binary-search cost on a ~120-pin replay (10 minutes @ 60Hz
   *      / 300-frame snapshot interval).
   *   2. Plain objects serialise trivially to JSON for diagnostics
   *      ("here are the pins this verifier holds").
   *
   * The constructor pre-populates the map; the array form preserves
   * monotonic order for `getRecords()` queries.
   */
  private readonly recordsByFrame: Map<number, StateChecksumRecord>;
  private readonly orderedRecords: ReadonlyArray<StateChecksumRecord>;
  private readonly logger: DivergenceLogger;
  private readonly stopOnDivergence: boolean;

  /** Frame-ordered divergence log; populated as mismatches fire. */
  private readonly divergences: DivergenceEntry[];

  /** Stats counters — public via `getStats()`. */
  private callCount = 0;
  private matchCount = 0;
  private mismatchCount = 0;
  private malformedCount = 0;
  private noPinCount = 0;

  constructor(options: PlaybackChecksumVerifierOptions = {}) {
    this.logger = options.logger ?? DEFAULT_LOGGER;
    this.stopOnDivergence = options.stopOnDivergence === true;
    this.divergences = [];

    const ordered = validateAndCloneRecords(options.records ?? []);
    this.orderedRecords = ordered;
    const map = new Map<number, StateChecksumRecord>();
    for (const r of ordered) {
      map.set(r.frame, r);
    }
    this.recordsByFrame = map;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Number of recorded pins this verifier was constructed with. */
  getRecordCount(): number {
    return this.orderedRecords.length;
  }

  /** Frame-ordered view of the records, for tooling / tests. */
  getRecords(): ReadonlyArray<StateChecksumRecord> {
    return this.orderedRecords;
  }

  /**
   * Recorded checksum for `frame`, or `null` if no pin exists at that
   * frame. O(1) — the same lookup path the verifier hot path uses.
   */
  getRecordAt(frame: number): StateChecksumRecord | null {
    return this.recordsByFrame.get(frame) ?? null;
  }

  /**
   * Frame-ordered divergence list. Read-only — the verifier owns the
   * underlying array. Callers wanting to mutate make a copy.
   */
  getDivergenceLog(): ReadonlyArray<DivergenceEntry> {
    return this.divergences;
  }

  /** Aggregate stats snapshot. Frozen so the M4 HUD can hold onto it. */
  getStats(): VerifierStats {
    return Object.freeze({
      callCount: this.callCount,
      matchCount: this.matchCount,
      mismatchCount: this.mismatchCount,
      malformedCount: this.malformedCount,
      noPinCount: this.noPinCount,
      recordCount: this.orderedRecords.length,
      hasDiverged: this.divergences.length > 0,
    });
  }

  /**
   * Convenience boolean — true iff at least one mismatch or
   * malformed-record entry has been logged. The M4 menu surfaces a
   * "Replay desynced" banner when this flips.
   */
  hasDiverged(): boolean {
    return this.divergences.length > 0;
  }

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------

  /**
   * Verify the live state at `frame` against the recorded pin (if any).
   *
   *   • If no pin exists at `frame`, returns `'no-pin'` without
   *     computing the live checksum (the hot path stays cheap).
   *   • If a pin exists and the live checksum matches, returns
   *     `'match'` and increments the match counter.
   *   • If the pin is structurally invalid (wrong algorithm, non-hex
   *     string), logs a `'malformed-record'` divergence and returns.
   *   • Otherwise, logs a `'mismatch'` divergence and returns. When
   *     `stopOnDivergence` is set, throws {@link ReplayIntegrityError}
   *     on the first mismatch — a CI harness uses this to fail fast.
   *
   * The `snapshot.frame` field MUST equal `frame` — passing them
   * separately is only for ergonomics (the cursor and the snapshot
   * frame are usually the same value at the call site). Mismatch
   * throws synchronously since this would silently invalidate every
   * subsequent verification.
   */
  verifyFrame(frame: number, snapshot: MatchStateSnapshot): VerificationResult {
    if (!Number.isInteger(frame) || frame < 0) {
      throw new Error(
        `PlaybackChecksumVerifier.verifyFrame: frame must be a non-negative ` +
          `integer, got ${String(frame)}`,
      );
    }
    if (snapshot === null || typeof snapshot !== 'object') {
      throw new Error(
        `PlaybackChecksumVerifier.verifyFrame: snapshot must be a non-null object`,
      );
    }
    if (snapshot.frame !== frame) {
      throw new Error(
        `PlaybackChecksumVerifier.verifyFrame: snapshot.frame (${snapshot.frame}) ` +
          `disagrees with verifyFrame argument (${frame})`,
      );
    }
    this.callCount += 1;

    const record = this.recordsByFrame.get(frame);
    if (record === undefined) {
      this.noPinCount += 1;
      return Object.freeze({
        outcome: 'no-pin' as const,
        frame,
        expected: null,
        actual: null,
        algorithm: null,
      });
    }

    // Defensive: the constructor's record validation should have caught
    // a malformed record already, but a caller that built records by
    // hand and bypassed the validator (or a record loaded from a
    // partially-validated file) might still slip through. We re-check
    // here so the verifier's per-frame contract is independent of how
    // its records were sourced.
    if (
      record.algorithm !== STATE_CHECKSUM_ALGORITHM ||
      !isWellFormedChecksum(record.checksum)
    ) {
      const actual = computeStateChecksum(snapshot);
      const entry = this.recordDivergence({
        frame,
        kind: 'malformed-record',
        expected: typeof record.checksum === 'string' ? record.checksum : null,
        actual,
        algorithm: typeof record.algorithm === 'string' ? record.algorithm : null,
      });
      if (this.stopOnDivergence) {
        throw new ReplayIntegrityError(
          'unsupported',
          entry.message,
          {
            expected: entry.expected,
            actual: entry.actual,
            algorithm: entry.algorithm,
          },
        );
      }
      return Object.freeze({
        outcome: 'malformed-record' as const,
        frame,
        expected: entry.expected,
        actual,
        algorithm: entry.algorithm,
      });
    }

    const actual = computeStateChecksum(snapshot);
    if (actual === record.checksum) {
      this.matchCount += 1;
      return Object.freeze({
        outcome: 'match' as const,
        frame,
        expected: record.checksum,
        actual,
        algorithm: record.algorithm,
      });
    }

    const entry = this.recordDivergence({
      frame,
      kind: 'mismatch',
      expected: record.checksum,
      actual,
      algorithm: record.algorithm,
    });
    if (this.stopOnDivergence) {
      throw new ReplayIntegrityError('mismatch', entry.message, {
        expected: entry.expected,
        actual: entry.actual,
        algorithm: entry.algorithm,
      });
    }
    return Object.freeze({
      outcome: 'mismatch' as const,
      frame,
      expected: record.checksum,
      actual,
      algorithm: record.algorithm,
    });
  }

  /**
   * Convenience: collect the live snapshot's checksum *and* the
   * verification result in one call. Used by the M4 replay menu's
   * "diagnose desync" view, which wants both the canonical string
   * (for side-by-side display) and the verification verdict.
   */
  verifyFrameWithDetail(
    frame: number,
    snapshot: MatchStateSnapshot,
  ): {
    readonly result: VerificationResult;
    readonly canonicalString: string;
  } {
    const canonicalString = serializeStateForChecksum(snapshot);
    const result = this.verifyFrame(frame, snapshot);
    return Object.freeze({ result, canonicalString });
  }

  /**
   * Reset the verifier to its post-construction state — clears the
   * divergence log and the stats counters but keeps the records and
   * options. Use after a scrub-back so a re-played stretch doesn't
   * double-count divergences.
   */
  reset(): void {
    this.divergences.length = 0;
    this.callCount = 0;
    this.matchCount = 0;
    this.mismatchCount = 0;
    this.malformedCount = 0;
    this.noPinCount = 0;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Append a divergence entry to the log, tick the stats counters,
   * and fire the logger. Returns the frozen entry for the caller to
   * embed in its return value.
   */
  private recordDivergence(args: {
    frame: number;
    kind: 'mismatch' | 'malformed-record';
    expected: string | null;
    actual: string;
    algorithm: string | null;
  }): DivergenceEntry {
    const partial: Omit<DivergenceEntry, 'message'> = {
      frame: args.frame,
      kind: args.kind,
      expected: args.expected,
      actual: args.actual,
      algorithm: args.algorithm,
    };
    const message = formatDivergenceMessage(partial);
    const entry: DivergenceEntry = Object.freeze({ ...partial, message });
    this.divergences.push(entry);
    if (args.kind === 'mismatch') this.mismatchCount += 1;
    else this.malformedCount += 1;

    // Fire the logger last — its `console.warn` (or a test-injected
    // recorder) sees the entry the way it appears in `getDivergenceLog`.
    try {
      this.logger(entry);
    } catch {
      // A user-supplied logger that throws should never crash the
      // verifier — the divergence log is still authoritative.
    }
    return entry;
  }
}

// ---------------------------------------------------------------------------
// Internal — record validation
// ---------------------------------------------------------------------------

/**
 * Validate a record list and freeze it for storage. Rules:
 *
 *   • Every entry must be a structurally valid `StateChecksumRecord`
 *     (well-formed checksum, recognised algorithm, integer frame ≥ 0).
 *   • Frames must be strictly monotonic — duplicate frames would mean
 *     two recorded values for the same simulation step, which the
 *     determinism contract forbids.
 *
 * Returns a fresh frozen array — the verifier owns its copy and a
 * caller mutating its source after construction cannot retroactively
 * change verification behaviour.
 */
function validateAndCloneRecords(
  records: ReadonlyArray<StateChecksumRecord>,
): ReadonlyArray<StateChecksumRecord> {
  if (!Array.isArray(records)) {
    throw new Error(
      `PlaybackChecksumVerifier: records must be an array, got ${typeof records}`,
    );
  }
  const out: StateChecksumRecord[] = new Array(records.length);
  let prevFrame = -1;
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    if (r === null || typeof r !== 'object') {
      throw new Error(
        `PlaybackChecksumVerifier: records[${i}] must be a non-null object`,
      );
    }
    if (!Number.isInteger(r.frame) || r.frame < 0) {
      throw new Error(
        `PlaybackChecksumVerifier: records[${i}].frame must be a non-negative ` +
          `integer, got ${String(r.frame)}`,
      );
    }
    if (r.frame <= prevFrame) {
      throw new Error(
        `PlaybackChecksumVerifier: records[${i}].frame (${r.frame}) is not ` +
          `strictly greater than previous frame (${prevFrame}) — pins must be ` +
          `monotonic`,
      );
    }
    if (typeof r.checksum !== 'string') {
      throw new Error(
        `PlaybackChecksumVerifier: records[${i}].checksum must be a string`,
      );
    }
    if (typeof r.algorithm !== 'string') {
      throw new Error(
        `PlaybackChecksumVerifier: records[${i}].algorithm must be a string`,
      );
    }
    // Note: we don't reject malformed checksum / unknown algorithm at
    // construction — the verifier's per-frame path surfaces those as
    // `'malformed-record'` divergences with full context. This is a
    // policy choice: a hand-edited file with one corrupt pin should
    // still verify the *other* pins (most of the file is recoverable
    // diagnostics) rather than refuse to load entirely.
    out[i] = Object.freeze({
      frame: r.frame,
      checksum: r.checksum,
      algorithm: r.algorithm,
    });
    prevFrame = r.frame;
  }
  return Object.freeze(out);
}
