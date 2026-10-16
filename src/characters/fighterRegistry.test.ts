import { describe, it, expect } from 'vitest';

import {
  FIGHTER_REGISTRY,
  FIGHTER_REGISTRY_ENTRIES,
  FIGHTER_REGISTRY_IDS,
  getFighterConstructor,
  getFighterContract,
  getFighterRegistryEntry,
  instantiateFighter,
  isRegisteredFighterId,
} from './fighterRegistry';
import { Link, LINK_FIGHTER_CONTRACT } from './Link';
import { DonkeyKong, DONKEYKONG_FIGHTER_CONTRACT } from './DonkeyKong';
import { Pikachu, PIKACHU_FIGHTER_CONTRACT } from './Pikachu';
import { Character } from './Character';
import { MOVESET_SLOT_NAMES, assertFighterMoveset } from './movesetContract';
import type { CharacterId } from '../types';

/**
 * Sub-AC 3 of the T2 per-fighter refactor track — fighter registry tests.
 *
 * The registry is the single source of truth that maps a `CharacterId`
 * onto its concrete per-fighter subclass + frozen `FighterContract`.
 * Both `createCharacterById` (the canonical match-runtime dispatcher) and
 * `Fighter.defaultCharacterFactory` (the per-player entity wrapper)
 * delegate dispatch through this module — these tests lock down the
 * invariants those call sites rely on:
 *
 *   1. Every entry in the `CharacterId` union is registered (no silent
 *      drop-out for a roster slot).
 *   2. Each entry's `ctor` is the right concrete per-fighter class.
 *   3. Each entry's `contract` is the right frozen `*_FIGHTER_CONTRACT`.
 *   4. `instantiateFighter` produces a `Character`-typed instance whose
 *      runtime identity matches the entry's `id`.
 *   5. The dispatch path is fail-loud on an unknown id.
 *   6. The 10-slot moveset contract is satisfied by every registered
 *      fighter's `contract.moveset` (regression guard for any future
 *      author who appends an entry that omits a slot).
 *
 * Same MockScene pattern as the rest of `src/characters/*.test.ts` —
 * Phaser-free under plain Node.
 */

interface MockBody {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  label: string | undefined;
  options: Record<string, unknown>;
  removed: boolean;
}

interface CollisionListener {
  event: 'collisionstart' | 'collisionend';
  fn: (e: { pairs: unknown[] }) => void;
}

function createMockScene(): { scene: any; bodies: MockBody[] } {
  const bodies: MockBody[] = [];
  const listeners: CollisionListener[] = [];
  const matter = {
    add: {
      rectangle(
        x: number,
        y: number,
        w: number,
        h: number,
        options: Record<string, unknown>,
      ): MockBody {
        const body: MockBody = {
          position: { x, y },
          velocity: { x: 0, y: 0 },
          label: options['label'] as string | undefined,
          options: { ...options, _w: w, _h: h },
          removed: false,
        };
        bodies.push(body);
        return body;
      },
    },
    body: {
      setVelocity(b: MockBody, v: { x: number; y: number }): void {
        b.velocity = { x: v.x, y: v.y };
      },
      setPosition(b: MockBody, v: { x: number; y: number }): void {
        b.position = { x: v.x, y: v.y };
      },
      setInertia(_b: MockBody, _i: number): void {
        /* no-op for registry tests */
      },
    },
    world: {
      on(
        event: 'collisionstart' | 'collisionend',
        fn: CollisionListener['fn'],
      ): void {
        listeners.push({ event, fn });
      },
      off(
        event: 'collisionstart' | 'collisionend',
        fn: CollisionListener['fn'],
      ): void {
        const idx = listeners.findIndex(
          (l) => l.event === event && l.fn === fn,
        );
        if (idx >= 0) listeners.splice(idx, 1);
      },
      remove(b: MockBody): void {
        b.removed = true;
      },
    },
  };
  return { scene: { matter }, bodies };
}

describe('FIGHTER_REGISTRY — completeness and structure', () => {
  it('has one entry per CharacterId union member (link / donkeykong / pikachu)', () => {
    expect(Object.keys(FIGHTER_REGISTRY).sort()).toEqual(['donkeykong', 'link', 'pikachu']);
  });

  it('FIGHTER_REGISTRY_IDS is the canonical roster authoring order', () => {
    expect(FIGHTER_REGISTRY_IDS).toEqual(['link', 'donkeykong', 'pikachu']);
  });

  it('FIGHTER_REGISTRY_ENTRIES is the same order as FIGHTER_REGISTRY_IDS', () => {
    expect(FIGHTER_REGISTRY_ENTRIES.map((e) => e.id)).toEqual(
      FIGHTER_REGISTRY_IDS,
    );
  });

  it('each entry has a non-null id / ctor / contract triple', () => {
    for (const entry of FIGHTER_REGISTRY_ENTRIES) {
      expect(entry.id).toBeDefined();
      expect(typeof entry.ctor).toBe('function');
      expect(entry.contract).toBeDefined();
      expect(entry.contract.id).toBe(entry.id);
    }
  });

  it('each entry references the right concrete per-fighter class', () => {
    expect(FIGHTER_REGISTRY.link.ctor).toBe(Link);
    expect(FIGHTER_REGISTRY.donkeykong.ctor).toBe(DonkeyKong);
    expect(FIGHTER_REGISTRY.pikachu.ctor).toBe(Pikachu);
  });

  it('each entry references the right frozen *_FIGHTER_CONTRACT', () => {
    expect(FIGHTER_REGISTRY.link.contract).toBe(LINK_FIGHTER_CONTRACT);
    expect(FIGHTER_REGISTRY.donkeykong.contract).toBe(DONKEYKONG_FIGHTER_CONTRACT);
    expect(FIGHTER_REGISTRY.pikachu.contract).toBe(PIKACHU_FIGHTER_CONTRACT);
  });

  it('FIGHTER_REGISTRY is frozen at module load (open-closed extension surface)', () => {
    expect(Object.isFrozen(FIGHTER_REGISTRY)).toBe(true);
    for (const entry of FIGHTER_REGISTRY_ENTRIES) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });
});

describe('getFighterRegistryEntry / getFighterConstructor / getFighterContract', () => {
  it('getFighterRegistryEntry returns the exact entry from FIGHTER_REGISTRY', () => {
    for (const id of FIGHTER_REGISTRY_IDS) {
      expect(getFighterRegistryEntry(id)).toBe(FIGHTER_REGISTRY[id]);
    }
  });

  it('getFighterConstructor returns the per-fighter class', () => {
    expect(getFighterConstructor('link')).toBe(Link);
    expect(getFighterConstructor('donkeykong')).toBe(DonkeyKong);
    expect(getFighterConstructor('pikachu')).toBe(Pikachu);
  });

  it('getFighterContract returns the per-fighter FighterContract', () => {
    expect(getFighterContract('link')).toBe(LINK_FIGHTER_CONTRACT);
    expect(getFighterContract('donkeykong')).toBe(DONKEYKONG_FIGHTER_CONTRACT);
    expect(getFighterContract('pikachu')).toBe(PIKACHU_FIGHTER_CONTRACT);
  });

  it('throws fail-loud on an unknown id (corrupted MatchConfig defence)', () => {
    expect(() =>
      getFighterRegistryEntry('lion' as CharacterId),
    ).toThrow(/unknown characterId/);
  });
});

describe('isRegisteredFighterId — type-guard for unverified strings', () => {
  it('returns true for every registered id', () => {
    for (const id of FIGHTER_REGISTRY_IDS) {
      expect(isRegisteredFighterId(id)).toBe(true);
    }
  });

  it('returns false for an unknown string', () => {
    expect(isRegisteredFighterId('lion')).toBe(false);
    expect(isRegisteredFighterId('')).toBe(false);
    expect(isRegisteredFighterId('Pikachu')).toBe(false); // case-sensitive
    expect(isRegisteredFighterId('wolf')).toBe(false); // removed fighter
  });
});

describe('instantiateFighter — registry-mediated construction', () => {
  it('produces the right concrete subclass for every id', () => {
    const m = createMockScene();
    expect(instantiateFighter(m.scene, 'link', { spawnX: 0, spawnY: 0 })).toBeInstanceOf(Link);
    expect(instantiateFighter(m.scene, 'donkeykong', { spawnX: 0, spawnY: 0 })).toBeInstanceOf(DonkeyKong);
    expect(instantiateFighter(m.scene, 'pikachu', { spawnX: 0, spawnY: 0 })).toBeInstanceOf(Pikachu);
  });

  it('returned instance is a Character (the runtime selects in place of the base)', () => {
    const m = createMockScene();
    for (const id of FIGHTER_REGISTRY_IDS) {
      const fighter = instantiateFighter(m.scene, id, { spawnX: 0, spawnY: 0 });
      expect(fighter).toBeInstanceOf(Character);
      expect(fighter.id).toBe(id);
    }
  });

  it('forwards spawnX / spawnY to the subclass constructor', () => {
    const m = createMockScene();
    const fighter = instantiateFighter(m.scene, 'donkeykong', {
      spawnX: 321,
      spawnY: 654,
    });
    expect(fighter.getPosition()).toEqual({ x: 321, y: 654 });
  });

  it('forwards tuning overrides (mass / maxRunSpeed) to the subclass', () => {
    const m = createMockScene();
    const fighter = instantiateFighter(m.scene, 'donkeykong', {
      spawnX: 0,
      spawnY: 0,
      mass: 99,
      maxRunSpeed: 1.5,
    });
    const tuning = fighter.getTuning();
    expect(tuning.mass).toBe(99);
    expect(tuning.maxRunSpeed).toBe(1.5);
  });

  it('throws on an unknown id (fail-loud parity with the legacy switch)', () => {
    const m = createMockScene();
    expect(() =>
      instantiateFighter(m.scene, 'lion' as CharacterId, {
        spawnX: 0,
        spawnY: 0,
      }),
    ).toThrow(/unknown characterId/);
  });
});

describe('FighterContract integrity — every registered contract is uniform', () => {
  it('every registered contract satisfies the canonical 10-slot moveset', () => {
    for (const entry of FIGHTER_REGISTRY_ENTRIES) {
      expect(() =>
        assertFighterMoveset(entry.id, entry.contract.moveset),
      ).not.toThrow();
      // Spot-check that every canonical slot is present.
      for (const slot of MOVESET_SLOT_NAMES) {
        expect(entry.contract.moveset[slot]).toBeDefined();
      }
    }
  });

  it('every registered contract has a movement profile with sane numeric fields', () => {
    for (const entry of FIGHTER_REGISTRY_ENTRIES) {
      const mp = entry.contract.movementProfile;
      expect(Number.isFinite(mp.maxRunSpeed) && mp.maxRunSpeed > 0).toBe(true);
      expect(Number.isFinite(mp.jumpImpulse) && mp.jumpImpulse > 0).toBe(true);
      expect(Number.isInteger(mp.maxJumps) && mp.maxJumps >= 1).toBe(true);
      expect(Number.isFinite(mp.mass) && mp.mass > 0).toBe(true);
    }
  });
});

describe('Behaviour preservation — the registry path matches the per-class path', () => {
  /**
   * Sub-AC 3 invariant: the registry-mediated dispatch must produce
   * fighters that are byte-for-byte indistinguishable from the
   * pre-registry `new DonkeyKong(scene, opts)` direct instantiation. This
   * test invokes both paths back-to-back on the same scene and checks
   * that the resulting Characters expose identical id / position /
   * tuning surfaces — the runtime contract every downstream consumer
   * (HUD, AI, replay) depends on.
   */
  it('produces fighters with the same id / position / tuning as direct construction', () => {
    const directScene = createMockScene();
    const registryScene = createMockScene();

    const direct = new DonkeyKong(directScene.scene, { spawnX: 50, spawnY: 100 });
    const viaRegistry = instantiateFighter(registryScene.scene, 'donkeykong', {
      spawnX: 50,
      spawnY: 100,
    });
    expect(viaRegistry).toBeInstanceOf(DonkeyKong);
    expect(viaRegistry.id).toBe(direct.id);
    expect(viaRegistry.getPosition()).toEqual(direct.getPosition());
    expect(viaRegistry.getTuning().mass).toBe(direct.getTuning().mass);
    expect(viaRegistry.getTuning().maxRunSpeed).toBe(
      direct.getTuning().maxRunSpeed,
    );
  });

  it('every registered fighter, instantiated via the registry, registers its full moveset', () => {
    // The "with its moveset" half of AC 10005 Sub-AC 5 — preserved
    // under the registry refactor. Every move id authored on the
    // per-fighter contract must resolve through `getAttack` after
    // registry-mediated construction. Proves the registry path
    // exercises each subclass's `registerAttack` chain identically to
    // the direct `new Subclass(...)` call.
    for (const entry of FIGHTER_REGISTRY_ENTRIES) {
      const m = createMockScene();
      const fighter = instantiateFighter(m.scene, entry.id, {
        spawnX: 0,
        spawnY: 0,
      });
      // Walk the contract's attack slots — each must be retrievable
      // off the live Character via the move id stored on the contract.
      for (const slot of [
        'jab',
        'tilt',
        'smash',
        'fair',
        'neutralSpecial',
        'sideSpecial',
        'upSpecial',
        'downSpecial',
      ] as const) {
        const expected = entry.contract.moveset[slot];
        const registered = fighter.getAttack(expected.id);
        expect(
          registered,
          `${entry.id}.${slot} (${expected.id}) must be registered`,
        ).toBeDefined();
        expect(registered?.id).toBe(expected.id);
      }
    }
  });
});
