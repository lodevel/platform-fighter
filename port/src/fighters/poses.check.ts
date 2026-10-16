import { describe, expect, it } from 'vitest';
import { getPikachuSheetRenderMetrics } from '../../../src/characters/pikachuPresentation';
import type { SimulationAnimationSnapshot } from '../../../src/characters/simulationSpriteAnimation';
import { fighterDrawFromArt, fighterDrawsFromArt, knockoutFlightDraw } from './poses';

const special = (kind: 'skullBash' | 'quickAttack', bodyRotation: number) =>
  ({ kind, bodyRotation }) as unknown as SimulationAnimationSnapshot['pikachuSpecial'];

/** Where the unrotated image's top-left corner lands, design px (Phaser box rule: flip keeps the box). */
function topLeft(d: NonNullable<ReturnType<typeof fighterDrawFromArt>>, w: number, h: number) {
  return { x: d.x - d.originX! * w * d.scaleX!, y: d.y - d.originY! * h * d.scaleY! };
}

describe('fighterDrawFromArt', () => {
  it.each([[1, 'quickAttack'], [-1, 'quickAttack'], [1, 'skullBash'], [-1, 'skullBash']] as const)(
    "rebases Pikachu's %s-facing %s onto the move's pivot without moving the image", (facing, kind) => {
      const f = { characterId: 'pikachu', position: { x: 900, y: 600 }, facing };
      const art = { key: 'pikachu.idle.anim', state: 'idle', frameIndex: 0, scaleX: 1, scaleY: 1, crouchClip: false, facing };
      const m = getPikachuSheetRenderMetrics('idle');
      const plain = fighterDrawFromArt(f, art, 0xffffff)!;
      const turned = fighterDrawFromArt(f, art, 0xffffff, special(kind, 1e-9))!;
      expect(turned.rotation).toBe(1e-9);
      const a = topLeft(plain, m.frameWidth, m.frameHeight), b = topLeft(turned, m.frameWidth, m.frameHeight);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y).toBeCloseTo(a.y, 6);
    });

  it('draws DK and Pikachu poses at the sheet metrics, and nothing for unknown sheets', () => {
    const f = { characterId: 'donkeykong', position: { x: 500, y: 500 }, facing: 1 as const };
    expect(fighterDrawFromArt(f, { key: 'donkeykong.idle.anim', state: 'idle', frameIndex: 2, scaleX: 1, scaleY: 1, crouchClip: false, facing: 1 }, 0xffffff))
      .toMatchObject({ key: 'char.donkeykong.idle', frame: 2, flipX: false });
    expect(fighterDrawFromArt(f, { key: 'donkeykong.nope.anim', state: 'x', frameIndex: 0, scaleX: 1, scaleY: 1, crouchClip: false, facing: 1 }, 0xffffff)).toBeNull();
  });

  it.each(['link', 'donkeykong', 'pikachu'])('draws %s shooting torso over the independently selected legs, with complementary waist cuts', characterId => {
    const lowerSheet = characterId === 'link' ? 'h10itemlegswalkf' : 'item_shoot_legs_walk_f';
    const upperSheet = characterId === 'link' ? 'h11itemshootupper' : 'item_lgun_shoot_upper';
    const f = { characterId, position: { x: 500, y: 500 }, facing: 1 as const };
    const layers = fighterDrawsFromArt(f, { key: `${characterId}.${lowerSheet}.anim`, state: 'shoot', frameIndex: 0,
      scaleX: 1, scaleY: 1, crouchClip: false, facing: 1, overlay: { key: `${characterId}.${upperSheet}.anim`, frameIndex: 0 } }, 0xffffff);
    expect(layers).toHaveLength(2);
    expect(layers[0]!.clipRows?.top).toBeGreaterThan(0);
    expect(layers[1]!.clipRows?.bottom).toBeGreaterThan(0);
    expect(layers[1]!.depth).toBeGreaterThan(layers[0]!.depth ?? 0);
  });

  it.each(['link', 'donkeykong', 'pikachu'] as const)('keeps %s actual tumble art at the accepted KO source ROOT', characterId => {
    const draw = knockoutFlightDraw({ playerIndex: 0, characterId, paletteIndex: 0, sourceRoot: { x: 700, y: 400 },
      facing: -1, age: 20, duration: 100, scale: .6, rotation: 2.3, alpha: .8 }, 0xffffff)!;
    expect(draw).not.toBeNull();
    expect(draw.key).toBe(characterId === 'link' ? 'char.link.f01damageflyn' : `char.${characterId}.tumble`);
    expect(draw).toMatchObject({ x: 700, y: 400, flipX: true, rotation: 2.3, alpha: .8 });
    expect(draw.scaleX).toBeCloseTo(.4666667 * .6);
  });
});
