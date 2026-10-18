import { evaluate } from '../../../../character/evaluator/evaluate';
import type { EffectArtView } from '../../../../src/sim/view';
import { facingOriginX, type SpriteDraw } from '../../engine/sprites/spriteLayer';
import type { LoadedPackage } from '../../fighters/packageLibrary';

/**
 * For each fighter: undefined when it is drawn from legacy sheets, else its resident package
 * (null while it is not loaded).
 */
export type EffectPackages = (characterId: string) => LoadedPackage | null | undefined;

/** An effect sprite from the legacy selection, with the same art as a package effect action. */
export type EffectSprite = SpriteDraw & { readonly art?: EffectArtView };

/**
 * The effect as drawn: the legacy sprite when its fighter is drawn from legacy sheets, else the
 * package drawing of `art` at the same place, rotation, depth and alpha, in costume 0 and without
 * tint as the legacy effect sheets are drawn. Null when the package shows nothing.
 */
export function effectDraw(sprite: EffectSprite, packages: EffectPackages): SpriteDraw | null {
  const art = sprite.art, loaded = art ? packages(art.characterId) : undefined;
  if (!art || loaded === undefined) return sprite;
  if (!loaded?.pkg.actions[art.action]) return null;
  const pose = evaluate(loaded.pkg, art), drawing = pose.drawing === null ? undefined : loaded.pkg.drawings[pose.drawing];
  const page = drawing && loaded.pages.get(drawing.page);
  if (!drawing || !page) return null;
  const { frame: _legacyFrame, ...placed } = sprite, [, , w, h] = drawing.rect, [ax, ay] = drawing.anchor;
  return { ...placed, key: `package.${loaded.pkg.id}.${pose.drawing}`,
    originX: facingOriginX(ax / w, art.facing), originY: ay / h, flipX: art.facing === -1,
    scaleX: drawing.scale * (art.scaleX ?? 1), scaleY: drawing.scale * (art.scaleY ?? 1),
    indexed: { page, rect: drawing.rect, palette: loaded.palette, paletteRow: 0 } };
}
