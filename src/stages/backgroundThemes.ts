/**
 * Themed stage background data — pure, Phaser-free.
 *
 * Each built-in stage carries a `backgroundTheme` id on its
 * `StageLayout`; this module is the registry those ids resolve
 * against. A theme bundles everything `StageBackgroundRenderer`
 * needs to paint an atmospheric backdrop:
 *
 *   - a top/bottom vertical gradient (replaces the flat `#13131f`
 *     scene clear colour as the visible sky / cavern depth),
 *   - 2–3 parallax layer specs, painted back-to-front, each with a
 *     `parallaxFactor` in [0.1, 0.6] so distant scenery slides slower
 *     than the camera (factor 0 would be glued to the screen, factor 1
 *     would move with the stage),
 *   - an ambient accent colour + slow pulse spec (lava glow, aurora
 *     shimmer) the renderer drives from an explicit frame counter.
 *
 * Every layer declares a **procedural silhouette spec** (polygon
 * fills: hills / columns / stalactites / clouds) and may *optionally*
 * name a texture key from the M1 Kenney background tiles. The
 * renderer prefers the texture when it is present in the cache and
 * falls back to the procedural shapes otherwise — so themes stay
 * distinct and atmospheric even on a build where the art never
 * loaded (or in the Node test environment, where nothing loads).
 *
 * Determinism contract (project rule):
 *   - No `Math.random()`. Decorative scatter uses a fixed-seed LCG —
 *     the same `(spec, viewport)` input always yields byte-identical
 *     polygons, matching the `paintMenuBackground` precedent in
 *     `src/ui/menuTheme.ts`.
 *   - No wall-clock reads. The ambient pulse is a pure function of an
 *     explicit frame counter (see {@link computeAmbientPulseAlpha}).
 *
 * Architecture note: this module owns all the *data and math*; the
 * Phaser-touching painter lives in `StageBackgroundRenderer.ts`. Keep
 * it that way — this file must stay importable under plain Node so
 * `backgroundThemes.test.ts` runs without jsdom.
 */

import { ASSET_KEYS } from '../assets/manifest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Ids of every built-in background theme. */
export type StageBackgroundThemeId =
  | 'lava-cavern'
  | 'wind-canyon'
  | 'crumbling-temple'
  | 'sky-ferry'
  | 'midnight';

/**
 * Silhouette families the procedural fallback can draw. Each maps to
 * a polygon generator in {@link buildProceduralLayerPolygons}:
 *
 *   - `'hills'`       — rounded mounds rising from a baseline
 *                       (dunes, magma mounds, distant ridge lines).
 *   - `'columns'`     — tapered vertical slabs rising from a baseline
 *                       (temple columns, canyon mesas, rock pillars).
 *   - `'stalactites'` — triangles hanging from a ceiling line
 *                       (cavern roofs).
 *   - `'clouds'`      — irregular puffy blobs scattered around a
 *                       horizontal band (open-sky stages).
 */
export type ProceduralShapeKind = 'hills' | 'columns' | 'stalactites' | 'clouds';

/**
 * Procedural silhouette spec — the always-available fallback for a
 * parallax layer. All vertical measures are *fractions of the
 * viewport height* so the same spec scales from a 1280×720 laptop
 * window to the 1920×1080 design viewport without re-authoring.
 */
export interface ProceduralLayerSpec {
  /** Which silhouette family to generate. */
  readonly kind: ProceduralShapeKind;
  /** Flat fill colour (0xRRGGBB) — silhouettes are single-colour. */
  readonly color: number;
  /** How many shapes to scatter across the (overscanned) span. */
  readonly count: number;
  /**
   * Fixed LCG seed for this layer's scatter. Distinct per layer so
   * two layers of the same kind don't produce aligned shapes.
   */
  readonly seed: number;
  /**
   * Vertical anchor as a fraction of viewport height. For `'hills'` /
   * `'columns'` this is the baseline the shapes rise from (≥ 1 tucks
   * the seam below the bottom edge); for `'stalactites'` it is the
   * ceiling line they hang from (usually 0); for `'clouds'` it is the
   * centre of the scatter band.
   */
  readonly baseFraction: number;
  /** Tallest shape extent as a fraction of viewport height. */
  readonly heightFraction: number;
}

/**
 * One parallax layer of a theme. Painted back-to-front in array
 * order — index 0 is the farthest (smallest factor), the last entry
 * the nearest.
 */
export interface ParallaxLayerSpec {
  /** Stable id, handy for debugging and test assertions. */
  readonly id: string;
  /**
   * How much of the camera scroll this layer absorbs, in
   * [{@link BACKGROUND_PARALLAX_MIN}, {@link BACKGROUND_PARALLAX_MAX}].
   * The renderer applies `offset = -scroll * parallaxFactor`.
   */
  readonly parallaxFactor: number;
  /** Layer opacity in (0, 1]. */
  readonly alpha: number;
  /** Optional tint applied to the *texture* variant (0xRRGGBB). */
  readonly tint?: number;
  /**
   * Optional texture key (an `ASSET_KEYS.stageBg*` image). When the
   * key exists in the scene's texture cache the renderer paints a
   * `TileSprite` band; otherwise it paints {@link ParallaxLayerSpec.procedural}.
   */
  readonly textureKey?: string;
  /**
   * Integer upscale for the 24×24 source tile when rendered as a
   * TileSprite band (pixel-art tiles are unreadable at 1:1 on a
   * 1080p viewport). Defaults to {@link DEFAULT_TEXTURE_TILE_SCALE}.
   */
  readonly textureTileScale?: number;
  /**
   * Vertical centre of the texture band as a fraction of viewport
   * height. Defaults to 0.5 (mid-screen horizon).
   */
  readonly textureYFraction?: number;
  /**
   * Procedural fallback — ALWAYS present, so a theme renders
   * atmospherically even when no texture is loaded.
   */
  readonly procedural: ProceduralLayerSpec;
}

/**
 * Slow ambient accent pulse — e.g. the lava cavern's molten glow
 * breathing in and out. Driven by an explicit frame counter (never
 * scene time) via {@link computeAmbientPulseAlpha}.
 */
export interface AmbientPulseSpec {
  /** Full pulse period in frames (one min→max→min cycle). */
  readonly periodFrames: number;
  /** Accent overlay alpha at the trough of the pulse. */
  readonly minAlpha: number;
  /** Accent overlay alpha at the apex of the pulse. */
  readonly maxAlpha: number;
}

/** A complete themed background description. */
export interface StageBackgroundTheme {
  readonly id: StageBackgroundThemeId;
  /** Gradient colour at the top of the viewport (0xRRGGBB). */
  readonly gradientTop: number;
  /** Gradient colour at the bottom of the viewport (0xRRGGBB). */
  readonly gradientBottom: number;
  /** Ambient accent colour washed over the scene at low alpha. */
  readonly ambientAccent: number;
  /** Pulse timing for the ambient accent overlay. */
  readonly ambientPulse: AmbientPulseSpec;
  /** Parallax layers, back (index 0) to front (last index). 2–3 entries. */
  readonly layers: ReadonlyArray<ParallaxLayerSpec>;
}

/** A single closed silhouette polygon in viewport pixels. */
export interface BackgroundPolygon {
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Inclusive bounds every theme's `parallaxFactor` must respect. */
export const BACKGROUND_PARALLAX_MIN = 0.1;
export const BACKGROUND_PARALLAX_MAX = 0.6;

/**
 * Horizontal overscan, as a fraction of viewport width, applied on
 * BOTH sides when generating procedural polygons. Parallax slides the
 * silhouette graphics by `-scroll * factor`; overscanning by half a
 * viewport on each side keeps the silhouettes seamless for any scroll
 * the dynamic match camera can produce (blast zones extend ~700 design
 * px past the viewport; 700 × max factor 0.6 = 420 px ≪ 960 px).
 */
export const BACKGROUND_OVERSCAN_FRACTION = 0.5;

/** Native edge size of the Kenney background tiles, in pixels. */
export const BACKGROUND_TEXTURE_TILE_SIZE = 24;

/** Default upscale for texture bands when a layer doesn't override it. */
export const DEFAULT_TEXTURE_TILE_SCALE = 4;

/**
 * Depth plan for the background stack. Platform visuals render at
 * Phaser's default depth 0, so everything here sits strictly behind
 * the stage geometry:
 *
 *   gradient   -60
 *   layer 0    -50   (farthest)
 *   layer 1    -42
 *   layer 2    -34   (nearest — clamped to stay ≤ -31)
 *   ambient    -30   (accent wash, in front of the silhouettes)
 */
export const BACKGROUND_GRADIENT_DEPTH = -60;
export const BACKGROUND_LAYER_DEPTH_BASE = -50;
export const BACKGROUND_LAYER_DEPTH_STEP = 8;
export const BACKGROUND_LAYER_DEPTH_LIMIT = -31;
export const BACKGROUND_AMBIENT_DEPTH = -30;

/**
 * Depth for a parallax layer by its index in `theme.layers`. Pure —
 * exported so the renderer and its tests share one source of truth.
 * Clamped to {@link BACKGROUND_LAYER_DEPTH_LIMIT} so even a future
 * 4-layer theme never reaches the ambient overlay or the platforms.
 */
export function backgroundLayerDepth(layerIndex: number): number {
  const i = Math.max(0, Math.trunc(layerIndex));
  return Math.min(
    BACKGROUND_LAYER_DEPTH_BASE + i * BACKGROUND_LAYER_DEPTH_STEP,
    BACKGROUND_LAYER_DEPTH_LIMIT,
  );
}

// ---------------------------------------------------------------------------
// Theme registry
// ---------------------------------------------------------------------------

/** Deep-freeze a theme so the registry is immutable all the way down. */
function freezeTheme(theme: StageBackgroundTheme): StageBackgroundTheme {
  for (const layer of theme.layers) {
    Object.freeze(layer.procedural);
    Object.freeze(layer);
  }
  Object.freeze(theme.layers);
  Object.freeze(theme.ambientPulse);
  return Object.freeze(theme);
}

/**
 * Lava cavern — warm dark reds and oranges. Stalactites hang from the
 * cavern roof in the far distance, magma mounds glow at mid depth, and
 * scorched rock pillars frame the foreground. The ambient pulse is the
 * strongest of any theme: the whole cavern breathes with the molten
 * glow on a ~4 s cycle, echoing the lava pools' rise/fall pacing.
 */
const LAVA_CAVERN_THEME = freezeTheme({
  id: 'lava-cavern',
  gradientTop: 0x1c0a0e,
  gradientBottom: 0x4a1410,
  ambientAccent: 0xff7a2e,
  ambientPulse: { periodFrames: 240, minAlpha: 0.04, maxAlpha: 0.13 },
  layers: [
    {
      id: 'lava-stalactites-far',
      parallaxFactor: 0.12,
      alpha: 0.85,
      procedural: {
        kind: 'stalactites',
        color: 0x2a0d12,
        count: 14,
        seed: 0x1aba0001,
        baseFraction: 0,
        heightFraction: 0.34,
      },
    },
    {
      // Mid layer reuses the Kenney dune crest tinted deep ember so the
      // textured build reads as banked magma mounds; the procedural
      // fallback draws the same mounds as flat hills.
      id: 'lava-mounds-mid',
      parallaxFactor: 0.3,
      alpha: 0.9,
      textureKey: ASSET_KEYS.stageBgDunes,
      tint: 0x8a2e18,
      textureTileScale: 6,
      textureYFraction: 0.78,
      procedural: {
        kind: 'hills',
        color: 0x471310,
        count: 7,
        seed: 0x1aba0002,
        baseFraction: 1.02,
        heightFraction: 0.42,
      },
    },
    {
      id: 'lava-pillars-near',
      parallaxFactor: 0.5,
      alpha: 0.95,
      procedural: {
        kind: 'columns',
        color: 0x35100f,
        count: 6,
        seed: 0x1aba0003,
        baseFraction: 1.04,
        heightFraction: 0.58,
      },
    },
  ],
});

/**
 * Wind canyon — cool blues and teals. A distant ridge line (the Kenney
 * hill crest tinted teal when loaded), weathered mesas at mid depth,
 * and tall canyon walls up close. The faint cyan ambient shimmer reads
 * as wind-blown haze drifting through the canyon.
 */
const WIND_CANYON_THEME = freezeTheme({
  id: 'wind-canyon',
  gradientTop: 0x0c1a28,
  gradientBottom: 0x1d3c4e,
  ambientAccent: 0x7fe0ee,
  ambientPulse: { periodFrames: 360, minAlpha: 0.02, maxAlpha: 0.07 },
  layers: [
    {
      id: 'wind-ridge-far',
      parallaxFactor: 0.1,
      alpha: 0.8,
      textureKey: ASSET_KEYS.stageBgHills,
      tint: 0x2a6878,
      textureTileScale: 6,
      textureYFraction: 0.66,
      procedural: {
        kind: 'hills',
        color: 0x142e3c,
        count: 8,
        seed: 0x3144d001,
        baseFraction: 1.0,
        heightFraction: 0.3,
      },
    },
    {
      id: 'wind-mesas-mid',
      parallaxFactor: 0.32,
      alpha: 0.88,
      procedural: {
        kind: 'columns',
        color: 0x16323f,
        count: 7,
        seed: 0x3144d002,
        baseFraction: 1.02,
        heightFraction: 0.46,
      },
    },
    {
      id: 'wind-walls-near',
      parallaxFactor: 0.55,
      alpha: 0.95,
      procedural: {
        kind: 'columns',
        color: 0x1f4654,
        count: 5,
        seed: 0x3144d003,
        baseFraction: 1.05,
        heightFraction: 0.62,
      },
    },
  ],
});

/**
 * Crumbling temple — sandy stone under a dusty dusk sky. Far dunes
 * (the Kenney dune crest, untinted, when loaded), a colonnade of
 * eroded temple columns at mid depth, and massive broken pillars in
 * the foreground. The pale-gold ambient wash flickers slowly like
 * heat haze off the sand.
 */
const CRUMBLING_TEMPLE_THEME = freezeTheme({
  id: 'crumbling-temple',
  gradientTop: 0x2a2114,
  gradientBottom: 0x55432a,
  ambientAccent: 0xe8c87c,
  ambientPulse: { periodFrames: 300, minAlpha: 0.03, maxAlpha: 0.08 },
  layers: [
    {
      id: 'temple-dunes-far',
      parallaxFactor: 0.12,
      alpha: 0.75,
      textureKey: ASSET_KEYS.stageBgDunes,
      textureTileScale: 6,
      textureYFraction: 0.7,
      procedural: {
        kind: 'hills',
        color: 0x3a2f1d,
        count: 8,
        seed: 0x7e4f1e01,
        baseFraction: 1.0,
        heightFraction: 0.28,
      },
    },
    {
      id: 'temple-colonnade-mid',
      parallaxFactor: 0.32,
      alpha: 0.85,
      procedural: {
        kind: 'columns',
        color: 0x4a3a24,
        count: 8,
        seed: 0x7e4f1e02,
        baseFraction: 1.02,
        heightFraction: 0.44,
      },
    },
    {
      id: 'temple-pillars-near',
      parallaxFactor: 0.55,
      alpha: 0.92,
      procedural: {
        kind: 'columns',
        color: 0x5c4a2e,
        count: 5,
        seed: 0x7e4f1e03,
        baseFraction: 1.06,
        heightFraction: 0.6,
      },
    },
  ],
});

/**
 * Sky ferry — open sky for the moving-platform stage. Bright blue
 * gradient falling to a hazy horizon, with three cloud strata: a far
 * scatter of small puffs, a mid cumulus band (Kenney cloud tile when
 * loaded) and near drifting wisps. The white ambient shimmer is the
 * sun catching the haze.
 */
const SKY_FERRY_THEME = freezeTheme({
  id: 'sky-ferry',
  gradientTop: 0x2e6da4,
  gradientBottom: 0xa7d4ec,
  ambientAccent: 0xffffff,
  ambientPulse: { periodFrames: 420, minAlpha: 0.02, maxAlpha: 0.06 },
  layers: [
    {
      id: 'sky-puffs-far',
      parallaxFactor: 0.1,
      alpha: 0.7,
      procedural: {
        kind: 'clouds',
        color: 0xcfe6f4,
        count: 9,
        seed: 0x5f17e001,
        baseFraction: 0.28,
        heightFraction: 0.08,
      },
    },
    {
      id: 'sky-cumulus-mid',
      parallaxFactor: 0.3,
      alpha: 0.9,
      textureKey: ASSET_KEYS.stageBgClouds,
      textureTileScale: 5,
      textureYFraction: 0.42,
      procedural: {
        kind: 'clouds',
        color: 0xe8f3fa,
        count: 6,
        seed: 0x5f17e002,
        baseFraction: 0.45,
        heightFraction: 0.11,
      },
    },
    {
      id: 'sky-wisps-near',
      parallaxFactor: 0.55,
      alpha: 0.8,
      textureKey: ASSET_KEYS.stageBgWisps,
      textureTileScale: 5,
      textureYFraction: 0.62,
      procedural: {
        kind: 'clouds',
        color: 0xf4fafd,
        count: 4,
        seed: 0x5f17e003,
        baseFraction: 0.66,
        heightFraction: 0.13,
      },
    },
  ],
});

/**
 * Midnight — the neutral dark default for the flat stage and for any
 * custom / legacy layout that doesn't name a theme. Deliberately
 * close to the historical `#13131f` clear colour so the M1 look
 * survives, but with two dim ridge lines and a whisper of the
 * signature teal accent so it no longer reads as a void.
 */
const MIDNIGHT_THEME = freezeTheme({
  id: 'midnight',
  gradientTop: 0x0d0d16,
  gradientBottom: 0x191926,
  ambientAccent: 0x6cf0c2,
  ambientPulse: { periodFrames: 480, minAlpha: 0.015, maxAlpha: 0.045 },
  layers: [
    {
      id: 'midnight-ridge-far',
      parallaxFactor: 0.12,
      alpha: 0.9,
      procedural: {
        kind: 'hills',
        color: 0x16161f,
        count: 7,
        seed: 0x0d111601,
        baseFraction: 1.0,
        heightFraction: 0.3,
      },
    },
    {
      id: 'midnight-ridge-near',
      parallaxFactor: 0.4,
      alpha: 0.95,
      procedural: {
        kind: 'hills',
        color: 0x1d1d2c,
        count: 5,
        seed: 0x0d111602,
        baseFraction: 1.03,
        heightFraction: 0.42,
      },
    },
  ],
});

/**
 * Frozen registry of every built-in background theme, keyed by id.
 * `StageLayout.backgroundTheme` values resolve against this table via
 * {@link getBackgroundTheme}.
 */
export const STAGE_BACKGROUND_THEMES: Readonly<
  Record<StageBackgroundThemeId, StageBackgroundTheme>
> = Object.freeze({
  'lava-cavern': LAVA_CAVERN_THEME,
  'wind-canyon': WIND_CANYON_THEME,
  'crumbling-temple': CRUMBLING_TEMPLE_THEME,
  'sky-ferry': SKY_FERRY_THEME,
  midnight: MIDNIGHT_THEME,
});

/**
 * Theme used when a layout omits `backgroundTheme` or names an id the
 * registry doesn't know (e.g. a custom stage exported from a newer
 * build). Neutral dark — visually closest to the pre-theme look.
 */
export const DEFAULT_BACKGROUND_THEME_ID: StageBackgroundThemeId = 'midnight';

/** Type guard: is `value` a registered background theme id? */
export function isStageBackgroundThemeId(
  value: string | undefined,
): value is StageBackgroundThemeId {
  return value !== undefined && value in STAGE_BACKGROUND_THEMES;
}

/**
 * Resolve a layout's `backgroundTheme` string to a registered theme,
 * falling back to {@link DEFAULT_BACKGROUND_THEME_ID} for missing or
 * unknown ids. Never throws — an unknown id is an aesthetic downgrade,
 * not an error worth aborting a match over.
 */
export function getBackgroundTheme(themeId?: string): StageBackgroundTheme {
  if (isStageBackgroundThemeId(themeId)) {
    return STAGE_BACKGROUND_THEMES[themeId];
  }
  return STAGE_BACKGROUND_THEMES[DEFAULT_BACKGROUND_THEME_ID];
}

// ---------------------------------------------------------------------------
// Procedural silhouette generation
// ---------------------------------------------------------------------------

/**
 * Fixed-seed LCG (same constants as `paintMenuBackground` in
 * `src/ui/menuTheme.ts`) — the project-standard replacement for
 * `Math.random()` in decorative scatter. Returns values in [0, 1).
 */
function createLcg(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Generate the silhouette polygons for one procedural layer. Pure and
 * deterministic: the same `(spec, viewportWidth, viewportHeight)`
 * always yields byte-identical output, so two clients rendering the
 * same stage see pixel-identical backdrops.
 *
 * Shapes are scattered across a span overscanned by
 * {@link BACKGROUND_OVERSCAN_FRACTION} of the viewport width on each
 * side, so the painter can slide the layer for parallax without ever
 * exposing a bare edge.
 */
export function buildProceduralLayerPolygons(
  spec: ProceduralLayerSpec,
  viewportWidth: number,
  viewportHeight: number,
): readonly BackgroundPolygon[] {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    throw new Error(
      `buildProceduralLayerPolygons: viewport must be positive, ` +
        `got ${viewportWidth}×${viewportHeight}.`,
    );
  }
  if (!Number.isInteger(spec.count) || spec.count < 1) {
    throw new Error(
      `buildProceduralLayerPolygons: spec.count must be an integer >= 1, got ${spec.count}.`,
    );
  }

  const rand = createLcg(spec.seed);
  const overscan = viewportWidth * BACKGROUND_OVERSCAN_FRACTION;
  const spanStart = -overscan;
  const spanWidth = viewportWidth + overscan * 2;
  const slotW = spanWidth / spec.count;

  const polygons: BackgroundPolygon[] = [];

  for (let i = 0; i < spec.count; i += 1) {
    // Slot-centred placement + bounded jitter keeps shapes spread
    // evenly across the span (no clumping) while still looking organic.
    const cx = spanStart + (i + 0.5) * slotW + (rand() - 0.5) * slotW * 0.4;

    switch (spec.kind) {
      case 'hills': {
        const baseY = viewportHeight * spec.baseFraction;
        const halfW = slotW * (0.55 + rand() * 0.35);
        const h = viewportHeight * spec.heightFraction * (0.55 + rand() * 0.45);
        polygons.push({
          points: [
            { x: cx - halfW, y: baseY },
            { x: cx - halfW * 0.5, y: baseY - h * 0.72 },
            { x: cx, y: baseY - h },
            { x: cx + halfW * 0.55, y: baseY - h * 0.66 },
            { x: cx + halfW, y: baseY },
          ],
        });
        break;
      }
      case 'columns': {
        const baseY = viewportHeight * spec.baseFraction;
        const halfBase = slotW * (0.11 + rand() * 0.09);
        const h = viewportHeight * spec.heightFraction * (0.5 + rand() * 0.5);
        // Slight taper: the top is a touch narrower than the base, so
        // slabs read as weathered pillars instead of crisp rectangles.
        const halfTop = halfBase * (0.72 + rand() * 0.2);
        polygons.push({
          points: [
            { x: cx - halfBase, y: baseY },
            { x: cx - halfTop, y: baseY - h },
            { x: cx + halfTop, y: baseY - h },
            { x: cx + halfBase, y: baseY },
          ],
        });
        break;
      }
      case 'stalactites': {
        const topY = viewportHeight * spec.baseFraction;
        const halfW = slotW * (0.18 + rand() * 0.22);
        const depth = viewportHeight * spec.heightFraction * (0.45 + rand() * 0.55);
        polygons.push({
          points: [
            { x: cx - halfW, y: topY },
            { x: cx + halfW, y: topY },
            { x: cx + (rand() - 0.5) * halfW * 0.6, y: topY + depth },
          ],
        });
        break;
      }
      case 'clouds': {
        const cy =
          viewportHeight * spec.baseFraction +
          (rand() - 0.5) * viewportHeight * 0.18;
        const w = slotW * (0.5 + rand() * 0.45);
        const h = Math.max(
          w * 0.28,
          viewportHeight * spec.heightFraction * (0.5 + rand() * 0.5),
        );
        // Irregular hexagonal blob — cheap, and at silhouette alpha it
        // reads as a soft cumulus puff.
        polygons.push({
          points: [
            { x: cx - w * 0.5, y: cy + h * 0.1 },
            { x: cx - w * 0.3, y: cy - h * 0.5 },
            { x: cx + w * 0.22, y: cy - h * 0.55 },
            { x: cx + w * 0.5, y: cy - h * 0.05 },
            { x: cx + w * 0.36, y: cy + h * 0.45 },
            { x: cx - w * 0.3, y: cy + h * 0.5 },
          ],
        });
        break;
      }
    }
  }

  return polygons;
}

// ---------------------------------------------------------------------------
// Ambient pulse
// ---------------------------------------------------------------------------

/**
 * Alpha of the ambient accent overlay at a given frame. Pure cosine
 * pulse: starts at `minAlpha` on frame 0, peaks at `maxAlpha` half a
 * period in, and returns — so `f(0) === f(periodFrames)` and the glow
 * loops seamlessly. Driven by the owning scene's fixed-step frame
 * counter, NOT scene time, keeping replays pixel-identical.
 */
export function computeAmbientPulseAlpha(
  pulse: AmbientPulseSpec,
  frame: number,
): number {
  const period = Math.max(2, Math.trunc(pulse.periodFrames));
  const phase = ((Math.trunc(frame) % period) + period) % period;
  const wave = 0.5 - 0.5 * Math.cos((2 * Math.PI * phase) / period);
  return pulse.minAlpha + (pulse.maxAlpha - pulse.minAlpha) * wave;
}
