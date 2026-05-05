/**
 * moveSelectionHeuristics — per-state move selection helpers
 * (AC 20202 Sub-AC 2).
 *
 * Once {@link import('./decisionPolicy').resolveDecisionState} has
 * picked the strategic state for the current tick, this module owns
 * the *tactical* question — which press(es) does that state actually
 * emit? The heuristics are deliberately small, named pure functions
 * (one per state) so:
 *
 *   • Tests can assert the per-state heuristic in isolation without
 *     spinning up the FSM.
 *   • Future tier authors can compose the heuristics differently
 *     (e.g. swap the `attack` heuristic for a per-character
 *     `attackHeuristicForCat()` while keeping the `defend` /
 *     `recover` / `retreat` / `approach` heuristics unchanged).
 *
 * All heuristics are deterministic on their inputs. The `defend`
 * heuristic consumes a single `rng.next()` per call to mix
 * shield / dodge with a configurable bias; every other heuristic
 * uses the context's pure data only.
 *
 * Move vocabulary
 * ---------------
 *
 * The heuristics emit verbs from {@link DecisionActionKind}. The
 * decision-layer translator (or the FSM's caller) is responsible
 * for folding the verbs into the engine's `CharacterInput` record;
 * the heuristics never reach into Phaser / Matter directly.
 *
 * Heuristic summary
 * -----------------
 *
 *   - **approach** — emit the directional movement verb pointing at
 *     the opponent. Falls back to `idle` when no opponent is alive
 *     (between stocks).
 *   - **attack** — pick the press that matches the current
 *     engagement zone and the opponent's KO percentage. Combines
 *     movement + attack on the same tick when the bot needs to
 *     close the last few pixels before swinging.
 *   - **defend** — `shield` by default; `dodge` on a configurable
 *     fraction of ticks (deterministic via `ctx.rng`). The mix is
 *     the canonical "blocks reliably and occasionally evades" Smash
 *     defensive pattern.
 *   - **recover** — emit `jump` while the bot still has air-jump
 *     budget; emit `upSpecial` when the bot is below the stage top
 *     or has burned its jumps. Combines a horizontal movement verb
 *     toward the stage centre so the bot drifts back as it climbs.
 *   - **retreat** — emit a directional movement verb *away* from the
 *     opponent (or away from the nearest blast wall when no
 *     opponent is in range — the survival-driven retreat case).
 *     `jump` is added when the bot needs vertical space to clear an
 *     incoming low attack.
 */

import {
  classifyEngagementZone,
  computeDistance,
  type EngagementZone,
} from '../perception/distanceEvaluation';
import type {
  PerceivedOpponent,
  PerceivedSelf,
  PerceivedStage,
} from '../perception/WorldSnapshot';

import {
  DEFAULT_DECISION_POLICY_OPTIONS,
  resolveDecisionPolicyOptions,
  type DecisionPolicyOptions,
  type ResolvedDecisionPolicyOptions,
} from './decisionPolicy';
import type { DecisionAction, DecisionContext, DecisionState } from './types';

// ---------------------------------------------------------------------------
// Per-state heuristic options
// ---------------------------------------------------------------------------

/**
 * Construction options for the move-selection heuristic dispatcher.
 * Every field is optional — omitted fields fall back to documented
 * defaults that match the FSM's "competent baseline" persona.
 */
export interface MoveSelectionOptions {
  /**
   * Probability in `[0, 1]` the `defend` heuristic emits `dodge`
   * instead of `shield` on a given tick. Default `0.20` — a 4:1
   * shield/dodge mix that reads as "blocks reliably and occasionally
   * evades", matching the Medium-tier defensive sub-tree's bias.
   */
  readonly dodgeChance?: number;
  /**
   * Engagement-zone-specific attack vocabulary the `attack` heuristic
   * uses. Defaults to {@link DEFAULT_ATTACK_VOCABULARY}. Override per
   * tier or per character to ship richer move selection (e.g. swap
   * `tilt` for `dashAttack` for a character with a strong dash
   * approach).
   */
  readonly attackVocabulary?: AttackVocabulary;
  /**
   * Forwarded to {@link resolveDecisionPolicyOptions} so the
   * heuristics share the same engagement radii / KO percent / off-
   * stage margin / blast-zone margin as the policy resolver. Pass a
   * partial object — defaults fill the rest in.
   */
  readonly policy?: DecisionPolicyOptions;
}

/**
 * Per-zone attack verbs consumed by the `attack` heuristic.
 *
 *   - `melee.lowPercent`  — bot's choice when in melee reach against
 *                            a low-% opponent. Default `'jab'`.
 *   - `melee.koPercent`   — when the opponent is at KO percent.
 *                            Default `'smash'` — the canonical
 *                            finisher.
 *   - `tilt`              — tilt-zone press. Default `'tilt'`.
 *   - `spaced`            — spaced-zone press. Default `'special'`
 *                            (projectile / zoning tool). Listed so a
 *                            tier that *doesn't* want spaced
 *                            heuristics can null it out and let the
 *                            attack heuristic fall through to
 *                            approach.
 *
 * Stored as a frozen plain object so `Object.freeze` consumers can
 * rely on identity equality.
 */
export interface AttackVocabulary {
  readonly meleeLowPercent: AttackVerb;
  readonly meleeKoPercent: AttackVerb;
  readonly tilt: AttackVerb | null;
  readonly spaced: AttackVerb | null;
}

/** Subset of {@link import('./types').DecisionActionKind} used as attack verbs. */
export type AttackVerb = 'jab' | 'tilt' | 'smash' | 'special';

/** Default attack vocabulary, frozen so accidental mutation surfaces. */
export const DEFAULT_ATTACK_VOCABULARY: AttackVocabulary = Object.freeze({
  meleeLowPercent: 'jab',
  meleeKoPercent: 'smash',
  tilt: 'tilt',
  spaced: 'special',
});

/**
 * Resolved options bag with defaults filled in. Returned by
 * {@link resolveMoveSelectionOptions} so debug overlays / tests can
 * inspect the effective tunables.
 */
export interface ResolvedMoveSelectionOptions {
  readonly dodgeChance: number;
  readonly attackVocabulary: AttackVocabulary;
  readonly policy: ResolvedDecisionPolicyOptions;
}

/** Default move selection options. */
export const DEFAULT_MOVE_SELECTION_OPTIONS: ResolvedMoveSelectionOptions =
  Object.freeze({
    dodgeChance: 0.2,
    attackVocabulary: DEFAULT_ATTACK_VOCABULARY,
    policy: DEFAULT_DECISION_POLICY_OPTIONS,
  });

/** Apply documented defaults to a partial {@link MoveSelectionOptions}. */
export function resolveMoveSelectionOptions(
  options: MoveSelectionOptions = {},
): ResolvedMoveSelectionOptions {
  const dodgeChance =
    options.dodgeChance ?? DEFAULT_MOVE_SELECTION_OPTIONS.dodgeChance;
  // Clamp to [0, 1] so a misconfigured tier can't push the dispatcher
  // into a probability-out-of-bounds branch.
  const clampedDodge = clampUnitInterval(dodgeChance);
  return {
    dodgeChance: clampedDodge,
    attackVocabulary:
      options.attackVocabulary ??
      DEFAULT_MOVE_SELECTION_OPTIONS.attackVocabulary,
    policy: resolveDecisionPolicyOptions(options.policy),
  };
}

// ---------------------------------------------------------------------------
// Per-state heuristics
// ---------------------------------------------------------------------------

/**
 * `approach` — walk toward the opponent. Emits a single movement verb
 * pointing at the opponent's signed horizontal direction. With no
 * opponent the heuristic emits `idle` — a debug-friendly explicit
 * "no decision this tick".
 */
export function selectApproachActions(
  ctx: DecisionContext,
): readonly DecisionAction[] {
  if (ctx.opponent === null) {
    return [{ kind: 'idle', state: 'approach', note: 'noOpponent' }];
  }
  const dx = ctx.opponent.position.x - ctx.self.position.x;
  if (dx === 0) {
    // Already perfectly aligned — emit idle so the bot doesn't twitch
    // left/right around a 0-dx cusp.
    return [{ kind: 'idle', state: 'approach', note: 'aligned' }];
  }
  return [
    {
      kind: dx > 0 ? 'moveRight' : 'moveLeft',
      state: 'approach',
      note: 'closeGap',
    },
  ];
}

/**
 * `attack` — pick a press based on the engagement zone and the
 * opponent's KO percentage.
 *
 *   • In `melee` reach with opponent < koPercent → `meleeLowPercent`
 *     (default `jab`).
 *   • In `melee` reach with opponent >= koPercent → `meleeKoPercent`
 *     (default `smash`) — capitalise on the finisher window.
 *   • In `tilt` reach → `tilt` (or whatever the vocabulary's `tilt`
 *     slot says). Combined with a forward movement verb so the bot
 *     drifts the last few pixels into reach as it presses.
 *   • In `spaced` reach → `spaced` (default `special`). This is the
 *     "pressure with a projectile from mid-range" branch.
 *   • Outside `spaced` (i.e. `far`) → walk toward instead. The
 *     decision policy normally pushes `attack` only inside `tilt`-
 *     or-closer; the spaced + far branches handle ticks where the
 *     opponent moved away between the resolver and this heuristic.
 */
export function selectAttackActions(
  ctx: DecisionContext,
  opts: ResolvedMoveSelectionOptions = DEFAULT_MOVE_SELECTION_OPTIONS,
): readonly DecisionAction[] {
  if (ctx.opponent === null) {
    return [{ kind: 'idle', state: 'attack', note: 'noOpponent' }];
  }

  const dx = ctx.opponent.position.x - ctx.self.position.x;
  const metrics = computeDistance(ctx.self.position, ctx.opponent.position);
  const zone = classifyEngagementZone(metrics.chebyshev, opts.policy.radii);
  const ko = ctx.opponent.damagePercent >= opts.policy.koPercent;

  switch (zone) {
    case 'melee': {
      const verb = ko
        ? opts.attackVocabulary.meleeKoPercent
        : opts.attackVocabulary.meleeLowPercent;
      const note = ko ? 'meleeKo' : 'meleeLow';
      // Pure attack — already in reach, no movement verb needed.
      return [{ kind: verb, state: 'attack', note }];
    }
    case 'tilt': {
      const verb = opts.attackVocabulary.tilt;
      if (verb === null) {
        // Vocabulary has no tilt-zone press → fall through to approach.
        return appendAttackMovementOnly(dx, 'attack', 'noTiltVerb');
      }
      // Combine the press with a forward movement verb so the bot
      // covers the last few pixels of tilt reach during the press.
      return [
        ...appendAttackMovementOnly(dx, 'attack', 'driftIntoTilt'),
        { kind: verb, state: 'attack', note: 'tiltZone' },
      ];
    }
    case 'spaced': {
      const verb = opts.attackVocabulary.spaced;
      if (verb === null) {
        return appendAttackMovementOnly(dx, 'attack', 'noSpacedVerb');
      }
      return [{ kind: verb, state: 'attack', note: 'spacedZone' }];
    }
    case 'far':
    default:
      // Opponent slipped out of reach between resolver and heuristic
      // — emit a movement verb so the bot keeps closing.
      return appendAttackMovementOnly(dx, 'attack', 'lostReach');
  }
}

/**
 * `defend` — block by default, dodge on a configurable fraction of
 * ticks. The mix is deterministic given the seeded `ctx.rng`; tests
 * that want a predictable verb construct the context with a seed
 * that lands the roll on the desired side.
 */
export function selectDefendActions(
  ctx: DecisionContext,
  opts: ResolvedMoveSelectionOptions = DEFAULT_MOVE_SELECTION_OPTIONS,
): readonly DecisionAction[] {
  const roll = ctx.rng.next();
  if (roll < opts.dodgeChance) {
    return [{ kind: 'dodge', state: 'defend', note: 'evade' }];
  }
  return [{ kind: 'shield', state: 'defend', note: 'block' }];
}

/**
 * `recover` — climb back to the stage. Combines a horizontal drift
 * toward the stage centre with the strongest available recovery
 * verb (jump → upSpecial). The dispatcher prefers `jump` when the
 * bot is still relatively high (above the stage top) and falls back
 * to `upSpecial` when the bot is below the platform — the canonical
 * "burn the up-special only when you really need it" policy.
 *
 * Returns at most two actions per tick: a movement verb (drift) and
 * a recovery press. The base controller's hold semantics ensure each
 * press is registered as a single rising edge.
 */
export function selectRecoverActions(
  ctx: DecisionContext,
  opts: ResolvedMoveSelectionOptions = DEFAULT_MOVE_SELECTION_OPTIONS,
): readonly DecisionAction[] {
  const stageCentreX = (ctx.stage.stageLeft + ctx.stage.stageRight) / 2;
  const dx = stageCentreX - ctx.self.position.x;
  const movement: DecisionAction | null =
    dx === 0
      ? null
      : {
          kind: dx > 0 ? 'moveRight' : 'moveLeft',
          state: 'recover',
          note: 'driftToStage',
        };

  // Choose recovery press by vertical position relative to the stage
  // top. Below the stage top → up-special (the only verb with a real
  // vertical climb); above → jump (cheaper resource, conserves the
  // up-special for a future recovery).
  const belowStage = ctx.self.position.y > ctx.stage.stageTop;
  const recoveryPress: DecisionAction = belowStage
    ? { kind: 'upSpecial', state: 'recover', note: 'belowStageTop' }
    : { kind: 'jump', state: 'recover', note: 'aboveStageTop' };

  // Reference `opts` so future callers can pass tier-specific recovery
  // tunables (e.g. a different "burn up-special" threshold) without
  // changing the function signature.
  void opts;

  return movement === null ? [recoveryPress] : [movement, recoveryPress];
}

/**
 * `retreat` — back away from the opponent (or from the nearest blast
 * wall when no opponent is in range). Adds a `jump` press when the
 * bot is at high damage AND the opponent is in melee reach: gaining
 * vertical space buys time to recover positioning.
 */
export function selectRetreatActions(
  ctx: DecisionContext,
  opts: ResolvedMoveSelectionOptions = DEFAULT_MOVE_SELECTION_OPTIONS,
): readonly DecisionAction[] {
  // Compute the away-from-threat direction. Two sources of pressure:
  //
  //   1. Opponent in attack range → move away from opponent.
  //   2. Bot near a blast wall → move away from that wall.
  //
  // When both apply the wall-avoidance vector takes precedence
  // because a blast-wall KO is more severe than an exchange.
  const wallDir = nearestBlastWallEscapeDir(ctx.self, ctx.stage);
  let direction: -1 | 1 | 0 = 0;
  let note: string;

  if (wallDir !== 0) {
    direction = wallDir;
    note = 'awayFromBlastWall';
  } else if (ctx.opponent !== null) {
    const dx = ctx.opponent.position.x - ctx.self.position.x;
    direction = dx > 0 ? -1 : dx < 0 ? 1 : 0;
    note = 'awayFromOpponent';
  } else {
    note = 'noPressure';
  }

  const actions: DecisionAction[] = [];
  if (direction === 0) {
    actions.push({ kind: 'idle', state: 'retreat', note });
  } else {
    actions.push({
      kind: direction > 0 ? 'moveRight' : 'moveLeft',
      state: 'retreat',
      note,
    });
  }

  // Layered jump: high % bot in melee with opponent → take to the air.
  if (
    ctx.opponent !== null &&
    ctx.self.damagePercent >= opts.policy.retreatDamageThreshold
  ) {
    const metrics = computeDistance(ctx.self.position, ctx.opponent.position);
    const zone = classifyEngagementZone(metrics.chebyshev, opts.policy.radii);
    if (zone === 'melee') {
      actions.push({ kind: 'jump', state: 'retreat', note: 'verticalEscape' });
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Dispatcher — pick the right heuristic for a given state
// ---------------------------------------------------------------------------

/**
 * Dispatch to the per-state heuristic, returning the action(s) the
 * FSM should emit on this tick.
 *
 * Pure on its inputs (modulo `defend`'s single `rng.next()`); same
 * `(state, ctx, opts)` always produces the same result.
 */
export function selectActionsForState(
  state: DecisionState,
  ctx: DecisionContext,
  opts: ResolvedMoveSelectionOptions = DEFAULT_MOVE_SELECTION_OPTIONS,
): readonly DecisionAction[] {
  switch (state) {
    case 'approach':
      return selectApproachActions(ctx);
    case 'attack':
      return selectAttackActions(ctx, opts);
    case 'defend':
      return selectDefendActions(ctx, opts);
    case 'recover':
      return selectRecoverActions(ctx, opts);
    case 'retreat':
      return selectRetreatActions(ctx, opts);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function appendAttackMovementOnly(
  dx: number,
  state: DecisionState,
  note: string,
): readonly DecisionAction[] {
  if (dx === 0) return [{ kind: 'idle', state, note: `${note}.aligned` }];
  return [
    {
      kind: dx > 0 ? 'moveRight' : 'moveLeft',
      state,
      note,
    },
  ];
}

/**
 * Returns the direction the bot should travel to escape the nearest
 * blast wall (when within the configured margin), or `0` when no wall
 * is close enough to influence retreat.
 *
 * Horizontal walls (left / right blast zone) are handled directly.
 * Vertical walls (top / bottom) influence horizontal retreat
 * indirectly: the bot can't outrun the top blast zone horizontally,
 * so this helper reports `0` for vertical proximity and lets the
 * vertical jump-escape branch in {@link selectRetreatActions} kick
 * in via the high-% gate.
 */
function nearestBlastWallEscapeDir(
  self: PerceivedSelf,
  stage: PerceivedStage,
): -1 | 0 | 1 {
  const margin = DEFAULT_DECISION_POLICY_OPTIONS.retreatBlastZoneMarginPx;
  const distLeft = self.position.x - stage.blastZone.left;
  const distRight = stage.blastZone.right - self.position.x;
  if (distLeft <= margin && distLeft <= distRight) {
    return 1; // move right, away from the left wall
  }
  if (distRight <= margin) {
    return -1; // move left, away from the right wall
  }
  return 0;
}

function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// Re-export EngagementZone so consumers using the heuristic without
// importing from perception can still reason about zone names.
export type { EngagementZone };
// Re-export PerceivedOpponent so test helpers in consuming modules
// don't need a separate import.
export type { PerceivedOpponent };
