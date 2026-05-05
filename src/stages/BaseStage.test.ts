import { describe, it, expect, vi } from 'vitest';
import { BaseStage } from './BaseStage';
import {
  FLAT_STAGE,
  LAVA_STAGE,
  WIND_STAGE,
  STAGE_DESIGN_HEIGHT,
  STAGE_DESIGN_WIDTH,
} from './stageDefinitions';
import { BLAST_ZONE_LABELS, PLATFORM_LABELS } from './StageRenderer';
import {
  LAVA_HAZARD_LABEL_PREFIX,
  WIND_HAZARD_LABEL_PREFIX,
} from '../match';

/**
 * `BaseStage` is the shared stage runtime contract introduced by
 * AC 20101 Sub-AC 1 — every stage layout (built-in or custom) flows
 * through it, so the test suite locks down the *contract* the gameplay
 * loop relies on:
 *
 *   1. Geometry is loaded — every layout platform yields one Matter body
 *      and one visual rectangle, four blast-zone sensor walls anchor the
 *      KO triggers, and the cached design→viewport transform reproduces
 *      the same math `renderStage` uses internally.
 *   2. Spawn-point lookup converts design coordinates to the viewport
 *      pixels the spawned `Character` needs.
 *   3. Hazard lifecycle: lava + wind renderers are built only when the
 *      layout carries the matching hazard type; the lava/wind watchers
 *      are wired only when the caller supplied the matching listener.
 *   4. Player registration fans out to every stage-owned watcher;
 *      `unregisterPlayer` is idempotent.
 *   5. Collision routing forwards Matter events to every hazard watcher
 *      in one shot, and `needsCollisionEndChannel()` correctly reports
 *      whether the owning scene has to subscribe.
 *   6. Per-step lifecycle: `tickHazards` advances every hazard entity
 *      by exactly one fixed step; `applyHazardEffects` drains the
 *      overlap queues; `destroy()` is idempotent.
 *   7. Subclass hooks fire after the default registration paths.
 *
 * A thin mock `Phaser.Scene` (mirrors the pattern used by
 * `StageRenderer.test.ts` and `LavaHazardRenderer.test.ts`) keeps the
 * suite Node-only and fast.
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
  width: number;
  height: number;
  fill: number;
  fillColor: number;
  alpha: number;
  visible: boolean;
  destroyed: boolean;
  depth: number;
  setStrokeStyle(width: number, color: number, alpha?: number): MockRect;
  setFillStyle(color: number, alpha?: number): MockRect;
  setDepth(d: number): MockRect;
  setPosition(x: number, y: number): MockRect;
  setSize(w: number, h: number): MockRect;
  setVisible(v: boolean): MockRect;
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
          // Renderer mutates `body.collisionFilter.mask` via the body
          // reference — share so assertions observe the live mask.
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
          width: w,
          height: h,
          fill,
          fillColor: fill,
          alpha,
          visible: true,
          destroyed: false,
          depth: 0,
          setStrokeStyle(_w: number, color: number, a?: number) {
            (rect as any).strokeColor = color;
            (rect as any).strokeAlpha = a;
            return rect;
          },
          setFillStyle(color: number, a?: number) {
            rect.fillColor = color;
            rect.fill = color;
            if (typeof a === 'number') rect.alpha = a;
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
            rect.width = nw;
            rect.height = nh;
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
      graphics() {
        const g: any = {
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

// ---------------------------------------------------------------------------
// Geometry & viewport transform
// ---------------------------------------------------------------------------

describe('BaseStage — geometry & viewport transform', () => {
  it('renders one platform body per layout platform', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, FLAT_STAGE);

    expect(stage.rendered.platformBodies.length).toBe(
      FLAT_STAGE.platforms.length,
    );

    // First body should match the first platform's label.
    const firstLabel = FLAT_STAGE.platforms[0]!.passThrough
      ? PLATFORM_LABELS.passThrough
      : PLATFORM_LABELS.solid;
    expect(
      (stage.rendered.platformBodies[0] as any).options.label,
    ).toBe(firstLabel);
  });

  it('builds the four blast-zone sensor walls by default', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, FLAT_STAGE);
    expect(stage.rendered.blastZoneBodies.length).toBe(4);
    const labels = new Set(
      stage.rendered.blastZoneBodies.map((b) => (b as any).options.label),
    );
    expect(labels).toEqual(
      new Set([
        BLAST_ZONE_LABELS.top,
        BLAST_ZONE_LABELS.bottom,
        BLAST_ZONE_LABELS.left,
        BLAST_ZONE_LABELS.right,
      ]),
    );
  });

  it('caches the design→viewport transform that matches the renderer', () => {
    const { scene } = createMockScene(960, 540); // half-size viewport
    const stage = new BaseStage(scene, FLAT_STAGE);
    // Half size means scale = 0.5 (16:9 → 16:9 fits exactly).
    expect(stage.transform.viewportScale).toBeCloseTo(0.5, 6);
    // 16:9 viewport → no letterbox offset.
    expect(stage.transform.offsetX).toBeCloseTo(0, 6);
    expect(stage.transform.offsetY).toBeCloseTo(0, 6);
    expect(stage.transform.viewportWidth).toBe(960);
    expect(stage.transform.viewportHeight).toBe(540);
  });

  it('honours an explicit `viewportSize` override over `scene.scale.gameSize`', () => {
    // Live scene reports 1920×1080, but we override to 480×270 so the
    // transform is deterministic regardless of the test environment.
    const { scene } = createMockScene(1920, 1080);
    const stage = new BaseStage(scene, FLAT_STAGE, {
      viewportSize: { width: 480, height: 270 },
    });
    expect(stage.transform.viewportScale).toBeCloseTo(0.25, 6);
  });

  it('converts design points to viewport pixels via the cached transform', () => {
    const { scene } = createMockScene(1920, 1080);
    const stage = new BaseStage(scene, FLAT_STAGE);
    const p = stage.designToViewport({ x: 0, y: 0 });
    expect(p.x).toBeCloseTo(stage.transform.offsetX, 6);
    expect(p.y).toBeCloseTo(stage.transform.offsetY, 6);

    const corner = stage.designToViewport({
      x: STAGE_DESIGN_WIDTH,
      y: STAGE_DESIGN_HEIGHT,
    });
    expect(corner.x).toBeCloseTo(
      stage.transform.offsetX + STAGE_DESIGN_WIDTH * stage.transform.viewportScale,
      6,
    );
  });

  it('returns the spawn point projected into viewport coordinates', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, FLAT_STAGE);
    const sp = stage.getSpawnPoint(0);
    const expected = stage.designToViewport(FLAT_STAGE.spawnPoints[0]!);
    expect(sp.x).toBeCloseTo(expected.x, 6);
    expect(sp.y).toBeCloseTo(expected.y, 6);
  });

  it('throws on an out-of-range spawn point index', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, FLAT_STAGE);
    expect(() => stage.getSpawnPoint(99)).toThrow(/out of range/);
  });

  it('exposes blast zone in design coordinates and viewport coordinates', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, FLAT_STAGE);
    expect(stage.getBlastZone()).toBe(FLAT_STAGE.blastZone);
    const vbz = stage.getViewportBlastZone();
    const z = FLAT_STAGE.blastZone;
    const scale = stage.transform.viewportScale;
    expect(vbz.x).toBeCloseTo(stage.transform.offsetX + z.left * scale, 6);
    expect(vbz.y).toBeCloseTo(stage.transform.offsetY + z.top * scale, 6);
    expect(vbz.width).toBeCloseTo((z.right - z.left) * scale, 6);
    expect(vbz.height).toBeCloseTo((z.bottom - z.top) * scale, 6);
  });
});

// ---------------------------------------------------------------------------
// Hazard renderers + adapters
// ---------------------------------------------------------------------------

describe('BaseStage — hazard renderers', () => {
  it('does NOT build any hazard pipeline for the flat stage', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, FLAT_STAGE, {
      onLavaKo: () => {},
      onWindForce: () => {},
    });
    expect(stage.lavaHazards).toBeNull();
    expect(stage.windHazards).toBeNull();
    expect(stage.lavaCollisionWatcher).toBeNull();
    expect(stage.windForceController).toBeNull();
    expect(stage.needsCollisionEndChannel()).toBe(false);
  });

  it('builds lava renderers + watcher when the layout has lava and a listener is supplied', () => {
    const { scene, bodies } = createMockScene();
    const onLavaKo = vi.fn();
    const stage = new BaseStage(scene, LAVA_STAGE, { onLavaKo });
    expect(stage.lavaHazards).not.toBeNull();
    expect(stage.lavaHazards!.hazards.length).toBe(
      LAVA_STAGE.hazards.filter((h) => h.type === 'lava').length,
    );
    expect(stage.lavaCollisionWatcher).not.toBeNull();
    expect(stage.needsCollisionEndChannel()).toBe(true);

    // Each lava hazard should have produced a sensor body with the
    // canonical `hazard.lava.<id>` label.
    const lavaBodies = bodies.filter((b) =>
      typeof b.options.label === 'string' &&
      b.options.label.startsWith(LAVA_HAZARD_LABEL_PREFIX),
    );
    expect(lavaBodies.length).toBe(stage.lavaHazards!.hazards.length);
  });

  it('builds lava VISUALS but no watcher when the listener is omitted (preview mode)', () => {
    const { scene } = createMockScene();
    // No `onLavaKo` — the stage builder preview wants the lava visuals
    // without the gameplay consequences.
    const stage = new BaseStage(scene, LAVA_STAGE);
    expect(stage.lavaHazards).not.toBeNull();
    expect(stage.lavaCollisionWatcher).toBeNull();
    expect(stage.needsCollisionEndChannel()).toBe(false);
  });

  it('builds wind renderers + controller when the layout has wind and a listener is supplied', () => {
    const { scene, bodies } = createMockScene();
    const onWindForce = vi.fn();
    const stage = new BaseStage(scene, WIND_STAGE, { onWindForce });
    expect(stage.windHazards).not.toBeNull();
    expect(stage.windHazards!.hazards.length).toBe(
      WIND_STAGE.hazards.filter((h) => h.type === 'wind').length,
    );
    expect(stage.windForceController).not.toBeNull();
    expect(stage.needsCollisionEndChannel()).toBe(true);

    // Each wind hazard should have produced a sensor body with the
    // canonical `hazard.wind.<id>` label.
    const windBodies = bodies.filter((b) =>
      typeof b.options.label === 'string' &&
      b.options.label.startsWith(WIND_HAZARD_LABEL_PREFIX),
    );
    expect(windBodies.length).toBe(stage.windHazards!.hazards.length);
  });
});

// ---------------------------------------------------------------------------
// Player registration
// ---------------------------------------------------------------------------

describe('BaseStage — player registration', () => {
  it('fans registration out to lava + wind watchers when both are present', () => {
    // Build a custom layout with both lava AND wind so we exercise the
    // dual-fan-out path the real wind+lava stage would never declare.
    const dualLayout = {
      ...LAVA_STAGE,
      id: 'lava-and-wind',
      hazards: [
        ...LAVA_STAGE.hazards,
        ...WIND_STAGE.hazards.map((h) => ({ ...h })),
      ],
    };
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, dualLayout, {
      onLavaKo: () => {},
      onWindForce: () => {},
    });
    const body = { label: 'character.0' };
    stage.registerPlayer(0, body);
    expect(stage.lavaCollisionWatcher!.isRegistered(0)).toBe(true);
    expect(stage.windForceController!.isRegistered(0)).toBe(true);

    stage.unregisterPlayer(0);
    expect(stage.lavaCollisionWatcher!.isRegistered(0)).toBe(false);
    expect(stage.windForceController!.isRegistered(0)).toBe(false);
  });

  it('is a no-op on a stage with no hazard watchers', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, FLAT_STAGE);
    expect(() => {
      stage.registerPlayer(0, { label: 'x' });
      stage.unregisterPlayer(0);
    }).not.toThrow();
  });

  it('fires onPlayerRegistered / onPlayerUnregistered subclass hooks', () => {
    const { scene } = createMockScene();
    const registered: number[] = [];
    const unregistered: number[] = [];
    class TrackingStage extends BaseStage {
      protected override onPlayerRegistered(playerIndex: number): void {
        registered.push(playerIndex);
      }
      protected override onPlayerUnregistered(playerIndex: number): void {
        unregistered.push(playerIndex);
      }
    }
    const stage = new TrackingStage(scene, FLAT_STAGE);
    stage.registerPlayer(0, { label: 'a' });
    stage.registerPlayer(1, { label: 'b' });
    stage.unregisterPlayer(0);
    expect(registered).toEqual([0, 1]);
    expect(unregistered).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// Hazard lifecycle (tick + applyHazardEffects + collision routing)
// ---------------------------------------------------------------------------

describe('BaseStage — hazard lifecycle', () => {
  it('advances every lava entity exactly once per `tickHazards` call', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, LAVA_STAGE, { onLavaKo: () => {} });
    // The lava entity normalises its frame counter modulo cycleFrames,
    // so capture initial values then advance an exact number of fixed
    // steps and compare modulo the same cycle to verify exactly one
    // tick fired per `tickHazards` call.
    const initialFrames = stage.lavaHazards!.hazards.map((h) =>
      h.entity.getFrame(),
    );
    const cycleFrames = stage.lavaHazards!.hazards.map((h) =>
      h.entity.getCycleFrames(),
    );
    stage.tickHazards(1);
    stage.tickHazards(2);
    stage.tickHazards(3);
    const advancedFrames = stage.lavaHazards!.hazards.map((h) =>
      h.entity.getFrame(),
    );
    for (let i = 0; i < initialFrames.length; i += 1) {
      const expected = (initialFrames[i]! + 3) % cycleFrames[i]!;
      expect(advancedFrames[i]).toBe(expected);
    }
  });

  it('forwards collision-start/end events to every hazard watcher', () => {
    const { scene } = createMockScene();
    const onLavaKo = vi.fn();
    const stage = new BaseStage(scene, LAVA_STAGE, { onLavaKo });
    const playerBody: any = { label: 'character.0' };
    stage.registerPlayer(0, playerBody);

    // Pull the first registered lava sensor body out of the watcher's
    // hazard registry by walking the rendered handles.
    const lavaBody = stage.lavaHazards!.hazards[0]!.body as any;
    const lavaEntity = stage.lavaHazards!.hazards[0]!.entity;

    // Fast-forward the lava entity past its active threshold so the
    // overlap actually fires a KO. We tick the entity directly; the
    // watcher reads `isActive()` lazily during `tick()`.
    while (!lavaEntity.isActive()) {
      stage.tickHazards(stage['lastTickedFrame'] + 1);
    }

    // Forward a collisionstart pair (player + lava).
    stage.handleCollisionStart({
      pairs: [{ bodyA: playerBody, bodyB: lavaBody }],
    } as any);

    // Drain the overlap queue.
    stage.applyHazardEffects(50);

    expect(onLavaKo).toHaveBeenCalledTimes(1);
    expect(onLavaKo).toHaveBeenCalledWith(0, lavaEntity.getId(), 50);

    // After collisionend, the overlap pair drops; a re-fire requires
    // collisionstart again.
    stage.handleCollisionEnd({
      pairs: [{ bodyA: playerBody, bodyB: lavaBody }],
    } as any);
    onLavaKo.mockClear();
    stage.applyHazardEffects(51);
    expect(onLavaKo).not.toHaveBeenCalled();
  });

  it('reports `needsCollisionEndChannel` for hazardful stages only', () => {
    const { scene: s1 } = createMockScene();
    expect(new BaseStage(s1, FLAT_STAGE).needsCollisionEndChannel()).toBe(false);

    const { scene: s2 } = createMockScene();
    expect(
      new BaseStage(s2, LAVA_STAGE, { onLavaKo: () => {} })
        .needsCollisionEndChannel(),
    ).toBe(true);

    const { scene: s3 } = createMockScene();
    expect(
      new BaseStage(s3, WIND_STAGE, { onWindForce: () => {} })
        .needsCollisionEndChannel(),
    ).toBe(true);
  });

  it('updateRender drives the platform binders without throwing', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, FLAT_STAGE);
    expect(() => stage.updateRender(0)).not.toThrow();
    expect(() => stage.updateRender(60)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe('BaseStage — teardown', () => {
  it('destroys every body + visual exactly once', () => {
    const { scene, bodies, rects } = createMockScene();
    const stage = new BaseStage(scene, LAVA_STAGE, { onLavaKo: () => {} });
    expect(bodies.some((b) => b.removed)).toBe(false);
    expect(rects.some((r) => r.destroyed)).toBe(false);

    stage.destroy();
    // Every body Phaser/Matter created should have gone through
    // `world.remove`.
    expect(bodies.every((b) => b.removed)).toBe(true);
    // Every visual rectangle should have gone through `destroy()`.
    expect(rects.every((r) => r.destroyed)).toBe(true);
    expect(stage.isDestroyed()).toBe(true);
  });

  it('is idempotent on multiple destroy() calls', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, LAVA_STAGE, { onLavaKo: () => {} });
    expect(() => {
      stage.destroy();
      stage.destroy();
      stage.destroy();
    }).not.toThrow();
  });

  it('makes per-frame methods no-ops after destroy()', () => {
    const { scene } = createMockScene();
    const stage = new BaseStage(scene, LAVA_STAGE, { onLavaKo: () => {} });
    stage.destroy();
    // Should not crash even though all visuals/bodies are gone.
    expect(() => stage.tickHazards(1)).not.toThrow();
    expect(() => stage.applyHazardEffects(1)).not.toThrow();
    expect(() => stage.updateRender(1)).not.toThrow();
  });
});
