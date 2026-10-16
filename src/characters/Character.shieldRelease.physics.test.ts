import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { Link, LINK_JAB, LINK_USMASH, LINK_UP_SPECIAL } from './Link';
import type { CharacterInput } from './Character';
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
const HIT = { damage: 3, knockback: { x: 1, y: -1, scaling: 0 }, facing: 1 as const };

function fixture(raisedFrames = 3) {
  const engine = Engine.create();
  const names: Record<string, string> = { collisionstart: 'collisionStart',
    collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, w: number, h: number, options: object) {
      const body = Bodies.rectangle(x, y, w, h, options);
      Composite.add(engine.world, body); return body;
    },
  }, world: {
    on(name: string, fn: (...args: any[]) => void) { Events.on(engine, names[name] ?? name, fn); },
    off(name: string, fn: (...args: any[]) => void) { Events.off(engine, names[name] ?? name, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const ch = new Link(scene, { spawnX: 0, spawnY: 0 });
  Composite.add(engine.world, Bodies.rectangle(0, 46, 4000, 20, { isStatic: true,
    label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: delta => Engine.update(engine, delta) });
  };
  for (let frame = 0; frame < 20; frame++) step();
  expect(ch.isGrounded()).toBe(true);
  for (let frame = 0; frame < raisedFrames; frame++) step({ ...NEUTRAL, shield: true });
  expect(ch.isShielding()).toBe(true);
  return { ch, step, scene };
}

describe('shield release through actual grounding', () => {
  it('observes indefinite hold and actual11 release without confusing parry eligibility with contact', () => {
    const { ch, step } = fixture(1);
    expect(ch.getShieldPresentationState()).toMatchObject({ kind: 'hold', framesElapsed: 0,
      totalFrames: null, remainingFrames: null });
    step({ ...NEUTRAL, shield: true }); step({ ...NEUTRAL, shield: true });
    expect(ch.getShieldPresentationState()?.framesElapsed).toBe(2);
    step();
    expect(ch.isShieldParrying()).toBe(true);
    expect(ch.getShieldPresentationState()).toMatchObject({ kind: 'release', framesElapsed: 0,
      totalFrames: 11, remainingFrames: 11 });
    step(); expect(ch.getShieldPresentationState()?.framesElapsed).toBe(1);
    ch.setPosition(0, 0); expect(ch.getShieldPresentationState()).toBeNull();
  });
  it('block outcome latches actual stacked counter and freezes it with hit-stop, pause and substeps', () => {
    const { ch, step } = fixture();
    ch.setFacing(-1);
    expect(ch.applyHitDetailed(HIT).outcome).toBe('shielded');
    const block = ch.getShieldPresentationState()!;
    expect(block).toMatchObject({ kind: 'block', framesElapsed: 0, facing: -1, phase: 'hitlag' });
    expect(block.totalFrames).toBe(ch.getShieldState().blockStunRemaining);
    for (let n = 0; n < 10; n++) {
      ch.applyPhysicsSubstepConstraints(); expect(ch.getShieldPresentationState()).toEqual(block);
    }
    while (ch.getHitlagRemaining() > 0) {
      step({ ...NEUTRAL, shield: true });
      expect(ch.getShieldPresentationState()?.framesElapsed).toBe(0);
    }
    ch.setFacing(1); step({ ...NEUTRAL, shield: true });
    expect(ch.getShieldPresentationState()).toMatchObject({ kind: 'block', framesElapsed: 1, facing: -1 });
    const prior = ch.getShieldState().blockStunRemaining;
    ch.applyHitDetailed(HIT);
    expect(ch.getShieldPresentationState()).toMatchObject({ kind: 'block', framesElapsed: 0, facing: 1 });
    expect(ch.getShieldPresentationState()!.totalFrames).toBeGreaterThan(prior);
  });
  it('successful contact exposes parry through freeze and final protected step, then retires it', () => {
    const { ch, step } = fixture(); step();
    expect(ch.getShieldPresentationState()?.kind).toBe('release');
    expect(ch.applyHitDetailed(HIT).outcome).toBe('parried');
    const total = ch.getShieldParryStunRemaining();
    expect(ch.getShieldPresentationState()).toMatchObject({ kind: 'parry', totalFrames: total,
      remainingFrames: total, framesElapsed: 0, phase: 'hitlag' });
    expect(ch.isShieldParrying()).toBe(false);
    while (ch.getHitlagRemaining() > 0) {
      step(); expect(ch.getShieldPresentationState()?.framesElapsed).toBe(0);
    }
    for (let n = 1; n <= total; n++) {
      step(); expect(ch.getShieldPresentationState()).toMatchObject({ kind: 'parry', framesElapsed: n });
    }
    step(); expect(ch.getShieldPresentationState()).toBeNull();
  });
  // SmashWiki Shield break / Stun: the broken fighter is popped upward, lands, and only then
  // runs the 400 - percent stun; the stun budget is not installed at the break itself.
  it('a break hands the stun to the shared shield-break phases: pop first, no stun budget yet', () => {
    const { ch, step } = fixture();
    expect(ch.applyHitDetailed({ ...HIT, damage: 100 }).outcome).toBe('shielded');
    expect(ch.isShieldBroken()).toBe(true);
    expect(ch.getSourceShieldBreakPresentationState()).toMatchObject({ phase: 'pop', controlsLocked: true });
    while (ch.getHitlagRemaining() > 0) step();
    step();
    expect(ch.getVelocity().y, 'popped upward').toBeLessThan(0);
    expect(ch.getShieldStunRemaining()).toBe(0);
    expect(ch.isInvincible(), 'intangible during the pop').toBe(true);
    ch.setPosition(0, 0);
    expect(ch.getSourceShieldBreakPresentationState()).toBeNull();
    expect(ch.getShieldPresentationState()).toBeNull();
  });
  it('holds a newly raised shield for three steps before release can parry', () => {
    const { ch, step } = fixture(1);
    step(); expect(ch.isShielding()).toBe(true); expect(ch.isShieldParrying()).toBe(false);
    step(); expect(ch.isShielding()).toBe(true); expect(ch.isShieldParrying()).toBe(false);
    step(); expect(ch.isShielding()).toBe(false); expect(ch.isShieldParrying()).toBe(true);
  });

  it.each([0, 1, 2, 3])('after ordinary blockstun, waiting %i free steps gates the next release parry', waited => {
    const { ch, step } = fixture();
    ch.applyHitDetailed(HIT);
    while (ch.getHitlagRemaining() > 0 || ch.getShieldState().blockStunRemaining > 0)
      step({ ...NEUTRAL, shield: true });
    for (let frame = 0; frame < waited; frame++) step({ ...NEUTRAL, shield: true });
    step();
    expect(ch.getShieldReleaseRemaining()).toBe(11);
    expect(ch.isShieldParrying()).toBe(waited === 3);
  });

  it('a successful parry remains protected and locked through hit-stop plus ordinary shieldstun', () => {
    const { ch, step } = fixture();
    step(); expect(ch.applyHitDetailed(HIT).outcome).toBe('parried');
    const freeze = ch.getHitlagRemaining();
    expect(ch.getShieldParryStunRemaining()).toBe(4); // floor(3*.8+3)-1
    for (let frame = 0; frame < freeze + 4; frame++) {
      expect(ch.canAttack()).toBe(false);
      expect(ch.isInvincible()).toBe(true);
      expect(ch.applyHitDetailed(HIT).outcome).toBe('invincible');
      expect(ch.getDamagePercent()).toBe(0);
      step();
    }
    expect(ch.getShieldParryStunRemaining()).toBe(0);
    expect(ch.isInvincible()).toBe(true); // final locked integration
    step({ ...NEUTRAL, attack: true });
    expect(ch.isInvincible()).toBe(false);
    expect(ch.getActiveAttack()?.move.id).toBe(LINK_JAB.id);
  });

  it('zero-damage contact blocks without consuming or triggering the parry window', () => {
    const { ch, step } = fixture(); step();
    expect(ch.applyHitDetailed({ ...HIT, damage: 0 }).outcome).toBe('shielded');
    expect(ch.getHitlagRemaining()).toBe(0);
    expect(ch.getShieldParryStunRemaining()).toBe(0);
    expect(ch.getShieldPresentationState()?.kind).toBe('release');
    expect(ch.isShieldParrying()).toBe(true);
  });

  it('raising blocks normally and never opens a release parry', () => {
    const { ch } = fixture();
    expect(ch.isShieldParrying()).toBe(false);
    const hp = ch.getShieldHealth();
    const result = ch.applyHitDetailed(HIT);
    expect(result.outcome).toBe('shielded');
    // SmashWiki Shield: Ultimate shields lose 1.19× the damage (https://www.ssbwiki.com/Shield).
    expect(ch.getShieldHealth()).toBeCloseTo(hp - 3 * 1.19, 10);
    expect(ch.getHitlagRemaining()).toBeGreaterThan(0);
  });

  it.each([0, 1, 2, 3, 4, 5, 10])('release elapsed %i has exactly the five-step parry window', elapsed => {
    const { ch, step } = fixture();
    for (let frame = 0; frame <= elapsed; frame++) step();
    expect(ch.getShieldReleaseRemaining()).toBe(11 - elapsed);
    expect(ch.isShieldParrying()).toBe(elapsed < 5);
    const result = ch.applyHitDetailed(HIT);
    expect(result.outcome).toBe(elapsed < 5 ? 'parried' : 'landed');
    expect(ch.getDamagePercent()).toBe(elapsed < 5 ? 0 : 3);
    expect(ch.getShieldReleaseRemaining()).toBe(0);
  });

  it('ordinary movement and buffered jab wait through all eleven release steps', () => {
    const { ch, step } = fixture();
    const x = ch.getPosition().x;
    step();
    for (let elapsed = 1; elapsed < 11; elapsed++) {
      step(elapsed === 10 ? { ...NEUTRAL, attack: true } : { ...NEUTRAL, moveX: 1 });
      expect(ch.canAttack()).toBe(false);
      expect(ch.getActiveAttack()).toBeNull();
      expect(ch.getPosition().x).toBeCloseTo(x, 8);
    }
    expect(ch.canUseItemsBeforeInput()).toBe(true);
    step();
    expect(ch.getShieldReleaseRemaining()).toBe(0);
    expect(ch.getActiveAttack()?.move.id).toBe(LINK_JAB.id);
  });

  it.each(['jump', 'up smash', 'up special'] as const)('%s cancels guard-off and its parry protection', action => {
    const { ch, step } = fixture();
    step();
    step(action === 'jump' ? { ...NEUTRAL, jump: true }
      : action === 'up smash' ? { ...NEUTRAL, moveY: -1, attackHeavy: true }
      : { ...NEUTRAL, moveY: -1, special: true });
    expect(ch.getShieldReleaseRemaining()).toBe(0);
    expect(ch.isShieldParrying()).toBe(false);
    if (action === 'jump') expect(ch.getJumpsquatRemaining()).toBe(3);
    else if (action === 'up smash') {
      expect(ch.getAnimationActionState().chargingMove?.id ?? ch.getActiveAttack()?.move.id).toBe(LINK_USMASH.id);
    } else expect(ch.getAnimationActionState().chargingMove?.id).toBe(LINK_UP_SPECIAL.id);
  });

  it('horizontal-dominant heavy input cannot disguise a forward smash as an up-smash cancel', () => {
    const { ch, step } = fixture();
    step();
    step({ ...NEUTRAL, moveX: 1, moveY: -0.4, attackHeavy: true });
    expect(ch.getShieldReleaseRemaining()).toBe(10);
    expect(ch.getActiveAttack()).toBeNull();
    expect(ch.getAnimationActionState().chargingMove).toBeNull();
  });

  it('releasing during shieldstun opens guard-off only after the stun has ended', () => {
    const { ch, step } = fixture();
    ch.applyHitDetailed(HIT);
    for (let frame = 0; frame < 40 && ch.isShielding(); frame++) {
      expect(ch.isShieldParrying()).toBe(false);
      step();
    }
    expect(ch.isShielding()).toBe(false);
    expect(ch.getShieldReleaseRemaining()).toBe(11);
    expect(ch.isShieldParrying()).toBe(false);
  });

  it('round reset clears a release window instead of granting free protection on spawn', () => {
    const { ch, step } = fixture();
    step();
    expect(ch.isShieldParrying()).toBe(true);
    ch.resetForRound(0, 0);
    expect(ch.getShieldReleaseRemaining()).toBe(0);
    expect(ch.isShieldParrying()).toBe(false);
  });
});
