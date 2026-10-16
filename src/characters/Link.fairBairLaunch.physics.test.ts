import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Link, LINK_FAIR, LINK_BAIR } from './Link';
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
type Scenario = { id: string; move: 'fair' | 'bair'; strike: 'first' | 'finish';
  target: 'link' | 'donkeykong'; percent: number; facing: 1 | -1;
  groundedVictim?: boolean; connected?: boolean; initialY?: number; defense?: 'jump' | 'dodge' };
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const ORIGIN = { x: 720, y: 120 };
const PAD = { center: { x: 0, y: 46 }, width: 400, height: 20 };
// Fair's source 367 motion linker remains explicitly outside this reference
// oracle. Bair selects the distal knee; finishers use their shared source hit.
const SOURCE_RECORDS = {
  fairFinish: { damage: 10, base: 43, growth: 120, angle: 44, fixed: 0 },
  bairFirst: { damage: 5, base: 0, growth: 100, angle: 70, fixed: 36 },
  bairFinish: { damage: 7, base: 45, growth: 98, angle: 361, fixed: 0 },
} as const;
const relative = (point: Vector) => ({ x: point.x - ORIGIN.x, y: point.y - ORIGIN.y });
const SCENARIOS: Scenario[] = ([['fair', 'finish'], ['bair', 'first'], ['bair', 'finish']] as const).flatMap(([move, strike]) =>
  (['link', 'donkeykong'] as const).flatMap(target => [0, 100].map(percent => ({
    id: `${move}-${strike}-${target}-${percent}`, move, strike,
    target, percent, facing: 1 as const,
  }))));
for (const target of ['link', 'donkeykong'] as const) for (const strike of ['first', 'finish'] as const) {
  SCENARIOS.push({ id: `bair-${strike}-${target}-0-grounded`, move: 'bair', strike,
    target, percent: 0, facing: 1, groundedVictim: true });
}
for (const move of ['fair', 'bair'] as const) SCENARIOS.push({ id: `${move}-finish-link-100-mirrored`,
  move, strike: 'finish', target: 'link', percent: 100, facing: -1 });
SCENARIOS.push({ id: 'bair-first-link-100-mirrored', move: 'bair', strike: 'first',
  target: 'link', percent: 100, facing: -1 });
SCENARIOS.push({ id: 'bair-first-donkeykong-100-grounded', move: 'bair', strike: 'first',
  target: 'donkeykong', percent: 100, facing: 1, groundedVictim: true });

function snapshot(fighter: Character) {
  return { position: relative(fighter.getPosition()), velocity: fighter.getVelocity(),
    hitlag: fighter.getHitlagRemaining(), hitstun: fighter.getHitstunRemaining(),
    grounded: fighter.isGrounded(), tumbling: fighter.isTumbling(),
    canUseItemsBeforeInput: fighter.canUseItemsBeforeInput() };
}
type Snapshot = ReturnType<typeof snapshot>;
type Hit = { attackFrame: number; moveId: string; damage: number; launchFacing: 1 | -1;
  launch: KnockbackResult; hitlag: number; attackerGrounded: boolean; targetGrounded: boolean;
  attackerPosition: Vector; targetPosition: Vector; sinceContact: number; collisionHitId: number; autolink: boolean };
type Trace = { sinceContact: number; attackFrame: number | null; attackerPosition: Vector;
  beforeInput: Snapshot; afterInput: Snapshot; afterConstraints: Snapshot; defenderInput: CharacterInput };

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
  const pad = scenario.groundedVictim ? PAD : null;
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
    const group = attacker.getActiveAttack()?.hitboxBody?.plugin.hitGroup;
    const result = target.applyHitDetailed(hit);
    if (result.outcome !== 'landed') return { confirmed: false };
    if (hits.length === 0) contactStep = stepIndex;
    hits.push({ attackFrame: attacker.getActiveAttack()?.framesElapsed ?? -1,
      moveId: context.moveId, damage: result.damageApplied, launchFacing: hit.facing,
      launch: result.knockback, hitlag: target.getHitlagRemaining(),
      attackerGrounded: attacker.isGrounded(), targetGrounded: target.isGrounded(),
      attackerPosition: relative(attacker.getPosition()), targetPosition: relative(target.getPosition()),
      sinceContact: stepIndex - contactStep, collisionHitId: context.collisionHitId!,
      // Airborne angle-367 hits pull the victim to Link (replaces the legacy velocity carry).
      autolink: hit.autolink !== undefined });
    hitGroups.push(group);
    if (context.attackInstance && !attackInstances.has(context.attackInstance)) {
      expect(attacker.getStaleOccurrences(context.moveId)).toBe(0);
      attackInstances.add(context.attackInstance);
      attacker.registerLandedMove(context.moveId);
    }
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
    const defense = scenario.connected && hits.length === 1 && (stepIndex - contactStep) % 2 === 0 && scenario.defense;
    const defenderInput = defense === 'jump' ? { ...NEUTRAL, jump: true }
      : defense === 'dodge' ? { ...NEUTRAL, dodge: true }
      : target.getHitlagRemaining() === 1 ? releaseInput : NEUTRAL;
    target.applyInput(defenderInput);
    const afterInput = snapshot(target);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    if (scenario.connected && hits.length === 0) {
      const a = attacker.body.bounds, b = target.body.bounds;
      // MatchScene also nudges overlapping fighter bodies after physics. Keep
      // this controlled launch setup clear of that separate pre-hit behavior.
      expect(a.max.x <= b.min.x || b.max.x <= a.min.x || a.max.y <= b.min.y || b.max.y <= a.min.y,
        `connected ${scenario.move} startup step ${stepIndex} has no fighter overlap`).toBe(true);
    }
    if (hits.length) trace.push({ sinceContact: stepIndex - contactStep,
      attackFrame: attacker.getActiveAttack()?.framesElapsed ?? null, attackerPosition: relative(attacker.getPosition()),
      beforeInput, afterInput, afterConstraints: snapshot(target), defenderInput });
  };
  // The side the strike lands on: ahead for fair, behind for bair. Ultimate Link does not turn
  // for a back aerial (SmashWiki bair: hits behind him), so the active attack keeps the
  // fighter's own facing while the stick points to `attackFacing`.
  const attackFacing = (scenario.facing * (scenario.move === 'bair' ? -1 : 1)) as 1 | -1;
  // Fair drifts about 2.9px before its first hit; bair about 1.4px. Their 5px
  // and 3px body gaps avoid production's non-stunned separation push while
  // preserving the existing narrow hitboxes and measured connection outcomes.
  const contactX = (scenario.connected ? scenario.move === 'fair' ? 28 : 26 : 24) + target.getTuning().width / 2;
  if (scenario.groundedVictim) {
    attacker.resetForRound(ORIGIN.x - 1000, ORIGIN.y - 100);
    target.resetForRound(ORIGIN.x + attackFacing * contactX,
      ORIGIN.y + 36 - target.getTuning().height / 2);
    for (let frame = 0; frame < 20; frame++) step();
    expect(target.isGrounded()).toBe(true);
    attacker.resetForRound(ORIGIN.x - 1000, ORIGIN.y - 100);
  }
  if (scenario.connected) target.resetForRound(ORIGIN.x + attackFacing * contactX, ORIGIN.y);
  target.setDamagePercent(scenario.percent);
  Body.setVelocity(attacker.body, { x: 0, y: scenario.initialY ?? 0 });
  if (scenario.connected) Body.setVelocity(target.body, { x: 0, y: scenario.initialY ?? 0 });
  const initial = { attacker: snapshot(attacker), target: snapshot(target) };
  attacker.setFacing(scenario.facing);
  const attackInput = { ...NEUTRAL, moveX: attackFacing, attack: true };
  step(attackInput);
  const move = scenario.move === 'fair' ? LINK_FAIR : LINK_BAIR;
  expect(attacker.getActiveAttack()).toMatchObject({ move: { id: move.id }, facing: scenario.facing });
  const contactFrame = scenario.strike === 'first' ? (scenario.move === 'fair' ? 15 : 5) : scenario.move === 'fair' ? 23 : 14;
  while (attacker.getActiveAttack()!.framesElapsed < contactFrame - 1) step();
  expect(attacker.getActiveAttack()?.framesElapsed).toBe(contactFrame - 1);
  expect(hits).toHaveLength(0);
  if (scenario.groundedVictim) {
    Body.setPosition(attacker.body, { x: ORIGIN.x, y: ORIGIN.y - 4 });
    Body.setVelocity(attacker.body, { x: 0, y: 0 });
  }
  const anchor = attacker.getPosition();
  const offset = { x: attackFacing * contactX, y: -3 };
  if (!scenario.groundedVictim && !scenario.connected) target.resetForRound(anchor.x + offset.x, anchor.y + offset.y);
  target.setDamagePercent(scenario.percent);
  const staged = snapshot(target);
  step();
  expect(hits).toHaveLength(1);
  if (!scenario.connected) {
    if (padBody) Composite.remove(engine.world, padBody);
    attacker.setPosition(anchor.x - 400, anchor.y);
  }
  let firstActionableAt: number | null = null;
  let isolatedFinish = false;
  for (let frame = 0; frame < 250; frame++) {
    step();
    const row = trace.at(-1)!;
    if (scenario.connected && hits.length === 2 && !isolatedFinish) {
      attacker.setPosition(anchor.x - 400, anchor.y);
      isolatedFinish = true;
    }
    const finalWindowEnded = (row.attackFrame ?? 99) >= (scenario.move === 'fair' ? 25 : 17);
    if ((!scenario.connected || isolatedFinish || finalWindowEnded) && firstActionableAt === null
      && row.beforeInput.canUseItemsBeforeInput) firstActionableAt = row.sinceContact;
    if (firstActionableAt !== null && row.sinceContact >= firstActionableAt + 2) break;
  }
  const releaseAt = trace.find(row => row.beforeInput.hitlag === 1)?.sinceContact;
  expect(releaseAt).toBeDefined();
  expect(firstActionableAt).not.toBeNull();
  const measurement = { scenario, input: releaseInput,
    setup: { worldOrigin: ORIGIN, attackerAnchor: relative(anchor), staged, pad, initial, attackInput,
      removePadAfterContact: !!scenario.groundedVictim },
    config: { timestepMs: GAME_CONFIG.fixedTimestepMs, gravity: { ...engine.gravity } },
    hits, trace, summary: { releaseAt: releaseAt!, stunEndAt: firstActionableAt! - 1, firstActionableAt: firstActionableAt!,
      connected: hits.length === 2, attackInstances: attackInstances.size, hitGroups: new Set(hitGroups).size,
      jumpsUsed: target.getJumpsUsed() } };
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
  const reference = scenario.move === 'fair' ? SOURCE_RECORDS.fairFinish
    : scenario.strike === 'first' ? SOURCE_RECORDS.bairFirst : SOURCE_RECORDS.bairFinish;
  const weight = scenario.target === 'link' ? 104 : 127;
  const gravity = scenario.target === 'link' ? 0.48 : 0.425;
  const fallCap = scenario.target === 'link' ? 8 : 8.15;
  const verticalGravity = scenario.target === 'link' ? 0.38472 : 0.42336;
  const damage = reference.damage;
  const percent = scenario.percent + damage;
  const fixed = reference.fixed && scenario.groundedVictim ? 50 : reference.fixed;
  const kb = fixed ? (1 + fixed / 2) * 1.4 + 18
    : ((percent / 10 + percent * damage / 20) * 1.4 * 200 / (weight + 100) + 18)
      * reference.growth / 100 + reference.base;
  const ordinaryHitstun = Math.floor(Math.max(5, kb * 0.4)) - 1;
  const tumble = ordinaryHitstun + 1 >= 32;
  const degrees = fixed && scenario.groundedVictim ? 73 : reference.angle;
  const sakurai = !scenario.groundedVictim ? 0.663225 * 180 / Math.PI
    : kb < 60 ? 0 : kb >= 88 ? 38 : Math.min((kb - 60) * 38 / 28 + 1, 38);
  const nativeAngle = (degrees === 361 ? sakurai : degrees) * Math.PI / 180;
  const vertical = tumble && nativeAngle >= 1.22173 && nativeAngle <= 1.91986;
  const launchFacing = scenario.facing * (scenario.move === 'bair' ? -1 : 1);
  const queued = { x: kb * 0.15 * Math.cos(nativeAngle) * launchFacing,
    y: -kb * 0.15 * Math.sin(nativeAngle) - (tumble && !vertical && !fixed ? 5 * (gravity - 0.375) : 0) };
  const stickLength = Math.max(1, Math.hypot(input.moveX, input.moveY ?? 0));
  const sx = input.moveX / stickLength, sy = (input.moveY ?? 0) / stickLength;
  const angle = Math.atan2(queued.y, queued.x);
  const eligible = tumble && Math.atan2(Math.abs(queued.y), Math.abs(queued.x)) >= 0.17;
  const influencedAngle = angle + (eligible ? (sy * Math.cos(angle) - sx * Math.sin(angle)) * 0.17 : 0);
  const influencedDegrees = (influencedAngle * 180 / Math.PI + 360) % 360;
  const suppressed = influencedDegrees > 65 && influencedDegrees < 115 || influencedDegrees > 245 && influencedDegrees < 295;
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
    groups: groupsFor(ordinaryHitstun, tumble && !fixed), samples };
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
describe('Link fair and bair launch delivery through normal aerial dispatch and Matter', () => {
  it.each(SCENARIOS)('$id delivers the authored strike and independently predicted trajectory', scenario => {
    const measurement = measure(scenario);
    measurements.push(measurement);
    const move = scenario.move === 'fair' ? LINK_FAIR : LINK_BAIR;
    expect(measurement.hits).toHaveLength(1);
    expect(measurement.hits[0]).toMatchObject({ moveId: move.id,
      attackFrame: scenario.strike === 'first' ? 5 : scenario.move === 'fair' ? 23 : 14,
      attackerGrounded: false, targetGrounded: !!scenario.groundedVictim });
    expect(measurement.hits[0]!.damage).toBe(scenario.move === 'fair' ? 10 : scenario.strike === 'first' ? 5 : 7);
    expect(measurement.hits[0]!.autolink).toBe(false);
    expect(measurement.setup.staged.velocity).toEqual({ x: 0, y: 0 });
    for (const row of measurement.trace.filter(row => row.beforeInput.hitlag > 1)) {
      expectVector(row.afterConstraints.position, measurement.hits[0]!.targetPosition, 'frozen contact');
      expectVector(row.afterConstraints.velocity, { x: 0, y: 0 }, 'frozen velocity');
    }
    assertTrajectory(measurement);
  });

  it.each(['fair', 'bair'] as const)('%s finishing launch samples diagonal DI and LSI', move => {
    const base = SCENARIOS.find(value => value.move === move && value.strike === 'finish' && value.target === 'link' && value.percent === 100)!;
    const scenario = { ...base, id: `${move}-finish-link-100-diagonal` };
    const input = { ...NEUTRAL, moveX: 1, moveY: -1 };
    const measurement = measure(scenario, input);
    measurements.push(measurement);
    const expected = assertTrajectory(measurement);
    expect(expected.tumble).toBe(true);
    expect(expected.lsi).toBeCloseTo(1 + 0.095 / Math.sqrt(2), 12);
    expect(Math.atan2(expected.release.y, expected.release.x))
      .not.toBeCloseTo(Math.atan2(expected.queued.y, expected.queued.x), 6);
  });

  it.each([
    { move: 'fair' as const, target: 'link' as const, percent: 0, initialY: 0, expectedHits: 2 },
    { move: 'fair' as const, target: 'link' as const, percent: 0, initialY: -8, expectedHits: 2 },
    // Bair ruling (SmashWiki Link_(SSBU)/Back_aerial timing: Hit 1 frames 6-8, Hit 2 15-17; UFD Back Air
    // 6-8/15-17; neither promises the link). Hit 1 is a set-weight fixed pop-up (FKB 36, 66-70 deg air
    // packets), so kick 2 connects while Link rises or is at his apex at kick 1 (vy -4 starts him at
    // about -0.9 px/step there) and misses once he is already falling (vy 0).
    ...[0, -4, -8, -12].map(initialY => ({ move: 'bair' as const, target: 'link' as const,
      percent: 0, initialY, expectedHits: initialY === 0 ? 1 : 2 })),
    { move: 'bair' as const, target: 'donkeykong' as const, percent: 100, initialY: -8, expectedHits: 2 },
    { move: 'fair' as const, target: 'donkeykong' as const, percent: 100, initialY: 0, expectedHits: 2 },
    ...(['jump', 'dodge'] as const).map(defense => ({ move: 'bair' as const, target: 'link' as const,
      percent: 100, initialY: -8, expectedHits: 2, defense })),
    { move: 'bair' as const, target: 'link' as const, percent: 0, initialY: 0, expectedHits: 1, defense: 'jump' as const },
    { move: 'fair' as const, target: 'link' as const, percent: 100, initialY: 0, expectedHits: 2, defense: 'jump' as const },
  ])('measures an uninterrupted aerial sequence: %j', ({ expectedHits, ...options }) => {
    const { move, initialY, target, percent } = options;
    const scenario: Scenario = { id: `${move}-connected-${target}-${percent}-vy${initialY}-${'defense' in options ? options.defense : 'neutral'}`,
      strike: 'first', facing: 1, connected: true, ...options };
    const measurement = measure(scenario);
    measurements.push(measurement);
    expect(measurement.hits).toHaveLength(expectedHits);
    expect(measurement.hits.map(hit => hit.attackFrame)).toEqual(move === 'fair' ? [15, 23]
      : expectedHits === 2 ? [5, 14] : [5]);
    expect(measurement.summary.attackInstances).toBe(1);
    expect(measurement.summary.hitGroups).toBe(expectedHits);
    if (move === 'fair') expect(measurement.hits[0]!.autolink).toBe(true);
    else {
      expect(measurement.hits[0]!.autolink).toBe(false);
      expect(measurement.hits[0]!.launch.referenceKnockback).toBeCloseTo(44.6, 10);
      expect(measurement.hits[0]!.launch.hitstunFrames).toBe(16);
    }
    if (expectedHits === 2) {
      const finish = measurement.hits[1]!;
      expect(finish.autolink).toBe(false);
      for (const row of measurement.trace.filter(row => row.sinceContact > 0 && row.sinceContact < finish.sinceContact)) {
        expect(row.beforeInput.canUseItemsBeforeInput, `input step ${row.sinceContact}`).toBe(false);
      }
      const finishTrace = measurement.trace.filter(row => row.sinceContact >= finish.sinceContact);
      const finalReleaseAt = finishTrace.find(row => row.beforeInput.hitlag === 1)!.sinceContact;
      assertTrajectory({ ...measurement, scenario: { ...scenario, strike: 'finish',
        percent: scenario.percent + (move === 'fair' ? 8 : 5) }, hits: [finish], trace: finishTrace,
        summary: { ...measurement.summary, releaseAt: finalReleaseAt } });
      expect(measurement.summary.jumpsUsed).toBe(0);
    } else {
      const secondWindow = measurement.trace.filter(row => row.attackFrame !== null && row.attackFrame >= 14 && row.attackFrame < 17);
      expect(secondWindow).toHaveLength(3);
      for (const row of secondWindow) {
        const previous = measurement.trace[measurement.trace.indexOf(row) - 1]!;
        // Bair's sensor is attached at y=-3 with height20 before Matter moves
        // the attacker. The entire defender body is above it on all three ticks.
        expect(row.afterConstraints.position.y + (target === 'link' ? 36 : 45))
          .toBeLessThan(previous.attackerPosition.y - 13);
        expect(row.beforeInput.hitstun).toBeGreaterThan(0);
      }
      if (scenario.defense === 'jump') expect(measurement.summary.jumpsUsed).toBeGreaterThan(0);
      else assertTrajectory(measurement);
    }
  });
});

afterAll(() => {
  const path = process.env.LINK_FAIR_BAIR_LAUNCH_PHYSICS_OUTPUT;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, measurements }, null, 2)}\n`);
});
