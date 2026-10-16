import {describe,it,expect} from 'vitest';
import {canonicalItemDrawingMatches} from './link-canonical-item-proof.mjs';
const binding={componentRole:'upper',canonicalMotion:'item_fflower_shoot_upper',drawnMotion:'item_lgun_shoot_upper',
 ownerKind:'actual-original-shooting-spec-and-paid-callback',phases:['start'],itemTypes:['fireFlower'],originMethods:['item-shooting-entry'],
 producerChecks:[{path:'heldItemState.type',oneOf:['fireFlower']}],resource:{name:'h11shootupper.nuanmb',sha256:'a'.repeat(64)},
 equipment:{kind:'selected-held-inventory',sword:'normal',shield:'back',bow:['hidden'],heldItemVisible:true,ancientBowVisible:false}};
const row=()=>({playerIndex:0,generation:2,motion:'item_lgun_shoot_upper',rawAge:8,actualFacing:1,componentRole:'upper',componentNativeSample:8,
 heldItemState:{id:9,type:'fireFlower',spawnedAtFrame:30,holderPlayerIndex:0},ownerReceipt:{admission:{generation:2,method:'item-shooting-entry'}},
 canonicalItemOwners:[{componentRole:'upper',canonicalMotion:'item_fflower_shoot_upper',rawAge:8,facing:1,phase:'start',ownerKind:binding.ownerKind,
 identity:{entityId:9,entityGeneration:30,actorGeneration:2,itemType:'fireFlower',holderPlayerIndex:0}}],
 pose:{sourceTuple:{upperNativeSample:8,upperResource:'h11shootupper',lowerResource:'h10walk'}},bodyComponentSourceIdentities:{upper:{resource:'h11shootupper',sha256:'a'.repeat(64)}},
 equipment:{sword:'normal',shield:'back',bow:'hidden',heldItemVisible:true,ancientBowVisible:false}});
describe('canonical item alias paired witness (prepared, not executed)',()=>{
 it('joins actual Flower original spec to drawn gun upper in the same paired body',()=>expect(canonicalItemDrawingMatches(binding,row())).toBe(true));
 it('rejects a different weapon or generation despite the same drawn alias',()=>{const r=row();r.heldItemState.type='rayGun';expect(canonicalItemDrawingMatches(binding,r)).toBe(false);
  const g=row();g.canonicalItemOwners[0].identity.actorGeneration=1;expect(canonicalItemDrawingMatches(binding,g)).toBe(false);});
 it('rejects missing joined body and a different selected upper sample',()=>{const r=row();r.pose.sourceTuple=null;expect(canonicalItemDrawingMatches(binding,r)).toBe(false);
  const s=row();s.pose.sourceTuple.upperNativeSample=7;expect(canonicalItemDrawingMatches(binding,s)).toBe(false);});
 it('does not allow a recipe canonical name without the actual original spec owner',()=>{const r=row();r.canonicalItemOwners=[];expect(canonicalItemDrawingMatches(binding,r)).toBe(false);});
});
