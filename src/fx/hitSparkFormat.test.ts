import { describe, it, expect } from 'vitest';
import {
  HIT_SPARK_COLOR_RAMP,
  HIT_SPARK_CORE_COLOR,
  HIT_SPARK_CORE_RADIUS_MAX,
  HIT_SPARK_CORE_RADIUS_MIN,
  HIT_SPARK_LIFETIME_FRAMES,
  HIT_SPARK_MAX_DAMAGE,
  HIT_SPARK_MIN_DAMAGE,
  HIT_SPARK_SHARD_COUNT,
  computeHitSparkVisual,
  hitSparkAlpha,
  hitSparkColor,
  hitSparkHash01,
  hitSparkIntensity,
  hitSparkProgress,
} from './hitSparkFormat';

/**
 * The hit spark's pure formatter is the single source of truth for
 * "what does the impact burst look like at this damage on this frame?".
 * The Phaser component applies the result verbatim. These tests pin the
 * derivations so a refactor of the colour ramp / radius curve / fade /
 * shard scatter can't drift past visual expectations silently — and so
 * the replay-determinism guarantee (no Math.random, hash-seeded shards)
 * stays enforced.
 */

describe('hitSparkFormat — hitSparkIntensity', () => {
  it('is 0 at/below the min-damage floor', () => {
    expect(hitSparkIntensity(HIT_SPARK_MIN_DAMAGE)).toBe(0);
    expect(hitSparkIntensity(0)).toBe(0);
    expect(hitSparkIntensity(-5)).toBe(0);
  });

  it('is 1 at/above the max-damage ceiling', () => {
    expect(hitSparkIntensity(HIT_SPARK_MAX_DAMAGE)).toBe(1);
    expect(hitSparkIntensity(HIT_SPARK_MAX_DAMAGE + 50)).toBe(1);
  });

  it('interpolates linearly between floor and ceiling', () => {
    const mid = (HIT_SPARK_MIN_DAMAGE + HIT_SPARK_MAX_DAMAGE) / 2;
    expect(hitSparkIntensity(mid)).toBeCloseTo(0.5, 5);
  });

  it('collapses NaN to 0', () => {
    expect(hitSparkIntensity(Number.NaN)).toBe(0);
  });
});

describe('hitSparkFormat — hitSparkColor', () => {
  it('returns the coolest (white) tint at zero intensity', () => {
    expect(hitSparkColor(0)).toBe(HIT_SPARK_COLOR_RAMP[0]!.color);
  });

  it('returns the hottest tint at full intensity', () => {
    const hottest = HIT_SPARK_COLOR_RAMP[HIT_SPARK_COLOR_RAMP.length - 1]!.color;
    expect(hitSparkColor(1)).toBe(hottest);
  });

  it('walks the ramp by threshold (mid bucket)', () => {
    // 0.5 sits in the >= 0.33 bucket but below 0.66.
    expect(hitSparkColor(0.5)).toBe(HIT_SPARK_COLOR_RAMP[1]!.color);
  });

  it('clamps out-of-range intensities', () => {
    expect(hitSparkColor(-1)).toBe(HIT_SPARK_COLOR_RAMP[0]!.color);
    expect(hitSparkColor(99)).toBe(
      HIT_SPARK_COLOR_RAMP[HIT_SPARK_COLOR_RAMP.length - 1]!.color,
    );
  });
});

describe('hitSparkFormat — hitSparkProgress & alpha', () => {
  it('progress runs 0 → 1 across the lifetime', () => {
    expect(hitSparkProgress(0)).toBe(0);
    expect(hitSparkProgress(HIT_SPARK_LIFETIME_FRAMES)).toBe(1);
    expect(hitSparkProgress(HIT_SPARK_LIFETIME_FRAMES / 2)).toBeCloseTo(0.5, 5);
  });

  it('alpha is brightest at spawn and fades to 0', () => {
    expect(hitSparkAlpha(0)).toBe(1);
    expect(hitSparkAlpha(1)).toBe(0);
    // Eased fade: at half-life alpha is still above the linear midpoint.
    expect(hitSparkAlpha(0.5)).toBeGreaterThan(0);
    expect(hitSparkAlpha(0.5)).toBeLessThan(1);
  });
});

describe('hitSparkFormat — hitSparkHash01 (deterministic scatter)', () => {
  it('is deterministic for identical (seed, index)', () => {
    expect(hitSparkHash01(7, 3)).toBe(hitSparkHash01(7, 3));
  });

  it('always returns a fraction in [0, 1)', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      for (let i = 0; i < HIT_SPARK_SHARD_COUNT; i += 1) {
        const v = hitSparkHash01(seed, i);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('varies across seeds and indices (well-spread)', () => {
    const a = hitSparkHash01(1, 0);
    const b = hitSparkHash01(2, 0);
    const c = hitSparkHash01(1, 1);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('hitSparkFormat — computeHitSparkVisual', () => {
  it('reports dead before spawn and after lifetime', () => {
    expect(computeHitSparkVisual({ damage: 10, age: -1, seed: 0 }).alive).toBe(false);
    expect(
      computeHitSparkVisual({
        damage: 10,
        age: HIT_SPARK_LIFETIME_FRAMES,
        seed: 0,
      }).alive,
    ).toBe(false);
    expect(
      computeHitSparkVisual({
        damage: 10,
        age: HIT_SPARK_LIFETIME_FRAMES + 5,
        seed: 0,
      }).alive,
    ).toBe(false);
  });

  it('is alive across its lifetime with a white-hot core', () => {
    const v = computeHitSparkVisual({ damage: 10, age: 0, seed: 0 });
    expect(v.alive).toBe(true);
    expect(v.core.color).toBe(HIT_SPARK_CORE_COLOR);
    expect(v.core.alpha).toBe(1); // brightest at spawn
  });

  it('emits exactly HIT_SPARK_SHARD_COUNT shards while alive', () => {
    const v = computeHitSparkVisual({ damage: 18, age: 2, seed: 99 });
    expect(v.shards).toHaveLength(HIT_SPARK_SHARD_COUNT);
  });

  it('scales the core radius up with damage', () => {
    const jab = computeHitSparkVisual({ damage: HIT_SPARK_MIN_DAMAGE, age: 4, seed: 0 });
    const smash = computeHitSparkVisual({ damage: HIT_SPARK_MAX_DAMAGE, age: 4, seed: 0 });
    expect(smash.core.radius).toBeGreaterThan(jab.core.radius);
    // Sanity bounds — peak radius respects the configured ramp.
    expect(smash.core.radius).toBeLessThanOrEqual(HIT_SPARK_CORE_RADIUS_MAX);
    expect(jab.core.radius).toBeGreaterThanOrEqual(HIT_SPARK_CORE_RADIUS_MIN * 0.4);
  });

  it('flings shards further out as the spark ages', () => {
    const seed = 42;
    const early = computeHitSparkVisual({ damage: 20, age: 1, seed });
    const late = computeHitSparkVisual({ damage: 20, age: HIT_SPARK_LIFETIME_FRAMES - 1, seed });
    const earlyDist = Math.hypot(early.shards[0]!.outerX, early.shards[0]!.outerY);
    const lateDist = Math.hypot(late.shards[0]!.outerX, late.shards[0]!.outerY);
    expect(lateDist).toBeGreaterThan(earlyDist);
  });

  it('is fully deterministic — identical input yields identical shards', () => {
    const a = computeHitSparkVisual({ damage: 13, age: 5, seed: 123 });
    const b = computeHitSparkVisual({ damage: 13, age: 5, seed: 123 });
    expect(a.shards).toEqual(b.shards);
    expect(a.core).toEqual(b.core);
  });

  it('different seeds scatter shards to different angles', () => {
    const a = computeHitSparkVisual({ damage: 13, age: 5, seed: 1 });
    const b = computeHitSparkVisual({ damage: 13, age: 5, seed: 2 });
    // At least one shard endpoint differs between the two seeds.
    const differs = a.shards.some(
      (s, i) => s.outerX !== b.shards[i]!.outerX || s.outerY !== b.shards[i]!.outerY,
    );
    expect(differs).toBe(true);
  });
});
