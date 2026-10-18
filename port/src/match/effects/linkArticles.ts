import { remoteBombShapes, swordBeamShapes, type LinkArticleShape } from '../../../../src/fx/proceduralLinkArticles';
import { LINK_ARTICLE_SHEETS } from '../../../../src/match/linkArticles';
import { getPackedBodyRenderMetrics } from '../../../../src/characters/packedBodyPresentation';
import type { ItemView, ProjectileView } from '../../../../src/sim/view';
import type { ShapeLayer } from '../../engine/shapes/shapeLayer';
import type { EffectSprite } from './packageEffects';

function drawShapes(layer: ShapeLayer, shapes: readonly LinkArticleShape[], x: number, y: number, angle = 0): void {
  const at = (px: number, py: number) => ({ x: x + px * Math.cos(angle) - py * Math.sin(angle), y: y + px * Math.sin(angle) + py * Math.cos(angle) });
  for (const shape of shapes) {
    if (shape.kind === 'circle') layer.circle({ ...at(shape.x, shape.y), radius: shape.radius, fill: shape.fill,
      fillAlpha: shape.alpha, stroke: shape.stroke, strokeWidth: shape.strokeWidth });
    else if (shape.kind === 'line') {
      const a = at(shape.x1, shape.y1), b = at(shape.x2, shape.y2);
      layer.line({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: shape.width, color: shape.fill, alpha: shape.alpha });
    } else {
      const a = at(shape.x - shape.width / 2, shape.y), b = at(shape.x + shape.width / 2, shape.y);
      layer.line({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: shape.height, color: shape.fill, alpha: shape.alpha });
    }
  }
}

export function drawRemoteBomb(layer: ShapeLayer, item: ItemView): boolean {
  if (item.generatedKind !== 'link-remote-bomb' && item.type !== 'linkRemoteBomb') return false;
  const root = item.rootPosition ?? { x: item.position.x, y: item.position.y + 10 };
  drawShapes(layer, remoteBombShapes(), root.x, root.y, item.angle);
  return true;
}

export function drawProjectile(layer: ShapeLayer, projectile: ProjectileView, frame: number): void {
  const p = projectile, kind = p.visualRecipe?.kind;
  if (kind === 'link-arrow' || kind === 'link-boomerang') return;
  if (kind === 'sword-beam') {
    drawShapes(layer, swordBeamShapes(p.w, p.h, p.visualFacing ?? p.facing, frame), p.x, p.y, p.angle ?? 0);
    return;
  }
  const visual = p.visualRecipe?.kind === 'item-shot' ? p.visualRecipe.visual : null;
  if (visual === 'star') {
    layer.star({ x: p.x, y: p.y, width: p.w, height: p.h, phase: frame * .1 + p.id * .73 });
    return;
  }
  if (visual === 'flame') {
    layer.flame({ x: p.x, y: p.y, width: p.w, height: p.h, facing: p.visualFacing ?? p.facing, phase: frame * .55 + p.id * 1.71 });
    return;
  }
  const color = visual === 'laser' ? 0xff5bdb : visual === 'scope' ? 0x65d9ff : 0xffe066;
  layer.line({ x1: p.x - p.w / 2, y1: p.y, x2: p.x + p.w / 2, y2: p.y, width: p.h, color, alpha: .8 });
  layer.line({ x1: p.x - p.w * .35, y1: p.y, x2: p.x + p.w * .35, y2: p.y, width: p.h * .36, color: 0xf5ffff });
}

export function projectileSprite(p: ProjectileView): EffectSprite | null {
  const kind = p.visualRecipe?.kind;
  if (kind !== 'link-arrow' && kind !== 'link-boomerang') return null;
  const sheet = LINK_ARTICLE_SHEETS[kind], metrics = getPackedBodyRenderMetrics('link', sheet);
  if (!metrics) return null;
  const facing = p.visualFacing ?? p.facing;
  const position = p.artPosition ?? p;
  return { key: `char.link.${sheet}`, frame: p.artFrame ?? 0, x: position.x, y: position.y,
    originX: facing === -1 ? 1 - metrics.originX : metrics.originX, originY: metrics.originY,
    scaleX: metrics.scaleToWorld, scaleY: metrics.scaleToWorld, flipX: facing === -1, rotation: p.angle ?? 0, depth: 10,
    ...(p.art ? { art: p.art } : {}) };
}
