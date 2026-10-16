/** Prepared for final verification. Independent circle/box boundary cases;
 * this is geometry evidence, not live actor contact or native article parity. */
import {describe, expect, it} from 'vitest';
import {sweptCircleBoundsEntry} from './projectileCircleSweep';

const box = {min: {x: 0, y: 0}, max: {x: 2, y: 2}};
describe('circle sweep against target bounds', () => {
  it('does not accept the empty square outside a rounded corner', () => {
    expect(sweptCircleBoundsEntry({x: -0.9, y: -0.9}, {x: -0.9, y: -0.9}, box, 1)).toBeNull();
    expect(sweptCircleBoundsEntry({x: -0.5, y: -0.5}, {x: -0.5, y: -0.5}, box, 1)).toBe(0);
  });
  it('uses the independent diagonal distance to the corner at first contact', () => {
    expect(sweptCircleBoundsEntry({x: -5, y: -5}, {x: 5, y: 5}, box, 1))
      .toBeCloseTo((5 - 1 / Math.sqrt(2)) / 10, 12);
  });
  it('retains exact side-strip entry and both travel directions', () => {
    expect(sweptCircleBoundsEntry({x: -5, y: 1}, {x: 5, y: 1}, box, 1)).toBeCloseTo(0.4, 12);
    expect(sweptCircleBoundsEntry({x: 7, y: 1}, {x: -3, y: 1}, box, 1)).toBeCloseTo(0.4, 12);
  });
  it('includes the true corner tangent, and excludes a separated parallel path', () => {
    expect(sweptCircleBoundsEntry({x: -5, y: -1}, {x: 5, y: -1}, box, 1)).toBeCloseTo(0.5, 12);
    expect(sweptCircleBoundsEntry({x: -5, y: -1.001}, {x: 5, y: -1.001}, box, 1)).toBeNull();
  });
  it('preserves fraction under translation and mirroring', () => {
    const shifted = {min: {x: 100, y: -30}, max: {x: 102, y: -28}};
    const fraction = (5 - 1 / Math.sqrt(2)) / 10;
    expect(sweptCircleBoundsEntry({x: 95, y: -35}, {x: 105, y: -25}, shifted, 1)).toBeCloseTo(fraction, 12);
    expect(sweptCircleBoundsEntry({x: 5, y: -5}, {x: -5, y: 5},
      {min: {x: -2, y: 0}, max: {x: 0, y: 2}}, 1)).toBeCloseTo(fraction, 12);
  });
  it('supports point articles and degenerate line/point target bounds', () => {
    expect(sweptCircleBoundsEntry({x: -5, y: 1}, {x: 5, y: 1}, box, 0)).toBeCloseTo(0.5, 12);
    expect(sweptCircleBoundsEntry({x: -5, y: 0}, {x: 5, y: 0},
      {min: {x: 0, y: 0}, max: {x: 0, y: 0}}, 1)).toBeCloseTo(0.4, 12);
  });
  it('rejects malformed and overflowing derived geometry', () => {
    expect(() => sweptCircleBoundsEntry({x: NaN, y: 0}, {x: 0, y: 0}, box, 1)).toThrow();
    expect(() => sweptCircleBoundsEntry({x: 0, y: 0}, {x: 0, y: 0}, box, -1)).toThrow();
    expect(() => sweptCircleBoundsEntry({x: 0, y: 0}, {x: 0, y: 0},
      {min: {x: 2, y: 0}, max: {x: 0, y: 2}}, 1)).toThrow();
    expect(() => sweptCircleBoundsEntry({x: 0, y: 0}, {x: 0, y: 0},
      {min: {x: -Number.MAX_VALUE, y: 0}, max: {x: Number.MAX_VALUE, y: 2}}, 1)).toThrow();
  });
});
