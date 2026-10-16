/** Ultimate standalone Final resource. It is an Item Switch entry, never a
 * held ItemEntity/throw profile or container content. Runtime state/HP/flight
 * belongs the shared Final resource manager. Visual/source receiving geometry
 * is registered independently from ordinary pickup sprite sockets. */
import {SMASH_BALL_SOURCE} from '../finalSmash/smashBall';
export interface SmashBallDefinition {
  readonly type:'smashBall';readonly itemClass:'final-resource';readonly spawnRole:'standalone-final';
  readonly holdable:false;readonly heavy:false;readonly containerEligible:false;
  readonly source:typeof SMASH_BALL_SOURCE;
}
export const SMASH_BALL_DEFINITION:SmashBallDefinition=Object.freeze({
  type:'smashBall',itemClass:'final-resource',spawnRole:'standalone-final',
  holdable:false,heavy:false,containerEligible:false,source:SMASH_BALL_SOURCE});
