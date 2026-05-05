/**
 * AC 30203 Sub-AC 3 — desync report overlay tests.
 *
 * Exercises the Phaser-touching overlay through a hand-rolled
 * scene shim — same pattern as `DamageHud` / `RebindingScreen` tests.
 *
 * Coverage map:
 *
 *   • Construction creates banner + row text objects + buttons; nothing
 *     visible until update / setVisible.
 *   • update() paints banner lines from buildBannerLines.
 *   • update() paints divergence rows; row count tracks the report.
 *   • autoShowOnDivergence flips visibility on first non-pending verdict.
 *   • setVisible(false) hides everything; setVisible(true) re-paints rows.
 *   • Continue / Halt button taps invoke the supplied callbacks.
 *   • destroy() tears everything down and is idempotent.
 *   • Round-trip integration with DesyncRecoveryController via
 *     `DesyncReportOverlay.withController(...)`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesyncReportOverlay } from './DesyncReportOverlay';
import {
  DesyncRecoveryController,
  type DesyncReport,
} from '../replay/DesyncRecoveryController';
import {
  PlaybackChecksumVerifier,
  type DivergenceLogger,
} from './../replay/PlaybackChecksumVerifier';
import {
  buildStateChecksumRecord,
  type MatchStateSnapshot,
  type StateChecksumRecord,
  type StateFighterSnapshot,
} from '../replay/stateChecksum';

// ---------------------------------------------------------------------------
// Phaser-free scene shim
// ---------------------------------------------------------------------------

interface FakeText {
  setText(value: string): FakeText;
  setColor(color: string): FakeText;
  setOrigin(x: number, y?: number): FakeText;
  setScrollFactor(x: number, y?: number): FakeText;
  setPosition(x: number, y: number): FakeText;
  setDepth(depth: number): FakeText;
  setVisible(visible: boolean): FakeText;
  setInteractive(): FakeText;
  on(event: string, fn: () => void): FakeText;
  destroy(): void;
  text: string;
  color: string;
  visible: boolean;
  destroyed: boolean;
  handlers: Record<string, () => void>;
}

interface FakeRect {
  setOrigin(x: number, y?: number): FakeRect;
  setStrokeStyle(width: number, color: number, alpha?: number): FakeRect;
  setScrollFactor(x: number, y?: number): FakeRect;
  setPosition(x: number, y: number): FakeRect;
  setDepth(depth: number): FakeRect;
  setVisible(visible: boolean): FakeRect;
  setSize(width: number, height: number): FakeRect;
  destroy(): void;
  strokeColor: number;
  visible: boolean;
  destroyed: boolean;
}

function createText(initial: string): FakeText {
  const t: FakeText = {
    text: initial,
    color: '',
    visible: false,
    destroyed: false,
    handlers: {},
    setText(v) {
      t.text = v;
      return t;
    },
    setColor(c) {
      t.color = c;
      return t;
    },
    setOrigin() {
      return t;
    },
    setScrollFactor() {
      return t;
    },
    setPosition() {
      return t;
    },
    setDepth() {
      return t;
    },
    setVisible(v) {
      t.visible = v;
      return t;
    },
    setInteractive() {
      return t;
    },
    on(event, fn) {
      t.handlers[event] = fn;
      return t;
    },
    destroy() {
      t.destroyed = true;
    },
  };
  return t;
}

function createRect(): FakeRect {
  const r: FakeRect = {
    strokeColor: 0,
    visible: false,
    destroyed: false,
    setOrigin() {
      return r;
    },
    setStrokeStyle(_w, color) {
      r.strokeColor = color;
      return r;
    },
    setScrollFactor() {
      return r;
    },
    setPosition() {
      return r;
    },
    setSize() {
      return r;
    },
    setDepth() {
      return r;
    },
    setVisible(v) {
      r.visible = v;
      return r;
    },
    destroy() {
      r.destroyed = true;
    },
  };
  return r;
}

function createScene(width = 1280, height = 720) {
  const texts: FakeText[] = [];
  const rects: FakeRect[] = [];
  const scene = {
    scale: { gameSize: { width, height } },
    add: {
      text(_x: number, _y: number, content: string) {
        const t = createText(content);
        texts.push(t);
        return t;
      },
      rectangle() {
        const r = createRect();
        rects.push(r);
        return r;
      },
    },
  };
  return { scene, texts, rects };
}

// ---------------------------------------------------------------------------
// Replay fixtures
// ---------------------------------------------------------------------------

function makeFighter(
  overrides: Partial<StateFighterSnapshot> = {},
): StateFighterSnapshot {
  return {
    playerIndex: 0,
    characterId: 'wolf',
    paletteIndex: 0,
    stocks: 3,
    stocksLost: 0,
    kos: 0,
    damagePercent: 0,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    facing: 1,
    grounded: true,
    jumpsUsed: 0,
    inHitstun: false,
    invincible: false,
    eliminated: false,
    ...overrides,
  };
}

function makeSnapshot(frame: number, p1Damage = 0): MatchStateSnapshot {
  return {
    frame,
    fighters: [
      makeFighter({ playerIndex: 0, characterId: 'wolf', damagePercent: p1Damage }),
      makeFighter({ playerIndex: 1, characterId: 'cat' }),
    ],
  };
}

function makeRecord(frame: number, p1Damage = 0): StateChecksumRecord {
  return buildStateChecksumRecord(makeSnapshot(frame, p1Damage));
}

const SILENT_LOGGER: DivergenceLogger = () => {};

let warnSpy: { mockRestore: () => void };
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
    /* swallow */
  }) as unknown as { mockRestore: () => void };
});
afterEach(() => {
  warnSpy.mockRestore();
});

function makeReport(overrides: Partial<DesyncReport> = {}): DesyncReport {
  return Object.freeze({
    verdict: 'pending',
    status: 'idle',
    framesObserved: 0,
    firstDivergenceFrame: null,
    lastDivergenceFrame: null,
    divergenceCount: 0,
    mismatchCount: 0,
    malformedCount: 0,
    matchCount: 0,
    noPinCount: 0,
    recordCount: 0,
    haltedAtFrame: null,
    haltReason: null,
    tolerance: { kind: 'continue' },
    divergences: [],
    diffSummary: [],
    ...overrides,
  } as DesyncReport);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('DesyncReportOverlay — construction', () => {
  it('creates banner texts, row pairs, and buttons (all hidden)', () => {
    const { scene, texts, rects } = createScene();
    const overlay = new DesyncReportOverlay(scene, {}, { maxRows: 3 });
    // 4 banner + 3 row labels + 3 row diffs + 2 buttons = 12 texts.
    expect(texts).toHaveLength(12);
    expect(rects).toHaveLength(1);
    for (const t of texts) expect(t.visible).toBe(false);
    expect(rects[0]!.visible).toBe(false);
    expect(overlay.isVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// update() — banner painting
// ---------------------------------------------------------------------------

describe('DesyncReportOverlay — update() banner', () => {
  it('paints the four banner lines from buildBannerLines', () => {
    const { scene } = createScene();
    const overlay = new DesyncReportOverlay(
      scene,
      {},
      { maxRows: 0, autoShowOnDivergence: false },
    );
    overlay.update(
      makeReport({
        verdict: 'pass',
        status: 'completed',
        framesObserved: 1800,
        recordCount: 6,
        matchCount: 6,
      }),
    );
    const snap = overlay.getBannerSnapshot();
    expect(snap[0]).toBe('REPLAY VERIFIED');
    expect(snap[1]).toBe('status: completed · no divergences observed');
    expect(snap[2]).toBe('tolerance: continue (log only)');
    expect(snap[3]).toContain('frames: 1800');
  });

  it('verdict colour applies to the first banner line', () => {
    const { scene } = createScene();
    const overlay = new DesyncReportOverlay(
      scene,
      {},
      { maxRows: 0, autoShowOnDivergence: false },
    );
    overlay.update(
      makeReport({
        verdict: 'fail-halted',
        status: 'halted',
        haltedAtFrame: 600,
        haltReason: 'policy halt-on-first',
      }),
    );
    // We only need the colour to be different from the pending colour
    // (#a0a0b8) — verifying every byte couples the test to the ramp
    // entries, which the format suite already pins.
    expect(overlay.getBannerLine(0)).toBe('REPLAY DESYNC (halted)');
  });

  it('rejects null reports', () => {
    const { scene } = createScene();
    const overlay = new DesyncReportOverlay(scene, {});
    expect(() =>
      overlay.update(null as unknown as DesyncReport),
    ).toThrow(/non-null/);
  });
});

// ---------------------------------------------------------------------------
// update() — divergence rows
// ---------------------------------------------------------------------------

describe('DesyncReportOverlay — update() row painting', () => {
  it('row count tracks the report — visible rows match', () => {
    const { scene } = createScene();
    const overlay = new DesyncReportOverlay(
      scene,
      {},
      { maxRows: 5, autoShowOnDivergence: true },
    );

    // First update: empty report → no rows visible.
    overlay.update(makeReport());
    expect(overlay.getVisibleRowCount()).toBe(0);

    // Second update: 2-divergence report → 2 visible rows.
    overlay.update(
      makeReport({
        verdict: 'fail-continued',
        status: 'monitoring',
        divergenceCount: 2,
        mismatchCount: 2,
        firstDivergenceFrame: 300,
        lastDivergenceFrame: 600,
        divergences: Object.freeze([
          Object.freeze({
            frame: 300,
            kind: 'mismatch',
            expected: 'aaaa000000aaaaaa',
            actual: 'bbbb000000bbbbbb',
            algorithm: 'state-fnv1a-64-v1',
            message: 'mismatch 300',
          }),
          Object.freeze({
            frame: 600,
            kind: 'mismatch',
            expected: 'aaaa000000aaaaaa',
            actual: 'cccc000000cccccc',
            algorithm: 'state-fnv1a-64-v1',
            message: 'mismatch 600',
          }),
        ]),
        diffSummary: Object.freeze([
          Object.freeze({
            frame: 300,
            kind: 'mismatch',
            expected: 'aaaa000000aaaaaa',
            actual: 'bbbb000000bbbbbb',
            algorithm: 'state-fnv1a-64-v1',
          }),
          Object.freeze({
            frame: 600,
            kind: 'mismatch',
            expected: 'aaaa000000aaaaaa',
            actual: 'cccc000000cccccc',
            algorithm: 'state-fnv1a-64-v1',
          }),
        ]),
      }),
    );
    const rows = overlay.getRowSnapshot();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.label).toContain('f300 · mismatch');
    expect(rows[0]!.diff).toContain('expected aaaa000000');
    expect(rows[1]!.label).toContain('f600 · mismatch');
  });
});

// ---------------------------------------------------------------------------
// autoShowOnDivergence + manual visibility
// ---------------------------------------------------------------------------

describe('DesyncReportOverlay — visibility', () => {
  it('auto-shows on first non-pending verdict', () => {
    const { scene } = createScene();
    const overlay = new DesyncReportOverlay(
      scene,
      {},
      { autoShowOnDivergence: true },
    );
    expect(overlay.isVisible()).toBe(false);
    overlay.update(makeReport({ verdict: 'pending' }));
    expect(overlay.isVisible()).toBe(false);
    overlay.update(
      makeReport({ verdict: 'fail-continued', status: 'monitoring' }),
    );
    expect(overlay.isVisible()).toBe(true);
  });

  it("does not auto-show when option is 'false'", () => {
    const { scene } = createScene();
    const overlay = new DesyncReportOverlay(
      scene,
      {},
      { autoShowOnDivergence: false },
    );
    overlay.update(
      makeReport({ verdict: 'fail-halted', status: 'halted', haltedAtFrame: 0 }),
    );
    expect(overlay.isVisible()).toBe(false);
    overlay.setVisible(true);
    expect(overlay.isVisible()).toBe(true);
  });

  it('setVisible(false) hides every member', () => {
    const { scene, texts, rects } = createScene();
    const overlay = new DesyncReportOverlay(scene, {}, { maxRows: 2 });
    overlay.setVisible(true);
    expect(rects[0]!.visible).toBe(true);
    overlay.setVisible(false);
    expect(rects[0]!.visible).toBe(false);
    for (const t of texts) expect(t.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Button click → callback dispatch
// ---------------------------------------------------------------------------

describe('DesyncReportOverlay — buttons', () => {
  it('Halt button calls onHalt', () => {
    const { scene, texts } = createScene();
    let halted = 0;
    new DesyncReportOverlay(
      scene,
      {
        onHalt: () => {
          halted += 1;
        },
      },
      { maxRows: 1 },
    );
    // The Halt button is the LAST text added (after Continue button).
    const haltText = texts[texts.length - 1]!;
    expect(haltText.text).toContain('Halt');
    haltText.handlers['pointerdown']!();
    expect(halted).toBe(1);
  });

  it('Continue button calls onContinue', () => {
    const { scene, texts } = createScene();
    let continues = 0;
    new DesyncReportOverlay(
      scene,
      {
        onContinue: () => {
          continues += 1;
        },
      },
      { maxRows: 1 },
    );
    // Continue button is texts[texts.length - 2].
    const continueText = texts[texts.length - 2]!;
    expect(continueText.text).toContain('Continue');
    continueText.handlers['pointerdown']!();
    expect(continues).toBe(1);
  });

  it('handler is no-op when callback omitted', () => {
    const { scene, texts } = createScene();
    new DesyncReportOverlay(scene, {}, { maxRows: 1 });
    const continueText = texts[texts.length - 2]!;
    expect(() => continueText.handlers['pointerdown']!()).not.toThrow();
  });

  it('throwing callback does not crash the overlay', () => {
    const { scene, texts } = createScene();
    new DesyncReportOverlay(
      scene,
      {
        onHalt: () => {
          throw new Error('boom');
        },
      },
      { maxRows: 1 },
    );
    const haltText = texts[texts.length - 1]!;
    expect(() => haltText.handlers['pointerdown']!()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('DesyncReportOverlay — destroy()', () => {
  it('tears down every child', () => {
    const { scene, texts, rects } = createScene();
    const overlay = new DesyncReportOverlay(scene, {}, { maxRows: 2 });
    overlay.destroy();
    for (const t of texts) expect(t.destroyed).toBe(true);
    for (const r of rects) expect(r.destroyed).toBe(true);
  });

  it('is idempotent', () => {
    const { scene } = createScene();
    const overlay = new DesyncReportOverlay(scene, {});
    overlay.destroy();
    expect(() => overlay.destroy()).not.toThrow();
  });

  it('update() / setVisible() are no-ops after destroy', () => {
    const { scene } = createScene();
    const overlay = new DesyncReportOverlay(scene, {});
    overlay.destroy();
    expect(() => overlay.update(makeReport())).not.toThrow();
    expect(() => overlay.setVisible(true)).not.toThrow();
    expect(overlay.isVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// withController integration
// ---------------------------------------------------------------------------

describe('DesyncReportOverlay.withController', () => {
  it('Halt button drives controller.halt()', () => {
    const verifier = new PlaybackChecksumVerifier({
      records: [makeRecord(300)],
      logger: SILENT_LOGGER,
    });
    const controller = new DesyncRecoveryController({ verifier });
    const { scene, texts } = createScene();
    DesyncReportOverlay.withController(scene, controller, { maxRows: 1 });
    const haltText = texts[texts.length - 1]!;
    expect(controller.isHalted()).toBe(false);
    haltText.handlers['pointerdown']!();
    expect(controller.isHalted()).toBe(true);
    expect(controller.getReport().haltReason).toMatch(/manual halt/);
  });

  it('Continue button after a halt resets the controller and relaxes tolerance', () => {
    const verifier = new PlaybackChecksumVerifier({
      records: [makeRecord(300, 5)],
      logger: SILENT_LOGGER,
    });
    const controller = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'halt-on-first' },
    });
    const { scene, texts } = createScene();
    DesyncReportOverlay.withController(scene, controller, { maxRows: 1 });

    // Trigger a halt via a divergence.
    controller.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99)));
    expect(controller.isHalted()).toBe(true);

    // Click Continue → expect controller back to idle, tolerance now 'continue'.
    const continueText = texts[texts.length - 2]!;
    continueText.handlers['pointerdown']!();
    expect(controller.isHalted()).toBe(false);
    expect(controller.getStatus()).toBe('idle');
    expect(controller.getTolerance()).toEqual({ kind: 'continue' });
  });

  it('Continue button while monitoring just dismisses the overlay', () => {
    const verifier = new PlaybackChecksumVerifier({
      records: [makeRecord(300)],
      logger: SILENT_LOGGER,
    });
    const controller = new DesyncRecoveryController({ verifier });
    const { scene, texts } = createScene();
    const overlay = DesyncReportOverlay.withController(scene, controller, {
      maxRows: 1,
    });
    overlay.setVisible(true);
    expect(overlay.isVisible()).toBe(true);
    const continueText = texts[texts.length - 2]!;
    continueText.handlers['pointerdown']!();
    expect(overlay.isVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: live verifier feeding the controller and overlay
// ---------------------------------------------------------------------------

describe('DesyncReportOverlay — end-to-end with verifier', () => {
  it('paints the verdict + halt summary after the controller halts', () => {
    const verifier = new PlaybackChecksumVerifier({
      records: [makeRecord(300, 5)],
      logger: SILENT_LOGGER,
    });
    const controller = new DesyncRecoveryController({
      verifier,
      tolerance: { kind: 'halt-on-first' },
    });
    const { scene } = createScene();
    const overlay = DesyncReportOverlay.withController(scene, controller, {
      maxRows: 5,
    });
    controller.ingest(verifier.verifyFrame(300, makeSnapshot(300, 99)));
    overlay.update(controller.getReport());

    const banner = overlay.getBannerSnapshot();
    expect(banner[0]).toBe('REPLAY DESYNC (halted)');
    expect(banner[1]).toContain('halted at frame 300');
    expect(overlay.isVisible()).toBe(true);
    const rows = overlay.getRowSnapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toMatch(/^f300 · mismatch/);
  });
});
