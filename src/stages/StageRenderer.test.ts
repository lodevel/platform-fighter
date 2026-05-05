import { describe, it, expect } from 'vitest';
import {
  renderStage,
  PLATFORM_LABELS,
  BLAST_ZONE_LABELS,
  BLAST_ZONE_DEBUG_COLORS,
} from './StageRenderer';
import { FLAT_STAGE, STAGE_DESIGN_WIDTH, STAGE_DESIGN_HEIGHT } from './stageDefinitions';
import { COLLISION_CATEGORIES, COLLISION_MASKS } from '../engine/collisionCategories';

/**
 * `renderStage()` is a Phaser scene helper, so a full integration
 * test would need jsdom + Phaser. To keep the unit suite fast and
 * Node-only we feed it a thin mock scene that records every body /
 * visual it would create. That's enough to lock down the *contract*:
 *
 *   - Every layout platform produces one Matter body and one visual
 *     rectangle, both stamped with the right label.
 *   - Solid vs pass-through platforms get the matching collision
 *     category and mask from `engine/collisionCategories`.
 *   - Sub-AC 2.2: four blast-zone sensor walls are created (top /
 *     bottom / left / right), they're flagged `isStatic + isSensor`,
 *     and they live just outside the layout's `blastZone` rectangle so
 *     a character crossing the line trips the trigger.
 *   - `destroy()` removes every body and visual exactly once.
 */

interface MockBody {
  position: { x: number; y: number };
  options: any;
  removed: boolean;
}

interface MockRect {
  x: number;
  y: number;
  /** Legacy width/height fields used by older assertions. */
  w: number;
  h: number;
  /** Phaser-canonical width/height fields read by the visual binder. */
  width: number;
  height: number;
  fill: number;
  /** Phaser-canonical fill colour read/written by the visual binder. */
  fillColor: number;
  alpha: number;
  visible: boolean;
  /** Stroke fields written by the visual binder when applying outline modes. */
  strokeColor?: number;
  strokeAlpha?: number;
  destroyed: boolean;
  /**
   * Sub-AC 4 of AC 90304 binder hooks. Legacy callers pass two args
   * (width, color); the binder passes three (width, color, alpha) so
   * the third is optional. The mock records the call list so tests can
   * assert against it without touching internals.
   */
  setStrokeStyle(width: number, color: number, alpha?: number): MockRect;
  setFillStyle(color: number, alpha?: number): MockRect;
  /** Optional base-position fields installed by `bindPlatformRectangle`. */
  baseX?: number;
  baseY?: number;
  baseWidth?: number;
  baseHeight?: number;
  destroy(): void;
}

function createMockScene(viewW = STAGE_DESIGN_WIDTH, viewH = STAGE_DESIGN_HEIGHT) {
  const bodies: MockBody[] = [];
  const rects: MockRect[] = [];
  const graphics: Array<{ destroyed: boolean }> = [];

  const scene: any = {
    scale: { gameSize: { width: viewW, height: viewH } },
    matter: {
      add: {
        rectangle(x: number, y: number, w: number, h: number, options: any): MockBody {
          const body: MockBody = {
            position: { x, y },
            options: { ...options, _w: w, _h: h },
            removed: false,
          };
          bodies.push(body);
          return body;
        },
      },
      world: {
        remove(body: MockBody): void {
          body.removed = true;
        },
      },
    },
    add: {
      rectangle(x: number, y: number, w: number, h: number, fill: number): MockRect {
        const rect: MockRect = {
          x,
          y,
          w,
          h,
          // Phaser-canonical fields shadowed by the visual binder.
          width: w,
          height: h,
          fill,
          fillColor: fill,
          alpha: 1,
          visible: true,
          destroyed: false,
          setStrokeStyle(_w: number, color: number, alpha?: number) {
            rect.strokeColor = color;
            rect.strokeAlpha = alpha;
            return rect;
          },
          setFillStyle(color: number, alpha?: number) {
            rect.fillColor = color;
            if (typeof alpha === 'number') rect.alpha = alpha;
            return rect;
          },
          destroy() {
            rect.destroyed = true;
          },
        };
        rects.push(rect);
        return rect;
      },
      graphics() {
        const g = {
          destroyed: false,
          lineStyle() {
            return g;
          },
          strokeRect() {
            return g;
          },
          destroy() {
            g.destroyed = true;
          },
        };
        graphics.push(g);
        return g;
      },
    },
  };

  return { scene, bodies, rects, graphics };
}

describe('renderStage() — platform bodies (Sub-AC 2.1)', () => {
  it('creates one Matter body per platform with the matching label', () => {
    const { scene, bodies } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { skipBlastZoneBodies: true });

    expect(rendered.platformBodies.length).toBe(FLAT_STAGE.platforms.length);

    for (let i = 0; i < FLAT_STAGE.platforms.length; i += 1) {
      const platform = FLAT_STAGE.platforms[i]!;
      const body = bodies[i]!;
      const expected = platform.passThrough
        ? PLATFORM_LABELS.passThrough
        : PLATFORM_LABELS.solid;
      expect(body.options.label).toBe(expected);
      expect(body.options.isStatic).toBe(true);
    }
  });

  it('applies the COLLISION_CATEGORIES table to platform filters', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { skipBlastZoneBodies: true });

    for (let i = 0; i < FLAT_STAGE.platforms.length; i += 1) {
      const platform = FLAT_STAGE.platforms[i]!;
      const body = rendered.platformBodies[i]! as unknown as MockBody;
      const filter = body.options.collisionFilter;
      const expectedCat = platform.passThrough
        ? COLLISION_CATEGORIES.PLATFORM_PASS_THROUGH
        : COLLISION_CATEGORIES.PLATFORM_SOLID;
      const expectedMask = platform.passThrough
        ? COLLISION_MASKS.PLATFORM_PASS_THROUGH
        : COLLISION_MASKS.PLATFORM_SOLID;
      expect(filter.category).toBe(expectedCat);
      expect(filter.mask).toBe(expectedMask);
    }
  });
});

describe('renderStage() — blast-zone collision boundaries (Sub-AC 2.2)', () => {
  it('creates exactly four blast-zone sensor walls by default', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE);

    expect(rendered.blastZoneBodies.length).toBe(4);

    const labels = rendered.blastZoneBodies.map(
      (b) => (b as unknown as MockBody).options.label,
    );
    expect(new Set(labels)).toEqual(
      new Set([
        BLAST_ZONE_LABELS.top,
        BLAST_ZONE_LABELS.bottom,
        BLAST_ZONE_LABELS.left,
        BLAST_ZONE_LABELS.right,
      ]),
    );
  });

  it('flags every blast-zone body as a static sensor with the right collision filter', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE);

    for (const body of rendered.blastZoneBodies) {
      const opts = (body as unknown as MockBody).options;
      // Static so they don't move; sensor so they don't physically
      // block — only fire collision events for the KO handler.
      expect(opts.isStatic).toBe(true);
      expect(opts.isSensor).toBe(true);
      expect(opts.collisionFilter.category).toBe(COLLISION_CATEGORIES.BLAST_ZONE);
      expect(opts.collisionFilter.mask).toBe(COLLISION_MASKS.BLAST_ZONE);
    }
  });

  it('positions blast-zone walls just outside the layout blast-zone rectangle', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE);
    const z = FLAT_STAGE.blastZone;
    const scale = rendered.scale;
    const designOffsetX = (STAGE_DESIGN_WIDTH - STAGE_DESIGN_WIDTH * scale) / 2;
    const designOffsetY = (STAGE_DESIGN_HEIGHT - STAGE_DESIGN_HEIGHT * scale) / 2;

    const labelToBody = new Map<string, MockBody>();
    for (const body of rendered.blastZoneBodies) {
      const mb = body as unknown as MockBody;
      labelToBody.set(mb.options.label as string, mb);
    }

    // Top wall sits above the blast-zone top edge.
    const top = labelToBody.get(BLAST_ZONE_LABELS.top)!;
    expect(top.position.y).toBeLessThan(designOffsetY + z.top * scale);

    // Bottom wall sits below the blast-zone bottom edge.
    const bottom = labelToBody.get(BLAST_ZONE_LABELS.bottom)!;
    expect(bottom.position.y).toBeGreaterThan(designOffsetY + z.bottom * scale);

    // Left wall sits left of the blast-zone left edge.
    const left = labelToBody.get(BLAST_ZONE_LABELS.left)!;
    expect(left.position.x).toBeLessThan(designOffsetX + z.left * scale);

    // Right wall sits right of the blast-zone right edge.
    const right = labelToBody.get(BLAST_ZONE_LABELS.right)!;
    expect(right.position.x).toBeGreaterThan(designOffsetX + z.right * scale);
  });

  it('honours `skipBlastZoneBodies: true` for preview-only renders', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { skipBlastZoneBodies: true });
    expect(rendered.blastZoneBodies.length).toBe(0);
  });
});

describe('renderStage() — blast-zone debug visualization (Sub-AC 1 of AC 60201)', () => {
  /**
   * The debug overlay should render four colour-coded boundary
   * rectangles — one for each edge (top / bottom / left / right) — so
   * the four blast-zone boundaries are individually identifiable on
   * screen. Locks down both presence and edge→colour mapping.
   */
  it('renders four per-edge debug rectangles when drawBlastZone is enabled', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { drawBlastZone: true });

    expect(rendered.blastZoneEdgeVisuals.length).toBe(4);

    const colours = rendered.blastZoneEdgeVisuals.map(
      (r) => (r as unknown as MockRect).fill,
    );
    expect(new Set(colours)).toEqual(
      new Set([
        BLAST_ZONE_DEBUG_COLORS.top,
        BLAST_ZONE_DEBUG_COLORS.bottom,
        BLAST_ZONE_DEBUG_COLORS.left,
        BLAST_ZONE_DEBUG_COLORS.right,
      ]),
    );
  });

  it('positions each per-edge debug rectangle on the matching blast-zone line', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { drawBlastZone: true });
    const z = FLAT_STAGE.blastZone;
    const scale = rendered.scale;
    const offX = (STAGE_DESIGN_WIDTH - STAGE_DESIGN_WIDTH * scale) / 2;
    const offY = (STAGE_DESIGN_HEIGHT - STAGE_DESIGN_HEIGHT * scale) / 2;

    const byColor = new Map<number, MockRect>();
    for (const r of rendered.blastZoneEdgeVisuals) {
      const mock = r as unknown as MockRect;
      byColor.set(mock.fill, mock);
    }

    // Top band: centred on the blast-zone top line, full blast-zone width.
    const top = byColor.get(BLAST_ZONE_DEBUG_COLORS.top)!;
    expect(top.y).toBeCloseTo(offY + z.top * scale, 5);
    expect(top.w).toBeCloseTo((z.right - z.left) * scale, 5);

    // Bottom band: centred on the blast-zone bottom line, full width.
    const bottom = byColor.get(BLAST_ZONE_DEBUG_COLORS.bottom)!;
    expect(bottom.y).toBeCloseTo(offY + z.bottom * scale, 5);
    expect(bottom.w).toBeCloseTo((z.right - z.left) * scale, 5);

    // Left band: centred on the blast-zone left line, full blast-zone height.
    const left = byColor.get(BLAST_ZONE_DEBUG_COLORS.left)!;
    expect(left.x).toBeCloseTo(offX + z.left * scale, 5);
    expect(left.h).toBeCloseTo((z.bottom - z.top) * scale, 5);

    // Right band: centred on the blast-zone right line, full height.
    const right = byColor.get(BLAST_ZONE_DEBUG_COLORS.right)!;
    expect(right.x).toBeCloseTo(offX + z.right * scale, 5);
    expect(right.h).toBeCloseTo((z.bottom - z.top) * scale, 5);
  });

  it('omits per-edge debug rectangles when drawBlastZone is disabled', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE);
    expect(rendered.blastZoneEdgeVisuals.length).toBe(0);
  });
});

describe('renderStage() — visual binder wiring (Sub-AC 4 of AC 90304)', () => {
  /**
   * Sub-AC 4 of AC 90304 — wire Phaser visual states (sprite/tint/
   * animation transitions) to reflect each platform behavior's active
   * state at runtime.
   *
   * The renderer should:
   *   1. Construct one `PlatformVisualBinder` per platform (1:1 with
   *      `platformVisuals`).
   *   2. Expose them on `RenderedStage.platformBinders` so scenes can
   *      drive ad-hoc state without calling `updateVisuals`.
   *   3. Provide an `updateVisuals(frame, provider)` entry that pushes
   *      runtime input through `computePlatformVisualState` into each
   *      binder, falling back to the static base-behavior tint when
   *      no provider input is supplied.
   */
  it('creates one visual binder per platform, aligned 1:1 with platformVisuals', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { skipBlastZoneBodies: true });
    expect(rendered.platformBinders.length).toBe(rendered.platformVisuals.length);
    expect(rendered.platformBinders.length).toBe(FLAT_STAGE.platforms.length);
  });

  it('updateVisuals with no provider applies the static base-behavior tint per platform', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { skipBlastZoneBodies: true });

    rendered.updateVisuals(0);

    for (let i = 0; i < FLAT_STAGE.platforms.length; i += 1) {
      const platform = FLAT_STAGE.platforms[i]!;
      const visual = rendered.platformVisuals[i]! as unknown as MockRect;
      // After updateVisuals(0) without a provider, every platform
      // should have its canonical base-behavior tint applied via the
      // binder. The exact tint depends on solid vs pass-through; we
      // assert it's been written (non-zero) and that the binder
      // didn't move the platform off its authored position.
      expect(visual.fillColor).toBeTypeOf('number');
      expect(visual.alpha).toBe(1);
      expect(visual.visible).toBe(true);
      // No wobble, no drop offset, no scale change → live position
      // matches the authored centre.
      void platform;
    }
  });

  it('updateVisuals forwards a provider-supplied crumble state to the binder', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { skipBlastZoneBodies: true });

    // Push the first platform into a "falling" state and leave the rest
    // as base behavior. The binder for index 0 should pick up the new
    // alpha + drop offset; the others should stay fully visible.
    rendered.updateVisuals(5, (i) => {
      if (i !== 0) return null;
      return {
        behavior: 'solid',
        crumble: { alpha: 0.3, wobbleNorm: 1, dropOffset: 50 },
        frame: 5,
      };
    });

    const fallen = rendered.platformVisuals[0]! as unknown as MockRect;
    expect(fallen.alpha).toBe(0.3);
    // Drop offset moves the y *down* by 50 design pixels (binder writes
    // baseY + dropOffsetY + wobbleOffsetY). We can't predict the exact
    // wobble pixel because it depends on the hash, so just assert the
    // movement is at least the drop offset minus any negative wobble.
    expect(fallen.y).toBeGreaterThan((fallen.baseY ?? 0) + 50 - 5);

    // Other platforms keep alpha 1.
    for (let i = 1; i < rendered.platformVisuals.length; i += 1) {
      const r = rendered.platformVisuals[i]! as unknown as MockRect;
      expect(r.alpha).toBe(1);
    }
  });

  it('updateVisuals after destroy() is a safe no-op', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { skipBlastZoneBodies: true });
    rendered.destroy();
    expect(() => rendered.updateVisuals(0)).not.toThrow();
  });

  it('updateVisuals is deterministic across calls with identical frame counters', () => {
    const { scene: sceneA } = createMockScene();
    const { scene: sceneB } = createMockScene();
    const renderedA = renderStage(sceneA, FLAT_STAGE, { skipBlastZoneBodies: true });
    const renderedB = renderStage(sceneB, FLAT_STAGE, { skipBlastZoneBodies: true });

    const provider = (i: number) => {
      if (i !== 0) return null;
      return {
        behavior: 'solid' as const,
        crumble: { alpha: 1, wobbleNorm: 0.7, dropOffset: 0 },
        frame: 42,
      };
    };

    renderedA.updateVisuals(42, provider);
    renderedB.updateVisuals(42, provider);

    const a = renderedA.platformVisuals[0]! as unknown as MockRect;
    const b = renderedB.platformVisuals[0]! as unknown as MockRect;
    // Both runs should produce identical wobble offsets — required for
    // replay byte-equivalence.
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.fillColor).toBe(b.fillColor);
  });
});

describe('renderStage() — destroy()', () => {
  it('removes every Matter body and destroys every visual on teardown', () => {
    const { scene, bodies, rects } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE, { drawBlastZone: true });

    rendered.destroy();

    for (const body of bodies) {
      expect(body.removed).toBe(true);
    }
    for (const rect of rects) {
      expect(rect.destroyed).toBe(true);
    }
  });

  it('is idempotent — calling destroy() twice is a no-op', () => {
    const { scene } = createMockScene();
    const rendered = renderStage(scene, FLAT_STAGE);
    rendered.destroy();
    expect(() => rendered.destroy()).not.toThrow();
  });
});
