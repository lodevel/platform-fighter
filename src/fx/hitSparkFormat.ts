/**
 * Pure formatter helpers for the on-hit "hit spark" burst effect.
 *
 * When an attack lands, the defender's percent ticks up and their body
 * is launched — but with no impact effect at the contact point the hit
 * reads as "the number just changed for no visible reason". Smash-style
 * games paint a short, punchy burst (a flash + a few radial shards) at
 * the moment of contact, scaled and coloured by how hard the hit was: a
 * small white flash for a jab, a big orange / red star for a smash.
 * This module derives that burst entirely from the hit's damage value
 * and the spark's age in frames.
 *
 * Why a separate, pure-function module
 * ------------------------------------
 *
 *   • The Phaser-touching component (`HitSpark.ts`) imports Phaser,
 *     which pulls in browser globals at module-eval time. The colour
 *     ramp / radius curve / fade / shard-scatter derivations that need
 *     unit coverage live behind that import line — the same split the
 *     shield bubble, charge indicator, damage HUD, and FPS counter
 *     follow.
 *   • Determinism — every value here is a pure function of (damage,
 *     age-in-frames, a per-hit integer seed). No `Math.random()`, no
 *     `Date.now()`. The shard scatter is derived from a small hashed
 *     PRNG seeded by `frame + attackerIndex` (supplied by the scene),
 *     NOT a live RNG read, so a replayed match paints identical sparks
 *     on identical frames. The spark is render-only — it never feeds
 *     back into the simulation — but we keep it replay-stable anyway so
 *     a recording and its playback look pixel-identical.
 *
 * Boundaries
 * ----------
 *
 *   • Pure presentation. The formatter never mutates anything — it maps
 *     `(damage, age, seed)` to flat visual properties the Phaser layer
 *     applies verbatim.
 *   • Frame-driven lifetime — the spark lives a small, fixed number of
 *     frames ({@link HIT_SPARK_LIFETIME_FRAMES}) and the scene advances
 *     its age off the simulated frame counter, never a wall clock.
 */

// ---------------------------------------------------------------------------
// Tuning constants (frozen)
// ---------------------------------------------------------------------------

/**
 * Lifetime of a single hit spark, in simulated frames. Short and punchy
 * — long enough to read as an impact (~12 frames ≈ 200 ms at 60 Hz),
 * short enough that rapid multi-hits each get their own legible pop
 * instead of smearing into a blob.
 */
export const HIT_SPARK_LIFETIME_FRAMES = 12;

/**
 * Number of radial shards drawn around the central flash. A handful of
 * short streaks reading as "impact debris" — enough to feel like a
 * burst, few enough to stay cheap (one Phaser object per shard per
 * live spark).
 */
export const HIT_SPARK_SHARD_COUNT = 6;

/**
 * Damage value (percent) treated as the top of the spark's intensity
 * ramp. A hit at or above this damage paints the biggest, hottest,
 * fastest-flung burst; lighter hits interpolate down toward the floor.
 * Tuned to the heavy end of the roster's smash damage so a full smash
 * reads as "maximum crunch".
 */
export const HIT_SPARK_MAX_DAMAGE = 22;

/**
 * Damage value (percent) at the bottom of the intensity ramp — a jab /
 * light poke. Hits below this still paint a (minimum-size) flash so
 * even chip damage has a visible cue.
 */
export const HIT_SPARK_MIN_DAMAGE = 2;

/** Core flash radius (px) at the minimum-intensity (jab) end. */
export const HIT_SPARK_CORE_RADIUS_MIN = 8;

/** Core flash radius (px) at the maximum-intensity (smash) end. */
export const HIT_SPARK_CORE_RADIUS_MAX = 26;

/** Shard length (px) at the minimum-intensity end. */
export const HIT_SPARK_SHARD_LEN_MIN = 10;

/** Shard length (px) at the maximum-intensity end. */
export const HIT_SPARK_SHARD_LEN_MAX = 40;

/** Shard line thickness (px) at the minimum-intensity end. */
export const HIT_SPARK_SHARD_WIDTH_MIN = 2;

/** Shard line thickness (px) at the maximum-intensity end. */
export const HIT_SPARK_SHARD_WIDTH_MAX = 5;

/**
 * Three-stop colour ramp keyed to hit intensity (0..1). The ramp is
 * walked once at draw-time; the highest threshold whose value is `<=`
 * the intensity wins. `threshold: 0` is the catch-all so a zero-damage
 * spark still resolves to a colour.
 *
 *   ≥ 0.66 → hot red-orange   (a heavy smash)
 *   ≥ 0.33 → amber            (a tilt / mid hit)
 *   ≥ 0    → near-white       (a jab / light poke)
 */
export const HIT_SPARK_COLOR_RAMP: ReadonlyArray<{
  readonly thresholdIntensity: number;
  readonly color: number;
}> = Object.freeze([
  Object.freeze({ thresholdIntensity: 0, color: 0xffffff }),
  Object.freeze({ thresholdIntensity: 0.33, color: 0xffd24d }),
  Object.freeze({ thresholdIntensity: 0.66, color: 0xff5a2a }),
]);

/**
 * Core flash colour — always a bright near-white so the centre of the
 * burst "blows out" regardless of the hit's intensity tint (which
 * colours the shards + the flash's outer alpha falloff). Mirrors how a
 * bright impact flash reads as white-hot at its core.
 */
export const HIT_SPARK_CORE_COLOR = 0xffffff;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-render-frame input to the spark formatter.
 *
 *   • `damage`  — the hit's damage value (percent). Drives the
 *                 intensity ramp (size / colour / shard fling).
 *   • `age`     — frames elapsed since the spark was spawned (0 on the
 *                 spawn frame). Drives the expand-then-fade curve.
 *   • `seed`    — a small non-negative integer derived by the scene
 *                 from `frame + attackerIndex` (NOT a live RNG read).
 *                 Deterministically scatters the shard angles so two
 *                 sparks on the same frame don't look like identical
 *                 stamps, while a replay reproduces them exactly.
 */
export interface HitSparkInput {
  readonly damage: number;
  readonly age: number;
  readonly seed: number;
}

/** Visual properties for the central flash for a single frame. */
export interface HitSparkCoreVisual {
  /** Outer radius of the core flash arc (px). */
  readonly radius: number;
  /** Fill colour (0xRRGGBB). */
  readonly color: number;
  /** Fill alpha (0..1) — fades to 0 over the lifetime. */
  readonly alpha: number;
}

/** Visual properties for a single radial shard for a single frame. */
export interface HitSparkShardVisual {
  /**
   * Inner endpoint of the shard, relative to the spark centre (px).
   * Shards fling outward over the lifetime, so the inner end drifts
   * away from centre as the spark ages.
   */
  readonly innerX: number;
  readonly innerY: number;
  /** Outer endpoint of the shard, relative to the spark centre (px). */
  readonly outerX: number;
  readonly outerY: number;
  /** Stroke colour (0xRRGGBB). */
  readonly color: number;
  /** Stroke alpha (0..1) — fades to 0 over the lifetime. */
  readonly alpha: number;
  /** Stroke thickness (px). */
  readonly width: number;
}

/** Full per-frame visual for a hit spark — a core flash + N shards. */
export interface HitSparkVisual {
  /** True while the spark is still within its lifetime. */
  readonly alive: boolean;
  readonly core: HitSparkCoreVisual;
  readonly shards: ReadonlyArray<HitSparkShardVisual>;
}

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

/** Clamp a number to `[lo, hi]`, collapsing non-finite input to `lo`. */
function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** Linear interpolation from `a` to `b` by `t` (t already clamped 0..1). */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Map a hit's damage to a `0..1` intensity. Below
 * {@link HIT_SPARK_MIN_DAMAGE} → 0; at / above {@link HIT_SPARK_MAX_DAMAGE}
 * → 1; linear between. A jab reads as a faint flash, a smash as a full
 * burst.
 */
export function hitSparkIntensity(damage: number): number {
  const d = clamp(damage, 0, Number.MAX_SAFE_INTEGER);
  const span = HIT_SPARK_MAX_DAMAGE - HIT_SPARK_MIN_DAMAGE;
  if (span <= 0) return 1;
  return clamp((d - HIT_SPARK_MIN_DAMAGE) / span, 0, 1);
}

/**
 * Pick the shard / flash tint for a given intensity from the colour
 * ramp. Walks the ramp once (3 entries — O(1)) and returns the highest
 * threshold whose `thresholdIntensity <= intensity`.
 */
export function hitSparkColor(intensity: number): number {
  const f = clamp(intensity, 0, 1);
  let chosen = HIT_SPARK_COLOR_RAMP[0]!.color;
  for (const entry of HIT_SPARK_COLOR_RAMP) {
    if (f >= entry.thresholdIntensity) {
      chosen = entry.color;
    } else {
      break;
    }
  }
  return chosen;
}

/**
 * Normalised lifetime progress `0..1` from an age in frames. Clamped so
 * an age past the lifetime resolves to 1 (the spark is done).
 */
export function hitSparkProgress(age: number): number {
  const a = clamp(age, 0, HIT_SPARK_LIFETIME_FRAMES);
  if (HIT_SPARK_LIFETIME_FRAMES <= 0) return 1;
  return a / HIT_SPARK_LIFETIME_FRAMES;
}

/**
 * Alpha envelope over the spark's life: a fast pop-in over the first
 * couple of frames then a smooth fade to zero. Implemented as
 * `1 - progress` with a tiny ease so the spark is brightest right at
 * impact and gone by the end of its lifetime — exactly when the Phaser
 * layer recycles it.
 */
export function hitSparkAlpha(progress: number): number {
  const p = clamp(progress, 0, 1);
  // `(1 - p)^2` eases the fade so the spark lingers a touch brighter
  // early (the impact "snap") then drops off fast — reads punchier
  // than a flat linear fade.
  const fade = 1 - p;
  return fade * fade;
}

/**
 * Tiny deterministic hash → `0..1` PRNG. Mixes a base seed with a per-
 * shard index so each shard gets a stable pseudo-random angle jitter
 * without a live `Math.random()` read. The constants are the standard
 * "xorshift-ish integer hash" multipliers; we only need a well-spread
 * fractional output, not cryptographic quality.
 *
 * Determinism: a pure integer hash. Identical `(seed, index)` always
 * returns the identical fraction, so a replay reproduces every shard
 * angle exactly.
 */
export function hitSparkHash01(seed: number, index: number): number {
  // Fold the inputs into a 32-bit integer, then bit-mix. `| 0` and
  // `>>> 0` keep the math in well-defined 32-bit integer territory so
  // the output is identical across engines.
  let h = (Math.floor(seed) * 374761393 + index * 668265263) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = (h * 1274126177) | 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * Compute the full per-frame visual for a hit spark. The Phaser layer
 * applies the result verbatim — no further math at the render layer.
 *
 *   • The core flash expands quickly from a small disc to its peak
 *     radius then holds while the alpha fades — a classic "impact pop".
 *   • Each shard is a short line flung radially outward; the fling
 *     distance grows with both intensity (harder hits throw further)
 *     and lifetime progress (the burst spreads as it ages). Shard
 *     angles are evenly spaced around the circle plus a deterministic
 *     per-shard jitter so the star doesn't read as a rigid asterisk.
 *
 * Returns `alive: false` (with zeroed visuals) once the age exceeds the
 * lifetime so the Phaser layer can recycle the spark.
 */
export function computeHitSparkVisual(input: HitSparkInput): HitSparkVisual {
  const { damage, age, seed } = input;

  const dead = !Number.isFinite(age) || age < 0 || age >= HIT_SPARK_LIFETIME_FRAMES;
  if (dead) {
    return {
      alive: false,
      core: { radius: 0, color: HIT_SPARK_CORE_COLOR, alpha: 0 },
      shards: [],
    };
  }

  const intensity = hitSparkIntensity(damage);
  const progress = hitSparkProgress(age);
  const alpha = hitSparkAlpha(progress);
  const tint = hitSparkColor(intensity);

  // Core flash — expand over the first ~third of the life, then hold at
  // peak radius while the alpha carries the fade.
  const peakRadius = lerp(
    HIT_SPARK_CORE_RADIUS_MIN,
    HIT_SPARK_CORE_RADIUS_MAX,
    intensity,
  );
  const expand = clamp(progress / 0.35, 0, 1);
  const coreRadius = peakRadius * lerp(0.4, 1, expand);

  const core: HitSparkCoreVisual = {
    radius: coreRadius,
    color: HIT_SPARK_CORE_COLOR,
    alpha,
  };

  // Shards — evenly spaced spokes flung outward. The fling distance
  // grows with intensity and progress; the inner end trails the outer
  // end so each shard reads as a streak rather than a dot.
  const shardLen = lerp(
    HIT_SPARK_SHARD_LEN_MIN,
    HIT_SPARK_SHARD_LEN_MAX,
    intensity,
  );
  const shardWidth = lerp(
    HIT_SPARK_SHARD_WIDTH_MIN,
    HIT_SPARK_SHARD_WIDTH_MAX,
    intensity,
  );
  // Total radial fling of the streak's centre from the spark origin.
  const fling = lerp(coreRadius, coreRadius + shardLen * 2, progress);

  const shards: HitSparkShardVisual[] = [];
  for (let i = 0; i < HIT_SPARK_SHARD_COUNT; i += 1) {
    const baseAngle = (i / HIT_SPARK_SHARD_COUNT) * Math.PI * 2;
    // Deterministic per-shard jitter of up to ±(half a slice) so the
    // star isn't a rigid asterisk. Seeded by the per-hit seed.
    const jitter = (hitSparkHash01(seed, i) - 0.5) * (Math.PI / HIT_SPARK_SHARD_COUNT);
    const angle = baseAngle + jitter;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const outer = fling + shardLen * 0.5;
    const inner = fling - shardLen * 0.5;
    shards.push({
      innerX: cos * inner,
      innerY: sin * inner,
      outerX: cos * outer,
      outerY: sin * outer,
      color: tint,
      alpha,
      width: shardWidth,
    });
  }

  return { alive: true, core, shards };
}
