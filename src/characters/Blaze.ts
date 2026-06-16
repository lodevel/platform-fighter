/**
 * Blaze (Captain Falcon) — fifth roster slot, the "fast heavy" rushdown.
 *
 * Role: rushdown. Near-ninja ground speed bolted onto bruiser-class
 * mass and the steepest fall acceleration in the cast. Blaze wants to
 * sprint into punish range, land one enormous hit, and fast-fall back
 * to the deck before the opponent recovers. Mirrors the Smash
 * "Captain Falcon" archetype: every move is honest, telegraphed, and
 * devastating when it connects clean.
 *
 * Stats (vs the cast — see `BLAZE_MOVEMENT_PROFILE`):
 *
 *   maxRunSpeed   9.0   (▲)  second-fastest, behind Cat (10)
 *   airAccel      0.35       modest — commits to his jump arcs
 *   mass          14    (▲)  heavy for his speed class
 *   fallAccel     0.4   (▲)  steepest gravity in the cast
 *   maxFallSpeed  12.5  (▲)  fast-faller terminal velocity
 *   width/height  50×78      tall athletic silhouette
 *
 * Signature moves:
 *
 *   • Fair ("the knee") — sweet-spot at the leading tip with a huge
 *     `damageGrowth` term: a clean tip-knee out-scales every other
 *     aerial in his kit at high percent. The sour body hit stays a
 *     modest poke, exactly the canonical knee split.
 *   • Neutral special ("blaze punch") — 20-frame wind-up, 24 % on
 *     connect, `baseMagnitude: 2` so it shoves hard even at 0 %.
 *     Authored on the `charge` schema with a short optional hold that
 *     tops out at 28 % — release timing is the skill test.
 *   • Side special — `dashStrike` burst (Raptor-Boost-style approach).
 *   • Up special — `multiHitRising` rising uppercut with slight
 *     forward drift.
 *   • Down special — `groundPound` stomp (hop, then a 32 px/step slam).
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
import { BLAZE_MOVEMENT_PROFILE } from './fighterMovementProfiles';

// Re-export so consumers can import Blaze's movement profile from the
// per-fighter API surface; the literal data lives in
// `fighterMovementProfiles.ts` (same two-level split as the rest of
// the cast — see the Sub-AC 2.2 note in `Wolf.ts`).
export { BLAZE_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 * Movement-relevant fields spread from `BLAZE_MOVEMENT_PROFILE`
 * (single source of truth); body geometry stays inline because it's
 * hurtbox / collision data, not movement.
 */
export const BLAZE_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  ...BLAZE_MOVEMENT_PROFILE,
  // Tall athletic silhouette — taller than Wolf (45×66), narrower than
  // Bear (55×76). Procedural placeholder body: no source sprite cell
  // to match yet, so the footprint is authored directly against the
  // cast's hurtbox ladder.
  width: 50,
  height: 78,
  chamfer: 8,
};

/**
 * Blaze's jab — the fastest grounded poke in his kit (3-frame startup,
 * matching his "first to move" rushdown identity). Low damage; exists
 * to interrupt and to confirm into tilt / grab.
 */
export const BLAZE_JAB: AttackMoveWithAnimation = {
  id: 'blaze.jab',
  type: 'jab',
  damage: 5,
  knockback: { x: 1.5, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 24, offsetY: -3, width: 30, height: 16 },
  startupFrames: 3,
  activeFrames: 3,
  recoveryFrames: 8,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  // Jab-combo opener: a re-press once jab1's hitbox is out advances to
  // jab2 → jab3 (the finisher). Mirrors the Wolf jab-string pattern.
  jabChain: { nextId: 'blaze.jab2' },
};

/**
 * Blaze's jab string — stage 2. A quick follow-up poke that chains from
 * {@link BLAZE_JAB} on a re-press and itself links to the
 * {@link BLAZE_JAB3} finisher. Registered as a `'jab'` move but never the
 * light slot (first-registered jab1 keeps it) — reachable ONLY via the
 * chain link. Faster and lighter than the opener (~70 % of jab1's damage).
 */
export const BLAZE_JAB2: AttackMoveWithAnimation = {
  id: 'blaze.jab2',
  type: 'jab',
  damage: 4,
  knockback: { x: 1.3, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 26, offsetY: -3, width: 30, height: 16 },
  startupFrames: 2,
  activeFrames: 2,
  recoveryFrames: 7,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'blaze.jab3' },
};

/**
 * Blaze's jab string — finisher (stage 3). The launcher that ends the
 * string: bigger knockback + a `baseMagnitude` floor so it pops the
 * opponent away even at low percent. No `jabChain` — the chain
 * terminates here, and its `cooldownFrames` is the post-string lockout.
 * Wider hitbox and more committal frames than the opener.
 */
export const BLAZE_JAB3: AttackMoveWithAnimation = {
  id: 'blaze.jab3',
  type: 'jab',
  damage: 6,
  knockback: { x: 3.2, y: -1.6, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 27, offsetY: -3, width: 34, height: 19 },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 14,
  cooldownFrames: 18,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Blaze's forward tilt — long-legged spacing kick. Harder hit than the
 * cast-average tilt (9 %) because Blaze's neutral is built on "every
 * touch hurts"; pays with a beat more recovery than Cat's.
 */
export const BLAZE_TILT: AttackMoveWithAnimation = {
  id: 'blaze.tilt',
  type: 'tilt',
  damage: 9,
  knockback: { x: 2.2, y: -0.6, scaling: 0.13 },
  hitbox: { offsetX: 28, offsetY: -3, width: 36, height: 17 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Blaze's forward smash — flaming elbow. 15 % with the full Smash-style
 * knockback block (`baseMagnitude` + `damageGrowth`) so it closes
 * stocks from centre stage at ~110 %. 13-frame startup telegraphs the
 * commitment, canonical for the archetype.
 */
export const BLAZE_SMASH: AttackMoveWithAnimation = {
  id: 'blaze.smash',
  type: 'smash',
  damage: 15,
  knockback: { x: 4.2, y: -1.4, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 15,
    maxDamage: 21,
    minKnockback: { x: 4.2, y: -1.4, scaling: 0.4, baseMagnitude: 1.3, damageGrowth: 0.5 },
    maxKnockback: { x: 5.88, y: -1.96, scaling: 0.5, baseMagnitude: 1.3, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 33, offsetY: -3, width: 40, height: 18 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Blaze's neutral aerial — quick two-leg spin centred on the body.
 * Fast startup + low landing lag make it his short-hop pressure
 * staple between knee attempts.
 */
export const BLAZE_NAIR: AerialMove = {
  id: 'blaze.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 7,
  knockback: { x: 1.5, y: -0.9, scaling: 0.11 },
  hitbox: { offsetX: 0, offsetY: -2, width: 48, height: 40 },
  startupFrames: 4,
  activeFrames: 6,
  recoveryFrames: 11,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 3, recoveryFrames: 2 },
  landingLagFrames: 9,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Blaze's forward aerial — **the knee**. The signature sweet-spot move
 * the whole kit is built around:
 *
 *   • The full hitbox is a generous 40×20 sensor in front; the body
 *     (sour) hit is a modest 12 % poke with ordinary scaling.
 *   • The `sweetSpot` sub-region sits at the leading TIP of the kick
 *     (strictly inside the parent sensor, per the schema contract).
 *     A tip connect multiplies damage ×1.25 and knockback ×1.4 on top
 *     of the authored values AND earns the +4 hitlag crunch from
 *     `combat.ts:HITLAG_SWEET_SPOT_BONUS_FRAMES`.
 *   • `damageGrowth: 0.9` is the biggest growth term in his kit — the
 *     knee's knockback out-scales every authored-equal `scaling` move
 *     at high percent, which is what makes the tip a KO move while
 *     the sour hit stays a combo filler.
 */
export const BLAZE_FAIR: AerialMove = {
  id: 'blaze.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 12,
  knockback: { x: 2.6, y: -0.7, scaling: 0.2, baseMagnitude: 0.9, damageGrowth: 0.9 },
  hitbox: { offsetX: 26, offsetY: -3, width: 40, height: 20 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 15,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
  landingLagFrames: 15,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
  // Tip-of-knee sweet spot — strict sub-region of the parent sensor
  // (parent spans x [6, 46]; tip spans [33, 45]).
  sweetSpot: {
    hitbox: { offsetX: 39, offsetY: -3, width: 12, height: 16 },
    damageMultiplier: 1.25,
    knockbackMultiplier: 1.4,
  },
};

/**
 * Blaze's back aerial — heavy reverse backfist. His most reliable
 * aerial KO tool when the knee is too risky; slower than fair with a
 * flatter, side-blast-zone launch angle.
 */
export const BLAZE_BAIR: AerialMove = {
  id: 'blaze.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 12,
  knockback: { x: 2.9, y: -1.1, scaling: 0.28 },
  hitbox: { offsetX: 26, offsetY: -3, width: 38, height: 20 },
  startupFrames: 9,
  activeFrames: 4,
  recoveryFrames: 15,
  cooldownFrames: 12,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
  landingLagFrames: 18,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
};

/**
 * Blaze's up aerial — **rising knee** above the head. The juggle engine
 * of his kit: the strongest aerial launcher he owns, the move he loops
 * a fast-faller into off an up-throw or a sour-knee. Hard upward
 * knockback with a meaty `damageGrowth` term so the juggle eventually
 * becomes a true skyward KO confirm — knee-flavoured, not a soft poke.
 *
 *   • Damage    : 10 — above his nair (7), below the knee (12). The
 *                 juggle filler that still threatens at high percent.
 *   • Knockback : x 0.3 / y -3.3, scaling 0.22, damageGrowth 0.4 — the
 *                 steep vertical launch that keeps the opponent above
 *                 him for the next rep, then KOs once percent climbs.
 *   • Frames    : 5 startup / 4 active / 13 recovery + 8 cooldown.
 *                 One frame faster startup than Wolf's uair (6) per
 *                 Blaze's "first to move" rushdown identity.
 *   • landingLagFrames: 9 — low, so he can re-juggle on landing.
 *   • autoCancelWindows: `[0, 3)` pre-hitbox early-out.
 */
export const BLAZE_UAIR: AerialMove = {
  id: 'blaze.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 10,
  knockback: { x: 0.3, y: -3.3, scaling: 0.22, baseMagnitude: 0.9, damageGrowth: 0.4 },
  hitbox: { offsetX: 0, offsetY: -32, width: 36, height: 28 },
  startupFrames: 5,
  activeFrames: 4,
  recoveryFrames: 13,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 9,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/**
 * Blaze's down aerial — **stomp knee**, a meteor / spike below the body.
 * The off-stage finisher: a clean connect sends the opponent straight
 * down (positive Y = downward in Phaser screen-space), which is a stock
 * when Blaze catches them off the ledge. Slower and more committal than
 * his up-air — the trade for the one-touch payoff — with heavy landing
 * lag if whiffed onto the stage.
 *
 *   • Damage    : 11 — between uair (10) and the knee (12); the meteor
 *                 is about the launch, not the raw damage.
 *   • Knockback : x 0.4 / y 3.6, scaling 0.24 — the canonical spike
 *                 trajectory, slightly harder than Wolf's dair (3.5).
 *   • Frames    : 8 startup / 4 active / 17 recovery + 10 cooldown.
 *   • landingLagFrames: 17 — heavy; a whiffed stomp onto the deck is a
 *     full punish window.
 *   • autoCancelWindows: `[0, 4)` pre-hitbox early-out.
 */
export const BLAZE_DAIR: AerialMove = {
  id: 'blaze.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 11,
  knockback: { x: 0.4, y: 3.6, scaling: 0.24 },
  hitbox: { offsetX: 0, offsetY: 28, width: 32, height: 26 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 17,
  cooldownFrames: 10,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 17,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Blaze's up-tilt — a quick rising elbow above the head (up-stick +
 * light). Fast anti-air / juggle-starter: 5-frame startup catches a
 * jump-in or pops a grounded opponent up into his up-air loop. Weaker
 * and lower-commitment than the up-smash — the "keep them in the air"
 * tool, not the finisher.
 *
 *   • Damage    : 8 — a hair above the cast-average up-tilt; matches
 *                 Blaze's "every touch hurts" neutral.
 *   • Knockback : x 0.2 / y -2.3, scaling 0.16 — pops the target up for
 *                 the juggle without launching them out of range.
 *   • Frames    : 5 startup / 3 active / 10 recovery + 11 cooldown.
 */
export const BLAZE_UTILT: AttackMoveWithAnimation = {
  id: 'blaze.utilt',
  type: 'tilt',
  damage: 8,
  knockback: { x: 0.2, y: -2.3, scaling: 0.16 },
  hitbox: { offsetX: 10, offsetY: -20, width: 66, height: 50 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Blaze's up-smash — **flaming uppercut**, a rising vertical strike
 * (up-stick + heavy). The grounded vertical KO of the kit: slow to
 * start (12 frames, telegraphed like his forward smash) but it ends
 * stocks off the top blast zone when charged under a juggled opponent.
 * Mirrors the forward smash's knockback shape (`baseMagnitude` +
 * `damageGrowth`) so the two finishers scale identically — one
 * horizontal, one vertical.
 *
 *   • Damage    : 17 — two over his forward smash (15); the up-smash
 *                 is the hardest single grounded hit in his kit, the
 *                 reward for landing the slow vertical read.
 *   • Knockback : x 0.3 / y -3.7, scaling 0.42, baseMagnitude 1.3,
 *                 damageGrowth 0.5 — the forward smash's block, aimed
 *                 straight up. KOs off the top at ~95 % from centre.
 *   • Frames    : 12 startup / 4 active / 20 recovery + 22 cooldown —
 *                 identical lockout shape to the forward smash.
 */
export const BLAZE_USMASH: AttackMoveWithAnimation = {
  id: 'blaze.usmash',
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
  hitbox: { offsetX: 11, offsetY: -27, width: 70, height: 64 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 20,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Blaze's down-tilt — **low crouching kick** at the feet (down-stick +
 * light). The combo/spacing poke of his grounded kit: a fast, low hitbox
 * that slips under the opponent's hurtbox and pops them just off the
 * deck into a near-horizontal trip. The "open the rep" tool, not a
 * finisher — it confirms into a dash-in tilt or a rising up-air.
 *
 *   • Damage    : 7 — between his jab (5) and forward tilt (9). A poke,
 *                 not a punish.
 *   • Knockback : x 1.8 / y -0.5, scaling 0.1 — a LOW, near-horizontal
 *                 trip that keeps the target close for the follow-up.
 *   • Hitbox    : offsetY +12, 34×14 sensor at the feet — wide and low,
 *                 spaced just past his jab range.
 *   • Frames    : 5 startup / 3 active / 10 recovery + 11 cooldown.
 *                 One frame slower than his jab (3); the canonical fast
 *                 low poke for the rushdown identity.
 */
export const BLAZE_DTILT: AttackMoveWithAnimation = {
  id: 'blaze.dtilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 1.8, y: -0.5, scaling: 0.1 },
  hitbox: { offsetX: 26, offsetY: 32, width: 34, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Blaze's down-smash — **double-leg sweep** at the feet (down-stick +
 * heavy). The grounded HORIZONTAL KO of his kit: a wide, low sweep that
 * sends the target outward and low toward the side blast zone. Mirrors
 * the FORWARD smash's knockback shape (`baseMagnitude` + `damageGrowth`)
 * tuned a touch harder for the sweep, so all three smashes (forward /
 * up / down) scale on the same Smash-style block — forward horizontal,
 * up vertical, down a low-angle horizontal launcher. Slow to start
 * (13 frames, telegraphed like his forward smash) so it punishes whiffs
 * but cleanly closes stocks at the ledge.
 *
 *   • Damage    : 16 — one over his forward smash (15); the sweep is the
 *                 harder horizontal hit, the reward for landing the slow
 *                 low read.
 *   • Knockback : x 4.4 / y -1.0, scaling 0.42, baseMagnitude 1.3,
 *                 damageGrowth 0.5 — the forward smash's block aimed
 *                 lower and flatter. KOs Cat off the side at ~105 % from
 *                 centre stage.
 *   • Hitbox    : offsetX 28, offsetY +12, 56×16 sensor — the widest
 *                 grounded hit window in his kit (his forward smash is
 *                 40 wide), spanning both feet at deck level.
 *   • Frames    : 13 startup / 4 active / 18 recovery + 22 cooldown —
 *                 identical lockout shape to the forward smash.
 */
export const BLAZE_DSMASH: AttackMoveWithAnimation = {
  id: 'blaze.dsmash',
  type: 'smash',
  damage: 16,
  knockback: { x: 4.4, y: -1.0, scaling: 0.42, baseMagnitude: 1.3, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 16,
    maxDamage: 22.4,
    minKnockback: { x: 4.4, y: -1.0, scaling: 0.42, baseMagnitude: 1.3, damageGrowth: 0.5 },
    maxKnockback: { x: 6.16, y: -1.4, scaling: 0.525, baseMagnitude: 1.3, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 28, offsetY: 12, width: 56, height: 16 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Blaze's dash-attack — **running shoulder charge** (light press while
 * running). The signature speedster burst: he carries his second-fastest
 * run speed (9.0) into a hard forward-and-up lunging hit that closes the
 * gap and pops the target up for a juggle. A strong approach / combo-
 * starter — harder than a tilt to match the Captain-Falcon "everything
 * hurts" identity, but weaker and faster than a smash so it stays a
 * neutral-game tool rather than a finisher.
 *
 *   • Damage    : 11 — above his forward tilt (9), below his forward
 *                 smash (15). The running burst hits hard for a non-smash.
 *   • Knockback : x 2.8 / y -1.4, scaling 0.2 — a forward-AND-up launch
 *                 (steeper than his tilt's -0.6) that pops the target
 *                 into his up-air juggle.
 *   • Hitbox    : offsetX 30, offsetY -3, 42×20 sensor — extends well
 *                 past his body in the run direction (forward lunge).
 *   • Frames    : 7 startup / 4 active / 14 recovery + 14 cooldown.
 *                 Medium startup — slower than his jab/tilt, the trade
 *                 for the ground-covering approach.
 */
export const BLAZE_DASHATTACK: AttackMoveWithAnimation = {
  id: 'blaze.dashAttack',
  type: 'tilt',
  damage: 11,
  knockback: { x: 2.8, y: -1.4, scaling: 0.2 },
  hitbox: { offsetX: 30, offsetY: -3, width: 42, height: 20 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Blaze's neutral special — **blaze punch** (`charge` schema).
 *
 * The slow devastating haymaker: 20 frames of wind-up (longest startup
 * in his kit — fully reactable), 24 % on connect, and `baseMagnitude: 2`
 * so even a 0 % opponent gets shoved across the stage. Authored on the
 * existing `charge` schema: the move fires at full power on a bare
 * press (`minDamage` = the authored 24), and an optional short hold
 * (≤ 24 frames) tops it out at 28 % with a meaner launch — release
 * timing is the only added skill test, mirroring the "turnaround
 * punch" micro-optimisation of the source material.
 *
 *   • Frames: 20 startup / 6 active / 24 recovery + 28 cooldown.
 *     Lockout = 78 frames (~1.3 s) — strictly a hard read, never a
 *     neutral poke.
 */
export const BLAZE_NEUTRAL_SPECIAL: ChargeSpecialMove = {
  id: 'blaze.neutral_special',
  type: 'special',
  specialKind: 'charge',
  // Move-level damage / knockback carry the MIN-CHARGE (bare-press)
  // values so an AI predictor reading only `AttackMove` sees the
  // baseline 24 % haymaker.
  damage: 24,
  knockback: { x: 4.4, y: -1.5, scaling: 0.35, baseMagnitude: 2, damageGrowth: 0.5 },
  hitbox: { offsetX: 30, offsetY: -3, width: 46, height: 30 },
  startupFrames: 20,
  activeFrames: 6,
  recoveryFrames: 24,
  cooldownFrames: 28,
  animation: { startupFrames: 3, activeFrames: 2, recoveryFrames: 3 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 24,
    minDamage: 24,
    maxDamage: 28,
    minKnockback: { x: 4.4, y: -1.5, scaling: 0.35 },
    maxKnockback: { x: 5.0, y: -1.7, scaling: 0.4 },
  },
};

/**
 * Blaze's side special — **dash strike** (Raptor-Boost-style approach
 * burst). Faster dash than Wolf's (20 vs 18) per the rushdown
 * archetype; same `dashStrike` schema, same "neutral-game tool, not a
 * recovery" rule (`helplessAfterDash: false`).
 */
export const BLAZE_SIDE_SPECIAL: DashStrikeSideSpecialMove = {
  id: 'blaze.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  damage: 14,
  knockback: { x: 3.2, y: -1.0, scaling: 0.28 },
  // Body-attached sensor that travels with Blaze during the burst.
  hitbox: { offsetX: 26, offsetY: -3, width: 48, height: 28 },
  startupFrames: 6,
  activeFrames: 8,
  recoveryFrames: 18,
  cooldownFrames: 18,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 4 },
  dashStrike: {
    dashSpeed: 20, // ≈ 1200 px/s — well past his max run (540 px/s)
    dashFrames: 6, // ¾ of the 8-frame active window
    helplessAfterDash: false,
  },
};

/**
 * Blaze's up special — **rising uppercut** (`multiHitRising` schema).
 * Three-hit ladder: two link hits pin the target against the rising
 * fist, the launcher at the apex sends them skyward. Slight forward
 * drift (`driftImpulse: 1.5`) lets him angle the recovery toward the
 * ledge — the one mobility concession in an otherwise committal kit.
 */
export const BLAZE_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'blaze.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  // Move-level damage / knockback carry the LINK-HIT values (first
  // contact) — launcher values live on `multiHitRising`.
  damage: 3,
  knockback: { x: 0, y: -0.5, scaling: 0.03 },
  // Body-centred — `updateHitboxPosition` walks the sensor with the
  // body each active frame as Blaze climbs.
  hitbox: { offsetX: 0, offsetY: -4, width: 38, height: 46 },
  startupFrames: 4,
  activeFrames: 14,
  recoveryFrames: 20,
  cooldownFrames: 18,
  animation: { startupFrames: 1, activeFrames: 5, recoveryFrames: 2 },
  multiHitRising: {
    riseImpulse: -17, // upward (negative Y in Phaser screen-space)
    driftImpulse: 1.5, // slight forward drift toward the press direction
    hitCount: 3,
    hitInterval: 5, // hits at active-frames [0, 5, 10] — inside the 14
    linkDamage: 3,
    linkKnockback: { x: 0, y: -0.5, scaling: 0.03 },
    launcherDamage: 7,
    launcherKnockback: { x: 0.8, y: -3.4, scaling: 0.34 },
  },
};

/**
 * Blaze's down special — **stomp** (`groundPound` schema). Short hop,
 * then a 32 px/step slam — the fastest plunge in the cast, mirroring
 * his fast-faller movement identity. The descent body is the meteor
 * hitbox (off-stage connect = stock); the landing shockwave is a
 * modest clean-up hit.
 */
export const BLAZE_DOWN_SPECIAL: GroundPoundDownSpecialMove = {
  id: 'blaze.down_special',
  type: 'downSpecial',
  downSpecialKind: 'groundPound',
  // Move-level damage / knockback are the METEOR (descent) values;
  // +y is downward in Phaser screen-space — the spike trajectory.
  damage: 13,
  knockback: { x: 0.4, y: 3.8, scaling: 0.3 },
  // Body-attached descent sensor matching the 50×78 footprint roughly.
  hitbox: { offsetX: 0, offsetY: 0, width: 46, height: 46 },
  startupFrames: 5,
  activeFrames: 14,
  recoveryFrames: 20,
  cooldownFrames: 22,
  animation: { startupFrames: 1, activeFrames: 5, recoveryFrames: 2 },
  groundPound: {
    hopFrames: 3, // first 3 of 14 active frames are the hop
    hopImpulse: -9,
    slamVelocity: 32, // fastest plunge in the cast
    shockwaveDamage: 7,
    shockwaveKnockback: { x: 2.2, y: -1.1, scaling: 0.16 },
    shockwaveHitbox: {
      offsetX: 0,
      offsetY: 32, // at his feet (body half-height = 39)
      width: 170,
      height: 20,
    },
  },
};

/**
 * Blaze's grab — standing grab with a fast 6-frame startup (rushdown
 * grabs first, asks questions later). Back-throw is the kill throw;
 * up-throw starts juggles into the rising uppercut.
 */
export const BLAZE_GRAB: GrabSpec = {
  id: 'blaze.grab',
  hitbox: { offsetX: 26, offsetY: -2, width: 24, height: 30 },
  startupFrames: 6,
  activeFrames: 2,
  whiffRecoveryFrames: 30,
  holdFramesMax: 90,
  throwRecoveryFrames: 22,
  pummel: { damage: 1.5, cooldownFrames: 12 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 9, knockback: { x: 2.6, y: -1.0, scaling: 0.11 }, animationFrames: 20 },
    back:    { damage: 10, knockback: { x: 2.9, y: -1.2, scaling: 0.13 }, animationFrames: 24 },
    up:      { damage: 7, knockback: { x: 0.4, y: -3.1, scaling: 0.1 }, animationFrames: 14 },
    down:    { damage: 6, knockback: { x: 0.9, y: 1.1, scaling: 0.08 }, animationFrames: 16 },
  },
};

/**
 * Blaze's full 10-slot uniform moveset — same canonical
 * {@link FighterMoveset} shape as the rest of the cast. Defensive
 * slots use the shared {@link SHIELD_DEFAULTS} / {@link DODGE_DEFAULTS}
 * until a per-character defensive balance pass lands.
 */
export const BLAZE_MOVESET: FighterMoveset = Object.freeze({
  jab: BLAZE_JAB,
  tilt: BLAZE_TILT,
  smash: BLAZE_SMASH,
  fair: BLAZE_FAIR,
  neutralSpecial: BLAZE_NEUTRAL_SPECIAL,
  sideSpecial: BLAZE_SIDE_SPECIAL,
  upSpecial: BLAZE_UP_SPECIAL,
  downSpecial: BLAZE_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Blaze's full {@link FighterContract} declaration — identity +
 * 10-slot moveset + movement profile in one frozen record.
 */
export const BLAZE_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'blaze',
  moveset: BLAZE_MOVESET,
  movementProfile: BLAZE_MOVEMENT_PROFILE,
});

/** Blaze-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface BlazeOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Blaze fighter (Captain Falcon-inspired rushdown). Inherits all base
 * movement / jump physics from `Character` via {@link ContractFighter};
 * the constructor wires the full authored kit through the same
 * `registerFighterAttack` + `setGrabSpec` path as the rest of the cast.
 */
export class Blaze extends ContractFighter {
  /** Blaze's frozen 10-slot moveset surface — see {@link BLAZE_MOVESET}. */
  readonly moveset: FighterMoveset = BLAZE_MOVESET;

  /** Blaze's per-fighter movement parameters — see {@link BLAZE_MOVEMENT_PROFILE}. */
  readonly movementProfile: FighterMovementProfile = BLAZE_MOVEMENT_PROFILE;

  /** Full per-fighter declaration — see {@link BLAZE_FIGHTER_CONTRACT}. */
  readonly contract: FighterContract = BLAZE_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: BlazeOptions) {
    super(scene, {
      id: 'blaze',
      // Blaze's tuning is the floor; caller-supplied options (e.g.
      // test-only mass overrides) win via the base spread merge.
      ...BLAZE_TUNING,
      ...options,
    });
    // Registration order mirrors the cast convention: grounded triplet
    // (jab fills the light slot + legacy default), then the aerial cut
    // (nair wires the legacy aerial slot, fair / bair fill the
    // directional slots via `aerialDirection`-aware registration),
    // then the four specials (each auto-fills its dispatch slot via
    // type-based slot wiring).
    registerFighterAttack(this, BLAZE_JAB);
    // Jab-string stages 2 & 3 — register as `'jab'` moves but jab1 keeps
    // the light slot via first-registered-wins; reachable only via the
    // `jabChain` link from jab1 → jab2 → jab3 (finisher).
    registerFighterAttack(this, BLAZE_JAB2);
    registerFighterAttack(this, BLAZE_JAB3);
    registerFighterAttack(this, BLAZE_TILT);
    registerFighterAttack(this, BLAZE_SMASH);
    registerFighterAttack(this, BLAZE_NAIR);
    registerFighterAttack(this, BLAZE_FAIR);
    registerFighterAttack(this, BLAZE_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt / up-smash are
    // type 'tilt'/'smash' (their forward slots are taken), so wire the
    // dedicated up slots explicitly.
    registerFighterAttack(this, BLAZE_UAIR);
    registerFighterAttack(this, BLAZE_DAIR);
    registerFighterAttack(this, BLAZE_UTILT);
    registerFighterAttack(this, BLAZE_USMASH);
    this.setUpTilt(BLAZE_UTILT.id);
    this.setUpSmash(BLAZE_USMASH.id);
    // Down + dash grounded normals. All three are type 'tilt'/'smash'
    // whose forward slots are already taken (jab/tilt/smash above), so
    // they MUST be wired to the dedicated down/dash dispatch slots
    // explicitly — same pattern as the up-tilt / up-smash wiring above.
    registerFighterAttack(this, BLAZE_DTILT);
    registerFighterAttack(this, BLAZE_DSMASH);
    registerFighterAttack(this, BLAZE_DASHATTACK);
    this.setDownTilt(BLAZE_DTILT.id);
    this.setDownSmash(BLAZE_DSMASH.id);
    this.setDashAttack(BLAZE_DASHATTACK.id);
    registerFighterAttack(this, BLAZE_NEUTRAL_SPECIAL);
    registerFighterAttack(this, BLAZE_SIDE_SPECIAL);
    registerFighterAttack(this, BLAZE_UP_SPECIAL);
    registerFighterAttack(this, BLAZE_DOWN_SPECIAL);

    // Grab — wires the range sensor + 4-throw set into the grab state
    // machine ticked by `Character.applyInput`.
    this.setGrabSpec(BLAZE_GRAB);
  }

  // Per-slot execute hooks are inherited from ContractFighter, which
  // fires each slot off the frozen `moveset` declaration above.

  /**
   * Blaze's wake-up attack — a low two-leg sweep on both sides as he
   * kips up from knockdown (his down-smash is a double-leg sweep, so the
   * get-up reads as the same motion). A fast-heavy bruiser: the sweep is
   * WIDE (98 px ≈ 2.0× his 50 px body) and a hair stronger than the base
   * default, but it stays a utility pop-away, NOT a KO — short 6-frame
   * active window mirroring his "first to move" rushdown identity.
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 7,
      knockback: { x: 4.2, y: -3, scaling: 0.12 },
      // Two-sided sweep centred on the body (offsetX 0), 98 px wide
      // (≈ 2.0× his 50 px footprint) — sweeps both flanks as he rises.
      hitbox: { offsetX: 0, offsetY: 8, width: 98, height: 40 },
      activeFrames: 6,
    };
  }

  /**
   * Blaze's ledge attack — a forward climbing elbow/kick that clears the
   * edge corner up onto the stage as he pulls himself back from the
   * ledge. Scaled to his tall 50×78 silhouette: a touch stronger and
   * taller than the base default to match the bruiser archetype, but a
   * SHORT (7-frame) active window keeps it a utility edge-clear that pops
   * the opponent away — never a KO swing.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 9,
      knockback: { x: 4.2, y: -2.4, scaling: 0.14 },
      // Forward swing over the ledge corner up onto the stage.
      hitbox: { offsetX: 14, offsetY: -2, width: 86, height: 64 },
      activeFrames: 7,
    };
  }
}
