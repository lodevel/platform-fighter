/**
 * Character roster definitions — Sub-AC 3.5 of AC 205.
 *
 * Aggregates everything the rest of the engine needs to integrate a
 * playable character through the {@link Fighter} entity into a single
 * data table per character:
 *
 *   • `tuning`      — `CharacterTuning` (max run speed, jump impulse,
 *                     mass, body dimensions, …). The same record the
 *                     `Character` constructor consumes; surfaced here so
 *                     the menu / character-select / HUD layers can read
 *                     stats without instantiating a body.
 *   • `moves`       — frozen array of `AttackMove` records (jab, smash,
 *                     nair, …). The roster's "move-set config" — every
 *                     listed move is registered onto the live Character
 *                     by its subclass constructor (Wolf / Cat) so a
 *                     consumer that reads `roster.moves` is reading
 *                     exactly what's wired into the fighter at runtime.
 *   • `placeholder` — sprite stand-in (primary fill colour, accent
 *                     stroke, label colour, dimensions). Until the M-
 *                     future asset pipeline drops real sprite atlases,
 *                     scenes paint the fighter's body as a flat-colour
 *                     `Phaser.GameObjects.Rectangle` — driven by this
 *                     descriptor so colours stay in lockstep across the
 *                     in-game rectangle, the damage-HUD label, and the
 *                     post-match results banner.
 *
 * Why a roster file (not just per-class statics):
 *
 *   The Seed's "playerSlot" concept marries a slot to a character id;
 *   a lot of code paths (MatchScene, DamageHud, ResultsScene, AI bot
 *   factory, replay header) need to look up "what does character X
 *   look / fight like?" without instantiating a Matter body or
 *   instantiating four classes by hand. Centralising the lookup in
 *   `CHARACTER_ROSTER` keyed on `CharacterId` solves that:
 *
 *     getCharacterSpec('wolf') →
 *       { id: 'wolf', displayName: 'Wolf', role: 'bruiser',
 *         tuning: WOLF_TUNING, moves: WOLF_MOVES,
 *         placeholder: { … } }
 *
 *   The Fighter entity (sibling change in this same Sub-AC) exposes
 *   `getSpec()`, `getDisplayName()`, `getMoves()`, `getPlaceholder()`,
 *   and `getTuning()` so call sites that already iterate `fighters[]`
 *   can read every aspect of the character through the entity layer.
 *
 * Determinism: every value here is a frozen literal — no random,
 * no wall-clock. Importing this module produces the same bytes on every
 * boot, which is what the replay system requires.
 *
 * Roster cadence (M1 → M2):
 *
 *   The first two roster entries (Wolf bruiser, Cat ninja) shipped in
 *   M1 with full kits (jab/tilt/smash + nair). Owl mage joined the
 *   playable roster in AC 60004 Sub-AC 4 with mage-tuned stats and
 *   the full grounded triplet (jab/tilt/smash); his aerials and
 *   specials land in subsequent sub-ACs of AC 60004. Bear grappler
 *   joined in AC 60001 Sub-AC 1 — the foundation cut that locked in
 *   the shared ground-attack data schema and required every roster
 *   slot to ship grounded jab / tilt / smash. With Bear's grappler-
 *   tuned stats and grounded triplet wired, all four roster slots are
 *   `playable: true`. Bear's aerials and specials land in subsequent
 *   sub-ACs alongside the rest of the M2 kit expansion. The
 *   `CHARACTER_ROSTER` stays exhaustive over the `CharacterId` union
 *   (so TypeScript flags any future code path that forgets to handle
 *   a new id) and every slot now exposes a non-empty moveset.
 */

import type { CharacterId, MoveType } from '../types';
import { ASSET_KEYS } from '../assets/manifest';
import type { AttackMove } from './attacks';
import { type CharacterTuning } from './Character';
import {
  WOLF_TUNING,
  WOLF_JAB,
  WOLF_TILT,
  WOLF_SMASH,
  WOLF_NAIR,
  WOLF_FAIR,
  WOLF_BAIR,
  WOLF_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_UP_SPECIAL,
  WOLF_DOWN_SPECIAL,
} from './Wolf';
import {
  CAT_TUNING,
  CAT_JAB,
  CAT_TILT,
  CAT_SMASH,
  CAT_NAIR,
  CAT_FAIR,
  CAT_BAIR,
  CAT_NEUTRAL_SPECIAL,
  CAT_SIDE_SPECIAL,
  CAT_UP_SPECIAL,
  CAT_DOWN_SPECIAL,
} from './Cat';
import {
  OWL_TUNING,
  OWL_JAB,
  OWL_TILT,
  OWL_SMASH,
  OWL_NAIR,
  OWL_FAIR,
  OWL_BAIR,
  OWL_NEUTRAL_SPECIAL,
  OWL_SIDE_SPECIAL,
  OWL_UP_SPECIAL,
  OWL_DOWN_SPECIAL,
} from './Owl';
import {
  BEAR_TUNING,
  BEAR_JAB,
  BEAR_TILT,
  BEAR_SMASH,
  BEAR_NAIR,
  BEAR_FAIR,
  BEAR_BAIR,
  BEAR_NEUTRAL_SPECIAL,
  BEAR_SIDE_SPECIAL,
  BEAR_UP_SPECIAL,
  BEAR_DOWN_SPECIAL,
} from './Bear';
import {
  BLAZE_TUNING,
  BLAZE_JAB,
  BLAZE_TILT,
  BLAZE_SMASH,
  BLAZE_NAIR,
  BLAZE_FAIR,
  BLAZE_BAIR,
  BLAZE_NEUTRAL_SPECIAL,
  BLAZE_SIDE_SPECIAL,
  BLAZE_UP_SPECIAL,
  BLAZE_DOWN_SPECIAL,
} from './Blaze';
import {
  PUFF_TUNING,
  PUFF_JAB,
  PUFF_TILT,
  PUFF_SMASH,
  PUFF_NAIR,
  PUFF_FAIR,
  PUFF_BAIR,
  PUFF_NEUTRAL_SPECIAL,
  PUFF_SIDE_SPECIAL,
  PUFF_UP_SPECIAL,
  PUFF_DOWN_SPECIAL,
} from './Puff';
import {
  AEGIS_TUNING,
  AEGIS_JAB,
  AEGIS_TILT,
  AEGIS_SMASH,
  AEGIS_NAIR,
  AEGIS_FAIR,
  AEGIS_BAIR,
  AEGIS_NEUTRAL_SPECIAL,
  AEGIS_SIDE_SPECIAL,
  AEGIS_UP_SPECIAL,
  AEGIS_DOWN_SPECIAL,
} from './Aegis';
import {
  VOLT_TUNING,
  VOLT_JAB,
  VOLT_TILT,
  VOLT_SMASH,
  VOLT_NAIR,
  VOLT_FAIR,
  VOLT_BAIR,
  VOLT_NEUTRAL_SPECIAL,
  VOLT_SIDE_SPECIAL,
  VOLT_UP_SPECIAL,
  VOLT_DOWN_SPECIAL,
} from './Volt';
import {
  NOVA_TUNING,
  NOVA_JAB,
  NOVA_TILT,
  NOVA_SMASH,
  NOVA_NAIR,
  NOVA_FAIR,
  NOVA_BAIR,
  NOVA_NEUTRAL_SPECIAL,
  NOVA_SIDE_SPECIAL,
  NOVA_UP_SPECIAL,
  NOVA_DOWN_SPECIAL,
} from './Nova';
import {
  BRUNO_TUNING,
  BRUNO_JAB,
  BRUNO_TILT,
  BRUNO_SMASH,
  BRUNO_NAIR,
  BRUNO_FAIR,
  BRUNO_BAIR,
  BRUNO_NEUTRAL_SPECIAL,
  BRUNO_SIDE_SPECIAL,
  BRUNO_UP_SPECIAL,
  BRUNO_DOWN_SPECIAL,
} from './Bruno';
import {
  LINK_TUNING,
  LINK_JAB,
  LINK_TILT,
  LINK_SMASH,
  LINK_NAIR,
  LINK_FAIR,
  LINK_BAIR,
  LINK_NEUTRAL_SPECIAL,
  LINK_SIDE_SPECIAL,
  LINK_UP_SPECIAL,
  LINK_DOWN_SPECIAL,
} from './Link';
import {
  KIRBY_TUNING,
  KIRBY_JAB,
  KIRBY_TILT,
  KIRBY_SMASH,
  KIRBY_NAIR,
  KIRBY_FAIR,
  KIRBY_BAIR,
  KIRBY_NEUTRAL_SPECIAL,
  KIRBY_SIDE_SPECIAL,
  KIRBY_UP_SPECIAL,
  KIRBY_DOWN_SPECIAL,
} from './Kirby';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Sprite placeholder visual descriptor — drives the flat-colour
 * `Phaser.GameObjects.Rectangle` the M1/M2 scaffold renders in place
 * of a real sprite atlas. Centralising this here means:
 *
 *   • The body rectangle, the HUD percent label, and the post-match
 *     "WOLF WINS!" banner all read from one source. A theme tweak in
 *     this file ripples through the whole game without grepping for
 *     hex strings.
 *   • The (M-future) asset pipeline can drop a real atlas in next to
 *     `spriteKey` and switch the renderer over without touching any
 *     gameplay code — the placeholder spec stays as a fallback.
 *
 * Numeric colour values use Phaser's 0xRRGGBB convention so a consumer
 * can pass them straight into `Rectangle`, `Triangle.setStrokeStyle`,
 * and `Text.setColor` (after `'#' + n.toString(16).padStart(6,'0')`).
 */
export interface CharacterPlaceholderVisual {
  /** Body fill colour. 0xRRGGBB. */
  readonly primaryColor: number;
  /** Outline / accent colour for stroke + facing arrow. 0xRRGGBB. */
  readonly accentColor: number;
  /**
   * Optional label colour for HUD / menus that want a tint distinct
   * from the body fill. Defaults to `accentColor` if omitted.
   */
  readonly labelColor?: number;
  /**
   * Body width in design pixels. Mirrors `tuning.width` for the
   * concrete characters (Wolf 100, Cat 72) so the visual rectangle
   * lines up with the Matter body. Stored separately on the
   * placeholder so a (later) art pass can paint a sprite that's
   * *different* from the hurtbox without touching tuning.
   */
  readonly width: number;
  /** Body height in design pixels. Mirrors `tuning.height`. */
  readonly height: number;
  /**
   * Stable texture key the M-future asset pipeline will register.
   * `null` while the placeholder is the only renderer; non-null when
   * the real atlas is wired up. Allows scenes to detect "real sprite
   * available" without sniffing `this.textures.exists`.
   */
  readonly spriteKey: string | null;
}

/**
 * Full data record for one playable character. Combines the slot-
 * agnostic data (id, display name, role) with the integration-ready
 * stats/moves/placeholder so a single `getCharacterSpec(id)` lookup
 * gives a consumer everything they need to render, animate, and reason
 * about a fighter. Every field is `readonly` and the arrays / objects
 * are frozen at module load.
 */
export interface CharacterSpec {
  /** Stable character id — matches the `CharacterId` union. */
  readonly id: CharacterId;
  /** Human-readable name shown in menus, HUD labels, results banner. */
  readonly displayName: string;
  /**
   * Free-form role / archetype label ('bruiser', 'ninja', …). Used by
   * the (M-future) character-select screen and by tests asserting that
   * the M1 cut covers two distinct archetypes. Not part of the engine
   * contract — purely descriptive.
   */
  readonly role: string;
  /**
   * Tuning block the underlying `Character` is constructed with.
   * Re-exported through the spec so consumers can read stats without
   * instantiating a Matter body. Mirrors the same record the subclass
   * passes to `super(...)`.
   *
   * AC 60301 Sub-AC 1 — `shield` is intentionally excluded here so the
   * roster record stays a stats-only view. The runtime resolves the
   * shield slot through `resolveShieldTuning(SHIELD_DEFAULTS)` for
   * every character; per-character shield overrides land on
   * `CharacterOptions.shield` directly when a future balance pass
   * differentiates them.
   */
  readonly tuning: Required<
    Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion'>
  >;
  /**
   * Frozen, ordered list of moves this character ships with. Indexed
   * the same way the subclass calls `registerAttack(...)` — i.e. moves
   * appear in the order they're wired into the live Character.
   */
  readonly moves: ReadonlyArray<AttackMove>;
  /** Visual placeholder used until the real sprite atlas lands. */
  readonly placeholder: CharacterPlaceholderVisual;
  /**
   * True if this spec represents a fully-wired playable character
   * (Wolf, Cat in M1). False for `placeholder` entries (Owl / Bear)
   * whose moveset is empty and whose subclass has not yet shipped.
   * Lets selection UI grey out unfinished slots without hard-coding
   * a "released" list.
   */
  readonly playable: boolean;
}

// ---------------------------------------------------------------------------
// Move tables (frozen — referenced by each spec and re-exported for tests)
// ---------------------------------------------------------------------------

/**
 * Wolf's full moveset — the same moves his constructor calls
 * `registerAttack` with, in identical order. Re-exported so consumers
 * (HUD legend, AI behaviour table, balance-pass tooling) can iterate
 * Wolf's kit without instantiating one.
 *
 * Order mirrors the registration call sequence in {@link Wolf}:
 * jab → tilt → smash → nair → fair → bair → neutral special →
 * side special → up special. The grounded triplet (jab / tilt / smash)
 * lands first in the array so a HUD legend that displays "ground
 * options" can slice the front of the list without index lookups; the
 * three aerials (nair / fair / bair) are contiguous next, and the three
 * specials (neutral / side / up) close out the table.
 *
 * AC 60002 Sub-AC 2 — complete move table for Character 1: 9 entries
 * total (jab + tilt + smash + 3 specials + 3 aerials), every entry a
 * full {@link AttackMove} with hitbox geometry, damage %, knockback
 * vector, and startup/active/recovery/cooldown frame counts.
 */
export const WOLF_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  WOLF_JAB,
  WOLF_TILT,
  WOLF_SMASH,
  WOLF_NAIR,
  WOLF_FAIR,
  WOLF_BAIR,
  WOLF_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_UP_SPECIAL,
  WOLF_DOWN_SPECIAL,
]);

/**
 * Cat's full moveset — counterpart to {@link WOLF_MOVES}.
 *
 * Order mirrors the registration call sequence in {@link Cat}:
 * jab → tilt → smash → nair → fair → bair → neutral special →
 * side special → up special. The grounded triplet (jab / tilt / smash)
 * lands first in the array so a HUD legend that displays "ground
 * options" can slice the front of the list without index lookups; the
 * three aerials (nair / fair / bair) are contiguous next, and the three
 * specials (neutral / side / up) close out the table — same shape as {@link WOLF_MOVES}.
 *
 * AC 60003 Sub-AC 3 — complete move table for Character 2: 9 entries
 * total (jab + tilt + smash + 3 specials + 3 aerials), every entry a
 * full {@link AttackMove} with hitbox geometry, damage %, knockback
 * vector, and startup/active/recovery/cooldown frame counts. Mirrors
 * the AC 60002 Sub-AC 2 expansion that completed Wolf's table.
 */
export const CAT_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  CAT_JAB,
  CAT_TILT,
  CAT_SMASH,
  CAT_NAIR,
  CAT_FAIR,
  CAT_BAIR,
  CAT_NEUTRAL_SPECIAL,
  CAT_SIDE_SPECIAL,
  CAT_UP_SPECIAL,
  CAT_DOWN_SPECIAL,
]);

/**
 * Owl's full moveset — counterpart to {@link WOLF_MOVES} and
 * {@link CAT_MOVES}.
 *
 * Order mirrors the registration call sequence in {@link Owl}:
 * jab → tilt → smash → nair → fair → bair → neutral special →
 * side special → up special. The grounded triplet (jab / tilt / smash)
 * lands first in the array so a HUD legend that displays "ground
 * options" can slice the front of the list without index lookups; the
 * three aerials (nair / fair / bair) are contiguous next, and the three
 * specials (neutral / side / up) close out the table — same shape as {@link WOLF_MOVES}
 * and {@link CAT_MOVES}.
 *
 * AC 60004 Sub-AC 4 — complete move table for Character 3: 9 entries
 * total (jab + tilt + smash + 3 specials + 3 aerials), every entry a
 * full {@link AttackMove} with hitbox geometry, damage %, knockback
 * vector, and startup/active/recovery/cooldown frame counts. Mirrors
 * the AC 60002 Sub-AC 2 expansion that completed Wolf's table and the
 * AC 60003 Sub-AC 3 expansion that completed Cat's.
 */
export const OWL_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  OWL_JAB,
  OWL_TILT,
  OWL_SMASH,
  OWL_NAIR,
  OWL_FAIR,
  OWL_BAIR,
  OWL_NEUTRAL_SPECIAL,
  OWL_SIDE_SPECIAL,
  OWL_UP_SPECIAL,
  OWL_DOWN_SPECIAL,
]);

/**
 * Bear's full moveset — counterpart to {@link WOLF_MOVES},
 * {@link CAT_MOVES}, and {@link OWL_MOVES}.
 *
 * Order mirrors the registration call sequence in {@link Bear}:
 * jab → tilt → smash → nair → fair → bair → neutral special →
 * side special → up special. The grounded triplet (jab / tilt / smash)
 * lands first in the array so a HUD legend that displays "ground
 * options" can slice the front of the list without index lookups; the
 * three aerials (nair / fair / bair) are contiguous next, and the three
 * specials (neutral / side / up) close out the table — same 9-entry shape as
 * {@link WOLF_MOVES}, {@link CAT_MOVES}, and {@link OWL_MOVES}.
 *
 * AC 60005 Sub-AC 5 — complete move table for Character 4: 9 entries
 * total (jab + tilt + smash + 3 specials + 3 aerials), every entry a
 * full {@link AttackMove} with hitbox geometry, damage %, knockback
 * vector, and startup/active/recovery/cooldown frame counts. Mirrors
 * the AC 60002 Sub-AC 2 / AC 60003 Sub-AC 3 / AC 60004 Sub-AC 4
 * expansions that completed Wolf, Cat, and Owl's tables — Bear is the
 * fourth and final roster slot to ship a full move table, closing out
 * the Seed's "4 characters with full movesets" milestone.
 */
export const BEAR_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  BEAR_JAB,
  BEAR_TILT,
  BEAR_SMASH,
  BEAR_NAIR,
  BEAR_FAIR,
  BEAR_BAIR,
  BEAR_NEUTRAL_SPECIAL,
  BEAR_SIDE_SPECIAL,
  BEAR_UP_SPECIAL,
  BEAR_DOWN_SPECIAL,
]);

/**
 * Blaze's full moveset — same 10-entry shape as {@link WOLF_MOVES} et
 * al. (grounded triplet, then the contiguous aerial cut, then the four
 * specials in neutral / side / up / down order — mirroring the
 * registration call sequence in {@link Blaze}). Fifth roster slot:
 * the fast-heavy rushdown (Captain Falcon archetype) joins the cast
 * with a complete kit on day one.
 */
export const BLAZE_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  BLAZE_JAB,
  BLAZE_TILT,
  BLAZE_SMASH,
  BLAZE_NAIR,
  BLAZE_FAIR,
  BLAZE_BAIR,
  BLAZE_NEUTRAL_SPECIAL,
  BLAZE_SIDE_SPECIAL,
  BLAZE_UP_SPECIAL,
  BLAZE_DOWN_SPECIAL,
]);

/**
 * Puff's full moveset — same 10-entry shape as the rest of the cast,
 * mirroring the registration call sequence in {@link Puff}. Sixth
 * roster slot: the five-jump balloon (Jigglypuff archetype).
 */
export const PUFF_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  PUFF_JAB,
  PUFF_TILT,
  PUFF_SMASH,
  PUFF_NAIR,
  PUFF_FAIR,
  PUFF_BAIR,
  PUFF_NEUTRAL_SPECIAL,
  PUFF_SIDE_SPECIAL,
  PUFF_UP_SPECIAL,
  PUFF_DOWN_SPECIAL,
]);

/**
 * Aegis's full moveset — same 10-entry shape as the rest of the cast,
 * mirroring the registration call sequence in {@link Aegis}. Seventh
 * roster slot: the tip-sweet-spot sword spacer (Marth archetype) —
 * every normal in this table authors a `sweetSpot` sub-region at the
 * blade's far end.
 */
export const AEGIS_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  AEGIS_JAB,
  AEGIS_TILT,
  AEGIS_SMASH,
  AEGIS_NAIR,
  AEGIS_FAIR,
  AEGIS_BAIR,
  AEGIS_NEUTRAL_SPECIAL,
  AEGIS_SIDE_SPECIAL,
  AEGIS_UP_SPECIAL,
  AEGIS_DOWN_SPECIAL,
]);

/**
 * Volt's full moveset — same 10-entry shape as the rest of the cast,
 * mirroring the registration call sequence in {@link Volt}. Eighth
 * roster slot: the tiny combo rushdown (Pikachu archetype).
 */
export const VOLT_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  VOLT_JAB,
  VOLT_TILT,
  VOLT_SMASH,
  VOLT_NAIR,
  VOLT_FAIR,
  VOLT_BAIR,
  VOLT_NEUTRAL_SPECIAL,
  VOLT_SIDE_SPECIAL,
  VOLT_UP_SPECIAL,
  VOLT_DOWN_SPECIAL,
]);

/**
 * Nova's full moveset — same 10-entry shape as the rest of the cast,
 * mirroring the registration call sequence in {@link Nova}. Ninth
 * roster slot: the ranged zoner (Samus archetype).
 */
export const NOVA_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  NOVA_JAB,
  NOVA_TILT,
  NOVA_SMASH,
  NOVA_NAIR,
  NOVA_FAIR,
  NOVA_BAIR,
  NOVA_NEUTRAL_SPECIAL,
  NOVA_SIDE_SPECIAL,
  NOVA_UP_SPECIAL,
  NOVA_DOWN_SPECIAL,
]);

/**
 * Bruno's full moveset — same 10-entry shape as the rest of the cast,
 * mirroring the registration call sequence in {@link Bruno}. Tenth
 * roster slot: the balanced all-rounder (Mario archetype).
 */
export const BRUNO_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  BRUNO_JAB,
  BRUNO_TILT,
  BRUNO_SMASH,
  BRUNO_NAIR,
  BRUNO_FAIR,
  BRUNO_BAIR,
  BRUNO_NEUTRAL_SPECIAL,
  BRUNO_SIDE_SPECIAL,
  BRUNO_UP_SPECIAL,
  BRUNO_DOWN_SPECIAL,
]);

/**
 * Link's full moveset — same 10-entry shape as the rest of the cast,
 * mirroring the registration call sequence in {@link Link}. Eleventh
 * roster slot: the projectile-swordsman zoner (Zelda's Link archetype).
 */
export const LINK_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  LINK_JAB,
  LINK_TILT,
  LINK_SMASH,
  LINK_NAIR,
  LINK_FAIR,
  LINK_BAIR,
  LINK_NEUTRAL_SPECIAL,
  LINK_SIDE_SPECIAL,
  LINK_UP_SPECIAL,
  LINK_DOWN_SPECIAL,
]);

/**
 * Kirby's full moveset — same 10-entry shape as the rest of the cast,
 * mirroring the registration call sequence in {@link Kirby}. Twelfth
 * roster slot: the multi-jump inhale puffball (Kirby archetype).
 */
export const KIRBY_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  KIRBY_JAB,
  KIRBY_TILT,
  KIRBY_SMASH,
  KIRBY_NAIR,
  KIRBY_FAIR,
  KIRBY_BAIR,
  KIRBY_NEUTRAL_SPECIAL,
  KIRBY_SIDE_SPECIAL,
  KIRBY_UP_SPECIAL,
  KIRBY_DOWN_SPECIAL,
]);

// ---------------------------------------------------------------------------
// Placeholder visual constants
// ---------------------------------------------------------------------------

/**
 * Wolf placeholder — warm red body with cream accent. Mirrors the
 * inline colours `MatchScene` was painting before this Sub-AC; lifting
 * them into a constant means the HUD, the results banner, and the
 * (M-future) character-select tile all read the same hex.
 *
 * AC 10401 Sub-AC 1 — `spriteKey` now points at the loaded idle
 * spritesheet texture (`ASSET_KEYS.charWolfIdle`). When set, the
 * MatchScene render pipeline draws a real `Phaser.GameObjects.Sprite`
 * pinned to the fighter body in lockstep with the placeholder
 * rectangle (which now serves as a hurtbox debug overlay rendered
 * underneath the sprite). The colours above remain authoritative for
 * the HUD label, post-match banner, and palette-swap tinting fallback.
 */
// AC 10401 Sub-AC 1 — Wolf ships a real spritesheet. The original
// PNG strips were sourced fully-opaque (white background, no alpha),
// causing them to render as solid colored blocks. A one-time pass
// keyed pure white → alpha 0 across `assets/characters/wolf/
// animations/{idle,run,jump,attack}.png` to restore the silhouette;
// the original opaque copies are stashed under `.opaque_originals/`
// for reference. Re-running the alpha-cut after a future asset
// refresh: white-keying is a 5-line PIL script.
export const WOLF_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0xc24a4a, // wolf red
  accentColor: 0xffe0a0, // cream stroke + facing arrow
  labelColor: 0xffe0a0,
  width: WOLF_TUNING.width,
  height: WOLF_TUNING.height,
  spriteKey: ASSET_KEYS.charWolfIdle,
});

/**
 * Cat placeholder — cool blue body with sky accent.
 *
 * AC 10402 Sub-AC 2 — promotes the SECOND M1 character's `spriteKey` to
 * the loaded idle spritesheet texture (`ASSET_KEYS.charCatIdle`),
 * mirroring the Wolf placeholder's AC 10401 Sub-AC 1 promotion (the
 * FIRST M1 character). With both M1 characters carrying a non-null
 * `spriteKey`, the MatchScene render pipeline draws a real
 * `Phaser.GameObjects.Sprite` pinned to each fighter body in lockstep
 * with the placeholder rectangle (which now serves as a hurtbox debug
 * overlay rendered underneath the sprite at low alpha) — replacing the
 * Cat's placeholder-rectangle-only rendering.
 *
 * Pairs with:
 *   • The four Cat spritesheet entries in `assets/manifest.ts`
 *     (`charCatIdle`, `charCatRun`, `charCatJump`, `charCatAttack`) —
 *     50×50 cells, frame counts 4 / 10 / 5 / 10 — sourced from the
 *     `assets/characters/cat/animations/` PNGs.
 *   • The Phaser animation registration in
 *     `spriteAnimationDriver.ts::registerCharacterSpriteAnimations`,
 *     which walks `SPRITE_ANIM_SPECS` and creates the four canonical
 *     animation keys `cat.idle.anim`, `cat.run.anim`, `cat.jump.anim`,
 *     `cat.attack.anim` keyed at the per-sheet frame rate / repeat /
 *     hold cadence the M1 art delivery calls for.
 *   • The per-slot `SpriteAnimationStateMachine` in `MatchScene` that
 *     classifies the discrete sprite state each fixed step (idle / run
 *     / jump / fall / attack / hurt) and dispatches a `sprite.play()`
 *     call against the registered animation key on state transitions.
 *
 * The colours above remain authoritative for the HUD label, post-match
 * banner, and palette-swap tinting fallback.
 */
export const CAT_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0x4a8ec2, // cat blue
  accentColor: 0xa0d8ff, // sky stroke + facing arrow
  labelColor: 0xa0d8ff,
  width: CAT_TUNING.width,
  height: CAT_TUNING.height,
  // AC 10402 Sub-AC 2 — second M1 character's sprite key. Non-null →
  // MatchScene picks the sprite-renderer branch and the placeholder
  // rectangle drops to a low-alpha hurtbox debug overlay.
  spriteKey: ASSET_KEYS.charCatIdle,
});

/**
 * Owl placeholder — muted indigo. AC 60004 Sub-AC 4 wires the Owl
 * subclass with the full grounded triplet (jab / tilt / smash) and
 * promotes the placeholder dimensions to match Owl's actual tuning
 * (84 × 144 — taller and thinner than Wolf or Cat) so the rendered
 * rectangle matches the live Matter hurtbox. Distinct hue from
 * Wolf/Cat keeps the char-select grid readable.
 */
export const OWL_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0x6a5acd, // muted indigo
  accentColor: 0xd4d0ff,
  labelColor: 0xd4d0ff,
  width: OWL_TUNING.width,
  height: OWL_TUNING.height,
  spriteKey: ASSET_KEYS.charOwlIdle,
});

/**
 * Bear placeholder — earthy umber. AC 60001 Sub-AC 1 wires the Bear
 * subclass with the full grounded triplet (jab / tilt / smash) and
 * promotes the placeholder dimensions to match Bear's actual tuning
 * (110 × 148 — widest silhouette in the M2 cut, slightly taller than
 * Wolf) so the rendered rectangle matches the live Matter hurtbox.
 * Distinct hue from Wolf / Cat / Owl keeps the char-select grid
 * readable.
 */
export const BEAR_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0x8b5a2b, // umber
  accentColor: 0xf3d6a8,
  labelColor: 0xf3d6a8,
  width: BEAR_TUNING.width,
  height: BEAR_TUNING.height,
  spriteKey: ASSET_KEYS.charBearIdle,
});

/**
 * Blaze placeholder — ember orange with a cream accent. Distinct hue
 * from the existing cast (Wolf red / Cat blue / Owl indigo / Bear
 * umber) keeps the char-select grid readable.
 *
 * Post-M5 art drop — Blaze now ships a real spritesheet: the *Punk*
 * brawler from CraftPix.net's "Free 3 Cyberpunk Characters Pixel Art"
 * (OGA-BY 3.0, see ATTRIBUTION.md). 48×48 cells, idle 4 / run 6 /
 * jump 4 / attack 6 strips under `assets/characters/blaze/animations/`.
 * Non-null `spriteKey` → MatchScene picks the sprite-renderer branch
 * and the rectangle drops to a low-alpha hurtbox debug overlay, same
 * as the Wolf/Cat promotion in AC 10401/10402.
 */
export const BLAZE_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0xd9622b, // ember orange
  accentColor: 0xffe8c0,
  labelColor: 0xffe8c0,
  width: BLAZE_TUNING.width,
  height: BLAZE_TUNING.height,
  spriteKey: ASSET_KEYS.charBlazeIdle,
});

/**
 * Puff placeholder — bubblegum pink; the colours mirror her round
 * balloon hurtbox in the HUD / banner layers.
 *
 * Post-M5 art drop — Puff now ships a real spritesheet: the round
 * *Slime* creature from Segel's CC0 "Adventurer and Slime game
 * Sprites" pack (see ATTRIBUTION.md). 136×89 cells, idle 12 / run 10
 * / jump 4 / attack 8 strips under `assets/characters/puff/animations/`.
 */
export const PUFF_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0xe88bb8, // bubblegum pink
  accentColor: 0xfff0f8,
  labelColor: 0xfff0f8,
  width: PUFF_TUNING.width,
  height: PUFF_TUNING.height,
  spriteKey: ASSET_KEYS.charPuffIdle,
});

/**
 * Aegis placeholder — royal cobalt with a pale steel accent.
 *
 * Post-M5 art drop — Aegis now ships a real spritesheet: the
 * sword-wielding *Adventurer* from Segel's CC0 "Adventurer and Slime
 * game Sprites" pack (see ATTRIBUTION.md). 128×130 cells, idle 12 /
 * run 10 / jump 2 / attack 8 (sword slash) strips under
 * `assets/characters/aegis/animations/`.
 */
export const AEGIS_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0x4a55c2, // royal cobalt
  accentColor: 0xc8d0ff,
  labelColor: 0xc8d0ff,
  width: AEGIS_TUNING.width,
  height: AEGIS_TUNING.height,
  spriteKey: ASSET_KEYS.charAegisIdle,
});

/**
 * Volt placeholder — electric yellow with a charcoal accent (the
 * Pikachu-inspired electric mouse).
 *
 * Post-batch-2 art drop — Volt ships a real spritesheet: Segel's CC0
 * *Tiny Kitten Game Sprite* (a small chibi creature). 64×80 cells,
 * idle 12 / run 10 / jump 5 / attack 5 strips under
 * `assets/characters/volt/animations/`. Non-null `spriteKey` →
 * MatchScene picks the sprite-renderer branch.
 */
export const VOLT_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0xf2c20c, // electric yellow
  accentColor: 0x3a3320,
  labelColor: 0xfff0a0,
  width: VOLT_TUNING.width,
  height: VOLT_TUNING.height,
  spriteKey: ASSET_KEYS.charVoltIdle,
});

/**
 * Nova placeholder — burnt orange with a teal accent (the Samus-inspired
 * armoured zoner).
 *
 * Post-batch-2 art drop — Nova ships a real spritesheet: the CC0 *2D
 * Douche Cyborg* ('CyborgMark') by Darius Guerrero. 72×96 cells, idle
 * 15 / run 15 / jump 15 / attack 9 (arm-cannon shoot) strips under
 * `assets/characters/nova/animations/`.
 */
export const NOVA_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0xd96b2b, // burnt orange (power-suit)
  accentColor: 0x3ad0c8,
  labelColor: 0xc8fff4,
  width: NOVA_TUNING.width,
  height: NOVA_TUNING.height,
  spriteKey: ASSET_KEYS.charNovaIdle,
});

/**
 * Bruno placeholder — fire red with a white accent (the Mario-inspired
 * all-rounder).
 *
 * Post-batch-2 art drop — Bruno ships a real spritesheet: the CC0
 * *Generic Platformer Pack* main character by bakudas. 28×36 cells,
 * idle 4 / run 8 / jump 2 / attack 8 (run lunge) strips under
 * `assets/characters/bruno/animations/`.
 */
export const BRUNO_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0xd6342b, // fire red
  accentColor: 0xfff0f0,
  labelColor: 0xfff0f0,
  width: BRUNO_TUNING.width,
  height: BRUNO_TUNING.height,
  spriteKey: ASSET_KEYS.charBrunoIdle,
});

/**
 * Link placeholder — hero green with a cream accent (the Zelda-inspired
 * projectile swordsman). Distinct hue from the existing cast keeps the
 * char-select grid readable.
 *
 * Post-batch-3 — Link ships through the PROCEDURAL placeholder pipeline:
 * `spriteKey: null` so MatchScene paints a flat-colour rectangle (playable
 * but visually unfinished) until a sprite pack lands. The colours here are
 * the fighter's whole on-screen identity meanwhile.
 */
export const LINK_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0x4a9e3a, // hero green
  accentColor: 0xf0e8c0,
  labelColor: 0xf0e8c0,
  width: LINK_TUNING.width,
  height: LINK_TUNING.height,
  spriteKey: null,
});

/**
 * Kirby placeholder — bubble pink with a pale accent (the multi-jump
 * inhale puffball). Procedural pipeline (`spriteKey: null`) until a sprite
 * pack lands. Distinct hue from the existing cast keeps the char-select
 * grid readable.
 */
export const KIRBY_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0xe87aa8, // bubble pink
  accentColor: 0xfff0f6,
  labelColor: 0xfff0f6,
  width: KIRBY_TUNING.width,
  height: KIRBY_TUNING.height,
  spriteKey: null,
});

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/**
 * Wolf spec — the bruiser archetype. Heavy mass, slower top speed,
 * powerful smash. M1 playable.
 */
export const WOLF_SPEC: CharacterSpec = Object.freeze({
  id: 'wolf',
  displayName: 'Wolf',
  role: 'bruiser',
  tuning: WOLF_TUNING,
  moves: WOLF_MOVES,
  placeholder: WOLF_PLACEHOLDER,
  playable: true,
});

/**
 * Cat spec — the ninja archetype. Light mass, top speed, fast pokes.
 * M1 playable.
 */
export const CAT_SPEC: CharacterSpec = Object.freeze({
  id: 'cat',
  displayName: 'Cat',
  role: 'ninja',
  tuning: CAT_TUNING,
  moves: CAT_MOVES,
  placeholder: CAT_PLACEHOLDER,
  playable: true,
});

/**
 * Owl spec — the mage archetype. AC 60004 Sub-AC 4 ships the complete
 * move table (jab / tilt / smash / nair / fair / bair / neutral special
 * / up special) plus mage-tuned movement stats. With this expansion the
 * `OWL_MOVES` array carries the full 8 entries Wolf and Cat ship with —
 * `playerSlot` consumers and the menu/HUD layers see Owl's kit as a
 * peer of the M1 cast.
 */
export const OWL_SPEC: CharacterSpec = Object.freeze({
  id: 'owl',
  displayName: 'Owl',
  role: 'mage',
  tuning: OWL_TUNING,
  moves: OWL_MOVES,
  placeholder: OWL_PLACEHOLDER,
  playable: true,
});

/**
 * Bear spec — the grappler archetype. AC 60001 Sub-AC 1 ships the full
 * grounded triplet (jab / tilt / smash) plus grappler-tuned movement
 * stats, promoting Bear from "placeholder spec only" to a playable
 * fighter. With this promotion every roster slot is `playable: true`
 * — the Seed's "4 characters with full movesets" milestone for the
 * grounded triplet is met. Aerials and specials land in subsequent
 * sub-ACs and will append to {@link BEAR_MOVES}.
 */
export const BEAR_SPEC: CharacterSpec = Object.freeze({
  id: 'bear',
  displayName: 'Bear',
  role: 'grappler',
  tuning: BEAR_TUNING,
  moves: BEAR_MOVES,
  placeholder: BEAR_PLACEHOLDER,
  playable: true,
});

/**
 * Blaze spec — the rushdown archetype (Captain Falcon-inspired). The
 * fifth roster slot ships fully playable on day one: complete 10-move
 * table (incl. the sweet-spot knee fair and the 24 % blaze punch) +
 * rushdown-tuned movement (run 9.0, mass 14, the steepest fall
 * shaping in the cast). Display name carries the inspiration in
 * parentheses per the roster-expansion convention.
 */
export const BLAZE_SPEC: CharacterSpec = Object.freeze({
  id: 'blaze',
  displayName: 'Blaze (Captain Falcon)',
  role: 'rushdown (Captain Falcon)',
  tuning: BLAZE_TUNING,
  moves: BLAZE_MOVES,
  placeholder: BLAZE_PLACEHOLDER,
  playable: true,
});

/**
 * Puff spec — the balloon archetype (Jigglypuff-inspired). Sixth
 * roster slot: five jumps, the floatiest fall shaping shipped, weak
 * pokes around the high-risk slumber-slam down special.
 */
export const PUFF_SPEC: CharacterSpec = Object.freeze({
  id: 'puff',
  displayName: 'Puff (Jigglypuff)',
  role: 'floaty (Jigglypuff)',
  tuning: PUFF_TUNING,
  moves: PUFF_MOVES,
  placeholder: PUFF_PLACEHOLDER,
  playable: true,
});

/**
 * Aegis spec — the sword-spacing archetype (Marth-inspired). Seventh
 * roster slot: mid stats, longest reach ladder in the cast, and a tip
 * sweet-spot on every normal.
 */
export const AEGIS_SPEC: CharacterSpec = Object.freeze({
  id: 'aegis',
  displayName: 'Aegis (Marth)',
  role: 'sword spacing (Marth)',
  tuning: AEGIS_TUNING,
  moves: AEGIS_MOVES,
  placeholder: AEGIS_PLACEHOLDER,
  playable: true,
});

/**
 * Volt spec — the tiny combo rushdown (Pikachu-inspired). Eighth roster
 * slot: highest run speed shipped on a featherweight body, low-knockback
 * combo normals around an electric projectile and a quick-attack zip.
 * Display name carries the inspiration in parentheses per the
 * roster-expansion convention.
 */
export const VOLT_SPEC: CharacterSpec = Object.freeze({
  id: 'volt',
  displayName: 'Volt (Pikachu)',
  role: 'combo rushdown (Pikachu)',
  tuning: VOLT_TUNING,
  moves: VOLT_MOVES,
  placeholder: VOLT_PLACEHOLDER,
  playable: true,
});

/**
 * Nova spec — the ranged zoner (Samus-inspired). Ninth roster slot:
 * mid-heavy mass and a slow run built around a chargeable shot, a
 * missile barrage, and the screw-attack recovery.
 */
export const NOVA_SPEC: CharacterSpec = Object.freeze({
  id: 'nova',
  displayName: 'Nova (Samus)',
  role: 'zoner (Samus)',
  tuning: NOVA_TUNING,
  moves: NOVA_MOVES,
  placeholder: NOVA_PLACEHOLDER,
  playable: true,
});

/**
 * Bruno spec — the balanced all-rounder (Mario-inspired). Tenth roster
 * slot: middleweight stats across the board, a fireball projectile and
 * an anti-air super-jump-punch, reliable-if-unspectacular KO power. The
 * "everyman" baseline the rest of the cast is read against.
 */
export const BRUNO_SPEC: CharacterSpec = Object.freeze({
  id: 'bruno',
  displayName: 'Bruno (Mario)',
  role: 'all-rounder (Mario)',
  tuning: BRUNO_TUNING,
  moves: BRUNO_MOVES,
  placeholder: BRUNO_PLACEHOLDER,
  playable: true,
});

/**
 * Link spec — the projectile-swordsman zoner (Zelda's Link archetype).
 * Eleventh roster slot: medium stats built around a projectile wall
 * (arrow / boomerang / bomb), a hookshot tether recovery, and disjointed
 * sword normals. Renders through the procedural placeholder pipeline
 * (no sprite pack yet).
 */
export const LINK_SPEC: CharacterSpec = Object.freeze({
  id: 'link',
  displayName: 'Link (Zelda)',
  role: 'projectile swordsman (Link)',
  tuning: LINK_TUNING,
  moves: LINK_MOVES,
  placeholder: LINK_PLACEHOLDER,
  playable: true,
});

/**
 * Kirby spec — the multi-jump inhale puffball (Kirby archetype). Twelfth
 * roster slot: light, floaty, five jumps, built around an inhale command
 * grab, a final-cutter rising recovery, and a heavy stone plummet.
 * Renders through the procedural placeholder pipeline (no sprite pack).
 */
export const KIRBY_SPEC: CharacterSpec = Object.freeze({
  id: 'kirby',
  displayName: 'Kirby',
  role: 'multi-jump puffball (Kirby)',
  tuning: KIRBY_TUNING,
  moves: KIRBY_MOVES,
  placeholder: KIRBY_PLACEHOLDER,
  playable: true,
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Lookup table keyed on `CharacterId`. Exhaustive over the union — adding
 * a new id to `CharacterId` will break the type until a matching spec
 * lands here, by design. Frozen so accidental writes throw in strict
 * mode.
 */
export const CHARACTER_ROSTER: Readonly<Record<CharacterId, CharacterSpec>> =
  Object.freeze({
    wolf: WOLF_SPEC,
    cat: CAT_SPEC,
    owl: OWL_SPEC,
    bear: BEAR_SPEC,
    blaze: BLAZE_SPEC,
    puff: PUFF_SPEC,
    aegis: AEGIS_SPEC,
    volt: VOLT_SPEC,
    nova: NOVA_SPEC,
    bruno: BRUNO_SPEC,
    link: LINK_SPEC,
    kirby: KIRBY_SPEC,
  });

/**
 * Ordered list of every spec in the roster. Useful for character-select
 * screens that iterate "all options" without caring about id ordering;
 * the order here reflects the M1→M2 reveal cadence (Wolf → Cat → Owl →
 * Bear) so a grid renderer doesn't have to re-sort.
 */
export const CHARACTER_SPECS_IN_ROSTER_ORDER: ReadonlyArray<CharacterSpec> =
  Object.freeze([
    WOLF_SPEC,
    CAT_SPEC,
    OWL_SPEC,
    BEAR_SPEC,
    BLAZE_SPEC,
    PUFF_SPEC,
    AEGIS_SPEC,
    VOLT_SPEC,
    NOVA_SPEC,
    BRUNO_SPEC,
    LINK_SPEC,
    KIRBY_SPEC,
  ]);

/**
 * Subset of specs that are wired up end-to-end (subclass + moveset +
 * placeholder). Sub-AC 3.5 acceptance reads off this list to verify
 * "2 distinct playable characters" — adding a third (Owl) flips
 * `playable: true` on the spec and that character automatically
 * appears here.
 */
export const PLAYABLE_CHARACTER_SPECS: ReadonlyArray<CharacterSpec> = Object.freeze(
  CHARACTER_SPECS_IN_ROSTER_ORDER.filter((s) => s.playable),
);

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Read a spec by id. Always returns a value because `CHARACTER_ROSTER`
 * is exhaustive over `CharacterId` — if the caller has a typed id, the
 * spec is guaranteed to exist.
 */
export function getCharacterSpec(id: CharacterId): CharacterSpec {
  return CHARACTER_ROSTER[id];
}

/**
 * Read a single move from a character's moveset by `MoveType`. Returns
 * the *first* move whose `type` matches (e.g. the first registered
 * `'jab'`/`'tilt'` for `MoveType = 'jab'`), mirroring the dispatch
 * semantics in `Character.registerAttack`. Returns `undefined` if the
 * character has no move of that type — useful for AI scripts that ask
 * "does Wolf have a smash?" without crashing on placeholder roster
 * entries.
 */
export function findMoveByType(
  spec: CharacterSpec,
  type: MoveType,
): AttackMove | undefined {
  return spec.moves.find((m) => m.type === type);
}
