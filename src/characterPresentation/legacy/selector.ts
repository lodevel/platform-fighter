import { createArtFrameSelector, MANIFEST_ART_CATALOG, type ArtCatalog } from '../../characters/artFrameSelector';
import type { AppearanceRequest } from '../contracts';
import { readLegacyAnimation } from './bridge';

/** Keep the old stateful algorithm intact. Repeated ticks, rewind, freeze and
 * hitlag all follow its existing schedule; rendering never advances a clock. */
export function createLegacyArtSelector(catalog: ArtCatalog = MANIFEST_ART_CATALOG) {
  let selector = createArtFrameSelector(catalog);
  let identity: string | null = null;
  let disposed = false;
  return {
    select(request: AppearanceRequest) {
      if (disposed) throw new Error('Legacy art selector is disposed');
      const snapshot = readLegacyAnimation(request);
      if (!snapshot) throw new Error('Legacy art selector requires a bridged simulation request');
      const nextIdentity = JSON.stringify([request.actorId, request.characterId, request.profile.id, request.profile.revision, request.restoreGeneration]);
      if (identity !== null && identity !== nextIdentity) selector = createArtFrameSelector(catalog);
      identity = nextIdentity;
      return selector.select(snapshot);
    },
    current: () => selector.current(),
    reset(): void { selector = createArtFrameSelector(catalog); identity = null; },
    dispose(): void { if (!disposed) { disposed = true; selector = createArtFrameSelector(catalog); identity = null; } },
  };
}
