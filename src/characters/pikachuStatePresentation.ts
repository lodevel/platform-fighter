import { selectPikachuAuxiliaryBody } from './pikachuAuxiliaryBody';
import {selectPikachuSurfaceTechBody} from './pikachuSurfaceTech';
import {pikachuLedgeJumpProtected} from './pikachuLedgeJumpRuntime';
import { pikachuGroundRecoveryProtected } from './pikachuRecoveryRuntime';
import { selectPikachuDirectionalDodgeHurtboxes } from './pikachuDirectionalDodgeHurtboxes';
import { getPikachuReviewedStateClock } from './pikachuPresentation';
import { selectPikachuStateHurtboxes } from './pikachuStateHurtboxes';
import { resolveSimulationAction, type SimulationAnimationSnapshot } from './simulationSpriteAnimation';

/** Match the source Have point to the same sparse body and latched facing as
 * the renderer. Uncovered action resources retain the shared beta socket. */
/** Receiving uses the same accepted sheet, action age and drawing basis as
 * presentation. No renderer, loaded texture, FPS or wall-time enters this path.
 * Missing state art/capsules stay on the existing framework body.
 */
export function selectPikachuReviewedStateReceiving(snapshot: SimulationAnimationSnapshot) {
  if(snapshot.surfaceTechPresentation){
    const tech=snapshot.surfaceTechPresentation,pose=selectPikachuSurfaceTechBody(tech);
    if(!pose)throw new Error('Pikachu surface tech lacks source receiving');
    const basis=tech.facing*snapshot.facing;
    return pose.hurtboxes.map(h=>({...h,offsetX:h.offsetX*basis,...(h.capsule?{capsule:{start:{x:h.capsule.start.x*basis,y:h.capsule.start.y},end:{x:h.capsule.end.x*basis,y:h.capsule.end.y},radius:h.capsule.radius}}:{})}));
  }
  const action = resolveSimulationAction(snapshot);
  if (action.state === 'dodge.directional-air' && action.frame !== undefined) {
    const posed = selectPikachuDirectionalDodgeHurtboxes(action.frame, action.frame + 1);
    if (!posed) throw new Error('Entered directional dodge lacks paired receiving');
    const basis = (action.facing ?? snapshot.facing) * snapshot.facing;
    return basis === 1 ? posed : posed.map(h => ({ ...h, offsetX: h.offsetX * basis, capsule: {
      start: { x: h.capsule.start.x * basis, y: h.capsule.start.y },
      end: { x: h.capsule.end.x * basis, y: h.capsule.end.y }, radius: h.capsule.radius,
    } }));
  }
  if (action.auxiliarySheet && action.frame !== undefined) {
    const pose = selectPikachuAuxiliaryBody(action.auxiliarySheet, action.frame);
    if (!pose) throw new Error('Pikachu auxiliary body lacks paired source receiving');
    const basis = (action.facing ?? snapshot.facing) * snapshot.facing;
    const protectedBody = (snapshot.groundRecoveryPresentation && pikachuGroundRecoveryProtected(snapshot.groundRecoveryPresentation)) ||
      (snapshot.ledgeJumpPresentation && pikachuLedgeJumpProtected(snapshot.ledgeJumpPresentation));
    return pose.hurtboxes.map(h => ({...h, ...(protectedBody ? {intangible: true} : {}), offsetX: h.offsetX * basis,
      ...(h.capsule ? {capsule: {start: {x: h.capsule.start.x * basis, y: h.capsule.start.y},
        end: {x: h.capsule.end.x * basis, y: h.capsule.end.y}, radius: h.capsule.radius}} : {})}));
  }
  if (!action.reviewedSheet || action.frame === undefined) return null;
  const clock = getPikachuReviewedStateClock(action.reviewedSheet, action.frame);
  const posed = clock && selectPikachuStateHurtboxes(action.reviewedSheet, clock.localFrame);
  if (!posed) return null;
  // The common receiving consumer mirrors by CURRENT actor facing. A baked
  // turn/forward roll instead renders in its latched entry basis; compensate
  // local X once so those capsules follow the same world drawing after a flip.
  const basis = (action.facing ?? snapshot.facing) * snapshot.facing;
  if (basis === 1) return posed;
  return posed.map(h => ({ ...h, offsetX: h.offsetX * basis, capsule: {
    start: { x: h.capsule.start.x * basis, y: h.capsule.start.y },
    end: { x: h.capsule.end.x * basis, y: h.capsule.end.y }, radius: h.capsule.radius,
  } }));
}
