import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { buildPikachuNormalMove } from './pikachuNormalMoves';
import { registerFighterAttack } from './attackRegistration';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

/** Source fair through Character's actual attack clock and hitlag pinning.
 * Stationary one-pixel probes establish authored clock execution; no victim
 * launch, native timer aging, Pikachu animation or movement parity is claimed. */
function fixture(facing: 1 | -1, freezeFrames: number) {
  const engine = Engine.create(); engine.gravity.y = 0;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { on(name: string, fn: any) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, names[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); } } } };
  const attacker = new Character(scene, { id: 'donkeykong', spawnX: 0, spawnY: -400, width: 40, height: 50 });
  const move = buildPikachuNormalMove('forward-air', undefined, { rehitClockPolicy: 'authored-attack-elapsed' });
  registerFighterAttack(attacker, move);
  const probe = (y: number) => Bodies.rectangle(45 * facing, -400 + y, 1, 1, { isStatic: true, isSensor: true,
    label: CHARACTER_LABEL, plugin: { characterId: 'probe' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
  const first = probe(17.5), late = probe(-22.5);
  Body.setPosition(late, { x: 300 * facing, y: -422.5 });
  Composite.add(engine.world, [first, late]);
  let physicalSteps = 0;
  const hits: { target: number; frame: number; damage: number; physicalStep: number }[] = [];
  const clockSamples: { frame: number | null; hitlag: number }[] = [];
  const handler = new HitboxDamageHandler((target, hit) => {
    const frame = attacker.getActiveAttack()?.framesElapsed;
    if (frame === undefined) throw new Error('Fair contact outlived its Character action');
    hits.push({ target, frame, damage: hit.damage, physicalStep: physicalSteps });
    if (freezeFrames) attacker.armAttackerHitlag(freezeFrames);
    return { confirmed: true };
  });
  handler.registerPlayer(0, attacker.body); handler.registerPlayer(1, first); handler.registerPlayer(2, late);
  handler.setGroundedLookup(() => false);
  handler.setFacingLookup(index => index === 0 ? attacker.getFacing() : 1);
  handler.setHurtboxLookup(index => index === 0 ? attacker.getActiveHurtboxes()
    : [{ id: 'probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }]);
  handler.setRehitClockLookup((owner, sensor) => {
    const active = attacker.getActiveAttack();
    return owner === attacker.body.id && active?.hitboxBody === sensor
      && 'rehitClockPolicy' in active.move && active.move.rehitClockPolicy === 'authored-attack-elapsed'
      ? active.framesElapsed : null;
  });
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = () => {
    attacker.applyInput(neutral);
    const frame = attacker.getActiveAttack()?.framesElapsed ?? null;
    Body.setPosition(first, { x: attacker.body.position.x + 45 * facing, y: attacker.body.position.y + 17.5 });
    Body.setPosition(late, { x: attacker.body.position.x + (frame !== null && frame >= 11 ? 45 : 300) * facing,
      y: attacker.body.position.y - 22.5 });
    clockSamples.push({ frame, hitlag: attacker.getHitlagRemaining() });
    physicalSteps++;
    stepCharacterPhysics({ characters: [attacker], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
      body: Body, deltaMs: 1000 / 60, stepWorld: dt => {
        Engine.update(engine, dt); handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
      } });
  };
  step(); attacker.setFacing(facing);
  expect(attacker.attemptAttack(move.id)).toBe(true);
  for (let i = 0; i < 180 && attacker.getActiveAttack(); i++) step();
  expect(attacker.getActiveAttack()).toBeNull();
  return { hits, clockSamples };
}

describe('Pikachu fair with explicit authored Character attack-elapsed clock', () => {
  it.each([1, -1] as const)('has target-relative five-link and finisher contacts without freeze, facing %s', facing => {
    const { hits } = fixture(facing, 0);
    expect(hits.filter(hit => hit.target === 1).map(hit => hit.frame)).toEqual([10, 13, 16, 19, 22, 26]);
    expect(hits.filter(hit => hit.target === 2).map(hit => hit.frame)).toEqual([11, 14, 17, 20, 23, 26]);
    expect(hits.filter(hit => hit.target === 1).map(hit => hit.damage)).toEqual([1.3, 1.3, 1.3, 1.3, 1.3, 4.8]);
    expect(hits.some(hit => hit.frame === 25 || hit.frame >= 27)).toBe(false);
  });
  it.each([1, -1] as const)('freezes repeated-contact eligibility with Character attacker hitlag, facing %s', facing => {
    const { hits, clockSamples } = fixture(facing, 5);
    expect(hits.filter(hit => hit.target === 1).map(hit => hit.frame)).toEqual([10, 13, 16, 19, 22, 26]);
    expect(hits.filter(hit => hit.target === 2).map(hit => hit.frame)).toEqual([11, 14, 17, 20, 23, 26]);
    const first = hits.filter(hit => hit.target === 1);
    expect(first[1]!.physicalStep - first[0]!.physicalStep).toBeGreaterThan(3);
    expect(clockSamples.filter(sample => sample.frame === 10 && sample.hitlag > 0).length).toBeGreaterThan(1);
  });
});
