/** Captured expressions follow real capture-action clocks. Natural continuation
 * after control unlock is interruptible and grants no gameplay lock. */
import {LINK_CAPTURE_ACTION_EQUIPMENT_FACTS,parseLinkCaptureActionEquipmentInput,type LinkCaptureActionEquipmentMotion} from './linkCaptureActionEquipment';
import type {LinkEquipmentState} from './linkEquipment';
export interface LinkCaptureEquipmentOwner {
 readonly motion:LinkCaptureActionEquipmentMotion;readonly rawAge:number;readonly facing:1|-1;
 readonly ownerKey:string;readonly groupKey:string;readonly captureKey:string|null;readonly entryFrame:number;readonly generation:number;
}
export interface LinkCaptureEquipmentLease extends LinkCaptureEquipmentOwner {
 readonly lastFrame:number;readonly phase:'control'|'tail';readonly equipmentAtEntry:LinkEquipmentState;
}
export function parseLinkCaptureEquipmentLease(value:unknown):LinkCaptureEquipmentLease|null {
 if(value===null)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Missing capture equipment lease');
 const s=value as LinkCaptureEquipmentLease,keys=['motion','rawAge','facing','ownerKey','groupKey','captureKey','entryFrame','generation','lastFrame','phase','equipmentAtEntry'];
 if(Object.keys(s).length!==keys.length||keys.some(k=>!Object.hasOwn(s,k))||
  ![s.rawAge,s.entryFrame,s.generation,s.lastFrame].every(Number.isSafeInteger)||s.rawAge<0||s.entryFrame<0||s.generation<0||s.lastFrame<s.entryFrame||
  ![1,-1].includes(s.facing)||typeof s.ownerKey!=='string'||!s.ownerKey||typeof s.groupKey!=='string'||!s.groupKey||
  s.captureKey!==null&&(typeof s.captureKey!=='string'||!s.captureKey)||!['control','tail'].includes(s.phase))throw new TypeError('Invalid actual capture lease identity/clock');
 const selected=parseLinkCaptureActionEquipmentInput({motion:s.motion,scriptNativeFrame:s.rawAge+1,equipmentAtEntry:s.equipmentAtEntry});
 if(s.phase==='tail'&&(s.motion==='catch_wait'||s.motion==='catch_pull'||s.motion==='catch_attack'||s.rawAge>=LINK_CAPTURE_ACTION_EQUIPMENT_FACTS[s.motion].nativeAsset.finalFrameIndex+1))
  throw new TypeError('Invalid capture continuation extent');
 return Object.freeze({...s,equipmentAtEntry:selected.equipmentAtEntry});
}
export function admitLinkCaptureEquipmentOwner(prior:LinkCaptureEquipmentLease|null,owner:LinkCaptureEquipmentOwner,
 frame:number,inventory:LinkEquipmentState,current:LinkEquipmentState):LinkCaptureEquipmentLease {
 const related=prior?.generation===owner.generation&&prior.groupKey===owner.groupKey;
 return parseLinkCaptureEquipmentLease({...owner,lastFrame:frame,phase:'control',equipmentAtEntry:related?current:inventory})!;
}
export function stepLinkCaptureEquipmentLease(state:LinkCaptureEquipmentLease|null,input:{frame:number;generation:number;clockAdvances:boolean;
 owner:LinkCaptureEquipmentOwner|null;interrupted:boolean}):LinkCaptureEquipmentLease|null {
 if(!state)return null;
 if(!Number.isSafeInteger(input.frame)||input.frame<0||!Number.isSafeInteger(input.generation)||input.generation<0||
  typeof input.clockAdvances!=='boolean'||typeof input.interrupted!=='boolean')throw new TypeError('Invalid capture equipment step');
 if(state.generation!==input.generation||input.interrupted)return null;
 if(input.frame<state.lastFrame)throw new RangeError('Restore capture equipment before rewind');
 if(input.owner){const owner=input.owner;
  if(owner.ownerKey!==state.ownerKey||owner.groupKey!==state.groupKey||owner.motion!==state.motion||owner.generation!==state.generation)return null;
  if(owner.rawAge<state.rawAge)throw new RangeError('Real capture owner clock moved backward');
  return parseLinkCaptureEquipmentLease({...state,...owner,lastFrame:input.frame,phase:'control'});
 }
 if(['catch_pull','catch_wait','catch_attack'].includes(state.motion))return null;
 const rawAge=state.rawAge+(input.clockAdvances&&input.frame>state.lastFrame?1:0),extent=LINK_CAPTURE_ACTION_EQUIPMENT_FACTS[state.motion].nativeAsset.finalFrameIndex+1;
 if(rawAge>=extent)return null;
 return parseLinkCaptureEquipmentLease({...state,rawAge,lastFrame:input.frame,phase:'tail'});
}
