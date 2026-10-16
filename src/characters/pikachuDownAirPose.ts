/** Reviewed 2D head projection from captured native down-air samples13..25.
 * Source sizes/launch are retained by the ordinary adapter. Orthographic
 * projection is an authored target geometry, not native collision/patch parity.
 * Evidence: sources/posed-resources/down-air-contact-review.json. */
import type { PikachuPoseProjector } from './pikachuSourceMoves';
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';

const POSED_HEADS = [{"gameFrame":14,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":3.1731941369980534,"y":41.058591554767496},"end":{"x":3.1731941369980534,"y":41.058591554767496}}]},{"gameFrame":15,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":-1.0900658213021819,"y":40.66222935720036},"end":{"x":-1.0900658213021819,"y":40.66222935720036}}]},{"gameFrame":16,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":-5.04493558535736,"y":38.523701820555104},"end":{"x":-5.04493558535736,"y":38.523701820555104}}]},{"gameFrame":17,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":-7.062826439124366,"y":35.24090250540825},"end":{"x":-7.062826439124366,"y":35.24090250540825}}]},{"gameFrame":18,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":-6.114712136012304,"y":31.458025612584706},"end":{"x":-6.114712136012304,"y":31.458025612584706}}]},{"gameFrame":19,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":-2.657899534533959,"y":27.874681534316306},"end":{"x":-2.657899534533959,"y":27.874681534316306}}]},{"gameFrame":20,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":1.590052146226339,"y":25.229393864339286},"end":{"x":1.590052146226339,"y":25.229393864339286}}]},{"gameFrame":21,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":4.655528523086147,"y":24.273537327246213},"end":{"x":4.655528523086147,"y":24.273537327246213}}]},{"gameFrame":22,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":5.353816101374034,"y":24.99890950966116},"end":{"x":5.353816101374034,"y":24.99890950966116}}]},{"gameFrame":23,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":3.6838116618784564,"y":26.60479761458183},"end":{"x":3.6838116618784564,"y":26.60479761458183}}]},{"gameFrame":24,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":0.5926472203796327,"y":28.64728112491674},"end":{"x":0.5926472203796327,"y":28.64728112491674}}]},{"gameFrame":25,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":-2.53142683819944,"y":30.674707063613287},"end":{"x":-2.53142683819944,"y":30.674707063613287}}]},{"gameFrame":26,"regions":[{"id":0,"bone":"neck","sourceLocal":[2.5,-1.3,0.0],"sourceEnd":[2.5,-1.3,0.0],"start":{"x":-4.488469093927392,"y":32.23173291628359},"end":{"x":-4.488469093927392,"y":32.23173291628359}}]}] as const;

export const pikachuDownAirPose: PikachuPoseProjector = (row, gameFrame) => {
  if (!Number.isInteger(gameFrame)) throw new Error('Invalid Pikachu down-air pose clock');
  if (!PIKACHU_NATIVE_ATTACKS['pikachu/AttackAirLw'].some(source => source === row))
    throw new Error('Unsupported Pikachu down-air source region');
  const sample = POSED_HEADS.find(sample => sample.gameFrame === gameFrame);
  const region = sample?.regions.find(region => region.id === row.id && region.bone === row.bone);
  const local = [row.x, row.y, row.z];
  const end = [row.x2 ?? row.x, row.y2 ?? row.y, row.z2 ?? row.z];
  if (!region || local.some((value, i) => value !== region.sourceLocal[i])
    || end.some((value, i) => value !== region.sourceEnd[i]))
    throw new Error(`Unreviewed Pikachu down-air anchor: frame${gameFrame} ${row.bone}/${row.id}`);
  return { start: { ...region.start }, end: { ...region.end } };
};
