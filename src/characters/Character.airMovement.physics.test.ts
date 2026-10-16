import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput, type CharacterOptions } from './Character';
import './attackRegistration';
import { LINK_BAIR, LINK_FAIR, LINK_SIDE_SPECIAL } from './Link';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const STEP_MS = 1000 / 60;

/** Real Phaser Matter gravity and contact solving, driven by gameplay inputs. */
function world(options: Partial<CharacterOptions> = {}, grounded = true) {
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
  const floor = Bodies.rectangle(0, ch.getTuning().height / 2 + 10, 2000, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  });
  if (grounded) Composite.add(engine.world, floor);
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    Engine.update(engine, STEP_MS);
    ch.applyPostPhysicsVelocityConstraints();
  };
  if (grounded) for (let frame = 0; frame < 12; frame++) step();
  const takeOff = () => {
    expect(ch.isGrounded()).toBe(true);
    for (let frame = 0; frame < 4; frame++) step({ ...NEUTRAL, jump: true });
    expect(ch.isGrounded()).toBe(false);
    expect(ch.getJumpsUsed()).toBe(1);
  };
  return { ch, engine, floor, step, takeOff };
}

describe('Character air movement with real Matter inputs', () => {
  it.each(['held', 'tap', 'descending', 'fastfall'] as const)(
    'Link air jump gains 145 px from a %s input and spends exactly one resource', (mode) => {
      const { ch, step, takeOff } = world();
      takeOff();
      step(); // Release the first press so this is a distinct air jump.
      if (mode === 'descending' || mode === 'fastfall') {
        while (ch.getVelocity().y < 0) step();
        if (mode === 'fastfall') {
          step({ ...NEUTRAL, moveY: 1 });
          expect(ch.getVelocity().y).toBeGreaterThan(10);
        }
      }
      const start = ch.getPosition().y;
      step({ ...NEUTRAL, jump: true });
      expect(ch.getJumpsquatRemaining()).toBe(0);
      expect(ch.getJumpsUsed()).toBe(2);
      expect(ch.getJumpsRemaining()).toBe(0);
      expect(ch.getVelocity().y).toBeCloseTo(-11.56, 8);
      let apex = ch.getPosition().y;
      let riseSteps = 1;
      while (ch.getVelocity().y < 0) {
        step({ ...NEUTRAL, jump: mode === 'held' });
        apex = Math.min(apex, ch.getPosition().y);
        riseSteps++;
      }
      expect(start - apex).toBeCloseTo(145, 7);
      expect(riseSteps).toBe(26); // First non-rising step after 25 upward steps.
      step();
      const beforeRejectedJump = ch.getVelocity().y;
      step({ ...NEUTRAL, jump: true });
      expect(ch.getJumpsUsed()).toBe(2);
      expect(ch.getVelocity().y).toBeGreaterThan(beforeRejectedJump);
    },
  );

  it('landing restores the jump budget and the next ground jump keeps its 139 px arc', () => {
    const { ch, step, takeOff } = world();
    takeOff(); step(); step({ ...NEUTRAL, jump: true });
    for (let frame = 0; frame < 180 && !ch.isGrounded(); frame++) step();
    expect(ch.isGrounded()).toBe(true);
    for (let frame = 0; frame < 10; frame++) step();
    expect(ch.getJumpsUsed()).toBe(0);
    const start = ch.getPosition().y;
    takeOff();
    let apex = ch.getPosition().y;
    while (ch.getVelocity().y < 0) {
      step({ ...NEUTRAL, jump: true });
      apex = Math.min(apex, ch.getPosition().y);
    }
    expect(start - apex).toBeCloseTo(139, 2);
    expect(ch.getJumpsRemaining()).toBe(1);
  });

  it('air-jump hitlag freezes its position and resumes the same arc', () => {
    const { ch, step, takeOff } = world();
    takeOff(); step();
    const start = ch.getPosition().y;
    step({ ...NEUTRAL, jump: true });
    const frozenPosition = ch.getPosition();
    ch.armAttackerHitlag(4);
    for (let frame = 0; frame < 3; frame++) {
      step();
      expect(ch.getPosition()).toEqual(frozenPosition);
      expect(ch.getJumpsUsed()).toBe(2);
    }
    let apex = ch.getPosition().y;
    while (ch.getVelocity().y < 0 || ch.getHitlagRemaining() > 0) {
      step();
      apex = Math.min(apex, ch.getPosition().y);
    }
    expect(start - apex).toBeCloseTo(145, 7);
  });

  it('a hit after double jump clears its gravity shaping without refilling its jump', () => {
    const calibrated = world();
    const alternate = world({ airJumpRiseAccel: 0.8 });
    for (const fixture of [calibrated, alternate]) {
      fixture.takeOff(); fixture.step(); fixture.step({ ...NEUTRAL, jump: true });
      // Align the fixtures at impact; their pre-hit jump trajectories differ.
      Body.setPosition(fixture.ch.body, { x: 0, y: -500 });
      fixture.ch.applyHit({ damage: 12, knockback: { x: 12, y: -12, scaling: 0 }, facing: 1 });
    }
    for (let frame = 0; frame < 150; frame++) {
      calibrated.step(); alternate.step();
      expect(calibrated.ch.getPosition()).toEqual(alternate.ch.getPosition());
      expect(calibrated.ch.getVelocity()).toEqual(alternate.ch.getVelocity());
      expect(calibrated.ch.getJumpsUsed()).toBe(2);
      if (calibrated.ch.getHitlagRemaining() === 0 && calibrated.ch.getHitstunRemaining() === 0) break;
    }
    for (let frame = 0; frame < 6; frame++) {
      calibrated.step(); alternate.step();
      expect(calibrated.ch.getVelocity()).toEqual(alternate.ch.getVelocity());
    }
  });

  it.each([1, -1] as const)('free backward drift preserves facing %s before and after an air jump and dispatches bair', facing => {
    const { ch, engine, step, takeOff } = world();
    ch.registerAttack(LINK_BAIR); ch.registerAttack(LINK_FAIR);
    ch.setFacing(facing);
    takeOff();
    for (let frame = 0; frame < 5; frame++) step({ ...NEUTRAL, moveX: -facing });
    expect(ch.getFacing()).toBe(facing);
    expect(Math.sign(ch.getVelocity().x)).toBe(-facing);
    step({ ...NEUTRAL, moveX: -facing, jump: true });
    expect(ch.getFacing()).toBe(facing);
    step({ ...NEUTRAL, moveX: -facing, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('link.bair');
    // Ultimate's bair never turns the fighter; its backward geometry is authored (Link.normals asserts the same).
    expect(ch.getActiveAttack()?.facing).toBe(facing);
    // Give the move room to finish, then keep drifting backward while free.
    Composite.remove(engine.world, Composite.allBodies(engine.world).find((body: any) => body.label === PLATFORM_LABELS.solid));
    for (let frame = 0; frame < 35; frame++) step({ ...NEUTRAL, moveX: -facing });
    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.getFacing()).toBe(facing);
    step({ ...NEUTRAL, moveX: -facing, attack: true });
    expect(ch.getActiveAttack()?.move.id).toBe('link.bair');
  });

  it('a side special still explicitly turns an airborne fighter', () => {
    const { ch, step, takeOff } = world();
    ch.registerAttack(LINK_SIDE_SPECIAL);
    takeOff();
    step({ ...NEUTRAL, moveX: -1 });
    expect(ch.getFacing()).toBe(1);
    step({ ...NEUTRAL, moveX: -1, special: true });
    expect(ch.getActiveAttack()?.move.id).toBe('link.side_special');
    expect(ch.getFacing()).toBe(-1);
  });

  it('walking off a platform leaves one air jump, while a raw airborne spawn retains its configured budget', () => {
    const { ch, floor, step } = world();
    Body.scale(floor, 0.06, 1); // Walk off a real 120-pixel-wide support.
    for (let frame = 0; frame < 60 && ch.isGrounded(); frame++) step({ ...NEUTRAL, moveX: 1 });
    expect(ch.isGrounded()).toBe(false);
    step(); // Observe the departed contact before evaluating jump resources.
    expect(ch.getJumpsUsed()).toBe(1);
    expect(ch.getJumpsRemaining()).toBe(1);
    step({ ...NEUTRAL, jump: true });
    expect(ch.getJumpsUsed()).toBe(2);
    step();
    const velocity = ch.getVelocity().y;
    step({ ...NEUTRAL, jump: true });
    expect(ch.getJumpsUsed()).toBe(2);
    expect(ch.getVelocity().y).toBeGreaterThan(velocity);

    const rawSpawn = world({}, false);
    rawSpawn.step();
    expect(rawSpawn.ch.getJumpsUsed()).toBe(0);
    expect(rawSpawn.ch.getJumpsRemaining()).toBe(2);
  });

  it('being launched off the floor does not carry the ground-only jump into recovery', () => {
    const { ch, step } = world();
    ch.applyHit({ damage: 12, knockback: { x: 0, y: -12, scaling: 0 }, facing: 1 });
    for (let frame = 0; frame < 120 && (ch.getHitlagRemaining() > 0 || ch.getHitstunRemaining() > 0); frame++) step();
    expect(ch.isGrounded()).toBe(false);
    step();
    expect(ch.getJumpsRemaining()).toBe(1);
    step({ ...NEUTRAL, jump: true });
    expect(ch.getJumpsRemaining()).toBe(0);
  });

  it.each(['free fall', 'touchdown'] as const)('attacker hitlag release preserves terminal speed and fall history during %s', mode => {
    const { ch, engine, floor, step } = world({}, false);
    for (let frame = 0; frame < 3; frame++) {
      Body.setVelocity(ch.body, { x: 0, y: 8 });
      step();
    }
    const position = ch.getPosition();
    ch.armAttackerHitlag(3);
    for (let frame = 0; frame < 2; frame++) {
      step();
      expect(ch.getPosition()).toEqual(position);
    }
    if (mode === 'touchdown') {
      Body.setPosition(floor, { x: position.x, y: position.y + ch.getTuning().height / 2 + 11 });
      Composite.add(engine.world, floor);
    }
    step();
    if (mode === 'free fall') expect(ch.getVelocity().y).toBeCloseTo(8, 8);
    else {
      expect(ch.isGrounded()).toBe(true);
      step();
      expect(ch.getAnimationActionState().landingRecoveryRemaining).toBe(5);
    }
  });

  it.each([2, 7.8, 12])('attacker hitlag pauses a %s px/step descent without changing the resumed trajectory', vy => {
    const paused = world({}, false);
    const reference = world({}, false);
    for (const fixture of [paused, reference]) Body.setVelocity(fixture.ch.body, { x: 0, y: vy });
    paused.ch.armAttackerHitlag(3);
    paused.step(); paused.step();
    expect(paused.ch.getPosition()).toEqual(reference.ch.getPosition());
    for (let frame = 0; frame < 6; frame++) {
      paused.step(); reference.step();
      expect(paused.ch.getVelocity()).toEqual(reference.ch.getVelocity());
      expect(paused.ch.getPosition()).toEqual(reference.ch.getPosition());
    }
  });

  it('attacker release consumes temporary platform fall support exactly once', () => {
    const paused = world({}, false);
    const reference = world({}, false);
    for (const fixture of [paused, reference]) {
      Body.setVelocity(fixture.ch.body, { x: 0, y: 2 });
      fixture.ch.markPlatformFallSupported();
    }
    paused.ch.armAttackerHitlag(3);
    paused.step(); paused.step();
    for (let frame = 0; frame < 3; frame++) {
      paused.step(); reference.step();
      expect(paused.ch.getVelocity()).toEqual(reference.ch.getVelocity());
      expect(paused.ch.getPosition()).toEqual(reference.ch.getPosition());
    }
  });

  it.each(['human jump', 'explicit jump', 'drop'] as const)('ledge %s restores exactly one air jump without dispatching two jumps', release => {
    const { ch, step } = world({}, false);
    ch.setLedgeCandidates([{ x: 0, y: 0, side: 'right', platformId: 'edge' }]);
    Body.setVelocity(ch.body, { x: 0, y: 2 });
    step();
    expect(ch.isHangingOnLedge()).toBe(true);
    expect(ch.getJumpsRemaining()).toBe(1);
    const input: CharacterInput = release === 'human jump' ? { ...NEUTRAL, jump: true }
      : { ...NEUTRAL, ledgeRelease: release === 'drop' ? 'dropDown' : 'jump' };
    step(input);
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getJumpsUsed()).toBe(1);
    if (release !== 'drop') expect(ch.getVelocity().y).toBeCloseTo(-12.796825396825396, 8);
    step();
    expect(ch.getJumpsUsed()).toBe(1); // No buffered duplicate after ledge jump.
    step({ ...NEUTRAL, jump: true });
    expect(ch.getJumpsUsed()).toBe(2);
    expect(ch.getJumpsRemaining()).toBe(0);
    expect(ch.getVelocity().y).toBeCloseTo(-11.56, 8);
  });

  it('holding down declines a nearby ledge until the stick is released', () => {
    const { ch, step } = world({}, false);
    ch.setLedgeCandidates([{ x: 0, y: 0, side: 'right', platformId: 'edge' }]);
    Body.setVelocity(ch.body, { x: 0, y: 2 });
    step({ ...NEUTRAL, moveY: 1 });
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getJumpsUsed()).toBe(0); // Declining is not a resource refresh.
    step();
    expect(ch.isHangingOnLedge()).toBe(true);
  });

  it('a legal air jump beats an automatic ledge catch but an exhausted jump does not suppress rescue', () => {
    const { ch, step } = world({}, false);
    const placeAtEdge = () => {
      Body.setPosition(ch.body, { x: 0, y: 0 });
      Body.setVelocity(ch.body, { x: 0, y: 2 });
    };
    ch.setLedgeCandidates([{ x: 0, y: 0, side: 'right', platformId: 'edge' }]);
    placeAtEdge();
    step({ ...NEUTRAL, jump: true });
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getVelocity().y).toBeCloseTo(-11.56, 8);
    expect(ch.getJumpsUsed()).toBe(1);
    step(); placeAtEdge(); step({ ...NEUTRAL, jump: true });
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getJumpsRemaining()).toBe(0);
    step(); placeAtEdge(); step({ ...NEUTRAL, jump: true });
    expect(ch.isHangingOnLedge()).toBe(true);
    expect(ch.getJumpsRemaining()).toBe(1);
  });

  it('a spent jump remains spent near the same ledge throughout its regrab cooldown', () => {
    const { ch, step } = world({}, false);
    ch.setLedgeCandidates([{ x: 0, y: 0, side: 'right', platformId: 'edge' }]);
    Body.setVelocity(ch.body, { x: 0, y: 2 }); step();
    step({ ...NEUTRAL, ledgeRelease: 'dropDown' });
    expect(ch.getLedgeTetherCooldownRemaining()).toBeGreaterThan(0);
    step({ ...NEUTRAL, jump: true });
    expect(ch.getJumpsRemaining()).toBe(0);
    step();
    Body.setPosition(ch.body, { x: 0, y: 0 });
    Body.setVelocity(ch.body, { x: 0, y: 2 });
    step({ ...NEUTRAL, jump: true });
    expect(ch.isHangingOnLedge()).toBe(false);
    expect(ch.getJumpsRemaining()).toBe(0);
    expect(ch.getVelocity().y).toBeGreaterThan(0);
  });
});
