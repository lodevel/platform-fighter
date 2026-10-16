/** Published Ultimate traction, source units converted at five pixels/unit.
 * https://www.ssbwiki.com/Traction#Super_Smash_Bros._Ultimate (2026-10-08).
 * This affects only opted-in sourced shield push, not ordinary locomotion.
 */
const NATIVE_TRACTION: Readonly<Record<string, number>> = {
  donkeykong: .123, link: .113, pikachu: .132,
};

export function getNativeShieldPushTraction(characterId: string): number | null {
  const value = NATIVE_TRACTION[characterId];
  return value === undefined ? null : value * 5;
}
