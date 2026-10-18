import { appearanceResourcePlan } from './appearance';
import { PACKAGE_SPRITE_CAPABILITY, packageOfResource } from './backends/packageSprite';
import { packageLibrary, type PackageLease, type PackageLibrary } from './packageLibrary';

/**
 * Keeps the art of the fighters a menu has picked loading in the background, so a match that
 * starts with them waits only for what is not loaded yet. Players on the same fighter share one
 * copy; a dropped fighter unloads after the library's grace period, so quick changes do not
 * reload. Only fighters drawn from packages hold anything: legacy sheets load at match start.
 */
export class FighterArtHold {
  private readonly leases = new Map<string, PackageLease>();
  private disposed = false;
  constructor(private readonly library: PackageLibrary = packageLibrary,
    private readonly plan: typeof appearanceResourcePlan = appearanceResourcePlan) {}

  /** Hold exactly the packages `characterIds` are drawn from. Ignored once disposed. */
  hold(characterIds: readonly string[]): void {
    const wanted = new Set(this.disposed ? [] : this.plan(characterIds).filter(entry => entry.capability === PACKAGE_SPRITE_CAPABILITY)
      .flatMap(entry => entry.resources.map(packageOfResource)));
    for (const [id, lease] of this.leases) if (!wanted.has(id)) { lease.release(); this.leases.delete(id); }
    for (const id of wanted) if (!this.leases.has(id)) {
      const lease = this.library.acquire(id);
      // A failed background load is retried by the match's own lease, which reports it.
      lease.ready.catch(() => undefined);
      this.leases.set(id, lease);
    }
  }

  /** Releases everything; a screen may still render once after leaving, which then holds nothing. */
  dispose(): void { this.disposed = true; this.hold([]); }
}
