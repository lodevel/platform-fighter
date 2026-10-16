import {describe,expect,it} from 'vitest';
import {MatchSim} from '../sim/MatchSim';
import {NEUTRAL_INPUT} from '../replay/InputCaptureBuffer';
import type {CharacterId,MatchConfig} from '../types';
import {finalBodyPose} from './finalBodyPose';

function fixture(victim:CharacterId,air:boolean,facing:1|-1){
 const config:MatchConfig={mode:'stocks',stockCount:5,stageId:'flat',rngSeed:1511,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:true},players:[
   {index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},
   {index:2,characterId:victim,paletteIndex:0,inputType:'keyboard_p2'}]};
 const sim=new MatchSim({matchConfig:config});
 for(let n=0;n<240;n++)sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
 const floor=sim.baseStage.bodies.platformBodies.find(b=>b.label==='platform.solid')!;
 const x=floor.position.x,top=floor.bounds.min.y;
 sim.p1.resetForRound(x,top-sim.p1.getTuning().height/2);sim.p1.setFacing(facing);
 sim.p2.resetForRound(x+100*facing,top-sim.p2.getTuning().height/2);sim.p2.setFacing(-facing as 1|-1);
 for(let n=0;n<10;n++)sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
 if(air){sim.p1.resetForRound(x,top-sim.p1.getTuning().height/2-160);sim.p1.setFacing(facing);}
 const frame=sim.physicsEngine.getFrame();
 for(const slot of sim.playerSlots)sim.consumeFinalEvents(sim.finalSmashController!.resetParticipant(slot.playerIndex,slot.character.getPositionResetGeneration(),'owner-reset',0),frame);
 sim.consumeFinalEvents(sim.finalSmashController!.grantBall(0,frame),frame);
 sim.step([{...NEUTRAL_INPUT,special:true},NEUTRAL_INPUT]);
 return sim;
}

// Real production Matter contacts and combat, not a choreography fake. Air
// targets are arranged once immediately before the startup receiving window;
// accepted captives then use only the production paired punch-pocket adapter.
describe('DK Final installed native owner drawings and production contacts',()=>{
 it('pairs all six actual native clocks with source packet roles and explicit authored anchors',()=>{
  for(const air of [false,true])for(const [suffix,end,role,count] of [
   ['start',99,'dk-detection',1],['attack',133,'dk-early',5],['end',air?49:89,'dk-finisher',4],
  ]as const){
   const sheet=`final_${air?'air_':''}${suffix}`;
   for(const age of [0,5,6,28,Math.min(33,end),end]){
    const pose=finalBodyPose('donkeykong',sheet,age,role)!;
    expect(pose,sheet).not.toBeNull();expect(pose.sample).toBeLessThanOrEqual(age);
    expect(pose.bodyCentreFromRootY).toBe(-42);expect(pose.scaleToWorld).toBeCloseTo(5/14.6636,14);
    expect(pose.receiving.length).toBe(15);expect(pose.outgoing.length).toBe(count);
    expect(pose.attachments.map(a=>a.role)).toEqual(['capture-anchor','waist']);
    expect(pose.effectPoints.map(p=>p.bone)).toEqual(['top','hip']);
   }
   expect(finalBodyPose('donkeykong',sheet,end,role)?.sample).toBe(end);
  }
 });
 for(const victim of ['donkeykong','pikachu','link']as const)for(const air of [false,true])for(const facing of [1,-1]as const){
  it(`damages and releases ${victim}, air=${air}, facing=${facing}`,()=>{
   const sim=fixture(victim,air,facing);
   const accepted:Array<{role:string;strike:string;captured:boolean;noDead:boolean}>=[];
   const hit=sim.finalHit.bind(sim);
   sim.finalHit=(...args)=>{
    const captured=sim.p2.getFinalSmashControl()?.role==='captured',noDead=sim.p2.isFinalSmashNoDead();
    const result=hit(...args);
    if(result)accepted.push({role:args[3],strike:args[1],captured,noDead});
    return result;
   };
   try{
    const phases=new Set<string>();let captured=false,maxDamage=0,arranged=false,debugChecked=false,anchoredReactions=0;
    for(let n=0;n<350;n++){
     const before=sim.finalSmashController!.getActive();
     if(before?.phase==='start'&&before.phaseAge===27&&!arranged){
      // Only a setup operation; no target teleporting during the cutscene.
      const root=sim.p1.getSourceRootPosition();
      sim.matter.body.setPosition(sim.p2.body,{x:root.x+100*facing,y:root.y-sim.p2.getTuning().height/2});
      sim.matter.body.setVelocity(sim.p2.body,{x:0,y:0});arranged=true;
     }
     const receiptsBefore=accepted.length;
     sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
     if(accepted.slice(receiptsBefore).some(h=>h.role==='dk-early'||h.role==='dk-late')){
      const fit=sim.getFinalVictimFitSnapshot()[0]!;
      expect(fit.victimAnchor).not.toBeNull();expect(fit.ownerPocket).not.toBeNull();
      expect(fit.victimAnchor!.x).toBeCloseTo(fit.ownerPocket!.x,8);
      expect(fit.victimAnchor!.y).toBeCloseTo(fit.ownerPocket!.y,8);anchoredReactions++;
     }
     if(!debugChecked&&sim.finalContactDebugCapsules.length){
      const before=sim.getSimDigest().hash,areas=sim.view().debugAreas!;
      expect(areas.filter(a=>a.kind==='attack'&&a.capsule&&sim.finalContactDebugCapsules.includes(a.capsule)).map(a=>a.capsule))
       .toEqual(sim.finalContactDebugCapsules);
      expect(sim.getSimDigest().hash).toBe(before);debugChecked=true;
     }
     const run=sim.finalSmashController!.getActive();maxDamage=Math.max(maxDamage,sim.p2.getDamagePercent());
     if(!run)break;phases.add(run.phase);
     if(run.captures.length){
      captured=true;expect(sim.p2.getFinalVictimBodyPose()).not.toBeNull();
      expect(sim.p2.getActiveHurtboxes().length).toBeGreaterThan(0);
      expect(sim.p2.getFinalSmashControl()).toMatchObject({role:'captured',noDead:true,gravityDisabled:true});
     }
    }
    expect(arranged).toBe(true);expect(captured).toBe(true);expect(debugChecked).toBe(true);expect([...phases]).toEqual(['start','success','end']);
    expect(accepted.filter(h=>h.role==='dk-detection')).toHaveLength(1);
    expect(accepted.filter(h=>h.role==='dk-early')).toHaveLength(18);
    expect(accepted.filter(h=>h.role==='dk-late')).toHaveLength(13);
    expect(anchoredReactions).toBe(31);
    expect(accepted.filter(h=>h.role==='dk-finisher')).toEqual([{role:'dk-finisher',strike:'finisher',captured:false,noDead:false}]);
    expect(maxDamage).toBeGreaterThan(50);
    expect(sim.finalSmashController!.getActive()).toBeNull();
    expect(sim.p1.getFinalSmashControl()).toBeNull();expect(sim.p2.getFinalSmashControl()).toBeNull();
    expect(sim.p2.getFinalVictimPresentationSelection()).toBeNull();
    expect(sim.finalContactDebugCapsules).toEqual([]);
   }finally{sim.dispose();}
  });
 }
 for(const air of [false,true])it(`recovers from a startup miss, air=${air}`,()=>{
  const sim=fixture('link',air,1);
  try{
   sim.matter.body.setPosition(sim.p2.body,{x:sim.p1.getPosition().x-250,y:sim.p2.getPosition().y});
   let frames=0;
   while(sim.finalSmashController!.getActive()&&frames++<140)sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
   expect(frames).toBe(98);expect(sim.p2.getDamagePercent()).toBe(0);
   expect(sim.p1.getFinalSmashControl()).toBeNull();expect(sim.p2.getFinalVictimBodyPose()).toBeNull();
  }finally{sim.dispose();}
 });
});
