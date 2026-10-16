import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput, type CharacterOptions } from './Character';
import './attackRegistration';
import type { AerialMove } from './aerialSchema';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { LINK_MOVEMENT_PROFILE } from './fighterMovementProfiles';
import { LINK_NAIR, LINK_FAIR, LINK_BAIR, LINK_UAIR, LINK_DAIR } from './Link';
import { getMoveBusyFrames } from './moveSchema';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, jump: false };
const AERIAL: AerialMove = {
  id: 'landing.nair', type: 'aerial', aerialDirection: 'neutral',
  damage: 5, knockback: { x: 1, y: -1, scaling: 0 },
  hitbox: { offsetX: 50, offsetY: 0, width: 30, height: 30 },
  startupFrames: 4, activeFrames: 4, recoveryFrames: 8, cooldownFrames: 20,
  landingLagFrames: 6,
  autoCancelWindows: [{ startFrame: 0, endFrame: 2 }, { startFrame: 13, endFrame: 16 }],
};

/** The actual Phaser Matter integration supplies contact timing and normals. */
function physicsWorld(options: Partial<CharacterOptions> = {}) {
  const engine = Engine.create();
  engine.gravity.y = 0;
  const scene: any = { matter: {
    body: Body,
    add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
      const body = Bodies.rectangle(x, y, w, h, options);
      Composite.add(engine.world, body);
      return body;
    } },
    world: {
      on(event: string, fn: (...args: any[]) => void) {
        Events.on(engine, event === 'collisionstart' ? 'collisionStart' :
          event === 'collisionactive' ? 'collisionActive' : 'collisionEnd', fn);
      },
      off(event: string, fn: (...args: any[]) => void) {
        Events.off(engine, event === 'collisionstart' ? 'collisionStart' :
          event === 'collisionactive' ? 'collisionActive' : 'collisionEnd', fn);
      },
      remove(body: any) { Composite.remove(engine.world, body); },
    },
  } };
  const ch = new Character(scene, { id: 'link', spawnX: 0, spawnY: 0, ...options });
  const step = (input = NEUTRAL) => {
    ch.applyInput(input);
    Engine.update(engine, 1000 / 60);
    ch.applyPostPhysicsVelocityConstraints();
  };
  return { ch, engine, step };
}

function landingAt(moveFrame: number, move = AERIAL, nextAction?: CharacterInput) {
  // Zero ordinary landing lag isolates the aerial's own landing penalty.
  const { ch, engine, step } = physicsWorld({ softLandingFrames: 0, hardLandingFrames: 0 });
  ch.registerAttack(move);
  ch.registerAttack({ ...move, id: 'landing.jab', type: 'jab' });
  step({ ...NEUTRAL, attack: true });
  for (let frame = 1; frame < moveFrame; frame += 1) {
    step(frame === 17 ? nextAction : undefined);
  }
  const pos = ch.getPosition();
  const floor = Bodies.rectangle(pos.x, pos.y + ch.getTuning().height / 2 + 12, 2000, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  });
  Composite.add(engine.world, floor);
  Body.setVelocity(ch.body, { x: 0, y: 3 });
  step();
  expect(ch.isGrounded()).toBe(true);
  if (moveFrame < getMoveBusyFrames(move)) expect(ch.getActiveAttack()?.framesElapsed).toBe(moveFrame);
  return { ch, step, engine, floor };
}

describe('Character — real Matter aerial landing timeline', () => {
  it.each([
    [LINK_NAIR, 2, 0], [LINK_NAIR, 3, 6], [LINK_NAIR, 34, 6], [LINK_NAIR, 35, 0],
    [LINK_FAIR, 50, 11], [LINK_FAIR, 51, 11], [LINK_FAIR, 52, 0],
    [LINK_BAIR, 27, 6], [LINK_BAIR, 28, 0],
    [LINK_UAIR, 9, 0], [LINK_UAIR, 10, 14], [LINK_UAIR, 41, 14], [LINK_UAIR, 42, 0],
    [LINK_DAIR, 8, 0], [LINK_DAIR, 9, 19], [LINK_DAIR, 63, 19], [LINK_DAIR, 64, 0],
  ].map(([move, frame, lag]) => ({ move: move as AerialMove, frame: frame as number, lag: lag as number, id: (move as AerialMove).id })))('$id lands on elapsed frame $frame with penalty $lag', ({ move, frame, lag }) => {
    const { ch, step } = landingAt(frame, move);
    if (frame >= getMoveBusyFrames(move)) expect(ch.canAttack()).toBe(true);
    step();
    expect(ch.getCooldownRemaining()).toBe(lag);
  });

  it.each([2, 3, 4, 7, 8, 12])('landing on move frame %s has exactly six committed input steps', (frame) => {
    const { ch, step } = landingAt(frame);
    step(); // Landing recovery step 1.
    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.getCooldownRemaining()).toBe(6);
    for (let lockedStep = 2; lockedStep <= 6; lockedStep += 1) {
      step({ ...NEUTRAL, moveX: 1 });
      expect(ch.getVelocity().x).toBe(0);
      expect(ch.isShielding()).toBe(false);
    }
    step({ ...NEUTRAL, shield: true }); // First actionable step is 7.
    expect(ch.isShielding()).toBe(true);
  });

  it.each(['jump', 'attack'] as const)('a last-step buffered %s starts on the first actionable step', (action) => {
    const { ch, step } = landingAt(5);
    step();
    for (let lockedStep = 2; lockedStep < 6; lockedStep += 1) step();
    step({ ...NEUTRAL, [action]: true });
    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.getJumpsquatRemaining()).toBe(0);
    step();
    if (action === 'jump') expect(ch.getJumpsquatRemaining()).toBe(3);
    else expect(ch.getActiveAttack()?.move.id).toBe('landing.jab');
  });

  it.each([1, 13, 15])('an autocancel on move frame %s permits same-step defense', (frame) => {
    const { ch, step } = landingAt(frame);
    step({ ...NEUTRAL, shield: true });
    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.getCooldownRemaining()).toBe(0);
    expect(ch.isShielding()).toBe(true);
  });

  it('a one-frame landing lockout blocks only touchdown, irrespective of aerial cooldown', () => {
    const { ch, step } = landingAt(5, { ...AERIAL, landingLagFrames: 1 });
    step({ ...NEUTRAL, attack: true });
    expect(ch.getActiveAttack()).toBeNull();
    step();
    expect(ch.getActiveAttack()?.move.id).toBe('landing.jab');
  });

  it('a landed aerial cannot keep a damage sensor during its recovery', () => {
    const { ch, step, engine } = landingAt(5);
    const sensor = ch.getActiveAttack()?.hitboxBody;
    expect(sensor).not.toBeNull();
    step();
    expect(Composite.allBodies(engine.world)).not.toContain(sensor);
  });

  it.each([15, 16, 17, 18])('keeps an explicit late landing flag through frame %s without extending commitment', (frame) => {
    const move = { ...AERIAL, cooldownFrames: 0, autoCancelWindows: [{ startFrame: 18, endFrame: 19 }] };
    const { ch, step } = landingAt(frame, move);
    if (frame >= 16) expect(ch.canAttack()).toBe(true);
    step();
    expect(ch.getCooldownRemaining()).toBe(frame < 18 ? 6 : 0);
  });

  it('a successful air jump replaces the previous actionable aerial landing flag', () => {
    const move = { ...AERIAL, cooldownFrames: 0, autoCancelWindows: [{ startFrame: 24, endFrame: 25 }] };
    const { ch, step } = landingAt(18, move, { ...NEUTRAL, jump: true });
    expect(ch.getJumpsUsed()).toBe(1);
    step();
    expect(ch.getCooldownRemaining()).toBe(0);
  });

  it('hitlag freezes landing recovery without adding an extra actionable delay', () => {
    const { ch, step } = landingAt(5);
    step();
    ch.armAttackerHitlag(3);
    for (let frozen = 0; frozen < 3; frozen += 1) {
      step();
      expect(ch.getCooldownRemaining()).toBe(6);
    }
    for (let lockedStep = 2; lockedStep <= 6; lockedStep += 1) step();
    step({ ...NEUTRAL, jump: true });
    expect(ch.getJumpsquatRemaining()).toBe(3);
  });

  it('drop-through cannot cancel a landing penalty, but is legal on the first free step', () => {
    const { ch, step } = landingAt(5);
    for (let lockedStep = 1; lockedStep <= 6; lockedStep += 1) {
      step({ ...NEUTRAL, dropThrough: true });
      expect(ch.isInDropThroughWindow()).toBe(false);
    }
    step({ ...NEUTRAL, dropThrough: true });
    expect(ch.isInDropThroughWindow()).toBe(true);
  });
});

describe('Character — measured Link movement in physical viewport pixels', () => {
  it.each(['full', 'short', 'full-fastfall', 'short-fastfall', 'late-release'] as const)('measures the %s jump with real gravity and floor contact', (mode) => {
    const { ch, engine, step } = physicsWorld({ id: 'link', ...LINK_MOVEMENT_PROFILE });
    engine.gravity.y = 1;
    const floor = Bodies.rectangle(0, ch.getTuning().height / 2 + 10, 2000, 20, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    });
    Composite.add(engine.world, floor);
    for (let settle = 0; settle < 5; settle += 1) step();
    expect(ch.isGrounded()).toBe(true);
    const startY = ch.getPosition().y;
    let apexY = startY;
    let firstAirborneStep = 0;
    let landingStep = 0;
    let maxDescent = 0;
    for (let frame = 1; frame < 200; frame += 1) {
      step({ ...NEUTRAL,
        jump: frame === 1 || (mode === 'late-release' ? frame <= 5 : !mode.startsWith('short')),
        moveY: mode.endsWith('fastfall') && ch.getVelocity().y > 0 ? 1 : 0,
      });
      apexY = Math.min(apexY, ch.getPosition().y);
      if (!ch.isGrounded()) {
        if (!firstAirborneStep) firstAirborneStep = frame;
        maxDescent = Math.max(maxDescent, ch.getVelocity().y);
      } else if (firstAirborneStep) {
        landingStep = frame;
        break;
      }
    }
    const short = mode.startsWith('short');
    const initialSpeed = short ? LINK_MOVEMENT_PROFILE.shortHopImpulse! : LINK_MOVEMENT_PROFILE.jumpImpulse;
    const gravity = engine.gravity.scale * (1000 / 60) ** 2 +
      (short ? LINK_MOVEMENT_PROFILE.shortHopRiseAccel! : LINK_MOVEMENT_PROFILE.riseAccel!);
    const risingSteps = Math.ceil(initialSpeed / gravity) - 1;
    const expectedHeight = risingSteps * initialSpeed - gravity * risingSteps * (risingSteps + 1) / 2;
    expect(firstAirborneStep).toBe(4); // Press plus the existing three-step squat.
    // Contact solving settles the resting body by a fraction of a pixel
    // during the squat; compare the ballistic prediction within 0.001 px.
    expect(Math.abs(startY - apexY - expectedHeight)).toBeLessThan(0.001);
    expect(startY - apexY).toBeCloseTo(short ? 13.38 * 5 : 27.8 * 5, 2);
    const duration = landingStep - firstAirborneStep + 1;
    const targetDuration = mode === 'short-fastfall' ? 22 : mode === 'full-fastfall' ? 30 : short ? 33 : 45;
    expect(Math.abs(duration - targetDuration)).toBeLessThanOrEqual(2);
    const terminal = mode.endsWith('fastfall') ? LINK_MOVEMENT_PROFILE.fastFallSpeed : LINK_MOVEMENT_PROFILE.maxFallSpeed;
    expect(maxDescent).toBeLessThanOrEqual(terminal + 1e-9);
    if (process.env.PF_PHYSICS_MEASUREMENTS === '1') {
      console.info('LINK_JUMP_MEASUREMENT', JSON.stringify({ mode, firstAirborneStep, landingStep, height: startY - apexY, maxDescent }));
    }
  });

  it('caps Link air drift at the authored 4.62 px/step while preserving ground speed', () => {
    const { ch, step } = physicsWorld({ id: 'link', ...LINK_MOVEMENT_PROFILE });
    for (let frame = 0; frame < 40; frame += 1) step({ ...NEUTRAL, moveX: 1 });
    expect(ch.getVelocity().x).toBeCloseTo(4.62, 8);
    // SmashWiki / UFD Link (SSBU): run speed 1.534 native units (5 px each).
    expect(ch.getTuning().maxRunSpeed).toBeCloseTo(1.534 * 5, 10);
  });

  it('Link rise calibration leaves hitlag and the complete hitstun launch trajectory unchanged', () => {
    const calibrated = physicsWorld({ id: 'link' });
    const zeroRise = physicsWorld({ id: 'link', riseAccel: 0, shortHopRiseAccel: 0 });
    calibrated.engine.gravity.y = zeroRise.engine.gravity.y = 1;
    const hit = { damage: 12, knockback: { x: 12, y: -12, scaling: 0 }, facing: 1 as const };
    calibrated.ch.applyHit(hit);
    zeroRise.ch.applyHit(hit);
    for (let frame = 0; frame < 100; frame += 1) {
      calibrated.step(); zeroRise.step();
      expect(calibrated.ch.getPosition()).toEqual(zeroRise.ch.getPosition());
      expect(calibrated.ch.getVelocity()).toEqual(zeroRise.ch.getVelocity());
      if (calibrated.ch.getHitlagRemaining() === 0 && calibrated.ch.getHitstunRemaining() === 0) return;
    }
    throw new Error('Launch fixture did not leave hitstun');
  });
});
