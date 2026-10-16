import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
import {Character, type CharacterInput} from './Character';
import {Pikachu} from './Pikachu';
import {PhysicsEngine} from '../engine/PhysicsEngine';
import {COLLISION_CATEGORIES} from '../engine/collisionCategories';
import {PLATFORM_LABELS} from '../stages/stageBodies';
import {stepCharacterPhysics} from './stepCharacterPhysics';
import {captureSimulationAnimation, resolveSimulationAction} from './simulationSpriteAnimation';
import {selectPikachuAuxiliaryBody} from './pikachuAuxiliaryBody';
import {pikachuLedgeJumpStartOffset} from './pikachuLedgeJumpRuntime';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = {moveX: 0, moveY: 0, jump: false};

function fixture(facing: 1 | -1, incomingFacing: 1 | -1 = facing, jumpFromLedge = true) {
  const engine = Engine.create();
  const clock = new PhysicsEngine();
  const names: Record<string, string> = {collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd'};
  const scene: any = {matter: {body: Body, add: {rectangle(x: number, y: number, width: number, height: number, options: object) {
    const body = Bodies.rectangle(x, y, width, height, options); Composite.add(engine.world, body); return body;
  }}, world: {on(name: string, fn: (...args: any[]) => void) {Events.on(engine, names[name] ?? name, fn);},
    off(name: string, fn: (...args: any[]) => void) {Events.off(engine, names[name] ?? name, fn);},
    remove(body: any) {Composite.remove(engine.world, body);}}}};
  const corner = {platformId: 'completion-runtime-ledge-jump-floor', side: facing === 1 ? 'left' as const : 'right' as const,
    x: facing === 1 ? -150 : 150, y: 90};
  const floor = Bodies.rectangle(0, 100, 300, 20, {isStatic: true, label: PLATFORM_LABELS.solid,
    plugin: {platformId: corner.platformId}, collisionFilter: {category: COLLISION_CATEGORIES.PLATFORM_SOLID}});
  Composite.add(engine.world, floor);
  const actor = new Pikachu(scene, {spawnX: corner.x - 12 * facing, spawnY: 95});
  actor.setFacing(incomingFacing); actor.setLedgeCandidates([corner]); Body.setVelocity(actor.body, {x: 0, y: 1});
  const friend = new Character(scene, {id: 'donkeykong', spawnX: 0, spawnY: 65, width: 40, height: 50});
  const step = (input: CharacterInput = neutral, friendInput: CharacterInput = neutral) => clock.advance(clock.fixedTimestepMs, () => {
    actor.applyInput(input); friend.applyInput(friendInput);
    stepCharacterPhysics({characters: [actor, friend], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
      body: Body, deltaMs: clock.fixedTimestepMs, stepWorld: dt => Engine.update(engine, dt)});
  });
  const catches: {actorFacing: 1 | -1; stateFacing: 1 | -1; poseFacing: number | undefined;
    position: {x: number; y: number}; attachment: NonNullable<ReturnType<Pikachu['getPikachuLedgeAttachmentState']>>}[] = [];
  for (let n = 0; n < 25; n++) {
    step();
    const active = actor.getLedgeHangState().active, attachment = actor.getPikachuLedgeAttachmentState();
    if (active && attachment) catches.push({actorFacing: actor.getFacing(), stateFacing: active.facing,
      poseFacing: resolveSimulationAction(captureSimulationAnimation(actor, clock.getFrame(), false)).facing,
      position: actor.getPosition(), attachment});
  }
  expect(actor.getLedgeHangState().name).toBe('hanging');
  const before = actor.getPosition();
  if (jumpFromLedge) {
    step({...neutral, jump: true});
    expect(actor.getPikachuLedgeJumpPresentationState()).toEqual({phase: 'start', framesElapsed: 0, facing});
  }
  const supportingPairs = () => engine.pairs.list.filter((pair: any) =>
    (pair.bodyA === actor.body && pair.bodyB === floor) || (pair.bodyA === floor && pair.bodyB === actor.body));
  return {actor, friend, step, clock, engine, floor, corner, before, supportingPairs, catches,
    addWall() {const wall = Bodies.rectangle(corner.x + 18 * facing, corner.y - 80, 10, 220,
      {isStatic: true, label: PLATFORM_LABELS.solid, plugin: {platformId: 'different-wall'},
        collisionFilter: {category: COLLISION_CATEGORIES.PLATFORM_SOLID}}); Composite.add(engine.world, wall); return wall;}};
}

function toFlight(f: ReturnType<typeof fixture>, requestLate = false) {
  while (f.actor.getPikachuLedgeJumpPresentationState()?.phase === 'start') {
    const age = f.actor.getPikachuLedgeJumpPresentationState()!.framesElapsed;
    f.step(requestLate && age === 10 ? {...neutral, jump: true, attack: true, special: true} : neutral);
  }
  expect(f.actor.getPikachuLedgeJumpPresentationState()?.phase).toBe('flight');
  expect(f.actor.getPikachuLedgeJumpPresentationState()?.framesElapsed).toBe(0);
}

describe('Pikachu integrated source ledge jump in real Matter', () => {
  it.each([1, -1] as const)('keeps either incoming facing outside the wall while hanging, then climbs inward %s', inward => {
    for (const incoming of [1, -1] as const) {
      const f = fixture(inward, incoming, false);
      expect(f.catches.length).toBeGreaterThanOrEqual(19);
      for (const caught of f.catches) {
        expect(caught.actorFacing).toBe(inward);
        expect(caught.stateFacing).toBe(inward);
        expect(caught.poseFacing).toBe(inward);
        expect(caught.attachment.facing).toBe(inward);
        expect((caught.position.x - f.corner.x) * inward).toBeLessThan(0);
        expect(caught.position.x + caught.attachment.handX * inward).toBeCloseTo(f.corner.x, 5);
        expect(caught.position.y + caught.attachment.handY).toBeCloseTo(f.corner.y, 5);
      }
      for (let age = 0; age < 100; age++) {
        const active = f.actor.getLedgeHangState().active!;
        const attachment = f.actor.getPikachuLedgeAttachmentState()!;
        const pose = resolveSimulationAction(captureSimulationAnimation(f.actor, f.clock.getFrame(), false));
        expect(active.facing).toBe(inward);
        expect(f.actor.getFacing()).toBe(inward);
        expect(pose.facing).toBe(inward);
        expect(attachment.facing).toBe(inward);
        expect((f.actor.getPosition().x - f.corner.x) * inward).toBeLessThan(0);
        expect(f.actor.getPosition().x + attachment.handX * inward).toBeCloseTo(f.corner.x, 5);
        expect(f.actor.getPosition().y + attachment.handY).toBeCloseTo(f.corner.y, 5);
        f.step();
      }
      f.step({...neutral, moveY: -1});
      expect(f.actor.getLedgeHangState().name).toBe('climbing');
      for (let age = 0; age < 45; age++) f.step();
      expect(f.actor.isGrounded()).toBe(true);
      expect((f.actor.getPosition().x - f.corner.x) * inward).toBeGreaterThan(0);
    }
  });

  it.each([1, -1] as const)('owns source start0..11, restores only real support pairs and launches cancellable flight %s', facing => {
    const f = fixture(facing);
    let sawBypassedPair = false;
    for (let age = 0; age < 12; age++) {
      const owner = f.actor.getPikachuLedgeJumpPresentationState()!;
      expect(owner).toEqual({phase: 'start', framesElapsed: age, facing});
      const offset = pikachuLedgeJumpStartOffset(age, 25)!;
      expect(Math.abs(f.actor.getPosition().x - f.corner.x - offset.x * facing)).toBeLessThan(.1);
      expect(Math.abs(f.actor.getPosition().y - f.corner.y - offset.y)).toBeLessThan(.1);
      const action = resolveSimulationAction(captureSimulationAnimation(f.actor, f.clock.getFrame(), false));
      const pose = selectPikachuAuxiliaryBody('ledge_jump_start', age)!;
      expect(action.auxiliarySheet).toBe('ledge_jump_start'); expect(action.directArtFrame).toBe(pose.artFrameIndex);
      expect(f.actor.getActiveHurtboxes()).toEqual(pose.hurtboxes.map(h => ({...h, intangible: true})));
      expect(f.actor.isCaptureProtected()).toBe(true);
      expect(f.actor.canAttack()).toBe(false); expect(f.actor.canUseItemsBeforeInput()).toBe(false);
      expect(f.actor.getActiveAttack()).toBeNull(); expect(f.actor.getJumpsquatRemaining()).toBe(0);
      expect(f.floor.isSensor).toBe(false); expect(f.friend.isGrounded()).toBe(true);
      sawBypassedPair ||= f.supportingPairs().some((pair: any) => pair.isSensor);
      if (age >= 9) {
        expect(f.actor.getPikachuLedgeAttachmentState()?.attached).toBe(false);
        expect(f.supportingPairs().every((pair: any) => !pair.isSensor)).toBe(true);
      }
      f.step([4, 9, 10].includes(age) ? {...neutral, moveX: -facing, jump: true, attack: true, special: true, shield: true, dodge: true, grab: true} : neutral);
    }
    expect(sawBypassedPair).toBe(true);
    const flight = f.actor.getPikachuLedgeJumpPresentationState();
    expect(flight).toEqual({phase: 'flight', framesElapsed: 0, facing});
    expect(f.actor.getPikachuLedgeAttachmentState()).toBeNull();
    expect(f.actor.getJumpsUsed()).toBe(1); expect(f.actor.isGrounded()).toBe(false);
    expect(f.actor.getVelocity().x).toBeCloseTo(3 * facing); expect(f.actor.getVelocity().y).toBeLessThan(0);
    expect(f.actor.getJumpsquatRemaining()).toBe(0); expect(f.actor.canAttack()).toBe(true);
    expect(f.actor.getActiveHurtboxes().every(h => !h.intangible)).toBe(true);
    expect(f.actor.isInvincible()).toBe(false);
    const launchY = f.corner.y - 25;
    let apex = f.actor.getPosition().y;
    for (let age = 0; age < 27; age++) {
      expect(f.actor.getPikachuLedgeJumpPresentationState()).toEqual({phase: 'flight', framesElapsed: age, facing});
      const pose = selectPikachuAuxiliaryBody('ledge_jump', age)!;
      expect(resolveSimulationAction(captureSimulationAnimation(f.actor, f.clock.getFrame(), false)).directArtFrame).toBe(pose.artFrameIndex);
      expect(f.actor.getActiveHurtboxes()).toEqual(pose.hurtboxes);
      apex = Math.min(apex, f.actor.getPosition().y); f.step();
    }
    expect(launchY - apex).toBeCloseTo(188.75, 5);
    expect(f.actor.getPikachuLedgeJumpPresentationState()).toBeNull();
    for (let n = 0; n < 100 && !f.actor.isGrounded(); n++) f.step();
    expect(f.actor.isGrounded()).toBe(true); expect(f.floor.isSensor).toBe(false);
  });

  it.each([1, -1] as const)('allows first fresh airborne jump, attack, special and dodge without a flight-duration lock %s', facing => {
    for (const action of ['jump', 'attack', 'special', 'shield'] as const) {
      const f = fixture(facing); toFlight(f, true); f.step();
      expect(f.actor.getJumpsquatRemaining()).toBe(0);
      f.step({...neutral, [action]: true});
      expect(f.actor.getPikachuLedgeJumpPresentationState()).toBeNull();
      if (action === 'jump') {expect(f.actor.getJumpsUsed()).toBe(2); expect(f.actor.getJumpPresentationState()?.kind).toBe('air'); expect(f.actor.getVelocity().y).toBeLessThan(0);}
      if (action === 'attack') expect(f.actor.getActiveAttack()?.move.id).toBe('pikachu.neutral-air');
      if (action === 'special') expect(f.actor.getPikachuSpecialState()).not.toBeNull();
      if (action === 'shield') expect(f.actor.getDodgeState().active?.kind).toBe('air');
    }
  });

  it.each([1, -1] as const)('freezes actual fixed-step pause and hitlag without replaying a start Trans delta %s', facing => {
    const f = fixture(facing); for (let n = 0; n < 4; n++) f.step();
    const position = f.actor.getPosition(), state = f.actor.getPikachuLedgeJumpPresentationState(), receiving = f.actor.getActiveHurtboxes();
    const timestamp = f.engine.timing.timestamp, frame = f.clock.getFrame();
    f.clock.pause(); for (let n = 0; n < 12; n++) expect(f.step({...neutral, attack: true})).toBe(0);
    expect(f.clock.getFrame()).toBe(frame); expect(f.engine.timing.timestamp).toBe(timestamp);
    expect(f.actor.getPikachuLedgeJumpPresentationState()).toEqual(state); expect(f.actor.getPosition()).toEqual(position);
    f.clock.resume(); f.actor.armAttackerHitlag(4);
    for (let n = 0; n < 4; n++) {
      f.step({...neutral, jump: true, attack: true});
      expect(f.actor.getPikachuLedgeJumpPresentationState()).toEqual(state);
      expect(f.actor.getPosition().x).toBeCloseTo(position.x, 6); expect(f.actor.getPosition().y).toBeCloseTo(position.y, 6);
      expect(f.actor.getActiveHurtboxes()).toEqual(receiving);
    }
    f.step(); expect(f.actor.getPikachuLedgeJumpPresentationState()?.framesElapsed).toBe(5);
    const expected = pikachuLedgeJumpStartOffset(5, 25)!;
    expect(f.actor.getPosition().y).toBeCloseTo(f.corner.y + expected.y, 6);
  });

  it.each([1, -1] as const)('leaves another wall solid and never catches up its blocked source X %s', facing => {
    const f = fixture(facing), wall = f.addWall();
    let touched = false;
    for (let age = 1; age < 12; age++) {
      f.step(); const vertices = f.actor.body.vertices;
      expect(vertices).toBeDefined();
      const min = Math.min(...vertices!.map(v => v.x)), max = Math.max(...vertices!.map(v => v.x));
      const penetration = Math.min(max, wall.bounds.max.x) - Math.max(min, wall.bounds.min.x);
      if (penetration > 0) {touched = true; expect(penetration).toBeLessThan(.6);}
      expect(wall.isSensor).toBe(false);
    }
    expect(touched).toBe(true); expect((f.corner.x - f.actor.getPosition().x) * facing).toBeGreaterThan(2);
    expect(f.actor.getPikachuLedgeJumpPresentationState()?.framesElapsed).toBe(11);
  });

  it.each([1, -1] as const)('freezes all four flight hitlag steps and resumes its next ordinary flight age once %s', facing => {
    const f = fixture(facing), control = fixture(facing); toFlight(f); toFlight(control);
    for (let n = 0; n < 7; n++) {f.step(); control.step();}
    const state = f.actor.getPikachuLedgeJumpPresentationState(), position = f.actor.getPosition(), receiving = f.actor.getActiveHurtboxes();
    expect(state).toEqual({phase: 'flight', framesElapsed: 7, facing});
    expect(position).toEqual(control.actor.getPosition());
    f.actor.armAttackerHitlag(4);
    for (let n = 0; n < 4; n++) {
      f.step();
      expect(f.actor.getHitlagRemaining()).toBe(3 - n);
      expect(f.actor.getPikachuLedgeJumpPresentationState()).toEqual(state);
      expect(f.actor.getActiveHurtboxes()).toEqual(receiving);
      expect(f.actor.getPosition().x).toBeCloseTo(position.x, 6);
      expect(f.actor.getPosition().y).toBeCloseTo(position.y, 6);
    }
    f.step(); control.step();
    expect(f.actor.getPikachuLedgeJumpPresentationState()).toEqual({phase: 'flight', framesElapsed: 8, facing});
    expect(f.actor.getPosition().x).toBeCloseTo(control.actor.getPosition().x, 6);
    expect(f.actor.getPosition().y).toBeCloseTo(control.actor.getPosition().y, 6);
    expect(f.actor.getVelocity().x).toBeCloseTo(control.actor.getVelocity().x, 6);
    expect(f.actor.getVelocity().y).toBeCloseTo(control.actor.getVelocity().y, 6);
  });

  it('retains the generic airborne baseline transport on its final attacker-hitlag release step', () => {
    const f = fixture(1); f.step(neutral, {...neutral, jump: true});
    for (let n = 0; n < 10; n++) f.step();
    expect(f.friend.isGrounded()).toBe(false); expect(f.friend.getVelocity().y).toBeLessThan(0);
    const position = f.friend.getPosition(); f.friend.armAttackerHitlag(4);
    for (let n = 0; n < 3; n++) {
      f.step(); expect(f.friend.getPosition().x).toBeCloseTo(position.x, 6); expect(f.friend.getPosition().y).toBeCloseTo(position.y, 6);
    }
    f.step(); expect(f.friend.getHitlagRemaining()).toBe(0);
    expect(f.friend.getPosition().y).toBeLessThan(position.y);
  });

  it('retires the deferred flight freeze anchor before an airborne footstool recipient owns further physics', () => {
    const f = fixture(1); toFlight(f); for (let n = 0; n < 7; n++) f.step();
    f.actor.armAttackerHitlag(4); for (let n = 0; n < 4; n++) f.step();
    expect(f.actor.getHitlagRemaining()).toBe(0);
    expect(f.actor.getPikachuLedgeJumpPresentationState()?.framesElapsed).toBe(7);
    const position = f.actor.getPosition();
    f.actor.applyFootstoolRecipient(false, f.clock.getFrame());
    expect(f.actor.getPikachuLedgeJumpPresentationState()).toBeNull();
    expect(f.actor.getFootstoolRecipientPresentationState()?.framesElapsed).toBe(0);
    // A later collision-only integration must belong to the new recipient,
    // even before another input clock can clean up an obsolete ledge anchor.
    Body.setVelocity(f.actor.body, {x: 0, y: 3});
    stepCharacterPhysics({characters: [f.actor, f.friend], bodies: Composite.allBodies(f.engine.world), gravity: f.engine.gravity,
      body: Body, deltaMs: f.clock.fixedTimestepMs, stepWorld: dt => Engine.update(f.engine, dt)});
    expect(f.actor.getPosition().y).toBeGreaterThan(position.y + 2);
    expect(f.actor.getPosition().x).toBeCloseTo(position.x, 6);
    f.step();
    expect(f.actor.getVelocity().y).toBeGreaterThan(0);
    expect(f.actor.getPikachuLedgeJumpPresentationState()).toBeNull();
    expect(f.actor.getFootstoolRecipientPresentationState()?.framesElapsed).toBe(1);
  });

  it('retires physical attachment on capture, reset and an actual vulnerable airborne hit', () => {
    const captured = fixture(1); captured.actor.applyGrabbed(captured.friend); expect(captured.actor.isGrabbed()).toBe(true);
    expect(captured.actor.getPikachuLedgeJumpPresentationState()).toBeNull(); expect(captured.actor.getPikachuLedgeAttachmentState()).toBeNull();
    expect(captured.floor.isSensor).toBe(false);
    const reset = fixture(-1); reset.actor.resetForRound(0, 65);
    expect(reset.actor.getPikachuLedgeJumpPresentationState()).toBeNull(); expect(reset.actor.getPikachuLedgeAttachmentState()).toBeNull();
    const damaged = fixture(1); toFlight(damaged);
    damaged.actor.applyHit({damage: 3, facing: -1, hitlagMultiplier: 0, knockback: {x: 3, y: -3, scaling: 0}});
    expect(damaged.actor.getDamagePercent()).toBe(3); expect(damaged.actor.getPikachuLedgeJumpPresentationState()).toBeNull();
  });
});
