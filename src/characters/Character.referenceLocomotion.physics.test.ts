import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput, type CharacterOptions } from './Character';
import './attackRegistration';
import { LINK_JAB, LINK_SMASH } from './Link';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function world(options: Partial<CharacterOptions> = {}) {
  const engine = Engine.create();
  const names: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, settings: object) {
      const body = Bodies.rectangle(x, y, width, height, settings);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const ch = new Character(scene, { id: 'link', spawnX: 0, spawnY: 0, ...options });
  const floor = Bodies.rectangle(0, ch.getTuning().height / 2 + 10, 20000, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  });
  Composite.add(engine.world, floor);
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    Engine.update(engine, 1000 / 60);
    ch.applyPostPhysicsVelocityConstraints();
  };
  for (let frame = 0; frame < 12; frame++) step();
  return { ch, step };
}

// Ground contact subtracts 0.004 px/step in Matter; speed tolerances include that friction.
describe('Link UFD ground movement through real Matter steps', () => {
  it.each([-1, 1])('starts a %s dash at 9.9 px and settles to the 7.67 px run', direction => {
    const { ch, step } = world();
    const origin = ch.getPosition().x;
    for (let frame = 0; frame < 12; frame++) {
      step({ ...NEUTRAL, moveX: direction });
      expect(ch.getLocomotionStateName()).toBe('initialDash');
      expect(ch.getVelocity().x).toBeCloseTo(direction * 9.9, 2);
    }
    expect(ch.getPosition().x - origin).toBeCloseTo(direction * 12 * 9.9, 1);
    step({ ...NEUTRAL, moveX: direction });
    expect(ch.getLocomotionStateName()).toBe('run');
    for (let frame = 0; frame < 12; frame++) step({ ...NEUTRAL, moveX: direction });
    expect(ch.getVelocity().x).toBeCloseTo(direction * 7.67, 2);
  });

  it('walks toward the UFD cap using the existing analog stick curve', () => {
    const { ch, step } = world();
    // Halfway between walk and dash thresholds is half of the 6.235 px cap.
    for (let frame = 0; frame < 20; frame++) step({ ...NEUTRAL, moveX: 0.525 });
    expect(ch.getLocomotionStateName()).toBe('walk');
    expect(ch.getVelocity().x).toBeCloseTo(6.235 / 2, 2);
  });

  it('merges a partial constructor override and applies runtime speed edits', () => {
    const { ch, step } = world({ locomotion: { walkMaxSpeed: 4 } });
    step({ ...NEUTRAL, moveX: 1 });
    expect(ch.getVelocity().x).toBeCloseTo(9.9, 2);
    ch.setTuning({ maxRunSpeed: 6, locomotion: { initialDashSpeed: 11 } });
    step();
    step({ ...NEUTRAL, moveX: -1 });
    expect(ch.getVelocity().x).toBeCloseTo(-11, 2);
    for (let frame = 0; frame < 35; frame++) step({ ...NEUTRAL, moveX: -1 });
    expect(ch.getVelocity().x).toBeCloseTo(-6, 2);
    expect(ch.getTuning().locomotion.walkMaxSpeed).toBe(4);
  });

  it('lets an explicit false override disable the dash impulse', () => {
    const { ch, step } = world({ locomotion: { initialDashInstantStart: false } });
    step({ ...NEUTRAL, moveX: 1 });
    expect(ch.getVelocity().x).toBeCloseTo(ch.getTuning().groundAccel, 2);
  });

  it('does not apply a dash impulse during an active attack or shield', () => {
    const attacking = world();
    attacking.ch.addAttack(LINK_JAB);
    attacking.ch.setDefaultAttack(LINK_JAB.id);
    attacking.step({ ...NEUTRAL, attack: true });
    attacking.step({ ...NEUTRAL, moveX: 1 });
    expect(attacking.ch.getVelocity().x).toBeCloseTo(0, 8);
    const shielding = world();
    shielding.step({ ...NEUTRAL, shield: true, moveX: 1 });
    expect(shielding.ch.getVelocity().x).toBeCloseTo(0, 8);
  });

  it('a same-frame smash press does not gain an initial dash impulse', () => {
    const { ch, step } = world();
    ch.addAttack(LINK_SMASH);
    ch.setHeavyAttack(LINK_SMASH.id);
    step({ ...NEUTRAL, moveX: 1, attackHeavy: true });
    expect(Math.abs(ch.getVelocity().x)).toBeLessThan(1);
  });

  it('hitstun prevents the dash impulse from overwriting a launch', () => {
    const { ch, step } = world();
    ch.applyHit({ damage: 8, facing: -1, hitlagMultiplier: 0,
      knockback: { x: 4, y: -4, scaling: 0 } });
    step({ ...NEUTRAL, moveX: 1 });
    expect(ch.isInHitstun()).toBe(true);
    expect(ch.getVelocity().x).toBeLessThan(0);
  });
});
