/** Prepared only; run in the complete final verification. */
import {describe,it,expect} from 'vitest';
import {advanceLinkAirPresentation,selectLinkAirPresentation,parseLinkAirPresentationState,type LinkAirObservation} from './linkAirPresentation';
const base:LinkAirObservation={generation:1,frame:1,clockAdvances:true,grounded:false,bodyAvailable:true,
  helpless:false,tumbling:false,facing:1,velocity:{x:0,y:-5},jumpEventSerial:1,fallOwner:'ordinary',
  jump:{kind:'ground',facing:1,moveX:0,velocityX:0,shortHop:true,framesElapsed:8}};
describe('actual Link air motion admission',()=>{
  it('uses latched short-hop takeoff facing rather than later air steering',()=>{
    const s=advanceLinkAirPresentation(null,{...base,facing:-1,velocity:{x:-4,y:-5}});
    expect(selectLinkAirPresentation(s)).toMatchObject({motion:'jump_f_mini',rawAge:8,facing:1});
    expect(advanceLinkAirPresentation(null,{...base,jump:{...base.jump!,velocityX:-2}}).motion).toBe('jump_b_mini');
  });
  it('admits an independent fall clock at the actual apex',()=>{
    const jump=advanceLinkAirPresentation(null,base);
    const fall=advanceLinkAirPresentation(jump,{...base,frame:2,velocity:{x:0,y:0}});
    expect(fall).toMatchObject({motion:'fall',rawAge:0});
    expect(advanceLinkAirPresentation(fall,{...base,frame:3,velocity:{x:0,y:3}}).rawAge).toBe(1);
  });
  it('freezes local stop, deduplicates consumers and never catches up skipped ticks',()=>{
    const fall=advanceLinkAirPresentation(null,{...base,velocity:{x:2,y:3}});
    const stop=advanceLinkAirPresentation(fall,{...base,frame:2,clockAdvances:false,velocity:{x:2,y:3}});
    expect(stop.rawAge).toBe(0);
    expect(advanceLinkAirPresentation(stop,{...base,frame:2,velocity:{x:-2,y:3}})).toBe(stop);
    expect(advanceLinkAirPresentation(stop,{...base,frame:100,velocity:{x:2,y:3}}).rawAge).toBe(1);
  });
  it('selects aerial and helpless drift from actual current velocity',()=>{
    expect(advanceLinkAirPresentation(null,{...base,jump:{...base.jump!,kind:'air'},velocity:{x:-2,y:3}}).motion).toBe('fall_aerial_b');
    expect(advanceLinkAirPresentation(null,{...base,helpless:true,velocity:{x:2,y:-3}}).motion).toBe('fall_special_f');
  });
  it('requires an actual tumble exit for DamageFall and clears it on a new jump',()=>{
    const tumble=advanceLinkAirPresentation(null,{...base,tumbling:true,fallOwner:'tumble'});
    const released=advanceLinkAirPresentation(tumble,{...base,frame:2,velocity:{x:1,y:-3}});
    expect(released.motion).toBe('fall_damage');
    expect(advanceLinkAirPresentation(released,{...base,frame:3,jumpEventSerial:2,jump:{...base.jump!,kind:'air',framesElapsed:0}}).motion).toBe('jump_aerial_f');
  });
  it('resets at ground/generation and excludes footstool or committed presentation',()=>{
    const s=advanceLinkAirPresentation(null,base);
    expect(selectLinkAirPresentation(advanceLinkAirPresentation(s,{...base,frame:2,grounded:true}))).toBeNull();
    expect(advanceLinkAirPresentation(s,{...base,generation:2,frame:0,velocity:{x:0,y:2}}).rawAge).toBe(0);
    expect(selectLinkAirPresentation(advanceLinkAirPresentation(null,{...base,bodyAvailable:false}))).toBeNull();
    expect(selectLinkAirPresentation(advanceLinkAirPresentation(null,{...base,fallOwner:'footstool'}))).toBeNull();
    expect(()=>advanceLinkAirPresentation(s,{...base,frame:0})).toThrow();
  });
  it('rejects incompatible checkpoint motion owners before restoring a clock',()=>{
    const jump=advanceLinkAirPresentation(null,base);
    expect(parseLinkAirPresentationState(JSON.parse(JSON.stringify(jump)))).toEqual(jump);
    expect(()=>parseLinkAirPresentationState({...jump,phase:'fall'})).toThrow();
    expect(()=>parseLinkAirPresentationState({...jump,damageFall:true})).toThrow();
    expect(()=>parseLinkAirPresentationState({...jump,rawAge:null})).toThrow();
  });
});
