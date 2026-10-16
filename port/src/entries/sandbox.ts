import type { MatchConfig, CharacterId } from '../../../src/types';
import { NEW_MATCH_FINAL_RULES } from '../../../src/finalSmash/finalSmashSchema';

/** A real match in the normal host; every sandbox frame is actual gameplay. */
document.body.innerHTML = '<div id="backdrop" aria-hidden="true"></div><div class="vignette"></div><main id="screens"></main>';
const { startMatch } = await import('./game');
const params = new URLSearchParams(location.search);
const roster = (params.get('fighters') ?? 'donkeykong,pikachu,link').split(',')
  .filter((id): id is CharacterId => ['donkeykong', 'pikachu', 'link'].includes(id)).slice(0, 4);
const config: MatchConfig = { mode: 'stocks', stockCount: 3, stageId: params.get('stage') ?? 'flat',
  rngSeed: Number(params.get('seed') ?? 1337), itemFrequency: 'high',
  players: (roster.length >= 2 ? roster : ['donkeykong', 'pikachu'] as const).map((characterId, index) => ({
    index: (index + 1) as 1 | 2 | 3 | 4, characterId, paletteIndex: index,
    inputType: params.get('human') === '1' && index === 0 ? 'keyboard_p1' : 'ai', aiDifficulty: 'hard',
  })),
  finalSmashRules: { ...NEW_MATCH_FINAL_RULES, meterEnabled: true },
};
startMatch(config);
const sim = (window as unknown as { __sim: { ready: Promise<void>; manual(enabled: boolean): void; step(): unknown; match: { isFinished: boolean; getSourceIntroSnapshot(): unknown }; frame: number; project(x: number, y: number): { x: number; y: number } } }).__sim;
sim.manual(true);
await sim.ready;
if (params.has('frame') || params.get('pause') === '1') {
  sim.manual(true);
  const target = Math.max(0, Math.min(36000, Number(params.get('frame') ?? 0)));
  while (!sim.match.isFinished && (sim.frame < target || sim.match.getSourceIntroSnapshot())) sim.step();
  if (params.get('pause') !== '1') sim.manual(false);
} else sim.manual(false);
Object.assign(window, { __port: { get stage() { return config.stageId; }, get frame() { return sim.frame; }, project: sim.project } });
