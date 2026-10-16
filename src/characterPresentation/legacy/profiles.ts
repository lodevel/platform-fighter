import type { PresentationProfile } from '../contracts';
import { createPresentationRegistry } from '../registry';

export const LEGACY_SPRITE_CAPABILITY = 'legacy-sprite';
export const LEGACY_PRESENTATION_REVISION = 'legacy-sprite-v1';
const profiles = new Map<string, PresentationProfile>(['donkeykong', 'pikachu', 'link'].map(characterId => [characterId, Object.freeze({
  id: `legacy.${characterId}`, revision: LEGACY_PRESENTATION_REVISION, characterId,
  routes: Object.freeze([Object.freeze({ id: 'legacy-body', action: '*', layer: 'body', capability: LEGACY_SPRITE_CAPABILITY,
    resources: Object.freeze([`fighter:${characterId}`]) })]),
})]));

/** This is deliberately a legacy-only roster table, separate from gameplay factories. */
export function legacyPresentationProfile(characterId: string): PresentationProfile {
  const profile = profiles.get(characterId);
  if (!profile) throw new Error(`No legacy presentation profile: ${characterId}`);
  return profile;
}

export function createLegacyPresentationRegistry() {
  const registry = createPresentationRegistry();
  registry.registerCapability({ id: LEGACY_SPRITE_CAPABILITY });
  for (const profile of profiles.values()) registry.registerProfile(profile);
  return registry;
}
