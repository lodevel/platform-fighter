import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createCharacterById } from '../characters/characterFactory';
import type { Character, CharacterInput } from '../characters/Character';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { LiveCpuController, type LiveCpuFighter, type LiveCpuWorld } from './LiveCpuController';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, jump: false };

function runtime() {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body,
    add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
      const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
    } },
    world: {
      on(event: string, listener: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, listener); },
      off(event: string, listener: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, listener); },
      remove(body: any) { Composite.remove(engine.world, body); },
    },
  } };
  const platform = Bodies.rectangle(300, 320, 400, 40, { isStatic: true, label: 'platform.solid',
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } });
  Composite.add(engine.world, platform);
  const bot = createCharacterById(scene, 'donkeykong', { spawnX: 170, spawnY: 250, slotIndex: 0 });
  const human = createCharacterById(scene, 'donkeykong', { spawnX: 400, spawnY: 250, slotIndex: 1 });
  const characters = [bot, human];
  const hits = new HitboxDamageHandler((targetIndex, hit) => {
    const outcome = characters[targetIndex]!.applyHitDetailed(hit);
    return { confirmed: outcome.outcome === 'landed' || outcome.outcome === 'shielded' };
  });
  hits.registerPlayer(0, bot.body);
  hits.registerPlayer(1, human.body);
  Events.on(engine, 'collisionStart', (event: any) => hits.handleCollisionStart(event));
  function perceive(character: Character, playerIndex: 0 | 1): LiveCpuFighter {
    const move = character.getActiveAttack();
    return { playerIndex, position: { ...character.getPosition() }, velocity: { ...character.getVelocity() },
      facing: character.getFacing(), feetY: character.getBodyBottomY(), halfWidth: 23,
      damagePercent: character.getDamagePercent(), stocksRemaining: 3, active: true,
      grounded: character.isGrounded(), hitstun: character.isInHitstun(), hitlag: character.isInHitlag(),
      grabbed: character.isGrabbed(), holdingGrab: character.getGrabState().name === 'holding',
      onLedge: character.isHangingOnLedge(), invincible: character.isInvincible(), canAttack: character.canAttack(),
      jumpsRemaining: character.getJumpsRemaining(), upSpecialAvailable: !character.isHelpless(),
      currentMove: move ? { kind: move.move.type, phase: move.phase, framesRemaining: 1 } : null,
      stateLabel: move ? 'attacking' : 'idle' };
  }
  return { bot, human,
    world(): LiveCpuWorld { return { fighters: [perceive(bot, 0), perceive(human, 1)],
      platforms: [{ left: 100, right: 500, top: 300, passThrough: false }],
      ledges: [{ x: 100, y: 300, side: 'left', platformId: 'main' }, { x: 500, y: 300, side: 'right', platformId: 'main' }],
      blastZone: { left: -500, right: 1100, top: -600, bottom: 1000 } }; },
    step(input: CharacterInput) {
      bot.applyInput(input); human.applyInput(NEUTRAL);
      Engine.update(engine, 1000 / 60);
      bot.applyPostPhysicsVelocityConstraints(); human.applyPostPhysicsVelocityConstraints();
    },
  };
}

describe('live CPU through actual Character and Matter', () => {
  it('selected Hard AI closes distance and damages a same-character opponent through real collision', () => {
    const game = runtime();
    const cpu = new LiveCpuController(0, 'hard', 988);
    const moves = new Set<string>();
    let closest = Infinity;
    for (let frame = 0; frame < 420; frame++) {
      game.step(cpu.sample(frame, game.world()));
      const active = game.bot.getActiveAttack();
      if (active) moves.add(active.move.type);
      closest = Math.min(closest, Math.abs(game.bot.getPosition().x - game.human.getPosition().x));
    }
    expect(closest).toBeLessThan(90);
    expect(moves.size).toBeGreaterThan(0);
    expect(game.human.getDamagePercent()).toBeGreaterThan(0);
  });

  it('exhausted air jumps trigger an actual upward special and gain height', () => {
    const game = runtime();
    game.bot.setPosition(30, 400);
    for (let jump = 0; jump < 2; jump++) { game.step({ moveX: 0, jump: true }); game.step(NEUTRAL); }
    expect(game.bot.getJumpsRemaining()).toBe(0);
    Body.setVelocity(game.bot.body, { x: 0, y: 1 });
    const startY = game.bot.getPosition().y;
    const cpu = new LiveCpuController(0, 'medium', 444);
    let usedUpSpecial = false;
    let highest = startY;
    for (let frame = 0; frame < 35; frame++) {
      const input = cpu.sample(frame, game.world());
      game.step(input);
      usedUpSpecial ||= game.bot.getActiveAttack()?.move.type === 'upSpecial';
      highest = Math.min(highest, game.bot.getPosition().y);
    }
    expect(usedUpSpecial).toBe(true);
    expect(highest).toBeLessThan(startY - 20);
  });

  it('holds a platform-navigation jump through squat and reaches higher than a one-frame tap', () => {
    const navigated = runtime();
    const tapped = runtime();
    for (let frame = 0; frame < 30; frame++) { navigated.step(NEUTRAL); tapped.step(NEUTRAL); }
    expect(navigated.bot.isGrounded()).toBe(true);
    const cpu = new LiveCpuController(0, 'hard', 19);
    let jumpFrame = -1;
    let navPeak = Infinity;
    let tapPeak = Infinity;
    const inputs: CharacterInput[] = [];
    const launchTrace: unknown[] = [];
    for (let frame = 0; frame < 75; frame++) {
      const observed = navigated.world();
      const input = cpu.sample(frame, { ...observed, fighters: [observed.fighters[0]!,
        { ...observed.fighters[1]!, position: { x: 220, y: 120 } }] });
      inputs.push(input);
      if (jumpFrame < 0 && input.jump) jumpFrame = frame;
      navigated.step(input);
      tapped.step({ moveX: 0, jump: frame === jumpFrame });
      if (jumpFrame >= 0 && frame < jumpFrame + 10) launchTrace.push({ frame, input,
        y: navigated.bot.getPosition().y, vy: navigated.bot.getVelocity().y,
        grounded: navigated.bot.isGrounded(), squat: navigated.bot.getJumpsquatRemaining(),
        move: navigated.bot.getActiveAttack()?.move.id, jumps: navigated.bot.getJumpsUsed() });
      navPeak = Math.min(navPeak, navigated.bot.getPosition().y);
      tapPeak = Math.min(tapPeak, tapped.bot.getPosition().y);
    }
    expect(jumpFrame).toBeGreaterThanOrEqual(0);
    expect(inputs.slice(jumpFrame, jumpFrame + 4).every((input) => input.jump)).toBe(true);
    expect(navPeak, JSON.stringify(launchTrace)).toBeLessThan(tapPeak - 30);
  });
});
