import {attackSensorGeometry,type AttackCollisionHit,type AttackMove} from './attacks';
import type { PhysicsHost } from '../physics/PhysicsWorld';

/** Geometry-only authored target pose in drawing-actor-centre world units. */
export interface DonkeyKongCatchCollisionPoseRow {
  readonly artFrameIndex:number;
  readonly nativeSample:number;
  readonly regions:readonly Pick<AttackCollisionHit,'id'|'capsule'>[];
}
export interface DonkeyKongCatchCollisionPose extends DonkeyKongCatchCollisionPoseRow {
  readonly sheet:string;
  readonly sourceGameplayAge:number;
  readonly facing:1|-1;
}
export type DonkeyKongCatchFallbackReason='missing-clip-metadata'|'missing-pose-row'|
  'paired-drawing-unavailable'|'paired-sample-mismatch'|'empty-active-row'|
  'active-id-set-mismatch'|'invalid-capsule'|'duplicate-pose-row';
export interface DonkeyKongCatchPoseSelection {
  readonly optedIn:boolean;
  readonly sheet:string;
  readonly artFrameIndex:number|null;
  readonly nativeSample:number|null;
  readonly sourceGameplayAge:number;
  readonly providedRegionIds:readonly number[];
  readonly pose:DonkeyKongCatchCollisionPose|null;
  readonly fallbackReason:DonkeyKongCatchFallbackReason|null;
}
export interface DonkeyKongCatchCollisionDiagnostic {
  readonly sheet:string;readonly artFrameIndex:number|null;readonly nativeSample:number|null;
  readonly sourceGameplayAge:number;readonly ownerBodyId:number|undefined;
  readonly sourceRegionIds:readonly number[];readonly providedRegionIds:readonly number[];
  readonly reason:DonkeyKongCatchFallbackReason|null;
  readonly sourceGeometryRestored:boolean;
}

function validCatchCapsule(c:AttackCollisionHit['capsule']|undefined):boolean {
  if(!c||![c.start?.x,c.start?.y,c.end?.x,c.end?.y,c.radius].every(Number.isFinite)||c.radius<=0)return false;
  // Finite fields can still overflow the union used for real Matter bounds.
  const minX=Math.min(c.start.x,c.end.x)-c.radius,maxX=Math.max(c.start.x,c.end.x)+c.radius;
  const minY=Math.min(c.start.y,c.end.y)-c.radius,maxY=Math.max(c.start.y,c.end.y)+c.radius;
  return [minX,maxX,minY,maxY,maxX-minX,maxY-minY].every(Number.isFinite);
}

function validCatchUnion(regions:DonkeyKongCatchCollisionPoseRow['regions']):boolean {
  const bounds=attackSensorGeometry({hitbox:{offsetX:0,offsetY:0,width:1,height:1},collisionHits:regions});
  return [bounds.offsetX,bounds.offsetY,bounds.width,bounds.height].every(Number.isFinite)&&bounds.width>0&&bounds.height>0;
}

/** Validate metadata without changing source capture timing or suppressing it.
 * Even an explicit empty active row is source fallback, never a no-catch flag. */
export function readDonkeyKongCatchPose(input:{
  readonly sheet:string;readonly sourceGameplayAge:number;readonly facing:1|-1;
  readonly rows:readonly DonkeyKongCatchCollisionPoseRow[]|undefined;
  readonly drawing:{readonly artFrameIndex:number;readonly nativeSample:number}|null;
}):DonkeyKongCatchPoseSelection {
  const {sheet,sourceGameplayAge,facing,rows,drawing}=input;
  const base={optedIn:rows!==undefined,sheet,sourceGameplayAge,providedRegionIds:[] as number[],
    artFrameIndex:drawing?.artFrameIndex??null,nativeSample:drawing?.nativeSample??null};
  const fallback=(fallbackReason:DonkeyKongCatchFallbackReason):DonkeyKongCatchPoseSelection=>({...base,pose:null,fallbackReason});
  if(rows===undefined)return fallback('missing-clip-metadata');
  if(!drawing)return fallback('paired-drawing-unavailable');
  if(!Array.isArray(rows))return fallback('missing-pose-row');
  const matching=rows.filter(row=>row?.artFrameIndex===drawing.artFrameIndex);
  if(matching.length>1)return fallback('duplicate-pose-row');
  const row=matching[0];
  if(!row)return fallback('missing-pose-row');
  if(!Number.isInteger(row.artFrameIndex)||row.artFrameIndex<0||!Number.isFinite(row.nativeSample)||
    row.nativeSample!==drawing.nativeSample)return fallback('paired-sample-mismatch');
  if(!Array.isArray(row.regions))return fallback('invalid-capsule');
  base.providedRegionIds=row.regions.flatMap((region:Pick<AttackCollisionHit,'id'|'capsule'>)=>Number.isInteger(region?.id)?[region.id]:[]);
  if(row.regions.length===0)return fallback('empty-active-row');
  const ids=new Set<number>();
  for(const region of row.regions){
    const c=region?.capsule;
    if(!Number.isInteger(region?.id)||region.id<0||ids.has(region.id)||!validCatchCapsule(c))
      return fallback('invalid-capsule');
    ids.add(region.id);
  }
  if(!validCatchUnion(row.regions))return fallback('invalid-capsule');
  return {...base,pose:{...row,sheet,sourceGameplayAge,facing},fallbackReason:null};
}

/** Parent IDs and situations stay authoritative; only the capsule is replaced.
 * D*A converts drawing x to plugin actor x; plugin A then mirrors exactly once. */
export function applyDonkeyKongPairedCatchGeometry(source:readonly AttackCollisionHit[],
  pose:DonkeyKongCatchCollisionPose,basis:1|-1):readonly AttackCollisionHit[]|null {
  if(source.length===0||pose.regions.length!==source.length)return null;
  if(pose.regions.some(row=>!Number.isInteger(row.id)||row.id<0||!validCatchCapsule(row.capsule)))return null;
  if(!validCatchUnion(pose.regions))return null;
  const ids=new Set(pose.regions.map(row=>row.id));
  if(ids.size!==source.length||source.some(row=>!ids.has(row.id)))return null;
  return source.map(row=>{
    const c=pose.regions.find(region=>region.id===row.id)!.capsule;
    return {...row,capsule:{start:{x:c.start.x*basis,y:c.start.y},
      end:{x:c.end.x*basis,y:c.end.y},radius:c.radius}};
  });
}
interface SourceCatchSensor {
  readonly hits:readonly AttackCollisionHit[]|undefined;
  readonly geometry:AttackMove['hitbox'];
}

/** One stable sensor owns a source snapshot for its entire active window.
 * An opted-in unmatched/invalid pose restores source geometry and keeps the
 * declared solved owner-root tracking policy. Unopted sensors are untouched. */
export class DonkeyKongCatchCollisionPoseConsumer {
  private readonly original=new WeakMap<MatterJS.BodyType,SourceCatchSensor>();
  owns(body:MatterJS.BodyType):boolean {return this.original.has(body);}
  forget(body:MatterJS.BodyType):void {this.original.delete(body);}
  sync(scene:PhysicsHost,body:MatterJS.BodyType,
    sourceSpec:Pick<AttackMove,'hitbox'|'collisionHits'>,position:{x:number;y:number},
    selection:DonkeyKongCatchPoseSelection):DonkeyKongCatchCollisionDiagnostic|null {
    let source=this.original.get(body);
    if(!source&&!selection.optedIn)return null;
    const plugin=body.plugin;
    if(!source){
      const hits=plugin.collisionHits as readonly AttackCollisionHit[]|undefined;
      source={hits,geometry:plugin.hitbox??sourceSpec.hitbox};
      this.original.set(body,source);
    }
    const actorFacing=plugin.facing as 1|-1;
    const hits=selection.pose&&source.hits
      ?applyDonkeyKongPairedCatchGeometry(source.hits,selection.pose,(selection.pose.facing*actorFacing) as 1|-1):null;
    const reason=selection.fallbackReason??(hits===null?'active-id-set-mismatch':null);
    const selected=hits??source.hits;
    const geometry=selected?.length?attackSensorGeometry({hitbox:source.geometry,collisionHits:selected}):source.geometry;
    const width=body.bounds.max.x-body.bounds.min.x,height=body.bounds.max.y-body.bounds.min.y;
    if(width<=0||height<=0||!scene.matter.body.scale)throw new Error('DK posed CATCH requires valid Matter sensor bounds and Body.scale');
    if(Math.abs(width-geometry.width)>1e-9||Math.abs(height-geometry.height)>1e-9)
      scene.matter.body.scale(body,geometry.width/width,geometry.height/height);
    scene.matter.body.setPosition(body,{x:position.x+geometry.offsetX*actorFacing,y:position.y+geometry.offsetY});
    if(selected===undefined)delete plugin.collisionHits;else plugin.collisionHits=selected;
    plugin.hitbox=geometry;
    plugin.ownerAnchoredContact=true;
    plugin.postPhysicsContactOnly=true;
    const diagnostic:DonkeyKongCatchCollisionDiagnostic={sheet:selection.sheet,
      artFrameIndex:selection.artFrameIndex,nativeSample:selection.nativeSample,
      sourceGameplayAge:selection.sourceGameplayAge,ownerBodyId:plugin.ownerBodyId,
      sourceRegionIds:source.hits?.map(row=>row.id)??[],providedRegionIds:selection.providedRegionIds,
      reason,sourceGeometryRestored:hits===null};
    plugin.donkeykongCatchCollisionPose=diagnostic;
    return diagnostic;
  }
}
