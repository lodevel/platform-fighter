/**
 * Bear — fourth and final concrete fighter subclass (AC 60001 Sub-AC 1
 * — the foundation cut: shared ground-attack data schema in place plus
 * full grounded triplet jab / tilt / smash with animation states for
 * every roster slot, mirroring the AC 60002 Sub-AC 2 work for Wolf, the
 * AC 60003 Sub-AC 3 work for Cat, and the AC 60004 Sub-AC 4 work for
 * Owl).
 *
 * Role: grappler. The "immovable wall" archetype — heaviest mass in the
 * cast, slowest top speed, shortest grounded reach paid for by the
 * single hardest hits in the M2 cut. Where Wolf is the "fast bruiser",
 * Cat the "ninja poker", and Owl the "long-reach mage", Bear is the
 * "close-quarters powerhouse": you have to walk into his swing range to
 * be hit at all, but every swing that lands does meaningfully more
 * damage / knockback than the equivalent move on any other roster slot.
 *
 * Stats (vs `DEFAULT_CHARACTER_TUNING` and the rest of the cast):
 *
 *   maxRunSpeed   6.0   (▼)   slowest in the M2 cut (Owl 6.5, Wolf 7.5,
 *                              Cat 10.0). Bear walks his power into
 *                              range; he never dashes for it.
 *   groundAccel   0.50  (▼)   slowest get-going from neutral; punished
 *                              by ranged pokes if he loses centre stage.
 *   airAccel      0.25  (▼)   worst air-control of the cast — once Bear
 *                              commits to a jump arc he's locked into it.
 *                              Pays the recovery price for the raw mass.
 *   groundDamping 0.74         slightly less sticky than baseline; once
 *                              Bear's moving he keeps gliding.
 *   airDamping    0.93         floaty horizontal drift in the air despite
 *                              the bad air-control: the mass carries.
 *   jumpImpulse   11.5  (▼)   shortest hop (Wolf 12.5, Owl 13.0, Cat 13.5).
 *                              Bear barely clears the standard platform
 *                              gap on his single jump; double-jump is the
 *                              workhorse for vertical traversal.
 *   maxJumps      2            standard double-jump.
 *   width         110          widest silhouette in the M2 cut (Wolf 100,
 *                              Owl 84, Cat 72) — Bear is the unmissable
 *                              target.
 *   height        148          slightly taller than Wolf (140), shorter
 *                              than Owl (144). The hurtbox is a *square-
 *                              ish brick* rather than Wolf's tall
 *                              rectangle or Owl's tower.
 *   chamfer       16           generous corner softening so Bear's wide
 *                              body doesn't catch on platform edges.
 *   mass          20   (▲)    heaviest in the cast — 25 % heavier than
 *                              Wolf (16), 2.5× Cat (8). The same hit
 *                              that KOs Cat at 80 % won't KO Bear until
 *                              ~140 %, the ultimate "patient turtle"
 *                              setup.
 *
 * Why "heaviest, slowest, biggest" instead of just copy-pasting Wolf:
 *
 *   • The Seed's roster contract calls for distinct archetypes per
 *     character — duplicating a body shape would defeat the purpose of
 *     a fourth slot. Bear's brick-shaped hurtbox creates new gameplay
 *     situations (he gets caught by stage hazards Wolf would clear, his
 *     wide body soaks aerials Owl's tower would slip past), giving him
 *     an identity at the silhouette level before the moveset enters
 *     the picture.
 *
 *   • The "heavy + powerful + short-reach" body lines up with the
 *     close-quarters power-hitter pokes this AC ships — Bear's
 *     jab / tilt / smash all hit harder than every other character's
 *     equivalent, but his hitbox offsets are the *shortest* in the M2
 *     cut. Big square body + short range reads as "wrestler, not
 *     fencer".
 *
 * Moveset (this AC: full grounded triplet — aerials/specials land in
 * later sub-ACs alongside the rest of the M2 kit expansion):
 *
 *   Jab   (`bear.jab`,   light)  damage 7,  short-range slam (6 art frames)
 *   Tilt  (`bear.tilt`,  light)  damage 10, the spacing tool (7 art frames)
 *   Smash (`bear.smash`, heavy)  damage 16, KO finisher (8 art frames)
 *
 * Where Bear's grounded numbers sit in the cast:
 *
 *                 Cat    Owl    Wolf   Bear
 *     Jab dmg     3      5      6      7    (Bear: hardest)
 *     Tilt dmg    5      7      8      10   (Bear: hardest)
 *     Smash dmg   9      12     14     16   (Bear: hardest)
 *     Jab startup 2      3      4      5    (Bear: slowest)
 *     Smash KB    2.8    3.5    4.0    4.5  (Bear: hardest)
 *     Smash sx    50     90     70     76   (Bear: shorter than Owl)
 *
 *   This is a deliberate "fourth pole" placement — Bear is the median-
 *   to-slow character on the speed axis but the apex of the power axis.
 *   His distinguishing axes are *raw damage* and *raw knockback*, not
 *   reach (Owl owns reach) or speed (Cat owns speed):
 *
 *     • Jab     hitbox.offsetX 56 (vs Wolf 50, Owl 60, Cat 36) — Bear
 *               only barely out-reaches Wolf and falls short of Owl.
 *               Does the most damage of any jab (7) and has the
 *               highest knockback scaling on a jab in the cast.
 *
 *     • Tilt    hitbox.offsetX 64, width 80 — comparable footprint to
 *               Wolf's tilt (60, 80) but with bigger numbers everywhere.
 *               Hits harder than every other tilt; pays in startup
 *               (8 frames vs Wolf's 7, Owl's 6, Cat's 5).
 *
 *     • Smash   hitbox.offsetX 76, width 96 — comparable to Owl's
 *               (90, 108) on width but shorter on offset. Damage 16 is
 *               the hardest swing in the M2 cut. Knockback 4.5/-1.6
 *               with 0.42 scaling KOs Cat from centre stage at ~80 %,
 *               where Wolf's needs ~95 %. Pays in 14 startup frames
 *               (Wolf 12, Owl 10, Cat 8) — punish-the-whiff hard if you
 *               read it wrong.
 *
 * Why a tilt distinct from jab and smash (mirrors the Wolf / Cat / Owl
 * contract — locked down by the roster tests):
 *   • Jab is the safe poke — fastest startup, low damage, low knockback.
 *   • Tilt is the *spacing* tool — longer reach than jab, harder hit,
 *     more committal recovery. The "third grounded option" in the
 *     canonical Smash toolkit. For Bear, it's the move that controls
 *     centre-stage neutral when the opponent respects jab range.
 *   • Smash is the KO finisher — biggest reach, hardest knockback
 *     scaling, longest startup so it punishes whiff-prone opponents.
 *
 * Animation frames (AC 60001 Sub-AC 1): each grounded move declares a
 * per-phase art-frame count (`MoveAnimation`) inside the Seed-mandated
 * 6-8 range. The gameplay state machine drives the renderer through
 * `selectAnimationFrame(framesElapsed, move)` so the displayed art
 * frame and the live hitbox phase are always in lockstep — no
 * possibility of an animation-vs-hitbox phase drift.
 *
 *   Jab    : 2 startup + 1 active + 3 recovery = 6 art frames
 *   Tilt   : 2 startup + 2 active + 3 recovery = 7 art frames
 *   Smash  : 3 startup + 1 active + 4 recovery = 8 art frames
 *
 * The (later AC) sprite atlas pipeline will register textures keyed
 * `bear.jab.startup.0`, `bear.jab.active.0`, etc.; until then the
 * renderer paints flat-colour rectangles and the animation indices
 * exist purely as state-machine drivers ready for the asset drop.
 *
 * Why these numbers are encoded as exported `const`s (mirrors
 * Wolf / Cat / Owl):
 *   • Tests can assert exactly what stats Bear ships with.
 *   • The (later AC) move-editor and balance-pass tooling can mutate
 *     these tables without recompiling the class.
 *   • Composing fighters from data tables is the M2 roster pattern —
 *     every character follows the same shape so a roster-comparison
 *     tool can render the four side-by-side.
 *
 * Determinism: every value here is a frozen literal — no `Math.random`,
 * no wall-clock. Importing this module produces the same bytes on every
 * boot, which is what the replay system requires.
 */

import type Phaser from 'phaser';
import { ContractFighter } from './contractFighter';
import { Character, type CharacterTuning } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AttackMove } from './attacks';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';
import type { CommandGrabSpecialMove } from './specialSchema';
import type { CommandDashSideSpecialMove } from './sideSpecialSchema';
import type { TetherUpSpecialMove } from './upSpecialSchema';
import type { CounterDownSpecialMove } from './downSpecialSchema';
import type { GrabSpec } from './grabSchema';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import type {
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
} from './movesetContract';
import { BEAR_MOVEMENT_PROFILE } from './fighterMovementProfiles';
// Extended-slot directional moves authored in `extendedMoves.ts`:
// BEAR_UAIR (up-air launcher), BEAR_DAIR (down-air spike), and
// BEAR_UP_LIGHT (re-used here as the up-tilt). The up-smash
// (`BEAR_USMASH`) is authored inline below alongside Bear's other
// grounded moves because the extended-moves file does not carry an
// up-smash slot for the grappler kit.
import { BEAR_UAIR, BEAR_DAIR, BEAR_UP_LIGHT, BEAR_DOWN_LIGHT } from './extendedMoves';

// Re-export so consumers that historically imported `BEAR_MOVEMENT_PROFILE`
// from this file (the per-fighter API surface) keep working byte-for-byte.
// Sub-AC 2.2 of the T2 refactor moved the literal data into the
// `fighterMovementProfiles` leaf module so the shared `Character` base
// can resolve per-fighter movement values at construction time without
// pulling in a per-fighter class (which would trigger the
// `class Bear extends Character` cyclic-init TDZ). The per-fighter file
// remains the natural import location for "Bear's stats" while the
// architectural source of truth lives in one indexable place.
export { BEAR_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 *
 * The `shield` slot is intentionally omitted (covered by AC 60301
 * Sub-AC 1's canonical `SHIELD_DEFAULTS`); a per-character shield
 * balance pass would land here later.
 */
export const BEAR_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  // Sub-AC 2.2 of the T2 refactor — movement-relevant fields composed
  // from `BEAR_MOVEMENT_PROFILE` (the per-fighter movement profile —
  // single source of truth in `fighterMovementProfiles.ts`). Body
  // geometry (`width` / `height` / `chamfer`) remains inline below
  // because it's hurtbox / collision data, not movement parameters
  // per the {@link FighterMovementProfile} JSDoc.
  ...BEAR_MOVEMENT_PROFILE,
  // Bodies were re-derived from visible silhouettes (see Wolf.ts /
  // Cat.ts). Bear is procedural-fallback; preserves the hierarchy:
  // widest of the cast (Wolf 45, Owl 42, Cat 40) and slightly taller
  // than Wolf, shorter than Owl.
  width: 55,
  height: 76,
  chamfer: 16,
  // `mass` is sourced from the spread of `BEAR_MOVEMENT_PROFILE` above
  // (Sub-AC 2.2 of the T2 refactor — the per-fighter movement profile
  // is the single source of truth for knockback-resistance mass).
};

/**
 * Bear's basic neutral attack — short-range body slam. Slowest jab in
 * the cast (5-frame startup vs Cat's 2, Owl's 3, Wolf's 4) but hits the
 * hardest. Bear's body width (110) means a 56 px hitbox offset puts the
 * leading edge just past his shoulder — close-quarters poke, not a long
 * arm-extension.
 *
 *   • Damage    : 7  — hardest jab in the M2 cut (Wolf 6, Owl 5, Cat 3).
 *   • Knockback : x 1.7 / y -0.5, scaling 0.07. Slightly stronger than
 *                 Wolf's jab (1.4 / -0.4 / 0.06) — Bear opens KO percent
 *                 fastest off a jab.
 *   • Frames    : 5 startup / 3 active / 9 recovery + 17 cooldown.
 *                 Lockout = 34 frames (~567 ms) — slowest jab lockout in
 *                 the cast (Wolf 30, Owl 19, Cat 15).
 *
 * Animation states (AC 60001 Sub-AC 1): 6 art frames total — 2 startup,
 * 1 active, 3 recovery. Stretch over the gameplay window via
 * `selectAnimationFrame()`:
 *   startup [0..4]  → art 0 (frames 0-2) → art 1 (frames 3-4)
 *   active  [5..7]  → art 0 throughout (single-frame hit pose)
 *   recovery[8..16] → art 0 (8-10) → art 1 (11-13) → art 2 (14-16)
 */
export const BEAR_JAB: AttackMoveWithAnimation = {
  id: 'bear.jab',
  type: 'jab',
  damage: 7,
  knockback: { x: 1.7, y: -0.5, scaling: 0.07 },
  hitbox: {
    // Authored facing-right; `Character` mirrors by facing on spawn.
    // Bear is 110 px wide — placing the hitbox 56 px out of his centre
    // puts the leading edge just past his shoulder. Close-quarters
    // grappler reach, not the long arm-extension Owl gets.
    offsetX: 28,
    offsetY: -4,
    width: 35,
    height: 30,
  },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 17,
  animation: {
    startupFrames: 2,
    activeFrames: 1,
    recoveryFrames: 3,
  },
  // Jab-combo opener: a re-press once jab1's hitbox is out advances to
  // jab2 → jab3 (the finisher). Tier 4. Mirrors the Wolf jab string.
  jabChain: { nextId: 'bear.jab2' },
};

/**
 * Bear's jab string — stage 2. A quick follow-up poke that chains from
 * {@link BEAR_JAB} on a re-press and itself links to the
 * {@link BEAR_JAB3} finisher. Registered as a `'jab'` move but never the
 * light slot (first-registered jab1 keeps it) — reachable ONLY via the
 * chain link. Damage ≈ jab1 × 0.7 (round(7 × 0.7) = 5), slightly softer
 * knockback than jab1, and a touch more forward reach (offsetX nudged
 * out) so the second poke pushes a hair further than the opener.
 */
export const BEAR_JAB2: AttackMoveWithAnimation = {
  id: 'bear.jab2',
  type: 'jab',
  damage: 5,
  knockback: { x: 1.5, y: -0.4, scaling: 0.06 },
  hitbox: { offsetX: 30, offsetY: -4, width: 35, height: 30 },
  startupFrames: 4,
  activeFrames: 2,
  recoveryFrames: 8,
  cooldownFrames: 15,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'bear.jab3' },
};

/**
 * Bear's jab string — finisher (stage 3). The launcher that ends the
 * string: more knockback + a base-magnitude floor so it pops the
 * opponent away even at low percent. Damage ≈ jab1 × 1.15
 * (round(7 × 1.15) = 8), a slightly wider hitbox, and slower committal
 * frames. No `jabChain` — the chain terminates here, and its
 * `cooldownFrames` is the post-string lockout.
 */
export const BEAR_JAB3: AttackMoveWithAnimation = {
  id: 'bear.jab3',
  type: 'jab',
  damage: 8,
  knockback: { x: 3.4, y: -1.7, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 32, offsetY: -4, width: 40, height: 33 },
  startupFrames: 6,
  activeFrames: 3,
  recoveryFrames: 15,
  cooldownFrames: 23,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Bear's forward tilt — the third grounded option after jab and smash
 * (AC 60001 Sub-AC 1). Mid-strength committal poke that fills the
 * spacing role between jab and smash, mirroring the Wolf / Cat / Owl
 * tilt contracts:
 *
 *   • Reach     : 64 px offset, 80×62 hitbox — longer than jab (56, 70)
 *                 but shorter than smash (76, 96). Trades hurtbox
 *                 extension for coverage; Bear is committed for ~8
 *                 startup frames before the hitbox spawns, and the
 *                 windup hurtbox sticks out a bit on the swing.
 *
 *                 Bear's tilt out-reaches Wolf's tilt (60 offset) by a
 *                 hair but falls short of Owl's (78 offset) — Bear pays
 *                 his reach gap with raw damage.
 *
 *   • Damage    : 10 — hardest tilt in the M2 cut (Wolf 8, Owl 7, Cat 5).
 *                 At ~70 % the knockback puts Cat into a tumble; smash
 *                 is still the finisher but a Bear tilt at high percent
 *                 is uniquely close to a KO threat among non-smash
 *                 grounded options.
 *
 *   • Knockback : x 2.3 / y -0.7, scaling 0.14. Stronger than jab's
 *                 0.07 scaling so the move opens KO percent later;
 *                 weaker than smash's 0.42 so it can't accidentally
 *                 end stocks during neutral exchanges.
 *
 *   • Frames    : 8 startup / 4 active / 13 recovery + 16 cooldown.
 *                 Lockout = 41 frames (~683 ms). Slower than jab
 *                 (34 frames) but faster than smash (61 frames). Bear's
 *                 tilt is the slowest tilt in the cast (Cat 28, Wolf 37,
 *                 Owl 34) — same reach gap, same damage spike, same
 *                 commitment cost.
 *
 * Animation states: 7 art frames total — 2 startup, 2 active, 3
 * recovery. The two active art frames let the swing show through the
 * hit window so it doesn't look like a single-frame freeze frame
 * (mirrors the rest of the cast's tilt animation budget):
 *   startup [0..7]   → art 0 (frames 0-3) → art 1 (frames 4-7)
 *   active  [8..11]  → art 0 (8-9) → art 1 (10-11)
 *   recovery[12..24] → art 0 (12-16) → art 1 (17-20) → art 2 (21-24)
 */
export const BEAR_TILT: AttackMoveWithAnimation = {
  id: 'bear.tilt',
  type: 'tilt',
  damage: 10,
  knockback: { x: 2.3, y: -0.7, scaling: 0.14 },
  hitbox: {
    offsetX: 32,
    offsetY: -5,
    width: 40,
    height: 31,
  },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 13,
  cooldownFrames: 16,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 3,
  },
};

/**
 * Bear's heavy attack — forward smash, the KO finisher and the apex of
 * the M2 cut's damage table. Hardest swing in the cast, paid for in the
 * longest startup window:
 *
 *   • Damage    : 16 — hardest smash in the M2 cut (Wolf 14, Owl 12,
 *                 Cat 9).
 *   • Knockback : x 4.5 / y -1.6, scaling 0.42. Higher scaling than
 *                 Wolf's smash (0.40) so it KOs at slightly lower
 *                 percent. Combined with the damage premium, Bear's
 *                 smash KOs Cat from centre stage at ~80 %; Wolf's
 *                 needs ~95 % for the same finish.
 *   • Frames    : 14 startup / 4 active / 19 recovery + 24 cooldown.
 *                 Lockout = 61 frames (~1017 ms). Slowest smash in the
 *                 cast (Cat 41, Owl 50, Wolf 56). Punish-the-whiff hard
 *                 if you read it wrong — even Cat can dash in and
 *                 throw a tilt during Bear's recovery.
 *
 * Animation states (AC 60001 Sub-AC 1): 8 art frames total — 3 startup,
 * 1 active, 4 recovery. The wind-up gets the most art frames so the
 * "anticipation" reads clearly to the opponent (a fair smash in the
 * canonical Smash idiom telegraphs its commitment). Recovery also gets
 * generous art frame budget so the "punished swing" pose holds long
 * enough to register visually:
 *   startup [0..13]  → art 0 (0-4) → art 1 (5-9)  → art 2 (10-13)
 *   active  [14..17] → art 0 throughout (the impact frame)
 *   recovery[18..36] → art 0 (18-22) → art 1 (23-27) → art 2 (28-32) → art 3 (33-36)
 */
export const BEAR_SMASH: AttackMoveWithAnimation = {
  id: 'bear.smash',
  type: 'smash',
  damage: 16,
  knockback: { x: 4.5, y: -1.6, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 16,
    maxDamage: 22.4,
    minKnockback: { x: 4.5, y: -1.6, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 6.3, y: -2.24, scaling: 0.525, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: {
    offsetX: 38,
    offsetY: -5,
    width: 48,
    height: 35,
  },
  startupFrames: 14,
  activeFrames: 4,
  recoveryFrames: 19,
  cooldownFrames: 24,
  animation: {
    startupFrames: 3,
    activeFrames: 1,
    recoveryFrames: 4,
  },
};

/**
 * Bear's neutral aerial — full-body slam (AC 60101 Sub-AC 1).
 *
 * The grappler's air-game identity is *committal power*: Bear's nair
 * is the slowest in the cast and the hardest-hitting. He doesn't
 * weave nair into pressure like Cat or wall it out for coverage like
 * Owl — he reads an opponent's approach and lands a heavy hit, or
 * eats the punish for guessing wrong. Largest active hitbox window
 * paired with the heaviest landing-lag.
 *
 *   • Damage    : 10 — hardest nair in the M2 cut (Cat 5, Owl 7,
 *                 Wolf 8). Aligns with Bear's "hardest swing in every
 *                 category" identity.
 *   • Knockback : x 1.9 / y -1.1, scaling 0.16.
 *                 Launch angle = atan2(1.1, 1.9) ≈ 30° up-and-forward
 *                 — slightly more horizontal than Wolf's nair (32°)
 *                 because Bear's mass means the target needs more
 *                 horizontal carry to clear his body before the
 *                 air-friction kicks in.
 *   • Frames    : 7 startup / 7 active / 14 recovery + 10 cooldown.
 *                 Lockout = 38 frames (~633 ms). Slowest startup of
 *                 the four nairs (Cat 3, Owl 4, Wolf 5).
 *   • Hitbox    : 0 px offset (body-centred), 120×130 sensor — Bear
 *                 is 110 px wide and 148 px tall, so a 120×130 hitbox
 *                 means the swing barely extends past his hurtbox in
 *                 either dimension. Big body, tight hitbox.
 *
 * Animation states: 8 art frames — 1 startup, 5 active, 2 recovery.
 * Active gets the most art frames so the body-slam reads as a
 * sustained slam rather than a freeze pose.
 *
 *   • landingLagFrames: 18 — the heaviest nair landing-lag in the
 *     cast (Cat 6, Owl 10, Wolf 12). Mirrors Bear's grappler
 *     archetype: every commitment costs more if he reads it wrong.
 *   • autoCancelWindows:
 *       - `[0, 6)` — pre-hitbox early-out (most of the startup).
 *       - No late window before busy ends — Bear's nair is
 *         committal-by-design.
 */
export const BEAR_NAIR: AerialMove = {
  id: 'bear.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 10,
  knockback: { x: 1.9, y: -1.1, scaling: 0.16 },
  hitbox: {
    offsetX: 0,
    offsetY: -2,
    width: 60,
    height: 65,
  },
  startupFrames: 7,
  activeFrames: 7,
  recoveryFrames: 14,
  cooldownFrames: 10,
  animation: {
    startupFrames: 1,
    activeFrames: 5,
    recoveryFrames: 2,
  },
  landingLagFrames: 18,
  autoCancelWindows: [{ startFrame: 0, endFrame: 6 }],
};

/**
 * Bear's forward aerial — overhead claw smash. The most damaging
 * fair in the M2 cut by a wide margin, and the only fair with KO
 * trajectory at low percent. Bear lobs his body weight into a
 * descending claw that sends the target down and forward — a "spike"
 * in the canonical Smash idiom, but mild enough that it doesn't
 * one-shot offstage.
 *
 *   • Damage    : 13 — hardest fair in the cast (Cat 6, Owl 8,
 *                 Wolf 11). Approaches grounded smash damage (16) at
 *                 the cost of needing the airspace to use it.
 *   • Knockback : x 2.6 / y -0.6, scaling 0.20.
 *                 Launch angle = atan2(0.6, 2.6) ≈ 13° up-and-forward
 *                 — flattest fair angle in the cast. KO trajectory
 *                 at the ledge.
 *   • Frames    : 11 startup / 4 active / 16 recovery + 12 cooldown.
 *                 Lockout = 43 frames (~717 ms). Slowest startup of
 *                 the four fairs (Cat 4, Owl 6, Wolf 8).
 *   • Hitbox    : 64 px offset, 88×80 sensor — short reach (Cat's fair
 *                 reaches further proportionally) but tall enough to
 *                 cover Bear's body height when he lobs forward.
 *
 * Animation states: 8 art frames — 3 startup, 1 active, 4 recovery.
 * Smash-style anticipation curve: long wind-up tells the opponent
 * "Bear is committing to a heavy hit", letting them try to dodge.
 *
 *   • landingLagFrames: 22 — heaviest fair landing-lag in the cast.
 *     A whiffed Bear fair on landing → Cat dashes in and lands a
 *     full smash before Bear recovers.
 *   • autoCancelWindows:
 *       - `[0, 6)` — pre-hitbox early-out.
 *       - No late window — fully committal.
 */
export const BEAR_FAIR: AerialMove = {
  id: 'bear.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 13,
  knockback: { x: 2.6, y: -0.6, scaling: 0.20 },
  hitbox: {
    offsetX: 32,
    offsetY: -3,
    width: 44,
    height: 40,
  },
  startupFrames: 11,
  activeFrames: 4,
  recoveryFrames: 16,
  cooldownFrames: 12,
  animation: {
    startupFrames: 3,
    activeFrames: 1,
    recoveryFrames: 4,
  },
  landingLagFrames: 22,
  autoCancelWindows: [{ startFrame: 0, endFrame: 6 }],
};

/**
 * Bear's back aerial — spinning back paw. The hardest single hit in
 * the air across the entire M2 cut — a smash-tier finisher that lives
 * in Bear's back. KOs Cat at centre stage at ~75 % and finishes Wolf
 * at ~100 %, which is one of the strongest ledge-guard tools in the
 * roster. Pays for it with the slowest startup of the four bairs.
 *
 *   • Damage    : 15 — hardest aerial in the M2 cut. Approaches the
 *                 ground smash (16) and exceeds the full-charge of
 *                 every other character's aerials.
 *   • Knockback : x 3.4 / y -1.3, scaling 0.36.
 *                 Launch angle = atan2(1.3, 3.4) ≈ 21° up-and-back —
 *                 same general trajectory as Wolf's bair (22°) but
 *                 at higher magnitude and stronger percent scaling.
 *   • Frames    : 13 startup / 4 active / 18 recovery + 14 cooldown.
 *                 Lockout = 49 frames (~817 ms). Slowest bair in the
 *                 cast (Cat 5, Owl 8, Wolf 10).
 *   • Hitbox    : 70 px offset, 96×72 sensor authored facing-right;
 *                 the runtime mirrors it on spawn so when Bear is
 *                 facing right and the player throws bair, the
 *                 hitbox spawns to his LEFT.
 *
 * Animation states: 8 art frames — 3 startup, 1 active, 4 recovery.
 * Mirrors his grounded smash anticipation curve so the heavy back-hit
 * telegraphs commitment with the same readability.
 *
 *   • landingLagFrames: 26 — the heaviest landing-lag in the entire
 *     M2 aerial cut. A whiffed Bear bair on landing is the most
 *     punishable mistake possible — Cat lands a smash, Wolf lands a
 *     bair of his own, Owl tilts at full reach. The grappler-
 *     archetype "commitment cost" lever cranked to maximum.
 *   • autoCancelWindows:
 *       - `[0, 7)` — pre-hitbox early-out (over half the startup).
 *       - No late window — fully committal-by-design.
 */
export const BEAR_BAIR: AerialMove = {
  id: 'bear.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 15,
  knockback: { x: 3.4, y: -1.3, scaling: 0.36 },
  hitbox: {
    offsetX: 35,
    offsetY: -3,
    width: 48,
    height: 36,
  },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 14,
  animation: {
    startupFrames: 3,
    activeFrames: 1,
    recoveryFrames: 4,
  },
  landingLagFrames: 26,
  autoCancelWindows: [{ startFrame: 0, endFrame: 7 }],
};

/**
 * Bear's up-smash — a rising two-paw uppercut (up-stick + heavy). The
 * grounded vertical KO finisher: Bear rears back and slams both paws
 * upward, launching a juggled opponent straight off the top blast zone.
 * Mirrors Wolf's up-smash role (`wolf.usmash`) but cranked to Bear's
 * grappler apex — hardest hit, slowest wind-up.
 *
 * Where it sits vs the rest of Bear's kit and Wolf's up-smash:
 *
 *   • Damage    : 18 — the single hardest swing in Bear's entire kit,
 *                 above his forward smash (16) and Wolf's up-smash (16).
 *                 A charged Bear up-smash under a juggled opponent is
 *                 the surest KO in the M2 cut.
 *   • Knockback : x 0.3 / y -3.8, scaling 0.44 with baseMagnitude 1.4 /
 *                 damageGrowth 0.5. Mirrors the KB *shape* of Bear's
 *                 forward smash (baseMagnitude 1.4, damageGrowth 0.5)
 *                 so the up-smash reads as "the smash button, pointed
 *                 up" — but with a near-pure-vertical launch (y -3.8)
 *                 and higher scaling (0.44 vs the forward smash's 0.42)
 *                 because a vertical KO needs more raw magnitude to
 *                 clear the (taller) top blast zone. Hardest vertical
 *                 launch in the cast.
 *   • Frames    : 15 startup / 4 active / 22 recovery + 24 cooldown.
 *                 Lockout = 65 frames (~1083 ms). Slower than his
 *                 forward smash (14 startup) and Wolf's up-smash (12) —
 *                 the grappler "slowest, hardest" lever on the vertical
 *                 KO move. Punish-the-whiff hard if you read it wrong.
 *   • Hitbox    : 0 px offset (body-centred column), 46×48 sensor pushed
 *                 up (offsetY -38) so the hit window sits above Bear's
 *                 head — catches a juggled opponent directly overhead.
 *                 Widest up-smash sensor in the cast (Wolf 40×44),
 *                 matching Bear's "big body, big swing" identity.
 *
 * Animation states: 8 art frames — 3 startup, 1 active, 4 recovery.
 * Mirrors Bear's forward-smash anticipation curve (long telegraphed
 * wind-up, generous punishable recovery) so the heavy vertical swing
 * reads with the same readability.
 */
export const BEAR_USMASH: AttackMoveWithAnimation = {
  id: 'bear.usmash',
  type: 'smash',
  damage: 18,
  knockback: { x: 0.3, y: -3.8, scaling: 0.44, baseMagnitude: 1.4, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 18,
    maxDamage: 25.2,
    minKnockback: { x: 0.3, y: -3.8, scaling: 0.44, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -5.32, scaling: 0.55, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 12, offsetY: -29, width: 75, height: 68 },
  startupFrames: 15,
  activeFrames: 4,
  recoveryFrames: 22,
  cooldownFrames: 24,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Bear's down-smash — a sweeping two-paw ground slam (down-stick + heavy).
 * The grappler's grounded HORIZONTAL KO finisher: Bear slams both paws
 * outward along the floor, covering a wide swath at his feet and sending
 * a grounded opponent low and outward toward the side blast zone.
 *
 * Mirrors the KB SHAPE of Bear's forward smash (`BEAR_SMASH`:
 * baseMagnitude 1.4, damageGrowth 0.5, scaling 0.42) so the down-smash
 * reads as "the smash button, pointed at the floor" — but with a flatter,
 * lower launch (y -1.0 vs the forward smash's -1.6) because the grounded
 * sweep sends outward-and-low, not up-and-out. Tuned to Bear's apex-power
 * heavyweight identity: hardest grounded horizontal KO in the cast, paid
 * for in the slowest grounded startup short of his up-smash.
 *
 *   • Reach     : offsetX 36, offsetY +10 (at the feet), 56×18 sensor —
 *                 the WIDEST grounded hit window in Bear's kit (his
 *                 forward smash is 48 wide), the canonical "sweep both
 *                 sides at the feet" down-smash footprint.
 *   • Damage    : 15 — just under his forward smash (16); the down-smash
 *                 is the slightly-cheaper-per-hit grounded KO that covers
 *                 a wider area.
 *   • Knockback : x 4.4 / y -1.0, scaling 0.42 with baseMagnitude 1.4 /
 *                 damageGrowth 0.5 (the forward smash's KB shape). KOs
 *                 Cat from centre stage at ~85 %.
 *   • Frames    : 13 startup / 4 active / 19 recovery + 24 cooldown.
 *                 Lockout = 60 frames (~1000 ms). Slow — between his
 *                 forward smash (14 startup) and tilt (8); punish-the-
 *                 whiff hard if you read it wrong.
 *
 * Animation states (8 art frames): 3 startup, 1 active, 4 recovery —
 * mirrors Bear's forward-smash anticipation curve so the heavy sweep
 * telegraphs commitment with the same readability.
 */
export const BEAR_DSMASH: AttackMoveWithAnimation = {
  id: 'bear.dsmash',
  type: 'smash',
  damage: 15,
  knockback: { x: 4.4, y: -1.0, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 15,
    maxDamage: 21,
    minKnockback: { x: 4.4, y: -1.0, scaling: 0.42, baseMagnitude: 1.4, damageGrowth: 0.5 },
    maxKnockback: { x: 6.16, y: -1.4, scaling: 0.525, baseMagnitude: 1.4, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 36, offsetY: 10, width: 56, height: 18 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 19,
  cooldownFrames: 24,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Bear's dash-attack — a forward lunging shoulder check (run + attack).
 * The grappler's running BURST approach / combo-starter: Bear throws his
 * mass forward at the end of a run, closing the gap his slow walk can't
 * and popping a grounded opponent up-and-forward into a juggle.
 *
 * `type: 'tilt'` (its forward slot is taken by `BEAR_TILT`, so it is
 * wired explicitly via `setDashAttack`). Weaker than a smash — a burst
 * approach tool, not a finisher — but harder than his jab, scaled to the
 * heavyweight's "every swing hits hard" identity.
 *
 *   • Reach     : offsetX 40 (forward — the lunge reaches past his
 *                 body), offsetY -3, 50×34 sensor. The most forward-
 *                 extended grounded hit window in Bear's kit, matching
 *                 the "travel into the hit" dash-attack feel.
 *   • Damage    : 11 — above his tilt (10), below his forward smash (16).
 *                 The hardest dash-attack feel scaled to the grappler.
 *   • Knockback : x 2.4 / y -1.4, scaling 0.18. Forward-AND-up launch
 *                 (atan2(1.4, 2.4) ≈ 30°) — pops the target into a juggle
 *                 above-and-ahead of Bear rather than launching them away,
 *                 the combo-starter trajectory.
 *   • Frames    : 8 startup / 4 active / 16 recovery + 14 cooldown.
 *                 Lockout = 42 frames (~700 ms). Medium startup —
 *                 slower than his jab (5) so the running commitment is
 *                 readable, faster than his smashes.
 *
 * Animation states (8 art frames): 2 startup, 2 active, 4 recovery —
 * the two active art frames let the lunge travel visibly through the hit
 * window; generous recovery so a whiffed dash-in is punishable.
 */
export const BEAR_DASHATTACK: AttackMoveWithAnimation = {
  id: 'bear.dashAttack',
  type: 'tilt',
  damage: 11,
  knockback: { x: 2.4, y: -1.4, scaling: 0.18 },
  hitbox: { offsetX: 40, offsetY: -3, width: 50, height: 34 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 16,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 4 },
};

/**
 * Bear's neutral special — **command grab** (AC 60201 Sub-AC 1).
 *
 * The grappler's special is a tight short-range grab that on connect
 * locks the victim in a hold and slams them with heavy launch
 * knockback. Slots Bear into the canonical "command grab" archetype
 * (Bowser's Flying Slam, Donkey Kong's Cargo Throw, King K. Rool's
 * Gut Check) — the move that punishes shielding opponents because
 * grabs ignore shield in Smash, and the move that makes Bear's "you
 * have to come close to me" identity feel inescapable up close.
 *
 * Mechanic:
 *   • Frames 8-13 of the move are the "grab attempt" (active phase).
 *     If the opening hitbox connects, the runtime transitions both
 *     fighters into a "hold" sub-state for `grabHoldFrames` frames.
 *   • During the hold the victim has no input authority. Bear's
 *     animation locks into the "holding" pose; the camera + HUD can
 *     register the grab.
 *   • On the throw release frame the victim takes `throwDamage` (16%)
 *     and is launched with `throwKnockback` (`(3.6, -1.4, 0.34)` —
 *     KO-grade trajectory).
 *   • A whiffed grab (no contact during the active window) plays out
 *     the move's full recovery — heavily punishable, the trade Bear
 *     pays for the unblockable opening.
 *
 *   • Damage    : 0 base — the move's own `damage` is zero. The throw
 *                 damage is applied on the release frame, not on the
 *                 active-phase contact frame.
 *   • Knockback : 0 base — same reason.
 *   • Frames    : 8 startup / 6 active / 22 recovery + 18 cooldown.
 *                 Lockout = 54 frames (~900 ms). Slow enough that the
 *                 opponent CAN whiff-punish it, fast enough that Bear
 *                 has a real read-tool against shielding.
 *
 * Animation states (8 art frames): 2 startup, 2 active, 4 recovery —
 * generous recovery so the punishable post-whiff pose holds visibly.
 *
 * Grab spec:
 *   • grabHoldFrames : 18 — ~300 ms of "I have you" pose. Long enough
 *                      to be theatrical, short enough that the throw
 *                      doesn't drag.
 *   • throwDamage    : 16 — matches Bear's grounded smash damage.
 *                      Hardest single-hit non-charge damage in his
 *                      kit; bear-archetype "if you let him close, he
 *                      ends your stock" payoff.
 *   • throwKnockback : (3.6, -1.4, 0.34) — almost identical magnitude
 *                      to Bear's smash. KO trajectory; KOs Cat from
 *                      centre stage at ~95%.
 *   • ignoresShield  : true — canonical Smash "grabs beat shield". The
 *                      future shield system reads this tag.
 *   • Hitbox         : 80×80 sensor 50 px in front — short reach,
 *                      tall hitbox so the grab catches both grounded
 *                      and short-hop opponents.
 */
export const BEAR_NEUTRAL_SPECIAL: CommandGrabSpecialMove = {
  id: 'bear.neutral_special',
  type: 'special',
  specialKind: 'commandGrab',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  // The opening grab hitbox IS the move's `hitbox` field (unlike
  // projectile / counter / charge where the move's own hitbox is
  // unused). On contact the runtime triggers the "hold then throw"
  // sequence rather than running the standard hit dispatch — see
  // `Character.tickAttack` (future sub-AC).
  hitbox: {
    // Bumped to match Bear's smash reach (offsetX 38, w 48); the
    // grab's opener was previously narrower than his basic, which
    // made the special feel under-tuned vs the smash button.
    offsetX: 38,
    offsetY: -5,
    width: 48,
    height: 44,
  },
  startupFrames: 8,
  activeFrames: 6,
  recoveryFrames: 22,
  cooldownFrames: 18,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 4,
  },
  grab: {
    grabHoldFrames: 18,
    // Throw damage bumped above Bear's smash (16) so the grab
    // payoff clearly outclasses the basic-attack tier.
    throwDamage: 22,
    throwKnockback: { x: 4.2, y: -1.7, scaling: 0.40 },
    ignoresShield: true,
  },
};

/**
 * Bear's side special — **command dash** (AC 60302 Sub-AC 2).
 *
 * The grappler's side-special is the canonical "Bowser Side-B / Flying
 * Slam" archetype — Bear lunges forward at fixed velocity with a grab
 * hitbox at the head of the dash. Slots Bear into the "approach grab"
 * niche on the side+special press: he closes gaps that his slow walk
 * can't normally cover, and on connect locks the victim into a hold +
 * throw that pays off bigger than his neutral command grab.
 *
 * Mechanic:
 *   • On press, the move enters startup. At the start of the active
 *     window the runtime overrides Bear's velocity to
 *     `(facing * dashSpeed, 0)` and holds it for `dashFrames` frames.
 *   • The opening grab hitbox spawns on the active phase's first frame
 *     and tracks Bear's body. On contact with a fighter the runtime
 *     transitions both into a `grabHoldFrames`-length hold + throw
 *     sequence (mirroring Bear's neutral command grab).
 *   • On the throw release frame the victim takes `throwDamage = 18`
 *     and is launched with `throwKnockback` (`(3.8, -1.5, 0.36)` —
 *     KO-grade trajectory; harder than Bear's neutral command grab so
 *     the side variant is the bigger-payoff close-the-gap option).
 *   • `ignoresShield = true` — canonical "grabs beat shield" Smash rule.
 *   • A whiffed dash (no grab connection during the active window) plays
 *     out the long recovery and Bear is committal-helpless until he
 *     touches ground, mirroring the canonical Bowser Side-B punishment.
 *     `helplessOnWhiff = true`.
 *
 *   • Damage    : 0 base — the move's own `damage` is zero. Throw
 *                 damage is applied on the release frame.
 *   • Knockback : 0 base — same reason.
 *   • Frames    : 8 startup / 10 active / 24 recovery + 28 cooldown.
 *                 Lockout = 70 frames (~1167 ms). The slowest side-
 *                 special in the cast — pays for the grappler's
 *                 outsized payoff.
 *
 * Animation states (8 art frames): 2 startup, 2 active, 4 recovery —
 * generous recovery so the punishable post-whiff "Bear flopped on the
 * ground" pose holds visibly.
 *
 * CommandDash spec:
 *   • dashSpeed = 14 — slower than Wolf's dashStrike (18) but covers
 *     ground meaningfully faster than Bear's max run speed (6.0). The
 *     bear-archetype "I'll close the gap whether you like it or not"
 *     read.
 *   • dashFrames = 8 — the dash velocity holds for 8 frames (= 80 % of
 *     the 10-frame active window). Travel distance ≈ 14 * 8 = 112 px.
 *   • grabHoldFrames = 22 — slightly longer than Bear's neutral command
 *     grab (18) so the throw feels more theatrical.
 *   • throwDamage = 18 — exceeds Bear's neutral command grab (16) AND
 *     his grounded smash (16). Hardest single-hit damage in his kit.
 *   • throwKnockback = (3.8, -1.5, scaling 0.36) — KO trajectory that
 *     beats his neutral command grab's `(3.6, -1.4, 0.34)`. KOs Cat at
 *     ~85 % from centre stage.
 *   • ignoresShield = true.
 *   • helplessOnWhiff = true.
 *   • Hitbox: 70×80 sensor 60 px in front — the opening grab hitbox.
 *     Reaches further than Bear's neutral command grab (50 px offset)
 *     because the dash is supposed to travel.
 */
export const BEAR_SIDE_SPECIAL: CommandDashSideSpecialMove = {
  id: 'bear.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'commandDash',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  // The opening grab hitbox IS the move's `hitbox` field. On contact
  // the runtime triggers the "hold then throw" sequence rather than
  // running the standard hit dispatch — same shape as Bear's neutral
  // command grab, but with the dash travel baked in.
  hitbox: {
    offsetX: 30,
    offsetY: -4,
    width: 35,
    height: 40,
  },
  startupFrames: 8,
  activeFrames: 10,
  recoveryFrames: 24,
  cooldownFrames: 28,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 4,
  },
  commandDash: {
    dashSpeed: 14, // ≈ 840 px/s — faster than Bear's max run (360 px/s)
    dashFrames: 8, // 80 % of the active window
    grabHoldFrames: 22,
    throwDamage: 18,
    throwKnockback: { x: 3.8, y: -1.5, scaling: 0.36 },
    ignoresShield: true,
    helplessOnWhiff: true,
  },
};

/**
 * Bear's up special — **tether** (AC 60202 Sub-AC 2).
 *
 * The grappler's recovery is a *line-extends, line-retracts* — Bear
 * fires a hookshot/grapple line out in his facing direction; if the
 * line touches a stage ledge (or another fighter) it latches and
 * Bear is reeled toward the contact point. Mirrors the canonical
 * Smash tether-recovery archetype (Olimar's Up-B with a Pikmin chain,
 * Link / Young Link's hookshot, Samus's grapple beam, Lucas's PK
 * Thunder-into-rope-snake on tether characters).
 *
 * Recovery characteristics:
 *   • maxRange = 320 px — long horizontal reach. The longest single-
 *     direction recovery anchor in the cast.
 *   • extensionSpeed = 32 px/step — line extends at ≈ 1920 px/s. Fast
 *     enough to feel "shot out", not so fast the player can't time it.
 *   • extensionFrames = 10 — line reaches max extension in 10 frames
 *     (= maxRange / extensionSpeed = 320 / 32). Validated by the
 *     schema: `extensionSpeed * extensionFrames === maxRange`.
 *   • reelSpeed = 28 px/step — slightly slower than extension (the
 *     "I caught it, now I'm pulling myself up" feel).
 *   • reelFrames = 30 — half-second cap on the reel. Even from max
 *     range (320 px) at 28 px/step, the reel completes in
 *     ⌈320/28⌉ = 12 frames; the 30-frame cap is the safety net for
 *     latches into moving targets.
 *   • lineWidth = 8 px — thin sensor for the line body.
 *
 * Combat characteristics:
 *   • The move's own `damage` / `knockback` are zero — the standard
 *     "no contact, no hit" idiom.
 *   • A whiffed extension (no contact during the active window) drops
 *     Bear back into normal physics during the long recovery — a
 *     whiffed tether off-stage is canonically a stock loss, the
 *     trade-off for the long reach.
 *   • A successful tether-tip catch on a fighter (rare — usually the
 *     line catches a ledge) deals `tetherTipDamage = 4` and applies
 *     `tetherTipKnockback = (1.6, -0.4, scaling 0.08)` — forward and
 *     slightly up so the caught target is pulled into Bear's reel
 *     trajectory.
 *
 *   • Frames    : 6 startup / 10 active / 30 recovery + 16 cooldown.
 *                 Lockout = 62 frames (~1033 ms). Active = the
 *                 extension window; recovery covers the retract / reel.
 *
 * Animation states (8 art frames): 1 startup, 3 active, 4 recovery —
 * generous recovery so the punishable post-whiff "Bear hanging off a
 * line" pose holds visibly.
 *
 * Hitbox geometry: a degenerate sensor on the move record itself —
 * the runtime branches on `upSpecialKind === 'tether'` and spawns
 * its own line body using the `tether.lineWidth` and `tether.maxRange`
 * fields directly.
 */
export const BEAR_UP_SPECIAL: TetherUpSpecialMove = {
  id: 'bear.up_special',
  type: 'upSpecial',
  upSpecialKind: 'tether',
  // No on-press damage / knockback. The (rare) tether-tip-catches-
  // fighter case uses `tether.tetherTipDamage` / `tetherTipKnockback`
  // instead.
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  // Degenerate hitbox — the runtime branches on `upSpecialKind` first
  // and spawns the line body itself.
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 6,
  activeFrames: 10,
  recoveryFrames: 30,
  cooldownFrames: 16,
  animation: {
    startupFrames: 1,
    activeFrames: 3,
    recoveryFrames: 4,
  },
  tether: {
    maxRange: 320, // = extensionSpeed * extensionFrames
    extensionSpeed: 32, // ≈ 1920 px/s line growth
    extensionFrames: 10, // = activeFrames; line reaches max at end of active
    reelSpeed: 28, // slightly slower than extension
    reelFrames: 30, // half-second cap
    tetherTipDamage: 4, // small bonus for catching a fighter mid-extension
    tetherTipKnockback: { x: 1.6, y: -0.4, scaling: 0.08 },
    lineWidth: 8,
  },
};

/**
 * Bear's down special — **counter** (AC 60304 Sub-AC 4).
 *
 * The grappler's down-special is a *plant-and-parry* — Bear plants
 * himself, opens a parry window, and on a successful catch unleashes
 * a heavy upward retaliation. Mirrors the canonical Smash down-B
 * counter archetype (Marth's Counter, Lucina's Counter, Lucario's
 * Double Team — each a distinct down-B in the canon). Slots Bear into
 * the "I read your swing, eat the launch" niche on the down+special
 * press, complementing his neutral commandGrab (proactive grab),
 * side commandDash (approach grab), and up tether (recovery hookshot)
 * with a *defensive read* tool.
 *
 * Why a counter for Bear when Wolf already has a counter on his
 * neutral-special: the discriminator string ('counter') is identical
 * across the two schemas (`NeutralSpecialMove` vs `DownSpecialMove`),
 * but the in-game *feel* is meaningfully different:
 *
 *   • Wolf's neutral counter is FAST (5/12 windows, 1.3× multiplier)
 *     and HORIZONTAL (knockback (4.0, -1.6)) — a quick read for a
 *     side-launch.
 *   • Bear's down counter is SLOW (6/14 windows, 1.5× multiplier) and
 *     VERTICAL (knockback (2.0, -3.5)) — a committed read for an
 *     uppercut launch that puts the opponent into a juggle position
 *     above Bear.
 *
 * The two characters' counters cover different counter-play scenarios
 * even though they share the discriminator. The runtime can route both
 * through the same counter-handler logic (the `counter` field is
 * structurally identical across `NeutralSpecialCounterSpec` and
 * `DownSpecialCounterSpec`); the gameplay distinction is purely in the
 * authored numbers.
 *
 * Mechanic:
 *   • Frames 6-19 of the move are the parry window (= the entire
 *     active phase). During those frames Bear is invincible AND
 *     latches the next incoming hit.
 *   • On a successful catch, the runtime spawns a retaliation hitbox
 *     in front of Bear. Damage = `clamp(absorbed * 1.5, 12, 28)` —
 *     higher floor and ceiling than Wolf's counter (8/22), reflecting
 *     Bear's grappler "all-or-nothing" archetype.
 *   • Knockback is fixed at the `counterKnockback` vector — a heavy
 *     upward launch that puts the absorbed-hit attacker into a juggle
 *     trajectory directly above Bear, where his nair / fair are at
 *     their most threatening.
 *   • A whiffed counter (no incoming hit during the window) plays out
 *     the full move including a long recovery — heavily punishable on
 *     a misread.
 *
 *   • Damage    : 0 base — the move's own hitbox is unused (counter has
 *                 no proactive hit; the retaliation hit comes from the
 *                 `counter` block on a catch).
 *   • Knockback : 0 base — same reason.
 *   • Frames    : 6 startup / 14 active / 22 recovery + 26 cooldown.
 *                 Lockout = 68 frames (~1133 ms). Significantly slower
 *                 than Wolf's counter (59 frames lockout) — the
 *                 grappler trade: fewer attempts per match, harder
 *                 payoff if you land it.
 *
 * Animation states (8 art frames): 1 startup, 4 active, 3 recovery —
 * the active phase gets the most art frames so the parry pose holds
 * through the full window for visual readability (mirrors Wolf's
 * counter animation pattern).
 *
 *   counterWindowStart = 6  (= move.startupFrames; parry begins as
 *                            active phase begins)
 *   counterWindowEnd   = 20 (= startupFrames + activeFrames)
 *   damageMultiplier   = 1.5  (heavier than Wolf's 1.3)
 *   minCounterDamage   = 12   (higher floor than Wolf's 8)
 *   maxCounterDamage   = 28   (higher ceiling than Wolf's 22)
 *   counterKnockback   = (2.0, -3.5, scaling 0.40) — vertical KO
 *   counterHitbox      = 100×80 sensor 60 px in front
 */
export const BEAR_DOWN_SPECIAL: CounterDownSpecialMove = {
  id: 'bear.down_special',
  type: 'downSpecial',
  downSpecialKind: 'counter',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  // Move's own hitbox is unused (counter has no proactive hit).
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 6,
  activeFrames: 14,
  recoveryFrames: 22,
  cooldownFrames: 26,
  animation: {
    startupFrames: 1,
    activeFrames: 4,
    recoveryFrames: 3,
  },
  counter: {
    counterWindowStart: 6, // = startupFrames
    counterWindowEnd: 20, // = startupFrames + activeFrames
    damageMultiplier: 1.5, // heavier than Wolf's 1.3
    minCounterDamage: 12, // higher floor than Wolf's 8
    maxCounterDamage: 28, // higher ceiling than Wolf's 22
    counterKnockback: { x: 2.0, y: -3.5, scaling: 0.40 }, // vertical KO trajectory
    counterHitbox: {
      offsetX: 60,
      offsetY: -12,
      width: 100,
      height: 80,
    },
  },
};

// ---------------------------------------------------------------------------
// AC 2 Sub-AC 2 — per-fighter scaffolding for the T2 refactor.
//
// The Bear class below now declares the canonical 10-slot contract surface
// (`moveset` + `movementProfile` + `contract`) plus a stub method per slot.
// The exports here are the data those properties point at. Both the
// per-move attack records (already shipped) and the stubs (intentionally
// no-op) are PURE additions: the existing `registerAttack` calls in the
// constructor remain so the runtime keeps dispatching exactly as before.
// Subsequent sub-ACs of the T2 refactor track migrate the per-slot
// attack-execution code out of `Character` and into the stub methods on
// each fighter, then plumb `Character` to read the moveset off
// `this.moveset` instead of the legacy `attacks` map.
// ---------------------------------------------------------------------------

// Sub-AC 2.2 of the T2 refactor — `BEAR_MOVEMENT_PROFILE` is now
// imported from (and re-exported at the top of) this file; the literal
// data lives in `fighterMovementProfiles.ts` so the shared `Character`
// base can resolve per-fighter movement values without a circular
// import on the per-fighter class. `BEAR_TUNING` above composes its
// movement-relevant fields by spreading `BEAR_MOVEMENT_PROFILE`, so
// the per-fighter file remains the canonical view onto Bear's stats —
// no behavioural change vs. the previous in-file declaration.

/**
 * Bear's full 10-slot uniform moveset (Sub-AC 2 of T2 refactor).
 *
 * Composes the existing per-move exports — already authored above for
 * the AC 60001 Sub-AC 1 / AC 60201 Sub-AC 1 / AC 60302 Sub-AC 2 /
 * AC 60202 Sub-AC 2 / AC 60304 Sub-AC 4 work — into the canonical
 * {@link FighterMoveset} shape declared by {@link movesetContract}.
 *
 * Defensive slots use the shared {@link SHIELD_DEFAULTS} /
 * {@link DODGE_DEFAULTS} until a per-character defensive balance pass
 * lands. The follow-up sub-AC migrates `Character`'s runtime to
 * consume this record directly; until then the constructor still
 * calls `registerAttack(...)` so existing dispatch keeps working.
 */
/**
 * Bear's grab — the GRAPPLER's signature standing grab: long reach, the
 * hardest throws in the cast, and a heavy pummel. Fits his whole identity
 * (his neutral + side specials are command grabs too).
 */
export const BEAR_GRAB: GrabSpec = {
  id: 'bear.grab',
  hitbox: { offsetX: 30, offsetY: -2, width: 30, height: 34 },
  startupFrames: 8,
  activeFrames: 2,
  whiffRecoveryFrames: 34,
  holdFramesMax: 96,
  throwRecoveryFrames: 25,
  pummel: { damage: 2.2, cooldownFrames: 14 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 11, knockback: { x: 3.0, y: -1.1, scaling: 0.13 }, animationFrames: 23 },
    back: { damage: 13, knockback: { x: 3.4, y: -1.3, scaling: 0.15 }, animationFrames: 27 },
    up: { damage: 10, knockback: { x: 0.5, y: -3.4, scaling: 0.13 }, animationFrames: 17 },
    down: { damage: 8, knockback: { x: 1.0, y: 1.3, scaling: 0.1 }, animationFrames: 18 },
  },
};

export const BEAR_MOVESET: FighterMoveset = Object.freeze({
  jab: BEAR_JAB,
  tilt: BEAR_TILT,
  smash: BEAR_SMASH,
  fair: BEAR_FAIR,
  neutralSpecial: BEAR_NEUTRAL_SPECIAL,
  sideSpecial: BEAR_SIDE_SPECIAL,
  upSpecial: BEAR_UP_SPECIAL,
  downSpecial: BEAR_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Bear's full {@link FighterContract} declaration (Sub-AC 2 of T2 refactor).
 * Identity + 10-slot moveset + movement profile in one record so a
 * consumer (test harness, AI predictor, balance tooling) can grab the
 * complete per-fighter declaration off a single import.
 */
export const BEAR_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'bear',
  moveset: BEAR_MOVESET,
  movementProfile: BEAR_MOVEMENT_PROFILE,
});

/** Bear-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface BearOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Bear fighter. Inherits all base movement / jump physics from
 * `Character`; ships with grappler-tuned stats and the AC 60001 Sub-AC 1
 * grounded triplet (jab / tilt / smash). Subsequent sub-ACs add Bear's
 * neutral aerial, directional aerials, and his specials, mirroring the
 * AC-60002/3/4 cadence used for the rest of the roster.
 *
 * Sub-AC 2 of the T2 refactor: this class now exposes the canonical
 * {@link FighterContract} surface ({@link moveset}, {@link movementProfile},
 * {@link contract}) and per-slot stub methods (`executeJab` …
 * `executeDodge`). The stubs are intentionally no-op for now;
 * subsequent sub-ACs of the T2 refactor migrate the per-slot
 * attack-execution code out of {@link Character} and into these stubs.
 * Because the constructor still calls `registerAttack(...)` for every
 * move, the runtime continues dispatching through the legacy slot
 * table exactly as before — no behavioural change.
 */
export class Bear extends ContractFighter {
  /**
   * Bear's 10-slot uniform moveset surface (Sub-AC 2 of T2 refactor).
   * Points at the frozen {@link BEAR_MOVESET} table — every consumer
   * that wants to inspect the full per-fighter kit (AI predictor,
   * replay HUD, balance tooling) can do so via this property without
   * re-deriving the per-move map from `registerAttack` results.
   */
  readonly moveset: FighterMoveset = BEAR_MOVESET;

  /**
   * Bear's per-fighter movement parameters (Sub-AC 2 of T2 refactor).
   * Mirrors {@link BEAR_MOVEMENT_PROFILE}. The follow-up sub-AC plumbs
   * `Character`'s movement loop to read off this property.
   */
  readonly movementProfile: FighterMovementProfile = BEAR_MOVEMENT_PROFILE;

  /**
   * Full per-fighter declaration (Sub-AC 2 of T2 refactor) — identity +
   * moveset + movement profile, exposed as a single read-only record
   * for consumers that want one handle to the whole contract.
   */
  readonly contract: FighterContract = BEAR_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: BearOptions) {
    super(scene, {
      id: 'bear',
      // Apply Bear's tuning as the floor; caller-supplied options
      // (e.g. test-only mass overrides) win over the defaults via the
      // base class's spread merge.
      ...BEAR_TUNING,
      ...options,
    });
    // Registration order: jab first so it auto-fills both the light
    // dispatch slot AND the legacy `defaultAttackId` fallback. Tilt
    // registers second — the base class's "first 'jab'/'tilt' wins
    // the light slot" rule keeps jab as the press-attack default; the
    // tilt is reachable via `attemptAttack('bear.tilt')` (input layer
    // lights it up on a stick-direction + attack press in a future
    // sub-AC). Smash populates the heavy dispatch slot. Aerials and
    // specials land in later sub-ACs alongside the rest of the M2
    // roster expansion.
    registerFighterAttack(this, BEAR_JAB);
    // Jab-string stages 2/3 — registered as 'jab' moves but jab1 keeps
    // the light slot via first-registered-wins. Reachable only via the
    // jabChain link off BEAR_JAB. Mirrors the Wolf jab string.
    registerFighterAttack(this, BEAR_JAB2);
    registerFighterAttack(this, BEAR_JAB3);
    registerFighterAttack(this, BEAR_TILT);
    registerFighterAttack(this, BEAR_SMASH);
    // Aerials — registered in the canonical nair → fair → bair order
    // so `findMoveByType(spec, 'aerial')` resolves to BEAR_NAIR (the
    // first 'aerial'-typed move) the way the M2 cast contract expects.
    // AC 60005 Sub-AC 5: completes Bear's move table to the full 8-
    // entry shape (grounded triplet + 3 aerials + 2 specials), closing
    // out the Seed's "4 characters with full movesets" milestone.
    registerFighterAttack(this, BEAR_NAIR);
    registerFighterAttack(this, BEAR_FAIR);
    registerFighterAttack(this, BEAR_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt / up-smash are
    // type 'tilt'/'smash' (their forward slots are taken by BEAR_TILT /
    // BEAR_SMASH), so wire the dedicated up slots explicitly via
    // setUpTilt / setUpSmash. The up-air / down-air / up-tilt records
    // are re-used from `extendedMoves.ts` (BEAR_UAIR / BEAR_DAIR /
    // BEAR_UP_LIGHT); only the up-smash (BEAR_USMASH) is authored inline.
    registerFighterAttack(this, BEAR_UAIR);
    registerFighterAttack(this, BEAR_DAIR);
    registerFighterAttack(this, BEAR_UP_LIGHT);
    registerFighterAttack(this, BEAR_USMASH);
    this.setUpTilt(BEAR_UP_LIGHT.id);
    this.setUpSmash(BEAR_USMASH.id);
    // Down + dash grounded normals. All three are type 'tilt'/'smash'
    // whose forward slots are already taken by BEAR_TILT / BEAR_SMASH,
    // so they must be wired into their dedicated slots explicitly via
    // setDownTilt / setDownSmash / setDashAttack (mirroring the up-tilt /
    // up-smash wiring above). The down-tilt re-uses BEAR_DOWN_LIGHT from
    // `extendedMoves.ts` (the low feet-poke combo-starter); the down-
    // smash (BEAR_DSMASH, the wide grounded horizontal KO sweep) and the
    // dash-attack (BEAR_DASHATTACK, the running shoulder-check approach
    // burst) are authored inline above.
    registerFighterAttack(this, BEAR_DOWN_LIGHT);
    registerFighterAttack(this, BEAR_DSMASH);
    registerFighterAttack(this, BEAR_DASHATTACK);
    this.setDownTilt(BEAR_DOWN_LIGHT.id);
    this.setDownSmash(BEAR_DSMASH.id);
    this.setDashAttack(BEAR_DASHATTACK.id);
    this.setGrabSpec(BEAR_GRAB);
    // Neutral special — command grab (AC 60201 Sub-AC 1). Auto-fills
    // the `neutralSpecialId` dispatch slot via `registerAttack`'s
    // type-based slot wiring.
    registerFighterAttack(this, BEAR_NEUTRAL_SPECIAL);
    // Side special — command dash (AC 60302 Sub-AC 2). Registered as a
    // `'sideSpecial'`-typed move so `findMoveByType(spec, 'sideSpecial')`
    // resolves it cleanly. Bear's side-special: a forward lunge with a
    // grab hitbox at its head that pays off harder than his neutral
    // command grab on connect, the canonical grappler "approach grab".
    registerFighterAttack(this, BEAR_SIDE_SPECIAL);
    // Up special — tether (AC 60202 Sub-AC 2). Auto-fills the
    // `upSpecialId` dispatch slot via `registerAttack`'s type-based
    // slot wiring. Bear's recovery option: extend a hookshot line in
    // his facing direction and reel himself toward a contact point.
    registerFighterAttack(this, BEAR_UP_SPECIAL);
    // Down special — counter (AC 60304 Sub-AC 4). Auto-fills the
    // `downSpecialId` dispatch slot via `registerAttack`'s type-based
    // slot wiring. Bear's defensive-read tool: parry an incoming hit
    // and answer with a heavy upward-launching retaliation. Tuned with
    // a higher damage multiplier (1.5×) and a vertical-KO trajectory
    // — different flavour from Wolf's neutral counter.
    registerFighterAttack(this, BEAR_DOWN_SPECIAL);
  }

  /**
   * Bear's GET-UP ATTACK — a wide, heavy two-sided wake-up swat. Tuned to
   * the grappler archetype: the cast's heaviest/widest body (width 55) gets
   * the widest, slightly stronger get-up sweep, paid for with a marginally
   * slower active window. Still a weak utility pop-away, NOT a KO move.
   *
   *   • Damage    : 8 — toward the top of the utility band (base 6), the
   *                 heavyweight "every swing hits hard" lean.
   *   • Knockback : x 4.4 / y -3.0, scaling 0.13 — pops the opponent away a
   *                 touch harder than base (4 / -3 / 0.12); still low-mag.
   *   • Hitbox    : offsetX 0 (two-sided), width 110 ≈ 2.0× body width (55),
   *                 the widest get-up sweep in the cast; height 44 to cover
   *                 his tall brick body. offsetY 0 — centred low sweep.
   *   • Active    : 7 frames — one above base (6); the big swing lingers a
   *                 hair longer, matching Bear's committal feel.
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 8,
      knockback: { x: 4.4, y: -3, scaling: 0.13 },
      hitbox: { offsetX: 0, offsetY: 0, width: 110, height: 44 },
      activeFrames: 7,
    };
  }

  /**
   * Bear's LEDGE ATTACK — a forward edge-clearing paw swing climbing back
   * onto the stage. Scaled to the heavyweight: wider/slightly harder than
   * base, reaching forward over the ledge corner up onto the stage. Still a
   * weak utility pop-away, NOT a KO move.
   *
   *   • Damage    : 9 — top of the utility band (base 8), the grappler
   *                 damage premium without crossing into KO strength.
   *   • Knockback : x 4.2 / y -2.4, scaling 0.15 — a hair above base
   *                 (4 / -2.4 / 0.14); pushes the edge-camper away, low-mag.
   *   • Hitbox    : offsetX 14 (forward, over the ledge corner onto stage),
   *                 offsetY -2, width 92 (wider than base 84 for his big
   *                 swing), height 64 to cover the climb arc.
   *   • Active    : 8 frames — same as base; a deliberate forward swing.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 9,
      knockback: { x: 4.2, y: -2.4, scaling: 0.15 },
      hitbox: { offsetX: 14, offsetY: -2, width: 92, height: 64 },
      activeFrames: 8,
    };
  }


  // Per-slot execute hooks (executeJab … executeDodge) are inherited
  // from ContractFighter, which fires each slot via the frozen
  // `moveset` declaration above — the slot ↔ move mapping lives in
  // the data table, not in per-fighter method boilerplate.
}
