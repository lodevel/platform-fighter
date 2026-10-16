import type {AttackMoveWithAnimation} from './moveSchema';
import {getDonkeyKongPairedProtectionTimeline,resolveDonkeyKongProtectionClock} from './donkeykongPairedProtectionClock';

/** Technical continuation native8..28 is distinct from ACMD ENABLE_COMBO7.
 * The retained token is a project adapter, not a recovered common status body.
 * Only an explicit DK paired jab opt-in changes existing chain clock behavior. */
export function getDonkeyKongJabContinuability(move:AttackMoveWithAnimation){
 const chain=move.jabChain,paired=getDonkeyKongPairedProtectionTimeline(move);
 if(move.type!=='jab'||!chain||chain.continuationWindowEndFrame===undefined||!paired)return null;
 const start=chain.advanceWindowStart??paired.timeline.startup,end=chain.continuationWindowEndFrame;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start)return null;
 return{start,end,committedSourceEnd:paired.timeline.endFrame,nextId:chain.nextId};
}

export function donkeyKongJabCanAdvance(move:AttackMoveWithAnimation,elapsed:number):boolean|null{
 const window=getDonkeyKongJabContinuability(move);if(!window)return null;
 const age=resolveDonkeyKongProtectionClock(move,elapsed).age;
 return age!==null&&age>=window.start&&age<window.end;
}

export interface DonkeyKongJabContinuation {
 readonly move:AttackMoveWithAnimation;
 readonly originAttack:object;
 readonly entryFacing:1|-1;
 readonly resetGeneration:number;
 readonly sourceAge:number;
 readonly lastFrame:number;
}

export function retainDonkeyKongJabContinuation(move:AttackMoveWithAnimation,originAttack:object,entryFacing:1|-1,
 resetGeneration:number,frame:number):DonkeyKongJabContinuation|null{
 const window=getDonkeyKongJabContinuability(move);
 return window&&window.committedSourceEnd<window.end
  ?{move,originAttack,entryFacing,resetGeneration,sourceAge:window.committedSourceEnd,lastFrame:frame}:null;
}

/** End tick already latched canonical end24. Each subsequent unfrozen step
 * advances once, including after custom gameplay retiming; that tail policy
 * is authored. No attack sensor, cooldown, input queue, or lock is retained. */
export function tickDonkeyKongJabContinuation(state:DonkeyKongJabContinuation|null,
 observation:{frame:number;resetGeneration:number;interrupted:boolean;frozen:boolean}):DonkeyKongJabContinuation|null{
 if(!state)return null;
 const window=getDonkeyKongJabContinuability(state.move);
 if(!window||observation.interrupted||state.resetGeneration!==observation.resetGeneration)return null;
 const age=state.sourceAge+(observation.frozen||state.lastFrame===observation.frame?0:1);
 return age>=window.end?null:{...state,sourceAge:age,lastFrame:observation.frame};
}

export function donkeyKongRetainedJabCanAdvance(state:DonkeyKongJabContinuation|null):boolean{
 if(!state)return false;const window=getDonkeyKongJabContinuability(state.move);
 return !!window&&state.sourceAge>=window.start&&state.sourceAge<window.end;
}
