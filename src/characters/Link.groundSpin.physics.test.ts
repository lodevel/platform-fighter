import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_UP_SPECIAL } from './Link';
import type { CharacterInput } from './Character';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { HITBOX_LABEL } from './attacks';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const hold: CharacterInput = { ...neutral, moveY: -1, special: true };

function setup(grounded = true) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, options: object) {
      const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const fighter = new Link(scene, { spawnX: 0, spawnY: 0 });
  const floor = Bodies.rectangle(0, 48, 1600, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
  if (grounded) Composite.add(engine.world, floor);
  const step = (input: CharacterInput = neutral) => {
    fighter.applyInput(input); Engine.update(engine, 1000 / 60); fighter.applyPostPhysicsVelocityConstraints();
  };
  const frames = (count: number, input: CharacterInput = neutral) => { for (let i = 0; i < count; i++) step(input); };
  if (grounded) frames(10);
  const hitboxes = () => Composite.allBodies(engine.world).filter((body: any) => body.label === HITBOX_LABEL);
  return { fighter, engine, floor, step, frames, hitboxes };
}

describe('grounded Spin Attack charge through real input and Matter', () => {
  it('a keyboard Up+B tap keeps the first hit at elapsed six without starting a jump', () => {
    const { fighter, step, hitboxes } = setup();
    step({ ...hold, jump: true });
    expect(fighter.getChargeProgress()).toBe(0);
    for (let elapsed = 1; elapsed < 6; elapsed++) { step(); expect(hitboxes()).toHaveLength(0); }
    step();
    expect(hitboxes()).toHaveLength(1);
    expect(hitboxes()[0].plugin.damage).toBe(14);
    expect(fighter.isGrounded()).toBe(true);
    expect(fighter.getLinkSpinState()).toMatchObject({ phase: 'ground-release', age: 3 });
  });

  it('waits at the charge frame, latches facing, and scales the released hitbox', () => {
    const { fighter, step, frames, hitboxes } = setup();
    step(hold); frames(3, hold); frames(30, { ...hold, moveX: -1 });
    expect(fighter.getChargeProgress()).toBeCloseTo(0.5);
    expect(fighter.getLinkSpinState()?.phase).toBe('ground-hold');
    expect(hitboxes()).toHaveLength(0);
    step();
    expect(fighter.getActiveAttack()).toMatchObject({ facing: 1, framesElapsed: 0 });
    expect(fighter.getLinkSpinState()).toMatchObject({ phase: 'ground-release', chargeFrames: 30 });
    frames(2); expect(hitboxes()).toHaveLength(0);
    step(); expect(hitboxes()[0].plugin.damage).toBeCloseTo(18.2);
    expect(fighter.isGrounded()).toBe(true);
  });

  it('auto-releases after sixty extra frames and does not repeat from a held button', () => {
    const { fighter, step, frames, hitboxes } = setup();
    step(hold); frames(3, hold); frames(60, hold);
    expect(fighter.getLinkSpinState()).toMatchObject({ phase: 'ground-release', age: 0, chargeFrames: 60 });
    frames(3, hold); expect(hitboxes()[0].plugin.damage).toBeCloseTo(22.4);
    frames(100, hold);
    expect(fighter.getActiveAttack()).toBeNull();
    expect(fighter.getAnimationActionState().chargingMove).toBeNull();
  });

  it('adds exactly sixty frames at the charge cap and scales every later strength window', () => {
    const tap = setup(); tap.step(hold);
    let tapElapsed = 0;
    while (tap.hitboxes().length === 0 && tapElapsed < 100) { tap.step(); tapElapsed++; }
    const full = setup(); full.step(hold);
    let fullElapsed = 0;
    while (full.hitboxes().length === 0 && fullElapsed < 100) { full.step(hold); fullElapsed++; }
    expect(tapElapsed).toBe(6);
    expect(fullElapsed - tapElapsed).toBe(60);
    for (const [elapsed, damage] of [[8, 19.2], [13, 14.4], [23, 11.2]] as const) {
      while ((full.fighter.getActiveAttack()?.framesElapsed ?? 0) < elapsed) full.step(hold);
      expect(full.hitboxes()).toHaveLength(1);
      expect(full.hitboxes()[0].plugin.damage).toBeCloseTo(damage);
    }
  });

  it.each([
    { jump: true }, { shield: true }, { dodge: true }, { grab: true },
    { attack: true }, { attackHeavy: true }, { dropThrough: true },
  ])('keeps the charge committed when another action is pressed: %j', extra => {
    const { fighter, step, frames, hitboxes } = setup();
    step(hold); frames(4, hold); step({ ...hold, ...extra }); frames(4, hold);
    expect(fighter.getAnimationActionState().chargingMove?.id).toBe('link.up_special');
    expect(fighter.getLinkSpinState()?.phase).toBe('ground-hold');
    expect(fighter.canAttack()).toBe(false);
    expect(fighter.executeJab()).toBe(false);
    expect(fighter.getShieldState().name).not.toBe('active');
    expect(fighter.isGrabbed()).toBe(false);
    expect(fighter.isGrounded()).toBe(true);
    expect(hitboxes()).toHaveLength(0);
    step();
    expect(fighter.getActiveAttack()?.move.id).toBe('link.up_special');
  });

  it('drops charge on damage and on a vanished support, without spawning an airborne grounded hit', () => {
    const damaged = setup(); damaged.step(hold); damaged.frames(12, hold);
    damaged.fighter.applyHit({ damage: 8, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 });
    expect(damaged.fighter.getAnimationActionState().chargingMove).toBeNull();
    const unsupported = setup(); unsupported.step(hold); unsupported.frames(12, hold);
    Composite.remove(unsupported.engine.world, unsupported.floor);
    unsupported.frames(4, hold);
    expect(unsupported.fighter.getAnimationActionState().chargingMove).toBeNull();
    expect(unsupported.fighter.getActiveAttack()).toBeNull();
    expect(unsupported.hitboxes()).toHaveLength(0);
  });

  it('aerial Up+B starts its recovery immediately while the button remains held', () => {
    const { fighter, step } = setup(false); step(hold);
    expect(fighter.getAnimationActionState().chargingMove).toBeNull();
    expect(fighter.getActiveAttack()?.move).toBe(LINK_UP_SPECIAL);
    expect(fighter.getVelocity().y).toBeLessThan(-10);
  });

  it('saves the complete Spin descriptor', () => {
    const spec = getAuthorableCharacterSpec('link');
    const raw = JSON.parse(JSON.stringify(serializeCharacterDataSpec(spec)));
    expect(parseCharacterDataFile(raw).moves?.upSpecial).toEqual(LINK_UP_SPECIAL);
  });
});
