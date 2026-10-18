import type { PresentationProfileIdentity } from '../../../src/characterPresentation/contracts';
import type { WebGLRenderer } from 'three';
import type { TextureStore } from '../engine/sprites/textureStore';

/** Resource work belongs to a prepared profile revision, never to a screen's
 * current selection. Shared texture ownership stays with the rendering host. */
export interface AppearanceResourcePlan {
  readonly profile: PresentationProfileIdentity;
  readonly capability: string;
  readonly resources: readonly string[];
}

export interface AppearanceResourceWork {
  prepare(signal: AbortSignal, progress: (done: number, total: number) => void): Promise<void>;
}

export interface AppearanceResourceHost {
  readonly textures: TextureStore;
  readonly renderer: WebGLRenderer;
}

export interface AppearanceResourceProvider {
  readonly capability: string;
  prepare(resources: readonly string[], host: AppearanceResourceHost,
    context: { readonly signal: AbortSignal; readonly progress: (done: number, total: number) => void }): Promise<void>;
}

const providers = new Map<string, AppearanceResourceProvider>();
const shared = new Map<string, readonly string[]>();

/** Register resource policy with the backend, independently of match screens. */
export function registerAppearanceResourceProvider(provider: AppearanceResourceProvider): void {
  if (providers.has(provider.capability)) throw new Error(`Duplicate appearance resource provider: ${provider.capability}`);
  providers.set(provider.capability, provider);
}

/** Items/effects may remain necessary even when every actor uses geometry. */
export function registerSharedAppearanceResources(capability: string, resources: readonly string[]): void {
  if (shared.has(capability)) throw new Error(`Duplicate shared resource policy: ${capability}`);
  shared.set(capability, [...resources]);
}

export function prepareRegisteredAppearanceResources(plan: readonly AppearanceResourcePlan[], host: AppearanceResourceHost,
  shaders: { prepare(): Promise<void>; cancel(): void }, progress: (done: number, total: number) => void): AppearanceResourceLease {
  const groups = new Map<string, Set<string>>([...shared].map(([capability, resources]) => [capability, new Set(resources)]));
  for (const entry of plan) {
    const resources = groups.get(entry.capability) ?? new Set<string>();
    entry.resources.forEach(resource => resources.add(resource));
    groups.set(entry.capability, resources);
  }
  // Validate providers before any decode or shader preparation can start.
  const jobs = [...groups].flatMap(([capability, resources]) => {
    if (!resources.size) return [];
    const provider = providers.get(capability);
    if (!provider) throw new Error(`No resource preparation provider for '${capability}'`);
    return [{ provider, resources: [...resources] }];
  });
  return prepareAppearanceResources(plan, { prepare: async (signal, report) => {
    const part = combinedProgress(jobs.length, report);
    if (!jobs.length) report(0, 0);
    await Promise.all(jobs.map((job, index) => job.provider.prepare(job.resources, host, { signal, progress: part(index) })));
  } }, shaders, progress);
}

/** Progress callbacks for `parts` concurrent jobs that report their sum to `report`. */
export function combinedProgress(parts: number, report: (done: number, total: number) => void) {
  const counts = Array.from({ length: parts }, () => ({ done: 0, total: 0 }));
  return (index: number) => (done: number, total: number) => {
    counts[index] = { done, total };
    report(counts.reduce((sum, count) => sum + count.done, 0), counts.reduce((sum, count) => sum + count.total, 0));
  };
}

export interface AppearanceResourceLease {
  readonly identity: string;
  readonly ready: Promise<void>;
  readonly cancelled: boolean;
  readonly resourcesAvailable: boolean;
  readonly shadersReady: boolean;
  /** Stops scheduling and callbacks; an in-flight shared decode may finish. */
  cancel(): void;
  /** Idempotent. Does not evict shared menu or match banks. */
  dispose(): void;
}

/** Decode/availability and shader readiness proceed together. Warming is part
 * of backend work and retains its separate allowance, not a residency cap. */
export function prepareAppearanceResources(plan: readonly AppearanceResourcePlan[],
  work: AppearanceResourceWork, shaders: { prepare(): Promise<void>; cancel(): void },
  progress: (done: number, total: number) => void): AppearanceResourceLease {
  const controller = new AbortController();
  let resourcesAvailable = false, shadersReady = false;
  const identity = JSON.stringify(plan.map(entry => [entry.profile.id, entry.profile.revision, entry.capability, entry.resources]));
  const cancel = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    shaders.cancel();
  };
  // Preserve the existing synchronous start of decode workers and shaders.
  const resources = work.prepare(controller.signal, (done, total) => {
    if (!controller.signal.aborted) progress(done, total);
  }).then(() => { if (!controller.signal.aborted) resourcesAvailable = true; });
  const shaderReady = shaders.prepare().then(() => { if (!controller.signal.aborted) shadersReady = true; });
  const ready = Promise.all([resources, shaderReady]).then(() => undefined).catch((error: unknown) => {
    cancel();
    throw error;
  });
  return { identity, ready, get cancelled() { return controller.signal.aborted; },
    get resourcesAvailable() { return resourcesAvailable; }, get shadersReady() { return shadersReady; }, cancel, dispose: cancel };
}
