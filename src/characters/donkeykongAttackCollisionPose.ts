import { attackSensorGeometry, type AttackCollisionHit, type AttackMove } from './attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';

export interface DonkeyKongAttackCollisionPose {
  readonly sheet:string;readonly artFrameIndex:number;readonly nativeSample:number;readonly gameplayAge:number;
  readonly facing:1|-1;readonly collisionHits:readonly Pick<AttackCollisionHit,'id'|'capsule'>[];
  readonly sourceActionAge?:number;
}
interface SourceSensor {
  readonly hits:readonly AttackCollisionHit[];readonly geometry:AttackMove['hitbox'];
  readonly position:{x:number;y:number};readonly ownerAnchored:unknown;readonly postPhysicsOnly:unknown;
}

/** Geometry-only transport shared by the live sensor and the Lab overlay. */
export function applyDonkeyKongPairedAttackGeometry(sourceHits:readonly AttackCollisionHit[],
  pose:Pick<DonkeyKongAttackCollisionPose,'sheet'|'collisionHits'>,basis=1):readonly AttackCollisionHit[]{
  return sourceHits.map(hit=>{
    const override=pose.collisionHits.find(row=>row.id===hit.id);
    if(!override)throw new Error(`DK ${pose.sheet} drawing lacks active source collision ID${hit.id}`);
    const c=override.capsule;
    return {...hit,capsule:{start:{x:c.start.x*basis,y:c.start.y},end:{x:c.end.x*basis,y:c.end.y},radius:c.radius}};
  });
}

/** Per-sensor geometry ownership. A review pose changes no numeric hit rule;
 * retiring its one-age override restores the original source sensor exactly. */
export class DonkeyKongAttackCollisionPoseConsumer {
  private readonly original=new WeakMap<MatterJS.BodyType,SourceSensor>();
  sync(scene:PhysicsHost,body:MatterJS.BodyType,move:AttackMove,position:{x:number;y:number},
    pose:DonkeyKongAttackCollisionPose|null):void {
    const plugin=body.plugin;
    let source=this.original.get(body);
    const resize=(geometry:AttackMove['hitbox'],centre:{x:number;y:number})=>{
      const width=body.bounds.max.x-body.bounds.min.x,height=body.bounds.max.y-body.bounds.min.y;
      if(width<=0||height<=0)throw new Error('DK paired attack sensor has invalid bounds');
      if(!scene.matter.body.scale)throw new Error('DK paired attack geometry requires Matter Body.scale');
      scene.matter.body.scale(body,geometry.width/width,geometry.height/height);
      scene.matter.body.setPosition(body,centre);
    };
    if(!pose){
      if(!source)return;
      resize(source.geometry,move.type==='aerial'?{x:position.x+source.geometry.offsetX*plugin.facing,y:position.y+source.geometry.offsetY}:source.position);
      plugin.collisionHits=source.hits;plugin.hitbox=source.geometry;
      if(source.ownerAnchored===undefined)delete plugin.ownerAnchoredContact;else plugin.ownerAnchoredContact=source.ownerAnchored;
      if(source.postPhysicsOnly===undefined)delete plugin.postPhysicsContactOnly;else plugin.postPhysicsContactOnly=source.postPhysicsOnly;
      delete plugin.donkeykongCollisionPose;this.original.delete(body);return;
    }
    if(!source){
      const hits=plugin.collisionHits as readonly AttackCollisionHit[]|undefined;
      if(!hits?.length)throw new Error(`DK ${pose.sheet} declares paired geometry without source collision IDs`);
      source={hits,geometry:plugin.hitbox,position:{...body.position},
        ownerAnchored:plugin.ownerAnchoredContact,postPhysicsOnly:plugin.postPhysicsContactOnly};
    }
    const basis=pose.facing*plugin.facing;
    const hits=applyDonkeyKongPairedAttackGeometry(source.hits,pose,basis);
    this.original.set(body,source);
    const geometry=attackSensorGeometry({hitbox:move.hitbox,collisionHits:hits});
    resize(geometry,{x:position.x+geometry.offsetX*plugin.facing,y:position.y+geometry.offsetY});
    plugin.collisionHits=hits;plugin.hitbox=geometry;
    plugin.ownerAnchoredContact=true;plugin.postPhysicsContactOnly=true;
    plugin.donkeykongCollisionPose={sheet:pose.sheet,artFrameIndex:pose.artFrameIndex,nativeSample:pose.nativeSample,gameplayAge:pose.gameplayAge,...(pose.sourceActionAge===undefined?{}:{sourceActionAge:pose.sourceActionAge})};
  }
}
