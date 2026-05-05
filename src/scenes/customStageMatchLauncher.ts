/**
 * Phaser-free launcher entry point that boots a live match on a saved
 * custom stage.
 *
 * AC 20203 Sub-AC 3 — "Wire up match launcher entry point that accepts
 * a saved stage ID, loads it via the deserializer, boots the
 * CustomStageScene with selected characters/players, and transitions
 * from the stage-select UI into active gameplay".
 *
 * Why a dedicated launcher
 * ------------------------
 *
 * Several call sites need the same "saved stage id → live match"
 * pipeline:
 *
 *   • `StageSelectScene`'s confirm path turns a picked custom-stage row
 *     into a `CharacterSelectScene` start payload, which later forwards
 *     into `MatchScene` once players are picked.
 *
 *   • `CharacterSelectScene`'s confirm path packages the loaded saved
 *     stage + the synthesised lineup into a `MatchScene` start payload.
 *
 *   • The (future) replay loader / dev console will want to skip the
 *     menu chain and boot a match directly given a slot id and a fully
 *     formed `MatchConfig`.
 *
 * Each site re-implementing the same load-and-package step is a recipe
 * for drift — one site forgetting to normalise the `'custom:<slot>'`
 * prefix, another site failing to surface a corrupted save's typed
 * error code, a third site loading from `localStorage` when a caller
 * has already handed in the in-memory blob. This module is the single
 * source of truth for that pipeline.
 *
 * What the launcher owns
 * ----------------------
 *
 * Given a saved stage id (either the bare slot id or the runtime
 * `'custom:<slot-id>'` form), an in-memory `CustomStageData` blob (the
 * "already loaded" shortcut), and a fully formed `MatchConfig` carrying
 * the player roster:
 *
 *   1. Normalises the stage id to its bare slot form.
 *   2. Resolves the source body — preferring the in-memory blob, else
 *      reading the slot via the canonical {@link loadCustomStage}
 *      deserializer.
 *   3. Converts the body to a runtime {@link StageLayout} via
 *      {@link customStageDataToStageLayout}, with the runtime id
 *      pinned to `'custom:<slot-id>'` so replay headers round-trip
 *      cleanly.
 *   4. Builds the scene-start payload that the active gameplay scene
 *      (`MatchScene`) consumes — {@link MatchSceneData} carrying the
 *      `MatchConfig` (with `stageId` normalised) plus the loaded
 *      `customStage` blob, so the receiving scene doesn't have to
 *      consult `localStorage` again.
 *
 * The launcher does NOT call into Phaser. The thin Phaser-side helper
 * {@link applyCustomStageMatchLaunchToScene} accepts a Phaser-shaped
 * scene host (or any object exposing `scene.start(key, data)`) and
 * routes a successful launch into a real scene transition; failures
 * are returned to the caller for UI surfacing.
 *
 * Determinism
 * -----------
 *
 *   • Pure data transform — no `Math.random()`, no wall-clock reads.
 *   • The launcher's success payload is byte-identical for two callers
 *     who hand it the same inputs.
 *   • Replays never round-trip through the launcher — they embed an
 *     immutable snapshot of the stage at record time. A delete /
 *     edit between recording and playback can never desync a replay.
 *
 * Public surface re-exported from `./CustomStageScene` so callers that
 * already import from the scene module continue to see one barrel for
 * "everything I need to wire a saved stage into a match".
 */

import {
  customStageDataToStageLayout,
  customStageSlotIdFromRuntimeId,
  customStageRuntimeId,
  isCustomStageId,
} from '../stages/customStageLoader';
import { loadCustomStage } from '../builder/customStageStorage';
import type {
  CustomStageData,
  CustomStageStorageErrorCode,
  CustomStageStorageLike,
} from '../builder';
import type { MatchConfig, StageLayout } from '../types';
import type { MatchSceneData } from './MatchScene';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Stable scene-key constant for the active gameplay scene the launcher
 * routes a successful launch into. Centralised here so a future
 * dedicated-`CustomStageScene`-as-gameplay-host swap (or a replay
 * playback scene) only changes this one constant — every call site
 * forwards through the launcher result's `sceneKey` field.
 */
export const CUSTOM_STAGE_MATCH_SCENE_KEY = 'MatchScene' as const;

/**
 * Failure-mode reasons the launcher can surface. The caller branches
 * on these (e.g. "render a 'storage corrupted' toast on `load-failed`,
 * a 'pick at least one player' toast on `no-players`") without
 * regex-matching error message strings.
 *
 *   • `'invalid-stage-id'` — empty / non-string / unknown shape.
 *   • `'load-failed'`      — storage path returned a typed failure
 *                            (see `storageCode` for the underlying
 *                            {@link CustomStageStorageErrorCode}).
 *   • `'no-players'`       — `matchConfig.players` is empty; refusing
 *                            here gives the caller a clean "ENTER is a
 *                            no-op until at least one player joins".
 *   • `'invalid-match-config'` — the supplied config failed shape
 *                                validation (e.g. mode is neither
 *                                `'stocks'` nor `'time'`).
 */
export type CustomStageMatchLaunchFailureReason =
  | 'invalid-stage-id'
  | 'load-failed'
  | 'no-players'
  | 'invalid-match-config';

/**
 * Discriminated failure shape. `storageCode` is populated only when
 * `reason === 'load-failed'` so the UI can render a code-specific copy
 * (e.g. "Save is corrupted — try again?" vs. "Storage is unavailable").
 */
export interface CustomStageMatchLaunchFailure {
  readonly ok: false;
  readonly reason: CustomStageMatchLaunchFailureReason;
  readonly message: string;
  readonly storageCode?: CustomStageStorageErrorCode;
}

/**
 * Success shape — everything the active gameplay scene needs to boot
 * the match without re-reading storage.
 *
 *   • `sceneKey` / `sceneData` — pass these directly to a Phaser
 *     `scene.scene.start(...)` call (or the
 *     {@link applyCustomStageMatchLaunchToScene} helper).
 *   • `matchConfig` — the FINAL `MatchConfig` with `stageId` normalised
 *     to the runtime `'custom:<slot-id>'` form. Replay headers / save
 *     metadata round-trip through this id.
 *   • `customStage` — the loaded {@link CustomStageData} blob. Forwarded
 *     into `MatchSceneData.customStage` so the runtime can rebuild the
 *     stage layout without round-tripping through storage.
 *   • `stageLayout` — the runtime {@link StageLayout} the launcher
 *     produced from the loaded blob. Identical to what `MatchScene`
 *     would produce internally; surfacing it lets a caller (e.g. a
 *     pre-flight UI) inspect the geometry without re-running the
 *     converter.
 *   • `slotId` / `runtimeStageId` — both forms exposed so a caller can
 *     update menu state, replay headers, or the URL hash without
 *     re-deriving the prefix.
 */
export interface CustomStageMatchLaunchSuccess {
  readonly ok: true;
  readonly sceneKey: typeof CUSTOM_STAGE_MATCH_SCENE_KEY;
  readonly sceneData: MatchSceneData;
  readonly matchConfig: MatchConfig;
  readonly customStage: CustomStageData;
  readonly stageLayout: StageLayout;
  readonly slotId: string;
  readonly runtimeStageId: string;
}

export type CustomStageMatchLaunchResult =
  | CustomStageMatchLaunchSuccess
  | CustomStageMatchLaunchFailure;

/**
 * Inputs to {@link buildCustomStageMatchLaunch}.
 *
 *   • `savedStageId` — either the bare slot id (`'lava-tower'`) or the
 *     runtime form (`'custom:lava-tower'`). The launcher accepts both;
 *     the `'custom:'` prefix is stripped before consulting storage.
 *
 *   • `matchConfig` — the fully formed {@link MatchConfig} from the
 *     character-select scene. The launcher *replaces*
 *     `matchConfig.stageId` with the canonical runtime form so replay
 *     headers stay byte-identical regardless of which input shape the
 *     caller used.
 *
 *   • `customStage` — optional in-memory blob already loaded by the
 *     caller (e.g. `StageSelectScene` handed it forward through the
 *     character-select scene-data payload). When present the launcher
 *     uses it verbatim and skips the storage round-trip.
 *
 *   • `storage` — optional injected {@link CustomStageStorageLike}.
 *     Tests pass an in-memory map; production callers leave it
 *     undefined to fall through to `globalThis.localStorage`.
 */
export interface CustomStageMatchLaunchRequest {
  readonly savedStageId: string;
  readonly matchConfig: MatchConfig;
  readonly customStage?: CustomStageData;
  readonly storage?: CustomStageStorageLike | null;
}

// ---------------------------------------------------------------------------
// Pure launcher
// ---------------------------------------------------------------------------

/**
 * Build the scene-start command for a custom-stage match. Phaser-free,
 * deterministic, no module-level mutation. See the file-level JSDoc
 * for the architectural rationale.
 *
 * Resolution order
 * ----------------
 *
 *   1. Validate the supplied stage id — empty / non-string is rejected
 *      with `'invalid-stage-id'`.
 *   2. Validate the match config shape — empty `players[]` is rejected
 *      with `'no-players'` so the caller can surface "press a join key"
 *      hint without consuming a load attempt; an unknown `mode` is
 *      rejected with `'invalid-match-config'`.
 *   3. If `customStage` was handed in, use it verbatim.
 *   4. Otherwise read the slot via {@link loadCustomStage}; storage
 *      failures bubble up as `'load-failed'` with the underlying typed
 *      `storageCode`.
 *   5. Convert the loaded body to a runtime layout, build the scene
 *      payload, and return success.
 */
export function buildCustomStageMatchLaunch(
  request: CustomStageMatchLaunchRequest,
): CustomStageMatchLaunchResult {
  // 1. Stage-id shape gate ---------------------------------------------------
  const slotId = normaliseStageIdToSlot(request.savedStageId);
  if (slotId === null) {
    return {
      ok: false,
      reason: 'invalid-stage-id',
      message: `customStageMatchLauncher: savedStageId must be a non-empty string; got ${describe(request.savedStageId)}.`,
    };
  }

  // 2. Match-config shape gate ----------------------------------------------
  const configCheck = validateMatchConfigShape(request.matchConfig);
  if (configCheck !== null) return configCheck;

  // 3. + 4. Resolve the source body -----------------------------------------
  let body: CustomStageData;
  if (request.customStage) {
    body = request.customStage;
  } else {
    const loaded = loadCustomStage(slotId, request.storage);
    if (!loaded.ok) {
      return {
        ok: false,
        reason: 'load-failed',
        storageCode: loaded.code,
        message: `customStageMatchLauncher: failed to load slot '${slotId}' (${loaded.code}: ${loaded.error}).`,
      };
    }
    body = loaded.value;
  }

  // 5. Build the scene payload ----------------------------------------------
  const runtimeStageId = customStageRuntimeId(slotId);
  const stageLayout = customStageDataToStageLayout(body, {
    runtimeIdOverride: runtimeStageId,
  });
  const matchConfig = pinStageIdOnConfig(request.matchConfig, runtimeStageId);
  const sceneData: MatchSceneData = Object.freeze({
    matchConfig,
    customStage: body,
  });

  return Object.freeze({
    ok: true,
    sceneKey: CUSTOM_STAGE_MATCH_SCENE_KEY,
    sceneData,
    matchConfig,
    customStage: body,
    stageLayout,
    slotId,
    runtimeStageId,
  });
}

// ---------------------------------------------------------------------------
// Phaser-side adapter
// ---------------------------------------------------------------------------

/**
 * Minimal scene host shape the {@link applyCustomStageMatchLaunchToScene}
 * helper needs. Phaser's `Phaser.Scene` already satisfies it via
 * `this.scene.start(key, data)`; the explicit interface lets unit tests
 * pass a stub spy without booting Phaser.
 *
 * The `start` signature mirrors Phaser's `ScenePlugin.start` shape — the
 * key is a string, the data is an `object` (Phaser typings refuse
 * `unknown` here), and the return value is ignored (Phaser returns the
 * `ScenePlugin` for chaining; the launcher doesn't need it).
 */
export interface SceneStartHost {
  readonly scene: {
    start(key: string, data?: object): unknown;
  };
}

/**
 * Forward a launch result into a real scene transition. Returns the
 * input result verbatim so the caller can chain failure handling
 * without re-checking the discriminator.
 *
 * On success: `host.scene.start(result.sceneKey, result.sceneData)` is
 * invoked. On failure: this is a no-op — the caller is responsible for
 * surfacing the error (e.g. the stage-select subtitle).
 *
 * Pure helper — no Phaser dependency, fully unit-testable under Node.
 */
export function applyCustomStageMatchLaunchToScene(
  host: SceneStartHost,
  result: CustomStageMatchLaunchResult,
): CustomStageMatchLaunchResult {
  if (result.ok) {
    host.scene.start(result.sceneKey, result.sceneData);
  }
  return result;
}

/**
 * One-shot convenience wrapper — calls {@link buildCustomStageMatchLaunch}
 * and immediately routes the success path into a scene transition.
 * Identical effect to a manual call-and-apply pair, but reads cleaner
 * at the call site (one line in the confirm handler).
 */
export function launchCustomStageMatchInScene(
  host: SceneStartHost,
  request: CustomStageMatchLaunchRequest,
): CustomStageMatchLaunchResult {
  return applyCustomStageMatchLaunchToScene(
    host,
    buildCustomStageMatchLaunch(request),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Normalise either form of the saved stage id into a bare slot id, or
 * return `null` if the input is unusable. The launcher always reads
 * storage by the bare id (per `customStageStorage`) and emits the
 * `'custom:<id>'` form into runtime layouts.
 */
function normaliseStageIdToSlot(savedStageId: unknown): string | null {
  if (typeof savedStageId !== 'string') return null;
  const trimmed = savedStageId.trim();
  if (trimmed.length === 0) return null;
  const slot = isCustomStageId(trimmed)
    ? customStageSlotIdFromRuntimeId(trimmed)
    : trimmed;
  return slot.length > 0 ? slot : null;
}

/**
 * Shape-check the supplied match config. Returns a typed failure on
 * the first issue, or `null` when the config is launch-ready. The
 * launcher does NOT validate gameplay-specific tuning (stock counts,
 * time limits) — it only enforces the invariants that would otherwise
 * cause `MatchScene` to crash on entry.
 */
function validateMatchConfigShape(
  config: MatchConfig | undefined,
): CustomStageMatchLaunchFailure | null {
  if (!config || typeof config !== 'object') {
    return {
      ok: false,
      reason: 'invalid-match-config',
      message: 'customStageMatchLauncher: matchConfig is required.',
    };
  }
  if (config.mode !== 'stocks' && config.mode !== 'time') {
    return {
      ok: false,
      reason: 'invalid-match-config',
      message: `customStageMatchLauncher: matchConfig.mode must be 'stocks' or 'time'; got ${describe(
        config.mode,
      )}.`,
    };
  }
  if (!Array.isArray(config.players) || config.players.length === 0) {
    return {
      ok: false,
      reason: 'no-players',
      message:
        'customStageMatchLauncher: matchConfig.players is empty — at least one player must join before launching a match.',
    };
  }
  return null;
}

/**
 * Return a frozen copy of `config` with `stageId` replaced by the
 * runtime `'custom:<slot-id>'` form. The mode-specific branching mirrors
 * the existing `CharacterSelectScene.buildConfirmedMatchConfig` shape
 * so the resulting object is strict-mode equivalent.
 */
function pinStageIdOnConfig(
  config: MatchConfig,
  runtimeStageId: string,
): MatchConfig {
  if (config.mode === 'time') {
    return Object.freeze({
      mode: 'time',
      stockCount: config.stockCount,
      timeLimitSeconds: config.timeLimitSeconds,
      stageId: runtimeStageId,
      players: config.players,
      rngSeed: config.rngSeed,
    }) as MatchConfig;
  }
  return Object.freeze({
    mode: 'stocks',
    stockCount: config.stockCount,
    stageId: runtimeStageId,
    players: config.players,
    rngSeed: config.rngSeed,
  }) as MatchConfig;
}

/** Compact inspector for diagnostic message bodies. */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return String(value);
}
