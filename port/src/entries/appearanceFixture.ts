/** Test entry, included only by PF_PRESENTATION_FIXTURE=1 builds. */
import { StagePresenter } from '../arena/presenter';
import { createComputedFixtureSystem, COMPUTED_FIXTURE_PROFILE } from '../fighters/backends/computedFixture';
import { createLegacyPreviewAppearanceRequest } from '../../../src/characterPresentation/legacy/bridge';
import { presentationTarget, geometryPreparationHost } from '../engine/presentation/submission';
import { AppearanceCollection } from '../fighters/appearance';

const presenter = new StagePresenter(document.getElementById('view')!);
presenter.setStage('flat'); presenter.paused = true;
const system = createComputedFixtureSystem(), collection = new AppearanceCollection(system);
let age = 0, generation = 0;
const request = (phase: string, facing: 1 | -1, frozen = false, pass: 'world' | 'screen' = 'world') => createLegacyPreviewAppearanceRequest({
  actorId: 'fixture', characterId: 'link', profile: COMPUTED_FIXTURE_PROFILE, action: 'idle', phase, age, tick: age,
  position: { x: 960, y: 750 }, facing, frozen, pass, restoreGeneration: generation,
  attachments: [{ id: 'hand', space: 'root', position: { x: 28, y: -44 } }],
});
const read = () => ({
  diagnostics: collection.diagnostics('fixture', presenter.sprites),
  draws: presenter.sprites.submittedDraws(),
  nodes: presenter.sprites.scene.children.flatMap(node => {
    const rows: Array<{ name: string; order: number; visible: boolean }> = [];
    node.traverse(child => { if ('isMesh' in child) rows.push({ name: child.name, order: child.renderOrder, visible: child.visible }); });
    return rows;
  }),
  textures: presenter.sprites.textures.diagnostics(), renderer: { ...presenter.renderer.info.memory },
  screenNodes: presenter.screenSprites.scene.children.filter(node => node.visible).map(node => node.name),
});
const ready = (async () => {
  await presenter.sprites.textures.load('char.link.idle');
  const instance = collection.update(request('stored', 1));
  await instance.prepare(undefined, geometryPreparationHost(presenter.renderer, presenter.sprites.scene, presenter.camera));
})();
Object.assign(window, { __appearanceFixture: {
  ready,
  show(phase: string, facing: 1 | -1, nextAge: number, frozen = false, pass: 'world' | 'screen' = 'world') {
    age = nextAge;
    const instance = collection.update(request(phase, facing, frozen, pass));
    presenter.appearanceSource = () => [instance];
    presenter.frame(performance.now());
    return read();
  },
  async restore(nextAge: number) {
    generation++; age = nextAge;
    const instance = collection.update(request('computed', 1));
    await instance.prepare(undefined, geometryPreparationHost(presenter.renderer, presenter.sprites.scene, presenter.camera));
    return this.show('computed', 1, age);
  },
  async preview(phase: string) {
    const canvas = await system.snapshot(request(phase, 1));
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 8) opaque++;
    return { width: canvas.width, height: canvas.height, opaque, png: canvas.toDataURL() };
  },
  dispose() { collection.dispose(); presenter.appearanceSource = null; presenter.frame(performance.now()); return read(); },
  async repeat(count: number) {
    for (let i = 0; i < count; i++) {
      const instance = collection.update(request('computed', 1));
      await instance.prepare(undefined, geometryPreparationHost(presenter.renderer, presenter.sprites.scene, presenter.camera));
      instance.submit(presentationTarget(presenter.sprites)); presenter.sprites.flush(); collection.dispose();
    }
    presenter.sprites.flush(); return read();
  },
} });
