/**
 * On-hit "hit spark" burst effect — the contact feedback for landed
 * attacks.
 *
 * When a hitbox connects, the scene spawns a short-lived burst at the
 * contact point: a bright expanding core flash plus a few radial shards
 * flung outward, scaled and coloured by the hit's damage (a small white
 * flash for a jab → a big orange / red star for a smash). Without it,
 * the defender's percent meter just ticks up with no visible cause — the
 * user's "0 visual cue we are hitting" complaint.
 *
 * Why this lives in `src/fx/` (not on `MatchScene`):
 *   • Single responsibility — `MatchScene.update` already manages
 *     physics, input, respawn, camera, every HUD overlay, the shield
 *     bubble, the charge indicator…; pulling each visual effect out
 *     keeps the scene readable. This component mirrors {@link ShieldBubble}
 *     / {@link ChargeIndicator} exactly: a thin Phaser layer over a pure
 *     `hitSparkFormat.ts` formatter with its own vitest suite.
 *   • Pooling — sparks are spawned in bursts (a multi-hit move, a
 *     crowded FFA) and must not leak Phaser GameObjects. The pool below
 *     recycles a fixed set of arc + line objects so the per-frame and
 *     per-spawn cost is bounded.
 *
 * Camera partition: the spark's GameObjects keep their default
 * `scrollFactor` of 1 — they sit at a contact point in WORLD space, so
 * the scene's HUD/world partition rule (HUD iff `scrollFactor === 0`)
 * leaves them on the world camera automatically. We never call
 * `setScrollFactor(0)`.
 *
 * Determinism note: this overlay is render-only. The scene advances each
 * spark's age off the simulated frame counter and the shard scatter is
 * seeded by `frame + attackerIndex` (a deterministic integer, NOT a live
 * RNG read), so a replayed match paints identical sparks on identical
 * frames. No Matter mutation, no `Math.random()`.
 */

import type Phaser from 'phaser';
import {
  computeHitSparkVisual,
  HIT_SPARK_LIFETIME_FRAMES,
  HIT_SPARK_SHARD_COUNT,
} from './hitSparkFormat';

// ---------------------------------------------------------------------------
// Internal — minimal GameObject + scene shims
// ---------------------------------------------------------------------------

/** Narrow shape we call on the spark's core `Phaser.GameObjects.Arc`. */
export interface HitSparkArcLike {
  setPosition(x: number, y: number): HitSparkArcLike;
  setRadius(radius: number): HitSparkArcLike;
  setFillStyle(color?: number, alpha?: number): HitSparkArcLike;
  setVisible(visible: boolean): HitSparkArcLike;
  setDepth(depth: number): HitSparkArcLike;
  destroy(): void;
}

/** Narrow shape we call on each shard `Phaser.GameObjects.Line`. */
export interface HitSparkLineLike {
  setTo(x1: number, y1: number, x2: number, y2: number): HitSparkLineLike;
  setPosition(x: number, y: number): HitSparkLineLike;
  setStrokeStyle(width?: number, color?: number, alpha?: number): HitSparkLineLike;
  setVisible(visible: boolean): HitSparkLineLike;
  setDepth(depth: number): HitSparkLineLike;
  setLineWidth(width: number): HitSparkLineLike;
  destroy(): void;
}

/**
 * Narrow scene shim — only the `add.circle` / `add.line` factories the
 * spark needs. The runtime concrete is `Phaser.Scene.add`; the unit
 * suite satisfies it with a fake that produces recordable arcs / lines.
 */
export interface HitSparkSceneShim {
  add: {
    circle(
      x: number,
      y: number,
      radius: number,
      fillColor?: number,
      fillAlpha?: number,
    ): HitSparkArcLike;
    line(
      x: number,
      y: number,
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      color?: number,
      alpha?: number,
    ): HitSparkLineLike;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Depth for the spark — above the fighter sprites / shield bubble /
 * charge indicator (depths 0-7) so the impact pop reads on top of the
 * bodies, but below HUD overlays (depth 100+) so the percent meter /
 * banners stay legible.
 */
const HIT_SPARK_DEPTH = 8;

/**
 * Default cap on simultaneously-live sparks. A burst that would exceed
 * the cap recycles the OLDEST live spark — so a frantic multi-hit
 * exchange never grows the pool unbounded. 24 covers a dense 4-fighter
 * FFA's worst-case simultaneous connects with headroom.
 */
const DEFAULT_MAX_LIVE_SPARKS = 24;

/** One pooled spark instance — a core arc + a fixed set of shard lines. */
interface PooledSpark {
  readonly core: HitSparkArcLike;
  readonly shards: HitSparkLineLike[];
  /** World-space contact point this spark was spawned at. */
  x: number;
  y: number;
  /** Hit damage — drives the intensity ramp. */
  damage: number;
  /** Deterministic per-hit shard-scatter seed. */
  seed: number;
  /** Simulated frame the spark was spawned on (age = now - spawnFrame). */
  spawnFrame: number;
  /** True while within its lifetime. */
  live: boolean;
}

/**
 * A pool of hit sparks. Construct once per match at scene-create; call
 * {@link spawn} from the damage-resolution path when an attack connects;
 * call {@link update} once per render frame to advance + recycle live
 * sparks; call {@link destroy} on scene shutdown.
 *
 * Each pooled spark owns one core `Arc` plus {@link HIT_SPARK_SHARD_COUNT}
 * shard `Line`s, allocated lazily on first use and reused thereafter —
 * so a long match never grows the GameObject count past
 * `maxLiveSparks * (1 + shardCount)`.
 */
export class HitSparkPool {
  private readonly scene: HitSparkSceneShim;
  private readonly depth: number;
  private readonly maxLive: number;
  private readonly pool: PooledSpark[] = [];
  private destroyed = false;

  constructor(
    scene: HitSparkSceneShim,
    options?: { readonly depth?: number; readonly maxLiveSparks?: number },
  ) {
    this.scene = scene;
    this.depth = options?.depth ?? HIT_SPARK_DEPTH;
    this.maxLive = Math.max(1, options?.maxLiveSparks ?? DEFAULT_MAX_LIVE_SPARKS);
  }

  /**
   * Spawn a hit spark at a world-space contact point.
   *
   *   • `x` / `y`   — contact point, world coords.
   *   • `damage`    — the hit's damage (intensity ramp).
   *   • `seed`      — deterministic per-hit integer (the scene derives
   *                   it from `frame + attackerIndex`, NOT a live RNG
   *                   read) so the shard scatter is replay-stable.
   *   • `frame`     — the simulated frame the hit landed on; the spark's
   *                   age is measured against this.
   *
   * Recycles a free pooled spark, or (if every pooled spark is live and
   * the cap is hit) the oldest live one. Idempotent post-`destroy()`.
   */
  spawn(x: number, y: number, damage: number, seed: number, frame: number): void {
    if (this.destroyed) return;
    const spark = this.acquire();
    spark.x = x;
    spark.y = y;
    spark.damage = damage;
    spark.seed = seed;
    spark.spawnFrame = frame;
    spark.live = true;
    // Paint the first frame immediately so a spark spawned on the same
    // tick as the render pass isn't invisible for a frame.
    this.applyToSpark(spark, frame);
  }

  /**
   * Advance every live spark to `frame` and recycle any that have
   * outlived {@link HIT_SPARK_LIFETIME_FRAMES}. Called once per render
   * frame from the scene's render hook. Idempotent post-`destroy()`.
   */
  update(frame: number): void {
    if (this.destroyed) return;
    for (const spark of this.pool) {
      if (!spark.live) continue;
      this.applyToSpark(spark, frame);
    }
  }

  /** Number of currently-live sparks. Exposed for tests. */
  liveCount(): number {
    let n = 0;
    for (const spark of this.pool) if (spark.live) n += 1;
    return n;
  }

  /** Total pooled sparks (live + recycled). Exposed for tests. */
  poolSize(): number {
    return this.pool.length;
  }

  /**
   * Hide every live spark without destroying the pool. Used when a
   * match freezes (KO cinematic) so stale bursts don't hang in the air.
   */
  clear(): void {
    if (this.destroyed) return;
    for (const spark of this.pool) {
      if (!spark.live) continue;
      spark.live = false;
      this.hideSpark(spark);
    }
  }

  /**
   * Tear down every pooled GameObject. Idempotent — safe from both a
   * per-match cleanup hook and the scene's SHUTDOWN listener.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const spark of this.pool) {
      spark.core.destroy();
      for (const shard of spark.shards) shard.destroy();
    }
    this.pool.length = 0;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Grab a free pooled spark, allocate a new one, or recycle the oldest. */
  private acquire(): PooledSpark {
    for (const spark of this.pool) {
      if (!spark.live) return spark;
    }
    if (this.pool.length < this.maxLive) {
      const spark = this.allocate();
      this.pool.push(spark);
      return spark;
    }
    // Every pooled spark is live and we're at the cap — recycle the
    // oldest (smallest spawnFrame) so the freshest hits always show.
    let oldest = this.pool[0]!;
    for (const spark of this.pool) {
      if (spark.spawnFrame < oldest.spawnFrame) oldest = spark;
    }
    return oldest;
  }

  /** Allocate a fresh pooled spark's GameObjects (all initially hidden). */
  private allocate(): PooledSpark {
    const core = this.scene.add
      .circle(0, 0, 1, 0xffffff, 0)
      .setVisible(false)
      .setDepth(this.depth);
    const shards: HitSparkLineLike[] = [];
    for (let i = 0; i < HIT_SPARK_SHARD_COUNT; i += 1) {
      const line = this.scene.add
        .line(0, 0, 0, 0, 0, 0, 0xffffff, 0)
        .setVisible(false)
        .setDepth(this.depth);
      shards.push(line);
    }
    return {
      core,
      shards,
      x: 0,
      y: 0,
      damage: 0,
      seed: 0,
      spawnFrame: 0,
      live: false,
    };
  }

  /** Recompute + apply a spark's visual for the given simulated frame. */
  private applyToSpark(spark: PooledSpark, frame: number): void {
    const age = frame - spark.spawnFrame;
    const visual = computeHitSparkVisual({
      damage: spark.damage,
      age,
      seed: spark.seed,
    });
    if (!visual.alive) {
      spark.live = false;
      this.hideSpark(spark);
      return;
    }
    spark.core.setVisible(true);
    spark.core.setPosition(spark.x, spark.y);
    spark.core.setRadius(Math.max(0.5, visual.core.radius));
    spark.core.setFillStyle(visual.core.color, visual.core.alpha);

    for (let i = 0; i < spark.shards.length; i += 1) {
      const shardVisual = visual.shards[i];
      const line = spark.shards[i]!;
      if (!shardVisual) {
        line.setVisible(false);
        continue;
      }
      line.setVisible(true);
      // A `Phaser.GameObjects.Line`'s geometry is local; anchor the
      // object at the contact point and express the streak endpoints
      // relative to it (the format module already returns body-relative
      // shard endpoints).
      line.setPosition(spark.x, spark.y);
      line.setTo(
        shardVisual.innerX,
        shardVisual.innerY,
        shardVisual.outerX,
        shardVisual.outerY,
      );
      line.setLineWidth(Math.max(0.5, shardVisual.width));
      line.setStrokeStyle(
        Math.max(0.5, shardVisual.width),
        shardVisual.color,
        shardVisual.alpha,
      );
    }
  }

  /** Hide a spark's core + every shard (recycle / freeze path). */
  private hideSpark(spark: PooledSpark): void {
    spark.core.setVisible(false);
    for (const shard of spark.shards) shard.setVisible(false);
  }
}

/**
 * Construct a {@link HitSparkPool} on a real Phaser scene. Tiny
 * convenience that captures the cast from the scene's `add` namespace
 * down to {@link HitSparkSceneShim} so the call site stays clean.
 */
export function createHitSparkPool(
  scene: Phaser.Scene,
  options?: { readonly depth?: number; readonly maxLiveSparks?: number },
): HitSparkPool {
  return new HitSparkPool(scene as unknown as HitSparkSceneShim, options);
}

export { HIT_SPARK_LIFETIME_FRAMES };
