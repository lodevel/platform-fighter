import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Link, LINK_TILT, LINK_UAIR } from './Link';
import { DonkeyKong } from './DonkeyKong';
import type { Character, CharacterInput } from './Character';
import { type KnockbackResult } from './combat';
import { LINK_ATTACK_DATA } from './linkAttackData';
import { computeReferenceKnockback } from './referenceKnockback';
import { getReferenceDamageSpeedUpGroups } from './referenceDamageSpeedUp';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { GAME_CONFIG } from '../engine/constants';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { stepCharacterPhysics } from './stepCharacterPhysics';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const Resolver = require('../physics/matter/source/lib/collision/Resolver.js');
const resolverDefaults = { normal: Resolver._restingThresh, tangent: Resolver._restingThreshTangent };
beforeAll(() => {
  // Phaser.MatterPhysics overrides these raw Matter defaults on construction.
  // Match its actual contact-friction thresholds, not Engine.create() alone.
  Resolver._restingThresh = 4;
  Resolver._restingThreshTangent = 6;
});
afterAll(() => {
  Resolver._restingThresh = resolverDefaults.normal;
  Resolver._restingThreshTangent = resolverDefaults.tangent;
});
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
// Use the same world coordinates as the production fixture.
const ORIGIN = { x: 720, y: 120 };
const relative = (point: Vector): Vector => ({ x: point.x - ORIGIN.x, y: point.y - ORIGIN.y });

const SCENARIOS = [
  { id: 'ftilt-link-0-air', move: 'tilt', target: 'link', percent: 0, geometry: 'open' },
  { id: 'ftilt-link-100-air', move: 'tilt', target: 'link', percent: 100, geometry: 'open' },
  { id: 'ftilt-link-100-wall', move: 'tilt', target: 'link', percent: 100, geometry: 'wall' },
  { id: 'ftilt-donkeykong-100-air', move: 'tilt', target: 'donkeykong', percent: 100, geometry: 'open' },
  { id: 'uair-link-100-ceiling', move: 'uair', target: 'link', percent: 100, geometry: 'ceiling' },
] as const;
type Scenario = typeof SCENARIOS[number];
type Vector = { x: number; y: number };
type Snapshot = ReturnType<typeof snapshot>;
type ContactNormal = { surface: string; normal: Vector; depth: number };
type TraceStep = {
  step: number;
  sinceContact: number;
  beforeInput: Snapshot;
  afterInput: Snapshot;
  afterMatter: Snapshot;
  afterConstraints: Snapshot;
  contacts: ContactNormal[];
};
type ConfirmedHit = {
  step: number;
  attackFrame: number;
  moveId: string;
  damage: number;
  hitlag: number;
  launch: KnockbackResult;
  targetGrounded: boolean;
  attackerGrounded: boolean;
  attackerPosition: Vector;
  targetPosition: Vector;
};

function snapshot(fighter: Character) {
  return {
    position: relative(fighter.getPosition()),
    velocity: { ...fighter.getVelocity() },
    hitlag: fighter.getHitlagRemaining(),
    hitstun: fighter.getHitstunRemaining(),
    grounded: fighter.isGrounded(),
    tumbling: fighter.isTumbling(),
    knockedDown: fighter.isKnockedDown(),
    canUseItemsBeforeInput: fighter.canUseItemsBeforeInput(),
  };
}

/**
 * MatchScene's fresh, zero-rage melee pipeline and Phaser's actual Matter
 * integrator. A one-time pre-input placement at the first active frame
 * gives every target zero initial velocity. Nothing moves it artificially
 * after contact; all launch, collision and return-to-control motion is real.
 */
function measure(scenario: Scenario) {
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
  const target = scenario.target === 'link'
    ? new Link(scene, { spawnX: ORIGIN.x + 5000, spawnY: ORIGIN.y })
    : new DonkeyKong(scene, { spawnX: ORIGIN.x + 5000, spawnY: ORIGIN.y });
  const fighters: Character[] = [attacker, target];
  const surfaces = new Map<object, string>();
  const geometry: Array<{ name: string; center: Vector; width: number; height: number }> = [];
  const obstacle = (name: string, x: number, y: number, width: number, height: number) => {
    const body = Bodies.rectangle(ORIGIN.x + x, ORIGIN.y + y, width, height, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    });
    Composite.add(engine.world, body);
    surfaces.set(body, name);
    geometry.push({ name, center: { x, y }, width, height });
  };
  const move = scenario.move === 'tilt' ? LINK_TILT : LINK_UAIR;
  if (scenario.move === 'tilt') {
    if (scenario.geometry === 'wall') {
      obstacle('floor', 0, 46, 2000, 20);
      obstacle('wall', 115, -1000, 20, 4000);
    } else {
      obstacle('attacker-pad', -487.5, 46, 1025, 20); // right=25; top=36
    }
  }
  let stepIndex = 0;
  const hits: ConfirmedHit[] = [];
  const trace: TraceStep[] = [];
  const handler = new HitboxDamageHandler((targetIndex, hit, context) => {
    const victim = fighters[targetIndex]!;
    const owner = fighters[context.attackerPlayerIndex!]!;
    // This fixture isolates the authored launch and collision response. Fresh
    // MatchScene attacks now receive 1.05 damage freshness, covered by the
    // independent modifier tests and production shared-combat probe instead.
    expect(owner.getDamagePercent()).toBe(0);
    expect(owner.getStaleMultiplier(context.moveId)).toBe(1.05);
    const targetGrounded = victim.isGrounded();
    const result = victim.applyHitDetailed(hit);
    if (result.outcome !== 'landed') return { confirmed: false };
    owner.registerLandedMove(context.moveId);
    owner.armAttackerHitlag(victim.getHitlagRemaining());
    hits.push({ step: stepIndex, attackFrame: owner.getActiveAttack()?.framesElapsed ?? -1,
      moveId: context.moveId, damage: result.damageApplied, hitlag: victim.getHitlagRemaining(),
      launch: result.knockback, targetGrounded, attackerGrounded: owner.isGrounded(),
      attackerPosition: relative(owner.getPosition()), targetPosition: relative(victim.getPosition()) });
    return { confirmed: true };
  });
  fighters.forEach((fighter, index) => handler.registerPlayer(index, fighter.body));
  handler.setGroundedLookup(index => fighters[index]!.isGrounded());
  handler.setHurtboxLookup(index => fighters[index]!.getActiveHurtboxes());
  Events.on(engine, 'collisionStart', (event: any) => handler.handleCollisionStart(event));
  Events.on(engine, 'collisionActive', (event: any) => handler.handleCollisionStart(event));
  const collisionNormals = (): ContactNormal[] => engine.pairs.list
    .filter((pair: any) => pair.isActive && !pair.isSensor && pair.collision &&
      (pair.bodyA === target.body || pair.bodyB === target.body))
    .map((pair: any) => {
      const sign = pair.bodyA === target.body ? 1 : -1;
      const other = pair.bodyA === target.body ? pair.bodyB : pair.bodyA;
      return { surface: surfaces.get(other) ?? other.label,
        normal: { x: pair.collision.normal.x * sign, y: pair.collision.normal.y * sign },
        depth: pair.collision.depth };
    });
  const step = () => {
    stepIndex++;
    const beforeInput = snapshot(target);
    attacker.applyInput(NEUTRAL);
    target.applyInput(NEUTRAL);
    const afterInput = snapshot(target);
    let afterMatter = snapshot(target);
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => {
        Engine.update(engine, delta);
        afterMatter = snapshot(target);
      },
    });
    if (hits.length > 0) trace.push({ step: stepIndex, sinceContact: stepIndex - hits[0]!.step,
      beforeInput, afterInput, afterMatter, afterConstraints: snapshot(target), contacts: collisionNormals() });
  };
  if (scenario.move === 'tilt') {
    for (let frame = 0; frame < 20; frame++) step();
    expect(attacker.isGrounded()).toBe(true);
  }
  stepIndex = 0;
  expect(attacker.attemptAttack(move.id)).toBe(true);
  // Forward tilt opens with a three-capsule early hit (public frame 15) that stays near the body
  // (linkAttackGeometry link.tilt age 14); the full-reach clean hit starts one frame later. Stage
  // for the clean hit, whose first window is the one that carries capsule id 0.
  const firstActiveAge = scenario.move === 'tilt'
    ? move.hitWindows!.find(window => window.collisionHits!.some(hit => hit.id === 0))!.startFrame
    : move.startupFrames;
  const stagingFrame = firstActiveAge - (scenario.geometry === 'wall' ? 2 : 1);
  for (let frame = 0; frame < stagingFrame; frame++) step();
  expect(attacker.getActiveAttack()?.framesElapsed).toBe(stagingFrame);
  const anchor = attacker.getPosition();
  const targetStart = scenario.move === 'tilt'
    ? { x: anchor.x + 62, y: scenario.geometry === 'wall' ? ORIGIN.y : anchor.y - 3 }
    : { x: anchor.x, y: anchor.y - 66 };
  target.resetForRound(targetStart.x, targetStart.y);
  target.setDamagePercent(scenario.percent);
  if (scenario.geometry === 'ceiling') {
    obstacle('ceiling', anchor.x - ORIGIN.x, anchor.y - ORIGIN.y - 132, 400, 20);
  }
  const staged = snapshot(target);
  if (scenario.geometry === 'wall') {
    step(); // Establish support before hit delivery, independent of collision callback ordering.
    expect(target.isGrounded()).toBe(true);
  }
  step();
  expect(hits).toHaveLength(1);
  // Keep post-hitstun separation from introducing a second source of momentum.
  attacker.setPosition(anchor.x - 400, anchor.y);
  let sawHitstun = false;
  let hitstunEndedAt: number | null = null;
  for (let frame = 0; frame < 300; frame++) {
    step();
    const row = trace.at(-1)!;
    sawHitstun ||= row.beforeInput.hitstun > 0 || row.afterConstraints.hitstun > 0;
    if (sawHitstun && row.afterConstraints.hitlag === 0 && row.afterConstraints.hitstun === 0 && hitstunEndedAt === null) {
      hitstunEndedAt = row.sinceContact;
    }
    if (hitstunEndedAt !== null && row.sinceContact >= hitstunEndedAt + 5) break;
  }
  expect(hitstunEndedAt).not.toBeNull();
  const firstActionable = trace.find(row => row.sinceContact > 0 && row.beforeInput.canUseItemsBeforeInput);
  const stunEnd = trace.find(row => row.sinceContact === hitstunEndedAt)!;
  const apex = trace.reduce((best, row) => row.afterConstraints.position.y < best.afterConstraints.position.y ? row : best);
  const final = trace.at(-1)!;
  return {
    scenario, config: { timestepMs: GAME_CONFIG.fixedTimestepMs, gravity: { ...engine.gravity },
      dynamics: { positionIterations: engine.positionIterations, velocityIterations: engine.velocityIterations,
        restingThresh: Resolver._restingThresh, restingThreshTangent: Resolver._restingThreshTangent,
        friction: target.body.friction, frictionStatic: target.body.frictionStatic,
        frictionAir: target.body.frictionAir, inertia: target.body.inertia },
      targetMass: target.getTuning().mass, targetBodyMass: target.body.mass,
      targetReferenceWeight: target.getTuning().referenceWeight,
      maxFallSpeed: target.getTuning().maxFallSpeed,
      input: NEUTRAL, units: { position: 'pixels', velocity: 'pixels per fixed step' } },
    setup: { worldOrigin: ORIGIN, attackerAnchor: relative(anchor), staged, geometry }, hits, trace,
    summary: {
      hitstunEndedAt, firstActionableAt: firstActionable?.sinceContact ?? null,
      actionabilityGate: 'canUseItemsBeforeInput, sampled before input; may remain locked by knockdown',
      observedApex: { sinceContact: apex.sinceContact, position: apex.afterConstraints.position },
      displacement: { x: final.afterConstraints.position.x - hits[0]!.targetPosition.x,
        y: final.afterConstraints.position.y - hits[0]!.targetPosition.y },
      remainingVelocityAtStunEnd: stunEnd.afterConstraints.velocity,
      firstActionableVelocity: firstActionable ? {
        beforeInput: firstActionable.beforeInput.velocity, afterInput: firstActionable.afterInput.velocity,
        afterMatter: firstActionable.afterMatter.velocity, afterConstraints: firstActionable.afterConstraints.velocity,
        inputDelta: { x: firstActionable.afterInput.velocity.x - firstActionable.beforeInput.velocity.x,
          y: firstActionable.afterInput.velocity.y - firstActionable.beforeInput.velocity.y },
      } : null,
    },
  };
}

const measurements: Array<ReturnType<typeof measure>> = [];

afterAll(() => {
  const path = process.env.LINK_LAUNCH_TRACE_PATH;
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, measurements }, null, 2) + '\n');
});

describe('Link launch and collision calibration through real Matter contact', () => {
  it.each(SCENARIOS)('$id records contact through five steps after hitstun', scenario => {
    const measurement = measure(scenario);
    measurements.push(measurement);
    const { hits, trace, summary } = measurement;
    expect(hits).toHaveLength(1);
    expect(hits[0]!.moveId).toBe(scenario.move === 'tilt' ? LINK_TILT.id : LINK_UAIR.id);
    expect(hits[0]!.targetGrounded).toBe(scenario.geometry === 'wall');
    expect(hits[0]!.attackerGrounded).toBe(scenario.move === 'tilt');
    // Clean-hit packet 0 (SmashWiki Link (SSBU): forward tilt 13% angle 361 BKB 55 KBG 82;
    // up air 15% angle 85 BKB 23 KBG 93), through the shared knockback formula.
    const packet = LINK_ATTACK_DATA.normals[scenario.move === 'tilt' ? LINK_TILT.id : LINK_UAIR.id]!.phases['Clean hit']!.packets[0]!;
    expect(hits[0]!.damage).toBe(packet.damage);
    const expected = computeReferenceKnockback({ angle: packet.angle, base: packet.bkb, growth: packet.kbg },
      scenario.percent + packet.damage, packet.damage, scenario.target === 'link' ? 104 : 127, 1,
      hits[0]!.targetGrounded);
    const expectedKb = expected.referenceKnockback;
    expect(hits[0]!.launch.referenceKnockback).toBeCloseTo(expectedKb, 10);
    expect(hits[0]!.launch.ordinaryHitstunFrames).toBe(Math.floor(expectedKb * 0.4) - 1);
    expect(hits[0]!.launch.hitstunFrames).toBe(getReferenceDamageSpeedUpGroups(
      expected.hitstunFrames, expected.hitstunFrames + 1 >= 32).length - 1);
    expect(hits[0]!.launch.launchDecayPerFrame).toBeCloseTo(0.255, 12);
    expect(trace.at(-1)!.sinceContact).toBe(summary.hitstunEndedAt! + 5);
    expect(measurement.setup.staged.velocity).toEqual({ x: 0, y: 0 });
    for (const row of trace) {
      for (const state of [row.beforeInput, row.afterInput, row.afterMatter, row.afterConstraints]) {
        expect([state.position.x, state.position.y, state.velocity.x, state.velocity.y].every(Number.isFinite)).toBe(true);
        expect(state.hitlag).toBeGreaterThanOrEqual(0);
        expect(state.hitstun).toBeGreaterThanOrEqual(0);
      }
      if (row.beforeInput.hitlag > 1) {
        expect(row.afterConstraints.position.x).toBeCloseTo(hits[0]!.targetPosition.x, 8);
        expect(row.afterConstraints.position.y).toBeCloseTo(hits[0]!.targetPosition.y, 8);
        expect(row.afterConstraints.velocity).toEqual({ x: 0, y: 0 });
      }
    }
    if (scenario.geometry === 'open') {
      expect(summary.firstActionableAt).toBeGreaterThan(summary.hitstunEndedAt!);
      expect(trace.every(row => row.contacts.length === 0)).toBe(true);
    } else {
      const surface = scenario.geometry === 'wall' ? 'wall' : 'ceiling';
      expect(trace.some(row => row.contacts.some(contact => contact.surface === surface))).toBe(true);
    }
  });

  it('gradually restores ordinary gravity after a ceiling cancels vertical tumble launch', () => {
    const measurement = measure(SCENARIOS[4]);
    const { hits, trace, summary } = measurement;
    expect(hits[0]!.launch.vector.y).toBeLessThan(0);
    expect(trace.some(row => row.contacts.some(contact =>
      contact.surface === 'ceiling' && contact.normal.y > 0.5))).toBe(true);
    expect(summary.firstActionableAt).not.toBeNull();
    const freeSteps = trace.filter(row => row.sinceContact >= summary.firstActionableAt!);
    expect(freeSteps).toHaveLength(5);
    for (const [index, row] of freeSteps.entries()) {
      expect(row.beforeInput.hitstun).toBe(0);
      expect(row.afterConstraints.velocity.y, `post-hitstun step ${row.sinceContact}`)
        .toBeCloseTo([8.52, 8.04, 8, 8, 8][index]!, 8);
    }
  });
});
