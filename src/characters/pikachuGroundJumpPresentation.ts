/** Explicit beta ground-launch choreography from unchanged actual Matter
 * traces, not native status retiming. Normal source jump0 extends36.4px below
 * the foot root: full hop first clears at observedage2, short at4. Preserve
 * the last actually reviewed jumpsquat pose/receiving until those boundaries,
 * then resume ORIGINAL jump age (not a delayed clock). Air jumps excluded.
 * Proof: sources/ground-jump-presentation-adaptation.json.
 */
export function getPikachuGroundJumpLaunchPose(age: number, shortHop: boolean, backward = false): {
  readonly sheet: 'jumpsquat'; readonly localFrame: 2;
} | null {
  if (!Number.isFinite(age) || age < 0) return null;
  // Backward source0 extends28px below root and clears the same unmodified
  // Matter trajectory at full age1 / short age3 (forward needs2 /4).
  return age < (backward ? shortHop ? 3 : 1 : shortHop ? 4 : 2) ? { sheet: 'jumpsquat', localFrame: 2 } : null;
}
