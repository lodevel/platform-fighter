import {selectPikachuAuxiliaryBody, pikachuAuxiliarySourceStatus} from './pikachuAuxiliaryBody';

export type PikachuGroundRecoverySheet = 'getup' | 'getup_face_down' | 'getup_roll' |
  'getup_roll_back' | 'getup_roll_face_down' | 'getup_roll_back_face_down' | 'tech' | 'tech_forward' | 'tech_back';
/** Pinned motion-list cancellation and one-based, end-exclusive protection.
 * Mapping one native frame to one fixed step is the explicit beta clock.
 * Resource endpoints, shared native posture selection and rates stay separate.
 */
export interface PikachuGroundRecovery {
 readonly sheet:PikachuGroundRecoverySheet;
 readonly facing:1|-1;
 readonly framesElapsed:number;
 readonly duration:number;
 readonly protectionEnd:number;
}
export function beginPikachuGroundRecovery(sheet:PikachuGroundRecoverySheet,facing:1|-1):PikachuGroundRecovery {
 const source=pikachuAuxiliarySourceStatus(sheet);
 if(!source?.cancelFrame || source.intangibilityEndExclusive === null) throw new Error('Ground recovery needs a known source cancel and protection interval');
 return {sheet,facing,framesElapsed:0,duration:source.cancelFrame,protectionEnd:source.intangibilityEndExclusive};
}
export function advancePikachuGroundRecovery(state:PikachuGroundRecovery):PikachuGroundRecovery|null {
 return state.framesElapsed+1<state.duration?{...state,framesElapsed:state.framesElapsed+1}:null;
}
/** Apply per-step physical displacement; a blocked step is never caught up. */
export function pikachuGroundRecoveryVelocity(previous:PikachuGroundRecovery,next:PikachuGroundRecovery){
 const a=selectPikachuAuxiliaryBody(previous.sheet,previous.framesElapsed),b=selectPikachuAuxiliaryBody(next.sheet,next.framesElapsed);
 if(!a||!b)throw new Error('Ground recovery lacks a pinned source displacement');
 return {x:(b.sourceRootDelta.x-a.sourceRootDelta.x)*next.facing,y:b.sourceRootDelta.y-a.sourceRootDelta.y};
}
export function pikachuGroundRecoveryProtected(state:PikachuGroundRecovery){return state.framesElapsed+1<state.protectionEnd;}
