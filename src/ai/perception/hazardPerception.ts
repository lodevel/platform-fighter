/**
 * Hazard perception — the unified per-tick view of stage hazards every
 * AI difficulty tier consumes (AC 20201 Sub-AC 1 — "perception module
 * with game state sensing: distances, player positions, **hazards**").
 *
 * Why this module exists
 * ----------------------
 *
 * The four M2 hazard entities live under `src/entities/`:
 *
 *   • {@link import('../../entities/LavaHazard').LavaHazard} — periodic
 *     rise/fall column with a configurable activeThreshold and
 *     per-active-tick damage.
 *   • {@link import('../../entities/WindZoneHazard').WindZoneHazard} —
 *     directional force-field whose magnitude oscillates over a fixed
 *     cycle, gated by an activeThreshold.
 *   • {@link import('../../entities/CrumblingPlatform').CrumblingPlatform}
 *     — event-driven drop-and-respawn platform with `intact /
 *     triggered / falling / gone` lifecycle.
 *   • {@link import('../../entities/PeriodicPlatform').PeriodicPlatform}
 *     — purely time-driven phasing platform with `solid /
 *     warnDisappear / gone / warnAppear` lifecycle.
 *
 * Each entity ships its own narrow API (`getBounds()`, `isActive()`,
 * `isSolid()`, `getDamagePerTick()`, `getCurrentForce()`,
 * `getFramesUntilNextTransition()`, …). The AI tiers should not have
 * to know about these classes directly — they need a *single*
 * tier-agnostic record per tick that answers:
 *
 *   1. Where are the hazards on the field right now?
 *   2. Which ones are dangerous *this* frame (lethal lava, gusting
 *      wind, crumbling platform mid-fall)?
 *   3. Which ones are *about* to become dangerous (lava 30 frames from
 *      activating, periodic platform 12 frames from disappearing)?
 *   4. Which ones the bot can still rely on as terrain (solid
 *      crumbling / periodic platforms)?
 *
 * `PerceivedHazard` is that record. It is a discriminated union keyed
 * by `kind` so each subtype can carry its own state-specific fields,
 * while sharing common geometry (`bounds`) and a pair of
 * tier-agnostic flags (`isDangerous`, `isBlocking`) so generic
 * decision logic can avoid branching on `kind` for the most common
 * questions.
 *
 * Determinism contract
 * --------------------
 *
 * Every field is `readonly`. Snapshots are immutable plain data so
 * they:
 *
 *   • Round-trip cleanly through the 300-frame replay state-snapshot
 *     pipeline without bespoke adapters.
 *   • Are safe to retain across ticks for "previous-frame" reasoning
 *     (a bot wanting to detect "lava just activated" can stash last
 *     frame's perception).
 *   • Cannot be mutated by a leaf — every consumer treats them as
 *     true read-only.
 *
 * No Phaser / Matter imports — perception types must be unit-testable
 * with plain object literals (the controller pulls live state from
 * the entity APIs and copies it into these records each tick).
 *
 * What this module deliberately is NOT
 * -------------------------------------
 *
 *   • A scene observer. The match scene builds the per-bot hazard
 *     list from live entity state once per fixed step and hands the
 *     resulting array to each AI provider via {@link WorldSnapshot};
 *     this module never reads Phaser / Matter.
 *
 *   • A hazard *registry*. The bot does not own or tick the hazard
 *     entities — it merely *observes* them. Tick ordering, snapshot
 *     restore, and lifecycle management remain in the match scene
 *     and the entity classes themselves.
 *
 *   • A pathfinding planner. The helpers here surface raw geometric
 *     facts (distance to nearest dangerous hazard, point-in-AABB,
 *     etc.). Higher-level decisions ("which platform should I
 *     retreat to?") live in the per-tier behavior trees.
 */

import type { PerceivedPoint } from './WorldSnapshot';
import {
  computeDistance,
  type DistanceMetrics,
} from './distanceEvaluation';

// ---------------------------------------------------------------------------
// Common geometry — axis-aligned bounding box
// ---------------------------------------------------------------------------

/**
 * Axis-aligned bounding box of a hazard, in design pixels (1920×1080
 * coordinate space — same convention as everything else in
 * perception). `(x, y)` is the *centre* of the AABB, mirroring the
 * shape returned by every entity's `getBounds()` so the controller
 * can copy bounds verbatim with no axis flip.
 *
 * The AABB is the perception-layer abstraction — even the lava hazard
 * (which the renderer draws as a tapered column) is modelled as a
 * rectangle here because the AI's "am I in lethal range?" question
 * cares about overlap, not silhouette. Renderers continue to use
 * silhouette geometry; perception consumes the AABB.
 */
export interface PerceivedHazardBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Per-kind state records — one per entity type
// ---------------------------------------------------------------------------

/**
 * Lava-specific perception. Mirrors the
 * {@link import('../../entities/LavaHazard').LavaHazard} public API:
 *
 *   • `phase`              — coarse classification matching the
 *                            entity's `LavaPhase` (renderer-shared
 *                            vocabulary).
 *   • `heightNorm`         — normalised height in [0, 1]; `0` =
 *                            fully receded, `1` = at apex.
 *   • `isActive`           — true while the lava is currently lethal
 *                            (heightNorm ≥ activeThreshold).
 *   • `damagePerTick`      — damage % applied per overlap tick when
 *                            active. `0` while inert. AI scoring uses
 *                            this to weight "how bad is touching this".
 *   • `framesUntilActive`  — fixed-step frames until `isActive`
 *                            transitions from `false` → `true`. `0`
 *                            when already active. `null` when no
 *                            transition is scheduled in a known
 *                            window (e.g. controller chose not to
 *                            project, or the entity has no cycle —
 *                            kept nullable so future hazards with a
 *                            non-periodic activation pattern slot in
 *                            without a sentinel value collision).
 */
export interface PerceivedLavaState {
  readonly phase: 'low_hold' | 'rising' | 'falling' | 'high_hold';
  readonly heightNorm: number;
  readonly isActive: boolean;
  readonly damagePerTick: number;
  readonly framesUntilActive: number | null;
}

/**
 * Wind-specific perception. Mirrors
 * {@link import('../../entities/WindZoneHazard').WindZoneHazard}:
 *
 *   • `phase`              — `forward` / `reverse` / `quiet` matching
 *                            the entity's `WindPhase`.
 *   • `force`              — current applied force vector (px/frame²).
 *                            Sign carries direction; magnitude scales
 *                            with the cycle cosine.
 *   • `isActive`           — true while the wind would push a fighter
 *                            (|cosine| ≥ activeThreshold).
 *   • `framesUntilActive`  — frames until `isActive` flips to `true`,
 *                            or `null` if not projected.
 */
export interface PerceivedWindState {
  readonly phase: 'forward' | 'reverse' | 'quiet';
  readonly force: { readonly x: number; readonly y: number };
  readonly isActive: boolean;
  readonly framesUntilActive: number | null;
}

/**
 * Crumbling-platform perception. Mirrors
 * {@link import('../../entities/CrumblingPlatform').CrumblingPlatform}:
 *
 *   • `phase`                       — `intact` / `triggered` /
 *                                     `falling` / `gone` matching the
 *                                     entity's `CrumblingPhase`.
 *   • `isSolid`                     — true while the platform supports
 *                                     a fighter (intact OR triggered).
 *   • `framesUntilNextTransition`   — frames until the entity moves to
 *                                     the next phase. `Infinity` for
 *                                     `intact` (no timer is running).
 *                                     This is the AI's "how long can I
 *                                     rely on this?" answer.
 */
export interface PerceivedCrumblingState {
  readonly phase: 'intact' | 'triggered' | 'falling' | 'gone';
  readonly isSolid: boolean;
  readonly framesUntilNextTransition: number;
}

/**
 * Periodic-platform perception. Mirrors
 * {@link import('../../entities/PeriodicPlatform').PeriodicPlatform}:
 *
 *   • `phase`                       — `solid` / `warnDisappear` /
 *                                     `gone` / `warnAppear`.
 *   • `isSolid`                     — true while the platform is
 *                                     collidable (solid OR
 *                                     warnDisappear).
 *   • `framesUntilNextTransition`   — frames until the next phase
 *                                     change. Always finite (every
 *                                     periodic phase is timed).
 *   • `framesUntilSolid`            — frames until the platform
 *                                     becomes fully `solid` again.
 *                                     `0` when already solid. The
 *                                     AI uses this to decide whether
 *                                     to wait above a phasing
 *                                     platform vs commit to a
 *                                     different recovery route.
 */
export interface PerceivedPeriodicState {
  readonly phase: 'solid' | 'warnDisappear' | 'gone' | 'warnAppear';
  readonly isSolid: boolean;
  readonly framesUntilNextTransition: number;
  readonly framesUntilSolid: number;
}

// ---------------------------------------------------------------------------
// Unified PerceivedHazard — discriminated union
// ---------------------------------------------------------------------------

/**
 * Common fields every hazard surfaces — present regardless of kind so
 * generic helpers (distance, filter-dangerous, point-in-bounds) don't
 * have to switch on `kind`.
 *
 *   • `id`           — stable identifier matching the entity's `getId()`.
 *                      Used by replay diffing and, optionally, by
 *                      sticky-target policies that prefer to keep
 *                      avoiding the same hazard frame-to-frame.
 *   • `bounds`       — current AABB in design pixels. For static-bounds
 *                      hazards (wind, crumbling, periodic) this is the
 *                      configured rectangle; for the lava hazard the
 *                      controller copies the *current* footprint each
 *                      tick (the lava body shrinks as it recedes).
 *   • `isDangerous`  — true iff touching the hazard right now would
 *                      hurt the bot (lethal lava, active wind, falling
 *                      crumbling platform mid-drop). The wind hazard
 *                      counts as dangerous when it's actively pushing
 *                      because that's when it can launch a fighter
 *                      into a blast zone — the AI weighs "wind that
 *                      pushes me toward danger" upstream in threat
 *                      scoring.
 *   • `isBlocking`   — true iff the hazard currently occupies space the
 *                      bot can stand on or be obstructed by — i.e.
 *                      "treat this as terrain". Solid crumbling /
 *                      periodic platforms set this; lava and wind do
 *                      not (you pass through them). Lets generic
 *                      pathing logic distinguish "obstacle" from
 *                      "damaging field" without unwrapping the union.
 */
interface PerceivedHazardCommon {
  readonly id: string;
  readonly bounds: PerceivedHazardBounds;
  readonly isDangerous: boolean;
  readonly isBlocking: boolean;
}

/** Lava hazard variant of {@link PerceivedHazard}. */
export interface PerceivedLavaHazard extends PerceivedHazardCommon {
  readonly kind: 'lava';
  readonly state: PerceivedLavaState;
}

/** Wind-zone hazard variant of {@link PerceivedHazard}. */
export interface PerceivedWindHazard extends PerceivedHazardCommon {
  readonly kind: 'wind';
  readonly state: PerceivedWindState;
}

/** Crumbling-platform hazard variant of {@link PerceivedHazard}. */
export interface PerceivedCrumblingHazard extends PerceivedHazardCommon {
  readonly kind: 'crumbling';
  readonly state: PerceivedCrumblingState;
}

/** Periodic-platform hazard variant of {@link PerceivedHazard}. */
export interface PerceivedPeriodicHazard extends PerceivedHazardCommon {
  readonly kind: 'periodic';
  readonly state: PerceivedPeriodicState;
}

/**
 * Discriminated union surfacing every hazard kind the M2 stages ship.
 * Adding a new kind in a future milestone (moving platform, ice patch,
 * conveyor belt, …) is a *non-breaking* change as long as the new
 * variant extends {@link PerceivedHazardCommon}. Existing consumers
 * keep working — the worst that can happen is they fall through to
 * `default` in a `switch (h.kind)` and treat the hazard as inert.
 */
export type PerceivedHazard =
  | PerceivedLavaHazard
  | PerceivedWindHazard
  | PerceivedCrumblingHazard
  | PerceivedPeriodicHazard;

/** Set of every kind currently modelled. Useful for exhaustiveness checks. */
export const PERCEIVED_HAZARD_KINDS: ReadonlySet<PerceivedHazard['kind']> =
  new Set(['lava', 'wind', 'crumbling', 'periodic'] as const);

// ---------------------------------------------------------------------------
// Validation — invariants enforced when a snapshot is built
// ---------------------------------------------------------------------------

/**
 * Validate a hazard's geometry + flags. Throws on any invariant
 * violation so a corrupted snapshot fails loudly during development
 * rather than producing silent target-selection / recovery drift.
 *
 * Invariants:
 *
 *   1. `bounds.width >= 0` and `bounds.height >= 0`. A degenerate
 *      (zero-area) hazard is allowed — useful for hazards in their
 *      "fully receded" phase (lava at trough) — but negative extents
 *      are nonsensical.
 *   2. `bounds.x` / `bounds.y` are finite numbers.
 *   3. `id` is a non-empty string.
 *   4. `kind` matches one of the modelled variants.
 *
 * Per-variant invariants are enforced by the TypeScript types
 * themselves (a `phase` outside the union literal won't compile) so
 * runtime checks here focus on numeric well-formedness.
 */
export function validatePerceivedHazard(hazard: PerceivedHazard): void {
  const { id, bounds, kind } = hazard;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(
      `PerceivedHazard: id must be a non-empty string, got ${String(id)}`,
    );
  }
  if (!PERCEIVED_HAZARD_KINDS.has(kind)) {
    throw new Error(
      `PerceivedHazard(${id}): unknown kind ${String(kind)} — expected one of ` +
        `${[...PERCEIVED_HAZARD_KINDS].join(', ')}`,
    );
  }
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    throw new Error(
      `PerceivedHazard(${id}): bounds must be finite numbers, got ${JSON.stringify(
        bounds,
      )}`,
    );
  }
  if (bounds.width < 0 || bounds.height < 0) {
    throw new Error(
      `PerceivedHazard(${id}): bounds.width / bounds.height must be ≥ 0, got ` +
        `width=${bounds.width}, height=${bounds.height}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers — point ↔ AABB queries
// ---------------------------------------------------------------------------

/**
 * Half-extent helper — returns the AABB's min/max bounds on each
 * axis given a centre-of-AABB record. Pure function, no allocation
 * beyond the returned object.
 *
 * Centralised here so `pointInsideHazard`, `distanceToHazardEdge`,
 * and any future overlap helpers compute the conversion identically
 * (off-by-one bugs in this conversion are hard to spot in test
 * fixtures).
 */
export function getHazardAabbMinMax(
  bounds: PerceivedHazardBounds,
): {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
} {
  const halfW = bounds.width / 2;
  const halfH = bounds.height / 2;
  return {
    minX: bounds.x - halfW,
    maxX: bounds.x + halfW,
    minY: bounds.y - halfH,
    maxY: bounds.y + halfH,
  };
}

/**
 * Test whether a perceived point lies inside (or on the boundary of)
 * a hazard's AABB. Inclusive on the boundary so a fighter exactly at
 * the lava's edge counts as "inside" — which is the behaviour the
 * damage system already uses, and matching it here keeps the AI's
 * "am I touching the lava?" answer in lock-step with the runtime's
 * "did the lava damage me?" answer.
 *
 * Pure function, returns `false` for any hazard with zero area
 * (boundary collapses to a line / point and the bot is not "inside"
 * a degenerate body).
 */
export function pointInsideHazard(
  point: PerceivedPoint,
  hazard: PerceivedHazard,
): boolean {
  const { bounds } = hazard;
  if (bounds.width === 0 || bounds.height === 0) return false;
  const { minX, maxX, minY, maxY } = getHazardAabbMinMax(bounds);
  return (
    point.x >= minX &&
    point.x <= maxX &&
    point.y >= minY &&
    point.y <= maxY
  );
}

/**
 * Distance metrics from `point` to the hazard's *centre*. Convenience
 * wrapper around {@link computeDistance} that lifts the AABB centre
 * out of the bounds record so callers don't reach into hazard
 * internals.
 */
export function distanceToHazardCenter(
  point: PerceivedPoint,
  hazard: PerceivedHazard,
): DistanceMetrics {
  return computeDistance(point, { x: hazard.bounds.x, y: hazard.bounds.y });
}

/**
 * Chebyshev (max-axis) distance from `point` to the *nearest edge* of
 * the hazard's AABB. Returns:
 *
 *   • `0`   when the point is exactly on the boundary.
 *   • `< 0` when the point is *inside* the AABB — the magnitude is
 *           the perpendicular distance to the closest edge (i.e. how
 *           far the bot has penetrated). Useful for "where do I have
 *           to move to escape?" calculations.
 *   • `> 0` when the point is outside — the magnitude is the
 *           shortest axis-aligned distance to any edge. Used by
 *           threat scoring to weight "hazard nearby" without paying
 *           a sqrt.
 *
 * Chebyshev rather than euclidean because the AI's question is
 * "which axis do I have to clear?" not "how far in 2D?" — a hazard
 * 50 px below + 30 px to the right of the bot is escapable by 30 px
 * of horizontal movement, so the chebyshev value (30) is the right
 * answer. Euclidean would over-report at 58.3.
 */
export function chebyshevDistanceToHazardEdge(
  point: PerceivedPoint,
  hazard: PerceivedHazard,
): number {
  const { minX, maxX, minY, maxY } = getHazardAabbMinMax(hazard.bounds);
  // Distance to the nearest edge on each axis. If the point is
  // outside the band, this is the gap; if inside, the negative
  // distance to whichever edge is closer.
  const xGap =
    point.x < minX
      ? minX - point.x
      : point.x > maxX
        ? point.x - maxX
        : -Math.min(point.x - minX, maxX - point.x);
  const yGap =
    point.y < minY
      ? minY - point.y
      : point.y > maxY
        ? point.y - maxY
        : -Math.min(point.y - minY, maxY - point.y);

  // Outside on at least one axis: chebyshev = max of the positive
  // gaps (treat negative-axis gaps as 0 for the outside case so a
  // point above-and-right of the AABB reports the correct positive
  // distance to the nearest edge).
  if (xGap >= 0 || yGap >= 0) {
    return Math.max(xGap >= 0 ? xGap : 0, yGap >= 0 ? yGap : 0);
  }

  // Both axes negative → fully inside. The "escape distance" is the
  // shorter of the two penetrations (closer edge wins).
  return Math.max(xGap, yGap);
}

// ---------------------------------------------------------------------------
// Filter / search helpers
// ---------------------------------------------------------------------------

/** Predicate-friendly alias for the dangerous-only filter. */
export type HazardPredicate = (hazard: PerceivedHazard) => boolean;

/**
 * Return only the hazards that are dangerous *right now*. Equivalent
 * to `hazards.filter(h => h.isDangerous)` but exported as a named
 * helper so call sites read intent at a glance.
 *
 * Pure function — does not allocate when the input list is empty
 * (returns the same empty array reference).
 */
export function getDangerousHazards(
  hazards: ReadonlyArray<PerceivedHazard>,
): ReadonlyArray<PerceivedHazard> {
  if (hazards.length === 0) return hazards;
  const out: PerceivedHazard[] = [];
  for (const h of hazards) {
    if (h.isDangerous) out.push(h);
  }
  return out;
}

/**
 * Return only the hazards the bot can use as terrain right now —
 * solid crumbling / periodic platforms. Lava and wind are never
 * blocking. Same lazy-allocation pattern as
 * {@link getDangerousHazards}.
 */
export function getBlockingHazards(
  hazards: ReadonlyArray<PerceivedHazard>,
): ReadonlyArray<PerceivedHazard> {
  if (hazards.length === 0) return hazards;
  const out: PerceivedHazard[] = [];
  for (const h of hazards) {
    if (h.isBlocking) out.push(h);
  }
  return out;
}

/**
 * Find the hazard whose nearest edge is closest to `point` (chebyshev
 * metric). Returns `null` for an empty list or when no hazard
 * satisfies the optional predicate.
 *
 * Tie-break: deterministic — when two hazards report identical
 * distances, the one earlier in the input list wins. Combined with
 * `buildWorldSnapshot`'s sort (hazards land in stable order, see
 * `sortPerceivedHazards`), this means two replays presented with the
 * same hazard set produce the same nearest-hazard pick.
 *
 * Returns the matched hazard *with its measured edge distance*,
 * folded into a small record so callers don't pay a second
 * `chebyshevDistanceToHazardEdge` call.
 */
export function findNearestHazard(
  point: PerceivedPoint,
  hazards: ReadonlyArray<PerceivedHazard>,
  predicate?: HazardPredicate,
): { readonly hazard: PerceivedHazard; readonly edgeDistance: number } | null {
  let best: PerceivedHazard | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const h of hazards) {
    if (predicate && !predicate(h)) continue;
    const d = chebyshevDistanceToHazardEdge(point, h);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  if (best === null) return null;
  return { hazard: best, edgeDistance: bestDist };
}

/**
 * Convenience compose: nearest *dangerous* hazard. Equivalent to
 * `findNearestHazard(point, hazards, h => h.isDangerous)` but reads
 * cleaner at call sites and lets the implementation skip the
 * predicate-call overhead in the most common case.
 */
export function findNearestDangerousHazard(
  point: PerceivedPoint,
  hazards: ReadonlyArray<PerceivedHazard>,
): { readonly hazard: PerceivedHazard; readonly edgeDistance: number } | null {
  let best: PerceivedHazard | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const h of hazards) {
    if (!h.isDangerous) continue;
    const d = chebyshevDistanceToHazardEdge(point, h);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  if (best === null) return null;
  return { hazard: best, edgeDistance: bestDist };
}

// ---------------------------------------------------------------------------
// Sorting — deterministic order for buildWorldSnapshot
// ---------------------------------------------------------------------------

/**
 * Stable order: by `kind` (lava before wind before crumbling before
 * periodic), then by `id` lexicographically. The `kind` ordering is
 * arbitrary but fixed; what matters is *determinism* — two ticks
 * presenting the same hazard set produce identical iteration order
 * regardless of insertion order, so target / threat / nearest-hazard
 * tie-breaks reproduce in replay.
 *
 * Pure function — returns a *new* sorted array; the input is not
 * mutated.
 */
export function sortPerceivedHazards(
  hazards: ReadonlyArray<PerceivedHazard>,
): ReadonlyArray<PerceivedHazard> {
  if (hazards.length <= 1) return hazards;
  const order: Record<PerceivedHazard['kind'], number> = {
    lava: 0,
    wind: 1,
    crumbling: 2,
    periodic: 3,
  };
  return hazards.slice().sort((a, b) => {
    const k = order[a.kind] - order[b.kind];
    if (k !== 0) return k;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
