import type {
  AppearanceRequest, PresentationCapability, PresentationProfile,
  PresentationProfileIdentity, PresentationRoute,
} from './contracts';

function nonempty(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid presentation ${name}`);
}
const identityKey = (identity: PresentationProfileIdentity): string => JSON.stringify([identity.id, identity.revision]);

/** Registration is explicit. Exact action beats wildcard action, then exact phase
 * beats wildcard phase. A layer can have only one winning route. */
export function createPresentationRegistry() {
  const capabilities = new Map<string, PresentationCapability>();
  const profiles = new Map<string, PresentationProfile>();
  return {
    registerCapability(capability: PresentationCapability): void {
      nonempty(capability.id, 'capability id');
      if (capabilities.has(capability.id)) throw new Error(`Duplicate presentation capability: ${capability.id}`);
      capabilities.set(capability.id, Object.freeze({ ...capability }));
    },
    registerProfile(profile: PresentationProfile): void {
      nonempty(profile.id, 'profile id');
      nonempty(profile.revision, 'profile revision');
      nonempty(profile.characterId, 'character id');
      const key = identityKey(profile);
      if (profiles.has(key)) throw new Error(`Duplicate presentation profile: ${profile.id}@${profile.revision}`);
      if (!profile.routes.length) throw new Error(`Presentation profile has no routes: ${profile.id}`);
      const ids = new Set<string>(), selectors = new Set<string>();
      for (const route of profile.routes) {
        for (const [field, value] of Object.entries({ id: route.id, action: route.action, phase: route.phase ?? '*', layer: route.layer, capability: route.capability })) nonempty(value, `route ${field}`);
        if (ids.has(route.id)) throw new Error(`Duplicate presentation route: ${route.id}`);
        ids.add(route.id);
        const selector = JSON.stringify([route.action, route.phase ?? '*', route.layer]);
        if (selectors.has(selector)) throw new Error(`Ambiguous presentation routes in layer: ${route.layer}`);
        selectors.add(selector);
        if (!capabilities.has(route.capability)) throw new Error(`Unsupported presentation capability: ${route.capability}`);
        for (const resource of route.resources) nonempty(resource, 'resource');
      }
      profiles.set(key, Object.freeze({ ...profile, routes: Object.freeze(profile.routes.map(route => Object.freeze({ ...route, resources: Object.freeze([...route.resources]) }))) }));
    },
    profile(identity: PresentationProfileIdentity): PresentationProfile {
      const profile = profiles.get(identityKey(identity));
      if (!profile) throw new Error(`Unknown presentation profile: ${identity.id}@${identity.revision}`);
      return profile;
    },
    resolve(request: AppearanceRequest): readonly PresentationRoute[] {
      const profile = this.profile(request.profile);
      if (profile.characterId !== request.characterId) throw new Error(`Presentation profile character mismatch: ${profile.id}`);
      const selected = new Map<string, { route: PresentationRoute; rank: number }>();
      for (const route of profile.routes) {
        if (route.action !== '*' && route.action !== request.action.id) continue;
        if (route.phase !== undefined && route.phase !== '*' && route.phase !== request.action.phase) continue;
        const rank = (route.action === '*' ? 0 : 2) + (route.phase === undefined || route.phase === '*' ? 0 : 1);
        const prior = selected.get(route.layer);
        if (!prior || rank > prior.rank) selected.set(route.layer, { route, rank });
      }
      if (!selected.size) throw new Error(`Missing presentation route: ${profile.id}/${request.action.id}/${request.action.phase}`);
      return [...selected.values()].map(value => value.route);
    },
    capabilities(): readonly PresentationCapability[] { return [...capabilities.values()]; },
  };
}

export type PresentationRegistry = ReturnType<typeof createPresentationRegistry>;
