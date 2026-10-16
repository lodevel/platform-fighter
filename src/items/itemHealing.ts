/** Recovery is a budget applied to the live damage meter, not a stored target percent.
 * Intervening damage therefore absorbs part of the net recovery exactly once (SmashWiki).
 * Native healing status code/rates are unavailable: 1 point/tick, tomato delay6, eat consume4,
 * hitlag freeze and surplus-discard at zero are labelled authored in phase-7/sources.json. */
export interface RecoverySpec {
  readonly amount:number;
  readonly mode:'instant'|'gradual';
  readonly delayFrames:number;
  readonly pointsPerFrame:number;
  readonly eat:boolean;
}
export interface HealingState {readonly remaining:number;readonly delay:number;readonly rate:number}
export function beginHealing(spec:RecoverySpec,previous:HealingState|null=null):HealingState|null {
  if(spec.amount<=0)return previous;
  return {remaining:(previous?.remaining??0)+spec.amount,delay:previous?Math.min(previous.delay,spec.delayFrames):spec.delayFrames,
    rate:previous?Math.max(previous.rate,spec.pointsPerFrame):spec.pointsPerFrame};
}
export function stepHealing(state:HealingState|null,percent:number,frozen:boolean):{
  state:HealingState|null;percent:number;healed:number
}{
  if(!state||frozen)return {state,percent,healed:0};
  if(percent<=0)return {state:null,percent:0,healed:0};
  if(state.delay>0)return {state:{...state,delay:state.delay-1},percent,healed:0};
  const healed=Math.min(percent,state.remaining,state.rate),remaining=state.remaining-healed;
  return {state:remaining>0&&percent>healed?{...state,remaining}:null,percent:percent-healed,healed};
}
export interface EatingState {
  readonly itemId:number;readonly amount:number;readonly age:number;readonly walking:boolean;readonly consumed:boolean;
}
export const EAT_CONSUME_AGE=4;
/** Native motion_list cancel frame9 for ItemLightEat and11 for ItemLightWalkEat, both actors. */
export function beginEating(amount:number,itemId:number,walking:boolean):EatingState {
  return {itemId,amount,walking,age:0,consumed:false};
}
export function stepEating(state:EatingState,input:{frozen:boolean;flinched:boolean;consumeAge?:number}):{
  state:EatingState|null;event:'consume'|'drop'|null;amount:number
}{
  if(input.flinched)return {state:null,event:state.consumed?null:'drop',amount:0};
  if(input.frozen)return {state,event:null,amount:0};
  const age=state.age+1,consume=!state.consumed&&age>=(input.consumeAge??EAT_CONSUME_AGE);
  return {state:age>=(state.walking?11:9)?null:{...state,age,consumed:state.consumed||consume},
    event:consume?'consume':null,amount:consume?state.amount:0};
}
