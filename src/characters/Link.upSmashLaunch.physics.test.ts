import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Link, LINK_USMASH } from './Link';
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
type Scenario = { id: string; move: 'usmash'; strike: 'first' | 'second' | 'finish';
  held: 0 | 30 | 60; target: 'link' | 'donkeykong'; percent: number; facing: 1 | -1;
  groundedVictim?: boolean; late?: boolean; connected?: boolean; defense?: 'jump' | 'dodge' | 'attack';
  highFixed?: boolean };
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const ORIGIN = { x: 720, y: 120 };
const PAD = { center: { x: 0, y: 46 }, width: 40, height: 20 };
// Packet values come from linkAttackData.json (SmashWiki Link (SSBU) up smash: hits 1 and 2 are
// fixed-knockback, set-weight linkers at 4% / 3% (FKB 55 on the inner sword, 38 / 28 on the others),
// hit 3 is 11/10/9% angle 80-90 BKB 60 KBG 101). The engine reports which hitbox id connected
// (context.collisionHitId); that id's packet is the expected record.
const USMASH_ROLES = { first: ['Clean hit 1', 'Late hit 1'], second: ['Clean hit 2', 'Late hit 2'],
  finish: ['Hit 3', 'Hit 3'] } as const;
const recordOf = (strike: 'first' | 'second' | 'finish', late: boolean | undefined, id: number) => {
  const packet = LINK_ATTACK_DATA.normals['link.usmash']!.phases[USMASH_ROLES[strike][late ? 1 : 0]]!
    .packets.find(candidate => candidate.id === id)!;
  return { damage: packet.damage, base: packet.bkb, growth: packet.kbg, angle: packet.angle, fixed: packet.fkb };
};
const relative = (point: Vector) => ({ x: point.x - ORIGIN.x, y: point.y - ORIGIN.y });
const SCENARIOS: Scenario[] = (['first', 'second', 'finish'] as const).flatMap(strike =>
  (['link', 'donkeykong'] as const).flatMap(target => ([0, 60] as const).map(held => ({
    id: `usmash-${strike}-${target}-100-charge${held}`, move: 'usmash' as const,
    strike, held, target, percent: 100, facing: 1 as const,
  }))));
for (const strike of ['first', 'second'] as const) {
  SCENARIOS.push({ id: `usmash-${strike}-link-0-charge0-grounded`, move: 'usmash', strike,
    held: 0, target: 'link', percent: 0, facing: 1, groundedVictim: true });
  SCENARIOS.push({ id: `usmash-${strike}-link-0-charge30-late`, move: 'usmash', strike,
    held: 30, target: 'link', percent: 0, facing: 1, late: true });
}
SCENARIOS.push({ id: 'usmash-first-link-0-charge0', move: 'usmash', strike: 'first',
  held: 0, target: 'link', percent: 0, facing: 1 });
SCENARIOS.push({ id: 'usmash-first-link-100-charge0-mirrored', move: 'usmash', strike: 'first',
  held: 0, target: 'link', percent: 100, facing: -1 });

function snapshot(fighter: Character) {
  return { position: relative(fighter.getPosition()), velocity: fighter.getVelocity(),
    hitlag: fighter.getHitlagRemaining(), hitstun: fighter.getHitstunRemaining(),
    grounded: fighter.isGrounded(), tumbling: fighter.isTumbling(),
    canUseItemsBeforeInput: fighter.canUseItemsBeforeInput() };
}
type Snapshot = ReturnType<typeof snapshot>;
type Hit = { attackFrame: number; moveId: string; damage: number; launchFacing: 1 | -1;
  launch: KnockbackResult; hitlag: number; attackerGrounded: boolean; targetGrounded: boolean;
  attackerPosition: Vector; targetPosition: Vector; chargeHeldFrames: number | null; sweetSpot: boolean; sinceContact: number; collisionHitId: number };
type Trace = { sinceContact: number; attackFrame: number | null; beforeInput: Snapshot;
  afterInput: Snapshot; afterConstraints: Snapshot; defenderInput: CharacterInput };

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
  if (scenario.highFixed) attacker.addAttack({ ...LINK_USMASH,
    knockback: { ...LINK_USMASH.knockback, reference: { base: 0, growth: 100, angle: 45,
      fixed: 150, setWeight: true, additionalHitstunFrames: 3 } },
    hitWindows: undefined, damage: 11 });
  const pad = scenario.groundedVictim || scenario.connected ? { ...PAD, width: 400 } : PAD;
  const padBody = Bodies.rectangle(ORIGIN.x, ORIGIN.y + pad.center.y, pad.width, pad.height, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  });
  Composite.add(engine.world, padBody);
  let stepIndex = 0;
  let contactStep = -1;
  const hits: Hit[] = [];
  const trace: Trace[] = [];
  const attackInstances = new Set<object>();
  const groups: unknown[] = [];
  let activeOverlapEvents = 0;
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
      chargeHeldFrames: attacker.getActiveAttack()?.chargeHeldFrames ?? null, sweetSpot: hit.sweetSpot === true,
      sinceContact: stepIndex - contactStep, collisionHitId: context.collisionHitId! });
    groups.push(group);
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
  Events.on(engine, 'collisionActive', (event: any) => {
    for (const pair of event.pairs) {
      const other = pair.bodyA === target.body ? pair.bodyB : pair.bodyB === target.body ? pair.bodyA : null;
      if (other?.plugin?.ownerBodyId === attacker.body.id && other.isSensor) activeOverlapEvents++;
    }
    handler.handleCollisionStart(event);
  });
  const step = (attackerInput: CharacterInput = NEUTRAL) => {
    stepIndex++;
    const beforeInput = snapshot(target);
    attacker.applyInput(attackerInput);
    // Alternating neutral/action steps create fresh edges while the sequence is
    // live, rather than relying on a button held since the first hitlag frame.
    const defense = scenario.connected && hits.length > 0 && hits.length < 3
      && (stepIndex - contactStep) % 2 === 0 && scenario.defense;
    const defenderInput = defense === 'jump' ? { ...NEUTRAL, jump: true }
      : defense === 'dodge' ? { ...NEUTRAL, dodge: true, shield: true }
      : defense === 'attack' ? { ...NEUTRAL, attack: true }
      : target.getHitlagRemaining() === 1 ? releaseInput : NEUTRAL;
    target.applyInput(defenderInput);
    const afterInput = snapshot(target);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    if (hits.length) trace.push({ sinceContact: stepIndex - contactStep,
      attackFrame: attacker.getActiveAttack()?.framesElapsed ?? null, defenderInput,
      beforeInput, afterInput, afterConstraints: snapshot(target) });
  };
  const contactX = (scenario.connected ? 30 : 24) + target.getTuning().width / 2;
  if (scenario.groundedVictim) {
    target.resetForRound(ORIGIN.x + scenario.facing * 130,
      ORIGIN.y + 36 - target.getTuning().height / 2);
  }
  for (let frame = 0; frame < 20; frame++) step();
  expect(attacker.isGrounded()).toBe(true);
  if (scenario.groundedVictim) expect(target.isGrounded()).toBe(true);
  attacker.setFacing(scenario.facing);
  const heavy = { ...NEUTRAL, moveY: -1, attackHeavy: true };
  step(heavy);
  expect(attacker.getAnimationActionState()).toMatchObject({ chargeHeldFrames: 0, chargingMove: { id: LINK_USMASH.id } });
  // Charge counts from the hold flag at motion frame 6 (linkFreshNormals chargeStartFrame).
  const heldInputSteps = scenario.held === 0 ? 0 : LINK_USMASH.chargeStartFrame! + scenario.held;
  for (let frame = 0; frame < heldInputSteps; frame++) step(heavy);
  step();
  expect(attacker.getActiveAttack()).toMatchObject({ move: { id: LINK_USMASH.id }, chargeHeldFrames: scenario.held });
  const chargeRelease = { heldInputSteps, autoReleased: false,
    attackFrame: attacker.getActiveAttack()!.framesElapsed };
  const contactFrame = (scenario.strike === 'first' ? 9 : scenario.strike === 'second' ? 24 : 40) + (scenario.late ? 4 : 0);
  while (attacker.getActiveAttack()!.framesElapsed < contactFrame - 1) step();
  expect(attacker.getActiveAttack()?.framesElapsed).toBe(contactFrame - 1);
  expect(hits).toHaveLength(0);
  const anchor = attacker.getPosition();
  // The late hits sweep backwards over the head; only capsule id 0 stays above the root (centre
  // x -3.8..4.6, y -28..-16, radius 17.5; linkAttackGeometry link.usmash ages 13 and 28), so the late
  // victim is staged straight above the fighter.
  const offset = scenario.late
    ? { x: 0, y: -target.getTuning().height / 2 - 37 }
    : { x: scenario.facing * contactX, y: -target.getTuning().height / 2 - (scenario.connected ? 20 : 38) };
  if (scenario.groundedVictim) Body.setPosition(target.body, { x: anchor.x + offset.x, y: target.getPosition().y });
  else target.resetForRound(anchor.x + offset.x, anchor.y + offset.y);
  target.setDamagePercent(scenario.percent);
  const staged = snapshot(target);
  step();
  expect(hits).toHaveLength(1);
  if (!scenario.connected) {
    if (scenario.groundedVictim) Composite.remove(engine.world, padBody);
    attacker.setPosition(anchor.x - 400, anchor.y);
  }
  let firstActionableAt: number | null = null;
  let isolatedFinish = false;
  for (let frame = 0; frame < 250; frame++) {
    step();
    const row = trace.at(-1)!;
    if (scenario.connected && hits.length >= 3 && !isolatedFinish) {
      attacker.setPosition(anchor.x - 400, anchor.y);
      Composite.remove(engine.world, padBody);
      isolatedFinish = true;
    }
    if ((!scenario.connected || isolatedFinish) && firstActionableAt === null && row.beforeInput.canUseItemsBeforeInput) firstActionableAt = row.sinceContact;
    if (firstActionableAt !== null && row.sinceContact >= firstActionableAt + 2) break;
    if (scenario.connected && !isolatedFinish && (attacker.getActiveAttack()?.framesElapsed ?? 99) >= 46) break;
  }
  const releaseAt = trace.find(row => row.beforeInput.hitlag === 1)?.sinceContact;
  expect(releaseAt).toBeDefined();
  if (!scenario.connected) expect(firstActionableAt).not.toBeNull();
  const measurement = { scenario, input: releaseInput,
    setup: { worldOrigin: ORIGIN, attackerAnchor: relative(anchor), staged, pad,
      chargeRelease, removePadAfterContact: !!scenario.groundedVictim && !scenario.connected },
    config: { timestepMs: GAME_CONFIG.fixedTimestepMs, gravity: { ...engine.gravity } },
    hits, trace, summary: { releaseAt: releaseAt!, stunEndAt: firstActionableAt === null ? null : firstActionableAt - 1,
      firstActionableAt, attackInstances: attackInstances.size, hitGroups: new Set(groups).size, activeOverlapEvents } };
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
  const struck = measurement.hits[0]!;
  const { scenario, input } = measurement;
  // The generic high-fixed scenario swaps in a rectangle move with no hitbox ids; its record is its own.
  const reference = scenario.highFixed ? { damage: 11, base: 0, growth: 100, angle: 45, fixed: 150 }
    : recordOf(scenario.strike, scenario.late, struck.collisionHitId);
  const weight = scenario.target === 'link' ? 104 : 127;
  const gravity = scenario.target === 'link' ? 0.48 : 0.425;
  const fallCap = scenario.target === 'link' ? 8 : 8.15;
  const verticalGravity = scenario.target === 'link' ? 0.38472 : 0.42336;
  const damage = (scenario.highFixed ? 11 : reference.damage) * (1 + scenario.held / 150);
  const percent = scenario.percent + damage;
  const fixed = scenario.highFixed ? 150 : reference.fixed;
  const kb = fixed ? (1 + fixed / 2) * 1.4 + 18
    : ((percent / 10 + percent * damage / 20) * 1.4 * 200 / (weight + 100) + 18)
      * reference.growth / 100 + reference.base;
  const baseHitstun = Math.floor(Math.max(5, kb * 0.4)) - 1;
  // Only the generic high-fixed move carries an authored additionalHitstunFrames (3).
  const ordinaryHitstun = baseHitstun + (scenario.highFixed ? 3 : 0);
  const tumble = baseHitstun + 1 >= 32;
  const nativeAngle = (scenario.highFixed ? 45 : reference.angle) * Math.PI / 180;
  const vertical = tumble && nativeAngle >= 1.22173 && nativeAngle <= 1.91986;
  const launchFacing = scenario.facing;
  const queued = { x: kb * 0.15 * Math.cos(nativeAngle) * launchFacing,
    y: -kb * 0.15 * Math.sin(nativeAngle) - (tumble && !vertical && !fixed ? 5 * (gravity - 0.375) : 0) };
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
  return { damage, fixed, kb, ordinaryHitstun, launchFacing, queued, release, lsi, tumble,
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
describe('Link up-smash fixed linkers and finishing launch through real Matter', () => {
  it.each(SCENARIOS)('$id delivers the authored strike and independently predicted trajectory', scenario => {
    const measurement = measure(scenario);
    measurements.push(measurement);
    const move = LINK_USMASH;
    expect(measurement.hits).toHaveLength(1);
    expect(measurement.hits[0]).toMatchObject({ moveId: move.id,
      chargeHeldFrames: scenario.held, sweetSpot: false,
      attackFrame: (scenario.strike === 'first' ? 9 : scenario.strike === 'second' ? 24 : 40) + (scenario.late ? 4 : 0),
      attackerGrounded: true, targetGrounded: !!scenario.groundedVictim });
    expect(measurement.hits[0]!.damage).toBeCloseTo(recordOf(scenario.strike, scenario.late, measurement.hits[0]!.collisionHitId).damage * (1 + scenario.held / 150), 10);
    expect(measurement.setup.staged.velocity).toEqual({ x: 0, y: 0 });
    for (const row of measurement.trace.filter(row => row.beforeInput.hitlag > 1)) {
      expectVector(row.afterConstraints.position, measurement.hits[0]!.targetPosition, 'frozen contact');
      expectVector(row.afterConstraints.velocity, { x: 0, y: 0 }, 'frozen velocity');
    }
    assertTrajectory(measurement);
  });

  it('samples diagonal finishing DI while preserving its vertical LSI exclusion', () => {
    const base = SCENARIOS.find(value => value.strike === 'finish' && value.target === 'link' && value.held === 60)!;
    const scenario = { ...base, id: 'usmash-finish-link-100-charge60-mirrored-diagonal', facing: -1 as const };
    const input = { ...NEUTRAL, moveX: 1, moveY: -1 };
    const measurement = measure(scenario, input);
    measurements.push(measurement);
    const expected = assertTrajectory(measurement);
    expect(expected.tumble).toBe(true);
    expect(expected.lsi).toBe(1);
    expect(Math.atan2(expected.release.y, expected.release.x))
      .not.toBeCloseTo(Math.atan2(expected.queued.y, expected.queued.x), 6);
  });

  it('keeps a generic tumbling fixed launch uncompressed while allowing DI and LSI', () => {
    const scenario: Scenario = { id: 'generic-fixed150-link-100-diagonal', move: 'usmash',
      strike: 'first', held: 0, target: 'link', percent: 100, facing: 1, highFixed: true };
    const measurement = measure(scenario, { ...NEUTRAL, moveX: 1, moveY: 1 });
    measurements.push(measurement);
    const expected = assertTrajectory(measurement);
    expect(expected.kb).toBeCloseTo(124.4, 10);
    expect(expected.tumble).toBe(true);
    expect(measurement.hits[0]!.launch.hitstunFrames).toBe(51);
    expect(expected.groups).toEqual(Array(52).fill(1));
    expect(expected.lsi).toBeLessThan(1);
    expect(Math.atan2(expected.release.y, expected.release.x))
      .not.toBeCloseTo(Math.atan2(expected.queued.y, expected.queued.x), 6);
    expect(expected.queued.y).toBeCloseTo(-124.4 * 0.15 * Math.SQRT1_2, 10);
  });

  it.each([
    { target: 'link' as const, percent: 0, held: 0 as const },
    { target: 'donkeykong' as const, percent: 100, held: 60 as const },
    { target: 'link' as const, percent: 0, held: 0 as const, groundedVictim: true },
    ...(['jump', 'dodge', 'attack'] as const).map(defense => ({ target: 'link' as const,
      percent: 100, held: 0 as const, defense })),
  ])('keeps the three-hit sequence connected: %j', options => {
    const scenario: Scenario = { id: `usmash-connected-${options.target}-${options.percent}-charge${options.held}-${'groundedVictim' in options ? 'grounded' : 'defense' in options ? options.defense : 'neutral'}`,
      move: 'usmash', strike: 'first', facing: 1, connected: true, ...options };
    const measurement = measure(scenario);
    measurements.push(measurement);
    // Strikes 1 and 2 connect on their first active frame; strike 3 connects somewhere in its own
    // active window (public frames 41-45) depending on where the victim has been carried.
    const hit3Windows = LINK_USMASH.hitWindows!.filter(window => window.group === 'hit3');
    const frames = measurement.hits.map(hit => hit.attackFrame);
    expect(frames.slice(0, 2)).toEqual([9, 24]);
    expect(frames).toHaveLength(3);
    expect(frames[2]).toBeGreaterThanOrEqual(Math.min(...hit3Windows.map(window => window.startFrame)));
    expect(frames[2]).toBeLessThan(Math.max(...hit3Windows.map(window => window.endFrame)));
    const strikes = ['first', 'second', 'finish'] as const;
    measurement.hits.forEach((hit, index) => expect(hit.damage)
      .toBeCloseTo(recordOf(strikes[index]!, false, hit.collisionHitId).damage * (1 + options.held / 150), 10));
    expect(measurement.summary.attackInstances).toBe(1);
    expect(measurement.summary.hitGroups).toBe(3);
    expect(measurement.summary.activeOverlapEvents).toBeGreaterThan(3);
    for (const [index, hit] of measurement.hits.slice(0, 2).entries()) {
      const record = recordOf(strikes[index]!, false, hit.collisionHitId);
      const fixed = record.fixed;
      const angle = record.angle * Math.PI / 180;
      const kb = (1 + fixed / 2) * 1.4 + 18;
      const sourceFacing = Math.sign(hit.targetPosition.x - hit.attackerPosition.x) || scenario.facing;
      expect(hit.launch.referenceKnockback).toBeCloseTo(kb, 10);
      expectVector(hit.launch.vector, { x: kb * 0.15 * Math.cos(angle) * sourceFacing,
        y: -kb * 0.15 * Math.sin(angle) }, `connected ${hit.attackFrame} fixed launch`);
      expect(hit.launch.hitstunFrames).toBe(Math.floor(kb * 0.4) - 1);
      expect(hit.launch.ordinaryHitstunFrames).toBe(hit.launch.hitstunFrames);
    }
    const third = measurement.hits[2]!;
    // Between strikes 1 and 2 the victim stays locked (hitstun outlasts the gap). Ultimate has no extra
    // linker hitstun, so after strike 2 (FKB 28-38) it can regain control before strike 3 lands.
    for (const row of measurement.trace.filter(row => row.sinceContact > 0 && row.sinceContact < measurement.hits[1]!.sinceContact)) {
      expect(row.beforeInput.canUseItemsBeforeInput, `input step ${row.sinceContact}`).toBe(false);
    }
    const finishTrace = measurement.trace.filter(row => row.sinceContact >= third.sinceContact);
    const finalReleaseAt = finishTrace.find(row => row.beforeInput.hitlag === 1)!.sinceContact;
    const finalScenario: Scenario = { ...scenario, strike: 'finish', groundedVictim: third.targetGrounded,
      percent: scenario.percent + 7 * (1 + scenario.held / 150),
      facing: (Math.sign(third.targetPosition.x - third.attackerPosition.x) || scenario.facing) as 1 | -1 };
    assertTrajectory({ ...measurement, scenario: finalScenario, trace: finishTrace, hits: [third],
      summary: { ...measurement.summary, releaseAt: finalReleaseAt } });
  });
});

afterAll(() => {
  const path = process.env.LINK_UP_SMASH_LAUNCH_PHYSICS_OUTPUT;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, measurements }, null, 2)}\n`);
});
