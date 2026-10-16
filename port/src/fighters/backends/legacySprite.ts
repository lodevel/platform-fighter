import type { AppearanceRequest } from '../../../../src/characterPresentation/contracts';
import { readLegacyAnimation, readLegacyFlight } from '../../../../src/characterPresentation/legacy/bridge';
import { createLegacyArtSelector } from '../../../../src/characterPresentation/legacy/selector';
import { LEGACY_SPRITE_CAPABILITY } from '../../../../src/characterPresentation/legacy/profiles';
import { SpriteSnapshotter } from '../../engine/sprites/spriteSnapshot';
import type { SpriteDraw, SpriteLayer } from '../../engine/sprites/spriteLayer';
import type { PresentationTarget } from '../../engine/presentation/submission';
import { fighterDraw, fighterDrawAtBody, fighterDrawFromArt, fighterDrawsFromArt, knockoutFlightDraw } from '../poses';
import type { AppearanceBackend, AppearanceBackendFactory, BackendPreparation } from './types';

const snapshotter = new SpriteSnapshotter();

/** The compatibility adapter owns all physical sheet/frame selection and poses. */
export class LegacySpriteAppearance implements AppearanceBackend {
  private readonly selector = createLegacyArtSelector();
  private request: AppearanceRequest | null = null;
  private disposed = false;
  async prepare(context: BackendPreparation) {
    if (!context.isCurrent() || context.signal.aborted) throw new Error('Appearance preparation cancelled');
    // Shared decoded resources and shader readiness are prepared by the match's
    // resource lease. This instance allocates no private textures or materials.
    return { resourcesAvailable: true, shadersReady: true, warmedBytes: 0 };
  }
  update(request: AppearanceRequest): void {
    this.request = request;
    if (readLegacyAnimation(request)) this.selector.select(request);
  }
  private drawings(diagnostics = false, tintOverride?: number): SpriteDraw[] {
    const request = this.request;
    if (!request || this.disposed) return [];
    const tint = tintOverride ?? request.palette.tint ?? 0xffffff;
    const flight = readLegacyFlight(request);
    if (flight) {
      const draw = knockoutFlightDraw(flight, tint);
      return draw ? [draw] : [];
    }
    const animation = readLegacyAnimation(request), art = this.selector.current();
    const f = { characterId: request.characterId, paletteIndex: request.palette.index,
      position: request.transform.position, facing: request.transform.facing, depth: diagnostics ? 0 : request.order };
    if (animation) {
      if (!art) return [];
      const draws = fighterDrawsFromArt(f, art, tint, animation.pikachuSpecial, animation);
      return diagnostics ? draws : draws.map(draw => ({ ...draw, alpha: request.visibility.alpha }));
    }
    const input = { ...f, x: request.transform.position.x, y: request.transform.position.y, zoom: request.transform.scale.x };
    const draw = request.transform.root
      ? fighterDraw(input, request.action.id, request.action.clock.age, tint)
      : fighterDrawAtBody(input, request.action.id, request.action.clock.age, tint);
    if (!draw) return [];
    return [{ ...draw, ...(request.visibility.alpha !== 1 ? { alpha: request.visibility.alpha } : {}),
      ...(request.transform.rotation !== 0 ? { rotation: request.transform.rotation } : {}) }];
  }
  submit(target: PresentationTarget): void { for (const draw of this.drawings(false, target.tint)) target.sprite(draw); }
  reset(): void { this.selector.reset(); this.request = null; }
  diagnostics(layer?: SpriteLayer, tint?: number) {
    const request = this.request;
    if (!request || !request.visibility.visible || this.disposed) return null;
    const flight = readLegacyFlight(request), animation = readLegacyAnimation(request), art = this.selector.current();
    const draw = flight ? this.drawings(true, tint)[0] : animation && art
      ? fighterDrawFromArt({ characterId: request.characterId, paletteIndex: request.palette.index,
        position: request.transform.position, facing: request.transform.facing }, art, tint ?? request.palette.tint ?? 0xffffff, animation.pikachuSpecial, animation)
      : this.drawings(true, tint)[0];
    if (!draw) return null;
    if (!layer) return draw;
    const sheet = layer.textures.resident(draw.key);
    if (!sheet) return null;
    const submitted = layer.submittedDraws().filter(row => row.key === draw.key && row.frame === draw.frame && row.x === draw.x && row.y === draw.y);
    const metrics = { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight,
      displayWidth: sheet.frameWidth * Math.abs(draw.scaleX ?? 1), displayHeight: sheet.frameHeight * Math.abs(draw.scaleY ?? 1) };
    if (flight) return { ...draw, art: null, flight, textureResident: true, submitted: Boolean(submitted.length),
      visible: Boolean(submitted.length && (submitted[0]!.alpha ?? 1) > 0), ...metrics };
    return { ...draw, art, textureResident: true, submitted: Boolean(submitted.length),
      submittedAlpha: submitted[0]?.alpha ?? null, visible: submitted.some(row => (row.alpha ?? 1) > 0),
      layers: this.drawings(true, tint), ...metrics };
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.selector.dispose(); this.request = null; }
}

export const legacySpriteBackend: AppearanceBackendFactory = {
  capability: LEGACY_SPRITE_CAPABILITY,
  preparation: 'shared',
  create: () => new LegacySpriteAppearance(),
  async snapshot(request) {
    const instance = new LegacySpriteAppearance();
    try {
      instance.update(request);
      const draws: SpriteDraw[] = [];
      instance.submit({ sprite: draw => draws.push(draw), geometry: () => { throw new Error('Unexpected geometry in legacy snapshot'); } });
      if (draws.length !== 1) throw new Error(`Legacy preview needs one drawing: ${request.characterId}/${request.action.id}`);
      return await snapshotter.snapshot(draws[0]!);
    } finally { instance.dispose(); }
  },
};
