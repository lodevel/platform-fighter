/**
 * Per-fighter charge / wind-up indicator overlay.
 *
 * Pinned to a fighter's body each render frame, this overlay paints a
 * procedural "charging" effect while the fighter is winding a move up
 * (Falcon-Punch-style neutral specials, smash finishers, the heavy
 * hammer swing). Because the generic fighter sprites have no bespoke
 * charge-animation frames, the wind-up is communicated entirely through
 * an effect built from primitive Phaser GameObjects:
 *
 *   • A pulsing coloured **aura ring** (a `Phaser.GameObjects.Arc`)
 *     around the body that brightens and ramps cool → hot (white →
 *     yellow → orange → red) as the swing charges, blinking faster the
 *     closer it is to release.
 *   • A thin **charge bar** above the fighter's head (two
 *     `Phaser.GameObjects.Rectangle`s — an empty track plus a fill)
 *     whose fill width tracks the charge fraction.
 *
 * Why this lives in `src/ui/` (not on `MatchScene`):
 *   • Single responsibility — `MatchScene.update` already manages
 *     physics, input, respawn, camera, the damage HUD, the shield
 *     bubble, …; pulling each per-frame overlay out keeps them
 *     symmetrical. This component mirrors {@link ShieldBubble} exactly.
 *   • Testability — Phaser-touching code is mockable through a thin
 *     scene shim; the pulse phase / colour ramp / bar-width math lives
 *     in the sibling `chargeIndicatorFormat.ts` so the unit suite runs
 *     under plain Node.
 *
 * Camera partition: like the shield bubble, the overlay's GameObjects
 * keep their default `scrollFactor` of 1 — they track the fighter in
 * WORLD space, so the scene's HUD/world partition rule (HUD iff
 * `scrollFactor === 0`) leaves them on the world camera automatically.
 * We never call `setScrollFactor(0)`.
 *
 * Determinism note: this overlay is render-only. It reads the live
 * `Character.getChargeProgress()` snapshot + the simulated frame counter
 * (for the pulse phase) and updates Phaser graphics state — no Matter
 * mutation, no RNG. Replays paint identical wind-ups because the
 * underlying charge progress is itself replay-deterministic.
 */

import type Phaser from 'phaser';
import {
  computeChargeIndicatorVisual,
  type ChargeIndicatorVisual,
} from './chargeIndicatorFormat';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Construction options for a single fighter's charge indicator. */
export interface ChargeIndicatorOptions {
  /**
   * Body radius (viewport pixels) — half the largest body dimension.
   * The aura ring starts a small constant padding outside this so the
   * fighter sprite sits visibly inside the glow.
   */
  readonly bodyRadius: number;
  /**
   * Full body height (viewport pixels). Used to float the charge bar a
   * fixed gap above the fighter's head.
   */
  readonly bodyHeight: number;
  /**
   * Phaser depth at which the indicator is drawn. Defaults just above
   * the fighter sprite (and the shield bubble) so the charge effect
   * reads over the body without occluding the HUD.
   */
  readonly depth?: number;
}

/**
 * Per-render-frame snapshot used to update a single indicator.
 * Decoupled from the live `Character` so a (future) replay player can
 * push a buffered snapshot without holding a fighter reference.
 */
export interface ChargeIndicatorSnapshot {
  /**
   * Live charge progress from `Character.getChargeProgress()`: `null`
   * when not winding a move up, otherwise the `0..1` startup fraction.
   */
  readonly chargeProgress: number | null;
  /** Centre point of the fighter's body in viewport coords. */
  readonly x: number;
  readonly y: number;
  /** Simulated physics frame counter — drives the deterministic pulse. */
  readonly frame: number;
}

// ---------------------------------------------------------------------------
// Internal — minimal scene + GameObject shims
// ---------------------------------------------------------------------------

/**
 * Narrow shape we actually call on the aura `Phaser.GameObjects.Arc`.
 * Keeping the interface to just the methods we use lets the unit suite
 * swap in a hand-rolled fake without booting a Phaser game.
 */
export interface ChargeArcLike {
  setPosition(x: number, y: number): ChargeArcLike;
  setRadius(radius: number): ChargeArcLike;
  setFillStyle(color?: number, alpha?: number): ChargeArcLike;
  setStrokeStyle(width?: number, color?: number, alpha?: number): ChargeArcLike;
  setVisible(visible: boolean): ChargeArcLike;
  setDepth(depth: number): ChargeArcLike;
  destroy(): void;
}

/**
 * Narrow shape we actually call on the bar `Phaser.GameObjects.Rectangle`s.
 */
export interface ChargeRectLike {
  setPosition(x: number, y: number): ChargeRectLike;
  setSize(width: number, height: number): ChargeRectLike;
  setOrigin(x: number, y?: number): ChargeRectLike;
  setFillStyle(color?: number, alpha?: number): ChargeRectLike;
  setVisible(visible: boolean): ChargeRectLike;
  setDepth(depth: number): ChargeRectLike;
  destroy(): void;
}

/**
 * Narrow scene shim — only the `add.circle` / `add.rectangle`
 * factories the indicator needs. The runtime concrete is
 * `Phaser.Scene.add`; the unit suite satisfies it with a fake that
 * produces recordable arcs / rects.
 */
export interface ChargeIndicatorSceneShim {
  add: {
    circle(
      x: number,
      y: number,
      radius: number,
      fillColor?: number,
      fillAlpha?: number,
    ): ChargeArcLike;
    rectangle(
      x: number,
      y: number,
      width: number,
      height: number,
      fillColor?: number,
      fillAlpha?: number,
    ): ChargeRectLike;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Default Phaser depth for the indicator — above the fighter rectangle
 * (depth 0) and the shield bubble (depth 5) so the charge effect reads
 * on top of the body, but below the HUD overlays (typically depth
 * 100+) so the percent meter / banners stay legible over it.
 */
const DEFAULT_CHARGE_INDICATOR_DEPTH = 6;

/**
 * One charge indicator per fighter. Construct once per fighter at
 * scene-create; call `update(snapshot)` from the scene's render hook
 * each frame; call `destroy()` on scene shutdown.
 *
 * Implemented as three primitive GameObjects — an aura `Arc` plus a bar
 * track + fill `Rectangle` pair — whose position / colour / alpha /
 * size / visibility we mutate each frame from
 * {@link computeChargeIndicatorVisual}. Three Phaser objects per fighter
 * keeps the per-frame cost trivial (a handful of setter chains per tick
 * even for a 4-fighter FFA).
 */
export class ChargeIndicator {
  private readonly ring: ChargeArcLike;
  private readonly barTrack: ChargeRectLike;
  private readonly barFill: ChargeRectLike;
  private readonly bodyRadius: number;
  private readonly bodyHeight: number;
  private readonly depth: number;
  private destroyed = false;

  constructor(
    scene: ChargeIndicatorSceneShim,
    options: ChargeIndicatorOptions,
  ) {
    this.bodyRadius = options.bodyRadius;
    this.bodyHeight = options.bodyHeight;
    this.depth = options.depth ?? DEFAULT_CHARGE_INDICATOR_DEPTH;

    // Procedural fallback — no CC0 charge VFX sprite/atlas is registered
    // in `assets/manifest.ts`, so the aura is a flat-fill Arc and the
    // bar is two Rectangles. The colour ramp / pulse phase are computed
    // in `chargeIndicatorFormat.ts`. Replace by registering a charge
    // texture and swapping for an animated Sprite if a future art pass
    // ships one. All three start invisible; the first `update` overwrites
    // every visual property and positions them onto the fighter.
    this.ring = scene.add
      .circle(0, 0, Math.max(1, this.bodyRadius), 0xffffff, 0)
      .setStrokeStyle(0, 0xffffff, 0)
      .setVisible(false)
      .setDepth(this.depth);

    // Bar track: an empty backdrop drawn behind the fill. Centre origin
    // so the bar centres horizontally on the fighter. Fill: left-anchored
    // (origin x = 0) so it grows rightward from the track's left edge as
    // the charge builds.
    this.barTrack = scene.add
      .rectangle(0, 0, 1, 1, 0x000000, 0)
      .setOrigin(0.5, 0.5)
      .setVisible(false)
      .setDepth(this.depth);
    this.barFill = scene.add
      .rectangle(0, 0, 1, 1, 0xffffff, 0)
      .setOrigin(0, 0.5)
      .setVisible(false)
      .setDepth(this.depth + 1);
  }

  /**
   * Push the latest charge progress + position into the indicator.
   * Called once per render frame from the scene's render hook.
   *
   * Idempotent post-`destroy()` — a stale call after teardown is
   * silently ignored, so the eliminated-fighter cleanup path stays
   * simple (destroy the indicator when the slot is removed; any
   * in-flight render-frame updates fall through).
   */
  update(snapshot: ChargeIndicatorSnapshot): void {
    if (this.destroyed) return;
    const visual = computeChargeIndicatorVisual({
      chargeProgress: snapshot.chargeProgress,
      frame: snapshot.frame,
      bodyRadius: this.bodyRadius,
      bodyHeight: this.bodyHeight,
    });
    this.applyVisual(snapshot.x, snapshot.y, visual);
  }

  /**
   * Apply a precomputed {@link ChargeIndicatorVisual} to the underlying
   * GameObjects. Exposed primarily for tests / a (future) replay
   * player's scrub-to-frame path that may reconstruct the visual
   * without going through `update()`.
   */
  applyVisual(x: number, y: number, visual: ChargeIndicatorVisual): void {
    if (this.destroyed) return;
    this.ring.setVisible(visual.visible);
    this.barTrack.setVisible(visual.visible);
    this.barFill.setVisible(visual.visible);
    if (!visual.visible) return;

    // Aura ring — centred on the body.
    this.ring.setPosition(x, y);
    this.ring.setRadius(Math.max(1, visual.ringRadius));
    this.ring.setFillStyle(visual.ringColor, visual.ringFillAlpha);
    this.ring.setStrokeStyle(
      visual.ringStrokeWidth,
      visual.ringColor,
      visual.ringStrokeAlpha,
    );

    // Charge bar — floated above the head. The track is centred; the
    // fill is left-anchored at the track's left edge and grows rightward.
    const barCenterY = y + visual.barCenterOffsetY;
    const barLeftX = x - visual.barMaxWidth / 2;
    this.barTrack.setPosition(x, barCenterY);
    this.barTrack.setSize(
      Math.max(1, visual.barMaxWidth),
      Math.max(1, visual.barHeight),
    );
    this.barTrack.setFillStyle(0x101014, visual.barTrackAlpha);
    this.barFill.setPosition(barLeftX, barCenterY);
    this.barFill.setSize(
      Math.max(0, visual.barFillWidth),
      Math.max(1, visual.barHeight),
    );
    this.barFill.setFillStyle(visual.barColor, visual.barFillAlpha);
  }

  /** Hide the indicator without destroying its GameObjects. */
  hide(): void {
    if (this.destroyed) return;
    this.ring.setVisible(false);
    this.barTrack.setVisible(false);
    this.barFill.setVisible(false);
  }

  /**
   * Tear down the underlying Phaser GameObjects. Idempotent — safe to
   * call from both per-slot cleanup hooks and the scene's SHUTDOWN
   * listener.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ring.destroy();
    this.barTrack.destroy();
    this.barFill.destroy();
  }
}

/**
 * Construct a {@link ChargeIndicator} on a real Phaser scene. Tiny
 * convenience that captures the cast from the scene's `add` namespace
 * down to {@link ChargeIndicatorSceneShim} so the call site stays clean.
 */
export function createChargeIndicator(
  scene: Phaser.Scene,
  options: ChargeIndicatorOptions,
): ChargeIndicator {
  return new ChargeIndicator(
    scene as unknown as ChargeIndicatorSceneShim,
    options,
  );
}
