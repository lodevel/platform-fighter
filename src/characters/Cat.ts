/**
 * Cat — second concrete fighter subclass (AC 202 Sub-AC 2; expanded
 * for AC 203 Sub-AC 3.3 and AC 60003 Sub-AC 3 — full grounded triplet
 * jab / tilt / smash with animation states, mirroring the work AC
 * 60002 Sub-AC 2 did for Wolf).
 *
 * Role: ninja. Light, fast, low-commitment moves; designed around
 * weaving in and out of range and racking up damage with quick pokes
 * before a finisher. Counterpart to the Wolf's bruiser archetype —
 * picking these two for the first roster cut gives us the maximum
 * stat-spread on a single screen, which is the most useful pair for
 * exercising knockback / collision / camera tracking later.
 *
 * Stats (vs `DEFAULT_CHARACTER_TUNING`):
 *
 *   maxRunSpeed   10.0  (▲)   25 % faster than baseline 8
 *   groundAccel   0.85  (▲)   reaches max speed in ~12 frames flat
 *   airAccel      0.45  (▲)   strong air-control / drift
 *   jumpImpulse   13.5  (▲)   slightly higher hop than baseline
 *   maxJumps      2            standard double-jump
 *   width/height  75×75        smaller silhouette → smaller hurtbox.
 *                              Square body matches the 50×50 cat sprite-
 *                              frame aspect (1.5× uniform display scale)
 *                              so the rendered silhouette fits the
 *                              hurtbox without per-axis stretch.
 *                              Re-tuned in AC 10404 Sub-AC 4 to align
 *                              with the real cat sprite (50×50 cells in
 *                              `assets/characters/cat/frames.json`)
 *                              instead of the legacy placeholder
 *                              rectangle (72×112); AC 10403 Sub-AC 3
 *                              re-verified the retune with explicit
 *                              hitbox-vs-sprite-frame invariants in
 *                              `characterSpec.test.ts`.
 *   mass          8    (▼)    lighter — KOd at lower percent
 *
 * Moveset (full grounded triplet + neutral aerial):
 *
 *   Jab   (`cat.jab`,   light)  damage 3, very fast safe poke (6 art frames)
 *   Tilt  (`cat.tilt`,  light)  damage 5, mid-range spacer (7 art frames)
 *   Smash (`cat.smash`, heavy)  damage 9, mid-startup KO move (8 art frames)
 *   Nair  (`cat.nair`,  aerial) damage 5, snappy aerial check
 *
 * Why a tilt distinct from jab and smash (mirrors Wolf's contract):
 *   • Jab is the safe poke — fastest startup, low damage, low knockback.
 *   • Tilt is the *spacing* tool — longer reach than jab, harder hit,
 *     more committal recovery. The "third grounded option" in the
 *     canonical Smash toolkit. For Cat, this is the move she uses to
 *     control neutral when the opponent respects jab range.
 *   • Smash is the KO finisher — biggest reach, hardest knockback
 *     scaling, longest startup so it punishes whiff-prone opponents.
 *
 * Cat's grounded triplet is faster across the board than Wolf's:
 *
 *                Cat startup   Wolf startup
 *     Jab          2 (-)         4 (▲)
 *     Tilt         5 (-)         7 (▲)
 *     Smash        8 (-)        12 (▲)
 *
 * — exactly the ninja-vs-bruiser distinction. Cat's smash hits less
 * hard than Wolf's but starts up roughly twice as fast; Cat's tilt
 * lands in 5 frames where Wolf's needs 7. Her nair is the fastest
 * move in the M2 cut (3-frame startup) so she can interrupt Wolf's
 * larger aerials cleanly with timing.
 *
 * Animation frames (AC 60003 Sub-AC 3): each grounded move declares a
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
 * `cat.jab.startup.0`, `cat.jab.active.0`, etc.; until then the
 * renderer paints flat-colour rectangles and the animation indices
 * exist purely as state-machine drivers ready for the asset drop.
 *
 * Why these numbers are encoded as exported `const`s (mirrors Wolf):
 *   • Tests can assert exactly what stats Cat ships with.
 *   • The (later AC) move-editor and balance-pass tooling can mutate
 *     these tables without recompiling the class.
 *   • Composing fighters from data tables is the M2 roster pattern —
 *     Owl / Bear follow the same shape so a roster-comparison tool
 *     can render them side-by-side.
 */

import type Phaser from 'phaser';
import { ContractFighter } from './contractFighter';
import { Character, type CharacterTuning } from './Character';
import { registerFighterAttack } from './attackRegistration';
import type { AttackMove } from './attacks';
import type { AttackMoveWithAnimation } from './moveSchema';
import type { AerialMove } from './aerialSchema';
import type { ChargeSpecialMove } from './specialSchema';
import type { MultiHitSideSpecialMove } from './sideSpecialSchema';
import type { TeleportUpSpecialMove } from './upSpecialSchema';
import type { TrapDownSpecialMove } from './downSpecialSchema';
import type { GrabSpec } from './grabSchema';
import { SHIELD_DEFAULTS } from './shieldState';
import { DODGE_DEFAULTS } from './dodgeState';
import type {
  FighterContract,
  FighterMoveset,
  FighterMovementProfile,
} from './movesetContract';
import { CAT_MOVEMENT_PROFILE } from './fighterMovementProfiles';
// Directional-attack moves authored in the shared extended-slot file —
// Cat's up-air / down-air launchers and her up-stick grounded light
// (reused here as the up-tilt). Imported so the constructor can register
// them alongside the up-smash authored in this file.
import { CAT_UAIR, CAT_DAIR, CAT_UP_LIGHT, CAT_DOWN_LIGHT } from './extendedMoves';

// Re-export so consumers that historically imported `CAT_MOVEMENT_PROFILE`
// from this file (the per-fighter API surface) keep working byte-for-byte.
// Sub-AC 2.2 of the T2 refactor moved the literal data into the
// `fighterMovementProfiles` leaf module so the shared `Character` base
// can resolve per-fighter movement values at construction time without
// pulling in a per-fighter class (which would trigger the
// `class Cat extends Character` cyclic-init TDZ). The per-fighter file
// remains the natural import location for "Cat's stats" while the
// architectural source of truth lives in one indexable place.
export { CAT_MOVEMENT_PROFILE };

// AC 60003 Sub-AC 3 closes out Cat's complete move table — 8 entries
// total (jab + tilt + smash + 2 specials + 3 aerials), exactly mirroring
// the AC 60002 Sub-AC 2 expansion that completed Wolf's table. Every
// record below ships with the full schema fields the Seed's `move`
// ontology calls out: hitbox geometry, damage %, knockback vector
// (x / y / scaling), and startup / active / recovery / cooldown frame
// counts. The aerials additionally carry the AC 60101 Sub-AC 1
// landing-lag / auto-cancel fields and the per-phase `MoveAnimation`
// block; the specials carry their `specialKind` / `upSpecialKind`
// discriminator + per-kind config (projectile, teleport).

/**
 * Tuning overrides applied on top of `DEFAULT_CHARACTER_TUNING`.
 *
 * The `shield` slot is intentionally omitted (covered by AC 60301
 * Sub-AC 1's canonical `SHIELD_DEFAULTS`); a per-character shield
 * balance pass would land here later.
 */
export const CAT_TUNING: Required<Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>> = {
  // Sub-AC 2.2 of the T2 refactor — movement-relevant fields composed
  // from `CAT_MOVEMENT_PROFILE` (the per-fighter movement profile —
  // single source of truth in `fighterMovementProfiles.ts`). Body
  // geometry (`width` / `height` / `chamfer`) remains inline below
  // because it's hurtbox / collision data, not movement parameters
  // per the {@link FighterMovementProfile} JSDoc.
  ...CAT_MOVEMENT_PROFILE,
  // AC 10404 Sub-AC 4 — body footprint re-tuned to match the real cat
  // sprite frame size (50×50 cells in `assets/characters/cat/frames.json`)
  // at a clean 1.5× uniform display scale. The 75×75 square body keeps
  // Cat the smallest silhouette in the cast (Owl is 84 wide, Wolf is
  // 100 wide, Bear is 110 wide) and renders the sprite frame without
  // per-axis stretching — the legacy 72×112 placeholder rectangle was
  // 2.24× tall and 1.44× wide vs the source cell, which visibly squashed
  // the sprite when MatchScene called `setDisplaySize(width, height)`.
  // AC 10403 Sub-AC 3 — added explicit tests in `characterSpec.test.ts`
  // that lock down both the body == cell × uniform scale rule AND the
  // per-move hitbox sizing invariants (height fits inside body,
  // jab < tilt < smash reach, chest-level offsetY, off-stage
  // cross-character clean-hit), so any future balance pass that
  // scrambles these proportions surfaces.
  // Hurtbox MATCHES the visible sprite silhouette on-screen — derived
  // from the native sprite frame (50×50) where the cat art occupies
  // x:11-37 (~18 cols), y:21-49 (29 rows), rendered at sprite display
  // 112×112 px. So visible-on-screen ≈ 112 × 18/50 × 29/50 ≈ 40×65 px,
  // and the collision body matches.
  //
  // See WOLF_TUNING for the future-scale-multiplier architecture note.
  width: 40,
  height: 65,
  chamfer: 6,
  // `mass` is sourced from the spread of `CAT_MOVEMENT_PROFILE` above
  // (Sub-AC 2.2 of the T2 refactor — the per-fighter movement profile
  // is the single source of truth for knockback-resistance mass).
};

/**
 * Cat's basic neutral attack. Quick poke — low damage, very low
 * recovery, tiny cooldown. AC 202 Sub-AC 2 acceptance: hitbox spawn
 * (50×40 sensor 36 px in front), damage value (3 %), cooldown (6
 * frames after recovery → ~100 ms).
 *
 * Animation states (AC 60003 Sub-AC 3): 6 art frames total — 2 startup,
 * 1 active, 3 recovery. Stretch over the gameplay window via
 * `selectAnimationFrame()`:
 *   startup [0..1]  → art 0 (frame 0) → art 1 (frame 1)
 *   active  [2..3]  → art 0 throughout (single-frame hit pose)
 *   recovery[4..8]  → art 0 (4-5) → art 1 (6) → art 2 (7-8)
 */
export const CAT_JAB: AttackMoveWithAnimation = {
  id: 'cat.jab',
  type: 'jab',
  damage: 3,
  knockback: { x: 0.7, y: -0.2, scaling: 0.04 },
  hitbox: {
    // Authored facing-right; `Character` mirrors by facing on spawn.
    // AC 10404 Sub-AC 4 — re-tuned for the 75×75 body that aligns with
    // the real 50×50 cat sprite frame. Cat is 75 px wide (half-width
    // 37.5), so a 38 px offset puts the hitbox just past her paw and a
    // 52 px width keeps the leading edge ~26 px past her body. Height
    // 28 is "chest level" on the new 75-tall body (~37 % of body
    // height, mirroring the legacy 40/112 ≈ 36 % ratio).
    offsetX: 20,
    offsetY: -2,
    width: 28,
    height: 15,
  },
  startupFrames: 2,
  activeFrames: 2,
  recoveryFrames: 5,
  cooldownFrames: 6,
  animation: {
    startupFrames: 2,
    activeFrames: 1,
    recoveryFrames: 3,
  },
  // Jab-combo opener: a re-press once jab1's hitbox is out advances to
  // jab2 → jab3 (the finisher). Mirrors the Wolf jab-string contract.
  jabChain: { nextId: 'cat.jab2' },
};

/**
 * Cat jab string — stage 2. A quick follow-up poke that chains from
 * {@link CAT_JAB} on a re-press and itself links to the {@link CAT_JAB3}
 * finisher. Registered as a `'jab'` move but never the light slot
 * (first-registered jab1 keeps it) — reachable ONLY via the chain link.
 * Faster and slightly weaker than jab1: damage ≈ round(jab1 × 0.7),
 * knockback a touch lighter, hitbox nudged out so the second poke reads
 * as reaching a hair further than the opener.
 */
export const CAT_JAB2: AttackMoveWithAnimation = {
  id: 'cat.jab2',
  type: 'jab',
  damage: 2,
  knockback: { x: 0.6, y: -0.2, scaling: 0.03 },
  hitbox: { offsetX: 22, offsetY: -2, width: 28, height: 15 },
  startupFrames: 2,
  activeFrames: 2,
  recoveryFrames: 4,
  cooldownFrames: 4,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 3 },
  jabChain: { nextId: 'cat.jab3' },
};

/**
 * Cat jab string — finisher (stage 3). The launcher that ends the
 * string: clearly bigger knockback (x and y) plus a `baseMagnitude`
 * floor so it pops the opponent away even at low percent. Slower /
 * more committal than jab1 (longer recovery + cooldown). No `jabChain` —
 * the chain terminates here, and its `cooldownFrames` is the
 * post-string lockout. Mirrors the Wolf jab-string finisher contract.
 */
export const CAT_JAB3: AttackMoveWithAnimation = {
  id: 'cat.jab3',
  type: 'jab',
  damage: 3,
  knockback: { x: 2.4, y: -1.6, scaling: 0.15, baseMagnitude: 1.0 },
  hitbox: { offsetX: 24, offsetY: -2, width: 32, height: 17 },
  startupFrames: 3,
  activeFrames: 3,
  recoveryFrames: 11,
  cooldownFrames: 12,
  animation: { startupFrames: 2, activeFrames: 1, recoveryFrames: 4 },
};

/**
 * Cat's forward tilt — the third grounded option after jab and smash
 * (AC 60003 Sub-AC 3). Mid-strength committal poke that fills the
 * spacing role between jab and smash, mirroring the contract Wolf's
 * tilt shipped with in AC 60002 Sub-AC 2:
 *
 *   • Reach     : 46 px offset, 62×30 hitbox — longer than jab (38, 52)
 *                 but shorter than smash (52, 72). Trades hurtbox
 *                 extension for coverage; you're committed for ~5
 *                 startup frames before the hitbox spawns, and the
 *                 windup hurtbox sticks out a bit on the swing.
 *                 AC 10404 Sub-AC 4 — dimensions re-tuned for the
 *                 75×75 body that matches the real 50×50 cat sprite
 *                 frame.
 *   • Damage    : 5 — between jab (3) and smash (9). At ~80 % the
 *                 knockback puts Wolf into a tumble but doesn't KO him
 *                 from centre-stage; smash is still the finisher.
 *   • Knockback : x 1.5 / y -0.5, scaling 0.12. Stronger than jab's
 *                 0.04 scaling so the move opens KO percent later;
 *                 weaker than smash's 0.30 so it can't accidentally
 *                 end stocks during neutral exchanges.
 *   • Frames    : 5 startup / 3 active / 9 recovery + 11 cooldown.
 *                 Lockout = 28 frames (~467 ms). Slower than jab
 *                 (15 frames) but faster than smash (41 frames) — the
 *                 canonical "neutral game" tempo for Cat. Notice that
 *                 every phase is shorter than Wolf's tilt (7/4/12+14
 *                 = 37 frames) — Cat's ninja archetype gets through her
 *                 spacing tool meaningfully faster than Wolf gets
 *                 through his.
 *
 * Animation states: 7 art frames total — 2 startup, 2 active, 3
 * recovery. The two active art frames let the swing show through the
 * hit window so it doesn't look like a single-frame freeze frame
 * (mirrors Wolf's tilt animation budget):
 *   startup [0..4]   → art 0 (frames 0-1) → art 1 (frames 2-4)
 *   active  [5..7]   → art 0 (5) → art 1 (6-7)
 *   recovery[8..16]  → art 0 (8-10) → art 1 (11-13) → art 2 (14-16)
 */
export const CAT_TILT: AttackMoveWithAnimation = {
  id: 'cat.tilt',
  type: 'tilt',
  damage: 5,
  knockback: { x: 1.5, y: -0.5, scaling: 0.12 },
  hitbox: {
    offsetX: 24,
    offsetY: -3,
    width: 33,
    height: 16,
  },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 11,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 3,
  },
};

/**
 * Cat's heavy attack — forward smash. Faster startup than Wolf's
 * (8 vs 12 frames), lower damage, slightly less knockback scaling.
 * The trade is exactly the ninja-vs-bruiser archetype distinction:
 * Cat lands her finisher more often but Wolf's lands harder.
 *
 *   damage 9, knockback 2.8/-1.2 with 0.30 scaling.
 *   startup 8 (~133 ms), active 3, recovery 14, cooldown 16.
 *   Press-to-press lockout = 41 frames (~683 ms).
 *
 * Animation states (AC 60003 Sub-AC 3): 8 art frames total — 3 startup,
 * 1 active, 4 recovery. The wind-up gets the most art frames so the
 * "anticipation" reads clearly to the opponent (a fair smash in the
 * canonical Smash idiom telegraphs its commitment). Recovery also gets
 * generous art frame budget so the "punished swing" pose holds long
 * enough to register visually:
 *   startup [0..7]   → art 0 (0-2) → art 1 (3-5) → art 2 (6-7)
 *   active  [8..10]  → art 0 throughout (the impact frame)
 *   recovery[11..24] → art 0 (11-14) → art 1 (15-18) → art 2 (19-21) → art 3 (22-24)
 */
export const CAT_SMASH: AttackMoveWithAnimation = {
  id: 'cat.smash',
  type: 'smash',
  damage: 9,
  knockback: { x: 2.8, y: -1.2, scaling: 0.3, baseMagnitude: 1.0, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 9,
    maxDamage: 12.6,
    minKnockback: { x: 2.8, y: -1.2, scaling: 0.3, baseMagnitude: 1.0, damageGrowth: 0.5 },
    maxKnockback: { x: 3.92, y: -1.68, scaling: 0.375, baseMagnitude: 1.0, damageGrowth: 0.5 },
  },
  // AC 10404 Sub-AC 4 — re-tuned for the 75×75 body. Reach (52 px
  // offset) is the longest grounded option (jab 38, tilt 46, smash 52)
  // and the 72×34 hitbox is the largest, mirroring the legacy
  // jab<tilt<smash reach gradient at the new body scale.
  hitbox: {
    offsetX: 28,
    offsetY: -3,
    width: 38,
    height: 18,
  },
  startupFrames: 8,
  activeFrames: 3,
  recoveryFrames: 14,
  cooldownFrames: 16,
  animation: {
    startupFrames: 3,
    activeFrames: 1,
    recoveryFrames: 4,
  },
};

/**
 * Cat's up-smash — a rising vertical strike (up-stick + heavy). The
 * grounded vertical KO move, mirroring the AC 60002 Sub-AC 2 work that
 * gave Wolf his up-smash. Like Wolf's, this is the canonical "charge it
 * under a juggled opponent" finisher — slow startup punishes whiffs, but
 * a clean hit launches straight up off the top blast zone.
 *
 * Ninja-tuned vs Wolf's up-smash (dmg 16 / startup 12 / scaling 0.42):
 * Cat starts up faster and hits softer, the same fast-but-weaker trade
 * her forward smash makes against Wolf's (Cat smash dmg 9 / startup 8 vs
 * Wolf smash dmg 14 / startup 12). The KB vector mirrors her forward
 * smash's SHAPE — `baseMagnitude: 1.0` + `damageGrowth: 0.5` matching
 * CAT_SMASH — but rotated vertical: a near-zero horizontal push with a
 * hard upward launch (y -3.2) and the steepest percent-scaling in Cat's
 * grounded kit (0.36) so it opens KO percent like a real smash.
 *
 *   damage 13, knockback 0.3/-3.2 with 0.36 scaling.
 *   startup 12 (~200 ms), active 3, recovery 16, cooldown 18.
 *   Press-to-press lockout = 37 frames (~617 ms). Faster startup than
 *   Wolf's up-smash (12 vs 12 startup but lighter recovery/cooldown).
 *
 * Hitbox: a tall dome over Cat's body (offsetX 0, width 48 so it clears
 * both flanks of the 40-wide body, dropping to y +5 so a grounded
 * opponent standing beside Cat is caught too — not an overhead-only
 * column). Reaches well above the 65-tall body for the canonical
 * anti-air / juggle-finisher coverage. Mirrors the reshaped up-stick
 * geometry of CAT_UP_LIGHT but reaches higher and hits far harder.
 *
 * Animation states: 8 art frames total — 3 startup, 1 active, 4 recovery
 * (mirrors CAT_SMASH's anticipation curve so the heavy wind-up reads
 * clearly to the opponent).
 */
export const CAT_USMASH: AttackMoveWithAnimation = {
  id: 'cat.usmash',
  type: 'smash',
  damage: 13,
  knockback: { x: 0.3, y: -3.2, scaling: 0.36, baseMagnitude: 1.0, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 13,
    maxDamage: 18.2,
    minKnockback: { x: 0.3, y: -3.2, scaling: 0.36, baseMagnitude: 1.0, damageGrowth: 0.5 },
    maxKnockback: { x: 0.42, y: -4.48, scaling: 0.45, baseMagnitude: 1.0, damageGrowth: 0.5 },
  },
  hitbox: {
    offsetX: 9,
    offsetY: -25,
    width: 60,
    height: 60,
  },
  startupFrames: 12,
  activeFrames: 3,
  recoveryFrames: 16,
  cooldownFrames: 18,
  animation: {
    startupFrames: 3,
    activeFrames: 1,
    recoveryFrames: 4,
  },
};

/**
 * Cat's down-smash — a sweeping low strike at the feet (down-stick +
 * heavy). The grounded HORIZONTAL KO move, mirroring the AC 60002
 * Sub-AC 2 work that gave Wolf his directional smashes. Where her
 * up-smash launches a juggled opponent straight up, the down-smash
 * sweeps anyone standing next to Cat outward and low — the canonical
 * "2-frame at the ledge" / "hit the roller" coverage.
 *
 * Ninja-tuned vs the bruiser scale: Cat's down-smash starts up faster
 * and hits softer than a heavyweight's would, the same fast-but-weaker
 * trade her forward smash makes. The KB vector mirrors her forward
 * smash's SHAPE — `baseMagnitude: 1.0` + `damageGrowth: 0.5` matching
 * CAT_SMASH, with the same 0.30 percent-scaling — so it opens KO
 * percent like a real smash. The launch is hard-horizontal with a
 * slight downward tilt (y -0.6 vs the forward smash's -1.2) so it
 * sends low toward the side blast zone rather than popping up.
 *
 *   damage 10, knockback 3.0/-0.6 with 0.30 scaling.
 *   startup 13 (~217 ms), active 3, recovery 15, cooldown 16.
 *   Press-to-press lockout = 47 frames (~783 ms). Slowest startup in
 *   Cat's grounded kit — the deliberate KO commitment.
 *
 * Hitbox: a WIDE, low sweep at the feet (offsetY +12 reaching down to
 * ground level, large width 54, short height 16) — the canonical
 * down-smash footprint. Reaches further horizontally than her forward
 * smash (38 wide) so the sweep catches an opponent rolling behind or
 * landing next to her.
 *
 * Animation states: 8 art frames total — 3 startup, 1 active, 4
 * recovery (mirrors CAT_SMASH's anticipation curve so the heavy
 * wind-up reads clearly to the opponent).
 */
export const CAT_DSMASH: AttackMoveWithAnimation = {
  id: 'cat.dsmash',
  type: 'smash',
  damage: 10,
  knockback: { x: 3.0, y: -0.6, scaling: 0.3, baseMagnitude: 1.0, damageGrowth: 0.5 },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 60,
    minDamage: 10,
    maxDamage: 14,
    minKnockback: { x: 3.0, y: -0.6, scaling: 0.3, baseMagnitude: 1.0, damageGrowth: 0.5 },
    maxKnockback: { x: 4.2, y: -0.84, scaling: 0.375, baseMagnitude: 1.0, damageGrowth: 0.5 },
  },
  hitbox: {
    offsetX: 14,
    offsetY: 12,
    width: 54,
    height: 16,
  },
  startupFrames: 13,
  activeFrames: 3,
  recoveryFrames: 15,
  cooldownFrames: 16,
  animation: {
    startupFrames: 3,
    activeFrames: 1,
    recoveryFrames: 4,
  },
};

/**
 * Cat's dash-attack — a forward lunging hit thrown while running. The
 * running burst / combo-starter, mirroring the AC 60002 Sub-AC 2 work
 * on Wolf's directional grounded normals. Used to close distance and
 * convert a dash-in into a combo: a forward hitbox out in front of her
 * sprint, moderate forward-and-up knockback that pops the opponent into
 * Cat's juggle range above her air-jump arc.
 *
 * Weaker than a smash by design — it's an approach tool, not a finisher.
 * Sits between her tilt (dmg 5) and forward smash (dmg 9) on damage, with
 * a forward+up launch (vs the smash's flat-and-hard push) so a clean dash
 * attack at low percent flows straight into a follow-up uair / nair. Fast
 * for a dash attack (startup 7) true to her ninja archetype — she's in
 * and hitting before a heavier fighter would have committed.
 *
 *   damage 7, knockback 1.8/-1.2 with 0.14 scaling.
 *   startup 7 (~117 ms), active 3, recovery 11, cooldown 10.
 *   Press-to-press lockout = 31 frames (~517 ms).
 *
 * Hitbox: a forward sensor out in front of the running body (offsetX
 * +30, 52×24) — reaches past her smash's lead (offsetX 28) so the lunge
 * connects at the end of a dash. Chest-level (offsetY -2).
 *
 * Animation states: 7 art frames total — 2 startup, 2 active, 3 recovery.
 * The two active art frames let the lunge arc show through the hit
 * window (mirrors the tilt animation budget).
 */
export const CAT_DASHATTACK: AttackMoveWithAnimation = {
  id: 'cat.dashAttack',
  type: 'tilt',
  damage: 7,
  knockback: { x: 1.8, y: -1.2, scaling: 0.14 },
  hitbox: {
    offsetX: 30,
    offsetY: -2,
    width: 52,
    height: 24,
  },
  startupFrames: 7,
  activeFrames: 3,
  recoveryFrames: 11,
  cooldownFrames: 10,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 3,
  },
};

/**
 * Cat's neutral aerial — a quick spinning kick wrapped around her body.
 * Fastest move in the M2 cut at 3 frames of startup; very low damage
 * but Cat can chain into another nair off the air-jump while Wolf is
 * still in his nair's recovery.
 *
 *   damage 5, knockback 1.0/-0.8 with 0.08 scaling.
 *   startup 3, active 4, recovery 8, cooldown 6.
 *   Press-to-press lockout = 21 frames (~350 ms).
 *
 * Note: this `AttackMove`-typed export remains the moveset entry
 * registered by `Cat`'s constructor for backwards compatibility with
 * the AC 203 Sub-AC 3.3 + AC 60003 Sub-AC 3 contracts. The
 * AC 60101 Sub-AC 1 aerial-data record (`CAT_NAIR_AERIAL`) declared
 * below carries the same gameplay numbers plus the new
 * landing-lag / auto-cancel fields and the animation block; the
 * follow-up sub-AC swaps `CAT_NAIR` for `CAT_NAIR_AERIAL` in the
 * registration list once the runtime lockout handler ships.
 */
export const CAT_NAIR: AttackMove = {
  id: 'cat.nair',
  type: 'aerial',
  damage: 5,
  knockback: { x: 1.0, y: -0.8, scaling: 0.08 },
  // AC 10404 Sub-AC 4 — body-centred sphere hitbox re-tuned for the
  // 75×75 body. 84 px wide (slightly wider than the body so the spin
  // catches a same-frame approach from either side) and 60 px tall
  // (covers about ⅔ of the body height — generous active window for
  // the 4-frame hit window).
  hitbox: {
    offsetX: 0,
    offsetY: -1,
    width: 45,
    height: 32,
  },
  startupFrames: 3,
  activeFrames: 4,
  recoveryFrames: 8,
  cooldownFrames: 6,
};

/**
 * Cat's neutral aerial — full `AerialMove` record (AC 60101 Sub-AC 1).
 *
 * Same gameplay numbers as `CAT_NAIR` plus:
 *
 *   • `aerialDirection: 'neutral'`.
 *   • Animation: 6 art frames — 1 startup + 3 active + 2 recovery
 *     (mirrors Wolf's nair animation budget).
 *   • Knockback launch angle: atan2(0.8, 1.0) ≈ 39° up-and-forward —
 *     more vertical than Wolf's nair (32°), pushing the target into
 *     Cat's juggle range above her air-jump arc. Classic ninja
 *     "fishing for the air-combo" trajectory.
 *   • `landingLagFrames: 6` — the lightest landing lag in the M2 cut.
 *     Cat's ninja archetype gets to throw nair on landing and dash
 *     in for a tilt before her opponent has time to react. This is
 *     the move's defining strength: nair → land → tilt is a real
 *     combo at low percent.
 *   • `autoCancelWindows`:
 *       - `[0, 3)` — pre-hitbox early-out (covers the entire
 *         3-frame startup so a twitch-press before landing is
 *         penalty-free).
 *       - `[14, 21)` — late window starting AFTER the recovery's
 *         "committed" early frames. Cat lands clean off a
 *         well-timed nair on the way down; the recovery's first six
 *         frames still incur lag if she clips the floor too early.
 */
export const CAT_NAIR_AERIAL: AerialMove = {
  id: 'cat.nair',
  type: 'aerial',
  aerialDirection: 'neutral',
  damage: 5,
  knockback: { x: 1.0, y: -0.8, scaling: 0.08 },
  // Mirrors `CAT_NAIR.hitbox` — see AC 10404 Sub-AC 4 retuning above.
  hitbox: {
    offsetX: 0,
    offsetY: -1,
    width: 45,
    height: 32,
  },
  startupFrames: 3,
  activeFrames: 4,
  recoveryFrames: 8,
  cooldownFrames: 6,
  animation: {
    startupFrames: 1,
    activeFrames: 3,
    recoveryFrames: 2,
  },
  landingLagFrames: 6,
  autoCancelWindows: [
    { startFrame: 0, endFrame: 3 },
    { startFrame: 14, endFrame: 15 },
  ],
};

/**
 * Cat's forward aerial — a snap-out forward paw swipe. The fastest
 * fair in the M2 cut, true to her ninja archetype: she throws fair
 * to interrupt an approaching Wolf or to extend her air mobility
 * while keeping a hitbox in front. Low damage / knockback compared
 * to Wolf's fair, paid back in startup speed.
 *
 *   • Damage    : 6 — between her nair (5) and her grounded smash (9).
 *   • Knockback : x 1.6 / y -0.5, scaling 0.12.
 *                 Launch angle = atan2(0.5, 1.6) ≈ 17° up-and-forward
 *                 — almost flat, sending the target horizontally for
 *                 stage-control rather than juggle setup.
 *   • Frames    : 4 startup / 3 active / 9 recovery + 6 cooldown.
 *                 Lockout = 22 frames (~367 ms). Half the lockout of
 *                 Wolf's fair (36 frames).
 *   • Hitbox    : 46 px offset, 62×32 sensor — Cat's body is 75 px
 *                 wide (AC 10404 Sub-AC 4) so a 46 px offset puts the
 *                 hitbox just past her paw, comparable in reach to her
 *                 grounded tilt.
 *
 * Animation states: 6 art frames — 1 startup, 2 active, 3 recovery.
 * Tight startup, expressive recovery (the "drift through the air
 * after the swipe" pose holds three frames so the Cat-ninja silhouette
 * reads cleanly).
 *
 *   • landingLagFrames: 5 — even lighter than her nair's. Cat lands,
 *     dashes, tilts. The ninja-pressure tool.
 *   • autoCancelWindows:
 *       - `[0, 4)` — entire pre-active window auto-cancels.
 *       - `[15, 16)` — late frame just before move ends.
 */
export const CAT_FAIR: AerialMove = {
  id: 'cat.fair',
  type: 'aerial',
  aerialDirection: 'forward',
  damage: 6,
  knockback: { x: 1.6, y: -0.5, scaling: 0.12 },
  hitbox: {
    offsetX: 24,
    offsetY: -2,
    width: 33,
    height: 17,
  },
  startupFrames: 4,
  activeFrames: 3,
  recoveryFrames: 9,
  cooldownFrames: 6,
  animation: {
    startupFrames: 1,
    activeFrames: 2,
    recoveryFrames: 3,
  },
  landingLagFrames: 5,
  autoCancelWindows: [
    { startFrame: 0, endFrame: 4 },
    { startFrame: 15, endFrame: 16 },
  ],
};

/**
 * Cat's back aerial — a backward spin-kick. The roster archetype
 * expectation flips here: bairs are usually a heavy character's KO
 * tool, but Cat's bair is her PRIMARY KO move (she has no smash-tier
 * hit besides her grounded smash). Lighter damage than Wolf's bair,
 * lighter knockback magnitude, but unmatched startup speed makes it
 * a legitimate finisher off a juggle: nair up → drift back → bair.
 *
 *   • Damage    : 8 — second-hardest in Cat's kit (after her smash 9).
 *   • Knockback : x 2.2 / y -0.85, scaling 0.22.
 *                 Launch angle = atan2(0.85, 2.2) ≈ 21° up-and-back
 *                 — Cat's "kill move at the ledge" trajectory. Sends
 *                 the target horizontally toward the side blast zone
 *                 with enough vertical to clear the ledge guard.
 *   • Frames    : 5 startup / 3 active / 11 recovery + 8 cooldown.
 *                 Lockout = 27 frames (~450 ms). Faster than her fair
 *                 active phase to trade off against, but fair has
 *                 the lighter recovery / landing-lag.
 *   • Hitbox    : 50 px offset, 66×36 sensor authored facing-right
 *                 (AC 10404 Sub-AC 4 — re-tuned for the 75×75 body
 *                 that matches the real 50×50 cat sprite frame); the
 *                 runtime mirrors it on spawn so when Cat is facing
 *                 right and the player throws bair, the hitbox spawns
 *                 to her LEFT (the bair direction).
 *
 * Animation states: 7 art frames — 2 startup, 2 active, 3 recovery.
 * The two-frame active window lets the spin-kick arc visibly through
 * the hit window.
 *
 *   • landingLagFrames: 8 — heavier than her nair / fair because
 *     Cat's bair is the closest she has to a "committal" aerial. A
 *     whiffed bair on landing leaves her vulnerable to a dash-in tilt.
 *   • autoCancelWindows:
 *       - `[0, 4)` — pre-hitbox early-out.
 *       - `[18, 19)` — late frame near the end of recovery.
 */
export const CAT_BAIR: AerialMove = {
  id: 'cat.bair',
  type: 'aerial',
  aerialDirection: 'back',
  damage: 8,
  knockback: { x: 2.2, y: -0.85, scaling: 0.22 },
  hitbox: {
    offsetX: 26,
    offsetY: -2,
    width: 35,
    height: 19,
  },
  startupFrames: 5,
  activeFrames: 3,
  recoveryFrames: 11,
  cooldownFrames: 8,
  animation: {
    startupFrames: 2,
    activeFrames: 2,
    recoveryFrames: 3,
  },
  landingLagFrames: 8,
  autoCancelWindows: [
    { startFrame: 0, endFrame: 4 },
    { startFrame: 18, endFrame: 19 },
  ],
};

/**
 * Cat's neutral special — **projectile** (AC 60201 Sub-AC 1).
 *
 * The ninja's special is a thrown shuriken: small, fast, low-damage,
 * ranged. Slots Cat into the "annoy from range while you can't" niche
 * and gives her ninja archetype a real long-distance presence — the
 * grounded triplet keeps her dominant up close, the projectile keeps
 * her relevant when the opponent backs off.
 *
 * Mechanic:
 *   • Frames 5-9 of the move are the "spawn window" (active phase).
 *     On the spawn frame the runtime emits a separate sensor body that
 *     travels horizontally at 14 px/step in the direction Cat was
 *     facing on the press frame.
 *   • Projectile lifetime is 60 frames (~1 s) — long enough to cross
 *     about ⅔ of the screen at the chosen speed before timing out.
 *   • Damage on contact: 4%. Light hits, lightweight knockback —
 *     this is a poke that racks up percent, not a finisher.
 *   • Projectile despawns on contact OR when its lifetime expires
 *     (whichever comes first).
 *
 *   • Damage    : 0 base (move's own hitbox is unused; the projectile
 *                 carries its own damage value through the runtime's
 *                 projectile-spawn handler).
 *   • Knockback : 0 base (same reason).
 *   • Frames    : 5 startup / 5 active / 9 recovery + 14 cooldown.
 *                 Lockout = 33 frames (~550 ms). Cat can chuck two
 *                 shurikens per second uncontested at neutral range.
 *
 * Animation states (6 art frames): 2 startup, 1 active, 3 recovery —
 * the throwing motion is a brief snap (single active art frame for the
 * extended-arm pose); recovery animates the arm returning to her side.
 *
 * Projectile spec:
 *   • speed         : 14 px/step (≈ 840 px/s) — fast, ninja-coded.
 *   • lifetimeFrames: 60 frames (1 s).
 *   • dimensions    : 32×24 sensor (small, hard to dodge but small
 *                     hurtbox-coverage too).
 *   • spawn offset  : 52 px in front of Cat's centre, 4 px above —
 *                     looks like it came out of her paw. AC 10404
 *                     Sub-AC 4 — re-tuned for the 75×75 body.
 *   • damage        : encoded on the projectile's own
 *                     `move.damage`-equivalent — see the (future)
 *                     projectile-runtime that consumes this record.
 */
/**
 * Cat's neutral special — **focused-strike (charge)**.
 *
 * Pivoted away from a projectile so Owl is the roster's sole zoner —
 * Cat now charges chi for a close-range piercing strike. Damage and
 * knockback scale with how long the player holds the press, then
 * release within the active window to unleash. Mid-range hitbox
 * (forward of Cat's body) keeps Cat's "ninja in your face" identity.
 */
export const CAT_NEUTRAL_SPECIAL: ChargeSpecialMove = {
  id: 'cat.neutral_special',
  type: 'special',
  specialKind: 'charge',
  // Move-level damage carries the MIN-CHARGE values so an AI predictor
  // reading an `AttackMove` sees the worst-case-power baseline.
  damage: 8,
  knockback: { x: 1.8, y: -0.6, scaling: 0.10 },
  // Forward strike — slightly past Cat's smash (offsetX 28, w 38).
  hitbox: {
    offsetX: 36,
    offsetY: -3,
    width: 50,
    height: 30,
  },
  startupFrames: 4,
  activeFrames: 14,
  recoveryFrames: 16,
  cooldownFrames: 12,
  animation: {
    startupFrames: 1,
    activeFrames: 4,
    recoveryFrames: 3,
  },
  charge: {
    minChargeFrames: 0,
    maxChargeFrames: 50,
    minDamage: 8,
    maxDamage: 18,
    minKnockback: { x: 1.8, y: -0.6, scaling: 0.10 },
    maxKnockback: { x: 3.6, y: -1.4, scaling: 0.36 },
  },
};

/**
 * Cat's side special — **multi-hit flurry** (AC 60302 Sub-AC 2).
 *
 * The ninja's side-special is the canonical "Dancing Blade / Forward Tilt
 * cancel-extension" archetype — Cat strikes 3 times in a quick forward
 * flurry, with each hit chainable via a re-press of the special button.
 * Slots Cat into the "string-the-opponent" niche on the side+special press:
 * tight per-hit damage with a finisher launch on the third swing.
 *
 *   • The first hit fires on the first frame of the active phase.
 *   • Subsequent hits fire `hitInterval = 4` frames apart.
 *   • Per-hit damage ladder: `[3, 4, 6]` — the first two are link hits
 *     (lock the target in light hitstun), the third is a launcher.
 *   • Per-hit knockback ladder: small (lock-in) for hits 1-2, heavier
 *     (KO trajectory) for hit 3.
 *   • `chainWindowFrames = 8` — the player must re-press special within
 *     8 frames of a hit landing to extend the move into the next swing.
 *     Missing the window terminates the move at the current hit's
 *     recovery, which is canonical "input-tightness" pressure for the
 *     ninja archetype.
 *
 *   • Damage    : 3 base (move's own `damage` carries the FIRST-hit
 *                 value so an AI predictor reading just `AttackMove`
 *                 sees the worst-case-power read).
 *   • Knockback : x 1.0 / y -0.2, scaling 0.04 base — link-hit values.
 *   • Frames    : 5 startup / 12 active / 12 recovery + 14 cooldown.
 *                 Lockout = 43 frames (~717 ms). The 12-frame active
 *                 window comfortably fits the ladder
 *                 (final hit at frame 8 < 12).
 *
 * Animation states (7 art frames): 2 startup, 3 active, 2 recovery —
 * the active "swing-swing-swing" phase gets the most art frames so each
 * of the three hits has its own pose.
 *
 * MultiHit spec:
 *   • hitCount       : 3
 *   • hitInterval    : 4 frames — hits land at active-frames [0, 4, 8]
 *   • damagePerHit   : [3, 4, 6] — escalating damage with the launcher
 *                      finisher dealing the most.
 *   • knockbackPerHit:
 *       0: { x: 1.0, y: -0.2, scaling: 0.04 } — light lock
 *       1: { x: 1.2, y: -0.3, scaling: 0.06 } — light lock
 *       2: { x: 2.6, y: -1.4, scaling: 0.22 } — KO launcher
 *   • chainWindowFrames: 8 — re-press window. Skill-test on the input
 *                          layer; missing the window ends the move.
 *   • Hitbox         : reuses move's `hitbox` field (62×34 sensor 46 px
 *                      in front), the same reach as Cat's tilt
 *                      (AC 10404 Sub-AC 4 retune).
 */
export const CAT_SIDE_SPECIAL: MultiHitSideSpecialMove = {
  id: 'cat.side_special',
  type: 'sideSpecial',
  sideSpecialKind: 'multiHit',
  // Move's `damage` / `knockback` carry the FIRST-HIT values so an AI
  // predictor reading an `AttackMove` sees the worst-case-power read
  // — better default than overstating its threat.
  // Bumped from 3 → 8 on first hit so the multi-hit chain reaches
  // smash-tier total damage (final hit retains its KO launcher).
  damage: 8,
  knockback: { x: 1.4, y: -0.3, scaling: 0.06 },
  hitbox: {
    // Widened from 33×18 → 50×28 so Cat's side-special reads as a
    // deliberate hit, not a quick poke. Forward offset bumped so
    // the leading edge sits past Cat's smash reach (offsetX 28).
    offsetX: 32,
    offsetY: -3,
    width: 50,
    height: 28,
  },
  startupFrames: 5,
  activeFrames: 12,
  recoveryFrames: 12,
  cooldownFrames: 14,
  animation: {
    startupFrames: 2,
    activeFrames: 3,
    recoveryFrames: 2,
  },
  multiHit: {
    hitCount: 3,
    hitInterval: 4, // hits at active-frames [0, 4, 8]
    damagePerHit: [3, 4, 6],
    knockbackPerHit: [
      { x: 1.0, y: -0.2, scaling: 0.04 }, // hit 1 — link
      { x: 1.2, y: -0.3, scaling: 0.06 }, // hit 2 — link
      { x: 2.6, y: -1.4, scaling: 0.22 }, // hit 3 — launcher
    ],
    chainWindowFrames: 8,
  },
};

/**
 * Cat's up special — **teleport** (AC 60202 Sub-AC 2).
 *
 * The ninja's recovery is a *vanish + reappear* — Cat dissolves into
 * smoke for a brief invincible window, then reappears at a fixed
 * offset in the chosen direction. Mirrors the canonical Smash teleport
 * archetype (Mewtwo's Teleport, Sheik's Vanish, Zelda's Farore's
 * Wind). The hardest-to-edge-guard recovery in the cast — there is no
 * "interruptible" arc, just a vanish and a reappear.
 *
 * Recovery characteristics:
 *   • teleportDistance = 280 px — significantly longer than Cat's
 *     jump arc, lets her cover most off-stage knockbacks in one move.
 *   • snapToOctant = true — 8-direction recovery (the canonical Smash
 *     teleport idiom). A neutral stick defaults to "straight up" via
 *     `snapStickToOctant`.
 *   • invincibilityFrames = 14 — the entire active phase. Cat cannot
 *     be hit during the vanish; the ONLY edge-guard window is the
 *     reappearance frame and the recovery animation after it.
 *
 * Combat characteristics:
 *   • Damage = 0. The teleport carries no hitbox — pure mobility move.
 *   • Knockback = 0. No "appearance shockwave" in this v1; the move's
 *     value is the safety + reach, not the damage.
 *
 *   • Frames    : 4 startup / 14 active / 16 recovery + 14 cooldown.
 *                 Lockout = 48 frames (~800 ms). Slightly faster than
 *                 Wolf's up-special (62) — Cat's archetype rewards
 *                 quick movement.
 *
 * Animation states (8 art frames): 2 startup, 4 active, 2 recovery —
 * the active "vanish" phase gets the most art frames so the smoke /
 * particle dissolve has time to read.
 *
 * Hitbox geometry: a degenerate sensor — the move has no proactive
 * hitbox; the runtime branches on `upSpecialKind === 'teleport'`
 * before consulting `move.hitbox`.
 */
export const CAT_UP_SPECIAL: TeleportUpSpecialMove = {
  id: 'cat.up_special',
  type: 'upSpecial',
  upSpecialKind: 'teleport',
  // No damage / knockback — teleport is a pure mobility move.
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  // Degenerate sensor — non-zero so the schema accepts it but never
  // spawned because the runtime branches on `upSpecialKind` first.
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 4,
  activeFrames: 14,
  recoveryFrames: 16,
  cooldownFrames: 14,
  animation: {
    startupFrames: 2,
    activeFrames: 4,
    recoveryFrames: 2,
  },
  teleport: {
    teleportDistance: 280,
    invincibilityFrames: 14, // = activeFrames; entire vanish is invincible
    snapToOctant: true,
  },
};

/**
 * Cat's down special — **trap** (AC 60304 Sub-AC 4).
 *
 * The ninja's down-special is a *place-and-arm* mine — Cat plants a
 * small explosive sensor at her feet that arms after a half-second
 * delay and detonates when an opponent walks onto it. Mirrors the
 * canonical Smash trap-place archetype (Snake's Down-B mine, R.O.B.'s
 * gyro, Steve's TNT-place). Slots Cat into the "stage-control / trap-
 * the-ledge" niche on the down+special press: a fundamentally
 * different gameplay texture from her projectile (neutral), her
 * multi-hit flurry (side), and her teleport (up) — none of which leave
 * a persistent battlefield element behind.
 *
 * Mechanic:
 *   • Active phase places the trap sensor at Cat's feet (offset
 *     `(0, 50)` — below her body centre).
 *   • For the first `armDelayFrames = 30` frames after spawn the trap
 *     is INERT — opponents who step on it during the arming window
 *     trigger nothing. Counter-play: a fast opponent reading the
 *     placement can rush the spot before it arms.
 *   • From frame 30 to frame 600 the trap is ARMED — any opponent
 *     overlap detonates it dealing 8% damage and applying knockback.
 *     Detonation despawns the trap.
 *   • At frame 600 the trap auto-despawns (10 second lifetime — long
 *     enough to control a ledge through a recovery, short enough that
 *     Cat can refresh placement strategically).
 *   • `maxActiveTraps = 1` — Cat can have at most one trap in the
 *     world at a time. Placing a new trap while one exists despawns
 *     the old one (FIFO). The ninja archetype is about *agile
 *     positioning*, not stacking traps; one-trap limit keeps her
 *     re-placing rather than turtling.
 *
 *   • Damage    : 0 base — the move's own hitbox is unused (the trap
 *                 is a separate body that carries its own damage
 *                 through the runtime trap-spawn handler).
 *   • Knockback : 0 base — same reason.
 *   • Frames    : 8 startup / 4 active / 10 recovery + 12 cooldown.
 *                 Lockout = 34 frames (~567 ms). Quick to place; the
 *                 commitment is the trap's lifetime, not the move's.
 *
 * Animation states (6 art frames): 2 startup, 1 active, 3 recovery —
 * the placing motion is a brief snap (single active art frame for the
 * "kneel-and-set" pose); recovery animates Cat standing back up.
 *
 * Trap spec:
 *   • trapWidth = 40, trapHeight = 6 — small horizontal sensor sitting
 *     on the ground (AC 10404 Sub-AC 4 — height shrunk slightly with
 *     the body retune; the trap is its own entity so width stays put).
 *     Hard to spot but trivial to walk over.
 *   • spawnOffsetX = 0, spawnOffsetY = 32 — at Cat's feet (Cat is now
 *     75 px tall, half-height ≈ 37, so +32 keeps the trap just inside
 *     her bottom edge as it spawns).
 *   • armDelayFrames = 30 — half second arming. Counter-play window.
 *   • trapLifetimeFrames = 600 — 10 seconds. Enough to control a stage
 *     edge through one full recovery exchange.
 *   • trapDamage = 8 — modest hit. The value of the trap is information /
 *     stage control, not raw damage output.
 *   • trapKnockback = (1.5, -2.5, scaling 0.20) — pop-up trajectory
 *     so the opponent is launched into a juggle position Cat can
 *     follow up on with an aerial.
 *   • maxActiveTraps = 1 — single trap limit.
 */
export const CAT_DOWN_SPECIAL: TrapDownSpecialMove = {
  id: 'cat.down_special',
  type: 'downSpecial',
  downSpecialKind: 'trap',
  // No on-press damage/knockback. The trap carries its own damage
  // through the (future) trap-runtime that consumes this record.
  damage: 0,
  knockback: { x: 0, y: 0, scaling: 0 },
  // The MOVE's own hitbox is unused (the trap is a separate body) —
  // author a degenerate sensor so the schema is satisfied; the runtime
  // branches on `downSpecialKind` before consulting `move.hitbox`.
  hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 8,
  activeFrames: 4,
  recoveryFrames: 10,
  cooldownFrames: 12,
  animation: {
    startupFrames: 2,
    activeFrames: 1,
    recoveryFrames: 3,
  },
  trap: {
    trapWidth: 40,
    trapHeight: 6,
    spawnOffsetX: 0,
    spawnOffsetY: 32, // at Cat's feet (Cat is 75 px tall, half-height ≈ 37)
    armDelayFrames: 30, // ½ s arming window
    trapLifetimeFrames: 600, // 10 s total lifetime
    trapDamage: 8,
    trapKnockback: { x: 1.5, y: -2.5, scaling: 0.20 },
    maxActiveTraps: 1, // ninja: one trap, refresh by re-placing
  },
};

// ---------------------------------------------------------------------------
// AC 2 Sub-AC 2 — per-fighter scaffolding for the T2 refactor.
//
// The Cat class below now declares the canonical 10-slot contract surface
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

// Sub-AC 2.2 of the T2 refactor — `CAT_MOVEMENT_PROFILE` is now
// imported from (and re-exported at the top of) this file; the literal
// data lives in `fighterMovementProfiles.ts` so the shared `Character`
// base can resolve per-fighter movement values without a circular
// import on the per-fighter class. `CAT_TUNING` above composes its
// movement-relevant fields by spreading `CAT_MOVEMENT_PROFILE`, so
// the per-fighter file remains the canonical view onto Cat's stats —
// no behavioural change vs. the previous in-file declaration.

/**
 * Cat's full 10-slot uniform moveset (Sub-AC 2 of T2 refactor).
 *
 * Composes the existing per-move exports — already authored above for
 * the AC 60003 Sub-AC 3 / AC 60201 Sub-AC 1 / AC 60302 Sub-AC 2 /
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
 * Cat's grab — a fast, short-range standing grab fitting her lightweight
 * ninja identity: quick startup, lower throw damage than the heavyweights,
 * throws that reposition for her zoning/juggle game.
 */
export const CAT_GRAB: GrabSpec = {
  id: 'cat.grab',
  hitbox: { offsetX: 22, offsetY: -2, width: 22, height: 28 },
  startupFrames: 6,
  activeFrames: 2,
  whiffRecoveryFrames: 28,
  holdFramesMax: 80,
  throwRecoveryFrames: 20,
  pummel: { damage: 1.2, cooldownFrames: 11 },
  dashGrab: { rangeBonusX: 12, momentumRetain: 0.5 },
  throws: {
    forward: { damage: 7, knockback: { x: 2.4, y: -0.9, scaling: 0.1 }, animationFrames: 18 },
    back: { damage: 8, knockback: { x: 2.7, y: -1.0, scaling: 0.12 }, animationFrames: 22 },
    up: { damage: 6, knockback: { x: 0.3, y: -3.0, scaling: 0.1 }, animationFrames: 14 },
    down: { damage: 5, knockback: { x: 0.7, y: 1.0, scaling: 0.07 }, animationFrames: 15 },
  },
};

export const CAT_MOVESET: FighterMoveset = Object.freeze({
  jab: CAT_JAB,
  tilt: CAT_TILT,
  smash: CAT_SMASH,
  fair: CAT_FAIR,
  neutralSpecial: CAT_NEUTRAL_SPECIAL,
  sideSpecial: CAT_SIDE_SPECIAL,
  upSpecial: CAT_UP_SPECIAL,
  downSpecial: CAT_DOWN_SPECIAL,
  shield: SHIELD_DEFAULTS,
  dodge: DODGE_DEFAULTS,
});

/**
 * Cat's full {@link FighterContract} declaration (Sub-AC 2 of T2 refactor).
 * Identity + 10-slot moveset + movement profile in one record so a
 * consumer (test harness, AI predictor, balance tooling) can grab the
 * complete per-fighter declaration off a single import.
 */
export const CAT_FIGHTER_CONTRACT: FighterContract = Object.freeze({
  id: 'cat',
  moveset: CAT_MOVESET,
  movementProfile: CAT_MOVEMENT_PROFILE,
});

/** Cat-specific construction options — mirrors `CharacterOptions` minus `id`. */
export interface CatOptions extends CharacterTuning {
  readonly spawnX: number;
  readonly spawnY: number;
}

/**
 * Cat fighter. Inherits all base movement / jump physics from
 * `Character`; ships with ninja-tuned stats and the full 8-entry
 * move table for Character 2 (AC 60003 Sub-AC 3): grounded triplet
 * (jab / tilt / smash) + the three aerials (nair / fair / bair) +
 * the two specials (neutral projectile shuriken + up teleport). The
 * complete move table mirrors the AC 60002 Sub-AC 2 expansion that
 * completed Wolf's roster slot.
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
export class Cat extends ContractFighter {
  /**
   * Cat's 10-slot uniform moveset surface (Sub-AC 2 of T2 refactor).
   * Points at the frozen {@link CAT_MOVESET} table — every consumer that
   * wants to inspect the full per-fighter kit (AI predictor, replay HUD,
   * balance tooling) can do so via this property without re-deriving
   * the per-move map from `registerAttack` results.
   */
  readonly moveset: FighterMoveset = CAT_MOVESET;

  /**
   * Cat's per-fighter movement parameters (Sub-AC 2 of T2 refactor).
   * Mirrors {@link CAT_MOVEMENT_PROFILE}. The follow-up sub-AC plumbs
   * `Character`'s movement loop to read off this property.
   */
  readonly movementProfile: FighterMovementProfile = CAT_MOVEMENT_PROFILE;

  /**
   * Full per-fighter declaration (Sub-AC 2 of T2 refactor) — identity +
   * moveset + movement profile, exposed as a single read-only record
   * for consumers that want one handle to the whole contract.
   */
  readonly contract: FighterContract = CAT_FIGHTER_CONTRACT;

  constructor(scene: Phaser.Scene, options: CatOptions) {
    super(scene, {
      id: 'cat',
      ...CAT_TUNING,
      ...options,
    });
    // Registration order: jab first so it auto-fills both the light
    // dispatch slot AND the legacy `defaultAttackId` fallback. Tilt
    // registers second — the base class's "first 'jab'/'tilt' wins
    // the light slot" rule keeps jab as the press-attack default; the
    // tilt is reachable via `attemptAttack('cat.tilt')` (input layer
    // lights it up on a stick-direction + attack press in a future
    // sub-AC). Smash and nair populate the heavy / aerial slots in
    // turn. The class contract guarantees that registering by `type`
    // lights the right dispatch slot — Sub-AC 3.3 unit tests lock that
    // down and the AC 60003 Sub-AC 3 tests lock down the tilt
    // addition too.
    registerFighterAttack(this, CAT_JAB);
    // Jab-string stages 2/3 register as 'jab' moves too, but jab1 keeps
    // the light slot via first-registered-wins — these are reachable
    // ONLY through the `jabChain` link off the opener.
    registerFighterAttack(this, CAT_JAB2);
    registerFighterAttack(this, CAT_JAB3);
    registerFighterAttack(this, CAT_TILT);
    registerFighterAttack(this, CAT_SMASH);
    // Aerial cut — neutral / forward / back. AC 60003 Sub-AC 3 closes
    // out Cat's complete move table (mirrors the AC 60002 Sub-AC 2
    // expansion that completed Wolf's table): the legacy `CAT_NAIR`
    // keeps the legacy single-aerial slot wired (so existing aerial-
    // press paths keep dispatching) while `CAT_FAIR` / `CAT_BAIR`
    // populate the forward / back directional slots via
    // `aerialDirection`-aware registration in `registerAttack`. The
    // full triplet matches the Seed's "3 aerials per character"
    // requirement for Character 2.
    registerFighterAttack(this, CAT_NAIR);
    registerFighterAttack(this, CAT_FAIR);
    registerFighterAttack(this, CAT_BAIR);
    // Directional attacks (up-stick). Up-air / down-air auto-wire their
    // aerial up/down slots via `aerialDirection`; up-tilt (reusing the
    // extended-slot CAT_UP_LIGHT) / up-smash are type 'tilt'/'smash'
    // (their forward slots are taken), so wire the dedicated up slots
    // explicitly. Mirrors the AC 60002 Sub-AC 2 wiring on Wolf.
    registerFighterAttack(this, CAT_UAIR);
    registerFighterAttack(this, CAT_DAIR);
    registerFighterAttack(this, CAT_UP_LIGHT);
    registerFighterAttack(this, CAT_USMASH);
    this.setUpTilt(CAT_UP_LIGHT.id);
    this.setUpSmash(CAT_USMASH.id);
    // Directional grounded normals (down-stick + dash). Down-tilt reuses
    // the extended-slot CAT_DOWN_LIGHT (a low feet-poke); down-smash and
    // dash-attack are authored in this file. All three are type
    // 'tilt'/'smash' whose forward slots are already taken (jab/tilt/
    // smash), so wire the dedicated down / dash slots explicitly —
    // mirroring the up-tilt / up-smash wiring above and the AC 60002
    // Sub-AC 2 wiring on Wolf.
    registerFighterAttack(this, CAT_DOWN_LIGHT);
    registerFighterAttack(this, CAT_DSMASH);
    registerFighterAttack(this, CAT_DASHATTACK);
    this.setDownTilt(CAT_DOWN_LIGHT.id);
    this.setDownSmash(CAT_DSMASH.id);
    this.setDashAttack(CAT_DASHATTACK.id);
    // Grab + throws (grab button → catch → directional throw / pummel).
    this.setGrabSpec(CAT_GRAB);
    // Neutral special — projectile shuriken (AC 60201 Sub-AC 1). Auto-
    // fills the `neutralSpecialId` dispatch slot via `registerAttack`'s
    // type-based slot wiring.
    registerFighterAttack(this, CAT_NEUTRAL_SPECIAL);
    // Side special — multi-hit flurry (AC 60302 Sub-AC 2). Registered
    // as a `'sideSpecial'`-typed move so `findMoveByType(spec,
    // 'sideSpecial')` resolves it cleanly. Cat's side-special: a
    // 3-hit forward flurry chainable via re-press of the special
    // button, finishing on a launcher hit.
    registerFighterAttack(this, CAT_SIDE_SPECIAL);
    // Up special — teleport (AC 60202 Sub-AC 2). Auto-fills the
    // `upSpecialId` dispatch slot via `registerAttack`'s type-based
    // slot wiring. Cat's recovery option: vanish + reappear at a
    // chosen 8-direction offset, fully invincible during the vanish.
    registerFighterAttack(this, CAT_UP_SPECIAL);
    // Down special — trap placement (AC 60304 Sub-AC 4). Auto-fills the
    // `downSpecialId` dispatch slot via `registerAttack`'s type-based
    // slot wiring. Cat's stage-control tool: drops a small armed mine
    // at her feet that detonates on opponent contact.
    registerFighterAttack(this, CAT_DOWN_SPECIAL);
  }

  /**
   * Cat's GET-UP ATTACK — the wake-up swat from knockdown. Ninja-tuned:
   * quick, small, and weak. Cat is the smallest body in the cast (40 px
   * wide), so the two-sided sweep is narrow — width 68 (~1.7× body width,
   * the low end of the 1.6-2.2× band per the archetype guidance) with a
   * short active window (5 frames, fastest in the band) and the lightest
   * damage (5). Knockback pops the opponent away without threatening a KO.
   */
  protected getUpAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 5,
      knockback: { x: 3.4, y: -2.6, scaling: 0.1 },
      // Narrow two-sided sweep centred on Cat's slim 40-wide body
      // (width 68 ≈ 1.7× body; height 32 fits within the 65-tall body).
      hitbox: { offsetX: 0, offsetY: 0, width: 68, height: 32 },
      activeFrames: 5,
    };
  }

  /**
   * Cat's LEDGE ATTACK — the edge-clearing forward swing climbing back up.
   * Ninja-tuned: a quick, compact paw swipe over the ledge corner. Modest
   * damage (6), short active window (6 frames), and a forward hitbox scaled
   * to Cat's small body — narrower/shorter than the base default. Knockback
   * clears the edge-guard without killing.
   */
  protected ledgeAttackParams(): {
    damage: number;
    knockback: AttackMove['knockback'];
    hitbox: AttackMove['hitbox'];
    activeFrames: number;
  } {
    return {
      damage: 6,
      knockback: { x: 3.4, y: -2.2, scaling: 0.12 },
      // Forward swing covering the ledge corner up onto the stage.
      hitbox: { offsetX: 10, offsetY: -2, width: 62, height: 48 },
      activeFrames: 6,
    };
  }


  // Per-slot execute hooks (executeJab … executeDodge) are inherited
  // from ContractFighter, which fires each slot via the frozen
  // `moveset` declaration above — the slot ↔ move mapping lives in
  // the data table, not in per-fighter method boilerplate.
}
