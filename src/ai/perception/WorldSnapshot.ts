/**
 * WorldSnapshot — the per-tick perception record consumed by every AI
 * difficulty tier (AC 10202 Sub-AC 2).
 *
 * Why this module exists
 * ----------------------
 *
 * The behavior-tree leaves authored in AC 18 (offensive + recovery)
 * each consume a *narrow* snapshot tailored to their concern:
 *
 *   • {@link import('../offensive/types').OpponentSnapshot} — distance,
 *     damage %, coarse state — only the parts of the opponent the
 *     grounded combo logic needs.
 *   • {@link import('../recovery/types').RecoveryStageGeometry} —
 *     ledges, blast zones, stage edges — only the parts of the world
 *     the off-stage recovery logic needs.
 *
 * Both shapes are correct for their sub-tree but neither is sufficient
 * on its own for the *upstream* perception step: choosing **which
 * opponent to target** (target selection) and **how dangerous each
 * opponent is right now** (threat evaluation). Those decisions sit
 * above the offensive / recovery split — they are made once per tick,
 * by every difficulty tier, before any tier-specific sub-tree fires.
 *
 * `WorldSnapshot` is the unified, tier-agnostic record those decisions
 * read off of. It carries:
 *
 *   • The bot's own perceived state (`SelfState`).
 *   • Every *currently-alive* opponent on the field, as a
 *     {@link PerceivedOpponent} list keyed by slot index.
 *   • Stage geometry (edges, blast zones, lowest platform) so threat
 *     scoring can weight "off-stage" risk and target selection can
 *     prefer an opponent the bot can actually reach.
 *   • The current simulation tick — the same `tickIndex` the
 *     {@link BehaviorTreeContext} carries so cooldowns / phase timers
 *     stay coherent across the perception → decision → action chain.
 *
 * What this module deliberately is NOT
 * -------------------------------------
 *
 *   • A scene observer. The match scene builds the snapshot from live
 *     `Character` / stage state once per fixed step and hands it to
 *     each AI provider; this module never reads Phaser / Matter.
 *
 *   • A reaction window. Bots wanting human-like latency feed event
 *     observations through {@link ReactionWindow} *before* the
 *     controller folds them into a `WorldSnapshot`. Snapshots are the
 *     bot's *current best perception*, already reaction-delayed where
 *     needed.
 *
 *   • A behavior-tree adapter. The behavior tree's tier-specific
 *     contexts ({@link
 *     import('../offensive/types').OffensiveContext},
 *     {@link import('../recovery/types').RecoveryContext}) continue
 *     to exist; the controller derives them from the unified snapshot
 *     via per-tier projection helpers (this module declares the
 *     {@link projectOpponentSnapshot} helper as one such projection).
 *
 * Determinism contract
 * --------------------
 *
 * Every field is `readonly`. Snapshots are immutable plain data so
 * they:
 *
 *   • Round-trip cleanly through the 300-frame replay snapshot
 *     pipeline without bespoke adapters.
 *   • Are safe to retain across ticks for "previous-frame" reasoning
 *     (a bot wanting to detect "opponent dashed at me" can stash last
 *     frame's `WorldSnapshot`).
 *   • Cannot be mutated by a leaf — every consumer treats them as
 *     true read-only.
 *
 * No Phaser / Matter imports — perception types must be unit-testable
 * with plain object literals.
 */

import type { OpponentSnapshot, OpponentStateLabel } from '../offensive/types';
import type { PlayerSlotIndex } from '../../input/InputProvider';
import {
  type PerceivedHazard,
  sortPerceivedHazards,
  validatePerceivedHazard,
} from './hazardPerception';

// ---------------------------------------------------------------------------
// Self perception
// ---------------------------------------------------------------------------

/**
 * 2D point in design pixels (Matter centre-of-mass coordinates).
 *
 * Reused for self position, opponent position, and spawn / ledge
 * markers. Y grows down (Phaser/Matter convention) — a higher `y`
 * value means lower on screen.
 */
export interface PerceivedPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * 2D vector in design pixels per fixed step. Same axis convention as
 * {@link PerceivedPoint} — positive `vy` means falling.
 */
export interface PerceivedVelocity {
  readonly vx: number;
  readonly vy: number;
}

/**
 * The bot's own perception of itself.
 *
 *   • `slotIndex` — the bot's match slot (0..3). Lets target selection
 *     skip self when iterating the opponent list.
 *   • `position` / `velocity` — kinematic state. Position drives
 *     distance metrics; velocity drives threat lookahead.
 *   • `facing` — `1` = right, `-1` = left. Used by tier-specific
 *     projections that need a signed distance.
 *   • `damagePercent` — the bot's own damage. Threat scoring weights
 *     this when the bot is near KO percent (it should value avoiding
 *     the opponent's smashes more highly).
 *   • `stocksRemaining` — surviving stock count. `0` means the bot
 *     has already lost; the controller short-circuits decision logic
 *     in that case.
 *   • `isAirborne` / `isInHitstun` — coarse state flags useful for
 *     both target selection (don't switch targets mid-hitstun) and
 *     threat scoring (a tumbling bot can't capitalise on a finisher).
 *   • `isOnLedge` — true while clinging to a stage edge.
 *   • `currentMove` — optional snapshot of the bot's *own* in-progress
 *     move (AC 10201 Sub-AC 1 — perception of "current move state").
 *     `kind` is the move identifier (`'jab'`, `'fair'`, `'upSpecial'`,
 *     …); `phase` is the lifecycle stage (`'startup' | 'active' |
 *     'recovery'`). The controller populates this from
 *     `Character.getActiveAttack()` when a move is committed and sets
 *     it to `null` while the bot is in neutral. Subclasses use it to
 *     gate "can I cancel into a follow-up" decisions without re-reading
 *     simulation state. Optional so legacy snapshots and tests with
 *     stub selves still satisfy the type without bespoke fields.
 */
export interface PerceivedSelf {
  readonly slotIndex: PlayerSlotIndex;
  readonly position: PerceivedPoint;
  readonly velocity: PerceivedVelocity;
  readonly facing: 1 | -1;
  readonly damagePercent: number;
  readonly stocksRemaining: number;
  readonly isAirborne: boolean;
  readonly isInHitstun: boolean;
  readonly isOnLedge: boolean;
  readonly currentMove?: PerceivedMoveState | null;
}

/**
 * Lifecycle phase of an in-progress move. Mirrors the
 * `move.startupFrames / activeFrames / recoveryFrames` schema declared
 * in the move data tables (AC 7) — the perception layer collapses the
 * frame counter into the three named buckets so AI decision logic can
 * read "am I still in startup?" without doing the arithmetic itself.
 *
 *   - `startup`  — windup frames before any hitbox is live. The bot
 *                  cannot cancel out of this without a special move.
 *   - `active`   — hitbox-active frames. The move *will* connect if it
 *                  reaches the opponent's hurtbox this window.
 *   - `recovery` — recovery / cooldown frames. The bot is committed to
 *                  the move's tail; another input is generally rejected
 *                  until the recovery counter elapses.
 */
export type PerceivedMovePhase = 'startup' | 'active' | 'recovery';

/**
 * Self's currently-executing move, surfaced in {@link PerceivedSelf} so
 * decision logic can read its own move state (AC 10201 Sub-AC 1).
 *
 *   - `kind`              — move identifier matching the moveset table
 *                           (free-form string so future characters can
 *                           introduce custom move names without
 *                           churning this type).
 *   - `phase`             — current lifecycle phase, see
 *                           {@link PerceivedMovePhase}.
 *   - `framesRemaining`   — fixed-step frames left in the current
 *                           phase. `0` means the phase ends this tick
 *                           (the next sample will report the next
 *                           phase, or `null` if the move ended).
 */
export interface PerceivedMoveState {
  readonly kind: string;
  readonly phase: PerceivedMovePhase;
  readonly framesRemaining: number;
}

// ---------------------------------------------------------------------------
// Opponent perception
// ---------------------------------------------------------------------------

/**
 * Reuses the offensive sub-tree's {@link OpponentStateLabel} so a
 * `WorldSnapshot` and the {@link OpponentSnapshot} a leaf consumes
 * agree on the state vocabulary. Re-exported here so importers don't
 * have to reach into the offensive module for the type.
 */
export type PerceivedOpponentStateLabel = OpponentStateLabel;

/**
 * Single opponent the bot is aware of this tick.
 *
 * The `WorldSnapshot` carries a list of these — one per non-self
 * fighter that is *currently alive on the field*. KO'd opponents
 * waiting to respawn are omitted (their snapshot is reintroduced once
 * they spawn back in). Off-screen opponents are still included
 * because the AI must continue to anticipate their return.
 *
 *   • `slotIndex`     — stable identity (0..3). The string `id` in
 *                       {@link OpponentSnapshot} is derived from this
 *                       at projection time.
 *   • `position`      — world-space centre of mass.
 *   • `velocity`      — current velocity, used by the predictive part
 *                       of threat scoring (an opponent dashing at us
 *                       is more threatening than one walking away).
 *   • `facing`        — direction the opponent is facing. Affects
 *                       threat: an opponent facing the bot can launch
 *                       a smash; one facing away cannot without
 *                       turning first.
 *   • `damagePercent` — current damage. Lower = harder to KO (smash
 *                       is less rewarding); higher = priority target.
 *   • `stocksRemaining` — survival stock count. Targeting prefers
 *                       opponents on their last stock when scores
 *                       are otherwise tied.
 *   • `stateLabel`    — coarse {@link OpponentStateLabel}. Threat
 *                       scoring boosts when `'attacking'` and damps
 *                       when `'hitstun'` / `'recovering'`.
 *   • `isAirborne`    — convenience flag.
 *   • `isInvincible`  — true during respawn i-frames or active dodge
 *                       i-frames; targeting *deprioritises* invincible
 *                       opponents because attacks won't connect.
 */
export interface PerceivedOpponent {
  readonly slotIndex: PlayerSlotIndex;
  readonly position: PerceivedPoint;
  readonly velocity: PerceivedVelocity;
  readonly facing: 1 | -1;
  readonly damagePercent: number;
  readonly stocksRemaining: number;
  readonly stateLabel: PerceivedOpponentStateLabel;
  readonly isAirborne: boolean;
  readonly isInvincible: boolean;
}

// ---------------------------------------------------------------------------
// Stage perception
// ---------------------------------------------------------------------------

/**
 * Slice of stage geometry every tier consults.
 *
 * Mirrors the recovery sub-tree's
 * {@link import('../recovery/types').RecoveryStageGeometry} shape but
 * is intentionally a *copy* rather than an import so the recovery
 * module can drift its own fields independently and threat scoring
 * doesn't accidentally depend on recovery-only additions.
 *
 *   • `stageLeft` / `stageRight` — safe-edge X coordinates of the
 *     main stage. An opponent X outside this band is "off-stage"
 *     from the targeting layer's perspective.
 *   • `stageTop`                 — Y of the main stage's top
 *     surface (Y grows down — opponents below the stage have
 *     `position.y > stageTop`).
 *   • `blastZone`                — KO walls. Distance from a wall
 *     contributes to threat (a bot two pixels from a blast wall is
 *     in mortal danger).
 */
export interface PerceivedStage {
  readonly stageLeft: number;
  readonly stageRight: number;
  readonly stageTop: number;
  readonly blastZone: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
}

// ---------------------------------------------------------------------------
// WorldSnapshot — the unified record
// ---------------------------------------------------------------------------

/**
 * Per-tick perception record handed to every AI difficulty tier.
 *
 * Exactly one snapshot is produced per fixed step *per bot*. The
 * controller may share a snapshot across multiple bots only when
 * they are perceiving the same world from the same vantage (i.e.
 * before per-bot reaction-window delays are applied) — in production,
 * each bot owns its own snapshot stream so per-bot perception jitter
 * can diverge.
 *
 *   • `tickIndex`  — the fixed-step frame counter. Identical to the
 *                    {@link BehaviorTreeContext.tickIndex} the
 *                    behavior tree consumes — the controller forwards
 *                    the same value into both contexts so cooldown
 *                    bookkeeping aligns.
 *   • `self`       — the bot's own perceived state.
 *   • `opponents`  — every currently-alive non-self fighter, in
 *                    deterministic slot-index order so iterations
 *                    produce stable target selection regardless of
 *                    insertion order.
 *   • `stage`      — stage geometry slice.
 *   • `hazards`    — every observable stage hazard (AC 20201 Sub-AC 1
 *                    — "perception of game state: distances, player
 *                    positions, **hazards**"). Optional in the *draft*
 *                    handed to {@link buildWorldSnapshot} so existing
 *                    callers that don't yet observe hazards keep
 *                    working unchanged; the build step always
 *                    normalises the field to a (possibly empty)
 *                    deterministic-order array on the returned
 *                    snapshot, so consumers can rely on
 *                    `snapshot.hazards` being defined when reading
 *                    from the result of `buildWorldSnapshot`.
 */
export interface WorldSnapshot {
  readonly tickIndex: number;
  readonly self: PerceivedSelf;
  readonly opponents: ReadonlyArray<PerceivedOpponent>;
  readonly stage: PerceivedStage;
  readonly hazards?: ReadonlyArray<PerceivedHazard>;
}

// ---------------------------------------------------------------------------
// Construction helper — validates invariants once per tick
// ---------------------------------------------------------------------------

/**
 * Construct a {@link WorldSnapshot} with invariant checks.
 *
 * Validates:
 *
 *   1. `tickIndex` is a non-negative integer.
 *   2. The opponent list contains no duplicates by `slotIndex`.
 *   3. None of the opponents shares the bot's own `slotIndex` (a self
 *      target would silently break target selection).
 *   4. `stageLeft <= stageRight` and the blast-zone box contains the
 *      stage box (`bzLeft <= stageLeft`, `bzRight >= stageRight`,
 *      `bzTop <= stageTop`, `bzBottom >= stageTop`).
 *
 * Validation runs once per tick — the cost is dominated by the loop
 * over (at most 3) opponents, well within budget for a 60Hz tick.
 *
 * Returns the supplied draft *with the opponents array re-sorted by
 * slot index* so iteration order is deterministic regardless of how
 * the controller assembled the list.
 *
 * Throws on any invariant violation so a corrupted snapshot fails
 * loudly during development rather than producing silent target-
 * selection drift.
 */
export function buildWorldSnapshot(draft: WorldSnapshot): WorldSnapshot {
  const { tickIndex, self, opponents, stage, hazards } = draft;

  if (
    typeof tickIndex !== 'number' ||
    !Number.isInteger(tickIndex) ||
    tickIndex < 0
  ) {
    throw new Error(
      `WorldSnapshot: tickIndex must be a non-negative integer, got ${String(
        tickIndex,
      )}`,
    );
  }

  // Stage well-formedness.
  if (stage.stageLeft > stage.stageRight) {
    throw new Error(
      `WorldSnapshot: stage.stageLeft (${stage.stageLeft}) must be <= ` +
        `stage.stageRight (${stage.stageRight})`,
    );
  }
  const bz = stage.blastZone;
  if (
    bz.left > stage.stageLeft ||
    bz.right < stage.stageRight ||
    bz.top > stage.stageTop ||
    bz.bottom < stage.stageTop
  ) {
    throw new Error(
      'WorldSnapshot: blast zone must enclose the stage box',
    );
  }

  // Opponent uniqueness + self exclusion.
  const seenSlots = new Set<PlayerSlotIndex>();
  for (const opp of opponents) {
    if (opp.slotIndex === self.slotIndex) {
      throw new Error(
        `WorldSnapshot: opponent at slot ${opp.slotIndex} matches self`,
      );
    }
    if (seenSlots.has(opp.slotIndex)) {
      throw new Error(
        `WorldSnapshot: duplicate opponent slot ${opp.slotIndex}`,
      );
    }
    seenSlots.add(opp.slotIndex);
  }

  // Sort opponents by slot index for stable iteration.
  const sortedOpponents = opponents
    .slice()
    .sort((a, b) => a.slotIndex - b.slotIndex);

  // Hazards (AC 20201 Sub-AC 1) — validate, then drop into
  // deterministic order so threat scoring / target selection
  // tie-breaks reproduce in replay regardless of how the controller
  // assembled the list.
  let normalizedHazards: ReadonlyArray<PerceivedHazard>;
  if (hazards === undefined || hazards.length === 0) {
    normalizedHazards = EMPTY_HAZARDS;
  } else {
    const seenIds = new Set<string>();
    for (const h of hazards) {
      validatePerceivedHazard(h);
      if (seenIds.has(h.id)) {
        throw new Error(
          `WorldSnapshot: duplicate hazard id ${JSON.stringify(h.id)}`,
        );
      }
      seenIds.add(h.id);
    }
    normalizedHazards = sortPerceivedHazards(hazards);
  }

  return {
    tickIndex,
    self,
    opponents: sortedOpponents,
    stage,
    hazards: normalizedHazards,
  };
}

/**
 * Frozen empty-array singleton so `buildWorldSnapshot` can return a
 * snapshot with a defined `hazards` field for hazard-free drafts
 * without allocating a new array per tick. Callers must not mutate.
 */
const EMPTY_HAZARDS: ReadonlyArray<PerceivedHazard> = Object.freeze([]);

// ---------------------------------------------------------------------------
// Projection helpers — narrow the snapshot down to a tier-specific shape
// ---------------------------------------------------------------------------

/**
 * Build the offensive sub-tree's narrower {@link OpponentSnapshot}
 * record from a {@link PerceivedOpponent} relative to a self position.
 *
 * The offensive snapshot uses *signed horizontal distance* (positive
 * = opponent to the right of the bot) which differs from the world
 * snapshot's absolute `position`. This helper bakes the conversion
 * so leaves never have to compute it themselves.
 *
 * Pure function — no allocation outside the returned object.
 */
export function projectOpponentSnapshot(
  selfPosition: PerceivedPoint,
  opponent: PerceivedOpponent,
): OpponentSnapshot {
  return {
    id: String(opponent.slotIndex),
    distance: opponent.position.x - selfPosition.x,
    damagePercent: opponent.damagePercent,
    stateLabel: opponent.stateLabel,
    isAirborne: opponent.isAirborne,
    // Forward absolute kinematic data so Hard-tier predictive /
    // edge-guard branches can read it without a second projection
    // pass. Easy / Medium tiers ignore these optional fields, so
    // populating them here is free for tiers that don't care.
    velocity: { vx: opponent.velocity.vx, vy: opponent.velocity.vy },
    position: { x: opponent.position.x, y: opponent.position.y },
  };
}

/**
 * Look up an opponent in the snapshot by slot index. Returns `null`
 * when the slot is the bot itself or no longer alive (filtered out
 * upstream by the controller).
 *
 * O(n) over `opponents.length` (n ≤ 3 in a 4-player match), no
 * allocation.
 */
export function findOpponentBySlot(
  snapshot: WorldSnapshot,
  slotIndex: PlayerSlotIndex,
): PerceivedOpponent | null {
  for (const opp of snapshot.opponents) {
    if (opp.slotIndex === slotIndex) return opp;
  }
  return null;
}
