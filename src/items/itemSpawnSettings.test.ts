import { describe, it, expect } from 'vitest';
import {
  ITEM_FREQUENCIES,
  ITEM_SPAWN_DROP_HEIGHT_PX,
  ITEM_SPAWN_FREQUENCY_TABLE,
  MAX_ITEMS_ON_FIELD_BY_FREQUENCY,
  MAX_ITEMS_ON_FIELD_HARD_LIMIT,
  assertItemSpawnSettingsInvariants,
  getItemSpawnInterval,
  getItemSpawnPosition,
  getMaxItemsOnField,
  resolveItemFrequency,
} from './itemSpawnSettings';
import { DEFAULT_ITEM_FREQUENCY } from '../types';
import type { ItemFrequency } from '../types';

/**
 * AC 10 Sub-AC 2 — items frequency knob mapping table.
 *
 * Locks down:
 *   • The four canonical dial positions are present in the right
 *     order (the order the lobby UI cycles through).
 *   • Every dial position maps to a well-formed interval window
 *     and a non-negative cap, with `'off'` using sentinel values
 *     (`null` interval, `0` cap).
 *   • Frequency monotonically increases as the dial steps up:
 *     stepping `low → med → high` never raises the spawn interval
 *     and never lowers the on-field cap.
 *   • `resolveItemFrequency` defends against `undefined` and
 *     unknown tokens — both fall through to `DEFAULT_ITEM_FREQUENCY`.
 *   • `assertItemSpawnSettingsInvariants` passes for the shipped
 *     table — guards a future tuning pass against regressions.
 */

// ---------------------------------------------------------------------------
// Dial enumeration
// ---------------------------------------------------------------------------

describe('ITEM_FREQUENCIES', () => {
  it('lists exactly the four canonical dial positions in order', () => {
    expect(ITEM_FREQUENCIES).toEqual(['off', 'low', 'med', 'high']);
  });

  it('is frozen so the order cannot drift at runtime', () => {
    expect(Object.isFrozen(ITEM_FREQUENCIES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Interval mapping table
// ---------------------------------------------------------------------------

describe('ITEM_SPAWN_FREQUENCY_TABLE', () => {
  it("maps 'off' to null (spawn manager short-circuits without an RNG roll)", () => {
    expect(ITEM_SPAWN_FREQUENCY_TABLE.off).toBeNull();
  });

  it.each([
    ['low', 720, 1200],
    ['med', 360, 720],
    ['high', 120, 300],
  ] as const)(
    "maps '%s' to a [%i, %i]-frame interval window",
    (freq, min, max) => {
      const w = ITEM_SPAWN_FREQUENCY_TABLE[freq];
      expect(w).not.toBeNull();
      expect(w!.minIntervalFrames).toBe(min);
      expect(w!.maxIntervalFrames).toBe(max);
    },
  );

  it('uses integer frame counts for every non-off dial', () => {
    for (const f of ITEM_FREQUENCIES) {
      const w = ITEM_SPAWN_FREQUENCY_TABLE[f];
      if (w === null) continue;
      expect(Number.isInteger(w.minIntervalFrames)).toBe(true);
      expect(Number.isInteger(w.maxIntervalFrames)).toBe(true);
      expect(w.minIntervalFrames).toBeGreaterThanOrEqual(1);
      expect(w.minIntervalFrames).toBeLessThanOrEqual(w.maxIntervalFrames);
    }
  });

  it('monotonically tightens the interval as the dial steps up', () => {
    const nonOff = ITEM_FREQUENCIES.filter((f) => f !== 'off');
    for (let i = 1; i < nonOff.length; i++) {
      const prevKey = nonOff[i - 1];
      const currKey = nonOff[i];
      expect(prevKey).toBeDefined();
      expect(currKey).toBeDefined();
      const prev = ITEM_SPAWN_FREQUENCY_TABLE[prevKey as ItemFrequency];
      const curr = ITEM_SPAWN_FREQUENCY_TABLE[currKey as ItemFrequency];
      expect(prev).not.toBeNull();
      expect(curr).not.toBeNull();
      expect(curr!.minIntervalFrames).toBeLessThanOrEqual(
        prev!.minIntervalFrames,
      );
      expect(curr!.maxIntervalFrames).toBeLessThanOrEqual(
        prev!.maxIntervalFrames,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Max-items-on-field cap
// ---------------------------------------------------------------------------

describe('MAX_ITEMS_ON_FIELD_BY_FREQUENCY', () => {
  it.each([
    ['off', 0],
    ['low', 1],
    ['med', 2],
    ['high', 4],
  ] as const)("caps '%s' at %i live items", (freq, expected) => {
    expect(MAX_ITEMS_ON_FIELD_BY_FREQUENCY[freq]).toBe(expected);
  });

  it('keeps every per-frequency cap at or below the hard limit', () => {
    for (const f of ITEM_FREQUENCIES) {
      expect(MAX_ITEMS_ON_FIELD_BY_FREQUENCY[f]).toBeLessThanOrEqual(
        MAX_ITEMS_ON_FIELD_HARD_LIMIT,
      );
    }
  });

  it('monotonically raises the cap as the dial steps up', () => {
    for (let i = 1; i < ITEM_FREQUENCIES.length; i++) {
      const prevKey = ITEM_FREQUENCIES[i - 1];
      const currKey = ITEM_FREQUENCIES[i];
      expect(prevKey).toBeDefined();
      expect(currKey).toBeDefined();
      const prev = MAX_ITEMS_ON_FIELD_BY_FREQUENCY[prevKey as ItemFrequency];
      const curr = MAX_ITEMS_ON_FIELD_BY_FREQUENCY[currKey as ItemFrequency];
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveItemFrequency — defensive lookup
// ---------------------------------------------------------------------------

describe('resolveItemFrequency', () => {
  it.each(['off', 'low', 'med', 'high'] as const)(
    "returns '%s' unchanged when the input is a valid dial position",
    (f) => {
      expect(resolveItemFrequency(f)).toBe(f);
    },
  );

  it('falls back to DEFAULT_ITEM_FREQUENCY when the input is undefined', () => {
    expect(resolveItemFrequency(undefined)).toBe(DEFAULT_ITEM_FREQUENCY);
  });

  it('falls back to DEFAULT_ITEM_FREQUENCY for unknown tokens', () => {
    // Forced cast — modelling a corrupt replay header that mutates the
    // token between schema versions. The runtime must defend against
    // it without throwing.
    expect(resolveItemFrequency('chaos' as unknown as ItemFrequency)).toBe(
      DEFAULT_ITEM_FREQUENCY,
    );
    expect(resolveItemFrequency('' as unknown as ItemFrequency)).toBe(
      DEFAULT_ITEM_FREQUENCY,
    );
  });
});

// ---------------------------------------------------------------------------
// Lookup helpers — getItemSpawnInterval / getMaxItemsOnField
// ---------------------------------------------------------------------------

describe('getItemSpawnInterval', () => {
  it('returns the table entry for each dial position', () => {
    for (const f of ITEM_FREQUENCIES) {
      expect(getItemSpawnInterval(f)).toBe(ITEM_SPAWN_FREQUENCY_TABLE[f]);
    }
  });
});

describe('getMaxItemsOnField', () => {
  it('returns the cap for each dial position', () => {
    for (const f of ITEM_FREQUENCIES) {
      expect(getMaxItemsOnField(f)).toBe(MAX_ITEMS_ON_FIELD_BY_FREQUENCY[f]);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant assertion — guards future tuning passes
// ---------------------------------------------------------------------------

describe('assertItemSpawnSettingsInvariants', () => {
  it('passes for the shipped tables', () => {
    expect(() => assertItemSpawnSettingsInvariants()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Default value sanity — DEFAULT_ITEM_FREQUENCY
// ---------------------------------------------------------------------------

describe('DEFAULT_ITEM_FREQUENCY', () => {
  it('is a member of ITEM_FREQUENCIES', () => {
    expect(ITEM_FREQUENCIES).toContain(DEFAULT_ITEM_FREQUENCY);
  });

  it("defaults to 'med' so a fresh-from-menu match exercises items end-to-end", () => {
    expect(DEFAULT_ITEM_FREQUENCY).toBe('med');
  });
});

// ---------------------------------------------------------------------------
// Drop-from-above spawn position (AC 90301 Sub-AC 1)
// ---------------------------------------------------------------------------

describe('ITEM_SPAWN_DROP_HEIGHT_PX', () => {
  it('is a positive integer in design pixels', () => {
    expect(Number.isInteger(ITEM_SPAWN_DROP_HEIGHT_PX)).toBe(true);
    expect(ITEM_SPAWN_DROP_HEIGHT_PX).toBeGreaterThan(0);
  });

  it("stays within the design viewport's headroom budget", () => {
    // Sanity-check: the drop height must not be so large that an
    // anchor authored anywhere on a 1080-tall stage would spawn far
    // outside the design viewport. 280px gives the materialise point
    // ~26% of the screen above the anchor — comfortably below the
    // upper edge of an authored anchor near the bottom of the stage.
    expect(ITEM_SPAWN_DROP_HEIGHT_PX).toBeLessThan(540);
  });
});

describe('getItemSpawnPosition', () => {
  it('places the drop-in point ITEM_SPAWN_DROP_HEIGHT_PX above the anchor', () => {
    const anchor = { x: 500, y: 800 };
    const drop = getItemSpawnPosition(anchor);
    expect(drop.x).toBe(anchor.x);
    expect(drop.y).toBe(anchor.y - ITEM_SPAWN_DROP_HEIGHT_PX);
    expect(drop.y).toBeLessThan(anchor.y); // strictly above (smaller Y)
  });

  it('returns a fresh object — does not mutate the anchor record', () => {
    const anchor = { x: 100, y: 200 };
    const before = { ...anchor };
    const drop = getItemSpawnPosition(anchor);
    expect(anchor).toEqual(before);
    expect(drop).not.toBe(anchor);
  });

  it('clamps the drop Y to 0 when the anchor sits within the drop height of the top edge', () => {
    // Anchor authored unusually close to the top of the stage —
    // a naive subtract would produce a negative Y. The clamp
    // guarantees the drop point stays inside the design viewport.
    const drop = getItemSpawnPosition({ x: 50, y: 100 });
    expect(drop.y).toBe(0);
    expect(drop.x).toBe(50);
  });

  it('is deterministic — same input always produces the same drop point', () => {
    const anchor = { x: 750, y: 920 };
    const a = getItemSpawnPosition(anchor);
    const b = getItemSpawnPosition(anchor);
    expect(a).toEqual(b);
  });
});
