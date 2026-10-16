/** Ultimate Kong Karry status rules, separate from attachment/physics.
 * https://www.ssbwiki.com/Donkey_Kong_(SSBU) (checked 2026-10-08).
 * Budget and one-jump/attack restrictions are published secondary evidence;
 * local stick thresholds remain explicit engine input adapters. */
import { type CaptureMashState } from './ultimateCapture';
import type { ThrowDirection } from './throwSchema';

/** g includes all ordinary-grab time already spent and accepted mash reduction.
 * Keep the fractional source budget; the integer live elapsed clock decides
 * the release boundary. No fabricated flat240 or minimum hold cap is applied. */
export function ultimateCargoFrames(entryPercent: number, normalGrabSpentFrames: number): number {
  if (!Number.isFinite(entryPercent) || entryPercent < 0 ||
      !Number.isFinite(normalGrabSpentFrames) || normalGrabSpentFrames < 0) {
    throw new Error('cargo entry percent and previously spent capture time must be finite and nonnegative');
  }
  return Math.max(0, (90 + 1.7 * entryPercent) * 11 / 6 - normalGrabSpentFrames);
}

export function reducedCargoFrames(initialFrames: number, mash: CaptureMashState): number {
  if (!Number.isFinite(initialFrames) || initialFrames < 0) throw new Error('cargo duration must be finite and nonnegative');
  return Math.max(0, initialFrames - mash.reduction);
}

/** Forward/back is relative to facing at the fresh throw press. Holding a
 * direction moves the carry; it never itself releases the victim. Neutral
 * attack/grab is cargo forward. Vertical tie priority follows normal throws. */
export function selectCargoThrow(input: {
  readonly attackPressed: boolean;
  readonly grabPressed: boolean;
  readonly moveX: number;
  readonly moveY?: number;
}, facing: 1 | -1): ThrowDirection | null {
  if (!input.attackPressed && !input.grabPressed) return null;
  const y = input.moveY ?? 0;
  if (y < -0.5) return 'up';
  if (y > 0.5) return 'down';
  return input.moveX * facing < -0.5 ? 'back' : 'forward';
}

/** Carry admits ordinary grounded jump only. Walking offstage does not create
 * an air jump. Landing restores the single grounded jump through the existing
 * normal ground resource reset; throwing/damage ends this restriction. */
export function canCargoJump(grounded: boolean): boolean { return grounded; }

/** Cargo is a walk/air-drift status with throw choices. It does not admit dash,
 * ordinary attacks/specials, shields, dodges, pummel, taunt or item use. Root
 * velocity and jump scales must be supplied by the reviewed fighter profile. */
export const DONKEYKONG_CARGO_ACTION_RULES = Object.freeze({
  walk: true,
  groundedJump: true,
  airJump: false,
  dash: false,
  attack: false,
  special: false,
  shield: false,
  dodge: false,
  pummel: false,
  taunt: false,
  item: false,
});
