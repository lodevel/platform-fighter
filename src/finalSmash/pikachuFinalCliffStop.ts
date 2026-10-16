import type {VoltPoint} from './pikachuVoltTackle';
/** Explicit 2D support projection for native GROUND_CLIFF_STOP intent.
 * Uses the actual Matter hull width and actual supporting platform bounds;
 * native ground correction/contact margins are not recovered. The caller
 * admits only a grounded FinalDash(after6)/FinalDashEnd owner on live support.
 * Returning a smaller step preserves source kinetic intent without a ROOT snap.
 */
export function projectPikachuFinalCliffVelocity(input:{readonly root:VoltPoint;readonly velocity:VoltPoint;
 readonly hullWidth:number;readonly support:{readonly left:number;readonly right:number}}):VoltPoint{
 const {root,velocity,hullWidth,support}=input;
 if(![root.x,root.y,velocity.x,velocity.y,hullWidth,support.left,support.right].every(Number.isFinite)||
  hullWidth<=0||support.right<support.left)throw new RangeError('Actual finite Final support/hull required');
 const left=support.left+hullWidth/2,right=support.right-hullWidth/2;
 const x=left>right?0:velocity.x>0?Math.min(velocity.x,Math.max(0,right-root.x)):
  velocity.x<0?Math.max(velocity.x,Math.min(0,left-root.x)):0;
 return Object.freeze({x,y:velocity.y});
}
