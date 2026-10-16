/** Consumed/released identity belongs to the actual admitted source lease;
 * only live carry/Hammer require the original entity still held. */
import assert from 'node:assert/strict';
const stem=s=>s.replace(/\.nuanmb$/,'');
export function itemActionLeaseDrawingMatches(binding,row){
 const owner=row.canonicalItemActionOwners?.find(o=>o.canonicalMotion===binding.canonicalMotion&&o.ownerKind===binding.ownerKind);
 if(!owner||owner.componentRole!=='body'||row.motion!==binding.drawnMotion||owner.rawAge!==row.rawAge||owner.facing!==row.actualFacing||
  owner.identity?.actorIndex!==row.playerIndex||owner.identity.actorGeneration!==row.generation||
  ![owner.identity.entityId,owner.identity.entityGeneration].every(v=>Number.isSafeInteger(v)&&v>=0)||
  row.pose?.sourceIdentity?.sha256!==binding.resource.sha256||![stem(binding.resource.name),binding.resource.name].includes(row.pose.sourceIdentity.resource)||
  owner.sourceExpression?.function!==binding.sourceExpression.expressionFunction||owner.sourceExpression.sha256!==binding.sourceExpression.expressionSourceSha256)return false;
 const live=['current-heavy-carry','current-hammer-gear-only'].includes(binding.ownerKind);
 const origin=live?row.inventoryAcquisitionOrigin?.admission:row.ownerReceipt?.admission;
 if(!origin||origin.generation!==row.generation||!binding.originMethods.includes(origin.method))return false;
 if(live){const held=row.heldItemState,a=row.inventoryAcquisitionOrigin;
  if(!held||held.id!==owner.identity.entityId||held.spawnedAtFrame!==owner.identity.entityGeneration||held.holderPlayerIndex!==row.playerIndex||
   !a||a.entityId!==held.id||a.entityGeneration!==held.spawnedAtFrame||a.actorGeneration!==row.generation)return false;
  if(binding.ownerKind==='current-heavy-carry'&&(owner.carry?.phase!=='walk'||row.heavyCarryEquipment?.itemIdentity!==JSON.stringify([row.playerIndex,row.generation,held.id,held.spawnedAtFrame])))return false;
  if(binding.ownerKind==='current-hammer-gear-only'&&(!owner.hammer||owner.actualItemActionLease?.ownsBodyRoute!==false||
    owner.golden!==binding.canonicalMotion.startsWith('item_golden_hammer_')))return false;
 }else{
  const lease=owner.actualItemActionLease;
  if(!lease||lease.generation!==row.generation||lease.actionId!==owner.actionId||lease.itemIdentity!==owner.itemIdentity||
   lease.entryFrame!==origin.frame||lease.itemIdentity!==JSON.stringify([row.playerIndex,row.generation,owner.identity.entityId,owner.identity.entityGeneration])||
   row.itemContext?.actionId!==owner.actionId||row.itemContext.itemIdentity!==owner.itemIdentity)return false;
  if(binding.ownerKind==='temporary-consumed-food-action'&&lease.temporaryFood!==true)return false;
  if(binding.ownerKind==='reserved-pickup-action'){
   const acquisition=row.acquisitionReceipt;if(!acquisition||acquisition.entityId!==owner.identity.entityId||acquisition.entityGeneration!==owner.identity.entityGeneration||
    acquisition.actorGeneration!==row.generation||acquisition.admission?.key!==origin.key)return false;
  }
 }
 return true;
}
export function validateItemActionLeaseBinding(binding){
 assert(binding&&binding.componentRole==='body'&&['reserved-pickup-action','temporary-consumed-food-action','original-released-item-action','current-heavy-carry','current-hammer-gear-only'].includes(binding.ownerKind));
 assert(typeof binding.rowId==='string'&&typeof binding.canonicalMotion==='string'&&typeof binding.drawnMotion==='string'&&binding.originMethods.length);
 assert(/^[a-f0-9]{64}$/.test(binding.resource?.sha256)&&binding.sourceExpression?.expressionFunction&&/^[a-f0-9]{64}$/.test(binding.sourceExpression.expressionSourceSha256));
 return binding;
}
