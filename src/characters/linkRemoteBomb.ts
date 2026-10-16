/** STAGED. Link owner article lifecycle and special admission, distinct from
 * Bob-omb. Physics/posed attachment is supplied by shared item integration. */
export interface LinkRemoteBombState {readonly itemId:number;readonly ownerIndex:number;
  readonly holderIndex:number|null;readonly age:number;readonly hp:number;
  readonly exploded:boolean;}
export type LinkRemoteBombEntry='generate'|'detonate'|'blocked-held-item'|'blocked-other-holder';
export const LINK_REMOTE_BOMB_SOURCE=Object.freeze({generateFrame:17,generateFAF:40,
  generateAnimationFrames:69,detonateDelayFrames:12,detonateFAF:40,lifetimeFrames:1800,flashFrames:45,
  hp:50,hurtboxRadiusNative:4,throwMultiplier:.6264,itemThrowMultiplier:.72,fighterBombThrowMultiplier:.87,
  itemScale:.6,fighterBombScale:1.35,combinedScale:.81,gravityNative:.07,fallCapNative:2.3,
  frictionNative:.01,speedCapXNative:4,speedCapYNative:4,collisionHalfSizeNative:Object.freeze([2,2] as const),pickupSizeNative:Object.freeze([4,4] as const),
  bounceX:Object.freeze({floor:.9,ceiling:.9,wall:.7,target:.2}),
  bounceY:Object.freeze({floor:.7,ceiling:.6,wall:.6,target:.2}),wallTargetBounceYAdd:1,
  minimumBounceSpeed:.4,postBounceXRange:Object.freeze([.05,3] as const),postBounceYRange:Object.freeze([.1,2.3] as const),
  throwDamage:1,blast:Object.freeze({damage:7,angle:52,base:60,growth:115,radiusNative:14,
    hitlag:.8,absorbable:true,reflectable:true,selfHit:true})});
/** Coordinator-selected named-factor adapter. Preserve ordinary fighter
 * release basis, apply item .72 twice X/onceY and private .87 once EACH axis,
 * then source limits. Common Bomb release caller remains unrecovered. */
export function linkRemoteBombReleaseVelocity(basis:{x:number;y:number;power:number},pixelsPerUnit=5){
  if(![basis.x,basis.y,basis.power,pixelsPerUnit].every(Number.isFinite)||pixelsPerUnit<=0)
    throw new TypeError('Remote Bomb release requires finite basis and positive scale');
  const p=LINK_REMOTE_BOMB_SOURCE,x=basis.x*p.itemThrowMultiplier*p.itemThrowMultiplier*p.fighterBombThrowMultiplier,
    y=basis.y*p.itemThrowMultiplier*p.fighterBombThrowMultiplier;
  return{x:Math.max(-p.speedCapXNative*pixelsPerUnit,Math.min(p.speedCapXNative*pixelsPerUnit,x)),
    y:Math.max(-p.speedCapYNative*pixelsPerUnit,Math.min(p.fallCapNative*pixelsPerUnit,y)),power:basis.power};
}
export function linkRemoteBombEntry(ownerIndex:number,existing:LinkRemoteBombState|null,actorHoldingItem:boolean):LinkRemoteBombEntry{
  if(!existing||existing.exploded)return actorHoldingItem?'blocked-held-item':'generate';
  if (existing.ownerIndex !== ownerIndex) return 'blocked-other-holder';
  // Captured SpecialLw/pre Item.is_had(false)==false rejects ANY holder,
  // including the owner. Ownership and held admission are distinct checks.
  return existing.holderIndex!==null?'blocked-other-holder':'detonate';
}
export function createLinkRemoteBomb(itemId:number,ownerIndex:number):LinkRemoteBombState{
  return Object.freeze({itemId,ownerIndex,holderIndex:ownerIndex,age:0,hp:50,exploded:false});
}
/** Commit at LinkSpecialController's source frame12 callback. Do not schedule
 * another12-frame delay here: the actor action already owns that delay. */
export function detonateLinkRemoteBombNow(state:LinkRemoteBombState,requester:number):
  {state:LinkRemoteBombState;explode:boolean}{
  if(state.exploded||state.ownerIndex!==requester||state.holderIndex!==null)
    return{state,explode:false};
  return{state:Object.freeze({...state,exploded:true}),explode:true};
}
export function setRemoteBombHolder(state:LinkRemoteBombState,holderIndex:number|null):LinkRemoteBombState{
  return state.exploded?state:Object.freeze({...state,holderIndex});
}
export function stepLinkRemoteBomb(state:LinkRemoteBombState,clockAdvances:boolean,lifetimeFrames=LINK_REMOTE_BOMB_SOURCE.lifetimeFrames):
  {state:LinkRemoteBombState;explode:boolean;flashing:boolean}{
  if(!Number.isSafeInteger(lifetimeFrames)||lifetimeFrames<1)throw new TypeError('Bomb selected lifetime must be a positive integer');
  const flash=Math.max(0,lifetimeFrames-LINK_REMOTE_BOMB_SOURCE.flashFrames);
  if(state.exploded||!clockAdvances)return{state,explode:false,flashing:state.age>=flash};
  const age=state.age+1,explode=age>=lifetimeFrames;
  return{state:Object.freeze({...state,age,exploded:explode}),explode,flashing:age>=flash};
}
