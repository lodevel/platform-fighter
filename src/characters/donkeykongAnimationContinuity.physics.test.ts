/**
 * Presentation continuity on a real Matter world: Donkey Kong's sprite (sheet + drawing) per
 * fixed step through the same driver MatchScene uses, with a catalog built from frames.json.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DonkeyKong, DONKEYKONG_TILT } from './DonkeyKong';
import type { CharacterInput } from './Character';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { captureSimulationAnimation, createSimulationSpriteAnimationDriver } from './simulationSpriteAnimation';
import frames from '../../assets/characters/donkeykong/frames.json';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function world() {
  const engine = Engine.create();
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
  const dk = new DonkeyKong(scene, { spawnX: 0, spawnY: 0 });
  Composite.add(engine.world, Bodies.rectangle(0, dk.getTuning().height / 2 + 10, 20000, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  }));
  const animations = new Map(Object.entries(frames.animations as Record<string, { frameCount: number }>)
    .map(([sheet, clip]) => [`donkeykong.${sheet}.anim`, { frames: Array.from({ length: clip.frameCount }, (_, i) => ({ i })) }]));
  const anims: any = { currentAnim: null, currentFrame: null, pause() {}, setCurrentFrame(f: unknown) { anims.currentFrame = f; } };
  const sprite = { anims, play(key: string) { anims.currentAnim = { key }; } };
  const catalog = { exists: (key: string) => animations.has(key), get: (key: string) => animations.get(key) };
  let frame = 0;
  const driver = createSimulationSpriteAnimationDriver(() => captureSimulationAnimation(dk, frame, false),
    sprite as unknown as SimulationSpriteSurface, catalog as unknown as SimulationAnimationCatalog);
  /** One fixed step; returns the presented `sheet:drawing`. */
  const step = (input: Partial<CharacterInput> = {}) => {
    dk.applyInput({ ...NEUTRAL, ...input });
    Engine.update(engine, 1000 / 60);
    dk.applyPostPhysicsVelocityConstraints();
    frame += 1;
    const pose = driver.tick()!;
    return `${pose.key.split('.')[1]}:${pose.frameIndex}`;
  };
  const steps = (n: number, input: Partial<CharacterInput> = {}) => Array.from({ length: n }, () => step(input));
  for (let i = 0; i < 30; i++) step();
  return { dk, step, steps };
}

/** Consecutive runs of one sheet: `[drawing, steps]`. */
function runs(seq: readonly string[], sheet: string): [number, number][] {
  const out: [number, number][] = [];
  for (const pose of seq) {
    const [name, drawing] = pose.split(':');
    if (name !== sheet) continue;
    const last = out[out.length - 1];
    if (last && last[0] === Number(drawing)) last[1] += 1; else out.push([Number(drawing), 1]);
  }
  return out;
}
const clipLength = (sheet: string) => (frames.animations as Record<string, { nativeSampleIndices?: number[] }>)[sheet]!.nativeSampleIndices!.at(-1)!;

describe('DK animation continuity (Matter)', () => {
  it('an attack whose clip outlasts its action finishes its drawings, then idle starts at its first drawing', () => {
    const w = world();
    const seq = [w.step({ attack: true, moveX: 1, attackStickX: 1 }), ...w.steps(90)];
    const smash = seq.filter(pose => pose.startsWith('smash:'));
    expect(smash.length).toBe(clipLength('smash'));
    expect(runs(seq, 'smash').map(([drawing]) => drawing)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(seq[smash.length]).toBe('idle:0');
  });
  it('the dash attack finishes its drawings instead of popping to idle', () => {
    const w = world();
    const seq = [...w.steps(16, { moveX: 1 }), w.step({ attack: true, moveX: 1 }), ...w.steps(80)];
    const first = seq.findIndex(pose => pose.startsWith('dash_attack:'));
    expect(seq.filter(pose => pose.startsWith('dash_attack:')).length).toBe(clipLength('dash_attack'));
    expect(runs(seq, 'dash_attack').map(([drawing]) => drawing)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(seq[first + clipLength('dash_attack')]).toBe('idle:0');
  });
  it('any new action interrupts the animation tail', () => {
    for (const input of [{ jump: true }, { attack: true }, { moveX: 1 }, { shield: true }, { moveY: 1 }] as Partial<CharacterInput>[]) {
      const w = world();
      w.step({ attack: true, moveX: 1, attackStickX: 1 });
      // Drawing 10 starts after the move's FAF (age 54).
      for (let i = 0; i < 70 && w.step() !== 'smash:10'; i++);
      expect(w.dk.isAttacking()).toBe(false);
      expect(w.step(), 'tail runs while idle').toBe('smash:10');
      expect(w.step(input).startsWith('smash:'), JSON.stringify(input)).toBe(false);
    }
  });
  it('charge loops never show a drawing for a single step', () => {
    let w = world();
    const smashCharge = runs(w.steps(58, { attack: true, moveX: 1, attackStickX: 1 }), 'smash_charge');
    w = world();
    const punchCharge = runs(w.steps(70, { special: true }), 'neutral_special_charge');
    for (const loop of [smashCharge, punchCharge]) {
      expect(loop.length).toBeGreaterThan(4);
      // First and last runs may be cut by the entry / sampling window.
      expect(loop.slice(1, -1).filter(([, steps]) => steps < 2)).toEqual([]);
    }
  });
  it('shows the hurt pose from the hit step, through hitlag', () => {
    const w = world();
    w.dk.applyHit({ facing: -1, damage: 12, knockback: DONKEYKONG_TILT.knockback });
    expect(w.dk.isInHitlag()).toBe(true);
    expect(w.steps(3).every(pose => pose.startsWith('hurt:'))).toBe(true);
  });
});

import type {SimulationSpriteSurface,SimulationAnimationCatalog} from './simulationSpriteAnimation';
