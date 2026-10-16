/** Captured normal gear callbacks use SCRIPT age, independently of reviewed
 * body pose samples. Real admission/tail/interrupt clocks belong to the actor. */
import facts from './linkNormalEquipmentFacts.json';
import { parseLinkEquipmentState, type LinkEquipmentState } from './linkEquipment';
export const LINK_NORMAL_EQUIPMENT_FACTS = facts;
export type LinkNormalEquipmentId = keyof typeof facts;
export interface LinkNormalEquipmentInput {
  readonly id: LinkNormalEquipmentId;
  readonly scriptNativeFrame: number;
  readonly equipmentAtEntry: LinkEquipmentState;
}
export interface LinkNormalEquipmentSelection {
  readonly motion: string;
  readonly equipment: LinkEquipmentState;
  readonly delta: Partial<LinkEquipmentState>;
  readonly policy: 'captured-normal-expression-script-clock';
  readonly source: { readonly function: string; readonly path: string; readonly sha256: string };
  readonly scriptNativeFramesApplied: readonly number[];
  readonly guardedCallbacksNotApplied: readonly { readonly sourceLine: number; readonly scriptNativeFrame: number; readonly guard: string }[];
  readonly hasCapturedGearCommands: boolean;
}
export function parseLinkNormalEquipmentInput(value: unknown, path = 'normalEquipment'): LinkNormalEquipmentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be object`);
  const row = value as Record<string, unknown>, keys = ['id', 'scriptNativeFrame', 'equipmentAtEntry'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) ||
    typeof row.id !== 'string' || !Object.hasOwn(facts, row.id) ||
    typeof row.scriptNativeFrame !== 'number' || !Number.isFinite(row.scriptNativeFrame) || row.scriptNativeFrame < 0)
    throw new TypeError(`${path} requires exact known source ID and finite nonnegative SCRIPT age`);
  return Object.freeze({ id: row.id as LinkNormalEquipmentId, scriptNativeFrame: row.scriptNativeFrame,
    equipmentAtEntry: parseLinkEquipmentState(row.equipmentAtEntry, `${path}.equipmentAtEntry`) });
}
export function selectLinkNormalEquipment(input: LinkNormalEquipmentInput): LinkNormalEquipmentSelection {
  const parsed = parseLinkNormalEquipmentInput(input), fact = facts[parsed.id];
  const delta: Partial<{ sword: LinkEquipmentState['sword']; shield: LinkEquipmentState['shield'];
    bow: LinkEquipmentState['bow']; heldItemVisible: boolean; ancientBowVisible: boolean }> = {};
  const applied: number[] = [], guarded: { sourceLine: number; scriptNativeFrame: number; guard: string }[] = [];
  for (const event of fact.events) {
    if (event.scriptNativeFrame > parsed.scriptNativeFrame) continue;
    if (event.guard !== null) {
      // Sole guarded event repeats false0. Its value remains unchanged, but
      // this pure source selector cannot assert the native WorkFlag executed.
      guarded.push(Object.freeze({ sourceLine: event.sourceLine, scriptNativeFrame: event.scriptNativeFrame, guard: event.guard }));
      continue;
    }
    Object.assign(delta, event.changes as Partial<LinkEquipmentState>);
    if (!applied.includes(event.scriptNativeFrame)) applied.push(event.scriptNativeFrame);
  }
  return Object.freeze({ motion: fact.motion, equipment: Object.freeze({ ...parsed.equipmentAtEntry, ...delta }),
    delta: Object.freeze(delta), policy: 'captured-normal-expression-script-clock', source: Object.freeze({ ...fact.source }),
    scriptNativeFramesApplied: Object.freeze(applied), guardedCallbacksNotApplied: Object.freeze(guarded),
    hasCapturedGearCommands: fact.events.length > 0 });
}
/** Only the actual owner knows whether this normal transaction is unheld.
 * Keep this authored motion placement separate from captured event deltas. */
export function selectLinkNormalMotionGearOverride(input: { readonly id: LinkNormalEquipmentId; readonly unheld: boolean }) {
  if (!input || typeof input !== 'object' || Object.keys(input).length !== 2 ||
    !Object.hasOwn(facts, input.id) || typeof input.unheld !== 'boolean')
    throw new TypeError('Normal motion gear requires exact source ID and actual unheld ownership');
  if (input.id !== 'link.bair' || !input.unheld) return null;
  return Object.freeze({ changes: Object.freeze({ shield: 'back' as const }),
    gearOwner: Object.freeze({ kind: 'authored-motion-gear' as const,
      policyId: 'SOURCE_GUIDED_BAIR_EXCLUSIVE_BACK_SHIELD' as const,
      supportingSourceSha256: 'caf38c5a6e7d176ae8b387a1339a82e9e72bc50bb56beb92ae779d7446d3368b' }),
    sourceReceipt: 'source-contracts/bair-motion-equipment-selection-v1.json' as const,
    nativeCommonPartPrecedenceRecovered: false as const });
}
