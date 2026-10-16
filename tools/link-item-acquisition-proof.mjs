/** Independent exact-entity acquisition proof over forwarded production calls. */
import assert from 'node:assert/strict';
const types=new Set(['homeRunBat','beamSword','hammer','rayGun','bobOmb','crate','starRod','superScope','fireFlower',
  'bananaPeel','goldenHammer','food','heartContainer','maximTomato','barrel','capsule']);
export function validateItemAcquisitionProof(p){
  const keys=['actorIndex','itemType','kind','outcome','action','sourceEventNativeFrame','selectedRawAge','maxAdmissionFrames'];
  assert(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)));
  assert(Number.isSafeInteger(p.actorIndex)&&p.actorIndex>=0&&p.actorIndex<=3&&types.has(p.itemType));
  assert(Number.isSafeInteger(p.maxAdmissionFrames)&&p.maxAdmissionFrames>=1&&p.maxAdmissionFrames<=3600);
  assert(['reserved','held','consumed','failed'].includes(p.outcome));
  if(p.kind==='light-pickup')assert(!['crate','barrel','food','heartContainer','maximTomato'].includes(p.itemType)&&
    ['pickup-standing','pickup-walking'].includes(p.action)&&p.sourceEventNativeFrame===2&&p.selectedRawAge===1&&p.outcome!=='consumed');
  else if(p.kind==='heavy-pickup')assert(['crate','barrel'].includes(p.itemType)&&p.action==='pickup'&&
    p.sourceEventNativeFrame===4&&p.selectedRawAge===3&&p.outcome!=='consumed');
  else if(p.kind==='temporary-recovery')assert(['food','maximTomato'].includes(p.itemType)&&
    ['recovery-standing','recovery-walking'].includes(p.action)&&p.sourceEventNativeFrame===6&&p.selectedRawAge===5&&p.outcome!=='held');
  else assert(p.kind==='instant-recovery'&&p.itemType==='heartContainer'&&['recovery-standing','recovery-walking'].includes(p.action)&&
    p.sourceEventNativeFrame===null&&p.selectedRawAge===null&&['consumed','failed'].includes(p.outcome));
}
export function itemAcquisitionProof(events,witnesses,p){
  validateItemAcquisitionProof(p);
  const receipts=events.filter(e=>e.kind==='item-acquisition'&&e.actorIndex===p.actorIndex&&e.itemType===p.itemType&&
    e.acquisitionKind===p.kind&&e.action===p.action);
  const reservations=receipts.filter(e=>e.stage==='reserved'&&e.admission?.key&&e.admission.playerIndex===p.actorIndex&&
    e.admission.generation===e.actorGeneration&&e.admission.frame===e.entryFrame&&Number.isSafeInteger(e.entityGeneration)&&e.entityGeneration>=0&&Number.isSafeInteger(e.entityId)&&e.entityId>=0);
  for(const reserved of reservations){
    // A first successful callback cannot conceal a later duplicate or a
    // conflicting outcome for the same real reservation lease.
    const callbackRows=events.filter(e=>e.kind==='item-acquisition'&&e.leaseKey===reserved.leaseKey&&e.stage!=='reserved');
    if(p.outcome!=='reserved'&&(callbackRows.length!==1||callbackRows[0].callbackOnce!==true||callbackRows[0].callbackCount!==1))continue;
    const outcome=p.outcome==='reserved'?reserved:receipts.find(e=>e.stage===p.outcome&&e.leaseKey===reserved.leaseKey&&
      e.entityId===reserved.entityId&&e.entityGeneration===reserved.entityGeneration&&e.actorGeneration===reserved.actorGeneration&&
      e.sourceEventNativeFrame===p.sourceEventNativeFrame&&e.selectedRawAge===p.selectedRawAge&&e.callbackOnce===true&&
      (p.outcome!=='held'||e.sameHeldObject===true)&&(p.outcome!=='consumed'||e.healingValidated===true&&e.sameConsumedObject===true));
    if(!outcome||outcome.frame<reserved.entryFrame||outcome.frame-reserved.entryFrame>p.maxAdmissionFrames)continue;
    const witness=witnesses.find(sample=>Number.isSafeInteger(reserved.observerEpoch)&&sample.observerEpoch===reserved.observerEpoch&&
      sample.frame>=outcome.frame&&sample.frame-reserved.entryFrame<=p.maxAdmissionFrames&&
      sample.actors.some(a=>a.playerIndex===p.actorIndex&&a.generation===reserved.actorGeneration&&
        (a.acquisitionReceipt?.leaseKey===reserved.leaseKey&&
          a.acquisitionReceipt.admission?.key===reserved.admission.key&&
          a.acquisitionReceipt.entityId===reserved.entityId&&a.acquisitionReceipt.entityGeneration===reserved.entityGeneration&&
          a.acquisitionReceipt.stage===p.outcome||a.ownerReceipt?.admission?.key===reserved.admission.key||
          a.ownerReceipt?.inventoryIdentity?.entityId===reserved.entityId&&
          a.ownerReceipt.inventoryIdentity.entityGeneration===reserved.entityGeneration)));
    if(witness)return {admissionKey:reserved.admission.key,actorIndex:p.actorIndex,actorGeneration:reserved.actorGeneration,
      entityId:reserved.entityId,entityGeneration:reserved.entityGeneration,entryFrame:reserved.entryFrame,
      callbackFrame:p.outcome==='reserved'?null:outcome.frame,outcome:p.outcome,witnessFrame:witness.frame,
      leaseKey:reserved.leaseKey,observerEpoch:reserved.observerEpoch,admission:reserved.admission,expectedSourceEventNativeFrame:p.sourceEventNativeFrame,expectedSelectedRawAge:p.selectedRawAge,
      observedSourceEventNativeFrame:p.outcome==='reserved'?null:outcome.sourceEventNativeFrame,observedSelectedRawAge:p.outcome==='reserved'?null:outcome.selectedRawAge};
  }
  throw new Error('No genuine exact-entity acquisition/reservation/callback/outcome join');
}
