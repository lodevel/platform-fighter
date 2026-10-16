import type {ChargeSpec} from './chargeSchema';
import type {LinkSpinTiming} from './linkSpinTiming';
/** STAGED. Ground/air Ultimate Spin with separate startup/hold/release clocks.
 * Wiki release-local4..36/FAF74 wins; native grounded hold losing support exits
 * ordinary FALL rather than inventing a charged aerial recovery. */
export interface LinkSpinState {readonly phase:'ground-start'|'ground-hold'|'ground-release'|'air'|'helpless'|'done';
  readonly age:number;readonly chargeFrames:number;readonly damageMultiplier:number;}
export type LinkSpinEvent=
  |{readonly kind:'phase';readonly phase:LinkSpinState['phase']}
  |{readonly kind:'fall'|'helpless'|'complete'}
  |{readonly kind:'land';readonly lagFrames:30}
  |{readonly kind:'initial-air-velocity';readonly velocityYNativeUp:2.4};
export const LINK_SPIN_SOURCE=Object.freeze({chargeEntryAfterFrames:3,maximumChargeFrames:60,
  maximumDamageMultiplier:1.6,releaseFAF:74,releaseAnimationFrames:91,airAnimationFrames:91,
  frontLedgeFirstFrame:15,backLedgeFirstFrame:34,jostleOffFirstFrame:26,jostleOffLastFrame:49,
  airEndingAttributesFrame:48,landingLag:30});
export function beginLinkSpin(grounded:boolean):{state:LinkSpinState;events:readonly LinkSpinEvent[]}{
  return{state:Object.freeze({phase:grounded?'ground-start':'air',age:0,chargeFrames:0,damageMultiplier:1}),
    events:grounded?[]:[{kind:'initial-air-velocity',velocityYNativeUp:2.4}]};
}
export function releaseLinkSpin(state:LinkSpinState):LinkSpinState{
  return Object.freeze({...state,phase:'ground-release',age:0,
    damageMultiplier:1+(Math.min(60,state.chargeFrames)/60)*.6});
}
/** Zero startup is an explicit authoring admission, not a source clock. */
export function admitLinkSpin(state:LinkSpinState,input:{specialHeld:boolean;timing:Pick<LinkSpinTiming,'groundStart'>}):{state:LinkSpinState;events:readonly LinkSpinEvent[]}{
  if(state.phase!=='ground-start'||input.timing.groundStart!==0)return{state,events:[]};
  const next=input.specialHeld?Object.freeze({...state,phase:'ground-hold' as const,age:0}):releaseLinkSpin(state);
  return{state:next,events:[{kind:'phase',phase:next.phase}]};
}
export function stepLinkSpin(state:LinkSpinState,input:{readonly grounded:boolean;readonly specialHeld:boolean;
  readonly clockAdvances:boolean;readonly nativeMotionEnded:boolean;readonly charge?:Pick<ChargeSpec,'maxChargeFrames'|'maxHoldFrames'>;readonly timing?:Pick<LinkSpinTiming,'groundStart'|'groundReleaseStartup'|'groundActive'|'groundRecovery'>;}):{state:LinkSpinState;events:readonly LinkSpinEvent[]}{
  if(state.phase==='done'||!input.clockAdvances)return{state,events:[]};const age=state.age+1;
  if((state.phase==='ground-start'||state.phase==='ground-hold')&&!input.grounded)
    return{state:Object.freeze({...state,phase:'done'}),events:[{kind:'fall'}]};
  if((state.phase==='air'||state.phase==='helpless')&&input.grounded)
    return{state:Object.freeze({...state,phase:'done'}),events:[{kind:'land',lagFrames:30}]};
  if(state.phase==='ground-start'&&age>=(input.timing?.groundStart??3)){
    const next=input.specialHeld?Object.freeze({...state,phase:'ground-hold' as const,age:0}):releaseLinkSpin(state);
    return{state:next,events:[{kind:'phase',phase:next.phase}]};
  }
  if(state.phase==='ground-hold'){
    const next=Object.freeze({...state,age,chargeFrames:state.chargeFrames+(input.specialHeld?1:0)});
    if(!input.specialHeld||input.nativeMotionEnded||next.chargeFrames>=(input.charge?.maxHoldFrames??input.charge?.maxChargeFrames??60)){
      const release=releaseLinkSpin(next);return{state:release,events:[{kind:'phase',phase:release.phase}]};}
    return{state:next,events:[]};
  }
  if(state.phase==='ground-release'&&age>=(input.timing?input.timing.groundReleaseStartup+input.timing.groundActive+input.timing.groundRecovery:73))
    return{state:Object.freeze({...state,phase:'done'}),events:[{kind:'complete'}]};
  if(state.phase==='air'&&input.nativeMotionEnded)
    return{state:Object.freeze({...state,phase:'helpless',age:0}),events:[{kind:'helpless'}]};
  return{state:Object.freeze({...state,age}),events:[]};
}
export function linkSpinWindow(state:LinkSpinState):{group:string;strike:string}|null{
  const frame=state.age+1;
  if(state.phase==='ground-release')return frame>=4&&frame<=5?{group:'clean',strike:'ground-spin'}:
    frame>=6&&frame<=10?{group:'mid',strike:'ground-spin'}:
    frame>=11&&frame<=20?{group:'late',strike:'ground-spin'}:
    frame>=21&&frame<=36?{group:'latest',strike:'ground-spin'}:null;
  if(state.phase!=='air')return null;
  const windows=[[8,9,'front1'],[12,13,'back1'],[16,17,'front2'],[19,20,'back2'],
    [22,23,'front3'],[26,27,'back3'],[31,32,'front4'],[38,39,'back4'],
    [47,47,'final-early'],[48,48,'final-mid'],[49,49,'final-late']] as const;
  const window=windows.find(([first,last])=>frame>=first&&frame<=last);
  return window?{group:window[2],strike:frame>=47?'final':window[2]}:null;
}
export function linkAirSpinContactPolicy(state:LinkSpinState){
  if(state.phase!=='air')return null;const frame=state.age+1;
  return Object.freeze({frontLedge:frame>=15,backLedge:frame>=34,jostle:frame<26||frame>49,landingLag:30});
}
