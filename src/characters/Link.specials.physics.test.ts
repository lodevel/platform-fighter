import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_UP_SPECIAL } from './Link';
import { LinkArticles, type LinkArticleHost } from '../match/linkArticles';
import { LINK_REMOTE_BOMB_ITEM_DEFINITION } from '../items/LinkRemoteBombItem';
import { itemExplosionHit } from '../items/BobOmb';
import type { CharacterInput } from './Character';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { HITBOX_LABEL } from './attacks';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };

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
  if (grounded) {
    Composite.add(engine.world, Bodies.rectangle(0, 48, 1600, 20, { isStatic: true,
      label: PLATFORM_LABELS.solid, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    fighter.setLedgeCandidates([{ platformId: 'ground', side: 'left', x: -800, y: 38 },
      { platformId: 'ground', side: 'right', x: 800, y: 38 }]);
  }
  const step = (input: CharacterInput = neutral) => {
    fighter.applyInput(input); Engine.update(engine, 1000 / 60); fighter.applyPostPhysicsVelocityConstraints();
  };
  const frames = (count: number) => { for (let i = 0; i < count; i++) step(); };
  if (grounded) frames(10);
  return { fighter, engine, step, frames };
}

describe('Link special behavior through real input and Matter', () => {
  it('grounded Spin Attack stays on the floor and uses its grounded timeline', () => {
    const { fighter, engine, step, frames } = setup();
    expect(fighter.isGrounded()).toBe(true);
    step({ ...neutral, special: true, moveY: -1 });
    expect(fighter.getLinkSpinState()?.phase).toBe('ground-start');
    expect(fighter.getChargeProgress()).toBe(0);
    const hits: number[] = [];
    for (let i = 0; i < 6; i++) {
      step(); // a tap releases into the grounded swing: its first hit is frame 7, 14% (SmashWiki)
      hits.push(...Composite.allBodies(engine.world).filter((b: any) => b.label === HITBOX_LABEL).map((b: any) => b.plugin.damage));
    }
    expect(hits).toEqual([14]);
    frames(10);
    expect(fighter.isGrounded()).toBe(true);
    expect(fighter.getActiveAttack()?.phase).toBe('active');
    expect(fighter.getVelocity().y).toBeGreaterThan(-1);
  });

  it('aerial Spin Attack rises, schedules all hits, and ends helpless', () => {
    const { fighter, engine, step, frames } = setup(false);
    step({ ...neutral, special: true, moveY: -1 });
    expect(fighter.getVelocity().y).toBeLessThan(-10);
    // Fresh Spin is one source-owned hitbox whose packet changes per strike: nine strikes, 4% first and last.
    const strikes: Array<{ start: number; damage: number }> = [];
    let previous = false;
    // Helpless follows the 91-frame native aerial Spin motion (LINK_SPIN_SOURCE.airAnimationFrames).
    for (let i = 0; i < 95; i++) {
      step();
      const live = Composite.allBodies(engine.world).filter((body: any) => body.label === HITBOX_LABEL);
      if (live.length && !previous) strikes.push({ start: fighter.getActiveAttack()!.framesElapsed, damage: live[0].plugin.damage });
      previous = live.length > 0;
    }
    expect(strikes.map(s => s.start)).toEqual([7, 11, 15, 18, 21, 25, 30, 37, 46]);
    expect(strikes.map(s => s.damage)).toEqual([4, 2, 2, 2, 2, 2, 2, 2, 4]);
    expect(fighter.isHelpless()).toBe(true);
    expect(fighter.attemptUpSpecial()).toBe(false);
    frames(2);
    expect(fighter.getLinkSpinState()?.phase).toBe('helpless');
    expect(fighter.getActiveAttack()?.hitboxBody ?? null).toBeNull();
  });

  it.each([{ moveY: 0, moveX: 0 }, { moveY: 0, moveX: 1 }])('projectile specials never spawn a second melee hitbox: %j', direction => {
    const { engine, step, frames } = setup();
    step({ ...neutral, ...direction, special: true });
    frames(30);
    expect(Composite.allBodies(engine.world).filter((body: any) => body.label === HITBOX_LABEL)).toHaveLength(0);
  });

  it('pulls a bomb on frame 17; a second press detonates that same bomb on frame 12', () => {
    // The bomb itself is an item the match owns (src/match/linkArticles.ts); here a host double stands in for it.
    const { fighter, step, frames } = setup();
    const articles = new LinkArticles(), fighters = [{ playerIndex: 0, character: fighter, live: true }];
    const log = { pulled: [] as number[], exploded: [] as number[], holder: null as number | null };
    const host: LinkArticleHost = { spawnProjectile: () => {}, spawnBomb: () => { log.holder = 0; return 41; },
      bombHolder: () => log.holder, explodeBomb: id => { log.exploded.push(id); }, removeHeldItem: () => {} };
    const tick = (frame: number) => { articles.commit(fighters, host); articles.step(host); articles.syncOwners(fighters, []);
      if (log.pulled.length === 0 && articles.snapshot().bombs.length) log.pulled.push(frame); };
    step({ ...neutral, moveY: 1, special: true }); tick(1);
    for (let frame = 2; frame <= 40; frame++) { step(); tick(frame); }
    expect(log.pulled).toEqual([17]);
    log.holder = null; // thrown: lying free in the world
    frames(30); tick(0);
    step({ ...neutral, moveY: 1, special: true }); tick(1);
    for (let frame = 2; frame <= 12; frame++) { expect(log.exploded).toEqual([]); step(); tick(frame); }
    expect(log.exploded).toEqual([41]);
  });

  it('remote explosion can damage and launch Link for recovery', () => {
    // SmashWiki: the 7% blast also hurts Link; the generic item explosion applies it.
    const { fighter } = setup();
    const blast = LINK_REMOTE_BOMB_ITEM_DEFINITION.explosion!;
    expect(blast).toMatchObject({ damage: 7, radius: 70, hitsOwner: true, knockback: { angle: 52, base: 60, growth: 115 } });
    fighter.applyHit(itemExplosionHit(blast, 1));
    expect(fighter.getDamagePercent()).toBe(7);
    expect(fighter.getHitlagRemaining() + fighter.getHitstunRemaining()).toBeGreaterThan(0);
  });

  it('grounded/aerial variants retain independently authored data', () => {
    expect(LINK_UP_SPECIAL.groundedVariant?.activeFrames).not.toBe(LINK_UP_SPECIAL.activeFrames);
    expect(LINK_UP_SPECIAL.multiHitRising.hitFrames).toEqual([0, 4, 8, 11, 14, 18, 23, 30, 39]);
  });
});
