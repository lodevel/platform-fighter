import { describe, expect, it } from 'vitest';

import { canDamage, type Actor } from './Actor';

const make = (
  id: string,
  ownerActorId: string | null = null,
  factionId: string | null = null,
): Pick<Actor, 'actorId' | 'ownerActorId' | 'factionId'> => ({
  actorId: id,
  ownerActorId,
  factionId,
});

describe('canDamage — friendly-fire predicate', () => {
  it('rejects self-hits (same actor)', () => {
    const a = make('1');
    expect(canDamage(a, a)).toBe(false);
  });

  it('allows damage between two unrelated free-for-all actors', () => {
    expect(canDamage(make('1'), make('2'))).toBe(true);
  });

  it("rejects 'creature owned by X hits X' (owner-only friendly fire)", () => {
    const summoner = make('1');
    const summoned = make('99', '1');
    expect(canDamage(summoned, summoner)).toBe(false);
  });

  it("rejects 'X hits creature owned by X' (owner-only friendly fire)", () => {
    const summoner = make('1');
    const summoned = make('99', '1');
    expect(canDamage(summoner, summoned)).toBe(false);
  });

  it('allows two different summoners\' creatures to fight', () => {
    const a = make('99', '1');
    const b = make('77', '2');
    expect(canDamage(a, b)).toBe(true);
  });

  it("rejects same-faction hits when both factionIds are set and equal", () => {
    expect(canDamage(make('1', null, 'red'), make('2', null, 'red'))).toBe(
      false,
    );
  });

  it('allows damage between different factions', () => {
    expect(canDamage(make('1', null, 'red'), make('2', null, 'blue'))).toBe(
      true,
    );
  });

  it('null factionId opts out of the same-faction rule (free-for-all)', () => {
    expect(canDamage(make('1', null, null), make('2', null, null))).toBe(true);
  });
});
