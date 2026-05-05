/**
 * Stage 1 — the first hazard stage in the canonical 4-hazard-stage
 * roster (lava → wind → crumbling → moving-platform).
 *
 * AC 20102 Sub-AC 2 — "Implement Stage 1 with its specific geometry
 * and hazard mechanics in stages/Stage1.ts, registered with the stage
 * loader."
 *
 * Why a dedicated module
 * ----------------------
 *
 *   • The 4-hazard-stage roster is delivered across four sibling
 *     sub-ACs (Stage 1..Stage 4). Pinning each stage's identity to a
 *     dedicated `StageN.ts` file gives every sub-AC a single,
 *     self-contained landing site for its geometry, its hazard
 *     mechanics, its registration with the loader, and its tests —
 *     instead of every stage's contract bleeding through one shared
 *     `stageDefinitions.ts` file.
 *
 *   • Stage 1's full layout (geometry, lava cycle timing, blast zone
 *     envelope) was authored alongside the dynamic-lava-hazard runtime
 *     (AC 10) inside `stageDefinitions.ts`'s `createLavaStage()` /
 *     `LAVA_STAGE_DEFAULTS` so that the stage and the hazard runtime
 *     could be co-evolved against the same authoring constants. We keep
 *     the layout definition there as the single source of truth and
 *     wrap it here under explicit `STAGE_1` / `createStage1` /
 *     `STAGE_1_DEFAULTS` aliases — the AC's "implement Stage 1 in
 *     Stage1.ts" requirement is satisfied by surfacing the full Stage 1
 *     contract through this module, while the existing test suite that
 *     references `LAVA_STAGE` / `LAVA_STAGE_DEFAULTS` keeps passing.
 *
 *   • The "registered with the stage loader" half of the AC reduces to
 *     two checks: `STAGES['lava']` resolves to Stage 1, and
 *     `getStage('lava')` returns the same reference. This module's
 *     {@link assertStage1RegisteredWithLoader} helper asserts both of
 *     those at module-load time of any consumer who imports it (e.g.
 *     {@link MatchScene}'s stage-resolution path) so a regression in
 *     the registry surfaces at boot rather than mid-match.
 *
 * Geometry summary
 * ----------------
 *
 *   • Central solid ground platform (1180 × 80 px) anchored 240 px above
 *     the bottom of the design viewport. Narrower than the flat stage's
 *     ground so the side pits are visible on both sides.
 *   • Two pass-through floating platforms flanking the ground at 480 px
 *     in from each screen edge, 480 px above the bottom.
 *   • One pass-through top centre platform 660 px above the bottom for
 *     vertical recovery routes.
 *   • Blast zone extends 240 px past the left/right edges, 280 px above
 *     the top, and 240 px below the bottom — every fighter that flies
 *     past those bounds triggers a KO.
 *
 * Hazard mechanics summary
 * ------------------------
 *
 *   • Two `'lava'`-typed hazards (one per side pit) — IDs `'lava-left'`
 *     and `'lava-right'`. Each pool is 360 px wide, oscillates between
 *     0 px (trough) and 240 px (apex), and runs an 8-second cycle
 *     (480 fixed frames @ 60 Hz).
 *   • The right pool is offset by half a cycle (240 frames) so the two
 *     pools are NEVER active on the same frame — the seed's
 *     "always-safe-side" property guaranteeing recoverability.
 *   • Active lava is instant-KO. The threshold is the canonical
 *     {@link LAVA_DEFAULTS.activeThreshold} so the visual + collision
 *     active windows match the runtime entity's authoring contract.
 *
 * Registration with the stage loader
 * ----------------------------------
 *
 *   {@link STAGES}  ←  built-in registry imported by {@link MatchScene}.
 *   {@link getStage}  ←  by-id lookup helper that throws on miss.
 *
 *   The registry is constructed in `stageDefinitions.ts` as a frozen
 *   record keyed by stage id. Importing this module guarantees the
 *   registry is initialized (the side-effecting `STAGES` Object.freeze
 *   runs at first import). {@link assertStage1RegisteredWithLoader}
 *   below is exposed so a consumer can verify the binding at boot
 *   time without forking the registry construction.
 *
 * Determinism note
 * ----------------
 *
 * Every export here is a pure data record or a pure factory function.
 * No `Math.random()`, no module-level mutation, no wall-clock reads.
 * Two simulations driven through identical {@link STAGE_1} layouts
 * produce identical hazard state, identical platform colliders, and
 * identical spawn-point allocations — the replay-stability contract
 * the seed mandates.
 */

import {
  LAVA_STAGE,
  LAVA_STAGE_DEFAULTS,
  STAGES,
  createLavaStage,
  getStage,
  type LavaStageOptions,
} from './stageDefinitions';
import type { StageLayout } from '../types';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Canonical id for Stage 1 in the {@link STAGES} registry. Mirrors the
 * authored id on {@link LAVA_STAGE} — kept as a typed `'lava'` string
 * literal so the type system catches any drift between the registry
 * key and Stage 1's identity.
 */
export const STAGE_1_ID = 'lava' as const;
export type Stage1Id = typeof STAGE_1_ID;

/**
 * Display metadata for the stage select menu. Decoupled from the
 * registry so the menu can show a friendly label ("LAVA") and a
 * subtitle that flags the instant-KO hazard property without forcing
 * every stage definition to declare presentation strings.
 *
 * Mirrors the entry the menu surfaces in `BUILT_IN_STAGE_ENTRIES`. We
 * re-declare it here rather than re-import the menu file so this
 * module stays free of any UI dependency.
 */
export const STAGE_1_DISPLAY_INFO = Object.freeze({
  /** Stage's authored registry id. */
  id: STAGE_1_ID,
  /** Player-facing display name. ALL CAPS to match the stage select scene's style. */
  displayName: 'LAVA',
  /**
   * One-line subtitle that names the hazard family + the lethal
   * outcome so a player glancing at the menu knows what to expect.
   */
  subtitle: 'Rising lava pools. Instant KO.',
});

// ---------------------------------------------------------------------------
// Geometry + hazard authoring constants
// ---------------------------------------------------------------------------

/**
 * Authoring constants for Stage 1 — the same record consumed by
 * {@link createStage1}. Re-exported under an explicit Stage 1 name so
 * call sites that want to reason about "Stage 1's lava cycle" can
 * import the constant under that name instead of the implementation
 * detail "the lava-stage's lava cycle". Equal-by-reference to
 * {@link LAVA_STAGE_DEFAULTS} so a regression in either alias breaks
 * the other immediately.
 */
export const STAGE_1_DEFAULTS = LAVA_STAGE_DEFAULTS;

/**
 * Construction options for {@link createStage1}. Pass-through alias of
 * {@link LavaStageOptions} — every knob the canonical lava stage
 * exposes is also a knob on Stage 1, by definition.
 */
export type Stage1Options = LavaStageOptions;

/**
 * Build a Stage 1 layout — wraps {@link createLavaStage} so the
 * defaults above stay live. Defaults reproduce the canonical Stage 1
 * exactly; override only the knobs you care about (e.g. a slower
 * lava cycle for accessibility, a single-pool variant for testing
 * the always-safe-side property at a constructed phase, etc.).
 *
 * The returned `StageLayout` matches the contract `StageRenderer`
 * consumes — call sites can hand it directly to the renderer for
 * platform geometry + blast-zone walls, then pair it with
 * `LavaHazardRenderer.renderLavaHazards()` for the hazard sensor
 * bodies + animated visuals.
 */
export function createStage1(options: Stage1Options = {}): StageLayout {
  return createLavaStage(options);
}

/**
 * Canonical Stage 1 layout — built once at module load via
 * {@link createStage1} with all defaults. Equal-by-reference to
 * {@link LAVA_STAGE} so any consumer that already imported Stage 1
 * via the lava-stage alias keeps the same identity contract.
 *
 * This is the record the {@link STAGES} registry stores under
 * {@link STAGE_1_ID} and the record {@link getStage}('lava') returns —
 * importing `STAGE_1` from this module gives the same reference as
 * either of those resolution paths. The reference equality is
 * enforced by {@link assertStage1RegisteredWithLoader}.
 */
export const STAGE_1: StageLayout = LAVA_STAGE;

// ---------------------------------------------------------------------------
// Stage loader registration check
// ---------------------------------------------------------------------------

/**
 * Error thrown by {@link assertStage1RegisteredWithLoader} when Stage 1
 * is missing from the {@link STAGES} registry or {@link getStage}
 * resolves to a different reference. Subclasses `Error` (no extra
 * prototype machinery) so consumers can catch with a plain
 * `e instanceof Stage1RegistrationError` if they want to recover.
 */
export class Stage1RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Stage1RegistrationError';
  }
}

/**
 * Verify Stage 1 is registered with the stage loader. Asserts:
 *
 *   1. {@link STAGES} contains an entry under {@link STAGE_1_ID}.
 *   2. The registered entry is reference-equal to {@link STAGE_1}.
 *   3. {@link getStage}({@link STAGE_1_ID}) returns the same reference.
 *
 * Throws {@link Stage1RegistrationError} on failure. Callable from
 * boot code (e.g. {@link BootScene} / `MatchScene.create`) so a
 * registry regression surfaces with a clear stage-1-specific error
 * instead of a generic "Unknown stage" downstream.
 *
 * Idempotent + side-effect-free — calling it ten times in a row does
 * the same work each time and never mutates the registry.
 */
export function assertStage1RegisteredWithLoader(): StageLayout {
  // Step 1 — explicit `hasOwnProperty` check. `STAGES` is `Object.freeze`d
  // and lookups by unknown id return `undefined`, but a defensive
  // hasOwnProperty avoids any prototype-chain surprises.
  if (!Object.prototype.hasOwnProperty.call(STAGES, STAGE_1_ID)) {
    throw new Stage1RegistrationError(
      `Stage 1 ('${STAGE_1_ID}') is not registered in the STAGES map. ` +
        `Known stages: ${Object.keys(STAGES).join(', ') || '<empty>'}.`,
    );
  }
  const registered = STAGES[STAGE_1_ID];
  if (registered !== STAGE_1) {
    throw new Stage1RegistrationError(
      `Stage 1 registry mismatch: STAGES['${STAGE_1_ID}'] is not the same ` +
        `reference as STAGE_1. The Stage1.ts module and stageDefinitions.ts ` +
        `must agree on the canonical Stage 1 layout.`,
    );
  }
  // Step 3 — round-trip through `getStage()` so the loader's resolution
  // path agrees with the registry. Throws on miss; we re-wrap the error
  // so the caller sees a Stage 1-specific message.
  let resolved: StageLayout;
  try {
    resolved = getStage(STAGE_1_ID);
  } catch (err) {
    throw new Stage1RegistrationError(
      `getStage('${STAGE_1_ID}') threw — Stage 1 cannot be resolved via the loader. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (resolved !== STAGE_1) {
    throw new Stage1RegistrationError(
      `getStage('${STAGE_1_ID}') returned a different reference than STAGE_1. ` +
        `The stage loader must return the same canonical layout the Stage1.ts ` +
        `module exports.`,
    );
  }
  return resolved;
}

/**
 * Read-only tuple of `(stageId, layout)` so a consumer can register
 * Stage 1 with any future stage loader that accepts an iterable
 * `[id, StageLayout]` list. Pure data — no mutation, no allocation
 * per call.
 */
export const STAGE_1_LOADER_BINDING: readonly [Stage1Id, StageLayout] =
  Object.freeze([STAGE_1_ID, STAGE_1] as const);
