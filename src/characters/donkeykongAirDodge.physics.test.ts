import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { CharacterInput } from './Character';
import { DonkeyKong } from './DonkeyKong';
import { Pikachu } from './Pikachu';
import { isDodgeActing, isDodgeInvincible } from './dodgeState';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };

/** DK standing on a floor whose top is `floorTop` px below his body centre
 * (42 = standing). A floor far below leaves the whole dodge in the air. */
function fixture(floorTop = 42, fighter: 'donkeykong' | 'pikachu' = 'donkeykong') {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart',
    collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, options: object) {
      const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
    } }, world: {
    on(name: string, fn: (...args: any[]) => void) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: (...args: any[]) => void) { Events.off(engine, names[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const dk = fighter === 'donkeykong' ? new DonkeyKong(scene, { spawnX: 0, spawnY: 0 })
    : new Pikachu(scene, { spawnX: 0, spawnY: 0 });
  Composite.add(engine.world, Bodies.rectangle(0, floorTop + 10, 20000, 20,
    { isStatic: true, label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const step = (input: CharacterInput = NEUTRAL) => {
    dk.applyInput(input);
    stepCharacterPhysics({ characters: [dk], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
      body: Body, deltaMs: 1000 / 60, stepWorld: delta => Engine.update(engine, delta) });
  };
  return { dk, step };
}

// https://ultimateframedata.com/donkey_kong: totals, intangible 4–32 (neutral) / 4–22.
const DIRECTIONS = [
  { name: 'neutral', moveX: 0, moveY: 0, total: 48, intangible: [4, 32] },
  { name: 'down', moveX: 0, moveY: 1, total: 66, intangible: [4, 22] },
  { name: 'down-diagonal', moveX: Math.SQRT1_2, moveY: Math.SQRT1_2, total: 73, intangible: [4, 22] },
  { name: 'side', moveX: 1, moveY: 0, total: 82, intangible: [4, 22] },
  { name: 'up-diagonal', moveX: Math.SQRT1_2, moveY: -Math.SQRT1_2, total: 88, intangible: [4, 22] },
  { name: 'up', moveX: 0, moveY: -1, total: 109, intangible: [4, 22] },
] as const;

describe('DK air dodge totals and landing lag', () => {
  it.each(DIRECTIONS)('$name air dodge with no floor in reach runs its full $total frames', d => {
    const { dk, step } = fixture(100000);
    step();
    expect(dk.isGrounded()).toBe(false);
    const frames: boolean[] = [];
    step({ ...NEUTRAL, moveX: d.moveX, moveY: d.moveY, dodge: true });
    while (isDodgeActing(dk.getDodgeState()) && frames.length < 200) {
      frames.push(isDodgeInvincible(dk.getDodgeState()));
      step();
    }
    expect(dk.isGrounded()).toBe(false);
    expect(frames).toHaveLength(d.total);
    expect(frames.indexOf(true) + 1).toBe(d.intangible[0]);
    expect(frames.lastIndexOf(true) + 1).toBe(d.intangible[1]);
  });

  it('neutral air dodge landing is the flat 10 frames', () => {
    const { dk, step } = fixture(42 + 30);
    step({ ...NEUTRAL, dodge: true });
    for (let i = 0; i < 40 && !dk.getLandingPresentationState(); i++) step();
    expect(dk.getLandingPresentationState()).toMatchObject({ kind: 'air-dodge', totalFrames: 10 });
  });

  // Ultimate lerps directional landing lag over the dodge's progress: an early
  // touchdown costs 19, one at the end of the dodge 11 (UFD DK 11–19; SmashWiki:
  // "increases the earlier the character lands").
  it.each([
    { name: 'early (down, just above the floor)', height: 40, moveY: 1, expected: [18, 19] },
    { name: 'late (up, from high enough to land near the end)', height: 560, moveY: -1, expected: [11, 12] },
  ])('directional air dodge landing lag scales with progress: $name', ({ height, moveY, expected }) => {
    const { dk, step } = fixture(42 + height);
    step();
    step({ ...NEUTRAL, moveY, dodge: true });
    // Elapsed dodge frames on the step before touchdown is processed.
    let elapsed = 0;
    for (let i = 0; i < 120 && !dk.getLandingPresentationState(); i++) {
      elapsed = dk.getDodgeState().active?.framesElapsed ?? elapsed;
      step();
    }
    const total = moveY > 0 ? 66 : 109;
    const landing = dk.getLandingPresentationState();
    expect(landing?.kind).toBe('directional-air-dodge');
    expect(landing!.totalFrames).toBe(Math.round(19 + (11 - 19) * elapsed / total));
    expect(landing!.totalFrames).toBeGreaterThanOrEqual(expected[0]!);
    expect(landing!.totalFrames).toBeLessThanOrEqual(expected[1]!);
  });

  // Shared landing path: a fighter without a late value keeps its flat directional lag.
  it.each([40, 560])('Pikachu keeps its flat 19-frame directional landing (height %s)', height => {
    const { dk: pikachu, step } = fixture(25 + height, 'pikachu');
    step();
    step({ ...NEUTRAL, moveY: height > 100 ? -1 : 1, dodge: true });
    for (let i = 0; i < 140 && !pikachu.getLandingPresentationState(); i++) step();
    expect(pikachu.getLandingPresentationState()).toMatchObject({ kind: 'directional-air-dodge', totalFrames: 19 });
  });
});
