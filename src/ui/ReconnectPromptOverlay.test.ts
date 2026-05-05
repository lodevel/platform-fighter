/**
 * AC 14 Sub-AC 3 — reconnect prompt overlay tests.
 *
 * Exercises the Phaser-touching overlay through a hand-rolled scene
 * shim — same pattern as `DamageHud` / `RebindingScreen` /
 * `DesyncReportOverlay` tests.
 *
 * Coverage map:
 *
 *   • Construction creates background + accent + headline + body text
 *     slots; nothing visible until `update()` flips it on.
 *   • update() paints the headline + body via the format helpers.
 *   • Phase predicate drives visibility (waiting / partial visible,
 *     reconnected / acknowledged hidden).
 *   • Accent strip + panel stroke tint to the first affected slot.
 *   • Multi-pad partial-reconnect renders coherent multi-line copy.
 *   • showResumed / showAcknowledged convenience helpers do the right
 *     thing.
 *   • destroy() tears down every Phaser child and is idempotent.
 *   • update() throws cleanly on a malformed snapshot.
 */

import { describe, expect, it } from 'vitest';
import { ReconnectPromptOverlay } from './ReconnectPromptOverlay';
import { slotAccentColor } from './reconnectPromptFormat';

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
  setAlpha(alpha: number): FakeText;
  destroy(): void;
  text: string;
  color: string;
  visible: boolean;
  destroyed: boolean;
  depth: number;
  origin: { x: number; y: number };
  position: { x: number; y: number };
}

interface FakeRect {
  setOrigin(x: number, y?: number): FakeRect;
  setStrokeStyle(width: number, color: number, alpha?: number): FakeRect;
  setFillStyle(color: number, alpha?: number): FakeRect;
  setScrollFactor(x: number, y?: number): FakeRect;
  setPosition(x: number, y: number): FakeRect;
  setSize(width: number, height: number): FakeRect;
  setDepth(depth: number): FakeRect;
  setVisible(visible: boolean): FakeRect;
  destroy(): void;
  fillColor: number;
  strokeColor: number;
  visible: boolean;
  destroyed: boolean;
  depth: number;
}

function createText(initial: string): FakeText {
  const t: FakeText = {
    text: initial,
    color: '',
    visible: false,
    destroyed: false,
    depth: 0,
    origin: { x: 0, y: 0 },
    position: { x: 0, y: 0 },
    setText(v) {
      t.text = v;
      return t;
    },
    setColor(c) {
      t.color = c;
      return t;
    },
    setOrigin(x, y = x) {
      t.origin = { x, y };
      return t;
    },
    setScrollFactor() {
      return t;
    },
    setPosition(x, y) {
      t.position = { x, y };
      return t;
    },
    setDepth(d) {
      t.depth = d;
      return t;
    },
    setVisible(v) {
      t.visible = v;
      return t;
    },
    setAlpha() {
      return t;
    },
    destroy() {
      t.destroyed = true;
    },
  };
  return t;
}

function createRect(fillColor: number): FakeRect {
  const r: FakeRect = {
    fillColor,
    strokeColor: 0,
    visible: false,
    destroyed: false,
    depth: 0,
    setOrigin() {
      return r;
    },
    setStrokeStyle(_w, color) {
      r.strokeColor = color;
      return r;
    },
    setFillStyle(color) {
      r.fillColor = color;
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
    setDepth(d) {
      r.depth = d;
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
      rectangle(
        _x: number,
        _y: number,
        _w: number,
        _h: number,
        fillColor: number,
      ) {
        const r = createRect(fillColor);
        rects.push(r);
        return r;
      },
    },
  };
  return { scene, texts, rects };
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('ReconnectPromptOverlay construction', () => {
  it('creates a background rect, an accent rect, a headline, and body slots', () => {
    const { scene, texts, rects } = createScene();
    const overlay = new ReconnectPromptOverlay(scene, { maxBodyLines: 4 });
    // 2 rectangles (background + accent strip).
    expect(rects).toHaveLength(2);
    // 1 headline + 4 body lines = 5 text objects.
    expect(texts).toHaveLength(5);
    expect(overlay.isVisible()).toBe(false);
  });

  it('hides every Phaser child until update() runs', () => {
    const { scene, texts, rects } = createScene();
    new ReconnectPromptOverlay(scene);
    for (const r of rects) expect(r.visible).toBe(false);
    for (const t of texts) expect(t.visible).toBe(false);
  });

  it('stamps the configured Phaser depth + 1 onto the foreground children', () => {
    const { scene, texts, rects } = createScene();
    new ReconnectPromptOverlay(scene, { depth: 1500 });
    // Background sits at the base depth; the accent strip + text sit
    // one tier higher so they paint over it.
    const [background, accent] = rects;
    expect(background!.depth).toBe(1500);
    expect(accent!.depth).toBe(1501);
    for (const t of texts) expect(t.depth).toBe(1501);
  });
});

// ---------------------------------------------------------------------------
// update() — text + visibility
// ---------------------------------------------------------------------------

describe('ReconnectPromptOverlay.update', () => {
  it('paints the headline + body for a single-slot waiting snapshot', () => {
    const { scene, texts } = createScene();
    const overlay = new ReconnectPromptOverlay(scene, { maxBodyLines: 4 });
    overlay.update({ affectedSlots: [1], phase: 'waiting' });
    const headline = texts[0]!;
    expect(headline.text).toBe('P1 — Controller disconnected');
    // Two body lines populated, the rest blank.
    expect(texts[1]!.text).toBe('Plug the controller back in to resume.');
    expect(texts[2]!.text).toBe(
      'Press Start on a connected pad to continue without it.',
    );
    expect(texts[3]!.text).toBe('');
    expect(texts[4]!.text).toBe('');
  });

  it('renders the multi-pad waiting headline with the plural noun', () => {
    const { scene, texts } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({ affectedSlots: [1, 3], phase: 'waiting' });
    expect(texts[0]!.text).toBe('P1 + P3 — Controllers disconnected');
  });

  it('flips body copy when partial-reconnect leaves a single slot waiting', () => {
    const { scene, texts } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({ affectedSlots: [3], phase: 'partial-reconnect' });
    expect(texts[0]!.text).toBe('P3 — Still disconnected');
    expect(texts[1]!.text).toBe('Still waiting on the remaining controller.');
  });

  it('shows the panel during waiting / partial phases, hides on reconnect', () => {
    const { scene } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({ affectedSlots: [1], phase: 'waiting' });
    expect(overlay.isVisible()).toBe(true);

    overlay.update({ affectedSlots: [1], phase: 'partial-reconnect' });
    expect(overlay.isVisible()).toBe(true);

    overlay.update({ affectedSlots: [], phase: 'reconnected' });
    expect(overlay.isVisible()).toBe(false);

    overlay.update({ affectedSlots: [1], phase: 'waiting' });
    expect(overlay.isVisible()).toBe(true);

    overlay.update({ affectedSlots: [], phase: 'acknowledged' });
    expect(overlay.isVisible()).toBe(false);
  });

  it('makes only populated body lines visible while showing', () => {
    const { scene, texts } = createScene();
    const overlay = new ReconnectPromptOverlay(scene, { maxBodyLines: 4 });
    overlay.update({ affectedSlots: [1], phase: 'waiting' });
    // Lines 0..2 populated → visible. Lines 3..4 blank → hidden.
    expect(texts[1]!.visible).toBe(true);
    expect(texts[2]!.visible).toBe(true);
    expect(texts[3]!.visible).toBe(false);
    expect(texts[4]!.visible).toBe(false);
  });

  it('quotes the device label when one is provided', () => {
    const { scene, texts } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({
      affectedSlots: [3],
      padLabels: ['Xbox 360 Controller'],
      phase: 'waiting',
    });
    expect(texts[1]!.text).toBe(
      'Plug "Xbox 360 Controller" back in to resume.',
    );
  });

  it('throws on a malformed snapshot', () => {
    const { scene } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => overlay.update(null as any)).toThrow(
      /must be a non-null object/,
    );
  });
});

// ---------------------------------------------------------------------------
// Accent strip + panel stroke
// ---------------------------------------------------------------------------

describe('ReconnectPromptOverlay accenting', () => {
  it('tints the accent strip + panel stroke to the first affected slot', () => {
    const { scene, rects } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({ affectedSlots: [3], phase: 'waiting' });
    const [background, accent] = rects;
    expect(accent!.fillColor).toBe(slotAccentColor(3));
    expect(background!.strokeColor).toBe(slotAccentColor(3));
    expect(overlay.getAccentColor()).toBe(slotAccentColor(3));
  });

  it('falls back to a neutral slate when no slot is named (post-resume frames)', () => {
    const { scene, rects } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({ affectedSlots: [], phase: 'reconnected' });
    const [, accent] = rects;
    // The fallback tint is the same neutral slate `slotAccentColor(0)`
    // returns. We don't pin the literal hex here — re-using the
    // formatter ensures the assertion mirrors any future palette tweak.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(accent!.fillColor).toBe(slotAccentColor(0 as any));
  });
});

// ---------------------------------------------------------------------------
// Convenience helpers + lifecycle
// ---------------------------------------------------------------------------

describe('ReconnectPromptOverlay convenience helpers', () => {
  it('showResumed paints the reconnected line and hides itself', () => {
    const { scene, texts } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.showResumed();
    expect(texts[0]!.text).toBe('Controller reconnected');
    expect(overlay.isVisible()).toBe(false);
    expect(overlay.getPhase()).toBe('reconnected');
  });

  it('showAcknowledged paints the dismissed line and hides itself', () => {
    const { scene, texts } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.showAcknowledged();
    expect(texts[0]!.text).toBe('Continuing without controller');
    expect(overlay.isVisible()).toBe(false);
    expect(overlay.getPhase()).toBe('acknowledged');
  });
});

describe('ReconnectPromptOverlay.destroy', () => {
  it('destroys every Phaser child and zeroes visibility', () => {
    const { scene, texts, rects } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({ affectedSlots: [1], phase: 'waiting' });
    overlay.destroy();
    for (const t of texts) expect(t.destroyed).toBe(true);
    for (const r of rects) expect(r.destroyed).toBe(true);
  });

  it('is idempotent', () => {
    const { scene } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.destroy();
    expect(() => overlay.destroy()).not.toThrow();
  });

  it('ignores update() / setVisible() after destroy', () => {
    const { scene } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.destroy();
    expect(() =>
      overlay.update({ affectedSlots: [1], phase: 'waiting' }),
    ).not.toThrow();
    expect(overlay.isVisible()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Snapshot accessors
// ---------------------------------------------------------------------------

describe('ReconnectPromptOverlay accessors', () => {
  it('getLastSnapshot returns the most recent input', () => {
    const { scene } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    expect(overlay.getLastSnapshot()).toBeNull();
    overlay.update({ affectedSlots: [2], phase: 'waiting' });
    expect(overlay.getLastSnapshot()).toEqual({
      affectedSlots: [2],
      phase: 'waiting',
    });
  });

  it('getRenderedLines returns the deterministic full text of the overlay', () => {
    const { scene } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({ affectedSlots: [1, 3], phase: 'waiting' });
    expect(overlay.getRenderedLines()).toEqual([
      'P1 + P3 — Controllers disconnected',
      'Plug the controller back in to resume.',
      'Press Start on a connected pad to continue without it.',
    ]);
  });

  it('getVisibleBodyLines mirrors the body slots with non-empty text', () => {
    const { scene } = createScene();
    const overlay = new ReconnectPromptOverlay(scene, { maxBodyLines: 4 });
    overlay.update({ affectedSlots: [1], phase: 'waiting' });
    expect(overlay.getVisibleBodyLines()).toEqual([
      'Plug the controller back in to resume.',
      'Press Start on a connected pad to continue without it.',
    ]);
  });

  it('getStrokeColorHex round-trips through the formatter', () => {
    const { scene } = createScene();
    const overlay = new ReconnectPromptOverlay(scene);
    overlay.update({ affectedSlots: [4], phase: 'waiting' });
    expect(overlay.getStrokeColorHex()).toBe('#ffe066');
  });
});
