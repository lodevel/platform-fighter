/**
 * Live items registry — T3 items framework, AC 10-19.
 *
 * Owns the array of every {@link ItemEntity} currently on the stage.
 * Drives per-tick TTL despawn / broken-debris despawn checks; gates
 * the {@link ItemSpawnManager}'s cap calculation by reporting the
 * active count.
 *
 * Phaser-free — the registry tracks lifecycle state only; a Phaser
 * adapter layer attaches sprite / Matter handles via
 * {@link ItemEntity.attachedRender}.
 */

import type { ItemEntity } from './ItemEntity';
import type { ItemDefinition } from './ItemDefinition';

export class ItemRegistry {
  private readonly entities: ItemEntity[] = [];
  private nextId = 0;

  /** Total entities tracked, including despawned ones (for diagnostics). */
  size(): number {
    return this.entities.length;
  }

  /** Active count excludes despawned entries — what the spawn manager reads. */
  getActiveCount(): number {
    let active = 0;
    for (const e of this.entities) {
      if (!e.isDespawned()) active += 1;
    }
    return active;
  }

  /** Every live (non-despawned) entity in spawn order. */
  getActive(): ItemEntity[] {
    return this.entities.filter((e) => !e.isDespawned());
  }

  /** Every grounded item (used by AI / pickup proximity scan). */
  getGrounded(): ItemEntity[] {
    return this.entities.filter((e) => e.getSnapshot().state === 'grounded');
  }

  /** Look up by id — used by the replay scrubber to highlight a specific spawn. */
  findById(id: number): ItemEntity | null {
    return this.entities.find((e) => e.id === id) ?? null;
  }

  /**
   * Spawn a fresh entity. Called from the scene's
   * {@link ItemSpawnManager.step} consumer; the registry assigns the
   * id, builds the entity, and returns it for the caller to attach a
   * Phaser sprite / Matter body if needed.
   */
  spawn(
    definition: ItemDefinition,
    spawnPosition: { readonly x: number; readonly y: number },
    currentFrame: number,
    EntityCtor: new (
      id: number,
      def: ItemDefinition,
      frame: number,
      pos: { readonly x: number; readonly y: number },
    ) => ItemEntity,
  ): ItemEntity {
    const id = this.nextId;
    this.nextId += 1;
    const entity = new EntityCtor(id, definition, currentFrame, spawnPosition);
    this.entities.push(entity);
    return entity;
  }

  /**
   * Per-tick housekeeping. Walks every active entity and asks
   * {@link ItemEntity.shouldDespawn}; flips state to `despawned` when
   * the predicate returns true. Returns the IDs of entities that
   * despawned this tick so the Phaser adapter layer can clean up
   * sprite / Matter handles.
   */
  tick(currentFrame: number): number[] {
    const despawned: number[] = [];
    for (const e of this.entities) {
      if (e.isDespawned()) continue;
      if (e.shouldDespawn(currentFrame)) {
        e.markDespawned(currentFrame);
        despawned.push(e.id);
      }
    }
    return despawned;
  }

  /** Drop every recorded entity (match-end / scene-shutdown hook). */
  reset(): void {
    this.entities.length = 0;
    this.nextId = 0;
  }
}
