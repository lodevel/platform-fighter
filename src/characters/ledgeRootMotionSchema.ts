/** Explicit source-guided ledge attachment adapter; no native common-status parity claim. */
export interface LedgeRootPoint { readonly x: number; readonly y: number }
export function validateLedgeRootMotion(points: readonly LedgeRootPoint[], totalFrames: number): void {
  if (!Array.isArray(points) || points.length !== totalFrames || totalFrames < 1 ||
      points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new Error('ledgeRootMotion requires one finite world-unit source-projected point per existing action frame');
  }
}

/** Native world units → engine pixels (the project's 5 px per native unit). */
const PX_PER_NATIVE_UNIT = 5;
/**
 * Corner-anchored projection of a native ledge-attack `Trans` track, given as [Y, Z] native
 * units per sample (Y up, Z forward): x = 5·Z px forward of the corner, and the native rise is
 * scaled onto the engine hang depth so sample 0 sits at the latched hang (body bottom
 * `hangDepthPx` under the corner): y = hangDepthPx·Y/Y₀. Used by every fighter whose native
 * hang root depth differs from the engine's (DK, Link).
 */
export function projectCornerAnchoredLedgeRoot(transYZ: readonly (readonly [number, number])[],
  hangDepthPx: number): readonly LedgeRootPoint[] {
  const y0 = transYZ[0]![0];
  // `y === 0` keeps +0 (not −0) so saved fighter data round-trips exactly.
  return Object.freeze(transYZ.map(([y, z]) =>
    Object.freeze({ x: PX_PER_NATIVE_UNIT * z, y: y === 0 ? 0 : hangDepthPx * y / y0 })));
}
