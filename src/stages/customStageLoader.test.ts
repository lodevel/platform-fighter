import { describe, expect, it } from 'vitest';
import {
  CUSTOM_STAGE_BLAST_ZONE_OUTSET,
  CUSTOM_STAGE_ID_PREFIX,
  CUSTOM_LAVA_CYCLE_FRAMES,
  CUSTOM_MOVING_PLATFORM_CYCLE_FRAMES,
  CUSTOM_MOVING_PLATFORM_SWEEP_PX,
  CUSTOM_WIND_CYCLE_FRAMES,
  buildBlastZoneForCanvas,
  buildFallbackSpawnPoints,
  customStageDataToStageLayout,
  customStageRuntimeId,
  customStageSlotIdFromRuntimeId,
  hazardFromBuilderPiece,
  isCustomStageId,
  platformFromBuilderPiece,
} from './customStageLoader';
import {
  buildCustomStageData,
  type CustomStageData,
  type SerializedStagePiece,
} from '../builder/customStageSerializer';
import { DEFAULT_GRID_SPEC } from '../builder/builderGrid';
import type { PlacedPiece } from '../builder/dragDrop';

/**
 * AC 20104 Sub-AC 4 — saved-stage loader integration with the match
 * flow. The loader's job is to convert a `CustomStageData` body
 * (loaded from `localStorage` via `loadCustomStage`) into a runtime
 * `StageLayout` that the existing `StageRenderer` and `MatchScene`
 * pipeline can consume. The tests below lock down:
 *
 *   1. The runtime-id namespace contract (`custom:` prefix in / out).
 *   2. Per-piece-type conversion (platform, hazard, moving platform,
 *      spawn point, drop-through).
 *   3. The blast-zone envelope follows the canonical built-in outset.
 *   4. Spawn-point fallback when the saved stage has fewer than four
 *      explicit `spawn-point` pieces.
 *   5. The full converter is deterministic and preserves piece order.
 *   6. The runtime-id override path used by `MatchScene`.
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

function makeData(overrides: Partial<CustomStageData> = {}): CustomStageData {
  const base = buildCustomStageData('Lava Tower', DEFAULT_GRID_SPEC, [
    makePiece({ type: 'flat-platform', canvasX: 200, canvasY: 600 }),
    makePiece({
      type: 'spawn-point',
      canvasX: 100,
      canvasY: 100,
      width: 40,
      height: 40,
    }),
  ]);
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Runtime-id namespace
// ---------------------------------------------------------------------------

describe('runtime-id namespace', () => {
  it('builds a runtime id from a slot id with the canonical prefix', () => {
    expect(customStageRuntimeId('lava-tower')).toBe(
      `${CUSTOM_STAGE_ID_PREFIX}lava-tower`,
    );
  });

  it('isCustomStageId returns true for prefix-tagged ids', () => {
    expect(isCustomStageId('custom:lava-tower')).toBe(true);
  });

  it('isCustomStageId returns false for built-in ids', () => {
    expect(isCustomStageId('flat')).toBe(false);
    expect(isCustomStageId('lava')).toBe(false);
  });

  it('isCustomStageId tolerates non-string input', () => {
    expect(isCustomStageId(undefined as unknown as string)).toBe(false);
    expect(isCustomStageId(null as unknown as string)).toBe(false);
    expect(isCustomStageId(123 as unknown as string)).toBe(false);
  });

  it('customStageSlotIdFromRuntimeId strips the prefix', () => {
    expect(customStageSlotIdFromRuntimeId('custom:lava-tower')).toBe(
      'lava-tower',
    );
  });

  it('customStageSlotIdFromRuntimeId returns the input verbatim when unprefixed', () => {
    expect(customStageSlotIdFromRuntimeId('lava-tower')).toBe('lava-tower');
  });
});

// ---------------------------------------------------------------------------
// Per-piece conversion
// ---------------------------------------------------------------------------

describe('platformFromBuilderPiece', () => {
  it('maps flat-platform to a solid platform centred on the piece', () => {
    const piece: SerializedStagePiece = {
      type: 'flat-platform',
      canvasX: 100,
      canvasY: 200,
      width: 160,
      height: 40,
      col: 2,
      row: 5,
    };
    const platform = platformFromBuilderPiece(piece, 0);
    expect(platform).not.toBeNull();
    expect(platform).toMatchObject({
      x: 180, // canvasX + width/2
      y: 220, // canvasY + height/2
      width: 160,
      height: 40,
      passThrough: false,
      behavior: 'solid',
    });
    expect(platform?.id).toBe('custom-flat-0');
  });

  it('maps slope-ramp to a solid platform (v1 fallback)', () => {
    const piece: SerializedStagePiece = {
      type: 'slope-ramp',
      canvasX: 0,
      canvasY: 0,
      width: 160,
      height: 80,
      col: 0,
      row: 0,
    };
    const platform = platformFromBuilderPiece(piece, 1);
    expect(platform?.behavior).toBe('solid');
    expect(platform?.passThrough).toBe(false);
    expect(platform?.id).toBe('custom-slope-1');
  });

  it('maps wall to a tall solid platform', () => {
    const piece: SerializedStagePiece = {
      type: 'wall',
      canvasX: 0,
      canvasY: 0,
      width: 40,
      height: 240,
      col: 0,
      row: 0,
    };
    const platform = platformFromBuilderPiece(piece, 2);
    expect(platform?.behavior).toBe('solid');
    expect(platform?.height).toBe(240);
    expect(platform?.id).toBe('custom-wall-2');
  });

  it('maps drop-through-platform to a pass-through platform', () => {
    const piece: SerializedStagePiece = {
      type: 'drop-through-platform',
      canvasX: 0,
      canvasY: 0,
      width: 160,
      height: 16,
      col: 0,
      row: 0,
    };
    const platform = platformFromBuilderPiece(piece, 3);
    expect(platform?.behavior).toBe('pass-through');
    expect(platform?.passThrough).toBe(true);
  });

  it('maps moving-platform to a kinematic ping-pong platform', () => {
    const piece: SerializedStagePiece = {
      type: 'moving-platform',
      canvasX: 200,
      canvasY: 600,
      width: 160,
      height: 40,
      col: 5,
      row: 15,
    };
    const platform = platformFromBuilderPiece(piece, 0);
    expect(platform?.behavior).toBe('moving');
    expect(platform?.passThrough).toBe(false);
    expect(platform?.motion).toBeDefined();
    expect(platform?.motion?.cycleFrames).toBe(
      CUSTOM_MOVING_PLATFORM_CYCLE_FRAMES,
    );
    expect(platform?.motion?.mode).toBe('ping-pong');
    expect(platform?.motion?.waypoints).toEqual([
      { x: -CUSTOM_MOVING_PLATFORM_SWEEP_PX / 2, y: 0 },
      { x: CUSTOM_MOVING_PLATFORM_SWEEP_PX / 2, y: 0 },
    ]);
  });

  it('returns null for hazard-only piece types', () => {
    const lava: SerializedStagePiece = {
      type: 'lava-zone',
      canvasX: 0,
      canvasY: 0,
      width: 200,
      height: 80,
      col: 0,
      row: 0,
    };
    expect(platformFromBuilderPiece(lava, 0)).toBeNull();
    const wind: SerializedStagePiece = {
      type: 'wind-zone',
      canvasX: 0,
      canvasY: 0,
      width: 200,
      height: 80,
      col: 0,
      row: 0,
    };
    expect(platformFromBuilderPiece(wind, 0)).toBeNull();
    const spawn: SerializedStagePiece = {
      type: 'spawn-point',
      canvasX: 0,
      canvasY: 0,
      width: 40,
      height: 40,
      col: 0,
      row: 0,
    };
    expect(platformFromBuilderPiece(spawn, 0)).toBeNull();
  });
});

describe('hazardFromBuilderPiece', () => {
  it('maps lava-zone to a lava hazard with bottom-aligned y', () => {
    const piece: SerializedStagePiece = {
      type: 'lava-zone',
      canvasX: 100,
      canvasY: 800,
      width: 200,
      height: 80,
      col: 2,
      row: 20,
    };
    const hazard = hazardFromBuilderPiece(piece, 0);
    expect(hazard?.type).toBe('lava');
    expect(hazard?.x).toBe(200); // centre x
    expect(hazard?.y).toBe(880); // canvasY + height (resting bottom edge)
    expect(hazard?.cycleFrames).toBe(CUSTOM_LAVA_CYCLE_FRAMES);
    expect(hazard?.id).toBe('custom-lava-0');
  });

  it('maps wind-zone to a wind hazard centred on the piece', () => {
    const piece: SerializedStagePiece = {
      type: 'wind-zone',
      canvasX: 0,
      canvasY: 100,
      width: 200,
      height: 80,
      col: 0,
      row: 2,
    };
    const hazard = hazardFromBuilderPiece(piece, 5);
    expect(hazard?.type).toBe('wind');
    expect(hazard?.x).toBe(100);
    expect(hazard?.y).toBe(140);
    expect(hazard?.cycleFrames).toBe(CUSTOM_WIND_CYCLE_FRAMES);
    expect(hazard?.id).toBe('custom-wind-5');
  });

  it('returns null for non-hazard piece types', () => {
    const piece: SerializedStagePiece = {
      type: 'flat-platform',
      canvasX: 0,
      canvasY: 0,
      width: 160,
      height: 40,
      col: 0,
      row: 0,
    };
    expect(hazardFromBuilderPiece(piece, 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Blast zone + spawn fallback
// ---------------------------------------------------------------------------

describe('buildBlastZoneForCanvas', () => {
  it('extends past every edge by the canonical outset', () => {
    const zone = buildBlastZoneForCanvas(1920, 1080);
    expect(zone.left).toBe(-CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal);
    expect(zone.right).toBe(1920 + CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal);
    expect(zone.top).toBe(-CUSTOM_STAGE_BLAST_ZONE_OUTSET.top);
    expect(zone.bottom).toBe(1080 + CUSTOM_STAGE_BLAST_ZONE_OUTSET.bottom);
  });

  it('scales with the saved canvas dimensions (2× canvas)', () => {
    const zone = buildBlastZoneForCanvas(3840, 2160);
    expect(zone.right).toBe(3840 + CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal);
    expect(zone.bottom).toBe(2160 + CUSTOM_STAGE_BLAST_ZONE_OUTSET.bottom);
  });
});

describe('buildFallbackSpawnPoints', () => {
  it('always produces four spawn points', () => {
    expect(buildFallbackSpawnPoints(1920, 1080)).toHaveLength(4);
  });

  it('spaces spawns horizontally at 25 / 40 / 60 / 75 percent of width', () => {
    const points = buildFallbackSpawnPoints(1000, 1000);
    expect(points[0]?.x).toBe(250);
    expect(points[1]?.x).toBe(400);
    expect(points[2]?.x).toBe(600);
    expect(points[3]?.x).toBe(750);
  });
});

// ---------------------------------------------------------------------------
// Full converter — happy path
// ---------------------------------------------------------------------------

describe('customStageDataToStageLayout', () => {
  it('produces a runtime id derived from the saved name', () => {
    const data = makeData({ name: 'Lava Tower' });
    const layout = customStageDataToStageLayout(data);
    expect(layout.id).toBe('custom:lava-tower');
  });

  it('honours an explicit runtimeIdOverride', () => {
    const data = makeData({ name: 'Lava Tower' });
    const layout = customStageDataToStageLayout(data, {
      runtimeIdOverride: 'custom:explicit-id',
    });
    expect(layout.id).toBe('custom:explicit-id');
  });

  it('builds the blast zone from the saved canvas dimensions', () => {
    const data = makeData();
    const layout = customStageDataToStageLayout(data);
    expect(layout.blastZone.left).toBe(
      -CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal,
    );
    expect(layout.blastZone.right).toBe(
      data.gridSpec.width + CUSTOM_STAGE_BLAST_ZONE_OUTSET.horizontal,
    );
  });

  it('extracts spawn-point pieces into spawnPoints, padding to four', () => {
    const data = makeData({
      pieces: [
        {
          type: 'spawn-point',
          canvasX: 100,
          canvasY: 200,
          width: 40,
          height: 40,
          col: 2,
          row: 5,
        },
      ],
    });
    const layout = customStageDataToStageLayout(data);
    expect(layout.spawnPoints).toHaveLength(4);
    // The single explicit spawn lands centred on its rectangle.
    expect(layout.spawnPoints[0]).toEqual({ x: 120, y: 220 });
    // The remaining three come from the deterministic fallback.
    expect(layout.spawnPoints[3]).toBeDefined();
  });

  it('preserves piece-array ordering across platform / hazard buckets', () => {
    const data = makeData({
      pieces: [
        // Order: platform, hazard, platform, hazard
        {
          type: 'flat-platform',
          canvasX: 0,
          canvasY: 0,
          width: 100,
          height: 40,
          col: 0,
          row: 0,
        },
        {
          type: 'lava-zone',
          canvasX: 200,
          canvasY: 800,
          width: 200,
          height: 80,
          col: 5,
          row: 20,
        },
        {
          type: 'wall',
          canvasX: 500,
          canvasY: 0,
          width: 40,
          height: 200,
          col: 12,
          row: 0,
        },
        {
          type: 'wind-zone',
          canvasX: 800,
          canvasY: 100,
          width: 200,
          height: 80,
          col: 20,
          row: 2,
        },
      ],
    });
    const layout = customStageDataToStageLayout(data);
    expect(layout.platforms.map((p) => p.id)).toEqual([
      'custom-flat-0',
      'custom-wall-2',
    ]);
    expect(layout.hazards.map((h) => h.id)).toEqual([
      'custom-lava-1',
      'custom-wind-3',
    ]);
  });

  it('produces an empty hazards array when no hazards are placed', () => {
    const data = makeData({
      pieces: [
        {
          type: 'flat-platform',
          canvasX: 0,
          canvasY: 0,
          width: 100,
          height: 40,
          col: 0,
          row: 0,
        },
      ],
    });
    const layout = customStageDataToStageLayout(data);
    expect(layout.hazards).toEqual([]);
    expect(layout.platforms).toHaveLength(1);
  });

  it('fully converts a stage with all eight piece types in a single pass', () => {
    const allPieces: ReadonlyArray<PlacedPiece> = [
      makePiece({ type: 'flat-platform' }),
      makePiece({ type: 'slope-ramp', canvasY: 200 }),
      makePiece({ type: 'wall', canvasX: 200, width: 40, height: 240 }),
      makePiece({ type: 'drop-through-platform', canvasY: 400, height: 16 }),
      makePiece({
        type: 'lava-zone',
        canvasX: 400,
        canvasY: 600,
        width: 200,
        height: 80,
      }),
      makePiece({
        type: 'wind-zone',
        canvasX: 600,
        canvasY: 100,
        width: 200,
        height: 80,
      }),
      makePiece({
        type: 'moving-platform',
        canvasX: 800,
        canvasY: 500,
      }),
      makePiece({
        type: 'spawn-point',
        canvasX: 1000,
        canvasY: 100,
        width: 40,
        height: 40,
      }),
    ];
    const data = buildCustomStageData(
      'All Eight',
      DEFAULT_GRID_SPEC,
      allPieces,
    );
    const layout = customStageDataToStageLayout(data);
    expect(layout.platforms).toHaveLength(5); // flat, slope, wall, drop-through, moving
    expect(layout.hazards).toHaveLength(2); // lava, wind
    // The single placed spawn-point + 3 fallbacks.
    expect(layout.spawnPoints).toHaveLength(4);
    // The moving platform's motion path survives.
    const moving = layout.platforms.find((p) => p.behavior === 'moving');
    expect(moving?.motion?.cycleFrames).toBe(
      CUSTOM_MOVING_PLATFORM_CYCLE_FRAMES,
    );
  });

  it('is deterministic — two runs produce identical output', () => {
    const data = makeData();
    const a = customStageDataToStageLayout(data);
    const b = customStageDataToStageLayout(data);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('uses the slot-id derivation rule canonicalisation', () => {
    // Spaces, mixed case, punctuation collapse to lowercase + dashes.
    const data = makeData({ name: '  My Custom!! Stage  ' });
    const layout = customStageDataToStageLayout(data);
    expect(layout.id).toBe('custom:my-custom-stage');
  });
});
