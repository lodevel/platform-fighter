import { describe, it, expect } from 'vitest';
import {
  DEFAULT_P1_BINDINGS,
  DEFAULT_P2_BINDINGS,
  LocalInputHandler,
  type KeyBindings,
  type KeyboardSource,
} from './LocalInputHandler';
import { KEY_CODE } from './keyCodes';

/**
 * AC 203 Sub-AC 3 — local input handler.
 *
 * The handler is the bridge between raw browser key state and the
 * deterministic `CharacterInput` record consumed by `Character`. The
 * test suite locks down:
 *
 *   1. Default bindings — P1 lands on WASD + the F/G/H/T/R cluster, P2
 *      lands on the arrow keys + Numpad. A balance pass that flattens
 *      both into the same layout would silently break local
 *      multiplayer, so we assert the canonical tables explicitly.
 *   2. Sample shape — `sample()` produces a `CharacterInput` with
 *      `moveX ∈ {-1, 0, 1}`, forwarded jump / attack held state, and
 *      `dropThrough = down && jump` per Smash convention.
 *   3. Player isolation — feeding distinct keys to P1 and P2 produces
 *      distinct samples; the handler never crosses keyboards between
 *      slots.
 *   4. Rebinding — `setBindings` replaces the active table and the
 *      next sample reads from the new keys. Validates the M5
 *      rebinding screen's plug point.
 *   5. Determinism — `sample()` is a pure function of the source's
 *      live state (no internal edge-detection state), so calling it
 *      twice with the same source returns identical records.
 *
 * The mock {@link KeyboardSource} is just a `Set<number>` of held
 * keyCodes — no jsdom, no Phaser globals, mirroring the engine-core
 * test pattern already in the repo (`Character.test.ts`,
 * `StageRenderer.test.ts`).
 */

// ---------------------------------------------------------------------------
// Mock keyboard
// ---------------------------------------------------------------------------

interface MockKeyboard extends KeyboardSource {
  press(...codes: number[]): void;
  release(...codes: number[]): void;
  releaseAll(): void;
  readonly held: ReadonlySet<number>;
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
    held,
  };
}

// ---------------------------------------------------------------------------
// Default bindings
// ---------------------------------------------------------------------------

describe('LocalInputHandler — default bindings (Sub-AC 3)', () => {
  it('P1 default layout puts movement on WASD', () => {
    expect(DEFAULT_P1_BINDINGS.left).toBe(KEY_CODE.A);
    expect(DEFAULT_P1_BINDINGS.right).toBe(KEY_CODE.D);
    expect(DEFAULT_P1_BINDINGS.up).toBe(KEY_CODE.W);
    expect(DEFAULT_P1_BINDINGS.down).toBe(KEY_CODE.S);
  });

  it('P1 default layout puts the attack cluster within reach of WASD', () => {
    // Attack keys must sit on the keyboard's right side of WASD so a
    // single hand covers everything.
    const cluster = [
      DEFAULT_P1_BINDINGS.attack,
      DEFAULT_P1_BINDINGS.special,
      DEFAULT_P1_BINDINGS.shield,
      DEFAULT_P1_BINDINGS.grab,
      DEFAULT_P1_BINDINGS.taunt,
    ];
    expect(cluster).toEqual([
      KEY_CODE.F,
      KEY_CODE.G,
      KEY_CODE.H,
      KEY_CODE.T,
      KEY_CODE.R,
    ]);
  });

  it('P2 default layout puts movement on arrow keys', () => {
    expect(DEFAULT_P2_BINDINGS.left).toBe(KEY_CODE.ARROW_LEFT);
    expect(DEFAULT_P2_BINDINGS.right).toBe(KEY_CODE.ARROW_RIGHT);
    expect(DEFAULT_P2_BINDINGS.up).toBe(KEY_CODE.ARROW_UP);
    expect(DEFAULT_P2_BINDINGS.down).toBe(KEY_CODE.ARROW_DOWN);
  });

  it('P2 default layout puts the attack cluster on the Numpad', () => {
    const cluster = [
      DEFAULT_P2_BINDINGS.attack,
      DEFAULT_P2_BINDINGS.special,
      DEFAULT_P2_BINDINGS.shield,
      DEFAULT_P2_BINDINGS.grab,
      DEFAULT_P2_BINDINGS.taunt,
    ];
    expect(cluster).toEqual([
      KEY_CODE.NUMPAD_1,
      KEY_CODE.NUMPAD_2,
      KEY_CODE.NUMPAD_3,
      KEY_CODE.NUMPAD_4,
      KEY_CODE.NUMPAD_5,
    ]);
  });

  it('P1 and P2 default movement keys do not collide', () => {
    // The whole point of two-player local multiplayer on one keyboard
    // is that pressing P1's left does not also press P2's left.
    const p1Movement = new Set([
      DEFAULT_P1_BINDINGS.left,
      DEFAULT_P1_BINDINGS.right,
      DEFAULT_P1_BINDINGS.up,
      DEFAULT_P1_BINDINGS.down,
    ]);
    const p2Movement = new Set([
      DEFAULT_P2_BINDINGS.left,
      DEFAULT_P2_BINDINGS.right,
      DEFAULT_P2_BINDINGS.up,
      DEFAULT_P2_BINDINGS.down,
    ]);
    for (const code of p1Movement) {
      expect(p2Movement.has(code)).toBe(false);
    }
  });

  it('exposes per-player bindings through getBindings()', () => {
    const handler = new LocalInputHandler(createMockKeyboard());
    expect(handler.getBindings(1)).toEqual(DEFAULT_P1_BINDINGS);
    expect(handler.getBindings(2)).toEqual(DEFAULT_P2_BINDINGS);
  });
});

// ---------------------------------------------------------------------------
// sample() — directional input
// ---------------------------------------------------------------------------

describe('LocalInputHandler.sample() — directional input', () => {
  it('reads moveX = 0 when no movement keys are held', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    expect(handler.sample(1).moveX).toBe(0);
    expect(handler.sample(2).moveX).toBe(0);
  });

  it('reads moveX = -1 when P1 left (A) is held', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    kb.press(KEY_CODE.A);
    expect(handler.sample(1).moveX).toBe(-1);
    // P2 unaffected — A is not in P2's table.
    expect(handler.sample(2).moveX).toBe(0);
  });

  it('reads moveX = +1 when P1 right (D) is held', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    kb.press(KEY_CODE.D);
    expect(handler.sample(1).moveX).toBe(1);
  });

  it('reads moveX = -1 when P2 left arrow is held', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    kb.press(KEY_CODE.ARROW_LEFT);
    expect(handler.sample(2).moveX).toBe(-1);
    // P1 unaffected.
    expect(handler.sample(1).moveX).toBe(0);
  });

  it('reads moveX = +1 when P2 right arrow is held', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    kb.press(KEY_CODE.ARROW_RIGHT);
    expect(handler.sample(2).moveX).toBe(1);
  });

  it('cancels left + right held simultaneously to moveX = 0', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    kb.press(KEY_CODE.A, KEY_CODE.D);
    expect(handler.sample(1).moveX).toBe(0);
    kb.releaseAll();
    kb.press(KEY_CODE.ARROW_LEFT, KEY_CODE.ARROW_RIGHT);
    expect(handler.sample(2).moveX).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sample() — jump / attack / dropThrough
// ---------------------------------------------------------------------------

describe('LocalInputHandler.sample() — action buttons', () => {
  it('forwards jump held state for P1 (W) and P2 (Up arrow)', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    expect(handler.sample(1).jump).toBe(false);
    expect(handler.sample(2).jump).toBe(false);
    kb.press(KEY_CODE.W);
    expect(handler.sample(1).jump).toBe(true);
    kb.press(KEY_CODE.ARROW_UP);
    expect(handler.sample(2).jump).toBe(true);
  });

  it('forwards attack held state for P1 (F) and P2 (Numpad1)', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    expect(handler.sample(1).attack).toBe(false);
    expect(handler.sample(2).attack).toBe(false);
    kb.press(KEY_CODE.F);
    expect(handler.sample(1).attack).toBe(true);
    kb.press(KEY_CODE.NUMPAD_1);
    expect(handler.sample(2).attack).toBe(true);
  });

  it('does NOT debounce jump or attack — held state is forwarded as-is', () => {
    // Rising-edge detection lives in `Character.applyInput`, not here.
    // Sampling twice while the key is held must report `true` both times.
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    kb.press(KEY_CODE.W, KEY_CODE.F);
    const a = handler.sample(1);
    const b = handler.sample(1);
    expect(a.jump).toBe(true);
    expect(b.jump).toBe(true);
    expect(a.attack).toBe(true);
    expect(b.attack).toBe(true);
  });

  it('sets dropThrough only when down + jump are held simultaneously', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    // Down alone — not enough.
    kb.press(KEY_CODE.S);
    expect(handler.sample(1).dropThrough).toBe(false);
    // Add jump — now drop-through fires.
    kb.press(KEY_CODE.W);
    expect(handler.sample(1).dropThrough).toBe(true);
    // Releasing down clears it again.
    kb.release(KEY_CODE.S);
    expect(handler.sample(1).dropThrough).toBe(false);
  });

  it('reports dropThrough independently per player', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    // P1 holds down+jump; P2 only holds down.
    kb.press(KEY_CODE.S, KEY_CODE.W, KEY_CODE.ARROW_DOWN);
    expect(handler.sample(1).dropThrough).toBe(true);
    expect(handler.sample(2).dropThrough).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sample() — player isolation
// ---------------------------------------------------------------------------

describe('LocalInputHandler.sample() — player isolation', () => {
  it('produces independent samples for P1 and P2 from one shared keyboard', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    // P1: hold left + attack. P2: hold right + jump.
    kb.press(KEY_CODE.A, KEY_CODE.F, KEY_CODE.ARROW_RIGHT, KEY_CODE.ARROW_UP);
    const p1 = handler.sample(1);
    const p2 = handler.sample(2);
    expect(p1).toEqual({
      moveX: -1, moveY: 0,
      jump: false,
      attack: true,
      shield: false,
      // AC 60302 Sub-AC 2 — dodge field is part of the canonical
      // CharacterInput shape; P1 is not pressing R so it reads false.
      dodge: false,
      dropThrough: false,
    });
    expect(p2).toEqual({
      moveX: 1, moveY: -1, // ArrowUp doubles as the 'up' action while jumping
      jump: true,
      attack: false,
      shield: false,
      dodge: false,
      dropThrough: false,
    });
  });

  it('isActionDown() reads only the requested player\'s binding table', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    kb.press(KEY_CODE.W); // P1 jump key
    expect(handler.isActionDown(1, 'jump')).toBe(true);
    expect(handler.isActionDown(2, 'jump')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rebinding (setBindings)
// ---------------------------------------------------------------------------

describe('LocalInputHandler — rebinding hooks (M5 plug point)', () => {
  it('setBindings() replaces the active binding table for one player', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    const remapped: KeyBindings = {
      ...DEFAULT_P1_BINDINGS,
      attack: KEY_CODE.SPACE,
    };
    handler.setBindings(1, remapped);
    // Old attack key (F) is no longer the attack binding.
    kb.press(KEY_CODE.F);
    expect(handler.sample(1).attack).toBe(false);
    // New binding (Space) does fire.
    kb.press(KEY_CODE.SPACE);
    expect(handler.sample(1).attack).toBe(true);
  });

  it('setBindings() does not affect the other player', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    handler.setBindings(1, { ...DEFAULT_P1_BINDINGS, attack: KEY_CODE.SPACE });
    kb.press(KEY_CODE.NUMPAD_1);
    expect(handler.sample(2).attack).toBe(true);
  });

  it('rejects partial binding tables that omit a required action', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    const broken = { ...DEFAULT_P1_BINDINGS } as Record<string, number>;
    delete broken['jump'];
    expect(() => handler.setBindings(1, broken as unknown as KeyBindings)).toThrow();
  });

  it('rejects bindings with non-numeric keyCodes', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    const broken = { ...DEFAULT_P1_BINDINGS, attack: 'F' as unknown as number };
    expect(() => handler.setBindings(1, broken as KeyBindings)).toThrow();
  });

  it('accepts custom bindings supplied at construction time', () => {
    const kb = createMockKeyboard();
    const customP1: KeyBindings = { ...DEFAULT_P1_BINDINGS, jump: KEY_CODE.SPACE };
    const handler = new LocalInputHandler(kb, { p1: customP1 });
    kb.press(KEY_CODE.SPACE);
    expect(handler.sample(1).jump).toBe(true);
    // W (default jump) no longer fires jump for P1.
    kb.releaseAll();
    kb.press(KEY_CODE.W);
    expect(handler.sample(1).jump).toBe(false);
    // P2 still on its defaults — Up arrow jumps.
    kb.press(KEY_CODE.ARROW_UP);
    expect(handler.sample(2).jump).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('LocalInputHandler — determinism', () => {
  it('sample() is a pure function of the source state — repeated calls return identical records', () => {
    const kb = createMockKeyboard();
    const handler = new LocalInputHandler(kb);
    kb.press(KEY_CODE.A, KEY_CODE.F);
    const a = handler.sample(1);
    const b = handler.sample(1);
    const c = handler.sample(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('two handlers built over the same source produce identical samples', () => {
    // The handler stores no edge-detection state internally, so two
    // independent instances reading the same keyboard are indistinguishable.
    const kb = createMockKeyboard();
    const h1 = new LocalInputHandler(kb);
    const h2 = new LocalInputHandler(kb);
    kb.press(KEY_CODE.A, KEY_CODE.F, KEY_CODE.W);
    expect(h1.sample(1)).toEqual(h2.sample(1));
    expect(h1.sample(2)).toEqual(h2.sample(2));
  });
});
