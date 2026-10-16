/** Ultimate revival (respawn) platform rules. SmashWiki Revival platform (https://www.ssbwiki.com/Revival_platform):
 * "The platform disappears as soon as the player moves or attacks. If the player does not act, the platform will
 * disappear by itself after 5 seconds" — "The revived character is intangible the entire time they are on the
 * platform." — "After dropping down from the platform, the character has a further period of invincibility (2 seconds,
 * or 120 frames) to aid their descent. In Super Smash Bros. Ultimate, the period of invincibility after leaving the
 * platform is decreased proportionally to the amount of time the player spent waiting on the platform (the minimum being
 * 1 second, or 60 frames)." Phaser-free so the respawn coordinator and the fighter share it. */
export const REVIVAL_PLATFORM_MAX_FRAMES = 300;
export const REVIVAL_DISMOUNT_INVINCIBILITY_MAX_FRAMES = 120;
export const REVIVAL_DISMOUNT_INVINCIBILITY_MIN_FRAMES = 60;

/** Invincibility granted on leaving the platform. The ends (120 immediate, 60 minimum) are SmashWiki's; the straight
 * line between them, reaching the minimum at the 300-frame expiry, is an authored reading of "proportionally". */
export function revivalDismountInvincibilityFrames(waitedFrames: number): number {
  const waited = Math.max(0, Math.min(REVIVAL_PLATFORM_MAX_FRAMES, waitedFrames));
  const span = REVIVAL_DISMOUNT_INVINCIBILITY_MAX_FRAMES - REVIVAL_DISMOUNT_INVINCIBILITY_MIN_FRAMES;
  return Math.round(REVIVAL_DISMOUNT_INVINCIBILITY_MAX_FRAMES - span * waited / REVIVAL_PLATFORM_MAX_FRAMES);
}

/** Stick travel below this reads as no movement (the engine's existing respawn-cue cancel threshold). */
const REVIVAL_STICK_DEADZONE = 0.1;

/** "Moves or attacks": any stick movement or any button. */
export function isRevivalDismountInput(input: {
  readonly moveX: number; readonly moveY?: number; readonly jump: boolean; readonly attack?: boolean;
  readonly attackHeavy?: boolean; readonly special?: boolean; readonly shield?: boolean; readonly dodge?: boolean;
  readonly grab?: boolean; readonly appeal?: boolean;
}): boolean {
  return Math.abs(input.moveX) > REVIVAL_STICK_DEADZONE || Math.abs(input.moveY ?? 0) > REVIVAL_STICK_DEADZONE ||
    input.jump || input.attack === true || input.attackHeavy === true || input.special === true ||
    input.shield === true || input.dodge === true || input.grab === true || input.appeal === true;
}
