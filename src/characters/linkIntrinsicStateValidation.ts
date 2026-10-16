/** Closed actor-owned intrinsic checkpoint leaves. These restore clocks and
 * source transactions only; they never emit callbacks or create world items. */
import type {LinkSpecialState} from './linkSpecialController';
import type {LinkSpinState} from './linkSpinController';
import type {LinkRemoteBombState} from './linkRemoteBomb';
import {parseLinkArrowLaunchPlan} from './linkArticlePlanValidation';

function record(value:unknown,keys:readonly string[],path:string):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${path} must be an object`);
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==keys.length||keys.some(key=>!Object.hasOwn(row,key)))throw new TypeError(`${path} has missing or unknown fields`);
  return row;
}
function number(row:Record<string,unknown>,key:string,path:string,integer=true):number{
  const value=row[key];if(typeof value!=='number'||!Number.isFinite(value)||value<0||integer&&!Number.isSafeInteger(value))
    throw new TypeError(`${path}.${key} is invalid`);return value;
}
export function parseLinkSpecialState(value:unknown):LinkSpecialState|null{
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Malformed Link special state');
  const kind=(value as Record<string,unknown>).kind,path=`LinkSpecialState.${String(kind)}`;
  if(kind==='bow'){
    const row=record(value,['kind','phase','age','chargeFrames','fullHoldFrames','doubleArrow','volley'],path);
    const phase=row.phase;
    if(phase!=='startup'&&phase!=='charging'&&phase!=='full-hold'&&phase!=='release'||typeof row.doubleArrow!=='boolean'||!Array.isArray(row.volley))
      throw new TypeError(`${path} has invalid phase/volley`);
    const age=number(row,'age',path),chargeFrames=number(row,'chargeFrames',path),fullHoldFrames=number(row,'fullHoldFrames',path);
    const volley=row.volley.map(parseLinkArrowLaunchPlan);
    if(phase==='release'?(volley.length!==(row.doubleArrow?2:1)||volley.some((plan,i)=>plan.arrowIndex!==i||plan.releaseAge!==(i===0?0:3))):volley.length!==0)
      throw new TypeError(`${path} has inconsistent release transaction`);
    if(phase==='startup'&&(chargeFrames!==0||fullHoldFrames!==0)||phase==='charging'&&fullHoldFrames!==0||
      phase==='full-hold'&&age!==fullHoldFrames)throw new TypeError(`${path} has inconsistent charge clocks`);
    return Object.freeze({kind,phase,age,chargeFrames,fullHoldFrames,doubleArrow:row.doubleArrow,volley:Object.freeze(volley)});
  }
  if(kind==='boomerang'){
    const row=record(value,['kind','phase','age','throwKind','firstActionable'],path),phase=row.phase,throwKind=row.throwKind;
    if(phase!=='throw'&&phase!=='failed'&&phase!=='catch'||throwKind!=='tilt'&&throwKind!=='smash')throw new TypeError(`${path} has invalid phase/kind`);
    const firstActionable=number(row,'firstActionable',path);if(firstActionable<1)throw new TypeError(`${path} has invalid actionability`);
    return Object.freeze({kind,phase,throwKind,age:number(row,'age',path),firstActionable});
  }
  if(kind==='bomb'){
    const row=record(value,['kind','phase','age'],path),phase=row.phase;
    if(phase!=='generate'&&phase!=='detonate')throw new TypeError(`${path} has invalid phase`);
    return Object.freeze({kind,phase,age:number(row,'age',path)});
  }
  throw new TypeError('Unknown Link special state');
}
export function parseLinkSpinState(value:unknown):LinkSpinState|null{
  if(value===null)return null;
  const row=record(value,['phase','age','chargeFrames','damageMultiplier'],'LinkSpinState'),phase=row.phase;
  if(phase!=='ground-start'&&phase!=='ground-hold'&&phase!=='ground-release'&&phase!=='air'&&phase!=='helpless'&&phase!=='done')
    throw new TypeError('Unknown Link Spin phase');
  const damageMultiplier=number(row,'damageMultiplier','LinkSpinState',false);
  if(damageMultiplier<1||damageMultiplier>1.6)throw new TypeError('Invalid source Spin multiplier');
  return Object.freeze({phase,age:number(row,'age','LinkSpinState'),chargeFrames:number(row,'chargeFrames','LinkSpinState'),damageMultiplier});
}
export function parseLinkRemoteBombState(value:unknown):LinkRemoteBombState|null{
  if(value===null)return null;
  const row=record(value,['itemId','ownerIndex','holderIndex','age','hp','exploded'],'LinkRemoteBombState');
  if(typeof row.exploded!=='boolean')throw new TypeError('Invalid Bomb retirement flag');
  const hp=number(row,'hp','LinkRemoteBombState',false);if(hp>50||hp===0&&!row.exploded)throw new TypeError('Invalid source Bomb HP');
  return Object.freeze({itemId:number(row,'itemId','LinkRemoteBombState'),ownerIndex:number(row,'ownerIndex','LinkRemoteBombState'),
    holderIndex:row.holderIndex===null?null:number(row,'holderIndex','LinkRemoteBombState'),age:number(row,'age','LinkRemoteBombState'),hp,exploded:row.exploded});
}
