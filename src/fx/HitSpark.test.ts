import { describe, it, expect } from 'vitest';
import {
  HitSparkPool,
  type HitSparkArcLike,
  type HitSparkLineLike,
  type HitSparkSceneShim,
} from './HitSpark';
import { HIT_SPARK_LIFETIME_FRAMES, HIT_SPARK_SHARD_COUNT } from './hitSparkFormat';

/**
 * Phaser-touching component test for the hit spark pool. Uses hand-rolled
 * scene + arc + line fakes so the suite runs under plain Node without
 * booting Phaser. We assert the pool's recycling, lifetime expiry, and
 * camera-partition friendliness (default scrollFactor — never set to 0).
 */

interface FakeArc extends HitSparkArcLike {
  visible: boolean;
  radius: number;
  alpha: number;
  destroyed: boolean;
}

interface FakeLine extends HitSparkLineLike {
  visible: boolean;
  destroyed: boolean;
}

function makeArc(): FakeArc {
  const a: FakeArc = {
    visible: true,
    radius: 0,
    alpha: 0,
    destroyed: false,
    setPosition() {
      return a;
    },
    setRadius(r) {
      a.radius = r;
      return a;
    },
    setFillStyle(_c, alpha = 1) {
      a.alpha = alpha;
      return a;
    },
    setVisible(v) {
      a.visible = v;
      return a;
    },
    setDepth() {
      return a;
    },
    destroy() {
      a.destroyed = true;
    },
  };
  return a;
}

function makeLine(): FakeLine {
  const l: FakeLine = {
    visible: true,
    destroyed: false,
    setTo() {
      return l;
    },
    setPosition() {
      return l;
    },
    setStrokeStyle() {
      return l;
    },
    setVisible(v) {
      l.visible = v;
      return l;
    },
    setDepth() {
      return l;
    },
    setLineWidth() {
      return l;
    },
    destroy() {
      l.destroyed = true;
    },
  };
  return l;
}

function makeScene(): {
  scene: HitSparkSceneShim;
  arcs: FakeArc[];
  lines: FakeLine[];
} {
  const arcs: FakeArc[] = [];
  const lines: FakeLine[] = [];
  const scene: HitSparkSceneShim = {
    add: {
      circle() {
        const a = makeArc();
        arcs.push(a);
        return a;
      },
      line() {
        const l = makeLine();
        lines.push(l);
        return l;
      },
    },
  };
  return { scene, arcs, lines };
}

describe('HitSparkPool', () => {
  it('allocates one core arc + N shard lines on first spawn', () => {
    const { scene, arcs, lines } = makeScene();
    const pool = new HitSparkPool(scene);
    pool.spawn(100, 200, 12, 7, 0);
    expect(arcs).toHaveLength(1);
    expect(lines).toHaveLength(HIT_SPARK_SHARD_COUNT);
    expect(pool.liveCount()).toBe(1);
  });

  it('shows the spark immediately on spawn (no dead frame)', () => {
    const { scene, arcs } = makeScene();
    const pool = new HitSparkPool(scene);
    pool.spawn(0, 0, 20, 1, 0);
    expect(arcs[0]!.visible).toBe(true);
    expect(arcs[0]!.alpha).toBeGreaterThan(0);
  });

  it('expires the spark once its lifetime elapses', () => {
    const { scene, arcs } = makeScene();
    const pool = new HitSparkPool(scene);
    pool.spawn(0, 0, 20, 1, 0);
    pool.update(HIT_SPARK_LIFETIME_FRAMES - 1);
    expect(pool.liveCount()).toBe(1);
    pool.update(HIT_SPARK_LIFETIME_FRAMES);
    expect(pool.liveCount()).toBe(0);
    expect(arcs[0]!.visible).toBe(false);
  });

  it('recycles a freed spark instead of allocating a new one', () => {
    const { scene, arcs } = makeScene();
    const pool = new HitSparkPool(scene);
    pool.spawn(0, 0, 20, 1, 0);
    pool.update(HIT_SPARK_LIFETIME_FRAMES); // free it
    expect(pool.liveCount()).toBe(0);
    pool.spawn(0, 0, 20, 2, HIT_SPARK_LIFETIME_FRAMES);
    expect(arcs).toHaveLength(1); // reused, not re-allocated
    expect(pool.poolSize()).toBe(1);
  });

  it('caps the live pool and recycles the oldest under pressure', () => {
    const { scene } = makeScene();
    const pool = new HitSparkPool(scene, { maxLiveSparks: 2 });
    pool.spawn(0, 0, 10, 0, 0); // oldest
    pool.spawn(0, 0, 10, 1, 1);
    pool.spawn(0, 0, 10, 2, 2); // forces recycle of the frame-0 spark
    expect(pool.poolSize()).toBe(2);
    expect(pool.liveCount()).toBe(2);
  });

  it('clear() hides every live spark', () => {
    const { scene, arcs } = makeScene();
    const pool = new HitSparkPool(scene);
    pool.spawn(0, 0, 10, 0, 0);
    pool.clear();
    expect(pool.liveCount()).toBe(0);
    expect(arcs[0]!.visible).toBe(false);
  });

  it('destroy() tears down every GameObject and is idempotent', () => {
    const { scene, arcs, lines } = makeScene();
    const pool = new HitSparkPool(scene);
    pool.spawn(0, 0, 10, 0, 0);
    pool.destroy();
    expect(arcs[0]!.destroyed).toBe(true);
    expect(lines.every((l) => l.destroyed)).toBe(true);
    expect(() => pool.destroy()).not.toThrow();
    // Post-destroy spawn / update are silent no-ops.
    expect(() => pool.spawn(0, 0, 10, 0, 5)).not.toThrow();
    expect(() => pool.update(6)).not.toThrow();
  });
});
