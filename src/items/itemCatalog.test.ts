import { describe, expect, it } from 'vitest';
import { ITEM_SPAWN_TABLE, ITEM_TYPE_RNG_STREAM, enabledSpawnItems, pickSpawnItem } from './itemCatalog';
import { Rng } from '../utils/Rng';

/** universal-rules.json spawn.itemSwitchUltimate: a per-ruleset Item Switch enables/disables each item;
 * spawn weights are SOURCE_SILENT (authored: equal weights on the item-type stream). */
describe('Ultimate item switch and spawn table', () => {
  it('every item is on by default and the switch turns single items off', () => {
    expect(enabledSpawnItems(undefined).map(d => d.type)).toEqual(ITEM_SPAWN_TABLE.map(d => d.type));
    const types = ITEM_SPAWN_TABLE.map(d => d.type);
    // Stable index order (the item-type roll's index space): the Beam Sword, Ray Gun and Bob-omb took their test items'
    // slots, the Star Rod, Super Scope, Fire Flower, Banana Peel, healing items, Barrel and Capsule are appended.
    expect(types).toEqual(['homeRunBat', 'beamSword', 'hammer', 'rayGun', 'bobOmb', 'crate', 'starRod', 'superScope', 'fireFlower',
      'bananaPeel', 'goldenHammer','food','heartContainer','maximTomato','barrel','capsule']);
    expect(enabledSpawnItems({ homeRunBat: false }).map(d => d.type)).toEqual(types.filter(t => t !== 'homeRunBat'));
    expect(enabledSpawnItems({ homeRunBat: true, unknown: false }).map(d => d.type)).toEqual(types);
    expect(enabledSpawnItems(Object.fromEntries(types.map(t => [t, false])))).toEqual([]);
  });
  it('picks among the enabled items with equal weights on its own stream', () => {
    expect(ITEM_TYPE_RNG_STREAM).toBe('item-type');
    const enabled = enabledSpawnItems({ crate: false });
    const a = new Rng(7), b = new Rng(7);
    const picks = Array.from({ length: 600 }, () => pickSpawnItem(a, enabled)!.type);
    expect(picks).toEqual(Array.from({ length: 600 }, () => enabled[b.range(0, enabled.length - 1)]!.type));
    for (const def of enabled) expect(picks.filter(t => t === def.type).length).toBeGreaterThan(600 / enabled.length / 2);
    expect(picks).not.toContain('crate');
    expect(pickSpawnItem(a, [])).toBeNull();
  });
});
