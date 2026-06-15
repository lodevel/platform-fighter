/**
 * Per-character move logic + input-to-move resolver — AC 10004 Sub-AC 4.
 *
 * Single, deterministic, data-driven resolver that takes a fighter's
 * full {@link CharacterMoveset} (jab / tilt / smash + nair / fair / bair +
 * neutral / side / up / down specials, exactly the 10-slot kit the Seed's
 * `character.moveset` ontology mandates) plus a single fixed-step
 * {@link MoveResolverInput} snapshot, and returns the resolved move that
 * should fire this frame — or `null` if the press is gated.
 *
 * Why a separate module:
 *
 *   • The existing `groundedAttackInput.ts`, `aerialAttackInput.ts`, and
 *     `specialFramework.ts` modules each cover ONE branch of the dispatch
 *     decision (grounded normal, airborne aerial, neutral / side / up
 *     specials respectively). Each is pure and well-tested in isolation,
 *     but no single seam composes them into "what does THIS press fire
 *     for THIS character RIGHT NOW?".
 *
 *   • The existing special framework is intentionally limited to three
 *     directions (`'neutral' | 'side' | 'up'`); the v1 roster ships a
 *     full FOUR-direction special kit (every fighter has a down-special).
 *     The resolver here extends the framework's input-detection idea to
 *     four directions (with the canonical Smash precedence
 *     `up > down > side > neutral`) so the input layer's "stick-down +
 *     special" press resolves to the registered down-special move.
 *
 *   • The Seed's "input-to-move resolution (ground/air, directional,
 *     special inputs) executing the data-driven movesets" sub-AC asks
 *     for exactly this: one resolver, deterministic, that walks the
 *     character's authored moveset table and produces the active move
 *     for any per-frame input snapshot. That's the contract this module
 *     locks down.
 *
 * Composition contract:
 *
 *   The resolver does NOT replace the per-branch helpers — it composes
 *   them. `classifyGroundedAttack`, `classifyAerialAttack`, and the
 *   special-framework's `detectSpecialDirection` (extended for down)
 *   stay the canonical pure classifiers; the resolver picks the right
 *   one based on the airborne flag and the press category, then
 *   resolves the matched slot to the move record from the moveset.
 *
 * Determinism: pure function of (moveset, input snapshot, cooldowns,
 * tuning). No `Math.random()`, no wall-clock reads, no Phaser / Matter
 * side effects. Identical inputs always produce identical outputs —
 * exactly the property the replay system requires.
 *
 * Usage shape (typical input dispatcher / AI predictor):
 *
 *     const moveset = MOVESET_TABLE[characterId];
 *     const cooldowns = createMoveResolverCooldowns();
 *     // every fixed step:
 *     tickMoveResolverCooldowns(cooldowns);
 *     const dispatch = resolveMoveFromInput(moveset, input, cooldowns);
 *     if (dispatch !== null) {
 *       fire(dispatch.moveId);
 *       startMoveResolverCooldown(cooldowns, dispatch);
 *     }
 *
 * The cooldown state is independent of `Character.cooldownRemaining` —
 * it tracks per-special-direction lockouts (mirroring
 * `specialFramework.SpecialCooldownState` but extended to four
 * directions). The grounded / aerial branches have no per-direction
 * cooldown of their own; the runtime gates them via the move's general
 * busy / lockout window through `Character.cooldownRemaining`.
 *
 * Backwards compatibility:
 *
 *   This module is purely additive — it consumes the existing pure
 *   helpers without modifying them, and ships a new resolver that
 *   downstream consumers (the Character runtime's special-button
 *   branch, the AI predictor, the (later AC) input-rebinding screen,
 *   the replay drift verifier) can opt into. Existing call sites that
 *   reach into the per-branch classifiers directly keep compiling
 *   unchanged.
 */

import type { AerialDirection } from './aerialSchema';
import {
  classifyAerialAttack,
  type AerialAttackSlots,
} from './aerialAttackInput';
import {
  classifyGroundedAttack,
  type GroundedAttackPattern,
  type GroundedAttackSlots,
} from './groundedAttackInput';
import { getMoveLockoutFrames } from './moveSchema';
import type { AttackMoveWithAnimation } from './moveSchema';
import type {
  AerialSlot,
  CharacterMoveset,
  SpecialSlot,
} from './movesetAnimationDriver';

// ---------------------------------------------------------------------------
// Tunable thresholds
// ---------------------------------------------------------------------------

/**
 * Stick-deadzone threshold used for special-direction classification.
 * Mirrors `SPECIAL_STICK_THRESHOLD` from `specialFramework.ts` — the
 * universal "is the player intentionally holding a direction" deadzone
 * we use across every directional press classifier.
 *
 * 0.3 was picked to match the engine-wide deadzone:
 *   • Below 0.2 — relaxed thumb on a gamepad analog drifts into spurious
 *     "intent" territory; pushing it that low would force the player to
 *     center the stick precisely.
 *   • Above 0.4 — a casual lean would be too restrictive; a player who
 *     holds the stick toward the stage edge while pressing special
 *     would never get side-special.
 */
export const RESOLVER_SPECIAL_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Categories & directional discriminators
// ---------------------------------------------------------------------------

/**
 * Top-level dispatch category. Matches the three press-resolution paths
 * the Seed's "input-to-move resolution" wording calls out: ground,
 * aerial, special.
 */
export type MoveResolverCategory = 'groundedNormal' | 'aerial' | 'special';

/**
 * Special-direction discriminator used by the resolver's special
 * classifier. The four canonical Smash directions — neutral, side, up,
 * down — exactly the per-character special slots the M2 roster ships.
 *
 * NOTE: this is intentionally a wider type than
 * `specialFramework.SpecialDirection` (which omits `'down'`). The
 * special framework was sealed at three directions for v1; the resolver
 * is the fourth-direction integration layer. The two coexist — callers
 * that want pure neutral/side/up classification continue to use
 * `detectSpecialDirection`; callers that want the full four-way
 * dispatch use {@link detectMoveResolverSpecialDirection}.
 */
export type MoveResolverSpecialDirection =
  | 'neutral'
  | 'side'
  | 'up'
  | 'down';

/** All four resolver special directions, in deterministic iteration order. */
export const MOVE_RESOLVER_SPECIAL_DIRECTIONS: ReadonlyArray<MoveResolverSpecialDirection> =
  Object.freeze(['neutral', 'side', 'up', 'down']);

// ---------------------------------------------------------------------------
// Slot type for grounded normals
// ---------------------------------------------------------------------------

/**
 * Grounded-normal slot — `'jab' | 'tilt' | 'smash'`. Mirrors the
 * dispatch pattern of {@link GroundedAttackPattern} 1:1; we re-export
 * the union here so consumers narrow on the resolver's `slot` field
 * without an extra import.
 */
export type GroundedNormalSlotName = 'jab' | 'tilt' | 'smash';

// ---------------------------------------------------------------------------
// Input snapshot
// ---------------------------------------------------------------------------

/**
 * Per-frame input snapshot consumed by {@link resolveMoveFromInput}.
 *
 * Composes the fields each existing per-branch classifier reads, plus
 * the `specialPressed` rising-edge flag and `moveY` axis the special
 * branch needs.
 *
 * Conventions:
 *   • `moveX < 0` = left, `moveX > 0` = right.
 *   • `moveY < 0` = UP, `moveY > 0` = down (Phaser screen-space).
 *   • All press flags are RISING-EDGE — `true` only on the first frame
 *     the button transitions from released to pressed. The runtime /
 *     dispatcher latches the prior frame's held state to compute these.
 *
 * Backwards-compat: the resolver is forgiving about partial input —
 * `specialJustPressed` defaults to `false`, `moveY` defaults to `0`.
 * Calls from a v1 input layer that only wires attack / heavy keep
 * working unchanged; the resolver simply never returns a special
 * dispatch.
 */
export interface MoveResolverInput {
  /** `true` iff the fighter is OFF the ground this frame. */
  readonly airborne: boolean;
  /** Rising-edge of the normal/light attack button this frame. */
  readonly attackJustPressed: boolean;
  /** Rising-edge of the dedicated heavy/smash button this frame. */
  readonly heavyJustPressed: boolean;
  /** Rising-edge of the dedicated special button this frame. */
  readonly specialJustPressed: boolean;
  /** Current-frame stick X in `[-1, 1]`. Pre-clamped by the caller. */
  readonly moveX: number;
  /**
   * Current-frame stick Y in `[-1, 1]`. NEGATIVE means UP (Phaser
   * screen-space). Pre-clamped by the caller.
   */
  readonly moveY: number;
  /**
   * Previous-frame stick X for smash-flick detection. Pass 0 on the
   * first call (no history). Read by the grounded classifier; ignored
   * by the aerial / special branches.
   */
  readonly prevMoveX: number;
  /**
   * Fighter's facing at the moment of the press, BEFORE this frame's
   * motion code had a chance to flip it. Read by the aerial branch to
   * classify forward-vs-back. Defaults to `1` (facing right) if the
   * caller doesn't latch facing.
   */
  readonly prevFacing: 1 | -1;
}

// ---------------------------------------------------------------------------
// Cooldowns
// ---------------------------------------------------------------------------

/**
 * Per-direction cooldown counters for the four specials. Mirrors
 * `specialFramework.SpecialCooldownState` but extended to four
 * directions. A counter holds the number of fixed-step frames remaining
 * before that direction's special is ready to fire again; `0` means
 * ready.
 *
 * The grounded-normal and aerial branches have no per-direction
 * cooldown — they're gated by the active-attack lifecycle. The resolver
 * only consults `cooldowns` for the special branch.
 */
export interface MoveResolverCooldowns {
  neutral: number;
  side: number;
  up: number;
  down: number;
}

/**
 * Construct a fresh cooldown state with every direction ready
 * (counters at `0`). Pure factory — no closures, no shared references.
 */
export function createMoveResolverCooldowns(): MoveResolverCooldowns {
  return { neutral: 0, side: 0, up: 0, down: 0 };
}

/**
 * Decrement every cooldown counter by `1` (clamped at `0`). Mutates
 * `state` in place; returns it for fluent chaining. Pure with respect
 * to the inputs (no global state, no clock reads).
 */
export function tickMoveResolverCooldowns(
  state: MoveResolverCooldowns,
): MoveResolverCooldowns {
  if (state.neutral > 0) state.neutral -= 1;
  if (state.side > 0) state.side -= 1;
  if (state.up > 0) state.up -= 1;
  if (state.down > 0) state.down -= 1;
  return state;
}

/**
 * Set the cooldown for `direction` to the move's full `getMoveLockoutFrames`
 * (busy + cooldownFrames). Called by the consumer the frame a special
 * is fired so the next press of the same direction is gated until the
 * move's full lockout elapses.
 *
 * Mirrors `specialFramework.startSpecialCooldown` exactly — same
 * "lockout = busy + cooldownFrames" rationale, same defensive
 * `Math.max` so a re-fire during an in-flight cooldown never shortens
 * the lockout.
 */
export function startMoveResolverCooldown(
  state: MoveResolverCooldowns,
  direction: MoveResolverSpecialDirection,
  move: AttackMoveWithAnimation,
): MoveResolverCooldowns {
  const lockout = getMoveLockoutFrames(move);
  if (direction === 'neutral') {
    state.neutral = Math.max(state.neutral, lockout);
  } else if (direction === 'side') {
    state.side = Math.max(state.side, lockout);
  } else if (direction === 'up') {
    state.up = Math.max(state.up, lockout);
  } else {
    state.down = Math.max(state.down, lockout);
  }
  return state;
}

/**
 * True iff `direction`'s special is off cooldown and ready to fire.
 * Pure read — does not mutate state.
 */
export function isMoveResolverDirectionReady(
  state: MoveResolverCooldowns,
  direction: MoveResolverSpecialDirection,
): boolean {
  if (direction === 'neutral') return state.neutral === 0;
  if (direction === 'side') return state.side === 0;
  if (direction === 'up') return state.up === 0;
  return state.down === 0;
}

/** Clear every cooldown to `0` — used on respawn so a fresh stock comes back ready. */
export function resetMoveResolverCooldowns(
  state: MoveResolverCooldowns,
): MoveResolverCooldowns {
  state.neutral = 0;
  state.side = 0;
  state.up = 0;
  state.down = 0;
  return state;
}

// ---------------------------------------------------------------------------
// Special-direction classifier (extended to 4 directions)
// ---------------------------------------------------------------------------

/**
 * Classify the player's intended special direction from the stick +
 * button rising-edge snapshot. Returns `null` if the special button
 * wasn't pressed this frame.
 *
 * Priority order — canonical Smash-style four-way precedence:
 *
 *   1. **`up` wins** if `moveY <= -threshold`. Even if the stick is
 *      also deflected horizontally past the side threshold, a held-up-
 *      and-side stick is treated as "up-special". Mirrors the recovery-
 *      grace rule that `specialFramework.detectSpecialDirection`
 *      already applies for the three-direction case: an off-stage
 *      fighter holding up-and-toward-stage scrambling back should still
 *      resolve into the up-special.
 *
 *   2. **`down` wins** next if `moveY >= threshold`. A stick held down-
 *      and-side reads as "down-special" — the down direction is more
 *      explicit about the player's intent than a slight side lean. The
 *      runtime convention "up dominates side, side dominates neutral"
 *      extends naturally: `up > down > side > neutral`.
 *
 *   3. **`side` wins** if `|moveX| >= threshold` and neither vertical
 *      branch fired.
 *
 *   4. Otherwise → **`neutral`**. Stick at rest OR within deadzone.
 *
 * Pure function — same input always returns the same output. No global
 * state, no clock reads.
 */
export function detectMoveResolverSpecialDirection(
  input: MoveResolverInput,
  threshold: number = RESOLVER_SPECIAL_THRESHOLD,
): MoveResolverSpecialDirection | null {
  if (!input.specialJustPressed) return null;
  if (input.moveY <= -threshold) return 'up';
  if (input.moveY >= threshold) return 'down';
  if (Math.abs(input.moveX) >= threshold) return 'side';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Dispatch result discriminated union
// ---------------------------------------------------------------------------

/**
 * Dispatch result for a grounded normal-move press.
 *
 * Carries the registered move (so the consumer doesn't have to look it
 * up again), the slot the move resolved into, and the input pattern
 * the classifier matched. The pattern is useful for replay logs and AI
 * feedback: a smash-flick that fell back to a tilt slot reads as
 * `pattern: 'tilt'`, capturing the fact that the player's intent was
 * "smash" but the roster's tilt was the actual fire.
 */
export interface MoveResolverGroundedDispatch {
  readonly category: 'groundedNormal';
  readonly slot: GroundedNormalSlotName;
  readonly pattern: GroundedAttackPattern;
  readonly moveId: string;
  readonly move: AttackMoveWithAnimation;
}

/**
 * Dispatch result for an airborne aerial-move press. Carries the
 * resolved aerial direction (`neutral` / `forward` / `back`), the
 * matching aerial slot, and the move record.
 */
export interface MoveResolverAerialDispatch {
  readonly category: 'aerial';
  readonly slot: AerialSlot;
  readonly direction: AerialDirection;
  readonly moveId: string;
  readonly move: AttackMoveWithAnimation;
}

/**
 * Dispatch result for a special-button press. Carries the resolved
 * direction (one of the four — neutral / side / up / down), the
 * matching special slot, and the move record.
 */
export interface MoveResolverSpecialDispatch {
  readonly category: 'special';
  readonly slot: SpecialSlot;
  readonly direction: MoveResolverSpecialDirection;
  readonly moveId: string;
  readonly move: AttackMoveWithAnimation;
}

/**
 * Discriminated union of every dispatch the resolver can produce.
 * Consumers `switch` on `category` and narrow to the matching shape.
 */
export type MoveResolverDispatch =
  | MoveResolverGroundedDispatch
  | MoveResolverAerialDispatch
  | MoveResolverSpecialDispatch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map an `AerialDirection` to the canonical aerial slot name used by
 * `CharacterMoveset`. Pure helper — kept private but exported via the
 * dispatcher's resolved `slot` field for downstream readers.
 */
function aerialDirectionToSlot(direction: AerialDirection): AerialSlot {
  if (direction === 'forward') return 'fair';
  if (direction === 'back') return 'bair';
  return 'nair';
}

/**
 * Map a `MoveResolverSpecialDirection` to the canonical special slot
 * name on `CharacterMoveset`.
 */
function specialDirectionToSlot(
  direction: MoveResolverSpecialDirection,
): SpecialSlot {
  if (direction === 'neutral') return 'neutralSpecial';
  if (direction === 'side') return 'sideSpecial';
  if (direction === 'up') return 'upSpecial';
  return 'downSpecial';
}

/**
 * Map a `GroundedAttackPattern` to the canonical grounded-normal slot.
 * Pattern → slot is 1:1 because the dispatch resolver already cascaded
 * fallbacks before stamping the pattern; the slot we want is the one
 * the cascade actually fired.
 */
function groundedPatternToSlot(
  pattern: GroundedAttackPattern,
): GroundedNormalSlotName {
  // The up-tilt / up-smash channels resolve to the same canonical
  // grounded-normal slot family for this (AI / replay) resolver — the
  // live dispatch in Character routes them to their dedicated up slots.
  if (pattern === 'utilt' || pattern === 'dtilt' || pattern === 'dashAttack') {
    return 'tilt';
  }
  if (pattern === 'usmash' || pattern === 'dsmash') return 'smash';
  return pattern;
}

// ---------------------------------------------------------------------------
// Top-level resolver
// ---------------------------------------------------------------------------

/**
 * Map a per-frame {@link MoveResolverInput} snapshot to the resolved
 * move that should fire — or `null` if no press resolved.
 *
 * Resolution order (single fixed step):
 *
 *   1. **Special branch (priority).** If `specialJustPressed`, classify
 *      the direction (up / down / side / neutral with the documented
 *      precedence), gate on the cooldown counter for that direction,
 *      and return the matching slot's move.
 *
 *      Why specials win over a same-frame attack press: the special
 *      button is a dedicated input distinct from `attack` / `heavy`;
 *      a player who pressed both this frame intended the special. The
 *      runtime is responsible for not synthesising spurious double-
 *      presses (the key-mapping layer maps the special key to exactly
 *      one of the buttons).
 *
 *   2. **Aerial branch.** If `airborne`, delegate to
 *      `classifyAerialAttack` with a slots table built from the
 *      moveset's nair / fair / bair entries. Heavy presses are dropped
 *      airborne (smashes are grounded moves) — same rule the existing
 *      runtime applies. Aerial direction (`neutral` / `forward` /
 *      `back`) is classified relative to `prevFacing` so a stick press
 *      that also flipped facing this frame still reads as "stick away
 *      from facing" = bair.
 *
 *   3. **Grounded branch.** Otherwise (`!airborne`) delegate to
 *      `classifyGroundedAttack` with a slots table built from the
 *      moveset's jab / tilt / smash entries. Heavy press → smash slot;
 *      light press + stick held → tilt slot; light press + neutral
 *      stick → jab slot; smash flick → smash slot with cascade through
 *      tilt → jab on partial movesets.
 *
 * Returns `null` if:
 *   • No press flag rose this frame.
 *   • Special press classified to a direction whose cooldown is still
 *     ticking.
 *   • The matched branch's classifier returned null (no slot fired).
 *
 * The resolver does NOT mutate `cooldowns` — the caller is responsible
 * for calling `startMoveResolverCooldown` after a successful special
 * dispatch. Splitting the read from the write lets:
 *   • AI predictors call the resolver many times during search without
 *     committing the cooldown each time.
 *   • The runtime apply the cooldown only on the actual fire frame
 *     (skipping it if a higher-priority lockout — hitstun, shield-
 *     break stun, ledge-hang — would have rejected the press anyway).
 *
 * Determinism: pure function. Identical (moveset, input, cooldowns)
 * triples produce identical outputs across runs / platforms.
 */
export function resolveMoveFromInput(
  moveset: CharacterMoveset,
  input: MoveResolverInput,
  cooldowns: MoveResolverCooldowns = createMoveResolverCooldowns(),
): MoveResolverDispatch | null {
  // ---------------------------------------------------------------
  // 1. Special branch (priority over normal / aerial press on the
  //    same frame — the special button is a dedicated input).
  // ---------------------------------------------------------------
  const specialDirection = detectMoveResolverSpecialDirection(input);
  if (specialDirection !== null) {
    if (!isMoveResolverDirectionReady(cooldowns, specialDirection)) {
      return null;
    }
    const slot = specialDirectionToSlot(specialDirection);
    const move = moveset[slot];
    return {
      category: 'special',
      slot,
      direction: specialDirection,
      moveId: move.id,
      move,
    };
  }

  // ---------------------------------------------------------------
  // 2. Aerial branch — airborne attack press.
  // ---------------------------------------------------------------
  if (input.airborne) {
    const slots: AerialAttackSlots = {
      aerialNeutralId: moveset.nair.id,
      aerialForwardId: moveset.fair.id,
      aerialBackId: moveset.bair.id,
      // Legacy slots — the moveset table guarantees nair / fair / bair
      // are populated for the v1 roster, so the cascading fallbacks
      // through aerialAttackId / lightAttackId / defaultId never fire
      // in practice. We still wire them to nair / jab so the helper's
      // contract is satisfied: any classification path through the
      // helper resolves to a registered move.
      aerialAttackId: moveset.nair.id,
      lightAttackId: moveset.jab.id,
      defaultId: moveset.jab.id,
    };
    const dispatch = classifyAerialAttack(
      {
        airborne: true,
        attackJustPressed: input.attackJustPressed,
        heavyJustPressed: input.heavyJustPressed,
        moveX: input.moveX,
        prevFacing: input.prevFacing,
      },
      slots,
    );
    if (dispatch === null) return null;
    const slot = aerialDirectionToSlot(dispatch.direction);
    const move = moveset[slot];
    return {
      category: 'aerial',
      slot,
      direction: dispatch.direction,
      moveId: move.id,
      move,
    };
  }

  // ---------------------------------------------------------------
  // 3. Grounded branch — grounded normal-move press.
  // ---------------------------------------------------------------
  const groundedSlots: GroundedAttackSlots = {
    jabId: moveset.jab.id,
    tiltId: moveset.tilt.id,
    smashId: moveset.smash.id,
    defaultId: moveset.jab.id,
  };
  const groundedDispatch = classifyGroundedAttack(
    {
      attackJustPressed: input.attackJustPressed,
      heavyJustPressed: input.heavyJustPressed,
      moveX: input.moveX,
      prevMoveX: input.prevMoveX,
    },
    groundedSlots,
  );
  if (groundedDispatch === null) return null;
  const slot = groundedPatternToSlot(groundedDispatch.pattern);
  const move = moveset[slot];
  return {
    category: 'groundedNormal',
    slot,
    pattern: groundedDispatch.pattern,
    moveId: move.id,
    move,
  };
}

// ---------------------------------------------------------------------------
// Convenience: enumerate all 10 moves of a moveset
// ---------------------------------------------------------------------------

/**
 * Pure helper — flatten a `CharacterMoveset` into its 10 moves in
 * canonical order (jab → tilt → smash → nair → fair → bair → neutral →
 * side → up → down). Useful for AI scripts that score every move once
 * per fixed step, balance-pass tooling, and the (later AC) move-editor
 * which renders the 10 entries in a column.
 */
export function enumerateMovesetMoves(
  moveset: CharacterMoveset,
): ReadonlyArray<AttackMoveWithAnimation> {
  return [
    moveset.jab,
    moveset.tilt,
    moveset.smash,
    moveset.nair,
    moveset.fair,
    moveset.bair,
    moveset.neutralSpecial,
    moveset.sideSpecial,
    moveset.upSpecial,
    moveset.downSpecial,
  ];
}
