/** Shared read-only source pose routing for the actual intrinsic controllers
 * and their UI views. This does not advance clocks, emit article callbacks or
 * determine legal entry, physics, damage or actionability. */
import type {AttackMove} from './attacks';
import type {LinkSpecialState} from './linkSpecialController';
import type {LinkSpinState} from './linkSpinController';
import {linkSelectedSpinPhase} from './linkFreshSpin';

export interface LinkIntrinsicBodyRoute {
  readonly motion:string;
  readonly rawAge:number;
  readonly facing:1|-1;
}
export function linkSpecialBodyRoute(state:LinkSpecialState,context:{readonly grounded:boolean;
  readonly facing:1|-1;readonly move?:Pick<AttackMove,'startupFrames'>|null;readonly chargeMaxFrames?:number;}):LinkIntrinsicBodyRoute {
  const air=context.grounded?'':'air_';
  const motion=state.kind==='bow'?state.phase==='full-hold'?`special_${air}n`:
    `special_${air}n_${state.phase==='release'?'end':'start'}`:
    state.kind==='boomerang'?`special_${air}s${state.phase==='catch'?'2':state.phase==='failed'?'1_blank':'1'}`:
      `special_${air}lw${state.phase==='detonate'?'_blast':''}`;
  const nominalStartup=state.kind==='bow'?15:state.kind==='boomerang'?26:16;
  const tunedStartup=context.move?.startupFrames??nominalStartup;
  const entryPhase=state.kind==='bow'?state.phase==='startup':state.kind==='boomerang'?state.phase==='throw'||state.phase==='failed':true;
  const mappedAge=entryPhase?(state.age<tunedStartup?state.age*nominalStartup/Math.max(1,tunedStartup):nominalStartup+state.age-tunedStartup):state.age;
  if(context.chargeMaxFrames!==undefined&&(!Number.isSafeInteger(context.chargeMaxFrames)||context.chargeMaxFrames<0))
    throw new RangeError('Bow source-pose projection requires a nonnegative current charge maximum');
  // Custom power clocks project onto retained source36-frame windup. This
  // changes presentation sampling only, never the actual held counter/power.
  const chargeAge=context.chargeMaxFrames===undefined?state.kind==='bow'?state.chargeFrames:0:
    context.chargeMaxFrames===0?36:Math.min(36,36*(state.kind==='bow'?state.chargeFrames:0)/context.chargeMaxFrames);
  return Object.freeze({motion,rawAge:state.kind==='bow'&&state.phase==='charging'?15+chargeAge:mappedAge,facing:context.facing});
}
export function linkSpinBodyRoute(state:LinkSpinState,facing:1|-1):LinkIntrinsicBodyRoute {
  const phase=linkSelectedSpinPhase(state);
  return Object.freeze({motion:state.phase==='air'?'special_air_hi':state.phase==='helpless'?'fall_special':
    state.phase==='ground-start'?'special_hi_start':state.phase==='ground-hold'?'special_hi_hold':'special_hi',
    rawAge:phase?.rawAge??state.age,facing});
}
