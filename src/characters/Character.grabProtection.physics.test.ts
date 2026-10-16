import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import { Pikachu } from './Pikachu';
import type { GrabSpec } from './grabSchema';
import type { Hurtbox } from './moveSchema';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { registerFighterAttack } from './attackRegistration';
import { computeHitlag } from './combat';
import { RespawnHandler } from '../match/RespawnHandler';
import { REVIVAL_DISMOUNT_INVINCIBILITY_MAX_FRAMES } from '../match/revivalPlatform';
import { BlastZonePositionWatcher } from '../match/BlastZonePositionWatcher';
const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, jump: false };
function fixture(facing: 1 | -1, dispatch = true) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const b = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, b); return b;
  } }, world: { on(n: string, fn: any) { Events.on(engine, names[n] ?? n, fn); },
    off(n: string, fn: any) { Events.off(engine, names[n] ?? n, fn); }, remove(b: any) { Composite.remove(engine.world, b); } } } };
  const attacker = new Character(scene, { id: 'donkeykong', spawnX: 0, spawnY: 0, width: 40, height: 50 });
  const target = new Pikachu(scene, { spawnX: facing * 80, spawnY: 0 });
  const throwSpec = { damage: 0, animationFrames: 1, knockback: { x: 0, y: 0, scaling: 0 } };
  const grab: GrabSpec = { id: 'protection.grab', startupFrames: 1, activeFrames: 150, whiffRecoveryFrames: 1,
    hitbox: { offsetX: 80, offsetY: 0, width: 220, height: 220 }, holdFramesMax: 100,
    throwRecoveryFrames: 0, throws: { forward: throwSpec, back: throwSpec, up: throwSpec, down: throwSpec } };
  attacker.setGrabSpec(grab);
  const floor = Bodies.rectangle(0, 35, 2000, 20, { isStatic: true,
    label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
  Composite.add(engine.world, floor);
  let confirmations = 0;
  const attackContacts: string[] = [];
  const handler = new HitboxDamageHandler((index, _hit, context) => {
    if (!dispatch || index !== 1) return { confirmed: false };
    if (context.kind === 'attack') {
      const result = target.applyHitDetailed(_hit);
      const confirmed = result.outcome === 'invulnerable' || result.outcome === 'landed';
      if (confirmed) {
        attackContacts.push(result.outcome);
        attacker.armAttackerHitlag(computeHitlag({ damage: _hit.damage, targetPercent: target.getDamagePercent(), multiplier: _hit.hitlagMultiplier }));
      }
      return { confirmed };
    }
    attacker.resolveGrabConnect(target);
    const confirmed = target.getGrabbedBy() === attacker;
    if (confirmed) confirmations++;
    return { confirmed };
  });
  handler.registerPlayer(0, attacker.body); handler.registerPlayer(1, target.body);
  handler.setHurtboxLookup(index => (index === 1 ? target : attacker).getActiveHurtboxes());
  handler.setFacingLookup(index => (index === 1 ? target : attacker).getFacing());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (ownerInput = neutral, targetInput = neutral) => {
    attacker.applyInput(ownerInput); target.applyInput(targetInput);
    target.tickPikachuSpecialEntities([{ vertices: floor.vertices }], []);
    Engine.update(engine, 1000 / 60);
    attacker.applyPostPhysicsVelocityConstraints(); target.applyPostPhysicsVelocityConstraints();
    handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
  };
  for (let i = 0; i < 12; i++) step();
  attacker.setFacing(facing); target.setFacing(facing);
  return { attacker, target, step, confirmations: () => confirmations, attackContacts };
}
describe('source whole-body protection against captures', () => {
  it.each([1, -1] as const)('source spot dodge refuses actual lingering grab until protection ends%s', facing => {
    const { attacker, target, step, confirmations } = fixture(facing);
    step(neutral, { ...neutral, dodge: true }); step(); step();
    expect(target.isInvincible()).toBe(true);
    expect(target.getActiveHurtboxes()).toHaveLength(12);
    step({ ...neutral, grab: true }); step();
    expect(attacker.getGrabState().name).toBe('whiffActive');
    expect(target.isGrabbed()).toBe(false);
    expect(confirmations()).toBe(0);
    expect(attacker.getHitlagRemaining()).toBe(0);
    expect(target.getHitlagRemaining()).toBe(0);
    for (let i = 0; i < 30 && !target.isGrabbed(); i++) step();
    expect(target.isGrabbed()).toBe(true);
    expect(confirmations()).toBe(1);
  });
  it('direct capture hook cannot bypass a protected source dodge', () => {
    const { attacker, target, step } = fixture(1, false);
    step(neutral, { ...neutral, dodge: true }); step(); step();
    step({ ...neutral, grab: true }); step();
    attacker.resolveGrabConnect(target);
    expect(target.isGrabbed()).toBe(false);
  });
  it.each([1, -1] as const)('Thunder whole-body intangible receiving blocks direct capture%s', facing => {
    const { attacker, target, step } = fixture(facing, false);
    step(neutral, { ...neutral, moveY: 1, special: true });
    for (let i = 0; i < 80 && target.getPikachuSpecialState()?.branchFrame === null; i++) step();
    const special = target.getPikachuSpecialState();
    expect(special?.kind).toBe('thunder');
    expect(special?.branchFrame).not.toBeNull();
    expect((target.getActiveHurtboxes() as readonly Hurtbox[]).every(h => h.intangible)).toBe(true);
    step({ ...neutral, grab: true }); step();
    attacker.resolveGrabConnect(target);
    expect(target.isGrabbed()).toBe(false);
    expect(attacker.getHitlagRemaining()).toBe(0);
  });
  it('partial-body intangible protection keeps the vulnerable body capturable', () => {
    const { attacker, target, step } = fixture(1, false);
    const live = target.getActiveHurtboxes();
    const mixed: readonly Hurtbox[] = [{ ...live[0]!, intangible: true }, ...live.slice(1)];
    target.getActiveHurtboxes = () => mixed;
    step({ ...neutral, grab: true }); step();
    attacker.resolveGrabConnect(target);
    expect(target.isGrabbed()).toBe(true);
  });
});


describe('source-opt-in respawn protection contact semantics', () => {
  // SmashWiki Revival platform: the revived fighter waits intangible on the platform until it moves or attacks; leaving
  // at once grants the full 120 frames (https://www.ssbwiki.com/Revival_platform). The tests below start from that drop.
  function respawn(target: Pikachu, facing: 1 | -1, step: (a?: CharacterInput, b?: CharacterInput) => void) {
    const handler = new RespawnHandler();
    handler.registerSlot({ playerIndex: 1, spawnX: facing * 80, spawnY: target.getPosition().y, faceOnSpawn: facing }, target);
    handler.applyRespawns([{ playerIndex: 1, invincibilityFrames: 90 }], 0);
    expect(target.isOnRevivalPlatform()).toBe(true);
    expect(target.isSourceInvincible()).toBe(false);
    expect(target.getActiveHurtboxes().every(h => h.intangible)).toBe(true);
    step(neutral, { ...neutral, moveY: 0.2 }); // a slight stick movement leaves the platform
    expect(target.isOnRevivalPlatform()).toBe(false);
    expect(target.isSourceInvincible()).toBe(true);
    expect(target.getInvincibilityRemaining()).toBe(REVIVAL_DISMOUNT_INVINCIBILITY_MAX_FRAMES - 1);
  }
  it.each([1, -1] as const)('registered respawn contact freezes only attacker and consumes persistent strike%s', facing => {
    const { attacker, target, step, attackContacts } = fixture(facing);
    respawn(target, facing, step);
    expect(target.isSourceInvincible()).toBe(true);
    registerFighterAttack(attacker, { id: 'respawn.persistent', type: 'tilt', damage: 3,
      knockback: { x: 2, y: -1, scaling: 0 }, startupFrames: 1, activeFrames: 150,
      recoveryFrames: 0, cooldownFrames: 0,
      hitbox: { offsetX: 80, offsetY: 0, width: 220, height: 220 } });
    expect(attacker.attemptAttack('respawn.persistent')).toBe(true); step();
    expect(attackContacts).toEqual(['invulnerable']);
    expect(attacker.getHitlagRemaining()).toBeGreaterThan(0);
    expect(target.getHitlagRemaining()).toBe(0);
    const ownerAge = attacker.getActiveAttack()!.framesElapsed;
    // Respawn clears platform support; allow the actual soft landing to finish
    // while the attacker remains frozen, then inspect the ordinary body clock.
    for (let i = 0; i < 4 && target.getOrdinaryPresentationState() === null; i++) step();
    expect(attacker.getActiveAttack()!.framesElapsed).toBe(ownerAge);
    const targetAge = target.getOrdinaryPresentationState()!.framesElapsed;
    const remaining = target.getInvincibilityRemaining();
    step();
    expect(attacker.getActiveAttack()!.framesElapsed).toBe(ownerAge);
    expect(target.getOrdinaryPresentationState()!.framesElapsed).toBe(targetAge + 1);
    expect(target.getInvincibilityRemaining()).toBe(remaining - 1);
    for (let i = 0; i < REVIVAL_DISMOUNT_INVINCIBILITY_MAX_FRAMES; i++) step();
    expect(target.isSourceInvincible()).toBe(false);
    expect(target.getInvincibilityRemaining()).toBe(0);
    expect(target.getDamagePercent()).toBe(0);
    expect(attackContacts).toEqual(['invulnerable']);
  });
  it('legacy counters and source dodge remain unconfirmed suppression', () => {
    const { attacker, target, step } = fixture(1, false);
    attacker.setRespawnInvincibility(90);
    expect(attacker.isSourceInvincible()).toBe(false);
    const hit = { damage: 3, knockback: { x: 2, y: -1, scaling: 0 }, facing: 1 as const };
    expect(attacker.applyHitDetailed(hit).outcome).toBe('invincible');
    target.setInvincibility(90); // Ordinary getup/tech legacy setter, not respawn hook.
    expect(target.isSourceInvincible()).toBe(false);
    expect(target.applyHitDetailed(hit).outcome).toBe('invincible');
    target.setInvincibility(0);
    step(neutral, { ...neutral, dodge: true }); step(); step();
    expect(target.applyHitDetailed(hit).outcome).toBe('dodged');
    expect(target.getHitlagRemaining()).toBe(0);
  });
  it.each([1, -1] as const)('source respawn blocks grab but never prevents blast-zone crossing%s', facing => {
    const { attacker, target, step } = fixture(facing, false);
    respawn(target, facing, step);
    step({ ...neutral, grab: true }); step();
    attacker.resolveGrabConnect(target);
    expect(target.isGrabbed()).toBe(false);
    const events: number[] = [];
    const watcher = new BlastZonePositionWatcher({ left: -100, right: 100, top: -100, bottom: 100 }, event => events.push(event.playerIndex));
    watcher.registerPlayer(1, target.body);
    Body.setPosition(target.body, { x: facing * 99, y: target.getPosition().y });
    Body.setVelocity(target.body, { x: facing * 8, y: 0 });
    step(); watcher.update(1); watcher.update(2);
    expect(target.getInvincibilityRemaining()).toBeGreaterThan(0);
    expect(target.getHitlagRemaining()).toBe(0);
    expect(events).toEqual([1]);
  });
});
