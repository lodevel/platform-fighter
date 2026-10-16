/** STAGED. Native expression-driven equipment state and passive shield
 * eligibility. Actual outgoing/receiving/shield surface comes from new posed
 * source anatomy; never a fixed front-of-body rectangle. */
export type LinkEquipmentPlacement='normal'|'back'|'hidden';
export interface LinkEquipmentState {readonly sword:LinkEquipmentPlacement;readonly shield:LinkEquipmentPlacement;
  readonly bow:'have'|'back'|'hidden';readonly heldItemVisible:boolean;readonly ancientBowVisible:boolean;}
export interface LinkEquipmentEvent {readonly nativeFrame:number;readonly sourceOrder:number;
  readonly sword?:LinkEquipmentPlacement;readonly shield?:LinkEquipmentPlacement;
  readonly bow?:LinkEquipmentState['bow'];readonly heldItemVisible?:boolean;readonly ancientBowVisible?:boolean;}
/** Initial hidden Bow is an explicit conservative engine adapter: captured
 * Link initial common creation/BACK article caller is unavailable. First Bow
 * action admits generated Have; sourced release/status exit persists Back. */
export const LINK_NORMAL_EQUIPMENT:LinkEquipmentState=Object.freeze({sword:'normal',shield:'normal',bow:'hidden',
  heldItemVisible:true,ancientBowVisible:false});
/** A checkpointed equipment state: exactly the five roles, each a declared placement. */
export function parseLinkEquipmentState(v:unknown,p='equipment'):LinkEquipmentState{
  if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(`${p} must be object`);
  const r=v as Record<string,unknown>,keys=['sword','shield','bow','heldItemVisible','ancientBowVisible'];
  if(Object.keys(r).some(k=>!keys.includes(k))||keys.some(k=>!Object.prototype.hasOwnProperty.call(r,k)))throw new TypeError(`${p} requires exact fields`);
  if(!['normal','back','hidden'].includes(r.sword as string)||!['normal','back','hidden'].includes(r.shield as string)
    ||!['have','back','hidden'].includes(r.bow as string)||typeof r.heldItemVisible!=='boolean'
    ||typeof r.ancientBowVisible!=='boolean')throw new TypeError(`${p} actual equipment roles invalid`);
  return Object.freeze({sword:r.sword as LinkEquipmentState['sword'],shield:r.shield as LinkEquipmentState['shield'],
    bow:r.bow as LinkEquipmentState['bow'],heldItemVisible:r.heldItemVisible,ancientBowVisible:r.ancientBowVisible});
}
export function applyLinkEquipmentEvents(state:LinkEquipmentState,events:readonly LinkEquipmentEvent[]):LinkEquipmentState{
  let next={...state};
  for(const event of [...events].sort((a,b)=>a.nativeFrame-b.nativeFrame||a.sourceOrder-b.sourceOrder)){
    const {nativeFrame:_nativeFrame,sourceOrder:_sourceOrder,...changes}=event;next={...next,...changes};
  }
  return Object.freeze(next);
}
export type LinkPassiveShieldPose='standing'|'walking'|'crouching'|'other';
export function linkPassiveShieldEligible(input:{readonly pose:LinkPassiveShieldPose;readonly equipment:LinkEquipmentState;
  readonly captured:boolean;readonly hitstun:boolean;readonly committingAction:boolean;}):boolean{
  return input.pose!=='other'&&input.equipment.shield==='normal'&&!input.captured&&!input.hitstun&&!input.committingAction;
}
export interface LinkPassiveProjectile {readonly reflectable:boolean;
  /** Object identity is retained for callers; source contact eligibility is
   * reflectability, including attached reflectable hitboxes. */
  readonly isProjectile:boolean;readonly unblockable:boolean;}
/** Passive shield blocks, never reflects. The source admits reflectable,
 * blockable hitboxes, including attached ones; a detached projectile object
 * alone is insufficient. Power has no maximum or authored damage threshold. */
export function linkPassiveShieldCanIntercept(projectile:LinkPassiveProjectile,shieldEligible:boolean):boolean{
  return shieldEligible&&projectile.reflectable&&!projectile.unblockable;
}
/** SDI/slight pushback magnitude and direction remain a supplied engine/native
 * policy. The world contact point and actual held shield surface own the basis. */
export interface LinkPassiveShieldIntercept {readonly retireProjectile:boolean;readonly damage:0;readonly reflected:false;
  readonly worldContact:{readonly x:number;readonly y:number};}
export function linkPassiveShieldIntercept(worldContact:{x:number;y:number},retireProjectile:boolean):LinkPassiveShieldIntercept{
  return Object.freeze({retireProjectile,damage:0,reflected:false,worldContact:Object.freeze({...worldContact})});
}
