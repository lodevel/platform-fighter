import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ActionDisplay, AppearanceRequest } from '../../../../src/characterPresentation/contracts';
import { createLegacyPreviewAppearanceRequest } from '../../../../src/characterPresentation/legacy/bridge';
import { createLegacyPresentationRegistry, legacyPresentationProfile } from '../../../../src/characterPresentation/legacy/profiles';
import { STAGE_DESIGN_HEIGHT, STAGE_DESIGN_WIDTH } from '../../../../src/stages/stageDefinitions';
import type { CharacterPackage } from '../../../../character/package/types';
import { SAMPLE } from '../../../../character/testing/samplePackage';
import { PX_PER_UNIT } from '../../engine/space';
import { SpriteLayer, type SpriteDraw } from '../../engine/sprites/spriteLayer';
import type { TextureStore } from '../../engine/sprites/textureStore';
import { AppearanceSystem, packageOptIn, selectPackageProfiles } from '../appearance';
import type { LoadedPackage } from '../packageLibrary';
import { SHIPPED_PACKAGES } from '../packageIndex';
import { legacySpriteBackend } from './legacySprite';
import { PACKAGE_SPRITE_CAPABILITY, packageDraws, packagePresentationProfile, requestDisplay } from './packageSprite';

const PKG: CharacterPackage = { ...SAMPLE, revision: 'r1', palette: ['#00000000', '#704023ff'],
  pages: { p0: { ...SAMPLE.pages.p0!, format: 'indexed' } },
  actions: { ...SAMPLE.actions, shoot: { ...SAMPLE.actions.idle!, bodyCentreFromRootY: -10 } } };
const LOADED: LoadedPackage = { pkg: PKG, pages: new Map([['p0', { texture: new THREE.Texture(), width: 64, height: 32 }]]),
  palette: new THREE.DataTexture(), costumes: 2, gpuBytes: 0 };
/** SAMPLE's idle: 32×32 drawings anchored at (16, 30), 0.5 design px per page px, body centre 20 above the root. */
const B = -20;

const preview = (input: Partial<Parameters<typeof createLegacyPreviewAppearanceRequest>[0]> = {}) =>
  createLegacyPreviewAppearanceRequest({ characterId: 'link', position: { x: 500, y: 300 }, ...input });
/** A match request: the position is the body centre. */
const match = (facing: 1 | -1, extra: Partial<AppearanceRequest> = {}): AppearanceRequest => {
  const request = preview({ anchor: 'body', facing, paletteIndex: 3, depth: 4 });
  return { ...request, action: { ...request.action, clock: { ...request.action.clock, domain: 'action-age' } }, ...extra };
};
const display = (facing: 1 | -1, extra: Partial<ActionDisplay> = {}): ActionDisplay => ({ action: 'idle', tick: 6, facing, ...extra });

/** Where a drawing's page pixel lands on screen, in design px, after the layer places the quad. */
function lands(draw: SpriteDraw, pagePoint: readonly [number, number]) {
  const layer = new SpriteLayer({} as TextureStore);
  layer.draw(draw);
  layer.flush();
  const mesh = layer.scene.children[0] as THREE.Mesh, [x, y, w, h] = draw.indexed!.rect;
  const world = new THREE.Vector3((pagePoint[0] - x) / w, (pagePoint[1] - y) / h, 0).applyMatrix4(mesh.matrix);
  return { x: world.x * PX_PER_UNIT + STAGE_DESIGN_WIDTH / 2, y: STAGE_DESIGN_HEIGHT / 2 - world.y * PX_PER_UNIT };
}

describe('package sprite drawing', () => {
  it('puts the anchor on the root below the body centre, in both facings, with the costume row', () => {
    for (const facing of [1, -1] as const) {
      const shown = packageDraws(LOADED, match(facing), display(facing))!;
      const draw = shown.draws[0]!;
      expect([shown.action, shown.drawing, draw.flipX, draw.depth, draw.indexed!.paletteRow]).toEqual(['idle', 'idle/1', facing === -1, 4, 1]);
      // idle/1 sits at page x 32; its anchor is (16, 30) inside the rect.
      const anchor = lands(draw, [32 + 16, 30]);
      expect(anchor.x).toBeCloseTo(500);
      expect(anchor.y).toBeCloseTo(300 - B);
      // One page pixel right of the anchor lands half a design px forward.
      expect(lands(draw, [32 + 17, 30]).x - anchor.x).toBeCloseTo(0.5 * facing);
    }
  });

  it('anchors previews at the root and scales with the request zoom', () => {
    const draw = packageDraws(LOADED, preview({ zoom: 2 }), requestDisplay(preview({ action: 'idle', age: 0 })))!.draws[0]!;
    expect(lands(draw, [16, 30])).toMatchObject({ x: expect.closeTo(500), y: expect.closeTo(300) });
    expect(draw.scaleX).toBe(1);
  });

  it('turns about the pivot, keeping it in place, and squashes about the root', () => {
    for (const facing of [1, -1] as const) {
      const pivot = { x: 6, y: -4 }, turned = packageDraws(LOADED, match(facing), display(facing, { rotation: 0.9, pivot, scale: { x: 1, y: 0.5 } }))!.draws[0]!;
      // The pivot is 6 forward and 4 up from the body centre; in page px from the anchor it is (6, -4 + B) / 0.5 / scale.
      const at = lands(turned, [32 + 16 + 6 / 0.5, 30 + (-4 + B) / 0.25]);
      expect(at.x).toBeCloseTo(500 + 6 * facing);
      expect(at.y).toBeCloseTo(300 - 4);
      expect(turned.rotation).toBe(0.9);
      const squashed = packageDraws(LOADED, match(facing), display(facing, { scale: { x: 1, y: 0.5 } }))!.draws[0]!;
      expect(lands(squashed, [32 + 16, 30]).y).toBeCloseTo(300 - B);
      expect(lands(squashed, [32 + 16, 30 - 8]).y).toBeCloseTo(300 - B - 2);
    }
  });

  it('draws an upper-body overlay at its offset, each layer clipped at its waist', () => {
    const shown = packageDraws(LOADED, match(-1), display(-1, { overlay: { action: 'shoot', tick: 0, offset: { x: 3, y: -1 }, clip: { base: -8, overlay: -12 } } }))!;
    const [base, upper] = shown.draws;
    expect(base!.clipRows).toEqual({ top: 30 - 16 });
    expect(upper!.clipRows).toEqual({ bottom: 30 - 24 });
    expect(upper!.depth).toBeCloseTo(4.01);
    // The overlay's body centre is 3 forward (left, facing -1) and 1 up; its root is 10 below that.
    const anchor = lands({ ...upper!, clipRows: undefined }, [16, 30]);
    expect(anchor.x).toBeCloseTo(497);
    expect(anchor.y).toBeCloseTo(300 - 1 + 10);
  });

  it('shows idle for an action the package does not have', () => {
    expect(packageDraws(LOADED, match(1), display(1, { action: 'missing' }))?.action).toBe('idle');
  });
});

describe('package profiles', () => {
  it('registers one profile per shipped package, pinned to its revision', () => {
    for (const [id, entry] of Object.entries(SHIPPED_PACKAGES.packages))
      expect(packagePresentationProfile(id)).toMatchObject({ id: `package.${id}`, revision: entry.revision,
        routes: [{ capability: PACKAGE_SPRITE_CAPABILITY, resources: [`package:${id}`] }] });
    expect(packagePresentationProfile('nobody')).toBeUndefined();
  });

  it('reads the opt-in flag and switches only the named fighters, back to legacy without it', () => {
    expect([...packageOptIn('?packages=link,nobody')]).toEqual(['link']);
    expect(packageOptIn('?packages=all').size).toBe(Object.keys(SHIPPED_PACKAGES.packages).length);
    expect(packageOptIn('').size).toBe(0);
    const registry = createLegacyPresentationRegistry();
    registry.registerCapability({ id: PACKAGE_SPRITE_CAPABILITY });
    registry.registerProfile(packagePresentationProfile('link')!);
    const system = new AppearanceSystem(registry);
    system.registerBackend(legacySpriteBackend);
    system.registerBackend({ capability: PACKAGE_SPRITE_CAPABILITY, preparation: 'shared', create: () => { throw new Error('unused'); } });
    selectPackageProfiles(['link', 'pikachu'], packageOptIn('?packages=link'), system);
    expect(system.profileFor('link').id).toBe('package.link');
    expect(system.profileFor('pikachu')).toEqual(legacyPresentationProfile('pikachu'));
    selectPackageProfiles(['link'], new Set(), system);
    expect(system.profileFor('link').id).toBe(legacyPresentationProfile('link').id);
  });
});
