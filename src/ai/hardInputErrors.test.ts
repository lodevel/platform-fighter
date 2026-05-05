/**
 * hardInputErrors test suite — AC 20205 Sub-AC 5.
 *
 * Locks down the Hard-tier "minimal error rates" contract:
 *
 *   1. Defaults are an order of magnitude lower than the Easy tier.
 *   2. Spurious presses are disabled by design (chance = 0).
 *   3. {@link resolveHardInputErrorOptions} applies overrides and falls
 *      back to defaults for missing fields.
 *   4. {@link HARD_TIER_INPUT_ERROR_DEFAULTS} is frozen.
 *   5. Wiring the resolved options into {@link EasyInputErrorMangler}
 *      produces a bot whose intended commands pass through nearly
 *      unmangled across many ticks (statistical sanity check).
 */

import { describe, it, expect } from 'vitest';

import {
  DEFAULT_HARD_MOVE_ERROR_CHANCE,
  DEFAULT_HARD_PRESS_DROP_CHANCE,
  DEFAULT_HARD_SPURIOUS_PRESS_CHANCE,
  HARD_TIER_INPUT_ERROR_DEFAULTS,
  resolveHardInputErrorOptions,
} from './hardInputErrors';
import {
  DEFAULT_EASY_MOVE_ERROR_CHANCE,
  DEFAULT_EASY_PRESS_DROP_CHANCE,
  DEFAULT_EASY_SPURIOUS_PRESS_CHANCE,
  EasyInputErrorMangler,
} from './easyInputErrors';
import type { AIInputCommand } from './AIInputProvider';
import { Rng } from '../utils/Rng';

// ---------------------------------------------------------------------------
// Default values — Hard tier is meaningfully cleaner than Easy
// ---------------------------------------------------------------------------

describe('hardInputErrors — default constants', () => {
  it('move-error rate is at least 10× lower than the Easy default', () => {
    expect(DEFAULT_HARD_MOVE_ERROR_CHANCE).toBeLessThanOrEqual(
      DEFAULT_EASY_MOVE_ERROR_CHANCE / 10,
    );
  });

  it('press-drop rate is at least 10× lower than the Easy default', () => {
    expect(DEFAULT_HARD_PRESS_DROP_CHANCE).toBeLessThanOrEqual(
      DEFAULT_EASY_PRESS_DROP_CHANCE / 10,
    );
  });

  it('spurious-press rate is exactly 0 — Hard does not random-mash', () => {
    expect(DEFAULT_HARD_SPURIOUS_PRESS_CHANCE).toBe(0);
    // Sanity-check that Easy is meaningfully nonzero so this is a
    // real difference and not a coincidence.
    expect(DEFAULT_EASY_SPURIOUS_PRESS_CHANCE).toBeGreaterThan(0);
  });

  it('all defaults sit in the [0, 1] probability band', () => {
    expect(DEFAULT_HARD_MOVE_ERROR_CHANCE).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_HARD_MOVE_ERROR_CHANCE).toBeLessThanOrEqual(1);
    expect(DEFAULT_HARD_PRESS_DROP_CHANCE).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_HARD_PRESS_DROP_CHANCE).toBeLessThanOrEqual(1);
    expect(DEFAULT_HARD_SPURIOUS_PRESS_CHANCE).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_HARD_SPURIOUS_PRESS_CHANCE).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// resolveHardInputErrorOptions
// ---------------------------------------------------------------------------

describe('resolveHardInputErrorOptions', () => {
  it('returns the canonical Hard-tier defaults when called with no overrides', () => {
    const r = resolveHardInputErrorOptions();
    expect(r.moveErrorChance).toBe(DEFAULT_HARD_MOVE_ERROR_CHANCE);
    expect(r.pressDropChance).toBe(DEFAULT_HARD_PRESS_DROP_CHANCE);
    expect(r.spuriousPressChance).toBe(DEFAULT_HARD_SPURIOUS_PRESS_CHANCE);
  });

  it('honours partial overrides without disturbing the others', () => {
    const r = resolveHardInputErrorOptions({ moveErrorChance: 0.005 });
    expect(r.moveErrorChance).toBe(0.005);
    expect(r.pressDropChance).toBe(DEFAULT_HARD_PRESS_DROP_CHANCE);
    expect(r.spuriousPressChance).toBe(DEFAULT_HARD_SPURIOUS_PRESS_CHANCE);
  });

  it('passes through an override of 0 (e.g. disabling moveError entirely)', () => {
    const r = resolveHardInputErrorOptions({ moveErrorChance: 0 });
    expect(r.moveErrorChance).toBe(0);
  });

  it('forwards the spuriousPressPool override unchanged', () => {
    const pool = ['attack', 'jump'] as const;
    const r = resolveHardInputErrorOptions({
      // Cast required because we deliberately pass a narrow type to
      // verify the resolver doesn't widen / mutate it.
      spuriousPressPool: pool as unknown as ReadonlyArray<'attack' | 'jump'>,
    });
    expect(r.spuriousPressPool).toBe(pool);
  });
});

// ---------------------------------------------------------------------------
// HARD_TIER_INPUT_ERROR_DEFAULTS — frozen reference
// ---------------------------------------------------------------------------

describe('HARD_TIER_INPUT_ERROR_DEFAULTS', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(HARD_TIER_INPUT_ERROR_DEFAULTS)).toBe(true);
  });

  it('matches the named default constants', () => {
    expect(HARD_TIER_INPUT_ERROR_DEFAULTS.moveErrorChance).toBe(
      DEFAULT_HARD_MOVE_ERROR_CHANCE,
    );
    expect(HARD_TIER_INPUT_ERROR_DEFAULTS.pressDropChance).toBe(
      DEFAULT_HARD_PRESS_DROP_CHANCE,
    );
    expect(HARD_TIER_INPUT_ERROR_DEFAULTS.spuriousPressChance).toBe(
      DEFAULT_HARD_SPURIOUS_PRESS_CHANCE,
    );
  });
});

// ---------------------------------------------------------------------------
// Statistical end-to-end — wired through EasyInputErrorMangler
// ---------------------------------------------------------------------------

describe('hardInputErrors — wired through EasyInputErrorMangler', () => {
  it('passes through movement intents nearly unmolested', () => {
    const mangler = new EasyInputErrorMangler(resolveHardInputErrorOptions());
    const rng = new Rng(0xDEADBEEF);
    const intent: ReadonlyArray<AIInputCommand> = [{ kind: 'moveRight' }];
    let reversed = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      const out = mangler.apply(intent, rng);
      // Movement is the only command so the only mangle is reversal.
      // Expect ~1% reversed → < 5% in any reasonable sample.
      const m = out.find(
        (c) => c.kind === 'moveLeft' || c.kind === 'moveRight',
      );
      if (m && m.kind === 'moveLeft') reversed += 1;
    }
    // Empirical bound: at 1% reversal rate, 5000 samples have a 99%+
    // probability of being below 100 reversals (roughly 2× expected).
    expect(reversed).toBeLessThan(N * 0.05);
  });

  it('passes through attack presses nearly unmolested', () => {
    const mangler = new EasyInputErrorMangler(resolveHardInputErrorOptions());
    const rng = new Rng(0xCAFEBABE);
    const intent: ReadonlyArray<AIInputCommand> = [{ kind: 'attack' }];
    let dropped = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      const out = mangler.apply(intent, rng);
      // Drop = the attack press is missing from the output.
      const hadAttack = out.some((c) => c.kind === 'attack');
      if (!hadAttack) dropped += 1;
    }
    // Empirical bound: at 1% drop rate, 5000 samples have a 99%+
    // probability of dropping fewer than 5% of presses.
    expect(dropped).toBeLessThan(N * 0.05);
  });

  it('NEVER injects spurious presses (Hard contract)', () => {
    const mangler = new EasyInputErrorMangler(resolveHardInputErrorOptions());
    const rng = new Rng(0x1234);
    const intent: ReadonlyArray<AIInputCommand> = [{ kind: 'idle' }];
    for (let i = 0; i < 1000; i += 1) {
      const out = mangler.apply(intent, rng);
      // Idle passes through; nothing else should appear.
      expect(out.length).toBe(1);
      expect(out[0]!.kind).toBe('idle');
    }
  });

  it('determinism — two manglers seeded identically produce identical output', () => {
    const a = new EasyInputErrorMangler(resolveHardInputErrorOptions());
    const b = new EasyInputErrorMangler(resolveHardInputErrorOptions());
    const seed = 0xABCD1234;
    const rngA = new Rng(seed);
    const rngB = new Rng(seed);
    const intents: ReadonlyArray<AIInputCommand> = [
      { kind: 'moveRight' },
      { kind: 'attack' },
    ];
    for (let i = 0; i < 200; i += 1) {
      const outA = a.apply(intents, rngA);
      const outB = b.apply(intents, rngB);
      expect(outA).toEqual(outB);
    }
  });
});
