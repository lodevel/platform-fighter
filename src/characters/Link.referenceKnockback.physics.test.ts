import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_TILT, LINK_UAIR } from './Link';
import { DonkeyKong } from './DonkeyKong';
import type { CharacterInput } from './Character';
import type { HitInfo } from './combat';
import { computeReferenceKnockback } from './referenceKnockback';
import { GAME_CONFIG } from '../engine/constants';
import { BlastZonePositionWatcher, type KoEvent } from '../match/BlastZonePositionWatcher';
import { createFlatStage } from '../stages/stageDefinitions';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { getReferenceDamageSpeedUpGroups } from './referenceDamageSpeedUp';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const TILT_HIT: HitInfo = { damage: LINK_TILT.damage, knockback: LINK_TILT.knockback, facing: 1 };
const UAIR_HIT: HitInfo = { damage: LINK_UAIR.damage, knockback: LINK_UAIR.knockback, facing: 1 };

/** World gravity defaults to zero; reference launches supply their own gravity. */
function world(options: {
  fighter?: 'link' | 'donkeykong';
  mass?: number;
  gravity?: number;
  position?: { x: number; y: number };
} = {}) {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = options.gravity ?? 0;
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
  const construction = {
    spawnX: options.position?.x ?? 0,
    spawnY: options.position?.y ?? 0,
    ...(options.mass === undefined ? {} : { mass: options.mass }),
  };
  const ch = options.fighter === 'donkeykong'
    ? new DonkeyKong(scene, construction) : new Link(scene, construction);
  const step = (input: CharacterInput = NEUTRAL) => {
    const beforePosition = { ...ch.getPosition() };
    ch.applyInput(input);
    const afterInput = { ...ch.getVelocity() };
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    return { beforePosition, afterInput, afterPhysics: { ...ch.getVelocity() } };
  };
  const release = (hit: HitInfo, percent: number, input = NEUTRAL) => {
    ch.setDamagePercent(percent);
    const launch = ch.applyHit(hit);
    expect(ch.getHitlagRemaining()).toBeGreaterThan(0);
    expect(ch.getHitstunRemaining()).toBe(0);
    for (let frame = 0; frame < 100 && ch.getHitlagRemaining() > 1; frame++) step();
    expect(ch.getHitlagRemaining()).toBe(1);
    const released = step(input);
    expect(ch.getHitlagRemaining()).toBe(0);
    return { launch, released };
  };
  return { ch, step, release };
}

function expectVector(actual: { x: number; y: number }, expected: { x: number; y: number }) {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
}

/** Independent ordinary-tick endpoint, including the initial release tick n=0. */
function tiltEndpoint(initial: { x: number; y: number }, tick: number) {
  const magnitude = Math.hypot(initial.x, initial.y);
  const scale = 1 - tick * 0.255 / magnitude;
  const sum = tick + 1 - 0.255 / magnitude * tick * (tick + 1) / 2;
  return {
    velocity: { x: initial.x * scale, y: initial.y * scale + tick * 0.48 },
    position: { x: initial.x * sum, y: initial.y * sum + 0.48 * tick * (tick + 1) / 2 },
  };
}

describe('Link reference knockback through Character and real Matter', () => {
  it('uses Link weight 104 independently of the physical mass override', () => {
    const lightBody = world({ mass: 1 });
    const heavyBody = world({ mass: 36 });
    expect(lightBody.ch.body.mass).toBe(1);
    expect(heavyBody.ch.body.mass).toBe(36);
    const expected = computeReferenceKnockback(LINK_TILT.knockback.reference!, 113, 13, 104);
    for (const fixture of [lightBody, heavyBody]) {
      expect(fixture.ch.getTuning().referenceWeight).toBe(104);
      const { launch, released } = fixture.release(TILT_HIT, 100);
      expect(fixture.ch.getDamagePercent()).toBe(113);
      expect(launch.referenceKnockback).toBeCloseTo(expected.referenceKnockback, 10);
      const initial = { x: expected.vector.x, y: expected.vector.y - 0.525 };
      expectVector(released.afterInput, initial);
      expectVector(released.afterPhysics, tiltEndpoint(initial, 1).velocity);
      expect(launch.ordinaryHitstunFrames).toBe(65);
      expect(launch.hitstunFrames).toBe(44);
      expect(fixture.ch.getHitstunRemaining()).toBe(44);
    }
  });

  it('gives Donkey Kong weight 127 a weaker launch than Link with identical Matter mass', () => {
    const link = world({ mass: 12 });
    const donkey = world({ fighter: 'donkeykong', mass: 12 });
    const linkLaunch = link.release(TILT_HIT, 100).launch;
    const donkeyLaunch = donkey.release(TILT_HIT, 100).launch;
    expect(donkey.ch.getTuning().referenceWeight).toBe(127);
    const expected = computeReferenceKnockback(LINK_TILT.knockback.reference!, 113, 13, 127);
    expectVector(donkey.ch.getVelocity(), { x: expected.vector.x, y: expected.vector.y - 0.25 });
    expect(donkeyLaunch.magnitude).toBeLessThan(linkLaunch.magnitude);
    expect(donkeyLaunch.ordinaryHitstunFrames).toBe(61);
    expect(donkeyLaunch.hitstunFrames).toBe(43);
    expect(donkeyLaunch.hitstunFrames).toBeLessThan(linkLaunch.hitstunFrames);
  });

  it('releases the full vector before physics, then integrates the complete 2/5 ordinary-tick groups', () => {
    const { ch, release, step } = world();
    const { launch, released } = release(TILT_HIT, 100);
    expectVector(released.beforePosition, { x: 0, y: 0 });
    expectVector(released.afterInput, launch.vector);
    expectVector(released.afterPhysics, tiltEndpoint(launch.vector, 1).velocity);
    expectVector(ch.getPosition(), tiltEndpoint(launch.vector, 1).position);
    expect(ch.isTumbling()).toBe(true);
    expect(ch.getHitstunRemaining()).toBe(launch.hitstunFrames);
    const next = step();
    expectVector(next.afterPhysics, tiltEndpoint(launch.vector, 6).velocity);
    expectVector(ch.getPosition(), tiltEndpoint(launch.vector, 6).position);
    expect(ch.getHitstunRemaining()).toBe(launch.hitstunFrames - 1);
  });

  it.each([
    { knockback: 79, tumble: false },
    { knockback: 80, tumble: true },
  ])('uses reference KB $knockback to gate tumble and DI at release', ({ knockback, tumble }) => {
    const hit: HitInfo = {
      damage: 1, facing: 1,
      knockback: { x: 100, y: -100, scaling: 0, reference: { base: knockback, growth: 0, angle: 45 } },
    };
    const neutral = world();
    const influenced = world();
    const neutralRelease = neutral.release(hit, 0);
    const influencedRelease = influenced.release(hit, 0, { ...NEUTRAL, moveY: 1 });
    expect(neutral.ch.isTumbling()).toBe(tumble);
    expect(influenced.ch.isTumbling()).toBe(tumble);
    // DI acts on the release vector before grouped gravity/decay integration.
    const straight = neutralRelease.released.afterInput;
    const redirected = influencedRelease.released.afterInput;
    expect(Math.hypot(redirected.x, redirected.y)).toBeCloseTo(
      Math.hypot(straight.x, straight.y) * (tumble ? 0.92 : 1), 10,
    );
    if (tumble) {
      const rotation = Math.atan2(redirected.y, redirected.x) - Math.atan2(straight.y, straight.x);
      expect(rotation).toBeGreaterThan(0.05);
      expect(rotation).toBeLessThanOrEqual(0.17);
    } else {
      expectVector(redirected, straight);
    }
  });

  it('keeps a tumbling near-horizontal launch outside the DI angle gate', () => {
    const hit: HitInfo = {
      damage: 1, facing: -1,
      knockback: { x: 0, y: 0, scaling: 0, reference: { base: 100, growth: 0, angle: 5 } },
    };
    const { ch, release } = world();
    const { launch, released } = release(hit, 0, { ...NEUTRAL, moveY: 1 });
    expect(ch.isTumbling()).toBe(true);
    expectVector(released.afterInput, launch.vector);
  });

  it('uses the late up-air hit record for damage, base, growth and mirrored release', () => {
    const late = LINK_UAIR.hitWindows!.find(window => window.startFrame === 13)!;
    expect(late.damage).toBe(13);
    // Late up-air: 13%, angle 85, BKB 18, KBG 88 (SmashWiki Link (SSBU) up aerial; linkAttackData uair/Late hit).
    const lateHit = late.collisionHits![0]!;
    expect(lateHit.knockback!.reference).toMatchObject({ base: 18, growth: 88, angle: 85 });
    const hit: HitInfo = { damage: late.damage!, knockback: lateHit.knockback!, facing: -1 };
    const { ch, release } = world();
    const { launch, released } = release(hit, 100);
    const expected = computeReferenceKnockback({ base: 18, growth: 88, angle: 85 }, 113, 13, 104, -1);
    expect(ch.getDamagePercent()).toBe(113);
    expect(launch.referenceKnockback).toBeCloseTo(expected.referenceKnockback, 10);
    expectVector(released.afterInput, expected.vector);
    expect(released.afterPhysics.x).toBeLessThan(0);
    expect(released.afterPhysics.y).toBeLessThan(0);
    expect(launch.ordinaryHitstunFrames).toBe(expected.hitstunFrames);
    expect(ch.getHitstunRemaining()).toBe(getReferenceDamageSpeedUpGroups(expected.hitstunFrames, true).length - 1);
    const early = world().release(UAIR_HIT, 100).launch;
    expect(launch.magnitude).toBeLessThan(early.magnitude);
    expect(launch.hitstunFrames).toBeLessThan(early.hitstunFrames);
  });
});

describe('Reference launches and the project blast-zone boundary', () => {
  it.each([
    { name: 'forward tilt', hit: TILT_HIT, edge: 'right' },
    { name: 'up air', hit: UAIR_HIT, edge: 'top' },
  ] as const)('$name crosses the $edge boundary at high percent during hitstun', ({ hit, edge }) => {
    const stage = createFlatStage({ omitFloatingPlatforms: true });
    const ground = stage.platforms[0]!;
    const outcomes: boolean[] = [];
    for (const percent of [0, 100, 200, 300]) {
      // Use the actual flat-stage ground's supported Link centre as origin,
      // then an unobstructed world to isolate launch and boundary detection.
      // These are project regression brackets, not Ultimate KO thresholds.
      const fixture = world({ gravity: GAME_CONFIG.gravity });
      const origin = { x: ground.x, y: ground.y - ground.height / 2 - fixture.ch.getTuning().height / 2 };
      fixture.ch.resetForRound(origin.x, origin.y);
      const events: Array<KoEvent & { duringHitstun: boolean }> = [];
      const watcher = new BlastZonePositionWatcher(stage.blastZone, event => {
        events.push({ ...event, duringHitstun: fixture.ch.isInHitstun() });
      });
      watcher.registerPlayer(0, fixture.ch.body);
      expect(watcher.update(0)).toEqual([]);
      const { launch } = fixture.release(hit, percent);
      watcher.update(1);
      let crossingBefore: { x: number; y: number } | undefined;
      for (let frame = 2; frame <= launch.hitstunFrames + 1; frame++) {
        const { beforePosition } = fixture.step();
        if (watcher.update(frame).length > 0) crossingBefore = beforePosition;
      }
      expect(fixture.ch.getHitstunRemaining()).toBe(0);
      outcomes.push(events.length > 0);
      if (percent < 200) {
        expect(events, `${percent}% remains inside during hitstun`).toEqual([]);
        expect(watcher.isOutOfBounds(0)).toBe(false);
      } else {
        expect(events, `${percent}% emits exactly one boundary crossing`).toHaveLength(1);
        expect(events[0]).toMatchObject({ playerIndex: 0, edge, duringHitstun: true });
        expect(watcher.isOutOfBounds(0)).toBe(true);
        expect(crossingBefore).toBeDefined();
        if (edge === 'right') {
          expect(crossingBefore!.x).toBeLessThanOrEqual(stage.blastZone.right);
          expect(events[0]!.position.x).toBeGreaterThan(stage.blastZone.right);
        } else {
          expect(crossingBefore!.y).toBeGreaterThanOrEqual(stage.blastZone.top);
          expect(events[0]!.position.y).toBeLessThan(stage.blastZone.top);
        }
      }
    }
    expect(outcomes).toEqual([false, false, true, true]);
  });
});
