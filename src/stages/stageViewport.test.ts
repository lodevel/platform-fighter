import { describe, expect, it } from 'vitest';
import { computeStageViewportTransform } from './stageViewport';

describe('computeStageViewportTransform', () => {
  it('is the identity at the 1920×1080 design size', () => {
    expect(computeStageViewportTransform({ width: 1920, height: 1080 })).toEqual({ viewportScale: 1, offsetX: 0, offsetY: 0 });
  });

  it('scales uniformly by the smaller ratio and centres the design space', () => {
    expect(computeStageViewportTransform({ width: 1280, height: 720 })).toEqual({ viewportScale: 2 / 3, offsetX: 0, offsetY: 0 });
    expect(computeStageViewportTransform({ width: 2560, height: 1080 })).toEqual({ viewportScale: 1, offsetX: 320, offsetY: 0 });
    expect(computeStageViewportTransform({ width: 960, height: 1080 })).toEqual({ viewportScale: 0.5, offsetX: 0, offsetY: 270 });
  });
});
