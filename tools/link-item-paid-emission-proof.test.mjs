import {describe,it,expect} from 'vitest';
import {itemPaidEmissionProof} from './link-item-paid-emission-proof.mjs';
function fixture(){
 const hash='a'.repeat(64),p={actorIndex:0,itemType:'rayGun',callbackPhase:'shoot',callbackAge:8,shotId:'ray',muzzleReviewKey:'actual-reviewed-ray',muzzleSpriteSha256:hash,maxAdmissionFrames:10},
 registry={rows:[{itemType:'rayGun',spriteKey:'raySprite',width:14,height:32,point:{x:0,y:-28.857142857142858},reviewKey:p.muzzleReviewKey,spriteSha256:hash}]},
 admission={key:'shoot:10',method:'item-shooting-entry',generation:2,frame:10,input:{attack:true}},acquire={key:'pickup:0',input:{attack:true}},
 callback={callbackId:'paid:18:1',actorGeneration:2,entityId:9,entityGeneration:0,itemType:'rayGun',frame:18,facing:1,callbackPhase:'shoot',callbackAge:8,shot:{id:'ray'}},
 emission={rootAtCallback:{x:100,y:200},pointFromRoot:{x:28.857142857142858,y:0},muzzleReviewKey:p.muzzleReviewKey,muzzleSpriteSha256:hash,
 poseIdentity:{sheet:'actual-frame',frameIndex:0,logicalFrameIndex:8,nativeSample:8,sourceTuple:null,handBindingProofKey:'hand-paired',gearBindingProofKey:null}},
 registration={frame:18,generation:2,entityId:9,entityGeneration:0,holderPlayerIndex:0,facing:1,sourceRoot:{x:100,y:200},
 socket:{x:100,y:200,angle:90,length:1},visual:{spriteKey:'raySprite',width:14,height:32},equipment:{heldItemVisible:true},
 pose:{sheet:'actual-frame',frameIndex:0,sourceDrawingIndex:8,nativeSample:8},hand:{kind:'overlay',receipt:{bindingProofKey:'hand-paired'}},gear:null},
 born={...callback,emission,originBasis:'solved-same-generation-root',committedRoot:{x:102,y:202},bornPoint:{x:130.85714285714286,y:202}},
 events=[{kind:'item-shot-callback',actorIndex:0,callback,producer:{ownerReceipt:{admission}},paymentStep:{frame:18,actorGeneration:2,entityId:9,entityGeneration:0,payments:[{cost:1,before:16,after:15,accepted:true}]},acquisitionOrigin:{entityId:9,entityGeneration:0,leaseKey:'pickup',admission:acquire}},
 {kind:'item-emitter-seal',callbackId:callback.callbackId,frame:18,callback:{...callback,emission},registration},
 {kind:'item-shot-birth',frame:18,projectileId:1,point:born.bornPoint,sourceEmission:born,origin:{attackInstanceKey:'real-projectile:1',producer:{ownerReceipt:{admission}}}}],
 acquisitions=[{kind:'item-acquisition',leaseKey:'pickup',stage:'reserved',actorIndex:0,actorGeneration:2,entityId:9,entityGeneration:0,admission:acquire},
 {kind:'item-acquisition',leaseKey:'pickup',stage:'held',callbackOnce:true,sameHeldObject:true,frame:1}],
 samples=[{frame:18,articles:{itemShots:[{attackInstanceKey:'real-projectile:1',sourceEmission:born}]}}];
 return{p,registry,events,acquisitions,samples,run(){return itemPaidEmissionProof(this.events,this.acquisitions,this.samples,this.p,this.registry);}};
}
describe('paid registered emitter join (prepared, not executed)',()=>{
 it('joins actual payment and independently registered muzzle to solved root birth',()=>expect(fixture().run().bornPoint.x).toBeCloseTo(130.85714285714286));
 it('rejects self-consistent invented points without actual held-render registration',()=>{const f=fixture();f.events[1].registration=null;expect(()=>f.run()).toThrow();});
 it('rejects wrong entity payment and duplicate consumption callback',()=>{const f=fixture();f.events[0].paymentStep.entityId=10;expect(()=>f.run()).toThrow();
 const g=fixture();g.acquisitions.push({...g.acquisitions[1],callbackOnce:false});expect(()=>g.run()).toThrow();});
 it('rejects later-frame birth and a socket/axis mismatch despite consistent stored born coordinates',()=>{const f=fixture();f.events[2].frame=19;expect(()=>f.run()).toThrow();
 const g=fixture();g.events[1].registration.socket.angle=0;expect(()=>g.run()).toThrow();});
});
