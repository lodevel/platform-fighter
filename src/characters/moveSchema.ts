/**
 * Shared move-data schema and base attack system — Sub-AC 1 of AC 60001.
 *
 * Single reusable module that consolidates the *data shapes* and the
 * *pure-function attack state machine* every fighter (Wolf, Cat, Owl,
 * Bear, future roster, AI scripts, replay tooling, debug HUD, balance
 * pass) reads from. Everything in this file is Phaser-free and
 * Matter-free — it can be imported under plain Node and exercised by
 * unit tests with no scene fixtures.
 *
 * What lives here:
 *
 *   1. Hitbox / hurtbox geometry types — the two halves of the
 *      attacker/defender contract:
 *        • `Hitbox`  — sensor region authored on a move; spawned by the
 *                      attacker each `active` frame and tested for
 *                      overlap against opponents' hurtboxes by the
 *                      collision handler.
 *        • `Hurtbox` — region on a fighter's body that can RECEIVE a
 *                      hit. The base case is "the whole body" — a
 *                      single rectangle derived from `CharacterTuning`
 *                      `width`/`height`. Per-move hurtboxes (smaller
 *                      while crouching, intangible while dodging) are
 *                      authored as additional records that override
 *                      the body default for as long as their `frames`
 *                      window is active.
 *
 *   2. Knockback vector schema — `KnockbackSpec` formalises the
 *      `(x, y, scaling)` triple used by every `AttackMove`. Re-exported
 *      from this module so a future damage-handler / AI predictor can
 *      import a single canonical type instead of reaching into
 *      `attacks.ts` for it.
 *
 *   3. Animation-state machine hooks — pure functions for driving an
 *      attack's lifecycle frame-by-frame, plus a hook interface
 *      (`AttackStateHooks`) that emits semantic events when the move
 *      crosses a phase boundary:
 *
 *        startup ──► active ──► recovery ──► done
 *                  │           │           │
 *                  └─ onActive └─ onRecovery
 *                                            └─ onMoveEnd
 *
 *      Hooks are optional and side-effect-only — no return values
 *      affect the math. The animator (M-future), the SFX dispatcher,
 *      and the (existing) `Character` runtime can all subscribe
 *      without coupling to one another. `Character.tickAttack` can
 *      delegate its phase classification to `computeAttackPhase` and
 *      re-emit hook events from the same source of truth.
 *
 *   4. Move duration helpers — `getMoveTotalFrames` (busy window) and
 *      `getMoveLockoutFrames` (busy + cooldown). The press-to-press
 *      lockout is the number AI behaviour trees and balance tooling
 *      most often want; computing it from individual fields each time
 *      is a footgun.
 *
 * Why this module (and not just keep extending `attacks.ts`):
 *
 *   • `attacks.ts` is currently the home of the *Phaser-touching*
 *     hitbox-body factory (`spawnHitbox`/`despawnHitbox`). Adding pure
 *     hurtbox/animation/state-machine code there muddies the seam: the
 *     factory needs `MatterJS.BodyType`, the schema does not. Splitting
 *     the schema out gives Node-only consumers (AI search, tests,
 *     replay tooling) a clean import.
 *
 *   • `Character.ts` already implements the attack state machine
 *     internally with a private `phaseFor` helper. Lifting that helper
 *     into a public, pure function (`computeAttackPhase`) lets:
 *       - AI scripts predict phase transitions without instantiating a
 *         Character ("if I press jab now, when will the hitbox spawn?");
 *       - the (M-future) animator drive sprite frames off the same
 *         classifier the gameplay state machine uses, eliminating any
 *         possibility of an animation/hitbox phase drift;
 *       - unit tests assert phase boundaries without a mock scene.
 *
 *   • The Seed's `move` ontology concept calls out "animation frames
 *     (6-8), hitbox data, damage, knockback, startup/active/recovery
 *     frame counts" as fields of a single move record, AND `matchState`
 *     calls out "current animation state" — implying a typed animation
 *     state name. This module surfaces both with explicit types
 *     (`AttackPhase`, `AnimationFrameSelector`) so consumers don't have
 *     to invent string literals at the use site.
 *
 * Determinism: every helper here is a pure function of integer frame
 * counters and frozen move data. No `Math.random()`, no `Date.now()`,
 * no Matter / Phaser side effects. Identical inputs always produce
 * identical outputs — the property the replay system requires.
 *
 * Backwards compatibility: this module is purely additive. The existing
 * `AttackMove`, `ActiveAttack`, `HitboxPlugin`, `spawnHitbox`,
 * `despawnHitbox`, and `Character`'s private state machine all remain
 * intact and unchanged in semantics. New code (Owl/Bear M2 movesets,
 * the M-future animator, the AI predictor) consumes this module
 * directly; existing code keeps working.
 */

import type { AttackMove, HitboxPlugin } from './attacks';
import type { ChargeSpec } from './chargeSchema';
import type { HitInfo, KnockbackResult } from './combat';

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

/**
 * Geometric description of a hitbox — the *attacking* sensor region a
 * move emits while in its `active` phase. Authored relative to the
 * fighter's centre and "as if facing right"; the runtime mirrors
 * `offsetX` by the attacker's facing on spawn so the same authored
 * record produces the correct sensor when the fighter is facing left.
 *
 * This is the same shape carried in `AttackMove.hitbox` — pulled into
 * a named type so that the (M-future) animator and the (existing)
 * collision handler can declare parameters of type `Hitbox` instead of
 * inlining the structural shape every time.
 */
export interface Hitbox {
  /** Centre X offset from the fighter's body centre, in design pixels. */
  readonly offsetX: number;
  /** Centre Y offset. Negative = above body centre (Phaser screen-space). */
  readonly offsetY: number;
  /** Width in design pixels. */
  readonly width: number;
  /** Height in design pixels. */
  readonly height: number;
}

/**
 * Geometric description of a hurtbox — the *defending* region on a
 * fighter that can RECEIVE a hit. Mirrors the `Hitbox` shape so a
 * single AABB-overlap helper (`hitboxOverlapsHurtbox`) covers both.
 *
 * Default body hurtbox: `Character` ships with a single body-sized
 * hurtbox derived from `CharacterTuning` (width/height). Per-move
 * hurtbox modifications (e.g. shrinking the hurtbox during a smash's
 * windup, an `intangible` window during a dodge) are authored as
 * additional `Hurtbox` records on the move's `hurtboxes?` field; they
 * override the default for the frames their window covers.
 *
 * Determinism note: hurtbox geometry is integer pixels and a
 * `Set<HurtboxFlag>` of frozen flags — never time-dependent. Replays
 * see identical hurtboxes for identical (move, frame) pairs.
 */
export interface Hurtbox {
  /**
   * Stable identifier, unique within a fighter's hurtbox set. The
   * default body hurtbox uses `'body'`; per-move hurtboxes prefix
   * with the move id (e.g. `'wolf.smash.windup'`). The collision
   * handler logs hurtbox ids in damage events so post-match analysis
   * can answer "did Cat's smash trade with Wolf's body or with his
   * windup hurtbox?".
   */
  readonly id: string;
  /** Centre X offset from the body centre, in design pixels. */
  readonly offsetX: number;
  /** Centre Y offset. */
  readonly offsetY: number;
  /** Width in design pixels. */
  readonly width: number;
  /** Height in design pixels. */
  readonly height: number;
  /**
   * If `true`, this hurtbox is **invincible / intangible** for as long
   * as it's active — overlapping hitboxes deal no damage, no
   * knockback, no hitstun. Used by dodge windows, smash super-armour
   * frames, and (M-future) edge-grab i-frames. Defaults to `false`
   * when omitted.
   *
   * Note: this is the per-hurtbox flag. The whole-fighter
   * `Character.isInvincible()` (respawn grace) gates *all* incoming
   * hits regardless of which hurtbox they would have hit; this flag
   * is finer-grained and lets a fighter still be vulnerable on their
   * body while a specific limb is intangible (or vice versa).
   */
  readonly intangible?: boolean;
  /**
   * Optional damage multiplier applied to incoming hits that overlap
   * THIS hurtbox (and no non-multiplied hurtbox). 1.0 = baseline,
   * <1.0 = damage reduction (super-armour shoulder pad), >1.0 =
   * counter-hit weak point. Defaults to 1.0 when omitted.
   *
   * Reserved field — the existing damage handler treats every
   * hurtbox at 1.0× until per-hurtbox multipliers ship; the field
   * exists on the schema so authoring data surfaces (the move-editor
   * tool, balance pass) can write through this contract today.
   */
  readonly damageMultiplier?: number;
}

/**
 * Convenience constructor for the default body-sized hurtbox derived
 * from a fighter's tuning. Used by the (existing) `Character` body
 * factory so the default hurtbox stays in sync with the Matter body
 * dimensions automatically — change `tuning.width` and the hurtbox
 * follows.
 */
export function makeBodyHurtbox(tuning: {
  readonly width: number;
  readonly height: number;
}): Hurtbox {
  return Object.freeze({
    id: 'body',
    offsetX: 0,
    offsetY: 0,
    width: tuning.width,
    height: tuning.height,
  });
}

/**
 * Pure AABB-overlap helper. Both boxes are centre-anchored; `hitbox`
 * is mirrored by `attackerFacing` so the caller can pass the move's
 * authored `Hitbox` directly without pre-mirroring.
 *
 * Returns `true` iff the two AABBs intersect (touching edges count as
 * overlap, matching Matter's behaviour). Useful for AI predictors
 * ("would this jab connect on Cat's current crouch?") and unit tests
 * that need to assert hitbox/hurtbox geometry without a Matter scene.
 */
export function hitboxOverlapsHurtbox(
  attacker: { readonly x: number; readonly y: number },
  hitbox: Hitbox,
  attackerFacing: 1 | -1,
  defender: { readonly x: number; readonly y: number },
  hurtbox: Hurtbox,
): boolean {
  const hcx = attacker.x + hitbox.offsetX * attackerFacing;
  const hcy = attacker.y + hitbox.offsetY;
  const dcx = defender.x + hurtbox.offsetX;
  const dcy = defender.y + hurtbox.offsetY;

  const hHalfW = hitbox.width / 2;
  const hHalfH = hitbox.height / 2;
  const dHalfW = hurtbox.width / 2;
  const dHalfH = hurtbox.height / 2;

  const dx = Math.abs(hcx - dcx);
  const dy = Math.abs(hcy - dcy);

  return dx <= hHalfW + dHalfW && dy <= hHalfH + dHalfH;
}

// ---------------------------------------------------------------------------
// Knockback vector schema
// ---------------------------------------------------------------------------

/**
 * Canonical type name for the `(x, y, scaling)` knockback triple
 * carried on every `AttackMove.knockback`. Exposed as its own type so
 * AI scripts and the move-editor tool can declare parameters of type
 * `KnockbackSpec` instead of restating the structural shape.
 *
 * Semantics (matches `attacks.ts` JSDoc):
 *   - `x`, `y` are the base knockback components in Matter
 *     px-per-step units, authored as if attacking right.
 *   - `scaling` is the per-percent multiplier — at percent `p` the
 *     realised vector magnitude is `(x, y) * (1 + scaling * p)`.
 *
 * The Cartesian (x, y) form is the *storage* convention because it
 * plugs directly into Matter's velocity setter without trig per-frame.
 * The (angle, magnitude) polar form — see {@link KnockbackAngleMagnitude},
 * {@link knockbackToAngleMagnitude}, {@link angleMagnitudeToKnockback} —
 * is the *authoring* convention used by the balance pass and AI
 * predictors that reason in fighting-game-style "launch angle of
 * 45°, base 1.6 KB units, 0.06 growth per percent". Both forms encode
 * the same physical knockback vector; the helpers convert losslessly
 * (modulo IEEE-754 rounding).
 */
export type KnockbackSpec = AttackMove['knockback'];

/**
 * Polar (angle, magnitude) representation of a move's knockback. The
 * Seed's AC 60001 Sub-AC 1 explicitly calls out "knockback angle /
 * magnitude" as the form move tables author against; this is that
 * named type.
 *
 * Semantics:
 *   - `angleDegrees` — launch angle relative to the attacker's facing,
 *     using fighting-game convention: `0°` = horizontal toward facing,
 *     `+90°` = straight up, `±180°` = behind the attacker, `-90°` =
 *     straight down. Range is the standard `[-180, +180]`.
 *
 *     Note: this convention treats *positive* Y as up. The Cartesian
 *     storage form ({@link KnockbackSpec}) uses Phaser/Matter screen-
 *     space where *negative* Y is up. The conversion helpers handle the
 *     sign flip — authoring tools never see the Phaser inversion.
 *
 *   - `magnitude` — base knockback magnitude (the length of the
 *     `(x, y)` vector at 0% damage), in Matter px-per-step units. A
 *     light jab might have magnitude 1.0; a finisher smash is 3-5+.
 *
 *   - `scaling` — per-percent growth multiplier, identical in semantics
 *     to {@link KnockbackSpec}.scaling. The realised launch magnitude
 *     at percent `p` is `magnitude * (1 + scaling * p)`.
 *
 * Determinism: pure data — no `Math.random()`, no time references. Two
 * authoring records with identical `(angle, magnitude, scaling)`
 * triples convert to the same `(x, y, scaling)` Cartesian form on every
 * platform.
 */
export interface KnockbackAngleMagnitude {
  /** Launch angle in degrees, fighting-game convention (positive = up). */
  readonly angleDegrees: number;
  /** Base knockback magnitude at 0% damage, in px-per-step units. */
  readonly magnitude: number;
  /** Per-percent growth multiplier — same as `KnockbackSpec.scaling`. */
  readonly scaling: number;
  /**
   * Optional percent-independent launch floor — same semantics as
   * `KnockbackSpec.baseMagnitude`. Direction-independent scalar: the
   * polar transform only re-expresses the `(x, y)` base vector, so
   * this field rides through both converters untouched. Absent on
   * legacy 3-field specs and stays absent through a round-trip.
   */
  readonly baseMagnitude?: number;
  /**
   * Optional damage-fed growth multiplier — same semantics as
   * `KnockbackSpec.damageGrowth`. Like `baseMagnitude`, a
   * direction-independent scalar unaffected by the polar transform;
   * presence/absence is preserved exactly by both converters.
   */
  readonly damageGrowth?: number;
}

/**
 * Convert a Cartesian-form `KnockbackSpec` (Phaser screen-space `y`
 * negated) to the authoring-friendly polar form. The reverse of
 * {@link angleMagnitudeToKnockback}.
 *
 * Sign convention: the input's `y` is in Phaser/Matter screen space
 * (negative = up), so we negate it before calling `Math.atan2` to
 * produce a "positive-Y-is-up" launch angle. A spec of
 * `{ x: 1, y: -1 }` (horizontal-and-up in screen space) returns
 * `angleDegrees: 45` (up-and-forward in fighting-game convention),
 * not `-45`.
 *
 * The optional Smash-style components (`baseMagnitude`,
 * `damageGrowth`) are direction-independent scalars — the polar
 * transform doesn't touch them. They are copied through verbatim,
 * preserving presence/absence exactly, so legacy 3-field specs
 * round-trip byte-identically (no keys gained).
 *
 * Determinism: `Math.atan2` and `Math.hypot` are IEEE-754 deterministic
 * on every platform Phaser runs on; identical inputs always produce
 * identical outputs.
 */
export function knockbackToAngleMagnitude(
  spec: KnockbackSpec,
): KnockbackAngleMagnitude {
  const angleRadians = Math.atan2(-spec.y, spec.x);
  return {
    angleDegrees: (angleRadians * 180) / Math.PI,
    magnitude: Math.hypot(spec.x, spec.y),
    scaling: spec.scaling,
    // Direction-independent scalars ride through the polar transform
    // untouched. Conditional spreads preserve presence/absence so a
    // legacy 3-field spec converts without gaining keys.
    ...(spec.baseMagnitude !== undefined
      ? { baseMagnitude: spec.baseMagnitude }
      : {}),
    ...(spec.damageGrowth !== undefined
      ? { damageGrowth: spec.damageGrowth }
      : {}),
  };
}

/**
 * Convert an authoring-form `KnockbackAngleMagnitude` to the Cartesian
 * `KnockbackSpec` the runtime stores. The reverse of
 * {@link knockbackToAngleMagnitude}.
 *
 * Sign convention: input `angleDegrees` follows the fighting-game
 * convention (positive = up), output `y` is in Phaser/Matter screen
 * space (negative = up), so the helper negates the sin component.
 * `{ angleDegrees: 45, magnitude: Math.SQRT2 }` returns approximately
 * `{ x: 1, y: -1 }`.
 *
 * Use this in move tables when authoring is more natural in polar
 * form — e.g., `WOLF_SMASH.knockback = angleMagnitudeToKnockback({
 * angleDegrees: 45, magnitude: 4.5, scaling: 0.45 })`.
 *
 * The optional Smash-style components (`baseMagnitude`,
 * `damageGrowth`) are direction-independent scalars copied through
 * verbatim — presence/absence is preserved exactly, mirroring
 * {@link knockbackToAngleMagnitude}.
 *
 * Determinism: pure trig — `Math.sin` / `Math.cos` are IEEE-754
 * deterministic on every Phaser platform.
 */
export function angleMagnitudeToKnockback(
  polar: KnockbackAngleMagnitude,
): KnockbackSpec {
  const angleRadians = (polar.angleDegrees * Math.PI) / 180;
  return {
    x: Math.cos(angleRadians) * polar.magnitude,
    y: -Math.sin(angleRadians) * polar.magnitude,
    scaling: polar.scaling,
    // Mirror of knockbackToAngleMagnitude — direction-independent
    // scalars copy through with presence/absence intact.
    ...(polar.baseMagnitude !== undefined
      ? { baseMagnitude: polar.baseMagnitude }
      : {}),
    ...(polar.damageGrowth !== undefined
      ? { damageGrowth: polar.damageGrowth }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Frame-data schema
// ---------------------------------------------------------------------------

/**
 * Bundled frame timings for a single move — the Seed's AC 60001
 * Sub-AC 1 names this `FrameData`. Carries the four integer
 * frame counters that drive the attack state machine:
 *
 *   ── startup ── active ── recovery ── cooldown ──
 *
 * `AttackMove` already declares these as four sibling fields so
 * existing call sites (`move.startupFrames`, `move.activeFrames`, …)
 * keep working unchanged. This type lifts them into a single object
 * for the use cases that want to pass "the move's timings" as one
 * value:
 *
 *   • Balance-pass tooling — sort moves by `getFrameData(m).startup`,
 *     filter "every move with active <= 3", etc., without restating
 *     the field shape per call site.
 *   • The (later AC) move-editor authoring UI — bind `<input>`s to a
 *     `FrameData` value rather than four sibling fields.
 *   • AI predictors — `predictPhase(frameData, framesElapsed)` reads
 *     a frame-data record without coupling to the full `AttackMove`.
 *
 * Determinism: every value is an integer frame counter — no time-
 * dependent fields. Identical frame data always produces identical
 * phase classifications.
 */
export interface FrameData {
  /** Frames between input press and hitbox going active. */
  readonly startup: number;
  /** Frames the hitbox is live and can connect. */
  readonly active: number;
  /** Frames the fighter is committed after the hitbox ends. */
  readonly recovery: number;
  /** Frames after the move ends before any attack can start again. */
  readonly cooldown: number;
}

/**
 * Lift the four frame fields of an `AttackMove` into a `FrameData`
 * record. Pure projection — no allocation surprises, no field
 * synthesis. The reverse of authoring move data via
 * `{ ...frameData, startupFrames: frameData.startup, ... }` (which the
 * (later AC) move-editor will use).
 */
export function getFrameData(move: AttackMove): FrameData {
  return {
    startup: move.startupFrames,
    active: move.activeFrames,
    recovery: move.recoveryFrames,
    cooldown: move.cooldownFrames,
  };
}

/**
 * Sum of `startup + active + recovery` from a {@link FrameData} —
 * the move's "busy window" expressed in pure frame-data form. Mirrors
 * {@link getMoveBusyFrames} but consumes the lifted record.
 *
 * Useful when reasoning about timings from a frame-data record alone
 * (balance tools, hypothetical "what if I shifted recovery by 2?"
 * AI search) without needing the full `AttackMove`.
 */
export function getFrameDataBusy(frameData: FrameData): number {
  return frameData.startup + frameData.active + frameData.recovery;
}

/**
 * Sum of `busy + cooldown` from a {@link FrameData} — the press-to-press
 * lockout in pure frame-data form. Mirrors {@link getMoveLockoutFrames}.
 */
export function getFrameDataLockout(frameData: FrameData): number {
  return getFrameDataBusy(frameData) + frameData.cooldown;
}

// ---------------------------------------------------------------------------
// Move-level animation hooks
// ---------------------------------------------------------------------------

/**
 * Coarse animation state name for the four phases of an attack's
 * lifecycle. Matches the Seed ontology field
 * `matchState.current animation state`.
 *
 * The classifier `computeAttackPhase` returns one of these for any
 * given `framesElapsed` against an `AttackMove`'s frame budget.
 */
export type AttackPhase = 'startup' | 'active' | 'recovery' | 'done';

/**
 * Subset of `AttackPhase` excluding the terminal `'done'` — useful
 * when typing a "currently in flight" state where `'done'` would be
 * a contradiction (the move has ended; there is no live phase).
 */
export type LiveAttackPhase = Exclude<AttackPhase, 'done'>;

/**
 * Pick the animation frame index within a move's per-phase animation
 * timeline. Each move ships with 6-8 art frames per the Seed
 * constraint; this helper maps a fixed-step `framesElapsed` to the
 * art-frame index the renderer should display, so the animator and
 * the gameplay state machine stay in lockstep without each
 * re-implementing the math.
 *
 * The mapping is the canonical "stretch the active art frames over
 * the active gameplay window" approach: if a move has `n` art frames
 * for phase `P` and phase `P` lasts `f` gameplay frames, art frame
 * `i` shows during gameplay frames `[i * f / n, (i+1) * f / n)`.
 *
 * Defaults: when a move declares no `animation` block, this falls
 * back to a single-frame-per-phase mapping (idx 0 throughout each
 * phase) so the renderer can always ask for an index without
 * branching on whether a move opts in.
 */
export interface AnimationFrameSelector {
  /** The current phase. */
  readonly phase: AttackPhase;
  /** 0-based animation frame index for the renderer. */
  readonly artFrameIndex: number;
}

/**
 * Optional per-phase animation frame counts authored on a move. When
 * omitted, the renderer treats the move as having a single art frame
 * per phase. Total art frames across phases should land in the
 * Seed's "6-8 frames per move" range when fully authored, but this
 * module does NOT enforce that range — that's a balance / asset
 * concern, not a schema invariant.
 */
export interface MoveAnimation {
  /** Number of art frames covering the startup phase. ≥ 1. */
  readonly startupFrames: number;
  /** Number of art frames covering the active phase. ≥ 1. */
  readonly activeFrames: number;
  /** Number of art frames covering the recovery phase. ≥ 1. */
  readonly recoveryFrames: number;
}

/**
 * Per-move (rather than per-character) optional animation block.
 * Movesets that haven't been animated yet (Owl, Bear in M1) simply
 * omit this; the renderer falls back to the single-frame-per-phase
 * default and the gameplay loop keeps running unaffected.
 */
export interface AttackMoveWithAnimation extends AttackMove {
  readonly animation?: MoveAnimation;
  /**
   * Optional per-move hurtbox modifiers — replace the body-default
   * hurtbox set for the frame windows declared. Used by:
   *   • Dodge moves (intangible window during the active phase).
   *   • Crouching tilts (smaller body-front hurtbox during startup).
   *   • Smash super-armour (extra hurtbox with damageMultiplier < 1
   *     during the windup).
   *
   * Each entry can declare which `phase` it covers; entries with no
   * `phase` are active for the entire move. The runtime intersects
   * these with the body default each frame to produce the live
   * hurtbox set.
   *
   * Reserved: the existing collision handler treats the body
   * hurtbox as the only one in M1; this field exists on the schema
   * so the dodge/edge-grab/super-armour ACs can author through a
   * stable contract from day one.
   */
  readonly hurtboxModifiers?: ReadonlyArray<MoveHurtboxModifier>;
  /**
   * Optional JAB-COMBO link. Present on the non-final stages of a jab
   * string (jab1 → jab2 → … → finisher): pressing attack again once the
   * current stage's hitbox has come out advances to `nextId` instead of
   * restarting jab1. The final stage (rapid / finisher) omits this, so
   * the chain terminates. Absent on every non-jab move and on single-jab
   * rosters — so the chain runtime is a no-op unless a fighter authors it.
   */
  readonly jabChain?: {
    /** Move id of the next stage in the string (must be a registered move). */
    readonly nextId: string;
    /**
     * Earliest `framesElapsed` at which a re-press may advance the chain.
     * Defaults to this stage's `startupFrames` (advance once the hitbox is
     * out) — pressing during pure startup is ignored so a single mash
     * can't skip the active window.
     */
    readonly advanceWindowStart?: number;
  };
  /**
   * Optional CHARGE ramp. On a SMASH move it makes the smash hold-to-charge:
   * pressing the smash input enters a charge stance (rooted), and releasing
   * (or hitting `maxChargeFrames`) fires the smash with damage + knockback
   * lerped between the spec's `min*`/`max*` endpoints by the held-frame
   * count. Absent → the smash fires instantly at its authored values
   * (backward-compatible). Reuses the same {@link ChargeSpec} ramp + spawn
   * lerp as the Samus-style neutral-special cannon.
   */
  readonly charge?: ChargeSpec;
}

/**
 * Single per-move hurtbox override. Applied on top of the default
 * body hurtbox for the frames the entry covers.
 *
 * Resolution semantics (Sub-AC 2 of AC 10002 — runtime application):
 *
 *   • If `phase` is `undefined`, the modifier is active for the entire
 *     move (every live phase).
 *   • If `phase` is a single `LiveAttackPhase`, the modifier is active
 *     only when the move is in that phase.
 *   • If `phase` is an array, the modifier is active when the move is
 *     in any of the listed phases.
 *   • Outside those windows the body-default hurtbox applies.
 *
 * When multiple modifiers match the live phase, all matching modifiers
 * stack — the live hurtbox set is the union of the body default (when
 * `replaceBody` is `false` / omitted on every modifier) and every
 * matching modifier's `hurtbox`. A modifier with `replaceBody: true`
 * suppresses the body default for the frames it covers — used by dodge
 * moves to make the whole fighter intangible without leaving a
 * still-vulnerable body hurtbox in the live set.
 */
export interface MoveHurtboxModifier {
  /** Phase(s) this modifier is active for; `undefined` = whole move. */
  readonly phase?: LiveAttackPhase | ReadonlyArray<LiveAttackPhase>;
  /** Replacement hurtbox geometry / flags. */
  readonly hurtbox: Hurtbox;
  /**
   * If `true`, the body-default hurtbox is dropped from the live
   * set for as long as this modifier is active. Used by full-body
   * intangible windows (dodge, ledge i-frames declared as a
   * per-move modifier) where leaving the default body hurtbox in the
   * live set would partially defeat the modifier.
   *
   * Defaults to `false` — additive layering.
   */
  readonly replaceBody?: boolean;
}

// ---------------------------------------------------------------------------
// Hurtbox runtime resolution — Sub-AC 2 of AC 10002
//
// Pure helpers that map (body default + move modifiers + framesElapsed)
// to the live hurtbox set the damage handler should consult. Lives
// here (Phaser-free) so the (existing) `Character.getActiveHurtboxes`
// accessor and unit tests can both share one source of truth.
// ---------------------------------------------------------------------------

/**
 * True iff `modifier.phase` covers `phase`. Pure helper — the resolution
 * rule is:
 *
 *   • `phase` undefined            → active for every live phase
 *   • `phase` single LiveAttackPhase → active only on that phase
 *   • `phase` array of phases       → active on any listed phase
 *
 * Lifted into a public helper so AI predictors and balance tooling can
 * answer "is modifier M active during phase P?" without re-implementing
 * the rule.
 */
export function isHurtboxModifierActive(
  modifier: MoveHurtboxModifier,
  phase: LiveAttackPhase,
): boolean {
  if (modifier.phase === undefined) return true;
  if (typeof modifier.phase === 'string') return modifier.phase === phase;
  return modifier.phase.includes(phase);
}

/**
 * Compose the live hurtbox set for a fighter from the body default and
 * the active move's per-frame modifiers.
 *
 *   • No active move (or move ended / `framesElapsed` past `done`):
 *     returns `[bodyHurtbox]`.
 *   • Move active but no modifiers match the current phase: returns
 *     `[bodyHurtbox]`.
 *   • Modifiers match: returns the body default plus every matching
 *     modifier's hurtbox, with the body default suppressed when any
 *     matching modifier sets `replaceBody: true`.
 *
 * The returned array preserves authoring order of modifiers, with the
 * body default (if present) listed first. The damage handler consumes
 * the array as a set — order doesn't matter for the
 * intangible-trumps-everything rule, but stable ordering keeps tests
 * and replay logs deterministic.
 *
 * Determinism: every output is a pure function of the inputs. No
 * `Math.random()`, no allocations of mutable state — the returned
 * array is built fresh per call so callers can mutate it for further
 * filtering without disturbing the cached body default.
 */
export function selectActiveHurtboxes(
  bodyHurtbox: Hurtbox,
  move: AttackMoveWithAnimation | null | undefined,
  framesElapsed: number,
): ReadonlyArray<Hurtbox> {
  if (!move) return [bodyHurtbox];
  const phase = computeAttackPhase(framesElapsed, move);
  if (phase === 'done') return [bodyHurtbox];

  const mods = move.hurtboxModifiers;
  if (!mods || mods.length === 0) return [bodyHurtbox];

  const matched: Hurtbox[] = [];
  let suppressBody = false;
  for (const m of mods) {
    if (!isHurtboxModifierActive(m, phase)) continue;
    matched.push(m.hurtbox);
    if (m.replaceBody === true) suppressBody = true;
  }
  if (matched.length === 0) return [bodyHurtbox];
  if (suppressBody) return matched;
  return [bodyHurtbox, ...matched];
}

/**
 * True iff every hurtbox in the set is `intangible`. Used by the
 * damage handler to short-circuit the hit application path: an
 * incoming hit that lands on a fighter whose every live hurtbox is
 * intangible deals no damage, no knockback, no hitstun.
 *
 * Why "every" and not "any":
 *
 *   • A fighter with both a body hurtbox AND an intangible super-armour
 *     limb is still hittable on the body — the limb only protects what
 *     it covers. Reading the per-overlap geometry to decide which
 *     specific hurtbox the hitbox touched would require Matter pair
 *     normals; M1 doesn't have that fidelity, so the conservative rule
 *     is "treat the hit as landed on the body unless every hurtbox is
 *     intangible." The `replaceBody: true` modifier escape hatch lets
 *     authors of full-body intangible windows (dodge) still get the
 *     all-intangible result they need.
 *
 *   • The empty set is treated as NOT all-intangible (defensive — the
 *     caller shouldn't be querying when there's no hurtbox at all, but
 *     returning `false` keeps the hit landing under the existing
 *     contract).
 */
export function isAllHurtboxesIntangible(
  hurtboxes: ReadonlyArray<Hurtbox>,
): boolean {
  if (hurtboxes.length === 0) return false;
  for (const h of hurtboxes) {
    if (h.intangible !== true) return false;
  }
  return true;
}

/**
 * Resolve the damage multiplier the live hurtbox set applies to an
 * incoming hit. Returns the MAXIMUM `damageMultiplier` across the
 * non-intangible hurtboxes in the set, defaulting to 1.0 when no
 * multiplier is declared.
 *
 * Why "max":
 *
 *   • Counter-hit weak points (multiplier > 1) should always honour
 *     their bonus when the geometry can't resolve which specific
 *     hurtbox the hitbox touched — choosing the max means the worst
 *     case for the defender is the worst case the move table actually
 *     declares. A defender who wants to author a damage-reducing
 *     super-armour shoulder (multiplier < 1) should pair it with
 *     `replaceBody: true` so the body default isn't pulling the live
 *     set's max back up to 1.0.
 *
 *   • Intangible hurtboxes are skipped — they short-circuit via
 *     {@link isAllHurtboxesIntangible} BEFORE this helper runs in the
 *     damage path, so this helper need only consider the tangible
 *     subset.
 *
 * Determinism: pure projection over the set. Identical sets always
 * return the same multiplier.
 */
export function resolveHurtboxDamageMultiplier(
  hurtboxes: ReadonlyArray<Hurtbox>,
): number {
  let max = 1;
  let sawTangible = false;
  for (const h of hurtboxes) {
    if (h.intangible === true) continue;
    sawTangible = true;
    const m = h.damageMultiplier;
    if (typeof m === 'number' && Number.isFinite(m) && m > max) max = m;
  }
  // No tangible hurtbox → caller should have been routed to the
  // intangible short-circuit. Return 1.0 defensively.
  if (!sawTangible) return 1;
  return max;
}

// ---------------------------------------------------------------------------
// Attack state machine — pure functions
// ---------------------------------------------------------------------------

/**
 * Total "busy" frames a move occupies — startup + active + recovery.
 * The fighter is committed (no movement override, no new attack press)
 * for this many frames after the press frame.
 */
export function getMoveBusyFrames(move: AttackMove): number {
  return move.startupFrames + move.activeFrames + move.recoveryFrames;
}

/**
 * Total press-to-press lockout — busy + cooldown. The earliest the
 * fighter can press another attack after the press frame. Convenience
 * helper for AI behaviour trees ("how long until I can attack again?")
 * and balance tooling ("rank moves by lockout to find the spammable
 * ones").
 */
export function getMoveLockoutFrames(move: AttackMove): number {
  return getMoveBusyFrames(move) + move.cooldownFrames;
}

/**
 * Pure phase classifier. Given a frame counter `framesElapsed` (0 on
 * the press frame itself) and a move definition, returns the phase
 * the move is currently in.
 *
 *   startup phase: f in [0, startupFrames)        → length = startupFrames
 *   active  phase: f in [startupFrames, +active)  → length = activeFrames
 *   recovery     : f in [..., busyTotal)          → length = recoveryFrames
 *   done         : f >= busyTotal                  → fighter is free again
 *
 * This is the same exclusive-boundary contract used by `Character`'s
 * private `phaseFor`. Lifting it into a public pure function lets
 * other code (animator, AI predictor, replay tooling) classify a frame
 * without cracking open the Character class.
 *
 * Negative `framesElapsed` is treated as `'startup'` defensively (the
 * frame-zero press has elapsed=0, never negative; but a buggy caller
 * that hands -1 should still get a sensible answer).
 */
export function computeAttackPhase(
  framesElapsed: number,
  move: AttackMove,
): AttackPhase {
  if (framesElapsed < move.startupFrames) return 'startup';
  if (framesElapsed < move.startupFrames + move.activeFrames) return 'active';
  if (framesElapsed < getMoveBusyFrames(move)) return 'recovery';
  return 'done';
}

/**
 * Compute the animation frame the renderer should display for a given
 * gameplay frame. Falls back to single-frame-per-phase (idx 0) when
 * the move declares no `animation` block.
 */
export function selectAnimationFrame(
  framesElapsed: number,
  move: AttackMoveWithAnimation,
): AnimationFrameSelector {
  const phase = computeAttackPhase(framesElapsed, move);
  if (phase === 'done') {
    return { phase, artFrameIndex: 0 };
  }
  const anim = move.animation;
  if (!anim) {
    return { phase, artFrameIndex: 0 };
  }

  let phaseStartFrame: number;
  let phaseLengthFrames: number;
  let artCount: number;
  if (phase === 'startup') {
    phaseStartFrame = 0;
    phaseLengthFrames = move.startupFrames;
    artCount = anim.startupFrames;
  } else if (phase === 'active') {
    phaseStartFrame = move.startupFrames;
    phaseLengthFrames = move.activeFrames;
    artCount = anim.activeFrames;
  } else {
    phaseStartFrame = move.startupFrames + move.activeFrames;
    phaseLengthFrames = move.recoveryFrames;
    artCount = anim.recoveryFrames;
  }

  if (artCount <= 1 || phaseLengthFrames <= 0) {
    return { phase, artFrameIndex: 0 };
  }

  const within = framesElapsed - phaseStartFrame;
  // Math.floor((within / phaseLengthFrames) * artCount), but clamped to
  // [0, artCount-1] for safety against the inclusive boundary frame.
  const raw = Math.floor((within * artCount) / phaseLengthFrames);
  const clamped = Math.max(0, Math.min(artCount - 1, raw));
  return { phase, artFrameIndex: clamped };
}

/**
 * Hook surface for the attack state machine. Every callback is
 * optional and side-effect-only — return values are ignored. Hooks
 * fire on the *frame the transition happens*, after the frame counter
 * has been incremented to the new value.
 *
 * Subscribers (animator, SFX dispatcher, particle spawner, AI
 * scripting) attach their own handler bag and let the runtime drive
 * them via {@link advanceAttackState}. Multiple subscribers can be
 * composed via `composeAttackStateHooks`.
 *
 * Hooks fire in this order at a transition frame:
 *   1. `onPhaseExit(prevPhase)` — last; phase that's ending
 *   2. `onHitboxDespawn(...)`   — when leaving the active phase
 *   3. `onHitboxSpawn(...)`     — when entering the active phase
 *   4. `onPhaseEnter(newPhase)` — first; phase that's starting
 *   5. `onMoveEnd(...)`         — only when newPhase === 'done'
 *
 * (Despawn fires before spawn so a single-frame `active` phase that
 * jumps straight from active→active wouldn't double-spawn — but the
 * canonical lifecycle never does that; in practice the despawn fires
 * on active→recovery and the spawn fires on startup→active a frame
 * earlier, so the order only matters for defensive composition.)
 */
export interface AttackStateHooks {
  /**
   * Fires on the frame a new phase begins. Useful for swapping the
   * animation timeline or spawning a startup VFX.
   */
  readonly onPhaseEnter?: (phase: LiveAttackPhase, ctx: AttackStateContext) => void;
  /**
   * Fires on the frame the phase the fighter just left was active in
   * (i.e. one tick before `onPhaseEnter` of the next phase). Useful
   * for SFX that should land on the BEAT of the transition rather
   * than the new phase's first art frame.
   */
  readonly onPhaseExit?: (phase: LiveAttackPhase, ctx: AttackStateContext) => void;
  /** Fires when the move enters its `active` phase (hitbox should appear). */
  readonly onHitboxSpawn?: (move: AttackMove, ctx: AttackStateContext) => void;
  /** Fires when the move leaves its `active` phase (hitbox should despawn). */
  readonly onHitboxDespawn?: (move: AttackMove, ctx: AttackStateContext) => void;
  /**
   * Fires once on the frame the move terminates (recovery → done).
   * The fighter is free to act on the *next* frame; this hook lets
   * subscribers latch a "move just finished" state for the trailing
   * frame's animation cleanup.
   */
  readonly onMoveEnd?: (move: AttackMove, ctx: AttackStateContext) => void;
}

/**
 * Context passed to every hook. Carries the attacker identity and
 * the live `framesElapsed` at the moment of the transition.
 */
export interface AttackStateContext {
  /** Stable id of the fighter executing the move. */
  readonly attackerId: string;
  /** Move definition currently in flight. */
  readonly move: AttackMove;
  /** Frame counter at the moment the hook fired. */
  readonly framesElapsed: number;
  /** Attacker's facing direction at move start. */
  readonly facing: 1 | -1;
}

/**
 * Compose a sequence of hook bags into a single combined bag. Hooks
 * fire in array order. Lets multiple subscribers (animator + SFX
 * dispatcher + AI scripting) all observe the same state machine
 * without forcing the runtime to track an array internally.
 */
export function composeAttackStateHooks(
  ...bags: ReadonlyArray<AttackStateHooks | undefined>
): AttackStateHooks {
  const present = bags.filter((b): b is AttackStateHooks => b !== undefined);
  if (present.length === 0) return {};
  const first = present[0];
  if (present.length === 1 && first !== undefined) return first;
  return {
    onPhaseEnter(phase, ctx) {
      for (const b of present) b.onPhaseEnter?.(phase, ctx);
    },
    onPhaseExit(phase, ctx) {
      for (const b of present) b.onPhaseExit?.(phase, ctx);
    },
    onHitboxSpawn(move, ctx) {
      for (const b of present) b.onHitboxSpawn?.(move, ctx);
    },
    onHitboxDespawn(move, ctx) {
      for (const b of present) b.onHitboxDespawn?.(move, ctx);
    },
    onMoveEnd(move, ctx) {
      for (const b of present) b.onMoveEnd?.(move, ctx);
    },
  };
}

/**
 * Result of a single fixed-step advance of the attack state machine.
 * Pure data — the caller decides what to do with it (mutate runtime
 * state, drive an animator, log a replay event).
 */
export interface AttackStateStep {
  /** Phase before the advance. */
  readonly prevPhase: AttackPhase;
  /** Phase after the advance. */
  readonly nextPhase: AttackPhase;
  /** Frame counter after the advance. */
  readonly framesElapsed: number;
  /** True iff the active phase began this step (startup → active). */
  readonly didEnterActive: boolean;
  /** True iff the active phase ended this step (active → !active). */
  readonly didExitActive: boolean;
  /** True iff the move terminated this step (was busy → done). */
  readonly didEnd: boolean;
}

/**
 * Advance the attack state machine by one fixed step and emit any
 * boundary hooks that fire as a result. Pure with respect to the
 * inputs (no global state, no `Math.random`, no wall-clock); side
 * effects come exclusively from the user-supplied `hooks` callbacks.
 *
 * Contract:
 *   • `framesElapsed` is the value BEFORE this step. The function
 *     returns the post-step `framesElapsed = framesElapsed + 1`.
 *   • Hooks fire in the order documented on {@link AttackStateHooks}.
 *   • If `prevPhase === 'done'` already, the function is a no-op
 *     (returns `nextPhase === 'done'` with no hooks fired). Calling
 *     `advanceAttackState` after the move ended is a defensive
 *     contract, not a bug.
 */
export function advanceAttackState(
  attackerId: string,
  facing: 1 | -1,
  move: AttackMove,
  framesElapsed: number,
  hooks?: AttackStateHooks,
): AttackStateStep {
  const prevPhase = computeAttackPhase(framesElapsed, move);
  if (prevPhase === 'done') {
    return {
      prevPhase,
      nextPhase: 'done',
      framesElapsed,
      didEnterActive: false,
      didExitActive: false,
      didEnd: false,
    };
  }
  const nextFrames = framesElapsed + 1;
  const nextPhase = computeAttackPhase(nextFrames, move);

  // prevPhase is one of 'startup' | 'active' | 'recovery' here — the
  // 'done' case already returned above. Treat it as LiveAttackPhase
  // implicitly.
  const livePrevPhase = prevPhase as LiveAttackPhase;
  const didEnterActive = livePrevPhase !== 'active' && nextPhase === 'active';
  const didExitActive = livePrevPhase === 'active' && nextPhase !== 'active';
  const didEnd = nextPhase === 'done';

  if (hooks && livePrevPhase !== nextPhase) {
    const ctx: AttackStateContext = {
      attackerId,
      move,
      framesElapsed: nextFrames,
      facing,
    };
    // Order documented on AttackStateHooks JSDoc.
    hooks.onPhaseExit?.(livePrevPhase, ctx);
    if (didExitActive) {
      hooks.onHitboxDespawn?.(move, ctx);
    }
    if (didEnterActive) {
      hooks.onHitboxSpawn?.(move, ctx);
    }
    if (nextPhase !== 'done') {
      hooks.onPhaseEnter?.(nextPhase as LiveAttackPhase, ctx);
    }
    if (didEnd) {
      hooks.onMoveEnd?.(move, ctx);
    }
  }

  return {
    prevPhase,
    nextPhase,
    framesElapsed: nextFrames,
    didEnterActive,
    didExitActive,
    didEnd,
  };
}

// ---------------------------------------------------------------------------
// Re-exports — single place for consumers to import the schema
// ---------------------------------------------------------------------------

/**
 * Convenience re-exports so a consumer (AI predictor, balance tool,
 * future move-editor) can import everything they need from one path:
 *
 *   import {
 *     AttackMove, HitInfo, KnockbackResult, KnockbackSpec,
 *     KnockbackAngleMagnitude, knockbackToAngleMagnitude,
 *     angleMagnitudeToKnockback, FrameData, getFrameData,
 *     Hitbox, Hurtbox, AttackPhase, computeAttackPhase,
 *     advanceAttackState, getMoveBusyFrames, getMoveLockoutFrames,
 *   } from './characters/moveSchema';
 *
 * `AttackMove`, `HitInfo`, `KnockbackResult`, `HitboxPlugin` continue
 * to live in their original modules (`attacks.ts`, `combat.ts`) — this
 * file just lifts the names so callers don't have to know which.
 */
export type { AttackMove, HitboxPlugin, HitInfo, KnockbackResult };
