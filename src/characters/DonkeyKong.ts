/**
 * Donkey Kong — Super Smash Bros. Ultimate kit, sourced.
 *
 * Every timing, damage and launch value below comes from
 *   • Ultimate Frame Data (https://ultimateframedata.com/donkey_kong,
 *     checked 2026-10-06) — startup / active / total frames, damage, landing lag,
 *     autocancel, armour and intangibility notes;
 *   • the dumped Ultimate scripts (WuBoytH/SSBU-Dumped-Scripts @
 *     59004685238a3f6f93bae905d3a4e079701c40b4, smashline/lua2cpp_donkey/donkey)
 *     — per-hitbox angle / KBG / FKB / BKB, hitlag, situation masks and
 *     bone-local geometry. The parsed records live in
 *     src/characters/donkeykongAttackData.ts; raw scripts and complete comparisons in
 *     docs/review/2026-10-06/dk-all-attack-values/.
 *
 * Conventions (see the evidence record's "Unit/frame contract"):
 *   • UFD frame 1 is elapsed step 0. `startupFrames` = first active − 1,
 *     `activeFrames` = active envelope length, `recoveryFrames` = UFD endlag;
 *     the three sum to the UFD total. `hitWindows` / `armorWindows` are
 *     zero-based half-open: source `[s, e]` → `[s − 1, e)`.
 *   • `knockback.reference` is the script record (`base` = BKB, `growth` =
 *     KBG, `fixed` = FKB; `setWeight` follows its separate source flag). The legacy x/y/scaling vector is
 *     only a fallback for tooling that ignores `reference`.
 *   • Geometry: 5 px per unit. Script offsets on the `top` bone convert
 *     exactly (x = 5·z forward, y = 42 − 5·y with the feet at +42 on this
 *     60×84 px body). Bone-attached regions (arms, hands, feet, head) are
 *     placed from the inspected UFD frames (docs/review/…/motion/*.md) and are
 *     therefore **approximate**, except up tilt and down smash, which are posed
 *     per frame on the native skeleton; radii are the script sizes × 5.
 *   • Source arm/head protection windows name receiving bones. Native
 *     no-rebound (`THRU`) and transcendent (`OFF`) flags are kept distinct.
 *     Gameplay/visual qualification is tracked separately in the evidence.
 *
 * Every numeric here is a frozen literal — no randomness, no wall-clock.
 */

import type { PhysicsHost } from '../physics/PhysicsWorld';
import {getDefaultCaptureAttachmentCalibration} from './captureAttachmentDefaultData';
import { dkSourceMove, dkSourceHits, dkSourceKnockback, DK_PROTECTION_WINDOWS } from './donkeykongSourceMoves';
import { DK_NATIVE_ATTACKS } from './donkeykongAttackData';
import { DK_FORWARD_TILT_REGIONS, dkAngledTiltRegions, DK_NEUTRAL_AIR_BODY_REGIONS, DK_AERIAL_SPIN_ARM_REGIONS } from './donkeykongCollisionGeometry';
import { ContractFighter } from './contractFighter';
import { type CharacterTuning } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { AttackHitWindow } from './attacks';
import type { AerialMove } from './aerialSchema';
import type { ChargeSpecialMove } from './specialSchema';
import type { DashStrikeSideSpecialMove } from './sideSpecialSchema';
import type { MultiHitRisingUpSpecialMove } from './upSpecialSchema';
import type { ShockwaveDownSpecialMove } from './downSpecialSchema';
import type { GrabSpec } from './grabSchema';
import type { ThrowSpec, ThrowSet } from './throwSchema';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import type {
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
} from './movesetContract';
import { DONKEYKONG_MOVEMENT_PROFILE } from './fighterMovementProfiles';
import { DONKEYKONG_TAUNTS } from './donkeykongTaunts';
import { ULTIMATE_SMASH_MAX_HOLD_FRAMES } from './chargeSchema';
import { DONKEYKONG_PUNCH_CLOCKS } from './donkeykongPunchControls';
import { DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION } from './donkeykongLedgeRootMotion';

export { DONKEYKONG_MOVEMENT_PROFILE };
export { DONKEYKONG_TAUNTS };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement fields spread from `DONKEYKONG_MOVEMENT_PROFILE` (UFD stats);
 * the 60×84 px movement body stays inline because it is collision data.
 * 84 px ≈ 16.8 units, matching the script's head/up-smash heights.
 */
export const DONKEYKONG_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion' | 'referenceWeight' | 'referenceLaunch'>> & Pick<CharacterTuning, 'referenceWeight' | 'referenceLaunch'> = {
  ...DONKEYKONG_MOVEMENT_PROFILE,
  width: 60,
  height: 84,
  chamfer: 10,
};

/**
 * Jab 1 (Attack11): frames 5–6 of 24, 4 %. Two `top`-bone punches plus the
 * fist's own inward (fighter-only, 180°) / outward regions. Transitions to
 * jab 2 from frame 8 ("as early as frame 8").
 */
export const DONKEYKONG_JAB: AttackMoveWithAnimation = dkSourceMove({
  hitlagMultiplier: 1.5, sdiMultiplier: 1,
  id: 'donkeykong.jab',
  type: 'jab',
  damage: 4,
  knockback: { x: 1.22, y: -1.02, scaling: 0.054, reference: { base: 25, growth: 35, angle: 361 } },
  hitbox: { offsetX: 36.2, offsetY: -16.8, width: 82.5, height: 57.5 },
  collisionHits: [
    { id: 0, capsule: { start: { x: 25, y: -15.5 }, end: { x: 25, y: -15.5 }, radius: 30 } },
    { id: 1, capsule: { start: { x: 55, y: -10.5 }, end: { x: 55, y: -10.5 }, radius: 22.5 }, knockback: { x: 1.13, y: -0.95, scaling: 0.046, reference: { base: 20, growth: 30, angle: 361 } } },
    { id: 2, targetCategory: 'fighter', capsule: { start: { x: 60, y: -10 }, end: { x: 60, y: -10 }, radius: 22.5 }, knockback: { x: -1.41, y: 0, scaling: 0.031, reference: { base: 20, growth: 20, angle: 180 } } },
    { id: 3, targetCategory: 'all', capsule: { start: { x: 60, y: -10 }, end: { x: 60, y: -10 }, radius: 22.5 }, knockback: { x: 1.08, y: -0.91, scaling: 0.031, reference: { base: 20, growth: 20, angle: 361 } } },
  ],
  startupFrames: 4,
  activeFrames: 2,
  recoveryFrames: 18,
  cooldownFrames: 0,
  // Counts describe atlas phases; unequal source frameWindows own playback.
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 4 },
  jabChain: { nextId: 'donkeykong.jab2', advanceWindowStart: 7, continuationWindowEndFrame: 28 },
}, 'Attack11');

/** Jab 2 (Attack12): frames 4–6 of 31, 6 %, 70° uppercut. DK has no jab 3. */
export const DONKEYKONG_JAB2: AttackMoveWithAnimation = dkSourceMove({
  hitlagMultiplier: 1.8, sdiMultiplier: 1,
  id: 'donkeykong.jab2',
  type: 'jab',
  damage: 6,
  knockback: { x: 0.78, y: -2.13, scaling: 0.154, reference: { base: 40, growth: 100, angle: 70 } },
  hitbox: { offsetX: 32.5, offsetY: -18, width: 85, height: 80 },
  collisionHits: [
    { id: 0, capsule: { start: { x: 40, y: -18 }, end: { x: 40, y: -18 }, radius: 35 } },
    { id: 1, capsule: { start: { x: 35, y: -5.5 }, end: { x: 35, y: -5.5 }, radius: 27.5 } },
    { id: 2, capsule: { start: { x: 25, y: -33 }, end: { x: 25, y: -33 }, radius: 25 } },
  ],
  startupFrames: 3,
  activeFrames: 3,
  recoveryFrames: 25,
  cooldownFrames: 0,
  // Nine cells; explicit paired windows own unequal gameplay holds.
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 5 },
}, 'Attack12');

/**
 * Forward tilt (AttackS3): frames 7–9 of 34 (angled 35), 8 %. A long backhand chop along
 * the far arm (three `arml`/`shoulderl` regions). The angled variants
 * (AttackS3Hi / AttackS3Lw, 9 %) are selected with angled forward input.
 * Arm intangibility 6–9 is carried by the source protection windows.
 */
function angledForwardTilt(direction: 'up' | 'down'): AttackMoveWithAnimation {
  const motion = direction === 'up' ? 'AttackS3Hi' : 'AttackS3Lw';
  return dkSourceMove({
    // sheetVariant selects the dedicated tilt_up / tilt_down drawings (attackMoveToSheets).
    id: 'donkeykong.tilt', type: 'tilt', damage: 9, sheetVariant: direction,
    knockback: dkSourceKnockback(DK_NATIVE_ATTACKS[motion][0]),
    hitbox: { offsetX: 61.2, offsetY: direction === 'up' ? -30 : 15, width: 142.5, height: 56 },
    collisionHits: dkAngledTiltRegions(direction),
    // SmashWiki Forward tilt: angled versions last 1 frame longer ("FAF 35 → 36"; Angled
    // "Interruptible 36"), so 6 + 3 + 26 = 35. UFD lists one total (34) for all angles.
    startupFrames: 6, activeFrames: 3, recoveryFrames: 26, cooldownFrames: 0,
    animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 6 },
  }, motion);
}

export const DONKEYKONG_TILT: AttackMoveWithAnimation = dkSourceMove({
  angledVariants: { up: angledForwardTilt('up'), down: angledForwardTilt('down') },
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.tilt',
  type: 'tilt',
  damage: 8,
  knockback: { x: 1.75, y: -1.47, scaling: 0.12, reference: { base: 50, growth: 78, angle: 361 } },
  hitbox: { offsetX: 61.2, offsetY: -12, width: 142.5, height: 56 },
  collisionHits: DK_FORWARD_TILT_REGIONS,
  startupFrames: 6,
  activeFrames: 3,
  recoveryFrames: 25,
  cooldownFrames: 0,
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 6 },
}, 'AttackS3');

/**
 * One single-frame window per gameplay age with the source regions posed on
 * the native skeleton (bone matrix × script offset at native sample age + 1;
 * `tools/native-hit-positions.py --fighter dk`, which reproduces the sourced dtilt
 * collision poses exactly). Radii and all hit values come from the script
 * rows via dkSourceHits; points are listed in source id order.
 */
function nativePosedWindows(group: string,
  ages: readonly (readonly [number, readonly (readonly [number, number])[]])[]): AttackHitWindow[] {
  return ages.map(([age, points]) => ({ startFrame: age, endFrame: age + 1, group,
    collisionHits: points.map(([x, y], id) => ({ id, capsule: { start: { x, y }, end: { x, y }, radius: 0 } })) }));
}

/**
 * Up tilt (AttackHi3): frames 5–11 of 38. Overhead windmill along the near
 * arm: shoulder 8 % / arm 9 % / hand 10 %, all 100° with position-based
 * launch. Lowest id wins where regions overlap (shoulder over hand). The arm
 * sweeps front-low (frame 5, reaching a grounded adjacent opponent) over the
 * head to behind (frame 11); each frame carries its native posed region.
 */
export const DONKEYKONG_UTILT: AttackMoveWithAnimation = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.utilt',
  type: 'tilt',
  damage: 10,
  launchAwayFromSource: true,
  knockback: { x: -0.41, y: -2.33, scaling: 0.177, reference: { base: 40, growth: 115, angle: 100 } },
  hitbox: { offsetX: 6, offsetY: -54, width: 132, height: 128 },
  // [shoulderr, armr, handr] per age (ids 0–2), native samples 5–11.
  hitWindows: nativePosedWindows('swing', [
    [4, [[-13.1, -37.8], [31.2, -41.8], [58.4, -36.3]]],
    [5, [[-15.7, -50.4], [24.7, -66.7], [52.7, -68.9]]],
    [6, [[-14.6, -54.4], [15.4, -82.6], [35.1, -95.2]]],
    [7, [[-28, -56.3], [-29.4, -89], [-23.3, -104.9]]],
    [8, [[-44.9, -39.1], [-79.1, -39.1], [-92.8, -45.9]]],
    [9, [[-49.7, -17.2], [-72.8, 6.2], [-88.2, 12.4]]],
    [10, [[-51.1, 3.2], [-65.2, 24.6], [-79.4, 33.4]]],
  ]),
  startupFrames: 4,
  activeFrames: 7,
  recoveryFrames: 27,
  cooldownFrames: 0,
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 7 },
}, 'AttackHi3');

/**
 * Down tilt (AttackLw3): frames 6–7 of 24, 6 %, Sakurai angle with +5
 * reaction frames (`set_add_reaction_frame 5`). Low arm sweep along the
 * ground; source arm/shoulder intangibility 5–7 uses regional protection.
 */
export const DONKEYKONG_DTILT: AttackMoveWithAnimation = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.dtilt',
  type: 'tilt',
  damage: 6,
  launchAwayFromSource: true,
  knockback: { x: 1.27, y: -1.06, scaling: 0.123, reference: { base: 10, growth: 80, angle: 361, additionalHitstunFrames: 5 } },
  hitbox: { offsetX: 50.2, offsetY: 30.5, width: 124.5, height: 55 },
  collisionHits: [
    { id: 0, capsule: { start: { x: 10, y: 30 }, end: { x: 10, y: 30 }, radius: 22 } },
    { id: 1, capsule: { start: { x: 45, y: 30 }, end: { x: 45, y: 30 }, radius: 22 } },
    { id: 2, capsule: { start: { x: 85, y: 30 }, end: { x: 85, y: 30 }, radius: 27.5 } },
  ],
  startupFrames: 5,
  activeFrames: 2,
  recoveryFrames: 17,
  cooldownFrames: 0,
  // Protected startup, two contact samples and four recovery cells.
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 4 },
}, 'AttackLw3');

/**
 * Dash attack (AttackDash): a forward roll. Early 9–12: 12 %, 53°, BKB 85 /
 * KBG 46 on a `top` sphere (z 8, y 8, r 7). Late 13–24: 9 %, 45°, BKB 60 /
 * KBG 60 (z 5.2, r 5.5). Total 34, hitlag ×1.25. Body travel is the run
 * momentum the engine carries into the move.
 */
export const DONKEYKONG_DASHATTACK: AttackMoveWithAnimation = dkSourceMove({
  hitlagMultiplier: 1.25, sdiMultiplier: 1,
  id: 'donkeykong.dashAttack',
  type: 'tilt',
  damage: 12,
  knockback: { x: 1.58, y: -2.1, scaling: 0.071, reference: { base: 85, growth: 46, angle: 53 } },
  hitbox: { offsetX: 40, offsetY: 2, width: 70, height: 70 },
  startupFrames: 8,
  activeFrames: 16,
  recoveryFrames: 10,
  cooldownFrames: 0,
  hitWindows: [
    { startFrame: 8, endFrame: 12, group: 'roll', damage: 12 },
    { startFrame: 12, endFrame: 24, group: 'roll', damage: 9,
      knockback: { x: 1.64, y: -1.64, scaling: 0.092, reference: { base: 60, growth: 60, angle: 45 } },
      hitbox: { offsetX: 26, offsetY: 2, width: 55, height: 55 } },
  ],
  animation: { startupFrames: 2, activeFrames: 4, recoveryFrames: 6 },
}, 'AttackDash');

/**
 * Forward smash (AttackS4): a giant two-handed clap. Charge hold frame 14;
 * active 22–23 of 54; hitlag ×1.4; cannot rebound. Far sphere (z 24, r 5.7):
 * 22 %, 46°, BKB 21 / KBG 88. Close capsule (z 18→10, r 3.7): 21 %, Sakurai
 * angle, BKB 18 / KBG 86. Head/arm intangibility 20–26 is source-authored.
 */
export const DONKEYKONG_SMASH: AttackMoveWithAnimation = dkSourceMove({
  hitlagMultiplier: 1.4, sdiMultiplier: 1,
  chargeStartFrame: 13,
  id: 'donkeykong.smash',
  type: 'smash',
  damage: 22,
  knockback: { x: 1.31, y: -1.35, scaling: 0.135, reference: { base: 21, growth: 88, angle: 46 } },
  charge: {
    knockbackMode: 'damage-only',
    minChargeFrames: 0,
    maxChargeFrames: 60,
    maxHoldFrames: ULTIMATE_SMASH_MAX_HOLD_FRAMES,
    minDamage: 22,
    maxDamage: 30.8,
    minKnockback: { x: 4.4, y: -1.5, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 6.16, y: -2.1, scaling: 0.52, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 90, offsetY: 10, width: 117, height: 57 },
  collisionHits: [
    { id: 0, capsule: { start: { x: 120, y: 10 }, end: { x: 120, y: 10 }, radius: 28.5 }, damage: 22 },
    { id: 1, capsule: { start: { x: 90, y: 10 }, end: { x: 50, y: 10 }, radius: 18.5 }, damage: 21, knockback: { x: 1.4, y: -1.17, scaling: 0.132, reference: { base: 18, growth: 86, angle: 361 } } },
  ],
  startupFrames: 21,
  activeFrames: 2,
  recoveryFrames: 31,
  cooldownFrames: 0,
  animation: { startupFrames: 4, activeFrames: 1, recoveryFrames: 7 },
}, 'AttackS4');

/**
 * Up smash (AttackHi4): overhead clap. Charge hold frame 6; active 14–15 of
 * 49; 19 %, 90°, BKB 40 / KBG 84, position-based launch; cannot rebound.
 * Sphere at y 28 (r 8.8) over a capsule at y 18 (z 5 → −5, r 7).
 */
export const DONKEYKONG_USMASH: AttackMoveWithAnimation = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  chargeStartFrame: 5,
  id: 'donkeykong.usmash',
  type: 'smash',
  damage: 19,
  launchAwayFromSource: true,
  knockback: { x: 0, y: -2.16, scaling: 0.129, reference: { base: 40, growth: 84, angle: 90 } },
  charge: {
    knockbackMode: 'damage-only',
    minChargeFrames: 0,
    maxChargeFrames: 60,
    maxHoldFrames: ULTIMATE_SMASH_MAX_HOLD_FRAMES,
    minDamage: 19,
    maxDamage: 26.6,
    minKnockback: { x: 0.3, y: -3.9, scaling: 0.44, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -5.46, scaling: 0.55, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 0, offsetY: -77.5, width: 88, height: 129 },
  collisionHits: [
    { id: 0, capsule: { start: { x: 0, y: -98 }, end: { x: 0, y: -98 }, radius: 44 } },
    { id: 1, capsule: { start: { x: 25, y: -48 }, end: { x: -25, y: -48 }, radius: 35 } },
  ],
  startupFrames: 13,
  activeFrames: 2,
  recoveryFrames: 34,
  cooldownFrames: 0,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 8 },
}, 'AttackHi4');

/**
 * Down smash (AttackLw4): both palms slam the ground on both sides. Charge
 * hold frame 2; active 11–14 of 55; cannot rebound. Frames 11–12: fists
 * (17 %, 70°, BKB 35 / KBG 88) and shoulders (14 %, 82°). Frames 13–14: `top`
 * spheres at z 19 and z −12 (18 %, 55°, BKB 30 / KBG 88) and shoulders
 * (14 %, 98°). Arm intangibility 11–14 is source-authored.
 */
export const DONKEYKONG_DSMASH: AttackMoveWithAnimation = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  chargeStartFrame: 1,
  id: 'donkeykong.dsmash',
  type: 'smash',
  damage: 17,
  launchAwayFromSource: true,
  knockback: { x: 0.72, y: -1.98, scaling: 0.135, reference: { base: 35, growth: 88, angle: 70 } },
  charge: {
    knockbackMode: 'damage-only',
    minChargeFrames: 0,
    maxChargeFrames: 60,
    maxHoldFrames: ULTIMATE_SMASH_MAX_HOLD_FRAMES,
    minDamage: 17,
    maxDamage: 23.8,
    minKnockback: { x: 4.4, y: -1.0, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 6.16, y: -1.4, scaling: 0.52, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 17.5, offsetY: 0, width: 215, height: 100 },
  startupFrames: 10,
  activeFrames: 4,
  recoveryFrames: 41,
  cooldownFrames: 0,
  // Frames 11–12 [armr, arml, shoulderr, shoulderl]; 13–14 [top z19, top
  // z−12, shoulderr, shoulderl] (ids 0–3), native samples 11–14. The fists are
  // the elbows slammed at floor level on both sides; the shoulders sit on the
  // body, so a shoulder wins alone only over DK (or inside his body box).
  hitWindows: nativePosedWindows('swing', [
    [10, [[-53.7, 27.5], [84.6, 29], [-21.6, -2], [48.1, 1.7]]],
    [11, [[-53.6, 27.5], [85.4, 31.3], [-21.5, 2.3], [47.3, 8.6]]],
    [12, [[95, 19.5], [-60, 19.5], [-22, 0.5], [47.6, 7.9]]],
    [13, [[95, 19.5], [-60, 19.5], [-21.4, -3.7], [48.7, 6.3]]],
  ]),
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 8 },
}, 'AttackLw4');

/**
 * Neutral air (AttackAirN): a spinning double-arm swipe. Early 10–13: 12 %,
 * Sakurai angle, BKB 20 / KBG 100 on both arms, the hip and (frame 10 only)
 * a forward `top` sphere at z 15. Late 14–26: 9 %, BKB 10 / KBG 100. Total
 * 38, landing lag 10, autocancel 1–9 and 27+. Position-based launch.
 */
export const DONKEYKONG_NAIR: AerialMove = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 12,
  launchAwayFromSource: true,
  knockback: { x: 1.49, y: -1.25, scaling: 0.154, reference: { base: 20, growth: 100, angle: 361 } },
  hitbox: { offsetX: 27.5, offsetY: 4, width: 145, height: 72 },
  startupFrames: 9,
  activeFrames: 17,
  recoveryFrames: 12,
  cooldownFrames: 0,
  hitWindows: [
    { startFrame: 9, endFrame: 10, group: 'swing', damage: 12,
      collisionHits: [
        ...DK_NEUTRAL_AIR_BODY_REGIONS,
        { id: 3, capsule: { start: { x: 75, y: 2 }, end: { x: 75, y: 2 }, radius: 25 } },
      ] },
    { startFrame: 10, endFrame: 13, group: 'swing', damage: 12,
      collisionHits: DK_NEUTRAL_AIR_BODY_REGIONS },
    { startFrame: 13, endFrame: 26, group: 'swing', damage: 9,
      knockback: { x: 1.37, y: -1.15, scaling: 0.154, reference: { base: 10, growth: 100, angle: 361 } },
      hitbox: { offsetX: 10, offsetY: 4, width: 110, height: 72 },
      collisionHits: [
        ...DK_NEUTRAL_AIR_BODY_REGIONS,
      ] },
  ],
  animation: { startupFrames: 2, activeFrames: 4, recoveryFrames: 3 },
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 9 }, { startFrame: 26, endFrame: 38 }],
}, 'AttackAirN');

/**
 * Forward air (AttackAirF): a two-fisted overhead hammer. Early 18–20: 16 %,
 * Sakurai angle, BKB 20 / KBG 85. Late 21–23: the fist (id 0) is a 15 %
 * meteor (270°, BKB 30 / KBG 100, hitlag ×1.5) and the arms (id 1) 13 %
 * Sakurai. Total 55, landing lag 17; autocancels only from frame 56, i.e.
 * never inside the move.
 */
export const DONKEYKONG_FAIR: AerialMove = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 16,
  knockback: { x: 1.41, y: -1.19, scaling: 0.131, reference: { base: 20, growth: 85, angle: 361 } },
  hitbox: { offsetX: 36.2, offsetY: 2.2, width: 112.5, height: 100.5 },
  startupFrames: 17,
  activeFrames: 6,
  recoveryFrames: 32,
  cooldownFrames: 0,
  hitWindows: [
    { startFrame: 17, endFrame: 20, group: 'swing', damage: 16,
      collisionHits: [
        { id: 0, capsule: { start: { x: 20, y: -20 }, end: { x: 65, y: 10 }, radius: 27.5 } },
        { id: 1, capsule: { start: { x: 35, y: -15 }, end: { x: 35, y: -15 }, radius: 22.5 } },
      ] },
    { startFrame: 20, endFrame: 23, group: 'swing', damage: 15, hitlagMultiplier: 1.5,
      knockback: { x: 0, y: 2.11, scaling: 0.154, reference: { base: 30, growth: 100, angle: 270 } },
      collisionHits: [
        { id: 0, capsule: { start: { x: 55, y: 25 }, end: { x: 55, y: 25 }, radius: 27.5 }, damage: 15 },
        { id: 1, capsule: { start: { x: 30, y: 0 }, end: { x: 30, y: 0 }, radius: 25 }, damage: 13, knockback: { x: 1.61, y: -1.35, scaling: 0.154, reference: { base: 30, growth: 100, angle: 361 } } },
      ] },
  ],
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 8 },
  landingLagFrames: 17,
  // UFD: autocancels from frame 56 onward only, i.e. never inside the move.
  autoCancelWindows: [],
}, 'AttackAirF');

/**
 * Back air (AttackAirB): a rearward kick (`LR_B` — back-aerial dispatch
 * reverses the attack axis, so the geometry is authored forward). Early 7–8:
 * 13 %, Sakurai angle, BKB 20 / KBG 97 (foot r 7, knee/hip r 5). Late 9–16:
 * 8 %, BKB 10 / KBG 100. Total 31, landing lag 11, autocancel 1–6 and 31+.
 */
export const DONKEYKONG_BAIR: AerialMove = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 13,
  knockback: { x: 1.48, y: -1.24, scaling: 0.149, reference: { base: 20, growth: 97, angle: 361 } },
  hitbox: { offsetX: 35, offsetY: 5, width: 120, height: 70 },
  startupFrames: 6,
  activeFrames: 10,
  recoveryFrames: 15,
  cooldownFrames: 0,
  hitWindows: [
    { startFrame: 6, endFrame: 8, group: 'swing', damage: 13,
      collisionHits: [
        { id: 0, capsule: { start: { x: 60, y: 5 }, end: { x: 60, y: 5 }, radius: 35 } },
        { id: 1, capsule: { start: { x: 30, y: 0 }, end: { x: 30, y: 0 }, radius: 25 } },
        { id: 2, capsule: { start: { x: 0, y: 5 }, end: { x: 0, y: 5 }, radius: 25 } },
      ] },
    { startFrame: 8, endFrame: 16, group: 'swing', damage: 8,
      knockback: { x: 1.37, y: -1.15, scaling: 0.154, reference: { base: 10, growth: 100, angle: 361 } },
      collisionHits: [
        { id: 0, capsule: { start: { x: 60, y: 5 }, end: { x: 60, y: 5 }, radius: 30 } },
        { id: 1, capsule: { start: { x: 30, y: 0 }, end: { x: 30, y: 0 }, radius: 20 } },
        { id: 2, capsule: { start: { x: 0, y: 5 }, end: { x: 0, y: 5 }, radius: 20 } },
      ] },
  ],
  animation: { startupFrames: 1, activeFrames: 4, recoveryFrames: 6 },
  landingLagFrames: 11,
  autoCancelWindows: [{ startFrame: 0, endFrame: 6 }, { startFrame: 30, endFrame: 31 }],
}, 'AttackAirB');

/**
 * Up air (AttackAirHi): an upward headbutt. Frames 6–10 of 37: 13 %, 90°,
 * BKB 32 / KBG 90 on the head (r 7.5), position-based launch. Landing lag
 * 15, autocancel 1–5 and 26+. Head intangibility 5–10 is source-authored.
 */
export const DONKEYKONG_UAIR: AerialMove = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 13,
  launchAwayFromSource: true,
  knockback: { x: 0, y: -2.07, scaling: 0.138, reference: { base: 32, growth: 90, angle: 90 } },
  hitbox: { offsetX: 15, offsetY: -33, width: 75, height: 75 },
  collisionHits: [{ id: 0, capsule: { start: { x: 15, y: -33 }, end: { x: 15, y: -33 }, radius: 37.5 } }],
  startupFrames: 5,
  activeFrames: 5,
  recoveryFrames: 27,
  cooldownFrames: 0,
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 8 },
  landingLagFrames: 15,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }, { startFrame: 25, endFrame: 37 }],
}, 'AttackAirHi');

/**
 * Down air (AttackAirLw): a double-foot stomp. Frames 14–16 of 54. Feet
 * (`top` y −5, r 7): 16 % meteor, 270°, BKB 30 / KBG 90. Body (y 6, r 5.8):
 * 13 %, Sakurai, BKB 20 / KBG 90. Position-based launch; landing lag 14;
 * autocancel 1–2 and 50+. The grounded response to the meteor is the
 * engine's generic reflection (no separate script record).
 */
export const DONKEYKONG_DAIR: AerialMove = dkSourceMove({
  hitlagMultiplier: 1, sdiMultiplier: 1,
  id: 'donkeykong.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 16,
  launchAwayFromSource: true,
  knockback: { x: 0, y: 2.04, scaling: 0.138, reference: { base: 30, growth: 90, angle: 270 } },
  hitbox: { offsetX: 2.5, offsetY: 42.5, width: 75, height: 119 },
  collisionHits: [
    { id: 0, capsule: { start: { x: 5, y: 67 }, end: { x: 5, y: 67 }, radius: 35 }, damage: 16 },
    { id: 1, capsule: { start: { x: 0, y: 12 }, end: { x: 0, y: 12 }, radius: 29 }, damage: 13, knockback: { x: 1.44, y: -1.21, scaling: 0.138, reference: { base: 20, growth: 90, angle: 361 } } },
  ],
  startupFrames: 13,
  activeFrames: 3,
  recoveryFrames: 38,
  cooldownFrames: 0,
  animation: { startupFrames: 3, activeFrames: 2, recoveryFrames: 7 },
  landingLagFrames: 14,
  autoCancelWindows: [{ startFrame: 0, endFrame: 2 }, { startFrame: 49, endFrame: 54 }],
}, 'AttackAirLw');

/**
 * Giant Punch (SpecialN / SpecialNMax) — `charge` kind. Ultimate winds the
 * punch on a press and keeps the charge when cancelled with shield. Its
 * DK-only press/wind/fire opt-in declares continued winding after button
 * release, second-press firing and partial-bank resume; actual keyboard
 * acceptance remains separate. Full charge takes SmashWiki's 110 frames (UFD 111).
 * Release: active 19–20 after the charge state; uncharged 10 % (Sakurai,
 * BKB 45 / KBG 70), with integer power additions up to 27 %, or a full 28 % (BKB 35 / KBG 73). Full charge selects its separate launch record. Endlag 42 (uncharged);
 * full charge uses its native 27-frame endlag. Super armour on
 * frames 9–20 only at full charge (`minChargeRatio: 1`). Arm intangibility
 * 4–20 and the aerial 6 % / 25 % records are selected at release.
 */
/** SmashWiki Neutral special, not fully charged: "Interruptible (from release) 70 (63)"
 * with the hitbox at 19–20 from release, so 63 − 1 − 20 = 42 frames of lag after it
 * (strip: Lag 42). UFD lists 35; native special_n cancel_frame 63 agrees with SmashWiki. */
const GIANT_PUNCH_UNCHARGED_ENDLAG = 42;

function giantPunchFull(airborne: boolean): AttackMoveWithAnimation {
  const motion = airborne ? 'SpecialAirNMax' : 'SpecialNMax';
  return dkSourceMove({
    id: 'donkeykong.neutral_special', type: 'special', damage: airborne ? 25 : 28,
    knockback: dkSourceKnockback(DK_NATIVE_ATTACKS[motion][0]),
    hitbox: { offsetX: 51.2, offsetY: -12, width: 132.5, height: 56 },
    collisionHits: [
      { id: 0, capsule: { start: { x: 60, y: -12 }, end: { x: 90, y: -12 }, radius: 27.5 } },
      { id: 1, capsule: { start: { x: 25, y: -12 }, end: { x: 25, y: -12 }, radius: 20 } },
      { id: 2, capsule: { start: { x: 0, y: -15 }, end: { x: 0, y: -15 }, radius: 15 } },
      { id: 3, capsule: { start: { x: -5, y: 10 }, end: { x: -5, y: 10 }, radius: 15 } },
    ],
    startupFrames: 18, activeFrames: 2, recoveryFrames: 27, cooldownFrames: 0,
    armorWindows: [{ startFrame: airborne ? 14 : 8, endFrame: 20 }],
    animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 8 },
  }, motion);
}

function giantPunchAir(): AttackMoveWithAnimation {
  return dkSourceMove({
    id: 'donkeykong.neutral_special', type: 'special', damage: 6,
    knockback: dkSourceKnockback(DK_NATIVE_ATTACKS.SpecialAirN[0]),
    hitbox: { offsetX: 51.2, offsetY: -12, width: 132.5, height: 56 },
    collisionHits: [
      { id: 0, capsule: { start: { x: 60, y: -12 }, end: { x: 90, y: -12 }, radius: 27.5 } },
      { id: 1, capsule: { start: { x: 25, y: -12 }, end: { x: 25, y: -12 }, radius: 20 } },
      { id: 2, capsule: { start: { x: 0, y: -15 }, end: { x: 0, y: -15 }, radius: 15 } },
    ],
    startupFrames: 18, activeFrames: 2, recoveryFrames: GIANT_PUNCH_UNCHARGED_ENDLAG, cooldownFrames: 0,
    animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 8 },
    fullChargeVariant: giantPunchFull(true),
    charge: { inputBehavior: 'press-wind-fire', knockbackMode: 'damage-only', minChargeFrames: 0,
      maxChargeFrames: DONKEYKONG_PUNCH_CLOCKS.maxChargeFrames,
      minDamage: 6, maxDamage: 25, partialMaxDamage: 23, damageStep: 1,
      fullChargeKnockback: dkSourceKnockback(DK_NATIVE_ATTACKS.SpecialAirNMax[0]),
      minKnockback: { x: 1, y: -1, scaling: 0 }, maxKnockback: { x: 1, y: -1, scaling: 0 } },
  }, 'SpecialAirN');
}

export const DONKEYKONG_NEUTRAL_SPECIAL: ChargeSpecialMove = dkSourceMove({
  airborneVariant: giantPunchAir(),
  fullChargeVariant: giantPunchFull(false),
  id: 'donkeykong.neutral_special',
  type: 'special',
  specialKind: 'charge',
  damage: 10,
  knockback: { x: 1.64, y: -1.38, scaling: 0.108, reference: { base: 45, growth: 70, angle: 361 } },
  hitlagMultiplier: 1,
  sdiMultiplier: 1,
  hitbox: { offsetX: 51.2, offsetY: -12, width: 132.5, height: 56 },
  collisionHits: [
    { id: 0, capsule: { start: { x: 60, y: -12 }, end: { x: 90, y: -12 }, radius: 27.5 } },
    { id: 1, capsule: { start: { x: 25, y: -12 }, end: { x: 25, y: -12 }, radius: 20 } },
    { id: 2, capsule: { start: { x: 0, y: -15 }, end: { x: 0, y: -15 }, radius: 15 } },
  ],
  startupFrames: 18,
  activeFrames: 2,
  recoveryFrames: GIANT_PUNCH_UNCHARGED_ENDLAG,
  cooldownFrames: 0,
  armorWindows: [{ startFrame: 8, endFrame: 20, minChargeRatio: 1 }],
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 8 },
  charge: {
    inputBehavior: 'press-wind-fire',
    // SpecialNMax switches launch records only when the charge is complete.
    entryFrames: 7, cancelFrames: 4, airCharge: true,
    knockbackMode: 'damage-only',
    fullChargeKnockback: { x: 1.49, y: -1.25, scaling: 0.112, reference: { base: 35, growth: 73, angle: 361 } },
    minChargeFrames: 0,
    maxChargeFrames: DONKEYKONG_PUNCH_CLOCKS.maxChargeFrames,
    minDamage: 10,
    maxDamage: 28,
    partialMaxDamage: 27,
    damageStep: 1,
    minKnockback: { x: 4.6, y: -1.5, scaling: 0.36 },
    maxKnockback: { x: 6.2, y: -2.0, scaling: 0.5 },
  },
}, 'SpecialN');

/**
 * Headbutt (SpecialS) — modelled as a `dashStrike` with a minimal forward
 * velocity/gravity profile. Frames 20–21 of 62, super armour 5–14. Grounded
 * targets: 10 %, 270°, BKB 40 / KBG 40 with the source's bury attribute.
 * Airborne targets: 8 %, 70°,
 * BKB 15 / KBG 40 on a large head sphere (r 10). Shield damage 25 and the
 * aerial source regions are selected at entry.
 */
const DONKEYKONG_HEADBUTT_AIR: AttackMoveWithAnimation = dkSourceMove({
  entryVelocityScale: { xGround: 0.5, xAir: 0.67, yGround: 0, yAir: 0.5 },
  gravityScale: 0.5,
  id: 'donkeykong.side_special', type: 'sideSpecial', damage: 10,
  knockback: dkSourceKnockback(DK_NATIVE_ATTACKS.SpecialAirS[0]),
  hitbox: { offsetX: 65, offsetY: -10.5, width: 110, height: 105 },
  startupFrames: 19, activeFrames: 2, recoveryFrames: 41, cooldownFrames: 0,
  armorWindows: [{ startFrame: 4, endFrame: 14 }],
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 8 },
}, 'SpecialAirS');

export const DONKEYKONG_SIDE_SPECIAL: DashStrikeSideSpecialMove = dkSourceMove({
  entryVelocityScale: { xGround: 0.5, xAir: 0.67, yGround: 0, yAir: 0.5 },
  gravityScale: 0.5,
  airborneVariant: DONKEYKONG_HEADBUTT_AIR,
  id: 'donkeykong.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 10,
  knockback: { x: 0, y: 1.87, scaling: 0.062, reference: { base: 40, growth: 40, angle: 270 } },
  hitlagMultiplier: 1,
  sdiMultiplier: 1,
  launchAwayFromSource: true,
  hitbox: { offsetX: 65, offsetY: -10.5, width: 110, height: 105 },
  collisionHits: [
    { id: 0, situation: 'ground', capsule: { start: { x: 95, y: 17 }, end: { x: 35, y: 17 }, radius: 25 } },
    { id: 1, situation: 'ground', capsule: { start: { x: 90, y: -23 }, end: { x: 45, y: -23 }, radius: 15 } },
    { id: 2, situation: 'air', capsule: { start: { x: 70, y: -13 }, end: { x: 70, y: -13 }, radius: 50 }, damage: 8, knockback: { x: 0.5, y: -1.38, scaling: 0.062, reference: { base: 15, growth: 40, angle: 70 } } },
  ],
  startupFrames: 19,
  activeFrames: 2,
  recoveryFrames: 41,
  cooldownFrames: 0,
  armorWindows: [{ startFrame: 4, endFrame: 14 }],
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 8 },
  dashStrike: {
    dashSpeed: 0, // Motion is owned by the sourced entry/gravity profile.
    dashFrames: 0,
    helplessAfterDash: false,
  },
}, 'SpecialS');

/**
 * Spinning Kong (SpecialAirHi / SpecialHi) — `multiHitRising`.
 *
 * Aerial: first hit 4–6 (5 %, 85°, BKB 50 / KBG 10), twelve 1 % autolink
 * rungs 10–38 (angle 367 contextual pull, BKB 55 / KBG 20), a
 * 2 % finisher 39–43 (Sakurai, BKB 72 / KBG 80). Landing lag 38. Ultimate's
 * aerial spin resets upward speed and reduces gravity while allowing drift.
 * Motion parameters use supplemental research at the project's 5 px scale;
 * they are not supplied by UFD. Reduced gravity ends after game frame 43.
 * Arm intangibility uses UFD-selected 10–38. SmashWiki Aerial timing: "Animation
 * length 70", final hit 39–43 then Lag 27 before helplessness (3 + 40 + 27).
 *
 * Grounded: super armour 5–17; first hit 19 (5 %, fixed KB 90 / KBG 30 at 95°), 1.4 %
 * rungs at 25–27 / 32–33 / 40–42 / 49–50 / 55–58 (fixed KB 80/90, autolink
 * 367 with calibrated airborne pull and grounded 80°; inner rungs use
 * 20° / fixed KB 65 / KBG 100;
 * rear 3.5 % hits launch backward at 60°), finisher 62 (4 %,
 * Sakurai, BKB 60 / KBG 157, hitlag ×2). Total 104, endlag 42.
 * Rung damage 1.4 follows the pinned SpecialHi script and SmashWiki
 * (SSBU up-special hitbox table; "loop hits 1.3% → 1.4%" in the SSB4→SSBU
 * changes); UFD's 1.3 is the stale SSB4 value.
 * Fixed launch records retain target weight, as in the captured source;
 * fixed knockback does not imply the separate set-weight flag.
 */
export const DONKEYKONG_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  protectionWindows: DK_PROTECTION_WINDOWS.SpecialAirHi,
  id: 'donkeykong.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  damage: 5,
  knockback: { x: 0.16, y: -1.82, scaling: 0.015, reference: { base: 50, growth: 10, angle: 85 } },
  hitbox: { offsetX: 0, offsetY: -25, width: 90, height: 100 },
  startupFrames: 3,
  activeFrames: 40,
  recoveryFrames: 27,
  cooldownFrames: 0,
  specialLandingLagFrames: 38,
  // SmashWiki (SSBU up-special parameters): "If Donkey Kong lands from the aerial version
  // before undergoing helplessness, he transitions to frame 63 of the grounded version"
  // (SpecialAirHi sets FLAG_GROUND_MOT_FRAME on frame 0). Frame 63 is elapsed 62; the
  // SpecialHi tail then runs to its cancel frame 105 (42 frames). The 38-frame
  // landing_fall_special lag applies only after special fall.
  groundedLandingFrame: 62,
  animation: { startupFrames: 1, activeFrames: 7, recoveryFrames: 4 },
  multiHitRising: {
    riseImpulse: -4.5,
    driftImpulse: 0, // Flight profile preserves entry momentum instead.
    sustainedRise: { gravityFrames: 43, gravity: 0.02975, airAcceleration: 0.25, maxAirSpeed: 8.5 },
    collisionHitsPerHit: [dkSourceHits('SpecialAirHi', 4),
      ...Array.from({ length: 12 }, () => dkSourceHits('SpecialAirHi', 12, DK_AERIAL_SPIN_ARM_REGIONS)),
      dkSourceHits('SpecialAirHi', 60, DK_AERIAL_SPIN_ARM_REGIONS)],
    hitCount: 14,
    hitInterval: 3,
    hitFrames: [0, 6, 9, 11, 14, 16, 18, 21, 23, 26, 28, 30, 33, 35],
    activeFramesPerHit: [3, 3, 2, 3, 2, 2, 3, 2, 3, 2, 2, 3, 2, 5],
    damagePerHit: [5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
    hitlagMultiplierPerHit: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    sdiMultiplierPerHit: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    knockbackPerHit: [
      { x: 0.16, y: -1.82, scaling: 0.015, reference: { base: 50, growth: 10, angle: 85 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
      { x: 2.03, y: -1.7, scaling: 0.123, reference: { base: 72, growth: 80, angle: 361 } },
    ],
    linkDamage: 1,
    linkKnockback: { x: 0.34, y: -1.94, scaling: 0.031, reference: { base: 55, growth: 20, angle: 367 } },
    launcherDamage: 2,
    launcherKnockback: { x: 2.03, y: -1.7, scaling: 0.123, reference: { base: 72, growth: 80, angle: 361 } },
  },
  groundedVariant: dkSourceMove({
    groundedMotion: { acceleration: 0.17, friction: 0.075, maxSpeed: 5.5,
      postHitFriction: 0.2, postHitFrame: 62 },
    id: 'donkeykong.up_special', type: 'upSpecial', damage: 5,
    // Hit 1: SmashWiki Up_special Grounded Hit 1 ids 0–5 "bk=0 ks=30 fkv=90" (see
    // DK_SOURCE_KNOCKBACK_OVERRIDES; the native parse reads kbg 90 / fkb 30).
    knockback: { x: -0.1, y: -1.1, scaling: 0.02, reference: { base: 0, growth: 30, angle: 95, fixed: 90 } },
    hitlagMultiplier: 1,
    sdiMultiplier: 1,
    launchAwayFromSource: true,
    hitbox: { offsetX: 50, offsetY: -25, width: 200, height: 100 },
    startupFrames: 18, activeFrames: 44, recoveryFrames: 42, cooldownFrames: 0,
    armorWindows: [{ startFrame: 4, endFrame: 17 }],
    hitWindows: [
      { startFrame: 18, endFrame: 19, group: 'first', damage: 5,
        collisionHits: [{ id: 0, capsule: { start: { x: 40, y: -10 }, end: { x: 40, y: -10 }, radius: 30 } }, { id: 1, capsule: { start: { x: 10, y: -10 }, end: { x: 10, y: -10 }, radius: 25 }, knockback: { x: 0.19, y: -1.08, scaling: 0.02, reference: { base: 0, growth: 30, angle: 80, fixed: 90 } } },
          { id: 2, capsule: { start: { x: 0, y: -15 }, end: { x: 0, y: -15 }, radius: 20 } }] },
      { startFrame: 24, endFrame: 27, group: 'rung1', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: { x: 0.36, y: -2.07, scaling: 0.02, reference: { base: 0, growth: 55, angle: 367, fixed: 90 } },
        collisionHits: [{ id: 0, capsule: { start: { x: 125, y: 7 }, end: { x: 125, y: -18 }, radius: 20 } }, { id: 1, capsule: { start: { x: 62.5, y: -18 }, end: { x: 62.5, y: -18 }, radius: 25 }, knockback: { x: 1.58, y: -0.58, scaling: 0.02, reference: { base: 0, growth: 100, angle: 20, fixed: 65 } } }] },
      { startFrame: 31, endFrame: 33, group: 'rung2', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: { x: 0.34, y: -1.9, scaling: 0.02, reference: { base: 0, growth: 55, angle: 367, fixed: 80 } },
        collisionHits: [{ id: 0, capsule: { start: { x: 125, y: 7 }, end: { x: 125, y: -18 }, radius: 20 } }, { id: 1, capsule: { start: { x: 62.5, y: -18 }, end: { x: 62.5, y: -18 }, radius: 25 }, knockback: { x: 1.58, y: -0.58, scaling: 0.02, reference: { base: 0, growth: 100, angle: 20, fixed: 65 } } }] },
      { startFrame: 39, endFrame: 42, group: 'rung3', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: { x: 0.36, y: -2.07, scaling: 0.02, reference: { base: 0, growth: 55, angle: 367, fixed: 90 } },
        collisionHits: [{ id: 0, capsule: { start: { x: 125, y: 7 }, end: { x: 125, y: -18 }, radius: 20 } }, { id: 1, capsule: { start: { x: 62.5, y: -18 }, end: { x: 62.5, y: -18 }, radius: 25 }, knockback: { x: 1.58, y: -0.58, scaling: 0.02, reference: { base: 0, growth: 100, angle: 20, fixed: 65 } } }] },
      { startFrame: 48, endFrame: 50, group: 'rung4', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: { x: 0.36, y: -2.07, scaling: 0.02, reference: { base: 0, growth: 55, angle: 367, fixed: 90 } },
        collisionHits: [{ id: 0, capsule: { start: { x: 125, y: 7 }, end: { x: 125, y: -18 }, radius: 20 } }, { id: 1, capsule: { start: { x: 62.5, y: -18 }, end: { x: 62.5, y: -18 }, radius: 25 }, knockback: { x: 1.58, y: -0.58, scaling: 0.02, reference: { base: 0, growth: 100, angle: 20, fixed: 65 } } }] },
      { startFrame: 54, endFrame: 58, group: 'rung5', damage: 1.4, hitlagMultiplier: 0.8,
        knockback: { x: 0.36, y: -2.07, scaling: 0.02, reference: { base: 0, growth: 55, angle: 367, fixed: 90 } },
        collisionHits: [{ id: 0, capsule: { start: { x: 125, y: 7 }, end: { x: 125, y: -18 }, radius: 20 } }, { id: 1, capsule: { start: { x: 62.5, y: -18 }, end: { x: 62.5, y: -18 }, radius: 25 }, knockback: { x: 1.58, y: -0.58, scaling: 0.02, reference: { base: 0, growth: 100, angle: 20, fixed: 65 } } }] },
      { startFrame: 61, endFrame: 62, group: 'finish', damage: 4, hitlagMultiplier: 2,
        knockback: { x: 2.27, y: -1.91, scaling: 0.242, reference: { base: 60, growth: 157, angle: 361 } },
        collisionHits: [{ id: 0, capsule: { start: { x: 100, y: -13 }, end: { x: -20, y: -13 }, radius: 40 } }] },
    ],
    animation: { startupFrames: 1, activeFrames: 7, recoveryFrames: 4 },
  }, 'SpecialHi'),
};

/**
 * Hand Slap (SpecialLwStart/Loop/End, SpecialAirLw) — `shockwave` kind.
 *
 * Grounded: two ground slaps per activation at frames 12–13 and 23–24 of 46;
 * each 14 %, 78° / 84°, BKB 85 / KBG 30, hitlag ×0.5, on four `top` spheres of
 * radius 10.3 units — it only reaches grounded targets (`situation: 'ground'`).
 * The script rows carry zero offsets (the status code places them); SmashWiki
 * Down special Parameters give "Grounded hitbox offsets from Donkey Kong
 * [0, 5, 6.1]" and "Distance between grounded hitboxes 15u", and the move "hits
 * a good deal behind him": ids 0–3 sit 5 u up at z = +21.1, +6.1, −6.1, −21.1
 * (the 78° ids outermost). Mashing B queues another 26-frame loop. Native
 * DK plays SpecialLwStart once (elapsed 0–6) and then repeats SpecialLwLoop
 * (motion-list special_lw_start / special_lw_loop / special_lw_end), so the
 * repeat rewinds from the loop end (elapsed 33 = 7 + 26, `loopFrame`) to the
 * loop start (elapsed 7), never replaying the start: the next slaps land 26
 * frames after the previous ones (UFD: "each additional rep takes another 26
 * frames") and the drawing continues in the loop. SmashWiki Down special:
 * presses register "at any point during the startup or loop portions" (elapsed
 * 0–32, before the loop point 33), and "during frames 20-26 of the loop portion,
 * the slaps are repeated twice even if the button is only pressed one more
 * time" — loop frames 20–26 of the 26-frame loop starting at elapsed 7 are
 * elapsed 26–32.
 *
 * Aerial: two claps — 19–21 (5 %, 90°, fixed KB 36) and 28–30 (6 %, 270°
 * meteor, BKB 30 / KBG 100) of 49; landing lag 10. Native OFF interaction,
 * trip input and grounded shield-push factor are source-region fields;
 * contact acceptance remains separate from these declarations.
 */
/** SmashWiki offsets [0, 5, 6.1] u, 15 u apart, front and back, at 5 px per unit:
 * y = 42 − 5·5 = 17, x = ±5·6.1 and ±5·(6.1 + 15). Radius is the script size 10.3 u. */
const HAND_SLAP_GROUND_REGIONS = [105.5, 30.5, -30.5, -105.5].map((x, id) => ({
  id, situation: 'ground' as const, capsule: { start: { x, y: 17 }, end: { x, y: 17 }, radius: 51.5 } }));

export const DONKEYKONG_DOWN_SPECIAL: ShockwaveDownSpecialMove = dkSourceMove({
  id: 'donkeykong.down_special',
  type: 'downSpecial',
  downSpecialKind: 'shockwave',
  damage: 14,
  knockback: { x: 0.52, y: -2.46, scaling: 0.046, reference: { base: 85, growth: 30, angle: 78 } },
  hitlagMultiplier: 0.5,
  sdiMultiplier: 1,
  launchAwayFromSource: true,
  hitbox: { offsetX: 0, offsetY: 17, width: 314, height: 103 },
  startupFrames: 11,
  activeFrames: 13,
  recoveryFrames: 22,
  cooldownFrames: 0,
  hitWindows: [
    { startFrame: 11, endFrame: 13, group: 'slap1', damage: 14, collisionHits: HAND_SLAP_GROUND_REGIONS },
    { startFrame: 22, endFrame: 24, group: 'slap2', damage: 14,
      knockback: { x: 0.52, y: -2.46, scaling: 0.046, reference: { base: 85, growth: 30, angle: 78 } },
      collisionHits: HAND_SLAP_GROUND_REGIONS },
  ],
  animation: { startupFrames: 1, activeFrames: 5, recoveryFrames: 2 },
  shockwave: {
    repeat: { windowStart: 0, windowEnd: 33, loopFrame: 33, entryFrame: 7, doubleRepeatFrom: 26 },
    aerialVariant: dkSourceMove({
      id: 'donkeykong.down_special', type: 'downSpecial', damage: 5,
      knockback: { x: 0, y: -1.2, scaling: 0.02, reference: { base: 0, growth: 100, angle: 90, fixed: 36 } },
      hitlagMultiplier: 1,
      sdiMultiplier: 1,
      launchAwayFromSource: true,
      hitbox: { offsetX: 20, offsetY: 5, width: 90, height: 90 },
      startupFrames: 18, activeFrames: 12, recoveryFrames: 19, cooldownFrames: 0,
      specialLandingLagFrames: 10,
      hitWindows: [
        { startFrame: 18, endFrame: 21, group: 'clap1', damage: 5,
          collisionHits: [{ id: 0, capsule: { start: { x: 20, y: 0 }, end: { x: 20, y: 0 }, radius: 35 } }] },
        { startFrame: 27, endFrame: 30, group: 'clap2', damage: 6,
          knockback: { x: 0, y: 2.11, scaling: 0.154, reference: { base: 30, growth: 100, angle: 270 } },
          collisionHits: [{ id: 0, capsule: { start: { x: 20, y: 10 }, end: { x: 20, y: 10 }, radius: 40 } }] },
      ],
      animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 8 },
    }, 'SpecialAirLw'),
  },
}, 'SpecialLwLoop', 7);

/** Standing, dash and pivot grabs, pummel, normal throws and four cargo throws.
 * Native forward throw enters cargo at frame 16; attack/grab + direction releases it. */
function dkThrow(damage: number, angle: number, base: number, growth: number,
  release: number, total: number): ThrowSpec {
  return { damage, knockback: { x: 1, y: -1, scaling: 0, reference: { base, growth, angle } },
    animationFrames: release, recoveryFrames: total - release,
    // All seven native THROW-kind ABS rows have hitlag multiplier0.
    // Catch-kind ABS rows are neither release damage nor held-hit events.
    hitlagMultiplier: 0 };
}

/** SmashWiki Donkey Kong (SSBU): "He also gains Knockback-based Armor when he starts a
 * throw instead of gaining Throw Invulnerability, of which allows him to resist up to
 * 16 Units of Knockback" (Cargo throws). */
const CARGO_THROW_KNOCKBACK_ARMOR = 16;
function cargoThrow(spec: ThrowSpec): ThrowSpec {
  return { ...spec, knockbackArmor: CARGO_THROW_KNOCKBACK_ARMOR };
}

const DONKEYKONG_CARGO_THROWS: ThrowSet = {
  forward: cargoThrow(dkThrow(12, 60, 90, 46, 15, 45)),
  back: cargoThrow({ ...dkThrow(13, 72, 85, 52, 16, 42), reverseFacingAtRelease: true }),
  up: cargoThrow(dkThrow(12, 92, 65, 53, 15, 29)),
  down: cargoThrow(dkThrow(11, 46, 70, 45, 17, 44)),
};

export const DONKEYKONG_GRAB: GrabSpec = {
  // Opt-in to reviewed target 2D anchors; missing contexts retain named legacy fallback.
  attachmentPolicy: 'pose-anchors-beta-v1',
  ultimateCapture: true,
  throwClock: 'native-sample-one',
  id: 'donkeykong.grab',
  hitbox: { offsetX: 44.25, offsetY: 7, width: 106.5, height: 58 },
  collisionHits: dkGrabHits(5.8, 4, 13.7, 1.1, 16.6),
  startupFrames: 7, activeFrames: 3, whiffRecoveryFrames: 28,
  holdFramesMax: 90, throwRecoveryFrames: 29,
  pummel: { damage: 1.6, cooldownFrames: 21, motionFrames: 7, startupFrames: 1, hitlagFrames: 15, hitlagMultiplier: 2.3, sdiMultiplier: 1,
    knockback: dkSourceKnockback(DK_NATIVE_ATTACKS.CatchAttack[0]) },
  dashGrab: { rangeBonusX: 5.5, momentumRetain: 0.5, startupFrames: 10, activeFrames: 3, whiffRecoveryFrames: 33,
    hitbox: { offsetX: 49.75, offsetY: 7, width: 105.5, height: 46 },
    collisionHits: dkGrabHits(4.6, 4, 15.9, 1.7, 18.2) },
  pivotGrab: { rangeBonusX: 0, momentumRetain: 0, startupFrames: 11, activeFrames: 3, whiffRecoveryFrames: 27,
    hitbox: { offsetX: 63.75, offsetY: 7, width: 145.5, height: 58 },
    collisionHits: dkGrabHits(5.8, 4, 21.5, 1.1, 24.4) },
  cargo: { startupFrames: 16, entryMotionFrames: 24, holdFramesMax: 240, offsetX: 0, offsetY: -60,
    breakDamage: 4,
    // SmashWiki DK/Forward_throw: "while carrying an opponent or heavy item, Donkey Kong's
    // walk speed and acceleration are increased by 1.1×".
    walkMultiplier: 1.1,
    // holdFramesMax is the legacy fallback. Ultimate cargo uses its live
    // percent-scaled budget including time/mash already spent before entry.
    throws: DONKEYKONG_CARGO_THROWS,
    // Ground/air share native throw motions and ABS records. The entry state
    // is latched independently so landing mid-throw cannot switch its route.
    airThrows: { ...DONKEYKONG_CARGO_THROWS,
      down: { ...DONKEYKONG_CARGO_THROWS.down,
        releaseVelocity: { x: 0, y: -7.5, situation: 'air' } },
    } },
  // SmashWiki throw Timing tables: Carry "Invincibility 1-15", Back "1-15", Up "1-14",
  // Down "1-19" (each through its throw frame).
  throws: {
    forward: { damage: 0, knockback: { x: 0, y: 0, scaling: 0 },
      animationFrames: 16, recoveryFrames: 0, invincibilityFrames: 15, hitlagMultiplier: 0 },
    back: { ...dkThrow(11, 40, 60, 65, 15, 39), reverseFacingAtRelease: true, invincibilityFrames: 15 },
    up: { ...dkThrow(9, 90, 70, 50, 14, 43), invincibilityFrames: 14 },
    down: { ...dkThrow(7, 361, 60, 50, 19, 54), invincibilityFrames: 19 },
  },
};

/** Raw root-bone CATCH regions; pivot faces its new capture direction on entry. */
function dkGrabHits(radius: number, groundStart: number, groundEnd: number, airStart: number, airEnd: number): NonNullable<GrabSpec['collisionHits']> {
  return [
    { id: 0, situation: 'ground', capsule: { start: { x: groundStart * 5, y: 7 }, end: { x: groundEnd * 5, y: 7 }, radius: radius * 5 } },
    { id: 1, situation: 'air', capsule: { start: { x: airStart * 5, y: 7 }, end: { x: airEnd * 5, y: 7 }, radius: radius * 2.5 } },
  ];
}

function recoveryAttack(motion: 'DownAttackU' | 'DownAttackD' | 'SlipAttack' | 'CliffAttack', suffix: string, total: number): AttackMoveWithAnimation {
  const rows = DK_NATIVE_ATTACKS[motion];
  const first = rows[0]!;
  const end = rows[rows.length - 1]!.frame + (motion === 'CliffAttack' ? 2 : 1);
  return dkSourceMove({ id: `donkeykong.${suffix}`, type: 'tilt', damage: first.damage,
    protectionWindows: [{ startFrame: 0, endFrame: motion === 'SlipAttack' ? 7 : motion === 'CliffAttack' ? 25 : 24,
      regions: ['*'] }],
    knockback: dkSourceKnockback(first),
    hitbox: { offsetX: 0, offsetY: 9.5, width: 255, height: 65 },
    startupFrames: first.frame - 1, activeFrames: end - first.frame + 1,
    recoveryFrames: total - end, cooldownFrames: 0,
    hitWindows: rows.map(r => ({ startFrame: r.frame - 1, endFrame: r.frame + (motion === 'CliffAttack' ? 2 : 1), group: 'sweep' })),
    animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 2 },
    // The ledge attack climbs from the hang along the native CliffAttack root.
    ...(motion === 'CliffAttack' ? { ledgeRootMotion: DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION } : {}),
  }, motion);
}
export const DONKEYKONG_GETUP_ATTACK = recoveryAttack('DownAttackU', 'getupAttack', 45);
export const DONKEYKONG_GETUP_ATTACK_FACE_DOWN = recoveryAttack('DownAttackD', 'getupAttackFaceDown', 45);
export const DONKEYKONG_TRIP_ATTACK = recoveryAttack('SlipAttack', 'tripAttack', 49);
export const DONKEYKONG_LEDGE_ATTACK = recoveryAttack('CliffAttack', 'ledgeAttack', 55);

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
 * Donkey Kong fighter. Inherits all base movement / jump physics from
 * `Character` via {@link ContractFighter}; the kit wires through the same
 * `registerFighterAttack` + `setGrabSpec` path as the rest of the cast.
 */
export class DonkeyKong extends ContractFighter {
  readonly moveset: FighterMoveset = DONKEYKONG_MOVESET;
  readonly movementProfile: FighterMovementProfile = DONKEYKONG_MOVEMENT_PROFILE;
  readonly contract: FighterContract = DONKEYKONG_FIGHTER_CONTRACT;

  constructor(scene: PhysicsHost, options: DonkeyKongOptions) {
    super(scene, {
      id: 'donkeykong',
      ...DONKEYKONG_TUNING,
      ...options,
    });
    registerFighterAttack(this, DONKEYKONG_JAB);
    registerFighterAttack(this, DONKEYKONG_JAB2);
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
    this.setCaptureAttachmentCalibration(getDefaultCaptureAttachmentCalibration('donkeykong'));
    this.setTauntSpec(DONKEYKONG_TAUNTS);
    registerFighterAttack(this, DONKEYKONG_GETUP_ATTACK);
    registerFighterAttack(this, DONKEYKONG_GETUP_ATTACK_FACE_DOWN);
    registerFighterAttack(this, DONKEYKONG_TRIP_ATTACK);
    registerFighterAttack(this, DONKEYKONG_LEDGE_ATTACK);
  }

}
