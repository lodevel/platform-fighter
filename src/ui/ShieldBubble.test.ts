import { describe, it, expect } from 'vitest';
import {
  ShieldBubble,
  type ShieldArcLike,
  type ShieldBubbleSceneShim,
} from './ShieldBubble';
import {
  SHIELD_BUBBLE_ACTIVE_STROKE_WIDTH,
  SHIELD_BUBBLE_BROKEN_STROKE_COLOR,
} from './shieldBubbleFormat';
import {
  SHIELD_DEFAULTS,
  applyShieldHit,
  createShieldState,
  tickShield,
} from '../characters/shieldState';

/**
 * AC 60401 Sub-AC 1 — Phaser-touching component test for the shield
 * bubble overlay. Uses a hand-rolled scene + arc fake so the suite
 * runs under plain Node without booting Phaser.
 */

interface FakeArc extends ShieldArcLike {
  position: { x: number; y: number };
  radius: number;
  fillColor: number;
  fillAlpha: number;
  strokeWidth: number;
  strokeColor: number;
  strokeAlpha: number;
  visible: boolean;
  depth: number;
  scrollFactor: { x: number; y: number };
  destroyed: boolean;
}

function createFakeArc(initial: {
  x: number;
  y: number;
  radius: number;
  fillColor: number;
  fillAlpha: number;
}): FakeArc {
  const arc: FakeArc = {
    position: { x: initial.x, y: initial.y },
    radius: initial.radius,
    fillColor: initial.fillColor,
    fillAlpha: initial.fillAlpha,
    strokeWidth: 0,
    strokeColor: 0,
    strokeAlpha: 0,
    visible: true,
    depth: 0,
    scrollFactor: { x: 1, y: 1 },
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
    setScrollFactor(x, y = x) {
      arc.scrollFactor = { x, y };
      return arc;
    },
    destroy() {
      arc.destroyed = true;
    },
  };
  return arc;
}

function createFakeScene(): {
  shim: ShieldBubbleSceneShim;
  lastArc: () => FakeArc;
} {
  const arcs: FakeArc[] = [];
  const shim: ShieldBubbleSceneShim = {
    add: {
      circle(x, y, radius, fillColor = 0, fillAlpha = 1) {
        const arc = createFakeArc({ x, y, radius, fillColor, fillAlpha });
        arcs.push(arc);
        return arc;
      },
    },
  };
  return { shim, lastArc: () => arcs[arcs.length - 1]! };
}

describe('ShieldBubble — construction', () => {
  it('starts invisible at depth 5 by default', () => {
    const { shim, lastArc } = createFakeScene();
    new ShieldBubble(shim, { bodyRadius: 40, maxHealth: 50 });
    const arc = lastArc();
    expect(arc.visible).toBe(false);
    expect(arc.depth).toBe(5);
  });

  it('honours a custom depth override', () => {
    const { shim, lastArc } = createFakeScene();
    new ShieldBubble(shim, { bodyRadius: 40, maxHealth: 50, depth: 17 });
    expect(lastArc().depth).toBe(17);
  });
});

describe('ShieldBubble — update', () => {
  it('stays hidden while shield is idle', () => {
    const { shim, lastArc } = createFakeScene();
    const bubble = new ShieldBubble(shim, { bodyRadius: 40, maxHealth: 50 });
    bubble.update({ state: createShieldState(), x: 100, y: 200, frame: 0 });
    expect(lastArc().visible).toBe(false);
  });

  it('shows a coloured bubble pinned to the body when shield is active', () => {
    const { shim, lastArc } = createFakeScene();
    const bubble = new ShieldBubble(shim, { bodyRadius: 40, maxHealth: 50 });
    const active = tickShield(createShieldState(), { held: true });
    bubble.update({ state: active, x: 320, y: 480, frame: 5 });
    const arc = lastArc();
    expect(arc.visible).toBe(true);
    expect(arc.position).toEqual({ x: 320, y: 480 });
    expect(arc.radius).toBeGreaterThan(40);
    // Healthy → blue
    expect(arc.fillColor).toBe(0x4dd0ff);
    expect(arc.strokeColor).toBe(0x4dd0ff);
    expect(arc.strokeWidth).toBe(SHIELD_BUBBLE_ACTIVE_STROKE_WIDTH);
  });

  it('paints the broken-state ring with red strobing stroke', () => {
    const { shim, lastArc } = createFakeScene();
    const bubble = new ShieldBubble(shim, { bodyRadius: 40, maxHealth: 5 });
    const tinyShieldTuning = {
      maxHealth: 5,
      decayPerFrame: 0,
      breakStunFrames: 30,
      postBreakHealth: 5,
      regenPerFrame: 0,
      regenDelayFrames: 30,
      minHealthToRaise: 1,
    } as const;
    let s = tickShield(createShieldState(tinyShieldTuning), { held: true }, tinyShieldTuning);
    s = applyShieldHit(s, 999, tinyShieldTuning).state;
    bubble.update({ state: s, x: 50, y: 60, frame: 0 });
    const arc = lastArc();
    expect(arc.visible).toBe(true);
    expect(arc.strokeColor).toBe(SHIELD_BUBBLE_BROKEN_STROKE_COLOR);
  });

  it('shrinks the bubble radius as the shield drains', () => {
    const { shim, lastArc } = createFakeScene();
    const bubble = new ShieldBubble(shim, {
      bodyRadius: 40,
      maxHealth: SHIELD_DEFAULTS.maxHealth,
    });
    let s = tickShield(createShieldState(), { held: true });
    bubble.update({ state: s, x: 0, y: 0, frame: 0 });
    const fullRadius = lastArc().radius;
    // Drain shield with successive ticks then remeasure.
    for (let i = 0; i < 200; i += 1) s = tickShield(s, { held: true });
    bubble.update({ state: s, x: 0, y: 0, frame: 200 });
    expect(lastArc().radius).toBeLessThan(fullRadius);
  });
});

describe('ShieldBubble — lifecycle', () => {
  it('hide() makes the arc invisible without destroying it', () => {
    const { shim, lastArc } = createFakeScene();
    const bubble = new ShieldBubble(shim, { bodyRadius: 40, maxHealth: 50 });
    const active = tickShield(createShieldState(), { held: true });
    bubble.update({ state: active, x: 0, y: 0, frame: 0 });
    expect(lastArc().visible).toBe(true);
    bubble.hide();
    expect(lastArc().visible).toBe(false);
    expect(lastArc().destroyed).toBe(false);
  });

  it('destroy() destroys the arc and is idempotent', () => {
    const { shim, lastArc } = createFakeScene();
    const bubble = new ShieldBubble(shim, { bodyRadius: 40, maxHealth: 50 });
    bubble.destroy();
    expect(lastArc().destroyed).toBe(true);
    expect(() => bubble.destroy()).not.toThrow();
  });

  it('update() after destroy() is a silent no-op', () => {
    const { shim, lastArc } = createFakeScene();
    const bubble = new ShieldBubble(shim, { bodyRadius: 40, maxHealth: 50 });
    bubble.destroy();
    const arc = lastArc();
    arc.visible = true; // tamper to verify update doesn't change it
    const active = tickShield(createShieldState(), { held: true });
    bubble.update({ state: active, x: 0, y: 0, frame: 0 });
    // No mutation should fire — the arc stays as we left it.
    expect(arc.visible).toBe(true);
  });
});
