import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { Pikachu } from '../characters/Pikachu';
import { KNOCKDOWN_OPTION_LOCK_FRAMES, type CharacterInput } from '../characters/Character';
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

// Execute the actual production driver against real Matter; the graphics and
// audio scene dependencies are unnecessary for this contact regression.
const source = ts.createSourceFile('MatchSim.ts',
  readFileSync(new URL('../sim/MatchSim.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const sceneClass = source.statements.find((node): node is ts.ClassDeclaration =>
  ts.isClassDeclaration(node) && node.name?.text === 'MatchSim')!;
const method = sceneClass.members.find((node): node is ts.MethodDeclaration =>
  ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) &&
  node.name.text === 'updatePassThroughPlatformMasks')!;
const compiled = ts.transpileModule(`class MaskHost { ${method.getText(source)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const MaskHost = new Function('CHARACTER_SLOT_BITS', 'COLLISION_CATEGORIES', 'PLATFORM_LABELS',
  `${compiled}\nreturn MaskHost;`)(CHARACTER_SLOT_BITS, COLLISION_CATEGORIES, PLATFORM_LABELS);

function world() {
  const engine = Engine.create();
  engine.gravity.x = 0;
  engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, options: object) {
      const body = Bodies.rectangle(x, y, width, height, options);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(name: string, callback: (...args: any[]) => void) { Events.on(engine, names[name] ?? name, callback); },
    off(name: string, callback: (...args: any[]) => void) { Events.off(engine, names[name] ?? name, callback); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const platforms = FLAT_STAGE.platforms.map(platform => {
    const passThrough = platform.passThrough === true || platform.behavior === 'pass-through';
    return Bodies.rectangle(platform.x, platform.y, platform.width, platform.height, {
      isStatic: true, label: passThrough ? PLATFORM_LABELS.passThrough : PLATFORM_LABELS.solid,
      collisionFilter: {
        category: passThrough ? COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH : COLLISION_CATEGORIES.PLATFORM_SOLID,
        mask: passThrough ? COLLISION_MASKS.PLATFORM_PASS_THROUGH : COLLISION_MASKS.PLATFORM_SOLID,
      },
    });
  });
  Composite.add(engine.world, platforms);
  const floor = platforms.find(platform => platform.label === PLATFORM_LABELS.solid)!;
  const fighter = new Pikachu(scene, { spawnX: floor.position.x, spawnY: floor.bounds.min.y - 25 });
  const host: any = new MaskHost();
  Object.assign(host, {
    p1: fighter, p2: null, extraFighters: [], physicsWorld: scene.matter,
    baseStage: { bodies: { platformBodies: platforms } },
    prevFighterFeetY: new WeakMap(), prevFighterPositionGeneration: new WeakMap(),
    prevPlatformTopY: new WeakMap(), passThroughLandingGrace: new WeakMap(),
    recordPlatDiag() {},
  });
  Events.on(engine, 'beforeUpdate', () => host.updatePassThroughPlatformMasks());
  const step = (input: CharacterInput = NEUTRAL) => {
    fighter.applyInput(input);
    stepCharacterPhysics({ characters: [fighter], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
  };
  const dispose = () => { fighter.destroy(); Engine.clear(engine); Composite.clear(engine.world, false); };
  return { fighter, platforms, floor, host, step, dispose };
}

const recoveries = ([1, -1] as const).flatMap(facing =>
  (['face-up', 'face-down'] as const).flatMap(origin =>
    (['neutral', 'attack'] as const).map(wakeup => ({ facing, origin, wakeup }))));

describe('Pikachu upper-platform support during missed-tech recovery', () => {
  it.each(recoveries)('keeps $facing/$origin/$wakeup supported when launch velocity is retired', ({ facing, origin, wakeup }) => {
    const fixture = world();
    try {
      for (let frame = 0; frame < 12; frame++) fixture.step();
      fixture.fighter.setFacing(facing);
      const incomingFacing: 1 | -1 = origin === 'face-up' ? (facing === 1 ? -1 : 1) : facing;
      fixture.fighter.applyHit({ damage: 1, knockback: { x: 8, y: -8, scaling: 0 },
        facing: incomingFacing, hitlagMultiplier: 1 });
      for (let frame = 0; frame < 160 && !fixture.fighter.isKnockedDown(); frame++) fixture.step();
      expect(fixture.fighter.isKnockedDown()).toBe(true);
      expect(fixture.fighter.getReactionPresentationState()?.origin).toBe(origin);
      expect(fixture.fighter.isGrounded()).toBe(true);
      const position = fixture.fighter.getPosition();
      const platform = fixture.platforms.find(body => body.label === PLATFORM_LABELS.passThrough &&
        position.x >= body.bounds.min.x && position.x <= body.bounds.max.x)!;
      expect(platform).toBeDefined();
      // An old velocity-expanded broad-phase AABB caused a second false CCD
      // lift from y784.455 to780.975. Assert the actual physical support root.
      const supportedY = platform.bounds.min.y - fixture.fighter.getTuning().height / 2 + .05;
      expect(position.y).toBeCloseTo(supportedY, 5);
      // SmashWiki Lucario (SSBU)/Floor getups: getup options only after 25 prone frames; support holds throughout.
      for (let frame = 1; frame < KNOCKDOWN_OPTION_LOCK_FRAMES; frame++) {
        fixture.step();
        expect(fixture.fighter.getPosition().y).toBeCloseTo(supportedY, 5);
      }
      for (let age = 0; age < 8; age++) {
        fixture.step(age === 0 && wakeup === 'attack' ? { ...NEUTRAL, attack: true } : NEUTRAL);
        expect(fixture.fighter.isGrounded()).toBe(true);
        expect(fixture.fighter.getPosition().y).toBeCloseTo(supportedY, 5);
        if (wakeup === 'attack') expect(fixture.fighter.getActiveAttack()?.framesElapsed).toBe(age);
        else expect(fixture.fighter.isKnockedDown()).toBe(true);
      }
    } finally { fixture.dispose(); }
  });

  it.each([1, -1] as const)('retains a genuine descending CCD landing and ordinary walk-off, facing %i', facing => {
    const fixture = world();
    try {
      const platform = fixture.platforms.find(body => body.label === PLATFORM_LABELS.passThrough)!;
      const top = platform.bounds.min.y;
      fixture.fighter.resetForRound(platform.position.x, top - 25 - 12);
      fixture.host.updatePassThroughPlatformMasks();
      Body.setPosition(fixture.fighter.body, { x: platform.position.x, y: top - 25 + 14 });
      Body.setVelocity(fixture.fighter.body, { x: 0, y: 20 });
      fixture.host.updatePassThroughPlatformMasks();
      expect(Math.max(...fixture.fighter.body.vertices!.map(vertex => vertex.y))).toBeCloseTo(top + 1, 7);
      expect(fixture.fighter.getVelocity().y).toBe(0);
      fixture.step();
      expect(fixture.fighter.isGrounded()).toBe(true);
      let leftSupport = false;
      let descended = false;
      for (let frame = 0; frame < 36; frame++) {
        fixture.step({ ...NEUTRAL, moveX: facing });
        const position = fixture.fighter.getPosition();
        if (position.x + 25 < platform.bounds.min.x - 2 || position.x - 25 > platform.bounds.max.x + 2) {
          if (!fixture.fighter.isGrounded()) leftSupport = true;
          if (leftSupport && position.y > top - 25 + 1) descended = true;
        }
      }
      expect(leftSupport).toBe(true);
      expect(descended).toBe(true);
      expect(fixture.fighter.isGrounded()).toBe(true);
      expect(fixture.fighter.getPosition().y).toBeCloseTo(fixture.floor.bounds.min.y - 25 + .05, 4);
    } finally { fixture.dispose(); }
  });
});
