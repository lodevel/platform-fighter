/** Independent exact-entity observer cases, prepared and not executed. */
import {describe,it,expect} from 'vitest';
// @ts-expect-error final browser tooling is authored as JavaScript ESM.
import {itemAcquisitionProof,validateItemAcquisitionProof} from '../../tools/link-item-acquisition-proof.mjs';
const proof={actorIndex:0,itemType:'rayGun',kind:'light-pickup',outcome:'held',action:'pickup-standing',
  sourceEventNativeFrame:2,selectedRawAge:1,maxAdmissionFrames:10};
const reserved={kind:'item-acquisition',stage:'reserved',observerEpoch:1,actorIndex:0,actorGeneration:3,itemType:'rayGun',acquisitionKind:'light-pickup',
  action:'pickup-standing',entryFrame:40,frame:40,entityId:17,entityGeneration:10,leaseKey:'actual-reservation-17',
  admission:{key:'real-pickup',playerIndex:0,generation:3,frame:40}};
const held={...reserved,stage:'held',frame:41,sourceEventNativeFrame:2,selectedRawAge:1,callbackOnce:true,callbackCount:1,sameHeldObject:true};
const witnesses=[{frame:42,observerEpoch:1,actors:[{playerIndex:0,generation:3,ownerReceipt:{inventoryIdentity:{entityId:17,entityGeneration:10}}}]}];
describe('real item acquisition observer join',()=>{
  it('joins the actual reservation to the same held object and its native callback',()=>{
    expect(itemAcquisitionProof([reserved,held],witnesses,proof)).toMatchObject({entityId:17,entityGeneration:10,callbackFrame:41});
  });
  it('rejects another same-type entity, replaced generation, failed callback and unrelated new owner',()=>{
    for(const changed of [{entityId:18},{entityGeneration:11},{sameHeldObject:false},{callbackOnce:false},{selectedRawAge:0}])
      expect(()=>itemAcquisitionProof([reserved,{...held,...changed}],witnesses,proof)).toThrow();
    expect(()=>itemAcquisitionProof([reserved,held],[{frame:42,observerEpoch:1,actors:[{playerIndex:0,generation:4}]}],proof)).toThrow();
    expect(()=>itemAcquisitionProof([reserved,held],[{frame:42,observerEpoch:1,actors:[{playerIndex:0,generation:3,ownerReceipt:{admission:{key:'different-action'}}}]}],proof)).toThrow();
  });
  it('does not count simple despawn as recovery and does not claim a callback at reservation',()=>{
    const recovery={actorIndex:0,itemType:'food',kind:'temporary-recovery',outcome:'consumed',action:'recovery-standing',
      sourceEventNativeFrame:6,selectedRawAge:5,maxAdmissionFrames:10};
    const r={...reserved,itemType:'food',acquisitionKind:'temporary-recovery',action:'recovery-standing'};
    expect(()=>itemAcquisitionProof([r,{...r,stage:'consumed',frame:45,sourceEventNativeFrame:6,selectedRawAge:5,
      callbackOnce:true,callbackCount:1,sameConsumedObject:true,healingValidated:false}],witnesses,recovery)).toThrow();
    const pending=itemAcquisitionProof([reserved],witnesses,{...proof,outcome:'reserved'});
    expect(pending.observedSourceEventNativeFrame).toBeNull();expect(pending.callbackFrame).toBeNull();
    expect(()=>validateItemAcquisitionProof({...proof,entityId:17})).toThrow();
  });
  it('rejects a later duplicate callback or conflicting outcome after an earlier valid held result',()=>{
    expect(()=>itemAcquisitionProof([reserved,held,{...held,frame:42,callbackOnce:false,callbackCount:2}],witnesses,proof)).toThrow();
    expect(()=>itemAcquisitionProof([reserved,held,{...held,stage:'failed',frame:42,callbackOnce:false,callbackCount:2}],witnesses,proof)).toThrow();
    expect(()=>itemAcquisitionProof([reserved,held],[{frame:40,observerEpoch:1,actors:[{playerIndex:0,generation:3,ownerReceipt:{admission:reserved.admission}}]}],proof)).toThrow();
  });
  it('joins consumed Heart independently of the retained weapon and rejects a newer recovery lease',()=>{
    const p={actorIndex:0,itemType:'heartContainer',kind:'instant-recovery',outcome:'consumed',action:'recovery-standing',
      sourceEventNativeFrame:null,selectedRawAge:null,maxAdmissionFrames:2},
      r={...reserved,itemType:'heartContainer',acquisitionKind:'instant-recovery',action:'recovery-standing'},
      consumed={...r,stage:'consumed',sourceEventNativeFrame:null,selectedRawAge:null,callbackCount:1,callbackOnce:true,healingValidated:true,sameConsumedObject:true},
      actor={playerIndex:0,generation:3,ownerReceipt:{inventoryIdentity:{entityId:99,entityGeneration:7}},acquisitionReceipt:consumed};
    expect(itemAcquisitionProof([r,consumed],[{frame:40,observerEpoch:1,actors:[actor]}],p)).toMatchObject({entityId:17,outcome:'consumed'});
    expect(()=>itemAcquisitionProof([r,consumed],[{frame:40,observerEpoch:1,actors:[{...actor,acquisitionReceipt:{...consumed,leaseKey:'new-recovery'}}]}],p)).toThrow();
  });
});
