/**
 * Link — eleventh roster slot, the projectile-swordsman zoner.
 *
 * Role: zoner / swordsman hybrid. Medium mass (12) and medium run (7.8)
 * built around a wall of projectiles backed by a real sword. Link wants
 * to control the neutral with an arrow, a boomerang, and a bomb, then
 * convert the openings they create with disjointed sword normals.
 * Distinct from Nova (the pure ranged armour-cannon zoner): Link is a
 * mid-range swordsman who *throws things*, not a slow stand-and-charge
 * cannon — faster and lighter than Nova, with a sword reach his ranged
 * tools set up. Mirrors the Smash "Link" archetype: arrow + boomerang +
 * bomb projectile suite, hookshot tether recovery, master-sword normals.
 *
 * Stats (vs the cast — see `LINK_MOVEMENT_PROFILE`):
 *
 *   maxRunSpeed   7.8        medium — between Wolf (7.5) and Aegis (8.0)
 *   mass          12         medium — squarely middleweight
 *   fallAccel     0.30       mid descent — committed but not a fast-faller
 *   width/height  46×72      tall swordsman silhouette
 *
 * Signature moves:
 *
 *   • Neutral special ("hero's bow") — `projectile` schema: a fast
 *     forward arrow, his core spacing tool. Travelling sensor body, no
 *     melee hitbox.
 *   • Side special ("boomerang") — `multiHit` schema: a forward
 *     boomerang whose chained hits read as the throw-out + return passes
 *     (the side-special schema has no projectile kind, so the boomerang
 *     is modelled as chained ranged hits, same idiom as Nova's missile).
 *   • Up special ("hookshot / spin") — `tether` schema: a hookshot line
 *     fired in the facing direction that latches a ledge and reels Link
 *     in. The canonical Link tether recovery.
 *   • Down special ("bomb") — `trap` schema: a timed bomb dropped/placed
 *     that detonates on a fuse, with a small self-bounce (bomb-jump).
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
import type { ProjectileSpecialMove } from './specialSchema';
import type { MultiHitSideSpecialMove } from './sideSpecialSchema';
import type { TetherUpSpecialMove } from './upSpecialSchema';
import type { TrapDownSpecialMove } from './downSpecialSchema';
import type { GrabSpec } from './grabSchema';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import type {
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
} from './movesetContract';
import { LINK_MOVEMENT_PROFILE } from './fighterMovementProfiles';

export { LINK_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `LINK_MOVEMENT_PROFILE`; the
 * tall 46×72 swordsman body stays inline because it's collision data.
 */
export const LINK_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...LINK_MOVEMENT_PROFILE,
  width: 46,
  height: 72,
  chamfer: 8,
};

/**
 * Link's jab — a quick sword poke that opens his jab string. Honest
 * close-range option; his real game lives in the projectile wall.
 */
export const LINK_JAB: AttackMoveWithAnimation = {
  id: 'link.jab',
  type: 'jab',
  damage: 5,
  knockback: { x: 1.5, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 26, offsetY: -3, width: 34, height: 16 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 13,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'link.jab2' },
};

/** Link's jab string — stage 2. Faster follow-up slash, links to jab3. */
export const LINK_JAB2: AttackMoveWithAnimation = {
  id: 'link.jab2',
  type: 'jab',
  damage: 4,
  knockback: { x: 1.3, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 28, offsetY: -3, width: 34, height: 16 },
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 8,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'link.jab3' },
};

/** Link's jab string — finisher (the spin-slash launcher). */
export const LINK_JAB3: AttackMoveWithAnimation = {
  id: 'link.jab3',
  type: 'jab',
  damage: 6,
  knockback: { x: 3.3, y: -1.6, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 30, offsetY: -3, width: 38, height: 20 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 15,
  cooldownFrames: 19,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/** Link's forward tilt — a horizontal sword swing with disjointed reach. */
export const LINK_TILT: AttackMoveWithAnimation = {
  id: 'link.tilt',
  type: 'tilt',
  damage: 8,
  knockback: { x: 2.2, y: -0.6, scaling: 0.13 },
  hitbox: { offsetX: 30, offsetY: -3, width: 40, height: 18 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 15,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/** Link's forward smash — a heavy two-hit-feel overhead chop. His close-range KO. */
export const LINK_SMASH: AttackMoveWithAnimation = {
  id: 'link.smash',
  type: 'smash',
  damage: 16,
  knockback: { x: 4.0, y: -1.4, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 16,
    maxDamage: 22.4,
    minKnockback: { x: 4.0, y: -1.4, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
    maxKnockback: { x: 5.6, y: -1.96, scaling: 0.5, baseMagnitude: 1.3, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 34, offsetY: -3, width: 44, height: 20 },
  startupFrames: 14,
  activeFrames: 4,
  recoveryFrames: 19,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** Link's neutral aerial — a body-centred sword spin to cover his landing. */
export const LINK_NAIR: AerialMove = {
  id: 'link.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 8,
  knockback: { x: 1.6, y: -0.9, scaling: 0.12 },
  hitbox: { offsetX: 0, offsetY: -2, width: 50, height: 42 },
  startupFrames: 5,
  activeFrames: 6,
  recoveryFrames: 12,
  cooldownFrames: 9,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** Link's forward aerial — a double-slash poke; his disjointed wall in the air. */
export const LINK_FAIR: AerialMove = {
  id: 'link.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 9,
  knockback: { x: 3.5, y: -1.2, scaling: 0.22 },
  hitbox: { offsetX: 26, offsetY: -3, width: 40, height: 20 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  landingLagFrames: 14,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** Link's back aerial — a reverse sword smash; his horizontal aerial KO. */
export const LINK_BAIR: AerialMove = {
  id: 'link.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 11,
  knockback: { x: 4.5, y: -1.65, scaling: 0.30 },
  hitbox: { offsetX: 24, offsetY: -3, width: 38, height: 20 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 15,
  cooldownFrames: 12,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 16,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
};

/** Link's up aerial — an overhead sword thrust; his juggle launcher. */
export const LINK_UAIR: AerialMove = {
  id: 'link.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 9,
  knockback: { x: 0.3, y: -3.9, scaling: 0.35 },
  hitbox: { offsetX: 0, offsetY: -30, width: 34, height: 30 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** Link's down aerial — a downward sword plunge; a meteor spike. */
export const LINK_DAIR: AerialMove = {
  id: 'link.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 11,
  knockback: { x: 0.4, y: 3.5, scaling: 0.24 },
  hitbox: { offsetX: 0, offsetY: 28, width: 32, height: 28 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 18,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/** Link's up-tilt — a quick upward sword arc; fast anti-air juggle starter. */
export const LINK_UTILT: AttackMoveWithAnimation = {
  id: 'link.utilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 0.2, y: -2.3, scaling: 0.16 },
  hitbox: { offsetX: 8, offsetY: -22, width: 60, height: 52 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/** Link's up-smash — a triple-hit-feel rising sword; his vertical KO. */
export const LINK_USMASH: AttackMoveWithAnimation = {
  id: 'link.usmash',
  type: 'smash',
  damage: 17,
  knockback: { x: 0.3, y: -3.7, scaling: 0.42, baseMagnitude: 1.3, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 17,
    maxDamage: 23.8,
    minKnockback: { x: 0.3, y: -3.7, scaling: 0.42, baseMagnitude: 1.3, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -5.18, scaling: 0.525, baseMagnitude: 1.3, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 8, offsetY: -28, width: 60, height: 66 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 20,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** Link's down-tilt — a low sword sweep at the feet; a trip/combo starter. */
export const LINK_DTILT: AttackMoveWithAnimation = {
  id: 'link.dtilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 1.6, y: -0.5, scaling: 0.08 },
  hitbox: { offsetX: 28, offsetY: 30, width: 40, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/** Link's down-smash — a two-sided floor sweep; his horizontal KO. */
export const LINK_DSMASH: AttackMoveWithAnimation = {
  id: 'link.dsmash',
  type: 'smash',
  damage: 16,
  knockback: { x: 4.2, y: -1.0, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 16,
    maxDamage: 22.4,
    minKnockback: { x: 4.2, y: -1.0, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
    maxKnockback: { x: 5.88, y: -1.4, scaling: 0.5, baseMagnitude: 1.3, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 28, offsetY: 14, width: 56, height: 16 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/** Link's dash-attack — a running lunging slash; a combo-starter approach. */
export const LINK_DASHATTACK: AttackMoveWithAnimation = {
  id: 'link.dashAttack',
  type: 'tilt',
  damage: 10,
  knockback: { x: 2.6, y: -1.1, scaling: 0.18 },
  hitbox: { offsetX: 30, offsetY: -2, width: 42, height: 22 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 16,
  cooldownFrames: 16,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Link's neutral special — **hero's bow** (`projectile` schema). A fast
 * forward arrow: his core neutral spacing tool. The move's own hitbox is
 * degenerate — all the damage rides the spawned arrow body.
 */
export const LINK_NEUTRAL_SPECIAL: ProjectileSpecialMove = {
  id: 'link.neutral_special',
  type: 'special',
  specialKind: 'projectile',
  damage: 8,
  knockback: { x: 2.0, y: -0.6, scaling: 0.11 },
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 16,
  // Small post-recovery buffer only — the visible recovery is the real
  // commitment. A long hidden cooldown made the bow feel unresponsive: the
  // animation finished but a re-press was eaten for ~0.27s. (was 16)
  cooldownFrames: 5,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  projectile: {
    speed: 16, // ≈ 960 px/s — a fast arrow that crosses space quickly
    lifetimeFrames: 75,
    width: 28,
    height: 12,
    spawnOffsetX: 38,
    spawnOffsetY: -8,
  },
};

/**
 * Link's side special — **boomerang** (`multiHit` schema). Three chained
 * hits reading as the throw-out lead, the mid pass, and the returning
 * catch-launcher. Long reach so it reads as a mid-range zoning wall, like
 * the canonical Link boomerang (the side-special schema has no projectile
 * kind, so the boomerang is modelled as chained ranged hits).
 */
export const LINK_SIDE_SPECIAL: MultiHitSideSpecialMove = {
  id: 'link.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'multiHit',
  damage: 4,
  knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 42, offsetY: -4, width: 54, height: 22 },
  startupFrames: 7,
  activeFrames: 14,
  recoveryFrames: 16,
  // Small post-recovery buffer only (was 18) — boomerang re-throw now responds
  // as soon as the throw animation finishes.
  cooldownFrames: 6,
  animation: { startupFrames: 2, activeFrames: 4, recoveryFrames: 3 },
  multiHit: {
    hitCount: 3,
    hitInterval: 5, // hits at active-frames [0, 5, 10]
    damagePerHit: [4, 3, 6],
    knockbackPerHit: [
      { x: 1.4, y: -0.4, scaling: 0.06 }, // throw-out — link
      { x: 1.2, y: -0.3, scaling: 0.05 }, // mid pass — link
      { x: 2.6, y: -1.2, scaling: 0.24 }, // returning catch — launcher
    ],
    chainWindowFrames: 10,
  },
};

/**
 * Link's up special — **hookshot / spin** (`tether` schema). A hookshot
 * line fired in the facing direction; on a ledge contact it latches and
 * reels Link in — the canonical Link tether recovery. Schema invariant:
 * `extensionSpeed * extensionFrames === maxRange` (28 * 10 === 280).
 */
export const LINK_UP_SPECIAL: TetherUpSpecialMove = {
  id: 'link.up_special',
  type: 'upSpecial',
  upSpecialKind: 'tether',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 6,
  activeFrames: 10,
  recoveryFrames: 28,
  // The 28f recovery is already the commitment; trim the hidden cooldown so
  // the grounded re-use feels responsive. (was 16)
  cooldownFrames: 6,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 4 },
  tether: {
    maxRange: 280, // = extensionSpeed * extensionFrames
    extensionSpeed: 28,
    extensionFrames: 10, // = activeFrames; line reaches max at end of active
    reelSpeed: 30, // brisk reel-in
    reelFrames: 28,
    tetherTipDamage: 4,
    tetherTipKnockback: { x: 1.6, y: -0.4, scaling: 0.08 },
    lineWidth: 8,
  },
};

/**
 * Link's down special — **bomb** (`trap` schema, timed-bomb tuning). He
 * places a bomb at his feet that detonates on its own fuse for a light
 * blast; a small self-bounce gives a bomb-jump recovery mix-up. Up to two
 * bombs can be out. The value is trap pressure + the recovery tech, not
 * raw KO power.
 */
export const LINK_DOWN_SPECIAL: TrapDownSpecialMove = {
  id: 'link.down_special',
  type: 'downSpecial',
  downSpecialKind: 'trap',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 12,
  // Bomb output is already gated by the 2-bomb-out limit; trim the hidden
  // cooldown so placing the next bomb responds right after the animation. (was 14)
  cooldownFrames: 6,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  trap: {
    trapWidth: 40,
    trapHeight: 40,
    spawnOffsetX: 0,
    spawnOffsetY: 28, // dropped at his feet (body half-height ≈ 36)
    armDelayFrames: 0, // unused for a fused bomb — overridden by the fuse
    trapLifetimeFrames: 60, // unused — overridden to fuse + blast window
    trapDamage: 6, // a light bomb
    trapKnockback: { x: 1.1, y: -1.8, scaling: 0.13 },
    maxActiveTraps: 2,
    fuseDetonateFrames: 52, // ~0.85 s fuse
    selfBounceVelocity: -9, // bomb-jump self-bounce
  },
};

/**
 * Link's grab — standing grab with cast-average timing. Throws reset to
 * mid-range so he can re-establish his projectile wall (forward / back)
 * or start a juggle (up).
 */
export const LINK_GRAB: GrabSpec = {
  id: 'link.grab',
  hitbox: { offsetX: 25, offsetY: -2, width: 24, height: 30 },
  startupFrames: 7,
  activeFrames: 2,
  whiffRecoveryFrames: 30,
  holdFramesMax: 88,
  throwRecoveryFrames: 22,
  pummel: { damage: 1.4, cooldownFrames: 12 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 9,  knockback: { x: 4.0, y: -1.5, scaling: 0.25 }, animationFrames: 20 }, // KO from edge ~160%, center ~250%
    back:    { damage: 10, knockback: { x: 5.0, y: -1.9, scaling: 0.30 }, animationFrames: 24 }, // KO from center ~152%
    up:      { damage: 7,  knockback: { x: 0.5, y: -5.5, scaling: 0.35 }, animationFrames: 15 }, // vertical KO ~140%
    down:    { damage: 6,  knockback: { x: 0.9, y: 1.1, scaling: 0.08 },  animationFrames: 16 }, // combo throw — no KO
  },
};

/** Link's full 10-slot uniform moveset — canonical {@link FighterMoveset} shape. */
export const LINK_MOVESET: FighterMoveset = Object.freeze({
  jab: LINK_JAB,
  tilt: LINK_TILT,
  smash: LINK_SMASH,
  fair: LINK_FAIR,
  neutralSpecial: LINK_NEUTRAL_SPECIAL,
  sideSpecial: LINK_SIDE_SPECIAL,
  upSpecial: LINK_UP_SPECIAL,
  downSpecial: LINK_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/** Link's full {@link FighterContract} declaration. */
export const LINK_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'link',
  moveset: LINK_MOVESET,
  movementProfile: LINK_MOVEMENT_PROFILE,
});

/** Link-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface LinkOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Link fighter (Zelda-inspired projectile swordsman). Inherits all base
 * movement / jump physics from `Character` via {@link ContractFighter};
 * the kit wires through the same `registerFighterAttack` + `setGrabSpec`
 * path as the rest of the cast.
 */
export class Link extends ContractFighter {
  readonly moveset: FighterMoveset = LINK_MOVESET;
  readonly movementProfile: FighterMovementProfile = LINK_MOVEMENT_PROFILE;
  readonly contract: FighterContract = LINK_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: LinkOptions) {
    super(scene, {
      id: 'link',
      ...LINK_TUNING,
      ...options,
    });
    registerFighterAttack(this, LINK_JAB);
    registerFighterAttack(this, LINK_JAB2);
    registerFighterAttack(this, LINK_JAB3);
    registerFighterAttack(this, LINK_TILT);
    registerFighterAttack(this, LINK_SMASH);
    registerFighterAttack(this, LINK_NAIR);
    registerFighterAttack(this, LINK_FAIR);
    registerFighterAttack(this, LINK_BAIR);
    registerFighterAttack(this, LINK_UAIR);
    registerFighterAttack(this, LINK_DAIR);
    registerFighterAttack(this, LINK_UTILT);
    registerFighterAttack(this, LINK_USMASH);
    this.setUpTilt(LINK_UTILT.id);
    this.setUpSmash(LINK_USMASH.id);
    registerFighterAttack(this, LINK_DTILT);
    registerFighterAttack(this, LINK_DSMASH);
    registerFighterAttack(this, LINK_DASHATTACK);
    this.setDownTilt(LINK_DTILT.id);
    this.setDownSmash(LINK_DSMASH.id);
    this.setDashAttack(LINK_DASHATTACK.id);
    registerFighterAttack(this, LINK_NEUTRAL_SPECIAL);
    registerFighterAttack(this, LINK_SIDE_SPECIAL);
    registerFighterAttack(this, LINK_UP_SPECIAL);
    registerFighterAttack(this, LINK_DOWN_SPECIAL);

    this.setGrabSpec(LINK_GRAB);
  }

  /**
   * Link's wake-up attack — a two-sided sword sweep clearing both flanks
   * as he climbs back to his feet. Cast-baseline 6 % with a solid pop.
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 6,
      knockback: { x: 4.0, y: -2.8, scaling: 0.13 },
      hitbox: { offsetX: 0, offsetY: 0, width: 92, height: 42 },
      activeFrames: 6,
    };
  }

  /**
   * Link's ledge attack — a forward sword swing clearing the edge corner
   * as he climbs back onto the stage. Tall to match the swordsman body.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 8,
      knockback: { x: 4.0, y: -2.4, scaling: 0.15 },
      hitbox: { offsetX: 14, offsetY: -2, width: 84, height: 62 },
      activeFrames: 8,
    };
  }
}
