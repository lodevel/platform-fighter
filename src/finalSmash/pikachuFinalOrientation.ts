/** Native route vectors call Posture orientation at actual status init.
 * The shared2D ROOT operator is an explicit source-guided retarget: native
 * decompiler trig/3D-axis parity remains unknown. No movement/control changes. */
import type {VoltPhase,VoltPoint} from './pikachuVoltTackle';
export interface PikachuFinalOrientationIdentity {
 readonly runId:number;readonly ownerIndex:number;readonly ownerGeneration:number;
}
export interface PikachuFinalOrientationState extends PikachuFinalOrientationIdentity {
 readonly schema:'pikachu-final-orientation/1';readonly lastFrame:number;
 readonly phase:Exclude<VoltPhase,'done'>;readonly phaseRevision:number;
 readonly facing:1|-1;readonly rotationDegrees:number;
 readonly admittedWorldVelocity:VoltPoint|null;
}
export interface PikachuFinalOrientationStep extends PikachuFinalOrientationIdentity {
 readonly frame:number;readonly phase:VoltPhase;readonly phaseRevision:number;
 readonly actualOwnerTransition:boolean;readonly clockAdvances:boolean;
 readonly velocity:{readonly basis:'native'|'world';readonly x:number;readonly y:number}|null;
}
const PHASES=['startup','dash','hit','attack','attack2','attack-finish','return','finish','miss','done'] as const;
const MOVING=new Set<VoltPhase>(['attack','attack2','attack-finish','return']);
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
function identity(input:PikachuFinalOrientationIdentity):void {
 if(!integer(input.runId)||input.runId===0||!integer(input.ownerIndex)||!integer(input.ownerGeneration))
  throw new TypeError('Real Pika Final owner identity required');
}
function freeze(state:PikachuFinalOrientationState):PikachuFinalOrientationState {
 return Object.freeze({...state,admittedWorldVelocity:state.admittedWorldVelocity?Object.freeze({...state.admittedWorldVelocity}):null});
}
export function beginPikachuFinalOrientation(input:PikachuFinalOrientationIdentity&{
 readonly frame:number;readonly facing:1|-1;readonly phaseRevision:number;
}):PikachuFinalOrientationState {
 identity(input);if(!integer(input.frame)||!integer(input.phaseRevision)||input.facing!==1&&input.facing!==-1)
  throw new TypeError('Real Pika Final admission clock/facing required');
 return freeze({schema:'pikachu-final-orientation/1',runId:input.runId,ownerIndex:input.ownerIndex,
  ownerGeneration:input.ownerGeneration,lastFrame:input.frame,phase:'startup',phaseRevision:input.phaseRevision,
  facing:input.facing,rotationDegrees:0,admittedWorldVelocity:null});
}
/** Native X<=0 tie setsLR−1. Only a completely zero vector uses the Root
 * selected hold-prior degeneracy adapter; native atan/normalizezero is unknown. */
export function pikachuFinalMovementOrientation(world:VoltPoint,previous:{readonly facing:1|-1;readonly rotationDegrees:number}) {
 if(!finite(world.x)||!finite(world.y)||previous.facing!==1&&previous.facing!==-1||!finite(previous.rotationDegrees))
  throw new TypeError('Finite Pika Final vector/prior orientation required');
 if(world.x===0&&world.y===0)return Object.freeze({...previous,precision:'AUTHORED_ZERO_VECTOR_HOLD' as const});
 const facing=world.x>0?1 as const:-1 as const;
 const rotationDegrees=facing*Math.atan2(world.y,Math.abs(world.x))*180/Math.PI;
 return Object.freeze({facing,rotationDegrees,precision:'SOURCE_GUIDED_2D_POSTURE_RETARGET' as const});
}
export function stepPikachuFinalOrientation(state:PikachuFinalOrientationState,
 input:PikachuFinalOrientationStep):PikachuFinalOrientationState|null {
 identity(input);if(!integer(input.frame)||!integer(input.phaseRevision)||!PHASES.includes(input.phase)||
  typeof input.actualOwnerTransition!=='boolean'||typeof input.clockAdvances!=='boolean')throw new TypeError('Actual Pika Final status clock required');
 if(input.velocity&&(!['native','world'].includes(input.velocity.basis)||!finite(input.velocity.x)||!finite(input.velocity.y)))
  throw new TypeError('Actual Pika Final native/world velocity basis required');
 if(state.runId!==input.runId||state.ownerIndex!==input.ownerIndex||state.ownerGeneration!==input.ownerGeneration||input.phase==='done')return null;
 if(input.frame<state.lastFrame)throw new TypeError('Pika orientation rewind requires checkpoint restore');
 // A repeated callback is the same real owner revision. A genuine newly
 // admitted status may initialize in this physics frame; that is not a second
 // clock step and must not borrow the previous posture for its first drawing.
 if(input.frame===state.lastFrame&&input.phaseRevision===state.phaseRevision&&input.phase===state.phase)return state;
 if(!input.clockAdvances)return freeze({...state,lastFrame:input.frame});
 if(input.phaseRevision<state.phaseRevision)throw new TypeError('Pika real owner phase revision cannot rewind');
 const changed=input.phaseRevision!==state.phaseRevision||input.phase!==state.phase;
 if(!changed)return freeze({...state,lastFrame:input.frame});
 if(!input.actualOwnerTransition||input.phaseRevision<=state.phaseRevision)throw new TypeError('Orientation requires a genuine new owner status revision');
 let facing=state.facing,rotationDegrees=state.rotationDegrees,world:VoltPoint|null=null;
 if(MOVING.has(input.phase)){
  if(!input.velocity)throw new TypeError('Moving Pika status admission needs its actual initialized vector');
  world=input.velocity.basis==='native'?{x:input.velocity.x*5,y:-input.velocity.y*5}:{x:input.velocity.x,y:input.velocity.y};
  if(!finite(world.x)||!finite(world.y))throw new TypeError('Pika vector world conversion overflow');
  const next=pikachuFinalMovementOrientation(world,state);facing=next.facing;rotationDegrees=next.rotationDegrees;
 }else rotationDegrees=0; // Horizontal initial dash and actual FinalEnd reset.
 return freeze({...state,lastFrame:input.frame,phase:input.phase,phaseRevision:input.phaseRevision,
  facing,rotationDegrees,admittedWorldVelocity:world});
}
/** ROOT-relative operator: mirror canonical facing-right source once, then
 * rotate once in screen plane. Consumer adds actual solved ROOT afterwards. */
export function transformPikachuFinalOrientationPoint(point:VoltPoint,
 orientation:{readonly facing:1|-1;readonly rotationDegrees:number}):VoltPoint {
 if(!finite(point.x)||!finite(point.y)||!finite(orientation.rotationDegrees)||orientation.facing!==1&&orientation.facing!==-1)
  throw new TypeError('Finite ROOT-relative Pika point/orientation required');
 const radians=orientation.rotationDegrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians),x=point.x*orientation.facing;
 const result={x:x*c-point.y*s,y:x*s+point.y*c};
 if(!finite(result.x)||!finite(result.y))throw new TypeError('Pika ROOT operator overflow');
 return Object.freeze(result);
}
export function parsePikachuFinalOrientationState(value:unknown):PikachuFinalOrientationState|null {
 if(value===null)return null;
 const keys=['schema','runId','ownerIndex','ownerGeneration','lastFrame','phase','phaseRevision','facing','rotationDegrees','admittedWorldVelocity'];
 if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Pika orientation checkpoint required');
 const r=value as Record<string,unknown>;
 if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))||r.schema!=='pikachu-final-orientation/1'||
  !integer(r.lastFrame)||!integer(r.phaseRevision)||typeof r.phase!=='string'||!(PHASES as readonly string[]).includes(r.phase)||r.phase==='done'||
  r.facing!==1&&r.facing!==-1||!finite(r.rotationDegrees)||Math.abs(r.rotationDegrees)>90)
  throw new TypeError('Invalid closed Pika orientation checkpoint');
 identity(r as unknown as PikachuFinalOrientationIdentity);
 if(r.admittedWorldVelocity!==null){const v=r.admittedWorldVelocity as Record<string,unknown>;
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==2||!Object.hasOwn(v,'x')||!Object.hasOwn(v,'y')||!finite(v.x)||!finite(v.y))
   throw new TypeError('Invalid admitted Pika vector');
 }
 if(!MOVING.has(r.phase as VoltPhase)&&(r.rotationDegrees!==0||r.admittedWorldVelocity!==null))throw new TypeError('Horizontal/finish phase cannot borrow moving orientation');
 if(MOVING.has(r.phase as VoltPhase)&&r.admittedWorldVelocity===null)throw new TypeError('Moving phase lacks actual vector identity');
 if(r.admittedWorldVelocity!==null){const v=r.admittedWorldVelocity as unknown as VoltPoint;
  if(v.x!==0||v.y!==0){const expected=pikachuFinalMovementOrientation(v,{facing:r.facing as 1|-1,rotationDegrees:r.rotationDegrees as number});
   if(expected.facing!==r.facing||expected.rotationDegrees!==r.rotationDegrees)
    throw new TypeError('Pika checkpoint orientation disagrees with its actual admitted vector');
  }
 }
 return freeze(r as unknown as PikachuFinalOrientationState);
}
