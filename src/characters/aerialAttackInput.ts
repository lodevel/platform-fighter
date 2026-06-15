/**
 * Airborne aerial-move input dispatch — AC 60201 Sub-AC 1.
 *
 * Pure helper that mirrors {@link import('./groundedAttackInput').classifyGroundedAttack}
 * for the airborne half of the attack-press dispatcher. Given a single
 * fixed-step's airborne-state flag, attack-input snapshot, the
 * fighter's facing, and a slot table populated by `Character.registerAttack`,
 * it classifies the player's intent into one of three canonical aerial
 * directions (neutral / forward / back) and resolves the active move id
 * through a cascading fallback so partial movesets keep firing.
 *
 * Why a separate module:
 *
 *   • The "airborne state detection + aerial input handling" rule is
 *     a single, tightly-defined contract: aerial attacks fire iff the
 *     fighter is in the air. Lifting the predicate out of `Character.ts`
 *     into a pure helper lets the unit tests assert the contract
 *     without spinning up a Matter scene, and lets AI behaviour trees,
 *     replay drift verifiers, and the (later AC) input-rebinding screen
 *     all read from a single source of truth.
 *   • Determinism: a pure helper is trivially replay-stable. Identical
 *     (snapshot, slots, facing) triples always produce identical
 *     dispatch decisions — exactly the property the replay system
 *     requires.
 *   • Symmetry with the grounded dispatcher: `groundedAttackInput.ts`
 *     pulled out the jab / tilt / smash classifier; this module is the
 *     mirror image for the airborne kit (nair / fair / bair). The two
 *     dispatchers compose into the runtime's full press handler — the
 *     `Character.tickAttack` path picks whichever side matches the
 *     fighter's current grounded flag.
 *
 * Pattern semantics (60 Hz fixed step):
 *
 *   1. **Aerial gate (in-air check).** {@link classifyAerialAttack}
 *      returns `null` immediately when `airborne === false`. This is
 *      the canonical "aerials only fire when off the ground" rule:
 *      a press while grounded routes to the grounded dispatcher
 *      ({@link import('./groundedAttackInput').classifyGroundedAttack}),
 *      not here. The runtime calls this helper only on the air-press
 *      branch but the helper still defends the gate so any caller
 *      (AI synthesiser, replay re-driver) cannot accidentally fire an
 *      aerial from a grounded press.
 *
 *   2. **Heavy press is silently ignored.** A dedicated heavy/smash
 *      button press while airborne is dropped — smashes are grounded
 *      moves; the airborne kit has no smash. This matches the
 *      `Character.tickAttack` legacy path and keeps a player from
 *      accidentally firing a "smash" in mid-air by holding the heavy
 *      button.
 *
 *   3. **Neutral aerial (nair).** Light press with `|moveX|` below the
 *      neutral deadzone {@link AERIAL_STICK_THRESHOLD}. Resolves to
 *      `aerialNeutralId`, then falls through the legacy single-aerial
 *      slot, the light slot, and finally the default slot.
 *
 *   4. **Forward aerial (fair).** Light press with `moveX` past the
 *      deadzone AND the stick sign equals the fighter's facing
 *      *at the moment of the press* (caller passes `prevFacing`).
 *      Resolves to `aerialForwardId`, falling back through
 *      `aerialNeutralId → aerialAttackId → lightAttackId → defaultId`.
 *
 *   5. **Back aerial (bair).** Light press with `moveX` past the
 *      deadzone AND the stick sign opposite the fighter's facing.
 *      Resolves to `aerialBackId`, falling back through
 *      `aerialNeutralId → aerialAttackId → lightAttackId → defaultId`.
 *
 * The cascade order is identical to the existing inline aerial
 * dispatch in `Character.ts` so this extraction is a behaviour-
 * preserving refactor — every existing aerial-dispatch test still
 * passes against the post-extraction wiring.
 *
 * Determinism: pure function of the input snapshot + slot table +
 * facing + threshold. No `Math.random()`, no wall-clock reads. Two
 * replays driving identical input streams against identical slot
 * tables produce identical dispatch decisions every frame.
 *
 * Authoring contract: every call passes a `slots` table read from the
 * live `Character` instance. The slots are independent — clearing
 * `aerialBackId` does NOT clear `aerialNeutralId`. This lets balance
 * tooling disable specific dispatch paths without touching the
 * registered move set.
 */

import type { AerialDirection } from './aerialSchema';

// ---------------------------------------------------------------------------
// Tunable thresholds (re-exported from a single source so downstream
// consumers — AI input synthesiser, the (later AC) rebinding screen,
// the replay drift verifier — read the same value the dispatcher does)
// ---------------------------------------------------------------------------

/**
 * Stick-deadzone threshold used by the airborne attack-press handler
 * to classify "is the player holding a direction or not?" when picking
 * a directional aerial.
 *
 *   |moveX| < AERIAL_STICK_THRESHOLD   → neutral aerial (nair)
 *   sign(moveX) === prevFacing         → forward aerial (fair)
 *   sign(moveX) === -prevFacing        → back aerial (bair)
 *
 * Mirrors the existing `Character.AERIAL_STICK_THRESHOLD` constant —
 * pulled out as a named export here so AI scripts that synthesise
 * inputs and the (later AC) input-rebinding screen can read the same
 * value the controller does without importing from `Character.ts`
 * (which carries a heavy Phaser/Matter dependency graph).
 *
 * 0.3 was picked to match the dispatcher-level deadzone we already use
 * elsewhere (`groundedAttackInput.DEFAULT_NEUTRAL_THRESHOLD`): a
 * relaxed thumb on a gamepad analog can drift up to ~0.2 without the
 * player intending a direction; over 0.3 the intent is unambiguous.
 */
export const AERIAL_STICK_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-frame input snapshot consumed by {@link classifyAerialAttack}.
 *
 * Fields:
 *   • `airborne`            — `true` iff the fighter is OFF the ground
 *                              this frame. The caller passes the result
 *                              of `!Character.isGrounded()` (or the
 *                              equivalent from a replay snapshot).
 *                              When false, the helper returns null
 *                              regardless of the press flags — the
 *                              "aerial gate" half of Sub-AC 1.
 *   • `attackJustPressed`   — `true` on the rising-edge frame of the
 *                              normal/light attack button. Caller
 *                              detects the rising edge.
 *   • `heavyJustPressed`    — `true` on the rising-edge frame of the
 *                              dedicated heavy/smash button. Always
 *                              dropped while airborne — see semantics
 *                              note 2 in the file header.
 *   • `moveX`               — current-frame stick X in [-1, 1]. Pre-
 *                              clamped by the caller; the helper does
 *                              NOT re-clamp.
 *   • `prevFacing`          — fighter's facing at the moment of the
 *                              press, BEFORE this frame's motion code
 *                              had a chance to flip it. The caller
 *                              latches this on the previous frame so a
 *                              press that also flipped facing this
 *                              frame still reads as "stick away from
 *                              facing" (= bair) instead of "stick
 *                              toward facing" (= fair).
 */
export interface AerialAttackInputSnapshot {
  readonly airborne: boolean;
  readonly attackJustPressed: boolean;
  readonly heavyJustPressed: boolean;
  readonly moveX: number;
  /** Vertical stick (-1 up … +1 down). Drives up-air / down-air dispatch. Optional → 0. */
  readonly moveY?: number;
  readonly prevFacing: 1 | -1;
}

/**
 * Slot table read from the live `Character`. Each field is a move id
 * registered via `Character.registerAttack` — the dispatcher does NOT
 * verify the id maps to a real move in the character's table; that
 * lookup happens in the runtime that consumes the dispatch result.
 *
 * Slots:
 *   • `aerialNeutralId` — nair slot. Auto-filled by the first
 *                          registered aerial whose `aerialDirection`
 *                          is `'neutral'` (or by any plain
 *                          `AttackMove`-typed aerial — the legacy
 *                          single-aerial path defaults to neutral).
 *   • `aerialForwardId` — fair slot. Auto-filled by the first
 *                          registered aerial whose `aerialDirection`
 *                          is `'forward'`.
 *   • `aerialBackId`    — bair slot. Auto-filled by the first
 *                          registered aerial whose `aerialDirection`
 *                          is `'back'`.
 *   • `aerialAttackId`  — legacy single-aerial slot. Filled by the
 *                          first registered `'aerial'`-typed move
 *                          (regardless of direction). Used as the
 *                          last-line fallback when the directional
 *                          slots are empty so a fighter that ships
 *                          only `WOLF_NAIR` keeps firing nair on every
 *                          airborne press.
 *   • `lightAttackId`   — historic grounded-light slot. Used as a
 *                          deeper fallback so a roster that ships only
 *                          a jab keeps firing on every airborne press.
 *   • `defaultId`       — the bottom-of-cascade fallback. Mirrors the
 *                          legacy `defaultAttackId` so single-move
 *                          test fighters keep firing.
 *
 * `null` on any slot disables that dispatch path. A null `defaultId`
 * with every other slot empty means "no move registered" — the helper
 * returns null for every press.
 */
export interface AerialAttackSlots {
  readonly aerialNeutralId: string | null;
  readonly aerialForwardId: string | null;
  readonly aerialBackId: string | null;
  /** Up-air slot — fired on an up-stick aerial press. Optional → falls through to neutral. */
  readonly aerialUpId?: string | null;
  /** Down-air slot — fired on a down-stick aerial press. Optional → falls through to neutral. */
  readonly aerialDownId?: string | null;
  readonly aerialAttackId: string | null;
  readonly lightAttackId: string | null;
  readonly defaultId: string | null;
}

/**
 * Optional override of the classifier's stick threshold. Defaults to
 * {@link AERIAL_STICK_THRESHOLD} when omitted.
 */
export interface AerialAttackTuning {
  readonly stickThreshold?: number;
}

/**
 * Result of a successful classification. `direction` carries which
 * aerial-direction class the dispatcher matched (useful for replay
 * logs / debug HUDs / AI feedback); `moveId` is the actual move to
 * fire.
 */
export interface AerialAttackDispatch {
  readonly moveId: string;
  readonly direction: AerialDirection;
}

// ---------------------------------------------------------------------------
// Pattern detection — pure predicates
// ---------------------------------------------------------------------------

/**
 * Pure predicate: is the player's stick at rest this frame?
 *
 * `|moveX| < threshold` ⇒ neutral; otherwise the player is holding a
 * direction. Shared by the runtime and the test suite so the
 * "neutral aerial" classifier reads the same threshold the press
 * handler does.
 */
export function isStickNeutral(
  moveX: number,
  threshold: number = AERIAL_STICK_THRESHOLD,
): boolean {
  return Math.abs(moveX) < threshold;
}

/**
 * Classify a directional aerial intent given the stick deflection and
 * the fighter's facing at the moment of the press. Returns one of:
 *
 *   • `'neutral'` — stick within the deadzone.
 *   • `'forward'` — stick past the deadzone AND signed-toward facing.
 *   • `'back'`    — stick past the deadzone AND signed-opposite facing.
 *
 * Reads `prevFacing` (not the post-motion `this.facing`) so a press
 * that also flipped facing this frame still classifies the direction
 * relative to the fighter's orientation BEFORE the flip. The
 * canonical Smash-style "back-air does not turn you around" rule
 * depends on this — an attacker flicking the stick backward to fire
 * bair must not have his facing flipped by the same stick before the
 * direction is read.
 *
 * Pure predicate; no global state.
 */
export function classifyAerialDirection(
  moveX: number,
  prevFacing: 1 | -1,
  threshold: number = AERIAL_STICK_THRESHOLD,
  moveY: number = 0,
): AerialDirection {
  // Vertical stick wins when it dominates the horizontal axis — an up /
  // down flick on the stick fires the up-air / down-air (moveY follows
  // screen-space: -1 = up, +1 = down). Ties and pure-vertical both go to
  // the vertical move; otherwise fall through to the horizontal logic.
  if (Math.abs(moveY) >= threshold && Math.abs(moveY) >= Math.abs(moveX)) {
    return moveY < 0 ? 'up' : 'down';
  }
  if (isStickNeutral(moveX, threshold)) return 'neutral';
  const stickSign: 1 | -1 = moveX > 0 ? 1 : -1;
  return stickSign === prevFacing ? 'forward' : 'back';
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Map an airborne attack-input snapshot to a registered move id.
 *
 * Resolution order:
 *
 *   0. **Aerial gate.** If `!input.airborne`, return null. Aerial
 *      attacks are gated behind an in-air check at the dispatcher
 *      level — a grounded press routes to the grounded dispatcher
 *      ({@link import('./groundedAttackInput').classifyGroundedAttack}),
 *      not here. Defending the gate inside the helper itself protects
 *      against any caller (AI synthesiser, replay re-driver, future
 *      AC paths) accidentally firing an aerial from a grounded press.
 *
 *   1. **Heavy press is dropped.** If only `heavyJustPressed`, return
 *      null. The airborne kit has no smash — heavy presses while
 *      airborne are silently ignored, matching the `Character.tickAttack`
 *      legacy behaviour.
 *
 *   2. **No light press → no dispatch.** If `!attackJustPressed`,
 *      return null. The airborne attack channel only fires on a
 *      rising-edge light press (post-AC 60201 there is no airborne
 *      smash dispatch).
 *
 *   3. **Direction classification.** Compute `direction` via
 *      {@link classifyAerialDirection} from `moveX` + `prevFacing`.
 *
 *   4. **Slot lookup with cascading fallback.** Resolve the move id
 *      through the slot cascade for the matched direction. The
 *      cascades are:
 *
 *        forward → aerialForwardId → aerialNeutralId → aerialAttackId
 *                  → lightAttackId → defaultId
 *        back    → aerialBackId    → aerialNeutralId → aerialAttackId
 *                  → lightAttackId → defaultId
 *        neutral → aerialNeutralId → aerialAttackId → lightAttackId
 *                  → defaultId
 *
 *      The first non-null slot in the cascade wins; if every slot is
 *      null the helper returns null.
 *
 * Returns `null` when:
 *   • The fighter is grounded (aerial gate trips).
 *   • Only the heavy button rose this frame (heavy is dropped airborne).
 *   • No light press happened.
 *   • Every cascade fallback for the matched direction is empty.
 *
 * Determinism: pure function of the inputs. Identical
 * (snapshot, slots, tuning) triples always produce identical
 * dispatch decisions across runs / platforms.
 */
export function classifyAerialAttack(
  input: AerialAttackInputSnapshot,
  slots: AerialAttackSlots,
  tuning: AerialAttackTuning = {},
): AerialAttackDispatch | null {
  // ---- 0. Aerial gate — in-air check ----------------------------------
  if (!input.airborne) {
    return null;
  }

  // ---- 1+2. No actionable light press → bail --------------------------
  // Heavy is silently dropped (smashes are grounded moves). A frame
  // with only `heavyJustPressed` and no `attackJustPressed` produces
  // no aerial dispatch, matching the canonical airborne kit.
  if (!input.attackJustPressed) {
    return null;
  }

  // ---- 3. Direction classification ------------------------------------
  const stickThreshold = tuning.stickThreshold ?? AERIAL_STICK_THRESHOLD;
  const direction = classifyAerialDirection(
    input.moveX,
    input.prevFacing,
    stickThreshold,
    input.moveY ?? 0,
  );

  // ---- 4. Slot lookup with cascading fallback -------------------------
  // The cascade encodes the canonical "fall through to broader slots
  // until something fires" rule. A roster that ships only `WOLF_NAIR`
  // (registered as plain `AttackMove`-typed aerial) has all directional
  // slots null but `aerialAttackId` populated, so every press resolves
  // to nair regardless of stick direction. A roster with full
  // directionals routes presses to their dedicated slots.
  let moveId: string | null;
  if (direction === 'forward') {
    moveId =
      slots.aerialForwardId ??
      slots.aerialNeutralId ??
      slots.aerialAttackId ??
      slots.lightAttackId ??
      slots.defaultId;
  } else if (direction === 'back') {
    moveId =
      slots.aerialBackId ??
      slots.aerialNeutralId ??
      slots.aerialAttackId ??
      slots.lightAttackId ??
      slots.defaultId;
  } else if (direction === 'up') {
    moveId =
      slots.aerialUpId ??
      slots.aerialNeutralId ??
      slots.aerialAttackId ??
      slots.lightAttackId ??
      slots.defaultId;
  } else if (direction === 'down') {
    moveId =
      slots.aerialDownId ??
      slots.aerialNeutralId ??
      slots.aerialAttackId ??
      slots.lightAttackId ??
      slots.defaultId;
  } else {
    moveId =
      slots.aerialNeutralId ??
      slots.aerialAttackId ??
      slots.lightAttackId ??
      slots.defaultId;
  }

  if (moveId === null) {
    return null;
  }
  return { moveId, direction };
}
