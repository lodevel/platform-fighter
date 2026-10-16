import { BASELINE_MASS, computeKnockback, type HitInfo } from '../characters/combat';
import type { ItemDefinition } from './ItemDefinition';
import type { ItemAction } from './itemActions';

/** Native units, independent of the fighter's throw motion. Profiles retain
 * source fields; world integration and stage contact use the 2D game's adapter.
 * See the pinned workbook and native crate scripts in DK's evidence record. */
export interface NativeItemThrowProfile {
  readonly pixelsPerUnit: number;
  readonly speedMultiplier: number;
  readonly gravity: number;
  readonly terminalFallSpeed: number;
  readonly airBrakeX: number;
  readonly maxSpeedX: number;
  /** item_common outer_limit_speed_y: the vertical release-speed limit (native units); absent = none. */
  readonly maxSpeedY?: number;
  readonly mapBottom: number;
  readonly attackRadius: number;
  readonly damage: number;
  readonly damageSpeedAdd: number;
  readonly damageSpeedMultiplier: number;
  readonly knockback: Readonly<{ base:number; growth:number; fixed:number; angle:number }>;
  readonly hitlagMultiplier: number;
  readonly sdiMultiplier: number;
  /** Published experimental rule for ordinary thrown items, independently
   * recorded from the native packet. Excludes explosive/character items. */
  readonly referenceKnockbackMultiplier: number;
  readonly nativeCollisionAttribute?: string;
  /** item_common bound_refspeed_throw_{mul,add_x,add_y}: the bounce off a target the throw hit
   * (native units; the item then falls without attacking). */
  readonly throwRebound: Readonly<{ mul: number; addX: number; addY: number }>;
  /** Undefined means the native force rule remains unrecovered. */
  readonly nativeForceReaction?: boolean;
  readonly reflectable?:boolean;readonly absorbable?:boolean;
}

/** The measured item multiplier is applied twice to horizontal speed and
 * once to vertical speed. The fighter multiplier is already in the input.
 * Horizontal outer-limit clamping is retained separately from fall speed. */
export function nativeItemReleaseVelocity(profile:NativeItemThrowProfile,
  velocity:{x:number;y:number;power:number}):{x:number;y:number;power:number} {
  const max=profile.maxSpeedX*profile.pixelsPerUnit,up=(profile.maxSpeedY??Number.POSITIVE_INFINITY)*profile.pixelsPerUnit;
  const x=velocity.x*profile.speedMultiplier*profile.speedMultiplier;
  return {x:Math.max(-max,Math.min(max,x)),
    y:Math.max(-up,Math.min(profile.terminalFallSpeed*profile.pixelsPerUnit,velocity.y*profile.speedMultiplier)),power:velocity.power};
}

/** Adapter order matches the existing fixed item loop: move, then integrate
 * velocity. Native per-item coefficients replace the authored constants. */
export function advanceNativeItemVelocity(profile:NativeItemThrowProfile,
  velocity:{vx:number;vy:number}):{vx:number;vy:number} {
  const brake=profile.airBrakeX*profile.pixelsPerUnit;
  return {vx:Math.sign(velocity.vx)*Math.max(0,Math.abs(velocity.vx)-brake),
    vy:Math.min(profile.terminalFallSpeed*profile.pixelsPerUnit,velocity.vy+profile.gravity*profile.pixelsPerUnit)};
}

/** Flight velocity of a free item launched by an attack (ItemDefinition.launchedByAttacks): the hit's own
 * launch through the shared knockback formula. SmashWiki gives no item weight or percent, so the item is the
 * formula's neutral airborne target (0%, weight 100); its flight then follows the item's throw profile. */
export function itemAttackLaunchVelocity(hit:HitInfo):{vx:number;vy:number} {
  const launch=computeKnockback(hit,0,BASELINE_MASS,{referenceWeight:100,grounded:false}).vector;
  return {vx:launch.x,vy:launch.y};
}

/** Speed damage uses the actual world flight velocity converted back to
 * native units. This packet does not invent the unmapped ATTACK_FP flags or
 * claim that published common item rules came from the packet itself. */
export function nativeItemThrowHit(profile:NativeItemThrowProfile,
  velocity:{vx:number;vy:number},power=1,receivingMultiplier=1):HitInfo {
  const speed=Math.hypot(velocity.vx,velocity.vy)/profile.pixelsPerUnit;
  return {damage:Math.max(0,profile.damage*power+profile.damageSpeedAdd+speed*profile.damageSpeedMultiplier)*receivingMultiplier,
    knockback:{x:0,y:0,scaling:0,reference:profile.knockback},facing:velocity.vx<0?-1:1,
    referenceKnockbackMultiplier:profile.referenceKnockbackMultiplier,
    hitlagMultiplier:profile.hitlagMultiplier,sdiMultiplier:profile.sdiMultiplier,direct:false,
    ...(profile.reflectable===undefined?{}:{reflectable:profile.reflectable}),...(profile.absorbable===undefined?{}:{absorbable:profile.absorbable}),
    ...(profile.nativeCollisionAttribute===undefined?{}:{nativeCollisionAttribute:profile.nativeCollisionAttribute}),
    ...(profile.nativeForceReaction===undefined?{}:{nativeForceReaction:profile.nativeForceReaction})};
}

/** The hit a thrown item lands: the shared formula, then the item's own rules (ItemDefinition.thrownHit): the SmashWiki
 * per-throw damage, a downward-throw launch, a slip on a grounded target. */
export function thrownItemHit(def:Pick<ItemDefinition,'throwProfile'|'thrownHit'>,throwAction:ItemAction|undefined,
  velocity:{vx:number;vy:number},power:number,receivingMultiplier:number,targetGrounded:boolean):HitInfo{
  const hit=nativeItemThrowHit(def.throwProfile,velocity,power,receivingMultiplier),rules=def.thrownHit;
  if(!rules||throwAction===undefined)return hit;
  const damage=rules.damageByAction[throwAction];
  const down=rules.downKnockback!==undefined&&throwAction.includes('-down-');
  return {...hit,...(damage===undefined?{}:{damage:damage*receivingMultiplier}),
    ...(down?{knockback:{...hit.knockback,reference:rules.downKnockback}}:{}),
    ...(rules.slipGrounded&&targetGrounded?{slip:true}:{})};
}

/** Native item_common kinetics (ultimate-13.0.1-params workbook): gravity, max fall speed, air brake
 * and horizontal outer limit (none for weapons), native units. */
export interface ItemThrowKinetics {
  readonly gravity: number;
  readonly terminalFallSpeed: number;
  readonly airBrakeX: number;
  readonly maxSpeedX: number;
  readonly maxSpeedY?: number;
  readonly throwRebound: NativeItemThrowProfile['throwRebound'];
}
/** item_common row `homerunbat` (native-derived): weapons have no horizontal outer limit (-1). */
export const HOME_RUN_BAT_THROW_KINETICS: ItemThrowKinetics = Object.freeze({
  gravity: .08, terminalFallSpeed: 3, airBrakeX: .0001, maxSpeedX: Number.POSITIVE_INFINITY,
  throwRebound: Object.freeze({ mul: .05, addX: .2, addY: 1.9 }),
});

/**
 * A thrown item on the Ultimate formula (SmashWiki Item_throw, universal-rules.json dropToss):
 * damage `d * power − 0.4 + speed * 3` (power 0.5 = grounded drop halves d), knockback × 0.8.
 * `damage` is the item's base damage d. Silent fields default to authored values: a 6-unit throw
 * sphere centred `mapBottom` units above the item root and reference knockback 30/80 at 361°.
 */
export function ultimateItemThrowProfile(spec: {
  readonly damage: number;
  readonly kinetics?: ItemThrowKinetics;
  readonly speedMultiplier?: number;
  readonly mapBottom?: number;
  readonly attackRadius?: number;
  readonly knockback?: NativeItemThrowProfile['knockback'];
  /** 1 for explosive throws (SmashWiki Item_throw: the 0.8× multiplier skips explosive hitboxes). */
  readonly referenceKnockbackMultiplier?: number;
}): NativeItemThrowProfile {
  const kinetics = spec.kinetics ?? HOME_RUN_BAT_THROW_KINETICS;
  return Object.freeze({
    pixelsPerUnit: 5, speedMultiplier: spec.speedMultiplier ?? 1, ...kinetics,
    mapBottom: spec.mapBottom ?? 3, attackRadius: spec.attackRadius ?? 6,
    damage: spec.damage, damageSpeedAdd: -.4, damageSpeedMultiplier: 3,
    knockback: spec.knockback ?? Object.freeze({ base: 30, growth: 80, fixed: 0, angle: 361 }),
    hitlagMultiplier: 1, sdiMultiplier: 1, referenceKnockbackMultiplier: spec.referenceKnockbackMultiplier ?? .8,
  });
}

/** World velocity after a thrown item hits a target: it bounces back by its native rebound and
 * then falls (no further hits). */
export function itemThrowReboundVelocity(profile:NativeItemThrowProfile,velocity:{vx:number;vy:number}):{vx:number;vy:number}{
  const ppu=profile.pixelsPerUnit,r=profile.throwRebound,dir=velocity.vx<0?1:-1;
  return {vx:dir*(Math.abs(velocity.vx)/ppu*r.mul+r.addX)*ppu,vy:-r.addY*ppu};
}
