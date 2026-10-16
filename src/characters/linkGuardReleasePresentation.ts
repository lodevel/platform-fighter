/** Actual shield-drop presentation ownership only. Public lock11, source
 * cancel8 and natural16 samples are distinct. Selected rate1 is authored. */
import { parseLinkEquipmentState, type LinkEquipmentState } from './linkEquipment';
export interface LinkGuardReleasePresentation {
  readonly admissionId:string;readonly playerIndex:number;readonly generation:number;
  readonly entryFrame:number;readonly lastFrame:number;readonly rawAge:number;readonly facing:1|-1;
  readonly equipmentAtEntry:LinkEquipmentState;
}
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function beginLinkGuardReleasePresentation(input:{playerIndex:number;generation:number;frame:number;facing:1|-1;acceptedRelease:boolean;equipment:LinkEquipmentState}):LinkGuardReleasePresentation|null {
  if(!integer(input.playerIndex)||!integer(input.generation)||!integer(input.frame)||![-1,1].includes(input.facing)||typeof input.acceptedRelease!=='boolean')throw new TypeError('Actual shield-release identity required');
  if(!input.acceptedRelease)return null;
  return Object.freeze({admissionId:JSON.stringify(['guard-release',input.playerIndex,input.generation,input.frame]),
    playerIndex:input.playerIndex,generation:input.generation,entryFrame:input.frame,lastFrame:input.frame,rawAge:0,
    facing:input.facing,equipmentAtEntry:parseLinkEquipmentState(input.equipment)});
}
export function stepLinkGuardReleasePresentation(state:LinkGuardReleasePresentation,input:{frame:number;generation:number;clockAdvances:boolean;interrupted:boolean}):LinkGuardReleasePresentation|null {
  if(!integer(input.frame)||!integer(input.generation)||typeof input.clockAdvances!=='boolean'||typeof input.interrupted!=='boolean')throw new TypeError('Actual shield-release advancing receipt required');
  if(input.generation!==state.generation||input.interrupted)return null;
  if(input.frame<state.lastFrame)throw new TypeError('Shield release rewind requires checkpoint restore');
  const age=state.rawAge+(input.frame!==state.lastFrame&&input.clockAdvances?1:0);
  return age>=16?null:Object.freeze({...state,lastFrame:input.frame,rawAge:age});
}
export function selectLinkGuardReleasePresentation(state:LinkGuardReleasePresentation|null){return state?Object.freeze({
  motion:'guard_off' as const,rawAge:state.rawAge,facing:state.facing,terminal:false,entryFrame:state.entryFrame,
  admissionId:state.admissionId,equipment:state.equipmentAtEntry}):null;}
export function parseLinkGuardReleasePresentation(value:unknown):LinkGuardReleasePresentation|null {
  if(value===null)return null;
  const fields=['admissionId','playerIndex','generation','entryFrame','lastFrame','rawAge','facing','equipmentAtEntry'];
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Actual guard-release checkpoint required');
  const r=value as Record<string,unknown>;
  if(Object.keys(r).length!==fields.length||fields.some(k=>!Object.hasOwn(r,k))||
    !['playerIndex','generation','entryFrame','lastFrame','rawAge'].every(k=>integer(r[k]))||Number(r.lastFrame)<Number(r.entryFrame)||
    Number(r.rawAge)>=16||Number(r.rawAge)>Number(r.lastFrame)-Number(r.entryFrame)||r.facing!==1&&r.facing!==-1||
    r.admissionId!==JSON.stringify(['guard-release',r.playerIndex,r.generation,r.entryFrame]))throw new TypeError('Invalid exact guard-release lease');
  return Object.freeze({...r,equipmentAtEntry:parseLinkEquipmentState(r.equipmentAtEntry)}) as unknown as LinkGuardReleasePresentation;
}
