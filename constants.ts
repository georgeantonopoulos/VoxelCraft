
// Grid Settings
export const CHUNK_SIZE = 32;
export const CHUNK_HEIGHT = 64; // Increased height for deep caverns
export const PAD = 2;

export const TOTAL_SIZE: number = CHUNK_SIZE + PAD * 2;
export const TOTAL_HEIGHT: number = CHUNK_HEIGHT + PAD * 2;

export const ISO_LEVEL = 0.5; 
export const VOXEL_SCALE = 1.0;

// World Generation
export const RENDER_DISTANCE = 2; 
export const WATER_LEVEL = 4.5;
export const BEDROCK_LEVEL = -35; // Align with BedrockPlane

// Physics
export const GRAVITY = -25.0; // Stronger gravity for better sliding feel
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
    absorptionRate: 15,
    dryingRate: 25,
    mossGrowthRate: 8,
    mossDecayRate: 5
  },
  [MaterialType.DIRT]: {
    absorptionRate: 40,
    dryingRate: 10,
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
    absorptionRate: 60,
    dryingRate: 40,
    mossGrowthRate: 0,
    mossDecayRate: 0
  },
  [MaterialType.SNOW]: { absorptionRate: 5, dryingRate: 5, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.CLAY]: {
    absorptionRate: 10,
    dryingRate: 5,
    mossGrowthRate: 1,
    mossDecayRate: 1
  },
  [MaterialType.WATER_SOURCE]: { absorptionRate: 255, dryingRate: 0, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.WATER_FLOWING]: { absorptionRate: 255, dryingRate: 0, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.MOSSY_STONE]: {
    absorptionRate: 20,
    dryingRate: 15,
    mossGrowthRate: 0,
    mossDecayRate: 0
  }
};
