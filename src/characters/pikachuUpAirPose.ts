/** Reviewed 2D tail projection from captured native up-air samples3..7.
 * Source sizes/launch are retained by the ordinary adapter. Orthographic
 * projection is an authored target geometry, not native collision/patch parity.
 * Evidence: sources/posed-resources/up-air-contact-review.json. */
import type { PikachuPoseProjector } from './pikachuSourceMoves';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';

const POSED_TAILS = [{"gameFrame":4,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":-16.06968682393864,"y":-19.444450647855135},"end":{"x":-16.06968682393864,"y":-19.444450647855135}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":-34.40098975294737,"y":-18.318405544084882},"end":{"x":-34.40098975294737,"y":-18.318405544084882}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,3.0],"sourceEnd":[0.0,0.0,3.0],"start":{"x":-56.61124715417637,"y":-23.3691038605187},"end":{"x":-56.61124715417637,"y":-23.3691038605187}}]},{"gameFrame":5,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":-12.570161539342115,"y":-27.91557901513368},"end":{"x":-12.570161539342115,"y":-27.91557901513368}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":-22.247400073714722,"y":-43.91135017447991},"end":{"x":-22.247400073714722,"y":-43.91135017447991}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,3.0],"sourceEnd":[0.0,0.0,3.0],"start":{"x":-30.019128845883802,"y":-66.07244442065789},"end":{"x":-30.019128845883802,"y":-66.07244442065789}}]},{"gameFrame":6,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":-9.385837103406201,"y":-30.846567906396373},"end":{"x":-9.385837103406201,"y":-30.846567906396373}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":-4.687808996638517,"y":-49.044203976409975},"end":{"x":-4.687808996638517,"y":-49.044203976409975}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,3.0],"sourceEnd":[0.0,0.0,3.0],"start":{"x":4.4074500911227465,"y":-70.72747258460426},"end":{"x":4.4074500911227465,"y":-70.72747258460426}}]},{"gameFrame":7,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":-3.3470115423246662,"y":-32.360604554395564},"end":{"x":-3.3470115423246662,"y":-32.360604554395564}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":12.417060740243361,"y":-42.676852219623086},"end":{"x":12.417060740243361,"y":-42.676852219623086}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,3.0],"sourceEnd":[0.0,0.0,3.0],"start":{"x":33.30596119676245,"y":-53.367561768244784},"end":{"x":33.30596119676245,"y":-53.367561768244784}}]},{"gameFrame":8,"regions":[{"id":0,"bone":"tail1","sourceLocal":[0.0,0.0,0.0],"sourceEnd":[0.0,0.0,0.0],"start":{"x":4.265007937537646,"y":-31.172854109667192},"end":{"x":4.265007937537646,"y":-31.172854109667192}},{"id":1,"bone":"tail3","sourceLocal":[0.0,0.0,-1.0],"sourceEnd":[0.0,0.0,-1.0],"start":{"x":24.674974594747066,"y":-32.970639225395544},"end":{"x":24.674974594747066,"y":-32.970639225395544}},{"id":2,"bone":"tail4","sourceLocal":[0.0,0.0,3.0],"sourceEnd":[0.0,0.0,3.0],"start":{"x":47.60763913121803,"y":-36.95390349657701},"end":{"x":47.60763913121803,"y":-36.95390349657701}}]}] as const;

export const pikachuUpAirPose: PikachuPoseProjector = (row, gameFrame) => {
  if (!Number.isInteger(gameFrame)) throw new Error('Invalid Pikachu up-air pose clock');
  if (!PIKACHU_NATIVE_ATTACKS['pikachu/AttackAirHi'].some(source => source === row))
    throw new Error('Unsupported Pikachu up-air source region');
  const sample = POSED_TAILS.find(sample => sample.gameFrame === gameFrame);
  const region = sample?.regions.find(region => region.id === row.id && region.bone === row.bone);
  const local = [row.x, row.y, row.z];
  const end = [row.x2 ?? row.x, row.y2 ?? row.y, row.z2 ?? row.z];
  if (!region || local.some((value, i) => value !== region.sourceLocal[i])
    || end.some((value, i) => value !== region.sourceEnd[i]))
    throw new Error(`Unreviewed Pikachu up-air anchor: frame${gameFrame} ${row.bone}/${row.id}`);
  return { start: { ...region.start }, end: { ...region.end } };
};
