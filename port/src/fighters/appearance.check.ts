import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createLegacyPreviewAppearanceRequest, createLegacySnapshotAppearanceRequest } from '../../../src/characterPresentation/legacy/bridge';
import { createPresentationRegistry } from '../../../src/characterPresentation/registry';
import { createArtFrameSelector, MANIFEST_ART_CATALOG } from '../../../src/characters/artFrameSelector';
import { MatchSim } from '../../../src/sim/MatchSim';
import { SpriteLayer, type SpriteDraw } from '../engine/sprites/spriteLayer';
import type { SheetTexture, TextureStore } from '../engine/sprites/textureStore';
import { geometryPreparationHost, presentationTarget } from '../engine/presentation/submission';
import { toWorldX, toWorldY } from '../engine/space';
import { AppearanceCollection, AppearanceSystem, characterAppearances } from './appearance';
import { createComputedFixtureSystem, COMPUTED_FIXTURE_PROFILE, ComputedFixtureAppearance } from './backends/computedFixture';
import { fighterDraw, fighterDrawsFromArt } from './poses';

const sheet: SheetTexture = { texture: new THREE.Texture(), width: 128, height: 128, frameWidth: 128, frameHeight: 128,
  margin: 0, spacing: 0, columns: 1, frameCount: 1 };
const request = (phase: string, age = 0, facing: 1 | -1 = 1, extra: Partial<Parameters<typeof createLegacyPreviewAppearanceRequest>[0]> = {}) =>
  createLegacyPreviewAppearanceRequest({ actorId: 'fixture', characterId: 'link', profile: COMPUTED_FIXTURE_PROFILE, action: 'idle', phase,
    age, position: { x: 900, y: 650 }, facing, attachments: [{ id: 'hand', space: 'root', position: { x: 28, y: -44 } }], ...extra });
function host() {
  const layer = new SpriteLayer({ get: () => sheet, resident: () => sheet } as unknown as TextureStore);
  const compile = vi.fn(), getUniforms = vi.fn();
  const renderer = { compile, domElement: new EventTarget(), info: { programs: [{ program: {}, getUniforms }] },
    getContext: () => ({ LINK_STATUS: 1, isContextLost: () => false, getExtension: () => null, getProgramParameter: () => true }) } as unknown as THREE.WebGLRenderer;
  return { layer, target: presentationTarget(layer), preparation: geometryPreparationHost(renderer, layer.scene, new THREE.Camera()), compile };
}

describe('appearance capability boundary', () => {
  it.each(['donkeykong', 'pikachu', 'link'])('keeps %s root poses, facing, palette and age identical through the shared UI facade', characterId => {
    const collection = new AppearanceCollection();
    for (const facing of [-1, 1] as const) for (const age of [0, 1, 12, 41, 120]) {
      const f = { characterId, x: 700, y: 500, facing, paletteIndex: 2, zoom: .6, depth: 3 };
      const submission = collection.pose('preview', f, 'idle', age, 0xeeeedd), draws: SpriteDraw[] = [];
      submission.submit({ sprite: draw => draws.push(draw), geometry: () => { throw new Error('Unexpected geometry'); } });
      expect(draws).toEqual([fighterDraw(f, 'idle', age, 0xeeeedd)]);
    }
    collection.dispose();
  });

  it('replaces stored art with real geometry, mixes both capabilities, then returns to the original drawing and attachment', async () => {
    const system = createComputedFixtureSystem(), collection = new AppearanceCollection(system), f = host();
    const instance = collection.update(request('stored'));
    await instance.prepare(undefined, f.preparation);
    expect(f.compile).toHaveBeenCalledTimes(2); // both declared computed routes are ready before an action selects one
    instance.submit(f.target); f.layer.flush();
    const original = f.layer.submittedDraws();
    expect(original).toHaveLength(1);
    for (const facing of [-1, 1] as const) {
      instance.update(request('computed', 12, facing)); instance.submit(f.target); f.layer.flush();
      expect(f.layer.submittedDraws()).toEqual([]);
      const group = f.layer.scene.children.find(child => child.name === 'fixture:computed')!;
      expect(group).toBeInstanceOf(THREE.Group);
      const hand = group.getObjectByName('computed-attachment')!.getWorldPosition(new THREE.Vector3());
      expect(hand.x).toBeCloseTo(toWorldX(900 + 28 * facing));
      expect(hand.y).toBeCloseTo(toWorldY(650 - 44));
      instance.update(request('mixed', 12, facing)); instance.submit(f.target);
      f.target.sprite({ key: 'item', x: 900, y: 650, depth: .01 }); f.layer.flush();
      expect(f.layer.submittedDraws().map(draw => draw.key)).toEqual(['char.link.idle', 'item']);
      const accent = f.layer.scene.getObjectByName('computed-attachment')!;
      const spriteMeshes = f.layer.scene.children.filter(child => child instanceof THREE.Mesh) as THREE.Mesh[];
      expect(spriteMeshes[0]!.renderOrder).toBeLessThan(accent.renderOrder);
      expect(accent.renderOrder).toBeLessThan(spriteMeshes[1]!.renderOrder);
      const mixedHand = accent.getWorldPosition(new THREE.Vector3());
      expect(mixedHand.toArray()).toEqual(hand.toArray());
    }
    instance.update(request('stored')); instance.submit(f.target); f.layer.flush();
    expect(f.layer.submittedDraws()).toEqual(original);
    expect(f.layer.scene.children.some(child => child.name.startsWith('fixture:'))).toBe(false);
    collection.dispose(); f.layer.dispose();
  });

  it('holds computed motion on freeze/hitlag and restores deterministically while keeping screen pass explicit', async () => {
    const instance = createComputedFixtureSystem().create(request('computed', 8)), f = host();
    await instance.prepare(undefined, f.preparation);
    const initial = instance.diagnostics();
    instance.update(request('computed', 22, 1, { frozen: true }));
    expect(instance.diagnostics()).toEqual(initial);
    instance.update(request('computed', 23, 1, { hitlag: true }));
    expect(instance.diagnostics()).toEqual(initial);
    instance.update(request('computed', 3, -1, { restoreGeneration: 1, pass: 'screen' }));
    expect(instance.pass).toBe('screen');
    expect(instance.diagnostics()).toMatchObject({ age: 3, facing: -1 });
    instance.submit(f.target); f.layer.flush();
    expect(f.layer.scene.children.filter(child => child.name.startsWith('fixture:'))).toEqual([]);
    await instance.prepare(undefined, f.preparation);
    instance.submit(f.target); f.layer.flush();
    expect(f.layer.scene.children.some(child => child.name.startsWith('fixture:'))).toBe(true);
    instance.dispose(); f.layer.dispose();
  });

  it('keeps authoritative world attachments fixed through facing, scale and rotation', async () => {
    const system = createComputedFixtureSystem(), f = host();
    for (const facing of [-1, 1] as const) {
      const appearance = system.create(request('computed', 12, facing, { zoom: .6, rotation: .7,
        attachments: [{ id: 'item-grip', space: 'world', position: { x: 950, y: 602 } }] }));
      await appearance.prepare(undefined, f.preparation);
      const diagnostics = appearance.diagnostics() as { handWorld: number[]; attachmentId: string };
      expect(diagnostics.handWorld[0]).toBeCloseTo(toWorldX(950));
      expect(diagnostics.handWorld[1]).toBeCloseTo(toWorldY(602));
      expect(diagnostics.attachmentId).toBe('item-grip');
      appearance.dispose();
    }
    f.layer.dispose();
  });

  it('keeps the hidden legacy selector on authoritative freeze/hitlag ticks across route transitions', async () => {
    const sim = new MatchSim({ matchConfig: { mode: 'stocks', stockCount: 3, stageId: 'flat', rngSeed: 2, itemFrequency: 'off', linkIntroPolicy: 'none',
      players: [{ index: 1, characterId: 'link', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'easy' },
        { index: 2, characterId: 'pikachu', paletteIndex: 0, inputType: 'ai', aiDifficulty: 'easy' }] } });
    try {
      const state = sim.view().fighters[0]!.animation;
      const system = createComputedFixtureSystem(), f = host();
      const selector = createArtFrameSelector(MANIFEST_ART_CATALOG);
      let instance: ReturnType<typeof system.create> | undefined;
      for (let tick = 0; tick <= 50; tick++) {
        const animation = { ...state, frame: tick, frozen: tick >= 10 && tick <= 30, hitlagRemaining: tick >= 35 && tick <= 39 ? 2 : 0 };
        const original = selector.select(animation);
        const bridged = createLegacySnapshotAppearanceRequest(animation, { actorId: 'clock', profile: COMPUTED_FIXTURE_PROFILE, position: { x: 900, y: 650 } });
        // Retain the private bridge association while choosing a profile whose route phase
        // follows this test's transition: a profile per phase would reset the selector.
        Object.assign(bridged.action, { phase: tick > 5 && tick < 45 ? 'computed' : 'stored' });
        if (!instance) { instance = system.create(bridged); await instance.prepare(undefined, f.preparation); }
        else instance.update(bridged);
        if (tick < 6 || tick >= 45) {
          const draws: SpriteDraw[] = [];
          instance.submit({ sprite: draw => draws.push(draw), geometry: () => undefined });
          expect(draws).toEqual(fighterDrawsFromArt({ characterId: 'link', paletteIndex: 0, position: { x: 900, y: 650 }, facing: animation.facing, depth: 0 },
            original!, 0xffffff, animation.pikachuSpecial, animation).map(draw => ({ ...draw, alpha: 1 })));
        }
      }
      instance!.dispose(); f.layer.dispose();
    } finally { sim.dispose(); }
  });

  it('cancels stale preparation on replacement and disposes owned geometry exactly once without touching shared textures', async () => {
    const registry = createPresentationRegistry(); registry.registerCapability({ id: 'delayed' });
    registry.registerProfile({ id: 'delayed', revision: 'v1', characterId: 'link', routes: [{ id: 'body', action: '*', layer: 'body', capability: 'delayed', resources: [] }] });
    const system = new AppearanceSystem(registry);
    let finish!: () => void;
    const backends: ComputedFixtureAppearance[] = [];
    system.registerBackend({ capability: 'delayed', preparation: 'instance', create(route) {
      const backend = new ComputedFixtureAppearance(route); backends.push(backend);
      backend.prepare = context => new Promise(resolve => { finish = () => {
        expect(context.isCurrent()).toBe(false);
        resolve({ resourcesAvailable: true, shadersReady: true, warmedBytes: 0 });
      }; });
      return backend;
    } });
    const collection = new AppearanceCollection(system), f = host();
    const pendingInstance = collection.update(request('computed', 0, 1, { profile: { id: 'delayed', revision: 'v1' } }));
    const geometryDispose = vi.spyOn(backends[0]!.body.geometry, 'dispose'), materialDispose = vi.spyOn(backends[0]!.body.material, 'dispose');
    const sharedDispose = vi.spyOn(sheet.texture, 'dispose');
    const pending = pendingInstance.prepare(undefined, f.preparation);
    pendingInstance.submit(f.target); f.layer.flush();
    expect(f.layer.scene.children).toEqual([]);
    collection.dispose(); collection.dispose(); finish();
    await expect(pending).rejects.toThrow('cancelled');
    pendingInstance.submit(f.target); f.layer.flush();
    expect(f.layer.scene.children).toEqual([]);
    expect(geometryDispose).toHaveBeenCalledTimes(1); expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(sharedDispose).not.toHaveBeenCalled(); f.layer.dispose();
  });

  it('validates backend support before preparation and includes visual revision/capability in preview identities', () => {
    const registry = createPresentationRegistry(); registry.registerCapability({ id: 'not-installed' });
    registry.registerProfile({ id: 'missing', revision: 'v1', characterId: 'link', routes: [{ id: 'body', action: '*', layer: 'body', capability: 'not-installed', resources: [] }] });
    const system = new AppearanceSystem(registry);
    expect(() => system.create(request('stored', 0, 1, { profile: { id: 'missing', revision: 'v1' } }))).toThrow('Unsupported appearance backend');
    const fixture = createComputedFixtureSystem();
    expect(fixture.previewIdentity(request('stored'))).not.toEqual(fixture.previewIdentity(request('computed')));
    expect(fixture.previewIdentity(request('stored'))).not.toEqual(characterAppearances.previewIdentity(createLegacyPreviewAppearanceRequest({ characterId: 'link', position: { x: 900, y: 650 } })));
  });
});
