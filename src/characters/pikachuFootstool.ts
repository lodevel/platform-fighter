/** Authored interpretation of the pinned tread contact parameters. Native
 * whole-dimension/additional-range selectors and impulse basis are unresolved.
 * All participants are captured before any fighter consumes this input step.
 */
export interface FootstoolParticipant {
 readonly playerIndex:number;
 readonly characterId:string;
 readonly x:number;
 readonly y:number;
 readonly feetY:number;
 readonly velocityY:number;
 readonly head:{readonly x:number;readonly top:number};
 readonly freshJump:boolean;
 readonly mayJump:boolean;
 readonly mayReceive:boolean;
 readonly attacking:boolean;
 readonly grounded:boolean;
}
export interface FootstoolResolution {
 readonly jumperIndex:number;
 readonly recipientIndex:number;
 readonly phantom:boolean;
 readonly groundedRecipient:boolean;
}
export function resolvePikachuFootstools(participants:readonly FootstoolParticipant[]):readonly FootstoolResolution[]{
 const result:FootstoolResolution[]=[],usedParticipants=new Set<number>();
 for(const jumper of [...participants].sort((a,b)=>a.playerIndex-b.playerIndex)){
  if(usedParticipants.has(jumper.playerIndex)||jumper.characterId!=='pikachu'||!jumper.freshJump||!jumper.mayJump||jumper.grounded||jumper.velocityY<0)continue;
  const candidates=participants.filter(target=>target.playerIndex!==jumper.playerIndex && target.mayReceive &&
    !usedParticipants.has(target.playerIndex) && jumper.y<target.head.top &&
    Math.abs(jumper.x-target.head.x)<=15 && Math.abs(jumper.feetY-(target.head.top-5))<=15)
    .sort((a,b)=>Math.abs(jumper.feetY-(a.head.top-5))-Math.abs(jumper.feetY-(b.head.top-5))||a.playerIndex-b.playerIndex);
  const target=candidates[0];if(!target)continue;
  usedParticipants.add(target.playerIndex);usedParticipants.add(jumper.playerIndex);
  result.push({jumperIndex:jumper.playerIndex,recipientIndex:target.playerIndex,phantom:target.attacking,groundedRecipient:target.grounded});
 }
 return result;
}
