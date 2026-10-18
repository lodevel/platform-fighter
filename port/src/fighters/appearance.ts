import type { AppearancePreparation, AppearanceRequest, PresentationProfileIdentity, PresentationRoute } from '../../../src/characterPresentation/contracts';
import type { PresentationRegistry } from '../../../src/characterPresentation/registry';
import { createLegacyPresentationRegistry, legacyPresentationProfile } from '../../../src/characterPresentation/legacy/profiles';
import { createLegacyPreviewAppearanceRequest } from '../../../src/characterPresentation/legacy/bridge';
import type { AppearancePreparationHost, AppearanceSubmission, PresentationTarget } from '../engine/presentation/submission';
import { AppearanceSnapshotter } from '../engine/presentation/snapshot';
import type { SpriteLayer } from '../engine/sprites/spriteLayer';
import type { AppearanceBackend, AppearanceBackendFactory, HeldItemGrip } from './backends/types';
import type { ItemSocketAxis } from '../../../src/characters/heldItemSocket';
import { legacySpriteBackend } from './backends/legacySprite';
import { registerLegacyAppearanceResources } from './backends/legacyResources';
import { PACKAGE_SPRITE_CAPABILITY, packagePresentationProfile, packageSpriteBackend, registerPackageAppearanceResources } from './backends/packageSprite';
import { SHIPPED_PACKAGES } from './packageIndex';
import { loadGameSettings, type FighterDisplay } from '../../../src/config/gameSettings';

export type { AppearanceSubmission } from '../engine/presentation/submission';
export type { AppearanceBackend, AppearanceBackendFactory, BackendPreparation, HeldItemGrip } from './backends/types';

/** Registrations describe visual capabilities independently of gameplay factories. */
export class AppearanceSystem {
  private readonly backends = new Map<string, AppearanceBackendFactory>();
  private readonly snapshotter = new AppearanceSnapshotter();
  private readonly selectedProfiles = new Map<string, PresentationProfileIdentity>();
  constructor(readonly registry: PresentationRegistry) {}
  /** Choose a registered visual profile without changing gameplay factories. */
  selectProfile(identity: PresentationProfileIdentity): void {
    const profile = this.registry.profile(identity);
    for (const route of profile.routes) this.backend(route.capability);
    this.selectedProfiles.set(profile.characterId, { id: profile.id, revision: profile.revision });
  }
  profileFor(characterId: string): PresentationProfileIdentity {
    return this.selectedProfiles.get(characterId) ?? legacyPresentationProfile(characterId);
  }
  registerBackend(factory: AppearanceBackendFactory): void {
    if (this.backends.has(factory.capability)) throw new Error(`Duplicate appearance backend: ${factory.capability}`);
    this.backends.set(factory.capability, factory);
  }
  backend(capability: string): AppearanceBackendFactory {
    const factory = this.backends.get(capability);
    if (!factory) throw new Error(`Unsupported appearance backend: ${capability}`);
    return factory;
  }
  resourcePlan(profiles: readonly PresentationProfileIdentity[]) {
    return profiles.flatMap(identity => {
      const profile = this.registry.profile(identity);
      const byCapability = new Map<string, Set<string>>();
      for (const route of profile.routes) {
        this.backend(route.capability);
        const resources = byCapability.get(route.capability) ?? new Set<string>();
        route.resources.forEach(resource => resources.add(resource));
        byCapability.set(route.capability, resources);
      }
      return [...byCapability].map(([capability, resources]) => ({ profile: { id: profile.id, revision: profile.revision }, capability, resources: [...resources] }));
    });
  }
  create(request: AppearanceRequest): CharacterAppearance { return new CharacterAppearance(this, request); }
  previewIdentity(request: AppearanceRequest): string {
    const routes = this.registry.resolve(request);
    routes.forEach(route => this.backend(route.capability));
    return JSON.stringify([request.characterId, request.profile.id, request.profile.revision,
      routes.map(route => [route.id, route.capability]), request.palette, request.action, request.transform.facing]);
  }
  async snapshot(request: AppearanceRequest, signal?: AbortSignal): Promise<HTMLCanvasElement> {
    if (signal?.aborted) throw new Error('Appearance preview cancelled');
    const routes = this.registry.resolve(request);
    const route = routes[0]!, factory = this.backend(route.capability);
    if (routes.length === 1 && factory.snapshot) {
      const canvas = await factory.snapshot(request, route);
      if (signal?.aborted) throw new Error('Appearance preview cancelled');
      return canvas;
    }
    const instance = this.create(request);
    try { return await this.snapshotter.snapshot(instance, signal); }
    finally { instance.dispose(); }
  }
}

/** One actor/profile lifetime. Resources belong to adapters; the host borrows
 * submissions. Revision replacement disposes the old actor before it can draw. */
export class CharacterAppearance implements AppearanceSubmission {
  private readonly adapters = new Map<string, AppearanceBackend>();
  private routes: readonly PresentationRoute[] = [];
  private request: AppearanceRequest;
  private abort = new AbortController();
  private epoch = 0;
  private disposed = false;
  private prepared = false;
  private preparing: Promise<AppearancePreparation> | null = null;
  constructor(private readonly system: AppearanceSystem, request: AppearanceRequest) {
    this.request = request;
    // Validate every declared route before any asynchronous work or first action.
    for (const route of system.registry.profile(request.profile).routes) system.backend(route.capability);
    this.update(request);
  }
  get pass() { return this.request.pass; }
  get preparationGeneration(): number { return this.epoch; }
  get active(): boolean { return !this.disposed && !this.abort.signal.aborted; }
  get identity(): string { return JSON.stringify([this.request.actorId, this.request.characterId, this.request.profile]); }
  private adapter(route: PresentationRoute): AppearanceBackend {
    let backend = this.adapters.get(route.id);
    if (!backend) { backend = this.system.backend(route.capability).create(route); this.adapters.set(route.id, backend); }
    return backend;
  }
  /** Prepare instance-owned resources and hidden geometry programs. Shared
   * profile banks retain their separate resource lease; its combined readiness
   * gates match play. A shared-only adapter has no instance resources to load. */
  prepare(signal?: AbortSignal, host?: AppearancePreparationHost): Promise<AppearancePreparation> {
    if (this.disposed) return Promise.reject(new Error('Appearance preparation cancelled'));
    if (this.preparing) return this.preparing;
    const epoch = this.epoch, abort = this.abort;
    const cancel = () => abort.abort();
    if (signal?.aborted) cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    const current = () => !this.disposed && this.epoch === epoch && !abort.signal.aborted;
    const routes = this.system.registry.profile(this.request.profile).routes;
    this.preparing = Promise.all(routes.map(route => this.adapter(route).prepare({ signal: abort.signal, isCurrent: current, host })))
      .then(results => {
        if (!current()) throw new Error('Appearance preparation cancelled');
        if (results.some(result => !result.resourcesAvailable || !result.shadersReady)) throw new Error('Appearance backend preparation incomplete');
        this.prepared = true;
        return { resourcesAvailable: true, shadersReady: true,
          warmedBytes: results.reduce((bytes, result) => bytes + result.warmedBytes, 0) };
      }).finally(() => signal?.removeEventListener('abort', cancel));
    return this.preparing;
  }
  update(request: AppearanceRequest): void {
    if (this.disposed) throw new Error('Cannot update a disposed appearance');
    if (JSON.stringify([request.actorId, request.characterId, request.profile]) !== this.identity) throw new Error('Appearance identity changed; create a replacement instance');
    if (request.restoreGeneration !== this.request.restoreGeneration) this.reset(request.restoreGeneration);
    this.request = request;
    this.routes = this.system.registry.resolve(request);
    // Keep hidden stateful adapters on the same authoritative clock, including hitlag.
    for (const route of this.system.registry.profile(request.profile).routes) this.adapter(route).update(request);
  }
  submit(target: PresentationTarget): void {
    if (this.disposed || this.abort.signal.aborted || !this.request.visibility.visible) return;
    for (const route of this.routes) if (this.prepared || this.system.backend(route.capability).preparation === 'shared') this.adapter(route).submit(target);
  }
  reset(restoreGeneration: number): void {
    this.request = { ...this.request, restoreGeneration };
    this.abort.abort();
    this.abort = new AbortController();
    this.epoch++;
    this.preparing = null;
    this.prepared = false;
    for (const adapter of this.adapters.values()) adapter.reset(restoreGeneration);
  }
  /** The held-item grip of the drawing shown now, from the first drawn route whose art defines one. */
  heldItemGrip(axis: ItemSocketAxis): HeldItemGrip | null {
    if (this.disposed) return null;
    for (const route of this.routes) { const grip = this.adapter(route).heldItemGrip?.(axis); if (grip) return grip; }
    return null;
  }
  diagnostics(layer?: SpriteLayer, tint?: number): unknown {
    if (this.disposed) return null;
    const diagnostics = this.routes.map(route => this.adapter(route).diagnostics(layer, tint));
    return diagnostics.length === 1 ? diagnostics[0] : diagnostics;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.epoch++;
    this.adapters.forEach(adapter => adapter.dispose());
    this.adapters.clear();
  }
}

export const characterAppearances = new AppearanceSystem(createLegacyPresentationRegistry());
characterAppearances.registerBackend(legacySpriteBackend);
registerLegacyAppearanceResources();
// Package profiles are registered beside the legacy ones; legacy stays the default.
characterAppearances.registry.registerCapability({ id: PACKAGE_SPRITE_CAPABILITY });
for (const id of Object.keys(SHIPPED_PACKAGES.packages)) characterAppearances.registry.registerProfile(packagePresentationProfile(id)!);
characterAppearances.registerBackend(packageSpriteBackend);
registerPackageAppearanceResources();

/**
 * The fighters drawn from their character packages: all of them when the Fighter art setting is
 * `packages`, none for `legacy`. The probe flag `?packages=all|link,pikachu|none` overrides it.
 */
export function packageFighters(display: FighterDisplay, search: string): Set<string> {
  const params = new URLSearchParams(search), shipped = Object.keys(SHIPPED_PACKAGES.packages);
  const named = params.has('packages') ? params.get('packages')!.split(',').map(id => id.trim()).filter(Boolean)
    : display === 'packages' ? ['all'] : [];
  return new Set(named.includes('all') ? shipped : named.filter(id => shipped.includes(id)));
}

/**
 * The one place that chooses how each fighter is drawn (its profile), from the saved setting and
 * the probe flag. Entries call it when they start and the Options screen when the setting
 * changes, never during a match, so a match keeps the profiles it started with.
 */
export function applyFighterDisplay(display: FighterDisplay = loadGameSettings().fighterDisplay,
  search: string = globalThis.location?.search ?? '', system = characterAppearances): void {
  const packaged = packageFighters(display, search);
  for (const id of Object.keys(SHIPPED_PACKAGES.packages))
    system.selectProfile(packaged.has(id) ? packagePresentationProfile(id)! : legacyPresentationProfile(id));
}

export interface AppearancePose {
  readonly characterId: string;
  readonly x: number;
  readonly y: number;
  readonly facing: 1 | -1;
  readonly paletteIndex?: number;
  readonly zoom?: number;
  readonly depth?: number;
  readonly alpha?: number;
  readonly rotation?: number;
}

/** Shared match/menu/lineup lifecycle. Each actor keeps its backend clock. */
export class AppearanceCollection {
  private readonly instances = new Map<string, CharacterAppearance>();
  constructor(readonly system = characterAppearances) {}
  update(request: AppearanceRequest): CharacterAppearance {
    let instance = this.instances.get(request.actorId);
    const identity = JSON.stringify([request.actorId, request.characterId, request.profile]);
    if (instance && instance.identity !== identity) { instance.dispose(); instance = undefined; }
    if (!instance) { instance = this.system.create(request); this.instances.set(request.actorId, instance); }
    else instance.update(request);
    return instance;
  }
  pose(actorId: string, pose: AppearancePose, action: string, age: number, tint: number): AppearanceSubmission {
    return this.update(createLegacyPreviewAppearanceRequest({ ...pose, actorId, action, age, tint, profile: this.system.profileFor(pose.characterId), position: { x: pose.x, y: pose.y } }));
  }
  prepare(signal?: AbortSignal, host?: AppearancePreparationHost): Promise<AppearancePreparation[]> { return Promise.all([...this.instances.values()].map(instance => instance.prepare(signal, host))); }
  diagnostics(actorId: string, layer?: SpriteLayer, tint?: number): unknown { return this.instances.get(actorId)?.diagnostics(layer, tint) ?? null; }
  heldItemGrip(actorId: string, axis: ItemSocketAxis): HeldItemGrip | null { return this.instances.get(actorId)?.heldItemGrip(axis) ?? null; }
  retain(actorIds: readonly string[]): void {
    const retained = new Set(actorIds);
    for (const [id, instance] of this.instances) if (!retained.has(id)) { instance.dispose(); this.instances.delete(id); }
  }
  reset(restoreGeneration = 0): void { this.instances.forEach(instance => instance.reset(restoreGeneration)); }
  dispose(): void { this.instances.forEach(instance => instance.dispose()); this.instances.clear(); }
}

export function appearanceResourcePlan(characterIds: readonly string[]) {
  return characterAppearances.resourcePlan([...new Set(characterIds)].map(id => characterAppearances.profileFor(id)));
}
export function appearancePreviewIdentity(characterId: string, paletteIndex = 0): string {
  return characterAppearances.previewIdentity(createLegacyPreviewAppearanceRequest({ characterId, paletteIndex, profile: characterAppearances.profileFor(characterId), position: { x: 0, y: 0 } }));
}
export function snapshotCharacterAppearance(characterId: string, paletteIndex = 0): Promise<HTMLCanvasElement> {
  return characterAppearances.snapshot(createLegacyPreviewAppearanceRequest({ characterId, paletteIndex, profile: characterAppearances.profileFor(characterId), position: { x: 0, y: 0 } }));
}
