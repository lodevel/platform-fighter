/** Authored fixed-root orthographic dash neck projection.
 * Native Trans travel is removed consistently with art; actor kinetics, native
 * size consumers, status clocks and patch parity remain unqualified.
 * Evidence: sources/posed-resources/dash-attack-contact-candidates.json. */
import type { PikachuPoseProjector } from './pikachuSourceMoves';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';

const POSED_HEADS = [{"gameFrame":6,"sourceIndex":5,"id":0,"bone":"neck","sourceLocal":[2.2,-1.1,0.0],"sourceEnd":[2.2,-1.1,0.0],"start":{"x":26.61293154382358,"y":-9.98626272482818},"end":{"x":26.61293154382358,"y":-9.98626272482818},"sourceDamage":11.0,"sourceSize":5.0,"authoredWorldRadius":25.0},{"gameFrame":7,"sourceIndex":6,"id":0,"bone":"neck","sourceLocal":[2.2,-1.1,0.0],"sourceEnd":[2.2,-1.1,0.0],"start":{"x":26.69429352725869,"y":-9.857286829094853},"end":{"x":26.69429352725869,"y":-9.857286829094853},"sourceDamage":11.0,"sourceSize":5.0,"authoredWorldRadius":25.0},{"gameFrame":8,"sourceIndex":7,"id":0,"bone":"neck","sourceLocal":[2.2,-1.1,0.0],"sourceEnd":[2.2,-1.1,0.0],"start":{"x":26.812496415063176,"y":-9.845434668892182},"end":{"x":26.812496415063176,"y":-9.845434668892182},"sourceDamage":11.0,"sourceSize":5.0,"authoredWorldRadius":25.0},{"gameFrame":9,"sourceIndex":8,"id":0,"bone":"neck","sourceLocal":[2.2,-1.1,0.0],"sourceEnd":[2.2,-1.1,0.0],"start":{"x":26.9609114027136,"y":-9.911924233381143},"end":{"x":26.9609114027136,"y":-9.911924233381143},"sourceDamage":6.0,"sourceSize":4.0,"authoredWorldRadius":20.0},{"gameFrame":10,"sourceIndex":9,"id":0,"bone":"neck","sourceLocal":[2.2,-1.1,0.0],"sourceEnd":[2.2,-1.1,0.0],"start":{"x":27.07757692921609,"y":-9.502390738403093},"end":{"x":27.07757692921609,"y":-9.502390738403093},"sourceDamage":6.0,"sourceSize":4.0,"authoredWorldRadius":20.0},{"gameFrame":11,"sourceIndex":10,"id":0,"bone":"neck","sourceLocal":[2.2,-1.1,0.0],"sourceEnd":[2.2,-1.1,0.0],"start":{"x":26.969275963101982,"y":-7.9392844131038345},"end":{"x":26.969275963101982,"y":-7.9392844131038345},"sourceDamage":6.0,"sourceSize":4.0,"authoredWorldRadius":20.0},{"gameFrame":12,"sourceIndex":11,"id":0,"bone":"neck","sourceLocal":[2.2,-1.1,0.0],"sourceEnd":[2.2,-1.1,0.0],"start":{"x":26.709404770366802,"y":-6.284073665270817},"end":{"x":26.709404770366802,"y":-6.284073665270817},"sourceDamage":6.0,"sourceSize":4.0,"authoredWorldRadius":20.0}] as const;

export const pikachuDashAttackPose: PikachuPoseProjector = (row, gameFrame) => {
  if (!Number.isInteger(gameFrame)) throw new Error('Invalid Pikachu dash pose clock');
  if (!PIKACHU_NATIVE_ATTACKS['pikachu/AttackDash'].some(source => source === row))
    throw new Error('Unsupported Pikachu dash source region');
  const region = POSED_HEADS.find(sample => sample.gameFrame === gameFrame);
  const local = [row.x, row.y, row.z];
  const end = [row.x2 ?? row.x, row.y2 ?? row.y, row.z2 ?? row.z];
  if (!region || row.id !== region.id || row.bone !== region.bone
    || gameFrame < row.frame || (row.end_frame !== null && gameFrame >= row.end_frame)
    || local.some((value, i) => value !== region.sourceLocal[i])
    || end.some((value, i) => value !== region.sourceEnd[i]))
    throw new Error(`Unreviewed Pikachu dash anchor: frame${gameFrame} ${row.bone}/${row.id}`);
  return { start: { ...region.start }, end: { ...region.end } };
};
