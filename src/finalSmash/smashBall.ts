/** STAGED. Source public HP/lifetime/spawn laws. Motion belongs a separate
 * article consumer, never generic held-item or ordinary fall physics. */
export const SMASH_BALL_SOURCE=Object.freeze({hp:40,trainingHp:10,decayAmount:2,decayInterval:60,
  decayStopsBeforeAtMost:2.5,lifeFrames:1320,heavyProbability:.2,initialSpawnLockoutFrames:900,
  laterSpawnLockoutFrames:4800,baseChance:.1,earlyChanceRampFrames:6660});
export interface SmashBallState {readonly id:number;readonly hp:number;readonly heavy:boolean;readonly age:number;
  readonly decayAge:number;readonly attributedAttacker:number|null;readonly retired:boolean;}
function checkRoll(value:number):void{if(!Number.isFinite(value)||value<0||value>=1)throw new RangeError('Seeded roll must be [0,1)');}
export function createSmashBall(id:number,heavyRoll:number,training:boolean):SmashBallState{
  checkRoll(heavyRoll);return Object.freeze({id,hp:training?10:40,heavy:heavyRoll<.2,age:0,decayAge:0,
    attributedAttacker:null,retired:false});
}
export function smashBallScoreDamageMultiplier(scoreDifference:number):number{
  if(!Number.isFinite(scoreDifference))throw new RangeError('Invalid score difference');
  return scoreDifference>=3?.55:scoreDifference>=1?.775:scoreDifference>=0?1:scoreDifference>=-1?1.4588:
    scoreDifference>=-2?1.775:2.55;
}
export function hitSmashBall(state:SmashBallState,input:{readonly attacker:number;
  readonly damageAfterStaleFresh:number;readonly scoreDifference:number;}):{state:SmashBallState;grantedPlayer:number|null}{
  if(state.retired)return{state,grantedPlayer:null};
  if(!Number.isFinite(input.damageAfterStaleFresh)||input.damageAfterStaleFresh<0)throw new RangeError('Invalid Smash Ball hit');
  const hp=state.hp-input.damageAfterStaleFresh*smashBallScoreDamageMultiplier(input.scoreDifference),retired=hp<=0;
  return{state:Object.freeze({...state,hp:Math.max(0,hp),attributedAttacker:input.attacker,retired}),
    grantedPlayer:retired?input.attacker:null};
}
export function stepSmashBall(state:SmashBallState,clockAdvances:boolean):SmashBallState{
  if(state.retired||!clockAdvances)return state;
  const age=state.age+1,decayAge=state.decayAge+1;
  const hp=decayAge>=60&&state.hp>2.5?Math.max(0,state.hp-2):state.hp;
  return Object.freeze({...state,hp,age,decayAge:decayAge%60,retired:age>=1320});
}
export interface SmashBallSpawnState {readonly firstAttemptFrame:number;readonly lastRemovalFrame:number|null;}
export function smashBallSpawnEligibility(state:SmashBallSpawnState,input:{readonly frame:number;
  readonly enabled:boolean;readonly ballPresent:boolean;readonly ballStandby:boolean;}):boolean{
  if(!input.enabled||input.ballPresent||input.ballStandby)return false;
  return state.lastRemovalFrame===null?input.frame-state.firstAttemptFrame>=900:input.frame-state.lastRemovalFrame>=4800;
}
/** Caller supplies actual scheduler proposal interval. No per-frame RNG draw
 * or frequency multiplier consumption is invented from bare parameter names. */
export function smashBallSpawnChance(framesAfterInitialLockout:number,
  interval:{readonly minIntervalFrames:number;readonly maxIntervalFrames:number}):number{
  // Wiki Spawning compensation: average selected native timer / high average400.
  const compensation=(interval.minIntervalFrames+interval.maxIntervalFrames)/2/400;
  return .1*compensation*Math.max(0,Math.min(1,framesAfterInitialLockout/6660));
}
export function admitSmashBallSpawn(chance:number,seededRoll:number):boolean{
  checkRoll(seededRoll);if(!Number.isFinite(chance)||chance<0||chance>1)throw new RangeError('Invalid spawn chance');
  return seededRoll<chance;
}
