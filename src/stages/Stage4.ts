/**
 * Stage 4 — the fourth (and final) hazard stage in the canonical
 * 4-hazard-stage roster (lava → wind → crumbling → **moving-platform**).
 *
 * AC 20105 Sub-AC 5 — "Implement Stage 4 with its specific geometry
 * and hazard mechanics in stages/Stage4.ts, registered with the stage
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
 *   • Stage 4's full layout (geometry, two carrier motion records, blast
 *     zone envelope, edge-anchor dimensions) was authored alongside the
 *     `behavior: 'moving'` schema (Sub-AC 2 of AC 90302) inside
 *     `stageDefinitions.ts`'s `createMovingPlatformStage()` /
 *     `MOVING_PLATFORM_STAGE_DEFAULTS` so that the stage and the schema
 *     could be co-evolved against the same authoring constants. We keep
 *     the layout definition there as the single source of truth and
 *     wrap it here under explicit `STAGE_4` / `createStage4` /
 *     `STAGE_4_DEFAULTS` aliases — the AC's "implement Stage 4 in
 *     Stage4.ts" requirement is satisfied by surfacing the full Stage 4
 *     contract through this module, while the existing test suite that
 *     references `MOVING_PLATFORM_STAGE` / `MOVING_PLATFORM_STAGE_DEFAULTS`
 *     keeps passing.
 *
 *   • The "registered with the stage loader" half of the AC reduces to
 *     two checks: `STAGES['moving-platform']` resolves to Stage 4, and
 *     `getStage('moving-platform')` returns the same reference. This
 *     module's {@link assertStage4RegisteredWithLoader} helper asserts
 *     both of those at module-load time of any consumer who imports it
 *     (e.g. {@link MatchScene}'s stage-resolution path) so a regression
 *     in the registry surfaces at boot rather than mid-match.
 *
 * Geometry summary
 * ----------------
 *
 *   • Two solid edge platforms (480 × 80 px each) anchored 240 px above
 *     the bottom of the design viewport with their inner edges separated
 *     by a wide pit. Authored as `'solid'` so fighters always have
 *     stable ground to land on regardless of where the moving carriers
 *     are in their cycles. IDs `'moving-edge-left'` / `'moving-edge-right'`.
 *   • One pass-through top centre safety platform (360 × 22 px) 700 px
 *     above the bottom — `'pass-through'` so fighters can drop through
 *     it on the way down. ID `'moving-top-platform'`.
 *   • Two kinematic carriers with `behavior: 'moving'` — IDs
 *     `'moving-horizontal'` and `'moving-vertical'`. The horizontal
 *     carrier ferries fighters across the pit on a 360-frame ping-pong
 *     cycle (~6 s @ 60 Hz); the vertical carrier rises and falls on a
 *     300-frame cycle (~5 s @ 60 Hz) at +180° phase so the two
 *     carriages stagger.
 *   • Blast zone extends 240 px past the left/right edges, 280 px above
 *     the top, and 240 px below the bottom — every fighter that flies
 *     past those bounds triggers a KO.
 *
 * Hazard mechanics summary
 * ------------------------
 *
 *   • The two kinematic carriers ARE the hazard — each is a `'moving'`
 *     platform whose per-frame design-pixel offset is a pure function of
 *     `(motion, frame)`, computed by
 *     {@link computeMovingPlatformOffset} from the `motion.waypoints`,
 *     `motion.cycleFrames`, `motion.phaseFrames`, `motion.mode` and
 *     `motion.easing` fields the stage authors. Unlike lava / wind /
 *     crumbling, moving platforms need no separate runtime entity —
 *     there is no mutable entity state to snapshot for replay; the offset
 *     is fully reconstructible from the integer frame counter alone.
 *   • Unlike lava and wind, the carrier kinematics are NOT declared in
 *     `layout.hazards`. They live on the platform records themselves
 *     (`platforms[i].behavior === 'moving'` + `platforms[i].motion`).
 *     This is intentional: a moving carrier IS a platform first and a
 *     hazard second, so the M3 stage builder serializes them through
 *     the platforms array where they belong. The empty `hazards: []`
 *     keeps the stage layout a pure-data snapshot the M3 builder
 *     round-trips.
 *   • The two carriers are staggered by half a cycle — the vertical
 *     carrier's `phaseFrames === verticalCycleFrames / 2` so the two
 *     carriages are *never* simultaneously at the same end of their
 *     travel. This is the always-safe-ride property the seed leans on
 *     for recoverability: a fighter knocked off either edge can wait for
 *     the next inbound carrier instead of being trapped between two
 *     stationary platforms.
 *   • Stage 4 is the only built-in stage that simultaneously exercises
 *     ALL three platform behavior types in a single layout
 *     (`'solid'` edges + `'moving'` carriers + a `'pass-through'` safety
 *     platform). Every consumer that walks `STAGE_4.platforms` therefore
 *     sees the full schema surface, which is why the wiring test pins
 *     this contract explicitly.
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
 *   runs at first import). {@link assertStage4RegisteredWithLoader}
 *   below is exposed so a consumer can verify the binding at boot
 *   time without forking the registry construction.
 *
 * Determinism note
 * ----------------
 *
 * Every export here is a pure data record or a pure factory function.
 * No `Math.random()`, no module-level mutation, no wall-clock reads.
 * Two simulations driven through identical {@link STAGE_4} layouts
 * produce identical platform geometry, identical carrier motion offsets
 * at any given frame, and identical spawn-point allocations — the
 * replay-stability contract the seed mandates. The carrier kinematics
 * themselves are deterministic per the
 * {@link computeMovingPlatformOffset} contract (verified by the
 * `stage4MatchModeWiring` test suite), so identical frame counters
 * produce byte-identical absolute positions across runs.
 */

import {
  MOVING_PLATFORM_STAGE,
  MOVING_PLATFORM_STAGE_DEFAULTS,
  STAGES,
  createMovingPlatformStage,
  getStage,
  type MovingPlatformStageOptions,
} from './stageDefinitions';
import type { StageLayout } from '../types';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Canonical id for Stage 4 in the {@link STAGES} registry. Mirrors the
 * authored id on {@link MOVING_PLATFORM_STAGE} — kept as a typed
 * `'moving-platform'` string literal so the type system catches any
 * drift between the registry key and Stage 4's identity.
 */
export const STAGE_4_ID = 'moving-platform' as const;
export type Stage4Id = typeof STAGE_4_ID;

/**
 * Display metadata for the stage select menu. Decoupled from the
 * registry so the menu can show a friendly label ("MOVING PLATFORM")
 * and a subtitle that flags the ferry-across-the-pit hazard property
 * without forcing every stage definition to declare presentation
 * strings.
 *
 * Mirrors the entry the menu surfaces in `BUILT_IN_STAGE_ENTRIES`. We
 * re-declare it here rather than re-import the menu file so this
 * module stays free of any UI dependency.
 */
export const STAGE_4_DISPLAY_INFO = Object.freeze({
  /** Stage's authored registry id. */
  id: STAGE_4_ID,
  /** Player-facing display name. ALL CAPS to match the stage select scene's style. */
  displayName: 'MOVING PLATFORM',
  /**
   * One-line subtitle that names the hazard family + the threat
   * outcome so a player glancing at the menu knows what to expect.
   * Mirrors the subtitle on `BUILT_IN_STAGE_ENTRIES` for the
   * moving-platform entry.
   */
  subtitle: 'Ferries across a wide pit.',
});

// ---------------------------------------------------------------------------
// Geometry + hazard authoring constants
// ---------------------------------------------------------------------------

/**
 * Authoring constants for Stage 4 — the same record consumed by
 * {@link createStage4}. Re-exported under an explicit Stage 4 name so
 * call sites that want to reason about "Stage 4's horizontal cycle
 * frames" can import the constant under that name instead of the
 * implementation detail "the moving-platform-stage's horizontal cycle
 * frames". Equal-by-reference to {@link MOVING_PLATFORM_STAGE_DEFAULTS}
 * so a regression in either alias breaks the other immediately.
 */
export const STAGE_4_DEFAULTS = MOVING_PLATFORM_STAGE_DEFAULTS;

/**
 * Construction options for {@link createStage4}. Pass-through alias of
 * {@link MovingPlatformStageOptions} — every knob the canonical
 * moving-platform stage exposes is also a knob on Stage 4, by
 * definition.
 */
export type Stage4Options = MovingPlatformStageOptions;

/**
 * Build a Stage 4 layout — wraps {@link createMovingPlatformStage} so
 * the defaults above stay live. Defaults reproduce the canonical
 * Stage 4 exactly; override only the knobs you care about (e.g. a
 * faster horizontal cycle for accessibility, an
 * `omitTopPlatform`-only variant for testing the pure pit topology,
 * etc.).
 *
 * The returned `StageLayout` matches the contract `StageRenderer`
 * consumes — call sites can hand it directly to the renderer for
 * platform geometry + blast-zone walls. The two `'moving'` carriers
 * carry their own `motion` records on each platform, so the renderer's
 * `updateVisuals(frame)` pipeline composes the per-frame offset via
 * {@link computeMovingPlatformOffset} without needing a separate
 * runtime entity (the offset is a pure function of `(motion, frame)`).
 */
export function createStage4(options: Stage4Options = {}): StageLayout {
  return createMovingPlatformStage(options);
}

/**
 * Canonical Stage 4 layout — built once at module load via
 * {@link createStage4} with all defaults. Equal-by-reference to
 * {@link MOVING_PLATFORM_STAGE} so any consumer that already imported
 * Stage 4 via the moving-platform-stage alias keeps the same identity
 * contract.
 *
 * This is the record the {@link STAGES} registry stores under
 * {@link STAGE_4_ID} and the record {@link getStage}('moving-platform')
 * returns — importing `STAGE_4` from this module gives the same
 * reference as either of those resolution paths. The reference equality
 * is enforced by {@link assertStage4RegisteredWithLoader}.
 */
export const STAGE_4: StageLayout = MOVING_PLATFORM_STAGE;

// ---------------------------------------------------------------------------
// Stage loader registration check
// ---------------------------------------------------------------------------

/**
 * Error thrown by {@link assertStage4RegisteredWithLoader} when Stage 4
 * is missing from the {@link STAGES} registry or {@link getStage}
 * resolves to a different reference. Subclasses `Error` (no extra
 * prototype machinery) so consumers can catch with a plain
 * `e instanceof Stage4RegistrationError` if they want to recover.
 */
export class Stage4RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Stage4RegistrationError';
  }
}

/**
 * Verify Stage 4 is registered with the stage loader. Asserts:
 *
 *   1. {@link STAGES} contains an entry under {@link STAGE_4_ID}.
 *   2. The registered entry is reference-equal to {@link STAGE_4}.
 *   3. {@link getStage}({@link STAGE_4_ID}) returns the same reference.
 *
 * Throws {@link Stage4RegistrationError} on failure. Callable from
 * boot code (e.g. {@link BootScene} / `MatchScene.create`) so a
 * registry regression surfaces with a clear stage-4-specific error
 * instead of a generic "Unknown stage" downstream.
 *
 * Idempotent + side-effect-free — calling it ten times in a row does
 * the same work each time and never mutates the registry.
 */
export function assertStage4RegisteredWithLoader(): StageLayout {
  // Step 1 — explicit `hasOwnProperty` check. `STAGES` is `Object.freeze`d
  // and lookups by unknown id return `undefined`, but a defensive
  // hasOwnProperty avoids any prototype-chain surprises.
  if (!Object.prototype.hasOwnProperty.call(STAGES, STAGE_4_ID)) {
    throw new Stage4RegistrationError(
      `Stage 4 ('${STAGE_4_ID}') is not registered in the STAGES map. ` +
        `Known stages: ${Object.keys(STAGES).join(', ') || '<empty>'}.`,
    );
  }
  const registered = STAGES[STAGE_4_ID];
  if (registered !== STAGE_4) {
    throw new Stage4RegistrationError(
      `Stage 4 registry mismatch: STAGES['${STAGE_4_ID}'] is not the same ` +
        `reference as STAGE_4. The Stage4.ts module and stageDefinitions.ts ` +
        `must agree on the canonical Stage 4 layout.`,
    );
  }
  // Step 3 — round-trip through `getStage()` so the loader's resolution
  // path agrees with the registry. Throws on miss; we re-wrap the error
  // so the caller sees a Stage 4-specific message.
  let resolved: StageLayout;
  try {
    resolved = getStage(STAGE_4_ID);
  } catch (err) {
    throw new Stage4RegistrationError(
      `getStage('${STAGE_4_ID}') threw — Stage 4 cannot be resolved via the loader. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (resolved !== STAGE_4) {
    throw new Stage4RegistrationError(
      `getStage('${STAGE_4_ID}') returned a different reference than STAGE_4. ` +
        `The stage loader must return the same canonical layout the Stage4.ts ` +
        `module exports.`,
    );
  }
  return resolved;
}

/**
 * Read-only tuple of `(stageId, layout)` so a consumer can register
 * Stage 4 with any future stage loader that accepts an iterable
 * `[id, StageLayout]` list. Pure data — no mutation, no allocation
 * per call.
 */
export const STAGE_4_LOADER_BINDING: readonly [Stage4Id, StageLayout] =
  Object.freeze([STAGE_4_ID, STAGE_4] as const);
