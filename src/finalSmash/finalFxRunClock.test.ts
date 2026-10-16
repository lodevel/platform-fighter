import {describe,it,expect} from 'vitest';
import sourceFacts from './finalFxCueFacts.json';
import {parseFinalFxCueFacts,selectFinalFxPresentation} from './finalFxProfiles';
import {stepFinalFxRunClock,parseFinalFxRunClock} from './finalFxRunClock';
import type {FinalSmashActorControl} from './finalSmashActorControl';
const facts=parseFinalFxCueFacts(sourceFacts);
const carry=facts.find(c=>c.clockDomain==='run-flight'&&c.motion==='final')!;
const control=(phase:string,age:number,sheet:string):FinalSmashActorControl=>({runId:7,role:'owner',phase,age,sheet,
  facing:1,intangible:true,noDead:true,terrainBypass:true,jostle:false,gravityDisabled:true,velocity:null});
const step=(state:ReturnType<typeof stepFinalFxRunClock>,frame:number,phase:string,age:number,sheet:string,clockAdvances=true)=>
  stepFinalFxRunClock(state,{frame,ownerIndex:0,generation:2,control:control(phase,age,sheet),clockAdvances,facts});
describe('actual Final effect run carry',()=>{
  it('arms source startup50, displays its own age, then starts flight art at real Dash admission',()=>{
    const before=step(null,49,'startup',49,'final')!;expect(before.armed).toEqual([]);
    const armed=step(before,50,'startup',50,'final')!;expect(armed.armed.map(r=>r.cueKey)).toContain(carry.key);
    expect(step(armed,53,'startup',53,'final')!.elapsed).toBe(3);
    const dash=step(armed,63,'dash',0,'final_dash')!;expect(dash.elapsed).toBe(0);
    expect(dash.flightEntryFrame).toBe(63);
  });
  it('keeps the same carry through a same-frame hit, phase age resets and owner stop',()=>{
    const armed=step(null,50,'startup',50,'final')!,dash=step(armed,63,'dash',0,'final_dash')!;
    const hit=step(dash,63,'hit',0,'final_hit')!;expect(hit.armed).toEqual(dash.armed);expect(hit.elapsed).toBe(0);
    const attack=step(hit,64,'attack',0,'final_attack')!;expect(attack.elapsed).toBe(1);
    const stopped=step(attack,65,'attack',0,'final_attack',false)!;expect(stopped.elapsed).toBe(1);
    expect(step(stopped,66,'attack2',0,'final_attack')!.elapsed).toBe(2);
  });
  it('retires on the true finish and does not transfer an old run admission',()=>{
    const armed=step(null,50,'startup',50,'final')!;expect(step(armed,63,'finish',0,'final_end')).toBeNull();
    const next=stepFinalFxRunClock(armed,{frame:64,ownerIndex:0,generation:3,control:{...control('dash',0,'final_dash'),runId:8},clockAdvances:true,facts})!;
    expect(next.armed).toEqual([]);expect(next.flightEntryFrame).toBeNull();
  });
  it('rejects a fabricated flight lease without startup receipt',()=>{
    const armed=step(null,50,'startup',50,'final')!;
    expect(()=>parseFinalFxRunClock({...armed,armed:[],flightEntryFrame:50},facts)).toThrow();
    expect(()=>parseFinalFxRunClock({...armed,armed:[...armed.armed,...armed.armed]},facts)).toThrow();
  });
  it('reports missing active art, while expired finite pulses create no false missing-art dependency',()=>{
    const source=facts.find(c=>c.clockDomain==='owner-motion'&&c.selection.repeatEveryFrames===null)!;
    // Analytical selector counterexample: an open cue window must still obey a finite pulse lifetime.
    const pulse={...source,selection:{...source.selection,endAgeExclusive:null}};
    const sample=(age:number)=>selectFinalFxPresentation([pulse],new Map(),{fighter:pulse.fighter,ownerIndex:0,generation:2,
      control:control(pulse.phases[0]!,age-pulse.selection.bodyAgeOffset,pulse.motion),sourceRoot:{x:0,y:0},points:[],bodyAvailable:false,flightClock:null});
    expect(sample(pulse.selection.startAge).dependencies).toContain(`Missing authored Final FX profile ${pulse.key}`);
    expect(sample(pulse.selection.startAge+pulse.selection.lifetimeFrames!).dependencies).toEqual([]);
  });
});
