/** Actual producer semantic owner and actual rendered component remain two
 * separate witnesses. A source alias table never manufactures an owner name. */
import assert from 'node:assert/strict';
const operand=(row,path)=>path.split('.').reduce((v,k)=>v?.[k],row);
export function canonicalItemDrawingMatches(binding,row){
 const role=binding.componentRole,owner=row.canonicalItemOwners?.find(v=>v.componentRole===role&&v.canonicalMotion===binding.canonicalMotion);
 const held=row.heldItemState,admission=row.ownerReceipt?.admission;
 if(!owner||!held||!admission||row.motion!==binding.drawnMotion||!binding.phases.includes(owner.phase)||
  owner.ownerKind!==binding.ownerKind||!binding.itemTypes.includes(held.type)||owner.rawAge!==row.rawAge||owner.facing!==row.actualFacing||
  owner.identity?.actorGeneration!==row.generation||owner.identity.entityId!==held.id||owner.identity.entityGeneration!==held.spawnedAtFrame||
  owner.identity.itemType!==held.type||owner.identity.holderPlayerIndex!==row.playerIndex||held.holderPlayerIndex!==row.playerIndex||
  admission.generation!==row.generation||!binding.originMethods.includes(admission.method))return false;
 for(const check of binding.producerChecks){const v=operand(row,check.path);
  if(check.oneOf?!check.oneOf.includes(v):Object.hasOwn(check,'eq')?v!==check.eq:true)return false;
 }
 const source=role==='body'?row.pose?.sourceIdentity:row.bodyComponentSourceIdentities?.[role];
 const expectedStem=binding.resource.name.replace(/\.nuanmb$/,'');
 if(source?.sha256!==binding.resource.sha256||source.resource!==expectedStem&&source.resource!==binding.resource.name)return false;
 if(role!=='body'){
  const tuple=row.pose?.sourceTuple;if(!tuple||row.componentRole!==role||
   !Number.isSafeInteger(tuple[role+'NativeSample'])||row.componentNativeSample!==tuple[role+'NativeSample'])return false;
 }
 if(binding.equipment.kind==='captured-expression-timeline'){
  if(owner.sourceExpression?.function!==binding.equipment.function||owner.sourceExpression.sha256!==binding.equipment.sha256||
   row.itemContext?.route.motion!==binding.equipment.motion||row.itemContext.itemIdentity!==JSON.stringify([row.playerIndex,row.generation,held.id,held.spawnedAtFrame]))return false;
 }else if(binding.equipment.kind==='selected-held-inventory'){
  for(const key of ['sword','shield','heldItemVisible','ancientBowVisible'])if(row.equipment?.[key]!==binding.equipment[key])return false;
  if(!binding.equipment.bow.includes(row.equipment?.bow))return false;
 }else return false;
 return true;
}
export function validateCanonicalItemDrawingBinding(binding){
 assert(binding&&['body','upper','lower'].includes(binding.componentRole)&&typeof binding.canonicalMotion==='string'&&typeof binding.drawnMotion==='string');
 assert(binding.productionOwnerRequired?.observerInventedCanonicalNameAllowed===false&&binding.resourceAliasesExact===true);
 assert(/^[a-f0-9]{64}$/.test(binding.resource?.sha256)&&binding.itemTypes.length&&binding.phases.length&&binding.originMethods.length);
 for(const clause of binding.producerChecks){assert(clause&&typeof clause.path==='string'&&
  (Object.keys(clause).sort().join(',')==='eq,path'||Object.keys(clause).sort().join(',')==='oneOf,path'&&Array.isArray(clause.oneOf)&&clause.oneOf.length));}
 return binding;
}
