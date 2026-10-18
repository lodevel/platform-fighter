import { describe, expect, it, vi } from 'vitest';
import { preloadMatchArt, prepareMatchResources } from './preloadMatchArt';
import type { SheetTexture, TextureStore } from '../engine/sprites/textureStore';
import type { StagePresenter } from '../arena/presenter';
import { registerLegacyAppearanceResources } from '../fighters/backends/legacyResources';

const catalog = vi.hoisted(() => ({ keys: Array.from({ length: 20 }, (_, i) => `char.link.test${i}`) }));
vi.mock('../../../src/assets/manifest', () => ({ getAllAssetEntries: () => catalog.keys.map(key => ({ kind: 'spritesheet', key })) }));
vi.mock('../fighters/appearance', () => ({ appearanceResourcePlan: (fighters: readonly string[]) => fighters.map(characterId => ({
  profile: { id: `legacy.${characterId}`, revision: 'test' }, capability: 'legacy-sprite', resources: [`fighter:${characterId}`],
})), packageOptIn: () => new Set(), selectPackageProfiles: () => undefined }));
registerLegacyAppearanceResources();

describe('match preload scheduling', () => {
  it('stops queued decodes/uploads as soon as one worker fails', async () => {
    const finish: Array<(value: SheetTexture) => void> = [];
    let reject!: (reason: Error) => void;
    const load = vi.fn(() => new Promise<SheetTexture>((resolve, fail) => { finish.push(resolve); reject ??= fail; }));
    const textures = { load, retainMatchFighters: vi.fn() } as unknown as TextureStore;
    const prepare = vi.fn(), progress = vi.fn();
    const pending = preloadMatchArt(textures, ['link'], progress, prepare);
    expect(load).toHaveBeenCalledTimes(6);
    reject(new Error('one decode failed'));
    await expect(pending).rejects.toThrow('one decode failed');
    for (const resolve of finish.slice(1)) resolve({} as SheetTexture);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(load).toHaveBeenCalledTimes(6);
    expect(prepare).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it('warms initial and Final startup within64MiB, without uploading the whole decoded bank', async () => {
    catalog.keys = ['char.link.run', 'char.link.final', 'char.link.final_air', 'char.link.idle'];
    const textures = { retainMatchFighters: vi.fn(), recordPreparation: vi.fn(),
      load: vi.fn(async (key: string) => ({ texture: { image: { width: key.endsWith('idle') ? 512 : 3072, height: key.endsWith('idle') ? 512 : 3072 } } }) as SheetTexture) };
    const prepare = vi.fn();
    await preloadMatchArt(textures as unknown as TextureStore, ['link'], () => undefined, prepare);
    const warmed = textures.recordPreparation.mock.calls;
    expect(warmed.map(row => row[0])).toEqual(['char.link.idle', 'char.link.final']);
    expect(warmed.reduce((n, row) => n + row[1], 0)).toBeLessThanOrEqual(64 * 1024 * 1024);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(textures.load).toHaveBeenCalledTimes(4);
  });

  it('cancels queued work without warming or evicting shared resources', async () => {
    catalog.keys = Array.from({ length: 20 }, (_, i) => `char.link.test${i}`);
    const finish: Array<(value: SheetTexture) => void> = [];
    const load = vi.fn(() => new Promise<SheetTexture>(resolve => finish.push(resolve)));
    const textures = { load, retainMatchFighters: vi.fn(), recordPreparation: vi.fn() } as unknown as TextureStore;
    const progress = vi.fn(), prepare = vi.fn(), cancel = vi.fn();
    const presenter = { sprites: { textures }, renderer: { initTexture: prepare } } as unknown as StagePresenter;
    const lease = prepareMatchResources(presenter, ['link'], progress, { prepare: async () => undefined, cancel });
    lease.dispose();
    for (const resolve of finish) resolve({} as SheetTexture);
    await lease.ready;
    expect(load).toHaveBeenCalledTimes(6);
    expect(progress.mock.calls).toEqual([[0, 20]]);
    expect(prepare).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(textures.retainMatchFighters).toHaveBeenCalledTimes(1);
  });

  it('cannot let an older match finish preparation for its replacement', async () => {
    catalog.keys = ['char.link.idle'];
    let finish!: (value: SheetTexture) => void;
    const sheet = { texture: { image: { width: 512, height: 512 } } } as SheetTexture;
    const sharedDecode = new Promise<SheetTexture>(resolve => { finish = resolve; });
    const textures = { load: vi.fn(() => sharedDecode), retainMatchFighters: vi.fn(), recordPreparation: vi.fn() } as unknown as TextureStore;
    const oldPrepare = vi.fn(), newPrepare = vi.fn(), oldProgress = vi.fn();
    const oldMatch = preloadMatchArt(textures, ['link'], oldProgress, oldPrepare);
    const newMatch = preloadMatchArt(textures, ['link'], vi.fn(), newPrepare);
    finish(sheet);
    await Promise.all([oldMatch, newMatch]);
    expect(oldPrepare).not.toHaveBeenCalled();
    expect(oldProgress.mock.calls).toEqual([[0, 1]]);
    expect(newPrepare).toHaveBeenCalledOnce();
  });
});
