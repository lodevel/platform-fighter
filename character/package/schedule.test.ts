import { describe, expect, it } from 'vitest';
import { compress } from './schedule';

describe('compress', () => {
  const v = (id: string) => ({ id });
  it('holds a final value, stops after trailing gaps and repeats loops', () => {
    expect(compress([v('a'), v('a'), v('b'), v('b'), v('b')], null)).toEqual({ after: 'hold',
      windows: [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 2, end: 3 }] });
    expect(compress([v('a'), v('b'), null, null], null)).toEqual({ after: 'stop',
      windows: [{ id: 'a', start: 0, end: 1 }, { id: 'b', start: 1, end: 2 }] });
    expect(compress([v('a'), v('b'), v('a'), v('b')], 2)).toEqual({ after: 'loop',
      windows: [{ id: 'a', start: 0, end: 1 }, { id: 'b', start: 1, end: 2 }] });
  });
  it('reports what windows cannot express', () => {
    expect(compress([v('a'), null, v('a')], null)).toBe('no drawing at tick 1 inside the action');
    expect(compress([null, null], null)).toBe('never shows a drawing');
  });
});
