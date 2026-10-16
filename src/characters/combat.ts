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
 *   realised_kb = base_kb * (1 + scaling * percent * KNOCKBACK_PERCENT_TEMPER)
 *                 * (BASELINE_MASS / target_mass)
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
import { computeReferenceKnockback, type ReferenceKnockbackSpec } from './referenceKnockback';

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
 * Global percent-growth temper — the single balance lever between
 * "authored move scaling" and "realised launch growth".
 *
 * The per-move `scaling` values were authored against the original
 * formula where `multiplier = 1 + scaling · percent` — which explodes
 * at Smash-like percents (a 0.4-scaling smash at 100 % yields a 41×
 * multiplier ≈ 175 px/step: across the blast zone in two frames).
 * Playtest feedback: "it's very easy to send an enemy flying — in
 * Smash you need serious damage before base attacks launch."
 *
 * Tempering the percent term globally (rather than re-authoring every
 * move record + JSON mirror) keeps all RELATIVE balance intact —
 * smashes still out-scale jabs by the same ratio at every percent —
 * while bringing absolute kill thresholds into the Smash band.
 * Authored `baseMagnitude` floors are deliberately NOT tempered (they
 * are percent-independent by design — this is what keeps a Falcon-
 * Punch-style move a strong LOW-percent killer while ordinary smashes
 * need real damage first).
 *
 * This is the existing authored balance value, not a conversion from
 * Ultimate knockback units. Historical KO thresholds measured before
 * launch decay are not valid for the current Matter trajectory model.
 * Current unit/trajectory evidence lives in
 * `docs/review/2026-09-09/combat-physics-followup.md`.
 *
 * (The hook in `computeKnockback` reads an optional `globalThis.__kbTemper`
 * override first so headless balance sweeps can try values without a
 * recompile; the global is never set in normal play.)
 */
export const KNOCKBACK_PERCENT_TEMPER = 0.09;

/**
 * Frames of hitstun applied per unit of realised knockback magnitude.
 * Tuned so a baseline jab (mag ≈ 1.5) produces ~3 frames before MIN
 * kicks in, while a heavy smash launcher (mag ≈ 15) produces ~30
 * frames (~500 ms — long enough to read but not unbreakably long).
 */
export const HITSTUN_FRAMES_PER_KNOCKBACK_UNIT = 2.0;

/**
 * Per-frame launch-momentum decay in this engine's velocity units.
 *
 * The community SSBU calculator uses speed `knockback * 0.03`, hitstun
 * near `knockback * 0.4`, and speed decay `0.051/frame`. Their normalized
 * product is about 0.68; this engine's `0.34 * 2` matches that ratio.
 * This is a tuning rationale, not a verified conversion between Ultimate
 * distance units and Matter px per 60 Hz step. Gravity, hitstun clamps,
 * stage dimensions, and collision response still change actual travel.
 * Primary implementation: https://github.com/rubendal/SSBU-Calculator/blob/master/js/formulas.js
 */
export const LAUNCH_SPEED_DECAY_PER_FRAME = 0.34;

/** Reduce vector magnitude without changing launch direction or overshooting. */
export function decayLaunchVelocity(
  vector: { readonly x: number; readonly y: number },
  decay: number = LAUNCH_SPEED_DECAY_PER_FRAME,
): { x: number; y: number } {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude === 0) return { x: 0, y: 0 };
  const amount = Number.isFinite(decay) ? Math.max(0, decay) : 0;
  const nextMagnitude = Math.max(0, magnitude - amount);
  const scale = nextMagnitude / magnitude;
  return { x: vector.x * scale, y: vector.y * scale };
}

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
// Runtime hitlag follows the pinned Ultimate calculator below. Legacy
// tier constants remain exported for compatibility and screen feedback;
// they no longer choose a contact's freeze duration or add bonuses.
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
/** Ordinary Ultimate hitlag cap in fixed simulation steps. */
export const HITLAG_MAX_FRAMES = 30;

/**
 * Ultimate DI parameter in radians, applied only to eligible tumble launches.
 * Sources: rubendal/SSBU-Calculator js/formulas.js (DI), and HDR's documented
 * Ultimate-to-HDR change from 9.74 degrees to 18 degrees:
 * https://hdr-development.github.io/hdr-website/engine/di.html
 */
export const DI_MAX_ROTATION_RADIANS = 0.17;
/** Degree view for presentation/debugging; calculation stays in radians. */
export const DI_MAX_ROTATION_DEGREES = DI_MAX_ROTATION_RADIANS * 180 / Math.PI;

/** Constant frames added to shieldstun (defender's locked-in-shield window). */
export const SHIELDSTUN_BASE_FRAMES = 2;
/** Frames of shieldstun added per point of damage. */
export const SHIELDSTUN_PER_DAMAGE = 0.8;
/** Zero-damage shield contacts have no shieldstun. */
export const SHIELDSTUN_MIN_FRAMES = 0;
/** Safety bound derived from the maximum supported authored damage. */
export const SHIELDSTUN_MAX_FRAMES = 801; // Local 999-damage authoring safety bound, not a native eight-frame cap.

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
  /** Actual incoming contact geometry, when the owning narrowphase provides it. No guessed victim region. */
  readonly combatReceivingRegions?:readonly {readonly id:string;readonly centreWorld:{readonly x:number;readonly y:number}}[];
  readonly combatContactCapsuleWorld?:{readonly start:{readonly x:number;readonly y:number};readonly end:{readonly x:number;readonly y:number};readonly radius:number};
  /** Actual combat credit, supplied by the owning contact/capture consumer.
   * Recoil is an explicit self-cost, not the identity of an explosive owner. */
  readonly combatAttackerSlotIndex?: number | null;
  readonly combatViaSceneResolver?: boolean;
  /** Internal exact active-shield narrowphase receipt, never a move option. */
  readonly combatShieldContact?:{readonly actorGeneration:number;readonly centre:{readonly x:number;readonly y:number};readonly radius:number};
  /** Genuine absolute release from one accepted ordinary/cargo capture.
   * ThrowSpec is not an AttackMove; no synthetic move/sourcePose ID is supplied. */
  readonly combatThrowRelease?:{
    readonly kind:'accepted-capture-throw-release';readonly grabId:string;
    readonly producerPlayerIndex:number;readonly producerGeneration:number;
    readonly targetPlayerIndex:number;readonly targetGeneration:number;
    readonly capture:{readonly captureId:number;readonly targetPlayerIndex:number;readonly targetGeneration:number;
      readonly captorPlayerIndex:number;readonly captorGeneration:number};
    readonly direction:import('./throwSchema').ThrowDirection;readonly cargo:boolean;readonly airborne:boolean;
    readonly throwEntryFrame:number;readonly releaseFrame:number;readonly releaseElapsed:number;
    readonly descriptor:import('./throwSchema').ThrowSpec;
    readonly damageSource:{readonly baseDamage:number;readonly staleMultiplier:number;readonly queueMoveId:string;readonly transactionKey:string};
  };
  readonly combatMoveId?:string;
  readonly combatSourcePoseId?:string|null;
  /** Selected actual narrowphase packet identity, separate from move/phase. */
  readonly combatCollisionHitId?:string|number;
  readonly recoil?: boolean;
  /** Opt-in applied-percent scalar, keeping original baseDamage for native
   * reference growth (Meter Finals for DK/Pika/Link). */
  readonly appliedDamageMultiplier?: number;
  readonly finalSmashRunId?: number;
  readonly nativeAttackHeight?:'low'|'high';
  readonly nativeAttackHeightSource?:import('./attackHeightMetadata').AttackHeightSourceReceipt;
  readonly combatAttackHeightContext?:{readonly attackerRootY:number;readonly victimRootY:number};
  readonly nativeCollisionAttribute?: string;
  readonly nativeForceReaction?: boolean;
  /** Opt-in reference launch modifier, applied after preserved source BKB/KBG.
   * Ordinary native thrown items select the published experimental0.8 rule;
   * explosions and fighter-generated objects leave this absent. */
  readonly referenceKnockbackMultiplier?:number;
  readonly direct?:boolean;
  readonly reflectable?:boolean;readonly absorbable?:boolean;
  readonly statusEffect?:'bury';
  /** Source rank input; omitted explicitly selects tied stocks. */
  readonly attackerMinusVictimStocks?:number;
  /** Native additive probability, evaluated only for eligible grounded hits. */
  readonly tripChance?: number;
  /** Slip attribute (SmashWiki Slip): a guaranteed soft trip on a grounded target, whatever the knockback. */
  readonly slip?: boolean;
  readonly electricCollision?: boolean;
  readonly hitlagProjectile?: boolean;
  /** Extra shield HP damage, excluded from percent, hitlag and shieldstun. */
  readonly shieldDamage?: number;
  readonly shieldSetoffMultiplier?: number;
  /** Airborne angle-367 contact anchor, sampled before hitlag; not fighter data. */
  readonly autolink?: import('./referenceAutolink').ReferenceAutolinkContext;
  readonly hitlagMultiplier?: number;
  readonly sdiMultiplier?: number;
  /** Authored minimum action lockout for separate strikes in one move. */
  readonly minHitstunFrames?: number;
  /** Runtime motion carry, added after DI and excluded from launch decay/tumble. */
  readonly velocityCarry?: { readonly x: number; readonly y: number };
  /** Damage value added to the target's percent meter. */
  readonly damage: number;
  /** Runtime damage before stale-move negation, used by reference growth. */
  readonly baseDamage?: number;
  /** Runtime weighted stale multiplier; damage already includes this factor. */
  readonly staleMultiplier?: number;
  /** Match participant count for the reference hit-stop formula. */
  readonly hitlagPlayers?: number;
  /** Runtime category for ordinary reference shieldstun (detached projectiles win). */
  readonly shieldKind?: ShieldAttackKind;
  /**
   * Base knockback vector at 0 %. `x` is mirrored by `facing` (so a
   * positive `x` always sends the target away from the attacker).
   * `y` is taken as-is — negative values send the target upward.
   * `scaling` is the per-percent multiplier.
   */
  readonly knockback: {
    /** Reference KB units, independent of physical body mass. */
    readonly reference?: ReferenceKnockbackSpec;
    readonly x: number;
    readonly y: number;
    readonly scaling: number;
    /** Optional Smash-style percent-independent launch floor (see `AttackMove.knockback`). */
    readonly baseMagnitude?: number;
    /** Optional Smash-style damage-fed growth term (see `AttackMove.knockback`). */
    readonly damageGrowth?: number;
  };
  /** Attacker's facing direction at the moment the hit was registered. */
  readonly facing: 1 | -1;
  /**
   * Contact metadata for an authored sweet-spot region. The selected
   * hitbox's damage, launch and hitlag multiplier determine the result;
   * this flag does not add a generic hitlag bonus.
   */
  readonly sweetSpot?: boolean;
  /**
   * Optional flag — `true` for an UNBLOCKABLE hit that bypasses a raised
   * shield (the canonical Smash "grabs beat shield" rule). Command grabs
   * (`commandGrab` neutral / `commandDash` side) set this so a shielding
   * victim is still thrown. Falsy / omitted means a normal hit that a
   * raised shield absorbs — every existing call site stays unchanged.
   */
  readonly unblockable?: boolean;
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
  readonly nativeLaunchAngleRadians?:number|null;
  readonly tripped?: boolean;
  /** Uncompressed reference duration, when Character applies tumble speed-up. */
  readonly ordinaryHitstunFrames?: number;
  /** Present only on reference launches; legacy moves retain their calibration. */
  readonly referenceKnockback?: number;
  readonly launchDecayPerFrame?: number;
  readonly tumble?: boolean;
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
 *                           * KNOCKBACK_PERCENT_TEMPER
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
  context: { referenceWeight?: number; grounded?: boolean; multiplier?: number } = {},
): KnockbackResult {
  if (hit.knockback.reference) {
    const result = computeReferenceKnockback(hit.knockback.reference, targetPercent,
      (hit.baseDamage ?? hit.damage) * (1 - (1 - (hit.staleMultiplier ?? 1)) * 0.3),
      context.referenceWeight ?? 100, hit.facing, context.grounded ?? false,
      context.multiplier ?? 1);
    const floor = Number.isFinite(hit.minHitstunFrames) ? Math.max(0, Math.trunc(hit.minHitstunFrames!)) : 0;
    return { ...result, hitstunFrames: Math.max(result.hitstunFrames, floor) };
  }
  const safePercent = clamp(targetPercent, 0, MAX_DAMAGE_PERCENT);
  const safeMass = Math.max(1, targetMass);

  // Smash-style damage-fed growth (the `p·d/20` term of the canonical
  // formula): when a move authors `damageGrowth`, its percent term is
  // amplified by the move's own damage, so heavy hits out-scale light
  // pokes that share the same `scaling`. Absent → 0 → legacy math.
  const damageGrowth = hit.knockback.damageGrowth ?? 0;
  // DEV-ONLY temper override hook for headless balance sweeps — lets a
  // probe try candidate temper values without recompiling. Falls back
  // to the compiled constant in production (the global is never set).
  const temper =
    (globalThis as { __kbTemper?: number }).__kbTemper ??
    KNOCKBACK_PERCENT_TEMPER;
  const growth =
    hit.knockback.scaling *
    safePercent *
    temper *
    (1 + (damageGrowth * hit.damage) / 20);
  const percentMultiplier = 1 + growth;
  const massMultiplier = BASELINE_MASS / safeMass;
  const totalMultiplier = percentMultiplier * massMultiplier;

  // Horizontal direction follows the attacker's facing — knockback always
  // pushes the target away from the source. The base vector is authored
  // as if attacking right (positive x = "outward").
  let vx = hit.knockback.x * totalMultiplier * hit.facing;
  let vy = hit.knockback.y * totalMultiplier;

  // Smash-style BASE knockback (the `+ b` term): a percent-independent
  // launch floor along the move's authored direction. Deliberately NOT
  // scaled by target mass — the canonical formula adds `b` outside the
  // weight term — so a 0 % target still gets shoved (and hit-stunned)
  // meaningfully by moves that author it. Adding along the SAME unit
  // direction preserves the angle-invariance property the suite pins.
  const baseMagnitude = hit.knockback.baseMagnitude ?? 0;
  if (baseMagnitude > 0) {
    const dirLen = Math.hypot(hit.knockback.x, hit.knockback.y);
    if (dirLen > 0) {
      vx += (hit.knockback.x / dirLen) * baseMagnitude * hit.facing;
      vy += (hit.knockback.y / dirLen) * baseMagnitude;
    }
  }

  const magnitude = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);
  const hitstunFloor = Number.isFinite(hit.minHitstunFrames)
    ? clamp(Math.trunc(hit.minHitstunFrames!), 0, MAX_HITSTUN_FRAMES) : 0;
  const hitstunFrames = Math.max(computeHitstun(magnitude), hitstunFloor);

  return {
    vector: { x: vx, y: vy },
    magnitude,
    angle,
    hitstunFrames,
  };
}

/** Scale the whole authored launch, including reference base and growth terms. */
export function scaleKnockbackSpec(knockback: HitInfo['knockback'], factor: number): HitInfo['knockback'] {
  return {
    ...knockback,
    x: knockback.x * factor,
    y: knockback.y * factor,
    ...(knockback.baseMagnitude === undefined ? {} : { baseMagnitude: knockback.baseMagnitude * factor }),
    ...(knockback.reference ? { reference: { ...knockback.reference,
      base: knockback.reference.base * factor, growth: knockback.reference.growth * factor } } : {}),
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
  readonly direct?:boolean;
  readonly reflectable?:boolean;readonly absorbable?:boolean;
  readonly electricCollision?: boolean;
  readonly projectile?: boolean;
  /** Damage value of the move (% added to target). */
  readonly damage: number;
  /** Compatibility input; percent does not independently change reference hitlag. */
  readonly targetPercent: number;
  /** Compatibility input; hitbox multipliers replace the old generic tip bonus. */
  readonly sweetSpot?: boolean;
  /** Authored hitbox hit-stop multiplier; zero disables the freeze. */
  readonly multiplier?: number;
  /** Crouching victims use the reference 0.67 hit-stop multiplier. */
  readonly crouching?: boolean;
  /** Number of match participants, including CPUs (2–8). */
  readonly players?: number;
}

/**
 * Compute the freeze-frame duration for a confirmed hit. Both fighters
 * pause animation, physics integration, and attack-state advancement
 * for this many fixed steps — the canonical "hit-stop / hitlag" effect
 * that gives heavy hits visual weight and locks the attacker out of
 * stringing inputs into the freeze.
 *
 * Ordinary non-electric Ultimate hit-stop: floor((damage * .65 * playerScale
 * + 6) * hitboxMultiplier * crouchMultiplier), capped at 30. Damage includes
 * stale negation but excludes the separate1v1 bonus. Authored electric attributes
 * use the published Ultimate nested-floor equation and projectile player-count
 * exemption; effects are never inferred from art. Source: ssbwiki.com/Hitlag.
 * Source: rubendal/SSBU-Calculator, pinned in the combat-parity handoff.
 *
 * Pure: same inputs always yield the same integer output.
 */
export function computeHitlag(input: HitlagInput): number {
  const damage = Number.isFinite(input.damage) ? Math.max(0, input.damage) : 0;
  const multiplier = Number.isFinite(input.multiplier) ? Math.max(0, input.multiplier!) : 1;
  const players = Math.max(2, Math.min(8, Math.trunc(input.players ?? 2)));
  const playerScale = [1, 0.925, 0.862, 0.8116, 0.77464, 0.752464, 0.75][players - 2] ?? 1;
  if (input.electricCollision) {
    if (damage === 0 || multiplier === 0) return 0;
    const first = Math.min(30, Math.floor((damage * 0.65 + 6) * multiplier * 1.5));
    const countFactor = input.projectile || first <= 10 ? 1 : 1 - (first - 10) / 20 * (1 - playerScale);
    return Math.floor(Math.floor(first * countFactor) * (input.crouching ? 0.67 : 1));
  }
  return Math.min(30, Math.floor((damage * 0.65 * playerScale + 6)
    * multiplier * (input.crouching ? 0.67 : 1)));
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
 * For an eligible tumble launch, this rotates the launch vector by an amount
 * proportional to how perpendicular the stick is to the launch
 * direction. A stick parallel to the launch (towards or away) does
 * nothing; a stick perpendicular rotates the angle by up to
 * {@link DI_MAX_ROTATION_DEGREES} degrees.
 *
 * The signed perpendicular component of stick `(sx, sy)` against
 * launch angle `θ` is:
 *
 *     perp = sy * cos(θ) - sx * sin(θ)
 *
 * after normalizing over-length stick vectors to the unit disc. This gives
 * keyboard diagonals the same response as analog diagonals without losing
 * partial analog magnitude. Positive `perp` increases
 * the angle, rotating clockwise in the screen's positive-down Y axis.
 * Launches within the DI parameter of either horizontal axis cannot be
 * redirected. The caller owns the tumble eligibility check.
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
  const cos = Math.cos(launchAngle);
  const sin = Math.sin(launchAngle);
  // The reference works in launch-relative coordinates. Mirror its
  // near-horizontal exclusion into this engine's signed world-space axes.
  const angleFromHorizontal = Math.atan2(Math.abs(sin), Math.abs(cos));
  if (angleFromHorizontal < DI_MAX_ROTATION_RADIANS) return launchAngle;
  const stickScale = Math.max(1, Math.hypot(di.stickX, di.stickY));
  const perp = (di.stickY * cos - di.stickX * sin) / stickScale;
  return launchAngle + clamp(perp, -1, 1) * DI_MAX_ROTATION_RADIANS;
}

/**
 * Attacker percent at/below which RAGE is inactive (multiplier 1.0).
 * Below this you deal "normal" knockback; the comeback boost only kicks
 * in once you're taking damage.
 */
export const RAGE_START_PERCENT = 35;
/** Attacker percent at/above which RAGE is maxed at {@link RAGE_MAX_MULTIPLIER}. */
export const RAGE_MAX_PERCENT = 150;
/**
 * Peak knockback multiplier from RAGE. At {@link RAGE_MAX_PERCENT}+ the
 * attacker's launches hit this much harder — the Smash "rage" comeback
 * mechanic. Ultimate's ordinary reference range ends at 1.1.
 */
export const RAGE_MAX_MULTIPLIER = 1.1;

/**
 * Compute the RAGE knockback multiplier for an attacker at the given
 * percent. Linear ramp: 1.0 at/below {@link RAGE_START_PERCENT}, climbing
 * to {@link RAGE_MAX_MULTIPLIER} at/above {@link RAGE_MAX_PERCENT}. Scales
 * only KNOCKBACK (not damage), mirroring Smash — a battered fighter sends
 * opponents flying harder, a small persistent comeback lever.
 *
 * Pure: percent in → multiplier out, no state.
 */
export function computeRageMultiplier(attackerPercent: number): number {
  const p = clamp(attackerPercent, 0, MAX_DAMAGE_PERCENT);
  if (p <= RAGE_START_PERCENT) return 1;
  const t = clamp(
    (p - RAGE_START_PERCENT) / (RAGE_MAX_PERCENT - RAGE_START_PERCENT),
    0,
    1,
  );
  return 1 + t * (RAGE_MAX_MULTIPLIER - 1);
}

/** Number of recently-landed moves tracked for stale-move negation. */
export const STALE_QUEUE_SIZE = 9;
/** Penalty for the newest successful use (older slots have smaller weights). */
export const STALE_STEP = 0.09;
/** Floor on the stale multiplier — a fully-staled move still deals this fraction. */
export const STALE_FACTORS = [0.09, 0.08545, 0.07635, 0.0679, 0.05945, 0.05035, 0.04255, 0.03345, 0.025] as const;
export const STALE_MIN_MULTIPLIER = 1 - STALE_FACTORS.reduce((sum, factor) => sum + factor, 0);
export const STALE_FRESH_MULTIPLIER = 1.05;
export interface StaleEntry { readonly moveId: string; readonly shield: boolean }

/**
 * Weighted Ultimate stale queue, newest first. Shield uses contribute 85%
 * of the slot's normal penalty; an absent move gets the 1.05 freshness bonus.
 * Apply the full factor to damage and only 30% of its penalty to the move
 * damage term inside reference knockback. Fixed launches remain independent.
 */
export function computeStaleMultiplier(queue: readonly StaleEntry[] | number, moveId = ''): number {
  // Numeric callers describe consecutive most-recent uses. Runtime callers
  // provide the actual newest-first queue so an old use has a smaller penalty.
  const entries = typeof queue === 'number'
    ? Array.from({ length: Math.trunc(clamp(queue, 0, STALE_QUEUE_SIZE)) }, () => ({ moveId, shield: false }))
    : queue;
  let multiplier = 1;
  let matched = false;
  for (let index = 0; index < Math.min(entries.length, STALE_QUEUE_SIZE); index++) {
    if (entries[index]!.moveId !== moveId) continue;
    matched = true;
    multiplier -= STALE_FACTORS[index]! * (entries[index]!.shield ? 0.85 : 1);
  }
  return matched ? multiplier : STALE_FRESH_MULTIPLIER;
}

/**
 * Ultimate shieldstun (SmashWiki Shieldstun): floor(0.8·d·t·m·p + 2), written
 * floor(d·.8·t·m·p + 3) − 1. `t` is the attack type (smash .725, aerial .33),
 * `m` the hitbox's shieldstun multiplier and `p` the projectile penalty .29,
 * which "does not apply" when `t` or `m` is not 1. Zero-damage contacts do not
 * stun. This excludes shield-poking and perfect-shield advantage.
 *
 * Pure: integer input → integer output, no state.
 */
export type ShieldAttackKind = 'normal' | 'smash' | 'aerial' | 'projectile';
export function computeShieldstun(damage: number, kind: ShieldAttackKind = 'normal', multiplier = 1): number {
  if (!(damage > 0)) return 0;
  const factor = kind === 'projectile' && multiplier !== 1 ? 1
    : { normal: 1, smash: .725, aerial: .33, projectile: .29 }[kind];
  return Math.floor(Math.min(damage, MAX_DAMAGE_PERCENT) * .8 * factor * multiplier + 3) - 1;
}

/** Ordinary shield stop clamps hitbox multipliers below one, then applies .67. */
export function computeShieldHitlag(input: HitlagInput): number {
  // The original testing record explicitly exempts zero-hitlag hitboxes;
  // the calculator's generic below-one clamp omits this exception.
  if (!(input.damage > 0) || input.multiplier === 0) return 0;
  return computeHitlag({ ...input, multiplier: Math.max(1, input.multiplier ?? 1) * .67, crouching: false });
}

/**
 * Extra hit-stop a release parry adds over ordinary shield hitlag. SmashWiki Perfect shield
 * (Ultimate): "For direct non-projectile attacks, the attacker experiences 14 extra frames of
 * hitlag, while the defender experiences 11 extra frames" / indirect non-projectile: attacker 14,
 * defender 2 / direct projectile: "the attacker is not affected, while the defender experiences 8
 * extra frames" / indirect projectile: "the defender experiences 1 frame less". No player-count term.
 */
export const PARRY_EXTRA_HITLAG = Object.freeze({
  direct: Object.freeze({ defender: 11, attacker: 14 }),
  indirect: Object.freeze({ defender: 2, attacker: 14 }),
  directProjectile: Object.freeze({ defender: 8, attacker: 0 }),
  indirectProjectile: Object.freeze({ defender: -1, attacker: 0 }),
});

/**
 * Release-parry hit-stop: ordinary shield hitlag plus {@link PARRY_EXTRA_HITLAG}. A melee hit is
 * direct unless flagged `direct: false`; a projectile is indirect unless flagged `direct: true`.
 * Zero-damage / zero-hitlag contacts freeze nobody. A projectile's owner is never frozen.
 */
export function computeShieldParryHitlag(input: HitlagInput, projectile = false): { defender: number; attacker: number } {
  const base = computeShieldHitlag(input);
  if (base === 0) return { defender: 0, attacker: 0 };
  const extra = projectile
    ? input.direct === true ? PARRY_EXTRA_HITLAG.directProjectile : PARRY_EXTRA_HITLAG.indirectProjectile
    : input.direct === false ? PARRY_EXTRA_HITLAG.indirect : PARRY_EXTRA_HITLAG.direct;
  return { defender: Math.max(0, base + extra.defender), attacker: extra.attacker === 0 ? 0 : base + extra.attacker };
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
