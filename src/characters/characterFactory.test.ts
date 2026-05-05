import { describe, it, expect } from 'vitest';
import {
  createCharacterById,
  resolveSlotCharacterId,
} from './characterFactory';
import { Wolf } from './Wolf';
import { Cat } from './Cat';
import { Owl } from './Owl';
import { Bear } from './Bear';
import {
  WOLF_MOVES,
  CAT_MOVES,
  OWL_MOVES,
  BEAR_MOVES,
} from './roster';
import type { CharacterId, PlayerSlot } from '../types';

/**
 * AC 10005 Sub-AC 5 — "Build character select screen UI and wire
 * selection to instantiate the correct character with its moveset
 * in-match."
 *
 * The Character Select scene already exists and synthesises a
 * `MatchConfig.players[]` lineup containing each joined slot's
 * `characterId`. The factory under test is the glue that lets the
 * match runtime ask "given the slot picked Bear, what concrete
 * Character class do I instantiate?" without spreading switch
 * statements across every scene that spawns players.
 *
 * Test coverage matches the surfaces that AC depends on:
 *
 *   1. Each of the 4 selectable characters dispatches to its concrete
 *      subclass — selecting "wolf" must produce a Wolf, "bear" a
 *      Bear, etc.
 *   2. The instantiated character carries the moveset declared in its
 *      spec — picking Wolf gives Wolf's full kit (jab + tilt + smash
 *      + 3 aerials + 4 specials), picking Bear gives Bear's. This is
 *      the "with its moveset" half of the AC text.
 *   3. The slot resolver picks `characterId` by *slot index* not by
 *      array position, so a 2-player match with P1 + P3 doesn't
 *      mis-route the lineup.
 *   4. A `null` / missing players array falls back to the supplied
 *      default (M1 dev-mode "press ENTER" path).
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
        /* no-op for factory tests */
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

describe('createCharacterById — dispatch by character id', () => {
  it('dispatches "wolf" to a Wolf instance', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'wolf', { spawnX: 0, spawnY: 0 });
    expect(ch).toBeInstanceOf(Wolf);
    expect(ch.id).toBe('wolf');
  });

  it('dispatches "cat" to a Cat instance', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'cat', { spawnX: 0, spawnY: 0 });
    expect(ch).toBeInstanceOf(Cat);
    expect(ch.id).toBe('cat');
  });

  it('dispatches "owl" to an Owl instance', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'owl', { spawnX: 0, spawnY: 0 });
    expect(ch).toBeInstanceOf(Owl);
    expect(ch.id).toBe('owl');
  });

  it('dispatches "bear" to a Bear instance', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'bear', { spawnX: 0, spawnY: 0 });
    expect(ch).toBeInstanceOf(Bear);
    expect(ch.id).toBe('bear');
  });

  it('throws on an unknown character id (defence-in-depth for stale replays)', () => {
    const m = createMockScene();
    expect(() =>
      createCharacterById(m.scene, 'lion' as CharacterId, {
        spawnX: 0,
        spawnY: 0,
      }),
    ).toThrow(/unknown characterId/);
  });

  it('forwards spawnX / spawnY to the subclass constructor', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'wolf', {
      spawnX: 123,
      spawnY: 456,
    });
    expect(ch.getPosition()).toEqual({ x: 123, y: 456 });
  });

  it('forwards optional tuning overrides (mass / maxRunSpeed) to the subclass', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'wolf', {
      spawnX: 0,
      spawnY: 0,
      mass: 99,
      maxRunSpeed: 1,
    });
    const t = ch.getTuning();
    expect(t.mass).toBe(99);
    expect(t.maxRunSpeed).toBe(1);
  });
});

describe('createCharacterById — moveset wiring (the "with its moveset" AC text)', () => {
  /**
   * The Seed's "4 characters with ~10 moves each" requirement bites
   * here: each subclass constructor calls `registerAttack(...)` on
   * every move in its `*_MOVES` array. After construction the
   * Character's internal moveset table must contain at least the
   * grounded triplet (jab / tilt / smash). The factory has no extra
   * wiring of its own — it just dispatches — so any moveset present
   * on the spec must also be present on the instance.
   */
  it.each([
    ['wolf' as CharacterId, WOLF_MOVES],
    ['cat' as CharacterId, CAT_MOVES],
    ['owl' as CharacterId, OWL_MOVES],
    ['bear' as CharacterId, BEAR_MOVES],
  ])(
    'instantiated %s carries the same move ids registered as its spec.moves',
    (id, expectedMoves) => {
      const m = createMockScene();
      const ch = createCharacterById(m.scene, id, {
        spawnX: 0,
        spawnY: 0,
      });
      // Probe the public surface — every spec move id must resolve
      // through the Character's `getAttack(id)` lookup. This proves
      // the registerAttack chain in each subclass constructor was
      // exercised by the factory dispatch.
      for (const expected of expectedMoves) {
        const registered = ch.getAttack(expected.id);
        expect(registered, `${id} must register move ${expected.id}`).toBeDefined();
        expect(registered?.id).toBe(expected.id);
      }
      // Roster is exhaustive — every character has all 10 slot
      // moves (jab / tilt / smash + 3 aerials + 4 specials). Lock
      // the count so a regression that drops a move to silently
      // skip registration is caught.
      expect(expectedMoves.length).toBe(10);
    },
  );
});

describe('resolveSlotCharacterId — slot-index lookup (not array position)', () => {
  it('returns the characterId of the matching slot index', () => {
    const players: PlayerSlot[] = [
      { index: 1, characterId: 'wolf', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'cat', paletteIndex: 1, inputType: 'keyboard_p2' },
    ];
    expect(resolveSlotCharacterId(players, 1, 'wolf')).toBe('wolf');
    expect(resolveSlotCharacterId(players, 2, 'cat')).toBe('cat');
  });

  it('looks up by slot index, not by array position (P1 + P3 partial lobby)', () => {
    // Lobby produced "P1 joined as Bear, P3 joined as Owl" — P2/P4
    // were never joined so they're absent from the array.
    const players: PlayerSlot[] = [
      { index: 1, characterId: 'bear', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 3, characterId: 'owl', paletteIndex: 2, inputType: 'gamepad' },
    ];
    expect(resolveSlotCharacterId(players, 1, 'wolf')).toBe('bear');
    expect(resolveSlotCharacterId(players, 3, 'wolf')).toBe('owl');
    // P2 isn't in the array — fall back rather than mis-route P3 onto P2.
    expect(resolveSlotCharacterId(players, 2, 'cat')).toBe('cat');
    expect(resolveSlotCharacterId(players, 4, 'wolf')).toBe('wolf');
  });

  it('falls back when players is undefined (M1 dev-mode "press ENTER" path)', () => {
    expect(resolveSlotCharacterId(undefined, 1, 'wolf')).toBe('wolf');
    expect(resolveSlotCharacterId(undefined, 2, 'cat')).toBe('cat');
  });

  it('falls back when no slot matches', () => {
    const players: PlayerSlot[] = [
      { index: 1, characterId: 'bear', paletteIndex: 0, inputType: 'keyboard_p1' },
    ];
    expect(resolveSlotCharacterId(players, 4, 'owl')).toBe('owl');
  });
});

describe('createCharacterById + resolveSlotCharacterId — end-to-end wiring', () => {
  it('a CharacterSelect-style lineup instantiates the correct subclass per slot', () => {
    // Simulates what `MatchScene.create()` will do: read the lineup,
    // resolve each slot's characterId, and instantiate.
    const players: PlayerSlot[] = [
      { index: 1, characterId: 'bear', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'owl', paletteIndex: 1, inputType: 'keyboard_p2' },
    ];
    const m = createMockScene();
    const p1Id = resolveSlotCharacterId(players, 1, 'wolf');
    const p2Id = resolveSlotCharacterId(players, 2, 'cat');
    const p1 = createCharacterById(m.scene, p1Id, { spawnX: 0, spawnY: 0 });
    const p2 = createCharacterById(m.scene, p2Id, { spawnX: 100, spawnY: 0 });
    expect(p1).toBeInstanceOf(Bear);
    expect(p2).toBeInstanceOf(Owl);
  });

  it('an empty lineup falls back to the M1 default (Wolf + Cat) without throwing', () => {
    const m = createMockScene();
    const p1Id = resolveSlotCharacterId(undefined, 1, 'wolf');
    const p2Id = resolveSlotCharacterId(undefined, 2, 'cat');
    const p1 = createCharacterById(m.scene, p1Id, { spawnX: 0, spawnY: 0 });
    const p2 = createCharacterById(m.scene, p2Id, { spawnX: 100, spawnY: 0 });
    expect(p1).toBeInstanceOf(Wolf);
    expect(p2).toBeInstanceOf(Cat);
  });
});
