/** Link's 16 normals from data: public windows (linkNormalRules), packet values
 * (linkAttackData.json) and per-age native capsules (linkAttackGeometry.json). */
import type { AttackMoveWithAnimation } from './moveSchema';
import { LINK_NORMAL_RULES, type LinkNormalId } from './linkNormalRules';
import { LINK_ATTACK_DATA, linkMoveBounds, linkPacketKnockback, linkStrikeWindows, type LinkAttackPacket } from './linkAttackData';

function linkNormalPackets(id: LinkNormalId, role: string): readonly LinkAttackPacket[] {
  const phase = LINK_ATTACK_DATA.normals[id]?.phases[role];
  if (!phase) throw new Error(`Missing Link packet phase ${id}/${role}`);
  return phase.packets;
}
const AERIALS:Readonly<Record<string,string>>={nair:'neutral',fair:'forward',bair:'back',uair:'up',dair:'down'};
/** Dair "After bouncing off" (SmashWiki-only packet) as the rebound's return hit. */
function dairReturnHit() {
  const packet=linkNormalPackets('link.dair','After bouncing off')[0]!,c=packet.capsule!;
  return {damage:packet.damage,knockback:linkPacketKnockback(packet),launchDirection:packet.lr,
    hitbox:{offsetX:c.x,offsetY:c.y,width:c.radius*2,height:c.radius*2}};
}
export function buildFreshLinkNormal(id:LinkNormalId):AttackMoveWithAnimation {
  const rule=LINK_NORMAL_RULES[id],name=id.slice(5),first=rule.windows[0]!,last=rule.windows.at(-1)!;
  const packet=linkNormalPackets(id,first.role)[0]!;
  const hitWindows=rule.windows.flatMap(w=>linkStrikeWindows(id,w.first-1,w.last-1,w.role,w.strike,linkNormalPackets(id,w.role)));
  const type=name in AERIALS?'aerial':name.includes('smash')?'smash':name.startsWith('jab')?'jab':'tilt';
  // The second forward-smash strike is an uncharged continuation. Its
  // source startup9 cannot contain the first strike's hold point10.
  // Chained admission inherits the preceding strike's realized charge.
  const charged=type==='smash'&&id!=='link.smash2';
  return Object.freeze({id,sourcePoseId:id,type,damage:packet.damage,
    knockback:linkPacketKnockback(packet),hitbox:linkMoveBounds(hitWindows),
    startupFrames:first.first-1,activeFrames:last.last-first.first+1,
    recoveryFrames:Math.max(0,rule.firstActionable-last.last-1),cooldownFrames:0,
    hitlagMultiplier:packet.hitlag,sdiMultiplier:packet.sdi,hitWindows,
    animation:{startupFrames:1,activeFrames:1,recoveryFrames:1},
    // Hold flag motion10/6/5 is bound through the current engine's ordinal
    // startup field. Common native hold normalization remains a source gap.
    ...(charged?{chargeStartFrame:name==='usmash'?6:name==='dsmash'?5:10,
      charge:{knockbackMode:'damage-only',minChargeFrames:0,maxChargeFrames:60,maxHoldFrames:180,
        minDamage:packet.damage,maxDamage:packet.damage*1.4,
        minKnockback:{x:0,y:0,scaling:0},maxKnockback:{x:0,y:0,scaling:0}}}:{}),
    ...(type==='aerial'?{aerialDirection:AERIALS[name],geometryFacing:'fighter',landingLagFrames:rule.landingLag??0,
      ...(id==='link.dair'?{rebound:{upwardSpeed:1.33*5,rehitFrames:30,disableOnFastFall:true,returnHit:dairReturnHit()}}:{}),
      autoCancelWindows:rule.autocancel.map(([first,last])=>({startFrame:first-1,endFrame:Number.isFinite(last)?last:rule.animationFrames}))}:{}),
  } as AttackMoveWithAnimation);
}
export const FRESH_LINK_NORMALS:Readonly<Record<LinkNormalId,AttackMoveWithAnimation>>=Object.freeze(
  Object.fromEntries((Object.keys(LINK_NORMAL_RULES) as LinkNormalId[]).map(id=>[id,buildFreshLinkNormal(id)])) as Record<LinkNormalId,AttackMoveWithAnimation>);
