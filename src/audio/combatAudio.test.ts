import { describe, it, expect } from 'vitest';
import {
  emitCombatSfx,
  mapMoveTypeToSfxKey,
  type CombatSfxSink,
} from './combatAudio';
import { ASSET_KEYS } from '../assets/manifest';

/**
 * Unit tests for the combat → audio bridge module — AC 10302 Sub-AC 2.
 *
 * The bridge is the seam combat code (Character / Fighter) reaches for
 * when it wants to fire an SFX cue. The contract this suite locks down:
 *
 *   1. **Move-type → cue-key mapping.** The four canonical attack
 *      buckets (jab / tilt / smash / aerial) each resolve to the
 *      matching `ASSET_KEYS.sfx*` cache key the {@link AudioManager}
 *      voices. Every other bucket (special / grab / throw / shield /
 *      dodge / taunt) returns `null` so the caller's optional-chain
 *      gates the fire.
 *
 *   2. **Defensive emit.** {@link emitCombatSfx} forwards `playSfx`
 *      calls to the sink, swallows any thrown error, and short-circuits
 *      cleanly when the sink is `undefined`. The combat path must
 *      never throw out of the audio layer.
 *
 *   3. **Type narrowness.** The {@link CombatSfxSink} interface needs
 *      only `playSfx(key)` — anything wider would over-couple combat
 *      code to the AudioManager surface. The recorder fake below proves
 *      a four-line implementation satisfies the contract.
 */

// ---------------------------------------------------------------------------
// Recorder fake
// ---------------------------------------------------------------------------

class RecorderSink implements CombatSfxSink {
  readonly calls: string[] = [];
  playSfx(key: string): unknown {
    this.calls.push(key);
    return undefined;
  }
}

class ThrowingSink implements CombatSfxSink {
  playSfx(_key: string): unknown {
    throw new Error('audio backend exploded');
  }
}

// ---------------------------------------------------------------------------
// mapMoveTypeToSfxKey
// ---------------------------------------------------------------------------

describe('mapMoveTypeToSfxKey — Sub-AC 2 of AC 10302', () => {
  it('maps `jab` to the canonical SFX key', () => {
    expect(mapMoveTypeToSfxKey('jab')).toBe(ASSET_KEYS.sfxJab);
  });

  it('maps `tilt` to the canonical SFX key', () => {
    expect(mapMoveTypeToSfxKey('tilt')).toBe(ASSET_KEYS.sfxTilt);
  });

  it('maps `smash` to the canonical SFX key', () => {
    expect(mapMoveTypeToSfxKey('smash')).toBe(ASSET_KEYS.sfxSmash);
  });

  it('maps `aerial` to the canonical SFX key (covers nair / fair / bair)', () => {
    expect(mapMoveTypeToSfxKey('aerial')).toBe(ASSET_KEYS.sfxAerial);
  });

  it.each([
    ['special'],
    ['sideSpecial'],
    ['upSpecial'],
    ['downSpecial'],
    ['grab'],
    ['throw'],
    ['shield'],
    ['dodge'],
    ['taunt'],
  ] as const)('returns null for `%s` (no canonical attack-swing cue)', (type) => {
    // The shield / dodge cues exist but they're voiced from the state-
    // machine transition (raise / press), not from a `MoveType` lookup.
    // The special / grab / throw / taunt buckets simply have no SFX in
    // the M1 manifest — silently dropping the request beats mis-mapping.
    expect(mapMoveTypeToSfxKey(type)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// emitCombatSfx
// ---------------------------------------------------------------------------

describe('emitCombatSfx — Sub-AC 2 of AC 10302', () => {
  it('forwards the key to the sink and reports success', () => {
    const sink = new RecorderSink();
    expect(emitCombatSfx(sink, ASSET_KEYS.sfxJab)).toBe(true);
    expect(sink.calls).toEqual([ASSET_KEYS.sfxJab]);
  });

  it('returns false (no-op) when the sink is undefined', () => {
    expect(emitCombatSfx(undefined, ASSET_KEYS.sfxJab)).toBe(false);
  });

  it('swallows errors thrown by the sink so the gameplay tick never crashes', () => {
    const sink = new ThrowingSink();
    // The whole point: a misbehaving audio backend MUST NOT propagate
    // exceptions into the deterministic physics tick. The helper must
    // catch silently.
    expect(() => emitCombatSfx(sink, ASSET_KEYS.sfxJab)).not.toThrow();
    expect(emitCombatSfx(sink, ASSET_KEYS.sfxJab)).toBe(false);
  });

  it('preserves call ordering across multiple emits', () => {
    const sink = new RecorderSink();
    emitCombatSfx(sink, ASSET_KEYS.sfxJab);
    emitCombatSfx(sink, ASSET_KEYS.sfxShield);
    emitCombatSfx(sink, ASSET_KEYS.sfxKo);
    expect(sink.calls).toEqual([
      ASSET_KEYS.sfxJab,
      ASSET_KEYS.sfxShield,
      ASSET_KEYS.sfxKo,
    ]);
  });
});
