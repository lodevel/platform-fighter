/**
 * Phaser-free formatting helpers for the desync-report overlay
 * (AC 30203 Sub-AC 3).
 *
 * The overlay (`DesyncReportOverlay.ts`) imports these to build its
 * banner text, divergence rows, and side-by-side diff column. Keeping
 * the strings + colour ramp out of the Phaser-touching component lets
 * the unit suite drive every formatting branch under plain Node.
 *
 * Three concerns live here:
 *
 *   1. {@link formatVerdictLabel} / {@link verdictColor} — a short
 *      banner string + tint that conveys the report's overall state at
 *      a glance.
 *   2. {@link formatToleranceLabel} / {@link formatHaltSummaryLine} /
 *      {@link formatStatLine} — single-line summaries the overlay
 *      packs into the report panel header.
 *   3. {@link formatDivergenceRow} / {@link formatDiffSummaryLine} /
 *      {@link buildDiffSummaryRows} — the per-divergence list.
 *
 * Determinism: every helper is a pure function — same input → same
 * output, no `Math.random()`, no wall-clock reads. The replay system
 * can re-feed an identical {@link DesyncReport} and the overlay paints
 * identically every time.
 */

import type {
  DesyncDiffSummaryEntry,
  DesyncReport,
  DesyncReportStatus,
  DesyncReportVerdict,
  DesyncTolerancePolicy,
} from '../replay/DesyncRecoveryController';
import type { DivergenceEntry } from '../replay/PlaybackChecksumVerifier';

// ---------------------------------------------------------------------------
// Verdict colour ramp
// ---------------------------------------------------------------------------

/**
 * Colour band per verdict state, mirroring the wider HUD palette
 * (green = healthy, yellow = warn, red = fail, slate = pending).
 *
 *   pending          → slate grey   (verifier hasn't decided yet)
 *   pass             → mint green   (recording matched bit-for-bit)
 *   fail-continued   → straw yellow (divergence tolerated; review)
 *   fail-halted      → red          (playback halted at a divergence)
 */
export const DESYNC_VERDICT_COLOR_RAMP: ReadonlyArray<{
  readonly verdict: DesyncReportVerdict;
  readonly color: number;
}> = Object.freeze([
  Object.freeze({ verdict: 'pending', color: 0xa0a0b8 }),
  Object.freeze({ verdict: 'pass', color: 0x6cf0c2 }),
  Object.freeze({ verdict: 'fail-continued', color: 0xffe066 }),
  Object.freeze({ verdict: 'fail-halted', color: 0xff6b6b }),
]);

/**
 * Map a verdict to its overlay tint. Falls back to `pending`'s colour
 * for unknown inputs so a future verdict added without updating the
 * ramp doesn't paint an undefined tint.
 */
export function verdictColor(verdict: DesyncReportVerdict | string): number {
  for (const entry of DESYNC_VERDICT_COLOR_RAMP) {
    if (entry.verdict === verdict) return entry.color;
  }
  return DESYNC_VERDICT_COLOR_RAMP[0]!.color;
}

/** Phaser uses `'#rrggbb'` for `Text` colours; mirrors `damageHudFormat.ts`. */
export function colorIntToHexString(value: number): string {
  if (!Number.isFinite(value)) return '#000000';
  const clamped = Math.max(0, Math.min(0xffffff, Math.trunc(value)));
  return `#${clamped.toString(16).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Verdict / status labels
// ---------------------------------------------------------------------------

/**
 * One-line verdict label suitable for the banner row. Stable strings —
 * the overlay's snapshot tests assert these verbatim.
 */
export function formatVerdictLabel(verdict: DesyncReportVerdict): string {
  switch (verdict) {
    case 'pass':
      return 'REPLAY VERIFIED';
    case 'fail-continued':
      return 'REPLAY DESYNC (continued)';
    case 'fail-halted':
      return 'REPLAY DESYNC (halted)';
    case 'pending':
      return 'VERIFYING…';
    default: {
      const exhaustive: never = verdict;
      // Unknown verdicts shouldn't reach the formatter, but if a future
      // verdict slips through we degrade to a descriptive string rather
      // than failing the overlay's text update.
      return `verdict: ${String(exhaustive)}`;
    }
  }
}

/**
 * Lifecycle status — surfaced as a sub-line on the banner ("monitoring
 * 1234 frames", "halted at frame 5400").
 */
export function formatStatusLabel(status: DesyncReportStatus): string {
  switch (status) {
    case 'idle':
      return 'idle';
    case 'monitoring':
      return 'monitoring';
    case 'halted':
      return 'halted';
    case 'completed':
      return 'completed';
    default: {
      const exhaustive: never = status;
      return String(exhaustive);
    }
  }
}

// ---------------------------------------------------------------------------
// Tolerance label
// ---------------------------------------------------------------------------

/**
 * Human-readable name for the active tolerance policy. The overlay
 * surfaces this so the player understands "why didn't playback halt
 * on that divergence?" / "why did we stop at the very first one?".
 */
export function formatToleranceLabel(policy: DesyncTolerancePolicy): string {
  switch (policy.kind) {
    case 'continue':
      return 'tolerance: continue (log only)';
    case 'halt-on-first':
      return 'tolerance: halt on first divergence';
    case 'halt-on-threshold': {
      const consecutive =
        policy.maxConsecutivePins === undefined
          ? ''
          : ` or ${policy.maxConsecutivePins} consecutive pins`;
      return (
        `tolerance: halt on ${policy.maxDivergences} divergence` +
        `${policy.maxDivergences === 1 ? '' : 's'}${consecutive}`
      );
    }
    default: {
      const exhaustive: never = policy;
      return `tolerance: unknown (${String(
        (exhaustive as { kind?: string }).kind,
      )})`;
    }
  }
}

// ---------------------------------------------------------------------------
// Stats / banner lines
// ---------------------------------------------------------------------------

/**
 * Single-line stat summary suitable for the overlay's secondary header
 * row.
 *
 *   formatStatLine(report) →
 *     "frames: 1800 · pins: 6 · matches: 5 · divergences: 1 (mismatch 1, malformed 0)"
 */
export function formatStatLine(report: DesyncReport): string {
  const div = report.divergenceCount;
  const mm = report.mismatchCount;
  const malformed = report.malformedCount;
  return (
    `frames: ${report.framesObserved} · ` +
    `pins: ${report.recordCount} · ` +
    `matches: ${report.matchCount} · ` +
    `divergences: ${div} (mismatch ${mm}, malformed ${malformed})`
  );
}

/**
 * Banner subtitle string — "halted at frame N: <reason>" / "first
 * divergence at frame M" / "no divergences observed".
 */
export function formatHaltSummaryLine(report: DesyncReport): string {
  if (report.status === 'halted') {
    const reason = report.haltReason ?? 'unspecified';
    if (report.haltedAtFrame === null) {
      return `halted (no frames observed): ${reason}`;
    }
    return `halted at frame ${report.haltedAtFrame}: ${reason}`;
  }
  if (report.firstDivergenceFrame !== null) {
    if (report.lastDivergenceFrame !== null && report.lastDivergenceFrame !== report.firstDivergenceFrame) {
      return (
        `divergences from frame ${report.firstDivergenceFrame} to ` +
        `frame ${report.lastDivergenceFrame}`
      );
    }
    return `first divergence at frame ${report.firstDivergenceFrame}`;
  }
  if (report.status === 'completed') {
    return 'no divergences observed';
  }
  if (report.status === 'idle') {
    return 'no frames observed';
  }
  return 'no divergences observed yet';
}

// ---------------------------------------------------------------------------
// Per-divergence rows
// ---------------------------------------------------------------------------

/**
 * Compact one-line row label for the divergence list. The verifier
 * already attaches a long-form `message`; the overlay needs a tighter
 * variant that fits in a single fixed-width column.
 *
 *   formatDivergenceRow({frame:1500, kind:'mismatch', algorithm:'…'})
 *     → "f1500 · mismatch · state-fnv1a-64-v1"
 */
export function formatDivergenceRow(entry: DivergenceEntry): string {
  const algorithm = entry.algorithm ?? 'unknown';
  return `f${entry.frame} · ${entry.kind} · ${algorithm}`;
}

/**
 * Truncated checksum literal for diff display. Full FNV-1a-64 is 16
 * hex chars; the overlay column is tight, so we display the first 10
 * with a trailing ellipsis when longer. Null inputs render as the
 * sentinel `<none>`.
 */
export function shortChecksum(value: string | null): string {
  if (value === null || value === undefined || value.length === 0) {
    return '<none>';
  }
  if (value.length <= 12) return value;
  return `${value.slice(0, 10)}…`;
}

/**
 * Side-by-side diff line for one divergence. The overlay packs this
 * into the third column of each divergence row.
 *
 *   formatDiffSummaryLine({frame, kind:'mismatch', expected:'aaa', actual:'bbb'})
 *     → "expected aaa, got bbb"
 *   formatDiffSummaryLine({frame, kind:'malformed-record', expected:null, actual:'…'})
 *     → "record malformed, computed …"
 */
export function formatDiffSummaryLine(entry: DesyncDiffSummaryEntry): string {
  if (entry.kind === 'malformed-record') {
    return `record malformed, computed ${shortChecksum(entry.actual)}`;
  }
  return (
    `expected ${shortChecksum(entry.expected)}, ` +
    `got ${shortChecksum(entry.actual)}`
  );
}

/**
 * Build the full set of overlay rows the report will render. Returns
 * one structured row per recent divergence so the overlay layer can
 * paint the label column and the diff column with the same row
 * spacing. `cap` defaults to a render budget appropriate for an
 * 8-row scrollable list; pass `Infinity` for headless tooling.
 */
export interface DivergenceRow {
  readonly frame: number;
  readonly kind: 'mismatch' | 'malformed-record';
  readonly label: string;
  readonly diff: string;
}

export function buildDivergenceRows(
  report: DesyncReport,
  cap = 8,
): ReadonlyArray<DivergenceRow> {
  if (!Number.isFinite(cap) || cap < 0) cap = 0;
  const rows: DivergenceRow[] = [];
  const len = report.divergences.length;
  // When cap is zero, skip entirely — `len - 0 === len` would make the
  // loop run through every entry, which is the opposite of the cap.
  const start = cap === 0 ? len : Math.max(0, len - cap);
  for (let i = start; i < len; i += 1) {
    const entry = report.divergences[i];
    const diffEntry = report.diffSummary[i];
    if (entry === undefined) continue;
    const diff =
      diffEntry !== undefined
        ? formatDiffSummaryLine(diffEntry)
        : 'diff unavailable';
    rows.push({
      frame: entry.frame,
      kind: entry.kind,
      label: formatDivergenceRow(entry),
      diff,
    });
  }
  return Object.freeze(rows);
}

// ---------------------------------------------------------------------------
// Top-level banner string assembly
// ---------------------------------------------------------------------------

/**
 * Assemble the multi-line banner the overlay paints across the top of
 * its panel: verdict label + status sub-line + tolerance + stats. The
 * overlay places each line on its own Phaser text object; the test
 * suite reads the array verbatim.
 */
export function buildBannerLines(report: DesyncReport): ReadonlyArray<string> {
  return Object.freeze([
    formatVerdictLabel(report.verdict),
    `status: ${formatStatusLabel(report.status)} · ${formatHaltSummaryLine(report)}`,
    formatToleranceLabel(report.tolerance),
    formatStatLine(report),
  ]);
}
