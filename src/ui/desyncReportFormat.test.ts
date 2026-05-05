/**
 * AC 30203 Sub-AC 3 — desync report format unit tests.
 *
 * Coverage map:
 *
 *   • Verdict colour ramp & label strings
 *   • Status / tolerance / banner subtitle strings
 *   • Stat-line composition (frame / divergence counts)
 *   • Divergence row + diff line truncation rules
 *   • buildBannerLines / buildDivergenceRows shape contract
 */

import { describe, it, expect } from 'vitest';
import type {
  DesyncDiffSummaryEntry,
  DesyncReport,
} from '../replay/DesyncRecoveryController';
import type { DivergenceEntry } from '../replay/PlaybackChecksumVerifier';
import {
  DESYNC_VERDICT_COLOR_RAMP,
  buildBannerLines,
  buildDivergenceRows,
  colorIntToHexString,
  formatDiffSummaryLine,
  formatDivergenceRow,
  formatHaltSummaryLine,
  formatStatLine,
  formatStatusLabel,
  formatToleranceLabel,
  formatVerdictLabel,
  shortChecksum,
  verdictColor,
} from './desyncReportFormat';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReport(overrides: Partial<DesyncReport> = {}): DesyncReport {
  const base: DesyncReport = {
    verdict: 'pending',
    status: 'idle',
    framesObserved: 0,
    firstDivergenceFrame: null,
    lastDivergenceFrame: null,
    divergenceCount: 0,
    mismatchCount: 0,
    malformedCount: 0,
    matchCount: 0,
    noPinCount: 0,
    recordCount: 0,
    haltedAtFrame: null,
    haltReason: null,
    tolerance: { kind: 'continue' },
    divergences: [],
    diffSummary: [],
  };
  return Object.freeze({ ...base, ...overrides });
}

function makeDivergence(overrides: Partial<DivergenceEntry> = {}): DivergenceEntry {
  return Object.freeze({
    frame: 300,
    kind: 'mismatch',
    expected: '0123456789abcdef',
    actual: 'fedcba9876543210',
    algorithm: 'state-fnv1a-64-v1',
    message: 'Replay state checksum: mismatch at frame 300',
    ...overrides,
  } as DivergenceEntry);
}

function makeDiffEntry(
  overrides: Partial<DesyncDiffSummaryEntry> = {},
): DesyncDiffSummaryEntry {
  return Object.freeze({
    frame: 300,
    kind: 'mismatch',
    expected: '0123456789abcdef',
    actual: 'fedcba9876543210',
    algorithm: 'state-fnv1a-64-v1',
    ...overrides,
  } as DesyncDiffSummaryEntry);
}

// ---------------------------------------------------------------------------
// Verdict colour ramp
// ---------------------------------------------------------------------------

describe('verdictColor / DESYNC_VERDICT_COLOR_RAMP', () => {
  it('ramp covers every verdict in DesyncReportVerdict', () => {
    const verdicts = DESYNC_VERDICT_COLOR_RAMP.map((e) => e.verdict).sort();
    expect(verdicts).toEqual(
      ['fail-continued', 'fail-halted', 'pass', 'pending'].sort(),
    );
  });

  it('returns the ramp colour for known verdicts', () => {
    for (const entry of DESYNC_VERDICT_COLOR_RAMP) {
      expect(verdictColor(entry.verdict)).toBe(entry.color);
    }
  });

  it('falls back to pending for unknown verdicts', () => {
    expect(verdictColor('???' as never)).toBe(
      DESYNC_VERDICT_COLOR_RAMP[0]!.color,
    );
  });
});

describe('colorIntToHexString', () => {
  it('renders standard colour ints as #rrggbb', () => {
    expect(colorIntToHexString(0xff0000)).toBe('#ff0000');
    expect(colorIntToHexString(0x000000)).toBe('#000000');
    expect(colorIntToHexString(0xffffff)).toBe('#ffffff');
  });

  it('clamps out-of-range and non-finite values', () => {
    expect(colorIntToHexString(-1)).toBe('#000000');
    expect(colorIntToHexString(0x1000000)).toBe('#ffffff');
    expect(colorIntToHexString(Number.NaN)).toBe('#000000');
    expect(colorIntToHexString(Number.POSITIVE_INFINITY)).toBe('#000000');
  });
});

// ---------------------------------------------------------------------------
// Verdict / status labels
// ---------------------------------------------------------------------------

describe('formatVerdictLabel', () => {
  it('produces stable strings per verdict', () => {
    expect(formatVerdictLabel('pending')).toBe('VERIFYING…');
    expect(formatVerdictLabel('pass')).toBe('REPLAY VERIFIED');
    expect(formatVerdictLabel('fail-continued')).toBe('REPLAY DESYNC (continued)');
    expect(formatVerdictLabel('fail-halted')).toBe('REPLAY DESYNC (halted)');
  });
});

describe('formatStatusLabel', () => {
  it('emits canonical lower-case labels', () => {
    expect(formatStatusLabel('idle')).toBe('idle');
    expect(formatStatusLabel('monitoring')).toBe('monitoring');
    expect(formatStatusLabel('halted')).toBe('halted');
    expect(formatStatusLabel('completed')).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Tolerance labels
// ---------------------------------------------------------------------------

describe('formatToleranceLabel', () => {
  it('continue policy', () => {
    expect(formatToleranceLabel({ kind: 'continue' })).toBe(
      'tolerance: continue (log only)',
    );
  });

  it('halt-on-first policy', () => {
    expect(formatToleranceLabel({ kind: 'halt-on-first' })).toBe(
      'tolerance: halt on first divergence',
    );
  });

  it('halt-on-threshold policy without consecutive', () => {
    expect(
      formatToleranceLabel({ kind: 'halt-on-threshold', maxDivergences: 5 }),
    ).toBe('tolerance: halt on 5 divergences');
  });

  it('handles singular maxDivergences without trailing s', () => {
    expect(
      formatToleranceLabel({ kind: 'halt-on-threshold', maxDivergences: 1 }),
    ).toBe('tolerance: halt on 1 divergence');
  });

  it('halt-on-threshold policy with consecutive', () => {
    expect(
      formatToleranceLabel({
        kind: 'halt-on-threshold',
        maxDivergences: 5,
        maxConsecutivePins: 3,
      }),
    ).toBe('tolerance: halt on 5 divergences or 3 consecutive pins');
  });
});

// ---------------------------------------------------------------------------
// Stat / banner sub-line composition
// ---------------------------------------------------------------------------

describe('formatStatLine', () => {
  it('renders the full counts line', () => {
    const r = makeReport({
      framesObserved: 1800,
      recordCount: 6,
      matchCount: 5,
      mismatchCount: 1,
      malformedCount: 0,
      divergenceCount: 1,
    });
    expect(formatStatLine(r)).toBe(
      'frames: 1800 · pins: 6 · matches: 5 · divergences: 1 (mismatch 1, malformed 0)',
    );
  });
});

describe('formatHaltSummaryLine', () => {
  it('halted with frame + reason', () => {
    const r = makeReport({
      status: 'halted',
      verdict: 'fail-halted',
      haltedAtFrame: 5400,
      haltReason: "policy 'halt-on-first': mismatch at frame 5400",
    });
    expect(formatHaltSummaryLine(r)).toBe(
      "halted at frame 5400: policy 'halt-on-first': mismatch at frame 5400",
    );
  });

  it('halted before any ingest', () => {
    const r = makeReport({
      status: 'halted',
      verdict: 'fail-halted',
      haltedAtFrame: null,
      haltReason: 'aborted',
    });
    expect(formatHaltSummaryLine(r)).toBe('halted (no frames observed): aborted');
  });

  it('first divergence with no later one', () => {
    const r = makeReport({
      status: 'monitoring',
      firstDivergenceFrame: 300,
      lastDivergenceFrame: 300,
    });
    expect(formatHaltSummaryLine(r)).toBe('first divergence at frame 300');
  });

  it('range when first ≠ last', () => {
    const r = makeReport({
      status: 'monitoring',
      firstDivergenceFrame: 300,
      lastDivergenceFrame: 900,
    });
    expect(formatHaltSummaryLine(r)).toBe(
      'divergences from frame 300 to frame 900',
    );
  });

  it('completed with no divergences', () => {
    const r = makeReport({ status: 'completed', verdict: 'pass' });
    expect(formatHaltSummaryLine(r)).toBe('no divergences observed');
  });

  it('idle empty report', () => {
    expect(formatHaltSummaryLine(makeReport())).toBe('no frames observed');
  });

  it('monitoring with no divergences yet', () => {
    expect(
      formatHaltSummaryLine(makeReport({ status: 'monitoring' })),
    ).toBe('no divergences observed yet');
  });
});

// ---------------------------------------------------------------------------
// Divergence row + diff
// ---------------------------------------------------------------------------

describe('formatDivergenceRow', () => {
  it('packs frame / kind / algorithm', () => {
    expect(
      formatDivergenceRow(
        makeDivergence({ frame: 1500, algorithm: 'state-fnv1a-64-v1' }),
      ),
    ).toBe('f1500 · mismatch · state-fnv1a-64-v1');
  });

  it("renders 'unknown' for null algorithm", () => {
    expect(
      formatDivergenceRow(
        makeDivergence({
          algorithm: null,
          kind: 'malformed-record',
        }),
      ),
    ).toBe('f300 · malformed-record · unknown');
  });
});

describe('shortChecksum', () => {
  it('passes through short strings', () => {
    expect(shortChecksum('abcdef')).toBe('abcdef');
  });

  it('truncates long checksums with ellipsis', () => {
    expect(shortChecksum('0123456789abcdef')).toBe('0123456789…');
  });

  it('renders <none> for null / empty', () => {
    expect(shortChecksum(null)).toBe('<none>');
    expect(shortChecksum('')).toBe('<none>');
  });
});

describe('formatDiffSummaryLine', () => {
  it('mismatch carries expected + actual', () => {
    expect(
      formatDiffSummaryLine(
        makeDiffEntry({
          expected: '0123456789abcdef',
          actual: 'fedcba9876543210',
        }),
      ),
    ).toBe('expected 0123456789…, got fedcba9876…');
  });

  it("malformed-record uses 'computed' phrasing", () => {
    expect(
      formatDiffSummaryLine(
        makeDiffEntry({
          kind: 'malformed-record',
          expected: null,
          actual: 'fedcba9876543210',
        }),
      ),
    ).toBe('record malformed, computed fedcba9876…');
  });
});

// ---------------------------------------------------------------------------
// buildDivergenceRows
// ---------------------------------------------------------------------------

describe('buildDivergenceRows', () => {
  it('returns the latest cap rows', () => {
    const divergences: DivergenceEntry[] = [];
    const diffSummary: DesyncDiffSummaryEntry[] = [];
    for (let i = 0; i < 12; i += 1) {
      divergences.push(
        makeDivergence({
          frame: 300 + i,
          message: `Replay state checksum: mismatch at frame ${300 + i}`,
        }),
      );
      diffSummary.push(makeDiffEntry({ frame: 300 + i }));
    }
    const r = makeReport({
      verdict: 'fail-continued',
      status: 'monitoring',
      divergences: Object.freeze(divergences.slice()),
      diffSummary: Object.freeze(diffSummary.slice()),
      divergenceCount: 12,
      mismatchCount: 12,
      firstDivergenceFrame: 300,
      lastDivergenceFrame: 311,
    });
    const rows = buildDivergenceRows(r, 5);
    expect(rows).toHaveLength(5);
    expect(rows[0]!.frame).toBe(307);
    expect(rows[4]!.frame).toBe(311);
  });

  it('handles cap of 0 by returning empty', () => {
    const r = makeReport({
      divergences: Object.freeze([makeDivergence()]),
      diffSummary: Object.freeze([makeDiffEntry()]),
    });
    expect(buildDivergenceRows(r, 0)).toEqual([]);
  });

  it('clamps invalid cap to 0', () => {
    const r = makeReport({
      divergences: Object.freeze([makeDivergence()]),
      diffSummary: Object.freeze([makeDiffEntry()]),
    });
    expect(buildDivergenceRows(r, Number.NaN)).toEqual([]);
    expect(buildDivergenceRows(r, -1)).toEqual([]);
  });

  it('falls back to "diff unavailable" when diffSummary is shorter', () => {
    const r = makeReport({
      divergences: Object.freeze([makeDivergence({ frame: 7 })]),
      diffSummary: Object.freeze([]),
    });
    const rows = buildDivergenceRows(r, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.diff).toBe('diff unavailable');
  });
});

// ---------------------------------------------------------------------------
// buildBannerLines — top-level integration
// ---------------------------------------------------------------------------

describe('buildBannerLines', () => {
  it('produces 4 stable lines for a halted report', () => {
    const r = makeReport({
      verdict: 'fail-halted',
      status: 'halted',
      framesObserved: 5401,
      recordCount: 18,
      matchCount: 17,
      divergenceCount: 1,
      mismatchCount: 1,
      malformedCount: 0,
      firstDivergenceFrame: 5400,
      lastDivergenceFrame: 5400,
      haltedAtFrame: 5400,
      haltReason: "policy 'halt-on-first': mismatch at frame 5400",
      tolerance: { kind: 'halt-on-first' },
    });
    const lines = buildBannerLines(r);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('REPLAY DESYNC (halted)');
    expect(lines[1]).toBe(
      "status: halted · halted at frame 5400: policy 'halt-on-first': mismatch at frame 5400",
    );
    expect(lines[2]).toBe('tolerance: halt on first divergence');
    expect(lines[3]).toBe(
      'frames: 5401 · pins: 18 · matches: 17 · divergences: 1 (mismatch 1, malformed 0)',
    );
  });

  it('produces a clean PASS banner', () => {
    const r = makeReport({
      verdict: 'pass',
      status: 'completed',
      framesObserved: 1800,
      recordCount: 6,
      matchCount: 6,
    });
    const lines = buildBannerLines(r);
    expect(lines[0]).toBe('REPLAY VERIFIED');
    expect(lines[1]).toBe('status: completed · no divergences observed');
    expect(lines[2]).toBe('tolerance: continue (log only)');
  });

  it('returns frozen array', () => {
    const lines = buildBannerLines(makeReport());
    expect(Object.isFrozen(lines)).toBe(true);
  });
});
