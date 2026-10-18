import { describe, expect, it } from 'vitest';
import { SAMPLE } from '../testing/samplePackage';
import { holdMap, retimeAction } from './retime';
import type { Action } from '../package/types';

const windows = (...spans: [string, number][]) => {
  let start = 0;
  return spans.map(([drawing, ticks]) => ({ drawing, start, end: (start += ticks) }));
};

describe('holdMap', () => {
  const diff = (a: string, b: string) => Math.abs(Number(a) - Number(b)) / 10;
  it('drops the drawings closest to the drawing that replaces them, up to the limit', () => {
    const map = holdMap(windows(['0', 2], ['1', 2], ['5', 2], ['6', 2]), diff, 0.15, 8);
    expect(Array.from({ length: 8 }, (_, t) => map(t))).toEqual([0, 1, 1, 1, 4, 5, 5, 5]);
  });
  it('compares with what is actually shown after earlier drops', () => {
    // 1 replaces 0 (0.1); 2 would then be replaced by 0 (0.2 > limit), so it stays.
    const map = holdMap(windows(['0', 1], ['1', 1], ['2', 1]), diff, 0.15, 8);
    expect([0, 1, 2].map(map)).toEqual([0, 0, 2]);
  });
  it('keeps everything with a zero limit unless drawings are identical', () => {
    expect([0, 1, 2].map(holdMap(windows(['0', 1], ['1', 1], ['1', 1]), diff, 0, 8))).toEqual([0, 1, 1]);
  });
  it('never holds a drawing longer than the longer of maxHold and the longest window', () => {
    // A slow loop of near-identical drawings keeps every drawing: merging any two exceeds 6 ticks.
    expect([0, 6, 12].map(holdMap(windows(['0', 6], ['0.1', 6], ['0.2', 6]), diff, 1, 4))).toEqual([0, 6, 12]);
    // One-tick windows merge up to maxHold ticks, then a new drawing must be shown.
    const map = holdMap(windows(...Array.from({ length: 6 }, () => ['0', 1] as [string, number])), () => 0, 1, 3);
    expect(Array.from({ length: 6 }, (_, t) => map(t))).toEqual([0, 0, 0, 3, 3, 3]);
  });
});

describe('retimeAction', () => {
  it('moves drawings and sockets together and keeps the after rule', () => {
    const idle = SAMPLE.actions.idle!;
    const action: Action = { ...idle, sockets: { item: { space: 'body-centre', schedule: { after: 'loop',
      windows: [{ start: 0, end: 5, x: 1, y: 0 }, { start: 5, end: 12, x: 2, y: 0 }] } } } };
    const held = retimeAction(action, t => Math.min(t, 4));
    expect(held.drawings).toEqual({ after: 'loop', windows: [{ start: 0, end: 12, drawing: 'idle/0', sample: 1 }] });
    expect(held.sockets!.item!.schedule.windows).toEqual([{ start: 0, end: 12, x: 1, y: 0 }]);
    expect(retimeAction(action, t => t)).toEqual(action);
  });
});
