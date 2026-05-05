import { describe, it, expect } from 'vitest';
import {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
  categoriesCollide,
} from '../engine/collisionCategories';
import {
  PLATFORM_COLLIDER_MODES,
  applyPlatformColliderState,
  computePlatformColliderState,
  togglePlatformCollision,
  type PlatformColliderState,
  type ToggleablePlatformBody,
} from './platformCollisionToggle';

/**
 * Sub-AC 3 of AC 90303 — Matter.js collision toggling logic.
 *
 * These tests lock down:
 *
 *   1. The canonical mode list contains the four documented states.
 *   2. `computePlatformColliderState` is a pure function of its inputs:
 *      • Solid platforms always resolve to the SOLID filter regardless
 *        of `dropThroughCount`.
 *      • Pass-through platforms switch to `'pass-through-drop'` when at
 *        least one fighter is dropping through; the CHARACTER bit is
 *        dropped from the mask but the category is preserved.
 *      • Moving platforms behave like solid by default, like
 *        pass-through when `passThrough: true`.
 *      • `isSolid: false` short-circuits to `'inactive'` regardless of
 *        behavior — the platform is non-collidable.
 *   3. `applyPlatformColliderState` mutates the existing
 *      `collisionFilter` object (vs replacing it) so Matter's internal
 *      pair-tracking references stay valid, and reports whether the
 *      call actually changed either field.
 *   4. `togglePlatformCollision` composes compute + apply correctly.
 *   5. Against the bidirectional Matter rule
 *      `(a.mask & b.cat) && (b.mask & a.cat)`:
 *      • A solid platform collides with characters/projectiles/items.
 *      • A pass-through platform collides with characters but NOT
 *        projectiles.
 *      • A pass-through-drop platform does NOT collide with characters.
 *      • An inactive platform does NOT collide with anything.
 *   6. The test/runtime contract: tests can drive the applier with a
 *      plain `ToggleablePlatformBody` shape — no Matter import needed.
 */

// Stand-in counterparties for the bidirectional collide test below.
const CHARACTER_BODY = {
  category: COLLISION_CATEGORIES.CHARACTER,
  mask: COLLISION_MASKS.CHARACTER,
};
const PROJECTILE_BODY = {
  category: COLLISION_CATEGORIES.PROJECTILE,
  mask: COLLISION_MASKS.PROJECTILE,
};
const ITEM_BODY = {
  category: COLLISION_CATEGORIES.ITEM,
  mask: COLLISION_MASKS.ITEM,
};

function asBodyFilter(state: PlatformColliderState) {
  return { category: state.category, mask: state.mask };
}

describe('PLATFORM_COLLIDER_MODES — canonical list of runtime modes', () => {
  it('enumerates exactly solid, pass-through, pass-through-drop, inactive', () => {
    expect(PLATFORM_COLLIDER_MODES).toEqual([
      'solid',
      'pass-through',
      'pass-through-drop',
      'inactive',
    ]);
  });

  it('is frozen so callers cannot mutate the canonical list', () => {
    expect(Object.isFrozen(PLATFORM_COLLIDER_MODES)).toBe(true);
  });
});

describe('computePlatformColliderState() — solid platforms', () => {
  it('resolves a default-solid platform to the SOLID filter', () => {
    const state = computePlatformColliderState({
      behavior: 'solid',
      passThrough: false,
    });
    expect(state.mode).toBe('solid');
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_SOLID);
    expect(state.mask).toBe(COLLISION_MASKS.PLATFORM_SOLID);
  });

  it('ignores dropThroughCount on solid platforms (no-op)', () => {
    const state = computePlatformColliderState({
      behavior: 'solid',
      passThrough: false,
      dropThroughCount: 4,
    });
    expect(state.mode).toBe('solid');
    expect(state.mask).toBe(COLLISION_MASKS.PLATFORM_SOLID);
  });
});

describe('computePlatformColliderState() — pass-through platforms', () => {
  it('resolves to "pass-through" with the CHARACTER-only mask when no fighter is dropping', () => {
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
    });
    expect(state.mode).toBe('pass-through');
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH);
    expect(state.mask).toBe(COLLISION_MASKS.PLATFORM_PASS_THROUGH);
    // The default mask must keep the CHARACTER bit so the platform is
    // standable. (If this regresses, fighters fall through every floor.)
    expect(state.mask & COLLISION_CATEGORIES.CHARACTER).toBeTruthy();
  });

  it('drops the CHARACTER bit when at least one fighter is dropping through', () => {
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      dropThroughCount: 1,
    });
    expect(state.mode).toBe('pass-through-drop');
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH);
    expect(state.mask & COLLISION_CATEGORIES.CHARACTER).toBe(0);
  });

  it('treats dropThroughCount as a refcount: 0 = on, ≥ 1 = off', () => {
    const off = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      dropThroughCount: 0,
    });
    expect(off.mode).toBe('pass-through');

    for (const count of [1, 2, 3, 4]) {
      const drop = computePlatformColliderState({
        behavior: 'pass-through',
        passThrough: true,
        dropThroughCount: count,
      });
      expect(drop.mode).toBe('pass-through-drop');
    }
  });

  it('preserves the platform category in pass-through-drop mode (Matter pair stability)', () => {
    const drop = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      dropThroughCount: 1,
    });
    // Category must be unchanged so any pair-tracking the watcher does
    // by category survives the toggle.
    expect(drop.category).toBe(COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH);
  });
});

describe('computePlatformColliderState() — moving platforms', () => {
  it('moving + !passThrough behaves like solid', () => {
    const state = computePlatformColliderState({
      behavior: 'moving',
      passThrough: false,
    });
    expect(state.mode).toBe('solid');
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_SOLID);
    expect(state.mask).toBe(COLLISION_MASKS.PLATFORM_SOLID);
  });

  it('moving + passThrough behaves like pass-through (default)', () => {
    const state = computePlatformColliderState({
      behavior: 'moving',
      passThrough: true,
    });
    expect(state.mode).toBe('pass-through');
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH);
  });

  it('moving + passThrough + dropThroughCount → pass-through-drop', () => {
    const state = computePlatformColliderState({
      behavior: 'moving',
      passThrough: true,
      dropThroughCount: 2,
    });
    expect(state.mode).toBe('pass-through-drop');
    expect(state.mask & COLLISION_CATEGORIES.CHARACTER).toBe(0);
  });
});

describe('computePlatformColliderState() — isSolid: false short-circuits to inactive', () => {
  it('inactive solid: category preserved, mask = 0', () => {
    const state = computePlatformColliderState({
      behavior: 'solid',
      passThrough: false,
      isSolid: false,
    });
    expect(state.mode).toBe('inactive');
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_SOLID);
    expect(state.mask).toBe(0);
  });

  it('inactive pass-through: pass-through category preserved, mask = 0', () => {
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      isSolid: false,
    });
    expect(state.mode).toBe('inactive');
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH);
    expect(state.mask).toBe(0);
  });

  it('inactive moving + passThrough: pass-through category preserved', () => {
    const state = computePlatformColliderState({
      behavior: 'moving',
      passThrough: true,
      isSolid: false,
    });
    expect(state.mode).toBe('inactive');
    expect(state.category).toBe(COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH);
    expect(state.mask).toBe(0);
  });

  it('inactive overrides dropThroughCount — non-collidable wins', () => {
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      isSolid: false,
      dropThroughCount: 5,
    });
    expect(state.mode).toBe('inactive');
    expect(state.mask).toBe(0);
  });
});

describe('Matter bidirectional collision rule against computed states', () => {
  it('solid platform collides with characters, projectiles, and items', () => {
    const state = computePlatformColliderState({
      behavior: 'solid',
      passThrough: false,
    });
    const filter = asBodyFilter(state);
    expect(categoriesCollide(filter, CHARACTER_BODY)).toBe(true);
    expect(categoriesCollide(filter, PROJECTILE_BODY)).toBe(true);
    expect(categoriesCollide(filter, ITEM_BODY)).toBe(true);
  });

  it('pass-through platform collides with characters but NOT projectiles', () => {
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
    });
    const filter = asBodyFilter(state);
    expect(categoriesCollide(filter, CHARACTER_BODY)).toBe(true);
    expect(categoriesCollide(filter, PROJECTILE_BODY)).toBe(false);
  });

  it('pass-through-drop platform does NOT collide with characters', () => {
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      dropThroughCount: 1,
    });
    const filter = asBodyFilter(state);
    expect(categoriesCollide(filter, CHARACTER_BODY)).toBe(false);
    // Projectiles still don't collide either (they never did).
    expect(categoriesCollide(filter, PROJECTILE_BODY)).toBe(false);
  });

  it('inactive platform collides with nothing', () => {
    const state = computePlatformColliderState({
      behavior: 'solid',
      passThrough: false,
      isSolid: false,
    });
    const filter = asBodyFilter(state);
    expect(categoriesCollide(filter, CHARACTER_BODY)).toBe(false);
    expect(categoriesCollide(filter, PROJECTILE_BODY)).toBe(false);
    expect(categoriesCollide(filter, ITEM_BODY)).toBe(false);
  });
});

describe('applyPlatformColliderState() — writes to a Matter body in place', () => {
  function makeBody(): ToggleablePlatformBody {
    return {
      collisionFilter: {
        category: COLLISION_CATEGORIES.PLATFORM_SOLID,
        mask: COLLISION_MASKS.PLATFORM_SOLID,
        group: 0,
      },
    };
  }

  it('mutates the existing collisionFilter object (preserves Matter pair refs)', () => {
    const body = makeBody();
    const original = body.collisionFilter;
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
    });
    applyPlatformColliderState(body, state);
    // Same object reference — only fields changed.
    expect(body.collisionFilter).toBe(original);
    expect(body.collisionFilter.category).toBe(state.category);
    expect(body.collisionFilter.mask).toBe(state.mask);
  });

  it('preserves the existing group field (we do not use Matter group)', () => {
    const body = makeBody();
    body.collisionFilter.group = 7;
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
    });
    applyPlatformColliderState(body, state);
    expect(body.collisionFilter.group).toBe(7);
  });

  it('returns true when the call changes either field', () => {
    const body = makeBody();
    const state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
    });
    expect(applyPlatformColliderState(body, state)).toBe(true);
  });

  it('returns false when the call is a no-op (idempotent re-apply)', () => {
    const body = makeBody();
    const state = computePlatformColliderState({
      behavior: 'solid',
      passThrough: false,
    });
    // Body already starts with the SOLID filter — the apply is a no-op.
    expect(applyPlatformColliderState(body, state)).toBe(false);
    // Doing it again is still a no-op.
    expect(applyPlatformColliderState(body, state)).toBe(false);
  });

  it('round-trips through every mode without leaking state across modes', () => {
    const body = makeBody();
    // pass-through
    let state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
    });
    applyPlatformColliderState(body, state);
    expect(body.collisionFilter.category).toBe(
      COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
    );
    expect(body.collisionFilter.mask).toBe(COLLISION_MASKS.PLATFORM_PASS_THROUGH);

    // pass-through-drop
    state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      dropThroughCount: 1,
    });
    applyPlatformColliderState(body, state);
    expect(body.collisionFilter.mask & COLLISION_CATEGORIES.CHARACTER).toBe(0);

    // back to pass-through (drop ended)
    state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      dropThroughCount: 0,
    });
    applyPlatformColliderState(body, state);
    expect(body.collisionFilter.mask & COLLISION_CATEGORIES.CHARACTER).toBeTruthy();

    // inactive
    state = computePlatformColliderState({
      behavior: 'pass-through',
      passThrough: true,
      isSolid: false,
    });
    applyPlatformColliderState(body, state);
    expect(body.collisionFilter.mask).toBe(0);

    // back to solid
    state = computePlatformColliderState({
      behavior: 'solid',
      passThrough: false,
    });
    applyPlatformColliderState(body, state);
    expect(body.collisionFilter.category).toBe(
      COLLISION_CATEGORIES.PLATFORM_SOLID,
    );
    expect(body.collisionFilter.mask).toBe(COLLISION_MASKS.PLATFORM_SOLID);
  });
});

describe('togglePlatformCollision() — compute + apply convenience entry', () => {
  it('returns the resolved state and writes it to the body', () => {
    const body: ToggleablePlatformBody = {
      collisionFilter: {
        category: COLLISION_CATEGORIES.PLATFORM_SOLID,
        mask: COLLISION_MASKS.PLATFORM_SOLID,
      },
    };
    const state = togglePlatformCollision(body, {
      behavior: 'pass-through',
      passThrough: true,
      dropThroughCount: 1,
    });
    expect(state.mode).toBe('pass-through-drop');
    expect(body.collisionFilter.category).toBe(state.category);
    expect(body.collisionFilter.mask).toBe(state.mask);
  });

  it('handles inactive crumbling platform end-to-end', () => {
    const body: ToggleablePlatformBody = {
      collisionFilter: {
        category: COLLISION_CATEGORIES.PLATFORM_SOLID,
        mask: COLLISION_MASKS.PLATFORM_SOLID,
      },
    };
    // Mid-fall: no longer solid.
    let state = togglePlatformCollision(body, {
      behavior: 'solid',
      passThrough: false,
      isSolid: false,
    });
    expect(state.mode).toBe('inactive');
    expect(categoriesCollide(asBodyFilter(state), CHARACTER_BODY)).toBe(false);

    // Respawned: solid again.
    state = togglePlatformCollision(body, {
      behavior: 'solid',
      passThrough: false,
      isSolid: true,
    });
    expect(state.mode).toBe('solid');
    expect(categoriesCollide(asBodyFilter(state), CHARACTER_BODY)).toBe(true);
  });
});

describe('determinism — identical inputs produce identical outputs', () => {
  it('is a pure function of (behavior, passThrough, isSolid, dropThroughCount)', () => {
    const inputs = [
      { behavior: 'solid' as const, passThrough: false },
      { behavior: 'pass-through' as const, passThrough: true },
      { behavior: 'pass-through' as const, passThrough: true, dropThroughCount: 1 },
      { behavior: 'moving' as const, passThrough: false },
      { behavior: 'moving' as const, passThrough: true },
      { behavior: 'moving' as const, passThrough: true, dropThroughCount: 3 },
      { behavior: 'solid' as const, passThrough: false, isSolid: false },
      { behavior: 'pass-through' as const, passThrough: true, isSolid: false },
    ];
    for (const input of inputs) {
      const a = computePlatformColliderState(input);
      const b = computePlatformColliderState(input);
      expect(a).toEqual(b);
    }
  });

  it('does not mutate the input record', () => {
    const input = {
      behavior: 'pass-through' as const,
      passThrough: true,
      dropThroughCount: 1,
    };
    const before = { ...input };
    computePlatformColliderState(input);
    expect(input).toEqual(before);
  });
});
