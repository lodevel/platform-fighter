/**
 * Grounded normal-move input dispatch — AC 60101 Sub-AC 1.
 *
 * Pure helper that maps a single fixed-step's grounded attack-input
 * snapshot to a registered move identifier from a fighter's slot table.
 * The three patterns the Seed's "grounded normal moves" concept calls
 * out — jab (neutral attack), tilt (directional tap), smash
 * (directional hold/charge or dedicated heavy press) — are classified
 * here so the {@link Character} runtime, the AI module, the
 * input-replay verifier, and the (later AC) input-rebinding screen all
 * read from a single source of truth.
 *
 * Why a separate module:
 *
 *   • The dispatcher is *pure* — it consumes a snapshot record and a
 *     slot table, returns a move id (or null), and reads no live
 *     character state. Lifting it out of `Character.ts` lets the unit
 *     tests assert pattern-classification semantics without spinning
 *     up a Matter scene, and lets AI behaviour trees / replay drift
 *     verifiers reuse the same classifier.
 *   • Smash conventions encode three distinct grounded press patterns,
 *     not two. Folding the third (tilt) into a coarse "light vs heavy"
 *     button split would force a fighter to bind every tilt to a
 *     dedicated key — a non-starter on keyboards with limited
 *     real-estate. Mapping by stick + button gives us the canonical
 *     Smash idiom: hold a direction with `attack` to tilt; flick the
 *     stick or press `attackHeavy` to smash.
 *   • Backwards compatibility — the historical "grounded `attack` ⇒
 *     light slot" path is preserved as a fallback when a roster ships
 *     no tilt slot (single-move test fighters, M1-era fixtures). The
 *     pure helper makes the fallback an explicit one-liner instead of
 *     branching nests in the runtime.
 *
 * Pattern semantics (60 Hz fixed step):
 *
 *   1. **Jab — neutral attack.** `attack` rises this frame AND the
 *      stick is at rest (|moveX| < `neutralThreshold`). Resolves to
 *      the `jabId` slot, then the `defaultId` light-slot fallback.
 *
 *   2. **Tilt — directional tap.** `attack` rises this frame AND the
 *      stick is held past the neutral threshold but did NOT undergo
 *      a rapid stick-flick this same frame. Resolves to the `tiltId`
 *      slot; if the slot is empty, falls back to the jab/light slot
 *      so a single-jab roster keeps firing on directional input
 *      (matches AC 60002 / AC 60003 single-tilt expectations).
 *
 *   3. **Smash — directional hold/charge.** EITHER the dedicated
 *      `attackHeavy` button rose this frame, OR `attack` rose with a
 *      simultaneous stick *flick* (rest → deflected past
 *      `smashFlickThreshold` between the previous frame and this
 *      frame). Resolves to the `smashId` slot. A heavy press with no
 *      smash slot is intentionally a no-op — heavy is an explicit
 *      "do this only" trigger; we do NOT silently fall back to jab.
 *      A stick-flick smash with no smash slot falls back through the
 *      tilt → jab cascade so a roster that ships only jab keeps
 *      working on every press.
 *
 * Determinism: pure function of the input snapshot + slot table +
 * tuning constants. No `Math.random()`, no wall-clock reads. Two
 * replays driving identical input streams against identical slot
 * tables produce identical dispatch decisions every frame — the
 * property the replay system requires.
 *
 * Threshold defaults (kept here as named constants so downstream
 * consumers — the (later AC) rebinding screen, the AI's input
 * synthesiser — read the same values the dispatcher does):
 *
 *   • `DEFAULT_NEUTRAL_THRESHOLD = 0.3` — matches `AERIAL_STICK_THRESHOLD`
 *     in `Character.ts` so the grounded jab/tilt split uses the same
 *     deadzone as the airborne nair/fair/bair classifier. A relaxed
 *     thumb on a gamepad analog can drift up to ~0.2 without intent;
 *     >0.3 the intent is unambiguous.
 *
 *   • `DEFAULT_SMASH_FLICK_THRESHOLD = 0.7` — a "smash flick" is an
 *     intentional rapid stick deflection (not a casual lean). 0.7 is
 *     the conventional threshold in Smash-style games for separating
 *     tilt-grade tilts from smash-grade flicks.
 *
 *   • `DEFAULT_FLICK_REST_THRESHOLD = 0.3` — the previous-frame
 *     stick value must be at rest below this for a flick to register.
 *     Mirrors the neutral threshold so a player who was already
 *     holding the stick at half deflection cannot accidentally
 *     "smash" by pushing it slightly further.
 *
 * Authoring contract: every call passes a `slots` table read from
 * the live `Character` instance. The slots are independent — clearing
 * `tiltId` does NOT clear `jabId`. This lets balance tooling disable
 * specific dispatch paths without touching the registered move set.
 */

// ---------------------------------------------------------------------------
// Tunable thresholds (named constants so downstream consumers stay in sync)
// ---------------------------------------------------------------------------

/**
 * Neutral-stick deadzone for the grounded jab/tilt classifier. Below
 * this absolute value of `moveX` the stick is treated as "at rest"
 * and an `attack` press routes to the jab slot. Above it, the press
 * routes to the tilt slot (assuming no smash flick).
 *
 * Mirrors {@link import('./Character').AERIAL_STICK_THRESHOLD} so the
 * grounded and airborne classifiers feel identical to the player.
 */
export const DEFAULT_NEUTRAL_THRESHOLD = 0.3;

/**
 * Smash-flick threshold. A frame whose `moveX` crossed from below the
 * `flickRestThreshold` to above this value qualifies as a "smash
 * flick" — the canonical Smash-style "tap-to-smash" input that fires
 * the heavy attack without a dedicated button. 0.7 separates a
 * deliberate flick from a casual lean.
 */
export const DEFAULT_SMASH_FLICK_THRESHOLD = 0.7;

/**
 * Previous-frame rest threshold for the smash-flick detector. The
 * stick must have been at or below this absolute value on the
 * previous frame for the current frame's deflection to qualify as a
 * flick. Prevents a player who was already half-leaning the stick
 * from accidentally registering a smash by pushing it slightly
 * further.
 */
export const DEFAULT_FLICK_REST_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The three grounded normal-move pattern classes the dispatcher emits.
 * Stable string literals so AI / replay logs can carry them directly
 * without a numeric enum mapping.
 */
export type GroundedAttackPattern = 'jab' | 'tilt' | 'smash';

/**
 * Per-frame input snapshot consumed by {@link classifyGroundedAttack}.
 *
 * Fields:
 *   • `attackJustPressed`   — `true` on the rising-edge frame of the
 *                              normal/light attack button. The caller
 *                              detects the rising edge (the
 *                              `Character` runtime already does this
 *                              for `attack` / `attackHeavy`) and sets
 *                              this flag for one frame only.
 *   • `heavyJustPressed`    — `true` on the rising-edge frame of the
 *                              dedicated heavy/smash button. Same
 *                              caller-detected rising-edge contract.
 *   • `moveX`               — current-frame stick X in [-1, 1]. Pre-
 *                              clamped by the caller; the helper does
 *                              NOT re-clamp.
 *   • `prevMoveX`           — previous-frame stick X. Used to detect
 *                              a smash flick (rest → deflected within
 *                              one frame). On the first call (no
 *                              history), pass 0.
 */
export interface GroundedAttackInputSnapshot {
  readonly attackJustPressed: boolean;
  readonly heavyJustPressed: boolean;
  readonly moveX: number;
  readonly prevMoveX: number;
}

/**
 * Slot table read from the live `Character`. Each field is a move id
 * registered via `Character.registerAttack` — the dispatcher does NOT
 * verify the id maps to a real move in the character's table; that
 * lookup happens in the runtime that consumes the dispatch result.
 *
 * Slots:
 *   • `jabId`     — the jab move (neutral attack). Auto-filled by the
 *                   first registered `'jab'`-typed move.
 *   • `tiltId`    — the tilt move (directional tap). Auto-filled by
 *                   the first registered `'tilt'`-typed move.
 *   • `smashId`   — the smash move (directional hold/charge or heavy
 *                   button). Auto-filled by the first registered
 *                   `'smash'`-typed move.
 *   • `defaultId` — fallback used by the jab / tilt cascade when the
 *                   above slots are empty. Mirrors the legacy
 *                   `defaultAttackId` so single-move test fighters
 *                   (registered with just one `'jab'`) keep firing on
 *                   every grounded press regardless of stick input.
 *
 * `null` on any slot disables that dispatch path. A null `defaultId`
 * additionally means "no move registered" — the helper returns null
 * for every press.
 */
export interface GroundedAttackSlots {
  readonly jabId: string | null;
  readonly tiltId: string | null;
  readonly smashId: string | null;
  readonly defaultId: string | null;
}

/**
 * Optional override of the classifier's stick thresholds. All fields
 * default to the matching `DEFAULT_*` constant when omitted.
 */
export interface GroundedAttackTuning {
  readonly neutralThreshold?: number;
  readonly smashFlickThreshold?: number;
  readonly flickRestThreshold?: number;
}

/**
 * Result of a successful classification. `pattern` carries which
 * input class the dispatcher matched (useful for replay logs / debug
 * HUDs / AI feedback); `moveId` is the actual move to fire.
 */
export interface GroundedAttackDispatch {
  readonly moveId: string;
  readonly pattern: GroundedAttackPattern;
}

// ---------------------------------------------------------------------------
// Pattern detection — pure predicates
// ---------------------------------------------------------------------------

/**
 * Detect a smash flick: the stick was at rest last frame and is now
 * past the flick threshold. Sign of `moveX` does not matter — the
 * canonical Smash-style smash input is "rapid horizontal flick from
 * either centre or held-half toward the deflection extreme."
 *
 * Pure predicate; no global state. Determinism: identical
 * (prevMoveX, moveX, thresholds) tuples always return the same
 * boolean.
 */
export function isSmashFlick(
  prevMoveX: number,
  moveX: number,
  flickThreshold: number = DEFAULT_SMASH_FLICK_THRESHOLD,
  restThreshold: number = DEFAULT_FLICK_REST_THRESHOLD,
): boolean {
  return Math.abs(prevMoveX) <= restThreshold && Math.abs(moveX) >= flickThreshold;
}

/**
 * Detect a directional tap intent: stick is held past the neutral
 * deadzone this frame. Used by the tilt classifier to separate "stick
 * is leaning" (tilt) from "stick is at rest" (jab). Pure predicate.
 */
export function isStickHeld(
  moveX: number,
  neutralThreshold: number = DEFAULT_NEUTRAL_THRESHOLD,
): boolean {
  return Math.abs(moveX) >= neutralThreshold;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Map a grounded attack-input snapshot to a registered move id.
 *
 * Resolution order:
 *
 *   1. **Heavy press** — if `heavyJustPressed`, fire `smashId`. No
 *      fallback (heavy is an explicit "do this only" trigger).
 *      Returns null if `smashId` is empty.
 *
 *   2. **Light press + smash flick** — if `attackJustPressed` AND a
 *      smash flick was detected this frame, fire `smashId`. Falls
 *      through the tilt → jab cascade if the smash slot is empty so
 *      a roster that ships only jab keeps firing.
 *
 *   3. **Light press + stick held** — if `attackJustPressed` AND
 *      `|moveX| ≥ neutralThreshold` (no flick), fire `tiltId`. Falls
 *      back to `jabId` → `defaultId` if the tilt slot is empty.
 *
 *   4. **Light press + neutral stick** — if `attackJustPressed` and
 *      `|moveX| < neutralThreshold`, fire `jabId` → `defaultId`.
 *
 * Returns `null` when no rising-edge press happened this frame OR
 * when every cascade fallback in the matched branch is empty.
 *
 * Determinism: pure function of the inputs. Identical
 * (snapshot, slots, tuning) triples always produce identical
 * dispatch decisions across runs / platforms.
 */
export function classifyGroundedAttack(
  input: GroundedAttackInputSnapshot,
  slots: GroundedAttackSlots,
  tuning: GroundedAttackTuning = {},
): GroundedAttackDispatch | null {
  const neutralThreshold = tuning.neutralThreshold ?? DEFAULT_NEUTRAL_THRESHOLD;
  const flickThreshold = tuning.smashFlickThreshold ?? DEFAULT_SMASH_FLICK_THRESHOLD;
  const restThreshold = tuning.flickRestThreshold ?? DEFAULT_FLICK_REST_THRESHOLD;

  // -------------------------------------------------------------------
  // 1. Dedicated heavy press → smash slot only (no fallback).
  // -------------------------------------------------------------------
  if (input.heavyJustPressed) {
    if (slots.smashId !== null) {
      return { moveId: slots.smashId, pattern: 'smash' };
    }
    return null;
  }

  // -------------------------------------------------------------------
  // 2-4. Light press paths.
  // -------------------------------------------------------------------
  if (!input.attackJustPressed) {
    return null;
  }

  // 2. Smash flick on a light press → smash slot, with cascading
  //    fallback through tilt → jab → default so single-move rosters
  //    keep firing.
  if (isSmashFlick(input.prevMoveX, input.moveX, flickThreshold, restThreshold)) {
    if (slots.smashId !== null) {
      return { moveId: slots.smashId, pattern: 'smash' };
    }
    // Fall through to tilt cascade — the player's intent was "attack
    // while flicking" and the roster lacks a smash. The directional
    // press still resolves as a tilt (or jab if no tilt either).
    const tiltCascade = slots.tiltId ?? slots.jabId ?? slots.defaultId;
    if (tiltCascade !== null) {
      return { moveId: tiltCascade, pattern: 'tilt' };
    }
    return null;
  }

  // 3. Light press + stick held past the neutral deadzone → tilt.
  if (isStickHeld(input.moveX, neutralThreshold)) {
    const tiltCascade = slots.tiltId ?? slots.jabId ?? slots.defaultId;
    if (tiltCascade !== null) {
      return { moveId: tiltCascade, pattern: 'tilt' };
    }
    return null;
  }

  // 4. Light press + neutral stick → jab.
  const jabCascade = slots.jabId ?? slots.defaultId;
  if (jabCascade !== null) {
    return { moveId: jabCascade, pattern: 'jab' };
  }
  return null;
}
