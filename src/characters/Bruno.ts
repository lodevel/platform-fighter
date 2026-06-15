/**
 * Bruno (Mario) — tenth roster slot, the balanced all-rounder.
 *
 * Role: all-rounder. The cast's "everyman" baseline — middleweight mass
 * (11), a real-but-unremarkable run (8.0), standard double jump, solid
 * combos, and reliable-if-unspectacular KO power. Nothing on Bruno is
 * the best or worst at anything; the identity is that every tool is
 * dependable and the kit has no glaring hole. Mirrors the Smash "Mario"
 * archetype: the yardstick the rest of the cast is measured against.
 *
 * Stats (vs the cast — see `BRUNO_MOVEMENT_PROFILE`):
 *
 *   maxRunSpeed   8.0        the cast's baseline tempo (= Aegis)
 *   mass          11         middleweight — the reference weight
 *   fallAccel     0.29       mid descent — graceful, committed arcs
 *   width/height  46×68      compact humanoid silhouette
 *
 * Signature moves:
 *
 *   • Neutral special ("fireball") — `projectile` schema: a bouncing-
 *     feel fireball that controls space and starts combos at mid range.
 *   • Up special ("super jump punch") — `multiHitRising` schema: a quick
 *     anti-air rising uppercut; reliable out-of-shield and as a juggle
 *     finisher.
 *   • Side special — `dashStrike` shoulder charge (a forward burst
 *     approach tool).
 *   • Down special — `groundPound` stomp.
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
import type { ProjectileSpecialMove } from './specialSchema';
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
import { BRUNO_MOVEMENT_PROFILE } from './fighterMovementProfiles';

// Re-export — per-fighter API surface; literal data lives in
// `fighterMovementProfiles.ts` (same split as the rest of the cast).
export { BRUNO_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `BRUNO_MOVEMENT_PROFILE`; the
 * compact 46×68 body stays inline because it's collision data.
 */
export const BRUNO_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...BRUNO_MOVEMENT_PROFILE,
  // Compact humanoid silhouette — the cast's "average" footprint:
  // shorter than Blaze (50×78), taller than Wolf (45×66). Sourced to
  // match the platformer-hero sprite footprint.
  width: 46,
  height: 68,
  chamfer: 8,
};

/**
 * Bruno's jab — quick punch. Textbook combo-starter jab at the cast
 * average: it confirms into tilt and grab, nothing fancy.
 */
export const BRUNO_JAB: AttackMoveWithAnimation = {
  id: 'bruno.jab',
  type: 'jab',
  damage: 4,
  knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 22, offsetY: -3, width: 28, height: 16 },
  startupFrames: 3,
  activeFrames: 3,
  recoveryFrames: 8,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  // Jab-combo opener: a re-press once jab1's hitbox is out advances to
  // jab2 → jab3 (the finisher). Mirrors the Wolf jab-string pattern.
  jabChain: { nextId: 'bruno.jab2' },
};

/**
 * Bruno's jab string — stage 2. A quick follow-up poke that chains from
 * {@link BRUNO_JAB} on a re-press and itself links to the
 * {@link BRUNO_JAB3} finisher. Registered as a `'jab'` move but never the
 * light slot (first-registered jab1 keeps it) — reachable ONLY via the
 * chain link.
 */
export const BRUNO_JAB2: AttackMoveWithAnimation = {
  id: 'bruno.jab2',
  type: 'jab',
  damage: 3,
  knockback: { x: 1.2, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 24, offsetY: -3, width: 28, height: 16 },
  startupFrames: 2,
  activeFrames: 2,
  recoveryFrames: 7,
  cooldownFrames: 9,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'bruno.jab3' },
};

/**
 * Bruno's jab string — finisher (stage 3). The launcher that ends the
 * string: more knockback + a base-magnitude floor so it pops the
 * opponent away even at low percent. No `jabChain` — the chain
 * terminates here, and its `cooldownFrames` is the post-string lockout.
 */
export const BRUNO_JAB3: AttackMoveWithAnimation = {
  id: 'bruno.jab3',
  type: 'jab',
  damage: 5,
  knockback: { x: 3.0, y: -1.5, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 26, offsetY: -3, width: 32, height: 19 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 14,
  cooldownFrames: 17,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Bruno's forward tilt — spacing kick at the cast-average tilt line.
 * The reliable mid-range poke — no reach gimmick, no sweet spot, just
 * a dependable button.
 */
export const BRUNO_TILT: AttackMoveWithAnimation = {
  id: 'bruno.tilt',
  type: 'tilt',
  damage: 8,
  knockback: { x: 2.1, y: -0.6, scaling: 0.13 },
  hitbox: { offsetX: 26, offsetY: -3, width: 34, height: 17 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 11,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Bruno's forward smash — full-body punch. Full Smash-style knockback
 * block at exactly the cast-baseline smash numbers: reliable KO power
 * that neither over- nor under-performs the field. The "fair fight"
 * finisher.
 */
export const BRUNO_SMASH: AttackMoveWithAnimation = {
  id: 'bruno.smash',
  type: 'smash',
  damage: 14,
  knockback: { x: 3.9, y: -1.4, scaling: 0.38, baseMagnitude: 1.25, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 14,
    maxDamage: 19.6,
    minKnockback: { x: 3.9, y: -1.4, scaling: 0.38, baseMagnitude: 1.25, damageGrowth: 0.5 },
    maxKnockback: { x: 5.46, y: -1.96, scaling: 0.475, baseMagnitude: 1.25, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 30, offsetY: -3, width: 38, height: 18 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 17,
  cooldownFrames: 21,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Bruno's neutral aerial — body-centred sex-kick. The all-purpose
 * aerial: good active window, low landing lag, fine as both a combo
 * tool and a get-off-me.
 */
export const BRUNO_NAIR: AerialMove = {
  id: 'bruno.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 7,
  knockback: { x: 1.5, y: -0.8, scaling: 0.11 },
  hitbox: { offsetX: 0, offsetY: -2, width: 44, height: 38 },
  startupFrames: 4,
  activeFrames: 6,
  recoveryFrames: 10,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 8,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Bruno's forward aerial — overhead hammer-fist. A meteor-leaning
 * downward angle off-stage but reliable as a forward poke on-stage;
 * the kit's edge-guard tool.
 */
export const BRUNO_FAIR: AerialMove = {
  id: 'bruno.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 9,
  knockback: { x: 2.2, y: -0.7, scaling: 0.18 },
  hitbox: { offsetX: 22, offsetY: -3, width: 34, height: 20 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 13,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  landingLagFrames: 13,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Bruno's back aerial — reverse drop-kick. His most reliable aerial KO
 * tool; flatter, side-blast-zone launch angle than the fair.
 */
export const BRUNO_BAIR: AerialMove = {
  id: 'bruno.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 10,
  knockback: { x: 2.6, y: -1.0, scaling: 0.24 },
  hitbox: { offsetX: 22, offsetY: -3, width: 34, height: 20 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 11,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 13,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Bruno's up aerial — rising headbutt above the body. The dependable
 * juggle tool: a reliable upward launcher that strings into itself and
 * into the up special at mid percent. Cast-average aerial numbers —
 * stronger upward launch than the nair but no sweet-spot gimmick. Bruno's
 * strongest aerial juggle option (vs his bair's flatter KO angle); the
 * "keep them above me" button the all-rounder leans on.
 */
export const BRUNO_UAIR: AerialMove = {
  id: 'bruno.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 8,
  knockback: { x: 0.3, y: -3.0, scaling: 0.19 },
  hitbox: { offsetX: 0, offsetY: -30, width: 34, height: 26 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 13,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 9,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/**
 * Bruno's down aerial — a stomping heel-drop below the body. The kit's
 * meteor / spike: a clean downward launch that takes a stock off-stage at
 * any percent, but the slow startup and heavy landing lag keep it
 * committal. Cast-average meteor numbers — reliable, not a one-frame
 * gimmick.
 */
export const BRUNO_DAIR: AerialMove = {
  id: 'bruno.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 9,
  knockback: { x: 0.4, y: 3.3, scaling: 0.23 },
  hitbox: { offsetX: 0, offsetY: 28, width: 32, height: 24 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 17,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 16,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Bruno's up-tilt — a quick upward swipe (up-stick + light). Fast
 * anti-air / juggle-starter: low-commitment, upward-launching, weaker
 * than the up-smash but reaches into the air to start the juggle the
 * up-air and up special finish. Cast-average tilt timing.
 */
export const BRUNO_UTILT: AttackMoveWithAnimation = {
  id: 'bruno.utilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 0.2, y: -2.2, scaling: 0.15 },
  hitbox: { offsetX: 9, offsetY: -20, width: 62, height: 50 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Bruno's up-smash — a rising two-fist uppercut (up-stick + heavy). The
 * classic upward vertical KO: charge it under a juggled opponent and send
 * them through the top blast zone. Slow startup so it punishes a whiffed
 * air-dodge, with the same KB shape as Bruno's forward smash
 * (baseMagnitude 1.25 / damageGrowth 0.5) so the cast-baseline KO feel
 * carries to the vertical finisher.
 */
export const BRUNO_USMASH: AttackMoveWithAnimation = {
  id: 'bruno.usmash',
  type: 'smash',
  damage: 15,
  knockback: { x: 0.3, y: -3.5, scaling: 0.40, baseMagnitude: 1.25, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 15,
    maxDamage: 21,
    minKnockback: { x: 0.3, y: -3.5, scaling: 0.40, baseMagnitude: 1.25, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -4.9, scaling: 0.5, baseMagnitude: 1.25, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 10, offsetY: -26, width: 66, height: 62 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 19,
  cooldownFrames: 21,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Bruno's down-tilt — a low crouching poke at the opponent's feet
 * (down-stick + light). The fast, low-commitment combo / spacing tool:
 * a near-horizontal "trip" launch (small low knockback) that pops the
 * target up just enough to confirm into a tilt, grab, or up-air. Fast
 * 5-frame startup — the quickest grounded button after the jab — and a
 * low feet-level hitbox (positive offsetY, short height) that beats
 * approaches hugging the ground. Cast-average low-poke numbers: it sets
 * up Bruno's offence rather than ending it.
 */
export const BRUNO_DTILT: AttackMoveWithAnimation = {
  id: 'bruno.dtilt',
  type: 'tilt',
  damage: 6,
  knockback: { x: 1.6, y: -0.9, scaling: 0.10 },
  hitbox: { offsetX: 24, offsetY: 27, width: 34, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Bruno's down-smash — a sweeping two-sided ground KO move (down-stick +
 * heavy). The grounded HORIZONTAL finisher: a wide, low sweep at the
 * feet (large width, short height, positive offsetY) that launches the
 * target outward and low toward the side blast zone. Slow 13-frame
 * startup so a whiff is punished, with the SAME KB SHAPE as Bruno's
 * forward smash (baseMagnitude 1.25 / damageGrowth 0.5) so the
 * cast-baseline KO feel carries to the low sweep — reliable, never
 * over- or under-performing the field. The wide arc covers both sides
 * of Bruno, catching rolls behind him.
 */
export const BRUNO_DSMASH: AttackMoveWithAnimation = {
  id: 'bruno.dsmash',
  type: 'smash',
  damage: 14,
  knockback: { x: 3.7, y: -0.9, scaling: 0.37, baseMagnitude: 1.25, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 14,
    maxDamage: 19.6,
    minKnockback: { x: 3.7, y: -0.9, scaling: 0.37, baseMagnitude: 1.25, damageGrowth: 0.5 },
    maxKnockback: { x: 5.18, y: -1.26, scaling: 0.4625, baseMagnitude: 1.25, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 0, offsetY: 14, width: 76, height: 16 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 21,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Bruno's dash-attack — a forward lunging shoulder/fist while running
 * (light press while running). The burst approach / combo-starter: a
 * forward hitbox (positive offsetX) with a moderate forward-and-up
 * launch that closes the gap and pops the target into juggle range for
 * the up-air or up special. Medium 7-frame startup — slower than the
 * dtilt poke but faster than any smash — and weaker knockback than the
 * grounded KO tools, so it's an opener, not a finisher. Cast-average
 * running-burst numbers.
 */
export const BRUNO_DASHATTACK: AttackMoveWithAnimation = {
  id: 'bruno.dashAttack',
  type: 'tilt',
  damage: 9,
  knockback: { x: 2.3, y: -1.4, scaling: 0.14 },
  hitbox: { offsetX: 26, offsetY: -2, width: 40, height: 24 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 15,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Bruno's neutral special — **fireball** (`projectile` schema, same
 * shape as Owl's / Volt's projectile). A mid-speed fireball that
 * controls space and starts combos at mid range. Cast-average projectile
 * numbers — neither the chip-pressure poke of a zoner nor a KO threat,
 * just a dependable neutral tool. Travel range = speed × lifetime =
 * 14 × 80 = 1120 design-px.
 */
export const BRUNO_NEUTRAL_SPECIAL: ProjectileSpecialMove = {
  id: 'bruno.neutral_special',
  type: 'special',
  specialKind: 'projectile',
  // Damage / knockback the spawned projectile carries on contact.
  damage: 7,
  knockback: { x: 2.0, y: -0.8, scaling: 0.12 },
  // The MOVE's own hitbox is unused (the projectile is a separate body)
  // — degenerate sensor so the schema is satisfied.
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 16,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  projectile: {
    speed: 14, // ≈ 840 px/s forward of facing
    lifetimeFrames: 80, // ~1.33 s (1120 design-pixel range)
    width: 26,
    height: 22,
    spawnOffsetX: 34,
    spawnOffsetY: -6,
  },
};

/**
 * Bruno's side special — **shoulder charge** (`dashStrike` schema). A
 * forward burst approach tool: covers ground to close the gap, with the
 * "neutral-game tool, not a recovery" rule (`helplessAfterDash: false`).
 * Cast-average dash numbers, like everything else in his kit.
 */
export const BRUNO_SIDE_SPECIAL: DashStrikeSideSpecialMove = {
  id: 'bruno.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 11,
  knockback: { x: 2.9, y: -1.0, scaling: 0.24 },
  hitbox: { offsetX: 24, offsetY: -3, width: 44, height: 26 },
  startupFrames: 7,
  activeFrames: 8,
  recoveryFrames: 17,
  cooldownFrames: 17,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 4 },
  dashStrike: {
    dashSpeed: 16, // ≈ 960 px/s — double his max run (480 px/s)
    dashFrames: 6, // ¾ of the 8-frame active window
    helplessAfterDash: false,
  },
};

/**
 * Bruno's up special — **super jump punch** (`multiHitRising` schema).
 * The canonical quick anti-air: 4-frame startup, a brisk rise with
 * slight forward drift, a two-hit ladder whose launcher lands at the
 * apex. Reliable out-of-shield and as a juggle finisher — the dependable
 * recovery / anti-air the all-rounder leans on.
 */
export const BRUNO_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'bruno.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  // Move-level damage / knockback carry the LINK-HIT values.
  damage: 3,
  knockback: { x: 0, y: -0.5, scaling: 0.03 },
  hitbox: { offsetX: 0, offsetY: -4, width: 36, height: 46 },
  startupFrames: 4,
  activeFrames: 12,
  recoveryFrames: 20,
  cooldownFrames: 18,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 2 },
  multiHitRising: {
    riseImpulse: -16, // brisk anti-air rise
    driftImpulse: 1.0, // slight forward drift toward the press direction
    hitCount: 2,
    hitInterval: 6, // hits at active-frames [0, 6] — inside the 12
    linkDamage: 3,
    linkKnockback: { x: 0, y: -0.5, scaling: 0.03 },
    launcherDamage: 6,
    launcherKnockback: { x: 0.6, y: -3.0, scaling: 0.28 },
  },
};

/**
 * Bruno's down special — **stomp** (`groundPound` schema). A short hop
 * into a downward slam: the descent body is a combo-starter meteor, the
 * landing shockwave a clean-up hit. Cast-average plunge speed and
 * numbers — reliable, not flashy.
 */
export const BRUNO_DOWN_SPECIAL: GroundPoundDownSpecialMove = {
  id: 'bruno.down_special',
  type: 'downSpecial',
  downSpecialKind: 'groundPound',
  // Move-level damage / knockback are the METEOR (descent) values; +y
  // is downward in Phaser screen-space — the spike trajectory.
  damage: 11,
  knockback: { x: 0.4, y: 3.2, scaling: 0.28 },
  hitbox: { offsetX: 0, offsetY: 0, width: 42, height: 44 },
  startupFrames: 5,
  activeFrames: 13,
  recoveryFrames: 20,
  cooldownFrames: 22,
  animation: { startupFrames: 1, activeFrames: 5, recoveryFrames: 2 },
  groundPound: {
    hopFrames: 3, // first 3 of 13 active frames are the hop
    hopImpulse: -8,
    slamVelocity: 24, // mid plunge speed
    shockwaveDamage: 7,
    shockwaveKnockback: { x: 2.0, y: -1.1, scaling: 0.16 },
    shockwaveHitbox: {
      offsetX: 0,
      offsetY: 33, // at his feet (body half-height = 34)
      width: 140,
      height: 18,
    },
  },
};

/**
 * Bruno's grab — standing grab with cast-average timing. Throws are
 * balanced across the four directions: back is the kill throw, up starts
 * juggles into the super jump punch, down resets, forward repositions.
 */
export const BRUNO_GRAB: GrabSpec = {
  id: 'bruno.grab',
  hitbox: { offsetX: 24, offsetY: -2, width: 24, height: 28 },
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
    up:      { damage: 7, knockback: { x: 0.4, y: -3.0, scaling: 0.1 }, animationFrames: 15 },
    down:    { damage: 6, knockback: { x: 0.8, y: 1.1, scaling: 0.08 }, animationFrames: 16 },
  },
};

/**
 * Bruno's full 10-slot uniform moveset — canonical {@link FighterMoveset}
 * shape. Defensive slots use the shared defaults until a per-character
 * defensive balance pass lands.
 */
export const BRUNO_MOVESET: FighterMoveset = Object.freeze({
  jab: BRUNO_JAB,
  tilt: BRUNO_TILT,
  smash: BRUNO_SMASH,
  fair: BRUNO_FAIR,
  neutralSpecial: BRUNO_NEUTRAL_SPECIAL,
  sideSpecial: BRUNO_SIDE_SPECIAL,
  upSpecial: BRUNO_UP_SPECIAL,
  downSpecial: BRUNO_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Bruno's full {@link FighterContract} declaration — identity + 10-slot
 * moveset + movement profile in one frozen record.
 */
export const BRUNO_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'bruno',
  moveset: BRUNO_MOVESET,
  movementProfile: BRUNO_MOVEMENT_PROFILE,
});

/** Bruno-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface BrunoOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Bruno fighter (Mario-inspired all-rounder). Inherits all base
 * movement / jump physics from `Character` via {@link ContractFighter};
 * the kit wires through the same `registerFighterAttack` + `setGrabSpec`
 * path as the rest of the cast.
 */
export class Bruno extends ContractFighter {
  /** Bruno's frozen 10-slot moveset surface — see {@link BRUNO_MOVESET}. */
  readonly moveset: FighterMoveset = BRUNO_MOVESET;

  /** Bruno's per-fighter movement parameters — see {@link BRUNO_MOVEMENT_PROFILE}. */
  readonly movementProfile: FighterMovementProfile = BRUNO_MOVEMENT_PROFILE;

  /** Full per-fighter declaration — see {@link BRUNO_FIGHTER_CONTRACT}. */
  readonly contract: FighterContract = BRUNO_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: BrunoOptions) {
    super(scene, {
      id: 'bruno',
      // Bruno's tuning is the floor; caller-supplied options win via the
      // base spread merge.
      ...BRUNO_TUNING,
      ...options,
    });
    // Registration order mirrors the cast convention — grounded triplet,
    // aerial cut, four specials. See `Blaze.ts` / `Wolf.ts` for the
    // slot-wiring rationale.
    registerFighterAttack(this, BRUNO_JAB);
    // Jab-string stages 2 + 3 register as 'jab' moves but jab1 keeps the
    // light slot via first-registered-wins; they're reachable only via the
    // jabChain link (see Wolf.ts for the same pattern).
    registerFighterAttack(this, BRUNO_JAB2);
    registerFighterAttack(this, BRUNO_JAB3);
    registerFighterAttack(this, BRUNO_TILT);
    registerFighterAttack(this, BRUNO_SMASH);
    registerFighterAttack(this, BRUNO_NAIR);
    registerFighterAttack(this, BRUNO_FAIR);
    registerFighterAttack(this, BRUNO_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt / up-smash are
    // type 'tilt'/'smash' (their forward slots are taken), so wire the
    // dedicated up slots explicitly.
    registerFighterAttack(this, BRUNO_UAIR);
    registerFighterAttack(this, BRUNO_DAIR);
    registerFighterAttack(this, BRUNO_UTILT);
    registerFighterAttack(this, BRUNO_USMASH);
    this.setUpTilt(BRUNO_UTILT.id);
    this.setUpSmash(BRUNO_USMASH.id);
    // Down-stick + dash grounded normals. All three are type 'tilt'/'smash'
    // whose forward slots are already taken by the tilt / smash, so wire
    // the dedicated down / dash slots explicitly (same pattern as the
    // up-tilt / up-smash above).
    registerFighterAttack(this, BRUNO_DTILT);
    registerFighterAttack(this, BRUNO_DSMASH);
    registerFighterAttack(this, BRUNO_DASHATTACK);
    this.setDownTilt(BRUNO_DTILT.id);
    this.setDownSmash(BRUNO_DSMASH.id);
    this.setDashAttack(BRUNO_DASHATTACK.id);
    registerFighterAttack(this, BRUNO_NEUTRAL_SPECIAL);
    registerFighterAttack(this, BRUNO_SIDE_SPECIAL);
    registerFighterAttack(this, BRUNO_UP_SPECIAL);
    registerFighterAttack(this, BRUNO_DOWN_SPECIAL);

    // Grab — wires the range sensor + 4-throw set into the grab state
    // machine ticked by `Character.applyInput`.
    this.setGrabSpec(BRUNO_GRAB);
  }

  // Per-slot execute hooks are inherited from ContractFighter, which
  // fires each slot off the frozen `moveset` declaration above.
}
