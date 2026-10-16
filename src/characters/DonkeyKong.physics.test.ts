/**
 * Donkey Kong — real-Matter behaviour checks for the sourced kit.
 *
 * Steps a headless Matter world exactly like the match does (applyInput →
 * stepCharacterPhysics (prepare → Engine.update → constraints)) and measures
 * sourced hop heights with the explicitly authored initial full-hop curve, the
 * dash/run speeds, the Hand Slap loop and its aerial variant, Giant Punch
 * banking and full-charge armour, and Headbutt armour.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  DonkeyKong, DONKEYKONG_BAIR, DONKEYKONG_DAIR, DONKEYKONG_DOWN_SPECIAL, DONKEYKONG_DSMASH,
  DONKEYKONG_FAIR, DONKEYKONG_NAIR, DONKEYKONG_NEUTRAL_SPECIAL, DONKEYKONG_SIDE_SPECIAL, DONKEYKONG_SMASH, DONKEYKONG_UAIR,
  DONKEYKONG_USMASH,
} from './DonkeyKong';
import type { CharacterInput } from './Character';
import { stepCharacterPhysics } from './stepCharacterPhysics';
import type { HitInfo } from './combat';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');
const NEUTRAL: CharacterInput = { moveX: 0, moveY: 0, jump: false };
const HIT: HitInfo = { damage: 7, knockback: { x: 3, y: -1.5, scaling: 0.2 }, facing: 1 };

function world() {
  const engine = Engine.create();
  const names: Record<string, string> = {
    collisionstart: 'collisionStart', collisionactive: 'collisionActive', collisionend: 'collisionEnd',
  };
  const scene: any = { matter: { body: Body, add: {
    rectangle(x: number, y: number, width: number, height: number, settings: object) {
      const body = Bodies.rectangle(x, y, width, height, settings);
      Composite.add(engine.world, body);
      return body;
    },
  }, world: {
    on(event: string, fn: (...args: any[]) => void) { Events.on(engine, names[event] ?? event, fn); },
    off(event: string, fn: (...args: any[]) => void) { Events.off(engine, names[event] ?? event, fn); },
    remove(body: any) { Composite.remove(engine.world, body); },
  } } };
  const ch = new DonkeyKong(scene, { spawnX: 0, spawnY: 0 });
  const floor = Bodies.rectangle(0, ch.getTuning().height / 2 + 10, 20000, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  });
  Composite.add(engine.world, floor);
  const step = (input: CharacterInput = NEUTRAL) => {
    ch.applyInput(input);
    stepCharacterPhysics({ characters: [ch], bodies: Composite.allBodies(engine.world),
      gravity: engine.gravity, body: Body, deltaMs: 1000 / 60,
      stepWorld: delta => Engine.update(engine, delta) });
  };
  for (let frame = 0; frame < 12; frame++) step();
  return { ch, step };
}

/** Jump, then measure the peak rise and the airborne step count until landing. */
function measureHop(hold: boolean): { peak: number; airtime: number; firstFourRise: number | null } {
  const { ch, step } = world();
  const groundY = ch.getPosition().y;
  let peak = 0, airtime = 0, wasAirborne = false, firstFourRise: number | null = null;
  for (let frame = 0; frame < 200; frame++) {
    step({ ...NEUTRAL, jump: hold ? true : frame === 0 });
    const airborne = !ch.isGrounded();
    if (airborne) {
      airtime += 1; wasAirborne = true;
      const rise = groundY - ch.getPosition().y;
      peak = Math.max(peak, rise);
      if (airtime === 4) firstFourRise = rise;
    }
    else if (wasAirborne) break;
  }
  return { peak, airtime, firstFourRise };
}

describe('Donkey Kong — sourced jump heights through the actual common Matter step', () => {
  it('the authored opening fits source first-four rise18.7 and full-hop height34 units', () => {
    const { peak, firstFourRise } = measureHop(true);
    expect(firstFourRise).not.toBeNull();
    expect(firstFourRise!).toBeCloseTo(18.7 * 5, 0);
    expect(Math.abs(peak - 34 * 5)).toBeLessThan(.5);
    // The native initial acceleration remains unrecovered. This proves the
    // selected curve's source-height constraints, not native53-frame airtime.
  });

  it('short hop rises 17.3 units (86.5 px)', () => {
    const { peak } = measureHop(false);
    expect(Math.abs(peak - 17.3 * 5)).toBeLessThan(.5);
  });
});

describe('Donkey Kong — UFD ground movement', () => {
  it('starts a 10.45 px initial dash and settles to the 9.365 px run', () => {
    const { ch, step } = world();
    for (let frame = 0; frame < 15; frame++) {
      step({ ...NEUTRAL, moveX: 1 });
      expect(ch.getLocomotionStateName()).toBe('initialDash');
      expect(ch.getVelocity().x).toBeCloseTo(10.45, 1);
    }
    for (let frame = 0; frame < 16; frame++) step({ ...NEUTRAL, moveX: 1 });
    expect(ch.getLocomotionStateName()).toBe('run');
    expect(ch.getVelocity().x).toBeCloseTo(9.365, 1);
  });
});

describe('Donkey Kong — Hand Slap (shockwave down special)', () => {
  it('slaps on frames 12–13 and 23–24, then a mashed press repeats the loop 26 frames later', () => {
    const { ch, step } = world();
    step({ ...NEUTRAL, special: true, moveY: 1 });
    const active = ch.getActiveAttack();
    expect(active?.move.id).toBe(DONKEYKONG_DOWN_SPECIAL.id);
    expect(active?.move.startupFrames).toBe(11);
    const live: Array<[step: number, elapsed: number]> = [];
    const ages: number[] = [];
    for (let i = 0; i < 70; i++) {
      // Mash inside the input window [13, 26): one press at elapsed 15.
      const elapsed = ch.getActiveAttack()?.framesElapsed ?? -1;
      step(elapsed === 15 ? { ...NEUTRAL, special: true, moveY: 1 } : { ...NEUTRAL, moveY: 1 });
      const a = ch.getActiveAttack();
      if (a) ages.push(a.framesElapsed);
      if (a && a.hitboxBody !== null) live.push([i, a.framesElapsed]);
    }
    // First loop: elapsed 11–12 and 22–23; the repeat rewinds the loop end (33) to the
    // loop start (7), so the same windows fire again 26 steps later.
    expect(live.slice(0, 4).map(([, e]) => e)).toEqual([11, 12, 22, 23]);
    expect(live.length).toBeGreaterThanOrEqual(8);
    expect(live.slice(4, 8).map(([, e]) => e)).toEqual([11, 12, 22, 23]);
    expect(live.slice(4, 8).map(([t], k) => t - live[k]![0])).toEqual([26, 26, 26, 26]);
    // SpecialLwStart (elapsed 0–6) is never replayed: after the first loop starts, ages stay >= 7.
    const repeatAt = ages.findIndex((age, k) => k > 0 && age < ages[k - 1]!);
    expect(ages[repeatAt]).toBe(7);
    expect(ages.slice(ages.indexOf(7)).every(age => age >= 7)).toBe(true);
  });

  it('the mash input window spans the startup and loop [0, 33) (SmashWiki Down special)', () => {
    // `elapsed` is the attack age on the press step itself (the step advances the age before
    // it reads the press), the same clock as the repeat rule's window and loop point.
    const repeatsAfterPressAt = (elapsed: number): boolean => {
      const { ch, step } = world();
      step({ ...NEUTRAL, special: true, moveY: 1 });
      let rewound = false;
      let previous = ch.getActiveAttack()!.framesElapsed;
      for (let i = 0; i < 40; i++) {
        const pressStep = (ch.getActiveAttack()?.framesElapsed ?? -2) + 1 === elapsed;
        step(pressStep ? { ...NEUTRAL, special: true, moveY: 1 } : { ...NEUTRAL, moveY: 1 });
        const a = ch.getActiveAttack();
        if (a && a.framesElapsed < previous) rewound = true;
        previous = a?.framesElapsed ?? previous;
      }
      return rewound;
    };
    // Elapsed 1 follows the starting press step, so the earliest fresh press is at 2.
    expect([2, 6, 12, 13, 25, 26, 32].map(repeatsAfterPressAt)).toEqual([true, true, true, true, true, true, true]);
  });

  it('without a mash press the move ends after its 46 frames', () => {
    const { ch, step } = world();
    step({ ...NEUTRAL, special: true, moveY: 1 });
    for (let i = 0; i < 44; i++) step({ ...NEUTRAL, moveY: 1 });
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_DOWN_SPECIAL.id);
    for (let i = 0; i < 4; i++) step({ ...NEUTRAL, moveY: 1 });
    expect(ch.getActiveAttack()).toBeNull();
  });

  it('an airborne press starts the two-clap aerial variant with 10 frames of landing lag data', () => {
    const { ch, step } = world();
    for (let i = 0; i < 6; i++) step({ ...NEUTRAL, jump: true });
    expect(ch.isGrounded()).toBe(false);
    step({ ...NEUTRAL, jump: true, special: true, moveY: 1 });
    const a = ch.getActiveAttack();
    expect(a?.move.id).toBe(DONKEYKONG_DOWN_SPECIAL.id);
    expect(a?.move.startupFrames).toBe(18);
    expect(a?.move.specialLandingLagFrames).toBe(10);
  });
});

describe('Donkey Kong — Giant Punch (bankable charge with full-charge armour)', () => {
  it('a shield press banks the charge; the next press fires it with armour on frames 9–20', () => {
    const { ch, step } = world();
    step({ ...NEUTRAL, special: true });
    for (let i = 0; i < 120; i++) step({ ...NEUTRAL, special: true });
    step({ ...NEUTRAL, shield: true }); // bank
    // Let the shield release lag pass before the next press.
    for (let i = 0; i < 20; i++) step();
    expect(ch.getActiveAttack()).toBeNull();
    step({ ...NEUTRAL, special: true }); // fire the banked full charge
    const a = ch.getActiveAttack();
    expect(a?.move.id).toBe(DONKEYKONG_NEUTRAL_SPECIAL.id);
    expect(a?.chargeHeldFrames).toBeGreaterThanOrEqual(110);
    for (let i = 0; i < 9; i++) step();
    expect(ch.getActiveAttack()?.framesElapsed).toBe(9);
    expect(ch.applyHitDetailed(HIT).outcome).toBe('armored');
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_NEUTRAL_SPECIAL.id);
  });

  it('a fresh second press fires a partial charge without armour', () => {
    const { ch, step } = world();
    step({ ...NEUTRAL, special: true });
    for (let i = 0; i < 7; i++) step(); // releasing the first press keeps winding
    expect(ch.getActiveAttack()).toBeNull();
    step({ ...NEUTRAL, special: true });
    const a = ch.getActiveAttack();
    expect(a?.move.id).toBe(DONKEYKONG_NEUTRAL_SPECIAL.id);
    expect(a?.chargeHeldFrames).toBeLessThan(110);
    for (let i = 0; i < 9; i++) step();
    expect(ch.applyHitDetailed(HIT).outcome).toBe('landed');
  });
});

describe('Donkey Kong — Headbutt armour', () => {
  it('absorbs hits on frames 5–14 and is exposed from frame 15', () => {
    const armoured = world();
    armoured.step({ ...NEUTRAL, special: true, moveX: 1 });
    expect(armoured.ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_SIDE_SPECIAL.id);
    for (let i = 0; i < 6; i++) armoured.step();
    expect(armoured.ch.getActiveAttack()?.framesElapsed).toBe(6);
    const result = armoured.ch.applyHitDetailed(HIT);
    expect(result.outcome).toBe('armored');
    expect(result.damageApplied).toBe(7);

    const exposed = world();
    exposed.step({ ...NEUTRAL, special: true, moveX: 1 });
    for (let i = 0; i < 14; i++) exposed.step();
    expect(exposed.ch.getActiveAttack()?.framesElapsed).toBe(14);
    expect(exposed.ch.applyHitDetailed(HIT).outcome).toBe('landed');
  });
});

describe('Donkey Kong — right-stick (C-stick) smash input through real Matter steps', () => {
  it('a backward flick turns DK around and fires the uncharged forward smash behind him', () => {
    const { ch, step } = world();
    const startX = ch.getPosition().x;
    expect(ch.getFacing()).toBe(1);
    step({ ...NEUTRAL, attackHeavy: true, attackStickX: -1 });
    step(); // the stick smash is a one-frame press, so the charge releases at once
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_SMASH.id);
    expect(ch.getFacing()).toBe(-1);
    let hitboxX: number | null = null;
    for (let frame = 0; frame < 40 && hitboxX === null; frame++) {
      step();
      hitboxX = ch.getActiveAttack()?.hitboxBody?.position.x ?? null;
    }
    expect(hitboxX).not.toBeNull();
    expect(hitboxX!).toBeLessThan(ch.getPosition().x);
    // The flick is an attack direction only: no dash toward it.
    expect(Math.abs(ch.getPosition().x - startX)).toBeLessThan(1);
  });

  it('up / down flicks pick the up and down smash even while crouching', () => {
    for (const [stickY, id] of [[-1, DONKEYKONG_USMASH.id], [1, DONKEYKONG_DSMASH.id]] as const) {
      const { ch, step } = world();
      for (let frame = 0; frame < 4; frame++) step({ ...NEUTRAL, moveY: 1 });
      step({ ...NEUTRAL, moveY: 1, attackHeavy: true, attackStickY: stickY });
      step({ ...NEUTRAL, moveY: 1 });
      expect(ch.getActiveAttack()?.move.id).toBe(id);
    }
  });

  it('in the air a flick fires the aerial for its direction without fast-falling', () => {
    const cases = [[0, -1, DONKEYKONG_UAIR.id], [0, 1, DONKEYKONG_DAIR.id], [-1, 0, DONKEYKONG_BAIR.id]] as const;
    for (const [stickX, stickY, id] of cases) {
      const { ch, step } = world();
      for (let frame = 0; frame < 6; frame++) step({ ...NEUTRAL, jump: true });
      for (let frame = 0; frame < 60 && ch.getVelocity().y <= 0.5; frame++) step({ ...NEUTRAL, jump: true });
      expect(ch.isGrounded()).toBe(false);
      step({ ...NEUTRAL, jump: true, attackHeavy: true, attackStickX: stickX, attackStickY: stickY });
      expect(ch.getActiveAttack()?.move.id).toBe(id);
      expect(ch.getFacing()).toBe(1);
      step({ ...NEUTRAL, jump: true });
      expect(ch.getVelocity().y).toBeLessThan(ch.getTuning().fastFallSpeed);
      expect(ch.getVelocity().x).toBeCloseTo(0, 6);
    }
  });
});

/** The smash being charged, else the active move (a smash key held charges first). */
function currentMoveId(ch: DonkeyKong): string | null {
  return ch.getAnimationActionState().chargingMove?.id ?? ch.getActiveAttack()?.move.id ?? null;
}

describe('Donkey Kong — jump-cancelled up smash (heavy press during jumpsquat)', () => {
  // Keyboard P1: W is both `up` (moveY -1) and `jump`; V is the smash key.
  const W: CharacterInput = { moveX: 0, moveY: -1, jump: true };

  it.each([5, 6, 7])('W held %i frames (in jumpsquat) then V fires the up smash on the ground', (wFrames) => {
    const { ch, step } = world();
    const groundY = ch.getPosition().y;
    for (let frame = 0; frame < wFrames; frame++) step(W);
    // Past the 4-frame tap-jump buffer: the jump is already in jumpsquat.
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    expect(ch.isGrounded()).toBe(true);
    step({ ...W, attackHeavy: true });
    expect(ch.getJumpsquatRemaining()).toBe(0);
    expect(currentMoveId(ch)).toBe(DONKEYKONG_USMASH.id);
    // Hold V a few frames (charge), release, and the clap comes out grounded.
    for (let frame = 0; frame < 8; frame++) step({ ...W, attackHeavy: true });
    step(W);
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_USMASH.id);
    for (let frame = 0; frame < 20; frame++) {
      step(W);
      expect(ch.isGrounded()).toBe(true);
    }
    expect(Math.abs(ch.getPosition().y - groundY)).toBeLessThan(1);
  });

  it.each([1, 2, 3])('a right-stick up flick on jumpsquat frame %i cancels the jump into the up smash', (squatFrame) => {
    const { ch, step } = world();
    const jump: CharacterInput = { moveX: 0, moveY: 0, jump: true }; // pad jump button, left stick neutral
    step(jump);
    expect(ch.getJumpsquatRemaining()).toBe(3);
    for (let frame = 1; frame < squatFrame; frame++) step(jump);
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    step({ ...jump, attackHeavy: true, attackStickY: -1 });
    step(jump); // a stick smash is a one-frame press: the charge releases at once
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_USMASH.id);
    for (let frame = 0; frame < 20; frame++) {
      step(jump);
      expect(ch.isGrounded()).toBe(true);
    }
  });

  it('jump button and a right-stick up flick on the SAME frame also cancel into the up smash', () => {
    const { ch, step } = world();
    const jump: CharacterInput = { moveX: 0, moveY: 0, jump: true };
    step({ ...jump, attackHeavy: true, attackStickY: -1 });
    expect(ch.getJumpsquatRemaining()).toBe(0);
    step(jump);
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_USMASH.id);
    for (let frame = 0; frame < 20; frame++) {
      step(jump);
      expect(ch.isGrounded()).toBe(true);
    }
  });

  /** Steps until the first move comes out; returns it and whether DK left the ground. */
  function firstMoveAfter(step: (input?: CharacterInput) => void, ch: DonkeyKong, hold: CharacterInput) {
    let fired: string | null = null;
    let airborne = false;
    for (let frame = 0; frame < 10 && fired === null; frame++) {
      step(hold);
      fired = ch.getActiveAttack()?.move.id ?? null;
      airborne ||= !ch.isGrounded();
    }
    return { fired, airborne };
  }

  it('a smash key aims with this step only: up a frame early does not cancel (short hop, neutral air)', () => {
    const { ch, step } = world();
    const jump: CharacterInput = { moveX: 0, moveY: 0, jump: true };
    step(jump);
    step({ ...jump, moveY: -1 }); // left stick flicked up, back to neutral next frame
    step({ ...jump, attackHeavy: true });
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    expect(firstMoveAfter(step, ch, jump)).toEqual({ fired: DONKEYKONG_NAIR.id, airborne: true });
  });

  it('W let go in jumpsquat, then a neutral V: short hop into the neutral air, not the up smash', () => {
    const { ch, step } = world();
    for (let frame = 0; frame < 5; frame++) step(W); // tap-jump buffer, then jumpsquat
    expect(ch.getJumpsquatRemaining()).toBe(3);
    step({ ...NEUTRAL, attackHeavy: true }); // W is still in the 4-frame leniency window
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    expect(firstMoveAfter(step, ch, NEUTRAL)).toEqual({ fired: DONKEYKONG_NAIR.id, airborne: true });
  });

  it('W let go in jumpsquat, then D + V: short hop into the forward air, not the up smash', () => {
    const { ch, step } = world();
    const D: CharacterInput = { moveX: 1, moveY: 0, jump: false };
    for (let frame = 0; frame < 5; frame++) step(W);
    step({ ...D, attackHeavy: true });
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    expect(firstMoveAfter(step, ch, D)).toEqual({ fired: DONKEYKONG_FAIR.id, airborne: true });
  });

  it('W + D held (diagonal, |y| == |x|) then V in jumpsquat is not up: short hop into the aerial', () => {
    // The cancel needs strict vertical dominance, so the keyboard diagonal
    // keeps the pre-existing jumpsquat behaviour for a non-up press: short
    // hop, press buffered for the aerial. The aerial classifier gives a tie
    // to vertical, so the buffered W + D press comes out as the up air.
    const { ch, step } = world();
    const WD: CharacterInput = { moveX: 1, moveY: -1, jump: true };
    for (let frame = 0; frame < 5; frame++) step(WD);
    expect(ch.getJumpsquatRemaining()).toBe(3);
    step({ ...WD, attackHeavy: true });
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    const { fired, airborne } = firstMoveAfter(step, ch, WD);
    expect(airborne).toBe(true);
    expect(fired).not.toBe(DONKEYKONG_USMASH.id);
    expect(fired).toBe(DONKEYKONG_UAIR.id);
  });

  it('V after takeoff is still the up air', () => {
    const { ch, step } = world();
    for (let frame = 0; frame < 20 && ch.isGrounded(); frame++) step(W);
    expect(ch.isGrounded()).toBe(false);
    expect(ch.getJumpsquatRemaining()).toBe(0);
    step({ ...W, attackHeavy: true });
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_UAIR.id);
  });

  it('a non-up heavy press during jumpsquat keeps the jump and fires the aerial', () => {
    const { ch, step } = world();
    const jump: CharacterInput = { moveX: 0, moveY: 0, jump: true };
    step(jump);
    step({ ...jump, attackHeavy: true, attackStickX: 1 });
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    let fired: string | null = null;
    for (let frame = 0; frame < 6 && fired === null; frame++) {
      step(jump);
      fired = ch.getActiveAttack()?.move.id ?? null;
    }
    expect(fired).toBe(DONKEYKONG_FAIR.id);
    expect(ch.isGrounded()).toBe(false);
  });

  it('an attack press with up during jumpsquat is unchanged: short hop into the up air', () => {
    const { ch, step } = world();
    for (let frame = 0; frame < 5; frame++) step(W);
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    step({ ...W, attack: true });
    let fired: string | null = null;
    for (let frame = 0; frame < 6 && fired === null; frame++) {
      step(W);
      fired = ch.getActiveAttack()?.move.id ?? null;
    }
    expect(fired).toBe(DONKEYKONG_UAIR.id);
    expect(ch.isGrounded()).toBe(false);
  });
});
