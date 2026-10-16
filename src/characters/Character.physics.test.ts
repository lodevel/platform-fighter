import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput, type CharacterOptions } from './Character';
import './attackRegistration';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { LAUNCH_SPEED_DECAY_PER_FRAME } from './combat';

// Use the same Matter implementation Phaser ships, without creating a DOM or
// mocking integration, gravity, contact normals, or the collision solver.
const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, jump: false };
const STEP_MS = 1000 / 60;

function world(options: Partial<CharacterOptions> = {}) {
  const engine = Engine.create();
  const eventNames: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = {
    matter: {
      body: Body,
      add: {
        rectangle(x: number, y: number, w: number, h: number, options: object) {
          const body = Bodies.rectangle(x, y, w, h, options);
          Composite.add(engine.world, body);
          return body;
        },
      },
      world: {
        on(event: string, listener: (...args: any[]) => void) {
          Events.on(engine, eventNames[event] ?? event, listener);
        },
        off(event: string, listener: (...args: any[]) => void) {
          Events.off(engine, eventNames[event] ?? event, listener);
        },
        remove(body: any) { Composite.remove(engine.world, body); },
      },
    },
  };
  const ch = new Character(scene, { id: 'link', spawnX: 0, spawnY: 0, ...options });
  return {
    ch, engine,
    step(input = NEUTRAL) {
      ch.applyInput(input);
      Engine.update(engine, STEP_MS);
      ch.applyPostPhysicsVelocityConstraints();
    },
    obstacle(x: number, y: number, w: number, h: number, sensor = false) {
      const body = Bodies.rectangle(x, y, w, h, {
        isStatic: true, isSensor: sensor,
        label: PLATFORM_LABELS.solid,
        collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
      });
      Composite.add(engine.world, body);
      return body;
    },
  };
}

describe('Character — real Matter hitlag and collision regression', () => {
  it('a zero-hitlag hit releases its queued launch on the next input step', () => {
    const { ch, step } = world();
    const result = ch.applyHit({ damage: 4, facing: 1, hitlagMultiplier: 0,
      knockback: { x: 4, y: -3, scaling: 0 } });
    expect(ch.getHitlagRemaining()).toBe(0);
    const position = ch.getPosition();
    step();
    expect(ch.getPosition().x).toBeGreaterThan(position.x);
    expect(ch.getVelocity().x).toBeCloseTo(result.vector.x);
    expect(ch.isInHitstun()).toBe(true);
  });

  it.each([0, 0.5, 1, 2])('captures the selected SDI multiplier %s for real frozen movement', sdiMultiplier => {
    const { ch, step } = world();
    ch.applyHit({ damage: 12, facing: 1, sdiMultiplier, knockback: { x: 4, y: -3, scaling: 0 } });
    const position = ch.getPosition();
    step({ moveX: 1, jump: false });
    expect(ch.getPosition().x).toBeCloseTo(position.x + 10 * sdiMultiplier);
    expect(ch.getPosition().y).toBeCloseTo(position.y);
    expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
  });

  it('releases the first buffered SDI vector after four frozen steps', () => {
    const { ch, step } = world();
    ch.applyHit({ damage: 20, facing: 1, knockback: { x: 4, y: -3, scaling: 0 } });
    step({ ...NEUTRAL, moveX: 1 });
    step({ ...NEUTRAL, moveX: 1, moveY: -1 });
    step({ ...NEUTRAL, moveX: 1 });
    step({ ...NEUTRAL, moveX: 1, moveY: 1 });
    expect(ch.getPosition()).toEqual({ x: 10, y: 0 });
    step();
    expect(ch.getPosition().x).toBeCloseTo(10 + 10 / Math.sqrt(2), 10);
    expect(ch.getPosition().y).toBeCloseTo(-10 / Math.sqrt(2), 10);
    expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
  });

  it('a new hit discards the prior buffered SDI request and cooldown', () => {
    const { ch, step } = world();
    const hit = { damage: 20, facing: 1 as const, knockback: { x: 4, y: -3, scaling: 0 } };
    ch.applyHit(hit);
    step({ ...NEUTRAL, moveX: 1 });
    step({ ...NEUTRAL, moveX: 1, moveY: -1 });
    ch.applyHit(hit);
    step({ ...NEUTRAL, moveX: -0.6 });
    expect(ch.getPosition()).toEqual({ x: 4, y: 0 });
    for (let frame = 0; frame < 5; frame++) step();
    expect(ch.getPosition()).toEqual({ x: 4, y: 0 });
  });

  it('directional input cannot SDI an attacker-only freeze', () => {
    const { ch, step } = world();
    ch.armAttackerHitlag(12);
    for (let frame = 0; frame < 8; frame++) {
      step({ ...NEUTRAL, moveX: frame % 2 ? -1 : 1, moveY: -1 });
      expect(ch.getPosition()).toEqual({ x: 0, y: 0 });
      expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
    }
  });

  it('stale history distinguishes recent/old and shielded uses, then clears on respawn', () => {
    const { ch } = world();
    expect(ch.getStaleMultiplier('jab')).toBe(1.05);
    ch.registerLandedMove('jab', true);
    expect(ch.getStaleMultiplier('jab')).toBeCloseTo(1 - .09 * .85);
    ch.registerLandedMove('tilt');
    expect(ch.getStaleMultiplier('jab')).toBeCloseTo(1 - .08545 * .85);
    ch.registerLandedMove('jab');
    expect(ch.getStaleMultiplier('jab')).toBeCloseTo(1 - .09 - .07635 * .85);
    ch.setPosition(0, 0);
    expect(ch.getStaleMultiplier('jab')).toBe(1.05);
  });

  it('reacquires persistent floor contact after resetting at the same grounded position', () => {
    // A reset re-arms ordinary landing, so zero landing lag isolates the contact.
    const { ch,step,obstacle } = world({ softLandingFrames: 0, hardLandingFrames: 0 });
    obstacle(0,48,1000,20);
    for(let i=0;i<15;i++) step();
    expect(ch.isGrounded()).toBe(true);
    const position = ch.getPosition();
    ch.resetForRound(position.x,position.y);
    step();
    expect(ch.isGrounded()).toBe(true);
    step({ ...NEUTRAL,shield:true });
    expect(ch.isShielding()).toBe(true);
  });
  it('a light non-tumbling hit keeps its launch angle despite a perpendicular stick', () => {
    const { ch, engine, step } = world();
    engine.gravity.y = 0;
    const hit = ch.applyHit({ damage: 4, knockback: { x: 2, y: -2, scaling: 0 }, facing: 1 });
    while (ch.getHitlagRemaining() > 1) step();
    step({ ...NEUTRAL, moveX: Math.SQRT1_2, moveY: Math.SQRT1_2 });
    expect(ch.isTumbling()).toBe(false);
    expect(ch.getVelocity().x).toBeCloseTo(hit.vector.x, 8);
    expect(ch.getVelocity().y).toBeCloseTo(hit.vector.y, 8);
  });

  it.each([0, -5, -45, -90, -135, -175, 180, 135, 90, 45, 5])(
    'measures the DI launch-angle sweep at %s degrees with axial and diagonal inputs', (degrees) => {
      for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [1, 1], [0, 0]]) {
        const { ch, engine, step } = world();
        engine.gravity.y = 0;
        const angle = degrees * Math.PI / 180;
        const hit = ch.applyHit({ damage: 12, knockback: {
          x: 12 * Math.cos(angle), y: 12 * Math.sin(angle), scaling: 0,
        }, facing: 1 });
        while (ch.getHitlagRemaining() > 1) step();
        step({ ...NEUTRAL, moveX: sx!, moveY: sy! });
        const axisDistance = Math.atan2(Math.abs(Math.sin(angle)), Math.abs(Math.cos(angle)));
        const stickLength = Math.max(1, Math.hypot(sx!, sy!));
        const rotation = axisDistance < 0.17 ? 0
          : 0.17 * (sy! * Math.cos(angle) - sx! * Math.sin(angle)) / stickLength;
        const expectedAngle = angle + rotation;
        const magnitude = hit.magnitude;
        const releasedAt = ch.getPosition();
        expect(ch.getVelocity().x).toBeCloseTo(magnitude * Math.cos(expectedAngle), 7);
        expect(ch.getVelocity().y).toBeCloseTo(magnitude * Math.sin(expectedAngle), 7);
        expect(Math.hypot(ch.getVelocity().x, ch.getVelocity().y)).toBeCloseTo(magnitude, 7);
        const n = hit.hitstunFrames;
        for (let i = 0; i < n; i += 1) step();
        const travel = n * magnitude - LAUNCH_SPEED_DECAY_PER_FRAME * n * (n + 1) / 2;
        expect(ch.getPosition().x - releasedAt.x).toBeCloseTo(travel * Math.cos(expectedAngle), 7);
        expect(ch.getPosition().y - releasedAt.y).toBeCloseTo(travel * Math.sin(expectedAngle), 7);
      }
    },
  );

  it.each([0, 1])('measures launch decay independently from Matter gravity %s over the full hitstun', (gravity) => {
    const { ch, engine, step } = world();
    engine.gravity.y = gravity;
    const hit = ch.applyHit({ damage: 12, knockback: { x: 12, y: 0, scaling: 0 }, facing: 1 });
    while (ch.getHitlagRemaining() > 0) step();
    const v0 = hit.vector.x;
    const n = hit.hitstunFrames;
    // This fixture remains above zero launch speed throughout hitstun, so
    // the arithmetic-series oracle needs no piecewise/clamped approximation.
    expect(v0 - n * LAUNCH_SPEED_DECAY_PER_FRAME).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) step();
    const expectedX = (n + 1) * v0 - LAUNCH_SPEED_DECAY_PER_FRAME * n * (n + 1) / 2;
    const gravityPerStep = gravity * engine.gravity.scale * STEP_MS * STEP_MS;
    const expectedY = gravityPerStep * (n + 1) * (n + 2) / 2;
    expect(ch.getPosition().x).toBeCloseTo(expectedX, 7);
    expect(ch.getPosition().y).toBeCloseTo(expectedY, 7);
    expect(ch.getVelocity().x).toBeCloseTo(v0 - n * LAUNCH_SPEED_DECAY_PER_FRAME, 7);
    expect(ch.getVelocity().y).toBeCloseTo(gravityPerStep * (n + 1), 7);
    expect(ch.getHitstunRemaining()).toBe(0);
  });

  it('a side contact below the fighter center cannot count as floor support', () => {
    const { ch, engine, step, obstacle } = world();
    engine.gravity.y = 0;
    const wall = obstacle(90, 150, 20, 1000);
    ch.applyHit({ damage: 12, knockback: { x: 12, y: 0, scaling: 0 }, facing: 1 });
    let collided = false;
    for (let i = 0; i < 24; i += 1) {
      step();
      collided ||= engine.pairs.list.some((pair: any) => pair.isActive &&
        (pair.bodyA === wall || pair.bodyB === wall));
      expect(ch.isGrounded()).toBe(false);
      expect(ch.isKnockedDown()).toBe(false);
    }
    expect(collided).toBe(true);
  });

  it('a platform sensor cannot replenish the jump budget', () => {
    const { ch, step, obstacle } = world();
    step({ ...NEUTRAL, jump: true });
    step();
    const p = ch.getPosition();
    obstacle(p.x, p.y + 20, 1000, 1000, true);
    step();
    expect(ch.isGrounded()).toBe(false);
    expect(ch.getJumpsUsed()).toBe(1);
  });

  it.each(['jump', 'dodge', 'attack', 'special'] as const)(
    'an unavailable %s cannot escape tumble or its eventual floor knockdown', (action) => {
      const { ch, engine, step, obstacle } = world();
      engine.gravity.y = 0;
      // Spend every jump and the one air dodge using actual inputs. This
      // generic fighter deliberately has no registered attacks or specials.
      for (let i = 0; i < ch.getTuning().maxJumps; i += 1) {
        step({ ...NEUTRAL, jump: true });
        step();
      }
      step({ ...NEUTRAL, dodge: true });
      for (let i = 0; i < 100; i += 1) step();
      expect(ch.getJumpsUsed()).toBe(ch.getTuning().maxJumps);
      ch.applyHit({ damage: 12, knockback: { x: 12, y: 0, scaling: 0 }, facing: 1 });
      while (ch.getHitlagRemaining() > 0 || ch.getHitstunRemaining() > 0) step();
      expect(ch.isTumbling()).toBe(true);
      step({ ...NEUTRAL, [action]: true });
      expect(ch.isTumbling()).toBe(true);
      expect(ch.isAttacking()).toBe(false);
      expect(ch.isDodging()).toBe(false);
      // Let a premature dodge's tech window expire before the real landing.
      for (let i = 0; i < 12; i += 1) step();
      const p = ch.getPosition();
      obstacle(p.x, p.y + ch.getTuning().height / 2 + 12, 1000, 20);
      Body.setVelocity(ch.body, { x: 0, y: 3 });
      for (let i = 0; i < 4; i += 1) step();
      expect(ch.isKnockedDown()).toBe(true);
    },
  );

  it.each([1, -1] as const)('latches actual incoming orientation before missed-tech velocity clears (%s)', sign => {
    const { ch, step, obstacle } = world();
    ch.applyHit({ damage: 12, facing: 1, hitlagMultiplier: 0,
      knockback: { x: 12 * sign, y: -4, scaling: 0 } });
    step();
    expect(ch.isTumbling()).toBe(true);
    const p = ch.getPosition();
    obstacle(p.x, p.y + ch.getTuning().height / 2 + 12, 1000, 20);
    Body.setVelocity(ch.body, { x: 8 * sign, y: 3 });
    for (let i = 0; i < 8 && !ch.isGrounded(); i++) step();
    expect(ch.isGrounded()).toBe(true);
    const incoming = ch.getVelocity().x;
    expect(incoming * sign).toBeGreaterThan(0);
    step();
    expect(ch.isKnockedDown()).toBe(true);
    expect(ch.getReactionPresentationState()?.origin).toBe(sign > 0 ? 'face-down' : 'face-up');
    expect(ch.getVelocity().x).toBe(0);
  });

  it.each(['shield', 'dodge'] as const)('buffers a late %s tech through hitlag until the real floor contact', (button) => {
    const { ch, step, obstacle } = world();
    obstacle(0, ch.getTuning().height / 2 + 12, 1000, 20);
    ch.applyHit({ damage: 12, knockback: { x: 0, y: 12, scaling: 0 }, facing: 1 });
    while (ch.getHitlagRemaining() > 2) step();
    const held = { ...NEUTRAL, [button]: true };
    step(held); // Last frozen frame: the body has not reached the floor yet.
    expect(ch.isGrounded()).toBe(false);
    step(held); // Launch, then Matter resolves the actual floor contact.
    expect(ch.isGrounded()).toBe(true);
    step(held); // Consume the buffered edge, although the button stays held.
    expect(ch.isKnockedDown()).toBe(false);
    expect(ch.isInvincible()).toBe(true);
    expect(ch.isTumbling()).toBe(false);
  });

  it.each([false, true])('an available air jump cancels tumble after hitstun (buffered: %s)', (buffered) => {
    const { ch, engine, step } = world();
    engine.gravity.y = 0;
    ch.applyHit({ damage: 12, knockback: { x: 12, y: 0, scaling: 0 }, facing: 1 });
    while (ch.getHitlagRemaining() > 0 || ch.getHitstunRemaining() > (buffered ? 1 : 0)) step();
    if (buffered) step({ ...NEUTRAL, jump: true });
    expect(ch.isTumbling()).toBe(true);
    step(buffered ? NEUTRAL : { ...NEUTRAL, jump: true });
    expect(ch.getVelocity().y).toBeLessThan(0);
    expect(ch.isTumbling()).toBe(false);
  });

  it('moves an attached ledge and its hitlag pin together without gravity drift', () => {
    const { ch, step } = world();
    ch.setLedgeCandidates([{ platformId: 'moving', side: 'right', x: 0, y: 0 }]);
    Body.setVelocity(ch.body, { x: 0, y: 1 });
    ch.applyInput(NEUTRAL);
    expect(ch.isHangingOnLedge()).toBe(true);
    const start = { ...ch.getPosition() };
    ch.armAttackerHitlag(4);
    for (let frame = 1; frame < 4; frame += 1) {
      ch.setLedgeCandidates([{ platformId: 'moving', side: 'right', x: frame * 3, y: -frame * 2 }]);
      step();
      expect(ch.getPosition()).toEqual({ x: start.x + frame * 3, y: start.y - frame * 2 });
      expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
    }
  });

  it('neutral defender hitlag has no gravity drift and releases its launch once', () => {
    const { ch, step } = world();
    const hit = ch.applyHit({ damage: 12, knockback: { x: 5, y: -3, scaling: 0.1 }, facing: 1 });
    const impact = { ...ch.getPosition() };
    while (ch.getHitlagRemaining() > 1) {
      step();
      expect(ch.getPosition()).toEqual(impact);
      expect(ch.getVelocity()).toEqual({ x: 0, y: 0 });
      expect(ch.getHitstunRemaining()).toBe(0);
    }
    step();
    expect(ch.getHitlagRemaining()).toBe(0);
    expect(ch.getPosition().x).toBeCloseTo(impact.x + hit.vector.x);
    expect(ch.getVelocity().x).toBeCloseTo(hit.vector.x);
    step();
    expect(ch.getVelocity().x).toBeLessThan(hit.vector.x);
  });

  it('permits one explicit SDI flick while gravity remains frozen', () => {
    const { ch, step } = world();
    ch.applyHit({ damage: 12, knockback: { x: 5, y: -3, scaling: 0.1 }, facing: 1 });
    const impact = { ...ch.getPosition() };
    step({ ...NEUTRAL, moveX: 1 });
    step({ ...NEUTRAL, moveX: 1 });
    expect(ch.getPosition().x).toBeCloseTo(impact.x + 10);
    expect(ch.getPosition().y).toBe(impact.y);
  });

  it('attacker hitlag freezes move time and restores its entry momentum once', () => {
    const { ch, step } = world();
    const jab = {
      id: 'freeze.jab', type: 'jab' as const, damage: 5,
      knockback: { x: 1, y: -1, scaling: 0.1 },
      hitbox: { offsetX: 20, offsetY: 0, width: 30, height: 30 },
      startupFrames: 2, activeFrames: 3, recoveryFrames: 4, cooldownFrames: 2,
    };
    ch.registerAttack(jab);
    ch.attemptAttack(jab.id);
    Body.setVelocity(ch.body, { x: 4, y: -2 });
    ch.armAttackerHitlag(4);
    const impact = { ...ch.getPosition() };
    for (let i = 0; i < 3; i += 1) {
      step();
      expect(ch.getPosition()).toEqual(impact);
      expect(ch.getActiveAttack()?.framesElapsed).toBe(0);
    }
    step();
    expect(ch.getVelocity().x).toBeCloseTo(4);
    // Rising velocity also takes the profile's extra rise acceleration.
    expect(ch.getVelocity().y).toBeCloseTo(-2 + STEP_MS * STEP_MS * 0.001 + ch.getTuning().riseAccel!);
    step();
    expect(ch.getActiveAttack()?.framesElapsed).toBe(1);
  });

  it.each([
    { name: 'right wall', x: 90, y: 0, w: 20, h: 1000, launchX: 10, launchY: 0, axis: 'x', sign: 1 },
    { name: 'left wall', x: -90, y: 0, w: 20, h: 1000, launchX: -10, launchY: 0, axis: 'x', sign: -1 },
    { name: 'floor', x: 0, y: 120, w: 1000, h: 20, launchX: 0, launchY: 10, axis: 'y', sign: 1 },
    { name: 'ceiling', x: 0, y: -120, w: 1000, h: 20, launchX: 0, launchY: -10, axis: 'y', sign: -1 },
  ] as const)('launch decay cannot accelerate away after hitting $name', ({ x, y, w, h, launchX, launchY, axis, sign }) => {
    const { ch, engine, step, obstacle } = world();
    // Zero gravity isolates collision energy from ordinary falling after a
    // ceiling hit. Gravity plus launch is separately covered by hitlag tests.
    engine.gravity.y = 0;
    const surface = obstacle(x, y, w, h);
    ch.applyHit({ damage: 12, knockback: { x: launchX, y: launchY, scaling: 0 }, facing: 1 });
    let collided = false;
    for (let frame = 0; frame < 24; frame += 1) {
      step();
      collided ||= engine.pairs.list.some((pair: any) => pair.isActive &&
        (pair.bodyA === surface || pair.bodyB === surface));
      if (collided) expect(ch.getVelocity()[axis] * sign).toBeGreaterThanOrEqual(-0.00001);
    }
    expect(collided).toBe(true);
  });
});
