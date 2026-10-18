import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { DonkeyKong } from './DonkeyKong';
import { itemPhysicsFixture } from '../items/itemPhysicsFixture';
import { HOME_RUN_BAT_DEFINITION } from '../items/HomeRunBat';
import { captureSimulationAnimation } from './simulationSpriteAnimation';
import { createArtFrameSelector, MANIFEST_ART_CATALOG } from './artFrameSelector';
import { fighterDrawFromArt } from '../../port/src/fighters/poses';
import metadata from '../../assets/characters/donkeykong/gameplay.json';
import { legacySheet } from '../assets/legacyFighterSheets';
import review from '../../docs/review/2026-10-16/donkeykong-ground-support/support-registration.json';

const sheet = legacySheet('donkeykong', 'down_wait_face_down')!, clip = { ...sheet, trims: sheet.trims!, root: sheet.root!, scaleToWorld: sheet.scaleToWorld! }, poses = metadata.animations.down_wait_face_down;
const bytes = readFileSync('assets/characters/donkeykong/' + clip.strip);
const atlas = PNG.sync.read(bytes);
const contact = (frame: number) => {
  const row = review.rows[frame]!;
  const [x, y, width, height] = row.atlasContactRegion as [number, number, number, number];
  let point: { x: number; y: number } | null = null;
  for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++)
    if (atlas.data[(py * atlas.width + px) * 4 + 3]! >= review.alphaCutoff) point = { x: px, y: py };
  if (!point) throw new Error('Reviewed anatomical support is empty');
  const [tx, ty, , , dx, dy] = clip.trims[frame]! as [number, number, number, number, number, number];
  return { x: point.x - tx + dx + .5, y: point.y - ty + dy + .5 };
};

describe('DK face-down anatomical ground support', () => {
  it('registers every reviewed hand contact at the physics root without changing atlas pixels or source clocks', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(review.atlasSha256);
    expect(poses.nativeSampleIndices).toEqual(review.originalClip.nativeSampleIndices);
    expect(poses.loopDuration).toBe(review.originalClip.loopDuration);
    expect(poses.bodyCentreFromRootY).toBe(-42);
    for (let frame = 0; frame < clip.frameCount; frame++) {
      expect(Math.abs((contact(frame).y - clip.root[1]!) * clip.scaleToWorld), `frame ${frame} anatomical support gap`)
        .toBeLessThanOrEqual(review.worldTolerance);
      expect(clip.trims[frame]!.slice(0, 5)).toEqual(review.originalClip.trims[frame]!.slice(0, 5));
      expect(clip.trims[frame]![5]! + clip.trims[frame]![3]!).toBeLessThanOrEqual(clip.frameHeight);
    }
  });

  it.each([1, -1] as const)('plants the selected prone hand on the actual finite floor after a launch, facing %s', facing => {
    const f = itemPhysicsFixture(DonkeyKong, HOME_RUN_BAT_DEFINITION);
    f.inventory.detachWithoutDrop(); f.actor.setFacing(facing);
    f.actor.applyHit({ damage: 18.9, knockback: { x: 12, y: -10, scaling: 0 },
      facing, minHitstunFrames: 45, hitlagMultiplier: 0 });
    const selector = createArtFrameSelector(MANIFEST_ART_CATALOG);
    let airborne = false;
    const frames = new Set<number>();
    for (let tick = 0; tick < 420; tick++) {
      f.step();
      const snapshot = captureSimulationAnimation(f.actor, tick, false);
      const art = selector.select(snapshot);
      airborne ||= !f.actor.isGrounded();
      if (art?.key !== 'donkeykong.down_wait_face_down.anim') continue;
      expect(f.actor.isGrounded()).toBe(true);
      const draw = fighterDrawFromArt({ characterId: 'donkeykong', position: f.actor.getPosition(), facing }, art, 0xffffff)!;
      const p = contact(art.frameIndex);
      const worldY = draw.y + (p.y - draw.originY! * clip.frameHeight) * draw.scaleY!;
      const worldX = draw.x + (p.x - clip.root[0]!) * draw.scaleX! * (draw.flipX ? -1 : 1);
      expect(worldX).toBeGreaterThan(f.floor.bounds.min.x);
      expect(worldX).toBeLessThan(f.floor.bounds.max.x);
      expect(Math.abs(worldY - f.floor.bounds.min.y), `frame ${art.frameIndex} post-physics hand/floor gap`)
        .toBeLessThanOrEqual(review.worldTolerance);
      frames.add(art.frameIndex);
    }
    expect(airborne).toBe(true);
    expect(frames.size).toBeGreaterThanOrEqual(9);
  });

});
