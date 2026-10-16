import {describe,it,expect} from 'vitest';
import {linkThrowReleaseContactMatches} from './link-throw-release-proof.mjs';
const capture={captureId:4,targetPlayerIndex:0,targetGeneration:2,captorPlayerIndex:1,captorGeneration:3};
const origin={key:'throw-origin-1',method:'throw-entry',frame:10,playerIndex:1,generation:3,direction:'back',cargo:false,capture};
const owner={family:'throw',admission:origin};
const descriptor={damage:3,knockback:{x:0,y:0,scaling:0,reference:{base:58,growth:124,angle:130,fixed:0}}};
const receipt={kind:'accepted-capture-throw-release',grabId:'actual-custom-grab',producerPlayerIndex:1,producerGeneration:3,
  targetPlayerIndex:0,targetGeneration:2,capture,direction:'back',cargo:false,airborne:false,
  throwEntryFrame:10,releaseFrame:20,releaseElapsed:10,descriptor,damageSource:{baseDamage:3,staleMultiplier:1.05,queueMoveId:'actual-custom-grab.throw.back',transactionKey:'real-throw-transaction'}};
const event={kind:'hit',reason:'throw-release',result:{outcome:'absolute-release-applied'},frame:20,observerEpoch:8,captureId:4,throwRelease:receipt,
  packet:{damage:3*1.05,baseDamage:3,staleMultiplier:1.05,knockback:descriptor.knockback,combatThrowRelease:receipt},producerIndex:1,
  producer:{playerIndex:1,generation:3,ownerReceipt:owner},victim:{playerIndex:0,generation:2}};
const sample={frame:21,observerEpoch:8,actors:[{playerIndex:1,generation:3,ownerReceipt:owner},{playerIndex:0,generation:2,recipient:null}]};
const wanted={producerIndex:1,victimIndex:0};
describe('exact absolute throw-release contact origin',()=>{
 it('joins an actual release to its original throw/capture, without requiring a synthetic move ID',()=>{
  expect(linkThrowReleaseContactMatches(event,wanted,sample)).toBe(true);
 });
 it('rejects a later capture or a new throw admission in the same actor generation',()=>{
  const changed=structuredClone(sample);changed.actors[0].ownerReceipt.admission.key='throw-origin-2';
  expect(linkThrowReleaseContactMatches(event,wanted,changed)).toBe(false);
  const recaptured=structuredClone(sample);recaptured.actors[1].recipient={templateIdentity:{...capture,captureId:5}};
  expect(linkThrowReleaseContactMatches(event,wanted,recaptured)).toBe(false);
 });
 it('rejects stale participant/reset epochs and a wrong active packet descriptor',()=>{
  const reset=structuredClone(sample);reset.actors[1].generation=3;expect(linkThrowReleaseContactMatches(event,wanted,reset)).toBe(false);
  expect(linkThrowReleaseContactMatches(event,wanted,{...sample,observerEpoch:9})).toBe(false);
  const corrupt=structuredClone(event);corrupt.packet.damage=4;expect(linkThrowReleaseContactMatches(corrupt,wanted,sample)).toBe(false);
 });
 it('rejects a grab input falsely relabelled as throw release and an earlier witness',()=>{
  const wrong=structuredClone(event);wrong.producer.ownerReceipt.admission.method='grab-entry';
  expect(linkThrowReleaseContactMatches(wrong,wanted,sample)).toBe(false);
  expect(linkThrowReleaseContactMatches(event,wanted,{...sample,frame:19})).toBe(false);
 });
});
