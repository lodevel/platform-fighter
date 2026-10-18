import type { AppearancePreparation, AppearanceRequest, PresentationRoute } from '../../../../src/characterPresentation/contracts';
import type { AppearancePreparationHost, PresentationTarget } from '../../engine/presentation/submission';
import type { SpriteLayer } from '../../engine/sprites/spriteLayer';
import type { HeldItemSocket, ItemSocketAxis } from '../../../../src/characters/heldItemSocket';

/** Where the drawing shown now holds an item: world design px, angle with facing applied, and the facing. */
export interface HeldItemGrip extends HeldItemSocket { readonly facing: 1 | -1 }

export interface BackendPreparation {
  readonly signal: AbortSignal;
  /** A replacement actor/profile or reset makes an earlier preparation stale. */
  isCurrent(): boolean;
  readonly host?: AppearancePreparationHost;
}

/** Narrow Three host adapter; its result never has to be a bitmap or SpriteDraw. */
export interface AppearanceBackend {
  prepare(context: BackendPreparation): Promise<AppearancePreparation>;
  update(request: AppearanceRequest): void;
  submit(target: PresentationTarget): void;
  reset(restoreGeneration: number): void;
  diagnostics(layer?: SpriteLayer, tint?: number): unknown;
  /** The grip of the drawing this backend shows now, when its art defines one; absent or null keeps the gameplay grip. */
  heldItemGrip?(axis: ItemSocketAxis): HeldItemGrip | null;
  dispose(): void;
}

export interface AppearanceBackendFactory {
  readonly capability: string;
  /** Shared adapters own no preparation work; the resource lease gates the match.
   * Instance adapters may not submit until their own preparation completes. */
  readonly preparation: 'shared' | 'instance';
  create(route: PresentationRoute): AppearanceBackend;
  /** Backend-specific offscreen implementation stays behind the preview service. */
  snapshot?(request: AppearanceRequest, route: PresentationRoute): Promise<HTMLCanvasElement>;
}
