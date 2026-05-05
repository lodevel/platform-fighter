import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_STAGE_ENTRIES,
  buildStageSelectEntries,
  cycleStageCursor,
} from './stageSelect';
import type { CustomStageIndexEntry } from '../builder';
import {
  FLAT_STAGE,
  LAVA_STAGE,
  WIND_STAGE,
  CRUMBLING_STAGE,
  MOVING_PLATFORM_STAGE,
} from '../stages';

/**
 * AC 20104 Sub-AC 4 — `StageSelectScene` is the menu seam that lets a
 * player pick a saved custom stage and play it as a live match. The
 * scene's UI itself depends on Phaser, so we exercise the pure helper
 * (`buildStageSelectEntries`) under plain Node — that helper is the
 * single source of truth for "which stages will the menu list",
 * including the canonical-five built-ins followed by every saved
 * custom stage.
 */

describe('buildStageSelectEntries', () => {
  it('exposes the canonical five built-in stage ids in stable order', () => {
    expect(BUILT_IN_STAGE_ENTRIES.map((e) => e.id)).toEqual([
      FLAT_STAGE.id,
      LAVA_STAGE.id,
      WIND_STAGE.id,
      CRUMBLING_STAGE.id,
      MOVING_PLATFORM_STAGE.id,
    ]);
  });

  it('lists all built-ins as kind="built-in"', () => {
    for (const entry of BUILT_IN_STAGE_ENTRIES) {
      expect(entry.kind).toBe('built-in');
    }
  });

  it('returns just the built-ins when the custom-stage index is empty', () => {
    const entries = buildStageSelectEntries([]);
    expect(entries).toHaveLength(BUILT_IN_STAGE_ENTRIES.length);
    expect(entries[0]?.kind).toBe('built-in');
  });

  it('appends saved custom stages after the built-ins, in index order', () => {
    const customSlots: ReadonlyArray<CustomStageIndexEntry> = [
      { id: 'lava-tower', name: 'Lava Tower' },
      { id: 'wind-castle', name: 'Wind Castle' },
    ];
    const entries = buildStageSelectEntries(customSlots);
    expect(entries).toHaveLength(BUILT_IN_STAGE_ENTRIES.length + 2);
    const customs = entries.filter((e) => e.kind === 'custom');
    expect(customs).toHaveLength(2);
    expect(customs[0]).toMatchObject({
      kind: 'custom',
      slotId: 'lava-tower',
      displayName: 'LAVA TOWER',
    });
    expect(customs[1]).toMatchObject({
      kind: 'custom',
      slotId: 'wind-castle',
      displayName: 'WIND CASTLE',
    });
  });

  it('upper-cases the saved name for menu display', () => {
    const customSlots: ReadonlyArray<CustomStageIndexEntry> = [
      { id: 'mixed-case-name', name: 'Mixed Case Name' },
    ];
    const entries = buildStageSelectEntries(customSlots);
    const customEntry = entries.find((e) => e.kind === 'custom');
    expect(customEntry?.displayName).toBe('MIXED CASE NAME');
  });
});

describe('cycleStageCursor', () => {
  it('advances forward by one', () => {
    expect(cycleStageCursor(0, +1, 5)).toBe(1);
  });

  it('wraps from the last entry forward back to the first', () => {
    expect(cycleStageCursor(4, +1, 5)).toBe(0);
  });

  it('wraps backward from the first entry to the last', () => {
    expect(cycleStageCursor(0, -1, 5)).toBe(4);
  });

  it('truncates fractional deltas', () => {
    expect(cycleStageCursor(0, 1.7, 5)).toBe(1);
  });

  it('no-ops on a zero-length list', () => {
    expect(cycleStageCursor(0, +1, 0)).toBe(0);
    expect(cycleStageCursor(2, -3, 0)).toBe(2);
  });

  it('handles large negative deltas correctly', () => {
    // -7 mod 5 should wrap to 3 (i.e. 0 - 7 = -7, normalised to 3 in
    // a 5-entry list).
    expect(cycleStageCursor(0, -7, 5)).toBe(3);
  });
});
