import {describe, expect, it} from 'vitest';
import {mapDonkeyKongGrabDrawingAge, type DonkeyKongGrabDrawingClock,
  type DonkeyKongGrabTimeline} from './donkeykongGrabTimeline';

// Source standing: active ages[7,10), first actionability38. Independent
// source plan: full-three-grab-minimal-next-batch-plan-01.json, standing row.
const timeline: DonkeyKongGrabTimeline = {variant:'standing',startupFrames:7,activeFrames:3,recoveryFrames:28};
const clock = (phase:string,age:number, spec={startupFrames:7,activeFrames:3,whiffRecoveryFrames:28}):DonkeyKongGrabDrawingClock =>
  ({variant:'standing',phase,phaseFramesElapsed:age,spec});
describe('standing grab drawing phase boundaries, independent from catch execution',()=>{
  it.each([
    ['whiffStartup',0,0],['whiffStartup',6,6],['whiffActive',0,7],
    ['whiffActive',1,8],['whiffActive',2,9],['whiffRecovery',0,10],['whiffRecovery',27,37],
  ])('maps source %s age%s to drawing age%s',(phase,age,expected)=>{
    expect(mapDonkeyKongGrabDrawingAge(timeline,clock(String(phase),Number(age)))).toBe(expected);
  });
  it('resamples shortened startup and lengthened recovery without crossing active/clear boundaries',()=>{
    const spec={startupFrames:3,activeFrames:3,whiffRecoveryFrames:56};
    expect([0,1,2].map(age=>mapDonkeyKongGrabDrawingAge(timeline,clock('whiffStartup',age,spec))))
      .toEqual([0,2,4]);
    expect([0,1,2].map(age=>mapDonkeyKongGrabDrawingAge(timeline,clock('whiffActive',age,spec))))
      .toEqual([7,8,9]);
    expect([0,1,2,55].map(age=>mapDonkeyKongGrabDrawingAge(timeline,clock('whiffRecovery',age,spec))))
      .toEqual([10,10,11,37]);
  });
  it('resamples a longer active phase within sourced active drawings only',()=>{
    const spec={startupFrames:7,activeFrames:6,whiffRecoveryFrames:28};
    expect([0,1,2,3,4,5].map(age=>mapDonkeyKongGrabDrawingAge(timeline,clock('whiffActive',age,spec))))
      .toEqual([7,7,8,8,9,9]);
  });
  it('a repeated frozen snapshot selects the same drawing without altering timers',()=>{
    const input=Object.freeze(clock('whiffActive',1));
    const before=JSON.stringify(input);
    expect(mapDonkeyKongGrabDrawingAge(timeline,input)).toBe(8);
    expect(mapDonkeyKongGrabDrawingAge(timeline,input)).toBe(8);
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(['holding','throwing','idle','cooldown'])('does not retain whiff art after %s',phase=>{
    expect(mapDonkeyKongGrabDrawingAge(timeline,clock(phase,0))).toBeNull();
  });
  it('does not clamp a retired phase or wrong variant into its last pose',()=>{
    for(const [phase,age] of [['whiffStartup',7],['whiffActive',3],['whiffRecovery',28]] as const)
      expect(mapDonkeyKongGrabDrawingAge(timeline,clock(phase,age))).toBeNull();
    expect(mapDonkeyKongGrabDrawingAge(timeline,{...clock('whiffActive',0),variant:'dash'})).toBeNull();
  });
  it('rejects zero, invalid, fractional and unsafe phase clocks',()=>{
    for(const value of [-1,.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
      expect(mapDonkeyKongGrabDrawingAge(timeline,clock('whiffStartup',value))).toBeNull();
      expect(mapDonkeyKongGrabDrawingAge({...timeline,activeFrames:value},clock('whiffStartup',0))).toBeNull();
    }
    expect(mapDonkeyKongGrabDrawingAge(timeline,clock('whiffActive',0,{startupFrames:7,activeFrames:0,whiffRecoveryFrames:28}))).toBeNull();
    expect(mapDonkeyKongGrabDrawingAge({...timeline,activeFrames:0},clock('whiffActive',0))).toBeNull();
  });
});
