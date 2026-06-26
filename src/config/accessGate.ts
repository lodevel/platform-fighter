/**
 * Access-gate config — the soft password wall shown before the game.
 *
 * SECURITY NOTE: this is a CLIENT-SIDE gate. The password ships in the
 * browser bundle, so anyone who reads the source / dev-tools can find or
 * bypass it. It keeps casual visitors out; it is NOT real authentication.
 * For genuine protection the check must move to a server.
 *
 * To change the password, edit GAME_ACCESS_PASSWORD below. Changing it
 * invalidates any remembered unlock (the stored token is derived from the
 * password), so everyone is re-prompted after a password change.
 */

/** The password required to enter the game. CHANGE THIS. */
export const GAME_ACCESS_PASSWORD = 'changeme';

/** localStorage key holding the "already unlocked" token. */
const STORAGE_KEY = 'pf.access.unlock';

/**
 * Tiny non-cryptographic string hash (djb2). Used only to derive a stored
 * unlock token from the password so that changing the password re-locks
 * previously-unlocked browsers. NOT a security primitive.
 */
function token(pw: string): string {
  let h = 5381;
  for (let i = 0; i < pw.length; i += 1) {
    h = ((h << 5) + h + pw.charCodeAt(i)) | 0;
  }
  return `t${(h >>> 0).toString(36)}`;
}

/** True if this browser already entered the current password before. */
export function isUnlocked(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === token(GAME_ACCESS_PASSWORD);
  } catch {
    return false;
  }
}

/** Persist that the current password was entered correctly. */
export function recordUnlock(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, token(GAME_ACCESS_PASSWORD));
  } catch {
    /* storage unavailable (private mode etc.) — gate just re-prompts. */
  }
}

/** True iff `input` matches the configured password. */
export function checkPassword(input: string): boolean {
  return input === GAME_ACCESS_PASSWORD;
}
