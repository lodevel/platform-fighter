/** Link always has a hurtbox: the shared posture body plus SmashWiki
 * intangibility windows, never a per-drawing set that vanishes when no art is
 * installed. Steps every normal, both spins, shield, dodges, movement,
 * hitstun and a getup attack on a real Matter world. */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link } from './Link';
import { LINK_NORMAL_RULES } from './linkNormalRules';
import type { CharacterInput } from './Character';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };

function setup() {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, options: object) {
      const body = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, body); return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  Composite.add(engine.world, Bodies.rectangle(0, 48, 3000, 20, { isStatic: true,
    label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const fighter = new Link(scene, { spawnX: 0, spawnY: 0 });
  const seen: { state: string; count: number }[] = [];
  const step = (state: string, input: CharacterInput = NEUTRAL) => {
    fighter.applyInput(input); Engine.update(engine, 1000 / 60); fighter.applyPostPhysicsVelocityConstraints();
    seen.push({ state, count: fighter.getActiveHurtboxes().length });
  };
  const run = (state: string, frames: number, input: CharacterInput = NEUTRAL) => { for (let i = 0; i < frames; i++) step(state, input); };
  run('settle', 20);
  return { fighter, step, run, seen };
}

describe('Link hurtboxes', () => {
  it('has at least one hurtbox in every state, with or without installed art', () => {
    const { fighter, step, run, seen } = setup();
    run('idle', 10);
    run('walk', 20, { ...NEUTRAL, moveX: 0.5 });
    run('run', 20, { ...NEUTRAL, moveX: 1 });
    run('crouch', 15, { ...NEUTRAL, moveY: 1 });
    run('idle', 15);
    for (const [id, rule] of Object.entries(LINK_NORMAL_RULES)) {
      const aerial = id.endsWith('air');
      if (aerial) { step(`${id}:jump`, { ...NEUTRAL, jump: true }); run(`${id}:rise`, 8); }
      expect(fighter.attemptAttack(id), id).toBe(true);
      run(id, rule.animationFrames + 25);
    }
    step('shield', { ...NEUTRAL, shield: true }); run('shield', 20, { ...NEUTRAL, shield: true }); run('unshield', 20);
    step('spot-dodge', { ...NEUTRAL, dodge: true }); run('spot-dodge', 40);
    step('spin', { ...NEUTRAL, moveY: -1, special: true }); run('spin', 120);
    step('air-spin:jump', { ...NEUTRAL, jump: true }); run('air-spin:rise', 6);
    step('air-spin', { ...NEUTRAL, moveY: -1, special: true }); run('air-spin', 140);
    fighter.applyHit({ damage: 12, knockback: { x: 12, y: -12, scaling: 0 }, facing: 1 });
    run('hitstun', 90);
    expect(seen.filter(s => s.count < 1)).toEqual([]);
    expect(seen.length).toBeGreaterThan(1000);
  });

  it('getup attacks are intangible for their SmashWiki frames, then vulnerable', () => {
    const { fighter } = setup();
    const move = fighter.getAttack('link.getupAttack')!;
    expect(move.protectionWindows).toEqual([{ startFrame: 0, endFrame: 22, regions: ['*'] }]);
    const intangible = Array.from({ length: 30 }, (_, framesElapsed) => {
      (fighter as unknown as { activeAttack: unknown }).activeAttack =
        { move, facing: 1, framesElapsed, hitboxBody: null, upSpecial: null, chargeHeldFrames: null };
      const hurt = fighter.getActiveHurtboxes();
      expect(hurt.length).toBeGreaterThan(0);
      return hurt.every(h => h.intangible === true);
    });
    expect(intangible.slice(0, 22).every(Boolean)).toBe(true);
    expect(intangible.slice(22).some(Boolean)).toBe(false);
  });
});
