import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { referenceAutolinkVelocity, validReferenceAutolinkContext } from './referenceAutolink';
import { computeReferenceKnockback } from './referenceKnockback';
import { Link } from './Link';
import { DonkeyKong } from './DonkeyKong';
import type { CharacterInput } from './Character';
import type { HitInfo } from './combat';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { spawnHitbox, type AttackMove } from './attacks';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { applyCharacterMoveOverrides } from './characterFactory';
import { buildCharacterEditorFields, stepCharacterEditorField } from '../characterBuilder/characterEditorFields';
import { GAME_CONFIG } from '../engine/constants';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const AUTOLINK: HitInfo = {
  damage: 1, facing: 1,
  knockback: { x: 0, y: -1, scaling: 0, reference: { base: 100, growth: 0, angle: 367 } },
  autolink: { target: { x: 20, y: -20 }, sourceVelocity: { x: 3, y: -1 } },
};

function world() {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = GAME_CONFIG.gravity;
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
  const fighter = new Link(scene, { spawnX: 0, spawnY: 0 });
  const step = (input: CharacterInput = NEUTRAL) => {
    fighter.applyInput(input);
    const afterInput = { ...fighter.getVelocity() };
    const releasePosition = { ...fighter.getPosition() };
    stepCharacterPhysics({ characters: [fighter], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    return { afterInput, releasePosition };
  };
  const release = (input: CharacterInput = NEUTRAL) => {
    for (let guard = 0; guard < 100 && fighter.getHitlagRemaining() > 1; guard++) step();
    expect(fighter.getHitlagRemaining()).toBe(1);
    const result = step(input);
    expect(fighter.getHitlagRemaining()).toBe(0);
    return result;
  };
  return { fighter, engine, scene, step, release };
}

describe('angle-367 contextual launch calibration', () => {
  it.each([
    { target: { x: 20, y: -30 }, sourceVelocity: { x: 2, y: -1 }, expected: { x: 6, y: -7 } },
    { target: { x: -20, y: -30 }, sourceVelocity: { x: -2, y: -1 }, expected: { x: -6, y: -7 } },
    { target: { x: 20, y: 30 }, sourceVelocity: { x: 2, y: 1 }, expected: { x: 6, y: 5 } },
    { target: { x: -20, y: 30 }, sourceVelocity: { x: -2, y: 1 }, expected: { x: -6, y: 5 } },
  ])('pulls toward $target while retaining source velocity and bounding downward transport', ({ target, sourceVelocity, expected }) => {
    expect(referenceAutolinkVelocity({ target, sourceVelocity }, { x: 0, y: 0 })).toEqual(expected);
    expect(referenceAutolinkVelocity({ target: { x: target.x + 100, y: target.y - 80 }, sourceVelocity },
      { x: 100, y: -80 })).toEqual(expected);
  });

  it('keeps the previous 80-degree grounded response, magnitude and hitstun', () => {
    const ordinary = { base: 0, growth: 90, angle: 80, fixed: 90, setWeight: true };
    for (const facing of [-1, 1] as const) for (const percent of [0, 150, 999]) {
      expect(computeReferenceKnockback({ ...ordinary, angle: 367 }, percent, 1.4, 127, facing, true))
        .toEqual(computeReferenceKnockback(ordinary, percent, 1.4, 127, facing, true));
      // Airborne 367 is contextual: Character replaces the transport, so no native angle is reported.
      expect(computeReferenceKnockback({ ...ordinary, angle: 367 }, percent, 1.4, 127, facing, false)
        .nativeLaunchAngleRadians).toBeNull();
    }
  });

  it('rejects nonfinite contact metadata instead of corrupting a launch', () => {
    expect(validReferenceAutolinkContext(undefined)).toBe(false);
    expect(validReferenceAutolinkContext(AUTOLINK.autolink)).toBe(true);
    expect(validReferenceAutolinkContext({ target: { x: NaN, y: 0 }, sourceVelocity: { x: 0, y: 0 } })).toBe(false);
    expect(validReferenceAutolinkContext({ target: { x: 0, y: 0 }, sourceVelocity: { x: 0, y: Infinity } })).toBe(false);
  });
});

describe('angle-367 contact routing and authoring', () => {
  it.each([-1, 1] as const)('samples the actual selected capsule world midpoint facing %i', facing => {
    const { fighter, engine, scene, step } = world();
    const move: AttackMove = {
      id: 'test.autolink', type: 'upSpecial', damage: 1, knockback: AUTOLINK.knockback,
      hitbox: { offsetX: 40, offsetY: 0, width: 100, height: 60 },
      startupFrames: 0, activeFrames: 1, recoveryFrames: 0, cooldownFrames: 0,
      collisionHits: [{ id: 0, capsule: { start: { x: 20, y: -10 }, end: { x: 60, y: 10 }, radius: 30 } }],
    };
    const origin = { x: 100, y: 200 };
    Body.setPosition(fighter.body, { x: origin.x + 40 * facing, y: origin.y + 10 });
    const hits: HitInfo[] = [];
    let grounded = false;
    const handler = new HitboxDamageHandler((_, hit) => { hits.push(hit); return { confirmed: false }; });
    handler.registerPlayer(0, fighter.body);
    handler.setGroundedLookup(() => grounded);
    Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
    Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
    const sensor = spawnHitbox(scene, { id: 'donkeykong', bodyId: -1, position: origin }, move, facing);
    sensor.plugin.attackerVelocity = { x: 4 * facing, y: -2 };
    step();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.autolink).toEqual({ target: { x: origin.x + 40 * facing, y: origin.y },
      sourceVelocity: { x: 4 * facing, y: -2 } });
    grounded = true;
    step();
    expect(hits).toHaveLength(2);
    expect(hits[1]!.autolink).toBeUndefined();
  });

  it('roundtrips angle 367 into the fighter and steps past unsupported editor values', () => {
    const file: any = JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('link'))));
    file.moves.jab.knockback.reference.angle = 367;
    const spec = parseCharacterDataFile(file);
    const reloaded = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec))));
    expect(reloaded.moves!.jab!.knockback.reference!.angle).toBe(367);
    const { fighter } = world();
    applyCharacterMoveOverrides(fighter, reloaded);
    expect(fighter.getAttack('link.jab')!.knockback.reference!.angle).toBe(367);
    const field = buildCharacterEditorFields(reloaded, 'move', 'jab')
      .find(row => row.id === 'knockback.reference.angle')!;
    expect(field.max).toBe(367);
    expect(stepCharacterEditorField(field, -1)).toBe(361);
    expect(stepCharacterEditorField({ ...field, value: 361 }, 1)).toBe(367);
    // 366 is accepted: Donkey Kong's native rows use it and must round-trip through the Lab.
    const native366 = JSON.parse(JSON.stringify(file));
    native366.moves.jab.knockback.reference.angle = 366;
    expect(parseCharacterDataFile(native366).moves!.jab!.knockback.reference!.angle).toBe(366);
    const invalid = JSON.parse(JSON.stringify(file));
    invalid.moves.jab.knockback.reference.angle = 365;
    expect(() => parseCharacterDataFile(invalid)).toThrow(/reference.angle/);
  });
});

describe('contextual pull after real hitlag/SDI through Matter', () => {
  it.each([-1, 1] as const)('releases source motion plus position pull facing %i, with independent KB/hitstun', facing => {
    const { fighter, release } = world();
    const context = { target: { x: 20 * facing, y: -20 }, sourceVelocity: { x: 3 * facing, y: -1 } };
    const launch = fighter.applyHit({ ...AUTOLINK, facing, autolink: context });
    const released = release();
    expect(released.afterInput.x).toBeCloseTo(7 * facing, 10);
    expect(released.afterInput.y).toBeCloseTo(-5, 10);
    expect(launch.referenceKnockback).toBe(100);
    expect(launch.ordinaryHitstunFrames).toBe(39);
    expect(fighter.getHitstunRemaining()).toBe(launch.hitstunFrames);
    expect(fighter.isTumbling()).toBe(true);
  });

  it('samples the post-SDI position at release without applying ordinary DI/LSI', () => {
    const { fighter, release } = world();
    fighter.applyHit(AUTOLINK);
    const released = release({ ...NEUTRAL, moveX: 1 });
    expect(released.releasePosition).toEqual({ x: 10, y: 0 });
    expect(released.afterInput.x).toBeCloseTo(5, 10);
    expect(released.afterInput.y).toBeCloseTo(-5, 10);
  });

  it('deep-copies the impact anchor so later sensor mutation cannot alter the queued pull', () => {
    const { fighter, release } = world();
    const context = { target: { x: 20, y: -20 }, sourceVelocity: { x: 3, y: -1 } };
    fighter.applyHit({ ...AUTOLINK, autolink: context });
    context.target.x = 1000;
    context.sourceVelocity.y = 1000;
    expect(release().afterInput).toEqual({ x: 7, y: -5 });
  });

  it('does not add the legacy source-motion carry a second time to a contextual pull', () => {
    const { fighter, release } = world();
    fighter.applyHit({ ...AUTOLINK, velocityCarry: { x: 3, y: -1 } });
    expect(release().afterInput).toEqual({ x: 7, y: -5 });
  });

  it('an incoming ordinary hit replaces the pending pull rather than retaining its anchor', () => {
    const { fighter, release } = world();
    fighter.applyHit(AUTOLINK);
    const replacement = { ...AUTOLINK, autolink: undefined,
      knockback: { ...AUTOLINK.knockback, reference: { base: 50, growth: 0, angle: 45 } } };
    const launch = fighter.applyHit(replacement);
    const released = release().afterInput;
    expect(released.x).toBeCloseTo(launch.vector.x, 10);
    expect(released.y).toBeCloseTo(launch.vector.y, 10);
  });

  it.each(['capture', 'round reset'] as const)('%s clears a queued pull before the next motion owner', interruption => {
    const { fighter, scene, step, release } = world();
    fighter.applyHit(AUTOLINK);
    if (interruption === 'capture') {
      fighter.applyGrabbed(new DonkeyKong(scene, { spawnX: 10000, spawnY: 0 }));
      expect(fighter.getHitlagRemaining()).toBe(0);
      fighter.releaseFromGrab();
    } else fighter.resetForRound(0, 0);
    for (let frame = 0; frame < 8; frame++) step();
    expect(fighter.getHitlagRemaining()).toBe(0);
    expect(fighter.getVelocity().x).toBeCloseTo(0, 10);
    const launch = fighter.applyHit({ ...AUTOLINK, autolink: undefined,
      knockback: { ...AUTOLINK.knockback, reference: { base: 50, growth: 0, angle: 45 } } });
    const released = release().afterInput;
    expect(released.x).toBeCloseTo(launch.vector.x, 10);
    expect(released.y).toBeCloseTo(launch.vector.y, 10);
  });
});
