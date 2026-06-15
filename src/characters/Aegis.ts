/**
 * Aegis (Marth) — seventh roster slot, the sword-spacing duelist.
 *
 * Role: spacing. Mid stats across the board (run 8.0, mass 11,
 * standard double jump) — the identity lives entirely in the blade:
 *
 *   **Every normal in the kit carries a TIP sweet-spot.** Each of the
 *   six normals (jab / tilt / smash / nair / fair / bair) authors a
 *   generous-reach hitbox — the longest reach ladder in the cast —
 *   with a `sweetSpot` sub-region pinned at the far end of the blade.
 *   A tip connect multiplies damage ×1.35 and knockback ×1.3 (plus
 *   the +4 hitlag crunch from `combat.ts`); a body hit pays full
 *   commitment for sour numbers. Maximum reward lives at maximum
 *   distance — the canonical "tipper" spacing game.
 *
 * Specials:
 *
 *   • Neutral special — **counter** (same schema Wolf's counter uses):
 *     parry window during the active phase, retaliation slash in
 *     front on a successful catch.
 *   • Side special — **dancing blades** (`multiHit` schema): a 3-hit
 *     chainable flurry with a launcher finisher.
 *   • Up special — **dolphin slash** (`multiHitRising` schema):
 *     3-frame startup (fastest recovery special in the cast), steep
 *     rise, two-hit ladder with an early launcher.
 *   • Down special — **plunging thrust** (`stallAndFall` schema):
 *     brief aerial stall, then a blade-first dive with a landing
 *     shockwave.
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
import type { CounterSpecialMove } from './specialSchema';
import type { MultiHitSideSpecialMove } from './sideSpecialSchema';
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
import { AEGIS_MOVEMENT_PROFILE } from './fighterMovementProfiles';

// Re-export — per-fighter API surface; literal data lives in
// `fighterMovementProfiles.ts` (same split as the rest of the cast).
export { AEGIS_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `AEGIS_MOVEMENT_PROFILE`; body
 * geometry stays inline (hurtbox / collision data, not movement).
 */
export const AEGIS_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...AEGIS_MOVEMENT_PROFILE,
  // Slender duelist silhouette — taller than Wolf (45×66), thinner
  // than Blaze (50×78). Procedural placeholder body: no source sprite
  // cell to match yet. The narrow hurtbox is part of the spacing
  // archetype: hard to clip when he's at tipper range.
  width: 46,
  height: 76,
  chamfer: 8,
};

/**
 * Aegis's jab — quick blade flick. Parent sensor spans x [7, 45]
 * (longest jab reach in the cast); the tip sweet-spot covers the
 * outer ~12 px of blade ([32, 44], strictly inside the parent per the
 * schema contract). Tip: 5 × 1.35 ≈ 6.75 % and a real shove; body
 * hit: a 5 % tap.
 */
export const AEGIS_JAB: AttackMoveWithAnimation = {
  id: 'aegis.jab',
  type: 'jab',
  damage: 5,
  knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 26, offsetY: -3, width: 38, height: 16 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 13,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  sweetSpot: {
    hitbox: { offsetX: 38, offsetY: -3, width: 12, height: 14 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
  // Jab-combo opener: a re-press once jab1's hitbox is out advances to
  // jab2 → jab3 (the finisher). Tier 4. (Mirrors `WOLF_JAB`.)
  jabChain: { nextId: 'aegis.jab2' },
};

/**
 * Aegis's jab string — stage 2. A quick follow-up blade poke that chains
 * from {@link AEGIS_JAB} on a re-press and itself links to the
 * {@link AEGIS_JAB3} finisher. Registered as a `'jab'` move but never the
 * light slot (first-registered jab1 keeps it) — reachable ONLY via the
 * chain link. Damage ≈ round(jab1 × 0.7); a touch slower-decaying
 * knockback than jab1, faster frames, hitbox nudged a hair further out.
 */
export const AEGIS_JAB2: AttackMoveWithAnimation = {
  id: 'aegis.jab2',
  type: 'jab',
  damage: 4,
  knockback: { x: 1.2, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 28, offsetY: -3, width: 38, height: 16 },
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 8,
  cooldownFrames: 11,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'aegis.jab3' },
};

/**
 * Aegis's jab string — finisher (stage 3). The launcher that ends the
 * string: bigger knockback (clearly larger x and y than jab1) plus a
 * `baseMagnitude` floor so it pops the opponent away even at low percent.
 * Damage ≈ round(jab1 × 1.15), a slightly wider blade, and slower
 * committal frames. No `jabChain` — the chain terminates here, and its
 * `cooldownFrames` is the post-string lockout. (Mirrors `WOLF_JAB3`.)
 */
export const AEGIS_JAB3: AttackMoveWithAnimation = {
  id: 'aegis.jab3',
  type: 'jab',
  damage: 6,
  knockback: { x: 3.0, y: -1.6, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 28, offsetY: -3, width: 42, height: 18 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 15,
  cooldownFrames: 19,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Aegis's forward tilt — sweeping blade arc, the core spacing tool.
 * Parent sensor spans x [9, 53]; tip at [40, 52]. The reach gap over
 * his jab keeps the jab < tilt < smash ladder intact while every rung
 * out-ranges the cast at the same rung.
 */
export const AEGIS_TILT: AttackMoveWithAnimation = {
  id: 'aegis.tilt',
  type: 'tilt',
  damage: 8,
  knockback: { x: 2.1, y: -0.6, scaling: 0.12 },
  hitbox: { offsetX: 31, offsetY: -3, width: 44, height: 17 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  sweetSpot: {
    hitbox: { offsetX: 46, offsetY: -3, width: 12, height: 15 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's forward smash — full-extension lunge thrust. Parent sensor
 * spans x [11, 61] — the longest grounded reach in the cast; tip at
 * [48, 60]. A tip connect reads as 13 × 1.35 ≈ 17.6 % with ×1.3 on an
 * already smash-tier launch: the textbook tipper KO.
 */
export const AEGIS_SMASH: AttackMoveWithAnimation = {
  id: 'aegis.smash',
  type: 'smash',
  damage: 13,
  knockback: { x: 3.8, y: -1.4, scaling: 0.36, baseMagnitude: 1.2, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 13,
    maxDamage: 18.2,
    minKnockback: { x: 3.8, y: -1.4, scaling: 0.36, baseMagnitude: 1.2, damageGrowth: 0.5 },
    maxKnockback: { x: 5.32, y: -1.96, scaling: 0.45, baseMagnitude: 1.2, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 36, offsetY: -3, width: 50, height: 18 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 17,
  cooldownFrames: 21,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  sweetSpot: {
    hitbox: { offsetX: 54, offsetY: -3, width: 12, height: 16 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's neutral aerial — full-circle blade spin. The body-centred
 * sensor is wide (56 px) so even the "neutral" option keeps the reach
 * identity; the tip sweet-spot sits at the leading edge of the arc
 * ([15, 27] inside the [-28, 28] parent).
 */
export const AEGIS_NAIR: AerialMove = {
  id: 'aegis.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 7,
  knockback: { x: 1.6, y: -0.9, scaling: 0.12 },
  hitbox: { offsetX: 0, offsetY: -2, width: 56, height: 40 },
  startupFrames: 5,
  activeFrames: 6,
  recoveryFrames: 11,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 9,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
  sweetSpot: {
    hitbox: { offsetX: 21, offsetY: -2, width: 12, height: 36 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's forward aerial — rising forward slash. Parent sensor spans
 * x [6, 50]; tip at [37, 49]. The tip fair is his bread-and-butter
 * edge-guard poke: spaced at the blade's end it converts ledge
 * pressure into side-blast-zone KOs.
 */
export const AEGIS_FAIR: AerialMove = {
  id: 'aegis.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 10,
  knockback: { x: 2.3, y: -0.8, scaling: 0.18 },
  hitbox: { offsetX: 28, offsetY: -3, width: 44, height: 20 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 13,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  landingLagFrames: 13,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
  sweetSpot: {
    hitbox: { offsetX: 43, offsetY: -3, width: 12, height: 18 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's back aerial — reverse grip slash. His hardest aerial (11 %);
 * parent sensor spans x [7, 49] with the tip at [36, 48]. The tip
 * bair is the parting-shot kill move of the kit.
 */
export const AEGIS_BAIR: AerialMove = {
  id: 'aegis.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 11,
  knockback: { x: 2.7, y: -1.0, scaling: 0.26 },
  hitbox: { offsetX: 28, offsetY: -3, width: 42, height: 20 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 11,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 16,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
  sweetSpot: {
    hitbox: { offsetX: 42, offsetY: -3, width: 12, height: 18 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's up aerial — overhead rising blade arc. The kit's strongest
 * aerial juggle tool: a slim upward sensor (offsetY -34) sitting above
 * the head, with the tip sweet-spot pinned at the very top of the arc
 * ([-46, -32] inside the [-44, -24] parent column). A tip up-air reads
 * as 9 × 1.35 ≈ 12.2 % with ×1.3 on an already steep launch — the
 * tippery launcher that opens the vertical-juggle game. Slightly larger
 * sensor than Wolf's uair (40 vs 36 wide, 30 vs 28 tall) for the
 * disjoint-reach identity. Fast clean startup; juggle-extend angle is
 * near-vertical (atan2 on x 0.3 / y -3.3).
 */
export const AEGIS_UAIR: AerialMove = {
  id: 'aegis.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 9,
  knockback: { x: 0.3, y: -3.3, scaling: 0.20 },
  hitbox: { offsetX: 0, offsetY: -34, width: 40, height: 30 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 9,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
  sweetSpot: {
    hitbox: { offsetX: 0, offsetY: -42, width: 24, height: 14 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's down aerial — blade-first downward stab (meteor / spike).
 * A slim downward sensor (offsetY +30) below the feet; +y is downward
 * in Phaser screen-space, the spike trajectory. The tip sweet-spot sits
 * at the very point of the blade ([+34, +48] inside the [+24, +44]
 * parent column) — a tip d-air is the off-stage stock-ender: 10 × 1.35
 * ≈ 13.5 % with ×1.3 on the meteor knockback. Slightly larger sensor
 * than Wolf's dair (36 vs 32 wide, 28 vs 26 tall) for the disjoint
 * reach. Committal startup + heavy landing lag — a whiffed d-air is a
 * free punish.
 */
export const AEGIS_DAIR: AerialMove = {
  id: 'aegis.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 10,
  knockback: { x: 0.4, y: 3.5, scaling: 0.24 },
  hitbox: { offsetX: 0, offsetY: 30, width: 36, height: 28 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 18,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
  sweetSpot: {
    hitbox: { offsetX: 0, offsetY: 40, width: 24, height: 14 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's up-tilt — a quick overhead blade flick (up-stick light). Fast
 * (5-frame startup) upward-launching anti-air / juggle-starter; the
 * low-commitment grounded complement to the up-air. A slim vertical
 * column above the head ([-45, -15] in y) with the tip sweet-spot at the
 * very top of the arc — a tip u-tilt at the edge of the blade reads 7 ×
 * 1.35 ≈ 9.5 % with ×1.3 on the juggle pop. Slightly larger sensor than
 * Wolf's utilt (38 vs 34 wide) for the disjoint reach. Weaker than the
 * up-smash but recovers fast enough to re-juggle.
 */
export const AEGIS_UTILT: AttackMoveWithAnimation = {
  id: 'aegis.utilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 0.2, y: -2.3, scaling: 0.16 },
  hitbox: { offsetX: 9, offsetY: -20, width: 62, height: 50 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  sweetSpot: {
    hitbox: { offsetX: 0, offsetY: -40, width: 22, height: 14 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's up-smash — a full-extension rising vertical thrust (up-stick
 * heavy). The grounded vertical KO: slow startup (12 frames) so it
 * punishes whiff-prone juggles, but a clean — especially a tip — connect
 * is a stock. Mirrors his forward smash's KB shape (baseMagnitude 1.2 /
 * damageGrowth 0.5 / scaling) but aimed straight up. A tip u-smash reads
 * 16 × 1.35 ≈ 21.6 % with ×1.3 on smash-tier vertical knockback — the
 * canonical "charge it under a juggled opponent" finisher. Slightly
 * larger sensor than Wolf's usmash (44 vs 40 wide, 46 vs 44 tall) for
 * the disjoint reach; the tip sweet-spot caps the very top of the blade.
 */
export const AEGIS_USMASH: AttackMoveWithAnimation = {
  id: 'aegis.usmash',
  type: 'smash',
  damage: 16,
  knockback: { x: 0.3, y: -3.6, scaling: 0.42, baseMagnitude: 1.2, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 16,
    maxDamage: 22.4,
    minKnockback: { x: 0.3, y: -3.6, scaling: 0.42, baseMagnitude: 1.2, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -5.04, scaling: 0.525, baseMagnitude: 1.2, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 10, offsetY: -27, width: 66, height: 64 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 20,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  sweetSpot: {
    hitbox: { offsetX: 0, offsetY: -52, width: 26, height: 16 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's down-tilt — a low crouching blade poke at the feet (down-stick
 * light). The kit's fastest grounded option (5-frame startup): a quick,
 * near-horizontal "trip" jab that pokes shins and converts into the
 * tipper game. A slim low sensor pinned at the feet (offsetY +12, short
 * height) reaching out past his body in the facing direction — the
 * spacing identity holds even on the floor. Low, mostly-horizontal
 * knockback (y -0.3) keeps the target grounded and close for a follow-up
 * tilt / dash-in. The tip sweet-spot caps the far end of the low blade —
 * a spaced tip d-tilt reads 6 × 1.35 ≈ 8.1 % with ×1.3 on the poke.
 * Slightly larger/longer sensor than Wolf's downLight (40 vs 32 wide)
 * for the disjoint reach. Fast recovery so it stays a combo/spacing tool,
 * never a finisher.
 */
export const AEGIS_DTILT: AttackMoveWithAnimation = {
  id: 'aegis.dtilt',
  type: 'tilt',
  damage: 6,
  knockback: { x: 1.6, y: -0.3, scaling: 0.10 },
  hitbox: { offsetX: 26, offsetY: 31, width: 40, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  sweetSpot: {
    hitbox: { offsetX: 40, offsetY: 12, width: 12, height: 12 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's down-smash — a sweeping two-sided ground slash (down-stick
 * heavy). The kit's grounded HORIZONTAL KO: a wide blade sweep at the
 * feet (large width, low height, offsetY positive) that launches outward
 * and low toward the side blast zone. Mirrors his forward smash's KB
 * SHAPE (baseMagnitude 1.2 / damageGrowth 0.5 / scaling family) tuned a
 * touch hotter — the down-smash is the duelist's "strong d-smash"
 * signature: 14 base damage with smash-tier outward+low knockback. Slow
 * startup (13 frames) so a whiff is a free punish, but a clean — and
 * especially a tip — connect closes a stock. The tip sweet-spot caps the
 * far end of the sweep ([+50, +62] inside the parent): a tip d-smash
 * reads 14 × 1.35 ≈ 18.9 % with ×1.3 on the outward launch. Widest
 * grounded sweep in his kit (58 px) for the disjoint-reach identity.
 */
export const AEGIS_DSMASH: AttackMoveWithAnimation = {
  id: 'aegis.dsmash',
  type: 'smash',
  damage: 14,
  knockback: { x: 3.9, y: -1.0, scaling: 0.38, baseMagnitude: 1.2, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 14,
    maxDamage: 19.6,
    minKnockback: { x: 3.9, y: -1.0, scaling: 0.38, baseMagnitude: 1.2, damageGrowth: 0.5 },
    maxKnockback: { x: 5.46, y: -1.4, scaling: 0.475, baseMagnitude: 1.2, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 30, offsetY: 14, width: 58, height: 18 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 19,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  sweetSpot: {
    hitbox: { offsetX: 50, offsetY: 14, width: 12, height: 16 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's dash-attack — a forward lunging blade thrust used while running
 * (light press out of a dash). A burst approach / combo-starter: a
 * forward hitbox (positive offsetX) that pops the target up-and-forward
 * for a juggle or a tipper follow-up. Medium startup (7 frames) and
 * moderate forward+up knockback — weaker than the smashes (it's an
 * approach tool, not a finisher) but the disjoint reach lets it close
 * neutral from a screen away. The tip sweet-spot sits at the leading edge
 * of the lunge ([+50, +62] inside the parent): a tip dash-attack reads
 * 9 × 1.35 ≈ 12.2 % with ×1.3 on the launch. Longer reach than his tilt
 * (parent out to +60) so the running blade out-spaces the cast.
 */
export const AEGIS_DASHATTACK: AttackMoveWithAnimation = {
  id: 'aegis.dashAttack',
  type: 'tilt',
  damage: 9,
  knockback: { x: 2.2, y: -1.3, scaling: 0.16 },
  hitbox: { offsetX: 34, offsetY: -3, width: 52, height: 18 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  sweetSpot: {
    hitbox: { offsetX: 50, offsetY: -3, width: 12, height: 16 },
    damageMultiplier: 1.35,
    knockbackMultiplier: 1.3,
  },
};

/**
 * Aegis's neutral special — **counter** (same `counter` schema as
 * Wolf's neutral special; see `Wolf.ts` for the full mechanic walk-
 * through). Aegis's variant is the duelist's read: identical window
 * timing to Wolf's, with a slightly tighter damage ceiling (20 vs 22)
 * because his tipper normals already carry the kill power.
 *
 *   counterWindow      = [5, 17)  (the active phase)
 *   damageMultiplier   = 1.3 (Smash-canonical), clamp [8, 20]
 *   counterHitbox      = 80×40 sensor 60 px in front — a retaliation
 *                        slash at blade range.
 */
export const AEGIS_NEUTRAL_SPECIAL: CounterSpecialMove = {
  id: 'aegis.neutral_special',
  type: 'special',
  specialKind: 'counter',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  // Degenerate sensor — the counter has no proactive hit; the runtime
  // branches on `specialKind` before consulting `move.hitbox`.
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 5,
  activeFrames: 12,
  recoveryFrames: 18,
  cooldownFrames: 24,
  animation: { startupFrames: 2, activeFrames: 3, recoveryFrames: 3 },
  counter: {
    counterWindowStart: 5,
    counterWindowEnd: 17,
    damageMultiplier: 1.3,
    minCounterDamage: 8,
    maxCounterDamage: 20,
    counterKnockback: { x: 3.8, y: -1.5, scaling: 0.28 },
    counterHitbox: {
      offsetX: 60,
      offsetY: -5,
      width: 80,
      height: 40,
    },
  },
};

/**
 * Aegis's side special — **dancing blades** (`multiHit` schema, same
 * shape as Cat's flurry). Three chained slashes: two link hits and a
 * launcher finisher, each extension gated on a re-press inside the
 * 8-frame chain window. The blade-length hitbox keeps the flurry a
 * spacing tool rather than a point-blank scramble.
 */
export const AEGIS_SIDE_SPECIAL: MultiHitSideSpecialMove = {
  id: 'aegis.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'multiHit',
  // Move-level damage / knockback carry the FIRST-HIT values.
  damage: 3,
  knockback: { x: 1.1, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 30, offsetY: -3, width: 46, height: 26 },
  startupFrames: 5,
  activeFrames: 12,
  recoveryFrames: 13,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 3, recoveryFrames: 2 },
  multiHit: {
    hitCount: 3,
    hitInterval: 4, // hits at active-frames [0, 4, 8]
    damagePerHit: [3, 4, 7],
    knockbackPerHit: [
      { x: 1.1, y: -0.3, scaling: 0.05 }, // hit 1 — link
      { x: 1.3, y: -0.4, scaling: 0.06 }, // hit 2 — link
      { x: 2.7, y: -1.3, scaling: 0.24 }, // hit 3 — launcher
    ],
    chainWindowFrames: 8,
  },
};

/**
 * Aegis's up special — **dolphin slash** (`multiHitRising` schema).
 * The canonical lightning-fast recovery slash: 3-frame startup (the
 * fastest special in the cast), a steep -19 rise with slight forward
 * drift, and a two-hit ladder whose launcher lands early in the rise.
 * The trade for the speed is the longest special recovery in his kit
 * — a baited dolphin slash is a free punish.
 */
export const AEGIS_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'aegis.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  // Move-level damage / knockback carry the LINK-HIT values.
  damage: 4,
  knockback: { x: 0.2, y: -0.8, scaling: 0.05 },
  hitbox: { offsetX: 0, offsetY: -4, width: 40, height: 50 },
  startupFrames: 3,
  activeFrames: 12,
  recoveryFrames: 24,
  cooldownFrames: 20,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 3 },
  multiHitRising: {
    riseImpulse: -19, // steepest rise in the cast — the slash IS the jump
    driftImpulse: 1,
    hitCount: 2,
    hitInterval: 5, // hits at active-frames [0, 5] — inside the 12
    linkDamage: 4,
    linkKnockback: { x: 0.2, y: -0.8, scaling: 0.05 },
    launcherDamage: 7,
    launcherKnockback: { x: 0.6, y: -3.2, scaling: 0.3 },
  },
};

/**
 * Aegis's down special — **plunging thrust** (`stallAndFall` schema,
 * same shape as Owl's). A brief blade-overhead stall, then a
 * blade-first dive: the descent body carries the meteor hit, the
 * landing fires a modest shockwave. `helplessAfterFall: false` — the
 * thrust is a committal mix-up, not a recovery forfeit.
 */
export const AEGIS_DOWN_SPECIAL: StallAndFallDownSpecialMove = {
  id: 'aegis.down_special',
  type: 'downSpecial',
  downSpecialKind: 'stallAndFall',
  // Move-level damage / knockback are the METEOR (descent) values —
  // +y is downward in Phaser screen-space, the spike trajectory.
  damage: 11,
  knockback: { x: 0.4, y: 3.4, scaling: 0.26 },
  // Blade-length vertical sensor — covers the body + extended blade
  // during the dive.
  hitbox: { offsetX: 0, offsetY: 2, width: 38, height: 70 },
  startupFrames: 4,
  activeFrames: 16,
  recoveryFrames: 19,
  cooldownFrames: 18,
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 3 },
  stallAndFall: {
    stallFrames: 5, // first 5 of 16 active frames are the stall
    stallVelocity: -2, // slight hover while the blade comes overhead
    fallVelocity: 26, // blade-first plunge
    shockwaveDamage: 5,
    shockwaveKnockback: { x: 1.5, y: -0.9, scaling: 0.12 },
    shockwaveHitbox: {
      offsetX: 0,
      offsetY: 34, // at his feet (body half-height = 38)
      width: 130,
      height: 20,
    },
    helplessAfterFall: false,
  },
};

/**
 * Aegis's grab — standard standing grab. Throws are deliberately mid
 * — the kit's kill power lives in the tippers, so the throws exist to
 * reset to tipper range (forward / back) or start a juggle (up).
 */
export const AEGIS_GRAB: GrabSpec = {
  id: 'aegis.grab',
  hitbox: { offsetX: 25, offsetY: -2, width: 24, height: 28 },
  startupFrames: 7,
  activeFrames: 2,
  whiffRecoveryFrames: 30,
  holdFramesMax: 85,
  throwRecoveryFrames: 23,
  pummel: { damage: 1.2, cooldownFrames: 13 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 8, knockback: { x: 2.4, y: -1.0, scaling: 0.1 }, animationFrames: 21 },
    back:    { damage: 9, knockback: { x: 2.7, y: -1.1, scaling: 0.12 }, animationFrames: 25 },
    up:      { damage: 7, knockback: { x: 0.5, y: -3.0, scaling: 0.1 }, animationFrames: 15 },
    down:    { damage: 6, knockback: { x: 0.8, y: 1.1, scaling: 0.08 }, animationFrames: 16 },
  },
};

/**
 * Aegis's full 10-slot uniform moveset — canonical {@link FighterMoveset}
 * shape. Defensive slots use the shared defaults until a per-character
 * defensive balance pass lands.
 */
export const AEGIS_MOVESET: FighterMoveset = Object.freeze({
  jab: AEGIS_JAB,
  tilt: AEGIS_TILT,
  smash: AEGIS_SMASH,
  fair: AEGIS_FAIR,
  neutralSpecial: AEGIS_NEUTRAL_SPECIAL,
  sideSpecial: AEGIS_SIDE_SPECIAL,
  upSpecial: AEGIS_UP_SPECIAL,
  downSpecial: AEGIS_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Aegis's full {@link FighterContract} declaration — identity + 10-slot
 * moveset + movement profile in one frozen record.
 */
export const AEGIS_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'aegis',
  moveset: AEGIS_MOVESET,
  movementProfile: AEGIS_MOVEMENT_PROFILE,
});

/** Aegis-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface AegisOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Aegis fighter (Marth-inspired sword spacing). Inherits all base
 * movement / jump physics from `Character` via {@link ContractFighter};
 * the tip sweet-spots flow through the existing `AttackMove.sweetSpot`
 * schema with zero new runtime work.
 */
export class Aegis extends ContractFighter {
  /** Aegis's frozen 10-slot moveset surface — see {@link AEGIS_MOVESET}. */
  readonly moveset: FighterMoveset = AEGIS_MOVESET;

  /** Aegis's per-fighter movement parameters — see {@link AEGIS_MOVEMENT_PROFILE}. */
  readonly movementProfile: FighterMovementProfile = AEGIS_MOVEMENT_PROFILE;

  /** Full per-fighter declaration — see {@link AEGIS_FIGHTER_CONTRACT}. */
  readonly contract: FighterContract = AEGIS_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: AegisOptions) {
    super(scene, {
      id: 'aegis',
      // Aegis's tuning is the floor; caller-supplied options win via
      // the base spread merge.
      ...AEGIS_TUNING,
      ...options,
    });
    // Registration order mirrors the cast convention — grounded
    // triplet, aerial cut, four specials. See `Blaze.ts` / `Wolf.ts`
    // for the slot-wiring rationale.
    registerFighterAttack(this, AEGIS_JAB);
    // Jab string stages 2 + 3 register as 'jab' moves but jab1 keeps the
    // light slot via first-registered-wins; they are reachable only via
    // the `jabChain` links. (Mirrors Wolf's WOLF_JAB2 / WOLF_JAB3 wiring.)
    registerFighterAttack(this, AEGIS_JAB2);
    registerFighterAttack(this, AEGIS_JAB3);
    registerFighterAttack(this, AEGIS_TILT);
    registerFighterAttack(this, AEGIS_SMASH);
    registerFighterAttack(this, AEGIS_NAIR);
    registerFighterAttack(this, AEGIS_FAIR);
    registerFighterAttack(this, AEGIS_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt / up-smash are
    // type 'tilt'/'smash' (their forward slots are already taken by the
    // tilt / smash above), so wire the dedicated up slots explicitly.
    registerFighterAttack(this, AEGIS_UAIR);
    registerFighterAttack(this, AEGIS_DAIR);
    registerFighterAttack(this, AEGIS_UTILT);
    registerFighterAttack(this, AEGIS_USMASH);
    this.setUpTilt(AEGIS_UTILT.id);
    this.setUpSmash(AEGIS_USMASH.id);
    // Down + dash grounded normals. Down-tilt / down-smash are type
    // 'tilt'/'smash' (their forward slots are already taken by the tilt /
    // smash above) and dash-attack is type 'tilt' as well, so all three
    // forward slots are occupied — wire the dedicated down / dash slots
    // explicitly via setDownTilt / setDownSmash / setDashAttack.
    registerFighterAttack(this, AEGIS_DTILT);
    registerFighterAttack(this, AEGIS_DSMASH);
    registerFighterAttack(this, AEGIS_DASHATTACK);
    this.setDownTilt(AEGIS_DTILT.id);
    this.setDownSmash(AEGIS_DSMASH.id);
    this.setDashAttack(AEGIS_DASHATTACK.id);
    registerFighterAttack(this, AEGIS_NEUTRAL_SPECIAL);
    registerFighterAttack(this, AEGIS_SIDE_SPECIAL);
    registerFighterAttack(this, AEGIS_UP_SPECIAL);
    registerFighterAttack(this, AEGIS_DOWN_SPECIAL);

    // Grab — wires the range sensor + 4-throw set into the grab state
    // machine ticked by `Character.applyInput`.
    this.setGrabSpec(AEGIS_GRAB);
  }

  // Per-slot execute hooks are inherited from ContractFighter, which
  // fires each slot off the frozen `moveset` declaration above.
}
