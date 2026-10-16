/** Second forward-smash has no independent hold admission. It inherits the
 * first strike's actual held-charge realization at the real continuation. */
import type {AttackMove} from './attacks';
import {scaleAttackCollisionHitDamage} from './attacks';
import type {AttackMoveWithAnimation} from './moveSchema';
import {computeChargedDamageFromSpec} from './chargeSchema';
import {FRESH_LINK_NORMALS} from './linkFreshNormals';
export function realizeLinkSmashFollowupCharge(previous:AttackMove,heldFrames:number|null,next:AttackMove):AttackMove {
  if(previous.sourcePoseId!=='link.smash'||next.sourcePoseId!=='link.smash2'||heldFrames===null)return next;
  if(!Number.isSafeInteger(heldFrames)||heldFrames<0)throw new TypeError('Actual held first-strike charge required');
  const charge=(previous as AttackMoveWithAnimation).charge;
  // Explicitly authored followup charge laws retain their existing consumer;
  // this adapter supplies the stock uncharged continuation's inherited law.
  if(!charge||(next as AttackMoveWithAnimation).charge)return next;
  const anchor=previous.damage>0?previous.damage:FRESH_LINK_NORMALS['link.smash'].damage,
    factor=computeChargedDamageFromSpec(charge,heldFrames)/anchor;
  if(!Number.isFinite(factor)||factor<0)throw new TypeError('Invalid inherited current charge amplitude');
  return {...next,damage:next.damage*factor,
    ...(next.collisionHits===undefined?{}:{collisionHits:scaleAttackCollisionHitDamage(next.collisionHits,factor)}),
    ...(next.hitWindows===undefined?{}:{hitWindows:next.hitWindows.map(window=>({...window,
      ...(window.damage===undefined?{}:{damage:window.damage*factor}),
      ...(window.collisionHits===undefined?{}:{collisionHits:scaleAttackCollisionHitDamage(window.collisionHits,factor)})}))}),
    // Each stage owns its own current packet/author launch law. Inherited
    // damage supplies the native damage-dependent growth without copying
    // another clip's explicit full-charge KB endpoints.
    knockback:next.knockback};
}
