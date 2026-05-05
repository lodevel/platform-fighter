/**
 * decision/types — strategic decision-making vocabulary (AC 20202 Sub-AC 2).
 *
 * The existing AI surface is composed of *tactical* leaves (close the
 * gap, fire jab, recognise combo, hit-confirm follow-up, edge-guard,
 * up-special recovery, …) wired together inside per-tier behavior
 * trees. Those leaves answer the question "given the current state,
 * what is the next press?". They do **not** carry a higher-level name
 * for *what the bot is trying to do this moment* — every controller
 * tier infers strategic intent implicitly from the leaf that happened
 * to fire.
 *
 * Sub-AC 2 demands an explicit decision-making layer covering five
 * named strategic states — `approach`, `attack`, `defend`, `recover`,
 * `retreat` — together with **move selection heuristics** that pick
 * the actual press(es) for each state. A finite state machine is the
 * natural fit: the five states are mutually exclusive, transitions
 * fire on cleanly-observable predicates (off-stage status, opponent
 * state label, engagement zone, damage %, blast-zone proximity), and
 * the layer is small enough that a flat enum beats an additional
 * behavior-tree subtree on both readability and test-surface.
 *
 * What this module is
 * -------------------
 *
 *   • A self-contained FSM core with deterministic state transitions
 *     and move selection heuristics. Engine-agnostic — every input is
 *     pure data (`PerceivedSelf`, `PerceivedOpponent`, `PerceivedStage`)
 *     plus a seeded `Rng`. Output is a list of {@link DecisionAction}
 *     verbs collected by a tick-scoped {@link DecisionActionWriter}.
 *
 *   • An adapter layer (in `DecisionFSMLeaf.ts`) that wraps the FSM as
 *     a `LeafNode<OffensiveContext>` so it can slot into the existing
 *     behavior-tree machinery if a controller wants to compose it
 *     alongside the tier-specific trees rather than use it as a
 *     standalone brain.
 *
 *   • Pure-function policy helpers (`resolveDecisionState`,
 *     `selectActionsForState`) so unit tests can exercise the
 *     transition surface and the per-state heuristics without
 *     instantiating the FSM class.
 *
 * What this module deliberately is NOT
 * ------------------------------------
 *
 *   • A replacement for the existing Hard-tier behavior tree. The
 *     Hard tier's tactical depth (predictive movement, edge-guard
 *     scoring, combo recognition, KO-smash fishing, reliable recovery
 *     priority) lives in its own behavior tree; this FSM is a
 *     *strategic* layer that names the bot's current intent. A future
 *     tier (or diagnostic harness) can use this FSM as its full brain
 *     when the depth of the Hard tier is overkill.
 *
 *   • A perception pipeline. The FSM consumes the {@link
 *     import('../perception/WorldSnapshot').WorldSnapshot} primitives
 *     directly — controller wiring is responsible for assembling the
 *     snapshot, applying any reaction-window delay, and feeding the
 *     decision context once per tick.
 *
 *   • A scene observer. The FSM never reaches into Phaser / Matter —
 *     the decision context is plain data and every emit flows through
 *     the `DecisionActionWriter` sink so tests can record the verbs
 *     into an array for assertion.
 *
 * Determinism contract
 * --------------------
 *
 * Every public function in the decision module is deterministic on its
 * inputs. Randomness flows through the {@link Rng} carried by the
 * decision context — no `Math.random()`, no wall-clock reads. Two
 * decision contexts with identical fields produce identical state
 * resolutions and identical action emits, a property the replay system
 * relies on to verify drift-free simulation.
 */

import type { Rng } from '../../utils/Rng';
import type {
  PerceivedOpponent,
  PerceivedSelf,
  PerceivedStage,
} from '../perception/WorldSnapshot';
import type { EngagementRadii } from '../perception/distanceEvaluation';

// ---------------------------------------------------------------------------
// Strategic state vocabulary
// ---------------------------------------------------------------------------

/**
 * The five strategic FSM states the decision layer recognises.
 *
 *   - `approach` — bot is healthy, opponent is out of attack range;
 *                  walk / run toward the opponent. Default neutral
 *                  state when no other state's gate fires.
 *   - `attack`   — bot is healthy, opponent is in attack range and
 *                  not currently shielding-dodge-invincible; pick a
 *                  contextually appropriate press from the moveset.
 *   - `defend`   — opponent is in startup / active frames of an attack
 *                  within hit range; raise shield or burst-evade with
 *                  a dodge.
 *   - `recover`  — bot is off-stage and airborne; emit jump / up-
 *                  special / aerial movement to climb back to safety.
 *   - `retreat`  — bot is at high damage % near a blast zone, OR the
 *                  opponent is significantly stronger in stocks /
 *                  damage; back away from the opponent (and away from
 *                  the nearest blast zone) to bait whiffs.
 *
 * The five states are mutually exclusive: exactly one is "current"
 * per tick. State transitions are pure functions of the current
 * decision context — no hysteresis is required because the gate
 * predicates are themselves stable across small perturbations
 * (engagement zone bands, off-stage detection, etc.).
 */
export type DecisionState =
  | 'approach'
  | 'attack'
  | 'defend'
  | 'recover'
  | 'retreat';

/** Convenience constants for {@link DecisionState}. */
export const DecisionState = Object.freeze({
  Approach: 'approach',
  Attack: 'attack',
  Defend: 'defend',
  Recover: 'recover',
  Retreat: 'retreat',
} as const) satisfies Record<string, DecisionState>;

/**
 * All decision states in canonical priority order. Higher-priority
 * states pre-empt lower-priority ones during transition resolution.
 *
 *   1. `recover`  — being off-stage trumps everything; recovering home
 *                   takes precedence over any offensive / defensive
 *                   intent.
 *   2. `defend`   — a confirmed incoming attack within hit range trumps
 *                   approach / attack / retreat; trade damage for damage
 *                   only when the bot is committed to its own swing.
 *   3. `retreat`  — survival-pressure overrides offensive pressure; a
 *                   bot at KO % near a blast zone backs off rather than
 *                   trading.
 *   4. `attack`   — opponent in range with no defensive / survival
 *                   pressure → engage.
 *   5. `approach` — default neutral state when none of the above fires.
 *
 * Exposed as a frozen array so debug overlays and tests can iterate
 * the priority list directly.
 */
export const DECISION_STATE_PRIORITY: ReadonlyArray<DecisionState> = Object.freeze([
  'recover',
  'defend',
  'retreat',
  'attack',
  'approach',
]);

// ---------------------------------------------------------------------------
// Action verbs
// ---------------------------------------------------------------------------

/**
 * Discriminator for every verb the decision layer can emit on a tick.
 * Distinct from {@link import('../offensive/types').OffensiveActionKind}
 * because the decision layer covers verbs the offensive sub-tree
 * doesn't model — `jump` (used by the recover state to climb back
 * onto the stage) and `dropThrough` (used by the retreat state to
 * fall through a thin platform when backing off vertically).
 *
 *   - `idle`         — explicit "do nothing this tick" (debug-friendly:
 *                      a bot deliberately holding position emits idle
 *                      so tests can distinguish it from "no decision").
 *   - `moveLeft`     — walk / run left.
 *   - `moveRight`    — walk / run right.
 *   - `jump`         — press jump; the recover state's primary verb,
 *                      and the retreat state's escape verb when the
 *                      bot needs vertical space.
 *   - `jab`          — press neutral attack.
 *   - `tilt`         — press tilt (forward + attack).
 *   - `smash`        — press smash (charged forward attack — the bot's
 *                      KO finisher heuristic).
 *   - `special`      — press neutral special (zoning / projectile).
 *   - `upSpecial`    — press up-special (the canonical recovery move).
 *                      Exposed separately from `special` because the
 *                      recover state needs to specifically request the
 *                      vertical recovery move, not whatever the
 *                      character's neutral special happens to be.
 *   - `shield`       — hold shield (defensive block).
 *   - `dodge`        — press dodge / spot-dodge / roll (defensive
 *                      i-frames + reposition).
 *   - `dropThrough`  — request the down + jump pass-through so the bot
 *                      can fall off a thin platform during retreat.
 */
export type DecisionActionKind =
  | 'idle'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'jab'
  | 'tilt'
  | 'smash'
  | 'special'
  | 'upSpecial'
  | 'shield'
  | 'dodge'
  | 'dropThrough';

/**
 * One emit produced by the FSM during a tick.
 *
 *   - `kind`   — the verb itself.
 *   - `state`  — strategic state that produced this emit. Always set so
 *                debug overlays / replay logs can render the bot's
 *                strategic intent alongside the press sequence.
 *   - `note`   — optional free-form debug label (e.g. `'jab.koReach'`,
 *                `'shield.opportunistic'`). The runtime gameplay layer
 *                ignores it.
 */
export interface DecisionAction {
  readonly kind: DecisionActionKind;
  readonly state: DecisionState;
  readonly note?: string;
}

/**
 * Sink for {@link DecisionAction} emits produced during a single tick.
 *
 * Multiple emits per tick are explicitly supported — a `attack` state
 * tick may emit a movement verb (`moveRight`) plus an attack verb
 * (`tilt`) so the controller adapter can fold them into one
 * `CharacterInput` record (the standard Smash forward-tilt pattern).
 *
 * Tests inject a stub writer that records emits into an array; the
 * controller wires a real adapter that translates verbs into the
 * existing `AIInputCommand` / `OffensiveAction` records.
 */
export interface DecisionActionWriter {
  emit(action: DecisionAction): void;
}

// ---------------------------------------------------------------------------
// Per-tick decision context
// ---------------------------------------------------------------------------

/**
 * Per-tick context threaded through every decision-layer entry point.
 *
 * Mirrors the shape the controller already assembles from its
 * {@link import('../perception/WorldSnapshot').WorldSnapshot} pipeline,
 * so wiring is a thin projection rather than a new perception step.
 *
 *   - `self`       — bot's perceived self (position, velocity, damage,
 *                    etc.). Required.
 *   - `opponent`   — currently targeted opponent. `null` when no
 *                    opponent is alive (between stocks); the FSM treats
 *                    `null` as "no offensive / defensive work this
 *                    tick" and falls into `approach` with a no-op emit.
 *   - `stage`      — stage geometry slice (edges + blast zones).
 *                    Used by `recover` / `retreat` to detect off-stage
 *                    status and blast-zone proximity.
 *   - `tickIndex`  — monotonic frame counter the controller already
 *                    threads through every BT context. Surfaced here
 *                    so heuristics that need frame-relative timing can
 *                    read it without an extra parameter.
 *   - `rng`        — seeded PRNG for deterministic tie-breaks (e.g. the
 *                    `defend` state's "shield 80% / dodge 20%" mix).
 *   - `radii`      — optional override for the per-zone engagement
 *                    radii ({@link EngagementRadii}). Defaults to the
 *                    central {@link import('../perception/distanceEvaluation').DEFAULT_ENGAGEMENT_RADII}.
 */
export interface DecisionContext {
  readonly self: PerceivedSelf;
  readonly opponent: PerceivedOpponent | null;
  readonly stage: PerceivedStage;
  readonly tickIndex: number;
  readonly rng: Rng;
  readonly radii?: EngagementRadii;
}
