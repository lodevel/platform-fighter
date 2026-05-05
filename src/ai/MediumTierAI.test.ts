/**
 * MediumTierAI test suite — AC 20204 Sub-AC 4.
 *
 * Locks down the four pillars of the Medium difficulty tier:
 *
 *   1. Moderate reaction times — uses the 22-28 frame Medium preset;
 *      warm-up window holds neutral; post-warm-up the bot decides off
 *      a delayed (not live) snapshot.
 *   2. Combo awareness — `registerLandedHit` populates the offensive
 *      blackboard; the next decision picks the combo follow-up branch
 *      and presses the planned attack.
 *   3. Situational defense — when an opponent attacks in range, the
 *      bot emits shield (or dodge) on a meaningful fraction of ticks;
 *      defensive emits sit ahead of offensive emits in the Selector.
 *   4. Balanced offensive/defensive behavior — picks contextually
 *      correct verb at each distance band: jab in melee reach, ranged
 *      special at mid-range, walk-in at long range. NO independent
 *      KO smash fishing branch (single biggest delta vs Hard).
 *   5. Recovery — when the bot is off-stage and airborne, the recovery
 *      sub-tree wins priority and emits the correct recovery presses.
 *   6. Determinism — two providers seeded identically and fed the same
 *      perception stream produce byte-identical input streams.
 *   7. Snapshot / restore — the controller round-trips through its
 *      snapshot type with no observable change in subsequent decisions.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  MediumTierAI,
  DEFAULT_MEDIUM_INPUT_DELAY,
  type MediumTierAIOptions,
} from './MediumTierAI';
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

function makeBot(partial: Partial<MediumTierAIOptions> = {}): MediumTierAI {
  return new MediumTierAI({
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

function driveBot(
  bot: MediumTierAI,
  worlds: ReadonlyArray<WorldSnapshot>,
): Array<ReturnType<MediumTierAI['sample']>> {
  const out: Array<ReturnType<MediumTierAI['sample']>> = [];
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

describe('MediumTierAI — construction', () => {
  it('exposes the slot index from constructor options', () => {
    expect(makeBot({ slotIndex: 2 }).slotIndex).toBe(2);
  });

  it('produces a slot-scoped default label', () => {
    expect(makeBot({ slotIndex: 3 }).label).toBe('ai.bot.slot3');
  });

  it('honours an explicit label override', () => {
    expect(makeBot({ label: 'medium.cat' }).label).toBe('medium.cat');
  });

  it('initialises with a sampled delay inside the 22-28 Medium band', () => {
    const bot = makeBot();
    const delay = bot.getReactionSystem().getInputDelayFrames();
    expect(delay).toBeGreaterThanOrEqual(22);
    expect(delay).toBeLessThanOrEqual(28);
  });

  it('honours a custom fixed input-delay specification', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 24 } });
    expect(bot.getReactionSystem().getInputDelayFrames()).toBe(24);
  });

  it('exposes the canonical Medium input-delay default', () => {
    expect(DEFAULT_MEDIUM_INPUT_DELAY.mode).toBe('sampled');
    if (DEFAULT_MEDIUM_INPUT_DELAY.mode === 'sampled') {
      expect(DEFAULT_MEDIUM_INPUT_DELAY.minFrames).toBe(
        REACTION_WINDOW_PRESETS.medium.minDelayFrames,
      );
      expect(DEFAULT_MEDIUM_INPUT_DELAY.maxFrames).toBe(
        REACTION_WINDOW_PRESETS.medium.maxDelayFrames,
      );
    }
  });

  it('starts with no sticky target slot', () => {
    expect(makeBot().getLastTargetSlot()).toBe(null);
  });

  it('initialises with a clean offensive blackboard', () => {
    const bb = makeBot().getOffensiveBlackboard();
    expect(bb.get('comboStage')).toBe('idle');
  });

  it('initialises with a clean recovery blackboard', () => {
    const bb = makeBot().getRecoveryBlackboard();
    expect(bb.get('recoveryPhase')).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// Pillar 1: moderate reaction times (22-28 frames)
// ---------------------------------------------------------------------------

describe('MediumTierAI — moderate reactions', () => {
  it('returns a fully-neutral input during the warm-up window', () => {
    const bot = makeBot({ inputDelay: { mode: 'fixed', frames: 22 } });
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
    });

    // Frames 0..2: opponent very far right. Frame 3: opponent very far left.
    // After 3-frame delay, frame 3 reads frame 0 (opp on right), so the
    // bot continues moving right.
    const worlds: WorldSnapshot[] = [
      makeWorld(0, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(1, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(2, {}, [makeOpp(1, { position: { x: 200, y: 100 } })]),
      makeWorld(3, {}, [makeOpp(1, { position: { x: -200, y: 100 } })]),
    ];
    const out = driveBot(bot, worlds);
    expect(out[3]!.moveX).toBe(1);
  });

  it('warm-up window for the sampled default is at least 22 frames', () => {
    const bot = makeBot();
    // First 22 frames — the bot has not finished its warm-up and emits
    // neutral inputs. We only assert the LOWER bound of the warm-up
    // here because the sampled delay can be anywhere in [22, 28].
    const worlds = Array.from({ length: 22 }, (_, i) => makeWorld(i));
    const out = driveBot(bot, worlds);
    for (let i = 0; i < 22; i += 1) {
      expect(out[i]!.moveX).toBe(0);
      expect(out[i]!.attack).toBe(false);
    }
  });

  it('starts producing decisions once the delay has elapsed', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 5 },
      // Disable defensive branches and ranged so the only output is
      // gap-close + jab; pin the test on a single observable verb.
      offensive: {
        shieldChance: 0,
        dodgeChance: 0,
        rangedEnabled: false,
      },
    });
    // Push 7 frames of perception. Frames [0, 4] warm-up, then frames
    // 5+ should produce decisions. Opponent at default x=100 — out of
    // jab range, so the bot walks rightward to close the gap.
    const worlds = Array.from({ length: 8 }, (_, i) => makeWorld(i));
    const inputs = driveBot(bot, worlds);
    expect(inputs[0]!.moveX).toBe(0); // warm-up
    expect(inputs[5]!.moveX).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Pillar 2: combo awareness
// ---------------------------------------------------------------------------

describe('MediumTierAI — combo awareness', () => {
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
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      // Disable defensive branches so the combo follow-up isn't pre-empted
      // (opponent state below is "idle" anyway, so they wouldn't trigger,
      // but explicit zeroes are good for the invariant).
      offensive: { shieldChance: 0, dodgeChance: 0 },
    });

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
    // The combo follow-up branch is selected; jab→tilt fires `attack`
    // (tilt translates to `attack` press).
    expect(input.attack).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Pillar 3: situational defense (shield + dodge)
// ---------------------------------------------------------------------------

describe('MediumTierAI — situational defense', () => {
  it('emits shield when opponent is attacking within shield range (forced shieldChance=1)', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      offensive: { shieldChance: 1, dodgeChance: 0 },
    });

    // Opponent at melee distance, in attacking state — shield branch
    // should fire on the first decision tick.
    const threat = (frame: number) =>
      makeWorld(frame, { position: { x: 0, y: 100 } }, [
        makeOpp(1, { position: { x: 40, y: 100 }, stateLabel: 'attacking' }),
      ]);

    bot.pushPerception(0, threat(0));
    bot.sample(0);
    bot.pushPerception(1, threat(1));
    const input = bot.sample(1);
    expect(input.shield).toBe(true);
    // Shield branch pre-empts combat — no attack press.
    expect(input.attack).toBe(false);
  });

  it('emits dodge when opponent is attacking within dodge range (forced dodgeChance=1, shield disabled)', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      offensive: { shieldChance: 0, dodgeChance: 1 },
    });

    // Opponent at dodge distance (≤ 70 px default), attacking.
    const threat = (frame: number) =>
      makeWorld(frame, { position: { x: 0, y: 100 } }, [
        makeOpp(1, { position: { x: 40, y: 100 }, stateLabel: 'attacking' }),
      ]);

    bot.pushPerception(0, threat(0));
    bot.sample(0);
    bot.pushPerception(1, threat(1));
    const input = bot.sample(1);
    expect(input.dodge).toBe(true);
  });

  it('does NOT pre-emptively shield when opponent is far outside shield range', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      offensive: { shieldChance: 1, dodgeChance: 1 },
    });

    // Opponent attacking but very far away — no defensive branch fires;
    // bot walks toward the opponent.
    const farThreat = (frame: number) =>
      makeWorld(frame, { position: { x: 0, y: 100 } }, [
        makeOpp(1, { position: { x: 400, y: 100 }, stateLabel: 'attacking' }),
      ]);

    bot.pushPerception(0, farThreat(0));
    bot.sample(0);
    bot.pushPerception(1, farThreat(1));
    const input = bot.sample(1);
    expect(input.shield).toBe(false);
    expect(input.dodge).toBe(false);
    expect(input.moveX).toBe(1); // closing the gap
  });

  it('blocks a meaningful fraction of attacks across a long sample (default settings)', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      // Defaults: shield 0.7, dodge 0.2 — combined coverage ~76 %.
      rng: new Rng(0xBEEF),
    });

    const threat = (frame: number) =>
      makeWorld(frame, { position: { x: 0, y: 100 } }, [
        makeOpp(1, { position: { x: 40, y: 100 }, stateLabel: 'attacking' }),
      ]);

    const worlds = Array.from({ length: 200 }, (_, i) => threat(i));
    const inputs = driveBot(bot, worlds);

    // Skip warm-up.
    let defensiveFrames = 0;
    for (let i = 5; i < inputs.length; i += 1) {
      if (inputs[i]!.shield || inputs[i]!.dodge) defensiveFrames += 1;
    }
    // With shield 0.7 + dodge 0.2 (sequential RNG rolls, dodge first
    // then shield), the bot blocks/dodges the vast majority of frames.
    // Allow generous slack — assert ≥ 50 % defensive frames.
    expect(defensiveFrames).toBeGreaterThan(inputs.length * 0.5);
  });
});

// ---------------------------------------------------------------------------
// Pillar 4: balanced offensive/defensive — contextual move selection
// ---------------------------------------------------------------------------

describe('MediumTierAI — contextual move selection', () => {
  it('emits jab (attack) at melee reach (≤ 50 px)', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      offensive: { shieldChance: 0, dodgeChance: 0 }, // isolate offence
    });
    const close = (frame: number) =>
      makeWorld(frame, { position: { x: 0, y: 100 } }, [
        makeOpp(1, { position: { x: 30, y: 100 } }),
      ]);
    bot.pushPerception(0, close(0));
    bot.sample(0);
    bot.pushPerception(1, close(1));
    const input = bot.sample(1);
    expect(input.attack).toBe(true);
    // Jab translates to `attack`, not `attackHeavy`. Critically
    // contrasts with Hard tier's KO smash branch.
    expect(input.attackHeavy).toBe(false);
  });

  it('emits special (ranged) at mid-range (60-180 px)', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      offensive: { shieldChance: 0, dodgeChance: 0 },
    });
    const mid = (frame: number) =>
      makeWorld(frame, { position: { x: 0, y: 100 } }, [
        makeOpp(1, { position: { x: 120, y: 100 } }),
      ]);
    bot.pushPerception(0, mid(0));
    bot.sample(0);
    bot.pushPerception(1, mid(1));
    const input = bot.sample(1);
    // Ranged branch emits a `special` verb; the AIInputProvider
    // composites `special` into the `attackHeavy` field for engine
    // dispatch (per AC 50202 Sub-AC 2 routing). The bot must NOT emit
    // a basic jab (that's the melee branch's job).
    expect(input.attackHeavy).toBe(true);
    expect(input.attack).toBe(false);
  });

  it('walks toward opponent when out of mid-range and out of melee', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      offensive: { shieldChance: 0, dodgeChance: 0 },
    });
    const far = (frame: number) =>
      makeWorld(frame, { position: { x: 0, y: 100 } }, [
        makeOpp(1, { position: { x: 250, y: 100 } }),
      ]);
    bot.pushPerception(0, far(0));
    bot.sample(0);
    bot.pushPerception(1, far(1));
    const input = bot.sample(1);
    // Out of ranged-attack max (180 default) → fall through to neutral
    // jab branch's gap-close.
    expect(input.moveX).toBe(1);
    expect(input.attack).toBe(false);
  });

  it('NEVER fishes for KO smash from neutral at high opponent damage (Medium delta vs Hard)', () => {
    // Hard tier dashes in for a smash when the opponent is at KO%.
    // Medium has no such branch — it either combos (as a chain
    // follow-up) or fires the contextually appropriate verb. With no
    // combo staged and the opponent in melee range, the bot jab-s, not
    // smashes.
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      offensive: { shieldChance: 0, dodgeChance: 0 },
    });
    const koSetup = (frame: number) =>
      makeWorld(frame, { position: { x: 0, y: 100 } }, [
        makeOpp(1, {
          position: { x: 30, y: 100 },
          // Opponent at ~150 % — Hard would fish for a smash KO from
          // neutral. Medium will not.
          damagePercent: 150,
        }),
      ]);

    bot.pushPerception(0, koSetup(0));
    bot.sample(0);

    // Sample many post-warmup frames — the bot should never emit
    // attackHeavy from neutral. (Combo follow-ups *can* smash via
    // `attackHeavy` per the Medium combo policy at KO%, but with NO
    // landed hit registered, no combo is staged, so attackHeavy must
    // stay false.)
    let attackHeavyFrames = 0;
    for (let f = 1; f < 30; f += 1) {
      bot.pushPerception(f, koSetup(f));
      const input = bot.sample(f);
      if (input.attackHeavy) attackHeavyFrames += 1;
    }
    expect(attackHeavyFrames).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pillar 5: recovery sub-tree priority (off-stage)
// ---------------------------------------------------------------------------

describe('MediumTierAI — recovery sub-tree priority', () => {
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

  it('falls through to the offensive sub-tree when on-stage', () => {
    const bot = makeBot({
      inputDelay: { mode: 'fixed', frames: 1 },
      // Disable defensive + ranged branches so the on-stage decision
      // pins on the gap-close verb of the neutral-jab Sequence —
      // confirms the recovery sub-tree did NOT take priority.
      offensive: {
        shieldChance: 0,
        dodgeChance: 0,
        rangedEnabled: false,
      },
    });
    bot.pushPerception(0, makeWorld(0));
    bot.sample(0);
    // Opponent on stage at +100, bot at 0. Falls through to the
    // neutral-jab branch which emits `moveRight` to close the gap.
    bot.pushPerception(1, makeWorld(1));
    const input = bot.sample(1);
    expect(input.moveX).toBe(1);
    expect(input.jump).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism — same seed + same perception stream → same outputs
// ---------------------------------------------------------------------------

describe('MediumTierAI — determinism', () => {
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

    // With opponent in attacking state, the probabilistic shield/dodge
    // gates eventually diverge across the two RNG streams.
    const worlds = Array.from({ length: 80 }, (_, i) =>
      makeWorld(i, {}, [
        makeOpp(1, { position: { x: 50, y: 100 }, stateLabel: 'attacking' }),
      ]),
    );

    const aInputs = driveBot(a, worlds);
    const bInputs = driveBot(b, worlds);

    let diverged = false;
    for (let i = 30; i < worlds.length; i += 1) {
      if (JSON.stringify(aInputs[i]) !== JSON.stringify(bInputs[i])) {
        diverged = true;
        break;
      }
    }
    expect(diverged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Snapshot / restore — round-trip preserves subsequent decisions
// ---------------------------------------------------------------------------

describe('MediumTierAI — snapshot / restore', () => {
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
    expect(typeof snap.offensiveTickCount).toBe('number');
    expect(typeof snap.recoveryTickCount).toBe('number');
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

    const snap = bot.snapshot();
    const fresh = makeBot({
      rng: new Rng(seed),
      inputDelay: { mode: 'fixed', frames: 3 },
    });
    fresh.restoreSnapshot(snap);

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

    const a: Array<ReturnType<MediumTierAI['sample']>> = [];
    const b: Array<ReturnType<MediumTierAI['sample']>> = [];
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

describe('MediumTierAI — reset cascade', () => {
  let bot: MediumTierAI;

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

  it('preserves construction-time tunables across reset', () => {
    const resetBot = makeBot({ inputDelay: { mode: 'fixed', frames: 12 } });
    resetBot.reset();
    expect(resetBot.getReactionSystem().getInputDelayFrames()).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Sticky target selection — bot doesn't thrash between opponents
// ---------------------------------------------------------------------------

describe('MediumTierAI — sticky target selection', () => {
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
