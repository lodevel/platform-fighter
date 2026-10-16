import { describe, expect, it } from 'vitest';
import { resolveItemInput, type ItemInputPattern } from './resolveItemInput';
import { HOME_RUN_BAT_DEFINITION } from './HomeRunBat';
import { STAR_ROD_DEFINITION } from './StarRod';
import { CRATE_DEFINITION } from './Crate';

const PATTERNS: readonly ItemInputPattern[] = ['jab', 'tilt', 'dashAttack', 'smash', 'utilt', 'dtilt', 'usmash', 'dsmash', 'nair', 'aerial'];
const decide = (pattern: ItemInputPattern, uses: typeof HOME_RUN_BAT_DEFINITION.uses, canUse = true, back = false) =>
  resolveItemInput(pattern, uses, canUse, back);

describe('resolveItemInput — one input decision for every held item', () => {
  // universal-rules.json attackInput.battering: "turning their neutral attack, forward tilt, dash attack, and
  // forward smash into an item swipe" (https://www.ssbwiki.com/Item#Types_of_items). Up/down tilts and aerials are
  // SOURCE_SILENT (batteringOtherTiltsAndAerials), so the fighter's own moves run. attackInput.smashAttacksThrowItem:
  // a smash attack input with an item is a smash throw, except the battering item's own forward smash.
  it('battering (Home-Run Bat): four swipes; up/down smash = smash throw; tilts/aerials native', () => {
    const uses = HOME_RUN_BAT_DEFINITION.uses!;
    expect(Object.fromEntries(PATTERNS.map(p => [p, decide(p, uses)]))).toEqual({
      jab: { kind: 'use', move: uses.jab }, tilt: { kind: 'use', move: uses.ftilt },
      dashAttack: { kind: 'use', move: uses.dashAttack }, smash: { kind: 'use', move: uses.fsmash },
      utilt: null, dtilt: null, nair: null, aerial: null,
      usmash: { kind: 'smash-throw', direction: 'up' }, dsmash: { kind: 'smash-throw', direction: 'down' },
    });
  });

  it('an item without a forward smash use smash-throws forward (or back when the smash points behind)', () => {
    for (const p of PATTERNS) {
      const expected = p === 'smash' ? { kind: 'smash-throw', direction: 'forward' }
        : p === 'usmash' ? { kind: 'smash-throw', direction: 'up' } : p === 'dsmash' ? { kind: 'smash-throw', direction: 'down' } : null;
      expect(decide(p, CRATE_DEFINITION.uses), p).toEqual(expected);
    }
    expect(decide('smash', CRATE_DEFINITION.uses, true, true)).toEqual({ kind: 'smash-throw', direction: 'back' });
  });

  it('an item that cannot be used (out of ammo) keeps native presses and smash-throws on every smash', () => {
    const uses = STAR_ROD_DEFINITION.uses!;
    for (const p of ['jab', 'tilt', 'dashAttack'] as const) expect(decide(p, uses)).toMatchObject({ kind: 'use' });
    for (const p of ['jab', 'tilt', 'dashAttack', 'nair', 'aerial', 'utilt', 'dtilt'] as const) expect(decide(p, uses, false)).toBeNull();
    expect(decide('smash', HOME_RUN_BAT_DEFINITION.uses, false)).toEqual({ kind: 'smash-throw', direction: 'forward' });
  });

  // universal-rules.json attackInput.shootingFire ("typically replacing the neutral attack and neutral aerial"),
  // shootingMovement (run and jump while using them: a press while walking / running classifies as forward tilt /
  // dash attack, so those fire too) and emptyShootingItem (SSB4 / Ultimate: an empty one is thrown instead).
  it('shooting items fire on neutral attack (also walking / running) and neutral aerial; empty = thrown', () => {
    const shoot = (p: ItemInputPattern, canUse = true) => resolveItemInput(p, undefined, canUse, false, true);
    expect(Object.fromEntries(PATTERNS.map(p => [p, shoot(p)]))).toEqual({
      jab: { kind: 'fire' }, tilt: { kind: 'fire' }, dashAttack: { kind: 'fire' }, nair: { kind: 'fire' },
      smash: { kind: 'smash-throw', direction: 'forward' }, usmash: { kind: 'smash-throw', direction: 'up' },
      dsmash: { kind: 'smash-throw', direction: 'down' }, utilt: null, dtilt: null, aerial: null,
    });
    for (const p of ['jab', 'tilt', 'dashAttack', 'nair'] as const) expect(shoot(p, false)).toEqual({ kind: 'empty-throw' });
    expect(shoot('aerial', false)).toBeNull();
  });
});
