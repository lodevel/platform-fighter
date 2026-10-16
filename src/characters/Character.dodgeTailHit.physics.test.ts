import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { Character, CharacterInput } from './Character';
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
const HIT = { damage: 10, hitlagMultiplier: 0, facing: 1 as const, knockback: { x: 8, y: -6, scaling: 0 } };

function fixture(fighter: 'donkeykong' | 'pikachu') {
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
  const ch: Character = fighter === 'donkeykong' ? new DonkeyKong(scene, { spawnX: 0, spawnY: 0 })
    : new Pikachu(scene, { spawnX: 0, spawnY: 0 });
  Composite.add(engine.world, Bodies.rectangle(0, ch.getTuning().height / 2 + 10, 20000, 20,
    { isStatic: true, label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world), gravity: engine.gravity,
      body: Body, deltaMs: 1000 / 60, stepWorld: delta => Engine.update(engine, delta) });
  };
  for (let i = 0; i < 12; i++) step();
  return { ch, step };
}

// Steps after the press at which each dodge is past its intangible window
// but still acting (DK source: spot 26 / 3-17, roll 30 / 4-15, back roll
// 35 / 5-16, neutral air dodge 48 / 4-32).
const CASES = [
  { kind: 'spot', press: { ...NEUTRAL, dodge: true }, tail: 20 },
  { kind: 'roll', press: { ...NEUTRAL, moveX: 1, dodge: true }, tail: 20 },
  { kind: 'back roll', press: { ...NEUTRAL, moveX: -1, dodge: true }, tail: 22 },
  { kind: 'air', press: { ...NEUTRAL, dodge: true }, tail: 36, air: true },
] as const;

describe('a hit in the vulnerable tail of a dodge interrupts it', () => {
  it.each((['donkeykong', 'pikachu'] as const).flatMap(fighter => CASES.map(c => ({ fighter, ...c }))))(
    '$fighter $kind', ({ fighter, press, tail, ...c }) => {
      const { ch, step } = fixture(fighter);
      if ('air' in c) for (let i = 0; i < 9; i++) step({ ...NEUTRAL, jump: true });
      step(press);
      for (let i = 1; i < tail; i++) step();
      expect(isDodgeActing(ch.getDodgeState())).toBe(true);
      expect(isDodgeInvincible(ch.getDodgeState())).toBe(false);
      expect(ch.applyHitDetailed(HIT).outcome).toBe('landed');
      expect(isDodgeActing(ch.getDodgeState())).toBe(false);
      expect(ch.isDodging()).toBe(false);
      step();
      expect(ch.isInHitstun()).toBe(true);
      expect(isDodgeActing(ch.getDodgeState())).toBe(false);
      expect(ch.getVelocity().x).toBeGreaterThan(0);
      expect(ch.getVelocity().y).toBeLessThan(0);
    });
});
