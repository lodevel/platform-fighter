import { describe, expect, it } from 'vitest';
import {
  CUSTOM_STAGE_NAME_MAX_LENGTH,
  CUSTOM_STAGE_SCHEMA_VERSION,
  CUSTOM_STAGE_SLOT_ID_MAX_LENGTH,
  RECOGNISED_PIECE_TYPES,
  STAGE_SCHEMA_LIMITS,
  STAGE_SCHEMA_VERSION,
  isValidStageData,
  isValidStageIndex,
  validateStageData,
  validateStageEnvelope,
  validateStageIndex,
  validateStageIndexEnvelope,
  type CustomStageData,
  type CustomStageIndexData,
  type SerializedCustomStage,
  type SerializedCustomStageIndex,
  type SerializedStagePiece,
} from './stageSchema';
import {
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  BUILDER_CANVAS_MAX_HEIGHT,
  BUILDER_CANVAS_MAX_WIDTH,
  BUILDER_GRID_CELL_PX,
} from './builderGrid';
import { STAGE_PIECE_LIMIT } from './stageDataModel';
import {
  serializeCustomStage,
  serializeCustomStageIndex,
} from './customStageSerializer';

/**
 * AC 20101 Sub-AC 1 — stage serialization schema + integrity validator.
 *
 * Locks down:
 *
 *   1. Schema version + limit constants are stable + match the
 *      serializer's legacy declaration site (single source of truth).
 *   2. Result-style validators agree with the legacy assertion-style
 *      validators on accept / reject, but never throw.
 *   3. Every Seed-mandated integrity invariant is enforced and surfaced
 *      with a stable `reason` code + a path-tagged message.
 *   4. Round-trip: serialise → validate envelope → identical body, so
 *      the schema declared here matches the JSON the serializer emits.
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

function makeStage(overrides: Partial<CustomStageData> = {}): CustomStageData {
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

function makeIndex(
  overrides: Partial<CustomStageIndexData> = {},
): CustomStageIndexData {
  return {
    slots: [
      { id: 'lava-tower', name: 'Lava Tower' },
      { id: 'wind-castle', name: 'Wind Castle' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('schema constants', () => {
  it('aliases the legacy schema-version constant', () => {
    expect(STAGE_SCHEMA_VERSION).toBe(CUSTOM_STAGE_SCHEMA_VERSION);
    expect(STAGE_SCHEMA_VERSION).toBe(1);
  });

  it('exposes every limit through STAGE_SCHEMA_LIMITS', () => {
    expect(STAGE_SCHEMA_LIMITS.schemaVersion).toBe(STAGE_SCHEMA_VERSION);
    expect(STAGE_SCHEMA_LIMITS.pieceLimit).toBe(STAGE_PIECE_LIMIT);
    expect(STAGE_SCHEMA_LIMITS.canvasMaxWidthPx).toBe(BUILDER_CANVAS_MAX_WIDTH);
    expect(STAGE_SCHEMA_LIMITS.canvasMaxHeightPx).toBe(BUILDER_CANVAS_MAX_HEIGHT);
    expect(STAGE_SCHEMA_LIMITS.nameMaxLength).toBe(CUSTOM_STAGE_NAME_MAX_LENGTH);
    expect(STAGE_SCHEMA_LIMITS.slotIdMaxLength).toBe(CUSTOM_STAGE_SLOT_ID_MAX_LENGTH);
  });

  it('freezes STAGE_SCHEMA_LIMITS', () => {
    expect(Object.isFrozen(STAGE_SCHEMA_LIMITS)).toBe(true);
  });

  it('re-exports the recognised piece types in catalog order', () => {
    // We only verify the collection has 8 entries (the Seed mandate).
    expect(RECOGNISED_PIECE_TYPES.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// validateStageData — body-level
// ---------------------------------------------------------------------------

describe('validateStageData', () => {
  it('accepts a minimal valid stage', () => {
    const result = validateStageData(makeStage());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Lava Tower');
      expect(result.value.pieces).toHaveLength(1);
    }
  });

  it('accepts an empty piece list', () => {
    const result = validateStageData(makeStage({ pieces: [] }));
    expect(result.ok).toBe(true);
  });

  it('rejects null / non-object roots with a "not-an-object" reason', () => {
    const r1 = validateStageData(null);
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.reason).toBe('not-an-object');
      expect(r1.path).toBe('stage');
    }
    expect(validateStageData('not a stage').ok).toBe(false);
    expect(validateStageData(42).ok).toBe(false);
  });

  it('respects a custom rootPath in the failure path', () => {
    const r = validateStageData(null, 'imported');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe('imported');
  });

  it('rejects empty / whitespace name with "name-empty"', () => {
    const r1 = validateStageData(makeStage({ name: '' }));
    expect(r1.ok).toBe(false);
    if (!r1.ok) {
      expect(r1.reason).toBe('name-empty');
      expect(r1.path).toBe('stage.name');
    }
    expect(validateStageData(makeStage({ name: '   ' })).ok).toBe(false);
  });

  it('rejects names longer than the cap', () => {
    const tooLong = 'a'.repeat(CUSTOM_STAGE_NAME_MAX_LENGTH + 1);
    const r = validateStageData(makeStage({ name: tooLong }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('name-too-long');
  });

  it('rejects control characters in the name', () => {
    const r = validateStageData(makeStage({ name: 'bad\x00name' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('name-control-characters');
  });

  it('rejects an unknown piece type with "unknown-piece-type"', () => {
    const r = validateStageData(
      makeStage({
        pieces: [makePiece({ type: 'lava-zone-2' as SerializedStagePiece['type'] })],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unknown-piece-type');
      expect(r.path).toBe('stage.pieces[0].type');
    }
  });

  it('rejects more than STAGE_PIECE_LIMIT pieces', () => {
    const overflow = Array.from({ length: STAGE_PIECE_LIMIT + 1 }, () => makePiece());
    const r = validateStageData(makeStage({ pieces: overflow }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('piece-count-exceeded');
  });

  it('accepts exactly STAGE_PIECE_LIMIT pieces', () => {
    const max = Array.from({ length: STAGE_PIECE_LIMIT }, () => makePiece());
    const r = validateStageData(makeStage({ pieces: max }));
    expect(r.ok).toBe(true);
  });

  it('rejects a non-array pieces field', () => {
    const r = validateStageData(makeStage({ pieces: 'oops' as unknown as SerializedStagePiece[] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('wrong-type');
      expect(r.path).toBe('stage.pieces');
    }
  });

  it('rejects a piece with a negative position with "piece-negative-position"', () => {
    const r = validateStageData(
      makeStage({ pieces: [makePiece({ canvasX: -1 })] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('piece-negative-position');
  });

  it('rejects a piece that clips the right canvas edge', () => {
    const r = validateStageData(
      makeStage({
        pieces: [makePiece({ canvasX: BUILDER_CANVAS_DEFAULT_WIDTH - 40, width: 160 })],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('piece-out-of-bounds');
  });

  it('rejects a piece with a non-positive footprint', () => {
    const r = validateStageData(
      makeStage({ pieces: [makePiece({ width: 0 })] }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('piece-non-positive');
  });

  it('rejects a non-finite numeric field with "wrong-type"', () => {
    const r = validateStageData(
      makeStage({
        pieces: [makePiece({ canvasX: Number.NaN as unknown as number })],
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('wrong-type');
      expect(r.path).toBe('stage.pieces[0].canvasX');
    }
  });

  it('rejects a canvas smaller than one cell with "canvas-too-small"', () => {
    const r = validateStageData(
      makeStage({
        gridSpec: { cellPx: BUILDER_GRID_CELL_PX, width: 0, height: 1080 },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('canvas-too-small');
  });

  it('rejects a canvas wider than the 2× screen cap', () => {
    const r = validateStageData(
      makeStage({
        gridSpec: {
          cellPx: BUILDER_GRID_CELL_PX,
          width: BUILDER_CANVAS_MAX_WIDTH + 1,
          height: BUILDER_CANVAS_DEFAULT_HEIGHT,
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('canvas-too-large');
  });

  it('rejects an invalid grid cell size with "invalid-grid-cell-px"', () => {
    const r = validateStageData(
      makeStage({
        gridSpec: {
          cellPx: 0,
          width: BUILDER_CANVAS_DEFAULT_WIDTH,
          height: BUILDER_CANVAS_DEFAULT_HEIGHT,
        },
      }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-grid-cell-px');
  });
});

// ---------------------------------------------------------------------------
// validateStageIndex
// ---------------------------------------------------------------------------

describe('validateStageIndex', () => {
  it('accepts a well-formed index', () => {
    expect(validateStageIndex(makeIndex()).ok).toBe(true);
  });

  it('accepts an empty slot list', () => {
    expect(validateStageIndex(makeIndex({ slots: [] })).ok).toBe(true);
  });

  it('rejects a non-object root', () => {
    expect(validateStageIndex(null).ok).toBe(false);
    expect(validateStageIndex(42).ok).toBe(false);
  });

  it('rejects a non-array slots field', () => {
    const r = validateStageIndex({ slots: 'nope' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('wrong-type');
      expect(r.path).toBe('index.slots');
    }
  });

  it('rejects an entry that is not an object', () => {
    const r = validateStageIndex({ slots: [null] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-an-object');
  });

  it('rejects an entry with a non-string id', () => {
    const r = validateStageIndex({
      slots: [{ id: 42, name: 'oops' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-type');
  });

  it('rejects an entry with an empty id', () => {
    const r = validateStageIndex({ slots: [{ id: '', name: 'oops' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('slot-id-empty');
  });

  it('rejects an entry with an over-long id', () => {
    const r = validateStageIndex({
      slots: [
        {
          id: 'a'.repeat(CUSTOM_STAGE_SLOT_ID_MAX_LENGTH + 1),
          name: 'oops',
        },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('slot-id-too-long');
  });

  it('rejects duplicate slot ids', () => {
    const r = validateStageIndex({
      slots: [
        { id: 'lava-tower', name: 'A' },
        { id: 'lava-tower', name: 'B' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('duplicate-slot-id');
      expect(r.path).toBe('index.slots[1].id');
    }
  });

  it('rejects an entry whose name fails the name validator', () => {
    const r = validateStageIndex({
      slots: [{ id: 'ok-id', name: 'bad\x01name' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('name-control-characters');
  });
});

// ---------------------------------------------------------------------------
// Envelope validators
// ---------------------------------------------------------------------------

describe('validateStageEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    const envelope: SerializedCustomStage = {
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
      data: makeStage(),
    };
    const r = validateStageEnvelope(envelope);
    expect(r.ok).toBe(true);
  });

  it('rejects a non-object envelope', () => {
    expect(validateStageEnvelope('json').ok).toBe(false);
    expect(validateStageEnvelope(null).ok).toBe(false);
  });

  it('rejects a missing schemaVersion', () => {
    const r = validateStageEnvelope({
      kind: 'customStage',
      data: makeStage(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe('envelope.schemaVersion');
  });

  it('rejects an unsupported schemaVersion', () => {
    const r = validateStageEnvelope({
      schemaVersion: STAGE_SCHEMA_VERSION + 1,
      kind: 'customStage',
      data: makeStage(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsupported-schema-version');
  });

  it('rejects a non-integer schemaVersion', () => {
    const r = validateStageEnvelope({
      schemaVersion: 1.5,
      kind: 'customStage',
      data: makeStage(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-type');
  });

  it('rejects an unknown envelope kind', () => {
    const r = validateStageEnvelope({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'replay',
      data: makeStage(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-envelope-kind');
  });

  it('rejects a customStageIndex envelope on the stage path', () => {
    const r = validateStageEnvelope({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStageIndex',
      data: makeIndex(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-envelope-kind');
  });

  it('rejects a missing data field', () => {
    const r = validateStageEnvelope({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-field');
  });

  it('propagates body-level failures', () => {
    const r = validateStageEnvelope({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
      data: makeStage({ name: '' }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('name-empty');
      expect(r.path).toBe('envelope.data.name');
    }
  });
});

describe('validateStageIndexEnvelope', () => {
  it('accepts a well-formed index envelope', () => {
    const envelope: SerializedCustomStageIndex = {
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStageIndex',
      data: makeIndex(),
    };
    expect(validateStageIndexEnvelope(envelope).ok).toBe(true);
  });

  it('rejects a customStage envelope on the index path', () => {
    const r = validateStageIndexEnvelope({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
      data: makeStage(),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-envelope-kind');
  });

  it('propagates duplicate-slot-id from the body', () => {
    const r = validateStageIndexEnvelope({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStageIndex',
      data: { slots: [
        { id: 'a', name: 'A' },
        { id: 'a', name: 'B' },
      ] },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('duplicate-slot-id');
      expect(r.path).toBe('envelope.data.slots[1].id');
    }
  });
});

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

describe('isValidStageData / isValidStageIndex', () => {
  it('returns true for valid bodies', () => {
    expect(isValidStageData(makeStage())).toBe(true);
    expect(isValidStageIndex(makeIndex())).toBe(true);
  });

  it('returns false for invalid bodies', () => {
    expect(isValidStageData(null)).toBe(false);
    expect(isValidStageData({})).toBe(false);
    expect(isValidStageIndex(null)).toBe(false);
    expect(isValidStageIndex({ slots: 'oops' })).toBe(false);
  });

  it('does not throw on hostile input', () => {
    expect(() => isValidStageData({ pieces: { length: 1e9 } })).not.toThrow();
    expect(() => isValidStageIndex({ slots: { length: 1e9 } })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Round-trip with the legacy serializer — proves the schema declared
// here matches the JSON the serializer emits.
// ---------------------------------------------------------------------------

describe('round-trip with customStageSerializer', () => {
  it('validates the JSON the serializer emits for a stage', () => {
    const stage = makeStage();
    const json = serializeCustomStage(stage);
    const parsed = JSON.parse(json) as unknown;
    const r = validateStageEnvelope(parsed);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.data.name).toBe(stage.name);
      expect(r.value.data.pieces.length).toBe(stage.pieces.length);
    }
  });

  it('validates the JSON the serializer emits for an index', () => {
    const index = makeIndex();
    const json = serializeCustomStageIndex(index);
    const parsed = JSON.parse(json) as unknown;
    const r = validateStageIndexEnvelope(parsed);
    expect(r.ok).toBe(true);
  });
});
