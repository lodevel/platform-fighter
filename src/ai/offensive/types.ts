/**
 * Offensive-play primitives — shared types for the Hard-tier offensive
 * behavior-tree branches authored in AC 18 Sub-AC 3.
 *
 * The Hard-tier AI is a deterministic behavior tree (Sub-ACs 1 + 2 of
 * AC 18 shipped the BT framework + per-tier reaction-window). Sub-AC 3
 * stacks the *offensive* branches on top of that framework: closing the
 * gap, picking a basic attack, then recognising and executing a basic
 * combo follow-up when the previous attack connects.
 *
 * Why a dedicated module, rather than appending leaves into
 * `behaviorTree/`?
 *
 *   1. Module isolation — defensive / recovery / movement branches will
 *      land in subsequent sub-ACs and want to share leaves like
 *      "MoveTowardOpponentLeaf" without dragging `combo`-specific state
 *      through unrelated sub-trees. Putting offensive concepts behind a
 *      named directory mirrors the `composites/`, `decorators/`,
 *      `perception/` separation used elsewhere.
 *
 *   2. Explicit contract — the Hard-tier offensive path needs an
 *      *opponent snapshot* (distance, damage %, state) and a *self
 *      snapshot* (facing, can-attack, airborne) plus an action writer
 *      it can emit press / movement intent into. Codifying those as
 *      types here lets sibling modules and tests construct mock
 *      contexts cheaply.
 *
 *   3. Determinism contract — every input to the offensive branches is
 *      either pure data (snapshots, blackboard, tickIndex) or a seeded
 *      Rng pulled through context. This module declares those types
 *      with the same `readonly` discipline applied across the rest of
 *      the engine so the replay system can serialise and rehydrate
 *      offensive state without bespoke adapters.
 *
 * Nothing in this file imports Phaser or Matter — the offensive sub-
 * tree is intentionally engine-agnostic so unit tests can construct
 * fully-fledged contexts with plain object literals.
 */

import type { BehaviorTreeContext } from '../behaviorTree/BehaviorTree';
import type { PerceivedStage } from '../perception/WorldSnapshot';
import type { Rng } from '../../utils/Rng';

// ---------------------------------------------------------------------------
// Action writer + emit shape
// ---------------------------------------------------------------------------

/**
 * Discriminator for every offensive action a leaf can emit on a given
 * tick. String-literal union (rather than a numeric enum) so the
 * value can be logged into the replay stream as-is, eyeballed in
 * debug overlays, and compared in tests with deep-equality.
 *
 *   - `idle`      — explicit "do nothing this tick" (Hard-tier bots
 *                   sometimes pause briefly to bait a whiff). Distinct
 *                   from "no emit at all" so the action writer's call
 *                   pattern is observable in tests.
 *   - `moveLeft`  — bot wants to walk/run left this tick.
 *   - `moveRight` — bot wants to walk/run right this tick.
 *   - `jab`       — press neutral attack.
 *   - `tilt`      — press the tilt-strength attack (forward + attack).
 *   - `smash`     — press the smash-strength attack (charged forward).
 *   - `special`   — press the neutral-special.
 *   - `shield`    — hold shield. Used by the Medium-tier defensive
 *                   blocking branch (AC 10204 Sub-AC 4) to interpose a
 *                   block when the opponent is in startup / active
 *                   frames of an attack and within reach. The press
 *                   adapter folds this into the `shield` press of the
 *                   {@link import('../AIInputProvider').AIInputProvider}
 *                   verb table.
 *   - `dodge`     — press dodge / spot-dodge / roll. Used by the
 *                   Medium-tier defensive evasion branch (AC 10203
 *                   Sub-AC 3) as the *evasive* counterpart to
 *                   `shield` — fires on a smaller fraction of incoming
 *                   threats so the bot mixes block-and-evade rather
 *                   than always holding shield. The press adapter
 *                   folds this into the `dodge` press of the
 *                   {@link import('../AIInputProvider').AIInputProvider}
 *                   verb table.
 *
 * Aerials, dashes, and grabs are intentionally absent: the offensive
 * branches authored in this sub-AC focus on the *grounded combo
 * pipeline*. Aerial follow-ups land in a later sub-AC alongside the
 * recovery / edge-guard branches.
 */
export type OffensiveActionKind =
  | 'idle'
  | 'moveLeft'
  | 'moveRight'
  | 'jab'
  | 'tilt'
  | 'smash'
  | 'special'
  | 'shield'
  | 'dodge';

/**
 * Single emit produced by a leaf during a tick.
 *
 *   - `kind`        — the action verb itself.
 *   - `comboStepId` — optional debug label tagging which combo step
 *                     produced this emit. `'neutral'` for non-combo
 *                     emits, the combo identifier (e.g. `'jab→tilt'`)
 *                     for follow-ups. Useful for replay overlays and
 *                     for assertions in unit tests; the runtime
 *                     gameplay layer ignores it.
 */
export interface OffensiveAction {
  readonly kind: OffensiveActionKind;
  readonly comboStepId?: string;
}

/**
 * Sink for actions emitted by leaves during a tick.
 *
 * The base controller (forthcoming AC) collects emits into a single
 * "intent" record per frame and feeds it into the existing input
 * dispatcher. Leaves never reach into Phaser / Matter directly; they
 * only emit through this writer so:
 *
 *   • Tests can inject a stub writer that records emits into an array
 *     for assertion (the pattern every test in this module uses).
 *   • The replay system can wrap the writer to log every emit before
 *     forwarding to the live dispatcher.
 *   • Fixed-step physics determinism is preserved — no leaf can
 *     short-circuit straight into the simulation.
 */
export interface ActionWriter {
  /**
   * Record an emit. Multiple emits per tick are explicitly allowed
   * (e.g. a sequence might emit both `moveRight` and `jab` on the same
   * frame to tilt-forward). The base controller's policy for resolving
   * conflicting emits is documented in its own module.
   */
  emit(action: OffensiveAction): void;
}

// ---------------------------------------------------------------------------
// World snapshots
// ---------------------------------------------------------------------------

/**
 * Coarse-grained label describing what the opponent is doing right
 * now. The Hard-tier offensive logic doesn't need full move metadata
 * — only "can I land a hit safely" — so a string union is sufficient.
 *
 * Categories (frame data nuance lives in the controller layer):
 *
 *   - `idle`       — standing/walking, no commit.
 *   - `attacking`  — startup or active frames of a move.
 *   - `recovering` — recovery / cooldown frames of a move.
 *   - `shielding`  — currently holding shield up.
 *   - `dodging`    — i-frames active (spot/forward/back/air dodge).
 *   - `hitstun`    — locked into hurt state from a recent hit. **The
 *                    canonical combo opportunity window.**
 *   - `airborne`   — neither grounded nor in any of the above.
 *   - `ledgeHang`  — clinging to a stage edge.
 */
export type OpponentStateLabel =
  | 'idle'
  | 'attacking'
  | 'recovering'
  | 'shielding'
  | 'dodging'
  | 'hitstun'
  | 'airborne'
  | 'ledgeHang';

/**
 * What the offensive branches need to know about the opponent each
 * tick. Snapshot is built by the controller from the live world state
 * (after passing through the {@link
 * import('../perception/ReactionWindow').ReactionWindow} so the bot
 * sees a delayed picture, matching the AC-mandated 15-20 frame
 * Hard-tier reaction window).
 */
export interface OpponentSnapshot {
  /** Stable identity — typically the player slot index (1..4). */
  readonly id: string;
  /**
   * Signed horizontal distance from the bot to the opponent in design
   * pixels. **Positive = opponent is to the right** of the bot.
   * Vertical separation is left out of the offensive snapshot because
   * grounded offence does not condition on it; the aerial branches in
   * the forthcoming sub-AC carry their own snapshot extension.
   */
  readonly distance: number;
  /** Opponent's current damage percent (`0` = fresh stock). */
  readonly damagePercent: number;
  /** Coarse state label, see {@link OpponentStateLabel}. */
  readonly stateLabel: OpponentStateLabel;
  /** Convenience flag — true iff opponent is not on a platform. */
  readonly isAirborne: boolean;
  /**
   * Optional kinematic velocity (design pixels per fixed step).
   * Hard-tier predictive-movement and edge-guard branches consult this
   * to anticipate where the opponent will be `lookaheadFrames` from
   * now. Earlier sub-trees (Easy, Medium) populated only the position-
   * derived `distance`; the field is optional so legacy snapshots
   * continue to compile without bespoke adapters.
   *
   * Convention mirrors {@link
   * import('../perception/WorldSnapshot').PerceivedVelocity} — `vx`
   * positive = moving right, `vy` positive = falling.
   */
  readonly velocity?: { readonly vx: number; readonly vy: number };
  /**
   * Optional absolute world-space position (design pixels).
   *
   * Hard-tier edge-guard logic compares the opponent's *absolute*
   * position to the stage edges; the signed `distance` field is
   * relative to the bot and not sufficient on its own. Position is
   * optional for the same backward-compat reason as `velocity` —
   * Easy / Medium snapshots that don't enable edge-guard simply omit
   * it. When present, `position.x - selfPositionX === distance`
   * remains an invariant the projection helper enforces.
   */
  readonly position?: { readonly x: number; readonly y: number };
}

/**
 * What the offensive branches need to know about the bot itself.
 *
 * Mirrors the parts of the engine's `Character` state that gate
 * offensive intent. Kept narrow on purpose: leaves should never have
 * to peek into Phaser-bound state directly.
 */
export interface SelfSnapshot {
  /** Direction the bot is facing this frame. `1` = right, `-1` = left. */
  readonly facing: 1 | -1;
  /**
   * True iff the bot can press an attack this tick (not in startup,
   * active, recovery, or post-cooldown of a prior move). Computed by
   * the controller from `Character.getActiveAttack()` + cooldown
   * tracking; leaves treat it as opaque truth.
   */
  readonly canAttack: boolean;
  /** True iff the bot is currently airborne. */
  readonly isAirborne: boolean;
  /** Bot's own damage percent — informs decisions like "smash now to KO before I die". */
  readonly damagePercent: number;
}

// ---------------------------------------------------------------------------
// Combo state — Blackboard schema
// ---------------------------------------------------------------------------

/**
 * Identifier for the *grounded* attacks the offensive branches can
 * land. Subset of {@link OffensiveActionKind} — emit verbs include
 * movement and `idle`; combo state only tracks attacks because only
 * attacks can chain.
 */
export type AttackKind = 'jab' | 'tilt' | 'smash' | 'special';

/**
 * Phase of an in-flight combo. Drives the recognition logic in
 * {@link import('./comboRecognition').recognizeFollowUp}.
 *
 *   - `idle`         — no combo in progress; offensive branches operate
 *                      in neutral.
 *   - `jabConnected` — last successful hit was a jab; the bot may
 *                      follow up with a tilt (or a smash at high %).
 *   - `tiltConnected` — last successful hit was a tilt; the bot may
 *                      follow up with a smash if the opponent has KO
 *                      percent.
 *
 * Smash and special intentionally DO NOT register a combo stage:
 * smash already finishes the chain (its long recovery rules out a
 * follow-up), and the bot's "neutral special" is mostly a poke / zone
 * tool not a chain starter in the M2 cut. The recognition module
 * therefore sees `'idle'` after either one and falls back to neutral.
 */
export type ComboStage = 'idle' | 'jabConnected' | 'tiltConnected';

/**
 * Typed schema for the offensive sub-tree's Blackboard partition.
 *
 * Lives in the runner-owned {@link
 * import('../behaviorTree/Blackboard').Blackboard} alongside whatever
 * other namespaces the full controller declares (defensive,
 * recovery). Field names use the `combo` prefix so future namespaces
 * (e.g. `defenseLastShield…`) won't collide.
 *
 * Snapshot-friendliness — every field is a primitive (string,
 * number, or `null`) so the entire schema serialises cleanly through
 * `JSON.stringify` for the 300-frame replay snapshots without
 * bespoke adapters.
 */
export interface OffensiveBlackboardSchema {
  /** Current combo phase; see {@link ComboStage}. Defaults to `'idle'`. */
  comboStage: ComboStage;
  /** Last attack the bot *successfully landed*, or `null` if none. */
  comboLastLandedMove: AttackKind | null;
  /**
   * Tick on which the last hit landed. `-1` when no hit has been
   * recorded yet; cleared (back to `-1`) on combo timeout / interrupt.
   */
  comboLastLandedTick: number;
  /**
   * Opponent's damage percent at the moment the last hit landed.
   * Captured because the *follow-up choice* depends on this value
   * (see {@link import('./comboRecognition').recognizeFollowUp}); the
   * live `OpponentSnapshot.damagePercent` may have changed by the
   * time the bot ticks again with reaction-window latency.
   */
  comboLastLandedOpponentPercent: number;
  /**
   * Latched plan from the recognition leaf. Populated when a chain
   * opportunity is detected; consumed (and cleared) by the execution
   * leaf. `null` means "no follow-up planned this tick".
   */
  comboPlannedFollowUp: PlannedFollowUp | null;
}

/**
 * Forward-only declaration of a planned follow-up, mirroring the
 * shape produced by {@link
 * import('./comboRecognition').recognizeFollowUp}. Repeating the
 * shape here (instead of importing) keeps `types.ts` self-contained
 * and prevents an import cycle when `comboRecognition.ts` re-exports
 * back through `index.ts`.
 */
export interface PlannedFollowUp {
  /** Attack to press as the next combo step. */
  readonly nextAttack: AttackKind;
  /**
   * Frame budget the follow-up must fire within (counted from the
   * tick the previous hit landed). Past this window the combo is
   * considered dropped and recognition returns `null`.
   */
  readonly maxFollowUpFrames: number;
  /** Debug label, e.g. `'jab→tilt'`. */
  readonly comboStepId: string;
}

/**
 * Default seed for the offensive partition. Seed values reflect the
 * "no combo, no plan" starting condition. Pass to
 * {@link import('../behaviorTree/Blackboard').Blackboard}'s
 * constructor or as `BehaviorTreeOptions.initialBlackboard` so a
 * `reset()` returns the controller to a pristine state.
 */
export const DEFAULT_OFFENSIVE_BLACKBOARD: Readonly<OffensiveBlackboardSchema> =
  Object.freeze({
    comboStage: 'idle',
    comboLastLandedMove: null,
    comboLastLandedTick: -1,
    comboLastLandedOpponentPercent: 0,
    comboPlannedFollowUp: null,
  });

// ---------------------------------------------------------------------------
// Per-tick context
// ---------------------------------------------------------------------------

/**
 * Per-tick context threaded through every offensive leaf.
 *
 * Extends the conventional {@link BehaviorTreeContext} (blackboard +
 * tickIndex) with three offensive-specific properties:
 *
 *   - `opponent` — the *currently-targeted* opponent snapshot. May be
 *                  `null` when no opponent is alive (e.g. between
 *                  stocks); leaves treat `null` as "no offensive work
 *                  this tick" and return `Failure` so an enclosing
 *                  Selector can fall through.
 *   - `self`     — the bot's own snapshot, see {@link SelfSnapshot}.
 *   - `out`      — emit sink, see {@link ActionWriter}.
 *   - `rng`      — the controller's seeded Rng, used for deterministic
 *                  tie-breaking (e.g. choosing between two equally
 *                  valid follow-ups).
 *
 * All fields are `readonly` because leaves must not mutate the
 * snapshot in place — the controller rebuilds the context once per
 * tick.
 */
export interface OffensiveContext
  extends BehaviorTreeContext<OffensiveBlackboardSchema> {
  readonly opponent: OpponentSnapshot | null;
  readonly self: SelfSnapshot;
  readonly out: ActionWriter;
  readonly rng: Rng;
  /**
   * Optional bot world-space position (design pixels). When present
   * — typically populated by the controller from the same
   * {@link import('../perception/WorldSnapshot').WorldSnapshot} used
   * upstream — the Hard-tier edge-guard branch uses it together with
   * {@link OpponentSnapshot.position} and {@link OffensiveContext.stage}
   * to decide whether to commit to chasing an off-stage opponent.
   *
   * Optional because Easy / Medium tiers do not consult it; the
   * position-blind movement leaves continue to operate on the signed
   * `opponent.distance` only.
   */
  readonly selfPosition?: { readonly x: number; readonly y: number };
  /**
   * Optional stage-geometry slice. When present the Hard-tier
   * edge-guard branch reads stage edges + blast zones to score
   * off-stage threat. Optional so existing tier trees that never
   * touch stage state can continue to construct contexts without
   * stage data.
   */
  readonly stage?: PerceivedStage | null;
}
