/**
 * Phaser-free descriptor resolver for {@link CustomStageScene}.
 *
 * AC 20202 Sub-AC 2 — pure helper extracted out of `CustomStageScene.ts`
 * so the unit suite can drive every input branch under plain Node
 * without booting Phaser. The scene file re-exports the helper and the
 * shared types so consumers continue to `import {…} from
 * './CustomStageScene'` for the canonical surface.
 *
 * Why this lives next to the scene
 * --------------------------------
 *
 * The scene's `init()` accepts a {@link CustomStageSceneInit} payload
 * and resolves it to a runtime {@link StageLayout}. That resolution is
 * 100% deterministic on its inputs and has no Phaser dependency — but
 * the scene file itself transitively imports `phaser`, which means a
 * vitest suite that pulls in `./CustomStageScene` directly fails at
 * module-eval with `navigator is not defined` (Phaser reads browser
 * globals at module init time).
 *
 * Extracting the resolver keeps the contract testable while letting
 * the scene file stay a single source of truth for the `init()` API
 * (it imports the types from this module and re-exports them so
 * downstream callers see a unified surface).
 */

import {
  customStageDataToStageLayout,
  customStageSlotIdFromRuntimeId,
  isCustomStageId,
} from '../stages/customStageLoader';
import { loadCustomStage } from '../builder/customStageStorage';
import type { CustomStageData } from '../builder/customStageSerializer';
import type { StageLayout } from '../types';

// ---------------------------------------------------------------------------
// Public types — shared between the scene file and this resolver.
// ---------------------------------------------------------------------------

/**
 * Init payload accepted by {@link CustomStageScene}.
 *
 * Three input shapes are supported, in priority order:
 *
 *   1. `customStage` — already-loaded {@link CustomStageData}. Highest
 *      priority because the caller has already validated the body
 *      (e.g. the builder hands the live in-memory roster directly to
 *      the preview without a localStorage round-trip).
 *
 *   2. `stageLayout` — already-converted {@link StageLayout}. Lets the
 *      future replay loader feed a runtime layout straight in without
 *      walking the converter again.
 *
 *   3. `slotId` / `runtimeStageId` — read the named slot from
 *      `localStorage` via {@link loadCustomStage}. Useful for the
 *      stage-select "Custom" tab where the dialog only knows the slot
 *      id at navigation time.
 *
 * `returnSceneKey` overrides the scene the ESC key navigates back to;
 * the scene defaults it to {@link CUSTOM_STAGE_SCENE_DEFAULT_RETURN_KEY}.
 */
export interface CustomStageSceneInit {
  readonly customStage?: CustomStageData;
  readonly stageLayout?: StageLayout;
  readonly slotId?: string;
  readonly runtimeStageId?: string;
  readonly returnSceneKey?: string;
  readonly drawBlastZone?: boolean;
}

/**
 * Failure reasons surfaced through {@link CustomStageScene.getLastError}.
 *
 *   • `'no-descriptor'`  — `init()` was called with no usable input.
 *   • `'load-failed'`    — the storage load returned a `code` other
 *                          than `ok`. Composite message includes the
 *                          underlying code.
 *   • `'unknown-input'`  — every input shape was malformed.
 */
export type CustomStageSceneErrorReason =
  | 'no-descriptor'
  | 'load-failed'
  | 'unknown-input';

export interface CustomStageSceneError {
  readonly reason: CustomStageSceneErrorReason;
  readonly message: string;
}

/**
 * Result of {@link resolveDescriptor}. Either we got a runtime layout
 * (with the optional source body kept around for the title strip) or
 * the inputs failed validation and we surface a typed failure.
 */
export type ResolveDescriptorResult =
  | {
      readonly ok: true;
      readonly layout: StageLayout;
      readonly descriptor: CustomStageData | null;
    }
  | {
      readonly ok: false;
      readonly error: CustomStageSceneError;
    };

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Pure resolver: given the {@link CustomStageSceneInit} payload, return
 * the runtime {@link StageLayout} and (when available) the source
 * {@link CustomStageData} body. Phaser-free so the wiring contract test
 * can exercise every branch under plain Node.
 *
 * Resolution order (each fall-through implies the higher-priority
 * input was absent):
 *
 *   1. `customStage` — convert via
 *      {@link customStageDataToStageLayout}.
 *   2. `stageLayout` — pass through verbatim.
 *   3. `slotId` / `runtimeStageId` — read from `localStorage` via
 *      {@link loadCustomStage}, then convert.
 */
export function resolveDescriptor(
  data: CustomStageSceneInit,
): ResolveDescriptorResult {
  if (data.customStage) {
    const runtimeIdOverride =
      data.runtimeStageId && isCustomStageId(data.runtimeStageId)
        ? data.runtimeStageId
        : undefined;
    const layout = customStageDataToStageLayout(data.customStage, {
      runtimeIdOverride,
    });
    return { ok: true, layout, descriptor: data.customStage };
  }

  if (data.stageLayout) {
    return { ok: true, layout: data.stageLayout, descriptor: null };
  }

  const slotId = resolveSlotId(data);
  if (slotId !== null) {
    const loaded = loadCustomStage(slotId);
    if (!loaded.ok) {
      return {
        ok: false,
        error: {
          reason: 'load-failed',
          message: `CustomStageScene: failed to load slot '${slotId}' (${loaded.code}: ${loaded.error}).`,
        },
      };
    }
    const runtimeIdOverride =
      data.runtimeStageId && isCustomStageId(data.runtimeStageId)
        ? data.runtimeStageId
        : undefined;
    const layout = customStageDataToStageLayout(loaded.value, {
      runtimeIdOverride,
    });
    return { ok: true, layout, descriptor: loaded.value };
  }

  return {
    ok: false,
    error: {
      reason: 'no-descriptor',
      message:
        'CustomStageScene: init payload supplied no customStage / stageLayout / slotId / runtimeStageId.',
    },
  };
}

/**
 * Resolve the slot id from either the explicit `slotId` field or by
 * stripping the `'custom:'` prefix off `runtimeStageId`. Returns
 * `null` when neither input is usable.
 */
function resolveSlotId(data: CustomStageSceneInit): string | null {
  if (typeof data.slotId === 'string' && data.slotId.length > 0) {
    return data.slotId;
  }
  if (
    typeof data.runtimeStageId === 'string' &&
    data.runtimeStageId.length > 0
  ) {
    const id = customStageSlotIdFromRuntimeId(data.runtimeStageId);
    if (id.length > 0) return id;
  }
  return null;
}
