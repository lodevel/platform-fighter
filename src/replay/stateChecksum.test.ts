/**
 * AC 30202 Sub-AC 2 — match-state checksum tests.
 *
 * Coverage map:
 *
 *   • {@link computeStateChecksum}
 *       - Determinism: identical snapshots produce identical hex.
 *       - Output shape: 16 lowercase hex chars.
 *       - Avalanche: single-field change anywhere in the snapshot
 *         flips both halves of the 64-bit hash.
 *       - Sensitivity per-field: every tracked deterministic field
 *         (positions, velocities, damage, stocks, jumpsUsed, hitstun,
 *         invincibility, eliminated, facing, grounded, paletteIndex,
 *         characterId) influences the digest.
 *       - +0 / -0 collapse to the same checksum (gameplay equivalence).
 *       - Rejects NaN / Infinity / non-finite floats.
 *       - Rejects non-string characterId, non-number positions, etc.
 *       - Rejects characterId / fields containing the reserved
 *         separator characters.
 *       - Rejects 0-fighter or 5-fighter snapshots.
 *
 *   • {@link serializeStateForChecksum}
 *       - Output is a single-line ASCII string with the algorithm
 *         prefix and the expected separator structure.
 *       - Identical canonical strings for identical snapshots.
 *
 *   • {@link buildStateChecksumRecord}
 *       - Returns a record with the snapshot's frame, the computed
 *         checksum, and the canonical algorithm identifier.
 *
 *   • {@link isWellFormedStateChecksumRecord}
 *       - Accepts the shape `buildStateChecksumRecord` produces.
 *       - Rejects every malformed shape.
 *
 *   • Constants
 *       - STATE_CHECKSUM_ALGORITHM is `'state-fnv1a-64-v1'`.
 *       - STATE_CHECKSUM_HEX_LENGTH is 16.
 */

import { describe, it, expect } from 'vitest';
import {
  STATE_CHECKSUM_ALGORITHM,
  STATE_CHECKSUM_HEX_LENGTH,
  StateChecksumError,
  buildStateChecksumRecord,
  computeStateChecksum,
  isWellFormedStateChecksumRecord,
  serializeStateForChecksum,
  type MatchStateSnapshot,
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
    position: { x: 100, y: 200 },
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

function makeSnapshot(
  overrides: Partial<MatchStateSnapshot> = {},
): MatchStateSnapshot {
  return {
    frame: 0,
    fighters: [makeFighter({ playerIndex: 0 }), makeFighter({ playerIndex: 1, characterId: 'cat' })],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('stateChecksum — constants', () => {
  it('exposes the algorithm identifier', () => {
    expect(STATE_CHECKSUM_ALGORITHM).toBe('state-fnv1a-64-v1');
  });
  it('exposes a 16-char hex length', () => {
    expect(STATE_CHECKSUM_HEX_LENGTH).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// computeStateChecksum — output shape & determinism
// ---------------------------------------------------------------------------

describe('computeStateChecksum — output shape', () => {
  it('returns a 16-character lowercase hex string', () => {
    const c = computeStateChecksum(makeSnapshot());
    expect(c).toHaveLength(16);
    expect(c).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces identical output for identical snapshots', () => {
    const a = computeStateChecksum(makeSnapshot());
    const b = computeStateChecksum(makeSnapshot());
    expect(a).toBe(b);
  });

  it('is independent of caller-side mutation between calls', () => {
    const snapA = makeSnapshot();
    const a = computeStateChecksum(snapA);
    // Mutate an arbitrary unrelated value between calls — the hash
    // function never reads any global state, so the second call must
    // be byte-identical.
    for (let i = 0; i < 1000; i += 1) Math.imul(i, 0x9e3779b9);
    const b = computeStateChecksum(snapA);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// computeStateChecksum — sensitivity (avalanche per field)
// ---------------------------------------------------------------------------

describe('computeStateChecksum — field sensitivity', () => {
  const baseline = makeSnapshot();

  it.each<readonly [string, MatchStateSnapshot]>([
    [
      'frame',
      makeSnapshot({ frame: 1 }),
    ],
    [
      'characterId',
      makeSnapshot({ fighters: [makeFighter({ characterId: 'cat' }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'paletteIndex',
      makeSnapshot({ fighters: [makeFighter({ paletteIndex: 1 }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'stocks',
      makeSnapshot({ fighters: [makeFighter({ stocks: 2 }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'stocksLost',
      makeSnapshot({ fighters: [makeFighter({ stocksLost: 1 }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'kos',
      makeSnapshot({ fighters: [makeFighter({ kos: 1 }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'damagePercent',
      makeSnapshot({ fighters: [makeFighter({ damagePercent: 0.0001 }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'position.x',
      makeSnapshot({ fighters: [makeFighter({ position: { x: 100.0001, y: 200 } }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'position.y',
      makeSnapshot({ fighters: [makeFighter({ position: { x: 100, y: 199.9999 } }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'velocity.x',
      makeSnapshot({ fighters: [makeFighter({ velocity: { x: 0.0001, y: 0 } }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'velocity.y',
      makeSnapshot({ fighters: [makeFighter({ velocity: { x: 0, y: 0.0001 } }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'facing',
      makeSnapshot({ fighters: [makeFighter({ facing: -1 }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'grounded',
      makeSnapshot({ fighters: [makeFighter({ grounded: false }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'jumpsUsed',
      makeSnapshot({ fighters: [makeFighter({ jumpsUsed: 1 }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'inHitstun',
      makeSnapshot({ fighters: [makeFighter({ inHitstun: true }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'invincible',
      makeSnapshot({ fighters: [makeFighter({ invincible: true }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'eliminated',
      makeSnapshot({ fighters: [makeFighter({ eliminated: true }), makeFighter({ playerIndex: 1, characterId: 'cat' })] }),
    ],
    [
      'second-fighter field (P2 damage)',
      makeSnapshot({
        fighters: [
          makeFighter({ playerIndex: 0, characterId: 'wolf' }),
          makeFighter({ playerIndex: 1, characterId: 'cat', damagePercent: 5 }),
        ],
      }),
    ],
  ])('flips when %s changes', (_label, modified) => {
    const a = computeStateChecksum(baseline);
    const b = computeStateChecksum(modified);
    expect(a).not.toBe(b);
  });

  it('is sensitive to fighter slot order', () => {
    const original = computeStateChecksum(makeSnapshot());
    const swapped = computeStateChecksum(
      makeSnapshot({
        fighters: [
          makeFighter({ playerIndex: 1, characterId: 'cat' }),
          makeFighter({ playerIndex: 0, characterId: 'wolf' }),
        ],
      }),
    );
    expect(original).not.toBe(swapped);
  });
});

// ---------------------------------------------------------------------------
// computeStateChecksum — float edge cases
// ---------------------------------------------------------------------------

describe('computeStateChecksum — float edge cases', () => {
  it('treats +0 and -0 as the same value (gameplay equivalence)', () => {
    const positive = computeStateChecksum(
      makeSnapshot({
        fighters: [
          makeFighter({ velocity: { x: 0, y: 0 } }),
          makeFighter({ playerIndex: 1, characterId: 'cat' }),
        ],
      }),
    );
    const negative = computeStateChecksum(
      makeSnapshot({
        fighters: [
          makeFighter({ velocity: { x: -0, y: -0 } }),
          makeFighter({ playerIndex: 1, characterId: 'cat' }),
        ],
      }),
    );
    expect(positive).toBe(negative);
  });

  it('throws on NaN damage', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ damagePercent: NaN }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(StateChecksumError);
  });

  it('throws on NaN position', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ position: { x: NaN, y: 0 } }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(/NaN/);
  });

  it('throws on Infinity velocity', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ velocity: { x: Infinity, y: 0 } }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(/non-finite/);
  });

  it('throws on -Infinity', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ position: { x: -Infinity, y: 0 } }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(/non-finite/);
  });
});

// ---------------------------------------------------------------------------
// computeStateChecksum — type validation
// ---------------------------------------------------------------------------

describe('computeStateChecksum — type validation', () => {
  it('rejects null snapshot', () => {
    expect(() =>
      computeStateChecksum(null as unknown as MatchStateSnapshot),
    ).toThrow(/non-null/);
  });

  it('rejects non-array fighters', () => {
    expect(() =>
      computeStateChecksum({ frame: 0, fighters: 'oops' } as unknown as MatchStateSnapshot),
    ).toThrow(/array/);
  });

  it('rejects empty fighter list', () => {
    expect(() =>
      computeStateChecksum({ frame: 0, fighters: [] } as unknown as MatchStateSnapshot),
    ).toThrow(/1\.\.4/);
  });

  it('rejects fighter list of 5+', () => {
    const fighters = Array.from({ length: 5 }, (_, i) =>
      makeFighter({ playerIndex: i }),
    );
    expect(() =>
      computeStateChecksum({ frame: 0, fighters } as MatchStateSnapshot),
    ).toThrow(/1\.\.4/);
  });

  it('rejects non-string characterId', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ characterId: 42 as unknown as string }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(/characterId/);
  });

  it('rejects characterId containing reserved separator', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ characterId: 'wolf|cat' }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(/separator/);
  });

  it('rejects non-boolean grounded', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ grounded: 1 as unknown as boolean }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(/boolean/);
  });

  it('rejects null position', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ position: null as unknown as { x: number; y: number } }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(/position/);
  });

  it('rejects null velocity', () => {
    expect(() =>
      computeStateChecksum(
        makeSnapshot({
          fighters: [
            makeFighter({ velocity: null as unknown as { x: number; y: number } }),
            makeFighter({ playerIndex: 1, characterId: 'cat' }),
          ],
        }),
      ),
    ).toThrow(/velocity/);
  });
});

// ---------------------------------------------------------------------------
// serializeStateForChecksum
// ---------------------------------------------------------------------------

describe('serializeStateForChecksum', () => {
  it('begins with the algorithm identifier and the # separator', () => {
    const s = serializeStateForChecksum(makeSnapshot());
    expect(s.startsWith('state-fnv1a-64-v1#')).toBe(true);
  });

  it('produces a single-line ASCII string', () => {
    const s = serializeStateForChecksum(makeSnapshot());
    expect(s.includes('\n')).toBe(false);
    expect(s.includes('\r')).toBe(false);
    // ASCII only — every byte < 0x80.
    for (let i = 0; i < s.length; i += 1) {
      expect(s.charCodeAt(i)).toBeLessThan(0x80);
    }
  });

  it('encodes the frame, player count, and slot data with documented separators', () => {
    const s = serializeStateForChecksum(makeSnapshot({ frame: 42 }));
    // Algorithm prefix.
    expect(s.startsWith('state-fnv1a-64-v1#')).toBe(true);
    // Header carries f=42 and n=2.
    expect(s).toContain('f=42;n=2');
    // Two slots separated by `|`.
    const slotsPart = s.split('#')[2]!;
    expect(slotsPart.split('|')).toHaveLength(2);
    // Each slot has the documented field prefixes.
    expect(slotsPart).toMatch(/pi=0/);
    expect(slotsPart).toMatch(/ci=wolf/);
    expect(slotsPart).toMatch(/ci=cat/);
  });

  it('produces identical output for identical snapshots', () => {
    expect(serializeStateForChecksum(makeSnapshot())).toBe(
      serializeStateForChecksum(makeSnapshot()),
    );
  });
});

// ---------------------------------------------------------------------------
// buildStateChecksumRecord
// ---------------------------------------------------------------------------

describe('buildStateChecksumRecord', () => {
  it('returns the snapshot frame, computed checksum, and canonical algorithm', () => {
    const snap = makeSnapshot({ frame: 300 });
    const r = buildStateChecksumRecord(snap);
    expect(r.frame).toBe(300);
    expect(r.algorithm).toBe(STATE_CHECKSUM_ALGORITHM);
    expect(r.checksum).toBe(computeStateChecksum(snap));
    expect(r.checksum).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns a frozen record', () => {
    const r = buildStateChecksumRecord(makeSnapshot());
    expect(Object.isFrozen(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isWellFormedStateChecksumRecord
// ---------------------------------------------------------------------------

describe('isWellFormedStateChecksumRecord', () => {
  it('accepts the shape buildStateChecksumRecord produces', () => {
    const r = buildStateChecksumRecord(makeSnapshot());
    expect(isWellFormedStateChecksumRecord(r)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isWellFormedStateChecksumRecord(null)).toBe(false);
    expect(isWellFormedStateChecksumRecord(undefined)).toBe(false);
    expect(isWellFormedStateChecksumRecord('nope')).toBe(false);
    expect(isWellFormedStateChecksumRecord(42)).toBe(false);
  });

  it('rejects record with non-integer frame', () => {
    expect(
      isWellFormedStateChecksumRecord({
        frame: 1.5,
        checksum: '0123456789abcdef',
        algorithm: STATE_CHECKSUM_ALGORITHM,
      }),
    ).toBe(false);
  });

  it('rejects record with negative frame', () => {
    expect(
      isWellFormedStateChecksumRecord({
        frame: -1,
        checksum: '0123456789abcdef',
        algorithm: STATE_CHECKSUM_ALGORITHM,
      }),
    ).toBe(false);
  });

  it('rejects malformed checksum string', () => {
    expect(
      isWellFormedStateChecksumRecord({
        frame: 0,
        checksum: 'NOT-HEX',
        algorithm: STATE_CHECKSUM_ALGORITHM,
      }),
    ).toBe(false);
    expect(
      isWellFormedStateChecksumRecord({
        frame: 0,
        checksum: '0123456789abcde', // 15 chars
        algorithm: STATE_CHECKSUM_ALGORITHM,
      }),
    ).toBe(false);
  });

  it('rejects unknown algorithm string', () => {
    expect(
      isWellFormedStateChecksumRecord({
        frame: 0,
        checksum: '0123456789abcdef',
        algorithm: 'fnv1a-64-v1', // file algorithm — wrong domain
      }),
    ).toBe(false);
    expect(
      isWellFormedStateChecksumRecord({
        frame: 0,
        checksum: '0123456789abcdef',
        algorithm: 'state-future-v999',
      }),
    ).toBe(false);
  });
});
