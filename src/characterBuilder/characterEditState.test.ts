import { beforeEach, describe, expect, it } from 'vitest';

import {
  CharacterEditState,
  EDIT_HISTORY_MAX_DEPTH,
} from './characterEditState';
import type { CharacterDataSpec } from '../characters/characterSerializer';
import { parseCharacterDataFile } from '../characters/characterSerializer';
import { getAuthorableCharacterSpec } from '../characters/authorableCharacterRegistry';
import { DONKEYKONG_JAB } from '../characters/DonkeyKong';

const seed = (): CharacterDataSpec =>
  Object.freeze({
    id: 'donkeykong' as const,
    displayName: 'Donkey Kong',
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
    expect(state.getSpec().id).toBe('donkeykong');
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
    state.setDisplayName('Big Kong');
    state.setRole('tank');
    expect(state.getSpec().displayName).toBe('Big Kong');
    expect(state.getSpec().role).toBe('tank');
  });

  it('mutations preserve other fields (immutable update pattern)', () => {
    state.setMovementField('mass', 20);
    expect(state.getSpec().movement.maxRunSpeed).toBe(7.5);
    expect(state.getSpec().body.width).toBe(45);
  });

  it('updates nested move numbers and supports undo', () => {
    state = new CharacterEditState(getAuthorableCharacterSpec('donkeykong'));
    state.setMoveNumericField('jab', ['hitbox', 'offsetX'], 30);
    expect(state.getSpec().moves?.jab?.hitbox.offsetX).toBe(30);
    expect(state.getSpec().moves?.jab?.damage).toBe(DONKEYKONG_JAB.damage);
    state.undo();
    expect(state.getSpec().moves?.jab?.hitbox.offsetX).toBe(DONKEYKONG_JAB.hitbox.offsetX);
  });

  it('rejects non-numeric and unknown move fields', () => {
    const donkeykong = getAuthorableCharacterSpec('donkeykong');
    state = new CharacterEditState({ ...donkeykong, moves: { jab: donkeykong.moves!.jab! } });
    expect(() => state.setMoveNumericField('jab', ['id'], 3)).toThrow(/not numeric/);
    expect(() => state.setMoveNumericField('nair', ['damage'], 3)).toThrow(/not authored/);
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
    state.loadSpec({ ...seed(), id: 'pikachu' as const, displayName: 'Pikachu' });
    expect(state.getSpec().id).toBe('pikachu');
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

describe('authoring identity and explicit geometry transport (prepared end-phase)',()=>{
  const attack={id:'custom.jab',sourcePoseId:'link.jab',type:'jab' as const,damage:3,
    knockback:{x:2,y:-1,scaling:.1},hitbox:{offsetX:18,offsetY:-5,width:20,height:12},
    startupFrames:4,activeFrames:2,recoveryFrames:9,cooldownFrames:0,
    hitWindows:[{startFrame:4,endFrame:6,group:'first',collisionHits:[{id:0,capsule:{start:{x:12,y:-5},end:{x:24,y:-5},radius:4}}]}]};
  const authored=()=>({...seed(),moves:{jab:{...attack,jabChain:{nextId:'custom.jab2',advanceWindowStart:4,continuationWindowEndFrame:14}},
    jab2:{...attack,id:'custom.jab2',sourcePoseId:'link.jab2'}}});
  it('renames the real dispatch slot and incoming chain while preserving independent source lineage and undo',()=>{
    const edit=new CharacterEditState(authored());edit.renameMove('jab2','my.jab2');
    const moves=edit.getSpec().moves!;
    expect(moves.jab2?.id).toBe('my.jab2');expect(moves.jab2?.sourcePoseId).toBe('link.jab2');
    expect(moves.jab?.jabChain?.nextId).toBe('my.jab2');edit.undo();expect(edit.getSpec().moves?.jab2?.id).toBe('custom.jab2');
  });
  it('clears previous per-window capsules when explicitly selecting harmless empty geometry, including saved parse transport',()=>{
    const edit=new CharacterEditState(authored());edit.setMoveContactGeometry('jab',{kind:'empty'});
    const saved=parseCharacterDataFile(edit.getSpec(),'explicit-empty Lab fixture');
    expect(saved.moves?.jab?.collisionHits).toEqual([]);expect(saved.moves?.jab?.hitWindows?.[0]?.collisionHits).toBeUndefined();
    expect(saved.moves?.jab?.hitWindows?.[0]?.group).toBe('first');
  });
  it('keeps clean and late packet metadata and edited phase timing separate when materializing capsules',()=>{
    const clean={id:0,damage:11,targetCategory:'fighter' as const,capsule:{start:{x:10,y:-5},end:{x:20,y:-5},radius:4}};
    const late={id:0,damage:6,hitlagMultiplier:.8,capsule:{start:{x:12,y:-2},end:{x:18,y:-2},radius:3}};
    const edit=new CharacterEditState({...seed(),moves:{jab:{...attack,hitWindows:[{startFrame:4,endFrame:6,group:'clean',damage:12},
      {startFrame:8,endFrame:13,group:'late',damage:7}]}}});
    edit.setMoveContactGeometry('jab',{kind:'capsule',hits:[clean],windowHits:[[clean],[late]]});
    const saved=edit.getSpec().moves!.jab!;
    expect(saved.collisionHits).toBeUndefined();expect(saved.hitWindows?.[0]?.collisionHits?.[0]?.damage).toBe(11);
    expect(saved.hitWindows?.[1]?.collisionHits?.[0]?.damage).toBe(6);expect(saved.hitWindows?.[1]?.startFrame).toBe(8);
    expect(saved.hitWindows?.[1]?.damage).toBe(7);expect(saved.hitWindows?.[1]?.collisionHits?.[0]?.hitlagMultiplier).toBe(.8);
  });
  it('sets an explicit window rectangle even when it equals a formerly inherited stock rectangle',()=>{
    const edit=new CharacterEditState(authored());edit.setMoveContactGeometry('jab',{kind:'rectangle',rectangle:attack.hitbox});
    expect(edit.getSpec().moves?.jab?.collisionHits).toBeUndefined();expect(edit.getSpec().moves?.jab?.hitWindows?.[0]?.hitbox).toEqual(attack.hitbox);
    expect(edit.getSpec().moves?.jab?.sourcePoseId).toBe('link.jab');
  });
});
