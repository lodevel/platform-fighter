import type { ItemDefinition } from './ItemDefinition';
import type { NativeItemThrowProfile } from './nativeItemThrow';
import { ASSET_KEYS } from '../assets/manifest';

/** Ultimate box parameters: workbook sheet item_common, row4; throw attack from
 * WuBoytH SSBU-Dumped-Scripts revision59004685, item/box/game_Throw.
 * Container HP/explosion packet are native-derived;1/8 dud odds and up-to3
 * identical contents are SmashWiki. Count weights/impact opening/TTL are authored. */
export const CRATE_THROW_PROFILE:NativeItemThrowProfile=Object.freeze({
  pixelsPerUnit:5,speedMultiplier:.7,gravity:.12,terminalFallSpeed:2.2,
  airBrakeX:.0025,maxSpeedX:2.4,maxSpeedY:2.4,mapBottom:7.5,
  attackRadius:9.119999885559082,damage:15,damageSpeedAdd:-.4,damageSpeedMultiplier:1.6,
  knockback:Object.freeze({base:30,growth:80,fixed:0,angle:361}),
  hitlagMultiplier:.4000000059604645,sdiMultiplier:1,referenceKnockbackMultiplier:.8,
  nativeCollisionAttribute:'collision_attr_normal',
  throwRebound:Object.freeze({mul:0,addX:.4,addY:.4}),
  // ATTACK_FP force initialization is unrecovered, so force stays absent.
});

export const CRATE_DEFINITION:ItemDefinition=Object.freeze({
  type:'crate',itemClass:'container',holdable:true,heavy:true,
  // Entity/root is the bottom of the rendered box. Native parameters are
  // centre-based, so this explicit adapter moves pickup/attack centres up.
  pickupBounds:Object.freeze({offsetX:0,offsetY:-37.5,width:89,height:75}),
  throwProfile:CRATE_THROW_PROFILE,ttlFrames:1200,brokenDespawnFrames:20,
  container:Object.freeze({kind:'crate',hp:15,contentCountMaximum:3,explosionChance:1/8,
    explosion:Object.freeze({damage:22,radius:9.600000381469727*5,centreAboveRoot:37.5,
      activeFrames:3,knockback:Object.freeze({base:45,growth:80,fixed:0,angle:361}),hitlagMultiplier:.699999988079071})}),
  visual:Object.freeze({spriteKey:ASSET_KEYS.itemCrate,width:80,height:75,restAngle:0}),
});
