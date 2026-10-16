/** Reviewed 2D tail projection from captured native up-tilt samples6..12.
 * Source sizes/launch are retained by the ordinary adapter. Orthographic
 * projection is an authored target geometry, not native collision/patch parity.
 * Evidence: sources/posed-resources/up-tilt-contact-review.json. */
import type { PikachuPoseProjector } from './pikachuSourceMoves';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';

const POSED_TAILS = [
  {"gameFrame":7,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":-3.598912085797501,"y":-20.915620167849127},"end":{"x":-3.598912085797501,"y":-20.915620167849127}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":-24.014917829149226,"y":-18.619124334083793},"end":{"x":-24.014917829149226,"y":-18.619124334083793}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,2.5],"sourceEnd":[0.0,0.0,2.5],"start":{"x":-42.72012539060212,"y":-11.05823822894812},"end":{"x":-42.72012539060212,"y":-11.05823822894812}}]},
  {"gameFrame":8,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":9.089888037045856,"y":-23.11289799545827},"end":{"x":9.089888037045856,"y":-23.11289799545827}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":-5.15610954846216,"y":-40.266449935845046},"end":{"x":-5.15610954846216,"y":-40.266449935845046}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,2.5],"sourceEnd":[0.0,0.0,2.5],"start":{"x":-24.265299814599967,"y":-46.425144589883004},"end":{"x":-24.265299814599967,"y":-46.425144589883004}}]},
  {"gameFrame":9,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":16.15974448059609,"y":-17.601630502846092},"end":{"x":16.15974448059609,"y":-17.601630502846092}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":11.582612104125637,"y":-44.06336002386114},"end":{"x":11.582612104125637,"y":-44.06336002386114}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,2.5],"sourceEnd":[0.0,0.0,2.5],"start":{"x":-7.319107842905933,"y":-58.64206505735815},"end":{"x":-7.319107842905933,"y":-58.64206505735815}}]},
  {"gameFrame":10,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":16.37745618928831,"y":-16.029565706019866},"end":{"x":16.37745618928831,"y":-16.029565706019866}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":22.941547589939937,"y":-47.092661982628215},"end":{"x":22.941547589939937,"y":-47.092661982628215}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,2.5],"sourceEnd":[0.0,0.0,2.5],"start":{"x":6.201117019482956,"y":-72.61923633172145},"end":{"x":6.201117019482956,"y":-72.61923633172145}}]},
  {"gameFrame":11,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":16.443116289536412,"y":-11.019898600606261},"end":{"x":16.443116289536412,"y":-11.019898600606261}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":35.58433146672688,"y":-32.74828923559782},"end":{"x":35.58433146672688,"y":-32.74828923559782}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,2.5],"sourceEnd":[0.0,0.0,2.5],"start":{"x":45.690721215080856,"y":-63.477774084205606},"end":{"x":45.690721215080856,"y":-63.477774084205606}}]},
  {"gameFrame":12,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":16.427925173934902,"y":-7.1667803808155455},"end":{"x":16.427925173934902,"y":-7.1667803808155455}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":28.80988012242693,"y":-28.188969903350454},"end":{"x":28.80988012242693,"y":-28.188969903350454}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,2.5],"sourceEnd":[0.0,0.0,2.5],"start":{"x":59.60583001132119,"y":-27.628386576463804},"end":{"x":59.60583001132119,"y":-27.628386576463804}}]},
  {"gameFrame":13,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":16.34587860393091,"y":-5.4113142779770484},"end":{"x":16.34587860393091,"y":-5.4113142779770484}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":27.279379520759377,"y":-23.72834669460503},"end":{"x":27.279379520759377,"y":-23.72834669460503}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,2.5],"sourceEnd":[0.0,0.0,2.5],"start":{"x":53.77868512724298,"y":-16.27902080492042},"end":{"x":53.77868512724298,"y":-16.27902080492042}}]},
] as const;

export const pikachuUpTiltPose: PikachuPoseProjector = (row, gameFrame) => {
  if (!Number.isInteger(gameFrame)) throw new Error('Invalid Pikachu up-tilt pose clock');
  if (!PIKACHU_NATIVE_ATTACKS['pikachu/AttackHi3'].some(source => source === row))
    throw new Error('Unsupported Pikachu up-tilt source region');
  const sample = POSED_TAILS.find(sample => sample.gameFrame === gameFrame);
  const region = sample?.regions.find(region => region.id === row.id && region.bone === row.bone);
  const local = [row.x, row.y, row.z];
  const end = [row.x2 ?? row.x, row.y2 ?? row.y, row.z2 ?? row.z];
  if (!region || local.some((value, i) => value !== region.sourceLocal[i])
    || end.some((value, i) => value !== region.sourceEnd[i]))
    throw new Error(`Unreviewed Pikachu up-tilt anchor: frame${gameFrame} ${row.bone}/${row.id}`);
  return { start: { ...region.start }, end: { ...region.end } };
};
