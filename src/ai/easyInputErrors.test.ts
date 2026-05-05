import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EASY_MOVE_ERROR_CHANCE,
  DEFAULT_EASY_PRESS_DROP_CHANCE,
  DEFAULT_EASY_SPURIOUS_PRESS_CHANCE,
  DEFAULT_SPURIOUS_PRESS_POOL,
  EasyInputErrorMangler,
  resolveEasyInputErrorOptions,
} from './easyInputErrors';
import type { AIInputCommand } from './AIInputProvider';
import { Rng } from '../utils/Rng';

describe('resolveEasyInputErrorOptions', () => {
  it('fills in defaults for unspecified fields', () => {
    const r = resolveEasyInputErrorOptions();
    expect(r.moveErrorChance).toBe(DEFAULT_EASY_MOVE_ERROR_CHANCE);
    expect(r.pressDropChance).toBe(DEFAULT_EASY_PRESS_DROP_CHANCE);
    expect(r.spuriousPressChance).toBe(DEFAULT_EASY_SPURIOUS_PRESS_CHANCE);
    expect(r.spuriousPressPool).toEqual(DEFAULT_SPURIOUS_PRESS_POOL);
  });

  it('honours explicit overrides', () => {
    const r = resolveEasyInputErrorOptions({
      moveErrorChance: 0.1,
      pressDropChance: 0.2,
      spuriousPressChance: 0.3,
      spuriousPressPool: ['attack'],
    });
    expect(r.moveErrorChance).toBe(0.1);
    expect(r.pressDropChance).toBe(0.2);
    expect(r.spuriousPressChance).toBe(0.3);
    expect(r.spuriousPressPool).toEqual(['attack']);
  });

  it('rejects out-of-range moveErrorChance', () => {
    expect(() => resolveEasyInputErrorOptions({ moveErrorChance: -0.1 })).toThrow(
      /moveErrorChance must be in \[0, 1\]/,
    );
    expect(() => resolveEasyInputErrorOptions({ moveErrorChance: 1.1 })).toThrow(
      /moveErrorChance must be in \[0, 1\]/,
    );
    expect(() => resolveEasyInputErrorOptions({ moveErrorChance: NaN })).toThrow(
      /moveErrorChance must be in \[0, 1\]/,
    );
  });

  it('rejects out-of-range pressDropChance', () => {
    expect(() => resolveEasyInputErrorOptions({ pressDropChance: -0.1 })).toThrow(
      /pressDropChance must be in \[0, 1\]/,
    );
    expect(() => resolveEasyInputErrorOptions({ pressDropChance: 1.1 })).toThrow(
      /pressDropChance must be in \[0, 1\]/,
    );
  });

  it('rejects out-of-range spuriousPressChance', () => {
    expect(() =>
      resolveEasyInputErrorOptions({ spuriousPressChance: -0.1 }),
    ).toThrow(/spuriousPressChance must be in \[0, 1\]/);
    expect(() =>
      resolveEasyInputErrorOptions({ spuriousPressChance: 1.1 }),
    ).toThrow(/spuriousPressChance must be in \[0, 1\]/);
  });

  it('rejects an empty spurious-press pool', () => {
    expect(() =>
      resolveEasyInputErrorOptions({ spuriousPressPool: [] }),
    ).toThrow(/spuriousPressPool must contain at least one entry/);
  });

  it('accepts the boundary 0 and 1 for every probability', () => {
    const r = resolveEasyInputErrorOptions({
      moveErrorChance: 0,
      pressDropChance: 1,
      spuriousPressChance: 0,
    });
    expect(r.moveErrorChance).toBe(0);
    expect(r.pressDropChance).toBe(1);
    expect(r.spuriousPressChance).toBe(0);
  });
});

describe('EasyInputErrorMangler — construction', () => {
  it('exposes the configured probabilities', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0.1,
      pressDropChance: 0.2,
      spuriousPressChance: 0.3,
    });
    expect(m.getMoveErrorChance()).toBe(0.1);
    expect(m.getPressDropChance()).toBe(0.2);
    expect(m.getSpuriousPressChance()).toBe(0.3);
  });

  it('uses the canonical defaults when no options are supplied', () => {
    const m = new EasyInputErrorMangler();
    expect(m.getMoveErrorChance()).toBe(DEFAULT_EASY_MOVE_ERROR_CHANCE);
    expect(m.getPressDropChance()).toBe(DEFAULT_EASY_PRESS_DROP_CHANCE);
    expect(m.getSpuriousPressChance()).toBe(DEFAULT_EASY_SPURIOUS_PRESS_CHANCE);
    expect(m.getSpuriousPressPool()).toEqual(DEFAULT_SPURIOUS_PRESS_POOL);
  });
});

describe('EasyInputErrorMangler — apply', () => {
  it('passes commands through unchanged when all error rates are 0', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 0,
      spuriousPressChance: 0,
    });
    const rng = new Rng(1);
    const inputs: AIInputCommand[] = [
      { kind: 'moveRight' },
      { kind: 'attack' },
    ];
    const out = m.apply(inputs, rng);
    expect(out).toEqual(inputs);
  });

  it('returns a new array — never mutates the input', () => {
    const m = new EasyInputErrorMangler();
    const rng = new Rng(1);
    const inputs: AIInputCommand[] = [
      { kind: 'moveRight' },
      { kind: 'attack' },
    ];
    const before = JSON.parse(JSON.stringify(inputs));
    const out = m.apply(inputs, rng);
    expect(inputs).toEqual(before);
    expect(out).not.toBe(inputs);
  });

  it('reverses moveRight to moveLeft when moveErrorChance is 1', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 1,
      pressDropChance: 0,
      spuriousPressChance: 0,
    });
    const rng = new Rng(1);
    const out = m.apply([{ kind: 'moveRight' }], rng);
    expect(out).toEqual([{ kind: 'moveLeft' }]);
  });

  it('reverses moveLeft to moveRight when moveErrorChance is 1', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 1,
      pressDropChance: 0,
      spuriousPressChance: 0,
    });
    const rng = new Rng(1);
    const out = m.apply([{ kind: 'moveLeft' }], rng);
    expect(out).toEqual([{ kind: 'moveRight' }]);
  });

  it('reverses moveAxis sign', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 1,
      pressDropChance: 0,
      spuriousPressChance: 0,
    });
    const rng = new Rng(1);
    const out = m.apply([{ kind: 'moveAxis', value: 0.7 }], rng);
    expect(out).toEqual([{ kind: 'moveAxis', value: -0.7 }]);
  });

  it('reverses moveUp/moveDown', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 1,
      pressDropChance: 0,
      spuriousPressChance: 0,
    });
    const rng = new Rng(1);
    expect(m.apply([{ kind: 'moveUp' }], rng)).toEqual([{ kind: 'moveDown' }]);
    expect(m.apply([{ kind: 'moveDown' }], rng)).toEqual([{ kind: 'moveUp' }]);
  });

  it('drops every press when pressDropChance is 1', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 1,
      spuriousPressChance: 0,
    });
    const rng = new Rng(1);
    const out = m.apply(
      [{ kind: 'moveRight' }, { kind: 'attack' }, { kind: 'shield' }],
      rng,
    );
    // moveRight passes (it's not a press); both presses dropped.
    expect(out).toEqual([{ kind: 'moveRight' }]);
  });

  it('preserves idle and ledgeRelease verbs (never drops them)', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 1,
      pressDropChance: 1,
      spuriousPressChance: 0,
    });
    const rng = new Rng(1);
    const out = m.apply(
      [
        { kind: 'idle' },
        { kind: 'ledgeRelease', action: 'getUp' },
      ],
      rng,
    );
    // Both passed through unchanged.
    expect(out).toEqual([
      { kind: 'idle' },
      { kind: 'ledgeRelease', action: 'getUp' },
    ]);
  });

  it('injects a spurious press when spuriousPressChance is 1', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 0,
      spuriousPressChance: 1,
    });
    const rng = new Rng(1);
    const out = m.apply([], rng); // no intended input
    expect(out.length).toBe(1);
    const verb = out[0]!.kind;
    expect(DEFAULT_SPURIOUS_PRESS_POOL).toContain(verb);
  });

  it('injects spurious presses in addition to (not instead of) intended emits', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 0,
      spuriousPressChance: 1,
    });
    const rng = new Rng(1);
    const out = m.apply([{ kind: 'moveRight' }, { kind: 'attack' }], rng);
    expect(out.length).toBe(3);
    expect(out[0]).toEqual({ kind: 'moveRight' });
    expect(out[1]).toEqual({ kind: 'attack' });
    // Third command — spurious press.
    expect(DEFAULT_SPURIOUS_PRESS_POOL).toContain(out[2]!.kind);
  });

  it('produces deterministic output given the same seed', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0.3,
      pressDropChance: 0.4,
      spuriousPressChance: 0.2,
    });

    const inputs: AIInputCommand[] = [
      { kind: 'moveRight' },
      { kind: 'attack' },
      { kind: 'shield' },
    ];

    const rng1 = new Rng(42);
    const rng2 = new Rng(42);
    const traces1: AIInputCommand[][] = [];
    const traces2: AIInputCommand[][] = [];
    for (let i = 0; i < 50; i += 1) {
      traces1.push(m.apply(inputs, rng1));
      traces2.push(m.apply(inputs, rng2));
    }
    expect(traces2).toEqual(traces1);
  });

  it('honours the long-run move-error fraction', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0.25,
      pressDropChance: 0,
      spuriousPressChance: 0,
    });
    const rng = new Rng(0xCAFE);
    let leftCount = 0;
    let rightCount = 0;
    const TOTAL = 4000;
    for (let i = 0; i < TOTAL; i += 1) {
      const out = m.apply([{ kind: 'moveRight' }], rng);
      if (out[0]!.kind === 'moveLeft') leftCount += 1;
      if (out[0]!.kind === 'moveRight') rightCount += 1;
    }
    const errorFraction = leftCount / TOTAL;
    expect(errorFraction).toBeGreaterThan(0.22);
    expect(errorFraction).toBeLessThan(0.28);
    expect(leftCount + rightCount).toBe(TOTAL);
  });

  it('honours the long-run press-drop fraction', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 0.30,
      spuriousPressChance: 0,
    });
    const rng = new Rng(0xC0DE);
    let kept = 0;
    const TOTAL = 4000;
    for (let i = 0; i < TOTAL; i += 1) {
      const out = m.apply([{ kind: 'attack' }], rng);
      if (out.length > 0 && out[0]!.kind === 'attack') kept += 1;
    }
    const keptFraction = kept / TOTAL;
    // Expected ~70 % kept (30 % dropped).
    expect(keptFraction).toBeGreaterThan(0.66);
    expect(keptFraction).toBeLessThan(0.74);
  });

  it('honours the long-run spurious-press fraction', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 0,
      spuriousPressChance: 0.05,
    });
    const rng = new Rng(0xBEEF);
    let spuriousCount = 0;
    const TOTAL = 4000;
    for (let i = 0; i < TOTAL; i += 1) {
      const out = m.apply([], rng);
      if (out.length > 0) spuriousCount += 1;
    }
    const fraction = spuriousCount / TOTAL;
    expect(fraction).toBeGreaterThan(0.035);
    expect(fraction).toBeLessThan(0.065);
  });

  it('uses a single-entry pool without consuming a verb roll', () => {
    // With pool length 1, the verb is forced — RNG cadence is one
    // less per spurious injection. Two manglers with identical seeds
    // and only the pool length differing should diverge in RNG state
    // by exactly N draws after N spurious injections.
    const single = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 0,
      spuriousPressChance: 1,
      spuriousPressPool: ['attack'],
    });
    const rngSingle = new Rng(0x111);
    for (let i = 0; i < 5; i += 1) {
      single.apply([], rngSingle);
    }
    const stateSingle = rngSingle.getState();

    const multi = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 0,
      spuriousPressChance: 1,
      spuriousPressPool: ['attack', 'shield', 'jump'],
    });
    const rngMulti = new Rng(0x111);
    for (let i = 0; i < 5; i += 1) {
      multi.apply([], rngMulti);
    }
    const stateMulti = rngMulti.getState();

    // Single-entry pool should consume strictly fewer RNG values;
    // states diverge.
    expect(stateSingle).not.toBe(stateMulti);
  });
});

describe('EasyInputErrorMangler — RNG cadence', () => {
  it('always burns one move-roll per tick (regardless of move emits)', () => {
    const m = new EasyInputErrorMangler({
      moveErrorChance: 0,
      pressDropChance: 0,
      spuriousPressChance: 0,
    });

    // Empty intent — no presses, no moves. Mangler still burns the
    // move-error roll and the spurious roll = 2 draws per tick.
    const rng = new Rng(0xF00D);
    const startState = rng.getState();
    m.apply([], rng);
    const after1 = rng.getState();

    // Intent with one move + one press. 1 move-roll + 1 drop-roll +
    // 1 spurious-roll = 3 draws. Different RNG state than the empty
    // case after one tick.
    const rng2 = new Rng(0xF00D);
    m.apply([{ kind: 'moveRight' }, { kind: 'attack' }], rng2);
    const after2 = rng2.getState();

    expect(startState).not.toBe(after1);
    expect(after1).not.toBe(after2);
  });
});
