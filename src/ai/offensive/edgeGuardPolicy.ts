/**
 * Edge-guard policy — pure helpers used by the Hard-tier
 * {@link import('./EdgeGuardLeaf').EdgeGuardLeaf}.
 *
 * What edge-guarding is
 * ---------------------
 *
 * "Edge-guarding" is the offensive technique of attacking an opponent
 * who has been knocked off the stage and is trying to recover. It is
 * the canonical Hard-tier punish: a competent human reads the
 * opponent's recovery angle, drops to the ledge, and either lands a
 * hit on the way back up (preventing the recovery) or commits a smash
 * to KO at low percent.
 *
 * The Hard-tier AI authored in {@link
 * import('./HardOffensiveTree').buildHardOffensiveTree} prior to this
 * sub-AC focuses on grounded combo execution. It will *neutral-jab*
 * an off-stage opponent if the opponent happens to be close enough,
 * but it has no notion of "the opponent is recovering — pursue the
 * ledge". This module supplies the predicate / decision helpers a
 * dedicated edge-guard branch needs.
 *
 * Helpers in this module
 * ----------------------
 *
 *   - {@link isOpponentOffStage} — pure predicate. Reads the opponent's
 *     absolute position against the stage bounds.
 *   - {@link nearestStageEdge} — pick `'left'` / `'right'` based on
 *     which edge the opponent is closer to.
 *   - {@link edgeGuardAnchorX} — the X coordinate the bot should walk
 *     toward when committing to an edge guard.
 *   - {@link shouldCommitEdgeGuard} — top-level "is now a good time to
 *     edge-guard" predicate combining stage geometry, opponent state,
 *     and a Hard-tier-tuned threat band.
 *   - {@link chooseEdgeGuardAttack} — pick the attack verb (`smash` or
 *     `special`) appropriate to the opponent's position relative to
 *     the ledge.
 *
 * Determinism contract
 * --------------------
 *
 * Every helper is a pure function of its inputs — no `Math.random`,
 * no wall-clock reads, no allocation beyond the small records
 * returned by the picker helpers. Identical inputs always produce
 * identical outputs, so the replay system can reconstruct the
 * Hard-tier edge-guard decisions verbatim.
 */

import type { PerceivedStage } from '../perception/WorldSnapshot';
import type { AttackKind, OpponentSnapshot } from './types';

// ---------------------------------------------------------------------------
// Tunables — exported so consumers / tests can introspect / override
// ---------------------------------------------------------------------------

/**
 * How far past the stage edge the opponent must be (design pixels)
 * before the edge-guard branch fires. Slack of 1 px stops the guard
 * from triggering on floating-point fuzz around the corner.
 */
export const DEFAULT_OFFSTAGE_HORIZONTAL_SLACK_PX = 1;

/**
 * Vertical slack below the stage top before the opponent counts as
 * "off-stage low". A few pixels of slack covers the case where an
 * opponent is hanging off the ledge and the controller hasn't yet
 * latched their `isOnLedge` flag.
 */
export const DEFAULT_OFFSTAGE_VERTICAL_SLACK_PX = 4;

/**
 * Horizontal distance from the stage edge inside which the bot is
 * considered "anchored at the ledge" and ready to throw the edge-
 * guard attack. The default of 16 px is roughly half the bot's body
 * width — past that the bot risks walking off the stage itself.
 */
export const DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX = 16;

/**
 * Maximum vertical separation (design pixels) at which a smash is
 * considered an effective edge-guard option. Beyond this the
 * opponent is too low for the smash hitbox; the leaf either falls
 * back to a special (projectile) or returns Failure to let the bot
 * walk back to neutral.
 */
export const DEFAULT_SMASH_VERTICAL_REACH_PX = 80;

// ---------------------------------------------------------------------------
// Off-stage classification
// ---------------------------------------------------------------------------

/**
 * Pure predicate: is the opponent currently *off-stage* and therefore
 * a valid edge-guard target?
 *
 * Off-stage means:
 *   - Opponent has a known absolute position; legacy snapshots that
 *     ship only `distance` cannot be classified, so this returns
 *     `false` in that case.
 *   - Opponent is airborne (`isAirborne === true`).
 *   - Opponent's X is outside `[stageLeft - slackX, stageRight + slackX]`,
 *     OR opponent's Y is below `stageTop + slackY` (Y grows down).
 *
 * The horizontal+vertical OR is intentional: a recovery hugging the
 * vertical wall under the stage (like the Owl character's wall-jump
 * loop) is off-stage even though its X is within the safe band.
 */
export function isOpponentOffStage(
  opponent: OpponentSnapshot,
  stage: PerceivedStage,
  options: {
    horizontalSlackPx?: number;
    verticalSlackPx?: number;
  } = {},
): boolean {
  const pos = opponent.position;
  if (!pos) return false;
  if (!opponent.isAirborne) return false;
  const slackX = options.horizontalSlackPx ?? DEFAULT_OFFSTAGE_HORIZONTAL_SLACK_PX;
  const slackY = options.verticalSlackPx ?? DEFAULT_OFFSTAGE_VERTICAL_SLACK_PX;
  if (pos.x < stage.stageLeft - slackX) return true;
  if (pos.x > stage.stageRight + slackX) return true;
  if (pos.y > stage.stageTop + slackY) return true;
  return false;
}

/**
 * Pick the side of the stage the opponent is recovering toward.
 *
 * Returns `'left'` when the opponent's X is at or below the stage
 * midpoint, `'right'` otherwise. When the opponent is exactly at the
 * midpoint we deterministically pick `'left'` — coin flips would
 * leak non-determinism into the decision pipeline.
 */
export function nearestStageEdge(
  opponentX: number,
  stage: PerceivedStage,
): 'left' | 'right' {
  const mid = (stage.stageLeft + stage.stageRight) / 2;
  return opponentX <= mid ? 'left' : 'right';
}

/**
 * The X coordinate the bot should walk toward when committing to an
 * edge guard. This is the *interior* of the matching ledge corner,
 * pulled inward by `tolerancePx` so the bot doesn't accidentally
 * walk off the stage while pursuing.
 */
export function edgeGuardAnchorX(
  side: 'left' | 'right',
  stage: PerceivedStage,
  tolerancePx: number = DEFAULT_LEDGE_ANCHOR_TOLERANCE_PX,
): number {
  return side === 'left'
    ? stage.stageLeft + tolerancePx
    : stage.stageRight - tolerancePx;
}

// ---------------------------------------------------------------------------
// Top-level commit predicate + attack picker
// ---------------------------------------------------------------------------

/**
 * Inputs to {@link shouldCommitEdgeGuard}. Bundling them into a record
 * lets call sites name the fields and keeps the signature legible.
 */
export interface EdgeGuardCommitInput {
  readonly opponent: OpponentSnapshot;
  readonly selfX: number;
  readonly selfIsAirborne: boolean;
  readonly stage: PerceivedStage;
  readonly horizontalSlackPx?: number;
  readonly verticalSlackPx?: number;
}

/**
 * Top-level predicate: should the Hard-tier bot commit to edge-
 * guarding right now?
 *
 * Commits when ALL of:
 *   1. The opponent is off-stage per {@link isOpponentOffStage}.
 *   2. The bot is *on stage* (not airborne — committing while
 *      airborne risks the bot SD'ing alongside the opponent).
 *   3. The bot is closer to the threatened ledge than the opponent
 *      is (so the bot can actually arrive in time to set up).
 *
 * Returns `false` if any condition fails — including missing
 * positional data on the snapshot.
 */
export function shouldCommitEdgeGuard(input: EdgeGuardCommitInput): boolean {
  const { opponent, selfX, selfIsAirborne, stage } = input;
  if (selfIsAirborne) return false;
  if (
    !isOpponentOffStage(opponent, stage, {
      horizontalSlackPx: input.horizontalSlackPx,
      verticalSlackPx: input.verticalSlackPx,
    })
  ) {
    return false;
  }
  const oppPos = opponent.position;
  if (!oppPos) return false;

  const side = nearestStageEdge(oppPos.x, stage);
  const anchor = edgeGuardAnchorX(side, stage);

  // The bot is already inside the safe horizontal band (precondition
  // of "not airborne" + a well-formed stage), so distance to the anchor
  // measures "how far along the stage the bot must walk to reach the
  // ledge". The opponent's distance is the absolute gap from their
  // current X to the stage edge they're trying to grab.
  const ledgeX = side === 'left' ? stage.stageLeft : stage.stageRight;
  const botDistanceToAnchor = Math.abs(anchor - selfX);
  const opponentDistanceToLedge = Math.abs(ledgeX - oppPos.x);

  // Allow the bot to commit when it can reach the anchor before the
  // opponent reaches the ledge by a reasonable factor. The 2× factor
  // is the rule-of-thumb that a competent human follows: even if the
  // opponent is quite close to the ledge, the bot's grounded run
  // typically outpaces an off-stage opponent's vertical climb because
  // the opponent must also recover height.
  return botDistanceToAnchor <= opponentDistanceToLedge * 2;
}

/**
 * Choice produced by {@link chooseEdgeGuardAttack}.
 *
 *   - `kind`         — the attack verb to press (`'smash'` or
 *                      `'special'`); `null` when no attack is
 *                      currently appropriate (opponent too far below
 *                      the ledge for the smash hitbox AND no special
 *                      reach configured).
 *   - `comboStepId`  — debug label tagged onto the emit so replay
 *                      overlays can render the chosen edge-guard step.
 */
export interface EdgeGuardAttackChoice {
  readonly kind: AttackKind | null;
  readonly comboStepId: string;
}

/**
 * Pick the attack verb most appropriate to the opponent's position
 * relative to the ledge.
 *
 * Heuristic:
 *   - Opponent within `smashVerticalReachPx` of the stage top → smash.
 *     Smash KOs an opponent at low % when they're trying to recover
 *     to the ledge; this is the canonical edge-guard finisher.
 *   - Opponent below the smash band → special (assumed to be a
 *     projectile or descending move). The leaf's caller decides
 *     whether the character's special kit supports an off-stage
 *     poke; when it doesn't, the caller can omit `enableSpecial` and
 *     this returns `null`.
 */
export function chooseEdgeGuardAttack(
  opponentY: number,
  stageTop: number,
  options: {
    smashVerticalReachPx?: number;
    enableSpecial?: boolean;
  } = {},
): EdgeGuardAttackChoice {
  const reach = options.smashVerticalReachPx ?? DEFAULT_SMASH_VERTICAL_REACH_PX;
  const verticalGap = opponentY - stageTop; // positive = opponent below stage
  if (verticalGap <= reach) {
    return { kind: 'smash', comboStepId: 'edgeGuard.smash' };
  }
  if (options.enableSpecial !== false) {
    return { kind: 'special', comboStepId: 'edgeGuard.special' };
  }
  return { kind: null, comboStepId: 'edgeGuard.none' };
}
