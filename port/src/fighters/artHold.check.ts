import { describe, expect, it, vi } from 'vitest';
import { FighterArtHold } from './artHold';
import { PACKAGE_SPRITE_CAPABILITY } from './backends/packageSprite';
import type { PackageLibrary } from './packageLibrary';

/** Link and Pikachu drawn from packages, DK from legacy sheets. */
const plan = (ids: readonly string[]) => [...new Set(ids)].map(id => id === 'donkeykong'
  ? { profile: { id: 'legacy.donkeykong', revision: 'r' }, capability: 'legacy-sprite', resources: ['fighter:donkeykong'] }
  : { profile: { id: `package.${id}`, revision: 'r' }, capability: PACKAGE_SPRITE_CAPABILITY, resources: [`package:${id}`] });

function fakeLibrary() {
  const held = new Map<string, number>(), acquire = vi.fn((id: string) => {
    held.set(id, (held.get(id) ?? 0) + 1);
    let released = false;
    return { id, ready: new Promise<never>(() => undefined), release: () => {
      if (released) return;
      released = true;
      held.set(id, held.get(id)! - 1);
    } };
  });
  return { library: { acquire } as unknown as PackageLibrary, acquire, held };
}

describe('FighterArtHold', () => {
  it('holds one lease per picked package fighter, releases dropped ones and none for legacy fighters', () => {
    const { library, acquire, held } = fakeLibrary();
    const hold = new FighterArtHold(library, plan);
    hold.hold(['link', 'link', 'donkeykong']);
    expect(acquire.mock.calls.map(call => call[0])).toEqual(['link']);
    hold.hold(['link', 'pikachu']);
    hold.hold(['link', 'pikachu']);
    expect(acquire).toHaveBeenCalledTimes(2);
    hold.hold(['pikachu']);
    expect(Object.fromEntries(held)).toEqual({ link: 0, pikachu: 1 });
    hold.dispose();
    expect(Object.fromEntries(held)).toEqual({ link: 0, pikachu: 0 });
    // A render after leaving the screen holds nothing.
    hold.hold(['link']);
    expect(acquire).toHaveBeenCalledTimes(2);
  });
});
