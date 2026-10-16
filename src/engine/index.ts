export { GAME_CONFIG } from './constants';
export type { GameConstants } from './constants';

export { GameLoop } from './GameLoop';
export type { UpdateFn, RenderFn, GameLoopOptions } from './GameLoop';
export { PhysicsEngine } from './PhysicsEngine';
export {
  COLLISION_CATEGORIES,
  COLLISION_MASKS,
  categoriesCollide,
} from './collisionCategories';
export type { CollisionCategory } from './collisionCategories';
