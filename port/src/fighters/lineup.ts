import { STAGE_DESIGN_WIDTH } from '../../../src/stages/stageDefinitions';
import type { PlayerSlot, StageLayout } from '../../../src/types';
import type { StageRuntime } from '../arena/runtime';
import type { AppearanceCollection, AppearanceSubmission } from './appearance';

/** Top of the widest solid platform, where the preview cast stands. */
function groundTop(layout: StageLayout): number {
  const ground = layout.platforms.reduce((a, b) => (!b.passThrough && b.width > a.width ? b : a));
  return ground.y - ground.height / 2;
}

/** A menu lineup uses the same appearance routes as the live match. */
export function lineupAppearances(appearances: AppearanceCollection,
  players: ReadonlyArray<Pick<PlayerSlot, 'characterId' | 'paletteIndex'>>, runtime: StageRuntime,
  motion?: (index: number) => { action: string; age: number } | null): AppearanceSubmission[] {
  const top = groundTop(runtime.layout);
  const tint = runtime.view.theme.spriteTint.getHex();
  return players.flatMap((p, k) => {
    const at = runtime.layout.spawnPoints[k % runtime.layout.spawnPoints.length];
    if (!at) return [];
    const pose = motion?.(k);
    return [appearances.pose(`lineup:${k}`, {
      characterId: p.characterId, paletteIndex: p.paletteIndex, x: at.x, y: top,
      facing: at.x < STAGE_DESIGN_WIDTH / 2 ? 1 : -1, depth: k,
    }, pose?.action ?? 'idle', pose?.age ?? runtime.frame, tint)];
  });
}

/** The stage viewer's cast preserves its original placement and facings. */
export function viewerFighterAppearances(appearances: AppearanceCollection, runtime: StageRuntime): AppearanceSubmission[] {
  const top = groundTop(runtime.layout);
  return (['donkeykong', 'pikachu', 'link'] as const).flatMap((characterId, i) => {
    const at = runtime.layout.spawnPoints[i % runtime.layout.spawnPoints.length];
    return at ? [appearances.pose(`viewer:${i}`, { characterId, x: at.x, y: top, facing: i === 2 ? -1 : 1, depth: i },
      'idle', runtime.frame, runtime.view.theme.spriteTint.getHex())] : [];
  });
}
