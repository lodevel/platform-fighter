import { describe, expect, it } from 'vitest';
import { beginDonkeyKongPunch, tickDonkeyKongPunch, type DonkeyKongPunchState,
  type DonkeyKongPunchObservation } from './donkeykongPunchControls';

const neutral: DonkeyKongPunchObservation = { specialPressed: false, shieldPressed: false,
  shieldHeld: false, dodgePressed: false, jumpPressed: false, rollDirection: 0,
  grounded: true, canAirJump: true, canAirDodge: true };
function loop(bank = 0): DonkeyKongPunchState {
  let state = beginDonkeyKongPunch(bank).state!;
  for (let tick = 0; tick < 7; tick++) state = tickDonkeyKongPunch(state, neutral).state!;
  expect(state.phase).toBe('loop');
  return state;
}
function finish(state: DonkeyKongPunchState, input = neutral) {
  for (let tick = 0; tick < 8; tick++) {
    const next = tickDonkeyKongPunch(state, input);
    if (next.command) return { ...next, additionalTicks: tick + 1 };
    state = next.state!;
  }
  throw new Error('Expected a finite cancel/end');
}

describe('source-style DK Giant Punch press controls', () => {
  it('preserves seven entry steps and charges automatically after the initial button is released', () => {
    // begin occupies gameplay entry age0 (first visible entry sample).
    // Six following ticks retain ages1..6; the seventh tick enters loopage0.
    let state = beginDonkeyKongPunch().state!;
    for (let step = 0; step < 6; step++) {
      state = tickDonkeyKongPunch(state, { ...neutral, specialPressed: step === 1 }).state!;
      expect(state.phase).toBe('start'); expect(state.phaseAge).toBe(step + 1); expect(state.chargeFrames).toBe(0);
    }
    state = tickDonkeyKongPunch(state, neutral).state!;
    expect(state.phase).toBe('loop');
    for (let step = 0; step < 10; step++) state = tickDonkeyKongPunch(state, neutral).state!;
    expect(state.chargeFrames).toBe(10);
  });
  it.each([true, false])('second fresh special fires partial in grounded=%s without holding or release firing', grounded => {
    const state = tickDonkeyKongPunch(loop(30), { ...neutral, grounded }).state!;
    expect(tickDonkeyKongPunch(state, { ...neutral, grounded, specialPressed: true }))
      .toEqual({ state: null, command: { kind: 'fire', chargeFrames: 31, full: false } });
  });
  it('full winding auto-banks through its finite end; next actionable press directly fires Max', () => {
    const end = tickDonkeyKongPunch(loop(109), neutral);
    expect(end.state).toMatchObject({ phase: 'end', chargeFrames: 110, phaseAge: 0 });
    expect(end.command).toBeNull();
    const bank = finish(end.state!);
    expect(bank).toMatchObject({ state: null, command: { kind: 'bank', chargeFrames: 110, exit: 'idle' }, additionalTicks: 4 });
    expect(beginDonkeyKongPunch(110)).toEqual({ state: null, command: { kind: 'fire', chargeFrames: 110, full: true } });
  });
  it('partial shield bank has four cancel steps and resumes windup on the next press', () => {
    const cancelled = tickDonkeyKongPunch(loop(30), { ...neutral, shieldPressed: true, shieldHeld: true });
    const bank = finish(cancelled.state!, { ...neutral, shieldHeld: true });
    expect(bank.additionalTicks).toBe(3);
    expect(bank.command).toEqual({ kind: 'bank', chargeFrames: 30, exit: 'shield' });
    expect(beginDonkeyKongPunch(30)).toMatchObject({ state: { phase: 'start', chargeFrames: 30 }, command: null });
    expect(finish(cancelled.state!).command).toEqual({ kind: 'bank', chargeFrames: 30, exit: 'idle' });
  });
  it.each([-1, 1] as const)('direction-only grounded roll cancellation preserves charge, relative direction%s', rollDirection => {
    const cancelled = tickDonkeyKongPunch(loop(20), { ...neutral, rollDirection });
    expect(finish(cancelled.state!).command)
      .toEqual({ kind: 'bank', chargeFrames: 20, exit: rollDirection > 0 ? 'roll-forward' : 'roll-back' });
  });
  it('ground jump cancels in four steps; air jump uses five and requires an actual remaining resource', () => {
    const ground = tickDonkeyKongPunch(loop(20), { ...neutral, jumpPressed: true });
    expect(finish(ground.state!)).toMatchObject({ command: { exit: 'ground-jump' }, additionalTicks: 3 });
    const air = { ...neutral, grounded: false, jumpPressed: true };
    const cancelled = tickDonkeyKongPunch(loop(20), air);
    expect(finish(cancelled.state!, { ...air, jumpPressed: false }))
      .toMatchObject({ command: { exit: 'air-jump' }, additionalTicks: 4 });
    const exhausted = tickDonkeyKongPunch(loop(20), { ...air, canAirJump: false });
    expect(exhausted.state).toMatchObject({ phase: 'loop', chargeFrames: 21 });
    expect(exhausted.command).toBeNull();
  });
  it('air guard buffers a finite air dodge, with midcancel landing releasing to the landing consumer', () => {
    const air = { ...neutral, grounded: false, shieldPressed: true };
    const cancelled = tickDonkeyKongPunch(loop(20), air);
    expect(finish(cancelled.state!, { ...neutral, grounded: false }))
      .toMatchObject({ command: { exit: 'air-dodge' }, additionalTicks: 3 });
    expect(tickDonkeyKongPunch(cancelled.state!, neutral))
      .toEqual({ state: null, command: { kind: 'bank', chargeFrames: 20, exit: 'landing' } });
    expect(tickDonkeyKongPunch(loop(20), { ...air, canAirDodge: false }).state!.phase).toBe('loop');
  });
  it('freeze preserves phase/bank; simultaneous fresh fire takes declared adapter priority', () => {
    const state = loop(20);
    expect(tickDonkeyKongPunch(state, { ...neutral, frozen: true, specialPressed: true })).toEqual({ state, command: null });
    expect(tickDonkeyKongPunch(state, { ...neutral, specialPressed: true, jumpPressed: true, shieldPressed: true }))
      .toMatchObject({ command: { kind: 'fire', chargeFrames: 20 } });
  });
  it('rejects malformed bank and clock inputs before entering the game state', () => {
    expect(() => beginDonkeyKongPunch(-1)).toThrow();
    expect(() => beginDonkeyKongPunch(NaN)).toThrow();
    expect(() => beginDonkeyKongPunch(0, { entryFrames: 0, maxChargeFrames: 111, cancelFrames: 4,
      airJumpCancelFrames: 5, fullBankEndFrames: 4 })).toThrow();
  });
});
