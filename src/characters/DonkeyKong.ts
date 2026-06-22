/**
 * Donkey Kong — thirteenth roster slot, the mobile heavyweight bruiser.
 *
 * Role: mobile heavyweight. Heavy mass (18 — between Wolf's 16 and Bear's
 * 20) but, unlike Bear (the slow immovable grappler wall), DK is MOBILE:
 * a real run speed (8.0, the cast baseline) and decent air control let
 * the big ape chase and approach. His identity is heavyweight HITS
 * delivered with mobility — a chargeable giant punch, a shoulder-charge
 * approach, a spinning-kong recovery, and a ground-pound. Distinct from
 * Bear (immovable wall, command-grab + tether) and from Blaze (the fast
 * light-heavy rushdown): DK is the heavy who keeps up. Mirrors the Smash
 * "Donkey Kong" archetype.
 *
 * Stats (vs the cast — see `DONKEYKONG_MOVEMENT_PROFILE`):
 *
 *   maxRunSpeed   8.0        real run — fast for a heavyweight (vs Bear 6.0)
 *   mass          18         heavy — between Wolf (16) and Bear (20)
 *   fallAccel     0.32       drops with weight, but air-control stays usable
 *   width/height  60×84      the largest silhouette in the cast
 *
 * Signature moves:
 *
 *   • Neutral special ("giant punch") — `charge` schema: a chargeable
 *     haymaker, a real KO at a bare press and devastating at full charge.
 *   • Side special ("shoulder charge") — `dashStrike` schema: a forward
 *     burst with a heavy hit; the mobile heavyweight's gap-closer.
 *   • Up special ("spinning kong") — `multiHitRising` schema: a rising
 *     spin, multiple link hits + a launcher; his recovery + anti-air.
 *   • Down special ("ground pound") — `groundPound` schema: a hop into a
 *     heavy downward slam with a wide landing shockwave.
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
import type { ChargeSpecialMove } from './specialSchema';
import type { DashStrikeSideSpecialMove } from './sideSpecialSchema';
import type { MultiHitRisingUpSpecialMove } from './upSpecialSchema';
import type { GroundPoundDownSpecialMove } from './downSpecialSchema';
import type { GrabSpec } from './grabSchema';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import type {
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
} from './movesetContract';
import { DONKEYKONG_MOVEMENT_PROFILE } from './fighterMovementProfiles';

export { DONKEYKONG_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `DONKEYKONG_MOVEMENT_PROFILE`;
 * the large 60×84 ape body stays inline because it's collision data.
 */
export const DONKEYKONG_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...DONKEYKONG_MOVEMENT_PROFILE,
  width: 60,
  height: 84,
  chamfer: 10,
};

/** DK's jab — a heavy hook that opens his jab string. */
export const DONKEYKONG_JAB: AttackMoveWithAnimation = {
  id: 'donkeykong.jab',
  type: 'jab',
  damage: 6,
  knockback: { x: 1.6, y: -0.4, scaling: 0.07 },
  hitbox: { offsetX: 30, offsetY: -4, width: 38, height: 18 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'donkeykong.jab2' },
};

/** DK's jab string — stage 2. A second heavy hook, links to jab3. */
export const DONKEYKONG_JAB2: AttackMoveWithAnimation = {
  id: 'donkeykong.jab2',
  type: 'jab',
  damage: 5,
  knockback: { x: 1.4, y: -0.3, scaling: 0.06 },
  hitbox: { offsetX: 32, offsetY: -4, width: 38, height: 18 },
  startupFrames: 4,
  activeFrames: 2,
  recoveryFrames: 9,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'donkeykong.jab3' },
};

/** DK's jab string — finisher (a two-fisted smash that launches). */
export const DONKEYKONG_JAB3: AttackMoveWithAnimation = {
  id: 'donkeykong.jab3',
  type: 'jab',
  damage: 8,
  knockback: { x: 3.6, y: -1.7, scaling: 0.17, baseMagnitude: 1.1 },
  hitbox: { offsetX: 34, offsetY: -4, width: 42, height: 22 },
  startupFrames: 6,
  activeFrames: 3,
  recoveryFrames: 16,
  cooldownFrames: 20,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/** DK's forward tilt — a heavy forearm swipe with strong reach. */
export const DONKEYKONG_TILT: AttackMoveWithAnimation = {
  id: 'donkeykong.tilt',
  type: 'tilt',
  damage: 10,
  knockback: { x: 2.4, y: -0.6, scaling: 0.15 },
  hitbox: { offsetX: 34, offsetY: -4, width: 46, height: 20 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 13,
  cooldownFrames: 16,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/** DK's forward smash — a giant two-handed clap. His hardest grounded KO. */
export const DONKEYKONG_SMASH: AttackMoveWithAnimation = {
  id: 'donkeykong.smash',
  type: 'smash',
  damage: 18,
  knockback: { x: 4.4, y: -1.5, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 18,
    maxDamage: 25.2,
    minKnockback: { x: 4.4, y: -1.5, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 6.16, y: -2.1, scaling: 0.52, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 36, offsetY: -4, width: 48, height: 24 },
  startupFrames: 15,
  activeFrames: 4,
  recoveryFrames: 20,
  cooldownFrames: 24,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** DK's neutral aerial — a wide spinning slap to cover his landing. */
export const DONKEYKONG_NAIR: AerialMove = {
  id: 'donkeykong.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 9,
  knockback: { x: 1.7, y: -0.9, scaling: 0.13 },
  hitbox: { offsetX: 0, offsetY: -2, width: 56, height: 48 },
  startupFrames: 6,
  activeFrames: 6,
  recoveryFrames: 13,
  cooldownFrames: 10,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 12,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** DK's forward aerial — a heavy overhand swipe; a strong aerial poke. */
export const DONKEYKONG_FAIR: AerialMove = {
  id: 'donkeykong.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 11,
  knockback: { x: 2.5, y: -0.8, scaling: 0.2 },
  hitbox: { offsetX: 28, offsetY: -3, width: 44, height: 24 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 15,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  landingLagFrames: 16,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** DK's back aerial — a reverse double-kick; his strongest aerial KO. */
export const DONKEYKONG_BAIR: AerialMove = {
  id: 'donkeykong.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 13,
  knockback: { x: 3.0, y: -1.0, scaling: 0.28 },
  hitbox: { offsetX: 26, offsetY: -3, width: 42, height: 22 },
  startupFrames: 10,
  activeFrames: 4,
  recoveryFrames: 16,
  cooldownFrames: 13,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 18,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
};

/** DK's up aerial — an overhead headbutt; his juggle launcher. */
export const DONKEYKONG_UAIR: AerialMove = {
  id: 'donkeykong.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 11,
  knockback: { x: 0.3, y: -3.4, scaling: 0.22 },
  hitbox: { offsetX: 0, offsetY: -32, width: 40, height: 32 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 15,
  cooldownFrames: 9,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 12,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** DK's down aerial — a downward stomp; a heavy meteor spike. */
export const DONKEYKONG_DAIR: AerialMove = {
  id: 'donkeykong.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 13,
  knockback: { x: 0.4, y: 3.7, scaling: 0.25 },
  hitbox: { offsetX: 0, offsetY: 30, width: 38, height: 30 },
  startupFrames: 10,
  activeFrames: 4,
  recoveryFrames: 19,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 20,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** DK's up-tilt — a quick overhead arm sweep; anti-air juggle starter. */
export const DONKEYKONG_UTILT: AttackMoveWithAnimation = {
  id: 'donkeykong.utilt',
  type: 'tilt',
  damage: 9,
  knockback: { x: 0.2, y: -2.4, scaling: 0.16 },
  hitbox: { offsetX: 14, offsetY: -26, width: 68, height: 58 },
  startupFrames: 6,
  activeFrames: 3,
  recoveryFrames: 11,
  cooldownFrames: 13,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/** DK's up-smash — a rising two-fisted overhead; his vertical KO. */
export const DONKEYKONG_USMASH: AttackMoveWithAnimation = {
  id: 'donkeykong.usmash',
  type: 'smash',
  damage: 19,
  knockback: { x: 0.3, y: -3.9, scaling: 0.44, baseMagnitude: 1.4, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 19,
    maxDamage: 26.6,
    minKnockback: { x: 0.3, y: -3.9, scaling: 0.44, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -5.46, scaling: 0.55, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 14, offsetY: -32, width: 72, height: 72 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 21,
  cooldownFrames: 24,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** DK's down-tilt — a low knuckle sweep at the feet; a trip/combo starter. */
export const DONKEYKONG_DTILT: AttackMoveWithAnimation = {
  id: 'donkeykong.dtilt',
  type: 'tilt',
  damage: 8,
  knockback: { x: 1.7, y: -0.5, scaling: 0.09 },
  hitbox: { offsetX: 32, offsetY: 34, width: 44, height: 16 },
  startupFrames: 6,
  activeFrames: 3,
  recoveryFrames: 11,
  cooldownFrames: 13,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/** DK's down-smash — a two-sided floor clap; his horizontal KO. */
export const DONKEYKONG_DSMASH: AttackMoveWithAnimation = {
  id: 'donkeykong.dsmash',
  type: 'smash',
  damage: 17,
  knockback: { x: 4.4, y: -1.0, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 17,
    maxDamage: 23.8,
    minKnockback: { x: 4.4, y: -1.0, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 6.16, y: -1.4, scaling: 0.52, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 30, offsetY: 18, width: 60, height: 18 },
  startupFrames: 14,
  activeFrames: 4,
  recoveryFrames: 19,
  cooldownFrames: 24,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** DK's dash-attack — a running roll into a heavy hit; a combo-starter approach. */
export const DONKEYKONG_DASHATTACK: AttackMoveWithAnimation = {
  id: 'donkeykong.dashAttack',
  type: 'tilt',
  damage: 11,
  knockback: { x: 2.7, y: -1.1, scaling: 0.18 },
  hitbox: { offsetX: 32, offsetY: -2, width: 46, height: 24 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 17,
  cooldownFrames: 17,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * DK's neutral special — **giant punch** (`charge` schema). A chargeable
 * haymaker: a real KO threat at a bare press and devastating at full
 * charge. Move-level damage / knockback carry the MIN-CHARGE (bare-press)
 * values; the charge block carries the full-charge endpoint.
 */
export const DONKEYKONG_NEUTRAL_SPECIAL: ChargeSpecialMove = {
  id: 'donkeykong.neutral_special',
  type: 'special',
  specialKind: 'charge',
  damage: 18,
  knockback: { x: 4.6, y: -1.5, scaling: 0.36, baseMagnitude: 2.0, damageGrowth: 0.5 },
  hitbox: { offsetX: 34, offsetY: -4, width: 48, height: 30 },
  startupFrames: 18,
  activeFrames: 6,
  recoveryFrames: 24,
  cooldownFrames: 28,
  animation: { startupFrames: 3, activeFrames: 2, recoveryFrames: 3 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60, // a long wind-up — patient charging is rewarded
    minDamage: 18,
    maxDamage: 28, // full charge is a devastating KO
    minKnockback: { x: 4.6, y: -1.5, scaling: 0.36 },
    maxKnockback: { x: 6.2, y: -2.0, scaling: 0.5 },
  },
};

/**
 * DK's side special — **shoulder charge** (`dashStrike` schema). A forward
 * burst with a heavy hit at the head of the dash; the mobile heavyweight's
 * gap-closer. Neutral-game tool, not a recovery (`helplessAfterDash:
 * false`).
 */
export const DONKEYKONG_SIDE_SPECIAL: DashStrikeSideSpecialMove = {
  id: 'donkeykong.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 14,
  knockback: { x: 3.4, y: -1.1, scaling: 0.28 },
  hitbox: { offsetX: 30, offsetY: -3, width: 50, height: 28 },
  startupFrames: 8,
  activeFrames: 8,
  recoveryFrames: 19,
  cooldownFrames: 18,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 4 },
  dashStrike: {
    dashSpeed: 17, // ≈ 1020 px/s — well past his run (480 px/s)
    dashFrames: 6, // ¾ of the 8-frame active window
    helplessAfterDash: false,
  },
};

/**
 * DK's up special — **spinning kong** (`multiHitRising` schema). A rising
 * spin: three link hits pin the target against the ascent, a launcher at
 * the apex sends them up. His recovery + anti-air; strong forward drift so
 * the heavyweight can angle back to the ledge.
 */
export const DONKEYKONG_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'donkeykong.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  damage: 3,
  knockback: { x: 0, y: -0.5, scaling: 0.03 },
  hitbox: { offsetX: 0, offsetY: -4, width: 44, height: 50 },
  startupFrames: 5,
  activeFrames: 16,
  recoveryFrames: 22,
  cooldownFrames: 18,
  animation: { startupFrames: 1, activeFrames: 5, recoveryFrames: 2 },
  multiHitRising: {
    riseImpulse: -15, // a heavyweight's recovery — solid but not floaty
    driftImpulse: 1.4, // strong forward drift to angle back to the ledge
    hitCount: 3,
    hitInterval: 5, // hits at active-frames [0, 5, 10] — inside the 16
    linkDamage: 3,
    linkKnockback: { x: 0, y: -0.5, scaling: 0.03 },
    launcherDamage: 7,
    launcherKnockback: { x: 0.6, y: -3.4, scaling: 0.32 },
  },
};

/**
 * DK's down special — **ground pound** (`groundPound` schema). A hop into
 * a heavy downward slam: the descent body is a meteor, the landing
 * shockwave a wide clean-up hit. Heavyweight numbers.
 */
export const DONKEYKONG_DOWN_SPECIAL: GroundPoundDownSpecialMove = {
  id: 'donkeykong.down_special',
  type: 'downSpecial',
  downSpecialKind: 'groundPound',
  // Move-level damage / knockback are the METEOR (descent) values; +y is
  // downward in Phaser screen-space — the spike trajectory.
  damage: 13,
  knockback: { x: 0.4, y: 3.5, scaling: 0.3 },
  hitbox: { offsetX: 0, offsetY: 0, width: 48, height: 50 },
  startupFrames: 6,
  activeFrames: 14,
  recoveryFrames: 22,
  cooldownFrames: 24,
  animation: { startupFrames: 1, activeFrames: 5, recoveryFrames: 2 },
  groundPound: {
    hopFrames: 3, // first 3 of 14 active frames are the hop
    hopImpulse: -9,
    slamVelocity: 26, // heavy plunge speed
    shockwaveDamage: 9,
    shockwaveKnockback: { x: 2.2, y: -1.2, scaling: 0.18 },
    shockwaveHitbox: {
      offsetX: 0,
      offsetY: 40, // at his feet (body half-height = 42)
      width: 160, // wide shockwave — the big ape's footprint
      height: 20,
    },
  },
};

/**
 * DK's grab — a strong standing grab. Throws hit hard for a heavyweight:
 * back is a kill throw, up starts juggles into spinning kong / up-air,
 * forward repositions, down resets to the floor.
 */
export const DONKEYKONG_GRAB: GrabSpec = {
  id: 'donkeykong.grab',
  hitbox: { offsetX: 30, offsetY: -2, width: 28, height: 34 },
  startupFrames: 8,
  activeFrames: 2,
  whiffRecoveryFrames: 32,
  holdFramesMax: 90,
  throwRecoveryFrames: 24,
  pummel: { damage: 1.8, cooldownFrames: 14 },
  dashGrab: { rangeBonusX: 14, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 11, knockback: { x: 2.9, y: -1.1, scaling: 0.13 }, animationFrames: 22 },
    back:    { damage: 13, knockback: { x: 3.3, y: -1.3, scaling: 0.15 }, animationFrames: 26 },
    up:      { damage: 9, knockback: { x: 0.4, y: -3.4, scaling: 0.12 }, animationFrames: 16 },
    down:    { damage: 8, knockback: { x: 0.9, y: 1.2, scaling: 0.09 }, animationFrames: 17 },
  },
};

/** DK's full 10-slot uniform moveset — canonical {@link FighterMoveset} shape. */
export const DONKEYKONG_MOVESET: FighterMoveset = Object.freeze({
  jab: DONKEYKONG_JAB,
  tilt: DONKEYKONG_TILT,
  smash: DONKEYKONG_SMASH,
  fair: DONKEYKONG_FAIR,
  neutralSpecial: DONKEYKONG_NEUTRAL_SPECIAL,
  sideSpecial: DONKEYKONG_SIDE_SPECIAL,
  upSpecial: DONKEYKONG_UP_SPECIAL,
  downSpecial: DONKEYKONG_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/** DK's full {@link FighterContract} declaration. */
export const DONKEYKONG_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'donkeykong',
  moveset: DONKEYKONG_MOVESET,
  movementProfile: DONKEYKONG_MOVEMENT_PROFILE,
});

/** DK-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface DonkeyKongOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Donkey Kong fighter (mobile heavyweight bruiser). Inherits all base
 * movement / jump physics from `Character` via {@link ContractFighter};
 * the kit wires through the same `registerFighterAttack` + `setGrabSpec`
 * path as the rest of the cast.
 */
export class DonkeyKong extends ContractFighter {
  readonly moveset: FighterMoveset = DONKEYKONG_MOVESET;
  readonly movementProfile: FighterMovementProfile = DONKEYKONG_MOVEMENT_PROFILE;
  readonly contract: FighterContract = DONKEYKONG_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: DonkeyKongOptions) {
    super(scene, {
      id: 'donkeykong',
      ...DONKEYKONG_TUNING,
      ...options,
    });
    registerFighterAttack(this, DONKEYKONG_JAB);
    registerFighterAttack(this, DONKEYKONG_JAB2);
    registerFighterAttack(this, DONKEYKONG_JAB3);
    registerFighterAttack(this, DONKEYKONG_TILT);
    registerFighterAttack(this, DONKEYKONG_SMASH);
    registerFighterAttack(this, DONKEYKONG_NAIR);
    registerFighterAttack(this, DONKEYKONG_FAIR);
    registerFighterAttack(this, DONKEYKONG_BAIR);
    registerFighterAttack(this, DONKEYKONG_UAIR);
    registerFighterAttack(this, DONKEYKONG_DAIR);
    registerFighterAttack(this, DONKEYKONG_UTILT);
    registerFighterAttack(this, DONKEYKONG_USMASH);
    this.setUpTilt(DONKEYKONG_UTILT.id);
    this.setUpSmash(DONKEYKONG_USMASH.id);
    registerFighterAttack(this, DONKEYKONG_DTILT);
    registerFighterAttack(this, DONKEYKONG_DSMASH);
    registerFighterAttack(this, DONKEYKONG_DASHATTACK);
    this.setDownTilt(DONKEYKONG_DTILT.id);
    this.setDownSmash(DONKEYKONG_DSMASH.id);
    this.setDashAttack(DONKEYKONG_DASHATTACK.id);
    registerFighterAttack(this, DONKEYKONG_NEUTRAL_SPECIAL);
    registerFighterAttack(this, DONKEYKONG_SIDE_SPECIAL);
    registerFighterAttack(this, DONKEYKONG_UP_SPECIAL);
    registerFighterAttack(this, DONKEYKONG_DOWN_SPECIAL);

    this.setGrabSpec(DONKEYKONG_GRAB);
  }

  /**
   * DK's wake-up attack — a two-sided ground-clap sweep clearing both
   * flanks as the big ape rises. A touch harder than the cast baseline,
   * fitting his heavyweight mass.
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 7,
      knockback: { x: 4.4, y: -2.8, scaling: 0.14 },
      hitbox: { offsetX: 0, offsetY: 0, width: 108, height: 46 },
      activeFrames: 6,
    };
  }

  /**
   * DK's ledge attack — a forward arm-swing clearing the edge corner as
   * the big ape climbs back onto the stage. Tall + wide for his large body.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 9,
      knockback: { x: 4.4, y: -2.4, scaling: 0.16 },
      hitbox: { offsetX: 16, offsetY: -2, width: 96, height: 72 },
      activeFrames: 8,
    };
  }
}
