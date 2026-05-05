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
  applyGrabConnect,
  createGrabState,
  resetGrabState,
  tickGrab,
  type GrabInput,
  type GrabState,
} from './grabState';
import { validateGrabSpec, type GrabSpec } from './grabSchema';
import { getThrowByDirection, type ThrowDirection } from './throwSchema';
import {
  classifyGroundedAttack,
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
  private tuning: Required<CharacterTuning> & {
    shield: ResolvedShieldTuning;
    dodge: ResolvedDodgeTuning;
    ledge: ResolvedLedgeHangTuning;
    ledgeDetection: LedgeDetectionTuning;
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
      // Latch grounded state even during hitstun so the moment hitstun
      // releases we don't spuriously fire a "just landed" event from a
      // stale reading.
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
    const effectiveShieldHeld =
      groundedForShield &&
      shieldHeld &&
      (shieldRaisedNow || !this.prevShieldHeld);
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
    const dodgeJustPressed = dodgeHeldThisFrame && !this.prevDodgeHeld;
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
      const grabJustPressed = grabHeldThisFrame && !this.prevGrabHeld;
      const grabInput: GrabInput = {
        grabPressed: grabJustPressed,
        grounded,
        pummelPressed: false,
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
        release: input.ledgeRelease ?? null,
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
        // Lock facing to the ledge's "into the stage" side so the
        // fighter visually faces inward (a left-side ledge grab faces
        // right, a right-side ledge grab faces left).
        this.facing =
          this.ledgeHangState.active.candidate.side === 'left' ? 1 : -1;
      }
    }
    const ledgeLocking = isLedgeLockingInput(this.ledgeHangState);
    const moveX = dodgeLocking || ledgeLocking ? 0 : moveXAfterShield;

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
    } else if (Math.abs(moveX) > 0.0001) {
      // Stick deflected — accelerate toward the directional max speed.
      const targetVx = moveX * this.tuning.maxRunSpeed;
      const delta = targetVx - vx;
      if (Math.abs(delta) <= accel) {
        // Within one step's worth of the target — snap to avoid jitter.
        vx = targetVx;
      } else {
        vx += accel * Math.sign(delta);
      }
      // Knockback can leave us above max speed; ease back toward it
      // without yanking. Only relevant once knockback lands; preserved
      // here so the contract is stable.
      if (Math.abs(vx) > this.tuning.maxRunSpeed) {
        vx *= damping;
      }
      // Update facing whenever the stick has direction.
      this.facing = moveX > 0 ? 1 : -1;
    } else {
      // Stick neutral — damp toward rest. Snap to zero once we drop
      // below a tiny epsilon so the velocity log doesn't drift.
      vx *= damping;
      if (Math.abs(vx) < 0.01) vx = 0;
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
      input.jump &&
      !this.prevJumpHeld;
    if (jumpJustPressed && this.jumpsUsed < this.tuning.maxJumps) {
      vy = -this.tuning.jumpImpulse;
      this.jumpsUsed += 1;
    }

    // Reset the jump budget when grounded *and* not in the middle of a
    // fresh jump impulse. Checking `vy >= 0` avoids the resetting
    // happening on the same frame we just kicked off the ground.
    if (grounded && vy >= 0) {
      this.jumpsUsed = 0;
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
    const attackHeldEffective =
      !shieldRaised && !dodgeLocking && !ledgeLocking && input.attack === true;
    const heavyHeldEffective =
      !shieldRaised &&
      !dodgeLocking &&
      !ledgeLocking &&
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
      input.special === true;
    this.tickAttack(
      attackHeldEffective,
      heavyHeldEffective,
      this.isGrounded(),
      moveX,
      prevFacing,
      justLanded,
      specialHeldEffective,
      input.dropThrough === true,
      input.jump === true,
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
      this.grabHitboxBody = spawnGrabHitbox(
        this.scene as unknown as HitboxScene,
        {
          id: this.id,
          position: this.body.position,
          bodyId: this.body.id,
        },
        this.grabSpec,
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
        this.grabTarget.applyHit({
          damage: throwSpec.damage,
          knockback: throwSpec.knockback,
          facing: this.facing,
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
    };
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
    };
    return true;
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
  private applyTeleportPress(_move: TeleportUpSpecialMove): void {
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
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
      case 'multiHitRising':
      case 'tether':
        // Press-frame impulse + standard physics integration is the
        // recovery vector for these kinds. No per-frame override.
        break;
      default: {
        const _exhaustive: never = a.move;
        void _exhaustive;
      }
    }
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
  ): void {
    // The call where a move ends *arms* the cooldown but does not also
    // drain it — otherwise the cooldown would read `cooldownFrames - 1`
    // immediately after the move's last frame, which is harder to
    // reason about and makes "after totalBusy frames, cooldown reads
    // cooldownFrames" a non-truth.
    let attackJustEnded = false;

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
      a.framesElapsed += 1;
      const newPhase = Character.phaseFor(a.framesElapsed, a.move);

      // Spawn on startup → active transition. The hitbox is spawned at
      // the body's *current* centre (post-velocity-commit) so a fighter
      // dashing into the swing extends his hitbox's effective reach by
      // a small physically-honest amount.
      if (prevPhase === 'startup' && newPhase === 'active' && a.hitboxBody === null) {
        a.hitboxBody = spawnHitbox(
          this.scene as unknown as HitboxScene,
          { id: this.id, position: this.body.position, bodyId: this.body.id },
          a.move,
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
    if (
      this.activeAttack === null &&
      this.cooldownRemaining === 0 &&
      !attackPressConsumedByItem
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
      let groundedPattern: 'jab' | 'tilt' | 'smash' | null = null;
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
          defaultId: this.defaultAttackId,
        };
        const dispatch = classifyGroundedAttack(
          {
            attackJustPressed,
            heavyJustPressed,
            moveX,
            prevMoveX: this.prevMoveX,
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
        let started: boolean;
        if (grounded && groundedPattern !== null) {
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
    const specialJustPressed = specialHeld && !this.prevSpecialHeld;
    if (
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
        this.executeNeutralSpecial();
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
    if (isShieldRaised(this.shieldState)) {
      const r = applyShieldHit(this.shieldState, hit.damage, this.tuning.shield);
      this.shieldState = r.state;
      return {
        vector: { x: 0, y: 0 },
        magnitude: 0,
        angle: 0,
        hitstunFrames: 0,
      };
    }

    // 1. Damage accumulation. Capture pre-hit percent for the
    //    high-% hitlag bonus so a 149% target hit by a heavy crosses
    //    into "high-% crunch" exactly when the bonus formula expects.
    const percentBeforeHit = this.damagePercent;
    this.damagePercent = accumulateDamage(this.damagePercent, hit.damage);

    // 2. Knockback math — at the *new* percent, scaled by the
    //    fighter's current mass so heavy targets resist.
    const result = computeKnockback(hit, this.damagePercent, this.tuning.mass);

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
    return { ...this.tuning };
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
  getActiveHurtboxes(): ReadonlyArray<Hurtbox> {
    const body = this.getBodyHurtbox();
    if (!this.activeAttack) return [body];
    // The attack's `move` is typed `AttackMove`; per-move hurtbox
    // modifiers live on the `AttackMoveWithAnimation` extension. We
    // upcast deliberately — every move registered in the M2 roster is
    // declared as `AttackMoveWithAnimation`-compatible (modifiers
    // optional). A move authored as a bare `AttackMove` (legacy /
    // test fixture) carries no `hurtboxModifiers` field and resolves
    // to the body default by the helper's empty-modifier short-circuit.
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
      // Ledge-attack is a placeholder for a future move-driven release —
      // for this sub-AC we simply restore normal physics with a small
      // horizontal nudge into the stage so the attack animation has
      // somewhere to swing.
      const inward =
        this.facing === 1 ? this.tuning.maxRunSpeed * 0.5 : -this.tuning.maxRunSpeed * 0.5;
      this.scene.matter.body.setVelocity(this.body, { x: inward, y: 0 });
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
    this.groundContacts = 0;
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
    // AC 60301 Sub-AC 1 — shield state is transient too. Reset to a
    // fresh idle / full-HP shield on respawn so a fighter who lost a
    // stock mid-shatter doesn't reappear pre-broken.
    this.shieldState = resetShieldState(this.tuning.shield);
    // AC 60302 Sub-AC 2 — dodge state is transient as well. A fighter
    // who lost a stock mid-roll shouldn't respawn carrying the rest of
    // the slide / recovery / cooldown. Reset to a fresh idle.
    this.dodgeState = resetDodgeState();
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
