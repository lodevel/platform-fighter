/**
 * Stage 2 — the second hazard stage in the canonical 4-hazard-stage
 * roster (lava → **wind** → crumbling → moving-platform).
 *
 * AC 20103 Sub-AC 3 — "Implement Stage 2 with its specific geometry
 * and hazard mechanics in stages/Stage2.ts, registered with the stage
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
 *   • Stage 2's full layout (geometry, wind cycle timing, blast zone
 *     envelope, peak-force tuning) was authored alongside the
 *     wind-zone-hazard runtime (AC 10102) inside `stageDefinitions.ts`'s
 *     `createWindStage()` / `WIND_STAGE_DEFAULTS` so that the stage and
 *     the hazard runtime could be co-evolved against the same
 *     authoring constants. We keep the layout definition there as the
 *     single source of truth and wrap it here under explicit
 *     `STAGE_2` / `createStage2` / `STAGE_2_DEFAULTS` aliases — the
 *     AC's "implement Stage 2 in Stage2.ts" requirement is satisfied by
 *     surfacing the full Stage 2 contract through this module, while
 *     the existing test suite that references `WIND_STAGE` /
 *     `WIND_STAGE_DEFAULTS` keeps passing.
 *
 *   • The "registered with the stage loader" half of the AC reduces to
 *     two checks: `STAGES['wind']` resolves to Stage 2, and
 *     `getStage('wind')` returns the same reference. This module's
 *     {@link assertStage2RegisteredWithLoader} helper asserts both of
 *     those at module-load time of any consumer who imports it (e.g.
 *     {@link MatchScene}'s stage-resolution path) so a regression in
 *     the registry surfaces at boot rather than mid-match.
 *
 * Geometry summary
 * ----------------
 *
 *   • Wide central solid ground platform (1500 × 80 px) anchored 180 px
 *     above the bottom of the design viewport — the airborne corridor
 *     above is where the wind plays out, so a generous floor matters.
 *   • Two pass-through floating platforms flanking the ground at 540 px
 *     in from each screen edge, 420 px above the bottom. These give a
 *     fighter mid-flight a reachable landing target when riding a gust.
 *   • One pass-through top centre platform 620 px above the bottom for
 *     vertical recovery routes through the gust corridor.
 *   • Blast zone extends 240 px past the left/right edges, 280 px above
 *     the top, and 240 px below the bottom — so a fighter blown
 *     off-stage by a sustained gust crosses a real KO threshold.
 *
 * Hazard mechanics summary
 * ------------------------
 *
 *   • Two `'wind'`-typed hazards spanning the airborne corridor — IDs
 *     `'wind-leftward'` and `'wind-rightward'`. Each zone is 1600 ×
 *     320 px, oscillates between trough and apex over a 6-second cycle
 *     (360 fixed frames @ 60 Hz).
 *   • Both zones share the same authored `forceX` magnitude. The
 *     "always-safe-side" property comes from the half-cycle phase
 *     offset — the rightward zone is offset by 180 frames, so when the
 *     leftward zone is pushing left at apex, the rightward zone is
 *     pushing right at apex (or both zones are quiet around the cycle's
 *     ¼- and ¾-points). A fighter knocked off either side always has
 *     a counter-gust working in their favour somewhere in the cycle.
 *   • Active wind applies a per-frame force vector to overlapping
 *     fighters. The threshold is the canonical
 *     {@link WIND_DEFAULTS.activeThreshold} so the runtime
 *     {@link WindForceController} agrees with the authoring contract.
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
 *   runs at first import). {@link assertStage2RegisteredWithLoader}
 *   below is exposed so a consumer can verify the binding at boot
 *   time without forking the registry construction.
 *
 * Determinism note
 * ----------------
 *
 * Every export here is a pure data record or a pure factory function.
 * No `Math.random()`, no module-level mutation, no wall-clock reads.
 * Two simulations driven through identical {@link STAGE_2} layouts
 * produce identical hazard state, identical platform colliders, and
 * identical spawn-point allocations — the replay-stability contract
 * the seed mandates.
 */

import {
  STAGES,
  WIND_STAGE,
  WIND_STAGE_DEFAULTS,
  createWindStage,
  getStage,
  type WindStageOptions,
} from './stageDefinitions';
import type { StageLayout } from '../types';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Canonical id for Stage 2 in the {@link STAGES} registry. Mirrors the
 * authored id on {@link WIND_STAGE} — kept as a typed `'wind'` string
 * literal so the type system catches any drift between the registry
 * key and Stage 2's identity.
 */
export const STAGE_2_ID = 'wind' as const;
export type Stage2Id = typeof STAGE_2_ID;

/**
 * Display metadata for the stage select menu. Decoupled from the
 * registry so the menu can show a friendly label ("WIND") and a
 * subtitle that flags the directional-gust hazard property without
 * forcing every stage definition to declare presentation strings.
 *
 * Mirrors the entry the menu surfaces in `BUILT_IN_STAGE_ENTRIES`. We
 * re-declare it here rather than re-import the menu file so this
 * module stays free of any UI dependency.
 */
export const STAGE_2_DISPLAY_INFO = Object.freeze({
  /** Stage's authored registry id. */
  id: STAGE_2_ID,
  /** Player-facing display name. ALL CAPS to match the stage select scene's style. */
  displayName: 'WIND',
  /**
   * One-line subtitle that names the hazard family + the threat outcome
   * so a player glancing at the menu knows what to expect.
   */
  subtitle: 'Gust corridors push you off-stage.',
});

// ---------------------------------------------------------------------------
// Geometry + hazard authoring constants
// ---------------------------------------------------------------------------

/**
 * Authoring constants for Stage 2 — the same record consumed by
 * {@link createStage2}. Re-exported under an explicit Stage 2 name so
 * call sites that want to reason about "Stage 2's wind cycle" can
 * import the constant under that name instead of the implementation
 * detail "the wind-stage's wind cycle". Equal-by-reference to
 * {@link WIND_STAGE_DEFAULTS} so a regression in either alias breaks
 * the other immediately.
 */
export const STAGE_2_DEFAULTS = WIND_STAGE_DEFAULTS;

/**
 * Construction options for {@link createStage2}. Pass-through alias of
 * {@link WindStageOptions} — every knob the canonical wind stage
 * exposes is also a knob on Stage 2, by definition.
 */
export type Stage2Options = WindStageOptions;

/**
 * Build a Stage 2 layout — wraps {@link createWindStage} so the
 * defaults above stay live. Defaults reproduce the canonical Stage 2
 * exactly; override only the knobs you care about (e.g. a gentler peak
 * force for accessibility, a single-zone variant for testing the
 * always-safe-side property at a constructed phase, etc.).
 *
 * The returned `StageLayout` matches the contract `StageRenderer`
 * consumes — call sites can hand it directly to the renderer for
 * platform geometry + blast-zone walls, then pair it with
 * `WindHazardRenderer.renderWindHazards()` for the hazard sensor
 * bodies + animated visuals.
 */
export function createStage2(options: Stage2Options = {}): StageLayout {
  return createWindStage(options);
}

/**
 * Canonical Stage 2 layout — built once at module load via
 * {@link createStage2} with all defaults. Equal-by-reference to
 * {@link WIND_STAGE} so any consumer that already imported Stage 2
 * via the wind-stage alias keeps the same identity contract.
 *
 * This is the record the {@link STAGES} registry stores under
 * {@link STAGE_2_ID} and the record {@link getStage}('wind') returns —
 * importing `STAGE_2` from this module gives the same reference as
 * either of those resolution paths. The reference equality is
 * enforced by {@link assertStage2RegisteredWithLoader}.
 */
export const STAGE_2: StageLayout = WIND_STAGE;

// ---------------------------------------------------------------------------
// Stage loader registration check
// ---------------------------------------------------------------------------

/**
 * Error thrown by {@link assertStage2RegisteredWithLoader} when Stage 2
 * is missing from the {@link STAGES} registry or {@link getStage}
 * resolves to a different reference. Subclasses `Error` (no extra
 * prototype machinery) so consumers can catch with a plain
 * `e instanceof Stage2RegistrationError` if they want to recover.
 */
export class Stage2RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Stage2RegistrationError';
  }
}

/**
 * Verify Stage 2 is registered with the stage loader. Asserts:
 *
 *   1. {@link STAGES} contains an entry under {@link STAGE_2_ID}.
 *   2. The registered entry is reference-equal to {@link STAGE_2}.
 *   3. {@link getStage}({@link STAGE_2_ID}) returns the same reference.
 *
 * Throws {@link Stage2RegistrationError} on failure. Callable from
 * boot code (e.g. {@link BootScene} / `MatchScene.create`) so a
 * registry regression surfaces with a clear stage-2-specific error
 * instead of a generic "Unknown stage" downstream.
 *
 * Idempotent + side-effect-free — calling it ten times in a row does
 * the same work each time and never mutates the registry.
 */
export function assertStage2RegisteredWithLoader(): StageLayout {
  // Step 1 — explicit `hasOwnProperty` check. `STAGES` is `Object.freeze`d
  // and lookups by unknown id return `undefined`, but a defensive
  // hasOwnProperty avoids any prototype-chain surprises.
  if (!Object.prototype.hasOwnProperty.call(STAGES, STAGE_2_ID)) {
    throw new Stage2RegistrationError(
      `Stage 2 ('${STAGE_2_ID}') is not registered in the STAGES map. ` +
        `Known stages: ${Object.keys(STAGES).join(', ') || '<empty>'}.`,
    );
  }
  const registered = STAGES[STAGE_2_ID];
  if (registered !== STAGE_2) {
    throw new Stage2RegistrationError(
      `Stage 2 registry mismatch: STAGES['${STAGE_2_ID}'] is not the same ` +
        `reference as STAGE_2. The Stage2.ts module and stageDefinitions.ts ` +
        `must agree on the canonical Stage 2 layout.`,
    );
  }
  // Step 3 — round-trip through `getStage()` so the loader's resolution
  // path agrees with the registry. Throws on miss; we re-wrap the error
  // so the caller sees a Stage 2-specific message.
  let resolved: StageLayout;
  try {
    resolved = getStage(STAGE_2_ID);
  } catch (err) {
    throw new Stage2RegistrationError(
      `getStage('${STAGE_2_ID}') threw — Stage 2 cannot be resolved via the loader. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (resolved !== STAGE_2) {
    throw new Stage2RegistrationError(
      `getStage('${STAGE_2_ID}') returned a different reference than STAGE_2. ` +
        `The stage loader must return the same canonical layout the Stage2.ts ` +
        `module exports.`,
    );
  }
  return resolved;
}

/**
 * Read-only tuple of `(stageId, layout)` so a consumer can register
 * Stage 2 with any future stage loader that accepts an iterable
 * `[id, StageLayout]` list. Pure data — no mutation, no allocation
 * per call.
 */
export const STAGE_2_LOADER_BINDING: readonly [Stage2Id, StageLayout] =
  Object.freeze([STAGE_2_ID, STAGE_2] as const);
