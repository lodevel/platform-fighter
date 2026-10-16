import type { ItemDefinition } from './ItemDefinition';
import { LINK_REMOTE_BOMB_SOURCE } from '../characters/linkRemoteBomb';
const blast = LINK_REMOTE_BOMB_SOURCE.blast;
/** Link's Remote Bomb, separate from historical RemoteBomb.ts: an ordinary
 * throwing item (1% thrown) whose centre sits 2 units (10 px) above the item
 * bottom. Detonation and fuse live in src/match/linkArticles.ts; the blast is
 * SmashWiki's 7% (it also hits Link) over the native 14-unit radius. Any
 * attack, Link's included, launches a free bomb (launchedByAttacks). */
export const LINK_REMOTE_BOMB_ITEM_DEFINITION:ItemDefinition=Object.freeze({
  type:'link-remote-bomb',itemClass:'throwing',heavy:false,holdable:true,containerEligible:false,launchedByAttacks:true,
  generated:Object.freeze({kind:'link-remote-bomb',vanishesOnImpact:false}),
  ttlFrames:Number.MAX_SAFE_INTEGER,brokenDespawnFrames:0,
  pickupBounds:Object.freeze({offsetX:0,offsetY:-10,width:20,height:20}),
  throwProfile:Object.freeze({pixelsPerUnit:5,speedMultiplier:.72,gravity:.07,terminalFallSpeed:2.3,
    airBrakeX:.01,maxSpeedX:4,maxSpeedY:4,mapBottom:2,attackRadius:2,
    damage:1,damageSpeedAdd:0,damageSpeedMultiplier:0,
    knockback:Object.freeze({base:10,growth:100,fixed:0,angle:361}),
    hitlagMultiplier:.6,sdiMultiplier:1,reflectable:true,absorbable:false,referenceKnockbackMultiplier:1,nativeCollisionAttribute:'collision_attr_normal',
    throwRebound:Object.freeze({mul:.2,addX:0,addY:1})}),
  explosion:Object.freeze({damage:blast.damage,radius:blast.radiusNative*5,centreAboveRoot:10,activeFrames:2,
    knockback:Object.freeze({base:blast.base,growth:blast.growth,fixed:0,angle:blast.angle}),hitlagMultiplier:blast.hitlag,hitsOwner:true}),
});
