import { describe, it, expect } from 'vitest';
import {
  AIInputProvider,
  type AIInputCommand,
  type AIInputProviderOptions,
} from './AIInputProvider';
import {
  buildWorldSnapshot,
  type PerceivedSelf,
  type PerceivedStage,
  type WorldSnapshot,
} from './perception/WorldSnapshot';
import type { PlayerSlotIndex } from '../input/InputProvider';
import { Rng } from '../utils/Rng';

/**
 * AC 10201 Sub-AC 1 — `AIInputProvider` base class.
 *
 * The base class is the bridge between the AI's intent verbs (`jab`,
 * `moveRight`, `jump`, `shield`, …) and the deterministic
 * `CharacterInput` shape consumed by `Character.applyInput`. The test
 * suite locks down:
 *
 *   1. Slot identity + label plumbing — the constructor surfaces the
 *      slot index and a sensible default debug label.
 *   2. Verb translation — every emit verb maps onto the right
 *      `CharacterInput` field. Movement verbs set `moveX`; press
 *      verbs set their respective flag; combined emits in one tick
 *      produce both effects (forward tilt, etc.).
 *   3. Hold semantics — a single emit registers as a single-frame
 *      press by default. `pressHoldFrames` extends the hold window.
 *      `idle` releases every held button.
 *   4. Frame discipline — the same frame returns the cached input
 *      without re-ticking the subclass; backwards frames throw.
 *   5. `reset()` cascade — clears the press map, last-frame cache,
 *      and calls the subclass's `onReset()` hook.
 *   6. Determinism — two providers seeded with the same Rng and fed
 *      the same command stream produce byte-identical samples.
 *   7. Ledge release — emitted as a one-shot intent that lands on
 *      one frame and clears on the next.
 */

// ---------------------------------------------------------------------------
// Test scaffolding — programmable subclass that emits whatever the test
// queues into it. Keeps every test free of bespoke decision logic.
// ---------------------------------------------------------------------------

class ScriptedBot extends AIInputProvider {
  private script: ReadonlyArray<readonly AIInputCommand[]> = [];
  public decideCallCount = 0;
  public lastDecideFrame: number | null = null;
  public resetCount = 0;

  setScript(script: ReadonlyArray<readonly AIInputCommand[]>): void {
    this.script = script;
  }

  protected decide(frame: number): readonly AIInputCommand[] {
    this.decideCallCount += 1;
    this.lastDecideFrame = frame;
    const idx = Math.min(frame, this.script.length - 1);
    return this.script[idx] ?? [];
  }

  protected onReset(): void {
    this.resetCount += 1;
  }
}

function makeBot(
  partial: Partial<AIInputProviderOptions> = {},
): ScriptedBot {
  return new ScriptedBot({
    slotIndex: partial.slotIndex ?? 2,
    rng: partial.rng ?? new Rng(0xc0ffee),
    label: partial.label,
    pressHoldFrames: partial.pressHoldFrames,
    defaultMoveAxis: partial.defaultMoveAxis,
  });
}

// ---------------------------------------------------------------------------
// Slot identity + labels
// ---------------------------------------------------------------------------

describe('AIInputProvider — slot identity', () => {
  it('exposes slotIndex from constructor options', () => {
    const bot = makeBot({ slotIndex: 3 });
    expect(bot.slotIndex).toBe(3);
  });

  it('produces a default label scoped to the slot', () => {
    expect(makeBot({ slotIndex: 0 }).label).toBe('ai.bot.slot0');
    expect(makeBot({ slotIndex: 2 }).label).toBe('ai.bot.slot2');
  });

  it('honours an explicit label override', () => {
    expect(makeBot({ label: 'hard.wolf' }).label).toBe('hard.wolf');
  });
});

// ---------------------------------------------------------------------------
// Verb translation
// ---------------------------------------------------------------------------

describe('AIInputProvider — movement verbs', () => {
  it('moveLeft → moveX = -1', () => {
    const bot = makeBot();
    bot.setScript([[{ kind: 'moveLeft' }]]);
    expect(bot.sample(0).moveX).toBe(-1);
  });

  it('moveRight → moveX = +1', () => {
    const bot = makeBot();
    bot.setScript([[{ kind: 'moveRight' }]]);
    expect(bot.sample(0).moveX).toBe(1);
  });

  it('moveUp / moveDown leave moveX at 0', () => {
    const bot = makeBot();
    bot.setScript([[{ kind: 'moveUp' }], [{ kind: 'moveDown' }]]);
    expect(bot.sample(0).moveX).toBe(0);
    expect(bot.sample(1).moveX).toBe(0);
  });

  it('moveAxis carries an analog value clamped to [-1, 1]', () => {
    const bot = makeBot();
    bot.setScript([
      [{ kind: 'moveAxis', value: 0.4 }],
      [{ kind: 'moveAxis', value: 1.5 }],
      [{ kind: 'moveAxis', value: -2 }],
      [{ kind: 'moveAxis', value: NaN }],
    ]);
    expect(bot.sample(0).moveX).toBe(0.4);
    expect(bot.sample(1).moveX).toBe(1);
    expect(bot.sample(2).moveX).toBe(-1);
    expect(bot.sample(3).moveX).toBe(0);
  });

  it('last movement emit in a tick wins', () => {
    const bot = makeBot();
    bot.setScript([
      [{ kind: 'moveLeft' }, { kind: 'moveRight' }],
    ]);
    expect(bot.sample(0).moveX).toBe(1);
  });

  it('falls back to defaultMoveAxis when no movement verb is emitted', () => {
    const bot = makeBot({ defaultMoveAxis: 0.5 });
    bot.setScript([[]]);
    expect(bot.sample(0).moveX).toBe(0.5);
  });
});

describe('AIInputProvider — press verbs', () => {
  it.each([
    ['jump', 'jump'],
    ['attack', 'attack'],
    ['attackHeavy', 'attackHeavy'],
    ['shield', 'shield'],
    ['dodge', 'dodge'],
    ['dropThrough', 'dropThrough'],
  ] as const)(
    'emit %s → CharacterInput.%s = true',
    (verbKind, fieldKey) => {
      const bot = makeBot();
      bot.setScript([[{ kind: verbKind }]]);
      const sampled = bot.sample(0);
      expect(sampled[fieldKey as keyof typeof sampled]).toBe(true);
    },
  );

  it('special verb routes through the attackHeavy slot until a dedicated field lands', () => {
    const bot = makeBot();
    bot.setScript([[{ kind: 'special' }]]);
    expect(bot.sample(0).attackHeavy).toBe(true);
    expect(bot.sample(0).attack).toBe(false);
  });

  it('combines movement + attack into a forward-tilt input on the same tick', () => {
    const bot = makeBot();
    bot.setScript([[{ kind: 'moveRight' }, { kind: 'attack' }]]);
    const tilt = bot.sample(0);
    expect(tilt.moveX).toBe(1);
    expect(tilt.attack).toBe(true);
  });

  it('idle clears any held press', () => {
    const bot = makeBot({ pressHoldFrames: 5 });
    bot.setScript([
      [{ kind: 'shield' }],
      [{ kind: 'idle' }],
    ]);
    expect(bot.sample(0).shield).toBe(true);
    expect(bot.sample(1).shield).toBe(false);
  });

  it('an empty emit batch produces a fully-neutral sample', () => {
    const bot = makeBot();
    bot.setScript([[]]);
    const neutral = bot.sample(0);
    expect(neutral.moveX).toBe(0);
    expect(neutral.jump).toBe(false);
    expect(neutral.attack).toBe(false);
    expect(neutral.attackHeavy).toBe(false);
    expect(neutral.shield).toBe(false);
    expect(neutral.dodge).toBe(false);
    expect(neutral.dropThrough).toBe(false);
    expect(neutral.ledgeRelease).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Hold semantics
// ---------------------------------------------------------------------------

describe('AIInputProvider — hold semantics', () => {
  it('default press hold lasts exactly one frame so a single emit registers as a single press', () => {
    const bot = makeBot();
    bot.setScript([[{ kind: 'jump' }], [], []]);
    expect(bot.sample(0).jump).toBe(true);
    expect(bot.sample(1).jump).toBe(false);
    expect(bot.sample(2).jump).toBe(false);
  });

  it('pressHoldFrames > 1 holds the press across that many frames before release', () => {
    const bot = makeBot({ pressHoldFrames: 3 });
    bot.setScript([
      [{ kind: 'attack' }], // emit on frame 0 → held for frames 0..2
      [],
      [],
      [],
    ]);
    expect(bot.sample(0).attack).toBe(true);
    expect(bot.sample(1).attack).toBe(true);
    expect(bot.sample(2).attack).toBe(true);
    expect(bot.sample(3).attack).toBe(false);
  });

  it('re-emitting a press resets its hold counter', () => {
    const bot = makeBot({ pressHoldFrames: 2 });
    bot.setScript([
      [{ kind: 'shield' }],
      [{ kind: 'shield' }],
      [],
      [],
    ]);
    expect(bot.sample(0).shield).toBe(true);
    expect(bot.sample(1).shield).toBe(true);
    expect(bot.sample(2).shield).toBe(true);
    expect(bot.sample(3).shield).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Frame discipline
// ---------------------------------------------------------------------------

describe('AIInputProvider — frame discipline', () => {
  it('returns the cached input when sample() is called twice with the same frame', () => {
    const bot = makeBot();
    bot.setScript([[{ kind: 'attack' }]]);
    const first = bot.sample(0);
    const second = bot.sample(0);
    expect(first).toBe(second); // reference equality — same cached object
    expect(bot.decideCallCount).toBe(1);
  });

  it('throws if sample() is called with a frame earlier than the last sampled frame', () => {
    const bot = makeBot();
    bot.setScript([[], [], []]);
    bot.sample(2);
    expect(() => bot.sample(1)).toThrowError(/reset\(\) the provider/);
  });

  it('rejects non-integer / negative frame indices', () => {
    const bot = makeBot();
    bot.setScript([[]]);
    expect(() => bot.sample(-1)).toThrow();
    expect(() => bot.sample(1.5)).toThrow();
    expect(() => bot.sample(NaN)).toThrow();
  });

  it('forwards the frame index to the subclass decide() hook', () => {
    const bot = makeBot();
    bot.setScript([[], [], []]);
    bot.sample(0);
    bot.sample(1);
    bot.sample(2);
    expect(bot.lastDecideFrame).toBe(2);
    expect(bot.decideCallCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('AIInputProvider — reset', () => {
  it('clears press holds and lets sample() be called with frame 0 again', () => {
    const bot = makeBot({ pressHoldFrames: 5 });
    bot.setScript([
      [{ kind: 'shield' }],
      [],
    ]);
    expect(bot.sample(0).shield).toBe(true);
    bot.reset();
    bot.setScript([[]]);
    // After reset we can sample frame 0 fresh; press hold is gone.
    const post = bot.sample(0);
    expect(post.shield).toBe(false);
    expect(post.moveX).toBe(0);
  });

  it('cascades into the subclass onReset() hook', () => {
    const bot = makeBot();
    expect(bot.resetCount).toBe(0);
    bot.reset();
    bot.reset();
    expect(bot.resetCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Ledge release
// ---------------------------------------------------------------------------

describe('AIInputProvider — ledge release', () => {
  it('latches a ledge-release intent for a single frame', () => {
    const bot = makeBot();
    bot.setScript([
      [{ kind: 'ledgeRelease', action: 'jump' }],
      [],
    ]);
    expect(bot.sample(0).ledgeRelease).toBe('jump');
    expect(bot.sample(1).ledgeRelease).toBe(null);
  });

  it('idle clears any pending ledge release', () => {
    const bot = makeBot();
    bot.setScript([
      [{ kind: 'ledgeRelease', action: 'getUp' }, { kind: 'idle' }],
    ]);
    expect(bot.sample(0).ledgeRelease).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('AIInputProvider — determinism', () => {
  it('two bots fed the same command stream produce byte-identical samples', () => {
    const a = makeBot({ rng: new Rng(0x1234) });
    const b = makeBot({ rng: new Rng(0x1234) });

    const script: ReadonlyArray<readonly AIInputCommand[]> = [
      [{ kind: 'moveRight' }, { kind: 'attack' }],
      [{ kind: 'jump' }],
      [{ kind: 'shield' }],
      [],
      [{ kind: 'ledgeRelease', action: 'getUp' }],
    ];
    a.setScript(script);
    b.setScript(script);

    for (let f = 0; f < script.length; f += 1) {
      expect(a.sample(f)).toEqual(b.sample(f));
    }
  });
});

// ---------------------------------------------------------------------------
// Structural compatibility — base class implements PlayerInputProvider
// ---------------------------------------------------------------------------

describe('AIInputProvider — PlayerInputProvider compatibility', () => {
  it('an AIInputProvider conforms structurally to the slotIndex + sample contract', () => {
    const bot = makeBot();
    bot.setScript([[]]);

    // Structural type check: assignable to the minimum
    // PlayerInputProvider shape without an `as` cast.
    const provider: {
      readonly slotIndex: number;
      sample(frame: number): unknown;
      reset?(): void;
    } = bot;

    const out = provider.sample(0);
    expect(out).toMatchObject({
      moveX: 0,
      jump: false,
      attack: false,
    });
    expect(typeof provider.reset).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Perception hook (AC 10201 Sub-AC 1) — perceive(frame) → WorldSnapshot
// ---------------------------------------------------------------------------
//
// Sub-AC 1 mandates the controller "include perception of game state
// (player positions, stage geometry, current move state)". The base
// class wires an optional `perceive(frame)` hook that:
//
//   • Runs once per `sample()` *before* `decide()`.
//   • Returns a `WorldSnapshot` (player positions, stage geometry,
//     opponent state labels, optional self current-move state).
//   • Is forwarded as the second argument to `decide()` so the
//     subclass's decision logic can react to it.
//   • Is cached on the controller for `getLatestSnapshot()` so debug
//     overlays / replay tooling can inspect post-sample.
//   • Defaults to `null` so adapter-style bots (the `ScriptedBot` used
//     by the rest of this suite) pay nothing.
//
// This block exercises every contract above with a perception-aware
// subclass that emits a verb conditioned on the snapshot.

/**
 * Build a simple `WorldSnapshot` for tests. Slot indices and the
 * stage / blast-zone box are picked to satisfy `buildWorldSnapshot`'s
 * invariants without forcing every test to spell them out.
 */
function makeSnapshot(
  tickIndex: number,
  selfOverrides: Partial<PerceivedSelf> = {},
  stageOverrides: Partial<PerceivedStage> = {},
): WorldSnapshot {
  const stage: PerceivedStage = {
    stageLeft: -200,
    stageRight: 200,
    stageTop: 100,
    blastZone: { left: -400, right: 400, top: -300, bottom: 400 },
    ...stageOverrides,
  };
  const self: PerceivedSelf = {
    slotIndex: 0,
    position: { x: 0, y: 0 },
    velocity: { vx: 0, vy: 0 },
    facing: 1,
    damagePercent: 0,
    stocksRemaining: 3,
    isAirborne: false,
    isInHitstun: false,
    isOnLedge: false,
    currentMove: null,
    ...selfOverrides,
  };
  return buildWorldSnapshot({
    tickIndex,
    self,
    opponents: [],
    stage,
  });
}

/**
 * Subclass that snapshots a programmable WorldSnapshot per frame and
 * emits a verb based on what it perceives. Lets the test assert both
 * "perception happened" and "decision used the snapshot".
 */
class PerceivingBot extends AIInputProvider {
  public perceiveCallCount = 0;
  public lastPerceivedFrame: number | null = null;
  public decideSnapshots: Array<WorldSnapshot | null> = [];
  private snapshotScript: ReadonlyArray<WorldSnapshot | null> = [];

  setSnapshotScript(script: ReadonlyArray<WorldSnapshot | null>): void {
    this.snapshotScript = script;
  }

  protected perceive(frame: number): WorldSnapshot | null {
    this.perceiveCallCount += 1;
    this.lastPerceivedFrame = frame;
    return this.snapshotScript[frame] ?? null;
  }

  protected decide(
    _frame: number,
    snapshot?: WorldSnapshot | null,
  ): readonly AIInputCommand[] {
    this.decideSnapshots.push(snapshot ?? null);
    if (snapshot === null || snapshot === undefined) return [];
    // Move toward whichever side the bot is facing — purely so the
    // test can confirm the snapshot reached the decide() body.
    return snapshot.self.facing === 1
      ? [{ kind: 'moveRight' }]
      : [{ kind: 'moveLeft' }];
  }
}

function makePerceivingBot(
  partial: Partial<AIInputProviderOptions> = {},
): PerceivingBot {
  return new PerceivingBot({
    slotIndex: (partial.slotIndex ?? 0) as PlayerSlotIndex,
    rng: partial.rng ?? new Rng(0xc0ffee),
    label: partial.label,
    pressHoldFrames: partial.pressHoldFrames,
    defaultMoveAxis: partial.defaultMoveAxis,
  });
}

describe('AIInputProvider — perception hook (AC 10201 Sub-AC 1)', () => {
  it('default perceive() returns null and does not mutate the latest-snapshot cache', () => {
    const bot = makeBot();
    bot.setScript([[]]);
    expect(bot.getLatestSnapshot()).toBe(null);
    bot.sample(0);
    // Adapter-style ScriptedBot doesn't override perceive(), so the
    // base default returns null and the cache stays null.
    expect(bot.getLatestSnapshot()).toBe(null);
  });

  it('calls perceive() exactly once per new frame, before decide()', () => {
    const bot = makePerceivingBot();
    bot.setSnapshotScript([
      makeSnapshot(0),
      makeSnapshot(1),
      makeSnapshot(2),
    ]);
    bot.sample(0);
    bot.sample(1);
    bot.sample(2);
    expect(bot.perceiveCallCount).toBe(3);
    expect(bot.lastPerceivedFrame).toBe(2);
    expect(bot.decideSnapshots).toHaveLength(3);
  });

  it('does not re-call perceive() when the same frame is sampled twice', () => {
    const bot = makePerceivingBot();
    bot.setSnapshotScript([makeSnapshot(0)]);
    bot.sample(0);
    bot.sample(0);
    expect(bot.perceiveCallCount).toBe(1);
  });

  it('forwards the snapshot from perceive() into decide()', () => {
    const bot = makePerceivingBot();
    const snap0 = makeSnapshot(0, { facing: 1 });
    const snap1 = makeSnapshot(1, { facing: -1 });
    bot.setSnapshotScript([snap0, snap1]);
    expect(bot.sample(0).moveX).toBe(1); // facing right → moveRight
    expect(bot.sample(1).moveX).toBe(-1); // facing left  → moveLeft
    expect(bot.decideSnapshots[0]).toBe(snap0);
    expect(bot.decideSnapshots[1]).toBe(snap1);
  });

  it('caches the latest snapshot and exposes it via getLatestSnapshot()', () => {
    const bot = makePerceivingBot();
    const snap = makeSnapshot(0, { damagePercent: 42 });
    bot.setSnapshotScript([snap]);
    expect(bot.getLatestSnapshot()).toBe(null);
    bot.sample(0);
    const latest = bot.getLatestSnapshot();
    expect(latest).toBe(snap); // reference equality — same object
    expect(latest?.self.damagePercent).toBe(42);
  });

  it('reset() clears the cached snapshot', () => {
    const bot = makePerceivingBot();
    bot.setSnapshotScript([makeSnapshot(0)]);
    bot.sample(0);
    expect(bot.getLatestSnapshot()).not.toBe(null);
    bot.reset();
    expect(bot.getLatestSnapshot()).toBe(null);
  });

  it('snapshot carries player positions, stage geometry, and current move state', () => {
    const bot = makePerceivingBot();
    const snap = makeSnapshot(
      0,
      {
        position: { x: 50, y: -10 },
        currentMove: {
          kind: 'jab',
          phase: 'active',
          framesRemaining: 2,
        },
      },
      {
        stageLeft: -300,
        stageRight: 300,
      },
    );
    bot.setSnapshotScript([snap]);
    bot.sample(0);
    const latest = bot.getLatestSnapshot();
    expect(latest).not.toBe(null);
    // Player positions
    expect(latest?.self.position).toEqual({ x: 50, y: -10 });
    // Stage geometry
    expect(latest?.stage.stageLeft).toBe(-300);
    expect(latest?.stage.stageRight).toBe(300);
    expect(latest?.stage.blastZone).toBeDefined();
    // Current move state
    expect(latest?.self.currentMove).toEqual({
      kind: 'jab',
      phase: 'active',
      framesRemaining: 2,
    });
  });

  it('a subclass that returns null from perceive() still drives decide() and emits cleanly', () => {
    const bot = makePerceivingBot();
    bot.setSnapshotScript([null]);
    const sample = bot.sample(0);
    expect(bot.perceiveCallCount).toBe(1);
    expect(bot.decideSnapshots[0]).toBe(null);
    // Decide returns [] when snapshot is null, so the input is neutral.
    expect(sample.moveX).toBe(0);
    expect(sample.attack).toBe(false);
    expect(bot.getLatestSnapshot()).toBe(null);
  });
});
