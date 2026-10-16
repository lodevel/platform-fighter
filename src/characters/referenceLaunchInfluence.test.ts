import { describe, expect, it } from 'vitest';
import { applyReferenceLaunchInfluence, referenceLaunchSpeedMultiplier } from './referenceLaunchInfluence';

const radians = (degrees: number) => degrees * Math.PI / 180;
const vector = (degrees: number, speed = 20) => ({
  x: speed * Math.cos(radians(degrees)), y: speed * Math.sin(radians(degrees)),
});
const speed = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);

describe('reference launch-speed influence', () => {
  it.each([
    [-1, 1.095], [-0.5, 1.0475], [0, 1], [0.5, 0.96], [1, 0.92],
  ])('maps resolved screen Y %s to multiplier %s', (y, multiplier) => {
    expect(referenceLaunchSpeedMultiplier(radians(-38), y)).toBeCloseTo(multiplier, 12);
  });

  it.each([65, 115, 245, 295])('keeps exact %s degree endpoints eligible', degrees => {
    expect(referenceLaunchSpeedMultiplier(radians(degrees), -1)).toBeCloseTo(1.095, 12);
    expect(referenceLaunchSpeedMultiplier(radians(-degrees), 1)).toBeCloseTo(0.92, 12);
  });

  it.each([65.000001, 114.999999, 245.000001, 294.999999, 90, 270])(
    'suppresses speed influence inside the vertical window at %s degrees', degrees => {
      expect(referenceLaunchSpeedMultiplier(radians(degrees), -1)).toBe(1);
      expect(referenceLaunchSpeedMultiplier(radians(-degrees), 1)).toBe(1);
    },
  );

  it.each([64.999999, 115.000001, 244.999999, 295.000001])(
    'allows speed influence just outside the window at %s degrees', degrees => {
      expect(referenceLaunchSpeedMultiplier(radians(degrees), -1)).toBeCloseTo(1.095, 12);
    },
  );

  it('requires tumble, nonzero velocity and the mirrored near-horizontal gate', () => {
    for (const degrees of [0, 5, 175, 180, 185, 355]) {
      const launch = vector(degrees);
      expect(applyReferenceLaunchInfluence(launch, { stickX: 0, stickY: -1 }, true)).toEqual(launch);
    }
    const launch = vector(-38);
    expect(applyReferenceLaunchInfluence(launch, { stickX: 0, stickY: -1 }, false)).toEqual(launch);
    expect(applyReferenceLaunchInfluence({ x: 0, y: 0 }, { stickX: 1, stickY: 1 }, true)).toEqual({ x: 0, y: 0 });
    expect(applyReferenceLaunchInfluence(launch, { stickX: 0, stickY: 0 }, true)).toEqual(launch);
  });

  it('rotates first, so DI can enter and leave the LSI exclusion window', () => {
    const enters = applyReferenceLaunchInfluence(vector(-63), { stickX: -1, stickY: -1 }, true);
    const leaves = applyReferenceLaunchInfluence(vector(-67), { stickX: 1, stickY: -1 }, true);
    expect(Math.atan2(enters.y, enters.x)).toBeLessThan(radians(-65));
    expect(speed(enters)).toBeCloseTo(20, 12);
    expect(Math.atan2(leaves.y, leaves.x)).toBeGreaterThan(radians(-65));
    expect(speed(leaves)).toBeCloseTo(20 * (1 + 0.095 * Math.SQRT1_2), 12);
  });

  it('uses the same unit-disc adapter for DI and LSI, preserving partial analog input', () => {
    const launch = vector(-38);
    const keyboard = applyReferenceLaunchInfluence(launch, { stickX: 1, stickY: 1 }, true);
    const analog = applyReferenceLaunchInfluence(launch, { stickX: Math.SQRT1_2, stickY: Math.SQRT1_2 }, true);
    expect(keyboard.x).toBeCloseTo(analog.x, 12);
    expect(keyboard.y).toBeCloseTo(analog.y, 12);
    expect(speed(keyboard)).toBeCloseTo(20 * (1 - 0.08 * Math.SQRT1_2), 12);
    const partial = applyReferenceLaunchInfluence(launch, { stickX: 0, stickY: -0.5 }, true);
    expect(speed(partial)).toBeCloseTo(20 * 1.0475, 12);
    expect(Math.atan2(partial.y, partial.x)).toBeCloseTo(radians(-38) - 0.085 * Math.cos(radians(-38)), 12);
  });

  it('mirrors both launch and horizontal input without changing launch speed', () => {
    const launch = vector(-38);
    const right = applyReferenceLaunchInfluence(launch, { stickX: 0.6, stickY: -0.8 }, true);
    const left = applyReferenceLaunchInfluence({ x: -launch.x, y: launch.y }, { stickX: -0.6, stickY: -0.8 }, true);
    expect(left.x).toBeCloseTo(-right.x, 12);
    expect(left.y).toBeCloseTo(right.y, 12);
  });

  it('treats nonfinite stick components as neutral', () => {
    const launch = vector(-38);
    expect(applyReferenceLaunchInfluence(launch, { stickX: NaN, stickY: Infinity }, true)).toEqual(launch);
    expect(applyReferenceLaunchInfluence(launch, { stickX: NaN, stickY: -1 }, true))
      .toEqual(applyReferenceLaunchInfluence(launch, { stickX: 0, stickY: -1 }, true));
  });
});
