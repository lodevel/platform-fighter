/**
 * Wolf — first concrete fighter subclass (AC 202 Sub-AC 2; expanded for
 * AC 203 Sub-AC 3.3 and AC 60002 Sub-AC 2 — full grounded triplet
 * jab / tilt / smash with animation states).
 *
 * Role: bruiser. Heavier than the roster average, hits hard, but pays
 * for it with slower top speed and committal recovery on his moves.
 * Mirrors the "Wolf bruiser" archetype called out in the project Seed.
 *
 * Stats (vs `DEFAULT_CHARACTER_TUNING`):
 *
 *   maxRunSpeed   7.5    (▼)  slower than baseline 8 — bruisers don't
 *                              chase as fast as ninjas
 *   groundAccel   0.65   (▼)  takes a beat to get going
 *   airAccel      0.30   (▼)  hard to redirect mid-air
 *   jumpImpulse   12.5   (▼)  shorter hop than baseline 13
 *   maxJumps      2            standard double-jump
 *   width / height 100×100     larger silhouette → larger hurtbox.
 *                              Square body matches the 64×64 wolf sprite-
 *                              frame aspect (1.5625× uniform display
 *                              scale) so the rendered silhouette fits
 *                              the hurtbox without per-axis stretch.
 *                              Re-tuned in AC 10404 Sub-AC 4 to align
 *                              with the real wolf sprite (64×64 cells
 *                              in `assets/characters/wolf/frames.json`)
 *                              instead of the legacy placeholder
 *                              rectangle (100×140); AC 10403 Sub-AC 3
 *                              re-verified the retune with explicit
 *                              hitbox-vs-sprite-frame invariants in
 *                              `characterSpec.test.ts`.
 *   mass          16    (▲)   33 % heavier — resists knockback
 *
 * Moveset (full grounded triplet + neutral aerial):
 *
 *   Jab   (`wolf.jab`,   light)  damage 6, fast neutral poke (6 art frames)
 *   Tilt  (`wolf.tilt`,  light)  damage 8, mid-range committal poke (7 art frames)
 *   Smash (`wolf.smash`, heavy)  damage 14, KO finisher (8 art frames)
 *   Nair  (`wolf.nair`,  aerial) damage 8, sphere-style hitbox in the air
 *
 * Why a tilt distinct from jab and smash:
 *   • Jab is the safe poke — fastest startup, low damage, low knockback.
 *   • Tilt is the *spacing* tool — longer reach than jab, harder hit,
 *     more committal recovery. Used to control neutral when the
 *     opponent respects jab range; trades hurtbox extension for
 *     coverage. The "third grounded option" in the canonical Smash
 *     toolkit.
 *   • Smash is the KO finisher — biggest reach, hardest knockback
 *     scaling, longest startup so it punishes whiff-prone opponents.
 *
 * Animation frames: each grounded move declares a per-phase art-frame
 * count (`MoveAnimation`) inside the Seed-mandated 6-8 range. The
 * gameplay state machine drives the renderer through
 * `selectAnimationFrame(framesElapsed, move)` so the displayed art
 * frame and the live hitbox phase are always in lockstep — no
 * possibility of an animation-vs-hitbox phase drift.
 *
 *   Jab    : 2 startup + 1 active + 3 recovery = 6 art frames
 *   Tilt   : 2 startup + 2 active + 3 recovery = 7 art frames
 *   Smash  : 3 startup + 1 active + 4 recovery = 8 art frames
 *
 * The (later AC) sprite atlas pipeline will register textures keyed
 * `wolf.jab.startup.0`, `wolf.jab.active.0`, etc.; until then the
 * renderer paints flat-colour rectangles and the animation indices
 * exist purely as state-machine drivers ready for the asset drop.
 *
 * Why these numbers are encoded as exported `const`s:
 *   • Tests can assert exactly what stats Wolf ships with.
 *   • The (later AC) move-editor and balance-pass tooling can mutate
 *     these tables without recompiling the class.
 *   • Composing fighters from data tables is the M2 roster pattern —
 *     Cat / Owl / Bear follow the same shape so a roster-comparison
 *     tool can render them side-by-side.
 */

import type Phaser from 'phaser';
import { ContractFighter } from './contractFighter';
import { Character, type CharacterTuning } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AttackMove } from './attacks';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';
import type { CounterSpecialMove } from './specialSchema';
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
import { WOLF_MOVEMENT_PROFILE } from './fighterMovementProfiles';

// Re-export so consumers that historically imported `WOLF_MOVEMENT_PROFILE`
// from this file (the per-fighter API surface) keep working byte-for-byte.
// Sub-AC 2.2 of the T2 refactor moved the literal data into the
// `fighterMovementProfiles` leaf module so the shared `Character` base
// can resolve per-fighter movement values at construction time without
// pulling in a per-fighter class (which would trigger the
// `class Wolf extends Character` cyclic-init TDZ). The per-fighter file
// remains the natural import location for "Wolf's stats" while the
// architectural source of truth lives in one indexable place.
export { WOLF_MOVEMENT_PROFILE };

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 *
 * The `shield` slot is intentionally omitted (covered by AC 60301
 * Sub-AC 1's canonical `SHIELD_DEFAULTS`); a per-character shield
 * balance pass would land here later.
 */
export const WOLF_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  // Sub-AC 2.2 of the T2 refactor — movement-relevant fields composed
  // from `WOLF_MOVEMENT_PROFILE` (the per-fighter movement profile —
  // single source of truth in `fighterMovementProfiles.ts`). Body
  // geometry (`width` / `height` / `chamfer`) and `mass` overrides
  // remain inline below because they're hurtbox / collision data on
  // the construction-side, not movement parameters per the
  // {@link FighterMovementProfile} JSDoc — except `mass`, which IS on
  // the movement profile (knockback resistance) and is therefore
  // sourced from the spread.
  ...WOLF_MOVEMENT_PROFILE,
  // AC 10404 Sub-AC 4 — body footprint re-tuned to match the real wolf
  // sprite frame size (64×64 cells in `assets/characters/wolf/frames.json`)
  // at a clean 1.5625× uniform display scale. The 100×100 square body
  // keeps Wolf the second-widest silhouette in the cast (Cat 75, Owl
  // 84, Wolf 100, Bear 110) and renders the sprite frame without
  // per-axis stretching — the legacy 100×140 placeholder rectangle was
  // 2.1875× tall and 1.5625× wide vs the source cell, which visibly
  // squashed the sprite when MatchScene called
  // `setDisplaySize(width, height)`. AC 10403 Sub-AC 3 — added explicit
  // tests in `characterSpec.test.ts` that lock down both the
  // body == cell × uniform scale rule AND the per-move hitbox sizing
  // invariants (height fits inside body, jab < tilt < smash reach,
  // chest-level offsetY, off-stage cross-character clean-hit), so any
  // future balance pass that scrambles these proportions surfaces.
  // Hurtbox MATCHES the visible sprite silhouette on-screen — derived
  // from the native sprite frame (64×64) where the wolf art occupies
  // x:22-40 (19 cols), y:22-49 (28 rows), rendered at sprite display
  // 150×150 px. So visible-on-screen ≈ 150 × 19/64 × 28/64 ≈ 45×66 px,
  // and the collision body matches.
  //
  // FUTURE SCALING: a per-instance multiplier (e.g. mushroom power-up,
  // training-mode "Tiny Wolf") would scale both sprite display AND
  // (width, height) by the same factor — apply via `Character.setScale`
  // (TODO) which would call `Body.scale(body, k, k)` and update the
  // sprite displaySize lookup in MatchScene's per-frame loop. The hard
  // contract is "hurtbox-to-visible ratio is invariant under scale".
  width: 45,
  height: 66,
  chamfer: 8,
  // `mass` is sourced from the spread of `WOLF_MOVEMENT_PROFILE` above
  // (Sub-AC 2.2 of the T2 refactor — the per-fighter movement profile
  // is the single source of truth for knockback-resistance mass).
};

/**
 * Wolf's basic neutral attack. Punchy, mid-range, modest knockback —
 * the move you press when you don't have time to think. AC 202 Sub-AC 2
 * acceptance: hitbox spawn (70×52 sensor 50 px in front), damage value
 * (6 %), cooldown (14 frames after recovery → ~233 ms).
 *
 * Animation states (AC 60002 Sub-AC 2): 6 art frames total — 2 startup,
 * 1 active, 3 recovery. Stretch over the gameplay window via
 * `selectAnimationFrame()`:
 *   startup [0..3]  → art 0 (frames 0-1) → art 1 (frames 2-3)
 *   active  [4..6]  → art 0 throughout (single-frame hit pose)
 *   recovery[7..15] → art 0 (7-9) → art 1 (10-12) → art 2 (13-15)
 */
export const WOLF_JAB: AttackMoveWithAnimation = {
  id: 'wolf.jab',
  type: 'jab',
  damage: 6,
  knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
  hitbox: {
    // Author hitbox as if facing right — `Character` mirrors `offsetX`
    // by `facing` on spawn. The wolf is 100 px wide; placing the
    // hitbox 50 px out of the body's centre puts the leading edge
    // right at his fist. AC 10404 Sub-AC 4 — height re-tuned for the
    // 100×100 body (jab now ~38 % of body height, mirroring the legacy
    // 52/140 ≈ 37 % "chest level" ratio); width and offsetX unchanged
    // because the body width (100) was not modified by the retune.
    offsetX: 22,
    offsetY: -3,
    width: 32,
    height: 17,
  },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 14,
  animation: {
    startupFrames: 2,
    activeFrames: 1,
    recoveryFrames: 3,
  },
  // Jab-combo opener: a re-press once jab1's hitbox is out advances to
  // jab2 → jab3 (the finisher). Tier 4.
  jabChain: { nextId: 'wolf.jab2' },
};

/**
 * Wolf jab string — stage 2. A quick follow-up poke that chains from
 * {@link WOLF_JAB} on a re-press and itself links to the
 * {@link WOLF_JAB3} finisher. Registered as a `'jab'` move but never the
 * light slot (first-registered jab1 keeps it) — reachable ONLY via the
 * chain link.
 */
export const WOLF_JAB2: AttackMoveWithAnimation = {
  id: 'wolf.jab2',
  type: 'jab',
  damage: 4,
  knockback: { x: 1.2, y: -0.3, scaling: 0.05 },
  hitbox: { offsetX: 24, offsetY: -3, width: 32, height: 17 },
  startupFrames: 3,
  activeFrames: 2,
  recoveryFrames: 8,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'wolf.jab3' },
};

/**
 * Wolf jab string — finisher (stage 3). The launcher that ends the
 * string: more knockback + a base-magnitude floor so it pops the
 * opponent away even at low percent. No `jabChain` — the chain
 * terminates here, and its `cooldownFrames` is the post-string lockout.
 */
export const WOLF_JAB3: AttackMoveWithAnimation = {
  id: 'wolf.jab3',
  type: 'jab',
  damage: 7,
  knockback: { x: 3.2, y: -1.6, scaling: 0.16, baseMagnitude: 1.0 },
  hitbox: { offsetX: 26, offsetY: -3, width: 36, height: 20 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 16,
  cooldownFrames: 20,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Wolf's forward tilt — the third grounded option after jab and smash
 * (AC 60002 Sub-AC 2). Mid-strength committal poke that fills the
 * spacing role between jab and smash:
 *
 *   • Reach     : 60 px offset, 80×40 hitbox — longer than jab (50, 70)
 *                 but shorter than smash (70, 90). Trades hurtbox
 *                 extension for coverage; you're committed for ~7
 *                 startup frames before the hitbox spawns, and the
 *                 windup hurtbox sticks out a bit on the swing.
 *                 AC 10404 Sub-AC 4 — height re-tuned for the 100×100
 *                 body that matches the real 64×64 wolf sprite frame.
 *   • Damage    : 8 — between jab (6) and smash (14). At ~80 % the
 *                 knockback puts Cat into a tumble but doesn't KO her
 *                 from centre-stage; smash is still the finisher.
 *   • Knockback : x 2.0 / y -0.6, scaling 0.12. Stronger than jab's
 *                 0.06 scaling so the move opens KO percent later;
 *                 weaker than smash's 0.40 so it can't accidentally
 *                 end stocks during neutral exchanges.
 *   • Frames    : 7 startup / 4 active / 12 recovery + 14 cooldown.
 *                 Lockout = 37 frames (~617 ms). Slower than jab
 *                 (30 frames) but faster than smash (56 frames) — the
 *                 canonical "neutral game" tempo.
 *
 * Animation states: 7 art frames total — 2 startup, 2 active, 3
 * recovery. The two active art frames let the swing show through the
 * hit window so it doesn't look like a single-frame freeze frame:
 *   startup [0..6]   → art 0 (frames 0-2) → art 1 (frames 3-6)
 *   active  [7..10]  → art 0 (7-8) → art 1 (9-10)
 *   recovery[11..22] → art 0 (11-14) → art 1 (15-18) → art 2 (19-22)
 */
export const WOLF_TILT: AttackMoveWithAnimation = {
  id: 'wolf.tilt',
  type: 'tilt',
  damage: 8,
  knockback: { x: 2.0, y: -0.6, scaling: 0.12 },
  hitbox: {
    offsetX: 27,
    offsetY: -3,
    width: 36,
    height: 18,
  },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 3,
  },
};

/**
 * Wolf's heavy attack — forward smash. KO finisher with a slow wind-up
 * so it punishes whiffs hard but cleanly closes out matches at high
 * percent.
 *
 *   damage 14, knockback 4.0/-1.5 with 0.4 percent-scaling.
 *   startup 12 (~200 ms), active 4, recovery 18, cooldown 22.
 *   Press-to-press lockout = 56 frames (~933 ms).
 *
 * The hitbox is wider and pushed further out than the jab — Wolf
 * reaches with the swing, not just punches in place. Knockback scaling
 * is the heaviest in the M2 cut so a clean smash at ~120 % is enough
 * to send Cat off the side blast zone of every M2 stage.
 *
 * Animation states (AC 60002 Sub-AC 2): 8 art frames total — 3 startup,
 * 1 active, 4 recovery. The wind-up gets the most art frames so the
 * "anticipation" reads clearly to the opponent (a fair smash in the
 * canonical Smash idiom telegraphs its commitment). Recovery also gets
 * generous art frame budget so the "punished swing" pose holds long
 * enough to register visually.
 *   startup [0..11]  → art 0 (0-3) → art 1 (4-7) → art 2 (8-11)
 *   active  [12..15] → art 0 throughout (the impact frame)
 *   recovery[16..33] → art 0 (16-20) → art 1 (21-25) → art 2 (26-29) → art 3 (30-33)
 */
export const WOLF_SMASH: AttackMoveWithAnimation = {
  id: 'wolf.smash',
  type: 'smash',
  damage: 14,
  knockback: { x: 4.0, y: -1.5, scaling: 0.4, baseMagnitude: 1.2, damageGrowth: 0.5 },
  // Hold-to-charge ramp (Tier 4). minDamage/minKnockback EQUAL the base so
  // a tap fires the authored smash unchanged; a full hold scales it up.
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 14,
    maxDamage: 19.6,
    minKnockback: { x: 4.0, y: -1.5, scaling: 0.4, baseMagnitude: 1.2, damageGrowth: 0.5 },
    maxKnockback: { x: 5.6, y: -2.1, scaling: 0.5, baseMagnitude: 1.2, damageGrowth: 0.5 },
  },
  // AC 10404 Sub-AC 4 — re-tuned for the 100×100 body. Reach (70 px
  // offset, 90 px width) is the longest grounded option (jab 50/70,
  // tilt 60/80, smash 70/90), preserving the legacy reach gradient at
  // the new body scale. Heights drop because the body is now 100 tall
  // (was 140); the 42 px hit window covers ~42 % of the body, matching
  // the legacy 60/140 ≈ 43 % ratio.
  hitbox: {
    offsetX: 32,
    offsetY: -3,
    width: 40,
    height: 19,
  },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 22,
  animation: {
    startupFrames: 3,
    activeFrames: 1,
    recoveryFrames: 4,
  },
};

/**
 * Wolf's neutral aerial — body-centred sphere hitbox he spins inside
 * during a jump. Used to disengage when the opponent contests his
 * landing or to extend a juggle off an upward knockback.
 *
 *   damage 8, knockback 1.6/-1.0 with 0.12 scaling.
 *   startup 5, active 6, recovery 12, cooldown 8.
 *   Press-to-press lockout = 31 frames (~517 ms).
 *
 * The hitbox is `offsetX: 0` (centred on the body) and large enough
 * (110×86) to catch a same-frame approach from either side. Sitting
 * the hitbox on the body is the canonical "neutral aerial" pattern —
 * forward / back / down / up airs would offset asymmetrically. Active
 * window is generous so a slightly mistimed press still connects.
 * AC 10404 Sub-AC 4 — height re-tuned for the 100×100 body (was 120
 * for the legacy 100×140 placeholder rectangle).
 *
 * Note: this `AttackMove`-typed export remains the moveset entry
 * registered by `Wolf` constructor for backwards compatibility with
 * the AC 203 Sub-AC 3.3 + AC 60002 Sub-AC 2 contracts. The
 * AC 60101 Sub-AC 1 aerial-data record (`WOLF_NAIR_AERIAL`) declared
 * below carries the same gameplay numbers plus the new
 * landing-lag / auto-cancel fields and the animation block; the
 * follow-up sub-AC swaps `WOLF_NAIR` for `WOLF_NAIR_AERIAL` in the
 * registration list once the runtime lockout handler ships.
 */
export const WOLF_NAIR: AttackMove = {
  id: 'wolf.nair',
  type: 'aerial',
  damage: 8,
  knockback: { x: 1.6, y: -1.0, scaling: 0.12 },
  hitbox: {
    offsetX: 0,
    offsetY: -1,
    width: 50,
    height: 39,
  },
  startupFrames: 5,
  activeFrames: 6,
  recoveryFrames: 12,
  cooldownFrames: 8,
};

/**
 * Wolf's neutral aerial — full `AerialMove` record (AC 60101 Sub-AC 1).
 *
 * Same gameplay numbers as `WOLF_NAIR` (so AI predictors / replay logs
 * keep producing identical results when the runtime swaps over) plus:
 *
 *   • `aerialDirection: 'neutral'` — neutral stick.
 *   • Animation: 6 art frames — 1 startup + 3 active + 2 recovery (the
 *     active phase gets the most art frames because the spin is the
 *     visual identity of the move; startup / recovery are shorter
 *     "wind-up" / "wind-down" poses).
 *   • Knockback launch angle: atan2(1.0, 1.6) ≈ 32° up-and-forward.
 *     Classic juggle-extend trajectory — sends the target up enough
 *     for a follow-up but not so high they tech-roll out of range.
 *   • `landingLagFrames: 12` — middle-of-the-road lockout. Wolf's
 *     bruiser archetype can't auto-cancel his neutral aerial as
 *     cleanly as Cat's; a whiffed nair on landing leaves him exposed.
 *   • `autoCancelWindows`:
 *       - `[0, 5)` — early out before the hitbox spawns. Lets a
 *         fighter who twitch-pressed nair on the way down land
 *         cleanly if they touched ground before the spin started.
 *       - `[28, 31)` — the last three recovery+cooldown frames after
 *         the move's busy window ends are auto-cancel by the
 *         pure-`done`-phase rule baked into `isAutoCancelFrame`. We
 *         declare the trailing window explicitly so balance tooling
 *         can audit the "clean landing tail" without re-deriving it.
 */
export const WOLF_NAIR_AERIAL: AerialMove = {
  id: 'wolf.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 8,
  knockback: { x: 1.6, y: -1.0, scaling: 0.12 },
  // Mirrors `WOLF_NAIR.hitbox` — see AC 10404 Sub-AC 4 retuning above.
  hitbox: {
    offsetX: 0,
    offsetY: -1,
    width: 50,
    height: 39,
  },
  startupFrames: 5,
  activeFrames: 6,
  recoveryFrames: 12,
  cooldownFrames: 8,
  animation: {
    startupFrames: 1,
    activeFrames: 3,
    recoveryFrames: 2,
  },
  landingLagFrames: 12,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
};

/**
 * Wolf's forward aerial — a forward-extended slash that reaches out
 * past his fist. The bruiser's "wall of pressure" tool: he uses fair
 * to chase a knocked-back opponent through the air or to cover his
 * landing zone if the opponent retreats. Forward-aerials are the
 * canonical "approach with an aerial in front of you" Smash move —
 * Wolf's variant trades Cat-fast startup for harder-hitting
 * knockback.
 *
 *   • Damage    : 11 — between his nair (8) and a smash on the ground
 *                 (14). At ~80 % the knockback puts Cat into a tumble
 *                 toward the blast zone if she's near the edge.
 *   • Knockback : x 2.4 / y -0.9, scaling 0.18.
 *                 Launch angle = atan2(0.9, 2.4) ≈ 21° up-and-forward
 *                 — flatter than nair, sends the target horizontally
 *                 toward the blast zone (canonical "kill move at the
 *                 ledge" trajectory).
 *   • Frames    : 8 startup / 4 active / 14 recovery + 10 cooldown.
 *                 Lockout = 36 frames (~600 ms). Slower than Cat's
 *                 fair but with a much heftier hit.
 *   • Hitbox    : 60 px offset, 90×42 sensor — extends well past
 *                 Wolf's body in the facing direction.
 *                 AC 10404 Sub-AC 4 — height re-tuned for the 100×100
 *                 body (was 60 for the legacy 100×140 placeholder).
 *
 * Animation states: 7 art frames — 2 startup, 2 active, 3 recovery.
 * The two-frame active window lets the slash arc visibly through the
 * hit window so the swing reads kinetically instead of as a freeze
 * frame.
 *
 *   • landingLagFrames: 16 — one of the heavier penalties in Wolf's
 *     kit. Whiffed fair on landing → Cat dashes in and tilts him
 *     before he recovers.
 *   • autoCancelWindows:
 *       - `[0, 4)` — pre-hitbox early-out (half the startup window).
 *       - The "after busy ends" auto-cancel is enforced by the
 *         pure-`done`-phase rule.
 */
export const WOLF_FAIR: AerialMove = {
  id: 'wolf.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 11,
  knockback: { x: 2.4, y: -0.9, scaling: 0.18 },
  hitbox: {
    // Authored facing-right; the runtime mirrors offsetX by facing.
    offsetX: 27,
    offsetY: -3,
    width: 40,
    height: 19,
  },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 10,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 3,
  },
  landingLagFrames: 16,
  autoCancelWindows: [{ startFrame: 0, endFrame: 4 }],
};

/**
 * Wolf's back aerial — a heavy backward kick. Bairs are canonically
 * the "kill move that lives in your back" tool in fighting games:
 * a fighter retreating from pressure can throw a bair as a parting
 * shot, sending the chaser into the side blast zone if their percent
 * is high enough. Wolf's bair is the hardest aerial in the M2 cut —
 * it's slower than fair but hits with smash-tier knockback scaling.
 *
 *   • Damage    : 13 — hardest aerial in Wolf's kit. Approaches the
 *                 grounded smash (14) but with the aerial trade-off
 *                 of needing to be airborne to use it.
 *   • Knockback : x 3.0 / y -1.2, scaling 0.32.
 *                 Launch angle = atan2(1.2, 3.0) ≈ 22° up-and-back
 *                 — almost identical to fair's angle but at higher
 *                 magnitude and stronger percent scaling. KOs Cat at
 *                 centre-stage at ~110 %; an edge bair at 90 % takes
 *                 a stock.
 *   • Frames    : 10 startup / 4 active / 16 recovery + 12 cooldown.
 *                 Lockout = 42 frames (~700 ms). Slower than fair so
 *                 the player commits harder to the swing.
 *   • Hitbox    : 60 px offset, 90×46 sensor authored facing-right
 *                 (AC 10404 Sub-AC 4 — height re-tuned for the 100×100
 *                 body); the runtime mirrors it on spawn so when Wolf
 *                 is facing right and the player throws bair, the
 *                 hitbox spawns to his LEFT (away from facing). The
 *                 `aerialDirection: 'back'` field tells the input
 *                 layer this dispatch.
 *
 * Animation states: 8 art frames — 3 startup, 1 active, 4 recovery.
 * Mirrors the smash-style anticipation curve: long wind-up tells the
 * opponent "Wolf is committing to a heavy hit", letting them try to
 * dodge or counter the swing.
 *
 *   • landingLagFrames: 22 — the heaviest landing-lag in Wolf's kit.
 *     A whiffed bair on landing is one of the most punishable
 *     mistakes in the M2 cut — Bear can dash in and land a smash
 *     before Wolf recovers.
 *   • autoCancelWindows:
 *       - `[0, 5)` — pre-hitbox early-out window (half the startup).
 *       - No late window before busy ends — the move is meant to be
 *         committal. If you're going to throw it, you need to land
 *         after the move fully completes.
 */
export const WOLF_BAIR: AerialMove = {
  id: 'wolf.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 13,
  knockback: { x: 3.0, y: -1.2, scaling: 0.32 },
  hitbox: {
    // Authored facing-right; on spawn the runtime mirrors offsetX by
    // facing. With `aerialDirection: 'back'` the input layer picks
    // this move when the stick is held opposite to facing — the
    // hitbox itself is still mirrored by facing, so a Wolf facing
    // right who throws bair gets a hitbox to his LEFT.
    offsetX: 27,
    offsetY: -3,
    width: 40,
    height: 21,
  },
  startupFrames: 10,
  activeFrames: 4,
  recoveryFrames: 16,
  cooldownFrames: 12,
  animation: {
    startupFrames: 3,
    activeFrames: 1,
    recoveryFrames: 4,
  },
  landingLagFrames: 22,
  autoCancelWindows: [{ startFrame: 0, endFrame: 5 }],
};

/**
 * Wolf's neutral special — **counter** (AC 60201 Sub-AC 1).
 *
 * The bruiser's special is the canonical "fighting-game counter": a
 * short-window parry that absorbs the next incoming hit and answers
 * with a hard retaliation in front. Mirrors the Smash-Bros counter
 * idiom (Marth, Roy, Lucina) and slots Wolf's bruiser archetype into
 * the "trade hits, win the trade" niche — he eats the swing on a read,
 * gives back harder.
 *
 * Mechanic:
 *   • Frames 6-17 of the move are the parry window. During those frames
 *     the fighter is invincible AND latches the next incoming hit.
 *   • On a successful catch, the runtime spawns a retaliation hitbox in
 *     front of Wolf. Damage = `clamp(absorbed * 1.3, 8, 22)`. Knockback
 *     is fixed at the `counterKnockback` vector — does not scale with
 *     absorbed damage so a counter against a 3% jab still launches
 *     hard, but a counter against a 14% smash doesn't run away to a
 *     one-shot stock.
 *   • A whiffed counter (no incoming hit during the window) plays out
 *     the full move including a long recovery — punishable on a misread
 *     by a fast tilt or another smash.
 *
 *   • Damage    : 0 base — the move's own `damage` is zero. The
 *                 retaliation hit comes from `counterHitbox` /
 *                 `counterKnockback` on a catch, not from the move's
 *                 active-phase hitbox.
 *   • Knockback : 0 base — same reason.
 *   • Frames    : 5 startup / 12 active / 18 recovery + 24 cooldown.
 *                 Lockout = 59 frames (~983 ms). Significantly slower
 *                 than Wolf's smash (56 frames lockout) so the move is
 *                 strictly committal.
 *
 * Animation states (8 art frames): 2 startup, 3 active, 3 recovery —
 * the active phase gets the most art frames so the parry pose holds
 * through the full window for visual readability.
 *
 *   counterWindowStart = 5  (= move.startupFrames; parry begins as
 *                            active phase begins)
 *   counterWindowEnd   = 17 (= startupFrames + activeFrames)
 *   damageMultiplier   = 1.3   (Smash-canonical)
 *   minCounterDamage   = 8     (jab-counter floor)
 *   maxCounterDamage   = 22    (smash-counter ceiling)
 *   counterKnockback   = (4.0, -1.6, scaling 0.30)
 *   counterHitbox      = 90×42 sensor 70 px in front (AC 10404 Sub-AC 4
 *                        — re-tuned for the 100×100 body that matches
 *                        the real 64×64 wolf sprite frame).
 */
export const WOLF_NEUTRAL_SPECIAL: CounterSpecialMove = {
  id: 'wolf.neutral_special',
  type: 'special',
  specialKind: 'counter',
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  // The move's own hitbox is unused (counter has no proactive hit), so
  // we author a degenerate sensor — non-zero so the schema accepts it,
  // never spawned because the runtime branches on `specialKind`
  // before consulting `move.hitbox`.
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 5,
  activeFrames: 12,
  recoveryFrames: 18,
  cooldownFrames: 24,
  animation: {
    startupFrames: 2,
    activeFrames: 3,
    recoveryFrames: 3,
  },
  counter: {
    counterWindowStart: 5,
    counterWindowEnd: 17,
    damageMultiplier: 1.3,
    minCounterDamage: 8,
    maxCounterDamage: 22,
    counterKnockback: { x: 4.0, y: -1.6, scaling: 0.30 },
    counterHitbox: {
      offsetX: 70,
      offsetY: -7,
      width: 90,
      height: 42,
    },
  },
};

/**
 * Wolf's side special — **dash strike** (AC 60302 Sub-AC 2).
 *
 * The bruiser's side-special is the canonical "Raptor Boost / Flame Choke"
 * archetype — Wolf rushes forward at fixed velocity for a few frames with
 * a committal body-attached hitbox. Slots Wolf into the "approach burst"
 * niche on the side+special press: he covers ground beyond his dash-attack
 * range and lands a hard hit at the end. Pays for it with a long recovery
 * if he whiffs the dash.
 *
 * Mechanic:
 *   • On press, the move enters startup. At the start of the active
 *     window the runtime overrides Wolf's velocity to
 *     `(facing * dashSpeed, 0)` and holds it for `dashFrames` frames.
 *   • The move's `hitbox` (an 80×52 sensor 50 px in front, body-attached)
 *     spawns on the active phase's first frame and tracks Wolf's body so
 *     anything caught in the dash takes a single solid hit. AC 10404
 *     Sub-AC 4 — height re-tuned for the 100×100 body (was 72 for the
 *     legacy 100×140 placeholder).
 *   • After `dashFrames` the runtime restores normal physics; the active
 *     phase wraps and recovery begins.
 *   • `helplessAfterDash: false` — the dash is a neutral-game tool, not a
 *     recovery, so Wolf isn't stuck helpless after the move ends. He can
 *     still act after recovery.
 *
 *   • Damage    : 12 — between Wolf's tilt (8) and smash (14). Hits hard
 *                 because the move is committal.
 *   • Knockback : x 3.0 / y -1.0, scaling 0.26.
 *                 Launch angle = atan2(1.0, 3.0) ≈ 18° up-and-forward —
 *                 sends the target horizontally toward the side blast
 *                 zone. KOs Cat at ~110 % from centre stage.
 *   • Frames    : 6 startup / 8 active / 18 recovery + 18 cooldown.
 *                 Lockout = 50 frames (~833 ms). Hefty commitment — the
 *                 trade Wolf pays for the powerful approach burst.
 *
 * Animation states (8 art frames): 2 startup, 2 active, 4 recovery —
 * generous recovery so the punishable post-dash pose holds visibly.
 *
 * Dash spec:
 *   • dashSpeed = 18 — faster than Wolf's max run speed (7.5) by a wide
 *     margin so the move covers ground beyond what a dash-attack would.
 *   • dashFrames = 6 — the dash velocity is enforced for 6 frames at the
 *     start of the active window (= ¾ of the active phase). Travel
 *     distance ≈ 18 * 6 = 108 px in 6 frames (≈ 1.7 character widths).
 *   • helplessAfterDash = false — this is a neutral-game tool, not a
 *     recovery; Wolf is not stuck helpless after the move ends.
 */
export const WOLF_SIDE_SPECIAL: DashStrikeSideSpecialMove = {
  id: 'wolf.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'dashStrike',
  // Bumped from 12 → 16 to clear Wolf's smash (14) — special should
  // outclass the basic-attack tier.
  damage: 16,
  knockback: { x: 3.4, y: -1.1, scaling: 0.30 },
  // Body-attached sensor that travels with Wolf during the dash.
  // Widened from 36×23 → 52×30 so the dash strike has a meaningfully
  // bigger hit window than Wolf's smash (40×19).
  hitbox: {
    offsetX: 26,
    offsetY: -3,
    width: 52,
    height: 30,
  },
  startupFrames: 6,
  activeFrames: 8,
  recoveryFrames: 18,
  cooldownFrames: 18,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 4,
  },
  dashStrike: {
    dashSpeed: 18, // ≈ 1080 px/s — faster than Wolf's max run (450 px/s)
    dashFrames: 6, // ¾ of the 8-frame active window
    helplessAfterDash: false,
  },
};

/**
 * Wolf's up special — **multi-hit rising attack** (AC 60202 Sub-AC 2).
 *
 * The bruiser's recovery is a vertical "blade dance" — Wolf launches
 * himself upward with a spinning multi-hit hitbox, hits the opponent
 * 3 times on the way up (small link-hit damage to lock them in place
 * above him), then a 4th launching hit at the apex. Mirrors the Smash
 * canonical "up-B that doubles as an attack" archetype (Marth's
 * Dolphin Slash, Ike's Aether, Roy's Blazer).
 *
 * Recovery characteristics:
 *   • riseImpulse = -18 (steeper than his jumpImpulse 12.5 — the move
 *     actually saves the stock).
 *   • driftImpulse = 0 — pure vertical rise. Wolf is committed to the
 *     line his press-frame position dictates; no horizontal redirect
 *     during the rise (a balance trade-off so the powerful move can be
 *     edge-guarded if the opponent reads the timing).
 *
 * Combat characteristics:
 *   • 3 link hits (2% each, low knockback to keep target above Wolf).
 *   • 1 launcher hit (8% damage, hard upward knockback).
 *   • Total damage on a clean catch: 14% — between Wolf's tilt (8) and
 *     smash (14). The launcher's KB scaling makes the move a real KO
 *     option from off-stage at high percent.
 *
 *   • Frames    : 4 startup / 18 active / 22 recovery + 18 cooldown.
 *                 Lockout = 62 frames (~1033 ms). Heavily committal —
 *                 the trade for the strong vertical recovery.
 *   • hitInterval = 5 frames. So hits land at active-frames
 *     [0, 5, 10, 15] — final launcher at active-frame 15, well inside
 *     the 18-frame active window.
 *
 * Animation states (8 art frames): 1 startup, 5 active, 2 recovery —
 * the spinning rise gets the most art frames so the multi-hit blade
 * dance reads visually through the active window.
 *
 * Hitbox geometry: a body-sized vertical sensor (90×100) centred on
 * Wolf's body so the rising arc covers his current position AND every
 * position the runtime tracks him through during the rise. AC 10404
 * Sub-AC 4 — height re-tuned for the 100×100 body (was 140 for the
 * legacy 100×140 placeholder); the rising arc still covers fresh
 * vertical ground because `updateHitboxPosition` walks the sensor with
 * the body each active frame as Wolf climbs.
 */
export const WOLF_UP_SPECIAL: MultiHitRisingUpSpecialMove = {
  id: 'wolf.up_special',
  type: 'upSpecial',
  upSpecialKind: 'multiHitRising',
  // The move's own `damage` / `knockback` are the LINK-HIT values so a
  // consumer that reads only `AttackMove` (e.g. AI predictor) gets the
  // first-contact stats. The launcher values live on
  // `multiHitRising.launcherDamage` / `launcherKnockback`.
  damage: 2,
  knockback: { x: 0, y: -0.4, scaling: 0.02 },
  // Hitbox is body-centred — covers the rising arc as
  // `updateHitboxPosition` walks the sensor with Wolf each frame.
  hitbox: {
    offsetX: 0,
    offsetY: -3,
    width: 40,
    height: 45,
  },
  startupFrames: 4,
  activeFrames: 18,
  recoveryFrames: 22,
  cooldownFrames: 18,
  animation: {
    startupFrames: 1,
    activeFrames: 5,
    recoveryFrames: 2,
  },
  multiHitRising: {
    riseImpulse: -18, // upward in Phaser screen-space (negative Y)
    driftImpulse: 0, // pure vertical rise
    hitCount: 4,
    hitInterval: 5,
    linkDamage: 2,
    linkKnockback: { x: 0, y: -0.4, scaling: 0.02 },
    launcherDamage: 8,
    launcherKnockback: { x: 0.5, y: -3.2, scaling: 0.36 },
  },
};

/**
 * Wolf's down special — **ground pound** (AC 60304 Sub-AC 4).
 *
 * The bruiser's down-special is the canonical Smash "Bowser-bomb / DK
 * hand-slam" archetype — Wolf hops a few frames, then crashes straight
 * down at high velocity. The descent body acts as a meteor hitbox; on
 * ground contact a wide shockwave fires outward at his feet. Slots
 * Wolf into the "I'm coming down on you" niche on the down+special
 * press: a committal vertical attack distinct from his neutral counter,
 * his side dashStrike, and his up multiHitRising.
 *
 * Mechanic:
 *   • Hop phase (frames 0-3 of active): vertical velocity is set to
 *     -10 (small upward wind-up). The hop is purely cosmetic — the
 *     visual "Wolf launches himself up" before the slam.
 *   • Slam phase (frames 4-13 of active): vertical velocity snaps to
 *     +30 (downward, much faster than gravity-fall). The body acts as
 *     a meteor hitbox during the descent — the move's own `damage` /
 *     `knockback` fields carry the meteor (descent) values; any
 *     opponent overlapped is launched downward off the stage.
 *   • Landing: on ground contact a 200×30 shockwave hitbox spawns at
 *     Wolf's feet dealing 8% damage and applying outward knockback.
 *     The shockwave is short-lived (1-2 frames); the runtime is
 *     responsible for its lifecycle.
 *
 *   • Damage    : 14 — the meteor (descent) damage. Opponents touched
 *                 mid-slam get sent straight down; an off-stage hit
 *                 takes a stock at any percent.
 *   • Knockback : x 0.5 / y 4.0, scaling 0.30. The +y is positive
 *                 (downward in Phaser screen-space) — that's the canonical
 *                 meteor / spike trajectory. Off-stage Wolf catching
 *                 someone with this is functionally an instant KO.
 *   • Frames    : 6 startup / 14 active / 20 recovery + 24 cooldown.
 *                 Lockout = 64 frames (~1067 ms). Heavily committal —
 *                 the trade for the one-shot-style payoff if landed
 *                 cleanly off-stage.
 *
 * Animation states (8 art frames): 1 startup, 5 active, 2 recovery —
 * the active phase gets the most art frames so the hop+slam
 * trajectory reads visually through the descent.
 *
 * GroundPound spec:
 *   • hopFrames = 4 (= 2/7 of the active window).
 *   • hopImpulse = -10 — short upward hop wind-up.
 *   • slamVelocity = 30 — fast plunge downward, well past gravity.
 *   • shockwaveDamage = 8 — modest landing damage; the meteor is the
 *     real payoff.
 *   • shockwaveKnockback = (2.0, -1.2, scaling 0.18) — outward + slightly
 *     up so opponents next to Wolf's landing site are pushed away cleanly.
 *   • shockwaveHitbox: 200×22 sensor centred 42 px below Wolf's body
 *     centre — wide so opponents on either side of the landing spot
 *     are caught. AC 10404 Sub-AC 4 — offsetY/height re-tuned for the
 *     100×100 body so the shockwave still spawns just above his feet
 *     (body half-height ≈ 50, so +42 keeps the shockwave centre 8 px
 *     above the bottom edge).
 */
/**
 * Wolf's grab — post-M2 grab/throw subsystem.
 *
 * Smash-canonical "standing grab": short-range tight reach in front
 * of Wolf, ~7-frame startup, 2-frame active window, long whiff
 * recovery so a missed grab is a punish window. The 4-throw set
 * leans into Wolf's bruiser identity — back-throw is the heaviest
 * (KO finisher off the side blast zone), up-throw is the
 * combo-starter, down-throw is a low-knockback technical option.
 *
 * Values mirror `data/characters/wolf.json`'s `moves.grab` block —
 * the validation script keeps them in sync.
 */
export const WOLF_GRAB: GrabSpec = {
  id: 'wolf.grab',
  hitbox: { offsetX: 26, offsetY: -2, width: 24, height: 30 },
  startupFrames: 7,
  activeFrames: 2,
  whiffRecoveryFrames: 32,
  holdFramesMax: 90,
  throwRecoveryFrames: 24,
  pummel: { damage: 1.5, cooldownFrames: 14 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 8, knockback: { x: 2.5, y: -1.0, scaling: 0.1 }, animationFrames: 22 },
    back:    { damage: 10, knockback: { x: 2.8, y: -1.2, scaling: 0.12 }, animationFrames: 26 },
    up:      { damage: 7, knockback: { x: 0.5, y: -3.0, scaling: 0.1 }, animationFrames: 14 },
    down:    { damage: 6, knockback: { x: 0.8, y: 1.2, scaling: 0.08 }, animationFrames: 16 },
  },
};

export const WOLF_DOWN_SPECIAL: GroundPoundDownSpecialMove = {
  id: 'wolf.down_special',
  type: 'downSpecial',
  downSpecialKind: 'groundPound',
  // The move's own `damage` / `knockback` are the METEOR (descent) values
  // so a consumer that reads only `AttackMove` (e.g. AI predictor) sees
  // the off-stage-KO read. The shockwave values live on
  // `groundPound.shockwaveDamage` / `shockwaveKnockback`.
  damage: 14,
  knockback: { x: 0.5, y: 4.0, scaling: 0.30 },
  // Body-attached descent hitbox — large enough to cover Wolf's body
  // during the slam. The runtime tracks this with the body each active
  // frame (same `updateHitboxPosition` path aerials use). AC 10404
  // Sub-AC 4 — sensor matches the new 100×100 body footprint exactly.
  hitbox: {
    offsetX: 0,
    offsetY: 0,
    width: 45,
    height: 45,
  },
  startupFrames: 6,
  activeFrames: 14,
  recoveryFrames: 20,
  cooldownFrames: 24,
  animation: {
    startupFrames: 1,
    activeFrames: 5,
    recoveryFrames: 2,
  },
  groundPound: {
    hopFrames: 4, // first 4 of 14 active frames are the hop
    hopImpulse: -10, // short upward wind-up
    slamVelocity: 30, // fast plunge downward
    shockwaveDamage: 8,
    shockwaveKnockback: { x: 2.0, y: -1.2, scaling: 0.18 },
    shockwaveHitbox: {
      offsetX: 0,
      offsetY: 42, // below body centre — at Wolf's feet (body half-height ≈ 50)
      width: 200,
      height: 22,
    },
  },
};

// ---------------------------------------------------------------------------
// Extended-slot moves (post-M2 — directional grounded lights + full aerial kit)
//
// The post-M2 character architecture pass added 6 OPTIONAL extended
// attack slots: sideLight + upLight + downLight (directional grounded
// lights, L/R mirrored for sideLight) and nair + uair + dair (full
// aerial kit alongside the canonical fair). Wolf's authoring fills
// all six with Smash-flavored defaults; the runtime routing
// (`extendedSlotResolver`) prefers these when present and falls back
// to tilt / fair when absent.
//
// The numbers are picked to feel like Wolf's bruiser archetype:
// committal, slightly slow, hits hard. Each value is intentionally a
// FIRST DRAFT — a balance pass / tuning sub-task can tune them.
// ---------------------------------------------------------------------------

/** Wolf's side-direction grounded light (mirrored L/R). Currently identical to WOLF_TILT. */
export const WOLF_SIDE_LIGHT: AttackMoveWithAnimation = {
  id: 'wolf.sideLight',
  type: 'tilt',
  damage: 8,
  knockback: { x: 2.0, y: -0.6, scaling: 0.12 },
  hitbox: { offsetX: 27, offsetY: -3, width: 36, height: 18 },
  startupFrames: 7,
  activeFrames: 4,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

/** Wolf's up-stick grounded light — vertical column above the body (anti-air). */
export const WOLF_UP_LIGHT: AttackMoveWithAnimation = {
  id: 'wolf.upLight',
  type: 'tilt',
  damage: 7,
  knockback: { x: 0.4, y: -2.2, scaling: 0.14 },
  hitbox: { offsetX: 0, offsetY: -28, width: 30, height: 30 },
  startupFrames: 6,
  activeFrames: 3,
  recoveryFrames: 11,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
};

/** Wolf's down-stick grounded light — low sweep at the feet. */
export const WOLF_DOWN_LIGHT: AttackMoveWithAnimation = {
  id: 'wolf.downLight',
  type: 'tilt',
  damage: 6,
  knockback: { x: 1.5, y: -1.0, scaling: 0.10 },
  hitbox: { offsetX: 24, offsetY: 14, width: 32, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/** Wolf's neutral aerial — body-centred multi-direction sphere. */
export const WOLF_NAIR_EXT: AerialMove = {
  id: 'wolf.nair.ext',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 8,
  knockback: { x: 1.6, y: -1.0, scaling: 0.12 },
  hitbox: { offsetX: 0, offsetY: -3, width: 50, height: 50 },
  startupFrames: 5,
  activeFrames: 6,
  recoveryFrames: 12,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 2 },
  landingLagFrames: 8,
  autoCancelWindows: [{ startFrame: 0, endFrame: 2 }],
};

/** Wolf's up aerial — launcher above the body, juggle-starter. */
export const WOLF_UAIR: AerialMove = {
  id: 'wolf.uair',
  type: 'aerial',
  aerialDirection: 'up',
  damage: 9,
  knockback: { x: 0.3, y: -3.2, scaling: 0.20 },
  hitbox: { offsetX: 0, offsetY: -32, width: 36, height: 28 },
  startupFrames: 6,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 8,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
  landingLagFrames: 10,
  autoCancelWindows: [{ startFrame: 0, endFrame: 3 }],
};

/** Wolf's down aerial — meteor / spike below the body. */
export const WOLF_DAIR: AerialMove = {
  id: 'wolf.dair',
  type: 'aerial',
  aerialDirection: 'down',
  damage: 10,
  knockback: { x: 0.4, y: 3.5, scaling: 0.24 },
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
 * Wolf's up-tilt — a quick overhead swipe (up-stick + light). Fast,
 * upward-launching anti-air / juggle-starter; weaker than the up-smash
 * but low-commitment.
 */
export const WOLF_UTILT: AttackMoveWithAnimation = {
  id: 'wolf.utilt',
  type: 'tilt',
  damage: 7,
  knockback: { x: 0.2, y: -2.2, scaling: 0.16 },
  hitbox: { offsetX: 9, offsetY: -20, width: 61, height: 50 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 11,
  animation: { startupFrames: 1, activeFrames: 1, recoveryFrames: 3 },
};

/**
 * Wolf's up-smash — a rising vertical strike (up-stick + heavy). Slow but
 * a hard upward KO move; the canonical "charge it under a juggled
 * opponent" finisher.
 */
export const WOLF_USMASH: AttackMoveWithAnimation = {
  id: 'wolf.usmash',
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
  hitbox: { offsetX: 10, offsetY: -27, width: 65, height: 64 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 20,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Wolf's down-tilt — a low, fast poke at the feet (down-stick + light).
 * Crouches and jabs forward-low along the ground: the bruiser's
 * fastest grounded option and a combo/spacing tool.
 *
 *   • Reach     : 24 px offset, 34×14 hitbox sitting LOW (offsetY +12,
 *                 short height) so it strikes at Wolf's feet — beats
 *                 grounded approaches and pokes shielding opponents'
 *                 toes. Slightly longer reach than the down-light
 *                 (32×14) but the same hug-the-floor profile.
 *   • Damage    : 6 — between the down-light (6) and the tilt (8). A
 *                 chip-and-reset poke, not a damage-dealer.
 *   • Knockback : x 1.6 / y -0.3, scaling 0.08. A near-horizontal,
 *                 LOW "trip" launch — barely lifts the target off the
 *                 ground so Wolf can re-engage. Weaker than the forward
 *                 tilt (2.0 / -0.6 / 0.12) so it stays a combo opener,
 *                 not a finisher.
 *   • Frames    : 5 startup (fast) / 3 active / 10 recovery + 12
 *                 cooldown. Lockout = 30 frames — matches jab tempo so
 *                 it's safe to throw out in neutral.
 *
 * Animation states: 6 art frames — 1 startup, 2 active, 3 recovery.
 * The short startup gets a single windup frame; the active poke gets
 * two so the low jab reads through the hit window.
 */
export const WOLF_DTILT: AttackMoveWithAnimation = {
  id: 'wolf.dtilt',
  type: 'tilt',
  damage: 6,
  knockback: { x: 1.6, y: -0.3, scaling: 0.08 },
  hitbox: { offsetX: 24, offsetY: 26, width: 34, height: 14 },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: { startupFrames: 1, activeFrames: 2, recoveryFrames: 3 },
};

/**
 * Wolf's down-smash — a sweeping ground KO move (down-stick + heavy).
 * Wolf drops low and sweeps wide along the floor, catching opponents
 * on either side of his feet and launching them outward-and-low toward
 * the side blast zone. The grounded HORIZONTAL KO finisher — the
 * floor-level counterpart to the up-smash's vertical kill.
 *
 *   • Reach     : 0 px offset, 92×20 hitbox at the feet (offsetY +14,
 *                 low height). The WIDEST grounded hitbox in Wolf's kit
 *                 (forward smash 40, up-smash 40) — a body-centred sweep
 *                 so the move covers both sides of the landing spot the
 *                 way a Smash down-smash does.
 *   • Damage    : 15 — between the forward smash (14) and the up-smash
 *                 (16); the heaviest grounded horizontal hit.
 *   • Knockback : x 3.6 / y -1.2, scaling 0.40, baseMagnitude 1.2,
 *                 damageGrowth 0.5. Mirrors the forward smash's KB SHAPE
 *                 (scaling 0.40 / baseMagnitude 1.2 / damageGrowth 0.5)
 *                 tuned for Wolf's heavyweight mass — strong outward
 *                 launch with a low, flat angle (atan2(1.2, 3.6) ≈ 18°)
 *                 so it sends the target along the floor and off the
 *                 side, not up. KOs Cat from centre stage at ~120 %.
 *   • Frames    : 13 startup (slow) / 4 active / 18 recovery + 22
 *                 cooldown. Lockout = 57 frames — between the forward
 *                 smash (56) and the up-smash (58); the committal
 *                 windup punishes whiff-prone opponents.
 *
 * Animation states: 8 art frames — 3 startup, 1 active, 4 recovery.
 * Mirrors the smash anticipation curve: the long telegraphed windup
 * reads "Wolf is committing to a hard hit" the way the forward smash
 * and up-smash do.
 */
export const WOLF_DSMASH: AttackMoveWithAnimation = {
  id: 'wolf.dsmash',
  type: 'smash',
  damage: 15,
  knockback: { x: 3.6, y: -1.2, scaling: 0.40, baseMagnitude: 1.2, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 15,
    maxDamage: 21,
    minKnockback: { x: 3.6, y: -1.2, scaling: 0.40, baseMagnitude: 1.2, damageGrowth: 0.5 },
    maxKnockback: { x: 5.04, y: -1.68, scaling: 0.5, baseMagnitude: 1.2, damageGrowth: 0.5 },
  },
  hitbox: { offsetX: 0, offsetY: 14, width: 92, height: 20 },
  startupFrames: 13,
  activeFrames: 4,
  recoveryFrames: 18,
  cooldownFrames: 22,
  animation: { startupFrames: 3, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Wolf's dash-attack — a forward lunging hit used while running
 * (light press during a dash). The bruiser's running burst: he
 * shoulder-charges forward to close distance and open a combo. Weaker
 * than a smash but a real approach / combo-starter.
 *
 *   • Reach     : 30 px offset (well in front), 44×24 hitbox — extends
 *                 past Wolf's body in the run direction so the lunge
 *                 catches a retreating opponent.
 *   • Damage    : 10 — between the forward tilt (8) and the forward
 *                 smash (14). Solid burst damage for an approach tool.
 *   • Knockback : x 2.2 / y -1.4, scaling 0.16. Moderate forward-AND-up
 *                 launch (atan2(1.4, 2.2) ≈ 32°) — pops the target up
 *                 and away so Wolf can follow with an up-tilt / aerial.
 *                 Stronger than the tilt's 0.12 scaling but well short
 *                 of smash territory, so it stays a combo-starter.
 *   • Frames    : 8 startup (medium) / 4 active / 14 recovery + 12
 *                 cooldown. Lockout = 38 frames — the running burst
 *                 commits harder than a tilt (37) but reads faster than
 *                 a smash (56).
 *
 * Animation states: 7 art frames — 2 startup, 2 active, 3 recovery.
 * The two active art frames let the shoulder-charge arc visibly
 * through the hit window so the lunge reads kinetically.
 */
export const WOLF_DASHATTACK: AttackMoveWithAnimation = {
  id: 'wolf.dashAttack',
  type: 'tilt',
  damage: 10,
  knockback: { x: 2.2, y: -1.4, scaling: 0.16 },
  hitbox: { offsetX: 30, offsetY: -3, width: 44, height: 24 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 14,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 2, recoveryFrames: 3 },
};

// ---------------------------------------------------------------------------
// AC 2 Sub-AC 2 — per-fighter scaffolding for the T2 refactor.
//
// The Wolf class below now declares the canonical 10-slot contract surface
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

// Sub-AC 2.2 of the T2 refactor — `WOLF_MOVEMENT_PROFILE` is now
// imported from (and re-exported at the top of) this file; the literal
// data lives in `fighterMovementProfiles.ts` so the shared `Character`
// base can resolve per-fighter movement values without a circular
// import on the per-fighter class. `WOLF_TUNING` above composes its
// movement-relevant fields by spreading `WOLF_MOVEMENT_PROFILE`, so
// the per-fighter file remains the canonical view onto Wolf's stats —
// no behavioural change vs. the previous in-file declaration.

/**
 * Wolf's full 10-slot uniform moveset (Sub-AC 2 of T2 refactor).
 *
 * Composes the existing per-move exports — already authored above for
 * the original AC 60002 Sub-AC 2 / AC 60201 Sub-AC 1 / AC 60302 Sub-AC 2
 * / AC 60202 Sub-AC 2 / AC 60304 Sub-AC 4 work — into the canonical
 * {@link FighterMoveset} shape declared by {@link movesetContract}.
 *
 * Defensive slots use the shared {@link SHIELD_DEFAULTS} /
 * {@link DODGE_DEFAULTS} until a per-character defensive balance pass
 * lands; that future work would author `WOLF_SHIELD` / `WOLF_DODGE`
 * tuning records and swap them in here without touching any consumer.
 *
 * The follow-up sub-AC migrates `Character`'s runtime to consume this
 * record directly (instead of the legacy `registerAttack` slot table).
 * Until then the constructor still calls `registerAttack(...)` so
 * existing dispatch keeps working byte-for-byte unchanged.
 */
export const WOLF_MOVESET: FighterMoveset = Object.freeze({
  jab: WOLF_JAB,
  tilt: WOLF_TILT,
  smash: WOLF_SMASH,
  fair: WOLF_FAIR,
  neutralSpecial: WOLF_NEUTRAL_SPECIAL,
  sideSpecial: WOLF_SIDE_SPECIAL,
  upSpecial: WOLF_UP_SPECIAL,
  downSpecial: WOLF_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Wolf's full {@link FighterContract} declaration (Sub-AC 2 of T2 refactor).
 * Identity + 10-slot moveset + movement profile in one record so a
 * consumer (test harness, AI predictor, balance tooling) can grab the
 * complete per-fighter declaration off a single import.
 */
export const WOLF_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'wolf',
  moveset: WOLF_MOVESET,
  movementProfile: WOLF_MOVEMENT_PROFILE,
});

/** Wolf-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface WolfOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Wolf fighter. Inherits all base movement / jump physics from
 * `Character`; ships with bruiser-tuned stats and the AC 60002 Sub-AC 2
 * grounded triplet (jab / tilt / smash) plus the Sub-AC 3.3 neutral
 * aerial. Future ACs add directional aerials and his special move.
 *
 * Sub-AC 2 of the T2 refactor: this class now exposes the canonical
 * {@link FighterContract} surface ({@link moveset}, {@link movementProfile},
 * {@link contract}) and per-slot stub methods (`executeJab` …
 * `executeDodge`). The stubs are intentionally no-op for now;
 * subsequent sub-ACs of the T2 refactor migrate the per-slot
 * attack-execution code out of {@link Character} and into these stubs.
 * Because the constructor still calls `registerAttack(...)` for every
 * move, the runtime continues dispatching through the legacy slot table
 * exactly as before — no behavioural change.
 */
export class Wolf extends ContractFighter {
  /**
   * Wolf's 10-slot uniform moveset surface (Sub-AC 2 of T2 refactor).
   * Points at the frozen {@link WOLF_MOVESET} table — every consumer that
   * wants to inspect the full per-fighter kit (AI predictor, replay HUD,
   * balance tooling) can do so via this property without re-deriving the
   * per-move map from `registerAttack` results.
   */
  readonly moveset: FighterMoveset = WOLF_MOVESET;

  /**
   * Wolf's per-fighter movement parameters (Sub-AC 2 of T2 refactor).
   * Mirrors {@link WOLF_MOVEMENT_PROFILE}. The follow-up sub-AC plumbs
   * `Character`'s movement loop to read off this property.
   */
  readonly movementProfile: FighterMovementProfile = WOLF_MOVEMENT_PROFILE;

  /**
   * Full per-fighter declaration (Sub-AC 2 of T2 refactor) — identity +
   * moveset + movement profile, exposed as a single read-only record
   * for consumers that want one handle to the whole contract.
   */
  readonly contract: FighterContract = WOLF_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: WolfOptions) {
    super(scene, {
      id: 'wolf',
      // Apply Wolf's tuning as the floor; caller-supplied options
      // (e.g. test-only mass overrides) win over the defaults via the
      // base class's spread merge.
      ...WOLF_TUNING,
      ...options,
    });
    // Registration order: jab first so it auto-fills both the light
    // dispatch slot AND the legacy `defaultAttackId` fallback. Tilt
    // registers second — the base class's "first 'jab'/'tilt' wins
    // the light slot" rule keeps jab as the press-attack default; the
    // tilt is reachable via `attemptAttack('wolf.tilt')` (input layer
    // lights it up on a stick-direction + attack press in a future
    // sub-AC). Smash and nair populate the heavy / aerial slots in
    // turn. The class contract guarantees that registering by `type`
    // lights the right dispatch slot — Sub-AC 3.3 unit tests lock that
    // down.
    registerFighterAttack(this, WOLF_JAB);
    // Jab-string stages 2 + 3 (reachable only via the chain link; jab1
    // keeps the light slot via first-registered-wins).
    registerFighterAttack(this, WOLF_JAB2);
    registerFighterAttack(this, WOLF_JAB3);
    registerFighterAttack(this, WOLF_TILT);
    registerFighterAttack(this, WOLF_SMASH);
    // Aerial cut — neutral / forward / back. AC 60002 Sub-AC 2 closes
    // out Wolf's complete move table: the legacy `WOLF_NAIR` keeps the
    // legacy single-aerial slot wired (so existing aerial-press paths
    // keep dispatching) while `WOLF_FAIR` / `WOLF_BAIR` populate the
    // forward / back directional slots via `aerialDirection`-aware
    // registration in `registerAttack`. The full triplet matches the
    // Seed's "3 aerials per character" requirement for Character 1.
    registerFighterAttack(this, WOLF_NAIR);
    registerFighterAttack(this, WOLF_FAIR);
    registerFighterAttack(this, WOLF_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt / up-smash are
    // type 'tilt'/'smash' (their forward slots are taken), so wire the
    // dedicated up slots explicitly.
    registerFighterAttack(this, WOLF_UAIR);
    registerFighterAttack(this, WOLF_DAIR);
    registerFighterAttack(this, WOLF_UTILT);
    registerFighterAttack(this, WOLF_USMASH);
    this.setUpTilt(WOLF_UTILT.id);
    this.setUpSmash(WOLF_USMASH.id);
    // Down-stick + dash grounded normals. Down-tilt / dash-attack are
    // type 'tilt' and down-smash is type 'smash' — their forward slots
    // are already taken by WOLF_TILT / WOLF_SMASH, so wire the dedicated
    // down / dash slots explicitly via the setDownTilt / setDownSmash /
    // setDashAttack dispatch setters. Down-tilt: low combo poke at the
    // feet. Down-smash: wide sweeping grounded horizontal KO. Dash-
    // attack: forward lunging running burst / combo-starter.
    registerFighterAttack(this, WOLF_DTILT);
    registerFighterAttack(this, WOLF_DSMASH);
    registerFighterAttack(this, WOLF_DASHATTACK);
    this.setDownTilt(WOLF_DTILT.id);
    this.setDownSmash(WOLF_DSMASH.id);
    this.setDashAttack(WOLF_DASHATTACK.id);
    // Neutral special — counter (AC 60201 Sub-AC 1). Auto-fills the
    // `neutralSpecialId` dispatch slot via `registerAttack`'s
    // type-based slot wiring.
    registerFighterAttack(this, WOLF_NEUTRAL_SPECIAL);
    // Side special — dash strike (AC 60302 Sub-AC 2). Registered as a
    // `'sideSpecial'`-typed move so `findMoveByType(spec, 'sideSpecial')`
    // resolves it cleanly. The follow-up sub-AC adds the `sideSpecialId`
    // dispatch slot that the input layer's "stick-side + special" press
    // resolves to. Wolf's side-special: a fixed-distance forward burst
    // with a committal body-attached hitbox.
    registerFighterAttack(this, WOLF_SIDE_SPECIAL);
    // Up special — multi-hit rising attack (AC 60202 Sub-AC 2). Auto-
    // fills the `upSpecialId` dispatch slot via `registerAttack`'s
    // type-based slot wiring. Wolf's recovery option: lifts him hard
    // straight up while dealing a multi-hit damage ladder.
    registerFighterAttack(this, WOLF_UP_SPECIAL);
    // Down special — ground pound (AC 60304 Sub-AC 4). Auto-fills the
    // `downSpecialId` dispatch slot via `registerAttack`'s type-based
    // slot wiring. Wolf's vertical-commitment tool: hop, then slam down
    // with a meteor hitbox and a landing shockwave.
    registerFighterAttack(this, WOLF_DOWN_SPECIAL);

    // Grab — post-M2 grab/throw subsystem. Registers Wolf's range-
    // sensor + 4-throw set so `Character.applyInput` ticks the
    // grab state machine on a grab-button press.
    this.setGrabSpec(WOLF_GRAB);
  }

  /**
   * Wolf's GET-UP ATTACK — the wake-up swat from knockdown (overrides
   * {@link Character.getUpAttackParams}). Bruiser flavour: a wide,
   * two-sided body-centred sweep that hits a bit harder and reaches a
   * bit further than the base default. NOT a KO move — it pops an
   * opponent away to reclaim space on wake-up.
   *
   *   • Damage 8 — toward the upper end of the 5-10 utility band; Wolf
   *     hits heavier than a small fast fighter would.
   *   • Knockback { 4.5, -3.2, 0.13 } — low-to-moderate; a touch above
   *     the base so the heavy swat shoves the opponent clear, but the
   *     scaling stays low so it never kills.
   *   • Hitbox 100×44, offsetX 0 — a two-sided sweep ~2.2× Wolf's
   *     45 px body width (the wide end of the 1.6-2.2× guidance, fitting
   *     the broad-shouldered bruiser); covers both flanks on wake-up.
   *   • Active 7 frames — middle of the 5-9 band; the heavy swing isn't
   *     as snappy as a featherweight's.
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 8,
      knockback: { x: 4.5, y: -3.2, scaling: 0.13 },
      hitbox: { offsetX: 0, offsetY: 0, width: 100, height: 44 },
      activeFrames: 7,
    };
  }

  /**
   * Wolf's LEDGE ATTACK — the edge-clearing swing on climbing back from a
   * ledge (overrides {@link Character.ledgeAttackParams}). Bruiser
   * flavour: a forward swing covering the ledge corner up onto the stage,
   * slightly wider and stronger than the base default. NOT a KO move.
   *
   *   • Damage 9 — upper end of the 5-10 band; the heavy fighter's swing.
   *   • Knockback { 4.2, -2.6, 0.15 } — low-to-moderate; pops the edge-
   *     guarder away so Wolf can reclaim the stage, scaling kept low so
   *     it stays a utility clear rather than a kill.
   *   • Hitbox 88×62, offsetX +14 — a forward swing reaching out over the
   *     ledge corner and a bit onto the stage; wider than the base to
   *     match the bruiser's broad reach.
   *   • Active 8 frames — toward the slower end of the 5-9 band, fitting
   *     the committal heavy archetype.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 9,
      knockback: { x: 4.2, y: -2.6, scaling: 0.15 },
      hitbox: { offsetX: 14, offsetY: -2, width: 88, height: 62 },
      activeFrames: 8,
    };
  }


  // Per-slot execute hooks (executeJab … executeDodge) are inherited
  // from ContractFighter, which fires each slot via the frozen
  // `moveset` declaration above — the slot ↔ move mapping lives in
  // the data table, not in per-fighter method boilerplate.
}
