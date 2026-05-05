/**
 * AC 30203 Sub-AC 3 — desync recovery controller tests.
 *
 * Coverage map:
 *
 *   • Construction
 *       - Requires verifier, defaults tolerance to 'continue'.
 *       - Validates tolerance shape (rejects bad maxDivergences /
 *         maxConsecutivePins).
 *       - Validates maxReportRows.
 *
 *   • ingest()
 *       - Pass-through outcomes ('no-pin', 'match') return 'continue'.
 *       - Mismatch / malformed-record append a divergence and return
 *         the policy's verdict.
 *       - 'continue' policy never halts; verdict transitions through
 *         pending → fail-continued only after `finish()`.
 *       - 'halt-on-first' halts on the first divergence.
 *       - 'halt-on-threshold' halts once maxDivergences is reached.
 *       - 'halt-on-threshold' with maxConsecutivePins triggers when
 *         consecutive divergences hit the limit (and is reset by an
 *         intervening match).
 *
 *   • Idempotence after halt
 *       - Subsequent ingest() calls keep returning 'halt' but don't
 *         grow the report's divergence list.
 *
 *   • Callbacks
 *       - onHalt fires exactly once.
 *       - onDivergence fires for every divergence regardless of policy.
 *       - Throwing callbacks don't crash the controller.
 *
 *   • Lifecycle
 *       - finish() turns 'pending' into 'pass' or 'fail-continued'.
 *       - halt() stamps the verdict + halt frame even without an
 *         in-flight divergence.
 *       - reset() clears state but preserves the verifier reference.
 *
 *   • Reports
 *       - getReport() returns frozen objects.
 *       - divergence list is capped at maxReportRows; oldest entries
 *         drop off.
 *       - recordCount mirrors the verifier.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DesyncRecoveryController,
  type DesyncTolerancePolicy,
} from './DesyncRecoveryController';
import {
  PlaybackChecksumVerifier,
  type DivergenceLogger,
  type DivergenceEntry,
} from './PlaybackChecksumVerifier';
import {
  buildStateChecksumRecord,
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

/** Quiet logger so default-logger paths don't pollute stdout. */
const SILENT_LOGGER: DivergenceLogger = () => {};

let warnSpy: { mockRestore: () => void };
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
    /* swallow */
  }) as unknown as { mockRestore: () => void };
});
afterEach(() => {
  warnSpy.mockRestore();
});

function makeVerifier(
  records: ReadonlyArray<StateChecksumRecord>,
): PlaybackChecksumVerifier {
  return new PlaybackChecksumVerifier({ records, logger: SILENT_LOGGER });
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — construction', () => {
  it('requires a verifier', () => {
    expect(
      () =>
        new DesyncRecoveryController(
          undefined as unknown as { verifier: PlaybackChecksumVerifier },
        ),
    ).toThrow();
    expect(
      () =>
        new DesyncRecoveryController(
          { verifier: null } as unknown as {
            verifier: PlaybackChecksumVerifier;
          },
        ),
    ).toThrow(/verifier/);
  });

  it('defaults tolerance to continue', () => {
    const verifier = makeVerifier([]);
    const c = new DesyncRecoveryController({ verifier });
    expect(c.getTolerance()).toEqual({ kind: 'continue' });
  });

  it('rejects malformed tolerance — non-integer maxDivergences', () => {
    const verifier = makeVerifier([]);
    expect(
      () =>
        new DesyncRecoveryController({
          verifier,
          tolerance: {
            kind: 'halt-on-threshold',
            maxDivergences: 1.5,
          } as unknown as DesyncTolerancePolicy,
        }),
    ).toThrow(/maxDivergences/);
  });

  it('rejects malformed tolerance — zero maxDivergences', () => {
    const verifier = makeVerifier([]);
    expect(
      () =>
        new DesyncRecoveryController({
          verifier,
          tolerance: { kind: 'halt-on-threshold', maxDivergences: 0 },
        }),
    ).toThrow(/maxDivergences/);
  });

  it('rejects malformed tolerance — bad maxConsecutivePins', () => {
    const verifier = makeVerifier([]);
    expect(
      () =>
        new DesyncRecoveryController({
          verifier,
          tolerance: {
            kind: 'halt-on-threshold',
            maxDivergences: 5,
            maxConsecutivePins: 1,
          },
        }),
    ).toThrow(/maxConsecutivePins/);
  });

  it('rejects unknown tolerance kind', () => {
    const verifier = makeVerifier([]);
    expect(
      () =>
        new DesyncRecoveryController({
          verifier,
          tolerance: { kind: 'fancy' } as unknown as DesyncTolerancePolicy,
        }),
    ).toThrow();
  });

  it('rejects malformed maxReportRows', () => {
    const verifier = makeVerifier([]);
    expect(
      () =>
        new DesyncRecoveryController({
          verifier,
          maxReportRows: 0,
        }),
    ).toThrow(/maxReportRows/);
    expect(
      () =>
        new DesyncRecoveryController({
          verifier,
          maxReportRows: 1.5,
        }),
    ).toThrow(/maxReportRows/);
  });

  it('initial report is pending / idle', () => {
    const verifier = makeVerifier([makeRecord(300)]);
    const c = new DesyncRecoveryController({ verifier });
    const report = c.getReport();
    expect(report.verdict).toBe('pending');
    expect(report.status).toBe('idle');
    expect(report.framesObserved).toBe(0);
    expect(report.divergenceCount).toBe(0);
    expect(report.recordCount).toBe(1);
    expect(report.divergences).toHaveLength(0);
    expect(report.diffSummary).toHaveLength(0);
    expect(report.haltedAtFrame).toBeNull();
    expect(report.haltReason).toBeNull();
    expect(Object.isFrozen(report)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ingest — pass-through outcomes
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — ingest pass-throughs', () => {
  it("returns 'continue' on no-pin", () => {
    const verifier = makeVerifier([makeRecord(300)]);
    const c = new DesyncRecoveryController({ verifier });
    const result = verifier.verifyFrame(0, makeSnapshot(0));
    const decision = c.ingest(result);
    expect(decision.action).toBe('continue');
    expect(decision.outcome).toBe('no-pin');
    expect(decision.divergence).toBeNull();
    expect(c.getStatus()).toBe('monitoring');
    expect(c.hasDiverged()).toBe(false);
  });

  it("returns 'continue' on match", () => {
    const recorded = makeSnapshot(300, 25);
    const verifier = makeVerifier([buildStateChecksumRecord(recorded)]);
    const c = new DesyncRecoveryController({ verifier });
    const result = verifier.verifyFrame(300, recorded);
    const decision = c.ingest(result);
    expect(decision.action).toBe('continue');
    expect(decision.outcome).toBe('match');
    expect(c.hasDiverged()).toBe(false);
  });

  it('rejects malformed result', () => {
    const verifier = makeVerifier([]);
    const c = new DesyncRecoveryController({ verifier });
    expect(() =>
      c.ingest(null as unknown as ReturnType<typeof verifier.verifyFrame>),
    ).toThrow(/non-null/);
  });
});

// ---------------------------------------------------------------------------
// ingest — divergence with continue policy
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — continue policy', () => {
  it('continues through divergences and reports fail-continued on finish', () => {
    const recorded = makeSnapshot(300, 25);
    const verifier = makeVerifier([buildStateChecksumRecord(recorded)]);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'continue' },
    });

    const live = makeSnapshot(300, 50); // intentional divergence
    const result = verifier.verifyFrame(300, live);
    const decision = c.ingest(result);

    expect(decision.action).toBe('continue');
    expect(decision.outcome).toBe('mismatch');
    expect(decision.divergence).not.toBeNull();
    expect(c.hasDiverged()).toBe(true);
    expect(c.getStatus()).toBe('monitoring');
    expect(c.getReport().divergenceCount).toBe(1);
    expect(c.getReport().firstDivergenceFrame).toBe(300);

    c.finish();
    expect(c.getVerdict()).toBe('fail-continued');
    expect(c.getStatus()).toBe('completed');
  });

  it("declares 'pass' when finish() fires with no divergences", () => {
    const recorded = makeSnapshot(300, 25);
    const verifier = makeVerifier([buildStateChecksumRecord(recorded)]);
    const c = new DesyncRecoveryController({ verifier });
    c.ingest(verifier.verifyFrame(300, recorded));
    c.finish();
    expect(c.getVerdict()).toBe('pass');
    expect(c.getStatus()).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// ingest — halt-on-first
// ---------------------------------------------------------------------------

describe("DesyncRecoveryController — 'halt-on-first' policy", () => {
  it('halts the first divergence', () => {
    const recorded = makeSnapshot(300, 25);
    const verifier = makeVerifier([buildStateChecksumRecord(recorded)]);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'halt-on-first' },
    });

    const live = makeSnapshot(300, 50);
    const result = verifier.verifyFrame(300, live);
    const decision = c.ingest(result);

    expect(decision.action).toBe('halt');
    expect(decision.reason).toMatch(/halt-on-first/);
    expect(c.isHalted()).toBe(true);
    expect(c.getVerdict()).toBe('fail-halted');
    expect(c.getReport().haltedAtFrame).toBe(300);
  });

  it('keeps returning halt for subsequent ingests', () => {
    const r1 = makeSnapshot(300, 25);
    const r2 = makeSnapshot(600, 50);
    const verifier = makeVerifier([
      buildStateChecksumRecord(r1),
      buildStateChecksumRecord(r2),
    ]);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'halt-on-first' },
    });

    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 999)));
    expect(c.isHalted()).toBe(true);

    // After halt, subsequent verifyFrame calls don't re-issue divergence
    // entries via the controller — but the caller might still feed them.
    const decision2 = c.ingest(verifier.verifyFrame(600, r2));
    expect(decision2.action).toBe('halt');
    // No new divergence appended.
    expect(c.getReport().divergenceCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ingest — halt-on-threshold
// ---------------------------------------------------------------------------

describe("DesyncRecoveryController — 'halt-on-threshold' policy", () => {
  it('halts when total divergences reach maxDivergences', () => {
    const records = [makeRecord(300), makeRecord(600), makeRecord(900)];
    const verifier = makeVerifier(records);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'halt-on-threshold', maxDivergences: 2 },
    });

    const d1 = c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99)));
    expect(d1.action).toBe('continue');
    expect(d1.reason).toMatch(/1 divergence/);

    const d2 = c.ingest(verifier.verifyFrame(600, makeSnapshot(600, 99)));
    expect(d2.action).toBe('halt');
    expect(c.isHalted()).toBe(true);
    expect(c.getReport().haltedAtFrame).toBe(600);
  });

  it('halts when consecutive divergent pins reach maxConsecutivePins', () => {
    const records = [
      makeRecord(0, 0),
      makeRecord(300, 0),
      makeRecord(600, 0),
    ];
    const verifier = makeVerifier(records);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: {
        kind: 'halt-on-threshold',
        maxDivergences: 100,
        maxConsecutivePins: 3,
      },
    });

    c.ingest(verifier.verifyFrame(0, makeSnapshot(0, 50)));
    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 50)));
    expect(c.isHalted()).toBe(false);
    const d3 = c.ingest(verifier.verifyFrame(600, makeSnapshot(600, 50)));
    expect(d3.action).toBe('halt');
    expect(c.isHalted()).toBe(true);
    expect(d3.reason).toMatch(/consecutive/);
  });

  it('a match resets the consecutive-pin run', () => {
    const records = [
      makeRecord(0, 7),
      makeRecord(300, 7),
      makeRecord(600, 7),
      makeRecord(900, 7),
    ];
    const verifier = makeVerifier(records);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: {
        kind: 'halt-on-threshold',
        maxDivergences: 100,
        maxConsecutivePins: 3,
      },
    });

    // Two divergent pins …
    c.ingest(verifier.verifyFrame(0, makeSnapshot(0, 50)));
    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 50)));
    expect(c.isHalted()).toBe(false);
    // … then a matching one resets the run.
    c.ingest(verifier.verifyFrame(600, makeSnapshot(600, 7)));
    expect(c.isHalted()).toBe(false);
    // Two more divergent pins are not enough to halt.
    c.ingest(verifier.verifyFrame(900, makeSnapshot(900, 50)));
    expect(c.isHalted()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manual halt + reset
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — halt() + reset()', () => {
  it('manual halt stamps reason and verdict', () => {
    const verifier = makeVerifier([makeRecord(300)]);
    const c = new DesyncRecoveryController({ verifier });
    c.ingest(verifier.verifyFrame(0, makeSnapshot(0)));
    c.halt('user clicked stop');
    expect(c.isHalted()).toBe(true);
    expect(c.getVerdict()).toBe('fail-halted');
    expect(c.getReport().haltReason).toBe('user clicked stop');
    expect(c.getReport().haltedAtFrame).toBe(0); // last ingested frame
  });

  it('halt() with no ingest history leaves haltedAtFrame null', () => {
    const verifier = makeVerifier([]);
    const c = new DesyncRecoveryController({ verifier });
    c.halt('aborted before any frame observed');
    const report = c.getReport();
    expect(report.haltedAtFrame).toBeNull();
    expect(report.haltReason).toBe('aborted before any frame observed');
    expect(report.verdict).toBe('fail-halted');
  });

  it('reset() clears divergences and verdict, keeps verifier', () => {
    const recorded = makeSnapshot(300, 25);
    const verifier = makeVerifier([buildStateChecksumRecord(recorded)]);
    const c = new DesyncRecoveryController({ verifier });
    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99)));
    expect(c.hasDiverged()).toBe(true);
    c.reset();
    expect(c.getStatus()).toBe('idle');
    expect(c.getVerdict()).toBe('pending');
    expect(c.hasDiverged()).toBe(false);
    expect(c.getReport().divergenceCount).toBe(0);
    expect(c.getVerifier()).toBe(verifier);
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — callbacks', () => {
  it('onDivergence fires for every divergence regardless of policy', () => {
    const recorded = makeSnapshot(300, 25);
    const verifier = makeVerifier([buildStateChecksumRecord(recorded)]);
    const seen: DivergenceEntry[] = [];
    const c = new DesyncRecoveryController({
      verifier,
      onDivergence: (entry) => seen.push(entry),
    });
    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99)));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.frame).toBe(300);
  });

  it('onHalt fires exactly once', () => {
    const records = [makeRecord(300), makeRecord(600)];
    const verifier = makeVerifier(records);
    let haltCount = 0;
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'halt-on-first' },
      onHalt: () => {
        haltCount += 1;
      },
    });
    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99)));
    expect(haltCount).toBe(1);
    // Subsequent ingest should not re-fire the callback.
    c.ingest(verifier.verifyFrame(600, makeSnapshot(600, 99)));
    expect(haltCount).toBe(1);
  });

  it('throwing onDivergence callback does not crash the controller', () => {
    const verifier = makeVerifier([makeRecord(300, 5)]);
    const c = new DesyncRecoveryController({
      verifier,
      onDivergence: () => {
        throw new Error('user code blew up');
      },
    });
    expect(() =>
      c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99))),
    ).not.toThrow();
    expect(c.getReport().divergenceCount).toBe(1);
  });

  it('throwing onHalt callback does not crash the controller', () => {
    const verifier = makeVerifier([makeRecord(300, 5)]);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'halt-on-first' },
      onHalt: () => {
        throw new Error('user code blew up');
      },
    });
    expect(() =>
      c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99))),
    ).not.toThrow();
    expect(c.isHalted()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Report shape + cap
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — report cap', () => {
  it('caps divergences at maxReportRows; oldest entries roll off', () => {
    const records: StateChecksumRecord[] = [];
    for (let i = 0; i < 10; i += 1) {
      records.push(makeRecord(300 * (i + 1), 7));
    }
    const verifier = makeVerifier(records);
    const c = new DesyncRecoveryController({
      verifier,
      maxReportRows: 3,
    });
    for (let i = 0; i < 10; i += 1) {
      const frame = 300 * (i + 1);
      c.ingest(verifier.verifyFrame(frame, makeSnapshot(frame, 99)));
    }
    const report = c.getReport();
    expect(report.divergences).toHaveLength(3);
    expect(report.diffSummary).toHaveLength(3);
    // Most recent three are (frame 2400, 2700, 3000).
    expect(report.divergences.map((d) => d.frame)).toEqual([2400, 2700, 3000]);
    // …but the running counts are NOT capped.
    expect(report.divergenceCount).toBe(10);
    expect(report.mismatchCount).toBe(10);
  });

  it('record count mirrors the verifier', () => {
    const verifier = makeVerifier([makeRecord(0), makeRecord(300)]);
    const c = new DesyncRecoveryController({ verifier });
    expect(c.getReport().recordCount).toBe(2);
  });

  it('decisions are frozen', () => {
    const verifier = makeVerifier([makeRecord(300)]);
    const c = new DesyncRecoveryController({ verifier });
    const result = verifier.verifyFrame(0, makeSnapshot(0));
    const decision = c.ingest(result);
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it('reports are frozen and re-fetchable', () => {
    const verifier = makeVerifier([makeRecord(300)]);
    const c = new DesyncRecoveryController({ verifier });
    const r1 = c.getReport();
    const r2 = c.getReport();
    expect(Object.isFrozen(r1)).toBe(true);
    expect(Object.isFrozen(r2)).toBe(true);
    // Distinct objects so a stored reference doesn't see future updates.
    expect(r1).not.toBe(r2);
  });
});

// ---------------------------------------------------------------------------
// Determinism — twin controllers fed identical input streams agree
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — determinism', () => {
  it('two controllers produce byte-identical reports for the same input stream', () => {
    const records = [makeRecord(300), makeRecord(600), makeRecord(900)];
    const v1 = makeVerifier(records);
    const v2 = makeVerifier(records);
    const c1 = new DesyncRecoveryController({
      verifier: v1,
      tolerance: { kind: 'halt-on-threshold', maxDivergences: 2 },
    });
    const c2 = new DesyncRecoveryController({
      verifier: v2,
      tolerance: { kind: 'halt-on-threshold', maxDivergences: 2 },
    });

    const stream = [
      makeSnapshot(300, 99),
      makeSnapshot(600, 99),
      makeSnapshot(900, 99),
    ];
    for (const snap of stream) {
      c1.ingest(v1.verifyFrame(snap.frame, snap));
      c2.ingest(v2.verifyFrame(snap.frame, snap));
    }
    const r1 = c1.getReport();
    const r2 = c2.getReport();
    expect(r1.verdict).toBe(r2.verdict);
    expect(r1.haltedAtFrame).toBe(r2.haltedAtFrame);
    expect(r1.divergences.map((d) => d.message)).toEqual(
      r2.divergences.map((d) => d.message),
    );
    expect(r1.diffSummary).toEqual(r2.diffSummary);
  });
});

// ---------------------------------------------------------------------------
// setTolerance / live policy swap
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — live tolerance swap', () => {
  it('flipping policy promotes the next divergence to a halt', () => {
    const records = [makeRecord(300, 5), makeRecord(600, 5)];
    const verifier = makeVerifier(records);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'continue' },
    });
    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99))); // tolerated
    expect(c.isHalted()).toBe(false);
    c.setTolerance({ kind: 'halt-on-first' });
    const d = c.ingest(verifier.verifyFrame(600, makeSnapshot(600, 99)));
    expect(d.action).toBe('halt');
    expect(c.isHalted()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Round-trip integration with PlaybackChecksumVerifier
// ---------------------------------------------------------------------------

describe('DesyncRecoveryController — round-trip integration', () => {
  it('records a clean replay as PASS', () => {
    const records = [makeRecord(300, 0), makeRecord(600, 0)];
    const verifier = makeVerifier(records);
    const c = new DesyncRecoveryController({ verifier });
    for (const r of records) {
      c.ingest(verifier.verifyFrame(r.frame, makeSnapshot(r.frame, 0)));
    }
    c.finish();
    expect(c.getVerdict()).toBe('pass');
    expect(c.getReport().divergenceCount).toBe(0);
  });

  it('halt + reset path mirrors a full retry', () => {
    const records = [makeRecord(300, 5)];
    const verifier = makeVerifier(records);
    const c = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'halt-on-first' },
    });
    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99)));
    expect(c.isHalted()).toBe(true);
    verifier.reset();
    c.reset();
    expect(c.getReport().divergenceCount).toBe(0);
    expect(c.getStatus()).toBe('idle');
    // After reset, the same divergence flows through again.
    c.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99)));
    expect(c.isHalted()).toBe(true);
  });
});
