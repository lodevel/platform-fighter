import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import type { NativeItemThrowProfile } from './nativeItemThrow';

/** Native barrel game_Throw plus item_common row3; SmashWiki silent fields
 * use this pinned packet. Rolling reuses the throw packet as a labelled
 * adaptation because its status/attack consumer was not recovered. */
export const BARREL_THROW_PROFILE: NativeItemThrowProfile = Object.freeze({
  pixelsPerUnit:5,speedMultiplier:.6,gravity:.25,terminalFallSpeed:2.5,
  airBrakeX:.002,maxSpeedX:3,maxSpeedY:3,mapBottom:7.9,
  attackRadius:4.800000190734863,damage:12,damageSpeedAdd:-.4,damageSpeedMultiplier:.8,
  knockback:Object.freeze({base:30,growth:80,fixed:0,angle:361}),
  hitlagMultiplier:.5,sdiMultiplier:1,referenceKnockbackMultiplier:.8,
  nativeCollisionAttribute:'collision_attr_normal',throwRebound:Object.freeze({mul:0,addX:.4,addY:.4}),
});
export const BARREL_DEFINITION: ItemDefinition = Object.freeze({
  type:'barrel',itemClass:'container',holdable:true,heavy:true,
  throwProfile:BARREL_THROW_PROFILE,
  pickupBounds:Object.freeze({offsetX:0,offsetY:-39.5,width:71,height:85}),
  ttlFrames:1200,brokenDespawnFrames:20,
  container:Object.freeze({kind:'barrel',hp:14,contentCountMaximum:1,explosionChance:1/8,
    // Count1 is authored: no Ultimate count parameters recovered. Native Born
    // packet supplies22%, angle80,BKB45,KBG80,radius9.6,hitlag.7; active3 authored.
    explosion:Object.freeze({damage:22,radius:9.600000381469727*5,centreAboveRoot:39.5,
      activeFrames:3,knockback:Object.freeze({base:45,growth:80,fixed:0,angle:80}),hitlagMultiplier:.699999988079071}),
    rolling:Object.freeze({maxSpeed:15,groundBrake:.01,stopSpeed:.05,radius:39.5})}),
  visual:Object.freeze({spriteKey:ASSET_KEYS.itemBarrel,width:71,height:79,restAngle:0}),
});
