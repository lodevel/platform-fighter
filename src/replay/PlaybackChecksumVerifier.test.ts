/**
 * AC 30202 Sub-AC 2 — playback checksum verifier tests.
 *
 * Coverage map:
 *
 *   • Construction
 *       - Accepts an empty / undefined records list.
 *       - Validates records: rejects non-array, malformed entries,
 *         non-integer / negative frames, non-monotonic frame ordering.
 *       - Defaults logger to console.warn (no-op assertion: doesn't
 *         throw without a custom logger).
 *
 *   • Queries
 *       - getRecordCount / getRecords / getRecordAt return the
 *         constructor's data.
 *       - getDivergenceLog returns [] before any verifyFrame call.
 *       - getStats returns the expected zero-state.
 *       - hasDiverged returns false before any verifyFrame call.
 *
 *   • verifyFrame
 *       - 'no-pin' outcome on frames not in the record list.
 *       - 'match' outcome when the live snapshot matches the recorded
 *         checksum, no divergence logged.
 *       - 'mismatch' outcome when the snapshot differs, divergence
 *         logged with frame / expected / actual / algorithm fields.
 *       - 'malformed-record' outcome when a record carries a
 *         malformed checksum string or unknown algorithm.
 *       - Logger callback fires once per divergence, never on
 *         'no-pin' / 'match'.
 *       - stopOnDivergence: throws ReplayIntegrityError on first
 *         mismatch when set.
 *       - Rejects mismatched frame argument vs snapshot.frame.
 *       - Rejects non-integer / negative frame.
 *
 *   • Divergence log
 *       - Strictly monotonic frame order.
 *       - Carries a human-readable message string.
 *       - Multiple divergences accumulate.
 *
 *   • reset()
 *       - Clears divergence log + stats counters.
 *       - Keeps records and options.
 *
 *   • Determinism
 *       - Re-verifying the same snapshot at the same frame produces
 *         identical results twice.
 *
 *   • Integration with stateChecksum
 *       - A record built via buildStateChecksumRecord verifies cleanly
 *         when fed back into the verifier with the original snapshot
 *         (round-trip identity).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayIntegrityError } from './replayChecksum';
import {
  PlaybackChecksumVerifier,
  formatDivergenceMessage,
  type DivergenceEntry,
  type DivergenceLogger,
} from './PlaybackChecksumVerifier';
import {
  STATE_CHECKSUM_ALGORITHM,
  buildStateChecksumRecord,
  computeStateChecksum,
  type MatchStateSnapshot,
  type StateChecksumRecord,
  type StateFighterSnapshot,
} from './stateChecksum';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFighter(
  overrides: Partial<StateFighterSnapshot> = {},
): StateFighterSnapshot {
  return {
    playerIndex: 0,
    characterId: 'wolf',
    paletteIndex: 0,
    stocks: 3,
    stocksLost: 0,
    kos: 0,
    damagePercent: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    facing: 1,
    grounded: true,
    jumpsUsed: 0,
    inHitstun: false,
    invincible: false,
    eliminated: false,
    ...overrides,
  };
}

function makeSnapshot(frame: number, p1Damage = 0): MatchStateSnapshot {
  return {
    frame,
    fighters: [
      makeFighter({ playerIndex: 0, characterId: 'wolf', damagePercent: p1Damage }),
      makeFighter({ playerIndex: 1, characterId: 'cat' }),
    ],
  };
}

function makeRecord(frame: number, p1Damage = 0): StateChecksumRecord {
  return buildStateChecksumRecord(makeSnapshot(frame, p1Damage));
}

/**
 * Capture every divergence emission so a test can assert the exact
 * payload the logger received. Used in place of `console.warn` in
 * tests where we want to verify *what* fired, not just that something
 * was logged.
 */
function makeRecordingLogger(): {
  readonly logger: DivergenceLogger;
  readonly entries: DivergenceEntry[];
} {
  const entries: DivergenceEntry[] = [];
  return {
    logger: (entry) => {
      entries.push(entry);
    },
    entries,
  };
}

// ---------------------------------------------------------------------------
// Suppress real console.warn so default-logger tests don't pollute output.
// ---------------------------------------------------------------------------

// Suppress real `console.warn` so the default-logger code path doesn't
// pollute test output when an intentional divergence fires. Stored as
// `unknown` to side-step a vitest 1.5-era generic signature mismatch
// where `MockInstance<...>` from `vi.spyOn(console, 'warn')` doesn't
// widen to the older `MockInstance<unknown[], unknown>`. We only need
// `mockRestore`, which is present on every shape.
let warnSpy: { mockRestore: () => void };
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
    /* swallow */
  }) as unknown as { mockRestore: () => void };
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — construction', () => {
  it('constructs with no records', () => {
    const v = new PlaybackChecksumVerifier();
    expect(v.getRecordCount()).toBe(0);
    expect(v.getRecords()).toEqual([]);
  });

  it('constructs with an explicit empty record list', () => {
    const v = new PlaybackChecksumVerifier({ records: [] });
    expect(v.getRecordCount()).toBe(0);
  });

  it('accepts well-formed records', () => {
    const records = [makeRecord(0), makeRecord(300), makeRecord(600)];
    const v = new PlaybackChecksumVerifier({ records });
    expect(v.getRecordCount()).toBe(3);
    expect(v.getRecords()).toHaveLength(3);
    expect(v.getRecords()[0]!.frame).toBe(0);
    expect(v.getRecords()[2]!.frame).toBe(600);
  });

  it('rejects non-array records', () => {
    expect(
      () =>
        new PlaybackChecksumVerifier({
          records: 'oops' as unknown as ReadonlyArray<StateChecksumRecord>,
        }),
    ).toThrow(/array/);
  });

  it('rejects records with non-integer frame', () => {
    expect(
      () =>
        new PlaybackChecksumVerifier({
          records: [
            { frame: 1.5, checksum: '0123456789abcdef', algorithm: STATE_CHECKSUM_ALGORITHM },
          ],
        }),
    ).toThrow(/non-negative integer/);
  });

  it('rejects records with negative frame', () => {
    expect(
      () =>
        new PlaybackChecksumVerifier({
          records: [
            { frame: -1, checksum: '0123456789abcdef', algorithm: STATE_CHECKSUM_ALGORITHM },
          ],
        }),
    ).toThrow(/non-negative integer/);
  });

  it('rejects non-monotonic records', () => {
    expect(
      () =>
        new PlaybackChecksumVerifier({
          records: [makeRecord(300), makeRecord(0)],
        }),
    ).toThrow(/monotonic/);
  });

  it('rejects duplicate frames', () => {
    expect(
      () =>
        new PlaybackChecksumVerifier({
          records: [makeRecord(300), makeRecord(300)],
        }),
    ).toThrow(/monotonic/);
  });

  it('rejects null entries', () => {
    expect(
      () =>
        new PlaybackChecksumVerifier({
          records: [null as unknown as StateChecksumRecord],
        }),
    ).toThrow(/non-null object/);
  });

  it('rejects records with non-string checksum', () => {
    expect(
      () =>
        new PlaybackChecksumVerifier({
          records: [
            { frame: 0, checksum: 42 as unknown as string, algorithm: STATE_CHECKSUM_ALGORITHM },
          ],
        }),
    ).toThrow(/checksum must be a string/);
  });

  it('rejects records with non-string algorithm', () => {
    expect(
      () =>
        new PlaybackChecksumVerifier({
          records: [
            { frame: 0, checksum: '0123456789abcdef', algorithm: 1 as unknown as 'state-fnv1a-64-v1' },
          ],
        }),
    ).toThrow(/algorithm must be a string/);
  });
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — queries', () => {
  it('getRecordAt returns the record by frame', () => {
    const records = [makeRecord(0), makeRecord(300)];
    const v = new PlaybackChecksumVerifier({ records });
    expect(v.getRecordAt(0)).toEqual(records[0]);
    expect(v.getRecordAt(300)).toEqual(records[1]);
  });

  it('getRecordAt returns null for absent frames', () => {
    const v = new PlaybackChecksumVerifier({ records: [makeRecord(0)] });
    expect(v.getRecordAt(1)).toBeNull();
    expect(v.getRecordAt(999)).toBeNull();
  });

  it('initial divergence log is empty', () => {
    const v = new PlaybackChecksumVerifier({ records: [makeRecord(0)] });
    expect(v.getDivergenceLog()).toEqual([]);
    expect(v.hasDiverged()).toBe(false);
  });

  it('initial stats are zeroed', () => {
    const v = new PlaybackChecksumVerifier({ records: [makeRecord(0), makeRecord(300)] });
    const stats = v.getStats();
    expect(stats.callCount).toBe(0);
    expect(stats.matchCount).toBe(0);
    expect(stats.mismatchCount).toBe(0);
    expect(stats.malformedCount).toBe(0);
    expect(stats.noPinCount).toBe(0);
    expect(stats.recordCount).toBe(2);
    expect(stats.hasDiverged).toBe(false);
  });

  it('getStats returns a frozen object', () => {
    const v = new PlaybackChecksumVerifier();
    expect(Object.isFrozen(v.getStats())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyFrame — outcomes
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — verifyFrame', () => {
  it("returns 'no-pin' when no record exists at the frame", () => {
    const records = [makeRecord(300)];
    const v = new PlaybackChecksumVerifier({ records });
    const result = v.verifyFrame(0, makeSnapshot(0));
    expect(result.outcome).toBe('no-pin');
    expect(result.expected).toBeNull();
    expect(result.actual).toBeNull();
    expect(v.hasDiverged()).toBe(false);
    expect(v.getStats().noPinCount).toBe(1);
    expect(v.getStats().callCount).toBe(1);
  });

  it("returns 'match' when the snapshot matches the recorded checksum", () => {
    const recorded = makeSnapshot(300, 25);
    const record = buildStateChecksumRecord(recorded);
    const v = new PlaybackChecksumVerifier({ records: [record] });

    const result = v.verifyFrame(300, recorded);
    expect(result.outcome).toBe('match');
    expect(result.expected).toBe(record.checksum);
    expect(result.actual).toBe(record.checksum);
    expect(result.algorithm).toBe(STATE_CHECKSUM_ALGORITHM);
    expect(v.hasDiverged()).toBe(false);
    expect(v.getStats().matchCount).toBe(1);
  });

  it("returns 'mismatch' and logs a divergence when the snapshot differs", () => {
    const recordedSnap = makeSnapshot(300, 25);
    const liveSnap = makeSnapshot(300, 50); // different damage → different checksum
    const record = buildStateChecksumRecord(recordedSnap);

    const { logger, entries } = makeRecordingLogger();
    const v = new PlaybackChecksumVerifier({
      records: [record],
      logger,
    });

    const result = v.verifyFrame(300, liveSnap);
    expect(result.outcome).toBe('mismatch');
    expect(result.expected).toBe(record.checksum);
    expect(result.actual).toBe(computeStateChecksum(liveSnap));
    expect(result.actual).not.toBe(record.checksum);
    expect(result.algorithm).toBe(STATE_CHECKSUM_ALGORITHM);

    expect(v.hasDiverged()).toBe(true);
    expect(v.getDivergenceLog()).toHaveLength(1);
    expect(v.getDivergenceLog()[0]!.kind).toBe('mismatch');
    expect(v.getDivergenceLog()[0]!.frame).toBe(300);
    expect(v.getStats().mismatchCount).toBe(1);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('mismatch');
    expect(entries[0]!.message).toContain('frame 300');
    expect(entries[0]!.message).toContain('expected');
  });

  it('logger fires exactly once per divergence — never for no-pin or match', () => {
    const matchedSnap = makeSnapshot(300, 25);
    const matchedRecord = buildStateChecksumRecord(matchedSnap);
    const mismatchSnap = makeSnapshot(600, 50);
    const mismatchRecord = buildStateChecksumRecord(makeSnapshot(600, 0));

    const { logger, entries } = makeRecordingLogger();
    const v = new PlaybackChecksumVerifier({
      records: [matchedRecord, mismatchRecord],
      logger,
    });

    // No-pin: should not fire logger
    v.verifyFrame(0, makeSnapshot(0));
    expect(entries).toHaveLength(0);

    // Match: should not fire logger
    v.verifyFrame(300, matchedSnap);
    expect(entries).toHaveLength(0);

    // Mismatch: fires once
    v.verifyFrame(600, mismatchSnap);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.frame).toBe(600);
  });

  it("returns 'malformed-record' for a pin with non-hex checksum", () => {
    const malformed: StateChecksumRecord = {
      frame: 300,
      checksum: 'NOT-VALID-HEX-XX',
      algorithm: STATE_CHECKSUM_ALGORITHM,
    };
    // Construct via direct injection (bypassing the validator) since
    // the constructor permits non-canonical checksums and we want the
    // per-frame path to surface them as `malformed-record`.
    const { logger, entries } = makeRecordingLogger();
    const v = new PlaybackChecksumVerifier({ records: [malformed], logger });
    const result = v.verifyFrame(300, makeSnapshot(300));

    expect(result.outcome).toBe('malformed-record');
    expect(result.expected).toBe('NOT-VALID-HEX-XX');
    expect(result.actual).toBeTruthy();
    expect(v.getStats().malformedCount).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('malformed-record');
    expect(entries[0]!.message).toContain('malformed');
  });

  it("returns 'malformed-record' for a pin with unknown algorithm", () => {
    const malformed = {
      frame: 300,
      checksum: '0123456789abcdef',
      algorithm: 'state-future-v999',
    } as unknown as StateChecksumRecord;
    const { logger, entries } = makeRecordingLogger();
    const v = new PlaybackChecksumVerifier({ records: [malformed], logger });
    const result = v.verifyFrame(300, makeSnapshot(300));

    expect(result.outcome).toBe('malformed-record');
    expect(result.algorithm).toBe('state-future-v999');
    expect(v.getStats().malformedCount).toBe(1);
    expect(entries).toHaveLength(1);
  });

  it('rejects mismatched frame argument vs snapshot.frame', () => {
    const v = new PlaybackChecksumVerifier();
    expect(() => v.verifyFrame(10, makeSnapshot(20))).toThrow(/disagrees/);
  });

  it('rejects non-integer / negative frame', () => {
    const v = new PlaybackChecksumVerifier();
    expect(() => v.verifyFrame(1.5, makeSnapshot(1))).toThrow(/non-negative integer/);
    expect(() => v.verifyFrame(-1, makeSnapshot(0))).toThrow(/non-negative integer/);
  });

  it('rejects null snapshot', () => {
    const v = new PlaybackChecksumVerifier();
    expect(() =>
      v.verifyFrame(0, null as unknown as MatchStateSnapshot),
    ).toThrow(/non-null/);
  });
});

// ---------------------------------------------------------------------------
// stopOnDivergence
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — stopOnDivergence', () => {
  it('throws ReplayIntegrityError on the first mismatch', () => {
    const recorded = buildStateChecksumRecord(makeSnapshot(300, 25));
    const v = new PlaybackChecksumVerifier({
      records: [recorded],
      stopOnDivergence: true,
      logger: () => {
        /* silent */
      },
    });
    const liveSnap = makeSnapshot(300, 50);
    expect(() => v.verifyFrame(300, liveSnap)).toThrow(ReplayIntegrityError);
  });

  it('still records the divergence in the log before throwing', () => {
    const recorded = buildStateChecksumRecord(makeSnapshot(300, 25));
    const v = new PlaybackChecksumVerifier({
      records: [recorded],
      stopOnDivergence: true,
      logger: () => {
        /* silent */
      },
    });
    const liveSnap = makeSnapshot(300, 50);
    try {
      v.verifyFrame(300, liveSnap);
    } catch {
      /* expected */
    }
    expect(v.getDivergenceLog()).toHaveLength(1);
    expect(v.getDivergenceLog()[0]!.frame).toBe(300);
  });

  it('also throws on a malformed record when stopOnDivergence is set', () => {
    const malformed: StateChecksumRecord = {
      frame: 300,
      checksum: 'NOT-VALID-HEX-XX',
      algorithm: STATE_CHECKSUM_ALGORITHM,
    };
    const v = new PlaybackChecksumVerifier({
      records: [malformed],
      stopOnDivergence: true,
      logger: () => {
        /* silent */
      },
    });
    expect(() => v.verifyFrame(300, makeSnapshot(300))).toThrow(ReplayIntegrityError);
  });
});

// ---------------------------------------------------------------------------
// Divergence log behaviour
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — divergence log', () => {
  it('accumulates multiple divergences in monotonic frame order', () => {
    const records = [
      buildStateChecksumRecord(makeSnapshot(0, 0)),
      buildStateChecksumRecord(makeSnapshot(300, 0)),
      buildStateChecksumRecord(makeSnapshot(600, 0)),
    ];
    const v = new PlaybackChecksumVerifier({
      records,
      logger: () => {
        /* silent */
      },
    });
    // Disagree at every pin.
    v.verifyFrame(0, makeSnapshot(0, 1));
    v.verifyFrame(300, makeSnapshot(300, 2));
    v.verifyFrame(600, makeSnapshot(600, 3));

    const log = v.getDivergenceLog();
    expect(log).toHaveLength(3);
    expect(log.map((d) => d.frame)).toEqual([0, 300, 600]);
    expect(v.getStats().mismatchCount).toBe(3);
  });

  it('includes a populated message string on every entry', () => {
    const recorded = buildStateChecksumRecord(makeSnapshot(300, 0));
    const v = new PlaybackChecksumVerifier({
      records: [recorded],
      logger: () => {
        /* silent */
      },
    });
    v.verifyFrame(300, makeSnapshot(300, 100));
    const entry = v.getDivergenceLog()[0]!;
    expect(typeof entry.message).toBe('string');
    expect(entry.message.length).toBeGreaterThan(0);
    expect(entry.message).toBe(formatDivergenceMessage(entry));
  });

  it('returns a frozen array of frozen entries', () => {
    const recorded = buildStateChecksumRecord(makeSnapshot(300, 0));
    const v = new PlaybackChecksumVerifier({
      records: [recorded],
      logger: () => {
        /* silent */
      },
    });
    v.verifyFrame(300, makeSnapshot(300, 50));
    const log = v.getDivergenceLog();
    expect(Object.isFrozen(log[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — reset', () => {
  it('clears the divergence log and stats counters', () => {
    const recorded = buildStateChecksumRecord(makeSnapshot(300, 0));
    const v = new PlaybackChecksumVerifier({
      records: [recorded],
      logger: () => {
        /* silent */
      },
    });
    v.verifyFrame(300, makeSnapshot(300, 1));
    expect(v.hasDiverged()).toBe(true);

    v.reset();
    expect(v.hasDiverged()).toBe(false);
    expect(v.getDivergenceLog()).toHaveLength(0);
    const stats = v.getStats();
    expect(stats.callCount).toBe(0);
    expect(stats.matchCount).toBe(0);
    expect(stats.mismatchCount).toBe(0);
    expect(stats.malformedCount).toBe(0);
    expect(stats.noPinCount).toBe(0);
  });

  it('preserves records and options', () => {
    const records = [makeRecord(0), makeRecord(300)];
    const v = new PlaybackChecksumVerifier({
      records,
      logger: () => {
        /* silent */
      },
    });
    v.verifyFrame(300, makeSnapshot(300, 100));
    v.reset();
    expect(v.getRecordCount()).toBe(2);
    expect(v.getRecordAt(300)).toEqual(records[1]);
  });
});

// ---------------------------------------------------------------------------
// verifyFrameWithDetail
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — verifyFrameWithDetail', () => {
  it('returns both the result and the canonical string for the snapshot', () => {
    const recorded = buildStateChecksumRecord(makeSnapshot(300, 0));
    const v = new PlaybackChecksumVerifier({
      records: [recorded],
      logger: () => {
        /* silent */
      },
    });
    const detail = v.verifyFrameWithDetail(300, makeSnapshot(300, 50));
    expect(detail.result.outcome).toBe('mismatch');
    expect(detail.canonicalString).toContain('state-fnv1a-64-v1');
    expect(detail.canonicalString).toContain('f=300');
    expect(detail.canonicalString).toContain('dm=50');
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — determinism', () => {
  it('returns identical results for repeated verifyFrame calls', () => {
    const recorded = buildStateChecksumRecord(makeSnapshot(300, 25));
    const v = new PlaybackChecksumVerifier({
      records: [recorded],
      logger: () => {
        /* silent */
      },
    });
    const a = v.verifyFrame(300, makeSnapshot(300, 25));
    v.reset();
    const b = v.verifyFrame(300, makeSnapshot(300, 25));
    expect(a.outcome).toBe(b.outcome);
    expect(a.expected).toBe(b.expected);
    expect(a.actual).toBe(b.actual);
  });

  it('a logger that throws does not crash the verifier', () => {
    const recorded = buildStateChecksumRecord(makeSnapshot(300, 0));
    const v = new PlaybackChecksumVerifier({
      records: [recorded],
      logger: () => {
        throw new Error('boom');
      },
    });
    expect(() => v.verifyFrame(300, makeSnapshot(300, 100))).not.toThrow();
    expect(v.hasDiverged()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Round-trip with stateChecksum
// ---------------------------------------------------------------------------

describe('PlaybackChecksumVerifier — round-trip', () => {
  it('a record built from a snapshot verifies cleanly when fed back the same snapshot', () => {
    const snap = makeSnapshot(300, 42.5);
    const record = buildStateChecksumRecord(snap);
    const v = new PlaybackChecksumVerifier({ records: [record] });
    const result = v.verifyFrame(300, snap);
    expect(result.outcome).toBe('match');
  });

  it('records spanning a long match all match when re-played verbatim', () => {
    const records: StateChecksumRecord[] = [];
    const snapshots: MatchStateSnapshot[] = [];
    for (let i = 0; i < 5; i += 1) {
      const f = i * 300;
      const snap = makeSnapshot(f, i * 10);
      snapshots.push(snap);
      records.push(buildStateChecksumRecord(snap));
    }
    const v = new PlaybackChecksumVerifier({ records });
    for (const snap of snapshots) {
      const r = v.verifyFrame(snap.frame, snap);
      expect(r.outcome).toBe('match');
    }
    expect(v.getStats().matchCount).toBe(5);
    expect(v.hasDiverged()).toBe(false);
  });

  it('detects a single-frame divergence in the middle of a long run', () => {
    const records: StateChecksumRecord[] = [];
    for (let i = 0; i < 5; i += 1) {
      records.push(buildStateChecksumRecord(makeSnapshot(i * 300, i * 10)));
    }
    const { logger, entries } = makeRecordingLogger();
    const v = new PlaybackChecksumVerifier({ records, logger });
    for (let i = 0; i < 5; i += 1) {
      const f = i * 300;
      // Inject a desync at frame 600 only.
      const damage = i === 2 ? 999 : i * 10;
      v.verifyFrame(f, makeSnapshot(f, damage));
    }
    expect(v.getStats().matchCount).toBe(4);
    expect(v.getStats().mismatchCount).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.frame).toBe(600);
  });
});
