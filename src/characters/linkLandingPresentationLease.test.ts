import {describe,it,expect} from 'vitest';
import {beginLinkLandingPresentationLease,stepLinkLandingPresentationLease,parseLinkLandingPresentationLease} from './linkLandingPresentationLease';
import {selectLinkLandingEquipment} from './linkLandingEquipment';
const entry={frame:100,generation:2,moveId:'renamed.uair',sourcePoseId:'link.uair',facing:-1 as const,landingLagFrames:15,
 equipmentAtEntry:{sword:'normal' as const,shield:'normal' as const,bow:'hidden' as const,heldItemVisible:true,ancientBowVisible:false}};
describe('genuine landing visual/equipment lease (prepared)',()=>{
 it('keeps callbacks22/28 after true public control exit without granting a lock',()=>{
  let state=beginLinkLandingPresentationLease(entry)!;
  for(let age=1;age<=28;age++){state=stepLinkLandingPresentationLease(state,{frame:100+age,generation:2,clockAdvances:true,controlActive:age<15,interrupted:false})!;
   if(age===15){expect(state.phase).toBe('tail');expect(state.rawAge).toBe(15);}
   if(age===22)expect(selectLinkLandingEquipment({motion:state.motion,scriptNativeFrame:state.rawAge,equipmentAtEntry:state.equipmentAtEntry}).equipment.heldItemVisible).toBe(true);
  }
  expect(selectLinkLandingEquipment({motion:state.motion,scriptNativeFrame:state.rawAge,equipmentAtEntry:state.equipmentAtEntry}).equipment.shield).toBe('normal');
 });
 it('freezes, ignores duplicate clocks and immediately yields on the same-step actual owner exit',()=>{
  const state=beginLinkLandingPresentationLease(entry)!;
  const frozen=stepLinkLandingPresentationLease(state,{frame:101,generation:2,clockAdvances:false,controlActive:true,interrupted:false})!;
  expect(frozen.rawAge).toBe(0);expect(stepLinkLandingPresentationLease(frozen,{frame:101,generation:2,clockAdvances:true,controlActive:true,interrupted:false})?.rawAge).toBe(0);
  expect(stepLinkLandingPresentationLease(frozen,{frame:101,generation:2,clockAdvances:false,controlActive:false,interrupted:true})).toBeNull();
 });
 it('retires at exact natural41 and never survives a participant generation or corrupted restored source identity',()=>{
  const state=beginLinkLandingPresentationLease(entry)!;
  expect(stepLinkLandingPresentationLease({...state,lastFrame:140,rawAge:40,phase:'tail'},{frame:141,generation:2,clockAdvances:true,controlActive:false,interrupted:false})).toBeNull();
  expect(stepLinkLandingPresentationLease(state,{frame:101,generation:3,clockAdvances:true,controlActive:true,interrupted:false})).toBeNull();
  expect(()=>parseLinkLandingPresentationLease({...state,origin:{...state.origin,sourcePoseId:'link.dair'}})).toThrow();
 });
});
