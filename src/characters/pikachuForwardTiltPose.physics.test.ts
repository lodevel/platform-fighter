import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { pikachuSourceHits } from './pikachuSourceMoves';
import { buildPikachuNormalMove, pikachuNormalFrame } from './pikachuNormalMoves';
import { pikachuForwardTiltPoseProjector, PIKACHU_FTILT_SOURCE_CENTRES } from './pikachuForwardTiltPose';
import { Character, CHARACTER_LABEL, type CharacterInput } from './Character';
import { registerFighterAttack } from './attackRegistration';
import { spawnHitbox } from './attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function world() {
  const engine = Engine.create(); engine.gravity.y = 0;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
  } }, world: { remove(body: any) { Composite.remove(engine.world, body); },
    on(name: string, fn: any) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: any) { Events.off(engine, names[name] ?? name, fn); } } } };
  return { engine, scene };
}

/** Source-only pose calibration and narrowphase execution, not generated art
 * acceptance or native skeletal/hurtbox parity. One-pixel contact probes. */
describe('Reviewed Pikachu neutral forward-tilt 2D projections', () => {
  it('preserves all native attack numbers and uses each active image separately', () => {
    for (const frame of [6, 7, 8] as const) {
      const hits = pikachuSourceHits('pikachu/AttackS3', frame, pikachuForwardTiltPoseProjector);
      expect(hits.map(hit => hit.capsule.radius)).toEqual([17.5, 15, 12.5]);
      expect(hits.every(hit => hit.damage === 9 && hit.knockback?.reference?.angle === 361)).toBe(true);
      for (const hit of hits) {
        const point = PIKACHU_FTILT_SOURCE_CENTRES[frame][hit.id as 0 | 1 | 2];
        expect(hit.capsule.start.x).toBeCloseTo((point.x - 420) * 70 / 557, 10);
        expect(hit.capsule.start.y).toBeCloseTo(25 + (point.y - 586) * 70 / 557, 10);
        expect(hit.capsule.end).toEqual(hit.capsule.start);
      }
    }
    expect(pikachuSourceHits('pikachu/AttackS3', 5, pikachuForwardTiltPoseProjector)).toEqual([]);
    expect(pikachuSourceHits('pikachu/AttackS3', 9, pikachuForwardTiltPoseProjector)).toEqual([]);
  });
  it('rejects unsupported frame, variant, source copies and unmeasured bone axes', () => {
    const row = PIKACHU_NATIVE_ATTACKS['pikachu/AttackS3'][0]!;
    expect(() => pikachuForwardTiltPoseProjector(row, 5)).toThrow('Missing reviewed');
    expect(() => pikachuForwardTiltPoseProjector(row, 6.5)).toThrow('Missing reviewed');
    expect(() => pikachuSourceHits('pikachu/AttackS3Hi', 6, pikachuForwardTiltPoseProjector)).toThrow('Unsupported');
    expect(() => pikachuForwardTiltPoseProjector({ ...row }, 6)).toThrow('Unsupported');
  });

  for (const gameFrame of [6, 7, 8]) for (const facing of [1, -1] as const) {
    it(`contacts foot/knee/hip and rejects circle-edge miss at source${gameFrame}, facing${facing}`, () => {
      const source = pikachuNormalFrame('forward-tilt', gameFrame - 1, pikachuForwardTiltPoseProjector);
      const foot = source.collisionHits[0]!, knee = source.collisionHits[1]!, hip = source.collisionHits[2]!;
      const points = [
        { name: 'foot-centre', x: foot.capsule.start.x, y: foot.capsule.start.y, region: 0 },
        { name: 'outer-edge-hit', x: foot.capsule.start.x + foot.capsule.radius + 0.4, y: foot.capsule.start.y, region: 0 },
        { name: 'outer-edge-miss', x: foot.capsule.start.x + foot.capsule.radius + 0.6, y: foot.capsule.start.y, region: null },
        { name: 'knee-centre', x: knee.capsule.start.x, y: knee.capsule.start.y, region: gameFrame === 6 ? 1 : 0 },
        { name: 'hip-centre', x: hip.capsule.start.x, y: hip.capsule.start.y, region: 2 },
      ];
      for (const point of points) {
        const { engine, scene } = world();
        const target = Bodies.rectangle(point.x * facing, point.y, 1, 1, { isStatic: true, isSensor: true,
          label: CHARACTER_LABEL, plugin: { characterId: 'probe' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
        Composite.add(engine.world, target);
        const move = buildPikachuNormalMove('forward-tilt', pikachuForwardTiltPoseProjector);
        const sensor = spawnHitbox(scene as unknown as PhysicsHost, { id: 'fixture', bodyId: 999, position: { x: 0, y: 0 } },
          { ...move, collisionHits: source.collisionHits }, facing);
        const hits: { region?: number; damage: number }[] = [];
        const handler = new HitboxDamageHandler((_target, hit, context) => {
          hits.push({ region: context.collisionHitId, damage: hit.damage }); return { confirmed: true };
        });
        handler.registerPlayer(1, target); handler.setGroundedLookup(() => true);
        handler.setHurtboxLookup(() => [{ id: 'probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }]);
        Engine.update(engine, 1000 / 60); handler.sampleHurtboxContacts([sensor]);
        expect(hits, point.name).toEqual(point.region === null ? [] : [{ region: point.region, damage: 9 }]);
      }
    });
  }

  it.each([1, -1] as const)('keeps one strike through the three actual Character pose snapshots, facing%s', facing => {
    const { engine, scene } = world(); engine.gravity.y = 1;
    const actor = new Character(scene, { id: 'donkeykong', spawnX: 0, spawnY: 0, width: 40, height: 50 });
    const move = buildPikachuNormalMove('forward-tilt', pikachuForwardTiltPoseProjector);
    registerFighterAttack(actor, move);
    const target = Bodies.rectangle(75 * facing, -4, 1, 1, { isStatic: true, isSensor: true, label: CHARACTER_LABEL,
      plugin: { characterId: 'probe' }, collisionFilter: { category: COLLISION_CATEGORIES.CHARACTER } });
    const floor = Bodies.rectangle(0, 35, 2000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
      collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
    Composite.add(engine.world, [target, floor]);
    const hits: { frame?: number; damage: number }[] = [], samples: { frame: number; sensor: number | null }[] = [];
    const handler = new HitboxDamageHandler((_target, hit) => { hits.push({ frame: actor.getActiveAttack()?.framesElapsed, damage: hit.damage }); return { confirmed: true }; });
    handler.registerPlayer(0, actor.body); handler.registerPlayer(1, target); handler.setGroundedLookup(() => true);
    handler.setHurtboxLookup(index => index === 0 ? actor.getActiveHurtboxes() : [{ id: 'probe', offsetX: 0, offsetY: 0, width: 1, height: 1 }]);
    const step = (input: CharacterInput = neutral) => {
      actor.applyInput(input);
      const active = actor.getActiveAttack(); if (active) samples.push({ frame: active.framesElapsed, sensor: active.hitboxBody?.id ?? null });
      stepCharacterPhysics({ characters: [actor], bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body,
        deltaMs: 1000 / 60, stepWorld: dt => { Engine.update(engine, dt); handler.sampleHurtboxContacts(Composite.allBodies(engine.world)); } });
    };
    for (let i = 0; i < 12; i++) step(); actor.setFacing(facing); step({ ...neutral, attack: true });
    for (let i = 0; i < 29; i++) step();
    expect(hits).toEqual([{ frame: 5, damage: 9 }]);
    expect(samples.filter(sample => sample.frame >= 5 && sample.frame <= 7).every(sample => sample.sensor !== null)).toBe(true);
    expect(new Set(samples.filter(sample => sample.frame >= 5 && sample.frame <= 7).map(sample => sample.sensor)).size).toBe(3);
    expect(samples.find(sample => sample.frame === 8)?.sensor).toBeNull();
    expect(actor.getActiveAttack()).toBeNull();
  });
});
