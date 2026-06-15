import { beforeEach, describe, expect, it } from 'vitest';

import {
  CharacterEditState,
  EDIT_HISTORY_MAX_DEPTH,
} from './characterEditState';
import type { CharacterDataSpec } from '../characters/characterSerializer';

const seed = (): CharacterDataSpec =>
  Object.freeze({
    id: 'wolf' as const,
    displayName: 'Wolf',
    role: 'bruiser',
    body: { width: 45, height: 66, chamfer: 8 },
    movement: {
      maxRunSpeed: 7.5,
      groundAccel: 0.65,
      airAccel: 0.3,
      groundDamping: 0.78,
      airDamping: 0.95,
      jumpImpulse: 12.5,
      maxJumps: 2,
      mass: 16,
      fallAccel: 0.3,
      maxFallSpeed: 11.0,
      fastFallSpeed: 17.5,
      jumpCutFactor: 0.4,
    },
  });

let state: CharacterEditState;
beforeEach(() => {
  state = new CharacterEditState(seed());
});

describe('CharacterEditState — initial state', () => {
  it('is not dirty out of the gate', () => {
    expect(state.isDirty()).toBe(false);
  });

  it('exposes the seeded spec', () => {
    expect(state.getSpec().id).toBe('wolf');
    expect(state.getSpec().movement.mass).toBe(16);
  });

  it('cannot undo or redo with no history', () => {
    expect(state.canUndo()).toBe(false);
    expect(state.canRedo()).toBe(false);
  });
});

describe('CharacterEditState — mutations', () => {
  it('setMovementField updates the field and marks dirty', () => {
    state.setMovementField('mass', 20);
    expect(state.getSpec().movement.mass).toBe(20);
    expect(state.isDirty()).toBe(true);
  });

  it('setMovementField with the same value is a no-op', () => {
    state.setMovementField('mass', 16);
    expect(state.isDirty()).toBe(false);
    expect(state.canUndo()).toBe(false);
  });

  it('setBodyField updates body geometry', () => {
    state.setBodyField('width', 60);
    expect(state.getSpec().body.width).toBe(60);
    expect(state.getSpec().body.height).toBe(66);
  });

  it('setDisplayName / setRole update text fields', () => {
    state.setDisplayName('Big Wolf');
    state.setRole('tank');
    expect(state.getSpec().displayName).toBe('Big Wolf');
    expect(state.getSpec().role).toBe('tank');
  });

  it('mutations preserve other fields (immutable update pattern)', () => {
    state.setMovementField('mass', 20);
    expect(state.getSpec().movement.maxRunSpeed).toBe(7.5);
    expect(state.getSpec().body.width).toBe(45);
  });
});

describe('CharacterEditState — change subscriptions', () => {
  it('fires the listener on each mutation', () => {
    const calls: number[] = [];
    state.onChange((next) => calls.push(next.movement.mass));
    state.setMovementField('mass', 20);
    state.setMovementField('mass', 24);
    expect(calls).toEqual([20, 24]);
  });

  it('returns an unsubscribe function', () => {
    const calls: number[] = [];
    const unsub = state.onChange((next) => calls.push(next.movement.mass));
    state.setMovementField('mass', 20);
    unsub();
    state.setMovementField('mass', 24);
    expect(calls).toEqual([20]);
  });

  it('survives a misbehaving listener (one throw doesn\'t break others)', () => {
    const calls: number[] = [];
    state.onChange(() => {
      throw new Error('boom');
    });
    state.onChange((next) => calls.push(next.movement.mass));
    state.setMovementField('mass', 20);
    expect(calls).toEqual([20]);
  });
});

describe('CharacterEditState — undo / redo', () => {
  it('undo reverts the most recent mutation', () => {
    state.setMovementField('mass', 20);
    expect(state.getSpec().movement.mass).toBe(20);
    state.undo();
    expect(state.getSpec().movement.mass).toBe(16);
    expect(state.canUndo()).toBe(false);
  });

  it('redo re-applies the most recently undone mutation', () => {
    state.setMovementField('mass', 20);
    state.undo();
    state.redo();
    expect(state.getSpec().movement.mass).toBe(20);
  });

  it('a new mutation after undo invalidates redo', () => {
    state.setMovementField('mass', 20);
    state.undo();
    expect(state.canRedo()).toBe(true);
    state.setBodyField('width', 50);
    expect(state.canRedo()).toBe(false);
  });

  it('history stack is bounded', () => {
    for (let i = 0; i < EDIT_HISTORY_MAX_DEPTH + 10; i += 1) {
      state.setMovementField('mass', i + 1);
    }
    // Drain the stack — should hit the floor cleanly without throwing.
    let undosFired = 0;
    while (state.canUndo()) {
      state.undo();
      undosFired += 1;
    }
    expect(undosFired).toBeLessThanOrEqual(EDIT_HISTORY_MAX_DEPTH);
  });
});

describe('CharacterEditState — clean / loadSpec / reset', () => {
  it('markClean snapshots the working spec as the new clean baseline', () => {
    state.setMovementField('mass', 20);
    expect(state.isDirty()).toBe(true);
    state.markClean();
    expect(state.isDirty()).toBe(false);
  });

  it('loadSpec replaces the working spec and clears history', () => {
    state.setMovementField('mass', 20);
    state.loadSpec({ ...seed(), id: 'cat' as const, displayName: 'Cat' });
    expect(state.getSpec().id).toBe('cat');
    expect(state.canUndo()).toBe(false);
    expect(state.isDirty()).toBe(false);
  });

  it('reset returns the working spec to the clean checkpoint', () => {
    state.setMovementField('mass', 20);
    state.setBodyField('width', 60);
    state.reset();
    expect(state.getSpec().movement.mass).toBe(16);
    expect(state.getSpec().body.width).toBe(45);
    expect(state.isDirty()).toBe(false);
    expect(state.canUndo()).toBe(false);
  });
});
