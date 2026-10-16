/**
 * Keyboard smash controls end to end: default P1 bindings (W up + jump,
 * H shield, R dodge, V smash) → DeviceInputDispatcher → InputResolver →
 * buildCharacterInputFromResolver → Donkey Kong stepped in a real Matter
 * world, exactly like the match (applyInput → Engine.update → post-physics
 * constraints). Covers the paths where the dodge resolver and the jump
 * key used to swallow the smash key.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { DonkeyKong, DONKEYKONG_FAIR, DONKEYKONG_NAIR, DONKEYKONG_SMASH, DONKEYKONG_UAIR, DONKEYKONG_USMASH } from './DonkeyKong';
import { COLLISION_CATEGORIES } from '../engine/collisionCategories';
import { PLATFORM_LABELS } from '../stages/stageBodies';
import { DeviceInputDispatcher, type GamepadButtonState, type GamepadSource } from '../input/DeviceInputDispatcher';
import { InputBindingsStore } from '../input/InputBindingsStore';
import { InputResolver, buildCharacterInputFromResolver } from '../input/InputResolver';
import { KEY_CODE } from '../input/keyCodes';

const require = createRequire(import.meta.url);
const Engine = require('../physics/matter/source/lib/core/Engine.js');
const Events = require('../physics/matter/source/lib/core/Events.js');
const Bodies = require('../physics/matter/source/lib/factory/Bodies.js');
const Body = require('../physics/matter/source/lib/body/Body.js');
const Composite = require('../physics/matter/source/lib/body/Composite.js');

const NO_BUTTON: GamepadButtonState = Object.freeze({ pressed: false, value: 0 });
const PRESSED: GamepadButtonState = Object.freeze({ pressed: true, value: 1 });

/** Keyboard P1 (slot 1) by default; slot 3 is the default gamepad on pad 0. */
function keyboardMatch(slot: 1 | 3 = 1) {
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
  Composite.add(engine.world, Bodies.rectangle(0, ch.getTuning().height / 2 + 10, 20000, 20, {
    isStatic: true, label: PLATFORM_LABELS.solid,
    collisionFilter: { category: COLLISION_CATEGORIES.PLATFORM_SOLID },
  }));

  const down = new Set<number>();
  const buttons = new Set<number>();
  const axes = new Map<number, number>();
  const pad: GamepadSource = {
    isConnected: (i: number) => i === 0,
    getButton: (i: number, b: number) => (i === 0 && buttons.has(b) ? PRESSED : NO_BUTTON),
    getAxis: (i: number, a: number) => (i === 0 ? axes.get(a) ?? 0 : 0),
  };
  const dispatcher = new DeviceInputDispatcher({
    keyboard: { isDown: (code: number) => down.has(code) },
    gamepad: pad,
    bindings: new InputBindingsStore(), // shipped defaults
  });
  const resolver = new InputResolver({ dispatcher, slots: [slot] });
  let frame = 0;
  const advance = () => {
    resolver.update(frame);
    frame += 1;
    const input = buildCharacterInputFromResolver(resolver, slot);
    ch.applyInput(input);
    Engine.update(engine, 1000 / 60);
    ch.applyPostPhysicsVelocityConstraints();
    return input;
  };
  /** One fixed step with exactly `keys` held. */
  const step = (...keys: number[]) => {
    down.clear();
    for (const k of keys) down.add(k);
    return advance();
  };
  /** One fixed step with exactly these pad buttons held and axes deflected. */
  const padStep = (held: number[] = [], stick: Record<number, number> = {}) => {
    buttons.clear();
    axes.clear();
    for (const b of held) buttons.add(b);
    for (const [a, v] of Object.entries(stick)) axes.set(Number(a), v);
    return advance();
  };
  for (let i = 0; i < 12; i++) step();
  return { ch, step, padStep };
}

function currentMoveId(ch: DonkeyKong): string | null {
  return ch.getAnimationActionState().chargingMove?.id ?? ch.getActiveAttack()?.move.id ?? null;
}

const { W, D, V, H, R } = KEY_CODE;

describe('keyboard up smash — W (up + jump) held into jumpsquat, then V', () => {
  it.each([1, 3, 5, 6, 7])('W held %i frames then V is a grounded up smash', (wFrames) => {
    const { ch, step } = keyboardMatch();
    for (let i = 0; i < wFrames; i++) step(W);
    step(W, V);
    expect(currentMoveId(ch)).toBe(DONKEYKONG_USMASH.id);
    for (let i = 0; i < 10; i++) step(W, V); // charge
    step(W);
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_USMASH.id);
    for (let i = 0; i < 20; i++) {
      step(W);
      expect(ch.isGrounded()).toBe(true);
    }
  });

  /** Steps with `keys` held until the first move comes out; that move and whether DK left the ground. */
  function firstMove(ch: DonkeyKong, step: (...keys: number[]) => unknown, ...keys: number[]) {
    let fired: string | null = null;
    let airborne = false;
    for (let i = 0; i < 10 && fired === null; i++) {
      step(...keys);
      fired = ch.getActiveAttack()?.move.id ?? null;
      airborne ||= !ch.isGrounded();
    }
    return { fired, airborne };
  }

  it('W let go in jumpsquat, then V: short hop into the neutral air (W in the leniency window is not a cancel)', () => {
    const { ch, step } = keyboardMatch();
    for (let i = 0; i < 5; i++) step(W);
    expect(ch.getJumpsquatRemaining()).toBe(3);
    step(V);
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    expect(firstMove(ch, step)).toEqual({ fired: DONKEYKONG_NAIR.id, airborne: true });
  });

  it('W let go in jumpsquat, then D + V: short hop into the forward air', () => {
    const { ch, step } = keyboardMatch();
    for (let i = 0; i < 5; i++) step(W);
    step(D, V);
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    expect(firstMove(ch, step, D)).toEqual({ fired: DONKEYKONG_FAIR.id, airborne: true });
  });

  it('W + D held into jumpsquat, then V: diagonal is not up — short hop into the aerial, no up smash', () => {
    const { ch, step } = keyboardMatch();
    for (let i = 0; i < 5; i++) step(W, D);
    expect(ch.getJumpsquatRemaining()).toBe(3);
    step(W, D, V);
    expect(ch.getJumpsquatRemaining()).toBeGreaterThan(0);
    // Buffered W + D press: the aerial classifier gives the tie to vertical.
    expect(firstMove(ch, step, W, D)).toEqual({ fired: DONKEYKONG_UAIR.id, airborne: true });
  });

  it('V once DK has left the ground is the up air', () => {
    const { ch, step } = keyboardMatch();
    for (let i = 0; i < 20 && ch.isGrounded(); i++) step(W);
    expect(ch.isGrounded()).toBe(false);
    step(W, V);
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_UAIR.id);
  });
});

describe('gamepad up smash — jump button then right stick up', () => {
  // Default pad: button 0 jumps, the right stick (axes 2 / 3) smashes.
  it.each([0, 1, 2, 3])('right stick up %i frame(s) after the jump button is a grounded up smash', (lag) => {
    const { ch, padStep } = keyboardMatch(3);
    for (let i = 0; i < lag; i++) padStep([0]);
    const input = padStep([0], { 3: -1 });
    expect(input.attackHeavy).toBe(true);
    expect(input.attackStickY).toBe(-1);
    padStep([0]);
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_USMASH.id);
    for (let i = 0; i < 20; i++) {
      padStep([0]);
      expect(ch.isGrounded()).toBe(true);
    }
  });
});

describe('dodge resolver vs. the smash key', () => {
  it('shield held, then W + V on one frame: the out-of-shield up smash, no dodge', () => {
    const { ch, step } = keyboardMatch();
    for (let i = 0; i < 8; i++) step(H);
    expect(ch.isShielding()).toBe(true);
    const input = step(H, W, V);
    expect(input.dodge).toBe(false);
    expect(currentMoveId(ch)).toBe(DONKEYKONG_USMASH.id);
    for (let i = 0; i < 4; i++) step(H, W, V);
    step(H, W);
    expect(ch.getActiveAttack()?.move.id).toBe(DONKEYKONG_USMASH.id);
    expect(ch.getDodgeState().name).toBe('idle');
    for (let i = 0; i < 10; i++) {
      step(H, W);
      expect(ch.getDodgeState().name).toBe('idle');
      expect(ch.isGrounded()).toBe(true);
    }
  });

  it('shield + W without V is still the up dodge (unchanged)', () => {
    const { ch, step } = keyboardMatch();
    for (let i = 0; i < 8; i++) step(H);
    const input = step(H, W);
    expect(input.dodge).toBe(true);
    expect(ch.getDodgeState().name).toBe('active');
  });

  it('dodge key + V on one frame is the smash, not a spot dodge', () => {
    const { ch, step } = keyboardMatch();
    const input = step(R, V);
    expect(input.dodge).toBe(false);
    expect(ch.getDodgeState().name).toBe('idle');
    expect(currentMoveId(ch)).toBe(DONKEYKONG_SMASH.id);
  });
});
