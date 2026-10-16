import { ASSET_KEYS } from '../../../../src/assets/manifest';
import type { ShapeLayer } from '../../engine/shapes/shapeLayer';
import type { SpriteLayer } from '../../engine/sprites/spriteLayer';
import type { SimEvent } from '../../../../src/sim/view';

/**
 * Explosion art as MatchScene's `spawnExplosionArt` draws it, kept inside
 * the blast radius: an additive 3-frame burst sprite (flash → fireball →
 * smoke, 18 frames, compounding growth), 12 radial embers under gravity and
 * 5 rising smoke puffs. Every value is a pure function of the blast's age in
 * simulation frames, so a rewind redraws it exactly.
 *
 * Supersedes MatchScene's spawnExplosionArt / tickExplosionParticles /
 * explosionBursts, which go with Phaser in step 9.
 */
interface Particle { x: number; y: number; r: number; vx: number; vy: number; gravity: number; drag: number; growth: number; lifetime: number; peakAlpha: number; color: number }
interface Blast { readonly x: number; readonly y: number; readonly radius: number; readonly born: number }

const BURST_FRAMES = 18, SHEET_FRAME_PX = 96;

function particles(x: number, y: number, radius: number): Particle[] {
  const size = radius * 2, out: Particle[] = [];
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + (i % 3) * 0.45, spd = radius * (0.06 + 0.02 * (i % 4));
    out.push({ x, y, r: Math.max(2, size * 0.05), vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - size * 0.04,
      gravity: size * 0.02, drag: 0.9, growth: -0.12, lifetime: 16 + (i % 6), peakAlpha: 1, color: i % 2 === 0 ? 0xffd84a : 0xff7a28 });
  }
  for (let i = 0; i < 5; i++) {
    const dx = (i - 2) * size * 0.13;
    out.push({ x: x + dx, y: y - size * 0.08, r: size * 0.13, vx: dx * 0.05, vy: -size * 0.045,
      gravity: 0, drag: 0.97, growth: size * 0.028, lifetime: 26 + i * 2, peakAlpha: 0.5, color: 0x53535e });
  }
  return out;
}

export class ExplosionArt {
  private blasts: Blast[] = [];

  add(events: ReadonlyArray<SimEvent>, frame: number): void {
    for (const e of events) if (e.kind === 'explosion') this.blasts.push({ x: e.x, y: e.y, radius: e.radius, born: e.frame ?? frame });
  }

  /** Smoke and embers into `shapes`; the burst into `overlay` (drawn above them, like depth 7 over 5-6). */
  draw(shapes: ShapeLayer, overlay: SpriteLayer, frame: number): void {
    this.blasts = this.blasts.filter((b) => frame >= b.born && frame - b.born < 40);
    for (const b of this.blasts) {
      const age = frame - b.born;
      // Smoke first, then embers (Phaser depths 5, 6).
      const ps = particles(b.x, b.y, b.radius);
      for (const p of [...ps.slice(12), ...ps.slice(0, 12)]) {
        let alpha = 1, alive = true;
        for (let t = 1; t <= age && alive; t++) {
          p.vx *= p.drag;
          p.vy = p.vy * p.drag + p.gravity;
          p.x += p.vx;
          p.y += p.vy;
          p.r = Math.max(0.5, p.r + p.growth);
          const left = p.lifetime - t;
          alpha = Math.max(0, left / p.lifetime) * p.peakAlpha;
          alive = left > 0;
        }
        if (alive) shapes.circle({ x: p.x, y: p.y, radius: p.r, fill: p.color, fillAlpha: alpha });
      }
      if (age < BURST_FRAMES) {
        let scale = (b.radius * 2) / SHEET_FRAME_PX;
        for (let e = 0; e <= age; e++) scale *= 1 + 0.04 * ((e % 6) / 6);
        const frameIndex = Math.min(2, Math.floor(age / 6)), phase = (age % 6) / 6;
        overlay.draw({
          key: ASSET_KEYS.itemExplosion, frame: frameIndex, x: b.x, y: b.y, scaleX: scale, scaleY: scale,
          alpha: frameIndex === 2 ? Math.max(0, 1 - phase) : 1, blend: 'add',
        });
      }
    }
  }
}
