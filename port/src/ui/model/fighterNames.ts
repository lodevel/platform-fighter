import { getCharacterSpec } from '../../../../src/characters/roster';
import type { CharacterId } from '../../../../src/types';

/** Menu name of a fighter: the roster display name without its "(source)" suffix. */
export const fighterShortName = (id: CharacterId): string => getCharacterSpec(id).displayName.replace(/\s*\(.*\)$/, '');
