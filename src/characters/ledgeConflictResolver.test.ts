import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEDGE_CONFLICT_RULE,
  buildLedgeId,
  parseLedgeId,
  ledgeOccupantFromHangState,
  buildLedgeOccupancy,
  compareLedgeRequests,
  isGrantedForPlayer,
  isForceReleasedForPlayer,
  resolveLedgeConflicts,
  type LedgeGrabRequest,
  type LedgeOccupant,
} from './ledgeConflictResolver';
import type { LedgeCandidate } from './ledgeDetection';
import {
  createLedgeHangState,
  type ActiveLedgeHang,
  type LedgeHangState,
} from './ledgeHangState';

/**
 * AC 15 — Edge-grab conflict resolved by first-come-first-served or
 * push-off rule.
 *
 * Tests lock down:
 *
 *   1. Ledge id helpers — round-trip via `buildLedgeId` / `parseLedgeId`.
 *   2. Occupant translation — hang states map to expected `ledgeId`.
 *   3. FCFS rejects an occupied-ledge request.
 *   4. FCFS resolves same-tick ties via priority + playerIndex.
 *   5. Push-off displaces the existing occupant and grants the new one.
 *   6. Push-off same-tick ties still resolve by priority.
 *   7. Multiple ledges resolve independently (left + right corners of
 *      one platform are separate conflicts).
 *   8. Determinism — sorted iteration is stable across caller orderings.
 *   9. Defensive duplicate-fighter guard rejects the second request.
 *  10. Predicates `isGrantedForPlayer` / `isForceReleasedForPlayer`.
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PLATFORM_MAIN = 'main';
const PLATFORM_FAR = 'far';

function candidate(
  platformId: string,
  side: 'left' | 'right',
): LedgeCandidate {
  return Object.freeze({
    platformId,
    side,
    x: side === 'left' ? 0 : 100,
    y: 50,
  });
}

const LEDGE_MAIN_LEFT = candidate(PLATFORM_MAIN, 'left');
const LEDGE_MAIN_RIGHT = candidate(PLATFORM_MAIN, 'right');
const LEDGE_FAR_LEFT = candidate(PLATFORM_FAR, 'left');

function makeRequest(
  playerIndex: number,
  c: LedgeCandidate,
  priority?: number,
): LedgeGrabRequest {
  return Object.freeze({
    playerIndex,
    ledgeId: buildLedgeId(c),
    priority,
    candidate: c,
    latchX: c.x,
    latchY: c.y + 50,
  });
}

function hanging(c: LedgeCandidate): LedgeHangState {
  const active: ActiveLedgeHang = Object.freeze({
    candidate: c,
    latchX: c.x,
    latchY: c.y + 50,
    framesElapsed: 5,
    facing: c.side === 'left' ? 1 : -1,
  });
  return Object.freeze({
    name: 'hanging',
    active,
    hangIframesRemaining: 10,
    cooldownRemaining: 0,
    grabVulnerableRemaining: 0,
    ledgeGrabsSinceGround: 1,
  });
}

function climbing(c: LedgeCandidate): LedgeHangState {
  const active: ActiveLedgeHang = Object.freeze({
    candidate: c,
    latchX: c.x,
    latchY: c.y + 50,
    framesElapsed: 3,
    facing: c.side === 'left' ? 1 : -1,
  });
  return Object.freeze({
    name: 'climbing',
    active,
    hangIframesRemaining: 0,
    cooldownRemaining: 0,
    grabVulnerableRemaining: 0,
    ledgeGrabsSinceGround: 1,
  });
}

// ---------------------------------------------------------------------------
// Ledge id helpers
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — id helpers', () => {
  it('builds a ledge id from a LedgeCandidate', () => {
    expect(buildLedgeId(LEDGE_MAIN_LEFT)).toBe('main:left');
    expect(buildLedgeId(LEDGE_MAIN_RIGHT)).toBe('main:right');
  });

  it('builds a ledge id from (platformId, side)', () => {
    expect(buildLedgeId('mid', 'left')).toBe('mid:left');
    expect(buildLedgeId('mid', 'right')).toBe('mid:right');
  });

  it('round-trips via parseLedgeId', () => {
    const id = buildLedgeId(LEDGE_MAIN_RIGHT);
    expect(parseLedgeId(id)).toEqual({ platformId: 'main', side: 'right' });
  });

  it('parses platform ids that contain hyphens / underscores', () => {
    expect(parseLedgeId('main-left-tower:left')).toEqual({
      platformId: 'main-left-tower',
      side: 'left',
    });
  });

  it('throws on a malformed id', () => {
    expect(() => parseLedgeId('no-separator')).toThrow();
    expect(() => parseLedgeId(':left')).toThrow();
    expect(() => parseLedgeId('main:')).toThrow();
    expect(() => parseLedgeId('main:up')).toThrow();
  });

  it('requires a side argument when first arg is a string', () => {
    expect(() => buildLedgeId('mid' as unknown as string)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Occupant translation
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — occupant translation', () => {
  it('treats idle as no-ledge', () => {
    expect(ledgeOccupantFromHangState(0, createLedgeHangState())).toEqual({
      playerIndex: 0,
      ledgeId: null,
    });
  });

  it('treats hanging as occupying the candidate ledge', () => {
    expect(
      ledgeOccupantFromHangState(0, hanging(LEDGE_MAIN_RIGHT)),
    ).toEqual({ playerIndex: 0, ledgeId: 'main:right' });
  });

  it('treats climbing as occupying the candidate ledge', () => {
    expect(
      ledgeOccupantFromHangState(2, climbing(LEDGE_MAIN_LEFT)),
    ).toEqual({ playerIndex: 2, ledgeId: 'main:left' });
  });

  it('treats cooldown as no-ledge', () => {
    const cooling: LedgeHangState = Object.freeze({
      name: 'cooldown',
      active: null,
      hangIframesRemaining: 0,
      cooldownRemaining: 12,
      grabVulnerableRemaining: 0,
      ledgeGrabsSinceGround: 0,
    });
    expect(ledgeOccupantFromHangState(0, cooling)).toEqual({
      playerIndex: 0,
      ledgeId: null,
    });
  });

  it('builds an occupancy array via buildLedgeOccupancy', () => {
    const occupancy = buildLedgeOccupancy([
      { playerIndex: 0, hangState: hanging(LEDGE_MAIN_LEFT) },
      { playerIndex: 1, hangState: createLedgeHangState() },
    ]);
    expect(occupancy.length).toBe(2);
    expect(occupancy[0]).toEqual({ playerIndex: 0, ledgeId: 'main:left' });
    expect(occupancy[1]).toEqual({ playerIndex: 1, ledgeId: null });
  });
});

// ---------------------------------------------------------------------------
// Sort comparator
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — compareLedgeRequests', () => {
  it('sorts by priority ascending', () => {
    const a = makeRequest(0, LEDGE_MAIN_LEFT, 5);
    const b = makeRequest(1, LEDGE_MAIN_LEFT, 2);
    expect(compareLedgeRequests(a, b)).toBeGreaterThan(0);
  });

  it('breaks ties by playerIndex', () => {
    const a = makeRequest(2, LEDGE_MAIN_LEFT, 3);
    const b = makeRequest(0, LEDGE_MAIN_LEFT, 3);
    expect(compareLedgeRequests(a, b)).toBeGreaterThan(0);
  });

  it('treats undefined priority as 0', () => {
    const a = makeRequest(0, LEDGE_MAIN_LEFT);
    const b = makeRequest(1, LEDGE_MAIN_LEFT, 0);
    expect(compareLedgeRequests(a, b)).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// FCFS rule
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — first-come-first-served', () => {
  it('rejects a request when the ledge is held by another fighter', () => {
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_RIGHT) },
      { playerIndex: 1, ledgeId: null },
    ];
    const requests = [makeRequest(1, LEDGE_MAIN_RIGHT)];
    const res = resolveLedgeConflicts(
      occupancy,
      requests,
      'first-come-first-served',
    );
    expect(res.grants).toHaveLength(0);
    expect(res.forceReleases).toHaveLength(0);
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0]).toEqual({
      playerIndex: 1,
      ledgeId: 'main:right',
      reason: 'occupied',
    });
  });

  it('grants when the ledge is free', () => {
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: null },
      { playerIndex: 1, ledgeId: null },
    ];
    const req = makeRequest(1, LEDGE_MAIN_RIGHT);
    const res = resolveLedgeConflicts(occupancy, [req]);
    expect(res.rejections).toHaveLength(0);
    expect(res.forceReleases).toHaveLength(0);
    expect(res.grants).toHaveLength(1);
    expect(res.grants[0]).toMatchObject({
      playerIndex: 1,
      ledgeId: 'main:right',
      candidate: LEDGE_MAIN_RIGHT,
    });
  });

  it('lets a fighter still hanging on a ledge "re-grant" their own request without ejecting themselves', () => {
    // (Defensive: in normal flow the per-fighter detection short-circuits
    // when the fighter is already hanging — but if a stray request slips
    // through, the resolver should NOT mark the same fighter as occupant
    // AND requester as a conflict.)
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_LEFT) },
    ];
    const req = makeRequest(0, LEDGE_MAIN_LEFT);
    const res = resolveLedgeConflicts(occupancy, [req]);
    expect(res.grants).toHaveLength(1);
    expect(res.rejections).toHaveLength(0);
    expect(res.forceReleases).toHaveLength(0);
  });

  it('resolves same-tick ties on a free ledge by priority (lower wins)', () => {
    const reqLow = makeRequest(2, LEDGE_MAIN_LEFT, /* priority */ 3);
    const reqHigh = makeRequest(1, LEDGE_MAIN_LEFT, /* priority */ 7);
    const res = resolveLedgeConflicts([], [reqHigh, reqLow]);
    expect(res.grants).toHaveLength(1);
    expect(res.grants[0]!.playerIndex).toBe(2); // lower priority wins
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0]!).toEqual({
      playerIndex: 1,
      ledgeId: 'main:left',
      reason: 'lost-priority',
    });
  });

  it('breaks priority ties by playerIndex (lower wins)', () => {
    const reqA = makeRequest(0, LEDGE_MAIN_LEFT, 2);
    const reqB = makeRequest(3, LEDGE_MAIN_LEFT, 2);
    const res = resolveLedgeConflicts([], [reqB, reqA]);
    expect(res.grants[0]!.playerIndex).toBe(0);
    expect(res.rejections[0]!.playerIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Push-off rule
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — push-off', () => {
  it('punches the occupant off and grants the new request', () => {
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_RIGHT) },
      { playerIndex: 1, ledgeId: null },
    ];
    const req = makeRequest(1, LEDGE_MAIN_RIGHT);
    const res = resolveLedgeConflicts(occupancy, [req], 'push-off');
    expect(res.grants).toHaveLength(1);
    expect(res.grants[0]!.playerIndex).toBe(1);
    expect(res.forceReleases).toHaveLength(1);
    expect(res.forceReleases[0]!).toEqual({
      playerIndex: 0,
      ledgeId: 'main:right',
      reason: 'pushed-off',
    });
    expect(res.rejections).toHaveLength(0);
  });

  it('only force-releases the original occupant once even if two fighters push the same ledge', () => {
    // Setup: P0 occupies main:left. P1 and P2 both request it on the
    // same tick under push-off. P1 wins by priority, punches P0 off.
    // P2 then loses on the SAME-tick contention check (lost-priority).
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_LEFT) },
    ];
    const reqP1 = makeRequest(1, LEDGE_MAIN_LEFT, /* priority */ 1);
    const reqP2 = makeRequest(2, LEDGE_MAIN_LEFT, /* priority */ 4);
    const res = resolveLedgeConflicts(
      occupancy,
      [reqP2, reqP1],
      'push-off',
    );

    expect(res.forceReleases).toHaveLength(1);
    expect(res.forceReleases[0]!.playerIndex).toBe(0);
    expect(res.grants).toHaveLength(1);
    expect(res.grants[0]!.playerIndex).toBe(1);
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0]!).toEqual({
      playerIndex: 2,
      ledgeId: 'main:left',
      reason: 'lost-priority',
    });
  });

  it('grants on a free ledge (push-off is a no-op when the ledge is empty)', () => {
    const req = makeRequest(0, LEDGE_MAIN_RIGHT);
    const res = resolveLedgeConflicts([], [req], 'push-off');
    expect(res.grants).toHaveLength(1);
    expect(res.forceReleases).toHaveLength(0);
    expect(res.rejections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-ledge independence
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — multi-ledge', () => {
  it('resolves the left and right corners of one platform independently', () => {
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_LEFT) },
    ];
    const reqRight = makeRequest(1, LEDGE_MAIN_RIGHT);
    const res = resolveLedgeConflicts(occupancy, [reqRight]);
    expect(res.grants).toHaveLength(1);
    expect(res.grants[0]!.ledgeId).toBe('main:right');
    expect(res.rejections).toHaveLength(0);
  });

  it('lets two fighters grab two different platforms in the same tick', () => {
    const reqA = makeRequest(0, LEDGE_MAIN_LEFT);
    const reqB = makeRequest(1, LEDGE_FAR_LEFT);
    const res = resolveLedgeConflicts([], [reqA, reqB]);
    expect(res.grants).toHaveLength(2);
    expect(res.rejections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — determinism', () => {
  it('produces identical output regardless of caller request order', () => {
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_RIGHT) },
    ];
    const reqs = [
      makeRequest(2, LEDGE_MAIN_LEFT, 5),
      makeRequest(1, LEDGE_MAIN_LEFT, 2),
      makeRequest(3, LEDGE_FAR_LEFT, 0),
    ];
    const a = resolveLedgeConflicts(occupancy, reqs);
    const b = resolveLedgeConflicts(occupancy, [...reqs].reverse());
    expect(a).toEqual(b);
  });

  it('produces frozen output objects', () => {
    const res = resolveLedgeConflicts(
      [],
      [makeRequest(0, LEDGE_MAIN_LEFT)],
    );
    expect(Object.isFrozen(res)).toBe(true);
    expect(Object.isFrozen(res.grants)).toBe(true);
    expect(Object.isFrozen(res.rejections)).toBe(true);
    expect(Object.isFrozen(res.forceReleases)).toBe(true);
    expect(Object.isFrozen(res.grants[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Defensive guards
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — defensive guards', () => {
  it('rejects a duplicate request from the same fighter as "duplicate"', () => {
    // Same fighter, two requests on different ledges. The first sorted
    // wins; the second is rejected with reason `'duplicate'`. (Should
    // never happen in practice — `detectLedgeGrab` returns one closest
    // match — but the resolver remains deterministic if it ever does.)
    const reqA = makeRequest(0, LEDGE_MAIN_LEFT, 1);
    const reqB = makeRequest(0, LEDGE_MAIN_RIGHT, 5);
    const res = resolveLedgeConflicts([], [reqA, reqB]);
    expect(res.grants).toHaveLength(1);
    expect(res.grants[0]!.ledgeId).toBe('main:left');
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0]!).toEqual({
      playerIndex: 0,
      ledgeId: 'main:right',
      reason: 'duplicate',
    });
  });

  it('handles malformed occupancy listing two fighters on one ledge by giving it to the lower index', () => {
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 1, ledgeId: buildLedgeId(LEDGE_MAIN_LEFT) },
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_LEFT) },
    ];
    const req = makeRequest(2, LEDGE_MAIN_LEFT);
    const res = resolveLedgeConflicts(occupancy, [req], 'push-off');
    // Push-off should target the lower-index occupant (P0) — the
    // canonical "deterministic tie-breaker" path.
    expect(res.forceReleases).toHaveLength(1);
    expect(res.forceReleases[0]!.playerIndex).toBe(0);
  });

  it('uses DEFAULT_LEDGE_CONFLICT_RULE when rule is omitted', () => {
    expect(DEFAULT_LEDGE_CONFLICT_RULE).toBe('first-come-first-served');
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_LEFT) },
    ];
    const res = resolveLedgeConflicts(
      occupancy,
      [makeRequest(1, LEDGE_MAIN_LEFT)],
    );
    expect(res.rejections).toHaveLength(1);
    expect(res.rejections[0]!.reason).toBe('occupied');
  });

  it('returns empty arrays on empty input', () => {
    const res = resolveLedgeConflicts([], []);
    expect(res.grants).toHaveLength(0);
    expect(res.rejections).toHaveLength(0);
    expect(res.forceReleases).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

describe('ledgeConflictResolver — predicates', () => {
  it('isGrantedForPlayer returns true for granted requesters and false otherwise', () => {
    const res = resolveLedgeConflicts(
      [],
      [makeRequest(0, LEDGE_MAIN_LEFT), makeRequest(1, LEDGE_MAIN_LEFT)],
    );
    expect(isGrantedForPlayer(res, 0)).toBe(true);
    expect(isGrantedForPlayer(res, 1)).toBe(false);
    expect(isGrantedForPlayer(res, 7)).toBe(false);
  });

  it('isForceReleasedForPlayer returns true for displaced occupants under push-off', () => {
    const occupancy: LedgeOccupant[] = [
      { playerIndex: 0, ledgeId: buildLedgeId(LEDGE_MAIN_LEFT) },
    ];
    const res = resolveLedgeConflicts(
      occupancy,
      [makeRequest(1, LEDGE_MAIN_LEFT)],
      'push-off',
    );
    expect(isForceReleasedForPlayer(res, 0)).toBe(true);
    expect(isForceReleasedForPlayer(res, 1)).toBe(false);
  });
});
