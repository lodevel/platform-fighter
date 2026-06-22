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
 *   • Adding a 5th roster slot ("a Fox archetype") only requires
 *     authoring its `Fox.ts` subclass + appending one entry here.
 *     `characterFactory.ts` and `Fighter.ts` keep working with no edit.
 *   • The runtime dispatch path becomes selectable in place of the
 *     base `Character` class — every code path that wants "the Wolf
 *     fighter" goes through the registry's `ctor` (which constructs a
 *     `Wolf extends Character`), never `new Character({ id: 'wolf' })`.
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
 *   1. The `ctor` field invokes the same `new Wolf(scene, opts)` /
 *      `new Cat(scene, opts)` / etc. that `characterFactory.ts` and
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

import type Phaser from 'phaser';
import type { CharacterId } from '../types';
import type { Character, CharacterTuning } from './Character';
import type { FighterContract } from './movesetContract';
import { Wolf, WOLF_FIGHTER_CONTRACT } from './Wolf';
import { Cat, CAT_FIGHTER_CONTRACT } from './Cat';
import { Owl, OWL_FIGHTER_CONTRACT } from './Owl';
import { Bear, BEAR_FIGHTER_CONTRACT } from './Bear';
import { Blaze, BLAZE_FIGHTER_CONTRACT } from './Blaze';
import { Puff, PUFF_FIGHTER_CONTRACT } from './Puff';
import { Aegis, AEGIS_FIGHTER_CONTRACT } from './Aegis';
import { Volt, VOLT_FIGHTER_CONTRACT } from './Volt';
import { Nova, NOVA_FIGHTER_CONTRACT } from './Nova';
import { Bruno, BRUNO_FIGHTER_CONTRACT } from './Bruno';
import { Link, LINK_FIGHTER_CONTRACT } from './Link';

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
  scene: Phaser.Scene,
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
 * The frozen registry — one entry per playable `CharacterId`. Order in
 * the entries list mirrors the canonical roster authoring order
 * (wolf → cat → owl → bear) so iteration produces stable, replay-
 * deterministic output.
 *
 * # Open-closed extensibility
 *
 * Adding a 5th roster slot is intentionally a one-line edit here:
 *
 *     export const FIGHTER_REGISTRY = Object.freeze({
 *       wolf: { id: 'wolf', ctor: Wolf, contract: WOLF_FIGHTER_CONTRACT },
 *       cat:  { id: 'cat',  ctor: Cat,  contract: CAT_FIGHTER_CONTRACT },
 *       owl:  { id: 'owl',  ctor: Owl,  contract: OWL_FIGHTER_CONTRACT },
 *       bear: { id: 'bear', ctor: Bear, contract: BEAR_FIGHTER_CONTRACT },
 *       fox:  { id: 'fox',  ctor: Fox,  contract: FOX_FIGHTER_CONTRACT }, // new
 *     }) satisfies Readonly<Record<CharacterId, FighterRegistryEntry>>;
 *
 * The `satisfies` clause guarantees that omitting an entry for any
 * `CharacterId` union member fails at compile time — no risk of
 * silently shipping a roster slot with no dispatch.
 */
export const FIGHTER_REGISTRY: Readonly<Record<CharacterId, FighterRegistryEntry>> =
  Object.freeze({
    wolf: Object.freeze({
      id: 'wolf',
      ctor: Wolf as unknown as FighterConstructor,
      contract: WOLF_FIGHTER_CONTRACT,
    }),
    cat: Object.freeze({
      id: 'cat',
      ctor: Cat as unknown as FighterConstructor,
      contract: CAT_FIGHTER_CONTRACT,
    }),
    owl: Object.freeze({
      id: 'owl',
      ctor: Owl as unknown as FighterConstructor,
      contract: OWL_FIGHTER_CONTRACT,
    }),
    bear: Object.freeze({
      id: 'bear',
      ctor: Bear as unknown as FighterConstructor,
      contract: BEAR_FIGHTER_CONTRACT,
    }),
    blaze: Object.freeze({
      id: 'blaze',
      ctor: Blaze as unknown as FighterConstructor,
      contract: BLAZE_FIGHTER_CONTRACT,
    }),
    puff: Object.freeze({
      id: 'puff',
      ctor: Puff as unknown as FighterConstructor,
      contract: PUFF_FIGHTER_CONTRACT,
    }),
    aegis: Object.freeze({
      id: 'aegis',
      ctor: Aegis as unknown as FighterConstructor,
      contract: AEGIS_FIGHTER_CONTRACT,
    }),
    volt: Object.freeze({
      id: 'volt',
      ctor: Volt as unknown as FighterConstructor,
      contract: VOLT_FIGHTER_CONTRACT,
    }),
    nova: Object.freeze({
      id: 'nova',
      ctor: Nova as unknown as FighterConstructor,
      contract: NOVA_FIGHTER_CONTRACT,
    }),
    bruno: Object.freeze({
      id: 'bruno',
      ctor: Bruno as unknown as FighterConstructor,
      contract: BRUNO_FIGHTER_CONTRACT,
    }),
    link: Object.freeze({
      id: 'link',
      ctor: Link as unknown as FighterConstructor,
      contract: LINK_FIGHTER_CONTRACT,
    }),
  });

/**
 * Frozen ordered list of every registered fighter id, in canonical
 * roster order. Same iteration order as the `FIGHTER_REGISTRY` keys —
 * surfaced as a constant so consumers don't have to call
 * `Object.keys(FIGHTER_REGISTRY)` (which historically was ordering-
 * unsafe across JS engines, even though every modern engine now
 * preserves insertion order).
 */
export const FIGHTER_REGISTRY_IDS: ReadonlyArray<CharacterId> = Object.freeze([
  'wolf',
  'cat',
  'owl',
  'bear',
  'blaze',
  'puff',
  'aegis',
  'volt',
  'nova',
  'bruno',
  'link',
]);

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
 * replacement for the legacy `switch (characterId) { case 'wolf': new
 * Wolf(...); ... }` block. Forwards `(scene, options)` verbatim to the
 * registered constructor; the constructor's per-fighter spread merge
 * handles tuning overrides.
 *
 * Returns the base-class type (`Character`) so callers iterating
 * heterogeneous fighters get a uniform return; callers that need the
 * concrete subclass type can `instanceof`-narrow at the call site or
 * use the per-class constructor directly.
 */
export function instantiateFighter(
  scene: Phaser.Scene,
  characterId: CharacterId,
  options: FighterRegistryConstructionOptions,
): Character {
  const entry = getFighterRegistryEntry(characterId);
  return new entry.ctor(scene, options);
}
