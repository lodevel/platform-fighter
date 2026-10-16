import * as THREE from 'three';
import type { StageLayout } from '../../../src/types';
import type { StageClock, ThemeHooks } from './contract';
import type { StageHazards } from './hazards';
import { createLavaPools } from './hazards/lavaPools';
import { createWindZones } from './hazards/windZones';
import { createPlatforms, groundExtent, type PlatformSnapshot } from './platforms';
import { themeFor } from './themes';

export interface StageView {
  readonly scene: THREE.Scene;
  readonly theme: ThemeHooks;
  /** Exact collision outlines of every platform and hazard (debug / acceptance). */
  readonly overlay: THREE.Group;
  update(clock: Omit<StageClock, 'wind'>): void;
  setPlatforms(state: readonly PlatformSnapshot[] | null): void;
}

/**
 * The 3D stage for a layout: the theme's scenery plus every gameplay surface
 * and hazard, each drawn from simulation data (layout, moving-platform path,
 * live hazard entities).
 */
export function createStageView(layout: StageLayout, hazards: StageHazards): StageView {
  const scene = new THREE.Scene();
  const theme = themeFor(layout)({ scene, ...groundExtent(layout) });
  const platforms = createPlatforms(scene, theme, layout);
  const lava = createLavaPools(theme, hazards.lava);
  const wind = createWindZones(hazards.wind);
  scene.add(wind.group);
  const overlay = new THREE.Group();
  overlay.visible = false;
  overlay.add(platforms.outlines, lava.outlines, wind.outlines);
  scene.add(overlay);

  return {
    scene, theme, overlay,
    setPlatforms: (state) => platforms.setSnapshots(state),
    update(base) {
      const clock: StageClock = { ...base, wind: wind.update(base.dt) };
      platforms.update(clock.frame);
      lava.update(clock);
      if (hazards.gaze) theme.gaze?.(hazards.gaze.getPhase(), clock);
      theme.update(clock);
    },
  };
}
