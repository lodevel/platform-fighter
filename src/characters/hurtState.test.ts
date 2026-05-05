import { describe, it, expect } from 'vitest';
import {
  deriveHurtState,
  deriveHurtStateFromFighterSnapshot,
  isInHurtState,
  type HurtStateInfo,
  type HurtStateSnapshotInput,
} from './hurtState';
import type { FighterStateSnapshot } from '../entities/Fighter';
import { createShieldState } from './shieldState';
import { createDodgeState } from './dodgeState';

/**
 * AC 8 — "Hitstun locks hit player in hurt state briefly".
 *
 * The classifier in `hurtState.ts` is the *named* surface of the AC 8
 * concept. The hitstun mechanism (frame counter + applyInput lockout)
 * lives on `Character`; this helper exposes the human-readable status
 * for HUD / AI / replay callers without forcing them to consult a
 * boolean field with no documented contract.
 *
 * These tests lock down:
 *   1. The classifier returns `'hurt'` exactly when `inHitstun` is true.
 *   2. The classifier returns `'neutral'` otherwise.
 *   3. `hitstunRemaining` is reported as supplied; the boolean wins
 *      when the two signals contradict.
 *   4. Pure-function determinism — same input ⇒ same output, every
 *      call.
 */

// ---------------------------------------------------------------------------
// deriveHurtState — minimal snapshot input
// ---------------------------------------------------------------------------

describe('deriveHurtState — basic classification', () => {
  it("returns 'neutral' when inHitstun is false", () => {
    const r = deriveHurtState({ inHitstun: false });
    expect(r.name).toBe('neutral');
    expect(r.isHurt).toBe(false);
    expect(r.hitstunRemaining).toBe(0);
  });

  it("returns 'hurt' when inHitstun is true", () => {
    const r = deriveHurtState({ inHitstun: true }, 12);
    expect(r.name).toBe('hurt');
    expect(r.isHurt).toBe(true);
    expect(r.hitstunRemaining).toBe(12);
  });

  it('reports hitstunRemaining as supplied (any positive frame count)', () => {
    for (const f of [1, 6, 18, 60, 120]) {
      const r = deriveHurtState({ inHitstun: true }, f);
      expect(r.hitstunRemaining).toBe(f);
      expect(r.isHurt).toBe(true);
    }
  });

  it('zero-frames-remaining when neutral, even if a stale count is passed', () => {
    // If a caller hands `inHitstun: false` but a non-zero number, the
    // classifier trusts the boolean (the timer says we're free).
    const r = deriveHurtState({ inHitstun: false }, 99);
    expect(r.name).toBe('neutral');
    expect(r.hitstunRemaining).toBe(0);
  });

  it('infers a sentinel 1 frame when inHitstun=true but no count is provided', () => {
    // The default case: caller has only the boolean. The result still
    // reads `isHurt: true`; the frame count is a sentinel positive
    // (concrete number is callers-from-Fighter; the helper is pure and
    // cannot poll the timer).
    const r = deriveHurtState({ inHitstun: true });
    expect(r.isHurt).toBe(true);
    expect(r.hitstunRemaining).toBeGreaterThan(0);
  });

  it('coerces inHitstun=true with hitstunRemaining=0 to a positive sentinel', () => {
    // Defensive — shouldn't happen in practice (Character keeps them in
    // lockstep) but if it does, the boolean wins and the count is
    // bumped to a meaningful positive so consumers don't render
    // "0 frames of hurt" for an active hurt state.
    const r = deriveHurtState({ inHitstun: true }, 0);
    expect(r.isHurt).toBe(true);
    expect(r.hitstunRemaining).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// deriveHurtStateFromFighterSnapshot — full FighterStateSnapshot input
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<FighterStateSnapshot> = {}): FighterStateSnapshot {
  return {
    playerIndex: 1,
    characterId: 'wolf',
    paletteIndex: 0,
    stocks: 3,
    stocksLost: 0,
    kos: 0,
    damagePercent: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    facing: 1,
    grounded: false,
    jumpsUsed: 0,
    jumpsRemaining: 2,
    inHitstun: false,
    invincible: false,
    eliminated: false,
    destroyed: false,
    shield: createShieldState(),
    isShielding: false,
    isShieldBroken: false,
    dodge: createDodgeState(),
    isDodging: false,
    isDodgeInvincible: false,
    ...overrides,
  };
}

describe('deriveHurtStateFromFighterSnapshot — entity snapshot wiring', () => {
  it("returns 'neutral' for a fresh snapshot", () => {
    const r = deriveHurtStateFromFighterSnapshot(makeSnapshot());
    expect(r.name).toBe('neutral');
  });

  it("returns 'hurt' when the snapshot has inHitstun: true", () => {
    const r = deriveHurtStateFromFighterSnapshot(
      makeSnapshot({ inHitstun: true }),
      18,
    );
    expect(r.name).toBe('hurt');
    expect(r.hitstunRemaining).toBe(18);
  });

  it('hurt state is orthogonal to attacking / invincible / eliminated', () => {
    // AC 8 helper deliberately classifies ONLY the hitstun lockout. A
    // fighter that's simultaneously invincible and "in hitstun" can't
    // exist in practice (applyHit is a no-op while invincible) but the
    // classifier should not consult those fields — it would be a
    // boundary violation.
    const r = deriveHurtStateFromFighterSnapshot(
      makeSnapshot({ inHitstun: true, invincible: true, eliminated: true }),
      6,
    );
    // Still classifies as hurt — the classifier's job is just to read
    // the hitstun bit.
    expect(r.name).toBe('hurt');
  });
});

// ---------------------------------------------------------------------------
// isInHurtState shorthand
// ---------------------------------------------------------------------------

describe('isInHurtState — boolean shorthand', () => {
  it('mirrors the inHitstun field exactly', () => {
    expect(isInHurtState({ inHitstun: false })).toBe(false);
    expect(isInHurtState({ inHitstun: true })).toBe(true);
  });

  it('reads correctly from a full FighterStateSnapshot', () => {
    expect(isInHurtState(makeSnapshot({ inHitstun: false }))).toBe(false);
    expect(isInHurtState(makeSnapshot({ inHitstun: true }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same inputs always produce the same outputs
// ---------------------------------------------------------------------------

describe('deriveHurtState — determinism (replay-byte-equivalence)', () => {
  it('produces byte-identical results across repeated calls', () => {
    const input: HurtStateSnapshotInput = { inHitstun: true };
    const calls: HurtStateInfo[] = [];
    for (let i = 0; i < 16; i += 1) {
      calls.push(deriveHurtState(input, 24));
    }
    const first = calls[0]!;
    for (const r of calls) {
      expect(r.name).toBe(first.name);
      expect(r.hitstunRemaining).toBe(first.hitstunRemaining);
      expect(r.isHurt).toBe(first.isHurt);
    }
  });

  it('never reads wall-clock or random — same args, same output across both branches', () => {
    const a = deriveHurtState({ inHitstun: false });
    const b = deriveHurtState({ inHitstun: false });
    expect(a).toEqual(b);
    const c = deriveHurtState({ inHitstun: true }, 5);
    const d = deriveHurtState({ inHitstun: true }, 5);
    expect(c).toEqual(d);
  });
});
