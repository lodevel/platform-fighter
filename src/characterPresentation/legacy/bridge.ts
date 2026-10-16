import type {
  AppearanceAttachment, AppearanceRequest, PresentationFacing, PresentationPass,
  PresentationPoint, PresentationProfileIdentity,
} from '../contracts';
import { resolveSimulationAction, type SimulationAnimationSnapshot } from '../../characters/simulationSpriteAnimation';
import type { FighterView } from '../../sim/view';
import type { KnockoutFlightView } from '../../sim/knockoutFlight';
import { legacyPresentationProfile } from './profiles';

// The large compatibility snapshot is intentionally absent from the portable
// request, its serialized form, and all computed backend inputs.
const animations = new WeakMap<AppearanceRequest, SimulationAnimationSnapshot>();
const flights = new WeakMap<AppearanceRequest, KnockoutFlightView>();

export interface LegacyAppearanceOptions {
  readonly actorId?: string;
  readonly profile?: PresentationProfileIdentity;
  readonly restoreGeneration?: number;
  readonly actionInstanceId?: string;
  /** The captured SimView frame owns host-only blinking. */
  readonly displayTick?: number;
  readonly tint?: number;
  readonly depth?: number;
  readonly pass?: PresentationPass;
  readonly attachments?: readonly AppearanceAttachment[];
}

export interface LegacyPreviewAppearanceInput extends LegacyAppearanceOptions {
  readonly characterId: string;
  readonly action?: string;
  readonly phase?: string;
  readonly age?: number;
  readonly tick?: number;
  readonly position: PresentationPoint;
  readonly anchor?: 'root' | 'body';
  readonly facing?: PresentationFacing;
  readonly paletteIndex?: number;
  readonly zoom?: number;
  readonly rotation?: number;
  readonly alpha?: number;
  readonly visible?: boolean;
  readonly frozen?: boolean;
  readonly hitlag?: boolean;
}

export function createLegacyPreviewAppearanceRequest(input: LegacyPreviewAppearanceInput): AppearanceRequest {
  const profile = input.profile ?? legacyPresentationProfile(input.characterId);
  const actorId = input.actorId ?? `preview:${input.characterId}`;
  const action = input.action ?? 'idle';
  const position = { ...input.position };
  return {
    actorId, characterId: input.characterId, profile: { id: profile.id, revision: profile.revision },
    action: { id: action, instanceId: input.actionInstanceId ?? `${actorId}:${action}`, phase: input.phase ?? 'preview',
      clock: { domain: 'preview-ticks', tick: input.tick ?? input.age ?? 0, age: input.age ?? 0, rate: 60 },
      frozen: input.frozen ?? false, hitlag: input.hitlag ?? false },
    transform: { position, ...(input.anchor === 'body' ? {} : { root: position }), facing: input.facing ?? 1,
      scale: { x: input.zoom ?? 1, y: input.zoom ?? 1 }, rotation: input.rotation ?? 0 },
    palette: { index: input.paletteIndex ?? 0, tint: input.tint ?? 0xffffff },
    visibility: { visible: input.visible ?? true, alpha: input.alpha ?? 1 },
    attachments: input.attachments ?? [], equipment: [], context: {},
    restoreGeneration: input.restoreGeneration ?? 0, order: input.depth ?? 0, pass: input.pass ?? 'world',
  };
}

export interface LegacySnapshotAppearanceInput extends LegacyAppearanceOptions {
  readonly position: PresentationPoint;
  readonly sourceRoot?: PresentationPoint;
  readonly equipment?: readonly string[];
  readonly paletteIndex?: number;
  readonly visible?: boolean;
  readonly alpha?: number;
}

/** Translate only semantic state/time. The original sample convention and all
 * legacy context remain private and are consumed unchanged by the sprite path. */
export function createLegacySnapshotAppearanceRequest(
  snapshot: SimulationAnimationSnapshot, input: LegacySnapshotAppearanceInput,
): AppearanceRequest {
  const action = resolveSimulationAction(snapshot);
  const preview = createLegacyPreviewAppearanceRequest({ ...input, characterId: snapshot.characterId,
    action: action.state, phase: snapshot.finalSmash?.phase ?? action.phase ?? snapshot.activeAttack?.phase ?? 'body',
    age: action.frame ?? snapshot.frame, tick: snapshot.frame, anchor: 'body', facing: snapshot.facing,
    frozen: snapshot.frozen, hitlag: snapshot.hitlagRemaining > 0 });
  const request: AppearanceRequest = { ...preview, action: { ...preview.action,
    clock: { ...preview.action.clock, domain: action.frame === undefined ? 'simulation-ticks' : 'action-age' } },
    transform: { ...preview.transform, ...(input.sourceRoot ? { root: { ...input.sourceRoot } } : {}) },
    attachments: (input.attachments ?? []).map(attachment => ({ ...attachment, position: { ...attachment.position } })),
    equipment: [...(input.equipment ?? [])],
    context: { grounded: snapshot.grounded, destroyed: snapshot.destroyed },
  };
  animations.set(request, snapshot);
  return request;
}

export function createLegacyMatchAppearanceRequest(fighter: FighterView, options: LegacyAppearanceOptions = {}): AppearanceRequest {
  return createLegacySnapshotAppearanceRequest(fighter.animation, {
    ...options, actorId: options.actorId ?? `fighter:${fighter.playerIndex}`, position: fighter.position,
    sourceRoot: fighter.sourceRoot, attachments: options.attachments ?? fighter.poseAttachments, equipment: fighter.equipment,
    paletteIndex: fighter.paletteIndex, visible: !fighter.eliminated,
    alpha: fighter.invincible && fighter.animation.finalSmash?.role !== 'owner' && Math.floor((options.displayTick ?? fighter.animation.frame) / 4) % 2 === 0 ? .4 : 1,
  });
}

/** Semantic action runs need an instance-local history: hitlag and source rate
 * changes mean frame-minus-age is not a stable action identity. */
export function createLegacyAppearanceBridge() {
  const actors = new Map<string, { state: string; age: number; tick: number; generation: number; run: number | null; sequence: number }>();
  return {
    match(fighter: FighterView, options: LegacyAppearanceOptions = {}): AppearanceRequest {
      const actorId = options.actorId ?? `fighter:${fighter.playerIndex}`;
      const snapshot = fighter.animation, action = resolveSimulationAction(snapshot);
      const age = action.frame ?? snapshot.frame, generation = options.restoreGeneration ?? 0;
      const run = snapshot.finalSmash?.runId ?? null, previous = actors.get(actorId);
      const changed = !previous || previous.state !== action.state || previous.generation !== generation ||
        previous.run !== run || snapshot.frame < previous.tick || age < previous.age;
      const sequence = previous ? previous.sequence + (changed ? 1 : 0) : 0;
      actors.set(actorId, { state: action.state, age, tick: snapshot.frame, generation, run, sequence });
      return createLegacyMatchAppearanceRequest(fighter, { ...options, actorId,
        actionInstanceId: options.actionInstanceId ?? `${actorId}:${generation}:${sequence}` });
    },
    reset(): void { actors.clear(); },
    dispose(): void { actors.clear(); },
  };
}

export function createLegacyFlightAppearanceRequest(flight: KnockoutFlightView, options: LegacyAppearanceOptions = {}): AppearanceRequest {
  const request = createLegacyPreviewAppearanceRequest({ ...options,
    actorId: options.actorId ?? `knockout:${flight.playerIndex}`, characterId: flight.characterId,
    action: 'tumble', phase: 'knockout-flight', age: flight.age, position: flight.sourceRoot, facing: flight.facing,
    paletteIndex: flight.paletteIndex, zoom: flight.scale, rotation: flight.rotation, alpha: flight.alpha,
    depth: options.depth ?? 15,
  });
  flights.set(request, flight);
  return request;
}

/** Only the legacy backend should use these compatibility accessors. */
export function readLegacyAnimation(request: AppearanceRequest): SimulationAnimationSnapshot | undefined { return animations.get(request); }
export function readLegacyFlight(request: AppearanceRequest): KnockoutFlightView | undefined { return flights.get(request); }
