/**
 * Full-moveset animation driver — AC 10003 Sub-AC 3.
 *
 * Single character-aware integration layer that ties together the
 * animation-key contract (`{characterId}.{movePartId}.{phase}.{frame}`)
 * for **every move in every fighter's full moveset**, not just the
 * grounded triplet (`groundedNormalDriver.ts` already covers
 * jab / tilt / smash). The Seed's "moveset" ontology calls out:
 *
 *   • jab / tilt / smash             — grounded triplet (already covered by
 *                                      `groundedNormalDriver.ts`).
 *   • neutral / forward / back aerial — 3 aerials per character.
 *   • neutral / side / up / down special — 4 special slots per character.
 *   • shield / dodge / edge-grab      — 3 defensive states (covered by
 *                                       `defensiveAnimationState.ts`,
 *                                       this driver re-exports the
 *                                       integration entry points).
 *
 * Together: 10 distinct moves per fighter (jab + tilt + smash + 3 aerials
 * + 4 specials = 10; defensive states are not "attack moves" but their
 * animation keys live in this same registry for renderer convenience).
 *
 * # Why a single driver
 *
 * Three reasons:
 *
 *   1. **One source of truth.** The renderer's `setTexture` call site
 *      doesn't have to branch on slot kind — it asks
 *      `getCurrentAnimation(character)` once per frame and trusts the
 *      driver to return the right key whether the fighter is mid-jab,
 *      mid-aerial, mid-counter-special, or mid-shield-break.
 *
 *   2. **Asset-pipeline-friendly enumeration.** The (later-AC) sprite-
 *      atlas pipeline iterates `enumerateAllMovesetAnimationKeys()` to
 *      know exactly which texture keys to register. Adding a new fighter
 *      = adding one entry to `MOVESET_TABLE`; no update to the asset
 *      pipeline, the AI predictor, or the replay system.
 *
 *   3. **Determinism.** Every helper here is a pure function of frozen
 *      move data + integer frame counters. Identical inputs always
 *      produce identical outputs — the property the replay system
 *      requires for the hybrid input-replay + state-snapshot architecture
 *      to keep the displayed art frame in lockstep with the gameplay
 *      hitbox phase across a VCR scrub.
 *
 * # Slot taxonomy
 *
 * The {@link MovesetSlot} union enumerates every move slot a fighter
 * can dispatch into. Three sub-groups:
 *
 *   • **Grounded normals** — `'jab' | 'tilt' | 'smash'`.
 *   • **Aerials**          — `'nair' | 'fair' | 'bair'`.
 *   • **Specials**         — `'neutralSpecial' | 'sideSpecial' |
 *                              'upSpecial' | 'downSpecial'`.
 *
 * Total = 3 + 3 + 4 = 10 slots. Each maps to exactly one
 * `AttackMoveWithAnimation` per character via `MOVESET_TABLE`.
 *
 * # Animation key shape
 *
 * Same canonical key shape as `animationState.ts`:
 *
 *     `{characterId}.{movePartId}.{phase}.{artFrameIndex}`
 *
 * Where `movePartId` is the trailing half of the move id after the
 * leading `'{characterId}.'` prefix. So Wolf's neutral special
 * (`'wolf.neutral_special'`) produces keys like
 * `wolf.neutral_special.startup.0` etc.
 *
 * # Backwards compatibility
 *
 * This module is purely additive — it re-exports the existing
 * `groundedNormalDriver` slots verbatim and adds aerial / special /
 * defensive-state slots on top. The existing runtime, tests, and AI
 * code paths keep working unchanged. New consumers (the renderer when
 * the sprite atlas drops, the asset pipeline, the move-editor tool)
 * import from this module for one-stop access.
 */

import type { CharacterId } from '../types';
import type { AttackMoveWithAnimation } from './moveSchema';
import {
  type AnimationState,
  type AnimationCancelRule,
  enumerateMoveAnimationKeys,
  getAnimationKey,
  getIdleAnimationKey,
  getMovePartId,
  resolveAttackAnimation,
} from './animationState';
import { computeAttackPhase, getMoveBusyFrames, selectAnimationFrame, type LiveAttackPhase } from './moveSchema';
import { GROUNDED_NORMAL_TABLE, GROUNDED_NORMAL_SLOTS, type GroundedNormalSlot } from './groundedNormalDriver';
import {
  WOLF_NAIR_AERIAL,
  WOLF_FAIR,
  WOLF_BAIR,
  WOLF_NEUTRAL_SPECIAL,
  WOLF_SIDE_SPECIAL,
  WOLF_UP_SPECIAL,
  WOLF_DOWN_SPECIAL,
} from './Wolf';
import {
  CAT_NAIR_AERIAL,
  CAT_FAIR,
  CAT_BAIR,
  CAT_NEUTRAL_SPECIAL,
  CAT_SIDE_SPECIAL,
  CAT_UP_SPECIAL,
  CAT_DOWN_SPECIAL,
} from './Cat';
import {
  OWL_NAIR,
  OWL_FAIR,
  OWL_BAIR,
  OWL_NEUTRAL_SPECIAL,
  OWL_SIDE_SPECIAL,
  OWL_UP_SPECIAL,
  OWL_DOWN_SPECIAL,
} from './Owl';
import {
  BEAR_NAIR,
  BEAR_FAIR,
  BEAR_BAIR,
  BEAR_NEUTRAL_SPECIAL,
  BEAR_SIDE_SPECIAL,
  BEAR_UP_SPECIAL,
  BEAR_DOWN_SPECIAL,
} from './Bear';
import {
  BLAZE_NAIR,
  BLAZE_FAIR,
  BLAZE_BAIR,
  BLAZE_NEUTRAL_SPECIAL,
  BLAZE_SIDE_SPECIAL,
  BLAZE_UP_SPECIAL,
  BLAZE_DOWN_SPECIAL,
} from './Blaze';
import {
  PUFF_NAIR,
  PUFF_FAIR,
  PUFF_BAIR,
  PUFF_NEUTRAL_SPECIAL,
  PUFF_SIDE_SPECIAL,
  PUFF_UP_SPECIAL,
  PUFF_DOWN_SPECIAL,
} from './Puff';
import {
  AEGIS_NAIR,
  AEGIS_FAIR,
  AEGIS_BAIR,
  AEGIS_NEUTRAL_SPECIAL,
  AEGIS_SIDE_SPECIAL,
  AEGIS_UP_SPECIAL,
  AEGIS_DOWN_SPECIAL,
} from './Aegis';
import {
  VOLT_NAIR,
  VOLT_FAIR,
  VOLT_BAIR,
  VOLT_NEUTRAL_SPECIAL,
  VOLT_SIDE_SPECIAL,
  VOLT_UP_SPECIAL,
  VOLT_DOWN_SPECIAL,
} from './Volt';
import {
  NOVA_NAIR,
  NOVA_FAIR,
  NOVA_BAIR,
  NOVA_NEUTRAL_SPECIAL,
  NOVA_SIDE_SPECIAL,
  NOVA_UP_SPECIAL,
  NOVA_DOWN_SPECIAL,
} from './Nova';
import {
  BRUNO_NAIR,
  BRUNO_FAIR,
  BRUNO_BAIR,
  BRUNO_NEUTRAL_SPECIAL,
  BRUNO_SIDE_SPECIAL,
  BRUNO_UP_SPECIAL,
  BRUNO_DOWN_SPECIAL,
} from './Bruno';
import {
  LINK_NAIR,
  LINK_FAIR,
  LINK_BAIR,
  LINK_NEUTRAL_SPECIAL,
  LINK_SIDE_SPECIAL,
  LINK_UP_SPECIAL,
  LINK_DOWN_SPECIAL,
} from './Link';
import {
  KIRBY_NAIR,
  KIRBY_FAIR,
  KIRBY_BAIR,
  KIRBY_NEUTRAL_SPECIAL,
  KIRBY_SIDE_SPECIAL,
  KIRBY_UP_SPECIAL,
  KIRBY_DOWN_SPECIAL,
} from './Kirby';
import {
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
 * Aerial move slot — neutral / forward / back. Mirrors the
 * `AerialDirection` union in `aerialSchema.ts` but pinned to the three
 * directional slots the M2 movesets actually ship.
 */
export type AerialSlot = 'nair' | 'fair' | 'bair';

/**
 * Special-move slot. Maps to the four canonical Smash special directions
 * (neutral / side / up / down) with no compass-style overlap — every
 * fighter ships exactly one move per slot.
 */
export type SpecialSlot =
  | 'neutralSpecial'
  | 'sideSpecial'
  | 'upSpecial'
  | 'downSpecial';

/**
 * Top-level moveset slot — every move kind a fighter can dispatch into.
 * Used as the discriminant for the {@link MovesetEntry} table.
 */
export type MovesetSlot = GroundedNormalSlot | AerialSlot | SpecialSlot;

/**
 * Ordered list of every moveset slot in the canonical display order:
 * grounded triplet → aerial triplet → 4 specials. Iteration order is
 * the same order the per-character `*_MOVES` constants in `roster.ts`
 * list them.
 */
export const MOVESET_SLOTS: ReadonlyArray<MovesetSlot> = Object.freeze([
  ...GROUNDED_NORMAL_SLOTS,
  'nair',
  'fair',
  'bair',
  'neutralSpecial',
  'sideSpecial',
  'upSpecial',
  'downSpecial',
]);

/**
 * Aerial slots in canonical order (mirrors the `*_MOVES` list ordering).
 */
export const AERIAL_SLOTS: ReadonlyArray<AerialSlot> = Object.freeze([
  'nair',
  'fair',
  'bair',
]);

/**
 * Special slots in canonical order: neutral → side → up → down.
 * Mirrors `SPECIAL_DIRECTIONS` in `specialFramework.ts` (with neutral
 * promoted to first since the move-table consistently lists it first).
 */
export const SPECIAL_SLOTS: ReadonlyArray<SpecialSlot> = Object.freeze([
  'neutralSpecial',
  'sideSpecial',
  'upSpecial',
  'downSpecial',
]);

/**
 * One moveset entry — a `(characterId, slot, move)` triple pulled from
 * the per-character data.
 */
export interface MovesetEntry {
  readonly characterId: CharacterId;
  readonly slot: MovesetSlot;
  readonly move: AttackMoveWithAnimation;
}

/**
 * Per-character moveset bundle. Keyed by {@link MovesetSlot} so the
 * renderer can look up "the move attached to Wolf's `'fair'` slot"
 * directly.
 */
export type CharacterMoveset = Readonly<Record<MovesetSlot, AttackMoveWithAnimation>>;

// ---------------------------------------------------------------------------
// Move-table catalog — full-moveset (10 slots × 4 characters = 40 entries)
// ---------------------------------------------------------------------------

/**
 * Full moveset table — for every roster slot, every move slot's
 * authored `AttackMoveWithAnimation` record. Frozen at module load so
 * consumers (asset pipeline, AI scripts, balance tooling, the move-
 * editor tool) never have to defensive-clone.
 *
 * The `'nair'` slot prefers the `*_NAIR_AERIAL` constant when the
 * character ships one (Wolf, Cat) — those entries carry the full
 * `AerialMove` shape with `landingLagFrames` and `autoCancelWindows`.
 * Owl and Bear's `*_NAIR` entries are typed `AttackMove` for backwards
 * compat; they still satisfy `AttackMoveWithAnimation` thanks to the
 * shared `animation` block.
 */
export const MOVESET_TABLE: Readonly<Record<CharacterId, CharacterMoveset>> = Object.freeze({
  wolf: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.wolf.jab,
    tilt: GROUNDED_NORMAL_TABLE.wolf.tilt,
    smash: GROUNDED_NORMAL_TABLE.wolf.smash,
    nair: WOLF_NAIR_AERIAL,
    fair: WOLF_FAIR,
    bair: WOLF_BAIR,
    neutralSpecial: WOLF_NEUTRAL_SPECIAL,
    sideSpecial: WOLF_SIDE_SPECIAL,
    upSpecial: WOLF_UP_SPECIAL,
    downSpecial: WOLF_DOWN_SPECIAL,
  }),
  cat: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.cat.jab,
    tilt: GROUNDED_NORMAL_TABLE.cat.tilt,
    smash: GROUNDED_NORMAL_TABLE.cat.smash,
    nair: CAT_NAIR_AERIAL,
    fair: CAT_FAIR,
    bair: CAT_BAIR,
    neutralSpecial: CAT_NEUTRAL_SPECIAL,
    sideSpecial: CAT_SIDE_SPECIAL,
    upSpecial: CAT_UP_SPECIAL,
    downSpecial: CAT_DOWN_SPECIAL,
  }),
  owl: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.owl.jab,
    tilt: GROUNDED_NORMAL_TABLE.owl.tilt,
    smash: GROUNDED_NORMAL_TABLE.owl.smash,
    nair: OWL_NAIR as AttackMoveWithAnimation,
    fair: OWL_FAIR,
    bair: OWL_BAIR,
    neutralSpecial: OWL_NEUTRAL_SPECIAL,
    sideSpecial: OWL_SIDE_SPECIAL,
    upSpecial: OWL_UP_SPECIAL,
    downSpecial: OWL_DOWN_SPECIAL,
  }),
  bear: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.bear.jab,
    tilt: GROUNDED_NORMAL_TABLE.bear.tilt,
    smash: GROUNDED_NORMAL_TABLE.bear.smash,
    nair: BEAR_NAIR as AttackMoveWithAnimation,
    fair: BEAR_FAIR,
    bair: BEAR_BAIR,
    neutralSpecial: BEAR_NEUTRAL_SPECIAL,
    sideSpecial: BEAR_SIDE_SPECIAL,
    upSpecial: BEAR_UP_SPECIAL,
    downSpecial: BEAR_DOWN_SPECIAL,
  }),
  blaze: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.blaze.jab,
    tilt: GROUNDED_NORMAL_TABLE.blaze.tilt,
    smash: GROUNDED_NORMAL_TABLE.blaze.smash,
    nair: BLAZE_NAIR,
    fair: BLAZE_FAIR,
    bair: BLAZE_BAIR,
    neutralSpecial: BLAZE_NEUTRAL_SPECIAL,
    sideSpecial: BLAZE_SIDE_SPECIAL,
    upSpecial: BLAZE_UP_SPECIAL,
    downSpecial: BLAZE_DOWN_SPECIAL,
  }),
  puff: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.puff.jab,
    tilt: GROUNDED_NORMAL_TABLE.puff.tilt,
    smash: GROUNDED_NORMAL_TABLE.puff.smash,
    nair: PUFF_NAIR,
    fair: PUFF_FAIR,
    bair: PUFF_BAIR,
    neutralSpecial: PUFF_NEUTRAL_SPECIAL,
    sideSpecial: PUFF_SIDE_SPECIAL,
    upSpecial: PUFF_UP_SPECIAL,
    downSpecial: PUFF_DOWN_SPECIAL,
  }),
  aegis: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.aegis.jab,
    tilt: GROUNDED_NORMAL_TABLE.aegis.tilt,
    smash: GROUNDED_NORMAL_TABLE.aegis.smash,
    nair: AEGIS_NAIR,
    fair: AEGIS_FAIR,
    bair: AEGIS_BAIR,
    neutralSpecial: AEGIS_NEUTRAL_SPECIAL,
    sideSpecial: AEGIS_SIDE_SPECIAL,
    upSpecial: AEGIS_UP_SPECIAL,
    downSpecial: AEGIS_DOWN_SPECIAL,
  }),
  volt: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.volt.jab,
    tilt: GROUNDED_NORMAL_TABLE.volt.tilt,
    smash: GROUNDED_NORMAL_TABLE.volt.smash,
    nair: VOLT_NAIR,
    fair: VOLT_FAIR,
    bair: VOLT_BAIR,
    neutralSpecial: VOLT_NEUTRAL_SPECIAL,
    sideSpecial: VOLT_SIDE_SPECIAL,
    upSpecial: VOLT_UP_SPECIAL,
    downSpecial: VOLT_DOWN_SPECIAL,
  }),
  nova: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.nova.jab,
    tilt: GROUNDED_NORMAL_TABLE.nova.tilt,
    smash: GROUNDED_NORMAL_TABLE.nova.smash,
    nair: NOVA_NAIR,
    fair: NOVA_FAIR,
    bair: NOVA_BAIR,
    neutralSpecial: NOVA_NEUTRAL_SPECIAL,
    sideSpecial: NOVA_SIDE_SPECIAL,
    upSpecial: NOVA_UP_SPECIAL,
    downSpecial: NOVA_DOWN_SPECIAL,
  }),
  bruno: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.bruno.jab,
    tilt: GROUNDED_NORMAL_TABLE.bruno.tilt,
    smash: GROUNDED_NORMAL_TABLE.bruno.smash,
    nair: BRUNO_NAIR,
    fair: BRUNO_FAIR,
    bair: BRUNO_BAIR,
    neutralSpecial: BRUNO_NEUTRAL_SPECIAL,
    sideSpecial: BRUNO_SIDE_SPECIAL,
    upSpecial: BRUNO_UP_SPECIAL,
    downSpecial: BRUNO_DOWN_SPECIAL,
  }),
  link: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.link.jab,
    tilt: GROUNDED_NORMAL_TABLE.link.tilt,
    smash: GROUNDED_NORMAL_TABLE.link.smash,
    nair: LINK_NAIR,
    fair: LINK_FAIR,
    bair: LINK_BAIR,
    neutralSpecial: LINK_NEUTRAL_SPECIAL,
    sideSpecial: LINK_SIDE_SPECIAL,
    upSpecial: LINK_UP_SPECIAL,
    downSpecial: LINK_DOWN_SPECIAL,
  }),
  kirby: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.kirby.jab,
    tilt: GROUNDED_NORMAL_TABLE.kirby.tilt,
    smash: GROUNDED_NORMAL_TABLE.kirby.smash,
    nair: KIRBY_NAIR,
    fair: KIRBY_FAIR,
    bair: KIRBY_BAIR,
    neutralSpecial: KIRBY_NEUTRAL_SPECIAL,
    sideSpecial: KIRBY_SIDE_SPECIAL,
    upSpecial: KIRBY_UP_SPECIAL,
    downSpecial: KIRBY_DOWN_SPECIAL,
  }),
  donkeykong: Object.freeze({
    jab: GROUNDED_NORMAL_TABLE.donkeykong.jab,
    tilt: GROUNDED_NORMAL_TABLE.donkeykong.tilt,
    smash: GROUNDED_NORMAL_TABLE.donkeykong.smash,
    nair: DONKEYKONG_NAIR,
    fair: DONKEYKONG_FAIR,
    bair: DONKEYKONG_BAIR,
    neutralSpecial: DONKEYKONG_NEUTRAL_SPECIAL,
    sideSpecial: DONKEYKONG_SIDE_SPECIAL,
    upSpecial: DONKEYKONG_UP_SPECIAL,
    downSpecial: DONKEYKONG_DOWN_SPECIAL,
  }),
});

/**
 * Flat array of every moveset entry across the roster — 100 entries
 * (10 characters × 10 slots). Iteration order: roster on the outer axis
 * (wolf → cat → owl → bear → blaze → puff → aegis → volt → nova →
 * bruno), slot on the inner ({@link MOVESET_SLOTS}).
 */
export const MOVESET_ENTRIES: ReadonlyArray<MovesetEntry> = Object.freeze(
  (['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno', 'link', 'kirby', 'donkeykong'] as const).flatMap((characterId) =>
    MOVESET_SLOTS.map((slot) =>
      Object.freeze({
        characterId,
        slot,
        move: MOVESET_TABLE[characterId][slot],
      }),
    ),
  ),
);

/**
 * Look up a single moveset entry by `(characterId, slot)`. Pure /
 * deterministic. Returns the move directly — every roster slot ships
 * its full 10-move kit so this never returns `undefined`.
 */
export function getMovesetMove(
  characterId: CharacterId,
  slot: MovesetSlot,
): AttackMoveWithAnimation {
  return MOVESET_TABLE[characterId][slot];
}

// ---------------------------------------------------------------------------
// Animation key resolution — full moveset
// ---------------------------------------------------------------------------

/**
 * Return the canonical animation key the renderer should display for
 * any moveset slot at any gameplay frame. Mirrors what
 * `getCurrentAnimation()` produces off the live runtime, so AI
 * predictors / replay-snapshot reconstruction can derive the displayed
 * art frame without spinning up a Phaser scene.
 *
 * Returns the idle key (`{characterId}.idle`) when the move has
 * terminated (`framesElapsed >= getMoveBusyFrames(move)`).
 *
 *   resolveMovesetAnimationKey('wolf', 'fair', 0)  → 'wolf.fair.startup.0'
 *   resolveMovesetAnimationKey('cat', 'upSpecial', 5) → 'cat.up_special.startup.0'  (ish)
 */
export function resolveMovesetAnimationKey(
  characterId: CharacterId,
  slot: MovesetSlot,
  framesElapsed: number,
): string {
  const move = MOVESET_TABLE[characterId][slot];
  const phase = computeAttackPhase(framesElapsed, move);
  if (phase === 'done') {
    return getIdleAnimationKey(characterId);
  }
  const sel = selectAnimationFrame(framesElapsed, move);
  return getAnimationKey(characterId, move.id, phase as LiveAttackPhase, sel.artFrameIndex);
}

/**
 * Return the fully-resolved {@link AnimationState} for a moveset slot
 * at any gameplay frame, with a caller-supplied facing locked in.
 * Convenience wrapper around `resolveAttackAnimation`.
 */
export function resolveMovesetAnimationState(
  characterId: CharacterId,
  slot: MovesetSlot,
  framesElapsed: number,
  facing: 1 | -1,
): AnimationState {
  const move = MOVESET_TABLE[characterId][slot];
  return resolveAttackAnimation(characterId, move, framesElapsed, facing);
}

/**
 * Enumerate every animation key a single moveset slot can produce over
 * its full lifecycle, in display order. Useful for the asset pipeline
 * (texture registration), debug HUD (art-frame strip preview), and tests.
 *
 * If the move declares no `animation` block, the lifecycle is one key
 * per phase (3 keys total).
 */
export function enumerateMovesetSlotAnimationKeys(
  characterId: CharacterId,
  slot: MovesetSlot,
): ReadonlyArray<string> {
  return enumerateMoveAnimationKeys(characterId, MOVESET_TABLE[characterId][slot]);
}

/**
 * Enumerate every animation key across the entire roster's full
 * moveset — the canonical list the (later) sprite-atlas pipeline iterates
 * to register textures. Includes idle keys (one per character).
 *
 *   keys.length = 7 idle + Σ over all 70 moveset entries of their
 *                 lifecycle key counts
 *
 * Pure / deterministic — same iteration order on every call. Frozen
 * at module load via {@link Object.freeze}.
 */
export function enumerateAllMovesetAnimationKeys(): ReadonlyArray<string> {
  const out: string[] = [];
  for (const id of ['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno', 'link', 'kirby', 'donkeykong'] as const) {
    out.push(getIdleAnimationKey(id));
    for (const slot of MOVESET_SLOTS) {
      const move = MOVESET_TABLE[id][slot];
      const lifecycleKeys = enumerateMoveAnimationKeys(id, move);
      for (const k of lifecycleKeys) out.push(k);
    }
  }
  return Object.freeze(out);
}

/**
 * Enumerate the full ordered list of {@link AnimationState}s a single
 * moveset slot produces over its lifecycle (frame 0 through
 * `endFrame - 1` inclusive, then a trailing idle state).
 *
 * Mirrors `enumerateGroundedNormalAnimationStates` from
 * `groundedNormalDriver.ts` so consumers have one entry-point per
 * granularity (per-slot lifecycle vs. whole-roster enumeration).
 */
export function enumerateMovesetSlotAnimationStates(
  characterId: CharacterId,
  slot: MovesetSlot,
  facing: 1 | -1 = 1,
): ReadonlyArray<AnimationState> {
  const move = MOVESET_TABLE[characterId][slot];
  const out: AnimationState[] = [];
  const busy = getMoveBusyFrames(move);
  for (let f = 0; f < busy; f++) {
    out.push(resolveAttackAnimation(characterId, move, f, facing));
  }
  // Trailing idle state — what the renderer flips to once the move ends.
  out.push({
    key: getIdleAnimationKey(characterId),
    characterId,
    movePartId: null,
    phase: 'idle',
    artFrameIndex: 0,
    facing,
  });
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// Slot reverse-lookup — useful for AI / debug code that has a move id
// and wants to know which slot it occupies on the character.
// ---------------------------------------------------------------------------

/**
 * Return the moveset slot a given move id occupies on a character.
 * Returns `null` if the id doesn't match any slot on that character —
 * defensive, since a typo'd id shouldn't crash the (later) debug HUD.
 *
 *   findMovesetSlot('wolf', 'wolf.jab')          → 'jab'
 *   findMovesetSlot('cat',  'cat.fair')          → 'fair'
 *   findMovesetSlot('bear', 'bear.up_special')   → 'upSpecial'
 *   findMovesetSlot('wolf', 'cat.jab')           → null
 *   findMovesetSlot('wolf', 'unknown')           → null
 */
export function findMovesetSlot(
  characterId: CharacterId,
  moveId: string,
): MovesetSlot | null {
  const moveset = MOVESET_TABLE[characterId];
  for (const slot of MOVESET_SLOTS) {
    if (moveset[slot].id === moveId) return slot;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cancel-rule alignment — the same five rules apply to every slot.
// ---------------------------------------------------------------------------

/**
 * Per-slot cancel-rule alignment table. Each entry names a cancel rule
 * from {@link AnimationCancelRule} and points at the runtime call site
 * that enforces the rule for the full-moveset lifecycle. Identical
 * runtime enforcement points to those listed in
 * `groundedNormalDriver.GROUNDED_NORMAL_LIFECYCLE_RULES` because the
 * gameplay state machine is a single shared path
 * (`Character.tickAttack`) regardless of slot.
 *
 * Listed here so AC 10003 Sub-AC 3 verification has one source of truth
 * to read against without re-deriving "yes, every move on every
 * character behaves this way".
 */
export const MOVESET_LIFECYCLE_RULES: ReadonlyArray<{
  readonly rule: AnimationCancelRule;
  readonly summary: string;
  readonly enforcedBy: string;
}> = Object.freeze([
  Object.freeze({
    rule: 'hit-cancel',
    summary:
      'Any in-flight attack (grounded normal, aerial, or special) is cancelled by an incoming hit; animation flips to idle on the next poll.',
    enforcedBy: 'Character.applyHit → cancelAttack',
  }),
  Object.freeze({
    rule: 'respawn-cancel',
    summary:
      'Respawn / replay-seek teleport cancels any in-flight attack so the fighter does not materialise mid-swing.',
    enforcedBy: 'Character.setPosition → cancelAttack',
  }),
  Object.freeze({
    rule: 'destroy-cancel',
    summary:
      'Fighter destruction cancels the in-flight attack and detaches the body; defensive idle fallback in getCurrentAnimation.',
    enforcedBy: 'Character.destroy + getCurrentAnimation isDestroyed guard',
  }),
  Object.freeze({
    rule: 'no-buffering',
    summary:
      'A second attack press while one is in flight is dropped — the animation key never jumps to a new move until the current one finishes.',
    enforcedBy: 'Character.tickAttack rising-edge dispatch gated by activeAttack === null',
  }),
  Object.freeze({
    rule: 'no-phase-rewind',
    summary:
      'Within any single attack the phase progression is strictly forward (startup → active → recovery → done); the art-frame index is monotonically non-decreasing.',
    enforcedBy: 'computeAttackPhase + selectAnimationFrame purity (framesElapsed only ticks up)',
  }),
]);

// ---------------------------------------------------------------------------
// Re-exports — single import path for AC 10003 Sub-AC 3 consumers
// ---------------------------------------------------------------------------

export { getMovePartId };
