import { expect, it } from 'vitest';
import { MatchSim } from './MatchSim';
import { GAZE_DEFAULTS } from '../entities/GazeHazard';
import { NEUTRAL_INPUT } from '../replay/InputCaptureBuffer';

it('runs the real Inferno clock, KOs standing fighters, spares crouchers and reconstructs the hazard from history',()=>{
  const sim=new MatchSim({buildIdentity:`platform-fighter-sha256-${'b'.repeat(64)}`,matchConfig:{mode:'stocks',stockCount:3,
    stageId:'inferno',rngSeed:20261015,itemFrequency:'off',linkIntroPolicy:'none',finalSmashRules:{schemaVersion:1,meterEnabled:false,smashBallEnabled:false},
    players:[{index:1,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p1'},
      {index:2,characterId:'pikachu',paletteIndex:0,inputType:'keyboard_p2'}]}});
  const lethal=GAZE_DEFAULTS.startFrame+GAZE_DEFAULTS.riseFrames+GAZE_DEFAULTS.glareFrames;
  const inputs=[NEUTRAL_INPUT,{...NEUTRAL_INPUT,moveY:1}];
  for(let frame=0;frame<lethal-1;frame++)sim.step(inputs);
  expect(sim.stockTracker.getStocks(0)).toBe(3);expect(sim.stockTracker.getStocks(1)).toBe(3);
  sim.step(inputs);
  expect(sim.stockTracker.getStocks(0)).toBe(2);expect(sim.stockTracker.getStocks(1)).toBe(3);
  expect(sim.matchStatsTracker.getAllStats(lethal)[0]?.deaths).toBe(1);
  const flights=sim.view().knockoutFlights!;
  expect(flights).toHaveLength(1);expect(flights[0]).toMatchObject({playerIndex:0,characterId:'donkeykong',age:0,duration:100,scale:1,alpha:1});
  const evidence=sim.captureMatchHistoryEvidence();
  expect(JSON.parse(evidence).gaze[0].state.frame).toBe(lethal);
  const restored=sim.restoreMatchHistoryCheckpoint(sim.captureMatchHistoryCheckpoint());
  expect(restored.captureMatchHistoryEvidence()).toBe(evidence);
  expect(restored.view().knockoutFlights).toEqual(flights);
  restored.step(inputs);expect(restored.stockTracker.getStocks(0)).toBe(2);
  expect(restored.view().knockoutFlights![0]!.sourceRoot.y).toBeLessThan(flights[0]!.sourceRoot.y);
  for(let n=0;n<99;n++)restored.step(inputs);
  expect(restored.view().knockoutFlights).toEqual([]);expect(restored.stockTracker.getStocks(0)).toBe(2);restored.dispose();
},30000);
