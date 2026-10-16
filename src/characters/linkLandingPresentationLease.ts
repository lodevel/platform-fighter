/** Actual landing-owned visual/equipment clock. Captured extents are from
 * source-contracts/landing-equipment-context-crossread-v1.json. Rate1 and
 * interruptible post-control continuation are explicit common-clock adapters. */
import {parseLinkLandingEquipmentInput,type LinkLandingEquipmentMotion} from './linkLandingEquipment';
import type {LinkEquipmentState} from './linkEquipment';
export const LINK_LANDING_SOURCE_MOTIONS:Readonly<Record<string,LinkLandingEquipmentMotion>>={
 'link.nair':'landing_air_n','link.fair':'landing_air_f','link.bair':'landing_air_b','link.uair':'landing_air_hi','link.dair':'landing_air_lw'};
const EXTENTS:Readonly<Record<LinkLandingEquipmentMotion,number>>={landing_air_n:96,landing_air_f:46,landing_air_b:66,landing_air_hi:41,landing_air_lw:86};
export interface LinkLandingPresentationLease {
 readonly motion:LinkLandingEquipmentMotion;readonly origin:{readonly moveId:string;readonly sourcePoseId:string;readonly entryFrame:number;readonly generation:number};
 readonly lastFrame:number;readonly rawAge:number;readonly facing:1|-1;readonly landingLagFrames:number;
 readonly phase:'control'|'tail';readonly equipmentAtEntry:LinkEquipmentState;
}
export function parseLinkLandingPresentationLease(value:unknown):LinkLandingPresentationLease|null {
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Missing actual landing presentation lease');
 const s=value as LinkLandingPresentationLease,keys=['motion','origin','lastFrame','rawAge','facing','landingLagFrames','phase','equipmentAtEntry'];
 if(Object.keys(s).length!==keys.length||keys.some(k=>!Object.hasOwn(s,k))||!s.origin||Object.keys(s.origin).length!==4||
  !['moveId','sourcePoseId','entryFrame','generation'].every(k=>Object.hasOwn(s.origin,k))||typeof s.origin.moveId!=='string'||!s.origin.moveId||typeof s.origin.sourcePoseId!=='string'||
  LINK_LANDING_SOURCE_MOTIONS[s.origin.sourcePoseId]!==s.motion||
  ![s.origin.entryFrame,s.origin.generation,s.lastFrame,s.rawAge,s.landingLagFrames].every(Number.isSafeInteger)||
  s.origin.entryFrame<0||s.origin.generation<0||s.lastFrame<s.origin.entryFrame||s.rawAge<0||s.landingLagFrames<1||
  ![1,-1].includes(s.facing)||!['control','tail'].includes(s.phase)||s.phase==='tail'&&s.rawAge>=EXTENTS[s.motion])
  throw new TypeError('Invalid landing origin/clock/status');
 const parsed=parseLinkLandingEquipmentInput({motion:s.motion,scriptNativeFrame:s.rawAge,equipmentAtEntry:s.equipmentAtEntry});
 return Object.freeze({...s,origin:Object.freeze({...s.origin}),equipmentAtEntry:parsed.equipmentAtEntry});
}
export function beginLinkLandingPresentationLease(input:{frame:number;generation:number;moveId:string;sourcePoseId:string|null;
 facing:1|-1;landingLagFrames:number;equipmentAtEntry:LinkEquipmentState}):LinkLandingPresentationLease|null {
 const motion=input.sourcePoseId?LINK_LANDING_SOURCE_MOTIONS[input.sourcePoseId]:undefined;if(!motion)return null;
 return parseLinkLandingPresentationLease({motion,origin:{moveId:input.moveId,sourcePoseId:input.sourcePoseId,entryFrame:input.frame,generation:input.generation},
  lastFrame:input.frame,rawAge:0,facing:input.facing,landingLagFrames:input.landingLagFrames,phase:'control',equipmentAtEntry:input.equipmentAtEntry});
}
export function stepLinkLandingPresentationLease(state:LinkLandingPresentationLease|null,input:{frame:number;generation:number;clockAdvances:boolean;
 controlActive:boolean;interrupted:boolean}):LinkLandingPresentationLease|null {
 if(!state)return null;
 if(!Number.isSafeInteger(input.frame)||input.frame<0||!Number.isSafeInteger(input.generation)||input.generation<0||
  ![input.clockAdvances,input.controlActive,input.interrupted].every(v=>typeof v==='boolean'))throw new TypeError('Invalid actual landing step');
 if(state.origin.generation!==input.generation||input.interrupted)return null;
 if(input.frame<state.lastFrame)throw new RangeError('Restore actual landing lease before rewind');
 const rawAge=state.rawAge+(input.frame>state.lastFrame&&input.clockAdvances?1:0);
 if(!input.controlActive&&rawAge>=EXTENTS[state.motion])return null;
 return Object.freeze({...state,lastFrame:input.frame,rawAge,phase:input.controlActive?'control':'tail'});
}
