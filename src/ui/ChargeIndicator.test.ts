import { describe, it, expect } from 'vitest';
import {
  ChargeIndicator,
  type ChargeArcLike,
  type ChargeRectLike,
  type ChargeIndicatorSceneShim,
} from './ChargeIndicator';
import { CHARGE_INDICATOR_BAR_WIDTH } from './chargeIndicatorFormat';

/**
 * Phaser-touching component test for the charge-indicator overlay. Uses
 * a hand-rolled scene + arc/rect fakes so the suite runs under plain
 * Node without booting Phaser. Mirrors the ShieldBubble component test.
 */

interface FakeArc extends ChargeArcLike {
  position: { x: number; y: number };
  radius: number;
  fillColor: number;
  fillAlpha: number;
  strokeWidth: number;
  strokeColor: number;
  strokeAlpha: number;
  visible: boolean;
  depth: number;
  destroyed: boolean;
}

interface FakeRect extends ChargeRectLike {
  position: { x: number; y: number };
  width: number;
  height: number;
  origin: { x: number; y: number };
  fillColor: number;
  fillAlpha: number;
  visible: boolean;
  depth: number;
  destroyed: boolean;
}

function createFakeArc(): FakeArc {
  const arc: FakeArc = {
    position: { x: 0, y: 0 },
    radius: 1,
    fillColor: 0,
    fillAlpha: 0,
    strokeWidth: 0,
    strokeColor: 0,
    strokeAlpha: 0,
    visible: true,
    depth: 0,
    destroyed: false,
    setPosition(x, y) {
      arc.position = { x, y };
      return arc;
    },
    setRadius(r) {
      arc.radius = r;
      return arc;
    },
    setFillStyle(color = 0, alpha = 1) {
      arc.fillColor = color;
      arc.fillAlpha = alpha;
      return arc;
    },
    setStrokeStyle(width = 0, color = 0, alpha = 1) {
      arc.strokeWidth = width;
      arc.strokeColor = color;
      arc.strokeAlpha = alpha;
      return arc;
    },
    setVisible(visible) {
      arc.visible = visible;
      return arc;
    },
    setDepth(depth) {
      arc.depth = depth;
      return arc;
    },
    destroy() {
      arc.destroyed = true;
    },
  };
  return arc;
}

function createFakeRect(): FakeRect {
  const rect: FakeRect = {
    position: { x: 0, y: 0 },
    width: 1,
    height: 1,
    origin: { x: 0.5, y: 0.5 },
    fillColor: 0,
    fillAlpha: 0,
    visible: true,
    depth: 0,
    destroyed: false,
    setPosition(x, y) {
      rect.position = { x, y };
      return rect;
    },
    setSize(w, h) {
      rect.width = w;
      rect.height = h;
      return rect;
    },
    setOrigin(x, y = x) {
      rect.origin = { x, y };
      return rect;
    },
    setFillStyle(color = 0, alpha = 1) {
      rect.fillColor = color;
      rect.fillAlpha = alpha;
      return rect;
    },
    setVisible(visible) {
      rect.visible = visible;
      return rect;
    },
    setDepth(depth) {
      rect.depth = depth;
      return rect;
    },
    destroy() {
      rect.destroyed = true;
    },
  };
  return rect;
}

function createFakeScene(): {
  shim: ChargeIndicatorSceneShim;
  arcs: FakeArc[];
  rects: FakeRect[];
} {
  const arcs: FakeArc[] = [];
  const rects: FakeRect[] = [];
  const shim: ChargeIndicatorSceneShim = {
    add: {
      circle() {
        const arc = createFakeArc();
        arcs.push(arc);
        return arc;
      },
      rectangle() {
        const rect = createFakeRect();
        rects.push(rect);
        return rect;
      },
    },
  };
  return { shim, arcs, rects };
}

describe('ChargeIndicator — construction', () => {
  it('starts all parts invisible at depth 6 by default', () => {
    const { shim, arcs, rects } = createFakeScene();
    new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    expect(arcs.length).toBe(1);
    expect(rects.length).toBe(2); // track + fill
    expect(arcs[0]!.visible).toBe(false);
    expect(rects[0]!.visible).toBe(false);
    expect(rects[1]!.visible).toBe(false);
    expect(arcs[0]!.depth).toBe(6);
  });

  it('honours a custom depth override', () => {
    const { shim, arcs } = createFakeScene();
    new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80, depth: 20 });
    expect(arcs[0]!.depth).toBe(20);
  });

  it('left-anchors the bar fill so it grows rightward', () => {
    const { shim, rects } = createFakeScene();
    new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    // rects[1] is the fill (constructed second).
    expect(rects[1]!.origin.x).toBe(0);
  });
});

describe('ChargeIndicator — update', () => {
  it('stays hidden when not charging (null progress)', () => {
    const { shim, arcs, rects } = createFakeScene();
    const ind = new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    ind.update({ chargeProgress: null, x: 100, y: 200, frame: 0 });
    expect(arcs[0]!.visible).toBe(false);
    expect(rects[0]!.visible).toBe(false);
    expect(rects[1]!.visible).toBe(false);
  });

  it('shows a pulsing aura + bar pinned to the body while charging', () => {
    const { shim, arcs, rects } = createFakeScene();
    const ind = new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    ind.update({ chargeProgress: 0.5, x: 320, y: 480, frame: 5 });
    const ring = arcs[0]!;
    expect(ring.visible).toBe(true);
    expect(ring.position).toEqual({ x: 320, y: 480 });
    expect(ring.radius).toBeGreaterThan(40);
    expect(ring.strokeAlpha).toBeGreaterThan(0);

    const track = rects[0]!;
    const fill = rects[1]!;
    expect(track.visible).toBe(true);
    expect(fill.visible).toBe(true);
    // Bar floats above the body centre.
    expect(track.position.y).toBeLessThan(480);
    // Fill is left-anchored at the track's left edge.
    expect(fill.position.x).toBe(320 - CHARGE_INDICATOR_BAR_WIDTH / 2);
    // Half-charge → roughly half-width fill.
    expect(fill.width).toBeCloseTo(CHARGE_INDICATOR_BAR_WIDTH * 0.5, 6);
  });

  it('ramps the aura colour cool → hot as charge climbs', () => {
    const { shim, arcs } = createFakeScene();
    const ind = new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    ind.update({ chargeProgress: 0.1, x: 0, y: 0, frame: 0 });
    expect(arcs[0]!.strokeColor).toBe(0xffffff); // white / cool
    ind.update({ chargeProgress: 1, x: 0, y: 0, frame: 0 });
    expect(arcs[0]!.strokeColor).toBe(0xff3030); // red / hot
  });

  it('widens the bar fill as charge climbs', () => {
    const { shim, rects } = createFakeScene();
    const ind = new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    ind.update({ chargeProgress: 0.2, x: 0, y: 0, frame: 0 });
    const narrow = rects[1]!.width;
    ind.update({ chargeProgress: 0.9, x: 0, y: 0, frame: 0 });
    expect(rects[1]!.width).toBeGreaterThan(narrow);
  });
});

describe('ChargeIndicator — lifecycle', () => {
  it('hide() makes every part invisible without destroying them', () => {
    const { shim, arcs, rects } = createFakeScene();
    const ind = new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    ind.update({ chargeProgress: 0.5, x: 0, y: 0, frame: 0 });
    expect(arcs[0]!.visible).toBe(true);
    ind.hide();
    expect(arcs[0]!.visible).toBe(false);
    expect(rects[0]!.visible).toBe(false);
    expect(rects[1]!.visible).toBe(false);
    expect(arcs[0]!.destroyed).toBe(false);
  });

  it('destroy() destroys every part and is idempotent', () => {
    const { shim, arcs, rects } = createFakeScene();
    const ind = new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    ind.destroy();
    expect(arcs[0]!.destroyed).toBe(true);
    expect(rects[0]!.destroyed).toBe(true);
    expect(rects[1]!.destroyed).toBe(true);
    expect(() => ind.destroy()).not.toThrow();
  });

  it('update() after destroy() is a silent no-op', () => {
    const { shim, arcs } = createFakeScene();
    const ind = new ChargeIndicator(shim, { bodyRadius: 40, bodyHeight: 80 });
    ind.destroy();
    arcs[0]!.visible = true; // tamper to verify update doesn't change it
    ind.update({ chargeProgress: 0.5, x: 0, y: 0, frame: 0 });
    expect(arcs[0]!.visible).toBe(true);
  });
});
