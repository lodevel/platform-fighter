import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DonkeyKong, DONKEYKONG_NEUTRAL_SPECIAL, DONKEYKONG_SMASH, DONKEYKONG_USMASH } from './DonkeyKong';
import { Link } from './Link';
import type { CharacterInput } from './Character';
import type { HitInfo } from './combat';
import { computeChargedDamageFromSpec, computeChargedKnockbackFromSpec } from './chargeSchema';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { GAME_CONFIG } from '../engine/constants';
import { BlastZonePositionWatcher, type KoEvent } from '../match/BlastZonePositionWatcher';
import { createFlatStage } from '../stages/stageDefinitions';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const PERCENTS = [0, 100, 150, 200] as const;
type FighterKind = 'link' | 'donkeykong';

const punchCharge = DONKEYKONG_NEUTRAL_SPECIAL.charge;
const FULL_PUNCH: HitInfo = {
  facing: 1,
  damage: computeChargedDamageFromSpec(punchCharge, punchCharge.maxChargeFrames),
  knockback: computeChargedKnockbackFromSpec(punchCharge, punchCharge.maxChargeFrames,
    DONKEYKONG_NEUTRAL_SPECIAL.knockback),
};
const TAP_PUNCH: HitInfo = {
  facing: 1, damage: DONKEYKONG_NEUTRAL_SPECIAL.damage,
  knockback: DONKEYKONG_NEUTRAL_SPECIAL.knockback,
};
const FORWARD_SMASH: HitInfo = {
  facing: 1, damage: DONKEYKONG_SMASH.collisionHits![0]!.damage!,
  knockback: DONKEYKONG_SMASH.knockback,
};
const UP_SMASH: HitInfo = {
  facing: 1, damage: DONKEYKONG_USMASH.damage, knockback: DONKEYKONG_USMASH.knockback,
};

/**
 * Independent reference-KB fixtures at the pre-hit percentages above, with
 * damage added once, neutral DI, no rage, and no stale/fresh modifier.
 * F-smash: damage22/BKB21/KBG88. U-smash: damage19/BKB40/KBG84.
 * Full Giant Punch: damage28/BKB35/KBG73 from SpecialNMax. These are
 * mathematical/engine regressions, not exact Ultimate KO-percent claims.
 */
const LAUNCH_CASES = [
  { name: 'full Giant Punch', hit: FULL_PUNCH, angle: 38, fixtures: {
    link: [90.222352941176, 240.516470588235, 315.663529411765, 390.810588235294],
    donkeykong: [85.958502202643, 221.024581497797, 288.557621145374, 356.090660792951],
  } },
  { name: 'uncharged far forward smash', hit: FORWARD_SMASH, angle: 46, fixtures: {
    link: [68.727058823529, 213.668235294118, 286.138823529412, 358.609411764706],
    donkeykong: [65.496211453744, 195.751718061674, 260.879471365639, 326.007224669603],
  } },
  { name: 'uncharged up smash', hit: UP_SMASH, angle: 90, fixtures: {
    link: [78.121176470588, 199.18, 259.709411764706, 320.238823529412],
    donkeykong: [75.790660792952, 184.583612334802, 238.980088105727, 293.376563876652],
  } },
] as const;

/** Real Matter flight with the same fixed-step coordinator used in matches. */
function flight(kind: FighterKind, hit: HitInfo, percent: number, originX?: number) {
  const stage = createFlatStage({ omitFloatingPlatforms: true });
  const ground = stage.platforms[0]!;
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
  const fighter = kind === 'link'
    ? new Link(scene, { spawnX: 0, spawnY: 0 })
    : new DonkeyKong(scene, { spawnX: 0, spawnY: 0 });
  // Supported body-center coordinates, but no platform bodies: contacts,
  // recovery inputs and stage collisions must not hide a launch regression.
  const origin = {
    x: originX ?? ground.x,
    y: ground.y - ground.height / 2 - fighter.getTuning().height / 2,
  };
  fighter.resetForRound(origin.x, origin.y);
  fighter.setDamagePercent(percent);
  const events: Array<KoEvent & { duringHitstun: boolean; before: { x: number; y: number } }> = [];
  let before = { ...origin };
  const watcher = new BlastZonePositionWatcher(stage.blastZone, event => {
    events.push({ ...event, duringHitstun: fighter.isInHitstun(), before: { ...before } });
  });
  watcher.registerPlayer(0, fighter.body);
  expect(watcher.update(0)).toEqual([]);
  let frame = 0;
  let releasedVelocity: { x: number; y: number } | undefined;
  let lateralCrossing: { beforeX: number; x: number; duringHitstun: boolean } | undefined;
  let peakY = origin.y;
  const step = () => {
    before = { ...fighter.getPosition() };
    const releasing = fighter.getHitlagRemaining() === 1;
    fighter.applyInput(NEUTRAL);
    if (releasing) releasedVelocity = { ...fighter.getVelocity() };
    stepCharacterPhysics({ characters: [fighter], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
    peakY = Math.min(peakY, fighter.getPosition().y);
    if (lateralCrossing === undefined && (fighter.getPosition().x < stage.blastZone.left
      || fighter.getPosition().x > stage.blastZone.right)) {
      lateralCrossing = { beforeX: before.x, x: fighter.getPosition().x,
        duringHitstun: fighter.isInHitstun() };
    }
    watcher.update(++frame);
  };
  const launch = fighter.applyHit(hit);
  expect(fighter.getHitlagRemaining()).toBeGreaterThan(0);
  for (let guard = 0; guard < 100 && fighter.getHitlagRemaining() > 0; guard++) step();
  expect(fighter.getHitlagRemaining()).toBe(0);
  expect(releasedVelocity).toBeDefined();
  for (let guard = 0; guard < 1000 && fighter.isInHitstun(); guard++) step();
  expect(fighter.getHitstunRemaining()).toBe(0);
  return { fighter, stage, origin, launch, releasedVelocity: releasedVelocity!, events, lateralCrossing, peakY, watcher };
}

describe('DK strong attacks retain percent-dependent launch through real Matter', () => {
  for (const kind of ['link', 'donkeykong'] as const) {
    for (const move of LAUNCH_CASES) {
      it(`${move.name} follows independent 0/100/150/200% fixtures against ${kind}`, () => {
        const velocities: number[] = [];
        for (const [index, percent] of PERCENTS.entries()) {
          const result = flight(kind, move.hit, percent);
          const expectedKB = move.fixtures[kind][index]!;
          expect(result.fighter.getDamagePercent()).toBeCloseTo(percent + move.hit.damage, 10);
          expect(result.launch.referenceKnockback).toBeCloseTo(expectedKB, 8);
          const speed = expectedKB * 0.03 * 5;
          // Airborne Sakurai launch uses the source's radian constant,
          // whose rounded display angle is 38 degrees.
          const angle = move.hit.knockback.reference?.angle === 361
            ? 0.663225 : move.angle * Math.PI / 180;
          const boost = move.angle === 90 || expectedKB < 80 ? 0 : kind === 'link' ? 0.525 : 0.25;
          expect(result.releasedVelocity.x).toBeCloseTo(speed * Math.cos(angle), 8);
          expect(result.releasedVelocity.y).toBeCloseTo(-speed * Math.sin(angle) - boost, 8);
          velocities.push(Math.hypot(result.releasedVelocity.x, result.releasedVelocity.y));
        }
        expect(velocities[1]).toBeGreaterThan(velocities[0]!);
        expect(velocities[2]).toBeGreaterThan(velocities[1]!);
        expect(velocities[3]).toBeGreaterThan(velocities[2]!);
        expect(velocities[2]).toBeGreaterThan(velocities[0]! * 2.5);
      });
    }
  }
});

describe('DK finishing attacks threaten the actual flat-stage blast zones', () => {
  for (const kind of ['link', 'donkeykong'] as const) {
    for (const move of LAUNCH_CASES.slice(0, 2)) {
      it.each([-1, 1] as const)(`${move.name} launches ${kind} past the lateral boundary facing %i`, facing => {
        for (const percent of PERCENTS) {
          const result = flight(kind, { ...move.hit, facing }, percent);
          if (percent === 0) {
            expect(result.events, 'the same finisher at 0% survives the complete hitstun').toEqual([]);
            expect(result.watcher.isOutOfBounds(0)).toBe(false);
          } else if (percent >= 150) {
            expect(result.events, `${percent}% emits one KO across the unchanged stage boundary`).toHaveLength(1);
            const event = result.events[0]!;
            expect(event).toMatchObject({ playerIndex: 0, duringHitstun: true });
            // The 46-degree f-smash can cross the ceiling first. The watcher
            // must emit that real first KO exactly once; the complete isolated
            // trajectory must also carry enough lateral momentum to clear the
            // side during hitstun. A match respawns at the first crossing.
            expect(['top', facing === 1 ? 'right' : 'left']).toContain(event.edge);
            const boundary = facing === 1 ? result.stage.blastZone.right : result.stage.blastZone.left;
            expect(result.lateralCrossing).toMatchObject({ duringHitstun: true });
            expect(result.lateralCrossing!.beforeX * facing).toBeLessThanOrEqual(boundary * facing);
            expect(result.lateralCrossing!.x * facing).toBeGreaterThan(boundary * facing);
            if (event.edge === 'top') {
              expect(event.before.y).toBeGreaterThanOrEqual(result.stage.blastZone.top);
              expect(event.position.y).toBeLessThan(result.stage.blastZone.top);
            } else {
              expect(event.before.x * facing).toBeLessThanOrEqual(boundary * facing);
              expect(event.position.x * facing).toBeGreaterThan(boundary * facing);
            }
            expect(result.watcher.isOutOfBounds(0)).toBe(true);
          }
        }
      });
    }

    it(`uncharged up smash launches ${kind} past the ceiling at 150/200%`, () => {
      for (const percent of PERCENTS) {
        const result = flight(kind, UP_SMASH, percent);
        if (percent === 0) {
          expect(result.events).toEqual([]);
          expect(result.watcher.isOutOfBounds(0)).toBe(false);
        } else if (percent >= 150) {
          expect(result.events, `${percent}% emits exactly one top KO during hitstun`).toHaveLength(1);
          const event = result.events[0]!;
          expect(event).toMatchObject({ playerIndex: 0, edge: 'top', duringHitstun: true });
          expect(event.before.y).toBeGreaterThanOrEqual(result.stage.blastZone.top);
          expect(event.position.y).toBeLessThan(result.stage.blastZone.top);
          expect(result.peakY).toBeLessThan(result.stage.blastZone.top);
        }
      }
    });
  }

  it('keeps an uncharged Giant Punch weaker, while still threatening an edge at 200%', () => {
    const center = flight('donkeykong', TAP_PUNCH, 150);
    expect(center.events).toEqual([]);
    expect(center.watcher.isOutOfBounds(0)).toBe(false);
    const ground = center.stage.platforms[0]!;
    const edge = flight('donkeykong', TAP_PUNCH, 200, ground.x + ground.width / 2 - 10);
    expect(edge.events).toHaveLength(1);
    expect(edge.events[0]).toMatchObject({ edge: 'right', duringHitstun: true });
    expect(edge.launch.magnitude).toBeLessThan(flight('donkeykong', FULL_PUNCH, 200).launch.magnitude);
  });
});
