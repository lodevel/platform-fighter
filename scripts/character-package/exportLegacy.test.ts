import { describe, expect, it } from 'vitest';
import { canonicalJson, withRevision } from '../../character/package/canonical';
import { compress, exportFighter } from './exportLegacy';
import { EXPORTED_FIGHTERS } from './legacyClips';

describe('legacy character export', () => {
  it.each(EXPORTED_FIGHTERS)('%s matches the game at every tick and validates', async fighter => {
    const { pkg, report } = exportFighter(fighter);
    expect(report.problems).toEqual([]);
    expect(report.validation).toEqual([]);
    expect(report.verifiedTicks).toBeGreaterThan(400_000);
    // Only effect strips and DK's three clips without timing data stay out.
    expect(report.skipped.filter(s => !s.clip.startsWith('fx__')).map(s => s.clip))
      .toEqual(fighter === 'donkeykong' ? ['attack', 'up_special', 'review_legacy_grab'] : []);
    const text = canonicalJson(await withRevision(pkg));
    expect(canonicalJson(JSON.parse(text))).toBe(text);
    expect(canonicalJson(await withRevision(exportFighter(fighter).pkg))).toBe(text);
  }, 60_000);
});

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
