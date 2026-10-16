import type { CharacterId, CustomCharacterSnapshot, MatchConfig } from '../types';
import { NEW_MATCH_FINAL_RULES, parseFinalSmashRules } from '../finalSmash/finalSmashSchema';
import { parseCharacterDataFile } from '../characters/characterSerializer';

/** Validate, clone and freeze authored data at the match/replay boundary. */
export function snapshotCustomCharacter(value: unknown, characterId: CharacterId): CustomCharacterSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid custom character snapshot');
  const input = value as Record<string, unknown>;
  if (typeof input['slotId'] !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(input['slotId'])) {
    throw new Error('Invalid custom character save slot');
  }
  const source = input['spec'];
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Missing custom character spec');
  const spec = parseCharacterDataFile(structuredClone(source), 'match character snapshot');
  if (spec.id !== characterId) throw new Error('Custom character must match the selected base fighter');
  return freezeTree({ slotId: input['slotId'], spec });
}

function freezeTree<T>(value: T, visited = new WeakSet<object>()): T {
  if (value !== null && typeof value === 'object' && !visited.has(value)) {
    visited.add(value);
    for (const child of Object.values(value)) freezeTree(child, visited);
    Object.freeze(value);
  }
  return value;
}

export function snapshotMatchCharacters(config: MatchConfig): MatchConfig {
  return Object.freeze({ ...config, finalSmashRules: parseFinalSmashRules(config.finalSmashRules ?? NEW_MATCH_FINAL_RULES), players: Object.freeze(config.players.map(player => Object.freeze({
    ...player,
    ...(player.inputDevice === undefined ? {} : { inputDevice: Object.freeze({ ...player.inputDevice }) }),
    ...(player.customCharacter === undefined ? {} : { customCharacter: snapshotCustomCharacter(player.customCharacter, player.characterId) }),
  }))) });
}
