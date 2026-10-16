import { describe, expect, it } from 'vitest';
import { createBuriedState, receiveBuriedHit, tickBuriedState, ultimateBuryFrames,
  type BuriedState } from './buriedState';

const neutral = { moveX: 0, moveY: 0, jump: false };
describe('published Ultimate burial rules', () => {
  it('evaluates percent, weight100 knockback and rank without rounding the rank term first', () => {
    expect(ultimateBuryFrames(10, 50, 0)).toBe(135);
    expect(ultimateBuryFrames(10, 50, -1)).toBe(143);
    expect(ultimateBuryFrames(10, 50, -2)).toBe(147);
    expect(ultimateBuryFrames(10, 50, 1)).toBe(113);
    expect(ultimateBuryFrames(10, 50, 2)).toBe(108);
    expect(ultimateBuryFrames(10.5, 50.1)).toBe(136);
    expect(() => ultimateBuryFrames(-1, 50)).toThrow();
    expect(() => ultimateBuryFrames(10, Number.NaN)).toThrow();
  });
  it('ages normally and grants twelve vulnerable escape steps', () => {
    let state: BuriedState<unknown> | null = createBuriedState(2, neutral);
    state = tickBuriedState(state, { input: neutral, grounded: true }).state;
    expect(state!.phase).toBe('buried');
    const release = tickBuriedState(state!, { input: neutral, grounded: true });
    expect(release.releaseKind).toBe('escape-jump');
    state = release.state;
    expect(state!.escapeRemaining).toBe(12);
    for (let step = 0; step < 11; step++) state = tickBuriedState(state!, { input: neutral, grounded: false }).state;
    expect(state!.escapeRemaining).toBe(1);
    expect(tickBuriedState(state!, { input: neutral, grounded: false }).state).toBeNull();
  });
  it('mashes fresh stick/button edges with reviewed gating while held inputs do not repeat', () => {
    let state = createBuriedState(100, neutral);
    state = tickBuriedState(state, { input: { ...neutral, moveX: 1 }, grounded: true }).state!;
    expect(state.mash.reduction).toBe(8);
    state = tickBuriedState(state, { input: { ...neutral, moveX: 1 }, grounded: true }).state!;
    expect(state.mash.reduction).toBe(8);
    state = tickBuriedState(state, { input: { ...neutral, attack: true }, grounded: true }).state!;
    expect(state.mash.reduction).toBeCloseTo(22.4);
    state = tickBuriedState(state, { input: { ...neutral, special: true }, grounded: true }).state!;
    expect(state.mash.reduction).toBeCloseTo(22.4);
  });
  it('freeze preserves both status clock and pending mash edge', () => {
    const state = createBuriedState(100, neutral), input = { ...neutral, attack: true };
    expect(tickBuriedState(state, { input, grounded: true, frozen: true }).state).toBe(state);
    const resumed = tickBuriedState(state, { input, grounded: true }).state!;
    expect(resumed.age).toBe(1);
    expect(resumed.mash.reduction).toBe(14.4);
  });
  it('holds below90 knockback, applies the latest weak launch on escape, and releases at90', () => {
    const state = createBuriedState<{ id: string }>(1, neutral);
    const held = receiveBuriedHit(state, 89.999, { id: 'weak' });
    expect(held.held).toBe(true); expect(held.launch).toBeNull();
    const latest = receiveBuriedHit(held.state!, 30, { id: 'latest' });
    const released = tickBuriedState(latest.state!, { input: neutral, grounded: true });
    expect(released).toMatchObject({ state: null, releaseKind: 'stored-launch', launch: { id: 'latest' } });
    expect(receiveBuriedHit(state, 90, { id: 'strong' })).toEqual({ state: null, launch: { id: 'strong' }, held: false });
  });
  it('losing the supporting floor ends burial without inventing a new bury timer', () => {
    const state = createBuriedState(100, neutral);
    expect(tickBuriedState(state, { input: neutral, grounded: false }))
      .toEqual({ state: null, releaseKind: 'floor-lost', launch: null });
  });
});
