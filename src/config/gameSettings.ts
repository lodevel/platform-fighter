/**
 * Player-facing game options, renderer-neutral and importable in Node. One
 * JSON record under a versioned key; a field that is missing or invalid
 * falls back to its default, so adding an option never invalidates a save.
 */

/** 'full' uploads the PNG sheets as RGBA8; 'compressed' loads fighter sheets
 * as GPU-compressed KTX2 where the files and the GPU allow it. */
export type TextureQuality = 'full' | 'compressed';
export interface GameSettings { readonly textureQuality: TextureQuality }

export const GAME_SETTINGS_STORAGE_KEY = 'platformfighter.settings.v1';
export const DEFAULT_GAME_SETTINGS: GameSettings = Object.freeze({ textureQuality: 'full' });
const TEXTURE_QUALITIES: readonly TextureQuality[] = ['full', 'compressed'];

/** Explicit `null` opts out of storage; omitted means the browser's
 * `localStorage`, whose mere access throws when storage is disabled. */
function storageOf<T>(explicit: T | null | undefined): T | null {
  if (explicit !== undefined) return explicit;
  try { return (globalThis as unknown as { localStorage?: T }).localStorage ?? null; } catch { return null; }
}

/** Saved settings, or defaults when missing, unreadable or invalid. Never throws. */
export function loadGameSettings(storage?: Pick<Storage, 'getItem'> | null): GameSettings {
  let saved: unknown;
  try { saved = JSON.parse(storageOf(storage)?.getItem(GAME_SETTINGS_STORAGE_KEY) ?? 'null'); } catch { return DEFAULT_GAME_SETTINGS; }
  const quality = (saved as { textureQuality?: unknown } | null)?.textureQuality;
  return { textureQuality: TEXTURE_QUALITIES.includes(quality as TextureQuality) ? quality as TextureQuality : DEFAULT_GAME_SETTINGS.textureQuality };
}

/** Persist settings; unavailable or full storage only loses the save. */
export function saveGameSettings(settings: GameSettings, storage?: Pick<Storage, 'setItem'> | null): void {
  try { storageOf(storage)?.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify({ textureQuality: settings.textureQuality })); } catch { /* not saved */ }
}
