/** STAGED. Deterministic one-active-Final match controller. Scene consumes
 * events once for world/camera/control/physics changes; no world freeze here. */
import {EMPTY_FINAL_METER,addFinalMeterPoints,finalMeterDamage,finalMeterFillMultiplier,
  resetFinalMeterOnStockLoss,stepFinalMeter,type FinalMeterState} from './finalSmashMeter';
import {FINAL_BALL_SCALE,FINAL_METER_SCALES,type FinalParticipant,type FinalActivationRequest,
  type FinalSmashRules,type FinalRun,type FinalControllerEvent,type FinalCapture,type FinalExitReason,isFinalFighter} from './finalSmashSchema';
export interface FinalPlayerResource extends FinalParticipant {readonly meter:FinalMeterState;readonly ballStandby:boolean;}
export interface FinalControllerSnapshot {readonly schemaVersion:1;readonly lastStepFrame:number|null;
  readonly sequence:number;readonly players:readonly FinalPlayerResource[];readonly active:FinalRun|null;
  readonly consumedDamageReceipts:readonly string[];}
function freezeRun(run:FinalRun):FinalRun{
  return Object.freeze({...run,owner:Object.freeze({...run.owner}),scales:Object.freeze({...run.scales}),
    captures:Object.freeze(run.captures.map(c=>Object.freeze({...c})))});
}
export class FinalSmashController {
  private players=new Map<number,FinalPlayerResource>();
  private active:FinalRun|null=null;private sequence=0;private lastStepFrame:number|null=null;
  private consumedDamageReceipts=new Set<string>();
  constructor(readonly rules:FinalSmashRules,participants:readonly FinalParticipant[]){
    for(const p of participants){
      if(this.players.has(p.playerIndex))throw new Error('Duplicate Final slot');
      this.setPlayer({...p,meter:{...EMPTY_FINAL_METER},ballStandby:false});
    }
  }
  getPlayer(playerIndex:number):FinalPlayerResource|null{return this.players.get(playerIndex)??null;}
  getActive():FinalRun|null{return this.active;}
  canOwnResource(playerIndex:number):boolean {
    const p=this.players.get(playerIndex); return !!p && isFinalFighter(p.fighter);
  }
  getAvailableResource(playerIndex:number):'ball'|'meter'|null{
    // Temporary suppression preserves ready resources of other players.
    if(this.active)return null;
    const p=this.players.get(playerIndex);if(!p||!this.canOwnResource(playerIndex))return null;
    return p.ballStandby?'ball':this.rules.meterEnabled&&p.meter.standbySinceFrame!==null?'meter':null;
  }
  private setPlayer(p:FinalPlayerResource):void{
    this.players.set(p.playerIndex,Object.freeze({...p,meter:Object.freeze({...p.meter})}));
  }
  /** frame is the advancing60Hz gameplay/resource clock, never wall time or a
   * render counter. Scene does not step while paused/disconnected. Any sourced
   * global stop also stops this clock. Actor-local hitlag, opponent slow and
   * an active Final do not imply a resource-clock pause. Separate phase/camera
   * clocks never substitute for this frame. matchAge uses the same domain. */
  step(frame:number,matchAge:number,chargeClockAdvances:boolean):readonly FinalControllerEvent[]{
    if(frame===this.lastStepFrame)return[];
    if(this.lastStepFrame!==null&&frame<this.lastStepFrame)throw new Error('Final frame rewind requires snapshot restore');
    this.lastStepFrame=frame;const events:FinalControllerEvent[]=[];
    if(this.rules.meterEnabled)for(const p of this.players.values()){
      if (!this.canOwnResource(p.playerIndex)) continue;
      const result=stepFinalMeter(p.meter,{frame,matchAge,chargeClockAdvances,ballStandby:p.ballStandby,
        fillMultiplier:finalMeterFillMultiplier(this.players.size)});
      this.setPlayer({...p,meter:result.state});
      if(result.expired)events.push({kind:'standby-expired',playerIndex:p.playerIndex});
    }
    return events;
  }
  damageReceipt(receipt:{readonly id:string;readonly frame:number;readonly attacker:number|null;
    readonly victim:number;readonly appliedPercent:number;readonly recoil:boolean}):void{
    if(this.consumedDamageReceipts.has(receipt.id))return;
    if(!Number.isFinite(receipt.appliedPercent)||receipt.appliedPercent<0)throw new RangeError('Invalid Final damage receipt');
    this.consumedDamageReceipts.add(receipt.id);
    if(!this.rules.meterEnabled||receipt.recoil)return;
    const gain=(playerIndex:number,receivedPercent:number,dealtPercent:number)=>{
      const p=this.players.get(playerIndex);if(!p||!this.canOwnResource(playerIndex))return;
      this.setPlayer({...p,meter:finalMeterDamage(p.meter,{receivedPercent,dealtPercent,recoil:false,
        fillMultiplier:finalMeterFillMultiplier(this.players.size),frame:receipt.frame})});
    };
    gain(receipt.victim,receipt.appliedPercent,0);
    if(receipt.attacker!==null&&receipt.attacker!==receipt.victim)gain(receipt.attacker,0,receipt.appliedPercent);
  }
  grantBall(playerIndex:number,frame:number):readonly FinalControllerEvent[]{
    const p=this.players.get(playerIndex);if(!p||!this.rules.smashBallEnabled||!this.canOwnResource(playerIndex))return[];
    this.setPlayer({...p,ballStandby:true,meter:addFinalMeterPoints(p.meter,2000,frame)});
    return[{kind:'ball-granted',playerIndex}];
  }
  /** Drop admission is a caller policy, not guessed damage threshold or RNG. */
  dropBall(playerIndex:number):readonly FinalControllerEvent[]{
    const p=this.players.get(playerIndex);if(!p?.ballStandby)return[];
    this.setPlayer({...p,ballStandby:false,meter:{...EMPTY_FINAL_METER}});
    return[{kind:'ball-dropped',playerIndex}];
  }
  /** Stable slot order is the simultaneous-input engine adapter. A winning
   * command routes before ordinary item/bomb/special; losing requests retain
   * standby and run ordinary neutral special per source global concurrency. */
  activate(requests:readonly FinalActivationRequest[],frame:number):readonly FinalControllerEvent[]{
    if(this.active)return[];
    for(const r of [...requests].sort((a,b)=>a.playerIndex-b.playerIndex)){
      const p=this.players.get(r.playerIndex),resource=this.getAvailableResource(r.playerIndex);
      if(!isFinalFighter(r.fighter)||!p||!resource||p.fighter!==r.fighter||p.generation!==r.generation||!r.neutralSpecialEdge||!r.legallyActionable)continue;
      const run:FinalRun=freezeRun({id:++this.sequence,owner:{playerIndex:p.playerIndex,fighter:r.fighter,generation:p.generation},
        resource,scales:resource==='ball'?FINAL_BALL_SCALE:FINAL_METER_SCALES[r.fighter],
        startedFrame:frame,phase:'start',phaseAge:0,captures:[]});
      this.setPlayer({...p,ballStandby:false,meter:{...EMPTY_FINAL_METER}});this.active=run;
      return[{kind:'activate',run,airborne:r.airborne,intendedFacing:r.intendedFacing}];
    }
    return[];
  }
  capture(runId:number,target:FinalCapture):readonly FinalControllerEvent[]{
    const run=this.active;if(!run||run.id!==runId||target.playerIndex===run.owner.playerIndex||
      run.captures.some(c=>c.playerIndex===target.playerIndex))return[];
    const p=this.players.get(target.playerIndex);if(!p||p.generation!==target.generation)return[];
    this.active=freezeRun({...run,captures:[...run.captures,target]});
    return[{kind:'capture',runId,target}];
  }
  release(runId:number,playerIndex:number):readonly FinalControllerEvent[]{
    const run=this.active,target=run?.captures.find(c=>c.playerIndex===playerIndex);
    if(!run||run.id!==runId||!target)return[];
    this.active=freezeRun({...run,captures:run.captures.filter(c=>c.playerIndex!==playerIndex)});
    return[{kind:'release',runId,target}];
  }
  commitPhase(runId:number,phase:string,phaseAge:number):void{
    if(this.active?.id!==runId)return;
    if(!Number.isInteger(phaseAge)||phaseAge<0)throw new RangeError('Invalid Final phase age');
    this.active=freezeRun({...this.active,phase,phaseAge});
  }
  finish(runId:number,reason:FinalExitReason):readonly FinalControllerEvent[]{
    const run=this.active;if(!run||run.id!==runId)return[];
    const events:FinalControllerEvent[]=run.captures.map(target=>({kind:'release',runId,target}));
    events.push({kind:'exit',run,reason});this.active=null;return events;
  }
  resetParticipant(playerIndex:number,generation:number,reason:FinalExitReason,retainedReadyRatio:number):readonly FinalControllerEvent[]{
    const p=this.players.get(playerIndex);if(!p)return[];
    const events:FinalControllerEvent[]=this.active?.owner.playerIndex===playerIndex?
      [...this.finish(this.active.id,reason)]:this.active?[...this.release(this.active.id,playerIndex)]:[];
    this.setPlayer({...p,generation,ballStandby:false,meter:reason==='owner-stock-loss'?
      resetFinalMeterOnStockLoss(p.meter,retainedReadyRatio):{...EMPTY_FINAL_METER}});
    return events;
  }
  snapshot():FinalControllerSnapshot{return{schemaVersion:1,lastStepFrame:this.lastStepFrame,sequence:this.sequence,
    players:[...this.players.values()].sort((a,b)=>a.playerIndex-b.playerIndex).map(p=>({...p,meter:{...p.meter}})),
    active:this.active?{...this.active,owner:{...this.active.owner},scales:{...this.active.scales},
      captures:this.active.captures.map(c=>({...c}))}:null,consumedDamageReceipts:[...this.consumedDamageReceipts].sort()};}
  restore(snapshot:FinalControllerSnapshot):void{
    if(snapshot.schemaVersion!==1)throw new Error('Unsupported Final snapshot');
    this.players=new Map();for(const p of snapshot.players)this.setPlayer(p);
    this.active=snapshot.active?freezeRun(snapshot.active):null;
    this.sequence=snapshot.sequence;this.lastStepFrame=snapshot.lastStepFrame;
    this.consumedDamageReceipts=new Set(snapshot.consumedDamageReceipts);
  }
}
