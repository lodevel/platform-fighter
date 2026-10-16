import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_NEUTRAL_SPECIAL, LINK_SIDE_SPECIAL, LINK_UP_SPECIAL, LINK_DOWN_SPECIAL } from './Link';
import type { CharacterInput } from './Character';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const hold: CharacterInput = { ...neutral, special: true };

function setup(grounded = true) {
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
  const fighter = new Link(scene, { spawnX: 0, spawnY: 0 });
  const floor = (y: number) => Composite.add(engine.world, Bodies.rectangle(fighter.body.position.x, y, 1600, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  }));
  const step = (input: CharacterInput = neutral) => {
    fighter.applyInput(input); Engine.update(engine, 1000 / 60); fighter.applyPostPhysicsVelocityConstraints();
  };
  if (grounded) { floor(48); for (let i = 0; i < 10; i++) step(); }
  return { fighter, engine, step, floor };
}

/** Arrow callbacks the fighter queued (MatchScene turns them into projectiles via src/match/linkArticles.ts). */
const arrows = (fighter: Link) => fighter.consumeLinkRuntimeEvents().flatMap(e => e.event.kind === 'arrow' ? [e.event.plan] : []);

// Fresh Link's Bow (linkSpecialController): 15 startup frames, the arrow on frame 16 when
// tapped (SmashWiki: startup frame 16, FAF 45), then a charge whose damage runs 4% -> 12%
// (SmashWiki) and which fires by itself after being held fully charged for 3 s (SmashWiki).
describe('Link bow through real input and Matter', () => {
  it.each([true, false])('holds a partial charge and fires its recorded strength on release (grounded=%s)', grounded => {
    const { fighter, step } = setup(grounded);
    step(hold);
    expect(fighter.getChargeProgress()).toBe(0);
    for (let i = 0; i < 15 + 17; i++) step(hold); // 15 startup frames, then 18 charge frames
    expect(fighter.getChargeProgress()).toBeCloseTo(18 / 60);
    expect(arrows(fighter)).toEqual([]);
    step();
    const [arrow] = arrows(fighter);
    expect(arrow).toMatchObject({ arrowIndex: 0, damage: Math.floor(4 + 8 * 18 / 60), speedNative: 2.6 + 7.4 * 18 / 60 });
  });

  it('a tapped Bow fires a 4% arrow on frame 16 and a full charge a 12% one', () => {
    const tap = setup();
    tap.step(hold);
    for (let i = 0; i < 14; i++) { tap.step(); expect(arrows(tap.fighter)).toEqual([]); }
    tap.step();
    expect(arrows(tap.fighter).map(a => a.damage)).toEqual([4]);
    const full = setup();
    for (let i = 0; i < 15 + 36; i++) full.step(hold);
    expect(full.fighter.getChargeProgress()).toBe(1);
    full.step();
    expect(arrows(full.fighter).map(a => [a.damage, a.speedNative])).toEqual([[12, 10]]);
  });

  it('auto-fires 3 seconds after full charge while the button remains held', () => {
    const { fighter, step } = setup();
    for (let i = 0; i < 15 + 36; i++) step(hold);
    expect(fighter.getChargeProgress()).toBe(1);
    for (let i = 0; i < 179; i++) { step(hold); expect(arrows(fighter)).toEqual([]); }
    step(hold);
    expect(arrows(fighter).map(a => a.damage)).toEqual([12]);
    expect(fighter.getAnimationActionState().chargingMove).toBeNull();
  });

  it('airborne charge commits the jump input and cancels tumble before landing', () => {
    const { fighter, engine, step, floor } = setup(false);
    engine.gravity.y = 0;
    fighter.applyHit({ damage: 12, knockback: { x: 12, y: 0, scaling: 0 }, facing: 1 });
    while (fighter.getHitlagRemaining() > 0 || fighter.getHitstunRemaining() > 0) step();
    expect(fighter.isTumbling()).toBe(true);
    step(hold);
    expect(fighter.isTumbling()).toBe(false);
    Body.setVelocity(fighter.body, { x: 0, y: 2 });
    step({ ...hold, jump: true });
    expect(fighter.getVelocity().y).toBeGreaterThanOrEqual(0);
    floor(fighter.body.position.y + 48);
    for (let i = 0; i < 15; i++) step(hold);
    expect(fighter.isGrounded()).toBe(true);
    expect(fighter.isKnockedDown()).toBe(false);
    expect(fighter.getAnimationActionState().chargingMove?.id).toBe(LINK_NEUTRAL_SPECIAL.id);
  });

  it('saving and loading a tune preserves all bow charge behavior and endpoints', () => {
    const raw = JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('link'))));
    const loaded = parseCharacterDataFile(raw);
    expect(loaded.moves?.neutralSpecial).toEqual(LINK_NEUTRAL_SPECIAL);
    expect(loaded.moves?.sideSpecial).toEqual(LINK_SIDE_SPECIAL);
    expect(loaded.moves?.upSpecial).toEqual(LINK_UP_SPECIAL);
    expect(loaded.moves?.downSpecial).toEqual(LINK_DOWN_SPECIAL);
  });

  it.each([
    { path: ['downSpecial', 'trap', 'throwSpeedX'], value: 'fast' },
    { path: ['downSpecial', 'trap', 'trapLifetimeFrames'], value: 1.5 },
    { path: ['upSpecial', 'multiHitRising', 'hitFrames'], value: [0, 4] },
  ])('rejects an invalid saved special at $path', ({ path, value }) => {
    const raw = JSON.parse(JSON.stringify(serializeCharacterDataSpec(getAuthorableCharacterSpec('link'))));
    let field = raw.moves;
    for (const key of path.slice(0, -1)) field = field[key];
    field[path[path.length - 1]!] = value;
    expect(() => parseCharacterDataFile(raw)).toThrow();
  });
});
