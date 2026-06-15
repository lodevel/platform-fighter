import { describe, it, expect } from 'vitest';
import {
  SwingTrail,
  type SwingTrailRectLike,
  type SwingTrailSceneShim,
  type SwingTrailSnapshot,
} from './SwingTrail';

/**
 * Phaser-touching component test for the swing trail. A hand-rolled
 * scene + rect fake lets the suite run under plain Node. We assert the
 * trail follows the mirrored hitbox footprint, hides on non-trailed
 * moves, and tears down cleanly.
 */

interface FakeRect extends SwingTrailRectLike {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  fillAlpha: number;
  destroyed: boolean;
}

function makeRect(): FakeRect {
  const r: FakeRect = {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    visible: true,
    fillAlpha: 0,
    destroyed: false,
    setPosition(x, y) {
      r.x = x;
      r.y = y;
      return r;
    },
    setSize(w, h) {
      r.width = w;
      r.height = h;
      return r;
    },
    setFillStyle(_c, alpha = 1) {
      r.fillAlpha = alpha;
      return r;
    },
    setStrokeStyle() {
      return r;
    },
    setVisible(v) {
      r.visible = v;
      return r;
    },
    setDepth() {
      return r;
    },
    destroy() {
      r.destroyed = true;
    },
  };
  return r;
}

function makeScene(): { scene: SwingTrailSceneShim; rects: FakeRect[] } {
  const rects: FakeRect[] = [];
  const scene: SwingTrailSceneShim = {
    add: {
      rectangle() {
        const r = makeRect();
        rects.push(r);
        return r;
      },
    },
  };
  return { scene, rects };
}

const HITBOX = Object.freeze({ offsetX: 60, offsetY: -10, width: 80, height: 40 });

function snapshot(overrides: Partial<SwingTrailSnapshot>): SwingTrailSnapshot {
  return {
    moveId: 'item.sword.slash',
    moveType: 'smash',
    damage: 14,
    phase: 'active',
    framesIntoActive: 0,
    hitbox: HITBOX,
    facing: 1,
    bodyX: 500,
    bodyY: 300,
    ...overrides,
  };
}

describe('SwingTrail', () => {
  it('draws on the mirrored hitbox footprint at the body position', () => {
    const { scene, rects } = makeScene();
    const trail = new SwingTrail(scene);
    trail.update(snapshot({ facing: 1 }));
    const rect = rects[0]!;
    expect(rect.visible).toBe(true);
    expect(rect.x).toBe(500 + HITBOX.offsetX); // body + forward offset
    expect(rect.y).toBe(300 + HITBOX.offsetY);
    expect(rect.width).toBe(HITBOX.width);
    expect(rect.height).toBe(HITBOX.height);
  });

  it('mirrors to the left when facing left', () => {
    const { scene, rects } = makeScene();
    const trail = new SwingTrail(scene);
    trail.update(snapshot({ facing: -1 }));
    expect(rects[0]!.x).toBe(500 - HITBOX.offsetX);
  });

  it('hides for a non-trailed move (a jab)', () => {
    const { scene, rects } = makeScene();
    const trail = new SwingTrail(scene);
    trail.update(snapshot({ moveId: 'wolf.jab', moveType: 'jab' }));
    expect(rects[0]!.visible).toBe(false);
  });

  it('hides during startup / recovery', () => {
    const { scene, rects } = makeScene();
    const trail = new SwingTrail(scene);
    trail.update(snapshot({ phase: 'startup' }));
    expect(rects[0]!.visible).toBe(false);
  });

  it('destroy() is idempotent and silences later updates', () => {
    const { scene, rects } = makeScene();
    const trail = new SwingTrail(scene);
    trail.destroy();
    expect(rects[0]!.destroyed).toBe(true);
    expect(() => trail.destroy()).not.toThrow();
    expect(() => trail.update(snapshot({}))).not.toThrow();
  });
});
