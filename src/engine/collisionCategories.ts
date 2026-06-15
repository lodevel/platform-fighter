/**
 * Matter.js collision categories shared across the engine.
 *
 * Lives in `engine/` (Phaser-free) so the character controller, the AI
 * vision module, projectile spawners, the stage renderer, and replay
 * tooling can all import the same bitmask constants without taking on
 * a Phaser dependency.
 *
 * Matter.js filters bodies via three integer fields per body:
 *   - `collisionFilter.category` — what *this* body is (single bit)
 *   - `collisionFilter.mask`     — which categories this body collides with
 *   - `collisionFilter.group`    — overrides above when both bodies share
 *                                  a non-zero group (we don't use groups)
 *
 * Two bodies collide iff
 *   `(a.mask & b.category) !== 0 && (b.mask & a.category) !== 0`.
 *
 * Categories are 32-bit; only bits 0..30 are safely usable in JS bitmask
 * arithmetic. We deliberately reserve plenty of headroom (eight slots
 * here, room for 22 more) so future additions — pickups, ledge grabs,
 * spike traps — don't need a renumber.
 *
 * Slot summary:
 *   PLATFORM_SOLID        — solid ground / walls (always collidable)
 *   PLATFORM_PASS_THROUGH — thin floating platforms (one-way; the
 *                            character controller toggles the mask to
 *                            implement drop-through semantics)
 *   CHARACTER             — playable fighters
 *   HITBOX                — attack hitbox sensors emitted by moves
 *   PROJECTILE            — bullets / fireballs / thrown items
 *   HAZARD                — stage hazards (lava, spikes, crushers)
 *   BLAST_ZONE            — KO trigger sensors at the stage boundary
 *   ITEM                  — pickups (reserved for post-M2)
 */
export const COLLISION_CATEGORIES = {
  PLATFORM_SOLID: 0x0001,
  PLATFORM_PASS_THROUGH: 0x0002,
  /**
   * Keepalive sentinel for the scene-level pass-through-platform mask
   * driver. NO body ever carries this category, so OR-ing it into a
   * platform's mask creates no collisions — its only job is to keep a
   * driver-written mask from ever being the literal `0` that the
   * crumbling-platform adapter uses as its "disabled, do not
   * resurrect" sentinel. Without it, the moment EVERY fighter was
   * simultaneously phased for a platform (e.g. both players brawling
   * on the ground beneath a float), the driver wrote `mask = 0`, then
   * read its own write back as "crumbled" on the next step and skipped
   * the platform for the rest of the match — the "walk under a
   * platform and it becomes permanently unstandable" bug.
   */
  PASS_THROUGH_DRIVER_KEEPALIVE: 0x20000000,
  CHARACTER: 0x0004,
  HITBOX: 0x0008,
  PROJECTILE: 0x0010,
  HAZARD: 0x0020,
  BLAST_ZONE: 0x0040,
  ITEM: 0x0080,
  /**
   * Per-fighter slot bits. Each fighter's body category is OR-ed with
   * the bit for its slot (`CHARACTER_SLOT_0` for player 1, `..._1` for
   * player 2, etc.). A pass-through platform's runtime mask (written
   * by the scene-level driver each step) holds a subset of these bits
   * — exactly the slots that should currently collide with the
   * platform — so phasing for one fighter doesn't leak to another.
   * The shared `CHARACTER` bit stays in fighter categories so every
   * other system (hitboxes, hazards, blast zones) keeps matching by
   * type without caring which slot owns the body.
   */
  CHARACTER_SLOT_0: 0x0100,
  CHARACTER_SLOT_1: 0x0200,
  CHARACTER_SLOT_2: 0x0400,
  CHARACTER_SLOT_3: 0x0800,
} as const;

/**
 * Maximum supported fighter slot count (matches the four
 * `CHARACTER_SLOT_*` bits above). Adding a fifth fighter to the FFA
 * roster requires extending both this constant and
 * {@link CHARACTER_SLOT_BITS}.
 */
export const MAX_FIGHTER_SLOTS = 4;

/**
 * Bit-indexed array of the per-slot category bits, in slot order. The
 * scene driver indexes into it by slot to OR the right bit into the
 * platform's runtime mask. Frozen so callers can't reshape the slot
 * → bit map at runtime.
 */
export const CHARACTER_SLOT_BITS: ReadonlyArray<number> = Object.freeze([
  COLLISION_CATEGORIES.CHARACTER_SLOT_0,
  COLLISION_CATEGORIES.CHARACTER_SLOT_1,
  COLLISION_CATEGORIES.CHARACTER_SLOT_2,
  COLLISION_CATEGORIES.CHARACTER_SLOT_3,
]);

/** OR of every `CHARACTER_SLOT_*` bit — the "all fighters collide" mask. */
export const CHARACTER_ALL_SLOTS: number = CHARACTER_SLOT_BITS.reduce(
  (acc, bit) => acc | bit,
  0,
);

export type CollisionCategory =
  (typeof COLLISION_CATEGORIES)[keyof typeof COLLISION_CATEGORIES];

/**
 * Default collision masks for the most common body types. Each value is
 * the OR of every category the owning body should collide with.
 *
 * Why pre-bake these masks?
 *   - It gives every body a single source of truth for "what do I bump
 *     into?" — the character controller, projectile spawner, and stage
 *     renderer all read from the same table.
 *   - Tests can lock down the rules: e.g. "a hitbox must never collide
 *     with a platform" stays a one-line assertion.
 *   - Hot reloading a single value updates every body created after the
 *     swap, no per-call-site edits.
 *
 * Bodies that need bespoke filtering (a hitbox that ignores its owner,
 * a hazard that only damages characters) can still override the mask at
 * construction time — these defaults are just the sensible starting
 * point.
 */
export const COLLISION_MASKS = {
  /** Solid platforms collide with everything physical except other platforms. */
  PLATFORM_SOLID:
    COLLISION_CATEGORIES.CHARACTER |
    COLLISION_CATEGORIES.PROJECTILE |
    COLLISION_CATEGORIES.ITEM,

  /**
   * Pass-through platforms only collide with characters by default
   * (projectiles fly through). The character controller drops this bit
   * temporarily to implement "press down to drop through".
   */
  PLATFORM_PASS_THROUGH: COLLISION_CATEGORIES.CHARACTER,

  /**
   * Characters collide with platforms, hazards, items, the KO sensors,
   * incoming hitboxes (so damage events fire), and projectiles.
   * Matter's filter check is bidirectional (`(a.mask & b.cat) &&
   * (b.mask & a.cat)`), so the character side needs to opt-in to every
   * category it can be hit by — not just the things it physically
   * touches.
   */
  CHARACTER:
    COLLISION_CATEGORIES.PLATFORM_SOLID |
    COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH |
    COLLISION_CATEGORIES.HAZARD |
    COLLISION_CATEGORIES.BLAST_ZONE |
    COLLISION_CATEGORIES.ITEM |
    COLLISION_CATEGORIES.HITBOX |
    COLLISION_CATEGORIES.PROJECTILE,

  /** Hitboxes only register on characters; they pass through geometry. */
  HITBOX: COLLISION_CATEGORIES.CHARACTER,

  /** Projectiles hit characters and solid geometry but pass over thin platforms. */
  PROJECTILE:
    COLLISION_CATEGORIES.CHARACTER |
    COLLISION_CATEGORIES.PLATFORM_SOLID |
    COLLISION_CATEGORIES.HAZARD,

  /** Hazards damage characters and projectiles. */
  HAZARD: COLLISION_CATEGORIES.CHARACTER | COLLISION_CATEGORIES.PROJECTILE,

  /** Blast-zone sensors only fire on characters and projectiles (for items). */
  BLAST_ZONE:
    COLLISION_CATEGORIES.CHARACTER |
    COLLISION_CATEGORIES.PROJECTILE |
    COLLISION_CATEGORIES.ITEM,

  /** Items rest on solid floors and can be grabbed by characters. */
  ITEM:
    COLLISION_CATEGORIES.PLATFORM_SOLID |
    COLLISION_CATEGORIES.CHARACTER |
    COLLISION_CATEGORIES.BLAST_ZONE,
} as const;

/**
 * Pure helper — returns true iff two bodies *would* collide, given
 * Matter's bidirectional `(a.mask & b.cat) && (b.mask & a.cat)` rule.
 *
 * Lifting this into engine-core lets unit tests assert collision
 * intent without instantiating a Matter world.
 */
export function categoriesCollide(
  a: { category: number; mask: number },
  b: { category: number; mask: number },
): boolean {
  return (a.mask & b.category) !== 0 && (b.mask & a.category) !== 0;
}
