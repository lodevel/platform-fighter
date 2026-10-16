/** Prepared selected-context boundaries; actual Actor route checked at end. */
import { describe, expect, it } from 'vitest';
import { linkHeldCrouchSourceMotion as select } from './linkCommonBodyRoute';
describe('actual held nonheavy crouch source wait selection', () => {
  it('selects item wait only in real crouch wait and leaves start/end clocks and source roles intact', () => {
    const context = { crouching: true, heldItemClass: 'shooting', heavy: false, passiveGuard: false };
    expect(select('squat_wait', context)).toBe('squat_wait_item');
    expect(select('squat', context)).toBe('squat');
    expect(select('squat_rv', context)).toBe('squat_rv');
    expect(select('squat_wait', { ...context, crouching: false })).toBe('squat_wait');
    expect(select('squat_wait', { ...context, heldItemClass: null })).toBe('squat_wait');
  });
  it('preserves passive shield crouch, heavy carry and Hammer independent owners', () => {
    const context = { crouching: true, heldItemClass: 'throwing', heavy: false, passiveGuard: false };
    expect(select('squat_wait', { ...context, passiveGuard: true })).toBe('squat_wait');
    expect(select('squat_wait', { ...context, heavy: true })).toBe('squat_wait');
    expect(select('squat_wait', { ...context, heldItemClass: 'hammer' })).toBe('squat_wait');
  });
});
