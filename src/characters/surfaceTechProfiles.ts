/** Per-fighter surface-tech data for the shared path in surfaceTech.ts. */
import type { CharacterId } from '../types';
import type { SurfaceTechProfile } from './surfaceTech';
import { PIKACHU_AUXILIARY_SOURCE_PARAMETERS } from './pikachuAuxiliaryBody';
import { PIKACHU_CEILING_TECH_ROOT_DELTAS } from './pikachuSurfaceTech';

export const SURFACE_TECH_PROFILES: Readonly<Record<CharacterId, SurfaceTechProfile>> = Object.freeze({
  // fighter_kind_donkey passive_* params; ceiling = cancel 27 - 1.
  donkeykong: Object.freeze({ passiveWallSpeedX: 0.5, passiveWallJumpSpeedX: 1.3, passiveWallJumpSpeedY: 2.7,
    passiveCeilingSpeedX: 1, wallDurationFrames: 25, ceilingDurationFrames: 26 }),
  // Link fighter params (rework/sources/native/link-fighter-param.json).
  link: Object.freeze({ passiveWallSpeedX: 0.5, passiveWallJumpSpeedX: 1.3, passiveWallJumpSpeedY: 2.6,
    passiveCeilingSpeedX: 1, wallDurationFrames: 25, ceilingDurationFrames: 26 }),
  pikachu: Object.freeze({ passiveWallSpeedX: PIKACHU_AUXILIARY_SOURCE_PARAMETERS.passiveWallSpeedX,
    passiveWallJumpSpeedX: PIKACHU_AUXILIARY_SOURCE_PARAMETERS.passiveWallJumpSpeedX,
    passiveWallJumpSpeedY: PIKACHU_AUXILIARY_SOURCE_PARAMETERS.passiveWallJumpSpeedY,
    passiveCeilingSpeedX: PIKACHU_AUXILIARY_SOURCE_PARAMETERS.passiveCeilingSpeedX,
    wallDurationFrames: 25, ceilingDurationFrames: 27, ceilingRootDeltas: PIKACHU_CEILING_TECH_ROOT_DELTAS }),
});
