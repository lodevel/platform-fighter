/**
 * AC 40304 Sub-AC 4 — end-to-end integration of remapped inputs across a
 * mixed keyboard / gamepad multi-player configuration.
 *
 * Where this fits in the M5 rebinding stack
 * -----------------------------------------
 *
 * Earlier sub-ACs landed (and unit-tested) the *individual* layers:
 *
 *   • {@link BindingsPersistenceLifecycle} — the rebinding-screen write
 *     surface, with auto-save on every mutation.
 *   • {@link DeviceInputDispatcher} — stateless polling that resolves a
 *     {@link PlayerBindings} table against live keyboard / gamepad
 *     state.
 *   • {@link InputService.sampleCharacterInput} — the per-frame
 *     `CharacterInput` record gameplay reads.
 *   • {@link RuntimeBindingsDispatch.test} — verifies the lifecycle/store
 *     identity and per-slot rebind visibility, but only one slot at a
 *     time and only against the input service (not real characters).
 *
 * What was *missing* — and what this suite supplies — is the explicit
 * end-to-end integration contract for the 4-player mixed-input case:
 *
 *   1. **Mixed multi-player config.** P1 and P2 are keyboard slots
 *      (with custom rebinds applied via the lifecycle), P3 and P4 are
 *      gamepad slots (with custom rebinds applied via the lifecycle).
 *      The whole roster is sampled in a single deterministic step and
 *      every fighter's resulting physics state matches its slot's
 *      remapped input — no cross-talk, no slot bleed.
 *   2. **Real {@link Character} side-effects.** Earlier suites stop at
 *      `service.sampleCharacterInput(slot)` — they verify the
 *      {@link CharacterInput} record's fields. This suite goes one step
 *      further: it threads the resulting input into a real
 *      {@link Character} instance and asserts the *physics* output —
 *      jump impulse changes Y velocity, walk input ramps X velocity,
 *      attack press flips `isAttacking()` — proving the rebind drives
 *      gameplay, not merely a sample record.
 *   3. **Simultaneous press across devices.** A single fixed-step poll
 *      with all four players holding their respective remapped inputs
 *      produces correct physics for all four at once. This catches a
 *      future regression that, say, caches the keyboard `pressed` map
 *      across slots, or that resamples gamepad state between slots and
 *      sees a stale axis.
 *   4. **Persistence integration.** A custom mapping committed on
 *      session A through the lifecycle is observed by a fresh
 *      dispatcher / service / character composition built off the
 *      same persisted bytes — proving the durable persistence chain
 *      from M5 AC 40303 lines up with the runtime dispatch chain from
 *      M5 AC 40302 inside one end-to-end run.
 *
 * Why a *separate* "integration" suite (vs. extending RuntimeBindingsDispatch)
 * --------------------------------------------------------------------------
 *
 * The runtime dispatch test focuses on the wiring chain
 *
 *     RebindingScreen → Lifecycle → InputBindingsStore → DeviceInputDispatcher → InputService
 *
 * stopping at the {@link CharacterInput} record. It deliberately does
 * NOT instantiate a {@link Character} — keeping the dispatch-layer
 * contract pure. This file extends the chain with the gameplay surface:
 *
 *     ... → InputService.sampleCharacterInput → Character.applyInput → physics state
 *
 * and the multi-slot mixed-device fixture. A regression that breaks a
 * pure dispatch contract still surfaces in `RuntimeBindingsDispatch`; a
 * regression that only manifests when a real character is in the loop
 * (e.g. an animation-state transition that masks a fresh `attack` press
 * at the boundary between input layers) shows up here.
 *
 * Determinism
 * -----------
 *
 *   • Every helper is a pure function of its inputs. The mock keyboard /
 *     gamepad sources are `Set` / `Map`-backed, no wall-clock or RNG.
 *   • Character physics integration uses the documented `applyInput` →
 *     `getVelocity()` / `isAttacking()` contract; we never sleep or
 *     await, so the suite runs in pure synchronous tick order.
 *   • Storage is the same `InMemoryStorage` shape used elsewhere in the
 *     input suite, so persistence round-trips match the byte-stable
 *     contract from {@link BindingsPersistenceIntegration.test}.
 */

import { describe, expect, it } from 'vitest';
import {
  BindingsPersistenceLifecycle,
  createBootedLifecycle,
} from './BindingsPersistenceLifecycle';
import {
  DeviceInputDispatcher,
  type GamepadButtonState,
  type GamepadSource,
} from './DeviceInputDispatcher';
import { InputService } from './InputService';
import type { KeyboardSource } from './LocalInputHandler';
import { KEY_CODE } from './keyCodes';
import type { StorageLike } from './BindingsStorage';
import { Character, type CharacterInput } from '../characters/Character';
// Sub-AC 3 of the T2 refactor — installs the legacy
// `Character.prototype.registerAttack` shim. See
// `../characters/attackRegistration.ts` for the extraction story.
import '../characters/attackRegistration';
import type { AttackMove } from '../characters/attacks';
import type { PlayerBindingsIndex } from '../types/inputBindings';
import type { CharacterId } from '../types';
import { PLATFORM_LABELS } from '../stages/StageRenderer';

/**
 * Slot → character id assignment used to instantiate the four fighters.
 * Mirrors the M2 roster ordering so a regression that depends on a
 * specific character id (e.g. animation key prefix) surfaces against
 * the same ids the real match scene wires up.
 */
const SLOT_CHARACTER_ID: Readonly<Record<PlayerBindingsIndex, CharacterId>> = {
  1: 'wolf',
  2: 'cat',
  3: 'owl',
  4: 'bear',
};

// ---------------------------------------------------------------------------
// Mock input sources
// ---------------------------------------------------------------------------

interface MockKeyboard extends KeyboardSource {
  press(...codes: number[]): void;
  release(...codes: number[]): void;
  releaseAll(): void;
}

function createMockKeyboard(): MockKeyboard {
  const held = new Set<number>();
  return {
    isDown(code: number): boolean {
      return held.has(code);
    },
    press(...codes: number[]): void {
      for (const c of codes) held.add(c);
    },
    release(...codes: number[]): void {
      for (const c of codes) held.delete(c);
    },
    releaseAll(): void {
      held.clear();
    },
  };
}

interface MockGamepad extends GamepadSource {
  connect(index: number): void;
  disconnect(index: number): void;
  setButton(index: number, button: number, state: GamepadButtonState): void;
  setAxis(index: number, axis: number, value: number): void;
  releaseAll(): void;
}

function createMockGamepad(): MockGamepad {
  const connected = new Set<number>();
  const buttons = new Map<string, GamepadButtonState>();
  const axes = new Map<string, number>();
  const NEUTRAL: GamepadButtonState = Object.freeze({ pressed: false, value: 0 });
  return {
    isConnected(index: number): boolean {
      return connected.has(index);
    },
    getButton(index: number, button: number): GamepadButtonState {
      if (!connected.has(index)) return NEUTRAL;
      return buttons.get(`${index}:${button}`) ?? NEUTRAL;
    },
    getAxis(index: number, axis: number): number {
      if (!connected.has(index)) return 0;
      return axes.get(`${index}:${axis}`) ?? 0;
    },
    connect(index: number): void {
      connected.add(index);
    },
    disconnect(index: number): void {
      connected.delete(index);
    },
    setButton(index: number, button: number, state: GamepadButtonState): void {
      buttons.set(`${index}:${button}`, state);
    },
    setAxis(index: number, axis: number, value: number): void {
      axes.set(`${index}:${axis}`, value);
    },
    releaseAll(): void {
      buttons.clear();
      axes.clear();
    },
  };
}

class InMemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  /** Test-only — capture raw bytes for "tab close → reopen" replay. */
  snapshotBytes(): Map<string, string> {
    return new Map(this.data);
  }
  static fromBytes(bytes: ReadonlyMap<string, string>): InMemoryStorage {
    const fresh = new InMemoryStorage();
    for (const [k, v] of bytes.entries()) fresh.setItem(k, String(v));
    return fresh;
  }
}

// ---------------------------------------------------------------------------
// Mock Phaser scene used to construct real Character instances
// ---------------------------------------------------------------------------

interface MockBody {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  label: string | undefined;
  options: Record<string, unknown>;
  removed: boolean;
}

interface CollisionListener {
  event: 'collisionstart' | 'collisionend';
  fn: (e: { pairs: unknown[] }) => void;
}

interface MockScene {
  scene: any;
  emit(event: 'collisionstart' | 'collisionend', pairs: unknown[]): void;
}

function createMockScene(): MockScene {
  const listeners: CollisionListener[] = [];
  const matter = {
    add: {
      rectangle(
        x: number,
        y: number,
        w: number,
        h: number,
        options: Record<string, unknown>,
      ): MockBody {
        return {
          position: { x, y },
          velocity: { x: 0, y: 0 },
          label: options['label'] as string | undefined,
          options: { ...options, _w: w, _h: h },
          removed: false,
        };
      },
    },
    body: {
      setVelocity(body: MockBody, vec: { x: number; y: number }): void {
        body.velocity = { x: vec.x, y: vec.y };
      },
      setPosition(body: MockBody, vec: { x: number; y: number }): void {
        body.position = { x: vec.x, y: vec.y };
      },
      setInertia(_body: MockBody, _inertia: number): void {
        /* recorded by mock — ignored here */
      },
    },
    world: {
      on(event: 'collisionstart' | 'collisionend', fn: CollisionListener['fn']): void {
        listeners.push({ event, fn });
      },
      off(event: 'collisionstart' | 'collisionend', fn: CollisionListener['fn']): void {
        const idx = listeners.findIndex((l) => l.event === event && l.fn === fn);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      remove(_body: MockBody): void {
        /* removal not asserted in this suite */
      },
    },
  };
  return {
    scene: { matter },
    emit(event, pairs) {
      for (const l of listeners.slice()) {
        if (l.event === event) l.fn({ pairs });
      }
    },
  };
}

/** Drop a character onto a fake platform so subsequent applyInput sees grounded=true. */
function ground(ch: Character, m: MockScene): void {
  const plat = {
    label: PLATFORM_LABELS.solid,
    position: { x: ch.getPosition().x, y: ch.getPosition().y + 100 },
  };
  m.emit('collisionstart', [{ bodyA: ch.body, bodyB: plat }]);
}

/**
 * Minimal jab-style attack — distinct id per slot so a regression that
 * fires the wrong character's move surfaces immediately. Used to verify
 * a remapped attack press actually triggers the in-game move on the
 * remapped slot only.
 */
function makeJab(slot: PlayerBindingsIndex): AttackMove {
  return {
    id: `slot${slot}.jab`,
    type: 'jab',
    damage: 3,
    knockback: { x: 1, y: 0, scaling: 0 },
    hitbox: { offsetX: 30, offsetY: 0, width: 40, height: 30 },
    startupFrames: 1,
    activeFrames: 1,
    recoveryFrames: 1,
    cooldownFrames: 1,
  };
}

// ---------------------------------------------------------------------------
// Multi-slot fixture — the production wiring, sans Phaser
// ---------------------------------------------------------------------------

interface FighterRig {
  readonly slot: PlayerBindingsIndex;
  readonly scene: MockScene;
  readonly character: Character;
  readonly jab: AttackMove;
}

interface MixedInputFixture {
  readonly lifecycle: BindingsPersistenceLifecycle;
  readonly dispatcher: DeviceInputDispatcher;
  readonly service: InputService;
  readonly keyboard: MockKeyboard;
  readonly gamepad: MockGamepad;
  readonly storage: InMemoryStorage;
  readonly fighters: Readonly<Record<PlayerBindingsIndex, FighterRig>>;
  /**
   * Single fixed-step poll: read every active slot through the service
   * and feed each resulting record into its character's `applyInput`.
   * Mirrors the production gameplay loop's per-step sequence.
   */
  step(): void;
}

function buildMixedInputFixture(
  options: { storage?: InMemoryStorage } = {},
): MixedInputFixture {
  const storage = options.storage ?? new InMemoryStorage();
  const { lifecycle } = createBootedLifecycle({ storage });
  const keyboard = createMockKeyboard();
  const gamepad = createMockGamepad();
  // The production MatchScene reads `lifecycle.getStore()` and threads
  // the same store into the device dispatcher and the unified input
  // service. We do the same wiring here.
  const store = lifecycle.getStore();
  const dispatcher = new DeviceInputDispatcher({ keyboard, gamepad, bindings: store });
  const service = new InputService({ bindings: store, dispatcher });

  // Build four fighters at distinct spawn coordinates so every slot has
  // a clearly-distinguishable mock body. Each gets a slot-tagged jab so
  // a "fired the wrong character's move" regression is loud.
  const fighters: Record<PlayerBindingsIndex, FighterRig> = {} as never;
  for (const slot of [1, 2, 3, 4] as const) {
    const scene = createMockScene();
    const character = new Character(scene.scene, {
      id: SLOT_CHARACTER_ID[slot],
      spawnX: 100 * slot,
      spawnY: 0,
    });
    const jab = makeJab(slot);
    character.registerAttack(jab);
    ground(character, scene);
    fighters[slot] = { slot, scene, character, jab };
  }

  return {
    lifecycle,
    dispatcher,
    service,
    keyboard,
    gamepad,
    storage,
    fighters,
    step(): void {
      for (const slot of [1, 2, 3, 4] as const) {
        const input: CharacterInput = service.sampleCharacterInput(slot);
        fighters[slot].character.applyInput(input);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Per-slot end-to-end remap → in-game action contract
// ---------------------------------------------------------------------------

describe('AC 40304 Sub-AC 4 — remapped input drives the corresponding character', () => {
  it('keyboard slot 1 jump rebind: pressing the new key applies a jump impulse on the slot-1 character only', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Default P1 jump = W (87). Remap to SPACE — the same mutation
    // RebindingScreen.commitCapturedBinding produces.
    fx.lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);

    // Press the *old* key — must NOT fire jump now.
    fx.keyboard.press(KEY_CODE.W);
    fx.step();
    expect(fx.fighters[1].character.getJumpsUsed()).toBe(0);

    // Press the *new* key — must fire jump on slot 1, and only slot 1.
    fx.keyboard.releaseAll();
    fx.keyboard.press(KEY_CODE.SPACE);
    fx.step();
    expect(fx.fighters[1].character.getJumpsUsed()).toBe(1);
    expect(fx.fighters[1].character.getVelocity().y).toBeLessThan(0);
    // Slots 2/3/4 must be untouched.
    expect(fx.fighters[2].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[3].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[4].character.getJumpsUsed()).toBe(0);
  });

  it('keyboard slot 2 attack rebind: pressing the new key fires the slot-2 jab move only', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Default P2 attack = NUMPAD_1 (97). Remap to ENTER (13).
    fx.lifecycle.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }]);

    fx.keyboard.press(KEY_CODE.NUMPAD_1);
    fx.step();
    expect(fx.fighters[2].character.isAttacking()).toBe(false);

    fx.keyboard.releaseAll();
    fx.keyboard.press(KEY_CODE.ENTER);
    fx.step();

    // Slot 2 fires its own jab (id stamped per slot).
    const active2 = fx.fighters[2].character.getActiveAttack();
    expect(active2).not.toBeNull();
    expect(active2?.move.id).toBe('slot2.jab');
    // Other slots are NOT attacking.
    expect(fx.fighters[1].character.isAttacking()).toBe(false);
    expect(fx.fighters[3].character.isAttacking()).toBe(false);
    expect(fx.fighters[4].character.isAttacking()).toBe(false);
  });

  it('gamepad slot 3 button rebind: pressing the new button applies a jump impulse on the slot-3 character only', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Default slot 3 jump = button 0 (A / Cross). Remap to button 7
    // (right trigger on the standard mapping) — same mutation
    // RebindingScreen.submitGamepadButtonCapture commits.
    fx.lifecycle.setAction(3, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } },
    ]);

    // Pressing the OLD button must NOT fire jump anymore.
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.step();
    expect(fx.fighters[3].character.getJumpsUsed()).toBe(0);

    // Pressing the new button must fire jump on slot 3.
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: false, value: 0 }));
    fx.gamepad.setButton(0, 7, Object.freeze({ pressed: true, value: 1 }));
    fx.step();
    expect(fx.fighters[3].character.getJumpsUsed()).toBe(1);
    expect(fx.fighters[3].character.getVelocity().y).toBeLessThan(0);
    // Other slots are untouched.
    expect(fx.fighters[1].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[2].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[4].character.getJumpsUsed()).toBe(0);
  });

  it('gamepad slot 4 axis rebind: pushing the new axis ramps slot-4 horizontal velocity only', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Re-bind slot 4 left/right onto the right stick (axis 2) instead
    // of the default left stick (axis 0).
    fx.lifecycle.setAction(4, 'left', [
      {
        kind: 'gamepad',
        gamepadIndex: 1,
        source: { type: 'axis', axisIndex: 2, direction: -1, threshold: 0.5 },
      },
    ]);
    fx.lifecycle.setAction(4, 'right', [
      {
        kind: 'gamepad',
        gamepadIndex: 1,
        source: { type: 'axis', axisIndex: 2, direction: 1, threshold: 0.5 },
      },
    ]);

    // Pushing the OLD axis (0) does nothing for slot 4 now.
    fx.gamepad.setAxis(1, 0, 1);
    for (let i = 0; i < 5; i += 1) fx.step();
    expect(fx.fighters[4].character.getVelocity().x).toBeCloseTo(0);

    // Pushing the new axis full-right ramps slot 4's velocity rightward.
    fx.gamepad.setAxis(1, 0, 0);
    fx.gamepad.setAxis(1, 2, 1);
    for (let i = 0; i < 50; i += 1) fx.step();
    const tuning4 = fx.fighters[4].character.getTuning();
    expect(fx.fighters[4].character.getVelocity().x).toBeGreaterThan(0);
    expect(fx.fighters[4].character.getVelocity().x).toBeCloseTo(tuning4.maxRunSpeed);
    // Slot 3 (which we did NOT remap and which is on pad index 0) stays still.
    expect(fx.fighters[3].character.getVelocity().x).toBeCloseTo(0);
    // Slots 1 / 2 (keyboard, no key pressed) stay still.
    expect(fx.fighters[1].character.getVelocity().x).toBeCloseTo(0);
    expect(fx.fighters[2].character.getVelocity().x).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Mixed simultaneous press — all four slots, each on remapped inputs
// ---------------------------------------------------------------------------

describe('AC 40304 Sub-AC 4 — mixed simultaneous press across keyboard + gamepad slots', () => {
  it('all four players hold their remapped jump key/button on the same frame; every slot jumps independently', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Each slot moves its jump onto a distinct, non-default surface so
    // a wiring bug that "fires every slot off the same source" can't
    // produce a passing result.
    fx.lifecycle.setAction(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
    fx.lifecycle.setAction(2, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_5 },
    ]);
    fx.lifecycle.setAction(3, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } },
    ]);
    fx.lifecycle.setAction(4, 'jump', [
      { kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 6 } },
    ]);

    // Hold all four jump inputs on one frame — same fixed step.
    fx.keyboard.press(KEY_CODE.SPACE, KEY_CODE.NUMPAD_5);
    fx.gamepad.setButton(0, 7, Object.freeze({ pressed: true, value: 1 }));
    fx.gamepad.setButton(1, 6, Object.freeze({ pressed: true, value: 1 }));
    fx.step();

    for (const slot of [1, 2, 3, 4] as const) {
      expect(
        fx.fighters[slot].character.getJumpsUsed(),
        `slot ${slot} did not consume a jump`,
      ).toBe(1);
      expect(
        fx.fighters[slot].character.getVelocity().y,
        `slot ${slot} did not get an upward impulse`,
      ).toBeLessThan(0);
    }
  });

  it('mixed config: P1+P2 walk on remapped keyboard keys, P3+P4 walk on remapped gamepad axes — all on the same frame', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Remap walk inputs to deliberately non-default keys / axes on
    // every slot. Keys are chosen so no slot's pressed input
    // coincidentally resolves to another slot's default action — e.g.
    // we deliberately do NOT rebind P2's `left` onto KEY_CODE.A
    // because A is P1's default `left`, which would make P1's stick
    // cancel out (default-left + remapped-right both held) and mask
    // a real bug on the dispatch path.
    fx.lifecycle.setAction(1, 'right', [
      { kind: 'keyboard', keyCode: KEY_CODE.CTRL },
    ]);
    fx.lifecycle.setAction(2, 'left', [
      { kind: 'keyboard', keyCode: KEY_CODE.SHIFT },
    ]);
    fx.lifecycle.setAction(3, 'right', [
      {
        kind: 'gamepad',
        gamepadIndex: 0,
        source: { type: 'axis', axisIndex: 3, direction: 1, threshold: 0.5 },
      },
    ]);
    fx.lifecycle.setAction(4, 'left', [
      {
        kind: 'gamepad',
        gamepadIndex: 1,
        source: { type: 'axis', axisIndex: 3, direction: -1, threshold: 0.5 },
      },
    ]);

    // Press all four on the same frame, then run several fixed steps so
    // velocity ramps to the cap and the assertion is robust against
    // single-step accel jitter.
    fx.keyboard.press(KEY_CODE.CTRL, KEY_CODE.SHIFT);
    fx.gamepad.setAxis(0, 3, 1);
    fx.gamepad.setAxis(1, 3, -1);
    for (let i = 0; i < 50; i += 1) fx.step();

    const t1 = fx.fighters[1].character.getTuning();
    const t2 = fx.fighters[2].character.getTuning();
    const t3 = fx.fighters[3].character.getTuning();
    const t4 = fx.fighters[4].character.getTuning();
    expect(fx.fighters[1].character.getVelocity().x).toBeCloseTo(t1.maxRunSpeed);
    expect(fx.fighters[2].character.getVelocity().x).toBeCloseTo(-t2.maxRunSpeed);
    expect(fx.fighters[3].character.getVelocity().x).toBeCloseTo(t3.maxRunSpeed);
    expect(fx.fighters[4].character.getVelocity().x).toBeCloseTo(-t4.maxRunSpeed);

    // Facing tracks the remapped input direction.
    expect(fx.fighters[1].character.getFacing()).toBe(1);
    expect(fx.fighters[2].character.getFacing()).toBe(-1);
    expect(fx.fighters[3].character.getFacing()).toBe(1);
    expect(fx.fighters[4].character.getFacing()).toBe(-1);
  });

  it('mixed config: each player remaps a different action; on a single frame each fires the right action and only the right action', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // P1 remaps jump (kbd), P2 remaps attack (kbd), P3 remaps shield
    // (gamepad button), P4 remaps left (gamepad axis). Every slot ends
    // up exercising a *different* CharacterInput field at the
    // dispatcher boundary — the strongest cross-action isolation check
    // we can write without instantiating the full match scene.
    fx.lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    fx.lifecycle.setAction(2, 'attack', [{ kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_0 }]);
    fx.lifecycle.setAction(3, 'shield', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 4 } },
    ]);
    fx.lifecycle.setAction(4, 'left', [
      {
        kind: 'gamepad',
        gamepadIndex: 1,
        source: { type: 'axis', axisIndex: 2, direction: -1, threshold: 0.5 },
      },
    ]);

    fx.keyboard.press(KEY_CODE.SPACE, KEY_CODE.NUMPAD_0);
    fx.gamepad.setButton(0, 4, Object.freeze({ pressed: true, value: 1 }));
    fx.gamepad.setAxis(1, 2, -1);
    fx.step();

    // P1 jumped — and DID NOT attack / shield.
    expect(fx.fighters[1].character.getJumpsUsed()).toBe(1);
    expect(fx.fighters[1].character.isAttacking()).toBe(false);
    expect(fx.fighters[1].character.isShielding()).toBe(false);

    // P2 attacked — and DID NOT jump / shield.
    expect(fx.fighters[2].character.isAttacking()).toBe(true);
    expect(fx.fighters[2].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[2].character.isShielding()).toBe(false);

    // P3 shielded — and DID NOT jump / attack / move.
    expect(fx.fighters[3].character.isShielding()).toBe(true);
    expect(fx.fighters[3].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[3].character.isAttacking()).toBe(false);

    // P4 walked left — facing -1, X velocity < 0 — and DID NOT jump /
    // attack / shield.
    expect(fx.fighters[4].character.getFacing()).toBe(-1);
    expect(fx.fighters[4].character.getVelocity().x).toBeLessThan(0);
    expect(fx.fighters[4].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[4].character.isAttacking()).toBe(false);
    expect(fx.fighters[4].character.isShielding()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-device isolation — keyboard rebind cannot leak onto a gamepad slot
// ---------------------------------------------------------------------------

describe('AC 40304 Sub-AC 4 — cross-device isolation under remap', () => {
  it('a keyboard rebind on slot 1 does not affect a gamepad slot 3 holding its default jump button', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Move slot 1's jump onto SPACE.
    fx.lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);

    // Slot 3 still uses its default jump = pad 0 button 0.
    fx.gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 }));
    fx.keyboard.press(KEY_CODE.SPACE);
    fx.step();

    // Both fired their jumps independently, on the same frame.
    expect(fx.fighters[1].character.getJumpsUsed()).toBe(1);
    expect(fx.fighters[3].character.getJumpsUsed()).toBe(1);
    // Slots 2/4 untouched.
    expect(fx.fighters[2].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[4].character.getJumpsUsed()).toBe(0);
  });

  it('a gamepad rebind on slot 4 does not affect a keyboard slot 2 holding its default attack key', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Move slot 4's attack onto pad 1 button 9.
    fx.lifecycle.setAction(4, 'attack', [
      { kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 9 } },
    ]);

    // Slot 2 still uses default attack = NUMPAD_1.
    fx.keyboard.press(KEY_CODE.NUMPAD_1);
    fx.gamepad.setButton(1, 9, Object.freeze({ pressed: true, value: 1 }));
    fx.step();

    expect(fx.fighters[2].character.isAttacking()).toBe(true);
    expect(fx.fighters[4].character.isAttacking()).toBe(true);
    // Slots 1 / 3 untouched.
    expect(fx.fighters[1].character.isAttacking()).toBe(false);
    expect(fx.fighters[3].character.isAttacking()).toBe(false);
  });

  it('two slots remapped to the same physical key share that input — both characters jump together', () => {
    // Edge case the rebinding UI explicitly allows: two slots sharing a
    // physical key (e.g. two siblings using the same keyboard, both
    // remapping their jump onto SPACE for a "tag-team" gag). This is
    // legal — the dispatcher treats each slot's binding independently
    // and OR-s any binding's held state into that slot's action.
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    fx.lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    fx.lifecycle.setAction(2, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);

    fx.keyboard.press(KEY_CODE.SPACE);
    fx.step();

    expect(fx.fighters[1].character.getJumpsUsed()).toBe(1);
    expect(fx.fighters[2].character.getJumpsUsed()).toBe(1);
    // Gamepad slots untouched (no button pressed).
    expect(fx.fighters[3].character.getJumpsUsed()).toBe(0);
    expect(fx.fighters[4].character.getJumpsUsed()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Mid-match rebind — the new binding takes effect on the very next step
// ---------------------------------------------------------------------------

describe('AC 40304 Sub-AC 4 — mid-match rebind takes effect immediately', () => {
  it('rebinding slot 1 jump mid-walk: the next step honours the new key, no reboot', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Player is walking right on default D. Run several steps to ramp.
    fx.keyboard.press(KEY_CODE.D);
    for (let i = 0; i < 30; i += 1) fx.step();
    const t1 = fx.fighters[1].character.getTuning();
    expect(fx.fighters[1].character.getVelocity().x).toBeCloseTo(t1.maxRunSpeed);
    expect(fx.fighters[1].character.getJumpsUsed()).toBe(0);

    // Mid-match: remap jump to SPACE. (The rebinding screen flow that
    // pauses the match isn't required at this layer; we exercise the
    // contract that the dispatcher reads the latest binding on the
    // very next sample.)
    fx.lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);

    // Press SPACE — slot 1 should jump on the very next step.
    fx.keyboard.press(KEY_CODE.SPACE);
    fx.step();
    expect(fx.fighters[1].character.getJumpsUsed()).toBe(1);
    expect(fx.fighters[1].character.getVelocity().y).toBeLessThan(0);
  });

  it('rebinding slot 3 attack mid-air: the next step fires the new button, no buffered ghost-press from the old binding', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // The old default attack button (2) is held throughout; we should
    // NOT see a ghost attack from it after rebinding to a different
    // button.
    fx.gamepad.setButton(0, 2, Object.freeze({ pressed: true, value: 1 }));
    fx.step();
    // The old binding *did* fire on this frame because slot 3 is still
    // on defaults during step 1.
    expect(fx.fighters[3].character.isAttacking()).toBe(true);

    // Wait for the move to fully clear. The test jab is 1+1+1+1 = 4
    // busy frames + 1 cooldown frame — drive the loop forward without
    // any input held to drain the active attack and cooldown.
    fx.gamepad.setButton(0, 2, Object.freeze({ pressed: false, value: 0 }));
    for (let i = 0; i < 10; i += 1) fx.step();
    expect(fx.fighters[3].character.isAttacking()).toBe(false);

    // Now remap attack to button 3 and hold the OLD button (2). The
    // service must read the new binding on the next sample — the old
    // button must produce no attack.
    fx.lifecycle.setAction(3, 'attack', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 3 } },
    ]);
    fx.gamepad.setButton(0, 2, Object.freeze({ pressed: true, value: 1 }));
    fx.step();
    expect(fx.fighters[3].character.isAttacking()).toBe(false);

    // Press the new button — slot 3 attacks.
    fx.gamepad.setButton(0, 2, Object.freeze({ pressed: false, value: 0 }));
    fx.gamepad.setButton(0, 3, Object.freeze({ pressed: true, value: 1 }));
    fx.step();
    expect(fx.fighters[3].character.isAttacking()).toBe(true);
    expect(fx.fighters[3].character.getActiveAttack()?.move.id).toBe('slot3.jab');
  });
});

// ---------------------------------------------------------------------------
// 5. Persistence integration — a remap committed in session A is honoured
//    by a fresh dispatcher / service / character in session B
// ---------------------------------------------------------------------------

describe('AC 40304 Sub-AC 4 — remap survives a session boundary end-to-end', () => {
  it('a multi-slot remap committed in session A drives the right characters in session B without further mutation', () => {
    // Session A — apply a mixed-device remap across all four slots,
    // then snapshot the storage bytes and discard the runtime.
    const sessionA = buildMixedInputFixture();
    sessionA.gamepad.connect(0);
    sessionA.gamepad.connect(1);
    sessionA.lifecycle.setAction(1, 'jump', [
      { kind: 'keyboard', keyCode: KEY_CODE.SPACE },
    ]);
    sessionA.lifecycle.setAction(2, 'attack', [
      { kind: 'keyboard', keyCode: KEY_CODE.NUMPAD_0 },
    ]);
    sessionA.lifecycle.setAction(3, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } },
    ]);
    sessionA.lifecycle.setAction(4, 'attack', [
      { kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 9 } },
    ]);
    const persistedBytes = sessionA.storage.snapshotBytes();

    // Session B — fresh runtime (no shared state with A) hydrated from
    // the persisted bytes only.
    const sessionB = buildMixedInputFixture({
      storage: InMemoryStorage.fromBytes(persistedBytes),
    });
    sessionB.gamepad.connect(0);
    sessionB.gamepad.connect(1);

    // Press all four remapped inputs on one frame in session B — every
    // fighter must do the right thing without session B ever calling
    // `setAction`.
    sessionB.keyboard.press(KEY_CODE.SPACE, KEY_CODE.NUMPAD_0);
    sessionB.gamepad.setButton(0, 7, Object.freeze({ pressed: true, value: 1 }));
    sessionB.gamepad.setButton(1, 9, Object.freeze({ pressed: true, value: 1 }));
    sessionB.step();

    expect(sessionB.fighters[1].character.getJumpsUsed()).toBe(1);
    expect(sessionB.fighters[2].character.isAttacking()).toBe(true);
    expect(sessionB.fighters[3].character.getJumpsUsed()).toBe(1);
    expect(sessionB.fighters[4].character.isAttacking()).toBe(true);

    // Cross-checks — pressing the OLD defaults in session B must NOT
    // fire any of these actions, proving the persisted remap is the
    // sole source of truth.
    sessionB.keyboard.releaseAll();
    sessionB.gamepad.setButton(0, 7, Object.freeze({ pressed: false, value: 0 }));
    sessionB.gamepad.setButton(1, 9, Object.freeze({ pressed: false, value: 0 }));
    // Drain any in-flight attacks before the next press cycle.
    for (let i = 0; i < 10; i += 1) sessionB.step();
    expect(sessionB.fighters[2].character.isAttacking()).toBe(false);
    expect(sessionB.fighters[4].character.isAttacking()).toBe(false);

    sessionB.keyboard.press(KEY_CODE.W); // old slot-1 jump
    sessionB.keyboard.press(KEY_CODE.NUMPAD_1); // old slot-2 attack
    sessionB.gamepad.setButton(0, 0, Object.freeze({ pressed: true, value: 1 })); // old slot-3 jump
    sessionB.gamepad.setButton(1, 2, Object.freeze({ pressed: true, value: 1 })); // old slot-4 attack
    sessionB.step();

    // Slots 1 / 3 already consumed their jump from the new bindings
    // earlier; they should not double-jump from the old defaults
    // because (a) their jump action is no longer mapped to the old
    // surface and (b) even if it were, jumpsUsed is still 1 (single-
    // press contract). The check that proves the old surface is dead
    // is on slots 2 / 4: pressing the old attack key/button must NOT
    // start a fresh attack.
    expect(sessionB.fighters[2].character.isAttacking()).toBe(false);
    expect(sessionB.fighters[4].character.isAttacking()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Service identity end-to-end — character physics tracks the lifecycle's
//    inner store reference, no shadow copy
// ---------------------------------------------------------------------------

describe('AC 40304 Sub-AC 4 — service / lifecycle / character share one binding source', () => {
  it('the service the gameplay loop reads from is the same store the lifecycle mutates', () => {
    const fx = buildMixedInputFixture();
    expect(fx.service.getBindingsProvider()).toBe(fx.lifecycle.getStore());
  });

  it('a same-frame rebind+press on every slot is reflected on every character on the next step', () => {
    const fx = buildMixedInputFixture();
    fx.gamepad.connect(0);
    fx.gamepad.connect(1);

    // Hold the future-bound inputs first — none have an effect yet
    // because the bindings still point at defaults, not these keys/buttons.
    fx.keyboard.press(KEY_CODE.SPACE, KEY_CODE.ENTER);
    fx.gamepad.setButton(0, 7, Object.freeze({ pressed: true, value: 1 }));
    fx.gamepad.setButton(1, 6, Object.freeze({ pressed: true, value: 1 }));
    fx.step();
    for (const slot of [1, 2, 3, 4] as const) {
      expect(fx.fighters[slot].character.getJumpsUsed()).toBe(0);
    }

    // Same fixed-step-relative tick: rebind every slot's jump onto the
    // currently-held physical input, then re-sample. The new bindings
    // must be live immediately — no reload, no buffered "previous map"
    // anywhere in the dispatch chain.
    fx.lifecycle.setAction(1, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.SPACE }]);
    fx.lifecycle.setAction(2, 'jump', [{ kind: 'keyboard', keyCode: KEY_CODE.ENTER }]);
    fx.lifecycle.setAction(3, 'jump', [
      { kind: 'gamepad', gamepadIndex: 0, source: { type: 'button', buttonIndex: 7 } },
    ]);
    fx.lifecycle.setAction(4, 'jump', [
      { kind: 'gamepad', gamepadIndex: 1, source: { type: 'button', buttonIndex: 6 } },
    ]);
    fx.step();
    for (const slot of [1, 2, 3, 4] as const) {
      expect(
        fx.fighters[slot].character.getJumpsUsed(),
        `slot ${slot} did not honour the same-frame rebind`,
      ).toBe(1);
    }
  });
});
