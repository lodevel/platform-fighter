import {describe,it,expect} from 'vitest';
import {ultimateCaptureFrames,initialCaptureMash,tickCaptureMash,reducedCaptureFrames,captureMashHeld} from './ultimateCapture';
const neutral={moveX:0,jump:false};
describe('published Ultimate ordinary-grab budget and logical mash adapter',()=>{
 it('latches rounded-down entry percentage budget',()=>{expect(ultimateCaptureFrames(0)).toBe(90);expect(ultimateCaptureFrames(33.3)).toBe(146);expect(()=>ultimateCaptureFrames(NaN)).toThrow();});
 it('spinning cardinals registers one8-frame event each frame, with minimum TOTAL19',()=>{
  let state=initialCaptureMash(neutral);const moves=[{moveX:1},{moveX:0,moveY:1},{moveX:-1},{moveX:0,moveY:-1}];
  for(let frame=1;frame<=20;frame++)state=tickCaptureMash(state,{...neutral,...moves[(frame-1)%4]},frame);
  expect(state.reduction).toBe(160);expect(reducedCaptureFrames(90,state)).toBe(19);
 });
 it('held buttons, multiple bindings of attack, and appeal/C-stick cannot add extra reductions',()=>{
  let state=initialCaptureMash(neutral);state=tickCaptureMash(state,{...neutral,attack:true,attackHeavy:true},1);
  for(let frame=2;frame<10;frame++)state=tickCaptureMash(state,{...neutral,attack:true},frame);
  expect(state.reduction).toBe(14.4);expect(captureMashHeld({...neutral,appeal:true,attackHeavy:true,attackStickX:1})).toEqual([]);
 });
 it('same button needs2 steps but a different action or next stick needs3',()=>{
  let state=initialCaptureMash(neutral);state=tickCaptureMash(state,{...neutral,jump:true},1);
  state=tickCaptureMash(state,neutral,2);state=tickCaptureMash(state,{...neutral,jump:true},3);expect(state.reduction).toBe(28.8);
  state=tickCaptureMash(state,{...neutral,special:true},4);expect(state.reduction).toBe(28.8);
  state=tickCaptureMash(state,{...neutral,moveX:1},5);expect(state.reduction).toBe(28.8);
  state=tickCaptureMash(state,{...neutral,moveX:-1},6);expect(state.reduction).toBe(36.8);
 });
 it('capture begins from actual already-held inputs rather than inventing a fresh press',()=>{const state=initialCaptureMash({...neutral,jump:true,moveX:1});expect(tickCaptureMash(state,{...neutral,jump:true,moveX:1},1).reduction).toBe(0);});
 it('tie arbitration is explicit and never counts two inputs in one frame',()=>{const state=tickCaptureMash(initialCaptureMash(neutral),{...neutral,moveX:1,jump:true},1);expect(state.reduction).toBe(8);expect(state.lastAccepted?.action).toBe('right');});
});
