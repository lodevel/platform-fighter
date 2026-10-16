import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Link, LINK_DAIR } from './Link';
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
type Scenario = { id: string; move: 'dair'; phase: 'early' | 'late' | 'return' | 'grounded'; target: 'link' | 'donkeykong';
  percent: number; facing: 1 | -1; side: 'front' | 'back'; groundedVictim?: boolean };
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const ORIGIN = { x: 720, y: 120 };
// Audited AttackAirLw ground/air records and AttackAirLw2Attack returning strike.
const SOURCE_RECORDS = {
  early: { damage: 18, base: 30, growth: 80, angle: 270 },
  grounded: { damage: 18, base: 30, growth: 78, angle: 60 },
  late: { damage: 15, base: 30, growth: 80, angle: 60 },
  return: { damage: 11, base: 50, growth: 80, angle: 65 },
} as const;
const relative = (point: Vector) => ({ x: point.x - ORIGIN.x, y: point.y - ORIGIN.y });
const SCENARIOS: Scenario[] = (['early', 'late', 'return'] as const).flatMap(phase =>
  (['link', 'donkeykong'] as const).flatMap(target => [0, 100].map(percent => ({
    id: `dair-${phase}-${target}-${percent}-front`, move: 'dair' as const, phase,
    target, percent, facing: 1 as const, side: 'front' as const,
  }))));
for (const target of ['link', 'donkeykong'] as const) {
  SCENARIOS.push({ id: `dair-grounded-${target}-0-front`, move: 'dair', phase: 'grounded',
    target, percent: 0, facing: 1, side: 'front' });
}
SCENARIOS.push({ id: 'dair-return-link-100-behind-mirrored', move: 'dair', phase: 'return',
  target: 'link', percent: 100, facing: -1, side: 'back' });
SCENARIOS.push({ id: 'dair-return-link-0-grounded', move: 'dair', phase: 'return',
  target: 'link', percent: 0, facing: 1, side: 'front', groundedVictim: true });

function snapshot(fighter: Character) {
  return { position: relative(fighter.getPosition()), velocity: fighter.getVelocity(),
    hitlag: fighter.getHitlagRemaining(), hitstun: fighter.getHitstunRemaining(),
    grounded: fighter.isGrounded(), tumbling: fighter.isTumbling(),
    canUseItemsBeforeInput: fighter.canUseItemsBeforeInput() };
}
type Snapshot = ReturnType<typeof snapshot>;
type Hit = { attackFrame: number; moveId: string; damage: number; launchFacing: 1 | -1;
  launch: KnockbackResult; hitlag: number; attackerGrounded: boolean; targetGrounded: boolean;
  attackerPosition: Vector; targetPosition: Vector; rebound: boolean };
type Trace = { sinceContact: number; beforeInput: Snapshot; afterInput: Snapshot; afterConstraints: Snapshot };

function measure(scenario: Scenario, releaseInput: CharacterInput = NEUTRAL) {
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
  const pad = scenario.phase === 'grounded' || scenario.groundedVictim
    ? { center: { x: 0, y: 36 + target.getTuning().height + 4 + 10 }, width: 400, height: 20 } : null;
  const padBody = pad ? Bodies.rectangle(ORIGIN.x, ORIGIN.y + pad.center.y, pad.width, pad.height, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  }) : null;
  if (padBody) Composite.add(engine.world, padBody);
  let stepIndex = 0;
  let contactStep = -1;
  const hits: Hit[] = [];
  const trace: Trace[] = [];
  const attackInstances = new Set<object>();
  const hitGroups: unknown[] = [];
  const handler = new HitboxDamageHandler((targetIndex, hit, context) => {
    expect(targetIndex).toBe(1);
    expect(context.attackerPlayerIndex).toBe(0);
    expect(attacker.getDamagePercent()).toBe(0);
    const sensor = attacker.getActiveAttack()?.hitboxBody;
    const result = target.applyHitDetailed(hit);
    if (result.outcome !== 'landed') return { confirmed: false };
    if (context.attackInstance && !attackInstances.has(context.attackInstance)) {
      attackInstances.add(context.attackInstance);
      expect(attacker.getStaleOccurrences(context.moveId)).toBe(0);
      attacker.registerLandedMove(context.moveId);
    }
    attacker.armAttackerHitlag(target.getHitlagRemaining());
    const rebound = attacker.applyAerialRebound(context.attackInstance, result.outcome);
    hitGroups.push(sensor?.plugin.hitGroup);
    contactStep = stepIndex;
    hits.push({ attackFrame: attacker.getActiveAttack()?.framesElapsed ?? -1,
      moveId: context.moveId, damage: result.damageApplied, launchFacing: hit.facing,
      launch: result.knockback, hitlag: target.getHitlagRemaining(),
      attackerGrounded: attacker.isGrounded(), targetGrounded: target.isGrounded(),
      attackerPosition: relative(attacker.getPosition()), targetPosition: relative(target.getPosition()), rebound });
    return { confirmed: true };
  });
  fighters.forEach((fighter, index) => handler.registerPlayer(index, fighter.body));
  handler.setGroundedLookup(index => fighters[index]!.isGrounded());
  handler.setHurtboxLookup(index => fighters[index]!.getActiveHurtboxes());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
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
  const side = scenario.side === 'front' ? 1 : -1;
  const offset = { x: side * scenario.facing * 8, y: 36 + target.getTuning().height / 2 + 4 };
  if (pad) {
    attacker.resetForRound(ORIGIN.x - 1000, ORIGIN.y);
    target.resetForRound(ORIGIN.x + offset.x, ORIGIN.y + offset.y);
    for (let frame = 0; frame < 20; frame++) step();
    expect(target.isGrounded()).toBe(true);
    // Keep startup away from the settled defender: production also applies
    // fighter separation before contact. The controlled impact is staged below.
    attacker.resetForRound(ORIGIN.x - 1000, ORIGIN.y);
  }
  attacker.setFacing(scenario.facing);
  const move = LINK_DAIR;
  expect(attacker.attemptAttack(move.id)).toBe(true);
  const firstContactFrame = scenario.phase === 'late' ? 19 : 13;
  for (let frame = 0; frame < firstContactFrame - 1; frame++) step();
  expect(attacker.getActiveAttack()?.framesElapsed).toBe(firstContactFrame - 1);
  let prelude: { hit: Hit; staged: Snapshot; attackerAnchor: Vector;
    frozenFrames: number; releaseVelocity: Vector; absentThroughAttackFrame: number } | null = null;
  if (scenario.phase === 'return') {
    if (pad) Body.setPosition(attacker.body, { x: ORIGIN.x, y: target.getPosition().y - offset.y });
    const firstAnchor = attacker.getPosition();
    if (!pad) target.resetForRound(firstAnchor.x + offset.x, firstAnchor.y + offset.y);
    target.setDamagePercent(0);
    const preludeStaged = snapshot(target);
    Body.setVelocity(attacker.body, { x: 0, y: 0 });
    step();
    expect(hits).toHaveLength(1);
    const initial = hits[0]!;
    expect(initial).toMatchObject({ attackFrame: 13, damage: 18, rebound: true });
    expect(attacker.getActiveAttack()?.hitboxBody).toBeNull();
    const frozenFrames = attacker.getHitlagRemaining();
    target.resetForRound(ORIGIN.x + (pad ? 130 : 5000), ORIGIN.y + (pad ? offset.y : 0));
    let releaseVelocity: Vector | null = null;
    for (let frame = 0; frame < 100 && attacker.getActiveAttack()!.framesElapsed < 42; frame++) {
      const frozen = attacker.getHitlagRemaining();
      step();
      if (frozen > 0) expect(attacker.getActiveAttack()?.framesElapsed).toBe(13);
      if (frozen === 1) releaseVelocity = attacker.getVelocity();
      expect(attacker.getActiveAttack()?.hitboxBody).toBeNull();
      expect(hits).toHaveLength(1);
    }
    expect(attacker.getActiveAttack()?.framesElapsed).toBe(42);
    expect(releaseVelocity!.y).toBeLessThan(-6);
    expect(attackInstances.size).toBe(1);
    prelude = { hit: initial, staged: preludeStaged, attackerAnchor: relative(firstAnchor),
      frozenFrames, releaseVelocity: releaseVelocity!, absentThroughAttackFrame: 42 };
    hits.length = 0;
    trace.length = 0;
  }
  if (pad) Body.setPosition(attacker.body, { x: ORIGIN.x, y: target.getPosition().y - offset.y });
  const anchor = attacker.getPosition();
  if (!pad) target.resetForRound(anchor.x + offset.x, anchor.y + offset.y);
  else Body.setPosition(target.body, { x: anchor.x + offset.x, y: target.getPosition().y });
  // The sensor extends only six pixels below the fighter: isolate hitbox launch
  // from fighter-body overlap by staging zero downward speed before contact.
  Body.setVelocity(attacker.body, { x: 0, y: 0 });
  target.setDamagePercent(scenario.percent);
  const staged = snapshot(target);
  step();
  expect(hits).toHaveLength(1);
  expect(hits[0]!.rebound).toBe(true);
  if (prelude) {
    expect(attackInstances.size).toBe(1);
    expect(hitGroups).toHaveLength(2);
    expect(hitGroups[1]).not.toBe(hitGroups[0]);
    expect(hits[0]!.attackFrame).toBe(prelude.hit.attackFrame + 30);
  }
  // Grounded delivery selects the authored override; remove the staging floor
  // afterward so the independent flight oracle also covers three free steps.
  if (padBody) Composite.remove(engine.world, padBody);
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
    setup: { worldOrigin: ORIGIN, attackerAnchor: relative(anchor), staged, pad,
      attackerVelocityBeforeContact: { x: 0, y: 0 }, removePadAfterContact: !!pad }, prelude,
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
  const reference = SOURCE_RECORDS[scenario.phase];
  const weight = scenario.target === 'link' ? 104 : 127;
  const gravity = scenario.target === 'link' ? 0.48 : 0.425;
  const fallCap = scenario.target === 'link' ? 8 : 8.15;
  const verticalGravity = scenario.target === 'link' ? 0.38472 : 0.42336;
  const percent = scenario.percent + reference.damage;
  const kb = ((percent / 10 + percent * reference.damage / 20) * 1.4 * 200 / (weight + 100) + 18)
    * reference.growth / 100 + reference.base;
  const ordinaryHitstun = Math.floor(Math.max(5, kb * 0.4)) - 1;
  const tumble = ordinaryHitstun + 1 >= 32;
  const nativeAngle = reference.angle * Math.PI / 180;
  const vertical = tumble && nativeAngle >= 1.22173 && nativeAngle <= 1.91986;
  const launchFacing = scenario.facing * (scenario.side === 'front' ? 1 : -1);
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
describe('Link down-air launch delivery through real Matter hitboxes and rebound', () => {
  it.each(SCENARIOS)('$id delivers the authored strike and independently predicted trajectory', scenario => {
    const measurement = measure(scenario);
    measurements.push(measurement);
    const move = LINK_DAIR;
    expect(measurement.hits).toHaveLength(1);
    expect(measurement.hits[0]).toMatchObject({ moveId: move.id, damage: SOURCE_RECORDS[scenario.phase].damage,
      attackFrame: scenario.phase === 'return' ? 43 : scenario.phase === 'late' ? 19 : 13,
      attackerGrounded: false, targetGrounded: scenario.phase === 'grounded' || !!scenario.groundedVictim });
    expect(measurement.setup.staged.velocity).toEqual({ x: 0, y: 0 });
    for (const row of measurement.trace.filter(row => row.beforeInput.hitlag > 1)) {
      expectVector(row.afterConstraints.position, measurement.hits[0]!.targetPosition, 'frozen contact');
      expectVector(row.afterConstraints.velocity, { x: 0, y: 0 }, 'frozen velocity');
    }
    assertTrajectory(measurement);
  });

  it('rotates a downward meteor at release while retaining ordinary gravity and vertical LSI exclusion', () => {
    const base = SCENARIOS.find(value => value.phase === 'early' && value.target === 'link' && value.percent === 100)!;
    const scenario = { ...base, id: 'dair-early-link-100-diagonal' };
    const input = { ...NEUTRAL, moveX: 1, moveY: -1 };
    const measurement = measure(scenario, input);
    measurements.push(measurement);
    const expected = assertTrajectory(measurement);
    expect(expected.tumble).toBe(true);
    expect(expected.lsi).toBe(1);
    expect(Math.atan2(expected.release.y, expected.release.x))
      .not.toBeCloseTo(Math.atan2(expected.queued.y, expected.queued.x), 6);
  });
});

afterAll(() => {
  const path = process.env.LINK_DOWN_AIR_LAUNCH_PHYSICS_OUTPUT;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, measurements }, null, 2)}\n`);
});
