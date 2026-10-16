import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { AppearancePreparation } from '../../../src/characterPresentation/contracts';
import type { AppearanceSubmission } from '../engine/presentation/submission';
import { StagePresenter } from './presenter';

function preparationManager() {
  // Exercise the real presenter preparation/error manager without constructing
  // a browser WebGL context; this backend performs asynchronous CPU setup only.
  const presenter = Object.assign(Object.create(StagePresenter.prototype) as StagePresenter, {
    renderer: {}, camera: new THREE.Camera(), sprites: { scene: new THREE.Scene() },
    preparingAppearances: new WeakMap(), appearanceError: null,
  });
  return { prepare: (submission: AppearanceSubmission) => (Reflect.get(presenter as object, 'prepareAppearance') as (this: StagePresenter, value: AppearanceSubmission, screen: boolean) => void).call(presenter, submission, false),
    error: () => Reflect.get(presenter, 'appearanceError') as Error | null };
}

describe('presenter appearance preparation ownership', () => {
  it('ignores a reset generation cancellation before the replacement preparation starts', async () => {
    const manager = preparationManager();
    let generation = 0, reject!: (error: Error) => void;
    const pending = new Promise<AppearancePreparation>((_resolve, fail) => { reject = fail; });
    const submission: AppearanceSubmission = { active: true, get preparationGeneration() { return generation; },
      prepare: () => pending, submit: () => undefined };
    manager.prepare(submission);
    generation++;
    reject(new Error('Appearance preparation cancelled'));
    await Promise.resolve();
    expect(manager.error()).toBeNull();
  });

  it('ignores a superseded promise but reports a failure of the current preparation', async () => {
    const manager = preparationManager();
    let rejectOld!: (error: Error) => void, rejectNew!: (error: Error) => void;
    const old = new Promise<AppearancePreparation>((_resolve, reject) => { rejectOld = reject; });
    const replacement = new Promise<AppearancePreparation>((_resolve, reject) => { rejectNew = reject; });
    let pending = old;
    const submission: AppearanceSubmission = { active: true, prepare: () => pending, submit: () => undefined };
    manager.prepare(submission);
    pending = replacement;
    manager.prepare(submission);
    rejectOld(new Error('Stale cancelled preparation'));
    await Promise.resolve();
    expect(manager.error()).toBeNull();
    rejectNew(new Error('Current backend failed'));
    await Promise.resolve();
    expect(manager.error()?.message).toBe('Current backend failed');
  });
});
