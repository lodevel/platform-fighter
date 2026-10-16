import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link } from '../characters/FreshLink';
import { DonkeyKong } from '../characters/DonkeyKong';
import type { Character, CharacterInput } from '../characters/Character';
import { computeReferenceKnockback } from '../characters/referenceKnockback';
import { applyCombatModifiers } from '../characters/referenceCombatModifiers';
import { stepCharacterPhysics } from '../characters/stepCharacterPhysics';
import { linkReleasePoint } from '../characters/linkAttackData';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { LinkArticles, type LinkArticleFighter, type LinkTerrainBox } from '../match/linkArticles';
import { FinalSmashController } from './FinalSmashController';
import { FinalSmashChoreography } from './FinalSmashChoreography';
import { finalPacketBinding, finalRunPacketHit } from './finalPacketBinding';
import { ANCIENT_ARROW_FLIGHT } from './linkAncientBow';
import type { FinalRun } from './finalSmashSchema';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const neutral: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const PX = 5;

// SmashWiki "Link (SSBU)/Final Smash" hitbox table (wikitext rows): Flying 0% angle 361 BK 10 KS 66 r 5 top z 4;
// Explosion (fighter) 35% angle 60 BK 102 KS 46 r 25; Explosion (wall) 20% angle 50 BK 122 KS 35 r 25. All
// unblockable, fighters only. SmashWiki "Final Smash Meter": Link's meter Final deals 0.7x damage, 0.9x knockback.
const SMASHWIKI = {
  flight: { damage: 0, angle: 361, base: 10, growth: 66, radius: 5, z: 4 },
  fighter: { damage: 35, angle: 60, base: 102, growth: 46, radius: 25 },
  terrain: { damage: 20, angle: 50, base: 122, growth: 35, radius: 25 },
  meter: { damage: .7, reaction: .9 },
};

/** A fresh two-fighter match (no resetForRound): Link at x 0, Donkey Kong ahead of him, a wide floor,
 * the Final controller and choreography wired the way MatchScene wires them, Link's articles and the
 * Final hit path (finalPacketBinding + finalRunPacketHit + applyCombatModifiers, applied to the victim). */
function match(options: { resource: 'meter' | 'ball'; dkX: number; wallX?: number }) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, o: object) { const b = Bodies.rectangle(x, y, w, h, o); Composite.add(engine.world, b); return b; },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const link = new Link(scene, { spawnX: 0, spawnY: 0 }), dk = new DonkeyKong(scene, { spawnX: options.dkX, spawnY: 0 });
  dk.setFacing(-1);
  const fighters: Character[] = [link, dk];
  const terrain: LinkTerrainBox[] = [{ solid: true, min: { x: -3000, y: 38 }, max: { x: 3000, y: 58 } }];
  Composite.add(engine.world, Bodies.rectangle(0, 48, 6000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  if (options.wallX !== undefined) terrain.push({ solid: true, min: { x: options.wallX, y: -400 }, max: { x: options.wallX + 40, y: 38 } });
  const step = () => {
    fighters.forEach(f => f.applyInput(neutral));
    stepCharacterPhysics({ characters: fighters, bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body,
      deltaMs: 1000 / 60, stepWorld: delta => Engine.update(engine, delta) });
  };
  for (let i = 0; i < 20; i++) step();

  const controller = new FinalSmashController({ schemaVersion: 1, meterEnabled: options.resource === 'meter', smashBallEnabled: options.resource === 'ball' },
    fighters.map((f, playerIndex) => ({ playerIndex, fighter: f.id, generation: f.getPositionResetGeneration() })));
  const articles = new LinkArticles();
  const entries = (): LinkArticleFighter[] => fighters.map((character, playerIndex) => ({ playerIndex, character, live: true }));
  let frame = 100;
  const hits: Array<{ label: string; target: number; damage: number; outcome: string; referenceKnockback?: number;
    angle?: number | null; vector: { x: number; y: number } }> = [];
  const choreography = new FinalSmashChoreography(controller, {
    actor: index => {
      const a = fighters[index]; if (!a) return null;
      return { playerIndex: index, fighter: a.id, generation: a.getPositionResetGeneration(), centre: a.getPosition(), root: a.getSourceRootPosition(),
        facing: a.getFacing(), grounded: a.isGrounded(), hitlag: a.isInHitlag(), eligibleVictim: a.getActiveHurtboxes().some(h => !h.intangible) };
    },
    equipment: index => fighters[index]?.getLinkEquipmentState() ?? null,
    retainBodyTail: () => {},
    lease: (index, control) => fighters[index]?.setFinalSmashControl(control),
    moveRoot: (index, root, runId) => { fighters[index]?.moveFinalSmashSourceRoot(root, runId); },
    contacts: () => [], hit: () => false, groundRay: () => true, cliffStopVelocity:(_owner,velocity)=>velocity,captureAnchor: () => null, captureRoot: () => null,
    linkEvent: (owner, event, run) => {
      fighters[owner]!.onLinkFinalEvent(event, run.id);
      if (event.kind === 'shoot-ancient-arrow') articles.shootAncientArrow(run, entries()[owner]!, frame);
      if (event.kind === 'slow-opponents') fighters.forEach((f, i) => { if (i !== owner) f.setFinalOpponentSlow(run.id, event.rawFactor, event.rawDuration, frame); });
    },
    camera: () => {},
  }, PX, 16 / 9);
  const hit = (run: FinalRun, target: number, label: 'ancient-fighter' | 'ancient-terrain', damageMultiplier: number) => {
    const packet = finalPacketBinding('link', 'final', label, 0)!, victim = fighters[target]!, before = victim.getDamagePercent();
    // MatchScene.resolveCombatHit applies the run's meter scale with rage (Link at 0%) and a fresh (unstaled) Final.
    const result = victim.applyHitDetailed(applyCombatModifiers(finalRunPacketHit(packet, run, link.getFacing(), damageMultiplier), link.getDamagePercent(), 1));
    hits.push({ label, target, damage: victim.getDamagePercent() - before, outcome: result.outcome,
      referenceKnockback: result.knockback.referenceKnockback, angle: result.knockback.nativeLaunchAngleRadians, vector: result.knockback.vector });
    return result.outcome === 'landed';
  };

  if (options.resource === 'meter') controller.damageReceipt({ id: 'fill', frame, attacker: null, victim: 0, appliedPercent: 2000 / 9, recoil: false });
  else controller.grantBall(0, frame);
  expect(controller.getAvailableResource(0)).toBe(options.resource);
  choreography.consume(controller.activate([{ playerIndex: 0, fighter: 'link', generation: link.getPositionResetGeneration(),
    neutralSpecialEdge: true, legallyActionable: true, airborne: false }], frame), frame);
  const run = controller.getActive()!;
  const advance = () => {
    frame++;
    choreography.beforeStep(frame, false);
    step();
    articles.stepAncientArrows(entries(), terrain, hit, frame);
    choreography.afterPhysics(frame);
  };
  return { link, dk, articles, controller, run, hits, advance, frame: () => frame };
}

describe('Link Final Smash: Ancient Bow and Arrow in a fresh match', () => {
  it('binds the SmashWiki packets', () => {
    const geometry = (label: string) => finalPacketBinding('link', 'final', label, 0)!.native;
    for (const [label, row] of [['ancient-flight', SMASHWIKI.flight], ['ancient-fighter', SMASHWIKI.fighter], ['ancient-terrain', SMASHWIKI.terrain]] as const) {
      const p = geometry(label);
      expect([p.damage, p.launch.angle, p.launch.base, p.launch.growth, p.geometry.radius], label)
        .toEqual([row.damage, row.angle, row.base, row.growth, row.radius]);
      expect(p.bone).toBe('top');
    }
    expect(geometry('ancient-flight').geometry.start.z).toBe(SMASHWIKI.flight.z);
    expect(finalPacketBinding('link', 'final', 'ancient-fighter', 0)!.unblockable).toBe(true);
  });

  it.each([['meter', SMASHWIKI.meter], ['ball', { damage: 1, reaction: 1 }]] as const)(
    'with a full %s Link fires at native frame 60, the arrow flies, hits DK and DK takes the explosion', (resource, scale) => {
      const m = match({ resource, dkX: 1000 });
      expect(m.run.scales).toEqual(scale);
      for (let i = 0; i < 59; i++) { m.advance(); expect(m.articles.ancientArrows()).toEqual([]); }
      m.advance(); // native frame 60: shoot callback
      const [arrow] = m.articles.ancientArrows();
      expect(arrow).toBeDefined();
      // Origin from data (link.final bow hand at frame 60), never a drawn socket: no Link Final art is installed.
      const point = linkReleasePoint('ancientArrow', false), body = m.link.getPosition();
      expect(arrow!.state).toMatchObject({ phase: 'fly', x: body.x + point.x, y: body.y + point.y, facing: 1 });
      const xs = [arrow!.state.x];
      while (m.articles.ancientArrows()[0]?.state.phase === 'fly') { m.advance(); xs.push(m.articles.ancientArrows()[0]!.state.x); }
      // Travel: native speed_x 60 per frame (300 px) until the flying hitbox reaches DK.
      expect(xs.length).toBeGreaterThan(2);
      expect(xs[1]! - xs[0]!).toBeCloseTo(ANCIENT_ARROW_FLIGHT.speedNative * PX);
      expect(m.articles.ancientArrows()[0]!.state.phase).toBe('fighter-blast');
      expect(m.hits).toHaveLength(1);
      const [h] = m.hits;
      const damage = SMASHWIKI.fighter.damage * scale.damage;
      expect(h).toMatchObject({ label: 'ancient-fighter', target: 1, outcome: 'landed' });
      expect(h!.damage).toBeCloseTo(damage);
      expect(m.dk.getDamagePercent()).toBeCloseTo(damage);
      expect(h!.angle).toBeCloseTo(SMASHWIKI.fighter.angle * Math.PI / 180);
      // The meter's damage multiplier scales the % dealt, not the move damage in the knockback growth (SmashWiki
      // "Final Smash Meter": only Luigi's "behaves like a base damage reduction"); the knockback multiplier scales the launch.
      const expected = computeReferenceKnockback(SMASHWIKI.fighter, damage, SMASHWIKI.fighter.damage, m.dk.getTuning().referenceWeight, 1, true, scale.reaction);
      expect(h!.referenceKnockback).toBeCloseTo(expected.referenceKnockback);
      expect(h!.vector.x).toBeGreaterThan(0); // launched away from Link (facing right), up at 60 degrees
      expect(h!.vector.y).toBeLessThan(0);
      for (let i = 0; i < 40; i++) m.advance();
      expect(m.dk.getPosition().y).toBeLessThan(0);
      expect(m.articles.ancientArrows()).toEqual([]);
      expect(m.hits).toHaveLength(1);
    });

  it('a wall in the way takes the 20% explosion instead, which still catches DK beside it', () => {
    const m = match({ resource: 'ball', dkX: 760, wallX: 650 });
    for (let i = 0; i < 64 && !m.hits.length; i++) m.advance();
    expect(m.hits.map(h => [h.label, h.target, h.outcome])).toEqual([['ancient-terrain', 1, 'landed']]);
    expect(m.dk.getDamagePercent()).toBeCloseTo(SMASHWIKI.terrain.damage);
    expect(m.hits[0]!.angle).toBeCloseTo(SMASHWIKI.terrain.angle * Math.PI / 180);
  });

  it('flies its native range and leaves play when nothing is in the way', () => {
    const m = match({ resource: 'ball', dkX: 5000 });
    for (let i = 0; i < 60; i++) m.advance();
    const start = m.articles.ancientArrows()[0]!.state.x;
    let frames = 0;
    while (m.articles.ancientArrows().length) { m.advance(); frames++; }
    // Native dist_meter 60 x 10 = 600 units: ten 60-unit steps; the eleventh exceeds it.
    expect(frames).toBe(11);
    expect(start).toBeLessThan(m.link.getPosition().x + 200);
    expect(m.hits).toEqual([]);
  });

  it('rewinds: a checkpoint taken in flight restores to the same arrow', () => {
    const m = match({ resource: 'ball', dkX: 2500 });
    for (let i = 0; i < 61; i++) m.advance();
    const checkpoint = JSON.parse(JSON.stringify(m.articles.snapshot()));
    const copy = new LinkArticles();
    copy.restore(checkpoint);
    expect(copy.snapshot()).toEqual(m.articles.snapshot());
    expect(copy.ancientArrows()[0]!.state).toEqual(m.articles.ancientArrows()[0]!.state);
  });
});
