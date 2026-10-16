/** Closed snapshot boundaries for existing source plans/lifecycle. Numeric
 * authoring remains fractional where the current types permit it. No omitted
 * field acquires a source default, and metadata overrides remain separate. */
import type {LinkArrowLaunchPlan} from './linkBow';
import type {LinkSwordBeamPlan} from './linkSwordBeam';
type RecordValue=Record<string,unknown>;
function record(value:unknown,keys:readonly string[],path:string):RecordValue {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${path} must be an object`);
  const r=value as RecordValue;
  if(Object.keys(r).length!==keys.length||keys.some(key=>!Object.hasOwn(r,key)))throw new TypeError(`${path} has missing or unknown fields`);
  return r;
}
function scalar(r:RecordValue,key:string,path:string,min?:number,integer=false,positive=false):number {
  const n=r[key];
  if(typeof n!=='number'||!Number.isFinite(n)||min!==undefined&&n<min||integer&&!Number.isSafeInteger(n)||positive&&n<=0)
    throw new TypeError(`${path}.${key} is invalid`);
  return n;
}
function point(value:unknown,path:string):{readonly x:number;readonly y:number} {
  const r=record(value,['x','y'],path);return Object.freeze({x:scalar(r,'x',path),y:scalar(r,'y',path)});
}
function capsule(value:unknown,path:string) {
  const r=record(value,['start','end','radius'],path);
  return Object.freeze({start:point(r.start,`${path}.start`),end:point(r.end,`${path}.end`),
    radius:scalar(r,'radius',path,0,false,true)});
}
const ARROW_FLAGS={sdiMultiplier:1,shieldDamageAdd:0,rehitFrames:0,setoff:'on',lrCheck:'forward',situation:'ground-air',
  targetCategory:'all',absorbable:false,friendlyFire:false,reflectable:true,direct:false} as const;
const ARROW_KEYS=['releaseAge','arrowIndex','damage','speedNative','firingAngleDegrees','gravityNative','lifetimeFrames',
  'stuckLifetimeFrames','radiusNative','referenceKnockback','hitlagMultiplier',...Object.keys(ARROW_FLAGS)];
export function parseLinkArrowLaunchPlan(value:unknown):LinkArrowLaunchPlan {
  const p='LinkArrowLaunchPlan',r=record(value,ARROW_KEYS,p);
  for(const [key,expected] of Object.entries(ARROW_FLAGS))if(r[key]!==expected)throw new TypeError(`${p}.${key} must retain its source literal`);
  if(r.arrowIndex!==0&&r.arrowIndex!==1)throw new TypeError(`${p}.arrowIndex must be0 or1`);
  const k=record(r.referenceKnockback,['angle','base','growth','fixed'],`${p}.referenceKnockback`);
  return Object.freeze({...ARROW_FLAGS,releaseAge:scalar(r,'releaseAge',p,0,true),arrowIndex:r.arrowIndex,
    damage:scalar(r,'damage',p,0),speedNative:scalar(r,'speedNative',p,0),firingAngleDegrees:scalar(r,'firingAngleDegrees',p),
    gravityNative:scalar(r,'gravityNative',p,0),lifetimeFrames:scalar(r,'lifetimeFrames',p,1,true),
    stuckLifetimeFrames:scalar(r,'stuckLifetimeFrames',p,1,true),radiusNative:scalar(r,'radiusNative',p,0,false,true),
    hitlagMultiplier:scalar(r,'hitlagMultiplier',p,0),referenceKnockback:Object.freeze({angle:scalar(k,'angle',`${p}.referenceKnockback`),
      base:scalar(k,'base',`${p}.referenceKnockback`,0),growth:scalar(k,'growth',`${p}.referenceKnockback`,0),fixed:scalar(k,'fixed',`${p}.referenceKnockback`,0)})});
}
export function parseLinkSwordBeamPlan(value:unknown):LinkSwordBeamPlan {
  const p='LinkSwordBeamPlan',r=record(value,['damage','life','speedNative','scale','rootOffset','brakeNative','capsule'],p);
  return Object.freeze({damage:scalar(r,'damage',p,0),life:scalar(r,'life',p,1,true),speedNative:scalar(r,'speedNative',p,0),
    scale:scalar(r,'scale',p,0,false,true),rootOffset:point(r.rootOffset,`${p}.rootOffset`),brakeNative:scalar(r,'brakeNative',p,0),
    capsule:capsule(r.capsule,`${p}.capsule`)});
}
