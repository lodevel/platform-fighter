/**
 * Special move framework — AC 60101 Sub-AC 1.
 *
 * Central glue module that ties together the three special-move families
 * (neutral, side, up) into a single deterministic runtime contract:
 *
 *   1. **Direction detection** — pure classifier that maps a stick +
 *      "special" button rising-edge into one of the three directions
 *      (`'neutral' | 'side' | 'up'`), or `null` if the button wasn't
 *      pressed this frame. The Smash-canonical priority is "stick-up
 *      wins over stick-side" (so a player who holds up-forward + special
 *      gets up-special, not side-special).
 *
 *   2. **Per-direction cooldown tracking** — independent cooldown
 *      counters for each of the three directions so a player who just
 *      spent their up-special on a recovery still has neutral and side
 *      ready. Mirrors the canonical "each special has its own meter"
 *      shape AI tools and tests can read directly.
 *
 *   3. **Per-character special config schema** — `CharacterSpecialConfig`
 *      bundles a fighter's three specials into one record so the
 *      runtime, AI scripts, replay tooling, and the move-editor can ask
 *      a single resolver "what does this character do on side-special?"
 *      without iterating the moveset.
 *
 *   4. **Resolution helpers** — given a config + cooldown state + input
 *      snapshot, return the move that should fire (or `null` if the
 *      press is gated by cooldown / no direction). This is the single
 *      seam the input dispatcher and AI behaviour trees consume.
 *
 * Why a separate module (and not extending `moveSchema.ts` or the
 * existing `specialSchema.ts` / `upSpecialSchema.ts` / `sideSpecialSchema.ts`):
 *
 *   • The three schemas already exist as independent files, each
 *     describing one direction's discriminated union of mechanic kinds.
 *     Keeping the *cross-direction* concerns (input detection, cooldown,
 *     bundling) in their own module preserves the schema files as pure
 *     data contracts.
 *
 *   • This file is the canonical answer to "what does pressing special
 *     mean RIGHT NOW for this character?" — a single resolver that
 *     consumers can rely on regardless of which character is selected
 *     or which mechanic kinds the character ships.
 *
 *   • The framework is deliberately minimal: cooldown counters, an
 *     8-direction input detector, a config bundle, and resolvers. The
 *     per-mechanic runtime behaviour (counter parry windows, projectile
 *     spawn, dash velocity) lives on the per-direction schema modules.
 *     This module just *routes* the press to the right one.
 *
 * Determinism: every helper here is a pure function of integer frame
 * counters, frozen move data, and the input snapshot. No `Math.random()`,
 * no `Date.now()`, no Matter / Phaser side effects. Identical inputs
 * always produce identical outputs — the property the replay system
 * requires.
 *
 * Backwards compatibility: this module is purely additive. Existing
 * `Character.neutralSpecialId` / `Character.upSpecialId` slots and the
 * runtime attack state machine all keep working unchanged. New code
 * (the AI predictor, the dispatcher's special-button branch, the
 * move-editor) consume this module directly; existing code keeps
 * working.
 */

import type { AttackMove } from './attacks';
import { getMoveLockoutFrames } from './moveSchema';
import type { NeutralSpecialMove } from './specialSchema';
import type { SideSpecialMove } from './sideSpecialSchema';
import type { UpSpecialMove } from './upSpecialSchema';

// ---------------------------------------------------------------------------
// Direction discriminator
// ---------------------------------------------------------------------------

/**
 * Three flavours of special the framework routes between. Mirrors the
 * Smash-canonical "B / Side-B / Up-B" press distinction.
 *
 * Down-special is intentionally NOT modelled in v1 — the Seed's ~10-move
 * kit doesn't include one. The framework can be extended to add
 * `'down'` later (the schema files would gain a `DownSpecialMove`
 * union, the cooldown record gains a fourth slot, the detector adds a
 * stick-down branch). All four characters ship neutral + side + up,
 * matching the v1 scope.
 */
export type SpecialDirection = 'neutral' | 'side' | 'up';

/** All three directions, ordered for deterministic iteration. */
export const SPECIAL_DIRECTIONS: ReadonlyArray<SpecialDirection> = Object.freeze([
  'neutral',
  'side',
  'up',
]);

// ---------------------------------------------------------------------------
// Stick threshold constants
// ---------------------------------------------------------------------------

/**
 * Stick-deflection threshold used by the special-direction classifier.
 * Mirrors `AERIAL_STICK_THRESHOLD = 0.3` from `Character.ts` — the same
 * "is the player intentionally holding a direction" deadzone applies to
 * all directional press classifications across the engine. A separate
 * constant (rather than re-exporting the aerial value) makes this
 * tunable independently if the M2 balance pass wants different
 * deadzones for special-button presses vs. aerial dispatch.
 *
 * Why 0.3:
 *   • Below 0.2, a relaxed thumb on a gamepad analog can register
 *     spurious deflection and accidentally send the player into a
 *     side-special when they wanted neutral.
 *   • Above 0.4, a player who holds a half-tilted stick (canonical
 *     "drift left" while standing) wouldn't get side-special — too
 *     restrictive.
 *   • 0.3 is the engine's universal compromise (see `Character.ts`
 *     comments for the same rationale).
 */
export const SPECIAL_STICK_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Input snapshot
// ---------------------------------------------------------------------------

/**
 * Shape the framework's input detector reads. Lives separately from
 * `CharacterInput` (which carries movement physics intent) because
 * special-direction detection needs:
 *   • A *rising-edge* press flag (`specialPressed`), not a held flag —
 *     a held special button must NOT keep firing the move every frame.
 *   • Both axes of the stick: `moveX` for left/right deflection,
 *     `moveY` for up/down. The legacy `CharacterInput` only carries
 *     `moveX` because grounded movement doesn't read vertical stick;
 *     specials do (up-special is the "press up + special" case).
 *
 * Conventions:
 *   • `moveX < 0` = left, `moveX > 0` = right (Phaser screen-space,
 *     same as `CharacterInput.moveX`).
 *   • `moveY < 0` = UP (Phaser screen-space negative-Y-is-up), `moveY > 0`
 *     = down. The dispatcher must invert the keyboard W/up-arrow to
 *     produce a negative `moveY`.
 *   • Values can be analog (gamepad axes) or digital (-1, 0, +1 for
 *     keyboard); the threshold classifier handles both.
 */
export interface SpecialInputSnapshot {
  /**
   * Rising-edge of the special button this frame — `true` only on the
   * first frame the button transitions from released to pressed. The
   * dispatch layer (or the runtime's button-state latch) is responsible
   * for converting "held" into "pressed-this-frame".
   */
  readonly specialPressed: boolean;
  /** Horizontal stick deflection. Range `[-1, +1]`. */
  readonly moveX: number;
  /**
   * Vertical stick deflection. Range `[-1, +1]`. NEGATIVE means UP
   * (Phaser screen-space). The detector reads the sign carefully so
   * "up" is unambiguous.
   */
  readonly moveY: number;
}

// ---------------------------------------------------------------------------
// Direction detector
// ---------------------------------------------------------------------------

/**
 * Classify a player's intended special direction from a stick + button
 * snapshot. Pure function — same input always returns the same output.
 *
 * Returns `null` if no direction should fire (button not pressed this
 * frame). Returns `'neutral' | 'side' | 'up'` on a press.
 *
 * Priority order (matches Smash-canonical input precedence):
 *
 *   1. `up` wins if `moveY <= -SPECIAL_STICK_THRESHOLD` — even if the
 *      stick is also deflected horizontally past the side threshold,
 *      a held-up-and-side stick is treated as "up-special". This is
 *      the canonical recovery-grace rule: a player off-stage scrambling
 *      back will often hold up-and-toward-stage; the runtime should
 *      still resolve that into the recovery up-special.
 *
 *   2. `side` wins if `|moveX| >= SPECIAL_STICK_THRESHOLD` and the
 *      up rule didn't apply. Down-deflection is currently lumped into
 *      side as well (the framework doesn't model down-special in v1)
 *      — a future extension would carve `'down'` out of this branch.
 *
 *   3. Otherwise → `neutral`. Includes the no-deflection case AND any
 *      below-threshold deflection (drifting thumb on a relaxed analog).
 *
 * Cooldown is NOT consulted by this function — it answers the
 * *intention* question only. The cooldown gate is enforced by the
 * resolver helpers below. Splitting the two lets AI scripts ask "what
 * direction would this input map to?" without entangling cooldown
 * state.
 */
export function detectSpecialDirection(
  input: SpecialInputSnapshot,
): SpecialDirection | null {
  if (!input.specialPressed) return null;
  // Up-priority: stick held up past threshold → up-special, regardless
  // of horizontal deflection.
  if (input.moveY <= -SPECIAL_STICK_THRESHOLD) return 'up';
  // Side: horizontal deflection past threshold (left or right).
  if (Math.abs(input.moveX) >= SPECIAL_STICK_THRESHOLD) return 'side';
  // Default: neutral.
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Cooldown tracking
// ---------------------------------------------------------------------------

/**
 * Independent cooldown counters for each of the three special
 * directions. A counter holds the number of fixed-step frames remaining
 * before that direction's special is ready to fire again; `0` means
 * ready.
 *
 * Why three counters and not one:
 *   • The Seed's per-character ~10-move kit gives each fighter THREE
 *     specials with potentially very different lockouts (a quick
 *     neutral counter at 30 frames vs. a long up-special recovery at
 *     60 frames). A single shared cooldown would force them to share
 *     the longest lockout, which would punish the cheap moves.
 *   • Mirrors the per-slot cooldown shape AI behaviour trees use
 *     ("what specials can I fire this frame?").
 *   • Replay snapshots can serialise this record verbatim — three
 *     small integers per fighter per frame.
 *
 * The record is *mutable* (regular object, not `Readonly`) because the
 * runtime ticks it down each frame in place — same pattern as
 * `Character.cooldownRemaining`. Test fixtures that need an immutable
 * snapshot can `Object.freeze` it themselves.
 */
export interface SpecialCooldownState {
  neutral: number;
  side: number;
  up: number;
}

/**
 * Construct a fresh cooldown state with all directions ready (every
 * counter at `0`). Pure factory — no closures, no shared references.
 */
export function createSpecialCooldownState(): SpecialCooldownState {
  return { neutral: 0, side: 0, up: 0 };
}

/**
 * Decrement every cooldown counter by `1` (clamped at `0`). Called
 * once per fixed step by the runtime. Mutates `state` in place; pure
 * with respect to the inputs (no global state, no clock reads).
 *
 * Returns `state` for fluent chaining in tests.
 */
export function tickSpecialCooldowns(
  state: SpecialCooldownState,
): SpecialCooldownState {
  if (state.neutral > 0) state.neutral -= 1;
  if (state.side > 0) state.side -= 1;
  if (state.up > 0) state.up -= 1;
  return state;
}

/**
 * Set the cooldown for `direction` to the move's full
 * `getMoveLockoutFrames` (busy + cooldownFrames). Called by the runtime
 * the frame a special is fired so the next press of the same direction
 * is gated until the move's full lockout elapses.
 *
 * Why use `getMoveLockoutFrames` and not just `move.cooldownFrames`:
 *   • The "cooldownFrames" in the move definition is the gap *after*
 *     the busy phase. If we only used that, a player could press
 *     special again the instant the busy phase ended — overlapping the
 *     fighter's own move. The lockout (busy + cooldown) is the
 *     canonical "earliest next press" answer the framework wants.
 *   • Mirrors `Character.tickAttack` which arms the same value on the
 *     non-special attack path. One source of truth.
 *
 * Mutates `state` in place. Returns `state` for fluent chaining.
 *
 * If `direction`'s current cooldown is already higher than the new
 * lockout (e.g. the player somehow fired during a frame the cooldown
 * was still active — defensive case, shouldn't happen in practice
 * because `isSpecialReady` would have returned `false`), we keep the
 * larger value so the slot stays gated.
 */
export function startSpecialCooldown(
  state: SpecialCooldownState,
  direction: SpecialDirection,
  move: AttackMove,
): SpecialCooldownState {
  const lockout = getMoveLockoutFrames(move);
  if (direction === 'neutral') {
    state.neutral = Math.max(state.neutral, lockout);
  } else if (direction === 'side') {
    state.side = Math.max(state.side, lockout);
  } else {
    state.up = Math.max(state.up, lockout);
  }
  return state;
}

/**
 * True iff `direction`'s special is off cooldown and ready to fire.
 * Pure read — does not mutate state.
 */
export function isSpecialReady(
  state: SpecialCooldownState,
  direction: SpecialDirection,
): boolean {
  return getSpecialCooldownRemaining(state, direction) === 0;
}

/**
 * Frames remaining on the requested direction's cooldown. `0` means
 * ready. Pure read — does not mutate state.
 */
export function getSpecialCooldownRemaining(
  state: SpecialCooldownState,
  direction: SpecialDirection,
): number {
  if (direction === 'neutral') return state.neutral;
  if (direction === 'side') return state.side;
  return state.up;
}

/**
 * Clear all cooldowns to `0`. Used by the respawn flow so a fighter
 * who just lost a stock comes back with every special ready.
 * Mutates `state`; returns it for fluent chaining.
 */
export function resetSpecialCooldowns(
  state: SpecialCooldownState,
): SpecialCooldownState {
  state.neutral = 0;
  state.side = 0;
  state.up = 0;
  return state;
}

// ---------------------------------------------------------------------------
// Per-character config schema
// ---------------------------------------------------------------------------

/**
 * Bundle of a fighter's three specials, keyed by direction. The schema
 * mirrors the Seed's `character.moveset` ontology — "each character
 * ships exactly one neutral / side / up special." A single record per
 * fighter is what consumers (the input dispatcher, AI scripts, replay
 * tooling, the move-editor, the HUD's "next move" preview) read; the
 * three schema files (`specialSchema.ts`, `sideSpecialSchema.ts`,
 * `upSpecialSchema.ts`) provide the per-direction discriminated union.
 *
 * Why a single record (and not three lookups):
 *   • Simpler call sites: the input dispatcher resolves a press with
 *     one `resolveSpecialMove(config, direction)` rather than three
 *     conditional `findMoveByType(spec, '<direction>Special')` calls.
 *   • Authoring clarity: a roster file can declare a fighter's full
 *     special kit as one literal — `{ neutral: WOLF_NEUTRAL_SPECIAL,
 *     side: WOLF_SIDE_SPECIAL, up: WOLF_UP_SPECIAL }`.
 *   • Test ergonomics: a unit test can build a partial-fighter
 *     `CharacterSpecialConfig` with stub moves to drive the framework
 *     without instantiating a full Character.
 *
 * The `characterId` field is optional — handy for debug logs and the
 * (future) move-editor's "saved configs by character" tab, but not
 * required by the runtime resolver. Tests pin it to a fixed string so
 * error messages are diagnosable.
 */
export interface CharacterSpecialConfig {
  /** Stable identifier of the owning fighter. Optional — used for diagnostics. */
  readonly characterId?: string;
  /** Neutral-special move record (the press-with-no-stick variant). */
  readonly neutral: NeutralSpecialMove;
  /** Side-special move record (the press-with-side-stick variant). */
  readonly side: SideSpecialMove;
  /** Up-special move record (the press-with-up-stick variant — recovery). */
  readonly up: UpSpecialMove;
}

/**
 * Discriminated union of every per-direction move type the framework
 * can return. Useful as the `move` field of a resolver result so
 * callers can switch on `direction` and narrow to the matching shape.
 */
export type SpecialMove = NeutralSpecialMove | SideSpecialMove | UpSpecialMove;

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Look up the move that should fire for a given direction in a config.
 * Pure read — no cooldown gating, no input parsing. Returns the move
 * record verbatim.
 *
 * The narrower per-direction return type is reflected in the function
 * overloads so a caller passing `'neutral'` gets back a
 * `NeutralSpecialMove` (not a wider union), enabling exhaustive
 * `specialKind` switches without a manual cast.
 */
export function resolveSpecialMove(
  config: CharacterSpecialConfig,
  direction: 'neutral',
): NeutralSpecialMove;
export function resolveSpecialMove(
  config: CharacterSpecialConfig,
  direction: 'side',
): SideSpecialMove;
export function resolveSpecialMove(
  config: CharacterSpecialConfig,
  direction: 'up',
): UpSpecialMove;
export function resolveSpecialMove(
  config: CharacterSpecialConfig,
  direction: SpecialDirection,
): SpecialMove;
export function resolveSpecialMove(
  config: CharacterSpecialConfig,
  direction: SpecialDirection,
): SpecialMove {
  switch (direction) {
    case 'neutral':
      return config.neutral;
    case 'side':
      return config.side;
    case 'up':
      return config.up;
    default: {
      const _exhaustive: never = direction;
      throw new Error(
        `resolveSpecialMove: unknown direction '${_exhaustive as string}'`,
      );
    }
  }
}

/**
 * Resolution result returned by {@link resolveSpecialFromInput}.
 * Carries the resolved direction AND the move that should fire so the
 * caller can branch on either dimension. Pure data — safe to clone /
 * serialise into a replay event.
 */
export interface SpecialResolution {
  readonly direction: SpecialDirection;
  readonly move: SpecialMove;
}

/**
 * Top-level resolver: classify the input snapshot, gate by cooldown,
 * and return the move that should fire. Pure with respect to its
 * inputs.
 *
 * Returns `null` in any of these cases:
 *   • The special button wasn't pressed this frame (no rising edge).
 *   • The classified direction's cooldown is still ticking.
 *   • The config is missing the resolved direction's move record
 *     (defensive — `CharacterSpecialConfig` requires all three so
 *     this should not fire in practice).
 *
 * The caller is responsible for calling
 * {@link startSpecialCooldown} with the returned move on a successful
 * resolution; this function does NOT mutate the cooldown state.
 * Splitting the read from the write lets:
 *   • AI predictors call the resolver many times during search without
 *     committing the cooldown each time;
 *   • The runtime apply the cooldown only on the actual fire frame
 *     (skipping it if a higher-priority gate — invincibility frames,
 *     hit-stun lockout — would have rejected the move anyway).
 */
export function resolveSpecialFromInput(
  config: CharacterSpecialConfig,
  cooldown: SpecialCooldownState,
  input: SpecialInputSnapshot,
): SpecialResolution | null {
  const direction = detectSpecialDirection(input);
  if (direction === null) return null;
  if (!isSpecialReady(cooldown, direction)) return null;
  const move = resolveSpecialMove(config, direction);
  return { direction, move };
}

// ---------------------------------------------------------------------------
// Iteration helpers
// ---------------------------------------------------------------------------

/**
 * Iterate every move in a config. Useful for validators / animation
 * pre-loaders / balance-pass tooling that wants to walk all three
 * directions without a manual `[config.neutral, config.side, config.up]`.
 *
 * Pure — returns a fresh array; the caller is free to mutate it.
 */
export function listSpecialMoves(
  config: CharacterSpecialConfig,
): ReadonlyArray<SpecialMove> {
  return [config.neutral, config.side, config.up];
}

/**
 * Iterate every `(direction, move)` pair in a config. Useful for the
 * AI predictor that wants to score each special independently.
 */
export function listSpecialMoveEntries(
  config: CharacterSpecialConfig,
): ReadonlyArray<{ direction: SpecialDirection; move: SpecialMove }> {
  return [
    { direction: 'neutral' as SpecialDirection, move: config.neutral },
    { direction: 'side' as SpecialDirection, move: config.side },
    { direction: 'up' as SpecialDirection, move: config.up },
  ];
}
