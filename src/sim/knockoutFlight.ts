import type {CharacterId} from '../types';

/** Authored Inferno preview-style death presentation, after accepted stock
 * loss. It never retains an actor, changes stock/respawn timing or collides. */
export interface GazeKnockoutReceipt {
  readonly playerIndex:number;
  readonly characterId:CharacterId;
  readonly paletteIndex:number;
  readonly bornFrame:number;
  readonly sourceRoot:{readonly x:number;readonly y:number};
  readonly facing:1|-1;
  readonly away:1|-1;
}
export interface KnockoutFlightView {
  readonly playerIndex:number;
  readonly characterId:CharacterId;
  readonly paletteIndex:number;
  /** Actual source ROOT following the authored detached flight path. */
  readonly sourceRoot:{readonly x:number;readonly y:number};
  readonly facing:1|-1;
  readonly age:number;
  readonly duration:number;
  readonly scale:number;
  readonly rotation:number;
  readonly alpha:number;
}
export const GAZE_KNOCKOUT_FLIGHT_FRAMES=100;
export function gazeKnockoutFlight(receipt:GazeKnockoutReceipt,frame:number):KnockoutFlightView|null {
  const age=frame-receipt.bornFrame;
  if(age<0||age>=GAZE_KNOCKOUT_FLIGHT_FRAMES)return null;
  const k=age/GAZE_KNOCKOUT_FLIGHT_FRAMES;
  return {playerIndex:receipt.playerIndex,characterId:receipt.characterId,paletteIndex:receipt.paletteIndex,
    sourceRoot:{x:receipt.sourceRoot.x+receipt.away*520*k,y:receipt.sourceRoot.y-700*k+135*k*k},
    facing:receipt.facing,age,duration:GAZE_KNOCKOUT_FLIGHT_FRAMES,scale:Math.max(.02,1-k**.7),
    rotation:-receipt.away*age*.35,alpha:Math.min(1,1.5-k)};
}
