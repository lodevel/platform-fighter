import type { ItemDefinition } from './ItemDefinition';
/** Source arrow Item packet/lifetime/kinetics. Engine ground root is bottom;
 * mapBottom3 derives the source collision half-height, rather than borrowing
 * another weapon. Native opaque to_item ownership/constructor remains a gap. */
export const LINK_ARROW_ITEM_DEFINITION:ItemDefinition=Object.freeze({
  type:'link-arrow-item',itemClass:'throwing',holdable:true,heavy:false,containerEligible:false,
  generated:Object.freeze({kind:'link-arrow',vanishesOnImpact:true}),
  ttlFrames:40,brokenDespawnFrames:0,
  pickupBounds:Object.freeze({offsetX:0,offsetY:-15,width:35,height:30}),
  throwProfile:Object.freeze({pixelsPerUnit:5,speedMultiplier:1,gravity:.053,terminalFallSpeed:2.3,
    airBrakeX:.0025,maxSpeedX:Number.POSITIVE_INFINITY,mapBottom:3,attackRadius:1.35,
    damage:1,damageSpeedAdd:-.4,damageSpeedMultiplier:.8,
    knockback:Object.freeze({base:10,growth:66,fixed:0,angle:361}),
    reflectable:true,absorbable:false,hitlagMultiplier:1,sdiMultiplier:1,referenceKnockbackMultiplier:1,
    nativeCollisionAttribute:'collision_attr_sting',throwRebound:Object.freeze({mul:0,addX:0,addY:0})}),
});
