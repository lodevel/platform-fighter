/** Spin Attack's packet phase and native capsules at a source-clock state
 * (linkAttackData.json + linkAttackGeometry.json). Ground ages are
 * release-local; air ages count from the aerial start. */
import { LINK_ATTACK_DATA, linkGeometryCapsule } from './linkAttackData';
import type { AttackCollisionHit } from './attacks';
import type { LinkSpinState } from './linkSpinController';
export function linkSelectedSpinPhase(state:LinkSpinState){
  if(state.phase!=='ground-release'&&state.phase!=='air')return null;
  const ground=state.phase==='ground-release',action=ground?LINK_ATTACK_DATA.spin.ground:LINK_ATTACK_DATA.spin.air;
  const frame=state.age+1,group=action.phases.find(g=>frame>=g.active[0]&&frame<=g.active[1]);
  if(!group)return null;
  const geometryMove=ground?'link.spin.ground':'link.spin.air',age=Math.floor(state.age);
  const geometry:readonly Pick<AttackCollisionHit,'id'|'capsule'>[]=group.packets.map(p=>({id:p.id,capsule:linkGeometryCapsule(geometryMove,age,group.role,p.id)}));
  return{motion:action.motion,rawAge:group.nativeStart+frame-group.active[0],role:group.role,packets:group.packets,geometry,
    // Continuous grounded replacement preserves target history. Actual air
    // clear gaps create separate strikes; three finisher replacements share it.
    strike:ground?'ground-spin':frame>=47?'air-finisher':group.role};
}
