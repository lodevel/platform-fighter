import type { CharacterId } from '../../../src/types';
import type { StagePresenter } from '../arena/presenter';
import { appearanceResourcePlan, packageOptIn, selectPackageProfiles } from '../fighters/appearance';
import { prepareRegisteredAppearanceResources, type AppearanceResourceLease } from '../fighters/resources';

/** Compatibility entry point for the legacy bank's scheduling tests. */
export { preloadLegacyMatchArt as preloadMatchArt } from '../fighters/backends/legacyResources';

/** A match owns a cancellable preparation lease, while the presenter retains
 * the shared resource cache under its existing menu/match policy. */
export function prepareMatchResources(presenter: StagePresenter, fighters: readonly CharacterId[],
  progress: (done: number, total: number) => void,
  shaders: { prepare(): Promise<void>; cancel(): void }): AppearanceResourceLease {
  // Dev opt-in, read once per match: `?packages=link` shows Link from its character package.
  selectPackageProfiles(fighters, packageOptIn(globalThis.location?.search ?? ''));
  const plan = appearanceResourcePlan(fighters);
  return prepareRegisteredAppearanceResources(plan, { textures: presenter.sprites.textures, renderer: presenter.renderer }, shaders, progress);
}
