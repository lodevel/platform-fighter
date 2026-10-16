import { PIKACHU_TUNING, PIKACHU_MOVES } from './Pikachu';
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
 *                     by its subclass constructor so a
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
 *     getCharacterSpec('donkeykong') →
 *       { id: 'donkeykong', displayName: 'Donkey Kong', role: …,
 *         tuning: DONKEYKONG_TUNING, moves: DONKEYKONG_MOVES,
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
 * Roster: Donkey Kong, Pikachu and Link. `CHARACTER_ROSTER` stays
 * exhaustive over the `CharacterId` union, so TypeScript flags any code
 * path that forgets to handle a new id.
 */

import { CHARACTER_IDS, type CharacterId, type MoveType } from '../types';
import { ASSET_KEYS } from '../assets/manifest';
import type { AttackMove } from './attacks';
import { type CharacterTuning } from './Character';
import {FRESH_LINK_NORMALS} from './linkFreshNormals';
import {FRESH_LINK_RECOVERY_ATTACKS} from './linkFreshKit';
import {
  LINK_TUNING,
  LINK_NEUTRAL_SPECIAL,
  LINK_SIDE_SPECIAL,
  LINK_UP_SPECIAL,
  LINK_DOWN_SPECIAL,
} from './Link';
import {
  DONKEYKONG_TUNING,
  DONKEYKONG_JAB,
  DONKEYKONG_TILT,
  DONKEYKONG_SMASH,
  DONKEYKONG_NAIR,
  DONKEYKONG_FAIR,
  DONKEYKONG_BAIR,
  DONKEYKONG_NEUTRAL_SPECIAL,
  DONKEYKONG_SIDE_SPECIAL,
  DONKEYKONG_UP_SPECIAL,
  DONKEYKONG_DOWN_SPECIAL,
} from './DonkeyKong';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Sprite placeholder visual descriptor — drives the flat-colour
 * `Phaser.GameObjects.Rectangle` the M1/M2 scaffold renders in place
 * of a real sprite atlas. Centralising this here means:
 *
 *   • The body rectangle, the HUD percent label, and the post-match
 *     "PIKACHU WINS!" banner all read from one source. A theme tweak in
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
   * concrete characters so the visual rectangle
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
    Omit<CharacterTuning, 'shield' | 'dodge' | 'ledge' | 'ledgeDetection' | 'locomotion' | 'referenceWeight' | 'referenceLaunch'>
  > & Pick<CharacterTuning, 'referenceWeight' | 'referenceLaunch'>;
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
   * False for `placeholder` entries whose moveset is empty and whose subclass has not yet shipped.
   * Lets selection UI grey out unfinished slots without hard-coding
   * a "released" list.
   */
  readonly playable: boolean;
}

// ---------------------------------------------------------------------------
// Move tables (frozen — referenced by each spec and re-exported for tests)
// ---------------------------------------------------------------------------

/**
 * Fresh Link source lineage:16 normals,4 recovery contexts and4 intrinsics.
 * The same records feed actor registration and new Lab/save defaults.
 */
export const LINK_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  ...Object.values(FRESH_LINK_NORMALS),...Object.values(FRESH_LINK_RECOVERY_ATTACKS),
  LINK_NEUTRAL_SPECIAL,LINK_SIDE_SPECIAL,LINK_UP_SPECIAL,LINK_DOWN_SPECIAL,
]);

/**
 * Donkey Kong's full moveset — same 10-entry shape as the rest of the
 * cast, mirroring the registration call sequence in {@link DonkeyKong}.
 * Thirteenth roster slot: the mobile heavyweight bruiser (DK archetype).
 */
export const DONKEYKONG_MOVES: ReadonlyArray<AttackMove> = Object.freeze([
  DONKEYKONG_JAB,
  DONKEYKONG_TILT,
  DONKEYKONG_SMASH,
  DONKEYKONG_NAIR,
  DONKEYKONG_FAIR,
  DONKEYKONG_BAIR,
  DONKEYKONG_NEUTRAL_SPECIAL,
  DONKEYKONG_SIDE_SPECIAL,
  DONKEYKONG_UP_SPECIAL,
  DONKEYKONG_DOWN_SPECIAL,
]);

// ---------------------------------------------------------------------------
// Placeholder visual constants
// ---------------------------------------------------------------------------

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
  // First AI-generated sprite pack (Z-Image ControlNet pose-source pipeline).
  // Non-null spriteKey → MatchScene draws the real idle/run/jump/attack sheets
  // (the primary/accent colours remain the char-select identity).
  spriteKey: ASSET_KEYS.charLinkIdle,
});

/**
 * Donkey Kong placeholder — ape brown with a tan accent (the mobile
 * heavyweight bruiser). Procedural pipeline (`spriteKey: null`) until a
 * sprite pack lands. Largest body in the cast (60×84).
 */
export const DONKEYKONG_PLACEHOLDER: CharacterPlaceholderVisual = Object.freeze({
  primaryColor: 0x6b4a2b, // ape brown
  accentColor: 0xe8b86a,
  labelColor: 0xe8b86a,
  width: DONKEYKONG_TUNING.width,
  height: DONKEYKONG_TUNING.height,
  // AI sprite pack (full per-move set + crouch). Non-null spriteKey → real sheets.
  spriteKey: ASSET_KEYS.charDonkeykongIdle,
});

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

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
 * Donkey Kong spec — the mobile heavyweight bruiser (DK archetype).
 * Heavy mass with real run speed, built around a
 * chargeable giant punch, a shoulder-charge approach, a spinning-kong
 * recovery, and a ground-pound. Procedural placeholder pipeline.
 */
export const DONKEYKONG_SPEC: CharacterSpec = Object.freeze({
  id: 'donkeykong',
  displayName: 'Donkey Kong',
  role: 'mobile heavyweight (Donkey Kong)',
  tuning: DONKEYKONG_TUNING,
  moves: DONKEYKONG_MOVES,
  placeholder: DONKEYKONG_PLACEHOLDER,
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
export const PIKACHU_SPEC: CharacterSpec = Object.freeze({
  id: 'pikachu', displayName: 'Pikachu', role: 'electric combo fighter',
  tuning: PIKACHU_TUNING, moves: PIKACHU_MOVES,
  placeholder: Object.freeze({ primaryColor: 0xf5d739, accentColor: 0x9b5a31,
    labelColor: 0xf5d739, width: 40, height: 50, spriteKey: 'char.pikachu.idle' }),
  playable: true,
});

export const CHARACTER_ROSTER: Readonly<Record<CharacterId, CharacterSpec>> =
  Object.freeze({
    link: LINK_SPEC,
    donkeykong: DONKEYKONG_SPEC,
    pikachu: PIKACHU_SPEC,
  });

/**
 * Ordered list of every spec in the roster, in `CHARACTER_IDS` order, so
 * a grid renderer doesn't have to re-sort.
 */
export const CHARACTER_SPECS_IN_ROSTER_ORDER: ReadonlyArray<CharacterSpec> =
  Object.freeze(CHARACTER_IDS.map((id) => CHARACTER_ROSTER[id]));

/**
 * Subset of specs that are wired up end-to-end (subclass + moveset +
 * placeholder). Flipping `playable: true` on a spec makes that character
 * appear here.
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
 * "does Pikachu have a smash?" without crashing on placeholder roster
 * entries.
 */
export function findMoveByType(
  spec: CharacterSpec,
  type: MoveType,
): AttackMove | undefined {
  return spec.moves.find((m) => m.type === type);
}
