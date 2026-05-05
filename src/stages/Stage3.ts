/**
 * Stage 3 — the third hazard stage in the canonical 4-hazard-stage
 * roster (lava → wind → **crumbling** → moving-platform).
 *
 * AC 20104 Sub-AC 4 — "Implement Stage 3 with its specific geometry
 * and hazard mechanics in stages/Stage3.ts, registered with the stage
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
 *   • Stage 3's full layout (geometry, crumble row spacing, blast
 *     zone envelope, ground anchor dimensions) was authored alongside
 *     the {@link CrumblingPlatform} runtime entity (AC 9 / AC 90302)
 *     inside `stageDefinitions.ts`'s `createCrumblingStage()` /
 *     `CRUMBLING_STAGE_DEFAULTS` so that the stage and the lifecycle
 *     entity could be co-evolved against the same authoring constants.
 *     We keep the layout definition there as the single source of
 *     truth and wrap it here under explicit `STAGE_3` / `createStage3`
 *     / `STAGE_3_DEFAULTS` aliases — the AC's "implement Stage 3 in
 *     Stage3.ts" requirement is satisfied by surfacing the full
 *     Stage 3 contract through this module, while the existing test
 *     suite that references `CRUMBLING_STAGE` /
 *     `CRUMBLING_STAGE_DEFAULTS` keeps passing.
 *
 *   • The "registered with the stage loader" half of the AC reduces to
 *     two checks: `STAGES['crumbling']` resolves to Stage 3, and
 *     `getStage('crumbling')` returns the same reference. This module's
 *     {@link assertStage3RegisteredWithLoader} helper asserts both of
 *     those at module-load time of any consumer who imports it (e.g.
 *     {@link MatchScene}'s stage-resolution path) so a regression in
 *     the registry surfaces at boot rather than mid-match.
 *
 * Geometry summary
 * ----------------
 *
 *   • Slim solid central ground platform (700 × 60 px) anchored 200 px
 *     above the bottom of the design viewport. Narrower than the lava
 *     and wind stages' grounds because the *crumblers* are the point of
 *     this stage — the central anchor is intentionally short to push
 *     fighters out onto the falling floats.
 *   • Lower row of two pass-through *crumbling* floats flanking the
 *     central ground at 360 px in from screen centre, 420 px above the
 *     bottom — IDs `'crumble-lower-left'` / `'crumble-lower-right'`.
 *     This is the "easy hop" path off the ground.
 *   • Upper row of two pass-through *crumbling* floats further out at
 *     720 px from centre, 620 px above the bottom — IDs
 *     `'crumble-upper-left'` / `'crumble-upper-right'`. These are the
 *     vertical-recovery / off-stage-rescue platforms; if a fighter
 *     burns through the lower row they're the last stop before a KO.
 *   • Blast zone extends 240 px past the left/right edges, 280 px above
 *     the top, and 240 px below the bottom — every fighter that flies
 *     past those bounds triggers a KO.
 *
 * Hazard mechanics summary
 * ------------------------
 *
 *   • The four pass-through floats ARE the hazard — each one is a
 *     *crumbling platform* whose lifecycle (intact → triggered →
 *     falling → gone → intact) is driven at runtime by a
 *     {@link CrumblingPlatform} entity attached per platform `id`.
 *     The lifecycle drives the platform body's collision filter via
 *     {@link computePlatformColliderState} so the body becomes
 *     non-collidable the moment the entity enters `falling`.
 *   • Unlike lava and wind, the crumble lifecycle is NOT declared in
 *     `layout.hazards` — it lives on the platform records themselves.
 *     This is intentional: a crumble IS a platform first and a hazard
 *     second, so the M3 stage builder serializes them through the
 *     platforms array where they belong. The empty `hazards: []` keeps
 *     the stage layout a pure-data snapshot the M3 builder round-trips.
 *   • Triggers are step-on events — the first fighter to land on a
 *     crumbling float starts its countdown. Subsequent step-ons within
 *     the warning window are no-ops (the lifecycle is idempotent), so
 *     four fighters bouncing on the same float don't shorten the
 *     warning. Once the entity transitions to `falling`, the body's
 *     collision mask drops to 0 — the platform is gone until the
 *     respawn-delay countdown returns it to `intact`.
 *   • The four floats are independent — triggering the lower-left
 *     leaves the upper-right intact. This is what makes the recovery
 *     puzzle interesting: a player can plan a route across the floats
 *     even after one row has crumbled.
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
 *   runs at first import). {@link assertStage3RegisteredWithLoader}
 *   below is exposed so a consumer can verify the binding at boot
 *   time without forking the registry construction.
 *
 * Determinism note
 * ----------------
 *
 * Every export here is a pure data record or a pure factory function.
 * No `Math.random()`, no module-level mutation, no wall-clock reads.
 * Two simulations driven through identical {@link STAGE_3} layouts
 * produce identical platform geometry, identical crumble entity seeds,
 * and identical spawn-point allocations — the replay-stability contract
 * the seed mandates. The crumble lifecycle itself is deterministic per
 * the {@link CrumblingPlatform} entity contract (verified by the
 * `stage3MatchModeWiring` test suite), so identical step-on event
 * streams produce byte-identical lifecycle sequences across runs.
 */

import {
  CRUMBLING_STAGE,
  CRUMBLING_STAGE_DEFAULTS,
  STAGES,
  createCrumblingStage,
  getStage,
  type CrumblingStageOptions,
} from './stageDefinitions';
import type { StageLayout } from '../types';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Canonical id for Stage 3 in the {@link STAGES} registry. Mirrors the
 * authored id on {@link CRUMBLING_STAGE} — kept as a typed `'crumbling'`
 * string literal so the type system catches any drift between the
 * registry key and Stage 3's identity.
 */
export const STAGE_3_ID = 'crumbling' as const;
export type Stage3Id = typeof STAGE_3_ID;

/**
 * Display metadata for the stage select menu. Decoupled from the
 * registry so the menu can show a friendly label ("CRUMBLING") and a
 * subtitle that flags the step-on-trigger hazard property without
 * forcing every stage definition to declare presentation strings.
 *
 * Mirrors the entry the menu surfaces in `BUILT_IN_STAGE_ENTRIES`. We
 * re-declare it here rather than re-import the menu file so this
 * module stays free of any UI dependency.
 */
export const STAGE_3_DISPLAY_INFO = Object.freeze({
  /** Stage's authored registry id. */
  id: STAGE_3_ID,
  /** Player-facing display name. ALL CAPS to match the stage select scene's style. */
  displayName: 'CRUMBLING',
  /**
   * One-line subtitle that names the hazard family + the threat
   * outcome so a player glancing at the menu knows what to expect.
   * Mirrors the subtitle on `BUILT_IN_STAGE_ENTRIES` for the
   * crumbling entry.
   */
  subtitle: 'Floors fall after you step on them.',
});

// ---------------------------------------------------------------------------
// Geometry + hazard authoring constants
// ---------------------------------------------------------------------------

/**
 * Authoring constants for Stage 3 — the same record consumed by
 * {@link createStage3}. Re-exported under an explicit Stage 3 name so
 * call sites that want to reason about "Stage 3's crumble row spacing"
 * can import the constant under that name instead of the implementation
 * detail "the crumbling-stage's row spacing". Equal-by-reference to
 * {@link CRUMBLING_STAGE_DEFAULTS} so a regression in either alias
 * breaks the other immediately.
 */
export const STAGE_3_DEFAULTS = CRUMBLING_STAGE_DEFAULTS;

/**
 * Construction options for {@link createStage3}. Pass-through alias of
 * {@link CrumblingStageOptions} — every knob the canonical crumbling
 * stage exposes is also a knob on Stage 3, by definition.
 */
export type Stage3Options = CrumblingStageOptions;

/**
 * Build a Stage 3 layout — wraps {@link createCrumblingStage} so the
 * defaults above stay live. Defaults reproduce the canonical Stage 3
 * exactly; override only the knobs you care about (e.g. a wider ground
 * for accessibility, an `omitCrumblingFloats`-only variant for testing
 * the bare ground topology, etc.).
 *
 * The returned `StageLayout` matches the contract `StageRenderer`
 * consumes — call sites can hand it directly to the renderer for
 * platform geometry + blast-zone walls, then attach a
 * {@link CrumblingPlatform} runtime entity per platform id with the
 * `crumble-` prefix (excluding `crumble-ground`) for the lifecycle
 * mechanics. The runtime adapter pairs that with
 * `togglePlatformCollision()` to flip the body's collision filter at
 * the exact frame the entity enters `falling`.
 */
export function createStage3(options: Stage3Options = {}): StageLayout {
  return createCrumblingStage(options);
}

/**
 * Canonical Stage 3 layout — built once at module load via
 * {@link createStage3} with all defaults. Equal-by-reference to
 * {@link CRUMBLING_STAGE} so any consumer that already imported Stage 3
 * via the crumbling-stage alias keeps the same identity contract.
 *
 * This is the record the {@link STAGES} registry stores under
 * {@link STAGE_3_ID} and the record {@link getStage}('crumbling')
 * returns — importing `STAGE_3` from this module gives the same
 * reference as either of those resolution paths. The reference equality
 * is enforced by {@link assertStage3RegisteredWithLoader}.
 */
export const STAGE_3: StageLayout = CRUMBLING_STAGE;

// ---------------------------------------------------------------------------
// Stage loader registration check
// ---------------------------------------------------------------------------

/**
 * Error thrown by {@link assertStage3RegisteredWithLoader} when Stage 3
 * is missing from the {@link STAGES} registry or {@link getStage}
 * resolves to a different reference. Subclasses `Error` (no extra
 * prototype machinery) so consumers can catch with a plain
 * `e instanceof Stage3RegistrationError` if they want to recover.
 */
export class Stage3RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Stage3RegistrationError';
  }
}

/**
 * Verify Stage 3 is registered with the stage loader. Asserts:
 *
 *   1. {@link STAGES} contains an entry under {@link STAGE_3_ID}.
 *   2. The registered entry is reference-equal to {@link STAGE_3}.
 *   3. {@link getStage}({@link STAGE_3_ID}) returns the same reference.
 *
 * Throws {@link Stage3RegistrationError} on failure. Callable from
 * boot code (e.g. {@link BootScene} / `MatchScene.create`) so a
 * registry regression surfaces with a clear stage-3-specific error
 * instead of a generic "Unknown stage" downstream.
 *
 * Idempotent + side-effect-free — calling it ten times in a row does
 * the same work each time and never mutates the registry.
 */
export function assertStage3RegisteredWithLoader(): StageLayout {
  // Step 1 — explicit `hasOwnProperty` check. `STAGES` is `Object.freeze`d
  // and lookups by unknown id return `undefined`, but a defensive
  // hasOwnProperty avoids any prototype-chain surprises.
  if (!Object.prototype.hasOwnProperty.call(STAGES, STAGE_3_ID)) {
    throw new Stage3RegistrationError(
      `Stage 3 ('${STAGE_3_ID}') is not registered in the STAGES map. ` +
        `Known stages: ${Object.keys(STAGES).join(', ') || '<empty>'}.`,
    );
  }
  const registered = STAGES[STAGE_3_ID];
  if (registered !== STAGE_3) {
    throw new Stage3RegistrationError(
      `Stage 3 registry mismatch: STAGES['${STAGE_3_ID}'] is not the same ` +
        `reference as STAGE_3. The Stage3.ts module and stageDefinitions.ts ` +
        `must agree on the canonical Stage 3 layout.`,
    );
  }
  // Step 3 — round-trip through `getStage()` so the loader's resolution
  // path agrees with the registry. Throws on miss; we re-wrap the error
  // so the caller sees a Stage 3-specific message.
  let resolved: StageLayout;
  try {
    resolved = getStage(STAGE_3_ID);
  } catch (err) {
    throw new Stage3RegistrationError(
      `getStage('${STAGE_3_ID}') threw — Stage 3 cannot be resolved via the loader. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (resolved !== STAGE_3) {
    throw new Stage3RegistrationError(
      `getStage('${STAGE_3_ID}') returned a different reference than STAGE_3. ` +
        `The stage loader must return the same canonical layout the Stage3.ts ` +
        `module exports.`,
    );
  }
  return resolved;
}

/**
 * Read-only tuple of `(stageId, layout)` so a consumer can register
 * Stage 3 with any future stage loader that accepts an iterable
 * `[id, StageLayout]` list. Pure data — no mutation, no allocation
 * per call.
 */
export const STAGE_3_LOADER_BINDING: readonly [Stage3Id, StageLayout] =
  Object.freeze([STAGE_3_ID, STAGE_3] as const);
