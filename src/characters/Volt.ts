/**
 * Volt (Pikachu) — eighth roster slot, the tiny combo rushdown.
 *
 * Role: rushdown / combo. The cast's smallest, fastest fighter: near-top
 * run speed (9.5) on a featherweight body (mass 7), with quick
 * low-knockback normals that confirm into each other and fast aerials
 * that let him weave around bigger fighters. He dies early off a clean
 * hit — the trade for living in the opponent's face. Mirrors the Smash
 * "Pikachu" archetype: small, slippery, death-by-a-thousand-cuts.
 *
 * Stats (vs the cast — see `VOLT_MOVEMENT_PROFILE`):
 *
 *   maxRunSpeed   9.5   (▲)  second-fastest top speed shipped
 *   airAccel      0.46       strong air control for the weave
 *   mass          7     (▼)  featherweight — only Puff (6) is lighter
 *   fallAccel     0.37  (▲)  fast-faller — back on the deck NOW
 *   width/height  40×52      tiny silhouette, smallest in the cast
 *
 * Signature moves:
 *
 *   • Low-knockback grounded triplet — jab/tilt scaling kept low so the
 *     hits combo rather than send; the kit's win condition is the
 *     follow-up, not the launch.
 *   • Neutral special ("spark bolt") — `projectile` schema: a small fast
 *     electric ball that pressures from range and ends combos.
 *   • Up special ("quick attack") — `multiHitRising` rising zip with
 *     forward drift; a recovery AND a combo-extending blitz.
 *   • Side special — `dashStrike` electric tackle (Skull-Bash-style
 *     burst).
 *   • Down special — `groundPound` thunder-stomp.
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
import { VOLT_MOVEMENT_PROFILE } from './fighterMovementProfiles';

// Re-export — per-fighter API surface; literal data lives in
// `fighterMovementProfiles.ts` (same split as the rest of the cast).
export { VOLT_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `VOLT_MOVEMENT_PROFILE`; the
 * tiny 40×52 body (smallest hurtbox in the cast) stays inline because
 * it's collision data, not movement.
 */
export const VOLT_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...VOLT_MOVEMENT_PROFILE,
  // Smallest silhouette in the cast — shorter than Puff (56) and Wolf
  // (66). The tiny hurtbox is part of the archetype: hard to clip, and
  // it lets the featherweight weave through attacks aimed at bigger
  // fighters. Sourced to match the Tiny-Kitten sprite footprint.
  width: 40,
  height: 52,
  chamfer: 8,
};

/**
 * Volt's jab — the fastest poke in the cast (2-frame startup). Tiny
 * damage and the lowest scaling shipped on a jab: the hit exists to
 * start combos, never to send.
 */
export const VOLT_JAB: AttackMoveWithAnimation = {
  id: 'volt.jab',
  type: 'jab',
  damage: 3,
  knockback: { x: 1.1, y: -0.3, scaling: 0.04 },
  hitbox: { offsetX: 18, offsetY: -2, width: 24, height: 14 },
  startupFrames: 2,
  activeFrames: 2,
  recoveryFrames: 7,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  // Jab-combo opener: a re-press once jab1's hitbox is out advances to
  // jab2 → jab3 (the finisher). Mirrors Wolf's jab string. Tier 4.
  jabChain: { nextId: 'volt.jab2' },
};

/**
 * Volt jab string — stage 2. A quick follow-up poke that chains from
 * {@link VOLT_JAB} on a re-press and itself links to the
 * {@link VOLT_JAB3} finisher. Registered as a `'jab'` move but never the
 * light slot (first-registered jab1 keeps it) — reachable ONLY via the
 * chain link.
 */
export const VOLT_JAB2: AttackMoveWithAnimation = {
  id: 'volt.jab2',
  type: 'jab',
  damage: 2,
  knockback: { x: 1.0, y: -0.25, scaling: 0.035 },
  hitbox: { offsetX: 20, offsetY: -2, width: 24, height: 14 },
  startupFrames: 2,
  activeFrames: 2,
  recoveryFrames: 6,
  cooldownFrames: 8,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'volt.jab3' },
};

/**
 * Volt jab string — finisher (stage 3). The launcher that ends the
 * string: more knockback + a base-magnitude floor so it pops the
 * opponent away even at low percent. No `jabChain` — the chain
 * terminates here, and its `cooldownFrames` is the post-string lockout.
 */
export const VOLT_JAB3: AttackMoveWithAnimation = {
  id: 'volt.jab3',
  type: 'jab',
  damage: 3,
  knockback: { x: 2.2, y: -1.4, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 22, offsetY: -2, width: 30, height: 16 },
  startupFrames: 3,
  activeFrames: 3,
  recoveryFrames: 13,
  cooldownFrames: 16,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Volt's forward tilt — quick head-butt. Low scaling keeps it a combo
 * tool: at low percent it links into itself and into aerials rather
 * than launching out of follow-up range.
 */
export const VOLT_TILT: AttackMoveWithAnimation = {
  id: 'volt.tilt',
  type: 'tilt',
  damage: 6,
  knockback: { x: 1.9, y: -0.5, scaling: 0.11 },
  hitbox: { offsetX: 22, offsetY: -2, width: 28, height: 15 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Volt's forward smash — electric tail-whip. His one real conventional
 * KO option: full Smash-style knockback block (`baseMagnitude` +
 * `damageGrowth`). Modest damage (12) because the featherweight is
 * supposed to KO off combos and the projectile, not raw smash power.
 */
export const VOLT_SMASH: AttackMoveWithAnimation = {
  id: 'volt.smash',
  type: 'smash',
  damage: 12,
  knockback: { x: 3.6, y: -1.3, scaling: 0.32, baseMagnitude: 1.1, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 12,
    maxDamage: 16.8,
    minKnockback: { x: 3.6, y: -1.3, scaling: 0.32, baseMagnitude: 1.1, damageGrowth: 0.5 },
    maxKnockback: { x: 5.04, y: -1.82, scaling: 0.4, baseMagnitude: 1.1, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 26, offsetY: -2, width: 34, height: 16 },
  startupFrames: 10,
  activeFrames: 3,
  recoveryFrames: 16,
  cooldownFrames: 20,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Volt's neutral aerial — body-centred spark spin. Fast startup, tiny
 * landing lag: the bread-and-butter "get-off-me + combo-glue" aerial
 * the weave game leans on.
 */
export const VOLT_NAIR: AerialMove = {
  id: 'volt.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 5,
  knockback: { x: 1.2, y: -0.7, scaling: 0.09 },
  hitbox: { offsetX: 0, offsetY: -1, width: 40, height: 36 },
  startupFrames: 3,
  activeFrames: 6,
  recoveryFrames: 9,
  cooldownFrames: 7,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 6,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/**
 * Volt's forward aerial — drilling spark kick. The combo-flow aerial:
 * low knockback that carries the opponent along his weave rather than
 * away, with a tiny landing lag so he can re-press almost immediately.
 */
export const VOLT_FAIR: AerialMove = {
  id: 'volt.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 6,
  knockback: { x: 1.7, y: -0.6, scaling: 0.12 },
  hitbox: { offsetX: 20, offsetY: -2, width: 30, height: 18 },
  startupFrames: 4,
  activeFrames: 4,
  recoveryFrames: 9,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 2 },
  landingLagFrames: 7,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/**
 * Volt's back aerial — reverse spark kick. His most reliable aerial KO
 * tool when a combo runs out of steam; flatter, side-blast-zone launch
 * angle than the combo-flow fair.
 */
export const VOLT_BAIR: AerialMove = {
  id: 'volt.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 8,
  knockback: { x: 2.4, y: -0.9, scaling: 0.24 },
  hitbox: { offsetX: 22, offsetY: -2, width: 32, height: 18 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 11,
  cooldownFrames: 9,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 9,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Volt's up aerial — a snappy spark flick above the head. The kit's
 * premier juggle tool: very fast startup, tiny landing lag, and an
 * upward launch that pops the opponent straight into Volt's weave for
 * the next aerial. Lower damage than Wolf's uair (9) and a softer
 * scaling — the featherweight juggles for tempo, not for the KO.
 * Upward hitbox (negative offsetY) + upward knockback (negative y).
 */
export const VOLT_UAIR: AerialMove = {
  id: 'volt.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 6,
  knockback: { x: 0.2, y: -2.6, scaling: 0.16 },
  hitbox: { offsetX: 0, offsetY: -30, width: 34, height: 26 },
  startupFrames: 4,
  activeFrames: 4,
  recoveryFrames: 9,
  cooldownFrames: 7,
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 2 },
  landingLagFrames: 6,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/**
 * Volt's down aerial — a stomping electric drill below the body. The
 * kit's meteor / spike: a downward hitbox (positive offsetY) with
 * downward knockback (positive y) that sends off-stage opponents
 * straight down. Faster and lighter than Wolf's dair (10), in keeping
 * with the featherweight's fast-faller, quick-hit identity; the heavier
 * landing lag is the trade for the spike payoff.
 */
export const VOLT_DAIR: AerialMove = {
  id: 'volt.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 7,
  knockback: { x: 0.3, y: 3.0, scaling: 0.20 },
  hitbox: { offsetX: 0, offsetY: 28, width: 30, height: 24 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 9,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 2 },
  landingLagFrames: 14,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Volt's up-tilt — a quick overhead tail-flick (up-stick + light). The
 * grounded juggle-starter: fast startup, low upward knockback so it
 * links into itself and into the up-air at low percent rather than
 * sending the opponent away. The anti-air half of his vertical game,
 * with the up-smash as the eventual KO.
 */
export const VOLT_UTILT: AttackMoveWithAnimation = {
  id: 'volt.utilt',
  type: 'tilt',
  damage: 5,
  knockback: { x: 0.2, y: -1.8, scaling: 0.12 },
  hitbox: { offsetX: 8, offsetY: -19, width: 56, height: 48 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Volt's up-smash — a rising electric burst (up-stick + heavy). The
 * grounded vertical KO move: slow startup so it punishes, with the full
 * Smash-style knockback block (`baseMagnitude` + `damageGrowth`)
 * mirroring his forward smash. Lower magnitude / scaling than the
 * heavyweights' up-smashes (and Wolf's 16-dmg / 0.42-scaling reference)
 * because the featherweight's up-smash is a softer KO confirm off a
 * juggle, not a stage-clearing launcher.
 */
export const VOLT_USMASH: AttackMoveWithAnimation = {
  id: 'volt.usmash',
  type: 'smash',
  damage: 13,
  knockback: { x: 0.3, y: -3.0, scaling: 0.34, baseMagnitude: 1.1, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 13,
    maxDamage: 18.2,
    minKnockback: { x: 0.3, y: -3.0, scaling: 0.34, baseMagnitude: 1.1, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -4.2, scaling: 0.425, baseMagnitude: 1.1, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 9, offsetY: -25, width: 60, height: 60 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 20,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Volt's down-tilt — a crouching electric tail-sweep at the feet
 * (down-stick + light). The low combo poke: a fast, near-horizontal
 * "trip" that pops the opponent a hair off the ground and into Volt's
 * weave. Downward/low hitbox (small positive offsetY, low height) and
 * modest LOW knockback (small upward y so it stays a poke, never a
 * launch). Faster startup (5) and lighter scaling than the forward
 * tilt — the featherweight's go-to spacing/combo-starter on the deck.
 */
export const VOLT_DTILT: AttackMoveWithAnimation = {
  id: 'volt.dtilt',
  type: 'tilt',
  damage: 4,
  knockback: { x: 1.4, y: -0.4, scaling: 0.08 },
  hitbox: { offsetX: 20, offsetY: 20, width: 30, height: 12 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 10,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Volt's down-smash — a sweeping double-sided spark discharge at the
 * feet (down-stick + heavy). His grounded HORIZONTAL KO move: a wide,
 * low hitbox (large width, low height, positive offsetY) that sweeps
 * the ground for a strong outward+low launch. Mirrors the KB SHAPE of
 * his forward smash (`baseMagnitude` 1.1 + `damageGrowth` 0.5, scaling
 * in the 0.3s) tuned to the featherweight body — slow startup (12) so
 * it punishes, modest damage because Volt KOs off combos and the
 * projectile, not raw smash power.
 */
export const VOLT_DSMASH: AttackMoveWithAnimation = {
  id: 'volt.dsmash',
  type: 'smash',
  damage: 11,
  knockback: { x: 3.4, y: -0.9, scaling: 0.31, baseMagnitude: 1.1, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 11,
    maxDamage: 15.4,
    minKnockback: { x: 3.4, y: -0.9, scaling: 0.31, baseMagnitude: 1.1, damageGrowth: 0.5 },
    maxKnockback: { x: 4.76, y: -1.26, scaling: 0.3875, baseMagnitude: 1.1, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 0, offsetY: 14, width: 60, height: 16 },
  startupFrames: 12,
  activeFrames: 3,
  recoveryFrames: 16,
  cooldownFrames: 20,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Volt's dash-attack — a forward lunging spark-tackle used while
 * running (light press out of a dash). The burst approach / combo
 * starter: a forward hitbox (positive offsetX) with moderate
 * forward+up knockback that pops the target into his weave. Medium
 * startup (6) — quick, befitting the cast's fastest runner — and
 * weaker than any smash, in keeping with the rushdown's "open them up,
 * then combo" identity rather than a raw KO.
 */
export const VOLT_DASHATTACK: AttackMoveWithAnimation = {
  id: 'volt.dashAttack',
  type: 'tilt',
  damage: 6,
  knockback: { x: 2.2, y: -1.1, scaling: 0.13 },
  hitbox: { offsetX: 22, offsetY: -2, width: 34, height: 22 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Volt's neutral special — **spark bolt** (`projectile` schema, same
 * shape as Owl's projectile). A small fast electric ball: lower damage
 * than the heavyweights' ranged tools but a fast travel speed and quick
 * recovery so it doubles as a combo ender and a poke. Travel range =
 * speed × lifetime = 18 × 70 = 1260 design-px — crosses the stage.
 */
export const VOLT_NEUTRAL_SPECIAL: ProjectileSpecialMove = {
  id: 'volt.neutral_special',
  type: 'special',
  specialKind: 'projectile',
  // Damage / knockback the spawned projectile carries on contact.
  damage: 8,
  knockback: { x: 2.0, y: -0.7, scaling: 0.14 },
  // The MOVE's own hitbox is unused (the projectile is a separate body)
  // — degenerate sensor so the schema is satisfied.
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  projectile: {
    speed: 18, // ≈ 1080 px/s forward of facing — fast little bolt
    lifetimeFrames: 70, // ~1.17 s (1260 design-pixel range)
    width: 22,
    height: 22,
    spawnOffsetX: 30,
    spawnOffsetY: -6,
  },
};

/**
 * Volt's side special — **electric tackle** (`dashStrike` schema,
 * Skull-Bash-style burst). A fast committal lunge that covers ground
 * his featherweight body otherwise crosses on foot; `helplessAfterDash:
 * false` keeps it a neutral-game approach, not a recovery forfeit.
 */
export const VOLT_SIDE_SPECIAL: DashStrikeSideSpecialMove = {
  id: 'volt.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 9,
  knockback: { x: 2.6, y: -0.9, scaling: 0.22 },
  hitbox: { offsetX: 20, offsetY: -2, width: 40, height: 26 },
  startupFrames: 6,
  activeFrames: 8,
  recoveryFrames: 16,
  cooldownFrames: 16,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  dashStrike: {
    dashSpeed: 19, // ≈ 1140 px/s — twice his max run (570 px/s)
    dashFrames: 6, // ¾ of the 8-frame active window
    helplessAfterDash: false,
  },
};

/**
 * Volt's up special — **quick attack** (`multiHitRising` schema). The
 * canonical zip-recovery: steep rise with forward drift, a two-hit
 * ladder so it both recovers AND blitzes through juggle space. Link
 * hits pin, the launcher pops — light numbers, in keeping with his
 * combo-not-KO identity.
 */
export const VOLT_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'volt.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  // Move-level damage / knockback carry the LINK-HIT values.
  damage: 2,
  knockback: { x: 0, y: -0.4, scaling: 0.03 },
  hitbox: { offsetX: 0, offsetY: -3, width: 34, height: 42 },
  startupFrames: 3,
  activeFrames: 12,
  recoveryFrames: 18,
  cooldownFrames: 16,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 2 },
  multiHitRising: {
    riseImpulse: -18, // steep zip — the quick-attack blitz
    driftImpulse: 1.5, // strong forward drift for the angled recovery
    hitCount: 2,
    hitInterval: 6, // hits at active-frames [0, 6] — inside the 12
    linkDamage: 2,
    linkKnockback: { x: 0, y: -0.4, scaling: 0.03 },
    launcherDamage: 5,
    launcherKnockback: { x: 0.5, y: -2.8, scaling: 0.26 },
  },
};

/**
 * Volt's down special — **thunder stomp** (`groundPound` schema). Short
 * hop, then a fast electric slam. Meteor descent body for off-stage
 * spikes; modest landing shockwave for on-stage clean-up. Faster plunge
 * than the heavyweights, matching his fast-faller identity.
 */
export const VOLT_DOWN_SPECIAL: GroundPoundDownSpecialMove = {
  id: 'volt.down_special',
  type: 'downSpecial',
  downSpecialKind: 'groundPound',
  // Move-level damage / knockback are the METEOR (descent) values;
  // +y is downward in Phaser screen-space — the spike trajectory.
  damage: 10,
  knockback: { x: 0.3, y: 3.4, scaling: 0.28 },
  hitbox: { offsetX: 0, offsetY: 0, width: 36, height: 40 },
  startupFrames: 4,
  activeFrames: 12,
  recoveryFrames: 18,
  cooldownFrames: 20,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 2 },
  groundPound: {
    hopFrames: 3, // first 3 of 12 active frames are the hop
    hopImpulse: -8,
    slamVelocity: 28, // fast plunge — fast-faller identity
    shockwaveDamage: 5,
    shockwaveKnockback: { x: 1.8, y: -1.0, scaling: 0.14 },
    shockwaveHitbox: {
      offsetX: 0,
      offsetY: 24, // at his feet (body half-height = 26)
      width: 120,
      height: 16,
    },
  },
};

/**
 * Volt's grab — short-armed standing grab with the cast's fastest grab
 * startup (5 frames), in keeping with the in-your-face rushdown. Up-
 * throw starts juggles into his weave; throws stay light.
 */
export const VOLT_GRAB: GrabSpec = {
  id: 'volt.grab',
  hitbox: { offsetX: 18, offsetY: -2, width: 20, height: 24 },
  startupFrames: 5,
  activeFrames: 2,
  whiffRecoveryFrames: 26,
  holdFramesMax: 80,
  throwRecoveryFrames: 20,
  pummel: { damage: 1, cooldownFrames: 11 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 6, knockback: { x: 2.1, y: -0.9, scaling: 0.09 }, animationFrames: 18 },
    back:    { damage: 8, knockback: { x: 2.5, y: -1.1, scaling: 0.12 }, animationFrames: 22 },
    up:      { damage: 6, knockback: { x: 0.3, y: -2.9, scaling: 0.11 }, animationFrames: 14 },
    down:    { damage: 5, knockback: { x: 0.7, y: 1.0, scaling: 0.07 }, animationFrames: 14 },
  },
};

/**
 * Volt's full 10-slot uniform moveset — canonical {@link FighterMoveset}
 * shape. Defensive slots use the shared defaults until a per-character
 * defensive balance pass lands.
 */
export const VOLT_MOVESET: FighterMoveset = Object.freeze({
  jab: VOLT_JAB,
  tilt: VOLT_TILT,
  smash: VOLT_SMASH,
  fair: VOLT_FAIR,
  neutralSpecial: VOLT_NEUTRAL_SPECIAL,
  sideSpecial: VOLT_SIDE_SPECIAL,
  upSpecial: VOLT_UP_SPECIAL,
  downSpecial: VOLT_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Volt's full {@link FighterContract} declaration — identity + 10-slot
 * moveset + movement profile in one frozen record.
 */
export const VOLT_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'volt',
  moveset: VOLT_MOVESET,
  movementProfile: VOLT_MOVEMENT_PROFILE,
});

/** Volt-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface VoltOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Volt fighter (Pikachu-inspired tiny combo rushdown). Inherits all
 * base movement / jump physics from `Character` via
 * {@link ContractFighter}; the kit wires through the same
 * `registerFighterAttack` + `setGrabSpec` path as the rest of the cast.
 */
export class Volt extends ContractFighter {
  /** Volt's frozen 10-slot moveset surface — see {@link VOLT_MOVESET}. */
  readonly moveset: FighterMoveset = VOLT_MOVESET;

  /** Volt's per-fighter movement parameters — see {@link VOLT_MOVEMENT_PROFILE}. */
  readonly movementProfile: FighterMovementProfile = VOLT_MOVEMENT_PROFILE;

  /** Full per-fighter declaration — see {@link VOLT_FIGHTER_CONTRACT}. */
  readonly contract: FighterContract = VOLT_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: VoltOptions) {
    super(scene, {
      id: 'volt',
      // Volt's tuning is the floor; caller-supplied options win via the
      // base spread merge.
      ...VOLT_TUNING,
      ...options,
    });
    // Registration order mirrors the cast convention — grounded triplet,
    // aerial cut, four specials. See `Blaze.ts` / `Wolf.ts` for the
    // slot-wiring rationale.
    registerFighterAttack(this, VOLT_JAB);
    // Jab-string stages 2 + 3 — register after jab1 so first-registered
    // jab1 keeps the light slot; these are reachable only via the chain.
    registerFighterAttack(this, VOLT_JAB2);
    registerFighterAttack(this, VOLT_JAB3);
    registerFighterAttack(this, VOLT_TILT);
    registerFighterAttack(this, VOLT_SMASH);
    registerFighterAttack(this, VOLT_NAIR);
    registerFighterAttack(this, VOLT_FAIR);
    registerFighterAttack(this, VOLT_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt / up-smash are
    // type 'tilt'/'smash' (their forward slots are taken), so wire the
    // dedicated up slots explicitly. Mirrors `Wolf.ts`.
    registerFighterAttack(this, VOLT_UAIR);
    registerFighterAttack(this, VOLT_DAIR);
    registerFighterAttack(this, VOLT_UTILT);
    registerFighterAttack(this, VOLT_USMASH);
    this.setUpTilt(VOLT_UTILT.id);
    this.setUpSmash(VOLT_USMASH.id);
    // Directional attacks (down-stick + dash). Down-tilt / down-smash /
    // dash-attack are type 'tilt'/'smash' (their forward slots are
    // taken), so wire the dedicated down + dash slots explicitly.
    // Mirrors `Wolf.ts`.
    registerFighterAttack(this, VOLT_DTILT);
    registerFighterAttack(this, VOLT_DSMASH);
    registerFighterAttack(this, VOLT_DASHATTACK);
    this.setDownTilt(VOLT_DTILT.id);
    this.setDownSmash(VOLT_DSMASH.id);
    this.setDashAttack(VOLT_DASHATTACK.id);
    registerFighterAttack(this, VOLT_NEUTRAL_SPECIAL);
    registerFighterAttack(this, VOLT_SIDE_SPECIAL);
    registerFighterAttack(this, VOLT_UP_SPECIAL);
    registerFighterAttack(this, VOLT_DOWN_SPECIAL);

    // Grab — wires the range sensor + 4-throw set into the grab state
    // machine ticked by `Character.applyInput`.
    this.setGrabSpec(VOLT_GRAB);
  }

  // Per-slot execute hooks are inherited from ContractFighter, which
  // fires each slot off the frozen `moveset` declaration above.

  /**
   * Volt's wake-up get-up attack — a quick two-sided spark flick as the
   * featherweight pops off the deck. Scaled to the archetype: the
   * smallest, fastest, weakest get-up in the cast. Lower damage (5) and
   * softer knockback than the base default, and a short 5-frame active
   * window befitting the cast's quickest fighter. The hitbox is a wide
   * two-sided sweep (offsetX 0) but narrow in absolute terms — ~1.85x the
   * tiny 40-wide body (74) — so it clears both sides without the reach a
   * heavyweight's sweep would carry. A pop-away utility move, never a KO.
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 5,
      knockback: { x: 3.4, y: -2.8, scaling: 0.1 },
      hitbox: { offsetX: 0, offsetY: 0, width: 74, height: 34 },
      activeFrames: 5,
    };
  }

  /**
   * Volt's ledge attack — a fast forward spark swing as he scrambles back
   * onto the stage. Quick (5-frame active) and light, in keeping with the
   * featherweight's quick-hit identity: modest damage (6) and softer
   * knockback than the base default. The forward hitbox (positive
   * offsetX) covers the ledge corner up onto the lip, sized down to the
   * tiny body — shorter reach and a slimmer height than the base. A
   * pop-away edge-clear, never a KO.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 6,
      knockback: { x: 3.6, y: -2.2, scaling: 0.12 },
      hitbox: { offsetX: 10, offsetY: -2, width: 68, height: 50 },
      activeFrames: 5,
    };
  }
}
