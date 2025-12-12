import { BiomeType } from './BiomeManager';

export enum VegetationType {
  GRASS_LOW = 0,
  GRASS_TALL = 1,
  FLOWER_BLUE = 2,
  DESERT_SHRUB = 3,
  SNOW_GRASS = 4,
  JUNGLE_FERN = 5,
  JUNGLE_GRASS = 6,
  GROVE_GRASS = 7,
  // --- Jungle Undergrowth Extensions ---
  // Keep new IDs appended to avoid breaking any persisted type references.
  JUNGLE_BROADLEAF = 8,
  JUNGLE_FLOWER = 9,
  JUNGLE_VINE = 10,
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
  roughness: number; // Material roughness (0-1)
}> = {
  [VegetationType.GRASS_LOW]: { color: '#66cc33', scale: [1, 0.6, 1], geometry: 'cross', sway: 0.5, roughness: 0.4 },
  [VegetationType.GRASS_TALL]: { color: '#66cc33', scale: [1, 1.2, 1], geometry: 'cross', sway: 1.0, roughness: 0.4 },
  [VegetationType.FLOWER_BLUE]: { color: '#4444ff', scale: [0.8, 0.8, 0.8], geometry: 'cross', sway: 0.3, roughness: 0.8 },
  [VegetationType.DESERT_SHRUB]: { color: '#8b6c42', scale: [1.2, 0.8, 1.2], geometry: 'box', sway: 0.1, roughness: 1.0 },
  [VegetationType.SNOW_GRASS]: { color: '#ddeedd', scale: [1, 0.5, 1], geometry: 'cross', sway: 0.4, roughness: 0.6 },
  [VegetationType.JUNGLE_FERN]: { color: '#2E7D32', scale: [2, 1.5, 2], geometry: 'cross', sway: 0.8, roughness: 0.6 },
  [VegetationType.JUNGLE_GRASS]: { color: '#22aa22', scale: [1, 0.8, 1], geometry: 'cross', sway: 0.6, roughness: 0.5 }, // Matches JUNGLE_GRASS material
  [VegetationType.GROVE_GRASS]: { color: '#88ee44', scale: [1.4, 0.7, 1.4], geometry: 'cross', sway: 0.5, roughness: 0.3 }, // Matches GRASS material
  // Jungle palette + silhouette variety:
  // - Broadleaf plants add chunky, low canopy shapes.
  // - Flowers are rare bright accents.
  // - Vines add vertical texture between grass and trunks.
  [VegetationType.JUNGLE_BROADLEAF]: { color: '#1f8f3a', scale: [2.2, 1.1, 2.2], geometry: 'cross', sway: 0.4, roughness: 0.45 },
  [VegetationType.JUNGLE_FLOWER]: { color: '#f97316', scale: [0.9, 0.9, 0.9], geometry: 'cross', sway: 0.2, roughness: 0.7 },
  [VegetationType.JUNGLE_VINE]: { color: '#0f6b2f', scale: [0.6, 1.8, 0.6], geometry: 'cross', sway: 1.1, roughness: 0.5 },
};

// Deterministic placement logic
export const getVegetationForBiome = (biome: BiomeType, noiseVal: number): VegetationType | null => {
  // noiseVal is 0..1
  switch (biome) {
    case 'BEACH':
      // Beaches should be mostly empty. Use a very sparse band so the coast reads as sand.
      // Note: Tree placement is handled separately via getTreeForBiome.
      if (noiseVal > 0.985) return VegetationType.DESERT_SHRUB; // Driftwood / scrub
      if (noiseVal > 0.93) return VegetationType.GRASS_LOW; // Occasional dune grass
      return null;
    case 'THE_GROVE':
      // Distinct, safe zone: More flowers, dense lush grass
      if (noiseVal > 0.95) return VegetationType.FLOWER_BLUE; // Occasional flowers
      if (noiseVal > 0.10) return VegetationType.GROVE_GRASS; // Almost everywhere
      return VegetationType.GROVE_GRASS; // Fallback
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
      // Dense, varied undergrowth. Use a few bands to ensure clear silhouettes:
      // 0.00-0.45  -> carpet grass
      // 0.45-0.75  -> ferns
      // 0.75-0.92  -> broadleaf clumps
      // 0.92-0.98  -> vines (vertical accents)
      // 0.98-1.00  -> rare jungle flowers
      if (noiseVal > 0.98) return VegetationType.JUNGLE_FLOWER;
      if (noiseVal > 0.92) return VegetationType.JUNGLE_VINE;
      if (noiseVal > 0.75) return VegetationType.JUNGLE_BROADLEAF;
      if (noiseVal > 0.45) return VegetationType.JUNGLE_FERN;
      return VegetationType.JUNGLE_GRASS; // Jungle is full of stuff
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
    case 'BEACH':
      // Sparse palms: allow the terrain tree spawner to skip placement when null is returned.
      if (noiseVal > 0.95) return TreeType.PALM;
      return null;
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
