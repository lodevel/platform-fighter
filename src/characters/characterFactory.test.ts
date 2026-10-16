import { describe, it, expect } from 'vitest';
import {
  applyCharacterMoveOverrides,
  createCharacterById,
  resolveSlotCharacterId,
} from './characterFactory';
import { parseCharacterDataFile } from './characterSerializer';
import { getAuthorableCharacterSpec } from './authorableCharacterRegistry';
import { Link } from './Link';
import { DonkeyKong } from './DonkeyKong';
import { Pikachu, PIKACHU_MOVES } from './Pikachu';
import { ContractFighter } from './contractFighter';
import { getFighterContract } from './fighterRegistry';
import { LINK_MOVES, DONKEYKONG_MOVES } from './roster';
import type { CharacterId, PlayerSlot } from '../types';

/**
 * AC 10005 Sub-AC 5 — "Build character select screen UI and wire
 * selection to instantiate the correct character with its moveset
 * in-match."
 *
 * The Character Select scene already exists and synthesises a
 * `MatchConfig.players[]` lineup containing each joined slot's
 * `characterId`. The factory under test is the glue that lets the
 * match runtime ask "given the slot picked Pikachu, what concrete
 * Character class do I instantiate?" without spreading switch
 * statements across every scene that spawns players.
 *
 * Test coverage matches the surfaces that AC depends on:
 *
 *   1. Each selectable character dispatches to its concrete subclass —
 *      selecting "donkeykong" must produce a DonkeyKong, "pikachu" a
 *      Pikachu, etc.
 *   2. The instantiated character carries the moveset declared in its
 *      spec — every contract attack slot plus the rest of the kit. This
 *      is the "with its moveset" half of the AC text.
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
  it.each([
    ['link', Link],
    ['donkeykong', DonkeyKong],
    ['pikachu', Pikachu],
  ] as const)('dispatches "%s" to its fighter class', (id, ctor) => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, id, { spawnX: 0, spawnY: 0 });
    expect(ch).toBeInstanceOf(ctor);
    expect(ch.id).toBe(id);
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
    const ch = createCharacterById(m.scene, 'donkeykong', {
      spawnX: 123,
      spawnY: 456,
    });
    expect(ch.getPosition()).toEqual({ x: 123, y: 456 });
  });

  it('forwards optional tuning overrides (mass / maxRunSpeed) to the subclass', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'donkeykong', {
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
   * Each subclass constructor registers every move in its `*_MOVES`
   * list. The factory has no extra wiring of its own — it just
   * dispatches — so any move present on the list must also be present
   * on the instance.
   */
  it.each([
    ['link' as CharacterId, LINK_MOVES],
    ['donkeykong' as CharacterId, DONKEYKONG_MOVES],
    ['pikachu' as CharacterId, PIKACHU_MOVES],
  ])(
    'instantiated %s carries the same move ids registered as its spec.moves',
    (id, expectedMoves) => {
      const m = createMockScene();
      const ch = createCharacterById(m.scene, id, {
        spawnX: 0,
        spawnY: 0,
      });
      // Probe the public surface — every spec move id must resolve
      // through the Character's `getAttack(id)` lookup.
      for (const expected of expectedMoves) {
        const registered = ch.getAttack(expected.id);
        expect(registered, `${id} must register move ${expected.id}`).toBeDefined();
        expect(registered?.id).toBe(expected.id);
      }
      // The list is exhaustive over the contract's attack slots, so a
      // regression that drops a slot move from the list is caught.
      const ids = expectedMoves.map((move) => move.id);
      const { moveset } = getFighterContract(id);
      for (const slot of ['jab', 'tilt', 'smash', 'fair', 'neutralSpecial', 'sideSpecial', 'upSpecial', 'downSpecial'] as const) {
        expect(ids, `${id}.${slot}`).toContain(moveset[slot].id);
      }
    },
  );
});

describe('applyCharacterMoveOverrides — character lab runtime bridge', () => {
  it.each(['link', 'donkeykong', 'pikachu'] as const)('an untuned %s draft preserves the complete live kit and body', id => {
    const m = createMockScene();
    const baseline = createCharacterById(m.scene, id, { spawnX: 0, spawnY: 0 });
    const spec = getAuthorableCharacterSpec(id);
    const ch = createCharacterById(m.scene, id, { spawnX: 0, spawnY: 0, ...spec.body, ...spec.movement });
    applyCharacterMoveOverrides(ch, spec);
    expect(ch.constructor).toBe(baseline.constructor);
    expect(ch.getTuning()).toEqual(baseline.getTuning());
    expect(ch.getGrabSpec()).toEqual(baseline.getGrabSpec());
    for (const [slot, move] of Object.entries(spec.moves!)) {
      if (slot === 'grab' || !move) continue;
      expect(ch.getAttack(move.id), move.id).toEqual(baseline.getAttack(move.id));
    }
  });

  it('a serialized Link tune changes air-jump and attack behavior while keeping the other moves and animation data', () => {
    const spec = getAuthorableCharacterSpec('link');
    const tuned = parseCharacterDataFile(JSON.parse(JSON.stringify({
      ...spec,
      // This fixture starts airborne; author that independent jump arc and
      // isolate its launch speed from the separate air-jump rise acceleration.
      movement: { ...spec.movement, airJumpImpulse: 17, airJumpRiseAccel: 0 },
      moves: { ...spec.moves, jab: { ...spec.moves!.jab, damage: 23 }, jab2: { ...spec.moves!.jab2, damage: 31 } },
    })));
    const m = createMockScene();
    const ch = createCharacterById(m.scene, tuned.id, { spawnX: 0, spawnY: 0, ...tuned.body, ...tuned.movement });
    applyCharacterMoveOverrides(ch, tuned);
    expect(ch).toBeInstanceOf(Link);
    if (!(ch instanceof Link)) throw new Error('Link tune spawned the wrong fighter class');
    expect(ch.isGrounded()).toBe(false);
    ch.applyInput({ moveX: 0, jump: true });
    expect(ch.getVelocity().y).toBe(-17);
    expect(ch.getTuning().airJumpImpulse).toBe(17);
    expect(ch.getTuning().airJumpRiseAccel).toBe(0);
    expect(ch.getTuning().jumpImpulse).toBe(spec.movement.jumpImpulse);
    expect(ch.getTuning().riseAccel).toBe(spec.movement.riseAccel);
    ch.setPosition(0, 0);
    expect(ch.executeJab()).toBe(true);
    expect(ch.getActiveAttack()?.move.damage).toBe(23);
    expect(ch.getAttack('link.jab2')?.damage).toBe(31);
    // Link's jab string is source-clocked, so his jab authors no `jabChain`.
    expect(spec.moves!.jab!.jabChain).toBeUndefined();
    expect((ch.getAttack('link.jab') as { jabChain?: unknown } | undefined)?.jabChain).toBeUndefined();
    expect(ch.getAttack('link.jab')).toMatchObject({ animation: spec.moves!.jab!.animation });
    expect(ch.getAttack('link.down_special')).toEqual(spec.moves!.downSpecial);
    expect(ch.getAttack('link.bair')).toEqual(spec.moves!.bair);
  });

  it.each(['jab', 'tilt', 'smash'] as const)('routes a saved %s with a new ID through the compiled fighter hook', slot => {
    const spec = getAuthorableCharacterSpec('donkeykong');
    const source = spec.moves![slot]!;
    const id = `authored.${slot}`;
    const parsed = parseCharacterDataFile(JSON.parse(JSON.stringify({ ...spec,
      moves: { [slot]: { ...source, id, damage: 23 } } })));
    for (const explicit of [false, true]) {
      const m = createMockScene();
      const ch = createCharacterById(m.scene, 'donkeykong', { spawnX: 0, spawnY: 0 });
      if (!(ch instanceof ContractFighter)) throw new Error('Wrong factory fighter');
      applyCharacterMoveOverrides(ch, parsed);
      const started = slot === 'jab' ? (explicit ? ch.executeJab(id) : ch.executeJab())
        : slot === 'tilt' ? (explicit ? ch.executeTilt(id) : ch.executeTilt())
        : (explicit ? ch.executeSmash(id) : ch.executeSmash());
      expect(started).toBe(true);
      expect(ch.getActiveAttack()?.move).toMatchObject({ id, damage: 23 });
    }
  });

  it('rejects a different fighter identity before changing the kit', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'link', { spawnX: 0, spawnY: 0 });
    const original = ch.getAttack('link.jab');
    expect(() => applyCharacterMoveOverrides(ch, getAuthorableCharacterSpec('donkeykong'))).toThrow(/does not match/);
    expect(ch.getAttack('link.jab')).toBe(original);
    expect(ch.getAttack('donkeykong.jab')).toBeUndefined();
  });

  it('replaces authored moves without dropping compiled moves omitted by the data file', () => {
    const m = createMockScene();
    const ch = createCharacterById(m.scene, 'donkeykong', { spawnX: 0, spawnY: 0 });
    const spec = getAuthorableCharacterSpec('donkeykong');
    // A data file that authors only the jab; every other compiled move stays.
    const tuned = { ...spec, moves: { jab: { ...spec.moves!.jab!, damage: 42 } } };
    const compiledNair = ch.getAttack('donkeykong.nair');
    expect(compiledNair).toBeDefined();
    applyCharacterMoveOverrides(ch, tuned);
    expect(ch.getAttack('donkeykong.jab')?.damage).toBe(42);
    expect(ch.getAttack('donkeykong.nair')).toBe(compiledNair);
  });
});

describe('resolveSlotCharacterId — slot-index lookup (not array position)', () => {
  it('returns the characterId of the matching slot index', () => {
    const players: PlayerSlot[] = [
      { index: 1, characterId: 'donkeykong', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'pikachu', paletteIndex: 1, inputType: 'keyboard_p2' },
    ];
    expect(resolveSlotCharacterId(players, 1, 'link')).toBe('donkeykong');
    expect(resolveSlotCharacterId(players, 2, 'link')).toBe('pikachu');
  });

  it('looks up by slot index, not by array position (P1 + P3 partial lobby)', () => {
    // Lobby produced "P1 joined as Link, P3 joined as Pikachu" — P2/P4
    // were never joined so they're absent from the array.
    const players: PlayerSlot[] = [
      { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 3, characterId: 'pikachu', paletteIndex: 2, inputType: 'gamepad' },
    ];
    expect(resolveSlotCharacterId(players, 1, 'donkeykong')).toBe('link');
    expect(resolveSlotCharacterId(players, 3, 'donkeykong')).toBe('pikachu');
    // P2 isn't in the array — fall back rather than mis-route P3 onto P2.
    expect(resolveSlotCharacterId(players, 2, 'donkeykong')).toBe('donkeykong');
    expect(resolveSlotCharacterId(players, 4, 'donkeykong')).toBe('donkeykong');
  });

  it('falls back when players is undefined (M1 dev-mode "press ENTER" path)', () => {
    expect(resolveSlotCharacterId(undefined, 1, 'donkeykong')).toBe('donkeykong');
    expect(resolveSlotCharacterId(undefined, 2, 'pikachu')).toBe('pikachu');
  });

  it('falls back when no slot matches', () => {
    const players: PlayerSlot[] = [
      { index: 1, characterId: 'link', paletteIndex: 0, inputType: 'keyboard_p1' },
    ];
    expect(resolveSlotCharacterId(players, 4, 'pikachu')).toBe('pikachu');
  });
});

describe('createCharacterById + resolveSlotCharacterId — end-to-end wiring', () => {
  it('a CharacterSelect-style lineup instantiates the correct subclass per slot', () => {
    // Simulates what `MatchScene.create()` does: read the lineup,
    // resolve each slot's characterId, and instantiate.
    const players: PlayerSlot[] = [
      { index: 1, characterId: 'pikachu', paletteIndex: 0, inputType: 'keyboard_p1' },
      { index: 2, characterId: 'link', paletteIndex: 1, inputType: 'keyboard_p2' },
    ];
    const m = createMockScene();
    const p1Id = resolveSlotCharacterId(players, 1, 'donkeykong');
    const p2Id = resolveSlotCharacterId(players, 2, 'donkeykong');
    const p1 = createCharacterById(m.scene, p1Id, { spawnX: 0, spawnY: 0 });
    const p2 = createCharacterById(m.scene, p2Id, { spawnX: 100, spawnY: 0 });
    expect(p1).toBeInstanceOf(Pikachu);
    expect(p2).toBeInstanceOf(Link);
  });

  it('an empty lineup falls back to the default (Donkey Kong + Pikachu) without throwing', () => {
    const m = createMockScene();
    const p1Id = resolveSlotCharacterId(undefined, 1, 'donkeykong');
    const p2Id = resolveSlotCharacterId(undefined, 2, 'pikachu');
    const p1 = createCharacterById(m.scene, p1Id, { spawnX: 0, spawnY: 0 });
    const p2 = createCharacterById(m.scene, p2Id, { spawnX: 100, spawnY: 0 });
    expect(p1).toBeInstanceOf(DonkeyKong);
    expect(p2).toBeInstanceOf(Pikachu);
  });
});
