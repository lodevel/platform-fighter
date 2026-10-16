import { ASSET_KEYS } from '../assets/manifest';
import type { ItemDefinition } from './ItemDefinition';
import type { ItemAction } from './itemActions';
import type { NativeItemThrowProfile } from './nativeItemThrow';

/** Native base8 and throw kinetics; SmashWiki explicit Ultimate action rows
 * override damage below. Native two-sphere/capsule receiving shapes are
 * adapted to the shared one-sphere thrown-item contact, not native geometry parity. */
export const CAPSULE_THROW_PROFILE: NativeItemThrowProfile = Object.freeze({
  pixelsPerUnit:5,speedMultiplier:1,gravity:.074,terminalFallSpeed:2.2,
  airBrakeX:.0025,maxSpeedX:4,maxSpeedY:4,mapBottom:2.4,
  attackRadius:4,damage:8,damageSpeedAdd:-.4,damageSpeedMultiplier:3,
  knockback:Object.freeze({base:20,growth:85,fixed:0,angle:361}),
  hitlagMultiplier:.5,sdiMultiplier:1,referenceKnockbackMultiplier:.8,
  nativeCollisionAttribute:'collision_attr_normal',throwRebound:Object.freeze({mul:.12,addX:.4,addY:1.6}),
});

/** Ultimate column only. N/A ground down/plain rows stay absent; back throws
 * alias forward explicitly as a 2D adapter. The anomalous generic
 * "Explosion throw17" row is recorded in evidence, not silently applied
 * to all exploding actions. Explosive damage is ONE packet, not additive. */
export const CAPSULE_THROW_DAMAGE: Readonly<Partial<Record<ItemAction,number>>> = Object.freeze({
  'dash-throw':20,'air-z-drop':15,
  'throw-ground-forward-ordinary':17,'throw-ground-back-ordinary':17,'throw-ground-up-ordinary':17,
  'throw-ground-forward-strong':21,'throw-ground-back-strong':21,'throw-ground-up-strong':21,
  'throw-air-forward-ordinary':17,'throw-air-back-ordinary':17,'throw-air-up-ordinary':17,'throw-air-down-ordinary':17,
  'throw-air-forward-strong':21,'throw-air-back-strong':21,'throw-air-up-strong':17,'throw-air-down-strong':17,
});
export const CAPSULE_EXPLOSION_DAMAGE: Readonly<Partial<Record<ItemAction,number>>> = Object.freeze({
  'dash-throw':52,'air-z-drop':42,
  'throw-ground-forward-ordinary':50,'throw-ground-back-ordinary':50,'throw-ground-up-ordinary':47,
  'throw-ground-forward-strong':53,'throw-ground-back-strong':53,'throw-ground-up-strong':54,
  'throw-air-forward-ordinary':49,'throw-air-back-ordinary':49,'throw-air-up-ordinary':48,'throw-air-down-ordinary':48,
  'throw-air-forward-strong':53,'throw-air-back-strong':53,'throw-air-up-strong':48,'throw-air-down-strong':48,
});
export const CAPSULE_DEFINITION: ItemDefinition = Object.freeze({
  type:'capsule',itemClass:'throwing',holdable:true,heavy:false,
  throwProfile:CAPSULE_THROW_PROFILE,thrownHit:Object.freeze({damageByAction:CAPSULE_THROW_DAMAGE}),
  pickupBounds:Object.freeze({offsetX:0,offsetY:-14.5,width:21,height:40}),
  ttlFrames:1200,brokenDespawnFrames:20,
  container:Object.freeze({kind:'capsule',hp:1,contentCountMaximum:1,explosionChance:1/8,downThrowOwnerImmune:true,
    // Attack-open/down-ground contexts unavailable in Wiki use native Born22.
    explosion:Object.freeze({damage:22,radius:9.600000381469727*5,centreAboveRoot:12,
      activeFrames:3,knockback:Object.freeze({base:45,growth:80,fixed:0,angle:361}),hitlagMultiplier:.699999988079071}),
    explosionDamageByAction:CAPSULE_EXPLOSION_DAMAGE}),
  visual:Object.freeze({spriteKey:ASSET_KEYS.itemCapsule,width:24,height:36,restAngle:0}),
});
