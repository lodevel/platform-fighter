/** Exact captured grab/capture/pummel/throw expressions; the genuine capture-action admission owns the clock.
 * Native common rate/initial part precedence remain explicit engine adapters. */
import facts from './linkCaptureActionEquipmentFacts.json';
import { parseLinkEquipmentState, type LinkEquipmentState } from './linkEquipment';

export const LINK_CAPTURE_ACTION_EQUIPMENT_FACTS = facts;
export type LinkCaptureActionEquipmentMotion = keyof typeof facts;
export interface LinkCaptureActionEquipmentInput {
  readonly motion: LinkCaptureActionEquipmentMotion;
  readonly scriptNativeFrame: number;
  readonly equipmentAtEntry: LinkEquipmentState;
}
export interface LinkCaptureActionEquipmentSelection {
  readonly motion: LinkCaptureActionEquipmentMotion;
  readonly equipment: LinkEquipmentState;
  readonly delta: Partial<LinkEquipmentState>;
  readonly policy: 'captured-capture-action-expression-script-clock';
  readonly source: { readonly function: string; readonly path: string; readonly sha256: string };
  readonly scriptNativeFramesApplied: readonly number[];
  readonly hasCapturedGearCommands: boolean;
}
export function parseLinkCaptureActionEquipmentInput(value: unknown, path = 'captureActionEquipment'): LinkCaptureActionEquipmentInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be object`);
  const row = value as Record<string, unknown>, keys = ['motion', 'scriptNativeFrame', 'equipmentAtEntry'];
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key)) ||
    typeof row.motion !== 'string' || !Object.hasOwn(facts, row.motion) ||
    typeof row.scriptNativeFrame !== 'number' || !Number.isFinite(row.scriptNativeFrame) || row.scriptNativeFrame < 0)
    throw new TypeError(`${path} requires exact grab/capture/pummel/throw motion and finite nonnegative SCRIPT age`);
  return Object.freeze({ motion: row.motion as LinkCaptureActionEquipmentMotion, scriptNativeFrame: row.scriptNativeFrame,
    equipmentAtEntry: parseLinkEquipmentState(row.equipmentAtEntry, `${path}.equipmentAtEntry`) });
}
export function selectLinkCaptureActionEquipment(input: LinkCaptureActionEquipmentInput): LinkCaptureActionEquipmentSelection {
  const parsed = parseLinkCaptureActionEquipmentInput(input), fact = facts[parsed.motion];
  const delta: Partial<{ sword: LinkEquipmentState['sword']; shield: LinkEquipmentState['shield'];
    bow: LinkEquipmentState['bow']; heldItemVisible: boolean; ancientBowVisible: boolean }> = {};
  const applied: number[] = [];
  for (const event of fact.events) {
    if (event.scriptNativeFrame > parsed.scriptNativeFrame) continue;
    Object.assign(delta, event.changes as Partial<LinkEquipmentState>);
    if (!applied.includes(event.scriptNativeFrame)) applied.push(event.scriptNativeFrame);
  }
  return Object.freeze({ motion: parsed.motion, equipment: Object.freeze({ ...parsed.equipmentAtEntry, ...delta }),
    delta: Object.freeze(delta), policy: 'captured-capture-action-expression-script-clock', source: Object.freeze({ ...fact.source }),
    scriptNativeFramesApplied: Object.freeze(applied), hasCapturedGearCommands: fact.events.length > 0 });
}
