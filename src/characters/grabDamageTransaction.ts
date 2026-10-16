/** Source-guided adapter to the existing fighter stale queue. Native common
 * grouping/commit callers are unrecovered; capture alone is not a damage entry. */
export interface GrabDamageTransaction {
  readonly transactionKey:string;readonly queueMoveId:string;readonly staleMultiplier:number;
  readonly actorGeneration:number;readonly targetGeneration:number;readonly captureId:number;
  readonly entryFrame:number;readonly committed:boolean;
}
export function beginGrabDamageTransaction(input:Omit<GrabDamageTransaction,'committed'>):GrabDamageTransaction {
  if(!input.transactionKey||!input.queueMoveId||!Number.isFinite(input.staleMultiplier)||input.staleMultiplier<=0||
    ![input.actorGeneration,input.targetGeneration,input.captureId,input.entryFrame].every(Number.isSafeInteger)||
    input.actorGeneration<0||input.targetGeneration<0||input.captureId<1||input.entryFrame<0)
    throw new Error('Invalid admitted grab damage transaction');
  return Object.freeze({...input,committed:false});
}
export function grabDamageTransactionMatches(state:GrabDamageTransaction|null,live:{actorGeneration:number;targetGeneration:number;captureId:number}):state is GrabDamageTransaction {
  return state!==null&&state.actorGeneration===live.actorGeneration&&state.targetGeneration===live.targetGeneration&&state.captureId===live.captureId;
}
/** Positive actual percent receipt commits once. Rejected/zero damage cannot
 * enqueue, and interruption does not undo an already accepted prehit. */
export function commitGrabDamageTransaction(state:GrabDamageTransaction,damageApplied:number):{state:GrabDamageTransaction;enqueue:boolean} {
  if(!Number.isFinite(damageApplied))throw new Error('Nonfinite grab damage receipt');
  return !state.committed&&damageApplied>0?{state:Object.freeze({...state,committed:true}),enqueue:true}:{state,enqueue:false};
}
