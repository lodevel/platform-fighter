/** Prepared source extent/actionability separation; unrun. */
import {describe,it,expect} from 'vitest';
import {beginLinkGuardReleasePresentation,stepLinkGuardReleasePresentation,selectLinkGuardReleasePresentation,parseLinkGuardReleasePresentation} from './linkGuardReleasePresentation';
const entry=()=>beginLinkGuardReleasePresentation({playerIndex:0,generation:2,frame:100,facing:-1,acceptedRelease:true,
  equipment:{sword:'normal',shield:'back',bow:'back',heldItemVisible:true,ancientBowVisible:false}})!;
describe('actual GuardOff natural source tail',()=>{
  it('keeps raw11 through15 after independent public11 control unlock without new lock',()=>{
    let state=entry();for(let frame=101;frame<=115;frame++)state=stepLinkGuardReleasePresentation(state,{frame,generation:2,clockAdvances:true,interrupted:false})!;
    expect(selectLinkGuardReleasePresentation(state)).toMatchObject({motion:'guard_off',rawAge:15,facing:-1,equipment:{shield:'back'}});
    expect(stepLinkGuardReleasePresentation(state,{frame:116,generation:2,clockAdvances:true,interrupted:false})).toBeNull();
    expect(Object.hasOwn(state,'controlsLocked')).toBe(false);
  });
  it('freezes duplicate/local-stop source samples and clears actual new-owner/gen interruption',()=>{
    const state=entry(),stopped=stepLinkGuardReleasePresentation(state,{frame:101,generation:2,clockAdvances:false,interrupted:false})!;
    expect(stopped.rawAge).toBe(0);expect(stepLinkGuardReleasePresentation(stopped,{frame:101,generation:2,clockAdvances:true,interrupted:false})?.rawAge).toBe(0);
    expect(stepLinkGuardReleasePresentation(stopped,{frame:102,generation:2,clockAdvances:true,interrupted:true})).toBeNull();
    expect(stepLinkGuardReleasePresentation(state,{frame:101,generation:3,clockAdvances:true,interrupted:false})).toBeNull();
  });
  it('restores original actual release identity/gear and rejects impossible callback history',()=>{
    const state=entry();expect(parseLinkGuardReleasePresentation(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(()=>parseLinkGuardReleasePresentation({...state,generation:3})).toThrow();
    expect(()=>parseLinkGuardReleasePresentation({...state,rawAge:11})).toThrow();
    expect(()=>parseLinkGuardReleasePresentation({...state,extra:true})).toThrow();
  });
});
