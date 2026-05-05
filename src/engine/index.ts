export { GAME_CONFIG, SCENES, createPhaserGameConfig } from './GameConfig';
export type { GameConstants } from './GameConfig';
export { GameLoop } from './GameLoop';
export type { UpdateFn, RenderFn, GameLoopOptions } from './GameLoop';
export { PhysicsEngine } from './PhysicsEngine';
export {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
  categoriesCollide,
} from './collisionCategories';
export type { CollisionCategory } from './collisionCategories';
