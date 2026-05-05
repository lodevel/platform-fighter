import { describe, it, expect } from 'vitest';
import type { CharacterId } from '../types';
import {
  CHARACTER_MOVESET_ANIMATION_CUES,
  MOVESET_ANIMATION_CUE_BUNDLES,
  enumerateAllMovesetAnimationCueKeys,
  getCharacterMovesetAnimationCues,
  getMoveAnimationCueAt,
  getMoveAnimationCueBundle,
} from './movesetAnimationCues';
import { MOVESET_SLOTS, MOVESET_TABLE } from './movesetAnimationDriver';
import { getIdleAnimationKey, enumerateMoveAnimationKeys } from './animationState';
import {
  computeAttackPhase,
  getMoveBusyFrames,
  selectAnimationFrame,
} from './moveSchema';
import { getSpriteAnimationKey } from './spriteAnimationDriver';

/**
 * AC 20004 Sub-AC 4 — moveset animation cue catalog.
 *
 * Locks down the integrated cue surface across all 4 roster characters:
 *
 *   1. Roster coverage — every character has an idle key, a movement
 *      key bundle, and a per-slot move cue bundle.
 *   2. Symbolic key contract — keys match `enumerateMoveAnimationKeys`
 *      / `getAnimationKey` exactly (no contract drift, no new keys).
 *   3. Lifecycle correctness — per-frame cue list mirrors what
 *      `selectAnimationFrame` / `computeAttackPhase` produce on the live
 *      gameplay state machine.
 *   4. Sprite-key fallback — Cat/Wolf get real movement anim keys
 *      (`{id}.idle.anim`, …), Owl/Bear stay `null` per the procedural
 *      fallback contract.
 *   5. Determinism — same character + slot + frame returns the same
 *      cue every call; the catalog is frozen at module load.
 */

const ALL_CHARACTERS: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear'];
const ART_BACKED: ReadonlyArray<CharacterId> = ['wolf', 'cat', 'owl', 'bear'];
const PROCEDURAL: ReadonlyArray<CharacterId> = [];

describe('AC 20004 Sub-AC 4 — moveset animation cue catalog', () => {
  describe('Roster coverage', () => {
    it('exposes a cue bundle for every roster character', () => {
      for (const id of ALL_CHARACTERS) {
        expect(CHARACTER_MOVESET_ANIMATION_CUES[id]).toBeDefined();
        const cues = getCharacterMovesetAnimationCues(id);
        expect(cues.characterId).toBe(id);
      }
    });

    it('every character cue bundle and movement bundle is frozen', () => {
      for (const id of ALL_CHARACTERS) {
        const cues = CHARACTER_MOVESET_ANIMATION_CUES[id];
        expect(Object.isFrozen(cues)).toBe(true);
        expect(Object.isFrozen(cues.movementKeys)).toBe(true);
        expect(Object.isFrozen(cues.moves)).toBe(true);
      }
      expect(Object.isFrozen(CHARACTER_MOVESET_ANIMATION_CUES)).toBe(true);
    });

    it('exposes 10 move cue bundles per character', () => {
      for (const id of ALL_CHARACTERS) {
        const cues = CHARACTER_MOVESET_ANIMATION_CUES[id];
        for (const slot of MOVESET_SLOTS) {
          expect(cues.moves[slot]).toBeDefined();
          expect(cues.moves[slot].slot).toBe(slot);
          expect(cues.moves[slot].characterId).toBe(id);
        }
      }
    });

    it('flat MOVESET_ANIMATION_CUE_BUNDLES has 40 entries (4 × 10)', () => {
      expect(MOVESET_ANIMATION_CUE_BUNDLES).toHaveLength(40);
    });

    it('every cue bundle is frozen', () => {
      for (const bundle of MOVESET_ANIMATION_CUE_BUNDLES) {
        expect(Object.isFrozen(bundle)).toBe(true);
        expect(Object.isFrozen(bundle.lifecycleCues)).toBe(true);
        expect(Object.isFrozen(bundle.lifecycleKeys)).toBe(true);
        expect(Object.isFrozen(bundle.artFrameKeys)).toBe(true);
        expect(Object.isFrozen(bundle.phaseFrames)).toBe(true);
        expect(Object.isFrozen(bundle.artFrames)).toBe(true);
      }
    });
  });

  describe('Idle keys', () => {
    it('matches getIdleAnimationKey for every character', () => {
      for (const id of ALL_CHARACTERS) {
        const cues = CHARACTER_MOVESET_ANIMATION_CUES[id];
        expect(cues.idleKey).toBe(getIdleAnimationKey(id));
        expect(cues.idleKey).toBe(`${id}.idle`);
      }
    });
  });

  describe('Movement keys (sprite anim)', () => {
    it('Cat and Wolf have all movement keys populated', () => {
      for (const id of ART_BACKED) {
        const m = CHARACTER_MOVESET_ANIMATION_CUES[id].movementKeys;
        expect(m.idle).toBe(`${id}.idle.anim`);
        expect(m.run).toBe(`${id}.run.anim`);
        expect(m.jump).toBe(`${id}.jump.anim`);
        // Fall collapses onto the jump sheet in the M1 art delivery.
        expect(m.fall).toBe(`${id}.jump.anim`);
        // Hurt collapses onto the idle sheet.
        expect(m.hurt).toBe(`${id}.idle.anim`);
      }
    });

    it('Owl and Bear (no source sheet) get null movement keys', () => {
      for (const id of PROCEDURAL) {
        const m = CHARACTER_MOVESET_ANIMATION_CUES[id].movementKeys;
        expect(m.idle).toBeNull();
        expect(m.run).toBeNull();
        expect(m.jump).toBeNull();
        expect(m.fall).toBeNull();
        expect(m.hurt).toBeNull();
      }
    });

    it('mirrors getSpriteAnimationKey exactly for every (character, state)', () => {
      for (const id of ALL_CHARACTERS) {
        const m = CHARACTER_MOVESET_ANIMATION_CUES[id].movementKeys;
        expect(m.idle).toBe(getSpriteAnimationKey(id, 'idle'));
        expect(m.run).toBe(getSpriteAnimationKey(id, 'run'));
        expect(m.jump).toBe(getSpriteAnimationKey(id, 'jump'));
        expect(m.fall).toBe(getSpriteAnimationKey(id, 'fall'));
        expect(m.hurt).toBe(getSpriteAnimationKey(id, 'hurt'));
      }
    });
  });

  describe('Per-move cue lifecycle', () => {
    it('lifecycle cue list length equals getMoveBusyFrames(move)', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          const bundle = CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot];
          expect(bundle.lifecycleCues).toHaveLength(getMoveBusyFrames(move));
          expect(bundle.lifecycleKeys).toHaveLength(getMoveBusyFrames(move));
        }
      }
    });

    it('per-frame cue mirrors selectAnimationFrame + computeAttackPhase', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          const bundle = CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot];
          for (let f = 0; f < getMoveBusyFrames(move); f++) {
            const sel = selectAnimationFrame(f, move);
            const phase = computeAttackPhase(f, move);
            const cue = bundle.lifecycleCues[f]!;
            expect(cue.framesElapsed).toBe(f);
            expect(cue.phase).toBe(phase);
            expect(cue.artFrameIndex).toBe(sel.artFrameIndex);
            expect(cue.key).toContain(`.${phase}.`);
          }
        }
      }
    });

    it('lifecycle keys progress startup → active → recovery', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          const bundle = CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot];
          // First key starts in startup.
          expect(bundle.lifecycleKeys[0]).toContain('.startup.0');
          // Frame at the start of active is the first active key.
          const activeStart = bundle.lifecycleKeys[move.startupFrames]!;
          expect(activeStart).toContain('.active.');
          // Frame at the start of recovery is the first recovery key.
          const recoveryStart =
            bundle.lifecycleKeys[move.startupFrames + move.activeFrames]!;
          expect(recoveryStart).toContain('.recovery.');
        }
      }
    });

    it('artFrameKeys deduped + matches enumerateMoveAnimationKeys', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          const bundle = CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot];
          const expected = enumerateMoveAnimationKeys(id, move);
          expect(bundle.artFrameKeys).toEqual(expected);
          // Unique entries — every art-frame key is distinct.
          expect(new Set(bundle.artFrameKeys).size).toBe(
            bundle.artFrameKeys.length,
          );
        }
      }
    });

    it('artFrameTotal matches sum of art frames per phase (≥ 3 per move)', () => {
      for (const bundle of MOVESET_ANIMATION_CUE_BUNDLES) {
        const sum =
          bundle.artFrames.startup +
          bundle.artFrames.active +
          bundle.artFrames.recovery;
        expect(bundle.artFrameTotal).toBe(sum);
        expect(bundle.artFrameTotal).toBeGreaterThanOrEqual(3);
      }
    });

    it('phaseFrames mirrors authored startup/active/recovery exactly', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          const move = MOVESET_TABLE[id][slot];
          const bundle = CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot];
          expect(bundle.phaseFrames.startup).toBe(move.startupFrames);
          expect(bundle.phaseFrames.active).toBe(move.activeFrames);
          expect(bundle.phaseFrames.recovery).toBe(move.recoveryFrames);
        }
      }
    });

    it('moveId + movePartId are coherent', () => {
      for (const bundle of MOVESET_ANIMATION_CUE_BUNDLES) {
        expect(bundle.moveId.startsWith(`${bundle.characterId}.`)).toBe(true);
        expect(bundle.moveId).toBe(
          `${bundle.characterId}.${bundle.movePartId}`,
        );
      }
    });
  });

  describe('attackSpriteKey fallback', () => {
    it('Cat and Wolf yield a real `{id}.attack.anim` key', () => {
      for (const id of ART_BACKED) {
        for (const slot of MOVESET_SLOTS) {
          const bundle = CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot];
          expect(bundle.attackSpriteKey).toBe(`${id}.attack.anim`);
        }
      }
    });

    it('Owl and Bear yield null (no source sheet)', () => {
      for (const id of PROCEDURAL) {
        for (const slot of MOVESET_SLOTS) {
          const bundle = CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot];
          expect(bundle.attackSpriteKey).toBeNull();
        }
      }
    });
  });

  describe('getMoveAnimationCueAt', () => {
    it('returns the lifecycle cue for valid frame indices', () => {
      const bundle = CHARACTER_MOVESET_ANIMATION_CUES.wolf.moves.fair;
      const cue = getMoveAnimationCueAt('wolf', 'fair', 0);
      expect(cue).not.toBeNull();
      expect(cue!.key).toBe(bundle.lifecycleKeys[0]);
      expect(cue!.framesElapsed).toBe(0);
      expect(cue!.phase).toBe('startup');
    });

    it('returns null past the move busy window', () => {
      const move = MOVESET_TABLE.cat.tilt;
      const busy = getMoveBusyFrames(move);
      expect(getMoveAnimationCueAt('cat', 'tilt', busy)).toBeNull();
      expect(getMoveAnimationCueAt('cat', 'tilt', busy + 5)).toBeNull();
    });

    it('returns null for negative frame indices', () => {
      expect(getMoveAnimationCueAt('bear', 'jab', -1)).toBeNull();
    });
  });

  describe('getMoveAnimationCueBundle', () => {
    it('returns the same frozen reference as the catalog', () => {
      for (const id of ALL_CHARACTERS) {
        for (const slot of MOVESET_SLOTS) {
          expect(getMoveAnimationCueBundle(id, slot)).toBe(
            CHARACTER_MOVESET_ANIMATION_CUES[id].moves[slot],
          );
        }
      }
    });
  });

  describe('enumerateAllMovesetAnimationCueKeys', () => {
    it('contains the idle key for every character', () => {
      const keys = enumerateAllMovesetAnimationCueKeys();
      for (const id of ALL_CHARACTERS) {
        expect(keys).toContain(getIdleAnimationKey(id));
      }
    });

    it('contains every move\'s art-frame keys', () => {
      const keys = enumerateAllMovesetAnimationCueKeys();
      for (const bundle of MOVESET_ANIMATION_CUE_BUNDLES) {
        for (const k of bundle.artFrameKeys) {
          expect(keys).toContain(k);
        }
      }
    });

    it('contains the movement anim keys for art-backed characters only', () => {
      const keys = enumerateAllMovesetAnimationCueKeys();
      for (const id of ART_BACKED) {
        expect(keys).toContain(`${id}.idle.anim`);
        expect(keys).toContain(`${id}.run.anim`);
        expect(keys).toContain(`${id}.jump.anim`);
        expect(keys).toContain(`${id}.attack.anim`);
      }
      // No `.anim` keys leak in for owl/bear.
      for (const id of PROCEDURAL) {
        for (const sheet of ['idle', 'run', 'jump', 'attack']) {
          expect(keys).not.toContain(`${id}.${sheet}.anim`);
        }
      }
    });

    it('is deterministic across calls', () => {
      const a = enumerateAllMovesetAnimationCueKeys();
      const b = enumerateAllMovesetAnimationCueKeys();
      expect(a).toEqual(b);
    });
  });

  describe('Determinism', () => {
    it('same accessor call returns the same frozen reference', () => {
      const a = getCharacterMovesetAnimationCues('owl');
      const b = getCharacterMovesetAnimationCues('owl');
      expect(a).toBe(b);
    });

    it('same (character, slot, frame) tuple returns the same cue value', () => {
      const a = getMoveAnimationCueAt('cat', 'sideSpecial', 3);
      const b = getMoveAnimationCueAt('cat', 'sideSpecial', 3);
      expect(a).toEqual(b);
    });
  });
});
