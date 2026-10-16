import {describe,expect,it} from 'vitest';
import {MatchSim} from '../sim/MatchSim';
import {NEUTRAL_INPUT} from '../replay/InputCaptureBuffer';
import type {MatchConfig} from '../types';

// The ordinary passive meter fills during recorded neutral play. Initial
// positions use MatchSim's explicitly recorded construction-position API, not
// runtime teleports; there are no resource/contact/controller mutations.
const config:MatchConfig={mode:'stocks',stockCount:3,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',
 finalSmashRules:{schemaVersion:1,meterEnabled:true,smashBallEnabled:false},players:[
  {index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},
  {index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]};

describe('Pikachu Final genuine whole-match input-history checkpoint',()=>{
 it('reconstructs a passively earned captured Final and exactly reproduces continuation through release',()=>{
  let sim=new MatchSim({matchConfig:config});
  try{
   const floor=sim.baseStage.bodies.platformBodies.find(body=>body.label==='platform.solid')!;
   const x=floor.position.x,top=floor.bounds.min.y;
   sim.p1.setPosition(x-100,top-sim.p1.getTuning().height/2);
   sim.p2.setPosition(x+140,top-sim.p2.getTuning().height/2);
   for(let n=0;n<30100&&sim.finalSmashController!.getAvailableResource(0)!=='meter';n++)sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
   expect(sim.finalSmashController!.getAvailableResource(0)).toBe('meter');
   console.info(JSON.stringify({admissionFrame:sim.physicsEngine.getFrame(),owner:sim.p1.getPosition(),target:sim.p2.getPosition(),facing:sim.p1.getFacing(),grounded:sim.p1.isGrounded(),actionable:sim.p1.canActivateFinalSmash(),generation:sim.p1.getPositionResetGeneration()}));
   sim.step([{...NEUTRAL_INPUT,special:true},NEUTRAL_INPUT]);
   console.info(JSON.stringify({activation:sim.finalSmashController!.getActive(),control:sim.p1.getFinalSmashControl()}));
   for(let n=0;n<200&&!sim.finalSmashController!.getActive()?.captures.length;n++)sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
   const active=sim.finalSmashController!.getActive();
   expect(active?.owner.fighter,'recorded passive meter + real special input must capture in this deterministic construction fixture').toBe('pikachu');
   expect(active!.captures.length).toBeGreaterThan(0);
   const victim=active!.captures[0]!.playerIndex;
   expect(sim.playerSlots[victim]!.character.getFinalVictimPresentationSelection()).not.toBeNull();
   const checkpoint=sim.captureMatchHistoryCheckpoint(),evidence=sim.captureMatchHistoryEvidence();
   const expected:string[]=[];let finished=false;
   for(let n=0;n<650;n++){
    sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);expected.push(sim.getSimDigest().hash);
    if(sim.finalSmashController!.getActive()?.id!==active!.id){finished=true;break;}
   }
   expect(finished,'passively earned captured Final completes within the source timeline').toBe(true);
   sim=sim.restoreMatchHistoryCheckpoint(checkpoint);
   expect(sim.captureMatchHistoryEvidence()).toBe(evidence);
   expect(sim.finalSmashController!.getActive()?.captures.length).toBeGreaterThan(0);
   expect(sim.playerSlots[victim]!.character.getFinalVictimPresentationSelection()).not.toBeNull();
   for(const [n,hash]of expected.entries()){
    sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);expect(sim.getSimDigest().hash,`whole-world continuation step ${n+1}`).toBe(hash);
   }
   expect(sim.playerSlots[victim]!.character.getFinalSmashControl()).toBeNull();
   expect(sim.playerSlots[victim]!.character.getFinalVictimPresentationSelection()).toBeNull();
   console.info(JSON.stringify({checkpointFrame:checkpoint.frame,resource:active!.resource,captives:active!.captures.length,continuationFrames:expected.length,wholeWorldHashesMatched:true}));
  }finally{sim.dispose();}
 },60000);
});
