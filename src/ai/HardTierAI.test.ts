/**
 * HardTierAI test suite — AC 10204 Sub-AC 4.
 *
 * Locks down the full Hard-tier composition:
 *
 *   1. Fast reactions — reads through the 15–20 frame delay buffer;
 *      warm-up window holds neutral; post-warm-up the bot decides off
 *      a delayed (not live) snapshot.
 *   2. Combo awareness — `registerLandedHit` populates the offensive
 *      blackboard; the next decision picks the combo follow-up branch
 *      and presses the planned attack.
 *   3. Edge-guarding — when the bot is on stage and the opponent is
 *      off-stage, the bot anchors at the threatened ledge and presses
 *      the appropriate finisher.
 *   4. Predictive opponent tracking — when the opponent is moving, the
 *      offensive sub-tree's PredictiveMoveLeaf closes the gap based on
 *      lookahead-projected position, not the live distance.
 *   5. Recovery — when the bot is off-stage and airborne, the recovery
 *      sub-tree wins priority and emits the correct recovery presses.
 *   6. Determinism — two providers seeded identically and fed the same
 *      perception stream produce identical input streams.
 *   7. Snapshot / restore — the controller round-trips through its
 *      snapshot type with no observable change in subsequent decisions.
 *   8. Verb translation — the offensive / recovery emit verbs map to
 *      the correct AIInputCommand fields.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  HardTierAI,
  translateOffensiveEmit,
  translateRecoveryEmit,
  type HardTierAIOptions,
} from './HardTierAI';
import {
  buildWorldSnapshot,
  type PerceivedOpponent,
  type PerceivedSelf,
  type PerceivedStage,
  type WorldSnapshot,
} from './perception/WorldSnapshot';
import { Rng } from '../utils/Rng';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const STAGE_DEFAULTS: PerceivedStage = {
  stageLeft: -300,
  stageRight: 300,
  stageTop: 200,
  blastZone: { left: -800, right: 800, top: -600, bottom: 600 },
};

function makeSelf(overrides: Partial<PerceivedSelf> = {}): PerceivedSelf {
  return {
    slotIndex: 0,
    position: { x: 0, y: 100 },
    velocity: { vx: 0, vy: 0 },
    facing: 1,
    damagePercent: 0,
    stocksRemaining: 3,
    isAirborne: false,
    isInHitstun: false,
    isOnLedge: false,
    currentMove: null,
    ...overrides,
  };
}

function makeOpp(
  slot: 1 | 2 | 3,
  overrides: Partial<PerceivedOpponent> = {},
): PerceivedOpponent {
  return {
    slotIndex: slot,
    position: { x: 100, y: 100 },
    velocity: { vx: 0, vy: 0 },
    facing: -1,
    damagePercent: 0,
    stocksRemaining: 3,
    stateLabel: 'idle',
    isAirborne: false,
    isInvincible: false,
    ...overrides,
  };
}

function makeWorld(
  tickIndex: number,
  selfOverrides: Partial<PerceivedSelf> = {},
  opponents: ReadonlyArray<PerceivedOpponent> = [makeOpp(1)],
  stage: PerceivedStage = STAGE_DEFAULTS,
): WorldSnapshot {
  return buildWorldSnapshot({
    tickIndex,
    self: makeSelf(selfOverrides),
    opponents,
    stage,
  });
}

function makeBot(
  partial: Partial<HardTierAIOptions> = {},
): HardTierAI {
  return new HardTierAI({
    slotIndex: partial.slotIndex ?? 0,
    rng: partial.rng ?? new Rng(0xC0FFEE),
    inputDelay: partial.inputDelay,
    offensive: partial.offensive,
    recovery: partial.recovery,
    label: partial.label,
    pressHoldFrames: partial.pressHoldFrames,
    defaultMoveAxis: partial.defaultMoveAxis,
  });
}

/**
 * Run the bot through `frames` ticks of the provided perception
 * sequence. Returns the array of CharacterInput records produced.
 */
function driveBot(
  bot: HardTierAI,
  worlds: ReadonlyArray<WorldSnapshot>,
): Array<ReturnType<HardTierAI['sample']>> {
  const out: Array<ReturnType<HardTierAI['sample']>> = [];
  for (let i = 0; i < worlds.length; i += 1) {
    const w = worlds[i]!;
    bot.pushPerception(i, w);
    out.push(bot.sample(i));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Construction + slot identity
// ---------------------------------------------------------------------------

describe('HardTierAI — construction', () => {
  it('exposes the slot index from constructor options', () => {
    expect(makeBot({ slotIndex: 2 }).slotIndex).toBe(2);
  });

  it('produces a slot-scoped default label', () => {
    expect(makeBot({ slotIndex: 3 }).label).toBe('ai.bot.slot3');
  });

  it('honours an explicit label override', () => {
    expect(makeBot({ label: 'hard.cat' }).label).toBe('hard.cat');
  });

  it('initialises with the default 17-frame Hard-tier input delay', () => {
    const bot = makeBot();
    expect(bot.getReactionSystem().getInputDelayFrames()).toBe(17);
  });

  it('honours a custom fixed input-delay specification', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 15 } });
    expect(bot.getReactionSystem().getInputDelayFrames()).toBe(15);
  });

  it('rolls a delay inside the [15, 20] band when `sampled`', () => {
    const bot = makeBot({
      inputDelay: { mode: 'sampled', minFrames: 15, maxFrames: 20 },
    });
    const delay = bot.getReactionSystem().getInputDelayFrames();
    expect(delay).toBeGreaterThanOrEqual(15);
    expect(delay).toBeLessThanOrEqual(20);
  });

  it('starts with no sticky target slot', () => {
    expect(makeBot().getLastTargetSlot()).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Reaction-window delay (15–20 frames) — Sub-AC 4 "fast reaction times"
// ---------------------------------------------------------------------------

describe('HardTierAI — reaction window', () => {
  it('returns a fully-neutral input during the warm-up window', () => {
    const bot = makeBot();
    // Default 17-frame delay → frames [0, 16] are warm-up.
    bot.pushPerception(0, makeWorld(0));
    const out = bot.sample(0);
    expect(out.moveX).toBe(0);
    expect(out.attack).toBe(false);
    expect(out.attackHeavy).toBe(false);
    expect(out.jump).toBe(false);
    expect(out.shield).toBe(false);
    expect(out.dodge).toBe(false);
  });

  it('starts producing decisions once the delay has elapsed', () => {
    // Use a small delay so the test runs quickly.
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 5 } });
    // Push 7 frames of perception. Frames [0, 4] warm-up, then frames
    // 5+ should produce decisions.
    const worlds = Array.from({ length: 8 }, (_, i) => makeWorld(i));
    const inputs = driveBot(bot, worlds);
    // Frame 5 is the first decision (delay elapsed).
    // The bot has an opponent at +100 so it will move right toward it.
    expect(inputs[0]!.moveX).toBe(0); // warm-up
    expect(inputs[5]!.moveX).toBe(1); // closing the gap toward the opponent
  });

  it('does not see live state — uses the delayed snapshot', () => {
    // A small delay (3) makes it easy to see "delayed" vs "live".
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 3 } });

    // Frame 0..2: opponent very far right. Frame 3: opponent very far left.
    // After the 3-frame delay, frame 3 sees the *frame 0* perception
    // (opponent was on the right) so it should continue moving right.
    const worlds: WorldSnapshot[] = [
      makeWorld(0, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(1, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(2, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(3, {}, [makeOpp(1, { position: { x: -200, y: 100 } })]),
    ];
    const out = driveBot(bot, worlds);
    // Frame 3 reads frame 0 (opponent on right) — moveRight expected.
    expect(out[3]!.moveX).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Combo awareness — Sub-AC 4 "combo awareness"
// ---------------------------------------------------------------------------

describe('HardTierAI — combo awareness', () => {
  it('records a landed hit into the offensive blackboard', () => {
    const bot = makeBot();
    bot.registerLandedHit({ landed: 'jab', landedTick: 5, opponentPercent: 12 });
    const bb = bot.getOffensiveBlackboard();
    expect(bb.get('comboStage')).toBe('jabConnected');
    expect(bb.get('comboLastLandedMove')).toBe('jab');
    expect(bb.get('comboLastLandedTick')).toBe(5);
    expect(bb.get('comboLastLandedOpponentPercent')).toBe(12);
  });

  it('routes combo follow-up presses on the next tick after a landed jab', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 1 } });

    // Warm up the buffer with a close-range opponent so the delayed
    // perception (frame N-1) sees the opponent already in tilt reach.
    const close = makeWorld(0, { position: { x: 0, y: 100 } }, [
      makeOpp(1, { position: { x: 30, y: 100 } }),
    ]);
    bot.pushPerception(0, close);
    bot.sample(0);

    // Tick 1 — first decision frame. Register a landed jab so the
    // combo recognition leaf has work to do.
    bot.registerLandedHit({
      landed: 'jab',
      landedTick: 0,
      opponentPercent: 12,
    });
    bot.pushPerception(1, close);
    const input = bot.sample(1);
    // The combo follow-up branch is selected; jab→tilt fires
    // `attack` (tilt translates to `attack` press).
    expect(input.attack).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge-guarding — Sub-AC 4 "edge-guarding"
// ---------------------------------------------------------------------------

describe('HardTierAI — edge-guarding', () => {
  it('moves toward the threatened ledge when opponent is off-stage', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 1 } });

    // Bot stands on the right side of the stage; opponent is off the
    // right edge of the stage — the edge-guard branch should pull the
    // bot further right toward the ledge anchor.
    const onStageBot = (oppX: number) =>
      makeWorld(0,
        { position: { x: 200, y: 100 } },
        [
          makeOpp(1, {
            position: { x: oppX, y: 100 },
            isAirborne: true,
            stateLabel: 'airborne',
          }),
        ],
      );

    bot.pushPerception(0, onStageBot(380));
    bot.sample(0);
    bot.pushPerception(1, onStageBot(380));
    const input = bot.sample(1);
    // The bot is at 200, the right ledge is at 300, the opponent is at
    // 380. The edge-guard leaf moves the bot rightward to anchor at the
    // ledge corner.
    expect(input.moveX).toBe(1);
  });

  it('falls through to the offensive sub-tree when no opponent is off-stage', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 1 } });

    bot.pushPerception(0, makeWorld(0));
    bot.sample(0);
    // Opponent on stage at +100, bot at 0. Falls through to the
    // neutral-jab branch which emits `moveRight` to close the gap.
    bot.pushPerception(1, makeWorld(1));
    const input = bot.sample(1);
    expect(input.moveX).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Predictive opponent tracking — Sub-AC 4 "predictive opponent tracking"
// ---------------------------------------------------------------------------

describe('HardTierAI — predictive opponent tracking', () => {
  it('uses the opponent velocity to project closing direction', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 1 } });

    // Opponent is on the right of the bot but moving leftward (toward
    // the bot) at high speed. Predictive lookahead places the
    // projected opponent position to the *left* of the bot, so the
    // predictive close-the-gap leaf should emit `moveLeft`.
    const world = makeWorld(0,
      { position: { x: 0, y: 100 } },
      [
        makeOpp(1, {
          position: { x: 100, y: 100 },
          velocity: { vx: -20, vy: 0 },
        }),
      ],
    );

    bot.pushPerception(0, world);
    bot.sample(0);
    bot.pushPerception(1, world);
    const input = bot.sample(1);
    // Lookahead projection: opp.x + vx * lookahead. Default lookahead
    // is several frames; -20 px/frame for a few frames already places
    // the opponent past the bot's left.
    expect(input.moveX).toBe(-1);
  });

  it('respects opponent positional sign when velocity is zero', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 1 } });
    const world = makeWorld(0,
      { position: { x: 0, y: 100 } },
      [makeOpp(1, { position: { x: 100, y: 100 }, velocity: { vx: 0, vy: 0 } })],
    );
    bot.pushPerception(0, world);
    bot.sample(0);
    bot.pushPerception(1, world);
    expect(bot.sample(1).moveX).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Recovery — when bot is off-stage, recovery sub-tree wins priority
// ---------------------------------------------------------------------------

describe('HardTierAI — recovery sub-tree priority', () => {
  it('emits a jump press when the bot is off-stage', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 1 } });

    // Bot is off the right edge of the stage, airborne, with
    // air-jumps available. The first-jump recovery leaf should fire.
    const offStageWorld = (frame: number) =>
      makeWorld(frame,
        {
          position: { x: 360, y: 220 }, // off-stage X, below stageTop
          velocity: { vx: 0, vy: 0 },
          isAirborne: true,
        },
        [makeOpp(1, { position: { x: 0, y: 100 } })],
      );

    bot.pushPerception(0, offStageWorld(0));
    bot.sample(0);
    bot.pushPerception(1, offStageWorld(1));
    const input = bot.sample(1);
    expect(input.jump).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same seed + same perception stream → same outputs
// ---------------------------------------------------------------------------

describe('HardTierAI — determinism', () => {
  it('produces byte-identical inputs across two seeded providers', () => {
    const a = makeBot({ rng: new Rng(0x12345) });
    const b = makeBot({ rng: new Rng(0x12345) });

    const worlds = Array.from({ length: 25 }, (_, i) =>
      makeWorld(i, { position: { x: 0, y: 100 } }, [
        makeOpp(1, {
          position: { x: 50 + i * 3, y: 100 },
          velocity: { vx: 3, vy: 0 },
        }),
      ]),
    );

    const aInputs = driveBot(a, worlds);
    const bInputs = driveBot(b, worlds);

    for (let i = 0; i < worlds.length; i += 1) {
      expect(aInputs[i]).toEqual(bInputs[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// Snapshot / restore — round-trip preserves subsequent decisions
// ---------------------------------------------------------------------------

describe('HardTierAI — snapshot / restore', () => {
  it('captures all controller state into a serialisable snapshot', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 5 } });
    const worlds = Array.from({ length: 10 }, (_, i) => makeWorld(i));
    driveBot(bot, worlds);

    const snap = bot.snapshot();

    expect(snap.reaction.inputDelayFrames).toBe(5);
    expect(snap.reaction.entries.length).toBeGreaterThan(0);
    expect(snap.offensiveBlackboard.comboStage).toBe('idle');
    expect(snap.recoveryBlackboard.recoveryPhase).toBe('idle');
    expect(typeof snap.rngState).toBe('number');
  });

  it('round-trips identically when restored to a fresh provider', () => {
    const seed = 0xC0FFEE;
    const bot = makeBot({
      rng: new Rng(seed),
      inputDelay: { mode: 'fixed', frames: 3 },
    });

    const worlds = Array.from({ length: 12 }, (_, i) =>
      makeWorld(i,
        { position: { x: 0, y: 100 } },
        [
          makeOpp(1, {
            position: { x: 80 + i * 2, y: 100 },
            velocity: { vx: 2, vy: 0 },
          }),
        ],
      ),
    );
    driveBot(bot, worlds);

    // Capture snapshot and clone state into a fresh bot.
    const snap = bot.snapshot();
    const fresh = makeBot({
      rng: new Rng(seed),
      inputDelay: { mode: 'fixed', frames: 3 },
    });
    // Replay first-12 frames into the fresh bot's reaction system so
    // its delay buffer mirrors the original (the snapshot's `entries`
    // are restored automatically below).
    fresh.restoreSnapshot(snap);

    // Push 5 more perception frames + sample on each. The two bots
    // should produce identical inputs from this point on.
    const future = Array.from({ length: 5 }, (_, j) =>
      makeWorld(12 + j,
        { position: { x: 0, y: 100 } },
        [
          makeOpp(1, {
            position: { x: 100 + j, y: 100 },
            velocity: { vx: 1, vy: 0 },
          }),
        ],
      ),
    );

    const a: Array<ReturnType<HardTierAI['sample']>> = [];
    const b: Array<ReturnType<HardTierAI['sample']>> = [];
    for (let i = 0; i < future.length; i += 1) {
      bot.pushPerception(12 + i, future[i]!);
      fresh.pushPerception(12 + i, future[i]!);
      a.push(bot.sample(12 + i));
      b.push(fresh.sample(12 + i));
    }
    for (let i = 0; i < future.length; i += 1) {
      expect(a[i]).toEqual(b[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// reset() cascade
// ---------------------------------------------------------------------------

describe('HardTierAI — reset cascade', () => {
  let bot: HardTierAI;

  beforeEach(() => {
    bot = makeBot({ inputDelay: { mode: 'fixed', frames: 2 } });
  });

  it('clears the reaction buffer on reset', () => {
    bot.pushPerception(0, makeWorld(0));
    bot.pushPerception(1, makeWorld(1));
    expect(bot.getReactionSystem().size()).toBe(2);
    bot.reset();
    expect(bot.getReactionSystem().size()).toBe(0);
  });

  it('clears the offensive blackboard on reset', () => {
    bot.registerLandedHit({ landed: 'jab', landedTick: 0, opponentPercent: 50 });
    expect(bot.getOffensiveBlackboard().get('comboStage')).toBe('jabConnected');
    bot.reset();
    expect(bot.getOffensiveBlackboard().get('comboStage')).toBe('idle');
  });

  it('clears the sticky target slot on reset', () => {
    // Tick once to populate the target slot.
    bot.pushPerception(0, makeWorld(0));
    bot.sample(0);
    bot.pushPerception(1, makeWorld(1));
    bot.sample(1);
    bot.pushPerception(2, makeWorld(2));
    bot.sample(2);
    expect(bot.getLastTargetSlot()).toBe(1);
    bot.reset();
    expect(bot.getLastTargetSlot()).toBe(null);
  });

  it('allows re-sampling from frame 0 after a reset', () => {
    bot.pushPerception(0, makeWorld(0));
    bot.sample(0);
    bot.pushPerception(1, makeWorld(1));
    bot.sample(1);
    bot.reset();
    // After reset, sampling frame 0 should not throw.
    bot.pushPerception(0, makeWorld(0));
    expect(() => bot.sample(0)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Verb translation — pure unit tests on the helpers
// ---------------------------------------------------------------------------

describe('HardTierAI — verb translation', () => {
  it('translates every offensive emit verb', () => {
    expect(translateOffensiveEmit({ kind: 'idle' })).toEqual({ kind: 'idle' });
    expect(translateOffensiveEmit({ kind: 'moveLeft' })).toEqual({ kind: 'moveLeft' });
    expect(translateOffensiveEmit({ kind: 'moveRight' })).toEqual({ kind: 'moveRight' });
    expect(translateOffensiveEmit({ kind: 'jab' })).toEqual({ kind: 'attack' });
    expect(translateOffensiveEmit({ kind: 'tilt' })).toEqual({ kind: 'attack' });
    expect(translateOffensiveEmit({ kind: 'smash' })).toEqual({ kind: 'attackHeavy' });
    expect(translateOffensiveEmit({ kind: 'special' })).toEqual({ kind: 'special' });
    expect(translateOffensiveEmit({ kind: 'shield' })).toEqual({ kind: 'shield' });
    expect(translateOffensiveEmit({ kind: 'dodge' })).toEqual({ kind: 'dodge' });
  });

  it('translates every recovery emit verb', () => {
    expect(translateRecoveryEmit({ kind: 'idle' })).toEqual({ kind: 'idle' });
    expect(translateRecoveryEmit({ kind: 'moveLeft' })).toEqual({ kind: 'moveLeft' });
    expect(translateRecoveryEmit({ kind: 'moveRight' })).toEqual({ kind: 'moveRight' });
    expect(translateRecoveryEmit({ kind: 'moveUp' })).toEqual({ kind: 'moveUp' });
    expect(translateRecoveryEmit({ kind: 'moveDown' })).toEqual({ kind: 'moveDown' });
    expect(translateRecoveryEmit({ kind: 'jump' })).toEqual({ kind: 'jump' });
    expect(translateRecoveryEmit({ kind: 'upSpecial' })).toEqual({ kind: 'special' });
    expect(translateRecoveryEmit({ kind: 'airDodge' })).toEqual({ kind: 'dodge' });
  });
});

// ---------------------------------------------------------------------------
// Sticky target selection — bot doesn't thrash between opponents
// ---------------------------------------------------------------------------

describe('HardTierAI — sticky target selection', () => {
  it('picks a target on the first decision tick', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 1 } });
    bot.pushPerception(0, makeWorld(0));
    bot.sample(0);
    bot.pushPerception(1, makeWorld(1));
    bot.sample(1);
    expect(bot.getLastTargetSlot()).toBe(1);
  });

  it('keeps the same target across ticks when threats are similar', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 1 } });

    // Two opponents, slot 1 closer than slot 2 — both at similar threat.
    const worldWith = (oppXSlot1: number, oppXSlot2: number) =>
      makeWorld(0,
        { position: { x: 0, y: 100 } },
        [
          makeOpp(1, { position: { x: oppXSlot1, y: 100 } }),
          makeOpp(2, { position: { x: oppXSlot2, y: 100 } }),
        ],
      );

    bot.pushPerception(0, worldWith(50, 200));
    bot.sample(0);
    bot.pushPerception(1, worldWith(50, 200));
    bot.sample(1);
    bot.pushPerception(2, worldWith(50, 200));
    bot.sample(2);

    // Should stay on slot 1 (the closer / more threatening opponent).
    expect(bot.getLastTargetSlot()).toBe(1);
  });
});
