import { describe, it, expect } from 'vitest';
import {
  BACKGROUND_AMBIENT_DEPTH,
  BACKGROUND_GRADIENT_DEPTH,
  BACKGROUND_LAYER_DEPTH_LIMIT,
  BACKGROUND_OVERSCAN_FRACTION,
  BACKGROUND_PARALLAX_MAX,
  BACKGROUND_PARALLAX_MIN,
  DEFAULT_BACKGROUND_THEME_ID,
  STAGE_BACKGROUND_THEMES,
  backgroundLayerDepth,
  buildProceduralLayerPolygons,
  computeAmbientPulseAlpha,
  getBackgroundTheme,
  isStageBackgroundThemeId,
  type ProceduralLayerSpec,
  type StageBackgroundThemeId,
} from './backgroundThemes';
import { STAGES } from './stageDefinitions';

/**
 * Theme registry contract tests. The registry is pure data consumed
 * by `StageBackgroundRenderer`; these checks lock down the invariants
 * the painter (and the scene wiring) are allowed to assume:
 *
 *   1. Every built-in stage's `backgroundTheme` resolves to a
 *      registered theme — no stage silently falls through to the
 *      midnight default by accident.
 *   2. The registry is deeply frozen (project immutability rule).
 *   3. Parallax factors stay in the agreed [0.1, 0.6] band, alphas in
 *      (0, 1], and every layer carries a procedural fallback so the
 *      backdrop renders even when no texture loaded.
 *   4. Procedural polygon generation is deterministic (fixed-seed LCG,
 *      never `Math.random()`), and the ambient pulse is a pure,
 *      periodic function of the frame counter.
 */

const ALL_THEME_IDS = Object.keys(STAGE_BACKGROUND_THEMES) as StageBackgroundThemeId[];

describe('STAGE_BACKGROUND_THEMES — registry shape', () => {
  it('registers exactly the five built-in themes', () => {
    expect(new Set(ALL_THEME_IDS)).toEqual(
      new Set([
        'lava-cavern',
        'wind-canyon',
        'crumbling-temple',
        'sky-ferry',
        'midnight',
      ]),
    );
  });

  it('every theme id matches its registry key', () => {
    for (const id of ALL_THEME_IDS) {
      expect(STAGE_BACKGROUND_THEMES[id].id).toBe(id);
    }
  });

  it('is deeply frozen — registry, themes, layer arrays, specs, pulse', () => {
    expect(Object.isFrozen(STAGE_BACKGROUND_THEMES)).toBe(true);
    for (const id of ALL_THEME_IDS) {
      const theme = STAGE_BACKGROUND_THEMES[id];
      expect(Object.isFrozen(theme)).toBe(true);
      expect(Object.isFrozen(theme.layers)).toBe(true);
      expect(Object.isFrozen(theme.ambientPulse)).toBe(true);
      for (const layer of theme.layers) {
        expect(Object.isFrozen(layer)).toBe(true);
        expect(Object.isFrozen(layer.procedural)).toBe(true);
      }
    }
  });

  it('every theme declares 2–3 parallax layers, back-to-front by factor', () => {
    for (const id of ALL_THEME_IDS) {
      const layers = STAGE_BACKGROUND_THEMES[id].layers;
      expect(layers.length).toBeGreaterThanOrEqual(2);
      expect(layers.length).toBeLessThanOrEqual(3);
      // Back-to-front ordering: farther layers (earlier indices) must
      // absorb less scroll than nearer ones.
      for (let i = 1; i < layers.length; i += 1) {
        expect(layers[i]!.parallaxFactor).toBeGreaterThan(
          layers[i - 1]!.parallaxFactor,
        );
      }
    }
  });

  it('keeps every parallax factor within the agreed [0.1, 0.6] band', () => {
    for (const id of ALL_THEME_IDS) {
      for (const layer of STAGE_BACKGROUND_THEMES[id].layers) {
        expect(layer.parallaxFactor).toBeGreaterThanOrEqual(BACKGROUND_PARALLAX_MIN);
        expect(layer.parallaxFactor).toBeLessThanOrEqual(BACKGROUND_PARALLAX_MAX);
      }
    }
  });

  it('keeps layer alphas in (0, 1] and colours in 24-bit range', () => {
    const isColor = (c: number) =>
      Number.isInteger(c) && c >= 0 && c <= 0xffffff;
    for (const id of ALL_THEME_IDS) {
      const theme = STAGE_BACKGROUND_THEMES[id];
      expect(isColor(theme.gradientTop)).toBe(true);
      expect(isColor(theme.gradientBottom)).toBe(true);
      expect(isColor(theme.ambientAccent)).toBe(true);
      for (const layer of theme.layers) {
        expect(layer.alpha).toBeGreaterThan(0);
        expect(layer.alpha).toBeLessThanOrEqual(1);
        expect(isColor(layer.procedural.color)).toBe(true);
        if (layer.tint !== undefined) {
          expect(isColor(layer.tint)).toBe(true);
        }
      }
    }
  });

  it('every layer carries a procedural fallback with sane scatter params', () => {
    for (const id of ALL_THEME_IDS) {
      for (const layer of STAGE_BACKGROUND_THEMES[id].layers) {
        const p = layer.procedural;
        expect(['hills', 'columns', 'stalactites', 'clouds']).toContain(p.kind);
        expect(Number.isInteger(p.count) && p.count >= 1).toBe(true);
        expect(p.heightFraction).toBeGreaterThan(0);
        expect(p.heightFraction).toBeLessThan(1);
      }
    }
  });

  it('ambient pulses are slow (>= 2 frames) with minAlpha <= maxAlpha <= 1', () => {
    for (const id of ALL_THEME_IDS) {
      const pulse = STAGE_BACKGROUND_THEMES[id].ambientPulse;
      expect(pulse.periodFrames).toBeGreaterThanOrEqual(2);
      expect(pulse.minAlpha).toBeGreaterThanOrEqual(0);
      expect(pulse.maxAlpha).toBeGreaterThanOrEqual(pulse.minAlpha);
      expect(pulse.maxAlpha).toBeLessThanOrEqual(1);
    }
  });

  it('themes are visually distinct — no two share a gradient pair', () => {
    const signatures = ALL_THEME_IDS.map((id) => {
      const t = STAGE_BACKGROUND_THEMES[id];
      return `${t.gradientTop}:${t.gradientBottom}`;
    });
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});

describe('built-in stage → theme mapping', () => {
  it('every registered stage names a registered background theme', () => {
    for (const [stageId, layout] of Object.entries(STAGES)) {
      expect(
        layout.backgroundTheme,
        `stage '${stageId}' must declare backgroundTheme`,
      ).toBeDefined();
      expect(
        isStageBackgroundThemeId(layout.backgroundTheme),
        `stage '${stageId}' names unknown theme '${layout.backgroundTheme}'`,
      ).toBe(true);
    }
  });

  it('maps each stage to its designated theme', () => {
    expect(STAGES['lava']?.backgroundTheme).toBe('lava-cavern');
    expect(STAGES['wind']?.backgroundTheme).toBe('wind-canyon');
    expect(STAGES['crumbling']?.backgroundTheme).toBe('crumbling-temple');
    expect(STAGES['moving-platform']?.backgroundTheme).toBe('sky-ferry');
    expect(STAGES['flat']?.backgroundTheme).toBe('midnight');
  });
});

describe('getBackgroundTheme()', () => {
  it('resolves every registered id to its theme', () => {
    for (const id of ALL_THEME_IDS) {
      expect(getBackgroundTheme(id)).toBe(STAGE_BACKGROUND_THEMES[id]);
    }
  });

  it('falls back to midnight for undefined and unknown ids', () => {
    const midnight = STAGE_BACKGROUND_THEMES[DEFAULT_BACKGROUND_THEME_ID];
    expect(getBackgroundTheme(undefined)).toBe(midnight);
    expect(getBackgroundTheme('volcano-deluxe')).toBe(midnight);
    expect(getBackgroundTheme('')).toBe(midnight);
  });
});

describe('backgroundLayerDepth()', () => {
  it('keeps every layer strictly between the gradient and the platforms', () => {
    for (let i = 0; i < 4; i += 1) {
      const depth = backgroundLayerDepth(i);
      expect(depth).toBeGreaterThan(BACKGROUND_GRADIENT_DEPTH);
      expect(depth).toBeLessThanOrEqual(BACKGROUND_LAYER_DEPTH_LIMIT);
      expect(depth).toBeLessThan(0); // platforms render at default depth 0
    }
  });

  it('is monotonically non-decreasing so later layers paint in front', () => {
    for (let i = 1; i < 6; i += 1) {
      expect(backgroundLayerDepth(i)).toBeGreaterThanOrEqual(
        backgroundLayerDepth(i - 1),
      );
    }
  });

  it('keeps the ambient wash in front of every layer', () => {
    expect(BACKGROUND_AMBIENT_DEPTH).toBeGreaterThan(backgroundLayerDepth(99));
    expect(BACKGROUND_AMBIENT_DEPTH).toBeLessThan(0);
  });
});

describe('buildProceduralLayerPolygons()', () => {
  const baseSpec: ProceduralLayerSpec = {
    kind: 'hills',
    color: 0x16161f,
    count: 7,
    seed: 0xc0ffee,
    baseFraction: 1.0,
    heightFraction: 0.3,
  };

  it('is deterministic — identical inputs yield byte-identical polygons', () => {
    const a = buildProceduralLayerPolygons(baseSpec, 1920, 1080);
    const b = buildProceduralLayerPolygons(baseSpec, 1920, 1080);
    expect(a).toEqual(b);
  });

  it('produces one polygon per requested shape', () => {
    for (const kind of ['hills', 'columns', 'stalactites', 'clouds'] as const) {
      const polys = buildProceduralLayerPolygons(
        { ...baseSpec, kind, baseFraction: kind === 'stalactites' ? 0 : 0.9 },
        1920,
        1080,
      );
      expect(polys.length).toBe(baseSpec.count);
      for (const poly of polys) {
        expect(poly.points.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('scatters shapes across the overscanned span (covers both off-screen wings)', () => {
    const width = 1920;
    const overscan = width * BACKGROUND_OVERSCAN_FRACTION;
    const polys = buildProceduralLayerPolygons(
      { ...baseSpec, count: 12 },
      width,
      1080,
    );
    const xs = polys.flatMap((p) => p.points.map((pt) => pt.x));
    // Shapes never wander past the overscan window (with a slot of
    // slack for jitter + half-widths)...
    const slot = (width + overscan * 2) / 12;
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-overscan - slot);
    expect(Math.max(...xs)).toBeLessThanOrEqual(width + overscan + slot);
    // ...and at least one shape lands in each off-screen wing, so a
    // parallax slide can't expose a bare edge.
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(width);
  });

  it('different seeds produce different scatter', () => {
    const a = buildProceduralLayerPolygons(baseSpec, 1920, 1080);
    const b = buildProceduralLayerPolygons({ ...baseSpec, seed: 0xdead }, 1920, 1080);
    expect(a).not.toEqual(b);
  });

  it('rejects non-positive viewports and zero counts loudly', () => {
    expect(() => buildProceduralLayerPolygons(baseSpec, 0, 1080)).toThrow();
    expect(() => buildProceduralLayerPolygons(baseSpec, 1920, -1)).toThrow();
    expect(() =>
      buildProceduralLayerPolygons({ ...baseSpec, count: 0 }, 1920, 1080),
    ).toThrow();
  });

  it('every theme layer fallback generates without throwing at design size', () => {
    for (const id of ALL_THEME_IDS) {
      for (const layer of STAGE_BACKGROUND_THEMES[id].layers) {
        const polys = buildProceduralLayerPolygons(layer.procedural, 1920, 1080);
        expect(polys.length).toBe(layer.procedural.count);
      }
    }
  });
});

describe('computeAmbientPulseAlpha()', () => {
  const pulse = { periodFrames: 240, minAlpha: 0.04, maxAlpha: 0.13 };

  it('starts at minAlpha and peaks at maxAlpha half a period in', () => {
    expect(computeAmbientPulseAlpha(pulse, 0)).toBeCloseTo(pulse.minAlpha, 10);
    expect(computeAmbientPulseAlpha(pulse, 120)).toBeCloseTo(pulse.maxAlpha, 10);
  });

  it('stays within [minAlpha, maxAlpha] across a full cycle', () => {
    for (let frame = 0; frame <= 240; frame += 7) {
      const a = computeAmbientPulseAlpha(pulse, frame);
      expect(a).toBeGreaterThanOrEqual(pulse.minAlpha);
      expect(a).toBeLessThanOrEqual(pulse.maxAlpha);
    }
  });

  it('loops seamlessly — f(frame) === f(frame + period)', () => {
    for (const frame of [0, 13, 119, 233]) {
      expect(computeAmbientPulseAlpha(pulse, frame + 240)).toBeCloseTo(
        computeAmbientPulseAlpha(pulse, frame),
        10,
      );
    }
  });

  it('is a pure function of the frame counter (replay determinism)', () => {
    expect(computeAmbientPulseAlpha(pulse, 42)).toBe(
      computeAmbientPulseAlpha(pulse, 42),
    );
  });
});
