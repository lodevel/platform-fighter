/** Independent lease/clock fixtures prepared for final-stage execution only.
 * Pure receipts do not qualify the actual Scene intro, support or KO producer. */
import { describe, expect, it } from 'vitest';
import { beginLinkContextualPresentation, beginLinkEntryPresentation, stepLinkEntryPresentation,
  selectLinkEntryPresentation, linkEntryEquipment, linkEntrySourceTransDisplacement,
  observeLinkContextualPresentation, selectLinkContextualPresentation,
  beginLinkScreenKoPresentation, stepLinkScreenKoPresentation, selectLinkScreenKoPresentation,
  parseLinkEntryPresentationState, parseLinkScreenKoPresentationState, parseLinkContextualPresentationState,
  type LinkContextualObservation, type LinkEntryPresentationState } from './linkContextualPresentation';
const support = { bodyId: 7, left: -100, right: 100, floorY: 0, actorRootX: 0,
  nearEdge: false, inwardSupport: false };
function state() { return beginLinkContextualPresentation({ frame: 0, generation: 2, facing: 1,
  side: 'right', reason: 'respawn' }); }
function observation(frame: number, changes: Partial<LinkContextualObservation> = {}): LinkContextualObservation {
  return { frame, generation: 2, facing: 1, clockAdvances: true, interrupted: false, grounded: true,
    uncommitted: true, gameplayStarted: true, actualJump: false, actualDropThrough: false, support, ...changes };
}
describe('actual contextual receipt leases, final-stage preparation', () => {
  it('retains every raw0..120 sample in a separate intro clock while gameplay stays zero', () => {
    for (const facing of [1, -1] as const) {
      const side = facing === 1 ? 'right' : 'left';
      let entry: LinkEntryPresentationState | null = beginLinkEntryPresentation({ frame: 0, generation: 2,
        facing, side, reason: 'match-start' });
      let gameplayFrame = 0;
      for (let introFrame = 0; introFrame <= 120; introFrame++) {
        entry = stepLinkEntryPresentation(entry!, { frame: introFrame, generation: 2, clockAdvances: true,
          interrupted: false, gameplayStarted: false });
        expect(selectLinkEntryPresentation(entry!)).toEqual({ motion: side === 'right' ? 'entry_r' : 'entry_l',
          rawAge: introFrame, facing, terminal: true });
        expect(linkEntrySourceTransDisplacement(introFrame, side)).toEqual({ x: 0, y: 0 });
        expect(gameplayFrame).toBe(0);
      }
      entry = stepLinkEntryPresentation(entry!, { frame: gameplayFrame, generation: 2, clockAdvances: false,
        interrupted: false, gameplayStarted: true });
      expect(entry).toBeNull();
      gameplayFrame++;
      expect(gameplayFrame).toBe(1);
    }
  });
  it('allows terminal120, clears121, and does not replay entry on respawn', () => {
    let entry = beginLinkEntryPresentation({ frame: 0, generation: 2, facing: 1, side: 'right', reason: 'match-start' })!;
    for (let frame = 1; frame <= 120; frame++) entry = stepLinkEntryPresentation(entry,
      { frame, generation: 2, clockAdvances: true, interrupted: false, gameplayStarted: false })!;
    expect(entry.rawAge).toBe(120);
    expect(stepLinkEntryPresentation(entry, { frame: 121, generation: 2, clockAdvances: true,
      interrupted: false, gameplayStarted: false })).toBeNull();
    expect(beginLinkEntryPresentation({ frame: 0, generation: 3, facing: 1, side: 'right', reason: 'respawn' })).toBeNull();
  });
  it('freezes paused and duplicate intro frames without catch-up or reverse-clock admission', () => {
    const entry = beginLinkEntryPresentation({ frame: 0, generation: 2, facing: 1, side: 'right', reason: 'match-start' })!;
    const paused = stepLinkEntryPresentation(entry, { frame: 1, generation: 2, clockAdvances: false,
      interrupted: false, gameplayStarted: false })!;
    expect(paused.rawAge).toBe(0);
    const duplicate = stepLinkEntryPresentation(paused, { frame: 1, generation: 2, clockAdvances: true,
      interrupted: false, gameplayStarted: false })!;
    expect(duplicate.rawAge).toBe(0);
    const resumed = stepLinkEntryPresentation(duplicate, { frame: 2, generation: 2, clockAdvances: true,
      interrupted: false, gameplayStarted: false })!;
    expect(resumed.rawAge).toBe(1);
    expect(() => stepLinkEntryPresentation(resumed, { frame: 1, generation: 2, clockAdvances: true,
      interrupted: false, gameplayStarted: false })).toThrow();
  });
  it('keeps source article removal and equipment callbacks distinct from body entry side', () => {
    const entry = beginLinkEntryPresentation({ frame: 0, generation: 2, facing: -1, side: 'left', reason: 'match-start' })!;
    expect(linkEntryEquipment({ ...entry, rawAge: 75 })).toMatchObject({ sword: 'back', shield: 'back', parasailMotion: 'entry_r' });
    expect(linkEntryEquipment({ ...entry, rawAge: 76 })).toMatchObject({ sword: 'back', shield: 'normal' });
    expect(linkEntryEquipment({ ...entry, rawAge: 77 })).toMatchObject({ sword: 'normal', shield: 'normal' });
    expect(linkEntryEquipment({ ...entry, rawAge: 99 }).parasailVisible).toBe(true);
    expect(linkEntryEquipment({ ...entry, rawAge: 100 }).parasailVisible).toBe(false);
  });
  it('requires actual supported root-inside/inward cues and ends the edge cue on a committed action', () => {
    const near = { ...support, actorRootX: 99, nearEdge: true, inwardSupport: true };
    const admitted = observeLinkContextualPresentation(state(), observation(0, { support: near }));
    expect(selectLinkContextualPresentation(admitted)?.motion).toBe('ottotto');
    let s = admitted;
    for (let frame = 1; frame <= 10; frame++) s = observeLinkContextualPresentation(s, observation(frame, { support: near }));
    expect(selectLinkContextualPresentation(s)).toMatchObject({ motion: 'ottotto_wait', rawAge: 0, terminal: false });
    expect(selectLinkContextualPresentation(observeLinkContextualPresentation(s, observation(11, { support: near, uncommitted: false })))).toBeNull();
    expect(selectLinkContextualPresentation(observeLinkContextualPresentation(state(), observation(0,
      { support: { ...near, actorRootX: 101 } })))).toBeNull();
    expect(selectLinkContextualPresentation(observeLinkContextualPresentation(state(), observation(0,
      { support: { ...near, inwardSupport: false } })))).toBeNull();
  });
  it('distinguishes actual supported walkoff/drop-through from a jump or fresh unsupported actor', () => {
    const supported = observeLinkContextualPresentation(state(), observation(0));
    const air = observation(1, { grounded: false, support: null });
    expect(selectLinkContextualPresentation(observeLinkContextualPresentation(supported, air))?.motion).toBe('miss_foot');
    expect(selectLinkContextualPresentation(observeLinkContextualPresentation(supported, { ...air, actualDropThrough: true }))?.motion).toBe('pass');
    expect(selectLinkContextualPresentation(observeLinkContextualPresentation(supported, { ...air, actualJump: true }))).toBeNull();
    expect(selectLinkContextualPresentation(observeLinkContextualPresentation(supported, { ...air, interrupted: true }))).toBeNull();
    expect(selectLinkContextualPresentation(observeLinkContextualPresentation(state(), air))).toBeNull();
  });
  it('does not manufacture support loss during pause or reuse a prior actor generation', () => {
    const supported = observeLinkContextualPresentation(state(), observation(0));
    const paused = observeLinkContextualPresentation(supported, observation(1, { clockAdvances: false, grounded: false, support: null }));
    expect(paused.previousSupported).toBe(true);
    expect(paused.support).toBeNull();
    expect(observeLinkContextualPresentation(paused, observation(1))).toBe(paused);
    const reset = observeLinkContextualPresentation(supported, observation(1, { generation: 3, grounded: false, support: null }));
    expect(reset.entry).toBeNull();
    expect(reset.support).toBeNull();
  });
  it('keeps an accepted detached topKO old lease through actor respawn, then clears after46 samples', () => {
    let ko = beginLinkScreenKoPresentation({ frame: 10, koFrame: 10, generation: 2, facing: -1, playerIndex: 0,
      position: { x: 0, y: -100 }, direction: 'top', acceptedStockLoss: true })!;
    const respawnActorGeneration = 3;
    expect(respawnActorGeneration).not.toBe(ko.generation);
    for (let frame = 11; frame <= 55; frame++) ko = stepLinkScreenKoPresentation(ko,
      { frame, generation: ko.generation, clockAdvances: true, interrupted: false })!;
    expect(selectLinkScreenKoPresentation(ko)).toMatchObject({ motion: 'camera_hit', rawAge: 45, facing: -1 });
    expect(stepLinkScreenKoPresentation(ko, { frame: 56, generation: ko.generation, clockAdvances: true, interrupted: false })).toBeNull();
    expect(beginLinkScreenKoPresentation({ frame: 10, koFrame: 10, generation: 2, facing: 1, playerIndex: 0,
      position: { x: 0, y: 100 }, direction: 'bottom', acceptedStockLoss: true })).toBeNull();
  });
  it('strictly parses valid leases and rejects impossible age, extra fields and mixed generations', () => {
    const s = state();
    expect(parseLinkContextualPresentationState(s)).toEqual(s);
    const entry = beginLinkEntryPresentation({ frame: 0, generation: 2, facing: 1, side: 'right', reason: 'match-start' })!;
    expect(parseLinkEntryPresentationState(entry)).toEqual(entry);
    expect(() => parseLinkEntryPresentationState({ ...entry, rawAge: 121, lastFrame: 121 })).toThrow();
    expect(() => parseLinkEntryPresentationState({ ...entry, rawAge: 1 })).toThrow();
    expect(() => parseLinkContextualPresentationState({ ...s, extra: true })).toThrow();
    expect(() => parseLinkContextualPresentationState({ ...s, entry: { ...entry, generation: 3 } })).toThrow();
    const ko = beginLinkScreenKoPresentation({ frame: 10, koFrame: 10, generation: 2, facing: 1, playerIndex: 0,
      position: { x: 0, y: -100 }, direction: 'top', acceptedStockLoss: true })!;
    expect(parseLinkScreenKoPresentationState(ko)).toEqual(ko);
    expect(() => parseLinkScreenKoPresentationState({ ...ko, koFrame: 11 })).toThrow();
    expect(() => parseLinkScreenKoPresentationState({ ...ko, acceptedKoPosition: { x: Infinity, y: 0 } })).toThrow();
  });
});
