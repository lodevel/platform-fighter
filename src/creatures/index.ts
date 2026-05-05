/**
 * Creatures package — public surface for the post-M2 creature
 * subsystem (M6 / M6.5 / M6.6). External consumers import
 * everything they need from this index so the per-creature module
 * shape can evolve without breaking call sites.
 */

export {
  validateCreatureSpec,
  type CreatureAI,
  type CreatureBody,
  type CreatureDespawnPolicy,
  type CreatureId,
  type CreatureMovementProfile,
  type CreatureMoveset,
  type CreatureSpec,
} from './creatureSchema';

export {
  _resetCreatureRegistryForTests,
  getCreatureSpec,
  hasCreature,
  listCreatureSpecs,
  registerCreature,
} from './creatureRegistry';

export { Creature, type CreatureAITarget, type CreatureOptions, type CreatureScene } from './Creature';

export { WOLF_PUP } from './wolfPup';
