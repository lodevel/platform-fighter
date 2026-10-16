/** Source-guided directional dodge clock. Integration and actual production
 * qualification remain separate; importing this helper alone proves neither.
 * Primary motion-list.yml escape_air_slide and escape_air use identical
 * b02escapeair.nuanmb. Accepted air_dodge pixels may therefore be reused, but
 * neutral's authored50-step windows do not govern directional body playback.
 * Authored beta: one native sample per entered dodge step, final native83 held
 * until the directional profile exits. No native common status/rate claim.
 */
export const directionalDodgeNativeSamples = [0, 4, 12, 24, 44, 64, 83] as const;
export const directionalDodgeSourcePhaseFrames = {
  // Native ACMD motion-frame values, not one-based UI frame numbers. Runtime
  // consumer must document its entry clock conversion in production evidence.
  enableGravity: 14,
  enableControlAndBothSideLedgeChecks: 24,
} as const;

export function directionalDodgeDrawing(age: number, totalFrames: number) {
  if (!Number.isInteger(age) || age < 0 || !Number.isInteger(totalFrames) || age >= totalFrames) return null;
  let artFrameIndex = directionalDodgeNativeSamples.length - 1;
  while (artFrameIndex > 0 && age < directionalDodgeNativeSamples[artFrameIndex]!) artFrameIndex -= 1;
  return { sheet: 'air_dodge' as const, artFrameIndex,
    nativeSample: directionalDodgeNativeSamples[artFrameIndex]!,
    nativeClock: Math.min(age, directionalDodgeNativeSamples.at(-1)!),
    gravityEnabled: age >= directionalDodgeSourcePhaseFrames.enableGravity,
    controlEnabled: age >= directionalDodgeSourcePhaseFrames.enableControlAndBothSideLedgeChecks };
}

/** Supply retained source-reviewed defense-candidates.json rows or a promoted
 * runtime table. Neutral runtime currently lacks native83 because neutral exits
 * at50. Never substitute native64 receiving for directional native83 body.
 */
export function directionalDodgeReceiving<T>(age: number, totalFrames: number,
  poses: readonly { sheet: string; nativeSample: number; hurtboxes: readonly T[] }[]) {
  const drawing = directionalDodgeDrawing(age, totalFrames);
  if (!drawing) return null;
  const pose = poses.find(p => p.sheet === drawing.sheet && p.nativeSample === drawing.nativeSample);
  if (!pose) throw new Error(`Unqualified directional dodge receiving native${drawing.nativeSample}`);
  return pose.hurtboxes;
}

/** Read explicit source phases without coupling movement to art frame count. */
export function pikachuDirectionalDodgePhase(age: number) {
  if (!Number.isInteger(age) || age < 0) return null;
  return { gravityEnabled: age >= directionalDodgeSourcePhaseFrames.enableGravity,
    controlEnabled: age >= directionalDodgeSourcePhaseFrames.enableControlAndBothSideLedgeChecks };
}
