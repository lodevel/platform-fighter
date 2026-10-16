import { describe, expect, it } from 'vitest';
import { HOME_RUN_BAT_DEFINITION } from './HomeRunBat';
import { BANANA_PEEL_DEFINITION } from './BananaPeel';
import { HAMMER_DEFINITION } from './Hammer';
import { RAY_GUN_DEFINITION } from './RayGun';
import { BEAM_SWORD_DEFINITION } from './BeamSword';
import { STAR_ROD_DEFINITION } from './StarRod';
import { SUPER_SCOPE_DEFINITION } from './SuperScope';
import { FIRE_FLOWER_DEFINITION } from './FireFlower';
import { ItemEntity } from './ItemEntity';
import { ItemRegistry } from './ItemRegistry';

describe('longer pickup availability', () => {
  it.each([
    [HOME_RUN_BAT_DEFINITION, 600], [BANANA_PEEL_DEFINITION, 600], [HAMMER_DEFINITION, 480],
    [RAY_GUN_DEFINITION, 600], [BEAM_SWORD_DEFINITION, 600], [STAR_ROD_DEFINITION, 600],
    [SUPER_SCOPE_DEFINITION, 600], [FIRE_FLOWER_DEFINITION, 600],
  ] as const)('%s remains pickable for twice its former ground lifetime', (definition, formerLifetime) => {
    const registry = new ItemRegistry();
    const item = registry.spawn(definition, { x: 0, y: 0 }, 0, ItemEntity);
    item.markGrounded(50, { x: 0, y: 0 });
    registry.tick(50 + formerLifetime);
    expect(item.isPickable()).toBe(true);
    registry.tick(50 + 2 * formerLifetime - 1);
    expect(item.isPickable()).toBe(true);
    registry.tick(50 + 2 * formerLifetime);
    expect(item.isDespawned()).toBe(true);

    const carried = registry.spawn(definition, { x: 0, y: 0 }, 0, ItemEntity);
    carried.markGrounded(50, { x: 0, y: 0 });
    carried.markHeld(50 + formerLifetime, 0, { x: 0, y: 0 });
    registry.tick(10000);
    expect(carried.isHeld()).toBe(true);
    carried.markDropped(10000, { x: 0, y: 0 });
    registry.tick(10000 + 2 * formerLifetime - 1);
    expect(carried.isPickable()).toBe(true);
    registry.tick(10000 + 2 * formerLifetime);
    expect(carried.isDespawned()).toBe(true);
  });
});
