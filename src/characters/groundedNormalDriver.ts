/**
 * Grounded-normal animation + hitbox driver — AC 60102 Sub-AC 2.
 *
 * This module is the consolidated, character-aware driver that ties
 * together everything the renderer / AI / replay layers need to drive a
 * fighter's grounded normal moves (jab / tilt / smash):
 *
 *   1. **Move-table catalog** — for every roster slot, the canonical
 *      `(jab | tilt | smash)` triplet from the per-character move tables
 *      (Wolf / Cat / Owl / Bear). Lifted into a single
 *      `GROUNDED_NORMAL_MOVES` table so consumers (this module's tests,
 *      AI scripts, the (later AC) sprite atlas pipeline, the move-editor
 *      tool, balance pass) read one source of truth instead of importing
 *      twelve named constants by hand.
 *
 *   2. **Frame-accurate hitbox lifecycle** — pure helpers that compute,
 *      for any (move-table entry × press-frame counter) pair, exactly
 *      which gameplay frame the hitbox spawns on, which frames it stays
 *      live for, and where its sensor sits in world-space (centre,
 *      width, height). The runtime in `Character.tickAttack` already
 *      enforces this lifecycle; the helpers here let consumers
 *      *predict* and *verify* it without spinning up a Matter scene.
 *
 *   3. **Animation drive** — pure resolution of the
 *      `(characterId × move × framesElapsed) → animationKey` mapping
 *      across the full lifecycle of a grounded normal. The renderer's
 *      `getCurrentAnimation()` already produces these keys frame-by-
 *      frame off the live `Character` instance; this module exposes
 *      the same projection over plain data so:
 *
 *        • Tests can lock down "every grounded normal in the cast emits
 *          its full key sequence in display order" without instantiating
 *          four classes.
 *        • The AI predictor can ask "what art frame will Cat be on 3
 *          frames after pressing jab?" without committing the press to
 *          the live character.
 *        • Replay-snapshot resync can re-derive the displayed art frame
 *          for a logged `(characterId, moveId, framesElapsed)` triple
 *          and assert it matches the playback.
 *
 *   4. **Cancel-rule alignment** — the same five cancel rules already
 *      enumerated in `animationState.ts` (`hit-cancel`, `respawn-
 *      cancel`, `destroy-cancel`, `no-buffering`, `no-phase-rewind`)
 *      apply to grounded normals. This module re-exports the
 *      enumeration with a focused JSDoc that points at where each rule
 *      is enforced for grounded-normal lifecycles specifically (see
 *      {@link GROUNDED_NORMAL_LIFECYCLE_RULES}).
 *
 * # Why a separate module
 *
 * The grounded-normal flow already works end-to-end through the existing
 * primitives:
 *
 *   • `Character.tickAttack` spawns the Matter sensor on the
 *     startup→active boundary, despawns on the active→recovery boundary,
 *     and clears the active-attack record on the recovery→done boundary.
 *   • `selectAnimationFrame()` (in `moveSchema.ts`) picks the displayed
 *     art-frame index for any given `(framesElapsed, move)` pair.
 *   • `getCurrentAnimation()` (in `animationState.ts`) emits the
 *     canonical `{characterId}.{move}.{phase}.{frameIndex}` key.
 *   • `spawnHitbox()` (in `attacks.ts`) places the sensor at the
 *     attacker's current centre + the move's authored offset, mirrored
 *     by facing.
 *
 * What was missing before this AC was a single explicit *contract* that
 * pulls those four threads together for the specific subset of moves
 * the Seed's "moveset.jab/tilt/smash" concept calls out, *and* a typed
 * data table that consumers can iterate to verify the contract holds
 * across every roster slot. AC 60102 Sub-AC 2 names that contract
 * "animation and hitbox spawning for grounded normals — drive sprite
 * animation states and spawn frame-accurate hitboxes (position, size,
 * active frames) per move-table entry"; this module *is* that contract.
 *
 * # Determinism
 *
 * Every helper in this module is a pure function of frozen move data
 * and integer frame counters. No `Math.random()`, no `Date.now()`, no
 * scene side effects, no allocation that depends on environment. Two
 * replays driving identical inputs against fighters constructed with
 * identical tuning produce byte-identical results out of every helper.
 *
 * # Backwards compatibility
 *
 * This module is purely additive. The existing runtime (`Character`,
 * `attacks`, `animationState`, `moveSchema`) is unchanged in semantics.
 * New consumers (tests, AI predictors, the future move-editor tool)
 * import from this module; existing code keeps working.
 */

import type { CharacterId } from '../types';
import {
  type AttackMove,
  type HitboxPlugin,
  HITBOX_LABEL,
  HITBOX_COLLISION_FILTER,
  computeHitboxCenter as computeHitboxCenterRaw,
} from './attacks';
import {
  type AttackMoveWithAnimation,
  type AttackPhase,
  type LiveAttackPhase,
  computeAttackPhase,
  selectAnimationFrame,
  getMoveBusyFrames,
} from './moveSchema';
import {
  type AnimationCancelRule,
  type AnimationState,
  IDLE_ANIMATION_SUFFIX,
  getAnimationKey,
  getIdleAnimationKey,
  getMovePartId,
  resolveAttackAnimation,
} from './animationState';
import { WOLF_JAB, WOLF_TILT, WOLF_SMASH } from './Wolf';
import { CAT_JAB, CAT_TILT, CAT_SMASH } from './Cat';
import { OWL_JAB, OWL_TILT, OWL_SMASH } from './Owl';
import { BEAR_JAB, BEAR_TILT, BEAR_SMASH } from './Bear';
import { BLAZE_JAB, BLAZE_TILT, BLAZE_SMASH } from './Blaze';
import { PUFF_JAB, PUFF_TILT, PUFF_SMASH } from './Puff';
import { AEGIS_JAB, AEGIS_TILT, AEGIS_SMASH } from './Aegis';
import { VOLT_JAB, VOLT_TILT, VOLT_SMASH } from './Volt';
import { NOVA_JAB, NOVA_TILT, NOVA_SMASH } from './Nova';
import { BRUNO_JAB, BRUNO_TILT, BRUNO_SMASH } from './Bruno';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The three grounded-normal slot names the Seed's `moveset` ontology
 * concept calls out: jab (neutral attack), tilt (directional tap),
 * smash (heavy / charged finisher). Stable string-literal union so
 * tests / AI logs / debug HUDs can carry the slot id directly without
 * a numeric enum mapping.
 *
 * Note: distinct from {@link AttackMove.type}, which is the broader
 * `MoveType` union (`'jab' | 'tilt' | 'smash' | 'aerial' | 'special' | …`).
 * `GroundedNormalSlot` is intentionally narrower — only the three slots
 * a fighter's grounded triplet ships in.
 */
export type GroundedNormalSlot = 'jab' | 'tilt' | 'smash';

/**
 * Ordered list of the three grounded-normal slot names in the canonical
 * dispatch order: neutral press → directional tap → heavy press. Tests
 * and roster-comparison tools iterate this to enumerate slots without
 * hard-coding a literal array each time.
 */
export const GROUNDED_NORMAL_SLOTS: ReadonlyArray<GroundedNormalSlot> = Object.freeze([
  'jab',
  'tilt',
  'smash',
]);

/**
 * One grounded-normal entry — a `(characterId, slot, move)` triple
 * pulled from the per-character move tables. Carries the move record
 * directly so consumers don't have to re-import the per-character
 * constants by hand.
 *
 * The `move` field is typed as {@link AttackMoveWithAnimation} (the
 * superset of `AttackMove` that adds the optional `animation` block) so
 * consumers reading `move.animation` get the full per-phase art-frame
 * counts without an unsafe cast. Every grounded-normal entry in this
 * module's table ships with an `animation` block — the per-character
 * constants ensure that — but the type stays lenient because the
 * underlying schema's `animation` field is documented as optional, and
 * locking it down here would force a parallel "must have animation"
 * type for no semantic benefit.
 */
export interface GroundedNormalEntry {
  readonly characterId: CharacterId;
  readonly slot: GroundedNormalSlot;
  readonly move: AttackMoveWithAnimation;
}

/**
 * Per-frame snapshot of the hitbox for a grounded normal. Returned by
 * {@link describeHitboxAtFrame}.
 *
 * Carries everything the runtime stamps onto a live Matter sensor body,
 * computed *purely* from the move-table entry + the attacker's
 * (positionX, positionY, facing) at the press frame. Lets tests and
 * AI predictors verify "the runtime spawned the right sensor" without
 * reaching into Matter.
 *
 * `live` is `false` for any frame whose phase is not `'active'` (the
 * phases the runtime spawns no sensor for); `centerX`/`centerY`/`width`/
 * `height` carry projection values regardless so AI logs can record
 * "where the hitbox would sit if it were live" for non-active frames.
 */
export interface GroundedNormalHitboxSnapshot {
  /** True iff the phase at `framesElapsed` is `'active'`. */
  readonly live: boolean;
  /** Phase the move is in at `framesElapsed`. */
  readonly phase: AttackPhase;
  /** World-space centre X of the projected sensor (mirrors offset by facing). */
  readonly centerX: number;
  /** World-space centre Y of the projected sensor. */
  readonly centerY: number;
  /** Sensor width in design pixels — copied from the move-table entry. */
  readonly width: number;
  /** Sensor height in design pixels — copied from the move-table entry. */
  readonly height: number;
  /** Move-id from the underlying `AttackMove` (e.g. `'wolf.jab'`). */
  readonly moveId: string;
  /** Damage value carried into the sensor's plugin payload on spawn. */
  readonly damage: number;
}

/**
 * Frame-precise hitbox lifecycle for one grounded normal. Returned by
 * {@link describeHitboxLifecycle}.
 *
 * Carries the three integer frame counters the runtime uses to gate the
 * sensor's existence:
 *
 *   • `firstActiveFrame`  — `move.startupFrames` (the *first* frame the
 *                           sensor is in the world).
 *   • `lastActiveFrame`   — `move.startupFrames + move.activeFrames - 1`
 *                           (inclusive — the *last* frame the sensor is
 *                           in the world).
 *   • `firstRecoveryFrame`— `move.startupFrames + move.activeFrames`
 *                           (the frame after `lastActiveFrame` — the
 *                           runtime despawns the sensor on the boundary
 *                           between this frame and the previous).
 *   • `endFrame`          — `move.startupFrames + move.activeFrames +
 *                           move.recoveryFrames` (the first frame the
 *                           move's `phaseFor` returns `'done'` —
 *                           `Character.tickAttack` clears the active
 *                           attack record on this frame).
 *
 * Identical to the boundaries `computeAttackPhase` honours; pulling them
 * into a typed record means a balance-pass tool can sort moves by
 * "first-active frame" without re-implementing the math.
 */
export interface GroundedNormalHitboxLifecycle {
  readonly firstActiveFrame: number;
  readonly lastActiveFrame: number;
  readonly firstRecoveryFrame: number;
  readonly endFrame: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Move-table catalog — the canonical (characterId × slot) → move lookup
// ---------------------------------------------------------------------------

/**
 * Per-character grounded-normal triplet pulled from the existing
 * per-character move-table constants. Frozen at module load so
 * consumers never have to defensive-clone.
 *
 * Iteration order is the canonical dispatch order:
 *
 *   wolf.jab → wolf.tilt → wolf.smash
 *   cat.jab  → cat.tilt  → cat.smash
 *   owl.jab  → owl.tilt  → owl.smash
 *   bear.jab → bear.tilt → bear.smash
 *
 * Tests iterate this directly to assert the contract holds across the
 * whole roster. AI scripts that need "every grounded-normal Wolf can
 * throw" iterate `GROUNDED_NORMAL_TABLE.wolf`. The (later AC) move-
 * editor tool reads the same table to populate its character/slot
 * picker.
 */
export const GROUNDED_NORMAL_TABLE: Readonly<
  Record<CharacterId, Readonly<Record<GroundedNormalSlot, AttackMoveWithAnimation>>>
> = Object.freeze({
  wolf: Object.freeze({ jab: WOLF_JAB, tilt: WOLF_TILT, smash: WOLF_SMASH }),
  cat: Object.freeze({ jab: CAT_JAB, tilt: CAT_TILT, smash: CAT_SMASH }),
  owl: Object.freeze({ jab: OWL_JAB, tilt: OWL_TILT, smash: OWL_SMASH }),
  bear: Object.freeze({ jab: BEAR_JAB, tilt: BEAR_TILT, smash: BEAR_SMASH }),
  blaze: Object.freeze({ jab: BLAZE_JAB, tilt: BLAZE_TILT, smash: BLAZE_SMASH }),
  puff: Object.freeze({ jab: PUFF_JAB, tilt: PUFF_TILT, smash: PUFF_SMASH }),
  aegis: Object.freeze({ jab: AEGIS_JAB, tilt: AEGIS_TILT, smash: AEGIS_SMASH }),
  volt: Object.freeze({ jab: VOLT_JAB, tilt: VOLT_TILT, smash: VOLT_SMASH }),
  nova: Object.freeze({ jab: NOVA_JAB, tilt: NOVA_TILT, smash: NOVA_SMASH }),
  bruno: Object.freeze({ jab: BRUNO_JAB, tilt: BRUNO_TILT, smash: BRUNO_SMASH }),
});

/**
 * Flat array of every grounded-normal entry across the roster — 21
 * entries (7 characters × 3 slots). Convenience for tests / debug HUDs
 * that want a single iterable rather than nested-object traversal.
 *
 * Iteration order: roster-order on the outer axis (wolf → cat → owl →
 * bear → blaze → puff → aegis), slot-order on the inner
 * ({@link GROUNDED_NORMAL_SLOTS}). Pure data — frozen at module load.
 */
export const GROUNDED_NORMAL_MOVES: ReadonlyArray<GroundedNormalEntry> = Object.freeze(
  (['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno'] as const).flatMap((characterId) =>
    GROUNDED_NORMAL_SLOTS.map((slot) =>
      Object.freeze({
        characterId,
        slot,
        move: GROUNDED_NORMAL_TABLE[characterId][slot],
      }),
    ),
  ),
);

/**
 * Look up a single grounded normal from the catalog by
 * `(characterId, slot)`. Returns the move definition directly — every
 * roster slot ships its triplet so this never returns `undefined`.
 *
 * Pure / deterministic. Useful for AI scripts that resolve "Wolf's
 * tilt" by data instead of by symbol import.
 */
export function getGroundedNormal(
  characterId: CharacterId,
  slot: GroundedNormalSlot,
): AttackMoveWithAnimation {
  return GROUNDED_NORMAL_TABLE[characterId][slot];
}

// ---------------------------------------------------------------------------
// Frame-accurate hitbox lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Describe a grounded normal's hitbox lifecycle as a frozen record of
 * integer frame counters. Pure projection of the move's
 * (startup, active, recovery) — no scene state required.
 *
 *   describeHitboxLifecycle(WOLF_JAB) →
 *     { firstActiveFrame: 4,
 *       lastActiveFrame: 6,
 *       firstRecoveryFrame: 7,
 *       endFrame: 16,
 *       width: 70, height: 52 }
 *
 * Why exposed: the runtime in `Character.tickAttack` enforces this
 * lifecycle, but tests + AI predictors that want to *verify* "does the
 * sensor really go live on frame 4?" otherwise had to crack open
 * `computeAttackPhase` and re-implement the boundary math. This helper
 * names the boundaries explicitly so any future regression in the
 * runtime surfaces as a one-line assertion failure ("expected first-
 * active frame 4, got 5") instead of a phase-count drift somewhere
 * deep in the integration stack.
 */
export function describeHitboxLifecycle(
  move: AttackMove,
): GroundedNormalHitboxLifecycle {
  const firstActiveFrame = move.startupFrames;
  const lastActiveFrame = move.startupFrames + move.activeFrames - 1;
  const firstRecoveryFrame = move.startupFrames + move.activeFrames;
  const endFrame = getMoveBusyFrames(move);
  return {
    firstActiveFrame,
    lastActiveFrame,
    firstRecoveryFrame,
    endFrame,
    width: move.hitbox.width,
    height: move.hitbox.height,
  };
}

/**
 * True iff the move's `framesElapsed` puts the hitbox in its `'active'`
 * window — i.e. the runtime should have a Matter sensor body in the
 * world this frame. Pure predicate.
 */
export function isHitboxActiveAt(move: AttackMove, framesElapsed: number): boolean {
  return computeAttackPhase(framesElapsed, move) === 'active';
}

/**
 * Compute the world-space centre of a grounded-normal hitbox at any
 * gameplay frame. Mirrors the projection {@link spawnHitbox} performs
 * on the live runtime — see {@link computeHitboxCenterRaw} for the
 * pure-arithmetic helper this delegates to.
 *
 * Returned regardless of phase (active or otherwise). Consumers that
 * care whether the sensor is in the world should branch on
 * {@link isHitboxActiveAt} or {@link describeHitboxAtFrame.live}.
 */
export function computeGroundedNormalHitboxCenter(
  move: AttackMove,
  attackerPosition: { readonly x: number; readonly y: number },
  facing: 1 | -1,
): { x: number; y: number } {
  return computeHitboxCenterRaw(attackerPosition, move, facing);
}

/**
 * One-shot snapshot of a grounded-normal hitbox at a given gameplay
 * frame. Pure — does not consult any live `Character`. Useful for AI
 * predictors, tests, and replay-snapshot reconstruction.
 *
 * Returns `live: true` only when the phase classifier reports
 * `'active'` for the supplied frame counter. The `centerX`/`centerY`/
 * `width`/`height` fields carry projection values for every frame so
 * AI logs can record the *would-be* sensor centre on non-active frames
 * (handy for "where will the hitbox land?" lookahead UI).
 */
export function describeHitboxAtFrame(
  move: AttackMove,
  attackerPosition: { readonly x: number; readonly y: number },
  facing: 1 | -1,
  framesElapsed: number,
): GroundedNormalHitboxSnapshot {
  const phase = computeAttackPhase(framesElapsed, move);
  const center = computeHitboxCenterRaw(attackerPosition, move, facing);
  return {
    live: phase === 'active',
    phase,
    centerX: center.x,
    centerY: center.y,
    width: move.hitbox.width,
    height: move.hitbox.height,
    moveId: move.id,
    damage: move.damage,
  };
}

/**
 * Build the {@link HitboxPlugin} payload that {@link spawnHitbox} stamps
 * onto the live Matter sensor body for a grounded normal. Pure —
 * exposed so tests and the (later AC) damage-handler simulation layer
 * can construct the same plugin shape the runtime emits, without going
 * through `spawnHitbox`'s Matter dependency.
 *
 *   • `ownerId`   — the attacker's character id (passed in; this module
 *                   does NOT default to the move's roster id because a
 *                   single move record can in principle drive a hitbox
 *                   for any owner — projectiles, summons, etc.).
 *   • `moveId`    — `move.id`.
 *   • `damage`    — `move.damage`.
 *   • `knockback` — `move.knockback` (full `(x, y, scaling)` triple).
 *   • `facing`    — passed-in attacker facing.
 */
export function buildGroundedNormalHitboxPlugin(
  ownerId: string,
  move: AttackMove,
  facing: 1 | -1,
): HitboxPlugin {
  return {
    ownerId,
    moveId: move.id,
    damage: move.damage,
    knockback: move.knockback,
    facing,
  };
}

// ---------------------------------------------------------------------------
// Animation drive — pure resolution of the lifecycle's animation keys
// ---------------------------------------------------------------------------

/**
 * Return the canonical animation key the renderer should display for a
 * grounded normal at any gameplay frame. Pure — does not consult any
 * live `Character`. Mirrors what `getCurrentAnimation()` produces off
 * the live runtime, so AI predictors / replay-snapshot reconstruction
 * can derive the displayed frame without spinning up a Phaser scene.
 *
 * Returns the idle key (`{characterId}.idle`) for any
 * `framesElapsed >= getMoveBusyFrames(move)` — the move has terminated
 * and the renderer falls back to idle.
 */
export function resolveGroundedNormalAnimationKey(
  characterId: CharacterId,
  move: AttackMoveWithAnimation,
  framesElapsed: number,
): string {
  const phase = computeAttackPhase(framesElapsed, move);
  if (phase === 'done') {
    return getIdleAnimationKey(characterId);
  }
  const sel = selectAnimationFrame(framesElapsed, move);
  return getAnimationKey(characterId, move.id, phase as LiveAttackPhase, sel.artFrameIndex);
}

/**
 * Return the fully-resolved {@link AnimationState} for a grounded
 * normal at any gameplay frame, with a caller-supplied facing locked
 * in. Convenience wrapper around `resolveAttackAnimation` so consumers
 * don't have to remember which schema vs character module the helper
 * lives in.
 */
export function resolveGroundedNormalAnimationState(
  characterId: CharacterId,
  move: AttackMoveWithAnimation,
  framesElapsed: number,
  facing: 1 | -1,
): AnimationState {
  return resolveAttackAnimation(characterId, move, framesElapsed, facing);
}

/**
 * Enumerate the ordered list of animation states a single grounded-
 * normal press will surface to the renderer over its lifecycle (frame
 * 0 through `endFrame - 1` inclusive, then a tailing idle key).
 *
 * Useful for:
 *
 *   • Sprite atlas registration — the (later) asset pipeline can iterate
 *     this list to know exactly which texture keys load for a move.
 *   • Tests — assert each character's grounded triplet emits the
 *     expected `{startup.0 → … → recovery.k → idle}` chain without
 *     stepping the gameplay state machine frame-by-frame.
 *   • Debug HUD — render a strip of art-frame previews for the move
 *     currently being executed, indexing directly into this array.
 *
 * `facing` is locked at the press frame the same way the runtime locks
 * `ActiveAttack.facing`, so each emitted state's `facing` mirrors the
 * caller's argument unchanged.
 */
export function enumerateGroundedNormalAnimationStates(
  characterId: CharacterId,
  move: AttackMoveWithAnimation,
  facing: 1 | -1 = 1,
): ReadonlyArray<AnimationState> {
  const out: AnimationState[] = [];
  const busy = getMoveBusyFrames(move);
  for (let f = 0; f < busy; f++) {
    out.push(resolveAttackAnimation(characterId, move, f, facing));
  }
  // Trailing idle frame — what the renderer flips to once the move ends.
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
// Cancel rules — alignment notes for grounded normals specifically
// ---------------------------------------------------------------------------

/**
 * Per-grounded-normal cancel-rule alignment table. Each entry names a
 * cancel rule from {@link AnimationCancelRule} and points at the
 * runtime call site that enforces the rule for grounded-normal
 * lifecycles specifically. Re-exposes the same five rules
 * `animationState.ts` enumerates, with a focused commentary.
 *
 * The rules apply uniformly to grounded normals AND aerials AND
 * specials — the same `Character.tickAttack` / `Character.applyHit` /
 * `Character.setPosition` / `Character.destroy` paths gate every
 * attack lifecycle. Listing them here gives the AC 60102 Sub-AC 2
 * verification suite a single source of truth to read against without
 * having to re-derive "yes, jab/tilt/smash all behave this way".
 */
export const GROUNDED_NORMAL_LIFECYCLE_RULES: ReadonlyArray<{
  readonly rule: AnimationCancelRule;
  readonly summary: string;
  readonly enforcedBy: string;
}> = Object.freeze([
  Object.freeze({
    rule: 'hit-cancel',
    summary:
      'A grounded-normal in flight is cancelled by an incoming hit; animation flips to idle on the next poll.',
    enforcedBy: 'Character.applyHit → cancelAttack',
  }),
  Object.freeze({
    rule: 'respawn-cancel',
    summary:
      'Respawn / replay-seek teleport cancels any in-flight grounded normal so the fighter does not materialise mid-swing.',
    enforcedBy: 'Character.setPosition → cancelAttack',
  }),
  Object.freeze({
    rule: 'destroy-cancel',
    summary:
      'Fighter destruction cancels the in-flight grounded normal and detaches the body; defensive idle fallback in getCurrentAnimation.',
    enforcedBy: 'Character.destroy + getCurrentAnimation isDestroyed guard',
  }),
  Object.freeze({
    rule: 'no-buffering',
    summary:
      'A second grounded-normal press while one is in flight is dropped — the animation key never jumps to a new move until the current one finishes.',
    enforcedBy: 'Character.tickAttack rising-edge dispatch gated by activeAttack === null',
  }),
  Object.freeze({
    rule: 'no-phase-rewind',
    summary:
      'Within a single grounded-normal the phase progression is strictly forward (startup → active → recovery → done); the art-frame index is monotonically non-decreasing.',
    enforcedBy: 'computeAttackPhase + selectAnimationFrame purity (framesElapsed only ticks up)',
  }),
]);

// ---------------------------------------------------------------------------
// Re-exports — single import path for AC 60102 Sub-AC 2 consumers
// ---------------------------------------------------------------------------

/**
 * Named re-exports of the labels and collision filter the runtime
 * stamps onto every grounded-normal hitbox sensor. Pulled into this
 * module so AC 60102 Sub-AC 2 verification tooling can validate the
 * spawned-sensor contract through one import path.
 */
export { HITBOX_LABEL, HITBOX_COLLISION_FILTER, IDLE_ANIMATION_SUFFIX, getMovePartId };
