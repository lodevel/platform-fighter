import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { Link } from '../characters/Link';
import { DONKEYKONG_NEUTRAL_SPECIAL } from '../characters/DonkeyKong';
import { computeChargedDamageFromSpec, computeChargedKnockbackFromSpec } from '../characters/chargeSchema';
import type { CharacterInput } from '../characters/Character';
import { stepCharacterPhysics } from '../characters/stepCharacterPhysics';
import { CHARACTER_SLOT_BITS, COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';
import { GAME_CONFIG } from '../engine/constants';
import { FLAT_STAGE } from '../stages/stageDefinitions';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };

// Compile the actual scene method without importing its graphics/audio scene
// dependencies. This runs production mask/landing logic, rather than a copied
// test implementation, against the real Phaser Matter bodies and coordinator.
const sceneSource = ts.createSourceFile('MatchSim.ts',
  readFileSync(new URL('../sim/MatchSim.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const sceneClass = sceneSource.statements.find((node): node is ts.ClassDeclaration =>
  ts.isClassDeclaration(node) && node.name?.text === 'MatchSim')!;
const maskMethod = sceneClass.members.find((node): node is ts.MethodDeclaration =>
  ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) &&
  node.name.text === 'updatePassThroughPlatformMasks')!;
const compiled = ts.transpileModule(`class MaskHost { ${maskMethod.getText(sceneSource)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const MaskHost = new Function('CHARACTER_SLOT_BITS', 'COLLISION_CATEGORIES', 'PLATFORM_LABELS',
  `${compiled}\nreturn MaskHost;`)(CHARACTER_SLOT_BITS, COLLISION_CATEGORIES, PLATFORM_LABELS);

function world(facing: 1 | -1 = 1, withPlatform = true) {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = GAME_CONFIG.gravity;
  const eventNames: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, options: object) {
      const body = Bodies.rectangle(x, y, width, height, options);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, callback: (...args: any[]) => void) { Events.on(engine, eventNames[event] ?? event, callback); },
    off(event: string, callback: (...args: any[]) => void) { Events.off(engine, eventNames[event] ?? event, callback); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const fighter = new Link(scene, { spawnX: 960 + facing * 70, spawnY: 894 });
  const surface = FLAT_STAGE.platforms[facing === 1 ? 2 : 1]!;
  const platform = Bodies.rectangle(surface.x, surface.y, surface.width, surface.height, {
    isStatic: true, label: PLATFORM_LABELS.passThrough,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH,
      mask: COLLISION_MASKS.PLATFORM_PASS_THROUGH },
  });
  if (withPlatform) Composite.add(engine.world, platform);
  const host: any = new MaskHost();
  Object.assign(host, {
    p1: fighter, p2: null, extraFighters: [], physicsWorld: scene.matter,
    baseStage: { bodies: { platformBodies: withPlatform ? [platform] : [] } },
    prevFighterFeetY: new WeakMap(), prevFighterPositionGeneration: new WeakMap(),
    prevPlatformTopY: new WeakMap(), passThroughLandingGrace: new WeakMap(),
    recordPlatDiag: vi.fn(),
  });
  const support = vi.spyOn(fighter, 'markPlatformFallSupported');
  Events.on(engine, 'beforeUpdate', () => host.updatePassThroughPlatformMasks());
  const step = (input: CharacterInput = NEUTRAL) => {
    fighter.applyInput(input);
    let substeps = 0;
    stepCharacterPhysics({ characters: [fighter], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta), afterSubstep: () => { substeps++; } });
    return { position: { ...fighter.getPosition() }, velocity: { ...fighter.getVelocity() }, substeps };
  };
  const releasePunch = () => {
    const move = DONKEYKONG_NEUTRAL_SPECIAL;
    const held = move.charge.maxChargeFrames;
    fighter.setDamagePercent(150);
    const launch = fighter.applyHit({ facing,
      damage: computeChargedDamageFromSpec(move.charge, held),
      knockback: computeChargedKnockbackFromSpec(move.charge, held, move.knockback) });
    for (let frame = 0; fighter.getHitlagRemaining() > 1 && frame < 100; frame++) step();
    expect(fighter.getHitlagRemaining()).toBe(1);
    return { launch, released: step() };
  };
  const dispose = () => {
    fighter.destroy(); Engine.clear(engine); Composite.clear(engine.world, false);
  };
  return { engine, fighter, platform, host, support, step, releasePunch, dispose };
}

describe('MatchScene pass-through masks through real Matter physics', () => {
  it.each([1, -1] as const)('preserves a full Giant Punch launch at 150%% approaching from below, facing %i', facing => {
    const platformWorld = world(facing);
    const clearWorld = world(facing, false);
    // The victim starts outside the floating platform's column. The first
    // compressed launch frame reaches its side/underside before a later frame
    // could correct an incorrectly solid mask.
    if (facing === 1) {
      expect(platformWorld.fighter.getBodyRightX()).toBeLessThan(platformWorld.platform.bounds.min.x - 2);
    } else {
      expect(platformWorld.fighter.getBodyLeftX()).toBeGreaterThan(platformWorld.platform.bounds.max.x + 2);
    }
    const actual = platformWorld.releasePunch();
    const unobstructed = clearWorld.releasePunch();
    expect(actual.released.substeps).toBeGreaterThan(1);
    expect(actual.launch.vector.x * facing).toBeGreaterThan(30);
    expect(actual.released.velocity.x * facing).toBeGreaterThan(30);
    expect(actual.released.position.x).toBeCloseTo(unobstructed.released.position.x, 7);
    expect(actual.released.position.y).toBeCloseTo(unobstructed.released.position.y, 7);
    expect(actual.released.velocity.x).toBeCloseTo(unobstructed.released.velocity.x, 7);
    expect(actual.released.velocity.y).toBeCloseTo(unobstructed.released.velocity.y, 7);
    expect(platformWorld.support).not.toHaveBeenCalled();
    platformWorld.dispose(); clearWorld.dispose();
  });

  it('allows an ordinary rising jump to enter a floating platform column from below', () => {
    const fixture = world();
    fixture.fighter.resetForRound(1050, 850);
    Body.setVelocity(fixture.fighter.body, { x: 5, y: -8 });
    const beforeX = fixture.fighter.getPosition().x;
    Engine.update(fixture.engine, GAME_CONFIG.fixedTimestepMs);
    expect(fixture.platform.collisionFilter.mask & CHARACTER_SLOT_BITS[0]!).toBe(0);
    expect(fixture.fighter.getPosition().x).toBeGreaterThan(beforeX + 4);
    expect(fixture.fighter.getVelocity().y).toBeLessThan(0);
    expect(fixture.support).not.toHaveBeenCalled();
    for (let frame = 0; frame < 18; frame++) Engine.update(fixture.engine, GAME_CONFIG.fixedTimestepMs);
    expect(fixture.fighter.getBodyBottomY()).toBeLessThan(fixture.platform.bounds.min.y);
    fixture.dispose();
  });

  it('still assists a fast descending crossing from above onto the surface', () => {
    const fixture = world();
    const top = fixture.platform.bounds.min.y;
    const height = fixture.fighter.getTuning().height;
    fixture.fighter.resetForRound(fixture.platform.position.x, top - height / 2 - 12);
    fixture.host.updatePassThroughPlatformMasks();
    fixture.support.mockClear();
    Body.setPosition(fixture.fighter.body, { x: fixture.platform.position.x, y: top - height / 2 + 14 });
    Body.setVelocity(fixture.fighter.body, { x: 0, y: 20 });
    fixture.host.updatePassThroughPlatformMasks();
    expect(fixture.fighter.getBodyBottomY()).toBeCloseTo(top + 1, 7);
    expect(fixture.fighter.getVelocity().y).toBe(0);
    expect(fixture.platform.collisionFilter.mask & CHARACTER_SLOT_BITS[0]!).not.toBe(0);
    expect(fixture.support).toHaveBeenCalledOnce();
    Engine.update(fixture.engine, GAME_CONFIG.fixedTimestepMs);
    expect(fixture.fighter.getBodyBottomY()).toBeLessThanOrEqual(top + 2);
    fixture.dispose();
  });

  it('keeps outside approaches from above solid without granting phantom fall support', () => {
    const fixture = world();
    fixture.fighter.resetForRound(1030, fixture.platform.bounds.min.y - 36 - 5);
    Body.setVelocity(fixture.fighter.body, { x: 5, y: 2 });
    fixture.host.updatePassThroughPlatformMasks();
    expect(fixture.platform.collisionFilter.mask & CHARACTER_SLOT_BITS[0]!).not.toBe(0);
    expect(fixture.support).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it('honors deliberate drops outside the column and clears stale landing grace', () => {
    const fixture = world();
    fixture.fighter.resetForRound(1030, fixture.platform.bounds.min.y - 36 - 5);
    fixture.host.updatePassThroughPlatformMasks(); // Initialize reset generation/history.
    fixture.host.passThroughLandingGrace.set(fixture.fighter, new Set([fixture.platform.id]));
    vi.spyOn(fixture.fighter, 'isInDropThroughWindow').mockReturnValue(true);
    fixture.host.updatePassThroughPlatformMasks();
    expect(fixture.platform.collisionFilter.mask & CHARACTER_SLOT_BITS[0]!).toBe(0);
    expect(fixture.host.passThroughLandingGrace.get(fixture.fighter).has(fixture.platform.id)).toBe(false);
    expect(fixture.platform.collisionFilter.mask).toBe(COLLISION_CATEGORIES.PASS_THROUGH_DRIVER_KEEPALIVE);
    expect(fixture.support).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it('holds an unresolved landing grace until the fighter clears the platform bottom', () => {
    const fixture = world();
    const top = fixture.platform.bounds.min.y;
    const halfHeight = fixture.fighter.getTuning().height / 2;
    fixture.fighter.resetForRound(fixture.platform.position.x, top + 10 - halfHeight);
    fixture.host.updatePassThroughPlatformMasks();
    fixture.host.passThroughLandingGrace.set(fixture.fighter, new Set([fixture.platform.id]));
    fixture.host.updatePassThroughPlatformMasks();
    expect(fixture.platform.collisionFilter.mask & CHARACTER_SLOT_BITS[0]!).not.toBe(0);
    expect(fixture.host.passThroughLandingGrace.get(fixture.fighter).has(fixture.platform.id)).toBe(true);
    Body.setPosition(fixture.fighter.body, {
      x: fixture.platform.position.x,
      y: fixture.platform.bounds.max.y + 8 - halfHeight,
    });
    fixture.host.updatePassThroughPlatformMasks();
    expect(fixture.platform.collisionFilter.mask & CHARACTER_SLOT_BITS[0]!).toBe(0);
    expect(fixture.host.passThroughLandingGrace.get(fixture.fighter).has(fixture.platform.id)).toBe(false);
    fixture.dispose();
  });

  it('retains authored solid-platform filters and never revives a crumbled platform', () => {
    const fixture = world();
    fixture.platform.label = PLATFORM_LABELS.solid;
    fixture.platform.collisionFilter.category = COLLISION_CATEGORIES.PLATFORM_SOLID;
    fixture.platform.collisionFilter.mask = COLLISION_MASKS.PLATFORM_SOLID;
    fixture.host.updatePassThroughPlatformMasks();
    expect(fixture.platform.collisionFilter.mask).toBe(COLLISION_MASKS.PLATFORM_SOLID);
    fixture.platform.label = PLATFORM_LABELS.passThrough;
    fixture.platform.collisionFilter.mask = 0;
    fixture.host.updatePassThroughPlatformMasks();
    expect(fixture.platform.collisionFilter.mask).toBe(0);
    expect(fixture.support).not.toHaveBeenCalled();
    fixture.dispose();
  });
});
