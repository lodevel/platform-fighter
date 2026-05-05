/**
 * Multi-fighter ledge-grab conflict resolver — AC 15.
 *
 * Goal (Seed line item):
 *
 *   "Edge-grab conflict resolved by first-come-first-served or
 *    push-off rule"
 *
 * The geometric / state-machine layer (see {@link ledgeDetection.ts} and
 * {@link ledgeHangState.ts}) treats each fighter in isolation: given a
 * fighter's body bounds and a list of grabbable ledge corners, decide
 * whether THIS fighter can grab a ledge this frame. That layer is
 * deliberately blind to the canonical Smash rule "only one fighter can
 * hang on a ledge at a time" — the conflict is resolved one level up,
 * by this module.
 *
 * The mediator runs once per fixed step, after the per-fighter detection
 * pass and before the per-fighter `tickLedgeHang` call. It takes:
 *
 *   1. A `LedgeOccupancy` snapshot — which ledge corner (if any) each
 *      fighter is currently hanging on, derived from the previous tick's
 *      `LedgeHangState`s. The mediator treats the `'hanging'` /
 *      `'climbing'` / `'rolling'` states as "this fighter occupies the
 *      ledge"; `'idle'` and `'cooldown'` are "free."
 *   2. A set of `LedgeGrabRequest`s — every fighter who would otherwise
 *      latch onto a ledge this frame (their per-fighter detection
 *      returned a positive). Each request carries the requesting
 *      fighter's player index, the ledge id, and how many frames the
 *      fighter has been falling toward the ledge (for FCFS tie-breaking
 *      against another fighter requesting the same ledge on the same
 *      tick).
 *
 * The mediator returns a {@link LedgeConflictResolution}:
 *
 *   • `grants`         — the requests that succeed (the fighter latches).
 *   • `rejections`     — the requests that fail (the fighter passes
 *                        through the ledge corner with no grab).
 *   • `forceReleases`  — under the `'push-off'` rule, the fighters whose
 *                        hang was punched out by an incoming grab. The
 *                        runtime feeds these into the next tick's
 *                        `LedgeHangInput.forceRelease` so the displaced
 *                        fighter cleanly exits the `'hanging'` state.
 *
 * Two conflict-resolution rules are supported (the Seed line item lists
 * both with an "or"):
 *
 *   • `'first-come-first-served'` (FCFS) — the fighter who arrives at
 *     the ledge first wins the corner. A fresh request that targets a
 *     ledge already held by another fighter is rejected outright. Two
 *     requests for the same UNoccupied ledge on the same tick are
 *     resolved by the request's `priority` (lower wins; ties broken by
 *     `playerIndex`). This is the canonical Melee-/Brawl-era rule.
 *   • `'push-off'` — the fresh request "knocks" the existing occupant
 *     off the ledge: the new fighter grabs, and the old fighter is
 *     emitted as a `forceRelease` so the runtime drops them. Same-tick
 *     ties between two fresh requests fall back to FCFS by `priority`.
 *     This mirrors the Smash 4 / Ultimate rule.
 *
 * Determinism contract
 * --------------------
 *
 * Pure function. No `Math.random()`, no wall-clock reads, no Phaser /
 * Matter side effects. The output is fully determined by:
 *
 *     resolveLedgeConflicts(occupancy, requests, rule)
 *
 * Replays drive identical inputs through this helper and produce
 * identical resolutions. The mediator iterates inputs in a stable
 * order (sorted by `(priority asc, playerIndex asc)`) so caller order
 * is irrelevant.
 *
 * Ledge identity
 * --------------
 *
 * A "ledge" is uniquely identified by `(platformId, side)`. Two fighters
 * can simultaneously hold the LEFT and RIGHT corners of the same
 * platform — those are distinct ledges from this module's perspective.
 *
 * The `LedgeId` opaque type is just the string concatenation
 * `${platformId}:${side}`; helpers `buildLedgeId` /
 * `parseLedgeId` keep the format private.
 *
 * Boundaries
 * ----------
 *
 * Out of scope for this module (handled elsewhere):
 *
 *   • Geometric "is the fighter touching the ledge?" — that's
 *     `detectLedgeGrab` in {@link ledgeDetection.ts}.
 *   • Per-fighter hang state machine — `tickLedgeHang` in
 *     {@link ledgeHangState.ts}. This mediator only DECIDES which
 *     fighters get to start hanging this frame; the state machine then
 *     advances each fighter independently with the resolved input.
 *   • Tether re-grab cooldown timing — the per-fighter cooldown is
 *     handled inside `tickLedgeHang`. This mediator does NOT special-case
 *     a fighter still in cooldown; the per-fighter machine rejects the
 *     fresh detection on its own. (A fighter in cooldown therefore
 *     should not appear in the `requests` array — the caller filters
 *     them out before calling.)
 */

import type { LedgeCandidate, LedgeSide } from './ledgeDetection';
import type { LedgeHangState } from './ledgeHangState';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Conflict-resolution rule. Configurable so a balance pass / a custom
 * stage / a player-facing setting can flip between the two canonical
 * Smash semantics:
 *
 *   • `'first-come-first-served'` — the existing occupant keeps the
 *     ledge; a fresh request is rejected.
 *   • `'push-off'` — the existing occupant is punched off; the fresh
 *     request grabs.
 */
export type LedgeConflictRule = 'first-come-first-served' | 'push-off';

/**
 * Opaque string identifier for a ledge corner. Built via
 * {@link buildLedgeId} as `${platformId}:${side}` so the runtime can
 * key a `Map` by it without re-deriving from `LedgeCandidate` records.
 *
 * Treated as an opaque type — callers should NOT parse it manually.
 */
export type LedgeId = string;

/**
 * Per-fighter snapshot of "which ledge does this fighter currently
 * occupy?" Derived from the previous frame's per-fighter
 * {@link LedgeHangState}.
 *
 *   • `playerIndex`: the slot index (0..3 for a 4-player match).
 *   • `ledgeId`: the ledge the fighter is hanging on, or `null` if
 *     the fighter holds no ledge this frame.
 *
 * Pass one entry per active fighter regardless of whether they hold a
 * ledge — the mediator's `null` branch is essentially a no-op but it
 * keeps the caller-side code uniform.
 */
export interface LedgeOccupant {
  readonly playerIndex: number;
  readonly ledgeId: LedgeId | null;
}

/**
 * A fighter's bid to grab a ledge this tick. Built by the caller from
 * the per-fighter {@link detectLedgeGrab} return value.
 *
 *   • `playerIndex`: the requesting fighter's slot index.
 *   • `ledgeId`: the ledge being requested.
 *   • `priority`: tie-breaker for two requests for the same UNoccupied
 *     ledge on the same tick. Smaller wins. Conventionally the number
 *     of frames the fighter has been falling toward the ledge (so the
 *     fighter who arrived earlier wins). Defaults to 0 if omitted.
 *
 * The `candidate` field carries the original `LedgeCandidate` record so
 * the resolver can echo it back in `grants` — the runtime applies it
 * directly to the fighter's `tickLedgeHang` input.
 */
export interface LedgeGrabRequest {
  readonly playerIndex: number;
  readonly ledgeId: LedgeId;
  readonly priority?: number;
  readonly candidate: LedgeCandidate;
  readonly latchX: number;
  readonly latchY: number;
}

/** A successful grant — the fighter latches onto the ledge this tick. */
export interface LedgeGrabGrant {
  readonly playerIndex: number;
  readonly ledgeId: LedgeId;
  readonly candidate: LedgeCandidate;
  readonly latchX: number;
  readonly latchY: number;
}

/**
 * A rejected request. The fighter passes through the ledge corner with
 * no grab this tick.
 *
 *   • `'occupied'`        — the ledge is held by another fighter and the
 *                           rule is `'first-come-first-served'`.
 *   • `'lost-priority'`   — the ledge is unoccupied but another fighter
 *                           on the same tick won the priority tie.
 *   • `'duplicate'`       — the same fighter sent two requests for
 *                           different ledges in the same tick (shouldn't
 *                           happen in normal flow; the mediator keeps
 *                           the first by sort order and rejects the
 *                           rest defensively).
 */
export type LedgeRejectionReason =
  | 'occupied'
  | 'lost-priority'
  | 'duplicate';

export interface LedgeGrabRejection {
  readonly playerIndex: number;
  readonly ledgeId: LedgeId;
  readonly reason: LedgeRejectionReason;
}

/**
 * A force-release event under the `'push-off'` rule. The displaced
 * fighter must be punched out of `'hanging'` / `'climbing'` /
 * `'rolling'` on the NEXT tick — the runtime feeds this into
 * `LedgeHangInput.forceRelease`.
 */
export interface LedgeForceRelease {
  readonly playerIndex: number;
  readonly ledgeId: LedgeId;
  readonly reason: 'pushed-off';
}

/** Result of one mediator pass. */
export interface LedgeConflictResolution {
  readonly grants: ReadonlyArray<LedgeGrabGrant>;
  readonly rejections: ReadonlyArray<LedgeGrabRejection>;
  readonly forceReleases: ReadonlyArray<LedgeForceRelease>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default conflict rule. The canonical Smash-Ultimate behaviour leans
 * toward push-off, but FCFS is the safer default for new players (no
 * "I had the ledge and got punched off out of nowhere" surprise) and
 * matches the canonical Melee/Brawl behaviour.
 */
export const DEFAULT_LEDGE_CONFLICT_RULE: LedgeConflictRule =
  'first-come-first-served';

/**
 * Sentinel separator for {@link buildLedgeId}. A colon is forbidden in
 * `platformId` strings (the stage builder validates this on save) so a
 * round-trip via {@link parseLedgeId} is unambiguous.
 */
const LEDGE_ID_SEPARATOR = ':';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Build the opaque string key for a `(platformId, side)` ledge corner. */
export function buildLedgeId(
  platformIdOrCandidate: string | LedgeCandidate,
  side?: LedgeSide,
): LedgeId {
  if (typeof platformIdOrCandidate === 'string') {
    if (side === undefined) {
      throw new Error('buildLedgeId: side required when first arg is platformId');
    }
    return `${platformIdOrCandidate}${LEDGE_ID_SEPARATOR}${side}`;
  }
  return `${platformIdOrCandidate.platformId}${LEDGE_ID_SEPARATOR}${platformIdOrCandidate.side}`;
}

/**
 * Parse an opaque ledge id back into its `(platformId, side)` parts.
 * Throws if the input is malformed (a defensive guard against a stale
 * id leaking in from a serialised replay produced by an older version).
 */
export function parseLedgeId(
  id: LedgeId,
): { readonly platformId: string; readonly side: LedgeSide } {
  const sep = id.lastIndexOf(LEDGE_ID_SEPARATOR);
  if (sep <= 0 || sep === id.length - 1) {
    throw new Error(`parseLedgeId: malformed ledge id "${id}"`);
  }
  const sideRaw = id.slice(sep + 1);
  if (sideRaw !== 'left' && sideRaw !== 'right') {
    throw new Error(`parseLedgeId: malformed side "${sideRaw}"`);
  }
  return {
    platformId: id.slice(0, sep),
    side: sideRaw,
  };
}

/**
 * Translate a per-fighter hang state into the `LedgeOccupant` record
 * the mediator consumes. A fighter is treated as OCCUPYING a ledge
 * while in `'hanging'` / `'climbing'` / `'rolling'` (those three states
 * all have the body locked to the ledge corner). `'idle'` and
 * `'cooldown'` produce `null` — the ledge is free.
 *
 * Pure: identical inputs always return identical outputs.
 */
export function ledgeOccupantFromHangState(
  playerIndex: number,
  state: LedgeHangState,
): LedgeOccupant {
  const isOccupying =
    (state.name === 'hanging' ||
      state.name === 'climbing' ||
      state.name === 'rolling') &&
    state.active !== null;
  if (!isOccupying || state.active === null) {
    return { playerIndex, ledgeId: null };
  }
  return {
    playerIndex,
    ledgeId: buildLedgeId(state.active.candidate),
  };
}

/**
 * Stable sort key for a request. Lower sorts first.
 *
 *   • Primary: `priority` — smaller wins (canonically: frames-falling).
 *   • Tie-break: `playerIndex` — smaller wins.
 *
 * Pure helper exposed mainly for tests; the resolver uses it internally.
 */
export function compareLedgeRequests(
  a: LedgeGrabRequest,
  b: LedgeGrabRequest,
): number {
  const ap = a.priority ?? 0;
  const bp = b.priority ?? 0;
  if (ap !== bp) return ap - bp;
  return a.playerIndex - b.playerIndex;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a tick's worth of ledge-grab requests against the live
 * occupancy map. Pure deterministic function.
 *
 * Algorithm (deterministic; iteration order independent of caller):
 *
 *   1. Build an `occupancyByLedge` map: `LedgeId → playerIndex` from the
 *      `occupants` argument. Skip null-ledge entries (the canonical
 *      "fighter holds no ledge").
 *   2. Sort the requests by `(priority asc, playerIndex asc)` so the
 *      resolver iterates them in a stable order.
 *   3. Walk the sorted requests, maintaining a `claimedThisTick` map
 *      so two requests for the same unoccupied ledge resolve
 *      deterministically (first sorted wins; rest emit
 *      `'lost-priority'` rejections).
 *   4. For each request:
 *        a. If the same fighter already had a request granted this
 *           tick, emit `'duplicate'` rejection.
 *        b. If the ledge is held by another fighter:
 *             • FCFS: emit `'occupied'` rejection.
 *             • push-off: emit a `'pushed-off'` force-release for the
 *               existing occupant, grant the new request, AND remove
 *               the existing occupant from the occupancy map so a
 *               second push doesn't double-target them.
 *        c. Else if the ledge has been claimed this tick by an earlier
 *           sorted request, emit `'lost-priority'` rejection.
 *        d. Else grant the request and mark the ledge as claimed.
 *
 * @param occupants  Per-fighter "which ledge do I hold?" snapshot.
 * @param requests   Per-fighter grab requests for this tick.
 * @param rule       FCFS or push-off. Defaults to FCFS.
 * @returns          Grants / rejections / forceReleases.
 */
export function resolveLedgeConflicts(
  occupants: ReadonlyArray<LedgeOccupant>,
  requests: ReadonlyArray<LedgeGrabRequest>,
  rule: LedgeConflictRule = DEFAULT_LEDGE_CONFLICT_RULE,
): LedgeConflictResolution {
  // Step 1 — build occupancy map. A fighter occupying multiple ledges
  // is impossible by construction (`LedgeOccupant.ledgeId` is a single
  // value), but a malformed input listing the same ledge as held by
  // two fighters is defensively reduced to "the lower playerIndex wins
  // the ledge slot" so the resolver remains deterministic.
  const occupancyByLedge = new Map<LedgeId, number>();
  // Sorted-occupant pass guarantees the lower-index fighter wins a
  // duplicate-occupancy collision deterministically.
  const sortedOccupants = [...occupants].sort(
    (a, b) => a.playerIndex - b.playerIndex,
  );
  for (const occ of sortedOccupants) {
    if (occ.ledgeId === null) continue;
    if (!occupancyByLedge.has(occ.ledgeId)) {
      occupancyByLedge.set(occ.ledgeId, occ.playerIndex);
    }
  }

  // Step 2 — sort requests deterministically.
  const sortedRequests = [...requests].sort(compareLedgeRequests);

  // Step 3 — walk requests, accumulating outputs.
  const grants: LedgeGrabGrant[] = [];
  const rejections: LedgeGrabRejection[] = [];
  const forceReleases: LedgeForceRelease[] = [];

  // `claimedThisTick`: ledge → playerIndex who just won it this tick.
  // Used to resolve same-tick contention between two fresh requests for
  // the same unoccupied ledge.
  const claimedThisTick = new Map<LedgeId, number>();
  // `grantedFighters`: defensive guard against a fighter who somehow
  // ended up with two requests in the same tick (a single fighter can
  // only grab ONE ledge per tick — the per-fighter detection picks
  // exactly one closest candidate).
  const grantedFighters = new Set<number>();

  for (const req of sortedRequests) {
    if (grantedFighters.has(req.playerIndex)) {
      rejections.push(
        Object.freeze({
          playerIndex: req.playerIndex,
          ledgeId: req.ledgeId,
          reason: 'duplicate' as const,
        }),
      );
      continue;
    }

    const occupantOfLedge = occupancyByLedge.get(req.ledgeId);
    const isHeldByOther =
      occupantOfLedge !== undefined && occupantOfLedge !== req.playerIndex;

    if (isHeldByOther) {
      if (rule === 'first-come-first-served') {
        rejections.push(
          Object.freeze({
            playerIndex: req.playerIndex,
            ledgeId: req.ledgeId,
            reason: 'occupied' as const,
          }),
        );
        continue;
      }
      // push-off: punch the existing occupant off, then grant.
      forceReleases.push(
        Object.freeze({
          playerIndex: occupantOfLedge!,
          ledgeId: req.ledgeId,
          reason: 'pushed-off' as const,
        }),
      );
      occupancyByLedge.delete(req.ledgeId);
      // Fall through to grant.
    }

    // Same-tick contention against another fresh request.
    const claimedBy = claimedThisTick.get(req.ledgeId);
    if (claimedBy !== undefined && claimedBy !== req.playerIndex) {
      rejections.push(
        Object.freeze({
          playerIndex: req.playerIndex,
          ledgeId: req.ledgeId,
          reason: 'lost-priority' as const,
        }),
      );
      continue;
    }

    grants.push(
      Object.freeze({
        playerIndex: req.playerIndex,
        ledgeId: req.ledgeId,
        candidate: req.candidate,
        latchX: req.latchX,
        latchY: req.latchY,
      }),
    );
    grantedFighters.add(req.playerIndex);
    claimedThisTick.set(req.ledgeId, req.playerIndex);
  }

  return Object.freeze({
    grants: Object.freeze(grants),
    rejections: Object.freeze(rejections),
    forceReleases: Object.freeze(forceReleases),
  });
}

/**
 * Convenience: fold an array of `(playerIndex, LedgeHangState)` pairs
 * into the `LedgeOccupant[]` shape the resolver expects. Pure.
 */
export function buildLedgeOccupancy(
  fighters: ReadonlyArray<{
    readonly playerIndex: number;
    readonly hangState: LedgeHangState;
  }>,
): ReadonlyArray<LedgeOccupant> {
  return Object.freeze(
    fighters.map((f) =>
      Object.freeze(ledgeOccupantFromHangState(f.playerIndex, f.hangState)),
    ),
  );
}

/**
 * Quick predicate for the runtime: did `playerIndex`'s request land in
 * the resolution's `grants`? Used by the gameplay scene to gate the
 * per-fighter `tickLedgeHang` call's `detection` input — only the
 * fighters whose grants succeeded should see a non-null detection this
 * tick.
 */
export function isGrantedForPlayer(
  resolution: LedgeConflictResolution,
  playerIndex: number,
): boolean {
  return resolution.grants.some((g) => g.playerIndex === playerIndex);
}

/**
 * Quick predicate: did the resolver punch `playerIndex` out of an
 * existing hang under the push-off rule? Used by the runtime to set
 * the next tick's `LedgeHangInput.forceRelease` flag.
 */
export function isForceReleasedForPlayer(
  resolution: LedgeConflictResolution,
  playerIndex: number,
): boolean {
  return resolution.forceReleases.some((f) => f.playerIndex === playerIndex);
}
