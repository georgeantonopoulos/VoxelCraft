
// Grid Settings
export const CHUNK_SIZE = 32;
// We use 2 padding to ensure we have enough data for neighbors (-1) and normal calculations
export const PAD = 2; 
export const TOTAL_SIZE = CHUNK_SIZE + PAD * 2;
export const ISO_LEVEL = 0.5; 
export const VOXEL_SCALE = 1.0;

// World Generation
export const RENDER_DISTANCE = 2; 
export const CHUNK_HEIGHT = 64;
export const WATER_LEVEL = 4.5;

// Physics
export const GRAVITY = -15.0; 
export const PLAYER_SPEED = 6;
export const JUMP_FORCE = 9;

// Tool Settings
export const DIG_RADIUS = 3.0;
export const DIG_STRENGTH = 1.5;

// Material Physics Properties
import { MaterialType, MaterialProperties } from './types';

export const MATERIAL_PROPS: Record<number, MaterialProperties> = {
  [MaterialType.AIR]: { absorptionRate: 0, dryingRate: 0, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.BEDROCK]: { absorptionRate: 0, dryingRate: 0, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.STONE]: {
    absorptionRate: 15, // Gets wet moderately fast
    dryingRate: 25,     // Dries fast on surface
    mossGrowthRate: 8,  // Grows moss slowly if wet
    mossDecayRate: 5    // Moss dies slowly if dry
  },
  [MaterialType.DIRT]: {
    absorptionRate: 40, // Gets wet very fast (Mud)
    dryingRate: 10,     // Dries slower (holds water)
    mossGrowthRate: 0,
    mossDecayRate: 0
  },
  [MaterialType.GRASS]: {
    absorptionRate: 30,
    dryingRate: 15,
    mossGrowthRate: 0,
    mossDecayRate: 0
  },
  [MaterialType.SAND]: {
    absorptionRate: 60, // Very porous
    dryingRate: 40,     // Dries very fast
    mossGrowthRate: 0,
    mossDecayRate: 0
  },
  [MaterialType.SNOW]: { absorptionRate: 5, dryingRate: 5, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.CLAY]: {
    absorptionRate: 10, // Impermeable
    dryingRate: 5,      // Holds water very long
    mossGrowthRate: 1,
    mossDecayRate: 1
  },
  [MaterialType.WATER_SOURCE]: { absorptionRate: 255, dryingRate: 0, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.WATER_FLOWING]: { absorptionRate: 255, dryingRate: 0, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.MOSSY_STONE]: {
    absorptionRate: 20,
    dryingRate: 15,
    mossGrowthRate: 0, // Already moss
    mossDecayRate: 0
  }
};
