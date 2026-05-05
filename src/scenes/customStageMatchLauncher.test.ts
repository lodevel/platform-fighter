import { describe, expect, it, vi } from 'vitest';
import {
  CUSTOM_STAGE_MATCH_SCENE_KEY,
  applyCustomStageMatchLaunchToScene,
  buildCustomStageMatchLaunch,
  launchCustomStageMatchInScene,
  type CustomStageMatchLaunchRequest,
  type SceneStartHost,
} from './customStageMatchLauncher';
import {
  customStageRuntimeId,
  isCustomStageId,
} from '../stages/customStageLoader';
import {
  DEFAULT_GRID_SPEC,
} from '../builder/builderGrid';
import {
  saveCustomStage,
  type StorageLike,
} from '../builder/customStageStorage';
import type { CustomStageData } from '../builder/customStageSerializer';
import type { MatchConfig, PlayerSlot } from '../types';

/**
 * AC 20203 Sub-AC 3 — `customStageMatchLauncher` is the canonical "saved
 * stage id → live match" pipeline. The launcher is Phaser-free so the
 * unit suite can drive every branch under plain Node.
 *
 * Locks down:
 *
 *   1. Happy path — a saved slot is loaded via the deserializer, the
 *      runtime layout is produced, and the {@link MatchSceneData}
 *      payload carries a frozen `MatchConfig` whose `stageId` is
 *      normalised to the runtime `'custom:<slot>'` form.
 *
 *   2. The launcher accepts both the bare slot id and the runtime
 *      `'custom:<slot>'` form, normalising before consulting storage.
 *
 *   3. An in-memory `customStage` blob short-circuits the storage
 *      round-trip — useful for the menu chain where a load already
 *      happened upstream in `StageSelectScene`.
 *
 *   4. Failure modes surface typed reasons:
 *        • empty / non-string id → `'invalid-stage-id'`
 *        • storage error → `'load-failed'` with `storageCode`
 *        • empty `players[]` → `'no-players'`
 *        • bad `mode` → `'invalid-match-config'`
 *
 *   5. The Phaser-side adapters route a successful launch into a real
 *      scene transition without touching Phaser internals.
 */

// ---------------------------------------------------------------------------
// In-memory storage double
// ---------------------------------------------------------------------------

class InMemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlayer(overrides: Partial<PlayerSlot> = {}): PlayerSlot {
  return {
    index: 1,
    characterId: 'wolf',
    paletteIndex: 0,
    inputType: 'keyboard_p1',
    ...overrides,
  };
}

function makeMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'stocks',
    stockCount: 3,
    stageId: 'placeholder-id',
    players: [makePlayer({ index: 1 }), makePlayer({ index: 2, characterId: 'cat', paletteIndex: 1 })],
    rngSeed: 1234,
    ...overrides,
  } as MatchConfig;
}

function makeFixtureBlob(): CustomStageData {
  return {
    name: 'Lava Tower',
    gridSpec: { cellPx: 40, width: 1920, height: 1080 },
    pieces: [
      { type: 'flat-platform', canvasX: 800, canvasY: 600, width: 320, height: 40, col: 20, row: 15 },
      { type: 'lava-zone', canvasX: 200, canvasY: 600, width: 200, height: 80, col: 5, row: 15 },
      { type: 'spawn-point', canvasX: 400, canvasY: 200, width: 40, height: 40, col: 10, row: 5 },
    ],
  };
}

function seedStorage(): StorageLike {
  const storage = new InMemoryStorage();
  saveCustomStage('Lava Tower', DEFAULT_GRID_SPEC, [
    {
      type: 'flat-platform',
      canvasX: 800,
      canvasY: 600,
      width: 320,
      height: 40,
      col: 20,
      row: 15,
    },
    {
      type: 'lava-zone',
      canvasX: 200,
      canvasY: 600,
      width: 200,
      height: 80,
      col: 5,
      row: 15,
    },
    {
      type: 'spawn-point',
      canvasX: 400,
      canvasY: 200,
      width: 40,
      height: 40,
      col: 10,
      row: 5,
    },
  ], { storage });
  return storage;
}

function makeRequest(
  overrides: Partial<CustomStageMatchLaunchRequest> = {},
): CustomStageMatchLaunchRequest {
  return {
    savedStageId: 'lava-tower',
    matchConfig: makeMatchConfig(),
    storage: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('customStageMatchLauncher — constants', () => {
  it('targets the canonical active gameplay scene key', () => {
    // The launcher today routes into `MatchScene`; pinning the
    // constant means a future "swap to dedicated CustomStageScene
    // gameplay host" change has one source of truth.
    expect(CUSTOM_STAGE_MATCH_SCENE_KEY).toBe('MatchScene');
  });
});

// ---------------------------------------------------------------------------
// Happy path — storage round trip
// ---------------------------------------------------------------------------

describe('customStageMatchLauncher — happy path via storage', () => {
  it('loads a saved slot and produces a MatchScene start payload', () => {
    const storage = seedStorage();
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'lava-tower', storage }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sceneKey).toBe('MatchScene');
    expect(result.slotId).toBe('lava-tower');
    expect(result.runtimeStageId).toBe('custom:lava-tower');

    // The customStage payload is the deserialized blob round-tripped
    // from storage. The runtime layout converter ran end-to-end —
    // platforms + hazards + padded spawn points appear.
    expect(result.customStage.name).toBe('Lava Tower');
    expect(result.stageLayout.platforms.length).toBeGreaterThan(0);
    expect(result.stageLayout.hazards.length).toBeGreaterThan(0);
    expect(result.stageLayout.spawnPoints.length).toBe(4);
    expect(result.stageLayout.id).toBe('custom:lava-tower');

    // The matchConfig exposed on the result has stageId pinned to the
    // runtime form even though the input had a placeholder.
    expect(result.matchConfig.stageId).toBe('custom:lava-tower');
    expect(isCustomStageId(result.matchConfig.stageId)).toBe(true);
  });

  it('exposes a frozen sceneData payload carrying matchConfig + customStage', () => {
    const storage = seedStorage();
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'lava-tower', storage }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.sceneData.matchConfig).toBe(result.matchConfig);
    expect(result.sceneData.customStage).toBe(result.customStage);
    expect(Object.isFrozen(result.sceneData)).toBe(true);
    expect(Object.isFrozen(result.matchConfig)).toBe(true);
  });

  it('preserves all match-config fields besides stageId', () => {
    const storage = seedStorage();
    const matchConfig = makeMatchConfig({
      mode: 'time',
      stockCount: 4,
      timeLimitSeconds: 240,
      rngSeed: 4242,
    });
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'lava-tower', matchConfig, storage }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.matchConfig.mode).toBe('time');
    expect(result.matchConfig.stockCount).toBe(4);
    expect(result.matchConfig.timeLimitSeconds).toBe(240);
    expect(result.matchConfig.rngSeed).toBe(4242);
    expect(result.matchConfig.players).toBe(matchConfig.players);
  });
});

// ---------------------------------------------------------------------------
// Stage-id normalisation
// ---------------------------------------------------------------------------

describe('customStageMatchLauncher — stage id normalisation', () => {
  it('accepts the bare slot id', () => {
    const storage = seedStorage();
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'lava-tower', storage }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slotId).toBe('lava-tower');
    expect(result.runtimeStageId).toBe(customStageRuntimeId('lava-tower'));
  });

  it("strips the 'custom:' prefix off the runtime form before consulting storage", () => {
    const storage = seedStorage();
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'custom:lava-tower', storage }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slotId).toBe('lava-tower');
    expect(result.runtimeStageId).toBe('custom:lava-tower');
  });

  it('trims surrounding whitespace before validating the id', () => {
    const storage = seedStorage();
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: '   lava-tower  ', storage }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slotId).toBe('lava-tower');
  });
});

// ---------------------------------------------------------------------------
// In-memory blob short-circuit
// ---------------------------------------------------------------------------

describe('customStageMatchLauncher — in-memory blob short-circuit', () => {
  it('uses a supplied customStage verbatim and skips the storage round-trip', () => {
    const blob = makeFixtureBlob();
    const result = buildCustomStageMatchLaunch(
      // No storage handed in — would normally fall back to globalThis.localStorage,
      // but the in-memory blob means we never reach the load path.
      makeRequest({
        savedStageId: 'lava-tower',
        customStage: blob,
        storage: null,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customStage).toBe(blob);
    // Runtime stage id still pinned to the slot form so replay headers
    // round-trip correctly.
    expect(result.runtimeStageId).toBe('custom:lava-tower');
  });

  it('prefers the in-memory blob over a different slot persisted in storage', () => {
    // Storage carries a "Lava Tower" save, but the caller hands in a
    // blob authored as "Wind Castle" — the in-memory body wins.
    const storage = seedStorage();
    const altBlob: CustomStageData = {
      ...makeFixtureBlob(),
      name: 'Wind Castle',
    };
    const result = buildCustomStageMatchLaunch(
      makeRequest({
        savedStageId: 'lava-tower',
        customStage: altBlob,
        storage,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.customStage.name).toBe('Wind Castle');
  });
});

// ---------------------------------------------------------------------------
// Failure modes
// ---------------------------------------------------------------------------

describe('customStageMatchLauncher — failure modes', () => {
  it('rejects an empty saved stage id with invalid-stage-id', () => {
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: '' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-stage-id');
  });

  it('rejects a non-string saved stage id with invalid-stage-id', () => {
    const result = buildCustomStageMatchLaunch(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeRequest({ savedStageId: 123 as any }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-stage-id');
  });

  it("rejects a 'custom:' prefix with no slot id with invalid-stage-id", () => {
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'custom:' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-stage-id');
  });

  it('surfaces a storage failure as load-failed with the typed storageCode', () => {
    // Empty storage — slot id is valid, but no save by that name
    // exists. The underlying `loadCustomStage` returns `slot-not-found`,
    // which the launcher surfaces verbatim through `storageCode`.
    const storage = new InMemoryStorage();
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'nonexistent', storage }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('load-failed');
    expect(result.storageCode).toBe('slot-not-found');
    expect(result.message).toContain('nonexistent');
  });

  it('surfaces unavailable storage as load-failed with code unavailable', () => {
    const result = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'lava-tower', storage: null }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('load-failed');
    expect(result.storageCode).toBe('unavailable');
  });

  it('rejects an empty players array with no-players', () => {
    const storage = seedStorage();
    const result = buildCustomStageMatchLaunch(
      makeRequest({
        savedStageId: 'lava-tower',
        matchConfig: makeMatchConfig({ players: [] }),
        storage,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-players');
  });

  it('rejects an unknown match mode with invalid-match-config', () => {
    const storage = seedStorage();
    const result = buildCustomStageMatchLaunch(
      makeRequest({
        savedStageId: 'lava-tower',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        matchConfig: { ...makeMatchConfig(), mode: 'unknown' as any },
        storage,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-match-config');
  });

  it('rejects a missing match config with invalid-match-config', () => {
    const storage = seedStorage();
    const result = buildCustomStageMatchLaunch({
      savedStageId: 'lava-tower',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      matchConfig: undefined as any,
      storage,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid-match-config');
  });
});

// ---------------------------------------------------------------------------
// Phaser-side adapter
// ---------------------------------------------------------------------------

describe('customStageMatchLauncher — Phaser-side adapters', () => {
  it('routes a successful launch into scene.start(key, data)', () => {
    const storage = seedStorage();
    const start = vi.fn();
    const host: SceneStartHost = { scene: { start } };

    const result = launchCustomStageMatchInScene(
      host,
      makeRequest({ savedStageId: 'lava-tower', storage }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(
      CUSTOM_STAGE_MATCH_SCENE_KEY,
      result.sceneData,
    );
  });

  it('does not call scene.start on a failed launch', () => {
    const start = vi.fn();
    const host: SceneStartHost = { scene: { start } };

    const result = launchCustomStageMatchInScene(
      host,
      makeRequest({
        savedStageId: 'lava-tower',
        matchConfig: makeMatchConfig({ players: [] }),
        storage: new InMemoryStorage(),
      }),
    );
    expect(result.ok).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('applyCustomStageMatchLaunchToScene returns the input result verbatim', () => {
    const start = vi.fn();
    const host: SceneStartHost = { scene: { start } };
    const failure = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: '' }),
    );
    expect(failure.ok).toBe(false);
    const passed = applyCustomStageMatchLaunchToScene(host, failure);
    expect(passed).toBe(failure);
    expect(start).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('customStageMatchLauncher — determinism', () => {
  it('two launches with the same inputs produce structurally identical payloads', () => {
    const storage = seedStorage();
    const a = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'lava-tower', storage }),
    );
    const b = buildCustomStageMatchLaunch(
      makeRequest({ savedStageId: 'lava-tower', storage }),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.matchConfig).toStrictEqual(b.matchConfig);
    expect(a.stageLayout).toStrictEqual(b.stageLayout);
    expect(a.runtimeStageId).toBe(b.runtimeStageId);
  });
});
