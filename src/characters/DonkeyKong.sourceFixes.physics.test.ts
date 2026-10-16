/**
 * Donkey Kong — source-audit fixes (2026-10-11) on a real Matter world:
 * cargo walk ×1.1, throw invincibility, cargo-throw knockback armor, Hand Slap
 * mash repeats, ledge-attack root motion and ledge regrab penalties.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DonkeyKong, DONKEYKONG_DOWN_SPECIAL, DONKEYKONG_MOVEMENT_PROFILE } from './DonkeyKong';
import { Pikachu } from './Pikachu';
import type { CharacterInput } from './Character';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { coordinateCaptureAttachments } from './captureAttachmentCoordinator';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { GAME_CONFIG } from '../engine/constants';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION } from './donkeykongLedgeRootMotion';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function scene() {
  const engine = Engine.create(); engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const s: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, o: object) {
    const b = Bodies.rectangle(x, y, w, h, o); Composite.add(engine.world, b); return b; } },
  world: { on(n: string, f: any) { Events.on(engine, names[n] ?? n, f); }, off(n: string, f: any) { Events.off(engine, names[n] ?? n, f); },
    remove(b: any) { Composite.remove(engine.world, b); } } } };
  return { engine, scene: s };
}

/** DK grabs a Pikachu on a wide floor (top y = 42). */
function grabFixture(facing: 1 | -1 = 1) {
  const { engine, scene: s } = scene();
  const dk = new DonkeyKong(s, { spawnX: 0, spawnY: 0 }), victim = new Pikachu(s, { spawnX: 55 * facing, spawnY: 17 });
  dk.setFacing(facing); victim.setFacing((-facing) as 1 | -1);
  Composite.add(engine.world, Bodies.rectangle(0, 52, 4000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const fighters = [dk, victim];
  const handler = new HitboxDamageHandler((index, hit, context) => {
    if (context.kind === 'grab') { dk.resolveGrabConnect(victim); return { confirmed: victim.getGrabbedBy() === dk }; }
    return { confirmed: fighters[index]!.applyHitDetailed(hit).outcome === 'landed' };
  });
  handler.registerPlayer(0, dk.body); handler.registerPlayer(1, victim.body); handler.setFacingLookup(i => fighters[i]!.getFacing());
  handler.setGroundedLookup(i => fighters[i]!.isGrounded()); handler.setHurtboxLookup(i => fighters[i]!.getActiveHurtboxes());
  for (const n of ['collisionStart', 'collisionActive']) Events.on(engine, n, (e: any) => handler.handleCollisionStart(e));
  let frame = 0;
  const step = (input: Partial<CharacterInput> = {}) => {
    frame += 1;
    dk.applyInput({ ...NEUTRAL, ...input }, frame); victim.applyInput(NEUTRAL, frame);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body,
      deltaMs: GAME_CONFIG.fixedTimestepMs, stepWorld: d => Engine.update(engine, d), afterSubstep: () => coordinateCaptureAttachments(fighters) });
    handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
  };
  dk.setInvincibility(0); victim.setInvincibility(0);
  for (let i = 0; i < 20; i++) step();
  dk.setFacing(facing);
  const capture = () => {
    step({ grab: true });
    for (let n = 0; n < 18 && !victim.isGrabbed(); n++) step();
    expect(victim.getGrabbedBy()).toBe(dk);
  };
  return { dk, victim, step, capture };
}

describe('DK source fixes (Matter) — cargo and throws', () => {
  it('M3 carrying walks 1.1× as fast as ordinary walking at the same stick', () => {
    const peak = (cargo: boolean) => {
      const f = grabFixture(1);
      if (cargo) { f.capture(); f.step({ attack: true, moveX: 1 }); for (let i = 0; i < 30; i++) f.step(); }
      let top = 0;
      for (let i = 0; i < 40; i++) { f.step({ moveX: 0.6 }); top = Math.max(top, Math.abs(f.dk.getVelocity().x)); }
      if (cargo) expect(f.dk.getGrabState().active?.cargo).toBe(true);
      return top;
    };
    const walk = peak(false), carry = peak(true);
    expect(walk).toBeGreaterThan(1);
    expect(carry / walk).toBeCloseTo(1.1, 3);
  });

  it('M15 cargo entry is invincible for exactly 15 steps from the forward press', () => {
    const f = grabFixture(1);
    f.capture();
    const invincible: boolean[] = [];
    for (let i = 0; i < 20; i++) { f.step(i === 0 ? { attack: true, moveX: 1 } : {}); invincible.push(f.dk.isInvincible()); }
    expect(invincible.indexOf(false)).toBe(15);
    expect(invincible.slice(0, 15).every(Boolean)).toBe(true);
  });

  it.each([['back', { attack: true, moveX: -1 }, 15], ['up', { attack: true, moveY: -1 }, 14], ['down', { attack: true, moveY: 1 }, 19]] as const)(
    'M14 %s throw is invincible through its throw frame (%i steps)', (_name, input, frames) => {
      const f = grabFixture(1);
      f.capture();
      const invincible: boolean[] = [];
      for (let i = 0; i < 30; i++) { f.step(i === 0 ? input : {}); invincible.push(f.dk.isThrowInvincible()); }
      expect(invincible.indexOf(false)).toBe(frames);
      expect(invincible.slice(frames).some(Boolean)).toBe(false);
    });

  const weak = { damage: 1, facing: 1 as const, hitlagMultiplier: 1, knockback: { x: 1, y: -1, scaling: 0, reference: { base: 5, growth: 10, angle: 45 } } };
  const strong = { damage: 12, facing: 1 as const, hitlagMultiplier: 1, knockback: { x: 1, y: -1, scaling: 0, reference: { base: 60, growth: 100, angle: 45 } } };
  it('M16 a cargo throw resists knockback up to 16 units before release; stronger hits still launch', () => {
    const cargoThrow = () => {
      const f = grabFixture(1);
      f.capture(); f.step({ attack: true, moveX: 1 }); for (let i = 0; i < 30; i++) f.step();
      f.step({ attack: true, moveX: 1 }); f.step();
      expect(f.dk.getGrabState().name).toBe('throwing');
      return f;
    };
    const resisted = cargoThrow();
    const before = resisted.dk.getDamagePercent();
    const soft = resisted.dk.applyHitDetailed(weak);
    expect(soft.reactionResisted).toBe(true);
    expect(soft.knockback.magnitude).toBe(0);
    expect(resisted.dk.getDamagePercent()).toBeGreaterThan(before);
    expect(resisted.dk.getGrabState().name).toBe('throwing');
    const launched = cargoThrow();
    const hard = launched.dk.applyHitDetailed(strong);
    expect(hard.reactionResisted).toBeUndefined();
    expect(hard.knockback.magnitude).toBeGreaterThan(0);
    expect(launched.victim.isGrabbed()).toBe(false);
  });

  it('M16 an ordinary (non-cargo) throw has no knockback armor', () => {
    const f = grabFixture(1);
    f.capture(); f.step({ attack: true, moveX: -1 });
    for (let i = 0; i < 16; i++) f.step();
    expect(f.dk.getGrabState().name).not.toBe('throwing');
  });
});

describe('DK source fixes (Matter) — Hand Slap mash', () => {
  /** Rewinds after one special press on the step whose attack age becomes `elapsed`. */
  const rewindsAfterPressAt = (elapsed: number): number => {
    const { engine, scene: s } = scene();
    const dk = new DonkeyKong(s, { spawnX: 0, spawnY: 0 });
    Composite.add(engine.world, Bodies.rectangle(0, 52, 4000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    const step = (input: CharacterInput) => { dk.applyInput(input); stepCharacterPhysics({ characters: [dk],
      bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body, deltaMs: 1000 / 60,
      stepWorld: d => Engine.update(engine, d) }); };
    for (let i = 0; i < 12; i++) step(NEUTRAL);
    step({ ...NEUTRAL, special: true, moveY: 1 });
    expect(dk.getActiveAttack()?.move.id).toBe(DONKEYKONG_DOWN_SPECIAL.id);
    let rewinds = 0, previous = dk.getActiveAttack()!.framesElapsed, pressed = false;
    for (let i = 0; i < 120 && dk.getActiveAttack(); i++) {
      const press = !pressed && i > 0 && (dk.getActiveAttack()?.framesElapsed ?? -2) + 1 === elapsed;
      if (press) pressed = true;
      step(press ? { ...NEUTRAL, special: true, moveY: 1 } : { ...NEUTRAL, moveY: 1 });
      const a = dk.getActiveAttack();
      if (a && a.framesElapsed < previous) rewinds += 1;
      previous = a?.framesElapsed ?? previous;
    }
    expect(pressed).toBe(true);
    return rewinds;
  };

  it('M11 presses register from the startup through the loop; loop frames 20–26 repeat twice', () => {
    expect([2, 6, 12, 25].map(rewindsAfterPressAt)).toEqual([1, 1, 1, 1]);
    expect([26, 32].map(rewindsAfterPressAt)).toEqual([2, 2]);
  });
});

describe('DK source fixes (Matter) — ledge', () => {
  function ledgeFixture(facing: 1 | -1) {
    const { engine, scene: s } = scene();
    const corner = { platformId: 'floor', side: facing === 1 ? 'left' as const : 'right' as const, x: facing === 1 ? -300 : 300, y: 90 };
    Composite.add(engine.world, Bodies.rectangle(0, 100, 600, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
      plugin: { platformId: 'floor' }, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    const dk = new DonkeyKong(s, { spawnX: corner.x - 20 * facing, spawnY: 130 });
    dk.setFacing(facing); dk.setLedgeCandidates([corner]); dk.setInvincibility(0);
    Body.setVelocity(dk.body, { x: 0, y: 1 });
    const step = (input: Partial<CharacterInput> = {}) => { dk.applyInput({ ...NEUTRAL, ...input }); stepCharacterPhysics({ characters: [dk],
      bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: d => Engine.update(engine, d) }); };
    for (let i = 0; i < 40 && dk.getLedgeHangState().name !== 'hanging'; i++) step();
    expect(dk.getLedgeHangState().name).toBe('hanging');
    for (let i = 0; i < 30; i++) step();
    return { dk, step, corner };
  }

  /** Drop, air-jump through the regrab cooldown, then re-place the body (Matter only, no state reset) and catch again. */
  function regrabTo(f: ReturnType<typeof ledgeFixture>, facing: 1 | -1, grabs: number) {
    while (f.dk.getLedgeHangState().ledgeGrabsSinceGround < grabs) {
      f.step({ moveY: 1 }); for (let i = 0; i < 3; i++) f.step();
      for (let i = 0; i < 3; i++) f.step({ jump: true }); for (let i = 0; i < 26; i++) f.step();
      Body.setPosition(f.dk.body, { x: f.corner.x - 20 * facing, y: 130 }); Body.setVelocity(f.dk.body, { x: 0, y: 1 });
      for (let i = 0; i < 60 && f.dk.getLedgeHangState().name !== 'hanging'; i++) f.step({ moveX: facing });
      expect(f.dk.getLedgeHangState().name).toBe('hanging');
      for (let i = 0; i < 32; i++) f.step();
    }
  }

  it.each([[1, 25], [2, 20], [3, 12], [4, 0]] as const)('M32 ledge attack on catch %i is invincible for %i ages (SmashWiki DK/Edge_attack)', (grabs, frames) => {
    const f = ledgeFixture(1);
    regrabTo(f, 1, grabs);
    expect(f.dk.getLedgeHangState().ledgeGrabsSinceGround).toBe(grabs);
    f.step({ attack: true });
    const protectedAges: boolean[] = [];
    for (let age = 0; age < 30; age++) {
      if (age > 0) f.step();
      expect(f.dk.getActiveAttack()?.framesElapsed).toBe(age);
      protectedAges.push(f.dk.isInvincible());
    }
    expect(protectedAges.indexOf(false)).toBe(frames === 0 ? 0 : frames);
    expect(protectedAges.slice(0, frames).every(Boolean)).toBe(true);
  });

  it.each([1, -1] as const)('ledge attack climbs onto the stage along the native CliffAttack root (facing %i)', facing => {
    const { dk, step, corner } = ledgeFixture(facing);
    step({ attack: true });
    expect(dk.getActiveAttack()?.move.id).toBe('donkeykong.ledgeAttack');
    for (let age = 0; age < 55; age++) {
      if (age > 0) step();
      expect(dk.getActiveAttack()?.framesElapsed).toBe(age);
      const point = DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION[age]!;
      expect(dk.getPosition().x).toBeCloseTo(corner.x + point.x * facing, 0);
      expect(dk.getPosition().y).toBeCloseTo(corner.y - 42 + point.y, 0);
    }
    expect(dk.isGrounded()).toBe(true);
    step();
    expect(dk.getActiveAttack()).toBeNull();
    expect(dk.getPosition().y).toBeCloseTo(corner.y - 42, 0);
  });

  it('the ledge attack root starts at the hang depth on the native x and ends standing 85 px inside the corner', () => {
    expect(DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION).toHaveLength(55);
    expect(DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION[0]!.x).toBeCloseTo(5 * -3.6199, 6);
    expect(DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION[0]!.y).toBe(84);
    expect(DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION[16]).toEqual({ x: 5 * 3.5021, y: 0 });
    expect(DONKEYKONG_LEDGE_ATTACK_ROOT_MOTION[54]!.x).toBeCloseTo(5 * 16.9964, 6);
    // First-grab protection is the sourced 25 whole-body frames (ages 0–24).
    const { dk, step } = ledgeFixture(1);
    step({ attack: true });
    const intangible: boolean[] = [];
    for (let age = 0; age < 30; age++) { if (age > 0) step(); intangible.push(dk.isInvincible()); }
    expect(intangible.indexOf(false)).toBe(25);
    expect(DONKEYKONG_MOVEMENT_PROFILE.ledge!.attackIframes).toBe(0);
  });
});
