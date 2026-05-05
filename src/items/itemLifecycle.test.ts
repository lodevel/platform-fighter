/**
 * Tests for {@link ./itemLifecycle} — T3 items framework, AC 16 Sub-AC 1
 * ("broken-item state transition that drops the item inert with a
 * broken visual/sprite swap and disables pickup interactions").
 *
 * These tests pin the canonical lifecycle semantics so a future tuning
 * pass / refactor cannot silently change the rules:
 *
 *   1. Eligibility predicates ({@link canBePickedUp}, {@link isHeld},
 *      {@link isBroken}, {@link isDespawned}) — exhaustive coverage
 *      across all five states.
 *   2. Visual hints ({@link computeItemVisualHints}) — every state
 *      maps to a unique, frozen visual presentation. The broken-
 *      sprite swap (Sub-AC 1's headline visual signal) flips on iff
 *      the item is broken.
 *   3. Broken transition ({@link transitionToBroken}) — accepts only
 *      `grounded` / `held`, rejects everything else with a structured
 *      reason, validates inputs, drops the item inert, and pins the
 *      break frame for the despawn-timer hand-off (Sub-AC 2).
 *   4. Pickup-after-break invariant — the headline contract: a broken
 *      item rejects pickup, no matter what.
 */

import { describe, it, expect } from 'vitest';
import {
  ITEM_BROKEN_ALPHA,
  ITEM_LIFECYCLE_STATES,
  canBePickedUp,
  computeItemVisualHints,
  isBroken,
  isDespawned,
  isHeld,
  transitionToBroken,
  type ItemLifecycleSnapshot,
  type ItemLifecycleState,
} from './itemLifecycle';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(
  overrides: Partial<ItemLifecycleSnapshot> = {},
): ItemLifecycleSnapshot {
  return {
    state: 'grounded',
    holderPlayerIndex: null,
    position: { x: 100, y: 200 },
    stateEnteredFrame: 0,
    ...overrides,
  };
}

// Holder index for `held`-state fixtures. Arbitrary non-zero so we
// can assert it gets cleared rather than coincidentally matching the
// post-transition `null`.
const TEST_HOLDER_INDEX = 2;

// ---------------------------------------------------------------------------
// 1. Lifecycle states enum
// ---------------------------------------------------------------------------

describe('ITEM_LIFECYCLE_STATES', () => {
  it('exports all five canonical states in canonical order', () => {
    expect(ITEM_LIFECYCLE_STATES).toEqual([
      'falling',
      'grounded',
      'held',
      'broken',
      'despawned',
    ]);
  });

  it('is frozen — accidental mutation surfaces as a TypeError', () => {
    expect(Object.isFrozen(ITEM_LIFECYCLE_STATES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Eligibility predicates
// ---------------------------------------------------------------------------

describe('canBePickedUp', () => {
  it.each<[ItemLifecycleState, boolean]>([
    ['falling', false],
    ['grounded', true],
    ['held', false],
    ['broken', false],
    ['despawned', false],
  ])('state %s → pickable=%s', (state, expected) => {
    expect(canBePickedUp(makeSnapshot({ state }))).toBe(expected);
  });

  it('rejects pickup for a broken item — Sub-AC 1 headline rule', () => {
    const snap = makeSnapshot({ state: 'broken' });
    expect(canBePickedUp(snap)).toBe(false);
  });
});

describe('isHeld / isBroken / isDespawned', () => {
  it('isHeld is true only for held', () => {
    for (const s of ITEM_LIFECYCLE_STATES) {
      expect(isHeld(makeSnapshot({ state: s }))).toBe(s === 'held');
    }
  });

  it('isBroken is true only for broken', () => {
    for (const s of ITEM_LIFECYCLE_STATES) {
      expect(isBroken(makeSnapshot({ state: s }))).toBe(s === 'broken');
    }
  });

  it('isDespawned is true only for despawned', () => {
    for (const s of ITEM_LIFECYCLE_STATES) {
      expect(isDespawned(makeSnapshot({ state: s }))).toBe(s === 'despawned');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Visual hints
// ---------------------------------------------------------------------------

describe('computeItemVisualHints', () => {
  it('falling — visible, full alpha, normal sprite, NOT pickup-eligible', () => {
    expect(computeItemVisualHints(makeSnapshot({ state: 'falling' }))).toEqual({
      visible: true,
      alpha: 1,
      useBrokenSprite: false,
      pickupEligible: false,
    });
  });

  it('grounded — visible, full alpha, normal sprite, pickup-eligible', () => {
    expect(computeItemVisualHints(makeSnapshot({ state: 'grounded' }))).toEqual({
      visible: true,
      alpha: 1,
      useBrokenSprite: false,
      pickupEligible: true,
    });
  });

  it('held — visible, full alpha, normal sprite, NOT pickup-eligible', () => {
    expect(computeItemVisualHints(makeSnapshot({ state: 'held' }))).toEqual({
      visible: true,
      alpha: 1,
      useBrokenSprite: false,
      pickupEligible: false,
    });
  });

  it('broken — visible, reduced alpha, BROKEN sprite swap, pickup-locked', () => {
    // Headline visual signal of Sub-AC 1: useBrokenSprite=true on
    // broken items, alpha reduced to ITEM_BROKEN_ALPHA, pickup hint
    // off so the renderer can never light up a "press jab to grab"
    // halo on debris.
    expect(computeItemVisualHints(makeSnapshot({ state: 'broken' }))).toEqual({
      visible: true,
      alpha: ITEM_BROKEN_ALPHA,
      useBrokenSprite: true,
      pickupEligible: false,
    });
  });

  it('despawned — invisible', () => {
    expect(computeItemVisualHints(makeSnapshot({ state: 'despawned' }))).toEqual({
      visible: false,
      alpha: 0,
      useBrokenSprite: false,
      pickupEligible: false,
    });
  });

  it('useBrokenSprite is true iff state is broken — exhaustive', () => {
    for (const s of ITEM_LIFECYCLE_STATES) {
      const hints = computeItemVisualHints(makeSnapshot({ state: s }));
      expect(hints.useBrokenSprite).toBe(s === 'broken');
    }
  });

  it('pickupEligible aligns with canBePickedUp for every state', () => {
    // Visual eligibility hint must never disagree with the runtime
    // eligibility predicate — otherwise the player sees a "press jab"
    // halo on an item they can't actually grab.
    for (const s of ITEM_LIFECYCLE_STATES) {
      const snap = makeSnapshot({ state: s });
      expect(computeItemVisualHints(snap).pickupEligible).toBe(
        canBePickedUp(snap),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. transitionToBroken — happy paths
// ---------------------------------------------------------------------------

describe('transitionToBroken — happy paths', () => {
  it('grounded → broken: drops at the supplied position, stamps frame', () => {
    const snap = makeSnapshot({
      state: 'grounded',
      position: { x: 100, y: 200 },
      stateEnteredFrame: 50,
    });
    const result = transitionToBroken({
      snapshot: snap,
      currentFrame: 123,
      dropPosition: { x: 300, y: 400 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return; // Type guard for the rest of the test.
    expect(result.next.state).toBe('broken');
    expect(result.next.holderPlayerIndex).toBeNull();
    expect(result.next.position).toEqual({ x: 300, y: 400 });
    expect(result.next.stateEnteredFrame).toBe(123);
  });

  it('held → broken: detaches holder, drops at the supplied (hand) position', () => {
    // The headline path: a fighter swings their last hit, durability
    // hits zero, item shatters mid-swing. Holder must be cleared.
    const snap = makeSnapshot({
      state: 'held',
      holderPlayerIndex: TEST_HOLDER_INDEX,
      position: { x: 100, y: 200 }, // Hand position.
      stateEnteredFrame: 50,
    });
    const result = transitionToBroken({
      snapshot: snap,
      currentFrame: 600,
      dropPosition: { x: 105, y: 210 }, // Slightly offset — caller's call.
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.state).toBe('broken');
    expect(result.next.holderPlayerIndex).toBeNull();
    expect(result.next.position).toEqual({ x: 105, y: 210 });
    expect(result.next.stateEnteredFrame).toBe(600);
  });

  it('produces a frozen snapshot — accidental mutation throws', () => {
    const result = transitionToBroken({
      snapshot: makeSnapshot({ state: 'held' }),
      currentFrame: 0,
      dropPosition: { x: 1, y: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.next)).toBe(true);
    expect(Object.isFrozen(result.next.position)).toBe(true);
  });

  it('is pure — calling twice with the same inputs produces equal snapshots', () => {
    const snap = makeSnapshot({ state: 'held' });
    const a = transitionToBroken({
      snapshot: snap,
      currentFrame: 100,
      dropPosition: { x: 50, y: 50 },
    });
    const b = transitionToBroken({
      snapshot: snap,
      currentFrame: 100,
      dropPosition: { x: 50, y: 50 },
    });
    expect(a).toEqual(b);
  });

  it('does not mutate the input snapshot', () => {
    const snap = makeSnapshot({ state: 'held', holderPlayerIndex: 1 });
    const before = JSON.parse(JSON.stringify(snap));
    transitionToBroken({
      snapshot: snap,
      currentFrame: 10,
      dropPosition: { x: 0, y: 0 },
    });
    expect(snap).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 5. transitionToBroken — rejection paths
// ---------------------------------------------------------------------------

describe('transitionToBroken — rejection paths', () => {
  it.each<ItemLifecycleState>(['falling', 'broken', 'despawned'])(
    'rejects break from illegal source state %s',
    (sourceState) => {
      const result = transitionToBroken({
        snapshot: makeSnapshot({ state: sourceState }),
        currentFrame: 1,
        dropPosition: { x: 0, y: 0 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Reason should explicitly mention the source state for log
      // diagnosability.
      expect(result.reason.length).toBeGreaterThan(0);
    },
  );

  it('rejects breaking a falling item — drop animation must complete', () => {
    const result = transitionToBroken({
      snapshot: makeSnapshot({ state: 'falling' }),
      currentFrame: 1,
      dropPosition: { x: 0, y: 0 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/falling/);
  });

  it('rejects breaking an already-broken item — idempotency guard', () => {
    // Race condition: durability hit zero on the same tick a TTL
    // fires. The lifecycle module is the arbiter; the second caller
    // sees a structured rejection.
    const result = transitionToBroken({
      snapshot: makeSnapshot({ state: 'broken' }),
      currentFrame: 1,
      dropPosition: { x: 0, y: 0 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/already broken/);
  });

  it('rejects breaking a despawned item — terminal state', () => {
    const result = transitionToBroken({
      snapshot: makeSnapshot({ state: 'despawned' }),
      currentFrame: 1,
      dropPosition: { x: 0, y: 0 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/despawned/);
  });
});

// ---------------------------------------------------------------------------
// 6. transitionToBroken — input validation
// ---------------------------------------------------------------------------

describe('transitionToBroken — input validation', () => {
  it('throws on negative currentFrame', () => {
    expect(() =>
      transitionToBroken({
        snapshot: makeSnapshot({ state: 'held' }),
        currentFrame: -1,
        dropPosition: { x: 0, y: 0 },
      }),
    ).toThrow(/non-negative integer/);
  });

  it('throws on non-integer currentFrame', () => {
    expect(() =>
      transitionToBroken({
        snapshot: makeSnapshot({ state: 'held' }),
        currentFrame: 1.5,
        dropPosition: { x: 0, y: 0 },
      }),
    ).toThrow(/non-negative integer/);
  });

  it('throws on NaN currentFrame', () => {
    expect(() =>
      transitionToBroken({
        snapshot: makeSnapshot({ state: 'held' }),
        currentFrame: NaN,
        dropPosition: { x: 0, y: 0 },
      }),
    ).toThrow();
  });

  it('throws on Infinity currentFrame', () => {
    expect(() =>
      transitionToBroken({
        snapshot: makeSnapshot({ state: 'held' }),
        currentFrame: Infinity,
        dropPosition: { x: 0, y: 0 },
      }),
    ).toThrow();
  });

  it('throws on NaN drop position x', () => {
    expect(() =>
      transitionToBroken({
        snapshot: makeSnapshot({ state: 'held' }),
        currentFrame: 0,
        dropPosition: { x: NaN, y: 0 },
      }),
    ).toThrow(/finite/);
  });

  it('throws on Infinity drop position y', () => {
    expect(() =>
      transitionToBroken({
        snapshot: makeSnapshot({ state: 'held' }),
        currentFrame: 0,
        dropPosition: { x: 0, y: Infinity },
      }),
    ).toThrow(/finite/);
  });
});

// ---------------------------------------------------------------------------
// 7. End-to-end invariant: post-break, pickup is disabled
// ---------------------------------------------------------------------------

describe('post-break invariants — Sub-AC 1 headline contract', () => {
  it('broken item rejects pickup via canBePickedUp', () => {
    const result = transitionToBroken({
      snapshot: makeSnapshot({
        state: 'held',
        holderPlayerIndex: TEST_HOLDER_INDEX,
      }),
      currentFrame: 100,
      dropPosition: { x: 50, y: 60 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(canBePickedUp(result.next)).toBe(false);
  });

  it('broken item renders with broken-sprite swap', () => {
    const result = transitionToBroken({
      snapshot: makeSnapshot({ state: 'held' }),
      currentFrame: 100,
      dropPosition: { x: 0, y: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hints = computeItemVisualHints(result.next);
    expect(hints.useBrokenSprite).toBe(true);
    expect(hints.pickupEligible).toBe(false);
    expect(hints.alpha).toBe(ITEM_BROKEN_ALPHA);
  });

  it('broken item is no longer attached to any holder', () => {
    const result = transitionToBroken({
      snapshot: makeSnapshot({
        state: 'held',
        holderPlayerIndex: TEST_HOLDER_INDEX,
      }),
      currentFrame: 100,
      dropPosition: { x: 0, y: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.holderPlayerIndex).toBeNull();
    expect(isHeld(result.next)).toBe(false);
  });

  it('broken-debris position is exactly the supplied dropPosition', () => {
    // Critical for the renderer + AI overlay: the debris must drop
    // at the carrier's hand position, not at the item's pre-break
    // position.
    const dropAt = { x: 999, y: 1234 };
    const result = transitionToBroken({
      snapshot: makeSnapshot({
        state: 'held',
        position: { x: 1, y: 2 }, // Old (irrelevant) position.
      }),
      currentFrame: 0,
      dropPosition: dropAt,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.position).toEqual(dropAt);
  });

  it('broken-debris stateEnteredFrame is the supplied currentFrame', () => {
    // Sub-AC 2 (despawn timer) reads this value to compare against
    // the current frame and reclaim the entity after a short window.
    // It MUST be the break frame, not the previous state's frame.
    const result = transitionToBroken({
      snapshot: makeSnapshot({
        state: 'grounded',
        stateEnteredFrame: 10, // Old value — must be overwritten.
      }),
      currentFrame: 999,
      dropPosition: { x: 0, y: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.next.stateEnteredFrame).toBe(999);
  });
});
