/**
 * Nova (Samus) — ninth roster slot, the ranged zoner.
 *
 * Role: zoner. Mid-heavy mass (13) and a deliberately slow run (6.8)
 * built around controlling space with ranged tools. Nova wants the
 * opponent OUT — she walls them off with a chargeable shot and a
 * missile barrage, then punishes the approach. Slower and more
 * committal than the rushdowns; her reach is the whole game. Mirrors
 * the Smash "Samus" archetype: armour-cannon zoning, strong recovery
 * (the screw attack), heavy enough to survive the trades.
 *
 * Stats (vs the cast — see `NOVA_MOVEMENT_PROFILE`):
 *
 *   maxRunSpeed   6.8   (▼)  slow — the zoner wants distance, not closure
 *   mass          13    (▲)  mid-heavy — survives the trades
 *   fallAccel     0.27       mid descent — not a fast-faller
 *   width/height  48×74      tall armoured silhouette
 *
 * Signature moves:
 *
 *   • Neutral special ("charge shot") — `charge` schema: a genuinely
 *     chargeable plasma shot, weak on a bare press (6 %) and a stage-
 *     spanning KO threat at full charge (24 %). The move-level hitbox
 *     is the released shot's body sensor.
 *   • Side special ("missile") — `multiHit` schema: a forward barrage
 *     of homing-feel missile hits with a launcher finisher; her
 *     mid-range wall.
 *   • Up special ("screw attack") — `multiHitRising` schema: a rising
 *     multi-hit spin, the canonical strong recovery.
 *   • Down special ("bomb") — `trap` schema: a morph-ball bomb dropped at
 *     her feet that detonates on a fuse, with a bomb-jump self-bounce.
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
import type { MultiHitSideSpecialMove } from './sideSpecialSchema';
import type { MultiHitRisingUpSpecialMove } from './upSpecialSchema';
import type { TrapDownSpecialMove } from './downSpecialSchema';
import type { GrabSpec } from './grabSchema';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import type {
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
} from './movesetContract';
import { NOVA_MOVEMENT_PROFILE } from './fighterMovementProfiles';

// Re-export — per-fighter API surface; literal data lives in
// `fighterMovementProfiles.ts` (same split as the rest of the cast).
export { NOVA_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `NOVA_MOVEMENT_PROFILE`; the
 * tall 48×74 armoured body stays inline because it's collision data.
 */
export const NOVA_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...NOVA_MOVEMENT_PROFILE,
  // Tall armoured silhouette — slightly narrower than Blaze (50×78),
  // taller than Aegis (46×76). Sourced to match the cyborg sprite
  // footprint.
  width: 48,
  height: 74,
  chamfer: 8,
};

/**
 * Nova's jab — quick arm-cannon jab. Honest poke; her real damage lives
 * in the ranged tools, so the grounded triplet is workmanlike, not
 * special.
 *
 * Jab-combo opener (Tier 4): a re-press once jab1's hitbox is out
 * advances to jab2 → jab3 (the launching finisher), mirroring Wolf's
 * jab string.
 */
export const NOVA_JAB: AttackMoveWithAnimation = {
  id: 'nova.jab',
  type: 'jab',
  damage: 5,
  knockback: { x: 1.5, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 24, offsetY: -3, width: 30, height: 16 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 13,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'nova.jab2' },
};

/**
 * Nova's jab string — stage 2. A quick follow-up cannon poke that chains
 * from {@link NOVA_JAB} on a re-press and itself links to the
 * {@link NOVA_JAB3} finisher. Registered as a `'jab'` move but never the
 * light slot (first-registered jab1 keeps it) — reachable ONLY via the
 * chain link. Fast and low-commitment: a touch more reach than jab1,
 * slightly less knockback, ~0.7× the damage.
 */
export const NOVA_JAB2: AttackMoveWithAnimation = {
  id: 'nova.jab2',
  type: 'jab',
  damage: 4, // ≈ round(5 * 0.7)
  knockback: { x: 1.3, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 26, offsetY: -3, width: 30, height: 16 },
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 8,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'nova.jab3' },
};

/**
 * Nova's jab string — finisher (stage 3). The launcher that ends the
 * string: harder knockback + a `baseMagnitude` floor so it pops the
 * opponent away even at low percent. Slower / more committal than the
 * opener, with a slightly wider hit window. No `jabChain` — the chain
 * terminates here, and its `cooldownFrames` is the post-string lockout.
 */
export const NOVA_JAB3: AttackMoveWithAnimation = {
  id: 'nova.jab3',
  type: 'jab',
  damage: 6, // ≈ round(5 * 1.15)
  knockback: { x: 3.3, y: -1.6, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 28, offsetY: -3, width: 34, height: 19 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 15,
  cooldownFrames: 19,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Nova's forward tilt — cannon-butt spacing poke. Decent reach (she's a
 * spacer up close too) at the cast-average tilt scaling.
 */
export const NOVA_TILT: AttackMoveWithAnimation = {
  id: 'nova.tilt',
  type: 'tilt',
  damage: 8,
  knockback: { x: 2.1, y: -0.6, scaling: 0.13 },
  hitbox: { offsetX: 28, offsetY: -3, width: 36, height: 17 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 15,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Nova's forward smash — point-blank plasma burst. Full Smash-style
 * knockback block; her best close-range KO when the opponent finally
 * gets inside her zone. Heavyweight-tier punish for breaking past the
 * wall.
 */
export const NOVA_SMASH: AttackMoveWithAnimation = {
  id: 'nova.smash',
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
  hitbox: { offsetX: 32, offsetY: -3, width: 40, height: 18 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Nova's neutral aerial — body-centred plasma spin. A reliable
 * space-filling aerial to cover her landing when the zone collapses.
 */
export const NOVA_NAIR: AerialMove = {
  id: 'nova.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 7,
  knockback: { x: 1.5, y: -0.9, scaling: 0.11 },
  hitbox: { offsetX: 0, offsetY: -2, width: 48, height: 40 },
  startupFrames: 5,
  activeFrames: 6,
  recoveryFrames: 12,
  cooldownFrames: 9,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Nova's forward aerial — descending cannon kick. Mid numbers; the
 * value is keeping the opponent at bay while she repositions to re-zone.
 */
export const NOVA_FAIR: AerialMove = {
  id: 'nova.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 9,
  knockback: { x: 2.2, y: -0.8, scaling: 0.18 },
  hitbox: { offsetX: 24, offsetY: -3, width: 36, height: 20 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  landingLagFrames: 14,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Nova's back aerial — reverse cannon smash. Her strongest aerial KO
 * tool; the parting shot when she has to retreat through the opponent.
 */
export const NOVA_BAIR: AerialMove = {
  id: 'nova.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 11,
  knockback: { x: 2.7, y: -1.0, scaling: 0.26 },
  hitbox: { offsetX: 24, offsetY: -3, width: 36, height: 20 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 15,
  cooldownFrames: 12,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 16,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
};

/**
 * Nova's up aerial — overhead plasma flare above the cannon. Nova's
 * strongest aerial juggle tool and the core of her vertical combo game:
 * a clean upward launcher that floats the opponent into screw-attack /
 * up-smash range. Solid for the mid-heavy zoner — a touch harder-hitting
 * than the cast's lightweight uairs (she's not a fast-faller, so the
 * juggle has to land), but the slow-ish landing lag keeps it honest.
 *
 *   • Damage    : 10 — her best aerial alongside bair (11). Up-air is
 *                 the juggle launcher; bair stays the horizontal KO.
 *   • Knockback : x 0.3 / y -3.3, scaling 0.21 — near-vertical launch
 *                 (atan2 ≈ 84° up) that pops the target straight up for
 *                 a follow-up rather than away.
 *   • Frames    : 6 startup / 4 active / 14 recovery + 8 cooldown.
 *   • landingLagFrames 10 / autoCancelWindows [0,4) — mirrors her nair's
 *     clean-tail shape; an early-out before the hitbox spawns, plus the
 *     pure-`done`-phase tail enforced by `isAutoCancelFrame`.
 */
export const NOVA_UAIR: AerialMove = {
  id: 'nova.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 10,
  knockback: { x: 0.3, y: -3.3, scaling: 0.21 },
  hitbox: { offsetX: 0, offsetY: -30, width: 36, height: 28 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Nova's down aerial — a downward cannon-plunge spike. Meteor/spike
 * trajectory (positive y = downward in Phaser screen-space): catching an
 * off-stage opponent with this sends them straight down for the edge-
 * guard KO. Slow startup and the heaviest landing lag in her aerial kit
 * make it a committal read, fitting the zoner's deliberate, high-payoff
 * style.
 *
 *   • Damage    : 11 — meteor hits hard; the reward for the commitment.
 *   • Knockback : x 0.4 / y 3.6, scaling 0.24 — downward spike.
 *   • Frames    : 9 startup / 4 active / 18 recovery + 10 cooldown.
 *   • landingLagFrames 18 / autoCancelWindows [0,4) — heavy whiff
 *     penalty; a mistimed dair on landing is a punish window.
 */
export const NOVA_DAIR: AerialMove = {
  id: 'nova.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 11,
  knockback: { x: 0.4, y: 3.6, scaling: 0.24 },
  hitbox: { offsetX: 0, offsetY: 28, width: 32, height: 26 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 18,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Nova's up-tilt — a quick upward cannon-jab (up-stick + light). Fast
 * anti-air / juggle-starter above the body; low-commitment, weaker than
 * the up-smash but it begins the vertical pressure she finishes with
 * up-air or screw attack.
 *
 *   • Damage    : 7 — between jab (5) and tilt (8).
 *   • Knockback : x 0.2 / y -2.3, scaling 0.16 — pops the target up for
 *                 a follow-up, doesn't send them away.
 *   • Frames    : 5 startup / 3 active / 10 recovery + 12 cooldown.
 */
export const NOVA_UTILT: AttackMoveWithAnimation = {
  id: 'nova.utilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 0.2, y: -2.3, scaling: 0.16 },
  hitbox: { offsetX: 10, offsetY: -20, width: 64, height: 50 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Nova's up-smash — a rising overhead plasma burst (up-stick + heavy).
 * Her grounded vertical KO move: slow to commit, but a hard upward
 * launch that closes stocks on a juggled opponent. Mirrors her forward
 * smash's knockback shape ({ scaling 0.4, baseMagnitude 1.3,
 * damageGrowth 0.5 }) so the two smashes share an identity, with the
 * vector rotated upward. The tall hit window covers the column above her
 * armoured silhouette — the canonical "charge it under a falling
 * opponent" finisher.
 *
 *   • Damage    : 17 — her hardest single hit (fsmash 15, bair 11). The
 *                 overhead KO the zoner earns after walling the approach.
 *   • Knockback : x 0.3 / y -3.7, scaling 0.42, baseMagnitude 1.3,
 *                 damageGrowth 0.5 — near-vertical KO launch.
 *   • Frames    : 12 startup / 4 active / 20 recovery + 22 cooldown.
 *                 Committal — whiffing it is a hard punish.
 */
export const NOVA_USMASH: AttackMoveWithAnimation = {
  id: 'nova.usmash',
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
  hitbox: { offsetX: 11, offsetY: -27, width: 68, height: 64 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 20,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Nova's down-tilt — a low arm-cannon poke at the feet (down-stick +
 * light). Fast, near-horizontal "trip" that opens the opponent up at
 * the floor: the zoner's close-range combo/spacing starter when the
 * approach finally slips inside her ranged wall. Low-commitment — the
 * cheap poke that buys her space to re-zone.
 *
 *   • Damage    : 7 — between jab (5) and tilt (8); a poke, not a punish.
 *   • Knockback : x 1.6 / y -0.5, scaling 0.08 — a low, near-horizontal
 *                 trip (atan2 ≈ 17° up) that pops the target a hair off
 *                 the floor for a follow-up rather than away.
 *   • Hitbox    : offsetY +12 at the feet, low 14 px height, 36 px reach
 *                 — a flat sweep along the ground in front of her.
 *   • Frames    : 5 startup / 3 active / 10 recovery + 12 cooldown — her
 *                 fastest grounded normal alongside up-tilt.
 */
export const NOVA_DTILT: AttackMoveWithAnimation = {
  id: 'nova.dtilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 1.6, y: -0.5, scaling: 0.08 },
  hitbox: { offsetX: 26, offsetY: 30, width: 36, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Nova's down-smash — a sweeping ground plasma discharge at the feet
 * (down-stick + heavy). Her grounded HORIZONTAL KO move: a wide, low
 * sweep that catches an opponent on either approach lane and sends them
 * outward and low toward the side blast zone. Mirrors the knockback
 * SHAPE of her forward smash ({ scaling 0.4, baseMagnitude 1.3,
 * damageGrowth 0.5 }) so all three smashes share one identity — the
 * forward burst, the overhead up-smash, and this floor sweep — with the
 * vector aimed outward-and-low. The Samus zoner's solid, committal
 * down-smash: slow to start, but it closes stocks once the wall breaks.
 *
 *   • Damage    : 16 — between fsmash (15) and usmash (17); a hard hit.
 *   • Knockback : x 4.2 / y -1.0, scaling 0.4, baseMagnitude 1.3,
 *                 damageGrowth 0.5 — strong outward + low launch
 *                 (atan2 ≈ 13° up) toward the side blast zone.
 *   • Hitbox    : wide (52 px) and low (16 px), offsetY +14 at her feet
 *                 — the floor-sweep silhouette.
 *   • Frames    : 13 startup / 4 active / 18 recovery + 22 cooldown —
 *                 committal, mirroring her forward smash's commitment.
 */
export const NOVA_DSMASH: AttackMoveWithAnimation = {
  id: 'nova.dsmash',
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
  hitbox: { offsetX: 28, offsetY: 14, width: 52, height: 16 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Nova's dash-attack — a forward lunging cannon-shoulder used while
 * running (light press out of a dash). A burst approach / combo-starter
 * the slow zoner leans on to close the gap when she has to commit
 * forward: weaker than a smash, but it covers ground and pops the target
 * up-and-forward for a follow-up. Medium startup keeps it honest — a
 * whiffed lunge leaves the committal heavyweight exposed.
 *
 *   • Damage    : 10 — between tilt (8) and fsmash (15); a real hit, not
 *                 a KO. The running burst, not the finisher.
 *   • Knockback : x 2.6 / y -1.1, scaling 0.18 — moderate forward + up
 *                 (atan2 ≈ 23° up) that carries the target forward for a
 *                 juggle / re-zone rather than KO'ing.
 *   • Hitbox    : forward (offsetX +30), 40 px reach — extends ahead of
 *                 the lunge.
 *   • Frames    : 8 startup / 4 active / 16 recovery + 16 cooldown —
 *                 medium startup; the deliberate zoner's approach.
 */
export const NOVA_DASHATTACK: AttackMoveWithAnimation = {
  id: 'nova.dashAttack',
  type: 'tilt',
  damage: 10,
  knockback: { x: 2.6, y: -1.1, scaling: 0.18 },
  hitbox: { offsetX: 30, offsetY: -2, width: 40, height: 22 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 16,
  cooldownFrames: 16,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Nova's neutral special — **charge beam** (the Samus Charge Shot).
 * The centrepiece of the zoner kit: a genuinely chargeable, TRAVELLING
 * plasma shot.
 *
 *   • A bare tap fires a small, slow 6 % pellet — still a real projectile
 *     that crosses space (Samus: even the un-charged shot travels).
 *   • Holding charges it up; at full charge (90 frames) it releases a
 *     24 %, large, fast, stage-spanning KO orb.
 *   • The charge can be **banked** with shield (charge-cancel) and KEPT
 *     across actions until fired — a banked full charge fires on the next
 *     press, a banked partial resumes charging. Getting hit mid-charge
 *     drops it; a held bank survives. Reset on respawn.
 *
 * Modelled on the existing `'projectile'` special kind plus the optional
 * `chargedProjectile` charge overlay: the runtime spawns a real
 * travelling projectile (no body melee hitbox), scaling its damage,
 * knockback, speed, and size by the held-charge frames. The move-level
 * `damage` / `knockback` are the un-charged (t=0) endpoint; the
 * `chargedProjectile` block carries the full-charge endpoint.
 */
export const NOVA_NEUTRAL_SPECIAL: ProjectileSpecialMove = {
  id: 'nova.neutral_special',
  type: 'special',
  specialKind: 'projectile',
  // Un-charged (bare-press) damage / knockback — also the t=0 endpoint of
  // the charge ramp (the validator asserts charge.minDamage === this).
  damage: 6,
  knockback: { x: 1.8, y: -0.5, scaling: 0.1 },
  // Degenerate / unused: a charge-beam projectile spawns NO body melee
  // hitbox (Character suppresses it) — all damage rides the projectile.
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 8,
  activeFrames: 6,
  recoveryFrames: 18,
  cooldownFrames: 18,
  animation: { startupFrames: 3, activeFrames: 2, recoveryFrames: 3 },
  // Un-charged shot geometry: small + slow. These are the t=0 endpoints
  // the charge overlay lerps UP from.
  projectile: {
    speed: 9,
    lifetimeFrames: 70, // bounded range; a full-charge shot crosses the stage
    width: 18,
    height: 18,
    spawnOffsetX: 48,
    spawnOffsetY: -10,
  },
  // Samus charge-beam overlay — full-charge endpoint + charge ramp.
  chargedProjectile: {
    charge: {
      minChargeFrames: 0,
      maxChargeFrames: 90, // long ramp — patient zoning is rewarded
      minDamage: 6, // == move.damage (un-charged)
      maxDamage: 24, // full charge is a real KO threat
      minKnockback: { x: 1.8, y: -0.5, scaling: 0.1 },
      maxKnockback: { x: 4.6, y: -1.6, scaling: 0.4 },
    },
    maxSpeed: 22, // full charge travels fast
    maxWidth: 54, // full charge is a big, threatening orb
    maxHeight: 54,
  },
};

/**
 * Nova's side special — **missile** (`multiHit` schema, same shape as
 * Cat's / Aegis's flurry). A forward barrage: three missile hits that
 * chain on a re-press inside the 10-frame window, the third a launcher.
 * Authored long-reach so it reads as a mid-range wall rather than a
 * point-blank scramble — the side-special "projectile" feel within the
 * existing multiHit schema (the side-special schema has no dedicated
 * projectile kind, so the barrage is modelled as chained ranged hits).
 */
export const NOVA_SIDE_SPECIAL: MultiHitSideSpecialMove = {
  id: 'nova.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'multiHit',
  // Move-level damage / knockback carry the FIRST-HIT values.
  damage: 4,
  knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 40, offsetY: -4, width: 52, height: 24 },
  startupFrames: 7,
  activeFrames: 14,
  recoveryFrames: 16,
  cooldownFrames: 18,
  animation: { startupFrames: 2, activeFrames: 4, recoveryFrames: 3 },
  multiHit: {
    hitCount: 3,
    hitInterval: 5, // hits at active-frames [0, 5, 10]
    damagePerHit: [4, 4, 8],
    knockbackPerHit: [
      { x: 1.4, y: -0.4, scaling: 0.06 }, // missile 1 — link
      { x: 1.6, y: -0.5, scaling: 0.07 }, // missile 2 — link
      { x: 2.9, y: -1.3, scaling: 0.26 }, // missile 3 — launcher
    ],
    chainWindowFrames: 10,
  },
};

/**
 * Nova's up special — **screw attack** (`multiHitRising` schema). The
 * canonical strong recovery: a rising multi-hit spin, three link hits
 * pinning the target against the ascent and a launcher at the apex.
 * Slight forward drift so she can angle back to the ledge.
 */
export const NOVA_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'nova.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  // Move-level damage / knockback carry the LINK-HIT values.
  damage: 3,
  knockback: { x: 0, y: -0.5, scaling: 0.03 },
  hitbox: { offsetX: 0, offsetY: -4, width: 38, height: 48 },
  startupFrames: 4,
  activeFrames: 16,
  recoveryFrames: 20,
  cooldownFrames: 18,
  animation: { startupFrames: 1, activeFrames: 5, recoveryFrames: 2 },
  multiHitRising: {
    riseImpulse: -16, // strong recovery rise
    driftImpulse: 1.2, // slight forward drift toward the press direction
    hitCount: 3,
    hitInterval: 5, // hits at active-frames [0, 5, 10] — inside the 16
    linkDamage: 3,
    linkKnockback: { x: 0, y: -0.5, scaling: 0.03 },
    launcherDamage: 6,
    launcherKnockback: { x: 0.6, y: -3.2, scaling: 0.3 },
  },
};

/**
 * Nova's down special — **morph-ball BOMB** (`trap` schema, timed-bomb tuning).
 * The real Samus down-B: she drops a bomb at her feet that sits inert, then
 * DETONATES on its own fuse (~0.85 s) for a light blast. If she's next to it
 * when it pops it gives a small upward boost — the iconic BOMB-JUMP recovery
 * tech. Up to two bombs can be out. Light damage; the value is the trap/zoning
 * pressure and the recovery mix-up, not raw KO power.
 */
export const NOVA_DOWN_SPECIAL: TrapDownSpecialMove = {
  id: 'nova.down_special',
  type: 'downSpecial',
  downSpecialKind: 'trap',
  // No on-press damage — the payoff is the timed blast (see `trap`). The
  // runtime branches on `downSpecialKind` before reading these, so the
  // move-level hitbox is a degenerate placeholder the schema just needs filled.
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  trap: {
    trapWidth: 46,
    trapHeight: 42,
    spawnOffsetX: 0,
    spawnOffsetY: 30, // dropped at her feet (body half-height ≈ 37)
    armDelayFrames: 0, // unused for a fused bomb — overridden by the fuse
    trapLifetimeFrames: 60, // unused — overridden to fuse + blast window
    trapDamage: 5, // a light bomb, like Samus's
    trapKnockback: { x: 1.0, y: -1.7, scaling: 0.12 }, // small upward pop
    maxActiveTraps: 2, // a couple of bombs out at once
    fuseDetonateFrames: 52, // ~0.85 s: drops, then pops on its own timer
    selfBounceVelocity: -9, // BOMB-JUMP: pops her up (jumpImpulse is 12.5) if near
  },
};

/**
 * Nova's grab — standing grab with cast-average timing. Throws reset to
 * mid-range so she can re-establish her zone (forward / back) or start a
 * juggle into the screw attack (up).
 */
export const NOVA_GRAB: GrabSpec = {
  id: 'nova.grab',
  hitbox: { offsetX: 26, offsetY: -2, width: 24, height: 30 },
  startupFrames: 7,
  activeFrames: 2,
  whiffRecoveryFrames: 31,
  holdFramesMax: 88,
  throwRecoveryFrames: 23,
  pummel: { damage: 1.5, cooldownFrames: 13 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 9, knockback: { x: 2.6, y: -1.0, scaling: 0.11 }, animationFrames: 21 },
    back:    { damage: 10, knockback: { x: 2.9, y: -1.2, scaling: 0.13 }, animationFrames: 25 },
    up:      { damage: 7, knockback: { x: 0.4, y: -3.1, scaling: 0.1 }, animationFrames: 15 },
    down:    { damage: 6, knockback: { x: 0.9, y: 1.1, scaling: 0.08 }, animationFrames: 16 },
  },
};

/**
 * Nova's full 10-slot uniform moveset — canonical {@link FighterMoveset}
 * shape. Defensive slots use the shared defaults until a per-character
 * defensive balance pass lands.
 */
export const NOVA_MOVESET: FighterMoveset = Object.freeze({
  jab: NOVA_JAB,
  tilt: NOVA_TILT,
  smash: NOVA_SMASH,
  fair: NOVA_FAIR,
  neutralSpecial: NOVA_NEUTRAL_SPECIAL,
  sideSpecial: NOVA_SIDE_SPECIAL,
  upSpecial: NOVA_UP_SPECIAL,
  downSpecial: NOVA_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Nova's full {@link FighterContract} declaration — identity + 10-slot
 * moveset + movement profile in one frozen record.
 */
export const NOVA_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'nova',
  moveset: NOVA_MOVESET,
  movementProfile: NOVA_MOVEMENT_PROFILE,
});

/** Nova-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface NovaOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Nova fighter (Samus-inspired ranged zoner). Inherits all base
 * movement / jump physics from `Character` via {@link ContractFighter};
 * the kit wires through the same `registerFighterAttack` + `setGrabSpec`
 * path as the rest of the cast.
 */
export class Nova extends ContractFighter {
  /** Nova's frozen 10-slot moveset surface — see {@link NOVA_MOVESET}. */
  readonly moveset: FighterMoveset = NOVA_MOVESET;

  /** Nova's per-fighter movement parameters — see {@link NOVA_MOVEMENT_PROFILE}. */
  readonly movementProfile: FighterMovementProfile = NOVA_MOVEMENT_PROFILE;

  /** Full per-fighter declaration — see {@link NOVA_FIGHTER_CONTRACT}. */
  readonly contract: FighterContract = NOVA_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: NovaOptions) {
    super(scene, {
      id: 'nova',
      // Nova's tuning is the floor; caller-supplied options win via the
      // base spread merge.
      ...NOVA_TUNING,
      ...options,
    });
    // Registration order mirrors the cast convention — grounded triplet,
    // aerial cut, four specials. See `Blaze.ts` / `Wolf.ts` for the
    // slot-wiring rationale.
    registerFighterAttack(this, NOVA_JAB);
    // Jab-string stages 2 + 3 — register after jab1 so the light slot
    // stays jab1 (first-registered-wins); reachable only via `jabChain`.
    registerFighterAttack(this, NOVA_JAB2);
    registerFighterAttack(this, NOVA_JAB3);
    registerFighterAttack(this, NOVA_TILT);
    registerFighterAttack(this, NOVA_SMASH);
    registerFighterAttack(this, NOVA_NAIR);
    registerFighterAttack(this, NOVA_FAIR);
    registerFighterAttack(this, NOVA_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt / up-smash are
    // type 'tilt'/'smash' (their forward slots are taken), so wire the
    // dedicated up slots explicitly.
    registerFighterAttack(this, NOVA_UAIR);
    registerFighterAttack(this, NOVA_DAIR);
    registerFighterAttack(this, NOVA_UTILT);
    registerFighterAttack(this, NOVA_USMASH);
    this.setUpTilt(NOVA_UTILT.id);
    this.setUpSmash(NOVA_USMASH.id);
    // Directional attacks (down-stick + dash). Down-tilt / down-smash /
    // dash-attack are type 'tilt'/'smash' (their forward slots are
    // already taken), so wire the dedicated down / dash slots explicitly.
    registerFighterAttack(this, NOVA_DTILT);
    registerFighterAttack(this, NOVA_DSMASH);
    registerFighterAttack(this, NOVA_DASHATTACK);
    this.setDownTilt(NOVA_DTILT.id);
    this.setDownSmash(NOVA_DSMASH.id);
    this.setDashAttack(NOVA_DASHATTACK.id);
    registerFighterAttack(this, NOVA_NEUTRAL_SPECIAL);
    registerFighterAttack(this, NOVA_SIDE_SPECIAL);
    registerFighterAttack(this, NOVA_UP_SPECIAL);
    registerFighterAttack(this, NOVA_DOWN_SPECIAL);

    // Grab — wires the range sensor + 4-throw set into the grab state
    // machine ticked by `Character.applyInput`.
    this.setGrabSpec(NOVA_GRAB);
  }

  // Per-slot execute hooks are inherited from ContractFighter, which
  // fires each slot off the frozen `moveset` declaration above.
}
