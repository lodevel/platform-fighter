/** STAGED. Native Link Final body callback chronology, separate from flight
 * and combat. Camera/slow commands stay typed raw events until shared Scene
 * policies consume them; unknown commands are retained in canonical records.
 * No native cancel metadata is guessed into gameplay action end. */
import {advanceLinkSourceClock,type LinkSourceClock,type LinkSourceEvent} from './linkSourceClock';
import type {LinkEquipmentState} from './linkEquipment';
export type LinkAncientFinalEvent=
  |{readonly kind:'protection';readonly translucent:true}
  |{readonly kind:'slow-opponents';readonly rawFactor:30;readonly rawDuration:100}
  |{readonly kind:'stow';readonly sword:'back';readonly shield:'back';readonly heldItemVisible:false}
  |{readonly kind:'camera-cutin'}
  |{readonly kind:'camera-zoom-out'}
  |{readonly kind:'shoot-ancient-arrow'}
  |{readonly kind:'native-rate';readonly rate:.85}
  |{readonly kind:'restore-sword'|'restore-shield'}
  |{readonly kind:'complete';readonly equipmentBeforeEntry:LinkEquipmentState};
export interface LinkAncientFinalState {readonly sheet:'final'|'final_air';readonly clock:LinkSourceClock;
  readonly nativeAdvance:number;readonly equipmentBeforeEntry:LinkEquipmentState;}
export function parseLinkAncientFinalState(value:unknown):LinkAncientFinalState{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid Link Final checkpoint');
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==4||!['sheet','clock','nativeAdvance','equipmentBeforeEntry'].every(key=>Object.hasOwn(row,key))||
    row.sheet!=='final'&&row.sheet!=='final_air'||typeof row.nativeAdvance!=='number'||!Number.isFinite(row.nativeAdvance)||row.nativeAdvance<=0)
    throw new TypeError('Invalid Link Final sheet/rate');
  const clock=row.clock as Record<string,unknown>,equipment=row.equipmentBeforeEntry as Record<string,unknown>;
  if(!clock||typeof clock!=='object'||Array.isArray(clock)||Object.keys(clock).length!==2||
    typeof clock.gameplayAge!=='number'||!Number.isSafeInteger(clock.gameplayAge)||clock.gameplayAge<0||
    typeof clock.nativeFrame!=='number'||!Number.isFinite(clock.nativeFrame)||clock.nativeFrame<0)
    throw new TypeError('Invalid raw Link Final clock');
  if(!equipment||typeof equipment!=='object'||Array.isArray(equipment)||Object.keys(equipment).length!==5||
    typeof equipment.sword!=='string'||!['normal','back','hidden'].includes(equipment.sword)||typeof equipment.shield!=='string'||!['normal','back','hidden'].includes(equipment.shield)||
    typeof equipment.bow!=='string'||!['have','back','hidden'].includes(equipment.bow)||typeof equipment.heldItemVisible!=='boolean'||typeof equipment.ancientBowVisible!=='boolean')
    throw new TypeError('Invalid Link Final equipment lease');
  return Object.freeze({sheet:row.sheet,clock:Object.freeze({gameplayAge:clock.gameplayAge,nativeFrame:clock.nativeFrame}),nativeAdvance:row.nativeAdvance,
    equipmentBeforeEntry:Object.freeze({...equipment}) as unknown as LinkEquipmentState});
}
const CALLBACKS:readonly LinkSourceEvent<LinkAncientFinalEvent>[]=[
  {nativeFrame:0,sourceOrder:0,payload:{kind:'protection',translucent:true}},
  {nativeFrame:0,sourceOrder:1,payload:{kind:'slow-opponents',rawFactor:30,rawDuration:100}},
  {nativeFrame:0,sourceOrder:2,payload:{kind:'stow',sword:'back',shield:'back',heldItemVisible:false}},
  {nativeFrame:10,sourceOrder:0,payload:{kind:'camera-cutin'}},
  {nativeFrame:30,sourceOrder:0,payload:{kind:'camera-zoom-out'}},
  {nativeFrame:60,sourceOrder:0,payload:{kind:'shoot-ancient-arrow'}},
  {nativeFrame:70,sourceOrder:0,payload:{kind:'native-rate',rate:.85}},
  {nativeFrame:99,sourceOrder:0,payload:{kind:'restore-sword'}},
  {nativeFrame:102,sourceOrder:0,payload:{kind:'restore-shield'}},
];
function callbacks(sheet:LinkAncientFinalState['sheet']){
  return sheet==='final'?CALLBACKS:CALLBACKS.filter(event=>event.payload.kind!=='native-rate');
}
export function beginLinkAncientFinal(airborne:boolean,equipment:LinkEquipmentState,entryNativeAdvance:number):
  {state:LinkAncientFinalState;events:readonly LinkAncientFinalEvent[]}{
  if(!Number.isFinite(entryNativeAdvance)||entryNativeAdvance<=0)throw new RangeError('Explicit entry motion advance required');
  const sheet=airborne?'final_air':'final';
  // Final-only raw clock: entry samples0 and callback60 samples60. Ordinary
  // ordinal LinkSourceClock consumers remain unchanged.
  return{state:Object.freeze({sheet,clock:Object.freeze({gameplayAge:0,nativeFrame:0}),nativeAdvance:entryNativeAdvance,
    equipmentBeforeEntry:Object.freeze({...equipment})}),events:Object.freeze(callbacks(sheet).filter(event=>event.nativeFrame===0).map(event=>event.payload))};
}
export function stepLinkAncientFinal(state:LinkAncientFinalState,input:{readonly frozen:boolean;readonly nativeMotionEnded:boolean;}):
  {state:LinkAncientFinalState|null;events:readonly LinkAncientFinalEvent[]}{
  if(input.frozen)return{state,events:[]};
  const step=advanceLinkSourceClock(state.clock,{frozen:false,nativeFrameAdvance:state.nativeAdvance,events:callbacks(state.sheet)});
  let nativeAdvance=state.nativeAdvance;
  for(const event of step.events)if(event.kind==='native-rate')nativeAdvance=event.rate;
  if(input.nativeMotionEnded)return{state:null,events:[...step.events,{kind:'complete',equipmentBeforeEntry:state.equipmentBeforeEntry}]};
  return{state:Object.freeze({...state,clock:step.clock,nativeAdvance}),events:step.events};
}
