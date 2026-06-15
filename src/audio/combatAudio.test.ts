import { describe, it, expect } from 'vitest';
import {
  emitCombatSfx,
  HEAVY_HIT_DAMAGE_THRESHOLD,
  mapHitConnectToSfxKey,
  mapJumpToSfxKey,
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

// ---------------------------------------------------------------------------
// mapHitConnectToSfxKey — AC 10304 connect-on-hit cue selection
// ---------------------------------------------------------------------------

describe('mapHitConnectToSfxKey — AC 10304', () => {
  it('voices the LIGHT cue for low-damage hits below the threshold', () => {
    expect(mapHitConnectToSfxKey({ damage: HEAVY_HIT_DAMAGE_THRESHOLD - 1 })).toBe(
      ASSET_KEYS.sfxHitLight,
    );
    expect(mapHitConnectToSfxKey({ damage: 0 })).toBe(ASSET_KEYS.sfxHitLight);
  });

  it('voices the HEAVY cue at and above the threshold', () => {
    expect(mapHitConnectToSfxKey({ damage: HEAVY_HIT_DAMAGE_THRESHOLD })).toBe(
      ASSET_KEYS.sfxHitHeavy,
    );
    expect(mapHitConnectToSfxKey({ damage: 25 })).toBe(ASSET_KEYS.sfxHitHeavy);
  });

  it('voices the CLANG cue for a held-weapon hit regardless of damage', () => {
    // Weapon overrides the damage scaling — a light weapon poke clangs.
    expect(mapHitConnectToSfxKey({ damage: 1, heldWeapon: true })).toBe(
      ASSET_KEYS.sfxClang,
    );
    expect(mapHitConnectToSfxKey({ damage: 30, heldWeapon: true })).toBe(
      ASSET_KEYS.sfxClang,
    );
  });

  it('treats a non-finite / negative damage defensively as a light hit', () => {
    expect(mapHitConnectToSfxKey({ damage: Number.NaN })).toBe(ASSET_KEYS.sfxHitLight);
    expect(mapHitConnectToSfxKey({ damage: -5 })).toBe(ASSET_KEYS.sfxHitLight);
  });
});

// ---------------------------------------------------------------------------
// mapJumpToSfxKey — AC 10304 jump cue selection
// ---------------------------------------------------------------------------

describe('mapJumpToSfxKey — AC 10304', () => {
  it('voices the full jump cue for the first (grounded) jump', () => {
    expect(mapJumpToSfxKey(1)).toBe(ASSET_KEYS.sfxJump);
  });

  it('voices the lighter air-jump cue for every multi-jump after the first', () => {
    expect(mapJumpToSfxKey(2)).toBe(ASSET_KEYS.sfxJumpAir);
    expect(mapJumpToSfxKey(3)).toBe(ASSET_KEYS.sfxJumpAir);
  });

  it('falls back to the ground cue for a defensive jumpNumber <= 1', () => {
    expect(mapJumpToSfxKey(0)).toBe(ASSET_KEYS.sfxJump);
  });
});
