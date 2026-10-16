import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../stages/stageDefinitions';
import type { StageLayout } from '../types';

/**
 * The match camera's framing, without Phaser: centre on the active targets'
 * weighted centroid, zoom to fit their bounding box plus padding, ease both
 * frame-rate independently, and never frame outside the stage bounds.
 *
 * The math was lifted unchanged from CameraController (computeTargetEnvelope,
 * frameRateIndependentLerp, clampCenterToBounds, update/snap/setBounds/
 * setZoomRange); CameraController is now a thin Phaser adapter over it and
 * goes with Phaser in step 9. Phaser's deadzone only affects startFollow, which the
 * game never uses, so it has no counterpart here.
 */
export interface CameraTarget { readonly x: number; readonly y: number; readonly active?: boolean; readonly weight?: number }
export interface CameraRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface CameraFramingOptions {
  readonly maxZoom?: number;
  readonly minZoom?: number;
  readonly defaultZoom?: number;
  readonly followLerp?: number;
  readonly zoomLerp?: number;
  readonly framePadding?: number;
  readonly boundsOutset?: number;
  readonly bounds?: CameraRect;
  /** The on-screen area the camera draws into, in design px. */
  readonly viewport?: CameraRect;
  readonly initialCenter?: { x: number; y: number };
}

const DEFAULTS = { maxZoom: 1, minZoom: 0.55, defaultZoom: 1, followLerp: 0.18, zoomLerp: 0.12, framePadding: 320, boundsOutset: 0 } as const;

/** The settings MatchScene uses (MatchScene: `new CameraController(...)`), HUD strip 190 px. */
export const MATCH_CAMERA_OPTIONS: CameraFramingOptions = Object.freeze({
  viewport: { x: 0, y: 0, width: STAGE_DESIGN_WIDTH, height: STAGE_DESIGN_HEIGHT - 190 },
  maxZoom: 1.4, minZoom: 0.4, framePadding: 280, followLerp: 0.85, zoomLerp: 0.85,
});

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);

export function computeTargetEnvelope(targets: ReadonlyArray<CameraTarget>) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, weightSum = 0, cx = 0, cy = 0, active = 0;
  for (const t of targets) {
    if (t.active === false) continue;
    const w = Math.max(0, t.weight ?? 1);
    if (w <= 0) continue;
    if (t.x < minX) minX = t.x;
    if (t.y < minY) minY = t.y;
    if (t.x > maxX) maxX = t.x;
    if (t.y > maxY) maxY = t.y;
    cx += t.x * w;
    cy += t.y * w;
    weightSum += w;
    active += 1;
  }
  if (active === 0 || weightSum === 0) return null;
  return { minX, minY, maxX, maxY, centerX: cx / weightSum, centerY: cy / weightSum };
}

export function frameRateIndependentLerp(from: number, to: number, factor: number, deltaMs: number): number {
  if (factor <= 0) return from;
  if (factor >= 1) return to;
  const seconds = Math.max(0, deltaMs) / 1000;
  return from + (to - from) * (1 - Math.pow(1 - factor, seconds));
}

export function clampCenterToBounds(x: number, y: number, bounds: CameraRect, viewport: CameraRect, zoom: number) {
  const z = zoom > 0 ? zoom : 1;
  const halfW = viewport.width / (2 * z), halfH = viewport.height / (2 * z);
  const minX = bounds.x + halfW, maxX = bounds.x + bounds.width - halfW;
  const minY = bounds.y + halfH, maxY = bounds.y + bounds.height - halfH;
  return {
    x: minX > maxX ? bounds.x + bounds.width / 2 : clamp(x, minX, maxX),
    y: minY > maxY ? bounds.y + bounds.height / 2 : clamp(y, minY, maxY),
  };
}

export class CameraFraming {
  private readonly options: { maxZoom: number; minZoom: number; defaultZoom: number; followLerp: number; zoomLerp: number; framePadding: number; boundsOutset: number };
  private bounds: CameraRect;
  private viewport: CameraRect;
  private targets: ReadonlyArray<CameraTarget> = [];
  private targetCenter: { x: number; y: number };
  private targetZoom: number;
  /** What the camera shows now: centre (design px) and zoom. */
  center: { x: number; y: number };
  zoom: number;

  constructor(layout: StageLayout | null, options: CameraFramingOptions = {}) {
    this.options = {
      maxZoom: options.maxZoom ?? DEFAULTS.maxZoom, minZoom: options.minZoom ?? DEFAULTS.minZoom,
      defaultZoom: options.defaultZoom ?? DEFAULTS.defaultZoom, followLerp: options.followLerp ?? DEFAULTS.followLerp,
      zoomLerp: options.zoomLerp ?? DEFAULTS.zoomLerp, framePadding: options.framePadding ?? DEFAULTS.framePadding,
      boundsOutset: options.boundsOutset ?? DEFAULTS.boundsOutset,
    };
    this.bounds = options.bounds ?? this.boundsFromLayout(layout);
    this.viewport = options.viewport ?? { x: 0, y: 0, width: STAGE_DESIGN_WIDTH, height: STAGE_DESIGN_HEIGHT };
    this.targetCenter = { ...(options.initialCenter ?? { x: this.bounds.x + this.bounds.width / 2, y: this.bounds.y + this.bounds.height / 2 }) };
    this.targetZoom = this.options.defaultZoom;
    this.zoom = this.targetZoom;
    this.center = clampCenterToBounds(this.targetCenter.x, this.targetCenter.y, this.bounds, this.viewport, this.zoom);
  }

  setTargets(targets: ReadonlyArray<CameraTarget>): void { this.targets = targets; }

  update(deltaMs: number): void {
    const env = computeTargetEnvelope(this.targets);
    if (env) {
      this.targetCenter = { x: env.centerX, y: env.centerY };
      const pad = this.options.framePadding;
      const spanX = Math.max(1, env.maxX - env.minX) + pad * 2, spanY = Math.max(1, env.maxY - env.minY) + pad * 2;
      this.targetZoom = clamp(Math.min(this.viewport.width / spanX, this.viewport.height / spanY), this.options.minZoom, this.options.maxZoom);
    } else {
      this.targetCenter = { x: this.bounds.x + this.bounds.width / 2, y: this.bounds.y + this.bounds.height / 2 };
      this.targetZoom = this.options.defaultZoom;
    }
    const x = frameRateIndependentLerp(this.center.x, this.targetCenter.x, this.options.followLerp, deltaMs);
    const y = frameRateIndependentLerp(this.center.y, this.targetCenter.y, this.options.followLerp, deltaMs);
    this.zoom = frameRateIndependentLerp(this.zoom, this.targetZoom, this.options.zoomLerp, deltaMs);
    this.center = clampCenterToBounds(x, y, this.bounds, this.viewport, this.zoom);
  }

  snap(): void {
    this.zoom = this.targetZoom;
    this.center = clampCenterToBounds(this.targetCenter.x, this.targetCenter.y, this.bounds, this.viewport, this.zoom);
  }

  setBounds(bounds: CameraRect): void {
    this.bounds = bounds;
    this.targetCenter = { x: clamp(this.targetCenter.x, bounds.x, bounds.x + bounds.width), y: clamp(this.targetCenter.y, bounds.y, bounds.y + bounds.height) };
  }

  setZoomRange(minZoom: number, maxZoom: number): void {
    const lo = Math.max(0.05, Math.min(minZoom, maxZoom)), hi = Math.max(0.05, Math.max(minZoom, maxZoom));
    this.options.minZoom = lo;
    this.options.maxZoom = hi;
    this.targetZoom = clamp(this.targetZoom, lo, hi);
  }

  setViewport(viewport: CameraRect): void { this.viewport = viewport; }

  getViewport(): CameraRect { return { ...this.viewport }; }
  getTargetCenter(): { x: number; y: number } { return { ...this.targetCenter }; }
  getTargetZoom(): number { return this.targetZoom; }
  getBounds(): CameraRect { return { ...this.bounds }; }

  /** The design-space rectangle the camera shows (what the renderer frames). */
  visibleRect(): CameraRect {
    const w = this.viewport.width / this.zoom, h = this.viewport.height / this.zoom;
    return { x: this.center.x - w / 2, y: this.center.y - h / 2, width: w, height: h };
  }

  private boundsFromLayout(layout: StageLayout | null): CameraRect {
    if (!layout) return { x: 0, y: 0, width: STAGE_DESIGN_WIDTH, height: STAGE_DESIGN_HEIGHT };
    const z = layout.blastZone, o = this.options.boundsOutset;
    return { x: z.left - o, y: z.top - o, width: Math.max(1, z.right - z.left + o * 2), height: Math.max(1, z.bottom - z.top + o * 2) };
  }
}
