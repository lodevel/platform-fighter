import { HIT_SPARK_LIFETIME_FRAMES, computeHitSparkVisual } from '../../../../src/fx/hitSparkFormat';
import type { ShapeLayer } from '../../engine/shapes/shapeLayer';
import type { SimEvent } from '../../../../src/sim/view';

interface Spark { readonly x: number; readonly y: number; readonly damage: number; readonly seed: number; readonly born: number }

/**
 * Hit sparks, as the game's `computeHitSparkVisual` describes them: a core
 * flash and radial shards, aged by simulation frames. The same cap as the
 * game's pool (24 live; a new spark replaces the oldest).
 */
export class HitSparks {
  private sparks: Spark[] = [];

  constructor(private readonly maxLive = 24) {}

  add(events: ReadonlyArray<SimEvent>, frame: number): void {
    for (const e of events) {
      if (e.kind !== 'hit') continue;
      this.sparks.push({ x: e.x, y: e.y, damage: e.damage, seed: e.seed, born: e.frame ?? frame });
      if (this.sparks.length > this.maxLive) this.sparks.shift();
    }
  }

  draw(shapes: ShapeLayer, frame: number): void {
    this.sparks = this.sparks.filter((s) => frame - s.born < HIT_SPARK_LIFETIME_FRAMES && frame >= s.born);
    for (const s of this.sparks) {
      const v = computeHitSparkVisual({ damage: s.damage, age: frame - s.born, seed: s.seed });
      if (!v.alive) continue;
      for (const sh of v.shards) {
        shapes.line({ x1: s.x + sh.innerX, y1: s.y + sh.innerY, x2: s.x + sh.outerX, y2: s.y + sh.outerY, width: sh.width, color: sh.color, alpha: sh.alpha });
      }
      shapes.circle({ x: s.x, y: s.y, radius: v.core.radius, fill: v.core.color, fillAlpha: v.core.alpha });
    }
  }
}
