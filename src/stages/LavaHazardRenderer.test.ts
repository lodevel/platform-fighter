import { describe, it, expect } from 'vitest';
import {
  renderLavaHazard,
  renderLavaHazards,
  createLavaHazardFromStageHazard,
  computeStageViewportTransform,
  DEFAULT_LAVA_VISUAL_COLORS,
} from './LavaHazardRenderer';
import { createLavaStage, LAVA_STAGE } from './stageDefinitions';
import { LavaHazard } from '../entities/LavaHazard';
import {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
} from '../engine/collisionCategories';
import { LAVA_HAZARD_LABEL_PREFIX } from '../match';
import type { StageHazard } from '../types';

/**
 * Sub-AC 3 of AC 9 — visual rendering + Matter sensor body for a lava
 * hazard stage. Tests use a thin mock Phaser scene (mirrors the
 * pattern in StageRenderer.test.ts) so the suite stays fast and
 * Phaser-free.
 *
 * What the suite locks down:
 *
 *   1. `createLavaHazardFromStageHazard` translates every tunable
 *      timing field on the StageHazard authoring record into the
 *      runtime `LavaHazard` entity (no fields lost in the bridge).
 *   2. `renderLavaHazard` creates exactly one Matter sensor body and
 *      two visual rectangles (fill + glow), labels the body with the
 *      `hazard.lava.<id>` convention, and registers it under the
 *      shared HAZARD collision category/mask.
 *   3. `update()` re-positions and re-tints visuals to match the
 *      current entity frame — and switches the body's mask off when
 *      the lava is inactive so the broadphase stays quiet at trough.
 *   4. `renderLavaHazards()` walks the layout and produces one
 *      handle per `'lava'`-typed hazard in declaration order.
 *   5. `destroy()` is idempotent and tears down both bodies and
 *      visuals.
 *   6. `computeStageViewportTransform()` matches the same math
 *      `StageRenderer.renderStage` applies internally so the lava
 *      lines up with the platform geometry on any viewport size.
 */

interface MockBody {
  position: { x: number; y: number };
  vertices: Array<{ x: number; y: number }>;
  options: any;
  collisionFilter: { category: number; mask: number; group: number };
  removed: boolean;
  setPosition(pos: { x: number; y: number }): void;
}

interface MockRect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: number;
  alpha: number;
  visible: boolean;
  destroyed: boolean;
  depth: number;
  setStrokeStyle(width: number, color: number): MockRect;
  setDepth(d: number): MockRect;
  setPosition(x: number, y: number): MockRect;
  setSize(w: number, h: number): MockRect;
  setFillStyle(fill: number, a?: number): MockRect;
  setVisible(v: boolean): MockRect;
  destroy(): void;
}

function createMockScene() {
  const bodies: MockBody[] = [];
  const rects: MockRect[] = [];

  const scene: any = {
    matter: {
      add: {
        rectangle(x: number, y: number, w: number, h: number, options: any): MockBody {
          const halfW = w / 2;
          const halfH = h / 2;
          const filter = options.collisionFilter ?? {
            category: 0,
            mask: 0,
            group: 0,
          };
          const body: MockBody = {
            position: { x, y },
            vertices: [
              { x: x - halfW, y: y - halfH },
              { x: x + halfW, y: y - halfH },
              { x: x + halfW, y: y + halfH },
              { x: x - halfW, y: y + halfH },
            ],
            options: { ...options, _w: w, _h: h },
            collisionFilter: { ...filter },
            removed: false,
            setPosition(pos): void {
              body.position.x = pos.x;
              body.position.y = pos.y;
            },
          };
          // The renderer mutates `body.collisionFilter.mask` via the
          // body reference; share the same reference so assertions
          // observe the live mask.
          body.options.collisionFilter = body.collisionFilter;
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
      rectangle(x: number, y: number, w: number, h: number, fill: number, alpha = 1): MockRect {
        const rect: MockRect = {
          x,
          y,
          w,
          h,
          fill,
          alpha,
          visible: true,
          destroyed: false,
          depth: 0,
          setStrokeStyle(_w: number, _c: number) {
            return rect;
          },
          setDepth(d: number) {
            rect.depth = d;
            return rect;
          },
          setPosition(nx: number, ny: number) {
            rect.x = nx;
            rect.y = ny;
            return rect;
          },
          setSize(nw: number, nh: number) {
            rect.w = nw;
            rect.h = nh;
            return rect;
          },
          setFillStyle(nfill: number, na?: number) {
            rect.fill = nfill;
            if (na !== undefined) rect.alpha = na;
            return rect;
          },
          setVisible(v: boolean) {
            rect.visible = v;
            return rect;
          },
          destroy() {
            rect.destroyed = true;
          },
        };
        rects.push(rect);
        return rect;
      },
    },
  };

  return { scene, bodies, rects };
}

// ---------------------------------------------------------------------------
// createLavaHazardFromStageHazard
// ---------------------------------------------------------------------------

describe('createLavaHazardFromStageHazard', () => {
  it('translates every tunable field into the runtime entity', () => {
    const stageHazard: StageHazard = {
      type: 'lava',
      id: 'lava-test',
      x: 500,
      y: 1080,
      width: 360,
      height: 220,
      cycleFrames: 480,
      phaseFrames: 60,
      damagePerTick: 12,
      activeThreshold: 0.7,
      minHeight: 8,
    };
    const entity = createLavaHazardFromStageHazard(stageHazard);
    expect(entity.getId()).toBe('lava-test');
    expect(entity.getX()).toBe(500);
    expect(entity.getBaseY()).toBe(1080);
    expect(entity.getWidth()).toBe(360);
    expect(entity.getMaxHeight()).toBe(220);
    expect(entity.getCycleFrames()).toBe(480);
    expect(entity.getPhaseFrames()).toBe(60);
    expect(entity.getMinHeight()).toBe(8);
    expect(entity.getActiveThreshold()).toBe(0.7);
  });

  it('falls back to LAVA_DEFAULTS for missing optional fields', () => {
    const stageHazard: StageHazard = {
      type: 'lava',
      x: 100,
      y: 1000,
      width: 200,
      height: 100,
    };
    const entity = createLavaHazardFromStageHazard(stageHazard);
    // Defaults from LAVA_DEFAULTS — id defaults to 'lava'.
    expect(entity.getId()).toBe('lava');
    expect(entity.getCycleFrames()).toBe(600);
    expect(entity.getPhaseFrames()).toBe(0);
    expect(entity.getMinHeight()).toBe(0);
    expect(entity.getActiveThreshold()).toBeCloseTo(0.55, 6);
  });

  it('throws when handed a non-lava StageHazard', () => {
    const stageHazard = {
      type: 'wind',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    } as unknown as StageHazard;
    expect(() => createLavaHazardFromStageHazard(stageHazard)).toThrow(/lava/);
  });
});

// ---------------------------------------------------------------------------
// renderLavaHazard — body shape + collision filter
// ---------------------------------------------------------------------------

describe('renderLavaHazard — Matter sensor body', () => {
  it('creates exactly one body labelled "hazard.lava.<id>"', () => {
    const { scene, bodies } = createMockScene();
    const entity = new LavaHazard({
      id: 'lava-x',
      x: 500,
      baseY: 1080,
      width: 200,
      maxHeight: 100,
      cycleFrames: 600,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(bodies.length).toBe(1);
    expect(handle.body).toBe(bodies[0]);
    expect(bodies[0]!.options.label).toBe(`${LAVA_HAZARD_LABEL_PREFIX}lava-x`);
    expect(bodies[0]!.options.isStatic).toBe(true);
    expect(bodies[0]!.options.isSensor).toBe(true);
  });

  it('uses the shared HAZARD collision category and mask', () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 0,
      baseY: 0,
      width: 100,
      maxHeight: 100,
      cycleFrames: 600,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(handle.body.collisionFilter.category).toBe(
      COLLISION_CATEGORIES.HAZARD,
    );
    // Mask is set to 0 at trough (lava inactive). Either the mask
    // matches HAZARD's default OR is 0 — both are the documented
    // behaviour. Assert the active path explicitly.
    entity.reset(entity.getCycleFrames() / 2); // jump to apex
    handle.update();
    expect(handle.body.collisionFilter.mask).toBe(COLLISION_MASKS.HAZARD);
  });

  it('throws on a non-positive viewport scale', () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 0,
      baseY: 0,
      width: 100,
      maxHeight: 100,
      cycleFrames: 600,
    });
    expect(() =>
      renderLavaHazard(scene, entity, {
        viewportScale: 0,
        offsetX: 0,
        offsetY: 0,
      }),
    ).toThrow(/viewportScale/);
    expect(() =>
      renderLavaHazard(scene, entity, {
        viewportScale: -1,
        offsetX: 0,
        offsetY: 0,
      }),
    ).toThrow(/viewportScale/);
  });
});

// ---------------------------------------------------------------------------
// renderLavaHazard — visuals
// ---------------------------------------------------------------------------

describe('renderLavaHazard — visual rendering', () => {
  it('creates a fill rectangle and a top-edge glow rectangle', () => {
    const { scene, rects } = createMockScene();
    const entity = new LavaHazard({
      x: 500,
      baseY: 1080,
      width: 200,
      maxHeight: 100,
      cycleFrames: 600,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(rects.length).toBe(2);
    expect(handle.fill).toBe(rects[0]);
    expect(handle.glow).toBe(rects[1]);
  });

  it('uses the inactive colour at trough and switches to active at apex', () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 100,
      baseY: 1000,
      width: 200,
      maxHeight: 200,
      cycleFrames: 100,
      activeThreshold: 0.5,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    // At trough — inactive colour. Cast the visual to MockRect to
    // observe the underlying fill the mock recorded.
    const fillMock = handle.fill as unknown as MockRect;
    expect(fillMock.fill).toBe(DEFAULT_LAVA_VISUAL_COLORS.inactive);

    // Jump to apex.
    entity.reset(50);
    handle.update();
    expect(fillMock.fill).toBe(DEFAULT_LAVA_VISUAL_COLORS.active);
  });

  it('honours custom colour overrides', () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 0,
      baseY: 0,
      width: 100,
      maxHeight: 100,
      cycleFrames: 600,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
      inactiveColor: 0xabcdef,
      activeColor: 0x123456,
      glowColor: 0xfedcba,
    });
    const fillMock = handle.fill as unknown as MockRect;
    const glowMock = handle.glow as unknown as MockRect;
    expect(fillMock.fill).toBe(0xabcdef);
    expect(glowMock.fill).toBe(0xfedcba);
    entity.reset(entity.getCycleFrames() / 2);
    handle.update();
    expect(fillMock.fill).toBe(0x123456);
  });

  it('positions the fill rectangle centred on the entity bounds at the current frame', () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 500,
      baseY: 1000,
      width: 200,
      maxHeight: 200,
      cycleFrames: 100,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    // Jump to apex — height = 200, body centre = baseY - height/2 = 900.
    entity.reset(50);
    handle.update();
    const fillMock = handle.fill as unknown as MockRect;
    expect(fillMock.x).toBeCloseTo(500, 6);
    expect(fillMock.y).toBeCloseTo(900, 6);
    expect(fillMock.h).toBeCloseTo(200, 6);
  });

  it('hides the glow when the lava has fully receded', () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 0,
      baseY: 0,
      width: 100,
      maxHeight: 100,
      cycleFrames: 600,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    // At trough — glow should be hidden so a stray pixel band at
    // baseY doesn't read as a permanent line through the floor.
    expect(handle.glow.visible).toBe(false);
    entity.reset(entity.getCycleFrames() / 2);
    handle.update();
    expect(handle.glow.visible).toBe(true);
  });

  it("re-positions visuals when the viewport scale + offset are non-trivial", () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 1000,
      baseY: 1000,
      width: 200,
      maxHeight: 100,
      cycleFrames: 100,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 0.5,
      offsetX: 100,
      offsetY: 50,
    });
    entity.reset(50); // apex — height = 100
    handle.update();
    const fillMock = handle.fill as unknown as MockRect;
    // X centre: 100 (offset) + 1000 (designX) * 0.5 = 600.
    expect(fillMock.x).toBeCloseTo(600, 6);
    // Y centre: 50 (offset) + (baseY - height/2) * scale = 50 + 950 * 0.5 = 525.
    expect(fillMock.y).toBeCloseTo(525, 6);
    // Width: 200 * 0.5 = 100.
    expect(fillMock.w).toBeCloseTo(100, 6);
    // Height: 100 * 0.5 = 50.
    expect(fillMock.h).toBeCloseTo(50, 6);
  });
});

// ---------------------------------------------------------------------------
// renderLavaHazard — body movement + mask gating
// ---------------------------------------------------------------------------

describe('renderLavaHazard — body update', () => {
  it("updates the body's position to track the entity's bounds each frame", () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 100,
      baseY: 1000,
      width: 200,
      maxHeight: 200,
      cycleFrames: 100,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    entity.reset(50);
    handle.update();
    expect(handle.body.position.x).toBeCloseTo(100, 6);
    // Centre Y at apex: baseY - height/2 = 900.
    expect(handle.body.position.y).toBeCloseTo(900, 6);
  });

  it("zeroes the body's collision mask when the lava is inactive", () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 0,
      baseY: 0,
      width: 100,
      maxHeight: 100,
      cycleFrames: 100,
      activeThreshold: 0.5,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    // At trough — inactive — mask should be 0.
    expect(handle.body.collisionFilter.mask).toBe(0);
    // At apex — active — mask should restore to HAZARD.
    entity.reset(50);
    handle.update();
    expect(handle.body.collisionFilter.mask).toBe(COLLISION_MASKS.HAZARD);
  });

  it("re-sizes the body's vertices to match the current entity height", () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 0,
      baseY: 0,
      width: 100,
      maxHeight: 100,
      cycleFrames: 100,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    entity.reset(50); // apex
    handle.update();
    const verts = handle.body.vertices!;
    const h = Math.max(...verts.map((v) => v.y)) - Math.min(...verts.map((v) => v.y));
    expect(h).toBeCloseTo(100, 6);
  });
});

// ---------------------------------------------------------------------------
// renderLavaHazard — destroy
// ---------------------------------------------------------------------------

describe('renderLavaHazard — destroy()', () => {
  it('removes the body and destroys both visuals', () => {
    const { scene, bodies, rects } = createMockScene();
    const entity = new LavaHazard({
      x: 0,
      baseY: 0,
      width: 100,
      maxHeight: 100,
      cycleFrames: 600,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    handle.destroy();
    expect(bodies[0]!.removed).toBe(true);
    for (const r of rects) expect(r.destroyed).toBe(true);
  });

  it('is idempotent — calling destroy() twice is a no-op', () => {
    const { scene } = createMockScene();
    const entity = new LavaHazard({
      x: 0,
      baseY: 0,
      width: 100,
      maxHeight: 100,
      cycleFrames: 600,
    });
    const handle = renderLavaHazard(scene, entity, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    handle.destroy();
    expect(() => handle.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderLavaHazards — stage-level convenience
// ---------------------------------------------------------------------------

describe('renderLavaHazards — stage-level convenience', () => {
  it('produces one handle per lava hazard on the layout, in declaration order', () => {
    const { scene } = createMockScene();
    const result = renderLavaHazards(scene, LAVA_STAGE, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    const expected = LAVA_STAGE.hazards.filter((h) => h.type === 'lava');
    expect(result.hazards.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(result.hazards[i]!.entity.getId()).toBe(expected[i]!.id);
    }
  });

  it('returns an empty result for stages with no lava hazards', () => {
    const stage = createLavaStage({ omitLavaHazards: true });
    const { scene } = createMockScene();
    const result = renderLavaHazards(scene, stage, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    expect(result.hazards.length).toBe(0);
  });

  it('update() and destroy() fan out to every handle exactly once', () => {
    const { scene, bodies, rects } = createMockScene();
    const result = renderLavaHazards(scene, LAVA_STAGE, {
      viewportScale: 1,
      offsetX: 0,
      offsetY: 0,
    });
    // Tick the entities a few times so update() actually changes state.
    for (const h of result.hazards) {
      for (let i = 0; i < 50; i++) h.entity.tick();
    }
    result.update();

    result.destroy();
    for (const b of bodies) expect(b.removed).toBe(true);
    for (const r of rects) expect(r.destroyed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeStageViewportTransform
// ---------------------------------------------------------------------------

describe('computeStageViewportTransform', () => {
  it('returns scale=1 and zero offsets when viewport == design size', () => {
    const t = computeStageViewportTransform({ width: 1920, height: 1080 });
    expect(t.viewportScale).toBeCloseTo(1, 6);
    expect(t.offsetX).toBeCloseTo(0, 6);
    expect(t.offsetY).toBeCloseTo(0, 6);
  });

  it('scales uniformly to fit the smaller dimension and centres', () => {
    // Widescreen wider than 16:9: limited by height — scale = h/1080.
    const t = computeStageViewportTransform({ width: 4000, height: 1080 });
    expect(t.viewportScale).toBeCloseTo(1, 6);
    expect(t.offsetX).toBeCloseTo((4000 - 1920) / 2, 6);
    expect(t.offsetY).toBeCloseTo(0, 6);
  });

  it('scales down for laptop viewports without overflow', () => {
    const t = computeStageViewportTransform({ width: 1280, height: 720 });
    expect(t.viewportScale).toBeCloseTo(720 / 1080, 6);
    expect(t.offsetX).toBeCloseTo(0, 6);
    expect(t.offsetY).toBeCloseTo(0, 6);
  });
});
