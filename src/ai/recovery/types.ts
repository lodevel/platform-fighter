/**
 * Recovery primitives — shared types for the Hard-tier *recovery*
 * behavior-tree branches authored in AC 18 Sub-AC 4.
 *
 * Recovery is the "I just got knocked off the stage, get me back"
 * problem. It is a separate concern from the offensive sub-tree
 * (Sub-AC 3) because:
 *
 *   1. The *world view* is different — recovery branches care about
 *      stage geometry (ledge positions, blast zones), the bot's own
 *      position / velocity / jump budget / up-special availability,
 *      and crucially DO NOT condition on the opponent's combo state.
 *      Offensive branches care about the opponent's distance / damage
 *      percent / state; their snapshot has no notion of "where the
 *      stage edge is".
 *
 *   2. The *action vocabulary* is different — recovery emits press
 *      verbs the offensive layer never produces (`jump`, `upSpecial`,
 *      `airDodge`) and the offensive layer emits attack verbs that
 *      have no place in a recovery context (`smash`, `tilt`). Keeping
 *      the two action unions disjoint at the type level prevents a
 *      controller composer from accidentally piping an offensive jab
 *      through a recovery branch (or vice versa).
 *
 *   3. Determinism contract is identical — every input is either pure
 *      data (snapshots, blackboard, tickIndex) or a seeded Rng pulled
 *      through context. The sub-tree's emit pattern feeds into the
 *      same fixed-step input dispatcher the offensive sub-tree uses,
 *      so the same replay log captures recovery decisions verbatim.
 *
 * Nothing in this file imports Phaser or Matter — recovery sub-trees
 * are intentionally engine-agnostic so unit tests can construct
 * fully-fledged contexts with plain object literals.
 */

import type { BehaviorTreeContext } from '../behaviorTree/BehaviorTree';
import type { Rng } from '../../utils/Rng';

// ---------------------------------------------------------------------------
// Action writer + emit shape
// ---------------------------------------------------------------------------

/**
 * Discriminator for every *recovery* action a leaf can emit on a
 * given tick. Distinct (deliberately) from the offensive sub-tree's
 * {@link import('../offensive/types').OffensiveActionKind} union so
 * the two surface areas cannot be silently confused at the type
 * boundary; the controller composer in the upcoming integration
 * sub-AC fans both into the unified press dispatcher.
 *
 *   - `idle`        — explicit "do nothing this tick". Useful when
 *                     the bot wants to coast through a recovery move's
 *                     hangtime without re-pressing.
 *   - `moveLeft`    — hold left on the stick. During recovery this
 *                     drives DI / horizontal nudge toward the stage.
 *   - `moveRight`   — hold right; symmetric.
 *   - `moveUp`      — hold up. Some recovery moves (Owl's directional
 *                     jump, Wolf's multiHitRising) read the stick at
 *                     press time to choose vertical bias; holding up
 *                     while pressing `upSpecial` selects a more
 *                     vertical recovery vector.
 *   - `moveDown`    — fast-fall / drop-through input. Hard-tier
 *                     recovery uses this very rarely (only when
 *                     dropping onto a low platform after recovering
 *                     above the stage).
 *   - `jump`        — press jump. Whether this consumes the grounded
 *                     jump or an air-jump depends on the engine's
 *                     jump-budget bookkeeping; the leaf only emits
 *                     the press, never inspects which jump fired.
 *   - `upSpecial`   — press the up-special recovery move. Each
 *                     character's up-special has unique mechanics
 *                     (multiHitRising / teleport / directionalJump /
 *                     tether) — see {@link
 *                     import('../../characters/upSpecialSchema')}.
 *   - `airDodge`    — defensive option for tight recovery angles.
 *                     Reserved here so a future "wavedash recovery"
 *                     branch can emit it without rewiring the union.
 *
 * Aerial attacks (nair / fair / bair) are intentionally absent —
 * recovery branches stay defensive; an offensive aerial recovery
 * (e.g. fair-on-stage-return) would be a separate offensive aerial
 * sub-tree and is out of scope for Sub-AC 4.
 */
export type RecoveryActionKind =
  | 'idle'
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown'
  | 'jump'
  | 'upSpecial'
  | 'airDodge';

/**
 * Single emit produced by a recovery leaf during a tick.
 *
 *   - `kind`         — the action verb itself.
 *   - `recoveryStep` — optional debug label tagging which recovery
 *                      branch produced this emit (`'doubleJump'`,
 *                      `'upSpecial.commit'`, `'ledge.return'`, …).
 *                      Useful for replay overlays and assertions in
 *                      unit tests; the runtime gameplay layer ignores
 *                      it.
 */
export interface RecoveryAction {
  readonly kind: RecoveryActionKind;
  readonly recoveryStep?: string;
}

/**
 * Sink for recovery actions emitted by leaves during a tick.
 *
 * Mirrors the {@link import('../offensive/types').ActionWriter}
 * interface so a controller composer can hold one of each and fan
 * into a unified press dispatcher. Multiple emits per tick are
 * explicitly allowed (e.g. emit `moveRight` + `upSpecial` on the same
 * frame to choose Owl's directional jump angle).
 *
 * Tests inject a stub writer that records emits into an array for
 * assertion — the same pattern the offensive sub-tree's leaf tests
 * use.
 */
export interface RecoveryActionWriter {
  emit(action: RecoveryAction): void;
}

// ---------------------------------------------------------------------------
// Self snapshot — what the recovery branches need to know about the bot
// ---------------------------------------------------------------------------

/**
 * What the recovery branches need to know about the bot itself.
 *
 * Mirrors the parts of the engine's {@link
 * import('../../characters/Character').Character} state that gate
 * recovery intent. Kept narrow on purpose: leaves should never have
 * to peek into Phaser-bound state directly.
 */
export interface RecoverySelfSnapshot {
  /** World-space X (Matter centre of mass) in design pixels. */
  readonly positionX: number;
  /** World-space Y (Matter centre of mass) in design pixels. */
  readonly positionY: number;
  /** Live X velocity (Matter px-per-step). */
  readonly velocityX: number;
  /** Live Y velocity (Matter px-per-step). Positive = falling. */
  readonly velocityY: number;
  /** Direction the bot is facing this frame. `1` = right, `-1` = left. */
  readonly facing: 1 | -1;
  /** True iff the bot is NOT supported by a platform body. */
  readonly isAirborne: boolean;
  /**
   * Air-jumps still available before landing again. `0` means every
   * jump has been spent; the bot must rely on up-special / ledge to
   * recover. Mirrors {@link
   * import('../../characters/Character').Character.getJumpsRemaining}.
   */
  readonly jumpsRemaining: number;
  /**
   * True iff the bot's up-special recovery move is still available
   * for use this airborne period. Most up-specials are once-per-air
   * (consumed on press, restored on landing or ledge grab).
   * Hard-tier recovery is *very* careful about this flag — burning
   * the up-special early in a fall is a common death pattern.
   */
  readonly upSpecialAvailable: boolean;
  /**
   * True iff the bot is currently locked in hitstun — recovery
   * branches must abort and let the controller's hitstun handler
   * resolve before any press fires.
   */
  readonly isInHitstun: boolean;
  /**
   * True iff the bot is currently grabbing a stage ledge. While
   * latched the recovery sub-tree returns Failure on every press
   * branch and lets the controller's ledge-release / get-up handler
   * take over.
   */
  readonly isOnLedge: boolean;
}

// ---------------------------------------------------------------------------
// Stage geometry — what the recovery branches need to know about the world
// ---------------------------------------------------------------------------

/**
 * Single grabbable ledge corner. The controller layer pre-computes
 * the list of ledge corners from the stage's `solid` platforms (top
 * corners that are *not* immediately adjacent to another platform)
 * and surfaces the *nearest* ledge to the bot via
 * {@link RecoveryStageGeometry.nearestLedge}.
 *
 *   - `x` / `y`   — world-space ledge corner, in design pixels.
 *   - `side`      — which side of the stage the ledge belongs to,
 *                   `'left'` or `'right'`. Used by the ledge-return
 *                   leaf to pick the approach direction.
 */
export interface RecoveryLedge {
  readonly x: number;
  readonly y: number;
  readonly side: 'left' | 'right';
}

/**
 * Slice of stage geometry the recovery sub-tree consults each tick.
 *
 *   - `stageLeft` / `stageRight` — X coordinates of the main stage's
 *     left and right safe edges. The "off-stage" predicate is simply
 *     `bot.x < stageLeft || bot.x > stageRight`, plus a generous
 *     vertical check (below the lowest platform).
 *   - `stageTop`                 — Y of the main stage's top surface.
 *     Y grows down (Phaser/Matter convention) so a bot below the
 *     stage has `bot.y > stageTop`.
 *   - `blastZone`                — the four KO walls. Recovery
 *     branches escalate priority (jump → up-special → airdodge) as
 *     the bot approaches a blast wall.
 *   - `nearestLedge`             — pre-computed nearest grabbable
 *     ledge corner, or `null` when no ledges are reachable (a stage
 *     with no ledges, e.g. flat ground only). The ledge-return leaf
 *     bails to `Failure` when this is `null`.
 */
export interface RecoveryStageGeometry {
  readonly stageLeft: number;
  readonly stageRight: number;
  readonly stageTop: number;
  readonly blastZone: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly nearestLedge: RecoveryLedge | null;
}

// ---------------------------------------------------------------------------
// Blackboard schema for the recovery partition
// ---------------------------------------------------------------------------

/**
 * High-level recovery phase. Drives the tree's branch selection:
 *
 *   - `idle`         — bot is on stage, no recovery work to do. Every
 *                      leaf returns `Failure`; the enclosing top-level
 *                      Selector falls through to the offensive sub-tree.
 *   - `airJumping`   — bot is off-stage and consuming an air-jump.
 *                      Holds for a few frames so the leaf doesn't
 *                      machine-gun jump presses across consecutive ticks.
 *   - `upSpecial`    — bot has committed to the up-special recovery
 *                      move. Holds until the move's hang-time elapses
 *                      or the bot lands / grabs a ledge.
 *   - `ledgeReturn`  — bot is gliding back toward a known ledge corner.
 *                      Sequence emits horizontal nudges only; ends when
 *                      the bot grabs the ledge or falls back into one
 *                      of the earlier phases.
 */
export type RecoveryPhase =
  | 'idle'
  | 'airJumping'
  | 'upSpecial'
  | 'ledgeReturn';

/**
 * Get-up option chosen by the LedgeMixup subtree once the bot is
 * latched on a ledge. The Hard-tier AI deterministically randomises
 * this choice via the seeded {@link Rng} so opponents can't read the
 * bot's get-up pattern by frame-perfect reaction.
 *
 *   - `'normal'` — neutral get-up: the bot releases the ledge and
 *                  steps onto stage with the standard get-up
 *                  animation. Mid-tier risk; lowest commitment.
 *   - `'attack'` — get-up attack: the bot releases and immediately
 *                  swings a hitbox covering the ledge area. High
 *                  reward when the opponent is staggered close to the
 *                  ledge; punished hard if the opponent shielded.
 *   - `'jump'`   — get-up jump: the bot leaps up from the ledge,
 *                  preserving aerial mobility. Best mix-up against
 *                  opponents waiting on stage with an anti-air.
 *   - `'roll'`   — get-up roll: the bot rolls onto stage past the
 *                  immediate ledge-trap zone with i-frames. Best
 *                  against opponents committed to a ledge cover.
 */
export type LedgeMixupGetUpOption =
  | 'normal'
  | 'attack'
  | 'jump'
  | 'roll';

/**
 * Typed schema for the recovery sub-tree's Blackboard partition.
 *
 * Lives in the runner-owned {@link
 * import('../behaviorTree/Blackboard').Blackboard} alongside whatever
 * other namespaces the full controller declares (offensive,
 * defensive). Field names use the `recovery` prefix so future
 * namespaces (e.g. `defenseLastShield…`) won't collide.
 *
 * Snapshot-friendliness — every field is a primitive (string,
 * number, or `null`) so the entire schema serialises cleanly through
 * `JSON.stringify` for the 300-frame replay snapshots without
 * bespoke adapters.
 */
export interface RecoveryBlackboardSchema {
  /** Current high-level recovery phase; see {@link RecoveryPhase}. */
  recoveryPhase: RecoveryPhase;
  /**
   * Tick on which the current phase started. `-1` while phase is
   * `'idle'` (no recovery in flight). Phase-hold leaves consult this
   * to decide whether enough frames have elapsed to advance.
   */
  recoveryPhaseStartTick: number;
  /**
   * Tick on which the bot last emitted an air-jump press. `-1` when
   * no air-jump has been pressed during the current airborne period.
   * The double-jump leaf consults this to enforce a re-press cooldown
   * — without it, a leaf-tree that emits `jump` on every Running tick
   * would burn every air-jump on consecutive frames.
   */
  recoveryLastAirJumpTick: number;
  /**
   * Tick on which the bot last pressed up-special. `-1` when not yet
   * pressed during the current airborne period. Cleared (back to `-1`)
   * when {@link recoveryPhase} returns to `'idle'` (i.e. on landing /
   * ledge grab). The up-special leaf uses this together with
   * {@link RecoverySelfSnapshot.upSpecialAvailable} to avoid double-
   * pressing during the move's recovery animation.
   */
  recoveryLastUpSpecialTick: number;
  /**
   * Tick on which the bot was first observed latched on a ledge in
   * the current ledge-mixup cycle. `-1` while the bot is not on a
   * ledge. The LedgeMixup get-up leaf uses this as the time-zero
   * reference for the hang-then-act timing.
   *
   * Reset to `-1` on landing, ledge-release, and on the regrab cycle's
   * "drop" frame so a freshly re-grabbed ledge starts a new mix-up.
   */
  ledgeMixupGrabTick: number;
  /**
   * Get-up option the LedgeMixup subtree has *committed* to for the
   * current ledge hang. `null` while the option has not been chosen
   * yet (or the bot is not on a ledge). Set deterministically from
   * {@link Rng} on the first tick the bot is observed on a ledge so
   * the choice is stable across the hang frames; cleared back to
   * `null` once the option fires (or the bot leaves the ledge).
   */
  ledgeMixupGetUpOption: LedgeMixupGetUpOption | null;
  /**
   * Tick on which the LedgeMixup subtree plans to fire the chosen
   * get-up option. `-1` while no option is planned. The hang duration
   * (`emitTick - grabTick`) is rng-jittered around a configurable
   * mean so opponents can't read the bot's get-up timing.
   */
  ledgeMixupGetUpEmitTick: number;
}

/**
 * Default seed for the recovery partition. Seed values reflect the
 * "on stage, nothing to recover" starting condition.
 */
export const DEFAULT_RECOVERY_BLACKBOARD: Readonly<RecoveryBlackboardSchema> =
  Object.freeze({
    recoveryPhase: 'idle',
    recoveryPhaseStartTick: -1,
    recoveryLastAirJumpTick: -1,
    recoveryLastUpSpecialTick: -1,
    ledgeMixupGrabTick: -1,
    ledgeMixupGetUpOption: null,
    ledgeMixupGetUpEmitTick: -1,
  });

// ---------------------------------------------------------------------------
// Per-tick context
// ---------------------------------------------------------------------------

/**
 * Per-tick context threaded through every recovery leaf.
 *
 * Extends the conventional {@link BehaviorTreeContext} (blackboard +
 * tickIndex) with three recovery-specific properties:
 *
 *   - `self`  — bot snapshot, see {@link RecoverySelfSnapshot}.
 *   - `stage` — stage geometry slice, see {@link RecoveryStageGeometry}.
 *   - `out`   — emit sink, see {@link RecoveryActionWriter}.
 *   - `rng`   — seeded Rng, used for deterministic tie-breaking
 *               (e.g. choosing between two equidistant ledges).
 *
 * All fields are `readonly` because leaves must not mutate the
 * snapshot in place — the controller rebuilds the context once per
 * tick.
 */
export interface RecoveryContext
  extends BehaviorTreeContext<RecoveryBlackboardSchema> {
  readonly self: RecoverySelfSnapshot;
  readonly stage: RecoveryStageGeometry;
  readonly out: RecoveryActionWriter;
  readonly rng: Rng;
}

// ---------------------------------------------------------------------------
// Off-stage classification — pure helpers used by every leaf
// ---------------------------------------------------------------------------

/**
 * Pure predicate: is the bot currently *off-stage*?
 *
 * Defined as: outside the safe horizontal range AND airborne, OR
 * below the stage's top surface (Y greater than stageTop). This
 * lets a bot that walked off the side of the ground (still above
 * stageTop) but is now airborne classify as off-stage without
 * needing a separate "fell off the edge" event.
 *
 * The vertical check uses a small `verticalSlackPx` (default 0)
 * so a bot that's *exactly* on the stage top (positionY === stageTop)
 * isn't flagged off-stage by floating-point fuzz.
 */
export function isOffStage(
  self: RecoverySelfSnapshot,
  stage: RecoveryStageGeometry,
  verticalSlackPx = 0,
): boolean {
  if (!self.isAirborne) return false;
  if (self.positionX < stage.stageLeft) return true;
  if (self.positionX > stage.stageRight) return true;
  if (self.positionY > stage.stageTop + verticalSlackPx) return true;
  return false;
}

/**
 * Pure predicate: is the bot in *imminent* danger of crossing a
 * blast-zone wall on its current trajectory?
 *
 * Heuristic: project the bot's position one second forward (60
 * frames at 60 Hz fixed step) using its current velocity and check
 * whether that projection lies past any blast wall. Hard-tier
 * recovery escalates to up-special when this fires, instead of
 * waiting for the bot to hit the wall.
 *
 * `framesAhead` defaults to 60 — one second of lookahead is the
 * empirically-tuned value where Hard-tier recovery feels "alert"
 * without being twitchy. Tests use lower values to inspect
 * boundary behaviour.
 */
export function isApproachingBlastZone(
  self: RecoverySelfSnapshot,
  stage: RecoveryStageGeometry,
  framesAhead = 60,
): boolean {
  const projectedX = self.positionX + self.velocityX * framesAhead;
  const projectedY = self.positionY + self.velocityY * framesAhead;
  const z = stage.blastZone;
  if (projectedX < z.left) return true;
  if (projectedX > z.right) return true;
  if (projectedY < z.top) return true;
  if (projectedY > z.bottom) return true;
  return false;
}

/**
 * Pure helper: signed horizontal offset from the bot to the nearest
 * ledge corner. Returns `null` when no ledge is registered.
 *
 * Sign convention mirrors the offensive sub-tree's
 * {@link import('../offensive/types').OpponentSnapshot.distance} —
 * positive means the ledge is to the right of the bot.
 */
export function ledgeXOffset(
  self: RecoverySelfSnapshot,
  stage: RecoveryStageGeometry,
): number | null {
  if (stage.nearestLedge === null) return null;
  return stage.nearestLedge.x - self.positionX;
}

/**
 * Pure helper: signed vertical offset from the bot to the nearest
 * ledge corner. Returns `null` when no ledge is registered.
 *
 * Sign convention: positive means the ledge is *below* the bot
 * (Y grows down). Hard-tier recovery uses the magnitude to decide
 * whether a double-jump alone would reach the ledge or whether the
 * up-special must commit.
 */
export function ledgeYOffset(
  self: RecoverySelfSnapshot,
  stage: RecoveryStageGeometry,
): number | null {
  if (stage.nearestLedge === null) return null;
  return stage.nearestLedge.y - self.positionY;
}
