
// Grid Settings
export const CHUNK_SIZE_XZ = 32;
export const CHUNK_SIZE = CHUNK_SIZE_XZ; // Alias for compatibility with XZ grid logic
export const CHUNK_SIZE_Y = 128; // Taller chunks to prevent mountain top cutoff (was 80)
export const PAD = 2;

export const TOTAL_SIZE_XZ = CHUNK_SIZE_XZ + PAD * 2;
export const TOTAL_SIZE_Y = CHUNK_SIZE_Y + PAD * 2;

export const MESH_Y_OFFSET = -35; // Vertical offset to align with Bedrock

export const ISO_LEVEL = 0.5;
export let SNAP_EPSILON = 0.1; // Mutable for Leva tuning

/**
 * Setter function for SNAP_EPSILON, used by Leva controls
 * @param v - The new value for SNAP_EPSILON
 */
export function setSnapEpsilon(v: number): void {
  SNAP_EPSILON = v;
}
export const VOXEL_SCALE = 1.0;

// Light Grid Settings (for voxel-based global illumination)
// Each cell covers LIGHT_CELL_SIZE^3 voxels
export const LIGHT_CELL_SIZE = 4;
export const LIGHT_GRID_SIZE_XZ = CHUNK_SIZE_XZ / LIGHT_CELL_SIZE; // 8 cells
export const LIGHT_GRID_SIZE_Y = CHUNK_SIZE_Y / LIGHT_CELL_SIZE;   // 32 cells
export const LIGHT_GRID_TOTAL_CELLS = LIGHT_GRID_SIZE_XZ * LIGHT_GRID_SIZE_Y * LIGHT_GRID_SIZE_XZ; // 2048 cells
export const LIGHT_PROPAGATION_ITERATIONS = 6; // Number of flood-fill passes
export const LIGHT_FALLOFF = 0.82; // Light retention per propagation step (higher = further reach)
export const SKY_LIGHT_ATTENUATION = 0.7; // Light retention through solid voxels vertically

// World Generation
export const RENDER_DISTANCE = 3;
// LOD Distances (in chunks from player)
export const LOD_DISTANCE_VEGETATION = 1; // Start fading small vegetation beyond this distance
export const LOD_DISTANCE_PHYSICS = 1;    // >1: No colliders on valid entities
export const LOD_DISTANCE_SIMPLIFIED = 1; // >1: Trees use simplified geometry (opaque/low-poly)
export const LOD_DISTANCE_VEGETATION_ANY = 2; // >2: No vegetation at all
export const LOD_DISTANCE_TREES_ANY = 3;  // >3: No trees at all
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
  [MaterialType.WATER]: { absorptionRate: 255, dryingRate: 0, mossGrowthRate: 0, mossDecayRate: 0 },
  [MaterialType.MOSSY_STONE]: {
    absorptionRate: 20,
    dryingRate: 15,
    mossGrowthRate: 0, // Already moss
    mossDecayRate: 0
  }
};
