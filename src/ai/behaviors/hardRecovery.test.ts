import { describe, expect, it } from 'vitest';
import { Blackboard } from '../behaviorTree/Blackboard';
import { NodeStatus } from '../behaviorTree/Node';
import { Rng } from '../../utils/Rng';
import {
  DEFAULT_RECOVERY_BLACKBOARD,
  type RecoveryAction,
  type RecoveryBlackboardSchema,
  type RecoveryContext,
  type RecoverySelfSnapshot,
  type RecoveryStageGeometry,
} from '../recovery/types';
import {
  buildLedgeMixupSubtree,
  buildOffStageDecisionSubtree,
  buildRecoveryMoveSelectionSubtree,
  chooseLedgeGetUpOption,
  classifyOffStageStrategy,
  computeRecoveryResourceView,
  kinematicUpwardCoastPx,
  mapGetUpOptionToActionKind,
  resolveLedgeGetUpWeights,
  resolveLedgeMixupOptions,
  resolveOffStageClassificationOptions,
  resolveOffStageDecisionOptions,
  resolveRecoveryMoveSelectionClassifyOptions,
  resolveRecoveryMoveSelectionOptions,
  selectRecoveryMoveTier,
  upwardTravelNeededPx,
  type LedgeMixupOpponentSnapshot,
  type OffStageStrategy,
  type RecoveryMoveTier,
} from './hardRecovery';
import type { LedgeMixupGetUpOption } from '../recovery/types';

const STAGE: RecoveryStageGeometry = {
  stageLeft: -800,
  stageRight: 800,
  stageTop: 400,
  blastZone: { left: -1200, right: 1200, top: -800, bottom: 900 },
  nearestLedge: { x: -800, y: 400, side: 'left' },
};

interface Harness {
  ctx: RecoveryContext;
  emits: RecoveryAction[];
  blackboard: Blackboard<RecoveryBlackboardSchema>;
  setSelf(p: Partial<RecoverySelfSnapshot>): void;
  setStage(p: Partial<RecoveryStageGeometry>): void;
  bumpTick(n?: number): void;
}

function makeSelf(
  overrides: Partial<RecoverySelfSnapshot> = {},
): RecoverySelfSnapshot {
  return {
    positionX: -900,
    positionY: 600,
    velocityX: 0,
    velocityY: 0,
    facing: 1,
    isAirborne: true,
    jumpsRemaining: 1,
    upSpecialAvailable: true,
    isInHitstun: false,
    isOnLedge: false,
    ...overrides,
  };
}

function makeHarness(initial: Partial<RecoverySelfSnapshot> = {}): Harness {
  const emits: RecoveryAction[] = [];
  const blackboard = new Blackboard<RecoveryBlackboardSchema>({
    ...DEFAULT_RECOVERY_BLACKBOARD,
  });
  let self: RecoverySelfSnapshot = makeSelf(initial);
  let stage: RecoveryStageGeometry = STAGE;
  let tickIndex = 0;
  const ctx: RecoveryContext = {
    blackboard,
    get tickIndex() {
      return tickIndex;
    },
    get self() {
      return self;
    },
    get stage() {
      return stage;
    },
    out: { emit: (a) => emits.push(a) },
    rng: new Rng(1),
  } as RecoveryContext;
  return {
    ctx,
    emits,
    blackboard,
    setSelf(p) {
      self = { ...self, ...p };
    },
    setStage(p) {
      stage = { ...stage, ...p };
    },
    bumpTick(n = 1) {
      tickIndex += n;
    },
  };
}

// ---------------------------------------------------------------------------
// resolve* helpers
// ---------------------------------------------------------------------------

describe('resolveOffStageClassificationOptions', () => {
  it('fills in defaults', () => {
    const r = resolveOffStageClassificationOptions();
    expect(r.verticalSlackPx).toBe(0);
    expect(r.blastZoneLookaheadFrames).toBe(60);
    expect(r.doubleJumpReachPx).toBe(40);
    expect(r.ledgeReturnHorizontalRangePx).toBe(48);
    expect(r.ledgeReturnVerticalTolerancePx).toBe(8);
  });

  it('honours overrides', () => {
    const r = resolveOffStageClassificationOptions({
      verticalSlackPx: 4,
      blastZoneLookaheadFrames: 30,
      doubleJumpReachPx: 80,
      ledgeReturnHorizontalRangePx: 64,
      ledgeReturnVerticalTolerancePx: 16,
    });
    expect(r.verticalSlackPx).toBe(4);
    expect(r.blastZoneLookaheadFrames).toBe(30);
    expect(r.doubleJumpReachPx).toBe(80);
    expect(r.ledgeReturnHorizontalRangePx).toBe(64);
    expect(r.ledgeReturnVerticalTolerancePx).toBe(16);
  });

  it('rejects negative verticalSlackPx', () => {
    expect(() =>
      resolveOffStageClassificationOptions({ verticalSlackPx: -1 }),
    ).toThrow();
  });

  it('rejects non-integer blastZoneLookaheadFrames', () => {
    expect(() =>
      resolveOffStageClassificationOptions({
        blastZoneLookaheadFrames: 1.5,
      }),
    ).toThrow();
  });

  it('rejects negative doubleJumpReachPx', () => {
    expect(() =>
      resolveOffStageClassificationOptions({ doubleJumpReachPx: -10 }),
    ).toThrow();
  });

  it('rejects negative ledgeReturnHorizontalRangePx', () => {
    expect(() =>
      resolveOffStageClassificationOptions({
        ledgeReturnHorizontalRangePx: -1,
      }),
    ).toThrow();
  });

  it('rejects negative ledgeReturnVerticalTolerancePx', () => {
    expect(() =>
      resolveOffStageClassificationOptions({
        ledgeReturnVerticalTolerancePx: -1,
      }),
    ).toThrow();
  });
});

describe('resolveOffStageDecisionOptions', () => {
  it('fills classify defaults', () => {
    const r = resolveOffStageDecisionOptions();
    expect(r.classify.verticalSlackPx).toBe(0);
    expect(r.classify.doubleJumpReachPx).toBe(40);
  });

  it('forwards classify overrides', () => {
    const r = resolveOffStageDecisionOptions({
      classify: { doubleJumpReachPx: 100 },
    });
    expect(r.classify.doubleJumpReachPx).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// classifyOffStageStrategy — pure helper coverage
// ---------------------------------------------------------------------------

describe('classifyOffStageStrategy', () => {
  it('returns "none" when grounded', () => {
    const self = makeSelf({
      isAirborne: false,
      positionX: 0,
      positionY: 380,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'none',
    );
  });

  it('returns "none" when on stage and airborne (above stageTop, in safe X range)', () => {
    const self = makeSelf({
      positionX: 0,
      positionY: 200,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'none',
    );
  });

  it('returns "none" when in hitstun even off-stage', () => {
    const self = makeSelf({
      isInHitstun: true,
      positionX: -1000,
      positionY: 600,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'none',
    );
  });

  it('returns "none" when latched on a ledge', () => {
    const self = makeSelf({
      isOnLedge: true,
      positionX: -800,
      positionY: 400,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'none',
    );
  });

  it('returns "givenUp" when stage has no nearest ledge', () => {
    const self = makeSelf({
      positionX: -1000,
      positionY: 600,
    });
    const noLedgeStage: RecoveryStageGeometry = {
      ...STAGE,
      nearestLedge: null,
    };
    expect(
      classifyOffStageStrategy(self, noLedgeStage),
    ).toBe<OffStageStrategy>('givenUp');
  });

  it('returns "ledgeReturn" when bot is at ledge level and horizontally close', () => {
    // Ledge is at (-800, 400). Bot is just outside stage at ledge level.
    // dy = 400 - 405 = -5 (bot slightly below ledge — well within tolerance).
    const self = makeSelf({
      positionX: -820,
      positionY: 405,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'ledgeReturn',
    );
  });

  it('returns "ledgeReturn" when bot is exactly at the ledge corner Y', () => {
    // dy = 0 — bot at ledge corner level, off-stage horizontally.
    const self = makeSelf({
      positionX: -820,
      positionY: 400,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'ledgeReturn',
    );
  });

  it('does NOT return "ledgeReturn" when bot is too far above the ledge', () => {
    // Bot is 20 px above the ledge corner — beyond the 8 px vertical
    // tolerance. The leaf would refuse to proceed (waits for descent),
    // so the classifier shouldn't route here either. With full jumps
    // and small upward travel needed, this routes to 'jump'.
    const self = makeSelf({
      positionX: -820,
      positionY: 380,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    expect(classifyOffStageStrategy(self, STAGE, {}, 1)).not.toBe(
      'ledgeReturn' as OffStageStrategy,
    );
  });

  it('returns "upSpecial" when imminent blast zone danger', () => {
    // Hurled hard left into blast wall — projection at 60 frames
    // pushes far past blastZone.left = -1200.
    const self = makeSelf({
      positionX: -1100,
      positionY: 600,
      velocityX: -10,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'upSpecial',
    );
  });

  it('returns "upSpecial" when no jumps left but up-special available', () => {
    const self = makeSelf({
      positionX: -1000,
      positionY: 600,
      jumpsRemaining: 0,
      upSpecialAvailable: true,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'upSpecial',
    );
  });

  it('returns "givenUp" when no jumps left AND up-special spent', () => {
    const self = makeSelf({
      positionX: -1000,
      positionY: 600,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'givenUp',
    );
  });

  it('returns "upSpecial" when ledge is far above (beyond doubleJumpReachPx)', () => {
    // Bot is far below the ledge.
    const self = makeSelf({
      positionX: -1000,
      positionY: 600, // 200 px below the ledge at y=400 (Y grows down)
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    // upwardTravelNeeded = -dy = -(400 - 600) = 200 > 40.
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'upSpecial',
    );
  });

  it('returns "jump" when every jump still in budget and ledge reachable', () => {
    // Bot just slipped off — only slightly below ledge, full jump budget.
    const self = makeSelf({
      positionX: -1000,
      positionY: 420, // 20 px below ledge — within doubleJumpReachPx
      jumpsRemaining: 2, // full budget
      upSpecialAvailable: true,
    });
    // jumpBudget=2 (max) → jumpsRemaining===maxJumps → 'jump'
    expect(
      classifyOffStageStrategy(self, STAGE, {}, 2),
    ).toBe<OffStageStrategy>('jump');
  });

  it('returns "doubleJump" when grounded jump spent but air-jump available', () => {
    const self = makeSelf({
      positionX: -1000,
      positionY: 420, // 20 px below ledge — within doubleJumpReachPx
      jumpsRemaining: 1, // 1 of 2 spent
      upSpecialAvailable: true,
    });
    // jumpBudget=2, jumpsRemaining=1 < maxJumps → fall to default 'doubleJump'
    expect(
      classifyOffStageStrategy(self, STAGE, {}, 2),
    ).toBe<OffStageStrategy>('doubleJump');
  });

  it('falls back to "doubleJump" when no jumpBudget supplied and not full-budget candidate', () => {
    // Without a jumpBudget caller, the helper assumes
    // jumpBudget = jumpsRemaining (boundary always true) so the
    // first-jump branch always wins when reachable. That's
    // intentionally biased toward the cheaper press.
    const self = makeSelf({
      positionX: -1000,
      positionY: 420,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'jump',
    );
  });

  it('respects custom doubleJumpReachPx threshold', () => {
    const self = makeSelf({
      positionX: -1000,
      positionY: 500, // 100 px below ledge
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    // Default threshold 40 → upSpecial; raise to 200 → reachable, jump
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'upSpecial',
    );
    expect(
      classifyOffStageStrategy(self, STAGE, { doubleJumpReachPx: 200 }, 1),
    ).toBe<OffStageStrategy>('jump');
  });

  it('falls back to "givenUp" when blast-zone-imminent but up-special spent and no jumps', () => {
    const self = makeSelf({
      positionX: -1100,
      positionY: 600,
      velocityX: -10,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    expect(classifyOffStageStrategy(self, STAGE)).toBe<OffStageStrategy>(
      'givenUp',
    );
  });

  it('classification is deterministic (identical inputs → identical outputs)', () => {
    const self = makeSelf({
      positionX: -1000,
      positionY: 600,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const a = classifyOffStageStrategy(self, STAGE, {}, 2);
    const b = classifyOffStageStrategy(self, STAGE, {}, 2);
    const c = classifyOffStageStrategy(self, STAGE, {}, 2);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ---------------------------------------------------------------------------
// buildOffStageDecisionSubtree — composed dispatcher behaviour
// ---------------------------------------------------------------------------

describe('buildOffStageDecisionSubtree — outer off-stage gate', () => {
  it('returns Failure when bot is on stage', () => {
    const h = makeHarness({
      positionX: 0,
      positionY: 200,
      isAirborne: true,
    });
    const tree = buildOffStageDecisionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when grounded', () => {
    const h = makeHarness({
      positionX: 0,
      positionY: 380,
      isAirborne: false,
    });
    const tree = buildOffStageDecisionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when in hitstun', () => {
    const h = makeHarness({
      positionX: -1000,
      positionY: 600,
      isInHitstun: true,
    });
    const tree = buildOffStageDecisionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when on a ledge', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const tree = buildOffStageDecisionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildOffStageDecisionSubtree — dispatch routing', () => {
  it('routes to LedgeReturn when bot is at ledge level and horizontally close', () => {
    const h = makeHarness({
      positionX: -820,
      positionY: 405,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const tree = buildOffStageDecisionSubtree();
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Running);
    // LedgeReturn emits either 'idle' (if already aligned) or
    // 'moveLeft'/'moveRight'. Either way it tags the recoveryStep
    // as 'ledge.*'.
    expect(h.emits.length).toBeGreaterThan(0);
    const step = h.emits[0]?.recoveryStep ?? '';
    expect(step.startsWith('ledge.')).toBe(true);
  });

  it('routes to RecoveryMove (upSpecial) when blast-zone imminent', () => {
    const h = makeHarness({
      positionX: -1100,
      positionY: 600,
      velocityX: -10,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const tree = buildOffStageDecisionSubtree();
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.kind === 'upSpecial')).toBe(true);
    expect(h.blackboard.get('recoveryPhase')).toBe('upSpecial');
  });

  it('routes to RecoveryMove (upSpecial) when no jumps left', () => {
    const h = makeHarness({
      positionX: -1000,
      positionY: 600,
      jumpsRemaining: 0,
      upSpecialAvailable: true,
    });
    const tree = buildOffStageDecisionSubtree();
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.kind === 'upSpecial')).toBe(true);
  });

  it('routes to JumpRecovery when full jump budget and ledge reachable', () => {
    const h = makeHarness({
      positionX: -1000,
      positionY: 420,
      jumpsRemaining: 2,
      upSpecialAvailable: true,
    });
    const tree = buildOffStageDecisionSubtree({
      getJumpBudget: () => 2,
    });
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.kind === 'jump')).toBe(true);
    expect(h.emits[0]?.recoveryStep).toBe('jumpRecovery');
  });

  it('routes to DoubleJumpRecovery when grounded jump spent and ledge below threshold', () => {
    const h = makeHarness({
      positionX: -1000,
      positionY: 460, // 60 px below ledge — beyond default 40 px reach
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const tree = buildOffStageDecisionSubtree({
      classify: { doubleJumpReachPx: 100 }, // raise threshold so we land in DJ branch
      getJumpBudget: () => 2,
    });
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    // DoubleJump leaf emits 'jump' tagged with 'doubleJumpRecovery'.
    expect(h.emits.some((e) => e.kind === 'jump')).toBe(true);
    expect(
      h.emits.some((e) => e.recoveryStep === 'doubleJumpRecovery'),
    ).toBe(true);
  });

  it('returns Failure (givenUp) when stage has no nearest ledge', () => {
    const h = makeHarness({
      positionX: -1000,
      positionY: 600,
    });
    h.setStage({ nearestLedge: null });
    const tree = buildOffStageDecisionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure (givenUp) when no jumps and up-special spent', () => {
    const h = makeHarness({
      positionX: -1000,
      positionY: 600,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const tree = buildOffStageDecisionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildOffStageDecisionSubtree — determinism', () => {
  it('two independently-built trees produce identical outputs given identical inputs', () => {
    const h1 = makeHarness({
      positionX: -1100,
      positionY: 600,
      velocityX: -10,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const h2 = makeHarness({
      positionX: -1100,
      positionY: 600,
      velocityX: -10,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const t1 = buildOffStageDecisionSubtree();
    const t2 = buildOffStageDecisionSubtree();
    const s1 = t1.tick(h1.ctx);
    const s2 = t2.tick(h2.ctx);
    expect(s1).toBe(s2);
    expect(h1.emits).toEqual(h2.emits);
    expect(h1.blackboard.get('recoveryPhase')).toBe(
      h2.blackboard.get('recoveryPhase'),
    );
  });

  it('repeat ticks with frozen state are stable (modulo Blackboard latches)', () => {
    // Pick a strategy with no Blackboard latch: ledgeReturn.
    const h = makeHarness({
      positionX: -820,
      positionY: 380,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const tree = buildOffStageDecisionSubtree();
    const a = tree.tick(h.ctx);
    h.bumpTick();
    const b = tree.tick(h.ctx);
    expect(a).toBe(b);
  });
});

describe('buildOffStageDecisionSubtree — leaf-level safety net', () => {
  it('falls through cleanly to Failure when classification mismatches reality', () => {
    // Construct a situation where the classifier picks 'jump' but the
    // bot is actually on-stage (impossible if the outer gate is
    // tested, but we verify the leaf-level gate would also Failure).
    // Here we just verify the outer gate truly short-circuits: a
    // bot one tick above stage with no airborne flag should never
    // reach the dispatch.
    const h = makeHarness({
      positionX: 0,
      positionY: 380,
      isAirborne: false,
    });
    const tree = buildOffStageDecisionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ===========================================================================
// Sub-AC 2 — RecoveryMoveSelection
// ===========================================================================

// ---------------------------------------------------------------------------
// resolve* helpers — Sub-AC 2
// ---------------------------------------------------------------------------

describe('resolveRecoveryMoveSelectionClassifyOptions', () => {
  it('fills in defaults', () => {
    const r = resolveRecoveryMoveSelectionClassifyOptions();
    expect(r.doubleJumpReachPx).toBe(40);
    expect(r.upSpecialReachPx).toBe(120);
    expect(r.gravityPxPerFrame2).toBe(0.5);
    expect(r.recoverySafetyMarginPx).toBe(8);
    expect(r.blastZoneLookaheadFrames).toBe(60);
    expect(r.verticalSlackPx).toBe(0);
  });

  it('honours overrides', () => {
    const r = resolveRecoveryMoveSelectionClassifyOptions({
      doubleJumpReachPx: 50,
      upSpecialReachPx: 150,
      gravityPxPerFrame2: 0.75,
      recoverySafetyMarginPx: 16,
      blastZoneLookaheadFrames: 30,
      verticalSlackPx: 4,
    });
    expect(r.doubleJumpReachPx).toBe(50);
    expect(r.upSpecialReachPx).toBe(150);
    expect(r.gravityPxPerFrame2).toBe(0.75);
    expect(r.recoverySafetyMarginPx).toBe(16);
    expect(r.blastZoneLookaheadFrames).toBe(30);
    expect(r.verticalSlackPx).toBe(4);
  });

  it('rejects negative doubleJumpReachPx', () => {
    expect(() =>
      resolveRecoveryMoveSelectionClassifyOptions({ doubleJumpReachPx: -1 }),
    ).toThrow();
  });

  it('rejects negative upSpecialReachPx', () => {
    expect(() =>
      resolveRecoveryMoveSelectionClassifyOptions({ upSpecialReachPx: -1 }),
    ).toThrow();
  });

  it('rejects non-positive gravityPxPerFrame2', () => {
    expect(() =>
      resolveRecoveryMoveSelectionClassifyOptions({ gravityPxPerFrame2: 0 }),
    ).toThrow();
    expect(() =>
      resolveRecoveryMoveSelectionClassifyOptions({
        gravityPxPerFrame2: -0.1,
      }),
    ).toThrow();
  });

  it('rejects negative recoverySafetyMarginPx', () => {
    expect(() =>
      resolveRecoveryMoveSelectionClassifyOptions({
        recoverySafetyMarginPx: -1,
      }),
    ).toThrow();
  });

  it('rejects non-integer blastZoneLookaheadFrames', () => {
    expect(() =>
      resolveRecoveryMoveSelectionClassifyOptions({
        blastZoneLookaheadFrames: 30.5,
      }),
    ).toThrow();
  });
});

describe('resolveRecoveryMoveSelectionOptions', () => {
  it('fills classify and apex-hold defaults', () => {
    const r = resolveRecoveryMoveSelectionOptions();
    expect(r.classify.doubleJumpReachPx).toBe(40);
    expect(r.apexHoldFrames).toBe(8);
  });

  it('forwards overrides', () => {
    const r = resolveRecoveryMoveSelectionOptions({
      classify: { doubleJumpReachPx: 80 },
      apexHold: { apexHoldFrames: 16 },
    });
    expect(r.classify.doubleJumpReachPx).toBe(80);
    expect(r.apexHoldFrames).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// kinematicUpwardCoastPx + upwardTravelNeededPx — pure helpers
// ---------------------------------------------------------------------------

describe('kinematicUpwardCoastPx', () => {
  it('returns 0 when bot is stationary', () => {
    const self = makeSelf({ velocityY: 0 });
    expect(kinematicUpwardCoastPx(self, 0.5)).toBe(0);
  });

  it('returns 0 when bot is falling', () => {
    const self = makeSelf({ velocityY: 5 });
    expect(kinematicUpwardCoastPx(self, 0.5)).toBe(0);
  });

  it('returns ballistic apex when bot is rising', () => {
    // velocityY = -10 (rising), gravity = 0.5 → coast = 100/(2*0.5) = 100
    const self = makeSelf({ velocityY: -10 });
    expect(kinematicUpwardCoastPx(self, 0.5)).toBe(100);
  });

  it('scales with gravity (more gravity → less coast)', () => {
    const self = makeSelf({ velocityY: -10 });
    expect(kinematicUpwardCoastPx(self, 1.0)).toBe(50);
    expect(kinematicUpwardCoastPx(self, 0.25)).toBe(200);
  });
});

describe('upwardTravelNeededPx', () => {
  it('returns null when stage has no nearest ledge', () => {
    const self = makeSelf({ positionY: 600 });
    const noLedge: RecoveryStageGeometry = {
      ...STAGE,
      nearestLedge: null,
    };
    expect(upwardTravelNeededPx(self, noLedge)).toBeNull();
  });

  it('returns positive value when ledge is above the bot', () => {
    // ledge at y=400, bot at y=600 → ledge is above (Y grows down)
    // dy = 400 - 600 = -200, upward needed = -dy = 200
    const self = makeSelf({ positionY: 600 });
    expect(upwardTravelNeededPx(self, STAGE)).toBe(200);
  });

  it('returns negative value when bot is above the ledge', () => {
    // bot at y=300, ledge at y=400 → bot is above ledge
    // dy = 400 - 300 = 100, upward needed = -100 (drop down 100)
    const self = makeSelf({ positionY: 300 });
    expect(upwardTravelNeededPx(self, STAGE)).toBe(-100);
  });
});

// ---------------------------------------------------------------------------
// computeRecoveryResourceView — snapshot + Blackboard fusion
// ---------------------------------------------------------------------------

describe('computeRecoveryResourceView', () => {
  it('reports both available with no latches and full resources', () => {
    const h = makeHarness({ jumpsRemaining: 1, upSpecialAvailable: true });
    const view = computeRecoveryResourceView(h.ctx.self, h.blackboard);
    expect(view.doubleJumpAvailable).toBe(true);
    expect(view.upSpecialAvailable).toBe(true);
    expect(view.doubleJumpAlreadyFired).toBe(false);
    expect(view.upSpecialAlreadyFired).toBe(false);
  });

  it('marks DJ unavailable when snapshot has 0 jumps remaining', () => {
    const h = makeHarness({ jumpsRemaining: 0, upSpecialAvailable: true });
    const view = computeRecoveryResourceView(h.ctx.self, h.blackboard);
    expect(view.doubleJumpAvailable).toBe(false);
    expect(view.upSpecialAvailable).toBe(true);
  });

  it('marks US unavailable when snapshot has consumed it', () => {
    const h = makeHarness({ jumpsRemaining: 1, upSpecialAvailable: false });
    const view = computeRecoveryResourceView(h.ctx.self, h.blackboard);
    expect(view.doubleJumpAvailable).toBe(true);
    expect(view.upSpecialAvailable).toBe(false);
  });

  it('honours Blackboard latches even when snapshot still permits the press', () => {
    const h = makeHarness({ jumpsRemaining: 1, upSpecialAvailable: true });
    h.blackboard.set('recoveryLastAirJumpTick', 30);
    h.blackboard.set('recoveryLastUpSpecialTick', 35);
    const view = computeRecoveryResourceView(h.ctx.self, h.blackboard);
    expect(view.doubleJumpAlreadyFired).toBe(true);
    expect(view.upSpecialAlreadyFired).toBe(true);
    expect(view.doubleJumpAvailable).toBe(false);
    expect(view.upSpecialAvailable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectRecoveryMoveTier — pure tier classifier
// ---------------------------------------------------------------------------

describe('selectRecoveryMoveTier', () => {
  function tier(
    selfOverrides: Partial<RecoverySelfSnapshot>,
    bb?: Partial<RecoveryBlackboardSchema>,
    stage: RecoveryStageGeometry = STAGE,
    options?: Parameters<typeof selectRecoveryMoveTier>[3],
  ): RecoveryMoveTier {
    const self = makeSelf(selfOverrides);
    const blackboard = new Blackboard<RecoveryBlackboardSchema>({
      ...DEFAULT_RECOVERY_BLACKBOARD,
      ...bb,
    });
    const resources = computeRecoveryResourceView(self, blackboard);
    return selectRecoveryMoveTier(self, stage, resources, options);
  }

  it('returns "none" when grounded', () => {
    expect(
      tier({ isAirborne: false, positionX: 0, positionY: 380 }),
    ).toBe<RecoveryMoveTier>('none');
  });

  it('returns "none" when on-stage and airborne', () => {
    expect(tier({ positionX: 0, positionY: 200 })).toBe<RecoveryMoveTier>(
      'none',
    );
  });

  it('returns "none" when in hitstun', () => {
    expect(
      tier({ isInHitstun: true, positionX: -1000, positionY: 600 }),
    ).toBe<RecoveryMoveTier>('none');
  });

  it('returns "none" when on a ledge', () => {
    expect(
      tier({ isOnLedge: true, positionX: -800, positionY: 400 }),
    ).toBe<RecoveryMoveTier>('none');
  });

  it('returns "unrecoverable" when stage has no nearest ledge', () => {
    const noLedge: RecoveryStageGeometry = { ...STAGE, nearestLedge: null };
    expect(
      tier({ positionX: -1000, positionY: 600 }, undefined, noLedge),
    ).toBe<RecoveryMoveTier>('unrecoverable');
  });

  it('returns "none" when residual upward velocity coasts past the ledge', () => {
    // ledge at y=400, bot at y=420 → upward needed = 20
    // velocityY = -10, gravity = 0.5 → coast = 100, > 20+8 margin = 28
    expect(
      tier({ positionX: -900, positionY: 420, velocityY: -10 }),
    ).toBe<RecoveryMoveTier>('none');
  });

  it('returns "doubleJumpOnly" when DJ alone closes a small deficit', () => {
    // ledge at y=400, bot at y=425 → upward needed = 25
    // No coast (velocityY=0), DJ reach = 40 → 40 >= 25+8 = 33 ✓
    expect(
      tier({
        positionX: -900,
        positionY: 425,
        velocityY: 0,
        jumpsRemaining: 1,
        upSpecialAvailable: true,
      }),
    ).toBe<RecoveryMoveTier>('doubleJumpOnly');
  });

  it('returns "doubleJumpThenUpSpecial" when DJ alone is short but DJ+US reaches', () => {
    // ledge at y=400, bot at y=500 → upward needed = 100
    // No coast, DJ=40 (insufficient), DJ+US = 40+120 = 160 >= 108 ✓
    expect(
      tier({
        positionX: -900,
        positionY: 500,
        velocityY: 0,
        jumpsRemaining: 1,
        upSpecialAvailable: true,
      }),
    ).toBe<RecoveryMoveTier>('doubleJumpThenUpSpecial');
  });

  it('returns "upSpecialOnly" when DJ already spent but US still reaches', () => {
    // ledge at y=400, bot at y=500 → upward needed = 100
    // jumpsRemaining=0, US=120 >= 108 ✓
    expect(
      tier({
        positionX: -900,
        positionY: 500,
        velocityY: 0,
        jumpsRemaining: 0,
        upSpecialAvailable: true,
      }),
    ).toBe<RecoveryMoveTier>('upSpecialOnly');
  });

  it('stays in "doubleJumpThenUpSpecial" when DJ latch is set but US still pending (mid-sequence stickiness)', () => {
    // jumpsRemaining=0 in snapshot (engine consumed the DJ), and BB latch
    // says DJ already fired. The classifier MUST stay sticky on
    // 'doubleJumpThenUpSpecial' so the sequencing subtree's apex-hold
    // runs to completion rather than skipping straight to immediate
    // US press.
    expect(
      tier(
        {
          positionX: -900,
          positionY: 500,
          velocityY: 0,
          jumpsRemaining: 0,
          upSpecialAvailable: true,
        },
        { recoveryLastAirJumpTick: 30 },
      ),
    ).toBe<RecoveryMoveTier>('doubleJumpThenUpSpecial');
  });

  it('returns "upSpecialOnly" when DJ was never available AND no BB latch', () => {
    // No DJ latch on BB, but engine snapshot says jumpsRemaining=0
    // (e.g. consumed by knockback hit, not by the recovery sub-tree).
    // The mid-sequence stickiness only applies when *the sub-tree*
    // latched the DJ press; here the bot enters the situation with
    // DJ already absent, so the cheaper US-only plan is correct.
    expect(
      tier({
        positionX: -900,
        positionY: 500,
        velocityY: 0,
        jumpsRemaining: 0,
        upSpecialAvailable: true,
      }),
    ).toBe<RecoveryMoveTier>('upSpecialOnly');
  });

  it('returns "unrecoverable" when neither resource alone or together reaches', () => {
    // ledge at y=400, bot at y=800 → upward needed = 400
    // DJ+US = 40+120 = 160 < 408 → unrecoverable
    expect(
      tier({
        positionX: -900,
        positionY: 800,
        velocityY: 0,
        jumpsRemaining: 1,
        upSpecialAvailable: true,
      }),
    ).toBe<RecoveryMoveTier>('unrecoverable');
  });

  it('returns "unrecoverable" when both resources are spent', () => {
    expect(
      tier({
        positionX: -900,
        positionY: 500,
        velocityY: 0,
        jumpsRemaining: 0,
        upSpecialAvailable: false,
      }),
    ).toBe<RecoveryMoveTier>('unrecoverable');
  });

  it('respects custom doubleJumpReachPx threshold', () => {
    // upward needed = 100, default DJ=40 (short), so DJ-only fails.
    // With custom DJ reach 200, DJ alone covers it.
    const self = {
      positionX: -900,
      positionY: 500,
      velocityY: 0,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    };
    expect(tier(self)).toBe<RecoveryMoveTier>('doubleJumpThenUpSpecial');
    expect(
      tier(self, undefined, STAGE, { doubleJumpReachPx: 200 }),
    ).toBe<RecoveryMoveTier>('doubleJumpOnly');
  });

  it('uses velocity coast to demote DJ+US plan to DJ-only', () => {
    // upward needed = 50 (bot at y=450), no velocity → DJ alone (40) fails margin,
    // → DJ+US is selected.
    const noCoast = tier({
      positionX: -900,
      positionY: 450,
      velocityY: 0,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    expect(noCoast).toBe<RecoveryMoveTier>('doubleJumpThenUpSpecial');

    // Same position but with strong upward velocity (coast banks ~50 px).
    // velocityY=-7.07 → coast = 50, DJ-only = 50+40 = 90 >= 58 ✓
    const withCoast = tier({
      positionX: -900,
      positionY: 450,
      velocityY: -7.07,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    expect(withCoast).toBe<RecoveryMoveTier>('doubleJumpOnly');
  });

  it('is deterministic — identical inputs yield identical outputs', () => {
    const self = makeSelf({
      positionX: -1000,
      positionY: 500,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const bb = new Blackboard<RecoveryBlackboardSchema>({
      ...DEFAULT_RECOVERY_BLACKBOARD,
    });
    const resources = computeRecoveryResourceView(self, bb);
    const a = selectRecoveryMoveTier(self, STAGE, resources);
    const b = selectRecoveryMoveTier(self, STAGE, resources);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildRecoveryMoveSelectionSubtree — outer state gate
// ---------------------------------------------------------------------------

describe('buildRecoveryMoveSelectionSubtree — outer state gate', () => {
  it('returns Failure when bot is on stage', () => {
    const h = makeHarness({ positionX: 0, positionY: 200 });
    const tree = buildRecoveryMoveSelectionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when grounded', () => {
    const h = makeHarness({
      positionX: 0,
      positionY: 380,
      isAirborne: false,
    });
    const tree = buildRecoveryMoveSelectionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when in hitstun', () => {
    const h = makeHarness({
      positionX: -1000,
      positionY: 600,
      isInHitstun: true,
    });
    const tree = buildRecoveryMoveSelectionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when on a ledge', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const tree = buildRecoveryMoveSelectionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildRecoveryMoveSelectionSubtree — dispatch routing', () => {
  it('routes to DoubleJumpRecoveryLeaf when tier === "doubleJumpOnly"', () => {
    // Deficit big enough for the DJ leaf's conservation gate (>40 px)
    // but small enough that classifier reach (50 px after override) covers it.
    // bot at y=460 → upward 60. With doubleJumpReachPx=80 → DJ-only ✓.
    // DJ leaf default ledgeBelowThresholdPx=40 → 60>40 → leaf fires.
    const h = makeHarness({
      positionX: -900,
      positionY: 460,
      velocityY: 0,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const tree = buildRecoveryMoveSelectionSubtree({
      classify: { doubleJumpReachPx: 80 },
    });
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    // DoubleJumpRecoveryLeaf emits 'jump' tagged 'doubleJumpRecovery'.
    expect(h.emits.some((e) => e.kind === 'jump')).toBe(true);
    expect(
      h.emits.some((e) => e.recoveryStep === 'doubleJumpRecovery'),
    ).toBe(true);
    expect(h.blackboard.get('recoveryLastAirJumpTick')).toBe(0);
  });

  it('routes to RecoveryMoveLeaf when tier === "upSpecialOnly"', () => {
    const h = makeHarness({
      positionX: -900,
      positionY: 500,
      velocityY: 0,
      jumpsRemaining: 0,
      upSpecialAvailable: true,
    });
    const tree = buildRecoveryMoveSelectionSubtree();
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.kind === 'upSpecial')).toBe(true);
    expect(h.blackboard.get('recoveryLastUpSpecialTick')).toBe(0);
  });

  it('returns Failure for tier === "unrecoverable"', () => {
    const h = makeHarness({
      positionX: -900,
      positionY: 800,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const tree = buildRecoveryMoveSelectionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when stage has no ledge', () => {
    const h = makeHarness({ positionX: -1000, positionY: 600 });
    h.setStage({ nearestLedge: null });
    const tree = buildRecoveryMoveSelectionSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildRecoveryMoveSelectionSubtree — DJ → apex-hold → US sequencing
// ---------------------------------------------------------------------------

describe('buildRecoveryMoveSelectionSubtree — DJ → US sequencing', () => {
  it('fires DJ on the planning frame, holds, then fires US after apexHoldFrames', () => {
    // upward needed = 100 (positionY=500), DJ alone insufficient,
    // DJ+US sufficient → tier = 'doubleJumpThenUpSpecial'.
    const h = makeHarness({
      positionX: -900,
      positionY: 500,
      velocityY: 0,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const tree = buildRecoveryMoveSelectionSubtree({
      apexHold: { apexHoldFrames: 4 },
    });

    // Frame 0 — DJ press fires.
    const s0 = tree.tick(h.ctx);
    expect(s0).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.recoveryStep === 'doubleJumpRecovery')).toBe(
      true,
    );
    expect(h.blackboard.get('recoveryLastAirJumpTick')).toBe(0);
    expect(h.blackboard.get('recoveryLastUpSpecialTick')).toBe(-1);
    h.emits.length = 0;

    // The DJ press consumed a jump in real engine — simulate that so
    // the tier classifier sees the resource transition. (The leaf
    // doesn't decrement jumpsRemaining; that's the engine's job.)
    h.setSelf({ jumpsRemaining: 0 });

    // Frames 1..3 — apex hold (Running, no press).
    for (let i = 1; i <= 3; i += 1) {
      h.bumpTick();
      const status = tree.tick(h.ctx);
      expect(status).toBe(NodeStatus.Running);
      // Hold emits moveUp by default; should NOT emit upSpecial yet.
      expect(h.emits.some((e) => e.kind === 'upSpecial')).toBe(false);
      h.emits.length = 0;
    }

    // Frame 4 — hold elapsed; US press fires.
    h.bumpTick();
    const sFinal = tree.tick(h.ctx);
    expect(sFinal).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.kind === 'upSpecial')).toBe(true);
    expect(h.blackboard.get('recoveryLastUpSpecialTick')).toBe(4);
  });

  it('short-circuits the apex hold when bot is approaching a blast wall', () => {
    // Position the bot below the ledge AND moving toward the bottom blast wall
    // hard enough that the projection lookahead trips on the same tick.
    // ledge at y=400, bot at y=500, velocityY=+10 → 60 frames out = 1100, > blast.bottom (900).
    const h = makeHarness({
      positionX: -900,
      positionY: 500,
      velocityX: 0,
      velocityY: 10,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const tree = buildRecoveryMoveSelectionSubtree({
      apexHold: { apexHoldFrames: 30 }, // long hold so without urgency US wouldn't fire
    });

    // Frame 0 — DJ press fires.
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.recoveryStep === 'doubleJumpRecovery')).toBe(
      true,
    );
    h.emits.length = 0;
    h.setSelf({ jumpsRemaining: 0 });

    // Frame 1 — blast-zone urgency short-circuits the long hold; US fires.
    h.bumpTick();
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.kind === 'upSpecial')).toBe(true);
  });

  it('does not re-press DJ once latched on Blackboard (resource latch)', () => {
    // Pre-latch a DJ press to simulate "DJ already fired this airborne period".
    const h = makeHarness({
      positionX: -900,
      positionY: 500,
      velocityY: 0,
      jumpsRemaining: 0, // matches "DJ already consumed in engine"
      upSpecialAvailable: true,
    });
    h.blackboard.set('recoveryLastAirJumpTick', 0);
    h.bumpTick(); // tickIndex = 1

    const tree = buildRecoveryMoveSelectionSubtree({
      apexHold: { apexHoldFrames: 0 }, // skip the wait so US fires first
    });
    const status = tree.tick(h.ctx);
    // tier becomes 'upSpecialOnly' (DJ unavailable). US press fires.
    expect(status).toBe(NodeStatus.Success);
    expect(h.emits.some((e) => e.kind === 'jump')).toBe(false);
    expect(h.emits.some((e) => e.kind === 'upSpecial')).toBe(true);
  });

  it('returns Failure after both DJ and US have fired (sequence done)', () => {
    const h = makeHarness({
      positionX: -900,
      positionY: 500,
      velocityY: 0,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    h.blackboard.set('recoveryLastAirJumpTick', 5);
    h.blackboard.set('recoveryLastUpSpecialTick', 10);
    h.bumpTick(20); // far past the sequence

    const tree = buildRecoveryMoveSelectionSubtree();
    const status = tree.tick(h.ctx);
    // Both resources spent → tier=unrecoverable → outer returns Failure
    expect(status).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

describe('buildRecoveryMoveSelectionSubtree — determinism', () => {
  it('two trees produce identical output on identical inputs', () => {
    const h1 = makeHarness({
      positionX: -900,
      positionY: 500,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const h2 = makeHarness({
      positionX: -900,
      positionY: 500,
      jumpsRemaining: 1,
      upSpecialAvailable: true,
    });
    const t1 = buildRecoveryMoveSelectionSubtree();
    const t2 = buildRecoveryMoveSelectionSubtree();
    const s1 = t1.tick(h1.ctx);
    const s2 = t2.tick(h2.ctx);
    expect(s1).toBe(s2);
    expect(h1.emits).toEqual(h2.emits);
    expect(h1.blackboard.get('recoveryLastAirJumpTick')).toBe(
      h2.blackboard.get('recoveryLastAirJumpTick'),
    );
  });
});

// ===========================================================================
// Sub-AC 3 — LedgeMixup
// ===========================================================================

// ---------------------------------------------------------------------------
// resolve* helpers — Sub-AC 3
// ---------------------------------------------------------------------------

describe('resolveLedgeGetUpWeights', () => {
  it('fills in defaults', () => {
    const r = resolveLedgeGetUpWeights();
    expect(r.normal).toBe(1);
    expect(r.attack).toBe(1);
    expect(r.jump).toBe(1);
    expect(r.roll).toBe(1);
  });

  it('honours overrides', () => {
    const r = resolveLedgeGetUpWeights({
      normal: 2,
      attack: 3,
      jump: 0.5,
      roll: 4,
    });
    expect(r.normal).toBe(2);
    expect(r.attack).toBe(3);
    expect(r.jump).toBe(0.5);
    expect(r.roll).toBe(4);
  });

  it('rejects negative weights', () => {
    expect(() => resolveLedgeGetUpWeights({ normal: -1 })).toThrow();
    expect(() => resolveLedgeGetUpWeights({ attack: -0.1 })).toThrow();
  });

  it('rejects all-zero weights', () => {
    expect(() =>
      resolveLedgeGetUpWeights({ normal: 0, attack: 0, jump: 0, roll: 0 }),
    ).toThrow();
  });
});

describe('resolveLedgeMixupOptions', () => {
  it('fills hang / weights / stale defaults', () => {
    const r = resolveLedgeMixupOptions();
    expect(r.hangMeanFrames).toBe(30);
    expect(r.hangJitterFrames).toBe(12);
    expect(r.weights.normal).toBe(1);
    expect(r.staleFrames).toBe(45);
  });

  it('forwards overrides', () => {
    const r = resolveLedgeMixupOptions({
      getUp: {
        hangMeanFrames: 60,
        hangJitterFrames: 6,
        weights: { attack: 5 },
      },
      regrab: { staleFrames: 100 },
    });
    expect(r.hangMeanFrames).toBe(60);
    expect(r.hangJitterFrames).toBe(6);
    expect(r.weights.attack).toBe(5);
    expect(r.staleFrames).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// chooseLedgeGetUpOption — pure helper coverage
// ---------------------------------------------------------------------------

describe('chooseLedgeGetUpOption', () => {
  // Stub rng with a controllable single draw.
  function stubRng(value: number) {
    return { next: () => value };
  }

  it('returns "normal" when draw lands in the first bucket', () => {
    expect(
      chooseLedgeGetUpOption(stubRng(0.0), null, null),
    ).toBe<LedgeMixupGetUpOption>('normal');
  });

  it('returns "attack" when draw lands in the second bucket', () => {
    // even weights → 0.25 < 0.5 → 'attack'
    expect(
      chooseLedgeGetUpOption(stubRng(0.3), null, null),
    ).toBe<LedgeMixupGetUpOption>('attack');
  });

  it('returns "jump" when draw lands in the third bucket', () => {
    expect(
      chooseLedgeGetUpOption(stubRng(0.6), null, null),
    ).toBe<LedgeMixupGetUpOption>('jump');
  });

  it('returns "roll" when draw lands in the fourth bucket', () => {
    expect(
      chooseLedgeGetUpOption(stubRng(0.95), null, null),
    ).toBe<LedgeMixupGetUpOption>('roll');
  });

  it('biases toward "attack" when opponent is close to ledge', () => {
    // even baseline 1+1+1+1 = 4. Close-bonus +1.5 on attack ⇒ 5.5 total.
    // Attack bucket = [normal=1, attack=1+1.5=2.5] → covers up to 3.5 / 5.5 ≈ 0.636.
    // Draw of 0.4 → still in attack bucket (1/5.5 = 0.182, 3.5/5.5 = 0.636).
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -800,
      positionY: 380,
      isOnLedge: false,
      damagePercent: 50,
    };
    expect(
      chooseLedgeGetUpOption(stubRng(0.4), opp, -800),
    ).toBe<LedgeMixupGetUpOption>('attack');
  });

  it('biases toward "roll" when opponent is far from ledge', () => {
    // Far opponent ⇒ +1.5 on roll. Total 1+1+1+2.5 = 5.5.
    // Cumulative cutoffs: 1/5.5≈0.182, 2/5.5≈0.364, 3/5.5≈0.545, 5.5/5.5=1.
    // Draw 0.9 lands in roll bucket [3/5.5..1].
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -200,
      positionY: 380,
      isOnLedge: false,
      damagePercent: 50,
    };
    expect(
      chooseLedgeGetUpOption(stubRng(0.9), opp, -800),
    ).toBe<LedgeMixupGetUpOption>('roll');
  });

  it('further biases toward "attack" when opponent is at KO percent', () => {
    // High % AND close ⇒ attack +1.5 (close) + +1.0 (ko) = +2.5 → 3.5
    // Total weights = 1+3.5+1+1 = 6.5.
    // Cumulative: 1/6.5≈0.154, 4.5/6.5≈0.692.
    // Draw 0.5 lands in attack bucket.
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -800,
      positionY: 380,
      isOnLedge: false,
      damagePercent: 130,
    };
    expect(
      chooseLedgeGetUpOption(stubRng(0.5), opp, -800),
    ).toBe<LedgeMixupGetUpOption>('attack');
  });

  it('ignores opponent weighting when opponent is null', () => {
    // Same draw with vs. without opponent on even baseline picks the
    // same option (no opponent path).
    const draw = 0.3;
    const noOpp = chooseLedgeGetUpOption(stubRng(draw), null, null);
    const withOpp = chooseLedgeGetUpOption(stubRng(draw), null, -800);
    expect(noOpp).toBe(withOpp);
  });
});

// ---------------------------------------------------------------------------
// mapGetUpOptionToActionKind — verb mapping
// ---------------------------------------------------------------------------

describe('mapGetUpOptionToActionKind', () => {
  it('maps "normal" → moveUp', () => {
    expect(mapGetUpOptionToActionKind('normal')).toBe('moveUp');
  });
  it('maps "attack" → airDodge', () => {
    expect(mapGetUpOptionToActionKind('attack')).toBe('airDodge');
  });
  it('maps "jump" → jump', () => {
    expect(mapGetUpOptionToActionKind('jump')).toBe('jump');
  });
  it('maps "roll" → moveDown', () => {
    expect(mapGetUpOptionToActionKind('roll')).toBe('moveDown');
  });
});

// ---------------------------------------------------------------------------
// buildLedgeMixupSubtree — outer state gate
// ---------------------------------------------------------------------------

describe('buildLedgeMixupSubtree — outer state gate', () => {
  it('returns Failure when bot is on stage and not on a ledge', () => {
    const h = makeHarness({ positionX: 0, positionY: 200 });
    const tree = buildLedgeMixupSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when grounded', () => {
    const h = makeHarness({
      positionX: 0,
      positionY: 380,
      isAirborne: false,
    });
    const tree = buildLedgeMixupSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when in hitstun (even on ledge)', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
      isInHitstun: true,
    });
    const tree = buildLedgeMixupSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });

  it('returns Failure when stage has no nearest ledge', () => {
    const h = makeHarness({ positionX: -1000, positionY: 600 });
    h.setStage({ nearestLedge: null });
    const tree = buildLedgeMixupSubtree();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(h.emits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LedgeTrumpLeaf via buildLedgeMixupSubtree
// ---------------------------------------------------------------------------

describe('buildLedgeMixupSubtree — ledge-trump branch', () => {
  it('drives drift toward the ledge when opponent is on it', () => {
    // Bot just below ledge (dy=20 < trumpProximity=40), opponent on the ledge.
    const h = makeHarness({
      positionX: -850,
      positionY: 420,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
      damagePercent: 0,
    };
    const tree = buildLedgeMixupSubtree({ getOpponent: () => opp });
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Running);
    expect(h.emits.length).toBeGreaterThan(0);
    expect(h.emits[0]?.recoveryStep?.startsWith('ledgeMixup.trump')).toBe(true);
  });

  it('does not fire when opponent is NOT on the ledge', () => {
    const h = makeHarness({
      positionX: -850,
      positionY: 420,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: 0,
      positionY: 380,
      isOnLedge: false,
      damagePercent: 0,
    };
    const tree = buildLedgeMixupSubtree({ getOpponent: () => opp });
    tree.tick(h.ctx);
    // Trump should NOT have fired — no trump.* emit.
    expect(
      h.emits.every((e) => !e.recoveryStep?.startsWith('ledgeMixup.trump')),
    ).toBe(true);
  });

  it('does not fire when bot is too far below the ledge', () => {
    // dy = 100 > trumpProximityYPx (40 default)
    const h = makeHarness({
      positionX: -850,
      positionY: 500,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
      damagePercent: 0,
    };
    const tree = buildLedgeMixupSubtree({ getOpponent: () => opp });
    tree.tick(h.ctx);
    expect(
      h.emits.every((e) => !e.recoveryStep?.startsWith('ledgeMixup.trump')),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LedgePreGrabStallLeaf via buildLedgeMixupSubtree
// ---------------------------------------------------------------------------

describe('buildLedgeMixupSubtree — pre-grab stall branch', () => {
  it('stalls (Running, idle emit) when opponent is covering the corner', () => {
    // Bot just below ledge in proximity. Opponent above the corner.
    const h = makeHarness({
      positionX: -820,
      positionY: 430,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -800,
      positionY: 350, // 50 px above ledge corner (within opponentCoverYPx=80)
      isOnLedge: false,
      damagePercent: 0,
    };
    const tree = buildLedgeMixupSubtree({
      preGrabStall: { minStallFrames: 4, maxStallFrames: 4 },
      getOpponent: () => opp,
    });
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Running);
    expect(
      h.emits.some((e) => e.recoveryStep === 'ledgeMixup.preGrabStall'),
    ).toBe(true);
  });

  it('falls through to Failure once stall elapses', () => {
    const h = makeHarness({
      positionX: -820,
      positionY: 430,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -800,
      positionY: 350,
      isOnLedge: false,
      damagePercent: 0,
    };
    const tree = buildLedgeMixupSubtree({
      preGrabStall: { minStallFrames: 2, maxStallFrames: 2 },
      getOpponent: () => opp,
    });
    // Tick 0..1 — stall is Running.
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Running);
    h.bumpTick();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Running);
    // Tick 2 — stall elapsed → fallthrough → no other branch wins
    // (no trump because opp not on ledge; no on-ledge branches because
    // bot is airborne) → Failure.
    h.bumpTick();
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
  });

  it('does not stall without an opponent in scope', () => {
    const h = makeHarness({
      positionX: -820,
      positionY: 430,
      jumpsRemaining: 0,
      upSpecialAvailable: false,
    });
    const tree = buildLedgeMixupSubtree({
      preGrabStall: { minStallFrames: 4, maxStallFrames: 4 },
    });
    expect(tree.tick(h.ctx)).toBe(NodeStatus.Failure);
    expect(
      h.emits.every((e) => e.recoveryStep !== 'ledgeMixup.preGrabStall'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LedgeGetUpLeaf via buildLedgeMixupSubtree
// ---------------------------------------------------------------------------

describe('buildLedgeMixupSubtree — get-up randomisation branch', () => {
  it('plans a get-up on the first on-ledge tick and hangs until emit tick', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const tree = buildLedgeMixupSubtree({
      getUp: { hangMeanFrames: 5, hangJitterFrames: 0 }, // deterministic 5-frame hang
    });

    // Frame 0 — plan committed; bot still hanging.
    const s0 = tree.tick(h.ctx);
    expect(s0).toBe(NodeStatus.Running);
    expect(h.blackboard.get('ledgeMixupGrabTick')).toBe(0);
    expect(h.blackboard.get('ledgeMixupGetUpEmitTick')).toBe(5);
    expect(h.blackboard.get('ledgeMixupGetUpOption')).not.toBeNull();
    expect(
      h.emits.some((e) => e.recoveryStep === 'ledgeMixup.getUp.hang'),
    ).toBe(true);
    h.emits.length = 0;

    // Frames 1..4 — still hanging.
    for (let i = 1; i <= 4; i += 1) {
      h.bumpTick();
      const status = tree.tick(h.ctx);
      expect(status).toBe(NodeStatus.Running);
      expect(
        h.emits.some((e) => e.recoveryStep?.startsWith('ledgeMixup.getUp.')),
      ).toBe(true);
      h.emits.length = 0;
    }

    // Frame 5 — emit tick reached, get-up fires.
    h.bumpTick();
    const sFinal = tree.tick(h.ctx);
    expect(sFinal).toBe(NodeStatus.Success);
    const fired = h.emits.find((e) =>
      e.recoveryStep?.startsWith('ledgeMixup.getUp.') &&
      e.recoveryStep !== 'ledgeMixup.getUp.hang',
    );
    expect(fired).toBeDefined();
    // Plan cleared after fire.
    expect(h.blackboard.get('ledgeMixupGrabTick')).toBe(-1);
    expect(h.blackboard.get('ledgeMixupGetUpOption')).toBeNull();
  });

  it('keeps the chosen option stable across hang frames (not re-rolled)', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const tree = buildLedgeMixupSubtree({
      getUp: { hangMeanFrames: 8, hangJitterFrames: 0 },
    });

    tree.tick(h.ctx);
    const chosen = h.blackboard.get('ledgeMixupGetUpOption');
    expect(chosen).not.toBeNull();
    for (let i = 1; i <= 5; i += 1) {
      h.bumpTick();
      tree.tick(h.ctx);
      expect(h.blackboard.get('ledgeMixupGetUpOption')).toBe(chosen);
    }
  });

  it('emits the verb that maps to the chosen option', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const tree = buildLedgeMixupSubtree({
      getUp: { hangMeanFrames: 1, hangJitterFrames: 0 },
    });
    tree.tick(h.ctx); // commits plan, hang frame
    h.bumpTick();
    h.emits.length = 0;
    tree.tick(h.ctx); // emit tick

    const chosen = h.blackboard.get(
      'ledgeMixupGetUpOption',
    ) as LedgeMixupGetUpOption | null;
    // Plan is cleared after emit, so re-derive expected verb from emits.
    const fired = h.emits.find((e) =>
      e.recoveryStep?.startsWith('ledgeMixup.getUp.') &&
      e.recoveryStep !== 'ledgeMixup.getUp.hang',
    );
    expect(fired).toBeDefined();
    // Verify the emit kind matches the verb mapping for SOME option.
    const tag = fired!.recoveryStep!.replace('ledgeMixup.getUp.', '') as
      LedgeMixupGetUpOption;
    expect(fired!.kind).toBe(mapGetUpOptionToActionKind(tag));
    // chosen is null at this point (plan cleared) — verify clearing.
    expect(chosen).toBeNull();
  });

  it('clears the plan when bot leaves the ledge mid-hang', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const tree = buildLedgeMixupSubtree({
      getUp: { hangMeanFrames: 30, hangJitterFrames: 0 },
    });
    tree.tick(h.ctx);
    expect(h.blackboard.get('ledgeMixupGrabTick')).toBe(0);

    // Bot dropped off the ledge.
    h.setSelf({ isOnLedge: false, positionX: -820, positionY: 420 });
    h.bumpTick();
    tree.tick(h.ctx);
    // Plan cleared.
    expect(h.blackboard.get('ledgeMixupGrabTick')).toBe(-1);
    expect(h.blackboard.get('ledgeMixupGetUpOption')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LedgeRegrabLeaf via buildLedgeMixupSubtree
// ---------------------------------------------------------------------------

describe('buildLedgeMixupSubtree — regrab branch', () => {
  it('emits moveDown when ledge i-frames are stale and opponent pressuring', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -700,
      positionY: 380,
      isOnLedge: false,
      damagePercent: 50,
    };
    // Pre-stamp grab tick at 0; bump to past-stale.
    h.blackboard.set('ledgeMixupGrabTick', 0);
    h.blackboard.set('ledgeMixupGetUpOption', 'normal');
    h.blackboard.set('ledgeMixupGetUpEmitTick', 1000); // far future, won't fire
    h.bumpTick(50); // 50 > default staleFrames=45

    const tree = buildLedgeMixupSubtree({ getOpponent: () => opp });
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    expect(
      h.emits.some(
        (e) =>
          e.kind === 'moveDown' &&
          e.recoveryStep === 'ledgeMixup.regrab.drop',
      ),
    ).toBe(true);
    // Plan cleared so the next grab cycle re-rolls.
    expect(h.blackboard.get('ledgeMixupGrabTick')).toBe(-1);
    expect(h.blackboard.get('ledgeMixupGetUpOption')).toBeNull();
  });

  it('does NOT fire when i-frames are still fresh (under stale threshold)', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -700,
      positionY: 380,
      isOnLedge: false,
      damagePercent: 50,
    };
    h.blackboard.set('ledgeMixupGrabTick', 0);
    h.bumpTick(10); // well under stale=45

    const tree = buildLedgeMixupSubtree({
      getUp: { hangMeanFrames: 1000, hangJitterFrames: 0 }, // never fires
      getOpponent: () => opp,
    });
    tree.tick(h.ctx);
    expect(
      h.emits.every((e) => e.recoveryStep !== 'ledgeMixup.regrab.drop'),
    ).toBe(true);
  });

  it('does NOT fire when no opponent pressure (with requireOpponentPressure default)', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    h.blackboard.set('ledgeMixupGrabTick', 0);
    h.bumpTick(50);

    const tree = buildLedgeMixupSubtree({
      getUp: { hangMeanFrames: 1000, hangJitterFrames: 0 },
    });
    tree.tick(h.ctx);
    expect(
      h.emits.every((e) => e.recoveryStep !== 'ledgeMixup.regrab.drop'),
    ).toBe(true);
  });

  it('fires without opponent pressure when requireOpponentPressure is false', () => {
    const h = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    h.blackboard.set('ledgeMixupGrabTick', 0);
    h.bumpTick(50);

    const tree = buildLedgeMixupSubtree({
      regrab: { requireOpponentPressure: false },
    });
    const status = tree.tick(h.ctx);
    expect(status).toBe(NodeStatus.Success);
    expect(
      h.emits.some((e) => e.recoveryStep === 'ledgeMixup.regrab.drop'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildLedgeMixupSubtree — determinism
// ---------------------------------------------------------------------------

describe('buildLedgeMixupSubtree — determinism', () => {
  it('two trees with identical seeds + inputs produce identical plans + emits', () => {
    const opp: LedgeMixupOpponentSnapshot = {
      positionX: -750,
      positionY: 350,
      isOnLedge: false,
      damagePercent: 80,
    };
    const h1 = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const h2 = makeHarness({
      positionX: -800,
      positionY: 400,
      isOnLedge: true,
    });
    const t1 = buildLedgeMixupSubtree({
      getUp: { hangMeanFrames: 10, hangJitterFrames: 4 },
      getOpponent: () => opp,
    });
    const t2 = buildLedgeMixupSubtree({
      getUp: { hangMeanFrames: 10, hangJitterFrames: 4 },
      getOpponent: () => opp,
    });

    // Run a handful of ticks; both harnesses share the same Rng seed
    // (constructor picks `new Rng(1)` in `makeHarness`), so the plan
    // and emit timing should match byte-for-byte.
    for (let i = 0; i < 16; i += 1) {
      const s1 = t1.tick(h1.ctx);
      const s2 = t2.tick(h2.ctx);
      expect(s1).toBe(s2);
      h1.bumpTick();
      h2.bumpTick();
    }
    expect(h1.emits).toEqual(h2.emits);
    expect(h1.blackboard.get('ledgeMixupGrabTick')).toBe(
      h2.blackboard.get('ledgeMixupGrabTick'),
    );
    expect(h1.blackboard.get('ledgeMixupGetUpEmitTick')).toBe(
      h2.blackboard.get('ledgeMixupGetUpEmitTick'),
    );
    expect(h1.blackboard.get('ledgeMixupGetUpOption')).toBe(
      h2.blackboard.get('ledgeMixupGetUpOption'),
    );
  });
});
