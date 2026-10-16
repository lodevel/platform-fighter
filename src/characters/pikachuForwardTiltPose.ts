/** Reviewed 2D source-image calibration for the neutral tilt pilot only.
 * These projected knee/hip axes are authored, not acquired native bone matrices.
 * Source attack numbers and radii remain in pikachuAttackData/SourceMoves. */
import { PIKACHU_NATIVE_ATTACKS } from './pikachuAttackData';
import { PIKACHU_SOURCE_COORDINATES, type PikachuNativeAttack, type PikachuPoseProjector } from './pikachuSourceMoves';

export const PIKACHU_FTILT_POSE_PROVENANCE = 'authored 2D projection from inspected UFD active images5/6/7; native 3D bone transforms unavailable';
export const PIKACHU_FTILT_SOURCE_CALIBRATION = Object.freeze({
  sourceRootX: 420, sourceRootY: 586, sourceNeutralHeight: 557,
  worldNeutralHeight: 70, sourcePixelUncertainty: 2,
});

/** Rounded centres of the visible native attack debug crosses.
 * Region0: extended kneel/localX4. Region1: kneel/localX0. Region2: hip/local0.
 * Mapping source index+1 to game frame is reviewed for this29-image GIF only. */
export const PIKACHU_FTILT_SOURCE_CENTRES = Object.freeze({
  6: { 0: { x: 939, y: 352 }, 1: { x: 791, y: 371 }, 2: { x: 593, y: 420 } },
  7: { 0: { x: 915, y: 346 }, 1: { x: 784, y: 375 }, 2: { x: 590, y: 418 } },
  8: { 0: { x: 864, y: 340 }, 1: { x: 764, y: 379 }, 2: { x: 576, y: 417 } },
});

const neutralRows = new Set<PikachuNativeAttack>(PIKACHU_NATIVE_ATTACKS['pikachu/AttackS3']);
const foot = PIKACHU_NATIVE_ATTACKS['pikachu/AttackS3'].find(row => row.id === 0)!;
const knee = PIKACHU_NATIVE_ATTACKS['pikachu/AttackS3'].find(row => row.id === 1)!;
const localXDistance = foot.x - knee.x;
const scale = PIKACHU_FTILT_SOURCE_CALIBRATION.worldNeutralHeight / PIKACHU_FTILT_SOURCE_CALIBRATION.sourceNeutralHeight;

function centre(point: { readonly x: number; readonly y: number }) {
  return { x: (point.x - PIKACHU_FTILT_SOURCE_CALIBRATION.sourceRootX) * scale,
    y: PIKACHU_SOURCE_COORDINATES.rootBelowBodyCentre + (point.y - PIKACHU_FTILT_SOURCE_CALIBRATION.sourceRootY) * scale };
}

/** Deliberately rejects angled variants, unsupported source rows/frames and
 * unmeasured local Y/Z axes. No generic bone or nearest-frame fallback. */
export const pikachuForwardTiltPoseProjector: PikachuPoseProjector = (row, gameFrame) => {
  if (!Number.isInteger(gameFrame) || !(gameFrame in PIKACHU_FTILT_SOURCE_CENTRES)) {
    throw new Error(`Missing reviewed Pikachu forward-tilt pose at game frame ${gameFrame}`);
  }
  if (!neutralRows.has(row) || row.y !== 0 || row.z !== 0 || row.x2 !== null || row.y2 !== null || row.z2 !== null) {
    throw new Error('Unsupported Pikachu neutral forward-tilt source row or unmeasured posed axis');
  }
  const points = PIKACHU_FTILT_SOURCE_CENTRES[gameFrame as keyof typeof PIKACHU_FTILT_SOURCE_CENTRES];
  let point: { x: number; y: number };
  if (row.bone === 'kneel' && (row.id === 0 || row.id === 1)) {
    const anchor = centre(points[1]);
    // Retain the native localX offset; its 2D projected direction changes as
    // the source leg retracts/turns in depth over the three active frames.
    const axis = { x: (points[0].x - points[1].x) * scale / localXDistance,
      y: (points[0].y - points[1].y) * scale / localXDistance };
    point = { x: anchor.x + (row.x - knee.x) * axis.x, y: anchor.y + (row.x - knee.x) * axis.y };
  } else if (row.bone === 'hip' && row.id === 2 && row.x === 0) point = centre(points[2]);
  else throw new Error(`Missing reviewed Pikachu forward-tilt bone ${row.bone} region ${row.id}`);
  return { start: point, end: { ...point } };
};
