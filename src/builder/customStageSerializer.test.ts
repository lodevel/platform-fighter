import { describe, expect, it } from 'vitest';
import {
  CUSTOM_STAGE_NAME_MAX_LENGTH,
  CUSTOM_STAGE_SCHEMA_VERSION,
  CUSTOM_STAGE_SLOT_ID_MAX_LENGTH,
  RECOGNISED_PIECE_TYPES,
  assertValidCustomStageData,
  assertValidCustomStageIndexData,
  assertValidCustomStageName,
  assertValidGridSpec,
  assertValidStagePiece,
  buildCustomStageData,
  customStageSlotIdFromName,
  deserializeCustomStage,
  deserializeCustomStageIndex,
  detectSerializedKind,
  safeDeserializeCustomStage,
  safeDeserializeCustomStageIndex,
  serializeCustomStage,
  serializeCustomStageIndex,
  toSerializedGridSpec,
  toSerializedPiece,
  type CustomStageData,
  type CustomStageIndexData,
  type SerializedStagePiece,
} from './customStageSerializer';
import {
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  BUILDER_CANVAS_MAX_HEIGHT,
  BUILDER_CANVAS_MAX_WIDTH,
  BUILDER_GRID_CELL_PX,
  buildGridSpec,
  DEFAULT_GRID_SPEC,
} from './builderGrid';
import { STAGE_PIECE_LIMIT } from './stageDataModel';
import { CATALOG_PIECES } from './catalogPieces';
import type { PlacedPiece } from './dragDrop';

/**
 * AC 20104 Sub-AC 3 — custom-stage serializer.
 *
 * Locks down:
 *
 *   1. Schema version + envelope discriminator constants.
 *   2. Slot id derivation rules (lowercase, dash-collapse, fallback).
 *   3. Serializer canonicalisation — same input → byte-identical JSON.
 *   4. Validator catches every shape that would corrupt the in-memory
 *      registry on load (unknown type, oversize canvas, > 30 pieces,
 *      bad name).
 *   5. Throwing + safe deserialise paths agree on accept / reject.
 *   6. Round-trip through JSON preserves piece order + grid spec.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePiece(
  overrides: Partial<SerializedStagePiece> = {},
): SerializedStagePiece {
  return {
    type: 'flat-platform',
    canvasX: 200,
    canvasY: 320,
    width: 160,
    height: 40,
    col: 5,
    row: 8,
    ...overrides,
  };
}

function makeStage(
  overrides: Partial<CustomStageData> = {},
): CustomStageData {
  return {
    name: 'Lava Tower',
    gridSpec: {
      cellPx: BUILDER_GRID_CELL_PX,
      width: BUILDER_CANVAS_DEFAULT_WIDTH,
      height: BUILDER_CANVAS_DEFAULT_HEIGHT,
    },
    pieces: [makePiece()],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema + recognised types
// ---------------------------------------------------------------------------

describe('CUSTOM_STAGE_SCHEMA_VERSION', () => {
  it('is the v1 release', () => {
    expect(CUSTOM_STAGE_SCHEMA_VERSION).toBe(1);
  });
});

describe('RECOGNISED_PIECE_TYPES', () => {
  it('matches the catalog', () => {
    expect(RECOGNISED_PIECE_TYPES).toEqual(CATALOG_PIECES.map((p) => p.type));
  });
});

// ---------------------------------------------------------------------------
// Slot id derivation
// ---------------------------------------------------------------------------

describe('customStageSlotIdFromName', () => {
  it('lowercases and dash-collapses non-alphanumeric runs', () => {
    expect(customStageSlotIdFromName('Lava Tower!!')).toBe('lava-tower');
    expect(customStageSlotIdFromName('  Wind  Castle  ')).toBe('wind-castle');
    expect(customStageSlotIdFromName('My/Stage—2')).toBe('my-stage-2');
  });

  it('strips leading + trailing dashes', () => {
    expect(customStageSlotIdFromName('---hello---')).toBe('hello');
  });

  it('falls back to "stage" for empty / whitespace / unicode-only input', () => {
    expect(customStageSlotIdFromName('')).toBe('stage');
    expect(customStageSlotIdFromName('   ')).toBe('stage');
    expect(customStageSlotIdFromName('!!!')).toBe('stage');
    // Non-string fallback — defensive, the public API should reject
    // non-strings before reaching this helper.
    expect(customStageSlotIdFromName(undefined as unknown as string)).toBe('stage');
  });

  it('caps id length and trims any trailing dash from truncation', () => {
    const long = 'a'.repeat(CUSTOM_STAGE_SLOT_ID_MAX_LENGTH + 8);
    const id = customStageSlotIdFromName(long);
    expect(id.length).toBeLessThanOrEqual(CUSTOM_STAGE_SLOT_ID_MAX_LENGTH);
    expect(id.endsWith('-')).toBe(false);
  });

  it('produces stable ids — same input, same output', () => {
    expect(customStageSlotIdFromName('Skybridge')).toBe(
      customStageSlotIdFromName('Skybridge'),
    );
  });
});

// ---------------------------------------------------------------------------
// Name validation
// ---------------------------------------------------------------------------

describe('assertValidCustomStageName', () => {
  it('accepts a plain name', () => {
    expect(() => assertValidCustomStageName('Lava Tower')).not.toThrow();
  });

  it('rejects non-string', () => {
    expect(() => assertValidCustomStageName(123 as unknown as string)).toThrow(
      /must be a string/,
    );
    expect(() => assertValidCustomStageName(null as unknown as string)).toThrow();
  });

  it('rejects empty / whitespace-only', () => {
    expect(() => assertValidCustomStageName('')).toThrow(
      /at least 1 non-whitespace/,
    );
    expect(() => assertValidCustomStageName('   ')).toThrow();
  });

  it('rejects names that exceed the max length after trim', () => {
    const tooLong = 'a'.repeat(CUSTOM_STAGE_NAME_MAX_LENGTH + 1);
    expect(() => assertValidCustomStageName(tooLong)).toThrow(/at most/);
  });

  it('accepts trailing whitespace that brings the length under the cap', () => {
    const padded = `   ${'a'.repeat(CUSTOM_STAGE_NAME_MAX_LENGTH)}   `;
    expect(() => assertValidCustomStageName(padded)).not.toThrow();
  });

  it('rejects names with control characters', () => {
    expect(() => assertValidCustomStageName('bad\x00name')).toThrow(
      /control characters/,
    );
    expect(() => assertValidCustomStageName('bad\nname')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Grid spec validation
// ---------------------------------------------------------------------------

describe('assertValidGridSpec', () => {
  const ok = {
    cellPx: BUILDER_GRID_CELL_PX,
    width: BUILDER_CANVAS_DEFAULT_WIDTH,
    height: BUILDER_CANVAS_DEFAULT_HEIGHT,
  };

  it('accepts the default grid spec', () => {
    expect(() => assertValidGridSpec(ok)).not.toThrow();
  });

  it('rejects null / non-object', () => {
    expect(() => assertValidGridSpec(null)).toThrow(/non-null object/);
    expect(() => assertValidGridSpec('foo' as unknown)).toThrow();
  });

  it('rejects non-finite numeric fields', () => {
    expect(() => assertValidGridSpec({ ...ok, cellPx: Number.NaN })).toThrow();
    expect(() => assertValidGridSpec({ ...ok, width: Infinity })).toThrow();
  });

  it('rejects oversize canvas (> 2× screen cap)', () => {
    expect(() =>
      assertValidGridSpec({ ...ok, width: BUILDER_CANVAS_MAX_WIDTH + 40 }),
    ).toThrow(/exceeds 2× screen cap/);
    expect(() =>
      assertValidGridSpec({ ...ok, height: BUILDER_CANVAS_MAX_HEIGHT + 40 }),
    ).toThrow();
  });

  it('rejects sub-cell canvas dimensions', () => {
    expect(() => assertValidGridSpec({ ...ok, width: 0 })).toThrow();
    expect(() => assertValidGridSpec({ ...ok, height: 1 })).toThrow();
  });

  it('rejects cellPx < 1', () => {
    expect(() => assertValidGridSpec({ ...ok, cellPx: 0 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Piece validation
// ---------------------------------------------------------------------------

describe('assertValidStagePiece', () => {
  const grid = {
    cellPx: BUILDER_GRID_CELL_PX,
    width: BUILDER_CANVAS_DEFAULT_WIDTH,
    height: BUILDER_CANVAS_DEFAULT_HEIGHT,
  };

  it('accepts a flat-platform inside the canvas', () => {
    expect(() => assertValidStagePiece(makePiece(), 0, grid)).not.toThrow();
  });

  it('rejects unknown piece types', () => {
    expect(() =>
      assertValidStagePiece(makePiece({ type: 'lava-zone-2' as never }), 0, grid),
    ).toThrow(/not in the catalog/);
  });

  it('rejects non-positive footprints', () => {
    expect(() =>
      assertValidStagePiece(makePiece({ width: 0 }), 0, grid),
    ).toThrow(/footprint must be positive/);
    expect(() =>
      assertValidStagePiece(makePiece({ height: -10 }), 0, grid),
    ).toThrow();
  });

  it('rejects out-of-canvas placement', () => {
    expect(() =>
      assertValidStagePiece(makePiece({ canvasX: -40 }), 0, grid),
    ).toThrow(/top-left must be ≥ 0/);
    expect(() =>
      assertValidStagePiece(makePiece({ canvasX: grid.width - 80, width: 200 }), 0, grid),
    ).toThrow(/right canvas edge/);
    expect(() =>
      assertValidStagePiece(makePiece({ canvasY: grid.height - 20, height: 200 }), 0, grid),
    ).toThrow(/bottom canvas edge/);
  });

  it('reports which index failed', () => {
    expect(() => assertValidStagePiece({ type: 'wat' }, 17, grid)).toThrow(
      /pieces\[17\]/,
    );
  });
});

// ---------------------------------------------------------------------------
// Stage data validation
// ---------------------------------------------------------------------------

describe('assertValidCustomStageData', () => {
  it('accepts the canonical fixture', () => {
    expect(() => assertValidCustomStageData(makeStage())).not.toThrow();
  });

  it('rejects pieces above the 30-piece hard cap', () => {
    const tooMany = Array.from({ length: STAGE_PIECE_LIMIT + 1 }, () =>
      makePiece(),
    );
    expect(() =>
      assertValidCustomStageData(makeStage({ pieces: tooMany })),
    ).toThrow(/exceeds the 30-piece/);
  });

  it('rejects when pieces is not an array', () => {
    expect(() =>
      assertValidCustomStageData(makeStage({ pieces: 'foo' as unknown as never })),
    ).toThrow(/must be an array/);
  });

  it('threads piece-level errors through', () => {
    expect(() =>
      assertValidCustomStageData(
        makeStage({
          pieces: [
            makePiece(),
            makePiece({ type: 'unknown' as never }),
          ],
        }),
      ),
    ).toThrow(/pieces\[1\]/);
  });
});

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

describe('buildCustomStageData', () => {
  it('drops registry-only fields and preserves order', () => {
    const placed: PlacedPiece[] = [
      makePiece({ type: 'flat-platform' }),
      makePiece({ type: 'lava-zone', canvasX: 400, canvasY: 240, width: 200, height: 80 }),
    ];
    const built = buildCustomStageData('My Stage', DEFAULT_GRID_SPEC, placed);
    expect(built.name).toBe('My Stage');
    expect(built.gridSpec).toEqual(toSerializedGridSpec(DEFAULT_GRID_SPEC));
    expect(built.pieces).toHaveLength(2);
    expect(built.pieces[0]?.type).toBe('flat-platform');
    expect(built.pieces[1]?.type).toBe('lava-zone');
    // Geometry fields round-trip verbatim.
    expect(built.pieces[0]).toEqual(toSerializedPiece(placed[0]!));
  });
});

// ---------------------------------------------------------------------------
// Serialise + deserialise round-trip
// ---------------------------------------------------------------------------

describe('serializeCustomStage / deserializeCustomStage', () => {
  it('round-trips a stage byte-for-byte', () => {
    const stage = makeStage({
      pieces: [
        makePiece(),
        makePiece({
          type: 'lava-zone',
          canvasX: 400,
          canvasY: 240,
          width: 200,
          height: 80,
          col: 10,
          row: 6,
        }),
        makePiece({
          type: 'spawn-point',
          canvasX: 800,
          canvasY: 200,
          width: 40,
          height: 40,
          col: 20,
          row: 5,
        }),
      ],
    });
    const json = serializeCustomStage(stage);
    const restored = deserializeCustomStage(json);
    expect(restored).toEqual(stage);
  });

  it('emits canonical key order so identical stages produce identical strings', () => {
    const a = serializeCustomStage(makeStage());
    const b = serializeCustomStage(makeStage());
    expect(a).toBe(b);
  });

  it('refuses to serialise an invalid stage', () => {
    expect(() =>
      serializeCustomStage(
        makeStage({ name: '' as unknown as string }) as unknown as CustomStageData,
      ),
    ).toThrow();
  });

  it('throws on malformed JSON', () => {
    expect(() => deserializeCustomStage('{not json')).toThrow(/not valid JSON/);
  });

  it('throws on wrong envelope kind', () => {
    const wrongKind = JSON.stringify({
      schemaVersion: CUSTOM_STAGE_SCHEMA_VERSION,
      kind: 'customStageIndex',
      data: { slots: [] },
    });
    expect(() => deserializeCustomStage(wrongKind)).toThrow(/expected envelope kind/);
  });

  it('throws on unsupported schema version', () => {
    const futureVersion = JSON.stringify({
      schemaVersion: CUSTOM_STAGE_SCHEMA_VERSION + 99,
      kind: 'customStage',
      data: makeStage(),
    });
    expect(() => deserializeCustomStage(futureVersion)).toThrow(
      /unsupported schemaVersion/,
    );
  });

  it('safeDeserialize variants do not throw', () => {
    const okJson = serializeCustomStage(makeStage());
    expect(safeDeserializeCustomStage(okJson)).toEqual({
      ok: true,
      value: makeStage(),
    });
    expect(safeDeserializeCustomStage('{not json').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Index validation + serialise + deserialise
// ---------------------------------------------------------------------------

describe('serializeCustomStageIndex / deserializeCustomStageIndex', () => {
  const ok: CustomStageIndexData = {
    slots: [
      { id: 'lava-tower', name: 'Lava Tower' },
      { id: 'wind-castle', name: 'Wind Castle' },
    ],
  };

  it('round-trips an index', () => {
    const restored = deserializeCustomStageIndex(serializeCustomStageIndex(ok));
    expect(restored).toEqual(ok);
  });

  it('rejects non-array slots', () => {
    expect(() =>
      assertValidCustomStageIndexData({ slots: 'not-an-array' }),
    ).toThrow(/must be an array/);
  });

  it('rejects duplicate slot ids', () => {
    expect(() =>
      assertValidCustomStageIndexData({
        slots: [
          { id: 'a', name: 'A' },
          { id: 'a', name: 'A2' },
        ],
      }),
    ).toThrow(/duplicate slot id/);
  });

  it('rejects malformed entries', () => {
    expect(() =>
      assertValidCustomStageIndexData({
        slots: [{ id: '', name: 'X' }],
      }),
    ).toThrow(/non-empty string/);
    expect(() =>
      assertValidCustomStageIndexData({
        slots: [{ id: 'x' }],
      }),
    ).toThrow();
  });

  it('safe variant on malformed JSON', () => {
    expect(safeDeserializeCustomStageIndex('garbage').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectSerializedKind
// ---------------------------------------------------------------------------

describe('detectSerializedKind', () => {
  it('identifies a customStage envelope', () => {
    expect(detectSerializedKind(serializeCustomStage(makeStage()))).toBe(
      'customStage',
    );
  });

  it('identifies a customStageIndex envelope', () => {
    expect(
      detectSerializedKind(
        serializeCustomStageIndex({ slots: [{ id: 'a', name: 'A' }] }),
      ),
    ).toBe('customStageIndex');
  });

  it('returns null for malformed inputs', () => {
    expect(detectSerializedKind('not-json')).toBeNull();
    expect(detectSerializedKind('null')).toBeNull();
    expect(detectSerializedKind('"bare-string"')).toBeNull();
  });

  it('returns null for the wrong schema version', () => {
    const wrongVersion = JSON.stringify({
      schemaVersion: 999,
      kind: 'customStage',
      data: makeStage(),
    });
    expect(detectSerializedKind(wrongVersion)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Build-time grid spec helper
// ---------------------------------------------------------------------------

describe('toSerializedGridSpec', () => {
  it('mirrors the input GridSpec verbatim', () => {
    const spec = buildGridSpec(800, 600);
    expect(toSerializedGridSpec(spec)).toEqual({
      cellPx: spec.cellPx,
      width: spec.width,
      height: spec.height,
    });
  });
});
