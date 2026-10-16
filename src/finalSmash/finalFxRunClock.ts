/** One run-owned carry, admitted from the actual selected startup callback.
 * Its clock advances only on real PRE-stop owner steps, never render calls. */
import type {FinalFxCueFact} from './finalFxProfiles';
import type {FinalSmashActorControl} from './finalSmashActorControl';
export interface FinalFxRunClock {
  readonly runId:number;readonly ownerIndex:number;readonly generation:number;readonly lastFrame:number;
  readonly armed:readonly {readonly cueKey:string;readonly frame:number;readonly sourceAge:number}[];
  readonly flightEntryFrame:number|null;readonly elapsed:number;
}
const flightPhases=new Set(['dash','hit','attack','attack2','attack-finish','return']);
export function stepFinalFxRunClock(state:FinalFxRunClock|null,input:{frame:number;ownerIndex:number;generation:number;
  control:FinalSmashActorControl|null;clockAdvances:boolean;facts:readonly FinalFxCueFact[]}):FinalFxRunClock|null{
  const {control}=input;if(!control||control.role!=='owner'||['finish','miss','done','uncommitted-end-tail'].includes(control.phase))return null;
  if(!Number.isSafeInteger(input.frame)||input.frame<0||!Number.isSafeInteger(input.ownerIndex)||input.ownerIndex<0||
    !Number.isSafeInteger(input.generation)||input.generation<0||!Number.isSafeInteger(control.runId)||control.runId<0||
    !Number.isFinite(control.age)||control.age<0||typeof input.clockAdvances!=='boolean')throw new TypeError('Invalid actual Final FX run clock input');
  let next=state&&state.runId===control.runId&&state.ownerIndex===input.ownerIndex&&state.generation===input.generation?state:
    {runId:control.runId,ownerIndex:input.ownerIndex,generation:input.generation,lastFrame:input.frame,armed:[],flightEntryFrame:null,elapsed:0};
  if(input.frame<next.lastFrame)throw new TypeError('Final FX run clock moved backwards');
  const armed=[...next.armed];
  for(const cue of input.facts){const admission=cue.carryAdmission,sourceAge=control.age+cue.selection.bodyAgeOffset;
    if(cue.clockDomain==='run-flight'&&admission&&control.sheet===admission.motion&&control.phase===admission.phase&&
      sourceAge>=admission.startAge&&!armed.some(row=>row.cueKey===cue.key))armed.push({cueKey:cue.key,frame:input.frame,sourceAge:admission.startAge});
  }
  const enters=next.flightEntryFrame===null&&control.phase==='dash'&&armed.length>0;
  next={...next,lastFrame:input.frame,armed,
    flightEntryFrame:enters?input.frame:next.flightEntryFrame,
    elapsed:enters?0:next.flightEntryFrame===null?
      armed.length?Math.max(0,control.age+input.facts.find(cue=>cue.key===armed[0]!.cueKey)!.selection.bodyAgeOffset-armed[0]!.sourceAge):0:
      next.elapsed+(input.frame>next.lastFrame&&input.clockAdvances&&flightPhases.has(control.phase)?1:0)};
  return Object.freeze({...next,armed:Object.freeze(next.armed.map(row=>Object.freeze({...row})))});
}
export function parseFinalFxRunClock(value:unknown,facts:readonly FinalFxCueFact[]):FinalFxRunClock{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Final FX clock must be object');const r=value as Record<string,unknown>,
    keys=['runId','ownerIndex','generation','lastFrame','armed','flightEntryFrame','elapsed'];
  const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))||
    ![r.runId,r.ownerIndex,r.generation,r.lastFrame].every(integer)||typeof r.elapsed!=='number'||!Number.isFinite(r.elapsed)||r.elapsed<0||!Array.isArray(r.armed)||
    r.flightEntryFrame!==null&&(!integer(r.flightEntryFrame)||Number(r.flightEntryFrame)>Number(r.lastFrame))||
    r.flightEntryFrame!==null&&(!integer(r.elapsed)||Number(r.elapsed)>Number(r.lastFrame)-Number(r.flightEntryFrame)))throw new TypeError('Invalid Final FX clock fields');
  const seen=new Set<string>(),armed=r.armed.map((value,i)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`Invalid FX armed cue ${i}`);
    const a=value as Record<string,unknown>,cue=facts.find(f=>f.key===a.cueKey&&f.clockDomain==='run-flight');
    if(Object.keys(a).length!==3||!['cueKey','frame','sourceAge'].every(k=>Object.hasOwn(a,k))||!cue?.carryAdmission||
      seen.has(String(a.cueKey))||!integer(a.frame)||Number(a.frame)>Number(r.lastFrame)||
      a.sourceAge!==cue.carryAdmission.startAge||
      r.flightEntryFrame!==null&&Number(a.frame)>Number(r.flightEntryFrame))throw new TypeError('Invalid actual startup FX carry receipt');
    seen.add(String(a.cueKey));return Object.freeze({cueKey:String(a.cueKey),frame:a.frame as number,sourceAge:a.sourceAge});});
  if(armed.length>1)throw new TypeError('One actual startup ground/air identity may arm a run glow');
  if(r.flightEntryFrame!==null&&!armed.length)throw new TypeError('Flight glow needs actual startup admission');
  if(!armed.length&&r.elapsed!==0)throw new TypeError('Unarmed startup cannot animate a carried glow');
  return Object.freeze({runId:r.runId as number,ownerIndex:r.ownerIndex as number,generation:r.generation as number,lastFrame:r.lastFrame as number,
    armed:Object.freeze(armed),flightEntryFrame:r.flightEntryFrame as number|null,elapsed:r.elapsed as number});
}
