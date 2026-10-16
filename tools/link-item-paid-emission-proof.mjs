/** Independent final observer join. Producer-sealed point consistency alone
 * cannot satisfy this proof: precontact held-render registration is required. */
import assert from 'node:assert/strict';
const keys=['actorIndex','itemType','callbackPhase','callbackAge','shotId','muzzleReviewKey','muzzleSpriteSha256','maxAdmissionFrames'];
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-8;
const samePoint=(a,b)=>a&&b&&near(a.x,b.x)&&near(a.y,b.y);
export function validateItemPaidEmissionProof(p){
 assert(p&&Object.keys(p).length===keys.length&&keys.every(k=>Object.hasOwn(p,k)),'Exact eight-field emission proof required');
 assert(Number.isSafeInteger(p.actorIndex)&&p.actorIndex>=0&&['rayGun','superScope','fireFlower','starRod'].includes(p.itemType));
 assert(typeof p.callbackPhase==='string'&&p.callbackPhase&&Number.isSafeInteger(p.callbackAge)&&p.callbackAge>=0);
 assert(typeof p.shotId==='string'&&p.shotId&&typeof p.muzzleReviewKey==='string'&&p.muzzleReviewKey&&/^[a-f0-9]{64}$/.test(p.muzzleSpriteSha256));
 assert(Number.isSafeInteger(p.maxAdmissionFrames)&&p.maxAdmissionFrames>0&&p.maxAdmissionFrames<=10000);return p;
}
export function itemPaidEmissionProof(events,acquisitions,samples,p,registry){
 validateItemPaidEmissionProof(p);
 const muzzle=registry.rows.find(r=>r.itemType===p.itemType&&r.reviewKey===p.muzzleReviewKey&&r.spriteSha256===p.muzzleSpriteSha256);
 assert(muzzle,'Independent reviewed item muzzle missing');
 for(const callback of events.filter(e=>e.kind==='item-shot-callback'&&e.actorIndex===p.actorIndex)){
  const c=callback.callback,origin=callback.producer?.ownerReceipt?.admission,payment=callback.paymentStep;
  if(c.itemType!==p.itemType||c.callbackPhase!==p.callbackPhase||c.callbackAge!==p.callbackAge||c.shot.id!==p.shotId||!origin||
   origin.method!=='item-shooting-entry'||origin.input?.attack!==true||origin.generation!==c.actorGeneration||origin.frame>c.frame||c.frame-origin.frame>p.maxAdmissionFrames)continue;
  if(!payment||payment.frame!==c.frame||payment.actorGeneration!==c.actorGeneration||payment.entityId!==c.entityId||payment.entityGeneration!==c.entityGeneration||
   !payment.payments.length||!payment.payments.some(r=>r.cost>0)||payment.payments.some(r=>r.accepted!==true||!Number.isFinite(r.cost)||r.cost<0||!Number.isFinite(r.before)||
    !Number.isFinite(r.after)||!near(r.before-r.cost,r.after)))continue;
  const acquisition=callback.acquisitionOrigin;if(!acquisition||acquisition.entityId!==c.entityId||acquisition.entityGeneration!==c.entityGeneration)continue;
  const lease=acquisitions.filter(e=>e.kind==='item-acquisition'&&e.leaseKey===acquisition.leaseKey),reserved=lease.find(e=>e.stage==='reserved'),heldRows=lease.filter(e=>e.stage==='held');
  if(!reserved||heldRows.length!==1||heldRows[0].callbackOnce!==true||heldRows[0].sameHeldObject!==true||
   lease.filter(e=>e.stage!=='reserved').length!==1||reserved.actorIndex!==p.actorIndex||reserved.actorGeneration!==c.actorGeneration||
   reserved.entityId!==c.entityId||reserved.entityGeneration!==c.entityGeneration||reserved.admission?.key!==acquisition.admission?.key||
   !reserved.admission?.input?.attack||heldRows[0].frame>c.frame)continue;
  const seals=events.filter(e=>e.kind==='item-emitter-seal'&&e.callbackId===c.callbackId),births=events.filter(e=>e.kind==='item-shot-birth'&&e.sourceEmission?.callbackId===c.callbackId);
  if(seals.length!==1||births.length!==1||events.filter(e=>e.kind==='item-shot-callback'&&e.callback.callbackId===c.callbackId).length!==1)continue;
  const seal=seals[0],registration=seal.registration,e=seal.callback.emission,birth=births[0],born=birth.sourceEmission;
  if(!registration||!e||seal.frame!==c.frame||registration.frame!==c.frame||registration.generation!==c.actorGeneration||
   registration.entityId!==c.entityId||registration.entityGeneration!==c.entityGeneration||registration.holderPlayerIndex!==p.actorIndex||registration.facing!==c.facing||
   registration.equipment?.heldItemVisible!==true||registration.visual?.spriteKey!==muzzle.spriteKey||registration.visual.width!==muzzle.width||registration.visual.height!==muzzle.height||
   e.muzzleReviewKey!==p.muzzleReviewKey||e.muzzleSpriteSha256!==p.muzzleSpriteSha256||!samePoint(e.rootAtCallback,registration.sourceRoot)||
   !registration.pose||e.poseIdentity.sheet!==registration.pose.sheet||e.poseIdentity.frameIndex!==registration.pose.frameIndex||
   e.poseIdentity.logicalFrameIndex!==(registration.pose.sourceDrawingIndex??registration.pose.frameIndex)||
   e.poseIdentity.nativeSample!==registration.pose.nativeSample||JSON.stringify(e.poseIdentity.sourceTuple)!==JSON.stringify(registration.pose.sourceTuple??null)||
   e.poseIdentity.handBindingProofKey!==(registration.hand?.kind==='overlay'?registration.hand.receipt.bindingProofKey??null:null)||
   e.poseIdentity.gearBindingProofKey!==(registration.gear?.kind==='equipment'?registration.gear.bindingProofKey:null))continue;
  const socket=registration.socket;if(!socket||!Number.isFinite(socket.angle)||!Number.isFinite(socket.length)||socket.length<0)continue;
  const angle=socket.angle*Math.PI/180,local={x:muzzle.point.x*c.facing,y:muzzle.point.y*Math.max(.35,socket.length)},
   delta={x:p.itemType==='superScope'?c.facing*(c.shot.spawnOffsetX-44):0,y:p.itemType==='superScope'?c.shot.spawnOffsetY-(-8):0},
   expectedLocal={x:socket.x-registration.sourceRoot.x+Math.cos(angle)*local.x-Math.sin(angle)*local.y+delta.x,
    y:socket.y-registration.sourceRoot.y+Math.sin(angle)*local.x+Math.cos(angle)*local.y+delta.y};
  if(!samePoint(expectedLocal,e.pointFromRoot)||birth.frame!==c.frame||born.actorGeneration!==c.actorGeneration||born.entityId!==c.entityId||born.entityGeneration!==c.entityGeneration||
   birth.origin?.producer?.ownerReceipt?.admission?.key!==origin.key||JSON.stringify(born.emission)!==JSON.stringify(e)||
   !['solved-same-generation-root','pre-reset-callback-root'].includes(born.originBasis)||!samePoint(birth.point,born.bornPoint)||
   !samePoint(born.bornPoint,{x:born.committedRoot.x+expectedLocal.x,y:born.committedRoot.y+expectedLocal.y}))continue;
  const witness=samples.find(sample=>(sample.articles?.itemShots??[]).some(row=>row.attackInstanceKey===birth.origin.attackInstanceKey&&row.sourceEmission?.callbackId===c.callbackId));
  if(!witness)continue;
  return{actorIndex:p.actorIndex,actorGeneration:c.actorGeneration,entityId:c.entityId,entityGeneration:c.entityGeneration,
   acquisitionLeaseKey:acquisition.leaseKey,acquisitionAdmissionKey:acquisition.admission.key,shootingAdmissionKey:origin.key,
   callbackId:c.callbackId,callbackFrame:c.frame,sealFrame:seal.frame,projectileId:birth.projectileId,attackInstanceKey:birth.origin.attackInstanceKey,
   paymentStep:payment,heldRenderRegistration:registration,muzzleReviewKey:p.muzzleReviewKey,muzzleSpriteSha256:p.muzzleSpriteSha256,
   expectedPointFromRoot:expectedLocal,bornPoint:born.bornPoint,committedRoot:born.committedRoot,originBasis:born.originBasis,witnessFrame:witness.frame};
 }
 throw new Error('Missing genuine acquisition/session/payment/precontact registered-render/muzzle/same-step birth join (StarRod needs its separate admitted battering/payment producer)');
}
