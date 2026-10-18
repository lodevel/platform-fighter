import { describe, expect, it } from 'vitest';
import { SAMPLE } from '../testing/samplePackage';
import type { Schedule, Window } from '../package/types';
import { evaluate, windowAt } from './evaluate';

const schedule = (after: Schedule<Window>['after']): Schedule<Window & { id: string }> =>
  ({ after, windows: [{ start: 0, end: 3, id: 'a' }, { start: 3, end: 4, id: 'b' }, { start: 4, end: 10, id: 'c' }] });
const ids = (s: Schedule<Window & { id: string }>, ticks: number[]) => ticks.map(t => windowAt(s, t)?.id ?? null);

describe('windowAt', () => {
  it('finds the window covering each tick and floors fractions', () => {
    expect(ids(schedule('hold'), [0, 2, 2.9, 3, 3.5, 4, 9])).toEqual(['a', 'a', 'a', 'b', 'b', 'c', 'c']);
  });
  it('applies the after rule past the last window', () => {
    expect(ids(schedule('loop'), [10, 13, 14, 23])).toEqual(['a', 'b', 'c', 'b']);
    expect(ids(schedule('hold'), [10, 500])).toEqual(['c', 'c']);
    expect(ids(schedule('stop'), [9, 10, 500])).toEqual(['c', null, null]);
  });
  it('treats negative ticks as the start', () => expect(ids(schedule('hold'), [-4])).toEqual(['a']));
});

describe('evaluate', () => {
  it('returns the drawing, its source sample and the sockets', () => {
    expect(evaluate(SAMPLE, { action: 'idle', tick: 6, facing: 1 })).toEqual({
      drawing: 'idle/1', sample: 6, bodyCentreFromRootY: -20,
      sockets: { item: { space: 'body-centre', x: 10, y: -4, angle: 90, length: 1 } },
    });
  });
  it('mirrors sockets when facing left', () => {
    expect(evaluate(SAMPLE, { action: 'idle', tick: 13, facing: -1 })).toMatchObject({
      drawing: 'idle/0', sockets: { item: { x: -10, y: -4, angle: -90 } } });
  });
  it('rejects unknown actions', () => expect(() => evaluate(SAMPLE, { action: 'run', tick: 0, facing: 1 })).toThrow('sample: unknown action run'));
});
