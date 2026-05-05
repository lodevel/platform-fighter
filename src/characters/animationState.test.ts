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
  Bear,
  BEAR_JAB,
  BEAR_TILT,
  BEAR_SMASH,
  Cat,
  CAT_JAB,
  CAT_TILT,
  CAT_SMASH,
  Owl,
  OWL_JAB,
  OWL_TILT,
  OWL_SMASH,
  Wolf,
  WOLF_JAB,
  WOLF_TILT,
  WOLF_SMASH,
} from './index';
import { advanceAttackState } from './moveSchema';
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
 *   2. All 4 roster characters (Wolf, Cat, Owl, Bear) trigger correct
 *      animation keys for their grounded triplet (jab / tilt / smash) on
 *      ground-attack inputs — covers the Sub-AC 3 acceptance verbatim.
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
    expect(getMovePartId('wolf.jab')).toBe('jab');
    expect(getMovePartId('cat.tilt')).toBe('tilt');
    expect(getMovePartId('owl.smash')).toBe('smash');
    expect(getMovePartId('bear.jab')).toBe('jab');
  });

  it('returns the input unchanged when there is no namespace dot', () => {
    expect(getMovePartId('jab')).toBe('jab');
  });

  it('preserves trailing namespaced segments after the first dot', () => {
    // Forward-compat for moves like `'wolf.special.flash'`: only the
    // first dot is the character-namespace separator.
    expect(getMovePartId('wolf.special.flash')).toBe('special.flash');
  });
});

// ---------------------------------------------------------------------------
// Animation key shape
// ---------------------------------------------------------------------------

describe('getAnimationKey / getIdleAnimationKey', () => {
  it('produces the canonical {char}.{move}.{phase}.{frame} shape', () => {
    expect(getAnimationKey('wolf', 'wolf.jab', 'startup', 0)).toBe('wolf.jab.startup.0');
    expect(getAnimationKey('cat', 'cat.tilt', 'active', 1)).toBe('cat.tilt.active.1');
    expect(getAnimationKey('owl', 'owl.smash', 'recovery', 3)).toBe('owl.smash.recovery.3');
    expect(getAnimationKey('bear', 'bear.jab', 'recovery', 2)).toBe('bear.jab.recovery.2');
  });

  it('uses the canonical idle suffix for the no-attack key', () => {
    for (const id of ['wolf', 'cat', 'owl', 'bear'] as const) {
      expect(getIdleAnimationKey(id)).toBe(`${id}.${IDLE_ANIMATION_SUFFIX}`);
    }
  });

  it('rejects negative or non-integer artFrameIndex', () => {
    expect(() => getAnimationKey('wolf', 'wolf.jab', 'startup', -1)).toThrow();
    expect(() => getAnimationKey('wolf', 'wolf.jab', 'startup', 1.5)).toThrow();
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
  it('expands a 6-frame jab into the full key sequence in display order', () => {
    const keys = enumerateMoveAnimationKeys('wolf', WOLF_JAB);
    expect(keys).toEqual([
      'wolf.jab.startup.0',
      'wolf.jab.startup.1',
      'wolf.jab.active.0',
      'wolf.jab.recovery.0',
      'wolf.jab.recovery.1',
      'wolf.jab.recovery.2',
    ]);
  });

  it('expands a 7-frame tilt into the full key sequence', () => {
    const keys = enumerateMoveAnimationKeys('cat', CAT_TILT);
    expect(keys).toEqual([
      'cat.tilt.startup.0',
      'cat.tilt.startup.1',
      'cat.tilt.active.0',
      'cat.tilt.active.1',
      'cat.tilt.recovery.0',
      'cat.tilt.recovery.1',
      'cat.tilt.recovery.2',
    ]);
  });

  it('expands an 8-frame smash into the full key sequence', () => {
    const keys = enumerateMoveAnimationKeys('owl', OWL_SMASH);
    expect(keys).toEqual([
      'owl.smash.startup.0',
      'owl.smash.startup.1',
      'owl.smash.startup.2',
      'owl.smash.active.0',
      'owl.smash.recovery.0',
      'owl.smash.recovery.1',
      'owl.smash.recovery.2',
      'owl.smash.recovery.3',
    ]);
  });

  it('honours the Seed 6-8 art frames per move constraint for every grounded move', () => {
    const movesByChar: Array<[CharacterId, ReadonlyArray<typeof WOLF_JAB>]> = [
      ['wolf', [WOLF_JAB, WOLF_TILT, WOLF_SMASH]],
      ['cat', [CAT_JAB, CAT_TILT, CAT_SMASH]],
      ['owl', [OWL_JAB, OWL_TILT, OWL_SMASH]],
      ['bear', [BEAR_JAB, BEAR_TILT, BEAR_SMASH]],
    ];
    for (const [id, moves] of movesByChar) {
      for (const move of moves) {
        const keys = enumerateMoveAnimationKeys(id, move);
        expect(keys.length, `${id} ${move.id} key count`).toBeGreaterThanOrEqual(6);
        expect(keys.length, `${id} ${move.id} key count`).toBeLessThanOrEqual(8);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// resolveAttackAnimation — pure state mapping
// ---------------------------------------------------------------------------

describe('resolveAttackAnimation', () => {
  it('returns the startup key on the press frame (frame 0)', () => {
    const state = resolveAttackAnimation('wolf', WOLF_JAB, 0, 1);
    expect(state.key).toBe('wolf.jab.startup.0');
    expect(state.phase).toBe('startup');
    expect(state.movePartId).toBe('jab');
    expect(state.facing).toBe(1);
  });

  it('flips to the active phase at the startup→active boundary', () => {
    // WOLF_JAB: 4 startup frames → frame 4 is the first 'active' frame.
    const before = resolveAttackAnimation('wolf', WOLF_JAB, 3, 1);
    const after = resolveAttackAnimation('wolf', WOLF_JAB, 4, 1);
    expect(before.phase).toBe('startup');
    expect(after.phase).toBe('active');
    expect(after.key).toBe('wolf.jab.active.0');
  });

  it('flips to the recovery phase at the active→recovery boundary', () => {
    // WOLF_JAB: startup 4 + active 3 = frame 7 is the first recovery frame.
    const before = resolveAttackAnimation('wolf', WOLF_JAB, 6, 1);
    const after = resolveAttackAnimation('wolf', WOLF_JAB, 7, 1);
    expect(before.phase).toBe('active');
    expect(after.phase).toBe('recovery');
    expect(after.key).toBe('wolf.jab.recovery.0');
  });

  it('collapses to idle once the move terminates (recovery → done)', () => {
    // WOLF_JAB: 4 + 3 + 9 = 16 busy frames → frame 16 is 'done'.
    const state = resolveAttackAnimation('wolf', WOLF_JAB, 16, 1);
    expect(state.phase).toBe('idle');
    expect(state.key).toBe('wolf.idle');
    expect(state.movePartId).toBeNull();
  });

  it('advances art-frame index across a phase that has multiple art frames', () => {
    // CAT_TILT recovery: 9 gameplay frames stretched over 3 art frames →
    // art 0 covers gameplay [8..10], art 1 covers [11..13], art 2 [14..16].
    const r0 = resolveAttackAnimation('cat', CAT_TILT, 8, 1);
    const r1 = resolveAttackAnimation('cat', CAT_TILT, 12, 1);
    const r2 = resolveAttackAnimation('cat', CAT_TILT, 16, 1);
    expect(r0.key).toBe('cat.tilt.recovery.0');
    expect(r1.key).toBe('cat.tilt.recovery.1');
    expect(r2.key).toBe('cat.tilt.recovery.2');
  });

  it('mirrors facing through the resolved state (locked-in by the gameplay layer)', () => {
    const left = resolveAttackAnimation('bear', BEAR_SMASH, 5, -1);
    const right = resolveAttackAnimation('bear', BEAR_SMASH, 5, 1);
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
  readonly moves: ReadonlyArray<{ readonly partId: string; readonly attemptId: string; readonly busy: number }>;
}

function buildCases(): ReadonlyArray<GroundedTripletCase> {
  return [
    {
      characterId: 'wolf',
      factory: (m) => {
        const ch = new Wolf(m.scene as any, { spawnX: 100, spawnY: 100 });
        return { body: ch.body as unknown as MockBody, fighter: ch };
      },
      moves: [
        { partId: 'jab', attemptId: 'wolf.jab', busy: 4 + 3 + 9 },
        { partId: 'tilt', attemptId: 'wolf.tilt', busy: 7 + 4 + 12 },
        { partId: 'smash', attemptId: 'wolf.smash', busy: 12 + 4 + 18 },
      ],
    },
    {
      characterId: 'cat',
      factory: (m) => {
        const ch = new Cat(m.scene as any, { spawnX: 100, spawnY: 100 });
        return { body: ch.body as unknown as MockBody, fighter: ch };
      },
      moves: [
        { partId: 'jab', attemptId: 'cat.jab', busy: 2 + 2 + 5 },
        { partId: 'tilt', attemptId: 'cat.tilt', busy: 5 + 3 + 9 },
        { partId: 'smash', attemptId: 'cat.smash', busy: 8 + 3 + 14 },
      ],
    },
    {
      characterId: 'owl',
      factory: (m) => {
        const ch = new Owl(m.scene as any, { spawnX: 100, spawnY: 100 });
        return { body: ch.body as unknown as MockBody, fighter: ch };
      },
      moves: [
        { partId: 'jab', attemptId: 'owl.jab', busy: 3 + 2 + 5 },
        { partId: 'tilt', attemptId: 'owl.tilt', busy: 6 + 4 + 11 },
        { partId: 'smash', attemptId: 'owl.smash', busy: 10 + 4 + 16 },
      ],
    },
    {
      characterId: 'bear',
      factory: (m) => {
        const ch = new Bear(m.scene as any, { spawnX: 100, spawnY: 100 });
        return { body: ch.body as unknown as MockBody, fighter: ch };
      },
      moves: [
        { partId: 'jab', attemptId: 'bear.jab', busy: 5 + 3 + 9 },
        { partId: 'tilt', attemptId: 'bear.tilt', busy: 8 + 4 + 13 },
        { partId: 'smash', attemptId: 'bear.smash', busy: 14 + 4 + 19 },
      ],
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
            getActiveAttack: () => ActiveAttack | null;
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
          // The first active frame should equal the move's startupFrames
          // count (frame 0 is press; frame `startupFrames` is first active).
          const move0 = ch.getActiveAttack()?.move ?? null;
          // Active is 'null' here because the move ended; reach for the
          // declared startup count via the attempt id table:
          const declared = c.moves.find((mv) => mv.attemptId === move.attemptId)!;
          expect(firstActiveFrame).toBeGreaterThanOrEqual(0);
          // For moves like wolf.jab: startup=4 → active appears at f=4.
          expect(firstActiveFrame).toBe(
            declared.busy === 16 ? 4 // wolf.jab
              : declared.busy === 23 ? 7 // wolf.tilt
              : declared.busy === 34 ? 12 // wolf.smash
              : declared.busy === 9 ? 2 // cat.jab
              : declared.busy === 17 ? 5 // cat.tilt
              : declared.busy === 25 ? 8 // cat.smash
              : declared.busy === 10 ? 3 // owl.jab
              : declared.busy === 21 ? 6 // owl.tilt
              : declared.busy === 30 ? 10 // owl.smash
              : declared.busy === 17 && c.characterId === 'bear' ? 5 // bear.jab
              : declared.busy === 25 && c.characterId === 'bear' ? 8 // bear.tilt
              : declared.busy === 37 ? 14 // bear.smash
              : -999,
          );
          // Make sure the void reference is consumed (TS unused-warning).
          void move0;
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
    const wolf = new Wolf(m.scene as any, { spawnX: 100, spawnY: 100 });
    wolf.attemptAttack('wolf.jab');
    expect(wolf.getCurrentAnimation().phase).toBe('startup');

    wolf.applyHit({
      damage: 10,
      knockback: { x: 1, y: -1, scaling: 0.1 },
      facing: 1,
    });

    const post = wolf.getCurrentAnimation();
    expect(post.phase).toBe('idle');
    expect(post.key).toBe('wolf.idle');
    expect(getPostCancelAnimation({
      id: wolf.id,
      getFacing: () => wolf.getFacing(),
      isDestroyed: () => false,
      getActiveAttack: () => wolf.getActiveAttack(),
    })).toEqual(post);
  });

  it('respawn-cancel: setPosition on a mid-attack fighter cancels and returns to idle', () => {
    const m = createMockScene();
    const cat = new Cat(m.scene as any, { spawnX: 100, spawnY: 100 });
    cat.attemptAttack('cat.tilt');
    expect(cat.getCurrentAnimation().phase).toBe('startup');

    cat.setPosition(500, 500);
    const post = cat.getCurrentAnimation();
    expect(post.phase).toBe('idle');
    expect(post.key).toBe('cat.idle');
  });

  it('destroy-cancel: destroying a fighter clears the active attack and animation reads idle', () => {
    const m = createMockScene();
    const owl = new Owl(m.scene as any, { spawnX: 100, spawnY: 100 });
    owl.attemptAttack('owl.smash');
    expect(owl.getCurrentAnimation().phase).toBe('startup');
    owl.destroy();
    const post = owl.getCurrentAnimation();
    expect(post.phase).toBe('idle');
    expect(post.key).toBe('owl.idle');
  });

  it('no-buffering: a second press during an in-flight attack is dropped', () => {
    const m = createMockScene();
    const bear = new Bear(m.scene as any, { spawnX: 100, spawnY: 100 });
    bear.attemptAttack('bear.tilt');
    const tiltAttack = bear.getActiveAttack();
    expect(tiltAttack?.move.id).toBe('bear.tilt');

    // Try to start the smash while the tilt is still in flight.
    const accepted = bear.attemptAttack('bear.smash');
    expect(accepted).toBe(false);

    // Animation key must still be on the tilt — no buffering.
    expect(bear.getCurrentAnimation().movePartId).toBe('tilt');
  });

  it('no-phase-rewind: art-frame index is monotonically non-decreasing across the live phase', () => {
    const m = createMockScene();
    const wolf = new Wolf(m.scene as any, { spawnX: 100, spawnY: 100 });
    wolf.attemptAttack('wolf.smash');

    // Walk the move and record (phase, artFrameIndex) pairs.
    const samples: Array<{ phase: string; idx: number }> = [];
    samples.push({
      phase: wolf.getCurrentAnimation().phase,
      idx: wolf.getCurrentAnimation().artFrameIndex,
    });
    for (let i = 0; i < 35; i++) {
      wolf.applyInput({ moveX: 0, jump: false });
      const s = wolf.getCurrentAnimation();
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

    const hooks = makeAnimationStateHooks('wolf', {
      onPhaseEnter: (s) => phaseEnters.push(s),
      onMoveEnd: (id) => moveEnds.push(id),
      onAnimationKeyChange: (prev, next) => keyChanges.push([prev.key, next.key]),
    });

    // Drive the move via the schema's pure state machine.
    let frames = 0;
    const facing: 1 | -1 = 1;
    const move = WOLF_JAB;
    while (true) {
      const step = advanceAttackState('wolf', facing, move, frames, hooks);
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
    expect(moveEnds).toEqual(['wolf']);

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
      id: 'wolf',
      getFacing: () => 1,
      isDestroyed: () => true,
      getActiveAttack: () => ({
        move: WOLF_JAB,
        facing: 1,
        framesElapsed: 2,
        phase: 'startup',
        hitboxBody: null,
      }),
    };
    expect(getCurrentAnimation(stub).key).toBe('wolf.idle');
  });

  it('returns the idle key when no active attack is in flight', () => {
    const stub: AnimatableCharacter = {
      id: 'cat',
      getFacing: () => -1,
      getActiveAttack: () => null,
    };
    const state = getCurrentAnimation(stub);
    expect(state.key).toBe('cat.idle');
    expect(state.facing).toBe(-1);
  });

  it('returns the live attack key when an attack is in flight', () => {
    const stub: AnimatableCharacter = {
      id: 'bear',
      getFacing: () => 1,
      getActiveAttack: () => ({
        move: BEAR_SMASH,
        facing: -1,
        framesElapsed: 14, // first active frame (startup=14)
        phase: 'active',
        hitboxBody: null,
      }),
    };
    const state = getCurrentAnimation(stub);
    expect(state.phase).toBe('active');
    expect(state.key).toBe('bear.smash.active.0');
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
    const cat = new Cat(m.scene as any, { spawnX: 0, spawnY: 0 });
    cat.attemptAttack('cat.smash');
    const adapted = adaptCharacter(cat);
    const state = getCurrentAnimation(adapted);
    expect(state.characterId).toBe('cat');
    expect(state.movePartId).toBe('smash');
    expect(state.phase).toBe('startup');
    expect(state.key).toBe('cat.smash.startup.0');
  });
});

// ---------------------------------------------------------------------------
// Determinism (replay-system requirement)
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('produces identical animation key sequences for two parallel runs of the same move', () => {
    const m1 = createMockScene();
    const m2 = createMockScene();
    const wolf1 = new Wolf(m1.scene as any, { spawnX: 0, spawnY: 0 });
    const wolf2 = new Wolf(m2.scene as any, { spawnX: 0, spawnY: 0 });

    wolf1.attemptAttack('wolf.smash');
    wolf2.attemptAttack('wolf.smash');

    const seq1: string[] = [];
    const seq2: string[] = [];
    for (let i = 0; i < 40; i++) {
      seq1.push(wolf1.getCurrentAnimation().key);
      seq2.push(wolf2.getCurrentAnimation().key);
      wolf1.applyInput({ moveX: 0, jump: false });
      wolf2.applyInput({ moveX: 0, jump: false });
    }
    expect(seq1).toEqual(seq2);
  });
});
