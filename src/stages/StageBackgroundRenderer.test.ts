import { describe, it, expect } from 'vitest';
import { renderStageBackground } from './StageBackgroundRenderer';
import {
  BACKGROUND_AMBIENT_DEPTH,
  BACKGROUND_GRADIENT_DEPTH,
  BACKGROUND_LAYER_DEPTH_LIMIT,
  BACKGROUND_LAYER_DEPTH_BASE,
  DEFAULT_TEXTURE_TILE_SCALE,
  STAGE_BACKGROUND_THEMES,
  computeAmbientPulseAlpha,
} from './backgroundThemes';
import {
  FLAT_STAGE,
  LAVA_STAGE,
  MOVING_PLATFORM_STAGE,
  STAGE_DESIGN_WIDTH,
  STAGE_DESIGN_HEIGHT,
} from './stageDefinitions';
import type { StageLayout } from '../types';

/**
 * `renderStageBackground()` is a Phaser scene helper, so — exactly
 * like `StageRenderer.test.ts` — we feed it a thin mock scene that
 * records every game object it would create. That locks down the
 * painter's *contract* without needing jsdom + Phaser:
 *
 *   - gradient painted first with the theme's colours, behind everything;
 *   - one layer object per theme layer, procedural Graphics when the
 *     texture cache is empty, TileSprite bands when textures exist;
 *   - `updateParallax` moves each layer by `-scroll * parallaxFactor`
 *     (tilePosition-scrolled for texture bands);
 *   - `tick(frame)` drives the ambient pulse off the explicit frame
 *     counter (never scene time);
 *   - `destroy()` tears everything down exactly once, idempotently.
 */

interface MockGraphics {
  readonly type: 'graphics';
  x: number;
  y: number;
  depth: number;
  alpha: number;
  scrollFactorX?: number;
  destroyed: boolean;
  /** Recorded drawing calls, in order, for shape assertions. */
  calls: Array<{ method: string; args: unknown[] }>;
  setDepth(d: number): MockGraphics;
  setScrollFactor(f: number): MockGraphics;
  setAlpha(a: number): MockGraphics;
  fillGradientStyle(...args: unknown[]): MockGraphics;
  fillRect(...args: unknown[]): MockGraphics;
  fillStyle(...args: unknown[]): MockGraphics;
  fillPoints(...args: unknown[]): MockGraphics;
  destroy(): void;
}

interface MockTileSprite {
  readonly type: 'tileSprite';
  x: number;
  y: number;
  width: number;
  height: number;
  textureKey: string;
  depth: number;
  alpha: number;
  tint?: number;
  tileScaleX?: number;
  tileScaleY?: number;
  tilePositionX: number;
  tilePositionY: number;
  scrollFactorX?: number;
  destroyed: boolean;
  setDepth(d: number): MockTileSprite;
  setScrollFactor(f: number): MockTileSprite;
  setAlpha(a: number): MockTileSprite;
  setTint(t: number): MockTileSprite;
  setTileScale(x: number, y?: number): MockTileSprite;
  destroy(): void;
}

function createMockScene(options: { loadedTextures?: readonly string[] } = {}) {
  const loaded = new Set(options.loadedTextures ?? []);
  const graphics: MockGraphics[] = [];
  const tileSprites: MockTileSprite[] = [];

  const scene: any = {
    scale: {
      gameSize: { width: STAGE_DESIGN_WIDTH, height: STAGE_DESIGN_HEIGHT },
    },
    textures: {
      exists: (key: string) => loaded.has(key),
    },
    add: {
      graphics(): MockGraphics {
        const g: MockGraphics = {
          type: 'graphics',
          x: 0,
          y: 0,
          depth: 0,
          alpha: 1,
          destroyed: false,
          calls: [],
          setDepth(d: number) {
            g.depth = d;
            return g;
          },
          setScrollFactor(f: number) {
            g.scrollFactorX = f;
            return g;
          },
          setAlpha(a: number) {
            g.alpha = a;
            return g;
          },
          fillGradientStyle(...args: unknown[]) {
            g.calls.push({ method: 'fillGradientStyle', args });
            return g;
          },
          fillRect(...args: unknown[]) {
            g.calls.push({ method: 'fillRect', args });
            return g;
          },
          fillStyle(...args: unknown[]) {
            g.calls.push({ method: 'fillStyle', args });
            return g;
          },
          fillPoints(...args: unknown[]) {
            g.calls.push({ method: 'fillPoints', args });
            return g;
          },
          destroy() {
            g.destroyed = true;
          },
        };
        graphics.push(g);
        return g;
      },
      tileSprite(
        x: number,
        y: number,
        width: number,
        height: number,
        textureKey: string,
      ): MockTileSprite {
        const ts: MockTileSprite = {
          type: 'tileSprite',
          x,
          y,
          width,
          height,
          textureKey,
          depth: 0,
          alpha: 1,
          tilePositionX: 0,
          tilePositionY: 0,
          destroyed: false,
          setDepth(d: number) {
            ts.depth = d;
            return ts;
          },
          setScrollFactor(f: number) {
            ts.scrollFactorX = f;
            return ts;
          },
          setAlpha(a: number) {
            ts.alpha = a;
            return ts;
          },
          setTint(t: number) {
            ts.tint = t;
            return ts;
          },
          setTileScale(sx: number, sy?: number) {
            ts.tileScaleX = sx;
            ts.tileScaleY = sy ?? sx;
            return ts;
          },
          destroy() {
            ts.destroyed = true;
          },
        };
        tileSprites.push(ts);
        return ts;
      },
    },
  };

  return { scene, graphics, tileSprites };
}

describe('renderStageBackground() — theme resolution', () => {
  it('resolves the layout backgroundTheme against the registry', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);
    expect(rendered.theme).toBe(STAGE_BACKGROUND_THEMES['lava-cavern']);
  });

  it('falls back to midnight for layouts without a theme (custom stages)', () => {
    const { scene } = createMockScene();
    const themeless: StageLayout = { ...FLAT_STAGE, backgroundTheme: undefined };
    const rendered = renderStageBackground(scene, themeless);
    expect(rendered.theme).toBe(STAGE_BACKGROUND_THEMES['midnight']);
  });

  it('falls back to midnight for unknown theme ids', () => {
    const { scene } = createMockScene();
    const odd: StageLayout = { ...FLAT_STAGE, backgroundTheme: 'volcano-deluxe' };
    const rendered = renderStageBackground(scene, odd);
    expect(rendered.theme).toBe(STAGE_BACKGROUND_THEMES['midnight']);
  });
});

describe('renderStageBackground() — gradient + ambient', () => {
  it('paints a full-viewport gradient behind everything', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);
    const gradient = rendered.gradient as unknown as MockGraphics;

    expect(gradient.depth).toBe(BACKGROUND_GRADIENT_DEPTH);
    expect(gradient.scrollFactorX).toBe(0);

    const gradCall = gradient.calls.find((c) => c.method === 'fillGradientStyle');
    expect(gradCall).toBeDefined();
    // fillGradientStyle(topLeft, topRight, bottomLeft, bottomRight, alpha)
    expect(gradCall!.args[0]).toBe(rendered.theme.gradientTop);
    expect(gradCall!.args[2]).toBe(rendered.theme.gradientBottom);

    const rectCall = gradient.calls.find((c) => c.method === 'fillRect');
    expect(rectCall!.args).toEqual([0, 0, STAGE_DESIGN_WIDTH, STAGE_DESIGN_HEIGHT]);
  });

  it('paints the ambient accent wash in front of the layers, below platforms', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);
    const ambient = rendered.ambient as unknown as MockGraphics;

    expect(ambient.depth).toBe(BACKGROUND_AMBIENT_DEPTH);
    expect(ambient.depth).toBeLessThan(0); // behind platform visuals (depth 0)
    const styleCall = ambient.calls.find((c) => c.method === 'fillStyle');
    expect(styleCall!.args[0]).toBe(rendered.theme.ambientAccent);
    // Initial alpha equals the frame-0 pulse value.
    expect(ambient.alpha).toBeCloseTo(
      computeAmbientPulseAlpha(rendered.theme.ambientPulse, 0),
      10,
    );
  });

  it('honours an explicit viewport override instead of scale.gameSize', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, FLAT_STAGE, {
      width: 640,
      height: 360,
    });
    const gradient = rendered.gradient as unknown as MockGraphics;
    const rectCall = gradient.calls.find((c) => c.method === 'fillRect');
    expect(rectCall!.args).toEqual([0, 0, 640, 360]);
  });
});

describe('renderStageBackground() — parallax layers', () => {
  it('creates one layer per theme layer, procedural when no texture loaded', () => {
    const { scene, tileSprites } = createMockScene(); // empty texture cache
    const rendered = renderStageBackground(scene, LAVA_STAGE);

    expect(rendered.layers.length).toBe(rendered.theme.layers.length);
    expect(tileSprites.length).toBe(0);
    for (const layer of rendered.layers) {
      expect(layer.kind).toBe('procedural');
      // Procedural layers actually filled their silhouette polygons.
      const g = layer.gameObject as unknown as MockGraphics;
      const polyFills = g.calls.filter((c) => c.method === 'fillPoints');
      expect(polyFills.length).toBe(layer.spec.procedural.count);
      // ...in the spec's silhouette colour.
      const styleCall = g.calls.find((c) => c.method === 'fillStyle');
      expect(styleCall!.args[0]).toBe(layer.spec.procedural.color);
      expect(g.alpha).toBe(layer.spec.alpha);
    }
  });

  it('uses TileSprite bands for layers whose texture exists in the cache', () => {
    const skyTheme = STAGE_BACKGROUND_THEMES['sky-ferry'];
    const texturedSpecs = skyTheme.layers.filter((l) => l.textureKey !== undefined);
    expect(texturedSpecs.length).toBeGreaterThan(0); // theme sanity

    const { scene, tileSprites } = createMockScene({
      loadedTextures: texturedSpecs.map((l) => l.textureKey!),
    });
    const rendered = renderStageBackground(scene, MOVING_PLATFORM_STAGE);

    const textured = rendered.layers.filter((l) => l.kind === 'texture');
    expect(textured.length).toBe(texturedSpecs.length);
    expect(tileSprites.length).toBe(texturedSpecs.length);

    for (const layer of textured) {
      const band = layer.gameObject as unknown as MockTileSprite;
      expect(band.textureKey).toBe(layer.spec.textureKey);
      expect(band.alpha).toBe(layer.spec.alpha);
      if (layer.spec.tint !== undefined) {
        expect(band.tint).toBe(layer.spec.tint);
      }
      const tileScale = layer.spec.textureTileScale ?? DEFAULT_TEXTURE_TILE_SCALE;
      expect(band.tileScaleX).toBe(tileScale);
    }
    // Layers without a loaded texture still fall back to silhouettes.
    const procedural = rendered.layers.filter((l) => l.kind === 'procedural');
    expect(procedural.length).toBe(rendered.theme.layers.length - textured.length);
  });

  it('stacks layers back-to-front at depths between the gradient and platforms', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);

    let previousDepth = BACKGROUND_GRADIENT_DEPTH;
    for (const layer of rendered.layers) {
      const obj = layer.gameObject as unknown as { depth: number };
      expect(obj.depth).toBeGreaterThanOrEqual(BACKGROUND_LAYER_DEPTH_BASE);
      expect(obj.depth).toBeLessThanOrEqual(BACKGROUND_LAYER_DEPTH_LIMIT);
      expect(obj.depth).toBeGreaterThan(previousDepth);
      previousDepth = obj.depth;
    }
    // Everything sits behind platforms (default depth 0).
    expect(previousDepth).toBeLessThan(0);
  });

  it('pins every created object to the camera (scrollFactor 0)', () => {
    const { scene, graphics, tileSprites } = createMockScene({
      loadedTextures: ['stage.bg.clouds', 'stage.bg.wisps'],
    });
    renderStageBackground(scene, MOVING_PLATFORM_STAGE);
    for (const g of graphics) {
      expect(g.scrollFactorX).toBe(0);
    }
    for (const ts of tileSprites) {
      expect(ts.scrollFactorX).toBe(0);
    }
  });
});

describe('renderStageBackground() — updateParallax()', () => {
  it('offsets procedural layers by -scroll * parallaxFactor', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);

    rendered.updateParallax(120, 40);

    for (const layer of rendered.layers) {
      expect(layer.kind).toBe('procedural');
      const g = layer.gameObject as unknown as MockGraphics;
      expect(g.x).toBeCloseTo(layer.baseX - 120 * layer.spec.parallaxFactor, 10);
      expect(g.y).toBeCloseTo(layer.baseY - 40 * layer.spec.parallaxFactor, 10);
    }
  });

  it('scrolls texture bands via tilePosition (screen offset / tileScale)', () => {
    const skyTheme = STAGE_BACKGROUND_THEMES['sky-ferry'];
    const texturedSpecs = skyTheme.layers.filter((l) => l.textureKey !== undefined);
    const { scene } = createMockScene({
      loadedTextures: texturedSpecs.map((l) => l.textureKey!),
    });
    const rendered = renderStageBackground(scene, MOVING_PLATFORM_STAGE);

    rendered.updateParallax(200, -60);

    for (const layer of rendered.layers) {
      if (layer.kind !== 'texture') continue;
      const band = layer.gameObject as unknown as MockTileSprite;
      const tileScale = layer.spec.textureTileScale ?? DEFAULT_TEXTURE_TILE_SCALE;
      expect(band.tilePositionX).toBeCloseTo(
        (200 * layer.spec.parallaxFactor) / tileScale,
        10,
      );
      expect(band.y).toBeCloseTo(layer.baseY - -60 * layer.spec.parallaxFactor, 10);
      // The band itself never moves horizontally — only its texture does.
      expect(band.x).toBe(layer.baseX);
    }
  });

  it('far layers move slower than near layers under the same scroll', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);
    rendered.updateParallax(100, 0);

    const offsets = rendered.layers.map((l) =>
      Math.abs((l.gameObject as unknown as MockGraphics).x - l.baseX),
    );
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
    }
  });

  it('is idempotent for the same scroll and resets cleanly at scroll 0', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);

    rendered.updateParallax(300, 50);
    rendered.updateParallax(300, 50);
    const after = rendered.layers.map(
      (l) => (l.gameObject as unknown as MockGraphics).x,
    );
    rendered.updateParallax(0, 0);
    for (const layer of rendered.layers) {
      const g = layer.gameObject as unknown as MockGraphics;
      expect(g.x).toBe(layer.baseX);
      expect(g.y).toBe(layer.baseY);
    }
    // Re-applying the earlier scroll lands on the same offsets (pure).
    rendered.updateParallax(300, 50);
    rendered.layers.forEach((l, i) => {
      expect((l.gameObject as unknown as MockGraphics).x).toBe(after[i]);
    });
  });
});

describe('renderStageBackground() — tick()', () => {
  it('drives the ambient pulse from the explicit frame counter', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);
    const ambient = rendered.ambient as unknown as MockGraphics;
    const pulse = rendered.theme.ambientPulse;

    rendered.tick(0);
    expect(ambient.alpha).toBeCloseTo(pulse.minAlpha, 10);

    rendered.tick(pulse.periodFrames / 2);
    expect(ambient.alpha).toBeCloseTo(pulse.maxAlpha, 10);

    // Glow actually moved between trough and apex.
    expect(pulse.maxAlpha).toBeGreaterThan(pulse.minAlpha);
  });

  it('is deterministic — two renders ticked to the same frame agree', () => {
    const sceneA = createMockScene();
    const sceneB = createMockScene();
    const a = renderStageBackground(sceneA.scene, LAVA_STAGE);
    const b = renderStageBackground(sceneB.scene, LAVA_STAGE);

    a.tick(173);
    b.tick(173);

    expect((a.ambient as unknown as MockGraphics).alpha).toBe(
      (b.ambient as unknown as MockGraphics).alpha,
    );
  });
});

describe('renderStageBackground() — destroy()', () => {
  it('destroys the gradient, ambient wash, and every layer object', () => {
    const skyTheme = STAGE_BACKGROUND_THEMES['sky-ferry'];
    const { scene, graphics, tileSprites } = createMockScene({
      loadedTextures: skyTheme.layers
        .filter((l) => l.textureKey !== undefined)
        .map((l) => l.textureKey!),
    });
    const rendered = renderStageBackground(scene, MOVING_PLATFORM_STAGE);

    rendered.destroy();

    for (const g of graphics) {
      expect(g.destroyed).toBe(true);
    }
    for (const ts of tileSprites) {
      expect(ts.destroyed).toBe(true);
    }
  });

  it('is idempotent and makes updateParallax/tick safe no-ops afterwards', () => {
    const { scene } = createMockScene();
    const rendered = renderStageBackground(scene, LAVA_STAGE);

    rendered.destroy();
    expect(() => rendered.destroy()).not.toThrow();
    expect(() => rendered.updateParallax(100, 100)).not.toThrow();
    expect(() => rendered.tick(60)).not.toThrow();

    // No-op means no state was written after teardown.
    for (const layer of rendered.layers) {
      const g = layer.gameObject as unknown as MockGraphics;
      expect(g.x).toBe(layer.baseX);
    }
  });
});
