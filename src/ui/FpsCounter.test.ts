import { describe, it, expect, beforeEach } from 'vitest';
import { FpsCounter } from './FpsCounter';
import {
  FPS_HEALTH_RAMP,
  colorIntToHexString,
  formatFpsLine,
} from './fpsCounterFormat';
import { GAME_CONFIG } from '../engine/constants';

/**
 * Sub-AC 3 of AC 3 — `FpsCounter` is Phaser-touching but its bulk
 * of logic (rolling tick-rate window, line formatting, colour ramp)
 * lives behind a narrow scene-shape we mock here.
 *
 * What this suite locks down:
 *
 *   1. Construction creates exactly one text object pinned to the
 *      viewport at the configured top-left margin.
 *   2. `update()` reads `game.loop.actualFps` + the meter's rolling Hz
 *      and writes the canonical "FPS X | SIM Y Hz | target Z" string.
 *   3. The hot path is idempotent — calling `update()` twice in a row
 *      with the same rates does not re-`setText`.
 *   4. The text colour ramps from green → yellow → red as render FPS
 *      drops below the 60 FPS target.
 *   5. `recordSimSteps` feeds the meter so the SIM Hz readout reflects
 *      the deterministic step cadence.
 *   6. `destroy()` releases the underlying text object exactly once.
 */
interface MockText {
  x: number;
  y: number;
  text: string;
  color: string;
  origin: { x: number; y: number };
  scrollFactor: { x: number; y: number };
  depth: number;
  destroyed: boolean;
  setTextCalls: number;
  setColorCalls: number;
  setText(value: string): MockText;
  setColor(value: string): MockText;
  setOrigin(x: number, y?: number): MockText;
  setScrollFactor(x: number, y?: number): MockText;
  setPosition(x: number, y: number): MockText;
  setDepth(depth: number): MockText;
  destroy(): void;
}

interface CreatedTextRecord {
  initial: { x: number; y: number; text: string; color: string };
  ref: MockText;
}

interface MockScene {
  game: { loop: { actualFps: number } };
  scale: { gameSize: { width: number; height: number } };
  add: { text: (x: number, y: number, content: string, style: any) => MockText };
  created: CreatedTextRecord[];
}

function createMockScene(initialFps = 60, viewW = 1280, viewH = 720): MockScene {
  const created: CreatedTextRecord[] = [];
  const scene: MockScene = {
    game: { loop: { actualFps: initialFps } },
    scale: { gameSize: { width: viewW, height: viewH } },
    add: {
      text(x, y, content, style) {
        const text: MockText = {
          x,
          y,
          text: content,
          color: typeof style?.color === 'string' ? style.color : '#ffffff',
          origin: { x: 0, y: 0 },
          scrollFactor: { x: 1, y: 1 },
          depth: 0,
          destroyed: false,
          setTextCalls: 0,
          setColorCalls: 0,
          setText(value) {
            text.setTextCalls += 1;
            text.text = value;
            return text;
          },
          setColor(value) {
            text.setColorCalls += 1;
            text.color = value;
            return text;
          },
          setOrigin(ox, oy) {
            text.origin = { x: ox, y: oy ?? ox };
            return text;
          },
          setScrollFactor(sx, sy) {
            text.scrollFactor = { x: sx, y: sy ?? sx };
            return text;
          },
          setPosition(nx, ny) {
            text.x = nx;
            text.y = ny;
            return text;
          },
          setDepth(d) {
            text.depth = d;
            return text;
          },
          destroy() {
            text.destroyed = true;
          },
        };
        created.push({
          initial: { x, y, text: content, color: text.color },
          ref: text,
        });
        return text;
      },
    },
    created,
  };
  return scene;
}

/** Synthetic monotonic clock for the rolling-window meter. */
function createClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

// ---------------------------------------------------------------------------

describe('FpsCounter — construction', () => {
  let scene: MockScene;
  beforeEach(() => {
    scene = createMockScene();
  });

  it('creates exactly one text object', () => {
    new FpsCounter(scene as any);
    expect(scene.created).toHaveLength(1);
  });

  it('pins the text to the viewport (scrollFactor 0)', () => {
    new FpsCounter(scene as any);
    const ref = scene.created[0]!.ref;
    expect(ref.scrollFactor).toEqual({ x: 0, y: 0 });
  });

  it('positions the text at the configured top-left margin', () => {
    new FpsCounter(scene as any, { leftMargin: 16, topMargin: 24 });
    const ref = scene.created[0]!.ref;
    expect(ref.x).toBe(16);
    expect(ref.y).toBe(24);
  });

  it('uses depth 10000 by default — above the damage HUD (1000)', () => {
    new FpsCounter(scene as any);
    expect(scene.created[0]!.ref.depth).toBe(10000);
  });

  it('initial text reflects the unmeasured state ("FPS — | SIM 0 Hz | target 60")', () => {
    new FpsCounter(scene as any);
    expect(scene.created[0]!.initial.text).toBe(
      'FPS — | SIM 0 Hz | target 60',
    );
  });

  it('honours an override targetFps', () => {
    new FpsCounter(scene as any, { targetFps: 120 });
    expect(scene.created[0]!.initial.text).toBe(
      'FPS — | SIM 0 Hz | target 120',
    );
  });

  it('default targetFps tracks GAME_CONFIG.targetFps', () => {
    const fps = new FpsCounter(scene as any);
    expect(fps.getTargetFps()).toBe(GAME_CONFIG.targetFps);
  });
});

describe('FpsCounter — update()', () => {
  let scene: MockScene;
  let fps: FpsCounter;
  let clock: ReturnType<typeof createClock>;

  beforeEach(() => {
    scene = createMockScene(60);
    clock = createClock(0);
    fps = new FpsCounter(scene as any, { targetFps: 60 }, clock.now);
  });

  it('writes the canonical "FPS X | SIM Y Hz | target Z" line', () => {
    // Drive the simulation tick rate up to 60 Hz — 30 samples in the
    // 500 ms window. We record all 30 in a single tick at t=0 so the
    // rolling window contains exactly 30 entries; getRateHz then
    // returns 30 × (1000/500) = 60 Hz cleanly.
    fps.recordSimSteps(30);
    fps.update();
    expect(fps.getCurrentLine()).toBe('FPS 60 | SIM 60 Hz | target 60');
  });

  it('paints green when render FPS is at 60', () => {
    scene.game.loop.actualFps = 60;
    fps.update();
    expect(scene.created[0]!.ref.color).toBe(
      colorIntToHexString(FPS_HEALTH_RAMP[0]!.color),
    );
  });

  it('paints yellow when render FPS dips into the 50–57 band', () => {
    scene.game.loop.actualFps = 55;
    fps.update();
    expect(scene.created[0]!.ref.color).toBe(
      colorIntToHexString(FPS_HEALTH_RAMP[1]!.color),
    );
  });

  it('paints red when render FPS falls below the 50 fps floor', () => {
    scene.game.loop.actualFps = 30;
    fps.update();
    expect(scene.created[0]!.ref.color).toBe(
      colorIntToHexString(FPS_HEALTH_RAMP[2]!.color),
    );
  });

  it('skips setText on the hot path when nothing changes', () => {
    // First update — paints once.
    scene.game.loop.actualFps = 60;
    fps.update();
    const before = scene.created[0]!.ref.setTextCalls;
    // Identical second update — no further text mutation.
    fps.update();
    expect(scene.created[0]!.ref.setTextCalls).toBe(before);
  });

  it('skips setColor on the hot path when the band is unchanged', () => {
    scene.game.loop.actualFps = 60;
    fps.update();
    const before = scene.created[0]!.ref.setColorCalls;
    // Same band — no setColor.
    scene.game.loop.actualFps = 59;
    fps.update();
    expect(scene.created[0]!.ref.setColorCalls).toBe(before);
  });

  it('repaints when the render FPS crosses a band boundary', () => {
    scene.game.loop.actualFps = 60;
    fps.update();
    const beforeColor = scene.created[0]!.ref.setColorCalls;
    scene.game.loop.actualFps = 30;
    fps.update();
    expect(scene.created[0]!.ref.setColorCalls).toBe(beforeColor + 1);
    expect(scene.created[0]!.ref.color).toBe(
      colorIntToHexString(FPS_HEALTH_RAMP[2]!.color),
    );
  });

  it('reflects the simulation tick rate from recordSimSteps', () => {
    // No sim steps → SIM 0 Hz.
    scene.game.loop.actualFps = 60;
    fps.update();
    expect(fps.getCurrentLine()).toContain('SIM 0 Hz');

    // 30 steps in the 500 ms window → SIM 60 Hz.
    fps.recordSimSteps(30);
    fps.update();
    expect(fps.getCurrentLine()).toContain('SIM 60 Hz');
  });

  it('drops stale tick samples when the window expires', () => {
    // 60 samples at t=0.
    fps.recordSimSteps(60);
    expect(fps.getTickMeterSampleCount()).toBe(60);
    // Advance past the window.
    clock.advance(2000);
    fps.update();
    expect(fps.getCurrentLine()).toContain('SIM 0 Hz');
    expect(fps.getTickMeterSampleCount()).toBe(0);
  });

  it('reports renderFps verbatim from Phaser game.loop.actualFps', () => {
    scene.game.loop.actualFps = 47;
    expect(fps.getRenderFps()).toBe(47);
  });
});

describe('FpsCounter — recordSimSteps', () => {
  it('feeds the rolling-window meter (one sample per step)', () => {
    const scene = createMockScene();
    const fps = new FpsCounter(scene as any);
    fps.recordSimSteps(4);
    expect(fps.getTickMeterSampleCount()).toBe(4);
  });

  it('is a no-op for zero / negative step counts', () => {
    const scene = createMockScene();
    const fps = new FpsCounter(scene as any);
    fps.recordSimSteps(0);
    fps.recordSimSteps(-1);
    expect(fps.getTickMeterSampleCount()).toBe(0);
  });

  it('is a no-op after destroy()', () => {
    const scene = createMockScene();
    const fps = new FpsCounter(scene as any);
    fps.destroy();
    fps.recordSimSteps(5);
    expect(fps.getTickMeterSampleCount()).toBe(0);
  });
});

describe('FpsCounter — reset()', () => {
  it('drops the rolling-window samples and resets the cached line', () => {
    const scene = createMockScene();
    const clock = createClock();
    const fps = new FpsCounter(scene as any, undefined, clock.now);
    fps.recordSimSteps(30);
    fps.update();
    expect(fps.getTickMeterSampleCount()).toBe(30);
    fps.reset();
    expect(fps.getTickMeterSampleCount()).toBe(0);
    expect(fps.getCurrentLine()).toBe(
      formatFpsLine(Number.NaN, 0, GAME_CONFIG.targetFps),
    );
  });
});

describe('FpsCounter — destroy()', () => {
  it('destroys the underlying text exactly once', () => {
    const scene = createMockScene();
    const fps = new FpsCounter(scene as any);
    expect(scene.created[0]!.ref.destroyed).toBe(false);
    fps.destroy();
    expect(scene.created[0]!.ref.destroyed).toBe(true);
  });

  it('is idempotent', () => {
    const scene = createMockScene();
    const fps = new FpsCounter(scene as any);
    expect(() => {
      fps.destroy();
      fps.destroy();
    }).not.toThrow();
  });

  it('makes update() and getRenderFps() / getSimHz() safe no-ops', () => {
    const scene = createMockScene();
    const fps = new FpsCounter(scene as any);
    fps.destroy();
    expect(() => fps.update()).not.toThrow();
    expect(fps.getRenderFps()).toBe(0);
    expect(fps.getSimHz()).toBe(0);
  });
});
