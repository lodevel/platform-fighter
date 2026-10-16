import { applyDIToLaunchAngle, DI_MAX_ROTATION_RADIANS, type DIInput } from './combat';

const LSI_VERTICAL_MIN = 65 * Math.PI / 180;
const LSI_VERTICAL_MAX = 115 * Math.PI / 180;

/**
 * Launch-speed multiplier for an eligible launch, AFTER DI. Screen Y is down.
 * The caller supplies a resolved, unit-disc stick; console raw-axis sensitivity
 * is not applied again. Exact 65/115/245/295 degree endpoints remain eligible.
 * Source: SSBU-Calculator/js/formulas.js, LSI.
 * https://raw.githubusercontent.com/rubendal/SSBU-Calculator/refs/heads/gh-pages/js/formulas.js
 */
export function referenceLaunchSpeedMultiplier(angle: number, stickY: number): number {
  let folded = Math.abs(angle % (2 * Math.PI));
  if (folded > Math.PI) folded = 2 * Math.PI - folded;
  if (folded > LSI_VERTICAL_MIN && folded < LSI_VERTICAL_MAX) return 1;
  return 1 - stickY * (stickY < 0 ? 0.095 : 0.08);
}

/**
 * Apply DI then LSI to the gravity-boosted launch vector at hitlag release.
 * Both require tumble and the existing mirrored near-horizontal DI gate.
 * Keep the project's resolved stick convention: over-length keyboard diagonals
 * normalize to the unit disc, while partial analog magnitude is preserved.
 * Carry, natural gravity, hitstun and pre-DI vertical classification belong to
 * the caller and must not be rescaled/recomputed here.
 * Source ordering: SSBU-Calculator/js/knockback.js, Knockback.calculate.
 * https://raw.githubusercontent.com/rubendal/SSBU-Calculator/refs/heads/gh-pages/js/knockback.js
 */
export function applyReferenceLaunchInfluence(
  vector: { readonly x: number; readonly y: number },
  input: DIInput,
  tumble: boolean,
): { x: number; y: number } {
  const unchanged = { x: vector.x, y: vector.y };
  const magnitude = Math.hypot(vector.x, vector.y);
  if (!tumble || !Number.isFinite(magnitude) || magnitude < 0.00001) return unchanged;
  if (Math.atan2(Math.abs(vector.y), Math.abs(vector.x)) < DI_MAX_ROTATION_RADIANS) return unchanged;

  const x = Number.isFinite(input.stickX) ? input.stickX : 0;
  const y = Number.isFinite(input.stickY) ? input.stickY : 0;
  const scale = Math.max(1, Math.hypot(x, y));
  const stick = { stickX: x / scale, stickY: y / scale };
  if (stick.stickX === 0 && stick.stickY === 0) return unchanged;
  const angle = applyDIToLaunchAngle(Math.atan2(vector.y, vector.x), stick);
  const speed = magnitude * referenceLaunchSpeedMultiplier(angle, stick.stickY);
  return { x: speed * Math.cos(angle), y: speed * Math.sin(angle) };
}
