/** Prepared actual adapter boundary fixtures. No source/art/runtime qualification. */
import {describe,it,expect} from 'vitest';
import {FinalSmashController} from './FinalSmashController';
import {FinalSmashChoreography,type FinalActorView,type FinalChoreographyWorld} from './FinalSmashChoreography';
import type {FinalSmashActorControl} from './finalSmashActorControl';
import type {FinalVictimPresentationState} from './finalVictimPresentation';
function harness(){
  const actors=new Map<number,FinalActorView>([
    [0,{playerIndex:0,fighter:'donkeykong',generation:2,root:{x:0,y:0},centre:{x:0,y:-50},facing:1,grounded:true,hitlag:false,eligibleVictim:true}],
    [1,{playerIndex:1,fighter:'link',generation:7,root:{x:10,y:0},centre:{x:10,y:-36},facing:-1,grounded:true,hitlag:false,eligibleVictim:true}],
  ]);
  const controller=new FinalSmashController({schemaVersion:1,meterEnabled:false,smashBallEnabled:true},[
    {playerIndex:0,fighter:'donkeykong',generation:2},{playerIndex:1,fighter:'link',generation:7}]);
  const presentations=new Map<number,FinalVictimPresentationState|null>(),controls=new Map<number,FinalSmashActorControl|null>(),
    order:string[]=[],hits:Array<{label:string;captured:boolean;captiveNoDead:boolean}>=[];
  const world:FinalChoreographyWorld={actor:i=>actors.get(i)??null,equipment:()=>null,retainBodyTail:()=>{},lease:(i,control)=>{controls.set(i,control);if(i===1&&control===null)order.push('control-release');},moveRoot:()=>{},
    victimPresentation:(i,state)=>{presentations.set(i,state);if(i===1&&state===null)order.push('visual-release');},contacts:()=>[{target:1,packetId:0,damageMultiplier:1}],
    hit:(_run,_strike,_contact,label)=>{hits.push({label,captured:presentations.get(1)?.kind==='captured',captiveNoDead:controls.get(1)?.role==='captured'&&controls.get(1)?.noDead===true});
      if(label==='dk-finisher')order.push('finisher');return true;},
    groundRay:()=>true,cliffStopVelocity:(_owner,velocity)=>velocity,captureAnchor:()=>({x:10,y:-36}),captureRoot:(_recipient,pocket)=>({x:pocket.x,y:pocket.y+36}),linkEvent:()=>{},camera:()=>{}};
  const choreography=new FinalSmashChoreography(controller,world,5,16/9);
  controller.grantBall(0,0);
  choreography.consume(controller.activate([{playerIndex:0,fighter:'donkeykong',generation:2,neutralSpecialEdge:true,
    legallyActionable:true,airborne:false}],0),0);
  const step=(frame:number)=>{choreography.beforeStep(frame,false);choreography.afterPhysics(frame);};
  return {actors,controller,presentations,controls,order,hits,choreography,step};
}
describe('real choreography cinematic recipient joins',()=>{
  it('borrows detector admission age28, freezes, confirms one pulse and rejects changed checkpoint owner age',()=>{
    const h=harness();for(let frame=1;frame<=28;frame++)h.step(frame);
    expect(h.presentations.get(1)).toMatchObject({kind:'captured',phase:'jungle-entry',phaseAge:28,facing:-1,victimGeneration:7});
    expect(h.controls.get(1)).toMatchObject({role:'captured',noDead:true});
    h.actors.set(0,{...h.actors.get(0)!,hitlag:true});h.step(29);
    expect(h.presentations.get(1)).toMatchObject({phaseAge:28});
    h.actors.set(0,{...h.actors.get(0)!,hitlag:false});for(let frame=30;frame<=42;frame++)h.step(frame);
    const first=h.presentations.get(1);expect(first).toMatchObject({phase:'jungle-barrage',jungleReactionKey:1});
    h.choreography.afterPhysics(42);expect(h.presentations.get(1)).toEqual(first);
    const snapshot=h.choreography.snapshot();
    expect(()=>h.choreography.restore({...snapshot,victimPresentations:snapshot.victimPresentations.map(s=>({...s,phaseAge:0}))})).toThrow();
    h.choreography.restore(snapshot);expect(h.presentations.get(1)).toEqual(first);
  });
  it('ends actual capture and its visual/noDead owner before the released finisher',()=>{
    const h=harness();for(let frame=1;frame<=180;frame++)h.step(frame);
    expect(h.hits.filter(hit=>hit.label==='dk-finisher')).toEqual([{label:'dk-finisher',captured:false,captiveNoDead:false}]);
    expect(h.presentations.get(1)).toBeNull();expect(h.controller.getActive()?.captures).toEqual([]);
    expect(h.order).toEqual(['control-release','visual-release','finisher']);
  });
});
