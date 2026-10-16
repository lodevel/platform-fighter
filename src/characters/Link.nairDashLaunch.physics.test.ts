import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Link, LINK_NAIR, LINK_DASHATTACK } from './Link';
import { LINK_ATTACK_DATA } from './linkAttackData';
import { DonkeyKong } from './DonkeyKong';
import type { Character, CharacterInput } from './Character';
import type { KnockbackResult } from './combat';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { GAME_CONFIG } from '../engine/constants';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { stepCharacterPhysics } from './stepCharacterPhysics';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const Resolver = require('../physics/matter/source/lib/collision/Resolver.js');
const previousThresholds = { normal: Resolver._restingThresh, tangent: Resolver._restingThreshTangent };
beforeAll(() => { Resolver._restingThresh = 4; Resolver._restingThreshTangent = 6; });
afterAll(() => {
  Resolver._restingThresh = previousThresholds.normal;
  Resolver._restingThreshTangent = previousThresholds.tangent;
});

type Vector = { x: number; y: number };
type Scenario = { id: string; move: 'nair' | 'dashAttack'; phase: 'early' | 'late' | 'single'; target: 'link' | 'donkeykong';
  percent: number; facing: 1 | -1; side: 'front' | 'back' };
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const ORIGIN = { x: 720, y: 120 };
const PAD = { center: { x: 0, y: 46 }, width: 40, height: 20 };
// Packet values come from linkAttackData.json (SmashWiki Link (SSBU) neutral aerial and dash
// attack pages: nair clean hit 11% sweetspot / 9%, late hit 6%; dash attack 14/13/12% by hitbox).
// The engine reports which hitbox id connected (context.collisionHitId); that id's packet is the
// expected record. Lowest-overlapping-id priority is pinned in linkAttackGeometry.test.ts.
const PHASE_ROLE = { early: 'Clean hit', late: 'Late hit', single: 'primary' } as const;
const recordOf = (scenario: Scenario, id: number) => {
  const packet = LINK_ATTACK_DATA.normals[`link.${scenario.move}`]!.phases[PHASE_ROLE[scenario.phase]]!
    .packets.find(candidate => candidate.id === id)!;
  return { damage: packet.damage, base: packet.bkb, growth: packet.kbg, angle: packet.angle,
    positionalFacing: packet.lr === 'position' };
};
const relative = (point: Vector) => ({ x: point.x - ORIGIN.x, y: point.y - ORIGIN.y });
const SCENARIOS: Scenario[] = (['early', 'late', 'single'] as const).flatMap(phase =>
  (['link', 'donkeykong'] as const).flatMap(target => [0, 100].map(percent => ({
    id: `${phase === 'single' ? 'dashAttack' : `nair-${phase}`}-${target}-${percent}-front`,
    move: phase === 'single' ? 'dashAttack' as const : 'nair' as const,
    phase, target, percent, facing: 1 as const, side: 'front' as const,
  }))));
SCENARIOS.push({ id: 'nair-early-link-100-back', move: 'nair', phase: 'early',
  target: 'link', percent: 100, facing: 1, side: 'back' });
for (const move of ['nair', 'dashAttack'] as const) {
  SCENARIOS.push({ id: `${move}-link-100-mirrored`, move, phase: move === 'nair' ? 'early' : 'single',
    target: 'link', percent: 100, facing: -1, side: 'front' });
}

function snapshot(fighter: Character) {
  return { position: relative(fighter.getPosition()), velocity: fighter.getVelocity(),
    hitlag: fighter.getHitlagRemaining(), hitstun: fighter.getHitstunRemaining(),
    grounded: fighter.isGrounded(), tumbling: fighter.isTumbling(),
    canUseItemsBeforeInput: fighter.canUseItemsBeforeInput() };
}
type Snapshot = ReturnType<typeof snapshot>;
type Hit = { attackFrame: number; moveId: string; damage: number; launchFacing: 1 | -1;
  launch: KnockbackResult; hitlag: number; attackerGrounded: boolean; targetGrounded: boolean;
  attackerPosition: Vector; targetPosition: Vector; collisionHitId: number };
type Trace = { sinceContact: number; beforeInput: Snapshot; afterInput: Snapshot; afterConstraints: Snapshot };

function measure(scenario: Scenario, releaseInput: CharacterInput = NEUTRAL,
  options: { repeatVictim?: boolean; groundedVictim?: boolean } = {}) {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = GAME_CONFIG.gravity;
  const eventNames: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, settings: object) {
      const body = Bodies.rectangle(x, y, width, height, settings);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, eventNames[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, eventNames[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const attacker = new Link(scene, { spawnX: ORIGIN.x, spawnY: ORIGIN.y });
  const Fighter = scenario.target === 'link' ? Link : DonkeyKong;
  const target = new Fighter(scene, { spawnX: ORIGIN.x + 5000, spawnY: ORIGIN.y });
  const fighters: Character[] = [attacker, target];
  if (scenario.move === 'dashAttack') Composite.add(engine.world, Bodies.rectangle(ORIGIN.x, ORIGIN.y + PAD.center.y, PAD.width, PAD.height, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  }));
  let stepIndex = 0;
  let contactStep = -1;
  const hits: Hit[] = [];
  const trace: Trace[] = [];
  let lateSensorContacts = 0;
  const handler = new HitboxDamageHandler((targetIndex, hit, context) => {
    expect(targetIndex).toBe(1);
    expect(context.attackerPlayerIndex).toBe(0);
    expect(attacker.getDamagePercent()).toBe(0);
    expect(attacker.getStaleOccurrences(context.moveId)).toBe(0);
    const result = target.applyHitDetailed(hit);
    if (result.outcome !== 'landed') return { confirmed: false };
    contactStep = stepIndex;
    hits.push({ attackFrame: attacker.getActiveAttack()?.framesElapsed ?? -1,
      moveId: context.moveId, damage: result.damageApplied, launchFacing: hit.facing,
      launch: result.knockback, hitlag: target.getHitlagRemaining(),
      attackerGrounded: attacker.isGrounded(), targetGrounded: target.isGrounded(),
      attackerPosition: relative(attacker.getPosition()), targetPosition: relative(target.getPosition()), collisionHitId: context.collisionHitId! });
    attacker.registerLandedMove(context.moveId);
    attacker.armAttackerHitlag(target.getHitlagRemaining());
    return { confirmed: true };
  });
  fighters.forEach((fighter, index) => handler.registerPlayer(index, fighter.body));
  handler.setGroundedLookup(index => fighters[index]!.isGrounded());
  handler.setHurtboxLookup(index => fighters[index]!.getActiveHurtboxes());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const witnessLateContact = (event: any) => {
    if (attacker.getActiveAttack()?.framesElapsed! < 8) return;
    for (const pair of event.pairs) {
      if (pair.bodyA === target.body && pair.bodyB.isSensor || pair.bodyB === target.body && pair.bodyA.isSensor) {
        lateSensorContacts++;
      }
    }
  };
  Events.on(engine, 'collisionStart', witnessLateContact);
  Events.on(engine, 'collisionActive', witnessLateContact);
  const step = () => {
    stepIndex++;
    const beforeInput = snapshot(target);
    attacker.applyInput(NEUTRAL);
    target.applyInput(target.getHitlagRemaining() === 1 ? releaseInput : NEUTRAL);
    const afterInput = snapshot(target);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    if (hits.length) trace.push({ sinceContact: stepIndex - contactStep,
      beforeInput, afterInput, afterConstraints: snapshot(target) });
  };
  if (scenario.move === 'dashAttack') {
    for (let frame = 0; frame < 20; frame++) step();
    expect(attacker.isGrounded()).toBe(true);
  }
  if (options.groundedVictim) {
    Composite.add(engine.world, Bodies.rectangle(ORIGIN.x, ORIGIN.y + 56, 400, 20, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    }));
    attacker.resetForRound(ORIGIN.x - 1000, ORIGIN.y);
    target.resetForRound(ORIGIN.x + 130, ORIGIN.y + 10);
    for (let frame = 0; frame < 20; frame++) step();
    expect(target.isGrounded()).toBe(true);
    attacker.resetForRound(ORIGIN.x, ORIGIN.y);
    Body.setVelocity(attacker.body, { x: 0, y: -2 });
  }
  attacker.setFacing(scenario.facing);
  const move = scenario.move === 'nair' ? LINK_NAIR : LINK_DASHATTACK;
  const contactFrame = scenario.phase === 'late' ? 8 : move.startupFrames;
  expect(attacker.attemptAttack(move.id)).toBe(true);
  for (let frame = 0; frame < contactFrame - 1; frame++) step();
  expect(attacker.getActiveAttack()?.framesElapsed).toBe(contactFrame - 1);
  const anchor = attacker.getPosition();
  // Front: just outside the body (capsules 0/1 reach forward). Back: only capsule id 2 sits behind the
  // root (x=-5.4..-8.4, y=+7..+11, radius 15; linkAttackGeometry link.nair ages 6-9), so the victim
  // overlaps it by 12px of body width at that height.
  const offset = scenario.move === 'nair'
    ? scenario.side === 'front'
      ? { x: scenario.facing * (attacker.getTuning().width / 2 + target.getTuning().width / 2 + 1), y: -2 }
      : { x: -scenario.facing * (attacker.getTuning().width / 2 + target.getTuning().width / 2 - 12), y: 8 }
    : { x: scenario.facing * 62, y: -2 };
  if (!options.groundedVictim) target.resetForRound(anchor.x + offset.x, anchor.y + offset.y);
  else Body.setPosition(target.body, { x: anchor.x + offset.x, y: target.getPosition().y });
  target.setDamagePercent(scenario.percent);
  const staged = snapshot(target);
  step();
  expect(hits).toHaveLength(1);
  if (options.repeatVictim) {
    // Keep the victim physically overlapping each sensor replacement. Its public
    // launch state is intact; only Matter position/velocity are constrained here.
    for (let frame = 0; frame < 80 && (attacker.getActiveAttack()?.framesElapsed ?? 31) < 12; frame++) {
      Body.setPosition(target.body, { x: attacker.getPosition().x + offset.x - 20, y: attacker.getPosition().y - 2 });
      Body.setVelocity(target.body, { x: 0, y: 0 });
      step();
    }
    expect(attacker.getActiveAttack()?.framesElapsed).toBe(12);
    expect(lateSensorContacts).toBeGreaterThan(0);
    expect(hits).toHaveLength(1);
    expect(target.getDamagePercent()).toBe(scenario.percent + 11);
  }
  attacker.setPosition(anchor.x - 400, anchor.y);
  let firstActionableAt: number | null = null;
  for (let frame = 0; frame < 250; frame++) {
    step();
    const row = trace.at(-1)!;
    if (firstActionableAt === null && row.beforeInput.canUseItemsBeforeInput) firstActionableAt = row.sinceContact;
    if (firstActionableAt !== null && row.sinceContact >= firstActionableAt + 2) break;
  }
  const releaseAt = trace.find(row => row.beforeInput.hitlag === 1)?.sinceContact;
  expect(releaseAt).toBeDefined();
  expect(firstActionableAt).not.toBeNull();
  const measurement = { scenario, input: releaseInput,
    setup: { worldOrigin: ORIGIN, attackerAnchor: relative(anchor), staged,
      pad: scenario.move === 'dashAttack' ? PAD : null },
    config: { timestepMs: GAME_CONFIG.fixedTimestepMs, gravity: { ...engine.gravity } },
    hits, trace, summary: { releaseAt: releaseAt!, stunEndAt: firstActionableAt! - 1, firstActionableAt: firstActionableAt! } };
  attacker.destroy(); target.destroy(); Engine.clear(engine); Composite.clear(engine.world, false);
  return measurement;
}

/** Independent source reaction-clock recurrence; production uses a geometric shortcut. */
function groupsFor(hitstun: number, tumble: boolean): number[] {
  const faf = hitstun + 1;
  if (!tumble) return Array<number>(faf).fill(1);
  const maxRate = 1 + 5 * Math.min(1, Math.max(0, (faf - 30) / 50));
  const remaining = (start: number) => {
    let clock = start, rate = maxRate, steps = 0;
    while (rate > 1) {
      const ratio = Math.min(1, Math.max(0, (faf * 0.3 - clock) / (faf * 0.3 - faf)));
      rate = ratio * maxRate;
      clock -= Math.max(1, rate);
      steps++;
    }
    return steps + Math.ceil(clock);
  };
  const count = remaining(faf);
  const groups = Array<number>(count).fill(0);
  for (let tick = 0; tick < faf; tick++) groups[count - remaining(faf - tick)]!++;
  return groups;
}

function expectedTrajectory(measurement: ReturnType<typeof measure>) {
  const { scenario, input } = measurement;
  const reference = recordOf(scenario, measurement.hits[0]!.collisionHitId);
  const weight = scenario.target === 'link' ? 104 : 127;
  const gravity = scenario.target === 'link' ? 0.48 : 0.425;
  const fallCap = scenario.target === 'link' ? 8 : 8.15;
  const verticalGravity = scenario.target === 'link' ? 0.38472 : 0.42336;
  const percent = scenario.percent + reference.damage;
  const kb = ((percent / 10 + percent * reference.damage / 20) * 1.4 * 200 / (weight + 100) + 18)
    * reference.growth / 100 + reference.base;
  const ordinaryHitstun = Math.floor(Math.max(5, kb * 0.4)) - 1;
  const tumble = ordinaryHitstun + 1 >= 32;
  const nativeAngle = reference.angle === 361 ? 0.663225 : reference.angle * Math.PI / 180;
  const vertical = tumble && nativeAngle >= 1.22173 && nativeAngle <= 1.91986;
  const launchFacing = reference.positionalFacing
    ? scenario.facing * (scenario.side === 'front' ? 1 : -1) : scenario.facing;
  const queued = { x: kb * 0.15 * Math.cos(nativeAngle) * launchFacing,
    y: -kb * 0.15 * Math.sin(nativeAngle) - (tumble && !vertical ? 5 * (gravity - 0.375) : 0) };
  const stickLength = Math.max(1, Math.hypot(input.moveX, input.moveY ?? 0));
  const sx = input.moveX / stickLength, sy = (input.moveY ?? 0) / stickLength;
  const angle = Math.atan2(queued.y, queued.x);
  const eligible = tumble && Math.atan2(Math.abs(queued.y), Math.abs(queued.x)) >= 0.17;
  const influencedAngle = angle + (eligible ? (sy * Math.cos(angle) - sx * Math.sin(angle)) * 0.17 : 0);
  const degrees = (influencedAngle * 180 / Math.PI + 360) % 360;
  const suppressed = degrees > 65 && degrees < 115 || degrees > 245 && degrees < 295;
  const lsi = !eligible || suppressed ? 1 : sy < 0 ? 1 - 0.095 * sy : 1 - 0.08 * sy;
  const speed = Math.hypot(queued.x, queued.y) * lsi;
  const release = { x: speed * Math.cos(influencedAngle), y: speed * Math.sin(influencedAngle) };
  let naturalGravity = 0;
  const position = { x: 0, y: 0 };
  const samples: Array<{ position: Vector; velocity: Vector }> = [];
  for (let tick = 0; tick <= ordinaryHitstun + 3; tick++) {
    if (tick > 0) {
      const stunned = tick <= ordinaryHitstun;
      naturalGravity = vertical && !stunned && naturalGravity > fallCap
        ? Math.max(fallCap, naturalGravity - gravity)
        : Math.min(vertical && stunned ? 9 : fallCap, naturalGravity + (vertical && stunned ? verticalGravity : gravity));
    }
    const scale = Math.max(0, 1 - tick * 0.255 / speed);
    const velocity = { x: release.x * scale, y: release.y * scale + naturalGravity };
    position.x += velocity.x; position.y += velocity.y;
    samples.push({ position: { ...position }, velocity });
  }
  return { kb, ordinaryHitstun, launchFacing, queued, release, lsi, tumble,
    groups: groupsFor(ordinaryHitstun, tumble), samples };
}

function expectVector(actual: Vector, expected: Vector, label: string) {
  expect(actual.x, `${label} x`).toBeCloseTo(expected.x, 7);
  expect(actual.y, `${label} y`).toBeCloseTo(expected.y, 7);
}

function assertTrajectory(measurement: ReturnType<typeof measure>) {
  const expected = expectedTrajectory(measurement);
  const hit = measurement.hits[0]!;
  expect(hit.launch.referenceKnockback).toBeCloseTo(expected.kb, 10);
  expect(hit.launch.ordinaryHitstunFrames).toBe(expected.ordinaryHitstun);
  expect(hit.launch.hitstunFrames).toBe(expected.groups.length - 1);
  expect(hit.launchFacing).toBe(expected.launchFacing);
  expectVector(hit.launch.vector, expected.queued, 'queued launch');
  const release = measurement.trace.find(row => row.sinceContact === measurement.summary.releaseAt)!;
  expectVector(release.afterInput.velocity, expected.release, 'release velocity');
  let tick = -1;
  const flight = measurement.trace.filter(row => row.sinceContact >= measurement.summary.releaseAt);
  expect(flight).toHaveLength(expected.groups.length + 3);
  for (const [displayed, row] of flight.entries()) {
    tick += expected.groups[displayed] ?? 1;
    const sample = expected.samples[tick]!;
    expectVector(row.afterConstraints.velocity, sample.velocity, `display ${displayed} velocity`);
    expectVector(row.afterConstraints.position, {
      x: release.afterInput.position.x + sample.position.x,
      y: release.afterInput.position.y + sample.position.y,
    }, `display ${displayed} position`);
    expect(row.afterConstraints.hitstun).toBe(Math.max(0, expected.groups.length - 1 - displayed));
    expect(row.afterConstraints.grounded).toBe(false);
  }
  return expected;
}

const measurements: Array<ReturnType<typeof measure>> = [];
describe('Link neutral air and dash attack launch delivery through real Matter hitboxes', () => {
  it.each(SCENARIOS)('$id delivers the authored strike and independently predicted trajectory', scenario => {
    const measurement = measure(scenario);
    measurements.push(measurement);
    const move = scenario.move === 'nair' ? LINK_NAIR : LINK_DASHATTACK;
    expect(measurement.hits).toHaveLength(1);
    expect(measurement.hits[0]).toMatchObject({ moveId: move.id, damage: recordOf(scenario, measurement.hits[0]!.collisionHitId).damage,
      attackFrame: scenario.phase === 'late' ? 8 : move.startupFrames,
      attackerGrounded: scenario.move === 'dashAttack', targetGrounded: false });
    expect(measurement.setup.staged.velocity).toEqual({ x: 0, y: 0 });
    for (const row of measurement.trace.filter(row => row.beforeInput.hitlag > 1)) {
      expectVector(row.afterConstraints.position, measurement.hits[0]!.targetPosition, 'frozen contact');
      expectVector(row.afterConstraints.velocity, { x: 0, y: 0 }, 'frozen velocity');
    }
    assertTrajectory(measurement);
  });

  it('samples diagonal release DI and LSI for tumbling early nair', () => {
    const base = SCENARIOS.find(value => value.phase === 'early' && value.target === 'link' && value.percent === 100)!;
    const scenario = { ...base, id: 'nair-early-link-100-diagonal' };
    const input = { ...NEUTRAL, moveX: 1, moveY: -1 };
    const measurement = measure(scenario, input);
    measurements.push(measurement);
    const expected = assertTrajectory(measurement);
    expect(expected.tumble).toBe(true);
    expect(expected.lsi).toBeCloseTo(1 + 0.095 / Math.sqrt(2), 12);
    expect(Math.atan2(expected.release.y, expected.release.x))
      .not.toBeCloseTo(Math.atan2(expected.queued.y, expected.queued.x), 6);
  });

  it('does not hit the same victim again when the early sensor is replaced by late nair', () => {
    const scenario = SCENARIOS.find(value => value.phase === 'early' && value.target === 'link' && value.percent === 0)!;
    measure(scenario, NEUTRAL, { repeatVictim: true });
  });

  it('resolves late nair angle 361 horizontally at low percent against a grounded victim', () => {
    const scenario = SCENARIOS.find(value => value.phase === 'late' && value.target === 'link' && value.percent === 0)!;
    const measurement = measure(scenario, { ...NEUTRAL, moveY: -1 }, { groundedVictim: true });
    const hit = measurement.hits[0]!;
    const kb = ((6 / 10 + 6 * 6 / 20) * 1.4 * 200 / 204 + 18) + 15;
    expect(hit).toMatchObject({ damage: 6, attackFrame: 8, attackerGrounded: false, targetGrounded: true });
    expect(hit.launch.referenceKnockback).toBeCloseTo(kb, 10);
    expectVector(hit.launch.vector, { x: kb * 0.15 * 0.8, y: 0 }, 'grounded angle-zero launch');
    expect(hit.launch.ordinaryHitstunFrames).toBe(Math.floor(kb * 0.4) - 1);
    const release = measurement.trace.find(row => row.sinceContact === measurement.summary.releaseAt)!;
    expectVector(release.afterInput.velocity, hit.launch.vector, 'grounded non-tumble ignores DI and LSI');
    expect(release.afterInput.tumbling).toBe(false);
  });
});

afterAll(() => {
  const path = process.env.LINK_NAIR_DASH_LAUNCH_PHYSICS_OUTPUT;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, measurements }, null, 2)}\n`);
});
