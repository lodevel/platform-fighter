/** Closed ordinary projectile replay boundary. World/render reconstruction,
 * live participant validation and hit-instance object ownership belong to
 * Scene. This reader never synthesizes a creator, source pose or native law. */
import { parseKnockbackSnapshot } from './characterSerializer';
import type { KnockbackSpec } from './moveSchema';
import { parseLinkProjectileMotion, type LinkProjectileMotion } from '../match/linkArticles';

export type OrdinaryProjectileLifetime =
  | { readonly kind: 'finite'; readonly frames: number }
  | { readonly kind: 'unbounded' };
export type OrdinaryProjectileVisualRecipe =
  | { readonly kind: 'item-shot'; readonly visual: 'star' | 'laser' | 'scope' | 'flame' }
  | { readonly kind: 'link-arrow' | 'link-boomerang' | 'shuriken' | 'boomerang' | 'sword-beam' };
export interface OrdinaryBoomerangCheckpoint {
  readonly age: number; readonly returning: boolean; readonly outboundFrames: number;
  readonly returnSpeed: number; readonly returnDamage: number;
  readonly returnKnockback?: KnockbackSpec;
  readonly lateOutbound?: { readonly startFrame: number; readonly damage: number; readonly knockback: KnockbackSpec };
  readonly hitTargets: readonly number[];
}
export interface OrdinaryProjectileCheckpointRow {
  readonly id: number; readonly attackInstanceKey: string;
  readonly ownerSlotIndex: number; readonly creatorPlayerIndex: number; readonly creatorGeneration: number;
  readonly bornFrame: number; readonly moveId: string; readonly facing: 1 | -1; readonly visualFacing: 1 | -1;
  readonly damage: number; readonly knockback: KnockbackSpec;
  readonly hitlagMultiplier: number | null; readonly sdiMultiplier: number | null;
  readonly reflectable: boolean | null; readonly absorbable: boolean | null;
  readonly x: number; readonly y: number; readonly vx: number; readonly vy: number;
  readonly width: number; readonly height: number; readonly remainingLife: OrdinaryProjectileLifetime;
  readonly spawnedThisFrameByMove: string; readonly ignoreStaleMoves: boolean;
  readonly visualRecipe: OrdinaryProjectileVisualRecipe;
  readonly visualTransform: { readonly angle: number; readonly scaleX: number; readonly scaleY: number; readonly visible: boolean };
  readonly boomerang: OrdinaryBoomerangCheckpoint | null;
  /** Link's arrow drop, world px per frame². */
  readonly gravity?: number;
  readonly link?: LinkProjectileMotion;
}
export interface OrdinaryProjectileCheckpoint {
  readonly schema: 'ordinary-world-projectiles/1'; readonly frame: number; readonly nextProjectileId: number;
  readonly projectileSpawnLatch: readonly string[]; readonly rows: readonly OrdinaryProjectileCheckpointRow[];
}
function object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be object`);
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key)))
    throw new TypeError(`${path} requires exact fields`);
  return row;
}
function finite(v: unknown, p: string): number { if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${p} must be finite`); return v; }
function nonnegative(v: unknown, p: string): number { const n=finite(v,p); if(n<0)throw new TypeError(`${p} must be nonnegative`);return n; }
function integer(v: unknown, p: string): number { const n=nonnegative(v,p);if(!Number.isSafeInteger(n))throw new TypeError(`${p} must be safe integer`);return n; }
function positive(v: unknown, p: string): number { const n=finite(v,p);if(n<=0)throw new TypeError(`${p} must be positive`);return n; }
function bool(v: unknown, p: string): boolean { if(typeof v!=='boolean')throw new TypeError(`${p} must be boolean`);return v; }
function text(v: unknown, p: string): string { if(typeof v!=='string'||!v.trim())throw new TypeError(`${p} must be text`);return v; }
function nullableNumber(v: unknown, p: string): number | null { return v===null?null:nonnegative(v,p); }
function nullableBool(v: unknown, p: string): boolean | null { return v===null?null:bool(v,p); }
function knockback(v: unknown,p: string): KnockbackSpec {
  const r=object(v,p,['x','y','scaling'],['reference','baseMagnitude','damageGrowth']);
  if(r.reference!==undefined)object(r.reference,p+'.reference',['base','growth','angle'],['fixed','setWeight','additionalHitstunFrames']);
  const parsed=parseKnockbackSnapshot(r,p);
  return Object.freeze({...parsed,...(parsed.reference?{reference:Object.freeze({...parsed.reference})}:{})});
}
function lifetime(v: unknown,p: string): OrdinaryProjectileLifetime {
  if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(`${p} must be explicit lifetime`);
  const kind=(v as Record<string,unknown>).kind;
  if(kind==='unbounded'){object(v,p,['kind']);return Object.freeze({kind});}
  const row=object(v,p,['kind','frames']);if(kind!=='finite')throw new TypeError(`${p} unknown lifetime kind`);
  // Zero is the declared terminal/pre-tick checkpoint boundary. It cannot
  // silently become an unbounded lifetime or a fresh source TTL on restore.
  return Object.freeze({kind,frames:integer(row.frames,p+'.frames')});
}
function visual(v: unknown,p: string): OrdinaryProjectileVisualRecipe {
  if(!v||typeof v!=='object'||Array.isArray(v))throw new TypeError(`${p} must be recipe`);
  const kind=(v as Record<string,unknown>).kind;
  if(kind==='item-shot'){
    const r=object(v,p,['kind','visual']);if(!['star','laser','scope','flame'].includes(r.visual as string))throw new TypeError(`${p} unknown item visual`);
    return Object.freeze({kind,visual:r.visual as 'star'|'laser'|'scope'|'flame'});
  }
  object(v,p,['kind']);if(!['link-arrow','link-boomerang','shuriken','boomerang','sword-beam'].includes(kind as string))throw new TypeError(`${p} unknown actual renderer`);
  return Object.freeze({kind:kind as 'link-arrow'|'link-boomerang'|'shuriken'|'boomerang'|'sword-beam'});
}
function boomerang(v: unknown,p: string): OrdinaryBoomerangCheckpoint | null {
  if(v===null)return null;
  const r=object(v,p,['age','returning','outboundFrames','returnSpeed','returnDamage','hitTargets'],['returnKnockback','lateOutbound']);
  if(!Array.isArray(r.hitTargets))throw new TypeError(`${p}.hitTargets must be array`);
  const hitTargets=r.hitTargets.map((id,index)=>integer(id,`${p}.hitTargets[${index}]`));
  if(new Set(hitTargets).size!==hitTargets.length)throw new TypeError(`${p} duplicate actual hit target`);
  let lateOutbound: OrdinaryBoomerangCheckpoint['lateOutbound'];
  if(r.lateOutbound!==undefined){const late=object(r.lateOutbound,p+'.lateOutbound',['startFrame','damage','knockback']);
    lateOutbound=Object.freeze({startFrame:integer(late.startFrame,p+'.lateOutbound.startFrame'),damage:nonnegative(late.damage,p+'.lateOutbound.damage'),
      knockback:knockback(late.knockback,p+'.lateOutbound.knockback')});}
  return Object.freeze({age:integer(r.age,p+'.age'),returning:bool(r.returning,p+'.returning'),
    outboundFrames:integer(r.outboundFrames,p+'.outboundFrames'),returnSpeed:nonnegative(r.returnSpeed,p+'.returnSpeed'),
    returnDamage:nonnegative(r.returnDamage,p+'.returnDamage'),hitTargets:Object.freeze(hitTargets),
    ...(r.returnKnockback===undefined?{}:{returnKnockback:knockback(r.returnKnockback,p+'.returnKnockback')}),
    ...(lateOutbound===undefined?{}:{lateOutbound})});
}
export function parseOrdinaryProjectileCheckpoint(value: unknown, path='ordinaryProjectiles'): OrdinaryProjectileCheckpoint {
  const root=object(value,path,['schema','frame','nextProjectileId','projectileSpawnLatch','rows']);
  if(root.schema!=='ordinary-world-projectiles/1'||!Array.isArray(root.rows)||!Array.isArray(root.projectileSpawnLatch))throw new TypeError(`${path} invalid snapshot`);
  const frame=integer(root.frame,path+'.frame'),nextProjectileId=integer(root.nextProjectileId,path+'.nextProjectileId');
  const latch=root.projectileSpawnLatch.map((v,index)=>text(v,`${path}.projectileSpawnLatch[${index}]`));
  if(new Set(latch).size!==latch.length)throw new TypeError(`${path} duplicate spawn latch`);
  const ids=new Set<number>(),instances=new Set<string>();
  const rows=root.rows.map((v,index):OrdinaryProjectileCheckpointRow=>{
    const p=`${path}.rows[${index}]`,r=object(v,p,['id','attackInstanceKey','ownerSlotIndex','creatorPlayerIndex','creatorGeneration','bornFrame','moveId','facing','visualFacing',
      'damage','knockback','hitlagMultiplier','sdiMultiplier','reflectable','absorbable','x','y','vx','vy','width','height','remainingLife',
      'spawnedThisFrameByMove','ignoreStaleMoves','visualRecipe','visualTransform','boomerang'],['gravity','link']);
    const id=integer(r.id,p+'.id'),attackInstanceKey=text(r.attackInstanceKey,p+'.attackInstanceKey'),bornFrame=integer(r.bornFrame,p+'.bornFrame');
    if(ids.has(id)||id>=nextProjectileId||instances.has(attackInstanceKey)||bornFrame>frame)throw new TypeError(`${p} duplicate/future projectile identity`);
    ids.add(id);instances.add(attackInstanceKey);
    if(r.facing!==1&&r.facing!==-1||r.visualFacing!==1&&r.visualFacing!==-1)throw new TypeError(`${p} invalid physical/visual facing`);
    const recipe=visual(r.visualRecipe,p+'.visualRecipe'),transform=object(r.visualTransform,p+'.visualTransform',['angle','scaleX','scaleY','visible']);
    const moveId=text(r.moveId,p+'.moveId'),creatorGeneration=integer(r.creatorGeneration,p+'.creatorGeneration');
    const boom=boomerang(r.boomerang,p+'.boomerang');
    if(boom&&recipe.kind!=='boomerang')throw new TypeError(`${p} Boomerang status belongs to actual Boomerang renderer`);
    return Object.freeze({id,attackInstanceKey,ownerSlotIndex:integer(r.ownerSlotIndex,p+'.ownerSlotIndex'),
      creatorPlayerIndex:integer(r.creatorPlayerIndex,p+'.creatorPlayerIndex'),creatorGeneration,bornFrame,moveId,facing:r.facing,visualFacing:r.visualFacing,
      damage:nonnegative(r.damage,p+'.damage'),knockback:knockback(r.knockback,p+'.knockback'),
      hitlagMultiplier:nullableNumber(r.hitlagMultiplier,p+'.hitlagMultiplier'),sdiMultiplier:nullableNumber(r.sdiMultiplier,p+'.sdiMultiplier'),
      reflectable:nullableBool(r.reflectable,p+'.reflectable'),absorbable:nullableBool(r.absorbable,p+'.absorbable'),
      x:finite(r.x,p+'.x'),y:finite(r.y,p+'.y'),vx:finite(r.vx,p+'.vx'),vy:finite(r.vy,p+'.vy'),
      width:positive(r.width,p+'.width'),height:positive(r.height,p+'.height'),remainingLife:lifetime(r.remainingLife,p+'.remainingLife'),
      spawnedThisFrameByMove:text(r.spawnedThisFrameByMove,p+'.spawnedThisFrameByMove'),ignoreStaleMoves:bool(r.ignoreStaleMoves,p+'.ignoreStaleMoves'),
      visualRecipe:recipe,visualTransform:Object.freeze({angle:finite(transform.angle,p+'.visualTransform.angle'),
        scaleX:finite(transform.scaleX,p+'.visualTransform.scaleX'),scaleY:finite(transform.scaleY,p+'.visualTransform.scaleY'),visible:bool(transform.visible,p+'.visualTransform.visible')}),
      boomerang:boom,...(r.gravity===undefined?{}:{gravity:positive(r.gravity,p+'.gravity')}),
      ...(r.link===undefined?{}:{link:parseLinkProjectileMotion(r.link,p+'.link')})});
  });
  return Object.freeze({schema:'ordinary-world-projectiles/1',frame,nextProjectileId,projectileSpawnLatch:Object.freeze(latch),rows:Object.freeze(rows)});
}
