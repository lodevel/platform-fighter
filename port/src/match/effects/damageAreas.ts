import type { ShapeLayer } from '../../engine/shapes/shapeLayer';
import type { ExplosionView, ProjectileView } from '../../../../src/sim/view';

/**
 * Explosions and projectiles at their real damage areas (add-spawned-object
 * rule: what hurts is visible): a blast is a disc of its true radius with a
 * bright rim, a projectile its true hit box. Drawn as additive light.
 */
export function drawDamageAreas(glow: ShapeLayer, explosions: ReadonlyArray<ExplosionView>, projectiles: ReadonlyArray<ProjectileView>): void {
  for (const e of explosions) {
    const fade = 1 - e.progress;
    if (e.visualRecipe === 'ancient-arrow') {
      // Authored Ancient Arrow light, timed from the actual article. The
      // expanding rim reaches its true damage radius, leaving the victim
      // readable instead of covering the body with an opaque orange disc.
      if (e.phase === 'fly') {
        const facing = e.facing ?? 1;
        glow.line({ x1: e.x - facing * e.radius * 3, y1: e.y, x2: e.x, y2: e.y,
          width: Math.max(2, e.radius * .55), color: 0x63eaff, alpha: .45 });
        glow.circle({ x: e.x, y: e.y, radius: e.radius, fill: 0x83eeff, fillAlpha: .28, stroke: 0xffe5a2, strokeWidth: 1.5 });
      } else {
        const radius = e.radius * (.55 + .45 * Math.min(1, e.progress * 5));
        glow.circle({ x: e.x, y: e.y, radius, fill: 0x369dce, fillAlpha: .11 * fade,
          stroke: 0x9df4ff, strokeAlpha: .9 * fade, strokeWidth: Math.max(2, e.radius * .025) });
        glow.circle({ x: e.x, y: e.y, radius: radius * .81, stroke: 0xffda82, strokeAlpha: .7 * fade,
          strokeWidth: Math.max(1.4, e.radius * .012) });
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI * i / 3 + e.progress * .7;
          const inner = radius * .88, outer = radius * 1.035;
          glow.line({ x1: e.x + Math.cos(angle) * inner, y1: e.y + Math.sin(angle) * inner,
            x2: e.x + Math.cos(angle) * outer, y2: e.y + Math.sin(angle) * outer,
            width: 2, color: 0xffe7aa, alpha: fade });
        }
      }
      continue;
    }
    glow.circle({ x: e.x, y: e.y, radius: e.radius * (0.6 + 0.4 * Math.min(1, e.progress * 4)), fill: 0xff7a1a, fillAlpha: 0.55 * fade });
    glow.circle({ x: e.x, y: e.y, radius: e.radius, stroke: 0xfff0b0, strokeAlpha: 0.9 * fade, strokeWidth: e.radius * 0.1 });
  }
  for (const p of projectiles) glow.rect({ x: p.x, y: p.y, width: p.w, height: p.h, color: 0xffe066 });
}
