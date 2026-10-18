import {beginGrabDamageTransaction,grabDamageTransactionMatches,commitGrabDamageTransaction,type GrabDamageTransaction} from './grabDamageTransaction';
import {parseAttackMoveSnapshot} from './characterSerializer';
import {beginShieldBreak,stepShieldBreak,selectShieldBreakPresentation,shieldBreakControlsLocked,shieldBreakProtection,parseShieldBreakState,shieldBreakPopPlan,type ShieldBreakState} from './shieldBreak';
import {parseSourceDamagePresentationReceipt,type SourceDamagePresentationReceipt} from './sourceDamagePresentationReceipt';
import { ultimateCaptureFrames, initialCaptureMash, tickCaptureMash, reducedCaptureFrames, SHIELD_BREAK_MASH_WEIGHTS, ULTIMATE_GRAB_RELEASE_FRAMES, ULTIMATE_POST_RELEASE_GRAB_IMMUNITY_FRAMES, type CaptureMashState } from './ultimateCapture';
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

import { validateLedgeRootMotion } from './ledgeRootMotionSchema';
import { validateTauntSet, type TauntSet, type TauntKind, type TauntPresentationState } from './tauntSchema';
import {applyRegionalProtection} from './regionalProtection';
import {applyDonkeyKongMoveProtection,resolveDonkeyKongProtectionClock} from './donkeykongPairedProtectionClock';
import {donkeyKongJabCanAdvance,donkeyKongRetainedJabCanAdvance,retainDonkeyKongJabContinuation,
 tickDonkeyKongJabContinuation,type DonkeyKongJabContinuation} from './donkeykongJabContinuability';
import { nextPackedBodyTail, packedBodyCandidate, packedBodyProfile, type PackedBodyState } from './packedBodyPresentation';
import {beginItemAction as createItemAction,tickItemAction,getItemActionPlan,eligibleItemThrowContext,fighterItemProfile,itemActionSheet,type ItemAction,type ItemActionState,type ItemActionEvent,type ItemActionPlan,type ItemDirection} from '../items/itemActions';
import type {ItemCatchContext} from '../items/itemCatch';
import {stepDonkeyKongGroundVelocity} from './donkeykongGroundMovement';
import {DONKEYKONG_JUMP_TAKEOFF_PARAMETERS,stepDonkeyKongAirVelocity} from './donkeykongAirMovement';
import {groundJumpTakeoffVelocityX} from './jumpTakeoffVelocity';
import {donkeyKongFullHopCarriedVelocityY,donkeyKongVerticalPrePhysicsVelocity,DONKEYKONG_FOOTSTOOL_BETA_JUMP_BASIS,DONKEYKONG_VERTICAL_PARAMETERS} from './donkeykongVerticalMovement';
import {tickDonkeyKongTurnBrake,donkeyKongTurnBrakeFacing,donkeyKongTurnBrakeVelocity,donkeyKongTurnBrakeNativeMarkers,type DonkeyKongTurnBrakeState} from './donkeykongTurnBrake';
import {beginDonkeyKongHeavyItemAction as createDonkeyKongHeavyItemAction,fighterHeavyItemProfile,stepGroundOnlyHeavyCarry,tickDonkeyKongHeavyItemAction,getDonkeyKongHeavyCarryMotion,groundOnlyHeavyCarryMotion,selectDonkeyKongHeavyWalkGait,type DonkeyKongHeavyItemAction,type DonkeyKongHeavyItemState,type DonkeyKongHeavyItemEvent,type DonkeyKongHeavyItemPlan} from './donkeykongHeavyItems';
import {classifyDonkeyKongReferenceCarryDamage} from './donkeykongHeavyArmor';
import {beginDonkeyKongHeavyCarry,tickDonkeyKongHeavyCarry,type DonkeyKongHeavyCarryState} from './donkeykongHeavyCarry';
import { SURFACE_TECH_PROFILES } from './surfaceTechProfiles';
import { beginSurfaceTech, tickSurfaceTech, surfaceTechProtected, surfaceTechActionable, selectSurfaceTech, surfaceTechEntryVelocity, surfaceTechCeilingDisplacement, advanceTechInputWindow, classifySurfaceTechContact, type SurfaceTechState } from './surfaceTech';
import { DonkeyKongAttackCollisionPoseConsumer } from './donkeykongAttackCollisionPose';
import {DonkeyKongCatchCollisionPoseConsumer,type DonkeyKongCatchCollisionDiagnostic} from './donkeykongCatchCollisionPose';
import { DONKEYKONG_FOOTSTOOL_PARAMETERS, DONKEYKONG_FOOTSTOOL_REPEAT_RULES, canDonkeyKongFootstoolJump, donkeyKongFootstoolJumpVelocity,type SourceFootstoolParticipant } from './donkeykongFootstool';
import {LINK_FOOTSTOOL_SOURCE,canLinkFootstoolJump,linkFootstoolJumpVelocity,selectLinkFootstoolRecipientSide,selectLinkFootstoolBodyRoute,type LinkFootstoolBodyPresentation} from './linkFootstool';
import { captureSimulationAnimation } from './simulationSpriteAnimation';
import { resolveGameplayAction as resolveSimulationAction, selectCapturePoseSource, selectPackedBodyReceiving, selectPackedHeadContact, getPackedBodyRootDelta, getPackedAttackCollisionPose, getPackedCatchCollisionPose } from '../characterPresentation/legacy/poseProvider';
import {resolveDonkeyKongCaptureAttachment,sameAttachmentAuthoredPoseIdentity,type CaptureAttachmentResult,type CaptureAttachmentRequest,type CaptureAttachmentAnchor,type AttachmentContext} from './donkeykongCaptureAttachment';
import {parseCaptureAttachmentCalibration,captureAttachmentContextFromBody,selectCaptureAttachmentAnchor,type CaptureAttachmentCalibration} from './captureAttachmentCalibration';
import {ultimateCargoFrames,reducedCargoFrames,selectCargoThrow,canCargoJump} from './donkeykongCargoRules';
import {beginDonkeyKongPunch,tickDonkeyKongPunch,type DonkeyKongPunchState} from './donkeykongPunchControls';
import {getNativeShieldPushTraction} from './nativeShieldTraction';
import {computeShieldPushback,decayShieldPushback} from './shieldPushback';
import {createBuriedState,tickBuriedState,receiveBuriedHit,ultimateBuryFrames,type BuriedState} from './buriedState';
import {buriedEffects,buriedSinkDepth,sinkHurtboxes} from './buriedPresentation';
import {REVIVAL_PLATFORM_MAX_FRAMES,REVIVAL_DISMOUNT_INVINCIBILITY_MAX_FRAMES,isRevivalDismountInput,revivalDismountInvincibilityFrames} from '../match/revivalPlatform';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import { isVerticalReferenceLaunch, referenceGravityBoost, stepReferenceGravity } from './referenceLaunchEnergy';
import { isFixedReferenceKnockback } from './referenceKnockback';
import { referenceTripProbability } from './referenceTrip';
import { getReferenceDamageSpeedUpGroups } from './referenceDamageSpeedUp';
import { applyReferenceLaunchInfluence } from './referenceLaunchInfluence';
import { referenceAutolinkVelocity, validReferenceAutolinkContext } from './referenceAutolink';
import { createReferenceSdiState, stepReferenceSdi } from './referenceSdi';
export { SDI_NUDGE_PX, SDI_STICK_THRESHOLD } from './referenceSdi';
import { attackHitWindowIndex, resolveAttackHitWindow } from './attackHitWindows';
import {realizeLinkSmashFollowupCharge} from './linkSmashFollowupCharge';
import { scaleAttackCollisionHitDamage } from './attacks';
import type { CharacterId } from '../types';
import type { DownSpecialShockwaveSpec, DownSpecialTrapSpec } from './downSpecialSchema';
import {
  CHARACTER_SLOT_BITS,
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
  MAX_FIGHTER_SLOTS,
} from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import {
  type ActiveAttack,
  type AttackMove,
  despawnHitbox,
  spawnGrabHitbox,
  spawnHitbox,
  updateHitboxPosition,
} from './attacks';
import {
  accumulateDamage,
  applyDIToLaunchAngle,
  computeHitlag,
  computeShieldHitlag,
  computeShieldParryHitlag,
  computeShieldstun,
  computeKnockback,
  computeStaleMultiplier,
  decayLaunchVelocity,
  STALE_QUEUE_SIZE,
  type HitInfo,
  type KnockbackResult,
  type StaleEntry,
} from './combat';
import { getCurrentAnimation, type AnimationState } from './animationState';
import {
  type AttackMoveWithAnimation,
  type Hurtbox,
  makeBodyHurtbox,
  isAllHurtboxesIntangible,
  selectActiveHurtboxes,
} from './moveSchema';
import {
  type AerialDirection,
  type AerialMove,
  getLandingLagFrames,
  validateAerialLandingAttack,
} from './aerialSchema';
import {
  applyShieldHit,
  createShieldState,
  isInShieldstun,
  isShieldBroken,
  isShieldRaised,
  resolveShieldTuning,
  resetShieldState,
  shieldBreakStunFrames,
  tickShield,
  type ResolvedShieldTuning,
  type ShieldState,
  type ShieldTuning,
} from './shieldState';
import {
  cancelDodge,
  canCancelSpotDodge,
  createDodgeStaleness,
  createDodgeState,
  dodgeProgress,
  FULLY_STALE_AIR_DODGE_DISTANCE_SCALE,
  isDodgeFullyStale,
  tickDodgeStaleness,
  type DodgeInput,
  type DodgeStaleness,
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
  canPummel,
  resetGrabState,
  tickGrab,
  stepGrabWithEvents,
  type GrabInput,
  type GrabState,
} from './grabState';
import {beginGrabSourcePresentation,stepGrabSourcePresentation,type GrabSourcePresentation} from './grabSourcePresentation';
type BoundGrabSourcePresentation=GrabSourcePresentation&{target:Character;captureId:number;targetGeneration:number;cargo:boolean};
import { validateGrabSpec, type GrabSpec } from './grabSchema';
import {parseAuthoredCaptureMotionFamily,type AuthoredCaptureMotionFamily} from './authoredCaptureMotionFamily';
import { getThrowByDirection, type ThrowDirection } from './throwSchema';
import {
  computeChargedDamageFromSpec,
  computeChargedKnockbackFromSpec,
  type ChargeSpec,
} from './chargeSchema';
import {
  classifyGroundedAttack,
  isSmashFlick,
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
  type UpSpecialSustainedRiseSpec,
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
  computeLedgeStandingTarget,
  createLedgeHangState,
  isLedgeHangInvincible,
  isLedgeLockingInput,
  ledgeRecoverySmoothstep,
  ledgeHangPresentationClock,
  ledgeRegrabEntry,
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
import { PikachuSpecialRuntime, type SpecialSurface, type SpecialProjectileTarget } from './pikachuSpecialRuntime';
import { selectPikachuSpecialHurtboxes } from './pikachuSpecialHurtboxes';
import { selectPikachuSpecialPhaseHurtboxes } from './pikachuSpecialPhaseHurtboxes';
import { resolvePikachuSpecialBodyClock } from './pikachuSpecialPresentation';
import { rotatePikachuSpecialHurtboxes, PIKACHU_QUICK_ROT_PIVOT } from './pikachuSpecialTransforms';
import { pikachuSpecialContact } from './pikachuSpecialContactData';
import { selectPikachuLedgeAttachment } from './pikachuLedgeAttachment';
import { tickPikachuTurnBrake, pikachuTurnBrakeVelocity, type PikachuTurnBrakeState } from './pikachuTurnBrake';
import { pikachuDirectionalDodgePhase } from './pikachuDirectionalDodge';
import { tickPikachuCrouchCrawl, pikachuCrouchCrawlVelocity, type PikachuCrouchCrawlState } from './pikachuCrouchCrawl';
import { getPikachuCapturedBodyBottomEnvelope } from './pikachuCaptureBodyClearance';
import { selectPikachuSurfaceTechBody, pikachuSurfaceTechPresentation } from './pikachuSurfaceTech';
import { GROUND_RECOVERY_ROWS, getupRollRow, type GroundRecoveryRow } from './groundRecovery';
import { beginPikachuGroundRecovery, advancePikachuGroundRecovery, pikachuGroundRecoveryVelocity, type PikachuGroundRecovery, type PikachuGroundRecoverySheet } from './pikachuRecoveryRuntime';
import {beginPikachuLedgeJump,advancePikachuLedgeJump,pikachuLedgeJumpStartOffset,pikachuLedgeJumpBetaImpulse,PIKACHU_LEDGE_JUMP_SOURCE_TRAVEL,type PikachuLedgeJump} from './pikachuLedgeJumpRuntime';
import {heldItemMuzzle, selectHeldItemSocket} from './heldItemSocket';
import {computeHeldItemPosition} from './handAnchors';
import { PIKACHU_AUXILIARY_SOURCE_PARAMETERS, pikachuAuxiliaryBodyEndExclusive, selectPikachuAuxiliaryBody } from './pikachuAuxiliaryBody';
import type { AirMovementTuning, LandingTuning, DonkeyKongOrdinaryVerticalProfile } from './movesetContract';
import { resolveItemInput } from '../items/resolveItemInput';
import { itemUsesFor } from '../items/ItemDefinition';
import type { HeldItemHandle } from '../items/ItemDefinition';
import {stepHammer,hammerMotion,hammerAreas,type HammerSpec} from '../items/Hammer';
import { startShooting, stepShooting, shootingMotion, type ShootingSpec, type ShootingState } from '../items/itemShooting';
import { itemMotionClip } from '../items/itemMotionClips';
import {beginEating,stepEating,beginHealing,stepHealing,type HealingState,type RecoverySpec} from '../items/itemHealing';
import {validRecoverySpec,parseRecoveryTransactionEvent,parseRecoveryEatingState,parseRecoveryHealingState,type RecoveryTransactionEvent,type RecoveryEatingState} from '../items/recoveryTransaction';
import type { ItemShot } from './attacks';

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
  /** Natural gravity during and after reference launches, in native game units. */
  readonly referenceLaunch?: import('./referenceLaunchEnergy').ReferenceLaunchProfile;
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
  /** Reference knockback weight, independent of Matter mass; unauthored fighters use 100. */
  readonly referenceWeight?: number;
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

export type CharacterHitOutcome =
  | 'landed'
  | 'shielded'
  | 'parried'
  | 'invincible'
  | 'invulnerable'
  | 'intangible'
  | 'dodged'
  | 'ledge-invincible'
  | 'armored'
  | 'destroyed';

export interface CharacterCombatPercentReceipt {
  readonly damageApplied:number;readonly attackerSlotIndex:number|null;
  readonly recoil:boolean;readonly viaSceneResolver:boolean;
}
export interface CharacterHitApplication {
  readonly outcome: CharacterHitOutcome;
  readonly knockback: KnockbackResult;
  readonly damageApplied: number;
  readonly parryKind?: 'shield' | 'counter';
  /** Flesh contact confirmed, damage/freeze applied, carry reaction resisted. */
  readonly reactionResisted?: true;
  /** Per-hit source carry loss, consumed against the Scene's pre-hit identity. */
  readonly heavyItemDrop?: { readonly reason:'threshold'|'sleep'|'forced-reaction'; readonly referenceKnockback:number };
}

/** Constructor options. `id`, `spawnX`, `spawnY` are required. */
export interface CharacterOptions extends CharacterTuning, AirMovementTuning, LandingTuning {
  readonly donkeykongOrdinaryVertical?: DonkeyKongOrdinaryVerticalProfile;
  /** Explicit authored shield-push decay when this identity has no native donor. */
  readonly shieldPushTraction?:number;
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
  /** Real taunt input. The persisted logical action named taunt remains Dodge. */
  readonly appeal?: boolean;
  /**
   * Horizontal stick. -1 = full left, 0 = neutral, 1 = full right.
   * Analog values in [-1, 1] are supported for gamepads.
   */
  readonly moveX: number;
  /**
   * Vertical stick. -1 = full up, 0 = neutral, 1 = full down. Used by
   * Directional Influence (DI) at hitlag-end to rotate the queued
   * eligible tumble launch angle by up to 0.17 radians. Optional so
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
   * Heavy-attack (smash) button held this frame. Sub-AC 3.3 — dedicated
   * slot for the smash-class move (more startup, larger knockback
   * scaling, KO finisher). Rising-edge detected like `attack`; holding it
   * keeps a chargeable smash charging. On the ground the direction picks
   * up / down / forward smash, and an up-aimed press during jumpsquat
   * cancels the jump into the up smash; once airborne the press fires the
   * aerial for the attack direction, like an `attack` press (Ultimate's
   * C-stick).
   *
   * Optional for the same backward-compatibility reason as `attack`:
   * existing call sites and tests that only wire neutral-attack keep
   * compiling unchanged. Human input routes the dedicated `smash`
   * binding here; the CPU sends it for its smash decisions.
   */
  readonly attackHeavy?: boolean;
  /**
   * Direction of a right-stick (C-stick) attack, snapped by the input
   * layer to a 4-way unit vector (canvas Y: -1 = up). Read only on an
   * `attackHeavy` press: a non-zero value replaces moveX / moveY (and the
   * short vertical leniency window) when choosing the smash or aerial,
   * and a forward smash turns to face `sign(attackStickX)`. Never feeds
   * movement, dash, drift, fast-fall, ledge, DI/SDI or dodge, so the
   * left stick keeps full control of the body. Omitted means 0.
   */
  readonly attackStickX?: number;
  /** Vertical half of {@link attackStickX}. Omitted means 0. */
  readonly attackStickY?: number;
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
   * layer and routes the result here. A rising edge dispatches to the
   * registered neutral / side / up / down special slot from the stick
   * direction at press time; it is never folded into
   * {@link attackHeavy}.
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

/** Ultimate-style standard input buffer for offensive actions. */
export const OFFENSIVE_ACTION_BUFFER_FRAMES = 9;
/** SmashWiki Shieldstun (Ultimate): "shield grabbing after shieldstun has increased startup by 4 frames". */
export const SHIELD_GRAB_POST_SHIELDSTUN_DELAY_FRAMES = 4;
/** Universal grounded jump-squat duration used by Ultimate's roster. */
export const JUMPSQUAT_FRAMES = 3;
/** fighter_param shoot_back_speed_mul (ultimate-13.0.1 item sheet): walking backward while shooting. */
const SHOOT_BACK_SPEED_MUL = .87;
/** Below this ground speed (px/step) the shooting legs stand (authored presentation threshold). */
const SHOOT_LEGS_WALK_MIN_SPEED = .2;
/** item_shoot_legs_landing: 16 native frames (motion length, both fighters). */
const SHOOT_LEGS_LANDING_FRAMES = 16;
/** Standard window for a jump press made shortly before the fighter is free. */
export const JUMP_INPUT_BUFFER_FRAMES = 9;

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

/** Per-frame downward acceleration applied to a placed trap that hasn't landed. */
const TRAP_GRAVITY = 0.55;
/** Terminal fall speed (px/frame) for a placed trap. */
const TRAP_MAX_FALL = 14;

/**
 * Launch knockback magnitude at/above which a hit sends the victim into
 * TUMBLE — the launched state that can be TECHED on ground contact. Below
 * this, a hit is light hitstun that just ends when it drains (no
 * knockdown). ~7 px/step separates jab-tier pokes from real launches.
 */
export const TUMBLE_KNOCKBACK_THRESHOLD = 7;
/** Missed-tech KNOCKDOWN (prone, vulnerable): frames lain before the automatic neutral getup, the landing frame
 * included, and the frames during which no floor getup option is accepted. SmashWiki Lucario (SSBU)/Floor getups
 * (front, back): "When missing the tech, Lucario can choose a floor getup option after 25 frames. However, when an
 * option isn't selected, Lucario will be prone for 245 frames(including missed tech tumble) before automatically doing
 * a neutral getup from the floor." The general Floor getup page gives no Ultimate figure ("automatically stand up in a
 * few seconds"); the per-fighter page's values are applied to every fighter. */
export const KNOCKDOWN_FRAMES = 245;
export const KNOCKDOWN_OPTION_LOCK_FRAMES = 25;
/** Hard trip (an attack's trip chance; the engine has no slip/soft trip). SmashWiki Lucario (SSBU)/Floor getups (trip):
 * "can choose a floor getup option right after 39 frames. However, when an option isn't selected, Lucario will be prone
 * for 99 frames(including the trip effect) before automatically doing a neutral getup on the 100th frame." */
export const TRIP_KNOCKDOWN_FRAMES = 99;
/** Native slip / slip_down xlu 1..6 (DK, Link and Pikachu rows): a trip is intangible on frames 1-5. */
export const TRIP_FALL_INTANGIBLE_FRAMES = 5;
export const TRIP_OPTION_LOCK_FRAMES = 39;
/** Soft trip (the slip attribute: Banana Peel). SmashWiki Tripping: "attacks have the "slip" effect and cause soft trips
 * that immobilize for around 30 frames" (SSB4 list; the Ultimate list says tripping "has largely been unchanged"). The
 * auto-getup timer is the hard trip's. */
export const SLIP_OPTION_LOCK_FRAMES = 30;
/** Intangibility frames granted on a get-up from knockdown. */
export const GETUP_IFRAME_FRAMES = 14;
/** Horizontal speed (px/step) of a ground recovery roll without packed root motion. */
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
 * Fraction of `maxRunSpeed` above which a fighter counts as "running"
 * for dash-sensitive inputs: a light attack press becomes a DASH-ATTACK
 * (not a forward-tilt-from-standstill), and a grab press becomes a
 * DASH-GRAB. One shared gate so both read the same speed threshold.
 */
export const DASH_SPEED_FRACTION = 0.55;

/**
 * CROUCH-CANCEL — a grounded crouching fighter absorbs part of an
 * incoming hit's launch, multiplying the knockback (and tumble check) by
 * this factor. The ordinary Ultimate reference calculator uses 0.85;
 * crouching also applies its separate 0.67 hit-stop multiplier.
 */
export const CROUCH_KNOCKBACK_REDUCTION = 0.85;
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
    | 'referenceLaunch'
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
  referenceWeight: 100,
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

/** Optional stick channel → [-1, 1]; missing or non-finite reads as 0. */
function finiteClamp(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : clamp(value, -1, 1);
}

function isPlatformLabel(label: string | undefined | null): boolean {
  return label === PLATFORM_LABELS.solid || label === PLATFORM_LABELS.passThrough;
}

/**
 * Minimal shape of a Matter collision pair we care about. Lets the
 * unit test suite construct fake events without a Matter import — the
 * real Phaser/Matter pair carries a lot more (slop, normal, etc.) but
 * we read body identity, collision eligibility, and the live contact normal.
 */
interface SupportPair {
  readonly bodyA: {
    id?:number;
    label?: string | null;
    isSensor?: boolean;
    collisionFilter?: { mask?: number };
    position: { x: number; y: number };
    bounds?: { min: { x: number; y: number }; max: { x: number; y: number } };
  };
  readonly bodyB: {
    id?:number;
    label?: string | null;
    isSensor?: boolean;
    collisionFilter?: { mask?: number };
    position: { x: number; y: number };
    bounds?: { min: { x: number; y: number }; max: { x: number; y: number } };
  };
  readonly isActive?: boolean;
  isSensor?: boolean;
  readonly collision?: { readonly normal: { readonly x: number; readonly y: number } };
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
/** Capture attachment/event observations; no native reaction commitment implied. */
export interface CapturePresentationState {
  captureId: number;
  active: boolean;
  framesElapsed: number;
  facing: 1 | -1;
  groundedAtEntry: boolean;
  captor: { characterId: CharacterId; bodyId: number; entryFacing: 1 | -1; facing: 1 | -1 };
  event: { sequence: number; kind: 'entry' | 'damage' | 'release'; framesElapsed: number;
    damage?: number; damageSource?: 'pummel' | 'throw-pre-hit' | 'external';
    releaseReason?: 'throw' | 'hold-expired' | 'break' | 'reset' | 'external' };
}

/** Actual shield outcomes/counters, not native startup/end motion timing. */
export interface ShieldPresentationState {
  kind: 'hold' | 'release' | 'block' | 'parry' | 'broken';
  framesElapsed: number;
  totalFrames: number | null;
  remainingFrames: number | null;
  facing: 1 | -1;
  phase: 'hitlag' | 'active';
}

/** Observed framework states only; native reaction selectors/rates remain unqualified. */
export interface ReactionPresentationState {
  kind: 'damage' | 'tumble' | 'trip' | 'prone' | 'getup-roll' | 'getup-attack' | 'stand' | 'tech-in-place';
  origin: 'trip' | 'face-up' | 'face-down' | 'tech' | null;
  framesElapsed: number;
  facing: 1 | -1;
  phase?: 'hitlag' | 'hitstun';
  travelDirection?: 1 | -1;
  moveId?: string;
}

export interface CaptureAttachmentLink {
  readonly target:Character;readonly captureId:number;readonly captorReset:number;readonly recipientReset:number;readonly context:AttachmentContext;
}
import { beginFinalOpponentSlow, stepFinalOpponentSlow, type FinalOpponentSlowState } from '../finalSmash/FinalOpponentSlow';
import {parseFinalVictimPresentationState,stepFinalImpactVictimPresentation,selectFinalVictimPresentation,type FinalVictimPresentationState} from '../finalSmash/finalVictimPresentation';
import {finalVictimBodyPose} from '../finalSmash/finalVictimBodyPose';
import { finalBodyPose } from '../finalSmash/finalBodyPose';
import type { FinalSmashActorControl } from '../finalSmash/finalSmashActorControl';
import {transformPikachuFinalOrientationPoint} from '../finalSmash/pikachuFinalOrientation';

export class Character {
  private captureAttachmentCalibration: CaptureAttachmentCalibration | null = null;
  private captureAttachmentEntry: {captor:Character;captureId:number;captorReset:number;recipientReset:number}|null = null;
  private captureAttachmentBypass: {link:CaptureAttachmentLink;legacyOffset:{x:number;y:number}} | null = null;
  private captureAttachmentDiagnostic: CaptureAttachmentResult | {status:'fallback';reason:string} | null = null;

  /** Explicit data transport only; never marks art/native constraints accepted. */
  setCaptureAttachmentCalibration(raw: CaptureAttachmentCalibration | null): void {
    this.captureAttachmentCalibration=raw===null?null:parseCaptureAttachmentCalibration(raw,'captureAttachmentCalibration');
    this.captureAttachmentDiagnostic=null;
  }
  getCaptureAttachmentCalibration(): CaptureAttachmentCalibration | null {
    return this.captureAttachmentCalibration?parseCaptureAttachmentCalibration(this.captureAttachmentCalibration,'captureAttachmentCalibration'):null;
  }
  getCaptureAttachmentDiagnostic() { return this.captureAttachmentDiagnostic; }
  recordCaptureAttachmentFallback(reason:string): void { this.captureAttachmentDiagnostic={status:'fallback',reason}; }

  /** Actual capture ownership is independent of attachment opt-in/native identity. */
  hasCaptureAttachmentNestedTarget():boolean {
    return this.grabTarget!==null||['holding','throwing'].includes(this.grabState.name);
  }
  private getCaptureAttachmentActualLink(): CaptureAttachmentLink | null {
    const target=this.grabTarget,entry=target?.captureAttachmentEntry;
    if(this.destroyed||!target||target.destroyed||target.grabbedBy!==this||!entry||entry.captor!==this||
      !target.capturePresentation?.state.active||entry.captureId!==target.captureSequence||
      entry.captorReset!==this.positionResetGeneration||entry.recipientReset!==target.positionResetGeneration||
      !['holding','throwing'].includes(this.grabState.name))return null;
    const targetBody=resolveSimulationAction(captureSimulationAnimation(target,target.simulationInputFrame,false));
    const context=captureAttachmentContextFromBody(Boolean(this.grabState.active?.cargo),this.grabState.name==='throwing',targetBody.state);
    return {target,captureId:entry.captureId,captorReset:entry.captorReset,recipientReset:entry.recipientReset,context};
  }
  getCaptureAttachmentLink():CaptureAttachmentLink|null {
    if(this.id!=='donkeykong'||this.grabSpec?.attachmentPolicy!=='pose-anchors-beta-v1')return null;
    return this.getCaptureAttachmentActualLink();
  }
  getCaptureAttachmentPendingLegacyRestore():CaptureAttachmentLink|null {
    const pending=this.captureAttachmentBypass,live=this.getCaptureAttachmentActualLink();
    if(!pending)return null;
    if(!live||live.target!==pending.link.target||live.captureId!==pending.link.captureId||
      live.captorReset!==pending.link.captorReset||live.recipientReset!==pending.link.recipientReset){
      this.captureAttachmentBypass=null;return null;
    }
    return live;
  }
  private rememberCaptureAttachmentBypass(link:CaptureAttachmentLink):void {
    if(!this.grabSpec)return;
    const cargo=Boolean(this.grabState.active?.cargo);
    this.captureAttachmentBypass={link,legacyOffset:{
      x:cargo?this.grabSpec.cargo?.offsetX??this.grabSpec.hitbox.offsetX:this.grabSpec.hitbox.offsetX,
      y:cargo?this.grabSpec.cargo?.offsetY??this.grabSpec.hitbox.offsetY:this.grabSpec.hitbox.offsetY}};
  }

  /** Pose selection is simulation-owned; null art selection remains an explicit gap. */
  private getCaptureAttachmentPose(context:AttachmentContext) {
    const s=captureSimulationAnimation(this,this.simulationInputFrame,false);
    const {action,clip,native,art:sourceArt}=selectCapturePoseSource(s);
    const calibration=this.captureAttachmentCalibration,size={width:this.tuning.width,height:this.tuning.height};
    const profileKey=calibration?`${calibration.profileKey}@${calibration.revision}`:`missing-calibration:${this.id}`;
    let art=sourceArt;
    const poseKey=action.state;
    const matches=(r:CaptureAttachmentAnchor)=>r.poseKey===poseKey&&r.profileKey===calibration?.profileKey&&
      r.artFrameIndex===art&&r.nativeSample===native;
    // Clip JSON is untrusted optional metadata; invalid/sparse rows never bypass to another grip.
    const rawClipGrips:unknown=clip?.clip.captureGripPoses;
    let clipGrips:import('./donkeykongCaptureAttachment').CaptureAttachmentGrip[]=[],gripMetadataInvalid=false;
    if(rawClipGrips!==undefined){
      try{
        if(!Array.isArray(rawClipGrips))throw new Error('Invalid grip array');
        clipGrips=Array.from(rawClipGrips).map(raw=>{
          if(!raw||typeof raw!=='object'||typeof raw.profileKey!=='string')throw new Error('Invalid grip row');
          return parseCaptureAttachmentCalibration({profileKey:raw.profileKey,revision:'clip-row-validation',grips:[raw]},'captureGripPoses').grips![0]!;
        });
      }catch{gripMetadataInvalid=true;}
    }
    const grips=gripMetadataInvalid?[]:[...(calibration?.grips??[]),...clipGrips].filter(r=>r.context===context&&matches(r));
    const normalize=<T extends CaptureAttachmentAnchor>(r:T):T=>({...r,profileKey});
    const grip=grips.length===1?normalize(grips[0]!):undefined;
    const selection=selectCaptureAttachmentAnchor(calibration,{context,poseKey,artFrameIndex:art,nativeSample:native,dimensions:size});
    const anchor=selection.status==='explicit'||selection.status==='physical-centre'?normalize(selection.anchor):undefined;
    if(selection.status==='physical-centre'&&art===undefined)art=0;
    return {poseKey,profileKey,dimensions:size,artFrameIndex:art??0,nativeSample:native,
      sourceSampleBasis:calibration?.sourceSampleBasis ?? 'one-based-native-frame' as const,
      authoredPoseIdentity:undefined,
      facing:action.facing??this.facing,grip,anchor,gripMetadataInvalid,anchorFailure:selection.status==='invalid'?selection.reason:null,
      review:calibration?.supportingFloor};
  }

  resolveCaptureAttachmentCandidate(liveBodyIds:readonly number[],solvedCentre:{x:number;y:number}):CaptureAttachmentResult|null {
    const link=this.getCaptureAttachmentLink();if(!link){this.captureAttachmentDiagnostic=null;return null;}
    const own=this.getCaptureAttachmentPose(link.context),other=link.target.getCaptureAttachmentPose(link.context);
    if(own.gripMetadataInvalid){this.recordCaptureAttachmentFallback('invalid-captor-grip-metadata');return null;}
    if(other.anchorFailure){this.recordCaptureAttachmentFallback(other.anchorFailure);return null;}
    let floor:Pick<CaptureAttachmentRequest,'floorY'|'recipientReviewedBottom'|'clearance'|'floorReviewKey'>={};
    if(this.isGrounded()){
      const supports=[...this.contactPairs.values()].filter(p=>this.isSupportPair(p)&&p.isActive!==false&&
        !p.isSensor&&p.collision&&Math.abs(p.collision.normal.x)<1e-6).map(p=>p.bodyA===this.body?p.bodyB:p.bodyA);
      const support=supports.find(p=>{const angle=(p as typeof p & {angle?:unknown}).angle;return isPlatformLabel(p.label)&&!p.isSensor&&typeof angle==='number'&&Number.isFinite(angle)&&Math.abs(angle)<1e-6&&p.bounds;});
      if(!support?.bounds||other.review===undefined){this.recordCaptureAttachmentFallback('missing-flat-support-or-recipient-floor-review');return null;}
      if(other.review!==null)floor={floorY:support.bounds.min.y,recipientReviewedBottom:Math.max(other.review.recipientReviewedBottom,link.target.tuning.height/2),
        clearance:other.review.clearance,floorReviewKey:other.review.reviewKey};
    }
    const result=resolveDonkeyKongCaptureAttachment({enabled:this.id==='donkeykong'&&this.grabSpec?.attachmentPolicy==='pose-anchors-beta-v1',
      active:true,reciprocal:link.target.grabbedBy===this,context:link.context,currentContext:this.getCaptureAttachmentLink()?.context??link.context,
      captorBodyId:this.body.id,recipientBodyId:link.target.body.id,liveCaptorBodyId:this.body.id,liveRecipientBodyId:link.target.body.id,liveBodyIds,
      captureId:link.captureId,currentCaptureId:link.target.captureSequence,
      expectedCaptorReset:link.captorReset,currentCaptorReset:this.positionResetGeneration,
      expectedRecipientReset:link.recipientReset,currentRecipientReset:link.target.positionResetGeneration,
      captorSolvedCentre:solvedCentre,captorDrawingFacing:own.facing,recipientCapturedFacing:other.facing,
      captorPoseKey:own.poseKey,captorProfileKey:own.profileKey,captorDimensions:own.dimensions,
      recipientPoseKey:other.poseKey,recipientProfileKey:other.profileKey,recipientDimensions:other.dimensions,
      captorArtFrameIndex:own.artFrameIndex,captorNativeSample:own.nativeSample,
      captorSourceSampleBasis:own.sourceSampleBasis,recipientSourceSampleBasis:other.sourceSampleBasis,
      captorAuthoredPoseIdentity:own.authoredPoseIdentity,recipientAuthoredPoseIdentity:other.authoredPoseIdentity,
      recipientArtFrameIndex:other.artFrameIndex,recipientNativeSample:other.nativeSample,grip:own.grip,anchor:other.anchor,...floor});
    this.captureAttachmentDiagnostic=result;return result;
  }
  /** Rendering/observation freshness only; never resolves floor, writes bodies or diagnostics. */
  isCaptureAttachmentResultCurrent(result:Extract<CaptureAttachmentResult,{status:'paired'}>):boolean {
    try{
      const link=this.getCaptureAttachmentLink();
      if(!link||link.captureId!==result.captureId||link.context!==result.context||
        this.body.id!==result.captorBodyId||link.target.body.id!==result.recipientBodyId||
        link.captorReset!==result.selection.captorResetGeneration||link.recipientReset!==result.selection.recipientResetGeneration)return false;
      const own=this.getCaptureAttachmentPose(link.context),other=link.target.getCaptureAttachmentPose(link.context);
      if(own.gripMetadataInvalid||!own.grip||!other.anchor)return false;
      const same=(a:CaptureAttachmentAnchor,b:CaptureAttachmentAnchor)=>a.poseKey===b.poseKey&&a.profileKey===b.profileKey&&
        a.dimensions.width===b.dimensions.width&&a.dimensions.height===b.dimensions.height&&
        a.artFrameIndex===b.artFrameIndex&&a.nativeSample===b.nativeSample&&a.sourceSampleBasis===b.sourceSampleBasis&&
        sameAttachmentAuthoredPoseIdentity(a.authoredPoseIdentity,b.authoredPoseIdentity)&&a.point.x===b.point.x&&a.point.y===b.point.y&&a.provenance===b.provenance;
      return same(own.grip,result.selection.grip)&&same(other.anchor,result.selection.anchor)&&
        own.grip.context===result.selection.grip.context&&own.grip.facingPolicy===result.selection.grip.facingPolicy&&
        own.grip.occlusion===result.selection.grip.occlusion&&result.occlusion===own.grip.occlusion&&own.facing===result.selection.captorDrawingFacing&&
        other.facing===result.selection.recipientPoseFacing;
    }catch{return false;}
  }

  private bypassCaptureAttachmentLegacyPin():boolean {
    const link=this.getCaptureAttachmentLink();if(!link)return false;
    const result=this.resolveCaptureAttachmentCandidate([this.body.id,link.target.body.id],this.getPosition());
    if(result?.status!=='paired')return false;
    this.rememberCaptureAttachmentBypass(link);return true;
  }
  restoreCaptureAttachmentLegacyPosition(link:CaptureAttachmentLink):void {
    const live=this.getCaptureAttachmentPendingLegacyRestore(),pending=this.captureAttachmentBypass;
    if(!pending||!live||live.target!==link.target||live.captureId!==link.captureId||
      live.captorReset!==link.captorReset||live.recipientReset!==link.recipientReset)return;
    const cargo=Boolean(this.grabState.active?.cargo),spec=this.grabSpec;
    const offset=spec?{x:cargo?spec.cargo?.offsetX??spec.hitbox.offsetX:spec.hitbox.offsetX,
      y:cargo?spec.cargo?.offsetY??spec.hitbox.offsetY:spec.hitbox.offsetY}:pending.legacyOffset;
    const x=this.body.position.x+offset.x*this.facing;
    const y=link.target.clearedCaptiveY(this,this.body.position.y+offset.y);
    this.scene.matter.body.setPosition(link.target.body,{x,y});this.scene.matter.body.setVelocity(link.target.body,{x:0,y:0});
    if(link.target.hitlagRemaining>0)link.target.hitlagPosition={x,y};
    this.captureAttachmentBypass=null;
  }
  commitCaptureAttachmentCandidate(link:CaptureAttachmentLink,result:Extract<CaptureAttachmentResult,{status:'paired'}>):boolean {
    // Re-resolve metadata and the live link at commit, not only at collection.
    const live=this.getCaptureAttachmentLink();
    if(!live||live.target!==link.target||live.captureId!==link.captureId||live.context!==link.context||
      live.captorReset!==link.captorReset||live.recipientReset!==link.recipientReset)return false;
    const fresh=this.resolveCaptureAttachmentCandidate([this.body.id,live.target.body.id],this.getPosition());
    if(!fresh||fresh.status!=='paired'||JSON.stringify(fresh)!==JSON.stringify(result))return false;
    this.scene.matter.body.setPosition(live.target.body,result.stage.recipientCentre);
    this.scene.matter.body.setVelocity(live.target.body,{x:0,y:0});
    if(live.target.hitlagRemaining>0)live.target.hitlagPosition={...result.stage.recipientCentre};
    live.target.facing=result.exact.recipientFacing;
    if(live.target.capturePresentation?.state.active)live.target.capturePresentation.state.facing=result.exact.recipientFacing;
    this.rememberCaptureAttachmentBypass(live);this.captureAttachmentDiagnostic=result;return true;
  }

  private donkeykongPunchConsumedFrame=-1;
  private donkeykongPunchFireFrame=-1;
  private sourcedGroundFrictionBackup:number|null=null;
  private restoreSourcedGroundFriction():void {
    if(this.sourcedGroundFrictionBackup!==null){this.body.friction=this.sourcedGroundFrictionBackup;this.sourcedGroundFrictionBackup=null;}
  }
  private authoredShieldPushTraction=0.65; // explicit beta calibration for identities without native donor
  private sourcedShieldPush:{speed:number;attacker:boolean}|null=null;
  private shieldPushApplied=0;
  /** Recoil for a sourced ordinary shield block; caller excludes parry/break. */
  armShieldBlockRecoil(damage:number,kind:import('./combat').ShieldAttackKind|undefined,targetX:number):void {
    const speed=computeShieldPushback({damage,kind}).attackerSpeed;
    this.sourcedShieldPush={speed:Math.sign(this.body.position.x-targetX)*speed,attacker:true};
  }
  private buriedState:BuriedState<NonNullable<Character['pendingKnockback']>>|null=null;
  getBuriedPresentationState(){const state=this.buriedState;return state?{phase:state.phase,framesElapsed:state.phase==='escaping'?12-state.escapeRemaining:state.age,facing:this.facing}:null;}
  /** Mash shake, dirt splashes and yellow flash while buried (render only; buriedPresentation.ts). */
  getBuriedEffects(){const state=this.buriedState;if(state?.phase!=='buried')return null;const last=state.mash.lastAccepted;
    return buriedEffects({initialFrames:state.initialFrames,age:state.age,mashReduction:state.mash.reduction,framesSinceMash:last?state.age-last.frame:null});}
  private pinBuriedLaunch(){this.pendingKnockback=null;this.launchVelocity=null;this.referenceLaunch=null;this.hitstunRemaining=0;this.tumbling=false;this.attackerHitlagVelocity={x:0,y:0};this.scene.matter.body.setVelocity(this.body,{x:0,y:0});}
  private packedBodyClock: PackedBodyState['clock'] = null;
  /** Presentation only: a finished action's remaining drawings while the fighter stays at rest (nextPackedBodyTail). */
  private packedBodyTail:PackedBodyState['tail']=null;
  /** The shared wall / wall-jump / ceiling tech (surfaceTech.ts). */
  private surfaceTech:SurfaceTechState|null=null;
  /** The shared committed ground recovery (stand, trip stand, techs, getup rolls); Pikachu runs pikachuGroundRecovery. */
  private groundRecovery:(NonNullable<PackedBodyState['committed']>&{duration:number;protectionFrames:number;travelDirection?:1|-1})|null=null;
  private packedCrouchPhase:PackedBodyState['crouchPhase']=null;
  private donkeykongTurnBrake:DonkeyKongTurnBrakeState|null=null;
  private donkeykongFootstoolPerformer:{framesElapsed:number;facing:1|-1;mini:boolean;entryFrame:number}|null=null;
  private donkeykongFootstoolRepeatCount=0;
  private donkeykongFootstoolCooldown=0;
  private donkeykongFootstoolCooldownEntryFrame=-1;
  private donkeykongLastAttackEndFrame=-1000;
  private pendingFootstoolPhantom=false;
  private itemAction:(ItemActionState&{entryFrame:number;entryFacing:1|-1})|null=null;
  private itemActionEntryFrame:number|null=null;
  private itemEating:RecoveryEatingState|null=null;
  private itemHealing:HealingState|null=null;
  private recoveryEvents:RecoveryTransactionEvent[]=[];
  private itemLockedInput:CharacterInput|null=null;
  private itemActionEvents:(ItemActionEvent&{action:ItemAction;plan:ItemActionPlan;entryFacing:1|-1;entryFrame:number})[]=[];
  private itemActionCompletions:{readonly plan:ItemActionPlan;readonly entryFacing:1|-1;readonly entryFrame:number;readonly exitFrame:number}[]=[];
  private lastDonkeyKongCarryHit: Pick<CharacterHitApplication,'reactionResisted'|'heavyItemDrop'> = {};
  private donkeykongHeavyItemHeld=false;
  private donkeykongHeavyCarry:DonkeyKongHeavyCarryState|null=null;
  private donkeykongHeavyCarryEntryFrame=-1;
  private donkeykongHeavyCarryStickX=0;
  private donkeykongHeavyDownFlickAge:number|null=null;
  private donkeykongHeavyDownHeld=false;
  private pendingDonkeyKongHeavyJump:{mini:boolean}|null=null;
  private donkeykongHeavyItemAction:(DonkeyKongHeavyItemState&{entryFrame:number})|null=null;
  private donkeykongHeavyItemEvents:(DonkeyKongHeavyItemEvent&{plan:DonkeyKongHeavyItemPlan;entryFacing:1|-1;entryFrame:number})[]=[];
  private clearDonkeyKongHeavyItemAction():void {this.donkeykongHeavyItemAction=null;this.donkeykongHeavyItemEvents=[];}
  private hasDonkeyKongHeavyAirPolicy():boolean {
    // NO_REAC/CLIFF_NONE is captured for SuperLift and ItemThrowHeavy. The
    // inherited ItemHeavyPickup pre body remains unavailable before attachment.
    return this.id==='donkeykong'&&(this.donkeykongHeavyItemHeld || (this.donkeykongHeavyItemAction!==null&&this.donkeykongHeavyItemAction.plan.action!=='pickup'));
  }
  private stepDonkeyKongHeavyCarryInput(input:CharacterInput):CharacterInput {
    if(!this.donkeykongHeavyItemHeld||this.donkeykongHeavyItemAction)return input;
    // A source resistance decision is not inferred from raw damage here. The
    // Scene owns held-item loss; reaction/capture still owns its input clock.
    if(this.hitstunRemaining>0||this.grabbedBy||this.buriedState)return input;
    if(!this.donkeykongHeavyCarry){this.donkeykongHeavyCarry=beginDonkeyKongHeavyCarry(this.isGrounded(),this.facing);this.donkeykongHeavyCarryEntryFrame=this.simulationInputFrame;}
    const down=(input.moveY??0)>=.6875;
    this.donkeykongHeavyDownFlickAge=down?(this.donkeykongHeavyDownHeld?(this.donkeykongHeavyDownFlickAge??0)+1:0):null;
    this.donkeykongHeavyDownHeld=down;this.donkeykongHeavyCarryStickX=input.moveX;
    if(fighterHeavyItemProfile(this.id).carry.groundOnly){
      this.donkeykongHeavyCarry=stepGroundOnlyHeavyCarry(this.donkeykongHeavyCarry,input.moveX);
    }else if(this.donkeykongHeavyCarryEntryFrame!==this.simulationInputFrame){
      const passableFloor=[...this.contactPairs.values()].some(pair=>this.isSupportPair(pair)&&
        (pair.bodyA===this.body?pair.bodyB:pair.bodyA).label===PLATFORM_LABELS.passThrough);
      const step=tickDonkeyKongHeavyCarry(this.donkeykongHeavyCarry,{holdingHeavy:true,grounded:this.isGrounded(),
        nativeStickX:input.moveX,nativeStickY:-(input.moveY??0),downFlickAge:this.donkeykongHeavyDownFlickAge,
        passableFloor,freshJump:input.jump&&!this.prevJumpHeld,jumpHeld:input.jump});
      this.donkeykongHeavyCarry=step.state;
      for(const event of step.events){
        if(event.kind==='reverse-facing')this.facing=event.facing;
        if(event.kind==='ground-jump')this.pendingDonkeyKongHeavyJump={mini:event.mini};
        if(event.kind==='pass-platform')this.dropThroughFramesRemaining=9;
      }
    }
    this.itemLockedInput=input;
    this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    return {...input,moveX:0,moveY:0,jump:false,attack:false,attackHeavy:false,special:false,grab:false,shield:false,dodge:false,appeal:false,dropThrough:false};
  }
  private stepDonkeyKongHeavyItemInput(input:CharacterInput):CharacterInput {
    const before=this.donkeykongHeavyItemAction;
    if(before){
      if(before.plan.action==='pickup'&&!this.isGrounded())this.clearDonkeyKongHeavyItemAction();
      else if(before.entryFrame!==this.simulationInputFrame){
        const step=tickDonkeyKongHeavyItemAction(before);
        this.donkeykongHeavyItemAction=step.state?{...step.state,entryFrame:before.entryFrame}:null;
        for(const event of step.events){
          if(event.kind==='reverse-facing')this.facing=event.facing;
          this.donkeykongHeavyItemEvents.push({...event,plan:before.plan,entryFacing:before.entryFacing,entryFrame:before.entryFrame});
        }
      }
    }
    if(!this.donkeykongHeavyItemAction)return input;
    this.itemLockedInput=input;
    // Jump intent was buffered from raw input before this action lock. An
    // up-throw keyboard press also contains jump (W); retire that intent here
    // so it cannot enter ordinary jumpsquat while the heavy callback is pending.
    this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    return {...input,moveX:this.isGrounded()?0:input.moveX,moveY:0,jump:false,attack:false,attackHeavy:false,special:false,grab:false,shield:false,dodge:false,appeal:false,dropThrough:false};
  }
  private clearItemAction():void {
    this.itemAction=null;this.itemActionEntryFrame=null;this.itemActionEvents=[];this.itemActionCompletions=[];this.clearDonkeyKongHeavyItemAction();
    this.donkeykongHeavyCarry=null;this.pendingDonkeyKongHeavyJump=null;
  }
  private stepItemInput(input:CharacterInput):CharacterInput {
    const before=this.itemAction;
    if(before){
      const airAction=before.plan.action.startsWith('throw-air-');
      const groundAction=before.plan.action!=='air-z-drop'&&!airAction;
      if((airAction&&this.isGrounded())||(groundAction&&!this.isGrounded()))this.clearItemAction();
      else if(before.entryFrame!==this.simulationInputFrame){
        const step=tickItemAction(before);
        this.itemAction=step.state?{...step.state,entryFrame:before.entryFrame,entryFacing:before.entryFacing}:null;
        if(!step.state){
          const plan=Object.freeze({...before.plan,
            ...(before.plan.throwParameters?{throwParameters:Object.freeze({...before.plan.throwParameters})}:{})});
          this.itemActionCompletions.push(Object.freeze({plan,entryFacing:before.entryFacing,entryFrame:before.entryFrame,exitFrame:this.simulationInputFrame}));
        }
        for(const event of step.events){
          if(event.kind==='reverse-facing')this.facing=event.facing;
          this.itemActionEvents.push({...event,action:before.plan.action,plan:before.plan,entryFacing:before.entryFacing,entryFrame:before.entryFrame});
        }
      }
    }
    if(this.itemActionEntryFrame!==null&&this.itemActionEntryFrame<this.simulationInputFrame)this.itemActionEntryFrame=null;
    if(!this.itemAction&&this.itemActionEntryFrame!==this.simulationInputFrame)return input;
    this.itemLockedInput=input;
    // The item action owns the body: a jump buffered from this step's raw input (a keyboard W is up
    // and jump) does not start a jump squat under the toss.
    this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    const walking=this.itemAction?.plan.action==='pickup-walking';
    return {...input,jump:false,attack:false,attackHeavy:false,special:false,grab:false,shield:false,dodge:false,appeal:false,
      moveX:this.isGrounded()&&!walking?0:input.moveX,moveY:0,dropThrough:false};
  }
  private isSurfaceTechLocking():boolean {
    return this.surfaceTech!==null&&!surfaceTechActionable(this.surfaceTech);
  }
  private readonly donkeykongAttackPoseConsumer=new DonkeyKongAttackCollisionPoseConsumer();
  /** Fresh intrinsic leaf hook; null means an explicit missing posed profile.
   * Existing fighters keep their current contact consumers and data. */
  protected notifySourceAerialLandingAdmitted(_receipt:{readonly frame:number;readonly generation:number;
    readonly moveId:string;readonly sourcePoseId:string|null;readonly facing:1|-1;readonly landingLagFrames:number}):void {}
  /** Source-owned intrinsic controllers may reserve raw input while using
   * ordinary shared movement. The raw latch is restored after the shared step
   * so a held button does not become a new press when the controller exits. */
  protected filterSourceIntrinsicInput(input:CharacterInput,_frame:number):CharacterInput { return input; }
  /** Narrow source arbitration after real landing/taunt counters advance.
   * No reducer clock is replayed here; legacy input is unchanged. */
  protected reserveSourceUpdatedControlInput(input:CharacterInput,_frame:number):CharacterInput{return input;}
  protected sourceSpecialJustPressed(input:CharacterInput):boolean {return input.special===true&&!this.prevSpecialHeld;}
  protected lockSourceIntrinsicInput(input:CharacterInput,airSteering=false):CharacterInput {
    this.itemLockedInput=input;this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    return {...input,moveX:airSteering?input.moveX:0,moveY:0,jump:false,attack:false,attackHeavy:false,
      special:false,shield:false,dodge:false,grab:false,appeal:false,dropThrough:false};
  }
  protected advanceSourceChainedAttack(nextId:string,preserveCharge=false):boolean {
    const previous=this.activeAttack;
    const accepted=this.advanceChainedAttack(nextId,preserveCharge);
    if(accepted&&preserveCharge&&previous&&this.activeAttack)
      this.activeAttack={...this.activeAttack,move:realizeLinkSmashFollowupCharge(previous.move,previous.chargeHeldFrames,this.activeAttack.move)};
    if(accepted)this.deferSourceAttackInitialTick();
    return accepted;
  }
  protected inheritSourceSmashFollowupCharge(previous:AttackMove,heldFrames:number|null):void {
    if(this.activeAttack)this.activeAttack={...this.activeAttack,
      move:realizeLinkSmashFollowupCharge(previous,heldFrames,this.activeAttack.move),chargeHeldFrames:heldFrames};
  }
  /** Fresh pre-tick continuation owns real age0 for this advancing input.
   * Generic after-tick chain transitions retain their existing clock. */
  protected deferSourceAttackInitialTick():void {if(this.activeAttack)this.activeAttack.holdInitialFrame=true;}
  protected moveIntrinsicSourceRoot(delta:{x:number;y:number}):void {
    if(![delta.x,delta.y].every(Number.isFinite))throw new Error('Intrinsic root displacement must be finite');
    const p=this.body.position,position={x:p.x+delta.x,y:p.y+delta.y};this.scene.matter.body.setPosition(this.body,position);
    if(this.hitlagPosition)this.hitlagPosition={...position};
  }
  private intrinsicSourceHitbox:MatterJS.BodyType|null=null;
  protected getIntrinsicSourceHitbox():MatterJS.BodyType|null {return this.intrinsicSourceHitbox;}
  protected clearIntrinsicSourceHitbox():void {
    if(this.intrinsicSourceHitbox)despawnHitbox(this.scene,this.intrinsicSourceHitbox);
    this.intrinsicSourceHitbox=null;
  }
  protected onIntrinsicSourceInterrupted():void {}
  protected getIntrinsicSourceLandingFrames():number|null {return null;}
  protected enterIntrinsicSourceHelpless(landingFrames:number):void {this.helpless=true;this.specialFallLandingFrames=landingFrames;}
  /** A fighter-owned action started: like any started action it ends tumble. */
  protected noteIntrinsicSourceActionStarted():void {this.clearTumbleForStartedAction();}
  /** An intrinsic action that owns the body's velocity replaces any retained launch, as an ordinary velocity-owning move does. */
  protected setIntrinsicSourceVelocity(velocity:{x:number;y:number}):void {this.clearReferenceLaunch();this.scene.matter.body.setVelocity(this.body,velocity);}
  protected syncIntrinsicSourceHitbox(move:AttackMove,hits:readonly import('./attacks').AttackCollisionHit[],facing:1|-1,
    attackInstance:object,hitGroup:object,rectangle:AttackMove['hitbox']|null=null):void {
    this.clearIntrinsicSourceHitbox();if(!rectangle&&!hits.length)return;
    const body=spawnHitbox(this.scene,{id:this.id,bodyId:this.body.id,position:this.body.position},
      rectangle?{...move,hitbox:rectangle,collisionHits:undefined}:{...move,collisionHits:hits},facing);
    body.plugin={...body.plugin,attackInstance,hitGroup,ownerAnchoredContact:true,postPhysicsContactOnly:true};
    this.intrinsicSourceHitbox=body;
  }
  notifyIntrinsicSourceContact(_moveId:string,_outcome:CharacterHitOutcome,_targetIndex?:number,_attackInstance?:object):void {}
  mayResolveIntrinsicSourceContact(_targetIndex:number,_attackInstance?:object):boolean {return true;}
  captureIntrinsicRuntimeState():unknown {return null;}
  restoreIntrinsicRuntimeState(_state:unknown):void {}
  private syncDonkeyKongAttackCollisionPose():void {
    const active=this.activeAttack;
    if(this.id!=='donkeykong'||!active?.hitboxBody)return;
    const pose=getPackedAttackCollisionPose(captureSimulationAnimation(this,0,false));
    this.donkeykongAttackPoseConsumer.sync(this.scene,active.hitboxBody,active.move,this.body.position,pose);
  }

  private readonly donkeykongCatchPoseConsumer=new DonkeyKongCatchCollisionPoseConsumer();
  private donkeykongCatchCollisionDiagnostic:DonkeyKongCatchCollisionDiagnostic|null=null;
  private syncDonkeyKongCatchCollisionPose():void {
    const sensor=this.grabHitboxBody;
    if(this.id!=='donkeykong'||!sensor||this.grabState.name!=='whiffActive'){
      this.donkeykongCatchCollisionDiagnostic=null;return;
    }
    const selection=getPackedCatchCollisionPose(captureSimulationAnimation(this,0,false));
    if(!selection)return;
    this.donkeykongCatchCollisionDiagnostic=this.donkeykongCatchPoseConsumer.sync(
      this.scene,sensor,this.grabVariantSpec??this.grabSpec!,this.body.position,selection);
  }
  /** Geometry/fallback observations only; reading never advances a source clock. */
  getDonkeyKongCatchCollisionDiagnostic():DonkeyKongCatchCollisionDiagnostic|null {
    const d=this.donkeykongCatchCollisionDiagnostic;
    return d?{...d,sourceRegionIds:[...d.sourceRegionIds],providedRegionIds:[...d.providedRegionIds]}:null;
  }

  /** Where a DK recipient is in its captor's Cargo Throw: carried (past the cargo lift) or through a throw until its release. */
  private getCargoRecipientState(): PackedBodyState['cargoRecipient'] {
    const captor=this.grabbedBy;
    if(!captor||!this.capturePresentation?.state.active||!captor.grabState.active?.cargo)return null;
    if(captor.grabState.name==='throwing'){const t=captor.getThrowPresentationState();return t?.phase==='throwing'?{throw:{direction:t.direction,age:t.framesElapsed},age:t.framesElapsed}:null;}
    if(captor.grabState.name!=='holding'||captor.sourceCargoEntry||captor.grabState.active.cargoStartupRemaining)return null;
    // Carried age = the captor's cargo hold age past its entry motion (the lift keeps the recipient on `captured`, which runs on the capture
    // age; a captured body's own clock does not run). The hold age counts from the end of the startup, the entry motion spans startup + lift.
    const cargo=captor.grabSpec?.cargo,lift=cargo?.entryMotionFrames===undefined?0:cargo.entryMotionFrames-cargo.startupFrames;
    return {throw:null,age:Math.max(0,captor.grabState.active.framesElapsed-lift)};
  }

  getPackedBodyState(): PackedBodyState {
    const punch=this.chargingSpecial?.donkeykongPunch;
    const carry=this.donkeykongHeavyCarry;
    // Native common gait consumer is unavailable. Retained native .5/.75
    // parameter ratios support this adapter, not native gait/rate parity.
    const heavyPhase=carry?.phase==='walk'?selectDonkeyKongHeavyWalkGait(this.body.velocity.x,this.resolvedLocomotionTuning.walkMaxSpeed*(this.grabSpec?.cargo?.walkMultiplier??1)):carry?.phase==='pass'?'fall':carry?.phase;
    const carryBody=!carry?null:fighterHeavyItemProfile(this.id).carry.groundOnly?groundOnlyHeavyCarryMotion(carry):
      heavyPhase?{motion:getDonkeyKongHeavyCarryMotion(heavyPhase).motion,age:carry.age}:null;
    const heavyItem=this.donkeykongHeavyItemAction?{sheet:this.donkeykongHeavyItemAction.plan.motion,age:this.donkeykongHeavyItemAction.framesElapsed,facing:this.donkeykongHeavyItemAction.facing}:
      carry&&carryBody?{sheet:carryBody.motion,age:carryBody.age,facing:carry.facing,carry:true as const}:null;
    return {pummel:this.sourceGrabPummel&&this.sourceGrabLinkValid(this.sourceGrabPummel.target,this.sourceGrabPummel.captureId,this.sourceGrabPummel.targetGeneration)?{framesElapsed:this.sourceGrabPummel.framesElapsed,facing:this.sourceGrabPummel.facing}:null,
      heldAfterPummel:this.sourceGrabHeld&&this.sourceGrabLinkValid(this.sourceGrabHeld.target,this.sourceGrabHeld.captureId,this.sourceGrabHeld.targetGeneration)?{facing:this.sourceGrabHeld.facing}:null,
      cargoRecipient:this.getCargoRecipientState(),cargoEntry:this.sourceCargoEntry&&this.sourceGrabLinkValid(this.sourceCargoEntry.target,this.sourceCargoEntry.captureId,this.sourceCargoEntry.targetGeneration)?{framesElapsed:this.sourceCargoEntry.framesElapsed,facing:this.sourceCargoEntry.facing}:null,heavyItem,clock:this.packedBodyClock,tail:this.packedBodyTail,committed:this.groundRecovery,footstoolPerformer:this.donkeykongFootstoolPerformer,surfaceTech:this.surfaceTech?{...this.surfaceTech,protected:surfaceTechProtected(this.surfaceTech)}:null,punch:punch?{phase:punch.state.phase,age:punch.state.phase==='cancel'?punch.state.phaseAge-1:punch.state.phaseAge,grounded:punch.sourceGrounded,facing:punch.facing,jumpCancel:punch.state.cancelIntent==='air-jump'}:null,
      crouchPhase:this.packedCrouchPhase,turnBrake:this.donkeykongTurnBrake?{...this.donkeykongTurnBrake,facing:donkeyKongTurnBrakeFacing(this.donkeykongTurnBrake)}:null,
      itemCue:this.getRecoveryPresentation()??this.getHammerPresentation()??(this.itemAction?{sheet:itemActionSheet(this.itemAction.plan),age:this.itemAction.framesElapsed,facing:this.itemAction.facing}:
        packedBodyProfile(this.id)!==null&&this.equippedItem!==null&&this.isGrounded()&&this.locomotionState.name==='standing'&&this.canPresentUncommittedBody()?{sheet:'item_carry',age:this.heldItemCarryAge,facing:this.facing}:null),
      airDodgeDirection:this.airDodgeBurst??{x:0,y:0},fastFall:this.fastFallLatched,stickX:this.prevMoveX,intrinsic:this.getPackedIntrinsicBody()};
  }
  /** A fighter-owned special's phase motion for the packed body (none by default). */
  protected getPackedIntrinsicBody():PackedBodyState['intrinsic']{return null;}
  private beginGroundRecovery(sheet:string,row:GroundRecoveryRow,travelDirection?:1|-1):void {
    this.groundRecovery={sheet,duration:row.duration,protectionFrames:row.intangibleFrames,framesElapsed:0,facing:this.facing,...(travelDirection===undefined?{}:{travelDirection})};
    this.reactionPresentation=null;this.tripped=false;this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    this.scene.matter.body.setVelocity(this.body,{x:0,y:0});
  }
  private pikachuSpecialRuntime: PikachuSpecialRuntime | null = null;
  private pikachuSpecialStick = { x: 0, y: 0 };
  private pikachuSpecialHeld = false;

  private getPikachuSpecialRuntime(): PikachuSpecialRuntime {
    return this.pikachuSpecialRuntime ??= new PikachuSpecialRuntime({ id: this.id, body: this.body,
      scene: this.scene, grounded: () => this.isGrounded(),
      // These status-owned velocities replace launch kinetics. Keeping a
      // capped launch gravity energy would cancel every later world dose,
      // even after Quick Attack finishes and its own gravity is released.
      setVelocity: vector => this.setIntrinsicSourceVelocity(vector),
      facing: value => { this.facing = value; },
      finish: (helpless, landingFrames) => {
        this.specialFallAirSpeedMultiplier = helpless && this.activeAttack?.move.pikachuSpecial?.kind === 'quickAttack' ? 0.4 : 1;
        this.activeAttack = null; this.cooldownRemaining = 0;
        if (helpless) { this.helpless = true; this.specialFallLandingFrames = landingFrames ?? null; }
      },
      replace: (move, frame) => { if (this.activeAttack) { this.activeAttack.move = move; this.activeAttack.framesElapsed = frame; } return this.activeAttack; },
    });
  }

  /** Detached source objects tick with the match clock, independently of owner hitlag. */
  tickPikachuSpecialEntities(surfaces: readonly SpecialSurface[], targets: readonly SpecialProjectileTarget[] = []): void {
    this.pikachuSpecialRuntime?.tickEntities(kind => {
      const move = [...this.attacks.values()].find(m => m.pikachuSpecial?.kind === kind);
      if (!move) throw new Error(`Missing registered Pikachu entity owner ${kind}`);
      return move;
    }, surfaces, targets);
  }
  getPikachuSpecialVisuals() { return this.pikachuSpecialRuntime?.visuals() ?? []; }
  /** Stop the lost-stock actor status; detached entities retain their own lifetime. */
  interruptPikachuSpecialAction(): void {
    if (this.activeAttack?.move.pikachuSpecial) this.cancelAttack();
  }
  getPikachuSpecialState() { return this.pikachuSpecialRuntime?.snapshot() ?? null; }
  isSourceIntrinsicJostleDisabled():boolean{return false;}
  protected sourceIntrinsicLedgePolicy():{front:boolean;back:boolean;allowRise:boolean}|null{return null;}
  isPikachuSpecialJostleDisabled(): boolean {
    const a = this.getPikachuSpecialState();
    if (a?.kind === 'quickAttack') return a.frame >= 14 && a.frame < a.firstBurstEnd
      || a.second && a.frame >= a.secondBurstStart && a.frame < a.secondBurstEnd;
    if (a?.kind === 'skullBash') return this.activeAttack !== null && this.activeAttack.framesElapsed >= 17 && this.activeAttack.framesElapsed <= 51;
    return false;
  }
  notifyPikachuSpecialContact(token: object | undefined, outcome: string): void {
    this.pikachuSpecialRuntime?.notifyContact(token, outcome);
  }
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
  private tuning: Required<Omit<CharacterTuning, 'locomotion' | 'referenceLaunch'>> & Pick<CharacterTuning, 'referenceLaunch'> & AirMovementTuning & LandingTuning & {
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
  private shieldPresentation: { kind: ShieldPresentationState['kind']; totalFrames: number | null; facing: 1 | -1; holdEntryAge: number } | null = null;
  /** Guard-off commitment, including its initial five-step parry window. */
  private shieldReleaseRemaining = 0;
  private shieldReleaseCanParry = false;
  private shieldParryBlockRemaining = 0;
  private shieldParryStunRemaining = 0;
  private shieldParryProtected = false;

  /**
   * STALE-MOVE queue — the ids of this fighter's most-recently-LANDED
   * moves (oldest first, newest at the end), capped at
   * {@link STALE_QUEUE_SIZE}. Drives stale-move negation: a move already
   * present N times deals less damage / knockback (see
   * `combat.computeStaleMultiplier`). The MatchScene hit callback reads
   * the occurrence count via {@link registerLandedMove} the instant a hit
   * connects. Attacker-side state; reset on respawn.
   */
  private staleMoveQueue: StaleEntry[] = [];

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

  /** Shared dodge-use count behind Ultimate dodge staleness (`dodgeState.ts`); per life. */
  private dodgeStaleness: DodgeStaleness = createDodgeStaleness();

  /** Frames airborne since last grounded (SmashWiki Edge airtime `a`); 0 on the ground. */
  private airtimeFrames = 0;

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
  private resolvedLocomotionTuning: ResolvedLocomotionTuning;
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
  private prevAppealHeld = false;
  private simulationInputFrame = 0;
  private sourceGrabAdmissionFrame=0;private sourceCaptureAdmissionFrame=0;private sourceCutAdmissionFrame=0;private sourceHeldAdmissionFrame=0;
  private lastCaptureInput: CharacterInput = {moveX: 0, jump: false};
  private ultimateCaptureBudget: {entryPercent: number; initialFrames: number; mash: CaptureMashState}|null = null;
  private ultimateCargoBudget: {initialFrames:number;mash:CaptureMashState}|null = null;
  private postReleaseGrabImmunity = {remaining: 0, lastFrame: -1};
  private grabReleasePresentation: {role: 'captor'|'target'; framesElapsed: number; lastFrame: number;
    facing: 1|-1; groundedAtEntry: boolean}|null = null;

  private tauntSpec: TauntSet | null = null;
  private tauntPresentation: {kind: TauntKind; framesElapsed: number; facing: 1 | -1; entryFrame:number} | null = null;

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
  private grabVariantSpec: GrabSpec | null = null;
  private grabPresentationVariant: 'standing' | 'dash' | 'pivot' = 'standing';
  private pendingPummelFrames: number | null = null;
  private pummelDamageTransaction:GrabDamageTransaction|null=null;
  private sourceGrabPummel:(BoundGrabSourcePresentation&{damageDelivered:boolean})|null=null;
  private sourceGrabHeld:BoundGrabSourcePresentation|null=null;
  private sourceCargoEntry:BoundGrabSourcePresentation|null=null;
  private clearGrabSourcePresentation():void {
    this.sourceGrabPummel=null;this.sourceGrabHeld=null;this.sourceCargoEntry=null;
    this.pendingPummelFrames=null;this.pummelDamageTransaction=null;
  }
  private sourceGrabLinkValid(target:Character,captureId:number,targetGeneration:number):boolean {
    return this.grabTarget===target&&target.grabbedBy===this&&target.captureSequence===captureId&&
      target.positionResetGeneration===targetGeneration;
  }
  private advanceGrabSourcePresentation():void {
    const p=this.sourceGrabPummel;
    if(p){
      if(this.grabState.name!=='holding'||this.grabState.active?.cargo||!this.sourceGrabLinkValid(p.target,p.captureId,p.targetGeneration))this.sourceGrabPummel=null;
      else {
        const clock=stepGrabSourcePresentation(p,this.simulationInputFrame,this.grabSpec!.pummel!.motionFrames!);
        this.sourceGrabPummel=clock?{...p,...clock}:null;
        if(!clock){this.pummelDamageTransaction=null;this.sourceHeldAdmissionFrame=this.simulationInputFrame;this.sourceGrabHeld={...p,...beginGrabSourcePresentation(this.simulationInputFrame,p.facing)};}
      }
    }
    if(this.sourceGrabHeld){const p=this.sourceGrabHeld;const clock=this.grabState.name==='holding'&&Boolean(this.grabState.active?.cargo)===p.cargo&&this.sourceGrabLinkValid(p.target,p.captureId,p.targetGeneration)?stepGrabSourcePresentation(p,this.simulationInputFrame,Number.MAX_SAFE_INTEGER):null;this.sourceGrabHeld=clock?{...p,...clock}:null;}
    if(this.sourceCargoEntry){
      const before=this.sourceCargoEntry;
      const valid=this.grabState.name==='holding'&&this.grabState.active?.cargo&&this.sourceGrabLinkValid(before.target,before.captureId,before.targetGeneration);
      const clock=valid?stepGrabSourcePresentation(before,this.simulationInputFrame,this.grabSpec!.cargo!.entryMotionFrames!):null;
      this.sourceCargoEntry=clock?{...before,...clock}:null;
      if(valid&&!clock)this.sourceGrabHeld={...before,...beginGrabSourcePresentation(this.simulationInputFrame,before.facing)};
    }
  }
  private beginCapturedDamageTransaction(queueMoveId:string,kind:string):GrabDamageTransaction|null {
    const target=this.grabTarget;
    if(!target||target.grabbedBy!==this)return null;
    return beginGrabDamageTransaction({queueMoveId,staleMultiplier:this.getStaleMultiplier(queueMoveId),
      transactionKey:`${this.slotIndex}:${this.positionResetGeneration}:${target.slotIndex}:${target.positionResetGeneration}:${target.captureSequence}:${kind}:${this.simulationInputFrame}`,
      actorGeneration:this.positionResetGeneration,targetGeneration:target.positionResetGeneration,
      captureId:target.captureSequence,entryFrame:this.simulationInputFrame});
  }
  private capturedDamageTransactionValid(transaction:GrabDamageTransaction|null,target:Character):transaction is GrabDamageTransaction {
    return target.grabbedBy===this&&grabDamageTransactionMatches(transaction,{actorGeneration:this.positionResetGeneration,
      targetGeneration:target.positionResetGeneration,captureId:target.captureSequence});
  }
  private commitCapturedDamageTransaction(transaction:GrabDamageTransaction,damageApplied:number):GrabDamageTransaction {
    const commit=commitGrabDamageTransaction(transaction,damageApplied);
    if(commit.enqueue)this.registerLandedMove(transaction.queueMoveId);
    return commit.state;
  }
  getCapturedDamageSource(reason:'pummel'|'throw-pre-hit'){
    const target=this.grabTarget,transaction=reason==='pummel'?this.pummelDamageTransaction:this.throwPresentation?.damageTransaction??null;
    if(!target||!this.capturedDamageTransactionValid(transaction,target)||!this.grabSpec||
      reason==='pummel'&&this.sourceGrabPummel===null&&this.pendingPummelFrames===null)return null;
    const direction=this.grabState.active?.throwDirection;
    const baseDamage=reason==='pummel'?this.grabSpec.pummel?.damage:direction?
      getThrowByDirection(this.getCurrentThrowSet(this.grabState),direction).heldTargetHits?.find(row=>row.frame===this.grabState.active?.framesElapsed)?.damage:undefined;
    return baseDamage===undefined?null:{baseDamage,staleMultiplier:transaction.staleMultiplier,queueMoveId:transaction.queueMoveId,
      transactionKey:transaction.transactionKey,captureId:transaction.captureId,entryFrame:transaction.entryFrame};
  }
  private deliverSourcePummel():void {
    const p=this.sourceGrabPummel,spec=this.grabSpec?.pummel;
    if(!p||!spec||p.damageDelivered||p.framesElapsed<(spec.startupFrames??0)||!this.sourceGrabLinkValid(p.target,p.captureId,p.targetGeneration))return;
    const transaction=this.pummelDamageTransaction;
    if(!this.capturedDamageTransactionValid(transaction,p.target))return;
    p.damageDelivered=true;
    const beforeDamage=p.target.getDamagePercent();
    const freeze=spec.hitlagFrames??computeHitlag({damage:spec.damage*transaction.staleMultiplier,targetPercent:p.target.getDamagePercent(),multiplier:spec.hitlagMultiplier,electricCollision:spec.electricCollision});
    p.target.addDamage(spec.damage*transaction.staleMultiplier,'pummel',this.slotIndex);
    this.pummelDamageTransaction=this.commitCapturedDamageTransaction(transaction,p.target.getDamagePercent()-beforeDamage);
    p.target.armAttackerHitlag(freeze);this.armAttackerHitlag(freeze);
    if(this.grabState.active)this.grabState={...this.grabState,active:{...this.grabState.active,pummelCooldownRemaining:Math.max(0,spec.cooldownFrames-freeze)}};
  }

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
  private throwReleaseInvincible = false;
  private captureSequence = 0;
  private captureEventSequence = 0;
  private capturePresentation: { state: CapturePresentationState; captor: Character } | null = null;
  private sourceCaptureMotionFamily:(AuthoredCaptureMotionFamily&{captureId:number;generation:number;captorGeneration:number})|null=null;

  /** Reference to the live target this character is grabbing (mirror of `grabbedBy`). */
  private grabTarget: Character | null = null;

  /**
   * AC 60403 Sub-AC 3 — live ledge-hang state machine. Tracks whether
   * the fighter is currently grabbing a ledge, climbing up, or in the
   * post-release tether cooldown. Advanced once per fixed step from
   * inside {@link applyInput}.
   */
  private ledgeHangState: LedgeHangState;
  isSourceTerrainBypassControlled(){return this.finalSmashControl?.terrainBypass===true||this.ledgeJumpClearance!==null;}
  /** Ledge jump (cliff_jump): the body rises through the corner it hung from, so
   * terrain is ignored until its bottom clears that corner, it falls, or it is
   * interrupted. Shared by every fighter that uses the generic ledge jump. */
  private ledgeJumpClearance:{originalMask:number;cornerY:number}|null=null;
  private beginLedgeJumpClearance(cornerY:number):void {
    this.endLedgeJumpClearance();
    this.ledgeJumpClearance={originalMask:this.body.collisionFilter.mask,cornerY};
    this.body.collisionFilter.mask&=~(COLLISION_CATEGORIES.PLATFORM_SOLID|COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH);
  }
  private endLedgeJumpClearance():void {
    const clearance=this.ledgeJumpClearance;if(!clearance)return;
    this.body.collisionFilter.mask=clearance.originalMask;this.ledgeJumpClearance=null;
  }
  private tickLedgeJumpClearance():void {
    const clearance=this.ledgeJumpClearance;if(!clearance)return;
    if(this.body.position.y+this.tuning.height/2<=clearance.cornerY||this.body.velocity.y>=0||this.hitstunRemaining>0||this.pendingKnockback||
      this.grabbedBy||this.finalSmashControl)this.endLedgeJumpClearance();
  }

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

  private readonly scene: PhysicsHost;

  /** -1 = left, 1 = right. Ground turns and explicit actions own facing. */
  private facing: 1 | -1 = 1;

  /**
   * Directional AIR-DODGE state. `airDodgeBurst` is the (decaying) velocity
   * applied during an air-dodge's active phase when a stick direction was held
   * at the press (null = neutral / in-place stall). `airDodgeUsed` enforces ONE
   * directional air-dodge per airtime (reset on land / respawn) so it can't be
   * chained into infinite recovery. See {@link AIRDODGE_BURST_SPEED}.
   */
  private airDodgeBurst: { x: number; y: number } | null = null;
  private airDodgeGravityVelocityY = 0;
  private airDodgeUsed = false;

  /**
   * Countdown for an in-flight TAP-JUMP BUFFER (see {@link TAP_JUMP_BUFFER_FRAMES}).
   * Set when an ambiguous up+jump press is held back to let a follow-up attack
   * convert it to an up-attack; decremented each frame; fires the jump at 0, or
   * is dropped to 0 the moment an attack press (or a state change) pre-empts it.
   */
  private tapJumpBufferFrames = 0;
  private jumpInputBufferFrames = 0;
  private jumpsquatRemaining = 0;
  private jumpsquatShortHop = false;
  /** Pikachu beta jump entry orientation; stick direction is sampled at takeoff. */
  private jumpsquatFacing: 1 | -1 | null = null;
  /**
   * Input frame of the latest takeoff impulse (ground jump, air jump, wall
   * bounce, footstool). On that step Matter has not yet separated the body
   * from its support, so {@link isGrounded} still reads true; an action
   * started that step must start airborne (see {@link isGroundedForActionStart}).
   */
  private takeoffInputFrame: number | null = null;
  private shortHopRising = false;
  /** A fresh air jump can have a different rise arc from the ground jump. */
  private airJumpRising = false;
  private readonly donkeykongOrdinaryVertical: DonkeyKongOrdinaryVerticalProfile | null;
  /** Only normal input ticks consume an opening sample; hitlag pauses it. */
  private donkeykongFullHopStep: number | null = null;
  /** applyInput supplied total DK gravity; cancel the actual world dose once. */
  private donkeykongOrdinaryVerticalTick = false;
  /** Set when this tick prescribed an opening sample: the ordinary velocity the
   * body carries out of it (samples are displacements, not inheritable speed). */
  private donkeykongOpeningCarryY:number|null=null;
  /** Entry scaling must precede this tick's ordinary gravity/curve shaping. */
  private donkeykongOrdinaryEntryVelocityY:number|null=null;

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
  private jumpPresentation: {
    kind: 'ground' | 'air' | 'ledge'; facing: 1 | -1; moveX: number;velocityX:number; shortHop: boolean; framesElapsed: number;
  } | null = null;
  private ordinaryPresentation: {
    sheet: 'idle' | 'walk' | 'fall' | 'fall_special'; framesElapsed: number;
  } | null = null;
  private pikachuTurnBrake: PikachuTurnBrakeState | null = null;
  private crouchPresentation: { framesElapsed: number; facing: 1 | -1 } | null = null;
  private pikachuCrouchCrawl: PikachuCrouchCrawlState | null = null;
  private reactionPresentation: ReactionPresentationState | null = null;
  private recoveryReaction: { origin: Exclude<ReactionPresentationState['origin'], null>; facing: 1 | -1 } | null = null;
  private reactionCue: ReactionPresentationState | null = null;
  private pikachuGroundRecovery: PikachuGroundRecovery | null = null;
  private surfaceTechGravityRestore: boolean | null = null;
  private pikachuAuxiliaryAir: {sheet:'wall_jump'|'footstool_jump';framesElapsed:number;facing:1|-1} | null = null;
  private pikachuLedgeJump: (PikachuLedgeJump & {candidate:LedgeCandidate;previousOffset:{x:number;y:number};previousCorner:{x:number;y:number}})|null=null;
  private pikachuLastGravityDose=0;
  private pikachuLedgeFlightHitlagRelease=false;
  /** WaitItem loop age while an item is held (resets on pickup). */
  private heldItemCarryAge=0;
  private pikachuRespawnPresentation: {framesElapsed:number;facing:1|-1} | null = null;
  /** Ultimate revival platform: held at the spawn point until a dismount input or REVIVAL_PLATFORM_MAX_FRAMES. */
  private revivalPlatform: {framesElapsed:number;x:number;y:number} | null = null;
  private pikachuWallBounceContact: object | null = null;
  private pendingFootstoolJump = false;
  private footstoolRecipient: {framesElapsed:number;grounded:boolean;facing:1|-1;entryFrame:number} | null = null;
  private footstoolMini: {basis:number;framesElapsed:number;cut:boolean} | null = null;
  private sourceLinkFootstool:{presentation:LinkFootstoolBodyPresentation;entryFrame:number;lastFrame:number;generation:number;mini:boolean;phantom:boolean;
    contact:{jumperIndex:number;jumperGeneration:number;recipientIndex:number;recipientGeneration:number}|null}|null=null;
  private sourceLinkFootstoolPendingContact:{jumperIndex:number;jumperGeneration:number;recipientIndex:number;recipientGeneration:number}|null=null;
  private sourceLinkFootstoolRepeatCount=0;
  private sourceLinkFootstoolCooldown=0;
  private sourceLinkFootstoolCooldownEntryFrame=-1;
  private sourceLinkFootstoolRecipientSide:'front'|'back'|null=null;
  private pikachuFootstoolVisual: {x:number;y:number;age:number;entryFrame:number} | null = null;
  private throwRootMotionApplied = false;
  private pikachuLedgeAttachment: {
    candidate: LedgeCandidate; attached: boolean;
    ignoredPairs: Map<SupportPair, boolean | undefined>;
  } | null = null;
  private ledgeAttackAttachment: {
    move: AttackMove; candidate: LedgeCandidate; facing: 1 | -1;
    frame: number; attached: boolean; corner: {x: number; y: number};
    ignoredPairs: Map<SupportPair, boolean | undefined>;
  } | null = null;
  private throwPresentation: {
    direction: ThrowDirection; facing: 1 | -1; entryFrame:number|null; releaseElapsed: number | null; recoveryAtRelease: number;
    cargo?:boolean;airborne?:boolean;damageTransaction:GrabDamageTransaction|null;
  } | null = null;

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
   * The held item, as its use table plus the ammo/lifecycle gate. Set by the
   * inventory on pickup and cleared on every release. The attack dispatch
   * asks {@link resolveItemInput} whether it replaces the classified press.
   */
  private equippedItem: HeldItemHandle | null = null;

  /**
   * A shooting item's fire session (itemShooting.ts): the upper body fires while the legs keep walking / jumping
   * (SmashWiki: shooting items can be used while running and jumping). Not an attack: no melee hitbox, no attack lock.
   */
  private itemShooting: { readonly spec: ShootingSpec; state: ShootingState } | null = null;
  /** Steps on the shooting legs' walk loop / since landing while shooting (presentation clocks). */
  private shootLegsWalkAge = 0;
  private shootLandingAge: number | null = null;
  /** Item shots this step (Star Rod stars, shooting items' shots); MatchScene spawns and drains them. */
  private pendingItemShots: { shot: ItemShot; x: number; y: number; facing: 1 | -1 }[] = [];

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
  /** Explicit saved source-slot identity; existing subclass side routes remain owned by their class. */
  private sideSpecialId:string|null=null;

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
    /** Source option budget latched from the grab count, independent of later ground contact. */
    ledgeProtectionFrames?: number;
    /** A source ledge action starts before tickAttack in the same input call. */
    holdInitialFrame?: boolean;
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

  private offensiveActionBuffer: {
    readonly kind: 'attack' | 'heavy' | 'special';
    remaining: number;
    readonly moveX: number;
    readonly moveY: number;
    readonly facing: 1 | -1;
    /** moveX / moveY hold a right-stick attack direction, not the left stick. */
    readonly fromStick: boolean;
  } | null = null;

  private donkeykongJabContinuation:DonkeyKongJabContinuation|null=null;
  private donkeykongJabContinuationEligibleStep=false;
  private donkeykongJabContinuationFreshAttackStep=false;

  private canAdvanceJab(move:AttackMoveWithAnimation,elapsed:number):boolean{
    const source=this.id==='donkeykong'?donkeyKongJabCanAdvance(move,elapsed):null;
    return source===null?elapsed>=(move.jabChain?.advanceWindowStart??move.startupFrames)
      :source&&this.donkeykongJabContinuationEligibleStep;
  }

  /** Observation only: no sensor or input lock belongs to this source tail. */
  getDonkeyKongJabContinuation(){
    const s=this.donkeykongJabContinuation;
    return s?{sourceMoveId:s.move.id,nextId:s.move.jabChain!.nextId,sourceAge:s.sourceAge,
      entryFacing:s.entryFacing,resetGeneration:s.resetGeneration,lastFrame:s.lastFrame}:null;
  }

  private prepareDonkeyKongJabContinuation(input:CharacterInput):void{
    if(this.id!=='donkeykong')return;
    this.donkeykongJabContinuationFreshAttackStep=input.attack===true&&!this.prevAttackHeld;
    // Neutral-only continuation is deliberately separate from directional
    // normal dispatch. Any other intent/status retires the tail, even frozen.
    this.donkeykongJabContinuationEligibleStep=this.isGrounded()&&
      input.moveX===0&&(input.moveY??0)===0&&!input.jump&&!input.attackHeavy&&!input.special&&
      !input.shield&&!input.dodge&&!input.grab&&!input.appeal&&!input.dropThrough&&
      this.grabbedBy===null&&this.hitstunRemaining===0&&!this.buriedState&&!this.helpless&&
      !this.donkeykongHeavyItemHeld&&!this.donkeykongHeavyItemAction&&!this.itemAction&&
      this.equippedItem===null&&this.chargingSpecial===null&&this.chargingSmash===null&&
      this.shieldState.name==='idle'&&this.shieldReleaseRemaining===0&&!this.shieldParryProtected&&
      !isGrabActing(this.grabState)&&!isDodgeActing(this.dodgeState)&&!isLedgeLockingInput(this.ledgeHangState)&&
      !this.surfaceTech&&!this.groundRecovery&&!this.footstoolRecipient&&!this.tauntPresentation&&
      this.jumpsquatRemaining===0&&!this.jumpPresentation&&!this.pendingFootstoolJump;
    this.donkeykongJabContinuation=tickDonkeyKongJabContinuation(this.donkeykongJabContinuation,{
      frame:this.simulationInputFrame,resetGeneration:this.positionResetGeneration,
      interrupted:!this.donkeykongJabContinuationEligibleStep||this.activeAttack!==null,
      frozen:this.hitlagRemaining>0,
    });
  }

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
    entryRemaining?: number;
    donkeykongPunch?:{state:DonkeyKongPunchState;facing:1|-1;sourceGrounded:boolean;cancelInput:{x:number;y:number}|null};
    groundedUpSpecial?: {
      move: AttackMoveWithAnimation;
      facing: 1 | -1;
      startupElapsed: number;
      holdFrame: number;
    };
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
    startupElapsed?: number;
    holdFrame?: number;
    facing: 1 | -1;
    framesHeld: number;
    maxFrames: number;
    maxHoldFrames?: number;
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
  /**
   * Mash-repeat bookkeeping for a `'shockwave'` down special (Hand Slap):
   * one entry per activation, reset when the move starts.
   */
  private shockwaveRepeat: { moveId: string; queued: number; repeats: number } | null = null;

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
    objectId: number;
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
    // Spawned objects obey gravity by default: a placed bomb/mine falls until
    // it rests on a platform surface below it. `vy` integrates downward;
    // `landed` latches once it touches down (or is placed on the ground).
    vy: number;
    landed: boolean;
    // True for a timed bomb (detonates on a fuse); false for a contact mine.
    fused: boolean;
    // Timed-bomb extension (Samus): self-bounce velocity applied to the placer
    // on detonation (null = none / contact-mine trap).
    selfBounceVelocity: number | null;
    // True once a fused bomb has detonated + applied its self-bounce, so the
    // bounce is a one-shot even if the blast sensor lingers a few frames.
    detonated: boolean;
    vx: number;
    launchAwayFromSource?: boolean;
    hitlagMultiplier?: number;
    sdiMultiplier?: number;
  }> = [];
  private nextTrapObjectId = 0;

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
   * stage" lockout. Cleared on landing, ledge catch, damage, and respawn.
   */
  private helpless = false;
  /** Source special-fall limit; ordinary recoveries retain the default multiplier. */
  private specialFallAirSpeedMultiplier = 1;
  /** Authored recovery retained after an aerial special ends in special fall. */
  private specialFallLandingFrames: number | null = null;

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

  /** Aerial landing recovery locks all actions; touchdown is its first step. */
  private landingRecovery = false;
  // Separate from attack cooldown: a normal or dodge landing must not prolong defense
  // commitment to the cooldown of an already completed move.
  private ordinaryLandingRemaining = 0;
  private terminalFallFrames = 0;
  private pendingOrdinaryLandingFrames: number | null = null;
  private pendingOrdinaryLandingKind: 'soft' | 'hard' | null = null;
  private landingPresentation: { kind: 'soft' | 'hard' | 'special' | 'air-dodge' | 'directional-air-dodge' | 'aerial';
    totalFrames: number; moveId?: string;sourcePoseId?:string;entryFrame?:number;facing?:1|-1 } | null = null;

  /** An actionable aerial animation may retain its landing flag briefly. */
  private aerialLandingContext: { move: AerialMove; framesElapsed: number; facing: 1 | -1 } | null = null;
  /** Identity of the automatic nested action; landing recovery owns its exit. */
  private landingAttackInstance: object | null = null;
  /** Its first active step is elapsed0 rather than a pre-incremented frame1. */
  private landingAttackActivationPending = false;

  /**
   * Accumulated damage percent (Sub-AC 4.1). Starts at 0; each hit
   * pushes it up by the move's `damage` value (clamped at
   * `MAX_DAMAGE_PERCENT`). Drives knockback magnitude — heavier hits
   * land harder when the target's percent is already high.
   */
  private damagePercent = 0;

  /**
   * Multiplier on percent damage this fighter takes. The match sets Ultimate's 1v1 multiplier
   * (`match/oneOnOneDamage.ts`); knockback, hitlag, hitstun and status durations keep reading the
   * unmultiplied damage (SmashWiki 1v1 multiplier). Healing is never scaled.
   */
  private damageTakenMultiplier = 1;

  /** Mash inputs read while shield-break stunned; null outside the broken state. */
  private shieldBreakMash: CaptureMashState | null = null;

  /**
   * Post-shieldstun shield-grab delay. SmashWiki Shield grab (Ultimate): "forcing characters to
   * shield for 4 additional frames before they are executed"; UFD "Shield Grab (Grab,
   * post-Shieldstun)" = grab startup + 4 (DK 12 vs 8). Armed when shieldstun ends with the shield up.
   */
  private shieldGrabLockRemaining = 0;
  /** A shield-grab press made during shieldstun or the delay, released when the delay ends. */
  private shieldGrabPending = false;

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
  /** Frames a buffered tech press is still live (surfaceTech.ts TECH_INPUT_FRAMES). */
  private techBufferRemaining = 0;
  /** Frames a mistimed tech locks out further teching (surfaceTech.ts TECH_LOCKOUT_FRAMES). */
  private techLockoutRemaining = 0;
  /** Frames of a missed-tech KNOCKDOWN (prone lockout) remaining; 0 = not knocked down. */
  private knockdownRemaining = 0;
  private knockdownFaceDown = false;
  private tripped = false;
  /** Option lock of the current trip: hard (attack trip chance) or soft (slip). */
  private tripOptionLockFrames = TRIP_OPTION_LOCK_FRAMES;
  private tripRandomSource: (() => number) | null = null;
  private attackClankRemaining = 0;
  private attackClankTotal = 0;
  private attackClankLockedStep = false;
  private attackClankInterrupted: Pick<ActiveAttack, 'move' | 'framesElapsed' | 'facing' | 'chargeHeldFrames'> | null = null;
  private attackClankReceiving: ReadonlyArray<Hurtbox> | null = null;

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

  /** Frozen impact/SDI position restored after Matter adds gravity and solves contacts. */
  private hitlagPosition: { readonly x: number; readonly y: number } | null = null;

  /**
   * Knockback queued by `applyHit` that will be applied when
   * `hitlagRemaining` drains to zero. Storing `vector` and
   * `hitstunFrames` as a single record (not separate fields) means we
   * can null-check once and either apply both atomically or skip the
   * whole release. `null` outside an active hitlag window.
   */
  private pendingKnockback: {
    readonly trip?: boolean;
    readonly softTrip?: boolean;
    readonly autolink?: import('./referenceAutolink').ReferenceAutolinkContext;
    readonly vector: { readonly x: number; readonly y: number };
    readonly hitstunFrames: number;
    readonly launchDecayPerFrame?: number;
    readonly tumble?: boolean;
    readonly referenceLaunch?: {
      readonly profile: import('./referenceLaunchEnergy').ReferenceLaunchProfile;
      readonly vertical: boolean;
      readonly groups: readonly number[];
    };
    readonly velocityCarry?: { readonly x: number; readonly y: number };
  } | null = null;

  /** Velocity restored after attacker-only hitlag; victims use pendingKnockback. */
  private attackerHitlagVelocity: {
    readonly x: number;
    readonly y: number;
  } | null = null;

  /** Controller-authored Y velocity captured immediately before Matter steps. */
  private prePhysicsVelocityY: number | null = null;

  /** Knockback-only velocity tracked separately from Matter gravity. */
  private launchVelocity: { readonly x: number; readonly y: number } | null = null;
  private launchDecayPerFrame: number | undefined;
  private referenceLaunch: {
    readonly profile: import('./referenceLaunchEnergy').ReferenceLaunchProfile;
    readonly vertical: boolean;
    readonly groups: readonly number[];
    groupIndex: number;
    interrupted: boolean;
    gravityY: number;
    firstStep: boolean;
  } | null = null;
  /** Input ownership before its timer drains, including the final locked step. */
  private referenceStunnedStep = false;
  /** Temporary collision transport; public velocity remains in reference-step units. */
  private referenceTransport: {
    token: object; multiplier: number; residual: { x: number; y: number };
  } | null = null;
  /** Only gravity supplied by the physics step, excluding launch/carry/hazards. */
  private hitstunGravityVelocityY = 0;
  /** One-use gravity correction, captured after the final stunned integration. */
  private pendingHitstunGravityCorrection = 0;

  /** Live Matter pair references; normals/isActive update in place each step. */
  private readonly contactPairs = new Map<SupportPair['bodyA'], SupportPair>();

  /** Victim-only pulse/cooldown state, reset by each incoming hit. */
  private sdiState = createReferenceSdiState();
  /** Selected source hitbox's SDI scale, captured once at contact. */
  private sdiMultiplier = 1;

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
  private timerProtection: 'legacy' | 'invincible' = 'legacy';

  /** Set on `destroy()` so listeners and removed bodies don't double-fire. */
  private destroyed = false;
  private combatPercentReceiptSink: ((event:CharacterCombatPercentReceipt)=>void)|null=null;
  setCombatPercentReceiptSink(sink:((event:CharacterCombatPercentReceipt)=>void)|null):void {this.combatPercentReceiptSink=sink;}
  private noteCombatPercentApplied(before:number,hit:HitInfo):void {
    const damageApplied=this.damagePercent-before;
    if(damageApplied>0)this.combatPercentReceiptSink?.({damageApplied,attackerSlotIndex:hit.combatAttackerSlotIndex??null,
      recoil:hit.recoil===true,viaSceneResolver:hit.combatViaSceneResolver===true});
  }
  private shieldBreak:ShieldBreakState|null=null;
  private shieldBreakVelocityY:number|null=null;private shieldBreakPhysicsFrame=-1;
  private shieldBreakLastFiveSeconds=false;
  /** The shield pop under the fighter's own gravity (its native launch gravity, else its fall acceleration). */
  private shieldBreakPop(){return shieldBreakPopPlan(this.id,this.tuning.referenceLaunch?this.tuning.referenceLaunch.gravity*5:this.tuning.fallAccel);}
  setSourceShieldBreakLastFiveSeconds(value:boolean):void {this.shieldBreakLastFiveSeconds=value;}
  isSourceVelocityControlled():boolean{return this.finalSmashControl?.velocity!==null&&this.finalSmashControl!==null||
    this.shieldBreak!==null&&shieldBreakControlsLocked(this.shieldBreak);}
  getSourceShieldBreakPresentationState(){return this.shieldBreak?.generation===this.positionResetGeneration?
    selectShieldBreakPresentation(this.shieldBreak):null;}
  getSourceShieldBreakReceivingState(){return this.shieldBreak?.generation===this.positionResetGeneration?
    structuredClone(this.shieldBreak):null;}
  private clearSourceShieldBreak(ownedLease=false):void {
    if(!this.shieldBreak&&!ownedLease)return;
    this.shieldBreak=null;this.shieldBreakVelocityY=null;this.shieldBreakPhysicsFrame=-1;this.shieldBreakMash=null;
    if(isShieldBroken(this.shieldState))this.shieldState=tickShield({...this.shieldState,stunRemaining:0},{held:false},this.tuning.shield);
  }
  private beginSourceShieldBreak():void {
    if(this.shieldBreak)return;
    this.cancelAttack();this.clearReferenceLaunch();this.pendingKnockback=null;this.hitstunRemaining=0;this.tumbling=false;
    this.linkPassiveGuard=null;this.reactionCue=null;this.reactionPresentation=null;
    const frame=Math.max(0,this.simulationInputFrame);
    this.shieldBreak=beginShieldBreak({frame,generation:this.positionResetGeneration,facing:this.facing,stunFrames:shieldBreakStunFrames(this.damagePercent,this.tuning.shield)});
    const plan=this.shieldBreakPop();this.shieldBreakVelocityY=plan.initialVelocityY;this.shieldBreakPhysicsFrame=frame-1;
    // Actual HP break may be installed after this step's Matter solve. The next
    // prephysics call owns the first source gravity dose; no position teleport.
    this.scene.matter.body.setVelocity(this.body,{x:0,y:this.hitlagRemaining>0?0:plan.initialVelocityY});
    this.jumpPresentation=null;this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    this.shortHopRising=false;this.airJumpRising=false;this.fastFallLatched=false;this.jumpCutArmed=false;this.shieldBreakMash=null;
  }
  private detailedHitApplicationDepth=0;
  private sourceDamagePresentation:SourceDamagePresentationReceipt|null=null;private sourceDamageEventSerial=0;private sourceDamageOwnStop=false;private sourceJumpEventSerial=0;private sourcePresentationClockAdvances=true;
  getSourceDamagePresentationReceipt(){return this.sourceDamagePresentation?.generation===this.positionResetGeneration&&
    (this.hitstunRemaining>0||this.pendingKnockback!==null||this.tumbling||this.sourceDamageOwnStop&&this.isInHitlag())?structuredClone(this.sourceDamagePresentation):null;}
  /** Global-step presentation adapter for an actual positive electric flinch.
   * Native stop-motion rate is unrecovered; this never changes hitlag/physics.
   * Scene calls it even when a slow lease skips the actor's local input step. */
  advanceSourceGlobalPresentationClock(frame:number):void {
    if(!Number.isSafeInteger(frame)||frame<0)throw new TypeError('Invalid source presentation global frame');
    const receipt=this.sourceDamagePresentation;if(!receipt)return;
    if(receipt.generation!==this.positionResetGeneration){this.sourceDamagePresentation=null;return;}
    const owns=this.sourceDamageOwnStop&&this.hitlagRemaining>0&&receipt.electric;
    if(!owns){if(receipt.ownElectricStop)this.sourceDamagePresentation={...receipt,ownElectricStop:false,electricStopFramesElapsed:0};return;}
    if(frame<=receipt.electricStopLastAdvancedFrame)return;
    this.sourceDamagePresentation={...receipt,ownElectricStop:true,electricStopFramesElapsed:Math.min(70,receipt.electricStopFramesElapsed+1),electricStopLastAdvancedFrame:frame};
  }
  protected retireSourceDamagePresentationIfUnowned():void {
    if(this.hitlagRemaining===0){this.sourceDamageOwnStop=false;
      if(this.sourceDamagePresentation?.ownElectricStop)this.sourceDamagePresentation={...this.sourceDamagePresentation,ownElectricStop:false,electricStopFramesElapsed:0};}
    if(this.sourceDamagePresentation&&(this.sourceDamagePresentation.generation!==this.positionResetGeneration||
      this.hitstunRemaining===0&&this.pendingKnockback===null&&!this.tumbling&&!(this.sourceDamageOwnStop&&this.isInHitlag())))this.sourceDamagePresentation=null;
  }
  getSourceAirPresentationReceipt(){return{grounded:this.isGrounded(),helpless:this.isHelpless(),tumbling:this.tumbling,jumpsUsed:this.jumpsUsed,
    jump:this.getJumpPresentationState(),velocity:this.getVelocity(),framesElapsed:this.jumpPresentation?.framesElapsed??this.ordinaryPresentation?.framesElapsed??0,
    facing:this.facing,jumpEventSerial:this.sourceJumpEventSerial,frame:this.simulationInputFrame,generation:this.positionResetGeneration,clockAdvances:this.sourcePresentationClockAdvances,fallOwner:this.footstoolRecipient||this.sourceLinkFootstool?.presentation.role==='performer'?'footstool' as const:this.tumbling?'tumble' as const:
      this.isHelpless()?'source-helpless' as const:'ordinary' as const};}
  protected sourceIntrinsicActionCommitted():boolean{return false;}
  private linkPassiveGuard:{entryFrame:number;lastFrame:number;framesElapsed:number;facing:1|-1;crouchedAtEntry:boolean;
    duration:number;generation:number}|null=null;
  getLinkPassiveShieldPresentationState(){const state=this.linkPassiveGuard;return state?{
    framesElapsed:state.framesElapsed,facing:state.facing,crouchedAtEntry:state.crouchedAtEntry,
    guardFrames:state.framesElapsed,stopped:this.hitlagRemaining>0}:null;}
  protected getSourcePassiveGuardExtent():number{return 20;}
  notifyLinkPassiveShieldContact(hit:HitInfo):void {
    const crouchedAtEntry=this.isCrouching();
    this.linkPassiveGuard={entryFrame:this.simulationInputFrame,lastFrame:this.simulationInputFrame,framesElapsed:0,
      facing:this.facing,crouchedAtEntry,duration:crouchedAtEntry?4:this.getSourcePassiveGuardExtent(),
      generation:this.positionResetGeneration};
    // Explicit coordinator adapter: reuse ordinary sourced guard's stop and
    // horizontal defender recoil, without HP/percent/stun or native parity claim.
    this.sourcedShieldPush={speed:hit.facing*computeShieldPushback({damage:hit.damage,kind:hit.shieldKind,
      setoffMultiplier:hit.shieldSetoffMultiplier}).defenderSpeed,attacker:false};
    this.armAttackerHitlag(computeShieldHitlag({damage:hit.damage,targetPercent:this.damagePercent,
      multiplier:hit.hitlagMultiplier,players:hit.hitlagPlayers,electricCollision:hit.electricCollision,
      projectile:hit.hitlagProjectile}));
  }
  interruptSourceReceivingOnStockLoss():void {this.endLedgeJumpClearance();this.sourceLinkFootstool=null;this.sourceLinkFootstoolPendingContact=null;this.sourceLinkFootstoolRepeatCount=0;this.sourceLinkFootstoolCooldown=0;this.sourceLinkFootstoolCooldownEntryFrame=-1;this.sourceLinkFootstoolRecipientSide=null;this.pendingFootstoolJump=false;this.footstoolMini=null;this.footstoolRecipient=null;this.clearSourceShieldBreak();this.sourceDamagePresentation=null;this.sourceDamageOwnStop=false;this.sourceCaptureMotionFamily=null;this.linkPassiveGuard=null;}
  private finalSmashControl: FinalSmashActorControl | null = null;
  private finalVictimPresentation:FinalVictimPresentationState|null=null;
  setFinalVictimPresentation(state:FinalVictimPresentationState|null):void {
    if(state){const parsed=parseFinalVictimPresentationState(state);
      if(parsed.victimGeneration!==this.positionResetGeneration||parsed.victimFighter!==this.id)
        throw new Error('Final cinematic pose requires actual recipient generation and fighter');
      this.finalVictimPresentation=parsed;
    }else this.finalVictimPresentation=null;
  }
  getFinalVictimPresentationState():FinalVictimPresentationState|null {
    const state=this.finalVictimPresentation;
    if(!state||state.victimGeneration!==this.positionResetGeneration)return null;
    if(state.kind==='impact-stop')return this.isInHitlag()&&this.lastFinalReactionRun===state.runId?state:null;
    return this.finalSmashControl?.role==='captured'&&this.finalSmashControl.runId===state.runId?state:null;
  }
  getFinalVictimBodyPose(){const selection=this.getFinalVictimPresentationSelection();return selection?finalVictimBodyPose(selection):null;}
  getFinalVictimPresentationDependencies():readonly string[]{const selection=this.getFinalVictimPresentationSelection();
    return selection&&!this.getFinalVictimBodyPose()?[`Missing authored Final victim paired profile ${selection.targetFighter}/${selection.profileKey} at age${selection.authoredAge}`]:[];}
  getFinalVictimPresentationSelection(){const state=this.getFinalVictimPresentationState();return state?selectFinalVictimPresentation(state):null;}

  private finalSmashBodyTail: { runId:number;sheet:string;age:number;advance:number;endAge:number;facing:1|-1;
    bornFrame:number;previousDelta:{x:number;y:number} } | null = null;
  retainFinalSmashBodyTail(sheet:string,age:number,advance:number,endAge:number,runId:number,frame:number):void {
    if(age>=endAge)return;
    const pose=finalBodyPose(this.id,sheet,age);
    this.finalSmashBodyTail={sheet,age,advance,endAge,runId,facing:this.facing,bornFrame:frame,
      previousDelta:pose?{...pose.rootDelta}:{x:0,y:0}};
  }
  getFinalSmashPresentation():FinalSmashActorControl|null {
    if(this.finalSmashControl)return this.finalSmashControl;
    const tail=this.finalSmashBodyTail;
    return tail?{runId:tail.runId,role:'owner',phase:'uncommitted-end-tail',sheet:tail.sheet,age:tail.age,
      facing:tail.facing,intangible:false,noDead:false,terrainBypass:false,jostle:true,gravityDisabled:false,velocity:null}:null;
  }
  private finalSmashOriginalMask: number | null = null;
  private finalOpponentSlow: FinalOpponentSlowState | null = null;
  private finalSlowLocalStep = true;
  setFinalOpponentSlow(runId: number, divisor: number, duration: number, frame: number): void {
    const original=this.finalOpponentSlow?.originalTimeScale??this.body.timeScale;
    this.finalOpponentSlow=beginFinalOpponentSlow(runId,divisor,duration,frame,original);
    if (!this.finalSmashControl) this.body.timeScale=original/divisor;
  }
  clearFinalOpponentSlow(runId?: number): void {
    if (!this.finalOpponentSlow || runId!==undefined&&runId!==this.finalOpponentSlow.runId) return;
    this.body.timeScale=this.finalOpponentSlow.originalTimeScale; this.finalOpponentSlow=null; this.finalSlowLocalStep=true;
  }
  /** Called once by Scene before item/input adapters; raw recording remains
   * at global60Hz. Owner/captive Final phase clock takes precedence. */
  sampleFinalOpponentSlowInput(raw: CharacterInput, frame: number): CharacterInput | null {
    if (!this.finalOpponentSlow) { this.finalSlowLocalStep=true; return raw; }
    if (this.finalSmashControl) {
      this.body.timeScale=this.finalOpponentSlow.originalTimeScale;
      this.finalSlowLocalStep=true; return raw;
    }
    const next=stepFinalOpponentSlow(this.finalOpponentSlow,raw,frame);
    if (!next.state) { this.clearFinalOpponentSlow(); return next.input; }
    this.finalOpponentSlow=next.state; this.body.timeScale=next.state.originalTimeScale*next.state.rate;
    this.finalSlowLocalStep=next.input!==null; return next.input;
  }
  /** Reaction provenance only: a capture release may clear its own linking
   * launch, but never a later independent hit or the real released finisher. */
  private lastFinalReactionRun: number | null = null;
  private capturedFinalReactionRun: number | null = null;
  getFinalSmashControl(): FinalSmashActorControl | null { return this.finalSmashControl; }
  getSourceRootPosition(): { x: number; y: number } {
    const control=this.getFinalSmashPresentation();
    const pose=this.getFinalVictimBodyPose()??(control?.sheet?finalBodyPose(this.id,control.sheet,control.age):null);
    const centre=this.getPosition();
    return { x:centre.x,y:centre.y-(pose?.bodyCentreFromRootY??-this.tuning.height/2) };
  }
  moveFinalSmashSourceRoot(root:{x:number;y:number},runId:number):boolean {
    const centre=this.getPosition(),current=this.getSourceRootPosition();
    return this.moveFinalSmashRoot({x:root.x,y:root.y+centre.y-current.y},runId);
  }
  /** Read-only reconstruction evidence; restoration still replays gameplay. */
  getMatchHistoryEvidence(){
    const attack=this.getActiveAttack(),held=this.getEquippedItem();
    const scalars:Record<string,string|number|boolean|null>={};
    for(const [key,value] of Object.entries(this).sort(([a],[b])=>a.localeCompare(b)))
      if(value===null||['string','number','boolean'].includes(typeof value)){
        if(typeof value==='number'&&!Number.isFinite(value))throw new Error(`Nonfinite actor history field ${key}`);
        scalars[key]=value as string|number|boolean|null;
      }
    return {scalars,staleMoveQueue:this.staleMoveQueue.map(row=>({...row})),
      attack:attack?{move:attack.move,facing:attack.facing,phase:attack.phase,framesElapsed:attack.framesElapsed,
        chargeHeldFrames:attack.chargeHeldFrames,hasPhysicalSensor:attack.hitboxBody!==null}:null,
      charge:this.getAnimationActionState(),shield:this.getShieldState(),dodge:this.getDodgeState(),
      locomotion:this.getLocomotionState(),jump:this.getJumpPresentationState(),ledge:this.getLedgeHangState(),
      taunt:this.getTauntPresentationState(),tauntOwner:this.getSourceTauntPresentationOwner(),sourceBodyRoute:this.sourceCurrentBodyRoute(),
      support:this.getSourceSupportPresentationObservation(),ordinary:this.getOrdinaryPresentationState(),landing:this.getLandingPresentationState(),
      captureEquipmentClock:{grabEntry:this.sourceGrabAdmissionFrame,captureEntry:this.sourceCaptureAdmissionFrame,cutEntry:this.sourceCutAdmissionFrame,heldEntry:this.sourceHeldAdmissionFrame},
      grabDamage:{pummel:this.pummelDamageTransaction,throw:this.throwPresentation?.damageTransaction??null},
      grab:this.getGrabState(),recipient:this.getSourceRecipientPresentationState(),throw:this.getThrowPresentationState(),
      held:held?{definition:held.definition,ammo:held.getAmmo()}:null,receiving:this.getActiveHurtboxes(),
      lease:this.getFinalSmashLeaseSnapshot()};
  }
  getFinalSmashLeaseSnapshot() {
    return { generation: this.positionResetGeneration,
      intrinsic: this.captureIntrinsicRuntimeState(),
      actor: { timeScale: this.body.timeScale, bodyMask: this.body.collisionFilter.mask, position: this.getPosition(), velocity: this.getVelocity(), facing: this.facing, percent: this.damagePercent,
        ignoreGravity:this.body.ignoreGravity??false,
        hitlag: this.hitlagRemaining, hitlagPosition: this.hitlagPosition ? { ...this.hitlagPosition } : null,
        inputFrame: this.simulationInputFrame, previous: { jump: this.prevJumpHeld, attack: this.prevAttackHeld,
          heavy: this.prevHeavyHeld, special: this.prevSpecialHeld, shield: this.prevShieldHeld,
          dodge: this.prevDodgeHeld, grab: this.prevGrabHeld, appeal: this.prevAppealHeld,
          x: this.prevMoveX, y: this.prevMoveY } },
      ledgeJumpClearance:this.ledgeJumpClearance?{...this.ledgeJumpClearance}:null,
      shieldBreakReceiving:this.shieldBreak?structuredClone(this.shieldBreak):null,
      shieldBreakVelocityY:this.shieldBreakVelocityY,shieldBreakPhysicsFrame:this.shieldBreakPhysicsFrame,
      shieldBreakLastFiveSeconds:this.shieldBreakLastFiveSeconds,shieldBreakMash:this.shieldBreakMash?structuredClone(this.shieldBreakMash):null,
      clankPresentation:{remaining:this.attackClankRemaining,total:this.attackClankTotal,lockedStep:this.attackClankLockedStep,
        interrupted:this.attackClankInterrupted?structuredClone(this.attackClankInterrupted):null,
        receiving:this.getAttackClankPresentationState()?.phase==='freeze'&&this.attackClankReceiving?structuredClone(this.attackClankReceiving):null},
      captureEquipmentClock:{grabEntry:this.sourceGrabAdmissionFrame,captureEntry:this.sourceCaptureAdmissionFrame,cutEntry:this.sourceCutAdmissionFrame,heldEntry:this.sourceHeldAdmissionFrame},
      sourceDamagePresentation:this.sourceDamagePresentation?structuredClone(this.sourceDamagePresentation):null,sourceDamageEventSerial:this.sourceDamageEventSerial,sourceDamageOwnStop:this.sourceDamageOwnStop,sourceJumpEventSerial:this.sourceJumpEventSerial,sourcePresentationClockAdvances:this.sourcePresentationClockAdvances,
      captureMotionFamily:this.sourceCaptureMotionFamily?structuredClone(this.sourceCaptureMotionFamily):null,
      sourceFootstool:{state:this.sourceLinkFootstool?structuredClone(this.sourceLinkFootstool):null,
        repeatCount:this.sourceLinkFootstoolRepeatCount,cooldown:this.sourceLinkFootstoolCooldown,cooldownEntryFrame:this.sourceLinkFootstoolCooldownEntryFrame,
        side:this.sourceLinkFootstoolRecipientSide,pendingContact:this.sourceLinkFootstoolPendingContact?{...this.sourceLinkFootstoolPendingContact}:null,
        pendingJump:this.pendingFootstoolJump,phantom:this.pendingFootstoolPhantom,
        recipient:this.footstoolRecipient?{...this.footstoolRecipient}:null,mini:this.footstoolMini?{...this.footstoolMini}:null},
      recoveryTransactions:{eating:this.itemEating?structuredClone(this.itemEating):null,healing:this.itemHealing?{...this.itemHealing}:null,events:structuredClone(this.recoveryEvents)},
      passiveGuard:this.linkPassiveGuard?structuredClone(this.linkPassiveGuard):null,
      aerialRebound:this.getSourceAerialReboundState(),
      bodyTail: this.finalSmashBodyTail ? structuredClone(this.finalSmashBodyTail) : null,
      slow: this.finalOpponentSlow ? structuredClone(this.finalOpponentSlow) : null, slowLocalStep: this.finalSlowLocalStep,
      originalMask: this.finalSmashOriginalMask,
      finalVictimPresentation:this.getFinalVictimPresentationState()?structuredClone(this.getFinalVictimPresentationState()):null,
      control: this.finalSmashControl ? { ...this.finalSmashControl,
        velocity: this.finalSmashControl.velocity ? { ...this.finalSmashControl.velocity } : null } : null,
      reaction: {
        lastRun: this.lastFinalReactionRun, capturedRun: this.capturedFinalReactionRun,
        hitstun: this.hitstunRemaining, tumble: this.tumbling,
        pending: this.pendingKnockback ? structuredClone(this.pendingKnockback) : null,
        reference: this.referenceLaunch ? structuredClone(this.referenceLaunch) : null,
        launch: this.launchVelocity ? { ...this.launchVelocity } : null,
        decay: this.launchDecayPerFrame, stunnedStep: this.referenceStunnedStep,
        gravityY: this.hitstunGravityVelocityY, gravityCorrection: this.pendingHitstunGravityCorrection,
      } };
  }
  /** Restore AFTER the authoritative actor generation/body state. Never
   * capture an already-bypassed mask as the lease's original floor mask. */
  restoreFinalSmashLease(snapshot: ReturnType<Character['getFinalSmashLeaseSnapshot']>): void {
    if (snapshot.generation !== this.positionResetGeneration) throw new Error('Final lease generation mismatch');
    this.setFinalSmashControl(null);
    if (snapshot.control) {
    if (snapshot.originalMask === null) throw new Error('Active Final lease requires original collision mask');
    this.body.collisionFilter.mask = snapshot.originalMask;
    this.setFinalSmashControl(snapshot.control);
    }
    if(snapshot.finalVictimPresentation){const victim=parseFinalVictimPresentationState(snapshot.finalVictimPresentation);
      if(victim.victimGeneration!==this.positionResetGeneration||victim.victimFighter!==this.id||victim.lastFrame>snapshot.actor.inputFrame||
        (victim.kind==='captured'?(snapshot.control?.role!=='captured'||snapshot.control.runId!==victim.runId):
          snapshot.actor.hitlag<=0||snapshot.reaction?.lastRun!==victim.runId))
        throw new Error('Restore actual capture or accepted blast stop before cinematic recipient pose');
      this.setFinalVictimPresentation(victim);
    }else this.finalVictimPresentation=null;
    const clearance=snapshot.ledgeJumpClearance;
    if(clearance&&(!Number.isSafeInteger(clearance.originalMask)||!Number.isFinite(clearance.cornerY)))throw new Error('Malformed ledge jump clearance checkpoint');
    this.ledgeJumpClearance=clearance?{...clearance}:null;
    this.shieldBreak=parseShieldBreakState(snapshot.shieldBreakReceiving);
    if(this.shieldBreak&&this.shieldBreak.generation!==this.positionResetGeneration)throw new Error('Shield break generation mismatch');
    if(snapshot.shieldBreakVelocityY!==null&&!Number.isFinite(snapshot.shieldBreakVelocityY)||!Number.isSafeInteger(snapshot.shieldBreakPhysicsFrame)||snapshot.shieldBreakPhysicsFrame< -1||typeof snapshot.shieldBreakLastFiveSeconds!=='boolean')throw new Error('Malformed shield pop kinetic checkpoint');
    this.shieldBreakVelocityY=snapshot.shieldBreakVelocityY;this.shieldBreakPhysicsFrame=snapshot.shieldBreakPhysicsFrame;
    this.shieldBreakLastFiveSeconds=snapshot.shieldBreakLastFiveSeconds;this.shieldBreakMash=snapshot.shieldBreakMash?structuredClone(snapshot.shieldBreakMash):null;
    const clank=snapshot.clankPresentation;
    if(!Number.isSafeInteger(clank.remaining)||clank.remaining<0||!Number.isSafeInteger(clank.total)||clank.total<clank.remaining||typeof clank.lockedStep!=='boolean'||
      clank.interrupted&&(!Number.isSafeInteger(clank.interrupted.framesElapsed)||clank.interrupted.framesElapsed<0||![1,-1].includes(clank.interrupted.facing)))throw new Error('Malformed clank physical presentation checkpoint');
    if(clank.receiving&&(!Array.isArray(clank.receiving)||clank.receiving.some(box=>typeof box.id!=='string'||!box.id||
      ![box.offsetX,box.offsetY,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0||box.capsule&&
      ![box.capsule.start.x,box.capsule.start.y,box.capsule.end.x,box.capsule.end.y,box.capsule.radius].every(Number.isFinite))))throw new Error('Malformed frozen clank receiving checkpoint');
    this.attackClankRemaining=clank.remaining;this.attackClankTotal=clank.total;this.attackClankLockedStep=clank.lockedStep;
    this.attackClankInterrupted=clank.interrupted?{...structuredClone(clank.interrupted),move:parseAttackMoveSnapshot(clank.interrupted.move,'clank.interrupted.move')}:null;
    this.attackClankReceiving=clank.receiving?structuredClone(clank.receiving):null;
    this.sourceDamagePresentation=parseSourceDamagePresentationReceipt(snapshot.sourceDamagePresentation);
    if(this.sourceDamagePresentation&&this.sourceDamagePresentation.generation!==this.positionResetGeneration)throw new Error('Damage receipt generation mismatch');
    if(!Number.isSafeInteger(snapshot.sourceDamageEventSerial)||snapshot.sourceDamageEventSerial<0||this.sourceDamagePresentation&&snapshot.sourceDamageEventSerial<this.sourceDamagePresentation.eventSerial)throw new Error('Damage event sequence mismatch');
    if(typeof snapshot.sourcePresentationClockAdvances!=='boolean')throw new Error('Malformed source stop clock checkpoint');
    if(!Number.isSafeInteger(snapshot.sourceJumpEventSerial)||snapshot.sourceJumpEventSerial<0)throw new Error('Malformed actual jump event serial');
    this.sourceJumpEventSerial=snapshot.sourceJumpEventSerial;
    if(typeof snapshot.sourceDamageOwnStop!=='boolean')throw new Error('Malformed damage stop ownership');
    this.sourceDamageOwnStop=snapshot.sourceDamageOwnStop;this.sourceDamageEventSerial=snapshot.sourceDamageEventSerial;this.sourcePresentationClockAdvances=snapshot.sourcePresentationClockAdvances;
    const tread=snapshot.sourceFootstool;
    const count=(n:unknown,min=0)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min;
    const contactValid=(c:typeof tread.pendingContact)=>c===null||!!c&&[c.jumperIndex,c.jumperGeneration,c.recipientIndex,c.recipientGeneration].every(n=>count(n))&&c.jumperIndex!==c.recipientIndex;
    if(!tread||!count(tread.repeatCount)||!count(tread.cooldown)||tread.cooldown>8||!count(tread.cooldownEntryFrame,-1)||
      ![null,'front','back'].includes(tread.side)||typeof tread.pendingJump!=='boolean'||typeof tread.phantom!=='boolean'||!contactValid(tread.pendingContact))
      throw new Error('Malformed fresh footstool checkpoint');
    if(tread.state){const s=tread.state,p=s.presentation;
      if(!s||s.generation!==this.positionResetGeneration||!count(s.entryFrame)||!count(s.lastFrame)||s.lastFrame<s.entryFrame||
        typeof s.mini!=='boolean'||typeof s.phantom!=='boolean'||!contactValid(s.contact)||!s.contact)throw new Error('Malformed footstool accepted-contact lease');
      selectLinkFootstoolBodyRoute(p);
      const limit=p.phase==='ground-back'?24:p.phase==='air-pose'?8:p.phase==='air-fall'?28:9;
      if(p.framesElapsed>=limit||p.role==='performer'&&s.contact.jumperGeneration!==this.positionResetGeneration||
        p.role==='recipient'&&s.contact.recipientGeneration!==this.positionResetGeneration)throw new Error('Footstool phase/identity mismatch');
    }
    if(tread.recipient&&(!count(tread.recipient.framesElapsed)||!count(tread.recipient.entryFrame)||typeof tread.recipient.grounded!=='boolean'||
      ![1,-1].includes(tread.recipient.facing)))throw new Error('Malformed footstool recipient clock');
    if(tread.mini&&(!Number.isFinite(tread.mini.basis)||tread.mini.basis<=0||!count(tread.mini.framesElapsed)||tread.mini.framesElapsed>=3||
      typeof tread.mini.cut!=='boolean'))throw new Error('Malformed footstool mini transaction');
    this.sourceLinkFootstool=tread.state?structuredClone(tread.state):null;this.sourceLinkFootstoolRepeatCount=tread.repeatCount;
    this.sourceLinkFootstoolCooldown=tread.cooldown;this.sourceLinkFootstoolCooldownEntryFrame=tread.cooldownEntryFrame;this.sourceLinkFootstoolRecipientSide=tread.side;
    this.sourceLinkFootstoolPendingContact=tread.pendingContact?{...tread.pendingContact}:null;this.pendingFootstoolJump=tread.pendingJump;this.pendingFootstoolPhantom=tread.phantom;
    this.footstoolRecipient=tread.recipient?{...tread.recipient}:null;this.footstoolMini=tread.mini?{...tread.mini}:null;
    const family=snapshot.captureMotionFamily;
    if(family){const parsed=parseAuthoredCaptureMotionFamily(family,'checkpoint.captureMotionFamily');
      if(!parsed||![family.captureId,family.generation,family.captorGeneration].every(n=>Number.isSafeInteger(n)&&n>=0)||
        family.generation!==this.positionResetGeneration||!this.grabbedBy||family.captorGeneration!==this.grabbedBy.positionResetGeneration||
        family.captureId!==this.capturePresentation?.state.captureId||!this.capturePresentation.state.active)
        throw new Error('Restore actual accepted capture before source capture-family checkpoint');
      this.sourceCaptureMotionFamily={...parsed,captureId:family.captureId,generation:family.generation,captorGeneration:family.captorGeneration};
    }else this.sourceCaptureMotionFamily=null;
    const recovery=snapshot.recoveryTransactions;
    if(recovery&&(typeof recovery!=='object'||Array.isArray(recovery)||Object.keys(recovery).length!==3||
      ['eating','healing','events'].some(key=>!Object.hasOwn(recovery,key))))throw new Error('Malformed recovery transaction checkpoint');
    this.itemEating=parseRecoveryEatingState(recovery?.eating,this.positionResetGeneration,this.sourceItemEatingConsumeAge());
    this.itemHealing=parseRecoveryHealingState(recovery?.healing);
    if(recovery&&!Array.isArray(recovery.events))throw new Error('Malformed recovery callback checkpoint');
    this.recoveryEvents=(recovery?.events??[]).map(event=>{
      const parsed=parseRecoveryTransactionEvent(event);if(parsed.actorGeneration!==this.positionResetGeneration)throw new Error('Recovery callback generation mismatch');return parsed;});
    this.linkPassiveGuard=snapshot.passiveGuard?structuredClone(snapshot.passiveGuard):null;
    this.finalSmashBodyTail=snapshot.bodyTail?structuredClone(snapshot.bodyTail):null;
    this.clearFinalOpponentSlow();
    this.finalOpponentSlow=snapshot.slow?structuredClone(snapshot.slow):null; this.finalSlowLocalStep=snapshot.slowLocalStep;
    if(this.finalOpponentSlow)this.body.timeScale=this.finalOpponentSlow.originalTimeScale*(snapshot.control?1:this.finalOpponentSlow.rate);
    const a = snapshot.actor;
    this.body.collisionFilter.mask = a.bodyMask; this.body.timeScale = a.timeScale;
    if(typeof a.ignoreGravity!=='boolean')throw new Error('Malformed actor gravity checkpoint');this.body.ignoreGravity=a.ignoreGravity;
    this.scene.matter.body.setPosition(this.body, a.position); this.scene.matter.body.setVelocity(this.body, a.velocity);
    this.facing = a.facing; this.damagePercent = a.percent; this.hitlagRemaining = a.hitlag;
    this.hitlagPosition = a.hitlagPosition ? { ...a.hitlagPosition } : null; this.simulationInputFrame = a.inputFrame;
    const captureClock=snapshot.captureEquipmentClock;
    if(!captureClock||Object.keys(captureClock).length!==4||!['grabEntry','captureEntry','cutEntry','heldEntry'].every(key=>Object.hasOwn(captureClock,key))||
      !Object.values(captureClock).every(value=>Number.isSafeInteger(value)&&value>=0&&value<=this.simulationInputFrame))throw new Error('Invalid actual capture equipment admission clocks');
    this.sourceGrabAdmissionFrame=captureClock.grabEntry;this.sourceCaptureAdmissionFrame=captureClock.captureEntry;
    this.sourceCutAdmissionFrame=captureClock.cutEntry;this.sourceHeldAdmissionFrame=captureClock.heldEntry;
    this.prevJumpHeld = a.previous.jump; this.prevAttackHeld = a.previous.attack; this.prevHeavyHeld = a.previous.heavy;
    this.prevSpecialHeld = a.previous.special; this.prevShieldHeld = a.previous.shield; this.prevDodgeHeld = a.previous.dodge;
    this.prevGrabHeld = a.previous.grab; this.prevAppealHeld = a.previous.appeal;
    this.prevMoveX = a.previous.x; this.prevMoveY = a.previous.y;
    const r = snapshot.reaction;
    this.lastFinalReactionRun = r.lastRun; this.capturedFinalReactionRun = r.capturedRun;
    this.hitstunRemaining = r.hitstun; this.tumbling = r.tumble;
    this.pendingKnockback = r.pending ? structuredClone(r.pending) : null;
    this.referenceLaunch = r.reference ? structuredClone(r.reference) : null;
    this.launchVelocity = r.launch ? { ...r.launch } : null;
    this.launchDecayPerFrame = r.decay; this.referenceStunnedStep = r.stunnedStep;
    this.hitstunGravityVelocityY = r.gravityY; this.pendingHitstunGravityCorrection = r.gravityCorrection;
    if(snapshot.aerialRebound){const active=this.activeAttack;
      if(!active||active.move.id!==snapshot.aerialRebound.moveId)throw new Error('Restore active aerial before rebound checkpoint');
      this.aerialReboundFrames.set(active,snapshot.aerialRebound.frame);
      if(snapshot.aerialRebound.pendingSpeed!==null)this.pendingAerialReboundSpeeds.set(active,snapshot.aerialRebound.pendingSpeed);
      else this.pendingAerialReboundSpeeds.delete(active);
    }else if(this.activeAttack){this.aerialReboundFrames.delete(this.activeAttack);this.pendingAerialReboundSpeeds.delete(this.activeAttack);}
    this.restoreIntrinsicRuntimeState(snapshot.intrinsic);
  }
  /** Source relocation/snap is not a respawn, does not advance generation or
   * reset action/article ownership, and is admitted only by the current lease. */
  moveFinalSmashRoot(position: { x: number; y: number }, runId: number): boolean {
    if (this.finalSmashControl?.runId !== runId || ![position.x, position.y].every(Number.isFinite)) return false;
    this.scene.matter.body.setPosition(this.body, position);
    // Source-controlled relocation moves the existing freeze anchor with the
    // lease; it does not consume or re-arm the victim's hitlag clock.
    if (this.hitlagPosition) this.hitlagPosition = { ...position };
    return true;
  }

  /** Fresh Link overrides these intrinsic callbacks; unrelated/legacy kits
   * cannot inherit guessed equipment or article origins. */
  setLinkBoomerangPresent(_present:boolean):void{}
  notifyLinkBoomerangCatch():boolean{return false;}
  applySourceAbsorbedHealing(amount:number):number{return this.applySourceItemRecoveryHealing(amount);}
  applySourceItemRecoveryHealing(amount:number):number {
    if(!Number.isFinite(amount)||amount<0)throw new Error('Absorbed healing requires finite positive source power');
    const before=this.damagePercent;this.damagePercent=Math.max(0,before-amount);return before-this.damagePercent;
  }
  /** Same selected paired cranial contact as the Final pixels/receiving.
   * Missing anatomical registration never borrows an ordinary-motion point. */
  getFinalSmashHeadWorldContact():{x:number;y:number}|null {
    const victim=this.getFinalVictimPresentationSelection(),control=this.getFinalSmashPresentation(),
      pose=victim?this.getFinalVictimBodyPose():control?.sheet?finalBodyPose(this.id,control.sheet,control.age):null,
      contact=pose?.headContact;
    if(!contact)return null;
    const operator={facing:victim?.facing??control?.facing??this.facing,rotationDegrees:victim?0:control?.rotationDegrees??0},
      point=transformPikachuFinalOrientationPoint(contact.point,operator),root=this.getSourceRootPosition();
    return{x:root.x+point.x,y:root.y+point.y};
  }
  getLinkEquipmentState(): import('./linkEquipment').LinkEquipmentState | null { return null; }
  onLinkFinalEvent(_event: import('./linkAncientFinal').LinkAncientFinalEvent, _runId: number): void {}
  setLinkRemoteBombState(_state:import('./linkRemoteBomb').LinkRemoteBombState|null):void {}
  consumeLinkRuntimeEvents(): readonly import('./FreshLink').LinkRuntimeEvent[] { return []; }
  getLinkPassiveShieldWorldSurfaces():readonly import('./linkPassiveShield').LinkPassiveShieldSurface[]{return [];}
  canActivateFinalSmash(): boolean {
    return this.finalSmashControl === null && !this.donkeykongHeavyItemHeld && this.canUseItemsBeforeInput();
  }
  isFinalSmashNoDead(): boolean { return this.finalSmashControl?.noDead === true; }
  setFinalSmashControl(control: FinalSmashActorControl | null): void {
    if(control?.inheritVerticalVelocity!==undefined&&(typeof control.inheritVerticalVelocity!=='boolean'||
      control.inheritVerticalVelocity&&(this.id!=='pikachu'||control.role!=='owner'||control.phase!=='miss')))
      throw new Error('Only Pikachu Final miss may inherit ordinary vertical velocity');
    if(control?.rotationDegrees!==undefined&&(!Number.isFinite(control.rotationDegrees)||Math.abs(control.rotationDegrees)>90||
      this.id!=='pikachu'||control.role!=='owner'))throw new Error('Only actual Pika owner posture may supply a finite source-guided rotation');
    if(control){this.endLedgeJumpClearance();
      this.sourceLinkFootstool=null;this.sourceLinkFootstoolPendingContact=null;this.footstoolRecipient=null;this.footstoolMini=null;this.pendingFootstoolJump=false;
    }
    const prior = this.finalSmashControl;
    if (prior?.role === 'captured' && (!control || prior.runId !== control.runId)) {
      if(this.finalVictimPresentation?.runId===prior.runId)this.finalVictimPresentation=null;
      // Engine lifecycle adapter: unavailable native victim-release callee.
      // Keep damage/root/generation, hitlag and independent protection clocks.
      if (this.capturedFinalReactionRun === prior.runId && this.lastFinalReactionRun === prior.runId) {
        this.clearReferenceLaunch(); this.pendingKnockback = null; this.launchVelocity = null;
        this.launchDecayPerFrame = undefined; this.hitstunRemaining = 0;
        this.referenceStunnedStep = false; this.tumbling = false;
        this.hitstunGravityVelocityY = 0; this.pendingHitstunGravityCorrection = 0;
        this.reactionPresentation = null; this.reactionCue = null;
        this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      }
      this.capturedFinalReactionRun = null;
    }
    if (control && (!prior || prior.runId !== control.runId)) {
      this.finalSmashBodyTail=null; this.clearSourceShieldBreak();this.sourceDamagePresentation=null;this.sourceDamageOwnStop=false;
      this.linkPassiveGuard=null;
      this.cancelAttack();
      if (control.role === 'captured') {
        this.capturedFinalReactionRun = this.lastFinalReactionRun === control.runId ? control.runId : null;
        if (this.grabbedBy) this.releaseFromGrab('external');
        if (this.grabTarget) { this.grabTarget.releaseFromGrab('external'); this.grabTarget = null; }
        this.grabState = resetGrabState(); this.grabReleasePresentation = null;
        this.clearGrabSourcePresentation();
      }
      this.clearReferenceLaunch();
      this.offensiveActionBuffer = null;
      this.jumpInputBufferFrames = 0;
      this.tapJumpBufferFrames = 0;
      this.chargingSmash = null;
      this.chargingSpecial = null;
      this.jumpsquatRemaining = 0;
      this.jumpPresentation = null;
      this.finalSmashOriginalMask = this.body.collisionFilter.mask;
    }
    this.finalSmashControl = control ? Object.freeze({ ...control,
      velocity: control.velocity ? Object.freeze({ ...control.velocity }) : null }) : null;
    if (control) {
      this.facing = control.facing;
      if (this.finalSmashOriginalMask !== null) this.body.collisionFilter.mask = control.terrainBypass
        ? this.finalSmashOriginalMask & ~(COLLISION_CATEGORIES.PLATFORM_SOLID | COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH)
        : this.finalSmashOriginalMask;
    } else if (this.finalSmashOriginalMask !== null) {
      this.body.collisionFilter.mask = this.finalSmashOriginalMask;
      this.finalSmashOriginalMask = null;
    }
  }

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

  constructor(scene: PhysicsHost, options: CharacterOptions) {
    this.scene = scene;
    this.id = options.id;
    const dkVertical=options.donkeykongOrdinaryVertical??getFighterMovementProfile(options.id).donkeykongOrdinaryVertical;
    this.donkeykongOrdinaryVertical=options.id==='donkeykong'&&dkVertical
      ? Object.freeze({...dkVertical,fullHopStepVelocitiesY:Object.freeze([...dkVertical.fullHopStepVelocitiesY])}):null;
    this.authoredShieldPushTraction=options.shieldPushTraction??getFighterMovementProfile(options.id).shieldPushTraction??0.65;
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
      locomotion: {
        ...getFighterMovementProfile(options.id).locomotion,
        ...stripUndefined(options.locomotion ?? {}),
      },
      // Resolve the partial `shield` slot into a fully-defaulted record
      // so the per-step tick can read tuning fields directly without
      // optional-chaining or re-resolution work each frame.
      shield: resolveShieldTuning(options.shield),
      // AC 60302 Sub-AC 2 — same treatment for the dodge slot.
      dodge: resolveDodgeTuning(mergeDodgeTuning(
        resolveDodgeTuning(getFighterMovementProfile(options.id).dodge), options.dodge ?? {},
      )),
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
    // A reset clears our contacts while Matter can retain the same floor pair.
    // Active events restore that support without waiting for a new collision.
    scene.matter.world.on('collisionactive', this.collisionStartListener);
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
  applyInput(input: CharacterInput, simulationFrame?: number): void {
    this.sourcePresentationClockAdvances=this.hitlagRemaining===0;
    this.tickLedgeJumpClearance();
    this.itemLockedInput=null;
    this.donkeykongOrdinaryVerticalTick=false;
    this.donkeykongOpeningCarryY=null;
    this.donkeykongOrdinaryEntryVelocityY=null;
    if(this.shieldPushApplied!==0&&this.hitlagRemaining===0){
      this.scene.matter.body.setVelocity(this.body,{x:this.body.velocity.x-this.shieldPushApplied,y:this.body.velocity.y});
      this.shieldPushApplied=0;
    }
    if(this.grabState.name==='holding'&&this.grabState.active?.cargo)
      input={...input,special:false,shield:false,dodge:false,appeal:false,attackHeavy:false,
        jump:input.jump&&canCargoJump(this.isGrounded())};
    // Match supplies its fixed frame so target-side status installation is
    // independent of whether the captor or captive receives input first.
    this.simulationInputFrame = simulationFrame ?? this.simulationInputFrame + 1;
    this.advanceSourceGlobalPresentationClock(Math.max(0,this.simulationInputFrame));
    if(this.finalVictimPresentation?.kind==='impact-stop')this.finalVictimPresentation=stepFinalImpactVictimPresentation(this.finalVictimPresentation,{
      frame:Math.max(0,this.simulationInputFrame),victimGeneration:this.positionResetGeneration,
      genuineVictimHitstop:this.hitlagRemaining>0&&this.lastFinalReactionRun===this.finalVictimPresentation.runId,
      ownStopPresentationAdvances:true,globallyPaused:false,interrupted:false});
    this.retireSourceDamagePresentationIfUnowned();
    if(this.sourceDamagePresentation&&this.simulationInputFrame>this.sourceDamagePresentation.lastAdvancedFrame){
      if(this.sourceDamagePresentation.generation!==this.positionResetGeneration)this.sourceDamagePresentation=null;
      else this.sourceDamagePresentation={...this.sourceDamagePresentation,lastAdvancedFrame:this.simulationInputFrame,
        framesElapsed:this.sourceDamagePresentation.framesElapsed+(this.hitlagRemaining===0?1:0)};
    }
    // Already-admitted healing belongs to the actor's advancing step, not a
    // later ordinary action branch. Actual pre-decrement hitstop still freezes.
    const healing=stepHealing(this.itemHealing,this.damagePercent,this.isInHitlag());
    this.itemHealing=healing.state;this.damagePercent=healing.percent;

    if(this.shieldBreak){const prior=this.shieldBreak,stopped=this.hitlagRemaining>0;
      const mashBefore=this.shieldBreakMash??initialCaptureMash(input);
      const mash=!stopped&&prior.phase==='loop'?tickCaptureMash(mashBefore,input,this.simulationInputFrame,SHIELD_BREAK_MASH_WEIGHTS):
        {...mashBefore,previousHeld:initialCaptureMash(input).previousHeld};
      this.shieldBreakMash=mash;
      const tailNewOwner=prior.phase==='tail'&&(this.activeAttack!==null||this.sourceIntrinsicActionCommitted()||this.finalSmashControl!==null||
        this.itemAction!==null||this.itemShooting!==null||this.grabState.active!==null||this.tauntPresentation!==null||
        Math.abs(input.moveX)>.1||Math.abs(input.moveY??0)>.1||this.getJumpsquatRemaining()>0||isShieldRaised(this.shieldState)||!['idle','cooldown'].includes(this.dodgeState.name));
      const next=stepShieldBreak(prior,{frame:this.simulationInputFrame,generation:this.positionResetGeneration,
        clockAdvances:!stopped,grounded:this.isGrounded(),landingOrientation:this.knockdownRemaining>0&&this.knockdownFaceDown?'face-down':'face-up',
        mashReduction:mash.reduction-mashBefore.reduction,interruption:this.grabbedBy?'capture':this.finalSmashControl||tailNewOwner?'new-action':null});
      this.shieldBreak=next.state;
      if(!next.state){this.clearSourceShieldBreak(true);}
      else if(next.events.some(e=>e.kind==='actionable')){
        // Existing postBreakHealth transition restores ordinary shield admission
        // at raw33, while its natural end50 visual tail remains tangible.
        this.shieldState=tickShield({...this.shieldState,stunRemaining:0},{held:false},this.tuning.shield);this.shieldBreakMash=null;
      }
      if(this.shieldBreak&&shieldBreakControlsLocked(this.shieldBreak)){
        this.shieldState={...this.shieldState,name:'broken',health:0,blockStunRemaining:0,
          stunRemaining:this.shieldBreak.phase==='loop'?this.shieldBreak.loopRemaining:0};
        if(stopped){this.scene.matter.body.setVelocity(this.body,{x:0,y:0});this.hitlagRemaining-=1;
          if(this.hitlagRemaining===0){this.hitlagPosition=null;this.attackerHitlagVelocity=null;}}
        if(this.shieldBreak.phase!=='pop')this.scene.matter.body.setVelocity(this.body,{x:0,y:0});
        this.lockPikachuSourceRecoveryInput(input);this.prevAppealHeld=input.appeal===true;return;
      }
    }
    if (this.finalSmashControl) {
      this.prevJumpHeld = !!input.jump;
      this.prevSpecialHeld = !!input.special;
      this.prevAttackHeld = !!input.attack;
      this.prevHeavyHeld = !!input.attackHeavy; this.prevShieldHeld = !!input.shield;
      this.prevDodgeHeld = !!input.dodge; this.prevGrabHeld = !!input.grab; this.prevAppealHeld = !!input.appeal;
      this.prevMoveX = clamp(input.moveX, -1, 1); this.prevMoveY = clamp(input.moveY ?? 0, -1, 1);
      if (this.hitlagRemaining > 0) this.hitlagRemaining -= 1;
      const control = this.finalSmashControl;
      if (control.velocity && this.hitlagRemaining === 0)
        this.scene.matter.body.setVelocity(this.body, control.inheritVerticalVelocity?
          {x:control.velocity.x,y:this.body.velocity.y}:control.velocity);
      return;
    }
    const tail=this.finalSmashBodyTail;
    if(tail){
      const superseded=input.jump||input.attack===true||input.attackHeavy===true||input.special===true||
        input.shield===true||input.dodge===true||input.grab===true||input.appeal===true||Math.abs(input.moveX)>.1||
        Math.abs(input.moveY??0)>.1||(!tail.sheet.includes('air')&&!this.isGrounded())||this.hitstunRemaining>0||this.activeAttack!==null||this.grabbedBy!==null;
      if(superseded)this.finalSmashBodyTail=null;
      else if(this.hitlagRemaining===0&&this.simulationInputFrame!==tail.bornFrame){
        tail.age+=tail.advance;
        const pose=finalBodyPose(this.id,tail.sheet,Math.min(tail.age,tail.endAge));
        if(pose){const p=this.getPosition();this.scene.matter.body.setPosition(this.body,
          {x:p.x+(pose.rootDelta.x-tail.previousDelta.x)*tail.facing,y:p.y+pose.rootDelta.y-tail.previousDelta.y});
          tail.previousDelta={...pose.rootDelta};}
        if(tail.age>=tail.endAge)this.finalSmashBodyTail=null;
      }
    }
    const passive=this.linkPassiveGuard;
    if(passive){
      const stopped=this.hitlagRemaining>0;
      if(passive.generation!==this.positionResetGeneration||this.grabbedBy||!this.isGrounded()||this.hitstunRemaining>0)
        this.linkPassiveGuard=null;
      else{
        if(!stopped&&this.simulationInputFrame>passive.lastFrame)passive.framesElapsed+=1;
        passive.lastFrame=this.simulationInputFrame;
        const ordinaryIntent=input.jump||input.attack||input.attackHeavy||input.special||input.shield||input.dodge||input.grab||input.appeal||
          Math.abs(input.moveX)>.1||(!passive.crouchedAtEntry&&(input.moveY??0)<-.3);
        // Selected CancelModule adapter is separate from standing natural20:
        // after cancel4 a new ordinary owner may interrupt the uncommitted tail.
        if(passive.framesElapsed>=passive.duration||(!stopped&&passive.framesElapsed>=4&&ordinaryIntent))this.linkPassiveGuard=null;
        else if(passive.framesElapsed<4||stopped)input=this.lockSourceIntrinsicInput(input);
      }
    }
    input=this.filterSourceIntrinsicInput(input,this.simulationInputFrame);
    const hammer=this.equippedItem?.definition.hammer;
    const hammerState=this.equippedItem?.getHammerState?.();
    if(hammer && hammerState && !this.destroyed){
      const next=stepHammer(hammer,hammerState).state;
      this.equippedItem?.setHammerState?.({...next,motionElapsed:this.isInHitlag()||this.hitstunRemaining>0||this.grabbedBy?hammerState.motionElapsed:next.motionElapsed});
      // Expiry restores native input on this exact step, including smash presses. Scene removes the old inventory object.
      if(next.elapsed>=hammer.durationFrames)this.unequipItem();
    }
    if(this.isHammerLocked()){
      const raw=input;this.itemLockedInput=raw;
      const goldenTap=hammer!.golden&&!this.isGrounded()&&input.jump&&!this.prevJumpHeld;
      if(goldenTap && !this.isInHitlag() && this.hitstunRemaining===0 && !this.grabbedBy)
        this.scene.matter.body.setVelocity(this.body,{x:this.body.velocity.x,y:Math.min(this.body.velocity.y,hammer!.floatVelocity)});
      input={...input,moveY:0,jump:input.jump&&(this.isGrounded()||this.jumpsquatRemaining>0),
        attack:false,attackHeavy:false,special:false,shield:false,dodge:false,grab:false,appeal:false,dropThrough:false};
      this.offensiveActionBuffer=null;
    }
    if (this.holdOnRevivalPlatform(input)) return;
    try {
      this.applyInputStep(input);
    } finally {
      if(this.sourceCargoEntry&&(!this.grabTarget||this.grabState.name!=='holding'||!this.grabState.active?.cargo||!this.isGrounded()||
        this.jumpsquatRemaining>0||this.jumpPresentation!==null||
        (!this.grabState.active.cargoStartupRemaining&&Math.abs(input.moveX)>0&&this.sourceCargoEntry.lastFrame===this.simulationInputFrame)))this.sourceCargoEntry=null;
      // Buffered jumps/other owners may begin after the entry observation.
      // They retire a retained tail on that same input step.
      if(this.donkeykongJabContinuation&&(this.activeAttack!==null||this.jumpsquatRemaining>0||this.jumpPresentation!==null||
        this.chargingSpecial!==null||this.chargingSmash!==null||this.grabbedBy!==null||isGrabActing(this.grabState)||
        this.shieldState.name!=='idle'||isDodgeActing(this.dodgeState)||isLedgeLockingInput(this.ledgeHangState)||
        this.itemAction!==null||this.donkeykongHeavyItemAction!==null||this.tauntPresentation!==null))
        this.donkeykongJabContinuation=null;
      if((this.activeAttack!==null&&this.activeAttack.move.type!=='aerial')||this.chargingSpecial!==null||this.chargingSmash!==null||
        this.grabbedBy!==null||this.buriedState!==null||isGrabActing(this.grabState)||
        isLedgeLockingInput(this.ledgeHangState)||isDodgeLockingInput(this.dodgeState)||
        this.surfaceTech!==null||this.groundRecovery!==null||this.hitstunRemaining>0)
        this.donkeykongFullHopStep=null;
      // Every lockout/commitment path retires the old ordinary entry too.
      this.prevAppealHeld = input.appeal === true;
      this.lastCaptureInput = input;
      if (!this.canPresentUncommittedBody()) { this.pikachuCrouchCrawl = null; this.pikachuTurnBrake = null; }
      if(this.id==='donkeykong'&&!this.canPresentUncommittedBody())this.donkeykongTurnBrake=null;
      if (this.pikachuAuxiliaryAir && (this.isGrounded() || !this.canPresentUncommittedBody())) this.pikachuAuxiliaryAir = null;
      if (this.pikachuRespawnPresentation && (!this.canPresentUncommittedBody() || this.jumpPresentation ||
          this.pikachuAuxiliaryAir || Math.abs(input.moveX)>.1 || Math.abs(input.moveY??0)>.1)) this.pikachuRespawnPresentation=null;
      if (this.pikachuLedgeJump?.phase==='flight' && (!this.canPresentUncommittedBody() || this.jumpPresentation || this.pikachuAuxiliaryAir || this.isGrounded())) {
        this.pikachuLedgeJump=null;this.clearPikachuLedgeAttachment();
      }
      this.syncObservedPresentation(false);
      this.syncDonkeyKongCatchCollisionPose();
      // applyInputStep may install this snapshot; method side effects are not
      // tracked by TypeScript's null narrowing from the entry reset above.
      const itemLockedInput=this.itemLockedInput as CharacterInput|null;
      if(itemLockedInput){
        const raw=itemLockedInput;
        this.prevJumpHeld=raw.jump;this.prevAttackHeld=raw.attack===true;this.prevHeavyHeld=raw.attackHeavy===true;
        this.prevSpecialHeld=raw.special===true;this.prevShieldHeld=raw.shield===true;this.prevDodgeHeld=raw.dodge===true;
        this.prevGrabHeld=raw.grab===true;this.prevAppealHeld=raw.appeal===true;
      }
      this.donkeykongOrdinaryEntryVelocityY=null;
    }
  }

  private applyInputStep(input: CharacterInput): void {
    if (this.destroyed) return;
    this.prepareDonkeyKongJabContinuation(input);
    if (this.hitlagRemaining === 0 && this.postReleaseGrabImmunity.remaining > 0 &&
        this.postReleaseGrabImmunity.lastFrame !== this.simulationInputFrame) {
      this.postReleaseGrabImmunity.remaining -= 1;
      this.postReleaseGrabImmunity.lastFrame = this.simulationInputFrame;
    }
    this.attackClankLockedStep = false;
    this.throwReleaseInvincible = false;
    this.reactionCue = null;
    this.pikachuSpecialStick = { x: input.moveX, y: input.moveY ?? 0 };
    this.pikachuSpecialHeld = input.special === true;
    if (this.pikachuWallBounceContact && (this.isGrounded() || this.pikachuWallBounceSurface()?.wall !== this.pikachuWallBounceContact)) this.pikachuWallBounceContact = null;
    this.referenceStunnedStep = this.hitstunRemaining > 0;
    // The ground-only jump expires when support is lost, including during
    // hitlag/hitstun or capture. Observe it before those input lockouts return.
    // Deliberate airborne spawns retain their configured starting budget.
    if (!this.isGrounded() && this.prevGrounded && this.jumpsUsed === 0) {
      this.jumpsUsed = 1;
    }
    this.airtimeFrames = this.isGrounded() ? 0 : this.airtimeFrames + 1;
    this.prePhysicsVelocityY = null;
    this.updateOffensiveActionBuffer(input);
    this.updateJumpInputBuffer(input);
    // Placed objects have their own simulation clock, including while their
    // owner is captured, in hitlag, or stunned. Global pause skips this step.
    this.tickTraps();

    // ---- Drop-through window bookkeeping ----------------------------------
    // Arm the temporary "ignore pass-through platforms" window when
    // the input layer reports a fresh double-tap-down gesture
    // (`input.dropThrough === true` for one frame). The collision-
    // active handler vetoes pass-through pairs while
    // `dropThroughFramesRemaining > 0`. 10 frames @ 60 Hz ≈ 167 ms —
    // long enough for the body to clear a thin platform's height even
    // at low fall speed, short enough that the window doesn't bleed
    // into the next platform below.
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
      if (this.hitlagRemaining === 0) {
        this.tickCapturePresentation();
        this.grabbedBy.acceptUltimateCaptureMash(this, input);
      } else this.grabbedBy.acceptUltimateCaptureMash(this, input, true);
      // Captive hit-stop uses the same fixed clock without permitting SDI,
      // launching or input. Otherwise a pummel/throw pre-hit freeze survives
      // indefinitely until the eventual release.
      if (this.hitlagRemaining > 0 && --this.hitlagRemaining === 0) {
        this.hitlagPosition = null;
        this.attackerHitlagVelocity = null;
        this.pikachuLedgeFlightHitlagRelease=false;
      }
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

    // Tech intent must survive hitlag's button latching. Its fixed-frame
    // window begins on the press, including when a hard launch is queued.
    this.updateTechInputBuffer(input);

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
    if (this.hitlagRemaining > 0 || this.pendingKnockback !== null) {
      const allowsSDI = this.hitlagRemaining > 0;
      this.hitlagRemaining = Math.max(0, this.hitlagRemaining - 1);
      // Pin position by zeroing velocity each freeze frame. `setVelocity`
      // (vs. mutating `.velocity`) keeps Matter's previous-position cache
      // coherent so the integrator doesn't blink on freeze-end.
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      // ---- SDI (Smash Directional Influence) ----------------------------
      // Only the victim has a queued launch. Ordinary SDI changes position
      // during real hitlag; zero-hitlag release does not synthesize ASDI.
      if (this.pendingKnockback && allowsSDI) {
        const sdi = stepReferenceSdi(this.sdiState,
          { x: input.moveX, y: input.moveY ?? 0 }, this.sdiMultiplier);
        this.sdiState = sdi.state;
        if (sdi.pulsed) {
          const pos = this.body.position;
          this.scene.matter.body.setPosition(this.body, {
            x: pos.x + sdi.displacement.x,
            y: pos.y + sdi.displacement.y,
          });
        }
      }
      if (this.hitlagRemaining === 0 && this.pendingKnockback) {
        if (this.pendingKnockback.trip) {
          const soft = this.pendingKnockback.softTrip === true;
          this.pendingKnockback = null;
          this.hitlagPosition = null;
          this.hitstunRemaining = 0;
          this.applyTrip(soft);
          this.prevJumpHeld = input.jump;
          this.prevAttackHeld = input.attack === true;
          this.prevHeavyHeld = input.attackHeavy === true;
          this.prevSpecialHeld = input.special === true;
          this.prevShieldHeld = input.shield === true;
          this.prevDodgeHeld = input.dodge === true;
          this.prevGrabHeld = input.grab === true;
          return;
        }
        // Sample influence once when hitlag drains to zero. Authored reference
        // launches apply DI then LSI to the gravity-boosted launch component;
        // carry and the precomputed hitstun/gravity branch remain separate.
        const queued = this.pendingKnockback.vector;
        const magnitude = Math.hypot(queued.x, queued.y);
        let releaseVx = queued.x;
        let releaseVy = queued.y;
        const tumble = this.pendingKnockback.tumble ?? magnitude >= TUMBLE_KNOCKBACK_THRESHOLD;
        if (this.pendingKnockback.autolink) {
          // SDI already moved the recipient this release step. A contextual
          // linking hit uses position pull, independent of ordinary DI/LSI.
          const pulled = referenceAutolinkVelocity(this.pendingKnockback.autolink, this.body.position);
          releaseVx = pulled.x;
          releaseVy = pulled.y;
        } else if (this.pendingKnockback.referenceLaunch) {
          const influenced = applyReferenceLaunchInfluence(queued, {
            stickX: input.moveX, stickY: input.moveY ?? 0,
          }, tumble);
          releaseVx = influenced.x;
          releaseVy = influenced.y;
        } else if (tumble) {
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
        const carry = this.pendingKnockback.autolink ? undefined : this.pendingKnockback.velocityCarry;
        this.scene.matter.body.setVelocity(this.body, {
          x: releaseVx + (carry?.x ?? 0),
          y: releaseVy + (carry?.y ?? 0),
        });
        // Transport from a linking hit is ordinary motion: only the authored
        // knockback component decays or qualifies for DI/LSI/tumble.
        this.launchVelocity = { x: releaseVx, y: releaseVy };
        this.launchDecayPerFrame = this.pendingKnockback.launchDecayPerFrame;
        this.referenceLaunch = this.pendingKnockback.referenceLaunch
          ? { ...this.pendingKnockback.referenceLaunch, gravityY: 0, firstStep: true, groupIndex: 0, interrupted: false }
          : null;
        this.referenceStunnedStep = true;
        this.hitstunGravityVelocityY = 0;
        this.hitstunRemaining = this.pendingKnockback.hitstunFrames;
        // A hard launch sends the fighter into TUMBLE — the state that can
        // be teched on ground contact (and otherwise knocks them down).
        this.tumbling = tumble;
        this.pendingKnockback = null;
        this.attackerHitlagVelocity = null;
        this.pikachuLedgeFlightHitlagRelease=false;
      } else if (this.hitlagRemaining === 0 && this.attackerHitlagVelocity) {
        if (this.pikachuLedgeJump?.phase==='flight') {
          // This source cue advances only on an unfrozen input step. Keep its
          // physical flight frozen through the final skipped-clock step too.
          this.pikachuLedgeFlightHitlagRelease=true;
          this.scene.matter.body.setVelocity(this.body,{x:0,y:0});
        } else {
          const resumed = { ...this.attackerHitlagVelocity };
          // A sampled throw/recovery delta belongs to its action age, which did not tick
          // during this freeze-release early return. Replaying it would transport
          // the previous sample twice. Normal velocity carry remains unchanged.
          if (this.throwRootMotionApplied || this.pikachuGroundRecovery) resumed.x = 0;
          if(this.surfaceTech?.kind==='ceiling'&&SURFACE_TECH_PROFILES[this.id].ceilingRootDeltas){resumed.x=0;resumed.y=0;}
          // This release step skips normal input shaping but Matter still
          // integrates it. Resume the same authored gravity and terminal cap,
          // preserving platform support and externally supplied excess speed.
          const supported = this.isGrounded() || this.platformFallSupported;
          this.platformFallSupported = false;
          const flight = this.getSustainedUpSpecialRise();
          const specialGravity = (flight !== null &&
            this.activeAttack!.framesElapsed < flight.gravityFrames)||
            (this.donkeykongOrdinaryVertical!==null&&this.activeAttack?.move.gravityScale!==undefined);
          const dkReleaseNeutralDodge=this.id==='donkeykong'&&this.dodgeState.active?.kind==='air'&&!this.dodgeState.active.directional;
          const dkReleaseRelax=dkReleaseNeutralDodge||this.itemAction?.plan.action.startsWith('throw-air-')===true;
          if(!supported&&this.referenceLaunch===null&&!specialGravity&&this.donkeykongOrdinaryVertical&&
            this.activeAttack?.move.gravityScale===undefined&&(!isDodgeLockingInput(this.dodgeState)||dkReleaseNeutralDodge)&&
            !isLedgeLockingInput(this.ledgeHangState)){
            this.donkeykongOrdinaryVerticalTick=true;
            // The final skipped input step does not consume another opening
            // sample. Keep its location frozen, then resume the next sample.
            if(this.donkeykongFullHopStep!==null)resumed.y=0;
            else{
              const entry=resumed.y;
              if(dkReleaseRelax&&resumed.y>this.tuning.maxFallSpeed)
                resumed.y=Math.max(this.tuning.maxFallSpeed,resumed.y-DONKEYKONG_VERTICAL_PARAMETERS.excessFallBrakeNative*DONKEYKONG_VERTICAL_PARAMETERS.worldUnitsPerNativeUnit);
              else resumed.y+=this.donkeykongOrdinaryVertical.totalGravity;
              const terminal=this.fastFallLatched?this.tuning.fastFallSpeed:this.tuning.maxFallSpeed;
              if(this.fastFallLatched&&resumed.y>0&&resumed.y<terminal)resumed.y=terminal;
              resumed.y=Math.min(resumed.y,Math.max(terminal,entry));
            }
          }else if (!supported && this.referenceLaunch === null && !specialGravity) {
            const rising = resumed.y < 0;
            if (rising && !isLedgeLockingInput(this.ledgeHangState)) {
              resumed.y += this.airJumpRising
                ? this.tuning.airJumpRiseAccel ?? this.tuning.riseAccel ?? 0
                : this.shortHopRising
                  ? this.tuning.shortHopRiseAccel ?? this.tuning.riseAccel ?? 0
                  : this.tuning.riseAccel ?? 0;
            }
            if (resumed.y >= 0) {
              this.shortHopRising = false;
              this.airJumpRising = false;
            }
            const entryVy = resumed.y;
            if (resumed.y > 0 && !rising) resumed.y += this.tuning.fallAccel;
            const terminal = this.fastFallLatched ? this.tuning.fastFallSpeed : this.tuning.maxFallSpeed;
            if (this.fastFallLatched && resumed.y > 0 && resumed.y < terminal) resumed.y = terminal;
            resumed.y = Math.min(resumed.y, Math.max(terminal, entryVy));
          }
          this.prePhysicsVelocityY = resumed.y;
          this.scene.matter.body.setVelocity(this.body, resumed);
          if (this.referenceLaunch !== null) {
            if (this.referenceStunnedStep) {
              this.referenceLaunch.groupIndex += 1;
              this.hitstunRemaining = Math.max(0, this.hitstunRemaining - 1);
            } else this.applyLaunchVelocityDecay();
          }
          this.attackerHitlagVelocity = null;
          this.pikachuLedgeFlightHitlagRelease=false;
        }
      }
      this.hitlagPosition = this.hitlagRemaining > 0 || this.pikachuLedgeFlightHitlagRelease
        ? { x: this.body.position.x, y: this.body.position.y }
        : null;
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack ?? false;
      this.prevHeavyHeld = input.attackHeavy ?? false;
      this.prevSpecialHeld = input.special ?? false;
      this.prevShieldHeld = input.shield ?? false;
      this.prevDodgeHeld = input.dodge ?? false;
      this.prevGrabHeld = input.grab ?? false;
      return;
    }

    if(this.pikachuLedgeFlightHitlagRelease){
      if(this.pikachuLedgeJump?.phase==='flight' && this.attackerHitlagVelocity)
        this.scene.matter.body.setVelocity(this.body,this.attackerHitlagVelocity);
      this.pikachuLedgeFlightHitlagRelease=false;
      this.attackerHitlagVelocity=null;this.hitlagPosition=null;
    }
    input=this.stepDonkeyKongPunchInput(input);
    input=this.stepRecoveryInput(input);
    input=this.stepItemInput(input);
    input=this.stepDonkeyKongHeavyItemInput(input);
    input=this.stepDonkeyKongHeavyCarryInput(input);
    if(this.donkeykongFootstoolCooldown>0&&this.donkeykongFootstoolCooldownEntryFrame!==this.simulationInputFrame)
      this.donkeykongFootstoolCooldown-=1;
    if(this.buriedState){
      const step=tickBuriedState(this.buriedState,{input,grounded:this.isGrounded()});this.buriedState=step.state;
      this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
      if(step.launch){this.pendingKnockback=step.launch;this.hitlagRemaining=0;this.hitlagPosition=null;}
      if(step.releaseKind==='escape-jump')this.scene.matter.body.setVelocity(this.body,{x:0,y:-(this.tuning.shortHopImpulse??this.tuning.jumpImpulse*.5)});
      if(this.buriedState){if(this.buriedState.phase==='buried')this.scene.matter.body.setVelocity(this.body,{x:0,y:0});this.lockPikachuSourceRecoveryInput(input);return;}
      if(step.launch){this.lockPikachuSourceRecoveryInput(input);return;}
    }
    if(this.groundRecovery&&!this.isGrounded())this.groundRecovery=null;
    if(this.groundRecovery){
      const state=this.groundRecovery,next=state.framesElapsed+1;
      this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
      if(next<state.duration){
        const a=getPackedBodyRootDelta(this.id,state.sheet,state.framesElapsed),b=getPackedBodyRootDelta(this.id,state.sheet,next);
        state.framesElapsed=next;
        const vx=a&&b?(b.x-a.x)*state.facing:state.travelDirection===undefined?0:state.travelDirection*GETUP_ROLL_SPEED;
        this.scene.matter.body.setVelocity(this.body,{x:vx,y:a&&b?b.y-a.y:0});
        this.lockPikachuSourceRecoveryInput(input);return;
      }
      this.groundRecovery=null;
      this.scene.matter.body.setVelocity(this.body,{x:0,y:this.body.velocity.y});
    }

    // This is observed jump-entry age, not a native motion/status selector.
    // Captive and hitlag steps return above and do not advance its clock.
    if (this.jumpPresentation) this.jumpPresentation.framesElapsed += 1;
    this.advanceRespawnPresentation();
    if (this.equippedItem) this.heldItemCarryAge=(this.heldItemCarryAge+1)%106;
    if (this.pikachuFootstoolVisual && this.pikachuFootstoolVisual.entryFrame !== this.simulationInputFrame) {
      const age=this.pikachuFootstoolVisual.age+1;
      this.pikachuFootstoolVisual=age<6 ? {...this.pikachuFootstoolVisual,age} : null;
    }
    if(this.donkeykongFootstoolPerformer&&this.donkeykongFootstoolPerformer.entryFrame!==this.simulationInputFrame){
      const next=this.donkeykongFootstoolPerformer.framesElapsed+1;
      this.donkeykongFootstoolPerformer=next<9&&!this.isGrounded()?{...this.donkeykongFootstoolPerformer,framesElapsed:next}:null;
    }
    if (this.pikachuAuxiliaryAir) {
      const next = this.pikachuAuxiliaryAir.framesElapsed + 1;
      this.pikachuAuxiliaryAir = next < (pikachuAuxiliaryBodyEndExclusive(this.pikachuAuxiliaryAir.sheet) ?? 0)
        ? {...this.pikachuAuxiliaryAir, framesElapsed:next} : null;
    }
    this.tickCapturePresentation();
    this.advanceSourceLinkFootstoolPresentation();
    if (this.footstoolMini) {
      const mini = this.footstoolMini;
      if (!mini.cut && mini.framesElapsed < 3 && !input.jump && this.body.velocity.y < 0) {
        this.scene.matter.body.setVelocity(this.body, {x:this.body.velocity.x,
          y:Math.max(this.body.velocity.y,this.id==='link'?linkFootstoolJumpVelocity(mini.basis,true,Math.max(0,this.sourceLinkFootstoolRepeatCount-1)):this.id==='donkeykong'?donkeyKongFootstoolJumpVelocity(mini.basis,true,Math.max(0,this.donkeykongFootstoolRepeatCount-1)):-mini.basis*PIKACHU_AUXILIARY_SOURCE_PARAMETERS.footstoolMiniJumpSpeedYMultiplier)});
        if(this.donkeykongFootstoolPerformer)this.donkeykongFootstoolPerformer.mini=true;
        if(this.sourceLinkFootstool?.presentation.role==='performer')this.sourceLinkFootstool.mini=true;
        mini.cut=true;
      }
      mini.framesElapsed += 1;
      if (mini.framesElapsed >= 3) this.footstoolMini=null;
    }
    if (this.tickGrabReleaseInput(input)) return;
    this.syncObservedPresentation(true);
    if (this.attackClankRemaining > 0) {
      this.attackClankLockedStep = true;
      this.attackClankRemaining -= 1;
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack === true;
      this.prevHeavyHeld = input.attackHeavy === true;
      this.prevSpecialHeld = input.special === true;
      this.prevShieldHeld = input.shield === true;
      this.prevDodgeHeld = input.dodge === true;
      this.prevGrabHeld = input.grab === true;
      return;
    }
    // Parry shieldstun begins after hit-stop and remains fully protected.
    // The final locked step stays protected; the next input step clears it.
    if (this.shieldParryStunRemaining > 0) {
      this.shieldParryStunRemaining -= 1;
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      this.prevJumpHeld = input.jump;
      this.prevAttackHeld = input.attack === true;
      this.prevHeavyHeld = input.attackHeavy === true;
      this.prevSpecialHeld = input.special === true;
      this.prevShieldHeld = input.shield === true;
      this.prevDodgeHeld = input.dodge === true;
      this.prevGrabHeld = input.grab === true;
      return;
    }
    this.shieldParryProtected = false;

    // Restore ordinary falling before a fresh jump/dodge/special takes ownership.
    // Apply a saved delta so wind injected after the last physics step survives.
    if (this.pendingHitstunGravityCorrection > 0) {
      this.scene.matter.body.setVelocity(this.body, {
        x: this.body.velocity.x,
        y: this.body.velocity.y - this.pendingHitstunGravityCorrection,
      });
      this.pendingHitstunGravityCorrection = 0;
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

    // Shared surface tech: wall / ceiling hold the body (gravity, or the ceiling root
    // track) and lock input; the wall-jump flight is actionable after its entry step.
    if(this.surfaceTech){
      const previous=this.surfaceTech,next=tickSurfaceTech(previous,{grounded:this.isGrounded()});
      if(!next)this.clearSurfaceTech();
      else{
        this.surfaceTech=next;
        if(!surfaceTechActionable(next)){
          // Live collision blockage of the ceiling track is retained without catch-up.
          this.scene.matter.body.setVelocity(this.body,surfaceTechCeilingDisplacement(previous,next,SURFACE_TECH_PROFILES[this.id])??
            {x:this.body.velocity.x,y:Math.min(this.body.velocity.y+this.tuning.fallAccel,this.tuning.maxFallSpeed)});
          this.lockPikachuSourceRecoveryInput(input);return;
        }
        // Available fresh actions replace retained flight. Exhausted resources
        // leave its dedicated drawing live.
        if((this.hasJumpIntent(input)&&this.jumpsUsed<this.tuning.maxJumps)||
          (input.attack===true&&!this.prevAttackHeld&&this.canAttack())||
          (input.special===true&&!this.prevSpecialHeld&&this.canAttack())||
          (input.dodge===true&&!this.prevDodgeHeld&&!this.airDodgeUsed)||this.pendingFootstoolJump)
          this.surfaceTech=null;
      }
    }

    if (this.pikachuLedgeJump) {
      const previous=this.pikachuLedgeJump,next=advancePikachuLedgeJump(previous);
      this.pikachuLedgeJump=next?{...previous,...next}:null;
      if (next?.phase==='start') {this.lockPikachuSourceRecoveryInput(input);return;}
      if (previous.phase==='start' && next?.phase==='flight') {
        this.clearPikachuLedgeAttachment();
        const impulse=pikachuLedgeJumpBetaImpulse(this.pikachuLastGravityDose+(this.tuning.riseAccel??0));
        this.scene.matter.body.setVelocity(this.body,{x:PIKACHU_LEDGE_JUMP_SOURCE_TRAVEL.speedX*next.facing,y:-impulse});
        this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
        this.fastFallLatched=false;this.jumpCutArmed=false;this.airJumpRising=false;this.shortHopRising=false;
      }
    }

    // Source-guided Pikachu ground recovery owns one unfrozen action clock.
    // Clocks advance after the hitlag early return; real loss of support retires
    // this ground-only owner rather than allowing an airborne wakeup.
    if (this.pikachuGroundRecovery) {
      this.jumpInputBufferFrames = 0;
      this.tapJumpBufferFrames = 0;
      this.offensiveActionBuffer = null;
      const previous = this.pikachuGroundRecovery;
      const next = this.isGrounded() ? advancePikachuGroundRecovery(previous) : null;
      this.pikachuGroundRecovery = next;
      if (next) {
        this.scene.matter.body.setVelocity(this.body, pikachuGroundRecoveryVelocity(previous, next));
        this.prevJumpHeld = input.jump;
        this.prevAttackHeld = input.attack === true;
        this.prevHeavyHeld = input.attackHeavy === true;
        this.prevSpecialHeld = input.special === true;
        this.prevShieldHeld = input.shield === true;
        this.prevDodgeHeld = input.dodge === true;
        this.prevGrabHeld = input.grab === true;
        this.prevMoveX = clamp(input.moveX, -1, 1);
        this.prevMoveY = clamp(input.moveY ?? 0, -1, 1);
        this.prevGrounded = this.isGrounded();
        return;
      }
      this.scene.matter.body.setVelocity(this.body, {x: 0, y: this.body.velocity.y});
    }

    if (this.footstoolRecipient) {
      const recovery=this.footstoolRecipient;
      const landed=!recovery.grounded && this.isGrounded();
      const elapsed=this.simulationInputFrame===recovery.entryFrame ? recovery.framesElapsed : recovery.framesElapsed+1;
      const duration=this.id==='link'?recovery.grounded?this.sourceLinkFootstoolRecipientSide==='back'?21:9:LINK_FOOTSTOOL_SOURCE.airRecipientRecoveryFrames:
        recovery.grounded ? 9 : this.id==='donkeykong'?DONKEYKONG_FOOTSTOOL_PARAMETERS.airRecipientRecoveryFrames:PIKACHU_AUXILIARY_SOURCE_PARAMETERS.footstoolFallRecoveryFrames;
      this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
      if (landed || elapsed>=duration) {
        this.footstoolRecipient=null;
        if(!recovery.grounded||landed)this.sourceLinkFootstool=null;
        if (!landed) this.clearTumbleForStartedAction();
      }
      else {
        recovery.framesElapsed=elapsed;
        this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
        if (recovery.grounded) this.scene.matter.body.setVelocity(this.body,{x:0,y:0});
        this.prevJumpHeld=input.jump;this.prevAttackHeld=input.attack===true;
        this.prevHeavyHeld=input.attackHeavy===true;this.prevSpecialHeld=input.special===true;
        this.prevShieldHeld=input.shield===true;this.prevDodgeHeld=input.dodge===true;this.prevGrabHeld=input.grab===true;
        this.prevMoveX=clamp(input.moveX,-1,1);this.prevMoveY=clamp(input.moveY??0,-1,1);
        this.prevGrounded=this.isGrounded();return;
      }
    }

    // A floor knockdown owns its pin only while it has real support. Wind,
    // moving platforms or a disappearing floor can remove that support.
    // Reuse airborne tumble/landing resolution rather than cancelling gravity
    // every step or allowing a floor getup in midair (authored integration).
    if (this.knockdownRemaining > 0 && !this.isGrounded()) {
      this.knockdownRemaining = 0;
      this.tripped = false;
      this.tumbling = true;
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
    // After hitstun, only a successfully started action cancels tumble;
    // an exhausted jump or unavailable move must still resolve on landing.
    if (this.tumbling) {
      if(!this.isGrounded()){
        const surface=this.surfaceTechContact();
        const launch=this.launchVelocity??this.body.velocity;
        const kind=surface?selectSurfaceTech({surface:surface.kind,airborne:true,tumbling:this.tumbling,
          hitstunRemaining:this.hitstunRemaining,bufferRemaining:this.techBufferRemaining,
          lockoutRemaining:this.techLockoutRemaining,launchSpeedPixels:Math.hypot(launch.x,launch.y),jumpHeld:input.jump}):null;
        if(kind&&surface){
          const incomingX=this.body.velocity.x,profile=SURFACE_TECH_PROFILES[this.id];
          this.clearReferenceLaunch();this.launchVelocity=null;this.hitstunRemaining=0;this.pendingKnockback=null;
          this.referenceStunnedStep=false;this.pendingHitstunGravityCorrection=0;this.hitstunGravityVelocityY=0;
          this.clearTumbleForStartedAction();this.pikachuAuxiliaryAir=null;this.jumpPresentation=null;
          this.fastFallLatched=false;this.jumpCutArmed=false;this.airJumpRising=false;this.shortHopRising=false;
          this.surfaceTech=beginSurfaceTech(kind,this.facing,surface.outward,profile);
          if(kind==='ceiling'&&profile.ceilingRootDeltas){
            this.surfaceTechGravityRestore=this.body.ignoreGravity??false;
            this.body.ignoreGravity=true;this.scene.matter.body.setVelocity(this.body,{x:0,y:0});
          }else this.scene.matter.body.setVelocity(this.body,surfaceTechEntryVelocity(this.surfaceTech,profile,incomingX));
          this.lockPikachuSourceRecoveryInput(input);return;
        }
      }
      if (this.isGrounded()) {
        this.tumbling = false;
        this.hitstunRemaining = 0;
        this.launchVelocity = null;
        this.referenceLaunch = null;
        this.hitstunGravityVelocityY = 0;
        const buffered = this.techBufferRemaining > 0;
        const teched = buffered && this.techLockoutRemaining === 0;
        this.techBufferRemaining = 0;
        const dir = clamp(input.moveX, -1, 1);
        if (teched) {
          if (Math.abs(dir) >= 0.5) {
            this.startGetupRoll(dir >= 0 ? 1 : -1, 'tech'); // directional tech-roll
          } else {
            this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
            if (this.id === 'pikachu') this.beginPikachuGroundRecovery('tech');
            else this.beginGroundRecovery('tech',GROUND_RECOVERY_ROWS.techInPlace);
          }
        } else {
          // Preserve the existing observed selector before clearing impact motion.
          // Native knockdown posture selection remains a separate source gap.
          this.knockdownFaceDown = this.body.velocity.x * this.facing > 0;
          this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
          this.tripped = false;
          this.knockdownRemaining = KNOCKDOWN_FRAMES; // missed → knocked down
          this.reactionPresentation = null;
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
    // Launch momentum decays independently from Matter gravity. This avoids
    // quadratic travel while preserving the ballistic rise/fall residual.
    if (this.hitstunRemaining > 0) {
      if (this.referenceLaunch !== null) this.referenceLaunch.groupIndex += 1;
      else this.applyLaunchVelocityDecay();
      this.hitstunRemaining -= 1;
      // Keep provenance through this last locked physics step. Its contact
      // response and gravity must resolve before we hand control back.
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
      this.stepDodge({
        held: false,
        justPressed: false,
        moveX: 0,
        grounded: this.isGrounded(),
        facing: this.facing,
      });
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
      // Options open once the lock has elapsed (the landing step is prone frame 1, this step frame 1 + age).
      const optionsOpen = this.knockdownTotalFrames() - this.knockdownRemaining >= (this.tripped ? this.tripOptionLockFrames : KNOCKDOWN_OPTION_LOCK_FRAMES);
      const dir = clamp(input.moveX, -1, 1);
      const rollGetup = optionsOpen && Math.abs(dir) >= 0.5;
      const attackGetup = optionsOpen && input.attack === true && !this.prevAttackHeld;
      const getUp =
        (optionsOpen && input.jump === true && !this.prevJumpHeld) ||
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
          if (this.id === 'pikachu') this.beginPikachuGroundRecovery(this.knockdownFaceDown ? 'getup_face_down' : 'getup');
          // A trip stands through slip_stand, a knockdown through down_stand.
          else this.beginGroundRecovery(this.knockdownFaceDown?'getup_face_down':'getup',this.tripped?GROUND_RECOVERY_ROWS.tripStand:GROUND_RECOVERY_ROWS.stand);
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
      // Mashing shortens the stun (SmashWiki Stun: 3 frames per stick input, 5.4 per button).
      const mashBefore = this.shieldBreakMash ?? initialCaptureMash(input);
      this.shieldBreakMash = tickCaptureMash(mashBefore, input, this.simulationInputFrame, SHIELD_BREAK_MASH_WEIGHTS);
      this.shieldState = tickShield(
        this.shieldState,
        { held: false, mash: this.shieldBreakMash.reduction - mashBefore.reduction },
        this.tuning.shield,
      );
      if (!isShieldBroken(this.shieldState)) this.shieldBreakMash = null;
      // AC 60302 Sub-AC 2 — shield-break stun also locks out dodge
      // presses (the fighter is helpless). The dodge state machine
      // still ticks so any in-flight roll cooldown drains in real time.
      this.stepDodge({
        held: false,
        justPressed: false,
        moveX: 0,
        grounded: this.isGrounded(),
        facing: this.facing,
      });
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

    // Landing is resolved before any action arbitration. A six-frame landing
    // blocks touchdown plus five subsequent input steps; the seventh can act.
    // Existing recovery drains here, while a new landing starts at its full
    // authored duration. Ordinary attack cooldown retains its separate timing.
    const wasInLandingRecovery = this.isInLandingRecovery();
    this.shieldReleaseRemaining = Math.max(0, this.shieldReleaseRemaining - 1);
    if (!this.isGrounded()) this.shieldReleaseRemaining = 0;
    // Native GuardOff permits jump, up smash and up special before its ordinary
    // cancel frame. A successful action cancels the release parry window too.
    const shieldReleaseUp = (input.moveY ?? 0) <= -DEFAULT_NEUTRAL_THRESHOLD &&
      Math.abs(input.moveY ?? 0) >= Math.abs(input.moveX);
    // A right-stick heavy press aims with its own direction, so shield +
    // right-stick up is an out-of-shield up smash regardless of the left stick.
    const heavyStick = this.heavyPressStick(input);
    const heavyPressUp = heavyStick !== null
      ? heavyStick.y <= -DEFAULT_NEUTRAL_THRESHOLD && Math.abs(heavyStick.y) >= Math.abs(heavyStick.x)
      : shieldReleaseUp;
    const upSmashPress = heavyPressUp &&
      input.attackHeavy === true && !this.prevHeavyHeld && this.upSmashId !== null;
    const upSpecialPress = shieldReleaseUp &&
      input.special === true && !this.prevSpecialHeld && this.upSpecialId !== null;
    const shieldReleaseCancel = this.hasJumpIntent(input) || upSmashPress || upSpecialPress;
    if (this.shieldReleaseRemaining > 0 && shieldReleaseCancel) this.shieldReleaseRemaining = 0;
    this.tickLanding();
    this.advanceShootingLegs();
    this.tickTaunt(input);
    input=this.reserveSourceUpdatedControlInput(input,this.simulationInputFrame);
    if (input.dropThrough === true && this.isGrounded() &&
        this.canStartCommittedAction() && !this.chargingSpecial?.groundedUpSpecial) {
      // The activation step is included, matching the existing ten-step
      // counter's immediate decrement while respecting landing commitment.
      this.dropThroughFramesRemaining = 9;
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
    // Three completed free steps after ordinary blockstun cannot parry.
    // Four here includes the tick that drains the final shieldstun frame.
    this.shieldParryBlockRemaining = inShieldstunNow ? 4
      : Math.max(0, this.shieldParryBlockRemaining - 1);
    const directDodgeHeld = input.dodge === true;
    // A fresh shield press in the air is the neutral air-dodge gesture.
    // Directional shield chords already arrive as `input.dodge = true`.
    const neutralAirDodgePressed =
      !groundedForShield && shieldHeld && !this.prevShieldHeld && !directDodgeHeld;
    const dodgePressed =
      (directDodgeHeld && !this.prevDodgeHeld) || neutralAirDodgePressed;
    const wantsDodge =
      dodgePressed &&
      this.canStartCommittedAction() &&
      (!shieldRaisedNow || !inShieldstunNow);
    const canActOutOfShield =
      shieldRaisedNow && !inShieldstunNow && this.canStartCommittedAction();
    const oosJump =
      canActOutOfShield && this.hasJumpIntent(input);
    // Post-shieldstun shield grab waits 4 more frames (SHIELD_GRAB_POST_SHIELDSTUN_DELAY_FRAMES);
    // a grab pressed during shieldstun or the delay starts when the delay ends.
    const grabPressed = input.grab === true && !this.prevGrabHeld;
    if (!shieldRaisedNow) { this.shieldGrabLockRemaining = 0; this.shieldGrabPending = false; }
    else if (inShieldstunNow) this.shieldGrabLockRemaining = SHIELD_GRAB_POST_SHIELDSTUN_DELAY_FRAMES;
    if (shieldRaisedNow && grabPressed && (inShieldstunNow || this.shieldGrabLockRemaining > 0)) this.shieldGrabPending = true;
    const shieldGrabReady = canActOutOfShield && this.shieldGrabLockRemaining === 0;
    const delayedShieldGrab = shieldGrabReady && this.shieldGrabPending;
    if (!inShieldstunNow && this.shieldGrabLockRemaining > 0) this.shieldGrabLockRemaining -= 1;
    if (delayedShieldGrab) this.shieldGrabPending = false;
    const oosGrab = shieldGrabReady && (grabPressed || delayedShieldGrab);
    const oosUpAttack = canActOutOfShield && (upSmashPress || upSpecialPress);
    const wantsOutOfShield = oosJump || oosGrab || oosUpAttack;
    const effectiveShieldHeld =
      groundedForShield &&
      (shieldHeld || (shieldRaisedNow && this.shieldActiveFrames < 3)) &&
      (shieldRaisedNow || !this.prevShieldHeld ||
        (wasInLandingRecovery && !this.isInLandingRecovery())) &&
      !wantsOutOfShield &&
      !wantsDodge &&
      this.canStartCommittedAction(true);
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
      { held: effectiveShieldHeld, percent: this.damagePercent },
      this.tuning.shield,
    );
    if(shieldNameBefore!=='broken'&&isShieldBroken(this.shieldState))this.beginSourceShieldBreak();
    if (shieldNameBefore === 'active' && this.shieldState.name === 'idle' &&
        groundedForShield && !shieldHeld && !wantsOutOfShield && !wantsDodge) {
      this.shieldReleaseRemaining = 11;
      this.latchShieldPresentation('release', 11);
      this.shieldReleaseCanParry = this.shieldParryBlockRemaining === 0;
    }
    // Track the minimum three-frame shield hold before ordinary release.
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
    const moveXAfterShield = shieldRaised || this.shieldReleaseRemaining > 0 ? 0 : rawMoveX;

    // Aerial direction is relative to the fighter's orientation on press,
    // independently of air drift: left + attack while facing right is bair.
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
      this.airDodgeGravityVelocityY = 0;
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
    // Fresh dodge intent wins arbitration over shield above, so the shield is
    // already lowered on a legal roll/spot-dodge frame. Shieldstun and attack
    // commitment suppress `wantsDodge` before the state machine sees it.
    const dodgeHeldThisFrame =
      (directDodgeHeld || neutralAirDodgePressed) && !shieldRaised;
    const dodgeJustPressedRaw = dodgeHeldThisFrame && wantsDodge;
    // Air-dodge limit: only ONE directional air-dodge per airtime (reset on
    // land) so a directional burst can't be spammed into infinite recovery.
    const dodgeJustPressed =
      dodgeJustPressedRaw && !(!grounded && this.airDodgeUsed);
    const dodgeStateBefore = this.dodgeState;
    this.stepDodge({
      held: dodgeHeldThisFrame,
      justPressed: dodgeJustPressed,
      moveX: rawMoveX,
      moveY: input.moveY ?? 0,
      grounded,
      facing: this.facing,
    });
    // Ultimate spot dodge cancels into a ground attack or special (never a grab) from its cancel
    // frame (SmashWiki Spot dodge; UFD DK "21/26").
    if (grounded && this.offensiveActionBuffer !== null && canCancelSpotDodge(this.dodgeState, this.tuning.dodge)) {
      this.dodgeState = cancelDodge(this.dodgeState, this.tuning.dodge);
    }

    // Directional air-dodge: on the air-dodge START frame, capture a velocity
    // burst from the stick (null = neutral → keep the in-place stall) and spend
    // this airtime's air-dodge. The burst is applied + decayed during the
    // active phase just before the velocity commit below.
    if (dodgeJustPressed && !grounded && this.dodgeState.active?.kind === 'air') {
      this.clearTumbleForStartedAction();
      this.clearReferenceLaunch();
      this.airDodgeUsed = true;
      this.airDodgeGravityVelocityY = 0;
      const sx = rawMoveX;
      const sy = clamp(input.moveY ?? 0, -1, 1);
      const mag = Math.hypot(sx, sy);
      // Fully stale directional air dodges travel 2/3 as far (SmashWiki Air dodge).
      const burstSpeed = AIRDODGE_BURST_SPEED *
        (isDodgeFullyStale(this.dodgeState.active.staleCount ?? 0) ? FULLY_STALE_AIR_DODGE_DISTANCE_SCALE : 1);
      this.airDodgeBurst =
        mag >= AERIAL_STICK_THRESHOLD
          ? {
              x: (sx / mag) * burstSpeed,
              y: (sy / mag) * burstSpeed,
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
        ((grabHeldThisFrame && !this.prevGrabHeld) || delayedShieldGrab) && !shieldRaised &&
        this.canStartCommittedAction();
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
      if (grabJustPressed) {
        const pivot = this.dashGrabActive && rawMoveX * this.body.velocity.x < 0 && this.grabSpec.pivotGrab;
        const variant = pivot || (this.dashGrabActive ? this.grabSpec.dashGrab : undefined);
        this.grabPresentationVariant = pivot ? 'pivot' : this.dashGrabActive ? 'dash' : 'standing';
        if (pivot) this.facing = rawMoveX > 0 ? 1 : -1;
        this.grabVariantSpec = variant ? { ...this.grabSpec,
          collisionHits: variant.collisionHits ?? this.grabSpec.collisionHits,
          startupFrames: variant.startupFrames ?? this.grabSpec.startupFrames,
          activeFrames: variant.activeFrames ?? this.grabSpec.activeFrames,
          whiffRecoveryFrames: variant.whiffRecoveryFrames ?? this.grabSpec.whiffRecoveryFrames,
          hitbox: variant.hitbox ?? { ...this.grabSpec.hitbox, offsetX: this.grabSpec.hitbox.offsetX + variant.rangeBonusX } } : this.grabSpec;
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
      const pummelReadyBefore = canPummel(before);
      const selectedGrab = this.grabVariantSpec ?? this.grabSpec;
      const holdBudget = this.ultimateCaptureBudget && before.name === 'holding' && !before.active?.cargo
        ? reducedCaptureFrames(this.ultimateCaptureBudget.initialFrames, this.ultimateCaptureBudget.mash) : null;
      const cargoBudget=this.ultimateCargoBudget&&before.name==='holding'&&before.active?.cargo
        ? reducedCargoFrames(this.ultimateCargoBudget.initialFrames,this.ultimateCargoBudget.mash):null;
      const liveGrab=cargoBudget!==null&&selectedGrab.cargo?{...selectedGrab,cargo:{...selectedGrab.cargo,holdFramesMax:cargoBudget}}:
        holdBudget===null?selectedGrab:{...selectedGrab,holdFramesMax:holdBudget};
      const sourcePummel=liveGrab.pummel?.motionFrames!==undefined;
      if(sourcePummel||liveGrab.cargo?.entryMotionFrames!==undefined)this.advanceGrabSourcePresentation();
      const sourceStep=sourcePummel?stepGrabWithEvents(before,{...grabInput,pummelPressed:grabInput.pummelPressed&&this.grabTarget?.grabbedBy===this},liveGrab):null;
      this.grabState = sourceStep?.state??tickGrab(before, grabInput, liveGrab);
      this.prevGrabHeld = grabHeldThisFrame;
      this.handleGrabStateTransition(before, this.grabState);
      if(sourceStep?.pummelStarted&&this.grabTarget){
        this.pummelDamageTransaction=this.beginCapturedDamageTransaction(`${this.grabSpec.id}.pummel`,'pummel');
        this.sourceGrabPummel={...beginGrabSourcePresentation(this.simulationInputFrame,this.facing),target:this.grabTarget,
          captureId:this.grabTarget.captureSequence,targetGeneration:this.grabTarget.positionResetGeneration,cargo:false,damageDelivered:false};
        this.sourceGrabHeld=null;this.pendingPummelFrames=null;
        this.notifySourceCaptureEquipmentOwnerChanged();
      }
      if(sourcePummel)this.deliverSourcePummel();
      // Pummel damage — fires the frame the attack button is pressed while
      // holding, if the pummel cooldown was zero. canPummel checks the
      // PRE-tick state (cooldown 0); tickGrab already reset it to cooldownFrames.
      if (
        !sourcePummel && pummelReadyBefore &&
        grabInput.pummelPressed &&
        this.grabTarget !== null &&
        this.grabSpec.pummel
      ) {
        this.pummelDamageTransaction=this.beginCapturedDamageTransaction(`${this.grabSpec.id}.pummel`,'pummel');
        this.pendingPummelFrames = this.grabSpec.pummel.startupFrames ?? 0;
      }
      if (this.pendingPummelFrames !== null) {
        if (!this.grabTarget || this.grabState.name !== 'holding'||!this.capturedDamageTransactionValid(this.pummelDamageTransaction,this.grabTarget)) {this.pendingPummelFrames = null;this.pummelDamageTransaction=null;}
        else if (this.pendingPummelFrames > 0) this.pendingPummelFrames -= 1;
        else {
          const p = this.grabSpec.pummel!,transaction=this.pummelDamageTransaction!;
          const freeze = p.hitlagFrames ?? computeHitlag({ damage: p.damage*transaction.staleMultiplier, targetPercent: this.grabTarget.getDamagePercent(), multiplier: p.hitlagMultiplier,
            electricCollision: p.electricCollision });
          const beforeDamage=this.grabTarget.getDamagePercent();
          this.grabTarget.addDamage(p.damage*transaction.staleMultiplier, 'pummel',this.slotIndex);
          this.pummelDamageTransaction=this.commitCapturedDamageTransaction(transaction,this.grabTarget.getDamagePercent()-beforeDamage);
          this.grabTarget.armAttackerHitlag(freeze);
          this.armAttackerHitlag(freeze);
          if (this.grabState.active) this.grabState = { ...this.grabState, active: { ...this.grabState.active,
            pummelCooldownRemaining: Math.max(0, p.cooldownFrames - freeze) } };
          this.pendingPummelFrames = null;this.pummelDamageTransaction=null;
        }
      }
      // While holding, pin the target's body to the grabber's
      // contact-point offset each frame so it can't drift.
      if ((this.grabState.name === 'holding' || this.grabState.name === 'throwing') && this.grabTarget !== null && !this.bypassCaptureAttachmentLegacyPin()) {
        const offsetX = (this.grabState.active?.cargo ? this.grabSpec.cargo?.offsetX ?? this.grabSpec.hitbox.offsetX : this.grabSpec.hitbox.offsetX) * this.facing;
        const targetX = this.body.position.x + offsetX;
        const targetY = this.body.position.y + (this.grabState.active?.cargo ? this.grabSpec.cargo?.offsetY ?? this.grabSpec.hitbox.offsetY : this.grabSpec.hitbox.offsetY);
        this.scene.matter.body.setPosition(this.grabTarget.body, {
          x: targetX,
          y: this.grabTarget.clearedCaptiveY(this, targetY),
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
    // A natural source capture release can be installed during tickGrab
    // above. Its born frame is locked too; no action leaks through here.
    if (this.grabReleasePresentation && this.tickGrabReleaseInput(input)) return;
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
        this.facing = this.dodgeState.active.backward
          ? (this.dodgeState.active.facing === 1 ? -1 : 1)
          : this.dodgeState.active.facing;
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
    let ledgeAttackCorner: LedgeCandidate | null = null;
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
      // A deliberate descent can pass the ledge. A legal jump begins before
      // an automatic catch, so pressing jump beside a ledge does not get
      // swallowed into a hang and replayed as a different action later.
      const startsAirJump = !grounded && this.hasJumpIntent(input) &&
        this.jumpsUsed < this.tuning.maxJumps && this.canStartCommittedAction();
      const dodgeLedgeLocked = this.id === 'pikachu' && this.dodgeState.active?.kind === 'air' &&
        this.dodgeState.active.directional &&
        !pikachuDirectionalDodgePhase(this.dodgeState.active.framesElapsed)?.controlEnabled;
      const declinesLedgeCatch = (input.moveY ?? 0) >= 0.5 || startsAirJump || dodgeLedgeLocked;
      // Native heavy Jump/Fall/Pass keeps cliff checking NONE, including the
      // recovered fall helper; no later cliff enable was found.
      // A carried captive (cargo) has no cliff check either: the carry falls past the ledge.
      const ledgeDetection = declinesLedgeCatch || this.isHammerLocked() || this.hasDonkeyKongHeavyAirPolicy() || this.grabState.active?.cargo ? null : this.computeLedgeDetection();
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
        // A fresh catch's intangibility reads airtime and percent (SmashWiki Edge).
        airtimeFrames: this.airtimeFrames,
        percent: this.damagePercent,
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
      if (ledgeReleased === 'attack' || ledgeReleased === 'jump') ledgeAttackCorner = prevState.active?.candidate ?? null;
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
        this.cancelAttack();
        this.cooldownRemaining = 0;
        // Lock the body to the latch point. Velocity is zeroed so the
        // fighter doesn't drift mid-hang.
        this.clearReferenceLaunch();
        this.scene.matter.body.setPosition(this.body, {
          x: this.ledgeHangState.active.latchX,
          y: this.ledgeHangState.active.latchY,
        });
        this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
        // Reset the air-jump budget — a fresh ledge grab is the
        // canonical recovery point, so the fighter can air-jump out of
        // the hang on release without the budget being exhausted by
        // the recovery up-special they used to reach the ledge.
        this.jumpsUsed = Math.min(1, this.tuning.maxJumps);
        this.helpless = false;
        this.airDodgeUsed = false;
        // A fresh grab also resets descent shaping — a fast-fall latch
        // or armed jump-cut must not survive into (or past) the hang.
        this.fastFallLatched = false;
        this.jumpCutArmed = false;
        this.shortHopRising = false;
        this.airJumpRising = false;
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
    const directionalDodge = this.id === 'pikachu' && !grounded &&
      this.dodgeState.active?.kind === 'air' && this.dodgeState.active.directional
      ? pikachuDirectionalDodgePhase(this.dodgeState.active.framesElapsed) : null;
    const moveX =
      (dodgeLocking && !directionalDodge?.controlEnabled) || ledgeLocking || rootedByCharge || grabActing || this.tauntPresentation !== null
        ? 0
        : moveXAfterShield;

    // An in-flight GROUNDED attack roots the fighter's locomotion. A
    // grounded swing (jab / tilt / smash) or special is a committed action:
    // the held stick that SELECTED it (a forward-tilt's lean, a
    // side-special's direction) must NOT also free-walk/dash the body
    // through the move's startup / active / recovery. This mirrors the
    // tap-jump decouple below (an up-attack's up-stick doesn't also jump):
    // the directional input chose the attack, so it can't double as
    // locomotion. The move's OWN built-in travel is unaffected — a
    // `dashStrike` / `commandDash` side-special drives its lunge through
    // {@link tickSideSpecialDash}, which overrides velocity AFTER the
    // commit below, so this gate only suppresses the UNINTENDED raw-stick
    // walk that bled around (before / after) the authored dash. Gated on
    // `grounded` so an airborne attack keeps its air-drift (the legacy
    // proportional path below); the dispatch-side `moveX` fed to
    // `tickAttack` is left RAW so the directional-aerial classifier and the
    // dashStrike facing still read the player's true stick.
    const attackRootsLocomotion =
      (this.activeAttack !== null || this.isInLandingRecovery()) && grounded;
    if (this.id === 'pikachu') {
      const freshAction = this.hasJumpIntent(input) ||
        input.attack === true && !this.prevAttackHeld || input.attackHeavy === true && !this.prevHeavyHeld ||
        input.special === true && !this.prevSpecialHeld || input.grab === true && !this.prevGrabHeld;
      this.pikachuCrouchCrawl = tickPikachuCrouchCrawl(this.pikachuCrouchCrawl, {
        down: (input.moveY ?? 0) >= .5, moveX: Math.abs(rawMoveX) >= .2 ? rawMoveX : 0,
        facing: this.facing, grounded, eligible: this.canPresentUncommittedBody() && !freshAction,
      });
    }
    const cargoMoving=this.grabState.name==='holding'&&this.grabState.active?.cargo&&!this.grabState.active.cargoStartupRemaining;
    const cargoWalkLimit=Math.max(0,this.resolvedLocomotionTuning.dashStickThreshold-.0001);
    const locoMoveX = attackRootsLocomotion || this.pikachuCrouchCrawl !== null ? 0 : (cargoMoving||this.isHammerLocked())?clamp(moveX,-cargoWalkLimit,cargoWalkLimit):moveX;

    // ---- Ground-locomotion tick (Tier 5) ---------------------------------
    // Advance the locomotion machine with the POST-lockout `moveX` (a
    // raised shield / dodge / charge / grab / in-flight grounded attack
    // already zeroed it → resolves to 'standing', so a lockout neither
    // dashes nor flips facing). The machine owns the grounded TARGET
    // velocity + facing; the integrator below is unchanged. Standing/crouch
    // carry the runtime facing, so this can never clobber a
    // dodge/ledge/charge/attack-owned facing.
    const preLocomotionFacing = this.facing;
    const locoInput = {
      moveX: locoMoveX,
      moveY: this.tauntPresentation ? 0 : clamp(input.moveY ?? 0, -1, 1),
      prevMoveX: this.prevLocoMoveX,
      grounded,
      facing: this.facing,
    };
    if (this.id === 'pikachu') {
      const freshAction = this.hasJumpIntent(input) ||
        input.attack === true && !this.prevAttackHeld || input.attackHeavy === true && !this.prevHeavyHeld ||
        input.special === true && !this.prevSpecialHeld || input.grab === true && !this.prevGrabHeld;
      this.pikachuTurnBrake = tickPikachuTurnBrake(this.pikachuTurnBrake, this.locomotionState,
        locoInput, this.resolvedLocomotionTuning, this.canPresentUncommittedBody() && !freshAction);
    }
    if(this.id==='donkeykong'){
      const previousTurn=this.donkeykongTurnBrake;
      const freshAction=this.hasJumpIntent(input)||input.attack===true&&!this.prevAttackHeld||
        input.attackHeavy===true&&!this.prevHeavyHeld||input.special===true&&!this.prevSpecialHeld||input.grab===true&&!this.prevGrabHeld;
      this.donkeykongTurnBrake=tickDonkeyKongTurnBrake(this.donkeykongTurnBrake,this.locomotionState,locoInput,
        this.resolvedLocomotionTuning,this.canPresentUncommittedBody()&&!freshAction);
      if(previousTurn?.sheet==='run_turn'&&!this.donkeykongTurnBrake&&!freshAction&&
        this.canPresentUncommittedBody()&&grounded&&Math.abs(locoMoveX)>=this.resolvedLocomotionTuning.dashStickThreshold&&
        Math.sign(locoMoveX)===previousTurn.targetFacing)
        this.locomotionState={...resetLocomotionState(previousTurn.targetFacing),name:'run'};
      if(this.donkeykongTurnBrake?.sheet==='dash_turn'&&donkeyKongTurnBrakeNativeMarkers(this.donkeykongTurnBrake).dashToRunEnabled
        &&Math.abs(locoMoveX)>=this.resolvedLocomotionTuning.dashStickThreshold&&Math.sign(locoMoveX)===this.donkeykongTurnBrake.targetFacing){
        const facing=this.donkeykongTurnBrake.targetFacing;this.donkeykongTurnBrake=null;
        this.locomotionState={...resetLocomotionState(facing),name:'run'};
      }
    }
    this.locomotionState = tickLocomotion(
      this.pikachuTurnBrake ? resetLocomotionState(this.pikachuTurnBrake.targetFacing)
        :this.donkeykongTurnBrake?resetLocomotionState(donkeyKongTurnBrakeFacing(this.donkeykongTurnBrake)):this.locomotionState,
      locoInput,
      this.resolvedLocomotionTuning,
    );
    // Shooting keeps the fire facing: the legs walk under it (shootingWalkTargetVx), no dash, run or turn.
    if (this.itemShooting && grounded) this.locomotionState = resetLocomotionState(this.itemShooting.state.facing);
    // Latch the value ACTUALLY fed to the machine (post attack-root gate),
    // not the raw stick — the flick-edge detector compares against the prior
    // machine input, so latching the gated value keeps the edge math
    // consistent (a direction held through a grounded attack reads as a
    // rest→tilt flick the frame the fighter is free again, the natural
    // "dash out of an attack" gesture, rather than mid-attack noise).
    this.prevLocoMoveX = locoMoveX;

    // Apply ledge-release physics for actions that resolved this tick.
    if (ledgeReleased !== null) {
      this.applyLedgeReleasePhysics(ledgeReleased, ledgeAttackCorner);
      if(this.pikachuLedgeJump?.phase==='start'){this.lockPikachuSourceRecoveryInput(input);return;}
    }

    // ---- Horizontal motion -------------------------------------------------
    // Player drift controls its own component; retained damage velocity keeps
    // the reference decay instead of inheriting movement damping/speed limits.
    if (this.referenceLaunch !== null) this.applyLaunchVelocityDecay();
    let vx = this.body.velocity.x - (this.referenceLaunch ? this.launchVelocity?.x ?? 0 : 0);
    // Carrying an opponent (Cargo) or a heavy item scales walk speed and acceleration
    // (GrabSpec cargo.walkMultiplier). SmashWiki DK Forward throw: "while carrying an opponent or
    // heavy item, Donkey Kong's walk speed and acceleration are increased by 1.1×".
    const heavyCarrying = this.donkeykongHeavyItemHeld && this.donkeykongHeavyCarry !== null;
    // A fighter's own heavy walk (fighterHeavyItemProfile) replaces DK's SmashWiki cargo multiplier.
    const heavyWalk = heavyCarrying ? fighterHeavyItemProfile(this.id).carry.walk : null;
    const carryWalk = heavyWalk?.groundAccelMultiplier ?? (cargoMoving || heavyCarrying ? this.grabSpec?.cargo?.walkMultiplier ?? 1 : 1);
    const accel = grounded ? heavyWalk?.accelerationNative !== undefined
      ? heavyWalk.accelerationNative * 5 // native item_lift_accel_add adapter; the common mul formula is unknown
      : this.tuning.groundAccel * carryWalk : this.tuning.airAccel;
    const damping = grounded ? this.tuning.groundDamping : this.tuning.airDamping;
    const upSpecialFlight = this.getSustainedUpSpecialRise();
    // tickAttack advances the move later in this input step. Shape velocity
    // for that upcoming physics frame, including the gravity restoration edge.
    const sustainedRise = upSpecialFlight !== null &&
      this.activeAttack!.framesElapsed + 1 < upSpecialFlight.gravityFrames;

    // AC 60302 Sub-AC 2 — dodge motion overrides player input.
    //   • A roll's active phase forces vx to slideSpeed × facing so the
    //     fighter slides cleanly in the rolled direction regardless of
    //     stick input or residual knockback.
    //   • A spot / air dodge active phase zeros vx — the fighter
    //     "freezes" in place for the duration of the i-frame window.
    //   • Recovery phase preserves whatever vx was committed at the end
    //     of the active window so a roll's slide carries naturally to a
    //     stop via the normal damping path.
    const activeRoll = this.dodgeState.active;
    if (activeRoll?.kind === 'roll' && !activeRoll.backward &&
        activeRoll.framesElapsed === this.tuning.dodge.roll.reverseFacingFrame) {
      this.facing = activeRoll.facing === 1 ? -1 : 1;
      this.locomotionState = { ...this.locomotionState, facing: this.facing };
    }
    const dodgeSlide = getDodgeSlideVelocity(this.dodgeState, this.tuning.dodge);
    const groundedMotion = grounded ? this.activeAttack?.move.groundedMotion : undefined;
    if (groundedMotion) {
      const age = this.activeAttack!.framesElapsed;
      const friction = groundedMotion.postHitFrame !== undefined && age >= groundedMotion.postHitFrame
        ? groundedMotion.postHitFriction ?? groundedMotion.friction : groundedMotion.friction;
      vx = Math.sign(vx) * Math.max(0, Math.abs(vx) - friction);
      vx = clamp(vx + rawMoveX * groundedMotion.acceleration, -groundedMotion.maxSpeed, groundedMotion.maxSpeed);
    } else if (upSpecialFlight !== null) {
      // Spinning recovery retains neutral momentum. Steering changes travel,
      // including backward travel, without turning the fighter around.
      if (Math.abs(rawMoveX) > 0.0001) {
        const targetVx = rawMoveX * upSpecialFlight.maxAirSpeed;
        const delta = targetVx - vx;
        vx += Math.sign(delta) * Math.min(Math.abs(delta), upSpecialFlight.airAcceleration);
      }
    } else if (directionalDodge !== null) {
      if (directionalDodge.controlEnabled && Math.abs(moveX) > .0001) {
        const target = moveX * (this.tuning.maxAirSpeed ?? this.tuning.maxRunSpeed);
        vx += Math.sign(target - vx) * Math.min(Math.abs(target - vx), this.tuning.airAccel);
      }
    } else if (this.dodgeState.name === 'active') {
      if (dodgeSlide !== null) {
        vx = dodgeSlide;
      } else {
        // Spot / air dodge — root the fighter in place.
        vx = 0;
      }
    } else if (grounded) {
      // ---- GROUNDED — locomotion-driven (Tier 5) -----------------------
      // The locomotion machine supplies the TARGET (walk / dash / run) or
      // `null` (standing / crouch / pivot → damp). Generic profiles accelerate
      // from rest; authored initial-dash profiles can start at their burst
      // speed. The current phase supplies the appropriate speed limit.
      const locomotionTarget = this.itemShooting
        ? this.shootingWalkTargetVx(locoMoveX, this.itemShooting.state.facing)
        : getLocomotionTargetVx(
          this.locomotionState,
          locoInput,
          this.resolvedLocomotionTuning,
        );
      const target = locomotionTarget === null ? null : locomotionTarget * carryWalk;
      if (target !== null) {
        // Authored initial dash is an entry impulse. Attack selection runs
        // later this step, so an offense press must not first become a dash:
        // that would misclassify a standing smash as a dash attack.
        const offensePending = this.offensiveActionBuffer !== null ||
          (input.attack === true && !this.prevAttackHeld) ||
          (input.attackHeavy === true && !this.prevHeavyHeld) ||
          (input.special === true && !this.prevSpecialHeld);
        const instantDashEntry = this.resolvedLocomotionTuning.initialDashInstantStart &&
          this.locomotionState.name === 'initialDash' &&
          this.locomotionState.framesElapsed === 0 && !offensePending;
        const delta = target - vx;
        if (instantDashEntry || Math.abs(delta) <= accel) {
          vx = target;
        } else {
          vx += accel * Math.sign(delta);
        }
        // A fighter's initial dash may be faster than its sustained run.
        // Never damp an authored target merely because it exceeds run speed.
        const speedLimit = Math.max(this.tuning.maxRunSpeed, Math.abs(target));
        if (Math.abs(vx) > speedLimit) {
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
      this.facing = this.pikachuCrouchCrawl?.facing ?? (this.jumpsquatRemaining > 0 && this.jumpsquatFacing !== null
        ? this.jumpsquatFacing
        : getLocomotionFacing(this.locomotionState));
      if (this.pikachuCrouchCrawl !== null) vx = pikachuCrouchCrawlVelocity(this.pikachuCrouchCrawl) ?? 0;
      if (this.pikachuTurnBrake !== null) {
        // Avoid a second locomotion acceleration: the phase owns this step's
        // velocity from the original physical input velocity.
        vx = pikachuTurnBrakeVelocity(this.pikachuTurnBrake, this.body.velocity.x,
          this.resolvedLocomotionTuning, this.tuning.groundAccel, this.tuning.groundDamping);
        this.facing = this.pikachuTurnBrake.targetFacing;
      }
      if(this.id==='donkeykong'&&!this.donkeykongHeavyItemHeld&&this.canPresentUncommittedBody()){
        if(this.donkeykongTurnBrake){
          vx=donkeyKongTurnBrakeVelocity(this.donkeykongTurnBrake,this.body.velocity.x,this.resolvedLocomotionTuning,this.tuning.groundAccel);
          this.facing=donkeyKongTurnBrakeFacing(this.donkeykongTurnBrake);
        }else if(this.locomotionState.name==='run')vx=stepDonkeyKongGroundVelocity({velocityX:this.body.velocity.x,stickX:locoMoveX,phase:'run'});
        else if(['standing','crouch','pivot'].includes(this.locomotionState.name))vx=stepDonkeyKongGroundVelocity({velocityX:this.body.velocity.x,stickX:0,phase:'brake'});
      }
    } else if(this.id==='donkeykong'&&!this.donkeykongHeavyItemHeld&&(this.canPresentUncommittedBody()||this.itemShooting!==null)&&!this.helpless){
      vx=stepDonkeyKongAirVelocity({velocityX:vx,stickX:moveX});
    } else if (Math.abs(moveX) > 0.0001) {
      // ---- AIRBORNE — proportional air drift --------------------------
      const maxAirSpeed = this.pikachuSpecialRuntime?.airControlSpeedLimitForNextInput()
        ?? (this.tuning.maxAirSpeed ?? this.tuning.maxRunSpeed)
          * (this.helpless ? this.specialFallAirSpeedMultiplier : 1);
      const targetVx = moveX * maxAirSpeed;
      const delta = targetVx - vx;
      if (Math.abs(delta) <= accel) {
        vx = targetVx;
      } else {
        vx += accel * Math.sign(delta);
      }
      if (Math.abs(vx) > maxAirSpeed) {
        vx *= damping;
      }
      // Drift changes travel, not orientation. Otherwise holding backward
      // for a few frames silently changes the subsequent back air into fair.
      // Explicit actions such as side specials can still choose a facing.
    } else {
      // Airborne, stick neutral — damp toward rest.
      vx *= damping;
      if (Math.abs(vx) < 0.01) vx = 0;
    }

    if(this.donkeykongHeavyItemAction)this.facing=this.donkeykongHeavyItemAction.facing;
    else if(this.donkeykongHeavyItemHeld&&this.donkeykongHeavyCarry){
      this.facing=this.donkeykongHeavyCarry.facing;
      if(grounded){
        // Heavy carry walks at DK's walk speed and acceleration × the carry multiplier (SmashWiki,
        // above; SmashWiki Barrel: heavy items slow every character "except Donkey Kong's"). The
        // stick maps linearly onto that cap. No dash is entered.
        const walking=this.donkeykongHeavyCarry.phase==='walk';
        const maximum=heavyWalk?heavyWalk.maximumSpeedNative*5:this.resolvedLocomotionTuning.walkMaxSpeed*carryWalk;
        const target=walking?clamp(this.donkeykongHeavyCarryStickX,-1,1)*maximum:0;
        const delta=target-this.body.velocity.x;
        vx=walking?this.body.velocity.x+Math.sign(delta)*Math.min(Math.abs(delta),accel):0;
      }
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
      // Each variant retains its own share: DK's pivot grab keeps none (native CatchTurn has no Trans travel).
      const variant = this.grabPresentationVariant === 'pivot' ? this.grabSpec.pivotGrab : this.grabSpec.dashGrab;
      const retained =
        this.dashGrabEntryVx * (variant?.momentumRetain ?? 0);
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
    const jumpRequested = this.hasJumpIntent(input);
    const jumpJustPressed =
      this.tauntPresentation === null &&
      !shieldRaised &&
      !dodgeLocking &&
      !ledgeLocking &&
      !this.helpless &&
      !grabActing &&
      ledgeReleased !== 'jump' &&
      this.activeAttack === null &&
      this.jumpsquatRemaining === 0 &&
      !this.isInLandingRecovery() &&
      // Charging a grounded SMASH or NEUTRAL-SPECIAL (Samus cannon) fully
      // roots the fighter — no jump while charging. The charge is a
      // committed, stationary, grounded action: to act, release it (fire)
      // or shield-store the charge first.
      this.chargingSpecial === null &&
      !(this.chargingSmash !== null && grounded) &&
      jumpRequested;
    if (jumpJustPressed) this.jumpInputBufferFrames = 0;
    // The jump impulse, extracted so an immediate jump and a buffered
    // tap-jump (below) drive byte-identical state.
    const applyJumpImpulse = (shortHop = false, airJump = false): void => {
      this.clearTumbleForStartedAction();
      vx += this.referenceLaunch ? this.launchVelocity?.x ?? 0 : 0;
      this.clearReferenceLaunch();
      if (this.id === 'donkeykong' && !airJump && !this.donkeykongHeavyItemHeld)
        vx = groundJumpTakeoffVelocityX(DONKEYKONG_JUMP_TAKEOFF_PARAMETERS, vx, moveX, 5);
      this.donkeykongFullHopStep=this.donkeykongOrdinaryVertical&&!shortHop&&!airJump?0:null;
      vy = -(airJump
        ? this.tuning.airJumpImpulse ?? this.tuning.jumpImpulse
        : shortHop
          ? this.tuning.shortHopImpulse ?? this.tuning.jumpImpulse * this.tuning.jumpCutFactor
          : this.tuning.jumpImpulse);
      this.shortHopRising = shortHop;
      this.airJumpRising = airJump;
      if (!airJump && this.jumpsquatFacing !== null) {
        this.facing = this.jumpsquatFacing;
      }
      this.sourceJumpEventSerial+=1;
      this.jumpPresentation = { kind: airJump ? 'air' : 'ground', facing: this.facing,
        moveX: input.moveX,velocityX:this.body.velocity.x, shortHop, framesElapsed: 0 };
      this.jumpsUsed += 1;
      // Arm the variable-height cut for THIS rise and clear any
      // fast-fall latch — a fresh jump always starts a clean arc.
      this.jumpCutArmed = !shortHop && this.tuning.shortHopImpulse === undefined &&
        !(airJump && this.tuning.airJumpImpulse !== undefined);
      this.jumpCutFrames = 0;
      this.fastFallLatched = false;
      this.takeoffInputFrame = this.simulationInputFrame;
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

    if(this.pendingDonkeyKongHeavyJump){
      const jump=this.pendingDonkeyKongHeavyJump;this.pendingDonkeyKongHeavyJump=null;
      if(this.donkeykongHeavyItemHeld&&grounded&&!this.donkeykongHeavyItemAction){
        // Source uses ordinary JUMP kinetic type. Its exact setup is not yet
        // recovered; retain the existing explicit full/short impulse adapter.
        applyJumpImpulse(jump.mini);
      }
    }

    // Fresh attack rising-edge (light or heavy), read here for the tap-jump
    // buffer; the same edge drives the grounded up-attack dispatch later, so a
    // press that cancels the buffer ALSO fires the up-tilt / up-smash.
    const attackEdgeForJump =
      (input.attack === true && !this.prevAttackHeld) ||
      (input.attackHeavy === true && !this.prevHeavyHeld);

    // Ultimate's jump-cancelled up smash / up special (SmashWiki "Jump
    // canceling": during jumpsquat the character is still grounded, so up
    // smash and up special come out as the standing moves): an up-aimed
    // heavy press, or an up-aimed special pending in the action buffer, on
    // any jumpsquat frame (the takeoff frame included, since this runs
    // before the impulse, and the frame the squat starts) drops the jump and
    // stays grounded, so the grounded dispatch below fires the move this
    // same step. This is what makes keyboard up smash reachable at all: W is
    // both up and jump, so W held past the tap-jump buffer is already in
    // jumpsquat when the smash key lands. The heavy press is consumed live;
    // an earlier press queued for the aerial is dropped with the jump. The
    // special stays in the buffer: it is the action the dispatch fires.
    let jumpsquatUpSmashCancel = false;
    const cancelJumpsquatIntoGroundedUpAction = (): boolean => {
      const upSmash = this.isJumpsquatUpSmashPress(input, moveX);
      if (!upSmash && !this.isJumpsquatUpSpecialPress()) return false;
      this.jumpsquatRemaining = 0;
      this.jumpsquatShortHop = false;
      this.jumpsquatFacing = null;
      if (upSmash) {
        this.offensiveActionBuffer = null;
        jumpsquatUpSmashCancel = true;
      }
      return true;
    };
    // DK jumpsquat is a stance, not locomotion (Ultimate JumpSquat runs the
    // motion kinetic type): the stick cannot start a dash, the ground speed it
    // entered with only brakes by ground_brake until takeoff.
    const holdJumpsquatMomentum = (): void => {
      if (this.id === 'donkeykong')
        vx = stepDonkeyKongGroundVelocity({velocityX:this.body.velocity.x,stickX:0,phase:'brake'});
    };
    const enterJumpsquat = (shortHop: boolean): void => {
      this.jumpsquatRemaining = JUMPSQUAT_FRAMES;
      this.jumpsquatFacing = this.resolvedLocomotionTuning.jumpsquatKeepsFacing ? preLocomotionFacing : null;
      if (this.jumpsquatFacing !== null) this.facing = this.jumpsquatFacing;
      this.jumpsquatShortHop = shortHop;
      holdJumpsquatMomentum();
      // The squat-entry step is a jumpsquat frame too: a jump and an
      // up-aimed right-stick smash or up special on the SAME step cancel like
      // the press one step later does (and like keyboard W + smash key, which
      // the tap-jump buffer below turns into a grounded up smash), instead of
      // short-hopping to the aerial.
      cancelJumpsquatIntoGroundedUpAction();
    };

    if (this.jumpsquatRemaining > 0) {
      const canceled =
        !grounded ||
        shieldRaised ||
        dodgeLocking ||
        ledgeLocking ||
        grabActing ||
        this.hitstunRemaining > 0;
      if (canceled) {
        this.jumpsquatRemaining = 0;
        this.jumpsquatShortHop = false;
        this.jumpsquatFacing = null;
      } else if (!cancelJumpsquatIntoGroundedUpAction()) {
        holdJumpsquatMomentum();
        if (!input.jump || attackEdgeForJump) this.jumpsquatShortHop = true;
        this.jumpsquatRemaining -= 1;
        if (
          this.jumpsquatRemaining === 0 &&
          this.jumpsUsed < this.tuning.maxJumps
        ) {
          applyJumpImpulse(this.jumpsquatShortHop);
          this.jumpsquatShortHop = false;
          this.jumpsquatFacing = null;
        }
      }
    }

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
          enterJumpsquat(!input.jump);
        }
      }
    }

    // An ordinary beta wall bounce reuses the reviewed PassiveWallJump body.
    // Its native passive speeds are an explicitly authored ordinary-wall policy;
    // resource endpoint44 adds no action lock and no jump-budget consumption.
    let footstooled = false;
    if (this.pendingFootstoolJump) {
      this.pendingFootstoolJump=false;
      this.donkeykongFullHopStep=null;
      // Native full-footstool accelerated entry is still unrecovered. Preserve
      // the previously reviewed authored basis, independently of the new FH curve.
      const basis=this.id==='donkeykong'&&this.donkeykongOrdinaryVertical?DONKEYKONG_FOOTSTOOL_BETA_JUMP_BASIS:this.tuning.jumpImpulse;
      const sourceLink=this.id==='link';
      vy=sourceLink?linkFootstoolJumpVelocity(basis,false,this.sourceLinkFootstoolRepeatCount):this.id==='donkeykong'?donkeyKongFootstoolJumpVelocity(basis,false,this.donkeykongFootstoolRepeatCount):-basis*PIKACHU_AUXILIARY_SOURCE_PARAMETERS.footstoolJumpSpeedYMultiplier;
      if(sourceLink){
        this.onIntrinsicSourceInterrupted();this.sourceJumpEventSerial+=1;
        this.sourceLinkFootstool={presentation:{role:'performer',phase:'jump',framesElapsed:0,facing:this.facing},
          entryFrame:this.simulationInputFrame,lastFrame:this.simulationInputFrame,generation:this.positionResetGeneration,mini:false,phantom:this.pendingFootstoolPhantom,
          contact:this.sourceLinkFootstoolPendingContact};this.sourceLinkFootstoolPendingContact=null;
        this.sourceLinkFootstoolRepeatCount+=1;this.sourceLinkFootstoolCooldown=LINK_FOOTSTOOL_SOURCE.cooldownFrames;this.sourceLinkFootstoolCooldownEntryFrame=this.simulationInputFrame;
      }
      if(this.id==='donkeykong'){
        this.donkeykongFootstoolPerformer={framesElapsed:0,facing:this.facing,mini:false,entryFrame:this.simulationInputFrame};
        this.donkeykongFootstoolRepeatCount+=1;
        this.donkeykongFootstoolCooldown=DONKEYKONG_FOOTSTOOL_REPEAT_RULES.cooldownFrames;
        this.donkeykongFootstoolCooldownEntryFrame=this.simulationInputFrame;
      }else if(!sourceLink)this.pikachuAuxiliaryAir={sheet:'footstool_jump',framesElapsed:0,facing:this.facing};
      this.footstoolMini=(this.id==='donkeykong'||sourceLink)&&this.pendingFootstoolPhantom?null:{basis,framesElapsed:0,cut:false};
      this.pendingFootstoolPhantom=false;
      this.jumpPresentation=null;this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;
      this.clearTumbleForStartedAction();this.airJumpRising=false;this.shortHopRising=false;
      this.fastFallLatched=false;this.jumpCutArmed=false;this.takeoffInputFrame=this.simulationInputFrame;footstooled=true;
    }
    let wallBounced = false;
    if (this.id === 'pikachu' && !footstooled && !grounded && this.canStartCommittedAction() &&
        !this.helpless && this.tauntPresentation === null && PIKACHU_AUXILIARY_SOURCE_PARAMETERS.wallJumpEnabled) {
      const surface = this.pikachuWallBounceSurface(), away = surface?.away;
      const outwardEdge = away !== undefined && moveX * away >= .5 && this.prevMoveX * away < .5;
      if (surface && away !== undefined && surface.wall !== this.pikachuWallBounceContact && (jumpJustPressed || outwardEdge)) {
        this.pikachuWallBounceContact = surface.wall;
        const unit = PIKACHU_AUXILIARY_SOURCE_PARAMETERS.referencePixelsPerUnit;
        vx = away * PIKACHU_AUXILIARY_SOURCE_PARAMETERS.passiveWallJumpSpeedX * unit;
        vy = -PIKACHU_AUXILIARY_SOURCE_PARAMETERS.passiveWallJumpSpeedY * unit;
        this.facing = away;
        this.pikachuAuxiliaryAir = {sheet:'wall_jump',framesElapsed:0,facing:away};
        this.jumpPresentation = null;
        this.jumpInputBufferFrames = 0;
        this.tapJumpBufferFrames = 0;
        this.clearTumbleForStartedAction();
        this.airJumpRising = true;
        this.shortHopRising = false;
        this.fastFallLatched = false;
        this.jumpCutArmed = false;
        this.takeoffInputFrame = this.simulationInputFrame;
        wallBounced = true;
      }
    }

    if (jumpJustPressed && !wallBounced && !footstooled && this.jumpsUsed < this.tuning.maxJumps) {
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
        if (grounded) {
          enterJumpsquat(!input.jump || attackEdgeForJump);
        } else {
          // Midair jumps have no grounded squat and remain immediate.
          applyJumpImpulse(false, true);
        }
      }
    }

    // Reset the jump budget when grounded *and* not in the middle of a
    // fresh jump impulse. Checking `vy >= 0` avoids the resetting
    // happening on the same frame we just kicked off the ground.
    if (grounded && vy >= 0) {
      this.jumpsUsed = 0;
      if(this.id==='donkeykong')this.donkeykongFootstoolRepeatCount=0;
      this.sourceLinkFootstoolRepeatCount=0;
      this.jumpPresentation = null;
    this.pikachuAuxiliaryAir = null;
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
    const dkNeutralAirDodge=this.id==='donkeykong'&&this.dodgeState.active?.kind==='air'&&!this.dodgeState.active.directional;
    const dkAerialItemThrow=this.itemAction?.plan.action.startsWith('throw-air-')===true;
    const dkRelaxExcessFall=dkNeutralAirDodge||dkAerialItemThrow;
    if(dkRelaxExcessFall){this.donkeykongFullHopStep=null;this.fastFallLatched=false;}
    if (this.referenceLaunch !== null) {
      this.donkeykongFullHopStep=null;
      // Fastfall is an explicit project control rule: descending total speed
      // gates it, and it replaces natural gravity without erasing launch/wind.
      if (!ledgeLocking && vy > 0 && (input.moveY ?? 0) > 0.6) this.fastFallLatched = true;
    } else if (sustainedRise || this.activeAttack?.move.gravityScale !== undefined) {
      this.donkeykongFullHopStep=null;
      // preparePhysicsStep replaces world gravity with the move's authored
      // acceleration. Ordinary jump shaping and fastfall would cancel it.
      this.fastFallLatched = false;
      this.jumpCutArmed = false;
    } else if(this.hitstunRemaining===0&&this.donkeykongOrdinaryVertical&&!ledgeLocking&&(!dodgeLocking||dkNeutralAirDodge)){
      // DK owns total ordinary gravity. preparePhysicsStep removes the world
      // dose, so editor/world gravity cannot silently add a second acceleration.
      const vertical=this.donkeykongOrdinaryVertical;
      if(!groundedForFall||this.isTakeoffStep()){
        this.donkeykongOrdinaryVerticalTick=true;
        const entryVy=vy;
        this.donkeykongOrdinaryEntryVelocityY=entryVy;
        if(this.donkeykongFullHopStep!==null&&this.donkeykongFullHopStep<vertical.fullHopStepVelocitiesY.length){
          vy=vertical.fullHopStepVelocitiesY[this.donkeykongFullHopStep++]!;
          this.donkeykongOpeningCarryY=donkeyKongFullHopCarriedVelocityY(vertical,this.donkeykongFullHopStep);
          if(this.donkeykongFullHopStep===vertical.fullHopStepVelocitiesY.length)this.donkeykongFullHopStep=null;
        }else if(dkRelaxExcessFall&&vy>this.tuning.maxFallSpeed){
          vy=Math.max(this.tuning.maxFallSpeed,vy-DONKEYKONG_VERTICAL_PARAMETERS.excessFallBrakeNative*DONKEYKONG_VERTICAL_PARAMETERS.worldUnitsPerNativeUnit);
        }else vy+=vertical.totalGravity;
        if(vy>=0){this.shortHopRising=false;this.airJumpRising=false;}
        if(!dkRelaxExcessFall&&!this.fastFallLatched&&vy>0&&(input.moveY??0)>.6)this.fastFallLatched=true;
        const terminal=this.fastFallLatched?this.tuning.fastFallSpeed:this.tuning.maxFallSpeed;
        if(this.fastFallLatched&&vy>0&&vy<terminal)vy=terminal;
        vy=Math.min(vy,Math.max(terminal,entryVy));
      }else{
        this.donkeykongFullHopStep=null;this.fastFallLatched=false;
        this.shortHopRising=false;this.airJumpRising=false;
      }
    } else if (this.hitstunRemaining === 0) {
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
      if (!groundedForFall || this.isTakeoffStep()) {
        const risingThisStep = vy < 0;
        if (risingThisStep && !ledgeLocking) {
          vy += this.airJumpRising
            ? this.tuning.airJumpRiseAccel ?? this.tuning.riseAccel ?? 0
            : this.shortHopRising
              ? this.tuning.shortHopRiseAccel ?? this.tuning.riseAccel ?? 0
              : this.tuning.riseAccel ?? 0;
        }
        if (vy >= 0) {
          this.shortHopRising = false;
          this.airJumpRising = false;
        }
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
        if (vy > 0 && !risingThisStep) {
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
        if (!this.isTakeoffStep()) {
          this.shortHopRising = false;
          this.airJumpRising = false;
        }
      }
    } else {
      this.donkeykongFullHopStep=null;
      // Hitstun owns the velocity — drop both latches so the launch
      // arc can't inherit a stale fast-fall or jump-cut.
      this.fastFallLatched = false;
      this.jumpCutArmed = false;
    }

    // ---- Ledge-hang freeze / climb-up drive (AC 60403 Sub-AC 3) -----------
    // Velocity is forced to zero each step (position-driven) so gravity or
    // residual knockback can't drift the fighter off the corner.
    //   • `'hanging'` — hard freeze at the latch corner.
    //   • `'climbing'`/`'rolling'` — interpolate the body from the latch
    //     corner up to the on-platform standing target across
    //     `climbFrames`/`rollFrames` via a pure smoothstep, so the get-up
    //     reads as a continuous climb instead of a one-frame teleport. The
    //     completion-frame snap below supplies the exact final pixel.
    // Both endpoints are re-read from the live `active` snapshot each step
    // (moving-platform-ready) and the standing target shares one formula
    // with the completion snap so they can never drift apart.
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
      const a = this.ledgeHangState.active;
      const name = this.ledgeHangState.name;
      const sourceTarget = this.getPikachuLedgeAttachmentTarget();
      if (sourceTarget !== null) {
        if (sourceTarget.mode === 'pin-hand') {
          this.scene.matter.body.setPosition(this.body, sourceTarget.position);
        }
        // Source-root transitions are integrated before physics below, so
        // unrelated solid geometry can obstruct the authored path.
      } else if (name === 'climbing' || name === 'rolling') {
        const mode = name === 'rolling' ? 'roll' : 'climb';
        const denom =
          mode === 'roll'
            ? this.tuning.ledge.rollFrames
            : this.tuning.ledge.climbFrames;
        const target = computeLedgeStandingTarget(
          a.candidate.x,
          a.candidate.y,
          a.candidate.side,
          mode,
          this.tuning.width,
          this.tuning.height,
          this.tuning.ledge.rollDistance,
        );
        const e = ledgeRecoverySmoothstep(a.framesElapsed, denom);
        this.scene.matter.body.setPosition(this.body, {
          x: a.latchX + (target.x - a.latchX) * e,
          y: a.latchY + (target.y - a.latchY) * e,
        });
      } else {
        // `'hanging'` — hard freeze at the corner (identical to before).
        this.scene.matter.body.setPosition(this.body, {
          x: a.latchX,
          y: a.latchY,
        });
      }
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
      if (directionalDodge?.gravityEnabled) {
        this.airDodgeGravityVelocityY = Math.min(this.tuning.maxFallSpeed,
          this.airDodgeGravityVelocityY + this.tuning.fallAccel + 1000 / 3600);
      }
      vy = this.airDodgeBurst.y + (directionalDodge ? this.airDodgeGravityVelocityY : 0);
      this.airDodgeBurst = {
        x: this.airDodgeBurst.x * AIRDODGE_BURST_DECAY,
        y: this.airDodgeBurst.y * AIRDODGE_BURST_DECAY,
      };
    }

    // Source-guided throw trajectory replaces only its horizontal authored
    // component. Matter still integrates and solves walls/floors; no pose offset
    // or absolute position snap transports the actor through stage geometry.
    const throwMotion = this.getAuthoredThrowRootMotion();
    if (throwMotion !== null) {
      const age = throwMotion.frame;
      vx = age === 0 ? 0 : (throwMotion.samples[age]! - throwMotion.samples[age - 1]!) * throwMotion.facing;
      this.throwRootMotionApplied = true;
    } else if (this.throwRootMotionApplied) {
      // The final displacement is not an inherited slide after action exit.
      vx = 0;
      this.throwRootMotionApplied = false;
    }

    if (this.tauntPresentation !== null) vx = 0;

    // ---- Commit velocity ---------------------------------------------------
    // Phaser's Matter wrapper exposes the BodyFactory at `scene.matter.body`.
    // Using setVelocity (vs mutating `body.velocity` directly) keeps
    // Matter's previous-position cache in sync so integration stays
    // stable.
    this.scene.matter.body.setVelocity(this.body, {
      x: vx + (this.referenceLaunch ? this.launchVelocity?.x ?? 0 : 0), y: vy,
    });

    // ---- Climb-up translation (AC 60403 Sub-AC 3) -------------------------
    // The climb animation just finished — translate the fighter onto
    // the platform top at the inward side of the ledge so the climb
    // ends with the fighter standing on the stage, not floating at the
    // latch point. The state machine has already rolled to `'cooldown'`
    // at this point so the lock-in-place loop above does NOT fight
    // this translation.
    if (climbingTransitionCompleted !== null && this.id !== 'pikachu') {
      // Authoritative final placement — the exact pixel the per-frame
      // climb lerp eases toward (shares `computeLedgeStandingTarget` so
      // the interpolation endpoint and this snap can never drift apart).
      const target = computeLedgeStandingTarget(
        climbingTransitionCompleted.x,
        climbingTransitionCompleted.y,
        climbingTransitionCompleted.side,
        'climb',
        this.tuning.width,
        this.tuning.height,
        this.tuning.ledge.rollDistance,
      );
      this.scene.matter.body.setPosition(this.body, { x: target.x, y: target.y });
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    }

    // ---- Roll-up translation (AC 60404 Sub-AC 4) --------------------------
    // Mirrors the climb-up translation above but offset further inward
    // by the ledge tuning's `rollDistance`. The fighter lands past the
    // corner — the visible payoff of the "evasive roll" recovery option.
    if (rollingTransitionCompleted !== null && this.id !== 'pikachu') {
      // Authoritative final placement (further inward by `rollDistance`),
      // sharing the same target formula as the per-frame roll lerp.
      const target = computeLedgeStandingTarget(
        rollingTransitionCompleted.x,
        rollingTransitionCompleted.y,
        rollingTransitionCompleted.side,
        'roll',
        this.tuning.width,
        this.tuning.height,
        this.tuning.ledge.rollDistance,
      );
      this.scene.matter.body.setPosition(this.body, { x: target.x, y: target.y });
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
    const canConsumeBufferedOffense =
      this.offensiveActionBuffer !== null &&
      this.canAttack() &&
      this.chargingSpecial === null &&
      this.chargingSmash === null &&
      this.jumpsquatRemaining === 0 &&
      !shieldRaised &&
      !dodgeLocking &&
      !ledgeLocking &&
      !helpless &&
      !grabActing;
    const bufferedOffense = canConsumeBufferedOffense
      ? this.offensiveActionBuffer
      : null;
    const sameFrameBufferedOffense =
      bufferedOffense?.remaining === OFFENSIVE_ACTION_BUFFER_FRAMES;
    if (bufferedOffense) this.offensiveActionBuffer = null;
    const attackHeldEffective =
      !shieldRaised &&
      !dodgeLocking &&
      !ledgeLocking &&
      !helpless &&
      !grabActing &&
      this.jumpsquatRemaining === 0 &&
      (bufferedOffense
        ? bufferedOffense.kind === 'attack'
        : input.attack === true);
    const heavyHeldEffective =
      !shieldRaised &&
      !dodgeLocking &&
      !ledgeLocking &&
      !helpless &&
      !grabActing &&
      this.jumpsquatRemaining === 0 &&
      (bufferedOffense
        ? bufferedOffense.kind === 'heavy'
        : input.attackHeavy === true);
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
      this.jumpsquatRemaining === 0 &&
      (bufferedOffense
        ? bufferedOffense.kind === 'special'
        : input.special === true);
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
    // A right-stick heavy press carries its own direction: it replaces the
    // left stick and the leniency window, so holding down (crouch) then
    // flicking the right stick forward still reads as a forward smash.
    const olderBufferedOffense =
      bufferedOffense !== null && !sameFrameBufferedOffense ? bufferedOffense : null;
    const liveHeavyStick =
      bufferedOffense === null || bufferedOffense.kind === 'heavy'
        ? this.heavyPressStick(input)
        : null;
    const attackFromStick = olderBufferedOffense
      ? olderBufferedOffense.fromStick
      : liveHeavyStick !== null;
    const attackMoveX = olderBufferedOffense
      ? olderBufferedOffense.moveX
      : liveHeavyStick?.x ?? moveX;
    // A jumpsquat up-smash cancel aims with this step's stick (what the
    // cancel tested), not the leniency window.
    const attackMoveY = olderBufferedOffense
      ? olderBufferedOffense.moveY
      : liveHeavyStick?.y ?? (jumpsquatUpSmashCancel ? curMoveY : bufferedMoveY);
    // Down-special fires on a held DOWN-stick, not only the drop-through
    // gesture. Without the stick read, holding down + special fell through to
    // the NEUTRAL special — so e.g. Nova's bomb (down-B) was unreachable and a
    // down+special gave the CANNON CHARGE (neutral-B) instead. (+moveY = down
    // in screen-space; same 0.3 threshold the down-tilt/down-smash use.)
    const downSpecialHeld =
      input.dropThrough === true || attackMoveY >= DEFAULT_NEUTRAL_THRESHOLD;
    this.tickAttack(
      attackHeldEffective,
      heavyHeldEffective,
      this.isGroundedForActionStart(),
      attackMoveX,
      bufferedOffense && !sameFrameBufferedOffense
        ? bufferedOffense.facing
        : prevFacing,
      specialHeldEffective,
      downSpecialHeld,
      // Up-special is reachable via the up-stick too, not only the jump
      // button — on a gamepad, jump (button 0) and the up-stick are separate
      // inputs, so a stick-only up+special would otherwise fall through to the
      // NEUTRAL special. Mirrors the down-special stick read above.
      input.jump === true || attackMoveY <= -DEFAULT_NEUTRAL_THRESHOLD,
      shieldHeld,
      attackMoveY,
      bufferedOffense?.kind ?? null,
      !shieldRaised && !dodgeLocking && !ledgeLocking && !helpless &&
        !grabActing && !this.isInLandingRecovery() && this.jumpsquatRemaining === 0,
      attackFromStick,
    );
    this.updateAerialLandingContext();

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
    this.prePhysicsVelocityY = this.body.velocity.y;
  }

  private updateOffensiveActionBuffer(input: CharacterInput): void {
    if (this.offensiveActionBuffer !== null) {
      this.offensiveActionBuffer.remaining -= 1;
      if (this.offensiveActionBuffer.remaining <= 0) {
        this.offensiveActionBuffer = null;
      }
    }
    if (
      this.offensiveActionBuffer !== null ||
      this.grabbedBy !== null ||
      (this.grabSpec !== null && isGrabActing(this.grabState))
    ) {
      return;
    }
    const kind =
      input.special === true &&
      !this.prevSpecialHeld &&
      (this.neutralSpecialId !== null ||
        Array.from(this.attacks.values()).some(
          (move) => move.type === 'sideSpecial',
        ) ||
        this.upSpecialId !== null ||
        this.downSpecialId !== null)
        ? 'special'
        : input.attackHeavy === true &&
            !this.prevHeavyHeld &&
            (this.heavyAttackId !== null ||
              this.upSmashId !== null ||
              this.downSmashId !== null ||
              // Airborne, a heavy press fires an aerial.
              (!this.isGrounded() && (this.aerialAttackId ?? this.aerialNeutralId ??
                this.aerialForwardId ?? this.aerialBackId ?? this.aerialUpId ??
                this.aerialDownId) !== null))
          ? 'heavy'
          : input.attack === true && !this.prevAttackHeld
            ? 'attack'
            : null;
    if (kind === null) return;
    if (kind === 'attack' && this.activeAttack !== null) {
      const move = this.activeAttack.move as AttackMoveWithAnimation;
      const chain = move.jabChain;
      if (
        chain &&
        this.canAdvanceJab(move,this.activeAttack.framesElapsed)
      ) {
        // tickAttack consumes this edge as an immediate jab-chain advance.
        return;
      }
    }
    const stick = kind === 'heavy' ? this.heavyPressStick(input) : null;
    this.offensiveActionBuffer = {
      kind,
      remaining: OFFENSIVE_ACTION_BUFFER_FRAMES,
      moveX: stick ? stick.x : clamp(input.moveX, -1, 1),
      moveY: stick ? stick.y : clamp(input.moveY ?? 0, -1, 1),
      facing: this.facing,
      fromStick: stick !== null,
    };
  }

  /**
   * Right-stick direction of a heavy press made this frame, or null when
   * the press has none (a smash key, the CPU) or heavy did not rise. Read
   * before the end-of-step `prevHeavyHeld` latch.
   */
  private heavyPressStick(input: CharacterInput): { x: number; y: number } | null {
    if (input.attackHeavy !== true || this.prevHeavyHeld) return null;
    const x = finiteClamp(input.attackStickX);
    const y = finiteClamp(input.attackStickY);
    return x === 0 && y === 0 ? null : { x, y };
  }

  /**
   * Whether this step's heavy press, made during jumpsquat, is aimed up and
   * so cancels the jump into the up smash. A right-stick press aims with its
   * own direction; a smash key reads THIS step's left stick only. There is
   * deliberately no {@link DIRECTIONAL_INPUT_WINDOW} leniency here: on
   * keyboard the W (up + jump) that started the jump is still in that
   * window, so a neutral or sideways press made after letting go of W would
   * cancel the jump too. Up needs moveY at or past the neutral threshold
   * and strict vertical dominance (|y| > |x|): a diagonal W + D press is
   * not up — it keeps the short hop and comes out as the aerial.
   */
  private isJumpsquatUpSmashPress(input: CharacterInput, moveX: number): boolean {
    if (this.upSmashId === null || input.attackHeavy !== true || this.prevHeavyHeld) return false;
    const stick = this.heavyPressStick(input);
    const x = stick !== null ? stick.x : moveX;
    const y = stick !== null ? stick.y : input.moveY ?? 0;
    return y <= -DEFAULT_NEUTRAL_THRESHOLD && Math.abs(y) > Math.abs(x);
  }

  /**
   * Whether an up-aimed special press (made this step or still buffered) is
   * pending during jumpsquat for a fighter whose up special has a distinct
   * grounded record, so the jump is dropped for the standing up special.
   * Fighters with a single up-special record keep their buffered start.
   */
  private isJumpsquatUpSpecialPress(): boolean {
    const pending = this.offensiveActionBuffer;
    if (pending?.kind !== 'special' || pending.moveY > -DEFAULT_NEUTRAL_THRESHOLD || !this.canAttack()) return false;
    const move = this.upSpecialId === null ? undefined : this.attacks.get(this.upSpecialId);
    return move !== undefined && isUpSpecialMove(move) && move.upSpecialKind === 'multiHitRising' &&
      move.groundedVariant !== undefined;
  }

  /** True on the input step whose takeoff impulse was just written. */
  private isTakeoffStep(): boolean {
    return this.takeoffInputFrame === this.simulationInputFrame;
  }

  /**
   * Grounded state for choosing a newly started action's record (grounded
   * vs aerial variant, entry-velocity scale). On a takeoff step the body
   * still touches its support until the Matter step, but the jump impulse is
   * already written: the action starts airborne so a grounded record cannot
   * inherit (and hold) the jump velocity.
   */
  private isGroundedForActionStart(): boolean {
    return this.isGrounded() && !this.isTakeoffStep();
  }

  private updateJumpInputBuffer(input: CharacterInput): void {
    if (this.jumpInputBufferFrames > 0) this.jumpInputBufferFrames -= 1;
    if (
      input.jump &&
      !this.prevJumpHeld &&
      this.grabbedBy === null &&
      this.jumpsquatRemaining === 0
    ) {
      this.jumpInputBufferFrames = JUMP_INPUT_BUFFER_FRAMES;
    }
  }

  private hasJumpIntent(input: CharacterInput): boolean {
    return (input.jump && !this.prevJumpHeld) || this.jumpInputBufferFrames > 0;
  }

  private updateTechInputBuffer(input: CharacterInput): void {
    const queued=this.pendingKnockback?.vector;
    const canTechLaunch=this.tumbling||(queued!==undefined&&(this.pendingKnockback?.tumble??Math.hypot(queued.x,queued.y)>=TUMBLE_KNOCKBACK_THRESHOLD));
    const pressed=input.shield===true&&!this.prevShieldHeld||input.dodge===true&&!this.prevDodgeHeld;
    const next=advanceTechInputWindow({bufferRemaining:this.techBufferRemaining,lockoutRemaining:this.techLockoutRemaining},
      {pressed,canTechLaunch,frozen:this.hitlagRemaining>0});
    this.techBufferRemaining=next.bufferRemaining;this.techLockoutRemaining=next.lockoutRemaining;
  }

  private clearTumbleForStartedAction(): void {
    this.tumbling = false;
    this.techBufferRemaining = 0;
    this.aerialLandingContext = null;
  }

  /**
   * Shared entry gate for grab and defense. Existing actions retain their own
   * progression and explicit cancels (jab chains, landings, charge banking).
   * Shield may bank a neutral-special charge; it cannot cancel smash charging.
   */
  private canStartCommittedAction(allowShieldChargeBank = false): boolean {
    if(this.donkeykongHeavyItemHeld||this.donkeykongHeavyItemAction)return false;
    if(this.itemEating||this.itemAction||this.itemShooting||this.isHammerLocked())return false;
    if(this.isSurfaceTechLocking())return false;
    return this.buriedState === null && !this.grabState.active?.cargo && this.pikachuLedgeJump?.phase!=='start' && this.groundRecovery === null && this.footstoolRecipient === null && this.pikachuGroundRecovery === null && this.grabReleasePresentation === null && this.tauntPresentation === null && this.attackClankRemaining === 0 && !this.attackClankLockedStep && this.activeAttack === null &&
      this.shieldReleaseRemaining === 0 &&
      !this.shieldParryProtected &&
      !this.isInLandingRecovery() &&
      this.chargingSmash === null &&
      (this.chargingSpecial === null || (allowShieldChargeBank && !this.chargingSpecial.groundedUpSpecial && !this.chargingSpecial.donkeykongPunch)) &&
      !isGrabActing(this.grabState) &&
      !isDodgeActing(this.dodgeState) &&
      !isLedgeLockingInput(this.ledgeHangState) &&
      this.jumpsquatRemaining === 0 &&
      (!this.helpless || this.isGrounded());
  }

  private isInLandingRecovery(): boolean {
    return this.ordinaryLandingRemaining > 0 ||
      (this.landingRecovery && this.cooldownRemaining > 0);
  }

  private tickLanding(): void {
    this.ordinaryLandingRemaining = Math.max(0, this.ordinaryLandingRemaining - 1);
    if (this.landingRecovery) {
      this.cooldownRemaining = Math.max(0, this.cooldownRemaining - 1);
      if (this.cooldownRemaining === 0) {
        this.landingRecovery = false;
        // Retire before arbitration on the first free step, so the nested
        // action cannot append another attack-busy frame to landing lag.
        if (this.activeAttack !== null && this.activeAttack === this.landingAttackInstance) this.cancelAttack();
      }
    }
    const ordinaryLag = this.pendingOrdinaryLandingFrames ?? this.tuning.softLandingFrames ?? 0;
    const ordinaryKind = this.pendingOrdinaryLandingKind ?? 'soft';
    this.pendingOrdinaryLandingFrames = null;
    this.pendingOrdinaryLandingKind = null;
    if (this.prevGrounded || !this.isGrounded()) return;
    if (this.continueUpSpecialOnGround()) return;
    const specialLag = this.getSpecialLandingFrames();
    if (specialLag !== null) {
      this.landingPresentation = { kind: 'special', totalFrames: specialLag,
        ...(this.activeAttack ? { moveId: this.activeAttack.move.id,sourcePoseId:this.activeAttack.move.sourcePoseId } : {}) };
      this.cancelAttack();
      this.helpless = false;
      this.cooldownRemaining = specialLag;
      this.landingRecovery = specialLag > 0;
      return;
    }
    const dodgeLag = this.getAirDodgeLandingFrames();
    if (dodgeLag !== null) {
      this.landingPresentation = { kind: this.dodgeState.active?.directional ? 'directional-air-dodge' : 'air-dodge', totalFrames: dodgeLag };
      // Contact ends the airborne action, its burst and its intangibility.
      // The ground commitment replaces the airborne remainder.
      this.dodgeState = resetDodgeState();
      this.airDodgeBurst = null;
      this.airDodgeGravityVelocityY = 0;
      this.ordinaryLandingRemaining = dodgeLag;
      return;
    }
    const attack = this.activeAttack?.move.type === 'aerial'
      ? this.activeAttack
      : this.activeAttack === null ? this.aerialLandingContext : null;
    if (attack === null) {
      // Unauthored specials/dodges and ledge actions retain their existing
      // transitions. Ordinary recovery cannot interrupt them.
      if (this.activeAttack === null && this.chargingSmash === null &&
          this.chargingSpecial === null && !isGrabActing(this.grabState) &&
          !isDodgeActing(this.dodgeState) && !isLedgeLockingInput(this.ledgeHangState) &&
          !this.helpless) {
        this.ordinaryLandingRemaining = ordinaryLag;
        this.landingPresentation = { kind: ordinaryKind, totalFrames: ordinaryLag };
      }
      return;
    }
    const aerial = attack.move as Partial<AerialMove>;
    // Legacy aerial records carry no penalty. Authored autocancel windows
    // skip the move's penalty using the frame that actually touched the floor,
    // before advancing the attack timeline for the next integration.
    const lag = typeof aerial.landingLagFrames === 'number'
      ? getLandingLagFrames(attack.move as AerialMove, attack.framesElapsed)
      : 0;
    const landingAttack = lag > 0 ? aerial.landingAttack : undefined;
    const facing = attack.facing;
    if (landingAttack !== undefined) validateAerialLandingAttack(attack.move as AerialMove);
    this.cancelAttack();
    this.cooldownRemaining = lag;
    this.landingRecovery = lag > 0;
    this.ordinaryLandingRemaining = lag > 0 ? 0 : ordinaryLag;
    this.landingPresentation = lag > 0 ? { kind: 'aerial', totalFrames: lag, moveId: attack.move.id,sourcePoseId:attack.move.sourcePoseId,entryFrame:this.simulationInputFrame,facing }
      : { kind: ordinaryKind, totalFrames: ordinaryLag };
    if(lag>0)this.notifySourceAerialLandingAdmitted(Object.freeze({frame:this.simulationInputFrame,generation:this.positionResetGeneration,
      moveId:attack.move.id,sourcePoseId:attack.move.sourcePoseId??null,facing,landingLagFrames:lag}));
    if (landingAttack !== undefined) {
      this.activeAttack = { move: landingAttack, facing, framesElapsed: 0,
        hitboxBody: null, upSpecial: null, chargeHeldFrames: null };
      this.landingAttackInstance = this.activeAttack;
      this.landingAttackActivationPending = true;
    }
  }

  /**
   * A `multiHitRising` spin with `groundedLandingFrame` that touches down
   * before special fall continues on its grounded variant from that frame
   * instead of taking special landing lag. A grounded spin that left its
   * floor lands into the same frame unless it is already past it. Contact
   * while still rising is not a landing.
   */
  private continueUpSpecialOnGround(): boolean {
    const a = this.activeAttack;
    if (a === null || a.move.type !== 'upSpecial' || this.helpless) return false;
    const spin = this.attacks.get(a.move.id);
    if (!spin || !isUpSpecialMove(spin) || spin.upSpecialKind !== 'multiHitRising') return false;
    const frame = spin.groundedLandingFrame;
    if (frame === undefined || (a.move.sheetVariant === 'ground' && a.framesElapsed >= frame)) return false;
    // Rising through a pass-through platform's top is contact, not a landing: the spin goes on.
    if (this.body.velocity.y < 0) return true;
    if (a.hitboxBody !== null) {
      despawnHitbox(this.scene, a.hitboxBody);
      a.hitboxBody = null;
    }
    this.clearTransientHitboxes();
    this.multiHitNextIndex = 0;
    a.move = Character.groundedUpSpecialAttack(spin);
    a.framesElapsed = frame;
    // The landing step presents the entry frame; tickAttack advances from it next step.
    a.holdInitialFrame = true;
    return true;
  }

  private static groundedUpSpecialAttack(move: MultiHitRisingUpSpecialMove): AttackMove {
    return { ...move.groundedVariant!, id: move.id, type: 'upSpecial', sheetVariant: 'ground' };
  }

  private getSpecialLandingFrames(): number | null {
    const intrinsic=this.getIntrinsicSourceLandingFrames();if(intrinsic!==null)return intrinsic;
    const move = this.activeAttack?.move;
    if (move && (move.type === 'special' || move.type === 'sideSpecial' ||
        move.type === 'upSpecial' || move.type === 'downSpecial')) {
      return move.specialLandingLagFrames ?? null;
    }
    return this.helpless ? this.specialFallLandingFrames : null;
  }

  private getAirDodgeLandingFrames(): number | null {
    if (!isDodgeActing(this.dodgeState) || this.dodgeState.active?.kind !== 'air') return null;
    const active = this.dodgeState.active;
    if (!active.directional) return this.tuning.airDodgeLandingFrames ?? null;
    const early = this.tuning.directionalAirDodgeLandingFrames;
    const late = this.tuning.directionalAirDodgeLateLandingFrames;
    if (early === undefined || late === undefined) return early ?? null;
    return Math.round(early + (late - early) * dodgeProgress(active, this.tuning.dodge));
  }

  private updateAerialLandingContext(): void {
    const attack = this.activeAttack;
    if (attack !== null) {
      this.aerialLandingContext = attack.move.type === 'aerial' &&
        typeof (attack.move as Partial<AerialMove>).landingLagFrames === 'number'
        ? { move: attack.move as AerialMove, framesElapsed: attack.framesElapsed, facing: attack.facing }
        : null;
    } else if (this.aerialLandingContext !== null) {
      this.aerialLandingContext.framesElapsed += 1;
      if (getLandingLagFrames(this.aerialLandingContext.move, this.aerialLandingContext.framesElapsed) === 0) {
        this.aerialLandingContext = null;
      }
    }
  }

  private applyLaunchVelocityDecay(): void {
    if (this.launchVelocity === null) return;
    const current = this.body.velocity;
    const residual = {
      x: current.x - this.launchVelocity.x,
      y: current.y - this.launchVelocity.y,
    };
    const decayed = decayLaunchVelocity(this.launchVelocity, this.launchDecayPerFrame);
    this.launchVelocity = decayed;
    this.scene.matter.body.setVelocity(this.body, {
      x: residual.x + decayed.x,
      y: residual.y + decayed.y,
    });
  }

  /** A new motion owner keeps the body's current velocity but replaces its provenance. */
  private clearReferenceLaunch(): void {
    if (this.referenceLaunch === null) return;
    this.referenceLaunch = null;
    this.launchVelocity = null;
    this.launchDecayPerFrame = undefined;
    this.hitstunGravityVelocityY = 0;
    this.pendingHitstunGravityCorrection = 0;
  }

  /**
   * Replace the upcoming world-gravity contribution for authored move motion
   * or reference launch energy.
   * Call before the first integration and each additional reference tick in a
   * compressed group. Only the first call cancels the outer world-gravity dose.
   * Release uses zero gravity; subsequent active reference ticks advance it.
   * Natural gravity remains independent of launch, carried motion and wind.
   */
  preparePhysicsStep(worldGravityDeltaY: number, additionalReferenceTick = false): void {
    if(this.intrinsicSourceHitbox){const plugin=this.intrinsicSourceHitbox.plugin as import('./attacks').HitboxPlugin;
      updateHitboxPosition(this.scene,this.intrinsicSourceHitbox,this.body.position,
        {hitbox:plugin.hitbox} as AttackMove,plugin.facing);}
    if (this.finalSmashControl) {
      const control = this.finalSmashControl;
      if (!additionalReferenceTick && control.gravityDisabled)
        this.scene.matter.body.setVelocity(this.body, { x: this.body.velocity.x,
          y: this.body.velocity.y - worldGravityDeltaY });
      return;
    }

    if(this.shieldBreak&&shieldBreakControlsLocked(this.shieldBreak)){
      if(!additionalReferenceTick&&!this.sourcePresentationClockAdvances){this.scene.matter.body.setVelocity(this.body,{x:0,y:-worldGravityDeltaY});return;}
      if(!additionalReferenceTick&&!this.isInHitlag()){
        const phase=this.shieldBreak;
        if(phase.phase==='pop'){
          if(this.shieldBreakVelocityY===null)this.shieldBreakVelocityY=this.shieldBreakPop().initialVelocityY;
          if(this.shieldBreakPhysicsFrame!==this.simulationInputFrame){this.shieldBreakVelocityY+=this.shieldBreakPop().gravity;
            this.shieldBreakPhysicsFrame=this.simulationInputFrame;}
          this.scene.matter.body.setVelocity(this.body,{x:0,y:this.shieldBreakVelocityY-worldGravityDeltaY});
        }else this.scene.matter.body.setVelocity(this.body,{x:0,y:-worldGravityDeltaY});
      }
      return;
    }

    // A sourced kinetic profile already owns traction. Avoid a second Matter
    // floor-friction dose, retaining normal wall solving and every other fighter.
    const dkOrdinaryGround=this.id==='donkeykong'&&!this.donkeykongHeavyItemHeld&&this.isGrounded()&&this.canPresentUncommittedBody()&&
      (this.donkeykongTurnBrake!==null||['run','standing','crouch','pivot'].includes(this.locomotionState.name));
    if((this.activeAttack?.move.groundedMotion&&this.isGrounded())||dkOrdinaryGround){
      if(this.sourcedGroundFrictionBackup===null)this.sourcedGroundFrictionBackup=this.body.friction;
      this.body.friction=0;
    }else this.restoreSourcedGroundFriction();
    if (!this.finalSlowLocalStep) return;
    this.validateLedgeAttackAttachmentOwner();
    const energy = this.referenceLaunch;
    if (this.destroyed || this.hitlagRemaining > 0 || this.pikachuLedgeFlightHitlagRelease ||
        this.body.isStatic || this.body.isSleeping) return;
    if(!additionalReferenceTick)this.syncDonkeyKongAttackCollisionPose();
    this.pikachuLastGravityDose=worldGravityDeltaY;
    if(!additionalReferenceTick&&this.sourcedShieldPush){
      const push=this.sourcedShieldPush;this.shieldPushApplied=push.speed;
      this.scene.matter.body.setVelocity(this.body,{x:this.body.velocity.x+push.speed,y:this.body.velocity.y});
      push.speed=decayShieldPushback(push.speed,getNativeShieldPushTraction(this.id)??this.authoredShieldPushTraction,push.attacker);
      if(push.speed===0)this.sourcedShieldPush=null;
    }
    if (!additionalReferenceTick && this.pikachuLedgeJump?.phase==='start') {
      const jump=this.pikachuLedgeJump,target=this.getPikachuLedgeAttachmentTarget();
      if(!target)throw new Error('Ledge jump source start lacks its live root');
      this.configurePikachuLedgeAttachmentPairs();
      this.scene.matter.body.setVelocity(this.body,{
        x:(target.x-jump.previousOffset.x)*jump.facing+target.corner.x-jump.previousCorner.x,
        y:target.y-jump.previousOffset.y+target.corner.y-jump.previousCorner.y-worldGravityDeltaY});
      jump.previousOffset={x:target.x,y:target.y};jump.previousCorner={x:target.corner.x,y:target.corner.y};return;
    }
    if (!additionalReferenceTick && this.pikachuLedgeJump?.phase==='flight' && this.pikachuLedgeJump.framesElapsed===0)
      this.scene.matter.body.setVelocity(this.body,{x:PIKACHU_LEDGE_JUMP_SOURCE_TRAVEL.speedX*this.pikachuLedgeJump.facing,y:this.body.velocity.y});
    const ledgeTarget = this.getPikachuLedgeAttachmentTarget();
    if (!additionalReferenceTick && ledgeTarget !== null) {
      this.configurePikachuLedgeAttachmentPairs();
      if (ledgeTarget.mode === 'pin-hand') {
        this.scene.matter.body.setPosition(this.body, ledgeTarget.position);
        this.scene.matter.body.setVelocity(this.body, { x: 0, y: -worldGravityDeltaY });
      } else {
        this.scene.matter.body.setVelocity(this.body, {
          x: ledgeTarget.position.x - this.body.position.x,
          y: ledgeTarget.position.y - this.body.position.y - worldGravityDeltaY,
        });
      }
      return;
    }
    this.configurePikachuLedgeAttachmentPairs();
    if (this.ledgeAttackAttachment && !additionalReferenceTick) {
      const state = this.ledgeAttackAttachment;
      const age = this.activeAttack!.framesElapsed;
      const points = state.move.ledgeRootMotion!;
      const next = points[age]!;
      const previous = points[Math.max(0, state.frame)]!;
      const sameAge = age === state.frame;
      const corner = this.ledgeCandidates.find(c => c.platformId === state.candidate.platformId && c.side === state.candidate.side) ?? state.candidate;
      const dx = corner.x - state.corner.x, dy = corner.y - state.corner.y;
      state.corner = {x: corner.x, y: corner.y};
      this.configureLedgeAttackPairs();
      if (this.activeAttack!.hitboxBody) {
        this.activeAttack!.hitboxBody.plugin.ownerAnchoredContact = true;
        this.activeAttack!.hitboxBody.plugin.postPhysicsContactOnly = true;
      }
      this.scene.matter.body.setVelocity(this.body, {
        x: (sameAge ? 0 : next.x - previous.x) * state.facing + dx,
        y: state.attached ? (sameAge ? 0 : next.y - previous.y) + dy - worldGravityDeltaY : this.body.velocity.y,
      });
      state.frame = age;
      return;
    }
    const directional = this.id === 'pikachu' && this.dodgeState.active?.kind === 'air' &&
      this.dodgeState.active.directional ? pikachuDirectionalDodgePhase(this.dodgeState.active.framesElapsed) : null;
    if (energy === null && directional && (!directional.gravityEnabled || this.dodgeState.name === 'active')) {
      if (!additionalReferenceTick && !this.body.ignoreGravity) this.scene.matter.body.setVelocity(this.body, {
        x: this.body.velocity.x, y: this.body.velocity.y - worldGravityDeltaY,
      });
      return;
    }
    const specialGravity = this.pikachuSpecialRuntime?.gravity();
    const gravityScale = this.activeAttack?.move.gravityScale;
    if (energy === null && gravityScale !== undefined) {
      if (!additionalReferenceTick && !this.body.ignoreGravity) this.scene.matter.body.setVelocity(this.body, {
        x: this.body.velocity.x,
        // DK Headbutt's published .5 gravity multiplier scales its sourced
        // ordinary total, rather than half of this world's unrelated dose.
        y: this.body.velocity.y + (this.donkeykongOrdinaryVertical
          ? this.donkeykongOrdinaryVertical.totalGravity*gravityScale-worldGravityDeltaY
          : worldGravityDeltaY*(gravityScale-1)),
      });
      return;
    }
    if (energy === null && specialGravity !== undefined && specialGravity !== null) {
      if (!additionalReferenceTick && !this.body.ignoreGravity) this.scene.matter.body.setVelocity(this.body, {
        x: this.body.velocity.x, y: this.body.velocity.y + specialGravity - worldGravityDeltaY,
      });
      return;
    }
    const flight = this.getSustainedUpSpecialRise();
    if (energy === null && flight !== null &&
        this.activeAttack!.framesElapsed < flight.gravityFrames) {
      // Other fighters can subdivide world integration for reference launches;
      // this move still receives exactly one gravity dose per gameplay frame.
      if (!additionalReferenceTick && !this.body.ignoreGravity) {
        const worldGravity = Number.isFinite(worldGravityDeltaY) ? worldGravityDeltaY : 0;
        this.scene.matter.body.setVelocity(this.body, {
          x: this.body.velocity.x,
          y: this.body.velocity.y + flight.gravity - worldGravity,
        });
      }
      return;
    }
    if (energy === null) {
      if(!additionalReferenceTick&&this.donkeykongOrdinaryVerticalTick&&!this.body.ignoreGravity)
        this.scene.matter.body.setVelocity(this.body,{x:this.body.velocity.x,
          y:donkeyKongVerticalPrePhysicsVelocity(this.body.velocity.y,worldGravityDeltaY)});
      return;
    }
    if (!energy.firstStep && (this.referenceStunnedStep || additionalReferenceTick)) this.applyLaunchVelocityDecay();
    const nextGravity = this.body.ignoreGravity ? energy.gravityY : energy.firstStep ? 0 : this.fastFallLatched && !this.referenceStunnedStep
      ? this.tuning.fastFallSpeed
      : stepReferenceGravity(energy.gravityY, energy.profile, energy.vertical, this.referenceStunnedStep);
    const worldGravity = !this.body.ignoreGravity && Number.isFinite(worldGravityDeltaY) ? worldGravityDeltaY : 0;
    this.scene.matter.body.setVelocity(this.body, {
      x: this.body.velocity.x,
      y: this.body.velocity.y + nextGravity - energy.gravityY - worldGravity,
    });
    energy.gravityY = nextGravity;
    energy.firstStep = false;
  }

  /** The ordinary reference ticks to simulate inside this one gameplay frame. */
  getReferencePhysicsStep(): { token: object; ticks: number } | null {
    if (!this.finalSlowLocalStep) return null;
    const energy = this.referenceLaunch;
    if (this.destroyed || energy === null || energy.interrupted || !this.referenceStunnedStep ||
        this.hitlagRemaining > 0 || this.pendingKnockback !== null ||
        this.body.isStatic || this.body.isSleeping) return null;
    return { token: energy, ticks: energy.groups[energy.groupIndex] ?? 1 };
  }

  /** Cancel further accelerated travel in this frame after a KO or floor impact. */
  stopReferencePhysicsStep(): void {
    if (this.referenceLaunch !== null) this.referenceLaunch.interrupted = true;
  }

  beginReferenceTransport(multiplier: number): void {
    const energy = this.referenceLaunch;
    if (multiplier <= 1 || energy === null || this.launchVelocity === null ||
        this.getReferencePhysicsStep() === null) return;
    const launch = this.launchVelocity;
    const residual = { x: this.body.velocity.x - launch.x,
      y: this.body.velocity.y - launch.y - energy.gravityY };
    this.referenceTransport = { token: energy, multiplier, residual };
    this.scene.matter.body.setVelocity(this.body, {
      x: residual.x + multiplier * launch.x,
      y: residual.y + multiplier * (launch.y + energy.gravityY),
    });
  }

  endReferenceTransport(): void {
    const transport = this.referenceTransport;
    if (transport === null) return;
    // Damage/capture/reset can replace the body's velocity during collision
    // callbacks. That new owner already supplies canonical velocity.
    if (transport.token === this.referenceLaunch) {
      const canonical = this.getVelocity();
      for (const pair of this.contactPairs.values()) {
        if (pair.isActive === false || pair.isSensor || pair.bodyA.isSensor ||
            pair.bodyB.isSensor || !pair.collision) continue;
        const direction = pair.bodyA === this.body ? 1 : -1;
        const nx = direction * pair.collision.normal.x;
        const ny = direction * pair.collision.normal.y;
        const solvedNormal = this.body.velocity.x * nx + this.body.velocity.y * ny;
        if (Math.abs(solvedNormal) <= 1e-6) {
          // A stopped normal must stay stopped even when launch and external
          // carry had different transport rates. Preserve tangential carry.
          const normal = canonical.x * nx + canonical.y * ny;
          canonical.x -= normal * nx;
          canonical.y -= normal * ny;
        }
      }
      this.scene.matter.body.setVelocity(this.body, canonical);
    }
    this.referenceTransport = null;
  }

  /** Collision-only work; timers and landing classification run once per frame. */
  applyPhysicsSubstepConstraints(): void {
    if (this.destroyed) return;
    if (this.revivalPlatform) {
      this.scene.matter.body.setPosition(this.body, { x: this.revivalPlatform.x, y: this.revivalPlatform.y });
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      return;
    }
    this.commitAerialReboundAfterPhysics();
    if ((this.hitlagRemaining > 0 || this.pikachuLedgeFlightHitlagRelease) && this.hitlagPosition !== null) {
      // A collision callback can arm hitlag before Matter solves the same
      // frame's gravity penetration. Keep the actually solved support height
      // rather than restoring that pre-solver position below the platform.
      // Air/captive/wall freezes retain their exact original anchor.
      if (this.id === 'pikachu') {
        let supportedY = this.body.position.y;
        for (const pair of this.contactPairs.values()) {
          if (!this.isSupportPair(pair) || !pair.collision || Math.abs(pair.collision.normal.x) > 1e-6) continue;
          const platform = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
          if (!platform.bounds) continue;
          const vertices = this.body.vertices;
          const bodyHalfHeight = (vertices?.length
            ? Math.max(...vertices.map(vertex => vertex.y)) : this.getBodyBottomY()) - this.body.position.y;
          const slop = Math.max(0, (this.body as unknown as { slop?: number }).slop ?? .05);
          supportedY = Math.min(supportedY, platform.bounds.min.y - bodyHalfHeight + slop);
        }
        if (this.isGrounded() && supportedY < this.hitlagPosition.y)
          this.hitlagPosition = { x: this.hitlagPosition.x, y: supportedY };
      }
      this.scene.matter.body.setPosition(this.body, this.hitlagPosition);
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      this.pikachuSpecialRuntime?.refreshContactAfterPhysics(true);
      this.syncDonkeyKongCatchCollisionPose();
      return;
    }
    this.finishLedgeAttackPhysics();
    this.finishPikachuLedgeAttachmentPhysics();
    this.syncDonkeyKongAttackCollisionPose();
    this.reconcileLaunchContacts();
    if(this.donkeykongFullHopStep!==null&&this.referenceLaunch===null&&
      this.donkeykongOpeningCarryY!==null&&this.body.velocity.y>=-1e-6){
      // A prescribed opening is an ordinary kinetic owner, not a root path
      // through solids. Retire it when Matter cancels upward ceiling travel.
      const stoppedAtCeiling=[...this.contactPairs.values()].some(pair=>{
        if(pair.isActive===false||pair.isSensor||pair.bodyA.isSensor||pair.bodyB.isSensor||!pair.collision)return false;
        const other=pair.bodyA===this.body?pair.bodyB:pair.bodyA;
        const outwardY=pair.collision.normal.y*(pair.bodyA===this.body?1:-1);
        return other.label===PLATFORM_LABELS.solid&&outwardY>.5;
      });
      if(stoppedAtCeiling)this.donkeykongFullHopStep=null;
    }
    if (this.referenceLaunch !== null && this.tumbling && this.isGrounded()) {
      this.stopReferencePhysicsStep();
    }
    if (this.tauntPresentation !== null && !this.isGrounded()) this.tauntPresentation = null;
    // Physics may enter fall or acquire support between input steps. Reset
    // only; substeps and queries never advance the ordinary body clock.
    this.syncObservedPresentation(false);
    this.syncDonkeyKongCatchCollisionPose();
    if (this.grabTarget !== null && this.getAuthoredThrowRootMotion() !== null && this.grabSpec && !this.bypassCaptureAttachmentLegacyPin()) {
      // Shared fixed-offset attachment is explicitly retained as a beta policy;
      // native throw target/bone attachment is not inferred from Trans samples.
      this.scene.matter.body.setPosition(this.grabTarget.body, {
        x: this.body.position.x + this.grabSpec.hitbox.offsetX * this.facing,
        y: this.grabTarget.clearedCaptiveY(this, this.body.position.y + this.grabSpec.hitbox.offsetY),
      });
      this.scene.matter.body.setVelocity(this.grabTarget.body, { x: 0, y: 0 });
    }
    this.pikachuSpecialRuntime?.refreshContactAfterPhysics();
  }

  /**
   * Complete the fixed-step body contract: freeze hitlag/SDI position,
   * reconcile collision-canceled launch momentum, then limit only Matter's
   * excess gravity. Call once immediately after `matter.world.step()`, before
   * post-step hazards apply their own forces.
   * `gravityDeltaY` is the downward velocity added by that integration alone;
   * callers without a physics step may omit it. External forces are excluded.
   */
  applyPostPhysicsVelocityConstraints(gravityDeltaY = 0): void {
    const preStepVy = this.prePhysicsVelocityY;
    this.prePhysicsVelocityY = null;
    if (this.destroyed) return;
    this.applyPhysicsSubstepConstraints();
    if (!this.finalSlowLocalStep) return;
    if (this.revivalPlatform) return;
    if ((this.hitlagRemaining > 0 || this.pikachuLedgeFlightHitlagRelease) && this.hitlagPosition !== null) return;
    // The opening sample has moved the body; leave it carrying ordinary jump
    // energy so whichever owner reads it next (next sample, special entry,
    // dodge, or ordinary gravity after a retirement this tick) never inherits
    // the calibrated sample. Launch owners and slower owner speeds are kept.
    const openingCarry=this.donkeykongOpeningCarryY;
    if(openingCarry!==null&&this.referenceLaunch===null&&this.launchVelocity===null&&this.pendingKnockback===null&&
      this.hitstunRemaining===0&&this.body.velocity.y<openingCarry)
      this.scene.matter.body.setVelocity(this.body,{x:this.body.velocity.x,y:openingCarry});
    // DK lands on his own gravity dose, so his resting position carries sub-1e-9
    // float residue that Matter reports as vertical speed; supported DK has none.
    if (this.donkeykongOrdinaryVertical !== null && this.referenceLaunch === null && this.launchVelocity === null
        && this.isGrounded() && Math.abs(this.body.velocity.y) < 1e-9) {
      this.scene.matter.body.setVelocity(this.body, { x: this.body.velocity.x, y: 0 });
    }
    if (this.activeAttack?.move.pikachuSpecial) {
      const normals = [...this.contactPairs.values()].filter(pair => pair.isActive !== false && !pair.isSensor
        && !pair.bodyA.isSensor && !pair.bodyB.isSensor && pair.collision)
        .map(pair => { const sign = pair.bodyA === this.body ? 1 : -1;
          return { x: pair.collision!.normal.x * sign, y: pair.collision!.normal.y * sign }; });
      this.pikachuSpecialRuntime?.observePhysics(normals);
      // Skull's attack status explicitly limits its gravity energy. Enforce
      // that authored limit after integration, without installing ordinary
      // FALL or landing rules for its AIR_STOP start/end phases.
      const specialVerticalLimit = this.pikachuSpecialRuntime?.authoredVerticalSpeedLimit();
      if (specialVerticalLimit != null && !this.isGrounded() && this.body.velocity.y > specialVerticalLimit) {
        this.scene.matter.body.setVelocity(this.body, { x: this.body.velocity.x, y: specialVerticalLimit });
        this.pikachuSpecialRuntime?.observePhysics();
      }
      // SpecialN's pinned status selects ordinary FALL in air. Its null
      // authored gravity must retain the ordinary post-integration fall cap;
      // otherwise every Matter dose becomes uncapped speed on the next input.
      // Quick's sourced aerial END likewise retains a gravity speed limit.
      // Other special phases own their authored velocity/acceleration here.
      if (this.activeAttack.move.pikachuSpecial.kind !== 'thunderJolt' &&
          this.pikachuSpecialRuntime?.fallSpeedLimit() == null) return;
    }
    if (this.referenceLaunch !== null) {
      if (this.isGrounded()) {
        this.referenceLaunch.gravityY = 0;
        if (!this.referenceStunnedStep) this.clearReferenceLaunch();
      }
    } else if (this.launchVelocity !== null) {
      // Attribution comes from the integrator, never from total body speed:
      // that also contains velocity carry and externally applied forces.
      const gravity = Number.isFinite(gravityDeltaY) ? Math.max(0, gravityDeltaY) : 0;
      this.hitstunGravityVelocityY = Math.min(this.hitstunGravityVelocityY + gravity,
        Math.max(0, this.body.velocity.y - this.launchVelocity.y));
      if (this.hitstunRemaining === 0) {
        this.pendingHitstunGravityCorrection = Math.min(
          Math.max(0, this.hitstunGravityVelocityY - this.tuning.maxFallSpeed),
          Math.max(0, this.body.velocity.y - this.tuning.maxFallSpeed),
        );
        this.launchVelocity = null;
        this.hitstunGravityVelocityY = 0;
      }
    }
    // Matter has already canceled impact velocity by the time contact is
    // observed. Count the free-fall steps from their pre-integration velocity,
    // including touchdown, and keep the result until next input arbitration.
    if (preStepVy !== null && this.ledgeAttackAttachment === null && this.hitstunRemaining === 0 && this.pendingKnockback === null) {
      this.terminalFallFrames = preStepVy >= this.tuning.maxFallSpeed - 1e-6
        ? this.terminalFallFrames + 1 : 0;
      if (this.isGrounded()) {
        if (!this.prevGrounded) {
          const heavy = this.terminalFallFrames >= (this.tuning.hardLandingSpeedFrames ?? 4);
          this.pendingOrdinaryLandingFrames = heavy
            ? this.tuning.hardLandingFrames ?? 0 : this.tuning.softLandingFrames ?? 0;
          this.pendingOrdinaryLandingKind = heavy ? 'hard' : 'soft';
        }
        this.terminalFallFrames = 0;
      }
    } else {
      this.terminalFallFrames = 0;
    }
    if (
      this.destroyed ||
      preStepVy === null ||
      this.hitlagRemaining > 0 ||
      this.hitstunRemaining > 0 ||
      this.pendingKnockback !== null ||
      this.referenceLaunch !== null ||
      this.isGrounded()
    ) {
      return;
    }
    const terminal = this.pikachuSpecialRuntime?.fallSpeedLimit() ?? (this.fastFallLatched
      ? this.tuning.fastFallSpeed
      : this.tuning.maxFallSpeed);
    // Preserve velocity that was already externally above terminal before the
    // physics step (wind, a downward special, scripted hazards). Only Matter's
    // newly-added excess is removed.
    const externalExcess = Math.max(0, preStepVy - terminal);
    const cap = terminal + externalExcess;
    if (this.body.velocity.y > cap) {
      this.scene.matter.body.setVelocity(this.body, {
        x: this.body.velocity.x,
        y: cap,
      });
      // The special's observable velocity follows the completed constrained
      // integration, rather than retaining the discarded Matter excess.
      if (this.activeAttack?.move.pikachuSpecial?.kind === 'thunderJolt' ||
          this.pikachuSpecialRuntime?.fallSpeedLimit() != null) {
        this.pikachuSpecialRuntime?.observePhysics();
      }
    }
  }

  private reconcileLaunchContacts(): void {
    if (this.launchVelocity === null) return;
    for (const pair of this.contactPairs.values()) {
      if (pair.isActive === false || pair.isSensor ||
          pair.bodyA.isSensor || pair.bodyB.isSensor || !pair.collision) continue;
      // Matter's normal points from B toward A. Orient it away from the
      // surface for this fighter; only inward launch momentum is blocked.
      const direction = pair.bodyA === this.body ? 1 : -1;
      const nx = pair.collision.normal.x * direction;
      const ny = pair.collision.normal.y * direction;
      // Impacts and tangential wall friction can cancel gravity together with
      // launch. Rebase only at a real contact; free-flight wind stays separate.
      const rebaseGravity = () => {
        if (this.referenceLaunch !== null) {
          this.referenceLaunch.gravityY = Math.min(this.referenceLaunch.gravityY,
            Math.max(0, this.body.velocity.y - (this.launchVelocity?.y ?? 0)));
        }
      };
      const launch: { readonly x: number; readonly y: number } = this.launchVelocity;
      const inward = launch.x * nx + launch.y * ny;
      if (inward >= 0) { rebaseGravity(); continue; }
      const actual = this.body.velocity.x * nx + this.body.velocity.y * ny;
      const remaining = clamp(actual, inward, 0);
      // Keep the solver's actual velocity authoritative. Remove only the
      // launch bookkeeping it canceled so subsequent decay cannot subtract
      // nonexistent momentum and accelerate the fighter away from contact.
      this.launchVelocity = {
        x: launch.x + (remaining - inward) * nx,
        y: launch.y + (remaining - inward) * ny,
      };
      rebaseGravity();
    }
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
  // Held item (Ultimate items framework)
  // -------------------------------------------------------------------------

  /** Equip the held item; its uses replace the presses {@link resolveItemInput} maps. */
  equipItem(item: HeldItemHandle): void {
    if (this.equippedItem === null) this.heldItemCarryAge = 0;
    this.donkeykongJabContinuation = null;
    this.equippedItem = item;
    if(item.definition.hammer){
      this.cancelAttack();this.clearTransientHitboxes();this.chargingSmash=null;this.chargingSpecial=null;
      this.itemShooting=null;this.itemAction=null;this.itemActionEvents=[];this.pikachuSpecialRuntime?.clear();
      this.shieldState={...this.shieldState,name:'idle',blockStunRemaining:0};this.shieldReleaseRemaining=0;
      this.dodgeState=resetDodgeState();this.airDodgeBurst=null;this.airDodgeGravityVelocityY=0;
      this.offensiveActionBuffer=null;this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;
    }
  }

  /** The fighter's own moves answer every press again. */
  unequipItem(): void {
    this.equippedItem = null;
    this.itemShooting = null;
  }

  isHammerLocked():boolean {
    const spec=this.equippedItem?.definition.hammer;
    return !!spec && (this.equippedItem?.getHammerState?.()?.elapsed??0)<spec.durationFrames;
  }
  getHammerPresentation(){
    const item=this.equippedItem,spec=item?.definition.hammer,state=item?.getHammerState?.();
    if(!spec || !state || !this.isHammerLocked() || this.hitstunRemaining>0 || this.grabbedBy)return null;
    return {...hammerMotion(spec,state,this.isGrounded(),this.prevMoveX),facing:this.facing};
  }
  getHammerDamageAreas(spec:HammerSpec){
    const socket=this.getHeldItemSocket();
    const z=selectHeldItemSocket(captureSimulationAnimation(this,0,false),'z');
    return hammerAreas(spec,{...socket,zAngle:z?.angle,zLength:z?.length});
  }
  getEquippedItem(): HeldItemHandle | null {
    return this.equippedItem;
  }

  /** Recovery acquisition is independent of Inventory so a carried weapon stays equipped. */
  beginItemRecovery(itemId:number,spec:RecoverySpec,frame:number,walking=false,entityGeneration:number|null=null):boolean {
    if(!validRecoverySpec(spec)||!Number.isSafeInteger(itemId)||itemId<0||!Number.isSafeInteger(frame)||frame<0||
      entityGeneration!==null&&(!Number.isSafeInteger(entityGeneration)||entityGeneration<0))return false;
    if(this.itemEating||!this.canUseItemsBeforeInput())return false;
    this.donkeykongJabContinuation=null;this.cancelAttack();this.itemShooting=null;this.clearItemAction();
    const actorGeneration=this.getPositionResetGeneration();
    if(spec.eat)this.itemEating={...beginEating(spec.amount,itemId,walking),entryFrame:frame,facing:this.facing,spec:{...spec},entityGeneration,actorGeneration};
    else this.recoveryEvents.push({itemId,kind:'consume',spec:{...spec},amount:spec.amount,entryFrame:frame,actorGeneration,entityGeneration});
    return true;
  }
  getEatingState(){return this.itemEating?{...this.itemEating,spec:{...this.itemEating.spec}}:null;}
  getHealingState(){return this.itemHealing?{...this.itemHealing}:null;}
  drainRecoveryEvents(){const e=this.recoveryEvents;this.recoveryEvents=[];return e;}
  /** Scene calls only after exact live recovery transaction validation. */
  applyValidatedItemRecovery(spec:RecoverySpec,_transaction?:Readonly<RecoveryTransactionEvent>):void {
    if(!validRecoverySpec(spec))throw new TypeError('Invalid validated item recovery spec');
    if(spec.mode==='instant')this.applySourceItemRecoveryHealing(spec.amount);
    else this.itemHealing=beginHealing(spec,this.itemHealing);
  }
  notifyItemRecoveryTransactionRejected(itemId:number,entryFrame:number,_transaction?:Readonly<RecoveryTransactionEvent>):void {
    if(this.itemEating?.itemId===itemId&&this.itemEating.entryFrame===entryFrame)this.itemEating=null;
  }
  discardItemRecoveryOnStock():void {this.itemEating=null;this.itemHealing=null;this.recoveryEvents=[];this.notifySourceLinkTemporaryFood(null);}
  protected sourceItemEatingConsumeAge():number{return 4;}
  getRecoveryPresentation(){
    const e=this.itemEating;
    return e?{sheet:e.walking?'item_light_walk_eat':'item_light_eat',age:e.age,facing:e.facing}:null;
  }
  private interruptEating(kind:'drop'|'discard'='drop'):void {
    const eating=this.itemEating;
    if(eating&&!eating.consumed)this.recoveryEvents.push({itemId:eating.itemId,kind,entryFrame:eating.entryFrame,
      entityGeneration:eating.entityGeneration,actorGeneration:eating.actorGeneration,spec:{...eating.spec},amount:0});
    this.itemEating=null;
  }
  private stepRecoveryInput(input:CharacterInput):CharacterInput {
    const before=this.itemEating;if(!before)return input;
    if(this.grabbedBy||this.hitstunRemaining>0||this.pendingKnockback){this.interruptEating();return input;}
    if(before.entryFrame!==this.simulationInputFrame){
      const result=stepEating(before,{frozen:false,flinched:false,consumeAge:this.sourceItemEatingConsumeAge()});
      this.itemEating=result.state?{...result.state,entryFrame:before.entryFrame,facing:before.facing,spec:before.spec,
        entityGeneration:before.entityGeneration,actorGeneration:before.actorGeneration}:null;
      if(result.event==='consume'){
        this.recoveryEvents.push({itemId:before.itemId,kind:'consume',amount:result.amount,spec:{...before.spec},
          entryFrame:before.entryFrame,entityGeneration:before.entityGeneration,actorGeneration:before.actorGeneration});
      }
    }
    if(!this.itemEating)return input;
    this.itemLockedInput=input;this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    // Walk-eat keeps native ordinary walking; never starts a run or an attack during the brief commitment.
    const stick=before.walking?Math.sign(input.moveX)*Math.min(Math.abs(input.moveX),this.resolvedLocomotionTuning.dashStickThreshold-.001):0;
    return {...input,moveX:stick,moveY:0,jump:false,attack:false,attackHeavy:false,special:false,shield:false,dodge:false,
      grab:false,appeal:false,dropThrough:false};
  }

  /** Item shots queued since the last drain, oldest first (MatchScene spawns them as projectiles). */
  consumeItemShots(): { shot: ItemShot; x: number; y: number; facing: 1 | -1 }[] {
    const shots = this.pendingItemShots;
    this.pendingItemShots = [];
    if (shots.length === 0) return shots;
    // A shot leaves the drawn item: the muzzle of the drawing shown now (heldItemMuzzle, the renderer's own rule).
    // Phase transitions and leg clocks commit after the shot callbacks queue, so the drain reads the displayed pose.
    // Without a socket axis the item's authored body offset (queueItemShot) stays; the fire facing is kept.
    const visual = this.equippedItem?.definition.visual;
    const muzzle = visual ? heldItemMuzzle(this.getHeldItemSocket(), visual) : null;
    return muzzle ? shots.map(event => ({ ...event, x: muzzle.x, y: muzzle.y })) : shots;
  }

  /** The running shooting-item session (phase, clocks, charge, shots), or null. */
  getItemShootingState(): ShootingState | null {
    return this.itemShooting?.state ?? null;
  }

  protected queueItemShot(shot: ItemShot, facing: 1 | -1, _callbackState?:ShootingState): void {
    const p = this.getPosition();
    this.pendingItemShots.push({ shot, x: p.x + facing * shot.spawnOffsetX,
      y: p.y + shot.spawnOffsetY, facing });
  }

  /** One step of the shooting session: its clock, its shots (paid from the held item's ammo), its end. */
  private advanceItemShooting(held: boolean): void {
    const session = this.itemShooting, item = this.equippedItem;
    if (!session || !item) { this.itemShooting = null; return; }
    const step = stepShooting(session.spec, session.state, held, cost => item.spendShot(cost), item.getAmmo());
    for (const shot of step.shots) this.queueItemShot(shot, session.state.facing,step.state??undefined);
    if (step.state) session.state = step.state;
    else this.itemShooting = null;
  }

  /**
   * Grounded target speed while shooting: the native shoot status has only walk legs (item_shoot_legs_walk_f/b), so
   * the legs walk (never dash or run) at the walk speed for the stick, keep the fire facing, and walk backward at
   * fighter_param shoot_back_speed_mul 0.87 (native-derived; ultimate-13.0.1 item sheet).
   */
  private shootingWalkTargetVx(moveX: number, facing: 1 | -1): number | null {
    const t = this.resolvedLocomotionTuning, mag = Math.abs(moveX);
    if (mag < t.walkStickThreshold) return null;
    const span = Math.max(1e-6, t.dashStickThreshold - t.walkStickThreshold);
    const speed = t.walkMaxSpeed * Math.min(1, (mag - t.walkStickThreshold) / span) * (Math.sign(moveX) === facing ? 1 : SHOOT_BACK_SPEED_MUL);
    return Math.sign(moveX) * speed;
  }

  /**
   * The shooting body: the phase's native motion full-body when standing or airborne; while the legs walk, squat
   * for a jump or land, the `_upper` motion over `item_shoot_legs_*` (Ultimate composes the upper-body layer over the
   * shooting legs). Sheets are the drawn clips (itemMotionClip resolves motions that share one file).
   */
  getItemShootingPresentation(): { sheet: string; age: number; facing: 1 | -1; upper?: { sheet: string; age: number } } | null {
    const session = this.itemShooting;
    if (!session) return null;
    const facing = session.state.facing, motion = shootingMotion(session.spec, session.state);
    if (!this.isGrounded()) return { sheet: itemMotionClip(motion.clips.air), age: motion.age, facing };
    const legs = this.shootingLegs(facing);
    const upper = { sheet: itemMotionClip(motion.clips.upper), age: motion.age };
    return legs ? { ...legs, facing, upper } : { sheet: itemMotionClip(motion.clips.ground), age: motion.age, facing };
  }

  /** Actual original shooting-spec motion selection, before shared-file draw
   * aliases. This reads the same live session/leg chooser as the renderer. */
  getItemShootingCanonicalPresentation(){
    const session=this.itemShooting;if(!session)return null;
    const selected=shootingMotion(session.spec,session.state),facing=session.state.facing;
    if(!this.isGrounded())return{kind:session.spec.kind,phase:session.state.phase,roles:[{
      componentRole:'body' as const,canonicalMotion:selected.clips.air,rawAge:selected.age,facing}]};
    const legs=this.shootingLegs(facing);
    return{kind:session.spec.kind,phase:session.state.phase,roles:legs?[
      {componentRole:'lower' as const,canonicalMotion:legs.sheet,rawAge:legs.age,facing},
      {componentRole:'upper' as const,canonicalMotion:selected.clips.upper,rawAge:selected.age,facing}]:[
      {componentRole:'body' as const,canonicalMotion:selected.clips.ground,rawAge:selected.age,facing}]};
  }

  private shootingLegs(facing: 1 | -1): { sheet: string; age: number } | null {
    if (this.jumpsquatRemaining > 0) return { sheet: 'item_shoot_legs_jump_squat', age: JUMPSQUAT_FRAMES - this.jumpsquatRemaining };
    if (this.shootLandingAge !== null) return { sheet: 'item_shoot_legs_landing', age: this.shootLandingAge };
    const vx = this.body.velocity.x;
    if (Math.abs(vx) < SHOOT_LEGS_WALK_MIN_SPEED) return null;
    return { sheet: Math.sign(vx) === facing ? 'item_shoot_legs_walk_f' : 'item_shoot_legs_walk_b', age: this.shootLegsWalkAge };
  }

  /** Shooting presentation clocks, once per step after movement: the walk loop age and the landing legs. */
  private advanceShootingLegs(): void {
    if (!this.itemShooting) { this.shootLegsWalkAge = 0; this.shootLandingAge = null; return; }
    const grounded = this.isGrounded();
    if (grounded && !this.prevGrounded) this.shootLandingAge = 0;
    else if (this.shootLandingAge !== null) this.shootLandingAge = this.shootLandingAge + 1 < SHOOT_LEGS_LANDING_FRAMES && grounded
      ? this.shootLandingAge + 1 : null;
    this.shootLegsWalkAge = grounded && Math.abs(this.body.velocity.x) >= SHOOT_LEGS_WALK_MIN_SPEED ? this.shootLegsWalkAge + 1 : 0;
  }

  /**
   * A projectile was just reflected by this fighter's active reflector. A
   * move whose reflect window swings on reflect (the Home-Run Bat forward
   * smash, SmashWiki Ultimate) skips the rest of its wind-up: the next
   * step is its first active frame.
   */
  noteProjectileReflected(): void {
    const a = this.activeAttack;
    if (!a?.move.reflectWindow?.swingOnReflect) return;
    a.framesElapsed = Math.max(a.framesElapsed, a.move.startupFrames - 1);
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
  /** Register opt-in taunts; absent data preserves every legacy fighter. */
  setTauntSpec(set: TauntSet | null): void {
    if (set !== null) validateTauntSet(set);
    this.tauntSpec = set && Object.freeze(Object.fromEntries(
      (['up', 'side', 'down'] as const).map(kind => [kind, Object.freeze({...set[kind]})]),
    )) as TauntSet | null;
    this.tauntPresentation = null;
  }
  getTauntPresentationState(): TauntPresentationState | null {
    const state = this.tauntPresentation;
    return state && this.tauntSpec ? { ...state,
      cancellable: state.framesElapsed >= this.tauntSpec[state.kind].cancelAfterFrames } : null;
  }
  protected notifySourceTauntEquipmentOwnerChanged():void{}
  getSourceTauntPresentationOwner(){const state=this.tauntPresentation;if(!state)return null;
    const motion=`appeal_${state.kind==='up'?'hi':state.kind==='down'?'lw':'s'}_${state.facing===1?'r':'l'}` as import('./linkTauntEquipment').LinkTauntEquipmentMotion;
    return {motion,rawAge:state.framesElapsed,facing:state.facing,kind:state.kind,entryFrame:state.entryFrame,
      generation:this.positionResetGeneration,cancelAfterFrames:this.tauntSpec![state.kind].cancelAfterFrames,presentationFrames:this.tauntSpec![state.kind].presentationFrames,
      ownerKey:JSON.stringify([this.slotIndex,this.positionResetGeneration,state.entryFrame,state.kind,state.facing])};
  }
  private tickTaunt(input: CharacterInput): void {
    if (!this.tauntSpec) return;
    const active = this.tauntPresentation;
    if (active) {
      active.framesElapsed++;
      const spec = this.tauntSpec[active.kind];
      const control = Math.abs(input.moveX) > .3 || Math.abs(input.moveY ?? 0) > .3 ||
        input.jump || input.attack || input.attackHeavy || input.special || input.shield || input.grab || input.dodge;
      if (!this.isGrounded() || active.framesElapsed >= spec.presentationFrames ||
          (active.framesElapsed >= spec.cancelAfterFrames && control)) this.tauntPresentation = null;
      return;
    }
    if (input.appeal !== true || this.prevAppealHeld || !this.isGrounded() ||
        !this.canPresentUncommittedBody() || !this.canStartCommittedAction()) return;
    // Authored keyboard/pad chord: native D-pad selector and status rate remain separate.
    const kind: TauntKind = (input.moveY ?? 0) < -.3 ? 'up' : (input.moveY ?? 0) > .3 ? 'down' : 'side';
    this.tauntPresentation = {kind, framesElapsed: 0, facing: this.facing,entryFrame:this.simulationInputFrame};
    this.notifySourceTauntEquipmentOwnerChanged();
  }

  setGrabSpec(spec: GrabSpec | null): void {
    if (spec !== null) {
      validateGrabSpec(spec);
    }
    this.clearGrabSourcePresentation();
    this.grabSpec = spec;
    this.captureAttachmentDiagnostic=null;
  }

  /** Published budget with explicit logical-input sampling adaptation. */
  getCaptureBudgetState() {
    const budget = this.ultimateCaptureBudget;
    return budget && this.grabState.name === 'holding' ? {entryPercent: budget.entryPercent,
      initialFrames: budget.initialFrames, totalFrames: reducedCaptureFrames(budget.initialFrames, budget.mash),
      framesElapsed: this.grabState.active?.framesElapsed ?? 0, reduction: budget.mash.reduction,
      lastAcceptedMash: budget.mash.lastAccepted ? {...budget.mash.lastAccepted} : null} : null;
  }
  getPostReleaseGrabImmunityRemaining(): number { return this.postReleaseGrabImmunity.remaining; }
  getGrabReleasePresentationState() {
    const state = this.grabReleasePresentation;
    return state ? {role: state.role, framesElapsed: state.framesElapsed,
      totalFrames: ULTIMATE_GRAB_RELEASE_FRAMES, facing: state.facing, groundedAtEntry: state.groundedAtEntry} : null;
  }
  private acceptUltimateCaptureMash(target: Character, input: CharacterInput, frozen = false): void {
    if (this.grabTarget !== target || this.grabState.name !== 'holding') return;
    const budget=this.grabState.active?.cargo?this.ultimateCargoBudget:this.ultimateCaptureBudget;
    if(!budget)return;
    budget.mash = frozen ? {...budget.mash, previousHeld: initialCaptureMash(input).previousHeld}
      : tickCaptureMash(budget.mash, input, target.capturePresentation?.state.framesElapsed ?? 0);
  }
  private installGrabRelease(role: 'captor'|'target', bornFrame: number): void {
    this.sourceCutAdmissionFrame=bornFrame;
    this.grabReleasePresentation = {role, framesElapsed: 0, lastFrame: bornFrame,
      facing: this.facing, groundedAtEntry: this.isGrounded()};
    this.ordinaryPresentation = null;
    this.tauntPresentation = null;
    this.notifySourceCaptureEquipmentOwnerChanged();
  }
  private tickGrabReleaseInput(input: CharacterInput): boolean {
    const state = this.grabReleasePresentation;
    if (!state) return false;
    if (state.lastFrame !== this.simulationInputFrame) {
      state.framesElapsed += 1; state.lastFrame = this.simulationInputFrame;
    }
    if (state.framesElapsed >= ULTIMATE_GRAB_RELEASE_FRAMES) { this.grabReleasePresentation = null; return false; }
    this.scene.matter.body.setVelocity(this.body, {x: 0, y: this.body.velocity.y});
    this.prevJumpHeld = input.jump; this.prevAttackHeld = input.attack === true;
    this.prevHeavyHeld = input.attackHeavy === true; this.prevSpecialHeld = input.special === true;
    this.prevShieldHeld = input.shield === true; this.prevDodgeHeld = input.dodge === true;
    this.prevGrabHeld = input.grab === true;
    return true;
  }

  /** Read the currently-registered grab spec (or `null`). */
  getGrabSpec(): GrabSpec | null {
    return this.grabSpec;
  }
  /** The selected whiff variant and timing, including dash/pivot overrides. */
  getGrabPresentationState() {
    if (!this.grabSpec || this.grabState.name === 'idle') return null;
    const spec = this.grabVariantSpec ?? this.grabSpec;
    const phaseFramesElapsed = this.grabState.active?.framesElapsed ?? 0;
    const framesElapsed = phaseFramesElapsed + (this.grabState.name === 'whiffActive' ? spec.startupFrames
      : this.grabState.name === 'whiffRecovery' ? spec.startupFrames + spec.activeFrames : 0);
    return { variant: this.grabPresentationVariant, spec, phase: this.grabState.name,
      phaseFramesElapsed, framesElapsed, facing: this.facing };
  }
  /** Neutral actor-owned clocks; no donor fighter sheet/name is selected. */
  protected notifySourceCaptureEquipmentOwnerChanged():void{}
  /** Actual producer clocks/participants. SCRIPT raw+1 is a selected engine
   * ordinal adapter, independently from body visual contact clocks. */
  getSourceCaptureEquipmentOwner(){
    const generation=this.positionResetGeneration,groupKey=JSON.stringify([this.slotIndex,generation,this.sourceGrabAdmissionFrame]);
    const release=this.getGrabReleasePresentationState(),throwing=this.getThrowPresentationState(),pummel=this.getSourceGrabPresentationState().pummel,
      grab=this.getGrabPresentationState(),target=this.grabTarget;
    const captureKey=target&&target.grabbedBy===this?JSON.stringify([target.slotIndex,target.positionResetGeneration,target.captureSequence]):null;
    const make=(motion:import('./linkCaptureActionEquipment').LinkCaptureActionEquipmentMotion,rawAge:number,facing:1|-1,key:string,entryFrame:number,acceptedCaptureKey=captureKey)=>
      ({motion,rawAge,facing,ownerKey:key,groupKey,captureKey:acceptedCaptureKey,entryFrame,generation});
    if(release?.role==='captor')return make('catch_cut',release.framesElapsed,release.facing,`cut:${groupKey}:${this.sourceCutAdmissionFrame}`,this.sourceCutAdmissionFrame);
    if(throwing&&!throwing.cargo&&throwing.entryFrame!==null){const suffix={forward:'f',back:'b',up:'hi',down:'lw'} as const;
      return make(`throw_${suffix[throwing.direction]}`,throwing.framesElapsed,throwing.facing,`throw:${throwing.damageTransaction?.transactionKey??groupKey+':'+throwing.entryFrame}`,throwing.entryFrame,throwing.damageTransaction?JSON.stringify(['accepted-throw-capture',throwing.damageTransaction.targetGeneration,throwing.damageTransaction.captureId,throwing.damageTransaction.transactionKey]):captureKey);}
    if(pummel&&pummel.damageTransaction)return make('catch_attack',pummel.framesElapsed,pummel.facing,`pummel:${pummel.damageTransaction.transactionKey}`,pummel.damageTransaction.entryFrame);
    if(!grab||this.grabState.active?.cargo)return null;
    if(grab.phase==='holding'&&captureKey){const held=this.sourceGrabHeld;
      if(held)return make('catch_wait',held.framesElapsed,held.facing,`wait:${groupKey}:${captureKey}:after-pummel:${this.sourceHeldAdmissionFrame}`,this.sourceHeldAdmissionFrame);
      const pulled=grab.framesElapsed<21;
      return make(pulled?'catch_pull':'catch_wait',pulled?grab.framesElapsed:grab.framesElapsed-21,grab.facing,`${pulled?'pull':'wait'}:${groupKey}:${captureKey}`,this.sourceCaptureAdmissionFrame);}
    if(['whiffStartup','whiffActive','whiffRecovery'].includes(grab.phase))return make(grab.variant==='dash'?'catch_dash':grab.variant==='pivot'?'catch_turn':'catch',grab.framesElapsed,grab.facing,`grab:${groupKey}`,this.sourceGrabAdmissionFrame);
    return null;
  }
  getSourceGrabPresentationState(){
    const p=this.sourceGrabPummel,h=this.sourceGrabHeld;
    return {pummel:p&&this.sourceGrabLinkValid(p.target,p.captureId,p.targetGeneration)?
      {framesElapsed:p.framesElapsed,facing:p.facing,damageTransaction:this.pummelDamageTransaction}:null,
      heldAfterPummel:h&&this.sourceGrabLinkValid(h.target,h.captureId,h.targetGeneration)?{facing:h.facing}:null};
  }
  getSourceRecipientPresentationState(){
    const capture=this.getCapturePresentationState(),captor=this.grabbedBy;
    if(!capture||!captor)return null;
    const throwing=captor.getThrowPresentationState();
    const captureIdentity={targetPlayerIndex:this.slotIndex,targetGeneration:this.positionResetGeneration,captorPlayerIndex:captor.slotIndex,
      captorGeneration:captor.positionResetGeneration,captureId:capture.captureId};
    return{captureIdentity,captureId:capture.captureId,generation:this.positionResetGeneration,facing:capture.facing,
      phase:throwing?'throw' as const:capture.event.kind==='damage'?'damage' as const:
        capture.event.kind==='entry'?'entry' as const:'hold' as const,
      framesElapsed:throwing?.framesElapsed??(capture.event.kind==='damage'?capture.event.framesElapsed:capture.framesElapsed),
      throwDirection:throwing?.direction??null,cargo:captor.grabState.active?.cargo===true,
      cargoStartupRemaining:captor.grabState.active?.cargoStartupRemaining??0,
      cargoLiftPending:captor.sourceCargoEntry!==null,
      selectedHeight:this.sourceCaptureMotionFamily?.captureId===capture.captureId&&
        this.sourceCaptureMotionFamily.generation===this.positionResetGeneration&&
        this.sourceCaptureMotionFamily.captorGeneration===captor.positionResetGeneration?
        this.sourceCaptureMotionFamily.authoredCaptureMotionFamily:this.id==='link'?'high' as const:null,
      captureMotionFamilyProvenance:this.sourceCaptureMotionFamily?.captureMotionFamilyProvenance??null,
      // Native motion_list captures Link HIGH; common victim dispatch remains
      // separately sourced. This named field is not a guessed low/high selector.
      templateNativeMotionHeight:this.id==='link'?'high' as const:null};
  }
  getSourceGroundRecoveryPresentationState(){return this.getReactionPresentationState();}

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
  /** Authored2D held-context floor clearance. Move the physical root with
   * its paired drawing/receiving; native victim-bone attachment is separate. */
  private clearedCaptiveY(grabber: Character, requestedY: number): number {
    if (this.id !== 'pikachu' || !['holding', 'throwing'].includes(grabber.grabState.name) ||
        grabber.grabState.active?.cargo || !grabber.isGrounded()) return requestedY;
    // Half a pixel preserves clearance through the next normal gravity dose.
    return Math.min(requestedY, grabber.getBodyBottomY() - getPikachuCapturedBodyBottomEnvelope(
      this.capturePresentation?.state.event.kind === 'damage' && this.capturePresentation.state.event.framesElapsed < 20) - .5);
  }

  applyGrabbed(grabber: Character): void {
    if (this.postReleaseGrabImmunity.remaining > 0) return;
    this.grabReleasePresentation = null;
    this.ultimateCaptureBudget = null;
    this.clearLedgeAttackAttachment();
    this.clearPikachuLedgeAttachment();
    this.tauntPresentation = null;
    if (this.destroyed) return;
    if (this.grabbedBy !== null) return;
    this.clearGrabSourcePresentation();
    this.donkeykongFullHopStep=null;this.donkeykongOrdinaryVerticalTick=false;
    if (this.grabTarget !== null) {
      // Being caught interrupts our own captive link as well as our motion.
      this.grabTarget.releaseFromGrab('break');
      this.grabTarget = null;
      this.grabState = resetGrabState();
    }
    this.buriedState=null;
    this.ultimateCargoBudget=null;
    this.grabbedBy = grabber;
    this.throwReleaseInvincible = false;
    this.captureAttachmentEntry={captor:grabber,captureId:this.captureSequence+1,captorReset:grabber.positionResetGeneration,recipientReset:this.positionResetGeneration};
    this.capturePresentation = { captor: grabber, state: {
      captureId: ++this.captureSequence, active: true, framesElapsed: 0,
      facing: this.facing, groundedAtEntry: this.isGrounded(),
      captor: { characterId: grabber.id, bodyId: grabber.body.id,
        entryFacing: grabber.facing, facing: grabber.facing },
      event: { sequence: ++this.captureEventSequence, kind: 'entry', framesElapsed: 0 },
    } };
    const motionFamily=parseAuthoredCaptureMotionFamily(grabber.grabVariantSpec??grabber.grabSpec??{},'accepted grab');
    this.sourceCaptureMotionFamily=motionFamily?{...motionFamily,captureId:this.captureSequence,
      generation:this.positionResetGeneration,captorGeneration:grabber.positionResetGeneration}:null;
    this.shieldPresentation = null;
    this.attackClankRemaining = 0;
    this.attackClankLockedStep = false;
    this.jumpPresentation = null;
    this.pikachuAuxiliaryAir = null;
    this.pikachuLedgeJump=null;this.pikachuGroundRecovery=null;this.groundRecovery=null;this.clearSurfaceTech();
    this.pendingFootstoolJump=false;this.pendingFootstoolPhantom=false;this.sourceLinkFootstoolPendingContact=null;this.donkeykongFootstoolPerformer=null;this.sourceLinkFootstool=null;this.footstoolRecipient=null;this.footstoolMini=null;this.pikachuFootstoolVisual=null;
    this.pikachuRespawnPresentation=null;this.clearItemAction();
    this.donkeykongTurnBrake=null;this.restoreSourcedGroundFriction();
    this.throwPresentation = null;
    this.throwRootMotionApplied = false;
    this.landingPresentation = null;
    // Capture cancels a pending takeoff; releasing a hold must not resume the
    // jumpsquat or action intent that existed before the fighter was caught.
    this.jumpsquatRemaining = 0;
    this.jumpsquatShortHop = false;
    this.jumpsquatFacing = null;
    this.tapJumpBufferFrames = 0;
    this.shortHopRising = false;
    this.airJumpRising = false;
    this.jumpInputBufferFrames = 0;
    this.offensiveActionBuffer = null;
    if (this.chargingSpecial !== null) this.storedSpecialCharge = null;
    this.chargingSpecial = null;
    this.chargingSmash = null;
    // Capture interrupts a raised shield, including shieldstun. Keep its
    // health and regeneration history; resetting the shield would refill it.
    // Captive input skips shield ticking, so leaving it raised would let it
    // absorb the grabber's pummels and the eventual throw.
    if (isShieldRaised(this.shieldState)) {
      this.shieldState = Object.freeze({
        ...this.shieldState,
        name: 'idle',
        blockStunRemaining: 0,
      });
    }
    this.shieldActiveFrames = 0;
    // Cancel any in-flight attack — the target was caught mid-swing.
    this.cancelAttack();
    this.cooldownRemaining = 0;
    this.helpless = false;
    // Clear hitstun / hitlag — the target is now in a different
    // captive state.
    this.hitstunRemaining = 0;
    this.hitlagRemaining = 0;
    this.hitlagPosition = null;
    this.pendingKnockback = null;
    this.sdiState = createReferenceSdiState();
    this.sdiMultiplier = 1;
    this.attackerHitlagVelocity = null;
    this.pikachuLedgeFlightHitlagRelease=false;
    this.prePhysicsVelocityY = null;
    this.launchVelocity = null;
    this.referenceLaunch = null;
    this.hitstunGravityVelocityY = 0;
    this.pendingHitstunGravityCorrection = 0;
    if (this.id === 'pikachu' && grabber.grabState.name === 'holding') {
      this.scene.matter.body.setPosition(this.body, {
        x: this.body.position.x, y: this.clearedCaptiveY(grabber, this.body.position.y),
      });
    }
    // Pin velocity at zero so the body doesn't drift between frames
    // while the grabber's tick re-pins position each step.
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
  }

  /**
   * Release this character from a grab. Called when the grabber's
   * state machine transitions out of `'holding'` (throw release,
   * mash-out, force break, KO).
   */
  releaseFromGrab(reason: NonNullable<CapturePresentationState['event']['releaseReason']> = 'external'): void {
    if (this.grabbedBy === null) return;
    this.sourceCaptureMotionFamily=null;
    if (this.capturePresentation) {
      const state = this.capturePresentation.state;
      state.active = false;
      state.captor.facing = this.grabbedBy.facing;
      state.event = { sequence: ++this.captureEventSequence, kind: 'release',
        framesElapsed: 0, releaseReason: reason };
    }
    const captor = this.grabbedBy;
    captor.clearGrabSourcePresentation();
    if (captor.grabSpec?.ultimateCapture && reason !== 'reset') {
      this.postReleaseGrabImmunity = {remaining: ULTIMATE_POST_RELEASE_GRAB_IMMUNITY_FRAMES, lastFrame: captor.simulationInputFrame};
      if (reason === 'hold-expired') {
        this.installGrabRelease('target', captor.simulationInputFrame);
        captor.installGrabRelease('captor', captor.simulationInputFrame);
      }
    }
    this.grabbedBy = null;
    this.captureAttachmentEntry=null;
    if(captor.captureAttachmentBypass?.link.target===this)captor.captureAttachmentBypass=null;
  }

  private noteCaptureDamage(damage: number, damageSource: NonNullable<CapturePresentationState['event']['damageSource']>): void {
    if (damage > 0 && this.grabbedBy !== null && this.capturePresentation) {
      this.capturePresentation.state.event = { sequence: ++this.captureEventSequence, kind: 'damage',
        framesElapsed: 0, damage, damageSource };
      if (this.id === 'pikachu') {
        const y = this.clearedCaptiveY(this.grabbedBy, this.body.position.y);
        this.scene.matter.body.setPosition(this.body, { x: this.body.position.x, y });
        if (this.hitlagPosition) this.hitlagPosition = { x: this.hitlagPosition.x, y };
      }
    }
  }

  private tickCapturePresentation(): void {
    const state = this.capturePresentation?.state;
    if (!state) return;
    if (state.active) state.framesElapsed += 1;
    state.event.framesElapsed += 1;
  }

  /** Release is historical inactive context, never a new recovery commitment. */
  getCapturePresentationState(): CapturePresentationState | null {
    if (this.destroyed || !this.capturePresentation) return null;
    const { state, captor } = this.capturePresentation;
    return { ...state, captor: { ...state.captor, facing: state.active ? captor.facing : state.captor.facing },
      event: { ...state.event } };
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
  private getCurrentThrowSet(state:GrabState=this.grabState){
    const spec=this.grabSpec!;return state.active?.cargo?state.active.throwAirborne?spec.cargo?.airThrows??spec.cargo?.throws??spec.throws:spec.cargo?.throws??spec.throws:spec.throws;
  }

  private readThrowDirectionInput(input: CharacterInput): ThrowDirection | null {
    if (this.grabState.name !== 'holding') return null;
    if(this.grabState.active?.cargo)return selectCargoThrow({attackPressed:input.attack===true&&!this.prevAttackHeld,
      grabPressed:input.grab===true&&!this.prevGrabHeld,moveX:input.moveX,moveY:input.moveY},this.facing);
    if (this.grabState.active?.cargo && !(input.attack && !this.prevAttackHeld) && !(input.grab && !this.prevGrabHeld)) return null;
    const moveY = input.moveY ?? 0;
    if (moveY < -0.3) return 'up';
    if (moveY > 0.3) return 'down';
    const moveX = input.moveX;
    if (moveX > 0.3) return this.facing === 1 ? 'forward' : 'back';
    if (moveX < -0.3) return this.facing === 1 ? 'back' : 'forward';
    return this.grabState.active?.cargo ? 'forward' : null;
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
    if(before.name!=='whiffStartup'&&after.name==='whiffStartup')this.sourceGrabAdmissionFrame=this.simulationInputFrame;
    if(after.active?.cargo&&!before.active?.cargo&&this.grabTarget){
      this.sourceGrabPummel=null;this.sourceGrabHeld=null;
      if(this.grabSpec.cargo?.entryMotionFrames!==undefined&&this.isGrounded())
        this.sourceCargoEntry={...beginGrabSourcePresentation(this.simulationInputFrame,this.facing),target:this.grabTarget,captureId:this.grabTarget.captureSequence,targetGeneration:this.grabTarget.positionResetGeneration,cargo:true};
      const spent=(before.active?.framesElapsed??0)+(this.ultimateCaptureBudget?.mash.reduction??0);
      this.ultimateCargoBudget={initialFrames:ultimateCargoFrames(this.grabTarget.getDamagePercent(),spent),mash:initialCaptureMash(this.grabTarget.lastCaptureInput)};
      this.ultimateCaptureBudget=null;
      this.setInvincibility(this.grabSpec.throws.forward.invincibilityFrames??0,'invincible');
    }
    if(!after.active?.cargo)this.ultimateCargoBudget=null;
    if(after.name!=='holding'){this.sourceGrabPummel=null;this.sourceGrabHeld=null;this.sourceCargoEntry=null;this.pummelDamageTransaction=null;}
    const enteredWhiffActive =
      before.name !== 'whiffActive' && after.name === 'whiffActive';
    const leftWhiffActive =
      before.name === 'whiffActive' && after.name !== 'whiffActive';
    if (enteredWhiffActive) {
      // A DASH GRAB reaches further: shift the range hitbox forward by
      // `rangeBonusX` (a shallow spec clone — spawnGrabHitbox still mirrors
      // offsetX by facing, so the bonus extends the reach in front).
      const spawnSpec = this.grabVariantSpec ?? this.grabSpec;
      this.grabHitboxBody = spawnGrabHitbox(
        this.scene,
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
      this.donkeykongCatchPoseConsumer.forget(this.grabHitboxBody);
      this.donkeykongCatchCollisionDiagnostic=null;
      despawnHitbox(this.scene, this.grabHitboxBody);
      this.grabHitboxBody = null;
    }
    if (after.name === 'throwing' && this.grabTarget !== null && after.active?.throwDirection) {
      if (before.name !== 'throwing') this.throwPresentation = { damageTransaction:this.beginCapturedDamageTransaction(
        `${this.grabSpec.id}.throw.${after.active.cargo?'cargo.':''}${after.active.throwDirection}`,`throw-${after.active.throwDirection}`),direction: after.active.throwDirection,
        facing: this.facing, entryFrame:this.simulationInputFrame,releaseElapsed: null, recoveryAtRelease: 0,cargo:after.active.cargo,airborne:after.active.throwAirborne };
      const spec = getThrowByDirection(this.getCurrentThrowSet(after),after.active.throwDirection);
      const hit = spec.heldTargetHits?.find(event => event.frame === after.active!.framesElapsed);
      const transaction=this.throwPresentation?.damageTransaction??null;
      if (hit&&this.capturedDamageTransactionValid(transaction,this.grabTarget)) {
        const beforeDamage=this.grabTarget.getDamagePercent();
        const freeze = computeHitlag({ damage: hit.hitlagDamage ?? hit.damage*transaction.staleMultiplier,
          targetPercent: this.grabTarget.getDamagePercent(), multiplier: hit.hitlagMultiplier, electricCollision: hit.electricCollision });
        this.grabTarget.addDamage(hit.damage*transaction.staleMultiplier, 'throw-pre-hit',this.slotIndex);
        this.throwPresentation!.damageTransaction=this.commitCapturedDamageTransaction(transaction,this.grabTarget.getDamagePercent()-beforeDamage);
        this.grabTarget.armAttackerHitlag(freeze);
        this.armAttackerHitlag(freeze);
      }
    }
    // throwing → cooldown transition fires the throw release.
    const throwReleased =
      before.name === 'throwing' && after.name === 'cooldown';
    if (throwReleased && this.grabTarget !== null) {
      const dir = before.active?.throwDirection;
      if (dir !== null && dir !== undefined) {
        this.throwPresentation = {damageTransaction:this.throwPresentation?.damageTransaction??null,direction: dir, facing: this.throwPresentation?.facing ?? this.facing,
          entryFrame:this.throwPresentation?.entryFrame??null,releaseElapsed: (before.active?.framesElapsed ?? 0) + 1, recoveryAtRelease: after.cooldownRemaining,cargo:before.active?.cargo,airborne:before.active?.throwAirborne };
        const throwSpec = getThrowByDirection(this.getCurrentThrowSet(before),dir);
        // Source protection includes the release integration, even though the
        // grab machine has already advanced into ordinary recovery.
        this.throwReleaseInvincible = (before.active?.framesElapsed ?? 0) + 1 < (throwSpec.invincibilityFrames ?? 0);
        // Apply damage + knockback to the target via the standard
        // hit pipeline so existing combat math (percent scaling,
        // hitlag, etc.) all fire identically to a regular hit.
        const target=this.grabTarget,transaction=this.throwPresentation.damageTransaction;
        const validTransaction=this.capturedDamageTransactionValid(transaction,target)?transaction:null;
        const capture=target.getSourceRecipientPresentationState()?.captureIdentity,throwEntryFrame=this.throwPresentation.entryFrame;
        const throwRelease:HitInfo['combatThrowRelease']=capture&&validTransaction&&typeof throwEntryFrame==='number'?Object.freeze({kind:'accepted-capture-throw-release',grabId:this.grabSpec.id,
          producerPlayerIndex:this.slotIndex,producerGeneration:this.positionResetGeneration,
          targetPlayerIndex:this.grabTarget.slotIndex,targetGeneration:this.grabTarget.positionResetGeneration,
          capture:Object.freeze({captureId:capture.captureId,targetPlayerIndex:capture.targetPlayerIndex,targetGeneration:capture.targetGeneration,
            captorPlayerIndex:capture.captorPlayerIndex,captorGeneration:capture.captorGeneration}),
          direction:dir,cargo:before.active?.cargo===true,airborne:before.active?.cargo?before.active.throwAirborne===true:!this.isGrounded(),
          throwEntryFrame,releaseFrame:this.simulationInputFrame,
          releaseElapsed:this.throwPresentation.releaseElapsed!,descriptor:structuredClone(throwSpec),
          damageSource:Object.freeze({baseDamage:throwSpec.damage,staleMultiplier:validTransaction!.staleMultiplier,
            queueMoveId:validTransaction!.queueMoveId,transactionKey:validTransaction!.transactionKey})}):undefined;
        const beforeReleaseDamage=target.getDamagePercent();
        this.grabTarget.releaseFromGrab('throw');
        // Back throw launches the victim BEHIND the grabber — flip the
        // facing the knockback's +x mirrors against, so a back-throw's
        // positive knockback.x sends them the opposite way from a forward
        // throw (previously every throw used `this.facing`, so back-throw
        // launched the wrong direction).
        this.grabTarget.applyHit({
          damage: throwSpec.damage*(validTransaction?.staleMultiplier??1),baseDamage:throwSpec.damage,
          staleMultiplier:validTransaction?.staleMultiplier??1,combatAttackerSlotIndex:this.slotIndex,...(throwRelease?{combatThrowRelease:throwRelease}:{}),
          hitlagMultiplier: throwSpec.hitlagMultiplier,
          electricCollision: throwSpec.electricCollision,
          knockback: throwSpec.knockback,
          facing: (throwSpec.launchFacing==='actor'?this.facing:throwSpec.launchFacing==='opposite'?-this.facing:
            dir === 'back' ? -this.facing : this.facing) as 1 | -1,
        });
        if(validTransaction)this.throwPresentation.damageTransaction=this.commitCapturedDamageTransaction(validTransaction,target.getDamagePercent()-beforeReleaseDamage);
        const releaseVelocity=throwSpec.releaseVelocity;
        if(releaseVelocity&&(releaseVelocity.situation===undefined||releaseVelocity.situation===((before.active?.cargo?before.active.throwAirborne:!this.isGrounded())?'air':'ground')))
          this.scene.matter.body.setVelocity(this.body,{x:releaseVelocity.x*this.facing,y:releaseVelocity.y});
        if(throwSpec.reverseFacingAtRelease){this.facing=this.facing===1?-1:1;this.locomotionState=resetLocomotionState(this.facing);}
        this.grabTarget = null;
      }
    }
    // Mash-out / break paths — clear the link without firing damage.
    const heldToCooldownNoThrow =
      before.name === 'holding' && after.name === 'cooldown';
    if (heldToCooldownNoThrow && this.grabTarget !== null) {
      if(before.active?.cargo&&(this.grabSpec.cargo?.breakDamage??0)>0)this.grabTarget.addDamage(this.grabSpec.cargo!.breakDamage!,'external',this.slotIndex);
      this.grabTarget.releaseFromGrab('hold-expired');
      this.grabTarget = null;
      if (this.grabSpec?.ultimateCapture) this.grabState = resetGrabState();
      this.ultimateCaptureBudget = null;
    }
    if (after.name !== 'holding') this.ultimateCaptureBudget = null;
    if (after.name === 'idle' || after.name === 'holding') this.throwPresentation = null;
    this.notifySourceCaptureEquipmentOwnerChanged();
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
    if (target.isGrabbed() || target.isCaptureProtected()) return;
    this.clearGrabSourcePresentation();
    this.grabState = applyGrabConnect(this.grabState);
    this.ultimateCaptureBudget = this.grabSpec?.ultimateCapture
      ? {entryPercent: target.getDamagePercent(), initialFrames: ultimateCaptureFrames(target.getDamagePercent()), mash: initialCaptureMash(target.lastCaptureInput)} : null;
    this.grabTarget = target;this.sourceCaptureAdmissionFrame=this.simulationInputFrame;
    target.applyGrabbed(this);
    if (this.grabHitboxBody !== null) {
      this.donkeykongCatchPoseConsumer.forget(this.grabHitboxBody);
      this.donkeykongCatchCollisionDiagnostic=null;
      despawnHitbox(this.scene, this.grabHitboxBody);
      this.grabHitboxBody = null;
    }
    this.notifySourceCaptureEquipmentOwnerChanged();
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
  setSideSpecial(id:string|null):void {
    if(id!==null&&!this.attacks.has(id))throw new Error(`Character: unknown side special '${id}'`);
    this.sideSpecialId=id;
  }
  getSideSpecialId():string|null {return this.sideSpecialId;}
  setNeutralSpecial(id: string | null): void {
    if (id !== null && !this.attacks.has(id)) {
      throw new Error(
        `Character: cannot set neutral special to unregistered '${id}'`,
      );
    }
    this.neutralSpecialId = id;
  }

  /** Sub-AC 3.3 — read the wired-up light/heavy/aerial dispatch slot. */
  /** Read-only current neutral input route at its first active frame. */
  getCpuNeutralAttackContactPreview(frame:number,previewFacing:1|-1=this.facing){
    const id=this.lightAttackId??this.defaultAttackId,move=id?this.getAttack(id):null;
    if(!move||!this.isGrounded()||this.equippedItem)return null;
    const age=move.hitWindows?.[0]?.startFrame??move.startupFrames,window=move.hitWindows?.find(w=>w.startFrame<=age&&age<w.endFrame);
    const current=window?resolveAttackHitWindow(move,move,window):move;
    const hits=current.collisionHits;
    const position=this.getPosition(),basis=previewFacing;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    const include=(x:number,y:number,r:number)=>{minX=Math.min(minX,x-r);maxX=Math.max(maxX,x+r);minY=Math.min(minY,y-r);maxY=Math.max(maxY,y+r);};
    if(hits!==undefined){for(const hit of hits){if((hit.damage??current.damage)<=0)continue;const c=hit.capsule;include(position.x+c.start.x*basis,position.y+c.start.y,c.radius);include(position.x+c.end.x*basis,position.y+c.end.y,c.radius);}}
    else{if(current.damage<=0)return null;const box=current.hitbox,x=position.x+box.offsetX*basis,y=position.y+box.offsetY;
      minX=x-box.width/2;maxX=x+box.width/2;minY=y-box.height/2;maxY=y+box.height/2;}
    if(![minX,maxX,minY,maxY].every(Number.isFinite))return null;
    const moveIdentity=JSON.stringify(move);
    return{geometryIdentity:JSON.stringify(hits!==undefined?hits.map(hit=>({id:hit.id,capsule:hit.capsule,damage:hit.damage??current.damage})):{rectangle:current.hitbox}),range:{minX,maxX,minY,maxY},provenance:{moveIdentity,generation:this.positionResetGeneration,frame,
      actorPosition:position,sourceRoot:this.getSourceRootPosition(),facing:basis,intent:'neutral-ground-light' as const,
      heldItemRoute:'unarmed' as const,previewKind:'first-active' as const}};
  }
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

  /**
   * Read-only snapshot of this fighter's placed down-special traps (bombs /
   * mines) for the renderer. Each entry is a world-space sphere with timing
   * so the scene can draw a fuse/arming state and pop it on detonation. The
   * traps work mechanically even when unrendered, so this is purely visual.
   */
  getActiveTraps(): ReadonlyArray<{
    readonly objectId: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly framesSinceSpawn: number;
    /** Frames until arm/detonate (fuse length for a timed bomb). */
    readonly armDelay: number;
    readonly lifetime: number;
    /** True for a timed bomb (fused); false for a contact mine. */
    readonly fused: boolean;
    readonly detonated: boolean;
    readonly moveId: string;
  }> {
    return this.activeTraps.map((t) => ({
      objectId: t.objectId,
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
      framesSinceSpawn: t.framesSinceSpawn,
      armDelay: t.armDelay,
      lifetime: t.lifetime,
      fused: t.fused,
      detonated: t.detonated,
      moveId: t.moveId,
    }));
  }

  /** True iff a move is currently in startup / active / recovery. */
  isAttacking(): boolean {
    return this.activeAttack !== null;
  }

  /** True iff a new attack would be allowed to start this frame. */
  canAttack(): boolean {
    if(this.linkPassiveGuard&&this.linkPassiveGuard.framesElapsed<4)return false;
    if (this.finalSmashControl) return false;
    if(this.donkeykongHeavyItemHeld||this.donkeykongHeavyItemAction)return false;
    if(this.itemEating||this.itemAction||this.itemShooting||this.isHammerLocked())return false;
    if(this.isSurfaceTechLocking())return false;
    if(this.buriedState||this.chargingSpecial?.donkeykongPunch)return false;
    if(this.groundRecovery || this.grabState.active?.cargo)return false;
    if (this.pikachuLedgeJump?.phase==='start' || this.footstoolRecipient || this.pikachuGroundRecovery || this.attackClankRemaining > 0 || this.attackClankLockedStep) return false;
    return this.grabReleasePresentation === null && this.tauntPresentation === null && !this.destroyed && this.activeAttack === null && this.cooldownRemaining === 0
      && this.shieldReleaseRemaining === 0
      && !this.shieldParryProtected
      && !this.isInLandingRecovery()
      && !this.chargingSpecial?.groundedUpSpecial;
  }

  /**
   * Item adapters run before applyInput. Predict this step's landing drain
   * without advancing it, including a Matter touchdown still awaiting tickLanding.
   */
  canUseItemsBeforeInput(): boolean {
    if(this.linkPassiveGuard&&this.linkPassiveGuard.framesElapsed<4)return false;
    if (this.finalSmashControl) return false;
    if(this.donkeykongHeavyItemAction)return false;
    if(this.itemEating||this.itemAction||this.itemShooting||this.isHammerLocked())return false;
    if(this.isSurfaceTechLocking())return false;
    const landingCooldown = this.landingRecovery ? Math.max(0, this.cooldownRemaining - 1)
      : this.cooldownRemaining;
    const landingAttackEndsThisStep = this.activeAttack !== null &&
      this.activeAttack === this.landingAttackInstance && this.landingRecovery && landingCooldown === 0;
    const pendingLanding = !this.prevGrounded && this.isGrounded()
      ? this.getSpecialLandingFrames() ?? this.getAirDodgeLandingFrames() ??
        ((this.aerialLandingContext === null ? 0 : getLandingLagFrames(
          this.aerialLandingContext.move, this.aerialLandingContext.framesElapsed)) ||
          (this.pendingOrdinaryLandingFrames ?? this.tuning.softLandingFrames ?? 0))
      : 0;
    return this.buriedState === null && !this.grabState.active?.cargo && this.pikachuLedgeJump?.phase!=='start' && this.groundRecovery === null && this.footstoolRecipient === null && (this.grabReleasePresentation === null ||
      this.grabReleasePresentation.framesElapsed + 1 >= ULTIMATE_GRAB_RELEASE_FRAMES) && (this.tauntPresentation === null ||
      this.tauntPresentation.framesElapsed + 1 >= this.tauntSpec![this.tauntPresentation.kind].cancelAfterFrames) &&
      !this.destroyed && this.attackClankRemaining === 0 && !this.attackClankLockedStep &&
      (this.activeAttack === null || landingAttackEndsThisStep) && landingCooldown === 0 &&
      this.shieldReleaseRemaining <= 1 &&
      this.shieldParryStunRemaining === 0 &&
      this.ordinaryLandingRemaining <= 1 && pendingLanding === 0 &&
      this.hitlagRemaining === 0 && this.hitstunRemaining === 0 &&
      this.grabbedBy === null && !isGrabActing(this.grabState) &&
      !isDodgeActing(this.dodgeState) && !isShieldRaised(this.shieldState) &&
      !isShieldBroken(this.shieldState) && !isInShieldstun(this.shieldState) &&
      !this.helpless && this.chargingSmash === null && this.chargingSpecial === null &&
      this.jumpsquatRemaining === 0 && this.knockdownRemaining === 0 && !this.pikachuGroundRecovery &&
      !isLedgeLockingInput(this.ledgeHangState);
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
    readonly assetCharacterId: string;
    readonly facing: 1 | -1;
    readonly destroyed: boolean;
    readonly activeAttack: ActiveAttack | null;
    readonly hitstunRemaining: number;
    readonly hitlagRemaining: number;
    readonly shield: ShieldState;
    readonly dodge: DodgeState;
    readonly ledgeHang: LedgeHangState;
    readonly pikachuSpecial: ReturnType<Character['getPikachuSpecialState']>;
    readonly finalSmash: FinalSmashActorControl | null;
  } {
    return {
      characterId: this.id,
      assetCharacterId: this.id,
      finalSmash: this.getFinalSmashPresentation(),
      facing: this.facing,
      destroyed: this.destroyed,
      activeAttack: this.getActiveAttack(),
      hitstunRemaining: this.hitstunRemaining,
      hitlagRemaining: this.hitlagRemaining,
      shield: this.shieldState,
      dodge: this.dodgeState,
      ledgeHang: this.ledgeHangState,
      pikachuSpecial: this.getPikachuSpecialState(),
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
      phase: this.activeAttack.move.pikachuSpecial && this.activeAttack.hitboxBody !== null ? 'active' : this.attackPhase(),
      framesElapsed: this.activeAttack.framesElapsed,
      hitboxBody: this.activeAttack.hitboxBody,
      chargeHeldFrames: this.activeAttack.chargeHeldFrames,
    };
  }
  /** Opaque live owner identity accompanies the existing selected item-body
   * clock. The copied presentation getter alone cannot identify a new swing. */
  getItemAttackPresentationOwner():{token:object;phase:'active'|'charge';move:AttackMove;rawAge:number;facing:1|-1}|null {
    const active=this.activeAttack;
    if(active?.move.itemClip)return{token:active,phase:'active',move:active.move,rawAge:active.framesElapsed,facing:active.facing};
    const charge=this.chargingSmash??this.chargingSpecial,move=charge?this.attacks.get(charge.moveId):null;
    if(!charge||!move?.itemClip)return null;
    const hold=move.itemClip==='item_sword_swing_4'||move.itemClip==='item_starrod_swing_4';
    return{token:charge,phase:'charge',move,rawAge:hold&&charge.framesHeld>0?charge.framesHeld:this.chargingSmash?.startupElapsed??0,facing:this.facing};
  }

  /** Live action timing for presentation; a stored charge is not a charge pose. */
  getAnimationActionState(): {
    chargingMove: AttackMove | null;
    chargeHeldFrames: number;
    chargeStartupElapsed?: number;
    landingRecoveryRemaining: number;
  } {
    const specialCharge = this.pikachuSpecialRuntime?.charge();
    if (specialCharge && this.activeAttack) return { chargingMove: this.activeAttack.move,
      chargeHeldFrames: specialCharge.frames, chargeStartupElapsed: specialCharge.startupElapsed, landingRecoveryRemaining: 0 };
    const charge = this.chargingSmash ?? this.chargingSpecial;
    const startupElapsed = this.chargingSmash?.startupElapsed;
    return {
      chargingMove: charge ? this.attacks.get(charge.moveId) ?? null : null,
      chargeHeldFrames: charge?.framesHeld ?? 0,
      ...(startupElapsed === undefined ? {} : { chargeStartupElapsed: startupElapsed }),
      landingRecoveryRemaining: Math.max(this.ordinaryLandingRemaining,
        this.landingRecovery ? this.cooldownRemaining : 0),
    };
  }
  /** Read-only actual smash charge owner; its object identity survives holds.
   * Entry and release are observed separately from a later active attack. */
  getNormalChargePresentationOwner(){const state=this.chargingSmash;if(!state)return null;
    const move=this.attacks.get(state.moveId);if(!move)return null;
    return{token:state,moveId:move.id,sourcePoseId:move.sourcePoseId??null,startupElapsed:state.startupElapsed??0,
      heldFrames:state.framesHeld,facing:state.facing};}
  getNormalAttackPresentationOwner(){const active=this.activeAttack;return active?{token:active,move:active.move}:null;}

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
  getIntrinsicChargeReadout():{progress:number;label:string}|null {return null;}
  getChargeProgress(): number | null {
    const specialCharge = this.pikachuSpecialRuntime?.charge();
    if (specialCharge) return Math.min(1, specialCharge.frames / 80);
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
    let move = this.attacks.get(id);
    if (!move) return false;
    this.donkeykongJabContinuation=null;
    const grounded = this.isGroundedForActionStart();
    if (!grounded && move.airborneVariant) move = { ...move.airborneVariant, sheetVariant: 'air' };
    this.clearTumbleForStartedAction();
    if (move.entryVelocityScale) {
      const scale = move.entryVelocityScale;
      const entryY=this.donkeykongOrdinaryEntryVelocityY??this.body.velocity.y;
      this.clearReferenceLaunch();
      this.scene.matter.body.setVelocity(this.body, {
        x: this.body.velocity.x * (grounded ? scale.xGround : scale.xAir),
        y: entryY * (grounded ? scale.yGround : scale.yAir),
      });
      this.donkeykongOrdinaryEntryVelocityY=null;
    }
    this.activeAttack = {
      move,
      facing: this.facing,
      framesElapsed: 0,
      hitboxBody: null,
      upSpecial: null,
      chargeHeldFrames: null,
    };
    if (move.pikachuSpecial) this.getPikachuSpecialRuntime().begin(move, this.activeAttack,
      move.pikachuSpecial.kind === 'skullBash' && isSmashFlick(this.prevMoveX, this.pikachuSpecialStick.x));
    // Shockwave down special: an airborne press starts the authored aerial
    // record instead (same id/type so routing and landing lag still resolve);
    // a grounded press arms the mash-repeat bookkeeping.
    const shockwave = this.resolveShockwaveSpec(move);
    if (shockwave !== null) {
      if (!grounded && shockwave.aerialVariant) {
        this.activeAttack.move = { ...shockwave.aerialVariant, id: move.id, type: 'downSpecial', sheetVariant: 'air' };
        this.shockwaveRepeat = null;
      } else {
        this.shockwaveRepeat = shockwave.repeat ? { moveId: move.id, queued: 0, repeats: 0 } : null;
      }
    }
    return true;
  }

  /**
   * Replace an in-flight combo stage with its authored follow-up,
   * stage of the string (`nextId`), restarting its frame timeline. Unlike
   * {@link attemptAttack} this deliberately BYPASSES `canAttack()` (which
   * would reject because a jab is already active) and arms NO cooldown
   * between stages, so the string flows seamlessly — the FINAL stage's
   * `cooldownFrames` becomes the post-string lockout when it ends. Facing
   * is copied from the current stage so a mid-string stick wiggle can't
   * flip the combo. Returns false (no-op) if the next stage isn't
   * registered or no jab is active.
   */
  private advanceChainedAttack(nextId: string, preserveCharge = false): boolean {
    if (this.activeAttack === null) return false;
    const next = this.attacks.get(nextId);
    if (next === undefined) return false;
    this.donkeykongJabContinuation=null;
    // Despawn the current stage's live hitbox so we never leak a sensor.
    if (this.activeAttack.hitboxBody !== null) {
      despawnHitbox(this.scene, this.activeAttack.hitboxBody);
    }
    this.activeAttack = {
      move: next,
      facing: this.activeAttack.facing,
      framesElapsed: 0,
      hitboxBody: null,
      upSpecial: null,
      chargeHeldFrames: preserveCharge ? this.activeAttack.chargeHeldFrames : null,
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
    let move = this.attacks.get(moveId);
    if (!move) return;
    const maxCharge = (move as AttackMoveWithAnimation).charge?.maxChargeFrames;
    const grounded = this.isGroundedForActionStart();
    if (!grounded && move.airborneVariant) move = { ...move.airborneVariant, sheetVariant: 'air' };
    if (maxCharge !== undefined && heldFrames >= maxCharge && move.fullChargeVariant) {
      move = { ...move.fullChargeVariant, sheetVariant: grounded ? 'ground' : 'air' };
    }
    this.clearTumbleForStartedAction();
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
  private fireSmash(moveId: string, facing: 1 | -1, heldFrames: number, startupElapsed = 0): void {
    if (!this.canAttack()) return;
    this.facing = facing;
    if (!this.attemptAttack(moveId)) return;
    if (this.activeAttack !== null) {
      this.activeAttack.chargeHeldFrames = Math.max(0, Math.round(heldFrames));
      this.activeAttack.framesElapsed = startupElapsed;
    }
  }

  /** Source-style press charge is opt-in; ordinary shared release controls remain unchanged. */
  private stepDonkeyKongPunchInput(input:CharacterInput):CharacterInput {
    const charge=this.chargingSpecial,punch=charge?.donkeykongPunch;
    if(!charge||!punch)return input;
    this.donkeykongPunchConsumedFrame=this.simulationInputFrame;
    this.offensiveActionBuffer=null;this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;
    const previous=punch.state;
    const chargeSpec=this.neutralChargeMove()?.charge;
    const next=tickDonkeyKongPunch(previous,{specialPressed:input.special===true&&!this.prevSpecialHeld,
      shieldPressed:input.shield===true&&!this.prevShieldHeld,shieldHeld:input.shield===true,
      dodgePressed:input.dodge===true&&!this.prevDodgeHeld,jumpPressed:input.jump&&!this.prevJumpHeld,
      rollDirection:Math.abs(input.moveX)>=.5?(Math.sign(input.moveX)*punch.facing) as 1|-1:0,
      grounded:this.isGrounded(),canAirJump:!this.helpless&&this.jumpsUsed<this.tuning.maxJumps,
      canAirDodge:!this.helpless&&!this.airDodgeUsed},{entryFrames:chargeSpec?.entryFrames??7,maxChargeFrames:charge.maxFrames,cancelFrames:chargeSpec?.cancelFrames??4,airJumpCancelFrames:5,fullBankEndFrames:4});
    if(next.state){
      if(previous.phase!=='cancel'&&next.state.phase==='cancel')punch.cancelInput={x:input.moveX,y:input.moveY??0};
      if(next.state.phase!=='cancel')punch.sourceGrounded=this.isGrounded();
      punch.state=next.state;charge.framesHeld=next.state.chargeFrames;
      return input;
    }
    this.chargingSpecial=null;
    if(!next.command)return input;
    if(next.command.kind==='fire'){
      this.storedSpecialCharge=null;this.facing=punch.facing;
      this.fireNeutralChargeSpecial(charge.moveId,next.command.chargeFrames);
      this.donkeykongPunchFireFrame=this.simulationInputFrame;return input;
    }
    this.storedSpecialCharge={moveId:charge.moveId,framesHeld:next.command.chargeFrames};
    const exit=next.command.exit;
    if(exit==='shield'){this.prevShieldHeld=false;return {...input,shield:true};}
    if(exit==='ground-jump'||exit==='air-jump'){this.prevJumpHeld=false;return {...input,jump:true};}
    if(exit==='roll-forward'||exit==='roll-back'){
      this.prevDodgeHeld=false;return {...input,shield:false,dodge:true,moveX:(exit==='roll-forward'?1:-1)*punch.facing,moveY:0};
    }
    if(exit==='air-dodge'){
      this.prevDodgeHeld=false;return {...input,shield:false,dodge:true,moveX:punch.cancelInput?.x??0,moveY:punch.cancelInput?.y??0};
    }
    return input;
  }

  private neutralChargeMove(): { id: string; charge: ChargeSpec; airCharge: boolean; storeCharge: boolean; autoFire: boolean } | null {
    if (this.neutralSpecialId === null) return null;
    const move = this.attacks.get(this.neutralSpecialId) as unknown as
      | {
          id: string;
          specialKind?: string;
          charge?: ChargeSpec;
          chargedProjectile?: { charge: ChargeSpec; airCharge?: boolean; storeCharge?: boolean; autoFire?: boolean };
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
      return { id: move.id, charge, airCharge: move.chargedProjectile?.airCharge ?? charge.airCharge ?? false,
        storeCharge: move.chargedProjectile?.storeCharge ?? true, autoFire: move.chargedProjectile?.autoFire ?? false };
    }
    return null;
  }

  /**
   * Resolve the move record (possibly a charged clone) to spawn the
   * active attack's hitbox from. For a charge release, lerps the move's
   * `damage` + `knockback` between the `charge.min*` / `charge.max*`
   * endpoints at the held-frame count via the {@link ChargeSpec} ramp.
   * Damage-only mode preserves the authored reference launch, with charged
   * damage supplying its stronger growth. Uncharged moves return unchanged.
   */
  private chargedSpawnMove(a: {
    move: AttackMove;
    chargeHeldFrames: number | null;
  }): AttackMove {
    if (a.chargeHeldFrames === null) return a.move;
    const spec = (a.move as unknown as { charge?: ChargeSpec }).charge;
    if (!spec) return a.move;
    const damage = computeChargedDamageFromSpec(spec, a.chargeHeldFrames);
    return {
      ...a.move,
      damage,
      ...(a.move.collisionHits ? { collisionHits: scaleAttackCollisionHitDamage(a.move.collisionHits,
        a.move.damage === 0 ? 1 : damage / a.move.damage) } : {}),
      knockback: computeChargedKnockbackFromSpec(spec, a.chargeHeldFrames, a.move.knockback),
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
   * Up-special neither consumes nor restores the separate jump budget.
   * Landing or grabbing a ledge replenishes it.
   *
   * Returns `false` (without mutating velocity) if the dispatch slot is
   * empty, the move id can't be resolved, or the attack lifecycle
   * gates `attemptAttack`.
   */
  attemptUpSpecial(stickX: number = 0, stickY: number = -1): boolean {
    if (this.helpless) return false;
    if (this.upSpecialId === null) return false;
    const move = this.attacks.get(this.upSpecialId);
    if (!move) return false;
    if (move.pikachuSpecial?.kind === 'quickAttack') {
      this.pikachuSpecialStick = { x: stickX, y: stickY };
      const started = this.attemptAttack(move.id);
      if (started) { this.jumpCutArmed = false; this.fastFallLatched = false;
        this.shortHopRising = false; this.airJumpRising = false; this.jumpsquatRemaining = 0;
        this.tapJumpBufferFrames = 0; this.jumpInputBufferFrames = 0; }
      return started;
    }
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
    if (move.upSpecialKind === 'multiHitRising' && move.groundedVariant && this.isGroundedForActionStart()) {
      const groundedMove = move.groundedVariant;
      if (groundedMove.charge && move.groundedChargeStartFrame !== undefined) {
        this.chargingSpecial = { moveId: move.id, framesHeld: 0,
          maxFrames: groundedMove.charge.maxChargeFrames,
          groundedUpSpecial: { move: groundedMove, facing: this.facing, startupElapsed: 0, holdFrame: move.groundedChargeStartFrame } };
        this.clearTumbleForStartedAction();
        this.storedSpecialCharge = null;
        this.tapJumpBufferFrames = 0;
        this.jumpInputBufferFrames = 0;
        this.jumpsquatRemaining = 0;
        this.jumpsquatShortHop = false;
        this.jumpsquatFacing = null;
        return true;
      }
      if (!this.attemptAttack(this.upSpecialId)) return false;
      this.activeAttack!.move = Character.groundedUpSpecialAttack(move);
      this.tapJumpBufferFrames = 0;
      this.jumpInputBufferFrames = 0;
      this.jumpsquatRemaining = 0;
      this.jumpsquatShortHop = false;
      this.jumpsquatFacing = null;
      return true;
    }

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

    // Recovery neither consumes nor restores the separate jump budget.
    // Landing or grabbing a ledge replenishes it; damage interruption does not.
    // The up-special owns the vertical velocity from this frame on —
    // an armed short-hop cut from a prior jump must not clip the
    // recovery's rise on button release, and a stale fast-fall latch
    // must not drag the recovery back down.
    this.jumpCutArmed = false;
    this.fastFallLatched = false;

    this.shortHopRising = false;
    this.airJumpRising = false;
    this.tapJumpBufferFrames = 0;
    this.jumpInputBufferFrames = 0;
    this.jumpsquatRemaining = 0;
    this.jumpsquatShortHop = false;
    this.jumpsquatFacing = null;

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
    this.clearReferenceLaunch();
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

  /** Legacy burst, or a spinning recovery that retains entry momentum. */
  private applyMultiHitRisingPress(move: MultiHitRisingUpSpecialMove): void {
    const r = move.multiHitRising;
    const vx = r.sustainedRise ? this.body.velocity.x : r.driftImpulse * this.facing;
    const vy = r.riseImpulse; // Schema mandates this is negative (upward).
    this.scene.matter.body.setVelocity(this.body, { x: vx, y: vy });
  }

  /** Only the live aerial move owns flight; interruption drops it immediately. */
  private getSustainedUpSpecialRise(): UpSpecialSustainedRiseSpec | null {
    const attack = this.activeAttack;
    if (!attack?.upSpecial || !isUpSpecialMove(attack.move) ||
        attack.move.upSpecialKind !== 'multiHitRising') return null;
    return attack.move.multiHitRising.sustainedRise ?? null;
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
        // The optional flight profile is applied by input drift and the
        // pre-integration gravity hook; legacy moves keep ordinary physics.
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
    this.clearReferenceLaunch();
    // The dive owns the vertical motion this frame; horizontal velocity is
    // preserved so the player can steer the plunge slightly.
    this.scene.matter.body.setVelocity(this.body, {
      x: this.body.velocity.x,
      y: vy,
    });
    if (a.hitboxBody !== null) {
      updateHitboxPosition(
        this.scene,
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
  private recoveryOrigin(): Exclude<ReactionPresentationState['origin'], null> {
    return this.tripped ? 'trip' : this.knockdownFaceDown ? 'face-down' : 'face-up';
  }

  /** Explicit reviewed cranial TOP supplied by paired anatomy. */
  getFootstoolHeadWorldContact():{x:number;y:number}|null{
    if(this.getFinalSmashPresentation()||this.getFinalVictimPresentationSelection())return this.getFinalSmashHeadWorldContact();
    const point=selectPackedHeadContact(captureSimulationAnimation(this,0,false));
    const position=this.getPosition();return point?{x:position.x+point.x,y:position.y+point.y}:null;
  }
  /** Pre-input value snapshot; reading it never changes input/state clocks. */
  getFootstoolParticipant(playerIndex:number,input:CharacterInput):SourceFootstoolParticipant {
    const p=this.getPosition(),v=this.getVelocity(),vertices=this.body.vertices;
    const feetY=vertices?.length ? Math.max(...vertices.map(vertex=>vertex.y)) : this.getBodyBottomY();
    const top=vertices?.length ? Math.min(...vertices.map(vertex=>vertex.y)) : p.y-this.tuning.height/2;
    const freshLink=this.id==='link';
    const posedFinal=!!(this.getFinalSmashPresentation()||this.getFinalVictimPresentationSelection());
    const headBoxes=this.getActiveHurtboxes().filter(h=>this.id==='donkeykong'?h.region==='head'||h.id.endsWith('.head'):
      freshLink||posedFinal?!h.intangible&&(h.region==='head'||h.id==='head'||h.id.endsWith('.head')):h.id.endsWith('.head'));
    const head=headBoxes[0];
    const anatomical=freshLink||this.id==='donkeykong'||posedFinal;
    const declared=anatomical?this.getFootstoolHeadWorldContact():null;
    // Current old named-head rows lack a reviewed contact point. This explicit
    // fallback uses the complete anatomical capsule union, never its first
    // strip or the movement hull; new rows supply the reviewed point directly.
    const headEdges=anatomical?headBoxes.flatMap(h=>h.capsule?[
      Math.min(h.capsule.start.x*this.facing,h.capsule.end.x*this.facing)-h.capsule.radius,
      Math.max(h.capsule.start.x*this.facing,h.capsule.end.x*this.facing)+h.capsule.radius]:[
      h.offsetX*this.facing-h.width/2,h.offsetX*this.facing+h.width/2]):[];
    const headX=declared?.x??(anatomical&&headEdges.length?p.x+(Math.min(...headEdges)+Math.max(...headEdges))/2:p.x+(head?.offsetX??0)*this.facing);
    const headTop=declared?.y??((this.id==='donkeykong'||freshLink)&&headBoxes.length?p.y+Math.min(...headBoxes.map(h=>h.capsule?
      Math.min(h.capsule.start.y,h.capsule.end.y)-h.capsule.radius:h.offsetY-h.height/2)):
      head?.capsule ? p.y+Math.min(head.capsule.start.y,head.capsule.end.y)-head.capsule.radius
      : top);
    const normal=!this.destroyed && this.hitlagRemaining===0 && this.hitstunRemaining===0 &&
      !this.pendingKnockback && !this.grabbedBy && !isGrabActing(this.grabState) &&
      !isLedgeLockingInput(this.ledgeHangState) && !this.footstoolRecipient;
    return {playerIndex,characterId:this.id,sourceLinkFootstool:freshLink,x:p.x,y:p.y,feetY,velocityY:v.y,head:{x:headX,top:headTop},
      freshJump:input.jump && !this.prevJumpHeld,mayJump:normal && this.canAttack() && this.canStartCommittedAction() && !this.helpless&&
        (!freshLink||canLinkFootstoolJump(this.tuning.jumpImpulse,this.sourceLinkFootstoolRepeatCount,this.sourceLinkFootstoolCooldown))&&
        (this.id!=='donkeykong'||(this.simulationInputFrame-this.donkeykongLastAttackEndFrame>=DONKEYKONG_FOOTSTOOL_PARAMETERS.postAttackLockoutFrames&&
          canDonkeyKongFootstoolJump(DONKEYKONG_FOOTSTOOL_BETA_JUMP_BASIS,this.donkeykongFootstoolRepeatCount,this.donkeykongFootstoolCooldown))),
      // Every fighter can be footstooled (SmashWiki Footstool); without a head region the hull top is the head.
      mayReceive:normal && (!posedFinal||headBoxes.length>0&&declared!==null) && !this.isCaptureProtected()&&!this.hasDonkeyKongHeavyAirPolicy(),attacking:this.activeAttack!==null,grounded:this.isGrounded()};
  }
  canPresentFootstoolRecipient(grounded:boolean):boolean {
    return this.id!=='pikachu' || selectPikachuAuxiliaryBody(grounded?'footstool_pose':'footstool_air_pose',0)!==null;
  }
  queueFootstoolJump(phantom=false,contact?:{jumperIndex:number;jumperGeneration:number;recipientIndex:number;recipientGeneration:number}):void {
    if(this.id==='link'&&!contact)throw new Error('Fresh footstool requires accepted participant identities');
    this.sourceLinkFootstoolPendingContact=contact?{...contact}:null;
    this.donkeykongJabContinuation=null;this.pendingFootstoolJump=true;this.pendingFootstoolPhantom=phantom;
  }
  applyFootstoolRecipient(grounded:boolean,entryFrame:number,jumperX?:number,contact?:{jumperIndex:number;jumperGeneration:number;recipientIndex:number;recipientGeneration:number}):void {
    if(this.id==='link'){
      if(jumperX===undefined||!Number.isFinite(jumperX)||!contact)throw new Error('Fresh footstool requires actual accepted jumper contact');
      this.sourceLinkFootstoolRecipientSide=selectLinkFootstoolRecipientSide({jumperX,recipientX:this.getPosition().x,recipientEntryFacing:this.facing});
      this.sourceLinkFootstool={presentation:{role:'recipient',phase:grounded?this.sourceLinkFootstoolRecipientSide==='back'?'ground-back':'ground-front':'air-pose',
        framesElapsed:0,facing:this.facing},entryFrame,lastFrame:entryFrame,generation:this.positionResetGeneration,mini:false,phantom:false,contact:{...contact}};
      this.onIntrinsicSourceInterrupted();this.sourceDamagePresentation=null;this.sourceDamageOwnStop=false;
    }
    this.donkeykongFullHopStep=null;this.donkeykongOrdinaryVerticalTick=false;
    this.clearItemAction();
    this.donkeykongTurnBrake=null;this.restoreSourcedGroundFriction();
    if(this.pikachuLedgeFlightHitlagRelease){
      this.pikachuLedgeFlightHitlagRelease=false;
      this.attackerHitlagVelocity=null;this.hitlagPosition=null;
    }
    this.cancelAttack();this.pikachuSpecialRuntime?.clear();this.pikachuGroundRecovery=null;this.groundRecovery=null;this.clearSurfaceTech();this.pikachuLedgeJump=null;this.clearPikachuLedgeAttachment();
    this.pikachuAuxiliaryAir=null;this.jumpPresentation=null;this.footstoolMini=null;
    this.clearReferenceLaunch();this.pendingKnockback=null;this.hitstunRemaining=0;
    this.fastFallLatched=false;this.airJumpRising=false;this.shortHopRising=false;this.jumpCutArmed=false;
    this.footstoolRecipient={framesElapsed:0,grounded,facing:this.facing,entryFrame};
    // StepPose and StepPoseAir emit sys_step_jump at native frame0 on
    // Top +(0,6,5). The registered root is feet, native Z is horizontal,
    // and native Y is up at5px/unit. The common effect asset/lifetime is
    // unavailable: this6-step decorative cue is an explicit beta visual.
    this.pikachuFootstoolVisual=this.id==='pikachu'
      ? {x:this.body.position.x+25*this.facing,y:this.body.position.y-5,age:0,entryFrame} : null;
    this.tumbling=!grounded;this.reactionPresentation=null;
    if (grounded) this.scene.matter.body.setVelocity(this.body,{x:0,y:0});
  }
  getSourceLinkFootstoolPresentationRoute(){
    const state=this.sourceLinkFootstool;if(!state||state.generation!==this.positionResetGeneration)return null;
    if(this.finalSmashControl||this.grabbedBy||this.hitstunRemaining>0||this.pendingKnockback||this.sourceDamageOwnStop||
      !this.footstoolRecipient&&!this.canPresentUncommittedBody())return null;
    return selectLinkFootstoolBodyRoute(state.presentation);
  }
  private advanceSourceLinkFootstoolPresentation():void {
    const state=this.sourceLinkFootstool;
    if(this.sourceLinkFootstoolCooldown>0&&this.sourceLinkFootstoolCooldownEntryFrame!==this.simulationInputFrame)this.sourceLinkFootstoolCooldown-=1;
    if(!state||state.lastFrame===this.simulationInputFrame)return;
    if(state.generation!==this.positionResetGeneration||this.finalSmashControl||this.grabbedBy||this.hitstunRemaining>0||this.pendingKnockback||
      !this.footstoolRecipient&&!this.canPresentUncommittedBody()){this.sourceLinkFootstool=null;return;}
    const age=this.simulationInputFrame===state.entryFrame?state.presentation.framesElapsed:state.presentation.framesElapsed+1;
    const performer=state.presentation.role==='performer',ground=state.presentation.phase==='ground-front'||state.presentation.phase==='ground-back';
    if(performer&&(age>=9||this.isGrounded())||ground&&(!this.isGrounded()||age>=(state.presentation.phase==='ground-back'?24:9))||
      !performer&&!ground&&this.isGrounded()){this.sourceLinkFootstool=null;return;}
    const previous=state.presentation;
    this.sourceLinkFootstool={...state,lastFrame:this.simulationInputFrame,presentation:previous.phase==='air-pose'&&age>=8?
      {...previous,phase:'air-fall',framesElapsed:0}:{...previous,framesElapsed:age}};
  }
  private lockPikachuSourceRecoveryInput(input:CharacterInput):void {
    this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    this.prevJumpHeld=input.jump;this.prevAttackHeld=input.attack===true;this.prevHeavyHeld=input.attackHeavy===true;
    this.prevSpecialHeld=input.special===true;this.prevShieldHeld=input.shield===true;
    this.prevDodgeHeld=input.dodge===true;this.prevGrabHeld=input.grab===true;
    this.prevMoveX=clamp(input.moveX,-1,1);this.prevMoveY=clamp(input.moveY??0,-1,1);this.prevGrounded=this.isGrounded();
  }
  getPikachuLedgeJumpPresentationState(){
    const state=this.pikachuLedgeJump;
    return state?{phase:state.phase,framesElapsed:state.framesElapsed,facing:state.facing}:null;
  }
  private pikachuPhysicalHalfHeight(){
    return this.body.vertices?.length?Math.max(...this.body.vertices.map(v=>v.y))-this.body.position.y:this.tuning.height/2;
  }
  getItemThrowContext(direction:ItemDirection){
    if(this.donkeykongHeavyItemHeld||this.donkeykongHeavyItemAction)return null;
    const dodge=this.dodgeState.active;
    const dodgeKind=dodge?.kind==='roll'?(dodge.backward?'back-roll':'roll'):dodge?.kind==='air'?(dodge.directional?'air-directional':'air-neutral'):dodge?.kind==='spot'?'spot':undefined;
    const externallyBlocked=this.destroyed||this.hitlagRemaining>0||this.hitstunRemaining>0||this.pendingKnockback!==null||
      this.itemEating!==null||this.itemAction!==null||this.buriedState!==null||this.activeAttack!==null||this.chargingSpecial!==null||this.chargingSmash!==null||
      this.grabbedBy!==null||isGrabActing(this.grabState)||isLedgeLockingInput(this.ledgeHangState)||this.groundRecovery!==null||
      this.footstoolRecipient!==null||this.isSurfaceTechLocking()||this.tauntPresentation!==null||this.grabReleasePresentation!==null||
      this.knockdownRemaining>0||this.helpless||this.isInLandingRecovery()||this.ordinaryLandingRemaining>1||
      this.shieldReleaseRemaining>1||this.shieldParryStunRemaining>0||this.shieldParryProtected||isShieldBroken(this.shieldState)||isInShieldstun(this.shieldState);
    return eligibleItemThrowContext({airborne:!this.isGrounded(),normalActionable:this.canUseItemsBeforeInput(),externallyBlocked,
      shielding:isShieldRaised(this.shieldState),jumpSquatActive:this.jumpsquatRemaining>0,dodgeKind,dodgeAge:dodge?.framesElapsed,direction});
  }
  /** Acquisition retains the currently selected body/action. Scene owns the
   * actual item rectangles, fresh entry input, finite source-window check,
   * identity/recatch locks and inventory commit. No ground pickup is started. */
  getItemCatchContext():{context:ItemCatchContext;age:number;externallyBlocked:boolean}|null {
    if(this.equippedItem!==null||this.donkeykongHeavyItemHeld||this.donkeykongHeavyItemAction)return null;
    const externallyBlocked=this.destroyed||this.hitlagRemaining>0||this.hitstunRemaining>0||this.pendingKnockback!==null||
      this.itemAction!==null||this.buriedState!==null||this.chargingSpecial!==null||this.chargingSmash!==null||
      this.grabbedBy!==null||isGrabActing(this.grabState)||isLedgeLockingInput(this.ledgeHangState)||this.groundRecovery!==null||
      this.footstoolRecipient!==null||this.isSurfaceTechLocking()||this.tauntPresentation!==null||this.grabReleasePresentation!==null||
      this.knockdownRemaining>0||this.helpless||this.isInLandingRecovery()||this.ordinaryLandingRemaining>0||
      this.shieldReleaseRemaining>0||isShieldRaised(this.shieldState)||isShieldBroken(this.shieldState)||isInShieldstun(this.shieldState);
    const attack=this.activeAttack;
    if(attack){
      if(!this.isGrounded()&&attack.move.type==='aerial')return{context:'aerial',age:attack.framesElapsed,externallyBlocked};
      if(this.isGrounded()&&attack.move.id===this.dashAttackSlotId)return{context:'dash-attack',age:attack.framesElapsed,externallyBlocked};
      if(this.isGrounded()&&attack.move.type==='tilt')return{context:'tilt',age:attack.framesElapsed,externallyBlocked};
      return null;
    }
    const dodge=this.dodgeState.active;
    if(!this.isGrounded()&&dodge?.kind==='air')return{context:'air-dodge',age:dodge.framesElapsed,externallyBlocked};
    if(!this.isGrounded()&&this.canUseItemsBeforeInput())return{context:'air-stationary',age:0,externallyBlocked};
    return null;
  }
  /** Scene reserves the actual item identity before input. Its callback is
   * emitted once by this source clock, then Scene commits inventory/physics. */
  beginItemAction(action:ItemAction,simulationFrame:number,entryFacing:1|-1=this.facing):boolean {
    if(this.isHammerLocked())return false;
    if(!Number.isInteger(simulationFrame)||simulationFrame<0)return false;
    const pickup=action.startsWith('pickup-');
    if((action.startsWith('throw-air-')||action==='air-z-drop')===this.isGrounded())return false;
    const direction:ItemDirection=action==='ground-drop'||action==='air-z-drop'?'drop':action.includes('-back-')?'back':action.includes('-up-')?'up':action.includes('-down-')?'down':'forward';
    const context=pickup?(this.isGrounded()&&this.canUseItemsBeforeInput()?'ordinary':null):this.getItemThrowContext(direction);
    if(!context)return false;
    this.donkeykongJabContinuation=null;
    if(action.startsWith('throw-air-')){
      this.clearSurfaceTech();this.donkeykongFullHopStep=null;this.fastFallLatched=false;
    }
    const step=createItemAction(action,entryFacing,fighterItemProfile(this.id)),plan=step.state?.plan??getItemActionPlan(action,fighterItemProfile(this.id));
    if(context==='shield-cancel'){
      this.shieldState={...this.shieldState,name:'idle',blockStunRemaining:0};this.shieldReleaseRemaining=0;
    }
    if(context==='jump-cancel'){this.jumpsquatRemaining=0;this.jumpsquatFacing=null;this.jumpsquatShortHop=false;this.jumpPresentation=null;}
    if(context==='roll-cancel'||context==='air-z-drop-cancel'){
      this.dodgeState=resetDodgeState();this.airDodgeBurst=null;this.airDodgeGravityVelocityY=0;
    }
    this.itemActionEntryFrame=simulationFrame;
    this.itemAction=step.state?{...step.state,entryFrame:simulationFrame,entryFacing}:null;
    this.itemActionEvents=step.events.map(event=>({...event,action,plan,entryFacing,entryFrame:simulationFrame}));
    this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    this.packedCrouchPhase=null;this.donkeykongTurnBrake=null;this.donkeykongFootstoolPerformer=null;
    return true;
  }
  getItemActionState(){return this.itemAction?{...this.itemAction}:null;}
  drainItemActionEvents(){const events=this.itemActionEvents;this.itemActionEvents=[];return events;}
  drainItemActionCompletions(){const completed=this.itemActionCompletions;this.itemActionCompletions=[];return completed;}
  syncDonkeyKongHeavyItem(held:boolean):void {
    if(held)this.donkeykongJabContinuation=null;
    const wasHeld=this.donkeykongHeavyItemHeld;this.donkeykongHeavyItemHeld=held;
    if(!held){this.donkeykongHeavyCarry=null;this.pendingDonkeyKongHeavyJump=null;this.donkeykongHeavyDownFlickAge=null;this.donkeykongHeavyDownHeld=false;}
    else if(!wasHeld&&!this.donkeykongHeavyItemAction){this.donkeykongHeavyCarry=beginDonkeyKongHeavyCarry(this.isGrounded(),this.facing);this.donkeykongHeavyCarryEntryFrame=this.simulationInputFrame;}
  }
  /** Retirement/interruption ends the delayed action too. Ordinary native
   * throw release calls sync(false) and retains its recovery drawing. */
  interruptHeavyItemCarry():void {
    this.syncDonkeyKongHeavyItem(false);this.clearDonkeyKongHeavyItemAction();
  }
  getDonkeyKongHeavyCarryState(){return this.donkeykongHeavyCarry?{...this.donkeykongHeavyCarry}:null;}
  getDonkeyKongHeavyItemActionState(){return this.donkeykongHeavyItemAction?{...this.donkeykongHeavyItemAction}:null;}
  drainDonkeyKongHeavyItemActionEvents(){const events=this.donkeykongHeavyItemEvents;this.donkeykongHeavyItemEvents=[];return events;}
  /** Native heavy callbacks are distinct from light ones. The helper's current
   * selected unit action rate remains explicitly authored until common status
   * get-rate/throw-rate caller resolution; it is not native rate parity. */
  beginDonkeyKongHeavyItemAction(action:DonkeyKongHeavyItemAction,simulationFrame:number,entryFacing:1|-1=this.facing):boolean {
    if(!Number.isInteger(simulationFrame)||simulationFrame<0||this.itemAction||this.donkeykongHeavyItemAction||!this.canUseItemsBeforeInput())return false;
    if(action==='pickup'?!this.isGrounded()||this.donkeykongHeavyItemHeld:!this.donkeykongHeavyItemHeld)return false;
    const carry=this.donkeykongHeavyCarry;
    if(action!=='pickup'&&carry&&(carry.phase==='landing'||carry.phase==='turn'&&!carry.turnCompleted))return false;
    if(fighterHeavyItemProfile(this.id).carry.groundOnly&&!this.isGrounded())return false;
    const step=createDonkeyKongHeavyItemAction(action,entryFacing,this.id);
    this.donkeykongJabContinuation=null;
    if(action!=='pickup')this.donkeykongFullHopStep=null;
    this.donkeykongHeavyItemAction={...step.state,entryFrame:simulationFrame};
    this.donkeykongHeavyCarry=null;this.pendingDonkeyKongHeavyJump=null;
    this.donkeykongHeavyItemEvents=[];this.clearSurfaceTech();this.donkeykongTurnBrake=null;this.packedCrouchPhase=null;
    this.jumpInputBufferFrames=0;this.tapJumpBufferFrames=0;this.offensiveActionBuffer=null;
    return true;
  }
  /** Pikachu's item body: the item action's sparse native drawing (the nearest drawn sample of its
   * clip; strong throws share the ordinary drawing), else WaitItem while standing with an item. */
  getPikachuItemPresentationState(){
    if(this.id!=='pikachu')return null;
    const eating=this.getRecoveryPresentation();
    if(eating){const pose=selectPikachuAuxiliaryBody(eating.sheet,eating.age);
      if(pose)return{sheet:eating.sheet,nativeAge:eating.age,artFrameIndex:pose.artFrameIndex,nativeSample:pose.nativeSample,facing:eating.facing,eventAge:eating.age};}
    const hammer=this.getHammerPresentation();
    if(hammer){const pose=selectPikachuAuxiliaryBody(hammer.sheet,hammer.age);
      if(pose)return{sheet:hammer.sheet,nativeAge:hammer.age,artFrameIndex:pose.artFrameIndex,nativeSample:pose.nativeSample,facing:hammer.facing,eventAge:null};}
    if(this.donkeykongHeavyItemAction||this.donkeykongHeavyCarry){
      const heavy=this.donkeykongHeavyItemAction,carry=this.donkeykongHeavyCarry;
      // The heavy wait resource/common status is unavailable: hold the
      // native pickup's final carry pose, not a light-item crouch pose.
      const sheet=heavy?heavy.plan.motion.replace(/4$/,''):carry?.phase==='walk'?'item_heavy_walk':carry?.phase==='landing'?'landing_heavy':'item_heavy_get';
      const age=heavy?Math.max(0,Math.floor(heavy.nativeFrame)-1):carry?.phase==='walk'||carry?.phase==='landing'?carry.age:24;
      const pose=selectPikachuAuxiliaryBody(sheet,age);
      return pose?{sheet,nativeAge:age,artFrameIndex:pose.artFrameIndex,nativeSample:pose.nativeSample,facing:heavy?.facing??carry!.facing,eventAge:heavy?.framesElapsed??null}:null;
    }
    const action=this.itemAction;
    if(action){
      const base=itemActionSheet(action.plan),sheet=pikachuAuxiliaryBodyEndExclusive(base)===null?base.replace(/4$/,''):base;
      const end=pikachuAuxiliaryBodyEndExclusive(sheet);
      const raw=Math.max(0,Math.floor(action.nativeFrame)-1);
      const age=end===null?null:selectPikachuAuxiliaryBody(sheet,raw)?raw:end-1;
      const pose=age===null?null:selectPikachuAuxiliaryBody(sheet,age);
      return pose&&age!==null?{sheet,nativeAge:age,artFrameIndex:pose.artFrameIndex,nativeSample:pose.nativeSample,
        facing:action.facing,eventAge:action.framesElapsed}:null;
    }
    // WaitItem is the neutral held-item body. Preserve the actual ordinary
    // locomotion, crouch, jump, landing and contextual cue while moving.
    if(!this.canPresentUncommittedBody()||this.equippedItem===null||!this.isGrounded()||
        this.locomotionState.name!=='standing' || this.pikachuCrouchCrawl ||
        this.jumpPresentation || this.pikachuAuxiliaryAir || this.pikachuTurnBrake ||
        this.pikachuRespawnPresentation || this.getLandingPresentationState())return null;
    const pose=selectPikachuAuxiliaryBody('item_carry',this.heldItemCarryAge);
    return pose ? {sheet:'item_carry',nativeAge:this.heldItemCarryAge,artFrameIndex:pose.artFrameIndex,nativeSample:pose.nativeSample,
      facing:this.facing,eventAge:null} : null;
  }
  /** The held item's world point and angle: the socket of the drawing shown now (heldItemSocket.ts),
   * else the fighter's hand anchor. Held, released and rendered items all use this one point. */
  getHeldItemSocket():{x:number;y:number;angle:number|null;length:number}{
    const p=this.getPosition(),axis=this.equippedItem?.definition.visual?.socketAxis??'y';
    const socket=selectHeldItemSocket(captureSimulationAnimation(this,0,false),axis);
    if(socket)return{x:p.x+socket.x,y:p.y+socket.y,angle:socket.angle,length:socket.length};
    return{...computeHeldItemPosition(p,this.facing,this.id),angle:null,length:1};
  }
  getHeldItemWorldPosition(){
    const socket=this.getHeldItemSocket();
    return{x:socket.x,y:socket.y+(this.equippedItem?.definition.generated?.kind==='link-remote-bomb'?10:this.equippedItem?.definition.generated?.kind==='link-arrow'?15:0)};
  }
  /** Authored post-respawn Entry visual cue. Native Rebirth has not been
   * recovered; this cue never owns controls, kinetics or protection duration. */
  private advanceRespawnPresentation():void {
    if (!this.pikachuRespawnPresentation) return;
    const next=this.pikachuRespawnPresentation.framesElapsed+1;
    this.pikachuRespawnPresentation=next<(pikachuAuxiliaryBodyEndExclusive('entry')??0)
      ? {...this.pikachuRespawnPresentation,framesElapsed:next} : null;
  }
  /** The respawn coordinator's hook: wait, intangible, on the revival platform at the current (spawn) position. */
  beginRevivalPlatform():void {
    this.revivalPlatform={framesElapsed:0,x:this.body.position.x,y:this.body.position.y};
    this.setRespawnInvincibility(REVIVAL_DISMOUNT_INVINCIBILITY_MAX_FRAMES);
  }
  isOnRevivalPlatform():boolean { return this.revivalPlatform!==null; }
  /** True while the fighter keeps waiting this step (the step is consumed: no action, presentation clocks only). The
   * dismounting step grants the wait-scaled invincibility and then runs as an ordinary step with the same input. */
  private holdOnRevivalPlatform(input:CharacterInput):boolean {
    const platform=this.revivalPlatform;
    if (!platform || this.destroyed) return false;
    if (platform.framesElapsed < REVIVAL_PLATFORM_MAX_FRAMES && !isRevivalDismountInput(input)) {
      this.revivalPlatform={...platform,framesElapsed:platform.framesElapsed+1};
      this.advanceRespawnPresentation();
      // Standing on the platform: the wait (idle) clock runs as on a floor.
      this.syncObservedPresentation(true);
      return true;
    }
    this.revivalPlatform=null;
    this.setRespawnInvincibility(revivalDismountInvincibilityFrames(platform.framesElapsed));
    return false;
  }
  /** Pikachu only. DK stands (wait) on the revival platform: SmashWiki Revival platform, "After a KO, the character will simply
   * descend from the sky on the revival platform"; Entry is the intro "before the beginning of a match" (On-screen appearance),
   * and the engine has no match-start entrance phase. */
  beginPikachuRespawnPresentation():void {
    if(this.id==='pikachu')this.pikachuRespawnPresentation={framesElapsed:0,facing:this.facing};
  }
  getPikachuRespawnPresentationState(){return this.pikachuRespawnPresentation;}
  getFootstoolRecipientPresentationState() {return this.footstoolRecipient;}
  getPikachuFootstoolVisuals() {
    const fx=this.pikachuFootstoolVisual;
    return fx && !this.destroyed ? [{kind:'footstoolStep' as const,x:fx.x,y:fx.y,age:fx.age}] : [];
  }
  getPikachuSurfaceTechPresentationState(){return this.id==='pikachu'?pikachuSurfaceTechPresentation(this.surfaceTech):null;}
  private clearSurfaceTech():void {
    if(this.surfaceTechGravityRestore!==null){
      this.body.ignoreGravity=this.surfaceTechGravityRestore;
      this.surfaceTechGravityRestore=null;
    }
    this.surfaceTech=null;
  }
  private surfaceTechContact(){
    for(const pair of this.contactPairs.values()){
      const other=pair.bodyA===this.body?pair.bodyB:pair.bodyA;
      if(pair.isActive===false||pair.isSensor||this.body.isSensor||other.isSensor||other.collisionFilter?.mask===0||
         other.label!==PLATFORM_LABELS.solid||!pair.collision)continue;
      const vertices=this.body.vertices;
      if(!vertices?.length||!other.bounds)continue;
      const minX=Math.min(...vertices.map(v=>v.x)),maxX=Math.max(...vertices.map(v=>v.x));
      const minY=Math.min(...vertices.map(v=>v.y)),maxY=Math.max(...vertices.map(v=>v.y));
      if(maxX<other.bounds.min.x-.1||minX>other.bounds.max.x+.1||maxY<other.bounds.min.y-.1||minY>other.bounds.max.y+.1)continue;
      const sign=pair.bodyA===this.body?1:-1;
      const surface=classifySurfaceTechContact({x:pair.collision.normal.x*sign,y:pair.collision.normal.y*sign});
      if(surface)return surface;
    }
    return null;
  }
  getPikachuAuxiliaryAirPresentationState() { return this.pikachuAuxiliaryAir; }
  private pikachuWallBounceSurface(): {away:1|-1;wall:object}|null {
    for (const pair of this.contactPairs.values()) {
      const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
      if (pair.isSensor || other.isSensor || other.collisionFilter?.mask === 0 || other.label !== PLATFORM_LABELS.solid ||
          !pair.collision || Math.abs(pair.collision.normal.x) < .9) continue;
      // Reject a retained pair after geometric separation or stage removal.
      const vertices=this.body.vertices;
      if (vertices?.length && other.bounds) {
        const minX=Math.min(...vertices.map(v=>v.x)), maxX=Math.max(...vertices.map(v=>v.x));
        const minY=Math.min(...vertices.map(v=>v.y)), maxY=Math.max(...vertices.map(v=>v.y));
        if (maxX<other.bounds.min.x-.1 || minX>other.bounds.max.x+.1 ||
            maxY<other.bounds.min.y-.1 || minY>other.bounds.max.y+.1) continue;
      }
      return {away:other.position.x >= this.body.position.x ? -1 : 1,wall:other};
    }
    return null;
  }
  getPikachuGroundRecoveryPresentationState(): PikachuGroundRecovery | null { return this.pikachuGroundRecovery; }
  private beginPikachuGroundRecovery(sheet: PikachuGroundRecoverySheet): void {
    this.pikachuGroundRecovery = beginPikachuGroundRecovery(sheet, this.facing);
    this.jumpInputBufferFrames = 0;
    this.tapJumpBufferFrames = 0;
    this.offensiveActionBuffer = null;
    this.reactionPresentation = null;
    this.scene.matter.body.setVelocity(this.body, {x: 0, y: 0});
  }

  private startGetupRoll(dir: 1 | -1, origin = this.recoveryOrigin()): void {
    const forward = dir === this.facing;
    const sheet = origin === 'tech' ? forward ? 'tech_forward' : 'tech_back'
      : origin === 'face-down' ? forward ? 'getup_roll_face_down' : 'getup_roll_back_face_down'
      : forward ? 'getup_roll' : 'getup_roll_back';
    if (this.id === 'pikachu') { this.beginPikachuGroundRecovery(sheet); return; }
    this.beginGroundRecovery(sheet,origin==='tech'?GROUND_RECOVERY_ROWS.techRoll:getupRollRow(this.id,forward,origin==='face-down'),dir);
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

  /** Trip recovery shares the prone input route, with its own attack record. A soft trip (slip) opens the options
   * sooner (SLIP_OPTION_LOCK_FRAMES). */
  applyTrip(soft = false): void {
    if (!this.isGrounded() || this.isInvincible()) return;
    this.donkeykongTurnBrake=null;this.restoreSourcedGroundFriction();
    this.attackClankRemaining = 0;
    this.attackClankLockedStep = false;
    this.cancelAttack();
    this.tripped = true;
    this.tripOptionLockFrames = soft ? SLIP_OPTION_LOCK_FRAMES : TRIP_OPTION_LOCK_FRAMES;
    this.reactionPresentation = null;
    this.recoveryReaction = null;
    this.pikachuGroundRecovery = null; this.groundRecovery=null;this.clearSurfaceTech();
    this.pendingFootstoolJump=false;this.pendingFootstoolPhantom=false;this.sourceLinkFootstoolPendingContact=null;this.donkeykongFootstoolPerformer=null;this.sourceLinkFootstool=null;this.footstoolRecipient=null;this.footstoolMini=null;this.pikachuFootstoolVisual=null;this.pikachuRespawnPresentation=null;this.clearItemAction();this.pikachuLedgeJump=null;
    this.knockdownRemaining = TRIP_KNOCKDOWN_FRAMES;
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
  }
  private knockdownTotalFrames(): number { return this.tripped ? TRIP_KNOCKDOWN_FRAMES : KNOCKDOWN_FRAMES; }

  /** Match-owned deterministic stream; omitted preserves legacy no-trip hits. */
  setTripRandomSource(source: (() => number) | null): void {
    this.tripRandomSource = source;
  }
  /** Direct-melee source rebound commitment, after its separately frozen hitlag. */
  applyAttackClank(hitlagFrames: number, reboundFrames: number): void {
    if (this.destroyed) return;
    const attack = this.activeAttack;
    this.attackClankReceiving = this.getActiveHurtboxes().map(hurtbox => ({ ...hurtbox }));
    this.attackClankInterrupted = attack ? { move: attack.move, framesElapsed: attack.framesElapsed,
      facing: attack.facing, chargeHeldFrames: attack.chargeHeldFrames } : null;
    this.cancelAttack();
    this.cooldownRemaining = 0;
    this.attackClankTotal = this.attackClankRemaining = reboundFrames;
    this.ordinaryPresentation = null;
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    this.armAttackerHitlag(hitlagFrames);
  }
  getAttackClankPresentationState() {
    return this.attackClankRemaining > 0 || this.attackClankLockedStep
      ? { totalFrames: this.attackClankTotal,
        phase: this.hitlagRemaining > 0 ? 'freeze' as const : 'rebound' as const,
        framesElapsed: Math.max(0, this.attackClankTotal - this.attackClankRemaining - 1), facing: this.facing,
        interruptedAttack: this.attackClankInterrupted ? { ...this.attackClankInterrupted } : null } : null;
  }

  protected sourceRecoveryAttack(lineage:string):AttackMove|undefined {return this.attacks.get(lineage);}
  private startGetupAttack(): void {
    this.recoveryReaction = { origin: this.recoveryOrigin(), facing: this.facing };
    this.reactionPresentation = null;
    const native = this.sourceRecoveryAttack(`${this.id}.${this.tripped ? 'tripAttack' : this.knockdownFaceDown ? 'getupAttackFaceDown' : 'getupAttack'}`);
    if (native) {
      if (!(native as AttackMoveWithAnimation).hurtboxModifiers?.length && !native.protectionWindows?.length)
        this.setInvincibility(native.startupFrames + native.activeFrames);
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
      this.activeAttack = { move: native, facing: this.facing, framesElapsed: 0, hitboxBody: null, upSpecial: null, chargeHeldFrames: null };
      this.tripped = false;
      return;
    }
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
      this.scene,
      { id: this.id, position: this.body.position, bodyId: this.body.id },
      getupMove,
      this.facing,
    );
    this.transientHitboxes.push({ body, framesRemaining: p.activeFrames });
    // Legacy transient attack has no body commitment clock: expose its entry only.
    this.reactionCue = { kind: 'getup-attack', origin: this.recoveryReaction.origin,
      framesElapsed: 0, facing: this.facing, moveId: getupMove.id };
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
      this.scene,
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
        despawnHitbox(this.scene, h.body);
      } else {
        survivors.push(h);
      }
    }
    this.transientHitboxes = survivors;
  }

  /** Despawn attack-owned transient hitboxes on interruption or teardown. */
  private clearTransientHitboxes(): void {
    for (const h of this.transientHitboxes) {
      despawnHitbox(this.scene, h.body);
    }
    this.transientHitboxes = [];
  }

  /** Placed objects survive action interruption, but not a stock/round reset. */
  private clearPlacedTraps(): void {
    for (const t of this.activeTraps) {
      if (t.body !== null) despawnHitbox(this.scene, t.body);
    }
    this.activeTraps = [];
  }

  /**
   * Resolve a `trap` down-special into its placement spec, or `null`.
   * Pure.
   */
  private resolveTrapSpec(move: AttackMove): DownSpecialTrapSpec | null {
    const m = move as unknown as {
      type?: string;
      downSpecialKind?: string;
      trap?: DownSpecialTrapSpec;
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
    spec: DownSpecialTrapSpec,
    facing: 1 | -1,
    moveId: string,
  ): void {
    // FIFO: drop the oldest placed trap when at capacity.
    while (this.activeTraps.length >= Math.max(1, spec.maxActiveTraps)) {
      const oldest = this.activeTraps.shift();
      if (oldest && oldest.body !== null) {
        despawnHitbox(this.scene, oldest.body);
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
      objectId: this.nextTrapObjectId++,
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
      vy: 0,
      landed: false,
      fused,
      selfBounceVelocity:
        fused && typeof spec.selfBounceVelocity === 'number'
          ? spec.selfBounceVelocity
          : null,
      detonated: false,
      vx: facing * (spec.throwSpeedX ?? 0),
      launchAwayFromSource: spec.launchAwayFromSource,
      hitlagMultiplier: spec.hitlagMultiplier,
      sdiMultiplier: spec.sdiMultiplier,
    });
    this.activeTraps[this.activeTraps.length - 1]!.vy = spec.throwSpeedY ?? 0;
  }

  /**
   * Highest platform top surface strictly below `fromY` whose horizontal span
   * contains `x`, or null if a falling trap at `x` is over a gap. Derived from
   * the live `ledgeCandidates` (each platform contributes a left + right ledge
   * corner at the same top `y`); pairing them by `platformId` recovers the
   * platform's `[leftX, rightX]` span and top surface. Deterministic — reads
   * only the frozen candidate snapshot.
   */
  private trapSurfaceYBelow(x: number, fromY: number): number | null {
    const byPlatform = new Map<string, { left?: number; right?: number; y: number }>();
    for (const c of this.ledgeCandidates) {
      const e = byPlatform.get(c.platformId) ?? { y: c.y };
      if (c.side === 'left') e.left = c.x;
      else e.right = c.x;
      e.y = c.y;
      byPlatform.set(c.platformId, e);
    }
    let best: number | null = null;
    for (const e of byPlatform.values()) {
      if (e.left === undefined || e.right === undefined) continue;
      const lo = Math.min(e.left, e.right);
      const hi = Math.max(e.left, e.right);
      if (x < lo || x > hi) continue;
      if (e.y < fromY) continue; // surface must be at/below the trap (screen-down +)
      if (best === null || e.y < best) best = e.y;
    }
    return best;
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
      // Physics: an unlanded trap falls under gravity until it rests on the
      // first platform surface below it (spawned objects obey physics by
      // default). Only integrate while it has no live body yet — once it has
      // armed/detonated its position is fixed at the blast point.
      if (!t.landed && t.body === null) {
        t.x += t.vx;
        t.vy = Math.min(TRAP_MAX_FALL, t.vy + TRAP_GRAVITY);
        const nextY = t.y + t.vy;
        const objectHalfHeight = t.height / 2;
        const surf = this.trapSurfaceYBelow(t.x, t.y);
        if (surf !== null && t.vy >= 0 && nextY + objectHalfHeight >= surf) {
          t.y = surf - objectHalfHeight;
          t.vy = 0;
          t.landed = true;
        } else {
          t.y = nextY;
        }
      } else if (t.landed && t.body === null && t.vx !== 0) {
        t.x += t.vx;
        t.vx *= 0.94;
        if (Math.abs(t.vx) < 0.1) t.vx = 0;
        const surface = this.trapSurfaceYBelow(t.x, t.y);
        if (surface === null || surface > t.y + t.height / 2 + 2) t.landed = false;
      }
      if (t.framesSinceSpawn >= t.armDelay) this.armTrap(t);
      if (t.framesSinceSpawn >= t.lifetime) {
        if (t.body !== null) despawnHitbox(this.scene, t.body);
      } else {
        survivors.push(t);
      }
    }
    this.activeTraps = survivors;
  }

  /** Spawn a placed object's damage sensor once, on its actual active step. */
  private armTrap(t: Character['activeTraps'][number]): void {
    if (t.body !== null) return;
    const trapMove = {
      id: `${t.moveId}.trap`,
      type: 'downSpecial',
      damage: t.damage,
      knockback: t.knockback,
      launchAwayFromSource: t.launchAwayFromSource,
      hitlagMultiplier: t.hitlagMultiplier,
      sdiMultiplier: t.sdiMultiplier,
      hitbox: { offsetX: 0, offsetY: 0, width: t.width, height: t.height },
      startupFrames: 0, activeFrames: 1, recoveryFrames: 0, cooldownFrames: 0,
    } as unknown as AttackMove;
    t.body = spawnHitbox(
      this.scene,
      { id: this.id, position: { x: t.x, y: t.y }, bodyId: this.body.id },
      trapMove,
      t.facing,
    );
    t.body.plugin ??= {};
    t.body.plugin.attackInstance = {};
    t.body.plugin.staleMoveId = t.moveId;
    const overlapsOwner = Math.abs(this.body.position.x - t.x) <= (t.width + this.tuning.width) / 2
      && Math.abs(this.body.position.y - t.y) <= (t.height + this.tuning.height) / 2;
    if (t.fused && !t.detonated) {
      t.detonated = true;
      if (t.selfBounceVelocity !== null && overlapsOwner) {
        this.clearReferenceLaunch();
        this.scene.matter.body.setVelocity(this.body, {
          x: this.body.velocity.x, y: t.selfBounceVelocity,
        });
      }
    }
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
    hitlagMultiplierPerHit?: ReadonlyArray<number>;
    sdiMultiplierPerHit?: ReadonlyArray<number>;
    activeFramesPerHit?: ReadonlyArray<number>;
    collisionHitsPerHit?: ReadonlyArray<readonly import('./attacks').AttackCollisionHit[]>;
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
        hitFrames?: ReadonlyArray<number>;
        damagePerHit?: ReadonlyArray<number>;
        knockbackPerHit?: ReadonlyArray<AttackMove['knockback']>;
        hitlagMultiplierPerHit?: ReadonlyArray<number>;
        sdiMultiplierPerHit?: ReadonlyArray<number>;
        activeFramesPerHit?: ReadonlyArray<number>;
        collisionHitsPerHit?: ReadonlyArray<readonly import('./attacks').AttackCollisionHit[]>;
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
        frames.push(s.hitFrames?.[i] ?? i * s.hitInterval);
        const isLauncher = i === s.hitCount - 1;
        damagePerHit.push(s.damagePerHit?.[i] ?? (isLauncher ? s.launcherDamage : s.linkDamage));
        knockbackPerHit.push(s.knockbackPerHit?.[i] ?? (isLauncher ? s.launcherKnockback : s.linkKnockback));
      }
      return { moveId: m.id, frames, damagePerHit, knockbackPerHit, hitbox: m.hitbox,
        hitlagMultiplierPerHit: s.hitlagMultiplierPerHit, sdiMultiplierPerHit: s.sdiMultiplierPerHit,
        activeFramesPerHit: s.activeFramesPerHit, collisionHitsPerHit: s.collisionHitsPerHit };
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
      hitlagMultiplierPerHit?: ReadonlyArray<number>;
      sdiMultiplierPerHit?: ReadonlyArray<number>;
      activeFramesPerHit?: ReadonlyArray<number>;
    collisionHitsPerHit?: ReadonlyArray<readonly import('./attacks').AttackCollisionHit[]>;
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
      hitlagMultiplier: view.hitlagMultiplierPerHit?.[idx],
      sdiMultiplier: view.sdiMultiplierPerHit?.[idx],
      hitbox: view.hitbox,
      collisionHits: view.collisionHitsPerHit?.[idx],
      startupFrames: 0,
      activeFrames: 1,
      recoveryFrames: 0,
      cooldownFrames: 0,
    } as unknown as AttackMove;
    const body = spawnHitbox(
      this.scene,
      { id: this.id, position: this.body.position, bodyId: this.body.id },
      rungMove,
      facing,
    );
    const active = this.activeAttack;
    if (active) {
      let identity = this.attackHitGroups.get(active);
      if (!identity) { identity = new Map(); this.attackHitGroups.set(active, identity); }
      body.plugin ??= {};
      body.plugin.attackInstance = identity;
      body.plugin.staleMoveId = view.moveId;
    }
    this.transientHitboxes.push({ body, framesRemaining: view.activeFramesPerHit?.[idx] ?? MULTIHIT_RUNG_FRAMES });
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
    if (move.entryVelocityScale) return null;
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
      this.clearReferenceLaunch();
      this.scene.matter.body.setVelocity(this.body, {
        x: a.facing * dash.dashSpeed,
        y: 0,
      });
    }
    if (a.hitboxBody !== null) {
      updateHitboxPosition(
        this.scene,
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

  /** Resolve a `'shockwave'` down special's spec, or `null` for any other move. */
  private resolveShockwaveSpec(move: AttackMove): DownSpecialShockwaveSpec | null {
    const m = move as unknown as {
      type?: string;
      downSpecialKind?: string;
      shockwave?: DownSpecialShockwaveSpec;
    };
    if (m.type !== 'downSpecial' || m.downSpecialKind !== 'shockwave' || !m.shockwave) return null;
    return m.shockwave;
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
      this.scene,
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
   */
  protected executeJab(resolvedId: string | null): boolean {
    return resolvedId !== null ? this.attemptAttack(resolvedId) : false;
  }

  /**
   * Hook — fire this fighter's tilt. Default delegates to the resolved
   * id (which already cascaded `tilt → jab → default` inside the
   * dispatcher for partial movesets).
   */
  protected executeTilt(resolvedId: string | null): boolean {
    return resolvedId !== null ? this.attemptAttack(resolvedId) : false;
  }

  /** Hook — fire this fighter's smash. */
  protected executeSmash(resolvedId: string | null): boolean {
    return resolvedId !== null ? this.attemptAttack(resolvedId) : false;
  }

  /**
   * Hook — fire this fighter's forward aerial. Default delegates to
   * the resolved id (which already cascaded
   * `fair → neutral → legacy aerial → light → default` for partial
   * movesets).
   */
  protected executeFair(resolvedId: string | null): boolean {
    return resolvedId !== null ? this.attemptAttack(resolvedId) : false;
  }

  /**
   * Hook — fire this fighter's neutral special. Default consults the
   * `neutralSpecialId` slot directly (the slot is auto-filled by the
   * per-fighter slot-wiring helper for any `'special'`-typed move).
   */
  protected executeNeutralSpecial(): boolean {
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
    return this.attemptUpSpecial(stickX, stickY);
  }

  /**
   * Hook — fire this fighter's down special. Default consults the
   * `downSpecialId` slot directly (auto-filled by the per-fighter
   * slot-wiring helper for any `'downSpecial'`-typed move).
   */
  protected executeDownSpecial(): boolean {
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
  private readonly attackHitGroups = new WeakMap<object, Map<string, object>>();
  private readonly aerialReboundFrames = new WeakMap<object, number>();
  private readonly pendingAerialReboundSpeeds = new WeakMap<object, number>();

  private tickAttack(
    attackHeld: boolean,
    heavyHeld: boolean,
    grounded: boolean,
    moveX: number,
    prevFacing: 1 | -1,
    specialHeld: boolean = false,
    downHeld: boolean = false,
    upHeld: boolean = false,
    shieldHeld: boolean = false,
    attackMoveY: number = 0,
    forcedPress: 'attack' | 'heavy' | 'special' | null = null,
    allowBufferedFollowUp: boolean = false,
    attackFromStick: boolean = false,
  ): void {
    if(this.donkeykongPunchFireFrame===this.simulationInputFrame)return;
    // The call where a move ends *arms* the cooldown but does not also
    // drain it — otherwise the cooldown would read `cooldownFrames - 1`
    // immediately after the move's last frame, which is harder to
    // reason about and makes "after totalBusy frames, cooldown reads
    // cooldownFrames" a non-truth.
    let attackJustEnded = false;

    // Expire any transient hitboxes (dive landing shockwaves) — lifecycle
    // is independent of the active attack, so it ticks every frame.
    this.tickTransientHitboxes();
    // A shooting item's fire session runs beside the body (itemShooting.ts).
    if (this.itemShooting) this.advanceItemShooting(attackHeld);
    // ---- Step 1: advance the in-flight attack -----------------------------
    if (this.activeAttack?.move.pikachuSpecial) {
      this.getPikachuSpecialRuntime().tick(this.activeAttack, this.pikachuSpecialStick,
        this.pikachuSpecialHeld, pikachuSpecialContact);
    } else if (this.activeAttack) {
      const a = this.activeAttack;
      const startingLandingAttack = a === this.landingAttackInstance && this.landingAttackActivationPending;
      this.landingAttackActivationPending = false;
      const prevPhase = startingLandingAttack ? 'startup' : Character.phaseFor(a.framesElapsed, a.move);

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
              this.scene,
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

      if (!holdDiveActive && !startingLandingAttack) {
        if (a.holdInitialFrame) a.holdInitialFrame = false;
        else a.framesElapsed += 1;
      }
      // Shockwave mash-repeat: at the loop point, a queued press rewinds the
      // timeline so the authored hit windows fire again (Hand Slap loop).
      const shockwaveSpec = this.resolveShockwaveSpec(a.move);
      const repeatRule = shockwaveSpec?.repeat;
      if (repeatRule && this.shockwaveRepeat !== null && this.shockwaveRepeat.moveId === a.move.id
        && this.shockwaveRepeat.queued > 0 && a.framesElapsed === repeatRule.loopFrame
        && (repeatRule.maxRepeats === undefined || this.shockwaveRepeat.repeats < repeatRule.maxRepeats)) {
        if (a.hitboxBody !== null) {
          despawnHitbox(this.scene, a.hitboxBody);
          a.hitboxBody = null;
        }
        a.framesElapsed = repeatRule.entryFrame;
        this.shockwaveRepeat = { ...this.shockwaveRepeat, queued: this.shockwaveRepeat.queued - 1,
          repeats: this.shockwaveRepeat.repeats + 1 };
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
        (a.move as { chargedProjectile?: unknown }).chargedProjectile !== undefined
        || (a.move as { specialKind?: string }).specialKind === 'projectile'
        || (a.move as { sideSpecialKind?: string }).sideSpecialKind === 'boomerang';
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
      // A held item's shot on the use's first active frame, while the item has ammo (Star Rod star).
      if (prevPhase === 'startup' && newPhase === 'active' && a.move.itemShot && this.equippedItem?.spendShot())
        this.queueItemShot(a.move.itemShot, a.facing);
      const rebound = a.move.type === 'aerial' ? (a.move as AerialMove).rebound : undefined;
      const reboundFrame = this.aerialReboundFrames.get(a);
      const returning = rebound !== undefined && reboundFrame !== undefined;
      const awaitingReturn = returning && a.framesElapsed - reboundFrame < rebound.rehitFrames;
      const windowIndex = returning ? -2 : attackHitWindowIndex(a.move, a.framesElapsed);
      const hitWindow = a.move.hitWindows?.[windowIndex];
      if (a.move.hitWindows && a.hitboxBody !== null
        && a.hitboxBody.plugin.hitWindowIndex !== windowIndex) {
        despawnHitbox(this.scene, a.hitboxBody);
        a.hitboxBody = null;
      }
      if (
        (returning ? !awaitingReturn : a.move.hitWindows ? hitWindow !== undefined : prevPhase === 'startup') &&
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
        const baseSpawnMove =
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
        const spawnMove = returning && rebound.returnHit
          ? { ...baseSpawnMove, ...rebound.returnHit, groundedKnockback: undefined }
          : hitWindow ? resolveAttackHitWindow(a.move, baseSpawnMove, hitWindow) : baseSpawnMove;
        const hitFacing = (a.facing * (hitWindow?.facing ?? 1)) as 1 | -1;
        a.hitboxBody = spawnHitbox(
          this.scene,
          { id: this.id, position: this.body.position, bodyId: this.body.id },
          spawnMove,
          hitFacing,
        );
        if (hitWindow || (a.move.type === 'aerial' && (a.move as AerialMove).rebound)) {
          let groups = this.attackHitGroups.get(a);
          if (!groups) { groups = new Map(); this.attackHitGroups.set(a, groups); }
          const name = returning ? `rebound:${reboundFrame}` : hitWindow?.group ?? String(windowIndex);
          let identity = groups.get(name);
          if (!identity) { identity = {}; groups.set(name, identity); }
          // Assign after Matter's factory: its options cloning must not clone
          // the identity shared by the early and late replacement sensors.
          a.hitboxBody.plugin ??= {};
          a.hitboxBody.plugin.hitGroup = identity;
          a.hitboxBody.plugin.attackInstance = groups;
          a.hitboxBody.plugin.hitWindowIndex = windowIndex;
        } else {
          // A single-sensor swing can also hit several opponents. Give it one
          // identity so MatchScene snapshots staleness once for the whole swing;
          // the next jab stage or fresh attack receives a new identity.
          a.hitboxBody.plugin ??= {};
          a.hitboxBody.plugin.attackInstance = {};
        }

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
        if (attackSfxKey !== null && (!hitWindow || windowIndex === 0
          || (hitWindow.group ?? String(windowIndex))
            !== (a.move.hitWindows?.[windowIndex - 1]?.group ?? String(windowIndex - 1)))) {
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

      // Sampled before collision callbacks can freeze the attacker. Read by
      // the airborne velocity carry and by every angle-367 autolink hit,
      // which retains the attacker's motion (referenceAutolink.ts); without
      // it a falling fair pulls its victim up while Link keeps falling and
      // the second strike misses.
      if (a.hitboxBody?.plugin) {
        a.hitboxBody.plugin.attackerVelocity = { x: this.body.velocity.x, y: this.body.velocity.y };
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
          this.scene,
          a.hitboxBody,
          this.body.position,
          returning && rebound.returnHit ? { ...a.move, ...rebound.returnHit }
            : hitWindow ? resolveAttackHitWindow(a.move, a.move, hitWindow) : a.move,
          (a.facing * (hitWindow?.facing ?? 1)) as 1 | -1,
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
        despawnHitbox(this.scene, a.hitboxBody);
        a.hitboxBody = null;
      }

      // End of move — release the fighter and arm cooldown.
      if (newPhase === 'done') {
        // Defensive: if a hitbox somehow survived the despawn check
        // above (e.g. zero-active-frames move that jumped startup→done),
        // clean it up so we never leak a sensor.
        if (a.hitboxBody !== null) {
          despawnHitbox(this.scene, a.hitboxBody);
          a.hitboxBody = null;
        }
        this.cooldownRemaining = a.move.cooldownFrames;
        // A committal aerial special that ends in the AIR drops the fighter
        // into helpless free-fall (Owl's burst, an air dashStrike /
        // stallAndFall / commandDash). On the ground it just ends normally.
        if (this.movesetEndsHelpless(a.move) && !this.isGrounded()) {
          this.helpless = true;
          this.specialFallLandingFrames = a.move.specialLandingLagFrames ?? null;
        }
        if(this.id==='donkeykong'){
          this.donkeykongLastAttackEndFrame=this.simulationInputFrame;
        }
        this.donkeykongJabContinuation=this.id==='donkeykong'&&this.donkeykongJabContinuationEligibleStep
          ?retainDonkeyKongJabContinuation(a.move,a,a.facing,this.positionResetGeneration,this.simulationInputFrame):null;
        this.activeAttack = null;
        attackJustEnded = true;
      }
    }

    // ---- Step 2: rising-edge press (Sub-AC 3.3 + AC 60102 Sub-AC 2 -------
    // ----                            directional aerial dispatch) --------
    // Pick a move id based on which button rose this frame and the
    // fighter's grounded state. Heavy press takes priority on the
    // ground; in the air, `attack` and heavy both resolve to a
    // direction-aware aerial slot (heavy = Ultimate's C-stick aerial).
    //
    // Direction classification (airborne press):
    //
    //   |moveX| < AERIAL_STICK_THRESHOLD  → neutral aerial (nair)
    //   sign(moveX) === prevFacing        → forward aerial (fair)
    //   sign(moveX) === -prevFacing       → back    aerial (bair)
    //
    // Cascading fallback per direction keeps single-aerial movesets
    // (legacy `WOLF_NAIR` registered alone) firing on any directional
    // press — the directional slots are empty so the resolver falls
    // through to `aerialAttackId`.
    const attackJustPressed =
      forcedPress === 'attack' || (attackHeld && !this.prevAttackHeld);
    const heavyJustPressed =
      forcedPress === 'heavy' || (heavyHeld && !this.prevHeavyHeld);
    // ---- Smash-charge state machine (hold to charge, release/cap to fire) ---
    // Mirrors the special-charge machine but for grounded smashes. While
    // charging it consumes the frame so every press path below is skipped;
    // on release (or hitting the cap, or leaving the ground) it fires the
    // smash scaled by the held frames. An authored continued-hold limit can
    // keep a fully powered smash held before its automatic release; legacy
    // profiles retain their power-cap release when no separate limit exists.
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
      } else if (triggerHeld && cs.holdFrame !== undefined
        && (cs.startupElapsed ?? 0) < cs.holdFrame) {
        cs.startupElapsed = (cs.startupElapsed ?? 0) + 1;
        smashConsumedThisFrame = true;
      } else if (
        triggerHeld &&
        this.activeAttack === null &&
        cs.framesHeld < (cs.maxHoldFrames ?? cs.maxFrames)
      ) {
        cs.framesHeld += 1;
        if (cs.holdFrame !== undefined && cs.framesHeld === (cs.maxHoldFrames ?? cs.maxFrames)) {
          this.chargingSmash = null;
          this.fireSmash(cs.moveId, cs.facing, cs.framesHeld, cs.holdFrame);
        }
        smashConsumedThisFrame = true;
      } else {
        // Released, or hit the cap — fire the smash (we are grounded here).
        const { moveId, facing, framesHeld } = cs;
        this.chargingSmash = null;
        this.fireSmash(moveId, facing, framesHeld, cs.holdFrame === undefined ? 0
          : Math.min(cs.holdFrame, (cs.startupElapsed ?? 0) + 1));
        smashConsumedThisFrame = true;
      }
    }
    // A queued press can enter an authored follow-up window before the
    // fighter is free to start an unrelated move. Consume only on success;
    // one early tap must never advance more than one stage.
    const neutralDkChainQueue=this.id!=='donkeykong'||!this.activeAttack||
      donkeyKongJabCanAdvance(this.activeAttack.move,this.activeAttack.framesElapsed)===null||
      (this.offensiveActionBuffer?.moveX===0&&this.offensiveActionBuffer.moveY===0);
    const queuedFollowUp = allowBufferedFollowUp&&neutralDkChainQueue
      ? this.offensiveActionBuffer?.kind
      : undefined;
    // ---- Jab-combo advance ------------------------------------------------
    // A re-press of attack DURING a chainable jab stage — once that stage's
    // hitbox has come out (framesElapsed past the advance window) — steps
    // the string to its next stage instead of being swallowed. Because the
    // advance leaves `activeAttack` non-null, the fresh-dispatch gate below
    // naturally skips a brand-new move this same frame. Single-jab rosters
    // (no `jabChain`) and every non-jab move short-circuit on `chain == null`.
    if (
      (attackJustPressed || queuedFollowUp === 'attack') &&
      grounded &&
      !smashConsumedThisFrame &&
      this.activeAttack !== null
    ) {
      const curMove = this.activeAttack.move as AttackMoveWithAnimation;
      const chain = curMove.jabChain;
      if (
        chain != null &&
        this.attacks.has(chain.nextId) &&
        this.canAdvanceJab(curMove,this.activeAttack.framesElapsed)
      ) {
        if (this.advanceChainedAttack(chain.nextId)) this.offensiveActionBuffer = null;
      }
    }
    // The source continuation window outlives jab1 commitment/actionability.
    // A fresh neutral edge may enter jab2 here; held F and an old late queue
    // cannot manufacture a second edge. No cooldown or active jab is retained.
    if(this.id==='donkeykong'&&this.donkeykongJabContinuationFreshAttackStep&&this.donkeykongJabContinuationEligibleStep&&
      !smashConsumedThisFrame&&this.canAttack()&&
      donkeyKongRetainedJabCanAdvance(this.donkeykongJabContinuation)){
      const continuation=this.donkeykongJabContinuation!;
      if(this.attemptAttack(continuation.move.jabChain!.nextId)){
        this.activeAttack!.facing=continuation.entryFacing;this.facing=continuation.entryFacing;
        this.offensiveActionBuffer=null;
      }
    }
    if (grounded && (attackJustPressed || heavyJustPressed ||
      queuedFollowUp === 'attack' || queuedFollowUp === 'heavy')
      && !smashConsumedThisFrame && this.activeAttack) {
      const follow = (this.activeAttack.move as AttackMoveWithAnimation).followUp;
      if (follow && this.activeAttack.framesElapsed >= follow.windowStart
        && this.activeAttack.framesElapsed < follow.windowEnd) {
        if (this.advanceChainedAttack(follow.nextId, true)) this.offensiveActionBuffer = null;
      }
    }
    if (
      this.canAttack() &&
      !smashConsumedThisFrame &&
      !this.chargingSpecial?.groundedUpSpecial
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
            moveY: this.tiltAttackId && this.attacks.get(this.tiltAttackId)?.angledVariants
              && Math.abs(moveX) >= 0.3 && Math.abs(attackMoveY) === Math.abs(moveX) ? attackMoveY * 0.9 : attackMoveY,
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
        // above; an airborne heavy press fires the aerial for its
        // direction, exactly like an `attack` press.
        //
        // Delegate the airborne classification to the pure helper so
        // the runtime, the AI's input synthesiser, the (later AC)
        // input-rebinding screen, and the replay drift verifier all
        // read from a single source of truth. The helper applies the
        // aerial gate (`airborne === false ⇒ null`), classifies
        // direction relative to *prevFacing*, and cascades
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
      // A held item replaces the classified press with its use; presses it
      // does not map keep the fighter's own move (resolveItemInput).
      // A held item decides the classified press (resolveItemInput): its use replaces the move,
      // a smash input is a smash throw through the shared item planner, anything else stays native.
      const itemPattern = grounded ? groundedPattern : aerialDirection === 'neutral' ? 'nair' : 'aerial';
      const itemDecision = pickedId !== null && itemPattern !== null && this.equippedItem
        ? resolveItemInput(itemPattern, itemUsesFor(this.equippedItem.definition, this.id), this.equippedItem.canUse(),
          moveX * prevFacing < 0, this.equippedItem.definition.shooting !== undefined) : null;
      if (itemDecision?.kind === 'smash-throw') {
        const facing = prevFacing as 1 | -1;
        if (this.beginItemAction(`throw-ground-${itemDecision.direction}-strong`, this.simulationInputFrame, facing)) pickedId = null;
      }
      // A shooting item fires (its session starts and runs its first step now); an empty one is thrown forward.
      // Ground locomotion has already resolved this step's turn. Only aerial
      // input classification needs the pre-step facing; a new ground shot
      // must not turn the holder back to that stale orientation.
      const shootingFacing = grounded ? this.facing : prevFacing;
      if (itemDecision?.kind === 'fire') {
        const spec = this.equippedItem!.definition.shooting!, facing = shootingFacing;
        this.facing = facing;
        this.itemShooting = { spec, state: startShooting(spec, facing) };
        this.advanceItemShooting(attackHeld);
        pickedId = null;
      } else if (itemDecision?.kind === 'empty-throw') {
        this.beginItemAction(`throw-${grounded ? 'ground' : 'air'}-forward-ordinary`, this.simulationInputFrame, shootingFacing);
        pickedId = null;
      }
      const itemMove = itemDecision?.kind === 'use' ? itemDecision.move : null;
      if (itemMove) pickedId = itemMove.id;
      if (pickedId !== null && itemDecision?.kind !== 'smash-throw') {
        // The fighter keeps the orientation used to select this aerial;
        // back-air mirrors its hitbox behind that orientation separately.
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
            groundedPattern === 'dsmash')
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
              ...(sc.charge.maxHoldFrames === undefined ? {} : { maxHoldFrames: sc.charge.maxHoldFrames }),
              ...((this.attacks.get(pickedId) as AttackMoveWithAnimation).chargeStartFrame === undefined ? {} : {
                startupElapsed: 0,
                holdFrame: (this.attacks.get(pickedId) as AttackMoveWithAnimation).chargeStartFrame,
              }),
            };
            smashChargeStarted = true;
          }
        }
        // An item use runs its own move; otherwise the slot hook fires the fighter's.
        const fire = (native: () => boolean): boolean => itemMove ? this.attemptAttack(itemMove.id) : native();
        let started: boolean;
        if (smashChargeStarted) {
          // Charging — no move has fired yet this frame.
          started = false;
        } else if (grounded && groundedPattern !== null) {
          switch (groundedPattern) {
            case 'jab':
              started = fire(() => this.executeJab(pickedId));
              break;
            case 'tilt':
              started = fire(() => this.executeTilt(pickedId));
              if (started && this.activeAttack?.move.angledVariants && Math.abs(attackMoveY) >= 0.3) {
                this.activeAttack.move = attackMoveY < 0 ? this.activeAttack.move.angledVariants.up : this.activeAttack.move.angledVariants.down;
              }
              break;
            case 'smash':
              // An instant smash fires toward `this.facing`, which the left
              // stick's locomotion turned; a right-stick smash aims itself.
              if (attackFromStick && Math.abs(moveX) >= 0.3) {
                this.facing = Math.sign(moveX) as 1 | -1;
              }
              started = fire(() => this.executeSmash(pickedId));
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
          started = fire(() => this.executeFair(pickedId));
        } else {
          // Airborne neutral / back press, or any path that did not
          // produce a pattern (defensive fallback): drive the legacy
          // dispatch directly. nair / bair are not part of the
          // 10-slot uniform contract Sub-AC 2.1 migrates.
          started = this.attemptAttack(pickedId);
        }
        // Existing back-aerials author positive offsets and reverse their
        // hitbox basis here. Source-projected moves with geometryFacing:'fighter'
        // already put contacts behind the fighter, so retain that basis.
        // The legacy hitbox geometry is authored facing-right
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
        if (itemMove && (started || smashChargeStarted)) this.equippedItem!.noteUse(this.simulationInputFrame, this.getPosition());
        if (started && aerialDirection === 'back' && !itemMove) {
          const just = this.getActiveAttack();
          if (just !== null && this.activeAttack !== null
            && (just.move as AerialMove).geometryFacing !== 'fighter') {
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
    let specialConsumedByCharge = this.donkeykongPunchConsumedFrame===this.simulationInputFrame || this.chargingSpecial?.donkeykongPunch!==undefined;
    if (this.chargingSpecial?.groundedUpSpecial) {
      const cs = this.chargingSpecial;
      const spin = cs.groundedUpSpecial!;
      specialConsumedByCharge = true;
      this.tapJumpBufferFrames = 0;
      this.jumpInputBufferFrames = 0;
      this.offensiveActionBuffer = null;
      if (!grounded) {
        // A disappearing support cancels the grounded hold; it cannot
        // create a charged ground hitbox in the air or restore recovery.
        this.chargingSpecial = null;
      } else {
        const atHold = spin.startupElapsed >= spin.holdFrame;
        if (!atHold) spin.startupElapsed += 1;
        else if (specialHeld && cs.framesHeld < cs.maxFrames) cs.framesHeld += 1;
        if (!specialHeld || cs.framesHeld >= cs.maxFrames) {
          this.chargingSpecial = null;
          this.facing = spin.facing;
          this.activeAttack = { move: spin.move, facing: spin.facing,
            framesElapsed: spin.startupElapsed, hitboxBody: null, upSpecial: null,
            chargeHeldFrames: cs.framesHeld };
        }
      }
    } else if (this.chargingSpecial !== null && !this.chargingSpecial.donkeykongPunch) {
      const cs = this.chargingSpecial;
      const chargeRules = this.neutralChargeMove();
      // Samus charge-cancel: a rising-edge SHIELD press while charging
      // BANKS the accumulated charge and exits the charge WITHOUT firing.
      // The bank persists across actions until fired or wiped (mid-charge
      // hit / respawn). This is what makes the charge feel "kept".
      const shieldStore = shieldHeld && !this.prevShieldHeld;
      if (cs.entryRemaining && cs.entryRemaining > 0) {
        cs.entryRemaining -= 1;
        specialConsumedByCharge = true;
      } else if (shieldStore) {
        this.storedSpecialCharge = chargeRules?.storeCharge !== false ? {
          moveId: cs.moveId,
          framesHeld: cs.framesHeld,
        } : null;
        this.chargingSpecial = null;
        this.cooldownRemaining = Math.max(this.cooldownRemaining, chargeRules?.charge.cancelFrames ?? 0);
        // Do NOT consume the special button — the player may still be
        // holding it; the rising-edge dispatch below won't refire (the
        // press already happened) and the shield raises normally.
      } else if (
        specialHeld &&
        this.activeAttack === null &&
        (this.isGrounded() || chargeRules?.airCharge) &&
        !(chargeRules?.autoFire && cs.framesHeld >= cs.maxFrames)
      ) {
        // Continue in the locations allowed by this move. Bankable shots
        // remain held at the cap; auto-fire shots release on the next step.
        if (cs.framesHeld < cs.maxFrames) cs.framesHeld += 1;
        specialConsumedByCharge = true;
      } else {
        // Release, auto-fire, or leaving the move's allowed charging state.
        const held = cs.framesHeld;
        const moveId = cs.moveId;
        this.chargingSpecial = null;
        this.storedSpecialCharge = null;
        this.fireNeutralChargeSpecial(moveId, held);
        specialConsumedByCharge = true;
      }
    }

    const specialJustPressed =
      forcedPress === 'special' || (specialHeld && !this.prevSpecialHeld);
    // A special press during a shockwave down special's repeat window queues
    // one more loop, or two from `doubleRepeatFrom` (grounded only); presses do
    // not stack beyond that. The move itself keeps running.
    if (specialJustPressed && !specialConsumedByCharge && this.activeAttack !== null
      && this.shockwaveRepeat !== null && this.shockwaveRepeat.moveId === this.activeAttack.move.id) {
      const rule = this.resolveShockwaveSpec(this.activeAttack.move)?.repeat;
      const f = this.activeAttack.framesElapsed;
      if (rule && this.isGrounded() && f >= rule.windowStart && f < rule.windowEnd
        && (rule.maxRepeats === undefined || this.shockwaveRepeat.repeats < rule.maxRepeats)) {
        const loops = rule.doubleRepeatFrom !== undefined && f >= rule.doubleRepeatFrom ? 2 : 1;
        this.shockwaveRepeat = { ...this.shockwaveRepeat, queued: Math.max(this.shockwaveRepeat.queued, loops) };
      }
    }
    if (
      !specialConsumedByCharge &&
      specialJustPressed &&
      this.canAttack()
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
          } else if (this.isGrounded() || chargeMove.airCharge) {
            // Start or resume in this move's allowed charging state.
            this.chargingSpecial = {
              moveId: chargeMove.id,
              framesHeld: banked?.framesHeld ?? 0,
              maxFrames,
              ...(chargeMove.charge.inputBehavior==='press-wind-fire'?{donkeykongPunch:{state:beginDonkeyKongPunch(banked?.framesHeld??0,{entryFrames:chargeMove.charge.entryFrames??7,maxChargeFrames:maxFrames,cancelFrames:chargeMove.charge.cancelFrames??4,airJumpCancelFrames:5,fullBankEndFrames:4}).state!,facing:this.facing,sourceGrounded:this.isGroundedForActionStart(),cancelInput:null}}:{entryRemaining:Math.max(0,(chargeMove.charge.entryFrames??0)-1)}),
            };
            this.clearTumbleForStartedAction();
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
      !this.landingRecovery &&
      this.activeAttack === null &&
      this.cooldownRemaining > 0
    ) {
      this.cooldownRemaining -= 1;
    }
    if (this.cooldownRemaining === 0) this.landingRecovery = false;
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
  registerLandedMove(moveId: string, shield = false): number {
    let occurrences = 0;
    for (const entry of this.staleMoveQueue) {
      if (entry.moveId === moveId) occurrences += 1;
    }
    this.staleMoveQueue.unshift({ moveId, shield });
    if (this.staleMoveQueue.length > STALE_QUEUE_SIZE) {
      this.staleMoveQueue.pop();
    }
    return occurrences;
  }

  /** Occurrences of `moveId` in the stale queue WITHOUT mutating it (HUD / tests / AI). */
  getStaleOccurrences(moveId: string): number {
    let occurrences = 0;
    for (const entry of this.staleMoveQueue) {
      if (entry.moveId === moveId) occurrences += 1;
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

  /** Install the match's damage-taken multiplier (1 outside a 1v1, items-off match). */
  setDamageTakenMultiplier(multiplier: number): void {
    this.damageTakenMultiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  }

  getDamageTakenMultiplier(): number {
    return this.damageTakenMultiplier;
  }

  /** Percent after taking `damage` from `percent`; positive damage is scaled by the damage-taken multiplier. */
  private percentAfterDamageTaken(percent: number, damage: number): number {
    return accumulateDamage(percent, damage > 0 ? damage * this.damageTakenMultiplier : damage);
  }

  /** Weighted newest-first history, including the reduced shield-contact penalty. */
  getStaleMultiplier(moveId: string): number {
    return computeStaleMultiplier(this.staleMoveQueue, moveId);
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
  addDamage(delta: number, captureSource: NonNullable<CapturePresentationState['event']['damageSource']> = 'external', combatAttackerSlotIndex?:number): number {
    if (this.destroyed) return this.damagePercent;
    const before = this.damagePercent;
    this.damagePercent = this.percentAfterDamageTaken(this.damagePercent, delta);
    this.noteCaptureDamage(this.damagePercent - before, captureSource);
    if(combatAttackerSlotIndex!==undefined&&this.damagePercent>before)this.combatPercentReceiptSink?.({
      damageApplied:this.damagePercent-before,attackerSlotIndex:combatAttackerSlotIndex,recoil:false,viaSceneResolver:false});
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
   *   • Saves the pre-freeze velocity once and restores it after the pause.
   *     Extending an existing freeze never captures the temporary zero.
   *   • Does NOT touch `pendingKnockback` — an incoming hit always owns
   *     freeze-end launch velocity instead.
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
    if (this.hitlagRemaining === 0 && this.pendingKnockback === null && !this.pikachuLedgeFlightHitlagRelease) {
      this.attackerHitlagVelocity = this.getVelocity();
    }
    if (frames > this.hitlagRemaining) {
      this.hitlagRemaining = frames;
    }
    this.hitlagPosition = { x: this.body.position.x, y: this.body.position.y };
  }

  /** Apply a body-attached aerial's rebound after confirmed contact and hitlag.
   * The attack identity prevents an old sensor or detached projectile from
   * bouncing a later move. Multiple targets on one simulation frame supply
   * one impulse; damage interruption retains priority over outgoing contact.
   */
  protected getSourceAerialReboundState(){const attack=this.activeAttack,frame=attack?this.aerialReboundFrames.get(attack):undefined;
    return attack&&frame!==undefined?{moveId:attack.move.id,frame,pendingSpeed:this.pendingAerialReboundSpeeds.get(attack)??null}:null;}
  applyAerialRebound(attackInstance: object | undefined, outcome: CharacterHitOutcome): boolean {
    const attack = this.activeAttack;
    if (this.destroyed || this.isGrounded() || this.hitstunRemaining > 0 ||
        this.pendingKnockback !== null || attack?.move.type !== 'aerial' || attack.hitboxBody === null ||
        (outcome !== 'landed' && outcome !== 'shielded') ||
        attackInstance === undefined || this.attackHitGroups.get(attack) !== attackInstance ||
        Character.phaseFor(attack.framesElapsed, attack.move) !== 'active') return false;
    const rebound = (attack.move as AerialMove).rebound;
    if (!rebound || (rebound.disableOnFastFall && this.fastFallLatched) ||
        this.aerialReboundFrames.get(attack) === attack.framesElapsed) return false;
    this.aerialReboundFrames.set(attack, attack.framesElapsed);
    // The rebound removes the entire hitbox until its return, including for
    // opponents other than the first target. Already reported collision pairs
    // on this impact step still share the original strike's hit identity.
    despawnHitbox(this.scene, attack.hitboxBody);
    attack.hitboxBody = null;
    this.fastFallLatched = false;
    this.jumpCutArmed = false;
    this.shortHopRising = false;
    this.airJumpRising = false;
    this.launchVelocity = null;
    this.referenceLaunch = null;
    if (this.attackerHitlagVelocity !== null) {
      this.attackerHitlagVelocity = { ...this.attackerHitlagVelocity, y: -rebound.upwardSpeed };
    } else {
      // collisionStart precedes Matter's solver, whose cached contact impulses
      // would otherwise change the authored bounce strength. The active attack
      // owns this one-step queue, so cancellation also abandons the impulse.
      this.pendingAerialReboundSpeeds.set(attack, rebound.upwardSpeed);
    }
    return true;
  }

  private commitAerialReboundAfterPhysics(): void {
    const attack = this.activeAttack;
    if (attack === null) return;
    const speed = this.pendingAerialReboundSpeeds.get(attack);
    if (speed === undefined) return;
    this.pendingAerialReboundSpeeds.delete(attack);
    if (this.hitstunRemaining > 0 || this.pendingKnockback !== null) return;
    if (this.attackerHitlagVelocity !== null) {
      // A second target can take damage after the first target blocks on this
      // same step. That newly armed hitlag must release the queued rebound.
      this.attackerHitlagVelocity = { ...this.attackerHitlagVelocity, y: -speed };
      return;
    }
    if (this.hitlagRemaining > 0) return;
    for (const pair of this.contactPairs.values()) {
      if (pair.isActive === false || pair.isSensor ||
          pair.bodyA.isSensor || pair.bodyB.isSensor || !pair.collision) continue;
      const direction = pair.bodyA === this.body ? 1 : -1;
      // Retain the solver's ceiling response instead of restoring upward
      // velocity into a solid surface above the fighter.
      if (pair.collision.normal.y * direction > 0.5) return;
    }
    this.scene.matter.body.setVelocity(this.body, { x: this.body.velocity.x, y: -speed });
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

  /** Release-edge shield protection; never armed by raising or forced shield loss. */
  isShieldParrying(): boolean {
    return this.shieldReleaseCanParry && this.shieldReleaseRemaining > 6 && this.isGrounded();
  }

  /** Successful parry removes GuardOff's remaining ordinary commitment. */
  consumeShieldParry(): void {
    this.shieldReleaseRemaining = 0;
    this.shieldReleaseCanParry = false;
    this.shieldParryBlockRemaining = 0;
  }

  getShieldReleaseRemaining(): number {
    return this.shieldReleaseRemaining;
  }

  /** True while the fighter is in TUMBLE (hard-launched; can tech on contact). */
  isTumbling(): boolean {
    return this.tumbling;
  }

  /** True while the fighter is in a KNOCKDOWN (prone, vulnerable, input-locked). */
  isKnockedDown(): boolean {
    return this.knockdownRemaining > 0;
  }
  isTripped(): boolean {
    return this.tripped && this.knockdownRemaining > 0;
  }

  /** True while a directional tech-roll / get-up-roll is sliding (intangible). */
  isGetupRolling(): boolean {
    // Getup rolls and tech rolls (tech_forward / tech_back); tech in place is not a roll.
    const roll=(sheet:string|undefined)=>sheet!==undefined&&/roll|^tech_(forward|back)$/.test(sheet);
    return roll(this.pikachuGroundRecovery?.sheet) || roll(this.groundRecovery?.sheet);
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
  /** Knockback-armor threshold of the throw in progress (until release), or null. */
  private getThrowKnockbackArmor(): number | null {
    const active = this.grabState.active;
    if (this.grabState.name !== 'throwing' || !active?.throwDirection || !this.grabSpec) return null;
    return getThrowByDirection(this.getCurrentThrowSet(), active.throwDirection).knockbackArmor ?? null;
  }

  /** Source true invincible contact is separate from legacy suppression. */
  isThrowInvincible(): boolean {
    if (this.throwReleaseInvincible) return true;
    const active = this.grabState.active;
    if (this.grabState.name !== 'throwing' || !active?.throwDirection || !this.grabSpec) return false;
    const throws = this.getCurrentThrowSet();
    const spec = getThrowByDirection(throws, active.throwDirection);
    return active.framesElapsed < (spec.invincibilityFrames ?? 0);
  }

  /** Whole-body capture protection; a single protected limb is insufficient.
   * Legacy whole-body dodge/ledge/grace counters remain separate from authored
   * capsule geometry, including reviewed sheets that replace the base body. */
  isCaptureProtected(): boolean {
    return this.finalSmashControl !== null || this.postReleaseGrabImmunity.remaining > 0 || this.isInvincible() || isAllHurtboxesIntangible(this.getActiveHurtboxes());
  }

  /** Whole-body states every hurtbox inherits: the revival platform, the shield-break pop
   * and a trip (slip / slip_down xlu 1..6, every fighter: intangible on trip frames 1-5). */
  private isWholeBodyIntangibleState():boolean {
    return this.revivalPlatform!==null||
      this.shieldBreak!==null&&shieldBreakProtection(this.shieldBreak,this.shieldBreakLastFiveSeconds).intangible||
      this.tripped&&this.knockdownRemaining>0&&TRIP_KNOCKDOWN_FRAMES-this.knockdownRemaining<=TRIP_FALL_INTANGIBLE_FRAMES;
  }
  private hasWholeSourceProtection():boolean {
    if(this.finalSmashControl?.intangible)return true;
    if(this.isWholeBodyIntangibleState())return true;
    if(this.surfaceTech&&surfaceTechProtected(this.surfaceTech))return true;
    if(this.groundRecovery&&this.groundRecovery.framesElapsed<this.groundRecovery.protectionFrames)return true;
    const active=this.activeAttack;if(!active)return false;
    // A ledge attack's regrab budget cuts its whole-body window too (getActiveHurtboxes applies the same cut).
    if(active.ledgeProtectionFrames!==undefined&&active.framesElapsed>=active.ledgeProtectionFrames)return false;
    const age=this.id==='donkeykong'?resolveDonkeyKongProtectionClock(active.move,active.framesElapsed).age:active.framesElapsed;
    return age!==null&&!!active.move.protectionWindows?.some(w=>w.startFrame<=age&&age<w.endFrame&&w.regions.includes('*'));
  }

  isInvincible(): boolean {
    return (
      this.hasWholeSourceProtection() ||
      (this.groundRecovery !== null && this.groundRecovery.framesElapsed < this.groundRecovery.protectionFrames) ||
      this.isThrowInvincible() ||
      this.invincibilityRemaining > 0 ||
      this.shieldParryProtected ||
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
  setInvincibility(frames: number, protection: 'legacy' | 'invincible' = 'legacy'): void {
    this.invincibilityRemaining = Math.max(0, Math.floor(frames));
    this.timerProtection = protection;
  }

  /** Dedicated respawn hook; source fighters may opt into true contact while
   * ordinary getup/tech counters and older fighters preserve legacy behavior. */
  setRespawnInvincibility(frames: number): void {
    this.setInvincibility(frames);
  }

  isSourceInvincible(): boolean {
    if(this.revivalPlatform)return false;
    return this.isThrowInvincible() || (this.timerProtection === 'invincible' && this.invincibilityRemaining > 0);
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
    const directThrowPresentation=hit.combatThrowRelease&&this.detailedHitApplicationDepth===0&&this.id==='link'?{groundedBefore:this.isGrounded(),damageBefore:this.damagePercent}:null;
    // Reset before every protection/early-return path; signals belong to this hit.
    this.lastDonkeyKongCarryHit = {};
    if (this.finalSmashControl?.role === 'captured' && hit.finalSmashRunId !== this.finalSmashControl.runId)
      return { vector: { x: 0, y: 0 }, magnitude: 0, angle: 0, hitstunFrames: 0 };
    if(this.hasWholeSourceProtection())return {vector:{x:0,y:0},magnitude:0,angle:0,hitstunFrames:0};
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
    if (this.activeAttack !== null && !(hit.finalSmashRunId !== undefined && hit.unblockable)) {
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
    if (this.invincibilityRemaining > 0 || this.shieldParryProtected) {
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

    // stallAndFall armor — while a down-special with `armorDuringFall: true`
    // is in its active window (stall or fall phase), the fighter is fully
    // intangible. Canonical example: Kirby stone form. Checked after
    // invincibility/dodge/ledge so those still take priority if stacked.
    if (this.isStallAndFallArmored()) {
      return { vector: { x: 0, y: 0 }, magnitude: 0, angle: 0, hitstunFrames: 0 };
    }

    // True throw invincibility leaves receiving overlap intact. The contact
    // consumer confirms/deduplicates it and freezes only the attacking body.
    if (this.isThrowInvincible())
      return { vector: { x: 0, y: 0 }, magnitude: 0, angle: 0, hitstunFrames: 0 };

    // Super armour (`AttackMove.armorWindows`): the hit connects — damage is
    // taken and the attacker freezes in hitlag — but the fighter is neither
    // launched, stunned nor interrupted, and a live charge is kept. Sourced
    // examples: Donkey Kong's Headbutt and full-charge Giant Punch.
    if (this.isSuperArmored() && hit.nativeForceReaction !== true) {
      const armoredPercentBefore = this.damagePercent;
      this.damagePercent = this.percentAfterDamageTaken(this.damagePercent, hit.damage);
      this.noteCaptureDamage(this.damagePercent - armoredPercentBefore, 'external');
      this.noteCombatPercentApplied(armoredPercentBefore,hit);
      this.armAttackerHitlag(computeHitlag({ damage: hit.damage, targetPercent: armoredPercentBefore,
        multiplier: hit.hitlagMultiplier, crouching: false, players: hit.hitlagPlayers,
        electricCollision: hit.electricCollision, projectile: hit.hitlagProjectile }));
      return { vector: { x: 0, y: 0 }, magnitude: 0, angle: 0, hitstunFrames: 0 };
    }

    if (this.isShieldParrying() && !hit.unblockable) {
      // Zero-damage contact can be blocked, but cannot trigger a parry.
      if (!(hit.damage > 0)) return { vector: { x: 0, y: 0 }, magnitude: 0, angle: 0, hitstunFrames: 0 };
      this.consumeShieldParry();
      const freeze = computeShieldParryHitlag({ damage: hit.damage,
        targetPercent: this.damagePercent, multiplier: hit.hitlagMultiplier, players: hit.hitlagPlayers,direct:hit.direct,
          electricCollision: hit.electricCollision, projectile: hit.hitlagProjectile },
      hit.shieldKind === 'projectile');
      this.armAttackerHitlag(freeze.defender);
      this.shieldParryStunRemaining = computeShieldstun(hit.damage, hit.shieldKind, hit.shieldSetoffMultiplier);
      this.shieldParryProtected = true;
      this.latchShieldPresentation('parry', this.shieldParryStunRemaining);
      emitCombatSfx(this.sfxSink ?? undefined, ASSET_KEYS.sfxShield);
      return { vector: { x: 0, y: 0 }, magnitude: 0, angle: 0, hitstunFrames: 0 };
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
    if (isShieldRaised(this.shieldState) && !hit.unblockable && this.sourceShieldContactAllowsBlock(hit)) {
      // Pass how long the shield has been up so a hit caught in the raise
      // window powershields — no HP cost, no shieldstun, instant punish.
      const r = applyShieldHit(
        this.shieldState,
        hit.damage,
        this.tuning.shield,
        undefined, // Raising a shield is an ordinary block; Ultimate parries on release.
        hit.shieldKind,
        hit.shieldDamage,
        hit.shieldSetoffMultiplier,
        this.damagePercent,
      );
      this.shieldState = r.state;
      if(!r.perfect&&!isShieldBroken(r.state)&&hit.shieldSetoffMultiplier!==undefined){
        const speed=computeShieldPushback({damage:hit.damage,kind:hit.shieldKind,setoffMultiplier:hit.shieldSetoffMultiplier}).defenderSpeed;
        this.sourcedShieldPush={speed:hit.facing*speed,attacker:false};
      }
      this.latchShieldPresentation(isShieldBroken(r.state) ? 'broken' : 'block',
        isShieldBroken(r.state) ? r.state.stunRemaining : r.state.blockStunRemaining);
      if (!r.perfect) {
        this.armAttackerHitlag(computeShieldHitlag({ damage: hit.damage,
          targetPercent: this.damagePercent, multiplier: hit.hitlagMultiplier, players: hit.hitlagPlayers,
          electricCollision: hit.electricCollision, projectile: hit.hitlagProjectile }));
      }
      // AC 10304 — voice the shatter cue when this hit is the one that
      // BROKE the shield (raised → broken edge), distinct from the
      // shield-raise hum. The `applyShieldHit` result carries the new
      // state; comparing against the pre-hit "raised" guard above means
      // we only fire on the breaking hit, not on every chip that drains
      // a bit of shield health. Audio-only side effect — the break-stun
      // lockout itself is driven by the state machine, untouched here.
      if (isShieldBroken(r.state)) {
        this.beginSourceShieldBreak();
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

    // Preview before destructive reaction/item resets. Knockback armor and the
    // carry classifier consume modified reference KB, not final hitstun or the
    // authored legacy launch.
    const sourceCarryActive = this.id === 'donkeykong' && this.donkeykongHeavyItemHeld
      && this.donkeykongHeavyCarry !== null && this.donkeykongHeavyItemAction === null
      && this.pendingKnockback === null && this.hitstunRemaining === 0
      && this.grabbedBy === null && this.buriedState === null;
    const throwKnockbackArmor = this.getThrowKnockbackArmor();
    if (sourceCarryActive || throwKnockbackArmor !== null) {
      const percentBefore = this.damagePercent;
      const percentAfter = accumulateDamage(percentBefore, hit.damage);
      const crouchMultiplier = this.isGrounded() && isCrouching(this.locomotionState)
        ? CROUCH_KNOCKBACK_REDUCTION : 1;
      const referenceKnockback = computeKnockback(hit, percentAfter, this.tuning.mass, {
        referenceWeight: hit.nativeCollisionAttribute === 'collision_attr_bury' || hit.statusEffect === 'bury'
          ? 100 : this.tuning.referenceWeight,
        grounded: this.isGrounded(),
        multiplier: crouchMultiplier * (hit.referenceKnockbackMultiplier ?? 1),
      }).referenceKnockback;
      // Resisted reaction: damage and the attacker's hitlag land, no launch.
      const resist = () => {
        this.damagePercent = this.percentAfterDamageTaken(percentBefore, hit.damage);
        this.noteCaptureDamage(this.damagePercent - percentBefore, 'external');
        this.noteCombatPercentApplied(percentBefore,hit);
        this.armAttackerHitlag(computeHitlag({damage:hit.damage,targetPercent:percentBefore,
          multiplier:hit.hitlagMultiplier,crouching:crouchMultiplier !== 1,
          players:hit.hitlagPlayers,electricCollision:hit.electricCollision,projectile:hit.hitlagProjectile}));
        this.lastDonkeyKongCarryHit = {reactionResisted:true};
        return {vector:{x:0,y:0},magnitude:0,angle:0,hitstunFrames:0};
      };
      if (throwKnockbackArmor !== null && referenceKnockback !== undefined && referenceKnockback <= throwKnockbackArmor)
        return resist();
      if (sourceCarryActive) {
        const decision = classifyDonkeyKongReferenceCarryDamage({sourceCarryActive,
          referenceKnockback, nativeCollisionAttribute:hit.nativeCollisionAttribute,
          nativeForceReaction:hit.nativeForceReaction});
        if (decision.kind === 'resist') return resist();
        if (decision.kind === 'launch' && referenceKnockback !== undefined)
          this.lastDonkeyKongCarryHit = {heavyItemDrop:{reason:decision.reason,referenceKnockback}};
      }
    }

    this.tauntPresentation = null;
    this.clearLedgeAttackAttachment();
    this.clearPikachuLedgeAttachment();
    this.donkeykongFullHopStep=null;this.donkeykongOrdinaryVerticalTick=false;
    this.grabReleasePresentation = null;
    this.ultimateCaptureBudget = null;
    this.clearGrabSourcePresentation();
    // Getting hit while GRABBING a victim BREAKS the grab (Smash: interrupt
    // the grabber and the held opponent goes free). Fires only on a hit
    // that actually lands — the i-frame / shield absorbs above already
    // returned, and a fighter can't be grabbing while shielding.
    if (this.grabTarget !== null && this.grabSpec !== null) {
      this.grabTarget.releaseFromGrab('break');
      this.grabTarget = null;
      this.grabState = applyGrabBreak(this.grabState, this.grabSpec);
    }
    this.throwRootMotionApplied = false;
    this.throwPresentation = null;
    // A fresh hit re-launches a prone / tumbling / rolling fighter — clear
    // the floor-loop lockouts so the new knockback takes over (tumble is
    // re-set when this hit's launch is applied).
    const alreadyTripped = this.isTripped();
    this.reactionPresentation = null;
    this.recoveryReaction = null;
    this.pikachuGroundRecovery = null; this.groundRecovery=null;this.clearSurfaceTech();
    this.pendingFootstoolJump=false;this.pendingFootstoolPhantom=false;this.sourceLinkFootstoolPendingContact=null;this.donkeykongFootstoolPerformer=null;this.sourceLinkFootstool=null;this.footstoolRecipient=null;this.footstoolMini=null;this.pikachuFootstoolVisual=null;this.pikachuRespawnPresentation=null;this.clearItemAction();this.pikachuLedgeJump=null;
    this.reactionCue = null;
    this.crouchPresentation = null;
    this.pikachuCrouchCrawl = null;
    this.pikachuTurnBrake = null;
    this.donkeykongTurnBrake=null;this.restoreSourcedGroundFriction();
    this.attackClankRemaining = 0;
    this.attackClankLockedStep = false;
    this.knockdownRemaining = 0;
    this.tripped = false;
    this.tumbling = false;
    this.techBufferRemaining = 0;
    this.techLockoutRemaining = 0;

    // 1. Damage accumulation. Capture pre-hit percent for the
    //    high-% hitlag bonus so a 149% target hit by a heavy crosses
    //    into "high-% crunch" exactly when the bonus formula expects.
    const percentBeforeHit = this.damagePercent;
    this.interruptEating();
    // Knockback and knockback-dependent statuses read the unmultiplied percent.
    const knockbackPercent = accumulateDamage(percentBeforeHit, hit.damage);
    this.damagePercent = this.percentAfterDamageTaken(percentBeforeHit, hit.damage);
    this.noteCaptureDamage(this.damagePercent - percentBeforeHit, 'external');
    this.noteCombatPercentApplied(percentBeforeHit,hit);

    // 2. Knockback math — at the *new* percent, scaled by the
    //    fighter's current mass so heavy targets resist.
    // CROUCH-CANCEL — a grounded crouching victim eats a softened launch.
    // Gated on grounded too so a (defensively) stale crouch can never hand
    // an airborne / juggled fighter the reduction.
    const crouchCancel =
      this.isGrounded() && isCrouching(this.locomotionState)
        ? CROUCH_KNOCKBACK_REDUCTION
        : 1;
    const rawResult = computeKnockback(hit, knockbackPercent, this.tuning.mass, {
      referenceWeight: this.tuning.referenceWeight,
      grounded: this.isGrounded(),
      multiplier: crouchCancel*(hit.referenceKnockbackMultiplier??1),
    });
    let result: KnockbackResult =
      crouchCancel === 1 || hit.knockback.reference !== undefined
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

    const tripProbability = referenceTripProbability({ tripChance: hit.tripChance,
      grounded: this.isGrounded(), alreadyTripped, verticalVelocity: result.vector.y,
      referenceKnockback: result.referenceKnockback });
    // A slip trips a grounded target whatever the knockback, without a roll (SmashWiki Slip).
    const slip = hit.slip === true && this.isGrounded() && !alreadyTripped;
    const trip = slip || (hit.slip !== true && tripProbability > 0 && this.tripRandomSource !== null
      && this.tripRandomSource() < tripProbability);
    if (trip) result = { ...result, vector: { x: 0, y: 0 }, magnitude: 0,
      angle: 0, hitstunFrames: 0, tumble: false, tripped: true };

    const autolink = hit.knockback.reference?.angle === 367 && !this.isGrounded()
      && validReferenceAutolinkContext(hit.autolink) ? {
        target: { ...hit.autolink.target }, sourceVelocity: { ...hit.autolink.sourceVelocity },
      } : undefined;
    const profile = !trip && hit.knockback.reference !== undefined ? this.tuning.referenceLaunch : undefined;
    const vertical = autolink === undefined
      && isVerticalReferenceLaunch(result.vector, result.tumble === true);
    if (profile !== undefined) {
      const vector = { x: result.vector.x, y: result.vector.y - referenceGravityBoost(profile, vertical,
        result.tumble === true, hit.knockback.reference?.setWeight === true) };
      result = { ...result, vector, magnitude: Math.hypot(vector.x, vector.y), angle: Math.atan2(vector.y, vector.x) };
    }
    // Imported custom values can request impractically long reactions. Keep
    // those on the existing constant-space clock rather than allocating a
    // trajectory schedule proportional to an unbounded authoring value.
    const boundedSchedule = Number.isSafeInteger(result.hitstunFrames) && result.hitstunFrames <= 10_000;
    const groups = profile !== undefined
      ? boundedSchedule ? getReferenceDamageSpeedUpGroups(result.hitstunFrames,
        result.tumble === true && !isFixedReferenceKnockback(hit.knockback.reference)) : [1]
      : undefined;
    if (groups !== undefined) {
      result = { ...result, ordinaryHitstunFrames: result.hitstunFrames,
        hitstunFrames: boundedSchedule ? groups.length - 1 : result.hitstunFrames };
    }

    // An opted DK source grab is replaced by genuine hitstun. Retiring its
    // whiff now prevents its sensor and body from resuming after hitlag/stun.
    // Held-target break, rejected hits and unopted profiles retain their paths.
    if (this.id === 'donkeykong' && this.grabSpec?.attachmentPolicy === 'pose-anchors-beta-v1'
      && result.hitstunFrames > 0 && (this.grabState.name === 'whiffStartup'
        || this.grabState.name === 'whiffActive' || this.grabState.name === 'whiffRecovery')) {
      const before = this.grabState;
      this.grabState = resetGrabState();
      this.handleGrabStateTransition(before, this.grabState);
      this.dashGrabActive = false;
      this.dashGrabEntryVx = 0;
      this.grabVariantSpec = null;
      this.grabPresentationVariant = 'standing';
    }

    // 3. Hitlag freeze frames (post-M2 hit-feel pass). Both fighters
    //    visually pause at the moment of impact for `hitlagFrames` —
    //    the knockback velocity and hitstun lockout don't actually
    //    fire until the freeze ends (handled in `applyInput`'s
    //    hitlag drain path). Sweet-spot hits get the +4 frame bonus.
    const hitlagFrames = computeHitlag({
      damage: hit.damage,
      targetPercent: percentBeforeHit,
      multiplier: hit.hitlagMultiplier,
      crouching: crouchCancel !== 1,
      players: hit.hitlagPlayers,
      electricCollision: hit.electricCollision, projectile: hit.hitlagProjectile,
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
    this.hitlagPosition = { x: this.body.position.x, y: this.body.position.y };
    this.jumpPresentation = null;
    this.pikachuAuxiliaryAir = null;
    this.throwPresentation = null;
    this.throwRootMotionApplied = false;
    this.landingPresentation = null;
    // Damage interrupts special-fall. It does not replenish jumps or dodge.
    this.helpless = false;
    this.jumpsquatRemaining = 0;
    this.jumpsquatShortHop = false;
    this.jumpsquatFacing = null;
    this.tapJumpBufferFrames = 0;
    this.attackerHitlagVelocity = null;
    this.pikachuLedgeFlightHitlagRelease=false;
    this.launchVelocity = null;
    this.referenceLaunch = null;
    this.hitstunGravityVelocityY = 0;
    this.pendingHitstunGravityCorrection = 0;
    this.pendingKnockback = {
      ...(trip ? { trip: true } : {}),
      ...(slip ? { softTrip: true } : {}),
      ...(autolink === undefined ? {} : { autolink }),
      vector: { x: result.vector.x, y: result.vector.y },
      hitstunFrames: result.hitstunFrames,
      launchDecayPerFrame: result.launchDecayPerFrame,
      tumble: result.tumble,
      ...(profile && groups ? { referenceLaunch: { profile: { ...profile }, vertical, groups } } : {}),
      ...(hit.velocityCarry && Number.isFinite(hit.velocityCarry.x) && Number.isFinite(hit.velocityCarry.y)
        ? { velocityCarry: { ...hit.velocityCarry } } : {}),
    };
    if(this.buriedState){
      const reaction=receiveBuriedHit(this.buriedState,result.referenceKnockback??result.magnitude,this.pendingKnockback);
      this.buriedState=reaction.state;if(reaction.held)this.pinBuriedLaunch();
    }else if(hit.statusEffect==='bury'&&this.isGrounded()){
      const weight100=computeKnockback(hit,knockbackPercent,this.tuning.mass,{referenceWeight:100,grounded:true}).referenceKnockback;
      if(weight100!==undefined){this.buriedState=createBuriedState(ultimateBuryFrames(knockbackPercent,weight100,hit.attackerMinusVictimStocks??0),this.lastCaptureInput);this.pinBuriedLaunch();}
    }
    // Fresh SDI budget for this freeze (no carry-over from a prior hit).
    this.sdiState = createReferenceSdiState();
    this.sdiMultiplier = Number.isFinite(hit.sdiMultiplier) ? Math.max(0, hit.sdiMultiplier!) : 1;
    // Fall-shaping latches die the moment a hit lands: the queued
    // launch owns the velocity, and a surviving fast-fall latch (or
    // armed jump-cut) would corrupt the knockback arc when hitstun
    // ends. Cleared HERE (the single entry point every knockback path
    // funnels through) rather than in the per-frame shaping block,
    // whose hitstun branch never runs during the hitlag freeze.
    this.fastFallLatched = false;
    this.jumpCutArmed = false;
    this.shortHopRising = false;
    this.airJumpRising = false;
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

    // Source catch limits reset on genuine hitstun, including a zero-damage
    // launch. Legacy profiles retain their damaging-launch reset policy.
    // Blocked/armored contacts return before this branch.
    const resetLedgeCatches = this.tuning.ledge.maxGrabsWithoutGround > 0
      ? result.hitstunFrames > 0 : hit.damage > 0 && result.magnitude > 0;
    if (resetLedgeCatches) {
      this.ledgeHangState = { ...this.ledgeHangState, ledgeGrabsSinceGround: 0 };
    }

    if(directThrowPresentation&&result.magnitude>0){
      this.admitSourceDamageReceipt(hit,result,directThrowPresentation.groundedBefore,directThrowPresentation.damageBefore);
      this.reactionPresentation=null;
    }
    return result;
  }

  /** Same visual admission for detailed contacts and genuine direct absolute
   * throws; consumes the already computed launch once, never recomputes combat. */
  private admitSourceDamageReceipt(hit:HitInfo,knockback:KnockbackResult,groundedBefore:boolean,damageBefore:number):number {
      const eventFrame=Math.max(0,this.simulationInputFrame);this.sourceDamageOwnStop=this.hitlagRemaining>0;
      this.sourceDamagePresentation=parseSourceDamagePresentationReceipt({eventSerial:++this.sourceDamageEventSerial,generation:this.positionResetGeneration,
        entryFrame:eventFrame,lastAdvancedFrame:eventFrame,framesElapsed:0,entryFacing:this.facing,groundedAtEntry:groundedBefore,
        ownElectricStop:this.sourceDamageOwnStop&&(hit.electricCollision===true||hit.nativeCollisionAttribute?.includes('collision_attr_elec')===true),electricStopFramesElapsed:0,electricStopLastAdvancedFrame:eventFrame,
        damageApplied:this.damagePercent-damageBefore,postHitPercent:this.damagePercent,initialHitstunFrames:knockback.ordinaryHitstunFrames??knockback.hitstunFrames,initialStatusHitstunFrames:this.pendingKnockback?.hitstunFrames??knockback.hitstunFrames,tumbleAtAdmission:this.pendingKnockback?.tumble??knockback.tumble??false,referenceKnockback:knockback.referenceKnockback??null,
        launchVelocity:knockback.vector,nativeCollisionAttribute:hit.nativeCollisionAttribute??null,nativeLaunchAngleRadians:knockback.nativeLaunchAngleRadians??null,
        electric:hit.electricCollision===true||hit.nativeCollisionAttribute?.includes('collision_attr_elec')===true,
        nativeAttackHeight:hit.nativeAttackHeight??null,nativeAttackHeightSource:hit.nativeAttackHeightSource??null,attackHeightContext:hit.combatAttackHeightContext??null,
        receivingRegions:hit.combatReceivingRegions??null,sourceContactCapsuleWorld:hit.combatContactCapsuleWorld??null});
    return eventFrame;
  }

  /** Apply a hit and report why it landed or was rejected. */
  applyHitDetailed(hit: HitInfo): CharacterHitApplication {
    const destroyedBefore = this.destroyed;
    const revivalPlatformBefore = this.isOnRevivalPlatform();
    const counterBefore = this.pendingCounterRetaliation;
    const respawnInvincibleBefore = (this.timerProtection === 'legacy' && this.invincibilityRemaining > 0) || this.shieldParryProtected;
    const dodgeInvincibleBefore = isDodgeInvincible(this.dodgeState);
    const ledgeInvincibleBefore = isLedgeHangInvincible(this.ledgeHangState);
    const sourceInvulnerableBefore = this.isSourceInvincible();
    const intangibleBefore=this.hasWholeSourceProtection() || (this.finalSmashControl?.role === 'captured' &&
      hit.finalSmashRunId !== this.finalSmashControl.runId);
    const armoredBefore = this.isStallAndFallArmored() || (this.isSuperArmored() && hit.nativeForceReaction !== true);
    const shieldedBefore = (isShieldRaised(this.shieldState) && this.sourceShieldContactAllowsBlock(hit) ||
      (this.isShieldParrying() && !(hit.damage > 0))) && !hit.unblockable;
    const shieldParryBefore = this.isShieldParrying() && hit.damage > 0 && !hit.unblockable;
    const damageBefore = this.damagePercent;
    const groundedBefore = this.isGrounded();
    let knockback:KnockbackResult;this.detailedHitApplicationDepth++;
    try{knockback=this.applyHit(hit);}finally{this.detailedHitApplicationDepth--;}

    let outcome: CharacterHitOutcome;
    if (destroyedBefore) outcome = 'destroyed';
    else if (revivalPlatformBefore) outcome = 'intangible';
    else if (this.pendingCounterRetaliation !== counterBefore) outcome = 'parried';
    else if (respawnInvincibleBefore) outcome = 'invincible';
    else if (dodgeInvincibleBefore) outcome = 'dodged';
    else if (ledgeInvincibleBefore) outcome = 'ledge-invincible';
    else if (sourceInvulnerableBefore) outcome = 'invulnerable';
    else if (intangibleBefore) outcome = 'intangible';
    else if (armoredBefore) outcome = 'armored';
    else if (shieldParryBefore) outcome = 'parried';
    else if (shieldedBefore) outcome = 'shielded';
    else outcome = 'landed';

    if(outcome==='landed'&&knockback.magnitude>0){
      this.clearSourceShieldBreak();this.linkPassiveGuard=null;
      // A launch that passed an exact shield bubble ends the raised shield.
      if(this.usesExactShieldBubble()&&isShieldRaised(this.shieldState)){
        this.shieldState={...this.shieldState,name:'idle',blockStunRemaining:0};this.shieldReleaseRemaining=0;this.shieldPresentation=null;}
      if(this.id==='link'){this.admitSourceDamageReceipt(hit,knockback,groundedBefore,damageBefore);
        // Each actual flinch owns a new visual age even if its broad reaction kind
        // equals the prior hit. This does not alter hitstun/launch or protection.
        this.reactionPresentation=null;}
    }
    if (outcome === 'landed') {
      if(this.finalVictimPresentation?.kind==='impact-stop')this.finalVictimPresentation=null;
      this.lastFinalReactionRun = hit.finalSmashRunId ?? null;
      if (this.finalSmashControl?.role === 'captured')
        this.capturedFinalReactionRun = this.lastFinalReactionRun === this.finalSmashControl.runId
          ? this.lastFinalReactionRun : null;
    }

    return {
      outcome,
      knockback,
      damageApplied: this.damagePercent - damageBefore,
      ...this.lastDonkeyKongCarryHit,
      ...(outcome === 'parried' ? { parryKind: this.pendingCounterRetaliation !== counterBefore
        ? 'counter' as const : 'shield' as const } : {}),
    };
  }

  /** True while the active move is inside one of its `armorWindows`. */
  private isSuperArmored(): boolean {
    const a = this.activeAttack;
    if (a === null) return false;
    const windows = (a.move as AttackMove).armorWindows;
    if (!windows || windows.length === 0) return false;
    const f = a.framesElapsed;
    return windows.some((w) => {
      if (f < w.startFrame || f >= w.endFrame) return false;
      if (w.minChargeRatio === undefined) return true;
      const max = (a.move as { charge?: { maxChargeFrames?: number } }).charge?.maxChargeFrames ?? 0;
      const held = a.chargeHeldFrames ?? 0;
      return max > 0 && held / max >= w.minChargeRatio;
    });
  }

  private isStallAndFallArmored(): boolean {
    if (this.activeAttack === null) return false;
    const move = this.activeAttack.move as unknown as {
      type?: string;
      downSpecialKind?: string;
      stallAndFall?: { armorDuringFall?: boolean };
    };
    return (
      move.type === 'downSpecial' &&
      move.downSpecialKind === 'stallAndFall' &&
      move.stallAndFall?.armorDuringFall === true &&
      Character.phaseFor(
        this.activeAttack.framesElapsed,
        this.activeAttack.move,
      ) === 'active'
    );
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
    if(this.pikachuLedgeJump?.phase==='flight' && this.pikachuLedgeJump.framesElapsed===0 && this.body.velocity.y<0)return false;
    for (const pair of this.contactPairs.values()) {
      if (this.isSupportPair(pair)) return true;
    }
    return false;
  }

  /** Live world-space position (Matter centre of mass). */
  getPosition(): { x: number; y: number } {
    return { x: this.body.position.x, y: this.body.position.y };
  }

  /** Live velocity in Matter px-per-step units. */
  getVelocity(): { x: number; y: number } {
    // Matter's collisionStart callback occurs before it normalizes the public
    // velocity field. Its getter derives consistent units from Verlet history.
    const velocity = this.scene.matter.body.getVelocity?.(this.body) ?? this.body.velocity;
    const transport = this.referenceTransport;
    if (transport !== null && transport.token === this.referenceLaunch) {
      return {
        x: transport.residual.x + (velocity.x - transport.residual.x) / transport.multiplier,
        y: transport.residual.y + (velocity.y - transport.residual.y) / transport.multiplier,
      };
    }
    return { x: velocity.x, y: velocity.y };
  }

  /** Last input-driven facing direction. 1 = right, -1 = left. */
  getFacing(): 1 | -1 {
    return this.facing;
  }

  /** Number of jumps consumed since the last landing. */
  getJumpsUsed(): number {
    return this.jumpsUsed;
  }
  /** Observed entry controls, not a guessed native forward/back motion selector. */
  getJumpPresentationState() {
    return this.jumpPresentation && !this.isGrounded() && !this.isGrabbed() && !this.isHangingOnLedge()
      ? { ...this.jumpPresentation } : null;
  }
  private canPresentUncommittedBody(): boolean {
    if(this.donkeykongHeavyItemAction)return false;
    if(this.itemEating||this.itemAction||this.itemShooting||this.isHammerLocked())return false;
    if(this.isSurfaceTechLocking())return false;
    if (this.buriedState !== null || this.grabState.active?.cargo || this.pikachuLedgeJump?.phase==='start' || this.groundRecovery !== null || this.footstoolRecipient !== null || this.grabReleasePresentation !== null || this.tauntPresentation !== null || this.destroyed || this.activeAttack !== null || this.cooldownRemaining > 0 ||
      this.attackClankRemaining > 0 || this.attackClankLockedStep ||
      this.chargingSmash !== null || this.chargingSpecial !== null ||
      this.isInLandingRecovery() || (this.pendingOrdinaryLandingFrames ?? 0) > 0 ||
      this.grabbedBy !== null || isGrabActing(this.grabState) || isDodgeActing(this.dodgeState) ||
      isLedgeLockingInput(this.ledgeHangState) || isShieldRaised(this.shieldState) ||
      isShieldBroken(this.shieldState) || isInShieldstun(this.shieldState) ||
      this.shieldReleaseRemaining > 0 || this.shieldParryStunRemaining > 0 || this.shieldParryProtected ||
      this.hitstunRemaining > 0 || this.referenceStunnedStep || this.pendingKnockback !== null ||
      this.knockdownRemaining > 0 || this.pikachuGroundRecovery !== null || this.jumpsquatRemaining > 0) return false;
    return true;
  }
  private ordinaryPresentationSheet(): 'idle' | 'walk' | 'fall' | 'fall_special' | null {
    if (!this.canPresentUncommittedBody() || this.isCrouching() || this.reactionCue || this.packedBodyTail) return null;
    // The revival platform is a floor the revived fighter stands on (SmashWiki Revival platform; simulationSpriteAnimation).
    if (!this.isGrounded() && !this.revivalPlatform) {
      if (this.helpless) return 'fall_special';
      // This preserves the framework's beta velocity-based motion selection.
      const velocityY = this.attackerHitlagVelocity?.y ?? this.body.velocity.y;
      return velocityY >= 0 ? 'fall' : null;
    }
    if (this.locomotionState.name === 'standing') return 'idle';
    if (this.locomotionState.name === 'walk') return 'walk';
    return null;
  }
  private syncOrdinaryPresentation(advance: boolean): void {
    const sheet = this.ordinaryPresentationSheet();
    if (sheet === null) { this.ordinaryPresentation = null; return; }
    if (this.ordinaryPresentation?.sheet !== sheet) {
      this.ordinaryPresentation = { sheet, framesElapsed: 0 };
    } else if (advance) this.ordinaryPresentation.framesElapsed += 1;
  }
  private reactionPresentationCandidate(): ReactionPresentationState | null {
    if (this.destroyed || this.grabbedBy !== null) return null;
    if (this.reactionCue) return { ...this.reactionCue };
    const attack = this.activeAttack;
    if (attack && this.recoveryReaction &&
      [`${this.id}.tripAttack`, `${this.id}.getupAttack`, `${this.id}.getupAttackFaceDown`].includes(attack.move.id))
      return { kind: 'getup-attack', ...this.recoveryReaction, framesElapsed: attack.framesElapsed, moveId: attack.move.id };
    if (this.knockdownRemaining > 0) return { kind: this.tripped ? 'trip' : 'prone',
      origin: this.recoveryOrigin(), framesElapsed: this.knockdownTotalFrames() - this.knockdownRemaining, facing: this.facing };
    if (this.pendingKnockback || this.hitstunRemaining > 0 || this.referenceStunnedStep)
      return { kind: 'damage', origin: null, framesElapsed: 0, facing: this.facing,
        phase: this.hitlagRemaining > 0 ? 'hitlag' : 'hitstun' };
    if (this.tumbling) return { kind: 'tumble', origin: null, framesElapsed: 0, facing: this.facing };
    return null;
  }
  private syncObservedPresentation(advance: boolean): void {
    this.syncShieldPresentation();
    // The ordinary idle/fall clock waits for the tail, so it starts afresh once the tail ends.
    const packed=packedBodyProfile(this.id)!==null;
    if(packed)this.packedBodyTail=nextPackedBodyTail(captureSimulationAnimation(this,0,false),advance);
    this.syncOrdinaryPresentation(advance);
    if (packed) {
      const crouching=this.isGrounded()&&this.isCrouching()&&this.canPresentUncommittedBody();
      const oldPhase=this.packedCrouchPhase;
      if(crouching)this.packedCrouchPhase=oldPhase===null||oldPhase==='end'?'start':oldPhase==='start'&&(this.packedBodyClock?.framesElapsed??0)>=6?'hold':oldPhase;
      else this.packedCrouchPhase=oldPhase==='hold'||oldPhase==='start'?'end':oldPhase==='end'&&(this.packedBodyClock?.framesElapsed??0)<6?'end':null;
      if(!this.canPresentUncommittedBody())this.packedCrouchPhase=null;
      const candidate=packedBodyCandidate(captureSimulationAnimation(this,0,false));
      if(candidate){const old=this.packedBodyClock;this.packedBodyClock={sheet:candidate.sheet,facing:candidate.facing,action:candidate.action,
        framesElapsed:candidate.age??(old?.sheet===candidate.sheet?old.framesElapsed+(advance?1:0):0)};}
      else this.packedBodyClock=null;
    }
    if (this.canPresentUncommittedBody() && this.isGrounded() && this.isCrouching() && !this.reactionCue) {
      if (!this.crouchPresentation) this.crouchPresentation = { framesElapsed: 0, facing: this.facing };
      else if (advance) this.crouchPresentation.framesElapsed += 1;
    } else this.crouchPresentation = null;
    const candidate = this.reactionPresentationCandidate();
    if (!candidate) { this.reactionPresentation = null; return; }
    if (candidate.kind === 'damage' || candidate.kind === 'tumble') {
      const old = this.reactionPresentation;
      this.reactionPresentation = { ...candidate,
        framesElapsed: old?.kind === candidate.kind ? old.framesElapsed + (advance ? 1 : 0) : 0,
        facing: old?.kind === candidate.kind ? old.facing : candidate.facing };
    } else this.reactionPresentation = { ...candidate,
      facing: this.reactionPresentation?.kind === candidate.kind
        ? this.reactionPresentation.facing : candidate.facing };
  }
  /** Observed hold only; native crouch entry/exit commitments are unresolved. */
  protected sourceCurrentBodyRoute():import('./linkCommonBodyRoute').LinkCommonBodyRoute|null{return null;}
  getSourceLinkDamagePresentationRoute():ReturnType<typeof import('./linkDamagePresentation').selectLinkDamagePresentation>{return null;}
  getSourceLinkAirPresentationRoute():ReturnType<typeof import('./linkAirPresentation').selectLinkAirPresentation>{return null;}
  getSourceLinkLandingPresentationRoute():{motion:string;rawAge:number;facing:1|-1;terminal:boolean}|null{return null;}
  /** Live supporting Matter pair, independent from drawing/receiving geometry. */
  getSourceSupportPresentationObservation(){
    const bodies=[...this.contactPairs.values()].filter(pair=>this.isSupportPair(pair)).map(pair=>pair.bodyA===this.body?pair.bodyB:pair.bodyA)
      .filter(body=>body.bounds&&Number.isSafeInteger(body.id)).sort((a,b)=>a.id!-b.id!);
    const body=bodies[0];if(!body||!this.isGrounded())return null;
    const bounds=body.bounds!,root=this.getSourceRootPosition(),hull=this.body.bounds;
    const left=bounds.min.x,right=bounds.max.x,halfWidth=(hull.max.x-hull.min.x)/2;
    // Authored conservative edge cue: the source root is still supported, but
    // the actual movement hull extends beyond its facing-side support edge.
    return{bodyId:body.id!,left,right,floorY:bounds.min.y,actorRootX:root.x,
      nearEdge:this.facing===1?root.x+halfWidth>right:root.x-halfWidth<left,
      inwardSupport:root.x>=left&&root.x<=right};
  }
  getSourceContextualPresentationRoute():import('./linkContextualPresentation').LinkContextualRoute|null{return null;}
  getSourceLinkItemContextPresentationState():ReturnType<typeof import('./linkItemContextEquipment').selectLinkItemContextEquipment>|null{return null;}
  getSourceLinkCaptureActionPresentationRoute():{motion:string;rawAge:number;facing:1|-1;terminal:boolean}|null{return null;}
  notifySourceLinkItemActionIdentity(_identity:{entityId:number;entityGeneration:number;actorGeneration:number;frame:number}|null):void{}
  notifySourceLinkLightPickup(_identity:{entityId:number;entityGeneration:number;actorGeneration:number;frame:number}|null):void{}
  notifySourceLinkLightPickupResult(_entityId:number,_entityGeneration:number,_accepted:boolean):void{}
  notifySourceLinkTemporaryFood(_identity:{entityId:number;entityGeneration:number;actorGeneration:number;frame:number}|null):void{}
  beginSourceMatchEntry(_side:'left'|'right'):boolean{return false;}
  advanceSourceMatchEntry(_frame:number,_gameplayStarted:boolean):void{}
  getSourceMatchEntryEquipment():ReturnType<typeof import('./linkContextualPresentation').linkEntryEquipment>|null{return null;}
  getSourceGuardReleasePresentationRoute():ReturnType<typeof import('./linkGuardReleasePresentation').selectLinkGuardReleasePresentation>{return null;}
  getSourceShieldBubble():(ReturnType<typeof import('./linkShieldTilt').selectLinkShieldTilt>&{readonly actorGeneration:number})|null{return null;}
  /** True when getSourceShieldBubble is the fighter's exact shield geometry. */
  protected usesExactShieldBubble():boolean{return false;}
  private sourceShieldContactAllowsBlock(hit:HitInfo):boolean {
    // Explicit non-scene physics fixtures keep the plain shield path. Scene
    // contacts on an exact-bubble fighter require that exact geometry.
    if(!this.usesExactShieldBubble()||hit.combatViaSceneResolver!==true)return true;
    const bubble=this.getSourceShieldBubble(),contact=hit.combatShieldContact;
    return bubble!==null&&contact!==undefined&&contact.actorGeneration===this.getPositionResetGeneration()&&
      contact.centre.x===bubble.centre.x&&contact.centre.y===bubble.centre.y&&contact.radius===bubble.radius;
  }
  getSourceCommonPresentationRoute():import('./linkCommonPresentationController').LinkCommonPresentationRoute|null{return null;}
  getCrouchPresentationState() {
    if (this.pikachuCrouchCrawl && this.canPresentUncommittedBody() && this.isGrounded() && !this.reactionCue)
      return { ...this.pikachuCrouchCrawl };
    if (!this.canPresentUncommittedBody() || !this.isGrounded() || !this.isCrouching() || this.reactionCue) return null;
    return { phase: 'hold' as const, framesElapsed: this.crouchPresentation?.framesElapsed ?? 0,
      facing: this.crouchPresentation?.facing ?? this.facing };
  }
  getPikachuTurnBrakePresentationState() {
    return this.pikachuTurnBrake && this.canPresentUncommittedBody() && this.isGrounded()
      ? { ...this.pikachuTurnBrake } : null;
  }
  /** Timed existing statuses or one-step option cues; no invented native selector. */
  getReactionPresentationState(): ReactionPresentationState | null {
    const candidate = this.reactionPresentationCandidate();
    if (!candidate) return null;
    const clock = this.reactionPresentation;
    return candidate.kind === 'damage' || candidate.kind === 'tumble'
      ? { ...candidate, framesElapsed: clock?.kind === candidate.kind ? clock.framesElapsed : 0,
        facing: clock?.kind === candidate.kind ? clock.facing : candidate.facing }
      : { ...candidate, facing: clock?.kind === candidate.kind ? clock.facing : candidate.facing };
  }
  /** Shared pre-physics receiving/render clock; reading never advances it. */
  getOrdinaryPresentationState() {
    const sheet = this.ordinaryPresentationSheet();
    if (sheet === null) return null;
    return { sheet, framesElapsed: this.ordinaryPresentation?.sheet === sheet
      ? this.ordinaryPresentation.framesElapsed : 0, facing: this.facing };
  }
  /** Identity is latched: a hard landing stays hard when one frame remains. */
  getLandingPresentationState() {
    const presentation = this.landingPresentation;
    if (!presentation || !this.isInLandingRecovery()) return null;
    const remaining = presentation.kind === 'special' || presentation.kind === 'aerial'
      ? this.cooldownRemaining : this.ordinaryLandingRemaining;
    return { ...presentation, framesElapsed: presentation.totalFrames - remaining, remainingFrames: remaining };
  }
  private getAuthoredThrowRootMotion() {
    const state = this.getThrowPresentationState();
    if (!state || !this.grabSpec) return null;
    const throws = state.cargo ? state.airborne ? this.grabSpec.cargo?.airThrows??this.grabSpec.cargo?.throws??this.grabSpec.throws : this.grabSpec.cargo?.throws??this.grabSpec.throws : this.grabSpec.throws;
    const samples = getThrowByDirection(throws, state.direction).rootMotionX;
    if (!samples || state.framesElapsed < 0 || state.framesElapsed >= samples.length) return null;
    return { samples, frame: state.framesElapsed, facing: state.facing };
  }

  /** Preserve the throw body clock through recovery after the captive link ends. */
  getThrowPresentationState() {
    const presentation = this.throwPresentation;
    if (!presentation) return null;
    if (this.grabState.name === 'throwing' && this.grabState.active)
      return { direction: presentation.direction, facing: presentation.facing, entryFrame:presentation.entryFrame,damageTransaction:presentation.damageTransaction,cargo:presentation.cargo,airborne:presentation.airborne, phase: 'throwing' as const,
        framesElapsed: this.grabState.active.framesElapsed };
    if (this.grabState.name === 'cooldown' && presentation.releaseElapsed !== null)
      return { direction: presentation.direction, facing: presentation.facing, entryFrame:presentation.entryFrame,damageTransaction:presentation.damageTransaction,cargo:presentation.cargo,airborne:presentation.airborne, phase: 'recovery' as const,
        framesElapsed: presentation.releaseElapsed + presentation.recoveryAtRelease - this.grabState.cooldownRemaining };
    return null;
  }

  /** Grounded wind-up frames remaining before takeoff. */
  getJumpsquatRemaining(): number {
    return this.jumpsquatRemaining;
  }

  /** Air-jumps still available before landing again. */
  getJumpsRemaining(): number {
    return Math.max(0, this.tuning.maxJumps - this.jumpsUsed);
  }

  /** Read-only view of the active tuning record. */
  getTuning(): Required<Omit<CharacterTuning, 'referenceLaunch'>> & Pick<CharacterTuning, 'referenceLaunch'> & AirMovementTuning & LandingTuning {
    // `locomotion` is resolved into `resolvedLocomotionTuning` (it needs
    // `maxRunSpeed`) and stays optional on `tuning`; the public view fills
    // every other field, and no caller reads `.locomotion` from here.
    return { ...this.tuning } as Required<Omit<CharacterTuning, 'referenceLaunch'>> & Pick<CharacterTuning, 'referenceLaunch'> & AirMovementTuning & LandingTuning;
  }

  /** Calibrated opening and total-gravity ownership, exposed for match review. */
  getDonkeyKongVerticalMotionState(){
    return this.donkeykongOrdinaryVertical?{
      profile:{...this.donkeykongOrdinaryVertical,fullHopStepVelocitiesY:[...this.donkeykongOrdinaryVertical.fullHopStepVelocitiesY]},
      nextOpeningStep:this.donkeykongFullHopStep,ordinaryTick:this.donkeykongOrdinaryVerticalTick,
      footstool:{repeatCount:this.donkeykongFootstoolRepeatCount,cooldownRemaining:this.donkeykongFootstoolCooldown,
        betaBasis:DONKEYKONG_FOOTSTOOL_BETA_JUMP_BASIS},
    }:null;
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
    const control = this.getFinalSmashPresentation();
    const victim=this.getFinalVictimPresentationSelection(),victimPose=this.getFinalVictimBodyPose();
    if(victim&&!victimPose)return []; // Required cinematic receiving never borrows a movement hull/old flinch.
    const posed = victimPose??(control?.sheet ? finalBodyPose(this.id, control.sheet, control.age) : null);
    const relativeFacing = victim?victim.facing*this.facing:control ? control.facing * this.facing : 1;
    const orientedPoint=(point:{x:number;y:number})=>{const p=transformPikachuFinalOrientationPoint(point,{facing:control?.facing??this.facing,rotationDegrees:control?.rotationDegrees??0});
      return{x:p.x*this.facing,y:p.y-(posed?.bodyCentreFromRootY??0)};};
    const orientedCapsule=(h:Hurtbox)=>{if(!h.capsule)return null;return{...h.capsule,start:orientedPoint(h.capsule.start),end:orientedPoint(h.capsule.end)};};
    const live = posed&&control?.rotationDegrees!==undefined&&!victim?posed.receiving.map(h=>{const capsule=orientedCapsule(h),point=orientedPoint({x:h.offsetX,y:h.offsetY});
      // New Final profiles carry exact capsules. A legacy rectangle cannot
      // become an axis-aligned approximation of an angled body.
      if(!capsule)throw new Error('Rotated Pika Final requires paired capsule receiving');
      return{...h,offsetX:point.x,offsetY:point.y,width:Math.abs(capsule.end.x-capsule.start.x)+capsule.radius*2,
        height:Math.abs(capsule.end.y-capsule.start.y)+capsule.radius*2,capsule,
        ...(control.phase==='uncommitted-end-tail'?{intangible:false}:control.intangible?{intangible:true}:{})};}):posed ? posed.receiving.map(h => ({ ...h,
      offsetX: h.offsetX * relativeFacing, offsetY: h.offsetY - posed.bodyCentreFromRootY,
      ...(h.capsule ? { capsule: { ...h.capsule,
        start: { x: h.capsule.start.x * relativeFacing, y: h.capsule.start.y - posed.bodyCentreFromRootY },
        end: { x: h.capsule.end.x * relativeFacing, y: h.capsule.end.y - posed.bodyCentreFromRootY } } } : {}),
      ...(control?.phase==='uncommitted-end-tail'?{intangible:false}:control?.intangible ? { intangible: true } : {}) })) : this.unsunkActiveHurtboxes();
    if(this.isWholeBodyIntangibleState())return live.map(h=>({...h,intangible:true}));
    // A buried fighter's hurtboxes go into the floor with its drawing (buriedPresentation.ts; SmashWiki Buried).
    return this.buriedState?.phase==='buried'?sinkHurtboxes(live,buriedSinkDepth(this.tuning.height)):live;
  }

  /** The live set before the bury sink; fighters with posed receiving override this, not getActiveHurtboxes. */
  protected unsunkActiveHurtboxes(): ReadonlyArray<Hurtbox> {
    if(this.id==='donkeykong'&&!this.getAttackClankPresentationState()){
      const posed=selectPackedBodyReceiving(captureSimulationAnimation(this,0,false));
      if(posed)return posed;
      if((this.groundRecovery||this.surfaceTech)&&this.hasWholeSourceProtection())return [{...this.postureBodyHurtbox(),intangible:true}];
    }
    const pikachuTech=this.getPikachuSurfaceTechPresentationState();
    if(pikachuTech)return selectPikachuSurfaceTechBody(pikachuTech)?.hurtboxes??[];
    if (this.getAttackClankPresentationState() && this.attackClankReceiving) return this.attackClankReceiving;
    const body = this.postureBodyHurtbox();
    const special = this.getPikachuSpecialState();
    if (special && this.activeAttack) {
      const clock = resolvePikachuSpecialBodyClock(special);
      // Accepted receiving rows have the same gameplay windows as the body
      // artwork. Hold loops use their six-frame local motion period.
      const poseFrame = clock.phase === 'hold' ? clock.nativeFrame : clock.localFrame;
      const authored: ReadonlyArray<Hurtbox> | null = selectPikachuSpecialHurtboxes(clock.sheet, poseFrame)
        ?? selectPikachuSpecialPhaseHurtboxes(clock.sheet, poseFrame);
      if (authored) {
        const rotated = special.bodyRotation !== 0 && (special.kind === 'skullBash' || special.kind === 'quickAttack')
          ? rotatePikachuSpecialHurtboxes(authored, special.bodyRotation, this.facing,
            special.kind === 'quickAttack' ? PIKACHU_QUICK_ROT_PIVOT : undefined) : authored;
        return this.pikachuSpecialRuntime?.intangible() ? rotated.map(h => ({ ...h, intangible: true })) : rotated;
      }
    }
    if (this.pikachuSpecialRuntime?.intangible()) return [{ ...body, intangible: true }];
    if (!this.activeAttack) {
      const charge = this.getAnimationActionState();
      if (charge.chargingMove && charge.chargeStartupElapsed !== undefined)
        return selectActiveHurtboxes(body, charge.chargingMove as AttackMoveWithAnimation, charge.chargeStartupElapsed);
      return [body];
    }
    // The attack's `move` is typed `AttackMove`; per-move hurtbox
    // modifiers live on the `AttackMoveWithAnimation` extension. We
    // upcast deliberately — every move registered in the M2 roster is
    // declared as `AttackMoveWithAnimation`-compatible (modifiers
    // optional). A move authored as a bare `AttackMove` (legacy /
    // test fixture) carries no `hurtboxModifiers` field and resolves
    // to the body default by the helper's empty-modifier short-circuit.
    // The base it layers over already reflects the crouch posture.
    const move = this.activeAttack.move as AttackMoveWithAnimation;
    const baseReceiving=selectActiveHurtboxes(body,move,this.activeAttack.framesElapsed);
    const selected = this.id==='donkeykong'
      ?applyDonkeyKongMoveProtection(baseReceiving,move,this.activeAttack.framesElapsed)
      :applyRegionalProtection(baseReceiving,move,this.activeAttack.framesElapsed);
    const authored = this.activeAttack.ledgeProtectionFrames !== undefined &&
      this.activeAttack.framesElapsed >= this.activeAttack.ledgeProtectionFrames
      ? selected.map(h => ({ ...h, intangible: false })) : selected;
    return special?.kind === 'skullBash' && special.bodyRotation !== 0 && move.hurtboxModifiers?.length
      ? rotatePikachuSpecialHurtboxes(authored, special.bodyRotation, this.facing) : authored;
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

  private shieldPresentationCounter(): { kind: ShieldPresentationState['kind']; remaining: number | null } | null {
    if (this.destroyed || this.grabbedBy !== null) return null;
    // Eligibility on release is deliberately separate from a successful contact.
    if (this.shieldParryProtected) return { kind: 'parry', remaining: this.shieldParryStunRemaining };
    if (isShieldBroken(this.shieldState)) return { kind: 'broken', remaining: this.shieldState.stunRemaining };
    if (isShieldRaised(this.shieldState)) return this.shieldState.blockStunRemaining > 0
      ? { kind: 'block', remaining: this.shieldState.blockStunRemaining } : { kind: 'hold', remaining: null };
    return this.shieldReleaseRemaining > 0 ? { kind: 'release', remaining: this.shieldReleaseRemaining } : null;
  }
  private latchShieldPresentation(kind: ShieldPresentationState['kind'], totalFrames: number | null): void {
    this.shieldPresentation = { kind, totalFrames, facing: this.facing, holdEntryAge: this.shieldActiveFrames };
  }
  private syncShieldPresentation(): void {
    const current = this.shieldPresentationCounter();
    if (!current) { this.shieldPresentation = null; return; }
    if (this.shieldPresentation?.kind !== current.kind)
      this.latchShieldPresentation(current.kind, current.remaining);
  }
  /** Shared actual shield outcome clock. Native start/break-end clips stay unbound. */
  getShieldPresentationState(): ShieldPresentationState | null {
    const current = this.shieldPresentationCounter();
    if (!current) return null;
    const entry = this.shieldPresentation?.kind === current.kind ? this.shieldPresentation : null;
    const totalFrames = entry?.totalFrames ?? current.remaining;
    return { kind: current.kind, totalFrames, remainingFrames: current.remaining,
      framesElapsed: current.kind === 'hold' ? entry ? Math.max(0, this.shieldActiveFrames - entry.holdEntryAge) : 0
        : Math.max(0, (totalFrames ?? 0) - (current.remaining ?? 0)),
      facing: entry?.facing ?? this.facing, phase: this.hitlagRemaining > 0 ? 'hitlag' : 'active' };
  }
  /** Protected ordinary shieldstun following a successful release parry. */
  getShieldParryStunRemaining(): number {
    return this.shieldParryStunRemaining;
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
    // Restored counters do not establish the historical entry/total budget.
    this.shieldPresentation = null;
    this.syncShieldPresentation();
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
  /** Advance the dodge machine one step, timing new dodges from (and counting them into) the staleness. */
  private stepDodge(input: Omit<DodgeInput, 'staleCount'>): void {
    const before = this.dodgeState;
    this.dodgeState = tickDodge(before, { ...input, staleCount: this.dodgeStaleness.count }, this.tuning.dodge);
    this.dodgeStaleness = tickDodgeStaleness(this.dodgeStaleness, {
      started: before.name !== 'active' && this.dodgeState.name === 'active',
      acting: isDodgeActing(this.dodgeState),
    });
  }

  /** Read-only dodge staleness (shared use count) for tests / probes. */
  getDodgeStaleness(): DodgeStaleness {
    return this.dodgeStaleness;
  }

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

  /**
   * True iff the fighter's ledge-roll get-up is currently playing. Like
   * the climb it locks out input, but the roll carries i-frames and lands
   * further inward (past the corner by `rollDistance`).
   */
  isRollingFromLedge(): boolean {
    return this.ledgeHangState.name === 'rolling';
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
   * geometric detection, after the stage has moved its platforms and before
   * applyInput. An attached hang/climb/roll follows the same platform and
   * side without restarting recovery or refreshing invulnerability.
   *
   * Pass an empty array to disable ledge detection for this fighter
   * (the canonical "no edge-grabbable ledges" state — useful in tests
   * that want to isolate other systems from the ledge mechanic).
   */
  setLedgeCandidates(candidates: ReadonlyArray<LedgeCandidate>): void {
    if (this.destroyed) return;
    this.ledgeCandidates = candidates;
    const active = this.ledgeHangState.active;
    if (active === null || !isLedgeLockingInput(this.ledgeHangState)) return;
    const candidate = candidates.find((next) =>
      next.platformId === active.candidate.platformId && next.side === active.candidate.side);
    if (candidate === undefined || this.pendingLedgeForceRelease) {
      // A vanished platform (or a hit/trump that already severed attachment)
      // releases immediately. Waiting for applyInput can freeze a stale hang
      // through hitlag or mistake an interrupted climb for completed recovery.
      this.ledgeHangState = tickLedgeHang(this.ledgeHangState, {
        detection: null, release: null, forceRelease: true,
        airborne: true, facing: this.facing,
      }, this.tuning.ledge).state;
      this.pendingLedgeForceRelease = false;
      return;
    }
    const dx = candidate.x - active.candidate.x;
    const dy = candidate.y - active.candidate.y;
    this.ledgeHangState = Object.freeze({
      ...this.ledgeHangState,
      active: Object.freeze({
        ...active, candidate,
        latchX: active.latchX + dx,
        latchY: active.latchY + dy,
      }),
    });
    if (dx === 0 && dy === 0) return;
    this.scene.matter.body.setPosition(this.body, {
      x: this.body.position.x + dx,
      y: this.body.position.y + dy,
    });
    // Hitlag still owns the post-Matter pin. Move that anchor with the ledge
    // so the gravity freeze cannot undo the platform's explicit translation.
    if (this.hitlagPosition !== null) {
      this.hitlagPosition = { x: this.hitlagPosition.x + dx, y: this.hitlagPosition.y + dy };
    }
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
    const sourcePolicy=this.sourceIntrinsicLedgePolicy();if(sourcePolicy&&!sourcePolicy.front&&!sourcePolicy.back)return null;
    const special = this.getPikachuSpecialState();
    if (special?.kind === 'quickAttack' && special.frame < 14) return null;
    if (special?.kind === 'skullBash' && (this.activeAttack?.framesElapsed ?? 0) < 26) return null;
    const bounds: FighterBounds = {
      centerX: this.body.position.x,
      centerY: this.body.position.y,
      halfWidth: this.tuning.width / 2,
      halfHeight: this.tuning.height / 2,
      velocityY: this.body.velocity.y,
      facing: this.facing,
    };
    const detected = detectLedgeGrab(
      bounds,
      this.ledgeCandidates,
      sourcePolicy?.allowRise||special?.kind === 'quickAttack' || special?.kind === 'skullBash'
        ? { ...this.tuning.ledgeDetection, minDescendVelocity: Number.NEGATIVE_INFINITY, requireFacing: false }
        : this.tuning.ledgeDetection,
    );
    if(detected&&sourcePolicy){const ahead=(detected.candidate.x-this.body.position.x)*this.facing>=0;
      if(ahead?!sourcePolicy.front:!sourcePolicy.back)return null;}
    if (detected && special?.kind === 'skullBash' && (this.activeAttack?.framesElapsed ?? 0) < 53) {
      const ahead = (detected.candidate.x - this.body.position.x) * this.facing >= 0;
      if (!ahead) return null;
    }
    return detected;
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
  private getPikachuLedgeAttachmentTarget() {
    if (this.pikachuLedgeJump?.phase==='start') {
      const jump=this.pikachuLedgeJump,offset=pikachuLedgeJumpStartOffset(jump.framesElapsed,this.pikachuPhysicalHalfHeight());
      const pose=selectPikachuAuxiliaryBody('ledge_jump_start',jump.framesElapsed);
      const corner=this.ledgeCandidates.find(c=>c.platformId===jump.candidate.platformId&&c.side===jump.candidate.side)??jump.candidate;
      return offset&&pose?{mode:'source-root' as const,...offset,handX:0,handY:0,
        artFrameIndex:pose.artFrameIndex,nativeSample:pose.nativeSample,sheet:'ledge_jump_start',localFrame:jump.framesElapsed,
        corner,facing:jump.facing,position:{x:corner.x+offset.x*jump.facing,y:corner.y+offset.y}}:null;
    }
    const state = this.ledgeHangState, active = state.active;
    if (this.id !== 'pikachu' || this.destroyed || this.grabbedBy !== null ||
        this.hitstunRemaining > 0 || this.pendingLedgeForceRelease || !active ||
        !isLedgeLockingInput(state)) return null;
    let sheet: string, age = active.framesElapsed;
    if (state.name === 'hanging') {
      ({ sheet, age } = ledgeHangPresentationClock(age, state.ledgeGrabsSinceGround,
        this.tuning.ledge.catchFrames ?? 0, this.tuning.ledge.catchMotionRatesByGrab ?? []));
    } else sheet = state.name === 'climbing' ? 'ledge_getup' : 'ledge_roll';
    const pose = selectPikachuLedgeAttachment(sheet, age);
    if (!pose) return null;
    const corner = this.ledgeCandidates.find(c => c.platformId === active.candidate.platformId &&
      c.side === active.candidate.side) ?? active.candidate;
    return { ...pose, sheet, localFrame: age, corner, facing: active.facing,
      position: { x: corner.x + pose.x * active.facing, y: corner.y + pose.y } };
  }
  private clearPikachuLedgeAttachment(): void {
    if (!this.pikachuLedgeAttachment) return;
    for (const [pair, original] of this.pikachuLedgeAttachment.ignoredPairs) pair.isSensor = original;
    this.pikachuLedgeAttachment = null;
  }
  private configurePikachuLedgeAttachmentPairs(): void {
    const target = this.getPikachuLedgeAttachmentTarget();
    if (!target) { this.clearPikachuLedgeAttachment(); return; }
    if (this.pikachuLedgeAttachment?.candidate.platformId !== target.corner.platformId ||
        this.pikachuLedgeAttachment.candidate.side !== target.corner.side) {
      this.clearPikachuLedgeAttachment();
      this.pikachuLedgeAttachment = { candidate: target.corner, attached: true, ignoredPairs: new Map() };
    }
    const state = this.pikachuLedgeAttachment!;
    if (!state.attached) return;
    for (const pair of this.contactPairs.values()) {
      const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
      if (!isPlatformLabel(other.label) || other.isSensor) continue;
      const platformId = (other as {plugin?: {platformId?: string}}).plugin?.platformId;
      const boundX = target.corner.side === 'left' ? other.bounds?.min.x : other.bounds?.max.x;
      const supporting = platformId !== undefined ? platformId === target.corner.platformId
        : boundX !== undefined && Math.abs(boundX - target.corner.x) < .01 &&
          other.bounds !== undefined && Math.abs(other.bounds.min.y - target.corner.y) < .01;
      if (!supporting) continue;
      if (!state.ignoredPairs.has(pair)) state.ignoredPairs.set(pair, pair.isSensor);
      pair.isSensor = true;
    }
  }
  private finishPikachuLedgeAttachmentPhysics(): void {
    const target = this.getPikachuLedgeAttachmentTarget();
    if (!target) { this.clearPikachuLedgeAttachment(); return; }
    if (target.mode === 'pin-hand') {
      // An attached hand is a positional constraint, with no elapsed-time
      // advancement here. Body/receiving and physical root use one drawing.
      this.scene.matter.body.setPosition(this.body, target.position);
      this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    } else if (this.pikachuLedgeAttachment?.attached && target.y <= -this.tuning.height / 2 &&
        this.body.position.y+this.pikachuPhysicalHalfHeight() <= target.corner.y + .05) {
      this.pikachuLedgeAttachment.attached = false;
      for (const [pair, original] of this.pikachuLedgeAttachment.ignoredPairs) pair.isSensor = original;
      this.pikachuLedgeAttachment.ignoredPairs.clear();
    }
  }
  /** Observed physical attachment; native shared cliff algorithms remain separate. */
  getPikachuLedgeAttachmentState() {
    const target = this.getPikachuLedgeAttachmentTarget();
    return target ? { ...target, attached: this.pikachuLedgeAttachment?.attached ?? true } : null;
  }

  private validateLedgeAttackAttachmentOwner(): void {
    const state = this.ledgeAttackAttachment;
    if (state && (this.activeAttack?.move !== state.move ||
        this.activeAttack.framesElapsed >= state.move.ledgeRootMotion!.length)) this.clearLedgeAttackAttachment();
  }
  private clearLedgeAttackAttachment(): void {
    const state = this.ledgeAttackAttachment;
    if (!state) return;
    for (const [pair, original] of state.ignoredPairs) pair.isSensor = original;
    this.ledgeAttackAttachment = null;
  }
  private configureLedgeAttackPairs(): void {
    const state = this.ledgeAttackAttachment;
    if (!state?.attached) return;
    for (const pair of this.contactPairs.values()) {
      const other = pair.bodyA === this.body ? pair.bodyB : pair.bodyA;
      if (!isPlatformLabel(other.label) || other.isSensor) continue;
      const plugin = (other as {plugin?: {platformId?: string}}).plugin;
      // Identity is supplied by StageRenderer. Minimal legacy/test scenes can
      // identify the same actual corner by bounds; no global mask changes.
      const boundX = state.candidate.side === 'left' ? other.bounds?.min.x : other.bounds?.max.x;
      const supporting = plugin?.platformId !== undefined
        ? plugin.platformId === state.candidate.platformId
        : boundX !== undefined && Math.abs(boundX - state.corner.x) < .01 &&
          other.bounds !== undefined && Math.abs(other.bounds.min.y - state.corner.y) < .01;
      if (!supporting) continue;
      if (!state.ignoredPairs.has(pair)) state.ignoredPairs.set(pair, pair.isSensor);
      pair.isSensor = true;
    }
  }
  private finishLedgeAttackPhysics(): void {
    this.validateLedgeAttackAttachmentOwner();
    const state = this.ledgeAttackAttachment;
    if (!state) return;
    const point = state.move.ledgeRootMotion![this.activeAttack!.framesElapsed]!;
    // Actual actor clearance AND the source standing-height segment are both
    // required. A different solid can block the climb; source age cannot
    // silently teleport through it or extend the existing action.
    if (state.attached && point.y <= 0 && this.getBodyBottomY() <= state.corner.y + .05) {
      state.attached = false;
      // The authored climb has completed its vertical displacement. Retire
      // that attachment velocity before ordinary gravity/floor support resumes.
      this.scene.matter.body.setVelocity(this.body, {x: this.body.velocity.x, y: 0});
      for (const [pair, original] of state.ignoredPairs) pair.isSensor = original;
      state.ignoredPairs.clear();
    }
    const attack = this.activeAttack!;
    if (attack.hitboxBody) {
      attack.hitboxBody.plugin.ownerAnchoredContact = true;
      attack.hitboxBody.plugin.postPhysicsContactOnly = true;
      updateHitboxPosition(this.scene, attack.hitboxBody,
        this.body.position, attack.move, attack.facing);
    }
  }
  /** Read-only observed adapter context; source common attachment is not claimed. */
  getLedgeAttackRootMotionState() {
    const state = this.ledgeAttackAttachment;
    return state ? {framesElapsed: this.activeAttack?.framesElapsed ?? 0, attached: state.attached,
      platformId: state.candidate.platformId, side: state.candidate.side,
      facing: state.facing, corner: {...state.corner}} : null;
  }

  private applyLedgeReleasePhysics(action: LedgeReleaseAction, corner: LedgeCandidate | null = null): void {
    if (action === 'jump') {
      if(this.id==='pikachu' && corner){
        const state=beginPikachuLedgeJump(this.facing),offset=pikachuLedgeJumpStartOffset(0,this.pikachuPhysicalHalfHeight());
        if(!offset)throw new Error('Ledge jump entry lacks its source root');
        this.clearPikachuLedgeAttachment();this.jumpPresentation=null;this.pikachuAuxiliaryAir=null;
        // The source start's twelve flagged capsule steps replace the generic
        // ledge-release timer; that timer must not survive the committed start.
        this.ledgeHangState={...this.ledgeHangState,hangIframesRemaining:0,grabVulnerableRemaining:0};
        this.pikachuLedgeJump={...state,candidate:corner,previousOffset:offset,previousCorner:{x:corner.x,y:corner.y}};
        this.clearReferenceLaunch();
        this.scene.matter.body.setPosition(this.body,{x:corner.x+offset.x*state.facing,y:corner.y+offset.y});
        this.scene.matter.body.setVelocity(this.body,{x:0,y:0});
        const impulse=(this.body as unknown as {positionImpulse?:{x:number;y:number}}).positionImpulse;
        if(impulse){impulse.x=0;impulse.y=0;}
        this.jumpsUsed=Math.min(1,this.tuning.maxJumps);this.jumpInputBufferFrames=0;
        this.configurePikachuLedgeAttachmentPairs();return;
      }

      this.sourceJumpEventSerial+=1;
      if(corner)this.beginLedgeJumpClearance(corner.y);
      this.jumpPresentation = { kind: 'ledge', facing: this.facing, moveX: 0,velocityX:this.body.velocity.x, shortHop: false, framesElapsed: 0 };
      // Release into a standard jump impulse, refreshing the air-jump
      // budget so the fighter can still air-jump after the ledge-jump.
      this.scene.matter.body.setVelocity(this.body, {
        x: 0,
        y: -this.tuning.jumpImpulse,
      });
      this.jumpsUsed = Math.min(1, this.tuning.maxJumps);
      this.jumpInputBufferFrames = 0;
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
      const native = this.sourceRecoveryAttack(`${this.id}.ledgeAttack`);
      if (native) {
        this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
        const ledgeProtectionFrames = ledgeRegrabEntry(this.tuning.ledge.attackProtectionFramesByGrab,
          this.ledgeHangState.ledgeGrabsSinceGround);
        this.activeAttack = { move: native, facing: this.facing, framesElapsed: 0, hitboxBody: null, upSpecial: null,
          chargeHeldFrames: null, holdInitialFrame: true,
          ...(ledgeProtectionFrames === undefined ? {} : { ledgeProtectionFrames }) };
        if (native.ledgeRootMotion && corner) {
          validateLedgeRootMotion(native.ledgeRootMotion, native.startupFrames + native.activeFrames + native.recoveryFrames);
          this.clearLedgeAttackAttachment();
    this.clearPikachuLedgeAttachment();
          this.ledgeAttackAttachment = {move: native, candidate: corner, facing: this.facing,
            frame: -1, attached: true, corner: {x: corner.x, y: corner.y}, ignoredPairs: new Map()};
          const first = native.ledgeRootMotion[0]!;
          // Explicit beta corner/standing-foot-root attachment; native common
          // cliff initialization and posture correction remain unqualified.
          this.scene.matter.body.setPosition(this.body, {
            x: corner.x + first.x * this.facing,
            y: corner.y - this.tuning.height / 2 + first.y,
          });
          // The preceding pinned hang can leave a warmed positional impulse
          // against this support. Matter applies that cache even to sensor
          // pairs, so it belongs to the retired hang owner, not this climb.
          const impulse = (this.body as unknown as {positionImpulse?: {x: number; y: number}}).positionImpulse;
          if (impulse) { impulse.x = 0; impulse.y = 0; }
          this.clearReferenceLaunch();
          this.configureLedgeAttackPairs();
        }
        return;
      }
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
        this.scene,
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
   * Clear round-local combat and item hooks without changing damage or match
   * statistics. The scene separately removes its traveling projectiles/items
   * and sets the new round's percent. Safe in either order for a grabbed pair.
   */
  resetForRound(x: number, y: number): void {
    this.interruptEating('discard');this.itemHealing=null;this.recoveryEvents=[];
    this.clearGrabSourcePresentation();
    this.donkeykongJabContinuation=null;this.donkeykongJabContinuationEligibleStep=false;
    this.lastDonkeyKongCarryHit = {};
    this.donkeykongFootstoolCooldown=0;this.donkeykongFootstoolCooldownEntryFrame=-1;this.sourceLinkFootstoolRepeatCount=0;this.sourceLinkFootstoolCooldown=0;this.sourceLinkFootstoolCooldownEntryFrame=-1;this.sourceLinkFootstoolRecipientSide=null;
    this.donkeykongFullHopStep=null;this.donkeykongOrdinaryVerticalTick=false;
    this.donkeykongHeavyItemHeld=false;
    this.donkeykongHeavyCarry=null;this.pendingDonkeyKongHeavyJump=null;this.donkeykongHeavyDownFlickAge=null;this.donkeykongHeavyDownHeld=false;
    this.clearLedgeAttackAttachment();
    this.clearPikachuLedgeAttachment();
    this.grabReleasePresentation = null;
    this.ultimateCaptureBudget = null;
    this.postReleaseGrabImmunity = {remaining: 0, lastFrame: -1};
    this.tauntPresentation = null;
    this.prevAppealHeld = false;
    if (this.destroyed) return;
    const grabber = this.grabbedBy;
    if (grabber !== null && grabber.grabTarget === this) {
      grabber.grabTarget = null;
      grabber.grabState = resetGrabState();
      grabber.dashGrabActive = false;
      grabber.dashGrabEntryVx = 0;
    }
    this.setPosition(x, y);
    this.equippedItem = null;
    this.invincibilityRemaining = 0;
    this.timerProtection = 'legacy';
    this.prePhysicsVelocityY = null;
    this.prevSpecialHeld = false;
    this.dropThroughFramesRemaining = 0;
    this.diveLandingEvent = null;
  }

  /** Monotonic discontinuity marker; ordinary Matter movement does not change it. */
  private positionResetGeneration = 0;

  /** Lets scene-level collision history distinguish teleports from movement. */
  getPositionResetGeneration(): number {
    return this.positionResetGeneration;
  }

  /** Teleport the body and reset transient movement state for a new spawn. */
  setPosition(x: number, y: number): void {
    this.endLedgeJumpClearance();this.sourceCaptureMotionFamily=null;
    this.setFinalSmashControl(null); this.finalVictimPresentation=null; this.clearFinalOpponentSlow(); this.finalSmashBodyTail=null; this.clearSourceShieldBreak();this.sourceDamagePresentation=null;this.sourceDamageOwnStop=false;
    this.linkPassiveGuard=null;
    this.interruptEating('discard');this.itemHealing=null;this.recoveryEvents=[];
    this.clearGrabSourcePresentation();
    this.donkeykongJabContinuation=null;this.donkeykongJabContinuationEligibleStep=false;
    this.donkeykongFootstoolCooldown=0;this.donkeykongFootstoolCooldownEntryFrame=-1;this.sourceLinkFootstoolRepeatCount=0;this.sourceLinkFootstoolCooldown=0;this.sourceLinkFootstoolCooldownEntryFrame=-1;this.sourceLinkFootstoolRecipientSide=null;
    this.donkeykongFullHopStep=null;this.donkeykongOrdinaryVerticalTick=false;
    this.restoreSourcedGroundFriction();
    this.sourcedShieldPush=null;this.shieldPushApplied=0;
    this.buriedState=null;this.revivalPlatform=null;this.packedBodyClock=null;this.packedBodyTail=null;this.packedCrouchPhase=null;this.donkeykongTurnBrake=null;this.ultimateCargoBudget=null;
    this.clearLedgeAttackAttachment();
    this.clearPikachuLedgeAttachment();
    this.grabReleasePresentation = null;
    this.ultimateCaptureBudget = null;
    this.postReleaseGrabImmunity = {remaining: 0, lastFrame: -1};
    this.tauntPresentation = null;
    if (this.destroyed) return;
    this.pikachuSpecialRuntime?.clear();
    this.terminalFallFrames = 0;
    this.pendingOrdinaryLandingFrames = null;
    this.pendingOrdinaryLandingKind = null;
    this.landingPresentation = null;
    this.throwReleaseInvincible = false;
    this.capturePresentation = null;
    this.sourceCaptureMotionFamily=null;
    this.captureAttachmentEntry=null;this.captureAttachmentBypass=null;this.captureAttachmentDiagnostic=null;
    this.crouchPresentation = null;
    this.pikachuCrouchCrawl = null;
    this.pikachuTurnBrake = null;
    this.reactionPresentation = null;
    this.recoveryReaction = null;
    this.pikachuGroundRecovery = null; this.groundRecovery=null;this.clearSurfaceTech();
    this.pendingFootstoolJump=false;this.pendingFootstoolPhantom=false;this.sourceLinkFootstoolPendingContact=null;this.donkeykongFootstoolPerformer=null;this.sourceLinkFootstool=null;this.footstoolRecipient=null;this.footstoolMini=null;this.pikachuFootstoolVisual=null;this.pikachuRespawnPresentation=null;this.clearItemAction();this.pikachuLedgeJump=null;
    this.reactionCue = null;
    this.pikachuWallBounceContact = null;
    this.heldItemCarryAge=0;
    this.positionResetGeneration += 1;
    this.scene.matter.body.setPosition(this.body, { x, y });
    this.scene.matter.body.setVelocity(this.body, { x: 0, y: 0 });
    this.jumpsUsed = 0;
    this.donkeykongFootstoolRepeatCount=0;this.donkeykongLastAttackEndFrame=-1000;
    this.jumpPresentation = null;
    this.pikachuAuxiliaryAir = null;
    this.throwPresentation = null;
    this.throwRootMotionApplied = false;
    this.prevJumpHeld = false;
    this.ordinaryPresentation = null;
    this.attackClankRemaining = 0;
    this.attackClankLockedStep = false;
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
    this.platformFallSupported = false;
    this.tapJumpBufferFrames = 0;
    this.jumpInputBufferFrames = 0;
    this.jumpsquatRemaining = 0;
    this.jumpsquatShortHop = false;
    this.jumpsquatFacing = null;
    this.offensiveActionBuffer = null;
    this.airDodgeUsed = false;
    this.airDodgeBurst = null;
    this.airDodgeGravityVelocityY = 0;
    // AC 60102 Sub-AC 2 — clear the prev-grounded latch on teleport.
    // A respawn drops the fighter into the air; the next applyInput
    // must NOT mistake the spawn frame for "just landed" and trigger a
    // spurious aerial-interrupt path. Setting this to false matches
    // the contact-pair reset below.
    this.prevGrounded = false;
    // Cancel any in-flight attack — a teleport (respawn / replay seek)
    // must not leave a stale hitbox in the world or freeze the
    // fighter mid-recovery.
    this.cancelAttack();
    this.donkeykongLastAttackEndFrame=-1000;
    this.clearPlacedTraps();
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
    this.hitlagPosition = null;
    this.contactPairs.clear();
    this.pendingKnockback = null;
    this.sdiState = createReferenceSdiState();
    this.sdiMultiplier = 1;
    this.attackerHitlagVelocity = null;
    this.pikachuLedgeFlightHitlagRelease=false;
    this.launchVelocity = null;
    this.referenceLaunch = null;
    this.hitstunGravityVelocityY = 0;
    this.pendingHitstunGravityCorrection = 0;
    // Fall-shaping latches are transient too — a respawn must not
    // inherit a fast-fall or an armed jump-cut from the previous stock.
    this.fastFallLatched = false;
    this.jumpCutArmed = false;
    this.shortHopRising = false;
    this.airJumpRising = false;
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
    // AC 60301 Sub-AC 1 — shield state is transient too. Reset to a
    // fresh idle / full-HP shield on respawn so a fighter who lost a
    // stock mid-shatter doesn't reappear pre-broken.
    this.shieldPresentation = null;
    this.shieldState = resetShieldState(this.tuning.shield);
    this.shieldBreakMash = null;
    this.shieldActiveFrames = 0;
    this.shieldReleaseRemaining = 0;
    this.shieldReleaseCanParry = false;
    this.shieldParryBlockRemaining = 0;
    this.shieldParryStunRemaining = 0;
    this.shieldParryProtected = false;
    // Stale-move history is per-life — a fresh stock fights with every
    // move fully un-staled.
    this.staleMoveQueue = [];
    // AC 60302 Sub-AC 2 — dodge state is transient as well. A fighter
    // who lost a stock mid-roll shouldn't respawn carrying the rest of
    // the slide / recovery / cooldown. Reset to a fresh idle.
    this.dodgeState = resetDodgeState();
    this.dodgeStaleness = createDodgeStaleness();
    this.airtimeFrames = 0;
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
      this.donkeykongCatchPoseConsumer.forget(this.grabHitboxBody);
      this.donkeykongCatchCollisionDiagnostic=null;
      despawnHitbox(this.scene, this.grabHitboxBody);
      this.grabHitboxBody = null;
    }
    if (this.grabTarget !== null) {
      this.grabTarget.releaseFromGrab('reset');
      this.grabTarget = null;
    }
    if (this.grabbedBy !== null) {
      this.grabbedBy = null;
    }
    this.grabState = resetGrabState();
    this.grabVariantSpec = null;
    this.pendingPummelFrames = null;this.pummelDamageTransaction=null;
    this.prevGrabHeld = false;
    this.dashGrabActive = false;
    this.dashGrabEntryVx = 0;
    this.onSourcePositionReset();
  }
  /** Source-owned presentation/admission state resets in the same actual
   * generation transaction; unrelated fighters retain their shared reset. */
  protected onSourcePositionReset():void{}

  /**
   * Replace tuning at runtime. Used by tests and the M2 roster.
   *
   * AC 60301 Sub-AC 1 — partial `shield` overrides merge over the
   * existing resolved record (rather than replacing it wholesale) so
   * a caller that only wants to bump `breakStunFrames` doesn't have to
   * re-supply the other shield fields.
   */
  setTuning(overrides: CharacterTuning & AirMovementTuning & LandingTuning & {shieldPushTraction?:number}): void {
    if(overrides.shieldPushTraction!==undefined)this.authoredShieldPushTraction=overrides.shieldPushTraction;
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
    const nextLocomotion: LocomotionTuning | undefined =
      stripped.locomotion !== undefined
        ? { ...this.tuning.locomotion, ...stripUndefined(stripped.locomotion) }
        : this.tuning.locomotion;
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
      locomotion: nextLocomotion,
    };
    this.resolvedLocomotionTuning = resolveLocomotionTuning(
      this.tuning.locomotion, this.tuning.maxRunSpeed,
    );
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
    this.endLedgeJumpClearance();this.sourceCaptureMotionFamily=null;
    this.linkPassiveGuard=null;
    this.clearGrabSourcePresentation();
    this.donkeykongJabContinuation=null;this.donkeykongJabContinuationEligibleStep=false;
    this.restoreSourcedGroundFriction();
    if (this.destroyed) return;
    this.clearLedgeAttackAttachment();
    this.clearPikachuLedgeAttachment();
    this.grabReleasePresentation = null;
    this.ultimateCaptureBudget = null;
    this.postReleaseGrabImmunity = {remaining: 0, lastFrame: -1};
    this.tauntPresentation = null;
    this.pikachuSpecialRuntime?.clear();
    this.destroyed = true;
    // Tear down any live hitbox first so we don't leak a sensor body.
    if (this.activeAttack && this.activeAttack.hitboxBody) {
      despawnHitbox(this.scene, this.activeAttack.hitboxBody);
    }
    this.activeAttack = null;
    // The opt-in catch consumer owns one source snapshot for this live sensor.
    // Retire it at teardown without changing unopted generic grab behavior.
    if(this.grabHitboxBody&&this.donkeykongCatchPoseConsumer.owns(this.grabHitboxBody)){
      this.donkeykongCatchPoseConsumer.forget(this.grabHitboxBody);
      despawnHitbox(this.scene,this.grabHitboxBody);
      this.grabHitboxBody=null;
      this.donkeykongCatchCollisionDiagnostic=null;
    }
    // Transient hitboxes (dive shockwaves) are sensors in the world too.
    this.clearTransientHitboxes();
    this.clearPlacedTraps();
    // Guard every matter.world access — by SHUTDOWN time the scene's
    // Matter plugin may already be torn down (the Phaser scene-stop
    // sequence destroys plugins before scene.destroy hooks fire). The
    // listeners are also auto-released when the world is gone, so the
    // off() calls are belt-and-braces cleanup, not load-bearing.
    const world = this.scene?.matter?.world ?? null;
    if (this.collisionStartListener) {
      world?.off('collisionstart', this.collisionStartListener);
      world?.off('collisionactive', this.collisionStartListener);
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
    this.onIntrinsicSourceInterrupted();this.clearIntrinsicSourceHitbox();
    this.donkeykongJabContinuation=null;this.donkeykongJabContinuationEligibleStep=false;
    this.restoreSourcedGroundFriction();
    this.clearLedgeAttackAttachment();
    this.clearPikachuLedgeAttachment();
    this.shieldPresentation = null;
    this.pikachuSpecialRuntime?.interruptAction();
    this.shockwaveRepeat = null;
    this.shieldReleaseRemaining = 0;
    this.shieldReleaseCanParry = false;
    this.shieldParryStunRemaining = 0;
    this.shieldParryProtected = false;
    this.landingRecovery = false;
    this.ordinaryLandingRemaining = 0;
    this.aerialLandingContext = null;
    this.landingAttackInstance = null;
    this.landingAttackActivationPending = false;
    this.specialFallLandingFrames = null;
    // Damage, capture, footstool, trip, ledge catch and reset interrupt an
    // acting dodge too (spot, roll or air; intangible hits never reach here).
    // Preserve the spent air-dodge resource until ground/ledge recovery.
    if (isDodgeActing(this.dodgeState)) this.dodgeState = resetDodgeState();
    this.airDodgeBurst = null;
    this.airDodgeGravityVelocityY = 0;
    // Transient hitboxes (dive shockwaves) outlive the active attack, so
    // clear them here too — a respawn / teleport must not leave a stale
    // sensor in the world or a half-finished dive's latches set.
    this.clearTransientHitboxes();
    this.diveShockwaveSpawned = false;
    this.diveHoldFrames = 0;
    this.multiHitNextIndex = 0;
    this.pendingCounterRetaliation = null;
    // Damage, capture, ledge catch and reset end a shooting session too.
    this.itemShooting = null;
    if (!this.activeAttack) return;
    if(this.id==='donkeykong')this.donkeykongLastAttackEndFrame=this.simulationInputFrame;
    if (this.activeAttack.hitboxBody) {
      despawnHitbox(this.scene, this.activeAttack.hitboxBody);
    }
    this.activeAttack = null;
  }

  // -------------------------------------------------------------------------
  // Internal — collision contact tracking
  // -------------------------------------------------------------------------

  /**
   * A live, solid platform contact supports the fighter only when its
   * normal points upward toward the fighter. Reading the current pair also
   * handles a contact changing from floor to side without a new start event.
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
    if (pair.isActive === false || pair.isSensor || this.body.isSensor ||
        other.isSensor || other.collisionFilter?.mask === 0) return false;
    if (pair.collision) {
      const direction = pair.bodyA === this.body ? 1 : -1;
      return pair.collision.normal.y * direction < -0.5;
    }
    // Minimal scene adapters can omit normals. Real Matter pairs always
    // provide one, so gameplay never classifies a side wall by center alone.
    return other.position.y > this.body.position.y;
  }

  private onCollisionStart(event: CollisionEventLike): void {
    if (this.destroyed) return;
    for (const pair of event.pairs) {
      if (pair.bodyA === this.body) this.contactPairs.set(pair.bodyB, pair);
      else if (pair.bodyB === this.body) this.contactPairs.set(pair.bodyA, pair);
    }
    this.configureLedgeAttackPairs();
    this.configurePikachuLedgeAttachmentPairs();
  }

  private onCollisionEnd(event: CollisionEventLike): void {
    if (this.destroyed) return;
    for (const pair of event.pairs) {
      if (pair.bodyA === this.body) this.contactPairs.delete(pair.bodyB);
      else if (pair.bodyB === this.body) this.contactPairs.delete(pair.bodyA);
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
    ...(base.backwardRoll === undefined && overrides.backwardRoll === undefined ? {} : {
      backwardRoll: { ...base.backwardRoll, ...overrides.backwardRoll },
    }),
    air: overrides.air !== undefined ? { ...base.air, ...overrides.air } : base.air,
    ...(base.directionalAir === undefined && overrides.directionalAir === undefined ? {} : {
      directionalAir: { ...base.directionalAir, ...overrides.directionalAir },
    }),
    ...((overrides.directionalAirUpRecoveryFrames ?? base.directionalAirUpRecoveryFrames) === undefined ? {} : {
      directionalAirUpRecoveryFrames: overrides.directionalAirUpRecoveryFrames ?? base.directionalAirUpRecoveryFrames,
    }),
    ...((overrides.directionalAirDownRecoveryFrames ?? base.directionalAirDownRecoveryFrames) === undefined ? {} : {
      directionalAirDownRecoveryFrames: overrides.directionalAirDownRecoveryFrames ?? base.directionalAirDownRecoveryFrames,
    }),
    ...((overrides.directionalAirUpDiagonalRecoveryFrames ?? base.directionalAirUpDiagonalRecoveryFrames) === undefined ? {} : {
      directionalAirUpDiagonalRecoveryFrames: overrides.directionalAirUpDiagonalRecoveryFrames ?? base.directionalAirUpDiagonalRecoveryFrames,
    }),
    ...((overrides.directionalAirDownDiagonalRecoveryFrames ?? base.directionalAirDownDiagonalRecoveryFrames) === undefined ? {} : {
      directionalAirDownDiagonalRecoveryFrames: overrides.directionalAirDownDiagonalRecoveryFrames ?? base.directionalAirDownDiagonalRecoveryFrames,
    }),
    stickThreshold: overrides.stickThreshold ?? base.stickThreshold,
  };
}
