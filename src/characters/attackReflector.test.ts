import { describe, expect, it } from 'vitest';
import { activeReflector } from './attackReflector';
import { HOME_RUN_BAT_DEFINITION } from '../items/HomeRunBat';
import type { AttackMove } from './attacks';

const fsmash = HOME_RUN_BAT_DEFINITION.uses!.fsmash!;
const sideReflector = {
  id: 't.reflector', type: 'sideSpecial', sideSpecialKind: 'reflector', damage: 2,
  knockback: { x: 1, y: 0, scaling: 0 }, hitbox: { offsetX: 0, offsetY: 0, width: 1, height: 1 },
  startupFrames: 2, activeFrames: 3, recoveryFrames: 4, cooldownFrames: 0,
  reflector: { reflectMultiplier: 1.5, velocityScale: 1.2, contactDamage: 2, contactKnockback: { x: 1, y: 0, scaling: 0 },
    reflectorBody: { offsetX: 30, offsetY: 0, width: 20, height: 40 } },
} as unknown as AttackMove;

describe('activeReflector — one reflector read for side-special reflectors and move reflect windows', () => {
  it('a reflector side special reflects in its active phase only', () => {
    expect(activeReflector({ move: sideReflector, phase: 'startup', framesElapsed: 1 })).toBeNull();
    expect(activeReflector({ move: sideReflector, phase: 'active', framesElapsed: 2 }))
      .toEqual({ body: { offsetX: 30, offsetY: 0, width: 20, height: 40 }, damageScale: 1.5, velocityScale: 1.2, swingOnReflect: false });
  });

  it('the bat forward smash reflects across its window, including the wind-up', () => {
    const w = fsmash.reflectWindow!;
    expect(activeReflector({ move: fsmash, phase: 'startup', framesElapsed: w.startFrame })).toMatchObject({ swingOnReflect: true });
    expect(activeReflector({ move: fsmash, phase: 'startup', framesElapsed: 30 })).not.toBeNull();
    expect(activeReflector({ move: fsmash, phase: 'recovery', framesElapsed: w.endFrame })).toBeNull();
  });

  it('an ordinary move never reflects', () => {
    expect(activeReflector({ move: HOME_RUN_BAT_DEFINITION.uses!.jab!, phase: 'active', framesElapsed: 3 })).toBeNull();
  });
});
