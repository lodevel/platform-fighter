import type { ActionDisplay, AppearanceRequest, PresentationPoint, PresentationProfile } from '../../../../src/characterPresentation/contracts';
import { evaluate } from '../../../../character/evaluator/evaluate';
import type { CharacterPackage, PageId } from '../../../../character/package/types';
import { readLegacyAnimation } from '../../../../src/characterPresentation/legacy/bridge';
import { createLegacyArtSelector } from '../../../../src/characterPresentation/legacy/selector';
import { sheetDisplay } from '../../../../src/characters/actionDisplay';
import type { CharacterId } from '../../../../src/types';
import { SpriteSnapshotter } from '../../engine/sprites/spriteSnapshot';
import { gpuFinished } from '../../engine/gpuFence';
import { facingOriginX, type SpriteDraw, type SpriteLayer } from '../../engine/sprites/spriteLayer';
import type { PresentationTarget } from '../../engine/presentation/submission';
import { SHIPPED_PACKAGES } from '../packageIndex';
import { costumeRow, packageLibrary, type LoadedPackage, type PackageLease, type PackageLibrary } from '../packageLibrary';
import { combinedProgress, registerAppearanceResourceProvider } from '../resources';
import type { AppearanceBackend, AppearanceBackendFactory, BackendPreparation, HeldItemGrip } from './types';
import { packageItemSocket } from './packageItemSocket';
import type { ItemSocketAxis } from '../../../../src/characters/heldItemSocket';

export const PACKAGE_SPRITE_CAPABILITY = 'package-sprite';
const RESOURCE_PREFIX = 'package:';

/** What a menu, preview or knockout-flight request shows: its own action (a sheet name) at its clock age. */
export function requestDisplay(request: AppearanceRequest): ActionDisplay {
  return sheetDisplay(request.characterId as CharacterId, request.action.id, request.action.clock.age, request.transform.facing);
}

interface Layer {
  readonly action: string;
  readonly tick: number;
  /** Where the layer's body centre is drawn, or its root for a root-anchored request. */
  readonly at: PresentationPoint;
  readonly anchoredAtRoot: boolean;
  readonly rotation: number;
  /** Rotation centre from the body centre, facing right. */
  readonly pivot?: PresentationPoint;
  /** The layer shows only below (`top`) or above (`bottom`) this many design px under its root. */
  readonly clip?: { readonly top?: number; readonly bottom?: number };
  readonly depth: number;
}

/** One layer's drawing as a sprite: scaled about the root, turned about the pivot, mirrored for facing. */
function layerDraw(loaded: LoadedPackage, request: AppearanceRequest, display: ActionDisplay, layer: Layer) {
  const pose = evaluate(loaded.pkg, { action: layer.action, tick: layer.tick, facing: display.facing });
  const drawing = pose.drawing === null ? undefined : loaded.pkg.drawings[pose.drawing];
  const page = drawing && loaded.pages.get(drawing.page);
  if (!drawing || !page) return null;
  const { transform } = request, facing = display.facing, b = pose.bodyCentreFromRootY;
  const root = layer.anchoredAtRoot ? layer.at : { x: layer.at.x, y: layer.at.y - b };
  // The pivot from the root; the sprite turns about its origin, so the origin moves there.
  const pivot = layer.pivot ? { x: layer.pivot.x, y: layer.pivot.y + b } : { x: 0, y: 0 };
  const [, , w, h] = drawing.rect, [ax, ay] = drawing.anchor;
  const sx = drawing.scale * transform.scale.x * (display.scale?.x ?? 1), sy = drawing.scale * transform.scale.y * (display.scale?.y ?? 1);
  const row = (designY: number) => ay + designY / sy;
  const draw: SpriteDraw = {
    key: `package.${loaded.pkg.id}.${pose.drawing}`, x: root.x + pivot.x * facing, y: root.y + pivot.y,
    originX: facingOriginX((ax + pivot.x / sx) / w, facing), originY: (ay + pivot.y / sy) / h,
    scaleX: sx, scaleY: sy, flipX: facing === -1, depth: layer.depth, tint: request.palette.tint ?? 0xffffff,
    ...(request.visibility.alpha !== 1 ? { alpha: request.visibility.alpha } : {}), ...(layer.rotation !== 0 ? { rotation: layer.rotation } : {}),
    ...(layer.clip ? { clipRows: { ...(layer.clip.top === undefined ? {} : { top: row(layer.clip.top) }),
      ...(layer.clip.bottom === undefined ? {} : { bottom: row(layer.clip.bottom) }) } } : {}),
    indexed: { page, rect: drawing.rect, palette: loaded.palette, paletteRow: costumeRow(loaded, request.palette.index) },
  };
  return { draw, drawing: pose.drawing! };
}

/** The action a package shows for `action`: itself, else `idle`, else none. */
function shownAction(pkg: CharacterPackage, action: string): string | null {
  return pkg.actions[action] ? action : pkg.actions.idle ? 'idle' : null;
}

/** The pages a single-layer display (menu art) draws from. */
function displayPages(pkg: CharacterPackage, display: ActionDisplay): PageId[] {
  const action = shownAction(pkg, display.action);
  const drawing = action === null ? null : evaluate(pkg, { action, tick: display.tick, facing: display.facing }).drawing;
  return drawing === null ? [] : [pkg.drawings[drawing]!.page];
}

/**
 * The sprites `display` shows from a loaded package (the body, then an upper-body overlay
 * clipped at the waist), or null when the action shows nothing. An action the package does
 * not have shows `idle`.
 */
export function packageDraws(loaded: LoadedPackage, request: AppearanceRequest, display: ActionDisplay): { draws: SpriteDraw[]; action: string; drawing: string } | null {
  const has = (action: string) => Boolean(loaded.pkg.actions[action]);
  const action = shownAction(loaded.pkg, display.action);
  if (!action) return null;
  const { transform } = request;
  // Match requests carry the body centre; previews and knockout flights carry the root.
  const anchoredAtRoot = request.action.clock.domain === 'preview-ticks' && transform.root !== undefined;
  const at = anchoredAtRoot ? transform.root! : transform.position, overlay = display.overlay;
  const base = layerDraw(loaded, request, display, { action, tick: display.tick, at, anchoredAtRoot, depth: request.order,
    rotation: transform.rotation + (display.rotation ?? 0), ...(display.pivot ? { pivot: display.pivot } : {}),
    ...(overlay ? { clip: { top: overlay.clip.base } } : {}) });
  if (!base) return null;
  const upper = overlay && has(overlay.action) ? layerDraw(loaded, request, display, { action: overlay.action, tick: overlay.tick,
    at: { x: at.x + overlay.offset.x * display.facing, y: at.y + overlay.offset.y }, anchoredAtRoot, depth: request.order + .01,
    rotation: transform.rotation, clip: { bottom: overlay.clip.overlay } }) : null;
  return { action, drawing: base.drawing, draws: upper ? [base.draw, upper.draw] : [base.draw] };
}

/**
 * Holds its fighter's package for its whole life, so menus, previews and matches share one copy.
 * A simulated fighter shows what the game's art selector chose (its `display`: action, tick and
 * placement), so freezes, hitlag and rewinds behave exactly as in the legacy path.
 */
export class PackageSpriteAppearance implements AppearanceBackend {
  private readonly selector = createLegacyArtSelector();
  private request: AppearanceRequest | null = null;
  private lease: PackageLease | null = null;
  private disposed = false;
  private missingAction: string | null = null;
  constructor(private readonly library: PackageLibrary = packageLibrary) {}
  async prepare(context: BackendPreparation) {
    if (!context.isCurrent() || context.signal.aborted) throw new Error('Appearance preparation cancelled');
    // The match's resource lease loads the package; this instance owns no GPU resources.
    return { resourcesAvailable: true, shadersReady: true, warmedBytes: 0 };
  }
  update(request: AppearanceRequest): void {
    if (this.disposed) throw new Error('Cannot update a disposed appearance');
    if (this.lease?.id !== request.characterId) {
      this.lease?.release();
      this.lease = this.library.acquire(request.characterId);
    }
    this.request = request;
    if (readLegacyAnimation(request)) this.selector.select(request);
  }
  /** Null when the game's art selector shows nothing for this fighter (as the legacy path draws nothing). */
  private display(request: AppearanceRequest): ActionDisplay | null {
    return readLegacyAnimation(request) ? this.selector.current()?.display ?? null : requestDisplay(request);
  }
  /** A match fighter's held-item grip in the drawing shown now (the package holds sockets with drawings), or null. */
  heldItemGrip(axis: ItemSocketAxis): HeldItemGrip | null {
    const request = this.request, loaded = request && !this.disposed && readLegacyAnimation(request) ? this.library.resident(request.characterId) : undefined;
    const display = request && loaded ? this.display(request) : null, socket = display && packageItemSocket(loaded!.pkg, display, axis);
    // A match request's position is the body centre, where package sockets are measured from.
    return socket && { ...socket, x: request!.transform.position.x + socket.x, y: request!.transform.position.y + socket.y, facing: display!.facing };
  }
  private current(tintOverride?: number) {
    const request = this.request, loaded = request && !this.disposed ? this.library.resident(request.characterId) : undefined;
    if (!request || !loaded) return null;
    const display = this.display(request);
    if (!display) return null;
    const shown = packageDraws(loaded, tintOverride === undefined ? request : { ...request, palette: { ...request.palette, tint: tintOverride } }, display);
    this.missingAction = shown && shown.action !== display.action ? display.action : null;
    return shown && { ...shown, display, loaded };
  }
  submit(target: PresentationTarget): void {
    const shown = this.current(target.tint);
    for (const draw of shown?.draws ?? []) target.sprite(draw);
  }
  reset(): void { this.selector.reset(); this.request = null; }
  diagnostics(layer?: SpriteLayer, tint?: number) {
    const request = this.request;
    if (!request || this.disposed) return null;
    const shown = this.current(tint);
    const base = { capability: PACKAGE_SPRITE_CAPABILITY, characterId: request.characterId, resident: Boolean(this.library.resident(request.characterId)) };
    if (!shown) return { ...base, submitted: false, visible: false };
    const { indexed, ...draw } = shown.draws[0]!;
    const submitted = layer?.submittedDraws().filter(row => row.key === draw.key && row.x === draw.x && row.y === draw.y) ?? [];
    return { ...base, ...draw, revision: shown.loaded.pkg.revision, display: shown.display, action: shown.action, drawing: shown.drawing,
      missingAction: this.missingAction, paletteRow: indexed!.paletteRow, rect: indexed!.rect,
      frameWidth: indexed!.rect[2], frameHeight: indexed!.rect[3],
      displayWidth: indexed!.rect[2] * Math.abs(draw.scaleX ?? 1), displayHeight: indexed!.rect[3] * Math.abs(draw.scaleY ?? 1),
      layers: shown.draws.length, textureResident: true, submitted: submitted.length > 0, visible: submitted.some(row => (row.alpha ?? 1) > 0) };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.selector.dispose();
    this.lease?.release();
    this.lease = null;
    this.request = null;
  }
}

const snapshotter = new SpriteSnapshotter();

export const packageSpriteBackend: AppearanceBackendFactory = {
  capability: PACKAGE_SPRITE_CAPABILITY,
  preparation: 'shared',
  create: () => new PackageSpriteAppearance(),
  /** Menu art: only the page of the one drawing shown, decoded for the CPU. */
  async snapshot(request) {
    const display = requestDisplay(request);
    const borrowed = await packageLibrary.borrow(request.characterId, pkg => displayPages(pkg, display));
    try {
      const shown = packageDraws(borrowed.loaded, request, display);
      if (shown?.draws.length !== 1) throw new Error(`Package preview needs one drawing: ${request.characterId}/${request.action.id}`);
      return await snapshotter.snapshot(shown.draws[0]!);
    } finally { borrowed.release(); }
  },
};

/** The package a `package:<id>` resource names. */
export function packageOfResource(resource: string): string {
  if (!resource.startsWith(RESOURCE_PREFIX)) throw new Error(`Unsupported package resource '${resource}'`);
  return resource.slice(RESOURCE_PREFIX.length);
}

/** One profile per shipped package, pinned to the indexed revision; selected by the Fighter art setting. */
export function packagePresentationProfile(characterId: string): PresentationProfile | undefined {
  const entry = SHIPPED_PACKAGES.packages[characterId];
  return entry && { id: `package.${characterId}`, revision: entry.revision, characterId,
    routes: [{ id: 'package-body', action: '*', layer: 'body', capability: PACKAGE_SPRITE_CAPABILITY, resources: [`${RESOURCE_PREFIX}${characterId}`] }] };
}

/**
 * A match lease holds every package its fighters use until the lease is disposed (its signal
 * aborts). Packages already loaded or loading for the fighter select are reused, and every page
 * is on the match renderer before play.
 */
export function registerPackageAppearanceResources(library: PackageLibrary = packageLibrary): void {
  registerAppearanceResourceProvider({ capability: PACKAGE_SPRITE_CAPABILITY,
    async prepare(resources, host, { signal, progress }) {
      library.attachRenderer(host.renderer);
      const part = combinedProgress(resources.length, progress);
      const leases = resources.map((resource, index) => library.acquire(packageOfResource(resource), { signal, progress: part(index) }));
      await Promise.all(leases.map(lease => lease.ready));
      // Pages still queued for background upload go up now, and the GPU finishes them, while
      // the match is loading rather than in its first frames.
      library.flushUploads();
      await gpuFinished(host.renderer, signal);
    },
  });
}
