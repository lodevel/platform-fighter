import * as THREE from 'three';
import type { LavaHazard } from '../../../../src/entities/LavaHazard';
import { toWorldLength, toWorldX, toWorldY } from '../../engine/space';
import type { StageClock, ThemeHooks } from '../contract';
import { outlineRect } from '../outline';

/** Lava pools drawn by the theme, sized every frame from the live LavaHazard entities. */
export function createLavaPools(theme: ThemeHooks, lava: ReadonlyArray<LavaHazard>) {
  const outlines = new THREE.Group();
  if (lava.length && !theme.lavaPool) throw new Error('A lava stage needs a theme that draws lava pools.');
  const pools = lava.map((hazard) => {
    const visual = theme.lavaPool!({
      x: toWorldX(hazard.getX()),
      base: toWorldY(hazard.getBaseY()),
      width: toWorldLength(hazard.getWidth()),
      maxHeight: toWorldLength(hazard.getMaxHeight()),
    });
    const outline = outlineRect(toWorldLength(hazard.getWidth()), 1, 0xffe14a);
    outlines.add(outline);
    return { hazard, visual, outline };
  });
  return {
    outlines,
    update(clock: StageClock) {
      pools.forEach(({ hazard, visual, outline }) => {
        const height = toWorldLength(hazard.getCurrentHeight());
        visual.update(height, hazard.getHeightNorm(), hazard.isActive(), clock);
        outline.position.set(toWorldX(hazard.getX()), toWorldY(hazard.getSurfaceY()), 0);
        outline.scale.y = Math.max(height, 0.01);
        outline.material.color.setHex(hazard.isActive() ? 0xff4a2e : 0xffe14a);
      });
    },
  };
}
