import { describe, it, expect } from 'vitest';
import {
  AERIAL_SLOTS,
  MOVESET_ENTRIES,
  MOVESET_LIFECYCLE_RULES,
  MOVESET_SLOTS,
  MOVESET_TABLE,
  SPECIAL_SLOTS,
  enumerateAllMovesetAnimationKeys,
  enumerateMovesetSlotAnimationKeys,
  enumerateMovesetSlotAnimationStates,
  findMovesetSlot,
  getMovesetMove,
  resolveMovesetAnimationKey,
  resolveMovesetAnimationState,
} from './movesetAnimationDriver';
import { ANIMATED_MOVESET_IDS, ANIMATION_CANCEL_RULES, getIdleAnimationKey } from './animationState';
import { getMoveBusyFrames } from './moveSchema';
import type { CharacterId } from '../types';

/**
 * AC 10003 Sub-AC 3 — full-moveset animation driver tests.
 *
 * Locks down:
 *
 *   1. Slot taxonomy — exactly 10 slots per character
 *      (jab + tilt + smash + 3 aerials + 4 specials).
 *   2. Roster coverage — every slot is populated for every character.
 *   3. Animation key shape — `{characterId}.{movePartId}.{phase}.{frame}`
 *      mirrors the canonical contract from `animationState.ts`.
 *   4. Phase progression — keys advance startup → active → recovery →
 *      idle in lockstep with the gameplay state machine.
 *   5. Determinism — same inputs always produce the same key string
 *      across every (character × slot) combo.
 *   6. Cancel rule alignment — the same five canonical rules apply.
 *   7. Slot reverse-lookup — `findMovesetSlot` finds every slot from
 *      its move id and returns null on misses.
 */

const ALL_CHARACTERS: ReadonlyArray<CharacterId> = ANIMATED_MOVESET_IDS;

describe('AC 10003 Sub-AC 3 — full-moveset animation driver', () => {
  describe('Slot taxonomy', () => {
    it('exposes exactly 10 moveset slots: 3 grounded + 3 aerial + 4 special', () => {
      expect(MOVESET_SLOTS).toHaveLength(10);
      expect(MOVESET_SLOTS).toEqual([
        'jab',
        'tilt',
        'smash',
        'nair',
        'fair',
        'bair',
        'neutralSpecial',
        'sideSpecial',
        'upSpecial',
        'downSpecial',
      ]);
    });

    it('exposes 3 aerial slots in canonical order', () => {
      expect(AERIAL_SLOTS).toEqual(['nair', 'fair', 'bair']);
    });

    it('exposes 4 special slots in canonical neutral/side/up/down order', () => {
      expect(SPECIAL_SLOTS).toEqual([
        'neutralSpecial',
        'sideSpecial',
        'upSpecial',
        'downSpecial',
      ]);
    });

    it('all slot arrays are frozen', () => {
      expect(Object.isFrozen(MOVESET_SLOTS)).toBe(true);
      expect(Object.isFrozen(AERIAL_SLOTS)).toBe(true);
      expect(Object.isFrozen(SPECIAL_SLOTS)).toBe(true);
    });
  });

  describe('Roster coverage', () => {
    it('every roster character has all 10 slots populated', () => {
      for (const id of ALL_CHARACTERS) {
        const moveset = MOVESET_TABLE[id];
        for (const slot of MOVESET_SLOTS) {
          expect(moveset[slot]).toBeDefined();
          expect(moveset[slot].id).toMatch(/^[a-z]+\./);
        }
      }
    });

    it('flat MOVESET_ENTRIES has one entry per (animated character, slot)', () => {
      expect(MOVESET_ENTRIES).toHaveLength(ALL_CHARACTERS.length * MOVESET_SLOTS.length);
    });

    it('every entry carries a non-empty move id with the right character prefix', () => {
      for (const entry of MOVESET_ENTRIES) {
        expect(entry.move.id.startsWith(`${entry.characterId}.`)).toBe(true);
      }
    });

    it('getMovesetMove returns the same record as MOVESET_TABLE for every slot', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          expect(getMovesetMove(id, slot)).toBe(MOVESET_TABLE[id][slot]);
        }
      }
    });

    it('every move has an animation block authored', () => {
      for (const entry of MOVESET_ENTRIES) {
        expect(entry.move.animation).toBeDefined();
        expect(entry.move.animation!.startupFrames).toBeGreaterThanOrEqual(1);
        expect(entry.move.animation!.activeFrames).toBeGreaterThanOrEqual(1);
        expect(entry.move.animation!.recoveryFrames).toBeGreaterThanOrEqual(1);
      }
    });

    it('total art frames per move sit inside the UFD-sourced clip budget (3-12)', () => {
      for (const entry of MOVESET_ENTRIES) {
        const a = entry.move.animation!;
        const total = a.startupFrames + a.activeFrames + a.recoveryFrames;
        // Both animated fighters ship native-sampled clips: Link's short
        // jabs pack 3 drawings, Donkey Kong's clips go up to 12 cells
        // (clip-plan cap, DonkeyKong.test.ts).
        expect(total, `${entry.move.id} total art frames`).toBeGreaterThanOrEqual(3);
        expect(total, `${entry.move.id} total art frames`).toBeLessThanOrEqual(12);
      }
    });
  });

  describe('Animation key contract', () => {
    it('emits startup.0 on the press frame for every (character, slot)', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          const key = resolveMovesetAnimationKey(id, slot, 0);
          // movePartId is the bit after the leading '{characterId}.'
          const partId = move.id.slice(id.length + 1);
          expect(key).toBe(`${id}.${partId}.startup.0`);
        }
      }
    });

    it('emits idle key once the move has terminated', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          const busy = getMoveBusyFrames(move);
          const key = resolveMovesetAnimationKey(id, slot, busy);
          expect(key).toBe(getIdleAnimationKey(id));
        }
      }
    });

    it('progresses through startup → active → recovery → idle for a representative slot', () => {
      const move = MOVESET_TABLE.donkeykong.fair;

      const k0 = resolveMovesetAnimationKey('donkeykong', 'fair', 0);
      expect(k0).toMatch(/^donkeykong\.fair\.startup\.\d+$/);

      const kActive = resolveMovesetAnimationKey('donkeykong', 'fair', move.startupFrames);
      expect(kActive).toMatch(/^donkeykong\.fair\.active\.\d+$/);

      const kRecovery = resolveMovesetAnimationKey(
        'donkeykong',
        'fair',
        move.startupFrames + move.activeFrames,
      );
      expect(kRecovery).toMatch(/^donkeykong\.fair\.recovery\.\d+$/);

      const kIdle = resolveMovesetAnimationKey('donkeykong', 'fair', getMoveBusyFrames(move));
      expect(kIdle).toBe('donkeykong.idle');
    });
  });

  describe('Animation state resolution', () => {
    it('resolveMovesetAnimationState returns full AnimationState with correct facing', () => {
      const state = resolveMovesetAnimationState('link', 'sideSpecial', 0, -1);
      expect(state.characterId).toBe('link');
      expect(state.facing).toBe(-1);
      expect(state.phase).toBe('startup');
      expect(state.artFrameIndex).toBe(0);
      // movePartId is the bit after the 'link.' prefix.
      expect(state.key).toBe(`link.${state.movePartId}.startup.0`);
    });

    it('resolveMovesetAnimationState returns idle state once the move ends', () => {
      const move = MOVESET_TABLE.link.neutralSpecial;
      const state = resolveMovesetAnimationState(
        'link',
        'neutralSpecial',
        getMoveBusyFrames(move),
        1,
      );
      expect(state.phase).toBe('idle');
      expect(state.movePartId).toBeNull();
      expect(state.key).toBe('link.idle');
    });
  });

  describe('Enumeration helpers', () => {
    it('enumerateMovesetSlotAnimationKeys returns one key per art frame', () => {
      const move = MOVESET_TABLE.donkeykong.jab;
      const { startupFrames, activeFrames, recoveryFrames } = move.animation!;
      const keys = enumerateMovesetSlotAnimationKeys('donkeykong', 'jab');
      const part = move.id.slice('donkeykong.'.length);
      const expected = [
        ...Array.from({ length: startupFrames }, (_, i) => `donkeykong.${part}.startup.${i}`),
        ...Array.from({ length: activeFrames }, (_, i) => `donkeykong.${part}.active.${i}`),
        ...Array.from({ length: recoveryFrames }, (_, i) => `donkeykong.${part}.recovery.${i}`),
      ];
      expect(keys).toEqual(expected);
    });

    it('enumerateMovesetSlotAnimationStates produces busy+1 entries (lifecycle + idle tail)', () => {
      const move = MOVESET_TABLE.link.tilt;
      const busy = getMoveBusyFrames(move);
      const states = enumerateMovesetSlotAnimationStates('link', 'tilt', 1);
      expect(states).toHaveLength(busy + 1);
      const tail = states[states.length - 1]!;
      const head = states[0]!;
      // Last state is idle.
      expect(tail.phase).toBe('idle');
      expect(tail.key).toBe('link.idle');
      // First state is startup.0.
      expect(head.phase).toBe('startup');
      expect(head.artFrameIndex).toBe(0);
    });

    it('enumerateAllMovesetAnimationKeys covers every (character × slot) lifecycle plus per-character idle', () => {
      const all = enumerateAllMovesetAnimationKeys();
      // 7 idle keys (one per roster character) + sum of all per-slot
      // lifecycle keys.
      let expectedCount = ALL_CHARACTERS.length; // idle keys
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          expectedCount += enumerateMovesetSlotAnimationKeys(id, slot).length;
        }
      }
      expect(all).toHaveLength(expectedCount);
      // Idle keys for every character appear.
      for (const id of ALL_CHARACTERS) {
        expect(all).toContain(getIdleAnimationKey(id));
      }
    });

    it('enumerateAllMovesetAnimationKeys is deterministic across calls', () => {
      const a = enumerateAllMovesetAnimationKeys();
      const b = enumerateAllMovesetAnimationKeys();
      expect(a).toEqual(b);
    });

    it('all enumerated keys for a single slot are unique', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const keys = enumerateMovesetSlotAnimationKeys(id, slot);
          const set = new Set(keys);
          expect(set.size).toBe(keys.length);
        }
      }
    });
  });

  describe('Slot reverse-lookup', () => {
    it('finds every slot from its move id', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          expect(findMovesetSlot(id, move.id)).toBe(slot);
        }
      }
    });

    it('returns null for a move id that belongs to a different character', () => {
      expect(findMovesetSlot('donkeykong', MOVESET_TABLE.link.jab.id)).toBeNull();
    });

    it('returns null for an unknown move id', () => {
      expect(findMovesetSlot('donkeykong', 'nonexistent.move')).toBeNull();
    });
  });

  describe('Cancel rules', () => {
    it('exposes the same five canonical cancel rules as animationState.ts', () => {
      const ruleNames = MOVESET_LIFECYCLE_RULES.map((r) => r.rule).sort();
      const expected = ANIMATION_CANCEL_RULES.map((r) => r.rule).sort();
      expect(ruleNames).toEqual(expected);
    });

    it('every rule entry has a non-empty summary and enforcedBy field', () => {
      for (const r of MOVESET_LIFECYCLE_RULES) {
        expect(r.summary.length).toBeGreaterThan(0);
        expect(r.enforcedBy.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Determinism', () => {
    it('the same (character, slot, frame) tuple always produces the same key', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          for (const frame of [0, 1, 5, 10, 20]) {
            const a = resolveMovesetAnimationKey(id, slot, frame);
            const b = resolveMovesetAnimationKey(id, slot, frame);
            expect(a).toBe(b);
          }
        }
      }
    });

    it('the same (character, slot, frame, facing) tuple always produces the same state', () => {
      const a = resolveMovesetAnimationState('donkeykong', 'upSpecial', 4, 1);
      const b = resolveMovesetAnimationState('donkeykong', 'upSpecial', 4, 1);
      expect(a).toEqual(b);
    });
  });

  describe('Per-character coverage', () => {
    // For each character, assert the 10 named slots resolve to keys in the
    // expected character namespace and produce a forward phase progression.
    for (const id of ALL_CHARACTERS) {
      it(`${id} — every slot's startup.0 uses the ${id}. namespace`, () => {
        for (const slot of MOVESET_SLOTS) {
          const k = resolveMovesetAnimationKey(id, slot, 0);
          expect(k.startsWith(`${id}.`)).toBe(true);
        }
      });

      it(`${id} — every slot has a strictly forward phase progression`, () => {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          const startupKey = resolveMovesetAnimationKey(id, slot, 0);
          const activeKey = resolveMovesetAnimationKey(id, slot, move.startupFrames);
          const recoveryKey = resolveMovesetAnimationKey(
            id,
            slot,
            move.startupFrames + move.activeFrames,
          );
          expect(startupKey).toContain('.startup.');
          expect(activeKey).toContain('.active.');
          expect(recoveryKey).toContain('.recovery.');
        }
      });
    }
  });

  describe('No id overlap across characters', () => {
    it('each move id is unique across the entire roster (no two characters share an id)', () => {
      const ids = new Set<string>();
      for (const entry of MOVESET_ENTRIES) {
        expect(ids.has(entry.move.id)).toBe(false);
        ids.add(entry.move.id);
      }
    });
  });
});
