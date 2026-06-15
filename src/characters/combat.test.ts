import { describe, it, expect } from 'vitest';
import {
  BASELINE_MASS,
  DI_MAX_ROTATION_DEGREES,
  HITLAG_HEAVY_FRAMES,
  HITLAG_HIGH_PERCENT_BONUS_FRAMES,
  HITLAG_HIGH_PERCENT_THRESHOLD,
  HITLAG_LIGHT_DAMAGE_THRESHOLD,
  HITLAG_LIGHT_FRAMES,
  HITLAG_MAX_FRAMES,
  HITLAG_MEDIUM_DAMAGE_THRESHOLD,
  HITLAG_MEDIUM_FRAMES,
  HITLAG_SWEET_SPOT_BONUS_FRAMES,
  HITSTUN_FRAMES_PER_KNOCKBACK_UNIT,
  MAX_DAMAGE_PERCENT,
  MAX_HITSTUN_FRAMES,
  MIN_HITSTUN_FRAMES,
  SHAKE_HEAVY_DURATION_FRAMES,
  SHAKE_HEAVY_INTENSITY_PX,
  SHAKE_LIGHT_DURATION_FRAMES,
  SHAKE_LIGHT_INTENSITY_PX,
  SHAKE_MEDIUM_DURATION_FRAMES,
  SHAKE_MEDIUM_INTENSITY_PX,
  SHIELDSTUN_MAX_FRAMES,
  SHIELDSTUN_MIN_FRAMES,
  accumulateDamage,
  applyDIToLaunchAngle,
  computeHitlag,
  computeHitstun,
  computeKnockback,
  computeLaunchAngle,
  computeRageMultiplier,
  computeScreenShake,
  computeShieldstun,
  computeStaleMultiplier,
  type HitInfo,
  KNOCKBACK_PERCENT_TEMPER,
  RAGE_MAX_MULTIPLIER,
  RAGE_MAX_PERCENT,
  RAGE_START_PERCENT,
  STALE_MIN_MULTIPLIER,
  STALE_QUEUE_SIZE,
  STALE_STEP,
} from './combat';

/**
 * Sub-AC 4.1 of AC 301: damage / knockback / hitstun system.
 *
 * `combat.ts` is pure math — no Phaser, no Matter, no random numbers.
 * Every test in this file exercises a single deterministic input →
 * output mapping that the rest of the engine relies on:
 *
 *   • `accumulateDamage` — stays in [0, MAX] no matter what we throw at it.
 *   • `computeKnockback` — base vector × percent scaling × weight × facing.
 *   • `computeHitstun` — magnitude → frames, clamped at MIN / MAX.
 *
 * The combination is what makes the replay system work: given identical
 * inputs the same hit produces byte-identical knockback and hitstun, so
 * a recorded match plays back without desync.
 */

// ---------------------------------------------------------------------------
// Constants integrity
// ---------------------------------------------------------------------------

describe('combat — constants', () => {
  it('MAX_DAMAGE_PERCENT matches the ontology cap (999)', () => {
    expect(MAX_DAMAGE_PERCENT).toBe(999);
  });

  it('BASELINE_MASS is the canonical neutral-knockback reference point', () => {
    // Sub-AC 2.2 of the T2 refactor — `Character` no longer holds a
    // generic `mass` default (each per-fighter movement profile owns
    // its own mass). `BASELINE_MASS` is therefore the neutral
    // reference for knockback math, NOT a per-fighter default. We lock
    // it at 12 to preserve the historical combat tuning so every
    // authored move's base knockback continues to integrate the same
    // way it did before the refactor.
    expect(BASELINE_MASS).toBe(12);
  });

  it('hitstun bounds are sane (MIN < MAX, both positive)', () => {
    expect(MIN_HITSTUN_FRAMES).toBeGreaterThan(0);
    expect(MAX_HITSTUN_FRAMES).toBeGreaterThan(MIN_HITSTUN_FRAMES);
  });

  it('HITSTUN_FRAMES_PER_KNOCKBACK_UNIT is positive', () => {
    expect(HITSTUN_FRAMES_PER_KNOCKBACK_UNIT).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// accumulateDamage
// ---------------------------------------------------------------------------

describe('accumulateDamage', () => {
  it('adds positive damage to current percent', () => {
    expect(accumulateDamage(0, 6)).toBe(6);
    expect(accumulateDamage(20, 12)).toBe(32);
  });

  it('caps at MAX_DAMAGE_PERCENT (999) — no overflow', () => {
    expect(accumulateDamage(990, 50)).toBe(MAX_DAMAGE_PERCENT);
    expect(accumulateDamage(MAX_DAMAGE_PERCENT, 1)).toBe(MAX_DAMAGE_PERCENT);
  });

  it('floors at 0 — negative damage cannot go below zero', () => {
    expect(accumulateDamage(5, -10)).toBe(0);
    expect(accumulateDamage(0, -1)).toBe(0);
  });

  it('handles fractional damage (no rounding)', () => {
    expect(accumulateDamage(10, 3.5)).toBeCloseTo(13.5);
  });

  it('is deterministic — same inputs produce same output every call', () => {
    // Determinism gate: replay system depends on this.
    const a = accumulateDamage(42.7, 6.3);
    const b = accumulateDamage(42.7, 6.3);
    const c = accumulateDamage(42.7, 6.3);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ---------------------------------------------------------------------------
// computeKnockback — base vector × percent scaling × weight × facing
// ---------------------------------------------------------------------------

const SAMPLE_HIT: HitInfo = {
  damage: 6,
  knockback: { x: 1.4, y: -0.4, scaling: 0.06 },
  facing: 1,
};

describe('computeKnockback — percent scaling', () => {
  it('returns the base vector at 0 % with baseline mass', () => {
    const r = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS);
    // (1 + 0.06 * 0) = 1, mass multiplier = 1, facing = +1.
    expect(r.vector.x).toBeCloseTo(1.4);
    expect(r.vector.y).toBeCloseTo(-0.4);
  });

  it('scales the vector linearly with target percent', () => {
    const r0 = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS);
    const r100 = computeKnockback(SAMPLE_HIT, 100, BASELINE_MASS);
    const r200 = computeKnockback(SAMPLE_HIT, 200, BASELINE_MASS);
    // factor at p%: (1 + 0.06 * p)
    // factor at p%: (1 + 0.06 * p * TEMPER)
    expect(r100.magnitude / r0.magnitude).toBeCloseTo(
      1 + 0.06 * 100 * KNOCKBACK_PERCENT_TEMPER,
    );
    expect(r200.magnitude / r0.magnitude).toBeCloseTo(
      1 + 0.06 * 200 * KNOCKBACK_PERCENT_TEMPER,
    );
  });

  it('clamps target percent into [0, MAX] before scaling', () => {
    // 1500% should be treated as 999% — no Infinity from a buggy caller.
    const r999 = computeKnockback(SAMPLE_HIT, MAX_DAMAGE_PERCENT, BASELINE_MASS);
    const rOver = computeKnockback(SAMPLE_HIT, 1500, BASELINE_MASS);
    expect(rOver.magnitude).toBeCloseTo(r999.magnitude);
  });
});

describe('computeKnockback — weight scaling', () => {
  it('halves the vector when target mass is double the baseline', () => {
    const heavy = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS * 2);
    expect(heavy.vector.x).toBeCloseTo(SAMPLE_HIT.knockback.x * 0.5);
    expect(heavy.vector.y).toBeCloseTo(SAMPLE_HIT.knockback.y * 0.5);
  });

  it('doubles the vector when target mass is half the baseline', () => {
    const light = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS / 2);
    expect(light.vector.x).toBeCloseTo(SAMPLE_HIT.knockback.x * 2);
    expect(light.vector.y).toBeCloseTo(SAMPLE_HIT.knockback.y * 2);
  });

  it('protects against zero-or-negative mass (clamps to 1)', () => {
    // Defensive — Character enforces positive mass at construction, but
    // computeKnockback is a public function that AI / debug tooling can
    // hand any number.
    const r = computeKnockback(SAMPLE_HIT, 0, 0);
    expect(Number.isFinite(r.vector.x)).toBe(true);
    expect(Number.isFinite(r.vector.y)).toBe(true);
  });
});

describe('computeKnockback — facing mirror', () => {
  it('mirrors the horizontal component when attacker faces left', () => {
    const right = computeKnockback({ ...SAMPLE_HIT, facing: 1 }, 50, BASELINE_MASS);
    const left = computeKnockback({ ...SAMPLE_HIT, facing: -1 }, 50, BASELINE_MASS);
    // x components flip sign; y is identical.
    expect(left.vector.x).toBeCloseTo(-right.vector.x);
    expect(left.vector.y).toBeCloseTo(right.vector.y);
    expect(left.magnitude).toBeCloseTo(right.magnitude);
  });

  it('preserves magnitude regardless of facing direction', () => {
    const right = computeKnockback({ ...SAMPLE_HIT, facing: 1 }, 0, BASELINE_MASS);
    const left = computeKnockback({ ...SAMPLE_HIT, facing: -1 }, 0, BASELINE_MASS);
    expect(left.magnitude).toBeCloseTo(right.magnitude);
  });
});

describe('computeKnockback — magnitude + hitstun', () => {
  it('returns Euclidean magnitude of the realised vector', () => {
    const r = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS);
    const expected = Math.hypot(SAMPLE_HIT.knockback.x, SAMPLE_HIT.knockback.y);
    expect(r.magnitude).toBeCloseTo(expected);
  });

  it('hitstunFrames matches computeHitstun(magnitude)', () => {
    const r = computeKnockback(SAMPLE_HIT, 75, BASELINE_MASS);
    expect(r.hitstunFrames).toBe(computeHitstun(r.magnitude));
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 2 of AC 6 — launch angle invariants
//
// "Implement knockback calculation formula that scales launch velocity/angle
// based on damage % and move base knockback."
//
// The angle is the *direction* the target gets sent. The Smash-style
// contract is: each move has its own launch trajectory baked into its base
// knockback (x, y) ratio, and only the magnitude scales with percent / mass.
// These tests lock that contract down.
// ---------------------------------------------------------------------------

describe('computeKnockback — launch angle (Sub-AC 2 of AC 6)', () => {
  it('exposes angle = atan2(vy, vx) on the result', () => {
    const r = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS);
    expect(r.angle).toBeCloseTo(Math.atan2(r.vector.y, r.vector.x));
  });

  it('angle is invariant under percent scaling (only magnitude grows)', () => {
    // The Smash-style contract: a move at 50% lands at the same angle as
    // the same move at 150% — the *trajectory* is fixed by the move, only
    // the *launch speed* changes with damage %.
    const angles = [0, 50, 100, 200, 999].map(
      (p) => computeKnockback(SAMPLE_HIT, p, BASELINE_MASS).angle,
    );
    const first = angles[0]!;
    for (const a of angles) expect(a).toBeCloseTo(first);
  });

  it('angle is invariant under mass scaling (only magnitude shrinks)', () => {
    // Heavier targets fly slower at the same percent, but the trajectory
    // they travel is identical to a lighter target's trajectory.
    const angles = [4, 8, 12, 24].map(
      (m) => computeKnockback(SAMPLE_HIT, 50, m).angle,
    );
    const first = angles[0]!;
    for (const a of angles) expect(a).toBeCloseTo(first);
  });

  it('angle reflects facing — left-facing hits launch toward the -x side', () => {
    // Authored as "right-attacking" with a slight upward component.
    // Right-facing: angle is in the upper-right quadrant (small negative).
    // Left-facing: angle is in the upper-left quadrant (close to ±π).
    const right = computeKnockback({ ...SAMPLE_HIT, facing: 1 }, 50, BASELINE_MASS);
    const left = computeKnockback({ ...SAMPLE_HIT, facing: -1 }, 50, BASELINE_MASS);
    // Cosine of the angle = launch direction along x. For our right-facing
    // move it's positive (sent rightward); for left-facing it's negative.
    expect(Math.cos(right.angle)).toBeGreaterThan(0);
    expect(Math.cos(left.angle)).toBeLessThan(0);
    // sin(angle) is the y component — same sign on both sides since y
    // isn't mirrored.
    expect(Math.sign(Math.sin(right.angle))).toBe(Math.sign(Math.sin(left.angle)));
  });

  it('purely horizontal base knockback launches at angle 0 (right) or ±π (left)', () => {
    const flatHit: HitInfo = {
      damage: 4,
      knockback: { x: 5, y: 0, scaling: 0 },
      facing: 1,
    };
    const right = computeKnockback(flatHit, 0, BASELINE_MASS);
    const left = computeKnockback({ ...flatHit, facing: -1 }, 0, BASELINE_MASS);
    expect(right.angle).toBeCloseTo(0);
    // atan2(0, -x) returns π (positive convention) for negative x with
    // exactly-zero y.
    expect(Math.abs(left.angle)).toBeCloseTo(Math.PI);
  });

  it('purely upward base knockback launches at angle -π/2 (Phaser screen-space)', () => {
    const launcher: HitInfo = {
      damage: 8,
      knockback: { x: 0, y: -6, scaling: 0.2 },
      facing: 1,
    };
    const r = computeKnockback(launcher, 75, BASELINE_MASS);
    expect(r.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('45-degree knockback (equal magnitudes up + right) launches at -π/4', () => {
    // Equal +x and -y components → 45° upward-right in screen-space.
    const diag: HitInfo = {
      damage: 6,
      knockback: { x: 4, y: -4, scaling: 0.1 },
      facing: 1,
    };
    const r = computeKnockback(diag, 100, BASELINE_MASS);
    expect(r.angle).toBeCloseTo(-Math.PI / 4);
  });
});

describe('computeLaunchAngle — standalone helper', () => {
  it('matches computeKnockback().angle for the same base knockback + facing', () => {
    const r = computeKnockback(SAMPLE_HIT, 73, BASELINE_MASS);
    const standalone = computeLaunchAngle(SAMPLE_HIT.knockback, SAMPLE_HIT.facing);
    expect(standalone).toBeCloseTo(r.angle);
  });

  it('does not depend on percent or mass (angle is scale-invariant)', () => {
    // Helper exists so AI / KO predictors can short-circuit the angle
    // calculation without paying for a full computeKnockback call. Sanity:
    // it must produce the same angle for any percent / mass combo.
    const baseAngle = computeLaunchAngle(SAMPLE_HIT.knockback, 1);
    for (const p of [0, 25, 100, 999]) {
      for (const m of [4, 8, 12, 24]) {
        expect(computeKnockback(SAMPLE_HIT, p, m).angle).toBeCloseTo(baseAngle);
      }
    }
  });

  it('mirrors with facing — left-facing flips the angle horizontally', () => {
    const right = computeLaunchAngle(SAMPLE_HIT.knockback, 1);
    const left = computeLaunchAngle(SAMPLE_HIT.knockback, -1);
    // Mirroring across the y-axis: cos flips sign, sin keeps it.
    expect(Math.cos(left)).toBeCloseTo(-Math.cos(right));
    expect(Math.sin(left)).toBeCloseTo(Math.sin(right));
  });

  it('returns 0 for a degenerate (0,0) base knockback (atan2(0,0) convention)', () => {
    const a = computeLaunchAngle({ x: 0, y: 0 }, 1);
    expect(a).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 2 of AC 6 — launch velocity scaling
//
// "Scales launch velocity ... based on damage % and move base knockback."
//
// These tests lock down the velocity scaling formula:
//
//   |launch| = |base| * (1 + scaling * percent) * (BASELINE_MASS / mass)
// ---------------------------------------------------------------------------

describe('computeKnockback — launch velocity scaling formula', () => {
  it('at 0 % with baseline mass, magnitude equals |base|', () => {
    const r = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS);
    const baseMag = Math.hypot(SAMPLE_HIT.knockback.x, SAMPLE_HIT.knockback.y);
    expect(r.magnitude).toBeCloseTo(baseMag);
  });

  it('magnitude follows the percent formula exactly: |base| * (1 + scaling*p)', () => {
    const baseMag = Math.hypot(SAMPLE_HIT.knockback.x, SAMPLE_HIT.knockback.y);
    for (const p of [0, 25, 100, 200, 500, 999]) {
      const r = computeKnockback(SAMPLE_HIT, p, BASELINE_MASS);
      const expected =
        baseMag *
        (1 + SAMPLE_HIT.knockback.scaling * p * KNOCKBACK_PERCENT_TEMPER);
      expect(r.magnitude).toBeCloseTo(expected);
    }
  });

  it('mass term is multiplicatively independent of percent term', () => {
    // |launch|(p, m) / |launch|(p, BASELINE_MASS) = BASELINE_MASS / m,
    // for any p — the mass term commutes with the percent term so AI can
    // compose them in either order.
    const ratios: number[] = [];
    for (const p of [0, 50, 200, 999]) {
      const baseline = computeKnockback(SAMPLE_HIT, p, BASELINE_MASS).magnitude;
      const heavy = computeKnockback(SAMPLE_HIT, p, BASELINE_MASS * 2).magnitude;
      ratios.push(heavy / baseline);
    }
    // Every ratio should be ~0.5 (heavier target at 2× mass takes half).
    for (const r of ratios) expect(r).toBeCloseTo(0.5);
  });

  it('clamps percent at MAX_DAMAGE_PERCENT before applying scaling', () => {
    // 1500% is silently treated as 999% — the formula caps so a bug
    // elsewhere can't drive magnitude to NaN/Infinity.
    const at999 = computeKnockback(SAMPLE_HIT, MAX_DAMAGE_PERCENT, BASELINE_MASS);
    const overflow = computeKnockback(SAMPLE_HIT, 99_999, BASELINE_MASS);
    expect(overflow.magnitude).toBeCloseTo(at999.magnitude);
    expect(Number.isFinite(overflow.magnitude)).toBe(true);
  });

  it('produces the same direction (angle) at every percent — only magnitude grows', () => {
    // Direct corollary of the formula: scaling multiplies (vx, vy) by
    // the same scalar, so direction is preserved.
    const r0 = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS);
    const r999 = computeKnockback(SAMPLE_HIT, MAX_DAMAGE_PERCENT, BASELINE_MASS);
    // Unit vectors should match.
    const ux0 = r0.vector.x / r0.magnitude;
    const uy0 = r0.vector.y / r0.magnitude;
    const ux9 = r999.vector.x / r999.magnitude;
    const uy9 = r999.vector.y / r999.magnitude;
    expect(ux9).toBeCloseTo(ux0);
    expect(uy9).toBeCloseTo(uy0);
    // Magnitude grew by the percent-only multiplier.
    expect(r999.magnitude / r0.magnitude).toBeCloseTo(
      1 + SAMPLE_HIT.knockback.scaling * MAX_DAMAGE_PERCENT * KNOCKBACK_PERCENT_TEMPER,
    );
  });

  it('zero-scaling moves do not grow with percent (move base knockback only)', () => {
    // A "set knockback" move (scaling = 0) lands the same at 0 % and 999 %
    // — used by special moves and grabs in canonical Smash.
    const fixed: HitInfo = {
      damage: 5,
      knockback: { x: 3, y: -2, scaling: 0 },
      facing: 1,
    };
    const r0 = computeKnockback(fixed, 0, BASELINE_MASS);
    const r999 = computeKnockback(fixed, MAX_DAMAGE_PERCENT, BASELINE_MASS);
    expect(r0.magnitude).toBeCloseTo(r999.magnitude);
    expect(r0.angle).toBeCloseTo(r999.angle);
  });
});

// ---------------------------------------------------------------------------
// computeHitstun
// ---------------------------------------------------------------------------

describe('computeHitstun', () => {
  it('returns at least MIN_HITSTUN_FRAMES for any positive magnitude', () => {
    expect(computeHitstun(0)).toBe(MIN_HITSTUN_FRAMES);
    expect(computeHitstun(0.01)).toBe(MIN_HITSTUN_FRAMES);
    expect(computeHitstun(1)).toBe(MIN_HITSTUN_FRAMES);
  });

  it('caps at MAX_HITSTUN_FRAMES for absurdly large magnitudes', () => {
    expect(computeHitstun(10_000)).toBe(MAX_HITSTUN_FRAMES);
  });

  it('scales linearly between bounds', () => {
    // Pick a magnitude in the middle of the range (~7.5 px/step).
    // raw = round(7.5 * 2.0) = 15.
    const mag = 7.5;
    const expected = Math.max(
      MIN_HITSTUN_FRAMES,
      Math.min(
        MAX_HITSTUN_FRAMES,
        Math.round(mag * HITSTUN_FRAMES_PER_KNOCKBACK_UNIT),
      ),
    );
    expect(computeHitstun(mag)).toBe(expected);
  });

  it('treats negative magnitude the same as positive (uses absolute value)', () => {
    expect(computeHitstun(-7.5)).toBe(computeHitstun(7.5));
  });

  it('is deterministic', () => {
    const a = computeHitstun(8.3);
    const b = computeHitstun(8.3);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Combined behaviours — heavy-vs-light, low-vs-high percent
// ---------------------------------------------------------------------------

describe('combat — combined behaviours', () => {
  it('lighter targets fly farther than heavier ones at the same percent', () => {
    // Cat-like vs Wolf-like masses.
    const lightHit = computeKnockback(SAMPLE_HIT, 50, 8);
    const heavyHit = computeKnockback(SAMPLE_HIT, 50, 16);
    expect(lightHit.magnitude).toBeGreaterThan(heavyHit.magnitude);
    // Light target is also stunned longer (proportional to magnitude).
    expect(lightHit.hitstunFrames).toBeGreaterThanOrEqual(heavyHit.hitstunFrames);
  });

  it('high-percent targets fly farther than low-percent ones', () => {
    const lowPct = computeKnockback(SAMPLE_HIT, 0, BASELINE_MASS);
    const highPct = computeKnockback(SAMPLE_HIT, 200, BASELINE_MASS);
    // SAMPLE_HIT is a JAB-tier move (scaling 0.06). Under the Smash-
    // calibrated temper (0.06) a low-scaling poke deliberately grows
    // only modestly with percent — kill scaling is reserved for smash-
    // tier moves (scaling 0.4). So we assert "meaningfully farther"
    // (>1.4×), not the old "double" threshold, which only held while
    // the cast hit ~2× too hard. Smash-tier scaling is exercised in the
    // dedicated damageGrowth / baseMagnitude blocks above.
    expect(highPct.magnitude).toBeGreaterThan(lowPct.magnitude * 1.4);
  });

  it('a stronger move (higher base + scaling) lands harder than a weaker one', () => {
    const finisher: HitInfo = {
      damage: 18,
      knockback: { x: 6, y: -4, scaling: 0.4 },
      facing: 1,
    };
    const jab: HitInfo = {
      damage: 3,
      knockback: { x: 0.7, y: -0.2, scaling: 0.04 },
      facing: 1,
    };
    const fr = computeKnockback(finisher, 100, BASELINE_MASS);
    const jr = computeKnockback(jab, 100, BASELINE_MASS);
    expect(fr.magnitude).toBeGreaterThan(jr.magnitude * 10);
    expect(fr.hitstunFrames).toBeGreaterThan(jr.hitstunFrames);
  });

  it('produces identical results across repeated calls (replay determinism)', () => {
    const calls = Array.from({ length: 16 }, () =>
      computeKnockback(SAMPLE_HIT, 73, 11),
    );
    const first = calls[0]!;
    for (const r of calls) {
      expect(r.vector.x).toBe(first.vector.x);
      expect(r.vector.y).toBe(first.vector.y);
      expect(r.magnitude).toBe(first.magnitude);
      expect(r.hitstunFrames).toBe(first.hitstunFrames);
    }
  });
});

// ---------------------------------------------------------------------------
// Hit-feel helpers (post-M2)
// ---------------------------------------------------------------------------

describe('computeHitlag — tier mapping', () => {
  it('returns light tier for damage at or below the light threshold', () => {
    expect(computeHitlag({ damage: 1, targetPercent: 0 })).toBe(HITLAG_LIGHT_FRAMES);
    expect(computeHitlag({ damage: HITLAG_LIGHT_DAMAGE_THRESHOLD, targetPercent: 0 })).toBe(
      HITLAG_LIGHT_FRAMES,
    );
  });

  it('returns medium tier between light and medium thresholds', () => {
    expect(
      computeHitlag({ damage: HITLAG_LIGHT_DAMAGE_THRESHOLD + 1, targetPercent: 0 }),
    ).toBe(HITLAG_MEDIUM_FRAMES);
    expect(
      computeHitlag({ damage: HITLAG_MEDIUM_DAMAGE_THRESHOLD, targetPercent: 0 }),
    ).toBe(HITLAG_MEDIUM_FRAMES);
  });

  it('returns heavy tier above the medium threshold', () => {
    expect(
      computeHitlag({ damage: HITLAG_MEDIUM_DAMAGE_THRESHOLD + 1, targetPercent: 0 }),
    ).toBe(HITLAG_HEAVY_FRAMES);
    expect(computeHitlag({ damage: 30, targetPercent: 0 })).toBe(HITLAG_HEAVY_FRAMES);
  });

  it('adds the sweet-spot bonus on top of the base tier', () => {
    expect(computeHitlag({ damage: 5, targetPercent: 0, sweetSpot: true })).toBe(
      HITLAG_LIGHT_FRAMES + HITLAG_SWEET_SPOT_BONUS_FRAMES,
    );
    expect(computeHitlag({ damage: 12, targetPercent: 0, sweetSpot: true })).toBe(
      HITLAG_MEDIUM_FRAMES + HITLAG_SWEET_SPOT_BONUS_FRAMES,
    );
  });

  it('adds the high-% bonus when target.percent ≥ threshold', () => {
    expect(
      computeHitlag({ damage: 5, targetPercent: HITLAG_HIGH_PERCENT_THRESHOLD }),
    ).toBe(HITLAG_LIGHT_FRAMES + HITLAG_HIGH_PERCENT_BONUS_FRAMES);
  });

  it('caps at HITLAG_MAX_FRAMES even when bonuses stack', () => {
    const result = computeHitlag({
      damage: 30,
      targetPercent: 200,
      sweetSpot: true,
    });
    expect(result).toBeLessThanOrEqual(HITLAG_MAX_FRAMES);
  });

  it('is deterministic — identical input always returns the same frame count', () => {
    const args = { damage: 12, targetPercent: 87, sweetSpot: true };
    const a = computeHitlag(args);
    const b = computeHitlag(args);
    expect(a).toBe(b);
  });
});

describe('applyDIToLaunchAngle', () => {
  const radEpsilon = 1e-6;

  it('does nothing when stick is neutral', () => {
    const angle = Math.PI / 4;
    const result = applyDIToLaunchAngle(angle, { stickX: 0, stickY: 0 });
    expect(result).toBeCloseTo(angle, 6);
  });

  it('does nothing when stick is parallel to launch', () => {
    const angle = 0; // launching purely right
    // stick pointing right (parallel to launch) — perp component is 0
    const result = applyDIToLaunchAngle(angle, { stickX: 1, stickY: 0 });
    expect(result).toBeCloseTo(angle, 6);
  });

  it('rotates by the maximum when stick is perpendicular to launch', () => {
    const angle = 0; // launching right
    // stick pointing fully down — perp = cos(0)*1 - sin(0)*0 = 1
    const downResult = applyDIToLaunchAngle(angle, { stickX: 0, stickY: 1 });
    const expected = (DI_MAX_ROTATION_DEGREES * Math.PI) / 180;
    expect(Math.abs(downResult - expected)).toBeLessThan(radEpsilon);
    // stick pointing fully up — perp = -1
    const upResult = applyDIToLaunchAngle(angle, { stickX: 0, stickY: -1 });
    expect(Math.abs(upResult - -expected)).toBeLessThan(radEpsilon);
  });

  it('clamps wild stick magnitudes to [-1, 1] perp', () => {
    const angle = 0;
    // stickY = 5 should clamp to perp = 1, not multiply 5x.
    const result = applyDIToLaunchAngle(angle, { stickX: 0, stickY: 5 });
    const expected = (DI_MAX_ROTATION_DEGREES * Math.PI) / 180;
    expect(Math.abs(result - expected)).toBeLessThan(radEpsilon);
  });

  it('is deterministic across repeated calls', () => {
    const angle = Math.PI / 6;
    const di = { stickX: 0.3, stickY: -0.7 };
    expect(applyDIToLaunchAngle(angle, di)).toBe(applyDIToLaunchAngle(angle, di));
  });
});

describe('computeRageMultiplier (Tier 3 — rage)', () => {
  it('is 1.0 at or below the start percent', () => {
    expect(computeRageMultiplier(0)).toBe(1);
    expect(computeRageMultiplier(RAGE_START_PERCENT)).toBe(1);
  });

  it('ramps linearly between start and max', () => {
    const mid = (RAGE_START_PERCENT + RAGE_MAX_PERCENT) / 2;
    const expectedMid = 1 + 0.5 * (RAGE_MAX_MULTIPLIER - 1);
    expect(computeRageMultiplier(mid)).toBeCloseTo(expectedMid, 6);
  });

  it('caps at the max multiplier at and beyond the max percent', () => {
    expect(computeRageMultiplier(RAGE_MAX_PERCENT)).toBeCloseTo(RAGE_MAX_MULTIPLIER, 6);
    expect(computeRageMultiplier(999)).toBeCloseTo(RAGE_MAX_MULTIPLIER, 6);
  });

  it('is monotonic non-decreasing in percent', () => {
    let prev = -Infinity;
    for (let p = 0; p <= 200; p += 10) {
      const v = computeRageMultiplier(p);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('computeStaleMultiplier (Tier 3 — stale-move negation)', () => {
  it('is 1.0 for a fresh move (0 occurrences)', () => {
    expect(computeStaleMultiplier(0)).toBe(1);
  });

  it('shaves STALE_STEP per prior occurrence', () => {
    expect(computeStaleMultiplier(1)).toBeCloseTo(1 - STALE_STEP, 6);
    expect(computeStaleMultiplier(3)).toBeCloseTo(1 - 3 * STALE_STEP, 6);
  });

  it('floors at STALE_MIN_MULTIPLIER for a fully-staled move', () => {
    expect(computeStaleMultiplier(STALE_QUEUE_SIZE)).toBeCloseTo(STALE_MIN_MULTIPLIER, 6);
    expect(computeStaleMultiplier(99)).toBeCloseTo(STALE_MIN_MULTIPLIER, 6);
  });

  it('is monotonic non-increasing in occurrences', () => {
    let prev = Infinity;
    for (let n = 0; n <= STALE_QUEUE_SIZE; n += 1) {
      const v = computeStaleMultiplier(n);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('computeShieldstun', () => {
  it('returns at least the floor for tiny damage', () => {
    expect(computeShieldstun(1)).toBe(SHIELDSTUN_MIN_FRAMES);
    expect(computeShieldstun(0)).toBe(SHIELDSTUN_MIN_FRAMES);
  });

  it('returns at most the cap for large damage', () => {
    expect(computeShieldstun(50)).toBe(SHIELDSTUN_MAX_FRAMES);
    expect(computeShieldstun(999)).toBe(SHIELDSTUN_MAX_FRAMES);
  });

  it('scales with damage in the middle range', () => {
    const lo = computeShieldstun(5);
    const hi = computeShieldstun(12);
    expect(hi).toBeGreaterThanOrEqual(lo);
  });

  it('returns integer frame counts', () => {
    for (const d of [3, 7, 11, 14, 19]) {
      const f = computeShieldstun(d);
      expect(Number.isInteger(f)).toBe(true);
    }
  });
});

describe('computeScreenShake — tier mapping', () => {
  it('returns light tier params for light-tier damage', () => {
    const r = computeScreenShake(HITLAG_LIGHT_DAMAGE_THRESHOLD);
    expect(r.intensityPx).toBe(SHAKE_LIGHT_INTENSITY_PX);
    expect(r.durationFrames).toBe(SHAKE_LIGHT_DURATION_FRAMES);
  });

  it('returns medium tier params between light and medium thresholds', () => {
    const r = computeScreenShake(HITLAG_LIGHT_DAMAGE_THRESHOLD + 1);
    expect(r.intensityPx).toBe(SHAKE_MEDIUM_INTENSITY_PX);
    expect(r.durationFrames).toBe(SHAKE_MEDIUM_DURATION_FRAMES);
  });

  it('returns heavy tier params above the medium threshold', () => {
    const r = computeScreenShake(HITLAG_MEDIUM_DAMAGE_THRESHOLD + 1);
    expect(r.intensityPx).toBe(SHAKE_HEAVY_INTENSITY_PX);
    expect(r.durationFrames).toBe(SHAKE_HEAVY_DURATION_FRAMES);
  });

  it('caps shake duration at the heavy tier (research-backed 150 ms cap)', () => {
    expect(SHAKE_HEAVY_DURATION_FRAMES).toBeLessThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// Smash-style base + damage-fed growth knockback components
// ---------------------------------------------------------------------------

describe('computeKnockback — baseMagnitude (percent-independent launch floor)', () => {
  const baseHit = (extra?: {
    baseMagnitude?: number;
    damageGrowth?: number;
  }): HitInfo => ({
    damage: 14,
    knockback: { x: 4.0, y: -1.5, scaling: 0.4, ...(extra ?? {}) },
    facing: 1,
  });

  it('moves WITHOUT the new fields produce byte-identical legacy math', () => {
    const hit = baseHit();
    const result = computeKnockback(hit, 60, BASELINE_MASS);
    const expectedMult = 1 + 0.4 * 60 * KNOCKBACK_PERCENT_TEMPER;
    expect(result.vector.x).toBeCloseTo(4.0 * expectedMult, 10);
    expect(result.vector.y).toBeCloseTo(-1.5 * expectedMult, 10);
  });

  it('adds the floor along the authored direction at 0 % (magnitudes sum exactly)', () => {
    const plain = computeKnockback(baseHit(), 0, BASELINE_MASS);
    const floored = computeKnockback(
      baseHit({ baseMagnitude: 1.2 }),
      0,
      BASELINE_MASS,
    );
    expect(floored.magnitude).toBeCloseTo(plain.magnitude + 1.2, 10);
  });

  it('preserves the launch angle (floor is collinear with the authored vector)', () => {
    const plain = computeKnockback(baseHit(), 80, BASELINE_MASS);
    const floored = computeKnockback(
      baseHit({ baseMagnitude: 1.2 }),
      80,
      BASELINE_MASS,
    );
    expect(floored.angle).toBeCloseTo(plain.angle, 10);
  });

  it('does NOT scale the floor by target mass (canonical `+ b` semantics)', () => {
    // Heavy target: the percent-scaled part shrinks by BASELINE/mass,
    // the floor arrives whole.
    const heavyMass = 24;
    const plainHeavy = computeKnockback(baseHit(), 0, heavyMass);
    const flooredHeavy = computeKnockback(
      baseHit({ baseMagnitude: 1.2 }),
      0,
      heavyMass,
    );
    expect(flooredHeavy.magnitude).toBeCloseTo(plainHeavy.magnitude + 1.2, 10);
  });

  it('mirrors the floor with the attacker facing', () => {
    const right = computeKnockback(
      baseHit({ baseMagnitude: 1.2 }),
      0,
      BASELINE_MASS,
    );
    const left = computeKnockback(
      { ...baseHit({ baseMagnitude: 1.2 }), facing: -1 },
      0,
      BASELINE_MASS,
    );
    expect(left.vector.x).toBeCloseTo(-right.vector.x, 10);
    expect(left.vector.y).toBeCloseTo(right.vector.y, 10);
  });

  it('raises hitstun at 0 % (the floor is what makes early hits combo-able)', () => {
    const plain = computeKnockback(baseHit(), 0, BASELINE_MASS);
    const floored = computeKnockback(
      baseHit({ baseMagnitude: 3.0 }),
      0,
      BASELINE_MASS,
    );
    expect(floored.hitstunFrames).toBeGreaterThanOrEqual(plain.hitstunFrames);
    expect(floored.hitstunFrames).toBe(
      Math.min(
        Math.max(
          Math.round(floored.magnitude * HITSTUN_FRAMES_PER_KNOCKBACK_UNIT),
          MIN_HITSTUN_FRAMES,
        ),
        120,
      ),
    );
  });
});

describe('computeKnockback — damageGrowth (damage-fed percent term)', () => {
  const hitWithGrowth = (damage: number, damageGrowth?: number): HitInfo => ({
    damage,
    knockback: {
      x: 4.0,
      y: -1.5,
      scaling: 0.4,
      ...(damageGrowth !== undefined ? { damageGrowth } : {}),
    },
    facing: 1,
  });

  it('is inert at 0 % (the growth term multiplies the percent)', () => {
    const plain = computeKnockback(hitWithGrowth(14), 0, BASELINE_MASS);
    const grown = computeKnockback(hitWithGrowth(14, 0.5), 0, BASELINE_MASS);
    expect(grown.magnitude).toBeCloseTo(plain.magnitude, 10);
  });

  it('amplifies knockback at percent proportionally to the move damage', () => {
    const plain = computeKnockback(hitWithGrowth(14), 100, BASELINE_MASS);
    const grown = computeKnockback(hitWithGrowth(14, 0.5), 100, BASELINE_MASS);
    // growth = 0.4·100·(1 + 0.5·14/20) = 40·1.35 vs 40 — a 1.35×
    // larger percent term.
    const expectedRatio =
      (1 + 0.4 * 100 * KNOCKBACK_PERCENT_TEMPER * 1.35) /
      (1 + 0.4 * 100 * KNOCKBACK_PERCENT_TEMPER);
    expect(grown.magnitude / plain.magnitude).toBeCloseTo(expectedRatio, 10);
  });

  it('keeps the launch angle invariant', () => {
    const plain = computeKnockback(hitWithGrowth(14), 100, BASELINE_MASS);
    const grown = computeKnockback(hitWithGrowth(14, 0.5), 100, BASELINE_MASS);
    expect(grown.angle).toBeCloseTo(plain.angle, 10);
  });

  it('a heavier-damage move out-scales a lighter one with the same scaling + growth', () => {
    const light = computeKnockback(hitWithGrowth(6, 0.5), 100, BASELINE_MASS);
    const heavy = computeKnockback(hitWithGrowth(22, 0.5), 100, BASELINE_MASS);
    expect(heavy.magnitude).toBeGreaterThan(light.magnitude);
  });
});
