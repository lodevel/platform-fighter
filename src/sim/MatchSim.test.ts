import { describe, expect, it, vi } from 'vitest';
import { MatchSim } from './MatchSim';
import type { MatchConfig } from '../types';
import { NEUTRAL_INPUT } from '../replay/InputCaptureBuffer';

const config:MatchConfig={mode:'stocks',stockCount:3,stageId:'flat',rngSeed:20261013,itemFrequency:'off',linkIntroPolicy:'none',
  finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:false},players:[
    {index:1,characterId:'donkeykong',paletteIndex:0,inputType:'ai',aiDifficulty:'hard'},
    {index:2,characterId:'pikachu',paletteIndex:0,inputType:'ai',aiDifficulty:'hard'},
  ]};

describe('MatchSim production ownership',()=>{
  it('waits grounded through Link entry and hands off without teleporting the physics roots',()=>{
    const sim=new MatchSim({matchConfig:{...config,linkIntroPolicy:'source-entry-121',players:[
      {...config.players[0]!,characterId:'link'},config.players[1]!]}});
    try{
      const positions=sim.playerSlots.map(slot=>slot.character.getPosition());
      expect(sim.playerSlots.every(slot=>slot.character.isGrounded())).toBe(true);
      for(let n=0;n<121;n++)sim.advance(sim.physicsEngine.fixedTimestepMs);
      expect(sim.getSourceIntroSnapshot()).toBeNull();expect(sim.physicsEngine.getFrame()).toBe(0);
      expect(sim.getInputCaptureBuffer().size()).toBe(0);
      expect(sim.playerSlots.map(slot=>slot.character.getPosition())).toEqual(positions);
      sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
      sim.playerSlots.forEach((slot,index)=>expect(Math.hypot(slot.character.getPosition().x-positions[index]!.x,
        slot.character.getPosition().y-positions[index]!.y)).toBeLessThan(1));
    }finally{sim.dispose();}
  });
  it('fails boundedly if history reconstruction cannot advance instead of blocking the browser forever',()=>{
    const sim=new MatchSim({matchConfig:config,buildIdentity:`platform-fighter-sha256-${'a'.repeat(64)}`});
    sim.step();const checkpoint=sim.captureMatchHistoryCheckpoint();sim.dispose();
    const step=vi.spyOn(MatchSim.prototype,'step').mockReturnValue(0);
    try{expect(()=>new MatchSim({matchConfig:config,buildIdentity:checkpoint.buildIdentity,historyCheckpoint:checkpoint}))
      .toThrow('History reconstruction stopped before its target frame');}
    finally{step.mockRestore();}
  });
  it('reconstructs grounded entry support and its fractional clock before handing off',()=>{
    const live=new MatchSim({buildIdentity:`platform-fighter-sha256-${'c'.repeat(64)}`,matchConfig:{...config,
      linkIntroPolicy:'source-entry-121',players:[{...config.players[0]!,characterId:'link'},config.players[1]!]}});
    for(let n=0;n<53;n++)live.advance(live.physicsEngine.fixedTimestepMs);
    live.advance(live.physicsEngine.fixedTimestepMs/2);
    const before=live.captureMatchHistoryEvidence(),intro=live.getSourceIntroSnapshot();
    const restored=live.restoreMatchHistoryCheckpoint(live.captureMatchHistoryCheckpoint());
    try{
      expect(restored.captureMatchHistoryEvidence()).toBe(before);
      expect(restored.getSourceIntroSnapshot()).toEqual(intro);
      expect(restored.playerSlots.every(slot=>slot.character.isGrounded())).toBe(true);
      while(restored.getSourceIntroSnapshot())restored.advance(restored.physicsEngine.fixedTimestepMs);
      restored.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
      expect(restored.physicsEngine.getFrame()).toBe(1);
    }finally{restored.dispose();}
  });
  it('replays captured overrides while rebuilding the CPU state, independent of Matter absolute ids',()=>{
    const live=new MatchSim({matchConfig:config}),expected:string[]=[];
    for(let frame=0;frame<180;frame++){live.step();expected.push(live.getSimDigest().hash);}
    const timeline=live.getInputCaptureBuffer().getEntries();live.dispose();
    const replay=new MatchSim({matchConfig:config});replay.setRecordedInputs(timeline);
    for(const hash of expected){replay.step();expect(replay.getSimDigest().hash).toBe(hash);}
    replay.dispose();
  });

  it('restores a paused match and its exact fixed-step residue by replaying genuine history',()=>{
    const live=new MatchSim({matchConfig:config,buildIdentity:`platform-fighter-sha256-${'a'.repeat(64)}`});
    for(let frame=0;frame<90;frame++)live.advance(live.physicsEngine.fixedTimestepMs);
    live.advance(live.physicsEngine.fixedTimestepMs/2);live.pause();
    const evidence=live.captureMatchHistoryEvidence(),checkpoint=live.captureMatchHistoryCheckpoint();
    const restored=live.restoreMatchHistoryCheckpoint(checkpoint);
    expect(restored.captureMatchHistoryEvidence()).toBe(evidence);
    expect(restored.physicsEngine.isPaused()).toBe(true);
    expect(restored.physicsEngine.getLoop().getAccumulatorMs()).toBe(checkpoint.clock.accumulatorMs);
    expect(restored.step()).toBe(0);
    restored.resume();expect(restored.advance(restored.physicsEngine.fixedTimestepMs/2)).toBe(1);
    expect(restored.physicsEngine.getFrame()).toBe(91);restored.dispose();
  });

  it('keeps presentation reads out of canonical gameplay state and drains one-shots once',()=>{
    const sim=new MatchSim({matchConfig:config});sim.step([NEUTRAL_INPUT,NEUTRAL_INPUT]);
    sim.simEvents.push({kind:'sfx',key:'test'});
    const before=sim.captureMatchHistoryEvidence(),view=sim.view();
    expect(view.events).toContainEqual({kind:'sfx',key:'test'});
    expect(sim.captureMatchHistoryEvidence()).toBe(before);
    expect(sim.view().events).toEqual([]);
    expect(view.fighters).toHaveLength(2);expect(view.debugAreas?.length).toBeGreaterThan(0);sim.dispose();
  });

  it('normalizes Link contextual support identities after a previous match',()=>{
    const linkConfig={...config,players:[{...config.players[0]!,characterId:'link' as const},config.players[1]!]};
    const first=new MatchSim({matchConfig:linkConfig}),hashes:string[]=[];
    for(let frame=0;frame<40;frame++){first.step();hashes.push(first.getSimDigest().hash);}
    const inputs=first.getInputCaptureBuffer().getEntries();first.dispose();
    const second=new MatchSim({matchConfig:linkConfig});second.setRecordedInputs(inputs);
    for(const hash of hashes){second.step();expect(second.getSimDigest().hash).toBe(hash);}second.dispose();
  });

  it('publishes actual moving-platform centres and freezes stage clocks during match ending',()=>{
    const sim=new MatchSim({matchConfig:{...config,stageId:'moving-platform',stockCount:1}});
    for(let frame=0;frame<8;frame++)sim.step();
    const view=sim.view();expect(view.stageFrame).toBe(8);
    view.platforms!.forEach((platform,index)=>expect({x:platform.x,y:platform.y}).toEqual(sim.baseStage.bodies.platformBodies[index]!.position));
    sim.recordStockLossWithStats(0,sim.physicsEngine.getFrame());sim.step();
    const frozen=sim.view(),stageFrame=frozen.stageFrame;
    sim.step();const ending=sim.view();
    expect(ending.frame).toBe(frozen.frame+1);expect(ending.stageFrame).toBe(stageFrame);expect(ending.platforms).toEqual(frozen.platforms);sim.dispose();
  });
  it('keeps a repeating strike on its step clock when its attacker is hit earlier in the same contact batch',()=>{
    // Seed 20261022, frame 1043: P1's up-air hits P2 and ends P2's fair; P2's fair sensor is still in that
    // step's contact pairs against DK. The fair re-hits per target, so its contact needs the clock it had.
    const held=['homeRunBat','beamSword','starRod','rayGun','superScope','fireFlower'];
    const sim=new MatchSim({matchConfig:{mode:'time',timeLimitSeconds:190,stockCount:3,stageId:'flat',rngSeed:20261022,
      itemFrequency:'high',linkIntroPolicy:'none',itemSwitch:Object.fromEntries([...held,'hammer','bobOmb','crate','bananaPeel',
        'goldenHammer','food','heartContainer','maximTomato','barrel','capsule','smashBall'].map(type=>[type,held.includes(type)])),
      players:(['pikachu','pikachu','donkeykong','link'] as const).map((characterId,i)=>
        ({index:i+1,characterId,paletteIndex:i%2,inputType:'ai',aiDifficulty:'hard'}))} as MatchConfig});
    try{
      while(sim.physicsEngine.getFrame()<1043)sim.step();
      const [p1,p2]=sim.playerSlots.map(slot=>slot.character),damage=p2!.getDamagePercent();
      expect([p1!.getActiveAttack()?.move.id,p2!.getActiveAttack()?.move.id]).toEqual(['pikachu.up-air','pikachu.forward-air']);
      sim.step();
      expect(p2!.getDamagePercent()).toBeGreaterThan(damage);expect(p2!.getActiveAttack()).toBeNull();
    }finally{sim.dispose();}
  });
});
