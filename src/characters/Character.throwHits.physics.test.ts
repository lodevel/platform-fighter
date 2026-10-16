import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import type { GrabSpec } from './grabSchema';
import type { ThrowSpec } from './throwSchema';
import { PIKACHU_PUMMEL } from './pikachuGrab';
import { PIKACHU_BACK_THROW_ROOT_MOTION_X } from './pikachuBackThrowRootMotion';
import { registerFighterAttack } from './attackRegistration';
import { STALE_FRESH_MULTIPLIER, computeHitlag } from './combat';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';

/** Throws and pummels enter the stale queue as fresh moves: x1.05 on first use. */
const fresh = (damage: number): number => damage * STALE_FRESH_MULTIPLIER;

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };
// Independent expectations from pinned Pikachu ThrowF/ThrowHi game scripts.
const forward: ThrowSpec = { damage: 2, animationFrames: 29, recoveryFrames: 14,
  knockback: { x: 1, y: -1, scaling: 0, reference: { base: 55, growth: 110, angle: 45 } },
  heldTargetHits: [10, 14, 18, 22].map(frame => ({ frame, damage: 2, hitlagMultiplier: 0 })) };
const up: ThrowSpec = { damage: 5, animationFrames: 15, recoveryFrames: 20,
  knockback: { x: 0, y: -1, scaling: 0, reference: { base: 48, growth: 129, angle: 90 } },
  heldTargetHits: [{ frame: 13, damage: 3, hitlagMultiplier: 1.6 }] };

function fixture(spec: ThrowSpec, facing: 1 | -1 = 1, override: Partial<GrabSpec> = {}) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { on(name: string, fn: any) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, names[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); } } } };
  const grabber = new Character(scene, { id: 'pikachu', spawnX: 0, spawnY: 0, width: 40, height: 50 });
  const target = new Character(scene, { id: 'donkeykong', slotIndex: 1, spawnX: facing * 40, spawnY: 15, width: 10, height: 20 });
  const bystander = new Character(scene, { id: 'donkeykong', slotIndex: 2, spawnX: facing * 70, spawnY: 15, width: 10, height: 20 });
  const grab: GrabSpec = { id: 'fixture.grab', startupFrames: 1, activeFrames: 3, whiffRecoveryFrames: 2,
    hitbox: { offsetX: 40, offsetY: 0, width: 30, height: 30 }, holdFramesMax: 300,
    throwRecoveryFrames: 0, throws: { forward: spec, back: spec, up: spec, down: spec }, ...override };
  grabber.setGrabSpec(grab);
  Composite.add(engine.world, Bodies.rectangle(0, 35, 2000, 20, { isStatic: true,
    label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const contacts: string[] = [];
  const handler = new HitboxDamageHandler((index, hit, context) => {
    if (context.kind === 'grab') {
      if (index !== 1) return { confirmed: false };
      grabber.resolveGrabConnect(target); return { confirmed: true };
    }
    if (index !== 0) return { confirmed: false };
    const result = grabber.applyHitDetailed(hit);
    contacts.push(result.outcome);
    if (result.outcome === 'invulnerable') bystander.armAttackerHitlag(computeHitlag({ damage: hit.damage,
      targetPercent: 0, multiplier: hit.hitlagMultiplier, electricCollision: hit.electricCollision }));
    return { confirmed: result.outcome === 'invulnerable' || result.outcome === 'landed' };
  });
  [grabber, target, bystander].forEach((character, index) => handler.registerPlayer(index, character.body));
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (input: CharacterInput = neutral) => {
    grabber.applyInput(input); target.applyInput(neutral); bystander.applyInput(neutral);
    Engine.update(engine, 1000 / 60);
    for (const character of [grabber, target, bystander]) character.applyPostPhysicsVelocityConstraints();
  };
  for (let frame = 0; frame < 12; frame++) step();
  grabber.setFacing(facing);
  step({ ...neutral, grab: true }); step();
  expect(grabber.getGrabState().name).toBe('holding');
  expect(target.isGrabbed()).toBe(true);
  return { grabber, target, bystander, step, contacts, handler, engine };
}

describe('catch-only throw hits through real grab contact and Matter steps', () => {
  it.each([1, -1] as const)('observes actual capture entry and frozen captive age facing%s', facing => {
    const { grabber, target, step } = fixture(forward, facing);
    const entry = target.getCapturePresentationState()!;
    expect(entry).toMatchObject({ active: true, framesElapsed: 0,
      captor: { characterId: 'pikachu', bodyId: grabber.body.id, entryFacing: facing, facing },
      event: { kind: 'entry', framesElapsed: 0 } });
    target.applyGrabbed(grabber); expect(target.getCapturePresentationState()).toEqual(entry);
    step(); step(); expect(target.getCapturePresentationState()?.framesElapsed).toBe(2);
    target.armAttackerHitlag(4);
    const frozen = target.getCapturePresentationState();
    for (let n = 0; n < 10; n++) {
      target.applyPhysicsSubstepConstraints(); expect(target.getCapturePresentationState()).toEqual(frozen);
    }
    for (let n = 0; n < 4; n++) { step(); expect(target.getCapturePresentationState()).toEqual(frozen); }
    step(); expect(target.getCapturePresentationState()?.framesElapsed).toBe(3);
    const copy = target.getCapturePresentationState()!;
    copy.event.kind = 'release'; copy.captor.entryFacing = -facing as 1 | -1;
    expect(target.getCapturePresentationState()?.event.kind).toBe('entry');
    expect(target.getCapturePresentationState()?.captor.entryFacing).toBe(facing);
  });
  it('records actual external captured damage and preserves entry basis across live captor turning', () => {
    const { grabber, target, step } = fixture(forward);
    const entry = target.getCapturePresentationState()!;
    grabber.setFacing(-1);
    expect(target.getCapturePresentationState()?.captor).toMatchObject({ entryFacing: 1, facing: -1 });
    target.addDamage(0);
    expect(target.getCapturePresentationState()?.event.sequence).toBe(entry.event.sequence);
    target.addDamage(2);
    expect(target.getCapturePresentationState()?.event).toMatchObject({ kind: 'damage', damage: 2,
      damageSource: 'external', framesElapsed: 0 });
    target.applyHit({ damage: 3, knockback: { x: -3, y: -1, scaling: 0 }, facing: 1 });
    expect(target.getCapturePresentationState()?.event).toMatchObject({ kind: 'damage', damage: 3,
      damageSource: 'external', framesElapsed: 0 });
    expect(target.isGrabbed()).toBe(true); // Existing gameplay is untouched by the observer.
    target.releaseFromGrab();
    expect(target.getCapturePresentationState()).toMatchObject({ active: false,
      event: { kind: 'release', releaseReason: 'external' } });
    target.applyGrabbed(grabber); step();
    expect(target.getCapturePresentationState()!.captureId).toBeGreaterThan(entry.captureId);
    expect(target.getCapturePresentationState()?.captor.entryFacing).toBe(-1);
  });
  it('source invincibility registers one actual contact, freezes only attacker and consumes the persistent strike', () => {
    const { grabber, bystander, step, contacts } = fixture({ ...forward, invincibilityFrames: 30, hitlagMultiplier: 0 });
    step({ ...neutral, moveX: 1 });
    expect(grabber.isThrowInvincible()).toBe(true);
    registerFighterAttack(bystander, { id: 'fixture.persistent', type: 'tilt', damage: 3,
      knockback: { x: 2, y: -1, scaling: 0 }, startupFrames: 1, activeFrames: 80,
      recoveryFrames: 0, cooldownFrames: 0, hitbox: { offsetX: -70, offsetY: 0, width: 40, height: 40 } });
    expect(bystander.attemptAttack('fixture.persistent')).toBe(true); step();
    expect(contacts).toEqual(['invulnerable']);
    expect(grabber.getDamagePercent()).toBe(0);
    expect(grabber.getHitlagRemaining()).toBe(0);
    expect(bystander.getHitlagRemaining()).toBeGreaterThan(0);
    for (let n = 0; n < 40; n++) step();
    expect(grabber.isThrowInvincible()).toBe(false);
    expect(contacts).toEqual(['invulnerable']);
    expect(grabber.getDamagePercent()).toBe(0);
  });
  it('source protection includes release integration and retires next step while legacy throws stay vulnerable', () => {
    const source = fixture({ ...forward, invincibilityFrames: 30, hitlagMultiplier: 0 });
    source.step({ ...neutral, moveX: 1 });
    for (let n = 0; n < 29; n++) source.step();
    expect(source.grabber.getGrabState().name).toBe('cooldown');
    expect(source.grabber.isThrowInvincible()).toBe(true);
    expect(source.grabber.applyHitDetailed({ damage: 3, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 }).outcome).toBe('invulnerable');
    source.step(); expect(source.grabber.isThrowInvincible()).toBe(false);
    expect(source.grabber.applyHitDetailed({ damage: 3, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 }).outcome).toBe('landed');
    const legacy = fixture(forward); legacy.step({ ...neutral, moveX: 1 });
    expect(legacy.grabber.isThrowInvincible()).toBe(false);
    expect(legacy.grabber.applyHitDetailed({ damage: 3, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 }).outcome).toBe('landed');
  });
  it.each([0, 1, undefined])('release transports explicit hitlag%s while omitted preserves legacy', factor => {
    const { grabber, target, step } = fixture({ ...forward, hitlagMultiplier: factor, heldTargetHits: undefined });
    step({ ...neutral, moveX: 1 });
    for (let n = 0; n < 29; n++) step();
    expect(target.isGrabbed()).toBe(false);
    expect(target.getDamagePercent()).toBeCloseTo(fresh(2), 10);
    expect(grabber.getHitlagRemaining()).toBe(0); // Only the released target freezes.
    if (factor === 0) {
      expect(target.getHitlagRemaining()).toBe(0);
      expect(target.getVelocity().x).toBeGreaterThan(0);
    } else expect(target.getHitlagRemaining()).toBeGreaterThan(0);
  });
  it('zero-damage hit-stop carrier consumes separate source magnitude and exposes current born-step scheduling', () => {
    const { grabber, target, step } = fixture({ ...forward, animationFrames: 20, recoveryFrames: 23,
      heldTargetHits: [{ frame: 13, damage: 0, hitlagDamage: 3, hitlagMultiplier: 1.2 }] });
    step({ ...neutral, moveX: 1 });
    for (let n = 0; n < 13; n++) step();
    expect(target.getDamagePercent()).toBe(0);
    expect(target.getCapturePresentationState()?.event.kind).toBe('entry');
    expect(grabber.getHitlagRemaining()).toBe(9);
    expect(target.getHitlagRemaining()).toBe(8); // Target input consumes born step after captor event.
    for (let n = 0; n < 9; n++) {
      step(); expect(grabber.getGrabState().active?.framesElapsed).toBe(13);
    }
    for (let n = 0; n < 7; n++) step();
    expect(target.isGrabbed()).toBe(false);
    expect(target.getDamagePercent()).toBeCloseTo(fresh(2), 10); // Only the synthetic fixture release damage.
    // This qualifies the carrier, not native born-frame timing or Pikachu down DATA.
  });
  it('source pummel observes damage event0/freeze without introducing captured-hit commitment', () => {
    const { target, step } = fixture(forward, 1, { pummel: PIKACHU_PUMMEL });
    step({ ...neutral, attack: true });
    for (let n = 0; n < 5 && target.getDamagePercent() === 0; n++) step();
    expect(target.getCapturePresentationState()).toMatchObject({ active: true,
      event: { kind: 'damage', damage: fresh(PIKACHU_PUMMEL.damage), damageSource: 'pummel', framesElapsed: 0 } });
    const held = target.getCapturePresentationState()!;
    while (target.getHitlagRemaining() > 0) { step(); expect(target.getCapturePresentationState()).toEqual(held); }
    step();
    expect(target.getCapturePresentationState()!.event.framesElapsed).toBe(1);
    expect(target.isGrabbed()).toBe(true);
  });
  it('source throw pre-hit observes its own damage sequence and release is inactive history', () => {
    const { target, step } = fixture(up);
    step({ ...neutral, moveY: -1 });
    for (let n = 0; n < 13; n++) step();
    expect(target.getCapturePresentationState()).toMatchObject({ active: true,
      event: { kind: 'damage', damage: fresh(3), damageSource: 'throw-pre-hit', framesElapsed: 0 } });
    const sequence = target.getCapturePresentationState()!.event.sequence;
    for (let n = 0; n < 100 && target.isGrabbed(); n++) step();
    const released = target.getCapturePresentationState()!;
    expect(released).toMatchObject({ active: false, event: { kind: 'release', releaseReason: 'throw', framesElapsed: 0 } });
    expect(released.event.sequence).toBeGreaterThan(sequence);
    while (target.getHitlagRemaining() > 0) step();
    step();
    expect(target.getCapturePresentationState()!.framesElapsed).toBe(released.framesElapsed);
    expect(target.getCapturePresentationState()!.event.framesElapsed).toBe(1);
  });
  it('timeout is observed hold expiry, and actual captor hit is a break rather than a mash escape', () => {
    const timeout = fixture(forward, 1, { holdFramesMax: 3 });
    for (let n = 0; n < 3; n++) timeout.step();
    expect(timeout.target.getCapturePresentationState()).toMatchObject({ active: false,
      event: { kind: 'release', releaseReason: 'hold-expired' } });
    const interrupted = fixture(forward);
    interrupted.grabber.applyHit({ damage: 7, knockback: { x: -3, y: -1, scaling: 0 }, facing: 1 });
    expect(interrupted.target.getCapturePresentationState()).toMatchObject({ active: false,
      event: { kind: 'release', releaseReason: 'break', framesElapsed: 0 } });
    interrupted.target.releaseFromGrab();
    expect(interrupted.target.getCapturePresentationState()?.event.releaseReason).toBe('break');
    interrupted.target.setPosition(0, 0);
    expect(interrupted.target.getCapturePresentationState()).toBeNull();
  });
  it.each([1, -1] as const)('keeps four forward strikes separate from the release facing %s', facing => {
    const { grabber, target, bystander, step } = fixture(forward, facing);
    step({ ...neutral, moveX: facing });
    expect(grabber.getGrabState().active?.framesElapsed).toBe(0);
    for (let elapsed = 1; elapsed <= 29; elapsed++) {
      step();
      const expected = [10, 14, 18, 22].filter(frame => frame <= elapsed).length * 2 + (elapsed === 29 ? 2 : 0);
      expect(target.getDamagePercent(), `elapsed ${elapsed}`).toBeCloseTo(fresh(expected), 10);
      expect(bystander.getDamagePercent()).toBe(0);
      expect(target.isGrabbed()).toBe(elapsed < 29);
      if (elapsed < 29) {
        expect(target.getHitstunRemaining()).toBe(0);
        expect(target.getHitlagRemaining()).toBe(0);
        expect(target.getPosition().x - grabber.getPosition().x).toBeCloseTo(facing * 40, 4);
      }
    }
    expect(grabber.getGrabState()).toMatchObject({ name: 'cooldown', cooldownRemaining: 14 });
    // Source total43: source frame43 remains locked; first action is44.
    for (let frame = 1; frame <= 20; frame++) {
      step({ ...neutral, moveX: facing });
      if (frame < 14) expect(grabber.getVelocity().x).toBe(0);
      if (frame === 14) expect(grabber.getVelocity().x * facing).toBeGreaterThan(0);
    }
    expect(target.getDamagePercent()).toBeCloseTo(fresh(10), 10);
    expect(target.getVelocity().x * facing).toBeGreaterThan(0);
  });

  it('pauses the throw clock for the up-throw pre-hit, then releases once', () => {
    const { grabber, target, step } = fixture(up);
    step({ ...neutral, moveY: -1 });
    for (let elapsed = 1; elapsed <= 13; elapsed++) step();
    expect(target.getDamagePercent()).toBeCloseTo(fresh(3), 10);
    expect(target.isGrabbed()).toBe(true);
    const freeze = grabber.getHitlagRemaining();
    expect(freeze).toBeGreaterThan(0);
    for (let frame = 0; frame < freeze; frame++) {
      step();
      expect(grabber.getGrabState().active?.framesElapsed).toBe(13);
      expect(target.getDamagePercent()).toBeCloseTo(fresh(3), 10);
    }
    expect(target.getHitlagRemaining()).toBe(0);
    step(); expect(target.getDamagePercent()).toBeCloseTo(fresh(3), 10);
    step(); expect(target.getDamagePercent()).toBeCloseTo(fresh(8), 10);
    expect(target.isGrabbed()).toBe(false);
    expect(grabber.getGrabState()).toMatchObject({ name: 'cooldown', cooldownRemaining: 20 });
    // Freeze pauses the source clock; total35 still gives first action36.
    for (let frame = 1; frame <= 20; frame++) {
      step({ ...neutral, moveX: 1 });
      if (frame < 20) expect(grabber.getVelocity().x).toBe(0);
      else expect(grabber.getVelocity().x).toBeGreaterThan(0);
    }
  });

  it('cancels pending strikes when the grabber is interrupted', () => {
    const { grabber, target, step } = fixture(forward);
    step({ ...neutral, moveX: 1 });
    for (let frame = 0; frame < 10; frame++) step();
    expect(target.getDamagePercent()).toBeCloseTo(fresh(2), 10);
    grabber.applyHit({ damage: 7, knockback: { x: -3, y: -1, scaling: 0 }, facing: 1 });
    expect(target.isGrabbed()).toBe(false);
    for (let frame = 0; frame < 100; frame++) step();
    expect(grabber.getGrabState().name).toBe('idle');
    expect(target.getDamagePercent()).toBeCloseTo(fresh(2), 10);
  });

  it('fires an entry-frame event once while keeping the target captured', () => {
    const { target, step } = fixture({ ...forward,
      heldTargetHits: [{ frame: 0, damage: 2, hitlagMultiplier: 0 }] });
    step({ ...neutral, moveX: 1 });
    expect(target.getDamagePercent()).toBeCloseTo(fresh(2), 10);
    expect(target.isGrabbed()).toBe(true);
    for (let frame = 0; frame < 5; frame++) step();
    expect(target.getDamagePercent()).toBeCloseTo(fresh(2), 10);
  });
});


describe('source-guided backthrow actor transport through real Matter', () => {
  const spec: ThrowSpec = { damage: 9, hitlagMultiplier: 0, animationFrames: 25, recoveryFrames: 24,
    knockback: { x: 2, y: -2, scaling: 0 }, rootMotionX: PIKACHU_BACK_THROW_ROOT_MOTION_X };
  it.each([1, -1] as const)('transports each exact sampled delta in entry basis%s and retires on49', facing => {
    const { grabber, target, step } = fixture(spec, facing);
    const origin = grabber.getPosition().x;
    step({ ...neutral, moveX: -facing });
    expect(grabber.getThrowPresentationState()?.framesElapsed).toBe(0);
    for (let age = 0; age < 49; age++) {
      if (age) step();
      expect(grabber.getThrowPresentationState()?.framesElapsed).toBe(age);
      expect(grabber.getPosition().x - origin).toBeCloseTo(PIKACHU_BACK_THROW_ROOT_MOTION_X[age]! * facing, 5);
      if (age < 25) {
        expect(target.isGrabbed()).toBe(true);
        expect(target.getPosition().x - grabber.getPosition().x).toBeCloseTo(40 * facing, 7);
      }
    }
    expect(target.isGrabbed()).toBe(false);
    expect(target.getDamagePercent()).toBeCloseTo(fresh(9), 10);
    const final = grabber.getPosition().x;
    step();
    expect(grabber.getThrowPresentationState()).toBeNull();
    expect(grabber.getPosition().x).toBeCloseTo(final, 7);
    expect(grabber.getVelocity().x).toBe(0);
  });
  it.each([1, -1] as const)('freezes motion age and resumes one delta after actual hit-stop%s', facing => {
    const { grabber, target, step } = fixture(spec, facing);
    step({ ...neutral, moveX: -facing });
    for (let age = 1; age <= 10; age++) step();
    const frozen = grabber.getPosition().x;
    grabber.armAttackerHitlag(3);
    for (let tick = 0; tick < 3; tick++) {
      step();
      expect(grabber.getThrowPresentationState()?.framesElapsed).toBe(10);
      expect(grabber.getPosition().x).toBeCloseTo(frozen, 7);
      expect(target.isGrabbed()).toBe(true);
    }
    step();
    expect(grabber.getThrowPresentationState()?.framesElapsed).toBe(11);
    expect(grabber.getPosition().x - frozen).toBeCloseTo((PIKACHU_BACK_THROW_ROOT_MOTION_X[11]! - PIKACHU_BACK_THROW_ROOT_MOTION_X[10]!) * facing, 6);
  });
  it.each([1, -1] as const)('solid walls stop authored translation without absolute catch-up%s', facing => {
    const { grabber, step, engine } = fixture(spec, facing);
    const origin = grabber.getPosition().x;
    Composite.add(engine.world, Bodies.rectangle(origin - facing * 70, 0, 20, 1000, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    step({ ...neutral, moveX: -facing });
    for (let age = 1; age < 49; age++) step();
    const travel = (grabber.getPosition().x - origin) * facing;
    expect(travel).toBeGreaterThan(-41);
    expect(travel).toBeLessThan(-30);
    expect(travel).toBeGreaterThan(PIKACHU_BACK_THROW_ROOT_MOTION_X[48]! + 60);
  });
  it.each(['hit', 'capture', 'reset'] as const)('%s retires the trajectory before another delta', event => {
    const { grabber, target, bystander, step } = fixture(spec);
    step({ ...neutral, moveX: -1 });
    for (let age = 1; age <= 10; age++) step();
    if (event === 'hit') grabber.applyHit({ damage: 2, hitlagMultiplier: 0, facing: 1,
      knockback: { x: 4, y: -2, scaling: 0 } });
    else if (event === 'capture') grabber.applyGrabbed(bystander);
    else grabber.setPosition(200, -100);
    expect(grabber.getThrowPresentationState()).toBeNull();
    expect(target.isGrabbed()).toBe(false);
    const before = grabber.getPosition().x;
    step();
    if (event === 'hit') expect(grabber.getPosition().x).toBeGreaterThan(before);
    else expect(grabber.getPosition().x).toBeCloseTo(before, 7);
  });
});
