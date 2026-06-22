/**
 * Kirby — twelfth roster slot, the multi-jump inhale puffball.
 *
 * Role: floaty grappler / brawler. Light mass (6) and a slow run, but a
 * cast-leading FIVE jumps and a low fall acceleration make the air his
 * home. Distinct from Puff (the pure float-and-rest balloon): Kirby is a
 * close-range INHALE grappler with a heavy stone plummet and a rising
 * sword finisher — his identity is the command grab + the stall-and-fall
 * stone, not Puff's slumber-slam float game. Mirrors the Smash "Kirby"
 * archetype: inhale (command grab), final cutter (rising multi-hit),
 * stone (stall-and-fall), hammer/dash approach.
 *
 * Stats (vs the cast — see `KIRBY_MOVEMENT_PROFILE`):
 *
 *   maxRunSpeed   5.5        slow — the puffball commits in the air
 *   mass          6          tied-lightest (with Puff) — dies early
 *   fallAccel     0.10       floaty — second only to Puff (0.08)
 *   maxJumps      5          cast-leading multi-jump (ties Puff)
 *   width/height  52×52      round puffball silhouette
 *
 * Signature moves:
 *
 *   • Neutral special ("inhale") — `commandGrab` schema: a short-range
 *     grab that on connect holds then launches; unblockable (grabs beat
 *     shield). His proactive close-range grab.
 *   • Side special ("hammer dash") — `dashStrike` schema: a forward burst
 *     approach with a heavy hit at the head of the dash, closing the gap
 *     his slow walk can't.
 *   • Up special ("final cutter") — `multiHitRising` schema: a rising
 *     multi-hit sword with a launcher at the apex; his recovery + anti-air.
 *   • Down special ("stone") — `stallAndFall` schema: a brief hover, then
 *     a heavy stone plummet with a landing shockwave. The puffball's
 *     plummet / edge-guard tool.
 *
 * Every numeric here is a frozen literal — no randomness, no
 * wall-clock — so identical inputs always replay identically.
 */

import type Phaser from 'phaser';
import { ContractFighter } from './contractFighter';
import { type CharacterTuning } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AttackMove, AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';
import type { CommandGrabSpecialMove } from './specialSchema';
import type { DashStrikeSideSpecialMove } from './sideSpecialSchema';
import type { MultiHitRisingUpSpecialMove } from './upSpecialSchema';
import type { StallAndFallDownSpecialMove } from './downSpecialSchema';
import type { GrabSpec } from './grabSchema';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import type {
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
} from './movesetContract';
import { KIRBY_MOVEMENT_PROFILE } from './fighterMovementProfiles';

export { KIRBY_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `KIRBY_MOVEMENT_PROFILE`; the
 * round 52×52 puffball body stays inline because it's collision data.
 */
export const KIRBY_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...KIRBY_MOVEMENT_PROFILE,
  width: 52,
  height: 52,
  chamfer: 12, // round silhouette
};

/** Kirby's jab — a quick puff punch that opens his jab string. */
export const KIRBY_JAB: AttackMoveWithAnimation = {
  id: 'kirby.jab',
  type: 'jab',
  damage: 4,
  knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 22, offsetY: -2, width: 28, height: 16 },
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 8,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'kirby.jab2' },
};

/** Kirby's jab string — stage 2. A faster follow-up jab, links to jab3. */
export const KIRBY_JAB2: AttackMoveWithAnimation = {
  id: 'kirby.jab2',
  type: 'jab',
  damage: 3,
  knockback: { x: 1.2, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 24, offsetY: -2, width: 28, height: 16 },
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 7,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'kirby.jab3' },
};

/** Kirby's jab string — finisher (a spinning kick flurry that launches). */
export const KIRBY_JAB3: AttackMoveWithAnimation = {
  id: 'kirby.jab3',
  type: 'jab',
  damage: 5,
  knockback: { x: 3.0, y: -1.5, scaling: 0.14, baseMagnitude: 0.9 },
  hitbox: { offsetX: 26, offsetY: -2, width: 32, height: 18 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 14,
  cooldownFrames: 18,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/** Kirby's forward tilt — a roundhouse puff kick. */
export const KIRBY_TILT: AttackMoveWithAnimation = {
  id: 'kirby.tilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 2.0, y: -0.6, scaling: 0.12 },
  hitbox: { offsetX: 26, offsetY: -2, width: 34, height: 18 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 11,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/** Kirby's forward smash — a heavy flying kick. His close-range KO. */
export const KIRBY_SMASH: AttackMoveWithAnimation = {
  id: 'kirby.smash',
  type: 'smash',
  damage: 15,
  knockback: { x: 4.0, y: -1.4, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 15,
    maxDamage: 21,
    minKnockback: { x: 4.0, y: -1.4, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
    maxKnockback: { x: 5.6, y: -1.96, scaling: 0.5, baseMagnitude: 1.3, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 30, offsetY: -2, width: 40, height: 20 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** Kirby's neutral aerial — a body-centred puff spin. */
export const KIRBY_NAIR: AerialMove = {
  id: 'kirby.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 7,
  knockback: { x: 1.5, y: -0.9, scaling: 0.11 },
  hitbox: { offsetX: 0, offsetY: -2, width: 46, height: 40 },
  startupFrames: 4,
  activeFrames: 6,
  recoveryFrames: 11,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 9,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/** Kirby's forward aerial — a three-hit-feel forward kick. */
export const KIRBY_FAIR: AerialMove = {
  id: 'kirby.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 8,
  knockback: { x: 2.1, y: -0.8, scaling: 0.17 },
  hitbox: { offsetX: 24, offsetY: -2, width: 36, height: 20 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 13,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  landingLagFrames: 12,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** Kirby's back aerial — a reverse drill kick; his horizontal aerial KO. */
export const KIRBY_BAIR: AerialMove = {
  id: 'kirby.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 11,
  knockback: { x: 2.7, y: -1.0, scaling: 0.26 },
  hitbox: { offsetX: 24, offsetY: -2, width: 36, height: 20 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 11,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 14,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
};

/** Kirby's up aerial — an overhead flip kick; his juggle launcher. */
export const KIRBY_UAIR: AerialMove = {
  id: 'kirby.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 8,
  knockback: { x: 0.3, y: -3.1, scaling: 0.2 },
  hitbox: { offsetX: 0, offsetY: -28, width: 34, height: 28 },
  startupFrames: 5,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 7,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 8,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** Kirby's down aerial — a downward drill kick; a multi-hit-feel spike. */
export const KIRBY_DAIR: AerialMove = {
  id: 'kirby.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 10,
  knockback: { x: 0.4, y: 3.4, scaling: 0.23 },
  hitbox: { offsetX: 0, offsetY: 26, width: 30, height: 26 },
  startupFrames: 8,
  activeFrames: 5,
  recoveryFrames: 16,
  cooldownFrames: 9,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  landingLagFrames: 16,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** Kirby's up-tilt — a quick overhead arch kick; anti-air juggle starter. */
export const KIRBY_UTILT: AttackMoveWithAnimation = {
  id: 'kirby.utilt',
  type: 'tilt',
  damage: 6,
  knockback: { x: 0.2, y: -2.2, scaling: 0.15 },
  hitbox: { offsetX: 12, offsetY: -22, width: 56, height: 50 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/** Kirby's up-smash — a rising overhead headbutt; his vertical KO. */
export const KIRBY_USMASH: AttackMoveWithAnimation = {
  id: 'kirby.usmash',
  type: 'smash',
  damage: 16,
  knockback: { x: 0.3, y: -3.6, scaling: 0.42, baseMagnitude: 1.3, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 16,
    maxDamage: 22.4,
    minKnockback: { x: 0.3, y: -3.6, scaling: 0.42, baseMagnitude: 1.3, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -5.04, scaling: 0.525, baseMagnitude: 1.3, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 12, offsetY: -28, width: 56, height: 62 },
  startupFrames: 11,
  activeFrames: 4,
  recoveryFrames: 19,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** Kirby's down-tilt — a low sliding kick; a trip/combo starter. */
export const KIRBY_DTILT: AttackMoveWithAnimation = {
  id: 'kirby.dtilt',
  type: 'tilt',
  damage: 6,
  knockback: { x: 1.5, y: -0.5, scaling: 0.08 },
  hitbox: { offsetX: 24, offsetY: 20, width: 36, height: 14 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/** Kirby's down-smash — a two-sided floor split kick; his horizontal KO. */
export const KIRBY_DSMASH: AttackMoveWithAnimation = {
  id: 'kirby.dsmash',
  type: 'smash',
  damage: 15,
  knockback: { x: 4.0, y: -1.0, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 15,
    maxDamage: 21,
    minKnockback: { x: 4.0, y: -1.0, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
    maxKnockback: { x: 5.6, y: -1.4, scaling: 0.5, baseMagnitude: 1.3, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 26, offsetY: 14, width: 52, height: 16 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 17,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** Kirby's dash-attack — a running cartwheel kick; a combo-starter approach. */
export const KIRBY_DASHATTACK: AttackMoveWithAnimation = {
  id: 'kirby.dashAttack',
  type: 'tilt',
  damage: 9,
  knockback: { x: 2.5, y: -1.1, scaling: 0.17 },
  hitbox: { offsetX: 28, offsetY: -2, width: 40, height: 22 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 15,
  cooldownFrames: 15,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Kirby's neutral special — **inhale** (`commandGrab` schema). A
 * short-range grab that on connect holds the victim then launches them.
 * Unblockable (grabs beat shield). His proactive close-range grab — the
 * opening grab hitbox IS the move's `hitbox` field.
 */
export const KIRBY_NEUTRAL_SPECIAL: CommandGrabSpecialMove = {
  id: 'kirby.neutral_special',
  type: 'special',
  specialKind: 'commandGrab',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 30, offsetY: -3, width: 40, height: 40 },
  startupFrames: 8,
  activeFrames: 6,
  recoveryFrames: 22,
  cooldownFrames: 18,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 4 },
  grab: {
    grabHoldFrames: 16,
    throwDamage: 14,
    throwKnockback: { x: 3.6, y: -1.5, scaling: 0.32 },
    ignoresShield: true,
  },
};

/**
 * Kirby's side special — **hammer dash** (`dashStrike` schema). A forward
 * burst approach with a heavy hit at the head of the dash, closing the
 * gap his slow walk can't. Neutral-game tool, not a recovery
 * (`helplessAfterDash: false`).
 */
export const KIRBY_SIDE_SPECIAL: DashStrikeSideSpecialMove = {
  id: 'kirby.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 13,
  knockback: { x: 3.1, y: -1.1, scaling: 0.26 },
  hitbox: { offsetX: 26, offsetY: -2, width: 46, height: 26 },
  startupFrames: 8,
  activeFrames: 8,
  recoveryFrames: 18,
  cooldownFrames: 18,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 4 },
  dashStrike: {
    dashSpeed: 14, // ≈ 840 px/s — well past his slow max run (5.5)
    dashFrames: 6, // ¾ of the 8-frame active window
    helplessAfterDash: false,
  },
};

/**
 * Kirby's up special — **final cutter** (`multiHitRising` schema). A
 * rising multi-hit sword: two link hits pin the target against the
 * ascent, a launcher at the apex sends them up. His recovery + anti-air.
 */
export const KIRBY_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'kirby.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  damage: 3,
  knockback: { x: 0, y: -0.5, scaling: 0.03 },
  hitbox: { offsetX: 0, offsetY: -4, width: 36, height: 46 },
  startupFrames: 5,
  activeFrames: 14,
  recoveryFrames: 20,
  cooldownFrames: 18,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 2 },
  multiHitRising: {
    riseImpulse: -17, // strong rise — the floaty puffball recovers high
    driftImpulse: 1.0,
    hitCount: 3,
    hitInterval: 5, // hits at active-frames [0, 5, 10] — inside the 14
    linkDamage: 3,
    linkKnockback: { x: 0, y: -0.5, scaling: 0.03 },
    launcherDamage: 6,
    launcherKnockback: { x: 0.6, y: -3.2, scaling: 0.3 },
  },
};

/**
 * Kirby's down special — **stone** (`stallAndFall` schema). A brief hover,
 * then a heavy stone plummet with a landing shockwave at his feet. The
 * puffball's plummet / edge-guard tool.
 */
export const KIRBY_DOWN_SPECIAL: StallAndFallDownSpecialMove = {
  id: 'kirby.down_special',
  type: 'downSpecial',
  downSpecialKind: 'stallAndFall',
  // Move-level damage / knockback are the METEOR (descent) values; +y is
  // downward in Phaser screen-space — the spike trajectory.
  damage: 12,
  knockback: { x: 0.4, y: 3.5, scaling: 0.27 },
  hitbox: { offsetX: 0, offsetY: 2, width: 46, height: 50 },
  startupFrames: 4,
  activeFrames: 16,
  recoveryFrames: 19,
  cooldownFrames: 18,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 3 },
  stallAndFall: {
    stallFrames: 6, // first 6 of 16 active frames are the hover
    stallVelocity: -2, // slight hover before the drop
    fallVelocity: 28, // heavy stone plummet
    shockwaveDamage: 6,
    shockwaveKnockback: { x: 1.8, y: -1.0, scaling: 0.14 },
    shockwaveHitbox: {
      offsetX: 0,
      offsetY: 24, // at his feet (body half-height = 26)
      width: 130,
      height: 18,
    },
    helplessAfterFall: false,
  },
};

/**
 * Kirby's grab — standing grab with cast-average timing. Throws are
 * balanced: back is the kill throw, up starts juggles into the final
 * cutter, down resets, forward repositions.
 */
export const KIRBY_GRAB: GrabSpec = {
  id: 'kirby.grab',
  hitbox: { offsetX: 22, offsetY: -2, width: 22, height: 28 },
  startupFrames: 6,
  activeFrames: 2,
  whiffRecoveryFrames: 30,
  holdFramesMax: 88,
  throwRecoveryFrames: 22,
  pummel: { damage: 1.3, cooldownFrames: 12 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 8, knockback: { x: 2.5, y: -1.0, scaling: 0.11 }, animationFrames: 20 },
    back:    { damage: 10, knockback: { x: 2.9, y: -1.2, scaling: 0.13 }, animationFrames: 24 },
    up:      { damage: 7, knockback: { x: 0.4, y: -3.1, scaling: 0.1 }, animationFrames: 15 },
    down:    { damage: 6, knockback: { x: 0.9, y: 1.1, scaling: 0.08 }, animationFrames: 16 },
  },
};

/** Kirby's full 10-slot uniform moveset — canonical {@link FighterMoveset} shape. */
export const KIRBY_MOVESET: FighterMoveset = Object.freeze({
  jab: KIRBY_JAB,
  tilt: KIRBY_TILT,
  smash: KIRBY_SMASH,
  fair: KIRBY_FAIR,
  neutralSpecial: KIRBY_NEUTRAL_SPECIAL,
  sideSpecial: KIRBY_SIDE_SPECIAL,
  upSpecial: KIRBY_UP_SPECIAL,
  downSpecial: KIRBY_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/** Kirby's full {@link FighterContract} declaration. */
export const KIRBY_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'kirby',
  moveset: KIRBY_MOVESET,
  movementProfile: KIRBY_MOVEMENT_PROFILE,
});

/** Kirby-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface KirbyOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Kirby fighter (multi-jump inhale puffball). Inherits all base movement
 * / jump physics from `Character` via {@link ContractFighter}; the kit
 * wires through the same `registerFighterAttack` + `setGrabSpec` path as
 * the rest of the cast.
 */
export class Kirby extends ContractFighter {
  readonly moveset: FighterMoveset = KIRBY_MOVESET;
  readonly movementProfile: FighterMovementProfile = KIRBY_MOVEMENT_PROFILE;
  readonly contract: FighterContract = KIRBY_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: KirbyOptions) {
    super(scene, {
      id: 'kirby',
      ...KIRBY_TUNING,
      ...options,
    });
    registerFighterAttack(this, KIRBY_JAB);
    registerFighterAttack(this, KIRBY_JAB2);
    registerFighterAttack(this, KIRBY_JAB3);
    registerFighterAttack(this, KIRBY_TILT);
    registerFighterAttack(this, KIRBY_SMASH);
    registerFighterAttack(this, KIRBY_NAIR);
    registerFighterAttack(this, KIRBY_FAIR);
    registerFighterAttack(this, KIRBY_BAIR);
    registerFighterAttack(this, KIRBY_UAIR);
    registerFighterAttack(this, KIRBY_DAIR);
    registerFighterAttack(this, KIRBY_UTILT);
    registerFighterAttack(this, KIRBY_USMASH);
    this.setUpTilt(KIRBY_UTILT.id);
    this.setUpSmash(KIRBY_USMASH.id);
    registerFighterAttack(this, KIRBY_DTILT);
    registerFighterAttack(this, KIRBY_DSMASH);
    registerFighterAttack(this, KIRBY_DASHATTACK);
    this.setDownTilt(KIRBY_DTILT.id);
    this.setDownSmash(KIRBY_DSMASH.id);
    this.setDashAttack(KIRBY_DASHATTACK.id);
    registerFighterAttack(this, KIRBY_NEUTRAL_SPECIAL);
    registerFighterAttack(this, KIRBY_SIDE_SPECIAL);
    registerFighterAttack(this, KIRBY_UP_SPECIAL);
    registerFighterAttack(this, KIRBY_DOWN_SPECIAL);

    this.setGrabSpec(KIRBY_GRAB);
  }

  /**
   * Kirby's wake-up attack — a two-sided spin kick clearing both flanks
   * as the puffball rolls back to his feet. Cast-baseline 6 % with a
   * solid pop.
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 6,
      knockback: { x: 3.8, y: -2.8, scaling: 0.13 },
      hitbox: { offsetX: 0, offsetY: 0, width: 88, height: 40 },
      activeFrames: 6,
    };
  }

  /**
   * Kirby's ledge attack — a forward roll kick clearing the edge corner
   * as the puffball climbs back onto the stage.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 7,
      knockback: { x: 3.8, y: -2.4, scaling: 0.15 },
      hitbox: { offsetX: 12, offsetY: -2, width: 78, height: 50 },
      activeFrames: 8,
    };
  }
}
