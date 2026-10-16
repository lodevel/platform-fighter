import { describe, expect, it } from 'vitest';
import { infernoSceneryFrame } from './cameraRig';

describe('Inferno scenic framing', () => {
  it('keeps the preview composition during close combat instead of cropping its inhabitants', () => {
    expect(infernoSceneryFrame([{ x: 920, y: 870 }, { x: 1050, y: 920 }]))
      .toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });

  it('keeps a launched fighter in frame while retaining the whole scenic composition', () => {
    const target = { x: -350, y: -500 };
    const rect = infernoSceneryFrame([target, { x: 1000, y: 900 }]);
    expect(rect.width / rect.height).toBeCloseTo(16 / 9);
    expect(rect.x).toBeLessThanOrEqual(target.x - 140);
    expect(rect.y).toBeLessThanOrEqual(target.y - 140);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(1920);
    expect(rect.y + rect.height).toBeGreaterThanOrEqual(1080);
  });

  it('does not follow eliminated or zero-weight fighters out of the composition', () => {
    expect(infernoSceneryFrame([{ x: -10000, y: -10000, active: false },
      { x: 10000, y: 10000, weight: 0 }])).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});
