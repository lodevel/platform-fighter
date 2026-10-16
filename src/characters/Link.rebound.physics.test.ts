import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_DAIR } from './Link';
import type { CharacterInput, CharacterHitOutcome } from './Character';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function world(shield = false) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, settings: object) {
      const body = Bodies.rectangle(x, y, w, h, settings);
      Composite.add(engine.world, body); return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const attacker = new Link(scene, { spawnX: 0, spawnY: 0 });
  // Distinct slots: a capture needs a nonself captor identity.
  const defender = new Link(scene, { spawnX: 0, spawnY: 65, slotIndex: 1 });
  const fighters = [attacker, defender];
  const contacts: Array<{ frame: number; targetIndex: number; attackInstance?: object;
    rebound: boolean; outcome: CharacterHitOutcome; damage: number; velocity: { x: number; y: number } }> = [];
  const handler = new HitboxDamageHandler((targetIndex, hit, context) => {
    const target = fighters[targetIndex]!;
    const owner = fighters[context.attackerPlayerIndex!]!;
    const result = target.applyHitDetailed(hit);
    if (result.outcome !== 'landed' && result.outcome !== 'shielded' && result.outcome !== 'parried') return { confirmed: false };
    if (result.outcome === 'landed') owner.armAttackerHitlag(target.getHitlagRemaining());
    const rebound = owner.applyAerialRebound(context.attackInstance, result.outcome);
    contacts.push({ frame: owner.getActiveAttack()?.framesElapsed ?? -1, targetIndex,
      attackInstance: context.attackInstance, rebound, outcome: result.outcome,
      damage: result.damageApplied, velocity: owner.getVelocity() });
    return { confirmed: true };
  });
  fighters.forEach((fighter, index) => handler.registerPlayer(index, fighter.body));
  handler.setGroundedLookup(index => fighters[index]!.isGrounded());
  handler.setHurtboxLookup(index => fighters[index]!.getActiveHurtboxes());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (input: CharacterInput = NEUTRAL, defenderInput: CharacterInput = { ...NEUTRAL, shield },
    beforePhysics?: () => void) => {
    fighters.forEach((fighter, index) => fighter.applyInput(index === 0 ? input : index === 1 ? defenderInput : NEUTRAL));
    beforePhysics?.();
    Engine.update(engine, 1000 / 60);
    fighters.forEach(fighter => fighter.applyPostPhysicsVelocityConstraints());
  };
  if (shield) {
    Composite.add(engine.world, Bodies.rectangle(0, 65 + defender.getTuning().height / 2 + 10, 2000, 20, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    }));
    for (let i = 0; i < 20; i++) {
      Body.setPosition(attacker.body, { x: 500, y: -300 });
      Body.setVelocity(attacker.body, { x: 0, y: 0 }); step();
    }
    attacker.resetForRound(0, defender.getPosition().y - 145);
    expect(defender.isShielding()).toBe(true);
  }
  const start = () => step({ ...NEUTRAL, moveY: 1, attack: true });
  const untilContact = () => {
    for (let i = 0; i < 100 && contacts.length === 0; i++) step();
    expect(contacts).toHaveLength(1);
  };
  const releaseHitlag = () => {
    for (let i = 0; i < 100 && attacker.getHitlagRemaining() > 0; i++) step();
    expect(attacker.getHitlagRemaining()).toBe(0);
  };
  // Reposition through Matter's public API so tests can hold an overlap
  // across launch and sensor replacement while collision delivery stays real.
  const alignTarget = (target = defender) => {
    const sensor = attacker.getActiveAttack()?.hitboxBody;
    const pos = sensor?.position ?? { x: attacker.getPosition().x, y: attacker.getPosition().y + 28 };
    Body.setPosition(target.body, pos);
    Body.setVelocity(target.body, { x: 0, y: 0 });
  };
  return { attacker, defender, engine, scene, fighters, contacts, handler, step, start,
    untilContact, releaseHitlag, alignTarget };
}

describe('Link down-air rebound through real Matter contacts', () => {
  it('a damaging down air rises after mutual hitlag without spending a jump', () => {
    const { attacker, defender, contacts, start, untilContact, releaseHitlag } = world();
    start(); untilContact();
    expect(contacts[0]!.outcome).toBe('landed');
    expect(defender.getDamagePercent()).toBe(18);
    expect(attacker.getHitlagRemaining()).toBeGreaterThan(0);
    const jumps = attacker.getJumpsUsed();
    releaseHitlag();
    expect(attacker.getVelocity().y).toBeLessThan(-4);
    expect(attacker.getJumpsUsed()).toBe(jumps);
    expect(attacker.getActiveAttack()?.move.id).toBe(LINK_DAIR.id);
  });

  it('shield contact bounces without damaging the shielding opponent', () => {
    const { attacker, defender, contacts, start, untilContact } = world(true);
    start(); untilContact();
    expect(contacts[0]!.outcome).toBe('shielded');
    expect(defender.getDamagePercent()).toBe(0);
    expect(attacker.getVelocity().y).toBeCloseTo(-LINK_DAIR.rebound!.upwardSpeed, 8);
  });

  it('a solid ceiling keeps its solved velocity when a shield rebound is queued', () => {
    const { attacker, defender, engine, start, step } = world();
    Body.setPosition(defender.body, { x: 1000, y: 1000 });
    start();
    for (let frame = 0; frame < 20 && !attacker.getActiveAttack()?.hitboxBody; frame++) step();
    const sensor = attacker.getActiveAttack()!.hitboxBody!;
    expect(attacker.applyAerialRebound(sensor.plugin.attackInstance, 'shielded')).toBe(true);
    Body.setPosition(attacker.body, { x: 0, y: 0 });
    Body.setVelocity(attacker.body, { x: 0, y: -1 });
    Composite.add(engine.world, Bodies.rectangle(0, -attacker.getTuning().height / 2 - 9, 200, 20, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    }));
    Engine.update(engine, 1000 / 60);
    const solvedY = attacker.getVelocity().y;
    expect(solvedY).toBeGreaterThan(-0.01);
    attacker.applyPostPhysicsVelocityConstraints();
    expect(attacker.getVelocity().y).toBeCloseTo(solvedY, 8);
    expect(attacker.getActiveAttack()?.hitboxBody).toBeNull();
  });

  it('shield-first simultaneous damage transfers the queued rebound into outgoing hitlag', () => {
    const { attacker, defender, scene, fighters, handler, contacts, start, step, releaseHitlag } = world(true);
    const otherTarget = new Link(scene, { spawnX: defender.getPosition().x, spawnY: defender.getPosition().y });
    // Keep the targets together for real simultaneous sensor contacts without
    // the two target bodies separating each other before the strike arrives.
    otherTarget.body.isSensor = true;
    fighters.push(otherTarget);
    handler.registerPlayer(2, otherTarget.body);
    start();
    for (let frame = 0; frame < 100 && contacts.length === 0; frame++) {
      step(NEUTRAL, { ...NEUTRAL, shield: true }, () => {
        Body.setPosition(otherTarget.body, defender.getPosition());
        Body.setVelocity(otherTarget.body, { x: 0, y: 0 });
      });
    }
    expect(contacts.map(contact => contact.outcome)).toEqual(['shielded', 'landed']);
    expect(contacts.filter(contact => contact.rebound)).toHaveLength(1);
    expect(defender.getDamagePercent()).toBe(0);
    expect(otherTarget.getDamagePercent()).toBe(18);
    expect(attacker.getHitlagRemaining()).toBeGreaterThan(0);
    expect(attacker.getVelocity().y).toBe(0);
    releaseHitlag();
    expect(attacker.getVelocity().y).toBeLessThan(-4);
    expect(attacker.getActiveAttack()?.move.id).toBe(LINK_DAIR.id);
  });

  it('removes the whole hitbox for 30 attack frames, then returns an 11-damage hit excluding hitlag', () => {
    const { attacker, defender, scene, engine, fighters, handler, contacts, step, start, alignTarget } = world();
    let firstSensor: any = null;
    let returnSensor: any = null;
    start();
    for (let frame = 0; frame < 100 && contacts.length === 0; frame++) {
      step(NEUTRAL, NEUTRAL, () => { firstSensor ??= attacker.getActiveAttack()?.hitboxBody; });
    }
    expect(contacts).toHaveLength(1);
    expect(firstSensor).not.toBeNull();
    const firstFrame = contacts[0]!.frame;
    const otherTarget = new Link(scene, { spawnX: defender.getPosition().x, spawnY: defender.getPosition().y });
    fighters.push(otherTarget);
    handler.registerPlayer(2, otherTarget.body);
    const alignBothTargets = () => {
      if (attacker.getActiveAttack()!.framesElapsed >= firstFrame + 30) {
        returnSensor ??= attacker.getActiveAttack()!.hitboxBody;
      }
      alignTarget();
      alignTarget(otherTarget);
    };
    const expectNoSensor = () => {
      expect(attacker.getActiveAttack()?.hitboxBody).toBeNull();
      expect(Composite.allBodies(engine.world).filter((body: any) =>
        body.collisionFilter.category === COLLISION_CATEGORIES.HITBOX &&
        body.plugin?.ownerBodyId === attacker.body.id)).toHaveLength(0);
    };
    expectNoSensor();
    const freezeFrames = attacker.getHitlagRemaining();
    expect(freezeFrames).toBeGreaterThan(0);
    for (let frozen = 0; frozen < freezeFrames; frozen++) {
      step(NEUTRAL, NEUTRAL, alignBothTargets);
      expect(attacker.getActiveAttack()?.framesElapsed).toBe(firstFrame);
      expectNoSensor();
      expect(contacts).toHaveLength(1);
      expect(otherTarget.getDamagePercent()).toBe(0);
    }
    for (let frame = 0; frame < 40 && contacts.length < 2; frame++) {
      step(NEUTRAL, NEUTRAL, alignBothTargets);
      if (attacker.getActiveAttack()!.framesElapsed < firstFrame + 30) {
        expectNoSensor();
        expect(contacts).toHaveLength(1);
        expect(otherTarget.getDamagePercent()).toBe(0);
      }
    }
    expect(contacts).toHaveLength(3);
    expect(contacts.map(contact => contact.frame)).toEqual([firstFrame, firstFrame + 30, firstFrame + 30]);
    expect(contacts.map(contact => contact.damage)).toEqual([18, 11, 11]);
    expect(contacts.filter(contact => contact.rebound)).toHaveLength(2);
    expect(contacts[1]!.attackInstance).toBe(contacts[0]!.attackInstance);
    expect(returnSensor).not.toBeNull();
    expect(returnSensor).not.toBe(firstSensor);
    expect(returnSensor.plugin.hitGroup).not.toBe(firstSensor.plugin.hitGroup);
    expect(defender.getDamagePercent()).toBe(29);
    expect(otherTarget.getDamagePercent()).toBe(11);
  });

  it('omitting rebound preserves the ordinary down-air trajectory after a confirmed hit', () => {
    const { attacker, contacts, start, untilContact, releaseHitlag } = world();
    const ordinaryDair = { ...LINK_DAIR, rebound: undefined };
    attacker.addAttack(ordinaryDair);
    start();
    untilContact();
    releaseHitlag();
    expect(contacts[0]!.outcome).toBe('landed');
    expect(contacts[0]!.rebound).toBe(false);
    expect(attacker.getVelocity().y).toBeGreaterThan(0);
    expect(attacker.getActiveAttack()?.move.id).toBe(LINK_DAIR.id);
  });

  it('a missed down air completes without any rebound', () => {
    const { attacker, defender, contacts, start, step } = world();
    Body.setPosition(defender.body, { x: 5000, y: 65 });
    start();
    for (let frame = 0; frame < 85; frame++) {
      step();
      expect(attacker.getVelocity().y).toBeGreaterThanOrEqual(0);
    }
    expect(contacts).toHaveLength(0);
    expect(attacker.getActiveAttack()).toBeNull();
  });

  it('simultaneous targets produce one rebound without restoring spent air jumps', () => {
    const { attacker, defender, scene, fighters, handler, contacts, start, step, releaseHitlag } = world();
    step({ ...NEUTRAL, jump: true });
    step();
    step({ ...NEUTRAL, jump: true });
    expect(attacker.getJumpsRemaining()).toBe(0);
    Body.setPosition(attacker.body, { x: 0, y: 0 });
    Body.setVelocity(attacker.body, { x: 0, y: 0 });
    defender.resetForRound(0, 65);
    const otherTarget = new Link(scene, { spawnX: 0, spawnY: 65 });
    fighters.push(otherTarget);
    handler.registerPlayer(2, otherTarget.body);
    start();
    for (let frame = 0; frame < 100 && contacts.length < 2; frame++) step();
    expect(contacts).toHaveLength(2);
    expect(contacts.map(contact => contact.targetIndex).sort()).toEqual([1, 2]);
    expect(contacts[0]!.frame).toBe(contacts[1]!.frame);
    expect(contacts.filter(contact => contact.rebound)).toHaveLength(1);
    releaseHitlag();
    expect(attacker.getVelocity().y).toBeLessThan(-4);
    expect(attacker.getJumpsRemaining()).toBe(0);
  });

  it('fast fall suppresses rebound, hitbox interruption and returning hits', () => {
    const { attacker, contacts, start, step, releaseHitlag, alignTarget } = world();
    Body.setVelocity(attacker.body, { x: 0, y: 1 });
    start();
    expect(attacker.getVelocity().y).toBeGreaterThan(attacker.getTuning().maxFallSpeed);
    for (let frame = 0; frame < 100 && contacts.length === 0; frame++) step(NEUTRAL, NEUTRAL, alignTarget);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.rebound).toBe(false);
    expect(attacker.getActiveAttack()?.hitboxBody).not.toBeNull();
    releaseHitlag();
    expect(attacker.getVelocity().y).toBeGreaterThan(attacker.getTuning().maxFallSpeed);
    for (let frame = 0; frame < 35; frame++) {
      step(NEUTRAL, NEUTRAL, alignTarget);
      expect(contacts).toHaveLength(1);
      expect(attacker.getVelocity().y).toBeGreaterThan(attacker.getTuning().maxFallSpeed);
      expect(attacker.getActiveAttack()?.move.id).toBe(LINK_DAIR.id);
      expect(attacker.getActiveAttack()?.hitboxBody).not.toBeNull();
    }
  });

  it.each(['damage', 'capture', 'reset'] as const)(
    '%s interrupts a rebound queued behind outgoing hitlag', interruption => {
      const { attacker, defender, contacts, start, untilContact, releaseHitlag, step } = world();
      start();
      untilContact();
      expect(contacts[0]!.rebound).toBe(true);
      expect(attacker.getHitlagRemaining()).toBeGreaterThan(0);
      const staleIdentity = contacts[0]!.attackInstance;
      if (interruption === 'damage') {
        attacker.applyHit({ damage: 1, knockback: { x: 0, y: 4, scaling: 0 }, facing: 1 });
      } else if (interruption === 'capture') {
        attacker.applyGrabbed(defender);
        step();
        attacker.releaseFromGrab();
      } else {
        attacker.resetForRound(0, -500);
      }
      expect(attacker.getActiveAttack()).toBeNull();
      expect(attacker.applyAerialRebound(staleIdentity, 'landed')).toBe(false);
      releaseHitlag();
      for (let frame = 0; frame < 5; frame++) {
        step();
        expect(attacker.getVelocity().y).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it('a ledge catch cancels the rebounding aerial and rejects stale contact after release', () => {
    const { attacker, contacts, start, untilContact, releaseHitlag, step } = world();
    start();
    untilContact();
    releaseHitlag();
    const pos = attacker.getPosition();
    attacker.setLedgeCandidates([{ ...pos, side: 'right', platformId: 'edge' }]);
    Body.setVelocity(attacker.body, { x: 0, y: 2 });
    step();
    expect(attacker.isHangingOnLedge()).toBe(true);
    expect(attacker.getActiveAttack()).toBeNull();
    step({ ...NEUTRAL, ledgeRelease: 'dropDown' });
    attacker.setLedgeCandidates([]);
    expect(attacker.applyAerialRebound(contacts[0]!.attackInstance, 'landed')).toBe(false);
    for (let frame = 0; frame < 5; frame++) {
      step();
      expect(attacker.getVelocity().y).toBeGreaterThanOrEqual(0);
    }
  });

  it('a floor contact during hitlag does not leave landing lag after rebound lifts off', () => {
    const { attacker, engine, start, untilContact, releaseHitlag, step } = world();
    start();
    untilContact();
    const pos = attacker.getPosition();
    Composite.add(engine.world, Bodies.rectangle(pos.x,
      pos.y + attacker.getTuning().height / 2 + 10, 2000, 20, {
        isStatic: true, label: PLATFORM_LABELS.solid,
        collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
      }));
    step();
    expect(attacker.isGrounded()).toBe(true);
    releaseHitlag();
    expect(attacker.getVelocity().y).toBeLessThan(-4);
    for (let frame = 0; frame < 3; frame++) {
      step();
      expect(attacker.getActiveAttack()?.move.id).toBe(LINK_DAIR.id);
      expect(attacker.getAnimationActionState().landingRecoveryRemaining).toBe(0);
    }
  });
});
