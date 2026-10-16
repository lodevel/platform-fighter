/** Explicit authoring-clock adapter. Stock7/42/42 stays exact source flow:
 * GroundStart3, release startup3/active33/recovery37; AIR7/42/42. Edited
 * envelope ratios rescale those context phases with integer boundaries.
 * Charge HOLD has a separate source clock and is not part of this envelope. */
import type {AttackMove} from './attacks';
import type {LinkSpinState} from './linkSpinController';
export interface LinkSpinTiming {
  readonly airStartup:number;readonly airActive:number;readonly airRecovery:number;
  readonly groundStart:number;readonly groundReleaseStartup:number;readonly groundActive:number;readonly groundRecovery:number;
}
export function linkSpinTiming(move?:Pick<AttackMove,'startupFrames'|'activeFrames'|'recoveryFrames'>|null):LinkSpinTiming {
  const startup=move?.startupFrames??7,active=move?.activeFrames??42,recovery=move?.recoveryFrames??42;
  if(![startup,active,recovery].every(n=>Number.isSafeInteger(n)&&n>=0))throw new TypeError('Spin authoring requires nonnegative integer envelope clocks');
  const combined=Math.round(6*startup/7),groundStart=Math.round(combined/2);
  return Object.freeze({airStartup:startup,airActive:active,airRecovery:recovery,groundStart,
    groundReleaseStartup:combined-groundStart,groundActive:Math.round(33*active/42),groundRecovery:Math.round(37*recovery/42)});
}
function anchoredAge(age:number,anchors:readonly {actual:number;source:number}[]):number {
  const unique=[...new Map(anchors.map(a=>[a.actual,a])).values()].sort((a,b)=>a.actual-b.actual);
  for(let i=1;i<unique.length;i++){const a=unique[i-1]!,b=unique[i]!;
    if(age<b.actual)return a.source+(age-a.actual)*(b.source-a.source)/(b.actual-a.actual);}
  const last=unique.at(-1)!;return last.source+Math.max(0,age-last.actual);
}
export function linkSpinSourceState(state:LinkSpinState,move?:Pick<AttackMove,'startupFrames'|'activeFrames'|'recoveryFrames'>|null):LinkSpinState {
  const t=linkSpinTiming(move);let age=state.age;
  if(state.phase==='ground-start')age=t.groundStart===0?3:state.age*3/t.groundStart;
  else if(state.phase==='ground-release')age=anchoredAge(age,[{actual:0,source:0},{actual:t.groundReleaseStartup,source:3},
    {actual:t.groundReleaseStartup+t.groundActive,source:36},{actual:t.groundReleaseStartup+t.groundActive+t.groundRecovery,source:73}]);
  else if(state.phase==='air')age=anchoredAge(age,[{actual:0,source:0},{actual:t.airStartup,source:7},
    {actual:t.airStartup+t.airActive,source:49},{actual:t.airStartup+t.airActive+t.airRecovery,source:91}]);
  return Object.freeze({...state,age});
}
export function linkSpinActiveAdmission(state:LinkSpinState,move?:Pick<AttackMove,'startupFrames'|'activeFrames'|'recoveryFrames'>|null):boolean {
  const t=linkSpinTiming(move);
  return state.phase==='air'?t.airActive>0&&state.age>=t.airStartup&&state.age<t.airStartup+t.airActive:
    state.phase==='ground-release'&&t.groundActive>0&&state.age>=t.groundReleaseStartup&&state.age<t.groundReleaseStartup+t.groundActive;
}
