import {describe,it,expect} from 'vitest';
import {admitLinkCaptureEquipmentOwner,stepLinkCaptureEquipmentLease,parseLinkCaptureEquipmentLease} from './linkCaptureEquipmentLease';
import {selectLinkCaptureActionEquipment} from './linkCaptureActionEquipment';
import {LINK_NORMAL_EQUIPMENT} from './linkEquipment';
const inventory={...LINK_NORMAL_EQUIPMENT};
const owner={motion:'catch_dash' as const,rawAge:0,facing:1 as const,ownerKey:'grab:0:1:20',groupKey:'capture-group:0:1:20',captureKey:null,entryFrame:20,generation:1};
describe('actual capture equipment ownership (prepared, execution deferred)',()=>{
 it('keeps delayed dash entry baseline until native2, without a new action lock',()=>{
  let state=admitLinkCaptureEquipmentOwner(null,owner,20,inventory,{...inventory,shield:'back'});
  expect(selectLinkCaptureActionEquipment({motion:state.motion,scriptNativeFrame:state.rawAge+1,equipmentAtEntry:state.equipmentAtEntry}).equipment.shield).toBe('normal');
  state=stepLinkCaptureEquipmentLease(state,{frame:21,generation:1,clockAdvances:true,owner:{...owner,rawAge:1},interrupted:false})!;
  expect(selectLinkCaptureActionEquipment({motion:state.motion,scriptNativeFrame:state.rawAge+1,equipmentAtEntry:state.equipmentAtEntry}).equipment.shield).toBe('back');
 });
 it('inherits a real same-capture transition and resets an independent new admission',()=>{
  const state=admitLinkCaptureEquipmentOwner(null,owner,20,inventory,inventory),back={...inventory,shield:'back' as const};
  const pummel=admitLinkCaptureEquipmentOwner(state,{...owner,motion:'catch_attack',ownerKey:'pummel:accepted:21',captureKey:'recipient:1:2:7',entryFrame:21},21,inventory,back);
  expect(pummel.equipmentAtEntry.shield).toBe('back');
  const newGrab=admitLinkCaptureEquipmentOwner(pummel,{...owner,groupKey:'capture-group:0:1:80',ownerKey:'grab:0:1:80',entryFrame:80},80,inventory,back);
  expect(newGrab.equipmentAtEntry.shield).toBe('normal');
 });
 it('advances an interruptible throw tail through restore callback without extending control',()=>{
  const throwing={...owner,motion:'throw_hi' as const,ownerKey:'throw:accepted:7',rawAge:50,entryFrame:20,captureKey:'recipient:1:2:7'};
  let state=admitLinkCaptureEquipmentOwner(null,throwing,70,inventory,inventory);
  state=stepLinkCaptureEquipmentLease(state,{frame:71,generation:1,clockAdvances:true,owner:null,interrupted:false})!;
  expect(state.phase).toBe('tail');
  state=stepLinkCaptureEquipmentLease({...state,rawAge:56,lastFrame:76},{frame:77,generation:1,clockAdvances:true,owner:null,interrupted:false})!;
  expect(selectLinkCaptureActionEquipment({motion:state.motion,scriptNativeFrame:state.rawAge+1,equipmentAtEntry:state.equipmentAtEntry}).equipment.shield).toBe('normal');
  expect(stepLinkCaptureEquipmentLease(state,{frame:77,generation:1,clockAdvances:false,owner:null,interrupted:true})).toBeNull();
 });
 it('does not append a twenty-fifth pummel sample after the actual hold owner resumes',()=>{
  const state=admitLinkCaptureEquipmentOwner(null,{...owner,motion:'catch_attack',rawAge:23},43,inventory,inventory);
  expect(stepLinkCaptureEquipmentLease(state,{frame:44,generation:1,clockAdvances:true,owner:null,interrupted:false})).toBeNull();
  expect(stepLinkCaptureEquipmentLease(state,{frame:43,generation:2,clockAdvances:false,owner:null,interrupted:false})).toBeNull();
  expect(()=>parseLinkCaptureEquipmentLease({...state,phase:'tail'})).toThrow();
 });
});
