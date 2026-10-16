/** Exact captured intrinsic expression deltas on the actual selected source
 * body clock. Tail/admission/interrupt ownership is the actor's lease; source
 * common cancel/rate/default equipment precedence remain separate limits. */
import facts from './linkIntrinsicEquipmentFacts.json';
import { parseLinkEquipmentState, type LinkEquipmentState } from './linkEquipment';
export type LinkIntrinsicEquipmentMotion = keyof typeof facts;
export interface LinkIntrinsicEquipmentInput {
  readonly motion: LinkIntrinsicEquipmentMotion; readonly rawAge: number;
  readonly equipmentAtEntry: LinkEquipmentState; readonly bowArticlePresent: boolean;
}
export interface LinkIntrinsicEquipmentSelection {
  readonly equipment: LinkEquipmentState;
  readonly delta: Partial<LinkEquipmentState>;
  readonly policy: 'captured-intrinsic-expression-source-clock';
  readonly source: { readonly function: string; readonly path: string; readonly sha256: string };
  readonly sourceNativeMotionFramesApplied: readonly number[];
  readonly hasCapturedGearCommands: boolean;
}
export function parseLinkIntrinsicEquipmentInput(value: unknown, path='intrinsicEquipment'): LinkIntrinsicEquipmentInput {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${path} must be object`);
  const row=value as Record<string,unknown>,keys=['motion','rawAge','equipmentAtEntry','bowArticlePresent'];
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key))||
    typeof row.motion!=='string'||!Object.hasOwn(facts,row.motion)||
    typeof row.rawAge!=='number'||!Number.isFinite(row.rawAge)||row.rawAge<0||typeof row.bowArticlePresent!=='boolean')
    throw new TypeError(`${path} invalid actual motion/source clock`);
  return Object.freeze({motion:row.motion as LinkIntrinsicEquipmentMotion,rawAge:row.rawAge,
    equipmentAtEntry:parseLinkEquipmentState(row.equipmentAtEntry),bowArticlePresent:row.bowArticlePresent});
}
export function selectLinkIntrinsicEquipment(input: LinkIntrinsicEquipmentInput): LinkIntrinsicEquipmentSelection {
  const parsed=parseLinkIntrinsicEquipmentInput(input),fact=facts[parsed.motion];
  const delta: Partial<{sword:LinkEquipmentState['sword'];shield:LinkEquipmentState['shield'];bow:LinkEquipmentState['bow'];
    heldItemVisible:boolean;ancientBowVisible:boolean}>={};
  const applied:number[]=[];
  for(const event of fact.events){
    if(event.sourceNativeMotionFrame>parsed.rawAge)continue;
    let used=false;
    const changes=event.changes as Partial<LinkEquipmentState>;
    for(const key of ['sword','shield','heldItemVisible','ancientBowVisible'] as const){
      if(changes[key]!==undefined){Object.assign(delta,{[key]:changes[key]});used=true;}
    }
    // Captured change_status_exist is conditional on a genuine own article.
    // No back/HAVE placement is fabricated from a bone name/default palette.
    if(changes.bow!==undefined&&parsed.bowArticlePresent){delta.bow=changes.bow;used=true;}
    if(used&&!applied.includes(event.sourceNativeMotionFrame))applied.push(event.sourceNativeMotionFrame);
  }
  return Object.freeze({equipment:Object.freeze({...parsed.equipmentAtEntry,...delta}),delta:Object.freeze(delta),
    policy:'captured-intrinsic-expression-source-clock',source:Object.freeze({...fact.source}),
    sourceNativeMotionFramesApplied:Object.freeze(applied),hasCapturedGearCommands:fact.events.length>0});
}
