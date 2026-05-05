/**
 * Character builder package — public surface for the M7 / M7.5
 * data + edit-state layers. The forthcoming Phaser scene drag/drop
 * UI consumes everything from this index so internal module
 * boundaries can shift without breaking call sites.
 */

export {
  characterStorageKey,
  deleteCharacter,
  indexStorageKey,
  listCharacters,
  loadCharacter,
  saveCharacter,
  STORAGE_APP_NAMESPACE,
  STORAGE_CHARACTERS_DOMAIN,
  STORAGE_CHARACTERS_VERSION_SEGMENT,
  type CharacterRecord,
  type StorageBackend,
} from './characterStorage';

export {
  CharacterEditState,
  EDIT_HISTORY_MAX_DEPTH,
  type CharacterEditChangeListener,
} from './characterEditState';
