/** Actual item action/eat lease owns captured expression visibility, including
 * post-release/pre-restore. Natural presentation tails add no gameplay lock.
 * Common caller and native-frame -> raw-age mapping remain named adapters. */
import rawFacts from './linkItemContextEquipmentFacts.json';
import { parseLinkEquipmentState, type LinkEquipmentState } from './linkEquipment';
export type LinkItemContextMotion = keyof typeof rawFacts;
interface GearEvent { readonly sourceNativeMotionFrame: number; readonly sourceOrder: number;
  readonly sword?: 'normal' | 'back'; readonly shield?: 'normal' | 'back'; readonly sourceLine: number; }
interface MotionFact { readonly resource: string; readonly resourceSha256: string;
  readonly rawLastNativeIndex: number; readonly naturalBodySamples: number; readonly nativeDeclaredLoop: boolean;
  readonly nativeCancelFrame: number; readonly expressionFunction: string | null; readonly expressionSourceSha256: string | null;
  readonly events: readonly GearEvent[];
  /** Hammer expressions own gear only; the live Hammer actor remains the
   * body/loop clock owner. No natural tail is created for its constant entry. */
  readonly bodyRoutePolicy?: 'body-and-gear' | 'gear-only';
  readonly sourceClockPolicy?: 'constant-expression-entry' | 'selected-item-body-raw-plus-one';
  readonly expressionSelectionPrecision?: 'EXACT_CAPTURED_FUNCTION'; }
export const LINK_ITEM_CONTEXT_EQUIPMENT_FACTS = rawFacts as unknown as Readonly<Record<LinkItemContextMotion, MotionFact>>;
export interface LinkItemContextEquipmentState {
  readonly schema: 'link-item-context-equipment/1'; readonly generation: number; readonly actionId: string;
  readonly itemIdentity: string; readonly motion: LinkItemContextMotion; readonly facing: 1 | -1;
  readonly entryFrame: number; readonly lastFrame: number; readonly nativeMotionFrame: number;
  /** Supplied actual owning status rate, not inferred from natural length/FAF. */
  readonly motionRate: number; readonly phase: 'active' | 'tail'; readonly temporaryFood: boolean;
  readonly equipmentAtEntry: LinkEquipmentState;
}
function integer(v: unknown, p: string): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
  throw new TypeError(`${p} must be nonnegative integer`); return v; }
function positive(v: unknown, p: string): number { if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
  throw new TypeError(`${p} must be positive finite`); return v; }
function text(v: unknown, p: string): string { if (typeof v !== 'string' || !v.trim()) throw new TypeError(`${p} must be text`); return v; }
function fact(motion: unknown): MotionFact { if (typeof motion !== 'string' || !Object.hasOwn(LINK_ITEM_CONTEXT_EQUIPMENT_FACTS, motion))
  throw new TypeError('Uncaptured item equipment motion'); return LINK_ITEM_CONTEXT_EQUIPMENT_FACTS[motion as LinkItemContextMotion]; }
export function beginLinkItemContextEquipment(input: {
  readonly frame: number; readonly generation: number; readonly actionId: string; readonly itemIdentity: string;
  readonly motion: LinkItemContextMotion; readonly facing: 1 | -1; readonly nativeMotionFrame: number;
  readonly motionRate: number; readonly temporaryFood: boolean; readonly equipmentAtEntry: LinkEquipmentState;
}): LinkItemContextEquipmentState {
  const source = fact(input.motion);
  if (input.facing !== 1 && input.facing !== -1 || typeof input.temporaryFood !== 'boolean'
    || input.temporaryFood && !['item_light_eat', 'item_light_walk_eat'].includes(input.motion))
    throw new TypeError('Invalid item context admission');
  if (source.sourceClockPolicy === 'constant-expression-entry' && input.nativeMotionFrame !== 1)
    throw new TypeError('Gear-only expression entry keeps its own constant clock, never the wrapping body clock');
  return Object.freeze({ schema: 'link-item-context-equipment/1', generation: integer(input.generation, 'generation'),
    actionId: text(input.actionId, 'actionId'), itemIdentity: text(input.itemIdentity, 'itemIdentity'), motion: input.motion,
    facing: input.facing, entryFrame: integer(input.frame, 'frame'), lastFrame: input.frame,
    nativeMotionFrame: positive(input.nativeMotionFrame, 'nativeMotionFrame'), motionRate: positive(input.motionRate, 'motionRate'),
    phase: 'active', temporaryFood: input.temporaryFood, equipmentAtEntry: parseLinkEquipmentState(input.equipmentAtEntry) });
}
export interface LinkItemContextEquipmentStep {
  readonly frame: number; readonly generation: number; readonly clockAdvances: boolean;
  /** Supplied while the actual accepted action/eat owner is active. Tail uses
   * its already selected rate on advancing actor steps only. */
  readonly nativeMotionFrame: number | null; readonly controlEnded: boolean;
  readonly interruption: 'new-owner' | 'accepted-hit' | 'capture' | 'final' | 'stock-reset' | 'scene-reset' | null;
  readonly activeActionId: string | null;
}
export function stepLinkItemContextEquipment(state: LinkItemContextEquipmentState,
  input: LinkItemContextEquipmentStep): LinkItemContextEquipmentState | null {
  integer(input.frame, 'frame'); integer(input.generation, 'generation');
  if (typeof input.clockAdvances !== 'boolean' || typeof input.controlEnded !== 'boolean'
    || input.interruption !== null && !['new-owner', 'accepted-hit', 'capture', 'final', 'stock-reset', 'scene-reset'].includes(input.interruption))
    throw new TypeError('Item context clock/interruption must be explicit');
  if (input.generation !== state.generation || input.interruption !== null
    || input.activeActionId !== null && input.activeActionId !== state.actionId) return null;
  if (fact(state.motion).bodyRoutePolicy === 'gear-only' && input.controlEnded) return null;
  if (input.frame < state.lastFrame) throw new TypeError('Item context clock went backwards');
  const advances = input.clockAdvances && input.frame !== state.lastFrame;
  let nativeMotionFrame = state.nativeMotionFrame;
  const phase = state.phase === 'tail' || input.controlEnded ? 'tail' : 'active';
  if (input.nativeMotionFrame !== null) {
    const supplied = positive(input.nativeMotionFrame, 'nativeMotionFrame');
    if (fact(state.motion).sourceClockPolicy === 'constant-expression-entry' && supplied !== 1)
      throw new TypeError('Gear-only expression entry cannot borrow the body loop clock');
    if (supplied < nativeMotionFrame || !advances && supplied !== nativeMotionFrame)
      throw new TypeError('Item source clock advanced while frozen or went backwards');
    nativeMotionFrame = supplied;
  } else if (phase === 'active') throw new TypeError('Active item owner requires actual native clock');
  else if (advances) nativeMotionFrame += state.motionRate;
  const source = fact(state.motion);
  // The active gameplay owner may outlast its nonloop body extent; hold its
  // actual terminal drawing, never unlock based on animation length.
  if (phase === 'tail' && (source.nativeDeclaredLoop || nativeMotionFrame - 1 >= source.naturalBodySamples)) return null;
  return Object.freeze({ ...state, lastFrame: input.frame, nativeMotionFrame, phase });
}
export function selectLinkItemContextEquipment(state: LinkItemContextEquipmentState): {
  readonly ownsBodyRoute: boolean;
  readonly equipment: LinkEquipmentState; readonly route: { readonly motion: LinkItemContextMotion; readonly rawAge: number;
    readonly facing: 1 | -1; readonly terminal: true };
  readonly phase: 'active' | 'tail'; readonly actionId: string; readonly itemIdentity: string;
  readonly sourceIdentity: { readonly resource: string; readonly sha256: string };
  readonly lastAppliedExpressionNativeFrame: number | null;
} {
  const source = fact(state.motion); let equipment = { ...state.equipmentAtEntry };
  let lastAppliedExpressionNativeFrame: number | null = null;
  for (const event of source.events) if (event.sourceNativeMotionFrame <= state.nativeMotionFrame) {
    if (event.sword !== undefined) equipment.sword = event.sword;
    if (event.shield !== undefined) equipment.shield = event.shield;
    lastAppliedExpressionNativeFrame = event.sourceNativeMotionFrame;
  }
  // Named temporary-Food adapter: retain genuine transaction identity after
  // consumption; hidden existing weapon is restored from CURRENT inventory
  // only when this lease exits. Source Shieldnormal19 still wins inside lease.
  if (state.temporaryFood) equipment.heldItemVisible = false;
  return Object.freeze({ ownsBodyRoute: source.bodyRoutePolicy !== 'gear-only', equipment: Object.freeze(equipment), route: Object.freeze({ motion: state.motion,
    rawAge: state.nativeMotionFrame - 1, facing: state.facing, terminal: true }), phase: state.phase,
    actionId: state.actionId, itemIdentity: state.itemIdentity,
    sourceIdentity: Object.freeze({ resource: source.resource, sha256: source.resourceSha256 }), lastAppliedExpressionNativeFrame });
}
export function parseLinkItemContextEquipmentState(value: unknown, path = 'linkItemContext'): LinkItemContextEquipmentState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be object`);
  const r = value as Record<string, unknown>, keys = ['schema', 'generation', 'actionId', 'itemIdentity', 'motion', 'facing',
    'entryFrame', 'lastFrame', 'nativeMotionFrame', 'motionRate', 'phase', 'temporaryFood', 'equipmentAtEntry'];
  if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwn(r, k)) || r.schema !== 'link-item-context-equipment/1'
    || r.phase !== 'active' && r.phase !== 'tail') throw new TypeError(`${path} closed state invalid`);
  const source = fact(r.motion), initial = beginLinkItemContextEquipment({ frame: integer(r.entryFrame, `${path}.entryFrame`),
    generation: integer(r.generation, `${path}.generation`), actionId: text(r.actionId, `${path}.actionId`),
    itemIdentity: text(r.itemIdentity, `${path}.itemIdentity`), motion: r.motion as LinkItemContextMotion,
    facing: r.facing as 1 | -1, nativeMotionFrame: positive(r.nativeMotionFrame, `${path}.nativeMotionFrame`),
    motionRate: positive(r.motionRate, `${path}.motionRate`), temporaryFood: r.temporaryFood as boolean,
    equipmentAtEntry: parseLinkEquipmentState(r.equipmentAtEntry) });
  const lastFrame = integer(r.lastFrame, `${path}.lastFrame`);
  if (lastFrame < initial.entryFrame || r.phase === 'tail' && (source.bodyRoutePolicy === 'gear-only' || source.nativeDeclaredLoop || initial.nativeMotionFrame - 1 >= source.naturalBodySamples))
    throw new TypeError(`${path} expired/backwards lease`);
  return Object.freeze({ ...initial, lastFrame, phase: r.phase });
}
