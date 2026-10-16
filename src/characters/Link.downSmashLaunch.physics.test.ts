import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Link, LINK_DSMASH } from './Link';
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
type Scenario = { id: string; move: 'dsmash'; strike: 'front' | 'back';
  held: 0 | 30 | 60; target: 'link' | 'donkeykong'; percent: number; facing: 1 | -1;
  groundedVictim?: boolean; crossRoot?: boolean };
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const ORIGIN = { x: 720, y: 120 };
const PAD = { center: { x: 0, y: 46 }, width: 40, height: 20 };
// Audited AttackLw4 inner front sword and back sword. Both check source position.
const SOURCE_RECORDS = {
  front: { damage: 16, base: 40, growth: 88, angle: 78 },
  back: { damage: 12, base: 80, growth: 63, angle: 30 },
  // Hit 1 packet id 3, the innermost sword capsule (linkAttackData link.dsmash/Hit 1): 14%, same launch.
  frontInner: { damage: 14, base: 40, growth: 88, angle: 78 },
} as const;
const recordFor = (scenario: Scenario) => scenario.crossRoot ? SOURCE_RECORDS.frontInner : SOURCE_RECORDS[scenario.strike];
const relative = (point: Vector) => ({ x: point.x - ORIGIN.x, y: point.y - ORIGIN.y });
const SCENARIOS: Scenario[] = (['front', 'back'] as const).flatMap(strike =>
  (['link', 'donkeykong'] as const).flatMap(target => ([0, 30, 60] as const).map(held => ({
    id: `dsmash-${strike}-${target}-100-charge${held}`, move: 'dsmash' as const,
    strike, held, target, percent: 100, facing: 1 as const,
  }))));
for (const strike of ['front', 'back'] as const) {
  SCENARIOS.push({ id: `dsmash-${strike}-link-0-charge0-grounded`, move: 'dsmash', strike,
    held: 0, target: 'link', percent: 0, facing: 1, groundedVictim: true });
}
SCENARIOS.push({ id: 'dsmash-back-link-100-charge30-mirrored', move: 'dsmash', strike: 'back',
  held: 30, target: 'link', percent: 100, facing: -1 });
SCENARIOS.push({ id: 'dsmash-front-link-100-charge0-cross-root', move: 'dsmash', strike: 'front',
  held: 0, target: 'link', percent: 100, facing: 1, crossRoot: true });

function snapshot(fighter: Character) {
  return { position: relative(fighter.getPosition()), velocity: fighter.getVelocity(),
    hitlag: fighter.getHitlagRemaining(), hitstun: fighter.getHitstunRemaining(),
    grounded: fighter.isGrounded(), tumbling: fighter.isTumbling(),
    canUseItemsBeforeInput: fighter.canUseItemsBeforeInput() };
}
type Snapshot = ReturnType<typeof snapshot>;
type Hit = { attackFrame: number; moveId: string; damage: number; launchFacing: 1 | -1;
  launch: KnockbackResult; hitlag: number; attackerGrounded: boolean; targetGrounded: boolean;
  attackerPosition: Vector; targetPosition: Vector; chargeHeldFrames: number | null; sweetSpot: boolean };
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
  const pad = scenario.groundedVictim ? { ...PAD, width: 400 } : PAD;
  const padBody = Bodies.rectangle(ORIGIN.x, ORIGIN.y + pad.center.y, pad.width, pad.height, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  });
  Composite.add(engine.world, padBody);
  let stepIndex = 0;
  let contactStep = -1;
  const hits: Hit[] = [];
  const trace: Trace[] = [];
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
      attackerPosition: relative(attacker.getPosition()), targetPosition: relative(target.getPosition()),
      chargeHeldFrames: attacker.getActiveAttack()?.chargeHeldFrames ?? null, sweetSpot: hit.sweetSpot === true });
    attacker.registerLandedMove(context.moveId);
    attacker.armAttackerHitlag(target.getHitlagRemaining());
    return { confirmed: true };
  });
  fighters.forEach((fighter, index) => handler.registerPlayer(index, fighter.body));
  handler.setGroundedLookup(index => fighters[index]!.isGrounded());
  handler.setHurtboxLookup(index => fighters[index]!.getActiveHurtboxes());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (attackerInput: CharacterInput = NEUTRAL) => {
    stepIndex++;
    const beforeInput = snapshot(target);
    attacker.applyInput(attackerInput);
    target.applyInput(target.getHitlagRemaining() === 1 ? releaseInput : NEUTRAL);
    const afterInput = snapshot(target);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    if (hits.length) trace.push({ sinceContact: stepIndex - contactStep,
      beforeInput, afterInput, afterConstraints: snapshot(target) });
  };
  const strikeSide = scenario.strike === 'front' ? 1 : -1;
  if (scenario.groundedVictim) {
    target.resetForRound(ORIGIN.x + scenario.facing * strikeSide * 130,
      ORIGIN.y + 36 - target.getTuning().height / 2);
  }
  for (let frame = 0; frame < 20; frame++) step();
  expect(attacker.isGrounded()).toBe(true);
  if (scenario.groundedVictim) expect(target.isGrounded()).toBe(true);
  attacker.setFacing(scenario.facing);
  const heavy = { ...NEUTRAL, moveY: 1, attackHeavy: true };
  step(heavy);
  expect(attacker.getAnimationActionState()).toMatchObject({ chargeHeldFrames: 0, chargingMove: { id: LINK_DSMASH.id } });
  // Charge counts from the hold flag at motion frame 5 (linkFreshNormals chargeStartFrame).
  const heldInputSteps = scenario.held === 0 ? 0 : LINK_DSMASH.chargeStartFrame! + scenario.held;
  for (let frame = 0; frame < heldInputSteps; frame++) step(heavy);
  step();
  expect(attacker.getActiveAttack()).toMatchObject({ move: { id: LINK_DSMASH.id }, chargeHeldFrames: scenario.held });
  const chargeRelease = { heldInputSteps, autoReleased: false,
    attackFrame: attacker.getActiveAttack()!.framesElapsed };
  const contactFrame = scenario.strike === 'front' ? 11 : 23;
  while (attacker.getActiveAttack()!.framesElapsed < contactFrame - 1) step();
  expect(attacker.getActiveAttack()?.framesElapsed).toBe(contactFrame - 1);
  expect(hits).toHaveLength(0);
  const anchor = attacker.getPosition();
  // Cross-root overlaps only the innermost front capsule (id 3, centre x 30.9 radius 15 at age 11,
  // linkAttackGeometry.json) with a victim whose centre is behind the attacker root, so the
  // positional (lr 'position') launch is distinguishable from the attacker's facing.
  const offset = scenario.crossRoot
    ? { x: -scenario.facing * strikeSide * 3, y: 7 - target.getTuning().height / 2 }
    : { x: scenario.facing * strikeSide * 62, y: 14 };
  if (scenario.groundedVictim) Body.setPosition(target.body, { x: anchor.x + offset.x, y: target.getPosition().y });
  else target.resetForRound(anchor.x + offset.x, anchor.y + offset.y);
  target.setDamagePercent(scenario.percent);
  const staged = snapshot(target);
  step();
  expect(hits).toHaveLength(1);
  if (scenario.groundedVictim) Composite.remove(engine.world, padBody);
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
      chargeRelease, removePadAfterContact: !!scenario.groundedVictim },
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
  const reference = recordFor(scenario);
  const weight = scenario.target === 'link' ? 104 : 127;
  const gravity = scenario.target === 'link' ? 0.48 : 0.425;
  const fallCap = scenario.target === 'link' ? 8 : 8.15;
  const verticalGravity = scenario.target === 'link' ? 0.38472 : 0.42336;
  const damage = reference.damage * (1 + scenario.held / 150);
  const percent = scenario.percent + damage;
  const kb = ((percent / 10 + percent * damage / 20) * 1.4 * 200 / (weight + 100) + 18)
    * reference.growth / 100 + reference.base;
  const ordinaryHitstun = Math.floor(Math.max(5, kb * 0.4)) - 1;
  const tumble = ordinaryHitstun + 1 >= 32;
  const nativeAngle = reference.angle * Math.PI / 180;
  const vertical = tumble && nativeAngle >= 1.22173 && nativeAngle <= 1.91986;
  const launchFacing = scenario.facing * (scenario.strike === 'front' ? 1 : -1) * (scenario.crossRoot ? -1 : 1);
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
  return { damage, kb, ordinaryHitstun, launchFacing, queued, release, lsi, tumble,
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
describe('Link down-smash charged front/back launch delivery through real Matter hitboxes', () => {
  it.each(SCENARIOS)('$id delivers the authored strike and independently predicted trajectory', scenario => {
    const measurement = measure(scenario);
    measurements.push(measurement);
    const move = LINK_DSMASH;
    expect(measurement.hits).toHaveLength(1);
    expect(measurement.hits[0]).toMatchObject({ moveId: move.id,
      chargeHeldFrames: scenario.held, sweetSpot: false,
      attackFrame: scenario.strike === 'front' ? 11 : 23, attackerGrounded: true, targetGrounded: !!scenario.groundedVictim });
    expect(measurement.hits[0]!.damage).toBeCloseTo(recordFor(scenario).damage * (1 + scenario.held / 150), 10);
    expect(measurement.setup.staged.velocity).toEqual({ x: 0, y: 0 });
    for (const row of measurement.trace.filter(row => row.beforeInput.hitlag > 1)) {
      expectVector(row.afterConstraints.position, measurement.hits[0]!.targetPosition, 'frozen contact');
      expectVector(row.afterConstraints.velocity, { x: 0, y: 0 }, 'frozen velocity');
    }
    assertTrajectory(measurement);
  });

  it('applies diagonal DI and LSI after a half-charged back sweep', () => {
    const base = SCENARIOS.find(value => value.strike === 'back' && value.target === 'link' && value.held === 30)!;
    const scenario = { ...base, id: 'dsmash-back-link-100-charge30-diagonal' };
    const input = { ...NEUTRAL, moveX: 1, moveY: -1 };
    const measurement = measure(scenario, input);
    measurements.push(measurement);
    const expected = assertTrajectory(measurement);
    expect(expected.tumble).toBe(true);
    expect(expected.lsi).toBeCloseTo(1 + 0.095 / Math.sqrt(2), 12);
    expect(Math.atan2(expected.release.y, expected.release.x))
      .not.toBeCloseTo(Math.atan2(expected.queued.y, expected.queued.x), 6);
  });
});

afterAll(() => {
  const path = process.env.LINK_DOWN_SMASH_LAUNCH_PHYSICS_OUTPUT;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, measurements }, null, 2)}\n`);
});
