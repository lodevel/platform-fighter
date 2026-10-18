import anchors from './linkFinalAnchors.json';
import type { FighterView, SimView, ExplosionView } from '../../../../src/sim/view';
import { getPackedBodyRenderMetrics } from '../../../../src/characters/packedBodyPresentation';
import { effectAction } from '../../../../src/characters/actionDisplay';
import type { EffectSprite } from './packageEffects';
import type { ShapeLayer } from '../../engine/shapes/shapeLayer';

type Point = { readonly x: number; readonly y: number };
export interface LinkFinalCharge {
  readonly actor: number; readonly runId: number; readonly age: number;
  readonly nock: Point; readonly bow: Point; readonly tip: Point;
  readonly strength: number; readonly release: boolean;
  readonly sprite: EffectSprite | null;
}
export interface LinkFinalTrail { readonly id: number; readonly from: Point; readonly to: Point; }

/** Native hand projections follow exactly the same retained sample intervals as
 * the body. The arrow fit between hands is authored; common article parenting
 * has not been recovered. This visual data never supplies combat geometry. */
export function linkFinalCharge(fighter: FighterView): LinkFinalCharge | null {
  const control = fighter.animation.finalSmash;
  if (fighter.characterId !== 'link' || fighter.eliminated || control?.role !== 'owner'
    || (control.sheet !== 'final' && control.sheet !== 'final_air') || control.age < 0 || control.age >= 63) return null;
  const clip = anchors.clips[control.sheet === 'final_air' ? 'd04finalair' : 'd04final'];
  const age = control.age < 60 ? control.age : 58; // Keep the drawn bow point while the release hand moves away.
  let index = 0;
  while (index + 1 < clip.length && clip[index + 1]!.age <= age) index++;
  const sample = clip[index]!, facing = control.facing;
  const at = (p: Point): Point => ({ x: fighter.position.x + p.x * facing, y: fighter.position.y + p.y });
  const nock = at(sample.nock), bow = at(sample.bow);
  const dx = bow.x - nock.x, dy = bow.y - nock.y, distance = Math.hypot(dx, dy);
  const ux = distance > .01 ? dx / distance : facing, uy = distance > .01 ? dy / distance : 0;
  // Projected hand separation controls foreshortening during the draw. Full
  // extension uses the existing native arrow's ~93-world-pixel silhouette.
  const extension = Math.min(1, Math.max(.28, distance / 44));
  const metrics = getPackedBodyRenderMetrics('link', 'fx__link_ancientbowarrow');
  const scale = metrics?.scaleToWorld ?? .4666667;
  const rootDistance = 145 * scale * extension;
  const root = { x: nock.x + ux * rootDistance, y: nock.y + uy * rootDistance };
  const tip = { x: nock.x + ux * 196 * scale * extension, y: nock.y + uy * 196 * scale * extension };
  const release = control.age >= 60;
  const sprite: EffectSprite | null = !release && metrics ? {
    key: 'char.link.fx__link_ancientbowarrow', frame: 0, ...root,
    originX: facing < 0 ? 1 - metrics.originX : metrics.originX, originY: metrics.originY,
    scaleX: scale * extension, scaleY: scale, flipX: facing < 0,
    rotation: Math.atan2(dy * facing, dx * facing), depth: 11,
    art: { characterId: 'link', action: effectAction('fx__link_ancientbowarrow'), tick: 0, facing, scaleX: extension },
  } : null;
  return { actor: fighter.playerIndex, runId: control.runId, age: control.age,
    nock, bow, tip, release, strength: release ? (63 - control.age) / 3 : control.age < 35 ? .35 + control.age / 100 : 1,
    sprite };
}

/** Only render snapshots are retained. Same-frame redraws preserve the selected
 * segment; rewinds, a different owner/run, or an absent article clear history. */
export class LinkFinalPresentation {
  private frame = -1;
  private owner = '';
  private fingerprint = '';
  private previous = new Map<number, ExplosionView>();
  private trails: LinkFinalTrail[] = [];
  charges: readonly LinkFinalCharge[] = [];
  sprites: readonly EffectSprite[] = [];

  update(view: SimView): readonly LinkFinalTrail[] {
    const owner = view.fighters.filter(f => f.characterId === 'link' && f.animation.finalSmash?.role === 'owner')
      .map(f => `${f.playerIndex}:${f.animation.finalSmash!.runId}`).join(',');
    const arrows = view.explosions.filter(e => e.visualRecipe === 'ancient-arrow');
    const fingerprint = JSON.stringify(arrows.map(e => [e.id, e.x, e.y, e.phase]));
    const sameFrame = view.frame === this.frame && owner === this.owner && fingerprint === this.fingerprint;
    this.charges = view.fighters.flatMap(f => { const charge = linkFinalCharge(f); return charge ? [charge] : []; });
    this.sprites = this.charges.flatMap(c => c.sprite ? [c.sprite] : []);
    if (sameFrame) return this.trails;
    if (view.frame <= this.frame || owner !== this.owner) this.previous.clear();
    this.trails = arrows.flatMap(arrow => {
      const prior = this.previous.get(arrow.id);
      return prior?.phase === 'fly' && (prior.x !== arrow.x || prior.y !== arrow.y)
        ? [{ id: arrow.id, from: { x: prior.x, y: prior.y }, to: { x: arrow.x, y: arrow.y } }] : [];
    });
    this.previous = new Map(arrows.map(a => [a.id, a]));
    this.frame = view.frame; this.owner = owner; this.fingerprint = fingerprint;
    return this.trails;
  }

  draw(glow: ShapeLayer, view: SimView): void {
    for (const trail of this.update(view)) {
      glow.line({ x1: trail.from.x, y1: trail.from.y, x2: trail.to.x, y2: trail.to.y, width: 18, color: 0x35bdff, alpha: .22 });
      glow.line({ x1: trail.from.x, y1: trail.from.y, x2: trail.to.x, y2: trail.to.y, width: 7, color: 0x74eaff, alpha: .7 });
      glow.line({ x1: trail.from.x, y1: trail.from.y, x2: trail.to.x, y2: trail.to.y, width: 2.4, color: 0xf2ffff, alpha: .95 });
    }
    for (const cue of this.charges) {
      const strength = cue.strength, point = cue.release ? cue.bow : cue.tip;
      // Have supplies flare/hold at article0/35. Owner0/35 mapping is
      // authored pending common status parenting; Final shoot60/detach63
      // are pinned owner events.
      // Radii/colors/rays are authored light, not native damage dimensions.
      const radius = cue.release ? 25 + (cue.age - 60) * 9 : 10 + strength * 12;
      glow.circle({ ...point, radius: radius * 1.6, fill: 0x27b8ff, fillAlpha: .12 * strength });
      glow.circle({ ...point, radius, fill: 0x52dfff, fillAlpha: .22 * strength, stroke: 0x8af4ff, strokeWidth: 1.8, strokeAlpha: .7 * strength });
      glow.circle({ ...point, radius: 3 + strength * 3, fill: 0xeaffff, fillAlpha: strength });
      for (let i = 0; i < 4; i++) {
        const angle = Math.PI / 2 * i + cue.age * .08, inner = radius * .65, outer = radius * 1.45;
        glow.line({ x1: point.x + Math.cos(angle) * inner, y1: point.y + Math.sin(angle) * inner,
          x2: point.x + Math.cos(angle) * outer, y2: point.y + Math.sin(angle) * outer,
          width: 1.6, color: 0xffe8a3, alpha: strength * .8 });
      }
      if (!cue.release) glow.line({ x1: cue.nock.x, y1: cue.nock.y, x2: cue.tip.x, y2: cue.tip.y,
        width: 2.3, color: 0x9ef5ff, alpha: .4 * strength });
    }
  }
}
