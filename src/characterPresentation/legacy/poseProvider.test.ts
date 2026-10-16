import { expect, it } from 'vitest';
import { MatchSim } from '../../sim/MatchSim';
import { NEUTRAL_INPUT } from '../../replay/InputCaptureBuffer';
import { captureSimulationAnimation } from '../../characters/simulationSpriteAnimation';
import { createPresentationRegistry } from '../registry';
import { createLegacySnapshotAppearanceRequest } from './bridge';
import { LEGACY_GAMEPLAY_POSE_PROFILE, selectCapturePoseSource, selectHeldItemSocket, selectPackedBodyReceiving, selectPackedHeadContact, getPackedAttackCollisionPose } from './poseProvider';

it('keeps headless geometry, capture roots and sockets unchanged when display routes and clocks change', () => {
  const sim = new MatchSim({ matchConfig: { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 161026, itemFrequency: 'off', linkIntroPolicy: 'none',
    finalSmashRules: { schemaVersion: 1, meterEnabled: false, smashBallEnabled: false }, players: [
      { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' },
      { index: 3, characterId: 'link', paletteIndex: 2, inputType: 'ai', aiDifficulty: 'hard' },
    ] } });
  const registry = createPresentationRegistry();
  registry.registerCapability({ id: 'stored' }); registry.registerCapability({ id: 'computed' });
  for (const id of ['donkeykong', 'pikachu', 'link']) for (const revision of ['1', '2']) registry.registerProfile({
    id, revision, characterId: id, routes: [{ id: 'body', action: '*', layer: 'body', capability: revision === '1' ? 'stored' : 'computed', resources: [] }],
  });
  let compared = 0;
  const sample = (s: ReturnType<typeof captureSimulationAnimation>) => ({
    pose: selectCapturePoseSource(s), socket: selectHeldItemSocket(s), muzzle: selectHeldItemSocket(s, 'z'),
    receiving: selectPackedBodyReceiving(s), head: selectPackedHeadContact(s), outgoing: getPackedAttackCollisionPose(s),
  });
  try {
    for (let tick = 0; tick < 100; tick++) {
      sim.step([{ ...NEUTRAL_INPUT, attack: tick === 12, jump: tick === 58 }, NEUTRAL_INPUT]);
      const digest = sim.getSimDigest().hash;
      for (const { character } of sim.playerSlots) {
        const state = captureSimulationAnimation(character, tick, tick >= 35 && tick < 40);
        const before = sample(state);
        const first = createLegacySnapshotAppearanceRequest(state, { position: character.getPosition(), profile: { id: character.id, revision: '1' } });
        const second = { ...first, profile: { id: character.id, revision: '2' },
          action: { ...first.action, clock: { ...first.action.clock, age: 9999, tick: -100 } } };
        expect(registry.resolve(first)[0]!.capability).toBe('stored');
        expect(registry.resolve(second)[0]!.capability).toBe('computed');
        expect(sample(state)).toEqual(before);
        compared++;
      }
      expect(sim.getSimDigest().hash).toBe(digest);
    }
    expect(compared).toBe(300);
    expect(LEGACY_GAMEPLAY_POSE_PROFILE).toEqual({ id: 'installed-gameplay-pose', revision: '1' });
  } finally { sim.dispose(); }
});
