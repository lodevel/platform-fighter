import type { Hurtbox } from './moveSchema';
import { PIKACHU_STATE_AUTHORED_HURTBOX_POSES } from './pikachuStateHurtboxes';

/** Registration of the reviewed strips the alpha rows were measured on: root pixel row and
 * scale of the `captured` / `captured_hit` sheets, body centre 25 px above the root
 * (pikachuPresentation.ts). Kept with the measurement, so the clearance needs no sheet. */
const MEASURED_STRIP_REGISTRATION = Object.freeze({ rootY: 416, scaleToWorld: 0.4666666666666667, bodyCentreFromRootY: -25 });

/** Reviewed immutable high-hold drawings. Native60 is a loop-closure cell;
 * only0..3 participate in the actual60-step held body clock. Alpha bounds use
 * every nontransparent pixel's outer edge, including antialiased outlines.
 * Evidence: integration/completion-runtime-captured-alpha/clearance-envelope-review.json.
 */
export const PIKACHU_CAPTURE_CLEARANCE_REVIEW = Object.freeze({
  stripSha256: '28d0215925e504f105a3e754f7980c5ad9a9d99b7dccd51ba9486aec8f1b9670',
  bodySheet: 'captured',
  registration: MEASURED_STRIP_REGISTRATION,
  alphaBounds: Object.freeze([
    { artFrameIndex: 0, lastAlphaPixelRow: 440 },
    { artFrameIndex: 1, lastAlphaPixelRow: 429 },
    { artFrameIndex: 2, lastAlphaPixelRow: 436 },
    { artFrameIndex: 3, lastAlphaPixelRow: 436 },
  ]),
});

export const PIKACHU_CAPTURE_DAMAGE_CLEARANCE_REVIEW = Object.freeze({
  stripSha256: 'fc24d2dcd25d1420e13eecb6c685f3abadecb1b5829045d7f3f654355a15d592',
  bodySheet: 'captured_hit',
  registration: MEASURED_STRIP_REGISTRATION,
  alphaBounds: Object.freeze([
    { artFrameIndex: 0, lastAlphaPixelRow: 466 },
    { artFrameIndex: 1, lastAlphaPixelRow: 456 },
    { artFrameIndex: 2, lastAlphaPixelRow: 448 },
    { artFrameIndex: 3, lastAlphaPixelRow: 440 },
  ]),
});

/** Conservative2D floor clearance measured from the physical body centre.
 * Using one envelope for the entire held context avoids changing attachment
 * height at each pose. This changes neither the12 receiving regions nor their
 * coordinates and does not claim the unavailable native victim bone/socket.
 */
export function getPikachuCapturedBodyBottomEnvelope(damaged = false): number {
  const review = damaged ? PIKACHU_CAPTURE_DAMAGE_CLEARANCE_REVIEW : PIKACHU_CAPTURE_CLEARANCE_REVIEW;
  const metrics = review.registration;
  const alphaBottom = Math.max(...review.alphaBounds.map(
    sample => -metrics.bodyCentreFromRootY
      + (sample.lastAlphaPixelRow + 1 - metrics.rootY) * metrics.scaleToWorld,
  ));
  const eligibleFrames = new Set(review.alphaBounds.map(sample => sample.artFrameIndex));
  const poses: readonly { sheet: string; artFrameIndex: number; hurtboxes: readonly (Hurtbox & { capsule: NonNullable<Hurtbox['capsule']> })[] }[] = PIKACHU_STATE_AUTHORED_HURTBOX_POSES;
  const receivingBottom = Math.max(...poses
    .filter(pose => pose.sheet === review.bodySheet && eligibleFrames.has(pose.artFrameIndex))
    .flatMap(pose => pose.hurtboxes.map(region =>
      Math.max(region.capsule.start.y, region.capsule.end.y) + region.capsule.radius)));
  return Math.max(alphaBottom, receivingBottom);
}

