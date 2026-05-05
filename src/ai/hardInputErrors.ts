/**
 * hardInputErrors — Hard-tier "minimal error rates" contract (AC 20205
 * Sub-AC 5).
 *
 * Why this module exists
 * ----------------------
 *
 * The Hard-tier difficulty AC mandates "minimal error rates" — the bot
 * should play as cleanly as a competent human, only dropping a press
 * or fumbling a movement on the rare frame where a real human would
 * also slip. Three properties make this concrete:
 *
 *   1. **Movement reversals**: a Hard-tier bot occasionally faceplants
 *      the wrong direction by ~1% of frames. Easy is 20%; Medium is
 *      ~10%; Hard is ~1%.
 *
 *   2. **Press drops**: a Hard-tier bot occasionally fails to deliver
 *      an attack press on the same scale (~1%). Easy is 30%; Medium
 *      is ~15%; Hard is ~1%.
 *
 *   3. **Spurious presses**: Hard explicitly does *not* inject random
 *      spurious presses. A Hard bot does not randomly mash buttons.
 *
 * The actual mangler implementation already lives in {@link
 * import('./easyInputErrors').EasyInputErrorMangler} — it parameterises
 * every probability and is not Easy-specific despite its filename. This
 * module exposes the **Hard-tier defaults** as named constants and a
 * convenience option set so a controller can opt into the same mangler
 * with the right probabilities and the determinism contract holds
 * verbatim across replays.
 *
 * Why not just inline these constants in `HardTierAI.ts`?
 *
 *   • The Hard tier is defined by a *contract* — the AC pins the
 *     "minimal error rates" property as a first-class quality of the
 *     tier. Surfacing the contract as a named module signals the
 *     intent to any future contributor reading the codebase, and lets
 *     them tune the values in one place rather than chasing them
 *     through the controller class.
 *
 *   • Easy / Medium / Hard share the *same* mangler implementation
 *     parameterised by per-tier probabilities. The defaults belong
 *     next to the tier they describe, not buried in a generic mangler
 *     file. Easy's defaults already live in `easyInputErrors.ts`;
 *     mirroring that with `hardInputErrors.ts` keeps the symmetry
 *     obvious.
 *
 *   • Tests asserting the Hard-tier minimal-error contract import this
 *     module by name; the constants would be re-derived (and risk
 *     drifting) if every consumer hand-coded them.
 *
 * Determinism contract
 * --------------------
 *
 * Like {@link import('./easyInputErrors').EasyInputErrorMangler}, the
 * mangler this module configures consumes RNG values in a fixed
 * cadence per tick: one move-error roll, one press-drop roll per
 * emitted press, one spurious roll. Even though the Hard-tier defaults
 * set the spurious probability to 0, the spurious roll is still
 * consumed so the cadence stays stable across tier changes.
 *
 * @example Wiring the Hard-tier mangler into a controller
 * ```ts
 * import { resolveHardInputErrorOptions } from './hardInputErrors';
 * import { EasyInputErrorMangler } from './easyInputErrors';
 *
 * const mangler = new EasyInputErrorMangler(resolveHardInputErrorOptions());
 * // ...
 * const mangledCommands = mangler.apply(intendedCommands, rng);
 * ```
 */

import type { EasyInputErrorOptions } from './easyInputErrors';

// ---------------------------------------------------------------------------
// Hard-tier minimal-error defaults
// ---------------------------------------------------------------------------

/**
 * Default chance per tick that a movement intent is reversed at the
 * Hard tier. 0.01 = roughly 1 in 100 movement frames the bot walks
 * the wrong way — small enough to read as "competent", nonzero so the
 * bot still has the *texture* of a human player rather than a
 * frame-perfect optimisation engine.
 *
 * Compare to {@link
 * import('./easyInputErrors').DEFAULT_EASY_MOVE_ERROR_CHANCE} (0.20)
 * — the Hard tier is 20× cleaner than Easy on movement.
 */
export const DEFAULT_HARD_MOVE_ERROR_CHANCE = 0.01;

/**
 * Default chance per *emitted press* that the press is silently
 * dropped at the Hard tier. 0.01 = roughly 1 in 100 attack / shield /
 * dodge presses fails to deliver. Compare to Easy's 0.30 default.
 */
export const DEFAULT_HARD_PRESS_DROP_CHANCE = 0.01;

/**
 * Default chance per tick that a spurious press is injected at the
 * Hard tier. **Set to 0 by design** — a Hard-tier bot does NOT
 * randomly mash buttons. Spurious press injection at the Hard tier
 * would directly contradict the AC's "minimal error rates" property.
 *
 * The constant is exported (rather than inlined as a literal `0`) so
 * a future "Hard-with-jitter" tier variant has an obvious named hook
 * to override.
 */
export const DEFAULT_HARD_SPURIOUS_PRESS_CHANCE = 0;

// ---------------------------------------------------------------------------
// Option resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the Hard-tier defaults into an {@link EasyInputErrorOptions}
 * record. The returned options can be passed straight into
 * {@link import('./easyInputErrors').EasyInputErrorMangler}.
 *
 * Pass partial overrides to override individual probabilities (e.g. a
 * "Champion" bot variant might dial movement errors to 0.005 while
 * keeping the press-drop rate at the Hard default).
 */
export function resolveHardInputErrorOptions(
  overrides: Partial<EasyInputErrorOptions> = {},
): EasyInputErrorOptions {
  return {
    moveErrorChance:
      overrides.moveErrorChance ?? DEFAULT_HARD_MOVE_ERROR_CHANCE,
    pressDropChance:
      overrides.pressDropChance ?? DEFAULT_HARD_PRESS_DROP_CHANCE,
    spuriousPressChance:
      overrides.spuriousPressChance ?? DEFAULT_HARD_SPURIOUS_PRESS_CHANCE,
    spuriousPressPool: overrides.spuriousPressPool,
  };
}

/**
 * Frozen reference to the canonical Hard-tier defaults — useful for
 * tests asserting the contract without re-resolving and for the
 * controller layer that just wants to log "are these the contract
 * values?" without poking the resolver.
 *
 * The reference is `Object.freeze`d so consumers can hand it back to
 * inspectors safely without defensive copies.
 */
export const HARD_TIER_INPUT_ERROR_DEFAULTS: Readonly<EasyInputErrorOptions> =
  Object.freeze({
    moveErrorChance: DEFAULT_HARD_MOVE_ERROR_CHANCE,
    pressDropChance: DEFAULT_HARD_PRESS_DROP_CHANCE,
    spuriousPressChance: DEFAULT_HARD_SPURIOUS_PRESS_CHANCE,
  });
