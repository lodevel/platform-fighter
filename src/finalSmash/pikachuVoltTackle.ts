/** STAGED. Ultimate automated Final with registered primary status laws.
 * Body/source-root positions and substatus ticks are supplied by Scene. Native
 * camera callee/angle convention/scheduler limits remain explicit policies. */
export interface VoltPoint {readonly x:number;readonly y:number;}
export interface VoltTacklePolicy {readonly startupFrames:number;readonly finishRecoveryFrames:number;
  readonly missRecoveryFrames:number;readonly pixelsPerUnit:number;readonly simulationViewportAspect:number;}
export type VoltPhase='startup'|'dash'|'hit'|'attack'|'attack2'|'attack-finish'|'return'|'finish'|'miss'|'done';
export interface VoltTackleState {readonly phase:VoltPhase;readonly age:number;readonly motionAge:number;readonly totalReflections:number;
  readonly attack2Counter:number;readonly vortexFramesRemaining:number;readonly firstTarget:number|null;
  readonly hitTargets:readonly number[];readonly airborne:boolean;readonly facing:1|-1;
  readonly savedHitPosition:VoltPoint|null;readonly clipBounds:VoltCameraBounds|null;
  readonly velocity:VoltPoint;readonly reflectAngleDegrees:number;}
export type VoltTackleEvent=
  |{readonly kind:'phase';readonly phase:VoltPhase}
  |{readonly kind:'lock'|'direct-contact';readonly target:number}
  |{readonly kind:'velocity';readonly velocity:VoltPoint}
  |{readonly kind:'snap';readonly position:VoltPoint}
  |{readonly kind:'finish-hit';readonly damage:20}
  |{readonly kind:'complete';readonly outcome:'hit'|'miss'};
export const VOLT_TACKLE_SOURCE=Object.freeze({startupDamage:.3,startupRehitFrames:6,
  startupNativeFirstFrame:10,startupTransitionDamage:1,startupTransitionNativeFrames:[47,49],
  dashSpeedNative:8,dashFrames:16,dashCliffNoStopFrames:6,dashBrakeNative:.09,
  missSpeedNative:3,groundMissMotionRate:.7,
  vortexFrames:120,vortexSpeedNative:20,returnSnapDistanceNative:20,returnMaximumStatusFrame:30,
  groundRayLengthNative:20,savedHitGroundOffsetNative:20,
  // Pinned SDK constant paired with actual append caller; SDK/NRO version
  // equivalence remains a source limitation, not a one-target authoring rule.
  targetCapacity:7,
  dashDamage:1,dashRadiusNative:13,dashRehitFrames:50,loopDamage:1.5,loopRadiusNative:13,
  loopFinishRadiusNative:16,loopRehitFrames:50,finisherDamage:20,finisherRadiusNative:32,
  finisherLocalFrames:[10,11],noRecoil:true});
export function beginVoltTackle(airborne:boolean,facing:1|-1):VoltTackleState{
  return Object.freeze({phase:'startup',age:0,motionAge:0,totalReflections:0,attack2Counter:0,vortexFramesRemaining:120,
    firstTarget:null,hitTargets:[],airborne,facing,savedHitPosition:null,clipBounds:null,velocity:{x:0,y:0},reflectAngleDegrees:90});
}
/** Caller supplies real fighter HIT/normal-hit-status candidates in sweep order.
 * First victim is route anchor; source-backed plural array cap is7. */
export function confirmVoltTackleTargets(state:VoltTackleState,eligibleTargets:readonly number[],
  savedHitPosition:VoltPoint,policy:VoltTacklePolicy):{state:VoltTackleState;events:readonly VoltTackleEvent[]}{
  if(state.phase!=='dash'&&state.phase!=='hit')return{state,events:[]};
  const hitTargets=[...state.hitTargets],events:VoltTackleEvent[]=[];
  let firstTarget=state.firstTarget;
  for(const target of eligibleTargets){
    if(hitTargets.includes(target)||hitTargets.length>=VOLT_TACKLE_SOURCE.targetCapacity)continue;
    hitTargets.push(target);events.push({kind:'direct-contact',target});
    if(firstTarget===null){firstTarget=target;events.push({kind:'lock',target});}
  }
  if(hitTargets.length===state.hitTargets.length)return{state,events:[]};
  if(state.phase==='dash')events.push({kind:'phase',phase:'hit'});
  return{state:Object.freeze({...state,phase:'hit',age:state.phase==='hit'?state.age:0,motionAge:state.phase==='hit'?state.motionAge:0,firstTarget,
    hitTargets,savedHitPosition:state.savedHitPosition??Object.freeze({...savedHitPosition}),
    clipBounds:state.clipBounds??voltClipBounds(savedHitPosition,policy),velocity:{x:0,y:0}}),events};
}
function normalized(vector:VoltPoint,speed:number,fallback:VoltPoint):VoltPoint{
  const candidate=Math.hypot(vector.x,vector.y)>0?vector:fallback;
  const length=Math.hypot(candidate.x,candidate.y);
  if(!Number.isFinite(length)||length<=0)throw new RangeError('Explicit nonzero coincident-target direction required');
  return Object.freeze({x:candidate.x/length*speed,y:candidate.y/length*speed});
}
export function voltFallbackDirection(previous:VoltPoint,facing:1|-1):VoltPoint{
  return Number.isFinite(previous.x)&&Number.isFinite(previous.y)&&Math.hypot(previous.x,previous.y)>0?
    previous:Object.freeze({x:facing,y:0});
}
export function directedVoltVelocity(selfRoot:VoltPoint,victimRoot:VoltPoint,policy:VoltTacklePolicy,
  previous:VoltPoint,facing:1|-1):VoltPoint{
  return normalized({x:victimRoot.x-selfRoot.x,y:victimRoot.y-selfRoot.y},20*policy.pixelsPerUnit,
    voltFallbackDirection(previous,facing));
}
export function reflectedVoltVelocity(previousWorld:VoltPoint,nativeAngleDegrees:number,policy:VoltTacklePolicy,facing:1|-1):VoltPoint{
  // Native Y-up rotation becomes opposite signed world Y-down rotation.
  const radians=-nativeAngleDegrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return normalized({x:previousWorld.x*c-previousWorld.y*s,y:previousWorld.x*s+previousWorld.y*c},
    20*policy.pixelsPerUnit,voltFallbackDirection(previousWorld,facing));
}
export function voltSavedHitPosition(selfRoot:VoltPoint,groundRayHit:boolean,pixelsPerUnit:number):VoltPoint{
  return Object.freeze({x:selfRoot.x,y:selfRoot.y-(groundRayHit?20*pixelsPerUnit:0)});
}
export interface VoltCameraBounds {readonly left:number;readonly right:number;readonly top:number;readonly bottom:number;}
/** Approved current2D vertical-FOV projection adapter, NOT native clip callee
 * parity. Cache once at Hit with fixed simulation aspect, never renderer size.
 * Actual-FOV/min-FOV common scaling remains unavailable. */
export function voltClipBounds(savedHitPosition:VoltPoint,policy:VoltTacklePolicy):VoltCameraBounds{
  if(!Number.isFinite(policy.simulationViewportAspect)||policy.simulationViewportAspect<=0)
    throw new RangeError('Fixed positive simulation viewport aspect required');
  const halfHeight=150*Math.tan(30*Math.PI/360)*policy.pixelsPerUnit;
  const halfWidth=halfHeight*policy.simulationViewportAspect;
  return Object.freeze({left:savedHitPosition.x-halfWidth,right:savedHitPosition.x+halfWidth,
    top:savedHitPosition.y-halfHeight,bottom:savedHitPosition.y+halfHeight});
}
/** Numeric camera rectangle is a deterministic policy input until the native
 * WeaponSpecializer callee is available. Bounds are inclusive; exact signed
 * vec2_angle is supplied separately, never silently guessed here. */
export function voltCameraBoundary(selfRoot:VoltPoint,velocity:VoltPoint,nativeStatusFrame:number,bounds:VoltCameraBounds):
  {readonly reached:boolean;readonly angleBasisNative:VoltPoint|null}{
  if(nativeStatusFrame<2)return{reached:false,angleBasisNative:null};
  const next={x:selfRoot.x+velocity.x,y:selfRoot.y+velocity.y};
  if(next.x<=bounds.left||next.x>=bounds.right)return{reached:true,angleBasisNative:{x:0,y:1}};
  if(next.y<=bounds.top||next.y>=bounds.bottom)return{reached:true,angleBasisNative:{x:1,y:0}};
  return{reached:false,angleBasisNative:null};
}
/** Selected literal-call interpretation: shared native vec2_angle uses
 * unsigned radians (supported by same-dump QuickAttack/math_rad comparisons),
 * but Final applies minimum90 then math_rad(savedAngle). Preserve that unit
 * discrepancy; finite acos0..pi normally clamps to90 degrees. This is explicit
 * inference/decompiler limitation, not exact native proof. */
export function voltBoundaryReflectAngle(previousWorld:VoltPoint,angleBasisNative:VoltPoint):number{
  const x=previousWorld.x,y=-previousWorld.y;
  const length=Math.hypot(x,y)*Math.hypot(angleBasisNative.x,angleBasisNative.y);
  if(!Number.isFinite(length)||length<=0)throw new RangeError('Finite nonzero vortex velocity/basis required');
  const cosine=Math.max(-1,Math.min(1,(x*angleBasisNative.x+y*angleBasisNative.y)/length));
  return Math.max(90,Math.acos(cosine));
}
/** Registered native successful-vortex preconditions. Disabling Matter terrain
 * and jostle masks is a selected engine binding of NONE correction/Area false;
 * prior masks/gravity/cliff and owner protection restore exactly on exit.
 * Initial dash and miss do not inherit this bypass/KO-survival policy. */
export function voltTackleWorldPolicy(state:VoltTackleState){
  if(state.phase==='done')return null;
  const vortex=state.phase==='attack'||state.phase==='attack2'||state.phase==='attack-finish'||state.phase==='return';
  // Instance KO_SURVIVE remains until FinalEnd/end, including finisher recovery.
  const successful=state.phase==='hit'||vortex||state.phase==='finish';
  return Object.freeze({terrainBypass:vortex,cliffDetection:false,jostle:!vortex,
    disableStageGravity:vortex,koSurvive:successful,noDead:successful,
    groundCliffStop:state.phase==='miss'||state.phase==='dash'&&state.age>=6});
}
export interface VoltStepInput {readonly clockAdvances:boolean;readonly substatusTicks:boolean;
  readonly nativeStatusFrame:number;readonly hitMotionEnded:boolean;readonly cameraBoundaryReached:boolean;
  readonly nativeReflectAngleDegrees:number;readonly selfRoot:VoltPoint;
  /** Scene checks active capture generation before exposing live victim root. */
  readonly primaryVictimRoot:VoltPoint|null;}
export function stepVoltTackle(state:VoltTackleState,policy:VoltTacklePolicy,input:VoltStepInput):
  {state:VoltTackleState;events:readonly VoltTackleEvent[]}{
  if(state.phase==='done'||!input.clockAdvances)return{state,events:[]};
  if(!Number.isFinite(policy.pixelsPerUnit)||policy.pixelsPerUnit<=0||
    !Number.isInteger(policy.startupFrames)||policy.startupFrames<1||
    !Number.isInteger(policy.missRecoveryFrames)||policy.missRecoveryFrames<1||
    !Number.isInteger(policy.finishRecoveryFrames)||policy.finishRecoveryFrames<11)
    throw new RangeError('Valid source/world scale and source finisher recovery required');
  const next={...state,age:state.age+1,motionAge:state.age+1};const events:VoltTackleEvent[]=[];
  // Ground FinalDashEnd sets rate.7 at native motion frame1. Derive its
  // fractional drawing clock from integer elapsed steps, not accumulated.7.
  if(state.phase==='miss'&&!state.airborne)next.motionAge=1+(next.age-1)*VOLT_TACKLE_SOURCE.groundMissMotionRate;
  const transition=(phase:VoltPhase)=>{next.phase=phase;next.age=0;next.motionAge=0;events.push({kind:'phase',phase});};
  const velocity=(v:VoltPoint)=>{next.velocity=v;events.push({kind:'velocity',velocity:v});};
  const directOrReflect=()=>input.primaryVictimRoot?directedVoltVelocity(input.selfRoot,input.primaryVictimRoot,policy,state.velocity,state.facing):
    reflectedVoltVelocity(state.velocity,next.reflectAngleDegrees,policy,state.facing);
  if(state.phase==='startup'&&next.age>=policy.startupFrames){transition('dash');velocity({x:8*policy.pixelsPerUnit*state.facing,y:0});}
  else if(state.phase==='dash'&&next.age>=16){transition('miss');velocity({x:VOLT_TACKLE_SOURCE.missSpeedNative*policy.pixelsPerUnit*state.facing,y:0});}
  else if(state.phase==='hit'&&input.hitMotionEnded){
    next.vortexFramesRemaining=120;
    if(state.hitTargets.length>0){transition('attack');velocity(directOrReflect());}
    else{transition('done');events.push({kind:'complete',outcome:'miss'});}
  }else if(state.phase==='attack'||state.phase==='attack2'){
    if(input.substatusTicks)next.vortexFramesRemaining=Math.max(0,state.vortexFramesRemaining-1);
    if(input.nativeStatusFrame>=2&&input.cameraBoundaryReached){
      next.reflectAngleDegrees=Math.max(90,input.nativeReflectAngleDegrees);
      if(next.vortexFramesRemaining<=0){transition('attack-finish');velocity(directOrReflect());}
      else{
        next.totalReflections++;
        if(state.phase==='attack'){transition('attack2');velocity(reflectedVoltVelocity(state.velocity,next.reflectAngleDegrees,policy,state.facing));}
        else if(state.attack2Counter>=3){
          next.attack2Counter=0;transition('attack2');velocity(reflectedVoltVelocity(state.velocity,next.reflectAngleDegrees,policy,state.facing));
        }else{next.attack2Counter++;transition('attack');velocity(directOrReflect());}
      }
    }
  }else if(state.phase==='attack-finish'&&input.nativeStatusFrame>=2&&input.cameraBoundaryReached){
    transition('return');
    if(state.savedHitPosition)velocity(directedVoltVelocity(input.selfRoot,state.savedHitPosition,policy,state.velocity,state.facing));
  }else if(state.phase==='return'){
    const target=state.savedHitPosition;
    const near=target!==null&&Math.hypot(target.x-input.selfRoot.x,target.y-input.selfRoot.y)<=20*policy.pixelsPerUnit;
    if(near||input.nativeStatusFrame>=30){
      if(near&&target)events.push({kind:'snap',position:target});
      // Current engine binds native Return→End to final2/air2 finisher; exact
      // common effect/status selection is a separately reviewed adapter gap.
      velocity({x:0,y:0});transition('finish');
    }
  }else if(state.phase==='finish'){
    if(next.age===9)events.push({kind:'finish-hit',damage:20});
    if(next.age>=policy.finishRecoveryFrames){transition('done');events.push({kind:'complete',outcome:'hit'});}
  }else if(state.phase==='miss'){
    // Native STOP energy brake is a per-physics-tick speed decrement. Its
    // exact shared kinetic integrator is unavailable; this named linear2D
    // adapter consumes the captured.09 instead of retaining dash speed8.
    const speed=Math.max(0,Math.abs(state.velocity.x)-VOLT_TACKLE_SOURCE.dashBrakeNative*policy.pixelsPerUnit);
    velocity({x:speed===0?0:speed*Math.sign(state.velocity.x),y:0});
    if(next.motionAge>=policy.missRecoveryFrames){transition('done');events.push({kind:'complete',outcome:'miss'});}
  }
  return{state:Object.freeze(next),events};
}
