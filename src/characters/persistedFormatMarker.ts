/**
 * Write-only format marker on persisted Link data (Lab saves, replay slots).
 * Pre-rebuild Link data carries no marker (or 'legacy') and is dropped on load.
 * Nothing in the runtime reads it.
 */
export const LINK_FORMAT_FIELD = 'linkFormat';
export const LINK_FORMAT_CURRENT = 'ultimate-rebuild-v1';
export const LINK_FORMAT_LEGACY = 'legacy';
