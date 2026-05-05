import type Phaser from 'phaser';
import type { StageLayout } from '../types';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../stages/stageDefinitions';

/**
 * Phaser's `Scale.Events.RESIZE` is the literal string `'resize'`. We
 * inline it here so the controller can stay a type-only Phaser
 * importer — that lets the unit test suite run in plain Node without
 * pulling Phaser's DOM-only init path.
 */
const PHASER_RESIZE_EVENT = 'resize';

/** Tiny clamp helper to avoid a runtime reference to `Phaser.Math.Clamp`. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Sub-AC 2.3 — Camera setup, bounds, follow behaviour, viewport.
 *
 * The Smash-style fighter wants a single camera that:
 *
 *   1. Refuses to scroll past the *blast zone* in any direction. A
 *      character thrown off-stage should fly off-screen, but we never
 *      want to reveal the empty void beyond the KO line — that's what
 *      camera **bounds** are for. We derive the bounds from the active
 *      `StageLayout.blastZone`, with an optional outset so the bound
 *      can be a touch wider than the kill plane if a stage wants extra
 *      breathing room.
 *
 *   2. **Follows** every active target (player, projectile of interest,
 *      replay focus) by tracking the bounding box of all targets and
 *      smoothly lerping toward its centroid. KO'd / inactive targets
 *      drop out of the calculation so the camera doesn't get yanked
 *      back to a respawn point in the middle of a flashy KO.
 *
 *   3. Picks a **zoom** that keeps every target on screen with a small
 *      framing pad — when fighters cluster, the camera tightens; when
 *      they spread to opposite blast zones, it pulls back to the
 *      configured `minZoom`. Zoom is also lerped so a sudden KO doesn't
 *      cause a jarring snap.
 *
 *   4. Lets callers override the **viewport** rectangle (e.g. for a
 *      future split-screen experiment, the stage builder's preview
 *      pane, or a replay scrubber side-panel layout). Default viewport
 *      is the full game viewport.
 *
 * The controller is intentionally Phaser-touching but content-neutral:
 * it doesn't know about characters or replays. The MatchScene (and
 * later the replay scene + stage-builder preview) feed it a flat list
 * of `CameraTarget`s every frame; the controller does the math and
 * drives `scene.cameras.main`.
 *
 * Determinism note: the controller mutates ONLY the Phaser camera —
 * not the Matter world or any gameplay state — so its lerp is purely
 * a render-time concern. Replays can rebuild the camera from inputs +
 * snapshots without diverging.
 */

/**
 * A single thing the camera should keep in frame. The shape is
 * intentionally loose — anything with `(x, y)` works, so character
 * bodies, projectile bodies, item drops and replay-focus markers all
 * plug in without an adapter.
 */
export interface CameraTarget {
  /** World-space x coordinate (design-resolution pixels). */
  readonly x: number;
  /** World-space y coordinate (design-resolution pixels). */
  readonly y: number;
  /**
   * When false the target is ignored for framing. Used so a KO'd /
   * respawning fighter doesn't yank the camera back across the stage.
   * Defaults to `true`.
   */
  readonly active?: boolean;
  /**
   * Optional weight (≥ 0) that lets a target pull the camera harder.
   * Useful for boss fights and the eventual "focus the replay
   * highlight" feature. Defaults to 1.
   */
  readonly weight?: number;
}

export interface CameraBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CameraViewport {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CameraControllerOptions {
  /**
   * Tightest zoom (most zoomed-in) the controller will pick. The
   * camera *can* be zoomed in further by an explicit `setZoom()` call;
   * this only constrains the auto-zoom that follows targets. Default 1.
   */
  readonly maxZoom?: number;

  /**
   * Loosest zoom (most zoomed-out) the auto-zoom will pick. The
   * camera will not pull back further even if targets spread past the
   * edge of the visible area. Default 0.55 — roughly the Smash Bros
   * "max distance" framing.
   */
  readonly minZoom?: number;

  /**
   * Zoom used before any targets are registered (e.g. on stage spawn,
   * before fighters drop in). Default 1.
   */
  readonly defaultZoom?: number;

  /**
   * Per-second lerp factor for the camera *position* — 0 = no
   * smoothing, 1 = instantaneous snap. Default 0.18 ≈ ~9 frames at
   * 60 Hz to converge half-way, which feels firm but not jittery.
   */
  readonly followLerp?: number;

  /**
   * Per-second lerp factor for the camera *zoom*. Slightly slower
   * than position so zoom changes don't compete with pan. Default
   * 0.12.
   */
  readonly zoomLerp?: number;

  /**
   * Extra design-pixel padding around the targets' bounding box when
   * computing the auto-zoom. Larger = more breathing room around
   * fighters. Default 320.
   */
  readonly framePadding?: number;

  /**
   * Outset (design pixels) added to every side of the blast-zone
   * rectangle when deriving camera bounds. Lets a stage allow the
   * camera to drift slightly past the KO plane for cinematic effect.
   * Default 0 — bounds = blast zone.
   */
  readonly boundsOutset?: number;

  /**
   * Override the auto-derived camera bounds entirely. When provided
   * the blast zone is ignored; useful for the stage builder where the
   * "world" is the canvas grid rather than a playable stage.
   */
  readonly bounds?: CameraBounds;

  /**
   * Optional starting viewport rectangle. Defaults to the full game
   * viewport (0, 0, scale.width, scale.height).
   */
  readonly viewport?: CameraViewport;

  /**
   * Initial centre point. When omitted, defaults to the centre of the
   * derived bounds — which lines up with the stage centre for the
   * blast-zone-derived case.
   */
  readonly initialCenter?: { x: number; y: number };

  /**
   * Background colour to paint behind the camera (the "void" behind
   * stage geometry). Defaults to undefined → leaves whatever the scene
   * already configured untouched.
   */
  readonly backgroundColor?: string;

  /**
   * Optional Phaser deadzone — region around the follow point where
   * the camera does NOT scroll. Width/height are in pixels. Defaults
   * to a small deadzone (160×96) that keeps the camera from twitching
   * on tiny movements.
   */
  readonly deadzone?: { width: number; height: number } | null;
}

const DEFAULTS = {
  maxZoom: 1,
  minZoom: 0.55,
  defaultZoom: 1,
  followLerp: 0.18,
  zoomLerp: 0.12,
  framePadding: 320,
  boundsOutset: 0,
  deadzone: { width: 160, height: 96 } as const,
} as const;

/**
 * Compute the bounding rectangle of a list of targets. Returns null
 * if no active target exists. Respects per-target weights so a
 * future "highlight" target can dominate framing.
 */
function computeTargetEnvelope(targets: ReadonlyArray<CameraTarget>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
} | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let weightSum = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  let active = 0;

  for (const t of targets) {
    if (t.active === false) continue;
    const w = Math.max(0, t.weight ?? 1);
    if (w <= 0) continue;
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x;
    if (t.y > maxY) maxY = t.y;
    cxAcc += t.x * w;
    cyAcc += t.y * w;
    weightSum += w;
    active += 1;
  }

  if (active === 0 || weightSum === 0) return null;
  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: cxAcc / weightSum,
    centerY: cyAcc / weightSum,
  };
}

/**
 * Smoothly approach `to` from `from` with a per-second lerp factor.
 *
 * `factor` is the fraction of the gap closed PER SECOND (0..1). We
 * convert it to a per-tick fraction with `1 - (1 - factor)^(dt/1000)`
 * so the smoothing rate is independent of frame rate.
 */
function frameRateIndependentLerp(
  from: number,
  to: number,
  factor: number,
  deltaMs: number,
): number {
  if (factor <= 0) return from;
  if (factor >= 1) return to;
  const seconds = Math.max(0, deltaMs) / 1000;
  const t = 1 - Math.pow(1 - factor, seconds);
  return from + (to - from) * t;
}

/**
 * Clamp a desired camera centre so the visible region (viewport / zoom)
 * never strays outside the configured world bounds.
 *
 * Sub-AC 3 of AC 103: "the camera cannot scroll outside the stage area".
 *
 * Phaser's `Camera.centerOn` already does this when `setBounds()` is
 * configured — but only at runtime. By clamping explicitly we get the
 * same behaviour in unit tests (where the camera is mocked) and we
 * insulate the controller from any future Phaser change to default
 * clamping semantics.
 *
 * Edge case: when the visible region is *wider/taller* than the bounds
 * (`minC > maxC`), the camera centres on the bounds centre — that's the
 * only way to keep the inside of the bounds entirely on-screen.
 */
function clampCenterToBounds(
  desiredX: number,
  desiredY: number,
  bounds: CameraBounds,
  viewport: CameraViewport,
  zoom: number,
): { x: number; y: number } {
  const safeZoom = zoom > 0 ? zoom : 1;
  const halfVw = viewport.width / (2 * safeZoom);
  const halfVh = viewport.height / (2 * safeZoom);

  const minCx = bounds.x + halfVw;
  const maxCx = bounds.x + bounds.width - halfVw;
  const minCy = bounds.y + halfVh;
  const maxCy = bounds.y + bounds.height - halfVh;

  // Visible area fits inside bounds horizontally.
  let cx: number;
  if (minCx > maxCx) {
    // Viewport WIDER than bounds at this zoom — there's no legal
    // camera position that hides every off-bounds pixel. Pin to the
    // bounds centre so the empty-space margins are symmetric on both
    // sides instead of stranded on one side. Avoids "off-stage void
    // visible on the left because target is at left edge" scenarios.
    cx = bounds.x + bounds.width / 2;
  } else {
    cx = clamp(desiredX, minCx, maxCx);
  }

  // Visible area fits inside bounds vertically.
  let cy: number;
  if (minCy > maxCy) {
    cy = bounds.y + bounds.height / 2;
  } else {
    cy = clamp(desiredY, minCy, maxCy);
  }

  return { x: cx, y: cy };
}

/**
 * Drives a Phaser camera with bounds (clamped to the active stage's
 * blast zone), multi-target follow, and a configurable viewport.
 *
 * Lifecycle:
 *
 *   const cam = new CameraController(scene, FLAT_STAGE);
 *   cam.setTargets([...players]);
 *   // every render frame:
 *   cam.update(deltaMs);
 *   // teardown:
 *   cam.destroy();
 */
export class CameraController {
  private readonly scene: Phaser.Scene;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  private readonly options: Required<Omit<
    CameraControllerOptions,
    'bounds' | 'viewport' | 'initialCenter' | 'backgroundColor' | 'deadzone'
  >> & {
    readonly bounds: CameraBounds | null;
    readonly viewport: CameraViewport | null;
    readonly initialCenter: { x: number; y: number } | null;
    readonly backgroundColor: string | null;
    readonly deadzone: { width: number; height: number } | null;
  };

  private targets: ReadonlyArray<CameraTarget> = [];
  private currentBounds: CameraBounds;
  private currentViewport: CameraViewport;
  /** The last computed *target* zoom — what we're lerping the camera toward. */
  private targetZoom: number;
  /** The last computed *target* centre — what we're lerping the camera toward. */
  private targetCenter: { x: number; y: number };
  private resizeListener: ((gameSize: Phaser.Structs.Size) => void) | null = null;
  private destroyed = false;

  constructor(
    scene: Phaser.Scene,
    layout: StageLayout | null,
    options: CameraControllerOptions = {},
  ) {
    this.scene = scene;
    this.camera = scene.cameras.main;

    this.options = {
      maxZoom: options.maxZoom ?? DEFAULTS.maxZoom,
      minZoom: options.minZoom ?? DEFAULTS.minZoom,
      defaultZoom: options.defaultZoom ?? DEFAULTS.defaultZoom,
      followLerp: options.followLerp ?? DEFAULTS.followLerp,
      zoomLerp: options.zoomLerp ?? DEFAULTS.zoomLerp,
      framePadding: options.framePadding ?? DEFAULTS.framePadding,
      boundsOutset: options.boundsOutset ?? DEFAULTS.boundsOutset,
      bounds: options.bounds ?? null,
      viewport: options.viewport ?? null,
      initialCenter: options.initialCenter ?? null,
      backgroundColor: options.backgroundColor ?? null,
      // Explicit `null` disables deadzone entirely; `undefined` falls
      // back to the default. We need to differentiate the two.
      deadzone: options.deadzone === undefined ? { ...DEFAULTS.deadzone } : options.deadzone,
    };

    // ---- Bounds ----------------------------------------------------------
    // Derived from blast zone unless an override is supplied. Clamped
    // to a sane minimum so a misconfigured layout doesn't collapse the
    // camera bounds to zero area.
    this.currentBounds = this.options.bounds ?? this.deriveBoundsFromLayout(layout);

    // ---- Viewport --------------------------------------------------------
    this.currentViewport = this.options.viewport ?? this.deriveDefaultViewport();

    // Apply both immediately so the camera is configured before the
    // first render frame.
    this.applyBounds(this.currentBounds);
    this.applyViewport(this.currentViewport);

    // ---- Initial centre + zoom ------------------------------------------
    const initialCenter =
      this.options.initialCenter ?? {
        x: this.currentBounds.x + this.currentBounds.width / 2,
        y: this.currentBounds.y + this.currentBounds.height / 2,
      };
    this.targetCenter = { ...initialCenter };
    this.targetZoom = this.options.defaultZoom;
    this.camera.setZoom(this.targetZoom);
    // Sub-AC 3 of AC 103: clamp the very first centre too — even an
    // explicit `initialCenter` can't push the viewport outside the
    // stage area, so the bounds invariant holds from frame zero.
    const clampedInitial = clampCenterToBounds(
      this.targetCenter.x,
      this.targetCenter.y,
      this.currentBounds,
      this.currentViewport,
      this.targetZoom,
    );
    this.camera.centerOn(clampedInitial.x, clampedInitial.y);

    // ---- Deadzone --------------------------------------------------------
    if (this.options.deadzone) {
      this.camera.setDeadzone(
        this.options.deadzone.width,
        this.options.deadzone.height,
      );
    }

    // ---- Background ------------------------------------------------------
    if (this.options.backgroundColor !== null) {
      this.camera.setBackgroundColor(this.options.backgroundColor);
    }

    // ---- Responsive viewport --------------------------------------------
    // If the user resizes the browser, follow the new game size unless
    // the caller pinned an explicit viewport rectangle.
    if (this.options.viewport === null) {
      const onResize = (gameSize: Phaser.Structs.Size): void => {
        if (this.destroyed) return;
        this.currentViewport = {
          x: 0,
          y: 0,
          width: gameSize.width,
          height: gameSize.height,
        };
        this.applyViewport(this.currentViewport);
      };
      this.resizeListener = onResize;
      this.scene.scale.on(PHASER_RESIZE_EVENT, onResize);
    }
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  /** Replace the full target list. Inactive targets are filtered inside `update()`. */
  setTargets(targets: ReadonlyArray<CameraTarget>): void {
    this.targets = targets;
  }

  /** Append a single target without disturbing the existing list. */
  addTarget(target: CameraTarget): void {
    this.targets = [...this.targets, target];
  }

  /**
   * Drive the camera one tick. Call from the gameplay scene's render
   * hook (the `render` callback inside `PhysicsEngine.advance`) so
   * smoothing runs at display rate while the simulation stays locked
   * to its fixed 60 Hz step.
   */
  update(deltaMs: number): void {
    if (this.destroyed) return;

    // ---- Compute desired centre + zoom from active targets --------------
    const env = computeTargetEnvelope(this.targets);
    if (env) {
      // Centre on the weighted centroid of every active target.
      this.targetCenter = { x: env.centerX, y: env.centerY };

      // Zoom-to-fit: figure out the smallest zoom that keeps the
      // bounding box (plus padding) inside the viewport. We don't go
      // tighter than `maxZoom` even if a single fighter is on-screen,
      // and we don't pull back past `minZoom` even if fighters spread
      // to the blast zones.
      const padding = this.options.framePadding;
      const spanX = Math.max(1, env.maxX - env.minX) + padding * 2;
      const spanY = Math.max(1, env.maxY - env.minY) + padding * 2;
      const zoomX = this.currentViewport.width / spanX;
      const zoomY = this.currentViewport.height / spanY;
      const fitZoom = Math.min(zoomX, zoomY);
      this.targetZoom = clamp(
        fitZoom,
        this.options.minZoom,
        this.options.maxZoom,
      );
    } else {
      // No active targets — return to the bounds centre at default zoom.
      this.targetCenter = {
        x: this.currentBounds.x + this.currentBounds.width / 2,
        y: this.currentBounds.y + this.currentBounds.height / 2,
      };
      this.targetZoom = this.options.defaultZoom;
    }

    // ---- Smooth toward target -------------------------------------------
    const newX = frameRateIndependentLerp(
      this.camera.midPoint.x,
      this.targetCenter.x,
      this.options.followLerp,
      deltaMs,
    );
    const newY = frameRateIndependentLerp(
      this.camera.midPoint.y,
      this.targetCenter.y,
      this.options.followLerp,
      deltaMs,
    );
    const newZoom = frameRateIndependentLerp(
      this.camera.zoom,
      this.targetZoom,
      this.options.zoomLerp,
      deltaMs,
    );

    this.camera.setZoom(newZoom);

    // Sub-AC 3 of AC 103: clamp the lerp result to the configured world
    // bounds *before* handing it to Phaser. `centerOn` already respects
    // `setBounds()` at runtime, but explicit clamping keeps the
    // behaviour observable in unit tests and locks the contract in: the
    // camera will never frame area outside the stage no matter where
    // the targets drift.
    const clamped = clampCenterToBounds(
      newX,
      newY,
      this.currentBounds,
      this.currentViewport,
      newZoom,
    );
    this.camera.centerOn(clamped.x, clamped.y);
  }

  /**
   * Replace bounds at runtime (e.g. when switching to a stage with a
   * different blast-zone). Re-clamps the current centre into the new
   * bounds so the camera doesn't pop on the next update.
   */
  setBounds(bounds: CameraBounds): void {
    this.currentBounds = bounds;
    this.applyBounds(bounds);
    // Clamp the lerp target into the new bounds so we don't pan
    // toward a now-unreachable point next tick.
    this.targetCenter = {
      x: clamp(
        this.targetCenter.x,
        bounds.x,
        bounds.x + bounds.width,
      ),
      y: clamp(
        this.targetCenter.y,
        bounds.y,
        bounds.y + bounds.height,
      ),
    };
  }

  /** Replace the viewport rectangle (e.g. for split-screen / preview pane). */
  setViewport(viewport: CameraViewport): void {
    this.currentViewport = viewport;
    this.applyViewport(viewport);
  }

  /** Override the auto-zoom range. Both values are clamped ≥ 0.05. */
  setZoomRange(minZoom: number, maxZoom: number): void {
    const safeMin = Math.max(0.05, Math.min(minZoom, maxZoom));
    const safeMax = Math.max(0.05, Math.max(minZoom, maxZoom));
    (this.options as { minZoom: number; maxZoom: number }).minZoom = safeMin;
    (this.options as { minZoom: number; maxZoom: number }).maxZoom = safeMax;
    this.targetZoom = clamp(this.targetZoom, safeMin, safeMax);
  }

  /** Snap the camera to the lerp target with no smoothing. */
  snap(): void {
    this.camera.setZoom(this.targetZoom);
    // Mirror `update()`'s clamp — Sub-AC 3 of AC 103 — so a forced snap
    // can never push the camera outside the stage area.
    const clamped = clampCenterToBounds(
      this.targetCenter.x,
      this.targetCenter.y,
      this.currentBounds,
      this.currentViewport,
      this.targetZoom,
    );
    this.camera.centerOn(clamped.x, clamped.y);
  }

  /** Return the currently applied bounds (post-clamping). */
  getBounds(): CameraBounds {
    return { ...this.currentBounds };
  }

  /** Return the currently applied viewport rectangle. */
  getViewport(): CameraViewport {
    return { ...this.currentViewport };
  }

  /** Latest computed target zoom — useful for HUD overlays / tests. */
  getTargetZoom(): number {
    return this.targetZoom;
  }

  /** Latest computed target centre — useful for HUD overlays / tests. */
  getTargetCenter(): { x: number; y: number } {
    return { ...this.targetCenter };
  }

  /** Escape hatch for code that needs raw access to Phaser's camera. */
  getCamera(): Phaser.Cameras.Scene2D.Camera {
    return this.camera;
  }

  /** Detach event listeners and clear targets. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.resizeListener) {
      this.scene.scale.off(PHASER_RESIZE_EVENT, this.resizeListener);
      this.resizeListener = null;
    }
    this.targets = [];
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private deriveBoundsFromLayout(layout: StageLayout | null): CameraBounds {
    if (!layout) {
      // Fallback: design viewport. Used by the stage builder preview
      // before any custom-stage data has been authored.
      return {
        x: 0,
        y: 0,
        width: STAGE_DESIGN_WIDTH,
        height: STAGE_DESIGN_HEIGHT,
      };
    }
    const z = layout.blastZone;
    const o = this.options.boundsOutset;
    const x = z.left - o;
    const y = z.top - o;
    const width = Math.max(1, z.right - z.left + o * 2);
    const height = Math.max(1, z.bottom - z.top + o * 2);
    return { x, y, width, height };
  }

  private deriveDefaultViewport(): CameraViewport {
    const { width, height } = this.scene.scale.gameSize;
    return { x: 0, y: 0, width, height };
  }

  private applyBounds(bounds: CameraBounds): void {
    this.camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  private applyViewport(viewport: CameraViewport): void {
    this.camera.setViewport(
      viewport.x,
      viewport.y,
      viewport.width,
      viewport.height,
    );
  }
}
