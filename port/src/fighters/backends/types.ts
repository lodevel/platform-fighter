import type { AppearancePreparation, AppearanceRequest, PresentationRoute } from '../../../../src/characterPresentation/contracts';
import type { AppearancePreparationHost, PresentationTarget } from '../../engine/presentation/submission';
import type { SpriteLayer } from '../../engine/sprites/spriteLayer';

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
