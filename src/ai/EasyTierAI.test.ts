/**
 * EasyTierAI test suite — AC 20203 Sub-AC 3.
 *
 * Locks down the four pillars of the Easy difficulty tier:
 *
 *   1. Slow reaction times — uses the 28-36 frame Easy preset; warm-up
 *      window holds neutral.
 *   2. Basic move usage — only ever emits jab (never tilt / smash /
 *      special).
 *   3. Frequent idle behavior — emits `idle` on a meaningful fraction
 *      of ticks across a long run.
 *   3b. Frequent wandering behavior — emits random-direction movement
 *       independent of the opponent's position.
 *   4. High error rates — wrong-direction movement, dropped attack
 *      presses, and spurious presses occur at the configured rates
 *      across long samples.
 *
 *   • Determinism — two providers seeded identically and fed the same
 *     perception stream produce byte-identical input streams.
 *   • Snapshot / restore — the controller round-trips through its
 *     snapshot type with no observable change in subsequent decisions.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  EasyTierAI,
  DEFAULT_EASY_INPUT_DELAY,
  type EasyTierAIOptions,
} from './EasyTierAI';
import {
  buildWorldSnapshot,
  type PerceivedOpponent,
  type PerceivedSelf,
  type PerceivedStage,
  type WorldSnapshot,
} from './perception/WorldSnapshot';
import { REACTION_WINDOW_PRESETS } from './perception/reactionWindowPresets';
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

function makeBot(partial: Partial<EasyTierAIOptions> = {}): EasyTierAI {
  return new EasyTierAI({
    slotIndex: partial.slotIndex ?? 0,
    rng: partial.rng ?? new Rng(0xC0FFEE),
    inputDelay: partial.inputDelay,
    offensive: partial.offensive,
    inputErrors: partial.inputErrors,
    label: partial.label,
    pressHoldFrames: partial.pressHoldFrames,
    defaultMoveAxis: partial.defaultMoveAxis,
  });
}

function driveBot(
  bot: EasyTierAI,
  worlds: ReadonlyArray<WorldSnapshot>,
): Array<ReturnType<EasyTierAI['sample']>> {
  const out: Array<ReturnType<EasyTierAI['sample']>> = [];
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

describe('EasyTierAI — construction', () => {
  it('exposes the slot index from constructor options', () => {
    expect(makeBot({ slotIndex: 2 }).slotIndex).toBe(2);
  });

  it('produces a slot-scoped default label', () => {
    expect(makeBot({ slotIndex: 3 }).label).toBe('ai.bot.slot3');
  });

  it('honours an explicit label override', () => {
    expect(makeBot({ label: 'easy.cat' }).label).toBe('easy.cat');
  });

  it('initialises with a sampled delay inside the 28-36 Easy band', () => {
    const bot = makeBot();
    const delay = bot.getReactionSystem().getInputDelayFrames();
    expect(delay).toBeGreaterThanOrEqual(28);
    expect(delay).toBeLessThanOrEqual(36);
  });

  it('honours a custom fixed input-delay specification', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 30 } });
    expect(bot.getReactionSystem().getInputDelayFrames()).toBe(30);
  });

  it('exposes the canonical Easy input-delay default', () => {
    expect(DEFAULT_EASY_INPUT_DELAY.mode).toBe('sampled');
    if (DEFAULT_EASY_INPUT_DELAY.mode === 'sampled') {
      expect(DEFAULT_EASY_INPUT_DELAY.minFrames).toBe(
        REACTION_WINDOW_PRESETS.easy.minDelayFrames,
      );
      expect(DEFAULT_EASY_INPUT_DELAY.maxFrames).toBe(
        REACTION_WINDOW_PRESETS.easy.maxDelayFrames,
      );
    }
  });

  it('starts with no sticky target slot', () => {
    expect(makeBot().getLastTargetSlot()).toBe(null);
  });

  it('exposes the input-error mangler', () => {
    const bot = makeBot();
    const m = bot.getErrorMangler();
    expect(m.getMoveErrorChance()).toBeGreaterThan(0);
    expect(m.getPressDropChance()).toBeGreaterThan(0);
    expect(m.getSpuriousPressChance()).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3 pillar 1: slow reaction times (28-36 frames)
// ---------------------------------------------------------------------------

describe('EasyTierAI — slow reactions', () => {
  it('returns a fully-neutral input during the 28-36 frame warm-up', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 28 } });
    bot.pushPerception(0, makeWorld(0));
    const out = bot.sample(0);
    expect(out.moveX).toBe(0);
    expect(out.attack).toBe(false);
    expect(out.attackHeavy).toBe(false);
    expect(out.jump).toBe(false);
    expect(out.shield).toBe(false);
    expect(out.dodge).toBe(false);
  });

  it('reads from a delayed snapshot (not live state)', () => {
    // Use a small delay (3) so the test runs quickly.
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 3 },
      // Disable error mangler and behavior randomness so the test is
      // deterministic on direction.
      inputErrors: {
        moveErrorChance: 0,
        pressDropChance: 0,
        spuriousPressChance: 0,
      },
      offensive: { idleChance: 0, wanderChance: 0 },
    });

    // Frames 0..2 — opponent very far right. Frame 3 — opponent jumps
    // far left. After 3-frame delay, frame 3 reads frame 0 (opp on
    // right), so the bot continues moving right.
    const worlds: WorldSnapshot[] = [
      makeWorld(0, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(1, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(2, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(3, {}, [makeOpp(1, { position: { x: -200, y: 100 } })]),
    ];
    const out = driveBot(bot, worlds);
    expect(out[3]!.moveX).toBe(1);
  });

  it('warm-up window for the sampled default is at least 28 frames', () => {
    const bot = makeBot();
    // First 28 frames — the bot has not finished its warm-up and emits
    // neutral inputs. We only assert the LOWER bound of the warm-up
    // here because the sampled delay can be anywhere in [28, 36].
    const worlds = Array.from({ length: 28 }, (_, i) => makeWorld(i));
    const out = driveBot(bot, worlds);
    for (let i = 0; i < 28; i += 1) {
      expect(out[i]!.moveX).toBe(0);
      expect(out[i]!.attack).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3 pillar 2: basic move usage (only jab)
// ---------------------------------------------------------------------------

describe('EasyTierAI — basic move usage (jab only)', () => {
  it('never emits attackHeavy across a long run', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 3 },
      inputErrors: {
        moveErrorChance: 0,
        pressDropChance: 0,
        spuriousPressChance: 0,
      },
    });
    const worlds = Array.from({ length: 200 }, (_, i) =>
      makeWorld(i, {}, [
        makeOpp(1, { position: { x: 30, y: 100 }, damagePercent: 100 + i }),
      ]),
    );
    const inputs = driveBot(bot, worlds);
    // Even at high opponent damage % (where Hard tier would smash for
    // a KO), the Easy tier never escalates to attackHeavy.
    for (const input of inputs) {
      expect(input.attackHeavy).toBe(false);
    }
  });

  it('emits attack (jab) at least once when in range', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 3 },
      inputErrors: {
        // Disable drops and spurious presses so we always observe the
        // bot's intended jab.
        moveErrorChance: 0,
        pressDropChance: 0,
        spuriousPressChance: 0,
      },
      // Disable idle and wander so the bot always commits to jab.
      offensive: { idleChance: 0, wanderChance: 0 },
    });
    const worlds = Array.from({ length: 30 }, (_, i) =>
      makeWorld(i, {}, [makeOpp(1, { position: { x: 30, y: 100 } })]),
    );
    const inputs = driveBot(bot, worlds);
    const attackFrames = inputs.filter((i) => i.attack).length;
    expect(attackFrames).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3 pillar 3: frequent idle / wandering behavior
// ---------------------------------------------------------------------------

describe('EasyTierAI — frequent idle / wandering', () => {
  it('produces neutral (no-press, no-move) frames a meaningful fraction of the time', () => {
    // With idle 0.4 and the input mangler off, idle frames produce
    // moveX === 0 and no presses.
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      inputErrors: {
        moveErrorChance: 0,
        pressDropChance: 0,
        spuriousPressChance: 0,
      },
      offensive: { wanderChance: 0 }, // isolate the idle gate
      rng: new Rng(0xc0ffee),
    });
    const worlds = Array.from({ length: 1000 }, (_, i) =>
      makeWorld(i, {}, [makeOpp(1, { position: { x: 30, y: 100 } })]),
    );
    const inputs = driveBot(bot, worlds);

    // Skip the warm-up window.
    let neutralFrames = 0;
    for (let i = 5; i < inputs.length; i += 1) {
      const inp = inputs[i]!;
      const isNeutral =
        inp.moveX === 0 &&
        !inp.attack &&
        !inp.attackHeavy &&
        !inp.jump &&
        !inp.shield &&
        !inp.dodge;
      if (isNeutral) neutralFrames += 1;
    }
    // Default idleChance = 0.4 → ~40 % of frames idle.
    expect(neutralFrames).toBeGreaterThan(inputs.length * 0.3);
  });

  it('emits movement uncorrelated with opponent position (wander effect)', () => {
    // With the opponent always to the right and idle disabled,
    // wandering injects `moveLeft` frames the bot would never produce
    // from purposeful gap-close alone.
    //
    // Note the opponent is positioned IN jab range — out-of-range
    // would pin the offensive Selector on the gap-close MoveToward
    // (it returns Running until reached) and prevent the wander leaf
    // from being re-evaluated on subsequent ticks. Putting the
    // opponent in range lets the Selector restart fresh each tick so
    // every tick gets a wander roll.
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      inputErrors: {
        // Disable input errors so direction reversals come ONLY from
        // the wander leaf.
        moveErrorChance: 0,
        pressDropChance: 0,
        spuriousPressChance: 0,
      },
      offensive: { idleChance: 0 }, // wander is the only non-jab path
      rng: new Rng(0xfeedbeef),
    });
    const worlds = Array.from({ length: 600 }, (_, i) =>
      makeWorld(i, { position: { x: 0, y: 100 } }, [
        // Opponent in jab range to the right — purposeful gap-close
        // would never emit `moveLeft` here. Any `moveLeft` frame
        // observed must come from the wander leaf.
        makeOpp(1, { position: { x: 30, y: 100 } }),
      ]),
    );
    const inputs = driveBot(bot, worlds);
    // Skip warm-up and look for `moveX === -1` frames.
    let wanderLeftCount = 0;
    for (let i = 5; i < inputs.length; i += 1) {
      if (inputs[i]!.moveX === -1) wanderLeftCount += 1;
    }
    // With wanderChance = 0.25 and direction 50/50, ~12.5 % of frames
    // emit `moveLeft`. Allow generous slack (≥ 5 %).
    expect(wanderLeftCount).toBeGreaterThan(inputs.length * 0.05);
  });
});

// ---------------------------------------------------------------------------
// Sub-AC 3 pillar 4: high error rates
// ---------------------------------------------------------------------------

describe('EasyTierAI — high error rates', () => {
  it('reverses movement at the configured rate over a long sample', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      inputErrors: {
        moveErrorChance: 0.5, // very high to make the test cheap
        pressDropChance: 0,
        spuriousPressChance: 0,
      },
      offensive: { idleChance: 0, wanderChance: 0 }, // pure gap-close
      rng: new Rng(0x12345),
    });
    // Opponent always to the RIGHT; bot intends moveRight every frame.
    const worlds = Array.from({ length: 600 }, (_, i) =>
      makeWorld(i, { position: { x: -100, y: 100 } }, [
        makeOpp(1, { position: { x: 200, y: 100 } }),
      ]),
    );
    const inputs = driveBot(bot, worlds);
    let leftFrames = 0;
    let rightFrames = 0;
    // Skip warm-up
    for (let i = 5; i < inputs.length; i += 1) {
      if (inputs[i]!.moveX === -1) leftFrames += 1;
      if (inputs[i]!.moveX === 1) rightFrames += 1;
    }
    // With moveErrorChance = 0.5, we expect roughly half of intended
    // moveRight frames to flip to moveLeft. Both should be sizable.
    expect(leftFrames).toBeGreaterThan(inputs.length * 0.2);
    expect(rightFrames).toBeGreaterThan(inputs.length * 0.2);
  });

  it('drops a meaningful fraction of attack presses', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      inputErrors: {
        moveErrorChance: 0,
        pressDropChance: 0.5, // half of presses dropped
        spuriousPressChance: 0,
      },
      offensive: { idleChance: 0, wanderChance: 0 },
      rng: new Rng(0xcafe),
    });
    const worlds = Array.from({ length: 500 }, (_, i) =>
      makeWorld(i, {}, [makeOpp(1, { position: { x: 30, y: 100 } })]),
    );
    const inputs = driveBot(bot, worlds);

    let attackFrames = 0;
    let nonAttackFrames = 0;
    for (let i = 5; i < inputs.length; i += 1) {
      if (inputs[i]!.attack) attackFrames += 1;
      else nonAttackFrames += 1;
    }
    // Without drops the bot would press attack on every in-range frame
    // (idle and wander disabled). With 50 % drop the press lands on
    // about half of them — both counts should be large.
    expect(attackFrames).toBeGreaterThan(20);
    expect(nonAttackFrames).toBeGreaterThan(20);
  });

  it('injects spurious presses with no opponent in range', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      inputErrors: {
        moveErrorChance: 0,
        pressDropChance: 0,
        spuriousPressChance: 1, // every tick fires a spurious press
      },
      // Disable idle / wander / jab path: bot intends NO press.
      offensive: { idleChance: 0, wanderChance: 0, jabRangePx: 1 },
      rng: new Rng(0xdeadbeef),
    });
    // Opponent VERY far away — out of jab range. Bot's only intended
    // emit is a `moveRight` for gap-close. With spuriousPressChance =
    // 1 every tick injects a press that the bot did not decide.
    const worlds = Array.from({ length: 100 }, (_, i) =>
      makeWorld(i, {}, [makeOpp(1, { position: { x: 5000, y: 100 } })]),
    );
    const inputs = driveBot(bot, worlds);

    let pressFrames = 0;
    for (let i = 5; i < inputs.length; i += 1) {
      const inp = inputs[i]!;
      if (inp.attack || inp.shield || inp.jump || inp.dodge) {
        pressFrames += 1;
      }
    }
    // Every post-warm-up frame should have a spurious press.
    expect(pressFrames).toBeGreaterThan(20);
  });

  it('has a sizable error rate on default settings', () => {
    // Sanity check: with defaults, the bot's input stream is visibly
    // noisy. We assert the intersection of "intended" and "actual"
    // diverges meaningfully across many ticks.
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      offensive: { idleChance: 0, wanderChance: 0 }, // pure intent
      rng: new Rng(0x9999),
    });
    const worlds = Array.from({ length: 600 }, (_, i) =>
      makeWorld(i, { position: { x: -100, y: 100 } }, [
        makeOpp(1, { position: { x: 200, y: 100 } }),
      ]),
    );
    const inputs = driveBot(bot, worlds);
    // The bot's intent is "press attackRight" every tick. Errors mean
    // some frames will have moveX !== 1 (reversal) OR no attack press
    // (drop) OR an extra non-attack press (spurious).
    let imperfectFrames = 0;
    for (let i = 5; i < inputs.length; i += 1) {
      const inp = inputs[i]!;
      const isPerfectIntent =
        inp.moveX === 1 &&
        inp.attack &&
        !inp.attackHeavy &&
        !inp.jump &&
        !inp.shield &&
        !inp.dodge;
      if (!isPerfectIntent) imperfectFrames += 1;
    }
    // At least 30 % of frames should diverge from a perfect bot.
    expect(imperfectFrames).toBeGreaterThan(inputs.length * 0.3);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same seed + same perception stream → same outputs
// ---------------------------------------------------------------------------

describe('EasyTierAI — determinism', () => {
  it('produces byte-identical inputs across two seeded providers', () => {
    const a = makeBot({ rng: new Rng(0x12345) });
    const b = makeBot({ rng: new Rng(0x12345) });

    const worlds = Array.from({ length: 50 }, (_, i) =>
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

  it('two bots with different seeds produce different streams (sanity)', () => {
    const a = makeBot({ rng: new Rng(0x11111) });
    const b = makeBot({ rng: new Rng(0x22222) });

    const worlds = Array.from({ length: 60 }, (_, i) =>
      makeWorld(i, {}, [makeOpp(1, { position: { x: 50, y: 100 } })]),
    );

    const aInputs = driveBot(a, worlds);
    const bInputs = driveBot(b, worlds);

    // Skip warm-up; expect at least one diverging frame.
    let diverged = false;
    for (let i = 40; i < worlds.length; i += 1) {
      if (JSON.stringify(aInputs[i]) !== JSON.stringify(bInputs[i])) {
        diverged = true;
        break;
      }
    }
    expect(diverged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Snapshot / restore
// ---------------------------------------------------------------------------

describe('EasyTierAI — snapshot / restore', () => {
  it('captures all controller state into a serialisable snapshot', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 5 } });
    const worlds = Array.from({ length: 10 }, (_, i) => makeWorld(i));
    driveBot(bot, worlds);

    const snap = bot.snapshot();

    expect(snap.reaction.inputDelayFrames).toBe(5);
    expect(snap.reaction.entries.length).toBeGreaterThan(0);
    expect(snap.offensiveBlackboard.comboStage).toBe('idle');
    expect(typeof snap.rngState).toBe('number');
    expect(typeof snap.offensiveTickCount).toBe('number');
  });

  it('round-trips identically when restored to a fresh provider', () => {
    // Use an opponent in jab range and disable the wander branch so
    // the offensive Selector terminates with Success every tick (no
    // child gets pinned in `Running` state). The behavior tree's
    // composite Running state is not part of the snapshot — it is
    // intentionally regenerated from the Blackboard contents — so
    // exercising round-trip equality requires both bots to land at a
    // tree state with no in-flight Running pins.
    const seed = 0xC0FFEE;
    const bot = makeBot({
      rng: new Rng(seed),
      inputDelay: { mode: 'fixed', frames: 3 },
      offensive: { wanderChance: 0 },
    });
    const worlds = Array.from({ length: 12 }, (_, i) =>
      makeWorld(i,
        { position: { x: 0, y: 100 } },
        [
          makeOpp(1, {
            position: { x: 30, y: 100 },
            velocity: { vx: 0, vy: 0 },
          }),
        ],
      ),
    );
    driveBot(bot, worlds);

    const snap = bot.snapshot();
    const fresh = makeBot({
      rng: new Rng(seed),
      inputDelay: { mode: 'fixed', frames: 3 },
      offensive: { wanderChance: 0 },
    });
    fresh.restoreSnapshot(snap);

    const future = Array.from({ length: 5 }, (_, j) =>
      makeWorld(12 + j,
        { position: { x: 0, y: 100 } },
        [
          makeOpp(1, {
            position: { x: 30, y: 100 },
            velocity: { vx: 0, vy: 0 },
          }),
        ],
      ),
    );

    const a: Array<ReturnType<EasyTierAI['sample']>> = [];
    const b: Array<ReturnType<EasyTierAI['sample']>> = [];
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

describe('EasyTierAI — reset cascade', () => {
  let bot: EasyTierAI;

  beforeEach(() => {
    bot = makeBot();
  });

  it('clears the reaction system buffer', () => {
    bot.pushPerception(0, makeWorld(0));
    bot.pushPerception(1, makeWorld(1));
    bot.reset();
    // After reset, frame 0 must be back in the warm-up window.
    bot.pushPerception(0, makeWorld(0));
    const out = bot.sample(0);
    expect(out.moveX).toBe(0);
  });

  it('clears the sticky target slot', () => {
    bot.pushPerception(
      0,
      makeWorld(0, {}, [makeOpp(1, { position: { x: 100, y: 100 } })]),
    );
    bot.sample(0);
    bot.reset();
    expect(bot.getLastTargetSlot()).toBe(null);
  });

  it('preserves construction-time tunables across reset', () => {
    const resetBot = makeBot({ inputDelay: { mode: 'fixed', frames: 12 } });
    resetBot.reset();
    expect(resetBot.getReactionSystem().getInputDelayFrames()).toBe(12);
  });
});
