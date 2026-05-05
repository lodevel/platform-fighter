/**
 * Platform collision toggling — Sub-AC 3 of AC 90303.
 *
 * Single source of truth for "should this platform body collide with
 * characters right now, and with which mask?" Lives next to
 * {@link ./platformBehavior platformBehavior.ts} (Phaser-free, Sub-AC 1
 * of AC 90301) so the stage renderer, the runtime crumble adapter, the
 * stage builder preview, and replay tooling can all read the same
 * computation without forking the rule into four places.
 *
 * Why a *toggle* layer at all (rather than baking everything into
 * `StageRenderer` / `Character`):
 *
 *   - The three platform behavior types (`solid` / `pass-through` /
 *     `moving`) come from {@link ./platformBehavior the schema layer},
 *     but each has a *runtime* state that changes during the match:
 *
 *       * `solid` platforms never toggle — but a crumbling-platform
 *         entity wraps one and turns it non-collidable when the
 *         lifecycle phase enters `falling` / `gone` (see
 *         {@link ../entities/CrumblingPlatform}).
 *       * `pass-through` platforms must temporarily stop colliding with
 *         a character that's actively dropping through them ("press down
 *         on a thin platform" → fall through). A multi-fighter match
 *         can have several drop-throughs in flight simultaneously, so
 *         the toggle accepts a *count* of currently-dropping fighters
 *         rather than a boolean.
 *       * `moving` platforms behave exactly like `solid` for filtering
 *         purposes (they're kinematic, not non-collidable). A `moving`
 *         platform authored with `passThrough: true` is a rare drop-
 *         through-while-moving variant — we honour that combination
 *         exactly the same way the renderer does at construction time.
 *
 *   - Matter.js' filter check is bidirectional:
 *
 *         (a.mask & b.category) !== 0 && (b.mask & a.category) !== 0
 *
 *     so we *don't* need to touch the character body's mask to make a
 *     platform stop colliding — flipping the platform's `mask` is enough
 *     to gate the pair from one side. This module does exactly that.
 *
 *   - Tests can pin every transition (mode/category/mask triplet)
 *     without instantiating Matter or jsdom — the computation is a pure
 *     function of `(behavior, passThrough, isSolid, dropThroughCount)`.
 *
 * Responsibilities:
 *
 *   1. {@link computePlatformColliderState} — pure function that returns
 *      the canonical `(category, mask, mode)` triplet for a platform's
 *      *current* state. No Matter import, fully unit-testable.
 *
 *   2. {@link applyPlatformColliderState} — writes a computed state to
 *      a Matter body's `collisionFilter` in place. Uses a structural-
 *      type minimal body interface so tests can drive it with plain
 *      objects.
 *
 *   3. {@link PLATFORM_COLLIDER_MODES} — the canonical, frozen list of
 *      the four possible modes a platform can be in at any frame.
 *
 * Determinism: every output is a pure function of the inputs. No
 * `Math.random()`, no wall-clock reads, no Matter side-effects beyond
 * the explicit `applyPlatformColliderState` writeback.
 */

import {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
} from '../engine/collisionCategories';
import type { PlatformBehavior } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The four runtime modes a platform body can be in at any fixed step.
 *
 *   - `'solid'`              : full ground-style collision. Used by
 *                              `behavior === 'solid'` and by `'moving'`
 *                              platforms that aren't `passThrough: true`.
 *
 *   - `'pass-through'`       : characters can land on top of the
 *                              platform but projectiles fly past it.
 *                              Default mode for `behavior === 'pass-through'`
 *                              with no fighters mid-drop.
 *
 *   - `'pass-through-drop'`  : the platform is currently letting one or
 *                              more fighters drop through it (stick-down
 *                              held on a thin platform). The mask drops
 *                              the `CHARACTER` bit so the platform
 *                              physically passes the body. Only reachable
 *                              from a base of `'pass-through'`.
 *
 *   - `'inactive'`           : the platform has been turned off — by a
 *                              crumble lifecycle ('falling' / 'gone'),
 *                              by a custom-stage script, or by a debug
 *                              toggle. Mask is `0` so no body in the
 *                              world collides with it.
 */
export type PlatformColliderMode =
  | 'solid'
  | 'pass-through'
  | 'pass-through-drop'
  | 'inactive';

/**
 * Result of {@link computePlatformColliderState}: the runtime mode plus
 * the exact `(category, mask)` pair to write into Matter's
 * `body.collisionFilter`. Frozen so callers can't accidentally mutate a
 * cached snapshot — the upstream record is recomputed each frame anyway.
 */
export interface PlatformColliderState {
  readonly mode: PlatformColliderMode;
  readonly category: number;
  readonly mask: number;
}

/**
 * Inputs to {@link computePlatformColliderState}. Every field is
 * optional except `behavior` and `passThrough` — those are required so
 * the schema-level invariants (see {@link ./platformBehavior
 * validateStagePlatform}) are honoured even at runtime.
 */
export interface PlatformColliderInput {
  /**
   * The canonical platform behavior, as resolved by
   * {@link ./platformBehavior.getPlatformBehavior}. The toggle does NOT
   * re-derive this — callers are expected to feed the resolved value so
   * a bug in behavior resolution surfaces in one place, not three.
   */
  readonly behavior: PlatformBehavior;
  /**
   * Legacy drop-through flag. Honoured for the rare
   * `behavior === 'moving'` + `passThrough: true` combination so a
   * drop-through moving platform behaves like a thin platform with
   * regard to projectiles / drop-through input.
   */
  readonly passThrough: boolean;
  /**
   * Whether the platform is *currently solid* in the lifecycle sense.
   * Defaults to `true` — set to `false` when a crumbling platform has
   * entered `falling` / `gone` and should stop colliding with anything,
   * or when a custom-stage script has temporarily turned the platform
   * off. Drives the `'inactive'` mode regardless of the base behavior.
   */
  readonly isSolid?: boolean;
  /**
   * Number of fighters currently mid-drop-through on this platform. Any
   * value ≥ 1 flips a `'pass-through'` platform into
   * `'pass-through-drop'` (mask drops the `CHARACTER` bit). Ignored when
   * the platform isn't pass-through. Default `0`.
   *
   * A *count* (rather than a boolean) is the right primitive: in a
   * 4-player match two fighters can each be mid-drop-through on the
   * same platform on the same frame. We need to keep the platform
   * non-colliding until *all* of them have cleared it, which is exactly
   * what a refcount expresses.
   */
  readonly dropThroughCount?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The canonical, frozen list of the four runtime modes — exposed so
 * tests and exhaustiveness checks have a single reference list.
 */
export const PLATFORM_COLLIDER_MODES: ReadonlyArray<PlatformColliderMode> =
  Object.freeze(['solid', 'pass-through', 'pass-through-drop', 'inactive']);

/**
 * Pre-baked `(category, mask)` pairs per mode. Deliberately frozen so a
 * caller can't pass a stale snapshot through `applyPlatformColliderState`
 * and corrupt the table for everyone.
 */
const SOLID_FILTER = Object.freeze({
  category: COLLISION_CATEGORIES.PLATFORM_SOLID,
  mask: COLLISION_MASKS.PLATFORM_SOLID,
});

const PASS_THROUGH_FILTER = Object.freeze({
  category: COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
  mask: COLLISION_MASKS.PLATFORM_PASS_THROUGH,
});

/**
 * "Pass-through, but drop the CHARACTER bit so a fighter currently
 * pressing down passes through". The category stays the same — only
 * the mask changes — so existing pair tracking on the watcher side
 * doesn't have to retrofit a different category to the same body.
 *
 * The mask is computed (not literal-zero) by stripping the CHARACTER
 * bit from the base pass-through mask. This keeps the rule "any future
 * categories the pass-through default opts into still flow through
 * here" — i.e. if the default mask later starts opting into `ITEM`, a
 * dropped-through platform still lets items rest on it but lets
 * fighters fall.
 */
const PASS_THROUGH_DROP_FILTER = Object.freeze({
  category: COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
  mask: COLLISION_MASKS.PLATFORM_PASS_THROUGH & ~COLLISION_CATEGORIES.CHARACTER,
});

/**
 * "No collision at all" — used while a crumbling platform is in
 * `falling` / `gone` or while a custom-stage script has turned the
 * platform off. The category is preserved (so debug overlays can still
 * tell which slot the body would belong to) but the mask is `0` so
 * Matter's bidirectional check fails for every counterparty.
 */
const INACTIVE_SOLID_FILTER = Object.freeze({
  category: COLLISION_CATEGORIES.PLATFORM_SOLID,
  mask: 0,
});

const INACTIVE_PASS_THROUGH_FILTER = Object.freeze({
  category: COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
  mask: 0,
});

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Resolve the runtime mode for a platform. Pure function — no Matter
 * import, no body inspection. Decision tree:
 *
 *   isSolid === false                           → 'inactive'
 *   behavior === 'solid'                        → 'solid'
 *   behavior === 'moving' && !passThrough       → 'solid'
 *   behavior === 'moving' &&  passThrough …
 *     dropThroughCount > 0                      → 'pass-through-drop'
 *     otherwise                                 → 'pass-through'
 *   behavior === 'pass-through' …
 *     dropThroughCount > 0                      → 'pass-through-drop'
 *     otherwise                                 → 'pass-through'
 *
 * The `'inactive'` short-circuit at the top is deliberate: a crumbling
 * pass-through platform that has finished falling should NOT keep
 * accepting drop-through events; the body is gone.
 */
export function computePlatformColliderState(
  input: PlatformColliderInput,
): PlatformColliderState {
  const isSolid = input.isSolid !== false; // default true
  const dropping = (input.dropThroughCount ?? 0) > 0;

  // ---- Inactive (crumble fallen, debug-off, etc.) ------------------------
  if (!isSolid) {
    // Preserve the category for downstream debug overlays so a frozen
    // crumbling platform still reads as "pass-through" in the inspector.
    const isPassThrough =
      input.behavior === 'pass-through' ||
      (input.behavior === 'moving' && input.passThrough);
    const filter = isPassThrough
      ? INACTIVE_PASS_THROUGH_FILTER
      : INACTIVE_SOLID_FILTER;
    return {
      mode: 'inactive',
      category: filter.category,
      mask: filter.mask,
    };
  }

  // ---- Solid (behavior 'solid', plus 'moving' without passThrough) -------
  if (
    input.behavior === 'solid' ||
    (input.behavior === 'moving' && !input.passThrough)
  ) {
    return {
      mode: 'solid',
      category: SOLID_FILTER.category,
      mask: SOLID_FILTER.mask,
    };
  }

  // ---- Pass-through family (behavior 'pass-through' or 'moving' + pT) ----
  // Both base behaviors share the same mode / filter table. The only
  // difference between a static thin platform and a moving thin platform
  // is the body's position update — collision filtering is identical.
  if (dropping) {
    return {
      mode: 'pass-through-drop',
      category: PASS_THROUGH_DROP_FILTER.category,
      mask: PASS_THROUGH_DROP_FILTER.mask,
    };
  }
  return {
    mode: 'pass-through',
    category: PASS_THROUGH_FILTER.category,
    mask: PASS_THROUGH_FILTER.mask,
  };
}

// ---------------------------------------------------------------------------
// Apply (writes to a Matter body)
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a Matter body the toggle needs to write to. Only
 * `collisionFilter` is required — we deliberately avoid coupling to the
 * full `MatterJS.BodyType` so unit tests can drive the applier with
 * plain objects.
 *
 * The `category` / `mask` fields on `collisionFilter` are required and
 * mutable; `group` is preserved unchanged (the engine doesn't use
 * Matter's `group` override mechanism — see the module header in
 * {@link ../engine/collisionCategories}).
 */
export interface ToggleablePlatformBody {
  collisionFilter: {
    category: number;
    mask: number;
    group?: number;
  };
}

/**
 * Write a {@link PlatformColliderState} to a Matter body's
 * `collisionFilter` in place. Returns `true` iff the call actually
 * changed either field — useful for tests and for callers that want
 * to short-circuit work when nothing has flipped.
 *
 * Why mutate vs. replace the `collisionFilter` object: Matter.js holds
 * its own internal references to the body's filter in pair-tracking
 * structures. Replacing the whole object can cause stale-reference
 * pair lookups during the same step's collision dispatch. Mutating the
 * existing `category` / `mask` fields (the canonical Matter pattern for
 * runtime filter changes) keeps the engine's internal state consistent.
 */
export function applyPlatformColliderState(
  body: ToggleablePlatformBody,
  state: PlatformColliderState,
): boolean {
  const filter = body.collisionFilter;
  let changed = false;
  if (filter.category !== state.category) {
    filter.category = state.category;
    changed = true;
  }
  if (filter.mask !== state.mask) {
    filter.mask = state.mask;
    changed = true;
  }
  return changed;
}

/**
 * One-shot convenience: compute and apply in a single call. Returns
 * the resolved state (also returned by `computePlatformColliderState`)
 * so callers that want to log the new mode don't have to recompute it.
 *
 * Most call sites should prefer the split form so the computed state
 * can be cached / compared across frames; this convenience entry exists
 * for the simple "every fixed step, recompute and write" wiring used
 * by `StageRenderer` and the crumble adapter.
 */
export function togglePlatformCollision(
  body: ToggleablePlatformBody,
  input: PlatformColliderInput,
): PlatformColliderState {
  const state = computePlatformColliderState(input);
  applyPlatformColliderState(body, state);
  return state;
}
