import { describe, it, expect } from 'vitest';
import {
  HitboxDebugLayer,
  type HitboxDebugGraphicsLike,
  type HitboxDebugSceneShim,
} from './HitboxDebugLayer';
import type { HitboxDebugFighterSnapshot } from './hitboxDebugFormat';
import type { AttackMove } from '../characters/attacks';
import type { Hurtbox } from '../characters/moveSchema';

/**
 * Phaser-touching component test for the F3 hitbox debug layer. A
 * recording Graphics fake lets the suite assert the overlay only draws
 * while enabled, clears on disable, and batches every fighter's boxes
 * into one redraw — all under plain Node.
 */

interface FakeGraphics extends HitboxDebugGraphicsLike {
  clears: number;
  fillRects: number;
  strokeRects: number;
  visible: boolean;
  destroyed: boolean;
}

function makeGraphics(): FakeGraphics {
  const g: FakeGraphics = {
    clears: 0,
    fillRects: 0,
    strokeRects: 0,
    visible: true,
    destroyed: false,
    clear() {
      g.clears += 1;
      return g;
    },
    fillStyle() {
      return g;
    },
    lineStyle() {
      return g;
    },
    fillRect() {
      g.fillRects += 1;
      return g;
    },
    strokeRect() {
      g.strokeRects += 1;
      return g;
    },
    setVisible(v) {
      g.visible = v;
      return g;
    },
    setDepth() {
      return g;
    },
    destroy() {
      g.destroyed = true;
    },
  };
  return g;
}

function makeScene(): { scene: HitboxDebugSceneShim; gfx: FakeGraphics } {
  const gfx = makeGraphics();
  const scene: HitboxDebugSceneShim = {
    add: {
      graphics() {
        return gfx;
      },
    },
  };
  return { scene, gfx };
}

const MOVE: AttackMove = {
  id: 'wolf.smash.forward',
  type: 'smash',
  damage: 18,
  knockback: { x: 8, y: -4, scaling: 0.3 },
  hitbox: { offsetX: 70, offsetY: -8, width: 90, height: 50 },
  startupFrames: 12,
  activeFrames: 4,
  recoveryFrames: 20,
  cooldownFrames: 6,
};

const BODY: Hurtbox = Object.freeze({
  id: 'body',
  offsetX: 0,
  offsetY: 0,
  width: 90,
  height: 130,
});

function snap(
  overrides: Partial<HitboxDebugFighterSnapshot>,
): HitboxDebugFighterSnapshot {
  return {
    bodyX: 400,
    bodyY: 300,
    facing: 1,
    hurtboxes: [BODY],
    activeAttack: null,
    activeGrab: null,
    ...overrides,
  };
}

describe('HitboxDebugLayer', () => {
  it('starts disabled and hidden', () => {
    const { scene, gfx } = makeScene();
    const layer = new HitboxDebugLayer(scene);
    expect(layer.isEnabled()).toBe(false);
    expect(gfx.visible).toBe(false);
  });

  it('render is a no-op while disabled', () => {
    const { scene, gfx } = makeScene();
    const layer = new HitboxDebugLayer(scene);
    layer.render([snap({})]);
    expect(gfx.clears).toBe(0);
    expect(gfx.strokeRects).toBe(0);
  });

  it('toggle enables, shows, and draws hurtbox outlines', () => {
    const { scene, gfx } = makeScene();
    const layer = new HitboxDebugLayer(scene);
    expect(layer.toggle()).toBe(true);
    expect(gfx.visible).toBe(true);
    layer.render([snap({})]);
    expect(gfx.clears).toBe(1);
    expect(gfx.strokeRects).toBe(1); // one hurtbox outline
    expect(gfx.fillRects).toBe(0); // hurtboxes are outline-only
  });

  it('draws fill + stroke for an active attack hitbox', () => {
    const { scene, gfx } = makeScene();
    const layer = new HitboxDebugLayer(scene);
    layer.setEnabled(true);
    layer.render([
      snap({ activeAttack: { move: MOVE, facing: 1, phase: 'active' } }),
    ]);
    // hurtbox (stroke) + attack (fill + stroke).
    expect(gfx.fillRects).toBe(1);
    expect(gfx.strokeRects).toBe(2);
  });

  it('batches every fighter into a single clear per frame', () => {
    const { scene, gfx } = makeScene();
    const layer = new HitboxDebugLayer(scene);
    layer.setEnabled(true);
    layer.render([snap({}), snap({ bodyX: 600 })]);
    expect(gfx.clears).toBe(1);
    expect(gfx.strokeRects).toBe(2); // one hurtbox each
  });

  it('disabling clears and hides', () => {
    const { scene, gfx } = makeScene();
    const layer = new HitboxDebugLayer(scene);
    layer.setEnabled(true);
    layer.render([snap({})]);
    layer.setEnabled(false);
    expect(gfx.visible).toBe(false);
    expect(layer.isEnabled()).toBe(false);
    // The disable triggered an extra clear beyond the render's.
    expect(gfx.clears).toBe(2);
  });

  it('destroy() is idempotent and silences later renders', () => {
    const { scene, gfx } = makeScene();
    const layer = new HitboxDebugLayer(scene);
    layer.setEnabled(true);
    layer.destroy();
    expect(gfx.destroyed).toBe(true);
    expect(() => layer.destroy()).not.toThrow();
    expect(() => layer.render([snap({})])).not.toThrow();
  });
});
