/**
 * easyInputErrors — high-error-rate input mangler for the Easy tier
 * (AC 20203 Sub-AC 3 — "high error rates").
 *
 * Why this module exists
 * ----------------------
 *
 * The Easy difficulty tier targets a "noticeably weaker but believably
 * so" opponent. Three of the four AC properties are baked into the
 * behavior tree itself:
 *
 *   1. Slow reactions — {@link import('./perception/reactionWindowPresets').REACTION_WINDOW_PRESETS.easy}
 *      28-36 frame band, configured at the controller layer.
 *   2. Frequent idle behavior — {@link import('./offensive/IdleChanceLeaf').IdleChanceLeaf}.
 *   3. Frequent wandering behavior — {@link import('./offensive/WanderLeaf').WanderLeaf}.
 *
 * The fourth — **high error rates** — could in principle be added as a
 * fourth leaf, but a per-leaf error gate would need to know about every
 * attack / movement / dodge verb the tree might emit. Adding errors at
 * the *output* of the tree, after the offensive Selector has picked a
 * branch, is dramatically simpler:
 *
 *   • One mechanism handles wrong-direction movement, dropped attack
 *     presses, and accidental shield/dodge mashes uniformly.
 *   • The behavior tree itself stays tier-agnostic. Hard tier reuses
 *     the same leaves without inheriting the noise.
 *   • The error layer can be tuned independently of the tree shape, so
 *     a future "Hard with input-fuzzing for ranked replay variance"
 *     tier could plug it in without touching the offensive sub-tree.
 *
 * What "error" means concretely
 * -----------------------------
 *
 * The Easy bot's emitted {@link AIInputCommand} stream is mangled by
 * three orthogonal error families, each gated on its own probability:
 *
 *   1. **Direction reversal** (`moveErrorChance`) — when the bot
 *      decides to walk in one direction, occasionally it walks the
 *      *other* way for that frame. Reads as "the novice faceplants
 *      into the wall instead of toward the opponent."
 *
 *   2. **Dropped press** (`pressDropChance`) — when the bot decides
 *      to fire an attack / shield / dodge / jump, occasionally that
 *      press never makes it to the input record. Reads as "the
 *      novice forgot to push the button."
 *
 *   3. **Spurious press** (`spuriousPressChance`) — even when the bot
 *      did NOT decide to press anything, occasionally a random press
 *      verb slips into the input record on its own. Reads as "the
 *      novice mashed a button at random." The verb is sampled
 *      uniformly from a small pool (jab attack, shield, jump) so the
 *      noise stays believable rather than turning into a smash spam.
 *
 * Each family is independently gated by its own probability, so a
 * controller can dial any one to zero (e.g. for tests) without
 * disabling the others.
 *
 * Default tuning — the AC's "high error rates"
 * --------------------------------------------
 *
 *   • {@link DEFAULT_EASY_MOVE_ERROR_CHANCE} = 0.20 — about 1 in 5
 *     movement intents flip direction.
 *   • {@link DEFAULT_EASY_PRESS_DROP_CHANCE} = 0.30 — about 30 % of
 *     attack/shield/dodge/jump presses are silently dropped.
 *   • {@link DEFAULT_EASY_SPURIOUS_PRESS_CHANCE} = 0.05 — about 5 %
 *     of frames inject a random press the bot didn't intend.
 *
 * Combined, the three rates represent a substantially "hands-of-clay"
 * play style. The Easy tier doesn't *just* react slowly — it also
 * regularly screws up the input itself, which is the exact behaviour
 * a beginner exhibits in early matches.
 *
 * Determinism contract
 * --------------------
 *
 * The mangler consumes RNG values in a *deterministic order* every
 * tick:
 *
 *   1. Always one draw for the move-error gate, regardless of whether
 *      a move command was emitted.
 *   2. Always one draw for the press-drop gate per emitted press.
 *   3. Always one draw for the spurious-press gate.
 *   4. When spurious-press triggers, one additional draw for the
 *      verb pick.
 *
 * The fixed draw cadence means a replay log can re-run the same RNG
 * seed and reproduce the exact same error pattern — verifying the
 * Hybrid-replay drift-resync pipeline holds for the Easy tier the
 * same way it does for the Hard tier.
 *
 * The module is engine-agnostic — it imports only the
 * {@link AIInputCommand} verb shape and the {@link Rng} helper. No
 * Phaser, no Matter, so unit tests can drive it with plain object
 * arrays.
 */

import type {
  AIInputCommand,
  AIPressCommand,
} from './AIInputProvider';
import type { Rng } from '../utils/Rng';

// ---------------------------------------------------------------------------
// Public configuration
// ---------------------------------------------------------------------------

/**
 * Default chance per tick that a movement intent (`moveLeft` /
 * `moveRight` / `moveAxis`) is reversed. 0.20 = roughly 1 in 5
 * movement frames the bot walks the wrong way — clearly visible in
 * play but not so frequent that the bot can never close on the
 * opponent.
 */
export const DEFAULT_EASY_MOVE_ERROR_CHANCE = 0.2;

/**
 * Default chance per *emitted press* that the press is silently
 * dropped. 0.30 = about 30 % of attempted attacks / shields / dodges
 * never reach the input record. High enough to read as "novice forgot
 * the button" without locking the bot out of combat entirely.
 */
export const DEFAULT_EASY_PRESS_DROP_CHANCE = 0.3;

/**
 * Default chance per tick that a *spurious* press (one the bot did
 * NOT decide to make) is injected into the input record. 0.05 = a
 * random press misfires roughly once every 20 frames. The verb is
 * sampled from {@link DEFAULT_SPURIOUS_PRESS_POOL} — chosen to keep
 * the noise believable.
 */
export const DEFAULT_EASY_SPURIOUS_PRESS_CHANCE = 0.05;

/**
 * Pool of press verbs the spurious-press error draws from. Includes
 * the most common mash buttons a beginner reaches for: neutral
 * attack, shield, jump. Smash, special, and dodge are intentionally
 * absent — a smash misfire is too punishing to read as a believable
 * accident.
 *
 * Frozen so the default reference is safe to hand back to inspectors
 * without defensive copies.
 */
export const DEFAULT_SPURIOUS_PRESS_POOL: ReadonlyArray<AIPressCommand['kind']> =
  Object.freeze(['attack', 'shield', 'jump']);

/** Construction options for {@link EasyInputErrorMangler}. */
export interface EasyInputErrorOptions {
  /**
   * Probability per tick that a movement intent is reversed. Must
   * fall in `[0, 1]`. Defaults to {@link DEFAULT_EASY_MOVE_ERROR_CHANCE}.
   */
  readonly moveErrorChance?: number;
  /**
   * Probability per emitted press that the press is silently dropped.
   * Must fall in `[0, 1]`. Defaults to
   * {@link DEFAULT_EASY_PRESS_DROP_CHANCE}.
   */
  readonly pressDropChance?: number;
  /**
   * Probability per tick that a spurious press is injected. Must fall
   * in `[0, 1]`. Defaults to {@link DEFAULT_EASY_SPURIOUS_PRESS_CHANCE}.
   */
  readonly spuriousPressChance?: number;
  /**
   * Pool of press verbs the spurious-press error samples from.
   * Defaults to {@link DEFAULT_SPURIOUS_PRESS_POOL}. Must contain at
   * least one entry — an empty pool would be a misconfiguration.
   */
  readonly spuriousPressPool?: ReadonlyArray<AIPressCommand['kind']>;
}

/**
 * Resolved option set with defaults filled in. Useful for tests
 * asserting the actual tunables in play and for controller integration
 * code that wants to log the configuration.
 */
export interface ResolvedEasyInputErrorOptions {
  readonly moveErrorChance: number;
  readonly pressDropChance: number;
  readonly spuriousPressChance: number;
  readonly spuriousPressPool: ReadonlyArray<AIPressCommand['kind']>;
}

/** Apply defaults to user-supplied options and validate the result. */
export function resolveEasyInputErrorOptions(
  options: EasyInputErrorOptions = {},
): ResolvedEasyInputErrorOptions {
  const moveErr = options.moveErrorChance ?? DEFAULT_EASY_MOVE_ERROR_CHANCE;
  if (!Number.isFinite(moveErr) || moveErr < 0 || moveErr > 1) {
    throw new Error(
      `EasyInputErrorMangler: moveErrorChance must be in [0, 1], got ` +
        String(moveErr),
    );
  }
  const drop = options.pressDropChance ?? DEFAULT_EASY_PRESS_DROP_CHANCE;
  if (!Number.isFinite(drop) || drop < 0 || drop > 1) {
    throw new Error(
      `EasyInputErrorMangler: pressDropChance must be in [0, 1], got ` +
        String(drop),
    );
  }
  const spurious =
    options.spuriousPressChance ?? DEFAULT_EASY_SPURIOUS_PRESS_CHANCE;
  if (!Number.isFinite(spurious) || spurious < 0 || spurious > 1) {
    throw new Error(
      `EasyInputErrorMangler: spuriousPressChance must be in [0, 1], got ` +
        String(spurious),
    );
  }
  const pool = options.spuriousPressPool ?? DEFAULT_SPURIOUS_PRESS_POOL;
  if (!Array.isArray(pool) && pool.length == null) {
    throw new Error(
      `EasyInputErrorMangler: spuriousPressPool must be an array, got ` +
        String(pool),
    );
  }
  if (pool.length === 0) {
    throw new Error(
      'EasyInputErrorMangler: spuriousPressPool must contain at least one entry',
    );
  }
  return {
    moveErrorChance: moveErr,
    pressDropChance: drop,
    spuriousPressChance: spurious,
    spuriousPressPool: Object.freeze([...pool]) as ReadonlyArray<
      AIPressCommand['kind']
    >,
  };
}

// ---------------------------------------------------------------------------
// EasyInputErrorMangler — stateful error layer
// ---------------------------------------------------------------------------

/**
 * Stateless transformer that rewrites an emitted command stream to
 * inject high-error-rate noise matching a beginner's input failures.
 *
 * Per-tick contract:
 *
 *   1. Caller passes the bot's *intended* `AIInputCommand[]` (the
 *      verbs the behavior tree just emitted) and the controller's
 *      seeded RNG.
 *   2. Mangler returns a *new* command array — never mutates the
 *      input — with errors applied per the tunables.
 *   3. RNG is consumed in a fixed cadence so the same seed produces
 *      the same pattern across replays.
 *
 * The mangler holds **no per-tick state** between calls. All decision
 * randomness lives in the caller-supplied RNG, so a controller can
 * snapshot RNG state and round-trip the entire system.
 */
export class EasyInputErrorMangler {
  private readonly moveErrorChance: number;
  private readonly pressDropChance: number;
  private readonly spuriousPressChance: number;
  private readonly spuriousPressPool: ReadonlyArray<AIPressCommand['kind']>;

  /**
   * @param options Optional — see {@link EasyInputErrorOptions}.
   *                Throws on out-of-range probabilities or empty
   *                pool.
   */
  constructor(options: EasyInputErrorOptions = {}) {
    const resolved = resolveEasyInputErrorOptions(options);
    this.moveErrorChance = resolved.moveErrorChance;
    this.pressDropChance = resolved.pressDropChance;
    this.spuriousPressChance = resolved.spuriousPressChance;
    this.spuriousPressPool = resolved.spuriousPressPool;
  }

  /**
   * Apply the error layer to a single tick's command stream.
   *
   * @param commands Bot's *intended* verbs from the behavior tree.
   * @param rng     Seeded RNG. Consumed deterministically — see the
   *                module-level "Determinism contract" section.
   * @returns Mangled command array. Never mutates `commands`.
   */
  apply(
    commands: ReadonlyArray<AIInputCommand>,
    rng: Rng,
  ): AIInputCommand[] {
    const out: AIInputCommand[] = [];

    // Stage 1: per-tick move-error gate. ALWAYS draws one RNG value so
    // consumption is stable regardless of whether a move was emitted.
    const moveErrorRoll = rng.next();
    const reverseMove =
      this.moveErrorChance > 0 && moveErrorRoll < this.moveErrorChance;

    for (const cmd of commands) {
      if (isMoveCommand(cmd)) {
        if (reverseMove) {
          out.push(reverseMoveCommand(cmd));
        } else {
          out.push(cmd);
        }
        continue;
      }

      // Press / idle / ledgeRelease. Idle and ledgeRelease pass through
      // unmolested — dropping them would turn the bot into a button-
      // mashing zombie ignoring deliberate non-presses.
      if (cmd.kind === 'idle' || cmd.kind === 'ledgeRelease') {
        out.push(cmd);
        continue;
      }

      // Press emit: roll the press-drop gate.
      const dropRoll = rng.next();
      if (this.pressDropChance > 0 && dropRoll < this.pressDropChance) {
        // Press dropped — skip this command entirely.
        continue;
      }
      out.push(cmd);
    }

    // Stage 3: spurious-press injection. Applied AFTER the loop so the
    // RNG cadence is always: move-roll, drop-rolls per press, then a
    // single spurious roll, optionally a verb pick.
    const spuriousRoll = rng.next();
    if (
      this.spuriousPressChance > 0 &&
      spuriousRoll < this.spuriousPressChance
    ) {
      // Pool of length 1 — no need to consume a verb roll; the choice
      // is forced. (Mirrors the same "skip the roll on a single-entry
      // pool" pattern in RandomMoveSelectLeaf.)
      let kind: AIPressCommand['kind'];
      if (this.spuriousPressPool.length === 1) {
        kind = this.spuriousPressPool[0]!;
      } else {
        const idx = rng.range(0, this.spuriousPressPool.length - 1);
        kind = this.spuriousPressPool[idx]!;
      }
      // Type narrows: the pool only contains finite-pool press kinds
      // (no `ledgeRelease`, no `idle`), so the cast is safe.
      out.push({ kind } as AIPressCommand);
    }

    return out;
  }

  // ---- Inspectors -------------------------------------------------------

  /** Configured move-reversal probability, in `[0, 1]`. */
  getMoveErrorChance(): number {
    return this.moveErrorChance;
  }

  /** Configured press-drop probability, in `[0, 1]`. */
  getPressDropChance(): number {
    return this.pressDropChance;
  }

  /** Configured spurious-press probability, in `[0, 1]`. */
  getSpuriousPressChance(): number {
    return this.spuriousPressChance;
  }

  /** Pool the spurious-press error samples from. */
  getSpuriousPressPool(): ReadonlyArray<AIPressCommand['kind']> {
    return this.spuriousPressPool;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Flip a movement command's direction. `moveAxis` flips its sign. */
function reverseMoveCommand(cmd: AIInputCommand): AIInputCommand {
  switch (cmd.kind) {
    case 'moveLeft':
      return { kind: 'moveRight' };
    case 'moveRight':
      return { kind: 'moveLeft' };
    case 'moveUp':
      return { kind: 'moveDown' };
    case 'moveDown':
      return { kind: 'moveUp' };
    case 'moveAxis':
      return { kind: 'moveAxis', value: -cmd.value };
    default:
      return cmd;
  }
}

/** True iff a command is one of the movement verbs. */
function isMoveCommand(cmd: AIInputCommand): boolean {
  return (
    cmd.kind === 'moveLeft' ||
    cmd.kind === 'moveRight' ||
    cmd.kind === 'moveUp' ||
    cmd.kind === 'moveDown' ||
    cmd.kind === 'moveAxis'
  );
}
