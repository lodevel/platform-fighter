/**
 * Puff (Jigglypuff) — sixth roster slot, the balloon air-ace.
 *
 * Role: floaty. By far the most aerial fighter in the cast: FIVE
 * jumps, near-zero fall acceleration (0.08 — half of Owl's 0.16), the
 * lowest terminal velocity (6.5), and the strongest air control
 * (airAccel 0.6). On the ground she's the slowest fighter shipped;
 * in the air she weaves around everyone. The trade is the lightest
 * mass in the cast (6) — one clean smash sends her to the blast zone
 * before anyone else.
 *
 * Stats (vs the cast — see `PUFF_MOVEMENT_PROFILE`):
 *
 *   maxRunSpeed   5.0   (▼)  slowest ground game in the cast
 *   airAccel      0.6   (▲)  best air control in the cast
 *   maxJumps      5     (▲)  five jumps — the balloon recovery
 *   mass          6     (▼)  lightest — launches earliest
 *   fallAccel     0.08  (▼)  barely falls
 *   maxFallSpeed  6.5   (▼)  lowest terminal velocity
 *   width/height  56×56      round balloon silhouette
 *
 * Kit identity: weak pokes everywhere — jab 3 %, tilt 6 %, the softest
 * grounded triplet shipped — wrapped around one enormous gamble:
 *
 *   • Down special ("slumber slam", the Rest analogue) — 22 % with
 *     `baseMagnitude: 3` (a launch floor bigger than most smashes'
 *     scaled output) on a point-blank body sensor, behind a 2-frame
 *     startup. Miss it and the 50-frame recovery is the longest
 *     punish window in the game.
 *   • Side special — `dashStrike` rollout: she tucks into a ball and
 *     barrels forward, her only real ground-approach tool.
 *
 * Every numeric here is a frozen literal — no randomness, no
 * wall-clock — so identical inputs always replay identically.
 */

import type Phaser from 'phaser';
import { ContractFighter } from './contractFighter';
import { type CharacterTuning } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AttackMoveWithAnimation } from './moveSchema';
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
import { PUFF_MOVEMENT_PROFILE } from './fighterMovementProfiles';

// Re-export — per-fighter API surface; literal data lives in
// `fighterMovementProfiles.ts` (same split as the rest of the cast).
export { PUFF_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `PUFF_MOVEMENT_PROFILE`; the
 * round 56×56 body (biggest chamfer in the cast) stays inline because
 * it's hurtbox / collision data.
 */
export const PUFF_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...PUFF_MOVEMENT_PROFILE,
  // Round balloon silhouette — square body with a heavy chamfer so the
  // collision corners read as a ball. Procedural placeholder body: no
  // source sprite cell to match yet.
  width: 56,
  height: 56,
  chamfer: 14,
};

/**
 * Puff's jab — the softest grounded poke in the cast (3 %). Exists to
 * interrupt, never to win exchanges; her real damage lives in the air
 * and in the slumber-slam gamble.
 */
export const PUFF_JAB: AttackMoveWithAnimation = {
  id: 'puff.jab',
  type: 'jab',
  damage: 3,
  knockback: { x: 1.2, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 20, offsetY: -2, width: 26, height: 14 },
  startupFrames: 3,
  activeFrames: 3,
  recoveryFrames: 8,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  // Jab-combo opener: a re-press once jab1's hitbox is out advances to
  // jab2 → jab3 (the finisher). Tier 4.
  jabChain: { nextId: 'puff.jab2' },
};

/**
 * Puff's jab string — stage 2. A quick follow-up poke that chains from
 * {@link PUFF_JAB} on a re-press and itself links to the {@link PUFF_JAB3}
 * finisher. Registered as a `'jab'` move but never the light slot
 * (first-registered jab1 keeps it) — reachable ONLY via the chain link.
 */
export const PUFF_JAB2: AttackMoveWithAnimation = {
  id: 'puff.jab2',
  type: 'jab',
  damage: 2,
  knockback: { x: 1.1, y: -0.3, scaling: 0.04 },
  hitbox: { offsetX: 22, offsetY: -2, width: 26, height: 14 },
  startupFrames: 2,
  activeFrames: 2,
  recoveryFrames: 7,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'puff.jab3' },
};

/**
 * Puff's jab string — finisher (stage 3). The launcher that ends the
 * string: more knockback + a base-magnitude floor so it pops the
 * opponent away even at low percent. No `jabChain` — the chain
 * terminates here, and its `cooldownFrames` is the post-string lockout.
 */
export const PUFF_JAB3: AttackMoveWithAnimation = {
  id: 'puff.jab3',
  type: 'jab',
  damage: 3,
  knockback: { x: 2.4, y: -1.4, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 22, offsetY: -2, width: 30, height: 16 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 14,
  cooldownFrames: 18,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Puff's forward tilt — stubby spacing slap. Weak (6 %) but quick to
 * recycle; mostly a "get off me" tool before she retreats skyward.
 */
export const PUFF_TILT: AttackMoveWithAnimation = {
  id: 'puff.tilt',
  type: 'tilt',
  damage: 6,
  knockback: { x: 1.7, y: -0.5, scaling: 0.1 },
  hitbox: { offsetX: 24, offsetY: -2, width: 30, height: 15 },
  startupFrames: 5,
  activeFrames: 4,
  recoveryFrames: 11,
  cooldownFrames: 13,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Puff's forward smash — full-body lunge. Her hardest conventional
 * hit (11 %) yet still the weakest smash in the cast; the percent gap
 * to a real finisher is exactly the niche the slumber slam fills.
 */
export const PUFF_SMASH: AttackMoveWithAnimation = {
  id: 'puff.smash',
  type: 'smash',
  damage: 11,
  knockback: { x: 3.4, y: -1.2, scaling: 0.3, baseMagnitude: 1.0, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 11,
    maxDamage: 15.4,
    minKnockback: { x: 3.4, y: -1.2, scaling: 0.3, baseMagnitude: 1.0, damageGrowth: 0.5 },
    maxKnockback: { x: 4.76, y: -1.68, scaling: 0.375, baseMagnitude: 1.0, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 27, offsetY: -2, width: 34, height: 16 },
  startupFrames: 11,
  activeFrames: 4,
  recoveryFrames: 16,
  cooldownFrames: 20,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Puff's neutral aerial — body-centred drift bump. Long active window
 * + tiny landing lag: with five jumps and the best air accel she can
 * wall opponents out with overlapping nairs ("fade-back" pressure).
 */
export const PUFF_NAIR: AerialMove = {
  id: 'puff.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 6,
  knockback: { x: 1.3, y: -0.8, scaling: 0.1 },
  hitbox: { offsetX: 0, offsetY: -1, width: 46, height: 42 },
  startupFrames: 4,
  activeFrames: 7,
  recoveryFrames: 10,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 7,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/**
 * Puff's forward aerial — drifting kick. Modest numbers; the value is
 * the cycle rate (5-frame startup, 8-frame landing lag) under her
 * five-jump weave.
 */
export const PUFF_FAIR: AerialMove = {
  id: 'puff.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 7,
  knockback: { x: 1.9, y: -0.7, scaling: 0.14 },
  hitbox: { offsetX: 22, offsetY: -2, width: 32, height: 18 },
  startupFrames: 5,
  activeFrames: 5,
  recoveryFrames: 10,
  cooldownFrames: 9,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 2 },
  landingLagFrames: 8,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/**
 * Puff's back aerial — the "wall of pain" kick. Her strongest
 * conventional aerial (9 %): chained off-stage under five jumps it
 * carries opponents to the side blast zone one bump at a time.
 */
export const PUFF_BAIR: AerialMove = {
  id: 'puff.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 9,
  knockback: { x: 2.5, y: -0.9, scaling: 0.24 },
  hitbox: { offsetX: 22, offsetY: -2, width: 34, height: 18 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Puff's up aerial — the floaty juggle engine. Her strongest aerial
 * tool not by raw damage (8 %, still weak) but by how relentlessly it
 * loops: a soft upward pop on a fast 5-frame startup with tiny landing
 * lag, so under her five-jump budget she re-rises and re-uairs the same
 * launched opponent over and over. Upward hitbox (negative offsetY),
 * upward knockback (negative y) — pure vertical launch, the canonical
 * Jigglypuff "bounce them on your head" multi-purpose aerial.
 */
export const PUFF_UAIR: AerialMove = {
  id: 'puff.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 8,
  knockback: { x: 0.2, y: -2.8, scaling: 0.18 },
  hitbox: { offsetX: 0, offsetY: -30, width: 32, height: 26 },
  startupFrames: 5,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 8,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/**
 * Puff's down aerial — a fluttering downward stomp / spike. Weak (7 %)
 * like the rest of her kit but it carries a genuine meteor vector
 * (positive y) on a downward hitbox (positive offsetY). Off-stage,
 * under five jumps, she can float out, tap a recovering opponent down,
 * and float back — a low-damage but stock-threatening edgeguard. Slower
 * startup + heavier landing lag than her other aerials so the spike
 * stays committal.
 */
export const PUFF_DAIR: AerialMove = {
  id: 'puff.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 7,
  knockback: { x: 0.3, y: 3.0, scaling: 0.2 },
  hitbox: { offsetX: 0, offsetY: 26, width: 30, height: 24 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 14,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Puff's up-tilt — a quick upward bop above her head. The softest,
 * fastest anti-air in the cast (5 %, 4-frame startup): low-commitment
 * juggle-starter that pops a grounded or low-airborne opponent up into
 * her five-jump uair loop. Upward hitbox (negative offsetY), upward
 * knockback (negative y); a poke, never a finisher — that's the
 * up-smash's job.
 */
export const PUFF_UTILT: AttackMoveWithAnimation = {
  id: 'puff.utilt',
  type: 'tilt',
  damage: 5,
  knockback: { x: 0.2, y: -2.0, scaling: 0.14 },
  hitbox: { offsetX: 11, offsetY: -19, width: 72, height: 48 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Puff's up-smash — an overhead headbutt, her grounded vertical KO.
 * Modest by smash standards (13 %, the weakest smash tier in the cast
 * alongside her forward smash) and slow to commit (12-frame startup),
 * but it carries a real upward launch: mirrors PUFF_SMASH's knockback
 * SHAPE (`baseMagnitude: 1.0`, `damageGrowth: 0.5`) redirected straight
 * up. The "charge it under a juggled opponent" finisher when the uair
 * loop has stacked enough percent — and, off the slumber slam, her only
 * conventional grounded KO option.
 */
export const PUFF_USMASH: AttackMoveWithAnimation = {
  id: 'puff.usmash',
  type: 'smash',
  damage: 13,
  knockback: { x: 0.3, y: -3.3, scaling: 0.38, baseMagnitude: 1.0, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 13,
    maxDamage: 18.2,
    minKnockback: { x: 0.3, y: -3.3, scaling: 0.38, baseMagnitude: 1.0, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -4.62, scaling: 0.475, baseMagnitude: 1.0, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 13, offsetY: -25, width: 76, height: 60 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 20,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Puff's down-tilt — a low crouching poke at an opponent's feet. The
 * fastest grounded option in her kit (5-frame startup, even with the
 * soft jab) and tuned as the canonical low combo-poke: a LOW hitbox
 * (positive offsetY +12, short 14px height) right at floor level, and a
 * near-horizontal "trip"-style launch (tiny -0.4 y) that pops a grounded
 * opponent just off the ground at a low angle — exactly the slide-into-
 * something Puff wants since her real damage lives in the air. Weak
 * (4 %) and quick to recycle, between her jab (3 %) and forward tilt
 * (6 %): a spacing / combo-starter, never a finisher.
 */
export const PUFF_DTILT: AttackMoveWithAnimation = {
  id: 'puff.dtilt',
  type: 'tilt',
  damage: 4,
  knockback: { x: 1.6, y: -0.4, scaling: 0.08 },
  hitbox: { offsetX: 22, offsetY: 21, width: 30, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Puff's down-smash — a low sweeping spin at the feet, her grounded
 * HORIZONTAL KO. A wide, flat hitbox hugging the floor (large 54px
 * width, low 16px height, positive offsetY +12) that catches opponents
 * on the ground to either side, launching them outward and low (strong
 * x, slight -y). Mirrors the knockback SHAPE of her forward smash
 * (`baseMagnitude: 1.0`, `damageGrowth: 0.5`) — still the weak-smash
 * tier her whole kit sits in (12 %), so it spaces and edges out rather
 * than reliably KO-ing from centre. Slow to commit (13-frame startup):
 * the grounded sideways finisher to pair with her up-smash's vertical
 * one, while the slumber slam stays the real payoff.
 */
export const PUFF_DSMASH: AttackMoveWithAnimation = {
  id: 'puff.dsmash',
  type: 'smash',
  damage: 12,
  knockback: { x: 3.3, y: -0.9, scaling: 0.32, baseMagnitude: 1.0, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 12,
    maxDamage: 16.8,
    minKnockback: { x: 3.3, y: -0.9, scaling: 0.32, baseMagnitude: 1.0, damageGrowth: 0.5 },
    maxKnockback: { x: 4.62, y: -1.26, scaling: 0.4, baseMagnitude: 1.0, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 0, offsetY: 12, width: 54, height: 16 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 17,
  cooldownFrames: 20,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Puff's dash-attack — a forward tumbling lunge thrown out of a run.
 * Her burst approach tool: covers a sliver of the ground her 5.0 run
 * speed never will (forward hitbox, positive offsetX +24) and pops the
 * target up-and-forward (moderate x, soft -y) into her five-jump uair
 * juggle space — a combo-starter, not a KO. Weaker than her smashes
 * (7 %) with a medium 7-frame startup; lighter and faster than the
 * heavyweights' running burst, in keeping with the floaty lightweight
 * identity.
 */
export const PUFF_DASHATTACK: AttackMoveWithAnimation = {
  id: 'puff.dashAttack',
  type: 'tilt',
  damage: 7,
  knockback: { x: 2.2, y: -1.4, scaling: 0.14 },
  hitbox: { offsetX: 24, offsetY: -2, width: 34, height: 22 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 13,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Puff's neutral special — **deep breath** (`charge` schema). She
 * inhales, swelling up, and releases a point-blank air burst. Bare
 * press is a weak 6 % puff; a full 60-frame hold reaches 16 % with a
 * real launch. The long max-charge mirrors her patient, drift-around
 * game plan — she charges mid-air between jumps.
 */
export const PUFF_NEUTRAL_SPECIAL: ChargeSpecialMove = {
  id: 'puff.neutral_special',
  type: 'special',
  specialKind: 'charge',
  // Move-level damage / knockback carry the MIN-CHARGE values.
  damage: 6,
  knockback: { x: 1.5, y: -0.5, scaling: 0.08 },
  hitbox: { offsetX: 24, offsetY: -2, width: 36, height: 26 },
  startupFrames: 5,
  activeFrames: 10,
  recoveryFrames: 14,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 3, recoveryFrames: 3 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 6,
    maxDamage: 16,
    minKnockback: { x: 1.5, y: -0.5, scaling: 0.08 },
    maxKnockback: { x: 3.2, y: -1.3, scaling: 0.3 },
  },
};

/**
 * Puff's side special — **rollout** (`dashStrike` schema). She tucks
 * into a ball and barrels forward — her only real ground-approach
 * burst, covering the distance her 5.0 run speed never will. Slower
 * dash than the rushdown variants (16 vs Blaze's 20) with a longer
 * active window: a rolling ball, not a piercing lunge.
 */
export const PUFF_SIDE_SPECIAL: DashStrikeSideSpecialMove = {
  id: 'puff.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 11,
  knockback: { x: 3.0, y: -0.8, scaling: 0.24 },
  // Ball-shaped body-attached sensor — slightly ahead of centre so the
  // leading edge of the roll connects first.
  hitbox: { offsetX: 10, offsetY: -1, width: 48, height: 40 },
  startupFrames: 8,
  activeFrames: 10,
  recoveryFrames: 20,
  cooldownFrames: 22,
  animation: { startupFrames: 2, activeFrames: 3, recoveryFrames: 3 },
  dashStrike: {
    dashSpeed: 16, // ≈ 960 px/s — triple her max run (300 px/s)
    dashFrames: 9, // most of the 10-frame active window
    helplessAfterDash: false,
  },
};

/**
 * Puff's up special — **spiral float** (`multiHitRising` schema). A
 * gentle two-hit corkscrew rise. Deliberately the weakest recovery
 * special in the cast (riseImpulse -12) because her REAL recovery is
 * the five-jump budget; the move exists for the slot contract and as
 * a soft juggle-escape with a popping launcher.
 */
export const PUFF_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'puff.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  // Move-level damage / knockback carry the LINK-HIT values.
  damage: 2,
  knockback: { x: 0, y: -0.3, scaling: 0.02 },
  hitbox: { offsetX: 0, offsetY: -2, width: 40, height: 44 },
  startupFrames: 5,
  activeFrames: 12,
  recoveryFrames: 16,
  cooldownFrames: 16,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 2 },
  multiHitRising: {
    riseImpulse: -12, // softest rise in the cast — jumps are her recovery
    driftImpulse: 0.5,
    hitCount: 2,
    hitInterval: 6, // hits at active-frames [0, 6] — inside the 12
    linkDamage: 2,
    linkKnockback: { x: 0, y: -0.3, scaling: 0.02 },
    launcherDamage: 6,
    launcherKnockback: { x: 0.4, y: -2.6, scaling: 0.24 },
  },
};

/**
 * Puff's down special — **slumber slam**, the Rest analogue
 * (`groundPound` schema, point-blank tuning).
 *
 * The high-risk high-reward centrepiece of her kit:
 *
 *   • 22 % on a point-blank body-sized sensor — more damage than any
 *     smash in the cast.
 *   • `baseMagnitude: 3` — a percent-independent launch floor bigger
 *     than most moves' scaled output, plus `damageGrowth: 0.6`. A
 *     clean connect at mid percent is a stock.
 *   • Authored knockback is UP (-y) — the Rest launch, not a meteor —
 *     the schema carries whatever vector the author declares.
 *   • 2-frame startup: effectively instant, which is the whole reason
 *     the risk side has to be brutal…
 *   • …and it is: 50 frames of recovery + 30 of cooldown. A whiffed
 *     slam leaves Puff asleep through the longest punish window in
 *     the game — every fighter can land a fully-charged smash before
 *     she wakes.
 *
 * GroundPound mechanics are tuned to near-stationary (2-frame hop at
 * -6, slam velocity 12 ≈ her fast-fall) so the move reads as an
 * in-place burst rather than a plunge; the tiny landing shockwave is
 * a consolation hit only.
 */
export const PUFF_DOWN_SPECIAL: GroundPoundDownSpecialMove = {
  id: 'puff.down_special',
  type: 'downSpecial',
  downSpecialKind: 'groundPound',
  damage: 22,
  knockback: { x: 0.6, y: -3.6, scaling: 0.34, baseMagnitude: 3, damageGrowth: 0.6 },
  // Point-blank body sensor — you have to be TOUCHING her.
  hitbox: { offsetX: 0, offsetY: 0, width: 40, height: 40 },
  startupFrames: 2,
  activeFrames: 6,
  recoveryFrames: 50, // the gamble — longest recovery in the game
  cooldownFrames: 30,
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 5 },
  groundPound: {
    hopFrames: 2, // minimal hop — the slam is in place, not a plunge
    hopImpulse: -6,
    slamVelocity: 12, // ≈ her fast-fall speed; gentle drop, not a stomp
    shockwaveDamage: 4,
    shockwaveKnockback: { x: 1.2, y: -0.8, scaling: 0.1 },
    shockwaveHitbox: {
      offsetX: 0,
      offsetY: 24, // at her feet (body half-height = 28)
      width: 90,
      height: 16,
    },
  },
};

/**
 * Puff's grab — short-armed standing grab. Up-throw is her best
 * follow-up starter (tosses the target into her five-jump juggle
 * space); every throw is light, in keeping with the weak-pokes kit.
 */
export const PUFF_GRAB: GrabSpec = {
  id: 'puff.grab',
  hitbox: { offsetX: 20, offsetY: -2, width: 22, height: 26 },
  startupFrames: 6,
  activeFrames: 2,
  whiffRecoveryFrames: 28,
  holdFramesMax: 80,
  throwRecoveryFrames: 22,
  pummel: { damage: 1, cooldownFrames: 12 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 7, knockback: { x: 2.2, y: -0.9, scaling: 0.09 }, animationFrames: 20 },
    back:    { damage: 9, knockback: { x: 2.6, y: -1.1, scaling: 0.12 }, animationFrames: 24 },
    up:      { damage: 8, knockback: { x: 0.4, y: -2.9, scaling: 0.11 }, animationFrames: 16 },
    down:    { damage: 5, knockback: { x: 0.7, y: 1.0, scaling: 0.07 }, animationFrames: 14 },
  },
};

/**
 * Puff's full 10-slot uniform moveset — canonical {@link FighterMoveset}
 * shape. Defensive slots use the shared defaults until a per-character
 * defensive balance pass lands.
 */
export const PUFF_MOVESET: FighterMoveset = Object.freeze({
  jab: PUFF_JAB,
  tilt: PUFF_TILT,
  smash: PUFF_SMASH,
  fair: PUFF_FAIR,
  neutralSpecial: PUFF_NEUTRAL_SPECIAL,
  sideSpecial: PUFF_SIDE_SPECIAL,
  upSpecial: PUFF_UP_SPECIAL,
  downSpecial: PUFF_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Puff's full {@link FighterContract} declaration — identity + 10-slot
 * moveset + movement profile in one frozen record.
 */
export const PUFF_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'puff',
  moveset: PUFF_MOVESET,
  movementProfile: PUFF_MOVEMENT_PROFILE,
});

/** Puff-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface PuffOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Puff fighter (Jigglypuff-inspired balloon). Inherits all base
 * movement / jump physics from `Character` via {@link ContractFighter};
 * the five-jump budget flows through the standard `maxJumps` plumbing
 * with zero special-casing in the base class.
 */
export class Puff extends ContractFighter {
  /** Puff's frozen 10-slot moveset surface — see {@link PUFF_MOVESET}. */
  readonly moveset: FighterMoveset = PUFF_MOVESET;

  /** Puff's per-fighter movement parameters — see {@link PUFF_MOVEMENT_PROFILE}. */
  readonly movementProfile: FighterMovementProfile = PUFF_MOVEMENT_PROFILE;

  /** Full per-fighter declaration — see {@link PUFF_FIGHTER_CONTRACT}. */
  readonly contract: FighterContract = PUFF_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: PuffOptions) {
    super(scene, {
      id: 'puff',
      // Puff's tuning is the floor; caller-supplied options win via
      // the base spread merge.
      ...PUFF_TUNING,
      ...options,
    });
    // Registration order mirrors the cast convention — grounded
    // triplet, aerial cut, four specials. See `Blaze.ts` / `Wolf.ts`
    // for the slot-wiring rationale.
    registerFighterAttack(this, PUFF_JAB);
    // Jab string — jab2 / jab3 register as 'jab' moves too, but jab1
    // keeps the light slot via first-registered-wins; these are reachable
    // only through the `jabChain` link. Tier 4.
    registerFighterAttack(this, PUFF_JAB2);
    registerFighterAttack(this, PUFF_JAB3);
    registerFighterAttack(this, PUFF_TILT);
    registerFighterAttack(this, PUFF_SMASH);
    registerFighterAttack(this, PUFF_NAIR);
    registerFighterAttack(this, PUFF_FAIR);
    registerFighterAttack(this, PUFF_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt / up-smash are
    // type 'tilt'/'smash' (their forward slots are taken), so wire the
    // dedicated up slots explicitly.
    registerFighterAttack(this, PUFF_UAIR);
    registerFighterAttack(this, PUFF_DAIR);
    registerFighterAttack(this, PUFF_UTILT);
    registerFighterAttack(this, PUFF_USMASH);
    this.setUpTilt(PUFF_UTILT.id);
    this.setUpSmash(PUFF_USMASH.id);
    // Directional grounded normals (down-stick + dash). All three are
    // type 'tilt'/'smash' whose forward slots are already taken by the
    // jab/tilt/smash triplet, so wire the dedicated down / dash slots
    // explicitly after registration.
    registerFighterAttack(this, PUFF_DTILT);
    registerFighterAttack(this, PUFF_DSMASH);
    registerFighterAttack(this, PUFF_DASHATTACK);
    this.setDownTilt(PUFF_DTILT.id);
    this.setDownSmash(PUFF_DSMASH.id);
    this.setDashAttack(PUFF_DASHATTACK.id);
    registerFighterAttack(this, PUFF_NEUTRAL_SPECIAL);
    registerFighterAttack(this, PUFF_SIDE_SPECIAL);
    registerFighterAttack(this, PUFF_UP_SPECIAL);
    registerFighterAttack(this, PUFF_DOWN_SPECIAL);

    // Grab — wires the range sensor + 4-throw set into the grab state
    // machine ticked by `Character.applyInput`.
    this.setGrabSpec(PUFF_GRAB);
  }

  // Per-slot execute hooks are inherited from ContractFighter, which
  // fires each slot off the frozen `moveset` declaration above.
}
