/** Prepared strict transport cases, not executed before final phase. */
import {describe,it,expect} from 'vitest';
import {parseMatchHistoryCheckpoint,matchHistoryJson} from './MatchHistoryCheckpoint';
import {serializeReplay} from './ReplayFile';
import {InputCaptureBuffer,NEUTRAL_INPUT} from './InputCaptureBuffer';
import {InputBindingsStore} from '../input/InputBindingsStore';
import {serializeBindingsSnapshot} from '../input/InputBindingsSerializer';
import {InputResolver} from '../input/InputResolver';
import {DeviceInputDispatcher} from '../input/DeviceInputDispatcher';
const identity=`platform-fighter-sha256-${'a'.repeat(64)}`;
const make=()=>{const input=new InputCaptureBuffer({playerCount:2});input.captureFrame(0,[{...NEUTRAL_INPUT,moveX:.65,attack:true},NEUTRAL_INPUT]);
  return {schema:'match-history-checkpoint/1',buildIdentity:identity,frame:1,viewport:{width:1280,height:720},
    replay:serializeReplay({matchConfig:{mode:'stocks',stockCount:3,stageId:'flat',rngSeed:41,linkIntroPolicy:'none',
      players:[{index:1,characterId:'link',paletteIndex:0,inputType:'keyboard_p1'},
        {index:2,characterId:'donkeykong',paletteIndex:0,inputType:'keyboard_p2'}]},capturedFrames:input.getEntries(),
      engineVersion:identity,recordedAt:new Date(0)}),bindingsSnapshot:serializeBindingsSnapshot(new InputBindingsStore().snapshot()),
    inputResolver:new InputResolver({dispatcher:{} as DeviceInputDispatcher,slots:[1,2]}).captureHistoryState(),
    sceneInput:{prevStartHeld:false},
    customStage:null,characterOverrides:[],constructionPositions:[{playerIndex:0,x:400,y:300}],stageIdentity:'exact-resolved-stage-json',worldEvidence:JSON.stringify({schema:'match-history-evidence/1',frame:1}),labMode:false,intro:null,clock:{accumulatorMs:0,paused:false,pausedForMenu:false}};};
describe('authoritative whole-world history checkpoint transport',()=>{
  it('retains full resolved action input/analog, saved bindings, seed and real initial construction event',()=>{
    const loaded=parseMatchHistoryCheckpoint(JSON.parse(matchHistoryJson(make())),identity);
    expect(loaded.replay.inputTimeline.entries[0]?.inputs[0]).toMatchObject({moveX:.65,attack:true});
    expect(loaded.replay.rngSeed).toBe(41);expect(loaded.constructionPositions).toEqual([{playerIndex:0,x:400,y:300}]);
  });
  it('rejects incompatible build, missing frame and pretending an input gap is neutral',()=>{
    const original=make();expect(()=>parseMatchHistoryCheckpoint(original,`${identity.slice(0,-1)}b`)).toThrow();
    expect(()=>parseMatchHistoryCheckpoint({...original,frame:2},identity)).toThrow();
    expect(()=>parseMatchHistoryCheckpoint({...original,replay:{...original.replay,inputTimeline:{...original.replay.inputTimeline,
      entries:[{...original.replay.inputTimeline.entries[0],frame:1}]}}},identity)).toThrow();
  });
  it('rejects invalid measured operands, unknown fields and incompatible participant construction',()=>{
    expect(()=>matchHistoryJson({...make(),viewport:{width:NaN,height:720}})).toThrow();
    expect(()=>parseMatchHistoryCheckpoint({...make(),injectedHealth:0},identity)).toThrow();
    expect(()=>parseMatchHistoryCheckpoint({...make(),constructionPositions:[{playerIndex:3,x:0,y:0}]},identity)).toThrow();
  });
  it('preserves a held gamepad START edge independently of the resolved gameplay action cache',()=>{
    expect(parseMatchHistoryCheckpoint({...make(),sceneInput:{prevStartHeld:true}},identity).sceneInput.prevStartHeld).toBe(true);
    expect(()=>parseMatchHistoryCheckpoint({...make(),sceneInput:{prevStartHeld:1}},identity)).toThrow();
    expect(()=>parseMatchHistoryCheckpoint({...make(),sceneInput:{prevStartHeld:true,forcedPause:true}},identity)).toThrow();
  });
});
