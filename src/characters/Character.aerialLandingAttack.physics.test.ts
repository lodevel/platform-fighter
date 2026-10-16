import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import { buildPikachuNormalMove } from './pikachuNormalMoves';
import type { AerialMove } from './aerialSchema';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import type { HitInfo } from './combat';
import { applyCharacterMoveOverrides, createCharacterById } from './characterFactory';
import { parseCharacterDataFile, serializeCharacterDataSpec, type CharacterDataSpec } from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

/** Synthetic airborne pose is deliberately outside the probe's reach. Only
 * native root landing contacts and their real runtime consumer are measured. */
const outsideProbePose = () => ({ start: { x: 0, y: -300 }, end: { x: 0, y: -300 } });
const sourceAerial = (id: 'back-air' | 'down-air') => buildPikachuNormalMove(id, outsideProbePose) as AerialMove;

function fixture(move: AerialMove, facing: 1 | -1 = 1, targetX = 30, savedSpec?: CharacterDataSpec) {
  const engine = Engine.create(); engine.gravity.y = 0;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { on(name: string, fn: any) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, names[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); } } } };
  const options = { spawnX: 0, spawnY: 0, width: 40, height: 50,
    fallAccel: 0, maxFallSpeed: 3, softLandingFrames: 0, hardLandingFrames: 0 };
  const ch = savedSpec ? createCharacterById(scene, savedSpec.id, options) : new Character(scene, { id: 'pikachu', ...options });
  if (savedSpec) applyCharacterMoveOverrides(ch, savedSpec);
  else registerFighterAttack(ch, move);
  ch.setFacing(facing);
  const target = Bodies.rectangle(1000, 0, 1, 1, { isStatic: true, isSensor: true, label: CHARACTER_LABEL,
    plugin: { characterId: 'target' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
  Composite.add(engine.world, target);
  const contacts: { hit: HitInfo; moveId?: string; frame?: number }[] = [];
  const handler = new HitboxDamageHandler((index, hit) => {
    if (index !== 1) return { confirmed: false };
    contacts.push({ hit, moveId: ch.getActiveAttack()?.move.id, frame: ch.getActiveAttack()?.framesElapsed });
    return { confirmed: true };
  });
  handler.registerPlayer(0, ch.body); handler.registerPlayer(1, target);
  handler.setGroundedLookup(() => true);
  handler.setFacingLookup(index => index === 0 ? ch.getFacing() : 1);
  handler.setHurtboxLookup(index => index === 0 ? ch.getActiveHurtboxes()
    : [{ id: 'probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }]);
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (input = neutral) => {
    ch.applyInput(input);
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
      body: Body, deltaMs: 1000 / 60, stepWorld: dt => {
        Engine.update(engine, dt); handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
      } });
  };
  const probe = (x = targetX) => Body.setPosition(target, { x: ch.getPosition().x + x * facing, y: ch.getPosition().y + 5 });
  const landAt = (elapsed: number, beforeContact?: () => void) => {
    if (savedSpec) expect(ch.attemptAttack(move.id)).toBe(true);
    else step({ ...neutral, attack: true });
    for (let frame = 1; frame < elapsed; frame++) step();
    beforeContact?.();
    const position = ch.getPosition();
    const floor = Bodies.rectangle(position.x, position.y + 37, 2000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
    Composite.add(engine.world, floor);
    Body.setVelocity(ch.body, { x: 0, y: 3 });
    step();
    expect(ch.isGrounded()).toBe(true);
    probe();
  };
  return { ch, step, landAt, contacts, probe, engine, target };
}

describe('automatic aerial landing contacts through real Matter floor/contact', () => {
  it.each([['back-air', 4, 18], ['down-air', 16, 22]] as const)('%s at elapsed%s contacts game1–2, clears3 and releases after exactly%s landing steps', (id, frame, lag) => {
    for (const facing of [1, -1] as const) {
      const move = sourceAerial(id);
      const { ch, step, landAt, contacts, engine } = fixture(move, facing);
      landAt(frame);
      const airborneSensor = ch.getActiveAttack()?.hitboxBody;
      expect(airborneSensor).not.toBeNull();
      step(); // Touchdown recovery step1, landing elapsed0.
      expect(ch.getActiveAttack()).toMatchObject({ move: { id: move.landingAttack!.id }, framesElapsed: 0, facing });
      expect(Composite.allBodies(engine.world)).not.toContain(airborneSensor);
      expect(contacts).toMatchObject([{ hit: { damage: 4 }, moveId: move.landingAttack!.id, frame: 0 }]);
      expect(ch.getCooldownRemaining()).toBe(lag);
      step(); // elapsed1 is the last contact frame.
      expect(ch.getActiveAttack()?.hitboxBody).not.toBeNull();
      expect(contacts).toHaveLength(1); // Same strike across per-frame snapshots.
      step(); // elapsed2 clears all landing contact.
      expect(ch.getActiveAttack()?.hitboxBody).toBeNull();
      for (let committed = 4; committed <= lag; committed++) {
        expect(ch.canUseItemsBeforeInput()).toBe(false);
        step({ ...neutral, moveX: 1, shield: true, grab: true, dodge: true });
        expect(ch.canAttack()).toBe(false);
        expect(ch.getVelocity().x).toBe(0);
        expect(ch.isShielding()).toBe(false);
      }
      expect(ch.canUseItemsBeforeInput()).toBe(true);
      step({ ...neutral, shield: true });
      expect(ch.getActiveAttack()).toBeNull();
      expect(ch.isShielding()).toBe(true);
    }
  });

  it.each(['back-air', 'down-air'] as const)('%s landing edge misses in both facings', id => {
    for (const facing of [1, -1] as const) {
      const { step, landAt, contacts } = fixture(sourceAerial(id), facing, id === 'back-air' ? 41 : 51);
      landAt(id === 'back-air' ? 6 : 16);
      step(); step(); step();
      expect(contacts).toHaveLength(0);
    }
  });

  it('permits contact on landing game2 but rejects contact after the clear on game3', () => {
    for (const delayedFrame of [1, 2]) {
      const { step, landAt, contacts, probe } = fixture(sourceAerial('down-air'), 1, 1000);
      landAt(16); step();
      for (let frame = 1; frame < delayedFrame; frame++) step();
      probe(30); step();
      expect(contacts).toHaveLength(delayedFrame === 1 ? 1 : 0);
      if (delayedFrame === 1) expect(contacts[0]!.frame).toBe(1);
    }
  });

  it.each([['back-air', 2], ['back-air', 37], ['down-air', 37]] as const)('%s autocancel at elapsed%s suppresses the landing attack', (id, frame) => {
    const { ch, step, landAt, contacts } = fixture(sourceAerial(id));
    landAt(frame); step({ ...neutral, shield: true });
    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.getCooldownRemaining()).toBe(0);
    expect(ch.isShielding()).toBe(true);
    expect(contacts).toHaveLength(0);
  });

  it('freezes landing pose/contact and recovery together through hitlag', () => {
    const { ch, step, landAt, contacts } = fixture(sourceAerial('down-air'));
    landAt(16); step(); ch.armAttackerHitlag(3);
    const sensor = ch.getActiveAttack()?.hitboxBody;
    for (let frozen = 0; frozen < 3; frozen++) {
      step();
      expect(ch.getActiveAttack()).toMatchObject({ framesElapsed: 0, hitboxBody: sensor });
      expect(ch.getCooldownRemaining()).toBe(22);
    }
    step(); expect(ch.getActiveAttack()?.framesElapsed).toBe(1);
    step(); expect(ch.getActiveAttack()?.hitboxBody).toBeNull();
    expect(contacts).toHaveLength(1);
    for (let committed = 4; committed <= 22; committed++) step();
    step({ ...neutral, jump: true });
    expect(ch.getJumpsquatRemaining()).toBe(3);
  });

  it('damage interrupts the landing sensor immediately and never replays it', () => {
    const { ch, step, landAt, contacts, engine } = fixture(sourceAerial('back-air'));
    landAt(6); step();
    const sensor = ch.getActiveAttack()?.hitboxBody;
    ch.applyHit({ damage: 1, knockback: { x: 0, y: 0, scaling: 0 }, facing: 1, hitlagMultiplier: 0 });
    expect(ch.getActiveAttack()).toBeNull();
    expect(Composite.allBodies(engine.world)).not.toContain(sensor);
    for (let frame = 0; frame < 25; frame++) step();
    expect(contacts).toHaveLength(1);
  });

  it('a new aerial replaces a prior actionable landing flag and its contact route', () => {
    const old: AerialMove = { ...sourceAerial('back-air'), startupFrames: 0, activeFrames: 1, recoveryFrames: 2,
      hitWindows: [{ startFrame: 0, endFrame: 1 }], autoCancelWindows: [{ startFrame: 30, endFrame: 31 }] };
    const { ch, step, landAt, contacts } = fixture(old);
    const next: AerialMove = { ...old, id: 'fixture.new-aerial', landingAttack: undefined };
    registerFighterAttack(ch, next);
    landAt(8, () => expect(ch.attemptAttack(next.id)).toBe(true)); step();
    expect(ch.getActiveAttack()).toBeNull();
    expect(contacts).toHaveLength(0);
    expect(ch.getCooldownRemaining()).toBe(18);
  });

  it('damage before touchdown recovery and an ordinary landing cannot replay an interrupted route', () => {
    for (const interruption of ['damage', 'reset'] as const) {
      const { ch, step, landAt, contacts } = fixture(sourceAerial('down-air'));
      landAt(16);
      if (interruption === 'damage') ch.applyHit({ damage: 1, knockback: { x: 0, y: 0, scaling: 0 }, facing: 1, hitlagMultiplier: 0 });
      else ch.setPosition(ch.getPosition().x, ch.getPosition().y);
      for (let frame = 0; frame < 25; frame++) step();
      expect(contacts).toHaveLength(0);
      expect(ch.getActiveAttack()).toBeNull();
    }
  });

  it('restores a saved fighter through the actual factory and automatically runs its nested landing record', () => {
    const prepared = sourceAerial('back-air');
    const move: AerialMove = { ...prepared, id: 'fixture.bair', landingAttack: { ...prepared.landingAttack!,
      animation: { startupFrames: 0, activeFrames: 2, recoveryFrames: 3 },
      hurtboxModifiers: [{ phase: 'active', replaceBody: true,
        hurtbox: { id: 'fixture.landing-foot', offsetX: 10, offsetY: 5, width: 20, height: 10 } }],
    } };
    const spec = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec({
      ...getAuthorableCharacterSpec('pikachu'), moves: { bair: move },
    }))));
    const { ch, step, landAt, contacts } = fixture(spec.moves!.bair!, -1, 30, spec);
    expect(ch.getAttack('fixture.bair')).toEqual(spec.moves!.bair);
    expect(ch.getAttack(move.landingAttack!.id)).toBeUndefined();
    landAt(4); step();
    expect(ch.getActiveAttack()).toMatchObject({ move: spec.moves!.bair!.landingAttack, framesElapsed: 0 });
    expect(ch.getCurrentAnimation()).toMatchObject({ phase: 'active', artFrameIndex: 0, facing: -1 });
    expect(ch.getActiveHurtboxes()).toMatchObject([{ id: 'fixture.landing-foot' }]);
    expect(contacts).toMatchObject([{ hit: { damage: 4 }, frame: 0 }]);
    step();
    expect(ch.getCurrentAnimation()).toMatchObject({ phase: 'active', artFrameIndex: 1, facing: -1 });
    step();
    expect(ch.getCurrentAnimation()).toMatchObject({ phase: 'recovery', artFrameIndex: 0, facing: -1 });
    expect(ch.getActiveHurtboxes().map(hurtbox => hurtbox.id)).not.toContain('fixture.landing-foot');
  });
});
