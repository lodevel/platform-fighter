/**
 * Base `Character` class — Sub-AC 1 of AC 201.
 *
 * Owns the Matter.js body that represents a fighter in the world plus
 * the deterministic per-frame movement / jump physics:
 *
 *   • Left / right acceleration with separate ground vs air tuning so
 *     fighters feel snappy on platforms but committed in the air.
 *   • Friction-style damping when no horizontal input is given so the
 *     fighter doesn't ice-skate after letting go of the stick.
 *   • Edge-triggered jump impulse with an N-jumps budget that resets on
 *     landing (default 2 — single + air-jump).
 *   • Robust ground detection driven by Matter collision events. We
 *     count active "support contacts" — contacts where the colliding
 *     platform body is below the character's centre — and treat
 *     `isGrounded()` as `count > 0`. That means walking off a ledge
 *     drops `count` to 0 the moment Matter fires `collisionend`, and
 *     wall bumps / ceiling thumps never count as ground.
 *
 * Why this lives in `characters/` and not `engine/`:
 *
 *   The class is Phaser-touching (it asks the scene for `matter.add`,
 *   `matter.body`, `matter.world.on`). Engine-core stays Phaser-free
 *   so the deterministic loop and replay tooling can run under plain
 *   Node. Tests for this class follow the same mock-scene pattern as
 *   `StageRenderer` and `CameraController` — no jsdom required.
 *
 * What this class deliberately does NOT do (lands in later sub-ACs):
 *
 *   - Hitbox / hurtbox emission (sub-AC for movesets).
 *   - Animation / sprite rendering (sub-AC for visuals).
 *   - Drop-through-platform implementation (sub-AC for inputs; the
 *     `dropThrough` field on `CharacterInput` is reserved here so the
 *     downstream input layer can plug into a stable shape).
 *   - Per-character roster tuning (Wolf bruiser, Cat ninja, etc. — the
 *     M2 roster will subclass or pass tuning overrides).
 *
 * Determinism note: every state mutation in `applyInput` is a pure
 * function of (current body state, input, tuning). No `Math.random()`,
 * no wall-clock reads. Replays that drive identical inputs into a
 * `Character` constructed with identical tuning will produce identical
 * physics state.
 */

import type Phaser from 'phaser';
import type { CharacterId } from '../types';
import {
  CHARACTER_SLOT_BITS,
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
  MAX_FIGHTER_SLOTS,
} from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/StageRenderer';
import {
  type ActiveAttack,
  type AttackMove,
  type HitboxScene,
  despawnHitbox,
  spawnGrabHitbox,
  spawnHitbox,
  updateHitboxPosition,
} from './attacks';
import {
  accumulateDamage,
  applyDIToLaunchAngle,
  computeHitlag,
  computeKnockback,
  STALE_QUEUE_SIZE,
  type HitInfo,
  type KnockbackResult,
} from './combat';
import { getCurrentAnimation, type AnimationState } from './animationState';
import {
  type AttackMoveWithAnimation,
  type Hurtbox,
  makeBodyHurtbox,
  selectActiveHurtboxes,
} from './moveSchema';
import {
  type AerialDirection,
  type AerialMove,
  getLandingLagFrames,
} from './aerialSchema';
import {
  applyShieldHit,
  createShieldState,
  isInShieldstun,
  isShieldBroken,
  isShieldRaised,
  resolveShieldTuning,
  resetShieldState,
  tickShield,
  type ResolvedShieldTuning,
  type ShieldState,
  type ShieldTuning,
} from './shieldState';
import {
  createDodgeState,
  getDodgeSlideVelocity,
  isDodgeActing,
  isDodgeInvincible,
  isDodgeLockingInput,
  isDodgeOnCooldown,
  resetDodgeState,
  resolveDodgeTuning,
  tickDodge,
  type DodgeState,
  type DodgeTuning,
  type ResolvedDodgeTuning,
} from './dodgeState';
import {
  createLocomotionState,
  getLocomotionFacing,
  getLocomotionTargetVx,
  isCrouching,
  isDashing as isLocomotionDashing,
  isPivoting,
  resetLocomotionState,
  resolveLocomotionTuning,
  tickLocomotion,
  type LocomotionState,
  type LocomotionTuning,
  type ResolvedLocomotionTuning,
} from './locomotionState';
import {
  applyGrabConnect,
  applyGrabBreak,
  createGrabState,
  isGrabActing,
  resetGrabState,
  tickGrab,
  type GrabInput,
  type GrabState,
} from './grabState';
import { validateGrabSpec, type GrabSpec } from './grabSchema';
import { getThrowByDirection, type ThrowDirection } from './throwSchema';
import {
  computeChargedDamageFromSpec,
  computeChargedKnockbackFromSpec,
  type ChargeSpec,
} from './chargeSchema';
import {
  classifyGroundedAttack,
  DEFAULT_NEUTRAL_THRESHOLD,
  type GroundedAttackSlots,
} from './groundedAttackInput';
import {
  classifyAerialAttack,
  type AerialAttackSlots,
} from './aerialAttackInput';
import {
  computeBurstVelocity,
  computeTeleportDestination,
  isUpSpecialMove,
  snapStickToOctant,
  type DirectionalJumpUpSpecialMove,
  type MultiHitRisingUpSpecialMove,
  type OctantDirection,
  type TeleportUpSpecialMove,
  type TetherUpSpecialMove,
  type UpSpecialMove,
} from './upSpecialSchema';
import {
  detectLedgeGrab,
  type FighterBounds,
  type LedgeCandidate,
  type LedgeDetectionTuning,
  type LedgeGrabDetection,
} from './ledgeDetection';
// AC 10302 Sub-AC 2 — combat → audio bridge. The {@link CombatSfxSink}
// is a tiny `playSfx(key)` interface satisfied by the production
// {@link AudioManager} and by test recorders alike. The
// {@link mapMoveTypeToSfxKey} helper translates a move's `MoveType`
// bucket into the canonical SFX cache key (`'sfx.jab'`, `'sfx.smash'`,
// …). `emitCombatSfx` wraps each call in a defensive try/catch so an
// audio backend that throws can never corrupt the deterministic physics
// tick.
import {
  emitCombatSfx,
  mapJumpToSfxKey,
  mapMoveTypeToSfxKey,
  type CombatSfxSink,
} from '../audio/combatAudio';
import { ASSET_KEYS } from '../assets/manifest';
import {
  createLedgeHangState,
  isLedgeHangInvincible,
  isLedgeLockingInput,
  resetLedgeHangState,
  resolveLedgeHangTuning,
  tickLedgeHang,
  type LedgeHangInput,
  type LedgeHangState,
  type LedgeHangTuning,
  type LedgeReleaseAction,
  type ResolvedLedgeHangTuning,
} from './ledgeHangState';
import { getFighterMovementProfile } from './fighterMovementProfiles';
import type { AttackMovesetSlotName } from './movesetContract';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-character tuning. All fields are optional — defaults from
 * {@link DEFAULT_CHARACTER_TUNING} apply when omitted. Per-roster
 * overrides (Wolf is faster, Bear is heavier) come in M2.
 *
 * Velocity / accel units are "Matter pixels per fixed step" because
 * the deterministic loop always advances in 16.67 ms (1/60 s)
 * increments — so multiplying by 60 gives you px/sec for tuning
 * intuition (e.g. `maxRunSpeed: 8` ≈ 480 px/s).
 */
export interface CharacterTuning {
  /** Top horizontal speed in px per fixed step (8 ≈ 480 px/s). */
  readonly maxRunSpeed?: number;
  /** Horizontal accel applied per step while grounded. */
  readonly groundAccel?: number;
  /** Horizontal accel applied per step while airborne. */
  readonly airAccel?: number;
  /**
   * Multiplier applied to horizontal velocity each grounded step when
   * no horizontal input is given. 1 = no decel, 0 = full stop. Default
   * 0.78 → ~5 frames (~80 ms) to come to rest from full speed.
   */
  readonly groundDamping?: number;
  /** Multiplier applied to horizontal velocity each airborne step. */
  readonly airDamping?: number;
  /** Initial upward velocity (px per step) on a jump press. */
  readonly jumpImpulse?: number;
  /**
   * Total jumps available between landings. 1 = single jump only;
   * 2 = single + air-jump (default).
   */
  readonly maxJumps?: number;
  /**
   * Extra downward acceleration (px per step²) applied while airborne
   * and falling, on top of global Matter gravity. The Smash-style
   * per-fighter "gravity" stat — see {@link FighterMovementProfile}.
   */
  readonly fallAccel?: number;
  /** Terminal velocity (px per step) while falling normally. */
  readonly maxFallSpeed?: number;
  /**
   * Terminal velocity (px per step) while fast-falling — holding the
   * stick down during a descent snaps vy here until landing.
   */
  readonly fastFallSpeed?: number;
  /**
   * Variable-jump-height cut factor (0..1): releasing jump while
   * rising clamps vy to `jumpImpulse * jumpCutFactor` (short hop).
   * 1 disables the cut.
   */
  readonly jumpCutFactor?: number;
  /** Body width in design pixels. */
  readonly width?: number;
  /** Body height in design pixels. */
  readonly height?: number;
  /**
   * Chamfer radius — softens the body's corners so the fighter doesn't
   * catch on platform ledges. 0 disables.
   */
  readonly chamfer?: number;
  /** Mass override; lets heavier characters resist knockback. */
  readonly mass?: number;
  /**
   * AC 60301 Sub-AC 1 — per-character shield-mechanic tuning. Optional
   * because every roster slot can fall back to the canonical
   * {@link SHIELD_DEFAULTS}; heavier characters (Bear) may opt into a
   * higher `maxHealth` / `breakStunFrames` here in a balance pass.
   */
  readonly shield?: ShieldTuning;
  /**
   * AC 60302 Sub-AC 2 — per-character dodge / roll tuning. Optional
   * because every roster slot can fall back to the canonical
   * {@link DODGE_DEFAULTS}; heavier characters (Bear) may opt into a
   * longer cooldown or slower roll slide here in a balance pass. The
   * shape carries three independently-resolvable variant slots
   * (`spot` / `roll` / `air`) so a partial override only re-tunes the
   * variant the author cares about.
   */
  readonly dodge?: DodgeTuning;
  /**
   * Tier 5 — optional ground-locomotion overrides (walk / dash / run /
   * pivot / crouch thresholds + speeds). Omitted fields default relative to
   * the fighter's `maxRunSpeed` (see {@link resolveLocomotionTuning}), so a
   * fighter that supplies only `maxRunSpeed` gets sensible walk/dash/run
   * speeds for free.
   */
  readonly locomotion?: LocomotionTuning;
  /**
   * AC 60403 Sub-AC 3 — per-character ledge-hang / edge-grab tuning.
   * Optional because every roster slot can fall back to the canonical
   * {@link LEDGE_HANG_DEFAULTS}; heavier characters (Bear) may opt into
   * a longer climb / shorter hang here in a balance pass.
   */
  readonly ledge?: LedgeHangTuning;
  /**
   * AC 60403 Sub-AC 3 — per-character ledge-detection tuning. Optional
   * because the geometric defaults derive from the fighter's body half-
   * extents, which already work for every roster slot. Reserved here so
   * a custom stage with very narrow ledges can clamp the magnetism
   * radius via roster-side override later.
   */
  readonly ledgeDetection?: LedgeDetectionTuning;
}

/** Constructor options. `id`, `spawnX`, `spawnY` are required. */
export interface CharacterOptions extends CharacterTuning {
  readonly id: CharacterId;
  readonly spawnX: number;
  readonly spawnY: number;
  /**
   * 0-based player slot. The body's collision category is OR-ed with
   * `CHARACTER_SLOT_BITS[slotIndex]` so the scene-level pass-through
   * driver can phase a platform per-fighter (P1 may drop through while
   * P2 keeps standing on the same platform). Defaults to `0` for
   * standalone-test instances that don't wire a slot — the resulting
   * body collides exactly the way the legacy single-slot setup did.
   * Must be in `[0, MAX_FIGHTER_SLOTS)`.
   */
  readonly slotIndex?: number;
  /**
   * AC 10302 Sub-AC 2 — combat → audio bridge sink. When supplied,
   * the per-frame physics tick fires `playSfx(key)` calls on the right
   * combat events:
   *
   *   • `'sfx.jab'`   on the startup→active transition of a `'jab'`-typed move
   *   • `'sfx.tilt'`  on the same transition for a `'tilt'`-typed move
   *   • `'sfx.smash'` on the same transition for a `'smash'`-typed move
   *   • `'sfx.aerial'` on the same transition for an `'aerial'`-typed move
   *   • `'sfx.shield'` on the rising edge of the shield-raise
   *   • `'sfx.dodge'`  on the dodge state-machine non-active → active edge
   *
   * Optional / omitted ⇒ combat events are silent. Tests build a
   * recorder that pushes each `playSfx` call into an array and assert
   * against the expected sequence; production callers pass the
   * {@link AudioManager} directly (it structurally satisfies
   * {@link CombatSfxSink} via its `playSfx` method).
   *
   * KO sounds (`'sfx.ko'`) are NOT fired from inside Character —
   * they are emitted from {@link Fighter.loseStock} since the per-stock
   * accounting lives at the entity (slot) layer, not the per-character
   * physics layer.
   */
  readonly sfxSink?: CombatSfxSink;
}

/**
 * Per-frame input snapshot consumed by `applyInput`. Designed to be a
 * deterministic, serialisable record so the replay system can log it
 * directly and the AI module can synthesise it without going through
 * the keyboard layer.
 */
export interface CharacterInput {
  /**
   * Horizontal stick. -1 = full left, 0 = neutral, 1 = full right.
   * Analog values in [-1, 1] are supported for gamepads.
   */
  readonly moveX: number;
  /**
   * Vertical stick. -1 = full up, 0 = neutral, 1 = full down. Used by
   * Directional Influence (DI) at hitlag-end to rotate the queued
   * launch angle by up to ±18° (post-M2 hit-feel pass). Optional so
   * existing call sites that don't yet wire a vertical analog stick
   * continue compiling — the DI math reads `moveY ?? 0` and a missing
   * value collapses to "no DI from the vertical axis".
   */
  readonly moveY?: number;
  /**
   * Jump button held this frame. The class detects the rising edge so
   * the caller can simply pass the held state — no debouncing needed.
   */
  readonly jump: boolean;
  /**
   * Attack button held this frame. Like `jump`, the class detects the
   * rising edge — pass the held state and the controller will fire the
   * neutral attack (typically `jab`) on the press frame, ignoring any
   * subsequent held frames until release. Optional so existing call
   * sites that don't yet wire an attack input keep compiling.
   *
   * Sub-AC 3.3 dispatch (light vs aerial): a rising-edge press while the
   * fighter is *grounded* fires the light attack (default: the first
   * `jab`/`tilt` move registered). The same press while *airborne* fires
   * the aerial attack (default: the first `aerial` move registered). If
   * no aerial is registered, the controller falls back to the light
   * attack so single-attack movesets keep working.
   */
  readonly attack?: boolean;
  /**
   * Heavy-attack button held this frame. Sub-AC 3.3 — dedicated slot for
   * the smash-class move (more startup, larger knockback scaling, KO
   * finisher). Rising-edge detected like `attack`. Only fires while
   * grounded; pressed in the air the input is ignored (smashes are
   * grounded moves; aerials own the airborne kit).
   *
   * Optional for the same backward-compatibility reason as `attack`:
   * existing call sites and tests that only wire neutral-attack keep
   * compiling unchanged. The (later) input-mapping AC will route the
   * dispatcher's `special` / dedicated heavy-button to this field.
   */
  readonly attackHeavy?: boolean;
  /**
   * Reserved for the drop-through-platform implementation that lands
   * with the input AC. Kept on the shape now so the input layer can
   * be wired without a follow-up edit to this contract.
   */
  readonly dropThrough?: boolean;
  /**
   * AC 60301 Sub-AC 1 — held state of the shield button this frame.
   *
   * While `true` (and the fighter is neither destroyed nor in the
   * shield-break stun) the controller raises the shield, suppresses
   * horizontal motion, and refuses any attack press until the button
   * is released or the shield breaks. Falsy / omitted means "no
   * shield held this frame" — backwards-compatible with every
   * existing call site that doesn't yet wire the shield key.
   */
  readonly shield?: boolean;
  /**
   * AC 60302 Sub-AC 2 — held state of the dedicated dodge button.
   *
   * Drives the dodge / roll state machine: a rising-edge press while
   * the fighter is grounded fires a spot-dodge (stick neutral) or roll
   * (stick deflected past the variant-tuned threshold); a press while
   * airborne fires an air-dodge. The runtime detects the rising edge
   * the same way it does for jump / attack / shield — pass the held
   * state and the controller takes care of the press-frame logic.
   *
   * Falsy / omitted means "no dodge held this frame" — backwards-
   * compatible with every existing call site that doesn't yet wire
   * the dodge key.
   */
  readonly dodge?: boolean;
  /**
   * AC 50202 Sub-AC 2 — held state of the dedicated special button.
   *
   * The unified action-state API ({@link PlayerInputController}) reads
   * the player's bound `special` action through the rebindable binding
   * layer and routes the result here. The Character runtime currently
   * treats a `special` press the same way it treats a heavy press —
   * the move resolver dispatches to the registered neutral / up / down
   * special slot based on the stick direction at press time — so the
   * input layer composites `attackHeavy || special` into the
   * {@link attackHeavy} field. Carrying `special` as its own optional
   * field keeps the action surface complete for replay payloads and
   * for a future sub-AC that wires a first-class special-press
   * handler.
   *
   * Falsy / omitted means "no special button held this frame" —
   * backwards-compatible with every existing call site.
   */
  readonly special?: boolean;
  /**
   * AC 50202 Sub-AC 2 — held state of the dedicated grab button.
   *
   * The unified action-state API exposes `grab` as one of the eight
   * canonical action categories the Seed names. This field plumbs
   * the binding-layer read into the gameplay path so the (later
   * sub-AC) grab / throw handlers can read it without re-deriving
   * the press from raw key codes. Until the dedicated grab handler
   * lands the field is documented but unused by the Character class —
   * the surface stays complete so AI scripts, replay capture, and
   * the rebinding UI all share one vocabulary.
   *
   * Falsy / omitted means "no grab button held this frame" —
   * backwards-compatible with every existing call site.
   */
  readonly grab?: boolean;
  /**
   * AC 60403 Sub-AC 3 — explicit ledge-release intent for this frame.
   *
   * While the fighter is in the `'hanging'` state the runtime reads
   * this to pick the release action:
   *
   *   • `'getUp'`   — climb onto the platform
   *   • `'jump'`    — release with an upward jump impulse
   *   • `'attack'`  — release into a ledge-attack
   *   • `'dropDown'` — let go and fall normally
   *
   * The input layer maps stick direction + relevant button to one of
   * these (e.g. up-stick = getUp, down-stick = dropDown, jump button =
   * jump, attack button = attack). Outside the hang state the field is
   * ignored. Optional / omitted means "stay hanging."
   */
  readonly ledgeRelease?: LedgeReleaseAction | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matter `label` stamped on every character body. */
export const CHARACTER_LABEL = 'character.body';

/**
 * AC 60102 Sub-AC 2 — stick-deadzone threshold used by the airborne
 * attack-press handler to classify "is the player holding a direction
 * or not?" when picking a directional aerial.
 *
 *   |moveX| < AERIAL_STICK_THRESHOLD   → neutral aerial (nair)
 *   sign(moveX) === prevFacing         → forward aerial (fair)
 *   sign(moveX) === -prevFacing        → back aerial (bair)
 *
 * Pulled out as a named export so AI scripts that synthesise inputs and
 * the (later AC) input-rebinding screen can read the same value the
 * controller does — no dual-source-of-truth drift.
 *
 * 0.3 was picked to match the dispatcher-level deadzone we already use
 * elsewhere: a relaxed thumb on a gamepad analog can drift up to ~0.2
 * without the player intending a direction; over 0.3 the intent is
 * unambiguous.
 */
export const AERIAL_STICK_THRESHOLD = 0.3;

/**
 * Initial directional AIR-DODGE burst speed (px/step). When the player air-
 * dodges with a stick direction held, the fighter gets this much velocity in
 * that direction on the dodge-start frame, fading each active frame by
 * {@link AIRDODGE_BURST_DECAY}. A neutral-stick air-dodge keeps the in-place
 * stall. One directional air-dodge per airtime (reset on land) so it can't be
 * chained into infinite recovery. PLACEHOLDER tuning — tune by feel/playtest;
 * see docs/SMASH-PARITY-PLAN.md (T2.9).
 */
export const AIRDODGE_BURST_SPEED = 9;
/** Per-active-frame multiplicative decay of the air-dodge burst. */
export const AIRDODGE_BURST_DECAY = 0.85;

/**
 * Short-hop decision window, in fixed-step frames. Releasing the jump
 * button within this many frames of the impulse clips the rise to
 * `jumpImpulse * jumpCutFactor` (the SHORT HOP); any later release
 * keeps the full jump height — Smash semantics. 8 frames ≈ 133 ms,
 * a comfortable tap-vs-press boundary at 60 Hz.
 */
export const JUMP_CUT_WINDOW_FRAMES = 8;

/**
 * Tap-jump buffer, in fixed-step frames. With "tap up to jump" (moveUp + jump
 * share a key), pressing UP to up-tilt/up-smash also fires a jump — and the
 * jump would win, making grounded up-attacks almost impossible. When an
 * up+jump press is AMBIGUOUS (grounded, up-stick held, an up-attack exists),
 * the jump is held this many frames; if an attack press lands in the window
 * the grounded dispatch fires the up-attack and the buffered jump is dropped.
 * Mirrors the Smash feel where up+A wins the window. Plain jumps (no up-stick)
 * are unaffected and stay instant. 4 frames ≈ 67 ms — permissive enough to
 * catch a near-simultaneous attack, short enough to not feel like jump lag.
 */
export const TAP_JUMP_BUFFER_FRAMES = 4;

/**
 * Frames a down-special dive LANDING SHOCKWAVE sensor lives in the world.
 * Long enough for Matter's `collisionstart` to fire against any fighter
 * overlapping the landing point, then the transient hitbox despawns.
 */
export const DIVE_SHOCKWAVE_FRAMES = 3;

/**
 * Frames a TIMED-BOMB detonation blast sensor lives in the world (the trap
 * down-special's `fuseDetonateFrames` path — Samus's morph-ball bomb). Long
 * enough for `collisionstart` to fire against anyone overlapping the blast,
 * then the transient hitbox despawns. A one-shot explosion, not a lingering
 * contact mine.
 */
export const TRAP_BLAST_FRAMES = 4;

/**
 * Launch knockback magnitude at/above which a hit sends the victim into
 * TUMBLE — the launched state that can be TECHED on ground contact. Below
 * this, a hit is light hitstun that just ends when it drains (no
 * knockdown). ~7 px/step separates jab-tier pokes from real launches.
 */
export const TUMBLE_KNOCKBACK_THRESHOLD = 7;
/**
 * Frames a shield/dodge press buffers a TECH. Press within this window of
 * touching a surface while tumbling and you tech (cancel the knockdown
 * with brief intangibility); miss it and you hit the floor in a knockdown.
 */
export const TECH_WINDOW_FRAMES = 8;
/** Intangibility frames granted by a successful tech (tech-in-place). */
export const TECH_IFRAME_FRAMES = 20;
/** Frames a missed-tech KNOCKDOWN (prone, vulnerable) lasts before auto get-up. */
export const KNOCKDOWN_FRAMES = 26;
/** Intangibility frames granted on a get-up from knockdown. */
export const GETUP_IFRAME_FRAMES = 14;
/**
 * Frames a mistimed TECH locks you out of teching. Press shield/dodge while
 * tumbling but too early (the buffer drains before you touch a surface) and
 * you're locked out — a re-press won't tech the real landing. The anti-mash
 * rule that punishes panic-teching, mirroring Smash's tech-lockout.
 */
export const TECH_LOCKOUT_FRAMES = 24;
/** Frames a directional tech-roll / get-up-roll lasts (intangible, moving). */
export const GETUP_ROLL_FRAMES = 16;
/** Horizontal speed (px/step) of a tech-roll / get-up-roll. */
export const GETUP_ROLL_SPEED = 6;
/** Active frames of a get-up attack's double-sided sweep hitbox. */
export const GETUP_ATTACK_FRAMES = 6;
/** Damage of a get-up attack (a weak, low-knockback wake-up swat). */
export const GETUP_ATTACK_DAMAGE = 6;

/** Active frames of a ledge-attack's edge-clearing swing hitbox. */
export const LEDGE_ATTACK_FRAMES = 8;
/**
 * Damage of a ledge-attack (a weak swing that clears an edge-guarder as the
 * fighter climbs back on). PLACEHOLDER tuning — per-character authoring +
 * exact frame/knockback values vs an Ultimate frame-data reference is a
 * follow-up (see docs/SMASH-PARITY-PLAN.md, Tier 2/5).
 */
export const LEDGE_ATTACK_DAMAGE = 8;

/** Horizontal off-stage shove (px/step) applied to a fighter TRUMPED off a ledge. PLACEHOLDER tuning. */
export const LEDGE_TRUMP_KNOCKOFF_VX = 3;
/** Downward shove (px/step, +y = down) applied to a trumped fighter. PLACEHOLDER tuning. */
export const LEDGE_TRUMP_KNOCKOFF_VY = 1.5;

/**
 * Smash Directional Influence (SDI) — each fresh stick flick during the
 * hitlag freeze nudges the launched fighter's POSITION (not trajectory)
 * by this many px. Lets a victim drift out of a multi-hit move or toward
 * safety. Distinct from DI (which rotates the launch ANGLE at freeze-end).
 */
export const SDI_NUDGE_PX = 3;
/** Cap on TOTAL SDI displacement across one hitlag freeze — keeps it a nudge, not a teleport. */
export const SDI_MAX_TOTAL_PX = 18;
/** Stick magnitude at/above which a flick counts as an SDI input. */
export const SDI_STICK_THRESHOLD = 0.5;

/**
 * Fraction of `maxRunSpeed` above which a fighter counts as "running"
 * for dash-sensitive inputs: a light attack press becomes a DASH-ATTACK
 * (not a forward-tilt-from-standstill), and a grab press becomes a
 * DASH-GRAB. One shared gate so both read the same speed threshold.
 */
export const DASH_SPEED_FRACTION = 0.55;

/**
 * CROUCH-CANCEL — a grounded crouching fighter absorbs part of an
 * incoming hit's launch, multiplying the knockback (and tumble check) by
 * this factor. Mirrors the Melee crouch-cancel: crouching is a real
 * defensive option (survive a finisher longer, break a weak combo). 0.82
 * ≈ an ~18% launch reduction — meaningful but not a hard counter.
 */
export const CROUCH_KNOCKBACK_REDUCTION = 0.82;
/**
 * While crouching, the body hurtbox shrinks to this fraction of its
 * height (bottom-anchored — the fighter ducks their head down). Surfaced
 * by {@link getActiveHurtboxes} for the damage overlay / AI / future
 * geometric ducking; the live damage handler reads the modifier set but
 * does not yet filter by geometry, so this is presentation + data today.
 */
export const CROUCH_HURTBOX_HEIGHT_FRACTION = 0.62;

/**
 * Frames of backward leniency for a directional (up / down) attack input.
 * The up/down-attack classifier reads the most-extreme vertical stick over
 * this many frames so a flick that lands a frame or two before the attack
 * button still fires the directional move — exact frame-perfect
 * simultaneity is not required of the player. 4 frames ≈ 67 ms at 60 Hz.
 */
export const DIRECTIONAL_INPUT_WINDOW = 4;

/**
 * Frames each rung of a multi-hit ladder (side-special `multiHit`
 * barrage / up-special `multiHitRising` spin) lives as its own transient
 * sensor. Each rung is a SEPARATE collision body so it (a) lands its own
 * connect — driving one hit spark per rung for free — and (b) is deduped
 * per-body by the HitboxDamageHandler so a lingering rung can't re-hit
 * the same target. 3 frames connects reliably and despawns before the
 * next rung (rungs are `hitInterval` ≥ 4 frames apart in the cast).
 */
export const MULTIHIT_RUNG_FRAMES = 3;

/**
 * Frames a counter RETALIATION hitbox lives — the swing a successful
 * parry (neutral Wolf/Aegis, down Bear) spawns in front of the defender.
 * A few frames so it reliably connects with the attacker who walked into
 * the parry, then it despawns.
 */
export const COUNTER_RETAL_FRAMES = 4;

/**
 * Safety cap on how many frames a down-special dive (groundPound /
 * stallAndFall) may be HELD active past its authored window while still
 * plunging toward the ground. A fighter who never lands (e.g. dives
 * straight off-stage) is bounded here instead of holding the meteor
 * forever — in practice the blast-zone KO ends the dive long before this.
 */
export const DIVE_MAX_HOLD_FRAMES = 240;

/**
 * Non-movement defaults for the {@link Character} base class.
 *
 * Sub-AC 2.2 of the T2 refactor — the base class no longer holds the
 * movement profile (speed, jump, air control, mass) as a hard-coded
 * generic default. Each per-fighter subclass owns those values via
 * its `FighterMovementProfile`, sourced from {@link getFighterMovementProfile}
 * at construction time so a `new Character({ id: 'wolf' })` resolves
 * Wolf's profile, a `new Character({ id: 'bear' })` resolves Bear's,
 * etc. The fields that REMAIN here are the ones unaffected by the
 * refactor: hurtbox / collision geometry (`width` / `height` /
 * `chamfer`) and the resolved defensive-state-machine tunings
 * (`shield` / `dodge` / `ledge` / `ledgeDetection`). Per-fighter
 * subclasses still spread their `*_TUNING` records over these defaults
 * for any geometry-specific overrides.
 */
export const DEFAULT_CHARACTER_TUNING: Required<
  Omit<
    CharacterTuning,
    | 'maxRunSpeed'
    | 'groundAccel'
    | 'airAccel'
    | 'groundDamping'
    | 'airDamping'
    | 'jumpImpulse'
    | 'maxJumps'
    | 'mass'
    | 'fallAccel'
    | 'maxFallSpeed'
    | 'fastFallSpeed'
    | 'jumpCutFactor'
    | 'locomotion'
  >
> & {
  shield: ResolvedShieldTuning;
  dodge: ResolvedDodgeTuning;
  ledge: ResolvedLedgeHangTuning;
  ledgeDetection: LedgeDetectionTuning;
} = {
  width: 90,
  height: 130,
  chamfer: 12,
  // AC 60301 Sub-AC 1 — canonical shield tuning. Per-character roster
  // overrides land via the `shield: { ... }` slot on `CharacterOptions`
  // and re-resolve through `resolveShieldTuning`.
  shield: resolveShieldTuning(),
  // AC 60302 Sub-AC 2 — canonical dodge tuning. Per-character roster
  // overrides land via the `dodge: { ... }` slot on `CharacterOptions`
  // and re-resolve through `resolveDodgeTuning`.
  dodge: resolveDodgeTuning(),
  // AC 60403 Sub-AC 3 — canonical ledge-hang tuning. Per-character
  // overrides land via the `ledge: { ... }` slot on `CharacterOptions`
  // and re-resolve through `resolveLedgeHangTuning`.
  ledge: resolveLedgeHangTuning(),
  ledgeDetection: {},
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isPlatformLabel(label: string | undefined | null): boolean {
  return label === PLATFORM_LABELS.solid || label === PLATFORM_LABELS.passThrough;
}

/**
 * Minimal shape of a Matter collision pair we care about. Lets the
 * unit test suite construct fake events without a Matter import — the
 * real Phaser/Matter pair carries a lot more (slop, normal, etc.) but
 * we only read body identity, label, and centre Y.
 */
interface SupportPair {
  readonly bodyA: {
    label?: string | null;
    position: { x: number; y: number };
    bounds?: { min: { x: number; y: number }; max: { x: number; y: number } };
  };
  readonly bodyB: {
    label?: string | null;
    position: { x: number; y: number };
    bounds?: { min: { x: number; y: number }; max: { x: number; y: number } };
  };
}

interface CollisionEventLike {
  readonly pairs: ReadonlyArray<SupportPair>;
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

/**
 * Single fighter wrapper. Owns its Matter body and the bookkeeping
 * needed for movement + grounded state. Up to 4 instances live in a
 * match.
 *
 * Lifecycle:
 *
 *   const ch = new Character(scene, { id: 'wolf', spawnX, spawnY });
 *   // every fixed step:
 *   ch.applyInput({ moveX, jump });
 *   // teardown (scene shutdown / replay reset):
 *   ch.destroy();
 */
export class Character {
  readonly id: CharacterId;
  readonly body: MatterJS.BodyType;
  /**
   * 0-based player slot. Mirrored from `CharacterOptions.slotIndex`
   * (or `0` when the caller omits it). Read by the scene-level pass-
   * through driver to know which `CHARACTER_SLOT_*` bit to OR into
   * each platform's runtime mask when this fighter should NOT be
   * phased through.
   */
  readonly slotIndex: number;

  /**
   * Tuning baked at construction; replaced wholesale via {@link setTuning}.
   *
   * The `shield` and `dodge` slots are resolved into fully-defaulted
   * records ({@link ResolvedShieldTuning} / {@link ResolvedDodgeTuning})
   * so the per-step shield + dodge ticks read canonical values without
   * optional-chaining. Overrides via {@link setTuning} re-resolve each
   * slot through its respective `resolve…` helper so partial records
   * merge cleanly over the existing tuning.
   */
  private tuning: Required<Omit<CharacterTuning, 'locomotion'>> & {
    shield: ResolvedShieldTuning;
    dodge: ResolvedDodgeTuning;
    ledge: ResolvedLedgeHangTuning;
    ledgeDetection: LedgeDetectionTuning;
    // Resolved separately into `resolvedLocomotionTuning` (it needs
    // `maxRunSpeed`), so the raw slot stays optional on `tuning`.
    locomotion?: LocomotionTuning;
  };

  /**
   * AC 60301 Sub-AC 1 — live shield state machine. Initialised to
   * idle / full health at construction; advanced once per fixed step
   * by {@link tickShield} from inside {@link applyInput}; resyncable
   * via {@link setShieldState} (replay seek / tests) and reset by
   * {@link setPosition} (respawn).
   */
  private shieldState: ShieldState;

  /**
   * Frames the shield has been continuously `'active'`. Incremented each
   * fixed step the shield is up, reset to 0 the moment it drops. Read by
   * {@link applyHit} to decide a PERFECT SHIELD (a hit caught within
   * {@link PERFECT_SHIELD_WINDOW_FRAMES} of raising costs no HP / no
   * shieldstun). Reset on respawn.
   */
  private shieldActiveFrames = 0;

  /**
   * STALE-MOVE queue — the ids of this fighter's most-recently-LANDED
   * moves (oldest first, newest at the end), capped at
   * {@link STALE_QUEUE_SIZE}. Drives stale-move negation: a move already
   * present N times deals less damage / knockback (see
   * `combat.computeStaleMultiplier`). The MatchScene hit callback reads
   * the occurrence count via {@link registerLandedMove} the instant a hit
   * connects. Attacker-side state; reset on respawn.
   */
  private staleMoveQueue: string[] = [];

  /**
   * AC 60302 Sub-AC 2 — live dodge / roll state machine. Initialised
   * to idle at construction; advanced once per fixed step by
   * {@link tickDodge} from inside {@link applyInput}; resyncable via
   * {@link setDodgeState} (replay seek / tests) and reset by
   * {@link setPosition} (respawn).
   *
   * The state's `iframesRemaining > 0` window is composed with the
   * separate respawn-grace `invincibilityRemaining` counter via OR in
   * {@link isInvincible} — see the field's JSDoc for the rationale.
   */
  private dodgeState: DodgeState;

  /**
   * Tier 5 — live ground-locomotion state machine (standing / walk /
   * initialDash / run / pivot / crouch). Advanced once per fixed step by
   * {@link tickLocomotion} inside {@link applyInput}; it owns the grounded
   * TARGET velocity + facing (the integrator stays in {@link applyInput}).
   * Reset on respawn. Airborne forces it to `standing` (air drift keeps the
   * legacy proportional path).
   */
  private locomotionState: LocomotionState;
  /** Resolved locomotion tuning (speeds derived from `maxRunSpeed`). */
  private readonly resolvedLocomotionTuning: ResolvedLocomotionTuning;
  /** Previous frame's POST-lockout moveX — feeds the locomotion flick-edge detector. */
  private prevLocoMoveX = 0;

  /**
   * AC 60302 Sub-AC 2 — latch for rising-edge dodge detection. Carried
   * across frames so a single press of the dodge key only triggers a
   * single transition into the active dodge state, even if the player
   * keeps the key held — and a key still held through hitstun /
   * shield-break stun does NOT auto-fire a dodge on the recovery frame.
   */
  private prevDodgeHeld = false;

  /**
   * Live grab-machine state (post-M2 grab/throw subsystem). Drives the
   * idle → whiffStartup → whiffActive → holding → throwing → cooldown
   * progression of the grabber's side of a grab. Stays at the
   * fresh-idle record until the runtime wires a `GrabSpec` via
   * {@link setGrabSpec} AND the player presses the grab button while
   * grounded.
   *
   * The Matter sensor body that connects on `whiffActive`, the target-
   * side `'grabbed'` state, and the throw-release damage application
   * are the next sub-tasks in the M4.5 track — until they land, this
   * state machine ticks but no hitbox actually fires.
   */
  private grabState: GrabState = createGrabState();

  /**
   * Per-fighter grab specification. `null` when no grab is registered
   * (in which case grab presses are ignored). Set via
   * {@link setGrabSpec} from the per-character subclass constructor.
   */
  private grabSpec: GrabSpec | null = null;

  /** Latch for rising-edge grab-button detection. */
  private prevGrabHeld = false;

  /**
   * Live grab range-sensor body (post-M2 M4.6 wiring). Set on the
   * `whiffStartup → whiffActive` transition; cleared (and the body
   * removed from the world) on the `whiffActive → whiffRecovery`
   * transition (the grab whiffed) OR the `whiffActive → holding`
   * transition (a connect fired).
   */
  private grabHitboxBody: MatterJS.BodyType | null = null;

  /**
   * DASH GRAB latch — set when the grab was started while running fast
   * (`|vx| > maxRunSpeed·{@link DASH_SPEED_FRACTION}`) on a {@link GrabSpec}
   * that declares a `dashGrab`. While set, the grab slides forward at
   * `dashGrabEntryVx · momentumRetain` through its whiff (instead of
   * rooting) and spawns its range hitbox shifted forward by `rangeBonusX`.
   * Cleared when the grab returns to idle and on respawn.
   */
  private dashGrabActive = false;
  /** Run-entry horizontal velocity snapshot for the dash-grab momentum carry. */
  private dashGrabEntryVx = 0;

  /**
   * If non-null, this character is currently being held by another
   * fighter's grab. While set, `applyInput` pins the body to the
   * grabber's contact offset and ignores all input. Cleared when the
   * grabber transitions out of `'holding'` (release / throw / break).
   */
  private grabbedBy: Character | null = null;

  /** Reference to the live target this character is grabbing (mirror of `grabbedBy`). */
  private grabTarget: Character | null = null;

  /**
   * AC 60403 Sub-AC 3 — live ledge-hang state machine. Tracks whether
   * the fighter is currently grabbing a ledge, climbing up, or in the
   * post-release tether cooldown. Advanced once per fixed step from
   * inside {@link applyInput}.
   */
  private ledgeHangState: LedgeHangState;

  /**
   * AC 60403 Sub-AC 3 — live ledge candidates the runtime feeds in via
   * {@link setLedgeCandidates}. The geometric detection pass each fixed
   * step iterates this list to decide if the fighter is overlapping a
   * grabbable ledge corner. Defaults to empty so a `Character` spawned
   * before the stage geometry is wired in simply never edge-grabs.
   */
  private ledgeCandidates: ReadonlyArray<LedgeCandidate> = [];

  /**
   * AC 60403 Sub-AC 3 — pending force-release signal. Set by
   * {@link applyHit} when an incoming hit punches through the i-frame
   * window, consumed by the next {@link applyInput} call's ledge tick.
   * The two-step indirection keeps the state machine deterministic —
   * the tick is the single source of truth for transitions.
   */
  private pendingLedgeForceRelease = false;

  private readonly scene: Phaser.Scene;

  /** -1 = facing left, 1 = facing right. Updated whenever input has direction. */
  private facing: 1 | -1 = 1;

  /**
   * Active "support contacts" — incremented on `collisionstart` with
   * a platform body whose centre sits below ours, decremented on
   * `collisionend`. `isGrounded()` returns `count > 0`.
   */
  private groundContacts = 0;

  /**
   * Directional AIR-DODGE state. `airDodgeBurst` is the (decaying) velocity
   * applied during an air-dodge's active phase when a stick direction was held
   * at the press (null = neutral / in-place stall). `airDodgeUsed` enforces ONE
   * directional air-dodge per airtime (reset on land / respawn) so it can't be
   * chained into infinite recovery. See {@link AIRDODGE_BURST_SPEED}.
   */
  private airDodgeBurst: { x: number; y: number } | null = null;
  private airDodgeUsed = false;

  /**
   * Countdown for an in-flight TAP-JUMP BUFFER (see {@link TAP_JUMP_BUFFER_FRAMES}).
   * Set when an ambiguous up+jump press is held back to let a follow-up attack
   * convert it to an up-attack; decremented each frame; fires the jump at 0, or
   * is dropped to 0 the moment an attack press (or a state change) pre-empts it.
   */
  private tapJumpBufferFrames = 0;

  /**
   * Set by the scene's pass-through-platform driver (via
   * {@link markPlatformFallSupported}) on a frame it is actively keeping this
   * fighter resting on / landing onto a thin platform. The fall-shaping pack
   * reads it as "grounded for fall purposes" so the per-fighter `fallAccel`
   * spike is suppressed while the driver holds the fighter on the surface —
   * otherwise the brief contact-sensor flicker during the landing lets
   * `fallAccel` ramp `vy` back to `maxFallSpeed`, tunnelling the body through
   * the thin float and ejecting it above again (an endless up/down jitter).
   * Consumed (reset to false) once per {@link applyInput} so it never leaks a
   * frame past the driver's support, leaving free-fall feel untouched.
   */
  private platformFallSupported = false;

  /**
   * Number of jumps used since the last landing. Reset to 0 on the
   * first frame the character is grounded with non-rising velocity.
   */
  private jumpsUsed = 0;

  /** Latch for rising-edge jump detection. */
  private prevJumpHeld = false;

  /** Latch for rising-edge attack detection (mirrors `prevJumpHeld`). */
  private prevAttackHeld = false;

  /** Latch for rising-edge heavy-attack detection (Sub-AC 3.3). */
  private prevHeavyHeld = false;

  /**
   * T1 (AC 5-9) — latch for rising-edge special-press detection. Mirrors
   * {@link prevAttackHeld} / {@link prevHeavyHeld}: a press is detected
   * iff the held state went `false → true` between two consecutive
   * frames. Required for the G-binding fix — a held-down special button
   * must not refire every tick; only the rising edge dispatches.
   */
  private prevSpecialHeld = false;

  /**
   * AC 60101 Sub-AC 1 — previous-frame stick X latched across calls.
   *
   * Drives the smash-flick predicate inside {@link classifyGroundedAttack}:
   * a press whose `moveX` jumps from below the rest threshold to above
   * the flick threshold within a single frame is the canonical Smash-
   * style "tap-to-smash" input that fires the heavy attack without
   * pressing the dedicated heavy button.
   *
   * Latched as the *raw clamped* `moveX` (NOT the post-shield / post-
   * dodge zeroed value) so a player holding the stick through a shield
   * frame doesn't see a phantom flick on the release frame. Reset to
   * 0 on `setPosition` so a respawn / replay seek doesn't leak the
   * pre-teleport stick state into the next press.
   */
  private prevMoveX = 0;
  /**
   * Previous-frame raw clamped stick Y, latched alongside {@link prevMoveX} so
   * the grounded classifier can detect a VERTICAL smash flick (rest→deflected)
   * for up/down-smash. Latched in defensive-state branches too so a held
   * up/down-stick masked during shield/hitstun can't phantom-flick on exit.
   */
  private prevMoveY = 0;

  /**
   * Short backward window of the vertical stick (`moveY`) for DIRECTIONAL
   * INPUT LENIENCY. Players can't time an up/down flick to the exact frame
   * they press attack, so the up-air / down-air / up-tilt / up-smash
   * classification reads the most-extreme `moveY` over the last
   * {@link DIRECTIONAL_INPUT_WINDOW} frames instead of only the press
   * frame — a flick-up a frame or two before the press still registers.
   * Deterministic: pure function of the input stream (replay-safe).
   */
  private recentMoveY: number[] = [];

  /**
   * AC 60301 Sub-AC 1 — latch for rising-edge shield detection. Carried
   * across frames so a single press of the shield key only triggers a
   * single transition into the active shield state, even if the player
   * keeps the key held — and a key still held through hitstun /
   * shield-break stun does NOT auto-re-raise the shield on the
   * recovery frame.
   */
  private prevShieldHeld = false;

  /**
   * AC 10302 Sub-AC 2 — combat → audio bridge sink. Latched at
   * construction (or via {@link setSfxSink}) and read by the per-frame
   * physics tick to fire `playSfx(key)` calls on attack hitbox spawns,
   * shield raises, and dodge presses. `null` means "no audio backend
   * wired" — every emit call short-circuits to a no-op via the helper.
   *
   * Why this lives on Character (and not on Fighter): the combat events
   * the sink voices fire from inside the per-frame physics tick, which
   * is owned by Character. Fighter forwards its own constructor's
   * `sfxSink` option through to Character via {@link setSfxSink} so the
   * sink is the same single instance for both layers — and so Fighter
   * can stay the source of truth for the per-stock KO event without
   * inverting the dependency.
   */
  private sfxSink: CombatSfxSink | null = null;

  /**
   * Registry of attacks owned by this fighter, keyed by `move.id`.
   *
   * Sub-AC 3 of the T2 refactor — attack-registration logic no longer
   * lives on the {@link Character} base class. The per-fighter subclass
   * (Wolf, Cat, Owl, Bear) populates this map via the
   * {@link addAttack} scaffolding method (and the type-aware slot wiring
   * helper exported from `attackRegistration.ts`) inside its own
   * constructor; a base `Character` with no attacks added will simply
   * ignore `attack` button presses.
   *
   * The field is `protected` (not `private`) so the
   * {@link addAttack} / {@link hasAttack} scaffolding can be invoked by
   * the per-fighter helper without any "attack-implementation code"
   * sitting on the base — the base only owns the storage scaffolding,
   * not the fill-which-slot policy.
   */
  protected readonly attacks: Map<string, AttackMove> = new Map();

  /**
   * AC 4 (T2 refactor) — per-attack-slot override map for the T3 item
   * framework. While an item is held, its declared overrides install
   * a temporary callback into this map for each {@link AttackMovesetSlotName}
   * the item replaces; on drop / break / despawn the callbacks are
   * cleared. The {@link executeJab} / {@link executeTilt} / etc. hooks
   * consult this map BEFORE firing the per-fighter authored move so a
   * held bat's swing fires from the bat-supplied callback rather than
   * the fighter's native jab.
   *
   * The callback returns `boolean` — `true` iff it consumed the press
   * (the override "fired"). Returning `false` signals the override
   * declined the press (e.g. the item is on cooldown) and the fighter's
   * authored slot move runs as a fallback. This contract keeps the
   * single-slot inventory invariant compatible with partial-override
   * items that decline some presses (e.g. a held ray gun that ignores
   * jab-while-empty-clip and lets the fighter's native jab run).
   */
  private readonly slotOverrides: Map<
    AttackMovesetSlotName,
    () => boolean
  > = new Map();

  /**
   * Default attack id selected when the `attack` button rises with no
   * explicit `attemptAttack(id)` call. Set by per-fighter subclasses
   * (typically the jab) via {@link setDefaultAttack} so subclasses get
   * the "press attack to jab" behaviour for free.
   */
  private defaultAttackId: string | null = null;

  /**
   * Sub-AC 3.3 — three-slot dispatch table for "press the attack button
   * while in the right state." Populated by the per-fighter subclass
   * (via the type-aware helper exported from `attackRegistration.ts`)
   * based on the move's `type`:
   *
   *   • lightAttackId  ← first registered `'jab' | 'tilt'` move
   *   • heavyAttackId  ← first registered `'smash'` move
   *   • aerialAttackId ← first registered `'aerial'` move
   *
   * Subclasses can override any slot explicitly via the dedicated
   * setters (`setLightAttack` / `setHeavyAttack` / `setAerialAttack`),
   * useful when the roster ships multiple moves of the same `type` and
   * wants a non-first variant as the default.
   *
   * Resolution order on a press (after grounded-state classification):
   *
   *   ground + heavy press → heavyAttackId  (no fallback — if unset, ignore)
   *   ground + light press → lightAttackId  (fallback: defaultAttackId)
   *   air    + light press → directional aerial slot (see below)
   *
   * The fallbacks keep single-move test fighters (registered with just
   * a 'jab') working as before: in-air presses still fire jab because
   * the aerial slot resolves through to it.
   */
  private lightAttackId: string | null = null;
  private heavyAttackId: string | null = null;
  private aerialAttackId: string | null = null;

  /**
   * AC 60101 Sub-AC 1 — dedicated tilt-dispatch slot. Filled by the
   * per-fighter subclass (via the type-aware helper exported from
   * `attackRegistration.ts`) for any move whose `type === 'tilt'`.
   * Drives the grounded "directional tap + attack" press pattern through
   * {@link classifyGroundedAttack}: when the player holds a direction
   * past the neutral deadzone (without a smash flick) and presses
   * attack, the dispatcher resolves to this slot.
   *
   * The historical `lightAttackId` slot is preserved unchanged for
   * backwards compat — it still auto-fills with the *first* registered
   * `'jab' | 'tilt'` move, and the runtime grounded jab path still
   * resolves through it. The directional tap path falls back through
   * `tiltAttackId → lightAttackId → defaultAttackId` so a roster that
   * ships only a jab keeps firing on every grounded press.
   */
  private tiltAttackId: string | null = null;
  /** Up-tilt slot — fired on an up-stick light press. Wired explicitly per fighter. */
  private upTiltId: string | null = null;
  /** Up-smash slot — fired on an up-stick heavy press. Wired explicitly per fighter. */
  private upSmashId: string | null = null;
  /** Down-tilt slot — fired on a down-stick light press. Wired explicitly per fighter. */
  private downTiltId: string | null = null;
  /** Down-smash slot — fired on a down-stick heavy press. Wired explicitly per fighter. */
  private downSmashId: string | null = null;
  /** Dash-attack slot — fired on a light press while running. Wired explicitly per fighter. */
  private dashAttackSlotId: string | null = null;

  /**
   * AC 60201 Sub-AC 1 — neutral-special dispatch slot. Populated by the
   * per-fighter subclass (via the type-aware helper) when the move's
   * `type === 'special'`. Each character ships exactly one neutral
   * special (counter, projectile, charge, or command grab) and the input
   * layer's `special` button maps to this slot.
   *
   * Setter / getter mirror the existing `setLightAttack` /
   * `getLightAttackId` pattern so balance-pass tooling and tests can
   * override / inspect the slot independently.
   */
  private neutralSpecialId: string | null = null;

  /**
   * AC 60202 Sub-AC 2 — up-special dispatch slot. Populated by the
   * per-fighter subclass (via the type-aware helper) when the move's
   * `type === 'upSpecial'`. Each character ships exactly one up-special
   * (multiHitRising, teleport, directionalJump, or tether) — the
   * recovery move pressed when the fighter has been knocked off the
   * stage. The input layer's "stick-up + special" press maps to this
   * slot; a fallback to {@link neutralSpecialId} keeps the input layer
   * robust if a roster entry ever ships only a neutral special.
   *
   * Setter / getter mirror the existing `setNeutralSpecial` /
   * `getNeutralSpecialId` pattern so balance-pass tooling and tests can
   * override / inspect the slot independently.
   */
  private upSpecialId: string | null = null;

  /**
   * AC 60304 Sub-AC 4 — down-special dispatch slot. Populated by the
   * per-fighter subclass (via the type-aware helper) when the move's
   * `type === 'downSpecial'`. Each character ships exactly one down-
   * special (groundPound, trap, stallAndFall, or counter). The input
   * layer's "stick-down + special" press maps to this slot; a fallback
   * to {@link neutralSpecialId} keeps the input layer robust if a
   * roster entry ever ships only a neutral special.
   *
   * Setter / getter mirror the existing `setNeutralSpecial` /
   * `setUpSpecial` patterns so balance-pass tooling and tests can
   * override / inspect the slot independently.
   */
  private downSpecialId: string | null = null;

  /**
   * AC 60102 Sub-AC 2 — directional aerial dispatch slots. The airborne
   * attack-press handler classifies the player's stick input *relative
   * to the fighter's facing at the moment of the press* and routes to
   * the appropriate slot:
   *
   *   • aerialNeutralId ← stick neutral (|moveX| < AERIAL_STICK_THRESHOLD)
   *   • aerialForwardId ← stick held toward facing (sign(moveX) === prevFacing)
   *   • aerialBackId    ← stick held away from facing (sign(moveX) === -prevFacing)
   *
   * The per-fighter type-aware helper reads the move's `aerialDirection`
   * field (from the {@link AerialMove} schema) when present and auto-
   * fills the matching slot. Plain `AttackMove`-typed aerials (legacy
   * `WOLF_NAIR` / `CAT_NAIR`) carry no direction tag and default to
   * filling the neutral slot — that keeps every previously-registered
   * fighter dispatching identically while the newer directional aerials
   * get their dedicated dispatch path.
   *
   * Cascading fallback on a press (so partial movesets keep working):
   *
   *   forward press → aerialForwardId → aerialNeutralId → aerialAttackId
   *                  → lightAttackId → defaultAttackId
   *   back    press → aerialBackId    → aerialNeutralId → aerialAttackId
   *                  → lightAttackId → defaultAttackId
   *   neutral press → aerialNeutralId → aerialAttackId → lightAttackId
   *                  → defaultAttackId
   *
   * The order means a Wolf with only `WOLF_NAIR` registered still fires
   * his nair on any airborne press regardless of stick direction —
   * directional aerials only "kick in" once a fighter ships them.
   *
   * Setters / getters mirror the existing `setAerialAttack` /
   * `getAerialAttackId` pattern so balance-pass tooling and tests can
   * override / inspect each slot independently.
   */
  private aerialNeutralId: string | null = null;
  private aerialForwardId: string | null = null;
  private aerialBackId: string | null = null;
  private aerialUpId: string | null = null;
  private aerialDownId: string | null = null;

  /**
   * AC 60102 Sub-AC 2 — landing-detection bookkeeping. Tracks the
   * fighter's grounded state at the *previous* fixed step so the
   * runtime can detect "just landed this frame" — the trigger for
   * interrupting an in-flight aerial attack with landing-lag.
   *
   * Initialised to `false` (matches the spawn contract: every fighter
   * starts airborne until the first collision-event resolution
   * confirms a platform contact).
   */
  private prevGrounded = false;

  /**
   * Active attack instance, if any. Lives across multiple fixed steps
   * — startup → active (hitbox spawned) → recovery → cleared. Only one
   * attack can be in-flight at a time; new presses during the attack
   * are dropped (no buffering in this sub-AC).
   */
  private activeAttack: {
    move: AttackMove;
    facing: 1 | -1;
    framesElapsed: number;
    hitboxBody: MatterJS.BodyType | null;
    /**
     * Charge-special payload — the number of frames the special button
     * was HELD before this move was released, or `null` for every
     * non-charge move. When set, the hitbox spawns with damage /
     * knockback lerped between the move's `charge.min*` and `charge.max*`
     * via the {@link ChargeSpec} ramp (Samus-style charge cannon: a bare
     * tap fires the weak shot, a held button fires the KO shot). Latched
     * once on the release frame so the whole active window deals the
     * charged values deterministically.
     */
    chargeHeldFrames: number | null;
    /**
     * AC 60303 Sub-AC 3 — up-special runtime context. Latched on the
     * press frame for `'upSpecial'`-typed moves; `null` for every other
     * move type. The runtime uses these fields to drive the
     * vertical / recovery physics on the press frame and across the
     * active window:
     *
     *   • `dir` — unit vector latched at press time (8-direction-snapped
     *     for moves whose schema declares `snapToOctant: true`, raw
     *     stick otherwise). Defaults to `(0, -1)` (straight up) for the
     *     canonical no-stick recovery press.
     *   • `pressX` / `pressY` — body-centre position at press time.
     *     Used by `teleport`-kind up-specials to compute the absolute
     *     reappear destination (`pressX + dir.x * teleportDistance`).
     *   • `upSpecialApplied` — whether the burst-window override
     *     (`directionalJump`) or the reappear translation (`teleport`)
     *     has already been performed. Prevents the runtime from
     *     re-translating on every frame.
     */
    upSpecial: {
      dir: { x: number; y: number };
      pressX: number;
      pressY: number;
      upSpecialApplied: boolean;
    } | null;
  } | null = null;

  /**
   * Active hold-to-charge state for a `specialKind: 'charge'` neutral
   * special (Samus cannon / DK punch). Non-null between the press that
   * starts charging and the release that fires it: `framesHeld` climbs
   * one per `applyInput` tick while the special button stays down, up to
   * `maxFrames` (the move's `charge.maxChargeFrames`), then the release
   * fires {@link fireNeutralChargeSpecial} with the accumulated frames.
   * Drives {@link getChargeProgress} so the {@link ChargeIndicator}
   * shows the real buildup. Cleared on fire, on teleport/respawn, and
   * whenever the fighter can no longer hold the charge.
   */
  private chargingSpecial: {
    moveId: string;
    framesHeld: number;
    maxFrames: number;
  } | null = null;

  /**
   * Active hold-to-charge state for a grounded SMASH carrying a `charge`
   * ramp. Mirrors {@link chargingSpecial} but for smashes: non-null between
   * the press that starts charging and the release/cap that fires it.
   * `framesHeld` climbs one per tick while a smash trigger stays held and
   * the fighter is grounded; at `maxFrames` the smash AUTO-FIRES (unlike a
   * special, which stores at the cap). `facing` is latched at charge-start
   * so a mid-charge stick wiggle can't flip the smash. Drives
   * {@link getChargeProgress}; cleared on fire, mid-charge hit, and respawn.
   */
  private chargingSmash: {
    moveId: string;
    pattern: 'smash' | 'usmash' | 'dsmash';
    facing: 1 | -1;
    framesHeld: number;
    maxFrames: number;
  } | null = null;

  /**
   * Banked neutral-special charge — the Samus "charge-cancel" / store
   * mechanic. Set when the player shield-cancels an in-progress charge:
   * the accumulated frames are stashed here and PERSIST across actions
   * (walking, jumping, other moves) until the next neutral-special press
   * either fires them (a banked FULL charge fires on press) or resumes
   * charging from the banked level (a banked PARTIAL charge). Wiped only
   * by being hit WHILE actively charging (a held bank survives hits, the
   * Smash idiom) and by respawn. Drives {@link getChargeProgress} so the
   * charge glow stays lit while the shot is banked — the visible proof
   * that "the charge is kept". Mutually exclusive with
   * {@link chargingSpecial}: at most one is non-null at a time.
   */
  private storedSpecialCharge: { moveId: string; framesHeld: number } | null =
    null;

  /**
   * Transient damage hitboxes NOT tied to the active-attack lifecycle —
   * currently the down-special dive LANDING SHOCKWAVE. Each is a short-
   * lived `HITBOX_LABEL` sensor that the scene's HitboxDamageHandler
   * resolves into an `applyHit` exactly like the active-attack hitbox;
   * {@link tickTransientHitboxes} counts each down and despawns it.
   */
  private transientHitboxes: Array<{
    body: MatterJS.BodyType;
    framesRemaining: number;
  }> = [];

  /**
   * Placed down-special TRAPS (Cat's mine). Each sits inert for
   * `armDelay` frames, then spawns an armed `HITBOX_LABEL` sensor at its
   * fixed placement point that detonates on contact (per-body deduped, so
   * each foe trips it once) until `lifetime` frames elapse. Independent of
   * the active attack — the trap outlives Cat's placement animation —
   * so {@link tickTraps} runs every frame. `maxActive` FIFO-evicts.
   */
  private activeTraps: Array<{
    x: number;
    y: number;
    facing: 1 | -1;
    framesSinceSpawn: number;
    armDelay: number;
    lifetime: number;
    damage: number;
    knockback: AttackMove['knockback'];
    width: number;
    height: number;
    maxActive: number;
    moveId: string;
    body: MatterJS.BodyType | null;
    // Timed-bomb extension (Samus): self-bounce velocity applied to the placer
    // on detonation (null = none / contact-mine trap).
    selfBounceVelocity: number | null;
    // True once a fused bomb has detonated + applied its self-bounce, so the
    // bounce is a one-shot even if the blast sensor lingers a few frames.
    detonated: boolean;
  }> = [];

  /**
   * Whether the in-flight down-special dive has already fired its landing
   * shockwave. Latches the burst to exactly once per dive and, once set,
   * freezes the dive's per-frame plunge physics (the motion is done).
   * Reset when a fresh dive enters its active window.
   */
  private diveShockwaveSpawned = false;

  /**
   * Frames the in-flight dive has been HELD active past its authored
   * window while plunging (see {@link DIVE_MAX_HOLD_FRAMES}). Reset when a
   * fresh dive enters its active window.
   */
  private diveHoldFrames = 0;

  /**
   * Index of the NEXT rung to fire in an in-flight multi-hit ladder
   * (side-special `multiHit` / up-special `multiHitRising`). Reset to 0
   * when a ladder move enters its active window; advanced once per rung
   * spawned by {@link tickMultiHitLadder}. The rung sensors themselves
   * live in {@link transientHitboxes}.
   */
  private multiHitNextIndex = 0;

  /**
   * Latched on a successful counter PARRY (an incoming hit absorbed inside
   * a counter move's window) — carries the absorbed damage so the next
   * tick can scale the retaliation hitbox. Set in {@link applyHit},
   * consumed by {@link tickCounterRetaliation}. `null` when no parry is
   * pending. Serves neutral (Wolf/Aegis) and down (Bear) counters alike.
   */
  private pendingCounterRetaliation: { absorbedDamage: number } | null = null;

  /**
   * HELPLESS / free-fall state. Set when a committal aerial special ends in
   * the air (Owl's `directionalJump.helplessAfterBurst`, an airborne
   * `dashStrike.helplessAfterDash` / `commandDash.helplessOnWhiff`, or
   * `stallAndFall.helplessAfterFall`). While true the fighter cannot
   * attack / special / jump — only drift — until it touches the ground (or
   * a ledge), matching the Smash "you're in special-fall, get back to the
   * stage" lockout. Cleared on ground contact and on respawn.
   */
  private helpless = false;

  /**
   * One-shot RENDER signal: set the frame a down-special dive lands (at
   * its shockwave) and cleared by {@link consumeDiveLandingEvent}. The
   * render layer polls it to flash a landing burst even on a whiffed dive
   * (which fires no collisionstart, so no hit spark would otherwise show).
   * Render-only — never read by the deterministic sim.
   */
  private diveLandingEvent: { x: number; y: number; facing: 1 | -1 } | null =
    null;

  /**
   * Frames remaining before the next attack can begin. Decremented
   * once per `applyInput` call. While `activeAttack !== null` this is
   * always 0 — the cooldown only starts ticking *after* the move's
   * recovery phase completes.
   */
  private cooldownRemaining = 0;

  /**
   * Accumulated damage percent (Sub-AC 4.1). Starts at 0; each hit
   * pushes it up by the move's `damage` value (clamped at
   * `MAX_DAMAGE_PERCENT`). Drives knockback magnitude — heavier hits
   * land harder when the target's percent is already high.
   */
  private damagePercent = 0;

  /**
   * Frames the fighter is locked out of player control (Sub-AC 4.1).
   * Counts down once per `applyInput` call. While > 0 the input layer
   * is ignored — no horizontal accel, no jump, no attack — and
   * velocity damping is suppressed so the knockback vector carries
   * the body cleanly through the air. Cooldown still drains.
   */
  private hitstunRemaining = 0;

  /**
   * TUMBLE: set when a hit launches this fighter hard enough
   * (≥ {@link TUMBLE_KNOCKBACK_THRESHOLD}). While tumbling, touching a
   * surface resolves into a TECH or a KNOCKDOWN. Cleared on the resolve
   * frame and on respawn.
   */
  private tumbling = false;
  /** Frames a buffered tech press is still live (see {@link TECH_WINDOW_FRAMES}). */
  private techBufferRemaining = 0;
  /** Frames a mistimed tech locks out further teching (see {@link TECH_LOCKOUT_FRAMES}). */
  private techLockoutRemaining = 0;
  /** Frames of a missed-tech KNOCKDOWN (prone lockout) remaining; 0 = not knocked down. */
  private knockdownRemaining = 0;
  /** Frames of an active tech-roll / get-up-roll remaining; 0 = not rolling. */
  private getupRollRemaining = 0;
  /** Horizontal direction of the active get-up roll. */
  private getupRollDir: 1 | -1 = 1;

  /**
   * Smash-style fast-fall latch. Set when the stick is pushed down
   * during a descent (vy > 0 while airborne); vy snaps to
   * `tuning.fastFallSpeed` and stays capped there until the latch
   * clears — on landing, on a fresh jump impulse, or when hitstun
   * starts (a launched fighter must follow the knockback arc, not a
   * stale fast-fall).
   */
  private fastFallLatched = false;

  /**
   * Variable-jump-height latch. Armed on a jump impulse; while armed,
   * releasing the jump button mid-rise clamps vy to
   * `jumpImpulse * jumpCutFactor` (the SHORT HOP). Cleared once the
   * rise ends (vy ≥ 0), on landing, or when hitstun starts — so an
   * upward LAUNCH (knockback, not a jump) can never be jump-cut by an
   * idle jump button.
   */
  private jumpCutArmed = false;

  /**
   * Frames elapsed since the jump impulse that armed {@link jumpCutArmed}.
   * The cut only applies while this is within
   * {@link JUMP_CUT_WINDOW_FRAMES} — Smash-style: a TAP (release inside
   * the window) short-hops, while releasing later in the rise keeps
   * the full jump height. Without the window, releasing the button at
   * ANY point of the rise clipped the jump to 40% height, which made
   * tap-style jumps unable to clear the floating platforms at all.
   */
  private jumpCutFrames = 0;

  /**
   * Hitlag freeze frames remaining on this defender after a confirmed
   * hit (post-M2 hit-feel pass). Drains in `applyInput` BEFORE the
   * normal per-frame logic; while > 0 the fighter's velocity is
   * pinned at zero, attack timers don't tick, hitstun doesn't drain,
   * and inputs are ignored. The "freeze frame" effect that gives
   * heavy hits visual weight and prevents the hit character from
   * mashing back instantly. When this counter reaches zero the
   * pending knockback velocity + hitstun are applied (see
   * {@link pendingKnockback}).
   */
  private hitlagRemaining = 0;

  /**
   * Knockback queued by `applyHit` that will be applied when
   * `hitlagRemaining` drains to zero. Storing `vector` and
   * `hitstunFrames` as a single record (not separate fields) means we
   * can null-check once and either apply both atomically or skip the
   * whole release. `null` outside an active hitlag window.
   */
  private pendingKnockback: {
    readonly vector: { readonly x: number; readonly y: number };
    readonly hitstunFrames: number;
  } | null = null;

  /** SDI displacement (px) spent this hitlag freeze; capped at {@link SDI_MAX_TOTAL_PX}. Reset per hit. */
  private sdiSpentPx = 0;
  /** Whether the stick was beyond the SDI threshold last freeze frame — rising-edge gate so each flick nudges once. */
  private sdiPrevBeyond = false;

  /**
   * Respawn-grace invincibility frames (Sub-AC 4.2 of AC 302).
   *
   * Set by the respawn flow (typically 90 frames = 1.5 s at 60 Hz) when
   * the fighter re-enters the stage after losing a stock. While > 0:
   *   • `applyHit()` is a no-op — incoming hits do not add damage,
   *     produce knockback, or apply hitstun.
   *   • The fighter still moves, jumps, attacks, and (importantly) can
   *     still cross a blast-zone boundary — invincibility protects from
   *     hits, NOT from running off the stage.
   *
   * Decremented once per `applyInput` call regardless of hitstun state
   * so the timer drains in real time even if the player happens to be
   * mid-knockback when they spawn.
   */
  private invincibilityRemaining = 0;

  /** Set on `destroy()` so listeners and removed bodies don't double-fire. */
  private destroyed = false;

  private collisionStartListener: ((event: CollisionEventLike) => void) | null = null;
  private collisionEndListener: ((event: CollisionEventLike) => void) | null = null;

  /**
   * Frame counter remaining during which the character should pass
   * through ANY pass-through platform it touches — armed by the rapid
   * double-tap-down gesture (`input.dropThrough === true`). Read by
   * the scene-level pass-through-platform driver each frame to set
   * platform masks; decremented each `applyInput` tick.
   */
  private dropThroughFramesRemaining = 0;

  constructor(scene: Phaser.Scene, options: CharacterOptions) {
    this.scene = scene;
    this.id = options.id;
    // AC 10302 Sub-AC 2 — latch the optional combat → audio sink.
    // `undefined` (omitted by callers that haven't yet wired audio)
    // collapses to `null` so the per-frame emit calls have a single
    // value to test against. Fighter overrides this post-construction
    // via {@link setSfxSink} when its own constructor was passed a sink.
    this.sfxSink = options.sfxSink ?? null;

    // Merge defaults with caller overrides. Spread order matters:
    //   1. Non-movement base defaults (geometry + defensive tunings).
    //   2. Per-fighter movement profile resolved by id (Sub-AC 2.2 of
    //      the T2 refactor — speed, jump, air control, mass live on
    //      the per-fighter subclass via {@link FighterMovementProfile},
    //      not on the shared base class). For a `Character` instantiated
    //      via the per-fighter subclass (e.g. `new Wolf(...)`), the
    //      subclass has already merged its `WOLF_TUNING` (which spreads
    //      `WOLF_MOVEMENT_PROFILE`) over the options, so this lookup is
    //      idempotent — the same numbers land regardless. For a direct
    //      `new Character({ id: 'wolf' })` (test path), the lookup IS
    //      what supplies the movement values, since `DEFAULT_CHARACTER_TUNING`
    //      no longer carries them.
    //   3. Caller overrides (passed to the constructor) — explicit
    //      options always win over both layers above.
    this.tuning = {
      ...DEFAULT_CHARACTER_TUNING,
      ...getFighterMovementProfile(options.id),
      ...stripUndefined(options),
      // Resolve the partial `shield` slot into a fully-defaulted record
      // so the per-step tick can read tuning fields directly without
      // optional-chaining or re-resolution work each frame.
      shield: resolveShieldTuning(options.shield),
      // AC 60302 Sub-AC 2 — same treatment for the dodge slot.
      dodge: resolveDodgeTuning(options.dodge),
      // AC 60403 Sub-AC 3 — same treatment for the ledge slot. The
      // ledge-detection record is a flat tuning bundle (no per-variant
      // resolution required) so we just copy it verbatim with an empty
      // default fallback.
      ledge: resolveLedgeHangTuning(options.ledge),
      ledgeDetection: options.ledgeDetection ?? {},
    };

    // ---- Shield state machine (AC 60301 Sub-AC 1) -----------------------
    // Idle / full HP at construction. The match-start scene flow drops
    // fighters into the world before any input arrives, so a fresh
    // shield is exactly what the contract demands.
    this.shieldState = createShieldState(this.tuning.shield);

    // ---- Dodge state machine (AC 60302 Sub-AC 2) ------------------------
    // Idle at construction — no dodge in flight, no cooldown. The
    // match-start flow drops fighters into the world before any input
    // arrives, mirroring the shield state's spawn contract.
    this.dodgeState = createDodgeState();

    // ---- Ground-locomotion state machine (Tier 5) ----------------------
    // Walk / dash / run / pivot / crouch. Speeds default relative to this
    // fighter's `maxRunSpeed` so a slow fighter's initial-dash stays under
    // its run speed. Starts standing, facing the ctor default.
    this.resolvedLocomotionTuning = resolveLocomotionTuning(
      this.tuning.locomotion,
      this.tuning.maxRunSpeed,
    );
    this.locomotionState = createLocomotionState(this.facing);

    // ---- Ledge-hang state machine (AC 60403 Sub-AC 3) -------------------
    // Idle at construction — no hang in flight, no re-grab cooldown.
    // The runtime feeds in stage geometry via setLedgeCandidates once
    // the stage is loaded; until then the geometric detection pass
    // iterates an empty list and the state machine stays idle.
    this.ledgeHangState = createLedgeHangState();

    // ---- Matter body ----------------------------------------------------
    // Single rectangle with chamfered corners — the chamfer keeps the
    // body from snagging on platform edges when the character runs off
    // a ledge or jumps onto a thin floating platform.
    //
    // friction / frictionAir are kept very low because we manage
    // horizontal velocity ourselves each step — letting Matter apply
    // its own decel would fight the controller and feel mushy.
    // Resolve and cache the slot index up-front. Fed into the body's
    // collision category so the scene-level pass-through driver can
    // phase platforms per-fighter without leaking the decision across
    // slots. Out-of-range values throw — better to fail loud at scene
    // start than to silently mis-collide every frame.
    const slotIndex = options.slotIndex ?? 0;
    if (
      !Number.isInteger(slotIndex) ||
      slotIndex < 0 ||
      slotIndex >= MAX_FIGHTER_SLOTS
    ) {
      throw new Error(
        `Character: slotIndex must be an integer in [0, ${MAX_FIGHTER_SLOTS}), ` +
          `got ${slotIndex}.`,
      );
    }
    this.slotIndex = slotIndex;
    const slotBit = CHARACTER_SLOT_BITS[slotIndex]!;

    this.body = scene.matter.add.rectangle(
      options.spawnX,
      options.spawnY,
      this.tuning.width,
      this.tuning.height,
      {
        label: CHARACTER_LABEL,
        chamfer: this.tuning.chamfer > 0 ? { radius: this.tuning.chamfer } : undefined,
        mass: this.tuning.mass,
        friction: 0.001,
        frictionStatic: 0,
        frictionAir: 0,
        restitution: 0,
        collisionFilter: {
          // Multi-bit category: the shared `CHARACTER` bit keeps every
          // hitbox / hazard / blast-zone matcher working unchanged,
          // while the slot bit lets the pass-through driver target
          // this fighter independently of any others on the platform.
          category: COLLISION_CATEGORIES.CHARACTER | slotBit,
          mask: COLLISION_MASKS.CHARACTER,
          group: 0,
        },
        // `plugin` is Matter's pass-through bag — handy for collision
        // callbacks that need to know which character a body belongs to
        // without a reverse-lookup table.
        plugin: { characterId: options.id },
      },
    );

    // Lock rotation so fighters always stand upright — we never want a
    // tumbling body in a Smash-style game. Matter exposes this via
    // `setInertia(body, Infinity)`; Phaser's `MatterBodyConfig` typing
    // doesn't surface the `inertia` option directly, so we apply it
    // post-construction.
    scene.matter.body.setInertia(this.body, Infinity);

    // ---- Collision listeners --------------------------------------------
    // Wire the listeners through the world (not the body) because Matter
    // emits events at the world level. We narrow to "involves us" inside
    // the handler; the cost of one identity check per pair is trivial
    // compared to the simplicity gain.
    this.collisionStartListener = (event: CollisionEventLike) =>
      this.onCollisionStart(event);
    this.collisionEndListener = (event: CollisionEventLike) =>
      this.onCollisionEnd(event);
    scene.matter.world.on('collisionstart', this.collisionStartListener);
    scene.matter.world.on('collisionend', this.collisionEndListener);
  }

  // -------------------------------------------------------------------------
  // Per-frame physics
  // -------------------------------------------------------------------------

  /**
   * Apply one fixed step of input. Must be called exactly once per
   * deterministic step (i.e. inside the `step` callback of
   * {@link import('../engine/PhysicsEngine').PhysicsEngine.advance}).
   *
   * Mutates the body's velocity directly via `Matter.Body.setVelocity`
   * so that subsequent `matter.world.step()` integration honours both
   * our movement intent and any external forces (gravity, knockback —
   * coming in a later sub-AC).
   */
  applyInput(input: CharacterInput): void {
    if (this.destroyed) return;

    // ---- Drop-through window bookkeeping ----------------------------------
    // Arm the temporary "ignore pass-through platforms" window when
    // the input layer reports a fresh double-tap-down gesture
    // (`input.dropThrough === true` for one frame). The collision-
    // active handler vetoes pass-through pairs while
    // `dropThroughFramesRemaining > 0`. 10 frames @ 60 Hz ≈ 167 ms —
    // long enough for the body to clear a thin platform's height even
    // at low fall speed, short enough that the window doesn't bleed
    // into the next platform below.
    if (input.dropThrough === true && this.isGrounded()) {
      this.dropThroughFramesRemaining = 10;
    }
    if (this.dropThroughFramesRemaining > 0) {
      this.dropThroughFramesRemaining -= 1;
    }

    // ---- Grabbed lockout (post-M2 M4.6 wiring) ----------------------------
    // While held by another fighter's grab, this character has no
    // input authority. The grabber's tick re-pins the body's
    // position each fixed step; we just zero the velocity here as
    // belt-and-suspenders so a stale impulse can't drift the body
    // between the grabbed-state set and the grabber's pin.
    if (this.grabbedBy !== null) {
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack ?? false;
      this.prevHeavyHeld = input.attackHeavy ?? false;
      this.prevSpecialHeld = input.special ?? false;
      this.prevShieldHeld = input.shield ?? false;
      this.prevDodgeHeld = input.dodge ?? false;
      this.prevGrabHeld = input.grab ?? false;
      return;
    }

    // ---- Hitlag freeze (post-M2 hit-feel pass) ----------------------------
    // While `hitlagRemaining > 0` both the defender and (eventually)
    // the attacker are visually frozen at the moment of impact. The
    // body's velocity is pinned at zero so the fighter doesn't drift
    // during the freeze; attack / hitstun / cooldown timers all skip
    // their per-frame ticks. On the frame the counter drains to zero
    // we apply the queued knockback velocity and arm hitstun so the
    // launch begins immediately after the freeze.
    //
    // Latch the input button states so a button held through hitlag
    // doesn't synthesise a rising-edge on the first free frame.
    if (this.hitlagRemaining > 0) {
      this.hitlagRemaining -= 1;
      // Pin position by zeroing velocity each freeze frame. `setVelocity`
      // (vs. mutating `.velocity`) keeps Matter's previous-position cache
      // coherent so the integrator doesn't blink on freeze-end.
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      // ---- SDI (Smash Directional Influence) ----------------------------
      // Only the VICTIM (the fighter with a queued launch) can SDI — the
      // attacker shares the freeze but has no pendingKnockback. Each FRESH
      // stick flick beyond the threshold (neutral → beyond, rising edge)
      // nudges position a few px in the stick direction, capped per freeze.
      // This is a position drift, NOT a trajectory change (that's DI, at
      // freeze-end) — it lets a victim wiggle out of a multi-hit.
      if (this.pendingKnockback) {
        const sdiX = input.moveX;
        const sdiY = input.moveY ?? 0;
        const len = Math.hypot(sdiX, sdiY);
        const beyond = len >= SDI_STICK_THRESHOLD;
        if (
          beyond &&
          !this.sdiPrevBeyond &&
          this.sdiSpentPx < SDI_MAX_TOTAL_PX
        ) {
          const pos = this.body.position;
          this.scene.matter.body.setPosition(this.body, {
            x: pos.x + (sdiX / len) * SDI_NUDGE_PX,
            y: pos.y + (sdiY / len) * SDI_NUDGE_PX,
          });
          this.sdiSpentPx += SDI_NUDGE_PX;
        }
        this.sdiPrevBeyond = beyond;
      }
      if (this.hitlagRemaining === 0 && this.pendingKnockback) {
        // Directional Influence (DI) — sample the stick on the frame
        // hitlag drains to zero. The stick component perpendicular to
        // the launch direction rotates the angle by up to ±18°. A
        // stick parallel to the launch is a no-op; perpendicular gives
        // the maximum rotation. Magnitude is preserved so DI shifts
        // trajectory without changing kill power.
        const queued = this.pendingKnockback.vector;
        const magnitude = Math.hypot(queued.x, queued.y);
        let releaseVx = queued.x;
        let releaseVy = queued.y;
        if (magnitude > 0) {
          const launchAngle = Math.atan2(queued.y, queued.x);
          const stickX = input.moveX;
          const stickY = input.moveY ?? 0;
          if (stickX !== 0 || stickY !== 0) {
            const rotatedAngle = applyDIToLaunchAngle(launchAngle, {
              stickX,
              stickY,
            });
            releaseVx = magnitude * Math.cos(rotatedAngle);
            releaseVy = magnitude * Math.sin(rotatedAngle);
          }
        }
        this.scene.matter.body.setVelocity(this.body, {
          x: releaseVx,
          y: releaseVy,
        });
        this.hitstunRemaining = this.pendingKnockback.hitstunFrames;
        // A hard launch sends the fighter into TUMBLE — the state that can
        // be teched on ground contact (and otherwise knocks them down).
        this.tumbling = Math.hypot(releaseVx, releaseVy) >= TUMBLE_KNOCKBACK_THRESHOLD;
        this.pendingKnockback = null;
      }
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack ?? false;
      return;
    }

    // ---- Invincibility drain (Sub-AC 4.2) ---------------------------------
    // Drain the invincibility counter once per fixed step regardless of
    // hitstun state. We do this BEFORE the hitstun early-return so the
    // grace timer keeps ticking even if a re-spawning fighter somehow
    // arrives with residual hitstun (it shouldn't — `setPosition` clears
    // hitstun — but the contract holds either way).
    if (this.invincibilityRemaining > 0) {
      this.invincibilityRemaining -= 1;
    }

    // ---- Tumble resolution (launch → floor: tech / knockdown) -------------
    // Runs BEFORE — and independently of — hitstun so a fighter who exits
    // hitstun mid-flight still resolves on the frame they finally touch a
    // surface. While TUMBLING:
    //   • a buffered shield/dodge press TECHES on contact (intangible; a
    //     held direction makes it a directional tech-roll),
    //   • a press that drains before contact mistimes into a TECH-LOCKOUT
    //     (a re-press can't tech the real landing — anti-panic),
    //   • an un-teched landing is a KNOCKDOWN.
    // Once hitstun has ended, acting (jump / attack / dodge / special) out
    // of tumble cancels it — you DI'd / jumped out, mirroring Smash.
    if (this.tumbling) {
      const techPress =
        (input.shield === true && !this.prevShieldHeld) ||
        (input.dodge === true && !this.prevDodgeHeld);
      if (this.isGrounded()) {
        this.tumbling = false;
        this.hitstunRemaining = 0;
        const buffered = techPress || this.techBufferRemaining > 0;
        const teched = buffered && this.techLockoutRemaining === 0;
        this.techBufferRemaining = 0;
        const dir = clamp(input.moveX, -1, 1);
        if (teched) {
          if (Math.abs(dir) >= 0.5) {
            this.startGetupRoll(dir >= 0 ? 1 : -1); // directional tech-roll
          } else {
            this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
            this.setInvincibility(TECH_IFRAME_FRAMES); // tech-in-place
          }
        } else {
          this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
          this.knockdownRemaining = KNOCKDOWN_FRAMES; // missed → knocked down
        }
        this.prevJumpHeld = input.jump;
        this.prevAttackHeld = input.attack === true;
        this.prevHeavyHeld = input.attackHeavy === true;
        this.prevSpecialHeld = input.special === true;
        this.prevShieldHeld = input.shield === true;
        this.prevDodgeHeld = input.dodge === true;
        this.prevMoveX = clamp(input.moveX, -1, 1);
        this.prevMoveY = clamp(input.moveY ?? 0, -1, 1);
        this.prevGrounded = true;
        return;
      }
      // Airborne: buffer a fresh press; drain an old one into a lockout.
      if (techPress && this.techLockoutRemaining === 0 && this.techBufferRemaining === 0) {
        this.techBufferRemaining = TECH_WINDOW_FRAMES;
      }
      if (this.techBufferRemaining > 0) {
        this.techBufferRemaining -= 1;
        if (this.techBufferRemaining === 0) {
          this.techLockoutRemaining = TECH_LOCKOUT_FRAMES;
        }
      }
      if (this.techLockoutRemaining > 0) this.techLockoutRemaining -= 1;
      // Acting out of tumble (only reachable once hitstun has ended) clears
      // it; we fall through so the action fires this frame in normal flow.
      if (this.hitstunRemaining === 0) {
        const actOut =
          (input.jump === true && !this.prevJumpHeld) ||
          (input.attack === true && !this.prevAttackHeld) ||
          (input.attackHeavy === true && !this.prevHeavyHeld) ||
          (input.special === true && !this.prevSpecialHeld) ||
          (input.dodge === true && !this.prevDodgeHeld);
        if (actOut) {
          this.tumbling = false;
          this.techBufferRemaining = 0;
        }
      }
    }

    // ---- Hitstun lockout (Sub-AC 4.1) -------------------------------------
    // While in hitstun the player has no control: no acceleration, no
    // jump, no attack press. We still drain any pending attack
    // cooldown (so post-hitstun the fighter can attack immediately if
    // the cooldown ran out during the lockout) and we still latch the
    // current button states into `prevJumpHeld` / `prevAttackHeld` so
    // a button held throughout hitstun does NOT fire a rising-edge on
    // the first free frame — the player has to release and re-press.
    //
    // We deliberately do NOT damp velocity during hitstun: that's what
    // gives the knockback its arc. Matter's gravity will integrate the
    // upward component over the lockout, producing the "sent flying"
    // visual.
    if (this.hitstunRemaining > 0) {
      this.hitstunRemaining -= 1;
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack === true;
      this.prevHeavyHeld = input.attackHeavy === true;
      this.prevSpecialHeld = input.special === true;
      this.prevShieldHeld = input.shield === true;
      if (this.activeAttack === null && this.cooldownRemaining > 0) {
        this.cooldownRemaining -= 1;
      }
      // AC 60301 Sub-AC 1 — keep the shield state machine ticking even
      // during hitstun so a hit-released shield can regen on schedule
      // and a hit during shield-break stun keeps draining the stun
      // timer. The shield button is forced false during hitstun so a
      // mashed shield key doesn't latch into 'active' on the recovery
      // frame.
      this.shieldState = tickShield(
        this.shieldState,
        { held: false },
        this.tuning.shield,
      );
      // AC 60302 Sub-AC 2 — the dodge machine also keeps ticking
      // through hitstun (an in-flight roll's recovery / cooldown still
      // drain). The held / justPressed inputs are forced false so a
      // dodge key still pressed when hitstun ends does NOT auto-fire
      // a dodge on the recovery frame — the player has to release and
      // re-press, mirroring the jump / attack / shield contracts.
      this.dodgeState = tickDodge(
        this.dodgeState,
        {
          held: false,
          justPressed: false,
          moveX: 0,
          grounded: this.isGrounded(),
          facing: this.facing,
        },
        this.tuning.dodge,
      );
      this.prevDodgeHeld = input.dodge === true;
      // AC 60101 Sub-AC 1 — track the raw stick across hitstun frames
      // so the smash-flick detector reads the player's actual stick
      // motion through the lockout (no phantom flicks on the recovery
      // frame). Mirrors `prevAttackHeld` etc.
      this.prevMoveX = clamp(input.moveX, -1, 1);
      this.prevMoveY = clamp(input.moveY ?? 0, -1, 1);
      // Latch grounded state even during hitstun so the moment hitstun
      // releases we don't spuriously fire a "just landed" event from a
      // stale reading.
      this.prevGrounded = this.isGrounded();
      return;
    }

    // ---- Knockdown / prone lockout (a missed tech) -----------------------
    // The fighter lies prone: input locked, body pinned, and VULNERABLE
    // (no i-frames) — a real okizeme punish window. A get-up press (jump /
    // attack / a decisive stick tilt) stands early with brief
    // intangibility; otherwise it auto-stands when the timer drains.
    if (this.knockdownRemaining > 0) {
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      this.knockdownRemaining -= 1;
      const dir = clamp(input.moveX, -1, 1);
      const rollGetup = Math.abs(dir) >= 0.5;
      const attackGetup = input.attack === true && !this.prevAttackHeld;
      const getUp =
        (input.jump === true && !this.prevJumpHeld) ||
        attackGetup ||
        rollGetup ||
        this.knockdownRemaining === 0;
      if (getUp) {
        this.knockdownRemaining = 0;
        // Three flavours of wake-up, mirroring Smash okizeme:
        //   • hold a direction → roll-get-up (intangible, moves away)
        //   • press attack     → get-up attack (double-sided sweep)
        //   • neutral / timeout → stand in place with brief intangibility
        if (rollGetup) {
          this.startGetupRoll(dir >= 0 ? 1 : -1);
        } else if (attackGetup) {
          this.startGetupAttack();
        } else {
          this.setInvincibility(GETUP_IFRAME_FRAMES);
        }
      }
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack === true;
      this.prevHeavyHeld = input.attackHeavy === true;
      this.prevSpecialHeld = input.special === true;
      this.prevShieldHeld = input.shield === true;
      this.prevDodgeHeld = input.dodge === true;
      this.prevMoveX = clamp(input.moveX, -1, 1);
      this.prevMoveY = clamp(input.moveY ?? 0, -1, 1);
      this.prevGrounded = this.isGrounded();
      return;
    }

    // ---- Tech-roll / get-up-roll lockout ---------------------------------
    // A directional tech or roll-get-up: the fighter slides along the floor
    // (intangible — i-frames were set when the roll started) with input
    // otherwise locked until the roll frames drain.
    if (this.getupRollRemaining > 0) {
      this.getupRollRemaining -= 1;
      this.scene.matter.body.setVelocity(this.body, {
        x: this.getupRollDir * GETUP_ROLL_SPEED,
        y: 0,
      });
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack === true;
      this.prevHeavyHeld = input.attackHeavy === true;
      this.prevSpecialHeld = input.special === true;
      this.prevShieldHeld = input.shield === true;
      this.prevDodgeHeld = input.dodge === true;
      this.prevMoveX = clamp(input.moveX, -1, 1);
      this.prevMoveY = clamp(input.moveY ?? 0, -1, 1);
      this.prevGrounded = this.isGrounded();
      return;
    }

    // ---- Shield-break stun lockout (AC 60301 Sub-AC 1) --------------------
    // A broken shield's stun is a separate lockout class from hitstun:
    // the fighter is helpless (no movement / no attacks / no shield
    // raise) until the stun timer drains. Ticking the shield state
    // machine here decrements `stunRemaining` once per fixed step;
    // when it hits 0 the next call will see `'idle'` and resume normal
    // input. Held inputs are forced false so a shield key still held
    // when the stun ends does NOT instantly re-raise — the player has
    // to release and re-press, mirroring the hitstun contract.
    if (isShieldBroken(this.shieldState)) {
      this.shieldState = tickShield(
        this.shieldState,
        { held: false },
        this.tuning.shield,
      );
      // AC 60302 Sub-AC 2 — shield-break stun also locks out dodge
      // presses (the fighter is helpless). The dodge state machine
      // still ticks so any in-flight roll cooldown drains in real time.
      this.dodgeState = tickDodge(
        this.dodgeState,
        {
          held: false,
          justPressed: false,
          moveX: 0,
          grounded: this.isGrounded(),
          facing: this.facing,
        },
        this.tuning.dodge,
      );
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack === true;
      this.prevHeavyHeld = input.attackHeavy === true;
      this.prevSpecialHeld = input.special === true;
      this.prevShieldHeld = input.shield === true;
      this.prevDodgeHeld = input.dodge === true;
      // AC 60101 Sub-AC 1 — track the raw stick across shield-break
      // stun frames so the smash-flick detector reads the player's
      // actual stick motion through the lockout. Mirrors the hitstun
      // branch above.
      this.prevMoveX = clamp(input.moveX, -1, 1);
      this.prevMoveY = clamp(input.moveY ?? 0, -1, 1);
      if (this.activeAttack === null && this.cooldownRemaining > 0) {
        this.cooldownRemaining -= 1;
      }
      this.prevGrounded = this.isGrounded();
      return;
    }

    // ---- Shield tick (AC 60301 Sub-AC 1) ---------------------------------
    // Tick the shield state machine BEFORE motion / jump / attack so
    // the `'active'` flag set this frame can suppress all three.
    //
    // Rising-edge gate on the raise: the runtime feeds tickShield a
    // *masked* held flag so a fighter exiting the broken-stun lockout
    // (or hitstun) with the shield key still pressed does NOT auto-
    // re-raise. The mask is `held && (isShieldRaised || !prevShieldHeld)`:
    //
    //   • idle, prev=false, held=true   → masked=true  → raise (fresh press)
    //   • active, prev=true,  held=true → masked=true  → stay raised
    //   • active, prev=true,  held=false → masked=false → release / decay-stop
    //   • idle, prev=true,  held=true   → masked=false → stay idle (post-stun
    //                                                    or post-hitstun)
    //
    // tickShield itself stays "press = held" semantics so the pure
    // unit tests in `shieldState.test.ts` keep passing — the rising-
    // edge requirement is a runtime contract, not a state-machine one.
    const shieldHeld = input.shield === true;
    const shieldRaisedNow = isShieldRaised(this.shieldState);
    // User spec: shield can only be activated while grounded. Pressing
    // shield mid-air does nothing, AND a fighter who jumps (or is
    // launched) off a platform while shielding drops the shield as
    // soon as they leave the ground. We force the effective held flag
    // to false whenever airborne; the state machine treats that as
    // "shield released" and lowers the shield on the next tick.
    // Movement-while-shielding lockout (`moveXAfterShield = 0`) below
    // and knockback-absorption inside `applyHit` together cover the
    // user's "anchored, can't be pushed around" half of the spec.
    const groundedForShield = this.isGrounded();
    // ---- Out-of-shield (OoS) options -------------------------------------
    // From a raised shield (and NOT locked in shieldstun) the defender can
    // JUMP or GRAB directly, instantly dropping the shield. We detect the
    // intent BEFORE the tick and force the shield down THIS frame, so the
    // normal jump / grab paths below fire unobstructed (they're gated on
    // `!shieldRaised`). Shield-grab is the classic punish; jump-OoS feeds
    // every aerial / up-special escape. During shieldstun the shield is
    // locked and these are suppressed.
    const inShieldstunNow = isInShieldstun(this.shieldState);
    const canActOutOfShield = shieldRaisedNow && !inShieldstunNow;
    const oosJump =
      canActOutOfShield && input.jump === true && !this.prevJumpHeld;
    const oosGrab =
      canActOutOfShield && input.grab === true && !this.prevGrabHeld;
    const wantsOutOfShield = oosJump || oosGrab;
    const effectiveShieldHeld =
      groundedForShield &&
      shieldHeld &&
      (shieldRaisedNow || !this.prevShieldHeld) &&
      !wantsOutOfShield;
    // AC 10302 Sub-AC 2 — capture the shield state-name BEFORE the tick
    // so the post-tick comparison can detect a non-`'active'` →
    // `'active'` transition (the rising-edge raise) and voice the
    // shield SFX exactly once on the frame the shield comes up. Using
    // a state-name comparison (rather than the `prevShieldHeld` latch)
    // means a player who buffered the shield key through hitstun /
    // shield-break-stun and re-raises on the recovery frame still gets
    // the cue — the latch path's "auto-suppress" rule is about the
    // mechanic, not about the audio feedback.
    const shieldNameBefore = this.shieldState.name;
    this.shieldState = tickShield(
      this.shieldState,
      { held: effectiveShieldHeld },
      this.tuning.shield,
    );
    // Track how long the shield has been continuously raised — the
    // PERFECT SHIELD window (read in `applyHit`). Resets the instant the
    // shield isn't active, so a fresh raise next frame starts at 1.
    if (isShieldRaised(this.shieldState)) {
      this.shieldActiveFrames += 1;
    } else {
      this.shieldActiveFrames = 0;
    }
    // Fire the shield raise cue on the rising edge. The
    // {@link AudioManager}'s default 100 ms cooldown collapses
    // double-fires from a player who jitters the shield key on /
    // off / on inside a single audio frame — the simulation always
    // sees both presses, but the audio layer voices one cue.
    if (
      shieldNameBefore !== 'active' &&
      this.shieldState.name === 'active'
    ) {
      emitCombatSfx(this.sfxSink ?? undefined, ASSET_KEYS.sfxShield);
    }
    // The shield raise also cancels any in-flight attack: a player
    // who panic-shields out of recovery should be able to put the
    // shield up the same frame they panic. Mirrors Smash's "shield
    // cancels nothing in startup but anything in recovery" — we go a
    // half-step further and cancel the whole move because the unit
    // tests for the attack state machine read the absence of an
    // active attack as "fighter is free", and a raised shield is the
    // same kind of free-but-locked-out state.
    if (
      isShieldRaised(this.shieldState) &&
      !this.prevShieldHeld &&
      this.activeAttack !== null
    ) {
      this.cancelAttack();
      this.cooldownRemaining = 0;
    }

    const grounded = this.isGrounded();
    // `groundedForFall` is used ONLY by the fall-shaping pack below. It folds
    // in the scene driver's platform-support signal so that while the driver
    // is actively keeping this fighter on a thin pass-through platform, the
    // per-fighter `fallAccel` spike is suppressed — a momentary contact-sensor
    // flicker during the landing can't re-spike `vy` to `maxFallSpeed` and
    // tunnel the body back through (the pass-through platform jitter). The
    // flag is consumed here so it never leaks past the driver's support:
    // free-fall away from any platform behaves exactly as before. This never
    // gates jump/attack/grounded logic — only fall accel.
    const groundedForFall = grounded || this.platformFallSupported;
    this.platformFallSupported = false;
    // AC 60301 Sub-AC 1 — while the shield is raised, ignore directional
    // motion intent so the fighter roots in place (Smash convention:
    // shield disables walking / running / dashing). The `moveX` value
    // we feed downstream is forced to 0; the aerial classifier still
    // gets the *pre-shield* facing, so the few aerials that read
    // direction before the shield was up keep working.
    const shieldRaised = isShieldRaised(this.shieldState);
    const rawMoveX = clamp(input.moveX, -1, 1);
    const moveXAfterShield = shieldRaised ? 0 : rawMoveX;

    // AC 60102 Sub-AC 2 — capture state needed by the airborne attack
    // dispatcher BEFORE the horizontal-motion section flips facing on a
    // direction press. The aerial classifier needs to read the
    // *pre-input* facing so a player who holds left + attack while
    // facing right gets a back-aerial (bair) instead of a forward-
    // aerial (fair) — without this snapshot, facing would flip to -1
    // first and the classifier could never distinguish "stick toward
    // facing" from "stick away from facing".
    const prevFacing = this.facing;
    // Detect the airborne→grounded transition for the "lock attack
    // until completion or landing" half of Sub-AC 2: an aerial in
    // flight when we touch down is interrupted with landing-lag (or
    // auto-cancelled if the move's frame counter sits in an
    // auto-cancel window).
    const justLanded = !this.prevGrounded && grounded;
    // Touching the ground clears helpless free-fall — the fighter made it
    // back to the stage and can act again.
    if (grounded) this.helpless = false;
    // Landing refreshes the directional air-dodge.
    if (grounded) {
      this.airDodgeUsed = false;
      this.airDodgeBurst = null;
    }

    // AC 10304 — voice the landing thud on the airborne → grounded
    // transition. Three gates keep the cue honest:
    //
    //   1. The fighter must have been actually DESCENDING (`velocity.y >
    //      0`, downward in screen space) at touchdown. A real fall / jump
    //      arc always lands with downward velocity, so this fires the
    //      thud on every genuine landing — but a zero-velocity settle
    //      (a fighter spawned directly onto a respawn platform) makes no
    //      sound, which is the correct "they didn't fall, they appeared"
    //      feel.
    //
    //   2. Suppressed when the same frame carries a fresh jump press (a
    //      buffered land-cancel): the jump cue owns that frame, so we
    //      don't thud + hup together.
    //
    // A launched fighter crashing to the floor still thuds — its
    // knockback arc carries downward velocity. Fired from the
    // deterministic tick, so the replay re-derives identical timing.
    if (
      justLanded &&
      this.body.velocity.y > 0 &&
      !(input.jump && !this.prevJumpHeld)
    ) {
      emitCombatSfx(this.sfxSink ?? undefined, ASSET_KEYS.sfxLand);
    }

    // ---- Dodge tick (AC 60302 Sub-AC 2) ----------------------------------
    // Tick the dodge state machine BEFORE motion / jump / attack so any
    // active dodge can suppress all three this frame. The press classifier
    // reads the *pre-shield* `rawMoveX` so a player coming out of shield
    // with the dodge key tapped (a Smash-classic "shield-drop into roll")
    // still resolves to a roll based on their stick deflection — the
    // shield-raise gate above zeroed `moveXAfterShield` for motion only.
    //
    // Rising-edge press detection mirrors the jump / attack / shield
    // pattern: the press only fires on the rising edge AND only when no
    // suppression-class lockout (hitstun, shield-break stun) is active —
    // those early-return paths above handle their own latch updates so
    // the press cannot leak through.
    // User spec: shield is an "anchor" — no movement, no roll, no
    // attack out of it. Suppress dodge input while the shield is
    // raised so the canonical Smash "roll out of shield" gesture
    // doesn't fire (was being read as an unexpected "dash"). The
    // player has to release shield first, then dodge.
    const dodgeHeldThisFrame = input.dodge === true && !shieldRaised;
    const dodgeJustPressedRaw = dodgeHeldThisFrame && !this.prevDodgeHeld;
    // Air-dodge limit: only ONE directional air-dodge per airtime (reset on
    // land) so a directional burst can't be spammed into infinite recovery.
    const dodgeJustPressed =
      dodgeJustPressedRaw && !(!grounded && this.airDodgeUsed);
    const dodgeFacingForPress: 1 | -1 =
      dodgeJustPressed && rawMoveX !== 0
        ? rawMoveX > 0
          ? 1
          : -1
        : this.facing;
    const dodgeStateBefore = this.dodgeState;
    this.dodgeState = tickDodge(
      this.dodgeState,
      {
        held: dodgeHeldThisFrame,
        justPressed: dodgeJustPressed,
        moveX: rawMoveX,
        grounded,
        facing: dodgeFacingForPress,
      },
      this.tuning.dodge,
    );

    // Directional air-dodge: on the air-dodge START frame, capture a velocity
    // burst from the stick (null = neutral → keep the in-place stall) and spend
    // this airtime's air-dodge. The burst is applied + decayed during the
    // active phase just before the velocity commit below.
    if (dodgeJustPressed && !grounded && this.dodgeState.active?.kind === 'air') {
      this.airDodgeUsed = true;
      const sx = rawMoveX;
      const sy = clamp(input.moveY ?? 0, -1, 1);
      const mag = Math.hypot(sx, sy);
      this.airDodgeBurst =
        mag >= AERIAL_STICK_THRESHOLD
          ? {
              x: (sx / mag) * AIRDODGE_BURST_SPEED,
              y: (sy / mag) * AIRDODGE_BURST_SPEED,
            }
          : null;
    }

    // Grab state machine (post-M2 grab/throw subsystem). Drives the
    // grabber-side state progression AND the runtime side effects:
    //   • Sensor spawn / despawn on whiffStartup → whiffActive →
    //     {whiffRecovery, holding} transitions.
    //   • Target pinning while holding (the target's body is moved
    //     to the grabber's contact point each fixed step).
    //   • Throw-release damage application via `target.applyHit`
    //     on the holding → throwing → cooldown frame transition.
    if (this.grabSpec !== null) {
      const grabHeldThisFrame = input.grab === true;
      // A grab fires only with the shield DOWN. A shield-grab works
      // because an OoS grab dropped the shield this very frame (above),
      // so `shieldRaised` already reads false here; a grab attempt while
      // LOCKED in shieldstun (shield still up) is correctly suppressed.
      const grabJustPressed =
        grabHeldThisFrame && !this.prevGrabHeld && !shieldRaised;
      // DASH GRAB: a grab started while running fast (and on a spec that
      // declares a dashGrab) carries forward momentum + reaches further.
      // Latched here; the momentum carry + range shift read the latch
      // below. Same speed gate as the dash-attack discriminator. A
      // shield-grab is from a standstill (shield roots movement) so this
      // reads false there — the `!shieldRaised` gate above is untouched.
      if (grabJustPressed && this.grabSpec.dashGrab != null) {
        const grabMovingFast =
          Math.abs(this.body.velocity.x) >
          this.tuning.maxRunSpeed * DASH_SPEED_FRACTION;
        if (grabMovingFast) {
          this.dashGrabActive = true;
          this.dashGrabEntryVx = this.body.velocity.x;
        }
      }
      const grabInput: GrabInput = {
        grabPressed: grabJustPressed,
        grounded,
        // Pummel on a rising-edge attack press while holding a victim
        // (was hard-coded false, so every fighter's authored pummel never
        // fired). tickGrab gates it on the holding state + pummel cooldown.
        pummelPressed: input.attack === true && !this.prevAttackHeld,
        throwDirection: this.readThrowDirectionInput(input),
      };
      const before = this.grabState;
      this.grabState = tickGrab(before, grabInput, this.grabSpec);
      this.prevGrabHeld = grabHeldThisFrame;
      this.handleGrabStateTransition(before, this.grabState);
      // While holding, pin the target's body to the grabber's
      // contact-point offset each frame so it can't drift.
      if (this.grabState.name === 'holding' && this.grabTarget !== null) {
        const offsetX = this.grabSpec.hitbox.offsetX * this.facing;
        const targetX = this.body.position.x + offsetX;
        const targetY = this.body.position.y + this.grabSpec.hitbox.offsetY;
        this.scene.matter.body.setPosition(this.grabTarget.body, {
          x: targetX,
          y: targetY,
        });
        this.scene.matter.body.setVelocity(this.grabTarget.body, { x: 0, y: 0 });
      }
      // The dash-grab latch lives only for the duration of one grab; once
      // the machine is back to idle, the next grab is standing unless it
      // re-qualifies as a dash on its own press.
      if (this.grabState.name === 'idle') {
        this.dashGrabActive = false;
      }
    }
    // Detect a "dodge just started this frame" transition. We look at
    // the *before vs after* states because the press classification
    // logic lives inside `tickDodge` (a press on a frame the cooldown
    // is still draining is silently rejected — we want to find that
    // out from the resulting state, not by re-implementing the gate).
    const dodgeJustStarted =
      dodgeStateBefore.name !== 'active' && this.dodgeState.name === 'active';

    if (dodgeJustStarted) {
      // Snap facing to the rolled direction so the active-dodge
      // snapshot's `facing` and the runtime's `Character.facing` agree.
      // The dodge module already locked this in; mirror it on the
      // class instance so the (later AC) renderer / animation layer
      // and the aerial-attack classifier read the same value.
      if (this.dodgeState.active !== null) {
        this.facing = this.dodgeState.active.facing;
      }
      // Dodge cancels any in-flight attack — getting out is more
      // important than finishing the swing. Clearing the cooldown
      // alongside it means the post-dodge punish window isn't padded
      // by the swing's recovery cooldown.
      if (this.activeAttack !== null) {
        this.cancelAttack();
        this.cooldownRemaining = 0;
      }
      // AC 10302 Sub-AC 2 — fire the dodge SFX on the dodge state-
      // machine's non-active → active transition. We re-use the
      // existing `dodgeJustStarted` flag (computed for facing latching)
      // rather than introducing a parallel detector, so the audio
      // event and the gameplay transition share one source of truth.
      // Covers all three variants — spot dodge, roll, and air dodge —
      // because the state machine collapses them all to the `'active'`
      // name. The {@link AudioManager}'s default 100 ms cooldown
      // collapses bursts from a player who somehow re-presses the
      // dodge key inside the same animation frame.
      emitCombatSfx(this.sfxSink ?? undefined, ASSET_KEYS.sfxDodge);
    }

    // While the dodge state machine is acting (active or recovery), it
    // owns the fighter's motion / attack / jump intent. The shield is
    // forced down for the duration: a player who started a dodge with
    // shield held should NOT keep shielding through the dodge — the
    // dodge IS the defensive option for that frame.
    const dodgeLocking = isDodgeLockingInput(this.dodgeState);

    // ---- Ledge-hang tick (AC 60403 Sub-AC 3) -----------------------------
    // Tick the ledge-hang state machine BEFORE motion / jump / attack so
    // a hang locks all three the same frame the geometric detection pass
    // confirmed the latch. The detection pass only fires if the fighter
    // is airborne, descending, AND the re-grab cooldown has cleared —
    // those checks live on the pure module side so the runtime stays
    // a thin coordinator.
    //
    // The pending force-release flag is consumed here (and cleared
    // afterwards) so a hit that punched through the i-frame window in
    // the prior frame's `applyHit` cleanly drops the hang on the next
    // tick. We compose the explicit `ledgeRelease` input with the
    // implicit force-release so a player who taps "drop" on the same
    // frame an opponent hits the i-frame tail still gets a clean exit.
    let ledgeReleased: LedgeReleaseAction | null = null;
    let climbingTransitionCompleted: { x: number; y: number; side: 'left' | 'right' } | null =
      null;
    // AC 60404 Sub-AC 4 — capture for the ledge-roll completion. When
    // the `'rolling'` state ends the runtime translates the body onto
    // the platform top, offset further inward by `rollDistance` than the
    // climb (the roll travels visibly past the corner to convey the
    // "evasive roll lands past the ledge" semantic).
    let rollingTransitionCompleted: { x: number; y: number; side: 'left' | 'right' } | null =
      null;
    {
      const ledgeDetection = this.computeLedgeDetection();
      const ledgeInput: LedgeHangInput = {
        detection: ledgeDetection,
        // Humans never set the explicit `ledgeRelease` field — derive the
        // release action from the raw stick/buttons while hanging so a
        // keyboard/gamepad player can get-up / roll / jump / attack / drop
        // off the ledge (previously only the AI's explicit action worked,
        // so a human grabbed a ledge and hung there forever).
        release: input.ledgeRelease ?? this.deriveLedgeReleaseFromInput(input),
        forceRelease: this.pendingLedgeForceRelease,
        airborne: !grounded,
        facing: this.facing,
      };
      const prevState = this.ledgeHangState;
      const ledgeTick = tickLedgeHang(
        this.ledgeHangState,
        ledgeInput,
        this.tuning.ledge,
      );
      const wasIdleOrCooldown =
        prevState.name === 'idle' || prevState.name === 'cooldown';
      this.ledgeHangState = ledgeTick.state;
      ledgeReleased = ledgeTick.released;
      this.pendingLedgeForceRelease = false;

      // Climb completion — the previous tick was 'climbing' and we just
      // rolled out of it. Capture the latch point + side so the post-
      // commit translation (below) can place the fighter on top of the
      // platform at the canonical "feet on top" position.
      if (
        prevState.name === 'climbing' &&
        prevState.active !== null &&
        this.ledgeHangState.name !== 'climbing'
      ) {
        // Capture the CORNER coordinates (not the latch coordinates) so
        // the post-climb translation places the fighter on top of the
        // platform rather than at the hang latch point.
        climbingTransitionCompleted = {
          x: prevState.active.candidate.x,
          y: prevState.active.candidate.y,
          side: prevState.active.candidate.side,
        };
      }
      // AC 60404 Sub-AC 4 — ledge-roll completion. Mirrors the climb
      // completion above, but the post-commit translation also offsets
      // by `rollDistance` so the fighter lands further inward than a
      // standard get-up (the visible "evasive roll" overshoot).
      if (
        prevState.name === 'rolling' &&
        prevState.active !== null &&
        this.ledgeHangState.name !== 'rolling'
      ) {
        rollingTransitionCompleted = {
          x: prevState.active.candidate.x,
          y: prevState.active.candidate.y,
          side: prevState.active.candidate.side,
        };
      }

      // Snap the body to the latch point on a fresh hang. The state
      // machine's `'hanging'` snapshot carries `latchX` / `latchY`
      // computed by the detection pass; we apply them once on the
      // transition so the fighter visually "snaps to" the ledge corner.
      if (
        wasIdleOrCooldown &&
        this.ledgeHangState.name === 'hanging' &&
        this.ledgeHangState.active !== null
      ) {
        // A fresh ledge-grab cancels any in-flight attack — the latch
        // reads as a hard interrupt, mirroring the dodge / shield
        // contracts.
        if (this.activeAttack !== null) {
          this.cancelAttack();
          this.cooldownRemaining = 0;
        }
        // Lock the body to the latch point. Velocity is zeroed so the
        // fighter doesn't drift mid-hang.
        this.scene.matter.body.setPosition(this.body, {
          x: this.ledgeHangState.active.latchX,
          y: this.ledgeHangState.active.latchY,
        });
        this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
        // Reset the air-jump budget — a fresh ledge grab is the
        // canonical recovery point, so the fighter can air-jump out of
        // the hang on release without the budget being exhausted by
        // the recovery up-special they used to reach the ledge.
        this.jumpsUsed = 0;
        // A fresh grab also resets descent shaping — a fast-fall latch
        // or armed jump-cut must not survive into (or past) the hang.
        this.fastFallLatched = false;
        this.jumpCutArmed = false;
        // Lock facing to the ledge's "into the stage" side so the
        // fighter visually faces inward (a left-side ledge grab faces
        // right, a right-side ledge grab faces left).
        this.facing =
          this.ledgeHangState.active.candidate.side === 'left' ? 1 : -1;
      }
    }
    const ledgeLocking = isLedgeLockingInput(this.ledgeHangState);
    // Charge ROOT. BOTH a grounded neutral-special charge (the Samus
    // cannon) and a grounded smash charge PLANT the fighter — you cannot
    // walk while charging (Samus charges rooted in place; jump is also
    // suppressed below, and the charge cannot progress in the air, so the
    // whole charge is a committed, stationary, grounded action). A BANKED
    // (shield-stored) charge does NOT root — that is the point of storing.
    const rootedByCharge =
      (this.chargingSpecial !== null || this.chargingSmash !== null) &&
      this.isGrounded();
    // A fighter mid-grab (whiff / holding / throwing a victim) is committed:
    // it can pummel + throw (handled in the grab block above) but cannot
    // walk, jump, or swing a normal until the grab resolves.
    const grabActing = this.grabSpec !== null && isGrabActing(this.grabState);
    const moveX =
      dodgeLocking || ledgeLocking || rootedByCharge || grabActing
        ? 0
        : moveXAfterShield;

    // ---- Ground-locomotion tick (Tier 5) ---------------------------------
    // Advance the locomotion machine with the POST-lockout `moveX` (a
    // raised shield / dodge / charge / grab already zeroed it → resolves to
    // 'standing', so a lockout neither dashes nor flips facing). The machine
    // owns the grounded TARGET velocity + facing; the integrator below is
    // unchanged. Standing/crouch carry the runtime facing, so this can never
    // clobber a dodge/ledge/charge-owned facing.
    const locoInput = {
      moveX,
      moveY: clamp(input.moveY ?? 0, -1, 1),
      prevMoveX: this.prevLocoMoveX,
      grounded,
      facing: this.facing,
    };
    this.locomotionState = tickLocomotion(
      this.locomotionState,
      locoInput,
      this.resolvedLocomotionTuning,
    );
    this.prevLocoMoveX = moveX;

    // Apply ledge-release physics for actions that resolved this tick.
    if (ledgeReleased !== null) {
      this.applyLedgeReleasePhysics(ledgeReleased);
    }

    // ---- Horizontal motion -------------------------------------------------
    let vx = this.body.velocity.x;
    const accel = grounded ? this.tuning.groundAccel : this.tuning.airAccel;
    const damping = grounded ? this.tuning.groundDamping : this.tuning.airDamping;

    // AC 60302 Sub-AC 2 — dodge motion overrides player input.
    //   • A roll's active phase forces vx to slideSpeed × facing so the
    //     fighter slides cleanly in the rolled direction regardless of
    //     stick input or residual knockback.
    //   • A spot / air dodge active phase zeros vx — the fighter
    //     "freezes" in place for the duration of the i-frame window.
    //   • Recovery phase preserves whatever vx was committed at the end
    //     of the active window so a roll's slide carries naturally to a
    //     stop via the normal damping path.
    const dodgeSlide = getDodgeSlideVelocity(this.dodgeState, this.tuning.dodge);
    if (this.dodgeState.name === 'active') {
      if (dodgeSlide !== null) {
        vx = dodgeSlide;
      } else {
        // Spot / air dodge — root the fighter in place.
        vx = 0;
      }
    } else if (grounded) {
      // ---- GROUNDED — locomotion-driven (Tier 5) -----------------------
      // The locomotion machine supplies the TARGET (walk / dash / run) or
      // `null` (standing / crouch / pivot → damp). The per-step integrator
      // is byte-identical to the legacy path so the first-frame-`groundAccel`
      // and terminal-`maxRunSpeed` contracts hold; only the TARGET (and the
      // facing source) changed.
      const target = getLocomotionTargetVx(
        this.locomotionState,
        locoInput,
        this.resolvedLocomotionTuning,
      );
      if (target !== null) {
        const delta = target - vx;
        if (Math.abs(delta) <= accel) {
          vx = target;
        } else {
          vx += accel * Math.sign(delta);
        }
        // Knockback can leave us above max speed; ease back toward it.
        if (Math.abs(vx) > this.tuning.maxRunSpeed) {
          vx *= damping;
        }
      } else {
        // standing / crouch / pivot → damp toward rest. A pivot skid
        // decelerates harder (its own damping) so the turnaround stops crisply.
        const decel = isPivoting(this.locomotionState)
          ? this.resolvedLocomotionTuning.pivotDamping
          : damping;
        vx *= decel;
        if (Math.abs(vx) < 0.01) vx = 0;
      }
      // Facing is locomotion-owned on the ground (standing/crouch carry the
      // current facing, so a lockout-set facing is never clobbered).
      this.facing = getLocomotionFacing(this.locomotionState);
    } else if (Math.abs(moveX) > 0.0001) {
      // ---- AIRBORNE — legacy proportional air-drift (unchanged) --------
      const targetVx = moveX * this.tuning.maxRunSpeed;
      const delta = targetVx - vx;
      if (Math.abs(delta) <= accel) {
        vx = targetVx;
      } else {
        vx += accel * Math.sign(delta);
      }
      if (Math.abs(vx) > this.tuning.maxRunSpeed) {
        vx *= damping;
      }
      this.facing = moveX > 0 ? 1 : -1;
    } else {
      // Airborne, stick neutral — damp toward rest.
      vx *= damping;
      if (Math.abs(vx) < 0.01) vx = 0;
    }

    // DASH GRAB momentum carry — a grab started out of a run slides
    // forward at the retained run-entry velocity through its WHIFF (the
    // pre-connect startup/active/recovery), instead of `grabActing`
    // damping it to rest. Phase-gated to the whiff so it never fights the
    // target-pin during 'holding' / 'throwing' / 'cooldown'. Clamped to
    // maxRunSpeed so a knockback-inflated entry can't launch a super-grab.
    if (
      this.dashGrabActive &&
      this.grabSpec?.dashGrab != null &&
      (this.grabState.name === 'whiffStartup' ||
        this.grabState.name === 'whiffActive' ||
        this.grabState.name === 'whiffRecovery')
    ) {
      const retained =
        this.dashGrabEntryVx * this.grabSpec.dashGrab.momentumRetain;
      const cap = this.tuning.maxRunSpeed;
      vx = Math.max(-cap, Math.min(cap, retained));
    }

    // ---- Jump (rising edge) ------------------------------------------------
    // AC 60301 Sub-AC 1 — jump press is suppressed while the shield is
    // raised. The shield's "root in place" contract extends to vertical
    // motion; the player has to release the shield to jump.
    //
    // AC 60302 Sub-AC 2 — jump press is also suppressed while a dodge
    // is acting (active or recovery). Dodge owns the fighter's motion
    // / attack / jump intent for its duration; the player cannot jump-
    // cancel out of a dodge.
    //
    // The held-state latch still updates (handled at the end of the
    // call) so a shield- or dodge-released jump press on the next
    // frame still reads as a fresh rising edge.
    let vy = this.body.velocity.y;
    const jumpJustPressed =
      !shieldRaised &&
      !dodgeLocking &&
      !ledgeLocking &&
      !this.helpless &&
      !grabActing &&
      // Charging a grounded SMASH or NEUTRAL-SPECIAL (Samus cannon) fully
      // roots the fighter — no jump while charging. The charge is a
      // committed, stationary, grounded action: to act, release it (fire)
      // or shield-store the charge first.
      !(
        (this.chargingSmash !== null || this.chargingSpecial !== null) &&
        grounded
      ) &&
      input.jump &&
      !this.prevJumpHeld;
    // The jump impulse, extracted so an immediate jump and a buffered
    // tap-jump (below) drive byte-identical state.
    const applyJumpImpulse = (): void => {
      vy = -this.tuning.jumpImpulse;
      this.jumpsUsed += 1;
      // Arm the variable-height cut for THIS rise and clear any
      // fast-fall latch — a fresh jump always starts a clean arc.
      this.jumpCutArmed = true;
      this.jumpCutFrames = 0;
      this.fastFallLatched = false;
      // AC 10304 — voice the jump cue on the impulse frame. The first
      // jump off a platform (`jumpsUsed === 1` after the increment)
      // gets the full "hup"; every air / multi-jump after it gets the
      // lighter variant so a triple-jumper doesn't hammer the heavy cue
      // three times in one rise. Fired from the deterministic tick so
      // the cadence is a pure function of the input stream (the replay
      // re-derives identical timing); the AudioManager's wall-clock
      // cooldown only decides whether a given call produces sound.
      emitCombatSfx(this.sfxSink ?? undefined, mapJumpToSfxKey(this.jumpsUsed));
    };

    // Fresh attack rising-edge (light or heavy), read here for the tap-jump
    // buffer; the same edge drives the grounded up-attack dispatch later, so a
    // press that cancels the buffer ALSO fires the up-tilt / up-smash.
    const attackEdgeForJump =
      (input.attack === true && !this.prevAttackHeld) ||
      (input.attackHeavy === true && !this.prevHeavyHeld);

    // ---- Tap-jump buffer ---------------------------------------------------
    // Resolve any in-flight buffer from a prior frame's ambiguous up+jump.
    if (this.tapJumpBufferFrames > 0) {
      const preempted =
        attackEdgeForJump ||
        !grounded ||
        shieldRaised ||
        dodgeLocking ||
        ledgeLocking ||
        grabActing ||
        this.hitstunRemaining > 0;
      if (preempted) {
        // An attack converted it to a grounded up-attack, or a state change
        // pre-empted it — drop the buffered jump.
        this.tapJumpBufferFrames = 0;
      } else {
        this.tapJumpBufferFrames -= 1;
        if (
          this.tapJumpBufferFrames === 0 &&
          this.jumpsUsed < this.tuning.maxJumps
        ) {
          applyJumpImpulse();
        }
      }
    }

    if (jumpJustPressed && this.jumpsUsed < this.tuning.maxJumps) {
      const rawMoveY = input.moveY ?? 0;
      const rawMoveX = input.moveX ?? 0;
      // Same up-stick test that gates the grounded up-attack dispatch, so the
      // buffer engages exactly when an up-attack could follow.
      const upStickHeld =
        rawMoveY <= -DEFAULT_NEUTRAL_THRESHOLD &&
        Math.abs(rawMoveY) >= Math.abs(rawMoveX);
      const hasUpAttack = this.upTiltId !== null || this.upSmashId !== null;
      if (grounded && upStickHeld && hasUpAttack) {
        // Ambiguous up+jump (the up key is also the jump key): hold the jump so
        // a follow-up attack can convert it to an up-tilt / up-smash. If attack
        // is pressed the SAME frame, do nothing here — the grounded dispatch
        // fires the up-attack and the jump is suppressed outright.
        if (!attackEdgeForJump) {
          this.tapJumpBufferFrames = TAP_JUMP_BUFFER_FRAMES;
        }
      } else {
        // Unambiguous jump (no up-stick, airborne, or no up-attack): instant.
        applyJumpImpulse();
      }
    }

    // Reset the jump budget when grounded *and* not in the middle of a
    // fresh jump impulse. Checking `vy >= 0` avoids the resetting
    // happening on the same frame we just kicked off the ground.
    if (grounded && vy >= 0) {
      this.jumpsUsed = 0;
    }

    // ---- Vertical motion shaping (Smash-feel pack) -------------------------
    // Three per-fighter descent mechanics, all suspended during hitstun
    // so a knockback launch follows its ballistic arc untouched (the
    // "do NOT damp velocity during hitstun" contract extends to fall
    // shaping):
    //
    //   1. SHORT HOP / variable jump height — while `jumpCutArmed`,
    //      releasing the jump button mid-rise clamps the climb to
    //      `jumpImpulse * jumpCutFactor`. Tap = short hop, hold = full
    //      jump. The arm flag (set only by a real jump impulse) is what
    //      keeps an upward LAUNCH from ever being cut by an idle button.
    //
    //   2. FAST-FALL — pushing the stick down during a descent latches
    //      the fast-fall: vy snaps to `fastFallSpeed` and stays capped
    //      there until landing / a fresh jump / hitstun. The latch (vs
    //      a per-frame check) means easing the stick back to neutral
    //      mid-drop does NOT pop the fighter back to normal fall speed,
    //      matching the Smash contract.
    //
    //   3. PER-FIGHTER GRAVITY + TERMINAL VELOCITY — `fallAccel` adds
    //      descent-only acceleration on top of global Matter gravity
    //      (floaty Owl 0.16 vs fast-falling Cat 0.38) and `maxFallSpeed`
    //      clamps the result, giving every fall a readable terminal
    //      velocity where raw Matter had none. Rise speed is untouched
    //      so jump heights keep their pre-pack tuning.
    if (this.hitstunRemaining === 0) {
      if (this.jumpCutArmed) {
        this.jumpCutFrames += 1;
        if (this.jumpCutFrames > JUMP_CUT_WINDOW_FRAMES) {
          // Past the short-hop decision window — the jump is committed
          // to full height regardless of when the button is released
          // (Smash semantics: only an EARLY release short-hops).
          this.jumpCutArmed = false;
        } else {
          const cutSpeed = this.tuning.jumpImpulse * this.tuning.jumpCutFactor;
          if (!input.jump && vy < -cutSpeed) {
            vy = -cutSpeed;
            // The cut fired — the short hop is decided; disarm so a
            // re-press during the same rise can't re-clip anything.
            this.jumpCutArmed = false;
          }
        }
        // Rise ended some other way (apex, landing) — disarm. NOT on
        // `grounded`, because the support contact lingers through the
        // jump frame itself (Matter's collisionend lags a frame), and
        // clearing there would kill the arm before the first airborne
        // step.
        if (vy >= 0) {
          this.jumpCutArmed = false;
        }
      }
      if (!groundedForFall) {
        const stickY = input.moveY ?? 0;
        if (!ledgeLocking && !this.fastFallLatched && vy > 0 && stickY > 0.6) {
          this.fastFallLatched = true;
        }
        // Capture the entry velocity BEFORE shaping: the terminal
        // clamp may cap our own gravity/fallAccel acceleration, but it
        // must never REDUCE a velocity something external (a downward
        // wind gust, a hazard shove) already injected above terminal —
        // that would silently nullify the hazard.
        const entryVy = vy;
        if (vy > 0) {
          vy += this.tuning.fallAccel;
        }
        const terminal = this.fastFallLatched
          ? this.tuning.fastFallSpeed
          : this.tuning.maxFallSpeed;
        // Fast-fall snaps DOWN to its terminal velocity the moment the
        // latch engages (Smash-style instant drop), then both paths
        // share the same cap.
        if (this.fastFallLatched && vy > 0 && vy < terminal) {
          vy = terminal;
        }
        const cap = Math.max(terminal, entryVy);
        if (vy > cap) {
          vy = cap;
        }
      } else {
        this.fastFallLatched = false;
      }
    } else {
      // Hitstun owns the velocity — drop both latches so the launch
      // arc can't inherit a stale fast-fall or jump-cut.
      this.fastFallLatched = false;
      this.jumpCutArmed = false;
    }

    // ---- Ledge-hang freeze (AC 60403 Sub-AC 3) ----------------------------
    // While `'hanging'` or `'climbing'`, the body is locked to the ledge
    // latch point. Velocity is forced to zero each step so gravity (or
    // residual knockback) doesn't drift the fighter off the corner. The
    // body position is re-snapped to `(latchX, latchY)` every step so a
    // moving-platform ledge that drifts under us keeps us pinned.
    //
    // We deliberately apply this AFTER the jump section above so a
    // `'jump'`-release ledgeReleased that fired this same tick wins (the
    // release transitioned us out of `'hanging'`, so `ledgeLocking` is
    // already false here).
    if (
      ledgeLocking &&
      this.ledgeHangState.active !== null
    ) {
      vx = 0;
      vy = 0;
      this.scene.matter.body.setPosition(this.body, {
        x: this.ledgeHangState.active.latchX,
        y: this.ledgeHangState.active.latchY,
      });
    }

    // ---- Directional air-dodge burst ---------------------------------------
    // During an air-dodge's active phase, override velocity with the captured
    // directional burst, fading it each frame so it reads as a burst that
    // decays (not a constant slide). Neutral air-dodges (no burst) keep the
    // in-place stall set in the horizontal block above.
    if (
      this.dodgeState.name === 'active' &&
      this.dodgeState.active?.kind === 'air' &&
      this.airDodgeBurst !== null
    ) {
      vx = this.airDodgeBurst.x;
      vy = this.airDodgeBurst.y;
      this.airDodgeBurst = {
        x: this.airDodgeBurst.x * AIRDODGE_BURST_DECAY,
        y: this.airDodgeBurst.y * AIRDODGE_BURST_DECAY,
      };
    }

    // ---- Commit velocity ---------------------------------------------------
    // Phaser's Matter wrapper exposes the BodyFactory at `scene.matter.body`.
    // Using setVelocity (vs mutating `body.velocity` directly) keeps
    // Matter's previous-position cache in sync so integration stays
    // stable.
    this.scene.matter.body.setVelocity(this.body, { x: vx, y: vy });

    // ---- Climb-up translation (AC 60403 Sub-AC 3) -------------------------
    // The climb animation just finished — translate the fighter onto
    // the platform top at the inward side of the ledge so the climb
    // ends with the fighter standing on the stage, not floating at the
    // latch point. The state machine has already rolled to `'cooldown'`
    // at this point so the lock-in-place loop above does NOT fight
    // this translation.
    if (climbingTransitionCompleted !== null) {
      const inwardOffset = this.tuning.width;
      const climbX =
        climbingTransitionCompleted.side === 'left'
          ? climbingTransitionCompleted.x + inwardOffset / 2
          : climbingTransitionCompleted.x - inwardOffset / 2;
      // Place the fighter's body centre so its bottom sits on the
      // platform top: (latchY at platform top) - halfHeight.
      const climbY =
        climbingTransitionCompleted.y - this.tuning.height / 2;
      this.scene.matter.body.setPosition(this.body, { x: climbX, y: climbY });
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    }

    // ---- Roll-up translation (AC 60404 Sub-AC 4) --------------------------
    // Mirrors the climb-up translation above but offset further inward
    // by the ledge tuning's `rollDistance`. The fighter lands past the
    // corner — the visible payoff of the "evasive roll" recovery option.
    if (rollingTransitionCompleted !== null) {
      const inwardOffset = this.tuning.width;
      const rollOffset = this.tuning.ledge.rollDistance;
      const rollX =
        rollingTransitionCompleted.side === 'left'
          ? rollingTransitionCompleted.x + inwardOffset / 2 + rollOffset
          : rollingTransitionCompleted.x - inwardOffset / 2 - rollOffset;
      const rollY =
        rollingTransitionCompleted.y - this.tuning.height / 2;
      this.scene.matter.body.setPosition(this.body, { x: rollX, y: rollY });
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    }

    // ---- Attack state machine (AC 202 Sub-AC 2 + Sub-AC 3.3 +
    // ----                       AC 60102 Sub-AC 2) ------------------------
    // The attack tick runs *after* velocity commit so the hitbox spawn
    // position reads the body's just-updated centre when phase rolls
    // into 'active' on a frame the fighter is moving forward.
    //
    // We pass the *post-jump-commit* grounded state so a press that
    // lands on the take-off frame fires the aerial — the fighter is no
    // longer touching the floor by the time their attack resolves.
    // Conversely, the moment a falling fighter lands, the next press
    // fires the grounded light/heavy variant.
    //
    // AC 60102 Sub-AC 2 additions: `moveX` and `prevFacing` drive the
    // airborne directional-aerial classifier (nair / fair / bair); the
    // post-commit `grounded` value compared against `prevGrounded`
    // (captured at the top of the call as `justLanded`) detects the
    // touchdown that interrupts an in-flight aerial.
    // AC 60301 Sub-AC 1 — while the shield is raised, attack presses
    // are suppressed so the player can't swing out of shield (Smash's
    // shield-cancel-into-attack is a separate mechanic that lands with
    // the buffered grab / OoS up-special — out of scope here). The
    // tickAttack call still runs so an in-flight attack continues to
    // tick down (e.g. cooldown drain after a swing the player shielded
    // out of recovery on).
    //
    // AC 60302 Sub-AC 2 — same suppression while a dodge is acting
    // (active or recovery): dodge owns the fighter's intent, so a
    // mashed attack key during the dodge does NOT swing. The latch on
    // `prevAttackHeld` still updates so the FIRST attack press after
    // the dodge resolves still reads as a fresh rising edge.
    // A HELPLESS fighter (free-fall after a committal aerial special —
    // Owl's burst recovery, an air dashStrike / stallAndFall / commandDash
    // whiff) cannot attack, special, or jump until it touches the ground;
    // it only keeps limited air drift. Same suppression shape as shield.
    const helpless = this.helpless;
    const attackHeldEffective =
      !shieldRaised && !dodgeLocking && !ledgeLocking && !helpless && !grabActing && input.attack === true;
    const heavyHeldEffective =
      !shieldRaised &&
      !dodgeLocking &&
      !ledgeLocking &&
      !helpless &&
      !grabActing &&
      input.attackHeavy === true;
    // T1 (AC 5-9) — special-press dispatch. Same suppression gates as
    // attack/heavy: while a shield is raised, while a dodge is acting,
    // or while a ledge-hang locks input, a special press is consumed
    // by the defensive state machine instead of triggering an attack.
    // Stick direction at press time selects the slot:
    //   neutral (no horizontal/vertical commit) → executeNeutralSpecial
    //   side (|moveX| past threshold)           → executeSideSpecial
    //   up (input.jump latched as up-flick)     → executeUpSpecial
    //   down (input.dropThrough or downHeld)    → executeDownSpecial
    // The press is rising-edge — `prevSpecialHeld` latches at the end
    // of applyInput() for next-frame edge detection.
    const specialHeldEffective =
      !shieldRaised &&
      !dodgeLocking &&
      !ledgeLocking &&
      !helpless &&
      !grabActing &&
      input.special === true;
    // Directional input leniency: classify up/down attacks off the
    // most-extreme vertical stick over a short backward window, not just
    // the exact press frame (a flick-up a frame or two early still fires
    // the up-air / up-tilt). The window includes the current frame.
    const curMoveY = input.moveY ?? 0;
    this.recentMoveY.push(curMoveY);
    if (this.recentMoveY.length > DIRECTIONAL_INPUT_WINDOW) {
      this.recentMoveY.shift();
    }
    let bufferedMoveY = curMoveY;
    for (const v of this.recentMoveY) {
      if (Math.abs(v) > Math.abs(bufferedMoveY)) bufferedMoveY = v;
    }
    // Down-special fires on a held DOWN-stick, not only the drop-through
    // gesture. Without the stick read, holding down + special fell through to
    // the NEUTRAL special — so e.g. Nova's bomb (down-B) was unreachable and a
    // down+special gave the CANNON CHARGE (neutral-B) instead. (+moveY = down
    // in screen-space; same 0.3 threshold the down-tilt/down-smash use.)
    const downSpecialHeld =
      input.dropThrough === true || bufferedMoveY >= DEFAULT_NEUTRAL_THRESHOLD;
    this.tickAttack(
      attackHeldEffective,
      heavyHeldEffective,
      this.isGrounded(),
      moveX,
      prevFacing,
      justLanded,
      specialHeldEffective,
      downSpecialHeld,
      // Up-special is reachable via the up-stick too, not only the jump
      // button — on a gamepad, jump (button 0) and the up-stick are separate
      // inputs, so a stick-only up+special would otherwise fall through to the
      // NEUTRAL special. Mirrors the down-special stick read above.
      input.jump === true || bufferedMoveY <= -DEFAULT_NEUTRAL_THRESHOLD,
      shieldHeld,
      bufferedMoveY,
    );

    // Latch the jump / attack / grounded state for next frame's edge
    // detection. Grounded is latched LAST so the same frame's
    // tickAttack can still see "just landed" via the captured
    // `justLanded` boolean above.
    this.prevJumpHeld = input.jump;
    this.prevAttackHeld = input.attack === true;
    this.prevHeavyHeld = input.attackHeavy === true;
    // T1 (AC 5-9) — latch special-button state for next frame's edge
    // detection. Latched at the end of applyInput so the per-frame
    // press → dispatch pipeline reads `prevSpecialHeld === false`
    // exactly once per fresh press.
    this.prevSpecialHeld = input.special === true;
    this.prevShieldHeld = shieldHeld;
    // AC 60101 Sub-AC 1 — latch the *raw* clamped stick X (not the
    // post-shield / post-dodge zeroed value) so the smash-flick
    // detector reads the player's true stick motion across frames.
    // A held stick that was masked off by a shield-raise frame must
    // not trigger a phantom flick when the shield drops.
    this.prevMoveX = rawMoveX;
    this.prevMoveY = curMoveY;
    // AC 60302 Sub-AC 2 — latch the dodge button state so next frame's
    // press detection only fires on a fresh rising edge. Latch the
    // RAW `input.dodge`, not the shield-gated `dodgeHeldThisFrame` —
    // otherwise a player who's been holding dodge throughout a shield
    // would get a phantom dodge fire on the frame they release shield
    // (the gated value was false during shield, so the rising-edge
    // detector would falsely see "just pressed" once the gate lifts).
    this.prevDodgeHeld = input.dodge === true;
    this.prevGrounded = this.isGrounded();
  }

  // -------------------------------------------------------------------------
  // Attack registry scaffolding (AC 202 Sub-AC 2 + Sub-AC 3 of the T2 refactor)
  //
  // The base class only owns the *storage scaffolding* for the moveset
  // — a Map keyed by move id and the dispatch-slot fields the
  // input-routing helpers read. Per-fighter subclasses (Wolf, Cat, Owl,
  // Bear) decide which slot a move belongs to via the type-aware helper
  // exported from `attackRegistration.ts`; the base class is type-blind
  // about move taxonomy. This keeps Sub-AC 3's invariant holding: zero
  // attack-implementation code (move-data routing) on the base class.
  // -------------------------------------------------------------------------

  /**
   * Insert a move into this fighter's moveset map. The base class does
   * NOT inspect the move's `type` to choose a dispatch slot — that is
   * the per-fighter subclass's responsibility (it calls into the
   * type-aware helper exported from `attackRegistration.ts`, which
   * walks `move.type` and invokes the appropriate `set*` slot setter).
   *
   * Public so the per-fighter helper, hot-swap tests, and the (later
   * AC) move-editor tool can populate the registry without reaching
   * into the protected field directly.
   */
  addAttack(move: AttackMove): void {
    this.attacks.set(move.id, move);
  }

  /**
   * Predicate — true iff a move with `id` is in the moveset map. Used
   * by the per-fighter helper before it calls the slot setters (which
   * throw on unknown ids) so the helper can keep the same fail-fast
   * contract the legacy registration path enforced.
   */
  hasAttack(id: string): boolean {
    return this.attacks.has(id);
  }

  /** Replace the default attack id used on `attack` rising-edge presses. */
  setDefaultAttack(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set default to unregistered attack '${id}'`);
    }
    this.defaultAttackId = id;
  }

  /**
   * Read the current default attack id (the rising-edge `attack`-button
   * fallback). Returns `null` when no fighter-owned move has been added
   * yet — the per-fighter slot-wiring helper consults this getter to
   * implement the "first-registered move becomes the default" contract
   * without needing privileged access to the private field.
   */
  getDefaultAttackId(): string | null {
    return this.defaultAttackId;
  }

  // -------------------------------------------------------------------------
  // AC 4 (T2 refactor) — slot override API for the T3 item framework
  //
  // Items declare which {@link AttackMovesetSlotName} slot(s) they replace
  // and install a callback per slot via {@link setSlotOverride}. The
  // per-fighter `execute<Slot>` hooks consult the override map BEFORE
  // firing the fighter's authored slot move; on item drop / break /
  // despawn the inventory module clears the overrides via
  // {@link clearSlotOverride} / {@link clearAllSlotOverrides}.
  //
  // Why not store an `AttackMove` record? Because items vary in what
  // they do per slot — a bat swing is a Matter hitbox spawn, a ray gun
  // shot is a projectile entity, a bomb throw is a free-body launch —
  // and a single canonical "fire the move" callback covers all three
  // without per-item-category special cases inside the dispatcher.
  // The callback owns its own runtime side effects (durability tick,
  // audio cue, projectile spawn, inventory clear-on-break, …).
  //
  // Open / closed: a hypothetical 4th item subclass installs its
  // callbacks through this same API — zero edits to Character or to
  // the dispatcher are needed. The Seed's `extensibility_invariant`
  // exit condition rests on this contract.
  // -------------------------------------------------------------------------

  /**
   * Install a temporary slot override. The supplied callback fires when
   * the input dispatcher routes a press to the named slot, BEFORE the
   * fighter's authored slot move runs. Returning `true` consumes the
   * press; returning `false` falls through to the fighter's native
   * move (lets a partial-override item decline a press it can't
   * service — empty clip, on cooldown, etc.).
   *
   * Idempotent — calling twice for the same slot replaces the previous
   * callback. The inventory module is responsible for clearing
   * overrides at item drop / break / despawn.
   */
  setSlotOverride(
    slot: AttackMovesetSlotName,
    fire: () => boolean,
  ): void {
    this.slotOverrides.set(slot, fire);
  }

  /**
   * Remove a previously-installed slot override. No-op if no override
   * is currently set for the slot. Called by the inventory module on
   * item drop / break / despawn so the fighter's native slot move
   * runs again.
   */
  clearSlotOverride(slot: AttackMovesetSlotName): void {
    this.slotOverrides.delete(slot);
  }

  /**
   * Bulk-clear every installed slot override. Convenience for the
   * inventory module on item-detach (a held item replaces multiple
   * slots; one call here drops them all).
   */
  clearAllSlotOverrides(): void {
    this.slotOverrides.clear();
  }

  /**
   * Read the currently-installed override callback for a slot, or
   * `null` if no override is set. Per-fighter `execute<Slot>` hooks
   * call this and, if non-null, fire the callback first.
   */
  getSlotOverride(
    slot: AttackMovesetSlotName,
  ): (() => boolean) | null {
    return this.slotOverrides.get(slot) ?? null;
  }

  /**
   * Run the slot override (if any) and report whether it consumed the
   * press. Helper used by per-fighter `execute<Slot>` hooks: the hook
   * calls this first, returning early on `true`, otherwise falling
   * through to its native slot move.
   */
  protected runSlotOverride(slot: AttackMovesetSlotName): boolean {
    const cb = this.slotOverrides.get(slot);
    if (!cb) return false;
    return cb();
  }

  /**
   * AC 10302 Sub-AC 2 — wire (or clear) the combat → audio sink that
   * voices `jab` / `tilt` / `smash` / `aerial` / `shield` / `dodge` SFX
   * from inside the per-frame physics tick.
   *
   * Most production paths pass the {@link AudioManager} via the
   * constructor's `sfxSink` option; this setter exists so {@link Fighter}
   * (which constructs its Character through a factory that doesn't
   * thread arbitrary options) can attach the same sink post-
   * construction without needing a new factory signature. Tests use it
   * to swap in a recorder fake mid-life.
   *
   * Pass `null` to detach. The next combat event becomes a silent no-op
   * via the {@link emitCombatSfx} guard. Idempotent.
   */
  setSfxSink(sink: CombatSfxSink | null): void {
    this.sfxSink = sink;
  }

  /** AC 10302 Sub-AC 2 — read the currently-attached audio sink (or `null`). */
  getSfxSink(): CombatSfxSink | null {
    return this.sfxSink;
  }

  /**
   * Register the per-fighter grab spec (post-M2 grab/throw subsystem).
   * Each per-character subclass calls this in its constructor with
   * the same authored {@link GrabSpec} that the data-file pipeline
   * also surfaces (e.g. `WOLF_GRAB`). Validates the spec eagerly so a
   * misauthored grab record fails at construction rather than the
   * first press.
   *
   * Pass `null` to clear (the character will ignore grab presses).
   */
  setGrabSpec(spec: GrabSpec | null): void {
    if (spec !== null) {
      validateGrabSpec(spec);
    }
    this.grabSpec = spec;
  }

  /** Read the currently-registered grab spec (or `null`). */
  getGrabSpec(): GrabSpec | null {
    return this.grabSpec;
  }

  /** Read-only snapshot of the live grab state-machine record. */
  getGrabState(): GrabState {
    return this.grabState;
  }

  /** True while the in-flight grab was started out of a run (a dash grab). */
  isDashGrabbing(): boolean {
    return this.dashGrabActive;
  }

  /**
   * True iff this character is currently being held by another
   * fighter's grab. While true, all input is ignored and the body's
   * position is pinned by the grabber each fixed step.
   */
  isGrabbed(): boolean {
    return this.grabbedBy !== null;
  }

  /**
   * The character currently holding this one in a grab, or `null` if
   * not grabbed. Read-only — runtime state is mutated through
   * {@link applyGrabbed} / {@link releaseFromGrab}.
   */
  getGrabbedBy(): Character | null {
    return this.grabbedBy;
  }

  /**
   * Mark this character as grabbed by `grabber`. Called by the
   * scene's hit-resolve callback when a grab range-sensor connects.
   * The grabber side calls {@link applyGrabConnect} on its own state
   * machine in parallel.
   *
   * No-op for destroyed or already-grabbed targets (defensive
   * against duplicate collision events).
   */
  applyGrabbed(grabber: Character): void {
    if (this.destroyed) return;
    if (this.grabbedBy !== null) return;
    this.grabbedBy = grabber;
    // Cancel any in-flight attack — the target was caught mid-swing.
    this.cancelAttack();
    this.cooldownRemaining = 0;
    // Clear hitstun / hitlag — the target is now in a different
    // captive state.
    this.hitstunRemaining = 0;
    this.hitlagRemaining = 0;
    this.pendingKnockback = null;
    // Pin velocity at zero so the body doesn't drift between frames
    // while the grabber's tick re-pins position each step.
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
  }

  /**
   * Release this character from a grab. Called when the grabber's
   * state machine transitions out of `'holding'` (throw release,
   * mash-out, force break, KO).
   */
  releaseFromGrab(): void {
    this.grabbedBy = null;
  }

  /**
   * Read the player's throw-direction press from the input snapshot
   * while in the `'holding'` state. Maps the stick deflection (and a
   * dedicated jump press for "up throw") to one of four
   * {@link ThrowDirection}s. Returns `null` if the stick is in the
   * deadzone — the grab continues to drain holdFramesMax.
   *
   * The convention:
   *   • stickY < -0.3 → 'up'
   *   • stickY >  0.3 → 'down'
   *   • stickX in facing direction → 'forward'
   *   • stickX against facing       → 'back'
   *   • else → null
   */
  private readThrowDirectionInput(input: CharacterInput): ThrowDirection | null {
    if (this.grabState.name !== 'holding') return null;
    const moveY = input.moveY ?? 0;
    if (moveY < -0.3) return 'up';
    if (moveY > 0.3) return 'down';
    const moveX = input.moveX;
    if (moveX > 0.3) return this.facing === 1 ? 'forward' : 'back';
    if (moveX < -0.3) return this.facing === 1 ? 'back' : 'forward';
    return null;
  }

  /**
   * Side-effect handler for grab-state transitions. Spawns / despawns
   * the Matter range-sensor body on the appropriate transitions and
   * fires the throw-release damage when a throw resolves to cooldown.
   */
  private handleGrabStateTransition(
    before: GrabState,
    after: GrabState,
  ): void {
    if (this.grabSpec === null) return;
    const enteredWhiffActive =
      before.name !== 'whiffActive' && after.name === 'whiffActive';
    const leftWhiffActive =
      before.name === 'whiffActive' && after.name !== 'whiffActive';
    if (enteredWhiffActive) {
      // A DASH GRAB reaches further: shift the range hitbox forward by
      // `rangeBonusX` (a shallow spec clone — spawnGrabHitbox still mirrors
      // offsetX by facing, so the bonus extends the reach in front).
      const spawnSpec =
        this.dashGrabActive && this.grabSpec.dashGrab != null
          ? {
              ...this.grabSpec,
              hitbox: {
                ...this.grabSpec.hitbox,
                offsetX:
                  this.grabSpec.hitbox.offsetX + this.grabSpec.dashGrab.rangeBonusX,
              },
            }
          : this.grabSpec;
      this.grabHitboxBody = spawnGrabHitbox(
        this.scene as unknown as HitboxScene,
        {
          id: this.id,
          position: this.body.position,
          bodyId: this.body.id,
        },
        spawnSpec,
        this.facing,
      );
    }
    if (leftWhiffActive && this.grabHitboxBody !== null) {
      despawnHitbox(this.scene as unknown as HitboxScene, this.grabHitboxBody);
      this.grabHitboxBody = null;
    }
    // throwing → cooldown transition fires the throw release.
    const throwReleased =
      before.name === 'throwing' && after.name === 'cooldown';
    if (throwReleased && this.grabTarget !== null) {
      const dir = before.active?.throwDirection;
      if (dir !== null && dir !== undefined) {
        const throwSpec = getThrowByDirection(this.grabSpec.throws, dir);
        // Apply damage + knockback to the target via the standard
        // hit pipeline so existing combat math (percent scaling,
        // hitlag, etc.) all fire identically to a regular hit.
        this.grabTarget.releaseFromGrab();
        // Back throw launches the victim BEHIND the grabber — flip the
        // facing the knockback's +x mirrors against, so a back-throw's
        // positive knockback.x sends them the opposite way from a forward
        // throw (previously every throw used `this.facing`, so back-throw
        // launched the wrong direction).
        this.grabTarget.applyHit({
          damage: throwSpec.damage,
          knockback: throwSpec.knockback,
          facing: (dir === 'back' ? -this.facing : this.facing) as 1 | -1,
        });
        this.grabTarget = null;
      }
    }
    // Mash-out / break paths — clear the link without firing damage.
    const heldToCooldownNoThrow =
      before.name === 'holding' && after.name === 'cooldown';
    if (heldToCooldownNoThrow && this.grabTarget !== null) {
      this.grabTarget.releaseFromGrab();
      this.grabTarget = null;
    }
  }

  /**
   * Hook for the scene's hit-resolve callback: runtime calls this
   * when a grab range-sensor connects with a target body. Runs both
   * sides of the connect in one step:
   *   • grabber.grabState transitions whiffActive → holding
   *   • target.applyGrabbed(grabber) so the target enters captive state
   *
   * No-op if not currently in `whiffActive` (defensive against
   * duplicate collision events).
   */
  resolveGrabConnect(target: Character): void {
    if (this.grabState.name !== 'whiffActive') return;
    if (target.isGrabbed()) return;
    this.grabState = applyGrabConnect(this.grabState);
    this.grabTarget = target;
    target.applyGrabbed(this);
    if (this.grabHitboxBody !== null) {
      despawnHitbox(this.scene as unknown as HitboxScene, this.grabHitboxBody);
      this.grabHitboxBody = null;
    }
  }

  /**
   * Sub-AC 3.3 — explicitly set / clear the light attack dispatch slot.
   * Use when a roster registers several `'jab'`/`'tilt'` moves and
   * wants a non-first one as the press-attack-on-ground default.
   *
   * Throws on unknown ids so a typo in a subclass constructor surfaces
   * immediately instead of silently dropping the press.
   */
  setLightAttack(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set light attack to unregistered '${id}'`);
    }
    this.lightAttackId = id;
  }

  /** Sub-AC 3.3 — explicitly set / clear the heavy (smash) dispatch slot. */
  setHeavyAttack(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set heavy attack to unregistered '${id}'`);
    }
    this.heavyAttackId = id;
  }

  /** Sub-AC 3.3 — explicitly set / clear the aerial dispatch slot. */
  setAerialAttack(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set aerial attack to unregistered '${id}'`);
    }
    this.aerialAttackId = id;
  }

  /**
   * AC 60101 Sub-AC 1 — explicitly set / clear the tilt dispatch slot.
   * Use when a roster registers several `'tilt'`-typed moves and wants
   * a non-first variant as the directional-press default. Throws on
   * unregistered ids so a typo in a subclass constructor surfaces
   * immediately, mirroring the {@link setLightAttack} contract.
   */
  setTiltAttack(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set tilt attack to unregistered '${id}'`);
    }
    this.tiltAttackId = id;
  }
  /** Wire the up-tilt slot (up-stick light press). The move must be registered. */
  setUpTilt(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set up-tilt to unregistered '${id}'`);
    }
    this.upTiltId = id;
  }
  getUpTiltId(): string | null {
    return this.upTiltId;
  }
  /** Wire the up-smash slot (up-stick heavy press). The move must be registered. */
  setUpSmash(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set up-smash to unregistered '${id}'`);
    }
    this.upSmashId = id;
  }
  getUpSmashId(): string | null {
    return this.upSmashId;
  }
  /** Wire the down-tilt slot (down-stick light press). The move must be registered. */
  setDownTilt(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set down-tilt to unregistered '${id}'`);
    }
    this.downTiltId = id;
  }
  getDownTiltId(): string | null {
    return this.downTiltId;
  }
  /** Wire the down-smash slot (down-stick heavy press). The move must be registered. */
  setDownSmash(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set down-smash to unregistered '${id}'`);
    }
    this.downSmashId = id;
  }
  getDownSmashId(): string | null {
    return this.downSmashId;
  }
  /** Wire the dash-attack slot (light press while running). The move must be registered. */
  setDashAttack(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set dash-attack to unregistered '${id}'`);
    }
    this.dashAttackSlotId = id;
  }
  getDashAttackId(): string | null {
    return this.dashAttackSlotId;
  }

  /**
   * AC 60201 Sub-AC 1 — explicitly set / clear the neutral-special
   * dispatch slot. Throws on unknown ids so a typo in a subclass
   * constructor surfaces immediately instead of silently dropping the
   * press, mirroring the {@link setLightAttack} / {@link setHeavyAttack}
   * / {@link setAerialAttack} contract.
   */
  setNeutralSpecial(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(
        `Character: cannot set neutral special to unregistered '${id}'`,
      );
    }
    this.neutralSpecialId = id;
  }

  /** Sub-AC 3.3 — read the wired-up light/heavy/aerial dispatch slot. */
  getLightAttackId(): string | null {
    return this.lightAttackId;
  }
  getHeavyAttackId(): string | null {
    return this.heavyAttackId;
  }
  getAerialAttackId(): string | null {
    return this.aerialAttackId;
  }

  /** AC 60101 Sub-AC 1 — read the wired-up tilt dispatch slot. */
  getTiltAttackId(): string | null {
    return this.tiltAttackId;
  }

  /** AC 60201 Sub-AC 1 — read the wired-up neutral-special dispatch slot. */
  getNeutralSpecialId(): string | null {
    return this.neutralSpecialId;
  }

  /**
   * AC 60202 Sub-AC 2 — explicitly set / clear the up-special dispatch
   * slot. Throws on unknown ids so a typo in a subclass constructor
   * surfaces immediately instead of silently dropping the press,
   * mirroring the {@link setNeutralSpecial} contract.
   */
  setUpSpecial(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(
        `Character: cannot set up special to unregistered '${id}'`,
      );
    }
    this.upSpecialId = id;
  }

  /** AC 60202 Sub-AC 2 — read the wired-up up-special dispatch slot. */
  getUpSpecialId(): string | null {
    return this.upSpecialId;
  }

  /**
   * AC 60304 Sub-AC 4 — explicitly set / clear the down-special
   * dispatch slot. Throws on unknown ids so a typo in a subclass
   * constructor surfaces immediately instead of silently dropping the
   * press, mirroring the {@link setNeutralSpecial} / {@link setUpSpecial}
   * contract.
   */
  setDownSpecial(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(
        `Character: cannot set down special to unregistered '${id}'`,
      );
    }
    this.downSpecialId = id;
  }

  /** AC 60304 Sub-AC 4 — read the wired-up down-special dispatch slot. */
  getDownSpecialId(): string | null {
    return this.downSpecialId;
  }

  /**
   * AC 60102 Sub-AC 2 — explicitly set / clear the directional aerial
   * dispatch slots. Throws on unknown ids so a typo in a subclass
   * constructor surfaces immediately instead of silently dropping the
   * press, mirroring the {@link setLightAttack} / {@link setHeavyAttack}
   * / {@link setAerialAttack} contract.
   */
  setAerialNeutral(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(
        `Character: cannot set aerial-neutral to unregistered '${id}'`,
      );
    }
    this.aerialNeutralId = id;
  }
  setAerialForward(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(
        `Character: cannot set aerial-forward to unregistered '${id}'`,
      );
    }
    this.aerialForwardId = id;
  }
  setAerialBack(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(
        `Character: cannot set aerial-back to unregistered '${id}'`,
      );
    }
    this.aerialBackId = id;
  }
  setAerialUp(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(`Character: cannot set aerial-up to unregistered '${id}'`);
    }
    this.aerialUpId = id;
  }
  setAerialDown(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(
        `Character: cannot set aerial-down to unregistered '${id}'`,
      );
    }
    this.aerialDownId = id;
  }

  /** AC 60102 Sub-AC 2 — read the wired-up directional aerial dispatch slot. */
  getAerialNeutralId(): string | null {
    return this.aerialNeutralId;
  }
  getAerialForwardId(): string | null {
    return this.aerialForwardId;
  }
  getAerialBackId(): string | null {
    return this.aerialBackId;
  }
  getAerialUpId(): string | null {
    return this.aerialUpId;
  }
  getAerialDownId(): string | null {
    return this.aerialDownId;
  }

  /** Read-only lookup of the registered moveset by id. */
  getAttack(id: string): AttackMove | undefined {
    return this.attacks.get(id);
  }

  /** Frames before another attack can begin. 0 = ready. */
  getCooldownRemaining(): number {
    return this.cooldownRemaining;
  }

  /** True iff a move is currently in startup / active / recovery. */
  isAttacking(): boolean {
    return this.activeAttack !== null;
  }

  /** True iff a new attack would be allowed to start this frame. */
  canAttack(): boolean {
    return !this.destroyed && this.activeAttack === null && this.cooldownRemaining === 0;
  }

  /**
   * Sub-AC 3 of AC 60003 — read the live animation state for this
   * fighter as a fully-resolved {@link AnimationState} (animation key,
   * phase, art-frame index, locked-in facing). Returns the idle key
   * (`'{characterId}.idle'`) any frame the fighter is not mid-attack
   * (or has been destroyed). Pure read of the active-attack snapshot;
   * does NOT mutate any state.
   *
   * The renderer (later AC, when the sprite atlas pipeline lands) will
   * call this every frame and `setTexture(state.key)` directly — no
   * animation-vs-hitbox phase drift is possible because the same
   * `(framesElapsed, move)` pair drives both the animation key AND the
   * hitbox lifecycle.
   */
  getCurrentAnimation(): AnimationState {
    return getCurrentAnimation({
      id: this.id,
      getFacing: () => this.facing,
      isDestroyed: () => this.destroyed,
      getActiveAttack: () => this.getActiveAttack(),
    });
  }

  /**
   * AC 10003 Sub-AC 3 — read-only data snapshot of every animation-
   * relevant runtime state on this fighter. Pure projection; no
   * Phaser / Matter coupling. The
   * {@link createFighterAnimationStateMachine} binding (in
   * {@link fighterAnimationState.ts}) calls this once per fixed step to
   * resolve the canonical animation key the renderer should display.
   *
   * Includes the active attack, hitstun timer, shield / dodge / ledge
   * states — every input the precedence-ordered composer needs to pick
   * the right overlay.
   *
   * Note: the `*FramesInPhase` fields are not currently surfaced from
   * the underlying state machines (they don't track per-phase frame
   * counters separately), so callers that need exact phase-relative
   * frame indexes for the renderer can supply them through other
   * channels. The snapshot returns 0 for these by default; the
   * resolver clamps gracefully in that case.
   */
  getAnimationSnapshot(): {
    readonly characterId: CharacterId;
    readonly facing: 1 | -1;
    readonly destroyed: boolean;
    readonly activeAttack: ActiveAttack | null;
    readonly hitstunRemaining: number;
    readonly hitlagRemaining: number;
    readonly shield: ShieldState;
    readonly dodge: DodgeState;
    readonly ledgeHang: LedgeHangState;
  } {
    return {
      characterId: this.id,
      facing: this.facing,
      destroyed: this.destroyed,
      activeAttack: this.getActiveAttack(),
      hitstunRemaining: this.hitstunRemaining,
      hitlagRemaining: this.hitlagRemaining,
      shield: this.shieldState,
      dodge: this.dodgeState,
      ledgeHang: this.ledgeHangState,
    };
  }

  /**
   * Read-only snapshot of the active attack. Returns `null` between
   * attacks. Tests and AI consumers use this; the live `hitboxBody`
   * reference is included so consumers can correlate hitbox collision
   * pairs with the move that spawned them.
   */
  getActiveAttack(): ActiveAttack | null {
    if (!this.activeAttack) return null;
    return {
      move: this.activeAttack.move,
      facing: this.activeAttack.facing,
      phase: this.attackPhase(),
      framesElapsed: this.activeAttack.framesElapsed,
      hitboxBody: this.activeAttack.hitboxBody,
      chargeHeldFrames: this.activeAttack.chargeHeldFrames,
    };
  }

  /**
   * Read-only charge / wind-up progress of the active attack, in
   * `[0, 1]`, or `null` when the fighter is not winding a move up.
   *
   * # What "charging" means here
   *
   * Charge-type attacks (Falcon-Punch-style neutral specials, smash
   * finishers, the heavy hammer swing) all share a long **startup**
   * phase — the visible wind-up before the hitbox spawns. That startup
   * window IS the charge: the longer a move spends in startup, the more
   * "powered up" it reads on screen. We expose the fraction of the
   * startup phase already elapsed so the in-match {@link ChargeIndicator}
   * overlay can paint a glow / bar that intensifies as the swing winds
   * up, with no per-move bespoke art.
   *
   *   progress = framesElapsed / startupFrames   while phase === 'startup'
   *   progress = null                            otherwise
   *
   * The result is `null` (not `0`) the instant the move leaves startup
   * — once the hitbox is live (`'active'`) or the fighter is in
   * `'recovery'`, there is no longer a charge to show, and the overlay
   * hides rather than freezing at full glow.
   *
   * # Determinism
   *
   * Pure integer arithmetic over the active attack's `framesElapsed`
   * (advanced one tick per fixed step) and the move's frozen
   * `startupFrames`. No `Math.random()`, no `Date.now()`, no Phaser /
   * Matter reads — identical inputs on identical frames always yield
   * the same fraction, so replays paint identical wind-ups. The output
   * is clamped to `[0, 1]` defensively against a malformed
   * `startupFrames <= 0` (collapses the whole startup window to a
   * single full-charge frame rather than dividing by zero).
   */
  getChargeProgress(): number | null {
    // Hold-to-charge specials (Samus cannon) report their REAL buildup
    // — the fraction of the charge window the button has been held —
    // which is the headline use of this getter. This takes priority
    // over the active-attack startup window below (the two never overlap:
    // while `chargingSpecial` is set, no move has fired yet).
    if (this.chargingSpecial !== null) {
      const cs = this.chargingSpecial;
      if (cs.maxFrames <= 0) return 1;
      return clamp(cs.framesHeld / cs.maxFrames, 0, 1);
    }
    // A grounded SMASH wind-up reports its real buildup the same way, so
    // the ChargeIndicator paints the smash charge too.
    if (this.chargingSmash !== null) {
      const cs = this.chargingSmash;
      if (cs.maxFrames <= 0) return 1;
      return clamp(cs.framesHeld / cs.maxFrames, 0, 1);
    }
    // A BANKED charge (shield-cancelled, kept for later) keeps the glow
    // lit at its stored level — the on-screen proof that the charge is
    // kept. Resolve the max-frame window from the move's charge ramp.
    if (this.storedSpecialCharge !== null) {
      const cm = this.neutralChargeMove();
      const max = cm ? Math.max(1, cm.charge.maxChargeFrames) : 1;
      return clamp(this.storedSpecialCharge.framesHeld / max, 0, 1);
    }
    const a = this.activeAttack;
    if (!a) return null;
    if (Character.phaseFor(a.framesElapsed, a.move) !== 'startup') return null;
    const startup = a.move.startupFrames;
    // A zero / negative startup window can't be "charged" through —
    // report full charge so a (defensively-impossible) instant-startup
    // move still reads as a complete wind-up rather than NaN.
    if (!(startup > 0)) return 1;
    const t = a.framesElapsed / startup;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  /**
   * Fire a registered attack by id. Returns `true` if the attack
   * started, `false` if it was rejected (still on cooldown, mid-attack,
   * unknown id, or fighter destroyed). Public so AI scripts and the
   * (later) input-mapping layer can drive specific moves directly
   * without going through the rising-edge `attack` button.
   */
  attemptAttack(id: string): boolean {
    if (!this.canAttack()) return false;
    const move = this.attacks.get(id);
    if (!move) return false;
    this.activeAttack = {
      move,
      facing: this.facing,
      framesElapsed: 0,
      hitboxBody: null,
      upSpecial: null,
      chargeHeldFrames: null,
    };
    return true;
  }

  /**
   * JAB-COMBO advance — replace the in-flight jab stage with the next
   * stage of the string (`nextId`), restarting its frame timeline. Unlike
   * {@link attemptAttack} this deliberately BYPASSES `canAttack()` (which
   * would reject because a jab is already active) and arms NO cooldown
   * between stages, so the string flows seamlessly — the FINAL stage's
   * `cooldownFrames` becomes the post-string lockout when it ends. Facing
   * is copied from the current stage so a mid-string stick wiggle can't
   * flip the combo. Returns false (no-op) if the next stage isn't
   * registered or no jab is active.
   */
  private advanceJabChain(nextId: string): boolean {
    if (this.activeAttack === null) return false;
    const next = this.attacks.get(nextId);
    if (next === undefined) return false;
    // Despawn the current stage's live hitbox so we never leak a sensor.
    if (this.activeAttack.hitboxBody !== null) {
      despawnHitbox(this.scene as unknown as HitboxScene, this.activeAttack.hitboxBody);
    }
    this.activeAttack = {
      move: next,
      facing: this.activeAttack.facing,
      framesElapsed: 0,
      hitboxBody: null,
      upSpecial: null,
      chargeHeldFrames: null,
    };
    return true;
  }

  /**
   * Fire a `specialKind: 'charge'` neutral special on RELEASE, latching
   * the held-charge frame count so the active window deals the lerped
   * (charged) damage / knockback. Called by the charge state machine in
   * {@link tickAttack} when the special button is released (or the
   * charge maxes out). Drops the charge silently if the fighter can no
   * longer act (mid-attack / cooldown / destroyed) — the player simply
   * loses the stored charge, same as Smash if you get hit out of it.
   */
  private fireNeutralChargeSpecial(moveId: string, heldFrames: number): void {
    if (!this.canAttack()) return;
    const move = this.attacks.get(moveId);
    if (!move) return;
    this.activeAttack = {
      move,
      facing: this.facing,
      framesElapsed: 0,
      hitboxBody: null,
      upSpecial: null,
      chargeHeldFrames: Math.max(0, Math.round(heldFrames)),
    };
  }

  /**
   * Resolve the neutral-special move IF it is a chargeable
   * (`specialKind: 'charge'`) move with a `charge` ramp — else `null`.
   * The charge state machine consults this to decide whether a neutral
   * special press starts a hold-to-charge instead of firing instantly.
   */
  /**
   * Resolve a grounded smash move id to its {@link ChargeSpec} ramp, or
   * `null` if the smash carries no `charge` field (fires instantly). The
   * presence of a `charge` ramp is what turns a smash into a hold-to-charge
   * move — so existing roster smashes without one keep firing on press.
   */
  private smashChargeMove(moveId: string): { id: string; charge: ChargeSpec } | null {
    const move = this.attacks.get(moveId) as unknown as
      | { id: string; charge?: ChargeSpec }
      | undefined;
    if (!move || move.charge === undefined) return null;
    return { id: moveId, charge: move.charge };
  }

  /**
   * Fire a charged smash on release: latch `facing` (committed at
   * charge-start), start the move via {@link attemptAttack}, then stamp
   * `chargeHeldFrames` so {@link chargedSpawnMove} lerps the hitbox's
   * damage + knockback by how long it was charged. No-op if the fighter
   * can no longer act (mid-attack / cooldown / destroyed) — the charge is
   * simply dropped.
   */
  private fireSmash(moveId: string, facing: 1 | -1, heldFrames: number): void {
    if (!this.canAttack()) return;
    this.facing = facing;
    if (!this.attemptAttack(moveId)) return;
    if (this.activeAttack !== null) {
      this.activeAttack.chargeHeldFrames = Math.max(0, Math.round(heldFrames));
    }
  }

  private neutralChargeMove(): { id: string; charge: ChargeSpec } | null {
    if (this.neutralSpecialId === null) return null;
    const move = this.attacks.get(this.neutralSpecialId) as unknown as
      | {
          id: string;
          specialKind?: string;
          charge?: ChargeSpec;
          chargedProjectile?: { charge: ChargeSpec };
        }
      | undefined;
    if (!move) return null;
    // The charge ramp lives either at `move.charge` (a `'charge'`-kind
    // melee/beam) OR at `move.chargedProjectile.charge` (a `'projectile'`
    // kind carrying the Samus charge-beam overlay). Either makes the
    // neutral special a hold-to-charge move.
    const charge = move.charge ?? move.chargedProjectile?.charge;
    if (
      charge &&
      (move.specialKind === 'charge' || move.specialKind === 'projectile')
    ) {
      return { id: move.id, charge };
    }
    return null;
  }

  /**
   * Resolve the move record (possibly a charged clone) to spawn the
   * active attack's hitbox from. For a charge release, lerps the move's
   * `damage` + `knockback` between the `charge.min*` / `charge.max*`
   * endpoints at the held-frame count via the {@link ChargeSpec} ramp;
   * every other move returns its authored record unchanged.
   */
  private chargedSpawnMove(a: {
    move: AttackMove;
    chargeHeldFrames: number | null;
  }): AttackMove {
    if (a.chargeHeldFrames === null) return a.move;
    const spec = (a.move as unknown as { charge?: ChargeSpec }).charge;
    if (!spec) return a.move;
    return {
      ...a.move,
      damage: computeChargedDamageFromSpec(spec, a.chargeHeldFrames),
      knockback: computeChargedKnockbackFromSpec(spec, a.chargeHeldFrames),
    };
  }

  /**
   * AC 60303 Sub-AC 3 — fire the registered up-special move with optional
   * stick direction context. Returns `true` if the move started, `false`
   * if it was rejected (no up-special registered, fighter destroyed,
   * still on cooldown, or mid-attack).
   *
   * The caller passes the player's stick deflection at the moment of the
   * press (defaults to `(0, -1)` = straight up — the canonical no-stick
   * recovery direction). The method handles the per-mechanic vertical /
   * recovery physics integration:
   *
   *   • `multiHitRising` (Wolf): instantly applies the upward
   *     `riseImpulse` (and the `driftImpulse` along the facing axis) to
   *     the body's velocity. Fighter rises through the active window
   *     while the multi-hit ladder fires.
   *
   *   • `teleport` (Cat): latches the (snapped) direction and the press
   *     position so `tickAttack` can translate the body to
   *     `pressX + dir.x * teleportDistance` on the active→recovery
   *     transition. Press-frame velocity is zeroed so the vanish state
   *     reads as "rooted in place" before reappearance.
   *
   *   • `directionalJump` (Owl): latches the (snapped) direction and
   *     immediately sets velocity to `dir × burstSpeed`. Subsequent
   *     active frames re-apply the burst velocity inside `tickAttack`
   *     so gravity / friction don't decay the trajectory mid-burst.
   *
   *   • `tether` (Bear): applies a small upward impulse so the press
   *     gets a clear "shot upward" feel even before the line catches
   *     anything. The reel-toward-contact mechanic is layered by the
   *     stage-aware runtime in a later sub-AC; this handler ensures
   *     Bear's recovery always produces vertical movement on activation,
   *     consistent with the contract for Sub-AC 3.
   *
   * Common to all four mechanics: the fighter's `jumpsUsed` counter is
   * reset so a successful up-B does not consume a regular jump from the
   * limited budget — the up-special is the dedicated recovery option,
   * NOT a third jump.
   *
   * Returns `false` (without mutating velocity) if the dispatch slot is
   * empty, the move id can't be resolved, or the attack lifecycle
   * gates `attemptAttack`.
   */
  attemptUpSpecial(stickX: number = 0, stickY: number = -1): boolean {
    if (this.upSpecialId === null) return false;
    const move = this.attacks.get(this.upSpecialId);
    if (!move) return false;
    if (!isUpSpecialMove(move)) {
      // Defensive: the dispatch slot should only ever point at an
      // `'upSpecial'`-typed move (the per-fighter slot-wiring helper
      // enforces this). Fall back to the plain attempt so the caller
      // still gets the press through — the recovery physics
      // integration just won't fire.
      return this.attemptAttack(this.upSpecialId);
    }
    if (!this.canAttack()) return false;
    if (this.destroyed) return false;

    // Snap the stick to one of the 8 cardinal / diagonal directions when
    // the move's schema demands it (the canonical Smash up-B feel);
    // otherwise normalise the raw stick so analog gamepad sticks still
    // produce a unit vector. A neutral stick falls back to "straight
    // up" via `snapStickToOctant`.
    const dir = this.resolveUpSpecialDirection(move, stickX, stickY);

    // Start the underlying attack lifecycle. From this point the move
    // ticks through startup → active → recovery the same way every
    // attack does.
    if (!this.attemptAttack(this.upSpecialId)) return false;
    if (this.activeAttack === null) return false;

    // Latch the direction + press position on the activeAttack record so
    // `tickAttack` can apply per-frame physics across the active window.
    this.activeAttack.upSpecial = {
      dir: { x: dir.x, y: dir.y },
      pressX: this.body.position.x,
      pressY: this.body.position.y,
      upSpecialApplied: false,
    };

    // Apply press-frame physics — the heart of the "vertical movement /
    // recovery physics integration" contract for Sub-AC 3.
    this.applyUpSpecialPressPhysics(move, dir);

    // Reset the air-jump budget so the recovery move doesn't burn a
    // jump. Canonical Smash up-Bs are the dedicated recovery option;
    // they're orthogonal to the multi-jump counter.
    this.jumpsUsed = 0;
    // The up-special owns the vertical velocity from this frame on —
    // an armed short-hop cut from a prior jump must not clip the
    // recovery's rise on button release, and a stale fast-fall latch
    // must not drag the recovery back down.
    this.jumpCutArmed = false;
    this.fastFallLatched = false;

    return true;
  }

  /**
   * Resolve the direction vector for an up-special press. Pure helper
   * exposed as a method (rather than a free function) so subclasses can
   * override the snapping behaviour for character-specific edge cases
   * without re-implementing the full press flow. The default snaps via
   * the schema's {@link snapStickToOctant} helper for moves that opt in;
   * raw-stick moves get a normalised unit vector with the canonical
   * "neutral stick → straight up" fallback.
   */
  private resolveUpSpecialDirection(
    move: UpSpecialMove,
    stickX: number,
    stickY: number,
  ): OctantDirection {
    let snap = true;
    if (move.upSpecialKind === 'teleport') {
      snap = move.teleport.snapToOctant;
    } else if (move.upSpecialKind === 'directionalJump') {
      snap = move.directionalJump.snapToOctant;
    } else {
      // multiHitRising / tether always default to facing-aware vertical
      // recovery — the schema doesn't expose a stick-direction toggle
      // because the move's vector is fixed (rise + facing-drift for the
      // multi-hit, facing-extension for the tether). We still snap so
      // the latched `dir` has a sensible value for diagnostics / replay.
      snap = true;
    }
    if (snap) {
      return snapStickToOctant(stickX, stickY);
    }
    // Raw-stick path: normalise so non-unit sticks still produce a unit
    // vector. Neutral stick falls back to straight up to match the
    // snap-mode contract.
    const len = Math.hypot(stickX, stickY);
    if (len < 1e-9) return { x: 0, y: -1 };
    return { x: stickX / len, y: stickY / len };
  }

  /**
   * Apply the press-frame velocity / position effects for an up-special.
   * Branches on `upSpecialKind` and delegates to the kind-specific
   * physics. Pure with respect to its inputs except for the body's
   * Matter velocity (which it sets via `setVelocity`).
   */
  private applyUpSpecialPressPhysics(
    move: UpSpecialMove,
    dir: OctantDirection,
  ): void {
    switch (move.upSpecialKind) {
      case 'multiHitRising':
        this.applyMultiHitRisingPress(move);
        break;
      case 'teleport':
        this.applyTeleportPress(move);
        break;
      case 'directionalJump':
        this.applyDirectionalJumpPress(move, dir);
        break;
      case 'tether':
        this.applyTetherPress(move);
        break;
      default: {
        const _exhaustive: never = move;
        void _exhaustive;
      }
    }
  }

  /** Wolf — straight upward burst with optional facing drift. */
  private applyMultiHitRisingPress(move: MultiHitRisingUpSpecialMove): void {
    const r = move.multiHitRising;
    const vx = r.driftImpulse * this.facing;
    const vy = r.riseImpulse; // Schema mandates this is negative (upward).
    this.scene.matter.body.setVelocity(this.body, { x: vx, y: vy });
  }

  /**
   * Cat — root the body in place during the vanish window. The actual
   * teleport (`setPosition`) happens on the active→recovery transition
   * inside `tickAttack`, where the latched direction is consumed.
   */
  private applyTeleportPress(move: TeleportUpSpecialMove): void {
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    // The defining feature of a teleport recovery: the vanish is
    // INVULNERABLE (a Sheik/Zelda/Mewtwo-style escape). Grant i-frames for
    // the authored window from the press frame — the same timer respawn
    // grace uses, drained per fixed step in applyInput. Without this Cat
    // was fully hittable throughout the vanish.
    this.setInvincibility(move.teleport.invincibilityFrames);
  }

  /** Owl — set velocity along the chosen direction × burstSpeed. */
  private applyDirectionalJumpPress(
    move: DirectionalJumpUpSpecialMove,
    dir: OctantDirection,
  ): void {
    const v = computeBurstVelocity(move.directionalJump, dir);
    this.scene.matter.body.setVelocity(this.body, { x: v.x, y: v.y });
  }

  /**
   * Bear — kick off the recovery with a small upward impulse. The
   * tether's line-extends / line-retracts mechanic is the
   * stage-aware part of the runtime (a later sub-AC will detect ledge
   * contact and reel toward the latch point). For Sub-AC 3 the
   * contract is "every up-special produces vertical movement on
   * activation," so we set a dedicated `tetherRiseImpulse` that scales
   * with the schema's `extensionSpeed` — bigger reach means stronger
   * initial pop so the line clears the body before the recovery is
   * over.
   */
  private applyTetherPress(move: TetherUpSpecialMove): void {
    const t = move.tether;
    // Vertical impulse: half the extension speed gives a clean "shot
    // upward into the line" feel without overshooting the rise envelope
    // of the multi-hit / directional-jump recoveries.
    const vy = -Math.max(8, t.extensionSpeed * 0.5);
    // Tether extends along facing — apply a small forward drift so the
    // line clears Bear's body and the recovery actually drifts toward
    // the stage edge a player would aim at.
    const vx = t.extensionSpeed * 0.25 * this.facing;
    this.scene.matter.body.setVelocity(this.body, { x: vx, y: vy });
  }

  /**
   * AC 60303 Sub-AC 3 — drive the per-frame physics of an in-flight
   * up-special. Called from `tickAttack` AFTER the frame counter is
   * advanced and the standard hitbox lifecycle has run, so reads of
   * `framesElapsed` here observe the current frame number.
   *
   *   • `directionalJump`: while `framesIntoActive < burstFrames`, lock
   *     velocity to `dir × burstSpeed` so gravity / air friction don't
   *     erode the trajectory.
   *   • `teleport`: on the active→recovery transition (the reappear
   *     frame), translate the body to the latched destination and zero
   *     velocity so the recovery animation reads cleanly.
   *   • `multiHitRising` and `tether`: no per-frame override; the press-
   *     frame impulse plus normal physics integration handles the rise.
   *
   * Idempotent across frames — the `upSpecialApplied` latch on the
   * teleport branch ensures we only translate once.
   */
  private tickUpSpecialPhysics(): void {
    const a = this.activeAttack;
    if (a === null) return;
    if (a.upSpecial === null) return;
    if (!isUpSpecialMove(a.move)) return;
    const f = a.framesElapsed;
    const startup = a.move.startupFrames;
    const active = a.move.activeFrames;
    const framesIntoActive = f - startup;

    switch (a.move.upSpecialKind) {
      case 'directionalJump': {
        const spec = a.move.directionalJump;
        if (framesIntoActive >= 0 && framesIntoActive < spec.burstFrames) {
          const v = computeBurstVelocity(spec, a.upSpecial.dir);
          this.scene.matter.body.setVelocity(this.body, { x: v.x, y: v.y });
        }
        break;
      }
      case 'teleport': {
        // Reappear on the LAST active frame (the active→recovery
        // transition). framesIntoActive ranges [0 .. activeFrames-1]
        // during the active phase; we fire on the final entry so the
        // recovery animation begins at the new position.
        if (
          !a.upSpecial.upSpecialApplied &&
          framesIntoActive === active - 1
        ) {
          const dest = computeTeleportDestination(
            a.move.teleport,
            a.upSpecial.pressX,
            a.upSpecial.pressY,
            a.upSpecial.dir,
          );
          this.scene.matter.body.setPosition(this.body, {
            x: dest.x,
            y: dest.y,
          });
          this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
          a.upSpecial.upSpecialApplied = true;
        }
        break;
      }
      case 'tether': {
        // Hookshot recovery: REEL toward the nearest ledge within the
        // tether's reach so the line grabs a ledge from beyond normal grab
        // range. The standard ledge-grab detection (computeLedgeDetection
        // in applyInput) catches the body once the reel pulls it close, so
        // we only need to fly it toward the ledge here. A whiffed tether
        // (no ledge in range) just keeps the press-frame upward pop.
        const spec = a.move.tether;
        const pos = this.body.position;
        const maxR = spec.maxRange;
        let nearestX = 0;
        let nearestY = 0;
        let nearestD2 = maxR * maxR;
        let found = false;
        for (const c of this.ledgeCandidates) {
          const dx = c.x - pos.x;
          const dy = c.y - pos.y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= nearestD2) {
            nearestD2 = d2;
            nearestX = c.x;
            nearestY = c.y;
            found = true;
          }
        }
        if (found) {
          const dx = nearestX - pos.x;
          const dy = nearestY - pos.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          this.scene.matter.body.setVelocity(this.body, {
            x: (dx / d) * spec.reelSpeed,
            y: (dy / d) * spec.reelSpeed,
          });
        }
        break;
      }
      case 'multiHitRising':
        // Press-frame impulse + standard physics integration is the
        // recovery vector for this kind. No per-frame override.
        break;
      default: {
        const _exhaustive: never = a.move;
        void _exhaustive;
      }
    }
  }

  /**
   * Resolve the down-special DIVE parameters for a move, or `null` when it
   * is not a `groundPound` / `stallAndFall` down-special. Both kinds share
   * one runtime shape: a RISE phase (hop / stall) for the first
   * `riseFrames` of the active window, then a DESCENT phase plunging at
   * `descentVy` until ground contact, where the shockwave fires. Pure —
   * reads only frozen authored fields.
   */
  private resolveDiveSpec(move: AttackMove): {
    moveId: string;
    riseFrames: number;
    riseVy: number;
    descentVy: number;
    shockwaveDamage: number;
    shockwaveKnockback: AttackMove['knockback'];
    shockwaveHitbox: {
      offsetX: number;
      offsetY: number;
      width: number;
      height: number;
    };
  } | null {
    const m = move as unknown as {
      id: string;
      type?: string;
      downSpecialKind?: string;
      groundPound?: {
        hopFrames: number;
        hopImpulse: number;
        slamVelocity: number;
        shockwaveDamage: number;
        shockwaveKnockback: AttackMove['knockback'];
        shockwaveHitbox: { offsetX: number; offsetY: number; width: number; height: number };
      };
      stallAndFall?: {
        stallFrames: number;
        stallVelocity: number;
        fallVelocity: number;
        shockwaveDamage: number;
        shockwaveKnockback: AttackMove['knockback'];
        shockwaveHitbox: { offsetX: number; offsetY: number; width: number; height: number };
      };
    };
    if (m.type !== 'downSpecial') return null;
    if (m.downSpecialKind === 'groundPound' && m.groundPound) {
      const g = m.groundPound;
      return {
        moveId: m.id,
        riseFrames: g.hopFrames,
        riseVy: g.hopImpulse,
        descentVy: g.slamVelocity,
        shockwaveDamage: g.shockwaveDamage,
        shockwaveKnockback: g.shockwaveKnockback,
        shockwaveHitbox: g.shockwaveHitbox,
      };
    }
    if (m.downSpecialKind === 'stallAndFall' && m.stallAndFall) {
      const s = m.stallAndFall;
      return {
        moveId: m.id,
        riseFrames: s.stallFrames,
        riseVy: s.stallVelocity,
        descentVy: s.fallVelocity,
        shockwaveDamage: s.shockwaveDamage,
        shockwaveKnockback: s.shockwaveKnockback,
        shockwaveHitbox: s.shockwaveHitbox,
      };
    }
    return null;
  }

  /**
   * Per-frame physics for a down-special DIVE, mirroring
   * {@link tickUpSpecialPhysics}. During the active window it OVERRIDES the
   * fall-shaping/terminal-clamp velocity committed earlier this frame with
   * the hop/stall RISE velocity (first `riseFrames`) then the slam/fall
   * DESCENT velocity, and re-anchors the meteor hitbox onto the plunging
   * body each frame (the standard re-anchor only tracks aerials, so a
   * grounded-spawned dive hitbox would otherwise freeze at the spawn
   * point). The landing burst + the hold-active-until-land gate live in
   * the Step-1 frame-advance block; once the burst has fired
   * (`diveShockwaveSpawned`) the dive's motion is done and this no-ops so
   * a post-landing active frame can't re-launch the plunge.
   */
  private tickDownSpecialDivePhysics(): void {
    const a = this.activeAttack;
    if (a === null) return;
    if (this.diveShockwaveSpawned) return;
    const dive = this.resolveDiveSpec(a.move);
    if (dive === null) return;
    if (Character.phaseFor(a.framesElapsed, a.move) !== 'active') return;
    const framesIntoActive = a.framesElapsed - a.move.startupFrames;
    const descending = framesIntoActive >= dive.riseFrames;
    const vy = descending ? dive.descentVy : dive.riseVy;
    // The dive owns the vertical motion this frame; horizontal velocity is
    // preserved so the player can steer the plunge slightly.
    this.scene.matter.body.setVelocity(this.body, {
      x: this.body.velocity.x,
      y: vy,
    });
    if (a.hitboxBody !== null) {
      updateHitboxPosition(
        this.scene as unknown as HitboxScene,
        a.hitboxBody,
        this.body.position,
        a.move,
        a.facing,
      );
    }
  }

  /**
   * Enter a tech-roll / get-up-roll: a short intangible slide along the
   * floor away from danger. Grants i-frames for the roll and latches the
   * roll lockout that {@link tickAttack} drains while pinning vy to 0.
   */
  private startGetupRoll(dir: 1 | -1): void {
    this.getupRollDir = dir;
    this.getupRollRemaining = GETUP_ROLL_FRAMES;
    this.facing = dir; // rolls turn you to face the travel direction
    this.setInvincibility(GETUP_ROLL_FRAMES);
    this.scene.matter.body.setVelocity(this.body, {
      x: dir * GETUP_ROLL_SPEED,
      y: 0,
    });
  }

  /**
   * Get-up attack: stand from a knockdown swinging a weak double-sided
   * sweep that hits on both flanks. Spawns a transient `HITBOX_LABEL`
   * sensor the scene resolves to an `applyHit`, and grants the standard
   * get-up i-frames so the wake-up itself can't be stuffed.
   */
  /**
   * Per-character GET-UP ATTACK parameters (the wake-up swat from knockdown).
   * Base = a weak, wide, two-sided default; a fighter subclass MAY override to
   * give it character-appropriate range/damage/knockback (Smash fighters' get-up
   * attacks differ). Pure — same fighter always returns the same params.
   * See docs/SMASH-PARITY-PLAN.md (per-character authoring).
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: GETUP_ATTACK_DAMAGE,
      knockback: { x: 4, y: -3, scaling: 0.12 },
      // A wide low sweep centred on the fighter — covers both flanks.
      hitbox: { offsetX: 0, offsetY: 0, width: 96, height: 40 },
      activeFrames: GETUP_ATTACK_FRAMES,
    };
  }

  /**
   * Per-character LEDGE-ATTACK parameters (the edge-clearing swing on the
   * `'attack'` ledge release). Base = a forward swing covering the ledge
   * corner + a bit onstage; a fighter subclass MAY override. Pure.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: LEDGE_ATTACK_DAMAGE,
      knockback: { x: 4, y: -2.4, scaling: 0.14 },
      hitbox: { offsetX: 12, offsetY: -2, width: 84, height: 60 },
      activeFrames: LEDGE_ATTACK_FRAMES,
    };
  }

  private startGetupAttack(): void {
    this.setInvincibility(GETUP_IFRAME_FRAMES);
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    const p = this.getUpAttackParams();
    const getupMove = {
      id: `${this.id}.getupAttack`,
      type: 'tilt',
      damage: p.damage,
      knockback: p.knockback,
      hitbox: p.hitbox,
      startupFrames: 0,
      activeFrames: p.activeFrames,
      recoveryFrames: 0,
      cooldownFrames: 0,
    } as unknown as AttackMove;
    const body = spawnHitbox(
      this.scene as unknown as HitboxScene,
      { id: this.id, position: this.body.position, bodyId: this.body.id },
      getupMove,
      this.facing,
    );
    this.transientHitboxes.push({ body, framesRemaining: p.activeFrames });
  }

  /**
   * Spawn the landing shockwave hitbox at the fighter's feet on dive
   * touchdown. A short-lived transient `HITBOX_LABEL` sensor — the scene's
   * HitboxDamageHandler resolves any such body into an `applyHit`, so the
   * shockwave deals its damage / knockback without any bespoke wiring.
   * Tracked in {@link transientHitboxes} and despawned after
   * {@link DIVE_SHOCKWAVE_FRAMES}.
   */
  private spawnDiveShockwave(
    dive: {
      moveId: string;
      shockwaveDamage: number;
      shockwaveKnockback: AttackMove['knockback'];
      shockwaveHitbox: { offsetX: number; offsetY: number; width: number; height: number };
    },
    facing: 1 | -1,
  ): void {
    const shockMove = {
      id: `${dive.moveId}.shockwave`,
      type: 'downSpecial',
      damage: dive.shockwaveDamage,
      knockback: dive.shockwaveKnockback,
      hitbox: dive.shockwaveHitbox,
      startupFrames: 0,
      activeFrames: 1,
      recoveryFrames: 0,
      cooldownFrames: 0,
    } as unknown as AttackMove;
    const body = spawnHitbox(
      this.scene as unknown as HitboxScene,
      { id: this.id, position: this.body.position, bodyId: this.body.id },
      shockMove,
      facing,
    );
    this.transientHitboxes.push({ body, framesRemaining: DIVE_SHOCKWAVE_FRAMES });
  }

  /**
   * Advance + expire the transient hitboxes (dive landing shockwaves).
   * Runs once per `tickAttack`, independent of the active-attack
   * lifecycle. Deterministic: integer frame counters only.
   */
  private tickTransientHitboxes(): void {
    if (this.transientHitboxes.length === 0) return;
    const survivors: Array<{ body: MatterJS.BodyType; framesRemaining: number }> = [];
    for (const h of this.transientHitboxes) {
      h.framesRemaining -= 1;
      if (h.framesRemaining <= 0) {
        despawnHitbox(this.scene as unknown as HitboxScene, h.body);
      } else {
        survivors.push(h);
      }
    }
    this.transientHitboxes = survivors;
  }

  /** Despawn + drop every transient hitbox (teardown / respawn). */
  private clearTransientHitboxes(): void {
    for (const h of this.transientHitboxes) {
      despawnHitbox(this.scene as unknown as HitboxScene, h.body);
    }
    this.transientHitboxes = [];
    // Placed traps are world sensors too — sweep them on the same path so
    // a respawn / teardown can't leak an armed mine into the next stock.
    for (const t of this.activeTraps) {
      if (t.body !== null) despawnHitbox(this.scene as unknown as HitboxScene, t.body);
    }
    this.activeTraps = [];
  }

  /**
   * Resolve a `trap` down-special into its placement spec, or `null`.
   * Pure.
   */
  private resolveTrapSpec(move: AttackMove): {
    trapWidth: number;
    trapHeight: number;
    spawnOffsetX: number;
    spawnOffsetY: number;
    armDelayFrames: number;
    trapLifetimeFrames: number;
    trapDamage: number;
    trapKnockback: AttackMove['knockback'];
    maxActiveTraps: number;
    fuseDetonateFrames?: number;
    selfBounceVelocity?: number;
  } | null {
    const m = move as unknown as {
      type?: string;
      downSpecialKind?: string;
      trap?: {
        trapWidth: number;
        trapHeight: number;
        spawnOffsetX: number;
        spawnOffsetY: number;
        armDelayFrames: number;
        trapLifetimeFrames: number;
        trapDamage: number;
        trapKnockback: AttackMove['knockback'];
        maxActiveTraps: number;
        fuseDetonateFrames?: number;
        selfBounceVelocity?: number;
      };
    };
    if (m.type === 'downSpecial' && m.downSpecialKind === 'trap' && m.trap) {
      return { ...m.trap };
    }
    return null;
  }

  /**
   * Place a trap at the fighter's feet (captures a FIXED world point — the
   * trap does NOT follow the fighter). FIFO-evicts the oldest when over
   * `maxActiveTraps`. The armed sensor is spawned later by
   * {@link tickTraps} once the arm delay elapses.
   */
  private placeTrap(
    spec: {
      trapWidth: number;
      trapHeight: number;
      spawnOffsetX: number;
      spawnOffsetY: number;
      armDelayFrames: number;
      trapLifetimeFrames: number;
      trapDamage: number;
      trapKnockback: AttackMove['knockback'];
      maxActiveTraps: number;
      fuseDetonateFrames?: number;
      selfBounceVelocity?: number;
    },
    facing: 1 | -1,
    moveId: string,
  ): void {
    // FIFO: drop the oldest placed trap when at capacity.
    while (this.activeTraps.length >= Math.max(1, spec.maxActiveTraps)) {
      const oldest = this.activeTraps.shift();
      if (oldest && oldest.body !== null) {
        despawnHitbox(this.scene as unknown as HitboxScene, oldest.body);
      }
    }
    // Timed bomb (Samus): the blast sensor arms exactly at the fuse and lives
    // only a few frames (a one-shot explosion), instead of the contact mine's
    // long armed window. Otherwise use the authored arm-delay / lifetime.
    const fused =
      typeof spec.fuseDetonateFrames === 'number' && spec.fuseDetonateFrames >= 0;
    const armDelay = fused
      ? (spec.fuseDetonateFrames as number)
      : spec.armDelayFrames;
    const lifetime = fused
      ? (spec.fuseDetonateFrames as number) + TRAP_BLAST_FRAMES
      : spec.trapLifetimeFrames;
    this.activeTraps.push({
      x: this.body.position.x + facing * spec.spawnOffsetX,
      y: this.body.position.y + spec.spawnOffsetY,
      facing,
      framesSinceSpawn: 0,
      armDelay,
      lifetime,
      damage: spec.trapDamage,
      knockback: spec.trapKnockback,
      width: spec.trapWidth,
      height: spec.trapHeight,
      maxActive: spec.maxActiveTraps,
      moveId,
      body: null,
      selfBounceVelocity:
        fused && typeof spec.selfBounceVelocity === 'number'
          ? spec.selfBounceVelocity
          : null,
      detonated: false,
    });
  }

  /**
   * Advance every placed trap once per tick (independent of the active
   * attack): arm it (spawn the detonating sensor at its fixed point) when
   * the arm delay elapses, and despawn it at its lifetime. Deterministic —
   * integer frame counters only.
   */
  private tickTraps(): void {
    if (this.activeTraps.length === 0) return;
    const survivors: typeof this.activeTraps = [];
    for (const t of this.activeTraps) {
      t.framesSinceSpawn += 1;
      // Arm: spawn the live sensor exactly once, at the placement point.
      if (t.body === null && t.framesSinceSpawn >= t.armDelay) {
        const trapMove = {
          id: `${t.moveId}.trap`,
          type: 'downSpecial',
          damage: t.damage,
          knockback: t.knockback,
          hitbox: { offsetX: 0, offsetY: 0, width: t.width, height: t.height },
          startupFrames: 0,
          activeFrames: 1,
          recoveryFrames: 0,
          cooldownFrames: 0,
        } as unknown as AttackMove;
        t.body = spawnHitbox(
          this.scene as unknown as HitboxScene,
          { id: this.id, position: { x: t.x, y: t.y }, bodyId: this.body.id },
          trapMove,
          t.facing,
        );
        // Timed bomb (Samus): this arming frame IS the detonation. Apply the
        // bomb-jump self-bounce exactly once if the placer is within the blast.
        if (!t.detonated && t.selfBounceVelocity !== null) {
          t.detonated = true;
          const dx = Math.abs(this.body.position.x - t.x);
          const dy = Math.abs(this.body.position.y - t.y);
          if (
            dx <= t.width / 2 + this.tuning.width / 2 &&
            dy <= t.height / 2 + this.tuning.height / 2
          ) {
            this.scene.matter.body.setVelocity(this.body, {
              x: this.body.velocity.x,
              y: t.selfBounceVelocity,
            });
          }
        }
      }
      if (t.framesSinceSpawn >= t.lifetime) {
        if (t.body !== null) despawnHitbox(this.scene as unknown as HitboxScene, t.body);
      } else {
        survivors.push(t);
      }
    }
    this.activeTraps = survivors;
  }

  /**
   * Resolve a move into a uniform MULTI-HIT LADDER view, or `null` when
   * the move is not a `multiHit` side-special / `multiHitRising`
   * up-special. Both schemas are structurally identical (a `hitCount`
   * ladder, the first hit at active-frame 0, subsequent hits every
   * `hitInterval` frames, the last index the launcher finisher) — they
   * only differ in how the launcher is authored: the side-special stores
   * per-hit arrays, the up-special stores a separate link/launcher pair.
   * This normalizes both so one scheduler drives them. Pure.
   */
  private resolveMultiHitSpec(move: AttackMove): {
    moveId: string;
    frames: number[];
    damagePerHit: number[];
    knockbackPerHit: Array<AttackMove['knockback']>;
    hitbox: AttackMove['hitbox'];
  } | null {
    const m = move as unknown as {
      id: string;
      type?: string;
      sideSpecialKind?: string;
      upSpecialKind?: string;
      hitbox: AttackMove['hitbox'];
      multiHit?: {
        hitCount: number;
        hitInterval: number;
        damagePerHit: ReadonlyArray<number>;
        knockbackPerHit: ReadonlyArray<AttackMove['knockback']>;
      };
      multiHitRising?: {
        hitCount: number;
        hitInterval: number;
        linkDamage: number;
        linkKnockback: AttackMove['knockback'];
        launcherDamage: number;
        launcherKnockback: AttackMove['knockback'];
      };
    };
    if (m.type === 'sideSpecial' && m.sideSpecialKind === 'multiHit' && m.multiHit) {
      const s = m.multiHit;
      const frames: number[] = [];
      for (let i = 0; i < s.hitCount; i += 1) frames.push(i * s.hitInterval);
      return {
        moveId: m.id,
        frames,
        damagePerHit: [...s.damagePerHit],
        knockbackPerHit: [...s.knockbackPerHit],
        hitbox: m.hitbox,
      };
    }
    if (
      m.type === 'upSpecial' &&
      m.upSpecialKind === 'multiHitRising' &&
      m.multiHitRising
    ) {
      const s = m.multiHitRising;
      const frames: number[] = [];
      const damagePerHit: number[] = [];
      const knockbackPerHit: Array<AttackMove['knockback']> = [];
      for (let i = 0; i < s.hitCount; i += 1) {
        frames.push(i * s.hitInterval);
        const isLauncher = i === s.hitCount - 1;
        damagePerHit.push(isLauncher ? s.launcherDamage : s.linkDamage);
        knockbackPerHit.push(isLauncher ? s.launcherKnockback : s.linkKnockback);
      }
      return { moveId: m.id, frames, damagePerHit, knockbackPerHit, hitbox: m.hitbox };
    }
    return null;
  }

  /**
   * Per-frame multi-hit ladder driver — mirrors
   * {@link tickDownSpecialDivePhysics}. While a `multiHit` /
   * `multiHitRising` move is in its active window, spawns the next ladder
   * rung on its scheduled frame (`framesIntoActive === frames[idx]`) as
   * its own short-lived transient sensor carrying that rung's
   * damage/knockback. All `hitCount` rungs fire automatically across the
   * active window. No-op for every non-ladder move.
   */
  private tickMultiHitLadder(): void {
    const a = this.activeAttack;
    if (a === null) return;
    const view = this.resolveMultiHitSpec(a.move);
    if (view === null) return;
    if (Character.phaseFor(a.framesElapsed, a.move) !== 'active') return;
    const framesIntoActive = a.framesElapsed - a.move.startupFrames;
    const idx = this.multiHitNextIndex;
    if (idx >= view.frames.length) return;
    if (framesIntoActive === view.frames[idx]) {
      this.spawnMultiHitRung(view, idx, a.facing);
      this.multiHitNextIndex = idx + 1;
    }
  }

  /**
   * Spawn one ladder rung as a short-lived transient `HITBOX_LABEL`
   * sensor — the same mechanism as {@link spawnDiveShockwave}. A separate
   * body per rung means each lands its own connect (one hit spark per
   * hit) and is per-body deduped by the HitboxDamageHandler. Lives in
   * {@link transientHitboxes} so respawn/teardown cleanup is automatic.
   */
  private spawnMultiHitRung(
    view: {
      moveId: string;
      damagePerHit: number[];
      knockbackPerHit: Array<AttackMove['knockback']>;
      hitbox: AttackMove['hitbox'];
    },
    idx: number,
    facing: 1 | -1,
  ): void {
    const rungMove = {
      id: `${view.moveId}.hit${idx}`,
      type: 'special',
      damage: view.damagePerHit[idx],
      knockback: view.knockbackPerHit[idx],
      hitbox: view.hitbox,
      startupFrames: 0,
      activeFrames: 1,
      recoveryFrames: 0,
      cooldownFrames: 0,
    } as unknown as AttackMove;
    const body = spawnHitbox(
      this.scene as unknown as HitboxScene,
      { id: this.id, position: this.body.position, bodyId: this.body.id },
      rungMove,
      facing,
    );
    this.transientHitboxes.push({ body, framesRemaining: MULTIHIT_RUNG_FRAMES });
  }

  /**
   * Resolve a `dashStrike` side-special into its dash parameters, or
   * `null`. A dashStrike forces the fighter forward at `dashSpeed` for the
   * first `dashFrames` of the active window with the move's own hitbox
   * sweeping along (the Falcon-Raptor-Boost / dash-grab archetype). Pure.
   */
  private resolveDashStrike(
    move: AttackMove,
  ): { dashSpeed: number; dashFrames: number } | null {
    const m = move as unknown as {
      type?: string;
      sideSpecialKind?: string;
      dashStrike?: { dashSpeed: number; dashFrames: number };
      commandDash?: { dashSpeed: number; dashFrames: number };
    };
    if (m.type !== 'sideSpecial') return null;
    if (m.sideSpecialKind === 'dashStrike' && m.dashStrike) {
      return { dashSpeed: m.dashStrike.dashSpeed, dashFrames: m.dashStrike.dashFrames };
    }
    // commandDash shares the dash-travel mechanic (the lunge approach); its
    // throw payoff is handled separately by the command-grab opening hitbox.
    if (m.sideSpecialKind === 'commandDash' && m.commandDash) {
      return {
        dashSpeed: m.commandDash.dashSpeed,
        dashFrames: m.commandDash.dashFrames,
      };
    }
    return null;
  }

  /**
   * Resolve a COMMAND-GRAB move (neutral `commandGrab` Bear, or side
   * `commandDash` Bear) into its throw payload, or `null`. Both are
   * `damage: 0` shells whose real effect is the throw on connect; the
   * opening hitbox is spawned carrying these values + an unblockable tag
   * so a shielding victim is still thrown (grabs beat shield). Pure.
   *
   * NOTE: this is the pragmatic command grab — the opening hitbox throws
   * on connect rather than entering a true hold-then-throw grab state.
   */
  private resolveCommandGrabSpec(move: AttackMove): {
    throwDamage: number;
    throwKnockback: AttackMove['knockback'];
    ignoresShield: boolean;
  } | null {
    const m = move as unknown as {
      type?: string;
      specialKind?: string;
      sideSpecialKind?: string;
      grab?: { throwDamage: number; throwKnockback: AttackMove['knockback']; ignoresShield?: boolean };
      commandDash?: { throwDamage: number; throwKnockback: AttackMove['knockback']; ignoresShield?: boolean };
    };
    if (m.type === 'special' && m.specialKind === 'commandGrab' && m.grab) {
      return {
        throwDamage: m.grab.throwDamage,
        throwKnockback: m.grab.throwKnockback,
        ignoresShield: m.grab.ignoresShield !== false,
      };
    }
    if (
      m.type === 'sideSpecial' &&
      m.sideSpecialKind === 'commandDash' &&
      m.commandDash
    ) {
      return {
        throwDamage: m.commandDash.throwDamage,
        throwKnockback: m.commandDash.throwKnockback,
        ignoresShield: m.commandDash.ignoresShield !== false,
      };
    }
    return null;
  }

  /**
   * Resolve a `reflector` side-special (Owl) into its CONTACT-poke spec,
   * or `null`. The reflector FIELD (the `reflectorBody` geometry) doubles
   * as a small contact hitbox carrying `contactDamage` / `contactKnockback`
   * for the rare case a fighter walks into the field — projectile
   * reflection itself is handled separately by MatchScene. Pure.
   */
  private resolveReflectorContact(move: AttackMove): {
    contactDamage: number;
    contactKnockback: AttackMove['knockback'];
    reflectorBody: { offsetX: number; offsetY: number; width: number; height: number };
  } | null {
    const m = move as unknown as {
      type?: string;
      sideSpecialKind?: string;
      reflector?: {
        contactDamage: number;
        contactKnockback: AttackMove['knockback'];
        reflectorBody: { offsetX: number; offsetY: number; width: number; height: number };
      };
    };
    if (
      m.type === 'sideSpecial' &&
      m.sideSpecialKind === 'reflector' &&
      m.reflector
    ) {
      return {
        contactDamage: m.reflector.contactDamage,
        contactKnockback: m.reflector.contactKnockback,
        reflectorBody: m.reflector.reflectorBody,
      };
    }
    return null;
  }

  /**
   * True iff a move declares a "helpless after" flag — the committal
   * aerial specials that drop the fighter into free-fall when they end in
   * the air. The runtime sets {@link helpless} on the move's end frame if
   * the fighter is airborne. Pure.
   */
  private movesetEndsHelpless(move: AttackMove): boolean {
    const m = move as unknown as {
      type?: string;
      sideSpecialKind?: string;
      upSpecialKind?: string;
      downSpecialKind?: string;
      dashStrike?: { helplessAfterDash?: boolean };
      commandDash?: { helplessOnWhiff?: boolean };
      directionalJump?: { helplessAfterBurst?: boolean };
      stallAndFall?: { helplessAfterFall?: boolean };
    };
    if (m.type === 'sideSpecial') {
      if (m.sideSpecialKind === 'dashStrike') return m.dashStrike?.helplessAfterDash === true;
      if (m.sideSpecialKind === 'commandDash') return m.commandDash?.helplessOnWhiff === true;
    }
    // EVERY up-special drops the fighter into helpless special-fall when it
    // ends in the air — the central recovery risk in Smash (you commit to
    // your recovery; you can't act again until you land or grab a ledge).
    // Not just the one with an explicit flag.
    if (m.type === 'upSpecial') return true;
    if (m.type === 'downSpecial' && m.downSpecialKind === 'stallAndFall') {
      return m.stallAndFall?.helplessAfterFall === true;
    }
    return false;
  }

  /**
   * Per-frame physics for a `dashStrike` side-special — mirrors
   * {@link tickDownSpecialDivePhysics}. For the first `dashFrames` of the
   * active window it OVERRIDES velocity to a flat forward dash
   * (`facing * dashSpeed`, vy 0); every active frame it re-anchors the
   * move's hitbox onto the dashing body so the strike sweeps the ground
   * it covers (grounded-move hitboxes don't track by default). The base
   * hitbox is NOT suppressed — it IS the dash hitbox. No-op for non-dash
   * moves.
   */
  private tickSideSpecialDash(): void {
    const a = this.activeAttack;
    if (a === null) return;
    const dash = this.resolveDashStrike(a.move);
    if (dash === null) return;
    if (Character.phaseFor(a.framesElapsed, a.move) !== 'active') return;
    const framesIntoActive = a.framesElapsed - a.move.startupFrames;
    if (framesIntoActive < dash.dashFrames) {
      this.scene.matter.body.setVelocity(this.body, {
        x: a.facing * dash.dashSpeed,
        y: 0,
      });
    }
    if (a.hitboxBody !== null) {
      updateHitboxPosition(
        this.scene as unknown as HitboxScene,
        a.hitboxBody,
        this.body.position,
        a.move,
        a.facing,
      );
    }
  }

  /**
   * Resolve a move into a uniform COUNTER spec, or `null`. The neutral
   * counter (`specialKind: 'counter'`, Wolf/Aegis) and the down counter
   * (`downSpecialKind: 'counter'`, Bear) carry a field-identical `counter`
   * block, so one structural resolver — and one parry/retaliate handler —
   * lights up all three moves. Pure.
   */
  private resolveCounterSpec(move: AttackMove): {
    counterWindowStart: number;
    counterWindowEnd: number;
    damageMultiplier: number;
    minCounterDamage: number;
    maxCounterDamage: number;
    counterKnockback: AttackMove['knockback'];
    counterHitbox: { offsetX: number; offsetY: number; width: number; height: number };
  } | null {
    const m = move as unknown as {
      type?: string;
      specialKind?: string;
      downSpecialKind?: string;
      counter?: {
        counterWindowStart: number;
        counterWindowEnd: number;
        damageMultiplier: number;
        minCounterDamage: number;
        maxCounterDamage: number;
        counterKnockback: AttackMove['knockback'];
        counterHitbox: { offsetX: number; offsetY: number; width: number; height: number };
      };
    };
    const isCounter =
      (m.type === 'special' && m.specialKind === 'counter') ||
      (m.type === 'downSpecial' && m.downSpecialKind === 'counter');
    if (isCounter && m.counter) {
      return {
        counterWindowStart: m.counter.counterWindowStart,
        counterWindowEnd: m.counter.counterWindowEnd,
        damageMultiplier: m.counter.damageMultiplier,
        minCounterDamage: m.counter.minCounterDamage,
        maxCounterDamage: m.counter.maxCounterDamage,
        counterKnockback: m.counter.counterKnockback,
        counterHitbox: m.counter.counterHitbox,
      };
    }
    return null;
  }

  /**
   * Spawn the counter RETALIATION hitbox the tick after a successful parry
   * (see {@link pendingCounterRetaliation}, latched in {@link applyHit}).
   * Damage = absorbed × `damageMultiplier`, clamped to
   * `[minCounterDamage, maxCounterDamage]`; geometry from `counterHitbox`
   * (facing-mirrored); a short-lived transient sensor like the dive
   * shockwave. No-op when no parry is pending.
   */
  private tickCounterRetaliation(): void {
    if (this.pendingCounterRetaliation === null) return;
    const a = this.activeAttack;
    const absorbed = this.pendingCounterRetaliation.absorbedDamage;
    this.pendingCounterRetaliation = null;
    if (a === null) return;
    const counter = this.resolveCounterSpec(a.move);
    if (counter === null) return;
    const damage = clamp(
      absorbed * counter.damageMultiplier,
      counter.minCounterDamage,
      counter.maxCounterDamage,
    );
    const retalMove = {
      id: `${a.move.id}.counter`,
      type: 'special',
      damage,
      knockback: counter.counterKnockback,
      hitbox: counter.counterHitbox,
      startupFrames: 0,
      activeFrames: 1,
      recoveryFrames: 0,
      cooldownFrames: 0,
    } as unknown as AttackMove;
    const body = spawnHitbox(
      this.scene as unknown as HitboxScene,
      { id: this.id, position: this.body.position, bodyId: this.body.id },
      retalMove,
      a.facing,
    );
    this.transientHitboxes.push({ body, framesRemaining: COUNTER_RETAL_FRAMES });
  }

  // -------------------------------------------------------------------------
  // Sub-AC 2.1 (T2 refactor) — per-slot attack execution hooks.
  //
  // Each `execute<Slot>` hook below is the canonical entrypoint for
  // firing the named slot in the canonical 10-slot
  // {@link import('./movesetContract').FighterMoveset} contract. The
  // base-class implementations preserve backward compatibility for
  // every test that constructs a `new Character(...)` directly and
  // populates the moveset via the per-fighter slot-wiring helper: the
  // default delegates to `attemptAttack(resolvedId)`, where
  // `resolvedId` is the move id the {@link tickAttack} dispatcher
  // resolved through the legacy slot table cascade
  // (`classifyGroundedAttack` / `classifyAerialAttack`).
  //
  // Per-fighter subclasses (Wolf, Cat, Owl, Bear) OVERRIDE these hooks
  // to fire their authored move record directly (e.g.
  // `executeJab() { return this.attemptAttack(WOLF_JAB.id); }`). The
  // override IGNORES the `resolvedId` argument because the subclass
  // already knows which move belongs in its slot — the per-fighter
  // ownership of the slot↔move mapping is the architectural separation
  // the T2 refactor delivers ("each fighter fully owns its moveset
  // top-to-bottom; zero attack-implementation code in shared
  // Character base").
  //
  // Why hooks (not abstract methods): the base `Character` class is
  // still constructed directly in the unit-test suite (with bare
  // `TEST_LIGHT` / `TEST_HEAVY` / `TEST_SPECIAL` move records) to
  // exercise the dispatcher contract in isolation from any specific
  // roster. Making the hooks abstract would break those tests; making
  // them virtual with a sane default preserves them while giving
  // production rosters a clean override surface.
  //
  // Return value contract: `true` iff the underlying move started
  // (passed `canAttack()`, was registered, fighter not destroyed).
  // The {@link tickAttack} dispatcher reads the return for the
  // back-aerial facing-flip post-step.
  //
  // Why `protected`: the hooks are subclass extension points, not part
  // of the public API. Tests / AI / replay should call `attemptAttack`
  // / `attemptUpSpecial` directly with a known move id rather than
  // routing through a per-slot hook. The exception is the input layer
  // (T1's "fix special-attack input wiring bug" sub-AC), which will
  // call `executeNeutralSpecial` / `executeSideSpecial` etc. on the
  // concrete fighter — those calls land via the public override and
  // do not need to reach back into the base class.
  //
  // Sub-AC 2.1 scope is "light/heavy/special slots" (per the task
  // brief). Shield / dodge entries remain in
  // {@link applyInput}'s `tickShield` / `tickDodge` composition —
  // their migration is a follow-up sub-AC.
  // -------------------------------------------------------------------------

  /**
   * Hook — fire this fighter's jab. Default delegates to the resolved
   * id from the dispatcher (backward compat for base-class tests).
   * Subclasses override to call `attemptAttack(<X>_JAB.id)` directly.
   *
   * AC 4 (T2) — slot override consulted first; if a held item's
   * override consumed the press, the native jab does not run.
   */
  protected executeJab(resolvedId: string | null): boolean {
    if (this.runSlotOverride('jab')) return true;
    return resolvedId !== null ? this.attemptAttack(resolvedId) : false;
  }

  /**
   * Hook — fire this fighter's tilt. Default delegates to the resolved
   * id (which already cascaded `tilt → jab → default` inside the
   * dispatcher for partial movesets).
   */
  protected executeTilt(resolvedId: string | null): boolean {
    if (this.runSlotOverride('tilt')) return true;
    return resolvedId !== null ? this.attemptAttack(resolvedId) : false;
  }

  /** Hook — fire this fighter's smash. */
  protected executeSmash(resolvedId: string | null): boolean {
    if (this.runSlotOverride('smash')) return true;
    return resolvedId !== null ? this.attemptAttack(resolvedId) : false;
  }

  /**
   * Hook — fire this fighter's forward aerial. Default delegates to
   * the resolved id (which already cascaded
   * `fair → neutral → legacy aerial → light → default` for partial
   * movesets).
   */
  protected executeFair(resolvedId: string | null): boolean {
    if (this.runSlotOverride('fair')) return true;
    return resolvedId !== null ? this.attemptAttack(resolvedId) : false;
  }

  /**
   * Hook — fire this fighter's neutral special. Default consults the
   * `neutralSpecialId` slot directly (the slot is auto-filled by the
   * per-fighter slot-wiring helper for any `'special'`-typed move).
   */
  protected executeNeutralSpecial(): boolean {
    if (this.runSlotOverride('neutralSpecial')) return true;
    if (this.neutralSpecialId === null) return false;
    return this.attemptAttack(this.neutralSpecialId);
  }

  /**
   * Hook — fire this fighter's side special. The base class has no
   * dedicated `sideSpecialId` slot today, so the default looks up the
   * first registered `'sideSpecial'`-typed move via the {@link attacks}
   * registry. Subclasses override with a direct
   * `attemptAttack(<X>_SIDE_SPECIAL.id)` call.
   */
  protected executeSideSpecial(): boolean {
    if (this.runSlotOverride('sideSpecial')) return true;
    for (const move of this.attacks.values()) {
      if (move.type === 'sideSpecial') {
        return this.attemptAttack(move.id);
      }
    }
    return false;
  }

  /**
   * Hook — fire this fighter's up special. Default delegates to the
   * full {@link attemptUpSpecial} flow (which integrates the recovery /
   * vertical-physics on the press frame). The optional stick-direction
   * arguments default to "straight up" — the canonical no-stick
   * recovery press.
   */
  protected executeUpSpecial(stickX: number = 0, stickY: number = -1): boolean {
    if (this.runSlotOverride('upSpecial')) return true;
    return this.attemptUpSpecial(stickX, stickY);
  }

  /**
   * Hook — fire this fighter's down special. Default consults the
   * `downSpecialId` slot directly (auto-filled by the per-fighter
   * slot-wiring helper for any `'downSpecial'`-typed move).
   */
  protected executeDownSpecial(): boolean {
    if (this.runSlotOverride('downSpecial')) return true;
    if (this.downSpecialId === null) return false;
    return this.attemptAttack(this.downSpecialId);
  }

  // -------------------------------------------------------------------------
  // Internal — attack state tick
  // -------------------------------------------------------------------------

  /**
   * Phase classifier for an attack frame counter. Exclusive (`<`)
   * boundaries so each phase has *exactly* its declared frame count:
   *
   *   startup phase: f in [0, startupFrames)        → length = startupFrames
   *   active  phase: f in [startupFrames, +active)  → length = activeFrames
   *   recovery     : f in [..., totalBusy)          → length = recoveryFrames
   *   done         : f >= totalBusy                  → fighter free again
   *
   * `framesElapsed` is 0 on the press call itself (the move is just
   * starting), so the press frame consumes 0 of the attack's budget.
   * Subsequent fixed-step calls advance the counter by 1.
   */
  private static phaseFor(
    f: number,
    move: AttackMove,
  ): 'startup' | 'active' | 'recovery' | 'done' {
    if (f < move.startupFrames) return 'startup';
    if (f < move.startupFrames + move.activeFrames) return 'active';
    if (f < move.startupFrames + move.activeFrames + move.recoveryFrames) {
      return 'recovery';
    }
    return 'done';
  }

  /** Phase classifier instance helper for `getActiveAttack`. */
  private attackPhase(): 'startup' | 'active' | 'recovery' {
    const a = this.activeAttack;
    if (!a) return 'startup';
    const phase = Character.phaseFor(a.framesElapsed, a.move);
    // 'done' shouldn't be observable externally — `tickAttack` clears
    // `activeAttack` the same step the move ends, so we only ever
    // report the three live phases. Map 'done' → 'recovery' as a
    // defensive fallback for the snapshot's tail edge.
    return phase === 'done' ? 'recovery' : phase;
  }

  /**
   * One fixed-step advance of the attack state machine. Drives the
   * lifecycle in this order:
   *
   *   1. ADVANCE any in-flight attack first — increment framesElapsed,
   *      spawn the hitbox on the startup→active transition, despawn on
   *      active→recovery, end the move (and arm cooldown) on
   *      recovery→done.
   *   2. RISING-EDGE PRESS — if the player just pressed `attack` and
   *      we're free (no active attack, cooldown drained), kick off the
   *      default move with `framesElapsed = 0`. Doing this *after* the
   *      advance lets a press that lands on the very last cooldown
   *      frame still start an attack the same call.
   *   3. COOLDOWN DRAIN — if no attack is in flight, decrement the
   *      cooldown clock by one. This runs after the press attempt so
   *      that a successful press on a zero-cooldown frame starts a
   *      new attack instead of burning the cooldown for nothing.
   */
  private tickAttack(
    attackHeld: boolean,
    heavyHeld: boolean,
    grounded: boolean,
    moveX: number,
    prevFacing: 1 | -1,
    justLanded: boolean,
    specialHeld: boolean = false,
    downHeld: boolean = false,
    upHeld: boolean = false,
    shieldHeld: boolean = false,
    attackMoveY: number = 0,
  ): void {
    // The call where a move ends *arms* the cooldown but does not also
    // drain it — otherwise the cooldown would read `cooldownFrames - 1`
    // immediately after the move's last frame, which is harder to
    // reason about and makes "after totalBusy frames, cooldown reads
    // cooldownFrames" a non-truth.
    let attackJustEnded = false;

    // Expire any transient hitboxes (dive landing shockwaves) — lifecycle
    // is independent of the active attack, so it ticks every frame.
    this.tickTransientHitboxes();
    // Advance placed traps (arm / detonate-window / expire) — they outlive
    // the placement attack, so they also tick every frame.
    this.tickTraps();

    // ---- Step 0: landing interrupt for in-flight aerials (AC 60102 -------
    // Sub-AC 2 "lock attack until completion or landing") ------------------
    // If we touched down this frame AND an aerial is still in flight,
    // end the move and apply landing-lag. Auto-cancel windows declared
    // on the move's `AerialMove` record may zero out the lag — the
    // helper `getLandingLagFrames` resolves "would landing now skip the
    // lag?" against the move's gameplay-frame counter.
    //
    // Plain `AttackMove`-typed aerials (legacy `WOLF_NAIR` / `CAT_NAIR`)
    // carry no landing-lag fields; we cancel them cleanly (lag = 0). The
    // attack is still interrupted — the "lock until completion or
    // landing" half of the contract — but the fighter is free to act
    // immediately afterwards, mirroring the canonical "pre-AerialMove
    // schema" behaviour those movesets shipped with.
    if (
      justLanded &&
      this.activeAttack !== null &&
      this.activeAttack.move.type === 'aerial'
    ) {
      const a = this.activeAttack;
      const aerialMaybe = a.move as Partial<AerialMove>;
      let lagFrames = 0;
      if (typeof aerialMaybe.landingLagFrames === 'number') {
        lagFrames = getLandingLagFrames(a.move as AerialMove, a.framesElapsed);
      }
      // Despawn any live hitbox so a frame-perfect "swing-then-touchdown"
      // doesn't leave a sensor floating in the world.
      if (a.hitboxBody !== null) {
        despawnHitbox(this.scene as unknown as HitboxScene, a.hitboxBody);
      }
      this.activeAttack = null;
      // Stamping the cooldown with the resolved landing-lag means the
      // grounded press dispatch below is correctly gated: lag > 0 ⇒ no
      // press fires this frame, lag = 0 (auto-cancel) ⇒ a press that
      // also lands this frame can fire a clean grounded attack.
      this.cooldownRemaining = lagFrames;
      attackJustEnded = true;
    }

    // ---- Step 1: advance the in-flight attack -----------------------------
    if (this.activeAttack) {
      const a = this.activeAttack;
      const prevPhase = Character.phaseFor(a.framesElapsed, a.move);

      // Down-special DIVE (groundPound / stallAndFall) landing + hold-active
      // gate, resolved on the PRE-increment frame so the meteor hitbox is
      // still 'active' when we read it:
      //   • Touchdown while plunging → despawn the meteor, fire the landing
      //     shockwave, kill the descent velocity, and let the move advance
      //     into recovery this frame.
      //   • Still plunging past the end of the active window → FREEZE the
      //     frame counter so the meteor stays alive (and keeps re-anchoring
      //     to the falling body) until it lands — "falls until ground
      //     contact", bounded by DIVE_MAX_HOLD_FRAMES.
      const dive = this.resolveDiveSpec(a.move);
      let holdDiveActive = false;
      if (dive !== null && prevPhase === 'active') {
        const framesIntoActive = a.framesElapsed - a.move.startupFrames;
        const descending = framesIntoActive >= dive.riseFrames;
        const lastActiveFrame =
          a.move.startupFrames + a.move.activeFrames - 1;
        if (descending && grounded && !this.diveShockwaveSpawned) {
          this.diveShockwaveSpawned = true;
          if (a.hitboxBody !== null) {
            despawnHitbox(
              this.scene as unknown as HitboxScene,
              a.hitboxBody,
            );
            a.hitboxBody = null;
          }
          this.spawnDiveShockwave(dive, a.facing);
          // One-shot render signal: a dive just landed here. The render
          // layer polls consumeDiveLandingEvent() to flash a burst even
          // when the shockwave hits empty ground (no collisionstart). This
          // is render-only — it never feeds back into the deterministic
          // sim (the shockwave DAMAGE above is the sim-side effect).
          this.diveLandingEvent = {
            x: this.body.position.x,
            y: this.body.position.y,
            facing: a.facing,
          };
          this.scene.matter.body.setVelocity(this.body, {
            x: this.body.velocity.x,
            y: 0,
          });
        } else if (
          descending &&
          !grounded &&
          a.framesElapsed >= lastActiveFrame &&
          this.diveHoldFrames < DIVE_MAX_HOLD_FRAMES
        ) {
          holdDiveActive = true;
          this.diveHoldFrames += 1;
        }
      }

      if (!holdDiveActive) {
        a.framesElapsed += 1;
      }
      const newPhase = Character.phaseFor(a.framesElapsed, a.move);

      // Spawn on startup → active transition. The hitbox is spawned at
      // the body's *current* centre (post-velocity-commit) so a fighter
      // dashing into the swing extends his hitbox's effective reach by
      // a small physically-honest amount.
      // A charge-beam projectile (Samus cannon) carries ALL of its damage
      // on the travelling projectile spawned by MatchScene — it must NOT
      // also spawn a body-attached melee hitbox, or the shot would
      // double-hit at point blank. Every other move spawns its hitbox.
      const releasesChargeBeam =
        (a.move as { chargedProjectile?: unknown }).chargedProjectile !==
        undefined;
      // A multi-hit LADDER move (side `multiHit` / up `multiHitRising`)
      // spawns its damage as per-rung transient sensors via
      // tickMultiHitLadder — NOT as the single base hitbox here, or rung 0
      // and the base hitbox would double-hit on the first active frame.
      const isMultiHitLadder = this.resolveMultiHitSpec(a.move) !== null;
      // Reset the ladder rung counter the moment a ladder move goes active.
      if (prevPhase === 'startup' && newPhase === 'active' && isMultiHitLadder) {
        this.multiHitNextIndex = 0;
      }
      // A `trap` down-special places its mine on going active and suppresses
      // the degenerate 1x1 base hitbox (all the payoff is the placed trap).
      const trapSpec = this.resolveTrapSpec(a.move);
      if (prevPhase === 'startup' && newPhase === 'active' && trapSpec !== null) {
        this.placeTrap(trapSpec, a.facing, a.move.id);
      }
      if (
        prevPhase === 'startup' &&
        newPhase === 'active' &&
        a.hitboxBody === null &&
        !releasesChargeBeam &&
        !isMultiHitLadder &&
        trapSpec === null
      ) {
        // A charge release spawns its hitbox with damage / knockback
        // lerped along the move's `charge` ramp at the held-frame count.
        // A command grab (Bear neutral/side) spawns its opening hitbox
        // carrying the THROW values + an unblockable tag so it throws a
        // shielding victim. Every other move spawns its authored record.
        const cmdGrab = this.resolveCommandGrabSpec(a.move);
        const reflector = this.resolveReflectorContact(a.move);
        const spawnMove =
          cmdGrab !== null
            ? ({
                ...a.move,
                damage: cmdGrab.throwDamage,
                knockback: cmdGrab.throwKnockback,
                unblockable: cmdGrab.ignoresShield,
              } as unknown as AttackMove)
            : reflector !== null
              ? // The reflector's FIELD (the reflectorBody geometry) is the
                // contact hitbox — a fighter who walks into it eats the
                // small contact poke. (Projectiles crossing it are bounced
                // by MatchScene's projectile loop, separately.)
                ({
                  ...a.move,
                  damage: reflector.contactDamage,
                  knockback: reflector.contactKnockback,
                  hitbox: {
                    offsetX: reflector.reflectorBody.offsetX,
                    offsetY: reflector.reflectorBody.offsetY,
                    width: reflector.reflectorBody.width,
                    height: reflector.reflectorBody.height,
                  },
                } as unknown as AttackMove)
              : this.chargedSpawnMove(a);
        a.hitboxBody = spawnHitbox(
          this.scene as unknown as HitboxScene,
          { id: this.id, position: this.body.position, bodyId: this.body.id },
          spawnMove,
          a.facing,
        );

        // AC 10302 Sub-AC 2 — fire the move's swing SFX at the exact
        // frame the hitbox enters the world. The mapping covers the
        // four canonical buckets (jab / tilt / smash / aerial); special
        // / grab / throw / shield / dodge / taunt buckets return null
        // from the helper and the call short-circuits — those events
        // either have no shipped SFX yet (specials, grabs) or are
        // voiced from their dedicated state-machine transition
        // (shield raise / dodge press, both handled inside `applyInput`).
        //
        // The cue fires from the per-frame physics tick so the cadence
        // is a deterministic function of the input stream — the M4
        // replay system re-emits inputs and the audio layer re-derives
        // identical SFX timing on playback. The {@link AudioManager}'s
        // wall-clock cooldown / voice-limit gates only decide whether
        // a *given* call produces sound; they never affect simulation
        // state.
        const attackSfxKey = mapMoveTypeToSfxKey(a.move.type);
        if (attackSfxKey !== null) {
          emitCombatSfx(this.sfxSink ?? undefined, attackSfxKey);
        }

        // A fresh down-special dive just entered its active window (the
        // meteor is live) — reset the per-dive landing / hold latches so
        // the burst fires once and the hold-cap starts from zero.
        if (dive !== null) {
          this.diveShockwaveSpawned = false;
          this.diveHoldFrames = 0;
        }
      }

      // AC 60103 Sub-AC 3 — track aerial hitboxes to the attacker's
      // current world-space position every frame they remain in the
      // 'active' phase. A grounded fighter swinging a jab is largely
      // stationary during the active window, so the canonical "rooted-
      // stance reach" feel from the spawn-time anchor still applies for
      // grounded moves; an airborne fighter can drift several body-
      // lengths during a 4-frame fair / nair / bair active window, and
      // a static hitbox visibly misses targets that the fighter clearly
      // swung through. Re-projecting the sensor onto the body's centre
      // each step keeps the attack's reach honest across the move's
      // entire active window — exactly the contract Sub-AC 3 specifies
      // ("attaching them to the character's position with correct
      // offsets per move").
      //
      // We re-anchor only while the move's frame counter is INSIDE the
      // active window (newPhase === 'active'), gated to aerial moves
      // (a.move.type === 'aerial') so grounded moves keep their
      // existing fixed-anchor behaviour and the AC 202 hitbox tests
      // continue to pass unchanged.
      //
      // Order matters: this comes AFTER the spawn check above (so a
      // first-frame-active hitbox gets re-anchored only on subsequent
      // frames if the body moves) and BEFORE the despawn check below
      // (so the leave-active step does not re-anchor a sensor that's
      // about to be removed). The combined invariant: the sensor's
      // position equals `computeHitboxCenter(...)` for every frame it
      // exists in the world.
      if (
        a.hitboxBody !== null &&
        newPhase === 'active' &&
        a.move.type === 'aerial'
      ) {
        updateHitboxPosition(
          this.scene as unknown as HitboxScene,
          a.hitboxBody,
          this.body.position,
          a.move,
          a.facing,
        );
      }

      // AC 60303 Sub-AC 3 — drive the per-frame physics of an in-flight
      // up-special. Runs AFTER hitbox spawn / tracking (so the standard
      // sensor lifecycle is unchanged) and BEFORE the active→recovery
      // despawn (so a `teleport` reappear translation lands while the
      // active window's last frame is still nominally "active"). The
      // helper is a no-op for non-up-special moves, the `multiHitRising`
      // and `tether` kinds whose press-frame impulse owns the recovery
      // physics, and the `directionalJump` kind on frames outside the
      // burst window — only the `directionalJump` burst clamp and the
      // `teleport` reappear translation actually mutate body state here.
      this.tickUpSpecialPhysics();
      // Drive the down-special dive plunge (hop/stall → slam/fall velocity)
      // and re-anchor the meteor onto the falling body. No-op for every
      // non-dive move. Placed alongside the up-special physics so both
      // recovery / committal specials share the same lifecycle slot.
      this.tickDownSpecialDivePhysics();
      // Drive the multi-hit ladder (side `multiHit` barrage / up
      // `multiHitRising` spin): spawn each scheduled rung as its own
      // transient sensor. No-op for every non-ladder move.
      this.tickMultiHitLadder();
      // Drive the `dashStrike` side-special forward dash + sweeping hitbox.
      // No-op for every non-dash move.
      this.tickSideSpecialDash();
      // Spawn the counter retaliation hitbox the tick after a successful
      // parry (neutral / down counter). No-op when no parry is pending.
      this.tickCounterRetaliation();

      // Despawn whenever we leave the 'active' phase — handles the
      // standard active→recovery transition and the rare active→done
      // case (a move with zero recovery frames).
      if (prevPhase === 'active' && newPhase !== 'active' && a.hitboxBody !== null) {
        despawnHitbox(this.scene as unknown as HitboxScene, a.hitboxBody);
        a.hitboxBody = null;
      }

      // End of move — release the fighter and arm cooldown.
      if (newPhase === 'done') {
        // Defensive: if a hitbox somehow survived the despawn check
        // above (e.g. zero-active-frames move that jumped startup→done),
        // clean it up so we never leak a sensor.
        if (a.hitboxBody !== null) {
          despawnHitbox(this.scene as unknown as HitboxScene, a.hitboxBody);
          a.hitboxBody = null;
        }
        this.cooldownRemaining = a.move.cooldownFrames;
        // A committal aerial special that ends in the AIR drops the fighter
        // into helpless free-fall (Owl's burst, an air dashStrike /
        // stallAndFall / commandDash). On the ground it just ends normally.
        if (this.movesetEndsHelpless(a.move) && !this.isGrounded()) {
          this.helpless = true;
        }
        this.activeAttack = null;
        attackJustEnded = true;
      }
    }

    // ---- Step 2: rising-edge press (Sub-AC 3.3 + AC 60102 Sub-AC 2 -------
    // ----                            directional aerial dispatch) --------
    // Pick a move id based on which button rose this frame and the
    // fighter's grounded state. Heavy press takes priority on the
    // ground; in the air, heavy is ignored (smashes are grounded
    // moves) and `attack` resolves to a direction-aware aerial slot.
    //
    // Direction classification (airborne `attack` press only):
    //
    //   |moveX| < AERIAL_STICK_THRESHOLD  → neutral aerial (nair)
    //   sign(moveX) === prevFacing        → forward aerial (fair)
    //   sign(moveX) === -prevFacing       → back    aerial (bair)
    //
    // Cascading fallback per direction keeps single-aerial movesets
    // (legacy `WOLF_NAIR` registered alone) firing on any directional
    // press — the directional slots are empty so the resolver falls
    // through to `aerialAttackId`.
    const attackJustPressed = attackHeld && !this.prevAttackHeld;
    const heavyJustPressed = heavyHeld && !this.prevHeavyHeld;
    // ---- Smash-charge state machine (hold to charge, release/cap to fire) ---
    // Mirrors the special-charge machine but for grounded smashes. While
    // charging it consumes the frame so every press path below is skipped;
    // on release (or hitting the cap, or leaving the ground) it fires the
    // smash scaled by the held frames. Smashes AUTO-FIRE at max charge
    // (a special instead STORES at the cap) — the canonical Smash difference.
    let smashConsumedThisFrame = false;
    if (this.chargingSmash !== null) {
      const cs = this.chargingSmash;
      const triggerHeld = heavyHeld || attackHeld;
      if (!grounded) {
        // Left the ground mid-charge (e.g. a platform dropped out). A
        // grounded smash must NOT spawn in the air — drop the charge
        // silently rather than firing a ground move airborne. (A jump
        // press can't reach here: it's suppressed while charging below.)
        this.chargingSmash = null;
        smashConsumedThisFrame = true;
      } else if (
        triggerHeld &&
        this.activeAttack === null &&
        cs.framesHeld < cs.maxFrames
      ) {
        cs.framesHeld += 1;
        smashConsumedThisFrame = true;
      } else {
        // Released, or hit the cap — fire the smash (we are grounded here).
        const { moveId, facing, framesHeld } = cs;
        this.chargingSmash = null;
        this.fireSmash(moveId, facing, framesHeld);
        smashConsumedThisFrame = true;
      }
    }
    // When holding an item, route the LIGHT-attack press to the item's
    // slot override regardless of grounded / airborne / stick direction.
    // Per the user's spec: "while having an object, light attack isn't
    // triggered by its button, only the object — objects can be used
    // while in air." The item declares its overrides (jab / tilt /
    // smash / fair); we walk them in priority order and the first that
    // fires consumes the press, suppressing the native dispatch below.
    // Heavy press is unaffected (smash slot still routes through its
    // own override via `executeSmash`).
    let attackPressConsumedByItem = false;
    if (
      attackJustPressed &&
      !smashConsumedThisFrame &&
      this.slotOverrides.size > 0 &&
      this.activeAttack === null &&
      this.cooldownRemaining === 0
    ) {
      attackPressConsumedByItem =
        this.runSlotOverride('jab') ||
        this.runSlotOverride('tilt') ||
        this.runSlotOverride('smash') ||
        this.runSlotOverride('fair');
    }
    // ---- Jab-combo advance ------------------------------------------------
    // A re-press of attack DURING a chainable jab stage — once that stage's
    // hitbox has come out (framesElapsed past the advance window) — steps
    // the string to its next stage instead of being swallowed. Because the
    // advance leaves `activeAttack` non-null, the fresh-dispatch gate below
    // naturally skips a brand-new move this same frame. Single-jab rosters
    // (no `jabChain`) and every non-jab move short-circuit on `chain == null`.
    if (
      attackJustPressed &&
      grounded &&
      !attackPressConsumedByItem &&
      !smashConsumedThisFrame &&
      this.activeAttack !== null
    ) {
      const curMove = this.activeAttack.move as AttackMoveWithAnimation;
      const chain = curMove.jabChain;
      if (
        chain != null &&
        this.attacks.has(chain.nextId) &&
        this.activeAttack.framesElapsed >=
          (chain.advanceWindowStart ?? curMove.startupFrames)
      ) {
        this.advanceJabChain(chain.nextId);
      }
    }
    if (
      this.activeAttack === null &&
      this.cooldownRemaining === 0 &&
      !attackPressConsumedByItem &&
      !smashConsumedThisFrame
    ) {
      let pickedId: string | null = null;
      let aerialDirection: AerialDirection | null = null;
      // Sub-AC 2.1 (T2 refactor) — capture the grounded pattern alongside
      // the resolved move id so the post-classification dispatcher below
      // can route the press through the per-fighter `execute<Slot>` hook
      // (`executeJab` / `executeTilt` / `executeSmash`) instead of
      // calling `attemptAttack(pickedId)` directly. The base class no
      // longer holds the per-fighter "fire WHICH move when slot X is
      // pressed" decision — that lives on each fighter subclass now.
      let groundedPattern:
        | 'jab'
        | 'tilt'
        | 'smash'
        | 'utilt'
        | 'usmash'
        | 'dtilt'
        | 'dsmash'
        | 'dashAttack'
        | null = null;
      if (grounded && (attackJustPressed || heavyJustPressed)) {
        // AC 60101 Sub-AC 1 — grounded normal-move dispatch.
        //
        // Delegate the jab / tilt / smash classification to the pure
        // helper so the runtime, the AI's input synthesiser, the
        // (later AC) input-rebinding screen, and the replay drift
        // verifier all read from a single source of truth.
        //
        // Slots:
        //   • jabId   ← the historic light slot (`'jab'`/`'tilt'` first
        //                wins; preserves backward compat for single-move
        //                test fighters).
        //   • tiltId  ← the dedicated tilt slot, populated by
        //                `'tilt'`-typed registers only. Null when the
        //                roster ships no tilt — the helper cascades
        //                through to `jabId` so directional presses
        //                still fire something.
        //   • smashId ← the heavy slot (filled by `'smash'`-typed
        //                registers). Null disables the smash dispatch
        //                entirely (a heavy-button press on a roster
        //                without a smash is a no-op, not a jab).
        //   • defaultId ← the legacy first-registered fallback.
        //
        // Stick history: the helper reads the *raw* `prevMoveX` latched
        // from the previous frame's clamped stick (no shield / dodge
        // mask) so a smash flick is detected against the actual stick
        // motion, not the post-shield zeroed value.
        const slots: GroundedAttackSlots = {
          jabId: this.lightAttackId,
          tiltId: this.tiltAttackId,
          smashId: this.heavyAttackId,
          utiltId: this.upTiltId,
          usmashId: this.upSmashId,
          dtiltId: this.downTiltId,
          dsmashId: this.downSmashId,
          dashAttackId: this.dashAttackSlotId,
          defaultId: this.defaultAttackId,
        };
        // "Running" = horizontal speed past ~55% of max run, used to tell a
        // dash attack (running + attack) from a forward tilt (tilt from a
        // near-standstill). Read off the live Matter velocity.
        const movingFast =
          Math.abs(this.body.velocity.x) >
          this.tuning.maxRunSpeed * DASH_SPEED_FRACTION;
        const dispatch = classifyGroundedAttack(
          {
            attackJustPressed,
            heavyJustPressed,
            moveX,
            prevMoveX: this.prevMoveX,
            prevMoveY: this.prevMoveY,
            moveY: attackMoveY,
            movingFast,
          },
          slots,
        );
        if (dispatch !== null) {
          pickedId = dispatch.moveId;
          groundedPattern = dispatch.pattern;
        }
      } else if (!grounded) {
        // Airborne attack press — AC 60201 Sub-AC 1 airborne state
        // detection + aerial dispatch. The grounded press path is
        // handled exclusively by the `classifyGroundedAttack` branch
        // above; the heavy press is dropped silently when airborne
        // (smashes are grounded moves; aerials own the in-air kit).
        //
        // Delegate the airborne classification to the pure helper so
        // the runtime, the AI's input synthesiser, the (later AC)
        // input-rebinding screen, and the replay drift verifier all
        // read from a single source of truth. The helper applies the
        // aerial gate (`airborne === false ⇒ null`), drops heavy
        // presses, classifies direction relative to *prevFacing* (so
        // a stick press that also flipped facing this frame still
        // reads as "stick away from facing" = bair), and cascades
        // through the slot table for partial movesets.
        const aerialSlots: AerialAttackSlots = {
          aerialNeutralId: this.aerialNeutralId,
          aerialForwardId: this.aerialForwardId,
          aerialBackId: this.aerialBackId,
          aerialUpId: this.aerialUpId,
          aerialDownId: this.aerialDownId,
          aerialAttackId: this.aerialAttackId,
          lightAttackId: this.lightAttackId,
          defaultId: this.defaultAttackId,
        };
        const aerialDispatch = classifyAerialAttack(
          {
            airborne: !grounded,
            attackJustPressed,
            heavyJustPressed,
            moveX,
            moveY: attackMoveY,
            prevFacing,
          },
          aerialSlots,
        );
        if (aerialDispatch !== null) {
          pickedId = aerialDispatch.moveId;
          aerialDirection = aerialDispatch.direction;
        }
      }
      if (pickedId !== null) {
        // For airborne attacks, lock facing to `prevFacing` so the
        // character's visual orientation does not flip mid-aerial. The
        // motion section may have already flipped `this.facing` to
        // match the stick; we override that decision here because the
        // canonical Smash interpretation is "back-air does not turn
        // you around — your hitbox spawns behind you while you keep
        // facing forward."
        if (!grounded && aerialDirection !== null) {
          this.facing = prevFacing;
        }
        // Sub-AC 2.1 (T2 refactor) — route the resolved press through
        // the per-fighter `execute<Slot>` hook on the subclass instead
        // of calling `attemptAttack(pickedId)` directly. The base class
        // no longer holds the per-fighter "fire WHICH move when slot X
        // is pressed" decision — that lives on each fighter subclass
        // (Wolf, Cat, Owl, Bear) which override the hook to fire their
        // authored move record (`WOLF_JAB`, `CAT_NEUTRAL_SPECIAL`, …).
        //
        // Default base-class implementations of every hook (declared
        // below the per-frame tick) preserve backward-compat for the
        // base `Character` test fixtures: the default delegates back
        // to `attemptAttack(pickedId)` so a `new Character(...)` that
        // populates the moveset via the per-fighter slot-wiring helper
        // keeps dispatching through the legacy slot table exactly as
        // before. Subclasses ignore the resolvedId argument and use
        // their own move id.
        //
        // Slot routing:
        //   • grounded `jab`   pattern → `executeJab(pickedId)`
        //   • grounded `tilt`  pattern → `executeTilt(pickedId)`
        //   • grounded `smash` pattern → `executeSmash(pickedId)`
        //   • airborne forward direction → `executeFair(pickedId)`
        //   • airborne neutral / back / null direction → legacy
        //     `attemptAttack(pickedId)` (nair / bair sit OUTSIDE the
        //     canonical 10-slot uniform contract; their migration is
        //     scope for a follow-up sub-AC, not Sub-AC 2.1).
        // SMASH-CHARGE START — a smash press whose resolved move carries a
        // `charge` ramp ENTERS a hold-to-charge stance instead of firing
        // instantly; the charge machine (top of this dispatch) fires it on
        // release. Facing commits NOW (forward smash locks to the stick) so
        // a mid-charge wiggle can't flip it. A smash with no ramp falls
        // through to the instant-fire switch below (backward-compatible).
        let smashChargeStarted = false;
        if (
          grounded &&
          pickedId !== null &&
          (groundedPattern === 'smash' ||
            groundedPattern === 'usmash' ||
            groundedPattern === 'dsmash') &&
          // Don't hijack a held item's smash override: the forward-smash
          // instant path runs `executeSmash` → `runSlotOverride('smash')`,
          // so if an item override is installed, let it fire the item move
          // instead of entering a NATIVE charge stance.
          !(groundedPattern === 'smash' && this.getSlotOverride('smash') !== null)
        ) {
          const sc = this.smashChargeMove(pickedId);
          if (sc !== null) {
            let chargeFacing = this.facing;
            if (groundedPattern === 'smash' && Math.abs(moveX) >= 0.3) {
              chargeFacing = (Math.sign(moveX) as 1 | -1) || prevFacing;
              this.facing = chargeFacing;
            }
            this.chargingSmash = {
              moveId: pickedId,
              pattern: groundedPattern,
              facing: chargeFacing,
              framesHeld: 0,
              maxFrames: Math.max(1, sc.charge.maxChargeFrames),
            };
            smashChargeStarted = true;
          }
        }
        let started: boolean;
        if (smashChargeStarted) {
          // Charging — no move has fired yet this frame.
          started = false;
        } else if (grounded && groundedPattern !== null) {
          switch (groundedPattern) {
            case 'jab':
              started = this.executeJab(pickedId);
              break;
            case 'tilt':
              started = this.executeTilt(pickedId);
              break;
            case 'smash':
              started = this.executeSmash(pickedId);
              break;
            case 'utilt':
            case 'usmash':
            case 'dtilt':
            case 'dsmash':
            case 'dashAttack':
              // Directional grounded normals (up/down tilt + smash, dash
              // attack) route straight to the resolved move id — the
              // subclass execute hooks fire the FORWARD tilt/smash, so we
              // bypass them like the directional aerials do.
              started = this.attemptAttack(pickedId);
              break;
          }
        } else if (!grounded && aerialDirection === 'forward') {
          started = this.executeFair(pickedId);
        } else {
          // Airborne neutral / back press, or any path that did not
          // produce a pattern (defensive fallback): drive the legacy
          // dispatch directly. nair / bair are not part of the
          // 10-slot uniform contract Sub-AC 2.1 migrates.
          started = this.attemptAttack(pickedId);
        }
        // Back-aerial: the hitbox geometry is authored facing-right
        // (positive `offsetX` puts the hitbox in front of the
        // attacker). For bair we want the sensor to spawn BEHIND the
        // attacker, so we invert the active-attack's `facing` field —
        // `spawnHitbox` mirrors `offsetX` against this flag, and an
        // inverted flag on a "facing-right" wolf produces a hitbox to
        // his left, which is exactly the back-aerial geometry the
        // roster docs describe.
        //
        // We re-read `this.activeAttack` via a local because the
        // surrounding `if (this.activeAttack === null && ...)` block
        // has narrowed the field type to `null` in TypeScript's flow
        // analysis — the analyser doesn't know `attemptAttack` mutates
        // it. Reading through the local clears the narrowing.
        if (started && aerialDirection === 'back') {
          const just = this.getActiveAttack();
          if (just !== null && this.activeAttack !== null) {
            (this.activeAttack as { facing: 1 | -1 }).facing = (-prevFacing) as 1 | -1;
          }
        }
      }
    }

    // ---- Step 2b: special-press dispatch (T1, AC 5-9) -------------------
    // The G-binding fix: a rising-edge special press routes through to
    // the per-fighter `executeNeutralSpecial` / `executeSideSpecial`
    // / `executeUpSpecial` / `executeDownSpecial` hook based on the
    // stick direction at the press frame. The slot taxonomy:
    //
    //   stick neutral  →  executeNeutralSpecial()  (no horizontal
    //                                               commit, no down/up)
    //   stick down     →  executeDownSpecial()     (down held)
    //   stick up       →  executeUpSpecial()       (up held; jump key
    //                                               doubles as the up-flick)
    //   stick side     →  executeSideSpecial()     (|moveX| past
    //                                               the AERIAL_STICK_THRESHOLD)
    //
    // Direction priority is down > up > side > neutral so a "stick
    // diagonal" press (down + side) lands the more-specific down
    // special; this mirrors the canonical Smash Bros tap-direction
    // resolution.
    //
    // Edge detection: the press fires on `specialHeld && !prevSpecialHeld`
    // — held-down special doesn't refire every tick, only the rising
    // edge dispatches. The `activeAttack === null && cooldownRemaining
    // === 0` gate is the same one the attack/heavy press observes, so
    // an in-flight attack swallows the press exactly like an attack
    // press would.
    // ---- Charge-special state machine (hold to charge, release to fire) ---
    // Runs every tick BEFORE the rising-edge dispatch. While charging,
    // it consumes the special button so the normal dispatch below is
    // skipped. A neutral-special press on a `specialKind: 'charge'` move
    // STARTS charging (in the neutral branch) instead of firing.
    let specialConsumedByCharge = false;
    if (this.chargingSpecial !== null) {
      const cs = this.chargingSpecial;
      // Samus charge-cancel: a rising-edge SHIELD press while charging
      // BANKS the accumulated charge and exits the charge WITHOUT firing.
      // The bank persists across actions until fired or wiped (mid-charge
      // hit / respawn). This is what makes the charge feel "kept".
      const shieldStore = shieldHeld && !this.prevShieldHeld;
      if (shieldStore) {
        this.storedSpecialCharge = {
          moveId: cs.moveId,
          framesHeld: cs.framesHeld,
        };
        this.chargingSpecial = null;
        // Do NOT consume the special button — the player may still be
        // holding it; the rising-edge dispatch below won't refire (the
        // press already happened) and the shield raises normally.
      } else if (
        specialHeld &&
        this.activeAttack === null &&
        this.isGrounded()
      ) {
        // Still holding ON THE GROUND — keep charging, CAPPED at max. The
        // charge is GROUNDED-ONLY: it cannot progress while jumping/falling
        // (jump is suppressed while charging, so the only way to be airborne
        // here is an external launch / platform drop — which falls to the
        // else and fires the shot). A full charge is STORED at the cap until
        // released or hit; it does NOT auto-fire at the top.
        if (cs.framesHeld < cs.maxFrames) cs.framesHeld += 1;
        specialConsumedByCharge = true;
      } else {
        // Released — OR left the ground (cannot charge in the air) — fire
        // the shot scaled by how long it was held.
        const held = cs.framesHeld;
        const moveId = cs.moveId;
        this.chargingSpecial = null;
        this.storedSpecialCharge = null;
        this.fireNeutralChargeSpecial(moveId, held);
        specialConsumedByCharge = true;
      }
    }

    const specialJustPressed = specialHeld && !this.prevSpecialHeld;
    if (
      !specialConsumedByCharge &&
      specialJustPressed &&
      this.activeAttack === null &&
      this.cooldownRemaining === 0
    ) {
      const AERIAL_STICK_THRESHOLD = 0.3;
      if (downHeld) {
        this.executeDownSpecial();
      } else if (upHeld) {
        // Up-special: derive a stick direction from `moveX` so a
        // diagonal up-press lands a directional recovery. The
        // `(stickX, stickY=-1)` convention matches the per-fighter
        // override default ("straight up" when the player only tapped
        // up).
        const stickX =
          Math.abs(moveX) >= AERIAL_STICK_THRESHOLD ? Math.sign(moveX) : 0;
        this.executeUpSpecial(stickX, -1);
      } else if (Math.abs(moveX) >= AERIAL_STICK_THRESHOLD) {
        // Stick-side: lock the fighter's facing to the stick on the
        // press frame so the side-special's facing-mirrored hitbox
        // spawns in the direction the player committed to.
        const sign = Math.sign(moveX);
        const sideFacing: 1 | -1 = sign === 0 ? prevFacing : ((sign as 1 | -1));
        this.facing = sideFacing;
        this.executeSideSpecial();
      } else {
        // Neutral special. A chargeable move (a `'charge'` kind, or a
        // `'projectile'` carrying the Samus charge-beam overlay) begins a
        // hold-to-charge instead of firing immediately; every other
        // neutral special fires on the press as before.
        const chargeMove = this.neutralChargeMove();
        if (chargeMove !== null) {
          const maxFrames = Math.max(1, chargeMove.charge.maxChargeFrames);
          // A banked charge for THIS move resumes / fires instead of
          // starting from zero.
          const banked =
            this.storedSpecialCharge !== null &&
            this.storedSpecialCharge.moveId === chargeMove.id
              ? this.storedSpecialCharge
              : null;
          if (banked !== null && banked.framesHeld >= maxFrames) {
            // Banked FULL charge — pressing special fires it immediately,
            // on the ground OR in the air (a stored full Charge Shot
            // releases on press, like Samus).
            this.storedSpecialCharge = null;
            this.fireNeutralChargeSpecial(chargeMove.id, banked.framesHeld);
          } else if (this.isGrounded()) {
            // Start, or RESUME from a banked partial, charging — GROUNDED
            // ONLY: Samus charges rooted on the ground (no air-charging).
            this.chargingSpecial = {
              moveId: chargeMove.id,
              framesHeld: banked?.framesHeld ?? 0,
              maxFrames,
            };
            this.storedSpecialCharge = null; // now live in chargingSpecial
          } else {
            // Airborne press — you cannot START a charge in the air. Fire
            // whatever's banked (a partial) or an uncharged shot.
            const held = banked?.framesHeld ?? 0;
            this.storedSpecialCharge = null;
            this.fireNeutralChargeSpecial(chargeMove.id, held);
          }
        } else {
          this.executeNeutralSpecial();
        }
      }
    }

    // ---- Step 3: cooldown drain -------------------------------------------
    // Only drain when no attack is in flight (the move-busy window is
    // its own gate; we don't double-count) AND the move didn't just
    // arm the cooldown this same call.
    if (
      !attackJustEnded &&
      this.activeAttack === null &&
      this.cooldownRemaining > 0
    ) {
      this.cooldownRemaining -= 1;
    }
  }

  // -------------------------------------------------------------------------
  // Damage / knockback / hitstun (Sub-AC 4.1)
  // -------------------------------------------------------------------------

  /** Current accumulated damage percent. 0..MAX_DAMAGE_PERCENT. */
  getDamagePercent(): number {
    return this.damagePercent;
  }

  /**
   * Register a move this fighter just LANDED for stale-move negation, and
   * return how many times it was ALREADY in the recent-move queue BEFORE
   * this landing (0 = fresh). The caller stales the connecting hit by that
   * count (`combat.computeStaleMultiplier`), then this pushes the move and
   * trims the queue to {@link STALE_QUEUE_SIZE}. Attacker-side; the queue
   * naturally "freshens" a move as it rotates out.
   */
  registerLandedMove(moveId: string): number {
    let occurrences = 0;
    for (const id of this.staleMoveQueue) {
      if (id === moveId) occurrences += 1;
    }
    this.staleMoveQueue.push(moveId);
    if (this.staleMoveQueue.length > STALE_QUEUE_SIZE) {
      this.staleMoveQueue.shift();
    }
    return occurrences;
  }

  /** Occurrences of `moveId` in the stale queue WITHOUT mutating it (HUD / tests / AI). */
  getStaleOccurrences(moveId: string): number {
    let occurrences = 0;
    for (const id of this.staleMoveQueue) {
      if (id === moveId) occurrences += 1;
    }
    return occurrences;
  }

  /**
   * Replace the damage percent directly. Used by:
   *   • Respawn flow ("reset to 0 % when stock is lost").
   *   • Replay snapshot resync ("rewind to frame N's recorded percent").
   *   • Tests / debug HUD ("force percent to 90 to test KO ranges").
   *
   * Caps the input at `MAX_DAMAGE_PERCENT` so callers don't have to
   * worry about overflow.
   */
  setDamagePercent(percent: number): void {
    this.damagePercent = accumulateDamage(0, percent);
  }

  /**
   * Add `delta` to the current damage percent — lightweight accumulator
   * for damage that does NOT carry knockback or hitstun. Returns the new
   * percent for caller convenience.
   *
   * Why a separate method when `applyHit` already accumulates damage:
   *   • `applyHit` is the heavy combat path — it requires a full
   *     `HitInfo`, computes knockback, replaces velocity, locks the
   *     fighter into hitstun, and cancels in-flight attacks. Many
   *     damage sources don't want any of that — they just want a tick
   *     of percent. Forcing them through `applyHit` would either:
   *       (a) require synthesising a fake zero-knockback HitInfo and
   *           accept that velocity / hitstun get clobbered, or
   *       (b) reach inside the class for `setDamagePercent(getDamagePercent() + d)`
   *           and reimplement the clamp.
   *     Both are footguns. `addDamage` is the right primitive.
   *
   * Use cases (real and forthcoming):
   *   • Hazard stages — lava / spike ticks add damage every N frames
   *     without launching the fighter (knockback is the stage's job,
   *     not the damage's).
   *   • Healing items / pickups (M-future) — pass a negative delta;
   *     `accumulateDamage` floors at 0 so we won't go below zero.
   *   • Debug HUD / cheat console — "+10 damage" without the side
   *     effects of a hit.
   *   • Replay determinism tests — re-apply a logged damage delta to
   *     verify the percent meter reproduces exactly.
   *
   * Determinism: pure function of (current percent, delta) — no random,
   * no wall-clock. Identical (state, delta) pairs always produce the
   * same new percent.
   *
   * Invincibility: this method does NOT consult `invincibilityRemaining`.
   * It's a primitive — callers that want respawn-grace gating should
   * check `isInvincible()` first. (The combat path `applyHit` does gate
   * because that's the contract for incoming attacker hits; environmental
   * damage decides its own policy per hazard.)
   *
   * No-op for destroyed fighters — they ignore further damage and the
   * call still returns the (frozen) current percent.
   */
  addDamage(delta: number): number {
    if (this.destroyed) return this.damagePercent;
    this.damagePercent = accumulateDamage(this.damagePercent, delta);
    return this.damagePercent;
  }

  /** Frames of hitstun remaining; 0 when free to act. */
  getHitstunRemaining(): number {
    return this.hitstunRemaining;
  }

  /** True iff the fighter is currently locked out of player control. */
  isInHitstun(): boolean {
    return this.hitstunRemaining > 0;
  }

  /**
   * Hitlag freeze frames remaining (post-M2 hit-feel pass). Returns 0
   * when the fighter is not in a freeze. While > 0 the fighter is
   * visually paused at the moment of impact and the queued knockback
   * has not yet been applied.
   */
  getHitlagRemaining(): number {
    return this.hitlagRemaining;
  }

  /** True iff the fighter is mid-hitlag freeze. */
  isInHitlag(): boolean {
    return this.hitlagRemaining > 0;
  }

  /**
   * Arm an "attacker freeze" — the symmetric mutual-hitlag pause the
   * attacker enters when their hitbox connects. The scene's hit-
   * resolve callback should call this on the attacker right after
   * the target's `applyHit` so both fighters visually stop at the
   * moment of impact for the same number of frames (canonical Smash
   * "hit-stop").
   *
   * Behaviour:
   *   • Sets `hitlagRemaining = max(current, frames)` — never shortens
   *     an in-flight freeze (e.g. a multi-hit move's later contacts
   *     can extend but not curtail the first contact's freeze).
   *   • Does NOT touch `pendingKnockback` — the attacker has no
   *     queued launch; the hitlag-drain path naturally skips the
   *     "release knockback" branch when `pendingKnockback === null`.
   *   • While the freeze drains, the standard hitlag handling pins
   *     the attacker's body at zero velocity and skips per-frame
   *     ticks (movement, attack progression, hitstun decrement) so
   *     the in-flight attack hitbox stays at its current frame.
   *
   * No-op for destroyed fighters and for `frames <= 0`.
   */
  armAttackerHitlag(frames: number): void {
    if (this.destroyed) return;
    if (frames <= 0) return;
    if (frames > this.hitlagRemaining) {
      this.hitlagRemaining = frames;
    }
  }

  /**
   * Frames of respawn-grace invincibility remaining (Sub-AC 4.2).
   * 0 when the fighter is fully vulnerable.
   */
  getInvincibilityRemaining(): number {
    return this.invincibilityRemaining;
  }

  /**
   * True while the fighter is in HELPLESS free-fall after a committal
   * aerial special — cannot attack / special / jump until it lands.
   */
  isHelpless(): boolean {
    return this.helpless;
  }

  /** True while the fighter is in TUMBLE (hard-launched; can tech on contact). */
  isTumbling(): boolean {
    return this.tumbling;
  }

  /** True while the fighter is in a KNOCKDOWN (prone, vulnerable, input-locked). */
  isKnockedDown(): boolean {
    return this.knockdownRemaining > 0;
  }

  /** True while a directional tech-roll / get-up-roll is sliding (intangible). */
  isGetupRolling(): boolean {
    return this.getupRollRemaining > 0;
  }

  /** True while a mistimed tech is locked out (a re-press can't tech). */
  isTechLockedOut(): boolean {
    return this.techLockoutRemaining > 0;
  }

  /**
   * Consume the one-shot down-special dive LANDING event (render-only).
   * Returns the world-space landing point + facing exactly once per dive
   * touchdown, then `null` until the next landing. The render layer polls
   * this each frame to flash a landing shockwave burst (the sim-side
   * damage hitbox already fired separately). Returning it here and
   * clearing keeps the signal one-shot without the sim ever reading it.
   */
  consumeDiveLandingEvent(): { x: number; y: number; facing: 1 | -1 } | null {
    const e = this.diveLandingEvent;
    this.diveLandingEvent = null;
    return e;
  }

  /**
   * True iff the fighter is currently immune to incoming hits. The
   * runtime composes the two independent i-frame sources via OR:
   *
   *   • `invincibilityRemaining > 0` — respawn-grace timer set on
   *     stock loss (Sub-AC 4.2 of AC 302).
   *   • `dodgeState.iframesRemaining > 0` — dodge / roll i-frame
   *     window from the active phase of an in-flight dodge
   *     (AC 60302 Sub-AC 2).
   *
   * Either source short-circuits `applyHit` to a zero-knockback /
   * zero-hitstun result. The dodge i-frame window only spans the
   * `'active'` phase — recovery has `iframesRemaining === 0` so the
   * punish-window half of the dodge contract still lets hits through.
   */
  isInvincible(): boolean {
    return (
      this.invincibilityRemaining > 0 ||
      isDodgeInvincible(this.dodgeState) ||
      // AC 60403 Sub-AC 3 — the hang's i-frame window is the third
      // independent invulnerability source the runtime composes via OR.
      // Drains over the hang's `hangIframeFrames`; outside the window
      // the fighter is hit-able while still locked to the ledge — an
      // opponent reading the hang can punish a stalling player.
      isLedgeHangInvincible(this.ledgeHangState)
    );
  }

  /**
   * Set / replace the invincibility timer (Sub-AC 4.2).
   *
   * Used by the respawn flow ("90 frames of grace after re-entering
   * the stage") and tests / debug HUD ("force invincibility on for
   * the next 60 frames"). Calling with `0` clears any pending grace.
   *
   * Negative values are treated as 0 — the contract is "frames remaining,
   * non-negative" so the rest of the engine can read this without
   * having to clamp.
   */
  setInvincibility(frames: number): void {
    this.invincibilityRemaining = Math.max(0, Math.floor(frames));
  }

  /**
   * Apply an incoming hit to this fighter.
   *
   * Steps (deterministic, in this exact order):
   *   1. Add the move's damage to the percent meter (clamped at MAX).
   *   2. Compute the realised knockback vector from the *new* percent
   *      and the fighter's mass — this matches Smash's "hit damage
   *      counts toward its own knockback scaling" semantics, so a
   *      finisher at high percent reads stronger because it pushed the
   *      target deeper into kill range with its own damage value.
   *   3. Cancel any in-flight attack — getting hit interrupts the move.
   *   4. Reset cooldown to 0 — the lost-in-recovery cooldown shouldn't
   *      stack on top of the hitstun lockout.
   *   5. Override the body's velocity with the knockback vector. We
   *      replace (not add) so successive hits stack predictably — the
   *      newest knockback wins, like the canonical fighting-game rule.
   *   6. Set the hitstun timer.
   *
   * Returns the realised knockback / hitstun for tests, AI, and the
   * (later AC) HUD that displays hit feedback.
   *
   * Idempotent for `destroyed` fighters — they ignore the hit.
   */
  applyHit(hit: HitInfo): KnockbackResult {
    if (this.destroyed) {
      return {
        vector: { x: 0, y: 0 },
        magnitude: 0,
        // No launch ⇒ no meaningful angle. Sub-AC 2 of AC 6: callers that
        // care about direction should also check `magnitude > 0` to detect
        // the no-launch case (atan2(0,0) is 0, which would otherwise read
        // as "launched right" if consumed naively).
        angle: 0,
        hitstunFrames: 0,
      };
    }

    // Counter PARRY (neutral Wolf/Aegis, down Bear): while a counter
    // move's parry window is open, the incoming hit is ABSORBED — no
    // damage, knockback, or hitstun — and its damage is latched so the
    // next tick spawns a retaliation hitbox scaled by what was caught.
    // Checked FIRST so the parry beats the i-frame / shield paths below.
    if (this.activeAttack !== null) {
      const counter = this.resolveCounterSpec(this.activeAttack.move);
      if (counter !== null) {
        const f = this.activeAttack.framesElapsed;
        if (f >= counter.counterWindowStart && f < counter.counterWindowEnd) {
          this.pendingCounterRetaliation = { absorbedDamage: hit.damage };
          return { vector: { x: 0, y: 0 }, magnitude: 0, angle: 0, hitstunFrames: 0 };
        }
      }
    }

    // Sub-AC 4.2: respawn invincibility absorbs every hit. The fighter
    // takes no damage, no knockback, no hitstun. We deliberately do NOT
    // shorten the invincibility timer per absorbed hit — the grace
    // window is wall-clock fixed (decremented in `applyInput`) so a
    // crowd of attackers can't burn it down with simultaneous pokes.
    if (this.invincibilityRemaining > 0) {
      return {
        vector: { x: 0, y: 0 },
        magnitude: 0,
        angle: 0,
        hitstunFrames: 0,
      };
    }

    // AC 60302 Sub-AC 2: the dodge i-frame window also absorbs every
    // hit. Like respawn grace, the dodge timer is wall-clock fixed
    // (decremented per fixed step inside `tickDodge`) so a crowd of
    // attackers can't burn it down with simultaneous pokes. Recovery-
    // phase dodge has `iframesRemaining === 0` so the punish-window
    // half of the dodge contract still lets hits through.
    if (isDodgeInvincible(this.dodgeState)) {
      return {
        vector: { x: 0, y: 0 },
        magnitude: 0,
        angle: 0,
        hitstunFrames: 0,
      };
    }

    // AC 60403 Sub-AC 3: the ledge-hang i-frame window absorbs hits
    // while the fighter is in the early "snap to ledge" grace window.
    // Mirrors the dodge / respawn-grace contract.
    if (isLedgeHangInvincible(this.ledgeHangState)) {
      return {
        vector: { x: 0, y: 0 },
        magnitude: 0,
        angle: 0,
        hitstunFrames: 0,
      };
    }

    // AC 60403 Sub-AC 3 — if the fighter is hanging on a ledge but the
    // i-frame window has closed, an incoming hit lands normally AND
    // signals a force-release on the next applyInput tick. The state
    // machine drops the hang into the post-release cooldown, the
    // knockback vector replaces the body velocity (computed below),
    // and the fighter is launched off the ledge — the canonical
    // "punish a stalling ledge-hog" outcome.
    if (
      this.ledgeHangState.name === 'hanging' ||
      this.ledgeHangState.name === 'climbing' ||
      // AC 60404 Sub-AC 4 — same treatment for the ledge-roll recovery
      // state. A hit through the roll's i-frame window force-releases
      // the recovery so the fighter takes knockback cleanly off the
      // platform rather than staying frozen mid-roll.
      this.ledgeHangState.name === 'rolling'
    ) {
      this.pendingLedgeForceRelease = true;
    }

    // AC 60301 Sub-AC 1 — if the shield is raised, the hit drains
    // shield health instead of damage % / knockback / hitstun. A hit
    // that drains the last HP breaks the shield: the state machine
    // arms the break-stun on its own, and the rest of `applyHit`
    // returns the zero-result the caller expects for an absorbed hit.
    // The break-stun lockout is enforced by the `applyInput` early-
    // return path that fires while `isShieldBroken(this.shieldState)`
    // is true.
    if (isShieldRaised(this.shieldState) && !hit.unblockable) {
      // Pass how long the shield has been up so a hit caught in the raise
      // window powershields — no HP cost, no shieldstun, instant punish.
      const r = applyShieldHit(
        this.shieldState,
        hit.damage,
        this.tuning.shield,
        this.shieldActiveFrames,
      );
      this.shieldState = r.state;
      // AC 10304 — voice the shatter cue when this hit is the one that
      // BROKE the shield (raised → broken edge), distinct from the
      // shield-raise hum. The `applyShieldHit` result carries the new
      // state; comparing against the pre-hit "raised" guard above means
      // we only fire on the breaking hit, not on every chip that drains
      // a bit of shield health. Audio-only side effect — the break-stun
      // lockout itself is driven by the state machine, untouched here.
      if (isShieldBroken(r.state)) {
        emitCombatSfx(this.sfxSink ?? undefined, ASSET_KEYS.sfxShieldBreak);
      } else if (r.perfect) {
        // A perfect shield rings the raise cue again as its "ting".
        emitCombatSfx(this.sfxSink ?? undefined, ASSET_KEYS.sfxShield);
      }
      return {
        vector: { x: 0, y: 0 },
        magnitude: 0,
        angle: 0,
        hitstunFrames: 0,
      };
    }

    // Getting hit while GRABBING a victim BREAKS the grab (Smash: interrupt
    // the grabber and the held opponent goes free). Fires only on a hit
    // that actually lands — the i-frame / shield absorbs above already
    // returned, and a fighter can't be grabbing while shielding.
    if (this.grabTarget !== null && this.grabSpec !== null) {
      this.grabTarget.releaseFromGrab();
      this.grabTarget = null;
      this.grabState = applyGrabBreak(this.grabState, this.grabSpec);
    }
    // A fresh hit re-launches a prone / tumbling / rolling fighter — clear
    // the floor-loop lockouts so the new knockback takes over (tumble is
    // re-set when this hit's launch is applied).
    this.knockdownRemaining = 0;
    this.tumbling = false;
    this.getupRollRemaining = 0;
    this.techBufferRemaining = 0;
    this.techLockoutRemaining = 0;

    // 1. Damage accumulation. Capture pre-hit percent for the
    //    high-% hitlag bonus so a 149% target hit by a heavy crosses
    //    into "high-% crunch" exactly when the bonus formula expects.
    const percentBeforeHit = this.damagePercent;
    this.damagePercent = accumulateDamage(this.damagePercent, hit.damage);

    // 2. Knockback math — at the *new* percent, scaled by the
    //    fighter's current mass so heavy targets resist.
    const rawResult = computeKnockback(hit, this.damagePercent, this.tuning.mass);
    // CROUCH-CANCEL — a grounded crouching victim eats a softened launch.
    // Gated on grounded too so a (defensively) stale crouch can never hand
    // an airborne / juggled fighter the reduction.
    const crouchCancel =
      this.isGrounded() && isCrouching(this.locomotionState)
        ? CROUCH_KNOCKBACK_REDUCTION
        : 1;
    const result: KnockbackResult =
      crouchCancel === 1
        ? rawResult
        : {
            vector: {
              x: rawResult.vector.x * crouchCancel,
              y: rawResult.vector.y * crouchCancel,
            },
            magnitude: rawResult.magnitude * crouchCancel,
            angle: rawResult.angle,
            hitstunFrames: rawResult.hitstunFrames,
          };

    // 3. Hitlag freeze frames (post-M2 hit-feel pass). Both fighters
    //    visually pause at the moment of impact for `hitlagFrames` —
    //    the knockback velocity and hitstun lockout don't actually
    //    fire until the freeze ends (handled in `applyInput`'s
    //    hitlag drain path). Sweet-spot hits get the +4 frame bonus.
    const hitlagFrames = computeHitlag({
      damage: hit.damage,
      targetPercent: percentBeforeHit,
      sweetSpot: hit.sweetSpot === true,
    });

    // 4 + 5. Interrupt attack + clear cooldown.
    this.cancelAttack();
    this.cooldownRemaining = 0;

    // 6. Pin velocity at zero so the body doesn't drift during freeze.
    //    setVelocity (vs. mutating .velocity) keeps Matter's
    //    previous-position cache coherent so freeze-end integration
    //    is stable.
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });

    // 7. Queue the knockback + hitstun behind the hitlag window. They
    //    fire on the frame `hitlagRemaining` drains to zero; see the
    //    hitlag-drain path at the top of `applyInput`.
    this.hitlagRemaining = hitlagFrames;
    this.pendingKnockback = {
      vector: { x: result.vector.x, y: result.vector.y },
      hitstunFrames: result.hitstunFrames,
    };
    // Fresh SDI budget for this freeze (no carry-over from a prior hit).
    this.sdiSpentPx = 0;
    this.sdiPrevBeyond = false;
    // Fall-shaping latches die the moment a hit lands: the queued
    // launch owns the velocity, and a surviving fast-fall latch (or
    // armed jump-cut) would corrupt the knockback arc when hitstun
    // ends. Cleared HERE (the single entry point every knockback path
    // funnels through) rather than in the per-frame shaping block,
    // whose hitstun branch never runs during the hitlag freeze.
    this.fastFallLatched = false;
    this.jumpCutArmed = false;
    // Getting hit MID-CHARGE drops the charge — including any bank it was
    // resumed from (Smash idiom: an interrupted active charge is lost).
    // A merely-HELD bank (not actively charging) SURVIVES the hit, which
    // is the authentic Samus behaviour. The two states are mutually
    // exclusive, so wiping the bank only when actively charging is exact.
    if (this.chargingSpecial !== null) {
      this.storedSpecialCharge = null;
    }
    this.chargingSpecial = null;
    // Getting hit mid-smash-charge drops it too (no banking for smashes).
    this.chargingSmash = null;
    // A launched fighter is no longer doing GROUND locomotion: park the
    // machine at standing (the crouch-cancel above already consumed the
    // pre-hit posture). Without this the stale state survives the hitstun
    // early-returns (which skip the loco tick) and the first free frame
    // out of hitstun mis-reads a held direction as a PIVOT skid — and a
    // stale `crouch` would even grant airborne crouch-cancel + a shrunk
    // hurtbox to a juggled fighter.
    this.locomotionState = resetLocomotionState(this.facing);
    this.prevLocoMoveX = 0;

    return result;
  }

  // -------------------------------------------------------------------------
  // State queries
  // -------------------------------------------------------------------------

  /**
   * True iff a platform body is supporting us. Driven by collision
   * events; updates between fixed steps but is safe to read at any
   * point during the step.
   */
  isGrounded(): boolean {
    return this.groundContacts > 0;
  }

  /** Live world-space position (Matter centre of mass). */
  getPosition(): { x: number; y: number } {
    return { x: this.body.position.x, y: this.body.position.y };
  }

  /** Live velocity in Matter px-per-step units. */
  getVelocity(): { x: number; y: number } {
    return { x: this.body.velocity.x, y: this.body.velocity.y };
  }

  /** Last input-driven facing direction. 1 = right, -1 = left. */
  getFacing(): 1 | -1 {
    return this.facing;
  }

  /** Number of jumps consumed since the last landing. */
  getJumpsUsed(): number {
    return this.jumpsUsed;
  }

  /** Air-jumps still available before landing again. */
  getJumpsRemaining(): number {
    return Math.max(0, this.tuning.maxJumps - this.jumpsUsed);
  }

  /** Read-only view of the active tuning record. */
  getTuning(): Required<CharacterTuning> {
    // `locomotion` is resolved into `resolvedLocomotionTuning` (it needs
    // `maxRunSpeed`) and stays optional on `tuning`; the public view fills
    // every other field, and no caller reads `.locomotion` from here.
    return { ...this.tuning } as Required<CharacterTuning>;
  }

  // -------------------------------------------------------------------------
  // Hurtbox queries (Sub-AC 2 of AC 10002)
  //
  // Every fighter ships with a single body-sized default hurtbox derived
  // from the active `tuning.width / tuning.height`. While a move is in
  // flight, any per-move `hurtboxModifiers` declared on the move data
  // layer over the body default for the frames their phase window covers
  // — used by dodge i-frames, super-armour windups, and crouching tilts.
  //
  // The runtime resolution is delegated to {@link selectActiveHurtboxes}
  // so the schema-side helper, the damage handler, and any AI predictor
  // ("if I throw a tilt now, will the opponent's smash trade with my body
  // or with my windup hurtbox?") share one source of truth.
  // -------------------------------------------------------------------------

  /**
   * Body-default hurtbox derived from the active tuning width / height.
   *
   * Re-derived on every call (rather than cached) so a `setTuning` swap
   * — used by tests, the (later AC) move-editor authoring UI, and the
   * balance-pass tooling — reflects in the hurtbox set immediately. The
   * cost is a single object allocation per call; callers that need to
   * read the body hurtbox in a hot loop can stash the result themselves.
   *
   * Determinism: a pure projection of `tuning.width / tuning.height`.
   * Two replays driving identical tuning produce identical body
   * hurtboxes every frame.
   */
  getBodyHurtbox(): Hurtbox {
    return makeBodyHurtbox(this.tuning);
  }

  /**
   * Live hurtbox set for this fighter at the current frame. Composes
   * the body default with any per-move hurtbox modifiers active for
   * the in-flight attack's current phase.
   *
   * Returns an array (not a `Set`) because:
   *
   *   • Authoring order matters for debug overlays / replay logs ("did
   *     Cat's smash trade with Wolf's body or his windup hurtbox?").
   *     A `Set` would lose the ordering.
   *   • The damage handler's contract is "iterate the active set once
   *     per incoming hit" — array iteration is cheaper and simpler.
   *
   * Every element is frozen at construction (the body default uses
   * `Object.freeze` via `makeBodyHurtbox`; modifier hurtboxes are
   * authored at module load and never mutated). Callers must not
   * mutate the returned array elements.
   *
   * Determinism: a pure projection of (tuning, active attack frame
   * counter, move data). Identical inputs always return an identical
   * set — the property the replay system requires to keep hurtbox
   * decisions byte-stable across snapshot resyncs.
   */
  /**
   * The base body hurtbox for the fighter's current POSTURE — the
   * crouch-lowered (shorter, bottom-anchored) box while crouching, else the
   * full body. Applied whether idle OR mid-attack, so a crouch attack
   * (down-tilt / down-smash) keeps the ducked profile instead of popping
   * the hurtbox back to full height the instant you poke.
   */
  private postureBodyHurtbox(): Hurtbox {
    const body = this.getBodyHurtbox();
    // Grounded too — a stale crouch must never duck an airborne fighter.
    if (!this.isGrounded() || !isCrouching(this.locomotionState)) return body;
    const h = body.height * CROUCH_HURTBOX_HEIGHT_FRACTION;
    return Object.freeze({
      id: 'body.crouch',
      offsetX: 0,
      // Keep the feet planted: shift the centre down by half the height
      // removed, so the bottom edge stays put and the top (head) drops.
      offsetY: (body.height - h) / 2,
      width: body.width,
      height: h,
    });
  }

  getActiveHurtboxes(): ReadonlyArray<Hurtbox> {
    const body = this.postureBodyHurtbox();
    if (!this.activeAttack) return [body];
    // The attack's `move` is typed `AttackMove`; per-move hurtbox
    // modifiers live on the `AttackMoveWithAnimation` extension. We
    // upcast deliberately — every move registered in the M2 roster is
    // declared as `AttackMoveWithAnimation`-compatible (modifiers
    // optional). A move authored as a bare `AttackMove` (legacy /
    // test fixture) carries no `hurtboxModifiers` field and resolves
    // to the body default by the helper's empty-modifier short-circuit.
    // The base it layers over already reflects the crouch posture.
    const move = this.activeAttack.move as AttackMoveWithAnimation;
    return selectActiveHurtboxes(body, move, this.activeAttack.framesElapsed);
  }

  // -------------------------------------------------------------------------
  // Shield queries / mutators (AC 60301 Sub-AC 1)
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the current shield state. Replay snapshots
   * persist this verbatim so a scrub seek can restore the shield bar
   * along with the rest of the fighter's runtime state.
   */
  getShieldState(): ShieldState {
    return this.shieldState;
  }

  /** Current shield health in shield-HP units. 0 while broken. */
  getShieldHealth(): number {
    return this.shieldState.health;
  }

  /** True iff the shield is currently raised (active). */
  isShielding(): boolean {
    return isShieldRaised(this.shieldState);
  }

  /** True iff the shield is currently in shield-break stun. */
  isShieldBroken(): boolean {
    return isShieldBroken(this.shieldState);
  }

  /**
   * Frames remaining in the shield-break stun lockout. 0 when not in
   * the broken state. Mirrors {@link getHitstunRemaining} — drain
   * happens once per fixed step inside `applyInput`.
   */
  getShieldStunRemaining(): number {
    return this.shieldState.name === 'broken' ? this.shieldState.stunRemaining : 0;
  }

  /**
   * Replace the live shield state. Used by the replay snapshot system
   * (rewind to frame N's recorded shield state) and tests; gameplay
   * code should drive the shield via `applyInput({ shield: true })`
   * and `applyHit(...)` instead.
   */
  setShieldState(state: ShieldState): void {
    if (this.destroyed) return;
    this.shieldState = state;
  }

  // -------------------------------------------------------------------------
  // Dodge queries / mutators (AC 60302 Sub-AC 2)
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the current dodge state. Replay snapshots
   * persist this verbatim so a scrub seek can restore the dodge phase
   * (active / recovery / cooldown) along with the rest of the
   * fighter's runtime state.
   */
  getDodgeState(): DodgeState {
    return this.dodgeState;
  }

  /** Read-only snapshot of the live ground-locomotion state (Tier 5). */
  getLocomotionState(): LocomotionState {
    return this.locomotionState;
  }

  /** Current locomotion phase name (standing / walk / initialDash / run / pivot / crouch). */
  getLocomotionStateName(): LocomotionState['name'] {
    return this.locomotionState.name;
  }

  /** True iff the fighter is crouching (stick held down, grounded, no lateral intent). */
  isCrouching(): boolean {
    return isCrouching(this.locomotionState);
  }

  /** True iff the fighter is dashing on the ground (initial-dash burst OR sustained run). */
  isDashing(): boolean {
    return isLocomotionDashing(this.locomotionState);
  }

  /**
   * True iff the fighter is currently mid-dodge (active OR recovery
   * phase). Movement / attacks / shield are suppressed for the entire
   * window. AI scripts and the HUD's "dodge" indicator both read this.
   */
  isDodging(): boolean {
    return isDodgeActing(this.dodgeState);
  }

  /**
   * True iff the dodge cooldown is currently locking out new dodge
   * presses. Movement and attacks are free during this phase, but a
   * fresh dodge press is dropped — same contract as the post-cooldown
   * lockout the attack state machine uses.
   */
  isDodgeOnCooldown(): boolean {
    return isDodgeOnCooldown(this.dodgeState);
  }

  /**
   * True iff the dodge i-frame window is currently open. Distinct
   * from {@link isDodging}: the recovery phase still satisfies
   * `isDodging() === true` but `isDodgeInvincible() === false`.
   *
   * The (later AC) renderer can use this to flash the fighter's
   * sprite during the i-frame window without flashing through the
   * recovery tail.
   */
  isDodgeInvincible(): boolean {
    return isDodgeInvincible(this.dodgeState);
  }

  /**
   * Frames of dodge i-frames remaining (0 outside the active phase).
   * Mirrors {@link getInvincibilityRemaining} for the dodge timer
   * specifically — the HUD's "i-frame ticker" overlay reads this so
   * it can render a per-source breakdown ("3 dodge i-frames left vs.
   * 12 respawn-grace frames left").
   */
  getDodgeIframesRemaining(): number {
    return this.dodgeState.iframesRemaining;
  }

  /**
   * Frames of dodge cooldown remaining (0 outside the cooldown
   * phase). Useful for AI scripts that want to know "can I dodge
   * again?" without re-deriving from the public state.
   */
  getDodgeCooldownRemaining(): number {
    return this.dodgeState.cooldownRemaining;
  }

  /**
   * Replace the live dodge state. Used by the replay snapshot system
   * (rewind to frame N's recorded dodge phase) and tests; gameplay
   * code should drive the dodge via `applyInput({ dodge: true, ... })`
   * instead.
   */
  setDodgeState(state: DodgeState): void {
    if (this.destroyed) return;
    this.dodgeState = state;
  }

  // -------------------------------------------------------------------------
  // Ledge-hang queries / mutators (AC 60403 Sub-AC 3)
  // -------------------------------------------------------------------------

  /**
   * Read-only snapshot of the current ledge-hang state. Replay snapshots
   * persist this verbatim so a scrub seek can restore which ledge the
   * fighter is hanging on (and how many frames into the climb / cooldown
   * they are) along with the rest of the fighter's runtime state.
   */
  getLedgeHangState(): LedgeHangState {
    return this.ledgeHangState;
  }

  /**
   * Replace the live ledge-hang state. Used by the replay snapshot
   * system (rewind to frame N's recorded hang) and tests; gameplay code
   * should drive the ledge state via `applyInput` + `setLedgeCandidates`
   * instead.
   */
  setLedgeHangState(state: LedgeHangState): void {
    if (this.destroyed) return;
    this.ledgeHangState = state;
  }

  /** True iff the fighter is currently hanging on a ledge corner. */
  isHangingOnLedge(): boolean {
    return this.ledgeHangState.name === 'hanging';
  }

  /**
   * Stable key of the ledge this fighter is currently hanging on, or null if
   * not hanging. The scene uses it to detect ledge-occupancy conflicts (trump).
   */
  getHangingLedgeKey(): string | null {
    const c = this.ledgeHangState.active?.candidate;
    return this.ledgeHangState.name === 'hanging' && c
      ? `${c.platformId}:${c.side}`
      : null;
  }

  /**
   * Ledge-TRUMP: this fighter was bumped off the ledge by an opponent who just
   * grabbed it. Force-release the hang next tick (the built-in `forceRelease`
   * path, same as a hit-while-hanging) and shove the fighter slightly off-stage
   * + down, so the trump steals the ledge and leaves the prior occupant having
   * to recover again — the Ultimate ledge-occupancy rule. No-op if not hanging.
   * Knock-off magnitudes are PLACEHOLDER tuning.
   */
  trumpOffLedge(): void {
    if (this.ledgeHangState.name !== 'hanging') return;
    this.pendingLedgeForceRelease = true;
    // A hanging fighter faces INTO the stage, so off-stage = -facing.
    const away = -this.facing;
    this.scene.matter.body.setVelocity(this.body, {
      x: away * LEDGE_TRUMP_KNOCKOFF_VX,
      y: LEDGE_TRUMP_KNOCKOFF_VY,
    });
  }

  /**
   * True iff the fighter's get-up climb animation is currently playing.
   * The fighter is locked out of input but does NOT have i-frames during
   * this window — opponents can intercept the climb-up.
   */
  isClimbingFromLedge(): boolean {
    return this.ledgeHangState.name === 'climbing';
  }

  /** Frames of ledge-hang i-frames remaining. 0 outside the hang's grace window. */
  getLedgeHangIframesRemaining(): number {
    return this.ledgeHangState.hangIframesRemaining;
  }

  /**
   * Frames of post-release re-grab cooldown remaining (the "tether"
   * timing that prevents infinite hang/release loops). 0 outside the
   * cooldown phase.
   */
  getLedgeTetherCooldownRemaining(): number {
    return this.ledgeHangState.cooldownRemaining;
  }

  /**
   * Derive a ledge-release action from the raw input while hanging — the
   * human-input path (AI sets `input.ledgeRelease` explicitly; a human
   * holds a stick / taps a button). A hanging fighter faces the stage, so
   * the stick toward `facing` rolls up and away drops off.
   *   • jump press → jump off the ledge
   *   • attack press → ledge-attack
   *   • up-stick → climb (getUp)
   *   • down-stick / stick away from the stage → drop off
   *   • stick toward the stage → roll up
   */
  private deriveLedgeReleaseFromInput(
    input: CharacterInput,
  ): LedgeReleaseAction | null {
    if (this.ledgeHangState.name !== 'hanging') return null;
    if (input.jump === true && !this.prevJumpHeld) return 'jump';
    if (input.attack === true && !this.prevAttackHeld) return 'attack';
    const moveY = input.moveY ?? 0;
    const moveX = input.moveX ?? 0;
    if (moveY <= -0.5) return 'getUp';
    // NOTE: ledge release uses a HIGHER threshold (0.5) than the 0.3 used for
    // attacks/dodges — a DELIBERATE deadzone so a small stick tilt can't
    // accidentally release you off the ledge (that = death). Do not lower to
    // 0.3 "for consistency"; a regression test locks this intent.
    if (moveY >= 0.5) return 'dropDown';
    if (Math.abs(moveX) >= 0.5) {
      return Math.sign(moveX) === this.facing ? 'roll' : 'dropDown';
    }
    return null;
  }

  /**
   * Replace the live ledge candidate list the runtime feeds in for
   * geometric detection. Called by the match scene each frame the stage
   * geometry is finalised — for static stages this fires once at match
   * start and is then stable; for stages with moving platforms (a future
   * sub-AC will also support drop-through filtering at runtime) the
   * scene re-emits the candidate list whenever a ledge corner shifts.
   *
   * Pass an empty array to disable ledge detection for this fighter
   * (the canonical "no edge-grabbable ledges" state — useful in tests
   * that want to isolate other systems from the ledge mechanic).
   */
  setLedgeCandidates(candidates: ReadonlyArray<LedgeCandidate>): void {
    this.ledgeCandidates = candidates;
  }

  /**
   * Read-only view of the candidate list the runtime is currently
   * feeding into the detection pass. Useful for tests that want to
   * verify the wiring without re-deriving the list from stage geometry.
   */
  getLedgeCandidates(): ReadonlyArray<LedgeCandidate> {
    return this.ledgeCandidates;
  }

  /**
   * Geometric ledge-grab detection for the current frame. Pure read of
   * `(body bounds × candidate list × tuning)` — the per-step `applyInput`
   * call routes the result into the state machine. Exposed publicly so
   * AI predictors and tests can ask "is the fighter currently overlapping
   * a grabbable ledge?" without driving a full tick.
   */
  computeLedgeDetection(): LedgeGrabDetection | null {
    if (this.destroyed) return null;
    if (this.ledgeCandidates.length === 0) return null;
    const bounds: FighterBounds = {
      centerX: this.body.position.x,
      centerY: this.body.position.y,
      halfWidth: this.tuning.width / 2,
      halfHeight: this.tuning.height / 2,
      velocityY: this.body.velocity.y,
      facing: this.facing,
    };
    return detectLedgeGrab(
      bounds,
      this.ledgeCandidates,
      this.tuning.ledgeDetection,
    );
  }

  /**
   * Apply the per-action physics for a ledge release. Pure with respect
   * to its inputs except for the body's Matter velocity (which it sets
   * via `setVelocity` for jump / drop, or position for the drop-down
   * clearance). The `'getUp'` and `'roll'` actions do NOT translate here
   * — their respective recovery animations play first, and the post-
   * recovery translation lands in `applyInput` after the recovery
   * completes.
   *
   * AC 60404 Sub-AC 4 — `'roll'` joins `'getUp'` as a recovery-driven
   * option: the body is held at the latch point during the roll's
   * recovery state, then translated inward by `rollDistance` once the
   * `'rolling'` state expires.
   */
  private applyLedgeReleasePhysics(action: LedgeReleaseAction): void {
    if (action === 'jump') {
      // Release into a standard jump impulse, refreshing the air-jump
      // budget so the fighter can still air-jump after the ledge-jump.
      this.scene.matter.body.setVelocity(this.body, {
        x: 0,
        y: -this.tuning.jumpImpulse,
      });
      this.jumpsUsed = 0;
    } else if (action === 'dropDown') {
      // Drop-down releases the fighter cleanly with a small downward
      // clearance so they don't immediately re-grab the same corner
      // (the cooldown also enforces this, but the clearance gives a
      // visually distinct separation).
      const clearance = this.tuning.ledge.dropDownClearance;
      this.scene.matter.body.setPosition(this.body, {
        x: this.body.position.x,
        y: this.body.position.y + clearance,
      });
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    } else if (action === 'attack') {
      // Ledge-attack: climb back on with a small inward nudge AND a real
      // edge-clearing hitbox covering the ledge corner up onto the stage —
      // an opponent edge-guarding the spot gets swatted away. The ledge state
      // machine grants the attack-release intangibility (`attackIframes`); we
      // own the move here. Mirrors `startGetupAttack`. (Placeholder tuning —
      // see LEDGE_ATTACK_*; per-character authoring is a follow-up.)
      const inward =
        this.facing === 1 ? this.tuning.maxRunSpeed * 0.5 : -this.tuning.maxRunSpeed * 0.5;
      this.scene.matter.body.setVelocity(this.body, { x: inward, y: 0 });
      const p = this.ledgeAttackParams();
      const ledgeAttackMove = {
        id: `${this.id}.ledgeAttack`,
        type: 'tilt',
        damage: p.damage,
        knockback: p.knockback,
        // Forward swing (offsetX mirrored by facing → into the stage) covering
        // the ledge corner and a bit onstage.
        hitbox: p.hitbox,
        startupFrames: 0,
        activeFrames: p.activeFrames,
        recoveryFrames: 0,
        cooldownFrames: 0,
      } as unknown as AttackMove;
      const body = spawnHitbox(
        this.scene as unknown as HitboxScene,
        { id: this.id, position: this.body.position, bodyId: this.body.id },
        ledgeAttackMove,
        this.facing,
      );
      this.transientHitboxes.push({ body, framesRemaining: p.activeFrames });
    }
    // 'getUp' — handled by the climb animation; no impulse here.
    // 'roll'  — handled by the rolling state's freeze + post-recovery
    //           translation; no impulse here.
  }

  // -------------------------------------------------------------------------
  // Mutators (used by respawn, replay seek, M2 roster overrides)
  // -------------------------------------------------------------------------

  /**
   * Teleport the body and reset transient movement state. Used by the
   * (later AC) respawn flow and replay snapshot resync.
   */
  setPosition(x: number, y: number): void {
    if (this.destroyed) return;
    this.scene.matter.body.setPosition(this.body, { x, y });
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    this.jumpsUsed = 0;
    this.prevJumpHeld = false;
    this.prevAttackHeld = false;
    this.prevHeavyHeld = false;
    this.prevShieldHeld = false;
    this.prevDodgeHeld = false;
    // AC 60101 Sub-AC 1 — reset the raw-stick latch on teleport so a
    // respawn / replay seek doesn't leak the pre-teleport stick state
    // into the next press's smash-flick classification.
    this.prevMoveX = 0;
    this.prevMoveY = 0;
    this.recentMoveY = [];
    this.groundContacts = 0;
    this.platformFallSupported = false;
    this.tapJumpBufferFrames = 0;
    this.airDodgeUsed = false;
    this.airDodgeBurst = null;
    // AC 60102 Sub-AC 2 — clear the prev-grounded latch on teleport.
    // A respawn drops the fighter into the air; the next applyInput
    // must NOT mistake the spawn frame for "just landed" and trigger a
    // spurious aerial-interrupt path. Setting this to false matches
    // the post-teleport `groundContacts = 0` reset above.
    this.prevGrounded = false;
    // Cancel any in-flight attack — a teleport (respawn / replay seek)
    // must not leave a stale hitbox in the world or freeze the
    // fighter mid-recovery.
    this.cancelAttack();
    this.cooldownRemaining = 0;
    // Hitstun is transient combat state — clear it on teleport so a
    // respawn doesn't leave the fighter inert for the first half-second
    // after re-entering the stage. Damage percent is part of match
    // state (not transient), so it deliberately persists; respawn
    // calls `setDamagePercent(0)` explicitly when a stock is consumed.
    this.hitstunRemaining = 0;
    // Hitlag freeze + queued knockback are also transient combat
    // state. Clear them on teleport so a fighter who was KO'd mid-
    // freeze doesn't respawn with a queued launch about to fire.
    this.hitlagRemaining = 0;
    this.pendingKnockback = null;
    // Fall-shaping latches are transient too — a respawn must not
    // inherit a fast-fall or an armed jump-cut from the previous stock.
    this.fastFallLatched = false;
    this.jumpCutArmed = false;
    // A stored special charge is transient combat state — drop it on
    // teleport/respawn so a fighter KO'd mid-charge doesn't reappear
    // holding the cannon. Both the live charge and any bank reset to zero
    // on a fresh stock (Samus: charge does not carry across stocks).
    this.chargingSpecial = null;
    this.storedSpecialCharge = null;
    this.chargingSmash = null;
    // A respawn drops a clean fighter — never inherit helpless free-fall,
    // tumble, or a knockdown lockout from the stock that just ended.
    this.helpless = false;
    this.tumbling = false;
    this.techBufferRemaining = 0;
    this.techLockoutRemaining = 0;
    this.knockdownRemaining = 0;
    this.getupRollRemaining = 0;
    // AC 60301 Sub-AC 1 — shield state is transient too. Reset to a
    // fresh idle / full-HP shield on respawn so a fighter who lost a
    // stock mid-shatter doesn't reappear pre-broken.
    this.shieldState = resetShieldState(this.tuning.shield);
    this.shieldActiveFrames = 0;
    // Stale-move history is per-life — a fresh stock fights with every
    // move fully un-staled.
    this.staleMoveQueue = [];
    // AC 60302 Sub-AC 2 — dodge state is transient as well. A fighter
    // who lost a stock mid-roll shouldn't respawn carrying the rest of
    // the slide / recovery / cooldown. Reset to a fresh idle.
    this.dodgeState = resetDodgeState();
    // Tier 5 — locomotion is transient too: a respawned fighter starts
    // standing (not mid-run / mid-pivot), facing the freshly-set facing.
    this.locomotionState = resetLocomotionState(this.facing);
    this.prevLocoMoveX = 0;
    // AC 60403 Sub-AC 3 — ledge-hang state is transient too. A fighter
    // who lost a stock mid-hang (a hit through the i-frame window
    // launched them off the ledge to KO) shouldn't respawn still
    // attached to the ledge corner. Reset to a fresh idle.
    this.ledgeHangState = resetLedgeHangState();
    this.pendingLedgeForceRelease = false;
    // Grab state is also transient. A fighter who was mid-grab when
    // they KO'd shouldn't respawn still latched to a target.
    if (this.grabHitboxBody !== null) {
      despawnHitbox(this.scene as unknown as HitboxScene, this.grabHitboxBody);
      this.grabHitboxBody = null;
    }
    if (this.grabTarget !== null) {
      this.grabTarget.releaseFromGrab();
      this.grabTarget = null;
    }
    if (this.grabbedBy !== null) {
      this.grabbedBy = null;
    }
    this.grabState = resetGrabState();
    this.prevGrabHeld = false;
    this.dashGrabActive = false;
    this.dashGrabEntryVx = 0;
  }

  /**
   * Replace tuning at runtime. Used by tests and the M2 roster.
   *
   * AC 60301 Sub-AC 1 — partial `shield` overrides merge over the
   * existing resolved record (rather than replacing it wholesale) so
   * a caller that only wants to bump `breakStunFrames` doesn't have to
   * re-supply the other shield fields.
   */
  setTuning(overrides: CharacterTuning): void {
    const stripped = stripUndefined(overrides);
    const nextShield: ResolvedShieldTuning =
      stripped.shield !== undefined
        ? resolveShieldTuning({ ...this.tuning.shield, ...stripped.shield })
        : this.tuning.shield;
    // AC 60302 Sub-AC 2 — same merge-then-resolve pattern for the
    // dodge slot so a partial override (e.g. just `roll.slideSpeed`)
    // re-uses the existing variant fields for unspecified slots.
    const nextDodge: ResolvedDodgeTuning =
      stripped.dodge !== undefined
        ? resolveDodgeTuning(mergeDodgeTuning(this.tuning.dodge, stripped.dodge))
        : this.tuning.dodge;
    // AC 60403 Sub-AC 3 — same merge-then-resolve pattern for the
    // ledge slot so a partial override (e.g. just `climbFrames`) re-uses
    // the existing fields for unspecified slots.
    const nextLedge: ResolvedLedgeHangTuning =
      stripped.ledge !== undefined
        ? resolveLedgeHangTuning({ ...this.tuning.ledge, ...stripped.ledge })
        : this.tuning.ledge;
    const nextLedgeDetection: LedgeDetectionTuning =
      stripped.ledgeDetection !== undefined
        ? { ...this.tuning.ledgeDetection, ...stripped.ledgeDetection }
        : this.tuning.ledgeDetection;
    // `shield`, `dodge`, `ledge`, and `ledgeDetection` are handled
    // separately above so they don't get clobbered by the spread. The
    // cast keeps the fields omitted from the intermediate type without
    // changing the rest of the tuning.
    const {
      shield: _ignoredShield,
      dodge: _ignoredDodge,
      ledge: _ignoredLedge,
      ledgeDetection: _ignoredLedgeDetection,
      ...rest
    } = stripped;
    void _ignoredShield;
    void _ignoredDodge;
    void _ignoredLedge;
    void _ignoredLedgeDetection;
    this.tuning = {
      ...this.tuning,
      ...(rest as Partial<Required<CharacterTuning>>),
      shield: nextShield,
      dodge: nextDodge,
      ledge: nextLedge,
      ledgeDetection: nextLedgeDetection,
    };
  }

  /**
   * Force the facing direction. Useful for spawn placement (face
   * inward) and the (later AC) automatic facing-toward-target during
   * grabs.
   */
  setFacing(facing: 1 | -1): void {
    this.facing = facing;
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  /** Detach listeners and remove the Matter body. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    // Tear down any live hitbox first so we don't leak a sensor body.
    if (this.activeAttack && this.activeAttack.hitboxBody) {
      despawnHitbox(this.scene as unknown as HitboxScene, this.activeAttack.hitboxBody);
    }
    this.activeAttack = null;
    // Transient hitboxes (dive shockwaves) are sensors in the world too.
    this.clearTransientHitboxes();
    // Guard every matter.world access — by SHUTDOWN time the scene's
    // Matter plugin may already be torn down (the Phaser scene-stop
    // sequence destroys plugins before scene.destroy hooks fire). The
    // listeners are also auto-released when the world is gone, so the
    // off() calls are belt-and-braces cleanup, not load-bearing.
    const world = this.scene?.matter?.world ?? null;
    if (this.collisionStartListener) {
      world?.off('collisionstart', this.collisionStartListener);
      this.collisionStartListener = null;
    }
    if (this.collisionEndListener) {
      world?.off('collisionend', this.collisionEndListener);
      this.collisionEndListener = null;
    }
    world?.remove(this.body);
  }

  /**
   * Internal helper — abort the current attack, despawning any live
   * hitbox and clearing the active-attack record. Used by `setPosition`
   * (respawn) and tests; gameplay code should not need to call it.
   */
  private cancelAttack(): void {
    // Transient hitboxes (dive shockwaves) outlive the active attack, so
    // clear them here too — a respawn / teleport must not leave a stale
    // sensor in the world or a half-finished dive's latches set.
    this.clearTransientHitboxes();
    this.diveShockwaveSpawned = false;
    this.diveHoldFrames = 0;
    this.multiHitNextIndex = 0;
    this.pendingCounterRetaliation = null;
    if (!this.activeAttack) return;
    if (this.activeAttack.hitboxBody) {
      despawnHitbox(this.scene as unknown as HitboxScene, this.activeAttack.hitboxBody);
    }
    this.activeAttack = null;
  }

  // -------------------------------------------------------------------------
  // Internal — collision contact tracking
  // -------------------------------------------------------------------------

  /**
   * Returns true iff the pair represents a *support* contact for this
   * character — i.e. one of the bodies is `this.body`, the other is a
   * platform, and the platform's centre is below ours (so it's
   * physically possible for it to be the floor we're standing on).
   *
   * Why centre-Y not contact normal: the centre-comparison heuristic
   * reliably excludes wall bumps (centre-y ≈ ours) and ceiling thumps
   * (centre-y above ours) without us having to read the contact normal,
   * which Matter's typings expose inconsistently across pair-list
   * shapes. With a tall character (130 px) and our shortest platform
   * (24 px), the geometric margin is comfortable.
   */
  private isSupportPair(pair: SupportPair): boolean {
    let other: SupportPair['bodyA'];
    if (pair.bodyA === this.body) {
      other = pair.bodyB;
    } else if (pair.bodyB === this.body) {
      other = pair.bodyA;
    } else {
      return false;
    }
    if (!isPlatformLabel(other.label ?? null)) return false;
    return other.position.y > this.body.position.y;
  }

  private onCollisionStart(event: CollisionEventLike): void {
    if (this.destroyed) return;
    for (const pair of event.pairs) {
      if (this.isSupportPair(pair)) {
        this.groundContacts += 1;
      }
    }
  }

  private onCollisionEnd(event: CollisionEventLike): void {
    if (this.destroyed) return;
    for (const pair of event.pairs) {
      if (this.isSupportPair(pair)) {
        // Clamp to 0 so a duplicate end event (rare but possible across
        // Matter versions) can't push the counter negative.
        this.groundContacts = Math.max(0, this.groundContacts - 1);
      }
    }
  }

  /**
   * True iff the rapid double-tap-down drop-through window is currently
   * armed. The scene-level pass-through-platform driver reads this each
   * frame and sets the platform body masks accordingly via the
   * `togglePlatformCollision` helper. Wears off after a few frames
   * (decremented in `applyInput`).
   */
  isInDropThroughWindow(): boolean {
    return this.dropThroughFramesRemaining > 0;
  }

  /**
   * Bottom-of-body Y in world coords. Used by the scene-level pass-
   * through driver to decide if the character is above or below a
   * given platform's top edge. Falls back to the body's centre when
   * `bounds` isn't populated (very early in construction).
   */
  getBodyBottomY(): number {
    return this.body.bounds?.max?.y ?? this.body.position.y;
  }

  /**
   * Called by the scene's pass-through-platform driver on a frame it is
   * actively keeping this fighter resting on / landing onto a thin platform.
   * Suppresses the per-fighter `fallAccel` spike for the next `applyInput`
   * (see {@link platformFallSupported}) so a landing-contact flicker can't
   * ramp the fall speed back up and tunnel the body through the float. Pure
   * intent-signal: the flag is consumed each `applyInput`, so calling it has
   * no effect once the fighter leaves the platform's support.
   */
  markPlatformFallSupported(): void {
    this.platformFallSupported = true;
  }

  /** Left edge of the body's AABB in world coords. */
  getBodyLeftX(): number {
    return this.body.bounds?.min?.x ?? this.body.position.x;
  }

  /** Right edge of the body's AABB in world coords. */
  getBodyRightX(): number {
    return this.body.bounds?.max?.x ?? this.body.position.x;
  }
}

/**
 * Strip `undefined` values so they don't override defaults during a
 * spread merge. (Spreading `{ a: undefined }` over `{ a: 5 }` results
 * in `{ a: undefined }` — not what we want.)
 */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as Array<keyof T>) {
    const v = obj[key];
    if (v !== undefined) {
      out[key] = v;
    }
  }
  return out;
}

/**
 * AC 60302 Sub-AC 2 — merge a partial dodge tuning record over a fully-
 * resolved one. Each variant slot (`spot` / `roll` / `air`) is
 * independently merged so a caller that only supplies
 * `dodge: { roll: { slideSpeed: 12 } }` keeps the existing spot / air
 * tuning intact instead of falling back to {@link DODGE_DEFAULTS}.
 *
 * The result is fed straight back into {@link resolveDodgeTuning} so
 * any clamp / validation that would have run on a fresh resolve still
 * runs on the merged record.
 */
function mergeDodgeTuning(
  base: ResolvedDodgeTuning,
  overrides: DodgeTuning,
): DodgeTuning {
  return {
    spot: overrides.spot !== undefined ? { ...base.spot, ...overrides.spot } : base.spot,
    roll: overrides.roll !== undefined ? { ...base.roll, ...overrides.roll } : base.roll,
    air: overrides.air !== undefined ? { ...base.air, ...overrides.air } : base.air,
    stickThreshold: overrides.stickThreshold ?? base.stickThreshold,
  };
}
