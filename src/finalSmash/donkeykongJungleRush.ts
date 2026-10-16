/** Source status split: Start→Attack only after HIT+TO_ATTACK37;
 * Attack native end133→End, End source rate.8 at30 (ground only).
 * Public combined209 remains a documented source/patch discrepancy. */
export interface JungleRushState {readonly phase:'start'|'success'|'end'|'done';readonly age:number;
  readonly nativeFrame:number;readonly nativeAdvance:number;readonly successAge:number|null;readonly airborne:boolean;readonly targets:readonly number[];}
export type JungleRushEvent=
  |{readonly kind:'begin-success';readonly targets:readonly number[]}
  |{readonly kind:'phase';readonly phase:'end'}
  |{readonly kind:'finish';readonly outcome:'hit'|'miss'};
export const JUNGLE_RUSH_SOURCE=Object.freeze({detectionFirstFrame:29,detectionLastFrame:34,
  detectionDamage:12,startNativeEnd:99,toAttackNativeFrame:37,attackNativeEnd:133,
  endGroundNativeEnd:89,endAirNativeEnd:49,endGroundCancel:70,endAirCancel:47,
  endGroundRateFrame:30,endGroundRate:.8,publicCombinedSuccessAnimationFrames:209,
  earlyDamage:1.2,earlyCount:18,lateDamage:1.1,lateCount:13,finisherDamage:14});
export function beginJungleRush(airborne:boolean):JungleRushState{
  return Object.freeze({phase:'start',age:0,nativeFrame:1,nativeAdvance:1,successAge:null,airborne,targets:[]});
}
export function jungleRushDetectionActive(state:JungleRushState):boolean{
  return state.phase==='start'&&state.age>=28&&state.age<=33;
}
/** HIT retains startup until native TO_ATTACK callback, never instantly runs
 * the first cutscene punch on a detector contact. SDK target7 is supporting
 * version-limited evidence; actual common target-array consumer unavailable. */
export function confirmJungleRushTargets(state:JungleRushState,targets:readonly number[]):
  {state:JungleRushState;events:readonly JungleRushEvent[]}{
  if(!jungleRushDetectionActive(state)||!targets.length)return{state,events:[]};
  const selected=[...new Set([...state.targets,...targets])].sort((a,b)=>a-b).slice(0,7);
  return{state:Object.freeze({...state,targets:selected}),events:[]};
}
export function jungleRushHitWindow(state:JungleRushState):
  {strikeId:string;packet:'early'|'late'|'finisher';damage:number}|null{
  const frame=state.age+1;
  if(state.phase==='success'){
    if(frame>=6&&frame<=75){const index=Math.floor((frame-6)/4);
      if(index<18&&(frame-6)%4<=1)return{strikeId:'early-'+index,packet:'early',damage:1.2};}
    if(frame>=79&&frame<=127&&(frame-79)%4===0)return{strikeId:'late-'+((frame-79)/4),packet:'late',damage:1.1};
  }
  // Source End hit native7..8; ordinal public offset132 corroborates139..140.
  return state.phase==='end'&&state.nativeFrame>=7&&state.nativeFrame<9?
    {strikeId:'finisher',packet:'finisher',damage:14}:null;
}
export function jungleRushCanCancel(state:JungleRushState):boolean{
  return state.phase==='end'&&(state.successAge??0)>=209&&state.nativeFrame>=(state.airborne?47:70);
}
export function stepJungleRush(state:JungleRushState,clockAdvances:boolean):
  {state:JungleRushState;events:readonly JungleRushEvent[]}{
  if(state.phase==='done'||!clockAdvances)return{state,events:[]};
  let nativeAdvance=state.nativeAdvance;
  const nativeFrame=state.phase==='end'?Math.min(state.airborne?49:89,state.nativeFrame+nativeAdvance):state.nativeFrame+nativeAdvance;
  if(state.phase==='end'&&!state.airborne&&nativeFrame>=30)nativeAdvance=.8;
  const next={...state,age:state.age+1,nativeFrame,nativeAdvance,
    successAge:state.successAge===null?null:state.successAge+1};
  if(state.phase==='start'&&state.targets.length&&nativeFrame>=37)
    return{state:Object.freeze({...next,phase:'success',age:0,nativeFrame:1,nativeAdvance:1,successAge:0}),
      events:[{kind:'begin-success',targets:state.targets}]};
  if(state.phase==='success'&&nativeFrame>=133)
    return{state:Object.freeze({...next,phase:'end',age:0,nativeFrame:1,nativeAdvance:1}),events:[{kind:'phase',phase:'end'}]};
  // Selected public209 mechanics owns actionability independently of body
  // End playback/rate. Scene retains any remaining native End as a free tail.
  const completeSuccess=next.successAge!==null&&next.successAge>=209;
  if((state.phase==='start'&&nativeFrame>=99)||completeSuccess)return{state:Object.freeze({...next,phase:'done'}),
    events:[{kind:'finish',outcome:state.targets.length?'hit':'miss'}]};
  return{state:Object.freeze(next),events:[]};
}
export const JUNGLE_RUSH_FINISHER_SOURCE=Object.freeze({damage:14,angle:70,base:90,growth:96,
  fixed:0,blockable:false,reflectable:false,direct:true});
