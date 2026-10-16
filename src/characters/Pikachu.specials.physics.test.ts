import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, TRIP_KNOCKDOWN_FRAMES, TRIP_OPTION_LOCK_FRAMES, type CharacterInput } from './Character';
import { createPikachuSpecialMoves, PIKACHU_UP_SPECIAL } from './pikachuSpecialMoves';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { HitboxDamageHandler, type HitContext } from '../match/HitboxDamageHandler';
import { registerFighterAttack } from './attackRegistration';
import { HITBOX_LABEL, spawnHitbox } from './attacks';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { PIKACHU_MOVEMENT_PROFILE } from './pikachuMovement';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { buildPikachuSmashWithAuthoredHurtboxes } from './pikachuSmashHurtboxes';
import type { SpecialProjectileTarget } from './pikachuSpecialRuntime';
import { resolvePikachuSpecialBodyClock } from './pikachuSpecialPresentation';
import { selectPikachuSpecialPhaseHurtboxes } from './pikachuSpecialPhaseHurtboxes';
import { createLedgeHangState, resolveLedgeHangTuning, tickLedgeHang } from './ledgeHangState';
import { PIKACHU_LEDGE_ATTACK, PIKACHU_TRIP_ATTACK } from './pikachuRecoveryAttacks';
import { buildPikachuJabWithAuthoredHurtboxes } from './pikachuJabHurtboxes';
import { buildPikachuVerticalTiltWithAuthoredHurtboxes } from './pikachuVerticalTiltHurtboxes';
import { AttackClankHandler } from '../match/AttackClankHandler';
import { pikachuSpecialContact } from './pikachuSpecialContactData';
import { PIKACHU_QUICK_ROT_PIVOT, rotatePikachuSpecialPoint } from './pikachuSpecialTransforms';
import { captureSimulationAnimation, resolveSimulationAction } from './simulationSpriteAnimation';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function fixture(grounded = false, clank = false, targetShape: { width: number; height: number } | null = null) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const pikachu = new Character(scene, { id: 'pikachu', spawnX: 0, spawnY: 0, width: 40, height: 50, ...PIKACHU_MOVEMENT_PROFILE });
  const target = new Character(scene, { id: 'donkeykong', slotIndex: 1, spawnX: 800, spawnY: 0, ...targetShape });
  for (const move of Object.values(createPikachuSpecialMoves())) registerFighterAttack(pikachu, move);
  const floor = Bodies.rectangle(0, pikachu.getTuning().height / 2 + 10, 4000, 20,
    { isStatic: true, label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
  if (grounded) Composite.add(engine.world, floor);
  const hits: Array<{ damage: number; context: HitContext }> = [];
  const defenses: SpecialProjectileTarget[] = [];
  const handler = new HitboxDamageHandler((index, hit, context) => {
    const fighter = index === 0 ? pikachu : target;
    const result = fighter.applyHitDetailed(hit);
    const confirmed = ['landed', 'shielded', 'parried'].includes(result.outcome);
    if (confirmed) hits.push({ damage: hit.damage, context });
    pikachu.notifyPikachuSpecialContact(context.attackInstance, result.outcome);
    return { confirmed };
  });
  handler.registerPlayer(0, pikachu.body); handler.registerPlayer(1, target.body);
  handler.setHurtboxLookup(index => (index === 0 ? pikachu : target).getActiveHurtboxes());
  handler.setFacingLookup(index => (index === 0 ? pikachu : target).getFacing());
  handler.setGroundedLookup(index => (index === 0 ? pikachu : target).isGrounded());
  let simulationFrame = 0;
  if (clank) {
    const priority = new AttackClankHandler({ frame: () => simulationFrame, players: () => 2,
      damage: (plugin, row) => row?.damage ?? plugin.damage,
      rebound: (owner, freeze, frames) => (owner === pikachu.body.id ? pikachu : target).applyAttackClank(freeze, frames) });
    handler.setAttackClankHooks(() => priority.sampleBodies(Composite.allBodies(engine.world)),
      (sensor, targetBodyId) => priority.canHit(sensor, targetBodyId));
  }
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const physics = () => stepCharacterPhysics({ characters: [pikachu, target], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
    body: Body, deltaMs: 1000 / 60, stepWorld: dt => Engine.update(engine, dt),
    afterSubstep: () => handler.sampleHurtboxContacts(Composite.allBodies(engine.world)) });
  const step = (input: CharacterInput = neutral, targetInput: CharacterInput = neutral) => {
    simulationFrame += 1;
    pikachu.applyInput(input); target.applyInput(targetInput);
    pikachu.tickPikachuSpecialEntities(grounded ? [{ vertices: floor.vertices }] : [], defenses);
    physics();
  };
  const frames = (n: number, input = neutral) => { for (let i = 0; i < n; i++) step(input); };
  if (grounded) frames(8);
  return { engine, scene, pikachu, target, hits, defenses, step, frames, physics, floor,
    sensors: () => Composite.allBodies(engine.world).filter((body: any) => body.label === HITBOX_LABEL) };
}

describe('Pikachu attached ledge and directional dodge physics', () => {
  it.each([1, -1] as const)('keeps the drawn ledge hand attached through catch/hang and restores floor collision on climb facing%s', facing => {
    const f = fixture(true);
    const corner = { platformId: 'physics-ledge', x: facing === 1 ? f.floor.bounds.min.x : f.floor.bounds.max.x,
      y: f.floor.bounds.min.y, side: facing === 1 ? 'left' as const : 'right' as const };
    f.pikachu.resetForRound(corner.x - 15 * facing, corner.y + 10); f.pikachu.setFacing(facing);
    f.pikachu.setLedgeCandidates([corner]); Body.setVelocity(f.pikachu.body, { x: 0, y: 1 });
    f.step(); expect(f.pikachu.getLedgeHangState().name).toBe('hanging');
    for (let n = 0; n < 145; n++) {
      const target = f.pikachu.getPikachuLedgeAttachmentState()!;
      expect(target).not.toBeNull();
      expect(f.pikachu.getPosition().x + target.handX * facing).toBeCloseTo(corner.x, 7);
      expect(f.pikachu.getPosition().y + target.handY).toBeCloseTo(corner.y, 7);
      f.step();
    }
    f.step({ ...neutral, moveY: -1 });
    expect(f.pikachu.getLedgeHangState().name).toBe('climbing');
    f.frames(33);
    expect(f.pikachu.getPikachuLedgeAttachmentState()).toBeNull();
    expect(f.pikachu.getPosition().x * facing).toBeGreaterThan(corner.x * facing + 39);
    expect(f.pikachu.isGrounded()).toBe(true);
  });
  it('applies directional source gravity14 and control24 without advancing either clock from queries', () => {
    const f = fixture(); f.step({ ...neutral, dodge: true, moveX: 1 });
    for (let n = 0; n < 14; n++) {
      expect(f.pikachu.getDodgeState().active?.framesElapsed).toBe(n);
      expect(f.pikachu.getVelocity().y).toBeCloseTo(0, 8);
      f.pikachu.getDodgeState(); f.pikachu.getActiveHurtboxes(); f.step();
    }
    expect(f.pikachu.getVelocity().y).toBeCloseTo(.475, 8);
    f.step(); expect(f.pikachu.getVelocity().y).toBeCloseTo(.95, 8);
    f.frames(8);
    const prior = f.pikachu.getVelocity().x;
    f.step({ ...neutral, moveX: -1 });
    expect(f.pikachu.getDodgeState().active?.framesElapsed).toBe(24);
    expect(f.pikachu.getVelocity().x).toBeCloseTo(prior - .5, 8);
    expect(f.pikachu.getFacing()).toBe(1);
  });
  it.each([1, -1] as const)('crawls backward with native loop displacement and no facing turn facing%s', facing => {
    const f = fixture(true); f.pikachu.setFacing(facing);
    f.frames(8, { ...neutral, moveY: 1 });
    expect(f.pikachu.getCrouchPresentationState()?.phase).toBe('hold');
    const start = f.pikachu.getPosition().x;
    f.frames(22, { ...neutral, moveY: 1, moveX: -facing });
    expect(f.pikachu.getFacing()).toBe(facing);
    expect((f.pikachu.getPosition().x - start) * facing).toBeCloseTo(-9.789999961853027 * 5, 6);
    f.step({ ...neutral, jump: true }); expect(f.pikachu.getCrouchPresentationState()).toBeNull();
  });
});

describe('Pikachu contextual ground jump entry', () => {
  it.each([1, -1] as const)('samples backward input at takeoff with preserved entry facing%s', facing => {
    const f = fixture(true); f.pikachu.setFacing(facing);
    f.step({ ...neutral, jump: true });
    expect(f.pikachu.getJumpsquatRemaining()).toBe(3);
    f.step({ ...neutral, jump: true, moveX: -facing });
    f.step({ ...neutral, jump: true, moveX: -facing });
    f.step({ ...neutral, jump: true, moveX: -facing });
    expect(f.pikachu.getJumpPresentationState()).toMatchObject({ kind: 'ground', facing, moveX: -facing, framesElapsed: 0 });
    expect(f.pikachu.getFacing()).toBe(facing);
    f.step({ ...neutral, moveX: facing });
    expect(f.pikachu.getJumpPresentationState()).toMatchObject({ facing, moveX: -facing, framesElapsed: 1 });
  });
  it.each([1, -1] as const)('uses current forward input after a backward initial press facing%s', facing => {
    const f = fixture(true); f.pikachu.setFacing(facing);
    f.step({ ...neutral, jump: true, moveX: -facing });
    expect(f.pikachu.getFacing()).toBe(facing);
    for (let n = 0; n < 3; n++) f.step({ ...neutral, jump: true, moveX: facing });
    expect(f.pikachu.getJumpPresentationState()).toMatchObject({ kind: 'ground', facing, moveX: facing, framesElapsed: 0 });
  });
});

describe('Pikachu source specials through normal input and real Matter', () => {
  it.each([1, -1] as const)('Quick sphere contacts the straight path between completed active frames facing%s', facing => {
    const f = fixture(false, false, { width: 8, height: 8 });
    f.pikachu.setFacing(facing);
    f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
    f.step({ ...neutral, moveY: -1 });
    const body = f.pikachu.getPosition();
    const oldNeck = rotatePikachuSpecialPoint(pikachuSpecialContact('quickAttackFirst', 0).start,
      -facing * Math.PI / 2, facing, PIKACHU_QUICK_ROT_PIVOT);
    const nextNeck = rotatePikachuSpecialPoint(pikachuSpecialContact('quickAttackFirst', 1).start,
      -facing * Math.PI / 2, facing, PIKACHU_QUICK_ROT_PIVOT);
    const midpoint = { x: body.x + (oldNeck.x + nextNeck.x) * facing / 2,
      y: body.y - 55 / 2 + (oldNeck.y + nextNeck.y) / 2 };
    // Actual receiver is away from both endpoint spheres. Its own ordinary
    // gravity dose is compensated only in this placement fixture.
    f.target.setPosition(midpoint.x, midpoint.y - 0.475);
    f.step({ ...neutral, moveY: -1 });
    expect(f.hits.map(h => h.damage)).toEqual([2]);
    f.frames(3);
    expect(f.hits).toHaveLength(1);
  });
  it.each([1, -1] as const)('Quick diagonal interpolation rejects a receiver inside the broad bounds but outside the path facing%s', facing => {
    const f = fixture(false, false, { width: 8, height: 8 });
    f.pikachu.setFacing(facing);
    const diagonal = { ...neutral, moveX: facing, moveY: -1 };
    f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
    f.step(diagonal);
    const body = f.pikachu.getPosition();
    const neck = rotatePikachuSpecialPoint(pikachuSpecialContact('quickAttackFirst', 0).start,
      -facing * Math.PI / 4, facing, PIKACHU_QUICK_ROT_PIVOT);
    const halfTravel = 55 / (2 * Math.sqrt(2));
    const perpendicular = 20 / Math.sqrt(2);
    f.target.setPosition(body.x + neck.x * facing + halfTravel * facing + perpendicular,
      body.y + neck.y - halfTravel + perpendicular * facing - 0.475);
    f.step(diagonal);
    expect(f.hits).toHaveLength(0);
  });
  it.each([1, -1] as const)('Quick interpolation samples the current receiving pose without sweeping a crossing receiver facing%s', facing => {
    const f = fixture(false, false, { width: 8, height: 8 });
    f.pikachu.setFacing(facing);
    f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
    f.step({ ...neutral, moveY: -1 });
    const body = f.pikachu.getPosition();
    const neck = rotatePikachuSpecialPoint(pikachuSpecialContact('quickAttackFirst', 0).start,
      -facing * Math.PI / 2, facing, PIKACHU_QUICK_ROT_PIVOT);
    const centreX = body.x + neck.x * facing;
    f.target.setPosition(centreX - 40, body.y + neck.y - 55 / 2 - 0.475);
    f.pikachu.applyInput({ ...neutral, moveY: -1 });
    f.target.applyInput(neutral);
    // This actual external velocity crosses the attack path but finishes
    // outside it. Published receiving geometry does not sweep that motion.
    Body.setVelocity(f.target.body, { x: 80, y: 0 });
    f.physics();
    expect(f.target.getPosition().x).toBeCloseTo(centreX + 40, 6);
    expect(f.hits).toHaveLength(0);
  });
  it.each([1, -1] as const)('Quick body-attached contact hits current Neck and rejects the stale prephysics Neck facing%s', facing => {
    for (const current of [true, false]) {
      // A small actual receiver separates the two positions unambiguously;
      // default Donkey Kong's much taller body can cover both55px-spaced points.
      const f = fixture(false, false, { width: 8, height: 8 }); f.pikachu.setFacing(facing);
      f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
      const p = f.pikachu.getPosition();
      const neck = rotatePikachuSpecialPoint(pikachuSpecialContact('quickAttackFirst', 0).start,
        -facing * Math.PI / 2, facing, PIKACHU_QUICK_ROT_PIVOT);
      // The defender receives its normal .475 physics dose on this input.
      // Isolate current vs stale attachment with the full55px warp step.
      f.target.setPosition(p.x + neck.x * facing, p.y + neck.y - (current ? 55 : 0) - 0.475);
      f.step({ ...neutral, moveY: -1 });
      expect(f.hits.map(h => h.damage)).toEqual(current ? [2] : []);
      const sensor = f.sensors()[0];
      const root = f.pikachu.getPosition();
      expect(sensor.plugin.ownerAnchoredContact).toBe(true);
      expect(sensor.position.x).toBeCloseTo(root.x + neck.x * facing, 6);
      expect(sensor.position.y).toBeCloseTo(root.y + neck.y, 6);
      f.frames(3);
      expect(f.hits.map(h => h.damage)).toEqual(current ? [2] : []);
    }
  });
  it.each([1, -1] as const)('near-vertical Quick facing uses native speed threshold rather than normalized stick threshold facing%s', desiredFacing => {
    for (const [stickX, expectedFacing] of [[0.00009, -desiredFacing], [0.00011, desiredFacing]] as const) {
      const f = fixture(); f.pikachu.setFacing(desiredFacing === 1 ? -1 : 1);
      f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
      f.step({ ...neutral, moveX: stickX * desiredFacing, moveY: -1 });
      expect(f.pikachu.getFacing()).toBe(expectedFacing);
      expect(f.pikachu.getActiveAttack()?.facing).toBe(expectedFacing);
      expect(f.pikachu.getPikachuSpecialState()?.frame).toBe(14);
      expect(Math.abs(f.pikachu.body.velocity.x) >= 0.005).toBe(stickX === 0.00011);
    }
  });
  it.each([1, -1] as const)('ground upward Quick entry uses native forced AIR before physical floor contact clears facing%s', facing => {
    const f = fixture(true); f.pikachu.setFacing(facing);
    f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
    expect(f.pikachu.isGrounded()).toBe(true);
    f.step({ ...neutral, moveY: -1 });
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ frame: 14 });
    expect(f.pikachu.getPikachuSpecialState()!.bodyRotation).toBeCloseTo(-facing * Math.PI / 2, 6);
    expect(f.pikachu.body.velocity.y).toBe(-55);
    expect(f.pikachu.isGrounded()).toBe(false);
  });
  it.each([1, -1] as const)('Quick native directional rotation transforms actual contact and all twelve receiving capsules facing%s', entryFacing => {
    for (const direction of [{ x: entryFacing, y: 0 }, { x: 0, y: -1 },
      { x: entryFacing, y: -1 }, { x: entryFacing, y: 1 }]) {
      const f = fixture(); f.pikachu.setFacing(entryFacing);
      f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
      f.step({ ...neutral, moveX: direction.x, moveY: direction.y });
      const state = f.pikachu.getPikachuSpecialState()!;
      expect(state.frame).toBe(14);
      const facing = f.pikachu.getFacing();
      // Independently retain native atan(abs(SUMx), nativeSUMy)-90 and
      // project the native X-axis basis about its guarded Rot translation.
      const nativeRotation = Math.atan2(Math.abs(state.velocity.x), -state.velocity.y) - Math.PI / 2;
      expect(state.bodyRotation).toBeCloseTo(nativeRotation * facing, 6);
      const project = (p: { x: number; y: number }) => {
        const x = p.x - PIKACHU_QUICK_ROT_PIVOT.x, y = p.y - PIKACHU_QUICK_ROT_PIVOT.y;
        return { x: PIKACHU_QUICK_ROT_PIVOT.x + Math.cos(nativeRotation) * x - Math.sin(nativeRotation) * y,
          y: PIKACHU_QUICK_ROT_PIVOT.y + Math.sin(nativeRotation) * x + Math.cos(nativeRotation) * y };
      };
      const contact = f.sensors()[0].plugin.collisionHits[0].capsule;
      const sourceContact = pikachuSpecialContact('quickAttackFirst', 0);
      for (const end of ['start', 'end'] as const) {
        expect(contact[end].x).toBeCloseTo(project(sourceContact[end]).x, 6);
        expect(contact[end].y).toBeCloseTo(project(sourceContact[end]).y, 6);
      }
      const source = selectPikachuSpecialPhaseHurtboxes('up_special', 0)!;
      const actual = f.pikachu.getActiveHurtboxes();
      expect(actual).toHaveLength(12);
      for (let i = 0; i < source.length; i++) for (const end of ['start', 'end'] as const) {
        const expected = project(source[i]!.capsule![end]);
        expect(actual[i]!.capsule![end].x).toBeCloseTo(expected.x, 6);
        expect(actual[i]!.capsule![end].y).toBeCloseTo(expected.y, 6);
        expect(actual[i]!.capsule!.radius).toBe(source[i]!.capsule!.radius);
      }
      f.frames(5);
      expect(f.pikachu.getPikachuSpecialState()!.bodyRotation).toBe(0);
    }
  });
  it.each([1, -1] as const)('Skull air entry consumes actual STOP factor and gravity reset facing%s', facing => {
    const f = fixture();
    f.pikachu.setFacing(facing);
    Body.setVelocity(f.pikachu.body, { x: facing * 3, y: 5 });
    expect(f.pikachu.attemptAttack(createPikachuSpecialMoves().sideSpecial.id)).toBe(true);
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ frame: 0, velocity: { y: 0 }, gravity: 0.2 });
    expect(f.pikachu.getPikachuSpecialState()?.velocity.x).toBeCloseTo(facing * 2.4, 6);
    expect(f.pikachu.body.velocity.x).toBeCloseTo(facing * 2.4, 6);
    expect(f.pikachu.body.velocity.y).toBe(0);
    f.physics();
    expect(f.pikachu.getPosition().x).toBeCloseTo(facing * 2.4, 6);
    expect(f.pikachu.body.velocity.y).toBeCloseTo(0.2, 6);
    expect(f.pikachu.getPikachuSpecialState()?.velocity.y).toBeCloseTo(0.2, 6);
    for (let frame = 1; frame <= 20; frame++) {
      f.step({ ...neutral, special: true });
      expect(f.pikachu.body.velocity.y).toBeCloseTo((frame + 1) * 0.2, 6);
    }
  });
  it.each([1, -1] as const)('Skull opposite inherited STOP motion is signed through startup then disabled by hold facing%s', facing => {
    const f = fixture();
    f.pikachu.setFacing(facing);
    Body.setVelocity(f.pikachu.body, { x: -facing * 3, y: 0 });
    expect(f.pikachu.attemptAttack(createPikachuSpecialMoves().sideSpecial.id)).toBe(true);
    expect(f.pikachu.body.velocity.x).toBeCloseTo(-facing * 2.4, 6);
    for (let frame = 1; frame <= 12; frame++) {
      f.step({ ...neutral, special: true });
      expect(f.pikachu.body.velocity.x).toBeCloseTo(-facing * (2.4 + frame * 0.1), 6);
    }
    f.step({ ...neutral, special: true });
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ frame: 13, holding: true });
    expect(f.pikachu.body.velocity.x).toBe(0);
    const heldX = f.pikachu.getPosition().x;
    for (let frame = 14; frame <= 30; frame++) {
      f.step({ ...neutral, special: true });
      expect(f.pikachu.body.velocity.x).toBe(0);
      expect(f.pikachu.getPosition().x).toBe(heldX);
    }
  });
  it.each([1, -1] as const)('Skull hold disables signed STOP acceleration after crossing its entry facing%s', facing => {
    const f = fixture();
    f.pikachu.setFacing(facing);
    Body.setVelocity(f.pikachu.body, { x: facing * 1.7, y: 0 });
    expect(f.pikachu.attemptAttack(createPikachuSpecialMoves().sideSpecial.id)).toBe(true);
    for (let frame = 1; frame <= 14; frame++) {
      f.step({ ...neutral, special: true });
      expect(f.pikachu.body.velocity.x).toBeCloseTo(facing * (1.36 - frame * 0.1), 6);
    }
    expect(f.pikachu.body.velocity.x * facing).toBeLessThan(0);
    f.step({ ...neutral, special: true });
    expect(f.pikachu.body.velocity.x).toBe(0);
    f.frames(8, { ...neutral, special: true });
    expect(f.pikachu.body.velocity.x).toBe(0);
  });
  it.each([1, -1] as const)('Skull grounded entry clears inherited motion and keeps gravity disabled facing%s', facing => {
    const f = fixture(true);
    f.pikachu.setFacing(facing);
    Body.setVelocity(f.pikachu.body, { x: facing * 3, y: 5 });
    expect(f.pikachu.attemptAttack(createPikachuSpecialMoves().sideSpecial.id)).toBe(true);
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ velocity: { x: 0, y: 0 }, gravity: 0 });
    expect(f.pikachu.body.velocity).toMatchObject({ x: 0, y: 0 });
    const start = f.pikachu.getPosition().x;
    for (let n = 0; n < 25; n++) f.step({ ...neutral, special: true });
    expect(f.pikachu.getPosition().x).toBeCloseTo(start, 6);
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ holding: true, gravity: 0 });
  });
  it.each([1, -1] as const)('Thunder air STOP entry factor survives actual first physics observation facing%s', facing => {
    const f = fixture();
    f.pikachu.setFacing(facing);
    Body.setVelocity(f.pikachu.body, { x: facing * 3, y: -2 });
    expect(f.pikachu.attemptAttack(createPikachuSpecialMoves().downSpecial.id)).toBe(true);
    expect(f.pikachu.body.velocity.x).toBeCloseTo(facing * 2.55, 6);
    expect(f.pikachu.body.velocity.y).toBe(-2);
    f.physics();
    expect(f.pikachu.getPosition().x).toBeCloseTo(facing * 2.55, 6);
    expect(f.pikachu.getPikachuSpecialState()?.velocity.x).toBeCloseTo(facing * 2.55, 6);
    expect(f.pikachu.getPikachuSpecialState()?.gravity).toBeNull();
  });
  it.each([1, -1] as const)('Skull explicit release gravity limit survives integration without leaking into END facing%s', facing => {
    const f = fixture(); f.pikachu.setFacing(facing);
    f.step({ ...neutral, moveX: facing, special: true }); f.frames(13);
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ normalizedFrame: 13, gravity: 0.05 });
    Body.setVelocity(f.pikachu.body, { x: facing * 8, y: 5.49 });
    f.pikachu.applyPostPhysicsVelocityConstraints();
    for (let frame = 14; frame <= 51; frame++) {
      f.step();
      expect(f.pikachu.body.velocity.y).toBeCloseTo(5.5, 6);
      expect(f.pikachu.getPikachuSpecialState()?.velocity.y).toBeCloseTo(5.5, 6);
    }
    f.step();
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ normalizedFrame: 52, gravity: 0.375 });
    expect(f.pikachu.body.velocity.y).toBeCloseTo(5.875, 6);
  });
  it.each([1, -1] as const)('air Jolt retains ordinary FALL gravity and terminal cap facing%s', facing => {
    const f = fixture();
    f.pikachu.setFacing(facing);
    Body.setVelocity(f.pikachu.body, { x: 0, y: 5 });
    f.step({ ...neutral, special: true });
    expect(f.pikachu.body.velocity.y).toBeCloseTo(5.475, 6);
    for (let frame = 1; frame <= 50; frame++) {
      f.step();
      expect(f.pikachu.getPikachuSpecialState()?.frame).toBe(frame);
      expect(f.pikachu.body.velocity.y).toBeCloseTo(Math.min(5 + (frame + 1) * 0.475, 7.75), 6);
      expect(f.pikachu.getPikachuSpecialState()?.velocity.y).toBeCloseTo(f.pikachu.body.velocity.y, 6);
    }
    f.step();
    expect(f.pikachu.getPikachuSpecialState()).toBeNull();
    expect(f.pikachu.body.velocity.y).toBeCloseTo(7.75, 6);
  });
  it.each([-5, 14])('Jolt ordinary handoff preserves rising or externally excessive entry speed%s', entrySpeed => {
    const f = fixture();
    const ordinary = fixture();
    Body.setVelocity(f.pikachu.body, { x: 0, y: entrySpeed });
    Body.setVelocity(ordinary.pikachu.body, { x: 0, y: entrySpeed });
    f.step({ ...neutral, special: true });
    ordinary.step();
    for (let frame = 0; frame < 51; frame++) {
      expect(f.pikachu.body.velocity.y).toBeCloseTo(ordinary.pikachu.body.velocity.y, 6);
      expect(f.pikachu.getPosition().y).toBeCloseTo(ordinary.pikachu.getPosition().y, 6);
      f.step(); ordinary.step();
    }
  });
  it('Jolt lands on a real floor without replacing its action clock with ordinary landing recovery', () => {
    const f = fixture();
    Composite.add(f.engine.world, f.floor);
    f.pikachu.setPosition(0, -100);
    Body.setVelocity(f.pikachu.body, { x: 0, y: 5 });
    f.step({ ...neutral, special: true });
    let landingFrame: number | null = null;
    for (let frame = 1; frame <= 50; frame++) {
      f.step();
      expect(f.pikachu.getPikachuSpecialState()?.frame).toBe(frame);
      if (f.pikachu.isGrounded()) {
        landingFrame ??= frame;
        expect(resolvePikachuSpecialBodyClock(f.pikachu.getPikachuSpecialState()!).sheet).toBe('neutral_special');
      }
    }
    expect(landingFrame).not.toBeNull();
    f.step();
    expect(f.pikachu.getPikachuSpecialState()).toBeNull();
  });
  it('actual source down-tilt capsules clank before body damage and lock rebound after hitlag', () => {
    const f = fixture(true, true);
    const move = buildPikachuVerticalTiltWithAuthoredHurtboxes('down-tilt');
    registerFighterAttack(f.pikachu, move); registerFighterAttack(f.target, move);
    f.target.setPosition(75, f.target.getPosition().y); f.target.setFacing(-1); f.frames(4);
    f.step({ ...neutral, attack: true, moveY: 1 }, { ...neutral, attack: true, moveY: 1 });
    for (let n = 0; n < 12 && !f.pikachu.getAttackClankPresentationState(); n++) f.step();
    expect(f.pikachu.getAttackClankPresentationState()).toMatchObject({ totalFrames: 18, phase: 'freeze' });
    expect(f.target.getAttackClankPresentationState()).toMatchObject({ totalFrames: 18, phase: 'freeze' });
    expect(f.hits).toHaveLength(0);
    expect(f.sensors()).toHaveLength(0);
    expect(f.pikachu.getActiveHurtboxes()).toHaveLength(12);
    expect(f.pikachu.getAttackClankPresentationState()?.interruptedAttack).toMatchObject({
      move: { id: move.id }, framesElapsed: 6 });
    const receiving = f.pikachu.getActiveHurtboxes();
    const x = f.pikachu.getPosition().x;
    while (f.pikachu.getHitlagRemaining() > 0 || f.target.getHitlagRemaining() > 0) f.step();
    expect(f.pikachu.getActiveHurtboxes()).toEqual(receiving);
    for (let n = 0; n < 18; n++) {
      f.step({ ...neutral, moveX: 1, jump: true, special: true, shield: true });
      expect(f.pikachu.canAttack()).toBe(false);
      expect(f.pikachu.canUseItemsBeforeInput()).toBe(false);
      expect(f.pikachu.getPosition().x).toBeCloseTo(x, 6);
      expect(f.pikachu.getActiveAttack()).toBeNull();
    }
    f.step();
    expect(f.pikachu.getAttackClankPresentationState()).toBeNull();
    expect(f.pikachu.canAttack()).toBe(true);
  });
  it.each([0.369999, 0.37])('source down-tilt trip bonus uses actual contact and queues after hitlag (roll%s)', roll => {
    const f = fixture(true);
    registerFighterAttack(f.pikachu, buildPikachuVerticalTiltWithAuthoredHurtboxes('down-tilt'));
    f.target.setPosition(55, f.target.getPosition().y);
    f.frames(4);
    let draws = 0;
    f.target.setTripRandomSource(() => { draws++; return roll; });
    f.step({ ...neutral, attack: true, moveY: 1 });
    for (let n = 0; n < 12 && f.target.getDamagePercent() === 0; n++) f.step();
    expect(f.target.getDamagePercent()).toBe(6);
    expect(draws).toBe(1);
    expect(f.target.getHitlagRemaining()).toBeGreaterThan(0);
    expect(f.target.isTripped()).toBe(false);
    const frozen = f.target.getPosition();
    while (f.target.getHitlagRemaining() > 0) f.step();
    expect(f.target.isTripped()).toBe(roll < 0.37);
    if (roll < 0.37) {
      expect(f.target.getPosition().x).toBeCloseTo(frozen.x, 6);
      expect(f.target.getHitstunRemaining()).toBe(0);
      expect(f.target.getVelocity().x).toBe(0);
      const before = draws;
      f.target.applyHitDetailed({ damage: 6, tripChance: 0.3,
        knockback: { x: 1, y: 0, scaling: 0, reference: { angle: 361, base: 12, growth: 100 } }, facing: 1 });
      expect(draws).toBe(before);
    } else expect(f.target.getVelocity().x).toBeGreaterThan(0);
  });
  it('actual source jab shield contact exposes block outcome through the shared sensor handler', () => {
    const f = fixture(true);
    registerFighterAttack(f.pikachu, buildPikachuJabWithAuthoredHurtboxes());
    f.target.setPosition(55, f.target.getPosition().y);
    f.frames(4); // Regain physical support before a fresh shield press.
    const shield = { ...neutral, shield: true };
    for (let n = 0; n < 4; n++) f.step(neutral, shield);
    expect(f.target.getShieldPresentationState()?.kind).toBe('hold');
    f.step({ ...neutral, attack: true }, shield);
    for (let n = 0; n < 8 && f.hits.length === 0; n++) f.step(neutral, shield);
    expect(f.hits).toHaveLength(1);
    expect(f.target.getDamagePercent()).toBe(0);
    expect(f.target.getShieldPresentationState()).toMatchObject({ kind: 'block', framesElapsed: 0,
      phase: 'hitlag' });
    const receiving = f.target.getShieldPresentationState();
    while (f.target.getHitlagRemaining() > 0) {
      f.step(neutral, shield);
      expect(f.target.getShieldPresentationState()?.framesElapsed).toBe(receiving?.framesElapsed);
    }
  });
  it('actual source jab contact records successful parry rather than release eligibility', () => {
    const f = fixture(true);
    registerFighterAttack(f.pikachu, buildPikachuJabWithAuthoredHurtboxes());
    f.target.setPosition(55, f.target.getPosition().y); f.frames(4);
    for (let n = 0; n < 3; n++) f.step(neutral, { ...neutral, shield: true });
    f.step({ ...neutral, attack: true });
    expect(f.target.getShieldPresentationState()?.kind).toBe('release');
    for (let n = 0; n < 8 && f.hits.length === 0; n++) f.step();
    expect(f.hits).toHaveLength(1);
    expect(f.target.getDamagePercent()).toBe(0);
    expect(f.target.getShieldPresentationState()).toMatchObject({ kind: 'parry', framesElapsed: 0, phase: 'hitlag' });
  });
  it('captures direct clank receiving at interruption without an earlier attack tick', () => {
    const f = fixture(true);
    registerFighterAttack(f.pikachu, buildPikachuVerticalTiltWithAuthoredHurtboxes('down-tilt'));
    f.step({ ...neutral, moveY: 1, attack: true });
    expect(f.pikachu.getActiveAttack()?.framesElapsed).toBe(0);
    const before = f.pikachu.getActiveHurtboxes();
    expect(before).toHaveLength(12);
    f.pikachu.applyAttackClank(3, 18);
    expect(f.pikachu.getActiveAttack()).toBeNull();
    expect(f.pikachu.getActiveHurtboxes()).toEqual(before);
    f.frames(3);
    expect(f.pikachu.getActiveHurtboxes()).toEqual(before);
  });
  it('crouch hold has its own frozen fixed-step age and resets on true reentry', () => {
    const f = fixture(true);
    const crouch = { ...neutral, moveY: 1 };
    f.step(crouch);
    expect(f.pikachu.getCrouchPresentationState()).toMatchObject({ phase: 'start', framesElapsed: 0 });
    f.frames(7, crouch);
    expect(f.pikachu.getCrouchPresentationState()).toMatchObject({ phase: 'hold', framesElapsed: 0 });
    f.frames(15, crouch);
    const hold = f.pikachu.getCrouchPresentationState();
    expect(hold?.framesElapsed).toBe(15);
    for (let n = 0; n < 20; n++) {
      f.pikachu.applyPhysicsSubstepConstraints();
      expect(f.pikachu.getCrouchPresentationState()).toEqual(hold);
    }
    f.pikachu.armAttackerHitlag(4); f.frames(4, crouch);
    expect(f.pikachu.getCrouchPresentationState()).toEqual(hold);
    registerFighterAttack(f.pikachu, buildPikachuVerticalTiltWithAuthoredHurtboxes('down-tilt'));
    f.step({ ...crouch, attack: true });
    expect(f.pikachu.getCrouchPresentationState()).toBeNull();
    let n = 0;
    while (!f.pikachu.getCrouchPresentationState() && n++ < 100) f.step(crouch);
    expect(n).toBeLessThan(100);
    expect(f.pikachu.getCrouchPresentationState()?.framesElapsed).toBe(0);
    f.pikachu.applyGrabbed(f.target); f.step(crouch);
    expect(f.pikachu.getCrouchPresentationState()).toBeNull();
    f.pikachu.releaseFromGrab();
    f.pikachu.setPosition(0, 0); f.frames(8, crouch);
    expect(f.pikachu.getCrouchPresentationState()!.framesElapsed).toBeLessThan(8);
  });
  // SmashWiki Lucario (SSBU)/Floor getups (trip): a hard trip lies 99 frames, neutral getup on the 100th.
  it('observed trip age freezes through hitlag, lies 99 unfrozen steps, then enters the completed30-step grounded getup', () => {
    const f = fixture(true);
    f.pikachu.applyTrip();
    expect(f.pikachu.getReactionPresentationState()).toMatchObject({ kind: 'trip', origin: 'trip', framesElapsed: 0 });
    f.frames(3);
    expect(f.pikachu.getReactionPresentationState()?.framesElapsed).toBe(3);
    f.pikachu.armAttackerHitlag(4); f.frames(4);
    expect(f.pikachu.getReactionPresentationState()?.framesElapsed).toBe(3);
    const observed = f.pikachu.getReactionPresentationState();
    for (let n = 0; n < 12; n++) {
      f.pikachu.applyPhysicsSubstepConstraints();
      expect(f.pikachu.getReactionPresentationState()).toEqual(observed);
    }
    f.frames(TRIP_KNOCKDOWN_FRAMES - 4);
    expect(f.pikachu.isTripped()).toBe(true);
    f.step();
    expect(f.pikachu.getReactionPresentationState()).toBeNull();
    expect(f.pikachu.getPikachuGroundRecoveryPresentationState()).toMatchObject({ sheet: 'getup', duration: 30, framesElapsed: 0 });
    expect(f.pikachu.canAttack()).toBe(false);
    f.frames(29);
    expect(f.pikachu.getPikachuGroundRecoveryPresentationState()).toMatchObject({ framesElapsed: 29 });
    expect(f.pikachu.canAttack()).toBe(false);
    f.step();
    expect(f.pikachu.getPikachuGroundRecoveryPresentationState()).toBeNull();
    expect(f.pikachu.canAttack()).toBe(true);
  });
  it('completed getup roll retains entry facing and36-step source clock while trip attack uses its real clock', () => {
    const f = fixture(true);
    f.pikachu.setFacing(-1); f.pikachu.applyTrip(); f.frames(TRIP_OPTION_LOCK_FRAMES - 1); f.step({ ...neutral, moveX: 1 });
    expect(f.pikachu.getFacing()).toBe(-1);
    expect(f.pikachu.getReactionPresentationState()).toBeNull();
    expect(f.pikachu.getPikachuGroundRecoveryPresentationState()).toMatchObject({ sheet: 'getup_roll_back',
      facing: -1, duration: 36, framesElapsed: 0 });
    f.frames(3);
    expect(f.pikachu.getPikachuGroundRecoveryPresentationState()?.framesElapsed).toBe(3);
    const source = fixture(true);
    registerFighterAttack(source.pikachu, PIKACHU_TRIP_ATTACK);
    source.pikachu.applyTrip(); source.frames(TRIP_OPTION_LOCK_FRAMES - 1); source.step({ ...neutral, attack: true });
    expect(source.pikachu.getReactionPresentationState()).toMatchObject({ kind: 'getup-attack', origin: 'trip',
      moveId: 'pikachu.tripAttack', framesElapsed: 0 });
    source.step();
    expect(source.pikachu.getReactionPresentationState()?.framesElapsed).toBe(source.pikachu.getActiveAttack()?.framesElapsed);
  });
  it('damage body age freezes through hitlag, resets on rehit, and excludes capture', () => {
    const f = fixture();
    const hit = { damage: 6, facing: 1 as const, knockback: { x: 2, y: -2, scaling: 0 } };
    f.pikachu.applyHit(hit);
    expect(f.pikachu.getReactionPresentationState()).toMatchObject({ kind: 'damage', phase: 'hitlag', framesElapsed: 0 });
    while (f.pikachu.getHitlagRemaining() > 0) {
      f.step(); expect(f.pikachu.getReactionPresentationState()?.framesElapsed).toBe(0);
    }
    f.frames(3);
    expect(f.pikachu.getReactionPresentationState()?.framesElapsed).toBe(3);
    f.pikachu.applyHit(hit);
    expect(f.pikachu.getReactionPresentationState()?.framesElapsed).toBe(0);
    f.pikachu.applyGrabbed(f.target); f.step();
    expect(f.pikachu.getReactionPresentationState()).toBeNull();
    f.pikachu.setPosition(0, 0);
    expect(f.pikachu.getReactionPresentationState()).toBeNull();
  });
  it('ordinary body age freezes in hitlag and pause, and queries/substeps do not advance it', () => {
    const f = fixture(true);
    const initial = f.pikachu.getOrdinaryPresentationState()!;
    expect(initial.sheet).toBe('idle');
    f.frames(3);
    const advanced = f.pikachu.getOrdinaryPresentationState()!;
    expect(advanced.framesElapsed).toBe(initial.framesElapsed + 3);
    // A paused driver does not call applyInput. Reads and collision-only
    // substeps are insufficient to consume any fixed body-clock step.
    for (let n = 0; n < 20; n++) {
      f.pikachu.applyPhysicsSubstepConstraints();
      expect(f.pikachu.getOrdinaryPresentationState()).toEqual(advanced);
    }
    f.pikachu.armAttackerHitlag(5);
    f.frames(5);
    expect(f.pikachu.getOrdinaryPresentationState()).toEqual(advanced);
    f.step();
    expect(f.pikachu.getOrdinaryPresentationState()!.framesElapsed).toBe(advanced.framesElapsed + 1);
  });
  it('ordinary idle genuinely reenters at zero after a sourced jab without changing locomotion', () => {
    const f = fixture(true);
    registerFighterAttack(f.pikachu, buildPikachuJabWithAuthoredHurtboxes());
    f.frames(30);
    expect(f.pikachu.getOrdinaryPresentationState()!.framesElapsed).toBeGreaterThan(25);
    f.step({ ...neutral, attack: true });
    expect(f.pikachu.getActiveAttack()?.move.id).toBe('pikachu.jab');
    expect(f.pikachu.getOrdinaryPresentationState()).toBeNull();
    let busySteps = 0;
    while (!f.pikachu.getOrdinaryPresentationState() && busySteps++ < 100) f.step();
    expect(busySteps).toBeLessThan(100);
    expect(f.pikachu.getLocomotionState().name).toBe('standing');
    expect(f.pikachu.getOrdinaryPresentationState()).toMatchObject({ sheet: 'idle', framesElapsed: 0 });
    f.step();
    expect(f.pikachu.getOrdinaryPresentationState()).toMatchObject({ sheet: 'idle', framesElapsed: 1 });
    f.step({ ...neutral, shield: true });
    expect(f.pikachu.getOrdinaryPresentationState()).toBeNull();
  });
  it('ordinary falling age advances once per simulation step and yields to a real jump', () => {
    const f = fixture();
    f.frames(10);
    const state = f.pikachu.getOrdinaryPresentationState()!;
    expect(state.sheet).toBe('fall');
    f.frames(3);
    expect(f.pikachu.getOrdinaryPresentationState()!.framesElapsed).toBe(state.framesElapsed + 3);
    f.step({ ...neutral, jump: true });
    expect(f.pikachu.getVelocity().y).toBeLessThan(0);
    expect(f.pikachu.getOrdinaryPresentationState()).toBeNull();
    // Hit-stop pins public velocity to zero; that must not synthesize fall
    // while the saved, rising jump velocity still owns the motion.
    f.pikachu.armAttackerHitlag(3);
    for (let n = 0; n < 3; n++) {
      f.step();
      expect(f.pikachu.getOrdinaryPresentationState()).toBeNull();
    }
    f.pikachu.setPosition(0, -500);
    expect(f.pikachu.getOrdinaryPresentationState()).toMatchObject({ sheet: 'fall', framesElapsed: 0 });
  });
  it.each([1, -1] as const)('Quick Attack restores falling after replacing a recovered launch facing%s', facing => {
    const f = fixture();
    f.target.setPosition(100000, 0);
    f.pikachu.setFacing(facing);
    f.pikachu.setDamagePercent(80);
    f.pikachu.applyHit({ damage: PIKACHU_UP_SPECIAL.damage, knockback: PIKACHU_UP_SPECIAL.knockback, facing });
    for (let frame = 0; frame < 300 && (f.pikachu.isInHitlag() || f.pikachu.isInHitstun()); frame++) f.step();
    expect(f.pikachu.isInHitlag()).toBe(false);
    expect(f.pikachu.isInHitstun()).toBe(false);
    // Let the old launch's natural gravity reach its fall-speed limit. The
    // recovery must install its own kinetics even after that energy is capped.
    f.frames(30);
    f.step({ ...neutral, special: true, moveY: -1 });
    expect(f.pikachu.getPikachuSpecialState()?.kind).toBe('quickAttack');
    for (let frame = 1; frame <= 83; frame++) {
      f.step(frame < 20 ? { ...neutral, moveY: -1 } : { ...neutral, moveX: facing });
      if (frame === 41) {
        expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ second: true, gravity: 0.475 });
        expect(f.pikachu.getVelocity().y).toBeCloseTo(0.475, 6);
      }
    }
    expect(f.pikachu.getPikachuSpecialState()).toBeNull();
    expect(f.pikachu.isHelpless()).toBe(true);
    const ended = f.pikachu.getPosition();
    const ordinary = fixture();
    ordinary.target.setPosition(100000, 0);
    ordinary.pikachu.setPosition(ended.x, ended.y);
    Body.setVelocity(ordinary.pikachu.body, f.pikachu.getVelocity());
    for (let frame = 0; frame < 30; frame++) {
      f.step({ ...neutral, moveX: facing });
      ordinary.step({ ...neutral, moveX: facing });
      expect(f.pikachu.getPosition().y).toBeCloseTo(ordinary.pikachu.getPosition().y, 6);
    }
    expect(f.pikachu.getVelocity().y).toBeCloseTo(7.75, 6);
    expect(f.pikachu.getPosition().y - ended.y).toBeGreaterThan(30 * 7.75);
  });
  it('Quick Attack waits14 startup steps and travels exactly five11-unit steps without gravity', () => {
    const f = fixture(); f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
    expect(f.pikachu.getPikachuSpecialState()?.frame).toBe(13);
    expect(f.sensors()).toHaveLength(0);
    const start = f.pikachu.getPosition();
    for (let i = 0; i < 5; i++) {
      f.step({ ...neutral, moveY: -1 });
      expect(f.pikachu.getVelocity().y).toBeCloseTo(-55, 8);
      expect(f.sensors()).toHaveLength(1);
      expect(f.sensors()[0].plugin.damage).toBe(2);
      expect(f.sensors()[0].plugin.collisionHits[0]).toMatchObject({nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:false});
    }
    expect(start.y - f.pikachu.getPosition().y).toBeCloseTo(275, 7);
    f.step(); expect(f.sensors()).toHaveLength(0);
  });
  it.each([1, -1] as const)('Quick startup disables inherited energies then consumes its tiny upward native acceleration facing%s', facing => {
    const f = fixture(); f.pikachu.setFacing(facing);
    Body.setVelocity(f.pikachu.body, { x: 3 * facing, y: 5 });
    f.step({ ...neutral, special: true, moveY: -1 });
    const entry = f.pikachu.getPosition();
    expect(entry).toEqual({ x: 0, y: 0 });
    expect(f.pikachu.getVelocity()).toEqual({ x: 0, y: 0 });
    for (let frame = 1; frame < 14; frame++) {
      f.step({ ...neutral, moveX: facing });
      expect(f.pikachu.getPosition().x).toBeCloseTo(entry.x, 6);
      expect(f.pikachu.getVelocity().y).toBeCloseTo(frame < 10 ? 0 : -(frame - 9) * 0.002666667 * 5, 6);
      expect(f.sensors()).toHaveLength(0);
    }
    f.step({ ...neutral, moveY: -1 });
    expect(f.pikachu.getVelocity().y).toBeCloseTo(-55, 6);
    expect(f.sensors()).toHaveLength(1);
  });
  it('grounded Quick startup keeps gravity disabled rather than applying the aerial tiny rise', () => {
    const f = fixture(true);
    f.step({ ...neutral, special: true, moveY: -1 });
    for (let frame = 1; frame < 14; frame++) {
      f.step();
      expect(f.pikachu.isGrounded()).toBe(true);
      expect(f.pikachu.getPikachuSpecialState()?.gravity).toBe(0);
      expect(f.pikachu.getVelocity().y).toBeCloseTo(0, 6);
    }
    f.step({ ...neutral, moveY: -1 });
    expect(f.pikachu.getVelocity().y).toBeCloseTo(-55, 6);
  });
  it.each([1, -1] as const)('air Quick ending resets horizontal dash momentum and holds zero gravity through source phase0 facing%s', facing => {
    const f = fixture(); f.pikachu.setFacing(facing);
    f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
    f.frames(5, { ...neutral, moveX: facing });
    expect(f.pikachu.getVelocity().x).toBeCloseTo(55 * facing, 6);
    f.step();
    const entry = f.pikachu.getPosition();
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ frame: 19, gravity: 0, velocity: { x: 0, y: 0 } });
    for (let local = 1; local < 8; local++) {
      f.step();
      expect(f.pikachu.getPosition()).toEqual(entry);
      expect(f.pikachu.getVelocity()).toMatchObject({ x: 0, y: 0 });
    }
    for (let local = 8; local < 50; local++) {
      f.step();
      expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ frame: 19 + local, gravity: 0.475 });
      expect(f.pikachu.getVelocity().y).toBeCloseTo(Math.min((local - 7) * 0.475, 7.75), 6);
      expect(f.pikachu.getPikachuSpecialState()?.velocity.y).toBeCloseTo(f.pikachu.getVelocity().y, 6);
      expect(f.pikachu.getPosition().x).toBeCloseTo(entry.x, 6);
    }
    f.step(); expect(f.pikachu.getPikachuSpecialState()).toBeNull();
    expect(f.pikachu.isHelpless()).toBe(true);
  });
  it.each([1, -1] as const)('Quick aerial END keeps its entered motion through physical touchdown and commits24 landing steps facing%s', facing => {
    const f = fixture(true); f.pikachu.setFacing(facing);
    f.step({ ...neutral, special: true, moveY: -1 });
    let landed = false;
    for (let i = 0; i < 100; i++) {
      f.step();
      const state = f.pikachu.getPikachuSpecialState();
      if (state && state.frame >= state.firstBurstEnd && state.quickEndGrounded === false && f.pikachu.isGrounded()) {
        const clock = resolvePikachuSpecialBodyClock(state);
        expect(clock.sheet).toBe('up_special_air_end');
        expect(clock.localFrame).toBeGreaterThanOrEqual(33);
        expect(clock.localFrame).toBeLessThan(50);
        expect(() => resolveSimulationAction(captureSimulationAnimation(f.pikachu, 0, false))).not.toThrow();
        expect(f.pikachu.getActiveHurtboxes()).toHaveLength(12);
        landed = true; break;
      }
    }
    expect(landed).toBe(true);
    f.step({ ...neutral, special: true, moveY: -1 });
    expect(f.pikachu.getPikachuSpecialState()).toBeNull();
    expect(f.pikachu.getLandingPresentationState()).toMatchObject({ kind: 'special', framesElapsed: 0, remainingFrames: 24 });
    for (let i = 1; i < 24; i++) {
      f.step({ ...neutral, special: i < 23, moveY: -1 });
      expect(f.pikachu.getPikachuSpecialState()).toBeNull();
      expect(f.pikachu.getLandingPresentationState()?.remainingFrames).toBe(24 - i);
    }
    f.step({ ...neutral, special: true, moveY: -1 });
    expect(f.pikachu.getPikachuSpecialState()?.frame).toBe(0);
  });
  it('second aerial Quick ending restores sourced gravity/control cap without retaining second dash speed', () => {
    const f = fixture();
    f.step({ ...neutral, special: true, moveY: -1 }); f.frames(26, { ...neutral, moveY: -1 });
    f.step({ ...neutral, moveX: 1 }); f.frames(5, { ...neutral, moveX: 1 });
    f.step(); expect(f.pikachu.getPikachuSpecialState()?.frame).toBe(33);
    expect(f.pikachu.getVelocity().x).toBeCloseTo(0, 6);
    for (let local = 1; local < 50; local++) {
      f.step({ ...neutral, moveX: 1 });
      const limit = local < 8 ? 4.785 : 2.871;
      expect(f.pikachu.getVelocity().x).toBeLessThanOrEqual(limit + 1e-6);
      expect(f.pikachu.getVelocity().y).toBeCloseTo(local < 8 ? 0 : Math.min((local - 7) * 0.475, 7.75), 6);
    }
    f.step(); expect(f.pikachu.getPikachuSpecialState()).toBeNull();
  });
  it('the second burst re-reads changed direction, hits independently, and cannot repeat a third time', () => {
    const f = fixture(); f.step({ ...neutral, special: true, moveY: -1 }); f.frames(26, { ...neutral, moveY: -1 });
    f.step({ ...neutral, moveX: 1 }); expect(f.pikachu.getPikachuSpecialState()?.second).toBe(true);
    f.step({ ...neutral, moveX: 1 }); expect(f.pikachu.getVelocity().x).toBeCloseTo(49.5, 8);
    expect(f.sensors()[0].plugin.damage).toBe(3);
    f.frames(5); expect(f.sensors()).toHaveLength(0);
    f.frames(60, { ...neutral, moveY: -1, special: true });
    expect(f.pikachu.isHelpless()).toBe(true);
    expect(f.pikachu.attemptUpSpecial()).toBe(false);
  });
  it('rejects the same direction once and does not accept a later changed stick', () => {
    const f = fixture(); f.step({ ...neutral, special: true, moveY: -1 }); f.frames(27, { ...neutral, moveY: -1 });
    expect(f.pikachu.getPikachuSpecialState()).toMatchObject({ decision: true, second: false });
    f.frames(7, { ...neutral, moveX: 1 }); expect(f.sensors()).toHaveLength(0);
  });
  it('requires a second direction strictly beyond35degrees and the0.5 stick gate', () => {
    for (const [angle, magnitude, expected] of [[35, 1, false], [35.1, 1, true], [90, 0.499, false], [90, 0.5, true]] as const) {
      const f = fixture(); f.step({ ...neutral, special: true, moveY: -1 }); f.frames(26, { ...neutral, moveY: -1 });
      f.step({ ...neutral, moveX: Math.sin(angle * Math.PI / 180) * magnitude,
        moveY: -Math.cos(angle * Math.PI / 180) * magnitude });
      expect(f.pikachu.getPikachuSpecialState()?.second).toBe(expected);
    }
  });
  it('a perpendicular wall contact ends the burst before its remaining travel ticks', () => {
    const f = fixture();
    const wall = Bodies.rectangle(85, 0, 40, 2000, { isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }); Composite.add(f.engine.world, wall);
    f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
    f.step({ ...neutral, moveX: 1 }); f.step({ ...neutral, moveX: 1 });
    expect(f.pikachu.getPosition().x).toBeLessThan(65);
    f.step(); expect(f.sensors()).toHaveLength(0);
    expect(f.pikachu.getActiveAttack()?.move.sheetVariant).toBe('end');
  });
  it('Quick Attack can catch a ledge behind it while rising, with startup and action cleanup respected', () => {
    const f = fixture(); f.step({ ...neutral, special: true, moveY: -1 }); f.frames(13);
    let p = f.pikachu.getPosition();
    f.pikachu.setLedgeCandidates([{ platformId: 'test', x: p.x - 15, y: p.y, side: 'left' }]);
    expect(f.pikachu.computeLedgeDetection()).toBeNull();
    f.pikachu.setLedgeCandidates([]); f.step({ ...neutral, moveY: -1 });
    p = f.pikachu.getPosition(); f.pikachu.setLedgeCandidates([{ platformId: 'test', x: p.x - 15, y: p.y, side: 'left' }]);
    expect(f.pikachu.getVelocity().y).toBe(-55);
    expect(f.pikachu.computeLedgeDetection()).not.toBeNull();
    f.step(); expect(f.pikachu.getLedgeHangState().name).toBe('hanging');
    expect(f.pikachu.getActiveAttack()).toBeNull(); expect(f.sensors()).toHaveLength(0);
  });
  it('Skull Bash charges in air and releases with the published delay, speed and damage curve', () => {
    const f = fixture(); f.step({ ...neutral, moveX: 1 }); f.step({ ...neutral, moveX: 1, special: true });
    f.frames(52, { ...neutral, moveX: 1, special: true }); // startup12 +40 charge
    expect(f.pikachu.getPikachuSpecialState()?.charge).toBe(40);
    expect(f.sensors()).toHaveLength(0);
    f.step();
    f.frames(5); f.step();
    expect(f.pikachu.getVelocity().x).toBeCloseTo(12, 8);
    expect(f.sensors()).toHaveLength(0); // movement precedes contact
    f.frames(3);
    expect(f.sensors()).toHaveLength(0);
    f.step(); expect(f.sensors()[0].plugin.damage).toBeCloseTo(13.8);
    expect(f.pikachu.getVelocity().x).toBeCloseTo(12, 8);
    expect(f.sensors()[0].plugin.knockback.reference).toMatchObject({ base: 40, growth: 78, angle: 361 });
    expect(f.sensors()[0].plugin.collisionHits[0]).toMatchObject({nativeCollisionAttribute:'collision_attr_normal',nativeForceReaction:false});
  });
  it('Skull Bash uses the captured uphill speed factor from actual inclined-stage contact', () => {
    for (const facing of [1, -1] as const) {
      const f = fixture(true); Body.setAngle(f.floor, -facing * Math.PI / 6); f.frames(20);
      f.step({ ...neutral, moveX: facing }); f.step({ ...neutral, moveX: facing, special: true });
      f.frames(13);
      // min0.4 + (max1-min0.4) * (1-sin30°) =0.7.
      expect(f.pikachu.getVelocity().x).toBeCloseTo(facing * 8 * 0.7, 5);
      expect(f.sensors()).toHaveLength(0);
      expect(f.pikachu.getPikachuSpecialState()!.bodyRotation * 180 / Math.PI).toBeCloseTo(facing * -3, 5);
      f.step(); expect(f.pikachu.getPikachuSpecialState()!.bodyRotation * 180 / Math.PI).toBeCloseTo(facing * -6, 5);
      f.step(); expect(f.pikachu.getPikachuSpecialState()!.bodyRotation * 180 / Math.PI).toBeCloseTo(facing * -6, 5);
      // Actual launch leaves this incline: native joint rotation holds while
      // the downward ground-touch flag is absent, rather than completing in air.
      f.frames(2);
      const localRotation = f.pikachu.getPikachuSpecialState()!.bodyRotation * facing;
      const point = f.sensors()[0].plugin.collisionHits[0].capsule.start;
      expect(point.x).toBeCloseTo(15 * Math.cos(localRotation) - 3.5 * Math.sin(localRotation), 5);
      expect(point.y).toBeCloseTo(0.2500009536743164 + 15 * Math.sin(localRotation) + 3.5 * Math.cos(localRotation), 5);
    }
  });
  it('Jolt starts on frame19, becomes a native curved grounded jolt and remains independent of its owner', () => {
    const f = fixture(true); f.step({ ...neutral, special: true }); f.frames(17);
    expect(f.pikachu.getPikachuSpecialVisuals()).toHaveLength(0);
    f.step(); expect(f.pikachu.getPikachuSpecialVisuals()[0]?.kind).toBe('joltGround');
    const x0 = f.pikachu.getPikachuSpecialVisuals()[0]!.x;
    f.frames(17); expect(f.pikachu.getPikachuSpecialVisuals()[0]!.x).toBeGreaterThan(x0 + 100);
    expect(f.sensors().find((sensor:any)=>sensor.plugin.pikachuEntityId!==undefined).plugin.collisionHits[0]).toMatchObject({nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:false});
    f.pikachu.armAttackerHitlag(8); const age = f.pikachu.getPikachuSpecialVisuals()[0]!.age;
    f.frames(3); expect(f.pikachu.getPikachuSpecialVisuals()[0]!.age).toBe(age + 3);
    expect(f.pikachu.getActiveAttack()?.hitboxBody).toBeNull();
  });
  it('a left-facing Jolt arcs above its surface and keeps its full detached lifetime', () => {
    const f = fixture(true); f.step({ ...neutral, moveX: -1 }); f.step({ ...neutral, special: true }); f.frames(18);
    const shot = f.pikachu.getPikachuSpecialVisuals()[0]!;
    f.frames(10); const moved = f.pikachu.getPikachuSpecialVisuals()[0]!;
    expect(moved.x).toBeLessThan(shot.x); expect(moved.y).toBeLessThan(f.floor.bounds.min.y);
    f.frames(70); expect(f.pikachu.getPikachuSpecialVisuals().some(v => v.kind === 'joltGround')).toBe(true);
    f.frames(20); expect(f.pikachu.getPikachuSpecialVisuals()).toHaveLength(0);
  });
  it('an existing reflector transfers Jolt ownership, damage and travel', () => {
    const f = fixture(true); f.step({ ...neutral, special: true }); f.frames(25);
    const shot = f.pikachu.getPikachuSpecialVisuals()[0]!;
    f.defenses.push({ ownerId: f.target.id, bodyId: f.target.body.id, hurtboxes: [],
      reflector: { x: shot.x + 8, y: shot.y, width: 12, height: 40, damageScale: 1.5, velocityScale: 1.5 } });
    f.step();
    const sensor = f.sensors().find((s:any) => s.plugin.pikachuEntityId !== undefined)!;
    expect(sensor.plugin.ownerBodyId).toBe(f.target.body.id);
    expect(sensor.plugin.damage).toBe(9);
    const reflected = f.pikachu.getPikachuSpecialVisuals()[0]!;
    expect(reflected.facing).toBe(-1);
    f.frames(7); expect(f.pikachu.getPikachuSpecialVisuals()[0]!.x).toBeLessThan(reflected.x);
  });
  it('Thunder produces a cloud, descending bolts and a conditional self-burst with correct protection cleanup', () => {
    const f = fixture(true); f.step({ ...neutral, special: true, moveY: 1 }); f.frames(1);
    expect(f.pikachu.getPikachuSpecialVisuals()[0]?.kind).toBe('cloud');
    expect(f.pikachu.getPikachuSpecialVisuals()[0]!.y).toBeCloseTo(f.pikachu.getPosition().y - 500, 1);
    f.frames(12); expect(f.pikachu.getPikachuSpecialVisuals().some(v => v.kind === 'bolt')).toBe(true);
    for (let i = 0; i < 40 && f.pikachu.getPikachuSpecialState()?.branchFrame === null; i++) f.step();
    expect(f.pikachu.getPikachuSpecialState()?.branchFrame).not.toBeNull();
    expect(f.pikachu.getActiveHurtboxes().every(h => h.intangible)).toBe(true);
    expect(f.sensors().some((s: any) => s.plugin.damage === 15)).toBe(true);
    expect(f.sensors().find((s:any)=>s.plugin.damage===15).plugin.collisionHits[0]).toMatchObject({nativeCollisionAttribute:'collision_attr_elec',nativeForceReaction:false});
    expect(f.pikachu.getDamagePercent()).toBe(0);
    f.frames(10); expect(f.pikachu.getActiveHurtboxes().some(h => h.intangible)).toBe(false);
    f.frames(40); expect(f.pikachu.getActiveAttack()).toBeNull();
  });
  it('Thunder can miss the owner, and interruption cannot create a later self-burst', () => {
    const f = fixture(true); f.step({ ...neutral, special: true, moveY: 1 }); f.frames(2);
    Body.setPosition(f.pikachu.body, { x: 250, y: f.pikachu.getPosition().y });
    f.frames(50); expect(f.pikachu.getPikachuSpecialState()?.branchFrame).toBeNull();
    f.pikachu.applyHit({ damage: 1, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 });
    f.frames(5); expect(f.pikachu.getPikachuSpecialState()).toBeNull();
    expect(f.pikachu.getActiveHurtboxes().some(h => h.intangible)).toBe(false);
    f.pikachu.setPosition(0, 0); expect(f.pikachu.getPikachuSpecialVisuals()).toHaveLength(0);
    expect(f.sensors()).toHaveLength(0);
  });
  it('the early descending bolt spikes a receiver with fixed125 knockback without freezing its summoner', () => {
    const f = fixture(true); f.step({ ...neutral, special: true, moveY: 1 }); f.frames(12);
    const cloud = f.pikachu.getPikachuSpecialVisuals().find(v => v.kind === 'cloud')!;
    Body.setPosition(f.pikachu.body, { x: 300, y: f.pikachu.getPosition().y });
    Body.setPosition(f.target.body, { x: cloud.x, y: cloud.y + 30 });
    for (let i = 0; i < 4 && f.hits.length === 0; i++) f.step();
    expect(f.hits[0]?.damage).toBe(6);
    expect(f.hits[0]?.context.projectile).toBe(true);
    expect(f.target.getHitlagRemaining()).toBe(0);
    expect(f.pikachu.getHitlagRemaining()).toBe(0);
    f.step(); // queued source launch applies on the next input/physics step
    expect(f.target.getVelocity().y).toBeGreaterThan(0);
    expect(f.pikachu.getPikachuSpecialState()?.branchFrame).toBeNull();
    expect(f.sensors().some((s:any) => s.plugin.knockback.reference?.fixed === 125)).toBe(true);
  });
  it('continues holding a full-power smash and releases the capped damage multiplier', () => {
    const f = fixture(true);
    const move = buildPikachuSmashWithAuthoredHurtboxes('forward-smash');
    const charged = { ...move, charge: { ...move.charge!, maxHoldFrames: 180 } };
    registerFighterAttack(f.pikachu, charged); f.pikachu.setHeavyAttack(charged.id);
    f.step({ ...neutral, attackHeavy: true }); f.frames(100, { ...neutral, attackHeavy: true });
    expect(f.pikachu.getActiveAttack()).toBeNull();
    expect(f.pikachu.getChargeProgress()).toBe(1);
    f.step();
    expect(f.pikachu.getActiveAttack()?.chargeHeldFrames).toBeGreaterThan(60);
    for (let i = 0; i < 30 && f.sensors().length === 0; i++) f.step();
    expect(f.sensors().length).toBeGreaterThan(0);
    expect(f.sensors()[0].plugin.damage).toBeCloseTo(move.damage * 1.4);
    const data = parseCharacterDataFile({ id: 'pikachu', displayName: 'Pikachu', role: 'fighter',
      body: { width: 40, height: 50, chamfer: 0 }, movement: PIKACHU_MOVEMENT_PROFILE, moves: { smash: charged } });
    expect(parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(data)))).moves?.smash?.charge?.maxHoldFrames).toBe(180);
  });
  it('Skull Bash contacts a receiver and switches to its rebound status without repeated damage', () => {
    const f = fixture(true);
    Body.setPosition(f.target.body, { x: 260, y: f.pikachu.getPosition().y });
    f.step({ ...neutral, moveX: 1 }); f.step({ ...neutral, moveX: 1, special: true });
    // Ground startup is rooted by the native energy reset. Wait the actual
    // release contact window rather than the old inherited slide deadline.
    for (let i = 0; i < 50 && f.hits.length === 0; i++) f.step();
    expect(f.hits.map(h => h.damage)).toEqual([6.2]);
    expect(f.pikachu.getPikachuSpecialState()?.branchFrame).not.toBeNull();
    f.step(); expect(f.pikachu.getVelocity().x).toBeCloseTo(-1.5, 8);
    expect(f.sensors()).toHaveLength(0);
    f.frames(10); expect(f.hits).toHaveLength(1);
  });
  it('Thunder self-burst damages a nearby receiver without damaging its owner', () => {
    const f = fixture(true); f.step({ ...neutral, special: true, moveY: 1 });
    f.frames(20); Body.setPosition(f.target.body, { x: 70, y: f.pikachu.getPosition().y });
    for (let i = 0; i < 30 && f.pikachu.getPikachuSpecialState()?.branchFrame === null; i++) f.step();
    f.frames(2);
    expect(f.hits.some(h => h.damage === 15)).toBe(true);
    expect(f.target.getDamagePercent()).toBe(15);
    expect(f.target.getHitlagRemaining()).toBeGreaterThan(20);
    expect(f.pikachu.getDamagePercent()).toBe(0);
  });
  it.each([true, false])('accepted Jolt body receiving follows status-local windows through real physics (ground=%s)', grounded => {
    const f = fixture(grounded); f.step({ ...neutral, special: true });
    let last = 0;
    for (const frame of [0, 8, 16, 19, 23, 32, 43, 50]) {
      f.frames(frame - last); last = frame;
      const clock = resolvePikachuSpecialBodyClock(f.pikachu.getPikachuSpecialState()!);
      expect(clock).toMatchObject({ sheet: grounded ? 'neutral_special' : 'neutral_special_air', localFrame: frame });
      const authored = selectPikachuSpecialPhaseHurtboxes(clock.sheet, clock.localFrame);
      expect(authored).toHaveLength(12);
      expect(f.pikachu.getActiveHurtboxes()).toEqual(authored);
    }
    f.step(); expect(f.pikachu.getPikachuSpecialState()).toBeNull();
    expect(selectPikachuSpecialPhaseHurtboxes(grounded ? 'neutral_special' : 'neutral_special_air', 51)).toBeNull();
    expect(selectPikachuSpecialPhaseHurtboxes(grounded ? 'neutral_special' : 'neutral_special_air', 74)).toBeNull();
  });
  it('reviewed Skull start and hold receiving shares the six-frame native loop, not ever-growing charge age', () => {
    const f = fixture(true); const held = { ...neutral, special: true, moveX: 1 };
    f.step(held);
    for (let n = 0; n <= 25; n++) {
      if (n > 0) f.step(held);
      const clock = resolvePikachuSpecialBodyClock(f.pikachu.getPikachuSpecialState()!);
      expect(clock.phase).toBe(n < 13 ? 'start' : 'hold');
      const poseFrame = clock.phase === 'hold' ? clock.nativeFrame : clock.localFrame;
      const authored = selectPikachuSpecialPhaseHurtboxes(clock.sheet, poseFrame);
      expect(authored).toHaveLength(12);
      expect(f.pikachu.getActiveHurtboxes()).toEqual(authored);
      if (clock.phase === 'hold') expect(clock.nativeFrame).toBeLessThan(6);
    }
    f.pikachu.applyHit({ damage: 3, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 });
    expect(f.pikachu.getPikachuSpecialState()).toBeNull();
    expect(f.pikachu.getActiveHurtboxes()).toHaveLength(1);
  });
  it('ground Thunder exposes the twelve reviewed receiving capsules on the actual source pose clock', () => {
    const f = fixture(true); f.step({ ...neutral, special: true, moveY: 1 });
    const first = f.pikachu.getActiveHurtboxes();
    expect(first).toHaveLength(12); expect(first.every(h => h.capsule !== undefined)).toBe(true);
    expect(first[0]!.id).toBe('pikachu.thunder-ground.0.hip');
    f.frames(4); expect(f.pikachu.getActiveHurtboxes()[0]!.offsetX).not.toBe(first[0]!.offsetX);
    f.pikachu.applyHit({ damage: 1, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 });
    expect(f.pikachu.getActiveHurtboxes()).toHaveLength(1);
  });
  it('air Thunder selects the separately reviewed airborne receiving pose', () => {
    const f = fixture(); f.step({ ...neutral, special: true, moveY: 1 });
    const first = f.pikachu.getActiveHurtboxes();
    expect(first).toHaveLength(12); expect(first.every(h => h.capsule !== undefined)).toBe(true);
    expect(first[0]!.id).toBe('pikachu.thunder-air.0.hip');
    f.frames(4); expect(f.pikachu.getActiveHurtboxes()[0]!.offsetX).not.toBe(first[0]!.offsetX);
  });
  it.each([true, false])('Thunder self-hit selects reviewed branch poses and rejects real incoming contact for its full protection (ground=%s)', grounded => {
    const f = fixture(grounded);
    // An airborne summon while rising is a distinct real self-hit route.
    // A falling down-stick summon may fast-fall far enough for Thunder to miss.
    if (!grounded) Body.setVelocity(f.pikachu.body, { x: 0, y: -6 });
    f.step({ ...neutral, special: true, moveY: 1 });
    for (let i = 0; i < 85 && f.pikachu.getPikachuSpecialState()?.branchFrame === null; i++) f.step();
    const branch = f.pikachu.getPikachuSpecialState()!;
    expect(branch.branchFrame).not.toBeNull(); expect(branch.bornGrounded).toBe(grounded);
    const first = f.pikachu.getActiveHurtboxes();
    expect(first).toHaveLength(12); expect(first.every(h => h.capsule && h.intangible)).toBe(true);
    expect(resolvePikachuSpecialBodyClock(branch)).toMatchObject({
      sheet: grounded ? 'down_special_hit' : 'down_special_air_hit', localFrame: 0,
    });
    const probe = spawnHitbox(f.scene, { id: 'donkeykong', bodyId: f.target.body.id, position: f.pikachu.getPosition() }, {
      id: 'protection-probe', type: 'jab', damage: 1, knockback: { x: 1, y: -1, scaling: 0 },
      hitbox: { offsetX: 0, offsetY: 0, width: 400, height: 400 },
      startupFrames: 0, activeFrames: 30, recoveryFrames: 0, cooldownFrames: 0,
    }, 1);
    const protection = grounded ? 10 : 8;
    f.frames(protection - 1);
    expect(f.pikachu.getDamagePercent()).toBe(0);
    expect(f.pikachu.getActiveHurtboxes().every(h => h.intangible)).toBe(true);
    expect(f.pikachu.getActiveHurtboxes()[0]!.offsetX).not.toBe(first[0]!.offsetX);
    f.step(); expect(f.pikachu.getDamagePercent()).toBe(1);
    expect(f.pikachu.getPikachuSpecialState()).toBeNull();
    Composite.remove(f.engine.world, probe);
  });
  it('special body clocks follow Jolt rate, actual Skull held time and dynamic Quick endpoints', () => {
    const jolt = fixture(); jolt.step({ ...neutral, special: true }); jolt.frames(43);
    expect(resolvePikachuSpecialBodyClock(jolt.pikachu.getPikachuSpecialState()!)).toMatchObject({
      sheet: 'neutral_special_air', localFrame: 43,
    });
    expect(resolvePikachuSpecialBodyClock(jolt.pikachu.getPikachuSpecialState()!).nativeFrame).toBeCloseTo(18 + 25 / 0.77);
    const skull = fixture(); skull.step({ ...neutral, special: true, moveX: 1 });
    skull.frames(13, { ...neutral, special: true });
    expect(resolvePikachuSpecialBodyClock(skull.pikachu.getPikachuSpecialState()!)).toMatchObject({ phase: 'hold', nativeFrame: 0 });
    skull.frames(6, { ...neutral, special: true });
    expect(skull.pikachu.getPikachuSpecialState()).toMatchObject({ charge: 27, heldFrames: 7 });
    expect(resolvePikachuSpecialBodyClock(skull.pikachu.getPikachuSpecialState()!)).toMatchObject({ phase: 'hold', nativeFrame: 0 });
    skull.step(); expect(resolvePikachuSpecialBodyClock(skull.pikachu.getPikachuSpecialState()!)).toMatchObject({ phase: 'ready', localFrame: 0 });
    const quick = fixture(); quick.step({ ...neutral, special: true, moveY: -1 }); quick.frames(26, { ...neutral, moveY: -1 });
    quick.step({ ...neutral, moveX: 1 }); quick.step({ ...neutral, moveX: 1 });
    expect(resolvePikachuSpecialBodyClock(quick.pikachu.getPikachuSpecialState()!)).toMatchObject({ sheet: 'up_special', phase: 'second', localFrame: 0 });
    quick.frames(5);
    expect(resolvePikachuSpecialBodyClock(quick.pikachu.getPikachuSpecialState()!)).toMatchObject({ sheet: 'up_special_air_end', phase: 'end', localFrame: 0 });
  });
  it('source ledge catch playback gates each option and rejects a seventh catch until reset', () => {
    const tuning = resolveLedgeHangTuning(PIKACHU_MOVEMENT_PROFILE.ledge);
    const candidate = { platformId: 'ledge-source', x: 0, y: 0, side: 'left' as const };
    const input = { detection: { candidate, latchX: 0, latchY: 0 }, release: null, airborne: true, facing: 1 as const };
    for (const [index, expectedGate] of [19, 19, 21, 22, 24, 26].entries()) {
      let state = tickLedgeHang({ ...createLedgeHangState(), ledgeGrabsSinceGround: index }, input, tuning).state;
      for (let frame = 1; frame < expectedGate; frame++) {
        state = tickLedgeHang(state, { ...input, release: 'getUp' }, tuning).state;
        expect(state.name).toBe('hanging');
      }
      expect(tickLedgeHang(state, { ...input, release: 'getUp' }, tuning).state.name).toBe('climbing');
    }
    const denied = tickLedgeHang({ ...createLedgeHangState(), ledgeGrabsSinceGround: 6 }, input, tuning).state;
    expect(denied.name).toBe('idle');
    const grounded = tickLedgeHang(denied, { ...input, detection: null, airborne: false }, tuning).state;
    expect(tickLedgeHang(grounded, input, tuning).state.name).toBe('hanging');
    const f = fixture(); f.pikachu.setLedgeHangState({ ...createLedgeHangState(), ledgeGrabsSinceGround: 6 });
    const launched = f.pikachu.applyHitDetailed({ damage: 0, knockback: { x: 5, y: -3, scaling: 0 }, facing: 1 });
    expect(launched.knockback.hitstunFrames).toBeGreaterThan(0);
    expect(f.pikachu.getLedgeHangState().ledgeGrabsSinceGround).toBe(0);
  });
  it.each([25, 20, 12, 0])('latched source ledge-attack protection budget %s rejects real overlap until its own boundary', budget => {
    const f = fixture(); registerFighterAttack(f.pikachu, PIKACHU_LEDGE_ATTACK);
    const grab = [25, 20, 12, 0].indexOf(budget) + 1;
    f.pikachu.setLedgeHangState({ ...createLedgeHangState(), name: 'hanging', ledgeGrabsSinceGround: grab,
      active: { candidate: { platformId: 'replayed-ledge', x: 0, y: 0, side: 'left' },
        latchX: 0, latchY: 0, framesElapsed: 30, facing: 1 } });
    f.step({ ...neutral, ledgeRelease: 'attack' });
    expect(f.pikachu.getActiveAttack()?.move.id).toBe('pikachu.ledgeAttack');
    expect(f.pikachu.getActiveHurtboxes().some(h => h.intangible)).toBe(budget > 0);
    const probe = spawnHitbox(f.scene, { id: 'donkeykong', bodyId: f.target.body.id, position: f.pikachu.getPosition() }, {
      id: 'ledge-protection-probe', type: 'jab', damage: 1, knockback: { x: 1, y: -1, scaling: 0 },
      hitbox: { offsetX: 0, offsetY: 0, width: 400, height: 400 },
      startupFrames: 0, activeFrames: 60, recoveryFrames: 0, cooldownFrames: 0,
    }, 1);
    if (budget > 0) {
      for (let frame = 1; frame < budget; frame++) {
        f.step(); expect(f.pikachu.getDamagePercent(), JSON.stringify({ frame, budget,
          activeId: f.pikachu.getActiveAttack()?.move.id, elapsed: f.pikachu.getActiveAttack()?.framesElapsed,
          ledge: f.pikachu.getLedgeHangState(), hurtboxes: f.pikachu.getActiveHurtboxes() })).toBe(0);
      }
      expect(f.pikachu.getActiveHurtboxes().some(h => h.intangible)).toBe(true);
    }
    f.step(); expect(f.pikachu.getDamagePercent()).toBe(1);
    Composite.remove(f.engine.world, probe);
  });
  it('transports all four source mechanic presets through saved data', () => {
    const original = parseCharacterDataFile({ id: 'pikachu', displayName: 'Pikachu', role: 'fighter',
      body: { width: 40, height: 50, chamfer: 0 }, movement: PIKACHU_MOVEMENT_PROFILE, moves: createPikachuSpecialMoves() });
    const loaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(original))));
    expect(loaded.movement.ledge).toMatchObject({ climbFrames: 32, getupIframes: 31, rollFrames: 49, rollIframes: 26, jumpIframes: 12 });
    const savedRuntime = new Character(fixture().scene, { id: 'pikachu', spawnX: 0, spawnY: 0,
      width: 40, height: 50, ...loaded.movement });
    expect(savedRuntime.getTuning().ledge).toMatchObject({ climbFrames: 32, getupIframes: 31, rollFrames: 49, rollIframes: 26, jumpIframes: 12 });
    for (const [slot, move] of Object.entries(createPikachuSpecialMoves()))
      expect((loaded.moves as any)[slot]).toEqual(move);
    expect(() => parseCharacterDataFile({ ...original, moves: { upSpecial: { ...PIKACHU_UP_SPECIAL,
      pikachuSpecial: { kind: 'quickAttack', source: 'invented' } } } })).toThrow(/preset/);
  });
});
