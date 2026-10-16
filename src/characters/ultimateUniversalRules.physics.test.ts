/**
 * Ultimate universal rules on real fighters (Matter world): every rule is engine-wide, so each is
 * exercised on Donkey Kong and on Pikachu. Sources are cited in ultimateUniversalRules.test.ts and
 * docs/review/2026-09-25/donkeykong-character/rework-2026-10-10/install/engine-source-fixes/.
 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { DonkeyKong } from './DonkeyKong';
import { Pikachu } from './Pikachu';
import type { Character, CharacterInput } from './Character';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import { GAME_CONFIG } from '../engine/constants';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { ultimateLedgeHangIntangibilityFrames } from './ledgeHangState';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
type FighterClass = typeof DonkeyKong | typeof Pikachu;
const FIGHTERS: readonly [string, FighterClass][] = [['donkeykong', DonkeyKong], ['pikachu', Pikachu]];

function world() {
  const engine = Engine.create(); engine.gravity.y = GAME_CONFIG.gravity;
  const names: Record<string, string> = { collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd' };
  const scene: any = { matter: { body: Body, add: { rectangle(x: number, y: number, w: number, h: number, o: object) {
    const b = Bodies.rectangle(x, y, w, h, o); Composite.add(engine.world, b); return b; } },
  world: { on(n: string, f: any) { Events.on(engine, names[n] ?? n, f); }, off(n: string, f: any) { Events.off(engine, names[n] ?? n, f); },
    remove(b: any) { Composite.remove(engine.world, b); } } } };
  return { engine, scene };
}

/** One fighter standing on a wide floor (top y = 42). */
function standing(Fighter: FighterClass) {
  const { engine, scene } = world();
  const fighter: Character = new Fighter(scene, { spawnX: 0, spawnY: 0 });
  Composite.add(engine.world, Bodies.rectangle(0, 52, 4000, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
  let frame = 0;
  const step = (input: Partial<CharacterInput> = {}) => {
    frame += 1;
    fighter.applyInput({ ...NEUTRAL, ...input }, frame);
    stepCharacterPhysics({ characters: [fighter], bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body,
      deltaMs: GAME_CONFIG.fixedTimestepMs, stepWorld: d => Engine.update(engine, d) });
  };
  fighter.setInvincibility(0);
  for (let i = 0; i < 30; i++) step();
  expect(fighter.isGrounded()).toBe(true);
  return { fighter, step };
}

const hit = (damage: number) => ({ damage, facing: 1 as const, hitlagMultiplier: 1,
  knockback: { x: 1, y: -1, scaling: 0, reference: { base: 40, growth: 80, angle: 45 } } });

describe.each(FIGHTERS)('M18 1v1 multiplier on %s', (_id, Fighter) => {
  it('takes 1.2× percent from hits and other damage while knockback and hitstun stay unmultiplied', () => {
    const plain = standing(Fighter).fighter, oneOnOne = standing(Fighter).fighter;
    oneOnOne.setDamageTakenMultiplier(1.2);
    plain.setDamagePercent(40); oneOnOne.setDamagePercent(40);
    const a = plain.applyHitDetailed(hit(12)), b = oneOnOne.applyHitDetailed(hit(12));
    expect(plain.getDamagePercent()).toBeCloseTo(52, 10);
    expect(oneOnOne.getDamagePercent()).toBeCloseTo(40 + 12 * 1.2, 10);
    expect(b.knockback.magnitude).toBeCloseTo(a.knockback.magnitude, 10);
    expect(b.knockback.hitstunFrames).toBe(a.knockback.hitstunFrames);
    // Pummels, throw pre-hits and hazards (addDamage) are scaled; healing is not.
    oneOnOne.addDamage(5); expect(oneOnOne.getDamagePercent()).toBeCloseTo(54.4 + 6, 10);
    oneOnOne.addDamage(-10); expect(oneOnOne.getDamagePercent()).toBeCloseTo(50.4, 10);
  });
});

describe.each(FIGHTERS)('M20–M22 shield on %s', (_id, Fighter) => {
  const breakShield = (percent: number) => {
    const f = standing(Fighter);
    f.fighter.setDamagePercent(percent);
    for (let i = 0; i < 6; i++) f.step({ shield: true });
    expect(f.fighter.getShieldState().name).toBe('active');
    f.fighter.applyHitDetailed(hit(99));
    expect(f.fighter.getShieldState().name).toBe('broken');
    // The shield hit's hitlag freezes the fighter first.
    while (f.fighter.getHitlagRemaining() > 0) f.step();
    return f;
  };
  it('a block costs 1.19× damage in shield HP', () => {
    const f = standing(Fighter);
    for (let i = 0; i < 6; i++) f.step({ shield: true });
    const before = f.fighter.getShieldState().health;
    f.fighter.applyHitDetailed(hit(10));
    expect(f.fighter.getShieldState().health).toBeCloseTo(before - 11.9, 10);
  });
  /** Steps through the shield jump and the knockdown (furafura_start) until the stun loop starts.
   * SmashWiki Shield: the fighter is popped up, knocked down on landing, "then being stunned for some
   * seconds after standing up"; SmashWiki Stun: shield-break stun is 400 − p from Brawl onward. */
  const untilStunned = (f: ReturnType<typeof breakShield>) => {
    for (let i = 0; i < 200 && f.fighter.getShieldState().stunRemaining === 0; i++) f.step();
    expect(f.fighter.getSourceShieldBreakReceivingState()?.phase).toBe('loop');
    return f;
  };
  it('break stun is 400 − percent after the knockdown, and alternating stick mashing removes 3 frames per input', () => {
    const early = breakShield(30);
    expect(early.fighter.getSourceShieldBreakReceivingState()).toMatchObject({ phase: 'pop', stunFrames: 370, loopRemaining: 370 });
    expect(untilStunned(early).fighter.getShieldState().stunRemaining).toBe(370);
    expect(untilStunned(breakShield(250)).fighter.getShieldState().stunRemaining).toBe(150);
    const idle = untilStunned(breakShield(30)), mashed = untilStunned(breakShield(30));
    idle.step(); mashed.step();
    for (let i = 0; i < 10; i++) { idle.step(); mashed.step({ moveX: i % 2 === 0 ? 1 : -1 }); }
    expect(idle.fighter.getShieldState().stunRemaining).toBe(370 - 11);
    expect(mashed.fighter.getShieldState().stunRemaining).toBe(370 - 11 - 30);
  });
  it('the shield comes back with 37.5 HP after the stun and the 33-frame wake', () => {
    const f = untilStunned(breakShield(399));
    f.step(); // the 1-frame stun drains; FuraFuraEnd follows (SmashWiki Stun: 33 frames from Smash 4 onward)
    for (let i = 0; i < 33; i++) { expect(f.fighter.getShieldState().name).toBe('broken'); f.step(); }
    expect(f.fighter.getShieldState().name).toBe('idle');
    expect(f.fighter.getShieldState().health).toBeCloseTo(37.5, 10);
  });
});

describe.each(FIGHTERS)('M24 shield grab after shieldstun on %s', (_id, Fighter) => {
  /** Steps from the grab press to the grab starting, pressing on the first shield step out of shieldstun. */
  const delay = (blocked: boolean) => {
    const f = standing(Fighter);
    for (let i = 0; i < 6; i++) f.step({ shield: true });
    if (blocked) f.fighter.applyHitDetailed(hit(10));
    while (f.fighter.getShieldState().blockStunRemaining > 0) f.step({ shield: true });
    expect(f.fighter.getShieldState().name).toBe('active');
    let steps = 0;
    f.step({ shield: true, grab: true });
    while (f.fighter.getGrabState().name === 'idle' && steps < 20) { f.step({ shield: true, grab: true }); steps += 1; }
    expect(f.fighter.getGrabState().name).not.toBe('idle');
    return steps;
  };
  it('starts 4 frames later than an ordinary shield grab (UFD "Shield Grab (Grab, post-Shieldstun)")', () => {
    const fresh = delay(false);
    expect(delay(true) - fresh).toBe(4);
  });
});

describe.each([['donkeykong', DonkeyKong, 21, 26, 28, 34], ['pikachu', Pikachu, 19, 24, 25, 32]] as const)(
  'M25 / M26 spot dodge on %s', (_id, Fighter, cancel, total, staleCancel, staleTotal) => {
    /** Steps from the dodge press until the fighter acts (jab when `attack`). */
    const actsAfter = (f: ReturnType<typeof standing>, attack: boolean) => {
      f.step({ dodge: true });
      expect(f.fighter.getDodgeState().active?.kind).toBe('spot');
      let steps = 0;
      while (steps < 60) {
        f.step(attack ? { attack: steps % 2 === 0 } : {}); steps += 1;
        if (attack ? f.fighter.getActiveAttack() !== null : f.fighter.getDodgeState().name === 'idle') break;
      }
      return steps;
    };
    it(`cancels into a jab at ${cancel} (uncanceled ${total})`, () => {
      expect(actsAfter(standing(Fighter), true)).toBe(cancel);
      expect(actsAfter(standing(Fighter), false)).toBe(total);
    });
    it(`fully stale after five dodges: ${staleTotal} total, cancel ${staleCancel}, intangible 3 frames later`, () => {
      const f = standing(Fighter);
      for (let i = 0; i < 5; i++) actsAfter(f, false);
      expect(f.fighter.getDodgeStaleness().count).toBe(5);
      f.step({ dodge: true });
      const intangible: boolean[] = [f.fighter.isInvincible()];
      while (f.fighter.getDodgeState().name !== 'idle') { f.step(); intangible.push(f.fighter.isInvincible()); }
      expect(intangible.length - 1).toBe(staleTotal);
      expect(intangible.indexOf(true)).toBe(5); // one-based frame 6 (fresh: frame 3)
      const g = standing(Fighter);
      for (let i = 0; i < 5; i++) actsAfter(g, false);
      expect(actsAfter(g, true)).toBe(staleCancel);
    });
    it('a second without dodging forgives one use', () => {
      const f = standing(Fighter);
      for (let i = 0; i < 3; i++) actsAfter(f, false);
      expect(f.fighter.getDodgeStaleness().count).toBe(3);
      for (let i = 0; i < 60; i++) f.step();
      expect(f.fighter.getDodgeStaleness().count).toBe(2);
    });
  });

describe.each(FIGHTERS)('M27 / M31 ledge hang on %s', (_id, Fighter) => {
  function hang(percent: number) {
    const { engine, scene } = world();
    const corner = { platformId: 'floor', side: 'left' as const, x: -300, y: 90 };
    Composite.add(engine.world, Bodies.rectangle(0, 100, 600, 20, { isStatic: true, label: PLATFORM_LABELS.solid,
      plugin: { platformId: 'floor' }, collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID } }));
    const fighter: Character = new Fighter(scene, Fighter === Pikachu ? { spawnX: corner.x - 12, spawnY: 95 }
      : { spawnX: corner.x - 20, spawnY: 130 });
    fighter.setFacing(1); fighter.setLedgeCandidates([corner]); fighter.setInvincibility(0); fighter.setDamagePercent(percent);
    Body.setVelocity(fighter.body, { x: 0, y: 1 });
    const step = () => { fighter.applyInput(NEUTRAL); stepCharacterPhysics({ characters: [fighter],
      bodies: Composite.allBodies(engine.world), gravity: engine.gravity, body: Body, deltaMs: GAME_CONFIG.fixedTimestepMs,
      stepWorld: d => Engine.update(engine, d) }); };
    let airborneSteps = 0;
    while (fighter.getLedgeHangState().name !== 'hanging' && airborneSteps < 40) { step(); airborneSteps += 1; }
    expect(fighter.getLedgeHangState().name).toBe('hanging');
    return { fighter, step, airborneSteps };
  }
  it('a fresh catch is intangible for 19 + 60·(a/300) + 44 − p/120·44 frames', () => {
    for (const percent of [0, 60, 150]) {
      const { fighter, airborneSteps } = hang(percent);
      expect(fighter.getLedgeHangState().hangIframesRemaining).toBe(ultimateLedgeHangIntangibilityFrames(airborneSteps, percent));
    }
  });
  it('drops automatically after 390 hanging frames (6.5 s)', () => {
    const { fighter, step } = hang(0);
    let frames = 0;
    while (fighter.getLedgeHangState().name === 'hanging' && frames < 500) { step(); frames += 1; }
    expect(frames).toBe(390);
  });
});

describe('DK heavy-item carry walk (SmashWiki DK Forward throw: walk speed and acceleration ×1.1)', () => {
  it('walks at 1.1× DK walk speed (6.825 → 7.5075 px/step) with 1.1× ground acceleration', () => {
    const scene = { matter: { add: { rectangle: Bodies.rectangle }, body: Body, world: { on() {}, off() {}, remove() {} } } };
    const dk = new DonkeyKong(scene as any, { spawnX: 300, spawnY: 200 });
    vi.spyOn(dk, 'isGrounded').mockReturnValue(true);
    let frame = 0;
    const tick = (input: Partial<CharacterInput> = {}) => dk.applyInput({ ...NEUTRAL, ...input }, ++frame);
    for (let i = 0; i < 10; i++) tick();
    dk.syncDonkeyKongHeavyItem(true);
    let previous = 0, largestStep = 0;
    for (let i = 0; i < 30; i++) {
      tick({ moveX: 1 });
      largestStep = Math.max(largestStep, dk.getVelocity().x - previous); previous = dk.getVelocity().x;
    }
    expect(dk.getDonkeyKongHeavyCarryState()?.phase).toBe('walk');
    expect(dk.getVelocity().x).toBeCloseTo(6.825 * 1.1, 6);
    expect(largestStep).toBeCloseTo(dk.getTuning().groundAccel * 1.1, 6);
  });
});
