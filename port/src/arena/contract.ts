import type * as THREE from 'three';

/** Render-time clock handed to every animated stage part. */
export interface StageClock {
  /** Simulation frame (60 Hz) the view is showing. */
  readonly frame: number;
  /** Render seconds since the view was created; drives purely decorative motion. */
  readonly elapsed: number;
  /** Render seconds since the previous update, clamped. */
  readonly dt: number;
  /** Net wind on the gameplay plane, -1..1 of its peak (0 without wind), for decor that sways. */
  readonly wind: number;
}

/** One platform of a `StageLayout`, converted to world units. */
export interface PlatformSpec {
  readonly index: number;
  readonly width: number;
  /** Authored collision thickness, in world units. */
  readonly height: number;
  /** Solid ground, pass-through floating platform, or moving platform. */
  readonly kind: 'ground' | 'floating' | 'moving';
  /** World x of the platform's centre and y of its top, at rest (frame 0). */
  readonly x: number;
  readonly top: number;
  /** Extent of a moving platform's path, in world units (0, 0 when it doesn't move). */
  readonly travel: { readonly x: number; readonly y: number };
}

/** A lava hazard's footprint, in world units (x = centre, base = bottom). */
export interface LavaPoolSpec {
  readonly x: number;
  readonly base: number;
  readonly width: number;
  readonly maxHeight: number;
}

/** The Inferno head's state for its visual (see src/entities/GazeHazard). */
export interface GazeView {
  readonly phase: 'dormant' | 'rising' | 'glare' | 'flash' | 'sinking';
  /** 0..1 through the current phase. */
  readonly progress: number;
}

export interface LavaPoolVisual {
  /** `height` in world units; `norm` is the cycle height in [0, 1]. */
  update(height: number, norm: number, active: boolean, clock: StageClock): void;
}

/** What the stage view needs from a theme once it has been built. */
export interface ThemeHooks {
  /**
   * A platform visual whose top-front edge, centred, sits at the local
   * origin: its front face lies on the gameplay plane (z = 0) and its depth
   * extends toward -z, so ledges and the collision line are the visible edge.
   */
  platform(spec: PlatformSpec): THREE.Object3D;
  /** The giant head of the Inferno; only that theme draws it. */
  gaze?(view: GazeView, clock: StageClock): void;
  /** Only themes for lava stages draw pools; createStageView routes lava stages to one. */
  lavaPool?(spec: LavaPoolSpec): LavaPoolVisual;
  update(clock: StageClock): void;
  /** Multiplier for unlit sprite cards so fighters sit in the scene's light. */
  readonly spriteTint: THREE.Color;
  /** Lighting variants (time of day), first is the default. */
  readonly moods: readonly string[];
  setMood(name: string): void;
}

export interface ThemeContext {
  readonly scene: THREE.Scene;
  /** World y of the main ground's top surface. */
  readonly groundTop: number;
  /** World x span of all solid ground. */
  readonly groundLeft: number;
  readonly groundRight: number;
}

export type StageTheme = (ctx: ThemeContext) => ThemeHooks;
