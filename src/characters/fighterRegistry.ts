import { Pikachu, PIKACHU_FIGHTER_CONTRACT } from './Pikachu';
/**
 * Fighter registry — Sub-AC 3 of the T2 per-fighter refactor track.
 *
 * Single source of truth mapping a {@link CharacterId} onto its concrete
 * per-fighter subclass + frozen {@link FighterContract} declaration. Every
 * runtime instantiation path (`createCharacterById` from
 * `characterFactory.ts`, `defaultCharacterFactory` from `Fighter.ts`) reads
 * dispatch off this registry instead of carrying its own `switch (id)`
 * statement so:
 *
 *   • Adding a roster slot ("a Fox archetype") only requires
 *     authoring its `Fox.ts` subclass + appending one entry here.
 *     `characterFactory.ts` and `Fighter.ts` keep working with no edit.
 *   • The runtime dispatch path becomes selectable in place of the
 *     base `Character` class — every code path that wants "the Pikachu
 *     fighter" goes through the registry's `ctor` (which constructs a
 *     `Pikachu extends Character`), never `new Character({ id: 'pikachu' })`.
 *     The base Character is reserved for tests / lower-level fixtures.
 *   • Consumers that just want the per-fighter declaration data (AI
 *     predictors, replay HUD, balance tooling, the move-editor surface
 *     a future sub-AC ships) can read `getFighterContract(id)` without
 *     spinning up a Phaser scene to instantiate the subclass.
 *
 * # Determinism contract
 *
 * Every entry is frozen at module load. The `ctor` field is a stable
 * function reference (the class constructor); `contract` points at the
 * frozen `*_FIGHTER_CONTRACT` value declared by the per-fighter module.
 * Same `(characterId, options)` always produces a structurally
 * identical fighter — the property the replay system requires.
 *
 * # Behaviour preservation (Sub-AC 3 invariant)
 *
 * "Without changing runtime behavior yet" — this module does NOT
 * introduce new wiring into the per-frame tick. It is dispatch-only:
 *   1. The `ctor` field invokes the same `new Pikachu(scene, opts)` /
 *      `new DonkeyKong(scene, opts)` / etc. that `characterFactory.ts` and
 *      `Fighter.ts` already invoke today.
 *   2. The `contract` field exposes the same `*_FIGHTER_CONTRACT`
 *      records the per-fighter modules already export.
 *   3. No `Character.ts` runtime path consults this registry — all
 *      attack-implementation code stays where it is until the follow-up
 *      sub-ACs migrate it.
 *
 * The registry is the wiring point that makes the per-fighter
 * subclasses *selectable in place of the base Character* — that is, the
 * canonical dispatch destinations — without changing what those
 * subclasses do once instantiated.
 */

import type { PhysicsHost } from '../physics/PhysicsWorld';
import { CHARACTER_IDS, type CharacterId } from '../types';
import type { Character, CharacterTuning } from './Character';
import type { FighterContract } from './movesetContract';
import { Link, LINK_FIGHTER_CONTRACT } from './Link';
import { DonkeyKong, DONKEYKONG_FIGHTER_CONTRACT } from './DonkeyKong';

/**
 * Spawn-point + optional-tuning options forwarded to a registered
 * fighter constructor. Mirrors `CreateCharacterOptions` from
 * `characterFactory.ts` (re-exported for convenience) so a caller can
 * resolve dispatch through the registry without importing the factory
 * module separately.
 *
 * `mass` / `maxRunSpeed` are tuning escape hatches — primarily used by
 * tests that need a heavier or slower fighter without mutating the
 * canonical `*_TUNING` constants.
 */
export interface FighterRegistryConstructionOptions extends Partial<CharacterTuning> {
  readonly spawnX: number;
  readonly spawnY: number;
  /**
   * 0-based player slot. Forwarded into the subclass constructor so
   * the underlying `Character`'s body picks up the matching
   * `CHARACTER_SLOT_*` bit. Optional for backward compatibility — the
   * `Character` base class defaults to slot 0 when absent.
   */
  readonly slotIndex?: number;
}

/**
 * Constructor signature shared by every per-fighter subclass.
 * Each entry's `ctor` field satisfies this; the registry's
 * `instantiateFighter` helper invokes it with the supplied scene + options.
 *
 * Returning `Character` (the base class) — not the concrete subclass —
 * is intentional: callers that iterate the registry generically need a
 * uniform return type. Callers that want a specific subclass type can
 * import that subclass directly.
 */
export type FighterConstructor = new (
  scene: PhysicsHost,
  options: FighterRegistryConstructionOptions,
) => Character;

/**
 * One registry entry — every concrete fighter's complete dispatch
 * record. Composed of:
 *
 *   • `id` — the canonical {@link CharacterId} the entry is keyed by.
 *     Carried on the entry as well as the lookup key so iteration code
 *     reads `entry.id` instead of the parent map's key.
 *   • `ctor` — the per-fighter class constructor. Called by
 *     {@link instantiateFighter} (and by the legacy
 *     `defaultCharacterFactory` / `createCharacterById` dispatchers
 *     once they've been rewired through this registry).
 *   • `contract` — the per-fighter {@link FighterContract} (identity +
 *     10-slot moveset + movement profile). Lets contract consumers
 *     (AI / HUD / balance tooling) read the per-fighter declaration
 *     without instantiating the subclass.
 */
export interface FighterRegistryEntry {
  readonly id: CharacterId;
  readonly ctor: FighterConstructor;
  readonly contract: FighterContract;
}

/**
 * The frozen registry — one entry per playable `CharacterId`. Iteration
 * goes through {@link FIGHTER_REGISTRY_IDS} (= `CHARACTER_IDS`) so the
 * order is stable and replay-deterministic. The `Record<CharacterId, …>`
 * type makes omitting an entry for any `CharacterId` a compile error.
 */
export const FIGHTER_REGISTRY: Readonly<Record<CharacterId, FighterRegistryEntry>> =
  Object.freeze({
    link: Object.freeze({
      id: 'link',
      ctor: Link as unknown as FighterConstructor,
      contract: LINK_FIGHTER_CONTRACT,
    }),
    pikachu: Object.freeze({ id: 'pikachu', ctor: Pikachu, contract: PIKACHU_FIGHTER_CONTRACT }),
    donkeykong: Object.freeze({
      id: 'donkeykong',
      ctor: DonkeyKong as unknown as FighterConstructor,
      contract: DONKEYKONG_FIGHTER_CONTRACT,
    }),
  });

/** Every registered fighter id, in canonical roster order (`CHARACTER_IDS`). */
export const FIGHTER_REGISTRY_IDS: ReadonlyArray<CharacterId> = CHARACTER_IDS;

/**
 * Frozen ordered list of every registered fighter entry. Same iteration
 * order as {@link FIGHTER_REGISTRY_IDS}. Useful for consumers that want
 * to walk every entry uniformly without dereferencing through the lookup
 * map (e.g. a "render every roster card in order" UI helper or a
 * "validate every fighter's moveset" test invariant).
 */
export const FIGHTER_REGISTRY_ENTRIES: ReadonlyArray<FighterRegistryEntry> =
  Object.freeze(FIGHTER_REGISTRY_IDS.map((id) => FIGHTER_REGISTRY[id]));

/**
 * Look up a registry entry by character id. Throws on an unknown id —
 * same fail-loud contract `createCharacterById` already follows. The
 * thrown error message includes the offending id so a corrupted
 * `MatchConfig` JSON loaded from a stale replay surfaces precisely.
 *
 * Returning the entry (rather than just the constructor or contract)
 * lets the caller branch on whichever field they need. Callers that
 * just want the constructor use {@link getFighterConstructor}; callers
 * that just want the contract use {@link getFighterContract}.
 */
export function getFighterRegistryEntry(id: CharacterId): FighterRegistryEntry {
  const entry = FIGHTER_REGISTRY[id];
  if (!entry) {
    throw new Error(
      `fighterRegistry: unknown characterId '${String(id)}'`,
    );
  }
  return entry;
}

/**
 * Look up the per-fighter constructor by character id. Sugar over
 * {@link getFighterRegistryEntry} for callers that only need to
 * instantiate.
 */
export function getFighterConstructor(id: CharacterId): FighterConstructor {
  return getFighterRegistryEntry(id).ctor;
}

/**
 * Look up the per-fighter {@link FighterContract} by character id. Sugar
 * over {@link getFighterRegistryEntry} for callers that only need the
 * declaration data (AI / HUD / balance tooling) — no scene needed.
 */
export function getFighterContract(id: CharacterId): FighterContract {
  return getFighterRegistryEntry(id).contract;
}

/**
 * Predicate — true iff `value` is a registered fighter id. Useful when
 * the caller has a `string` (e.g. read off a replay log header or a URL
 * query param) and wants to gate-keep before passing it to the registry.
 *
 * Implementation reads off `FIGHTER_REGISTRY` (the source of truth) so
 * a future entry add automatically propagates to the predicate without
 * a parallel literal-list edit.
 */
export function isRegisteredFighterId(value: string): value is CharacterId {
  return Object.prototype.hasOwnProperty.call(FIGHTER_REGISTRY, value);
}

/**
 * Instantiate a fighter through the registry. Centralised dispatch
 * replacement for a per-id `switch (characterId)` block. Forwards `(scene, options)` verbatim to the
 * registered constructor; the constructor's per-fighter spread merge
 * handles tuning overrides.
 *
 * Returns the base-class type (`Character`) so callers iterating
 * heterogeneous fighters get a uniform return; callers that need the
 * concrete subclass type can `instanceof`-narrow at the call site or
 * use the per-class constructor directly.
 */
export function instantiateFighter(
  scene: PhysicsHost,
  characterId: CharacterId,
  options: FighterRegistryConstructionOptions,
): Character {
  const entry = getFighterRegistryEntry(characterId);
  return new entry.ctor(scene, options);
}
