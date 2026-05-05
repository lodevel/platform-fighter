/**
 * Per-fighter shield bubble overlay — AC 60401 Sub-AC 1 (visual half).
 *
 * Pinned to a fighter's body each render frame, this overlay paints the
 * Smash-style coloured "shield bubble" while the shield key is held and
 * a strobing red / cream "shatter" ring during the broken-state stun
 * lockout. The bubble's radius shrinks linearly with shield health so
 * the player can read at a glance how close they are to a break.
 *
 * Why this lives in `src/ui/` (not on `MatchScene`):
 *   • Single responsibility — `MatchScene.update` already manages
 *     physics, input, respawn, match-end, camera, damage HUD, FPS
 *     overlay, recording HUD, reconnect overlay, …; one more
 *     per-frame visual would make the file untenable. Pulling the
 *     bubble out keeps every overlay symmetrical.
 *   • Reusability — the M4 replay player and (eventually) the M3 stage
 *     builder preview share the same fighter visualisation pipeline;
 *     putting the bubble next to the damage HUD lets both reuse it.
 *   • Testability — Phaser-touching code is mockable through a thin
 *     scene shim; pure formatting (colour ramp / radius curve / strobe
 *     phase) lives in the sibling `shieldBubbleFormat.ts` so the unit
 *     suite runs in plain Node.
 *
 * Determinism note: this overlay is render-only. It reads the live
 * `ShieldState` snapshot + the simulated frame counter (for the strobe
 * phase) and updates Phaser graphics state — no Matter mutation, no
 * RNG reads. Replays paint identical bubbles because the underlying
 * shield states are themselves replay-deterministic.
 */

import type Phaser from 'phaser';
import {
  computeShieldBubbleVisual,
  type ShieldBubbleVisual,
} from './shieldBubbleFormat';
import type { ShieldState } from '../characters/shieldState';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Construction options for a single fighter's shield bubble. */
export interface ShieldBubbleOptions {
  /**
   * Body radius (viewport pixels). The bubble's outer radius starts a
   * small constant padding outside this for a healthy shield and
   * shrinks toward it as the shield drains.
   */
  readonly bodyRadius: number;
  /**
   * Resolved `maxHealth` from the fighter's shield tuning. Cached so
   * the overlay can normalise the live `health` into a 0..1 fraction
   * without poking back into the character.
   */
  readonly maxHealth: number;
  /**
   * Phaser depth at which the bubble is drawn. Defaults sit just
   * above the fighter sprite so the bubble visibly wraps the body
   * without occluding the percent HUD.
   */
  readonly depth?: number;
}

/**
 * Per-render-frame snapshot used to update a single bubble. Decoupled
 * from the live `Character` instance so the (future) replay player can
 * push a buffered snapshot without holding a fighter reference.
 */
export interface ShieldBubbleSnapshot {
  /** Live shield state machine snapshot. */
  readonly state: ShieldState;
  /** Centre point of the fighter's body in viewport coords. */
  readonly x: number;
  readonly y: number;
  /** Simulated physics frame counter — drives the broken-state strobe. */
  readonly frame: number;
}

// ---------------------------------------------------------------------------
// Internal — minimal scene + GameObject shim
// ---------------------------------------------------------------------------

/**
 * Narrow shape we actually call on `Phaser.GameObjects.Arc`. Keeping
 * the interface to just the methods we use lets the unit suite swap
 * in a hand-rolled fake without booting a Phaser game.
 */
export interface ShieldArcLike {
  setPosition(x: number, y: number): ShieldArcLike;
  setRadius(radius: number): ShieldArcLike;
  setFillStyle(color?: number, alpha?: number): ShieldArcLike;
  setStrokeStyle(width?: number, color?: number, alpha?: number): ShieldArcLike;
  setVisible(visible: boolean): ShieldArcLike;
  setDepth(depth: number): ShieldArcLike;
  setScrollFactor(x: number, y?: number): ShieldArcLike;
  destroy(): void;
}

/**
 * Narrow scene shim — only the `add.circle` factory the bubble needs.
 * The runtime concrete is `Phaser.Scene.add`, but the unit suite
 * satisfies it with a fake that produces a recordable Arc.
 */
export interface ShieldBubbleSceneShim {
  add: {
    circle(
      x: number,
      y: number,
      radius: number,
      fillColor?: number,
      fillAlpha?: number,
    ): ShieldArcLike;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Default Phaser depth for the bubble — above the fighter rectangle
 * (depth 0) so the outline is visible, but below HUD overlays
 * (typically depth 100+) so the percent meter / banner read on top.
 */
const DEFAULT_BUBBLE_DEPTH = 5;

/**
 * One shield bubble per fighter. Construct once per fighter at
 * scene-create; call `update(snapshot)` from the scene's render hook
 * each frame; call `destroy()` on scene shutdown.
 *
 * The bubble is implemented as a single `Phaser.GameObjects.Arc`
 * (a circle) whose radius / fill / stroke / visibility we mutate each
 * frame from {@link computeShieldBubbleVisual}. One Phaser object per
 * fighter keeps the per-frame cost trivial — for 4 active fighters
 * that's at worst 4 setter chains per render tick.
 */
export class ShieldBubble {
  private readonly arc: ShieldArcLike;
  private readonly maxHealth: number;
  private readonly bodyRadius: number;
  private readonly depth: number;
  private destroyed = false;

  constructor(scene: ShieldBubbleSceneShim, options: ShieldBubbleOptions) {
    this.maxHealth = options.maxHealth;
    this.bodyRadius = options.bodyRadius;
    this.depth = options.depth ?? DEFAULT_BUBBLE_DEPTH;

    // Construct the arc with a placeholder zero-alpha fill — `update`
    // will overwrite all visual properties on the first frame. Initial
    // position is (0, 0); the first `update` call repositions onto the
    // fighter's body before the arc is made visible.
    // procedural fallback — shield bubble drawn as a flat-fill
    // `Phaser.GameObjects.Arc` (circle). No CC0 shield sprite/atlas is
    // registered in `assets/manifest.ts`; the per-fighter palette
    // colours and the broken-state strobe are computed in
    // `shieldBubbleFormat.ts`. Replace by registering a shield texture
    // and swapping the Arc for an animated Sprite if a future art pass
    // ships one.
    this.arc = scene.add
      .circle(0, 0, Math.max(1, this.bodyRadius), 0x000000, 0)
      .setStrokeStyle(0, 0x000000, 0)
      .setVisible(false)
      .setDepth(this.depth);
  }

  /**
   * Push the latest shield state + position into the bubble. Called
   * once per render frame from the scene's render hook.
   *
   * Idempotent post-`destroy()` — a stale call after the bubble has
   * been torn down is silently ignored. This makes the eliminated-
   * fighter teardown path simple: destroy the bubble when the slot is
   * removed; any in-flight render-frame updates fall through.
   */
  update(snapshot: ShieldBubbleSnapshot): void {
    if (this.destroyed) return;
    const visual = computeShieldBubbleVisual({
      state: snapshot.state,
      maxHealth: this.maxHealth,
      bodyRadius: this.bodyRadius,
      frame: snapshot.frame,
    });
    this.applyVisual(snapshot.x, snapshot.y, visual);
  }

  /**
   * Apply a precomputed `ShieldBubbleVisual` to the underlying Arc.
   * Exposed primarily for tests / the (future) replay player's
   * scrub-to-frame path that may reconstruct the visual without going
   * through `update()`.
   */
  applyVisual(x: number, y: number, visual: ShieldBubbleVisual): void {
    if (this.destroyed) return;
    this.arc.setVisible(visual.visible);
    if (!visual.visible) return;
    this.arc.setPosition(x, y);
    // Phaser's Arc exposes `setRadius`; if we ever swap the GameObject
    // type the shim above is the single touch-point.
    this.arc.setRadius(Math.max(1, visual.radius));
    this.arc.setFillStyle(visual.fillColor, visual.fillAlpha);
    this.arc.setStrokeStyle(
      visual.strokeWidth,
      visual.strokeColor,
      visual.strokeAlpha,
    );
  }

  /** Hide the bubble without destroying its underlying GameObject. */
  hide(): void {
    if (this.destroyed) return;
    this.arc.setVisible(false);
  }

  /**
   * Tear down the underlying Phaser GameObject. Idempotent — safe to
   * call from both per-slot cleanup hooks and the scene's SHUTDOWN
   * listener.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.arc.destroy();
  }
}

/**
 * Construct a {@link ShieldBubble} on a real Phaser scene. Tiny
 * convenience that captures the cast from the scene's `add` namespace
 * down to {@link ShieldBubbleSceneShim} so the call site stays clean.
 */
export function createShieldBubble(
  scene: Phaser.Scene,
  options: ShieldBubbleOptions,
): ShieldBubble {
  return new ShieldBubble(scene as unknown as ShieldBubbleSceneShim, options);
}
