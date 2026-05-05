/**
 * Combat math primitives — Sub-AC 4.1 of AC 301 + Sub-AC 2 of AC 6
 * (knockback velocity/angle scaling formula for the %-damage system).
 *
 * Pure functions (no Phaser, no Matter, no `Math.random()`, no wall-clock
 * reads) for the four pieces of the damage / knockback / hitstun system:
 *
 *   1. Damage accumulation — additive percent meter, clamped to
 *      `[0, MAX_DAMAGE_PERCENT]` to match the ontology constraint
 *      ("damage_percent: 0-999").
 *   2. Knockback vector — base vector from the move, scaled by the
 *      target's current percent ("scaling" component) and the target's
 *      mass relative to a baseline. The horizontal component is mirrored
 *      by the attacker's facing so a move authored "facing right" still
 *      sends a right-facing target to the right.
 *   3. Launch angle — the *direction* the target is sent, expressed in
 *      radians via `Math.atan2(vy, vx)` with the standard
 *      "+x is 0, +y points down on screen" Phaser/Matter convention. The
 *      angle is invariant under percent scaling (only magnitude grows
 *      with %) — this is the canonical Smash-style "each move has its
 *      own knockback trajectory" semantic, exposed as a first-class
 *      output so AI / KO predictors / debug HUDs don't have to recompute
 *      it from the velocity vector.
 *   4. Hitstun frames — derived from the realised knockback magnitude so
 *      a finisher that sends the target flying also locks them out of
 *      acting longer than a poke does. Clamped at a minimum so even the
 *      lightest tap reads as a hit.
 *
 * Why a separate file:
 *   • Pure math — easy to unit-test with no scene fixtures, and easy to
 *     reuse from the AI module ("if I attack at this percent, what's
 *     the predicted hitstun?") and the (later AC) damage-handler
 *     collision callback.
 *   • Determinism note — every output is a deterministic function of
 *     its inputs. Running the same hit through `applyHit` twice with
 *     the same percent / mass produces byte-identical knockback. This
 *     is the property the replay system relies on.
 *   • Keeps `Character.ts` from sprouting a third responsibility on top
 *     of body construction and movement physics.
 *
 * Formula choices (tuned for "feels Smash-ish, not exactly Smash"):
 *
 *   realised_kb = base_kb * (1 + scaling * percent) * (BASELINE_MASS / target_mass)
 *
 *     - scaling controls how fast the knockback grows with percent. A
 *       jab might use scaling ≈ 0.05 (gentle ramp); a finisher smash
 *       uses scaling ≈ 0.4+ (kills past 100 %).
 *     - BASELINE_MASS / target_mass models weight: heavier characters
 *       resist knockback (smaller multiplier), lighter ones get sent
 *       flying. We use the default baseline mass (12) so unit-tested
 *       fighters with no mass override behave neutrally.
 *
 *   hitstun_frames = clamp(
 *     round(magnitude * HITSTUN_FRAMES_PER_KNOCKBACK_UNIT),
 *     MIN_HITSTUN_FRAMES,
 *     MAX_HITSTUN_FRAMES,
 *   )
 *
 *     - MIN guarantees every connect feels like a hit (no zero-frame
 *       hitstun on tiny pokes that would otherwise flicker).
 *     - MAX caps absurd 999% hits at a sensible upper bound (~2 s) so
 *       a single combo can't lock a victim out for 10 seconds.
 */

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/**
 * Maximum damage percent a fighter can carry. Mirrors the ontology
 * constraint ("damage_percent: 0-999"). At MAX, knockback is enormous
 * — practically every hit is a KO past ~150 %, but the cap exists so
 * the math never produces NaN/Infinity from a freakishly long match.
 */
export const MAX_DAMAGE_PERCENT = 999;

/**
 * Baseline mass used in the weight-scaling factor. Kept as a hard
 * constant (not imported from `Character.ts`) to avoid the circular
 * dependency `Character ↔ combat` and to give the math one stable
 * reference point that doesn't move when per-fighter tuning shifts.
 *
 * Sub-AC 2.2 of the T2 refactor — `Character` no longer holds a
 * generic `mass` default (each per-fighter movement profile owns its
 * own mass). `BASELINE_MASS` is therefore the *neutral knockback
 * reference*: a hypothetical fighter at this mass takes a move's
 * authored base knockback unscaled, fighters lighter than this fly
 * further at the same percent, and fighters heavier resist more.
 * Cat (8) flies further; Wolf (16) and Bear (20) resist; Owl (10) is
 * close to neutral. Keeping the constant at 12 preserves the historical
 * combat math used to author every move's knockback values, so this
 * sub-AC is byte-for-byte stable for damage / launch calculations.
 */
export const BASELINE_MASS = 12;

/**
 * Frames of hitstun applied per unit of realised knockback magnitude.
 * Tuned so a baseline jab (mag ≈ 1.5) produces ~3 frames before MIN
 * kicks in, while a heavy smash launcher (mag ≈ 15) produces ~30
 * frames (~500 ms — long enough to read but not unbreakably long).
 */
export const HITSTUN_FRAMES_PER_KNOCKBACK_UNIT = 2.0;

/**
 * Lower bound on hitstun frames — no matter how feeble the hit, a
 * connect always pauses the target for at least this many frames so
 * the player gets visual / animation feedback that they were hit.
 * 6 frames at 60 Hz = 100 ms.
 */
export const MIN_HITSTUN_FRAMES = 6;

/**
 * Upper bound on hitstun frames — caps absurdly long lockouts at
 * ~2 seconds even at 999 % knockback magnitudes. Not strictly
 * necessary (the engine wouldn't break) but it keeps any single hit
 * from feeling unfair to a high-percent target.
 */
export const MAX_HITSTUN_FRAMES = 120;

// ---------------------------------------------------------------------------
// Hit-feel constants (post-M2 architecture pass — milestone H1)
//
// These constants drive the "moment of contact" mechanics that make
// hits feel crunchy without letting a hit character immediately
// retaliate. The formulas are calibrated against a web survey of
// Smash Ultimate, Rivals of Aether, Brawlhalla, SF6, GG Strive, and
// Lethal League — see plan file
// `~/.claude/plans/i-want-you-to-fluffy-parasol.md` for sources.
//
// Tiers map move damage (in %) to a hitlag freeze duration, with
// optional bonuses for sweet-spot hits and hitting at high percent.
// All values are integers in fixed-step frames — pure deterministic
// math, replay-safe.
// ---------------------------------------------------------------------------

/** Damage threshold ≤ which a hit is "light" (4f freeze). */
export const HITLAG_LIGHT_DAMAGE_THRESHOLD = 8;
/** Damage threshold ≤ which a hit is "medium" (8f freeze). Above is "heavy" (12f). */
export const HITLAG_MEDIUM_DAMAGE_THRESHOLD = 15;
/** Hitlag frames for a light-tier hit (≤ LIGHT_DAMAGE_THRESHOLD damage). */
export const HITLAG_LIGHT_FRAMES = 4;
/** Hitlag frames for a medium-tier hit. */
export const HITLAG_MEDIUM_FRAMES = 8;
/** Hitlag frames for a heavy-tier hit. */
export const HITLAG_HEAVY_FRAMES = 12;
/** Bonus hitlag frames added on a sweet-spot connect (Marth-tipper / Falcon-knee idiom). */
export const HITLAG_SWEET_SPOT_BONUS_FRAMES = 4;
/** Target percent at or above which an extra hitlag bonus kicks in (Lethal-League high-% crunch). */
export const HITLAG_HIGH_PERCENT_THRESHOLD = 150;
/** Bonus hitlag frames when target.percent ≥ HITLAG_HIGH_PERCENT_THRESHOLD. */
export const HITLAG_HIGH_PERCENT_BONUS_FRAMES = 3;
/** Hard cap on hitlag frames — prevents stacked bonuses from feeling sticky. */
export const HITLAG_MAX_FRAMES = 18;

/** Maximum DI rotation in degrees. Stick perpendicular to launch rotates the angle by up to this much. */
export const DI_MAX_ROTATION_DEGREES = 18;

/** Constant frames added to shieldstun (defender's locked-in-shield window). */
export const SHIELDSTUN_BASE_FRAMES = 2;
/** Frames of shieldstun added per point of damage. */
export const SHIELDSTUN_PER_DAMAGE = 0.4;
/** Floor on shieldstun — even a 1% chip-block locks the shielder briefly. */
export const SHIELDSTUN_MIN_FRAMES = 3;
/** Cap on shieldstun for normals — keeps neutral fast-paced. Heavies still cap here; that's intentional. */
export const SHIELDSTUN_MAX_FRAMES = 8;

/** Light-tier screen shake amplitude in design pixels. */
export const SHAKE_LIGHT_INTENSITY_PX = 2;
/** Medium-tier screen shake amplitude in design pixels. */
export const SHAKE_MEDIUM_INTENSITY_PX = 4;
/** Heavy-tier screen shake amplitude in design pixels. */
export const SHAKE_HEAVY_INTENSITY_PX = 8;
/** Light-tier shake duration in fixed-step frames (≈ 50 ms at 60 Hz). */
export const SHAKE_LIGHT_DURATION_FRAMES = 3;
/** Medium-tier shake duration (≈ 100 ms at 60 Hz). */
export const SHAKE_MEDIUM_DURATION_FRAMES = 6;
/** Heavy-tier shake duration (≈ 150 ms at 60 Hz — research-backed cap; past this, satisfaction drops). */
export const SHAKE_HEAVY_DURATION_FRAMES = 9;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Description of an incoming hit, as read from a hitbox `plugin`
 * payload (see `attacks.ts`). The damage handler builds one of these
 * per collision pair and hands it to the target's `applyHit`.
 *
 * Why we mirror the hitbox payload instead of importing it directly:
 *   • Keeps `combat.ts` Phaser-free so it can be unit tested without a
 *     scene mock.
 *   • Lets AI / debug tooling synthesise hits without going through the
 *     real hitbox spawner ("simulate me getting hit by Wolf's smash").
 */
export interface HitInfo {
  /** Damage value added to the target's percent meter. */
  readonly damage: number;
  /**
   * Base knockback vector at 0 %. `x` is mirrored by `facing` (so a
   * positive `x` always sends the target away from the attacker).
   * `y` is taken as-is — negative values send the target upward.
   * `scaling` is the per-percent multiplier.
   */
  readonly knockback: {
    readonly x: number;
    readonly y: number;
    readonly scaling: number;
  };
  /** Attacker's facing direction at the moment the hit was registered. */
  readonly facing: 1 | -1;
  /**
   * Optional flag — `true` if the contact landed in the move's
   * authored sweet-spot region (post-M2 hit-feel pass). Threaded
   * into `computeHitlag` for the +4-frame freeze bonus and into
   * any future damage / knockback multiplier path. Falsy / omitted
   * means "regular contact" — every existing call site stays
   * unchanged.
   */
  readonly sweetSpot?: boolean;
}

/**
 * Result returned by `applyHit` (and computed standalone by
 * `computeKnockback`). Lets tests and AI consumers inspect the math
 * without re-implementing it.
 *
 * Sub-AC 2 of AC 6 contract: this result is the canonical "what does
 * %-damage scaling produce?" output. `vector` is the launch velocity
 * (already scaled by percent + mass + facing); `magnitude` is its
 * Euclidean length; `angle` is the direction in radians; `hitstunFrames`
 * locks the target out of input for that many fixed steps.
 */
export interface KnockbackResult {
  /** Final knockback velocity vector (Matter px-per-step units). */
  readonly vector: { readonly x: number; readonly y: number };
  /** Euclidean magnitude of `vector` (same units as `vector` components). */
  readonly magnitude: number;
  /**
   * Launch angle in radians, computed via `Math.atan2(vector.y, vector.x)`.
   *
   * Convention (Phaser/Matter screen-space):
   *   • +x axis (right) = 0 rad
   *   • -y axis (up)    = -π/2 rad
   *   • -x axis (left)  = ±π rad
   *   • +y axis (down)  = +π/2 rad
   *
   * Invariant: percent scaling and mass scaling do NOT change this angle
   * — they only scale magnitude. The angle is determined entirely by the
   * move's base knockback `(x, y)` ratio and the attacker's facing
   * (which mirrors the horizontal component). This matches the canonical
   * Smash-style "each move has a fixed launch trajectory" semantic.
   *
   * For a zero-magnitude knockback (degenerate case: base vector is
   * (0,0)), `Math.atan2(0, 0)` returns 0 — callers that branch on angle
   * should also consult `magnitude` to detect "no launch."
   */
  readonly angle: number;
  /** Frames of hitstun the hit applies to the target. */
  readonly hitstunFrames: number;
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Add `damage` to `currentPercent`, clamped into `[0, MAX_DAMAGE_PERCENT]`.
 *
 * Returns the new percent value. Negative damage is permitted and is
 * floored at 0 — this lets a future "healing item" apply negative
 * damage without us having to special-case it. Damage values that
 * would push past MAX are capped silently.
 */
export function accumulateDamage(currentPercent: number, damage: number): number {
  return clamp(currentPercent + damage, 0, MAX_DAMAGE_PERCENT);
}

/**
 * Compute the realised knockback for a hit landing on a target with
 * the given percent and mass. Pure function — every output is a
 * deterministic function of its inputs.
 *
 * Sub-AC 2 of AC 6 — formula:
 *
 *   percentMultiplier = 1 + scaling * clamp(percent, 0, MAX_DAMAGE_PERCENT)
 *   massMultiplier    = BASELINE_MASS / max(1, targetMass)
 *   totalMultiplier   = percentMultiplier * massMultiplier
 *
 *   launch.x = base.x * totalMultiplier * facing   // mirrored by attacker
 *   launch.y = base.y * totalMultiplier            // up/down preserved
 *
 *   magnitude = hypot(launch.x, launch.y)
 *   angle     = atan2(launch.y, launch.x)          // invariant under scaling
 *   hitstun   = clamp(round(magnitude * HITSTUN_FRAMES_PER_KNOCKBACK_UNIT),
 *                     MIN_HITSTUN_FRAMES, MAX_HITSTUN_FRAMES)
 *
 * Properties (each is verified by `combat.test.ts`):
 *
 *   • Velocity grows linearly with damage %: doubling `(1 + scaling*p)`
 *     doubles the magnitude, regardless of move or mass.
 *   • Launch angle is INVARIANT under percent and mass scaling — only
 *     magnitude grows. The angle is determined by the move's base
 *     knockback `(x, y)` ratio plus the attacker's facing.
 *   • Heavier targets fly less far at the same percent (mass term).
 *   • Facing mirrors the horizontal component so a move always sends
 *     the target *away* from the attacker, regardless of which side
 *     the attacker was authored facing.
 *   • Hitstun is a deterministic function of the realised magnitude.
 *
 * Steps:
 *   1. Clamp `percent` into `[0, MAX_DAMAGE_PERCENT]` so a buggy caller
 *      that hands in 1500 % doesn't blow up the math.
 *   2. Apply weight scaling: heavier targets take less, lighter take
 *      more. Mass is capped at a min of 1 to avoid zero-mass blowups,
 *      even though `Character` enforces positive mass at construction.
 *   3. Mirror the horizontal component by the attacker's facing so the
 *      hit sends the target *away* from the attacker, regardless of
 *      whether the move was authored facing-right.
 *   4. Compute magnitude, launch angle, and derive hitstun frames.
 */
export function computeKnockback(
  hit: HitInfo,
  targetPercent: number,
  targetMass: number,
): KnockbackResult {
  const safePercent = clamp(targetPercent, 0, MAX_DAMAGE_PERCENT);
  const safeMass = Math.max(1, targetMass);

  const percentMultiplier = 1 + hit.knockback.scaling * safePercent;
  const massMultiplier = BASELINE_MASS / safeMass;
  const totalMultiplier = percentMultiplier * massMultiplier;

  // Horizontal direction follows the attacker's facing — knockback always
  // pushes the target away from the source. The base vector is authored
  // as if attacking right (positive x = "outward").
  const vx = hit.knockback.x * totalMultiplier * hit.facing;
  const vy = hit.knockback.y * totalMultiplier;

  const magnitude = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);
  const hitstunFrames = computeHitstun(magnitude);

  return {
    vector: { x: vx, y: vy },
    magnitude,
    angle,
    hitstunFrames,
  };
}

/**
 * Compute the launch angle (radians) a hit will produce, without
 * computing the full velocity vector. Useful for AI / KO predictors
 * that need to ask "if I hit them with this move, will the trajectory
 * carry them past the side blast zone?" before paying the cost of a
 * full `computeKnockback` call.
 *
 * Sub-AC 2 of AC 6: the launch angle is invariant under percent scaling
 * and mass scaling — only the *magnitude* of the launch velocity grows
 * with damage %. So this function only needs the move's base knockback
 * and the attacker's facing; percent / mass are NOT inputs.
 *
 * Convention matches `KnockbackResult.angle`: radians, atan2(vy, vx),
 * +x = 0, -y up (Phaser/Matter screen-space). The horizontal component
 * is mirrored by `facing` so the angle reflects the *realised*
 * trajectory (target sent away from attacker), not the authored one.
 *
 * Degenerate case: if the move's base knockback is `(0, 0)`,
 * `Math.atan2(0, 0)` returns 0 — callers that need to detect a
 * zero-launch move should check the move's base components directly.
 */
export function computeLaunchAngle(
  baseKnockback: { readonly x: number; readonly y: number },
  facing: 1 | -1,
): number {
  return Math.atan2(baseKnockback.y, baseKnockback.x * facing);
}

/**
 * Convert a knockback magnitude into a hitstun frame count, clamped
 * into `[MIN_HITSTUN_FRAMES, MAX_HITSTUN_FRAMES]`. Exposed publicly so
 * AI scripts can predict "if I hit them now, how long will they be
 * stunned?" without re-doing the math by hand.
 */
export function computeHitstun(magnitude: number): number {
  const raw = Math.round(Math.abs(magnitude) * HITSTUN_FRAMES_PER_KNOCKBACK_UNIT);
  return clamp(raw, MIN_HITSTUN_FRAMES, MAX_HITSTUN_FRAMES);
}

// ---------------------------------------------------------------------------
// Hit-feel helpers (post-M2 architecture pass)
//
// Pure functions that derive hitlag duration, DI-rotated launch angle,
// shieldstun frames, and screen-shake parameters from the inputs of a
// single hit. They do NOT touch Character or Phaser state — the
// runtime calls them, then applies the resulting integer frame counts
// to its state machines.
// ---------------------------------------------------------------------------

/** Inputs to {@link computeHitlag}. */
export interface HitlagInput {
  /** Damage value of the move (% added to target). */
  readonly damage: number;
  /** Target's current percent BEFORE this hit lands (used for the high-% crunch bonus). */
  readonly targetPercent: number;
  /** Whether the hit was a sweet-spot connect (adds {@link HITLAG_SWEET_SPOT_BONUS_FRAMES}). */
  readonly sweetSpot?: boolean;
}

/**
 * Compute the freeze-frame duration for a confirmed hit. Both fighters
 * pause animation, physics integration, and attack-state advancement
 * for this many fixed steps — the canonical "hit-stop / hitlag" effect
 * that gives heavy hits visual weight and locks the attacker out of
 * stringing inputs into the freeze.
 *
 * Tier mapping (from the hit-feel research):
 *   - damage ≤ {@link HITLAG_LIGHT_DAMAGE_THRESHOLD}  → {@link HITLAG_LIGHT_FRAMES}
 *   - damage ≤ {@link HITLAG_MEDIUM_DAMAGE_THRESHOLD} → {@link HITLAG_MEDIUM_FRAMES}
 *   - else                                            → {@link HITLAG_HEAVY_FRAMES}
 *
 * Bonuses (additive, applied after the base tier):
 *   - sweet-spot hit                              → +{@link HITLAG_SWEET_SPOT_BONUS_FRAMES}
 *   - target.percent ≥ {@link HITLAG_HIGH_PERCENT_THRESHOLD} → +{@link HITLAG_HIGH_PERCENT_BONUS_FRAMES}
 *
 * Result is hard-capped at {@link HITLAG_MAX_FRAMES} so stacked
 * bonuses can't make a hit feel sluggish.
 *
 * Pure: same inputs always yield the same integer output.
 */
export function computeHitlag(input: HitlagInput): number {
  let frames: number;
  if (input.damage <= HITLAG_LIGHT_DAMAGE_THRESHOLD) {
    frames = HITLAG_LIGHT_FRAMES;
  } else if (input.damage <= HITLAG_MEDIUM_DAMAGE_THRESHOLD) {
    frames = HITLAG_MEDIUM_FRAMES;
  } else {
    frames = HITLAG_HEAVY_FRAMES;
  }
  if (input.sweetSpot) {
    frames += HITLAG_SWEET_SPOT_BONUS_FRAMES;
  }
  if (input.targetPercent >= HITLAG_HIGH_PERCENT_THRESHOLD) {
    frames += HITLAG_HIGH_PERCENT_BONUS_FRAMES;
  }
  return Math.min(frames, HITLAG_MAX_FRAMES);
}

/** Stick state read at the end of hitlag, used to apply DI to the launch angle. */
export interface DIInput {
  /** Stick X component, expected in `[-1, 1]`. Positive = right. */
  readonly stickX: number;
  /** Stick Y component, expected in `[-1, 1]`. Positive = down (Phaser screen-space). */
  readonly stickY: number;
}

/**
 * Compute the launch angle after applying Directional Influence (DI).
 *
 * DI in Smash works by rotating the launch vector by an amount
 * proportional to how perpendicular the stick is to the launch
 * direction. A stick parallel to the launch (towards or away) does
 * nothing; a stick perpendicular rotates the angle by up to
 * {@link DI_MAX_ROTATION_DEGREES} radians.
 *
 * The signed perpendicular component of stick `(sx, sy)` against
 * launch angle `θ` is:
 *
 *     perp = sy * cos(θ) - sx * sin(θ)
 *
 * which we clamp to `[-1, 1]` (in case the stick magnitude is greater
 * than 1) and multiply by the max rotation. Positive `perp` rotates
 * the launch counter-clockwise (lower angle in radians); the standard
 * Smash visual is that holding "into" the launch tilts it down.
 *
 * The resulting angle is returned in radians, NOT normalized to any
 * particular range — callers can re-derive the velocity via
 * `(magnitude * cos(angle), magnitude * sin(angle))` to get the
 * DI-adjusted vector.
 *
 * Pure: identical `(launchAngle, di)` inputs always yield the same
 * output angle.
 */
export function applyDIToLaunchAngle(
  launchAngle: number,
  di: DIInput,
): number {
  const perpRaw =
    di.stickY * Math.cos(launchAngle) - di.stickX * Math.sin(launchAngle);
  const perp = clamp(perpRaw, -1, 1);
  const maxRotationRad = (DI_MAX_ROTATION_DEGREES * Math.PI) / 180;
  return launchAngle + perp * maxRotationRad;
}

/**
 * Compute the shieldstun frame count for a blocked hit. Defender is
 * locked in their shield (cannot drop, cannot grab out, cannot roll
 * out) for this many fixed steps. The formula keeps shieldstun short
 * (3-8f) on purpose — long blockstun produces sticky neutral and
 * doesn't fit a Smash-flavored party fighter.
 *
 * Formula: `clamp(round(damage * 0.4) + 2, 3, 8)`.
 *
 * Pure: integer input → integer output, no state.
 */
export function computeShieldstun(damage: number): number {
  const raw =
    Math.round(damage * SHIELDSTUN_PER_DAMAGE) + SHIELDSTUN_BASE_FRAMES;
  return clamp(raw, SHIELDSTUN_MIN_FRAMES, SHIELDSTUN_MAX_FRAMES);
}

/** Output of {@link computeScreenShake}. Drives the camera-shake renderer. */
export interface ScreenShakeParams {
  /** Peak displacement in design pixels. The renderer interpolates this towards 0 over `durationFrames`. */
  readonly intensityPx: number;
  /** Duration of the shake in fixed-step frames. Capped at the heavy tier's 9f (≈150 ms at 60 Hz). */
  readonly durationFrames: number;
}

/**
 * Compute screen shake parameters for a confirmed hit. Tiers mirror
 * the hitlag tiers (light / medium / heavy) so the visual punch
 * matches the freeze duration. Capped at 150 ms total — research
 * consensus is that screen shake longer than that reads as glitchy
 * rather than satisfying.
 *
 * Pure: damage in → constants out. The renderer is responsible for
 * the actual camera offset interpolation; this function just selects
 * the tier.
 */
export function computeScreenShake(damage: number): ScreenShakeParams {
  if (damage <= HITLAG_LIGHT_DAMAGE_THRESHOLD) {
    return {
      intensityPx: SHAKE_LIGHT_INTENSITY_PX,
      durationFrames: SHAKE_LIGHT_DURATION_FRAMES,
    };
  }
  if (damage <= HITLAG_MEDIUM_DAMAGE_THRESHOLD) {
    return {
      intensityPx: SHAKE_MEDIUM_INTENSITY_PX,
      durationFrames: SHAKE_MEDIUM_DURATION_FRAMES,
    };
  }
  return {
    intensityPx: SHAKE_HEAVY_INTENSITY_PX,
    durationFrames: SHAKE_HEAVY_DURATION_FRAMES,
  };
}
