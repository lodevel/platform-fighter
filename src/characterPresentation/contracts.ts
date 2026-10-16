/** Portable appearance requests. Coordinates are design pixels, +X right and +Y down.
 * None of these contracts selects gameplay geometry or names a physical drawing. */
export interface PresentationPoint { readonly x: number; readonly y: number }
export interface PresentationProfileIdentity { readonly id: string; readonly revision: string }
export type PresentationFacing = 1 | -1;
export type PresentationPass = 'world' | 'screen';

export interface AppearanceAttachment {
  readonly id: string;
  readonly space: 'body' | 'root' | 'world';
  readonly position: PresentationPoint;
  /** Radians, clockwise in the coordinate system above. */
  readonly rotation?: number;
}

export interface AppearanceRequest {
  readonly actorId: string;
  readonly characterId: string;
  readonly profile: PresentationProfileIdentity;
  readonly action: {
    readonly id: string;
    readonly instanceId: string;
    readonly phase: string;
    readonly clock: {
      readonly domain: 'simulation-ticks' | 'action-age' | 'preview-ticks';
      readonly tick: number;
      /** An elapsed age in the declared domain; never a physical drawing index. */
      readonly age: number;
      readonly rate: number;
    };
    readonly frozen: boolean;
    readonly hitlag: boolean;
  };
  readonly transform: {
    /** Body centre for match requests; root for root-anchored preview requests. */
    readonly position: PresentationPoint;
    /** Present when the caller explicitly supplies a root anchor. */
    readonly root?: PresentationPoint;
    readonly facing: PresentationFacing;
    readonly scale: PresentationPoint;
    readonly rotation: number;
  };
  readonly palette: { readonly index: number; readonly tint?: number };
  readonly visibility: { readonly visible: boolean; readonly alpha: number };
  readonly attachments: readonly AppearanceAttachment[];
  readonly equipment: readonly string[];
  readonly context: Readonly<Record<string, string | number | boolean | null>>;
  readonly restoreGeneration: number;
  readonly pass: PresentationPass;
  /** Stable queue order in the selected pass, shared with items and effects. */
  readonly order: number;
}

export interface PresentationRoute {
  readonly id: string;
  /** '*' is an explicitly declared fallback, not an implicit idle route. */
  readonly action: string;
  /** Missing or '*' matches every phase. */
  readonly phase?: string;
  readonly layer: string;
  readonly capability: string;
  /** Backend-owned identifiers. The core never interprets these as image URLs. */
  readonly resources: readonly string[];
}

export interface PresentationProfile extends PresentationProfileIdentity {
  readonly characterId: string;
  readonly routes: readonly PresentationRoute[];
}

export interface PresentationCapability { readonly id: string }

/** Resource availability, shader readiness and optional GPU warming are separate gates.
 * A warming allowance is not a total resident-memory budget. */
export interface AppearancePreparation {
  readonly resourcesAvailable: boolean;
  readonly shadersReady: boolean;
  readonly warmedBytes: number;
}

/** Host-independent cancellation; adapters may implement this using AbortSignal. */
export interface AppearanceCancellation {
  readonly cancelled: boolean;
  onCancel(listener: () => void): () => void;
}

/** The submission is owned by a host adapter and need not contain sprites or textures. */
export interface AppearanceLifecycle<Submission, Diagnostics> {
  prepare(cancellation: AppearanceCancellation): Promise<AppearancePreparation>;
  update(request: AppearanceRequest): void;
  submit(): Submission;
  reset(restoreGeneration: number): void;
  diagnostics(): Diagnostics;
  /** Idempotent; release instance resources without destroying shared assets. */
  dispose(): void;
}
