/**
 * Moveset animation cue catalog — AC 20004 Sub-AC 4.
 *
 * One single-source-of-truth integration table that pulls together the
 * three animation surfaces every fighter exposes — **idle**, **movement**,
 * and **per-move animation cues** — into one ergonomic API the renderer
 * (and the asset pipeline, debug HUD, replay scrubber, AI predictor)
 * can read against without re-deriving the cue strings each frame.
 *
 * # Why this module exists
 *
 * Across the codebase the per-character animation cues already exist,
 * but they live in three distinct places, each modelling a different
 * slice of the cue surface:
 *
 *   1. `animationState.ts`            — single-attack key contract:
 *                                       `{characterId}.{movePartId}.
 *                                        {phase}.{artFrameIndex}` plus
 *                                       `getIdleAnimationKey()`.
 *   2. `movesetAnimationDriver.ts`    — full 10-slot moveset: every
 *                                       move's lifecycle, frame-by-frame.
 *   3. `spriteAnimationDriver.ts`     — high-level *sprite* anim states:
 *                                       `idle`/`run`/`jump`/`fall`/
 *                                       `attack`/`hurt` → Phaser anim key
 *                                       (`{characterId}.{sheet}.anim`).
 *
 * Sub-AC 4 of AC 20004 calls out the contract: *"Author and integrate
 * sprite animations and animation-state mappings for **all 4 characters'
 * movesets** (idle, movement, and **each move's animation cues**)"*.
 *
 * That is — for **every** fighter (wolf, cat, owl, bear) and **every**
 * moveset slot (10 moves × 4 characters = 40 entries), the renderer
 * needs:
 *
 *   • the **idle key** to fall back on,
 *   • the **movement keys** (run, jump, fall) for the movement state
 *     machine,
 *   • the **lifecycle cue list** for every authored move (the ordered
 *     animation keys + matching art-frame index per gameplay frame).
 *
 * Splitting that across three modules works for testing the pieces in
 * isolation but pushes integration cost onto every consumer (pick the
 * right helper, plumb the right state, compose). This module
 * **integrates** the three surfaces under one frozen catalog so the
 * single call site is:
 *
 *     const cues = getCharacterMovesetAnimationCues('owl');
 *     const idleKey  = cues.idleKey;
 *     const runKey   = cues.movementKeys.run;
 *     const fairCue  = cues.moves.fair.lifecycleKeys;
 *     // …
 *
 * # Determinism
 *
 * Every cue in the catalog is computed once at module load from frozen
 * move data via the existing pure helpers (`enumerateMoveAnimationKeys`,
 * `selectAnimationFrame`, `getSpriteAnimationKey`). No runtime mutation,
 * no `Math.random()`, no wall-clock reads. The same import always
 * returns identical bytes — the property the replay scrubber needs.
 *
 * # No new keys, no contract drift
 *
 * This module emits **only keys that already exist** in the symbolic /
 * sprite contracts:
 *
 *   • Symbolic moveset keys come from `enumerateMoveAnimationKeys` —
 *     identical to what `MOVESET_ENTRIES` produces.
 *   • Idle / movement / sprite-attack keys come from
 *     `getSpriteAnimationKey` — identical to what
 *     `registerCharacterSpriteAnimations` registers on the Phaser
 *     `anims` manager.
 *
 * So a future renaming pass that touches the underlying registry
 * (e.g. `'wolf.idle'` → `'wolf.idle.v2'`) ripples through this catalog
 * automatically; this module never duplicates a literal.
 *
 * # Sprite-key fallback for un-art'd characters
 *
 * Owl and Bear have no sprite source-sheets shipped in the M1 / M2 cut
 * (their `placeholder.spriteKey` is `null`; per the asset constraint
 * the "procedural fallback" path renders them via flat-colour rect +
 * tinted shapes). For those characters `movementKeys.*` and
 * `attackSpriteKey` are `null`, mirroring `getSpriteAnimationKey`'s
 * own null-fallback semantics. Symbolic keys (`idleKey`, per-move
 * lifecycle keys) are still emitted for every character — the symbolic
 * contract is art-pipeline-independent and the AI predictor / replay
 * scrubber consume those even when no source sheet exists.
 */

import type { CharacterId } from '../types';
import type { AttackMoveWithAnimation } from './moveSchema';
import {
  enumerateMoveAnimationKeys,
  getAnimationKey,
  getIdleAnimationKey,
  getMovePartId,
} from './animationState';
import {
  computeAttackPhase,
  getMoveBusyFrames,
  selectAnimationFrame,
  type LiveAttackPhase,
} from './moveSchema';
import {
  MOVESET_SLOTS,
  MOVESET_TABLE,
  type CharacterMoveset,
  type MovesetSlot,
} from './movesetAnimationDriver';
import {
  getSpriteAnimationKey,
  type SpriteAnimationState,
} from './spriteAnimationDriver';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One per-frame animation cue inside a move's lifecycle. Carries both
 * the symbolic animation key (the renderer's `setTexture` target) and
 * the matching `(phase, artFrameIndex)` decomposition so a debug HUD
 * or a replay scrubber can reason about the cue without re-parsing the
 * key string.
 *
 * Every cue is the result of a single `selectAnimationFrame()` call
 * over `(framesElapsed, move)` — i.e. every cue corresponds to exactly
 * one *gameplay frame* of the move's busy window. The lifecycle cue
 * list therefore has length `getMoveBusyFrames(move)` (always equal to
 * `startupFrames + activeFrames + recoveryFrames`).
 */
export interface MoveAnimationCue {
  /** Gameplay frame index inside the move's busy window (0-based). */
  readonly framesElapsed: number;
  /** Live attack phase for this gameplay frame. */
  readonly phase: LiveAttackPhase;
  /** 0-based art-frame index inside the phase. */
  readonly artFrameIndex: number;
  /** Canonical symbolic animation key — `{character}.{move}.{phase}.{idx}`. */
  readonly key: string;
}

/**
 * Per-move animation cue bundle — everything the renderer needs to
 * paint a single move's full lifecycle without re-running the schema's
 * pure helpers each frame.
 */
export interface MoveAnimationCueBundle {
  /** Owning moveset slot (`'jab'` … `'downSpecial'`). */
  readonly slot: MovesetSlot;
  /** Owning character. */
  readonly characterId: CharacterId;
  /** Stable move id (`'wolf.jab'`, `'cat.fair'`, …). */
  readonly moveId: string;
  /** Short part id used in animation keys (`'jab'`, `'fair'`, …). */
  readonly movePartId: string;
  /**
   * Authored phase frame counts — the gameplay state machine's startup /
   * active / recovery durations. Echoed here so consumers can read the
   * phase budget without reaching into `MOVESET_TABLE[id][slot]`.
   */
  readonly phaseFrames: {
    readonly startup: number;
    readonly active: number;
    readonly recovery: number;
  };
  /**
   * Authored art-frame counts per phase — the renderer's per-phase art
   * budget (always ≥ 1, even when the move declares no `animation`
   * block: that case yields 1 art frame per phase).
   */
  readonly artFrames: {
    readonly startup: number;
    readonly active: number;
    readonly recovery: number;
  };
  /**
   * Total number of unique art-frame keys across the move's lifecycle.
   * Equal to `artFrames.startup + artFrames.active + artFrames.recovery`.
   * Useful for asset-pipeline budgeting.
   */
  readonly artFrameTotal: number;
  /**
   * Ordered list of *unique* art-frame keys across the lifecycle —
   * exactly one entry per `(phase, artFrameIndex)` pair. The asset
   * pipeline can iterate this to register the textures a move needs.
   *
   * Identical to `enumerateMoveAnimationKeys(characterId, move)`.
   */
  readonly artFrameKeys: ReadonlyArray<string>;
  /**
   * Per-gameplay-frame cue list — length `getMoveBusyFrames(move)`.
   * `lifecycleCues[i]` is the cue the renderer should display on
   * gameplay frame `i` (where 0 is the press frame itself).
   *
   * Multiple consecutive entries can share the same `key` (the same
   * art frame held across two gameplay frames when the gameplay phase
   * is longer than the art-frame count).
   */
  readonly lifecycleCues: ReadonlyArray<MoveAnimationCue>;
  /**
   * Convenience accessor — pull just the keys out of `lifecycleCues`
   * in display order. Equal-length to `lifecycleCues`. Saves the
   * caller a `.map(c => c.key)` allocation when they only need the
   * key sequence.
   */
  readonly lifecycleKeys: ReadonlyArray<string>;
  /**
   * The `{characterId}.attack.anim` Phaser anim key for the high-level
   * sprite state machine to play during the move, or `null` for
   * characters without a loaded source sheet (Owl, Bear in M1 / M2).
   * Identical to `getSpriteAnimationKey(characterId, 'attack')`.
   */
  readonly attackSpriteKey: string | null;
}

/**
 * Movement-state Phaser anim keys — the runtime sprite anim machine
 * (`createSpriteAnimationStateMachine`) plays one of these during the
 * matching high-level state. `null` when the character has no loaded
 * source sheet for that state.
 *
 * Mirrors `SpriteAnimationState` from `spriteAnimationDriver.ts` minus
 * `attack` (covered by every `MoveAnimationCueBundle.attackSpriteKey`)
 * and minus `hurt` (covered by `hurtSpriteKey` on the bundle below —
 * collapses onto idle in the M1 art delivery).
 */
export interface MovementAnimationKeys {
  /** Idle pose — the `{characterId}.idle.anim` key, or `null`. */
  readonly idle: string | null;
  /** Run cycle — `{characterId}.run.anim`, or `null`. */
  readonly run: string | null;
  /** Jump (rising). Reuses the `jump` sheet, or `null`. */
  readonly jump: string | null;
  /**
   * Fall (descending). Collapses onto the `jump` sheet in the M1 art
   * delivery (`getSpriteAnimationKey('cat', 'fall')` → `'cat.jump.anim'`).
   * Stored explicitly so a future fall sheet can land without renaming
   * call sites.
   */
  readonly fall: string | null;
  /**
   * Hurt (hitstun) pose. Collapses onto the `idle` sheet in the M1
   * art delivery — see `spriteAnimationDriver.collapseStateToSheet`.
   */
  readonly hurt: string | null;
}

/**
 * Top-level animation cue bundle for a single character — the integrated
 * view of every cue the renderer needs across idle / movement / moveset.
 */
export interface CharacterMovesetAnimationCues {
  readonly characterId: CharacterId;
  /** Symbolic idle key — `{characterId}.idle`. Always defined. */
  readonly idleKey: string;
  /**
   * Phaser anim keys for the high-level sprite movement state machine.
   * Populated for characters with loaded source sheets (Cat, Wolf in
   * M1) and `null`-filled for characters that fall back to procedural
   * rendering (Owl, Bear).
   */
  readonly movementKeys: MovementAnimationKeys;
  /**
   * Per-slot move animation cue bundles — one entry per slot in
   * `MOVESET_SLOTS` order. `moves.jab`, `moves.tilt`, …, `moves.downSpecial`.
   */
  readonly moves: Readonly<Record<MovesetSlot, MoveAnimationCueBundle>>;
}

// ---------------------------------------------------------------------------
// Catalog construction — pure functions over frozen move data
// ---------------------------------------------------------------------------

/**
 * Build the per-frame lifecycle cue list for a single move. Pure:
 * walks `framesElapsed = 0 … getMoveBusyFrames(move) - 1` and emits
 * one cue per gameplay frame using the schema's `selectAnimationFrame`
 * helper. Identical decomposition to what `Character.tickAttack`
 * resolves at runtime, so the cue list and the runtime art frame can
 * never disagree.
 */
function buildLifecycleCues(
  characterId: CharacterId,
  move: AttackMoveWithAnimation,
): ReadonlyArray<MoveAnimationCue> {
  const total = getMoveBusyFrames(move);
  const out: MoveAnimationCue[] = [];
  for (let f = 0; f < total; f++) {
    const sel = selectAnimationFrame(f, move);
    const phase = computeAttackPhase(f, move);
    // `phase === 'done'` only triggers when f >= total — guarded by the
    // for-loop bound — but narrow the type defensively here.
    if (phase === 'done') continue;
    out.push(
      Object.freeze<MoveAnimationCue>({
        framesElapsed: f,
        phase: phase as LiveAttackPhase,
        artFrameIndex: sel.artFrameIndex,
        key: getAnimationKey(characterId, move.id, phase as LiveAttackPhase, sel.artFrameIndex),
      }),
    );
  }
  return Object.freeze(out);
}

/**
 * Build the {@link MoveAnimationCueBundle} for a single (character, slot)
 * pair. Pure / deterministic. The result is frozen so consumers can hold
 * a reference long-term without defensive cloning.
 */
function buildMoveCueBundle(
  characterId: CharacterId,
  slot: MovesetSlot,
  move: AttackMoveWithAnimation,
): MoveAnimationCueBundle {
  const lifecycleCues = buildLifecycleCues(characterId, move);
  const lifecycleKeys = Object.freeze(lifecycleCues.map((c) => c.key));
  const artFrameKeys = enumerateMoveAnimationKeys(characterId, move);
  const startupArt = move.animation?.startupFrames ?? 1;
  const activeArt = move.animation?.activeFrames ?? 1;
  const recoveryArt = move.animation?.recoveryFrames ?? 1;
  return Object.freeze<MoveAnimationCueBundle>({
    slot,
    characterId,
    moveId: move.id,
    movePartId: getMovePartId(move.id),
    phaseFrames: Object.freeze({
      startup: move.startupFrames,
      active: move.activeFrames,
      recovery: move.recoveryFrames,
    }),
    artFrames: Object.freeze({
      startup: startupArt,
      active: activeArt,
      recovery: recoveryArt,
    }),
    artFrameTotal: startupArt + activeArt + recoveryArt,
    artFrameKeys,
    lifecycleCues,
    lifecycleKeys,
    attackSpriteKey: getSpriteAnimationKey(characterId, 'attack'),
  });
}

/**
 * Build the {@link MovementAnimationKeys} bundle for a character. Pure
 * mapping over `getSpriteAnimationKey` so a character without a loaded
 * source sheet (Owl, Bear) yields a fully-`null` bundle the renderer
 * can branch on cleanly.
 */
function buildMovementKeys(characterId: CharacterId): MovementAnimationKeys {
  const states: ReadonlyArray<SpriteAnimationState> = ['idle', 'run', 'jump', 'fall', 'hurt'];
  // Spread into an explicit object so the per-field types are precise
  // and the runtime shape matches the public `MovementAnimationKeys`.
  const map = new Map<SpriteAnimationState, string | null>();
  for (const s of states) {
    map.set(s, getSpriteAnimationKey(characterId, s));
  }
  return Object.freeze<MovementAnimationKeys>({
    idle: map.get('idle') ?? null,
    run: map.get('run') ?? null,
    jump: map.get('jump') ?? null,
    fall: map.get('fall') ?? null,
    hurt: map.get('hurt') ?? null,
  });
}

/**
 * Build the per-character cue bundle. Walks `MOVESET_SLOTS` in canonical
 * order so iteration over the resulting `moves` record is deterministic.
 */
function buildCharacterCues(
  characterId: CharacterId,
  moveset: CharacterMoveset,
): CharacterMovesetAnimationCues {
  const moves = {} as Record<MovesetSlot, MoveAnimationCueBundle>;
  for (const slot of MOVESET_SLOTS) {
    moves[slot] = buildMoveCueBundle(characterId, slot, moveset[slot]);
  }
  return Object.freeze<CharacterMovesetAnimationCues>({
    characterId,
    idleKey: getIdleAnimationKey(characterId),
    movementKeys: buildMovementKeys(characterId),
    moves: Object.freeze(moves),
  });
}

// ---------------------------------------------------------------------------
// Public catalog
// ---------------------------------------------------------------------------

/**
 * The full integrated cue catalog — one entry per roster character,
 * each carrying idle / movement / per-move cue bundles. Frozen at
 * module load; consumers can hold a long-lived reference without
 * defensive cloning.
 *
 * Iteration order matches `MOVESET_TABLE` (and `MOVESET_ENTRIES`):
 * `wolf → cat → owl → bear → blaze → puff → aegis`.
 */
export const CHARACTER_MOVESET_ANIMATION_CUES: Readonly<
  Record<CharacterId, CharacterMovesetAnimationCues>
> = Object.freeze({
  wolf: buildCharacterCues('wolf', MOVESET_TABLE.wolf),
  cat: buildCharacterCues('cat', MOVESET_TABLE.cat),
  owl: buildCharacterCues('owl', MOVESET_TABLE.owl),
  bear: buildCharacterCues('bear', MOVESET_TABLE.bear),
  blaze: buildCharacterCues('blaze', MOVESET_TABLE.blaze),
  puff: buildCharacterCues('puff', MOVESET_TABLE.puff),
  aegis: buildCharacterCues('aegis', MOVESET_TABLE.aegis),
  volt: buildCharacterCues('volt', MOVESET_TABLE.volt),
  nova: buildCharacterCues('nova', MOVESET_TABLE.nova),
  bruno: buildCharacterCues('bruno', MOVESET_TABLE.bruno),
});

/**
 * Look up the integrated cue bundle for a single character. Pure /
 * deterministic. Returns the same frozen reference every time.
 */
export function getCharacterMovesetAnimationCues(
  characterId: CharacterId,
): CharacterMovesetAnimationCues {
  return CHARACTER_MOVESET_ANIMATION_CUES[characterId];
}

/**
 * Look up a single (character, slot) move cue bundle. Pure /
 * deterministic. Same frozen reference every call.
 */
export function getMoveAnimationCueBundle(
  characterId: CharacterId,
  slot: MovesetSlot,
): MoveAnimationCueBundle {
  return CHARACTER_MOVESET_ANIMATION_CUES[characterId].moves[slot];
}

/**
 * Look up the cue the renderer should display at a specific gameplay
 * frame inside a move's busy window. Returns `null` for any frame
 * past `getMoveBusyFrames(move) - 1` — i.e. once the move is done and
 * the renderer should be painting the idle key.
 */
export function getMoveAnimationCueAt(
  characterId: CharacterId,
  slot: MovesetSlot,
  framesElapsed: number,
): MoveAnimationCue | null {
  const bundle = CHARACTER_MOVESET_ANIMATION_CUES[characterId].moves[slot];
  if (framesElapsed < 0) return null;
  if (framesElapsed >= bundle.lifecycleCues.length) return null;
  return bundle.lifecycleCues[framesElapsed] ?? null;
}

/**
 * Flat list of every move cue bundle across the roster — 70 entries
 * (7 characters × 10 slots), in `(character, slot)` iteration order.
 * Useful for tests, the asset pipeline, and balance tooling that wants
 * to walk every authored move once without nested loops.
 */
export const MOVESET_ANIMATION_CUE_BUNDLES: ReadonlyArray<MoveAnimationCueBundle> =
  Object.freeze(
    (['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno'] as const).flatMap((id) =>
      MOVESET_SLOTS.map((slot) => CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot]),
    ),
  );

/**
 * Enumerate every animation key the integrated catalog references —
 * idle keys + per-move lifecycle keys (deduplicated) + movement Phaser
 * anim keys (when present). The asset pipeline iterates this to know
 * exactly which textures + animations to register without poking into
 * each per-character bundle.
 *
 * Returns a frozen array; `null` movement keys (Owl/Bear) are skipped
 * automatically.
 */
export function enumerateAllMovesetAnimationCueKeys(): ReadonlyArray<string> {
  const out: string[] = [];
  for (const id of ['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno'] as const) {
    const cues = CHARACTER_MOVESET_ANIMATION_CUES[id];
    out.push(cues.idleKey);
    for (const k of [
      cues.movementKeys.idle,
      cues.movementKeys.run,
      cues.movementKeys.jump,
      cues.movementKeys.fall,
      cues.movementKeys.hurt,
    ]) {
      if (k !== null) out.push(k);
    }
    for (const slot of MOVESET_SLOTS) {
      const bundle = cues.moves[slot];
      for (const key of bundle.artFrameKeys) {
        out.push(key);
      }
      if (bundle.attackSpriteKey !== null) {
        out.push(bundle.attackSpriteKey);
      }
    }
  }
  return Object.freeze(out);
}
