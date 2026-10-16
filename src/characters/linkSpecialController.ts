import type {ChargeSpec} from './chargeSchema';
/** STAGED. Published-clock bow/boomerang/bomb action reducers, independent of
 * native body resampling and anatomy. Events commit once beside action state;
 * no renderer clocks, old approximated projectile special or Bob-omb reuse. */
import {linkBowCharge,selectLinkBowVolley,type LinkArrowLaunchPlan} from './linkBow';
import {linkBoomerangEntry,type LinkBoomerangThrowKind} from './linkBoomerang';
import {linkRemoteBombEntry,type LinkRemoteBombState} from './linkRemoteBomb';
export type LinkSpecialState=
  |{readonly kind:'bow';readonly phase:'startup'|'charging'|'full-hold'|'release';readonly age:number;
    readonly chargeFrames:number;readonly fullHoldFrames:number;readonly doubleArrow:boolean;readonly volley:readonly LinkArrowLaunchPlan[]}
  |{readonly kind:'boomerang';readonly phase:'throw'|'failed'|'catch';readonly age:number;
    readonly throwKind:LinkBoomerangThrowKind;readonly firstActionable:number}
  |{readonly kind:'bomb';readonly phase:'generate'|'detonate';readonly age:number};
export type LinkSpecialEvent=
  |{readonly kind:'arrow';readonly plan:LinkArrowLaunchPlan}
  |{readonly kind:'consume-picked-arrow'}
  |{readonly kind:'boomerang';readonly throwKind:LinkBoomerangThrowKind;readonly angleDegrees?:number}
  |{readonly kind:'generate-bomb'}
  |{readonly kind:'detonate-bomb'}
  |{readonly kind:'complete';readonly action:LinkSpecialState['kind']};
export interface LinkSpecialStep {readonly state:LinkSpecialState|null;readonly events:readonly LinkSpecialEvent[];}
/** Explicit current authoring constraint: a latched DOUBLE END transaction
 * needs age3 to shoot/remove before control can leave END. Stock source29 is
 * unchanged. This minimum is an engine constraint, not native cancel proof. */
export function linkBowReleaseResidency(doubleArrow:boolean,timing?:{readonly activeFrames:number;readonly recoveryFrames:number}):number {
  return Math.max(doubleArrow?4:0,timing?timing.activeFrames+timing.recoveryFrames:29);
}
export function beginLinkBow(doubleArrow:boolean):LinkSpecialState{
  return Object.freeze({kind:'bow',phase:'startup',age:0,chargeFrames:0,fullHoldFrames:0,doubleArrow,volley:[]});
}
export function beginLinkBoomerang(hasOwnerArticle:boolean,grounded:boolean,throwKind:LinkBoomerangThrowKind):LinkSpecialState{
  const entry=linkBoomerangEntry(hasOwnerArticle,grounded);
  return Object.freeze({kind:'boomerang',phase:entry.kind,age:0,throwKind,firstActionable:entry.FAF});
}
export function beginLinkBoomerangCatch(otherwiseUncommitted:boolean):LinkSpecialState|null{
  return otherwiseUncommitted?Object.freeze({kind:'boomerang',phase:'catch',age:0,throwKind:'tilt',firstActionable:10}):null;
}
export function beginLinkBomb(ownerIndex:number,existing:LinkRemoteBombState|null,actorHoldingItem:boolean):LinkSpecialState|null{
  const entry=linkRemoteBombEntry(ownerIndex,existing,actorHoldingItem);
  return entry==='generate'||entry==='detonate'?Object.freeze({kind:'bomb',phase:entry,age:0}):null;
}
function releaseBow(state:Extract<LinkSpecialState,{kind:'bow'}>):LinkSpecialStep{
  const volley=selectLinkBowVolley(state.chargeFrames,state.doubleArrow);
  // Native admission latches DOUBLE without removing the physical Arrow.
  // The second-shot helper shoots first, then clears/removes held slot0.
  const events:LinkSpecialEvent[]=[{kind:'arrow',plan:volley[0]!}];
  return{state:Object.freeze({...state,phase:'release',age:0,volley}),events};
}
/** Explicit zero-startup authoring admission. Stock source timings never use
 * this path. It commits entry callbacks once without advancing native/body0;
 * callers enqueue its events only on actual successful action admission. */
export function admitLinkSpecial(state:LinkSpecialState,input:{readonly specialHeld:boolean;
  readonly timing:{readonly startupFrames:number;readonly activeFrames:number;readonly recoveryFrames:number}}):LinkSpecialStep {
  const startup=input.timing.startupFrames;
  if(state.kind==='bow'&&state.phase==='startup'&&startup===0)
    return input.specialHeld?{state:Object.freeze({...state,phase:'charging',age:0,chargeFrames:1}),events:[]}:releaseBow(state);
  if(state.kind==='boomerang'&&state.phase==='throw'&&startup===0)return{state,events:[{kind:'boomerang',throwKind:state.throwKind}]};
  if(state.kind==='bomb'&&(state.phase==='generate'?startup===0:startup<=5))
    return{state,events:[{kind:state.phase==='generate'?'generate-bomb':'detonate-bomb'}]};
  return{state,events:[]};
}
/** Startup public15frames and release age0 firstarrow(public16) are the
 * selected Wiki entry adapter, not native FT_MOTION_RATE(.8) division.
 * Observed36 charging frames enter selected full-hold residency. Native HOLD
 * counter starts separately; each accepted HOLD tick increments then compares
 * maxHOLD<=count (180). Public36→native HOLD entry is an approved clock adapter,
 * not a recovered exact motion/status normalization. */
export function stepLinkSpecial(state:LinkSpecialState,input:{readonly specialHeld:boolean;
  readonly clockAdvances:boolean;readonly charge?:Pick<ChargeSpec,'maxChargeFrames'|'maxHoldFrames'>;readonly timing?:{readonly startupFrames:number;readonly activeFrames:number;readonly recoveryFrames:number};}):LinkSpecialStep{
  if(!input.clockAdvances)return{state,events:[]};
  const age=state.age+1;
  if(state.kind==='bow'){
    if(state.phase==='startup'){
      if(age<(input.timing?.startupFrames??15))return{state:Object.freeze({...state,age}),events:[]};
      // The accepted frame16 held sample is the first charging tick; count it
      // here so36 charging samples occupy16..51 and a release at52 is FULL.
      return input.specialHeld?{state:Object.freeze({...state,phase:'charging',age:0,chargeFrames:1}),events:[]}:releaseBow(state);
    }
    if(state.phase==='charging'){
      if(!input.specialHeld)return releaseBow(state);
      const next=Object.freeze({...state,age,chargeFrames:state.chargeFrames+1});
      if(input.charge&&next.chargeFrames>=(input.charge.maxHoldFrames??input.charge.maxChargeFrames))return releaseBow(next);
      return next.chargeFrames>=(input.charge?.maxChargeFrames??36)?{state:Object.freeze({...next,phase:'full-hold',age:0,fullHoldFrames:0}),events:[]}:
        {state:next,events:[]};
    }
    if(state.phase==='full-hold'){
      if(!input.specialHeld)return releaseBow(state);
      const next=Object.freeze({...state,age,fullHoldFrames:state.fullHoldFrames+1,...(input.charge?{chargeFrames:state.chargeFrames+1}:{})});
      return (input.charge?next.chargeFrames>=(input.charge.maxHoldFrames??input.charge.maxChargeFrames):next.fullHoldFrames>=180)?releaseBow(next):{state:next,events:[]};
    }
    if(age>=linkBowReleaseResidency(state.doubleArrow,input.timing))return{state:null,events:[{kind:'complete',action:'bow'}]};
    const shots:LinkSpecialEvent[]=state.volley.filter(p=>p.releaseAge===age).map(plan=>({kind:'arrow',plan}));
    if(state.doubleArrow&&shots.some(event=>event.kind==='arrow'&&event.plan.arrowIndex===1))shots.push({kind:'consume-picked-arrow'});
    return{state:Object.freeze({...state,age}),events:shots};
  }
  if(state.kind==='boomerang'){
    const adjustedEnd=state.phase==='catch'?state.firstActionable:state.firstActionable+
      (input.timing?input.timing.startupFrames+input.timing.activeFrames+input.timing.recoveryFrames-45:0);
    if(age+1>=adjustedEnd)return{state:null,events:[{kind:'complete',action:'boomerang'}]};
    return{state:Object.freeze({...state,age}),events:state.phase==='throw'&&age===(input.timing?.startupFrames??26)?
      [{kind:'boomerang',throwKind:state.throwKind}]:[]};
  }
  if(age>=(input.timing?input.timing.startupFrames+input.timing.activeFrames+input.timing.recoveryFrames:39))return{state:null,events:[{kind:'complete',action:'bomb'}]};
  const release=input.timing?.startupFrames??16;
  return{state:Object.freeze({...state,age}),events:state.phase==='generate'&&age===release?[{kind:'generate-bomb'}]:
    state.phase==='detonate'&&age===Math.max(0,release-5)?[{kind:'detonate-bomb'}]:[]};
}
export function linkSpecialChargePresentation(state:LinkSpecialState|null):{ratio:number;full:boolean;fullHoldRemaining:number|null}|null{
  if(state?.kind!=='bow'||state.phase==='release')return null;
  const charge=linkBowCharge(state.chargeFrames);return{ratio:charge.ratio,full:charge.full,
    fullHoldRemaining:state.phase==='full-hold'?Math.max(0,180-state.fullHoldFrames):null};
}
