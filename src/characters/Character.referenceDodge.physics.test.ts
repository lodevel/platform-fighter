import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Character, type CharacterInput } from './Character';
import { Link } from './Link';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { GAME_CONFIG } from '../engine/constants';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const HIT = { damage: 1, knockback: { x: 0, y: -1, scaling: 0 }, facing: 1 as const };

function fixture(directBase = false) {
  const engine = Engine.create();
  engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = { collisionstart: 'collisionStart',
    collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, options: object) {
      const body = Bodies.rectangle(x, y, width, height, options);
      Composite.add(engine.world, body); return body;
    },
  }, world: {
    on(name: string, fn: (...args: any[]) => void) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: (...args: any[]) => void) { Events.off(engine, names[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const ch = directBase ? new Character(scene, { id: 'link', spawnX: 0, spawnY: 0 })
    : new Link(scene, { spawnX: 0, spawnY: 0 });
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
  };
  const land = () => {
    const pos = ch.getPosition();
    Composite.add(engine.world, Bodies.rectangle(pos.x, pos.y + ch.getTuning().height / 2 + 11,
      1000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
        collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    Body.setVelocity(ch.body, { x: 0, y: 2 });
    step();
    expect(ch.isGrounded()).toBe(true);
  };
  const catchLedge = () => {
    const pos = ch.getPosition();
    ch.setLedgeCandidates([{ platformId: 'defense.ledge', side: 'right', x: pos.x, y: pos.y }]);
    ch.setFacing(1); Body.setVelocity(ch.body, { x: 0, y: 2 });
    step();
    expect(ch.isHangingOnLedge()).toBe(true);
    // Link's sourced catch (native cliff_catch cancel 20) locks the hang for 19 steps.
    for (let frame = 0; frame < 19; frame++) step();
  };
  const dropLedge = () => {
    step({ ...NEUTRAL, moveY: 1 });
    ch.setLedgeCandidates([]);
    for (let frame = 0; frame < 35; frame++) step();
    expect(ch.isHangingOnLedge()).toBe(false);
  };
  return { ch, step, land, engine, catchLedge, dropLedge };
}

describe('Link fresh air-dodge defense through Matter', () => {
  it('a second airborne ledge catch has no hang invulnerability, and grounding refreshes it', () => {
    const { ch, step, land, catchLedge, dropLedge } = fixture();
    catchLedge(); expect(ch.isInvincible()).toBe(true);
    dropLedge(); catchLedge();
    expect(ch.getLedgeHangState().ledgeGrabsSinceGround).toBe(2);
    expect(ch.isInvincible()).toBe(false);
    dropLedge(); land(); step();
    expect(ch.getLedgeHangState().ledgeGrabsSinceGround).toBe(0);
  });

  // SmashWiki Edge: regrab protection returns after landing "or sustaining hitstun". Link now
  // carries the Ultimate regrab tuning (maxGrabsWithoutGround), so any hit that deals hitstun
  // refreshes it, launching or not (the same shared rule DK uses).
  it.each([false, true])('a hit with hitstun (launch=$0) refreshes airborne regrab protection', launches => {
    const { ch, step, catchLedge, dropLedge } = fixture();
    catchLedge(); dropLedge();
    const result = ch.applyHitDetailed({ ...HIT, knockback: { x: 0, y: launches ? -1 : 0, scaling: 0 } });
    expect(result.outcome).toBe('landed');
    expect(ch.getDamagePercent()).toBe(1);
    expect(ch.getLedgeHangState().ledgeGrabsSinceGround).toBe(0);
    for (let frame = 0; frame < 100; frame++) step();
    catchLedge();
    expect(ch.isInvincible()).toBe(true);
  });

  it.each([
    { facing: 1 as const, x: 0, locked: 26, reverse: false },
    { facing: 1 as const, x: 1, locked: 30, reverse: true },
    { facing: 1 as const, x: -1, locked: 35, reverse: false },
    { facing: -1 as const, x: -1, locked: 30, reverse: true },
    { facing: -1 as const, x: 1, locked: 35, reverse: false },
  ])('ground dodge $x relative to facing $facing remains locked for $locked steps', row => {
    const { ch, step, land } = fixture();
    land();
    for (let frame = 0; frame < 10; frame++) step();
    ch.setFacing(row.facing);
    step({ ...NEUTRAL, moveX: row.x, dodge: true });
    for (let elapsed = 0; elapsed < row.locked; elapsed++) {
      expect(ch.isGrounded()).toBe(true);
      expect(ch.isDodging()).toBe(true);
      expect(ch.getFacing()).toBe(row.reverse && elapsed >= 19 ? -row.facing : row.facing);
      step();
    }
    expect(ch.isDodging()).toBe(false);
    expect(ch.canAttack()).toBe(true);
  });

  it.each([
    { x: 0, y: 0, locked: 49 }, { x: 1, y: 0, locked: 82 },
    { x: -1, y: 0, locked: 82 }, { x: 0, y: -1, locked: 108 },
    { x: 0, y: 1, locked: 69 }, { x: 1, y: -1, locked: 95 },
    { x: -1, y: 1, locked: 74 },
  ])('locks the captured ($x,$y) dodge for $locked steps, then permits a jump', ({ x, y, locked }) => {
    const { ch, step, engine } = fixture();
    step({ ...NEUTRAL, moveX: x, moveY: y, dodge: true });
    for (let elapsed = 1; elapsed < locked; elapsed++) {
      expect(ch.isDodging()).toBe(true);
      step({ ...NEUTRAL, moveX: -x, moveY: -y });
    }
    expect(ch.isDodging()).toBe(true);
    expect(engine.timing.timestamp).toBeCloseTo(locked * GAME_CONFIG.fixedTimestepMs, 6);
    step({ ...NEUTRAL, jump: true });
    expect(ch.isDodging()).toBe(false);
    expect(ch.getVelocity().y).toBeLessThan(0);
    expect(ch.getDodgeState().name).toBe('idle');
  });

  it.each([0, 1, 2, 20, 21])('directional elapsed %i applies hit immunity only on source frames 3–21', elapsed => {
    const { ch, step } = fixture(true);
    step({ ...NEUTRAL, moveX: 1, dodge: true });
    for (let frame = 0; frame < elapsed; frame++) step();
    const expectedImmune = elapsed >= 2 && elapsed <= 20;
    expect(ch.isDodgeInvincible()).toBe(expectedImmune);
    ch.applyHit(HIT);
    expect(ch.getDamagePercent()).toBe(expectedImmune ? 0 : 1);
    expect(ch.isDodging()).toBe(expectedImmune);
  });

  it('neutral immunity ends on frame 31 while the remaining action stays vulnerable', () => {
    const { ch, step } = fixture();
    step({ ...NEUTRAL, shield: true });
    for (let elapsed = 1; elapsed <= 29; elapsed++) step();
    expect(ch.getDodgeIframesRemaining()).toBe(1);
    step();
    expect(ch.isDodgeInvincible()).toBe(false);
    expect(ch.isDodging()).toBe(true);
    ch.applyHit(HIT);
    expect(ch.getDamagePercent()).toBe(1);
    expect(ch.isDodging()).toBe(false);
  });

  it('hitlag freezes startup and a round reset restores the spent air resource', () => {
    const { ch, step } = fixture();
    step({ ...NEUTRAL, moveX: 1, dodge: true });
    ch.armAttackerHitlag(3);
    for (let frame = 0; frame < 3; frame++) {
      step();
      expect(ch.getDodgeState().active?.framesElapsed).toBe(0);
      expect(ch.isDodgeInvincible()).toBe(false);
    }
    step();
    expect(ch.getDodgeState().active?.framesElapsed).toBe(1);
    step();
    expect(ch.isDodgeInvincible()).toBe(true);
    ch.resetForRound(0, 0);
    step({ ...NEUTRAL, dodge: true });
    expect(ch.getDodgeState().active?.framesElapsed).toBe(0);
    expect(ch.isDodgeInvincible()).toBe(false);
  });

  it.each([{ directional: false, landing: 10 }, { directional: true, landing: 19 }])(
    'touchdown replaces the airborne commitment with the retained $landing-step landing rule', ({ directional, landing }) => {
      const { ch, step, land } = fixture();
      step({ ...NEUTRAL, moveX: directional ? 1 : 0, dodge: true });
      // Actual landing while the dodge is in its recovery tail.
      for (let frame = 0; frame < 31; frame++) step();
      land();
      for (let frame = 0; frame < landing; frame++) {
        step({ ...NEUTRAL, shield: true });
        expect(ch.isShielding()).toBe(false);
        expect(ch.isDodgeInvincible()).toBe(false);
        expect(ch.getAnimationActionState().landingRecoveryRemaining).toBe(landing - frame);
      }
      step({ ...NEUTRAL, shield: true });
      expect(ch.isShielding()).toBe(true);
    },
  );
});
