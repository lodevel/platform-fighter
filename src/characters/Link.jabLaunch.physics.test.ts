import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Link, LINK_JAB, LINK_JAB2, LINK_JAB3 } from './Link';
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
type Scenario = { id: string; move: 'jab'; stage: 1 | 2 | 3;
  target: 'link' | 'donkeykong'; percent: number; facing: 1 | -1;
  groundedVictim: boolean; sequence?: boolean;
  chainMode?: 'earliest' | 'late' | 'held' | 'hitlag-press'; defense?: 'jump' };
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const ORIGIN = { x: 720, y: 120 };
const PAD = { center: { x: 0, y: 46 }, width: 400, height: 20 };
// Packet values come from linkAttackData.json (SmashWiki Link (SSBU) Neutral attack Hit 1/2/3:
// jab1/2 3% angle 361 BKB 25 KBG 25 (outer hitboxes BKB 20 KBG 15), jab3 4% angle 30 70/70). The engine
// reports which hitbox id connected (context.collisionHitId); that id's packet is the expected record.
const recordOf = (stage: 1 | 2 | 3, id: number) => {
  const packet = LINK_ATTACK_DATA.normals[`link.jab${stage === 1 ? '' : stage}`]!.phases['primary']!
    .packets.find(candidate => candidate.id === id)!;
  return { damage: packet.damage, base: packet.bkb, growth: packet.kbg, angle: packet.angle };
};
// Public combat-input windows (linkNormalRules continuation, SmashWiki Neutral attack pages): the
// next jab is accepted from this 1-based frame of the current one after a confirmed hit, and its
// first frame replaces that frame (SmashWiki quickest loop: hits 7-8, 14-15, 22-23). A press on the
// step after age N - 2 is shown therefore chains at the earliest frame.
const CHAIN_FIRST_FRAME = { 1: 10, 2: 8 } as const;
// A press this many frames after the earliest window: one frame past the victim's jab 1 hitstun,
// so the late string leaves a real actionable gap.
const LATE_CHAIN_DELAY = 5;
const MOVES = { 1: LINK_JAB, 2: LINK_JAB2, 3: LINK_JAB3 } as const;
const relative = (point: Vector) => ({ x: point.x - ORIGIN.x, y: point.y - ORIGIN.y });
const SCENARIOS: Scenario[] = ([1, 2, 3] as const).flatMap(stage =>
  (['link', 'donkeykong'] as const).flatMap(target => [0, 100].flatMap(percent => [false, true].map(groundedVictim => ({
    id: `jab${stage}-${target}-${percent}-${groundedVictim ? 'ground' : 'air'}`, move: 'jab' as const, stage,
    target, percent, facing: 1 as const, groundedVictim,
  })))));
SCENARIOS.push({ id: 'jab3-link-100-air-mirrored', move: 'jab', stage: 3,
  target: 'link', percent: 100, facing: -1, groundedVictim: false });

function snapshot(fighter: Character) {
  return { position: relative(fighter.getPosition()), velocity: fighter.getVelocity(),
    hitlag: fighter.getHitlagRemaining(), hitstun: fighter.getHitstunRemaining(),
    grounded: fighter.isGrounded(), tumbling: fighter.isTumbling(),
    canUseItemsBeforeInput: fighter.canUseItemsBeforeInput() };
}
type Snapshot = ReturnType<typeof snapshot>;
type Hit = { attackFrame: number; moveId: string; damage: number; launchFacing: 1 | -1;
  launch: KnockbackResult; hitlag: number; attackerGrounded: boolean; targetGrounded: boolean;
  attackerPosition: Vector; targetPosition: Vector; sinceContact: number; collisionHitId: number; carry?: Vector };
type Trace = { sinceContact: number; attackFrame: number | null; attackerPosition: Vector;
  moveId: string | null; attackerInput: CharacterInput; beforeInput: Snapshot;
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
  const pad = PAD;
  const padBody = Bodies.rectangle(ORIGIN.x, ORIGIN.y + pad.center.y, pad.width, pad.height, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  });
  Composite.add(engine.world, padBody);
  let stepIndex = 0;
  let contactStep = -1;
  let finalActionableAt: number | null = null;
  const hits: Hit[] = [];
  const trace: Trace[] = [];
  const attackInstances = new Set<object>();
  const hitGroups: unknown[] = [];
  const transitions: Array<{ fromId: string; fromFrame: number; toId: string; toFrame: number; sinceContact: number }> = [];
  let hitlagPressDone = false;
  const handler = new HitboxDamageHandler((targetIndex, hit, context) => {
    expect(targetIndex).toBe(1);
    expect(context.attackerPlayerIndex).toBe(0);
    expect(attacker.getDamagePercent()).toBe(0);
    const sensor = attacker.getActiveAttack()?.hitboxBody;
    const group = sensor?.plugin.hitGroup ?? sensor?.id;
    const result = target.applyHitDetailed(hit);
    if (result.outcome !== 'landed') return { confirmed: false };
    finalActionableAt = null;
    if (hits.length === 0) contactStep = stepIndex;
    hits.push({ attackFrame: attacker.getActiveAttack()?.framesElapsed ?? -1,
      moveId: context.moveId, damage: result.damageApplied, launchFacing: hit.facing,
      launch: result.knockback, hitlag: target.getHitlagRemaining(),
      attackerGrounded: attacker.isGrounded(), targetGrounded: target.isGrounded(),
      attackerPosition: relative(attacker.getPosition()), targetPosition: relative(target.getPosition()),
      sinceContact: stepIndex - contactStep, collisionHitId: context.collisionHitId!,
      ...(hit.velocityCarry ? { carry: { ...hit.velocityCarry } } : {}) });
    hitGroups.push(group);
    if (context.attackInstance && !attackInstances.has(context.attackInstance)) {
      expect(attacker.getStaleOccurrences(context.moveId)).toBe(0);
      attackInstances.add(context.attackInstance);
      attacker.registerLandedMove(context.moveId);
    }
    attacker.armAttackerHitlag(target.getHitlagRemaining());
    // MatchScene reports every landed hit to the attacker; Link's held-attack chain needs the confirmation.
    attacker.notifyIntrinsicSourceContact(context.moveId, 'landed', targetIndex, context.attackInstance);
    return { confirmed: true };
  });
  fighters.forEach((fighter, index) => handler.registerPlayer(index, fighter.body));
  handler.setGroundedLookup(index => fighters[index]!.isGrounded());
  handler.setHurtboxLookup(index => fighters[index]!.getActiveHurtboxes());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const step = (requestedInput?: CharacterInput) => {
    stepIndex++;
    const previousAttack = attacker.getActiveAttack();
    let attackerInput = requestedInput ?? NEUTRAL;
    if (!requestedInput && scenario.sequence && previousAttack) {
      const chainStage = previousAttack.move.id === LINK_JAB.id ? 1 : previousAttack.move.id === LINK_JAB2.id ? 2 : null;
      const chain = chainStage !== null;
      const threshold = (chainStage ? CHAIN_FIRST_FRAME[chainStage] : 99) + (scenario.chainMode === 'late' ? LATE_CHAIN_DELAY : 0);
      if (scenario.chainMode === 'held') attackerInput = { ...NEUTRAL, attack: true };
      else if (scenario.chainMode === 'hitlag-press') {
        if (!hitlagPressDone && attacker.getHitlagRemaining() > 0) {
          attackerInput = { ...NEUTRAL, attack: true };
          hitlagPressDone = true;
        }
      } else if (chain && attacker.getHitlagRemaining() === 0 && previousAttack.framesElapsed === threshold - 2) {
        attackerInput = { ...NEUTRAL, attack: true };
      }
    }
    const beforeInput = snapshot(target);
    attacker.applyInput(attackerInput);
    const defense = scenario.sequence && hits.length > 0 && (stepIndex - contactStep) % 2 === 0 && scenario.defense;
    const defenderInput = defense === 'jump' ? { ...NEUTRAL, jump: true }
      : target.getHitlagRemaining() === 1 ? releaseInput : NEUTRAL;
    target.applyInput(defenderInput);
    const afterInput = snapshot(target);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    const active = attacker.getActiveAttack();
    if (previousAttack && active && active.move.id !== previousAttack.move.id) {
      transitions.push({ fromId: previousAttack.move.id, fromFrame: previousAttack.framesElapsed,
        toId: active.move.id, toFrame: active.framesElapsed, sinceContact: stepIndex - contactStep });
    }
    if (hits.length === 0) {
      const a = attacker.body.bounds, b = target.body.bounds;
      // MatchScene also nudges overlapping fighter bodies after physics. Keep
      // this controlled launch setup clear of that separate pre-hit behavior.
      expect(a.max.x <= b.min.x || b.max.x <= a.min.x || a.max.y <= b.min.y || b.max.y <= a.min.y,
        `jab startup step ${stepIndex} has no fighter overlap`).toBe(true);
    }
    if (hits.length) trace.push({ sinceContact: stepIndex - contactStep,
      attackFrame: active?.framesElapsed ?? null, moveId: active?.move.id ?? null, attackerInput,
      attackerPosition: relative(attacker.getPosition()),
      beforeInput, afterInput, afterConstraints: snapshot(target), defenderInput });
  };
  const attackFacing = scenario.facing;
  // Sequence spacing remains a 3px gap between fighter bodies. Isolated hits
  // overlap the selected source-projected rectangle by 5px at its outer edge.
  const selectedHitbox = MOVES[scenario.stage].hitbox;
  const contactX = scenario.sequence ? 26 + target.getTuning().width / 2
    : selectedHitbox.offsetX + selectedHitbox.width / 2 + target.getTuning().width / 2 - 5;
  if (scenario.groundedVictim) target.resetForRound(ORIGIN.x + attackFacing * (scenario.sequence ? contactX : 160),
    ORIGIN.y + 36 - target.getTuning().height / 2);
  for (let frame = 0; frame < 20; frame++) step(NEUTRAL);
  expect(attacker.isGrounded()).toBe(true);
  if (scenario.groundedVictim) expect(target.isGrounded()).toBe(true);
  target.setDamagePercent(scenario.percent);
  const initial = { attacker: snapshot(attacker), target: snapshot(target) };
  attacker.setFacing(scenario.facing);
  const attackInput = { ...NEUTRAL, attack: true };
  step(attackInput);
  expect(attacker.getActiveAttack()).toMatchObject({ move: { id: LINK_JAB.id }, facing: attackFacing });
  for (let stage = 1; stage < scenario.stage; stage++) {
    while (attacker.getActiveAttack()!.framesElapsed < CHAIN_FIRST_FRAME[stage as 1 | 2] - 2) step(NEUTRAL);
    step(attackInput);
    expect(attacker.getActiveAttack()).toMatchObject({ move: { id: MOVES[(stage + 1) as 2 | 3].id }, framesElapsed: 0 });
  }
  const move = MOVES[scenario.stage];
  const contactFrame = move.startupFrames;
  while (attacker.getActiveAttack()!.framesElapsed < contactFrame - 1) step();
  expect(attacker.getActiveAttack()?.framesElapsed).toBe(contactFrame - 1);
  expect(hits).toHaveLength(0);
  const anchor = attacker.getPosition();
  const offset = { x: attackFacing * contactX, y: 34 - target.getTuning().height / 2 };
  if (scenario.groundedVictim && !scenario.sequence) Body.setPosition(target.body, { x: anchor.x + offset.x, y: target.getPosition().y });
  else if (!scenario.groundedVictim) target.resetForRound(anchor.x + offset.x, anchor.y + offset.y);
  target.setDamagePercent(scenario.percent);
  const staged = snapshot(target);
  step();
  expect(hits).toHaveLength(1);
  if (!scenario.sequence) {
    Composite.remove(engine.world, padBody);
    attacker.setPosition(anchor.x - 400, anchor.y);
  }
  let firstActionableAt: number | null = null;
  for (let frame = 0; frame < 250; frame++) {
    step();
    const row = trace.at(-1)!;
    if (firstActionableAt === null && row.beforeInput.canUseItemsBeforeInput) firstActionableAt = row.sinceContact;
    if (finalActionableAt === null && row.sinceContact > hits.at(-1)!.sinceContact
      && row.beforeInput.canUseItemsBeforeInput) finalActionableAt = row.sinceContact;
    const sequenceDone = !scenario.sequence || attacker.getActiveAttack() === null;
    if (sequenceDone && finalActionableAt !== null && row.sinceContact >= finalActionableAt + 2) break;
  }
  const releaseAt = trace.find(row => row.beforeInput.hitlag === 1)?.sinceContact;
  expect(releaseAt).toBeDefined();
  expect(firstActionableAt).not.toBeNull();
  expect(finalActionableAt).not.toBeNull();
  const measurement = { scenario, input: releaseInput,
    setup: { worldOrigin: ORIGIN, attackerAnchor: relative(anchor), staged, pad, initial, attackInput,
      removePadAfterContact: !scenario.sequence },
    config: { timestepMs: GAME_CONFIG.fixedTimestepMs, gravity: { ...engine.gravity } },
    hits, trace, transitions, summary: { releaseAt: releaseAt!, stunEndAt: firstActionableAt! - 1, firstActionableAt: firstActionableAt!,
      finalStunEndAt: finalActionableAt! - 1, finalActionableAt: finalActionableAt!,
      attackInstances: attackInstances.size, hitGroups: new Set(hitGroups).size,
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

function expectedTrajectory(measurement: ReturnType<typeof measure>, struck = measurement.hits[0]!) {
  const { scenario, input } = measurement;
  const reference = recordOf(scenario.stage, struck.collisionHitId);
  const weight = scenario.target === 'link' ? 104 : 127;
  const gravity = scenario.target === 'link' ? 0.48 : 0.425;
  const fallCap = scenario.target === 'link' ? 8 : 8.15;
  const verticalGravity = scenario.target === 'link' ? 0.38472 : 0.42336;
  const damage = reference.damage;
  const percent = scenario.percent + damage;
  const kb = ((percent / 10 + percent * damage / 20) * 1.4 * 200 / (weight + 100) + 18)
      * reference.growth / 100 + reference.base;
  const ordinaryHitstun = Math.floor(Math.max(5, kb * 0.4)) - 1;
  const tumble = ordinaryHitstun + 1 >= 32;
  const degrees = reference.angle;
  const sakurai = !scenario.groundedVictim ? 0.663225 * 180 / Math.PI
    : kb < 60 ? 0 : kb >= 88 ? 38 : Math.min((kb - 60) * 38 / 28 + 1, 38);
  const nativeAngle = (degrees === 361 ? sakurai : degrees) * Math.PI / 180;
  const vertical = tumble && nativeAngle >= 1.22173 && nativeAngle <= 1.91986;
  const launchFacing = scenario.facing;
  const groundedSlide = scenario.groundedVictim && nativeAngle === 0 ? 0.8 : 1;
  const queued = { x: kb * 0.15 * groundedSlide * Math.cos(nativeAngle) * launchFacing,
    y: -kb * 0.15 * Math.sin(nativeAngle) - (tumble && !vertical ? 5 * (gravity - 0.375) : 0) };
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
describe('Link jab launch delivery through normal grounded chain inputs and Matter', () => {
  it.each(SCENARIOS)('$id delivers the authored strike and independently predicted trajectory', scenario => {
    const measurement = measure(scenario);
    measurements.push(measurement);
    const move = MOVES[scenario.stage];
    expect(measurement.hits).toHaveLength(1);
    expect(measurement.hits[0]).toMatchObject({ moveId: move.id, attackFrame: move.startupFrames,
      attackerGrounded: true, targetGrounded: scenario.groundedVictim });
    expect(measurement.hits[0]!.damage).toBe(recordOf(scenario.stage, measurement.hits[0]!.collisionHitId).damage);
    expect(measurement.hits[0]!.carry).toBeUndefined();
    expect(measurement.setup.staged.velocity).toEqual({ x: 0, y: 0 });
    expect(measurement.transitions.map(row => row.toId)).toEqual(
      scenario.stage === 1 ? [] : scenario.stage === 2 ? [LINK_JAB2.id] : [LINK_JAB2.id, LINK_JAB3.id]);
    expect(measurement.summary.attackInstances).toBe(1);
    for (const row of measurement.trace.filter(row => row.beforeInput.hitlag > 1)) {
      expectVector(row.afterConstraints.position, measurement.hits[0]!.targetPosition, 'frozen contact');
      expectVector(row.afterConstraints.velocity, { x: 0, y: 0 }, 'frozen velocity');
    }
    assertTrajectory(measurement);
  });

  it('jab3 finishing launch samples diagonal DI and LSI', () => {
    const scenario: Scenario = { id: 'jab3-link-100-air-diagonal', move: 'jab', stage: 3,
      target: 'link', percent: 100, facing: 1, groundedVictim: false };
    const measurement = measure(scenario, { ...NEUTRAL, moveX: 1, moveY: -1 });
    measurements.push(measurement);
    const expected = assertTrajectory(measurement);
    expect(expected.tumble).toBe(true);
    expect(expected.lsi).toBeCloseTo(1 + 0.095 / Math.sqrt(2), 12);
    expect(Math.atan2(expected.release.y, expected.release.x))
      .not.toBeCloseTo(Math.atan2(expected.queued.y, expected.queued.x), 6);
  });

  it.each([
    { target: 'link' as const, percent: 0, chainMode: 'earliest' as const },
    { target: 'link' as const, percent: 100, chainMode: 'earliest' as const },
    { target: 'donkeykong' as const, percent: 100, chainMode: 'earliest' as const },
    { target: 'link' as const, percent: 0, chainMode: 'late' as const },
    { target: 'link' as const, percent: 0, chainMode: 'held' as const },
    { target: 'link' as const, percent: 0, chainMode: 'hitlag-press' as const },
    { target: 'link' as const, percent: 0, chainMode: 'earliest' as const, defense: 'jump' as const },
  ])('measures uninterrupted neutral ground chain input: %j', options => {
    const scenario: Scenario = { id: `jab-chain-${options.target}-${options.percent}-${options.chainMode}-${'defense' in options ? options.defense : 'neutral'}`,
      move: 'jab', stage: 1, facing: 1, groundedVictim: true, sequence: true, ...options };
    const measurement = measure(scenario);
    measurements.push(measurement);
    // Holding attack continues the combo once the hit is confirmed (linkNormalContinuation); only a press
    // made during hitlag, which the fighter does not buffer, leaves the chain at jab 1.
    const chained = options.chainMode !== 'hitlag-press';
    expect(measurement.hits.map(hit => hit.moveId)).toEqual(chained
      ? [LINK_JAB.id, LINK_JAB2.id, LINK_JAB3.id] : [LINK_JAB.id]);
    expect(measurement.hits.map(hit => hit.attackFrame)).toEqual(chained ? [6, 4, 5] : [6]);
    expect(measurement.summary.attackInstances).toBe(measurement.hits.length);
    expect(measurement.summary.hitGroups).toBe(measurement.hits.length);
    let percent = scenario.percent;
    for (const [index, hit] of measurement.hits.entries()) {
      const stage = (index + 1) as 1 | 2 | 3;
      const expected = expectedTrajectory({ ...measurement, scenario: { ...scenario, stage,
        percent, groundedVictim: hit.targetGrounded } }, hit);
      expect(hit.damage).toBe(recordOf(stage, hit.collisionHitId).damage);
      expect(hit.attackerGrounded).toBe(true);
      expect(hit.targetGrounded).toBe(true);
      expect(hit.carry).toBeUndefined();
      expect(hit.launch.referenceKnockback).toBeCloseTo(expected.kb, 10);
      expect(hit.launch.ordinaryHitstunFrames).toBe(expected.ordinaryHitstun);
      expect(hit.launch.hitstunFrames).toBe(expected.groups.length - 1);
      expectVector(hit.launch.vector, expected.queued, `jab${stage} contact launch`);
      percent += hit.damage;
    }
    expect(measurement.trace.find(row => row.sinceContact === measurement.summary.firstActionableAt)!
      .beforeInput.canUseItemsBeforeInput).toBe(true);
    for (const row of measurement.trace.filter(row => row.sinceContact > 0
      && row.sinceContact < measurement.summary.firstActionableAt)) {
      expect(row.beforeInput.canUseItemsBeforeInput, `locked input step ${row.sinceContact}`).toBe(false);
    }
    for (const row of measurement.trace) {
      expect(row.attackerInput.moveX).toBe(0);
      expect(row.attackerInput.moveY).toBe(0);
    }
    if (chained) {
      const delay = options.chainMode === 'late' ? LATE_CHAIN_DELAY : 0;
      expect(measurement.transitions.map(row => ({ fromId: row.fromId, fromFrame: row.fromFrame,
        toId: row.toId, toFrame: row.toFrame }))).toEqual([
        { fromId: LINK_JAB.id, fromFrame: CHAIN_FIRST_FRAME[1] - 2 + delay, toId: LINK_JAB2.id, toFrame: 0 },
        { fromId: LINK_JAB2.id, fromFrame: CHAIN_FIRST_FRAME[2] - 2 + delay, toId: LINK_JAB3.id, toFrame: 0 },
      ]);
      const last = measurement.hits.at(-1)!;
      const freeBetweenHits = measurement.trace.filter(row => row.sinceContact > 0
        && row.sinceContact < last.sinceContact && row.beforeInput.canUseItemsBeforeInput);
      if (options.chainMode !== 'late') {
        expect(freeBetweenHits).toEqual([]);
        expect(measurement.summary.firstActionableAt).toBe(measurement.summary.finalActionableAt);
      } else {
        // Delayed presses still hit a stationary defender, but they leave a
        // real actionable gap before jab2 and are not a guaranteed combo.
        expect(freeBetweenHits.length).toBeGreaterThan(0);
        expect(measurement.summary.firstActionableAt).toBeLessThan(measurement.hits[1]!.sinceContact);
      }
      const finalTrace = measurement.trace.filter(row => row.sinceContact >= last.sinceContact);
      const finalReleaseAt = finalTrace.find(row => row.beforeInput.hitlag === 1)!.sinceContact;
      // Jump attempts intentionally own their velocity after the final lock.
      // Neutral cases independently verify the complete finishing flight.
      if (!scenario.defense) assertTrajectory({ ...measurement,
        scenario: { ...scenario, stage: 3, percent: scenario.percent + 6, groundedVictim: true },
        hits: [last], trace: finalTrace,
        summary: { ...measurement.summary, releaseAt: finalReleaseAt } });
    } else {
      const first = measurement.hits[0]!;
      expect(measurement.summary.firstActionableAt).toBe(first.hitlag + first.launch.hitstunFrames + 1);
      expect(measurement.transitions).toEqual([]);
      const presses = measurement.trace.filter(row => row.attackerInput.attack);
      expect(presses).toHaveLength(1);
      expect(presses[0]!.beforeInput.hitlag).toBeGreaterThan(0);
    }
    if (scenario.defense === 'jump') {
      expect(measurement.summary.jumpsUsed).toBe(2);
      expect(measurement.trace.some(row => row.sinceContact >= measurement.summary.finalActionableAt
        && row.defenderInput.jump && row.afterInput.velocity.y < 0)).toBe(true);
    } else expect(measurement.summary.jumpsUsed).toBe(chained ? 1 : 0);
  });
});

afterAll(() => {
  const path = process.env.LINK_JAB_LAUNCH_PHYSICS_OUTPUT;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, measurements }, null, 2)}\n`);
});
