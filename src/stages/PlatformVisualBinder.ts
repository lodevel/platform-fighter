/**
 * Platform visual binder — Sub-AC 4 of AC 90304.
 *
 * Phaser-side counterpart to {@link ./platformVisualState
 * platformVisualState.ts}. The pure module computes a
 * {@link PlatformVisualState} hint set; this module *applies* that
 * state to a Phaser `Rectangle` (the placeholder geometry created by
 * {@link ./StageRenderer.renderStage}) on every fixed step.
 *
 * Why a separate module:
 *
 *   - The pure layer must stay Phaser-free so it can run under Vitest
 *     + plain Node (matching the rest of the engine — see
 *     `engine/Rng`, `match/BlastZoneWatcher`, `entities/LavaHazard`).
 *     The applier here imports Phaser, so it lives in its own file
 *     and is re-exported alongside `StageRenderer` from
 *     {@link ./index}.
 *
 *   - The binder is shaped as a per-platform handle (rather than a
 *     single global `applyAll()`) so the stage builder preview, the
 *     M4 replay scrubber, and the runtime renderer can each manage
 *     their own set of platform sprites without juggling indices into
 *     a flat array.
 *
 *   - The applier mutates the Phaser GameObject in-place rather than
 *     replacing it, mirroring the same pattern as
 *     {@link ./platformCollisionToggle.applyPlatformColliderState}:
 *     Matter holds internal references to the Phaser GameObject in
 *     particle systems / camera follow lists, and replacing it would
 *     invalidate those references.
 *
 * Determinism: the binder reads from {@link PlatformVisualState}
 * (which is a pure function of the input frame counter and the
 * platform's runtime entity) and writes to Phaser. As long as the
 * scene calls `update(frame)` with the same frame counter that drives
 * the entity's `tick()`, replays produce identical visual frames.
 */

import type Phaser from 'phaser';
import type { PlatformVisualState } from './platformVisualState';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal structural shape of a Phaser `Rectangle` GameObject the
 * binder needs. Declared structurally (rather than tying directly to
 * `Phaser.GameObjects.Rectangle`) so unit tests can drive the
 * applier with plain mock objects — same pattern as
 * {@link ./platformCollisionToggle.ToggleablePlatformBody}.
 *
 * The base position (`baseX` / `baseY`) and base size (`baseWidth` /
 * `baseHeight`) are stored separately from the live `x` / `y` /
 * `width` / `height` so the binder can re-apply the wobble + drop
 * offsets each frame without losing the original layout-derived
 * geometry. Mutating `baseX/Y/Width/Height` is the way to reposition
 * a moving platform's home position (e.g. after a stage-builder
 * tweak).
 */
export interface BindablePlatformVisual {
  /**
   * Base layout-space X (centre) of the platform, in *viewport*
   * pixels. The binder writes `baseX + dropOffsetX + wobbleOffsetX`
   * to `x` each frame.
   */
  baseX: number;
  /** Base layout-space Y. */
  baseY: number;
  /** Base width (viewport pixels). The binder writes `baseWidth * scaleX` to `width`. */
  baseWidth: number;
  /** Base height. */
  baseHeight: number;
  /** Live X — written by the binder. */
  x: number;
  /** Live Y — written by the binder. */
  y: number;
  /** Live alpha in [0, 1] — written by the binder. */
  alpha: number;
  /** Live visibility — written by the binder. */
  visible: boolean;
  /** Live width — written by the binder. */
  width: number;
  /** Live height — written by the binder. */
  height: number;
  /** Phaser-style fill colour mutator. Most rectangles store this on `fillColor`. */
  fillColor: number;
  /** Optional stroke colour, written when the visual state requests outline-only style. */
  strokeColor?: number;
  /** Optional stroke alpha, written when the binder applies the outline-only ghost style. */
  strokeAlpha?: number;
  /**
   * Optional setStrokeStyle helper — called when the outline mode
   * changes. Defined as optional so simpler mocks can omit it; the
   * binder no-ops if the function isn't present.
   */
  setStrokeStyle?(width: number, color: number, alpha?: number): unknown;
  /**
   * Optional setFillStyle helper — used when available so Phaser's
   * tracked render bounds stay in sync. Optional so plain mocks that
   * just expose `fillColor` work too.
   */
  setFillStyle?(color: number, alpha?: number): unknown;
}

/**
 * Per-frame binder handle. The owning scene calls `update(state)`
 * once per render frame (typically right after the entity's
 * `tick()`) so the visuals stay in sync with the runtime state.
 */
export interface PlatformVisualBinder {
  /** The bound visual GameObject — exposed for debug overlays. */
  readonly target: BindablePlatformVisual;
  /**
   * Apply a {@link PlatformVisualState} to the bound GameObject.
   * Returns `true` iff at least one observable field changed — useful
   * for tests and for callers that want to skip work when nothing
   * flipped.
   */
  apply(state: PlatformVisualState): boolean;
  /**
   * Reset the GameObject to its original base position / size /
   * visibility — used when the binding is torn down so a re-bound
   * GameObject doesn't carry stale wobble offsets into the next match.
   */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Default stroke widths
// ---------------------------------------------------------------------------

/**
 * Stroke width (in viewport pixels) used when the binder applies the
 * outline-only ghost style for a periodic platform's `warnAppear`
 * phase. Matches {@link ./StageRenderer}'s thin-platform stroke so
 * the materialising ghost reads visually consistent with the solid
 * pass-through platforms it appears alongside.
 */
export const PLATFORM_GHOST_STROKE_WIDTH = 2;

/**
 * Stroke width used while the platform is in `'fill+overlay'` mode —
 * a slightly thicker line that hugs the warning-tinted body without
 * being mistaken for a separate ghost outline.
 */
export const PLATFORM_OVERLAY_STROKE_WIDTH = 3;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Bind a Phaser visual to a per-frame {@link PlatformVisualState}
 * stream. The binder captures the GameObject's *base* position and
 * size at construction time so subsequent `apply()` calls can layer
 * the wobble + drop + scale offsets on top without losing the
 * original layout geometry.
 *
 * The base position can be updated on the returned handle's
 * {@link BindablePlatformVisual} fields — useful when the M3 stage
 * builder drags a platform to a new base location and the visual
 * needs to follow. The next `apply()` call recomputes the live
 * position from the new base.
 */
export function createPlatformVisualBinder(
  target: BindablePlatformVisual,
): PlatformVisualBinder {
  // Track the last-applied state so `apply()` can short-circuit
  // when nothing changed and so `reset()` can cleanly revert to the
  // baseline visual properties.
  let lastTint: number | null = null;
  let lastOutlineMode: PlatformVisualState['outlineMode'] | null = null;

  return {
    target,
    apply(state: PlatformVisualState): boolean {
      let changed = false;

      // ---- Visibility / alpha ----------------------------------------
      if (target.visible !== state.visible) {
        target.visible = state.visible;
        changed = true;
      }
      if (target.alpha !== state.alpha) {
        target.alpha = state.alpha;
        changed = true;
      }

      // ---- Position (base + drop + wobble) --------------------------
      const newX = target.baseX + state.dropOffsetX + state.wobbleOffsetX;
      const newY = target.baseY + state.dropOffsetY + state.wobbleOffsetY;
      if (target.x !== newX) {
        target.x = newX;
        changed = true;
      }
      if (target.y !== newY) {
        target.y = newY;
        changed = true;
      }

      // ---- Size (base × scale) --------------------------------------
      const newW = target.baseWidth * state.scaleX;
      const newH = target.baseHeight * state.scaleY;
      if (target.width !== newW) {
        target.width = newW;
        changed = true;
      }
      if (target.height !== newH) {
        target.height = newH;
        changed = true;
      }

      // ---- Tint / fill ----------------------------------------------
      if (lastTint !== state.tint) {
        if (typeof target.setFillStyle === 'function') {
          target.setFillStyle(state.tint, target.alpha);
        } else {
          target.fillColor = state.tint;
        }
        lastTint = state.tint;
        changed = true;
      }

      // ---- Outline / ghost / overlay --------------------------------
      if (lastOutlineMode !== state.outlineMode) {
        applyOutlineMode(target, state);
        lastOutlineMode = state.outlineMode;
        changed = true;
      } else if (state.outlineMode === 'ghost') {
        // Outline intensity ramps within the same mode; re-apply the
        // stroke alpha each frame while the ghost is materialising.
        if (typeof target.setStrokeStyle === 'function') {
          target.setStrokeStyle(
            PLATFORM_GHOST_STROKE_WIDTH,
            state.overlayTint,
            state.outlineIntensity,
          );
        }
        target.strokeColor = state.overlayTint;
        target.strokeAlpha = state.outlineIntensity;
        // The outline-intensity ramp on its own is a visual change —
        // flag it so callers that diff on `apply()` returning true
        // don't miss the ghost fade-in.
        changed = true;
      }

      return changed;
    },
    reset(): void {
      target.x = target.baseX;
      target.y = target.baseY;
      target.width = target.baseWidth;
      target.height = target.baseHeight;
      target.alpha = 1;
      target.visible = true;
      lastTint = null;
      lastOutlineMode = null;
    },
  };
}

/**
 * Apply the outline / fill style for a given visual state. Three
 * modes:
 *
 *   - `'fill'`         : reset stroke (no outline), keep filled body.
 *   - `'ghost'`        : draw outline-only ghost — fill alpha is
 *                        already at the entity's `outlineNorm` from
 *                        the visual state, so the body still renders
 *                        but very faintly; the stroke gives it shape.
 *   - `'fill+overlay'` : keep the filled body + draw a thicker stroke
 *                        in the warning overlay colour so the
 *                        warning state reads at a glance.
 */
function applyOutlineMode(
  target: BindablePlatformVisual,
  state: PlatformVisualState,
): void {
  switch (state.outlineMode) {
    case 'fill':
      // Disable the stroke (Phaser convention: setStrokeStyle(0, 0)
      // or setStrokeStyle with width 0). We pass width 0 + the base
      // tint as a no-op-friendly call, plus null alpha so adapters
      // that read `strokeAlpha === 0` infer "no stroke".
      if (typeof target.setStrokeStyle === 'function') {
        target.setStrokeStyle(0, state.baseTint, 0);
      }
      target.strokeColor = state.baseTint;
      target.strokeAlpha = 0;
      break;
    case 'ghost':
      if (typeof target.setStrokeStyle === 'function') {
        target.setStrokeStyle(
          PLATFORM_GHOST_STROKE_WIDTH,
          state.overlayTint,
          state.outlineIntensity,
        );
      }
      target.strokeColor = state.overlayTint;
      target.strokeAlpha = state.outlineIntensity;
      break;
    case 'fill+overlay':
      if (typeof target.setStrokeStyle === 'function') {
        target.setStrokeStyle(
          PLATFORM_OVERLAY_STROKE_WIDTH,
          state.overlayTint,
          1,
        );
      }
      target.strokeColor = state.overlayTint;
      target.strokeAlpha = 1;
      break;
  }
}

/**
 * Convenience: create a binder around an actual Phaser `Rectangle`
 * GameObject. The Rectangle's current `(x, y, width, height)` are
 * captured as the base values. Tests should prefer
 * {@link createPlatformVisualBinder} with a plain object instead of
 * pulling Phaser into the test runtime.
 */
export function bindPlatformRectangle(
  rect: Phaser.GameObjects.Rectangle,
): PlatformVisualBinder {
  // The `BindablePlatformVisual` shape extends what Phaser's
  // Rectangle already exposes — we just need to install the `baseX`
  // / `baseY` / `baseWidth` / `baseHeight` fields without touching
  // anything else on the live object. They're stored on the rect
  // itself (rather than a side table) so the binder is GC-friendly
  // when the rect is destroyed.
  const target = rect as unknown as BindablePlatformVisual;
  target.baseX = rect.x;
  target.baseY = rect.y;
  target.baseWidth = rect.width;
  target.baseHeight = rect.height;
  return createPlatformVisualBinder(target);
}
