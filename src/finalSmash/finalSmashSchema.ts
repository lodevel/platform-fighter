/** STAGED. Serializable Final boundaries; admission and unresolved status
 * physics are explicit policies, not guessed parser defaults. */
export type FinalFighter='donkeykong'|'pikachu'|'link';
export type FinalResource='meter'|'ball';
export type FinalExitReason='complete'|'owner-stock-loss'|'owner-reset'|'disconnect'|'match-end';
export interface FinalParticipant {readonly playerIndex:number;readonly fighter:string;readonly generation:number;}
export interface FinalOwner extends FinalParticipant {readonly fighter:FinalFighter;}
export interface FinalCapture {readonly playerIndex:number;readonly generation:number;}
export interface FinalSmashRules {readonly schemaVersion:1;readonly meterEnabled:boolean;readonly smashBallEnabled:boolean;}
export interface FinalDamageScale {readonly damage:number;readonly reaction:number;}
export interface FinalRun {readonly id:number;readonly owner:FinalOwner;readonly resource:FinalResource;
  readonly scales:FinalDamageScale;readonly startedFrame:number;readonly phase:string;readonly phaseAge:number;
  readonly captures:readonly FinalCapture[];}
export interface FinalActivationRequest extends FinalOwner {readonly neutralSpecialEdge:boolean;readonly intendedFacing?:1|-1;
  /** Derived from actual capture/KO/action/defense/item state by Scene. */
  readonly legallyActionable:boolean;readonly airborne:boolean;}
export type FinalControllerEvent=
  |{readonly kind:'activate';readonly run:FinalRun;readonly airborne:boolean;readonly intendedFacing?:1|-1}
  |{readonly kind:'capture'|'release';readonly runId:number;readonly target:FinalCapture}
  |{readonly kind:'exit';readonly run:FinalRun;readonly reason:FinalExitReason}
  |{readonly kind:'standby-expired'|'ball-granted'|'ball-dropped';readonly playerIndex:number};
export const FINAL_METER_SCALES:Readonly<Record<FinalFighter,FinalDamageScale>>=Object.freeze({
  donkeykong:Object.freeze({damage:.7,reaction:1.02}),pikachu:Object.freeze({damage:.7,reaction:.96}),
  link:Object.freeze({damage:.7,reaction:.9})});
export const FINAL_BALL_SCALE:FinalDamageScale=Object.freeze({damage:1,reaction:1});
/** Product choice: fresh matches enable both the Meter and Smash Ball.
 * Historical playback must call an explicit legacy migration instead. */
export const NEW_MATCH_FINAL_RULES:FinalSmashRules=Object.freeze({schemaVersion:1,meterEnabled:true,smashBallEnabled:true});
export const LEGACY_REPLAY_FINAL_RULES:FinalSmashRules=Object.freeze({schemaVersion:1,meterEnabled:false,smashBallEnabled:false});
export function parseFinalSmashRules(value:unknown):FinalSmashRules{
  if(!value||typeof value!=='object')throw new Error('Explicit versioned Final rules required');
  const v=value as Record<string,unknown>;
  if(v.schemaVersion!==1||typeof v.meterEnabled!=='boolean'||typeof v.smashBallEnabled!=='boolean')
    throw new Error('Invalid Final rules; select migration explicitly');
  return Object.freeze({schemaVersion:1,meterEnabled:v.meterEnabled,smashBallEnabled:v.smashBallEnabled});
}
export function isFinalFighter(value:string):value is FinalFighter{return value==='donkeykong'||value==='pikachu'||value==='link';}
