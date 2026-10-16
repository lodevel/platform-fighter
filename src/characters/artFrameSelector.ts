import {
  resolveSimulationAction, selectActionArtFrame,
  type ActionPose, type SimulationAnimationSnapshot, type SimulationSpritePose,
} from './simulationSpriteAnimation';
import {
  characterAnimationSheets, getMoveAnimKey, getSpriteAnimationKey, type CharacterAnimationSheet,
} from './spriteAnimationDriver';
import { findAssetEntry } from '../assets/manifest';
import type { CharacterId } from '../types';

/**
 * The art-frame choice of the game's simulation sprite driver, without Phaser
 * (STEP5-DESIGN §4 `selectArtFrame`), so the Three.js view and the Phaser
 * sprite pick the same drawing for the same simulation snapshot.
 *
 * `createSimulationSpriteAnimationDriver` applies `createArtFrameSelector` to
 * its sprite; `registerCharacterSpriteAnimations` loops over
 * `characterAnimationSheets` (spriteAnimationDriver.ts).
 */

/** How many frames an animation has (0 when it does not exist or is not loaded). */
export interface ArtCatalog {
  frameCount(animKey: string): number;
}

const sheetsByAnimKey = new Map<string, CharacterAnimationSheet | null>();
function sheetFor(animKey: string): CharacterAnimationSheet | null {
  let sheet = sheetsByAnimKey.get(animKey);
  if (sheet === undefined) {
    const id = animKey.split('.')[0] as CharacterId;
    sheet = characterAnimationSheets(id).find((a) => a.animKey === animKey) ?? null;
    sheetsByAnimKey.set(animKey, sheet);
  }
  return sheet;
}

/** The texture an animation key plays (every frame of it), or null. */
export function artTextureKey(animKey: string): string | null {
  return sheetFor(animKey)?.textureKey ?? null;
}

/** The catalog the game would register, without Phaser: each animation's texture frame count from the manifest. */
export const MANIFEST_ART_CATALOG: ArtCatalog = {
  frameCount(animKey) {
    const textureKey = artTextureKey(animKey);
    const entry = textureKey ? findAssetEntry(textureKey) : undefined;
    return entry && entry.kind === 'spritesheet' ? entry.frameCount ?? 0 : 0;
  },
};

/**
 * Stateful like the driver it comes from: an action's art clock counts
 * simulation frames since the action began, pauses in hitlag, holds while
 * frozen and restarts on a rewind. Call `select` once per simulation frame.
 */
export function createArtFrameSelector(catalog: ArtCatalog) {
  let last: SimulationSpritePose | null = null;
  let lastFrame: number | null = null;
  let stateElapsed = 0;
  return {
    select(snapshot: SimulationAnimationSnapshot): SimulationSpritePose | null {
      if (snapshot.frozen && last) {
        lastFrame = snapshot.frame;
        return last;
      }
      const action = resolveSimulationAction(snapshot);
      if (action.invisible) { last = null; lastFrame = snapshot.frame; return null; }
      if (last?.state !== action.state || (lastFrame !== null && snapshot.frame < lastFrame)) stateElapsed = 0;
      else if (lastFrame !== null && snapshot.hitlagRemaining === 0) stateElapsed += Math.max(0, snapshot.frame - lastFrame);
      lastFrame = snapshot.frame;
      const resolve = (pose: ActionPose) => {
        const namespace = snapshot.assetCharacterId ?? snapshot.characterId;
        const key = pose.sheets.map((sheet) => namespace !== snapshot.characterId
          ? `${namespace}.${sheet}.anim`
          : getMoveAnimKey(snapshot.characterId, sheet) ??
          (sheet === 'idle' || sheet === 'run' || sheet === 'jump' || sheet === 'attack' ? getSpriteAnimationKey(snapshot.characterId, sheet) : null))
          .find((candidate): candidate is string => candidate !== null && catalog.frameCount(candidate) > 0);
        if (!key) return null;
        const count = catalog.frameCount(key);
        const sheet = key.split('.')[1] ?? 'idle';
        return { key, count, sheet, frameIndex: selectActionArtFrame(pose, count, sheet, stateElapsed)! };
      };
      const main = resolve(action);
      if (!main) return last;
      const upper = action.overlay ? resolve(action.overlay) : null;
      last = {
        key: main.key, state: action.state, frameIndex: main.frameIndex, scaleX: action.scaleX ?? 1, scaleY: action.scaleY ?? 1,
        crouchClip: main.sheet === 'crouch', facing: action.facing ?? snapshot.facing,
        ...(upper ? { overlay: { key: upper.key, frameIndex: Math.max(0, Math.min(upper.count - 1, upper.frameIndex)) } } : {}),
      };
      return last;
    },
    current: () => last,
  };
}
