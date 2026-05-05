import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RESULTS_FRAME_RATE_HZ,
  PLAYER_NAME_COLUMN_WIDTH,
  formatDamageDealt,
  formatStatsLine,
  formatSurvivalTime,
  getStatsPanelHeader,
} from './resultsStats';
import type { PlayerMatchStats } from '../match';

/**
 * Sub-AC 2 of AC 16 — post-match stats panel formatters.
 *
 * `ResultsScene` renders one line per player containing KOs, damage
 * dealt, and survival time. The formatter helpers are kept Phaser-free
 * so we can lock down their contract under plain Node — every regression
 * here surfaces immediately without booting jsdom + Phaser.
 *
 * The contract these tests pin:
 *
 *   1. Survival time is rendered in the deterministic 60 Hz frame
 *      domain as `M:SS` (or `MM:SS`), zero-padded seconds, defensive
 *      against bad input.
 *   2. Damage is rendered as `<int>%`, floored, defensive against
 *      negative / NaN input.
 *   3. The full per-player line is a fixed-width grid so a 4-player
 *      FFA reads as a clean column scan regardless of name length.
 *   4. The header row's column widths match the data rows.
 */

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

describe('resultsStats — defaults', () => {
  it('default frame rate is 60 Hz', () => {
    expect(DEFAULT_RESULTS_FRAME_RATE_HZ).toBe(60);
  });

  it('player-name column width fits the M2 cast plus "Player N"', () => {
    // 'Bear Jr.' = 8 chars, 'Player 4' = 8 chars — 10 leaves headroom.
    expect(PLAYER_NAME_COLUMN_WIDTH).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// Survival time
// ---------------------------------------------------------------------------

describe('formatSurvivalTime', () => {
  it('renders 0 frames as "0:00"', () => {
    expect(formatSurvivalTime(0)).toBe('0:00');
  });

  it('renders sub-minute survival with zero-padded seconds', () => {
    // 102 frames @ 60 Hz = 1.7 s → 1 second floored.
    expect(formatSurvivalTime(102)).toBe('0:01');
    // 540 frames = 9 s → "0:09" (must be zero-padded, not "0:9").
    expect(formatSurvivalTime(540)).toBe('0:09');
    // 60 frames = 1 s exactly.
    expect(formatSurvivalTime(60)).toBe('0:01');
  });

  it('renders multi-minute survival in M:SS', () => {
    // 102 s = 1:42 — the canonical seed example.
    expect(formatSurvivalTime(102 * 60)).toBe('1:42');
    // 1 hour worth of frames — no upper clamp on minutes.
    expect(formatSurvivalTime(60 * 60 * 60)).toBe('60:00');
  });

  it('floors fractional frames (no rounding-up surprise)', () => {
    expect(formatSurvivalTime(59.999)).toBe('0:00');
    expect(formatSurvivalTime(60.5)).toBe('0:01');
  });

  it('renders negative / NaN / Infinity defensively as "0:00"', () => {
    expect(formatSurvivalTime(-1)).toBe('0:00');
    expect(formatSurvivalTime(-100)).toBe('0:00');
    expect(formatSurvivalTime(Number.NaN)).toBe('0:00');
    expect(formatSurvivalTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  it('honours a custom frame rate', () => {
    // 30 frames @ 30 Hz = 1 s.
    expect(formatSurvivalTime(30, 30)).toBe('0:01');
    // 120 frames @ 120 Hz = 1 s.
    expect(formatSurvivalTime(120, 120)).toBe('0:01');
  });

  it('falls back to 60 Hz on a non-positive frame rate', () => {
    expect(formatSurvivalTime(60, 0)).toBe('0:01');
    expect(formatSurvivalTime(60, -1)).toBe('0:01');
    expect(formatSurvivalTime(60, Number.NaN)).toBe('0:01');
  });
});

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

describe('formatDamageDealt', () => {
  it('renders an integer percent', () => {
    expect(formatDamageDealt(0)).toBe('0%');
    expect(formatDamageDealt(42)).toBe('42%');
    expect(formatDamageDealt(240)).toBe('240%');
  });

  it('floors fractional damage', () => {
    expect(formatDamageDealt(42.7)).toBe('42%');
    expect(formatDamageDealt(0.9)).toBe('0%');
  });

  it('renders negative / NaN / Infinity defensively as "0%"', () => {
    expect(formatDamageDealt(-1)).toBe('0%');
    expect(formatDamageDealt(Number.NaN)).toBe('0%');
    expect(formatDamageDealt(Number.POSITIVE_INFINITY)).toBe('0%');
  });
});

// ---------------------------------------------------------------------------
// Stats line
// ---------------------------------------------------------------------------

const baseStats = (overrides: Partial<PlayerMatchStats> = {}): PlayerMatchStats => ({
  kos: 0,
  deaths: 0,
  damageDealt: 0,
  damageTaken: 0,
  survivalFrames: 0,
  eliminated: false,
  ...overrides,
});

describe('formatStatsLine', () => {
  it('renders the canonical winner row with all fields populated', () => {
    const line = formatStatsLine({
      index: 0,
      name: 'Wolf',
      isWinner: true,
      stats: baseStats({
        kos: 4,
        damageDealt: 240,
        survivalFrames: 102 * 60,
      }),
    });
    // Columns: '★ ' + 'P1' + '  ' + 'Wolf      ' + '  ' + '4 KOs ' + '  ' + '240%  ' + '  ' + '1:42'
    expect(line).toBe('★ P1  Wolf        4 KOs   240%    1:42');
  });

  it('uses the singular "KO" suffix when exactly one KO scored', () => {
    const line = formatStatsLine({
      index: 1,
      name: 'Cat',
      isWinner: false,
      stats: baseStats({
        kos: 1,
        damageDealt: 50,
        survivalFrames: 600,
      }),
    });
    expect(line).toContain('1 KO ');
    expect(line).not.toContain('1 KOs');
  });

  it('uses two-space prefix for non-winners (so columns line up)', () => {
    const winner = formatStatsLine({
      index: 0,
      name: 'Wolf',
      isWinner: true,
      stats: baseStats(),
    });
    const loser = formatStatsLine({
      index: 1,
      name: 'Cat',
      isWinner: false,
      stats: baseStats(),
    });
    // Both must start with a 2-glyph prefix and produce the same length
    // overall — that's the contract that keeps the panel a clean grid.
    expect(winner.length).toBe(loser.length);
    expect(loser.startsWith('  P2')).toBe(true);
    expect(winner.startsWith('★ P1')).toBe(true);
  });

  it('pads short names so subsequent columns align', () => {
    const shortName = formatStatsLine({
      index: 0,
      name: 'Cat',
      isWinner: false,
      stats: baseStats({ kos: 0, damageDealt: 0, survivalFrames: 0 }),
    });
    const longerName = formatStatsLine({
      index: 0,
      name: 'Player 4',
      isWinner: false,
      stats: baseStats({ kos: 0, damageDealt: 0, survivalFrames: 0 }),
    });
    expect(shortName.length).toBe(longerName.length);
  });

  it('truncates over-long names rather than letting the grid drift', () => {
    const tooLong = formatStatsLine({
      index: 0,
      name: 'Bartholomew the Magnificent',
      isWinner: false,
      stats: baseStats(),
    });
    const normal = formatStatsLine({
      index: 0,
      name: 'Wolf',
      isWinner: false,
      stats: baseStats(),
    });
    expect(tooLong.length).toBe(normal.length);
    // The truncated portion must still appear at its expected slot.
    expect(tooLong).toContain('Bartholome');
    expect(tooLong).not.toContain('Magnificent');
  });

  it('renders 4-player FFA rows with consistent width', () => {
    const lines = ['Wolf', 'Cat', 'Bear Jr.', 'Owl'].map((name, i) =>
      formatStatsLine({
        index: i,
        name,
        isWinner: i === 2,
        stats: baseStats({
          kos: i,
          damageDealt: i * 80,
          survivalFrames: i * 1800,
        }),
      }),
    );
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1);
    // Winner line carries the star.
    expect(lines[2]!.startsWith('★ P3')).toBe(true);
  });

  it('honours custom frame rate for survival column', () => {
    const line = formatStatsLine({
      index: 0,
      name: 'Wolf',
      isWinner: false,
      stats: baseStats({ survivalFrames: 30 }),
      frameRateHz: 30,
    });
    expect(line.endsWith('0:01')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Header row
// ---------------------------------------------------------------------------

describe('getStatsPanelHeader', () => {
  it('matches the data-row column widths so the eye can scan down', () => {
    const header = getStatsPanelHeader();
    const dataRow = formatStatsLine({
      index: 0,
      name: 'Wolf',
      isWinner: true,
      stats: baseStats({ kos: 4, damageDealt: 240, survivalFrames: 6120 }),
    });
    expect(header.length).toBe(dataRow.length);
  });

  it('contains the three column labels', () => {
    const header = getStatsPanelHeader();
    expect(header).toContain('PLAYER');
    expect(header).toContain('KO');
    expect(header).toContain('DMG');
    expect(header).toContain('TIME');
  });
});
