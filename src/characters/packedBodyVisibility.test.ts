/**
 * A packed fighter whose profile draws nothing for a missing sheet (Link) must still be drawn in every state a
 * player reaches: docs/review/2026-10-19/phase6/invisible-fighters.md.
 */
import { describe, expect, it } from 'vitest';
import { createArtFrameSelector, MANIFEST_ART_CATALOG } from './artFrameSelector';
import { captureSimulationAnimation, resolveSimulationAction } from './simulationSpriteAnimation';
import { Link } from './Link';
import { buildSimView } from '../sim/buildSimView';
import { MatchSim } from '../sim/MatchSim';
import { NEUTRAL_INPUT } from '../replay/InputCaptureBuffer';
import { CRATE_DEFINITION } from '../items/Crate';
import { itemPhysicsFixture, NEUTRAL_INPUT as neutral } from '../items/itemPhysicsFixture';
import type { CharacterInput } from './Character';

describe('Link stays drawn', () => {
  it('through the aerial Spin Attack, its special fall and the touchdown (SmashWiki: helpless after the air version)', () => {
    const sim = new MatchSim({ matchConfig: { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 7, itemFrequency: 'off', linkIntroPolicy: 'none',
      players: [{ index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
        { index: 2, characterId: 'donkeykong', paletteIndex: 1, inputType: 'keyboard_p2' }] } });
    const selector = createArtFrameSelector(MANIFEST_ART_CATALOG), drawn = new Map<string, number>();
    const script: CharacterInput[] = [...Array<CharacterInput>(240).fill(NEUTRAL_INPUT), { ...NEUTRAL_INPUT, jump: true },
      ...Array<CharacterInput>(8).fill(NEUTRAL_INPUT), { ...NEUTRAL_INPUT, special: true, moveY: -1 }, { ...NEUTRAL_INPUT, special: true, moveY: -1 },
      ...Array<CharacterInput>(240).fill(NEUTRAL_INPUT)];
    try {
      for (const input of script) {
        sim.step([input, NEUTRAL_INPUT]);
        const link = buildSimView(sim).fighters.find(f => f.characterId === 'link')!, s = link.animation;
        const art = selector.select(s);
        const key = `${s.helpless ? 'helpless' : s.activeAttack?.move.id ?? 'other'}:${resolveSimulationAction(s).state}`;
        drawn.set(key, (drawn.get(key) ?? 0) + 1);
        expect(art, `${key} on step ${s.frame}`).not.toBeNull();
      }
    } finally { sim.dispose(); }
    // The spin, its special fall and the special-fall landing were all reached and drawn.
    expect([...drawn.keys()]).toEqual(expect.arrayContaining(['link.up_special:d02specialairhi', 'helpless:fall_special', 'other:a04landingfallspecial']));
  });

  it('carrying a heavy item, standing and walking (the native heavy walk; standing holds the lift)', () => {
    const f = itemPhysicsFixture(Link, CRATE_DEFINITION);
    f.actor.syncDonkeyKongHeavyItem(true);
    const sheets: string[] = [];
    for (const input of [...Array<CharacterInput>(10).fill(neutral), ...Array<CharacterInput>(40).fill({ ...neutral, moveX: 1 })]) {
      f.step(input);
      const pose = resolveSimulationAction(captureSimulationAnimation(f.actor, f.frame(), false));
      expect(pose.invisible, pose.state).toBeUndefined();
      sheets.push(pose.sheets[0]!);
    }
    expect(new Set(sheets)).toEqual(new Set(['h03heavyget', 'h03heavywalk']));
  });
});
