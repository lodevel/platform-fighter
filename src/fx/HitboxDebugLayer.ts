/**
 * F3 hitbox debug overlay — a toggleable diagnostic visualisation.
 *
 * Draws the collision geometry the simulation actually uses so a
 * developer can SEE what they're tuning:
 *
 *   • active attack hitboxes — red translucent rects (mirrored by
 *     facing, derived from the REAL spawn geometry).
 *   • each fighter's hurtbox / body — green outline.
 *   • active grab ranges — yellow, while a grab's range sensor is live.
 *
 * It is a pure visualisation — no simulation effect. A single
 * `Phaser.GameObjects.Graphics` is redrawn each frame while the overlay
 * is enabled and cleared when disabled.
 *
 * Why this lives in `src/fx/` (not on `MatchScene`):
 *   • Single responsibility — the box-derivation logic lives in the pure
 *     `hitboxDebugFormat.ts` (its own vitest suite); this is the thin
 *     Phaser layer that strokes / fills the resolved boxes. Same split
 *     as every other overlay.
 *
 * Camera partition: the Graphics object keeps its default `scrollFactor`
 * of 1 — the boxes are drawn in WORLD space (a fighter's body /
 * hitbox), so the scene's HUD/world partition rule (HUD iff
 * `scrollFactor === 0`) leaves it on the world camera automatically. We
 * never call `setScrollFactor(0)`. (The "F3: hitboxes" hint text the
 * scene draws separately IS a HUD element — that's a scene concern.)
 *
 * Determinism note: render-only. It reads body positions + authored
 * geometry + facing and strokes a Graphics object — no Matter mutation,
 * no `Math.random()`.
 */

import type Phaser from 'phaser';
import {
  computeFighterDebugBoxes,
  type HitboxDebugBox,
  type HitboxDebugFighterSnapshot,
} from './hitboxDebugFormat';

// ---------------------------------------------------------------------------
// Internal — minimal Graphics + scene shims
// ---------------------------------------------------------------------------

/** Narrow shape we call on the `Phaser.GameObjects.Graphics`. */
export interface HitboxDebugGraphicsLike {
  clear(): HitboxDebugGraphicsLike;
  fillStyle(color: number, alpha?: number): HitboxDebugGraphicsLike;
  lineStyle(width: number, color: number, alpha?: number): HitboxDebugGraphicsLike;
  fillRect(x: number, y: number, w: number, h: number): HitboxDebugGraphicsLike;
  strokeRect(x: number, y: number, w: number, h: number): HitboxDebugGraphicsLike;
  setVisible(visible: boolean): HitboxDebugGraphicsLike;
  setDepth(depth: number): HitboxDebugGraphicsLike;
  destroy(): void;
}

/** Narrow scene shim — only the `add.graphics` factory the layer needs. */
export interface HitboxDebugSceneShim {
  add: {
    graphics(config?: unknown): HitboxDebugGraphicsLike;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Depth for the debug layer — above the hit spark (8) so the truthful
 * collision boxes read on top of every world-space effect, but below
 * HUD overlays (100+) so the percent meter / banners stay legible. A
 * developer toggling F3 wants the boxes to dominate the world render.
 */
const HITBOX_DEBUG_DEPTH = 50;

/**
 * The F3 hitbox debug overlay. Construct once per match at
 * scene-create; call {@link setEnabled} from the F3 key handler; call
 * {@link render} once per render frame (it's a cheap no-op while
 * disabled); call {@link destroy} on scene shutdown.
 *
 * One `Graphics` object for the whole overlay — every fighter's boxes
 * are batched into a single redraw per frame, so the per-frame cost is
 * one `clear()` + a handful of `fillRect`/`strokeRect` calls.
 */
export class HitboxDebugLayer {
  private readonly gfx: HitboxDebugGraphicsLike;
  private enabled = false;
  private destroyed = false;

  constructor(scene: HitboxDebugSceneShim, options?: { readonly depth?: number }) {
    this.gfx = scene.add
      .graphics()
      .setDepth(options?.depth ?? HITBOX_DEBUG_DEPTH)
      .setVisible(false);
  }

  /** Whether the overlay is currently drawing. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable / disable the overlay. Disabling clears the Graphics so no
   * stale boxes linger. Returns the new enabled state (so the F3 toggle
   * can read it back for the hint label).
   */
  setEnabled(enabled: boolean): boolean {
    if (this.destroyed) return false;
    this.enabled = enabled;
    this.gfx.setVisible(enabled);
    if (!enabled) this.gfx.clear();
    return this.enabled;
  }

  /** Flip the enabled state. Returns the new state. */
  toggle(): boolean {
    return this.setEnabled(!this.enabled);
  }

  /**
   * Redraw the overlay for one frame from the per-fighter snapshots.
   * A cheap no-op while disabled (no `clear`, no box derivation). Each
   * call fully replaces the previous frame's boxes so a fighter whose
   * attack ended this frame leaves no ghost rect behind.
   */
  render(snapshots: ReadonlyArray<HitboxDebugFighterSnapshot>): void {
    if (this.destroyed || !this.enabled) return;
    this.gfx.clear();
    for (const snapshot of snapshots) {
      const boxes = computeFighterDebugBoxes(snapshot);
      for (const box of boxes) this.drawBox(box);
    }
  }

  /**
   * Tear down the underlying Graphics. Idempotent — safe from both a
   * per-match cleanup hook and the scene's SHUTDOWN listener.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.gfx.destroy();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Fill (if any) + stroke a single resolved box at its world centre. */
  private drawBox(box: HitboxDebugBox): void {
    const left = box.x - box.width / 2;
    const top = box.y - box.height / 2;
    if (box.fillAlpha > 0) {
      this.gfx.fillStyle(box.color, box.fillAlpha);
      this.gfx.fillRect(left, top, box.width, box.height);
    }
    if (box.strokeAlpha > 0 && box.strokeWidth > 0) {
      this.gfx.lineStyle(box.strokeWidth, box.strokeColor, box.strokeAlpha);
      this.gfx.strokeRect(left, top, box.width, box.height);
    }
  }
}

/**
 * Construct a {@link HitboxDebugLayer} on a real Phaser scene. Tiny
 * convenience that captures the cast from the scene's `add` namespace
 * down to {@link HitboxDebugSceneShim} so the call site stays clean.
 */
export function createHitboxDebugLayer(
  scene: Phaser.Scene,
  options?: { readonly depth?: number },
): HitboxDebugLayer {
  return new HitboxDebugLayer(
    scene as unknown as HitboxDebugSceneShim,
    options,
  );
}
