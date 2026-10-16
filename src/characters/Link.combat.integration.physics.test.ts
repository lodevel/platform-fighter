import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_FAIR, LINK_NAIR } from './Link';
import { LINK_ATTACK_DATA } from './linkAttackData';
import type { CharacterInput } from './Character';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { stepCharacterPhysics } from './stepCharacterPhysics';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
// Strike roles of the multi-hit moves (linkNormalRules); damage per strike is the packet of the hitbox
// that connected (context.collisionHitId), from linkAttackData.json (SmashWiki Link (SSBU) pages:
// fair 8 / 10, bair 5 / 7, up smash 4 / 3 / 11 with 10 and 9 on the lower hitboxes).
const STRIKE_ROLES = { 'link.fair': ['Hit 1', 'Hit 2'], 'link.bair': ['Hit 1', 'Hit 2'],
  'link.usmash': ['Clean hit 1', 'Clean hit 2', 'Hit 3'] } as const;
const strikeDamages = (move: keyof typeof STRIKE_ROLES, struck: ReadonlyArray<{ id: number }>) =>
  struck.map((hit, index) => LINK_ATTACK_DATA.normals[move]!.phases[STRIKE_ROLES[move][index]!]!
    .packets.find(packet => packet.id === hit.id)!.damage);
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

/** Both combatants integrate real gravity, launch decay and mutual hitlag. */
function setup(move: string, options: { percent?: number; launchY?: number; facing?: 1 | -1; distance?: number; mass?: number } = {}) {
  const { percent = 0, launchY = 0, facing = 1, distance = 40, mass = 12 } = options;
  const engine = Engine.create();
  const eventNames: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, options: object) {
      const body = Bodies.rectangle(x, y, w, h, options);
      Composite.add(engine.world, body); return body;
    },
  }, world: {
    on(event: string, listener: (...args: any[]) => void) { Events.on(engine, eventNames[event] ?? event, listener); },
    off(event: string, listener: (...args: any[]) => void) { Events.off(engine, eventNames[event] ?? event, listener); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const attacker = new Link(scene, { spawnX: 0, spawnY: 0 });
  attacker.setFacing(facing);
  const defender = new Link(scene, { spawnX: (move === 'link.bair' ? -distance : distance) * facing,
    spawnY: 0, mass });
  defender.setDamagePercent(percent);
  const fighters = [attacker, defender];
  const hits: Array<{ id: number; autolink: boolean; frame: number; damage: number; hitstun: number; distanceY: number; vx: number; vy: number;
    target: number }> = [];
  const handler = new HitboxDamageHandler((index, hit, context) => {
    const victim = fighters[index]!;
    const result = victim.applyHitDetailed(hit);
    if (result.outcome !== 'landed') return { confirmed: false };
    attacker.armAttackerHitlag(victim.getHitlagRemaining());
    hits.push({ id: context.collisionHitId!, autolink: hit.autolink !== undefined, frame: attacker.getActiveAttack()?.framesElapsed ?? -1, damage: result.damageApplied,
      hitstun: result.knockback.hitstunFrames,
      distanceY: victim.getPosition().y - attacker.getPosition().y,
      vx: result.knockback.vector.x, vy: result.knockback.vector.y,
      target: index });
    return { confirmed: true };
  });
  handler.registerPlayer(0, attacker.body); handler.registerPlayer(1, defender.body);
  handler.setGroundedLookup(index => fighters[index]!.isGrounded());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (attackerInput = neutral, defenderInput = neutral) => {
    fighters.forEach((fighter, index) => fighter.applyInput(index === 0 ? attackerInput : defenderInput));
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: 1000 / 60,
      stepWorld: delta => Engine.update(engine, delta) });
  };
  if (move === 'link.usmash') {
    Composite.add(engine.world, Bodies.rectangle(0, 48, 1600, 20, { isStatic: true,
      label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    for (let i = 0; i < 10; i++) step();
  } else {
    Body.setVelocity(attacker.body, { x: 0, y: launchY });
    Body.setVelocity(defender.body, { x: 0, y: launchY });
  }
  const addDefender = () => {
    const index = fighters.length;
    const victim = new Link(scene, { spawnX: defender.getPosition().x,
      spawnY: defender.getPosition().y });
    fighters.push(victim); handler.registerPlayer(index, victim.body); return victim;
  };
  return { attacker, defender, step, hits, addDefender };
}

describe('Link multi-hit conversions against launched fighters', () => {
  it.each([
    ['link.fair', 0], ['link.bair', -8], ['link.usmash', 0],
  ] as const)('%s reaches its finisher in its measured approach at ordinary percents', (move, launchY) => {
    for (const percent of [0, 50, 100, 150]) {
      // Bair's sourced fixed launch links during this rising approach. It no
      // longer promises a connection while Link falls below the victim.
      const { attacker, step, hits } = setup(move, { percent, launchY });
      if (move === 'link.bair') step({ ...neutral, moveX: -1, attack: true });
      else expect(attacker.attemptAttack(move)).toBe(true);
      for (let frame = 0; frame < 130; frame++) step();
      expect(hits, `${move} at ${percent}%`).toHaveLength(STRIKE_ROLES[move].length);
      expect(hits.map(hit => hit.damage), `${move} at ${percent}%`).toEqual(strikeDamages(move, hits));
    }
  });
  it.each([
    ['link.fair', 0], ['link.bair', -8], ['link.usmash', 0],
  ] as const)('%s does not grant a fresh jump or dodge before its connected next strike', (move, launchY) => {
    for (const defense of ['jump', 'dodge'] as const) {
      const { attacker, defender, step, hits } = setup(move, { launchY });
      if (move === 'link.bair') step({ ...neutral, moveX: -1, attack: true });
      else attacker.attemptAttack(move);
      for (let frame = 0; frame < 100; frame++) {
        step(neutral, { ...neutral, [defense]: hits.length > 0 && frame % 2 === 0 });
        if (hits.length > 0 && hits.length < STRIKE_ROLES[move].length) {
          // Being lifted from the floor consumes the grounded-jump slot;
          // it must not spend the remaining air jump or start jump squat.
          expect(defender.getJumpsUsed()).toBeLessThanOrEqual(move === 'link.usmash' ? 1 : 0);
          expect(defender.getJumpsquatRemaining()).toBe(0);
        }
      }
      expect(hits, defense).toHaveLength(STRIKE_ROLES[move].length);
      expect(hits.map(hit => hit.damage), defense).toEqual(strikeDamages(move, hits));
    }
  });

  it('falling bair can miss its second kick and releases the victim after its ordinary fixed hitstun', () => {
    for (const percent of [0, 100]) {
      const { defender, step, hits } = setup('link.bair', { percent });
      step({ ...neutral, moveX: -1, attack: true });
      for (let frame = 0; frame < 65; frame++) {
        step(neutral, { ...neutral, jump: hits.length > 0 && frame % 2 === 0 });
      }
      expect(hits.map(hit => hit.damage), `${percent}% falling approach`).toEqual([5]);
      // Fixed knockback FKB 36 (bair hit 1, linkAttackData): kb = (1 + 36 / 2) * 1.4 + 18, hitstun floor(kb * 0.4) - 1.
      const fixed = LINK_ATTACK_DATA.normals['link.bair']!.phases['Hit 1']!.packets.find(packet => packet.id === hits[0]!.id)!.fkb;
      expect(hits[0]!.hitstun).toBe(Math.floor(((1 + fixed / 2) * 1.4 + 18) * 0.4) - 1);
      expect(defender.getJumpsUsed()).toBeGreaterThan(0);
    }
  });

  it.each([-18, -10, 0, 8])('fair links a neutral opponent while moving vertically at %s px/step', launchY => {
    for (const facing of [-1, 1] as const) for (const mass of [8, 12, 20]) {
      const { attacker, step, hits } = setup('link.fair', { launchY, facing, mass });
      attacker.attemptAttack('link.fair');
      for (let frame = 0; frame < 70; frame++) step();
      expect(hits, `facing ${facing}, mass ${mass}`).toHaveLength(2);
      expect(hits.map(hit => hit.damage), `facing ${facing}, mass ${mass}`).toEqual(strikeDamages('link.fair', hits));
      // The legacy velocity carry is replaced by the angle-367 autolink on the airborne first hit only.
      expect(hits[0]!.autolink).toBe(true);
      expect(hits[1]!.autolink).toBe(false);
      expect(Math.sign(hits[1]!.vx)).toBe(facing);
    }
  });

  it('one fair links multiple opponents', () => {
    const { attacker, step, hits, addDefender } = setup('link.fair');
    addDefender(); attacker.attemptAttack('link.fair');
    for (let frame = 0; frame < 60; frame++) step();
    const first = hits.filter(hit => hit.autolink);
    expect(first).toHaveLength(2);
    for (const index of [1, 2]) {
      const struck = hits.filter(hit => hit.target === index);
      expect(struck).toHaveLength(2);
      expect(struck.map(hit => hit.damage)).toEqual(strikeDamages('link.fair', struck));
    }
  });

  it.each([-1, 1] as const)('forward input dispatches fair and links with horizontal drift when facing %s', facing => {
    const { attacker, step, hits } = setup('link.fair', { facing });
    const drift = { ...neutral, moveX: facing * 0.75 };
    step({ ...drift, attack: true }, drift);
    expect(attacker.getActiveAttack()?.move.id).toBe('link.fair');
    for (let frame = 0; frame < 60; frame++) step(drift, drift);
    expect(hits).toHaveLength(2);
    expect(hits.map(hit => hit.damage)).toEqual(strikeDamages('link.fair', hits));
    expect(hits[0]!.autolink).toBe(true);
  });

  // SmashWiki Autolink_angle, 367 (Ultimate): launch speed is "the attacker's momentum, plus 20% of the
  // difference" between hitbox and opponent, computed after hitlag ends. SDI during hit 1's hitlag only
  // lengthens that pull (unlike 365, which ignores position and can be SDI'd out), so fair still links.
  it('outward SDI at the end of fair range does not escape the angle-367 pull into hit 2', () => {
    const run = (sdi: boolean) => {
      // Source top-bone capsules now reach to x=110; place the full hurtbox
      // near that rounded edge instead of the former narrow rectangle edge.
      const { attacker, defender, step, hits } = setup('link.fair', { distance: 128 });
      attacker.attemptAttack('link.fair');
      for (let frame = 0; frame < 60; frame++) {
        step(neutral, { ...neutral, moveX: sdi && defender.getHitlagRemaining() > 0 && frame % 2 === 0 ? 1 : 0 });
      }
      return hits.map(hit => hit.damage);
    };
    expect(run(false)).toEqual([8, 10]);
    expect(run(true)).toEqual(run(false));
  });

  it('fair keeps a grounded target on its ordinary launch instead of carrying it down through the floor', () => {
    const { attacker, defender, step, hits } = setup('link.usmash');
    attacker.setPosition(0, -72);
    attacker.attemptAttack('link.fair');
    for (let frame = 0; frame < 40 && !hits.length; frame++) step();
    expect(hits[0]?.damage).toBe(8);
    expect(hits[0]?.autolink).toBe(false);
    while (defender.getHitlagRemaining() > 0) step();
    expect(defender.getVelocity().y).toBeLessThan(0);
  });

  it('a finisher and an unrelated aerial do not acquire an autolink or the linking lockout', () => {
    const { attacker, defender, step, hits } = setup('link.nair', { distance: 15 });
    attacker.attemptAttack('link.nair');
    for (let frame = 0; frame < 12 && !hits.length; frame++) step();
    expect(hits).toHaveLength(1);
    expect(hits[0]!.autolink).toBe(false);
    // Fresh early nair at 0%: reference KB 49.813725 gives 18 ordinary frames,
    // below tumble/speed-up eligibility and without an added linking floor.
    expect(hits[0]!.hitstun).toBe(18);
    while (defender.getHitlagRemaining()) step();
    expect(defender.getVelocity().y).toBeLessThan(0);
    expect(attacker.getVelocity().y).toBeGreaterThan(0);
    expect(LINK_NAIR.minHitstunFrames).toBeUndefined();
    expect(LINK_FAIR.hitWindows![1]!.minHitstunFrames).toBeUndefined();
  });

  it('DI and decay change the launch independently of carried motion, and reset removes both', () => {
    const ordinary = setup('link.fair');
    const carried = setup('link.fair');
    const hit = { damage: 12, knockback: { x: 12, y: -12, scaling: 0 }, facing: 1 as const };
    ordinary.defender.applyHit(hit);
    carried.defender.applyHit({ ...hit, velocityCarry: { x: 5, y: -3 } });
    const di = { ...neutral, moveX: Math.SQRT1_2, moveY: Math.SQRT1_2 };
    while (ordinary.defender.getHitlagRemaining() > 0) {
      ordinary.step(neutral, di); carried.step(neutral, di);
    }
    expect(ordinary.defender.isTumbling()).toBe(true);
    expect(carried.defender.isTumbling()).toBe(true);
    expect(ordinary.defender.getVelocity().x).not.toBeCloseTo(12);
    for (let frame = 0; frame < 5; frame++) {
      expect(carried.defender.getVelocity().x - ordinary.defender.getVelocity().x).toBeCloseTo(5, 8);
      expect(carried.defender.getVelocity().y - ordinary.defender.getVelocity().y).toBeCloseTo(-3, 8);
      ordinary.step(); carried.step();
    }
    ordinary.defender.resetForRound(0, -100); carried.defender.resetForRound(0, -100);
    ordinary.step(); carried.step();
    expect(carried.defender.getVelocity()).toEqual(ordinary.defender.getVelocity());
  });
});
