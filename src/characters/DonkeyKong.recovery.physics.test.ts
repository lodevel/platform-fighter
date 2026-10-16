import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DonkeyKong } from './DonkeyKong';
import { Link, LINK_TILT } from './Link';
import type { Character, CharacterInput } from './Character';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const UP: CharacterInput = { ...NEUTRAL, moveY: -1, special: true };

function setup(grounded = false) {
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
  const fighter = new DonkeyKong(scene, { spawnX: 0, spawnY: 0 });
  const floor = Bodies.rectangle(0, fighter.getTuning().height / 2 + 10, 20000, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  });
  if (grounded) Composite.add(engine.world, floor);
  const characters: Character[] = [fighter];
  const step = (input: CharacterInput = NEUTRAL) => {
    fighter.applyInput(input);
    for (const other of characters.slice(1)) other.applyInput(NEUTRAL);
    stepCharacterPhysics({ characters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: 1000 / 60,
      stepWorld: delta => Engine.update(engine, delta) });
  };
  if (grounded) for (let i = 0; i < 12; i++) step();
  const addOpponent = () => {
    const opponent = new Link(scene, { spawnX: 100000, spawnY: 0 });
    characters.push(opponent);
    return opponent;
  };
  return { fighter, engine, floor, step, addOpponent };
}

describe('DK aerial Spinning Kong recovery through real Matter integration', () => {
  it('reverses a fall and sustains its rise through the spinning hit sequence', () => {
    const { fighter, step } = setup();
    Body.setVelocity(fighter.body, { x: 0, y: 8.15 });
    const startY = fighter.getPosition().y;
    step(UP);
    expect(fighter.getVelocity().y).toBeLessThan(0);
    for (let frame = 1; frame < 43; frame++) step();
    const rise = startY - fighter.getPosition().y;
    // A useful third-jump recovery: ordinary gravity previously gave only ~30px.
    expect(rise).toBeGreaterThan(150);
    expect(rise).toBeLessThan(190);
    expect(fighter.getVelocity().y).toBeLessThan(-3);
    const spinVy = fighter.getVelocity().y;
    step(); // elapsed43 / game frame44 restores ordinary gravity.
    expect(fighter.getVelocity().y - spinVy).toBeGreaterThan(0.4);
  });

  it.each([-1, 1] as const)('retains entry drift and steers with input while facing %i', facing => {
    const { fighter, step } = setup();
    fighter.setFacing(facing);
    Body.setVelocity(fighter.body, { x: -3, y: 4 });
    step(UP);
    // Input motion runs before attack dispatch on the press frame. The move
    // retains that entry speed instead of replacing it with facing drift.
    // Source neutral air_brake_x=.015 native ×5 removes .075 before entry.
    const entryVx = fighter.getVelocity().x;
    expect(entryVx).toBeCloseTo(-3 + .015 * 5, 6);
    for (let frame = 0; frame < 5; frame++) step();
    expect(fighter.getVelocity().x).toBeCloseTo(entryVx, 6);
    for (let frame = 0; frame < 30; frame++) step({ ...NEUTRAL, moveX: 1 });
    expect(fighter.getVelocity().x).toBeGreaterThan(4);
    expect(fighter.getVelocity().x).toBeLessThanOrEqual(8.5);
    const beforeReverse = fighter.getVelocity().x;
    for (let frame = 0; frame < 5; frame++) step({ ...NEUTRAL, moveX: -1 });
    expect(fighter.getVelocity().x).toBeLessThan(beforeReverse - 1);
    expect(fighter.getFacing()).toBe(facing);
  });

  it('finishes the finite spin, blocks another recovery, then resets on landing', () => {
    const { fighter, engine, floor, step } = setup();
    step(UP);
    for (let frame = 0; frame < 90; frame++) step();
    expect(fighter.getActiveAttack()).toBeNull();
    expect(fighter.getVelocity().y).toBeGreaterThan(0);
    expect(fighter.attemptUpSpecial()).toBe(false);
    Composite.add(engine.world, floor);
    Body.setPosition(fighter.body, { x: 0, y: -50 });
    Body.setVelocity(fighter.body, { x: 0, y: 5 });
    for (let frame = 0; frame < 100; frame++) step();
    expect(fighter.isGrounded()).toBe(true);
    step(UP);
    expect(fighter.getActiveAttack()?.move.sheetVariant).toBe('ground');
  });

  // SmashWiki (SSBU up special): landing from the aerial version before helplessness
  // transitions to frame 63 of the grounded version; SpecialHi is interruptible at 105.
  it('lands the aerial spin into grounded SpecialHi frame 63 and its 42-frame tail, not special landing lag', () => {
    const { fighter, engine, floor, step } = setup();
    step(UP);
    Composite.add(engine.world, floor);
    Body.setPosition(fighter.body, { x: 0, y: -2 });
    Body.setVelocity(fighter.body, { x: 0, y: 5 });
    for (let frame = 0; frame < 5 && !fighter.isGrounded(); frame++) step();
    expect(fighter.isGrounded()).toBe(true);
    step();
    const tail = fighter.getActiveAttack();
    expect(tail?.move).toMatchObject({ id: 'donkeykong.up_special', sheetVariant: 'ground' });
    expect(tail?.framesElapsed).toBe(62);
    expect(fighter.getLandingPresentationState()).toBeNull();
    expect(fighter.isHelpless()).toBe(false);
    for (let frame = 63; frame <= 103; frame++) {
      step();
      expect(fighter.getActiveAttack()?.framesElapsed).toBe(frame);
      expect(fighter.getActiveAttack()?.hitboxBody ?? null).toBeNull();
    }
    step();
    expect(fighter.getActiveAttack()).toBeNull();
    expect(fighter.isHelpless()).toBe(false);
    expect(fighter.canAttack()).toBe(true);
  });

  it('a falling aerial spin that touches down late in its timeline also continues from frame 63', () => {
    const { fighter, engine, floor, step } = setup();
    step(UP);
    for (let frame = 1; frame < 54; frame++) step();
    expect(fighter.getVelocity().y).toBeGreaterThan(0);
    expect(fighter.getActiveAttack()?.framesElapsed).toBe(53);
    const { x, y } = fighter.getPosition();
    Body.setPosition(floor, { x, y: y + fighter.getTuning().height / 2 + 10 + 2 });
    Composite.add(engine.world, floor);
    for (let frame = 0; frame < 6 && !fighter.isGrounded(); frame++) step();
    expect(fighter.isGrounded()).toBe(true);
    expect(fighter.getActiveAttack()!.framesElapsed).toBeLessThan(62);
    step();
    expect(fighter.getActiveAttack()).toMatchObject({ framesElapsed: 62, move: { sheetVariant: 'ground' } });
  });

  it('keeps the 38-frame special landing after the spin ends in special fall', () => {
    const { fighter, engine, floor, step } = setup();
    step(UP);
    for (let frame = 0; frame < 90; frame++) step();
    expect(fighter.isHelpless()).toBe(true);
    const { x, y } = fighter.getPosition();
    Body.setPosition(floor, { x, y: y + fighter.getTuning().height / 2 + 10 + 2 });
    Composite.add(engine.world, floor);
    for (let frame = 0; frame < 6 && !fighter.isGrounded(); frame++) step();
    expect(fighter.isGrounded()).toBe(true);
    step();
    expect(fighter.getActiveAttack()).toBeNull();
    expect(fighter.getLandingPresentationState()).toMatchObject({ kind: 'special', totalFrames: 38 });
    for (let locked = 2; locked <= 38; locked++) { step(); expect(fighter.canAttack()).toBe(false); }
    step();
    expect(fighter.canAttack()).toBe(true);
  });

  it('a grounded spin that runs off its floor lands into the same frame-63 tail', () => {
    const { fighter, engine, step } = setup();
    const half = fighter.getTuning().height / 2;
    const solid = (x: number, top: number, width: number) => Composite.add(engine.world, Bodies.rectangle(x, top + 10, width, 20, {
      isStatic: true, label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    solid(0, half, 40);           // upper ledge, edge at x = 20
    solid(0, half + 110, 4000);   // floor 110 px lower
    for (let i = 0; i < 12; i++) step();
    expect(fighter.isGrounded()).toBe(true);
    step(UP);
    expect(fighter.getActiveAttack()?.move.sheetVariant).toBe('ground');
    let leftAt: number | null = null;
    for (let frame = 0; frame < 60 && (leftAt === null || !fighter.isGrounded()); frame++) {
      step({ ...NEUTRAL, moveX: 1 });
      if (leftAt === null && !fighter.isGrounded()) leftAt = fighter.getActiveAttack()!.framesElapsed;
    }
    expect(leftAt).not.toBeNull();
    expect(fighter.isGrounded()).toBe(true);
    expect(fighter.getActiveAttack()!.framesElapsed).toBeLessThan(62);
    step({ ...NEUTRAL, moveX: 1 });
    expect(fighter.getActiveAttack()).toMatchObject({ framesElapsed: 62, move: { sheetVariant: 'ground' } });
    expect(fighter.getLandingPresentationState()).toBeNull();
  });

  it('stops the special gravity when damage interrupts the spin', () => {
    const { fighter, step } = setup();
    step(UP);
    for (let frame = 0; frame < 8; frame++) step();
    fighter.applyHitDetailed({ damage: 7, knockback: { x: 3, y: -1.5, scaling: 0.2 }, facing: 1 });
    expect(fighter.getActiveAttack()).toBeNull();
    expect(fighter.body.ignoreGravity).not.toBe(true);
    for (let frame = 0; frame < 100; frame++) step();
    expect(fighter.getVelocity().y).toBeGreaterThan(0);
  });

  it('resumes only the special gravity after outgoing hitlag', () => {
    const { fighter, step } = setup();
    step(UP);
    for (let frame = 0; frame < 8; frame++) step();
    const position = { ...fighter.getPosition() };
    const vy = fighter.getVelocity().y;
    const elapsed = fighter.getActiveAttack()!.framesElapsed;
    fighter.armAttackerHitlag(4);
    for (let frame = 0; frame < 3; frame++) {
      step();
      expect(fighter.getPosition()).toEqual(position);
      expect(fighter.getActiveAttack()!.framesElapsed).toBe(elapsed);
    }
    step();
    expect(fighter.getHitlagRemaining()).toBe(0);
    // The release integrates again, without adding ordinary DK rise shaping.
    expect(fighter.getVelocity().y - vy).toBeGreaterThan(0.02);
    expect(fighter.getVelocity().y - vy).toBeLessThan(0.04);
  });

  it('takes over gravity after recovering from a real reference launch', () => {
    const { fighter, step } = setup();
    fighter.setDamagePercent(70);
    fighter.applyHit({ damage: LINK_TILT.damage, knockback: LINK_TILT.knockback, facing: 1 });
    for (let frame = 0; frame < 300 && (fighter.getHitlagRemaining() > 0 || fighter.isInHitstun()); frame++) step();
    expect(fighter.isInHitstun()).toBe(false);
    const startY = fighter.getPosition().y;
    step(UP);
    expect(fighter.getActiveAttack()?.move.id).toBe('donkeykong.up_special');
    for (let frame = 1; frame < 43; frame++) step();
    expect(startY - fighter.getPosition().y).toBeGreaterThan(150);
    expect(fighter.getVelocity().y).toBeLessThan(-3);
    for (let frame = 0; frame < 60; frame++) step();
    expect(fighter.getVelocity().y).toBeGreaterThan(0);
  });

  it('keeps the same recovery when another fighter subdivides physics for a reference launch', () => {
    const ordinary = setup();
    const compressed = setup();
    const opponent = compressed.addOpponent();
    opponent.setDamagePercent(100);
    opponent.applyHit({ damage: LINK_TILT.damage, knockback: LINK_TILT.knockback, facing: 1 });
    let subdivided = false;
    for (let frame = 0; frame < 50; frame++) {
      const input = frame === 0 ? UP : NEUTRAL;
      ordinary.step(input);
      compressed.step(input);
      subdivided ||= (opponent.getReferencePhysicsStep()?.ticks ?? 1) > 1;
      expect(compressed.fighter.getPosition().y).toBeCloseTo(ordinary.fighter.getPosition().y, 6);
      expect(compressed.fighter.getVelocity().y).toBeCloseTo(ordinary.fighter.getVelocity().y, 6);
    }
    expect(subdivided).toBe(true);
  });
});

describe('DK Spinning Kong out of jumpsquat (Ultimate jump-canceled up special)', () => {
  const W: CharacterInput = { ...NEUTRAL, moveY: -1, jump: true };
  const JUMP: CharacterInput = { ...NEUTRAL, jump: true };
  /** The grounded spin holds DK on the floor with no vertical velocity for its rooted frames. */
  const expectRootedGroundSpin = (fighter: Character, step: (input?: CharacterInput) => void, hold: CharacterInput) => {
    expect(fighter.getActiveAttack()?.move.sheetVariant).toBe('ground');
    expect(fighter.getJumpsquatRemaining()).toBe(0);
    for (let frame = 0; frame < 25; frame++) {
      step(hold);
      expect(fighter.isGrounded()).toBe(true);
      expect(Math.abs(fighter.getVelocity().y)).toBeLessThan(0.01);
    }
    expect(fighter.getJumpsUsed()).toBe(0);
  };

  it.each([3, 2, 1])('keyboard W: special on the jumpsquat step with %i squat frames left drops the jump for the grounded spin', left => {
    const { fighter, step } = setup(true);
    let guard = 0;
    while (fighter.getJumpsquatRemaining() !== left) { step(W); expect(++guard).toBeLessThan(12); }
    step({ ...W, special: true });
    expectRootedGroundSpin(fighter, step, W);
  });

  it.each([3, 2, 1])('jump button + up stick: special with %i squat frames left drops the jump for the grounded spin', left => {
    const { fighter, step } = setup(true);
    let guard = 0;
    while (fighter.getJumpsquatRemaining() !== left) { step(JUMP); expect(++guard).toBeLessThan(12); }
    step({ ...JUMP, moveY: -1, special: true });
    expectRootedGroundSpin(fighter, step, JUMP);
  });

  it('jump button, up stick and special on the SAME step (the squat-entry step) is the grounded spin', () => {
    const { fighter, step } = setup(true);
    step({ ...JUMP, moveY: -1, special: true });
    expectRootedGroundSpin(fighter, step, JUMP);
  });

  it('W held into the squat-entry step with special also cancels (tap-jump buffer expiring that step)', () => {
    const { fighter, step } = setup(true);
    let guard = 0;
    // Hold W until the step BEFORE the squat starts, then press special on the entry step.
    while (true) {
      const probe = setup(true);
      for (let i = 0; i <= guard; i++) probe.step(W);
      if (probe.fighter.getJumpsquatRemaining() > 0) break;
      guard++;
      expect(guard).toBeLessThan(12);
    }
    for (let i = 0; i < guard; i++) step(W);
    expect(fighter.getJumpsquatRemaining()).toBe(0);
    step({ ...W, special: true });
    expectRootedGroundSpin(fighter, step, W);
  });

  it('special right after takeoff is the aerial spin with its own rise (no inherited jump launch)', () => {
    const { fighter, step } = setup(true);
    const groundY = fighter.getPosition().y;
    let guard = 0;
    while (fighter.isGrounded()) { step(JUMP); expect(++guard).toBeLessThan(12); }
    step({ ...JUMP, moveY: -1, special: true });
    const spin = fighter.getActiveAttack();
    expect(spin?.move.id).toBe('donkeykong.up_special');
    expect(spin?.move.sheetVariant).not.toBe('ground');
    // The aerial spin owns the vertical speed: a slow rise, not the full-hop opening.
    expect(fighter.getVelocity().y).toBeGreaterThan(-6);
    expect(fighter.getVelocity().y).toBeLessThan(0);
    let peak = 0;
    for (let frame = 0; frame < 120; frame++) {
      step(NEUTRAL);
      peak = Math.max(peak, groundY - fighter.getPosition().y);
    }
    // Full hop (170 px) plus the spin's sourced rise; the bug reached ~1500 px.
    expect(peak).toBeLessThan(300);
  });

  it('a jump-button special that reaches the takeoff step starts the AERIAL record (no grounded spin with the jump launch)', () => {
    const { fighter, step } = setup(true);
    let guard = 0;
    while (fighter.getJumpsquatRemaining() !== 1) { step(JUMP); expect(++guard).toBeLessThan(12); }
    // Neutral stick: not a jump cancel, but the held jump button still reads as up.
    step({ ...JUMP, special: true });
    expect(fighter.getActiveAttack()?.move.id).toBe('donkeykong.up_special');
    expect(fighter.getActiveAttack()?.move.sheetVariant).not.toBe('ground');
    expect(fighter.getVelocity().y).toBeGreaterThan(-6);
  });

  it('a down special buffered through jumpsquat starts the aerial Hand Slap on the takeoff step', () => {
    const { fighter, step } = setup(true);
    let guard = 0;
    while (fighter.getJumpsquatRemaining() !== 2) { step(JUMP); expect(++guard).toBeLessThan(12); }
    step({ ...JUMP, moveY: 1, special: true });
    expect(fighter.getActiveAttack()).toBeNull();
    step(JUMP);
    const slap = fighter.getActiveAttack();
    expect(slap?.move.id).toBe('donkeykong.down_special');
    expect(slap?.move.sheetVariant).toBe('air');
    expect(slap?.move.startupFrames).toBe(18);
  });

  it('a standing grounded press (no jump) is unchanged: grounded spin rooted to the floor', () => {
    const { fighter, step } = setup(true);
    step(UP);
    expectRootedGroundSpin(fighter, step, NEUTRAL);
  });
});

describe('DK grounded Spinning Kong keyboard input', () => {
  it.each([0, 1, 2])('clears the up-key jump buffer when special follows by %i frames', delay => {
    const { fighter, step } = setup(true);
    const input = { ...NEUTRAL, moveY: -1, jump: true };
    for (let frame = 0; frame < delay; frame++) step(input);
    step({ ...input, special: true });
    expect(fighter.getActiveAttack()?.move.sheetVariant).toBe('ground');
    for (let frame = 0; frame < 25; frame++) {
      step(input);
      expect(fighter.isGrounded()).toBe(true);
      expect(Math.abs(fighter.getVelocity().y)).toBeLessThan(0.01);
    }
  });
});
