import { BiomeType } from './BiomeManager';

export enum VegetationType {
  GRASS_LOW = 0,
  GRASS_TALL = 1,
  FLOWER_BLUE = 2,
  DESERT_SHRUB = 3,
  SNOW_GRASS = 4,
  JUNGLE_FERN = 5,
}

export enum TreeType {
  OAK = 0,
  PINE = 1,
  PALM = 2,
  JUNGLE = 3,
  ACACIA = 4,
  CACTUS = 5
}

// Visual definition for each type
export const VEGETATION_ASSETS: Record<number, {
  color: string;
  scale: [number, number, number];
  geometry: 'cross' | 'box'; // Restricted to box/cross as per Voxel Style
  sway: number; // How much it reacts to wind (0-1)
}> = {
  [VegetationType.GRASS_LOW]: { color: '#55aa33', scale: [1, 0.6, 1], geometry: 'cross', sway: 0.5 },
  [VegetationType.GRASS_TALL]: { color: '#449922', scale: [1, 1.2, 1], geometry: 'cross', sway: 1.0 },
  [VegetationType.FLOWER_BLUE]: { color: '#4444ff', scale: [0.8, 0.8, 0.8], geometry: 'cross', sway: 0.3 },
  [VegetationType.DESERT_SHRUB]: { color: '#8b6c42', scale: [1.2, 0.8, 1.2], geometry: 'box', sway: 0.1 },
  [VegetationType.SNOW_GRASS]: { color: '#ddeedd', scale: [1, 0.5, 1], geometry: 'cross', sway: 0.4 },
  [VegetationType.JUNGLE_FERN]: { color: '#228b22', scale: [2, 1.5, 2], geometry: 'cross', sway: 0.8 },
};

// Deterministic placement logic
export const getVegetationForBiome = (biome: BiomeType, noiseVal: number): VegetationType | null => {
  // noiseVal is 0..1
  switch (biome) {
    case 'THE_GROVE':
      // Distinct, safe zone: More flowers, dense lush grass
      if (noiseVal > 0.85) return VegetationType.GRASS_TALL;
      if (noiseVal > 0.40) return VegetationType.GRASS_LOW;
      if (noiseVal > 0.30) return VegetationType.FLOWER_BLUE;
      return VegetationType.GRASS_LOW; // Fallback for very dense feel
    case 'PLAINS':
    case 'SKY_ISLANDS':
      if (noiseVal > 0.90) return VegetationType.GRASS_TALL;
      if (noiseVal > 0.40) return VegetationType.GRASS_LOW;
      if (noiseVal > 0.35) return VegetationType.FLOWER_BLUE;
      return VegetationType.GRASS_LOW; // Fill the rest with low grass
    case 'DESERT':
    case 'RED_DESERT':
      if (noiseVal > 0.90) return VegetationType.DESERT_SHRUB;
      break;
    case 'SNOW':
      if (noiseVal > 0.60) return VegetationType.SNOW_GRASS;
      break;
    case 'JUNGLE':
      if (noiseVal > 0.60) return VegetationType.JUNGLE_FERN;
      return VegetationType.GRASS_TALL; // Jungle is full of stuff
    case 'SAVANNA':
      if (noiseVal > 0.80) return VegetationType.GRASS_TALL;
      if (noiseVal > 0.40) return VegetationType.GRASS_LOW;
      break;
    case 'MOUNTAINS':
      // Sparse alpine patches
      if (noiseVal > 0.90) return VegetationType.GRASS_LOW;
      break;
    case 'ICE_SPIKES':
      // Barren
      return null;
  }
  return null;
};

export const getTreeForBiome = (biome: BiomeType, noiseVal: number): TreeType | null => {
  switch (biome) {
    case 'THE_GROVE':
    case 'PLAINS':
    case 'SKY_ISLANDS':
      return TreeType.OAK;
    case 'SNOW':
    case 'MOUNTAINS':
    case 'ICE_SPIKES':
      return TreeType.PINE;
    case 'DESERT':
    case 'RED_DESERT':
      return TreeType.CACTUS;
    case 'JUNGLE':
      return TreeType.JUNGLE;
    case 'SAVANNA':
      return TreeType.ACACIA;
  }
  return TreeType.OAK;
};

export const getBiomeVegetationDensity = (biome: BiomeType): number => {
  switch (biome) {
    case 'THE_GROVE': return 0.7; // Very lush
    case 'JUNGLE': return 0.85;   // Extremely dense
    case 'PLAINS': return 0.5;    // Moderate
    case 'SAVANNA': return 0.4;   // Sparse patches
    case 'SKY_ISLANDS': return 0.6;
    case 'SNOW': return 0.3;      // Sparse
    case 'MOUNTAINS': return 0.2; // Very sparse
    case 'DESERT':
    case 'RED_DESERT': return 0.15; // Almost empty
    case 'ICE_SPIKES': return 0.05; // Barren
    default: return 0.5;
  }
};
