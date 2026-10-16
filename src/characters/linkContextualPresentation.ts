/** Actual spawn/KO/support receipts -> source-only presentation leases.
 * Common probability/edge thresholds/clock callers are not recovered. The
 * explicit coordinator-selected adapters add no physics, damage or RNG.
 * Receipt: source-contracts/contextual-presentation-selection.json. */
export const LINK_CONTEXTUAL_SOURCE = Object.freeze({
  entryRawEnd: 120, entrySampleCount: 121,
  entryParasailRemoveRawFrame: 100, entryShieldNormalRawFrame: 76, entrySwordNormalRawFrame: 77,
  cameraHitRawEnd: 45, cameraHitSampleCount: 46,
  edgeEntryRawEnd: 9, edgeEntrySampleCount: 10, edgeWaitRawEnd: 100,
  walkoffRawEnd: 26, walkoffSampleCount: 27,
  dropThroughRawEnd: 30, dropThroughSampleCount: 31,
});
export interface LinkContextualRoute { readonly motion: string; readonly rawAge: number;
  readonly facing: 1 | -1; readonly terminal: boolean; }
interface Lease { readonly generation: number; readonly entryFrame: number;
  readonly lastFrame: number; readonly rawAge: number; readonly facing: 1 | -1; }
export interface LinkEntryPresentationState extends Lease { readonly side: 'left' | 'right'; }
/** All121 strict Trans matrices of captured j00entryr are identity translation.
 * Entry movement is present in posed Hip, not this source root track. Both
 * selected mirrored-side projections therefore have zero Trans displacement.
 * Do not add Hip displacement to an already-posed drawing as a second path.
 * Source receipt contextual-presentation-selection.json records every sample. */
export function linkEntrySourceTransDisplacement(rawNativeIndex: number, side: 'left' | 'right') {
  if (!Number.isSafeInteger(rawNativeIndex) || rawNativeIndex < 0 || rawNativeIndex > LINK_CONTEXTUAL_SOURCE.entryRawEnd
    || side !== 'left' && side !== 'right') throw new TypeError('Invalid Entry source sample/side');
  return Object.freeze({ x: 0, y: 0 });
}
export interface LinkScreenKoPresentationState extends Lease {
  readonly playerIndex: number; readonly koFrame: number;
  readonly acceptedKoPosition: { readonly x: number; readonly y: number };
}
export interface LinkSupportPresentationState extends Lease {
  readonly kind: 'edge-entry' | 'edge-wait' | 'walkoff' | 'drop-through';
  readonly supportBodyId: number;
}
function integer(n: number, name: string): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${name} must be nonnegative integer`);
  return n;
}
function facing(n: number): 1 | -1 {
  if (n !== 1 && n !== -1) throw new TypeError('Invalid contextual entry facing');
  return n;
}
function beginLease(input: { frame: number; generation: number; facing: 1 | -1 }): Lease {
  return { generation: integer(input.generation, 'generation'), entryFrame: integer(input.frame, 'frame'),
    lastFrame: input.frame, rawAge: 0, facing: facing(input.facing) };
}
export interface LinkContextualStep {
  readonly frame: number; readonly generation: number; readonly clockAdvances: boolean;
  readonly interrupted: boolean;
}
function clock(state: Lease, input: LinkContextualStep): number | null {
  integer(input.frame, 'frame'); integer(input.generation, 'generation');
  if (typeof input.clockAdvances !== 'boolean' || typeof input.interrupted !== 'boolean')
    throw new TypeError('Contextual clock/interruption must be explicit');
  if (state.generation !== input.generation || input.interrupted) return null;
  if (input.frame < state.lastFrame) throw new TypeError('Contextual clock went backwards');
  return state.rawAge + (input.clockAdvances && input.frame !== state.lastFrame ? 1 : 0);
}
/** Actual initial-match countdown only. Respawn is an ordinary revival-wait
 * event, not evidence that the Parasail entrance is performed again. */
export function beginLinkEntryPresentation(input: { readonly frame: number; readonly generation: number;
  readonly facing: 1 | -1; readonly side: 'left' | 'right'; readonly reason: 'match-start' | 'respawn';
}): LinkEntryPresentationState | null {
  const lease = beginLease(input);
  if (input.side !== 'left' && input.side !== 'right' || input.reason !== 'match-start' && input.reason !== 'respawn')
    throw new TypeError('Invalid actual entry event');
  return input.reason === 'respawn' ? null : Object.freeze({ ...lease, side: input.side });
}
export function stepLinkEntryPresentation(state: LinkEntryPresentationState, input: LinkContextualStep & {
  readonly gameplayStarted: boolean;
}): LinkEntryPresentationState | null {
  if (typeof input.gameplayStarted !== 'boolean') throw new TypeError('Real match-start transition required');
  // The intro accumulator is distinct from the still-zero gameplay frame.
  // Actual start clears its lease before entering the gameplay clock domain.
  if (input.gameplayStarted) { integer(input.frame, 'frame'); integer(input.generation, 'generation'); return null; }
  const age = clock(state, input);
  return age === null || age >= LINK_CONTEXTUAL_SOURCE.entrySampleCount ? null
    : Object.freeze({ ...state, rawAge: age, lastFrame: input.frame });
}
export function selectLinkEntryPresentation(state: LinkEntryPresentationState): LinkContextualRoute {
  return Object.freeze({ motion: state.side === 'left' ? 'entry_l' : 'entry_r',
    rawAge: state.rawAge, facing: state.facing, terminal: true });
}
/** Single owned article visual; body-only entrance does not provide Parasail.
 * Exact held-item/initial article creation status caller remains unrecovered. */
export function linkEntryEquipment(state: LinkEntryPresentationState) {
  return Object.freeze({ parasailVisible: state.rawAge < LINK_CONTEXTUAL_SOURCE.entryParasailRemoveRawFrame,
    // Both captured EntryL/EntryR game callbacks select article entry_r.
    // Actor entry side/facing is separate from the article resource identity.
    parasailMotion: 'entry_r' as const,
    sword: state.rawAge < LINK_CONTEXTUAL_SOURCE.entrySwordNormalRawFrame ? 'back' as const : 'normal' as const,
    shield: state.rawAge < LINK_CONTEXTUAL_SOURCE.entryShieldNormalRawFrame ? 'back' as const : 'normal' as const });
}
/** Detached visual receipt, after real top-blast-zone KO AND accepted stock
 * loss. It survives that old actor being hidden; no victim state is restored. */
export function beginLinkScreenKoPresentation(input: {
  readonly frame: number; readonly generation: number; readonly facing: 1 | -1;
  readonly playerIndex: number; readonly koFrame: number; readonly position: { readonly x: number; readonly y: number };
  readonly direction: 'top' | 'bottom' | 'left' | 'right'; readonly acceptedStockLoss: boolean;
}): LinkScreenKoPresentationState | null {
  const lease = beginLease(input);
  integer(input.playerIndex, 'playerIndex'); integer(input.koFrame, 'koFrame');
  if (!Number.isFinite(input.position.x) || !Number.isFinite(input.position.y)
    || typeof input.acceptedStockLoss !== 'boolean' || !['top', 'bottom', 'left', 'right'].includes(input.direction))
    throw new TypeError('Invalid real ScreenKO receipt');
  if (input.direction !== 'top' || !input.acceptedStockLoss) return null;
  return Object.freeze({ ...lease, playerIndex: input.playerIndex, koFrame: input.koFrame,
    acceptedKoPosition: Object.freeze({ ...input.position }) });
}
/** Generation here identifies the DETACHED KO lease. A later actor respawn
 * generation must not accidentally erase it; Scene teardown/explicit interrupt
 * clears it, while actual global pause freezes this advancing resource clock. */
export function stepLinkScreenKoPresentation(state: LinkScreenKoPresentationState,
  input: LinkContextualStep): LinkScreenKoPresentationState | null {
  const age = clock(state, input);
  return age === null || age >= LINK_CONTEXTUAL_SOURCE.cameraHitSampleCount ? null
    : Object.freeze({ ...state, rawAge: age, lastFrame: input.frame });
}
export function selectLinkScreenKoPresentation(state: LinkScreenKoPresentationState): LinkContextualRoute {
  return Object.freeze({ motion: 'camera_hit', rawAge: state.rawAge, facing: state.facing, terminal: true });
}
export interface LinkActiveSupportObservation {
  readonly bodyId: number; readonly left: number; readonly right: number; readonly floorY: number;
  readonly actorRootX: number;
  /** Scene derives from actual contact/paired support data. Numeric near-edge
   * calibration is explicitly authored; this leaf does not invent a distance. */
  readonly nearEdge: boolean; readonly inwardSupport: boolean;
}
function support(o: LinkActiveSupportObservation): void {
  integer(o.bodyId, 'support bodyId');
  if (![o.left, o.right, o.floorY, o.actorRootX].every(Number.isFinite) || o.left > o.right
    || typeof o.nearEdge !== 'boolean' || typeof o.inwardSupport !== 'boolean')
    throw new TypeError('Invalid real active support');
}
export function beginLinkEdgePresentation(input: { readonly frame: number; readonly generation: number;
  readonly facing: 1 | -1; readonly grounded: boolean; readonly uncommitted: boolean;
  readonly support: LinkActiveSupportObservation;
}): LinkSupportPresentationState | null {
  const lease = beginLease(input); support(input.support);
  const o = input.support;
  if (!input.grounded || !input.uncommitted || !o.nearEdge || !o.inwardSupport
    || o.actorRootX < o.left || o.actorRootX > o.right) return null;
  return Object.freeze({ ...lease, kind: 'edge-entry', supportBodyId: o.bodyId });
}
export function beginLinkWalkoffPresentation(input: { readonly frame: number; readonly generation: number;
  readonly facing: 1 | -1; readonly previousSupportBodyId: number;
  readonly previousSupported: boolean; readonly grounded: boolean; readonly uncommitted: boolean;
  readonly actualJump: boolean; readonly actualDropThrough: boolean;
}): LinkSupportPresentationState | null {
  const lease = beginLease(input); integer(input.previousSupportBodyId, 'previous support');
  if (!input.previousSupported || input.grounded || !input.uncommitted || input.actualJump) return null;
  return Object.freeze({ ...lease, kind: input.actualDropThrough ? 'drop-through' : 'walkoff',
    supportBodyId: input.previousSupportBodyId });
}
export function stepLinkSupportPresentation(state: LinkSupportPresentationState, input: LinkContextualStep & {
  readonly grounded: boolean; readonly uncommitted: boolean; readonly support: LinkActiveSupportObservation | null;
}): LinkSupportPresentationState | null {
  const age = clock(state, input);
  if (age === null || !input.uncommitted) return null;
  if (state.kind === 'edge-entry' || state.kind === 'edge-wait') {
    const o = input.support;
    if (o) support(o);
    if (!input.grounded || !o || o.bodyId !== state.supportBodyId || !o.nearEdge || !o.inwardSupport
      || o.actorRootX < o.left || o.actorRootX > o.right) return null;
    return Object.freeze({ ...state, kind: state.kind === 'edge-entry' && age >= LINK_CONTEXTUAL_SOURCE.edgeEntrySampleCount
      ? 'edge-wait' : state.kind, rawAge: state.kind === 'edge-entry' && age >= LINK_CONTEXTUAL_SOURCE.edgeEntrySampleCount ? 0 : age,
      lastFrame: input.frame });
  }
  const end = state.kind === 'walkoff' ? LINK_CONTEXTUAL_SOURCE.walkoffSampleCount : LINK_CONTEXTUAL_SOURCE.dropThroughSampleCount;
  return input.grounded || age >= end ? null : Object.freeze({ ...state, rawAge: age, lastFrame: input.frame });
}
export function selectLinkSupportPresentation(state: LinkSupportPresentationState): LinkContextualRoute {
  const motion = state.kind === 'edge-entry' ? 'ottotto' : state.kind === 'edge-wait' ? 'ottotto_wait'
    : state.kind === 'walkoff' ? 'miss_foot' : 'pass';
  return Object.freeze({ motion, rawAge: state.rawAge, facing: state.facing, terminal: state.kind !== 'edge-wait' });
}

export interface LinkContextualPresentationState {
  readonly generation: number; readonly lastObservedFrame: number | null;
  readonly entry: LinkEntryPresentationState | null;
  readonly support: LinkSupportPresentationState | null;
  readonly previousSupportBodyId: number | null;
  readonly previousSupported: boolean;
}
export function beginLinkContextualPresentation(input: Parameters<typeof beginLinkEntryPresentation>[0]): LinkContextualPresentationState {
  return Object.freeze({ generation: input.generation, lastObservedFrame: null,
    entry: beginLinkEntryPresentation(input), support: null, previousSupportBodyId: null, previousSupported: false });
}
export interface LinkContextualObservation extends LinkContextualStep {
  readonly facing: 1 | -1; readonly grounded: boolean; readonly uncommitted: boolean;
  readonly gameplayStarted: boolean; readonly actualJump: boolean; readonly actualDropThrough: boolean;
  readonly support: LinkActiveSupportObservation | null;
}
/** Once after real actor input/admission, using actual contact/support data.
 * Generation reset without a new entry notification never fabricates Entry. */
export function observeLinkContextualPresentation(state: LinkContextualPresentationState,
  input: LinkContextualObservation): LinkContextualPresentationState {
  integer(input.frame, 'contextual frame'); integer(input.generation, 'contextual generation'); facing(input.facing);
  for (const field of ['clockAdvances', 'interrupted', 'grounded', 'uncommitted', 'gameplayStarted', 'actualJump', 'actualDropThrough'] as const)
    if (typeof input[field] !== 'boolean') throw new TypeError(`Contextual ${field} must be explicit boolean`);
  if (input.support) support(input.support);
  const current: LinkContextualPresentationState = state.generation === input.generation ? state
    : { generation: input.generation, lastObservedFrame: null, entry: null, support: null,
      previousSupportBodyId: null, previousSupported: false };
  if (current.lastObservedFrame === input.frame) return current;
  if (current.lastObservedFrame !== null && input.frame < current.lastObservedFrame) throw new TypeError('Contextual observer frame reversed');
  const phaseInput = { ...input, interrupted: input.interrupted || !input.uncommitted };
  const entry = current.entry ? stepLinkEntryPresentation(current.entry, phaseInput) : null;
  let supported = current.support ? stepLinkSupportPresentation(current.support, phaseInput) : null;
  if (!entry && !supported && !phaseInput.interrupted && input.clockAdvances) {
    if (input.grounded && input.support) supported = beginLinkEdgePresentation({ ...input, support: input.support });
    else if (current.previousSupported && current.previousSupportBodyId !== null)
      supported = beginLinkWalkoffPresentation({ ...input, previousSupported: true,
        previousSupportBodyId: current.previousSupportBodyId });
  }
  // Freeze actual prior-support observation with the simulation clock so a
  // paused render cannot manufacture an edge-loss transition on resume.
  return Object.freeze({ generation: input.generation, lastObservedFrame: input.frame, entry, support: supported,
    previousSupported: input.clockAdvances ? input.grounded && input.support !== null : current.previousSupported,
    previousSupportBodyId: input.clockAdvances ? input.grounded ? input.support?.bodyId ?? null : null : current.previousSupportBodyId });
}
export function selectLinkContextualPresentation(state: LinkContextualPresentationState): LinkContextualRoute | null {
  return state.entry ? selectLinkEntryPresentation(state.entry)
    : state.support ? selectLinkSupportPresentation(state.support) : null;
}
function object(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !keys.includes(k)) || keys.some(k => !Object.prototype.hasOwnProperty.call(r, k)))
    throw new TypeError(`${path} requires exactly the contextual fields`);
  return r;
}
function savedInteger(value: unknown, path: string): number {
  if (typeof value !== 'number') throw new TypeError(`${path} must be number`);
  return integer(value, path);
}
function parseLease(r: Record<string, unknown>, path: string): Lease {
  const generation = savedInteger(r.generation, `${path}.generation`), entryFrame = savedInteger(r.entryFrame, `${path}.entryFrame`),
    lastFrame = savedInteger(r.lastFrame, `${path}.lastFrame`), rawAge = savedInteger(r.rawAge, `${path}.rawAge`);
  if (lastFrame < entryFrame || rawAge > lastFrame - entryFrame) throw new TypeError(`${path} has impossible clock order`);
  if (r.facing !== 1 && r.facing !== -1) throw new TypeError(`${path}.facing must be actual latched facing`);
  return { generation, entryFrame, lastFrame, rawAge, facing: r.facing };
}
const LEASE_FIELDS = ['generation', 'entryFrame', 'lastFrame', 'rawAge', 'facing'] as const;
export function parseLinkEntryPresentationState(value: unknown, path = 'contextual.entry'): LinkEntryPresentationState {
  const r = object(value, path, [...LEASE_FIELDS, 'side']), lease = parseLease(r, path);
  if (r.side !== 'left' && r.side !== 'right' || lease.rawAge >= LINK_CONTEXTUAL_SOURCE.entrySampleCount)
    throw new TypeError(`${path} has invalid Entry side/age`);
  return Object.freeze({ ...lease, side: r.side });
}
export function parseLinkSupportPresentationState(value: unknown, path = 'contextual.support'): LinkSupportPresentationState {
  const r = object(value, path, [...LEASE_FIELDS, 'kind', 'supportBodyId']), lease = parseLease(r, path);
  if (r.kind !== 'edge-entry' && r.kind !== 'edge-wait' && r.kind !== 'walkoff' && r.kind !== 'drop-through')
    throw new TypeError(`${path}.kind is invalid`);
  const limit = r.kind === 'edge-entry' ? 10 : r.kind === 'walkoff' ? 27 : r.kind === 'drop-through' ? 31 : null;
  if (limit !== null && lease.rawAge >= limit) throw new TypeError(`${path} nonloop age exceeds selected lease`);
  return Object.freeze({ ...lease, kind: r.kind, supportBodyId: savedInteger(r.supportBodyId, `${path}.supportBodyId`) });
}
export function parseLinkScreenKoPresentationState(value: unknown, path = 'screenKO'): LinkScreenKoPresentationState {
  const r = object(value, path, [...LEASE_FIELDS, 'playerIndex', 'koFrame', 'acceptedKoPosition']), lease = parseLease(r, path);
  const p = object(r.acceptedKoPosition, `${path}.acceptedKoPosition`, ['x', 'y']);
  if (typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || lease.rawAge >= 46) throw new TypeError(`${path} position/age is invalid`);
  const koFrame = savedInteger(r.koFrame, `${path}.koFrame`);
  if (koFrame > lease.entryFrame) throw new TypeError(`${path} must follow accepted KO`);
  return Object.freeze({ ...lease, playerIndex: savedInteger(r.playerIndex, `${path}.playerIndex`), koFrame,
    acceptedKoPosition: Object.freeze({ x: p.x, y: p.y }) });
}
export function parseLinkContextualPresentationState(value: unknown,
  path = 'contextual'): LinkContextualPresentationState {
  const r = object(value, path, ['generation', 'lastObservedFrame', 'entry', 'support', 'previousSupportBodyId', 'previousSupported']);
  const generation = savedInteger(r.generation, `${path}.generation`);
  const lastObservedFrame = r.lastObservedFrame === null ? null : savedInteger(r.lastObservedFrame, `${path}.lastObservedFrame`);
  const entry = r.entry === null ? null : parseLinkEntryPresentationState(r.entry, `${path}.entry`);
  const support = r.support === null ? null : parseLinkSupportPresentationState(r.support, `${path}.support`);
  const previousSupportBodyId = r.previousSupportBodyId === null ? null : savedInteger(r.previousSupportBodyId, `${path}.previousSupportBodyId`);
  if (typeof r.previousSupported !== 'boolean' || r.previousSupported !== (previousSupportBodyId !== null)
    || entry !== null && entry.generation !== generation || support !== null && support.generation !== generation
    || entry !== null && support !== null || lastObservedFrame !== null &&
      (entry !== null && entry.lastFrame > lastObservedFrame || support !== null && support.lastFrame > lastObservedFrame))
    throw new TypeError(`${path} has inconsistent generation/support/phase clock`);
  return Object.freeze({ generation, lastObservedFrame, entry, support, previousSupportBodyId, previousSupported: r.previousSupported });
}
