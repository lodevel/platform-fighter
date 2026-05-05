import { describe, expect, it } from 'vitest';
import {
  blastZoneFromParsed,
  hazardsFromParsed,
  isParseableStageJson,
  parseStageData,
  parseStageEnvelope,
  parseStageJson,
  parseStageJsonOrThrow,
  platformsFromParsed,
  spawnPointsFromParsed,
  type ParsedStage,
} from './stageDataParser';
import {
  CUSTOM_STAGE_BLAST_ZONE_OUTSET,
  CUSTOM_STAGE_ID_PREFIX,
  CUSTOM_LAVA_CYCLE_FRAMES,
  CUSTOM_MOVING_PLATFORM_CYCLE_FRAMES,
  CUSTOM_WIND_CYCLE_FRAMES,
} from './customStageLoader';
import {
  buildCustomStageData,
  serializeCustomStage,
  type CustomStageData,
} from '../builder/customStageSerializer';
import {
  BUILDER_CANVAS_DEFAULT_HEIGHT,
  BUILDER_CANVAS_DEFAULT_WIDTH,
  DEFAULT_GRID_SPEC,
} from '../builder/builderGrid';
import type { PlacedPiece } from '../builder/dragDrop';
import { STAGE_PIECE_LIMIT } from '../builder/stageDataModel';
import { STAGE_SCHEMA_VERSION } from '../builder/stageSchema';

/**
 * AC 20201 Sub-AC 1 — stage data deserializer/parser module that
 * validates the saved stage JSON schema and converts it to an in-
 * memory stage descriptor.
 *
 * The tests below lock down:
 *
 *   1. JSON-string entry point validates + parses + converts in one
 *      pass and returns both the body and the runtime layout.
 *   2. Envelope-level entry point rejects the four envelope-shape
 *      failure modes (`'unsupported-schema-version'`,
 *      `'unknown-envelope-kind'`, `'missing-field'`, malformed
 *      object) without throwing.
 *   3. Body-level entry point reuses the schema validator so every
 *      structural failure surfaces with the canonical reason + path.
 *   4. The runtime descriptor is shaped exactly like a built-in
 *      stage: platforms / hazards / spawn points / blast zone all
 *      present and frozen, with the canonical custom-stage outset.
 *   5. Round-trip determinism: serialise → parse yields identical
 *      runtime layouts byte-for-byte.
 *   6. Throwing variant rethrows the structured failure with the
 *      `reason` + `path` baked into the message.
 *   7. Boundary helpers (predicates + accessors) match the parser
 *      result.
 *   8. `acceptRawBody: true` accepts a body without an envelope so
 *      `localStorage`-loaded bodies don't have to be re-wrapped.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePiece(overrides: Partial<PlacedPiece>): PlacedPiece {
  return {
    type: 'flat-platform',
    canvasX: 0,
    canvasY: 0,
    width: 160,
    height: 40,
    col: 0,
    row: 0,
    ...overrides,
  };
}

function makeData(name: string = 'Lava Tower'): CustomStageData {
  return buildCustomStageData(name, DEFAULT_GRID_SPEC, [
    makePiece({ type: 'flat-platform', canvasX: 200, canvasY: 600 }),
    makePiece({
      type: 'lava-zone',
      canvasX: 400,
      canvasY: 700,
      width: 80,
      height: 40,
    }),
    makePiece({
      type: 'wind-zone',
      canvasX: 600,
      canvasY: 300,
      width: 120,
      height: 200,
    }),
    makePiece({
      type: 'moving-platform',
      canvasX: 1000,
      canvasY: 500,
      width: 160,
      height: 40,
    }),
    makePiece({
      type: 'spawn-point',
      canvasX: 100,
      canvasY: 100,
      width: 40,
      height: 40,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// JSON entry point
// ---------------------------------------------------------------------------

describe('parseStageJson — happy path', () => {
  it('validates the envelope, parses the body, and returns a runtime layout', () => {
    const data = makeData();
    const json = serializeCustomStage(data);

    const result = parseStageJson(json);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data.name).toBe('Lava Tower');
    expect(result.value.layout.id).toBe(`${CUSTOM_STAGE_ID_PREFIX}lava-tower`);
    // Platforms: flat + moving = 2.
    expect(result.value.layout.platforms.length).toBe(2);
    // Hazards: lava + wind = 2.
    expect(result.value.layout.hazards.length).toBe(2);
    // Spawn points: 1 explicit + 3 fallback = 4.
    expect(result.value.layout.spawnPoints.length).toBe(4);
    // Blast zone: canonical outset around the 1920×1080 canvas.
    expect(result.value.layout.blastZone.left).toBe(
      -CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal,
    );
    expect(result.value.layout.blastZone.right).toBe(
      DEFAULT_GRID_SPEC.width + CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal,
    );
    expect(result.value.layout.blastZone.top).toBe(
      -CUSTOM_STAGE_BLAST_ZONE_OUTSET.top,
    );
    expect(result.value.layout.blastZone.bottom).toBe(
      DEFAULT_GRID_SPEC.height + CUSTOM_STAGE_BLAST_ZONE_OUTSET.bottom,
    );
  });

  it('forwards runtimeIdOverride into the runtime layout id', () => {
    const data = makeData();
    const json = serializeCustomStage(data);
    const result = parseStageJson(json, {
      runtimeIdOverride: 'custom:my-slot-id',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.layout.id).toBe('custom:my-slot-id');
  });

  it('preserves piece insertion order in the runtime body', () => {
    const data = buildCustomStageData('Order Test', DEFAULT_GRID_SPEC, [
      makePiece({ type: 'flat-platform', canvasX: 100, canvasY: 800, width: 80, height: 40 }),
      makePiece({ type: 'flat-platform', canvasX: 400, canvasY: 800, width: 80, height: 40 }),
      makePiece({ type: 'flat-platform', canvasX: 700, canvasY: 800, width: 80, height: 40 }),
    ]);
    const json = serializeCustomStage(data);
    const result = parseStageJson(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.layout.platforms.map((p) => p.x)).toEqual([
      140, 440, 740,
    ]);
  });

  it('produces deterministic, equal layouts for two parses of the same JSON', () => {
    const json = serializeCustomStage(makeData());
    const a = parseStageJson(json);
    const b = parseStageJson(json);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.value.layout)).toBe(JSON.stringify(b.value.layout));
  });

  it('maps a moving-platform piece to a kinematic StagePlatform with motion', () => {
    const data = buildCustomStageData('Movers', DEFAULT_GRID_SPEC, [
      makePiece({
        type: 'moving-platform',
        canvasX: 800,
        canvasY: 500,
        width: 160,
        height: 40,
      }),
    ]);
    const result = parseStageJson(serializeCustomStage(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const platform = result.value.layout.platforms[0];
    expect(platform).toBeDefined();
    expect(platform!.behavior).toBe('moving');
    expect(platform!.motion).toBeDefined();
    expect(platform!.motion!.cycleFrames).toBe(CUSTOM_MOVING_PLATFORM_CYCLE_FRAMES);
  });

  it('maps lava + wind pieces to StageHazard records with the canonical cycle frames', () => {
    const data = buildCustomStageData('Hazards', DEFAULT_GRID_SPEC, [
      makePiece({
        type: 'lava-zone',
        canvasX: 200,
        canvasY: 800,
        width: 80,
        height: 40,
      }),
      makePiece({
        type: 'wind-zone',
        canvasX: 600,
        canvasY: 300,
        width: 120,
        height: 200,
      }),
    ]);
    const result = parseStageJson(serializeCustomStage(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lava = result.value.layout.hazards.find((h) => h.type === 'lava');
    const wind = result.value.layout.hazards.find((h) => h.type === 'wind');
    expect(lava?.cycleFrames).toBe(CUSTOM_LAVA_CYCLE_FRAMES);
    expect(wind?.cycleFrames).toBe(CUSTOM_WIND_CYCLE_FRAMES);
  });
});

// ---------------------------------------------------------------------------
// Failure modes — JSON / envelope
// ---------------------------------------------------------------------------

describe('parseStageJson — failure modes', () => {
  it('rejects a non-string input with reason wrong-type at path json', () => {
    // @ts-expect-error — runtime guard test
    const result = parseStageJson(42);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('wrong-type');
    expect(result.path).toBe('json');
  });

  it('rejects malformed JSON without throwing', () => {
    const result = parseStageJson('{not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('wrong-type');
    expect(result.path).toBe('json');
    expect(result.message).toMatch(/not valid JSON/i);
  });

  it('rejects an envelope with an unsupported schemaVersion', () => {
    const blob = JSON.stringify({
      schemaVersion: STAGE_SCHEMA_VERSION + 1,
      kind: 'customStage',
      data: makeData(),
    });
    const result = parseStageJson(blob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unsupported-schema-version');
    expect(result.path).toContain('schemaVersion');
  });

  it('rejects an envelope with a wrong/unknown kind', () => {
    const blob = JSON.stringify({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'somethingElse',
      data: makeData(),
    });
    const result = parseStageJson(blob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-envelope-kind');
  });

  it('rejects an envelope with missing data', () => {
    const blob = JSON.stringify({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
    });
    const result = parseStageJson(blob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('missing-field');
  });

  it('rejects a body with an unknown piece type', () => {
    const data = makeData();
    const blob = JSON.stringify({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
      data: {
        ...data,
        pieces: [
          ...data.pieces,
          { ...data.pieces[0], type: 'lava-zone-2' },
        ],
      },
    });
    const result = parseStageJson(blob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-piece-type');
    expect(result.path).toMatch(/pieces\[\d+\]\.type/);
  });

  it('rejects a body whose pieces exceed the 30-piece hard cap', () => {
    const tooMany: PlacedPiece[] = [];
    for (let i = 0; i <= STAGE_PIECE_LIMIT; i += 1) {
      tooMany.push(
        makePiece({
          type: 'flat-platform',
          canvasX: (i * 32) % 1600,
          canvasY: 800,
          width: 32,
          height: 32,
          col: i,
          row: 0,
        }),
      );
    }
    const data = buildCustomStageData('Overflow', DEFAULT_GRID_SPEC, tooMany);
    const blob = JSON.stringify({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
      data,
    });
    const result = parseStageJson(blob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('piece-count-exceeded');
  });

  it('rejects a body whose canvas exceeds the 2× screen cap', () => {
    const data = {
      name: 'Too Big',
      gridSpec: { cellPx: 32, width: 99_999, height: BUILDER_CANVAS_DEFAULT_HEIGHT },
      pieces: [],
    } satisfies CustomStageData;
    const blob = JSON.stringify({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
      data,
    });
    const result = parseStageJson(blob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('canvas-too-large');
  });

  it('rejects a piece that clips the right canvas edge', () => {
    const data = {
      name: 'Clipper',
      gridSpec: {
        cellPx: 32,
        width: BUILDER_CANVAS_DEFAULT_WIDTH,
        height: BUILDER_CANVAS_DEFAULT_HEIGHT,
      },
      pieces: [
        {
          type: 'flat-platform',
          canvasX: BUILDER_CANVAS_DEFAULT_WIDTH - 100,
          canvasY: 800,
          width: 200,
          height: 40,
          col: 0,
          row: 0,
        },
      ],
    } satisfies CustomStageData;
    const blob = JSON.stringify({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
      data,
    });
    const result = parseStageJson(blob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('piece-out-of-bounds');
  });

  it('rejects a body with an empty name', () => {
    const data = makeData();
    const blob = JSON.stringify({
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage',
      data: { ...data, name: '   ' },
    });
    const result = parseStageJson(blob);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('name-empty');
  });
});

// ---------------------------------------------------------------------------
// parseStageEnvelope — direct entry point for already-parsed JSON
// ---------------------------------------------------------------------------

describe('parseStageEnvelope', () => {
  it('accepts a parsed envelope object directly', () => {
    const data = makeData();
    const envelope = {
      schemaVersion: STAGE_SCHEMA_VERSION,
      kind: 'customStage' as const,
      data,
    };
    const result = parseStageEnvelope(envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data.name).toBe(data.name);
    expect(result.value.layout.platforms.length).toBeGreaterThan(0);
  });

  it('rejects a non-object candidate', () => {
    const result = parseStageEnvelope('not an envelope');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-an-object');
  });
});

// ---------------------------------------------------------------------------
// parseStageData — body-level entry point
// ---------------------------------------------------------------------------

describe('parseStageData', () => {
  it('accepts a raw body without an envelope wrapper', () => {
    const data = makeData('Body Only');
    const result = parseStageData(data);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data.name).toBe('Body Only');
    expect(result.value.layout.id).toBe(`${CUSTOM_STAGE_ID_PREFIX}body-only`);
  });

  it('reports the same failure shape the schema validator emits', () => {
    const result = parseStageData({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Missing name surfaces as wrong-type at stage.name.
    expect(result.path).toContain('name');
  });
});

// ---------------------------------------------------------------------------
// acceptRawBody flag on parseStageJson
// ---------------------------------------------------------------------------

describe('parseStageJson — acceptRawBody flag', () => {
  it('parses a raw-body JSON string when acceptRawBody is true', () => {
    const data = makeData('Body JSON');
    const bodyJson = JSON.stringify(data);
    const result = parseStageJson(bodyJson, { acceptRawBody: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data.name).toBe('Body JSON');
  });

  it('still accepts an enveloped JSON string when acceptRawBody is true', () => {
    const json = serializeCustomStage(makeData());
    const result = parseStageJson(json, { acceptRawBody: true });
    expect(result.ok).toBe(true);
  });

  it('rejects a raw body when acceptRawBody is false (default)', () => {
    const bodyJson = JSON.stringify(makeData());
    const result = parseStageJson(bodyJson);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The body has no `schemaVersion`/`kind` so envelope check fails.
    expect(['wrong-type', 'unknown-envelope-kind']).toContain(result.reason);
  });
});

// ---------------------------------------------------------------------------
// Throwing variant
// ---------------------------------------------------------------------------

describe('parseStageJsonOrThrow', () => {
  it('returns the parsed stage on success', () => {
    const json = serializeCustomStage(makeData());
    const parsed = parseStageJsonOrThrow(json);
    expect(parsed.layout.platforms.length).toBeGreaterThan(0);
    expect(parsed.data.name).toBe('Lava Tower');
  });

  it('throws an error tagged with the reason + path on failure', () => {
    expect(() => parseStageJsonOrThrow('{not json')).toThrow(/wrong-type/);
    expect(() => parseStageJsonOrThrow('{not json')).toThrow(/json/);
  });
});

// ---------------------------------------------------------------------------
// Boundary helpers
// ---------------------------------------------------------------------------

describe('boundary helpers', () => {
  function getParsed(): ParsedStage {
    const result = parseStageJson(serializeCustomStage(makeData()));
    if (!result.ok) throw new Error('fixture parse failed');
    return result.value;
  }

  it('isParseableStageJson returns true for valid JSON', () => {
    expect(isParseableStageJson(serializeCustomStage(makeData()))).toBe(true);
  });

  it('isParseableStageJson returns false for malformed JSON', () => {
    expect(isParseableStageJson('{not json')).toBe(false);
  });

  it('blastZoneFromParsed returns the layout blast zone', () => {
    const parsed = getParsed();
    expect(blastZoneFromParsed(parsed)).toBe(parsed.layout.blastZone);
  });

  it('platformsFromParsed returns the layout platform array', () => {
    const parsed = getParsed();
    expect(platformsFromParsed(parsed)).toBe(parsed.layout.platforms);
  });

  it('hazardsFromParsed returns the layout hazard array', () => {
    const parsed = getParsed();
    expect(hazardsFromParsed(parsed)).toBe(parsed.layout.hazards);
  });

  it('spawnPointsFromParsed returns the layout spawn point array', () => {
    const parsed = getParsed();
    expect(spawnPointsFromParsed(parsed)).toBe(parsed.layout.spawnPoints);
  });
});

// ---------------------------------------------------------------------------
// Round-trip determinism — the parser is the inverse of the serializer.
// ---------------------------------------------------------------------------

describe('round-trip', () => {
  it('serialise → parseStageJson preserves every body field', () => {
    const data = makeData('Round Trip');
    const result = parseStageJson(serializeCustomStage(data));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.data.name).toBe(data.name);
    expect(result.value.data.pieces.length).toBe(data.pieces.length);
    expect(result.value.data.gridSpec).toEqual(data.gridSpec);
    for (let i = 0; i < data.pieces.length; i += 1) {
      expect(result.value.data.pieces[i]).toEqual(data.pieces[i]);
    }
  });

  it('two parses of the same JSON produce structurally identical layouts', () => {
    const json = serializeCustomStage(makeData());
    const a = parseStageJson(json);
    const b = parseStageJson(json);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.layout).toEqual(b.value.layout);
  });
});
