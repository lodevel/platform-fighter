import { describe, expect, it } from 'vitest';
import { createDodgeState, isDodgeActing, resolveDodgeTuning, tickDodge } from './dodgeState';
import { LINK_MOVEMENT_PROFILE } from './fighterMovementProfiles';

const tuning = resolveDodgeTuning(LINK_MOVEMENT_PROFILE.dodge);
const input = { held: false, justPressed: false, moveX: 0, moveY: 0,
  grounded: false, facing: 1 as const };

// Expected frame counts come from current UFD's measured Link table,
// not the authored tuning. Frame 1 in the source is elapsed index 0 here.
describe('Link reference fresh air-dodge timing', () => {
  it.each([
    { label: 'neutral', x: 0, y: 0, total: 49, end: 29 },
    { label: 'right', x: 1, y: 0, total: 82, end: 20 },
    { label: 'left', x: -1, y: 0, total: 82, end: 20 },
    { label: 'up', x: 0, y: -1, total: 108, end: 20 },
    { label: 'down', x: 0, y: 1, total: 69, end: 20 },
    { label: 'up-right', x: 1, y: -1, total: 95, end: 20 },
    { label: 'down-left', x: -1, y: 1, total: 74, end: 20 },
  ])('$label has the exact vulnerable startup, i-frame window and release', ({ x, y, total, end }) => {
    let state = tickDodge(createDodgeState(), { ...input, held: true, justPressed: true,
      moveX: x, moveY: y }, tuning);
    for (let elapsed = 0; elapsed < total; elapsed++) {
      expect(isDodgeActing(state), `locked elapsed ${elapsed}`).toBe(true);
      expect(state.active?.framesElapsed).toBe(elapsed);
      expect(state.iframesRemaining > 0, `intangible elapsed ${elapsed}`)
        .toBe(elapsed >= 2 && elapsed <= end);
      // Changing the live stick cannot shorten a captured upward dodge.
      state = tickDodge(state, { ...input, moveX: -1, moveY: 1 }, tuning);
    }
    expect(state.name).toBe('idle');
    expect(state.iframesRemaining).toBe(0);
  });

  it('keeps generic legacy air timing when no directional profile is authored', () => {
    const defaults = resolveDodgeTuning();
    let state = tickDodge(createDodgeState(), { ...input, held: true, justPressed: true,
      moveX: 1, moveY: -1 }, defaults);
    expect(state.iframesRemaining).toBe(20);
    expect(state.active?.directional).toBeUndefined();
    for (let elapsed = 1; elapsed < 36; elapsed++) {
      state = tickDodge(state, input, defaults);
      expect(isDodgeActing(state)).toBe(true);
    }
    state = tickDodge(state, input, defaults);
    expect(state.name).toBe('cooldown');
  });

  it.each([
    { facing: 1 as const, x: 0, total: 26, start: 2, end: 16, backward: false },
    { facing: 1 as const, x: 1, total: 30, start: 3, end: 14, backward: false },
    { facing: 1 as const, x: -1, total: 35, start: 4, end: 15, backward: true },
    { facing: -1 as const, x: -1, total: 30, start: 3, end: 14, backward: false },
    { facing: -1 as const, x: 1, total: 35, start: 4, end: 15, backward: true },
  ])('ground press $x with facing $facing uses its captured source variant', row => {
    let state = tickDodge(createDodgeState(), { ...input, grounded: true,
      held: true, justPressed: true, facing: row.facing, moveX: row.x }, tuning);
    for (let elapsed = 0; elapsed < row.total; elapsed++) {
      expect(isDodgeActing(state)).toBe(true);
      expect(state.active?.backward === true).toBe(row.backward);
      expect(state.iframesRemaining > 0).toBe(elapsed >= row.start && elapsed <= row.end);
      state = tickDodge(state, { ...input, grounded: true, facing: row.facing, moveX: -row.x }, tuning);
    }
    expect(state.name).toBe('idle');
  });

  it('never grants intangible steps outside an edited active window', () => {
    const edited = resolveDodgeTuning({ air: { activeFrames: 5,
      iframeStartFrame: 3, iframeFrames: 20 } });
    expect(edited.air.iframeFrames).toBe(2);
    let state = tickDodge(createDodgeState(), { ...input, held: true, justPressed: true }, edited);
    const protectedSteps: number[] = [];
    for (let elapsed = 0; elapsed < 8; elapsed++) {
      if (state.iframesRemaining > 0) protectedSteps.push(elapsed);
      state = tickDodge(state, input, edited);
    }
    expect(protectedSteps).toEqual([3, 4]);
  });
});
