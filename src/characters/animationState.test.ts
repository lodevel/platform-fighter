import { describe, it, expect } from 'vitest';
import {
  ANIMATION_CANCEL_RULES,
  IDLE_ANIMATION_SUFFIX,
  LIVE_ATTACK_PHASES,
  adaptCharacter,
  describeAnimationCancelRules,
  enumerateMoveAnimationKeys,
  getAnimationKey,
  getCurrentAnimation,
  getIdleAnimationKey,
  getMovePartId,
  getPostCancelAnimation,
  makeAnimationStateHooks,
  resolveAttackAnimation,
  type AnimatableCharacter,
  type AnimationState,
} from './animationState';
import {
  DonkeyKong,
  DONKEYKONG_JAB,
  DONKEYKONG_TILT,
  DONKEYKONG_SMASH,
} from './index';
import { advanceAttackState, getMoveBusyFrames } from './moveSchema';
import type { ActiveAttack } from './attacks';
import type { CharacterId } from '../types';

/**
 * AC 60003 Sub-AC 3 — animation state integration tests.
 *
 * What this suite locks down:
 *
 *   1. Animation key contract — `(characterId, moveId, phase, art-frame)`
 *      collapses to one canonical string shape; idle key is
 *      `'{characterId}.idle'`.
 *   2. Donkey Kong's grounded triplet (jab / tilt / smash) triggers correct
 *      animation keys on
 *      ground-attack inputs — covers the Sub-AC 3 acceptance.
 *   3. Phase transitions tied to startup / active / recovery frame
 *      counts — the live key flips from `*.startup.*` → `*.active.*` →
 *      `*.recovery.*` → `idle` at the exact frame boundaries.
 *   4. Cancel rules — all five named rules
 *      (hit / respawn / destroy / no-buffering / no-phase-rewind) are
 *      enumerated AND enforced.
 *   5. Pure determinism — same inputs always produce the same key
 *      string, and the hook factory translates schema events into
 *      character-aware AnimationState events without losing data.
 *
 * Mock-scene pattern mirrors `Character.test.ts` and `Roster.test.ts`
 * — no jsdom or Phaser bootstrap required.
 */

// ---------------------------------------------------------------------------
// Mock scene helpers (same pattern as the rest of the suite)
// ---------------------------------------------------------------------------

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

interface MockScene {
  bodies: MockBody[];
  removed: MockBody[];
  listeners: CollisionListener[];
  emit(event: 'collisionstart' | 'collisionend', pairs: unknown[]): void;
  scene: any;
}

function createMockScene(): MockScene {
  const bodies: MockBody[] = [];
  const removed: MockBody[] = [];
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
      setVelocity(body: MockBody, vec: { x: number; y: number }): void {
        body.velocity = { x: vec.x, y: vec.y };
      },
      setPosition(body: MockBody, vec: { x: number; y: number }): void {
        body.position = { x: vec.x, y: vec.y };
      },
      setInertia(): void {
        /* unused */
      },
    },
    world: {
      on(event: 'collisionstart' | 'collisionend', fn: CollisionListener['fn']): void {
        listeners.push({ event, fn });
      },
      off(event: 'collisionstart' | 'collisionend', fn: CollisionListener['fn']): void {
        const idx = listeners.findIndex((l) => l.event === event && l.fn === fn);
        if (idx >= 0) listeners.splice(idx, 1);
      },
      remove(body: MockBody): void {
        body.removed = true;
        removed.push(body);
      },
    },
  };

  const scene = { matter };

  return {
    bodies,
    removed,
    listeners,
    scene,
    emit(event, pairs) {
      for (const l of listeners.slice()) {
        if (l.event === event) {
          l.fn({ pairs });
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// getMovePartId
// ---------------------------------------------------------------------------

describe('getMovePartId', () => {
  it('strips the leading character namespace from a roster move id', () => {
    expect(getMovePartId('donkeykong.jab')).toBe('jab');
    expect(getMovePartId('link.tilt')).toBe('tilt');
    expect(getMovePartId('pikachu.smash')).toBe('smash');
  });

  it('returns the input unchanged when there is no namespace dot', () => {
    expect(getMovePartId('jab')).toBe('jab');
  });

  it('preserves trailing namespaced segments after the first dot', () => {
    // Forward-compat for moves like `'donkeykong.special.flash'`: only the
    // first dot is the character-namespace separator.
    expect(getMovePartId('donkeykong.special.flash')).toBe('special.flash');
  });
});

// ---------------------------------------------------------------------------
// Animation key shape
// ---------------------------------------------------------------------------

describe('getAnimationKey / getIdleAnimationKey', () => {
  it('produces the canonical {char}.{move}.{phase}.{frame} shape', () => {
    expect(getAnimationKey('donkeykong', 'donkeykong.jab', 'startup', 0)).toBe('donkeykong.jab.startup.0');
    expect(getAnimationKey('link', 'link.tilt', 'active', 1)).toBe('link.tilt.active.1');
    expect(getAnimationKey('pikachu', 'pikachu.smash', 'recovery', 3)).toBe('pikachu.smash.recovery.3');
  });

  it('uses the canonical idle suffix for the no-attack key', () => {
    for (const id of ['link', 'donkeykong', 'pikachu'] as const) {
      expect(getIdleAnimationKey(id)).toBe(`${id}.${IDLE_ANIMATION_SUFFIX}`);
    }
  });

  it('rejects negative or non-integer artFrameIndex', () => {
    expect(() => getAnimationKey('donkeykong', 'donkeykong.jab', 'startup', -1)).toThrow();
    expect(() => getAnimationKey('donkeykong', 'donkeykong.jab', 'startup', 1.5)).toThrow();
  });

  it('exposes the live phase set as a frozen array (no `done` leakage)', () => {
    expect(LIVE_ATTACK_PHASES).toEqual(['startup', 'active', 'recovery']);
    expect(Object.isFrozen(LIVE_ATTACK_PHASES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// enumerateMoveAnimationKeys
// ---------------------------------------------------------------------------

describe('enumerateMoveAnimationKeys', () => {
  it.each([
    ['jab', DONKEYKONG_JAB],
    ['tilt', DONKEYKONG_TILT],
    ['smash', DONKEYKONG_SMASH],
  ] as const)('expands the %s into one key per art frame in display order', (partId, move) => {
    const { startupFrames, activeFrames, recoveryFrames } = move.animation!;
    const keys = enumerateMoveAnimationKeys('donkeykong', move);
    const run = (phase: string, count: number) =>
      Array.from({ length: count }, (_, i) => `donkeykong.${partId}.${phase}.${i}`);
    expect(keys).toEqual([
      ...run('startup', startupFrames),
      ...run('active', activeFrames),
      ...run('recovery', recoveryFrames),
    ]);
  });
});

// ---------------------------------------------------------------------------
// resolveAttackAnimation — pure state mapping
// ---------------------------------------------------------------------------

describe('resolveAttackAnimation', () => {
  const move = DONKEYKONG_JAB;
  const busy = getMoveBusyFrames(move);

  it('returns the startup key on the press frame (frame 0)', () => {
    const state = resolveAttackAnimation('donkeykong', move, 0, 1);
    expect(state.key).toBe('donkeykong.jab.startup.0');
    expect(state.phase).toBe('startup');
    expect(state.movePartId).toBe('jab');
    expect(state.facing).toBe(1);
  });

  it('flips to the active phase at the startup→active boundary', () => {
    const before = resolveAttackAnimation('donkeykong', move, move.startupFrames - 1, 1);
    const after = resolveAttackAnimation('donkeykong', move, move.startupFrames, 1);
    expect(before.phase).toBe('startup');
    expect(after.phase).toBe('active');
    expect(after.key).toBe('donkeykong.jab.active.0');
  });

  it('flips to the recovery phase at the active→recovery boundary', () => {
    const firstRecovery = move.startupFrames + move.activeFrames;
    const before = resolveAttackAnimation('donkeykong', move, firstRecovery - 1, 1);
    const after = resolveAttackAnimation('donkeykong', move, firstRecovery, 1);
    expect(before.phase).toBe('active');
    expect(after.phase).toBe('recovery');
    expect(after.key).toBe('donkeykong.jab.recovery.0');
  });

  it('collapses to idle once the move terminates (recovery → done)', () => {
    const state = resolveAttackAnimation('donkeykong', move, busy, 1);
    expect(state.phase).toBe('idle');
    expect(state.key).toBe('donkeykong.idle');
    expect(state.movePartId).toBeNull();
  });

  it('reaches the last recovery art frame on the final busy frame', () => {
    const last = resolveAttackAnimation('donkeykong', move, busy - 1, 1);
    expect(last.phase).toBe('recovery');
    expect(last.key).toBe(`donkeykong.jab.recovery.${move.animation!.recoveryFrames - 1}`);
  });

  it('mirrors facing through the resolved state (locked-in by the gameplay layer)', () => {
    const left = resolveAttackAnimation('donkeykong', DONKEYKONG_SMASH, 5, -1);
    const right = resolveAttackAnimation('donkeykong', DONKEYKONG_SMASH, 5, 1);
    expect(left.facing).toBe(-1);
    expect(right.facing).toBe(1);
    expect(left.key).toBe(right.key); // facing is metadata, not part of the key
  });
});

// ---------------------------------------------------------------------------
// Per-character grounded-triplet end-to-end animation drive (Sub-AC 3 core
// acceptance — verify all 4 characters trigger correct animations on
// ground-attack inputs)
// ---------------------------------------------------------------------------

interface GroundedTripletCase {
  readonly characterId: CharacterId;
  readonly factory: (m: MockScene) => {
    body: MockBody;
    fighter: { applyInput: (i: any) => void; getCurrentAnimation: () => AnimationState; getActiveAttack: () => ActiveAttack | null };
  };
  readonly moves: ReadonlyArray<{ readonly partId: string; readonly attemptId: string; readonly busy: number; readonly startup: number }>;
}

function buildCases(): ReadonlyArray<GroundedTripletCase> {
  const moves = [DONKEYKONG_JAB, DONKEYKONG_TILT, DONKEYKONG_SMASH];
  return [
    {
      characterId: 'donkeykong',
      factory: (m) => {
        const ch = new DonkeyKong(m.scene as any, { spawnX: 100, spawnY: 100 });
        return { body: ch.body as unknown as MockBody, fighter: ch };
      },
      moves: moves.map((move) => ({
        partId: move.id.slice('donkeykong.'.length),
        attemptId: move.id,
        busy: getMoveBusyFrames(move),
        startup: move.startupFrames,
      })),
    },
  ];
}

describe('grounded-triplet animations (per-character end-to-end drive)', () => {
  for (const c of buildCases()) {
    describe(`${c.characterId}`, () => {
      it('emits the idle key before any attack press', () => {
        const m = createMockScene();
        const f = c.factory(m).fighter;
        expect(f.getCurrentAnimation().key).toBe(`${c.characterId}.idle`);
        expect(f.getCurrentAnimation().phase).toBe('idle');
      });

      for (const move of c.moves) {
        it(`drives ${move.partId} through startup → active → recovery → idle on a single press`, () => {
          const m = createMockScene();
          const built = c.factory(m);
          const ch = built.fighter as unknown as {
            attemptAttack: (id: string) => boolean;
            applyInput: (i: any) => void;
            getCurrentAnimation: () => AnimationState;
          };

          // Trigger the attack directly (decouples from the input
          // dispatcher's grounded-vs-air rules — this AC covers
          // animation state, not input routing).
          const ok = ch.attemptAttack(move.attemptId);
          expect(ok, `${move.attemptId} attempt`).toBe(true);

          // Frame 0 (press frame) — startup.0
          let state = ch.getCurrentAnimation();
          expect(state.phase).toBe('startup');
          expect(state.key).toBe(`${c.characterId}.${move.partId}.startup.0`);

          // Track the phase transitions across the full move duration.
          // We tick exactly `busy` frames so the move ends on the final
          // tick — anything longer should already be back to idle.
          const seenPhases = new Set<string>();
          seenPhases.add(state.phase);

          for (let i = 0; i < move.busy; i++) {
            ch.applyInput({ moveX: 0, jump: false });
            state = ch.getCurrentAnimation();
            seenPhases.add(state.phase);
          }

          // After the move's busy window, the active attack should be
          // null and the animation key should have flipped back to idle.
          expect(state.phase).toBe('idle');
          expect(state.key).toBe(`${c.characterId}.idle`);

          // Every live phase should have shown up somewhere along the way.
          expect(seenPhases.has('startup')).toBe(true);
          expect(seenPhases.has('active')).toBe(true);
          expect(seenPhases.has('recovery')).toBe(true);
          expect(seenPhases.has('idle')).toBe(true);
        });

        it(`flips ${move.partId} from startup to active at the right frame boundary`, () => {
          const m = createMockScene();
          const ch = c.factory(m).fighter as unknown as {
            attemptAttack: (id: string) => boolean;
            applyInput: (i: any) => void;
            getCurrentAnimation: () => AnimationState;
          };
          ch.attemptAttack(move.attemptId);

          // Walk the move forward one step at a time; record the FIRST
          // frame each phase appears on.
          const firstActiveFrame = (() => {
            let state = ch.getCurrentAnimation();
            // press frame is frame 0
            for (let f = 0; f < move.busy; f++) {
              if (state.phase === 'active') return f;
              ch.applyInput({ moveX: 0, jump: false });
              state = ch.getCurrentAnimation();
            }
            return -1;
          })();
          // The first active frame equals the move's startupFrames count
          // (frame 0 is the press; frame `startupFrames` is first active).
          expect(firstActiveFrame).toBe(move.startup);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Cancel rules (Sub-AC 3 acceptance: cancel rules)
// ---------------------------------------------------------------------------

describe('animation cancel rules', () => {
  it('enumerates all five named cancel rules', () => {
    const rules = describeAnimationCancelRules();
    expect(rules).toContain('hit-cancel');
    expect(rules).toContain('respawn-cancel');
    expect(rules).toContain('destroy-cancel');
    expect(rules).toContain('no-buffering');
    expect(rules).toContain('no-phase-rewind');
    expect(rules.length).toBe(5);
  });

  it('every cancel rule has a non-empty summary and an enforcedBy pointer', () => {
    for (const entry of ANIMATION_CANCEL_RULES) {
      expect(entry.summary.length).toBeGreaterThan(0);
      expect(entry.enforcedBy.length).toBeGreaterThan(0);
    }
  });

  it('hit-cancel: applyHit on a mid-attack fighter clears the active attack and flips animation to idle', () => {
    const m = createMockScene();
    const dk = new DonkeyKong(m.scene as any, { spawnX: 100, spawnY: 100 });
    dk.attemptAttack('donkeykong.jab');
    expect(dk.getCurrentAnimation().phase).toBe('startup');

    dk.applyHit({
      damage: 10,
      knockback: { x: 1, y: -1, scaling: 0.1 },
      facing: 1,
    });

    const post = dk.getCurrentAnimation();
    expect(post.phase).toBe('idle');
    expect(post.key).toBe('donkeykong.idle');
    expect(getPostCancelAnimation({
      id: dk.id,
      getFacing: () => dk.getFacing(),
      isDestroyed: () => false,
      getActiveAttack: () => dk.getActiveAttack(),
    })).toEqual(post);
  });

  it('respawn-cancel: setPosition on a mid-attack fighter cancels and returns to idle', () => {
    const m = createMockScene();
    const dk = new DonkeyKong(m.scene as any, { spawnX: 100, spawnY: 100 });
    dk.attemptAttack('donkeykong.tilt');
    expect(dk.getCurrentAnimation().phase).toBe('startup');

    dk.setPosition(500, 500);
    const post = dk.getCurrentAnimation();
    expect(post.phase).toBe('idle');
    expect(post.key).toBe('donkeykong.idle');
  });

  it('destroy-cancel: destroying a fighter clears the active attack and animation reads idle', () => {
    const m = createMockScene();
    const dk = new DonkeyKong(m.scene as any, { spawnX: 100, spawnY: 100 });
    dk.attemptAttack('donkeykong.smash');
    expect(dk.getCurrentAnimation().phase).toBe('startup');
    dk.destroy();
    const post = dk.getCurrentAnimation();
    expect(post.phase).toBe('idle');
    expect(post.key).toBe('donkeykong.idle');
  });

  it('no-buffering: a second press during an in-flight attack is dropped', () => {
    const m = createMockScene();
    const dk = new DonkeyKong(m.scene as any, { spawnX: 100, spawnY: 100 });
    dk.attemptAttack('donkeykong.tilt');
    const tiltAttack = dk.getActiveAttack();
    expect(tiltAttack?.move.id).toBe('donkeykong.tilt');

    // Try to start the smash while the tilt is still in flight.
    const accepted = dk.attemptAttack('donkeykong.smash');
    expect(accepted).toBe(false);

    // Animation key must still be on the tilt — no buffering.
    expect(dk.getCurrentAnimation().movePartId).toBe('tilt');
  });

  it('no-phase-rewind: art-frame index is monotonically non-decreasing across the live phase', () => {
    const m = createMockScene();
    const dk = new DonkeyKong(m.scene as any, { spawnX: 100, spawnY: 100 });
    dk.attemptAttack('donkeykong.smash');

    // Walk the move and record (phase, artFrameIndex) pairs.
    const samples: Array<{ phase: string; idx: number }> = [];
    samples.push({
      phase: dk.getCurrentAnimation().phase,
      idx: dk.getCurrentAnimation().artFrameIndex,
    });
    for (let i = 0; i < getMoveBusyFrames(DONKEYKONG_SMASH) + 1; i++) {
      dk.applyInput({ moveX: 0, jump: false });
      const s = dk.getCurrentAnimation();
      samples.push({ phase: s.phase, idx: s.artFrameIndex });
    }

    // Within each live phase, the art-frame index must never decrease.
    let lastPhase = samples[0]!.phase;
    let lastIdx = samples[0]!.idx;
    for (const s of samples.slice(1)) {
      if (s.phase === lastPhase && s.phase !== 'idle') {
        expect(s.idx).toBeGreaterThanOrEqual(lastIdx);
      }
      lastPhase = s.phase;
      lastIdx = s.idx;
    }

    // Phase progression must be strictly forward: startup → active →
    // recovery → idle. We compress consecutive duplicates and assert
    // the ordering matches the canonical chain.
    const compressed: string[] = [];
    for (const s of samples) {
      if (compressed.length === 0 || compressed[compressed.length - 1] !== s.phase) {
        compressed.push(s.phase);
      }
    }
    expect(compressed).toEqual(['startup', 'active', 'recovery', 'idle']);
  });
});

// ---------------------------------------------------------------------------
// Hook factory + integration with the schema's advanceAttackState
// ---------------------------------------------------------------------------

describe('makeAnimationStateHooks', () => {
  it('translates schema phase events into character-aware AnimationState events', () => {
    const phaseEnters: AnimationState[] = [];
    const moveEnds: CharacterId[] = [];
    const keyChanges: Array<[string, string]> = [];

    const hooks = makeAnimationStateHooks('donkeykong', {
      onPhaseEnter: (s) => phaseEnters.push(s),
      onMoveEnd: (id) => moveEnds.push(id),
      onAnimationKeyChange: (prev, next) => keyChanges.push([prev.key, next.key]),
    });

    // Drive the move via the schema's pure state machine.
    let frames = 0;
    const facing: 1 | -1 = 1;
    const move = DONKEYKONG_JAB;
    while (true) {
      const step = advanceAttackState('donkeykong', facing, move, frames, hooks);
      frames = step.framesElapsed;
      if (step.didEnd) break;
      if (frames > 500) throw new Error('runaway loop');
    }

    // Phase enters should have fired for active and recovery (startup is
    // entered on the press frame, before the first advance).
    const phasesSeen = phaseEnters.map((p) => p.phase);
    expect(phasesSeen).toContain('active');
    expect(phasesSeen).toContain('recovery');

    // Move end fires exactly once.
    expect(moveEnds).toEqual(['donkeykong']);

    // At least one key change pair should have flipped phases.
    const phaseFlips = keyChanges.filter(([prev, next]) => {
      const prevPhase = prev.split('.')[2];
      const nextPhase = next.split('.')[2];
      return prevPhase !== nextPhase;
    });
    expect(phaseFlips.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getCurrentAnimation — defensive idle fallback
// ---------------------------------------------------------------------------

describe('getCurrentAnimation defensive fallback', () => {
  it('returns the idle key when isDestroyed is true', () => {
    const stub: AnimatableCharacter = {
      id: 'donkeykong',
      getFacing: () => 1,
      isDestroyed: () => true,
      getActiveAttack: () => ({
        move: DONKEYKONG_JAB,
        facing: 1,
        framesElapsed: 2,
        phase: 'startup',
        hitboxBody: null,
      }),
    };
    expect(getCurrentAnimation(stub).key).toBe('donkeykong.idle');
  });

  it('returns the idle key when no active attack is in flight', () => {
    const stub: AnimatableCharacter = {
      id: 'link',
      getFacing: () => -1,
      getActiveAttack: () => null,
    };
    const state = getCurrentAnimation(stub);
    expect(state.key).toBe('link.idle');
    expect(state.facing).toBe(-1);
  });

  it('returns the live attack key when an attack is in flight', () => {
    const stub: AnimatableCharacter = {
      id: 'donkeykong',
      getFacing: () => 1,
      getActiveAttack: () => ({
        move: DONKEYKONG_SMASH,
        facing: -1,
        framesElapsed: DONKEYKONG_SMASH.startupFrames, // first active frame
        phase: 'active',
        hitboxBody: null,
      }),
    };
    const state = getCurrentAnimation(stub);
    expect(state.phase).toBe('active');
    expect(state.key).toBe('donkeykong.smash.active.0');
    // facing is locked-in from the active attack, not the live getFacing.
    expect(state.facing).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Adapter for live Character
// ---------------------------------------------------------------------------

describe('adaptCharacter', () => {
  it('produces an AnimatableCharacter that round-trips through getCurrentAnimation', () => {
    const m = createMockScene();
    const dk = new DonkeyKong(m.scene as any, { spawnX: 0, spawnY: 0 });
    dk.attemptAttack('donkeykong.smash');
    const adapted = adaptCharacter(dk);
    const state = getCurrentAnimation(adapted);
    expect(state.characterId).toBe('donkeykong');
    expect(state.movePartId).toBe('smash');
    expect(state.phase).toBe('startup');
    expect(state.key).toBe('donkeykong.smash.startup.0');
  });
});

// ---------------------------------------------------------------------------
// Determinism (replay-system requirement)
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces identical animation key sequences for two parallel runs of the same move', () => {
    const m1 = createMockScene();
    const m2 = createMockScene();
    const dk1 = new DonkeyKong(m1.scene as any, { spawnX: 0, spawnY: 0 });
    const dk2 = new DonkeyKong(m2.scene as any, { spawnX: 0, spawnY: 0 });

    dk1.attemptAttack('donkeykong.smash');
    dk2.attemptAttack('donkeykong.smash');

    const seq1: string[] = [];
    const seq2: string[] = [];
    for (let i = 0; i < getMoveBusyFrames(DONKEYKONG_SMASH) + 6; i++) {
      seq1.push(dk1.getCurrentAnimation().key);
      seq2.push(dk2.getCurrentAnimation().key);
      dk1.applyInput({ moveX: 0, jump: false });
      dk2.applyInput({ moveX: 0, jump: false });
    }
    expect(seq1).toEqual(seq2);
  });
});
