import { describe, expect, it } from 'vitest';
import {
  beginFinalCapturedVictimPresentation, beginFinalImpactVictimPresentation,
  confirmFinalVictimLinkingHit, parseFinalVictimPresentationState,
  selectFinalVictimPresentation, stepFinalCapturedVictimPresentation,
  stepFinalImpactVictimPresentation,
} from './finalVictimPresentation';

const recipient = {
  runId: 4, ownerPlayerIndex: 0, ownerGeneration: 2,
  victimPlayerIndex: 1, victimGeneration: 7, victimFighter: 'link',
} as const;
const dk = () => beginFinalCapturedVictimPresentation({
  ...recipient, frame: 100, facing: -1, ownerFighter: 'donkeykong', acceptedCapture: true, phaseAge: 0, ownerPhase: 'start', ownerPhaseRevision: 0,
})!;

describe('selected authored Final recipient presentation', () => {
  it('requires genuine capture and retains each actual recipient generation and entry facing', () => {
    expect(beginFinalCapturedVictimPresentation({ ...recipient, frame: 100, facing: 1,
      ownerFighter: 'pikachu', acceptedCapture: false, phaseAge: 0, ownerPhase: 'hit', ownerPhaseRevision: 0 })).toBeNull();
    const state = dk();
    expect(selectFinalVictimPresentation(state)).toMatchObject({
      targetFighter: 'link', profileKey: 'final_victim_jungle_entry', facing: -1,
      nativeSample: null, sampleBasis: 'authored-final-victim-recipe-index',
    });
    expect(stepFinalCapturedVictimPresentation(state, { ...recipient, victimGeneration: 8,
      frame: 101, ownerClockAdvances: true, actualOwnerTransition: false,
      phase: 'jungle-entry', phaseAge: 1, ownerPhase: 'start', ownerPhaseRevision: 0, releasedBeforeFinisher: false, interrupted: false })).toBeNull();
  });

  it('toggles DK reactions only for distinct accepted pulse receipts for this recipient', () => {
    const state = stepFinalCapturedVictimPresentation(dk(), { ...recipient, frame: 101,
      ownerClockAdvances: true, actualOwnerTransition: true, phase: 'jungle-barrage', ownerPhase: 'success', ownerPhaseRevision: 1,
      phaseAge: 6, releasedBeforeFinisher: false, interrupted: false })!;
    const hit = { ...recipient, frame: 101, acceptedHit: true, receiptId: 'run4:victim1:pulse0', packetRole: 'dk-early' } as const;
    const first = confirmFinalVictimLinkingHit(state, hit);
    expect(selectFinalVictimPresentation(first).profileKey).toBe('final_victim_jungle_stagger_b');
    expect(confirmFinalVictimLinkingHit(first, hit)).toBe(first);
    expect(confirmFinalVictimLinkingHit(first, { ...hit, acceptedHit: false, receiptId: 'rejected' })).toBe(first);
    expect(confirmFinalVictimLinkingHit(first, { ...hit, victimPlayerIndex: 2, receiptId: 'other-victim' })).toBe(first);
    expect(confirmFinalVictimLinkingHit(first, { ...hit, frame: 100, receiptId: 'old-frame' })).toBe(first);
    const second = confirmFinalVictimLinkingHit(first, { ...hit, receiptId: 'run4:victim1:pulse1', packetRole: 'dk-late' });
    expect(selectFinalVictimPresentation(second).profileKey).toBe('final_victim_jungle_stagger_a');
  });

  it('borrows actual owner clock, preserves fractional age, and clears before the finisher', () => {
    const state = dk();
    const input = { ...recipient, frame: 101, ownerClockAdvances: true,
      actualOwnerTransition: false, phase: 'jungle-entry', phaseAge: 0.75, ownerPhase: 'start', ownerPhaseRevision: 0,
      releasedBeforeFinisher: false, interrupted: false } as const;
    const next = stepFinalCapturedVictimPresentation(state, input)!;
    expect(selectFinalVictimPresentation(next).authoredAge).toBe(0.75);
    expect(stepFinalCapturedVictimPresentation(next, { ...input, ownerClockAdvances: false })).toEqual(next);
    expect(() => stepFinalCapturedVictimPresentation(next, { ...input, phaseAge: 1 })).toThrow();
    expect(() => stepFinalCapturedVictimPresentation(next, { ...input, frame: 102,
      ownerClockAdvances: false, phaseAge: 1 })).toThrow();
    expect(() => stepFinalCapturedVictimPresentation(next, { ...input, frame: 102,
      phase: 'jungle-uppercut-pre' })).toThrow();
    expect(stepFinalCapturedVictimPresentation(next, { ...input, releasedBeforeFinisher: true })).toBeNull();
  });

  it('keeps Pika caught/vortex/burst phases separate from its owner FinalHit motion', () => {
    const state = beginFinalCapturedVictimPresentation({ ...recipient, frame: 100,
      facing: 1, ownerFighter: 'pikachu', acceptedCapture: true, phaseAge: 0, ownerPhase: 'hit', ownerPhaseRevision: 0 })!;
    expect(selectFinalVictimPresentation(state).profileKey).toBe('final_victim_volt_caught');
    const vortex = stepFinalCapturedVictimPresentation(state, { ...recipient, frame: 101,
      ownerClockAdvances: true, actualOwnerTransition: true, phase: 'volt-vortex', ownerPhase: 'attack', ownerPhaseRevision: 1,
      phaseAge: 3, releasedBeforeFinisher: false, interrupted: false })!;
    const pulse = confirmFinalVictimLinkingHit(vortex, { ...recipient, frame: 101,
      acceptedHit: true, receiptId: 'actual-pika-loop', packetRole: 'pika-loop' });
    expect(selectFinalVictimPresentation(pulse).profileKey).toBe('final_victim_volt_vortex');
    expect(pulse.jungleReactionKey).toBe(0);
    expect(() => confirmFinalVictimLinkingHit(pulse, { ...recipient, frame: 101,
      acceptedHit: true, receiptId: 'wrong-owner', packetRole: 'dk-early' })).toThrow();
  });

  it('shows Ancient blast only during genuine victim stop and yields immediately to pending launch', () => {
    const input = { ...recipient, frame: 100, facing: -1, acceptedHit: true,
      genuineVictimHitstop: true, packet: 'ancient-terrain-blast', acceptedHitReceipt: 'actual-terrain20' } as const;
    expect(beginFinalImpactVictimPresentation({ ...input, acceptedHit: false })).toBeNull();
    expect(beginFinalImpactVictimPresentation({ ...input, genuineVictimHitstop: false })).toBeNull();
    const state = beginFinalImpactVictimPresentation(input)!;
    const step = { frame: 101, victimGeneration: 7, genuineVictimHitstop: true,
      ownStopPresentationAdvances: true, globallyPaused: false, interrupted: false } as const;
    const next = stepFinalImpactVictimPresentation(state, step)!;
    expect(selectFinalVictimPresentation(next).authoredAge).toBe(1);
    expect(stepFinalImpactVictimPresentation(next, step)).toEqual(next);
    expect(stepFinalImpactVictimPresentation(next, { ...step, frame: 102, globallyPaused: true })?.stopPresentationAge).toBe(1);
    expect(stepFinalImpactVictimPresentation(next, { ...step, frame: 102, genuineVictimHitstop: false })).toBeNull();
    expect(stepFinalImpactVictimPresentation(next, { ...step, victimGeneration: 8 })).toBeNull();
  });

  it('strict restore rejects forged pulse history, extra state, fake native samples, and crossed owner phases', () => {
    const state = dk();
    expect(parseFinalVictimPresentationState(JSON.parse(JSON.stringify(state)))).toEqual(state);
    for (const bad of [{ ...state, nativeSample: 0 }, { ...state, phase: 'volt-vortex' },
      { ...state, lastFrame: 99 }, { ...state, phaseAge: Infinity },
      { ...state, jungleReactionKey: 1 }, { ...state, acceptedLinkingHitReceipts: ['a', 'a'] }]) {
      expect(() => parseFinalVictimPresentationState(bad)).toThrow();
    }
  });

  it('admits DK at its real nonzero Start age without advancing a stopped or duplicate owner clock', () => {
    const state = beginFinalCapturedVictimPresentation({ ...recipient, frame: 100, facing: -1,
      ownerFighter: 'donkeykong', acceptedCapture: true, phaseAge: 28, ownerPhase: 'start', ownerPhaseRevision: 0 })!;
    const step = { ...recipient, frame: 100, ownerClockAdvances: false, actualOwnerTransition: false,
      phase: 'jungle-entry', phaseAge: 28, ownerPhase: 'start', ownerPhaseRevision: 0, releasedBeforeFinisher: false, interrupted: false } as const;
    expect(selectFinalVictimPresentation(state).authoredAge).toBe(28);
    expect(stepFinalCapturedVictimPresentation(state, step)).toEqual(state);
    expect(stepFinalCapturedVictimPresentation(state, { ...step, frame: 101 })).toEqual({ ...state, lastFrame: 101 });
    const attack = stepFinalCapturedVictimPresentation(state, { ...step, frame: 101,
      actualOwnerTransition: true, phase: 'jungle-barrage', ownerPhase: 'success', ownerPhaseRevision: 1, phaseAge: 0 })!;
    expect(selectFinalVictimPresentation(attack)).toMatchObject({ profileKey: 'final_victim_jungle_stagger_a', authoredAge: 0 });
  });

  it('permits actual Pika status-clock resets within vortex without allowing an arbitrary renderer age rewind', () => {
    const state = beginFinalCapturedVictimPresentation({ ...recipient, frame: 100, facing: 1,
      ownerFighter: 'pikachu', acceptedCapture: true, phaseAge: 17,
      ownerPhase: 'attack', ownerPhaseRevision: 1 })!;
    const input = { ...recipient, frame: 101, ownerClockAdvances: false, actualOwnerTransition: true,
      phase: 'volt-vortex', phaseAge: 0, ownerPhase: 'attack2', ownerPhaseRevision: 2,
      releasedBeforeFinisher: false, interrupted: false } as const;
    const attack2 = stepFinalCapturedVictimPresentation(state, input)!;
    expect(selectFinalVictimPresentation(attack2)).toMatchObject({ profileKey: 'final_victim_volt_vortex', authoredAge: 0 });
    expect(() => stepFinalCapturedVictimPresentation(state, { ...input, actualOwnerTransition: false })).toThrow();
    expect(() => stepFinalCapturedVictimPresentation(state, { ...input, ownerPhaseRevision: 1 })).toThrow();
    expect(() => stepFinalCapturedVictimPresentation(state, { ...input, ownerPhase: 'attack', ownerPhaseRevision: 1 })).toThrow();
    const returned = stepFinalCapturedVictimPresentation(attack2, { ...input, frame: 102,
      ownerPhase: 'return', ownerPhaseRevision: 3 })!;
    expect(returned.ownerPhase).toBe('return');
    expect(selectFinalVictimPresentation(returned).profileKey).toBe('final_victim_volt_vortex');
    expect(parseFinalVictimPresentationState(JSON.parse(JSON.stringify(returned)))).toEqual(returned);
  });
});
