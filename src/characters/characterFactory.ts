/**
 * Character factory — Sub-AC 5 of AC 10005.
 *
 * "Build character select screen UI and wire selection to instantiate
 * the correct character with its moveset in-match."
 *
 * The Character Select scene already exists end-to-end (see
 * `CharacterSelectScene.ts` + `characterSelect.ts`) and the lineup it
 * synthesises lives on `MatchConfig.players[]` as a list of
 * `PlayerSlot { index, characterId, paletteIndex, inputType, ... }`
 * records. The scene also already routes that lineup through to
 * `MatchScene` via `scene.start('MatchScene', { matchConfig })`. The
 * missing glue this module fills is the *instantiation* side: given a
 * `CharacterId` string from a `PlayerSlot`, produce the correctly-
 * typed concrete subclass (`Wolf` / `Cat` / `Owl` / `Bear`) so the
 * fighter spawns into the match with the moveset its character spec
 * declares.
 *
 * Why a dedicated factory module
 * ------------------------------
 *
 * Two separate call sites need this exact "id → Character" mapping:
 *
 *   1. `Fighter.ts` (the per-player runtime entity) — it already shipped
 *      a private `defaultCharacterFactory` for the same purpose.
 *   2. `MatchScene.ts` (the M1/M2 fight scene) — currently hard-codes
 *      `new Wolf(...)` for slot 1 and `new Cat(...)` for slot 2. With
 *      this factory it can resolve a slot's `characterId` from the
 *      `MatchConfig.players[]` lineup and instantiate the right
 *      subclass without re-writing the switch in each scene file.
 *
 * Centralising the switch in one place means:
 *
 *   • A new roster slot only adds one `case` statement here, not in
 *     every scene that spawns players.
 *   • TypeScript's exhaustiveness check on `CharacterId` flags any
 *     missing case immediately — same `never` guard pattern used in
 *     `Fighter.defaultCharacterFactory`.
 *   • The factory stays Phaser-free at the *type* level (we accept
 *     `Phaser.Scene` only as an opaque parameter passed through to the
 *     subclass constructors). Tests can pass a mock scene shaped like
 *     `Phaser.Scene` — the same MockScene pattern used in
 *     `Roster.test.ts` and `Character.test.ts` — and exercise every
 *     branch of the switch under plain Node.
 *
 * Determinism contract
 * --------------------
 *
 * Pure dispatch — no `Math.random()`, no wall-clock, no environment
 * lookup. Same `(characterId, options)` always produces a Character
 * with the same registered moveset. The replay system already relies
 * on this property indirectly (each subclass registers its moves in
 * its constructor in a fixed order); routing through one factory
 * ensures no scene-specific construction path can drift.
 */

import type Phaser from 'phaser';
import type { CharacterId } from '../types';
import { Character } from './Character';
import { instantiateFighter, isRegisteredFighterId } from './fighterRegistry';

/**
 * Spawn-point and optional-tuning options forwarded to the resolved
 * subclass constructor. Mirrors the shape every concrete subclass
 * (`WolfOptions`, `CatOptions`, `OwlOptions`, `BearOptions`) accepts —
 * `spawnX` / `spawnY` are required, the rest are optional tuning
 * overrides used by Sub-AC 4.5 of AC 6 (per-character balance pass).
 *
 * Tests inject custom mass / runSpeed via the optional fields without
 * having to know which subclass is on the other end of the dispatch.
 */
export interface CreateCharacterOptions {
  readonly spawnX: number;
  readonly spawnY: number;
  /**
   * Optional mass override. Per-test escapes for assertions about
   * knockback scaling that need a heavier or lighter fighter. Forwarded
   * verbatim to the subclass options so the spread merge in each
   * subclass constructor wins over the default tuning.
   */
  readonly mass?: number;
  /**
   * Optional max-run-speed override. Same role as `mass` — lets a
   * balance-pass test pin a fighter to a specific top speed without
   * mutating the canonical `*_TUNING` constants.
   */
  readonly maxRunSpeed?: number;
  /**
   * 0-based player slot. Forwarded to the underlying subclass so the
   * fighter's body picks up its per-slot collision bit and the scene-
   * level pass-through driver can phase platforms per-fighter without
   * cross-talk. Defaults to `0` for legacy / standalone-test paths.
   */
  readonly slotIndex?: number;
}

/**
 * Instantiate the concrete subclass for a given `CharacterId`.
 *
 *   • `'wolf'`  → {@link Wolf}  (bruiser archetype)
 *   • `'cat'`   → {@link Cat}   (ninja archetype)
 *   • `'owl'`   → {@link Owl}   (mage archetype)
 *   • `'bear'`  → {@link Bear}  (grappler archetype)
 *
 * Each returned instance has its full authored moveset registered by
 * the subclass constructor — the same moveset declared in the
 * character spec (see `roster.ts`). The Seed's "4 characters with
 * ~10 moves each" requirement is satisfied for every dispatch branch
 * because each subclass calls `registerAttack(...)` on every move in
 * `*_MOVES` during construction.
 *
 * Throws on an unknown id rather than silently picking a default —
 * a corrupted `MatchConfig` should fail loud at scene start, not
 * stealth-spawn the wrong character. The TypeScript-level exhaustive
 * `never` check means a typed call site can't pass garbage; the
 * runtime check defends against `MatchConfig` JSON loaded from a
 * future replay file with a stale id.
 */
export function createCharacterById(
  scene: Phaser.Scene,
  characterId: CharacterId,
  options: CreateCharacterOptions,
): Character {
  // Sub-AC 3 of the T2 refactor — dispatch is now delegated to
  // `fighterRegistry.ts`, the single source of truth that maps
  // `CharacterId` onto its concrete per-fighter subclass + frozen
  // {@link FighterContract}. The legacy in-line `switch (id)` block
  // (with its parallel `case` lines hard-coding `new Wolf(scene, ...)`
  // / `new Cat(...)` / etc.) is intentionally gone — adding a 5th
  // roster slot now only requires editing the registry, not this
  // factory and `Fighter.defaultCharacterFactory` in lockstep.
  //
  // Behaviour preservation: the registry's `instantiateFighter`
  // invokes the same `new Wolf(scene, opts)` / `new Cat(scene, opts)`
  // / etc. that this factory called previously, so the runtime fighter
  // surface (registered moveset, tuning, body geometry, palette,
  // animation drivers, ...) is byte-for-byte identical to the pre-
  // registry path. The fail-loud behaviour for an unknown id is
  // preserved too: the registry's lookup throws with a descriptive
  // message that mentions the offending id.
  //
  // Defence-in-depth: gate-keep with `isRegisteredFighterId` so a
  // corrupted `MatchConfig` JSON loaded from a stale replay file
  // (e.g. a future `'fox'` literal that doesn't match the current
  // `CharacterId` union) gets a descriptive error here rather than a
  // surprising TypeError downstream.
  if (!isRegisteredFighterId(characterId)) {
    throw new Error(
      `createCharacterById: unknown characterId '${String(characterId)}'`,
    );
  }
  return instantiateFighter(scene, characterId, options);
}

/**
 * Resolve the `characterId` for a given slot index from a
 * `MatchConfig.players[]` lineup. Returns `fallback` when:
 *
 *   • `players` is `undefined` / `null` (e.g. M1 dev-mode "press
 *     ENTER to fight" path that boots `MatchScene` without a
 *     character-select pass).
 *   • No entry in `players` matches the requested `slotIndex`.
 *
 * Why a slot-index-keyed lookup instead of `players[slotIndex - 1]`:
 * the lobby drops un-joined slots from the synthesised array (see
 * `buildPlayerSlotsFromState`), so a 2-player match with P1 + P3
 * produces `players: [{ index: 1, ... }, { index: 3, ... }]`. Indexing
 * by array position (`players[0]` for slot 1, `players[1]` for slot 2)
 * would silently mis-route P3 onto slot 2.
 */
export function resolveSlotCharacterId(
  players: ReadonlyArray<{ readonly index: number; readonly characterId: CharacterId }> | undefined,
  slotIndex: 1 | 2 | 3 | 4,
  fallback: CharacterId,
): CharacterId {
  if (!players) return fallback;
  for (const slot of players) {
    if (slot.index === slotIndex) return slot.characterId;
  }
  return fallback;
}
