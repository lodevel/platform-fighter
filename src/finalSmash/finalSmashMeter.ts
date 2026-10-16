/** STAGED. Wiki2063112 public point units, not raw workbook .4/.3 gauge units.
 * Elapsed>=1200 standby expiry is an explicit engine clock-boundary adapter. */
export const FINAL_METER_SOURCE=Object.freeze({capacity:2000,initialNoChargeFrames:60,
  passiveIntervalFrames:15,receivedPointsPerPercent:9,dealtPointsPerPercent:3,standbyTimeoutFrames:1200});
export interface FinalMeterState {readonly points:number;readonly standbySinceFrame:number|null;readonly passiveFrames:number;}
export const EMPTY_FINAL_METER:FinalMeterState=Object.freeze({points:0,standbySinceFrame:null,passiveFrames:0});
export function finalMeterFillMultiplier(playerCount:number):number{
  const multiplier:Record<number,number>={1:1,2:1,3:.94,4:.9,5:.8,6:.74,7:.66,8:.6};
  if(!Number.isInteger(playerCount)||playerCount<1||playerCount>8)throw new RangeError('Unsupported Final player count');
  // Solo Lab adapter uses the sourced 1v1 rate; not native one-player evidence.
  return multiplier[playerCount]!;
}
export function addFinalMeterPoints(state:FinalMeterState,amount:number,frame:number):FinalMeterState{
  if(!Number.isFinite(amount)||amount<0)throw new RangeError('Meter gain must be finite and nonnegative');
  if(state.standbySinceFrame!==null)return state;
  const points=Math.min(FINAL_METER_SOURCE.capacity,state.points+amount);
  return Object.freeze({...state,points,standbySinceFrame:points===FINAL_METER_SOURCE.capacity?frame:null});
}
export function finalMeterDamage(state:FinalMeterState,input:{readonly receivedPercent:number;readonly dealtPercent:number;
  readonly recoil:boolean;readonly fillMultiplier:number;readonly frame:number;}):FinalMeterState{
  if(input.recoil)return state;
  const p=FINAL_METER_SOURCE;
  return addFinalMeterPoints(state,(input.receivedPercent*p.receivedPointsPerPercent+
    input.dealtPercent*p.dealtPointsPerPercent)*input.fillMultiplier,input.frame);
}
export function stepFinalMeter(state:FinalMeterState,input:{readonly frame:number;readonly matchAge:number;
  readonly chargeClockAdvances:boolean;readonly ballStandby:boolean;readonly fillMultiplier:number;}):{state:FinalMeterState;expired:boolean}{
  const p=FINAL_METER_SOURCE;
  if(!input.ballStandby&&state.standbySinceFrame!==null&&input.frame-state.standbySinceFrame>=p.standbyTimeoutFrames)
    return{state:{...EMPTY_FINAL_METER},expired:true};
  if(input.ballStandby||state.standbySinceFrame!==null||!input.chargeClockAdvances||input.matchAge<p.initialNoChargeFrames)
    return{state,expired:false};
  const passiveFrames=state.passiveFrames+1;
  return{state:addFinalMeterPoints({...state,passiveFrames:passiveFrames%p.passiveIntervalFrames},
    passiveFrames>=p.passiveIntervalFrames?input.fillMultiplier:0,input.frame),expired:false};
}
/** Wiki KO ratio is approximate60/90%. Caller supplies documented score policy;
 * this helper never guesses whether a fighter is losing. */
export function resetFinalMeterOnStockLoss(state:FinalMeterState,retainedReadyRatio:number):FinalMeterState{
  if(!Number.isFinite(retainedReadyRatio)||retainedReadyRatio<0||retainedReadyRatio>1)
    throw new RangeError('Explicit KO ready retention ratio required');
  return Object.freeze({points:state.standbySinceFrame===null?state.points:2000*retainedReadyRatio,
    standbySinceFrame:null,passiveFrames:state.passiveFrames});
}
/** Approved current-stock engine policy: compare the victim's count AFTER
 * loseStock with highest still-active opponent. Ties use ordinary retention.
 * Wiki ratios are approximate, score comparator is authored; other formats
 * require an explicit policy instead of fabricating stock counts. */
export function finalMeterStockRetentionRatio(postLossStocks:number,activeOpponentStocks:readonly number[]):number{
  if(!Number.isInteger(postLossStocks)||postLossStocks<0||
    activeOpponentStocks.some(stocks=>!Number.isInteger(stocks)||stocks<0))
    throw new RangeError('Real post-loss stock counts required');
  return activeOpponentStocks.some(stocks=>stocks>postLossStocks)?.9:.6;
}
