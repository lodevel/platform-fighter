import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_SIDE_SPECIAL } from './Link';
import type { CharacterInput } from './Character';
import type { HitInfo } from './combat';
import { HITBOX_LABEL } from './attacks';
import { HitboxDamageHandler, type HitContext } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { selectLinkBowVolley } from './linkBow';
import { LINK_ATTACK_DATA, linkGeometryCapsule } from './linkAttackData';
import { itemExplosionHit } from '../items/BobOmb';
import { LINK_REMOTE_BOMB_ITEM_DEFINITION } from '../items/LinkRemoteBombItem';
import { advanceBoomerang, reflectProjectile, type BoomerangFlight } from './projectileMotion';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const UP: CharacterInput = { ...NEUTRAL, special: true, moveY: -1 };

function fixture(grounded = true) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, options: object) {
      const body = Bodies.rectangle(x, y, width, height, options);
      Composite.add(engine.world, body); return body;
    },
  }, world: {
    on(name: string, callback: (...args: any[]) => void) { Events.on(engine, names[name] ?? name, callback); },
    off(name: string, callback: (...args: any[]) => void) { Events.off(engine, names[name] ?? name, callback); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const attacker = new Link(scene, { spawnX: 0, spawnY: 0 });
  const target = new Link(scene, { spawnX: 5000, spawnY: 0 });
  const fighters = [attacker, target];
  const hits: Array<{ frame: number; hit: HitInfo; context: HitContext; kb: number | undefined }> = [];
  const handler = new HitboxDamageHandler((index, hit, context) => {
    const victim = fighters[index]!;
    const outcome = victim.applyHitDetailed(hit);
    if (outcome.outcome !== 'landed') return { confirmed: false };
    hits.push({ frame: attacker.getActiveAttack()?.framesElapsed ?? -1, hit, context,
      kb: outcome.knockback.referenceKnockback });
    if (!context.projectile) attacker.armAttackerHitlag(victim.getHitlagRemaining());
    return { confirmed: true };
  });
  fighters.forEach((fighter, index) => handler.registerPlayer(index, fighter.body));
  handler.setGroundedLookup(index => fighters[index]!.isGrounded());
  handler.setHurtboxLookup(index => fighters[index]!.getActiveHurtboxes());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (input: CharacterInput = NEUTRAL) => {
    attacker.applyInput(input); target.applyInput(NEUTRAL);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: 1000 / 60,
      stepWorld: delta => Engine.update(engine, delta) });
    // MatchScene samples posed hurtboxes after physics: owner-anchored (source) sensors resolve only there.
    handler.sampleHurtboxContacts(Composite.allBodies(engine.world));
  };
  const frames = (count: number, input = NEUTRAL) => { for (let i = 0; i < count; i++) step(input); };
  if (grounded) {
    Composite.add(engine.world, Bodies.rectangle(0, 48, 1600, 20, { isStatic: true,
      label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    attacker.setLedgeCandidates([{ platformId: 'floor', side: 'left', x: -800, y: 38 },
      { platformId: 'floor', side: 'right', x: 800, y: 38 }]);
    frames(20);
  }
  const stageTarget = (x: number, y: number, percent = 100) => {
    target.resetForRound(x, y); target.setDamagePercent(percent);
  };
  return { attacker, target, engine, hits, step, frames, stageTarget };
}

/** Centre of the Spin blade capsule live at `age` (fighter-local, facing right): the posed native
 * geometry of A1/A2 (linkAttackGeometry.json), where the target is staged so the strike lands. */
function strikeCentre(variant: 'ground' | 'air', age: number) {
  const phase = LINK_ATTACK_DATA.spin[variant].phases.find(p => age + 1 >= p.active[0] && age + 1 <= p.active[1])!;
  const packet = phase.packets[0]!, capsule = linkGeometryCapsule(`link.spin.${variant}`, age, phase.role, packet.id);
  return { x: (capsule.start.x + capsule.end.x) / 2, y: (capsule.start.y + capsule.end.y) / 2, lr: packet.lr };
}

// Independent arithmetic from the pinned calculator formula. Fixtures do not
// apply the MatchScene stale/rage modifiers: this measures authored delivery.
function ordinaryKb(damage: number, base: number, growth: number, percent = 100) {
  const post = percent + damage;
  return ((post / 10 + post * damage / 20) * 1.4 * 200 / 204 + 18) * growth / 100 + base;
}

describe('Link sourced special payloads through actual Matter contacts', () => {
  const phases = [
    { frame: 6, damage: 14, base: 60, growth: 88, angle: 45, hitlag: 1.4 },
    { frame: 8, damage: 12, base: 52, growth: 88, angle: 43, hitlag: 1 },
    { frame: 13, damage: 9, base: 48, growth: 84, angle: 43, hitlag: 1 },
    { frame: 23, damage: 7, base: 20, growth: 82, angle: 361, hitlag: 1 },
  ];
  // Fresh Spin times its swing from the release: elapsed N of a tapped spin is release age N - 3.
  const releaseAge = (elapsed: number) => elapsed - 3;
  for (const held of [0, 30, 60]) for (const phase of phases) {
    it(`delivers ground Spin frame${phase.frame}, charge${held} with its own unchanged launch record`, () => {
      const f = fixture();
      f.step(UP);
      if (held > 0) f.frames(3 + held, UP);
      if (held !== 60) f.step();
      expect(f.attacker.getLinkSpinState()?.chargeFrames).toBe(held);
      const swing = () => { const spin = f.attacker.getLinkSpinState()!; return spin.phase === 'ground-release' ? spin.age : -1; };
      while (swing() < releaseAge(phase.frame) - 1) f.step();
      const position = f.attacker.getPosition(), centre = strikeCentre('ground', releaseAge(phase.frame));
      // The grounded Spin launches by position (source LR_POS), independently of the attack facing.
      f.stageTarget(position.x + centre.x, position.y + centre.y);
      f.step();
      expect(f.hits).toHaveLength(1);
      const actual = f.hits[0]!;
      const damage = phase.damage * (1 + 0.6 * held / 60);
      expect(actual.frame).toBe(releaseAge(phase.frame));
      expect(actual.hit.damage).toBeCloseTo(damage, 10);
      expect(actual.hit).toMatchObject({ facing: centre.x < 0 ? -1 : 1, hitlagMultiplier: phase.hitlag, sdiMultiplier: 1,
        knockback: { reference: { base: phase.base, growth: phase.growth, angle: phase.angle } } });
      expect(actual.kb).toBeCloseTo(ordinaryKb(damage, phase.base, phase.growth), 10);
    });
  }

  it.each([
    { frame: 21, damage: 2, base: 0, growth: 100, angle: 83, fixed: 71 },
    { frame: 30, damage: 2, base: 0, growth: 100, angle: 69, fixed: 62 },
    { frame: 46, damage: 4, base: 30, growth: 200, angle: 361, fixed: 0 },
  ])('delivers the supported aerial Spin record at elapsed$frame', source => {
    const f = fixture(false); f.step(UP);
    while (f.attacker.getActiveAttack()!.framesElapsed < source.frame - 1) f.step();
    const p = f.attacker.getPosition(), centre = strikeCentre('air', source.frame); f.stageTarget(p.x + centre.x, p.y + centre.y);
    f.step();
    expect(f.hits).toHaveLength(1);
    const actual = f.hits[0]!;
    expect(actual.hit.damage).toBe(source.damage);
    expect(actual.hit.knockback.reference).toMatchObject({ base: source.base, growth: source.growth, angle: source.angle });
    const kb = source.fixed ? (1 + source.fixed / 2) * 1.4 + 18 : ordinaryKb(4, 30, 200);
    expect(actual.kb).toBeCloseTo(kb, 10);
    expect(actual.hit.hitlagMultiplier).toBe(source.fixed ? 1 : 2);
    expect(actual.hit.sdiMultiplier).toBe(source.fixed ? 0.3 : 1);
    // Fresh Spin is one move id (no per-rung ids), so it stales as itself.
    expect(actual.context.staleMoveId ?? actual.context.moveId).toBe('link.up_special');
    expect(actual.context.attackInstance).toBeDefined();
  });

  it('keeps all nine strike lifetimes and one execution identity', () => {
    const f = fixture(false); f.step(UP);
    const lifetimes: number[][] = [], identities = new Set<object>();
    let previous = false;
    for (let frame = 0; frame < 55; frame++) {
      f.step();
      const live = Composite.allBodies(f.engine.world).filter((body: any) => body.label === HITBOX_LABEL);
      for (const body of live) {
        identities.add(body.plugin.attackInstance);
        expect(body.plugin.moveId).toBe('link.up_special');
        expect(body.plugin.staleMoveId ?? body.plugin.moveId).toBe('link.up_special');
      }
      if (live.length && !previous) lifetimes.push([]);
      if (live.length) lifetimes.at(-1)!.push(f.attacker.getActiveAttack()!.framesElapsed);
      previous = live.length > 0;
    }
    expect(lifetimes).toEqual([
      [7, 8], [11, 12], [15, 16], [18, 19], [21, 22], [25, 26], [30, 31], [37, 38], [46, 47, 48],
    ]);
    expect(identities.size).toBe(1);
    expect([...identities][0]).toBeDefined();
  });

  it.each([-1, 1] as const)('detonates away from the bomb origin on side%s with the source launch', side => {
    // The blast is the generic item explosion (MatchScene): it faces away from its centre.
    const f = fixture();
    f.stageTarget(side * 30, -10);
    const outcome = f.target.applyHitDetailed(itemExplosionHit(LINK_REMOTE_BOMB_ITEM_DEFINITION.explosion!, side));
    expect(outcome.outcome).toBe('landed');
    expect(itemExplosionHit(LINK_REMOTE_BOMB_ITEM_DEFINITION.explosion!, side)).toMatchObject({ damage: 7, facing: side,
      hitlagMultiplier: 0.8, sdiMultiplier: 1, knockback: { reference: { base: 60, growth: 115, angle: 52 } } });
    expect(outcome.knockback.referenceKnockback).toBeCloseTo(ordinaryKb(7, 60, 115), 10);
  });
});

describe('Link projectile release and phase contracts', () => {
  it.each([[0, 4], [18, 6], [36, 12]])('keeps bow reference parameters when charge changes damage at charge%s', (charge, damage) => {
    const [arrow] = selectLinkBowVolley(charge, false);
    expect(arrow!.damage).toBe(damage); // SmashWiki: 4% uncharged, 12% fully charged
    expect(arrow!.referenceKnockback).toEqual({ angle: 361, base: 10, growth: 71, fixed: 0 });
    expect(arrow!.hitlagMultiplier).toBe(0.8);
  });

  it('replaces clean boomerang at article frame10 without permitting a second outbound hit', () => {
    const p = { x: 300, y: 0, vx: 10, vy: 0, facing: 1 as 1 | -1, damage: 8,
      knockback: LINK_SIDE_SPECIAL.knockback };
    const flight: BoomerangFlight = { ...LINK_SIDE_SPECIAL.boomerang, age: 0, returning: false, hitTargets: new Set([1]) };
    for (let i = 0; i < 9; i++) advanceBoomerang(p, flight, { x: 0, y: 0 });
    expect(p.damage).toBe(8); expect(p.knockback.reference).toEqual({ base: 80, growth: 40, angle: 70 });
    advanceBoomerang(p, flight, { x: 0, y: 0 });
    expect(p.damage).toBe(6); expect(p.knockback.reference).toEqual({ base: 60, growth: 40, angle: 65 });
    expect(flight.hitTargets.has(1)).toBe(true);
    while (!flight.returning) advanceBoomerang(p, flight, { x: 0, y: 0 });
    expect(p.damage).toBe(3); expect(p.knockback.reference).toEqual({ base: 50, growth: 40, angle: 70 });
    expect(flight.hitTargets.size).toBe(0); expect(p.facing).toBe(-1);
  });

  it('preserves reflected damage boosts in later phases and starts a new owner execution identity', () => {
    const identity = {};
    const p = { x: 300, y: 0, vx: 10, vy: 0, facing: 1 as 1 | -1, damage: 8,
      ownerSlotIndex: 0, attackInstance: identity, knockback: LINK_SIDE_SPECIAL.knockback,
      boomerang: { ...LINK_SIDE_SPECIAL.boomerang, age: 0, returning: false, hitTargets: new Set<number>() } };
    reflectProjectile(p, 1, 1.5, 1.2);
    expect(p.attackInstance).not.toBe(identity);
    for (let i = 0; i < 10; i++) advanceBoomerang(p, p.boomerang, { x: 0, y: 0 });
    expect(p.damage).toBe(9); expect(p.knockback.reference).toEqual({ base: 60, growth: 40, angle: 65 });
    while (!p.boomerang.returning) advanceBoomerang(p, p.boomerang, { x: 0, y: 0 });
    expect(p.damage).toBe(4.5); expect(p.knockback.reference).toEqual({ base: 50, growth: 40, angle: 70 });
  });
});
