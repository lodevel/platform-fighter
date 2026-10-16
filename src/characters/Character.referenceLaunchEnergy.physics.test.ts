import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_NAIR, LINK_TILT, LINK_UAIR } from './Link';
import { DonkeyKong } from './DonkeyKong';
import type { Character, CharacterInput } from './Character';
import type { HitInfo } from './combat';
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
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const TILT: HitInfo = { damage: LINK_TILT.damage, knockback: LINK_TILT.knockback, facing: 1 };
const UAIR: HitInfo = { damage: LINK_UAIR.damage, knockback: LINK_UAIR.knockback, facing: 1 };
type Vector = { x: number; y: number };

function world(fighter: 'link' | 'donkeykong' = 'link') {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, settings: object) {
      const body = Bodies.rectangle(x, y, width, height, settings);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const ch = fighter === 'link'
    ? new Link(scene, { spawnX: 0, spawnY: 0 })
    : new DonkeyKong(scene, { spawnX: 0, spawnY: 0 });
  const characters: Character[] = [ch];
  const contacts: Array<{ bodyA: unknown; bodyB: unknown; normal: Vector }> = [];
  for (const event of ['collisionStart', 'collisionActive']) {
    Events.on(engine, event, ({ pairs }: { pairs: any[] }) => {
      for (const pair of pairs) contacts.push({ bodyA: pair.bodyA, bodyB: pair.bodyB,
        normal: { ...pair.collision.normal } });
    });
  }
  const addFighter = (id: 'link' | 'donkeykong', position = { x: 10000, y: 0 }) => {
    const other = id === 'link'
      ? new Link(scene, { spawnX: position.x, spawnY: position.y })
      : new DonkeyKong(scene, { spawnX: position.x, spawnY: position.y });
    characters.push(other);
    return other;
  };
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    for (const other of characters.slice(1)) other.applyInput(NEUTRAL);
    stepCharacterPhysics({ characters, bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    return { position: { ...ch.getPosition() }, velocity: { ...ch.getVelocity() } };
  };
  const release = (hit = TILT, percent = 100) => {
    ch.setDamagePercent(percent);
    const launch = ch.applyHit(hit);
    expect(ch.getHitlagRemaining()).toBeGreaterThan(0);
    for (let frame = 0; frame < 100 && ch.getHitlagRemaining() > 1; frame++) step();
    expect(ch.getHitlagRemaining()).toBe(1);
    const released = step();
    expect(ch.getHitlagRemaining()).toBe(0);
    expect(ch.getHitstunRemaining()).toBe(launch.hitstunFrames);
    return { launch, released };
  };
  const finishHitstun = () => {
    for (let frame = 0; frame < 300 && ch.isInHitstun(); frame++) step();
    expect(ch.getHitstunRemaining()).toBe(0);
  };
  const addCeiling = () => {
    const roof = Bodies.rectangle(0, -ch.getTuning().height / 2 - 14, 4000, 20, {
      isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
    });
    Composite.add(engine.world, roof);
    return roof;
  };
  return { ch, engine, step, release, finishHitstun, addCeiling, addFighter, contacts };
}

function expectVector(actual: Vector, expected: Vector, label = '') {
  expect(actual.x, `${label} x`).toBeCloseTo(expected.x, 7);
  expect(actual.y, `${label} y`).toBeCloseTo(expected.y, 7);
}

/** Closed-form sums, independent of the runtime energy and knockback helpers. */
function neutralLaunchSample(frame: number, kb: number, boost: number, gravity: number, cap: number,
  angle = 0.663225, verticalHitstun?: number) {
  const initial = { x: kb * 0.15 * Math.cos(angle), y: -kb * 0.15 * Math.sin(angle) - boost };
  const magnitude = Math.hypot(initial.x, initial.y);
  const scale = Math.max(0, 1 - frame * 0.255 / magnitude);
  const lastMovingFrame = Math.min(frame, Math.floor(magnitude / 0.255));
  const launchSum = lastMovingFrame + 1 - 0.255 / magnitude * lastMovingFrame * (lastMovingFrame + 1) / 2;
  const stunnedFrame = Math.min(frame, verticalHitstun ?? frame);
  const lastUncappedGravityFrame = Math.min(stunnedFrame, Math.floor(cap / gravity));
  let gravitySum = gravity * lastUncappedGravityFrame * (lastUncappedGravityFrame + 1) / 2
    + (stunnedFrame - lastUncappedGravityFrame) * cap;
  let gravityY = Math.min(frame * gravity, cap);
  if (verticalHitstun !== undefined && frame > verticalHitstun) {
    const freeSteps = frame - verticalHitstun;
    // Link's vertical profile falls from 9 to the ordinary 8-pixel cap.
    const aboveCapSteps = Math.min(freeSteps, 2);
    gravitySum += aboveCapSteps * 9 - 0.48 * aboveCapSteps * (aboveCapSteps + 1) / 2
      + (freeSteps - aboveCapSteps) * 8;
    gravityY = Math.max(8, 9 - freeSteps * 0.48);
  }
  return {
    velocity: { x: initial.x * scale, y: initial.y * scale + gravityY },
    position: { x: initial.x * launchSum, y: initial.y * launchSum + gravitySum },
  };
}

describe('Reference launch and gravity energy through real Matter', () => {
  it.each([
    { fighter: 'link', kb: 165.14529411764704, boost: 0.525, gravity: 0.48, cap: 8,
      ordinaryHitstun: 65, displayedHitstun: 44, checkpoints: { 0: 1, 1: 6, 5: 19, 10: 30 } },
    { fighter: 'donkeykong', kb: 155.48070484581498, boost: 0.25, gravity: 0.425, cap: 8.15,
      ordinaryHitstun: 61, displayedHitstun: 43, checkpoints: { 0: 0, 1: 4, 5: 17, 10: 27 } },
  ] as const)('$fighter compresses ordinary tilt trajectory ticks through eight free steps', parameters => {
    const { ch, release, step } = world(parameters.fighter);
    const { launch, released } = release();
    expect(launch.hitstunFrames).toBe(parameters.displayedHitstun);
    expect(launch.ordinaryHitstunFrames).toBe(parameters.ordinaryHitstun);
    for (let frame = 0; frame <= parameters.displayedHitstun + 8; frame++) {
      const actual = frame === 0 ? released : step();
      // Explicit source checkpoints, independent of the scheduling helper.
      const tick = frame >= parameters.displayedHitstun
        ? parameters.ordinaryHitstun + frame - parameters.displayedHitstun
        : (parameters.checkpoints as Record<number, number>)[frame];
      if (tick !== undefined) {
        const expected = neutralLaunchSample(tick, parameters.kb, parameters.boost, parameters.gravity, parameters.cap);
        expectVector(actual.velocity, expected.velocity, `display ${frame}, ordinary ${tick} velocity`);
        expectVector(actual.position, expected.position, `display ${frame}, ordinary ${tick} position`);
      }
      expect(ch.getHitstunRemaining()).toBe(Math.max(0, parameters.displayedHitstun - frame));
    }
    // Launch still exists beyond hitstun; neutral air damping must not own it.
    expect(ch.getVelocity().x).toBeGreaterThan(0);
  });

  it('compresses early up-air through vertical gravity and the first eight actionable steps', () => {
    const fixture = world();
    const { launch, released } = fixture.release(UAIR);
    expect(launch.ordinaryHitstunFrames).toBe(64);
    expect(launch.hitstunFrames).toBe(44);
    const checkpoints: Record<number, number> = { 0: 0, 1: 4, 5: 18, 10: 29 };
    // Independent formula: ((115/10 + 115*15/20)*1.4*200/204 + 18)*.93 + 23.
    const kb = ((11.5 + 86.25) * 1.4 * 200 / 204 + 18) * 0.93 + 23;
    for (let frame = 0; frame <= 52; frame++) {
      const actual = frame === 0 ? released : fixture.step();
      const tick = frame >= 44 ? 64 + frame - 44 : checkpoints[frame];
      if (tick !== undefined) {
        const expected = neutralLaunchSample(tick, kb, 0, 0.38472, 9, 85 * Math.PI / 180, 64);
        expectVector(actual.velocity, expected.velocity, `uair display ${frame} velocity`);
        expectVector(actual.position, expected.position, `uair display ${frame} position`);
      }
      expect(fixture.ch.getHitstunRemaining()).toBe(Math.max(0, 44 - frame));
    }
  });

  it('integrates different Link and DK launch groups together without sharing their clocks', () => {
    const fixture = world();
    const dk = fixture.addFighter('donkeykong');
    dk.setDamagePercent(100);
    const dkLaunch = dk.applyHit(TILT);
    const { launch } = fixture.release();
    expect([launch.hitstunFrames, dkLaunch.hitstunFrames]).toEqual([44, 43]);
    const linkTicks: Record<number, number> = { 0: 1, 1: 6, 5: 19, 10: 30, 44: 65 };
    const dkTicks: Record<number, number> = { 0: 0, 1: 4, 5: 17, 10: 27, 43: 61, 44: 62 };
    for (let frame = 0; frame <= 44; frame++) {
      if (frame > 0) fixture.step();
      if (linkTicks[frame] !== undefined) {
        const expected = neutralLaunchSample(linkTicks[frame]!, 165.14529411764704, 0.525, 0.48, 8);
        expectVector(fixture.ch.getVelocity(), expected.velocity, `Link display ${frame}`);
        expectVector(fixture.ch.getPosition(), expected.position, `Link position ${frame}`);
      }
      if (dkTicks[frame] !== undefined) {
        const expected = neutralLaunchSample(dkTicks[frame]!, 155.48070484581498, 0.25, 0.425, 8.15);
        expectVector(dk.getVelocity(), expected.velocity, `DK display ${frame}`);
        expectVector(dk.getPosition(), { x: expected.position.x + 10000, y: expected.position.y }, `DK position ${frame}`);
      }
      expect(fixture.ch.getHitstunRemaining()).toBe(Math.max(0, 44 - frame));
      expect(dk.getHitstunRemaining()).toBe(Math.max(0, 43 - frame));
    }
  });

  it('leaves an unrelated fighter attack and projectile on the ordinary outer-frame clock', () => {
    const fixture = world();
    const ordinary = fixture.addFighter('link');
    const baseline = world();
    baseline.ch.resetForRound(10000, 0);
    expect(ordinary.attemptAttack(LINK_NAIR.id)).toBe(true);
    expect(baseline.ch.attemptAttack(LINK_NAIR.id)).toBe(true);
    const projectile = Bodies.rectangle(-5000, 0, 10, 10, { isSensor: true, frictionAir: 0, ignoreGravity: true });
    Composite.add(fixture.engine.world, projectile);
    Body.setVelocity(projectile, { x: 3, y: -2 });
    fixture.ch.setDamagePercent(100);
    fixture.ch.applyHit(TILT);
    const frames = fixture.ch.getHitlagRemaining() + 8;
    for (let frame = 1; frame <= frames; frame++) {
      fixture.step();
      baseline.step();
      expectVector(ordinary.getPosition(), baseline.ch.getPosition(), `normal position ${frame}`);
      expectVector(ordinary.getVelocity(), baseline.ch.getVelocity(), `normal velocity ${frame}`);
      expect(ordinary.getActiveAttack()?.framesElapsed).toBe(baseline.ch.getActiveAttack()?.framesElapsed);
      expectVector(projectile.position, { x: -5000 + 3 * frame, y: -2 * frame }, `projectile ${frame}`);
      expectVector(projectile.velocity, { x: 3, y: -2 });
      expect(fixture.engine.timing.timestamp).toBeCloseTo(frame * GAME_CONFIG.fixedTimestepMs, 7);
    }
  });

  it('does not drain hitlag or consume a paused launch group during another fighter’s compressed step', () => {
    const fixture = world();
    const other = fixture.addFighter('donkeykong');
    other.setDamagePercent(100);
    other.applyHit(TILT);
    fixture.release();
    const continuous = world();
    continuous.release();
    const frozenPosition = { ...fixture.ch.getPosition() };
    fixture.ch.armAttackerHitlag(4);
    for (let frame = 0; frame < 3; frame++) {
      fixture.step();
      expect(fixture.ch.getHitlagRemaining()).toBe(3 - frame);
      expect(fixture.ch.getHitstunRemaining()).toBe(44);
      expectVector(fixture.ch.getPosition(), frozenPosition, `grouped freeze ${frame}`);
    }
    expect(other.getHitstunRemaining()).toBe(40);
    for (let frame = 0; frame < 5; frame++) {
      const resumed = fixture.step();
      const expected = continuous.step();
      expectVector(resumed.position, expected.position, `resumed position ${frame}`);
      expectVector(resumed.velocity, expected.velocity, `resumed velocity ${frame}`);
      expect(fixture.ch.getHitstunRemaining()).toBe(43 - frame);
    }
  });

  it.each(['wall', 'ceiling'] as const)('resolves a thin %s inside a grouped frame before the fighter can pass through it', obstacle => {
    const fixture = world();
    fixture.release(obstacle === 'wall' ? TILT : UAIR);
    const bounds = fixture.ch.body.bounds;
    const nearEdge = obstacle === 'wall' ? bounds.max.x + 10 : bounds.min.y - 10;
    const surface = obstacle === 'wall'
      ? Bodies.rectangle(nearEdge + 2, fixture.ch.getPosition().y, 4, 4000, { isStatic: true,
        label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } })
      : Bodies.rectangle(fixture.ch.getPosition().x, nearEdge - 2, 4000, 4, { isStatic: true,
        label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
    Composite.add(fixture.engine.world, surface);
    fixture.step();
    const touched = fixture.contacts.filter(pair =>
      (pair.bodyA === surface && pair.bodyB === fixture.ch.body)
      || (pair.bodyB === surface && pair.bodyA === fixture.ch.body));
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.some(pair => Math.abs(obstacle === 'wall' ? pair.normal.x : pair.normal.y) > 0.9)).toBe(true);
    for (let frame = 0; frame < 3; frame++) {
      if (obstacle === 'wall') expect(fixture.ch.body.bounds.max.x).toBeLessThanOrEqual(nearEdge + 0.2);
      else expect(fixture.ch.body.bounds.min.y).toBeGreaterThanOrEqual(nearEdge - 0.2);
      fixture.step();
    }
  });

  it('keeps the final compressed step locked and starts a buffered aerial on the first free input step', () => {
    const fixture = world();
    fixture.release();
    for (let frame = 1; frame <= 44; frame++) {
      fixture.step(frame === 44 ? { ...NEUTRAL, attack: true } : NEUTRAL);
      expect(fixture.ch.getActiveAttack()).toBeNull();
    }
    expect(fixture.ch.getHitstunRemaining()).toBe(0);
    const finalLocked = neutralLaunchSample(65, 165.14529411764704, 0.525, 0.48, 8);
    expectVector(fixture.ch.getPosition(), finalLocked.position);
    fixture.step();
    expect(fixture.ch.getActiveAttack()?.move.id).toBe(LINK_NAIR.id);
    expectVector(fixture.ch.getPosition(), neutralLaunchSample(66, 165.14529411764704, 0.525, 0.48, 8).position);
  });

  it('keeps vertical launch gravity capped at 9 through the last stunned ceiling step, then approaches 8', () => {
    const fixture = world();
    const roof = fixture.addCeiling();
    fixture.release(UAIR);
    expect(fixture.contacts.some(pair =>
      (pair.bodyA === roof || pair.bodyB === roof) &&
      (pair.bodyA === fixture.ch.body || pair.bodyB === fixture.ch.body))).toBe(true);
    fixture.finishHitstun();
    expect(fixture.ch.getVelocity().y).toBeCloseTo(9, 7);
    expect(fixture.ch.isTumbling()).toBe(true);
    for (const expectedY of [8.52, 8.04, 8, 8]) {
      expect(fixture.step().velocity.y).toBeCloseTo(expectedY, 7);
    }
  });

  it('preserves wind added after ceiling hitstun while the gravity component returns to its normal cap', () => {
    const calm = world();
    const windy = world();
    for (const fixture of [calm, windy]) {
      fixture.addCeiling();
      fixture.release(UAIR);
      fixture.finishHitstun();
    }
    const velocity = windy.ch.getVelocity();
    Body.setVelocity(windy.ch.body, { x: velocity.x, y: velocity.y + 4 });
    const startOffset = windy.ch.getPosition().y - calm.ch.getPosition().y;
    for (let frame = 1; frame <= 4; frame++) {
      const calmStep = calm.step();
      const windyStep = windy.step();
      expect(windyStep.velocity.y - calmStep.velocity.y).toBeCloseTo(4, 7);
      expect(windyStep.position.y - calmStep.position.y - startOffset).toBeCloseTo(frame * 4, 7);
    }
    expect(calm.ch.getVelocity().y).toBeCloseTo(8, 7);
    expect(windy.ch.getVelocity().y).toBeCloseTo(12, 7);
  });

  it('lets free horizontal input act on control motion without damping retained launch', () => {
    const neutral = world();
    const steering = world();
    for (const fixture of [neutral, steering]) {
      fixture.release();
      fixture.finishHitstun();
    }
    const held: CharacterInput = { ...NEUTRAL, moveX: -1 };
    const firstNeutral = neutral.step();
    const firstSteered = steering.step(held);
    expect(firstSteered.velocity.x).toBeGreaterThan(0);
    expect(firstSteered.velocity.x).toBeLessThan(firstNeutral.velocity.x);
    expect(firstSteered.velocity.y).toBeCloseTo(firstNeutral.velocity.y, 7);
    const residual = firstSteered.velocity.x - firstNeutral.velocity.x;
    const nextNeutral = neutral.step();
    const nextSteered = steering.step();
    expect(nextSteered.velocity.x - nextNeutral.velocity.x)
      .toBeCloseTo(residual * steering.ch.getTuning().airDamping, 7);
  });

  it('retains launch and gravity when a normal aerial begins after hitstun', () => {
    const idle = world();
    const attacking = world();
    for (const fixture of [idle, attacking]) {
      fixture.release();
      fixture.finishHitstun();
    }
    expect(attacking.ch.attemptAttack(LINK_NAIR.id)).toBe(true);
    expect(attacking.ch.getActiveAttack()?.move.id).toBe(LINK_NAIR.id);
    for (let frame = 0; frame < 10; frame++) {
      expectVector(attacking.step().velocity, idle.step().velocity, `aerial step ${frame}`);
    }
  });

  it('replaces vertical energy with a jump and never reapplies the old launch decay or gravity', () => {
    const launched = world();
    launched.release();
    launched.finishHitstun();
    const fresh = world();
    fresh.ch.resetForRound(launched.ch.getPosition().x, launched.ch.getPosition().y);
    Body.setVelocity(fresh.ch.body, launched.ch.getVelocity());
    const jump: CharacterInput = { ...NEUTRAL, jump: true };
    for (let frame = 0; frame < 6; frame++) {
      const expected = fresh.step(jump);
      const actual = launched.step(jump);
      expect(actual.velocity.y, `jump step ${frame}`).toBeCloseTo(expected.velocity.y, 7);
      expect(actual.position.y, `jump position ${frame}`).toBeCloseTo(expected.position.y, 7);
    }
    expect(launched.ch.getJumpsUsed()).toBe(1);
    expect(launched.ch.isTumbling()).toBe(false);
    expect(launched.ch.getVelocity().y).toBeLessThan(0);
  });

  it('a new legacy hit clears reference gravity and launch state before its own release', () => {
    const launched = world();
    launched.release(UAIR);
    launched.finishHitstun();
    const fresh = world();
    fresh.ch.resetForRound(launched.ch.getPosition().x, launched.ch.getPosition().y);
    const legacy: HitInfo = { damage: 1, facing: 1, knockback: { x: 3, y: -4, scaling: 0 } };
    const oldRelease = launched.release(legacy, 0);
    const freshRelease = fresh.release(legacy, 0);
    expectVector(oldRelease.released.velocity, freshRelease.released.velocity);
    for (let frame = 0; frame < 5; frame++) {
      expectVector(launched.step().velocity, fresh.step().velocity, `new hit step ${frame}`);
    }
  });
});

describe('Reference gravity after a delayed ceiling collision', () => {
  it('rebuilds gravity canceled by the solver instead of retaining a permanent fall-speed deficit', () => {
    const fixture = world();
    fixture.release(UAIR);
    // Let damage-fly-top gravity accumulate before introducing a ceiling.
    // A roof touched on the release step has zero accumulated gravity and
    // cannot detect stale gravity bookkeeping after the solver cancels Y.
    for (let frame = 0; frame < 8; frame++) fixture.step();
    expect(fixture.ch.getVelocity().y).toBeLessThan(0);
    const roof = fixture.addCeiling();
    const position = fixture.ch.getPosition();
    Body.setPosition(roof, {
      x: position.x,
      y: position.y - fixture.ch.getTuning().height / 2 - 14,
    });
    fixture.step();
    expect(fixture.contacts.some(pair =>
      (pair.bodyA === roof || pair.bodyB === roof) &&
      (pair.bodyA === fixture.ch.body || pair.bodyB === fixture.ch.body))).toBe(true);
    expect(fixture.ch.getHitstunRemaining()).toBeGreaterThan(30);
    fixture.finishHitstun();
    expect(fixture.ch.getVelocity().y).toBeCloseTo(9, 7);
    for (const expectedY of [8.52, 8.04, 8, 8]) {
      expect(fixture.step().velocity.y).toBeCloseTo(expectedY, 7);
    }
  });
});

describe('Reference launch ownership after hitstun', () => {
  it('pauses both energy clocks during outgoing hitlag and resumes the next active trajectory step', () => {
    const paused = world();
    const continuous = world();
    for (const fixture of [paused, continuous]) {
      fixture.release();
      fixture.finishHitstun();
      expect(fixture.ch.attemptAttack(LINK_NAIR.id)).toBe(true);
      fixture.step();
    }
    const frozenPosition = { ...paused.ch.getPosition() };
    paused.ch.armAttackerHitlag(4);
    for (let frame = 0; frame < 3; frame++) {
      paused.step();
      expectVector(paused.ch.getPosition(), frozenPosition, `freeze ${frame}`);
    }
    expect(paused.ch.getHitlagRemaining()).toBe(1);
    for (let frame = 0; frame < 8; frame++) {
      const resumed = paused.step();
      const uninterrupted = continuous.step();
      expectVector(resumed.velocity, uninterrupted.velocity, `resumed velocity ${frame}`);
      expectVector(resumed.position, uninterrupted.position, `resumed position ${frame}`);
    }
  });

  it.each(['directional dodge', 'up special'] as const)('%s replaces the old launch and gravity ownership', action => {
    const launched = world();
    launched.release();
    launched.finishHitstun();
    const fresh = world();
    fresh.ch.resetForRound(launched.ch.getPosition().x, launched.ch.getPosition().y);
    Body.setVelocity(fresh.ch.body, launched.ch.getVelocity());
    const input: CharacterInput = action === 'directional dodge'
      ? { ...NEUTRAL, moveX: 1, moveY: -1, dodge: true }
      : { ...NEUTRAL, moveY: -1, special: true };
    for (let frame = 0; frame < 12; frame++) {
      const actual = launched.step(frame === 0 ? input : NEUTRAL);
      const expected = fresh.step(frame === 0 ? input : NEUTRAL);
      expectVector(actual.velocity, expected.velocity, `${action} velocity ${frame}`);
      expectVector(actual.position, expected.position, `${action} position ${frame}`);
      if (frame === 0) {
        if (action === 'directional dodge') expect(launched.ch.isDodging()).toBe(true);
        else expect(launched.ch.getActiveAttack()?.move.type).toBe('upSpecial');
      }
    }
    expect(launched.ch.isTumbling()).toBe(false);
  });

  it('fastfall replaces only natural gravity while retained launch and external wind continue', () => {
    const ordinary = world();
    const fast = world();
    const wind = 3;
    for (const fixture of [ordinary, fast]) {
      fixture.release();
      fixture.finishHitstun();
      expect(fixture.ch.getVelocity().y).toBeGreaterThan(0);
      const velocity = fixture.ch.getVelocity();
      Body.setVelocity(fixture.ch.body, { x: velocity.x, y: velocity.y + wind });
    }
    const gravityDifference = fast.ch.getTuning().fastFallSpeed - 8;
    for (let frame = 0; frame < 60; frame++) {
      const ordinaryStep = ordinary.step();
      const fastStep = fast.step(frame === 0 ? { ...NEUTRAL, moveY: 1 } : NEUTRAL);
      expect(fastStep.velocity.x, `launch x ${frame}`).toBeCloseTo(ordinaryStep.velocity.x, 7);
      expect(fastStep.velocity.y - ordinaryStep.velocity.y, `gravity difference ${frame}`)
        .toBeCloseTo(gravityDifference, 7);
    }
    expect(ordinary.ch.getVelocity().y).toBeCloseTo(8 + wind, 7);
    expect(fast.ch.getVelocity().y).toBeCloseTo(fast.ch.getTuning().fastFallSpeed + wind, 7);
  });
});

describe('Reference gravity after wall friction', () => {
  it('recovers full natural fall speed after wall contact removes vertical motion', () => {
    // Phaser changes these raw-Matter defaults in production. Use the same
    // resting-contact thresholds so the wall's tangent friction is exercised.
    const Resolver = require('../physics/matter/source/lib/collision/Resolver.js');
    const previousThresholds = {
      normal: Resolver._restingThresh, tangent: Resolver._restingThreshTangent,
    };
    Resolver._restingThresh = 4;
    Resolver._restingThreshTangent = 6;
    try {
      const fixture = world();
      const wall = Bodies.rectangle(115, -1000, 20, 4000, {
        isStatic: true, label: PLATFORM_LABELS.solid,
        collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
      });
      Composite.add(fixture.engine.world, wall);
      let touchedWall = false;
      Events.on(fixture.engine, 'collisionStart', ({ pairs }: { pairs: any[] }) => {
        touchedWall ||= pairs.some(pair =>
          (pair.bodyA === wall || pair.bodyB === wall) &&
          (pair.bodyA === fixture.ch.body || pair.bodyB === fixture.ch.body));
      });
      fixture.release(TILT, 100);
      fixture.finishHitstun();
      expect(touchedWall).toBe(true);
      // Allow the launch component to finish decaying before checking the
      // natural component. Removing the wall isolates any stale gravity
      // bookkeeping from ongoing solver friction or other contact effects.
      for (let frame = 0; frame < 40; frame++) fixture.step();
      Composite.remove(fixture.engine.world, wall);
      for (let frame = 0; frame < 30; frame++) fixture.step();
      for (let frame = 0; frame < 6; frame++) {
        expect(fixture.step().velocity.y, `free fall ${frame}`).toBeCloseTo(8, 7);
      }
    } finally {
      Resolver._restingThresh = previousThresholds.normal;
      Resolver._restingThreshTangent = previousThresholds.tangent;
    }
  });
});
