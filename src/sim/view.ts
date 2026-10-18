import type { ShieldState } from '../characters/shieldState';
import type { SimulationAnimationSnapshot } from '../characters/simulationSpriteAnimation';
import type { CharacterId } from '../types';
import type { ItemSocketAxis } from '../characters/heldItemSocket';
import type { ShieldBubbleParry } from '../ui/shieldBubbleFormat';
import type { CameraTarget } from '../camera/cameraFraming';
import type { HudView } from './hudView';
import type { OrdinaryProjectileVisualRecipe } from '../characters/ordinaryProjectileCheckpoint';

/**
 * Render-facing simulation state (STEP5-DESIGN §4, `SimView`): plain data
 * MatchSim produces every frame for the Three.js match view, HUD and probes.
 * Grown field by field as the view consumes it; ids let the view diff
 * spawns and despawns, so a re-simulated rewind redraws correctly.
 *
 * Filled by MatchSim.view() (step 6).
 */
export interface FighterView {
  readonly playerIndex: number;
  readonly characterId: CharacterId;
  readonly paletteIndex: number;
  /** Body centre, design px. */
  readonly position: { readonly x: number; readonly y: number };
  /** Authoritative source root and sockets, independent of visual route choice. */
  readonly sourceRoot?: { readonly x: number; readonly y: number };
  readonly poseAttachments?: readonly {
    readonly id: string;
    readonly space: 'body' | 'root' | 'world';
    readonly position: { readonly x: number; readonly y: number };
    readonly rotation?: number;
  }[];
  readonly equipment?: readonly string[];
  readonly facing: 1 | -1;
  /** What the fighter is doing, for the art selector (`captureSimulationAnimation`). */
  readonly animation: SimulationAnimationSnapshot;
  /** Blinking (respawn invincibility). */
  readonly invincible: boolean;
  readonly eliminated: boolean;
  /** Body box from the fighter's tuning, design px (drives shield and charge sizes). */
  readonly body: { readonly width: number; readonly height: number };
  /** Attack charge 0..1 while a chargeable move winds up, else null. */
  readonly chargeProgress: number | null;
  /** Shield state machine snapshot, its max health, and a running parry. */
  readonly shield: { readonly state: ShieldState; readonly maxHealth: number; readonly parry: ShieldBubbleParry | null;
    readonly centre?: { readonly x: number; readonly y: number }; readonly activeRadius?: number } | null;
}

export interface ItemView {
  readonly id: number;
  readonly type: string;
  /** Texture key and on-screen size from the item's `visual`. */
  readonly spriteKey: string;
  readonly width: number;
  readonly height: number;
  readonly position: { readonly x: number; readonly y: number };
  /** Radians, clockwise on screen. */
  readonly angle: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly frame?: number;
  readonly flipX?: boolean;
  readonly alpha?: number;
  readonly visible?: boolean;
  readonly generatedKind?: string;
  /** Generated articles are rooted at their model bottom, not their sprite centre. */
  readonly rootPosition?: { readonly x: number; readonly y: number };
  /**
   * In a fighter's hand: the holder, the socket axis the sprite points along (`y` blades and bats, `z` gun barrels)
   * and whether it turns with the hand. The placement above is the gameplay grip; a view drawing the holder from
   * other art may re-place the sprite at that art's grip (display only).
   */
  readonly held?: { readonly playerIndex: number; readonly socketAxis: ItemSocketAxis; readonly turns: boolean };
}

export interface ProjectileView {
  readonly id: number;
  readonly moveId: string;
  /** Centre and size of its real hit area, design px. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly facing: 1 | -1;
  readonly visualRecipe?: OrdinaryProjectileVisualRecipe;
  readonly visualFacing?: 1 | -1;
  readonly angle?: number;
  readonly artFrame?: number;
  readonly artPosition?: { readonly x: number; readonly y: number };
  /** The same drawing as a character package effect action, placed at `artPosition`. */
  readonly art?: EffectArtView;
}

/**
 * An effect drawn from a character package: what `evaluate(pkg, { action, tick, facing })` shows,
 * with the drawing's root at the sprite's position and its own scale times `scaleX`/`scaleY`
 * (the cue's enlargement; the Ancient Arrow's draw-back stretch). The game keeps deciding where and when.
 */
export interface EffectArtView {
  readonly characterId: string; readonly action: string; readonly tick: number; readonly facing: 1 | -1;
  readonly scaleX?: number; readonly scaleY?: number;
}

/** Fully selected authored art, free of a renderer's texture or object types. */
export interface PresentationSpriteView {
  readonly key: string; readonly frame?: number; readonly x: number; readonly y: number;
  readonly originX?: number; readonly originY?: number; readonly scaleX?: number; readonly scaleY?: number;
  readonly rotation?: number; readonly alpha?: number; readonly depth?: number; readonly flipX?: boolean;
  readonly space?: 'world' | 'screen';
  /** The same art from the fighter's character package. */
  readonly art?: EffectArtView;
}
export interface TrapView {
  readonly x: number; readonly y: number; readonly armDelay: number;
  readonly framesSinceSpawn: number; readonly detonated: boolean; readonly fused: boolean;
}

export interface ExplosionView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  /** The real damage radius, design px. */
  readonly radius: number;
  /** 0 at the blast, 1 when it is over. */
  readonly progress: number;
  /** A visual recipe only; radius and lifetime remain the real source damage area. */
  readonly visualRecipe?: 'ancient-arrow';
  readonly phase?: 'fly' | 'fighter-blast' | 'terrain-blast';
  readonly facing?: 1 | -1;
}

/**
 * One-shots of this frame (STEP5-DESIGN §4): what state cannot carry.
 * Grown as the view consumes them; `sfx` is Character's existing sfx sink.
 */
export type SimEvent = import('./simEvents').SimEvent | { readonly kind: 'ko'; readonly playerIndex: number };

export interface SimView {
  readonly frame: number;
  readonly stageId: string;
  /** Stage hazards stop while match-end presentation keeps advancing. */
  readonly stageFrame?:number;
  readonly platforms?:ReadonlyArray<{readonly id:string;readonly x:number;readonly y:number;readonly width:number;readonly height:number;readonly active:boolean}>;
  readonly fighters: ReadonlyArray<FighterView>;
  readonly knockoutFlights?:ReadonlyArray<import('./knockoutFlight').KnockoutFlightView>;
  readonly items: ReadonlyArray<ItemView>;
  readonly projectiles: ReadonlyArray<ProjectileView>;
  readonly explosions: ReadonlyArray<ExplosionView>;
  readonly camera: { readonly targets: ReadonlyArray<CameraTarget>; readonly finalAnchor: { readonly x: number; readonly y: number } | null };
  readonly hud: HudView;
  readonly events: ReadonlyArray<SimEvent>;
  readonly presentationSprites?: ReadonlyArray<PresentationSpriteView>;
  readonly traps?: ReadonlyArray<TrapView>;
  readonly smashBall?: { readonly x: number; readonly y: number; readonly radius: number; readonly receivingRadius: number; readonly heavy: boolean } | null;
  readonly spawnPlatforms?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly alpha: number }>;
  readonly specialEffects?: ReadonlyArray<{readonly kind:string;readonly x:number;readonly y:number;readonly age:number}>;
  readonly debugAreas?: ReadonlyArray<import('../fx/hitboxDebugFormat').HitboxDebugBox>;
}
