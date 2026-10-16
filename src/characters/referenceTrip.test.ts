import { describe, expect, it } from 'vitest';
import { referenceTripProbability } from './referenceTrip';
import { MatchRng } from '../match/MatchRng';
import { parseCharacterDataFile, serializeCharacterDataSpec } from './characterSerializer';
import { buildPikachuVerticalTiltWithAuthoredHurtboxes } from './pikachuVerticalTiltHurtboxes';
import { PIKACHU_MOVEMENT_PROFILE } from './pikachuMovement';

const grounded = { grounded: true, alreadyTripped: false, verticalVelocity: 0, referenceKnockback: 30 };
describe('published Ultimate attack-trip conditions', () => {
  it('source trip/setoff fields survive canonical save/load and reject invalid probabilities or flags', () => {
    const move = buildPikachuVerticalTiltWithAuthoredHurtboxes('down-tilt');
    const input = { id: 'pikachu', displayName: 'Pikachu', role: 'fighter',
      body: { width: 40, height: 50, chamfer: 0 }, movement: PIKACHU_MOVEMENT_PROFILE, moves: { downLight: move } };
    const parsed = parseCharacterDataFile(input);
    const restored = parseCharacterDataFile(JSON.parse(JSON.stringify(serializeCharacterDataSpec(parsed))));
    expect(restored.moves?.downLight?.collisionHits?.[0]).toMatchObject({ tripChance: 0.3, setoff: 'on' });
    for (const fields of [{ tripChance: -1 }, { tripChance: 1.01 }, { setoff: 'guess' }]) {
      expect(() => parseCharacterDataFile({ ...input, moves: { downLight: { ...move, ...fields } } })).toThrow(/tripChance|setoff/);
    }
  });
  it('adds the7% base to source bonuses even below55KB', () => {
    expect(referenceTripProbability({ ...grounded, tripChance: 0.3 })).toBeCloseTo(0.37);
    expect(referenceTripProbability({ ...grounded, tripChance: 1 })).toBe(1);
  });
  it('requires strictly more than55KB for the unbonused7% chance', () => {
    expect(referenceTripProbability({ ...grounded, tripChance: 0, referenceKnockback: 55 })).toBe(0);
    expect(referenceTripProbability({ ...grounded, tripChance: 0, referenceKnockback: 55.01 })).toBe(0.07);
    expect(referenceTripProbability({ ...grounded, tripChance: undefined, referenceKnockback: 56 })).toBe(0);
  });
  it('rejects airborne, already sitting and upward-lifting recipients', () => {
    expect(referenceTripProbability({ ...grounded, tripChance: 0.3, grounded: false })).toBe(0);
    expect(referenceTripProbability({ ...grounded, tripChance: 0.3, alreadyTripped: true })).toBe(0);
    expect(referenceTripProbability({ ...grounded, tripChance: 0.3, verticalVelocity: -0.01 })).toBe(0);
    expect(referenceTripProbability({ ...grounded, tripChance: -1 })).toBe(0);
  });
  it('named match stream reproduces trip decisions and restores independently of visuals', () => {
    const a = new MatchRng(112), b = new MatchRng(112);
    for (let n = 0; n < 20; n++) {
      a.stream('visual').next();
      expect(a.stream('combat-trip').next() < 0.37).toBe(b.stream('combat-trip').next() < 0.37);
    }
    const snapshot = a.snapshotState();
    const decisions = Array.from({ length: 20 }, () => a.stream('combat-trip').next() < 0.37);
    a.restoreState(snapshot);
    expect(Array.from({ length: 20 }, () => a.stream('combat-trip').next() < 0.37)).toEqual(decisions);
  });
});
