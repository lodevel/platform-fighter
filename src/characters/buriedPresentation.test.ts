import { describe, expect, it } from 'vitest';
import { BURIED_MASH_SHAKE_FRAMES, BURIED_SINK_FRACTION, buriedDirtSplashes, buriedEffects, buriedSinkDepth, buriedSpriteSink,
  sinkHurtboxes } from './buriedPresentation';

describe('buried fighter drawing: sunk into the floor and cut at the floor line', () => {
  // DK cargo-sized cell: 296 px tall, root row 285, 0.4666667 world per px; the root stands on the floor.
  const dk = { floorY: 500, spriteY: 500, originY: 285 / 296, frameHeight: 296, scaleY: 0.4666667, bodyHeight: 84 };
  it('sinks by half the body height and keeps only the rows above the floor', () => {
    const { offsetY, cropHeight } = buriedSpriteSink(dk);
    expect(BURIED_SINK_FRACTION).toBe(0.5);
    expect(offsetY).toBe(42);
    const top = dk.spriteY + offsetY - dk.originY * dk.frameHeight * dk.scaleY;
    // The last kept row ends exactly on the floor line.
    expect(top + cropHeight * dk.scaleY).toBeCloseTo(dk.floorY, 6);
    expect(cropHeight).toBeGreaterThan(0);
    expect(cropHeight).toBeLessThan(dk.frameHeight);
  });
  it('clamps to the frame: nothing is shown above a fully sunk frame, all of a frame that stays above the floor', () => {
    expect(buriedSpriteSink({ ...dk, spriteY: 900 }).cropHeight).toBe(0);
    expect(buriedSpriteSink({ ...dk, spriteY: 0 }).cropHeight).toBe(dk.frameHeight);
  });
});

describe('buried hurtboxes follow the sunk body (SmashWiki Buried: the buried pose "affects the hurtbox placement")', () => {
  it('moves every hurtbox (rectangle and capsule) down by the same depth as the drawing', () => {
    const depth = buriedSinkDepth(84);
    expect(depth).toBe(buriedSpriteSink({ floorY: 0, spriteY: 0, originY: 1, frameHeight: 10, scaleY: 1, bodyHeight: 84 }).offsetY);
    const sunk = sinkHurtboxes([
      { id: 'body', offsetX: 3, offsetY: -10, width: 40, height: 80 },
      { id: 'head', offsetX: 0, offsetY: 0, width: 0, height: 0, capsule: { start: { x: 5, y: -40 }, end: { x: 6, y: -30 }, radius: 9 } },
    ], depth);
    expect(sunk[0]).toEqual({ id: 'body', offsetX: 3, offsetY: 32, width: 40, height: 80 });
    expect(sunk[1]!.capsule).toEqual({ start: { x: 5, y: 2 }, end: { x: 6, y: 12 }, radius: 9 });
    expect(sunk[1]!.offsetY).toBe(42);
  });
});

describe('Ultimate buried effects (SmashWiki Buried, Appearance)', () => {
  const at = (age: number, extra: Partial<Parameters<typeof buriedEffects>[0]> = {}) =>
    buriedEffects({ initialFrames: 100, age, mashReduction: 0, framesSinceMash: null, ...extra });
  it('no splash before 30% of the initial duration, small splashes from 30%, yellow flash + large splashes from 60%', () => {
    expect(at(29)).toMatchObject({ splash: 'none', flashing: false });
    expect(at(30)).toMatchObject({ splash: 'small', flashing: false });
    expect(at(59).splash).toBe('small');
    expect(at(60)).toMatchObject({ splash: 'large', flashing: true });
    // mash-shortened time counts toward the share (how close the fighter is to escaping)
    expect(at(14, { mashReduction: 16 }).splash).toBe('small');
  });
  it('the flash blinks on and off while past 60%', () => {
    const lit = Array.from({ length: 16 }, (_, i) => at(60 + i).flash);
    expect(lit.some(Boolean)).toBe(true);
    expect(lit.some(v => !v)).toBe(true);
  });
  it('shakes only for a few steps after an accepted mash input', () => {
    expect(at(10).shakeX).toBe(0);
    expect(at(10, { framesSinceMash: 0 }).shakeX).not.toBe(0);
    expect(at(10, { framesSinceMash: 0 }).shakeX).toBe(-at(10, { framesSinceMash: 1 }).shakeX);
    expect(at(10, { framesSinceMash: BURIED_MASH_SHAKE_FRAMES }).shakeX).toBe(0);
  });
  it('splash particles: none, a few small, more and larger', () => {
    expect(buriedDirtSplashes('none', 10, 60)).toEqual([]);
    const small = buriedDirtSplashes('small', 10, 60), large = buriedDirtSplashes('large', 10, 60);
    expect(small.length).toBeGreaterThan(0);
    expect(large.length).toBeGreaterThan(small.length);
    expect(Math.min(...large.map(p => p.radius))).toBeGreaterThan(Math.max(...small.map(p => p.radius)));
    for (const p of [...small, ...large]) expect(p.dy).toBeLessThanOrEqual(0);
  });
});
