/** Fresh source descriptors for registry/Lab/save tooling. Link's source
 * controller owns their startup, charge, release and article events; these are
 * not admitted to the old generic projectile/trap/rising-ladder consumers. */
import type { ProjectileSpecialMove } from './specialSchema';
import type { BoomerangSideSpecialMove } from './sideSpecialSchema';
import type { MultiHitRisingUpSpecialMove } from './upSpecialSchema';
import type { TrapDownSpecialMove } from './downSpecialSchema';
import { LINK_BOW_SOURCE_PARAMETERS as bow } from './linkBow';
import { LINK_BOOMERANG_REFERENCE_WINDOWS, LINK_BOOMERANG_SOURCE as boomerang } from './linkBoomerang';
import { LINK_REMOTE_BOMB_SOURCE as bomb } from './linkRemoteBomb';
import { LINK_ATTACK_DATA, linkGeometryCapsule, linkReleasePoint } from './linkAttackData';
import { attackSensorGeometry } from './attacks';
const base={sourceRuntimeOwned:true,
  knockback:{x:0,y:0,scaling:0},cooldownFrames:0,
  animation:{startupFrames:1,activeFrames:1,recoveryFrames:1}} as const;
/** Grounded spawn offset of an article (its release point); airborne releases use the air variant at runtime. */
function spawnOffset(article:'arrow'|'boomerang'|'bomb'){const p=linkReleasePoint(article,false);return{spawnOffsetX:p.x,spawnOffsetY:p.y};}
/** An article special's descriptive box is its article's damage area. */
const square=(size:number)=>({offsetX:0,offsetY:0,width:size,height:size});
/** Every Spin Attack capsule, ground and air (the move's broadphase extent). */
function spinBounds(){
  const collisionHits=(['ground','air'] as const).flatMap(variant=>LINK_ATTACK_DATA.spin[variant].phases.flatMap(phase=>
    Array.from({length:phase.active[1]-phase.active[0]+1},(_,i)=>phase.active[0]-1+i).flatMap(age=>phase.packets.map(p=>
      ({id:p.id,capsule:linkGeometryCapsule(`link.spin.${variant}`,age,phase.role,p.id)})))));
  return attackSensorGeometry({hitbox:square(0),collisionHits});
}
export const FRESH_LINK_NEUTRAL_SPECIAL:ProjectileSpecialMove=Object.freeze({...base,
  id:'link.neutral_special',sourcePoseId:'link.neutral_special',type:'special',specialKind:'projectile',damage:4,
  knockback:{x:0,y:0,scaling:0,reference:{angle:361,base:10,growth:71}},
  hitbox:square(13.5),startupFrames:15,activeFrames:1,recoveryFrames:28,hitlagMultiplier:.8,sdiMultiplier:1,
  projectile:{speed:bow.unchargedSpeedNative*5,lifetimeFrames:bow.arrowLifetimeFrames,
    width:13.5,height:13.5,...spawnOffset('arrow')},
});
export const FRESH_LINK_SIDE_SPECIAL:BoomerangSideSpecialMove=Object.freeze({...base,
  id:'link.side_special',sourcePoseId:'link.side_special',type:'sideSpecial',sideSpecialKind:'boomerang',damage:8,
  knockback:{x:0,y:0,scaling:0,reference:{angle:70,base:80,growth:40}},
  hitbox:square(40),startupFrames:26,activeFrames:1,recoveryFrames:18,hitlagMultiplier:1,sdiMultiplier:1,
  projectile:{speed:boomerang.initialSpeedNative.tilt*5,lifetimeFrames:boomerang.codedLifetimeFrames.tilt,
    width:40,height:40,...spawnOffset('boomerang')},
  // Outbound = clean + late phases of the tilt throw (SmashWiki 27-71), counted from the spawn frame.
  boomerang:{outboundFrames:LINK_BOOMERANG_REFERENCE_WINDOWS.tilt.return[0]-LINK_BOOMERANG_REFERENCE_WINDOWS.tilt.clean[0],returnSpeed:boomerang.returnMaximumSpeedNative*5,returnDamage:3,
    lateOutbound:{startFrame:10,damage:6,knockback:{x:0,y:0,scaling:0,reference:{angle:65,base:60,growth:40}}},
    returnKnockback:{x:0,y:0,scaling:0,reference:{angle:70,base:50,growth:40}}},
});
export const FRESH_LINK_UP_SPECIAL:MultiHitRisingUpSpecialMove=Object.freeze({...base,
  id:'link.up_special',sourcePoseId:'link.up_special',type:'upSpecial',upSpecialKind:'multiHitRising',damage:4,
  hitbox:spinBounds(),startupFrames:7,activeFrames:42,recoveryFrames:42,specialLandingLagFrames:30,
  // Kept as a structurally valid source descriptor for tools. The source-owned
  // Spin state selects the real nonuniform packets and powered kinetic fields.
  multiHitRising:{riseImpulse:-2.4*5,driftImpulse:0,hitCount:9,hitInterval:4,
    hitFrames:[0,4,8,11,14,18,23,30,39],activeFramesPerHit:[2,2,2,2,2,2,2,2,3],
    linkDamage:2,linkKnockback:{x:0,y:0,scaling:0},launcherDamage:4,
    launcherKnockback:{x:0,y:0,scaling:0,reference:{angle:361,base:30,growth:200}}},
});
export const FRESH_LINK_DOWN_SPECIAL:TrapDownSpecialMove=Object.freeze({...base,
  id:'link.down_special',sourcePoseId:'link.down_special',type:'downSpecial',downSpecialKind:'trap',damage:0,
  hitbox:square(bomb.blast.radiusNative*10),startupFrames:16,activeFrames:1,recoveryFrames:22,
  trap:{trapWidth:bomb.blast.radiusNative*10,trapHeight:bomb.blast.radiusNative*10,
    ...spawnOffset('bomb'),armDelayFrames:0,trapLifetimeFrames:bomb.lifetimeFrames,
    trapDamage:bomb.blast.damage,trapKnockback:{x:0,y:0,scaling:0,
      reference:{angle:bomb.blast.angle,base:bomb.blast.base,growth:bomb.blast.growth}},
    hitlagMultiplier:bomb.blast.hitlag,sdiMultiplier:1,maxActiveTraps:1},
});
