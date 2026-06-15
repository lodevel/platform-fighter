/**
 * Per-fighter melee SWING TRAIL overlay.
 *
 * Drawn along a held weapon's (sword / bat / hammer / spear) or a smash
 * finisher's active-frame hitbox sweep — a brief translucent arc / streak
 * that shows the path the weapon swept. Without it, a sword slash lands
 * damage with no visible blade arc (the user's "0 visual cue that we are
 * hitting with the sword" complaint). The trail is the visual companion
 * to the hit spark: the spark marks *where contact landed*, the trail
 * shows *the path the weapon travelled*.
 *
 * Why this lives in `src/fx/` (not on `MatchScene`):
 *   • Single responsibility — mirrors {@link ShieldBubble} /
 *     {@link ChargeIndicator} exactly: a thin Phaser layer (one
 *     `Phaser.GameObjects.Rectangle` per fighter) over a pure
 *     `swingTrailFormat.ts` formatter with its own vitest suite.
 *   • Geometry truthfulness — the trail's footprint is derived from the
 *     SAME `move.hitbox` (offset / width / height, mirrored by facing)
 *     the runtime spawns the real sensor from, so the streak never
 *     overstates the weapon's reach.
 *
 * Camera partition: the rectangle keeps its default `scrollFactor` of 1
 * — it tracks a swing in WORLD space, so the scene's HUD/world partition
 * rule (HUD iff `scrollFactor === 0`) leaves it on the world camera
 * automatically. We never call `setScrollFactor(0)`.
 *
 * Determinism note: render-only. The scene feeds the live active-attack
 * snapshot + the body position; no Matter mutation, no `Math.random()`.
 * Replays paint identical trails because the underlying attack frames
 * are themselves replay-deterministic.
 */

import type Phaser from 'phaser';
import {
  computeSwingTrailVisual,
  type SwingTrailInput,
} from './swingTrailFormat';

// ---------------------------------------------------------------------------
// Internal — minimal GameObject + scene shims
// ---------------------------------------------------------------------------

/** Narrow shape we call on the trail's `Phaser.GameObjects.Rectangle`. */
export interface SwingTrailRectLike {
  setPosition(x: number, y: number): SwingTrailRectLike;
  setSize(width: number, height: number): SwingTrailRectLike;
  setFillStyle(color?: number, alpha?: number): SwingTrailRectLike;
  setStrokeStyle(width?: number, color?: number, alpha?: number): SwingTrailRectLike;
  setVisible(visible: boolean): SwingTrailRectLike;
  setDepth(depth: number): SwingTrailRectLike;
  destroy(): void;
}

/** Narrow scene shim — only the `add.rectangle` factory the trail needs. */
export interface SwingTrailSceneShim {
  add: {
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      fillColor?: number,
      fillAlpha?: number,
    ): SwingTrailRectLike;
  };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-render-frame snapshot to update a single trail. The geometry +
 * classification fields mirror {@link SwingTrailInput}; `bodyX`/`bodyY`
 * is the attacker's live body centre (world space) the trail's
 * body-relative offset is added to.
 */
export interface SwingTrailSnapshot extends SwingTrailInput {
  readonly bodyX: number;
  readonly bodyY: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Depth for the trail — above the fighter sprite (0) / shield bubble (5)
 * / charge indicator (6) so the swing reads on top of the body, but
 * below the hit spark (8) so an impact pop layers over the sweep, and
 * below HUD overlays (100+).
 */
const SWING_TRAIL_DEPTH = 7;

/**
 * One swing trail per fighter. Construct once per fighter at
 * scene-create; call `update(snapshot)` from the scene's render hook
 * each frame; call `destroy()` on scene shutdown.
 *
 * Implemented as a single `Phaser.GameObjects.Rectangle` whose
 * position / size / colour / alpha / visibility we mutate each frame
 * from {@link computeSwingTrailVisual}. One Phaser object per fighter
 * keeps the per-frame cost trivial.
 */
export class SwingTrail {
  private readonly rect: SwingTrailRectLike;
  private readonly depth: number;
  private destroyed = false;

  constructor(scene: SwingTrailSceneShim, options?: { readonly depth?: number }) {
    this.depth = options?.depth ?? SWING_TRAIL_DEPTH;
    // Procedural fallback — no CC0 swing-VFX sprite/atlas is registered;
    // the trail is a flat-fill Rectangle on the hitbox footprint. The
    // colour ramp / fade are computed in `swingTrailFormat.ts`. Starts
    // invisible; the first `update` overwrites every visual property.
    this.rect = scene.add
      .rectangle(0, 0, 1, 1, 0xffffff, 0)
      .setStrokeStyle(0, 0xffffff, 0)
      .setVisible(false)
      .setDepth(this.depth);
  }

  /**
   * Push the latest active-attack snapshot + body position into the
   * trail. Called once per render frame. Idempotent post-`destroy()`.
   */
  update(snapshot: SwingTrailSnapshot): void {
    if (this.destroyed) return;
    const visual = computeSwingTrailVisual(snapshot);
    if (!visual.visible) {
      this.rect.setVisible(false);
      return;
    }
    this.rect.setVisible(true);
    this.rect.setPosition(
      snapshot.bodyX + visual.offsetX,
      snapshot.bodyY + visual.offsetY,
    );
    this.rect.setSize(Math.max(1, visual.width), Math.max(1, visual.height));
    this.rect.setFillStyle(visual.fillColor, visual.fillAlpha);
    this.rect.setStrokeStyle(
      visual.strokeWidth,
      visual.strokeColor,
      visual.strokeAlpha,
    );
  }

  /** Hide the trail without destroying its GameObject. */
  hide(): void {
    if (this.destroyed) return;
    this.rect.setVisible(false);
  }

  /**
   * Tear down the underlying Phaser GameObject. Idempotent — safe from
   * both per-slot cleanup hooks and the scene's SHUTDOWN listener.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.rect.destroy();
  }
}

/**
 * Construct a {@link SwingTrail} on a real Phaser scene. Tiny
 * convenience that captures the cast from the scene's `add` namespace
 * down to {@link SwingTrailSceneShim} so the call site stays clean.
 */
export function createSwingTrail(
  scene: Phaser.Scene,
  options?: { readonly depth?: number },
): SwingTrail {
  return new SwingTrail(scene as unknown as SwingTrailSceneShim, options);
}
