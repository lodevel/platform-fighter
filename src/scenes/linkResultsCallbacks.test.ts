import { describe, expect, it } from 'vitest';
import { advanceLinkResultCallbacks } from './linkResultsCallbacks';
describe('captured result callback ownership, prepared only', () => {
  it('emits Lose stow once at genuine result entry without repeating it each loop or render', () => {
    const input = { winner: false, variant: 1 as const, elapsedFrame: 0 };
    const entry = advanceLinkResultCallbacks(null, input);
    expect(entry.events.map(e => e.names)).toEqual([['sword', 'sword_back'], ['shield', 'shield_back']]);
    expect(advanceLinkResultCallbacks(entry.state, input).events).toEqual([]);
    expect(advanceLinkResultCallbacks(entry.state, { ...input, elapsedFrame: 103 }).events).toEqual([]);
  });
  it('catches genuine crossed Win1 source callbacks and sound events once', () => {
    const input = { winner: true, variant: 1 as const, elapsedFrame: 19 };
    const before = advanceLinkResultCallbacks(null, input);
    expect(before.events).toEqual([]);
    const next = advanceLinkResultCallbacks(before.state, { ...input, elapsedFrame: 30 });
    expect(next.events.some(e => e.command === 'macros::AFTER_IMAGE4_ON_arg29' && e.nativeFrame === 20)).toBe(true);
    expect(next.events.some(e => e.command === 'macros::AFTER_IMAGE_OFF' && e.nativeFrame === 30)).toBe(true);
    expect(next.events.some(e => e.names.includes('vc_link_win01'))).toBe(true);
    expect(advanceLinkResultCallbacks(next.state, { ...input, elapsedFrame: 30 }).events).toEqual([]);
  });
  it('rejects clock rewind or a changed outcome instead of replaying old callbacks', () => {
    const next = advanceLinkResultCallbacks(null, { winner: true, variant: 3, elapsedFrame: 39 });
    expect(() => advanceLinkResultCallbacks(next.state, { winner: true, variant: 3, elapsedFrame: 38 })).toThrow();
    expect(() => advanceLinkResultCallbacks(next.state, { winner: true, variant: 2, elapsedFrame: 40 })).toThrow();
    expect(() => advanceLinkResultCallbacks(next.state, { winner: false, variant: 3, elapsedFrame: 40 })).toThrow();
  });
});
