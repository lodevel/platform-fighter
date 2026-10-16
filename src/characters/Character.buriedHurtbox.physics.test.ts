import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { Character, CharacterInput } from './Character';
import { DonkeyKong } from './DonkeyKong';
import { Pikachu } from './Pikachu';
import type { HitInfo } from './combat';
import type { Hurtbox } from './moveSchema';
import { HITBOX_LABEL } from './attacks';
import { buriedSinkDepth } from './buriedPresentation';
import { HitboxDamageHandler } from '../match/HitboxDamageHandler';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

// SmashWiki Buried (https://www.ssbwiki.com/Buried): "Being buried upright or upside down affects the hurtbox placement of
// the buried character". The drawing is sunk into the floor (buriedPresentation.ts); the hurtboxes go down with it, so a hit
// aimed at where the standing head was misses and a hit at the visible torso lands. Generic: every fighter.
const neutral: CharacterInput = { moveX: 0, jump: false };
const FIGHTERS = { donkeykong: DonkeyKong, pikachu: Pikachu } as const;
const weakBury: HitInfo = { damage: 3, hitlagMultiplier: 1, facing: 1, statusEffect: 'bury',
  nativeCollisionAttribute: 'collision_attr_bury', nativeForceReaction: false,
  knockback: { x: 1, y: -1, scaling: 0, reference: { angle: 45, base: 30, growth: 10 } } };

function fixture(id: keyof typeof FIGHTERS) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, options: object) {
    const b = Bodies.rectangle(x, y, w, h, options); Composite.add(engine.world, b); return b;
  } }, world: { on(n: string, fn: any) { Events.on(engine, names[n] ?? n, fn); },
    off(n: string, fn: any) { Events.off(engine, names[n] ?? n, fn); }, remove(b: any) { Composite.remove(engine.world, b); } } } };
  const target: Character = new FIGHTERS[id](scene, { spawnX: 0, spawnY: -40 });
  Composite.add(engine.world, Bodies.rectangle(0, 35, 2000, 20, { isStatic: true,
    label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const landed: string[] = [];
  const handler = new HitboxDamageHandler((index, hit) => {
    const result = target.applyHitDetailed(hit);
    if (result.outcome === 'landed') landed.push(String(index));
    return { confirmed: result.outcome === 'landed' };
  });
  handler.registerPlayer(1, target.body);
  handler.setHurtboxLookup(() => target.getActiveHurtboxes());
  handler.setFacingLookup(() => target.getFacing());
  const step = () => { target.applyInput(neutral); Engine.update(engine, 1000 / 60); target.applyPostPhysicsVelocityConstraints(); };
  for (let i = 0; i < 40; i++) step();
  /** A static 24x8 attack sensor at a world point, sampled the way MatchScene samples live hurtboxes. */
  const strike = (x: number, y: number): boolean => {
    const before = landed.length;
    const sensor = Bodies.rectangle(x, y, 24, 8, { isSensor: true, isStatic: true, label: HITBOX_LABEL,
      plugin: { ownerId: 'probe', ownerBodyId: -1, moveId: 'probe.jab', damage: 1, facing: 1,
        knockback: { x: 1, y: 0, scaling: 0, reference: { angle: 0, base: 10, growth: 0 } } } });
    handler.sampleHurtboxContacts([sensor]);
    return landed.length > before;
  };
  return { target, step, strike };
}

const top = (h: Hurtbox) => h.capsule ? Math.min(h.capsule.start.y, h.capsule.end.y) - h.capsule.radius : h.offsetY - h.height / 2;
const xOf = (h: Hurtbox) => h.capsule ? (h.capsule.start.x + h.capsule.end.x) / 2 : h.offsetX;

describe.each(['donkeykong', 'pikachu'] as const)('%s buried: hurtbox follows the sunk body', id => {
  it('a hit where the standing head was misses; a hit at the visible torso lands and keeps the fighter buried', () => {
    const control = fixture(id), { target, step, strike } = fixture(id);
    expect(target.isGrounded()).toBe(true);
    const standing = target.getActiveHurtboxes();
    const head = standing.reduce((a, b) => (top(b) < top(a) ? b : a));
    const depth = buriedSinkDepth(target.getTuning().height);
    const pos = target.getPosition();
    // Inside the standing head, above the sunk head top (depth/2 below the standing top).
    const headPoint = { x: pos.x + xOf(head) * target.getFacing(), y: pos.y + top(head) + depth / 2 };
    // The same point lands on a standing fighter: the miss below is the sink, not a bad aim.
    expect(control.strike(headPoint.x, headPoint.y)).toBe(true);

    target.applyHitDetailed(weakBury);
    for (let i = 0; i < 40 && target.getBuriedPresentationState()?.phase !== 'buried'; i++) step();
    for (let i = 0; i < 30 && target.isInHitlag(); i++) step();
    expect(target.getBuriedPresentationState()?.phase).toBe('buried');
    const sunk = target.getActiveHurtboxes();
    expect(Math.min(...sunk.map(top))).toBeCloseTo(Math.min(...standing.map(top)) + depth, 6);

    expect(strike(headPoint.x, headPoint.y)).toBe(false);
    // Visible torso: halfway between the sunk top and the floor line (body bottom).
    const floorY = pos.y + target.getTuning().height / 2;
    const sunkTop = pos.y + Math.min(...sunk.map(top));
    expect(strike(pos.x, (sunkTop + floorY) / 2)).toBe(true);
    expect(target.getBuriedPresentationState()?.phase).toBe('buried');
  });
});
