import {describe,expect,it} from 'vitest';
import {MatchSim} from '../sim/MatchSim';
import {NEUTRAL_INPUT} from '../replay/InputCaptureBuffer';
import type {CharacterId,MatchConfig} from '../types';

// Actual production MatchSim/contact/combat/leases. Setup arranges resource and
// positions; input is injected in this headless suite. Real browser keyboard
// and actual renderer acceptance are recorded separately by the match probe.
function fixture(victim:CharacterId,air:boolean,facing:1|-1,hit:boolean){
 const config:MatchConfig={mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1510,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[
   {index:1,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p1'},
   {index:2,characterId:victim,paletteIndex:0,inputType:'keyboard_p2'}]};
 const sim=new MatchSim({matchConfig:config});
 for(let n=0;n<240;n++)sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
 const floor=sim.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid')!;
 const x=floor.position.x,top=floor.bounds.min.y;
 sim.p1.resetForRound(x,top-25);sim.p1.setFacing(facing);
 sim.p2.resetForRound(x+(hit?120:-180)*facing,top-sim.p2.getTuning().height/2);sim.p2.setFacing(-facing as 1|-1);
 for(let n=0;n<10;n++)sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
 if(air){sim.p1.resetForRound(x,top-25-160);sim.p1.setFacing(facing);}
 const frame=sim.physicsEngine.getFrame();
 for(const slot of sim.playerSlots)sim.consumeFinalEvents(sim.finalSmashController!.resetParticipant(slot.playerIndex,slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
 sim.consumeFinalEvents(sim.finalSmashController!.grantBall(0,frame),frame);
 sim.step([{...NEUTRAL_INPUT,special:true},NEUTRAL_INPUT]);
 return{sim,floor};
}
describe('Pikachu Final real production physics/contact route',()=>{
 for(const victim of ['donkeykong','pikachu','link']as const)for(const air of [false,true])for(const facing of [1,-1]as const){
  it(`captures and releases ${victim}, air=${air}, facing=${facing}`,()=>{
   const{sim}=fixture(victim,air,facing,true);
   try{
    const phases=new Set<string>();let captured=false,placed=false,maxDamage=0;
    for(let n=0;n<650;n++){
     sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);const run=sim.finalSmashController!.getActive();
     maxDamage=Math.max(maxDamage,sim.p2.getDamagePercent());
     if(!run)break;phases.add(run.phase);
     if(air&&run.phase==='dash'&&!placed){const p=sim.p1.getPosition();sim.matter.body.setPosition(sim.p2.body,{x:p.x+120*facing,y:p.y});sim.matter.body.setVelocity(sim.p2.body,{x:0,y:0});placed=true;}
     if(run.captures.length){captured=true;expect(sim.p2.getActiveHurtboxes().length).toBeGreaterThan(0);
      expect(sim.p2.getFinalVictimBodyPose()).not.toBeNull();expect(sim.p2.getFinalSmashControl()).toMatchObject({role:'captured',noDead:true,gravityDisabled:true});}
     if(run.phase==='finish'&&run.phaseAge>=9){expect(run.captures).toEqual([]);expect(sim.p2.getFinalVictimPresentationSelection()).toBeNull();}
    }
    expect(captured).toBe(true);expect(phases.has('attack')).toBe(true);expect(phases.has('return')).toBe(true);expect(phases.has('finish')).toBe(true);
    expect(maxDamage).toBeGreaterThanOrEqual(20);expect(sim.finalSmashController!.getActive()).toBeNull();
    expect(sim.p1.getFinalSmashControl()).toBeNull();expect(sim.p2.getFinalSmashControl()).toBeNull();expect(sim.p2.getFinalVictimPresentationSelection()).toBeNull();
   }finally{sim.dispose();}
  });
 }
 for(const air of [false,true])for(const facing of [1,-1]as const){
  it(`miss recovers with source braking and air gravity, air=${air}, facing=${facing}`,()=>{
   const{sim,floor}=fixture('donkeykong',air,facing,false);let firstMissY:number|null=null,lastMissY:number|null=null,missSteps=0;
   try{
    for(let n=0;n<400;n++){
     sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);const run=sim.finalSmashController!.getActive();if(!run)break;
     if(run.phase==='miss'){
      missSteps++;firstMissY??=sim.p1.getPosition().y;lastMissY=sim.p1.getPosition().y;
      expect(Math.abs(sim.p1.getVelocity().x)).toBeLessThanOrEqual(15+.001);
      if(!air){expect(sim.p1.getPosition().x).toBeGreaterThanOrEqual(floor.bounds.min.x+19);expect(sim.p1.getPosition().x).toBeLessThanOrEqual(floor.bounds.max.x-19);}
     }
    }
    expect(sim.finalSmashController!.getActive()).toBeNull();expect(sim.p2.getDamagePercent()).toBe(0);expect(missSteps).toBe(air?61:129);
    if(air)expect(lastMissY!).toBeGreaterThan(firstMissY!+20);
   }finally{sim.dispose();}
  });
 }
});


describe('Pikachu Final production interruption cleanup', () => {
 for (const reason of ['owner-reset', 'disconnect', 'match-end'] as const) {
  it(`restores owner and captive controls/presentation on ${reason}`, () => {
   const { sim } = fixture('link', false, 1, true);
   try {
    for (let n = 0; n < 200 && !sim.finalSmashController!.getActive()?.captures.length; n++) sim.step([NEUTRAL_INPUT, NEUTRAL_INPUT]);
    const run = sim.finalSmashController!.getActive()!; expect(run.captures).toHaveLength(1);
    const frame = sim.physicsEngine.getFrame();
    if (reason === 'owner-reset') {
     const p = sim.p1.getPosition(); sim.p1.resetForRound(p.x, p.y);
     sim.consumeFinalEvents(sim.finalSmashController!.resetParticipant(0, sim.p1.getPositionResetGeneration(), reason, 0), frame);
    } else sim.consumeFinalEvents(sim.finalSmashController!.finish(run.id, reason), frame);
    expect(sim.finalSmashController!.getActive()).toBeNull();
    expect(sim.p1.getFinalSmashControl()).toBeNull(); expect(sim.p2.getFinalSmashControl()).toBeNull();
    expect(sim.p2.getFinalVictimPresentationSelection()).toBeNull();
    expect(sim.p1.isFinalSmashNoDead()).toBe(false); expect(sim.p2.isFinalSmashNoDead()).toBe(false);
    expect(sim.p2.getActiveHurtboxes().length).toBeGreaterThan(0);
   } finally { sim.dispose(); }
  });
 }
});

// This exercises the actual owned-subsystem checkpoint, not the whole-match
// input-history reconstruction (the fixture intentionally injects resources).
// The saved snapshot includes real owner/captive actor state, leases, FX clock,
// capture anchors, contact receipts, motion clock and RNG.
it('restores a captured mid-Final checkpoint and reproduces every continuation step through release', () => {
 const {sim}=fixture('link',false,-1,true);let restored:MatchSim|null=null;
 try {
  for(let n=0;n<250;n++){
   sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
   const state=sim.finalChoreography!.snapshot().timeline;
   if(state?.kind==='pikachu'&&state.state.phase==='attack'&&state.state.age>=3)break;
  }
  expect(sim.finalSmashController!.getActive()?.captures).toHaveLength(1);
  const checkpoint=structuredClone(sim.captureFinalRuntimeSnapshot());
  expect(checkpoint.actors[1]!.lease.finalVictimPresentation).not.toBeNull();
  const project=(world:MatchSim)=>({controller:world.finalSmashController!.snapshot(),choreography:world.finalChoreography!.snapshot(),
   owner:world.p1.getFinalSmashLeaseSnapshot(),victim:world.p2.getFinalSmashLeaseSnapshot(),camera:world.finalCameraAnchor});
  const expected:ReturnType<typeof project>[]=[];
  for(let n=0;n<450;n++){sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);expected.push(structuredClone(project(sim)));if(!sim.finalSmashController!.getActive())break;}
  expect(sim.finalSmashController!.getActive()).toBeNull();
  // The owned restore contract requires the authoritative world at the saved
  // frame. Recreate that actual controlled setup/input path, then deliberately
  // clear every Final lease before restoring the saved owned subsystem. We do
  // not rewind an unrelated input-history buffer or claim whole-world restore.
  restored=fixture('link',false,-1,true).sim;
  while(restored.physicsEngine.getFrame()<checkpoint.frame)restored.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
  restored.consumeFinalEvents(restored.finalSmashController!.finish(checkpoint.controller!.active!.id,'disconnect'),checkpoint.frame);
  expect(restored.p2.getFinalVictimPresentationSelection()).toBeNull();
  restored.restoreFinalRuntimeSnapshot(checkpoint);
  expect(restored.finalSmashController!.getActive()?.captures).toHaveLength(1);
  expect(restored.p2.getFinalVictimPresentationSelection()).not.toBeNull();
  for(let n=0;n<expected.length;n++){
   restored.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
   expect(project(restored),`continuation step ${n+1}`).toEqual(expected[n]);
  }
  expect(restored.p2.getFinalSmashControl()).toBeNull();expect(restored.p2.getFinalVictimPresentationSelection()).toBeNull();
 }finally{sim.dispose();restored?.dispose();}
});
