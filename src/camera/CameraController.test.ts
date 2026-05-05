import { describe, it, expect, beforeEach } from 'vitest';
import { CameraController, type CameraTarget } from './CameraController';
import { FLAT_STAGE, STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../stages';

/**
 * `CameraController` is a Phaser-touching helper, but the bulk of its
 * logic — bounds derivation from blast zone, multi-target framing,
 * zoom-to-fit, deadzone wiring, viewport application — is pure math
 * applied to a small set of Phaser camera methods. We test it by
 * feeding it a mock scene that records every `setBounds`,
 * `setViewport`, `setZoom`, `centerOn`, and `setDeadzone` call.
 *
 * That keeps the unit suite Node-only (no jsdom), keeps it fast, and
 * locks down the contract Sub-AC 2.3 promises:
 *
 *   - Bounds clamp to the blast zone (with optional outset).
 *   - The camera follows the centroid of every active target.
 *   - Inactive targets are excluded from framing.
 *   - The viewport defaults to the scene's game size and can be
 *     overridden / re-applied at runtime.
 *   - Auto-zoom respects min/max and tightens when targets cluster.
 */

interface CameraCall {
  method: string;
  args: number[];
}

interface MockCamera {
  zoom: number;
  midPoint: { x: number; y: number };
  calls: CameraCall[];
  setBackgroundColor(color: string): MockCamera;
  setZoom(z: number): MockCamera;
  setBounds(x: number, y: number, w: number, h: number): MockCamera;
  setViewport(x: number, y: number, w: number, h: number): MockCamera;
  setDeadzone(w: number, h: number): MockCamera;
  centerOn(x: number, y: number): MockCamera;
}

function createMockCamera(): MockCamera {
  const cam: MockCamera = {
    zoom: 1,
    midPoint: { x: 0, y: 0 },
    calls: [],
    setBackgroundColor(_color: string) {
      cam.calls.push({ method: 'setBackgroundColor', args: [] });
      return cam;
    },
    setZoom(z: number) {
      cam.zoom = z;
      cam.calls.push({ method: 'setZoom', args: [z] });
      return cam;
    },
    setBounds(x: number, y: number, w: number, h: number) {
      cam.calls.push({ method: 'setBounds', args: [x, y, w, h] });
      return cam;
    },
    setViewport(x: number, y: number, w: number, h: number) {
      cam.calls.push({ method: 'setViewport', args: [x, y, w, h] });
      return cam;
    },
    setDeadzone(w: number, h: number) {
      cam.calls.push({ method: 'setDeadzone', args: [w, h] });
      return cam;
    },
    centerOn(x: number, y: number) {
      cam.midPoint = { x, y };
      cam.calls.push({ method: 'centerOn', args: [x, y] });
      return cam;
    },
  };
  return cam;
}

interface MockScale {
  gameSize: { width: number; height: number };
  on: (event: string, fn: (size: { width: number; height: number }) => void) => void;
  off: (event: string, fn: (size: { width: number; height: number }) => void) => void;
  listeners: Array<(size: { width: number; height: number }) => void>;
  emit: (size: { width: number; height: number }) => void;
}

function createMockScene(viewW = STAGE_DESIGN_WIDTH, viewH = STAGE_DESIGN_HEIGHT) {
  const camera = createMockCamera();
  const scaleListeners: Array<(size: { width: number; height: number }) => void> = [];
  const scale: MockScale = {
    gameSize: { width: viewW, height: viewH },
    listeners: scaleListeners,
    on(_event, fn) {
      scaleListeners.push(fn);
    },
    off(_event, fn) {
      const idx = scaleListeners.indexOf(fn);
      if (idx >= 0) scaleListeners.splice(idx, 1);
    },
    emit(size) {
      for (const fn of scaleListeners.slice()) fn(size);
    },
  };
  const scene: any = {
    cameras: { main: camera },
    scale,
  };
  return { scene, camera, scale };
}

describe('CameraController — bounds (Sub-AC 2.3)', () => {
  it('derives camera bounds from the stage blast zone by default', () => {
    const { scene, camera } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE);
    void cam;
    const z = FLAT_STAGE.blastZone;
    const boundsCall = camera.calls.find((c) => c.method === 'setBounds');
    expect(boundsCall).toBeDefined();
    expect(boundsCall!.args).toEqual([
      z.left,
      z.top,
      z.right - z.left,
      z.bottom - z.top,
    ]);
  });

  it('expands bounds by `boundsOutset` on every side', () => {
    const { scene, camera } = createMockScene();
    new CameraController(scene, FLAT_STAGE, { boundsOutset: 100 });
    const z = FLAT_STAGE.blastZone;
    const boundsCall = camera.calls.find((c) => c.method === 'setBounds');
    expect(boundsCall!.args).toEqual([
      z.left - 100,
      z.top - 100,
      z.right - z.left + 200,
      z.bottom - z.top + 200,
    ]);
  });

  it('honours an explicit `bounds` override and ignores the blast zone', () => {
    const { scene, camera } = createMockScene();
    new CameraController(scene, FLAT_STAGE, {
      bounds: { x: 0, y: 0, width: 4096, height: 2048 },
    });
    const boundsCall = camera.calls.find((c) => c.method === 'setBounds');
    expect(boundsCall!.args).toEqual([0, 0, 4096, 2048]);
  });

  it('falls back to the design viewport when no layout is provided', () => {
    const { scene, camera } = createMockScene();
    new CameraController(scene, null);
    const boundsCall = camera.calls.find((c) => c.method === 'setBounds');
    expect(boundsCall!.args).toEqual([0, 0, STAGE_DESIGN_WIDTH, STAGE_DESIGN_HEIGHT]);
  });

  it('reflects bounds updates via `setBounds()` after construction', () => {
    const { scene, camera } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE);
    camera.calls.length = 0; // reset call log
    cam.setBounds({ x: -500, y: -500, width: 3000, height: 1500 });
    const boundsCall = camera.calls.find((c) => c.method === 'setBounds');
    expect(boundsCall!.args).toEqual([-500, -500, 3000, 1500]);
    expect(cam.getBounds()).toEqual({ x: -500, y: -500, width: 3000, height: 1500 });
  });
});

describe('CameraController — viewport (Sub-AC 2.3)', () => {
  it('defaults the viewport to the scene game size', () => {
    const { scene, camera } = createMockScene(1280, 720);
    new CameraController(scene, FLAT_STAGE);
    const vpCall = camera.calls.find((c) => c.method === 'setViewport');
    expect(vpCall!.args).toEqual([0, 0, 1280, 720]);
  });

  it('honours an explicit viewport rectangle', () => {
    const { scene, camera } = createMockScene();
    new CameraController(scene, FLAT_STAGE, {
      viewport: { x: 100, y: 50, width: 800, height: 600 },
    });
    const vpCall = camera.calls.find((c) => c.method === 'setViewport');
    expect(vpCall!.args).toEqual([100, 50, 800, 600]);
  });

  it('responds to scale RESIZE events when no viewport override is set', () => {
    const { scene, camera, scale } = createMockScene(1920, 1080);
    new CameraController(scene, FLAT_STAGE);
    camera.calls.length = 0;
    scale.emit({ width: 1280, height: 720 });
    const vpCall = camera.calls.find((c) => c.method === 'setViewport');
    expect(vpCall).toBeDefined();
    expect(vpCall!.args).toEqual([0, 0, 1280, 720]);
  });

  it('does NOT auto-resize when an explicit viewport is pinned', () => {
    const { scene, camera, scale } = createMockScene();
    new CameraController(scene, FLAT_STAGE, {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
    });
    camera.calls.length = 0;
    scale.emit({ width: 1280, height: 720 });
    const vpCall = camera.calls.find((c) => c.method === 'setViewport');
    expect(vpCall).toBeUndefined();
  });

  it('exposes the current viewport via `getViewport()` after `setViewport()`', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE);
    cam.setViewport({ x: 50, y: 25, width: 1024, height: 768 });
    expect(cam.getViewport()).toEqual({
      x: 50,
      y: 25,
      width: 1024,
      height: 768,
    });
  });
});

describe('CameraController — follow behaviour (Sub-AC 2.3)', () => {
  it('starts centred on the bounds centre when no targets are set', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE);
    const center = cam.getTargetCenter();
    const z = FLAT_STAGE.blastZone;
    expect(center.x).toBeCloseTo((z.left + z.right) / 2);
    expect(center.y).toBeCloseTo((z.top + z.bottom) / 2);
  });

  it('honours `initialCenter` when supplied (within bounds)', () => {
    const { scene, camera } = createMockScene();
    // (1000, 540) is squarely inside the FLAT_STAGE bounds even with
    // a 1920×1080 viewport at zoom 1.0, so no Sub-AC 3 clamp triggers.
    new CameraController(scene, FLAT_STAGE, {
      initialCenter: { x: 1000, y: 540 },
    });
    expect(camera.midPoint).toEqual({ x: 1000, y: 540 });
  });

  it('targets the weighted centroid of active targets', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE, {
      followLerp: 1, // snap so we measure the target directly
      zoomLerp: 1,
    });
    const targets: CameraTarget[] = [
      { x: 200, y: 500 },
      { x: 800, y: 500 },
    ];
    cam.setTargets(targets);
    cam.update(16);
    const center = cam.getTargetCenter();
    expect(center.x).toBeCloseTo(500);
    expect(center.y).toBeCloseTo(500);
  });

  it('ignores inactive (KO\'d) targets when computing the centroid', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE, {
      followLerp: 1,
      zoomLerp: 1,
    });
    cam.setTargets([
      { x: 100, y: 500, active: false },
      { x: 800, y: 500, active: true },
    ]);
    cam.update(16);
    expect(cam.getTargetCenter().x).toBeCloseTo(800);
  });

  it('weights targets so a heavier focus pulls the centre harder', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE, {
      followLerp: 1,
      zoomLerp: 1,
    });
    cam.setTargets([
      { x: 0, y: 500, weight: 1 },
      { x: 1000, y: 500, weight: 3 }, // 3× pull
    ]);
    cam.update(16);
    // Weighted centroid: (0*1 + 1000*3) / (1+3) = 750
    expect(cam.getTargetCenter().x).toBeCloseTo(750);
  });

  it('returns the camera to bounds centre when all targets become inactive', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE, {
      followLerp: 1,
      zoomLerp: 1,
    });
    cam.setTargets([{ x: 1500, y: 200, active: true }]);
    cam.update(16);
    expect(cam.getTargetCenter().x).toBeCloseTo(1500);
    cam.setTargets([{ x: 1500, y: 200, active: false }]);
    cam.update(16);
    const z = FLAT_STAGE.blastZone;
    expect(cam.getTargetCenter().x).toBeCloseTo((z.left + z.right) / 2);
  });

  it('lerps smoothly toward the target between updates', () => {
    const { scene, camera } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE, {
      followLerp: 0.5,
      zoomLerp: 0.5,
      initialCenter: { x: 0, y: 0 },
    });
    cam.setTargets([{ x: 1000, y: 0 }]);
    const before = camera.midPoint.x;
    cam.update(1000); // 1s of lerp
    const after = camera.midPoint.x;
    // Should have moved meaningfully but not snapped to 1000.
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(1000);
  });
});

describe('CameraController — zoom-to-fit (Sub-AC 2.3)', () => {
  it('clamps target zoom to `maxZoom` for a single target', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE, {
      maxZoom: 1.0,
      minZoom: 0.5,
      followLerp: 1,
      zoomLerp: 1,
    });
    cam.setTargets([{ x: 960, y: 540 }]);
    cam.update(16);
    expect(cam.getTargetZoom()).toBeCloseTo(1.0);
  });

  it('zooms out to fit when targets spread across the stage', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE, {
      maxZoom: 1.0,
      minZoom: 0.4,
      framePadding: 0,
      followLerp: 1,
      zoomLerp: 1,
    });
    // Targets ~1900 px apart — wider than the 1920 viewport once any
    // padding is added, so zoom should drop below 1.
    cam.setTargets([
      { x: 0, y: 540 },
      { x: 1920, y: 540 },
    ]);
    cam.update(16);
    expect(cam.getTargetZoom()).toBeLessThanOrEqual(1.0);
  });

  it('does not pull below `minZoom` even for extreme target spreads', () => {
    const { scene } = createMockScene();
    const cam = new CameraController(scene, FLAT_STAGE, {
      maxZoom: 1.0,
      minZoom: 0.5,
      framePadding: 0,
      followLerp: 1,
      zoomLerp: 1,
    });
    cam.setTargets([
      { x: -10000, y: 540 },
      { x: 10000, y: 540 },
    ]);
    cam.update(16);
    expect(cam.getTargetZoom()).toBeGreaterThanOrEqual(0.5);
  });
});

describe('CameraController — camera-cannot-scroll-outside-stage (Sub-AC 3 of AC 103)', () => {
  it('clamps the camera centre when a target sits past the right blast zone', () => {
    // Use a smaller viewport so the bounds clamp window is non-empty.
    const { scene, camera } = createMockScene(640, 480);
    const cam = new CameraController(scene, FLAT_STAGE, {
      // Snap so the lerp result equals the desired target each tick.
      followLerp: 1,
      zoomLerp: 1,
      // Defeat the auto-zoom-out so the clamp's halfVw stays at 320.
      maxZoom: 1.0,
      minZoom: 1.0,
    });
    // Target far past the right blast-zone edge (right = 2160).
    cam.setTargets([{ x: 9999, y: 540 }]);
    cam.update(16);
    const z = FLAT_STAGE.blastZone;
    // Visible half-width at zoom 1 is 320 → max centre.x is right - 320.
    expect(camera.midPoint.x).toBeLessThanOrEqual(z.right - 320 + 1e-6);
    // And it should not have shrunk below the left clamp.
    expect(camera.midPoint.x).toBeGreaterThanOrEqual(z.left + 320 - 1e-6);
  });

  it('clamps the camera centre when a target sits past the bottom blast zone', () => {
    const { scene, camera } = createMockScene(640, 480);
    const cam = new CameraController(scene, FLAT_STAGE, {
      followLerp: 1,
      zoomLerp: 1,
      maxZoom: 1.0,
      minZoom: 1.0,
    });
    // Target far below the pit (bottom = 1320).
    cam.setTargets([{ x: 960, y: 99999 }]);
    cam.update(16);
    const z = FLAT_STAGE.blastZone;
    // Visible half-height at zoom 1 is 240 → max centre.y is bottom - 240.
    expect(camera.midPoint.y).toBeLessThanOrEqual(z.bottom - 240 + 1e-6);
  });

  it('keeps the camera at the bounds centre when the visible region exceeds the bounds', () => {
    // Viewport WIDER than bounds at this zoom — there's no legal
    // camera position that hides every off-bounds pixel. The camera
    // pins to the bounds centre so empty-space margins are symmetric
    // on both sides (instead of stranded all on one side, which would
    // visibly look like "off-stage void on the left").
    const { scene, camera } = createMockScene(1920, 1080);
    const cam = new CameraController(scene, FLAT_STAGE, {
      bounds: { x: 100, y: 100, width: 600, height: 600 },
      followLerp: 1,
      zoomLerp: 1,
      maxZoom: 1.0,
      minZoom: 1.0,
      framePadding: 0,
    });
    cam.setTargets([{ x: 50000, y: -50000 }]);
    cam.update(16);
    expect(camera.midPoint.x).toBeCloseTo(400); // 100 + 600/2
    expect(camera.midPoint.y).toBeCloseTo(400); // 100 + 600/2
  });

  it('snap() also respects the bounds clamp', () => {
    const { scene, camera } = createMockScene(640, 480);
    const cam = new CameraController(scene, FLAT_STAGE, {
      followLerp: 0, // no lerp — snap explicitly
      zoomLerp: 0,
      maxZoom: 1.0,
      minZoom: 1.0,
    });
    cam.setTargets([{ x: 99999, y: 540 }]);
    cam.update(16);
    cam.snap();
    const z = FLAT_STAGE.blastZone;
    expect(camera.midPoint.x).toBeLessThanOrEqual(z.right - 320 + 1e-6);
  });

  it('clamps the initial centre even when the caller passed an out-of-bounds value', () => {
    const { scene, camera } = createMockScene(1920, 1080);
    new CameraController(scene, FLAT_STAGE, {
      // Out-of-bounds initial centre — we expect it to be clamped to
      // the bounds-aware minimum, NOT applied verbatim.
      initialCenter: { x: -99999, y: -99999 },
      maxZoom: 1.0,
      minZoom: 1.0,
    });
    const z = FLAT_STAGE.blastZone;
    // halfVw = 960, halfVh = 540 at zoom 1 with a 1920×1080 viewport.
    expect(camera.midPoint.x).toBeGreaterThanOrEqual(z.left + 960 - 1e-6);
    expect(camera.midPoint.y).toBeGreaterThanOrEqual(z.top + 540 - 1e-6);
  });

  it('configures camera bounds whose dimensions exactly equal the stage extent', () => {
    const { scene, camera } = createMockScene();
    new CameraController(scene, FLAT_STAGE);
    const z = FLAT_STAGE.blastZone;
    const boundsCall = camera.calls.find((c) => c.method === 'setBounds');
    expect(boundsCall).toBeDefined();
    // (x, y, width, height) === stage extent, exactly.
    expect(boundsCall!.args[0]).toBe(z.left);
    expect(boundsCall!.args[1]).toBe(z.top);
    expect(boundsCall!.args[2]).toBe(z.right - z.left);
    expect(boundsCall!.args[3]).toBe(z.bottom - z.top);
  });
});

describe('CameraController — viewport configuration', () => {
  it('applies a deadzone by default', () => {
    const { scene, camera } = createMockScene();
    new CameraController(scene, FLAT_STAGE);
    const dzCall = camera.calls.find((c) => c.method === 'setDeadzone');
    expect(dzCall).toBeDefined();
    expect(dzCall!.args.length).toBe(2);
    expect(dzCall!.args[0]).toBeGreaterThan(0);
    expect(dzCall!.args[1]).toBeGreaterThan(0);
  });

  it('skips the deadzone when explicitly disabled', () => {
    const { scene, camera } = createMockScene();
    new CameraController(scene, FLAT_STAGE, { deadzone: null });
    const dzCall = camera.calls.find((c) => c.method === 'setDeadzone');
    expect(dzCall).toBeUndefined();
  });

  it('applies the `defaultZoom` immediately on construction', () => {
    const { scene, camera } = createMockScene();
    new CameraController(scene, FLAT_STAGE, { defaultZoom: 0.75 });
    expect(camera.zoom).toBeCloseTo(0.75);
  });
});

describe('CameraController — lifecycle', () => {
  let snap: ReturnType<typeof createMockScene>;
  beforeEach(() => {
    snap = createMockScene();
  });

  it('snap() removes any smoothing residual', () => {
    const cam = new CameraController(snap.scene, FLAT_STAGE, {
      initialCenter: { x: 0, y: 0 },
    });
    cam.setTargets([{ x: 800, y: 400 }]);
    cam.update(16);
    cam.snap();
    expect(snap.camera.midPoint.x).toBeCloseTo(cam.getTargetCenter().x);
    expect(snap.camera.midPoint.y).toBeCloseTo(cam.getTargetCenter().y);
    expect(snap.camera.zoom).toBeCloseTo(cam.getTargetZoom());
  });

  it('destroy() detaches the resize listener and is idempotent', () => {
    const cam = new CameraController(snap.scene, FLAT_STAGE);
    expect(snap.scale.listeners.length).toBe(1);
    cam.destroy();
    expect(snap.scale.listeners.length).toBe(0);
    expect(() => cam.destroy()).not.toThrow();
  });

  it('destroy() is a no-op when no resize listener was registered', () => {
    const cam = new CameraController(snap.scene, FLAT_STAGE, {
      viewport: { x: 0, y: 0, width: 800, height: 600 },
    });
    expect(snap.scale.listeners.length).toBe(0);
    expect(() => cam.destroy()).not.toThrow();
  });

  it('addTarget() appends without losing existing targets', () => {
    const cam = new CameraController(snap.scene, FLAT_STAGE, {
      followLerp: 1,
      zoomLerp: 1,
    });
    cam.setTargets([{ x: 200, y: 0 }]);
    cam.addTarget({ x: 800, y: 0 });
    cam.update(16);
    expect(cam.getTargetCenter().x).toBeCloseTo(500);
  });
});
