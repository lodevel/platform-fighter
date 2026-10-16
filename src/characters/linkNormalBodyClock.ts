/** Gameplay age -> native motion frame for Link's normals (body art only;
 * hit geometry is per-age data in linkAttackGeometry.json). Each public
 * window starts at its script creation frame (`nativeStart` in
 * linkAttackData.json); the evaluated pose sits one native frame earlier
 * (reviewed pose/contact correspondences, the same offset
 * tools/native-hit-positions.py uses). tools/link-normal-clock-dump.ts bakes
 * this mapping into the converted art's actionFrameStarts. */
import { LINK_NORMAL_RULES, type LinkNormalId } from './linkNormalRules';
import { LINK_ATTACK_DATA } from './linkAttackData';

const POSE_OFFSET = -1;

export function linkNormalSourcePhase(id:LinkNormalId,age:number) {
  const windows=LINK_NORMAL_RULES[id].windows,index=windows.findIndex(w=>age>=w.first-1&&age<w.last);
  return index<0?null:{role:windows[index]!.role,index};
}
function linkNormalMappedFrame(id:LinkNormalId,age:number,poseLandmark:boolean):number {
  const rule=LINK_NORMAL_RULES[id],phases=LINK_ATTACK_DATA.normals[id]!.phases;
  const points:{age:number;native:number}[]=[{age:0,native:0}];
  for(const w of rule.windows){
    const lexical=phases[w.role]?.nativeStart;
    if(typeof lexical!=='number')throw new Error(`Missing Link pose landmark ${id}/${w.role}`);
    const native=lexical+(poseLandmark?POSE_OFFSET:0),length=w.last-w.first+1;
    points.push({age:w.first-1,native});
    if(poseLandmark&&id==='link.bair'&&w.role==='Hit 2'){
      // Reviewed last contact pose16 then clear pose18 (pose only; script callbacks stay continuous).
      points.push({age:w.last-1,native:native+length-1},{age:w.last,native:18});
    }else points.push({age:w.last,native:native+length});
  }
  // After the last contact the tail advances one native frame per step.
  const last=points.at(-1)!;
  if(age>=last.age)return last.native+age-last.age;
  const right=points.findIndex(p=>p.age>age),a=points[Math.max(0,right-1)]!,b=points[right]!;
  return a.native+(b.native-a.native)*(age-a.age)/Math.max(1,b.age-a.age);
}
/** Evaluated body pose landmark. Sampler ordinal conversion is +1. */
export function linkNormalNativeFrame(id:LinkNormalId,age:number):number {
  return linkNormalMappedFrame(id,age,true);
}
/** Literal script/event landmark (equipment callbacks); no pose correction. */
export function linkNormalScriptNativeFrame(id:LinkNormalId,age:number):number {
  return linkNormalMappedFrame(id,age,false);
}
