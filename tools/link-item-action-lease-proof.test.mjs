import {describe,it,expect} from 'vitest';
import {itemActionLeaseDrawingMatches} from './link-item-action-lease-proof.mjs';
const make=(kind='original-released-item-action')=>{
 const canonicalMotion=kind==='current-heavy-carry'?'item_heavy_walk':kind==='current-hammer-gear-only'?'item_golden_hammer_wait':kind==='temporary-consumed-food-action'?'item_light_eat':'item_light_throw_f';
 const binding={canonicalMotion,drawnMotion:canonicalMotion,componentRole:'body',ownerKind:kind,
  originMethods:['beginItemAction'],resource:{name:'h00test.nuanmb',sha256:'a'.repeat(64)},
  sourceExpression:{expressionFunction:'expression_test',expressionSourceSha256:'b'.repeat(64)}};
 const admission={key:7,generation:2,frame:10,method:'beginItemAction'},itemIdentity=JSON.stringify([0,2,9,3]),
  owner={canonicalMotion,componentRole:'body',ownerKind:kind,rawAge:20,facing:1,identity:{actorIndex:0,actorGeneration:2,entityId:9,entityGeneration:3},
   actionId:'real-action',itemIdentity,sourceExpression:{function:'expression_test',sha256:'b'.repeat(64)},
   actualItemActionLease:{generation:2,actionId:'real-action',itemIdentity,entryFrame:10,temporaryFood:kind==='temporary-consumed-food-action',ownsBodyRoute:kind!=='current-hammer-gear-only'}};
 const row={playerIndex:0,generation:2,motion:canonicalMotion,rawAge:20,actualFacing:1,heldItemState:null,ownerReceipt:{admission},
  pose:{sourceIdentity:{resource:'h00test',sha256:'a'.repeat(64)}},itemContext:{actionId:'real-action',itemIdentity},canonicalItemActionOwners:[owner]};
 return{binding,row,owner,admission,itemIdentity};
};
describe('actual item lease drawing proof (prepared; not executed)',()=>{
 it('retains a released item identity without requiring current held inventory',()=>{const x=make();expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(true);
  x.owner.actualItemActionLease.itemIdentity=JSON.stringify([0,2,10,3]);expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(false);});
 it('allows a consumed Food transaction but rejects a lost temporary lease',()=>{const x=make('temporary-consumed-food-action');expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(true);
  x.owner.actualItemActionLease.temporaryFood=false;expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(false);});
 it('uses exact retained inventory acquisition for live carry, distinct from current locomotion origin',()=>{const x=make('current-heavy-carry');
  x.row.heldItemState={id:9,spawnedAtFrame:3,holderPlayerIndex:0};x.row.inventoryAcquisitionOrigin={entityId:9,entityGeneration:3,actorGeneration:2,admission:x.admission};
  x.row.ownerReceipt.admission={generation:2,method:'locomotion-entry'};x.owner.carry={phase:'walk'};x.row.heavyCarryEquipment={itemIdentity:x.itemIdentity};
  expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(true);x.row.heldItemState.id=10;expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(false);});
 it('requires the genuine Golden Hammer flag and gear-only owner',()=>{const x=make('current-hammer-gear-only');
  x.row.heldItemState={id:9,spawnedAtFrame:3,holderPlayerIndex:0};x.row.inventoryAcquisitionOrigin={entityId:9,entityGeneration:3,actorGeneration:2,admission:x.admission};x.owner.hammer={age:20};x.owner.golden=true;
  expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(true);x.owner.golden=false;expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(false);});
 it('rejects an unrelated pickup reservation or actor generation',()=>{const x=make('reserved-pickup-action');x.row.acquisitionReceipt={entityId:9,entityGeneration:3,actorGeneration:2,admission:x.admission};
  expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(true);x.row.acquisitionReceipt.admission={...x.admission,key:8};expect(itemActionLeaseDrawingMatches(x.binding,x.row)).toBe(false);
  const y=make();y.owner.identity.actorGeneration=1;expect(itemActionLeaseDrawingMatches(y.binding,y.row)).toBe(false);});
});
