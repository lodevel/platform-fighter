import { describe, expect, it } from 'vitest';
import { STAGES } from '../stages/stageDefinitions';
import { CameraFraming, MATCH_CAMERA_OPTIONS, clampCenterToBounds, computeTargetEnvelope, frameRateIndependentLerp } from './cameraFraming';

describe('cameraFraming', () => {
  it('centres on the weighted centroid of active targets only', () => {
    const env = computeTargetEnvelope([{ x: 0, y: 0 }, { x: 100, y: 50, weight: 3 }, { x: 999, y: 999, active: false }]);
    expect(env).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50, centerX: 75, centerY: 37.5 });
    expect(computeTargetEnvelope([{ x: 1, y: 1, active: false }])).toBeNull();
  });

  it('eases frame-rate independently and clamps factors', () => {
    expect(frameRateIndependentLerp(0, 10, 0, 16)).toBe(0);
    expect(frameRateIndependentLerp(0, 10, 1, 16)).toBe(10);
    const one = frameRateIndependentLerp(0, 10, 0.5, 1000);
    expect(one).toBeCloseTo(5);
    // Two half-steps land where one full step does.
    expect(frameRateIndependentLerp(frameRateIndependentLerp(0, 10, 0.5, 500), 10, 0.5, 500)).toBeCloseTo(one);
  });

  it('never frames outside the bounds, and centres when the view is larger than them', () => {
    const bounds = { x: 0, y: 0, width: 1000, height: 600 }, viewport = { x: 0, y: 0, width: 400, height: 300 };
    expect(clampCenterToBounds(-500, 9999, bounds, viewport, 1)).toEqual({ x: 200, y: 450 });
    expect(clampCenterToBounds(10, 10, bounds, viewport, 0.1)).toEqual({ x: 500, y: 300 });
  });

  it('zooms out to keep spread fighters in view, within the match zoom range', () => {
    const cam = new CameraFraming(STAGES.flat!, MATCH_CAMERA_OPTIONS);
    cam.setTargets([{ x: 900, y: 900 }, { x: 1000, y: 900 }]);
    for (let i = 0; i < 120; i++) cam.update(1000 / 60);
    const close = cam.zoom;
    cam.setTargets([{ x: 100, y: 900 }, { x: 1800, y: 700 }]);
    for (let i = 0; i < 120; i++) cam.update(1000 / 60);
    expect(cam.zoom).toBeLessThan(close);
    expect(cam.zoom).toBeGreaterThanOrEqual(0.4);
    expect(close).toBeLessThanOrEqual(1.4);
    const r = cam.visibleRect(), b = cam.getBounds();
    expect(r.x).toBeGreaterThanOrEqual(b.x - 1e-6);
    expect(r.x + r.width).toBeLessThanOrEqual(b.x + b.width + 1e-6);
  });
});
