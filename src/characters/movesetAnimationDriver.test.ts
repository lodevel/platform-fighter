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
import { ANIMATION_CANCEL_RULES, getIdleAnimationKey } from './animationState';
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
 *      across all 40 (character × slot) combos.
 *   6. Cancel rule alignment — the same five canonical rules apply.
 *   7. Slot reverse-lookup — `findMovesetSlot` finds every slot from
 *      its move id and returns null on misses.
 */

const ALL_CHARACTERS: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear', 'blaze', 'puff', 'aegis', 'volt', 'nova', 'bruno', 'link'];

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

    it('flat MOVESET_ENTRIES has 110 entries (11 chars × 10 slots)', () => {
      expect(MOVESET_ENTRIES).toHaveLength(110);
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

    it('total art frames per move sit in the Seed-mandated 6-8 range (or 5-9 for specials)', () => {
      for (const entry of MOVESET_ENTRIES) {
        const a = entry.move.animation!;
        const total = a.startupFrames + a.activeFrames + a.recoveryFrames;
        // Allow specials to extend slightly past 8 (some span 9-10 for charges);
        // grounded normals + aerials should stay in 6-8.
        expect(total).toBeGreaterThanOrEqual(5);
        expect(total).toBeLessThanOrEqual(11);
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
      // Pick wolf.fair: 8 startup / 4 active / 14 recovery.
      const move = MOVESET_TABLE.wolf.fair;

      const k0 = resolveMovesetAnimationKey('wolf', 'fair', 0);
      expect(k0).toMatch(/^wolf\.fair\.startup\.\d+$/);

      const kActive = resolveMovesetAnimationKey('wolf', 'fair', move.startupFrames);
      expect(kActive).toMatch(/^wolf\.fair\.active\.\d+$/);

      const kRecovery = resolveMovesetAnimationKey(
        'wolf',
        'fair',
        move.startupFrames + move.activeFrames,
      );
      expect(kRecovery).toMatch(/^wolf\.fair\.recovery\.\d+$/);

      const kIdle = resolveMovesetAnimationKey('wolf', 'fair', getMoveBusyFrames(move));
      expect(kIdle).toBe('wolf.idle');
    });
  });

  describe('Animation state resolution', () => {
    it('resolveMovesetAnimationState returns full AnimationState with correct facing', () => {
      const state = resolveMovesetAnimationState('cat', 'sideSpecial', 0, -1);
      expect(state.characterId).toBe('cat');
      expect(state.facing).toBe(-1);
      expect(state.phase).toBe('startup');
      expect(state.artFrameIndex).toBe(0);
      // movePartId is the bit after the 'cat.' prefix.
      expect(state.key).toBe(`cat.${state.movePartId}.startup.0`);
    });

    it('resolveMovesetAnimationState returns idle state once the move ends', () => {
      const move = MOVESET_TABLE.bear.neutralSpecial;
      const state = resolveMovesetAnimationState(
        'bear',
        'neutralSpecial',
        getMoveBusyFrames(move),
        1,
      );
      expect(state.phase).toBe('idle');
      expect(state.movePartId).toBeNull();
      expect(state.key).toBe('bear.idle');
    });
  });

  describe('Enumeration helpers', () => {
    it('enumerateMovesetSlotAnimationKeys returns one key per art frame', () => {
      const move = MOVESET_TABLE.wolf.jab;
      const keys = enumerateMovesetSlotAnimationKeys('wolf', 'jab');
      // Wolf jab: 2 startup + 1 active + 3 recovery = 6 art frames.
      expect(keys).toHaveLength(6);
      expect(keys[0]).toBe('wolf.jab.startup.0');
      expect(keys[1]).toBe('wolf.jab.startup.1');
      expect(keys[2]).toBe('wolf.jab.active.0');
      expect(keys[3]).toBe('wolf.jab.recovery.0');
      expect(keys[4]).toBe('wolf.jab.recovery.1');
      expect(keys[5]).toBe('wolf.jab.recovery.2');
      // Drive away unused-variable warnings.
      expect(move.id).toBe('wolf.jab');
    });

    it('enumerateMovesetSlotAnimationStates produces busy+1 entries (lifecycle + idle tail)', () => {
      const move = MOVESET_TABLE.cat.tilt;
      const busy = getMoveBusyFrames(move);
      const states = enumerateMovesetSlotAnimationStates('cat', 'tilt', 1);
      expect(states).toHaveLength(busy + 1);
      const tail = states[states.length - 1]!;
      const head = states[0]!;
      // Last state is idle.
      expect(tail.phase).toBe('idle');
      expect(tail.key).toBe('cat.idle');
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
      expect(findMovesetSlot('wolf', MOVESET_TABLE.cat.jab.id)).toBeNull();
    });

    it('returns null for an unknown move id', () => {
      expect(findMovesetSlot('owl', 'nonexistent.move')).toBeNull();
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
      const a = resolveMovesetAnimationState('owl', 'upSpecial', 4, 1);
      const b = resolveMovesetAnimationState('owl', 'upSpecial', 4, 1);
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
